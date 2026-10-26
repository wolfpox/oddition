'use strict';
// Ideas: the core of a part (rhythm, weight, contour, landing), apart from key, chords and sound.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/model', 'core/idea',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const M = Odd.model;
const I = Odd.idea;
const { BAR, BEAT, STEP } = T;

const prog = [{ deg: 0, beats: 4 }, { deg: 5, beats: 4 }];

function lead(notes, extra) {
  return Object.assign({ id: 'p1', name: 'Test Line', role: 'lead', style: 'pop', bars: 2, base: 72, ctx: { tonic: 0, scale: 'minor', prog }, notes }, extra);
}

function gen(role, seed, opts) {
  return Odd.gen.generate(Object.assign({ role, style: 'pop', seed, bars: 2, tonic: 0, scale: 'minor', prog }, opts));
}

test('a line becomes rhythm, weight and contour in scale steps from its first note', () => {
  const part = lead([
    { t: 0, d: BEAT, v: 110, deg: 2 },
    { t: BEAT, d: STEP, v: 60, deg: 3 },
    { t: BEAT + STEP, d: STEP, v: 70, deg: 4 },
    { t: 2 * BEAT, d: 2 * BEAT, v: 100, deg: 6, acc: 1 },
    { t: BAR, d: BAR, v: 100, deg: 2 },
  ]);
  const c = I.extract(part);
  assert.strictEqual(c.len, 2 * BAR);
  assert.strictEqual(c.drum, false);
  assert.strictEqual(c.root, 2);
  assert.deepStrictEqual(c.hits.map((x) => x.t), [0, BEAT, BEAT + STEP, 2 * BEAT, BAR]);
  assert.deepStrictEqual(c.hits.map((x) => x.h), [0, 1, 2, 4, 0], 'accidentals are colour, not contour');
  assert.strictEqual(c.hits[0].w, 2, 'a loud downbeat is an accent');
  assert.strictEqual(c.hits[1].w, 0, 'a soft off-beat 16th is a ghost');
  assert.strictEqual(c.hits[c.land].t, BAR, 'it lands on the long note at the top of bar 2');
  assert.strictEqual(I.contourOf(c), 'arches');
});

test('the core does not change with key, register or chords: those are influence', () => {
  const part = gen('lead', 99);
  const base = I.extract(part);
  const moved = Object.assign(M.clone(part), { base: part.base - 24, ctx: { tonic: 7, scale: 'dorian', prog: [{ deg: 3, beats: 8 }] } });
  assert.deepStrictEqual(I.extract(moved), base);
  // and it is the same core however often it is read
  assert.deepStrictEqual(I.extract(part), base);
});

test('a chord part is heard as its top line, a bass part as its bottom', () => {
  const chord = (t, degs) => degs.map((deg) => ({ t, d: BEAT, v: 90, deg }));
  const notes = [...chord(0, [0, 2, 4]), ...chord(BEAT, [1, 3, 5]), ...chord(2 * BEAT, [-1, 1, 3])];
  const top = I.extract({ role: 'chords', bars: 1, base: 60, notes });
  assert.deepStrictEqual(top.hits.map((x) => x.h), [0, 1, -1]);
  const bottom = I.extract({ role: 'bass', bars: 1, base: 36, notes });
  assert.strictEqual(bottom.root, 0);
  assert.deepStrictEqual(bottom.hits.map((x) => x.h), [0, 1, -1]);
});

test('drums become low, mid and high hits, one per onset and height', () => {
  const part = { role: 'drums', bars: 1, base: null, notes: [
    { t: 0, d: 60, v: 115, p: 36 }, { t: 0, d: 60, v: 80, p: 42 }, { t: 0, d: 60, v: 100, p: 41 },
    { t: BEAT, d: 60, v: 110, p: 38 }, { t: BEAT, d: 60, v: 60, p: 42 },
    { t: 2 * BEAT, d: 60, v: 115, p: 36 },
    { t: 3 * BEAT + STEP, d: 60, v: 40, p: 38 },
  ] };
  const c = I.extract(part);
  assert.strictEqual(c.drum, true);
  assert.strictEqual(c.root, null);
  assert.deepStrictEqual(c.hits.map((x) => [x.t, x.h]), [[0, 0], [0, 2], [BEAT, 1], [BEAT, 2], [2 * BEAT, 0], [3 * BEAT + STEP, 1]]);
  assert.strictEqual(c.hits[0].w, 2, 'kick on one is strong');
  assert.strictEqual(c.hits[5].w, 0, 'a soft late snare is a ghost');
  assert.match(I.describe({ core: c }), /6 hits/);
});

test('every stem of every style gives a usable core and a description', () => {
  for (const style of ['lofi', 'house', 'trap', 'ambient', 'dnb']) {
    for (const role of Odd.gen.ROLES) {
      const part = gen(role, 7, { style, bars: 4 });
      const v = I.voiceFrom({ part });
      assert.ok(v.core.hits.length > 0, style + ' ' + role + ' has hits');
      assert.ok(v.core.land >= 0 && v.core.land < v.core.hits.length);
      for (const x of v.core.hits) {
        assert.ok(x.t >= 0 && x.t < v.core.len && x.d > 0 && x.t + x.d <= v.core.len);
        assert.ok([0, 1, 2].includes(x.w));
      }
      assert.ok(I.describe(v).length > 10);
    }
  }
});

