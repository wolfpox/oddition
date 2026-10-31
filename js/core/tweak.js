/* Oddition — tweaks: what if the card you're holding were brighter, busier, wider?
 *
 * A tweak changes the card itself, never which card it is. Each dial is one
 * quality with a word at each end, and the two mirror each other: all the
 * way to Bright is no Dark at all. Dials run on fixed scales, the same for
 * every card, so a card comes already turned: a Dorian rhythm sits a little
 * dark, a 6-note one toward sparse. The knob starts where the card sits.
 *
 * Each dial reaches only as far as the card stays itself:
 *   busier or sparser   the same seed grown again, while it keeps most of its notes
 *   off or on the beat  notes pushed just ahead of the beat, or pulled onto it, up to a third of them
 *   accents             the same notes, accented in another grouping (3+3+2...)
 *   darker or brighter  the same steps in another scale with as many notes
 *   wider or narrower   the same shape stretched, while its ups and downs stay
 *   quicker or slower   the same groove, 15% either way
 *   swingier or tighter the off-beats later or back on the grid
 * Turn every dial back and the card comes back exactly (the same object).
 *
 * Moves (Odd.moves) are the small things a tune or a riff's rhythm can do
 * at the spots that allow them: repeats, grace notes, pickups... A move
 * plays at every legal spot unless that spot is left out. They sit on the
 * line (mel.mv, r.mv), so they go on with it into the rounds after.
 *
 *   dialsFor(dir, o, idea) -> [{ id, name, line, lo, hi, pos, home, stops, reach, fixed, why }]
 *   turn(dir, o, idea, id, pos) -> { card, text, limit } | { same, limit, text } | null
 *   movesFor(dir, o, idea) -> [{ id, name, line, stops, def, a, home, spots: [{ s, on }] }]  (a -1: off)
 *   setMove(dir, o, idea, id, a) -> { card, text } | null      (a -1 turns it off)
 *   toggleSpot(dir, o, idea, id, s) -> { card, text } | null   (leave one spot out, or put it back)
 *   tryMove(dir, o, idea, id) -> { card, text } | null         (the move at its usual amount, when it's off)
 *   reset(o) -> the card as it came
 *   nudge(dir, o, idea, last) -> { id, pos, line } | null
 *
 * A tweaked card carries o.tw = { base, set: { dialId: value, mv } }, and is
 * always rebuilt from the base, so turns never pile up.
 */
