'use strict';
// Bones to Gold: an idea built from the bottom up, three clearly different options per round.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/model', 'core/idea',
  'core/audition',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const A = Odd.audition;
const F = A.flow;

/** a melody picked through both seed rounds */
function melodyState(i1, i2) {
  let S = F.enter(F.fresh(), 'seed1');
  S = F.pick(S, i1 == null ? 1 : i1);
  return F.pick(S, i2 == null ? 1 : i2);
}

/** add each layer, picking option i */
function build(S, dirs, i) {
  for (const d of dirs) S = F.pick(F.enter(S, d), i == null ? 1 : i);
  return S;
}

test('round 1 offers three rhythm-and-scale options spread from sparse to busy', () => {
  const S = F.enter(F.fresh(), 'seed1');
  const opts = F.options(S);
  assert.strictEqual(opts.length, 3);
  const ns = opts.map((o) => o.mel.r.n);
  assert.ok(ns[0] < ns[1] && ns[1] < ns[2], 'densities rise: ' + ns.join(', '));
  assert.ok(ns[2] - ns[0] >= 8, 'sparse and busy are far apart: ' + ns.join(', '));
  assert.strictEqual(new Set(opts.map((o) => o.mel.scale)).size, 3, 'three different scales');
  for (const o of opts) {
    assert.strictEqual(o.mel.shape, null, 'no shape yet');
    assert.ok(!('style' in o.mel) && !('genre' in o.mel), 'nothing about a style is chosen yet');
  }
});

test('three more gives a new batch; busier and darker requests steer it', () => {
  const S = F.enter(F.fresh(), 'seed1');
  // several presses of "three more" keep bringing rhythms not heard yet, still spread sparse to busy
  const seen = new Set();
  let st = S;
  for (let b = 0; b < 5; b++) {
    const opts = F.options(st);
    for (const o of opts) { assert.ok(!seen.has(o.mel.r.id), 'batch ' + b + ' repeats ' + o.mel.r.id); seen.add(o.mel.r.id); }
    assert.ok(opts[2].mel.r.n - opts[0].mel.r.n >= 8, 'batch ' + b + ' still spread');
    st = F.more(st);
  }
  // the deck: back and forth without anything changing, every card once, then a shuffle
  const two = F.next(F.next(S));
  assert.deepStrictEqual(F.options(F.prev(two)).map((o) => o.mel.r.id), F.options(F.next(S)).map((o) => o.mel.r.id), 'previous brings the same three back');
  assert.strictEqual(F.prev(S), S, 'nothing before the first three');
  assert.strictEqual(two.hist.length, S.hist.length, 'moving through the deck leaves no history');
  const inf = F.info(S), all = new Set();
  let d = S;
  for (let b = 0; b < inf.batches; b++) { F.options(d).forEach((o) => all.add(o.mel.r.id)); d = F.next(d); }
  assert.strictEqual(all.size, inf.total, 'every rhythm in the pool comes up once');
  assert.strictEqual(inf.total, A.rhythmPool().length);
  assert.ok(d.round.deal === 1 && d.round.batch === 0 && d.msg === 'shuffled', 'then the deck is shuffled');
  assert.notDeepStrictEqual(F.options(d).map((o) => o.mel.r.id), F.options(S).map((o) => o.mel.r.id), 'and dealt in new threes');

  const mean = (st) => F.options(st).reduce((a, o) => a + o.mel.r.n, 0) / 3;
  const busier = F.request(S, A.REQS.seed1.find((r) => r.label === 'Busier'));
  assert.ok(mean(busier) > mean(S), 'busier means more notes');
  assert.strictEqual(busier.sel, 1, 'the middle one is up next');
  const darker = F.request(S, A.REQS.seed1.find((r) => r.label === 'Darker scale'));
  const dark = A.SCALE_ORDER.slice(0, 4);
  assert.ok(F.options(darker).every((o) => dark.includes(o.mel.scale)), 'darker keeps to the darker scales');
});

