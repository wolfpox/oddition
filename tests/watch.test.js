'use strict';
// Watch Bobby: he builds an idea from a brief and says why at every step.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/model', 'core/idea',
  'core/audition', 'core/watch',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const A = Odd.audition;
const F = A.flow;
const W = Odd.watch;

test('every brief on every path ends in a finished idea, with a reason for every pick', () => {
  for (const brief of W.BRIEF_ORDER) {
    for (const p of A.PATH_ORDER) {
      for (const seed of [1, 2]) {
        const run = W.plan({ seed, path: p, brief });
        const at = (k) => run.steps[k];
        assert.strictEqual(run.path, p);
        assert.strictEqual(at(0).kind, 'brief');
        const end = at(run.steps.length - 1);
        assert.strictEqual(end.kind, 'done');
        assert.strictEqual(end.S.phase, 'gold');
        assert.ok(A.isDone(end.S.idea), brief + ' ' + p);
        const chose = run.steps.filter((s) => s.kind === 'choose');
        assert.strictEqual(end.S.watch.log.length, chose.length);
        for (const s of run.steps) {
          assert.ok(s.say && !/undefined|NaN|null/.test(s.say), s.kind + ': ' + s.say);
          if (typeof s.hear === 'number') assert.ok(F.options(s.S)[s.hear], s.kind + ' hears a card on screen');
        }
        // the ways on he took are the path's own
        const taken = run.steps.filter((s) => s.kind === 'ways').length;
        assert.ok(taken >= 2 && taken <= A.PATHS[p].next.length);
      }
    }
  }
});

test('he picks where the brief points: the low end, the high end, or the middle', () => {
  for (const brief of W.BRIEF_ORDER) {
    const t = W.BRIEFS[brief].t;
    for (const p of A.PATH_ORDER) {
      const run = W.plan({ seed: 7, path: p, brief });
      run.steps.filter((s) => s.kind === 'choose' && s.i >= 0).forEach((s) => {
        const opts = F.options(s.S), v = t[W.AXIS[s.S.round.dir]];
        const want = v < 0 ? 0 : v > 0 ? opts.length - 1 : Math.floor((opts.length - 1) / 2);
        assert.strictEqual(s.i, want, brief + ' ' + s.S.round.dir);
      });
    }
  }
});

test('a run is the same for the same seed, and seeds reach every path and other meters', () => {
  const a = W.plan({ seed: 42 }), b = W.plan({ seed: 42 });
  assert.deepStrictEqual(a.steps.map((s) => s.say), b.steps.map((s) => s.say));
  const paths = new Set(), meters = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const run = W.plan({ seed });
    paths.add(run.path);
    meters.add(A.ideaMeter(run.steps[run.steps.length - 1].S.idea).id);
  }
  assert.deepStrictEqual([...paths].sort(), ['groove', 'melody', 'riff']);
  assert.ok(meters.size >= 2, [...meters].join());
});

test('the transcript names the brief and every round', () => {
  const run = W.plan({ seed: 3, path: 'groove', brief: 'late' });
  const txt = W.transcript(run.steps[run.steps.length - 1].S.watch);
  assert.ok(/Brief: Late night/.test(txt));
  for (const l of ['The pocket', 'Bass line', 'Chords on top', 'Sound and feel']) assert.ok(txt.indexOf(l) >= 0, l);
  assert.ok(/Why it works/.test(txt));
});

test('his words follow the idea: percussion over a groove or a riff never mentions a melody', () => {
  for (const p of ['groove', 'riff']) {
    const run = W.plan({ seed: 5, path: p, brief: 'tense' });
    run.steps.filter((s) => s.S.round && s.S.round.dir === 'perc' && (s.kind === 'hear' || s.kind === 'why')).forEach((s) => assert.ok(!/melody/.test(s.say), s.say));
  }
});

test('when two cards tie at an end, only the outer one is called that end', () => {
  const opts = [{ a: 1 }, { a: 3 }, { a: 3 }];
  assert.deepStrictEqual([0, 1, 2].map((i) => A.rankOf(opts, i)), ['low', 'mid', 'high']);
});
