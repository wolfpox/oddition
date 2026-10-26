'use strict';
// Percussion lane and drum dynamics (touch and accents).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/model', 'core/recipes', 'core/midi-file', 'core/zip', 'core/export',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const G = Odd.gen;
const FAM = G.roles.perc.FAMILIES;

const req = (o) => Object.assign({ role: 'perc', style: 'house', seed: 11, bars: 4, tonic: 0, scale: 'minor', prog: [{ deg: 0, beats: 16 }] }, o);

test('percussion is a drum role on GM channel 10', () => {
  assert.ok(G.ROLES.includes('perc'));
  assert.ok(Odd.theory.isDrumRole('perc') && Odd.theory.isDrumRole('drums') && !Odd.theory.isDrumRole('bass'));
  const part = G.generate(req());
  assert.strictEqual(part.base, null);
  assert.ok(part.notes.length > 0);
  assert.ok(part.notes.every((n) => n.p != null && n.deg == null));
  const s = Odd.model.createSession({ seed: 2, style: 'house' });
  const lane = Odd.model.laneForRole(s, 'perc');
  assert.ok(lane);
  assert.strictEqual(lane.channel, 9);
  assert.strictEqual(lane.patch, 'kit-perc');
});

test('each instrument family plays its own instruments', () => {
  for (const kit of Object.keys(FAM)) {
    const allowed = new Set();
    for (const p of FAM[kit].patterns) for (const l of p.lanes) allowed.add(l.p);
    for (const seed of [1, 2, 3]) {
      // low density: the main family alone, no texture layers
      const part = G.generate(req({ seed, params: { kit, density: 0.3 } }));
      for (const n of part.notes) assert.ok(allowed.has(n.p), kit + ' plays ' + n.p);
    }
  }
});

test('ghost taps sit well below accents', () => {
  const part = G.generate(req({ params: { kit: 'congas', density: 0.8, complexity: 0 } }));
  const vs = part.notes.map((n) => n.v);
  assert.ok(Math.max(...vs) - Math.min(...vs) >= 45, 'a wide dynamic range: ' + Math.min(...vs) + '..' + Math.max(...vs));
});

test('busier settings add texture layers', () => {
  let sparse = 0, busy = 0;
  for (let seed = 1; seed <= 12; seed++) {
    sparse += new Set(G.generate(req({ seed, params: { kit: 'congas', density: 0.2 } })).notes.map((n) => n.p)).size;
    busy += new Set(G.generate(req({ seed, params: { kit: 'congas', density: 0.95 } })).notes.map((n) => n.p)).size;
  }
  assert.ok(busy > sparse, busy + ' > ' + sparse);
});

test('touch and accents: neutral at 0.5, wider and softer when asked', () => {
  const notes = [{ t: 0, d: 60, p: 38, v: 30 }, { t: 120, d: 60, p: 38, v: 76 }, { t: 240, d: 60, p: 38, v: 110 }];
  assert.deepStrictEqual(G.dynamics(notes, 0.5, 0.5), notes);
  const wide = G.dynamics(notes, 0.5, 1);
  assert.ok(wide[0].v < 30 && wide[2].v > 110);
  const flat = G.dynamics(notes, 0.5, 0);
  assert.ok(flat[0].v > 30 && flat[2].v < 110);
  const soft = G.dynamics(notes, 0, 0.5);
  assert.ok(soft.every((n, i) => n.v < notes[i].v));
  const hard = G.dynamics(notes, 1, 0.5);
  assert.ok(hard.every((n, i) => n.v >= notes[i].v));
  // through the generator: same seed, softer touch, quieter part
  const mean = (p) => p.notes.reduce((a, n) => a + n.v, 0) / p.notes.length;
  const base = G.generate({ role: 'drums', style: 'pop', seed: 4, bars: 2, tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 8 }] });
  const light = G.generate({ role: 'drums', style: 'pop', seed: 4, bars: 2, tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 8 }], params: { touch: 0.1 } });
  assert.strictEqual(base.notes.length, light.notes.length);
  assert.ok(mean(light) < mean(base) - 15);
});

test('percussion exports on channel 10 without a program change', () => {
  const ws = Odd.model.createWorkspace({ seed: 5, style: 'house' });
  const s = Odd.model.currentSession(ws);
  const part = Odd.model.addToLibrary(ws, G.generate(req()));
  const lane = Odd.model.laneForRole(s, 'perc');
  Odd.model.placePart(s, s.sections[1].id, lane.id, part);
  const bytes = Odd.exporter.partMidi(part, s);
  const parsed = Odd.midiFile.read(bytes);
  const notes = parsed.tracks.flatMap((t) => t.notes || []);
  assert.ok(notes.length > 0);
  assert.ok(notes.every((n) => n.ch === 9));
});

test('older sessions get a percussion lane when loaded', () => {
  const ws = Odd.model.createWorkspace({ seed: 9, style: 'pop' });
  const s = Odd.model.currentSession(ws);
  s.lanes = s.lanes.filter((l) => l.role !== 'perc');
  const m = Odd.model.migrate(JSON.parse(JSON.stringify(ws)));
  const lanes = Odd.model.currentSession(m).lanes;
  assert.strictEqual(lanes[1].role, 'perc');
  assert.strictEqual(lanes.filter((l) => l.role === 'perc').length, 1);
});
