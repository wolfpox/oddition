'use strict';
// Generator tests: every style x role x length must produce valid, deterministic,
// in-range parts, and vary() must return a valid, different part.
const test = require('node:test');
const assert = require('node:assert');

for (const f of [
  '../js/core/rng.js', '../js/core/theory.js',
  '../js/gen/styles.js', '../js/gen/names.js',
  '../js/gen/drums.js', '../js/gen/perc.js', '../js/gen/bass.js', '../js/gen/chords.js',
  '../js/gen/pad.js', '../js/gen/lead.js', '../js/gen/arp.js', '../js/gen/index.js',
]) require(f);

const Odd = globalThis.Odd;
const T = Odd.theory;

const RANGES = {
  bass: [28, 55],
  chords: [48, 84],
  pad: [48, 84],
  lead: [60, 96],
  arp: [48, 96],
};
const DRUM_NOTES = new Set([41, 43, 76, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 73, 74, 77, 80, 81, 36, 37, 38, 39, 42, 44, 46, 45, 47, 50, 49, 51, 54, 56, 70, 75]);

function request(style, role, bars, seed, tonic, scale) {
  const st = Odd.styles.get(style);
  const prog = T.generateProgression(Odd.rng.create(seed * 7 + bars), { scale, bars, rate: st.rate, vamp: st.vamp });
  return { role, style, seed, bars, tonic, scale, prog, params: {} };
}

function checkPart(part, req) {
  const total = req.bars * T.BAR;
  assert.strictEqual(part.role, req.role);
  assert.strictEqual(part.style, req.style);
  assert.strictEqual(part.bars, req.bars);
  assert.ok(typeof part.name === 'string' && part.name.length > 2, 'name');
  assert.ok(Array.isArray(part.notes) && part.notes.length > 0, 'has notes');
  assert.strictEqual(T.progBeats(part.ctx.prog), req.bars * 4, 'ctx.prog covers the part');
  if (Odd.theory.isDrumRole(req.role)) assert.strictEqual(part.base, null);
  else assert.strictEqual(part.base % 12, 0, 'base is a C');
  let prev = null;
  for (const n of part.notes) {
    for (const k of ['t', 'd', 'v']) assert.ok(Number.isInteger(n[k]), k + ' integer');
    assert.ok(n.t >= 0 && n.t < total, 't in range ' + n.t);
    assert.ok(n.d >= 15, 'd >= 15');
    assert.ok(n.t + n.d <= total, 'ends inside the part');
    assert.ok(n.v >= 1 && n.v <= 127, 'velocity');
    let key;
    if (Odd.theory.isDrumRole(req.role)) {
      assert.ok(DRUM_NOTES.has(n.p), 'drum note ' + n.p);
      key = n.p;
    } else {
      assert.ok(Number.isInteger(n.deg) && Number.isInteger(n.acc), 'deg/acc integers');
      key = T.pitchOf(n.deg, n.acc, part.ctx.tonic, part.ctx.scale, part.base);
      const [lo, hi] = RANGES[req.role];
      assert.ok(key >= lo && key <= hi, `${req.role} pitch ${key} outside ${lo}-${hi} (${req.style})`);
    }
    if (prev) assert.ok(prev.t < n.t || (prev.t === n.t && prev.key <= key), 'sorted by time then pitch');
    prev = { t: n.t, key };
  }
}

test('style list and lookups', () => {
  const list = Odd.styles.list();
  assert.deepStrictEqual(list.map((s) => s.id), ['lofi', 'boombap', 'trap', 'house', 'techno', 'synthwave', 'pop', 'ambient', 'dnb']);
  for (const s of list) {
    const st = Odd.styles.get(s.id);
    assert.ok(st.tempo[0] < st.tempo[1]);
    assert.ok(st.swing >= 0 && st.swing <= 0.5);
    for (const role of Odd.gen.ROLES) assert.ok(typeof st.patches[role] === 'string');
    for (const sc of st.scales) assert.ok(T.SCALES[sc], sc);
  }
  assert.strictEqual(Odd.styles.get('nope').id, 'lofi');
});

test('params and defaults', () => {
  for (const role of Odd.gen.ROLES) {
    const ps = Odd.gen.params(role);
    const keys = ps.map((p) => p.key);
    assert.ok(keys.includes('density') && keys.includes('complexity'));
    if (!Odd.theory.isDrumRole(role)) assert.ok(keys.includes('octave'));
    else assert.ok(keys.includes('touch') && keys.includes('accent'));
    const d = Odd.gen.defaults(role);
    for (const p of ps) {
      assert.ok(p.type === 'range' || p.type === 'select');
      if (p.type === 'select') assert.ok(p.options.some((o) => o.value === p.default));
      else assert.ok(p.default >= p.min && p.default <= p.max);
      assert.strictEqual(d[p.key], p.default);
    }
  }
});

