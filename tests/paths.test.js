'use strict';
// The Idea Builder's three ways in: a groove, a melody or a riff, each with its own first screens.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/model', 'core/idea',
  'core/audition',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const A = Odd.audition;
const F = A.flow;

/** pick option i (default the middle one) through every round until the idea is made */
function through(path, i) {
  let S = F.begin(F.fresh(), path);
  while (S.phase === 'round') S = F.pick(S, i == null ? 1 : i);
  return S;
}
function inRange(q) {
  return q.events.length > 0 && q.events.every((e) => e.t >= 0 && e.t < q.length && e.p >= 0 && e.p <= 127 && e.v > 0 && q.tracks[e.track]);
}

test('the Idea Builder opens on a choice of three, each starting on its own first round', () => {
  const S = F.fresh();
  assert.strictEqual(S.phase, 'start');
  assert.deepStrictEqual(A.PATH_ORDER, ['groove', 'melody', 'riff']);
  const first = { groove: 'pocket', melody: 'seed1', riff: 'rrhythm' };
  for (const p of A.PATH_ORDER) {
    const S1 = F.begin(S, p);
    assert.strictEqual(S1.phase, 'round');
    assert.strictEqual(S1.idea.path, p);
    assert.strictEqual(S1.round.dir, first[p]);
    assert.strictEqual(F.options(S1).length, 3);
    assert.ok(A.PATHS[p].line.length > 20, 'Bobby has a line for the ' + p + ' card');
    // each tap on a card is a new example
    const a = A.example(p, 1), b = A.example(p, 2);
    assert.ok(inRange(a) && inRange(b), p + ' examples play');
    assert.notDeepStrictEqual(a.events, b.events, p + ' examples differ');
  }
  // an idea saved before the paths has none, and is a melody
  assert.strictEqual(A.pathOf({ melody: null, layers: {}, order: [] }), 'melody');
});

test('a groove: a beat at a tempo, a bass that picks the chords, then chords on top or none', () => {
  let S = F.begin(F.fresh(), 'groove');
  const pockets = F.options(S);
  assert.ok(pockets.every((o) => o.bpm >= 56 && o.bpm <= 180 && o.k.length && o.m === '4/4'), 'each pocket is a beat with a tempo');
  assert.ok(F.info(S).total >= 60, 'the whole beat deck');
  // Slower and Faster move every tempo; Swing it swings them
  const bpm = (s) => F.options(s).map((o) => o.bpm);
  const slow = F.request(S, A.REQS.pocket.find((r) => r.t < 0));
  assert.ok(Math.max(...bpm(slow)) < Math.max(...F.options(F.request(S, A.REQS.pocket.find((r) => r.t > 0))).map((o) => o.bpm)));
  assert.ok(F.options(F.request(S, A.REQS.pocket.find((r) => r.x === 'swing'))).every((o) => o.swing > 0.5), 'swung');
  const pk = F.options(S)[1];
  S = F.pick(S, 1);
  assert.strictEqual(S.round.dir, 'gbass');
  assert.deepStrictEqual(S.idea.order, ['pocket']);
  assert.strictEqual(A.seq(S.idea, null).bpm, pk.bpm, 'the groove plays at its pocket’s tempo');

  const basses = A.grooveBass(S.idea, {});
  assert.ok(basses.length >= 60, basses.length + ' bass lines');
  assert.ok(new Set(basses.map((b) => b.scale)).size >= 5, 'in many scales');
  assert.ok(basses.some((b) => b.move === 'stay') && basses.some((b) => b.move !== 'stay'), 'some stay on one chord, some move');
  assert.ok(basses.every((b) => b.chords.every((c) => c.q !== '°' && c.q !== '+')), 'no diminished chords');
  const lock = basses.find((b) => b.fam === 'lock');
  assert.ok(lock.notes.every((n) => pk.k.indexOf(n.s) >= 0), 'Locks to the kick plays on the kicks');
  assert.ok(basses.every((b) => b.notes.every((n) => n.m >= 36 && n.m < 72)), 'in the bass range');
  // Darker and Brighter change the scales on offer
  const dark = A.grooveBass(S.idea, { c: -2 }), bright = A.grooveBass(S.idea, { c: 2 });
  assert.ok(dark.every((b) => ['phrygian', 'minor'].indexOf(b.scale) >= 0) && bright.every((b) => ['mixolydian', 'major'].indexOf(b.scale) >= 0));

  const bass = F.options(S)[1];
  S = F.pick(S, 1);
  assert.strictEqual(S.round.dir, 'keys');
  assert.deepStrictEqual(A.chordsFor(S.idea), bass.chords, 'the bass sets the chords');
  const keys = F.options(S);
  const pcs = (c) => c.pcs;
  keys.forEach((k) => k.notes.forEach((n) => {
    const ch = bass.chords[A.slotsOf(A.ideaMeter(S.idea)).findIndex((sl, i, a) => n.s >= sl.s && (i === a.length - 1 || n.s < a[i + 1].s))];
    assert.ok(ch, 'a chord under every key note');
    assert.ok(n.ms.length >= 2, 'chords, not single notes');
    assert.ok(pcs(ch).indexOf(n.ms[0] % 12) >= 0, 'voiced from its chord');
  }));
  // no chords is a way out of its own
  assert.strictEqual(A.ownLabel('keys'), 'No chords: drums and bass are enough');
  const none = F.own(S);
  assert.strictEqual(none.phase, 'next');
  assert.ok(none.idea.layers.keys.none);
  assert.ok(!Object.keys(A.seq(none.idea, null).tracks).includes('b2g-kys'), 'no chords track');
  assert.deepStrictEqual(A.directions(none.idea), ['perc', 'hook', 'pads', 'sound']);
  assert.ok(F.canFinish(none), 'a groove is an idea once its chords are settled');
});

