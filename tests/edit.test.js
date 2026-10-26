'use strict';
// Booth edits: keep bars while re-rolling, add/remove notes, velocity.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const R = Odd.render;
const E = Odd.edit;
const BAR = T.BAR;

const prog = [{ deg: 0, beats: 4 }, { deg: 5, beats: 4 }, { deg: 3, beats: 4 }, { deg: 4, beats: 4 }];
const req = (o) => Object.assign({ role: 'lead', style: 'pop', seed: 1, bars: 4, tonic: 0, scale: 'major', prog }, o);

test('splice keeps locked bars from the old take and the rest from the new one', () => {
  const a = Odd.gen.generate(req({ seed: 1 }));
  const b = Odd.gen.generate(req({ seed: 2 }));
  const m = E.splice(a, b, [0, 2]);
  const inBar = (p, bar) => p.notes.filter((n) => Math.floor(n.t / BAR) === bar).map((n) => [n.t, n.deg, n.acc]);
  assert.deepStrictEqual(inBar(m, 0), inBar(a, 0));
  assert.deepStrictEqual(inBar(m, 2), inBar(a, 2));
  assert.deepStrictEqual(inBar(m, 1), inBar(b, 1));
  assert.deepStrictEqual(inBar(m, 3), inBar(b, 3));
  // nothing spills over a border
  const side = (bar) => bar === 0 || bar === 2;
  for (const n of m.notes) {
    const startBar = Math.floor(n.t / BAR);
    const lastBar = Math.floor((n.t + n.d - 1) / BAR);
    assert.strictEqual(side(lastBar), side(startBar), 'note stays on its side');
  }
  assert.deepStrictEqual(m.locked, [0, 2]);
  assert.strictEqual(m.base, a.base);
});

test('splice refuses parts it cannot join', () => {
  const a = Odd.gen.generate(req({ seed: 1 }));
  assert.strictEqual(E.splice(a, Odd.gen.generate(req({ seed: 2, bars: 2 })), [0]), null);
  assert.strictEqual(E.splice(a, Odd.gen.generate(req({ seed: 2, prog: [{ deg: 1, beats: 16 }] })), [0]), null);
  assert.strictEqual(E.splice(a, Odd.gen.generate(req({ seed: 2 })), []), null);
  // drums don't care about chords
  const d1 = Odd.gen.generate(req({ role: 'drums', seed: 1 }));
  const d2 = Odd.gen.generate(req({ role: 'drums', seed: 2, prog: [{ deg: 1, beats: 16 }] }));
  assert.ok(E.splice(d1, d2, [1]));
});

test('a note added on screen lands on the same pitch, even over other chords', () => {
  const part = Odd.gen.generate(req({ seed: 5 }));
  // shown over a section with different chords, so refit moves notes
  const target = { tonic: 0, scale: 'major', prog: [{ deg: 3, beats: 8 }, { deg: 1, beats: 8 }], length: 4 * BAR };
  for (const p of [64, 65, 67, 69, 71]) {
    const t = 2 * BAR + 240;
    const out = E.addNote(part, target, { t, d: 240, p, v: 100 });
    const evs = R.partEvents(out, target);
    assert.ok(evs.some((e) => e.t === t && e.p === p && e.v === 100), 'pitch ' + p + ' shows where it was drawn');
  }
});

test('add, remove and velocity on drum takes', () => {
  const part = Odd.gen.generate(req({ role: 'drums', seed: 3 }));
  const tgt = { length: 4 * BAR };
  const added = E.addNote(part, tgt, { t: 3 * BAR + 120 * 7, d: 60, p: 56, v: 90 });
  assert.ok(added.notes.some((n) => n.p === 56 && n.t === 3 * BAR + 840));
  const evs = R.partEvents(added, Object.assign({ withIndex: true }, tgt));
  const ev = evs.find((e) => e.p === 56);
  assert.ok(ev.i != null);
  const louder = E.setVelocity(added, ev.i, 200);
  assert.strictEqual(louder.notes[ev.i].v, 127);
  const removed = E.removeNote(added, ev.i);
  assert.ok(!removed.notes.some((n) => n.p === 56 && n.t === 3 * BAR + 840));
  assert.strictEqual(removed.notes.length, part.notes.length);
  // the original is untouched
  assert.ok(!part.notes.some((n) => n.p === 56 && n.t === 3 * BAR + 840));
});

test('adding a note over a held note of the same pitch shortens the held one', () => {
  const part = { role: 'bass', bars: 1, base: 36, notes: [{ t: 0, d: 1920, v: 90, deg: 0, acc: 0 }], ctx: { tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 4 }] } };
  const out = E.addNote(part, { tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 4 }] }, { t: 960, d: 240, p: 36, v: 90 });
  assert.strictEqual(out.notes.length, 2);
  assert.strictEqual(out.notes[0].d, 960);
});