test('round 2 shapes keep the rhythm and scale, move smoothly, and land where they say', () => {
  let S = F.enter(F.fresh(), 'seed1');
  const pick = F.options(S)[1];
  S = F.pick(S, 1);
  assert.strictEqual(S.round.dir, 'seed2');
  const check = (st, maxLeap) => {
    const opts = F.options(st);
    assert.ok(opts.length >= 3);
    for (const o of opts) {
      assert.strictEqual(o.mel.r, pick.mel.r);
      assert.strictEqual(o.mel.scale, pick.mel.scale);
      const ns = A.melodyNotes(o.mel);
      assert.strictEqual(T.mod(ns[ns.length - 1].m, 12), o.land, A.tagOf('seed2', o) + ' lands on ' + A.IV[o.land]);
      if (maxLeap != null) for (let i = 1; i < ns.length; i++) assert.ok(Math.abs(ns[i].deg - ns[i - 1].deg) <= maxLeap);
    }
    return opts;
  };
  const opts = check(S, 2);
  assert.ok(opts[0].end <= opts[2].end, 'from an answer (falls) to a question (rises)');
  const home = F.request(S, A.REQS.seed2.find((r) => r.label === 'Land on home'));
  assert.ok(check(home).every((o) => o.land === 0), 'land on home');
  const jumpy = F.request(S, A.REQS.seed2.find((r) => r.label === 'More jumps'));
  assert.ok(F.options(jumpy).every((o) => o.leap >= 3), 'more jumps');
});

test('round 2 mixes a small, a medium and a big shape; Subtler and Bigger move all three', () => {
  const range = (o) => { const ds = A.melodyNotes(o.mel).map((n) => n.deg); return Math.max.apply(null, ds) - Math.min.apply(null, ds); };
  const kinds = new Set();
  for (const r of A.rhythmPool().slice(0, 30)) {
    const S = { phase: 'round', idea: { melody: { r, scale: 'dorian', shape: null }, layers: {}, order: [] }, round: { dir: 'seed2', batch: 0, steer: { p: 0, s: 0, x: null } } };
    const opts = F.options(S);
    assert.deepStrictEqual(opts.map((o) => o.size).sort(), [0, 1, 2], 'one of each size');
    assert.strictEqual(new Set(opts.map((o) => o.mel.shape.kind)).size, 3, 'three different shapes');
    opts.forEach((o) => { kinds.add(o.mel.shape.kind); assert.ok(range(o) <= 7, 'no more than an octave'); });
    const subtle = F.request(S, A.REQS.seed2.find((q) => q.label === 'Subtler'));
    assert.ok(F.options(subtle).every((o) => range(o) <= 2), 'subtler: two scale steps or less');
    const flatter = F.request(F.request(subtle, A.REQS.seed2[0]), A.REQS.seed2[0]);
    assert.ok(F.options(flatter).every((o) => range(o) <= 1), 'subtler three times: one scale step at most');
    assert.strictEqual(F.request(flatter, A.REQS.seed2[0]).round.steer.s, -3, 'a fourth press stays put');
    const bigger = F.request(S, A.REQS.seed2.find((q) => q.label === 'Bigger'));
    assert.ok(F.options(bigger).every((o) => range(o) >= 3), 'bigger: no small ones');
    const sum = (os) => os.reduce((t, o) => t + range(o), 0);
    assert.ok(sum(F.options(bigger)) > sum(opts), 'bigger moves further than the default three');
  }
  assert.ok(kinds.size >= 12, 'different rhythms get different shapes, not the same three');
});

test('every round deals its whole pool, three at a time, each card once; the unusual ones come later', () => {
  const keyOf = (d, o) => d === 'seed1' ? o.mel.r.id : d === 'seed2' ? o.mel.shape.kind + o.mel.shape.amp : d === 'chords' ? JSON.stringify(o.chords) : o.id || o.tag;
  let S = F.enter(F.fresh(), 'seed1');
  const rounds = [S];
  S = F.pick(S, 1);
  rounds.push(S);
  S = F.pick(S, 1);
  for (const d of ['chords', 'bass', 'pads', 'perc', 'beat', 'sound']) rounds.push(F.enter(S, d));
  for (const R of rounds) {
    const d = R.round.dir, inf = F.info(R), seen = new Set();
    let st = R;
    for (let b = 0; b < inf.batches; b++) {
      const opts = F.options(st);
      assert.ok(opts.length >= 1 && opts.length <= 3, d);
      for (const o of opts) { const k = keyOf(d, o); assert.ok(!seen.has(k), d + ' deals ' + k + ' twice'); seen.add(k); }
      st = F.next(st);
    }
    assert.strictEqual(seen.size, inf.total, d + ': every card in the pool comes up');
    assert.ok(inf.batches >= Math.ceil(inf.total / 3), d);
  }
  // shapes past an octave or with big jumps, and chord paths that fit less, wait until the usual ones are dealt
  const shapes = rounds[1], sInf = F.info(shapes);
  let st = shapes, firstRare = -1;
  for (let b = 0; b < sInf.batches; b++) { F.options(st).forEach((o) => { if (o.rare && firstRare < 0) firstRare = b; }); st = F.next(st); }
  assert.ok(firstRare > 0, 'no unusual shape in the first three');
  assert.ok(A.rhythmPool().length === 80 && F.info(rounds[0]).total === 80);
});

