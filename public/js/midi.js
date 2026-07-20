// Small Standard MIDI File parser for the bundled background arrangement.
// It deliberately handles the parts of SMF needed by a browser synth: tempo,
// program changes, and paired note-on/note-off events. No runtime dependency is
// needed and the original .mid remains the source of truth.

function readVarLen(bytes, cursor) {
  let value = 0;
  let byte;
  do {
    if (cursor.i >= bytes.length) throw new Error('Unexpected end of MIDI data');
    byte = bytes[cursor.i++];
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return value;
}

function fourCC(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

export function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || fourCC(bytes, 0) !== 'MThd') throw new Error('Invalid MIDI header');

  const headerLength = view.getUint32(4);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI is not supported');

  const tempos = [{ tick: 0, micros: 500000 }];
  const noteEvents = [];
  let endTick = 0;
  let offset = 8 + headerLength;

  for (let track = 0; track < trackCount; track++) {
    if (fourCC(bytes, offset) !== 'MTrk') throw new Error('Invalid MIDI track');
    const trackLength = view.getUint32(offset + 4);
    const end = offset + 8 + trackLength;
    const cursor = { i: offset + 8 };
    const programs = Array(16).fill(0);
    let tick = 0;
    let runningStatus = null;

    while (cursor.i < end) {
      tick += readVarLen(bytes, cursor);
      endTick = Math.max(endTick, tick);
      let status = bytes[cursor.i];
      if (status & 0x80) {
        cursor.i++;
        if (status < 0xf0) runningStatus = status;
      } else {
        if (runningStatus == null) throw new Error('Invalid MIDI running status');
        status = runningStatus;
      }

      if (status === 0xff) {
        const type = bytes[cursor.i++];
        const length = readVarLen(bytes, cursor);
        if (type === 0x51 && length === 3) {
          const micros = (bytes[cursor.i] << 16) | (bytes[cursor.i + 1] << 8) | bytes[cursor.i + 2];
          tempos.push({ tick, micros });
        }
        cursor.i += length;
        runningStatus = null;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        cursor.i += readVarLen(bytes, cursor);
        runningStatus = null;
        continue;
      }

      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const data1 = bytes[cursor.i++];
      const oneByte = kind === 0xc0 || kind === 0xd0;
      const data2 = oneByte ? 0 : bytes[cursor.i++];

      if (kind === 0xc0) programs[channel] = data1;
      if (kind === 0x90 && data2 > 0) {
        noteEvents.push({ tick, type: 'on', channel, note: data1, velocity: data2, program: programs[channel] });
      } else if (kind === 0x80 || (kind === 0x90 && data2 === 0)) {
        noteEvents.push({ tick, type: 'off', channel, note: data1 });
      }
    }
    offset = end;
  }

  // Duplicate tick-zero tempo events are common; the last one is authoritative.
  tempos.sort((a, b) => a.tick - b.tick);
  const tempoMap = [];
  for (const tempo of tempos) {
    if (tempoMap.at(-1)?.tick === tempo.tick) tempoMap[tempoMap.length - 1] = tempo;
    else tempoMap.push(tempo);
  }

  let tempoSeconds = 0;
  for (let i = 0; i < tempoMap.length; i++) {
    if (i > 0) {
      const previous = tempoMap[i - 1];
      tempoSeconds += (tempoMap[i].tick - previous.tick) * previous.micros / division / 1_000_000;
    }
    tempoMap[i].seconds = tempoSeconds;
  }
  const toSeconds = tick => {
    let lo = 0, hi = tempoMap.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (tempoMap[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    const tempo = tempoMap[lo];
    return tempo.seconds + (tick - tempo.tick) * tempo.micros / division / 1_000_000;
  };

  noteEvents.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));
  const active = new Map();
  const notes = [];
  for (const event of noteEvents) {
    const key = `${event.channel}:${event.note}`;
    if (event.type === 'on') {
      const stack = active.get(key) ?? [];
      stack.push(event);
      active.set(key, stack);
      continue;
    }
    const stack = active.get(key);
    const start = stack?.shift();
    if (!start) continue;
    if (!stack.length) active.delete(key);
    const time = toSeconds(start.tick);
    notes.push({
      time,
      duration: Math.max(.04, toSeconds(event.tick) - time),
      note: start.note,
      velocity: start.velocity,
      channel: start.channel,
      program: start.program,
    });
  }

  notes.sort((a, b) => a.time - b.time);
  return { notes, duration: Math.max(toSeconds(endTick), notes.at(-1)?.time ?? 0) };
}
