'use strict';
// The booth: keep, pass or ask. Reasons for a no come with the card's numbers,
// a changed version moves the way asked, and filters keep at least three.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/model', 'core/idea',
  'core/audition', 'core/watch', 'core/moves', 'core/tweak', 'core/booth',
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

test('a card’s dials start where the card already sits, and reach only as far as it stays itself', () => {
  const tweakable = [];
  for (const dir in R) {
    const S = R[dir];
    F.options(S).forEach((o, i) => {
      assert.strictEqual(B.canTweak(S, i), Odd.tweak.has(dir, o), dir);
      if (!B.canTweak(S, i)) { assert.deepStrictEqual(B.dials(S, i), [], dir + ' nothing to tweak'); return; }
      if (i === 0) tweakable.push(dir);
      B.dials(S, i).forEach((d) => {
        const D = Odd.tweak.DIAL[d.id];
        assert.deepStrictEqual([d.lo, d.hi], [D.lo, D.hi], dir + ' ' + d.id);
        if (d.fixed) { assert.ok(clean(d.why), dir + ' ' + d.id + ' says why: ' + d.why); return; }
        assert.ok(d.pos >= 0 && d.pos <= 1, dir + ' ' + d.id + ' pos ' + d.pos);
        assert.strictEqual(d.home, d.pos, dir + ' ' + d.id + ' an untweaked card is where it came');
        assert.ok(d.reach[0] <= d.pos + 1e-9 && d.pos <= d.reach[1] + 1e-9, dir + ' ' + d.id + ' it sits inside its reach');
        assert.ok(d.stops.length >= 2, dir + ' ' + d.id + ' somewhere to go');
        d.stops.forEach((p, k) => assert.ok(p >= d.reach[0] - 1e-9 && p <= d.reach[1] + 1e-9 && (!k || p > d.stops[k - 1]), dir + ' ' + d.id + ' stops in order, inside the reach'));
      });
    });
  }
  // the start of every idea can be tweaked, and its sound; the layers on top not yet
  ['seed1', 'seed2', 'pocket', 'rrhythm', 'sound', 'hook'].forEach((d) => assert.ok(tweakable.indexOf(d) >= 0, d + ' can be tweaked'));
  ['chords', 'bass', 'pads', 'gbass'].forEach((d) => assert.ok(tweakable.indexOf(d) < 0, d + ' has nothing to tweak yet'));
  // cards come already turned: across a deck they sit in different places
  const pool = B.poolOf(R.seed1).map((o) => Odd.tweak.dialsFor('seed1', o, R.seed1.idea));
  for (const id of ['mood', 'density', 'rhythm', 'accent']) {
    const at = new Set(pool.map((ds) => ds.find((d) => d.id === id)).filter((d) => !d.fixed).map((d) => d.pos.toFixed(2)));
    assert.ok(at.size >= 3, id + ' cards sit in ' + at.size + ' places');
  }
});

