'use strict';
// Meters: 3/4, 6/8, 5/4 and 7/8 next to 4/4, from the theory helpers to Bones to Gold.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/midi-file', 'core/model', 'core/idea',
  'core/audition', 'core/songmaker',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const A = Odd.audition;
const F = A.flow;
const METER_REQ = A.REQS.seed1.find((r) => r.m);
const SM = Odd.songmaker;

/** round 1 switched to meter `id` with "Another meter" */
function inMeter(id) {
  let S = F.enter(F.fresh(), 'seed1');
  while (A.meterOf(F.options(S)[0].mel).id !== id) S = F.request(S, METER_REQ);
  return S;
}
/** a melody in meter `id` with every layer added */
function fullIdea(id) {
  let S = F.pick(F.pick(inMeter(id), 1), 1);
  for (const d of ['chords', 'bass', 'pads', 'perc', 'beat', 'sound']) S = F.pick(F.enter(S, d), 1);
  return S;
}

test('meters: bar length, the beats you tap, and where the strong ones fall', () => {
  const four = T.meter('4/4');
  assert.strictEqual(four.ticks, T.BAR, '4/4 is the old bar');
  assert.deepStrictEqual(four.groupStarts, [0, 8]);
  assert.deepStrictEqual(T.meter('3/4').pulses.map((p) => p.s), [0, 4, 8]);
  assert.strictEqual(T.meter('3/4').steps, 12);
  // 6/8 is tapped in two big beats, not six
  assert.deepStrictEqual(T.meter('6/8').pulses, [{ s: 0, len: 6 }, { s: 6, len: 6 }]);
  // 7/8 as 2+2+3: short, short, long
  assert.deepStrictEqual(T.meter('7/8').pulses.map((p) => p.len), [4, 4, 6]);
  assert.strictEqual(T.meter('7/8').beats, 3.5);
  // chords change mid-bar where the bar splits: after the 3 in 5/4, before the long beat in 7/8
  assert.deepStrictEqual(T.meter('5/4').harm, [0, 12]);
  assert.deepStrictEqual(T.meter('7/8').harm, [0, 8]);
  assert.strictEqual(T.meter('nonsense').id, '4/4', 'unknown meters fall back to 4/4');
  // strength: the downbeat, then group starts, then other beats
  assert.strictEqual(T.stepWeight(T.meter('5/4'), 0), 1);
  assert.strictEqual(T.stepWeight(T.meter('5/4'), 12), 0.75);
  assert.strictEqual(T.stepWeight(T.meter('5/4'), 4), 0.5);
  assert.deepStrictEqual(T.timeSigBytes('6/8'), [6, 3, 36, 8]);
  assert.deepStrictEqual(T.timeSigBytes('4/4'), [4, 2, 24, 8]);
});

test('Another meter goes round the list and back to 4/4, with Bobby counting it in', () => {
  let S = F.enter(F.fresh(), 'seed1');
  const seen = [];
  for (let i = 0; i < A.METER_ORDER.length; i++) {
    S = F.request(S, METER_REQ);
    seen.push(A.meterOf(F.options(S)[0].mel).id);
    assert.match(S.line, /four|now/);
  }
  assert.deepStrictEqual(seen, ['3/4', '6/8', '5/4', '7/8', '4/4']);
  assert.strictEqual(S.round.steer.m, undefined, 'back in 4/4 the steer is as it was');
});

test('round 1 in each meter: three rhythms inside two bars, accents where their grouping puts them', () => {
  for (const id of A.METER_ORDER) {
    const m = T.meter(id), S = inMeter(id), opts = F.options(S);
    assert.strictEqual(opts.length, 3, id);
    for (const o of opts) {
      assert.strictEqual(A.meterOf(o.mel).id, id);
      // with the count: accents on the group starts; across it: on the grouping's own steps
      const g = A.accentsOf(m).find((a) => a.id === o.mel.r.acc);
      assert.ok(g, id + ' a known accent grouping');
      for (const h of o.mel.r.hits) {
        assert.ok(h[0] >= 0 && h[0] + h[1] <= 2 * m.steps, id + ' note inside the two bars');
        if (g.s ? g.s.indexOf(h[0]) >= 0 : m.groupStarts.indexOf(h[0] % m.steps) >= 0) assert.strictEqual(h[2], 2, id + ' accent where its grouping says');
      }
      if (id !== '4/4') assert.match(A.statOf('seed1', o), new RegExp(id));
    }
    assert.ok(opts[0].mel.r.n < opts[2].mel.r.n, id + ' still spread from sparse to busy');
  }
});