test('later layers come from ingredients: big pools, families mixed in each three, plain versions first', () => {
  const S = melodyState();
  for (const d of ['bass', 'pads', 'perc', 'beat', 'sound']) {
    const R = F.enter(S, d), inf = F.info(R);
    assert.ok(inf.total >= 40, d + ' has a real pool: ' + inf.total);
    const first = F.options(R);
    assert.strictEqual(new Set(first.map((o) => o.fam)).size, 3, d + ': the first three are three different families');
    // (a band can be all variations: beats in the middle band are the ones with a half-time or late snare)
    if (d !== 'pads') assert.ok(first.filter((o) => !o.twist).length >= 2, d + ': the first three are mostly plain versions');
  }
  const kits = A.kitsFor(T.meter('4/4'));
  assert.deepStrictEqual(kits.find((k) => k.id === 'four-back-e8').k.slice(0, 4), [0, 4, 8, 12], 'four on the floor keeps the kick under the snare');
  assert.ok(A.bassStyles(melodyState().idea).every((b) => b.notes.length >= 2), 'every bass line has a note a bar');
  // a sound that swaps the lead carries its instruments into the sequence
  const swap = A.soundStyles(S.idea).find((o) => o.genre === 'lofi' && o.patches.lead !== A.GENRES.lofi.patches.lead);
  assert.ok(swap && /with/.test(swap.tag), 'lo-fi comes with another lead too');
  assert.strictEqual(swap.patches.kit, A.GENRES.lofi.patches.kit, 'the rest of the recipe stays');
  const sq = A.seq(S.idea, { dir: 'sound', spec: swap });
  assert.strictEqual(sq.tracks[A.TRACK.mel].patch, swap.patches.lead);
});

test('keep the plain walk keeps round 1 exactly', () => {
  let S = F.enter(F.fresh(), 'seed1');
  const walked = A.melodyNotes(F.options(S)[0].mel, true);
  S = F.keepWalk(F.pick(S, 0));
  assert.strictEqual(S.phase, 'next');
  assert.deepStrictEqual(A.melodyNotes(S.idea.melody).map((n) => n.m), walked.map((n) => n.m));
  assert.strictEqual(S.hist[0].note, 'Kept the plain walk');
});

test('each layer is made from the melody and spreads along its telling difference', () => {
  const S = melodyState();
  const axes = { chords: (o) => o.bright, bass: (o) => o.lock, perc: (o) => o.n, pads: (o) => o.voices, sound: (o) => o.bpm };
  for (const d of Object.keys(axes)) {
    const opts = F.options(F.enter(S, d));
    assert.strictEqual(opts.length, 3, d);
    const v = opts.map(axes[d]);
    assert.ok(v[0] <= v[1] && v[1] <= v[2] && v[0] < v[2], d + ' spreads: ' + v.join(', '));
  }
  // chords fit: the melody's notes mostly sit on them
  for (const o of F.options(F.enter(S, 'chords'))) assert.ok(o.fit >= 45, 'chord fit ' + o.fit);
  // the same melody always gives the same options; another melody gives others
  assert.deepStrictEqual(F.options(F.enter(S, 'bass')).map((o) => o.id), F.options(F.enter(S, 'bass')).map((o) => o.id));
});

test('grow the beat opens only after percussion; Bobby picks no direction', () => {
  let S = melodyState();
  assert.ok(!A.directions(S.idea).includes('beat'));
  S = build(S, ['perc']);
  assert.ok(A.directions(S.idea).includes('beat'));
  assert.strictEqual(A.suggestion, undefined, 'no Bobby’s pick in the Idea Builder');
});