test('a tweak changes the card itself, the way asked, and turning it back gives the card back', () => {
  let turned = 0;
  const onsets = (o, dir) => Odd.tweak.build(dir, o, {}, null) && (o.mel ? o.mel.r.hits : o.r ? o.r.hits : []).map((h) => h[0]).join();
  for (const dir in R) for (const i of [0, 1, 2]) {
    const S = R[dir], o = F.options(S)[i], other = (i + 1) % 3;
    if (!B.canTweak(S, i)) continue;
    B.dials(S, i).filter((d) => !d.fixed).forEach((d) => {
      for (const end of [1, 0]) {
        const r = B.flow.tune(S, i, d.id, d.reach[end]);
        assert.ok(r, dir + ' ' + d.id + ' turns');
        if (r.same) continue;
        turned++;
        const o2 = F.options(r.S)[i], d2 = B.dials(r.S, i).find((x) => x.id === d.id);
        assert.ok(clean(r.text), r.text);
        assert.ok(end ? d2.pos > d.pos : d2.pos < d.pos, dir + ' ' + d.id + ' toward ' + (end ? d.hi : d.lo) + ': ' + r.text);
        assert.strictEqual(d2.home, d.home, dir + ' ' + d.id + ' it remembers where it came');
        assert.strictEqual(F.options(r.S)[other], F.options(S)[other], dir + ' the others stay');
        assert.ok(B.isTweaked(r.S, i), dir + ' marked tweaked');
        const q = A.seq(S.idea, { dir, spec: o2 });
        assert.ok(q.events.length > 0 && q.events.every((e) => e.t >= 0 && e.d > 0 && e.t + e.d <= q.length), dir + ' ' + d.id + ' it plays, inside its bars');
        // what each dial leaves alone
        if (d.id === 'mood' || d.id === 'accent') assert.strictEqual(onsets(o2, dir), onsets(o, dir), dir + ' ' + d.id + ' same notes in time');
        if (d.id === 'mood') assert.notStrictEqual(o2.mel.scale, o.mel.scale);
        if (d.id === 'accent') assert.notDeepStrictEqual(o2.mel.r.hits.map((h) => h[2]), o.mel.r.hits.map((h) => h[2]), dir + ' the accents move');
        if (d.id === 'rhythm') assert.strictEqual((o2.mel || o2).r.n, (o.mel || o).r.n, dir + ' as many notes, some moved');
        if (d.id === 'range') { assert.strictEqual(o2.mel.shape.kind, o.mel.shape.kind); assert.strictEqual(o2.land, o.land, 'it lands where it did'); }
        if (d.id === 'density') assert.strictEqual((o2.mel || o2).r.seed, (o.mel || o).r.seed, dir + ' grown from the same seed');
        if (d.id === 'speed') assert.ok(Math.abs(o2.bpm - o.bpm) <= Math.ceil(o.bpm * 0.15) + 1, dir + ' tempo within reach');
        // back where it came, and it's the card itself again
        const back = B.flow.tune(r.S, i, d.id, d.home);
        assert.ok(back && !back.same, dir + ' ' + d.id + ' turns back');
        assert.strictEqual(F.options(back.S)[i], o, dir + ' ' + d.id + ' the same card back');
        assert.strictEqual(B.flow.untweak(r.S, i).S.round.subs[F.info(S).batch][i], o, dir + ' untweak gives it back');
      }
    });
  }
  assert.ok(turned >= 50, 'dials turn in every tweakable round: ' + turned);
  // past the end of its reach it stays, and says so
  const d = B.dials(R.pocket, 0).find((x) => x.id === 'speed');
  const r = B.flow.tune(R.pocket, 0, 'speed', 1);
  const past = B.flow.tune(r.S, 0, 'speed', 1);
  assert.ok(past.same && past.limit && /as far as it goes/.test(past.text), past.text);
  assert.ok(d.reach[1] < 1, 'tempo stops short of the top');
  // keeping a tweaked card keeps it as it sounds, and nothing of the tweak
  const t = B.flow.tune(R.seed1, 0, 'accent', 1);
  const kept = F.pick(t.S, 0);
  assert.deepStrictEqual(kept.idea.melody.r.hits, F.options(t.S)[0].mel.r.hits);
  assert.ok(!JSON.stringify(kept.idea).includes('"tw"'), 'no tweak bookkeeping in the idea');
});

test('Bobby turns the dial with the most room on the side the card doesn’t lean to', () => {
  for (const dir in R) {
    const S = R[dir], n = B.nudge(S, 0, '');
    const free = B.dials(S, 0).filter((d) => !d.fixed);
    if (!free.length) { assert.strictEqual(n, null, dir); continue; }
    if (!n) continue;
    const d = free.find((x) => x.id === n.id);
    assert.ok(d, dir + ' a dial that moves');
    assert.ok(clean(n.line), n.line);
    assert.ok(n.pos === d.reach[0] || n.pos === d.reach[1], dir + ' as far as it goes');
    // away from its lean, unless there's no room that way on any dial
    const away = free.some((x) => (x.pos > 0.5 ? x.pos - x.reach[0] : x.reach[1] - x.pos) > 0.01 && Math.abs(x.pos - 0.5) >= 0.1);
    if (Math.abs(d.pos - 0.5) >= 0.1 && away) assert.ok((n.pos - d.pos) * (d.pos - 0.5) < 0, dir + ' away from its lean');
    const r = B.flow.tune(S, 0, n.id, n.pos);
    assert.ok(r && !r.same, dir + ' his turn changes it');
    // not the same one twice running, when there's another
    const again = B.nudge(r.S, 0, n.id);
    if (again && free.length > 1) assert.notStrictEqual(again.id, n.id, dir);
  }
});

// ---------------------------------------------------------------- moves: the small things a line can do at one spot

const MV = ['seed1', 'seed2', 'hook', 'rrhythm'];
/** the line a card plays: a tune's notes, or a riff rhythm's hits, with its moves */
const lineOf = (dir, o) => (dir === 'rrhythm' ? A.riffNotes({ r: o.r }) : A.melodyNotes(o.mel, dir === 'seed1'));
const loopOf = (dir, o) => 2 * Odd.theory.meter((dir === 'rrhythm' ? o.r : o.mel.r).m || null).steps;

