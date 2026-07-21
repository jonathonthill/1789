#!/usr/bin/env python3
"""Turn the loop-ready piano reduction into the game's compact GM arrangement."""

from __future__ import annotations

import argparse
import collections
import pathlib
import struct
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from midi_loop_analyze import encode_vlq, parse  # noqa: E402


PROGRAMS = {
    0: 68,  # oboe — verse melody
    1: 42,  # cello
    2: 48,  # string ensemble
    3: 0,   # piano — short inner figures
    4: 47,  # timpani
    5: 56,  # trumpet — chorus melody
    6: 60,  # French horn — transition melody
    7: 43,  # contrabass
}


def paired_notes(events):
    active = collections.defaultdict(list)
    notes = []
    for event in events:
        tick, order, typ, *rest = event
        if typ != "midi":
            continue
        hi, channel, payload = rest
        pitch = payload[0]
        key = (channel, pitch)
        if hi == 0x90 and payload[1] > 0:
            active[key].append((tick, payload[1], order))
        elif hi == 0x80 or (hi == 0x90 and payload[1] == 0):
            if active[key]:
                start, velocity, on_order = active[key].pop(0)
                notes.append((start, tick, pitch, velocity, on_order))
    return sorted(notes)


def midi(status, channel, *data):
    return bytes([status | channel, *data])


def meta(kind, payload):
    return b"\xff" + bytes([kind]) + encode_vlq(len(payload)) + payload


def arrange(source, output):
    _, ppq, source_events = parse(source)
    notes = paired_notes(source_events)
    end_tick = max(event[0] for event in source_events)
    bar_ticks = ppq * 4
    arranged = []
    serial = 0

    def add(tick, priority, payload):
        nonlocal serial
        arranged.append((tick, priority, serial, payload))
        serial += 1

    add(0, 0, meta(0x03, b"1789 - verse and chorus loop"))
    for event in source_events:
        if event[0] != 0 or event[2] != "meta":
            continue
        kind, payload = event[3], event[4]
        if kind in (0x51, 0x58, 0x59):
            add(0, 0, meta(kind, payload))
    for channel, program in PROGRAMS.items():
        add(0, 1, midi(0xC0, channel, program))

    by_start = collections.defaultdict(list)
    for note in notes:
        by_start[note[0]].append(note)

    for start, group in sorted(by_start.items()):
        bar = start // bar_ticks
        section = "verse" if bar < 30 else ("build" if bar < 39 else "chorus")
        high_index = max(range(len(group)), key=lambda i: (group[i][2], group[i][1] - group[i][0]))
        for index, (on, off, pitch, _velocity, _order) in enumerate(group):
            duration = off - on
            is_lead = index == high_index and pitch >= 57
            if is_lead:
                channel = 0 if section == "verse" else (6 if section == "build" else 5)
                velocity = 78 if section == "verse" else (86 if section == "build" else 94)
            elif pitch < 40:
                channel = 7
                velocity = 58 if section == "verse" else 68
            elif pitch < 52:
                channel = 1
                velocity = 60 if section == "verse" else 70
            elif duration <= ppq // 2:
                channel = 3
                velocity = 48 if section == "verse" else 56
            else:
                channel = 2
                velocity = 50 if section == "verse" else (56 if section == "build" else 62)
            add(on, 3, midi(0x90, channel, pitch, velocity))
            add(min(off, end_tick), 2, midi(0x80, channel, pitch, 0))

    # Pitched timpani reinforces downbeats without turning the backing into a
    # constant drum loop. Roots come from the reduction's local bass register.
    for bar in range(end_tick // bar_ticks):
        section = "verse" if bar < 30 else ("build" if bar < 39 else "chorus")
        beats = (0,) if section == "verse" else (0, 2)
        for beat in beats:
            tick = bar * bar_ticks + beat * ppq
            nearby = [pitch for on, off, pitch, vel, order in notes if tick <= on < tick + ppq]
            if not nearby:
                continue
            pitch = min(nearby)
            while pitch < 36:
                pitch += 12
            while pitch > 48:
                pitch -= 12
            velocity = 44 if section == "verse" else (54 if section == "build" else 62)
            add(tick, 3, midi(0x90, 4, pitch, velocity))
            add(min(tick + ppq * 3 // 4, end_tick), 2, midi(0x80, 4, pitch, 0))

    # A restrained revolutionary march enters after the opening verse and grows
    # with the arrangement. Channel 10 (index 9) uses General MIDI drum notes.
    for bar in range(15, end_tick // bar_ticks):
        section = "verse" if bar < 30 else ("build" if bar < 39 else "chorus")
        kick = 34 if section == "verse" else (44 if section == "build" else 54)
        snare = 32 if section == "verse" else (42 if section == "build" else 50)
        for beat, pitch, velocity in ((0, 36, kick), (1, 38, snare), (2, 36, kick - 4), (3, 38, snare)):
            tick = bar * bar_ticks + beat * ppq
            add(tick, 3, midi(0x90, 9, pitch, velocity))
            add(tick + ppq // 8, 2, midi(0x80, 9, pitch, 0))
        if bar in (30, 39, 51):
            tick = bar * bar_ticks
            add(tick, 3, midi(0x90, 9, 49, 50))
            add(tick + ppq // 2, 2, midi(0x80, 9, 49, 0))

    arranged.sort(key=lambda item: (item[0], item[1], item[2]))
    track = bytearray()
    previous = 0
    for tick, _priority, _serial, payload in arranged:
        track += encode_vlq(tick - previous)
        track += payload
        previous = tick
    track += encode_vlq(end_tick - previous) + b"\xff\x2f\x00"

    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, ppq)
    result = header + b"MTrk" + struct.pack(">I", len(track)) + track
    pathlib.Path(output).write_bytes(result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()
    arrange(args.source, args.output)


if __name__ == "__main__":
    main()
