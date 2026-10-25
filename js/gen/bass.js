/* Oddition — bass generator.
 *
 * Picks a style rhythm (sparse -> busy by density), then fills each onset
 * with a chord-aware tone: root, fifth, octave or an approach note into the
 * next chord. Notes that ring across a chord change are split so the bass
 * always lands on the new root.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const STEP = T.STEP, BAR = T.BAR;
  const LO = 28; // E1
  const HI = 55; // G3
  const ROOT_HI = 50;

  function parsePattern(chars) {
    const out = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === '.' || ch === '-') continue;
      let len = 1;
      while (i + len < chars.length && chars[i + len] === '-') len++;
      out.push({ step: i, type: ch, len });
    }
    return out;
  }

  function generate(ctx) {
    const { u, params, bars, total, occ } = ctx;
    const S = ctx.style.bass;
    const density = params.density, complexity = params.complexity, movement = params.movement;
    const rRhythm = ctx.rngFor('rhythm');
    const rNotes = ctx.rngFor('notes');
    const rVary = ctx.rngFor('vary');

    const pool = S.rhythms.map((s) => u.steps(s));
    const idx = u.densityIndex(pool.length, density, rRhythm, 0.5);
    const main = pool[idx];
    const altIdx = u.clamp(idx + (idx === pool.length - 1 ? -1 : 1), 0, pool.length - 1);
    const alt = pool[altIdx];

    const center = S.center;
    const pitch = (deg, acc) => ctx.pitch(deg, acc);

    // one register choice per chord occurrence, led smoothly from the last
    const rootCache = new Map();
    let prevRootPitch = center;
    function rootFor(o) {
      if (rootCache.has(o.index)) return rootCache.get(o.index);
      const target = 0.6 * center + 0.4 * prevRootPitch;
      const d = ctx.placeDeg(o.deg, target, LO, ROOT_HI);
      prevRootPitch = pitch(d);
      rootCache.set(o.index, d);
      return d;
    }
    occ.forEach(rootFor);

    function occAt(t) {
      const tt = T.mod(t, total);
      for (const o of occ) if (tt >= o.start && tt < o.end) return o;
      return occ[occ.length - 1];
    }
    function nextOcc(o) { return occ[(o.index + 1) % occ.length]; }

    function inRange(d) { const p = pitch(d); return p >= LO && p <= HI; }

    function toneFor(type, o, t, len, prevPitch) {
      const root = rootFor(o);
      const nxt = nextOcc(o);
      const nextRoot = rootFor(nxt);
      const nearEnd = t + len * STEP >= o.end - STEP;
      if (type === 'A' && (!nearEnd || nxt.deg === o.deg)) type = rNotes.chance(0.5) ? '5' : 'O';
      if (type === 'x') {
        type = rNotes.weighted([
          ['R', 0.45], ['O', 0.15 + 0.25 * movement], ['5', 0.2 + 0.1 * movement],
          ['3', 0.1 * movement], ['N', 0.1 * movement],
        ]);
      }
      switch (type) {
        case 'O': {
          if (inRange(root + 7)) return { deg: root + 7, acc: 0 };
          return { deg: inRange(root - 7) ? root - 7 : root, acc: 0 };
        }
        case 'L': return { deg: inRange(root - 7) ? root - 7 : root, acc: 0 };
        case '5': {
          const up = root + 4, down = root - 3;
          const cands = [up, down].filter(inRange);
          if (!cands.length) return { deg: root, acc: 0 };
          cands.sort((a, b) => Math.abs(pitch(a) - prevPitch) - Math.abs(pitch(b) - prevPitch));
          return { deg: cands[0], acc: 0 };
        }
        case '3': {
          const d = inRange(root + 2) ? root + 2 : root - 5;
          return { deg: inRange(d) ? d : root, acc: 0 };
        }
        case 'N': {
          const d = root + (rNotes.chance(0.5) ? 1 : -1);
          return { deg: inRange(d) ? d : root, acc: 0 };
        }
        case 'A': {
          const target = pitch(nextRoot);
          const fromBelow = prevPitch <= target;
          if (rNotes.chance(S.chromatic * (0.5 + movement))) {
            // a semitone from the next root as it really sounds (bVI is flat)
            const rootAcc = nxt.alt[T.mod(nextRoot, 7)];
            return { deg: nextRoot, acc: rootAcc + (fromBelow ? -1 : 1), fix: true };
          }
          const d = nextRoot + (fromBelow ? -1 : 1);
          return { deg: inRange(d) ? d : nextRoot, acc: 0 };
        }
        case 'R':
        default:
          return { deg: root, acc: 0 };
      }
    }

    // listening: lock onto the section's kick, or play between the kicks
    const B = Odd.band;
    const lock = ctx.band && B ? B.lockOf(ctx.styleId) : 0;
    const hearKick = !!(lock && ctx.band.kick.some((x) => x > 0.5));
    const rLock = hearKick ? ctx.rngFor('listen') : null;
    let locked = 0;

    const notes = [];
    let prevPitch = pitch(rootFor(occ[0]));
    for (let b = 0; b < bars; b++) {
      const barStart = b * BAR;
      const isTurn = bars >= 2 && ((b + 1) % 4 === 0 || b === bars - 1);
      let pat = main;
      if (isTurn && rVary.chance(complexity * 0.6)) pat = alt;
      else if (!isTurn && b > 0 && rVary.chance(complexity * 0.12)) pat = alt;
      const seg = pat.length > 16 ? pat.slice((b % 2) * 16, (b % 2) * 16 + 16) : pat;
      const onsets = parsePattern(seg);

      // small rhythmic edits on later bars
      if (b > 0 && complexity > 0.2) {
        if (rVary.chance(complexity * 0.25) && !seg.slice(13).some((c) => c !== '.' && c !== '-')) {
          // a pickup into the next bar
          const last = onsets[onsets.length - 1];
          if (!last || last.step + last.len <= 14) onsets.push({ step: 15, type: 'A', len: 1 });
        }
        if (onsets.length > 2 && rVary.chance((1 - density) * 0.25)) {
          const k = 1 + rVary.int(0, onsets.length - 2);
          if (onsets[k].step % 8 !== 0) onsets.splice(k, 1);
        }
      }

      let bar = onsets;
      if (hearKick) {
        const kick = [];
        for (let s = 0; s < 16; s++) kick.push(ctx.band.kick[(b * 16 + s) % ctx.band.steps]);
        const isChange = (step) => occ.some((o) => o.start === barStart + step * STEP);
        const r = B.lockBass(onsets, kick, lock, rLock, isChange);
        bar = r.onsets;
        locked += r.moved;
      }

      for (const on of bar) {
        const t = barStart + on.step * STEP;
        if (t >= total) continue;
        const o = occAt(t);
        let type = on.type;
        if (t === o.start && type !== 'L') type = 'R';
        else if (type === 'R' && rNotes.chance(movement * 0.3)) type = rNotes.pick(['O', '5']);
        const tone = toneFor(type, o, t, on.len, prevPitch);
        let d = Math.max(30, Math.round(on.len * STEP * S.gate));
        if (on.len * STEP >= 4 * STEP && S.gate >= 0.95) d = on.len * STEP - 10;
        let v = S.vel + (on.step % 4 === 0 ? 6 : on.step % 2 === 0 ? 0 : -8) + rVary.int(-4, 4);
        if (t === o.start) v += 4;
        notes.push({ t, d, v, deg: tone.deg, acc: tone.acc, fix: tone.fix });
        prevPitch = pitch(tone.deg, tone.acc);
      }
    }

    notes.sort((a, b) => a.t - b.t);
    if (locked) ctx.heard.push(lock > 0 ? 'Locks to the kick' : 'Plays between the kicks');

    // 808 slides: a short octave pickup before some long notes
    if (S.glide && complexity > 0.2) {
      const extra = [];
      for (let i = 1; i < notes.length; i++) {
        const n = notes[i], prev = notes[i - 1];
        if (n.d < 6 * STEP || n.t - (prev.t + prev.d) < 2 * STEP) continue;
        if (!rVary.chance(complexity * 0.3)) continue;
        const up = inRange(n.deg + 7) ? n.deg + 7 : n.deg;
        extra.push({ t: n.t - STEP, d: STEP - 10, v: n.v - 14, deg: up, acc: 0 });
      }
      notes.push(...extra);
      notes.sort((a, b) => a.t - b.t);
    }

    // monophonic: a note stops when the next one starts
    for (let i = 0; i < notes.length - 1; i++) {
      const gap = notes[i + 1].t - notes[i].t;
      if (notes[i].d > gap) notes[i].d = Math.max(15, gap - 10);
    }

    // never ring a non-chord tone across a chord change
    const out = [];
    for (const n of notes) {
      let cur = n;
      for (const o of occ) {
        if (o.start <= cur.t || o.start >= cur.t + cur.d) continue;
        // keeps ringing only as a chord tone the new chord does not alter differently
        const k = T.mod(cur.deg, 7);
        if (T.isChordTone(cur.deg, o.deg, 3) && !cur.fix && o.alt[k] === ctx.altAt(cur.t)[k]) continue;
        const remain = cur.t + cur.d - o.start;
        cur.d = o.start - cur.t;
        out.push(cur);
        cur = remain >= 2 * STEP ? { t: o.start, d: remain, v: cur.v, deg: rootFor(o), acc: 0 } : null;
        if (!cur) break;
      }
      if (cur) out.push(cur);
    }
    return out;
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.roles = Odd.gen.roles || {};
  Odd.gen.roles.bass = {
    aspects: ['vary', 'notes', 'rhythm'],
    params: [
      { key: 'movement', label: 'Movement', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'Fifths, octave jumps and approach notes' },
    ],
    generate,
  };
})(globalThis.Odd = globalThis.Odd || {});