test('a groove can grow a hook: a rhythm in the gaps, then its shape, and nothing under it is lost', () => {
  let S = through('groove');
  const before = JSON.stringify(S.idea.layers);
  S = F.enter(S, 'hook');
  const gaps = F.options(F.request(S, A.REQS.hook.find((r) => r.x === 'gaps')));
  const all = A.hookStyles(S.idea);
  const avg = (xs) => xs.reduce((a, o) => a + o.clash, 0) / xs.length;
  assert.ok(avg(gaps) <= avg(all), 'In the gaps keeps the ones that dodge the bass and kick');
  assert.ok(F.options(S).every((o) => o.mel.scale === S.idea.layers.gbass.scale), 'in the groove’s scale');
  S = F.pick(S, 1);
  assert.strictEqual(S.round.dir, 'seed2', 'then its shape');
  // leaving the shape round keeps no half-made tune
  const left = F.skip(S);
  assert.strictEqual(left.idea.melody, null);
  assert.ok(!A.seq(left.idea, null).tracks['b2g-mel']);
  S = F.pick(S, 1);
  assert.strictEqual(S.phase, 'next');
  assert.deepStrictEqual(S.idea.order, ['pocket', 'gbass', 'keys', 'hook']);
  assert.strictEqual(JSON.stringify(Object.assign({}, S.idea.layers, { hook: undefined })), JSON.stringify(Object.assign(JSON.parse(before), { hook: undefined })), 'the groove under it is untouched');
  assert.ok(A.seq(S.idea, null).tracks['b2g-mel'], 'the hook plays');
  const parts = A.toParts(S.idea);
  assert.deepStrictEqual(parts.map((p) => p.label), ['Hook', 'Beat', 'Bass', 'Chords']);
  assert.ok(F.canFinish(S));
});

test('a riff: a rhythm with accents, its notes, its weight; then drums and what goes under it', () => {
  let S = F.begin(F.fresh(), 'riff');
  const rhythms = A.riffPool();
  assert.ok(rhythms.length >= 60, rhythms.length + ' riff rhythms');
  assert.ok(rhythms.every((r) => r.hits.some((h) => h[2] === 2)), 'every riff has accents');
  assert.ok(rhythms.some((r) => r.hits.some((h) => h[2] === 0)), 'some hits are muted');
  assert.ok(rhythms.some((r) => r.fam === 'threes'), 'accents in threes cross the beat');
  assert.deepStrictEqual(A.threesOf(Odd.theory.meter('4/4')), [0, 3, 6, 8, 11, 14]);
  // on one note, with a hat counting until there are drums
  const q = A.seq(S.idea, { dir: 'rrhythm', spec: F.options(S)[0] });
  assert.strictEqual(new Set(q.events.filter((e) => e.track === 'b2g-rhi').map((e) => e.p)).size, 1, 'one note');
  assert.ok(q.tracks['b2g-tik'], 'a hat counts the beat');
  const offs = (s) => F.options(s).reduce((a, o) => a + o.r.off, 0);
  assert.ok(offs(F.request(S, A.REQS.rrhythm.find((r) => r.p > 0))) >= offs(F.request(S, A.REQS.rrhythm.find((r) => r.p < 0))), 'Against the beat moves the accents off it');

  const r = F.options(S)[1].r;
  S = F.pick(S, 1);
  assert.strictEqual(S.round.dir, 'rnotes');
  const notes = A.riffNoteStyles(S.idea.riff);
  assert.ok(notes.length >= 12, notes.length + ' note patterns');
  assert.ok(notes.every((o) => o.ms.length === r.hits.length), 'a note for every hit');
  const bar = Odd.theory.meter(r.m).steps;
  assert.ok(notes.every((o) => o.ms.every((x, i) => x === 0 || r.hits[i][0] % bar !== 0)), 'each bar starts home');
  const odd = F.options(F.request(S, A.REQS.rnotes.find((x) => x.x === 'odd')));
  assert.ok(odd.every((o) => o.odd), 'Stranger deals the ones outside the scale');
  S = F.pick(S, 1);
  assert.strictEqual(S.round.dir, 'weight');
  const power = A.weightStyles().find((w) => w.fam === 'power');
  const ws = A.seq(S.idea, { dir: 'weight', spec: power });
  const at0 = ws.events.filter((e) => e.t === 0 && /b2g-r/.test(e.track)).map((e) => e.p).sort((a, b) => a - b);
  assert.deepStrictEqual(at0.slice(1).map((p) => p - at0[1]), [0, 7, 12], 'power chords: root, fifth, octave over the bass');
  assert.strictEqual(A.riffPitch({ part: 'high', off: 'third' }, 0, 'minor'), 48 + 3, 'a third up in minor is the ♭3');
  S = F.pick(S, 1);
  assert.strictEqual(S.phase, 'next');
  assert.ok(F.canFinish(S));
  assert.deepStrictEqual(A.directions(S.idea), ['drums', 'under', 'perc', 'sound']);
  assert.ok(!A.seq(S.idea, null).tracks['b2g-tik'], 'once it is a riff, no counting');

  // drums: some made from the riff, sorted with the riff to against it
  const kits = A.riffKits(S.idea);
  const doubled = kits.find((k) => k.fam === 'riff-double');
  assert.ok(doubled && doubled.follow === 1, 'a kick that doubles the riff');
  assert.ok(kits.some((k) => k.follow < 0.4), 'and kits that push against it');
  // under it: drones and chords that move; the riff stays the same
  const under = A.underStyles(S.idea);
  assert.ok(under.some((u) => !u.changes) && under.some((u) => u.changes), 'drones and moving chords');
  assert.ok(under.every((u) => u.chords[0].root === 0), 'they start home');
  const riffEvents = (idea) => A.seq(idea, null).events.filter((e) => /b2g-r/.test(e.track));
  const moved = F.pick(F.enter(S, 'under'), 2);
  assert.deepStrictEqual(riffEvents(moved.idea), riffEvents(S.idea), 'the riff never changes under it');
  assert.strictEqual(A.SKIP_LABEL.under, 'Nothing under it');
});

