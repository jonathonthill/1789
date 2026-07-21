#!/usr/bin/env python3
import argparse
import collections
import pathlib
import struct


def vlq(data, pos):
    value = 0
    while True:
        b = data[pos]
        pos += 1
        value = (value << 7) | (b & 0x7f)
        if not (b & 0x80):
            return value, pos


def parse(path):
    data = pathlib.Path(path).read_bytes()
    if data[:4] != b'MThd':
        raise ValueError('not a Standard MIDI file')
    hlen = struct.unpack('>I', data[4:8])[0]
    fmt, ntrks, division = struct.unpack('>HHH', data[8:14])
    pos = 8 + hlen
    events = []
    for track in range(ntrks):
        if data[pos:pos+4] != b'MTrk':
            raise ValueError('missing MTrk')
        length = struct.unpack('>I', data[pos+4:pos+8])[0]
        chunk = data[pos+8:pos+8+length]
        pos += 8 + length
        p = tick = 0
        running = None
        order = 0
        while p < len(chunk):
            delta, p = vlq(chunk, p)
            tick += delta
            status = chunk[p]
            if status & 0x80:
                p += 1
                if status < 0xf0:
                    running = status
            else:
                if running is None:
                    raise ValueError('bad running status')
                status = running
            if status == 0xff:
                meta = chunk[p]
                p += 1
                size, p = vlq(chunk, p)
                payload = bytes(chunk[p:p+size])
                p += size
                events.append((tick, order, 'meta', meta, payload))
            elif status in (0xf0, 0xf7):
                size, p = vlq(chunk, p)
                payload = bytes(chunk[p:p+size])
                p += size
                events.append((tick, order, 'sysex', status, payload))
            else:
                hi, ch = status & 0xf0, status & 0x0f
                size = 1 if hi in (0xc0, 0xd0) else 2
                payload = tuple(chunk[p:p+size])
                p += size
                events.append((tick, order, 'midi', hi, ch, payload))
            order += 1
    return fmt, division, events


def encode_vlq(value):
    buf = [value & 0x7f]
    value >>= 7
    while value:
        buf.append(0x80 | (value & 0x7f))
        value >>= 7
    return bytes(reversed(buf))


def encode_event(event):
    _, _, typ, *rest = event
    if typ == 'meta':
        meta, payload = rest
        return b'\xff' + bytes([meta]) + encode_vlq(len(payload)) + payload
    if typ == 'sysex':
        status, payload = rest
        return bytes([status]) + encode_vlq(len(payload)) + payload
    hi, ch, payload = rest
    return bytes([hi | ch, *payload])


