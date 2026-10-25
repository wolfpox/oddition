/* Oddition — drum generator.
 *
 * 1. Sample a 1- or 2-bar core groove from the style's step grids.
 * 2. Repeat it across the part, alternating with a lightly mutated twin bar.
 * 3. Add ghost notes, hi-hat rolls (trap, dnb) and fills at phrase ends.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const STEP = T.STEP, BEAT = T.BEAT, BAR = T.BAR;
  const CRASH = 49, KICK = 36, SNARE = 38, CLAP = 39, RIM = 37, SHAKER = 70;
  const TOMS = [50, 47, 45];

  function parseGrid(str, steps) {
    return steps(str).map((ch) => {
      if (ch === 'x') return { prob: 1, anchor: true, accent: false };
      if (ch === 'X') return { prob: 1, anchor: true, accent: true };
      if (ch >= '1' && ch <= '9') return { prob: (ch.charCodeAt(0) - 48) / 10, anchor: false, accent: false };
      return { prob: 0, anchor: false, accent: false };
    });
  }

  function laneVelocity(lane, cell, step) {
    let v = lane.v;
    if (cell.accent) v += 10;
    if (lane.hat || lane.perc) {
      if (step % 4 === 0) v += 8;
      else if (step % 2 === 1) v -= 12;
    }
    if (lane.kick && !cell.anchor) v -= 8;
    return v;
  }

  function generate(ctx) {
    const { u, params, bars, total } = ctx;
    const S = ctx.style.drums;
    const density = params.density;
    const complexity = params.complexity;
    const fills = params.fills;
    const ghosts = params.ghosts;
    const mult = 0.35 + 1.3 * density;

    const coreRng = ctx.rngFor('core');
    const varyRng = ctx.rngFor('vary');
    const fillRng = ctx.rngFor('fill');

    const lanes = S.lanes.map((l) => Object.assign({}, l, { cells: parseGrid(l.grid, u.steps) }));
    const coreBars = lanes.some((l) => l.cells.length > 16) ? 2 : 1;

    // listening: the kick leans onto the bass (or away from it in styles
    // where the bass plays between the kicks)
    const B = Odd.band;
    const lock = ctx.band && B && ctx.band.bassOn.some((x) => x > 0) ? B.lockOf(ctx.styleId) : 0;
    const bassAt = lock ? B.fold(ctx.band.bassOn, coreBars * 16) : null;
    let leaned = 0;
    function kickProb(cell, barIdx, s) {
      const b = bassAt[(barIdx * 16 + s) % bassAt.length];
      if (lock > 0) return b > 0 ? Math.min(0.97, cell.prob + lock * 0.5 * b) : cell.prob * (1 - lock * 0.4);
      return b > 0 ? cell.prob * (1 + lock * b) : cell.prob;
    }

    // --- core groove: per bar, a Map step -> { lane, v } list
    function sampleBar(barIdx, rng, baseBar, mutRate) {
      const hits = [];
      for (const lane of lanes) {
        for (let s = 0; s < 16; s++) {
          const cell = lane.cells[(barIdx * 16 + s) % lane.cells.length];
          if (cell.prob <= 0) {
            // a kick under a strong bass note the grid leaves empty
            if (lock > 0 && lane.kick && !baseBar && s % 2 === 0 && bassAt[(barIdx * 16 + s) % bassAt.length] > 0.5 && rng.chance(lock * 0.3)) {
              hits.push({ lane, step: s, v: laneVelocity(lane, { accent: false, anchor: false }, s), sub: 0 });
              leaned++;
            }
            continue;
          }
          let on;
          const prob = lock && lane.kick && !cell.anchor ? kickProb(cell, barIdx, s) : cell.prob;
          if (cell.anchor) on = true;
          else if (baseBar && !rng.chance(mutRate)) on = baseBar.some((h) => h.lane === lane && h.step === s);
          else on = rng.chance(Math.min(0.97, prob * mult));
          if (on && prob > cell.prob) leaned++;
          if (on) hits.push({ lane, step: s, v: laneVelocity(lane, cell, s), sub: 0 });
        }
      }
      // never an empty bar: keep the most likely hit of the first lane
      if (!hits.length && !baseBar) {
        const lane = lanes[0];
        let best = 0;
        for (let s = 0; s < 16; s++) {
          if (lane.cells[(barIdx * 16 + s) % lane.cells.length].prob > lane.cells[(barIdx * 16 + best) % lane.cells.length].prob) best = s;
        }
        const cell = lane.cells[(barIdx * 16 + best) % lane.cells.length];
        hits.push({ lane, step: best, v: laneVelocity(lane, cell, best), sub: 0 });
      }
      // open hat chokes the closed hat on the same step
      const opens = new Set(hits.filter((h) => h.lane.open).map((h) => h.step));
      return hits.filter((h) => !(h.lane.hat && !h.lane.open && opens.has(h.step)));
    }

    function addGhosts(hits, rng) {
      const amount = S.ghost * ghosts * 2;
      if (amount <= 0) return hits;
      const snareSteps = new Set(hits.filter((h) => h.lane.snare || h.lane.layer).map((h) => h.step));
      const ghostLane = { name: 'ghost', p: S.ghostNote || SNARE, v: 30, len: 60, ghost: true };
      let added = 0;
      for (const s of [3, 6, 7, 9, 11, 14, 15]) {
        if (snareSteps.has(s) || snareSteps.has(s - 1) && rng.chance(0.5)) continue;
        if (added >= 3) break;
        if (rng.chance(amount * 0.35)) {
          hits.push({ lane: ghostLane, step: s, v: 22 + rng.int(0, 18), sub: 0 });
          added++;
        }
      }
      return hits;
    }

    const core = [];
    for (let b = 0; b < coreBars; b++) core.push(addGhosts(sampleBar(b, coreRng, null, 0), coreRng));
    if (coreBars === 1 && bars >= 2) {
      // a twin bar: same groove with a few hits moved
      const twin = sampleBar(0, coreRng, core[0], 0.06 + 0.2 * complexity);
      const ghostKeep = core[0].filter((h) => h.lane.ghost);
      core.push(twin.concat(ghostKeep));
    }

    // --- fills schedule
    const fillPlan = new Map(); // bar -> beats of fill (0.5 | 1 | 2)
    for (let b = 0; b < bars; b++) {
      const n = b + 1;
      const isEnd = b === bars - 1;
      let size = 0;
      if (bars >= 4 && n % 4 === 0) {
        if (fillRng.chance(0.2 + 0.7 * fills)) {
          size = (n % 8 === 0 || isEnd) && fills > 0.5 && fillRng.chance(0.6) ? 2 : 1;
        }
      } else if (bars === 2 && isEnd) {
        if (fillRng.chance(0.1 + 0.5 * fills)) size = fills > 0.7 && fillRng.chance(0.5) ? 1 : 0.5;
      } else if (bars >= 4 && n % 2 === 0) {
        if (fillRng.chance(fills * 0.3)) size = 0.5;
      } else if (bars === 1) {
        if (fillRng.chance(fills * 0.2)) size = 0.5;
      }
      if (size) fillPlan.set(b, size);
    }

    const notes = [];
    const push = (t, p, v, d) => notes.push({ t, p, v, d: d || 60 });

    for (let b = 0; b < bars; b++) {
      const barStart = b * BAR;
      const pattern = core[b % core.length];
      let hits = pattern.map((h) => Object.assign({}, h));

      // later passes drift slightly
      if (b >= core.length && complexity > 0) {
        const rate = 0.1 * complexity;
        hits = hits.filter((h) => h.lane.ghost || h.lane.snare || !varyRng.chance(rate) || h.step % 4 === 0);
        for (const lane of lanes) {
          if (!(lane.kick || lane.hat || lane.perc)) continue;
          for (let s = 0; s < 16; s++) {
            const cell = lane.cells[(b * 16 + s) % lane.cells.length];
            if (cell.prob <= 0 || cell.anchor) continue;
            if (hits.some((h) => h.lane === lane && h.step === s)) continue;
            if (varyRng.chance(rate * cell.prob)) hits.push({ lane, step: s, v: laneVelocity(lane, cell, s), sub: 0 });
          }
        }
      }

      const fillSize = fillPlan.get(b) || 0;
      const fillStartStep = fillSize ? 16 - fillSize * 4 : 16;

      // trap / dnb hat rolls
      const rollNotes = [];
      if (S.rolls > 0) {
        let rolls = 0;
        for (let beat = 0; beat < 4; beat++) {
          if (beat * 4 + 4 > fillStartStep) break;
          if (rolls >= 2) break;
          if (!varyRng.chance(S.rolls * (0.25 + 0.75 * complexity) * 0.5)) continue;
          rolls++;
          const hatLane = lanes.find((l) => l.hat && !l.open);
          if (!hatLane) break;
          const kind = varyRng.weighted([['half32', 3], ['trip16', 2 + 2 * complexity], ['trip8', 1.5], ['full32', complexity]]);
          let start = barStart + beat * BEAT, n, gap;
          if (kind === 'half32') { start += BEAT / 2; n = 4; gap = 60; }
          else if (kind === 'trip16') { n = 6; gap = 80; }
          else if (kind === 'trip8') { n = 3; gap = 160; }
          else { n = 8; gap = 60; }
          const from = start - barStart, to = from + n * gap;
          hits = hits.filter((h) => !(h.lane === hatLane && h.step * STEP >= from && h.step * STEP < to));
          const up = varyRng.chance(0.65);
          for (let i = 0; i < n; i++) {
            const k = n > 1 ? i / (n - 1) : 1;
            const v = hatLane.v + (up ? -22 + 30 * k : 8 - 26 * k);
            rollNotes.push({ t: start + i * gap, p: hatLane.p, v, d: Math.min(gap, 50) });
          }
        }
      }

      // remove what the fill replaces
      if (fillSize) {
        const kind = fillRng.pick(S.fills);
        hits = hits.filter((h) => {
          if (h.step < fillStartStep) return true;
          if (fillSize < 1) return !(h.lane.snare || h.lane.layer || h.lane.ghost);
          if (h.lane.kick) return !(S.kickDrop && kind === 'clap');
          if (kind === 'soft') return !h.lane.perc;
          return !(h.lane.snare || h.lane.layer || h.lane.ghost || h.lane.hat);
        });
        writeFill(kind, barStart + fillStartStep * STEP, fillSize, fillRng, complexity, push);
      }

      for (const h of hits) {
        const v = h.v + varyRng.int(-5, 5) + (complexity > 0.6 && varyRng.chance(0.1) ? 8 : 0);
        push(barStart + h.step * STEP, h.lane.p, v, h.lane.len);
      }
      for (const n of rollNotes) notes.push(n);

      // crash after a full fill
      const prevFill = fillPlan.get(b - 1) || 0;
      if (b > 0 && prevFill >= 1 && fillRng.chance(Math.min(0.9, S.crash * 2.2))) push(barStart, CRASH, 100, BEAT * 2);
    }
    if (bars >= 4 && fillRng.chance(S.crash * (0.6 + fills * 0.6))) push(0, CRASH, 96, BEAT * 2);

    if (leaned) ctx.heard.push(lock > 0 ? 'Kick leans on the bass' : 'Kick keeps clear of the bass');
    return notes;
  }

  /** write a fill of `beats` beats starting at tick `t0` */
  function writeFill(kind, t0, beats, rng, complexity, push) {
    const n = Math.round(beats * 4); // 16th steps
    const ramp = (i, lo, hi) => lo + (hi - lo) * (n > 1 ? i / (n - 1) : 1);
    switch (kind) {
      case 'toms': {
        for (let i = 0; i < n; i++) {
          const tom = TOMS[Math.min(TOMS.length - 1, Math.floor((i * TOMS.length) / n))];
          if (n >= 8 && i % 4 === 0) push(t0 + i * STEP, KICK, 96);
          push(t0 + i * STEP, i === 0 && n >= 4 ? SNARE : tom, ramp(i, 88, 112), 110);
        }
        break;
      }
      case 'kick': {
        const pat = rng.pick([[KICK, SNARE], [KICK, KICK, SNARE, 0], [SNARE, KICK]]);
        for (let i = 0; i < n; i++) {
          const p = pat[i % pat.length];
          if (!p) continue;
          push(t0 + i * STEP, p, p === SNARE ? ramp(i, 78, 112) : 100, 100);
        }
        if (n >= 2) push(t0 + (n - 1) * STEP, SNARE, 114, 100);
        break;
      }
      case 'clap': {
        for (let i = 0; i < n; i++) {
          if (n >= 8 && i < 4 && i % 2 === 1) continue; // 8ths, then 16ths
          push(t0 + i * STEP, CLAP, ramp(i, 60, 112), 100);
        }
        break;
      }
      case 'roll': {
        // snare roll: 16ths, finishing in 32nds or 16th-triplets
        const tail = Math.min(n, 4);
        for (let i = 0; i < n - tail; i++) push(t0 + i * STEP, SNARE, ramp(i, 50, 80), 60);
        const tailStart = t0 + (n - tail) * STEP;
        const gap = rng.chance(0.5 + complexity * 0.3) ? 60 : 80;
        const count = Math.floor((tail * STEP) / gap);
        for (let i = 0; i < count; i++) {
          push(tailStart + i * gap, SNARE, 50 + (60 * i) / Math.max(1, count - 1), Math.min(gap, 50));
        }
        push(t0, KICK, 108, 240);
        break;
      }
      case 'break': {
        const acc = [112, 38, 70, 42, 100, 48, 86, 118];
        for (let i = 0; i < n; i++) {
          if (i % 4 === 0 && rng.chance(0.6)) push(t0 + i * STEP, KICK, 100);
          if (i % 4 === 2 && rng.chance(0.3)) continue;
          push(t0 + i * STEP, SNARE, acc[i % acc.length], 80);
        }
        break;
      }
      case 'soft': {
        for (let i = 0; i < n; i++) push(t0 + i * STEP, SHAKER, ramp(i, 18, 58), 60);
        push(t0 + (n - 1) * STEP, RIM, 54, 60);
        break;
      }
      case 'snare':
      default: {
        for (let i = 0; i < n; i++) {
          if (n >= 8 && i < 4 && i % 2 === 1 && complexity < 0.6) continue;
          push(t0 + i * STEP, SNARE, ramp(i, 58, 114), 100);
        }
        if (n >= 4) push(t0, KICK, 100);
        break;
      }
    }
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.roles = Odd.gen.roles || {};
  Odd.gen.roles.drums = {
    aspects: ['fill', 'vary', 'core'],
    params: [
      { key: 'fills', label: 'Fills', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'How often phrase ends get a fill' },
      { key: 'ghosts', label: 'Ghost notes', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'Quiet in-between snare hits' },
    ],
    generate,
    writeFill, // also used by Odd.shape for fills into a new section
  };
})(globalThis.Odd = globalThis.Odd || {});