test('every style x role x length generates valid, deterministic parts', () => {
  for (const { id } of Odd.styles.list()) {
    for (const role of Odd.gen.ROLES) {
      for (const bars of [1, 2, 4, 8]) {
        for (const seed of [1, 77, 4242]) {
          const scale = seed === 77 ? 'major' : Odd.styles.get(id).scales[0];
          const tonic = (seed * 5 + bars) % 12;
          const req = request(id, role, bars, seed, tonic, scale);
          const a = Odd.gen.generate(req);
          checkPart(a, req);
          const b = Odd.gen.generate(req);
          assert.deepStrictEqual(a, b, `deterministic: ${id}/${role}/${bars}/${seed}`);
        }
      }
    }
  }
});

test('pitch ranges hold for every tonic in major and minor', () => {
  for (const { id } of Odd.styles.list()) {
    for (const role of ['bass', 'chords', 'pad', 'lead', 'arp']) {
      for (let tonic = 0; tonic < 12; tonic++) {
        for (const scale of ['major', 'minor']) {
          const req = request(id, role, 4, 900 + tonic, tonic, scale);
          checkPart(Odd.gen.generate(req), req);
        }
      }
    }
  }
});

test('extreme params stay valid', () => {
  for (const role of Odd.gen.ROLES) {
    for (const v of [0, 1]) {
      const params = {};
      for (const p of Odd.gen.params(role)) {
        if (p.type === 'range') params[p.key] = p.key === 'octave' ? 0 : (v ? p.max : p.min);
        else params[p.key] = p.options[v ? p.options.length - 1 : 0].value;
      }
      for (const { id } of Odd.styles.list()) {
        const req = Object.assign(request(id, role, 4, 31, 3, 'minor'), { params });
        checkPart(Odd.gen.generate(req), req);
      }
    }
  }
});

test('different seeds give different parts', () => {
  for (const role of Odd.gen.ROLES) {
    const a = Odd.gen.generate(request('lofi', role, 4, 1, 0, 'minor'));
    const b = Odd.gen.generate(Object.assign(request('lofi', role, 4, 1, 0, 'minor'), { seed: 2 }));
    assert.notDeepStrictEqual(a.notes, b.notes, role);
  }
});

test('vary() returns a valid, different variation that keeps the context', () => {
  for (const { id } of Odd.styles.list()) {
    for (const role of Odd.gen.ROLES) {
      for (const bars of [1, 4]) {
        const req = request(id, role, bars, 5, 7, Odd.styles.get(id).scales[0]);
        const part = Object.assign(Odd.gen.generate(req), { id: 'p_test' });
        const v = Odd.gen.vary(part, { seed: 99, amount: 0.35 });
        checkPart(v, req);
        assert.notDeepStrictEqual(v.notes, part.notes, `vary changed ${id}/${role}/${bars}`);
        assert.strictEqual(v.parent, 'p_test');
        assert.deepStrictEqual(v.params, part.params);
        assert.deepStrictEqual(v.ctx, part.ctx);
        assert.strictEqual(v.seed, 99);
        assert.notStrictEqual(v.name, part.name);
        // deterministic for the same variation seed
        assert.deepStrictEqual(Odd.gen.vary(part, { seed: 99, amount: 0.35 }), v);
      }
    }
  }
});

test('regenerating from recorded seeds reproduces a part', () => {
  const req = request('house', 'lead', 4, 12, 9, 'minor');
  const part = Odd.gen.generate(req);
  const again = Odd.gen.generate(Object.assign({}, req, { seed: 555, seeds: part.seeds }));
  assert.deepStrictEqual(again.notes, part.notes);
});

test('variant names count up', () => {
  assert.strictEqual(Odd.gen.variantName('Dusty Pocket'), 'Dusty Pocket II');
  assert.strictEqual(Odd.gen.variantName('Dusty Pocket II'), 'Dusty Pocket III');
});

test('the octave setting moves every pitched role by whole octaves', () => {
  const prog = [{ deg: 0, beats: 4 }, { deg: 5, beats: 4 }];
  for (const role of ['bass', 'chords', 'pad', 'lead', 'arp']) {
    const at = (octave) => {
      const p = Odd.gen.generate({ role, style: 'lofi', seed: 42, bars: 2, tonic: 0, scale: 'minor', prog, params: { octave } });
      return p.notes.map((n) => T.pitchOf(n.deg, n.acc, 0, 'minor', p.base));
    };
    const mid = at(0);
    assert.deepStrictEqual(at(1), mid.map((p) => p + 12), role + ' up');
    assert.deepStrictEqual(at(-1), mid.map((p) => p - 12), role + ' down');
  }
});
