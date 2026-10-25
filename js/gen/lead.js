/* Oddition — lead melody generator.
 *
 * Builds a short motif (rhythm from style "cells" + a contoured, mostly
 * stepwise pitch walk), then develops it across the part with a phrase form
 * such as A A' B A'': literal repeats re-fitted to the chords, diatonic
 * sequences, new endings, answers and inversions. Strong beats land on chord
 * tones, phrases breathe, and the part ends on a cadence.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const STEP = T.STEP, BEAT = T.BEAT, BAR = T.BAR;
  const P_LO = 60, P_HI = 93;

  // rhythm cells: notes as [start, length] in ticks inside the cell
  const CELLS = {
    q: { beats: 1, notes: [[0, 480]], dense: 0 },
    h: { beats: 2, notes: [[0, 960]], dense: -1 },
    w: { beats: 4, notes: [[0, 1920]], dense: -1 },
    dq: { beats: 2, notes: [[0, 720], [720, 240]], dense: 0 },
    e: { beats: 1, notes: [[0, 240], [240, 240]], dense: 1 },
    e1: { beats: 1, notes: [[0, 240]], dense: 0 },
    off: { beats: 1, notes: [[240, 240]], dense: 0 },
    s: { beats: 1, notes: [[0, 120], [120, 120], [240, 120], [360, 120]], dense: 2 },
    es: { beats: 1, notes: [[0, 240], [240, 120], [360, 120]], dense: 1.5 },
    se: { beats: 1, notes: [[0, 120], [120, 120], [240, 240]], dense: 1.5 },
    dot: { beats: 1, notes: [[0, 360], [360, 120]], dense: 1 },
    sync: { beats: 1, notes: [[0, 120], [120, 240], [360, 120]], dense: 1.5 },
    anti: { beats: 1, notes: [[360, 120]], dense: 0 },
    trip: { beats: 1, notes: [[0, 160], [160, 160], [320, 160]], dense: 1.5 },
    rest: { beats: 1, notes: [], dense: -1 },
  };

  const PENTA = { major: [0, 1, 2, 4, 5], minor: [0, 2, 3, 4, 6] };

  function makeForm(n, rep, rng) {
    if (n <= 1) return ['A'];
    if (n === 2) return rng.weighted([[['A', 'A2'], 1 + rep * 2], [['A', 'B'], 1.5 - rep]]);
    const f4 = rng.weighted([
      [['A', 'A2', 'B', 'A3'], 3],
      [['A', 'B', 'A', 'B2'], 2],
      [['A', 'A', 'A2', 'B'], 0.5 + rep * 2.5],
      [['A', 'A2', 'A', 'A3'], 0.3 + rep * 3],
      [['A', 'B', 'C', 'A2'], 0.2 + (1 - rep) * 2],
    ]);
    if (n === 4) return f4;
    // longer parts: repeat the 4-phrase with fresh endings
    const out = [];
    const phrases = n / 4;
    let next = 4;
    for (let p = 0; p < phrases; p++) {
      const ph = f4.slice();
      if (p > 0) {
        const last = ph[3][0];
        ph[3] = last + next++;
        if (p % 2 === 1 && rep < 0.4 && ph[2] === 'B') ph[2] = 'C';
      }
      out.push(...ph);
    }
    return out;
  }

  function generate(ctx) {
    const { u, params, bars, total } = ctx;
    const L = ctx.style.lead;
    const density = params.density, complexity = params.complexity;
    const space = params.space, rep = params.repetition;
    const rRhythm = ctx.rngFor('motif-rhythm');
    const rPitch = ctx.rngFor('motif-pitch');
    const rForm = ctx.rngFor('form');
    const rDev = ctx.rngFor('develop');
    const rDetail = ctx.rngFor('detail');

    const family = (T.SCALES[ctx.scale] || T.SCALES.minor).family;
    const penta = rForm.chance(L.penta) ? PENTA[family] : null;

    // register
    const [pLo, pHi] = ctx.degBounds(P_LO, P_HI);
    const span = Math.max(4, Math.round(L.span * (0.6 + 0.8 * params.range)));
    let lo = Math.max(pLo, L.center - Math.floor(span / 2));
    let hi = Math.min(pHi, lo + span);
    if (hi - lo < 4) lo = Math.max(pLo, hi - 4);
    const clampDeg = (d) => u.clamp(d, lo, hi);

    const rootAt = (t) => ctx.chordAt(t).chord.deg;
    const stable = (d, root, t) => {
      const rel = T.mod(d - root, 7);
      if (rel === 0 || rel === 2 || rel === 4) return true;
      if (!L.stableExt) return false;
      const alt = ctx.altAt(t);
      return (rel === 6 && ctx.goodSeventh(root, alt)) || (rel === 1 && ctx.goodNinth(root, alt));
    };
    const inPenta = (d) => !penta || penta.includes(T.mod(d, 7));

    function fitNote(d, t, dur, prev) {
      const root = rootAt(t);
      const strong = t % (2 * BEAT) === 0 || dur >= BEAT || (t % BEAT === 0 && dur >= 2 * STEP);
      if (strong) {
        if (stable(d, root, t)) return d;
        const cands = [d - 1, d + 1, d - 2, d + 2].filter((x) => x >= lo && x <= hi && stable(x, root, t));
        if (!cands.length) return d;
        cands.sort((a, b) => Math.abs(a - d) - Math.abs(b - d) || Math.abs(a - prev) - Math.abs(b - prev));
        return cands[0];
      }
      if (!T.isChordTone(d, root, 3) && !inPenta(d)) {
        const cands = [d - 1, d + 1].filter((x) => x >= lo && x <= hi && (inPenta(x) || T.isChordTone(x, root, 3)));
        if (cands.length) {
          cands.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
          return cands[0];
        }
      }
      return d;
    }

    // ---- rhythm
    function cellWeights() {
      const w = [];
      const f = 0.35 + 1.3 * density;
      for (const [id, base] of Object.entries(L.cells)) {
        const c = CELLS[id];
        if (!c) continue;
        let x = base;
        if (c.dense > 0) x *= Math.pow(f, c.dense);
        else if (c.dense < 0) x *= 1.65 - 1.3 * density;
        if (id === 'rest') x *= 0.3 + 1.8 * space;
        w.push([id, Math.max(0.01, x)]);
      }
      return w;
    }
    const weights = cellWeights();
    const minNotes = L.cells.w ? 1 : 2;

    function buildRhythm(beats, rng) {
      let best = null;
      for (let attempt = 0; attempt < 14; attempt++) {
        const notes = [];
        let beat = 0;
        while (beat < beats) {
          const avail = weights.filter(([id]) => {
            const c = CELLS[id];
            if (c.beats > beats - beat) return false;
            if (c.beats === 2 && beat % 2 !== 0) return false;
            if (c.beats === 4 && beat % 4 !== 0) return false;
            return true;
          });
          const id = rng.weighted(avail);
          const c = CELLS[id];
          for (const [st, len] of c.notes) notes.push({ t: beat * BEAT + st, d: len });
          beat += c.beats;
        }
        best = notes;
        const need = Math.max(minNotes, Math.round(beats * 0.4 * (0.5 + density)));
        if (notes.length >= need && notes.length <= beats * 4) break;
      }
      // let some notes ring into the following rest
      for (let i = 0; i < best.length; i++) {
        const n = best[i];
        const nextT = i + 1 < best.length ? best[i + 1].t : beats * BEAT;
        if (nextT > n.t + n.d && rng.chance(L.sustain)) n.d = Math.min(nextT - n.t, n.d + BEAT);
      }
      return best;
    }

    // ---- pitch walk
    function contourUp(kind, pos) {
      switch (kind) {
        case 'rise': return 0.68;
        case 'fall': return 0.32;
        case 'valley': return pos < 0.5 ? 0.3 : 0.72;
        case 'wave': return 0.5 + 0.28 * Math.sin(pos * Math.PI * 2);
        case 'arch':
        default: return pos < 0.55 ? 0.72 : 0.3;
      }
    }

    function walk(rhythm, segStart, startDeg, rng, prevDeg) {
      const contour = rng.pick(['arch', 'arch', 'rise', 'fall', 'wave', 'valley']);
      const out = [];
      let prev = prevDeg != null ? prevDeg : startDeg;
      let lastInt = 0;
      rhythm.forEach((nt, i) => {
        const pos = rhythm.length > 1 ? i / (rhythm.length - 1) : 0.5;
        let d;
        if (i === 0 && startDeg != null) d = startDeg;
        else {
          let up = contourUp(contour, pos);
          up += ((lo + hi) / 2 - prev) / (hi - lo + 1) * 0.6;
          up = u.clamp(up, 0.1, 0.9);
          let interval;
          if (Math.abs(lastInt) >= 3 && rng.chance(0.75)) {
            interval = -Math.sign(lastInt) * (rng.chance(0.8) ? 1 : 2);
          } else {
            const size = rng.weighted([
              [0, L.rep], [1, 0.5], [2, 0.22],
              [3, (0.06 + 0.08 * complexity) * L.leap],
              [4, (0.03 + 0.05 * complexity) * L.leap],
              [5, 0.02 * complexity * L.leap],
            ]);
            interval = size * (rng.chance(up) ? 1 : -1);
          }
          d = prev + interval;
        }
        if (d > hi) d = hi - (d - hi);
        if (d < lo) d = lo + (lo - d);
        d = clampDeg(d);
        d = fitNote(d, segStart + nt.t, nt.d, prev);
        out.push(d);
        lastInt = d - prev;
        prev = d;
      });
      return out;
    }

    function startNear(target, segStart, rng) {
      const root = rootAt(segStart);
      const cands = [];
      for (let d = lo; d <= hi; d++) if (T.isChordTone(d, root, 3)) cands.push(d);
      if (!cands.length) return clampDeg(target);
      cands.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
      return rng.pick(cands.slice(0, Math.min(3, cands.length)));
    }

    // ---- form and motifs
    const motifBars = L.motifBars === 2 && bars >= 2 ? 2 : 1;
    const segBeats = motifBars * 4;
    const segLen = motifBars * BAR;
    const segCount = Math.max(1, Math.round(bars / motifBars));
    const form = makeForm(segCount, rep, rForm);

    const motifs = {};   // letter -> { notes: [{t,d,deg}], origin }
    const variants = {}; // label -> notes
    let prevDeg = L.center;

    function baseMotif(letter, segStart) {
      if (motifs[letter]) return motifs[letter];
      const isA = letter === 'A';
      const rhythm = buildRhythm(segBeats, isA ? rRhythm : rForm);
      const start = startNear(isA ? L.center + rPitch.int(-1, 2) : prevDeg + rForm.int(-2, 2), segStart, isA ? rPitch : rForm);
      const degs = walk(rhythm, segStart, start, isA ? rPitch : rForm, null);
      motifs[letter] = { notes: rhythm.map((n, i) => ({ t: n.t, d: n.d, deg: degs[i] })), origin: rootAt(segStart) };
      return motifs[letter];
    }

    function makeVariant(label, segStart) {
      if (variants[label]) return variants[label];
      const m = baseMotif(label[0], segStart);
      let notes = m.notes.map((n) => Object.assign({}, n));
      const kind = rDev.weighted([
        ['ending', 3], ['rhythm', 1 + 2 * complexity], ['sequence', 1.5],
        ['answer', 1 + 2 * complexity], ['invert', 0.5 * complexity],
      ]);
      if (kind === 'ending' && notes.length >= 2) {
        const k = Math.min(notes.length - 1, rDev.int(1, 3));
        const from = notes.length - k;
        const tail = notes.slice(from);
        const degs = walk(tail, segStart, null, rDev, notes[from - 1].deg);
        tail.forEach((n, i) => { n.deg = degs[i]; });
      } else if (kind === 'rhythm') {
        const i = rDev.int(0, notes.length - 1);
        const n = notes[i];
        if (n.d >= 2 * STEP && rDev.chance(0.6)) {
          const half = Math.round(n.d / 2 / STEP) * STEP || STEP;
          n.d = half;
          notes.splice(i + 1, 0, { t: n.t + half, d: half, deg: n.deg + (rDev.chance(0.5) ? 1 : -1) });
        } else if (i + 1 < notes.length) {
          n.d = notes[i + 1].t + notes[i + 1].d - n.t;
          notes.splice(i + 1, 1);
        }
      } else if (kind === 'sequence') {
        const s = rDev.pick([1, -1, 2, -2]);
        notes.forEach((n) => { n.deg += s; });
      } else if (kind === 'answer') {
        const halfT = segLen / 2;
        const keep = notes.filter((n) => n.t < halfT);
        const last = keep.length ? keep[keep.length - 1].deg : notes[0].deg;
        keep.forEach((n) => { if (n.t + n.d > halfT) n.d = halfT - n.t; });
        const rhythm = buildRhythm(segBeats / 2, rDev).map((n) => ({ t: n.t + halfT, d: n.d }));
        const degs = walk(rhythm, segStart + halfT, null, rDev, last);
        notes = keep.concat(rhythm.map((n, i) => ({ t: n.t, d: n.d, deg: degs[i] })));
      } else if (kind === 'invert') {
        const pivot = notes[0].deg;
        notes.forEach((n) => { n.deg = 2 * pivot - n.deg; });
      }
      variants[label] = notes;
      return notes;
    }

    const out = [];
    form.forEach((label, si) => {
      const segStart = si * segLen;
      if (segStart >= total) return;
      const m = baseMotif(label[0], segStart);
      const src = label.length === 1 ? m.notes : makeVariant(label, segStart);
      const literal = !rDev.chance(0.4 * (1 - rep * 0.5));
      const delta = literal ? 0 : T.wrapDelta(rootAt(segStart) - m.origin);
      let seg = src.map((n) => ({ t: segStart + n.t, d: n.d, deg: n.deg + delta }));
      // keep the segment in range by octaves before nudging single notes
      const maxD = Math.max(...seg.map((n) => n.deg)), minD = Math.min(...seg.map((n) => n.deg));
      if (maxD > hi && minD - 7 >= lo) seg.forEach((n) => { n.deg -= 7; });
      else if (minD < lo && maxD + 7 <= hi) seg.forEach((n) => { n.deg += 7; });
      let prev = prevDeg;
      for (const n of seg) {
        n.deg = fitNote(clampDeg(n.deg), n.t, n.d, prev);
        prev = n.deg;
      }
      // response phrases breathe at the end
      const isFinal = si === form.length - 1;
      if (si % 2 === 1 && !isFinal && seg.length > 1 && rDetail.chance(space * 0.6)) {
        const cut = segStart + segLen * 0.75;
        const kept = seg.filter((n) => n.t < cut);
        if (kept.length) seg = kept;
      }
      // phrase-end cadences
      const endsPhrase = isFinal || (bars >= 8 && ((si + 1) * motifBars) % 4 === 0);
      if (endsPhrase && seg.length) {
        // cadence on the last note that starts by the final beat; later notes are pickups
        const segEnd = Math.min(total, segStart + segLen);
        let ci = seg.length - 1;
        while (ci > 0 && seg[ci].t > segEnd - BEAT) ci--;
        const last = seg[ci];
        const root = rootAt(last.t);
        let cls;
        if (isFinal) cls = T.isChordTone(0, root, 3) ? 0 : root;
        else {
          const tones = [root, root + 2, root + 4].map((x) => T.mod(x, 7)).filter((x) => x !== 0);
          cls = tones.includes(4) ? 4 : tones.includes(1) ? 1 : tones[0];
        }
        const before = ci > 0 ? seg[ci - 1].deg : prevDeg;
        let best = last.deg, bestDist = Infinity;
        for (let d = lo; d <= hi; d++) {
          if (T.mod(d - cls, 7) !== 0) continue;
          const dist = Math.abs(d - last.deg) + 0.5 * Math.abs(d - before);
          if (dist < bestDist) { best = d; bestDist = dist; }
        }
        last.deg = best;
        if (isFinal) {
          const nextT = ci + 1 < seg.length ? seg[ci + 1].t : total - STEP;
          last.d = Math.max(last.d, Math.min(nextT - last.t, 2 * BEAT));
        }
      }
      for (const n of seg) out.push(n);
      if (seg.length) prevDeg = seg[seg.length - 1].deg;
    });

    out.sort((a, b) => a.t - b.t);

    // break up runs of three or more identical pitches (chord-tone snapping can pile notes up)
    if (L.rep < 0.25) {
      const isStrong = (n) => n.t % (2 * BEAT) === 0 || n.d >= BEAT;
      for (let i = 2; i < out.length; i++) {
        const a = out[i - 2], b = out[i - 1], c = out[i];
        if (a.deg !== b.deg || b.deg !== c.deg) continue;
        const target = !isStrong(b) ? b : !isStrong(c) ? c : null;
        if (!target) continue;
        const root = rootAt(target.t);
        const next = out.slice(i + 1).find((n) => n.deg !== c.deg);
        const dir = next ? Math.sign(next.deg - c.deg) || 1 : (rDetail.chance(0.5) ? 1 : -1);
        const cands = [target.deg + dir, target.deg - dir, target.deg + 2 * dir]
          .filter((d) => d >= lo && d <= hi && (inPenta(d) || T.isChordTone(d, root, 3)));
        if (cands.length) target.deg = cands[0];
      }
    }

    // ornaments: a few weak-beat notes move to a neighbour
    for (let i = 1; i < out.length - 1; i++) {
      const n = out[i];
      if (n.t % BEAT === 0 || n.d >= BEAT) continue;
      if (!rDetail.chance(0.12 + 0.12 * complexity)) continue;
      const root = rootAt(n.t);
      const cands = [n.deg + 1, n.deg - 1].filter((d) => d >= lo && d <= hi && d !== out[i - 1].deg && (inPenta(d) || T.isChordTone(d, root, 3)));
      if (cands.length) n.deg = rDetail.pick(cands);
    }

    // a touch of chromatic approach into strong-beat targets
    const notes = out.map((n) => ({ t: n.t, d: n.d, deg: n.deg, acc: 0 }));
    if (complexity > 0.3) {
      for (let i = 0; i < notes.length - 1; i++) {
        const a = notes[i], b = notes[i + 1];
        if (b.t % (2 * BEAT) !== 0 || a.t % BEAT === 0 || b.t - a.t > 2 * STEP) continue;
        if (a.deg !== b.deg - 1) continue;
        // semitones as they sound over each note's chord
        const bAcc = ctx.altAt(b.t)[T.mod(b.deg, 7)];
        const aAcc = ctx.altAt(a.t)[T.mod(b.deg - 1, 7)];
        const whole = T.degToSemis(b.deg, ctx.scale) + bAcc - (T.degToSemis(b.deg - 1, ctx.scale) + aAcc) === 2;
        if (whole && rDetail.chance(complexity * 0.3)) { a.deg = b.deg; a.acc = bAcc - 1; a.fix = true; }
      }
    }

    // monophonic, gated, with accents
    const highest = Math.max(...notes.map((n) => n.deg));
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const nextT = i + 1 < notes.length ? notes[i + 1].t : total;
      const room = nextT - n.t;
      n.d = Math.min(n.d, room);
      n.d = Math.max(30, Math.round(n.d * (i === notes.length - 1 ? Math.max(L.gate, 0.9) : L.gate)));
      if (n.d > room) n.d = room;
      let v = 86;
      if (n.t % BAR === 0) v += 14;
      else if (n.t % (2 * BEAT) === 0) v += 10;
      else if (n.t % BEAT === 0) v += 6;
      else if (n.t % (2 * STEP) !== 0) v -= 6;
      if (n.deg === highest) v += 4;
      if (i === notes.length - 1) v += 4;
      n.v = v + rDetail.int(-4, 4);
    }
    return notes;
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.roles = Odd.gen.roles || {};
  Odd.gen.roles.lead = {
    aspects: ['detail', 'develop', 'form', 'motif-pitch', 'motif-rhythm'],
    params: [
      { key: 'range', label: 'Range', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'How far the melody roams' },
      { key: 'space', label: 'Space', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4, hint: 'Rests and breathing room' },
      { key: 'repetition', label: 'Repetition', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'Repeat the hook or keep introducing new ideas' },
    ],
    generate,
  };
})(globalThis.Odd = globalThis.Odd || {});
