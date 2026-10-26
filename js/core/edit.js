/* Oddition — small edits to a take: keep some bars while re-rolling the
 * rest, and add, remove or re-weight single notes.
 *
 * Edits happen on what the user sees: the booth draws a take refitted to
 * the section it is auditioned over, so a note added at a pitch on screen
 * is turned back into a scale degree in the part's own frame (the inverse
 * of Odd.render's refit) before it is stored.
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const BAR = T.BAR;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function vel(x) { return Math.max(1, Math.min(127, Math.round(x))); }

  function sameProg(a, b) {
    return JSON.stringify((a || []).map((c) => [c.deg, c.acc || 0, c.mode || '', c.beats])) ===
      JSON.stringify((b || []).map((c) => [c.deg, c.acc || 0, c.mode || '', c.beats]));
  }

  /**
   * A new take that keeps the old take's notes in `locked` bars (a Set or
   * array of bar indices) and the new take's notes everywhere else. Notes
   * are cut at the border so neither side spills into the other's bars.
   * Returns null when the two can't be joined (different role, length or
   * chords): the caller then uses the new take as it is.
   */
  function splice(oldPart, newPart, locked) {
    const lock = new Set(locked || []);
    if (!lock.size || !oldPart || !newPart) return null;
    if (oldPart.role !== newPart.role || oldPart.bars !== newPart.bars) return null;
    const pitched = !T.isDrumRole(newPart.role);
    if (pitched && !(sameProg(oldPart.ctx && oldPart.ctx.prog, newPart.ctx && newPart.ctx.prog) &&
      oldPart.ctx.tonic === newPart.ctx.tonic && oldPart.ctx.scale === newPart.ctx.scale)) return null;
    const total = newPart.bars * BAR;
    const barOf = (t) => Math.floor(t / BAR);
    // end of the run of bars on the same side as bar b
    const runEnd = (b, isLocked) => {
      let e = b + 1;
      while (e * BAR < total && lock.has(e) === isLocked) e++;
      return e * BAR;
    };
    const take = (n, isLocked) => {
      const end = runEnd(barOf(n.t), isLocked);
      return Object.assign({}, n, { d: Math.max(15, Math.min(n.d, end - n.t)) });
    };
    const notes = [];
    for (const n of oldPart.notes) if (lock.has(barOf(n.t))) notes.push(take(n, true));
    for (const n of newPart.notes) if (!lock.has(barOf(n.t))) notes.push(take(n, false));
    notes.sort((a, b) => a.t - b.t || (a.p != null ? a.p - b.p : a.deg - b.deg));
    const out = clone(newPart);
    out.notes = notes;
    // a pitched part keeps the register it was written in
    if (pitched) out.base = oldPart.base;
    out.locked = [...lock].sort((a, b) => a - b);
    return out;
  }

  /** the refit shift (in scale steps) the booth applies to a note at tick t */
  function shiftAt(part, target, t) {
    if (T.isDrumRole(part.role) || target.refit === false) return 0;
    const srcProg = part.ctx && part.ctx.prog && part.ctx.prog.length ? part.ctx.prog : [{ deg: 0, beats: 4 }];
    const tgtProg = target.prog && target.prog.length ? target.prog : srcProg;
    const sc = T.chordAt(srcProg, t).chord;
    const gc = T.chordAt(tgtProg, t).chord;
    return { delta: T.wrapDelta(gc.deg - sc.deg), sc, gc };
  }

  /**
   * A note drawn at pitch p (as the booth shows it over `target`) in the
   * part's own terms: { t, d, v, p } for drums, { t, d, v, deg, acc } otherwise.
   */
  function toPartNote(part, target, n) {
    if (T.isDrumRole(part.role)) return { t: n.t, d: n.d, v: vel(n.v), p: n.p };
    const tonic = target.tonic != null ? target.tonic : part.ctx.tonic;
    const scale = target.scale || part.ctx.scale;
    const base = (part.base != null ? part.base : 60) + 12 * (target.oct || 0);
    const shown = T.degreeOf(n.p, tonic, scale, base);
    const sh = shiftAt(part, target, n.t);
    if (!sh) return { t: n.t, d: n.d, v: vel(n.v), deg: shown.deg, acc: shown.acc };
    const deg = shown.deg - sh.delta;
    // an accidental that is just the target chord's colour follows the chord;
    // anything else is deliberate and stays
    const srcScale = part.ctx && part.ctx.scale ? part.ctx.scale : scale;
    let acc = shown.acc;
    if (acc === T.chordAlt(sh.gc, scale)[T.mod(shown.deg, 7)]) acc = T.chordAlt(sh.sc, srcScale)[T.mod(deg, 7)];
    return { t: n.t, d: n.d, v: vel(n.v), deg, acc };
  }

  /** add a note drawn on screen at { t, d, p, v } */
  function addNote(part, target, n) {
    const out = clone(part);
    const total = out.bars * BAR;
    const t = Math.max(0, Math.min(total - 15, Math.round(n.t)));
    const d = Math.max(15, Math.min(total - t, Math.round(n.d)));
    out.notes.push(toPartNote(out, target, { t, d, v: n.v == null ? 96 : n.v, p: n.p }));
    out.notes.sort((a, b) => a.t - b.t || (a.p != null ? a.p - b.p : a.deg - b.deg));
    // a note on the same pitch that overlaps the new one is cut short
    const key = (x) => (x.p != null ? 'p' + x.p : x.deg + ':' + (x.acc || 0));
    const last = new Map();
    for (const x of out.notes) {
      const k = key(x);
      const prev = last.get(k);
      if (prev && prev.t + prev.d > x.t) prev.d = Math.max(15, x.t - prev.t);
      last.set(k, x);
    }
    out.notes = out.notes.filter((x, i, arr) => !(i > 0 && arr[i - 1].t === x.t && key(arr[i - 1]) === key(x)));
    return out;
  }

  function removeNote(part, index) {
    const out = clone(part);
    if (index >= 0 && index < out.notes.length) out.notes.splice(index, 1);
    return out;
  }

  function setVelocity(part, index, v) {
    const out = clone(part);
    if (out.notes[index]) out.notes[index].v = vel(v);
    return out;
  }

  Odd.edit = { splice, toPartNote, addNote, removeNote, setVelocity, sameProg };
})(globalThis.Odd = globalThis.Odd || {});
