/* Oddition — arpeggio generator.
 *
 * Spells each chord as a pattern (up, down, up-down, converge, pedal, random)
 * at a fixed rate across one to three octaves. The register is voice-led from
 * chord to chord, a one-bar gap mask gives it a groove, and accents follow the
 * rate's natural grouping.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const BAR = T.BAR;
  const LO = 48, HI = 96;

  const RATES = { '8': 240, '8t': 160, '16': 120, '16t': 80, '32': 60 };

  function sequence(pattern, n, rng, length) {
    const idx = [];
    if (n <= 0) return idx;
    if (n === 1) { for (let i = 0; i < length; i++) idx.push(0); return idx; }
    let cycle;
    switch (pattern) {
      case 'down': cycle = []; for (let i = n - 1; i >= 0; i--) cycle.push(i); break;
      case 'updown': cycle = []; for (let i = 0; i < n; i++) cycle.push(i); for (let i = n - 2; i > 0; i--) cycle.push(i); break;
      case 'converge': {
        cycle = []; let a = 0, b = n - 1;
        while (a <= b) { cycle.push(a); if (a !== b) cycle.push(b); a++; b--; }
        break;
      }
      case 'pedal': cycle = []; for (let i = 1; i < n; i++) cycle.push(0, i); break;
      case 'random': {
        let last = -1;
        for (let i = 0; i < length; i++) {
          let k = rng.int(0, n - 1);
          if (k === last) k = (k + 1 + rng.int(0, n - 2)) % n;
          idx.push(k); last = k;
        }
        return idx;
      }
      case 'up':
      default: cycle = []; for (let i = 0; i < n; i++) cycle.push(i); break;
    }
    for (let i = 0; i < length; i++) idx.push(cycle[i % cycle.length]);
    return idx;
  }

  function generate(ctx) {
    const { u, params, total, occ } = ctx;
    const S = ctx.style.arp;
    const density = params.density, complexity = params.complexity;
    const rPattern = ctx.rngFor('pattern');
    const rAccent = ctx.rngFor('accent');
    const rGaps = ctx.rngFor('gaps');

    const rateKey = params.rate && params.rate !== 'auto' ? params.rate : S.rate;
    const stepT = RATES[rateKey] || 120;
    let pattern = params.pattern && params.pattern !== 'auto' ? params.pattern : S.pattern;
    if ((!params.pattern || params.pattern === 'auto') && rPattern.chance(0.3)) {
      pattern = rPattern.pick(['up', 'down', 'updown', 'converge', 'pedal']);
    }
    const span = u.clamp(Math.round(params.span || 2), 1, 3);
    const gate = u.clamp(params.gate == null ? 0.6 : params.gate, 0.05, 1);
    const seventh = rPattern.chance(S.seventh);

    // a repeating one-bar mask: which steps sound
    const perBar = Math.round(BAR / stepT);
    const play = u.clamp(0.4 + density * 1.2, 0.3, 1);
    const mask = [];
    for (let i = 0; i < perBar; i++) mask.push(i === 0 || rGaps.chance(play));
    // occasional octave lifts on fixed positions
    const lifts = new Set();
    for (let i = 1; i < perBar; i++) if (rAccent.chance(complexity * 0.12)) lifts.add(i);
    const group = stepT === 160 || stepT === 80 ? 3 : 4;
    const accents = rAccent.chance(complexity * 0.7) && group === 4 ? [0, 3, 6] : null; // 3+3+2 feel

    const notes = [];
    let prevLow = S.low;
    for (const o of occ) {
      const classes = [0, 2, 4];
      if (seventh && ctx.goodSeventh(o.deg)) classes.push(6);
      // anchor the chord root near the previous chord's position
      const root = ctx.placeDeg(o.deg, prevLow, LO, 72);
      prevLow = ctx.pitch(root);
      const tones = [];
      for (let oct = 0; oct < span; oct++) for (const c of classes) tones.push(root + c + 7 * oct);
      tones.push(root + 7 * span);
      const inRange = tones.filter((d) => ctx.pitch(d) <= HI);
      const steps = Math.ceil((o.end - o.start) / stepT);
      const seq = sequence(pattern, inRange.length, rPattern, steps);
      for (let i = 0; i < steps; i++) {
        const t = o.start + i * stepT;
        if (t >= o.end || t >= total) break;
        const barPos = Math.round((t % BAR) / stepT) % perBar;
        if (!mask[barPos] && i !== 0) continue;
        let deg = inRange[seq[i]];
        if (lifts.has(barPos) && ctx.pitch(deg + 7) <= HI) deg += 7;
        let v = 78;
        if (i === 0) v += 12;
        if (accents) { if (accents.includes(barPos % 8)) v += 14; }
        else if (barPos % group === 0) v += 10;
        v += rAccent.int(-4, 4);
        const d = Math.max(15, Math.round(stepT * gate));
        notes.push({ t, d: Math.min(d, o.end - t), v, deg, acc: 0 });
      }
    }
    return notes;
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.roles = Odd.gen.roles || {};
  Odd.gen.roles.arp = {
    aspects: ['gaps', 'accent', 'pattern'],
    params: [
      {
        key: 'rate', label: 'Rate', type: 'select', default: 'auto', hint: 'Speed of the arpeggio',
        options: [
          { value: 'auto', label: 'Style default' },
          { value: '8', label: '1/8' },
          { value: '8t', label: '1/8 triplet' },
          { value: '16', label: '1/16' },
          { value: '16t', label: '1/16 triplet' },
          { value: '32', label: '1/32' },
        ],
      },
      {
        key: 'pattern', label: 'Pattern', type: 'select', default: 'auto', hint: 'Order the chord notes are played in',
        options: [
          { value: 'auto', label: 'Style default' },
          { value: 'up', label: 'Up' },
          { value: 'down', label: 'Down' },
          { value: 'updown', label: 'Up and down' },
          { value: 'converge', label: 'Converge' },
          { value: 'pedal', label: 'Pedal' },
          { value: 'random', label: 'Random' },
        ],
      },
      { key: 'span', label: 'Octaves', type: 'range', min: 1, max: 3, step: 1, default: 2, hint: 'How many octaves each chord covers' },
      { key: 'gate', label: 'Gate', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.6, hint: 'Short and plucky to smooth and legato' },
    ],
    generate,
  };
})(globalThis.Odd = globalThis.Odd || {});