test('going back restores that round and keeps everything after it in the history', () => {
  let S = build(melodyState(), ['chords', 'bass']);
  const row = S.hist.find((r) => r.dir === 'chords');
  const n = S.hist.length;
  const back = F.back(S, row);
  assert.strictEqual(back.phase, 'round');
  assert.strictEqual(back.round.dir, 'chords');
  assert.deepStrictEqual(back.idea.order, [], 'the idea as it was before the chords');
  assert.strictEqual(back.hist.length, n + 1);
  assert.ok(back.hist[0].marker);
  // building again from there
  const again = F.pick(back, 0);
  assert.deepStrictEqual(again.idea.order, ['chords']);
});

test('a new shape starts the layers over', () => {
  let S = build(melodyState(), ['chords']);
  const seed2 = S.hist.find((r) => r.dir === 'seed2');
  S = F.pick(F.back(S, seed2), 2);
  assert.deepStrictEqual(S.idea.order, []);
});

test('the sequence: melody alone in the seed rounds, everything once layered, swing on the off-beats', () => {
  let S = F.enter(F.fresh(), 'seed1');
  const o = F.options(S)[0];
  const s1 = A.seq(S.idea, { dir: 'seed1', spec: o });
  assert.deepStrictEqual(Object.keys(s1.tracks), [A.TRACK.mel]);
  assert.strictEqual(s1.length, 2 * T.BAR);
  assert.strictEqual(s1.bpm, 100);
  assert.ok(s1.loop);
  S = build(melodyState(), ['chords', 'bass', 'perc', 'beat', 'pads']);
  const all = A.seq(S.idea, null);
  assert.strictEqual(Object.keys(all.tracks).length, 6);
  for (const e of all.events) {
    assert.ok(e.t >= 0 && e.t < all.length && e.d > 0 && e.p >= 0 && e.p <= 127 && e.v >= 1 && e.v <= 127);
    assert.ok(all.tracks[e.track]);
  }
  for (let i = 1; i < all.events.length; i++) assert.ok(all.events[i].t >= all.events[i - 1].t, 'sorted');
  // auditioning a layer sets the others back
  const aud = A.seq(S.idea, { dir: 'bass', spec: S.idea.layers.bass });
  assert.ok(aud.tracks[A.TRACK.chd].volume < all.tracks[A.TRACK.chd].volume, 'chords sit back');
  assert.strictEqual(aud.tracks[A.TRACK.bas].volume, all.tracks[A.TRACK.bas].volume, 'the bass is heard in full');
  assert.ok(aud.tracks[A.TRACK.mel].volume < all.tracks[A.TRACK.mel].volume, 'the melody steps back a little');
  // a swung sound pushes the "and"s late
  const lofi = { id: 'lofi', tag: 'Lo-fi', name: 'Lo-fi', bpm: 80, swing: 0.62, up: 0, why: '' };
  // with a beat that has closed hats on the eighths
  const e8 = A.kitsFor(T.meter('4/4')).find((k) => k.id === 'rock-back-e8');
  const swung = A.seq(Object.assign({}, S.idea, { layers: Object.assign({}, S.idea.layers, { beat: e8 }) }), { dir: 'sound', spec: lofi });
  assert.strictEqual(swung.bpm, 80);
  const hat = swung.events.filter((e) => e.track === A.TRACK.bt && e.p === 42).map((e) => e.t % T.BEAT);
  assert.ok(hat.some((t) => t > T.BEAT / 2), 'swung off-beats');
});

test('the climb plays bones, then the melody, then each layer', () => {
  const S = build(melodyState(), ['chords', 'bass']);
  const c = A.climb(S.idea);
  assert.strictEqual(c.length, 4);
  assert.deepStrictEqual(Object.keys(c[0].tracks), [A.TRACK.mel]);
  assert.strictEqual(Object.keys(c[3].tracks).length, 3);
  assert.deepStrictEqual(A.lineage(S.idea).map((l) => l.stage), ['Rhythm and scale', 'Melody', 'Chords', 'Bass']);
  // as one sequence: passes back to back, each keeping its own tempo
  const fast = build(S, ['sound'], 2);
  const one = A.climbSeq(fast.idea);
  assert.strictEqual(one.passes.length, 5);
  assert.ok(!one.loop);
  assert.strictEqual(one.bpm, fast.idea.layers.sound.bpm);
  assert.strictEqual(one.passes[0].length, Math.round(A.LENGTH * one.bpm / 100), 'the bones keep 100 BPM');
  assert.strictEqual(one.passes[4].length, A.LENGTH);
  assert.strictEqual(one.length, one.passes.reduce((a, p) => a + p.length, 0));
  for (const e of one.events) assert.ok(one.tracks[e.track] && e.t < one.length);
});