def write_crop(source, output, start_tick, end_tick):
    _, ppq, events = parse(source)
    output_events = []
    # Preserve global setup/state, then place the selected music at tick zero.
    for event in events:
        tick, order, typ, *rest = event
        if tick >= start_tick:
            continue
        if typ == 'meta' and rest[0] in (0x03, 0x51, 0x58, 0x59):
            output_events.append((0, order, 0, event))
        elif typ == 'midi' and rest[0] not in (0x80, 0x90, 0xa0):
            output_events.append((0, order, 0, event))
    for event in events:
        tick, order, typ, *rest = event
        include = start_tick <= tick < end_tick
        if tick == end_tick and typ == 'midi':
            hi, ch, payload = rest
            include = hi == 0x80 or (hi == 0x90 and payload[1] == 0)
        if include and not (typ == 'meta' and rest[0] == 0x2f):
            output_events.append((tick - start_tick, order, 1, event))
    output_events.sort(key=lambda x: (x[0], x[2], x[1]))
    # Drop note-offs belonging to notes that began before the crop.
    filtered_events = []
    crop_state = collections.Counter()
    for item in output_events:
        tick, _, phase, event = item
        if phase == 1 and event[2] == 'midi':
            hi, ch, payload = event[3], event[4], event[5]
            key = (ch, payload[0])
            if hi == 0x90 and payload[1] > 0:
                crop_state[key] += 1
            elif hi == 0x80 or (hi == 0x90 and payload[1] == 0):
                if not crop_state[key]:
                    continue
                crop_state[key] -= 1
        filtered_events.append(item)
    output_events = filtered_events
    # Explicitly close any notes whose source note-offs lie beyond the crop.
    # This avoids stuck notes in players that do not reset channels on looping.
    active_notes = collections.Counter()
    for tick, _, phase, event in output_events:
        if phase != 1 or event[2] != 'midi':
            continue
        hi, ch, payload = event[3], event[4], event[5]
        key = (ch, payload[0])
        if hi == 0x90 and payload[1] > 0:
            active_notes[key] += 1
        elif hi == 0x80 or (hi == 0x90 and payload[1] == 0):
            if active_notes[key]:
                active_notes[key] -= 1
    close_order = 1_000_000
    for (ch, pitch), count in sorted(active_notes.items()):
        for _ in range(count):
            event = (end_tick, close_order, 'midi', 0x80, ch, (pitch, 0))
            output_events.append((end_tick - start_tick, close_order, 1, event))
            close_order += 1
    output_events.sort(key=lambda x: (x[0], x[2], x[1]))
    track = bytearray()
    previous = 0
    for tick, _, _, event in output_events:
        track += encode_vlq(tick - previous)
        track += encode_event(event)
        previous = tick
    track += encode_vlq(end_tick - start_tick - previous) + b'\xff\x2f\x00'
    header = b'MThd' + struct.pack('>IHHH', 6, 0, 1, ppq)
    data = header + b'MTrk' + struct.pack('>I', len(track)) + track
    pathlib.Path(output).write_bytes(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('midi')
    ap.add_argument('--write-loop')
    ap.add_argument('--start-bar', type=int)
    ap.add_argument('--bars', type=int)
    args = ap.parse_args()
    fmt, ppq, events = parse(args.midi)
    meta_events = [(e[0], e[3], e[4]) for e in events if e[2] == 'meta']
    tempos = [(t, int.from_bytes(payload, 'big')) for t, meta, payload in meta_events
              if meta == 0x51]
    meters = [(t, payload[0], 2 ** payload[1]) for t, meta, payload in meta_events
              if meta == 0x58]
    keys = [(t, int.from_bytes(payload[:1], 'big', signed=True), payload[1])
            for t, meta, payload in meta_events if meta == 0x59]
    names = [(t, meta, payload.decode('latin1', 'replace')) for t, meta, payload in meta_events
             if meta in (1, 2, 3, 4, 5, 6, 7)]
    notes = []
    active = collections.defaultdict(list)
    for t, order, typ, *rest in events:
        if typ != 'midi':
            continue
        hi, ch, payload = rest
        if hi == 0x90 and payload[1] > 0:
            active[(ch, payload[0])].append((t, payload[1], order))
        elif hi == 0x80 or (hi == 0x90 and payload[1] == 0):
            key = (ch, payload[0])
            if active[key]:
                start, vel, on_order = active[key].pop(0)
                notes.append((start, t, ch, payload[0], vel))
    notes.sort()
    last_tick = max((e[0] for e in events), default=0)
    sounding_end = max((n[1] for n in notes), default=0)
    print(f'format={fmt} ppq={ppq} events={len(events)} notes={len(notes)}')
    print(f'last_event_tick={last_tick} last_note_off_tick={sounding_end}')
    print('tempos:', tempos)
    print('meters:', meters)
    print('keys:', keys)
    print('text:', names)
    if meters:
        _, num, den = meters[0]
    else:
        num, den = 4, 4
    bar_ticks = ppq * 4 * num // den
    if args.write_loop:
        if not args.start_bar or not args.bars:
            ap.error('--write-loop requires --start-bar and --bars')
        start_tick = (args.start_bar - 1) * bar_ticks
        end_tick = start_tick + args.bars * bar_ticks
        write_crop(args.midi, args.write_loop, start_tick, end_tick)
        print(f'wrote {args.write_loop}: ticks {start_tick}..{end_tick}')
    print(f'bar_ticks={bar_ticks} nominal_bars={sounding_end / bar_ticks:.3f}')
    # Print a compact pitch/rhythm signature for each nominal bar.
    count = (sounding_end + bar_ticks - 1) // bar_ticks
    sigs = []
    for bar in range(count):
        base = bar * bar_ticks
        sig = tuple((s-base, min(e, base+bar_ticks)-s, ch, pitch, vel)
                    for s, e, ch, pitch, vel in notes if base <= s < base+bar_ticks)
        sigs.append(sig)
        pitches = ' '.join(f'{p}@{(s-base)/ppq:g}+{(min(e,base+bar_ticks)-s)/ppq:g}'
                           for s, e, ch, p, v in notes if base <= s < base+bar_ticks)
        print(f'bar {bar+1:3d} tick {base:6d}: {pitches}')
    groups = collections.defaultdict(list)
    for i, sig in enumerate(sigs):
        groups[sig].append(i)
    print('repeated exact bars:')
    for positions in groups.values():
        if len(positions) > 1:
            print(' ', ', '.join(str(i+1) for i in positions))

    # Longest exact repeated run of complete bars, ranked by the loop span.
    candidates = []
    for a in range(len(sigs)):
        for b in range(a+1, len(sigs)):
            run = 0
            while b+run < len(sigs) and sigs[a+run] == sigs[b+run]:
                run += 1
            if run:
                candidates.append((b-a, run, a, b))
    print('top repeated-bar boundaries (loop span, matching overlap, starts):')
    for span, run, a, b in sorted(candidates, reverse=True)[:20]:
        print(f'  span={span} bars overlap={run} bars: bar {a+1} == bar {b+1}')


if __name__ == '__main__':
    main()
