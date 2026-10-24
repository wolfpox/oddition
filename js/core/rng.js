/* Oddition — seeded random numbers.
 * Every generated part stores its seed, so the same seed + settings always
 * rebuild the same notes. */
(function (Odd) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // FNV-1a string hash -> unsigned 32-bit int.
  function hash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function create(seed) {
    const s = (typeof seed === 'string' ? hash(seed) : seed) >>> 0;
    const next = mulberry32(s);
    const r = {
      seed: s,
      next,
      /** float in [min, max) */
      range(min, max) { return min + (max - min) * next(); },
      /** integer in [min, max] inclusive */
      int(min, max) { return Math.floor(min + (max - min + 1) * next()); },
      chance(p) { return next() < p; },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      /** pick from [[item, weight], ...] or (items, weights) */
      weighted(items, weights) {
        let list = items;
        if (weights) list = items.map((it, i) => [it, weights[i]]);
        let total = 0;
        for (const [, w] of list) total += Math.max(0, w);
        if (total <= 0) return list[0] ? list[0][0] : undefined;
        let x = next() * total;
        for (const [it, w] of list) {
          x -= Math.max(0, w);
          if (x < 0) return it;
        }
        return list[list.length - 1][0];
      },
      /** roughly normal, mean 0, sd 1 */
      gauss() {
        let u = 0, v = 0;
        while (u === 0) u = next();
        while (v === 0) v = next();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      /** independent child stream; same label -> same stream for the same parent seed */
      fork(label) { return create((s ^ hash(label)) >>> 0); },
    };
    return r;
  }

  function newSeed() {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }

  Odd.rng = { create, hash, newSeed };
})(globalThis.Odd = globalThis.Odd || {});
