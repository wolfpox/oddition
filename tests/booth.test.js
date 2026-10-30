'use strict';
// The booth: keep, pass or ask. Reasons for a no come with the card's numbers,
// a changed version moves the way asked, and filters keep at least three.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/model', 'core/idea',
  'core/audition', 'core/watch', 'core/booth',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const A = Odd.audition;
const F = A.flow;
const B = Odd.booth;

/** one round of every kind, as Bobby reaches them building on each path */
function rounds() {
  const out = {};
  for (const p of A.PATH_ORDER) {
    for (const seed of [1, 2]) {
      Odd.watch.plan({ seed, path: p, brief: 'plain' }).steps.forEach((st) => {
        if (st.kind === 'enter' && !out[st.S.round.dir]) out[st.S.round.dir] = st.S;
      });
    }
  }
  // Grow the beat opens once there's percussion
  if (!out.beat) out.beat = F.enter(F.pick(out.perc, 0), 'beat');
  return out;
}
const R = rounds();
const clean = (t) => typeof t === 'string' && t.length > 0 && !/undefined|NaN|null|\[object/.test(t);

test('every kind of round is reached', () => {
  assert.deepStrictEqual(Object.keys(R).sort(), Object.keys(B.TOPICS).sort());
});

test('every card raises questions, and every answer steers with the round’s own requests', () => {
  for (const dir in R) {
    const S = R[dir];
    F.options(S).forEach((o, i) => {
      const qs = B.questions(S, i);
      assert.ok(qs.length >= 2, dir + ' has questions');
      qs.forEach((q) => {
        assert.ok(clean(q.q), dir + ': ' + q.q);
        const an = B.answer(S, i, q.id);
        assert.ok(clean(an.text), dir + ' ' + q.id + ': ' + an.text);
        an.acts.forEach((k) => assert.ok(A.REQS[dir][k] && !A.REQS[dir][k].why, dir + ' ' + q.id));
      });
      const ex = B.explain(S, i);
      assert.ok(clean(ex.text), dir + ' explains');
    });
  }
});

test('the reasons for a no say what the card has, and which can’t change here', () => {
  for (const dir in R) {
    const S = R[dir], o = F.options(S)[0];
    const ids = B.reasonsFor(dir, o, S.idea).map((r) => r.id);
    assert.ok(ids.indexOf('speed') >= 0 && ids.indexOf('density') >= 0 && ids.indexOf('rhythm') >= 0, dir);
    // drums have no pitch
    if (/^(perc|beat|pocket|drums)$/.test(dir)) assert.ok(ids.indexOf('pitch') < 0, dir + ' has no pitch');
    B.facts(S, 0, ids).forEach((f) => assert.ok(clean(f.text), dir + ' ' + f.id + ': ' + f.text));
  }
  // speed only changes where the tempo is picked
  assert.ok(B.facts(R.bass, 0, ['speed'])[0].fixed);
  assert.ok(!B.facts(R.pocket, 0, ['speed'])[0].fixed);
});

test('a changed card moves away from its end of the deck on what was asked, and takes its slot', () => {
  for (const dir of ['pocket', 'bass', 'perc', 'rrhythm', 'keys']) {
    const S = R[dir];
    for (let i = 0; i < 3; i++) {
      const o = F.options(S)[i], m0 = B.measure(dir, o, S.idea);
      const r = B.flow.change(S, i, ['density']);
      if (!r) continue;
      const o2 = F.options(r.S)[i], m1 = B.measure(dir, o2, S.idea);
      assert.notStrictEqual(m1.n, m0.n, dir + ' density changed');
      assert.ok(/instead of/.test(r.text), r.text);
      assert.strictEqual(r.S.sel, i);
      assert.strictEqual(F.options(r.S).filter((x, k) => k !== i).length, 2);
    }
  }
  // the slowest of three goes faster
  const S = R.pocket, opts = F.options(S), slow = opts.reduce((b, o, k) => (o.bpm < opts[b].bpm ? k : b), 0);
  const r = B.flow.change(S, slow, ['speed']);
  assert.ok(F.options(r.S)[slow].bpm > opts[slow].bpm, r.text);
  // nothing to change on a reason the round can't vary
  assert.strictEqual(B.flow.change(R.bass, 0, ['speed']), null);
});

test('filtering removes cards like it, never leaves fewer than three, and can be undone', () => {
  for (const dir of ['pocket', 'bass', 'perc', 'sound', 'rnotes']) {
    const S = R[dir], before = F.info(S).total, o = F.options(S)[0];
    const ids = B.reasonsFor(dir, o, S.idea).map((x) => x.id);
    for (const id of ids) {
      const r = B.flow.cut(S, 0, [id]);
      if (!r) continue;
      assert.ok(r.left >= Math.min(3, before) && r.left <= before, dir + ' ' + id);
      assert.ok(clean(r.text), r.text);
      if (r.left > 3) assert.ok(A.deckOf(dir, r.S.round, S.idea).batches.every((b) => b.every((c) => B.fp(c) !== B.fp(o))), dir + ' ' + id + ' the card itself is gone');
      assert.strictEqual(B.flow.uncut(r.S).round.cut.length, 0);
      assert.strictEqual(F.info(B.flow.uncut(r.S)).total, before);
    }
  }
});

test('a no marks the card, and it stays in its place', () => {
  const S = R.chords, o = F.options(S)[1];
  const ns = B.flow.reject(S, 1, ['mood']);
  assert.ok(B.isOut(ns, o) && !B.isOut(S, o));
  assert.strictEqual(F.options(ns)[1], o);
});