(function (Odd) {
  'use strict';
  const A = Odd.audition;
  const T = Odd.theory;

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const count = (n, w) => (n < NUM.length ? NUM[n] + ' ' + w + (n === 1 ? '' : 's') : plural(n, w));

  // ---------------------------------------------------------------- what a card is made of

  const MEL_DIRS = /^(seed1|seed2|hook)$/;
  function melOf(dir, o) { return o && o.mel && MEL_DIRS.test(dir) ? o.mel : null; }
  function rhythmOf(dir, o) { const mel = melOf(dir, o); return mel ? mel.r : dir === 'rrhythm' && o ? o.r : null; }
  function meterOfCard(dir, o, idea) {
    const r = rhythmOf(dir, o);
    if (r) return T.meter(r.m || null);
    if (dir === 'pocket') return T.meter(o.m || null);
    return A.ideaMeter(idea);
  }

  /** a note counts as off the beat as the deck counts it (A.offCount) */
  function isOff(m, h) { return A.offCount(m, [h]) > 0; }
  function same(a, b) { const at = {}; a.forEach((h) => { at[h[0]] = 1; }); return b.filter((h) => at[h[0]]).length; }
  /**
   * Still the same rhythm, grown again: busier while it keeps three quarters
   * of its notes and no more than doubles; sparser while what's left is
   * three quarters its own and at least half of it.
   */
  function itself(base, hits) {
    const k = same(base, hits), n0 = base.length, n = hits.length;
    if (n >= n0) return k >= 0.75 * n0 && n <= 2 * n0 + 2;
    return k >= 0.75 * n && n >= Math.max(3, Math.ceil(n0 / 2));
  }

  /** the same seed grown again at density d: hits, or null when it doesn't grow */
  function regrow(dir, r, d) {
    if (dir === 'rrhythm') {
      if (r.fam === 'threes') return A.makeThrees(r.seed, d, r.m || null);
      return A.makeRiff(r.seed, d, r.y, r.rest, r.m || null);
    }
    return A.makeRhythm(r.seed, d, r.y, r.m || null);
  }

  /**
   * k notes pushed just ahead of the beat (k > 0), or pulled onto it (k < 0).
   * The order never changes and nothing collides; a pushed note keeps its
   * accent (that's what a push is), a pulled one takes the beat's.
   * Returns { hits, moved } with moved < |k| when it ran out of notes to move.
   */
  function shove(m, hits, k) {
    const hs = hits.map((h) => h.slice()), total = 2 * m.steps, pushed = {};
    let moved = 0;
    const lastPulse = m.pulses[m.pulses.length - 1].s;
    for (let t = 0; t < Math.abs(k); t++) {
      let best = -1, bestScore = -Infinity, to = 0;
      if (k > 0) {
        hs.forEach((h, i) => {
          if (i === 0 || isOff(m, h) || hs[i - 1][0] >= h[0] - 1) return;
          if (!m.compound && !A.onPulse(m, h[0])) return;
          const x = h[0] % m.steps;
          // into the next bar first, then the last beat of a bar, later before earlier
          const score = (h[0] === m.steps ? 300 : 0) + (x === lastPulse ? 200 : 0) + h[0];
          if (score > bestScore) { bestScore = score; best = i; to = h[0] - 1; }
        });
        if (best < 0) break;
        const h = hs[best], prev = hs[best - 1];
        if (prev[0] + prev[1] > to) prev[1] = Math.max(1, to - prev[0]);
        hs[best] = [to, h[1] + 1, Math.max(1, h[2])];
        pushed[to] = 1;
      } else {
        hs.forEach((h, i) => {
          if (!isOff(m, h)) return;
          const nx = hs[i + 1], pv = hs[i - 1];
          const ons = m.compound ? [h[0] - 1, h[0] + 1].filter((s) => s % 2 === 0) : [];
          if (!m.compound) {
            const before = m.pulses.map((p) => p.s).concat(m.pulses.map((p) => p.s + m.steps)).filter((s) => s < h[0]);
            const after = m.pulses.map((p) => p.s).concat(m.pulses.map((p) => p.s + m.steps)).filter((s) => s > h[0]);
            if (before.length) ons.push(Math.max.apply(null, before));
            if (after.length) ons.push(Math.min.apply(null, after));
          }
          ons.forEach((s) => {
            if (s < 0 || s >= total) return;
            if (s < h[0] && pv && pv[0] >= s) return;
            if (s > h[0] && nx && nx[0] <= s) return;
            if (s > h[0] && h[0] + h[1] <= s) return; // it would start after it ends
            const dist = Math.abs(s - h[0]);
            // the nearest first, onto the beat it was leaning toward, later before earlier
            const score = -10 * dist + (s > h[0] ? 1 : 2) + h[0] / 100;
            if (score > bestScore) { bestScore = score; best = i; to = s; }
          });
        });
        if (best < 0) break;
        const h = hs[best], prev = hs[best - 1];
        if (to < h[0] && prev && prev[0] + prev[1] > to) prev[1] = Math.max(1, to - prev[0]);
        hs[best] = [to, to < h[0] ? h[1] + (h[0] - to) : Math.max(1, h[0] + h[1] - to), h[2]];
        delete pushed[h[0]];
      }
      moved++;
    }
    return { hits: hs, moved, pushed };
  }

  // ---------------------------------------------------------------- scales

  // how dark or bright each scale sits, on one scale for all: each step brighter raises one note
  const BRIGHT = { phrygian: 0, minor: 0.2, harmonic: 0.3, dorian: 0.4, mixolydian: 0.6, major: 0.8, lydian: 1, mpenta: 0.25, penta: 0.75, blues: 0.15 };
  // a scale only trades places with ones that have as many notes, so every step of the tune still has somewhere to go
  const FAMILY = { 7: ['phrygian', 'minor', 'harmonic', 'dorian', 'mixolydian', 'major', 'lydian'], 5: ['mpenta', 'penta'] };
  function familyOf(scale) { const f = FAMILY[(A.SCALES[scale] || []).length]; return f && f.indexOf(scale) >= 0 ? f : null; }
  /** the note a tune lands on, in another scale: home and the 5th stay, a 3rd becomes that scale's 3rd */
  function landIn(scale, land) {
    if (land !== 3 && land !== 4) return land;
    return A.SCALES[scale].indexOf(4) >= 0 ? 4 : 3;
  }

  // ---------------------------------------------------------------- building a tweaked card

  /** the default for each dial: the card as it came */
  function own(id, dir, base) {
    const r = rhythmOf(dir, base), mel = melOf(dir, base);
    if (id === 'density') return r ? r.d : null;
    if (id === 'rhythm') return 0;
    if (id === 'accent') return r ? r.acc || 'beat' : null;
    if (id === 'mood') return mel ? mel.scale : null;
    if (id === 'range') return mel && mel.shape ? mel.shape.amp : null;
    if (id === 'speed') return base.bpm;
    if (id === 'swing') return base.swing || 0;
    if (id === 'mv') return normMv(mvOf(dir, base));
    return null;
  }

  // the dials that rebuild the line itself (the rest only set a number on the card)
  const LINE_DIALS = /^(density|rhythm|accent|mood|range)$/;

  /** the card rebuilt from its base with every setting in set, in a fixed order */
  function build(dir, base, set, idea) {
    const keys = Object.keys(set).filter((id) => (id === 'mv' ? !sameMv(set.mv, own('mv', dir, base)) : set[id] !== own(id, dir, base)));
    if (!keys.length) return base;
    const s = {};
    keys.forEach((id) => { s[id] = set[id]; });
    let o = Object.assign({}, base);
    const r0 = rhythmOf(dir, base);
    if (r0 && keys.some((id) => LINE_DIALS.test(id))) {
      const m = T.meter(r0.m || null);
      let r = r0, hits = r0.hits;
      if (s.density != null) {
        const g = regrow(dir, r0, s.density);
        if (g) {
          if (dir === 'rrhythm') { hits = g.hits; r = Object.assign({}, r0, { fam: r0.fam === 'threes' ? 'threes' : g.fam, turn: g.turn }); }
          else hits = A.accentHits(g, m, r0.acc || 'beat');
        }
      }
      if (s.accent != null && dir !== 'rrhythm') hits = A.accentHits(hits, m, s.accent);
      if (s.rhythm) {
        const sh = shove(m, hits, s.rhythm);
        hits = sh.hits;
        // a riff's accents follow its notes; a tune's pulled notes take the beat's weight
        if (dir === 'rrhythm') hits = A.accentRiff(m, hits, false);
        else {
          const acc = A.accentHits(hits, m, s.accent != null ? s.accent : r0.acc || 'beat');
          hits = hits.map((h, i) => (sh.pushed[h[0]] ? h : acc[i]));
        }
      }
      const tag = keys.filter((id) => id === 'density' || id === 'rhythm' || id === 'accent').map((id) => id.charAt(0) + s[id]).join('');
      r = Object.assign({}, r, {
        id: r0.id + (tag ? '~' + tag : ''), hits, n: hits.length,
        off: dir === 'rrhythm' ? A.riffOff(m, hits) : A.offCount(m, hits),
        d: s.density != null ? s.density : r0.d, acc: s.accent != null ? s.accent : r0.acc,
      });
      if (dir === 'rrhythm') o.r = r;
      else {
        const mel0 = base.mel, scale = s.mood != null ? s.mood : mel0.scale;
        const mel = { r, scale, shape: null };
        if (mel0.shape) {
          const amp = s.range != null ? s.range : mel0.shape.amp;
          const steps = A.shapeSteps(mel0.shape.kind, hits.length, amp, hits);
          const land = landIn(scale, base.land);
          const start = A.startFor(scale, steps, land);
          mel.shape = { kind: mel0.shape.kind, amp, start };
          let leap = 0;
          for (let i = 1; i < steps.length; i++) leap = Math.max(leap, Math.abs(steps[i] - steps[i - 1]));
          const range = Math.max.apply(null, steps) - Math.min.apply(null, steps), end = steps[steps.length - 1] - steps[0];
          Object.assign(o, { land, leap, range, end, size: A.sizeOf(range), b: range });
        }
        o.mel = mel;
      }
    }
    if (s.speed != null) o.bpm = s.speed;
    if (s.swing != null) o.swing = s.swing;
    // the moves go on the line as it now stands: its own, or the ones set here
    const line = dir === 'rrhythm' ? o.r : melOf(dir, o);
    if (line && MV_DIRS.test(dir)) {
      const mv = 'mv' in s ? normMv(s.mv) : own('mv', dir, base), t = Object.assign({}, line);
      if (mv) t.mv = mv;
      else delete t.mv;
      if (dir === 'rrhythm') o.r = t;
      else o.mel = t;
    }
    o.tw = { base, set: s };
    return o;
  }

  // ---------------------------------------------------------------- the dials

  const SWING_STOPS = [0, 0.54, 0.57, 0.6, 0.63, 0.66];
  function swingWord(v) { return v <= 0.5 ? 'straight' : v < 0.57 ? 'a light swing' : v < 0.62 ? 'a swing' : 'a hard swing'; }

  /*
   * A dial: lo and hi (its words), up and down (Bobby's words for a turn),
   * dirs (the rounds it's on), stops(ctx) -> [{ v, pos, ok }] from the card
   * with every other setting in place (ok: still itself), say(ctx, a, b) for
   * a turn from stop a to stop b, and why(ctx) when it can't move here.
   */
  const DIALS = [
    {
      id: 'range', name: 'Range', line: 'How far the tune travels, same ups and downs.', lo: 'Narrow', hi: 'Wide', up: 'wider', down: 'narrower', dirs: /^seed2$/, still: 'this shape',
      why: () => '',
      stops(c) {
        const mel = c.cur.mel, sh = mel.shape, hits = mel.r.hits, n = hits.length;
        const dirs = (st) => st.slice(1).map((x, i) => Math.sign(x - st[i]));
        const baseDirs = dirs(A.shapeSteps(sh.kind, n, own('range', c.dir, c.base), hits));
        const out = [], seen = {};
        for (let k = 4; k <= 48; k++) {
          const amp = k / 20, st = A.shapeSteps(sh.kind, n, amp, hits), key = st.join();
          const range = Math.max.apply(null, st) - Math.min.apply(null, st);
          if (seen[key] || range < 1) continue;
          seen[key] = 1;
          const ds = dirs(st), keep = ds.filter((x, i) => x === baseDirs[i]).length / Math.max(1, ds.length);
          out.push({ v: amp, pos: clamp01((range - 1) / 11), ok: keep >= 0.8 && range <= 14, range });
        }
        // the card's own width exactly, even between the steps sampled
        const v0 = own('range', c.dir, c.base), cur = c.set.range != null ? c.set.range : v0;
        [v0, cur].forEach((amp) => {
          const st = A.shapeSteps(sh.kind, n, amp, hits), key = st.join();
          const range = Math.max.apply(null, st) - Math.min.apply(null, st);
          const at = out.findIndex((x) => A.shapeSteps(sh.kind, n, x.v, hits).join() === key);
          if (at >= 0) out[at].v = amp;
          else out.push({ v: amp, pos: clamp01((range - 1) / 11), ok: true, range });
        });
        return byPos(out, cur, v0);
      },
      say: (c, a, b) => 'it travels ' + plural(b.range, 'step') + ' instead of ' + a.range + ', with the same ups and downs.',
    },
    {
      id: 'mood', name: 'Mood', line: 'The same steps in a darker or brighter scale.', lo: 'Dark', hi: 'Bright', up: 'brighter', down: 'darker', dirs: /^(seed1|seed2)$/, still: 'this tune',
      why(c) {
        if (A.pathOf(c.idea) !== 'melody') return 'The groove under it set the scale, so the tune keeps it.';
        if (!familyOf(c.cur.mel.scale)) return A.MODE[c.cur.mel.scale].name + ' has no darker or brighter twin with as many notes.';
        return '';
      },
      stops(c) {
        return familyOf(c.cur.mel.scale).map((sc) => ({ v: sc, pos: BRIGHT[sc], ok: true }));
      },
      say: (c, a, b) => A.MODE[b.v].name + ' instead of ' + A.MODE[a.v].name + '. ' + (c.dir === 'seed1' ? 'Same rhythm, walking a ' + (b.pos > a.pos ? 'brighter' : 'darker') + ' scale.' : 'Same rhythm, same ups and downs.'),
    },
    {
      id: 'density', name: 'Density', line: 'Fewer notes or more, grown from the same seed.', lo: 'Sparse', hi: 'Busy', up: 'busier', down: 'sparser', dirs: /^(seed1|seed2|hook|rrhythm)$/, still: 'this rhythm',
      why(c) {
        const r = rhythmOf(c.dir, c.base);
        return r && r.seed != null && r.d != null ? '' : 'This rhythm came without its seed, so it can’t be grown again. Pick it again from the deck to tweak it.';
      },
      stops(c) {
        const r = rhythmOf(c.dir, c.base), m = T.meter(r.m || null), total = 2 * m.steps;
        const runs = [], at = {};
        for (let k = 0; k <= 40; k++) {
          const d = k / 40, g = regrow(c.dir, r, d), hits = g && (g.hits || g);
          if (!hits) continue;
          const key = hits.map((h) => h[0] + ':' + h[1]).join();
          if (at[key]) { at[key].ds.push(d); continue; }
          at[key] = { hits, ds: [d] };
          runs.push(at[key]);
        }
        const key0 = r.hits.map((h) => h[0] + ':' + h[1]).join();
        let home = runs.findIndex((x) => x.hits.map((h) => h[0] + ':' + h[1]).join() === key0);
        if (home < 0) { runs.push({ hits: r.hits, ds: [r.d] }); runs.sort((x, y) => x.ds[0] - y.ds[0]); home = runs.findIndex((x) => x.hits === r.hits); }
        // outward from the card's own, while it's still that rhythm
        const okAt = runs.map(() => false);
        okAt[home] = true;
        for (let i = home - 1; i >= 0 && itself(r.hits, runs[i].hits); i--) okAt[i] = true;
        for (let i = home + 1; i < runs.length && itself(r.hits, runs[i].hits); i++) okAt[i] = true;
        const cur = c.set.density != null ? c.set.density : r.d;
        const stops = runs.map((x, i) => ({
          v: i === home ? r.d : x.ds.indexOf(cur) >= 0 ? cur : x.ds[Math.floor(x.ds.length / 2)],
          pos: clamp01(x.hits.length / (0.75 * total)), ok: okAt[i], n: x.hits.length, kept: same(r.hits, x.hits), dist: Math.abs(i - home),
        }));
        // one stop per note count, the nearest to the card's own
        const best = {};
        stops.forEach((x) => { const b = best[x.n]; if (!b || x.dist < b.dist || (x.dist === b.dist && x.ok && !b.ok)) best[x.n] = x; });
        return byPos(Object.keys(best).map((k) => best[k]), cur, r.d);
      },
      say(c, a, b) {
        const r = rhythmOf(c.dir, c.base), unit = c.dir === 'rrhythm' ? 'hit' : 'note';
        const t = plural(b.n, unit) + ' instead of ' + a.n + '.';
        if (b.n > r.n && b.kept === r.n) return t + ' Every ' + unit + ' it came with is still there.';
        if (b.n < r.n && b.kept === b.n) return t + ' What’s left is all from the rhythm it came with.';
        if (b.kept === r.n && b.n === r.n) return t + ' The rhythm it came with.';
        return t + ' It keeps ' + b.kept + ' of its ' + r.n + '.';
      },
    },
    {
      id: 'rhythm', name: 'Push', line: 'Notes just ahead of the beat, or right on it.', lo: 'On the beat', hi: 'Off the beat', up: 'further off the beat', down: 'closer to the beat', dirs: /^(seed1|seed2|hook|rrhythm)$/, still: 'this rhythm',
      why(c) {
        const r = rhythmOf(c.dir, c.base);
        if (r.fam === 'threes') return 'Its accents fall in threes across the beat. Moving notes would undo them.';
        return '';
      },
      stops(c) {
        // the card with every other dial set, none of its notes moved yet
        const r = rhythmOf(c.dir, c.cur), m = T.meter(r.m || null), n = r.hits.length;
        const K = Math.max(1, Math.round(n / 3)), out = [];
        for (let k = -K - 2; k <= K + 2; k++) {
          const sh = shove(m, r.hits, k);
          if (sh.moved < Math.abs(k)) continue;
          const offs = A.offCount(m, sh.hits);
          out.push({ v: k, pos: clamp01(offs / n / 0.8), ok: Math.abs(k) <= K, offs, k });
        }
        return byPos(out, c.set.rhythm || 0, 0);
      },
      say(c, a, b) {
        const unit = c.dir === 'rrhythm' ? 'hit' : 'note';
        if (b.k === 0) return 'every ' + unit + ' back where it came.';
        if (b.k > 0) return count(b.k, unit) + (b.k === 1 ? ' now lands' : ' now land') + ' just ahead of the beat.';
        return count(-b.k, unit) + ' pulled onto the beat.';
      },
    },
    {
      id: 'accent', name: 'Grouping', line: 'Accents with the count, or across it.', lo: 'With the count', hi: 'Across the count', up: 'further across the count', down: 'closer to the count', dirs: /^(seed1|hook)$/, still: 'this rhythm',
      why(c) {
        return this.stops(c).length < 2 ? 'Its notes fall where any accents would, so there’s nothing to move.' : '';
      },
      stops(c) {
        // a grouping that weighs the notes just as the card does would change nothing: it isn't a stop
        const r = c.cur.mel.r, m = T.meter(r.m || null), cur = valueOf(c, 'accent');
        const wOf = (id) => A.accentHits(r.hits, m, id).map((h) => h[2]).join();
        const now = wOf(cur), seen = {};
        return A.accentsOf(m).filter((g) => {
          const w = wOf(g.id);
          if (g.id !== cur && (w === now || seen[w])) return false;
          seen[w] = 1;
          return true;
        }).map((g) => ({ v: g.id, pos: g.at, ok: true, name: g.name }));
      },
      say: (c, a, b) => 'the same notes, accented ' + b.name + '.',
    },
    {
      id: 'speed', name: 'Speed', line: 'The same groove, slower or quicker.', lo: 'Slow', hi: 'Quick', up: 'quicker', down: 'slower', dirs: /^(pocket|sound)$/, still: 'this groove',
      why: () => '',
      stops(c) {
        const v0 = own('speed', c.dir, c.base), cur = c.set.speed != null ? c.set.speed : v0;
        const lo = Math.max(56, Math.round(v0 * 0.85)), hi = Math.min(180, Math.round(v0 * 1.15)), out = [];
        const at = (b) => ({ v: b, pos: clamp01((b - 56) / 124), ok: b >= lo && b <= hi });
        for (let b = 56; b <= 180; b += 2) if (Math.abs(b - v0) > 1 && Math.abs(b - cur) > 1) out.push(at(b));
        out.push(Object.assign(at(v0), { ok: true }));
        if (cur !== v0) out.push(at(cur));
        return byPos(out, cur, v0);
      },
      say: (c, a, b) => b.v + ' BPM instead of ' + a.v + '.',
    },
    {
      id: 'swing', name: 'Swing', line: 'The off-beats later, or back on the grid.', lo: 'Tight', hi: 'Swingy', up: 'swingier', down: 'tighter', dirs: /^(pocket|sound)$/, still: 'this groove',
      why: (c) => (c.m.compound ? 'It moves in threes, so there’s no off-beat to swing.' : ''),
      stops(c) {
        const v0 = own('swing', c.dir, c.base), cur = c.set.swing != null ? c.set.swing : v0;
        const vs = SWING_STOPS.filter((v) => [v0, cur].every((x) => x === v || Math.abs(x - v) > 0.012)).concat([v0, cur]);
        return byPos(vs.filter((v, i) => vs.indexOf(v) === i).map((v) => ({ v, pos: v <= 0.5 ? 0 : clamp01((v - 0.5) / 0.16), ok: true })), cur, v0);
      },
      say: (c, a, b) => swingWord(b.v) + ' instead of ' + swingWord(a.v) + '.',
    },
  ];
  const DIAL = {};
  DIALS.forEach((d) => { DIAL[d.id] = d; });

  /** stops in order along the dial, one per spot: on a tie the current value wins, then the card's own, then the nearer one */
  function byPos(stops, cur, v0) {
    const rank = (x) => (x.v === cur ? 0 : x.v === v0 ? 1 : 2);
    const out = [];
    stops.slice().sort((a, b) => a.pos - b.pos).forEach((x) => {
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.pos - x.pos) < 1e-6) { if (rank(x) < rank(prev)) out[out.length - 1] = x; return; }
      out.push(x);
    });
    return out;
  }

  function ctxOf(dir, o, idea, id) {
    const base = o.tw ? o.tw.base : o, set = o.tw ? o.tw.set : {};
    const others = Object.assign({}, set);
    delete others[id];
    return { dir, base, set, idea, o, m: meterOfCard(dir, base, idea), cur: build(dir, base, others, idea) };
  }
  /** a dial's value on a card: its setting, or the card's own */
  function valueOf(c, id) { return c.set[id] != null ? c.set[id] : own(id, c.dir, c.base); }

  /** the dials a round has (none: nothing to tweak here yet) */
  function has(dir, o) { return !!o && DIALS.some((d) => d.dirs.test(dir) && (d.id !== 'range' || (o.mel && o.mel.shape))); }

  /**
   * The dials for a card: [{ id, lo, hi, pos, home, stops, reach: [a, b], fixed, why }].
   * pos: where it sits now; home: where it came; stops: every spot it can
   * go and still be itself; reach: the first and last of those.
   */
  function dialsFor(dir, o, idea) {
    if (!o) return [];
    return DIALS.filter((d) => d.dirs.test(dir) && (d.id !== 'range' || (o.mel && o.mel.shape))).map((d) => {
      const c = ctxOf(dir, o, idea, d.id);
      const why = d.why(c);
      const out = { id: d.id, name: d.name, line: d.line, lo: d.lo, hi: d.hi, pos: 0.5, home: 0.5, stops: [], reach: [0.5, 0.5], fixed: !!why, why };
      if (why) return out;
      const st = d.stops(c), v = valueOf(c, d.id), v0 = own(d.id, dir, c.base);
      const ok = st.filter((x) => x.ok);
      const here = st.find((x) => x.v === v), home = st.find((x) => x.v === v0);
      out.pos = here ? here.pos : 0.5;
      out.home = home ? home.pos : out.pos;
      out.stops = ok.map((x) => x.pos);
      out.reach = ok.length ? [ok[0].pos, ok[ok.length - 1].pos] : [out.pos, out.pos];
      if (ok.length < 2) { out.fixed = true; out.why = 'Any further either way and it wouldn’t be ' + d.still + ' any more.'; }
      return out;
    });
  }

  /**
   * Turn one dial to pos (0 to 1): the nearest spot it can go and still be
   * itself. { card, text, limit } for a change; { same, limit, text } when
   * it's already there (limit: pos asked past the end of its reach).
   */
  function turn(dir, o, idea, id, pos) {
    const d = DIAL[id];
    if (!o || !d || !d.dirs.test(dir)) return null;
    const c = ctxOf(dir, o, idea, id);
    if (d.why(c)) return null;
    const st = d.stops(c), ok = st.filter((x) => x.ok);
    if (!ok.length) return null;
    const v = valueOf(c, id), here = st.find((x) => x.v === v) || ok[0];
    const p = clamp01(pos);
    const to = ok.reduce((b, x) => (Math.abs(x.pos - p) < Math.abs(b.pos - p) ? x : b), ok[0]);
    const limit = p < ok[0].pos - 0.03 || p > ok[ok.length - 1].pos + 0.03;
    const end = 'That’s as far as it goes and stays ' + d.still + '.';
    if (to.v === v) return { same: true, limit, text: limit ? end : '' };
    const set = Object.assign({}, c.set, { [id]: to.v });
    const card = build(dir, c.base, set, idea);
    const way = to.pos > here.pos ? d.up : d.down;
    let text = A.cap(way) + ': ' + d.say(c, here, to);
    if (card === c.base) text += ' That’s how it came.';
    else if (limit || to === ok[0] || to === ok[ok.length - 1]) text += ' ' + end;
    return { card, text, limit };
  }

  // ---------------------------------------------------------------- moves: the small things it can do at one spot

  const MV_DIRS = /^(seed1|seed2|hook|rrhythm)$/;
  function mvOf(dir, o) { const t = dir === 'rrhythm' ? o && o.r : melOf(dir, o); return (t && t.mv) || null; }
  /** a line's moves in one form, so two that play the same compare the same (null: none) */
  function normMv(mv) {
    if (!mv || !Odd.moves) return null;
    const ids = Odd.moves.LIST.map((x) => x.id).filter((id) => mv[id]);
    if (!ids.length) return null;
    const out = {};
    ids.forEach((id) => { out[id] = { a: mv[id].a | 0, skip: (mv[id].skip || []).slice().sort((x, y) => x - y) }; });
    return out;
  }
  function sameMv(a, b) { return JSON.stringify(normMv(a)) === JSON.stringify(normMv(b)); }
  /** the line moves play on: the card with every dial set, before any move */
  function bareNotes(dir, o) {
    if (dir === 'rrhythm') return A.riffNotes({ r: Object.assign({}, o.r, { mv: null }) });
    return A.melodyNotes(Object.assign({}, o.mel, { mv: null }), dir === 'seed1');
  }
  function cxOf(dir, o) { return dir === 'rrhythm' ? A.riffCx(o.r) : A.melCx(o.mel); }
  const unitOf = (dir) => (dir === 'rrhythm' ? 'hit' : 'note');
  /** a riff's rhythm has hits, not notes */
  const asHits = (t) => t.replace(/(N|n)ote(s?)/g, (w, c, pl) => (c === 'N' ? 'H' : 'h') + 'it' + pl);
  function lineFor(L, dir) { return dir !== 'rrhythm' ? L.line : L.hitLine || asHits(L.line); }
  function stopsFor(L, dir) { return dir !== 'rrhythm' ? L.stops : L.stops.map(asHits); }
  function canMove(dir, o) { return !!(o && Odd.moves && MV_DIRS.test(dir) && (dir === 'rrhythm' ? o.r : o.mel)); }

  /** every move this card can make, and where: the ones with nowhere to go aren't listed */
  function movesFor(dir, o) {
    if (!canMove(dir, o)) return [];
    const base = o.tw ? o.tw.base : o, cur = normMv(mvOf(dir, o)) || {}, home = normMv(mvOf(dir, base)) || {};
    const ns = bareNotes(dir, o), cx = cxOf(dir, o);
    return Odd.moves.LIST.map((L) => {
      const sp = Odd.moves.spots(L.id, ns, cx);
      if (!sp.length) return null;
      const m = cur[L.id], h = home[L.id];
      return {
        id: L.id, name: L.name, line: lineFor(L, dir), stops: stopsFor(L, dir), def: L.def, a: m ? m.a : -1, home: h ? h.a : -1,
        spots: sp.map((s) => ({ s, on: !!m && m.skip.indexOf(s) < 0 })),
      };
    }).filter(Boolean);
  }

  function withMv(dir, o, idea, mv) {
    const base = o.tw ? o.tw.base : o, set = o.tw ? o.tw.set : {};
    return build(dir, base, Object.assign({}, set, { mv: Object.keys(mv).length ? mv : null }), idea);
  }
  function moveSay(dir, card, id) {
    const L = Odd.moves.MOVE[id], x = movesFor(dir, card).find((m) => m.id === id);
    if (!x || x.a < 0) return L.name + ': off.';
    return L.name + ', ' + x.stops[x.a].toLowerCase() + ', on ' + count(x.spots.filter((p) => p.on).length, unitOf(dir)) + '.';
  }

  /** a move at amount a (an index into its stops), or off (a -1) */
  function setMove(dir, o, idea, id, a) {
    const L = Odd.moves && Odd.moves.MOVE[id];
    if (!canMove(dir, o) || !L) return null;
    const cur = Object.assign({}, normMv(mvOf(dir, o)) || {}), was = cur[id];
    let off = '';
    if (a < 0) {
      if (!was) return null;
      delete cur[id];
    } else {
      const to = Math.max(0, Math.min(L.stops.length - 1, a | 0));
      if (was && was.a === to) return null;
      cur[id] = { a: to, skip: was ? was.skip : [] };
      if (L.not && cur[L.not]) { delete cur[L.not]; off = Odd.moves.MOVE[L.not].name; }
    }
    const card = withMv(dir, o, idea, cur);
    let text = moveSay(dir, card, id);
    if (off) text += ' ' + off + ' is off: a ' + unitOf(dir) + ' can’t be both.';
    if (!card.tw) text += ' That’s how it came.';
    return { card, text };
  }

  /** leave one spot out of a move, or put it back; leaving out the last turns it off */
  function toggleSpot(dir, o, idea, id, s) {
    const L = Odd.moves && Odd.moves.MOVE[id];
    if (!canMove(dir, o) || !L) return null;
    const cur = Object.assign({}, normMv(mvOf(dir, o)) || {}), m = cur[id];
    if (!m) return null;
    const sp = Odd.moves.spots(id, bareNotes(dir, o), cxOf(dir, o));
    if (sp.indexOf(s) < 0) return null;
    const back = m.skip.indexOf(s) >= 0, skip = back ? m.skip.filter((x) => x !== s) : m.skip.concat([s]);
    const left = sp.filter((x) => skip.indexOf(x) < 0).length, unit = unitOf(dir);
    if (left) cur[id] = { a: m.a, skip };
    else delete cur[id];
    const card = withMv(dir, o, idea, cur);
    let text = !left ? L.name + ': off. That was the last ' + unit + ' it was on.'
      : (back ? 'Back on that ' + unit + '. ' : 'Left that ' + unit + ' out. ') + L.name + ' on ' + left + ' of ' + plural(sp.length, unit) + '.';
    if (!card.tw) text += ' That’s how it came.';
    return { card, text };
  }

  /** a move that's off, tried at its usual amount */
  function tryMove(dir, o, idea, id) {
    const L = Odd.moves && Odd.moves.MOVE[id];
    if (!canMove(dir, o) || !L || (normMv(mvOf(dir, o)) || {})[id]) return null;
    return setMove(dir, o, idea, id, L.def);
  }

  /** the card as it came, before any dial was turned */
  function reset(o) { return o && o.tw ? o.tw.base : o; }
  function tweaked(o) { return !!(o && o.tw); }

  /**
   * Bobby turns one: the dial with the most room on the side the card
   * doesn't lean to (not the one he turned last), as far as it still goes.
   * { id, pos, line } or null.
   */
  function nudge(dir, o, idea, last) {
    const ds = dialsFor(dir, o, idea).filter((d) => !d.fixed);
    if (!ds.length) return null;
    const room = (d) => {
      const lean = d.pos - 0.5, up = d.reach[1] - d.pos, down = d.pos - d.reach[0];
      let side = Math.abs(lean) < 0.1 ? (up >= down ? 1 : -1) : lean > 0 ? -1 : 1;
      // no room on the far side: back the other way
      if ((side > 0 ? up : down) <= 0.01) side = -side;
      return { d, side, room: side > 0 ? up : down, away: side * lean <= 0 };
    };
    const all = ds.map(room).filter((x) => x.room > 0.01);
    if (!all.length) return null;
    // away from where it leans first, then the most room
    const fresh = all.filter((x) => x.d.id !== last);
    const pick = (fresh.length ? fresh : all).reduce((b, x) => (!b || (x.away && !b.away) || (x.away === b.away && x.room > b.room) ? x : b), null);
    const d = pick.d, pos = pick.side > 0 ? d.reach[1] : d.reach[0];
    const to = pick.side > 0 ? d.hi : d.lo, from = pick.side > 0 ? d.lo : d.hi;
    const line = Math.abs(d.pos - 0.5) < 0.1
      ? 'It sat in the middle, so I turned it toward ' + to + '.'
      : pick.away ? 'It leans ' + from.toLowerCase() + '. I turned it toward ' + to + ', as far as it goes.'
        : 'It can’t go further toward ' + from + ', so I turned it back toward ' + to + '.';
    return { id: d.id, pos, line };
  }

  Odd.tweak = { DIALS, DIAL, BRIGHT, has, dialsFor, turn, movesFor, setMove, toggleSpot, tryMove, reset, tweaked, nudge, build, shove, regrow };
})(globalThis.Odd = globalThis.Odd || {});
