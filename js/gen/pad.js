/* Oddition — pad generator.
 *
 * Long, wide voicings that sustain through each chord. Common tones are tied
 * across chord changes at low density, inner voices can suspend and resolve
 * (Movement), and dense settings re-attack long chords.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const BEAT = T.BEAT;
  const LO = 48, HI = 84;

  // degree offsets from the chord root
  const TEMPLATES = {
    open: [0, 4, 9],            // root, fifth, tenth
    open7: [0, 4, 9, 13],       // + seventh on top
    add9: [0, 4, 8, 9],         // root, fifth, ninth, tenth
    sus2: [0, 1, 4, 7],         // root, second, fifth, octave
    shimmer: [0, 4, 9, 11, 15], // wide and airy
  };

  function generate(ctx) {
    const { u, params, total, occ } = ctx;
    const S = ctx.style.pad;
    const density = params.density, complexity = params.complexity, movement = params.movement;
    const rVoice = ctx.rngFor('voicing');
    const rMotion = ctx.rngFor('motion');

    const primary = rVoice.pick(S.templates);
    let prev = null;
    const plans = occ.map((o) => {
      let name = primary;
      if (rVoice.chance(complexity * 0.3)) name = rVoice.pick(Object.keys(TEMPLATES));
      let offs = TEMPLATES[name].slice();
      // seventh on top only when the style leans that way
      if (name === 'open7' && !rVoice.chance(0.4 + S.color * 0.6)) offs = TEMPLATES.open.slice();
      // drop clashing colour tones (minor-major 7ths, b9 / #9) for this chord
      offs = offs.filter((x) => T.mod(x, 7) !== 6 || ctx.goodSeventh(o.deg));
      offs = Array.from(new Set(offs.map((x) => (T.mod(x, 7) === 1 && !ctx.goodNinth(o.deg) ? x - 1 : x))));
      let best = null, bestCost = Infinity;
      while (!best && offs.length >= 2) {
        for (let k = -4; k <= 4; k++) {
          const root = o.deg + 7 * k;
          const degs = offs.map((x) => root + x);
          const ps = degs.map((d) => ctx.pitch(d));
          if (ps[0] < LO || ps[ps.length - 1] > HI) continue;
          let cost = Math.abs(ps[0] - S.center);
          if (prev) for (const p of ps) cost += 0.5 * Math.min(...prev.map((q) => Math.abs(p - q)));
          if (cost < bestCost) { bestCost = cost; best = degs; }
        }
        if (!best) offs.pop();
      }
      if (!best) best = [ctx.placeDeg(o.deg, 52, LO, 64)];
      prev = best.map((d) => ctx.pitch(d));
      return { o, degs: best };
    });

    // segments: each chord, re-attacked every 4 beats when dense
    const notes = [];
    const open = new Map(); // deg -> note currently ringing
    const tie = density < 0.55;
    for (const plan of plans) {
      const { o, degs } = plan;
      const len = o.end - o.start;
      const every = density > 0.7 && len > 4 * BEAT ? 4 * BEAT : len;
      const suspend = len >= 4 * BEAT && rMotion.chance(movement * 0.55);
      const top = degs.length - 1;
      for (let s = o.start; s < o.end; s += every) {
        const segLen = Math.min(every, o.end - s);
        const first = s === o.start;
        const nowOpen = new Map();
        degs.forEach((deg, i) => {
          const v = 72 + (i === top ? 4 : 0) + rMotion.int(-6, 6) + Math.round(density * 6);
          if (suspend && first && i === top && ctx.pitch(deg + 1) <= HI && ctx.pitch(deg + 1) - ctx.pitch(deg) === 2) {
            // suspension: a step above, resolving halfway through
            const half = Math.round(segLen / 2 / T.STEP) * T.STEP;
            notes.push({ t: s, d: half, v, deg: deg + 1, acc: 0 });
            const n = { t: s + half, d: segLen - half, v: v - 4, deg, acc: 0 };
            notes.push(n);
            nowOpen.set(deg, n);
            return;
          }
          const ringing = open.get(deg);
          if (tie && first && ringing && ringing.t + ringing.d === s) {
            ringing.d += segLen;
            nowOpen.set(deg, ringing);
            return;
          }
          const n = { t: s, d: segLen, v, deg, acc: 0 };
          notes.push(n);
          nowOpen.set(deg, n);
        });
        open.clear();
        for (const [k, n] of nowOpen) open.set(k, n);
      }
    }
    // a tiny gap before re-attacks so the synth retriggers cleanly
    for (const n of notes) if (n.t + n.d < total) n.d = Math.max(30, n.d - 10);
    return notes;
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.roles = Odd.gen.roles || {};
  Odd.gen.roles.pad = {
    aspects: ['motion', 'voicing'],
    params: [
      { key: 'movement', label: 'Movement', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4, hint: 'Suspensions that resolve inside each chord' },
    ],
    generate,
  };
})(globalThis.Odd = globalThis.Odd || {});
