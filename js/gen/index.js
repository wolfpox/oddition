/* Oddition — generator entry points.
 *
 *   Odd.gen.generate(req) -> part     req: { role, style, seed, bars, tonic, scale, prog, params, seeds?, band? }
 *   Odd.gen.vary(part, { seed, amount, band? }) -> part
 *
 * `band` (from Odd.band.hear) is what the section already plays; a take
 * generated with it fits around the other parts (see js/gen/band.js).
 *
 * Each role module (js/gen/<role>.js) registers Odd.gen.roles[role] =
 *   { aspects: [...], params: [...], generate(ctx) -> notes }
 * Aspects are named random streams (e.g. 'rhythm', 'pitch'). Every part
 * records the seed of each stream in part.seeds, so vary() can re-roll some
 * streams and keep the rest: same rhythm with new notes, same groove with a
 * new fill, and so on.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const R = Odd.rng;
  const gen = (Odd.gen = Odd.gen || {});
  gen.roles = gen.roles || {};

  const ROLES = ['drums', 'bass', 'chords', 'pad', 'lead', 'arp'];

  const roleInfo = {
    drums: { label: 'Drums', short: 'DRM', base: null, defaultPatch: 'kit-acoustic' },
    bass: { label: 'Bass', short: 'BAS', base: 36, defaultPatch: 'bass-sub' },
    chords: { label: 'Chords', short: 'CHD', base: 60, defaultPatch: 'epiano' },
    pad: { label: 'Pad', short: 'PAD', base: 48, defaultPatch: 'pad-warm' },
    lead: { label: 'Lead', short: 'LEAD', base: 72, defaultPatch: 'lead-square' },
    arp: { label: 'Arp', short: 'ARP', base: 60, defaultPatch: 'pluck' },
  };

  const COMMON = [
    { key: 'density', label: 'Density', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'How many notes or hits' },
    { key: 'complexity', label: 'Complexity', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'Variation, syncopation and detail' },
  ];
  const OCTAVE = { key: 'octave', label: 'Octave', type: 'range', min: -2, max: 2, step: 1, default: 0, hint: 'Shift the register up or down' };

  // ---------- shared helpers handed to role generators ----------

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function vel(x) { return clamp(Math.round(x), 1, 127); }

  /** pick an index into a sparse->busy pool according to density */
  function densityIndex(n, density, rng, spread) {
    if (n <= 1) return 0;
    const x = density * (n - 1) + rng.gauss() * (spread == null ? 0.6 : spread);
    return clamp(Math.round(x), 0, n - 1);
  }

  /**
   * chord occurrences in order: [{ start, end, deg, chord, alt, key, index }]
   * alt: the chord's accidental per scale degree (all 0 for a plain chord);
   * key: identifies the chord, so repeats of it can share choices
   */
  function occurrences(prog, total, scale) {
    const out = [];
    let t = 0;
    let guard = 0;
    while (t < total && guard++ < 512) {
      const c = T.chordAt(prog, t);
      const end = Math.min(c.end, total);
      const chord = T.chordOnly(c.chord);
      out.push({
        start: t, end, deg: chord.deg, chord, alt: T.chordAlt(chord, scale),
        key: chord.deg + ':' + (chord.acc || 0) + ':' + (chord.mode || ''), index: out.length,
      });
      t = end;
    }
    return out;
  }

  function makeCtx(req) {
    const role = req.role;
    const mod = gen.roles[role];
    if (!mod) throw new Error('Unknown role: ' + role);
    const bars = clamp(Math.round(req.bars || 4), 1, 64);
    const styleId = Odd.styles.get(req.style).id;
    const style = Odd.styles.get(styleId);
    const tonic = T.mod(Math.round(req.tonic || 0), 12);
    const scale = T.SCALES[req.scale] ? req.scale : 'minor';
    const prog = T.fitProg(req.prog, bars);
    const params = Object.assign({}, defaults(role));
    if (req.params) {
      for (const k of Object.keys(params)) {
        if (req.params[k] !== undefined && req.params[k] !== null) params[k] = req.params[k];
      }
    }
    const seed = (req.seed == null ? R.newSeed() : req.seed) >>> 0;
    const info = roleInfo[role];
    const total = bars * T.BAR;
    // the band only counts if it was heard over this take's length
    const B = Odd.band;
    const band = B && req.band && req.band.steps === total / T.STEP ? req.band : null;
    const heard = [];
    const asked = Object.assign({}, params);
    if (band) {
      const b = B.balance(role, params.density, band, Odd.styles.get(req.style).id);
      params.density = b.density;
      if (b.note) heard.push(b.note);
    }
    // generators write at the role's normal register; the octave setting then
    // moves the finished part by whole octaves (they aim at fixed pitch ranges,
    // so a shifted base during generation would be undone)
    const base = info.base;
    const shift = info.base == null ? 0 : 12 * clamp(Math.round(params.octave || 0), -3, 3);
    const seeds = {};
    const given = req.seeds || {};
    const ctx = {
      role, mod, bars, total, styleId, style, tonic, scale, prog, params, seed, base, shift, seeds,
      band, heard, asked,
      occ: occurrences(prog, total, scale),
      rngFor(aspect) {
        let s = given[aspect];
        if (s == null) s = (seed ^ R.hash(aspect)) >>> 0;
        seeds[aspect] = s >>> 0;
        return R.create(s >>> 0);
      },
      pitch(deg, acc) { return T.pitchOf(deg, acc || 0, tonic, scale, base); },
      /**
       * semitones from `root` up to `deg`, folded into one octave. `alt` is
       * the chord's accidental table (occurrence .alt, or ctx.altAt(t)).
       */
      interval(root, deg, alt) {
        const a = alt || ZERO_ALT;
        const s = T.degToSemis(deg, scale) + a[T.mod(deg, 7)];
        const r = T.degToSemis(root, scale) + a[T.mod(root, 7)];
        return T.mod(s - r, 12);
      },
      /** 7th that sounds consonant (no minor-major 7th, no augmented major 7th) */
      goodSeventh(root, alt) {
        const s = ctx.interval(root, root + 6, alt);
        const third = ctx.interval(root, root + 2, alt);
        const fifth = ctx.interval(root, root + 4, alt);
        if (s === 10) return true;
        if (s === 11) return third === 4 && fifth === 7;
        return s === 9 && third === 3 && fifth === 6;
      },
      /** 9th that is a whole step above the root (no b9 / #9) */
      goodNinth(root, alt) { return ctx.interval(root, root + 1, alt) === 2; },
      chordAt(t) { return T.chordAt(prog, t); },
      /** accidental table of the chord sounding at tick t */
      altAt(t) { return T.chordAlt(T.chordAt(prog, t).chord, scale); },
      /** the degree, among deg + 7k, whose pitch lies in [lo, hi] closest to target pitch */
      placeDeg(deg, target, lo, hi) {
        let best = null, bestDist = Infinity;
        for (let k = -6; k <= 6; k++) {
          const d = deg + 7 * k;
          const p = T.pitchOf(d, 0, tonic, scale, base);
          if (p < lo || p > hi) continue;
          const dist = Math.abs(p - target);
          if (dist < bestDist) { best = d; bestDist = dist; }
        }
        if (best == null) {
          // nothing fits: take the closest to the range middle
          const mid = (lo + hi) / 2;
          for (let k = -6; k <= 6; k++) {
            const d = deg + 7 * k;
            const dist = Math.abs(T.pitchOf(d, 0, tonic, scale, base) - mid);
            if (dist < bestDist) { best = d; bestDist = dist; }
          }
        }
        return best;
      },
      /** lowest / highest degree whose pitch is within [lo, hi] */
      degBounds(lo, hi) {
        let dlo = null, dhi = null;
        for (let d = -40; d <= 60; d++) {
          const p = T.pitchOf(d, 0, tonic, scale, base);
          if (p >= lo && dlo == null) dlo = d;
          if (p <= hi) dhi = d;
        }
        return [dlo == null ? 0 : dlo, dhi == null ? 0 : dhi];
      },
      u: { clamp, vel, densityIndex, steps: Odd.styles.steps },
    };
    return ctx;
  }

  const ZERO_ALT = [0, 0, 0, 0, 0, 0, 0];

  /**
   * enforce note invariants, bend notes to the chord under them, sort, dedupe,
   * and clear same-pitch overlaps.
   * Generators write plain scale degrees; each note then takes the accidental
   * its chord gives that degree (F# over V/V). A note marked `fix` already has
   * a deliberate chromatic accidental (approach notes) and keeps it.
   */
  function finalize(notes, ctx) {
    const total = ctx.total;
    const drum = ctx.role === 'drums';
    const keyOf = drum ? (n) => n.p : (n) => ctx.pitch(n.deg, n.acc);
    const out = [];
    for (const n of notes) {
      let t = Math.round(n.t);
      let d = Math.round(n.d);
      if (!(t >= 0) || t >= total) continue;
      if (!(d > 0)) d = 15;
      d = Math.max(15, d);
      if (t + d > total) d = total - t;
      if (d < 15) {
        if (total - t < 15) continue;
        d = 15;
      }
      const v = vel(n.v);
      if (drum) out.push({ t, d, v, p: Math.round(n.p) });
      else {
        const deg = Math.round(n.deg);
        let acc = Math.round(n.acc || 0);
        if (!n.fix) acc += ctx.altAt(t)[T.mod(deg, 7)];
        out.push({ t, d, v, deg, acc });
      }
    }
    out.sort((a, b) => a.t - b.t || keyOf(a) - keyOf(b) || b.v - a.v);
    // dedupe same time + same pitch
    const dedup = [];
    for (const n of out) {
      const last = dedup[dedup.length - 1];
      if (last && last.t === n.t && keyOf(last) === keyOf(n)) continue;
      dedup.push(n);
    }
    // same pitch must not overlap (MIDI note-on/off would collide)
    const lastByKey = new Map();
    const dropped = new Set();
    for (const n of dedup) {
      const k = keyOf(n);
      const prev = lastByKey.get(k);
      if (prev && prev.t + prev.d > n.t) {
        const nd = n.t - prev.t;
        if (nd >= 15) prev.d = nd;
        else dropped.add(prev);
      }
      lastByKey.set(k, n);
    }
    return dedup.filter((n) => !dropped.has(n));
  }

  // ---------- public API ----------

  function params(role) {
    const mod = gen.roles[role];
    const own = mod && mod.params ? mod.params : [];
    const list = COMMON.concat(own);
    if (role !== 'drums') list.push(OCTAVE);
    return list.map((p) => Object.assign({}, p, p.options ? { options: p.options.map((o) => Object.assign({}, o)) } : {}));
  }

  function defaults(role) {
    const out = {};
    for (const p of params(role)) out[p.key] = p.default;
    return out;
  }

  function generate(req) {
    const ctx = makeCtx(req);
    let raw = ctx.mod.generate(ctx);
    const B = Odd.band;
    const changesAt = new Set(ctx.occ.map((o) => o.start));
    if (ctx.band) {
      const a = B.answer(ctx.role, raw, ctx.band, ctx.rngFor('listen'), (t) => changesAt.has(t));
      raw = a.notes;
      if (a.note) ctx.heard.push(a.note);
    }
    const notes = finalize(raw, ctx);
    // out of the way of the other parts' register (unless an octave was asked for)
    let lift = 0;
    if (ctx.band && ctx.base != null && !ctx.shift) {
      const evs = notes.map((n) => ({ t: n.t, d: n.d, p: ctx.pitch(n.deg, n.acc) }));
      const r = B.clearRegister(ctx.role, evs, ctx.band);
      lift = r.shift;
      if (r.note) ctx.heard.push(r.note);
    }
    // make sure every aspect seed is recorded, even ones a generator skipped this time
    for (const a of ctx.mod.aspects) if (ctx.seeds[a] == null) ctx.rngFor(a);
    const nameRng = ctx.rngFor('name');
    const part = {
      role: ctx.role,
      style: ctx.styleId,
      seed: ctx.seed,
      seeds: Object.assign({}, ctx.seeds),
      bars: ctx.bars,
      params: Object.assign({}, ctx.asked),
      ctx: { tonic: ctx.tonic, scale: ctx.scale, prog: ctx.prog.map((c) => Object.assign(T.chordOnly(c), { beats: c.beats })) },
      base: ctx.base == null ? null : ctx.base + ctx.shift + lift,
      notes,
      name: gen.name(ctx.role, nameRng, ctx.styleId),
    };
    if (ctx.heard.length) part.heard = ctx.heard.slice();
    return part;
  }

  function sameNotes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.t !== y.t || x.d !== y.d || x.v !== y.v || x.p !== y.p || x.deg !== y.deg || x.acc !== y.acc) return false;
    }
    return true;
  }

  function vary(part, opts) {
    const o = opts || {};
    const amount = clamp(o.amount == null ? 0.35 : o.amount, 0, 1);
    const seed = (o.seed == null ? R.newSeed() : o.seed) >>> 0;
    const rng = R.create(seed);
    const mod = gen.roles[part.role];
    const aspects = mod.aspects;
    const oldSeeds = Object.assign({}, part.seeds || {});
    for (const a of aspects) if (oldSeeds[a] == null) oldSeeds[a] = ((part.seed >>> 0) ^ R.hash(a)) >>> 0;

    // amount 0.35 re-rolls one stream; 1.0 re-rolls them all
    let count = clamp(Math.round(amount * aspects.length + (rng.next() - 0.5) * 0.6), 1, aspects.length);
    let result = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      // favour the gentler aspects (listed first), with some shuffle
      const order = aspects
        .map((a, i) => ({ a, k: i + rng.next() * 1.5 }))
        .sort((x, y) => x.k - y.k)
        .map((x) => x.a);
      const seeds = Object.assign({}, oldSeeds);
      for (const a of order.slice(0, count)) seeds[a] = rng.int(0, 0xffffffff) >>> 0;
      seeds.name = oldSeeds.name;
      result = generate({
        role: part.role,
        style: part.style,
        seed,
        bars: part.bars,
        tonic: part.ctx.tonic,
        scale: part.ctx.scale,
        prog: part.ctx.prog,
        params: part.params,
        seeds,
        band: o.band,
      });
      if (!sameNotes(result.notes, part.notes)) break;
      count = Math.min(aspects.length, count + 1);
    }
    result.name = gen.variantName(part.name);
    if (part.id) result.parent = part.id;
    return result;
  }

  gen.ROLES = ROLES;
  gen.roleInfo = roleInfo;
  gen.params = params;
  gen.defaults = defaults;
  gen.generate = generate;
  gen.vary = vary;
  gen._finalize = finalize;
  gen._makeCtx = makeCtx;
})(globalThis.Odd = globalThis.Odd || {});