test('a part captured in a form keeps that form in its core', () => {
  const part = gen('lead', 21, { bars: 4 });
  const full = I.voiceFrom({ part });
  const frag = I.voiceFrom({ part, form: 'fragment' });
  assert.strictEqual(frag.form, 'fragment');
  const firstBar = full.core.hits.filter((x) => x.t < BAR).map((x) => [x.t, x.h]);
  const fragBar3 = frag.core.hits.filter((x) => x.t >= 2 * BAR && x.t < 3 * BAR).map((x) => [x.t - 2 * BAR, x.h]);
  assert.deepStrictEqual(fragBar3, firstBar, 'a fragment repeats the first bar');
});

test('ideas hold several voices, split apart and join together', () => {
  const a = gen('lead', 3);
  const b = gen('bass', 4, { bars: 1 });
  const idea = I.fromParts([{ part: a, sourceId: 'shelf-a' }, { part: b, oct: -1 }], { style: 'pop' });
  assert.strictEqual(idea.voices.length, 2);
  assert.strictEqual(idea.bars, 2, 'as long as its longest voice');
  assert.strictEqual(idea.name, a.name + ' & ' + b.name);
  assert.strictEqual(idea.voices[0].sourceId, 'shelf-a');
  assert.strictEqual(idea.voices[1].oct, -1);
  assert.notStrictEqual(idea.voices[0].part, a, 'the part is a copy');

  const solo = I.split(idea, 1);
  assert.strictEqual(solo.voices.length, 1);
  assert.strictEqual(solo.voices[0].role, 'bass');
  assert.strictEqual(solo.bars, 1);
  assert.notStrictEqual(solo.id, idea.id);

  assert.ok(I.removeVoice(idea, 1));
  assert.strictEqual(idea.voices.length, 1);
  assert.strictEqual(I.removeVoice(idea, 0), null, 'an idea keeps its last voice');

  const joined = I.join([idea, solo]);
  assert.deepStrictEqual(joined.voices.map((v) => v.role), ['lead', 'bass']);
  assert.strictEqual(joined.from, 'join');
});

test('bones play the core alone: same rhythm, plain steps, weight as velocity', () => {
  const part = lead([
    { t: 0, d: BEAT, v: 110, deg: 2 },
    { t: BEAT, d: BEAT, v: 75, deg: 3, acc: 1 },
    { t: 3 * BEAT + STEP, d: STEP, v: 40, deg: 1 },
  ], { bars: 1 });
  const idea = I.fromParts([{ part }]);
  assert.deepStrictEqual(idea.voices[0].core.hits.map((x) => x.w), [2, 1, 0]);
  const evs = I.bonesEvents(idea.voices[0], { tonic: 0, scale: 'major', length: 2 * BAR });
  assert.strictEqual(evs.length, 6, 'a one-bar voice loops');
  // E, F (no sharp: chromatic colour is influence), D in C major, from the part's own register
  assert.deepStrictEqual(evs.slice(0, 3).map((e) => e.p), [76, 77, 74]);
  assert.ok(evs[0].v > evs[1].v && evs[1].v > evs[2].v);
  const drums = I.fromParts([{ part: gen('drums', 5, { bars: 1 }) }]);
  const dev = I.bonesEvents(drums.voices[0], {});
  assert.ok(dev.every((e) => [36, 38, 42].includes(e.p)), 'drum bones are kick, snare and hat');
});

test('full playback is the part as found; idea events put each voice on its own track', () => {
  const a = gen('lead', 8);
  const b = gen('bass', 9);
  const idea = I.fromParts([{ part: a }, { part: b, oct: 1 }]);
  const full = I.events(idea, { mode: 'full', tonic: 0, scale: 'minor' });
  const direct = Odd.render.partEvents(a, { tonic: 0, scale: 'minor', prog, length: 2 * BAR });
  assert.deepStrictEqual(full.filter((e) => e.track === '__v0').map((e) => [e.t, e.p]), direct.map((e) => [e.t, e.p]));
  const bassUp = full.filter((e) => e.track === '__v1');
  const bassAsIs = Odd.render.partEvents(b, { tonic: 0, scale: 'minor', prog, length: 2 * BAR });
  assert.deepStrictEqual(bassUp.map((e) => e.p - 12), bassAsIs.map((e) => e.p), 'the octave it was found in comes along');
  const muted = I.events(idea, { mode: 'bones', mute: [0] });
  assert.ok(muted.length > 0 && muted.every((e) => e.track === '__v1'));
});

