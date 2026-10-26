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

  /*
   * Forms: the same part, played another way. This is how a section sets up
   * material that another pays off: an intro outlines or teases the chorus
   * hook, a pre-chorus loops a fragment of it, an outro plays it half-time.
   *   full      as written
   *   outline   only the notes on the beat, each held until the next
   *   tease     the first bar of every two, then silence
   *   fragment  the first bar, over and over
   *   half      half-time: the first half of the part stretched to fill it
   * Each kept note remembers where it came from (st), so it still refits
   * against the chord it was written over.
   */
  const FORMS = ['full', 'outline', 'tease', 'fragment', 'half'];
  const FORM_LABELS = { full: 'As written', outline: 'Outline', tease: 'Tease', fragment: 'Fragment', half: 'Half-time' };
  const FORM_HINTS = {
    full: 'The part as written.',
    outline: 'Only the notes on the beat, held: the bones of the idea.',
    tease: 'Plays the first bar of every two, then leaves a gap.',
    fragment: 'Loops just the first bar.',
    half: 'Half speed: the first half of the part stretched over the whole.',
  };

  function formNotes(notes, form, partLen, isDrum) {
    if (!form || form === 'full') return notes;
    const BAR = T.BAR, BEAT = T.BEAT;
    const tag = (n, t, d, v) => Object.assign({}, n, { t, d, st: n.st != null ? n.st : n.t }, v != null ? { v } : {});
    if (form === 'half') {
      return notes.filter((n) => n.t < partLen / 2).map((n) => tag(n, n.t * 2, Math.max(15, n.d * 2)));
    }
    if (form === 'fragment') {
      const cell = partLen >= 2 * BAR ? BAR : Math.max(BEAT * 2, partLen / 2);
      const first = notes.filter((n) => n.t < cell);
      const out = [];
      for (let k = 0; k * cell < partLen; k++) {
        for (const n of first) {
          const t = n.t + k * cell;
          if (t < partLen) out.push(tag(n, t, Math.min(n.d, cell - n.t)));
        }
      }
      return out;
    }
    if (form === 'tease') {
      if (partLen < 2 * BAR) return notes.filter((n) => n.t < partLen / 2).map((n) => tag(n, n.t, Math.min(n.d, partLen / 2 - n.t)));
      return notes.filter((n) => Math.floor(n.t / BAR) % 2 === 0).map((n) => {
        const barEnd = (Math.floor(n.t / BAR) + 1) * BAR;
        return tag(n, n.t, Math.min(n.d, barEnd - n.t));
      });
    }
    if (form === 'outline') {
      const onBeat = notes.filter((n) => n.t % BEAT === 0);
      if (isDrum) return onBeat.map((n) => tag(n, n.t, n.d));
      // hold each onset group until the next one (at most a bar)
      const starts = [...new Set(onBeat.map((n) => n.t))].sort((a, b) => a - b);
      const next = new Map(starts.map((t, i) => [t, i + 1 < starts.length ? starts[i + 1] : partLen]));
      return onBeat.map((n) => tag(n, n.t, Math.max(n.d, Math.min(BAR, next.get(n.t) - n.t))));
    }
    return notes;
  }

  /**
   * target: { tonic, scale, prog, length (ticks), oct (octave shift), refit (default true), form }
   */
  function partEvents(part, target) {
    const tg = target || {};
    const partLen = Math.max(1, part.bars || 1) * T.BAR;
    const length = tg.length != null ? tg.length : partLen;
    const isDrum = T.isDrumRole(part.role);
    const base = (part.base != null ? part.base : 60) + 12 * (tg.oct || 0);
    const refit = tg.refit !== false;
    const srcProg = part.ctx && part.ctx.prog && part.ctx.prog.length ? part.ctx.prog : FALLBACK_PROG;
    const tgtProg = tg.prog && tg.prog.length ? tg.prog : srcProg;
    const tonic = tg.tonic != null ? tg.tonic : (part.ctx ? part.ctx.tonic : 0);
    const scale = tg.scale || (part.ctx ? part.ctx.scale : 'major');
    const notes = formNotes(part.notes || [], tg.form, partLen, isDrum);
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
        let acc = n.acc || 0;
        if (refit) {
          const sc = T.chordAt(srcProg, n.st != null ? n.st : n.t).chord;
          const gc = T.chordAt(tgtProg, t).chord;
          deg += T.wrapDelta(gc.deg - sc.deg);
          // a note that took its chord's accidental (F# over V/V) takes the
          // new chord's instead; a deliberate chromatic note keeps its own
          const srcScale = part.ctx && part.ctx.scale ? part.ctx.scale : scale;
          if (acc === T.chordAlt(sc, srcScale)[T.mod(n.deg, 7)]) acc = T.chordAlt(gc, scale)[T.mod(deg, 7)];
        }
        out.push({ t, d, p: T.pitchOf(deg, acc, tonic, scale, base), v: n.v });
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
   * The windows [start, end) in ticks where a slot plays, inside a rendered
   * section of `length` ticks. A section rendered longer than itself (the
   * booth loops it under a longer take) repeats the slot's bars each pass.
   * null: the slot plays throughout.
   */
  function spanWindows(section, slot, length) {
    const bars = section.bars;
    const from = Math.max(0, Math.min(bars, Math.round(Number(slot.from) || 0)));
    const to = slot.to == null ? bars : Math.max(from, Math.min(bars, Math.round(Number(slot.to))));
    if (from === 0 && to === bars) return null;
    const out = [];
    const secLen = bars * T.BAR;
    for (let k = 0; k * secLen < length; k++) {
      const a = k * secLen + from * T.BAR;
      const b = Math.min(length, k * secLen + to * T.BAR);
      if (b > a) out.push([a, b]);
    }
    return out;
  }

  /** song shape is on for this session (and the shape module is loaded) */
  function shaping(session) {
    return !!(Odd.shape && Odd.shape.settings(session).on);
  }

  /**
   * Events for every filled slot of a section.
   * opts: { offset, length, exclude (lane id to leave out), only (lane id),
   *         shape (default true: apply the section's energy and dynamics),
   *         energy, nextEnergy (override; nextEnergy null = no ramp) }
   */
  function sectionEvents(session, section, opts) {
    const o = opts || {};
    const offset = o.offset || 0;
    const tgt = sectionTarget(session, section, o.length);
    const shape = o.shape !== false && shaping(session);
    const energy = o.energy != null ? o.energy : shape ? Odd.shape.energyOf(section) : 0.5;
    const out = [];
    for (const lane of session.lanes) {
      if (o.exclude && lane.id === o.exclude) continue;
      if (o.only && lane.id !== o.only) continue;
      const slot = section.slots && section.slots[lane.id];
      if (!slot || !slot.part) continue;
      // the bars this slot plays; a part that comes in late starts from its own top
      const wins = spanWindows(section, slot, tgt.length);
      const look = { oct: slot.oct || 0, refit: slot.refit !== false, form: slot.form };
      let evs;
      if (!wins) evs = partEvents(slot.part, Object.assign({}, tgt, look));
      else {
        evs = [];
        for (const [a, b] of wins) {
          const sub = Object.assign({}, tgt, look, { prog: T.sliceProg(tgt.prog, a, b - a), length: b - a });
          for (const e of partEvents(slot.part, sub)) { e.t += a; evs.push(e); }
        }
      }
      if (!evs.length) continue;
      for (const e of evs) {
        e.t += offset;
        e.track = lane.id;
      }
      if (shape) {
        evs = Odd.shape.shapeLane(evs, {
          role: lane.role, energy, start: offset, end: offset + tgt.length, curve: section.curve,
          nextEnergy: o.nextEnergy == null ? null : o.nextEnergy,
        });
      }
      for (const e of evs) out.push(e);
    }
    return out;
  }

  /** whole arrangement: { events, length, markers: [{ index, sectionId, name, start, end, energy, entry }] } */
  function songEvents(session, opts) {
    const o = opts || {};
    const shape = shaping(session);
    let out = [];
    const markers = [];
    let entries;
    if (Odd.shape) {
      entries = Odd.shape.plan(session);
    } else {
      entries = [];
      let pos = 0;
      session.arrangement.forEach((sid, index) => {
        const section = session.sections.find((s) => s.id === sid);
        if (!section) return;
        const len = section.bars * T.BAR;
        entries.push({ index, section, sectionId: sid, start: pos, end: pos + len, energy: 0.5, entry: 'none' });
        pos += len;
      });
    }
    entries.forEach((en, i) => {
      const next = entries[i + 1];
      const evs = sectionEvents(session, en.section, {
        offset: en.start,
        energy: en.energy,
        nextEnergy: next ? next.energy : null,
      });
      for (const e of evs) out.push(e);
      markers.push({ index: en.index, sectionId: en.sectionId, name: en.section.name, start: en.start, end: en.end, energy: en.energy, entry: en.entry });
    });
    if (shape) out = Odd.shape.transitions(session, out, entries);
    if (o.only) out = out.filter((e) => e.track === o.only);
    out.sort(byTime);
    const length = entries.length ? entries[entries.length - 1].end : 0;
    return { events: out, length, markers };
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

  /** role of every track: session lanes, plus extra tracks that name one */
  function roleMap(session, extraTracks) {
    const roles = {};
    for (const lane of session.lanes) roles[lane.id] = lane.role;
    for (const k in extraTracks || {}) if (extraTracks[k] && extraTracks[k].role) roles[k] = extraTracks[k].role;
    return roles;
  }

  /**
   * Performance pass shared by playback and export: swing, then human feel.
   * opts: { roles ({ track: role }), role (fallback), length }
   */
  function perform(session, events, opts) {
    const o = opts || {};
    const swung = applySwing(events, session ? session.swing : 0);
    let out = swung;
    if (Odd.shape && session) {
      const roles = o.roles || roleMap(session);
      out = Odd.shape.humanize(swung, {
        amount: Odd.shape.settings(session).humanize,
        roleOf: (track) => roles[track] || o.role || 'lead',
        length: o.length,
      });
    }
    return out.sort(byTime);
  }

  /** build a transport sequence (applies session swing and feel) */
  function sequence(session, events, length, loop, extraTracks) {
    return {
      bpm: session.bpm,
      length,
      loop: !!loop,
      events: perform(session, events, { roles: roleMap(session, extraTracks), length }),
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
      out.push({ start: t, end, label: T.chordName(c.chord, tonic, scale), roman: T.roman(c.chord, scale) });
      t = end;
    }
    return out;
  }

  Odd.render = {
    FORMS, FORM_LABELS, FORM_HINTS, formNotes,
    partEvents, applySwing, sectionTarget, spanWindows, sectionEvents, songEvents, tracksFor, roleMap, perform, sequence, chordLabels, byTime,
  };
})(globalThis.Odd = globalThis.Odd || {});