test('every move keeps the line itself: its notes start where they did, on their pitches, and it lands where it did', () => {
  let tried = 0;
  for (const dir of MV) for (const i of [0, 1, 2]) {
    const S = R[dir], o = F.options(S)[i], base = lineOf(dir, o), T = loopOf(dir, o);
    const ms = B.moves(S, i);
    assert.ok(ms.length >= 2, dir + ' it has moves: ' + ms.map((m) => m.id));
    ms.forEach((m) => {
      assert.ok(m.spots.length > 0 && m.a === -1, dir + ' ' + m.id + ' listed only where it has somewhere to go');
      assert.ok(clean(m.name) && clean(m.line) && m.stops.every(clean), dir + ' ' + m.id);
      if (dir === 'rrhythm') assert.ok(!/note/i.test(m.line + m.stops.join()), 'a riff rhythm has hits: ' + m.line);
      m.stops.forEach((_, a) => {
        const r = Odd.tweak.setMove(dir, o, S.idea, m.id, a);
        assert.ok(r && r.card !== o && clean(r.text), dir + ' ' + m.id + ' ' + a);
        tried++;
        const ns = lineOf(dir, r.card);
        // its own notes: same onsets, same pitches; added ones are marked
        base.forEach((b) => assert.ok(ns.some((n) => !n.orn && n.s === b.s && n.m === b.m), dir + ' ' + m.id + ' keeps the note at ' + b.s));
        assert.strictEqual(ns.filter((n) => !n.orn).length, base.length, dir + ' ' + m.id + ' adds only marked notes');
        assert.strictEqual(ns[ns.length - 1].m, base[base.length - 1].m, dir + ' ' + m.id + ' lands where it did');
        // inside the loop, and nothing rings into the note after it
        ns.forEach((n, k) => {
          assert.ok(n.s >= 0 && n.d > 0 && n.s + n.d <= T + 1e-9, dir + ' ' + m.id + ' inside its bars');
          if (k > 0) assert.ok(ns[k - 1].s + ns[k - 1].d <= n.s + 1e-9, dir + ' ' + m.id + ' no overlap at ' + n.s);
        });
        const q = A.seq(S.idea, { dir, spec: r.card });
        assert.ok(q.events.length > 0 && q.events.every((e) => e.t >= 0 && e.d > 0 && e.t + e.d <= q.length), dir + ' ' + m.id + ' it plays');
        // and it's audible: something about the line changed
        assert.notDeepStrictEqual(ns.map((n) => [n.s, n.d, n.v]), base.map((n) => [n.s, n.d, n.v]), dir + ' ' + m.id + ' changes what plays');
      });
    });
  }
  assert.ok(tried >= 100, 'moves tried: ' + tried);
});

test('a move plays at its spots, and a spot left out is left alone', () => {
  const near = (ns, s) => ns.filter((n) => n.orn && n.s < s && n.s >= s - 3);
  for (const dir of MV) {
    const S = R[dir];
    for (const i of [0, 1, 2]) {
      const o = F.options(S)[i], base = lineOf(dir, o), at = (ns, s) => ns.find((n) => !n.orn && n.s === s);
      B.moves(S, i).forEach((m) => {
        const r = B.flow.move(S, i, m.id, m.def), ns = lineOf(dir, F.options(r.S)[i]);
        m.spots.forEach((p) => {
          const b = at(base, p.s), n = at(ns, p.s);
          if (m.id === 'accent') assert.ok(n.v > (dir === 'rrhythm' ? A.RIFF_VEL : A.MEL_VEL)[b.w], dir + ' accented');
          if (m.id === 'ghost') assert.ok(n.v < (dir === 'rrhythm' ? A.RIFF_VEL : A.MEL_VEL)[b.w], dir + ' ghosted');
          if (m.id === 'short') assert.ok(n.d < b.d, dir + ' clipped');
          if (m.id === 'tie') assert.ok(n.d > b.d, dir + ' tied over');
          if (m.id === 'repeat') assert.ok(ns.filter((x) => x.orn === 'repeat' && x.s > p.s && x.s < p.s + b.d).length >= 1, dir + ' repeated');
          if (m.id === 'grace' || m.id === 'pickup') assert.ok(near(ns, p.s).some((x) => x.orn === m.id), dir + ' ' + m.id + ' before ' + p.s);
        });
        // leave the first spot out: that note plays as it came
        const s = m.spots[0].s, left = B.flow.spot(r.S, i, m.id, s);
        assert.ok(left && clean(left.text), dir + ' ' + m.id + ' a spot left out');
        const after = B.moves(left.S, i).find((x) => x.id === m.id);
        if (m.spots.length === 1) { assert.strictEqual(after.a, -1, dir + ' leaving out the last one turns it off'); return; }
        assert.ok(!after.spots.find((x) => x.s === s).on && after.spots.filter((x) => x.on).length === m.spots.length - 1, dir + ' ' + m.id + ' that one is out');
        const ln = lineOf(dir, F.options(left.S)[i]), n = at(ln, s), b = at(base, s);
        if (m.id !== 'tie' && m.id !== 'short' && m.id !== 'repeat') assert.ok(n.d === b.d || n.d < b.d, dir + ' ' + m.id + ' only shortened by what follows it');
        if (m.id === 'accent' || m.id === 'ghost') assert.strictEqual(n.v, undefined, dir + ' ' + m.id + ' not louder or softer');
        if (m.id === 'short' || m.id === 'tie') assert.ok(Math.abs(n.d - b.d) < 1e-9 || n.d < b.d, dir + ' ' + m.id + ' its own length');
        if (m.id === 'grace' || m.id === 'pickup') assert.strictEqual(near(ln, s).filter((x) => x.orn === m.id).length, 0, dir + ' nothing added before it');
        // and back on
        const back = B.flow.spot(left.S, i, m.id, s);
        assert.deepStrictEqual(B.moves(back.S, i).find((x) => x.id === m.id).spots, B.moves(r.S, i).find((x) => x.id === m.id).spots, dir + ' put back');
      });
    }
  }
});

