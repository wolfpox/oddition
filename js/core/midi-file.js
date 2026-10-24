/* Oddition — Standard MIDI File (SMF) writer and reader.
 *
 * write() produces a format-1 file: track 0 holds tempo, time signature,
 * key signature and section markers; every other track is one stem.
 *
 *   Odd.midiFile.write({
 *     name, bpm, ppq = 480, length (ticks, optional), tonic, scale,
 *     markers: [{ t, text }],
 *     tracks: [{ name, channel (0-15), program (GM, optional), notes: [{ t, d, p, v }] }]
 *   }) -> Uint8Array
 */
(function (Odd) {
  'use strict';

  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  function textBytes(s) {
    const str = String(s == null ? '' : s);
    if (encoder) return Array.from(encoder.encode(str));
    return Array.from(unescape(encodeURIComponent(str)), (c) => c.charCodeAt(0));
  }

  function vlq(n) {
    let v = Math.max(0, Math.round(n));
    const bytes = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    return bytes;
  }

  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }

  function chunk(type, data) {
    return textBytes(type).concat(u32(data.length), data);
  }

  function meta(type, data) {
    return [0xff, type].concat(vlq(data.length), data);
  }

  // sharps(+)/flats(-) of the relative major, by pitch class
  const SF = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  const REL_MAJOR = { major: 0, minor: 3, dorian: 10, phrygian: 8, lydian: 7, mixolydian: 5, harmonicMinor: 3 };

  function keySignature(tonic, scale) {
    const rel = (((tonic || 0) + (REL_MAJOR[scale] != null ? REL_MAJOR[scale] : 0)) % 12 + 12) % 12;
    const sf = SF[rel];
    const minor = scale === 'minor' || scale === 'harmonicMinor' ? 1 : 0;
    return [sf & 0xff, minor];
  }

  /** remove same-pitch overlaps so every note-on has its own note-off */
  function cleanNotes(notes) {
    const byPitch = new Map();
    for (const n of notes) {
      if (!(n.d > 0) || n.p == null) continue;
      const p = Math.max(0, Math.min(127, Math.round(n.p)));
      const t = Math.max(0, Math.round(n.t));
      const d = Math.max(1, Math.round(n.d));
      const v = Math.max(1, Math.min(127, Math.round(n.v || 100)));
      if (!byPitch.has(p)) byPitch.set(p, []);
      byPitch.get(p).push({ t, d, p, v });
    }
    const out = [];
    for (const list of byPitch.values()) {
      list.sort((a, b) => a.t - b.t || b.v - a.v);
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        const next = list[i + 1];
        if (next && next.t === n.t) { list.splice(i + 1, 1); i--; continue; } // duplicate start: keep louder
        if (next && n.t + n.d > next.t) n.d = next.t - n.t;
        if (n.d > 0) out.push(n);
      }
    }
    return out;
  }

  function encodeTrack(events, endTick) {
    // events: [{ t, o (order), b (bytes) }]
    events.sort((a, b) => a.t - b.t || a.o - b.o);
    const data = [];
    let last = 0;
    for (const e of events) {
      data.push(...vlq(e.t - last), ...e.b);
      last = e.t;
    }
    const end = Math.max(last, endTick || 0);
    data.push(...vlq(end - last), 0xff, 0x2f, 0x00);
    return chunk('MTrk', data);
  }

  function write(song) {
    const ppq = song.ppq || 480;
    const bpm = song.bpm || 120;
    const tracks = song.tracks || [];

    let lastTick = song.length || 0;
    const prepared = tracks.map((tr) => {
      const notes = cleanNotes(tr.notes || []);
      for (const n of notes) lastTick = Math.max(lastTick, n.t + n.d);
      return { tr, notes };
    });

    // conductor track
    const cond = [];
    cond.push({ t: 0, o: 0, b: meta(0x03, textBytes(song.name || 'Oddition')) });
    cond.push({ t: 0, o: 0, b: meta(0x58, [4, 2, 24, 8]) });
    const mpq = Math.round(60000000 / bpm);
    cond.push({ t: 0, o: 0, b: meta(0x51, [(mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255]) });
    if (song.tonic != null) cond.push({ t: 0, o: 0, b: meta(0x59, keySignature(song.tonic, song.scale)) });
    for (const m of song.markers || []) {
      cond.push({ t: Math.max(0, Math.round(m.t)), o: 1, b: meta(0x06, textBytes(m.text)) });
    }

    const chunks = [encodeTrack(cond, lastTick)];
    for (const { tr, notes } of prepared) {
      const ch = Math.max(0, Math.min(15, tr.channel || 0));
      const evs = [];
      evs.push({ t: 0, o: 0, b: meta(0x03, textBytes(tr.name || 'Track')) });
      if (tr.program != null && ch !== 9) {
        evs.push({ t: 0, o: 1, b: [0xc0 | ch, Math.max(0, Math.min(127, tr.program))] });
      }
      for (const n of notes) {
        evs.push({ t: n.t + n.d, o: 2, b: [0x80 | ch, n.p, 0x40] });
        evs.push({ t: n.t, o: 3, b: [0x90 | ch, n.p, n.v] });
      }
      chunks.push(encodeTrack(evs, lastTick));
    }

    const header = chunk('MThd', [].concat(u16(1), u16(chunks.length), u16(ppq)));
    const total = header.length + chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    out.set(header, off); off += header.length;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // ---------------- reader ----------------

  function read(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let pos = 0;
    const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    const text = (arr) => (dec ? dec.decode(new Uint8Array(arr)) : String.fromCharCode.apply(null, arr));
    function str4() { const s = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]); pos += 4; return s; }
    function r32() { const v = ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0; pos += 4; return v; }
    function r16() { const v = (b[pos] << 8) | b[pos + 1]; pos += 2; return v; }
    function rvlq() {
      let v = 0, c;
      do { c = b[pos++]; v = v * 128 + (c & 0x7f); } while (c & 0x80 && pos < b.length);
      return v;
    }

    if (str4() !== 'MThd') throw new Error('Not a MIDI file');
    const hlen = r32();
    const format = r16();
    const ntracks = r16();
    const division = r16();
    pos += hlen - 6;
    if (division & 0x8000) throw new Error('SMPTE time division is not supported');

    const result = { format, ppq: division, bpm: 120, tracks: [], markers: [], keySig: null };
    let tempoSet = false;

    for (let ti = 0; ti < ntracks && pos < b.length; ti++) {
      const type = str4();
      const len = r32();
      const end = pos + len;
      if (type !== 'MTrk') { pos = end; continue; }
      const track = { name: '', program: null, channel: null, notes: [] };
      const open = new Map();
      let tick = 0;
      let status = 0;
      while (pos < end) {
        tick += rvlq();
        let st = b[pos];
        if (st & 0x80) { pos++; status = st; } else st = status; // running status
        if (st === 0xff) {
          const mt = b[pos++];
          const ml = rvlq();
          const data = Array.from(b.subarray(pos, pos + ml));
          pos += ml;
          if (mt === 0x03) track.name = text(data);
          else if (mt === 0x51 && !tempoSet && ml === 3) {
            result.bpm = Math.round((60000000 / ((data[0] << 16) | (data[1] << 8) | data[2])) * 100) / 100;
            tempoSet = true;
          } else if (mt === 0x06) result.markers.push({ t: tick, text: text(data) });
          else if (mt === 0x59 && ml === 2) result.keySig = { sf: (data[0] << 24) >> 24, minor: data[1] === 1 };
          else if (mt === 0x2f) break;
        } else if (st === 0xf0 || st === 0xf7) {
          pos += rvlq();
        } else {
          const kind = st & 0xf0;
          const ch = st & 0x0f;
          if (kind === 0xc0 || kind === 0xd0) {
            const d1 = b[pos++];
            if (kind === 0xc0 && track.program == null) track.program = d1;
          } else {
            const d1 = b[pos++];
            const d2 = b[pos++];
            const key = ch * 128 + d1;
            if (kind === 0x90 && d2 > 0) {
              if (track.channel == null) track.channel = ch;
              if (!open.has(key)) open.set(key, []);
              open.get(key).push({ t: tick, v: d2, ch, p: d1 });
            } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
              const stack = open.get(key);
              if (stack && stack.length) {
                const on = stack.shift();
                track.notes.push({ t: on.t, d: Math.max(1, tick - on.t), p: d1, v: on.v, ch });
              }
            }
          }
        }
      }
      for (const stack of open.values()) {
        for (const on of stack) track.notes.push({ t: on.t, d: Math.max(1, tick - on.t), p: on.p, v: on.v, ch: on.ch });
      }
      track.notes.sort((x, y) => x.t - y.t || x.p - y.p);
      result.tracks.push(track);
      pos = end;
    }
    return result;
  }

  Odd.midiFile = { write, read, keySignature, cleanNotes };
})(globalThis.Odd = globalThis.Odd || {});