test('the finished idea becomes parts and an idea for the shelf, in the right key', () => {
  const S = build(melodyState(), ['chords', 'bass', 'perc', 'beat', 'pads']);
  const sources = A.toParts(S.idea);
  assert.deepStrictEqual(sources.map((s) => s.part.role), ['lead', 'chords', 'bass', 'perc', 'drums', 'pad']);
  const mel = sources[0].part;
  const want = A.melodyNotes(S.idea.melody).map((n) => n.m);
  const got = Odd.render.partEvents(mel, { refit: false }).map((e) => e.p);
  assert.deepStrictEqual(got, want, 'melody pitches survive');
  const idea = Odd.idea.fromParts(sources, { name: A.ideaName(S.idea), from: 'bones' });
  assert.strictEqual(idea.voices.length, 6);
  assert.strictEqual(idea.bars, 2);
  assert.ok(Odd.idea.repair(JSON.parse(JSON.stringify(idea))));
});

test('Bobby contrasts the option heard with the other two', () => {
  const S = F.enter(F.fresh(), 'seed1');
  const opts = F.options(S);
  assert.match(A.comment('seed1', opts, 2), /Busiest/);
  assert.match(A.comment('seed1', opts, 0), /air/);
  assert.ok(A.whyText('seed1', opts[1]).length > 20);
  for (const d of ['seed1', 'seed2', 'chords', 'bass', 'perc', 'beat', 'pads', 'sound']) {
    assert.ok(A.LINES.entry[d] && A.LINES.entry[d].length, d + ' has an entry line');
    assert.ok(A.REQS[d].some((r) => r.why), d + ' can be asked why');
  }
  assert.ok(A.LINES.pause.length >= 5);
});

test('a saved screen state loads back, and junk loads as a fresh start', () => {
  const S = build(melodyState(), ['chords']);
  const back = F.repair(JSON.parse(JSON.stringify(S)));
  assert.strictEqual(back.phase, 'next');
  assert.deepStrictEqual(back.idea.order, ['chords']);
  const round = F.repair(JSON.parse(JSON.stringify(F.enter(S, 'bass'))));
  assert.strictEqual(F.options(round).length, 3);
  assert.strictEqual(F.repair(null).phase, 'start');
  assert.strictEqual(F.repair({ phase: 'round', round: { dir: 'nope' } }).phase, 'start');
  assert.strictEqual(F.repair({ phase: 'gold', idea: {} }).phase, 'start');
});

test('every meter has its own grooves, and 3/4 gets as many chord paths as the rest', () => {
  for (const id of A.METER_ORDER) {
    const m = T.meter(id), kits = A.kitsFor(m);
    assert.ok(kits.length >= 60, id + ': ' + kits.length + ' beats');
    const fams = new Set(kits.map((k) => k.fam));
    assert.ok(fams.size >= 9, id + ': ' + fams.size + ' kick patterns');
    // each kick pattern is its own: no two families play the same kick
    const byKick = {};
    kits.forEach((k) => { const key = k.k.join(','); (byKick[key] = byKick[key] || new Set()).add(k.fam); });
    assert.ok(Object.values(byKick).every((f) => f.size === 1), id + ': two kick names, one pattern');
    for (const k of kits) {
      assert.ok(k.k.concat(k.s, k.h).every((s) => Number.isInteger(s) && s >= 0 && s < 2 * m.steps), id + ' ' + k.id + ': inside two bars');
      assert.ok(k.k.includes(0), id + ' ' + k.id + ': a kick on the one');
      if (m.compound) assert.strictEqual(k.swing, 0, id + ': no swing on top of threes');
    }
  }
  let S = F.enter(F.fresh(), 'seed1');
  const REQ = A.REQS.seed1.find((r) => r.m);
  while (A.meterOf(F.options(S)[0].mel).id !== '3/4') S = F.request(S, REQ);
  S = F.enter(F.pick(F.pick(S, 0), 0), 'chords');
  assert.ok(F.info(S).total >= 20, '3/4 chords: ' + F.info(S).total);
});