test('moves turn off, give the card back, sit with the dials, and go on with the tune', () => {
  const S = R.seed1, o = F.options(S)[0], ms = B.moves(S, 0);
  // on, then off: the card it came with
  const on = B.flow.move(S, 0, ms[0].id, ms[0].def), off = B.flow.move(on.S, 0, ms[0].id, -1);
  assert.strictEqual(F.options(off.S)[0], o, 'all moves off is the card itself');
  assert.ok(/off/.test(off.text) && /how it came/.test(off.text), off.text);
  assert.strictEqual(B.flow.untweak(on.S, 0).S.round.subs[F.info(S).batch][0], o, 'back to how it came');
  // clipped and tied over can't both be on
  for (const dir of MV) for (const i of [0, 1, 2]) {
    const ids = B.moves(R[dir], i).map((m) => m.id);
    if (ids.indexOf('short') < 0 || ids.indexOf('tie') < 0) continue;
    const a = B.flow.move(R[dir], i, 'short', 1), b = B.flow.move(a.S, i, 'tie', 1);
    const now = B.moves(b.S, i);
    assert.ok(now.find((m) => m.id === 'tie').a === 1 && now.find((m) => m.id === 'short').a === -1, dir + ' tied over turns clipped off');
    assert.ok(/can’t be both/.test(b.text), b.text);
  }
  // a dial turned keeps the moves, and the moves keep the dial
  const acc = ms.find((m) => m.id === 'accent' || m.id === 'ghost') || ms[0];
  const m1 = B.flow.move(S, 0, acc.id, acc.def);
  const d = B.dials(m1.S, 0).find((x) => x.id === 'mood' && !x.fixed);
  if (d) {
    const t = B.flow.tune(m1.S, 0, 'mood', d.reach[d.pos > 0.5 ? 0 : 1]);
    assert.ok(t && !t.same);
    assert.strictEqual(B.moves(t.S, 0).find((m) => m.id === acc.id).a, acc.def, 'the move stays when a dial turns');
    assert.notStrictEqual(F.options(t.S)[0].mel.scale, o.mel.scale);
    const m2 = B.flow.move(t.S, 0, acc.id, -1);
    assert.strictEqual(F.options(m2.S)[0].mel.scale, F.options(t.S)[0].mel.scale, 'the dial stays when the move goes');
  }
  // kept, the moves go on with the tune: into its shapes, and into the melody
  const kept = F.pick(m1.S, 0);
  assert.deepStrictEqual(kept.idea.melody.mv, F.options(m1.S)[0].mel.mv);
  assert.ok(!JSON.stringify(kept.idea).includes('"tw"'), 'no tweak bookkeeping in the idea');
  const shapes = F.options(kept);
  assert.ok(shapes.every((x) => JSON.stringify(x.mel.mv) === JSON.stringify(kept.idea.melody.mv)), 'every shape plays them');
  const melody = F.pick(kept, 0);
  assert.deepStrictEqual(melody.idea.melody.mv, kept.idea.melody.mv, 'and the melody keeps them');
  // a riff rhythm's moves go on into its notes and its weight
  const rr = R.rrhythm, rm = B.moves(rr, 0).find((m) => m.id === 'pickup' || m.id === 'tie') || B.moves(rr, 0)[0];
  const rt = B.flow.move(rr, 0, rm.id, rm.def), rk = F.pick(rt.S, 0);
  assert.ok(rk.idea.riff.r.mv && rk.idea.riff.r.mv[rm.id], 'the riff keeps its moves');
  const withNotes = A.riffNotes({ r: rk.idea.riff.r, notes: F.options(rk)[0] });
  assert.ok(withNotes.length >= rk.idea.riff.r.hits.length, 'they play once it has notes');
  assert.ok(A.seq(rk.idea, { dir: 'rnotes', spec: F.options(rk)[0] }).events.length > 0);
});