test('every layer follows the melody\'s meter, and the sequence is its two bars long', () => {
  for (const id of ['3/4', '6/8', '5/4', '7/8']) {
    const m = T.meter(id), S = fullIdea(id), idea = S.idea;
    const slots = A.slotsOf(m);
    assert.strictEqual(idea.layers.chords.chords.length, slots.length, id + ' one chord per slot');
    const sq = A.seq(idea, null);
    assert.strictEqual(sq.length, 2 * m.ticks, id + ' two bars');
    assert.strictEqual(sq.steps, 2 * m.steps);
    assert.strictEqual(sq.meter, id);
    assert.ok(sq.events.every((e) => e.t >= 0 && e.t < sq.length && e.t + e.d <= sq.length), id + ' nothing spills past the loop');
    const chordStarts = sq.events.filter((e) => e.track === A.TRACK.chd).map((e) => e.t / A.STEP_TICKS);
    assert.ok(chordStarts.every((s) => slots.some((sl) => sl.s === s)), id + ' chords change on the slots');
    const kits = A.kitsFor(m);
    assert.ok(kits.length >= 4, id + ' enough beats to choose from');
    for (const k of kits) assert.ok(k.k.concat(k.s, k.h).every((s) => s >= 0 && s < 2 * m.steps), id + ' ' + k.tag + ' inside the bars');
    if (m.compound) assert.ok(kits.every((k) => !k.swing), id + ' moves in threes, so no swing');
  }
});

test('6/8 and 7/8 never swing, even with a swung sound', () => {
  const S = fullIdea('6/8');
  const idea = Object.assign({}, S.idea, { layers: Object.assign({}, S.idea.layers, { sound: Object.assign({}, S.idea.layers.sound, { swing: 0.62 }) }) });
  const sq = A.seq(idea, null);
  assert.ok(sq.events.every((e) => e.t % A.STEP_TICKS === 0), 'every note on the grid');
});

test('parts from another meter carry it, and their chords last as long as their slots', () => {
  const parts = A.toParts(fullIdea('7/8').idea);
  assert.ok(parts.every((p) => p.part.meter === '7/8'));
  const prog = parts.find((p) => p.label === 'Chords').part.ctx.prog;
  assert.deepStrictEqual(prog.map((c) => c.beats), [2, 1.5, 2, 1.5]);
  assert.ok(A.toParts(fullIdea('4/4').idea).every((p) => p.part.meter === undefined), '4/4 parts stay as they were');
});

test('Bobby explains the meter when asked why', () => {
  const o = F.options(inMeter('7/8'))[1];
  assert.match(A.whyText('seed1', o), /7\/8/);
  assert.match(A.comment('seed1', F.options(inMeter('3/4')), 1), /3\/4/);
  assert.doesNotMatch(A.whyText('seed1', F.options(inMeter('4/4'))[1]), /4\/4/);
});

/** a gold idea on the shelf, built in meter `id` */
function shelfIdea(id) {
  const S = fullIdea(id);
  const idea = Odd.idea.fromParts(A.toParts(S.idea), { name: A.ideaName(S.idea), from: 'bones' });
  idea.bones = JSON.parse(JSON.stringify(S.idea));
  return idea;
}

