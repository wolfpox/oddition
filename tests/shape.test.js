'use strict';
// Song shape: energy, dynamics, transitions, humanize.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/index', 'core/shape', 'core/render', 'core/midi-file', 'core/zip', 'core/model', 'core/export',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const S = Odd.shape;
const R = Odd.render;
const M = Odd.model;

function starter(seed) {
  const ws = M.createWorkspace({ seed: seed || 3, style: 'boombap' });
  const s = ws.sessions[0];
  M.fillStarter(ws, s, (seed || 3) + 1);
  return { ws, s };
}

/** a session with every role filled in every section */
function full(seed) {
  const { ws, s } = starter(seed);
  const rng = Odd.rng.create(seed || 11);
  for (const sec of s.sections) {
    for (const lane of s.lanes) {
      const part = Odd.gen.generate({
        role: lane.role, style: s.style, seed: rng.int(1, 1e9), bars: 4,
        tonic: s.tonic, scale: s.scale, prog: T.sliceProg(sec.prog, 0, 4 * T.BAR),
      });
      M.placePart(s, sec.id, lane.id, M.addToLibrary(ws, part));
    }
  }
  return { ws, s };
}

test('energy is guessed from section names', () => {
  assert.strictEqual(S.autoEnergy('Intro'), 0.3);
  assert.strictEqual(S.autoEnergy('Verse 2'), 0.5);
  assert.strictEqual(S.autoEnergy('Chorus'), 0.75);
  assert.strictEqual(S.autoEnergy('Pre-chorus'), 0.62);
  assert.strictEqual(S.autoEnergy('Drop'), 0.9);
  assert.strictEqual(S.autoEnergy('Breakdown'), 0.25);
  assert.strictEqual(S.autoEnergy('Part 7'), 0.5);
  assert.strictEqual(S.energyOf({ name: 'Intro', energy: 0.8 }), 0.8);
  assert.strictEqual(S.energyOf({ name: 'Intro', energy: null }), 0.3);
});

test('auto entry follows the energy jump', () => {
  assert.strictEqual(S.resolveEntry('auto', 0.5, 0.52), 'none');
  assert.strictEqual(S.resolveEntry('auto', 0.5, 0.75), 'fill');
  assert.strictEqual(S.resolveEntry('auto', 0.3, 0.75), 'build');
  assert.strictEqual(S.resolveEntry('auto', 0.25, 0.9), 'gap');
  assert.strictEqual(S.resolveEntry('auto', 0.75, 0.5), 'none');
  assert.strictEqual(S.resolveEntry('build', 0.75, 0.5), 'build');
});

test('plan lifts repeated sections and starts with no entry', () => {
  const { s } = starter();
  const p = S.plan(s);
  assert.strictEqual(p.length, s.arrangement.length);
  assert.strictEqual(p[0].entry, 'none');
  const choruses = p.filter((e) => e.section.name === 'Chorus');
  assert.ok(choruses[1].energy > choruses[0].energy);
  s.shape.lift = false;
  const flat = S.plan(s).filter((e) => e.section.name === 'Chorus');
  assert.strictEqual(flat[1].energy, flat[0].energy);
  for (let i = 1; i < p.length; i++) assert.strictEqual(p[i].start, p[i - 1].end);
});

test('energy 0.5 with no ramp leaves velocities near the written ones', () => {
  const evs = [{ t: 0, d: 100, p: 36, v: 100, track: 'd' }, { t: 480, d: 100, p: 38, v: 90, track: 'd' }];
  const out = S.shapeLane(evs, { role: 'drums', energy: 0.5, start: 0, end: T.BAR, nextEnergy: null });
  assert.strictEqual(out.length, 2);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(out[i].v - evs[i].v) <= 4, out[i].v + ' vs ' + evs[i].v);
});