test('every path builds in every meter, then plays, climbs, saves, and loads back', () => {
  for (const p of A.PATH_ORDER) for (const meter of A.METER_ORDER) {
    let S = F.begin(F.fresh(), p);
    const rq = A.REQS[S.round.dir].find((r) => r.m);
    while (A.ideaMeter(S.idea, { dir: S.round.dir, spec: F.options(S)[0] }).id !== meter) S = F.request(S, rq);
    while (S.phase === 'round') S = F.pick(S, 0);
    for (const d of A.directions(S.idea)) { S = F.pick(F.enter(S, d), 2); while (S.phase === 'round') S = F.pick(S, 0); }
    const w = p + ' in ' + meter;
    assert.strictEqual(A.ideaMeter(S.idea).id, meter, w);
    assert.ok(inRange(A.seq(S.idea, null)), w + ' plays');
    const climb = A.climb(S.idea);
    assert.strictEqual(climb.length, A.lineage(S.idea).length, w + ': a card per pass of the climb');
    assert.strictEqual(climb.length, A.climbLines(S.idea).length, w + ': a line per pass');
    assert.ok(climb.every(inRange), w + ' climbs');
    const made = Odd.idea.fromParts(A.toParts(S.idea).map((x) => ({ part: x.part })));
    assert.ok(made && made.voices.length >= 3, w + ' saves');
    assert.strictEqual(Odd.idea.meterOf(made) || '4/4', meter, w + ' keeps its meter');
    const kept = Odd.idea.repair(Object.assign({}, made, { bones: S.idea }));
    assert.strictEqual(kept.bones && kept.bones.path, p, w + ': the shelf keeps how it was built');
    const back = F.repair(JSON.parse(JSON.stringify(Object.assign({}, S, { phase: 'gold' }))));
    assert.strictEqual(back.phase, 'gold', w + ' loads back');
    assert.ok(A.ideaName(S.idea).length > 3, w + ' has a name');
  }
});

test('a groove keeps its tempo through its sound; a riff picks its tempo there', () => {
  let S = through('groove');
  const bpm = S.idea.layers.pocket.bpm;
  const sounds = A.soundStyles(S.idea);
  assert.ok(sounds.length >= 20 && sounds.every((o) => o.bpm === bpm), 'every groove sound at ' + bpm);
  S = F.pick(F.enter(S, 'sound'), 1);
  assert.strictEqual(A.seq(S.idea, null).bpm, bpm);
  let R = through('riff');
  const rs = A.soundStyles(R.idea);
  assert.ok(new Set(rs.map((o) => o.bpm)).size >= 8, 'riff sounds at many tempos');
  assert.ok(rs.some((o) => o.patches.lead === 'grit'), 'a gritty guitar among them');
  R = F.pick(F.enter(R, 'sound'), 0);
  const snd = R.idea.layers.sound;
  const q = A.seq(R.idea, null);
  assert.strictEqual(q.bpm, snd.bpm);
  if (q.tracks['b2g-rhi']) assert.strictEqual(q.tracks['b2g-rhi'].patch, snd.patches.lead, 'the sound dresses the riff');
  assert.ok(Odd.synth === undefined || Odd.synth.PATCHES.grit, 'the synth has the gritty patch');
});
