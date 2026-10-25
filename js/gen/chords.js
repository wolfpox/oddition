/* Oddition — chord comping generator.
 *
 * Every chord gets a voicing chosen for smooth voice leading from the one
 * before it (nearest inversion, optional drop-2 spread), with sevenths and
 * ninths by style and the Color control. A comp rhythm then plays those
 * voicings; '>' hits anticipate the next chord across the bar line.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const STEP = T.STEP, BAR = T.BAR;
  const LO = 48, HI = 84;

  const GENERIC = {
    sustain: { gate: 0.97, comps: ['X--- ---- ---- ----', 'X--- ---- X--- ----', 'X--- ---- ---- x---'] },
    comp: { gate: 0.9, comps: ['X--- ---- --x- -->-', 'X--- --x- ---x --x-', 'X--. .x-- x--. .>--'] },
    stabs: { gate: 0.65, comps: ['..x. ..x. ..x. ..x.', '..X. .x.. ..X. ..x.', 'x..x ..x. ..x. x...'] },
    pulse: { gate: 0.6, comps: ['x.x. x.x. x.x. x.x.', 'x-x- x-x- x-x- x-x-', 'xxxx xxxx xxxx xxxx'] },
  };

  function parseComp(chars) {
    const out = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch !== 'x' && ch !== 'X' && ch !== '>') continue;
      let len = 1;
      while (i + len < chars.length && chars[i + len] === '-') len++;
      out.push({ step: i, type: ch, len });
    }
    return out;
  }

  /** close-position inversions plus drop-2 / drop-3 spreads of `classes` (degrees), within range */
  function candidates(ctx, classes) {
    const cls = Array.from(new Set(classes.map((d) => T.mod(d, 7)))).sort((a, b) => a - b);
    const out = [];
    for (let j = 0; j < cls.length; j++) {
      const rot = cls.slice(j).concat(cls.slice(0, j));
      for (let o = -3; o <= 4; o++) {
        const degs = [rot[0] + 7 * o];
        for (let i = 1; i < rot.length; i++) {
          let d = rot[i] + 7 * Math.floor(degs[i - 1] / 7);
          while (d <= degs[i - 1]) d += 7;
          degs.push(d);
        }
        out.push({ degs, spread: false });
        if (degs.length >= 3) {
          for (const k of [2, 3]) {
            if (k > degs.length) continue;
            const drop = degs.slice();
            drop[drop.length - k] -= 7;
            drop.sort((a, b) => a - b);
            out.push({ degs: drop, spread: true });
          }
        }
      }
    }
    return out.filter(({ degs }) => {
      const ps = degs.map((d) => ctx.pitch(d));
      if (ps[0] < LO || ps[ps.length - 1] > HI) return false;
      // keep low notes apart: no seconds below E3, nothing narrower than a fourth below C3+5
      for (let i = 0; i < ps.length - 1; i++) if (ps[i] < 52 && ps[i + 1] - ps[i] < 3) return false;
      return true;
    });
  }

  /** penalty for stacked seconds: one is colour, more is mud */
  function clusterCost(ps) {
    let seconds = 0;
    for (let i = 0; i < ps.length - 1; i++) if (ps[i + 1] - ps[i] <= 2) seconds++;
    return seconds <= 1 ? seconds * 1.5 : 1.5 + (seconds - 1) * 10;
  }

  function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

  function voiceLead(ctx, prevPitches, classes, center, rng, preferSpread) {
    const cands = candidates(ctx, classes);
    if (!cands.length) {
      // fall back to a plain triad near the centre
      const root = ctx.placeDeg(classes[0], center - 4, LO, HI - 8);
      return [root, root + 2, root + 4];
    }
    let best = null, bestCost = Infinity;
    for (const { degs, spread } of cands) {
      const ps = degs.map((d) => ctx.pitch(d));
      let cost = Math.abs(mean(ps) - center) * (prevPitches ? 0.35 : 1);
      if (prevPitches) {
        for (const p of ps) cost += Math.min(...prevPitches.map((q) => Math.abs(p - q)));
        cost += Math.abs(ps[ps.length - 1] - prevPitches[prevPitches.length - 1]) * 0.6;
      }
      cost += clusterCost(ps);
      if (T.mod(degs[0] - classes[0], 7) === 1 && classes.length > 3) cost += 2; // 9th in the bass
      if (spread) cost += preferSpread ? -1 : 2;
      cost += rng.range(0, 1.6);
      if (cost < bestCost) { bestCost = cost; best = degs; }
    }
    return best;
  }

  function generate(ctx) {
    const { u, params, bars, total, occ } = ctx;
    const S = ctx.style.chords;
    const density = params.density, complexity = params.complexity, color = params.color;
    const rComp = ctx.rngFor('comp');
    const rVoice = ctx.rngFor('voicing');
    const rColor = ctx.rngFor('color');
    const rVary = ctx.rngFor('vary');

    const family = params.rhythm && params.rhythm !== 'auto' ? GENERIC[params.rhythm] : null;
    const pool = family ? family.comps : S.comps;
    const gate = family ? family.gate : S.gate;
    const idx = u.densityIndex(pool.length, density, rComp, 0.5);
    const main = parseComp(u.steps(pool[idx]));
    const alt = parseComp(u.steps(pool[u.clamp(idx + (rComp.chance(0.5) ? 1 : -1), 0, pool.length - 1)]));

    // extensions and voicings per chord occurrence
    const p7 = u.clamp(S.ext + (color - 0.5) * 1.2, 0, 1);
    const p9 = u.clamp(S.ninth + (color - 0.5) * 1.0, 0, 1);
    const extByDeg = new Map(); // keep the same colour for repeats of a chord
    let prev = null;
    const voicing = occ.map((o) => {
      let ext = extByDeg.get(o.key);
      if (!ext || rColor.chance(0.2 * complexity)) {
        const s7 = rColor.chance(p7);
        const s9 = rColor.chance(p9 * (s7 ? 1 : 0.5));
        ext = { s7, s9 };
        extByDeg.set(o.key, ext);
      }
      const r = o.deg;
      let classes = [r, r + 2, r + 4];
      // a 7th written into the chord ("V7") always sounds
      if (o.chord.sev || (ext.s7 && ctx.goodSeventh(r, o.alt))) classes.push(r + 6);
      if (ext.s9 && ctx.goodNinth(r, o.alt)) classes.push(r + 8);
      // 7th + 9th: play it rootless (3-5-7-9) and leave the root to the bass
      if (classes.length === 5) classes = [r + 2, r + 4, r + 6, r + 8];
      const spread = rVoice.chance(S.spread);
      const degs = voiceLead(ctx, prev, classes, S.center, rVoice, spread);
      prev = degs.map((d) => ctx.pitch(d));
      return { degs, root: r };
    });

    function occAt(t) {
      for (const o of occ) if (t >= o.start && t < o.end) return o;
      return occ[occ.length - 1];
    }

    // chord events: { t, dur, oi, type }
    const events = [];
    for (let b = 0; b < bars; b++) {
      const barStart = b * BAR;
      let hits = main;
      const phraseEnd = (b + 1) % 4 === 0 || (bars < 4 && b === bars - 1 && bars > 1);
      if (b > 0 && rVary.chance(phraseEnd ? complexity * 0.5 : complexity * 0.15)) hits = alt;
      for (const h of hits) {
        const t = barStart + h.step * STEP;
        if (t >= total) continue;
        let o = occAt(t);
        let dur = h.len * STEP;
        let antic = false;
        if (h.type === '>') {
          const nextStart = o.end;
          if (nextStart - t <= 4 * STEP) {
            o = occ[(o.index + 1) % occ.length];
            antic = true;
          }
        }
        events.push({ t, dur, oi: o.index, type: h.type, antic });
      }
    }
    events.sort((a, b) => a.t - b.t);

    // merge an anticipation with the hit it pre-empts
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e.antic) continue;
      const end = e.t + e.dur;
      const j = events.findIndex((f, k) => k > i && f.t === end && f.oi === e.oi);
      if (j > 0) { e.dur += events[j].dur; events.splice(j, 1); }
    }

    // split sustained hits at chord changes (except anticipations, which already belong to the next chord)
    const split = [];
    for (const e of events) {
      let cur = e;
      while (cur) {
        const o = occ[cur.oi];
        // an anticipation of the loop's first chord (wrapped) just rings to the end
        const boundary = cur.antic ? (o.start > cur.t ? o.end : total) : occAt(cur.t).end;
        if (cur.t + cur.dur > boundary && boundary < total && !events.some((f) => f.t === boundary)) {
          const remain = cur.t + cur.dur - boundary;
          split.push(Object.assign({}, cur, { dur: boundary - cur.t }));
          const no = occAt(boundary);
          cur = remain >= STEP ? { t: boundary, dur: remain, oi: no.index, type: 'x', antic: false } : null;
        } else {
          if (cur.t + cur.dur > boundary) cur.dur = boundary - cur.t;
          split.push(cur);
          cur = null;
        }
      }
    }

    // chords that got no hit at all (e.g. a mid-bar change under a stab pattern) get one
    for (const o of occ) {
      if (split.some((e) => e.oi === o.index && e.t < o.end && e.t + e.dur > o.start)) continue;
      split.push({ t: o.start, dur: Math.min(o.end - o.start, 4 * STEP), oi: o.index, type: 'x', antic: false });
    }

    const notes = [];
    for (const e of split) {
      const vz = voicing[e.oi];
      const base = e.type === 'X' ? 92 : e.type === '>' ? 86 : 80;
      const d = Math.max(e.dur <= STEP ? 80 : 30, Math.round(e.dur * gate));
      const sus = e.dur >= 8 * STEP && rVary.chance(complexity * 0.22);
      vz.degs.forEach((deg, i) => {
        const v = base + (i === vz.degs.length - 1 ? 3 : 0) + rVary.int(-4, 4);
        const isThird = T.mod(deg - vz.root, 7) === 2;
        const perfectFourth = T.mod(T.degToSemis(deg + 1, ctx.scale) - T.degToSemis(vz.root, ctx.scale), 12) === 5;
        if (sus && isThird && perfectFourth) {
          const half = Math.round(e.dur / 2 / STEP) * STEP;
          notes.push({ t: e.t, d: half - 10, v, deg: deg + 1, acc: 0 });
          notes.push({ t: e.t + half, d: Math.max(30, d - half), v: v - 6, deg, acc: 0 });
        } else {
          notes.push({ t: e.t, d, v, deg, acc: 0 });
        }
      });
    }
    return notes;
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.roles = Odd.gen.roles || {};
  Odd.gen.roles.chords = {
    aspects: ['vary', 'voicing', 'color', 'comp'],
    params: [
      { key: 'color', label: 'Color', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'Plain triads to sevenths and ninths' },
      {
        key: 'rhythm', label: 'Rhythm', type: 'select', default: 'auto', hint: 'How the chords are played',
        options: [
          { value: 'auto', label: 'Style default' },
          { value: 'sustain', label: 'Sustained' },
          { value: 'comp', label: 'Comping' },
          { value: 'stabs', label: 'Stabs' },
          { value: 'pulse', label: 'Pulse' },
        ],
      },
    ],
    generate,
  };
})(globalThis.Odd = globalThis.Odd || {});