test('ideas live in the workspace and survive loading, broken ones are dropped', () => {
  const ws = M.createWorkspace({ seed: 3, style: 'pop' });
  assert.deepStrictEqual(ws.ideas, []);
  const idea = I.fromParts([{ part: gen('lead', 1) }, { part: gen('drums', 2) }]);
  M.addIdea(ws, idea);
  assert.strictEqual(M.findIdea(ws, idea.id), idea);
  const raw = JSON.parse(JSON.stringify(ws));
  raw.ideas.push({ id: 5, name: 'Broken', voices: [{ role: 'lead' }] }, null, { voices: 'no' });
  delete raw.ideas[0].voices[1].core; // a missing core is rebuilt from its part
  const back = M.migrate(raw);
  assert.strictEqual(back.ideas.length, 1);
  assert.strictEqual(typeof back.ideas[0].id, 'string');
  assert.deepStrictEqual(back.ideas[0].voices[1].core, idea.voices[1].core);
  M.removeIdea(back, idea.id);
  assert.strictEqual(back.ideas.length, 0);
  // workspaces from before ideas get an empty list
  const old = JSON.parse(JSON.stringify(ws));
  delete old.ideas;
  assert.deepStrictEqual(M.migrate(old).ideas, []);
});

test('words for places in the bar', () => {
  assert.strictEqual(I.placeName(0, BAR), 'beat 1');
  assert.strictEqual(I.placeName(BAR + 2 * BEAT, 2 * BAR), 'bar 2, beat 3');
  assert.strictEqual(I.placeName(BEAT / 2, BAR), 'the and of 1');
  assert.strictEqual(I.placeName(3 * BEAT + STEP, BAR), 'just after beat 4');
});

test('the ladder: each step adds one layer', () => {
  const part = gen('chords', 31);
  const idea = I.fromParts([{ part }]);
  const v = idea.voices[0];
  const tgt = { tonic: 0, scale: 'minor', length: 2 * BAR };
  assert.deepStrictEqual(I.RUNGS.map((r) => r.id), ['rhythm', 'shape', 'notes', 'harmony', 'sound', 'band']);

  const rhythm = I.voiceAt(v, 'rhythm', tgt);
  const shape = I.voiceAt(v, 'shape', tgt);
  assert.strictEqual(new Set(rhythm.map((e) => e.p)).size, 1, 'rhythm is one sound');
  assert.deepStrictEqual(rhythm.map((e) => e.t), shape.map((e) => e.t), 'shape keeps the rhythm and adds movement');
  assert.deepStrictEqual(rhythm.map((e) => e.v), shape.map((e) => e.v));

  const notes = I.voiceAt(v, 'notes', tgt);
  assert.ok(notes.length > shape.length, 'notes brings the whole chords back');
  assert.deepStrictEqual(notes, Odd.render.partEvents(part, Object.assign({ prog }, tgt)));

  const other = [{ deg: 3, beats: 4 }, { deg: 4, beats: 4 }];
  const fitted = I.voiceAt(v, 'harmony', Object.assign({ prog: other }, tgt));
  assert.deepStrictEqual(fitted, Odd.render.partEvents(part, Object.assign({ prog: other }, tgt)), 'harmony bends it to the target chords');
  assert.notDeepStrictEqual(fitted.map((e) => e.p), notes.map((e) => e.p));
  assert.deepStrictEqual(I.voiceAt(v, 'harmony', tgt), notes, 'with no target chords, harmony is its own chords');
  assert.deepStrictEqual(I.voiceAt(v, 'band', Object.assign({ prog: other }, tgt)), fitted, 'sound and band play the same notes');
});

test('the ladder: drums tap once per onset, imported parts keep their notes, cores alone play bones', () => {
  const drums = I.fromParts([{ part: gen('drums', 12, { bars: 1 }) }]).voices[0];
  const taps = I.voiceAt(drums, 'rhythm', {});
  assert.ok(taps.every((e) => e.p === 37));
  assert.strictEqual(new Set(taps.map((e) => e.t)).size, taps.length, 'kick and hat together are one tap');

  const imported = Object.assign(gen('lead', 13), { imported: true });
  const iv = I.fromParts([{ part: imported }]).voices[0];
  const tgt = { tonic: 0, scale: 'minor', length: 2 * BAR };
  assert.deepStrictEqual(I.voiceAt(iv, 'harmony', Object.assign({ prog: [{ deg: 4, beats: 8 }] }, tgt)), I.voiceAt(iv, 'notes', tgt));

  const bare = Object.assign({}, iv, { part: null });
  assert.deepStrictEqual(I.voiceAt(bare, 'notes', tgt), I.voiceAt(bare, 'shape', tgt));

  const two = I.fromParts([{ part: gen('lead', 1) }, { part: gen('bass', 2) }]);
  const evs = I.rungEvents(two, { rung: 'rhythm', length: 4 * BAR, mute: [1], prefix: '__v' });
  assert.ok(evs.length && evs.every((e) => e.track === '__v0' && e.t < 4 * BAR));
  assert.ok(evs.some((e) => e.t >= 2 * BAR), 'a step loops the idea to the length asked for');
});