test('low energy thins drums but keeps the downbeat and backbeat', () => {
  const evs = [];
  for (let st = 0; st < 16; st++) evs.push({ t: st * T.STEP, d: 60, p: 42, v: 70, track: 'd' });
  evs.push({ t: 0, d: 100, p: 36, v: 110, track: 'd' });
  evs.push({ t: T.BEAT, d: 100, p: 38, v: 100, track: 'd' });
  evs.push({ t: 3 * T.BEAT, d: 100, p: 38, v: 100, track: 'd' });
  evs.push({ t: 5 * T.STEP, d: 60, p: 38, v: 40, track: 'd' }); // ghost
  const low = S.shapeLane(evs, { role: 'drums', energy: 0.1, start: 0, end: T.BAR });
  const mid = S.shapeLane(evs, { role: 'drums', energy: 0.5, start: 0, end: T.BAR });
  assert.strictEqual(mid.length, evs.length);
  assert.ok(low.length < evs.length / 2, 'thinned to ' + low.length);
  assert.ok(low.some((e) => e.p === 36 && e.t === 0), 'kick on 1 stays');
  assert.ok(low.some((e) => e.p === 38 && e.t === T.BEAT), 'backbeat stays');
  assert.ok(!low.some((e) => e.v < 50 && e.p === 38), 'ghost goes');
});

test('pads are never thinned, and nothing is thinned to silence', () => {
  const pad = [{ t: 0, d: T.BAR, p: 60, v: 70, track: 'p' }, { t: 0, d: T.BAR, p: 64, v: 70, track: 'p' }];
  assert.strictEqual(S.shapeLane(pad, { role: 'pad', energy: 0, start: 0, end: T.BAR }).length, 2);
  const arp = [{ t: 7 * T.STEP, d: 60, p: 60, v: 30, track: 'a' }];
  assert.strictEqual(S.shapeLane(arp, { role: 'arp', energy: 0, start: 0, end: T.BAR }).length, 1);
});

test('energy scales velocity, and high energy doubles the lead', () => {
  const lead = [{ t: 0, d: 240, p: 72, v: 90, track: 'l' }];
  const quiet = S.shapeLane(lead, { role: 'lead', energy: 0.2, start: 0, end: T.BAR });
  const loud = S.shapeLane(lead, { role: 'lead', energy: 0.9, start: 0, end: T.BAR });
  assert.ok(quiet[0].v < 90 && loud[0].v > 90);
  assert.strictEqual(loud.length, 2);
  assert.strictEqual(loud[1].p, 84);
});

test('a ramp into a louder section makes the last bar louder', () => {
  const evs = [];
  for (let b = 0; b < 4; b++) evs.push({ t: b * T.BAR, d: 100, p: 48, v: 80, track: 'b' });
  const up = S.shapeLane(evs, { role: 'bass', energy: 0.5, start: 0, end: 4 * T.BAR, nextEnergy: 0.9 });
  const down = S.shapeLane(evs, { role: 'bass', energy: 0.5, start: 0, end: 4 * T.BAR, nextEnergy: 0.1 });
  assert.ok(up[3].v > up[0].v);
  assert.ok(down[3].v < down[0].v);
});

test('song events: a fill or build replaces the drum tail and lands on a crash', () => {
  const { s } = full(21);
  const drums = M.laneForRole(s, 'drums');
  const intro = s.sections.find((x) => x.name === 'Intro');
  const verse = s.sections.find((x) => x.name === 'Verse');
  intro.entry = 'auto';
  verse.entry = 'build';
  const song = R.songEvents(s);
  const m = song.markers;
  const verseIdx = m.findIndex((x) => x.name === 'Verse');
  const v = m[verseIdx];
  assert.strictEqual(v.entry, 'build');
  const prev = m[verseIdx - 1];
  // build: rising snare 16ths in the last beat before the verse
  const tail = song.events.filter((e) => e.track === drums.id && e.p === 38 && e.t >= prev.end - T.BEAT && e.t < prev.end);
  assert.ok(tail.length >= 4, 'snare build 16ths: ' + tail.length);
  assert.ok(tail[tail.length - 1].v > tail[0].v, 'build gets louder');
  assert.ok(song.events.some((e) => e.track === drums.id && e.t === v.start && e.p === 49), 'crash on landing');
});

test('a gap silences the last beat before the section', () => {
  const { s } = full(5);
  const chorus = s.sections.find((x) => x.name === 'Chorus');
  chorus.entry = 'gap';
  const song = R.songEvents(s);
  const c = song.markers.find((x) => x.name === 'Chorus');
  const inGap = song.events.filter((e) => e.t >= c.start - T.BEAT && e.t < c.start);
  assert.strictEqual(inGap.length, 0);
  const ringing = song.events.filter((e) => e.t < c.start - T.BEAT && e.t + e.d > c.start - T.BEAT);
  assert.strictEqual(ringing.length, 0, 'notes are cut at the gap');
});

