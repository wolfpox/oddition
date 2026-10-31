/* Oddition — moves: the small, named things a line can do at the spots that allow them.
 *
 * Like the moves of a chess piece, each one has a rule for where it's
 * legal: repeats on the long notes, a grace note into the strong ones, a
 * pickup into a note after a rest. A move never changes when the line's own
 * notes start or which pitch they are, so the line stays itself. Moves only
 * shape lengths and loudness, or add short notes around the line's own.
 *
 * A line's moves: mv = { [id]: { a, skip } }, a the amount (an index into
 * the move's stops), skip the onsets (in steps) it leaves out. A move is
 * played at every spot that allows it, except those.
 *
 *   spots(id, notes, cx) -> the onsets where it's legal
 *   apply(notes, mv, cx) -> the notes with the moves played
 *
 * notes are { s, d, w, m, ... } in steps, sorted by s (a melody's carry
 * deg, a riff's x). cx = { T: steps in the loop, vel: the velocity of each
 * weight [ghost, plain, accent], step(n, k): the note k scale steps from n,
 * as { deg, m }, or null on a line with one pitch (a riff's rhythm) }.
 * Added notes carry orn: 'grace' | 'pickup' | 'repeat'; a changed loudness
 * is n.v.
 */
(function (Odd) {
  'use strict';

  // in the order the carousel shows them: long notes, strong notes, the ones between, then the gaps
  const LIST = [
    { id: 'repeat', name: 'Repeats', line: 'Each long note broken into repeats.', stops: ['Twice', 'In eighths', 'In sixteenths'], def: 0 },
    { id: 'short', name: 'Clipped', line: 'Notes cut short, detached.', stops: ['A bit', 'Half', 'Clipped'], def: 1, not: 'tie' },
    { id: 'grace', name: 'Grace notes', line: 'A quick flick into each strong note.', stops: ['Quick', 'Lazy'], def: 0, pitched: true },
    { id: 'accent', name: 'Accents', line: 'Leans on the notes on the beat.', stops: ['A touch', 'Firm', 'Hard'], def: 1 },
    { id: 'ghost', name: 'Ghost notes', line: 'The notes between the beats, barely there.', stops: ['Softer', 'Ghostly', 'Barely there'], def: 1 },
    { id: 'tie', name: 'Tied over', line: 'Each note held into the next.', stops: ['Halfway', 'All the way'], def: 1, not: 'short' },
    { id: 'pickup', name: 'Pickups', line: 'Steps up into each note after a rest.', hitLine: 'A hit before each one after a rest.', stops: ['One note', 'Two', 'Three'], def: 0 },
  ];
  const MOVE = {};
  LIST.forEach((x) => { MOVE[x.id] = x; });

  const CLIP = [0.75, 0.5, 0.25], TIE = [0.5, 1], GRACE = [0.5, 1], LIFT = [10, 20, 32], HUSH = [0.75, 0.58, 0.4];

  function amountOf(id, mv) { const L = MOVE[id], a = mv[id].a | 0; return Math.max(0, Math.min(L.stops.length - 1, a)); }
  function velOf(n, cx) { return n.v != null ? n.v : cx.vel[n.w] || cx.vel[1]; }

  /** where a move is legal on a line: the onsets of the notes it would play on */
  function spots(id, ns, cx) {
    const L = MOVE[id];
    if (!L || (L.pitched && !cx.step)) return [];
    const n = ns.length, T = cx.T, out = [];
    const end = (i) => ns[i].s + ns[i].d;
    const after = (i) => (i < n - 1 ? ns[i + 1].s : T) - end(i);
    const before = (i) => ns[i].s - (i > 0 ? end(i - 1) : 0);
    ns.forEach((x, i) => {
      let ok = false;
      if (id === 'repeat') ok = x.d >= 4;
      // the last note keeps its length and its loudness: it's where the line lands
      else if (id === 'short') ok = x.d >= 2 && i < n - 1;
      else if (id === 'grace') ok = x.w === 2 && x.d >= 2 && x.s >= 1;
      else if (id === 'accent') ok = x.w === 1;
      else if (id === 'ghost') ok = x.w === 0 && i > 0 && i < n - 1;
      else if (id === 'tie') ok = i < n - 1 && after(i) >= 1;
      else if (id === 'pickup') ok = before(i) >= 2;
      if (ok) out.push(x.s);
    });
    return out;
  }

  /** the line with its moves played; the notes it came with keep their onsets and pitches */
  function apply(notes, mv, cx) {
    if (!mv || !notes.length) return notes;
    const ids = LIST.map((x) => x.id).filter((id) => mv[id] && (!MOVE[id].pitched || cx.step));
    if (!ids.length) return notes;
    const on = {};
    ids.forEach((id) => {
      const skip = mv[id].skip || [];
      on[id] = {};
      spots(id, notes, cx).forEach((s) => { if (skip.indexOf(s) < 0) on[id][s] = 1; });
    });
    const at = (id, s) => !!(on[id] && on[id][s]);
    const ns = notes.map((n) => Object.assign({}, n));
    ns.forEach((n, i) => {
      // lengths: clipped or tied over (never both: clipped wins)
      if (at('short', n.s)) n.d = Math.max(0.5, n.d * CLIP[amountOf('short', mv)]);
      else if (at('tie', n.s)) {
        const next = i < ns.length - 1 ? notes[i + 1].s : cx.T;
        n.d += (next - (n.s + n.d)) * TIE[amountOf('tie', mv)];
      }
      // loudness
      if (at('accent', n.s)) n.v = Math.min(127, velOf(n, cx) + LIFT[amountOf('accent', mv)]);
      if (at('ghost', n.s)) n.v = Math.max(12, Math.round(velOf(n, cx) * HUSH[amountOf('ghost', mv)]));
    });
    const out = [];
    ns.forEach((n, i) => {
      const prev = i > 0 ? notes[i - 1] : null;
      if (at('pickup', n.s)) {
        // up into it by step, a sixteenth each, as many as the rest has room for
        const room = Math.floor(n.s - (prev ? prev.s + prev.d : 0));
        const k = Math.min(amountOf('pickup', mv) + 1, room);
        for (let j = k; j >= 1; j--) {
          const p = cx.step ? cx.step(n, -j) : null;
          out.push(Object.assign({}, n, p, { s: n.s - j, d: 1, w: 0, v: Math.round(velOf(n, cx) * 0.72), orn: 'pickup' }));
        }
      }
      if (at('grace', n.s)) {
        // just before the beat, from the side the line comes from, in what room there is after the note before
        const g = Math.min(GRACE[amountOf('grace', mv)], prev ? (n.s - prev.s) / 2 : n.s);
        const side = prev && prev.m > n.m ? 1 : -1;
        out.push(Object.assign({}, n, cx.step(n, side), { s: n.s - g, d: g, w: 0, v: Math.max(30, Math.round(velOf(n, cx) * 0.7)), orn: 'grace' }));
      }
      if (at('repeat', n.s)) {
        const a = amountOf('repeat', mv), r = a === 0 ? n.d / 2 : a === 1 ? 2 : 1;
        const k = Math.floor(n.d / r + 1e-6);
        if (k >= 2) {
          for (let j = 0; j < k; j++) {
            const x = Object.assign({}, n, { s: n.s + j * r, d: j === k - 1 ? n.d - j * r : r });
            if (j) Object.assign(x, { w: Math.min(n.w, 1), v: Math.round(velOf(n, cx) * 0.82), orn: 'repeat' });
            out.push(x);
          }
          return;
        }
      }
      out.push(n);
    });
    out.sort((a, b) => a.s - b.s);
    // nothing rings into the note after it, and nothing leaves the loop
    for (let i = 0; i < out.length - 1; i++) {
      const room = out[i + 1].s - out[i].s;
      if (out[i].d > room) out[i].d = Math.max(0.25, room);
    }
    return out.filter((n) => n.s >= 0 && n.s < cx.T).map((n) => { if (n.s + n.d > cx.T) n.d = cx.T - n.s; return n; });
  }

  Odd.moves = { LIST, MOVE, spots, apply };
})(globalThis.Odd = globalThis.Odd || {});