test('a saved idea keeps its meter: two bars of 7/8 are two bars, not one and a bit', () => {
  const idea = shelfIdea('7/8');
  assert.strictEqual(idea.meter, '7/8');
  assert.strictEqual(idea.bars, 2);
  assert.strictEqual(Odd.idea.lengthOf(idea), 2 * T.meter('7/8').ticks);
  assert.ok(idea.voices.every((v) => v.core.meter === '7/8' && v.core.len === 2 * T.meter('7/8').ticks));
  const back = Odd.idea.repair(JSON.parse(JSON.stringify(idea)));
  assert.strictEqual(back.meter, '7/8', 'survives saving and loading');
  const four = shelfIdea('4/4');
  assert.strictEqual(four.meter, undefined, '4/4 ideas look as they always did');
  assert.strictEqual(Odd.idea.join([idea, four]), null, 'ideas in different meters can’t be joined');
  assert.ok(Odd.idea.join([idea, shelfIdea('7/8')]), 'the same meter joins');
  // the bones loop at the idea's own length
  const ev = Odd.idea.events(idea, { mode: 'full' });
  assert.ok(ev.every((e) => e.t < Odd.idea.lengthOf(idea)));
  // beats are counted in the meter: 7/8's third beat starts on its fifth eighth
  assert.strictEqual(Odd.idea.placeName(8 * T.STEP, T.meter('7/8').ticks, '7/8'), 'beat 3');
  assert.strictEqual(Odd.idea.placeName(T.meter('3/4').ticks, 2 * T.meter('3/4').ticks, '3/4'), 'bar 2, beat 1');
});

test('a part in another meter loops at its own bar length', () => {
  const part = A.toParts(fullIdea('3/4').idea)[0].part;
  assert.strictEqual(T.partTicks(part), 2 * T.meter('3/4').ticks);
  const ev = Odd.render.partEvents(part, { length: 4 * T.meter('3/4').ticks });
  const first = part.notes[0].t;
  assert.ok(ev.some((e) => e.t === first + T.partTicks(part)), 'the second pass starts right after the first');
});

test('the Song Builder plays a 7/8 idea in 7/8: whole bars, fills on the last beat, a 7/8 MIDI file', () => {
  const m = T.meter('7/8'), main = shelfIdea('7/8');
  let song = SM.create(main, shelfIdea('4/4'), 'chorus');
  assert.strictEqual(song.guest, null, 'a guest in another meter is left out');
  song = SM.create(main, null, 'chorus');
  const C = SM.context(song);
  assert.strictEqual(C.meter, '7/8');
  assert.strictEqual(C.BAR, m.ticks);
  assert.strictEqual(C.swing, 0, '7/8 doesn’t swing');
  const sec = song.secs[1];
  const r = SM.renderSection(C, sec, null);
  assert.strictEqual(r.length, sec.body.bars * m.ticks);
  for (const act of ['build', 'fin']) {
    for (const o of SM.actOptions(C, song, sec, act, 'all')) {
      const x = SM.renderSection(C, Object.assign({}, sec, o.make(sec)), null);
      assert.strictEqual((x.inLen + x.outLen) % m.ticks, 0, o.key + ' adds whole bars');
      assert.ok(x.events.every((e) => e.t >= 0 && e.t < x.length), o.key + ' stays inside');
    }
  }
  // a fill runs through the bar's last beat, the long one: three eighths of 16ths
  const tw = {}; tw[0] = 'fill';
  const f = SM.renderSection(C, Object.assign({}, sec, { body: Object.assign({}, sec.body, { twists: tw }) }), null);
  const snares = f.events.filter((e) => e.track === 'sm-fx' && e.p === 38).map((e) => e.t / T.STEP);
  assert.deepStrictEqual(snares, [8, 9, 10, 11, 12, 13]);
  const vibes = [0, 1, 2, 3, 4].map((b) => SM.toolOptions(C, song, sec, 'vibe', null, b)).flat().map((o) => o.key);
  assert.ok(vibes.length && !vibes.includes('vibe:swing'), 'no Swing it in 7/8');
  const bytes = Array.from(SM.midi(C, song));
  const at = bytes.findIndex((b, i) => b === 255 && bytes[i + 1] === 88);
  assert.deepStrictEqual(bytes.slice(at + 3, at + 5), [7, 3], 'time signature 7/8');
});