test('turning shape off plays parts as written', () => {
  const { s } = full(8);
  s.shape.on = false;
  const off = R.songEvents(s);
  let expected = 0;
  for (const sid of s.arrangement) {
    const sec = M.findSection(s, sid);
    expected += R.sectionEvents(s, sec).length;
  }
  assert.strictEqual(off.events.length, expected);
  assert.ok(off.markers.every((m) => m.entry === 'none'));
});

test('humanize is deterministic, small, and keeps notes in range', () => {
  const { s } = full(9);
  const song = R.songEvents(s);
  const a = R.perform(s, song.events, { length: song.length });
  const b = R.perform(s, song.events, { length: song.length });
  assert.deepStrictEqual(a, b);
  const swung = R.applySwing(song.events, s.swing);
  assert.strictEqual(a.length, swung.length);
  for (const e of a) {
    assert.ok(e.t >= 0 && e.t < song.length);
    assert.ok(e.d >= 1 && e.t + e.d <= song.length);
    assert.ok(e.v >= 1 && e.v <= 127);
  }
  // nothing moves more than a 16th
  const key = (e) => e.track + ':' + e.p;
  const byKey = new Map();
  for (const e of swung) { if (!byKey.has(key(e))) byKey.set(key(e), []); byKey.get(key(e)).push(e.t); }
  for (const e of a) {
    const near = Math.min(...byKey.get(key(e)).map((t) => Math.abs(t - e.t)));
    assert.ok(near <= T.STEP, 'moved ' + near);
  }
  s.shape.humanize = 0;
  assert.deepStrictEqual(R.perform(s, song.events, { length: song.length }).map((e) => e.t), swung.slice().sort(R.byTime).map((e) => e.t));
});

test('humanize never overlaps repeated notes of one pitch', () => {
  const evs = [];
  for (let i = 0; i < 32; i++) evs.push({ t: i * T.STEP, d: T.STEP, p: 60, v: 90, track: 'x' });
  const out = S.humanize(evs, { amount: 1, roleOf: () => 'lead', length: 4 * T.BAR });
  const sorted = out.slice().sort((x, y) => x.t - y.t);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].t + sorted[i - 1].d <= sorted[i].t);
});

test('chords strum upwards', () => {
  const evs = [60, 64, 67, 71].map((p) => ({ t: 960, d: 400, p, v: 90, track: 'c' }));
  const out = S.humanize(evs, { amount: 1, roleOf: () => 'chords' });
  const order = out.slice().sort((x, y) => x.t - y.t).map((e) => e.p);
  assert.deepStrictEqual(order, [60, 64, 67, 71]);
});

test('migrate fills in shape settings and cleans section values', () => {
  const { ws, s } = starter();
  delete s.shape;
  s.sections[0].energy = 'loud';
  s.sections[1].energy = 3;
  s.sections[2].entry = 'explode';
  const back = M.migrate(JSON.parse(JSON.stringify(ws)));
  const t = back.sessions[0];
  assert.deepStrictEqual(t.shape, { on: true, humanize: 0.4, lift: true });
  assert.strictEqual(t.sections[0].energy, null);
  assert.strictEqual(t.sections[1].energy, 1);
  assert.strictEqual(t.sections[2].entry, 'auto');
});

test('song MIDI export includes the shaping', () => {
  const { s } = full(4);
  const shaped = Odd.midiFile.read(Odd.exporter.songMidi(s));
  s.shape.on = false;
  s.shape.humanize = 0;
  const plain = Odd.midiFile.read(Odd.exporter.songMidi(s));
  const count = (f) => f.tracks.reduce((n, t) => n + t.notes.length, 0);
  assert.notStrictEqual(count(shaped), count(plain));
});

test('triplet arps thin like straight 8ths, not like off-grid notes', () => {
  const evs = [];
  for (let i = 0; i < 12; i++) evs.push({ t: i * (T.BEAT / 3), d: 100, p: 60 + (i % 3), v: 80, track: 'a' });
  const out = S.shapeLane(evs, { role: 'arp', energy: 0.3, start: 0, end: T.BAR });
  assert.ok(out.length >= 10, 'kept ' + out.length + ' of 12');
});
