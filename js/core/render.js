/* Oddition — turn parts into playable events.
 *
 * Parts store scale degrees written against their own chord progression.
 * Rendering places a part into a target (key, scale, progression, length),
 * looping it if it is shorter and "refitting" each note to the chord that
 * sounds under it in the target. Output events use absolute MIDI pitches:
 *   { t, d, p, v, track }
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;

  const FALLBACK_PROG = [{ deg: 0, beats: 4 }];

  /**
   * target: { tonic, scale, prog, length (ticks), oct (octave shift), refit (default true) }
   */
  function partEvents(part, target) {
    const tg = target || {};
    const partLen = Math.max(1, part.bars || 1) * T.BAR;
    const length = tg.length != null ? tg.length : partLen;
    const isDrum = part.role === 'drums';
    const base = (part.base != null ? part.base : 60) + 12 * (tg.oct || 0);
    const refit = tg.refit !== false;
    const srcProg = part.ctx && part.ctx.prog && part.ctx.prog.length ? part.ctx.prog : FALLBACK_PROG;
    const tgtProg = tg.prog && tg.prog.length ? tg.prog : srcProg;
    const tonic = tg.tonic != null ? tg.tonic : (part.ctx ? part.ctx.tonic : 0);
    const scale = tg.scale || (part.ctx ? part.ctx.scale : 'major');
    const notes = part.notes || [];
    const out = [];

    for (let loopStart = 0; loopStart < length; loopStart += partLen) {
      for (const n of notes) {
        const t = loopStart + n.t;
        if (t >= length) continue;
        const d = Math.max(1, Math.min(n.d, length - t));
        if (isDrum || n.p != null) {
          out.push({ t, d, p: n.p, v: n.v });
          continue;
        }
        let deg = n.deg;
        if (refit) {
          const s = T.chordAt(srcProg, n.t).chord.deg;
          const g = T.chordAt(tgtProg, t).chord.deg;
          deg += T.wrapDelta(g - s);
        }
        out.push({ t, d, p: T.pitchOf(deg, n.acc, tonic, scale, base), v: n.v });
      }
    }
    out.sort(byTime);
    return out;
  }

  function byTime(a, b) { return a.t - b.t || a.p - b.p; }

  /** delay off-beat 16ths. amount 0..0.5 (0.33 ~ triplet feel). Returns new events. */
  function applySwing(events, amount) {
    const delay = Math.round(Math.max(0, Math.min(0.6, amount || 0)) * T.STEP);
    if (!delay) return events.slice();
    return events.map((e) => {
      if (e.t % (T.STEP * 2) !== T.STEP) return e;
      return Object.assign({}, e, { t: e.t + delay, d: Math.max(15, e.d - delay) });
    });
  }

  function sectionTarget(session, section, length) {
    return {
      tonic: T.mod((session.tonic || 0) + (section.transpose || 0), 12),
      scale: session.scale,
      prog: section.prog,
      length: length != null ? length : section.bars * T.BAR,
    };
  }

  /**
   * Events for every filled slot of a section.
   * opts: { offset, length, exclude (lane id to leave out), only (lane id) }
   */
  function sectionEvents(session, section, opts) {
    const o = opts || {};
    const offset = o.offset || 0;
    const tgt = sectionTarget(session, section, o.length);
    const out = [];
    for (const lane of session.lanes) {
      if (o.exclude && lane.id === o.exclude) continue;
      if (o.only && lane.id !== o.only) continue;
      const slot = section.slots && section.slots[lane.id];
      if (!slot || !slot.part) continue;
      const evs = partEvents(slot.part, Object.assign({}, tgt, { oct: slot.oct || 0, refit: slot.refit !== false }));
      for (const e of evs) {
        e.t += offset;
        e.track = lane.id;
        out.push(e);
      }
    }
    return out;
  }

  /** whole arrangement: { events, length, markers: [{ index, sectionId, name, start, end }] } */
  function songEvents(session, opts) {
    const o = opts || {};
    const out = [];
    const markers = [];
    let pos = 0;
    session.arrangement.forEach((sid, index) => {
      const section = session.sections.find((s) => s.id === sid);
      if (!section) return;
      const len = section.bars * T.BAR;
      const evs = sectionEvents(session, section, { offset: pos, only: o.only });
      for (const e of evs) out.push(e);
      markers.push({ index, sectionId: sid, name: section.name, start: pos, end: pos + len });
      pos += len;
    });
    out.sort(byTime);
    return { events: out, length: pos, markers };
  }

  /** transport track table from session lanes, plus optional extra tracks */
  function tracksFor(session, extra) {
    const tracks = {};
    for (const lane of session.lanes) {
      tracks[lane.id] = {
        patch: lane.patch,
        volume: lane.volume,
        mute: !!lane.mute,
        solo: !!lane.solo,
        channel: lane.channel,
      };
    }
    return Object.assign(tracks, extra || {});
  }

  /** build a transport sequence (applies session swing) */
  function sequence(session, events, length, loop, extraTracks) {
    const swung = applySwing(events, session.swing).sort(byTime);
    return {
      bpm: session.bpm,
      length,
      loop: !!loop,
      events: swung,
      tracks: tracksFor(session, extraTracks),
    };
  }

  /** chord markers for drawing: [{ start, end, label }] */
  function chordLabels(prog, tonic, scale, length) {
    const out = [];
    let t = 0;
    let guard = 0;
    while (t < length && guard++ < 512) {
      const c = T.chordAt(prog, t);
      const end = Math.min(c.end, length);
      out.push({ start: t, end, label: T.chordName(c.chord.deg, tonic, scale), roman: T.roman(c.chord.deg, scale) });
      t = end;
    }
    return out;
  }

  Odd.render = {
    partEvents, applySwing, sectionTarget, sectionEvents, songEvents, tracksFor, sequence, chordLabels, byTime,
  };
})(globalThis.Odd = globalThis.Odd || {});
