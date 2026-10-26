'use strict';
// Song structure: the bars a part plays, energy curves, section types.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/model', 'core/recipes',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const M = Odd.model;
const R = Odd.render;
const BAR = T.BAR;

function filledSession(seed) {
  const ws = M.createWorkspace({ seed: seed || 7, style: 'pop' });
  const s = M.currentSession(ws);
  M.fillStarter(ws, s, seed || 7);
  return { ws, s };
}

const sec = (s, name) => s.sections.find((x) => x.name === name);
const lane = (s, role) => M.laneForRole(s, role);

test('a slot plays only its bars, and a late part starts from its own top', () => {
  const { s } = filledSession();
  const chorus = sec(s, 'Chorus');
  const drums = lane(s, 'drums');
  const slot = chorus.slots[drums.id];
  const all = R.sectionEvents(s, chorus, { only: drums.id, shape: false });
  M.setSlotSpan(chorus, drums.id, 4, null);
  assert.deepStrictEqual(M.slotSpan(chorus, slot), { from: 4, to: 8, full: false, out: false });
  const late = R.sectionEvents(s, chorus, { only: drums.id, shape: false });
  assert.ok(late.length > 0 && late.every((e) => e.t >= 4 * BAR));
  // bar 5 of the section is bar 1 of the part (a 4-bar part)
  const firstBarAll = all.filter((e) => e.t < BAR).map((e) => [e.t, e.p]);
  const firstBarLate = late.filter((e) => e.t < 5 * BAR).map((e) => [e.t - 4 * BAR, e.p]);
  assert.deepStrictEqual(firstBarLate, firstBarAll);

  M.setSlotSpan(chorus, drums.id, 0, 2);
  const early = R.sectionEvents(s, chorus, { only: drums.id, shape: false });
  assert.ok(early.length > 0 && early.every((e) => e.t < 2 * BAR));

  M.setSlotSpan(chorus, drums.id, 8, 8);
  assert.ok(M.slotSpan(chorus, slot).out);
  assert.strictEqual(R.sectionEvents(s, chorus, { only: drums.id, shape: false }).length, 0);

  M.setSlotSpan(chorus, drums.id, 0, null);
  assert.ok(!('from' in slot) && !('to' in slot), 'a full span stores nothing');
});

test('a slot span repeats when a section is rendered longer than itself', () => {
  const { s } = filledSession();
  const verse = sec(s, 'Verse');
  const bass = lane(s, 'bass');
  M.setSlotSpan(verse, bass.id, 4, null);
  const evs = R.sectionEvents(s, verse, { only: bass.id, shape: false, length: 16 * BAR });
  assert.ok(evs.some((e) => e.t >= 4 * BAR && e.t < 8 * BAR));
  assert.ok(evs.some((e) => e.t >= 12 * BAR));
  assert.ok(!evs.some((e) => e.t < 4 * BAR || (e.t >= 8 * BAR && e.t < 12 * BAR)));
});

test('a swapped part keeps the bars its slot played', () => {
  const { ws, s } = filledSession();
  const chorus = sec(s, 'Chorus');
  const bass = lane(s, 'bass');
  M.setSlotSpan(chorus, bass.id, 2, 6);
  const other = ws.library.find((p) => p.role === 'bass' && p.id !== chorus.slots[bass.id].sourceId) || ws.library.find((p) => p.role === 'bass');
  M.placePart(s, chorus.id, bass.id, other);
  assert.deepStrictEqual(M.slotSpan(chorus, chorus.slots[bass.id]), { from: 2, to: 6, full: false, out: false });
});

test('energy curves: rise starts lower and ends at the section energy', () => {
  const S = Odd.shape;
  assert.strictEqual(S.curveAt(0.7, 'flat', 0), 0.7);
  assert.ok(S.curveAt(0.7, 'rise', 0) < 0.4 && Math.abs(S.curveAt(0.7, 'rise', 1) - 0.7) < 1e-9);
  assert.ok(S.curveAt(0.7, 'fall', 1) < 0.4 && Math.abs(S.curveAt(0.7, 'fall', 0) - 0.7) < 1e-9);
  assert.ok(S.curveAt(0.7, 'swell', 0.5) > S.curveAt(0.7, 'swell', 0));
  assert.ok(S.curveAt(0.7, 'dip', 0.5) < S.curveAt(0.7, 'dip', 0));

  const { s } = filledSession();
  const chorus = sec(s, 'Chorus');
  chorus.energy = 0.7;
  const chords = lane(s, 'chords');
  const mean = (evs, a, b) => {
    const xs = evs.filter((e) => e.t >= a && e.t < b);
    return { n: xs.length, v: xs.reduce((x, e) => x + e.v, 0) / Math.max(1, xs.length) };
  };
  chorus.curve = 'flat';
  const flat = R.sectionEvents(s, chorus, { only: chords.id });
  chorus.curve = 'rise';
  const rise = R.sectionEvents(s, chorus, { only: chords.id });
  assert.ok(mean(rise, 0, BAR).v < mean(rise, 7 * BAR, 8 * BAR).v, 'quieter at the start');
  assert.ok(mean(rise, 0, BAR).v < mean(flat, 0, BAR).v);
  assert.ok(mean(rise, 0, 2 * BAR).n <= mean(flat, 0, 2 * BAR).n, 'thinner at the start');
});

test('a section exit decides the next entry when that one is on auto', () => {
  const { s } = filledSession();
  const verse = sec(s, 'Verse');
  verse.exit = 'gap';
  const plan = Odd.shape.plan(s);
  const i = plan.findIndex((en) => en.section.name === 'Verse');
  assert.strictEqual(plan[i + 1].entry, 'gap');
  plan[i + 1].section.entry = 'fill';
  assert.strictEqual(Odd.shape.plan(s)[i + 1].entry, 'fill', 'the section\'s own entry wins');
});

test('section kinds come from the name', () => {
  const K = Odd.recipes.kindOf;
  assert.strictEqual(K('Intro'), 'intro');
  assert.strictEqual(K('Pre-chorus'), 'pre');
  assert.strictEqual(K('Chorus 2'), 'chorus');
  assert.strictEqual(K('Drop'), 'chorus');
  assert.strictEqual(K('Bridge'), 'break');
  assert.strictEqual(K('Outro'), 'outro');
  assert.strictEqual(K('Part 7'), 'verse');
  const groups = Odd.recipes.forSection({ name: 'Intro' });
  assert.ok(groups[0].suggested && groups[0].kind === 'intro' && groups[0].recipes.length >= 4);
});

test('slow build: longer intro, parts enter phrase by phrase, energy rises', () => {
  const { s } = filledSession();
  const intro = sec(s, 'Intro');
  const res = Odd.recipes.apply(s, intro, 'slow-build');
  assert.strictEqual(intro.bars, 16);
  assert.strictEqual(intro.curve, 'rise');
  assert.strictEqual(intro.recipe, 'slow-build');
  // the starter intro only has pad and arp: it borrows from the verse it leads into
  assert.ok(res.borrowed.length > 0);
  const from = (role) => { const l = lane(s, role); return intro.slots[l.id] ? M.slotSpan(intro, intro.slots[l.id]).from : null; };
  assert.strictEqual(from('pad'), 0);
  assert.ok(from('drums') > 0 && from('drums') % 4 === 0);
  assert.ok(from('bass') >= from('drums'));
  const evs = R.sectionEvents(s, intro);
  const drumsId = lane(s, 'drums').id;
  assert.ok(!evs.some((e) => e.track === drumsId && e.t < from('drums') * BAR));
  assert.ok(Odd.recipes.describe(s, intro).includes('from bar'));
});

test('hook first borrows the chorus lead into the intro', () => {
  const { s } = filledSession();
  const intro = sec(s, 'Intro');
  const leadLane = lane(s, 'lead');
  assert.ok(!intro.slots[leadLane.id]);
  Odd.recipes.apply(s, intro, 'hook-first');
  const slot = intro.slots[leadLane.id];
  assert.ok(slot, 'the hook was borrowed');
  assert.strictEqual(slot.sourceId, sec(s, 'Chorus').slots[leadLane.id].sourceId);
  assert.strictEqual(M.slotSpan(intro, slot).from, 0);
});

test('outro strip down: parts leave one group at a time', () => {
  const { s } = filledSession();
  const chorus = sec(s, 'Chorus');
  Odd.recipes.apply(s, chorus, 'strip-down');
  const to = (role) => M.slotSpan(chorus, chorus.slots[lane(s, role).id]).to;
  assert.ok(to('lead') < to('drums'));
  assert.ok(to('drums') < to('bass'));
  assert.strictEqual(to('pad'), 8);
  assert.strictEqual(chorus.curve, 'fall');
});

test('pre-chorus types set how the chorus is entered', () => {
  const { s } = filledSession();
  const verse = sec(s, 'Verse');
  Odd.recipes.apply(s, verse, 'drop-out');
  assert.strictEqual(verse.exit, 'none');
  const drums = M.slotSpan(verse, verse.slots[lane(s, 'drums').id]);
  assert.strictEqual(drums.to, verse.bars - 1);
  Odd.recipes.apply(s, verse, 'lift');
  assert.strictEqual(verse.exit, 'build');
  assert.ok(M.slotSpan(verse, verse.slots[lane(s, 'drums').id]).full, 'reapplying resets spans');
});

test('sitting out and migration', () => {
  const { ws, s } = filledSession();
  const chorus = sec(s, 'Chorus');
  Odd.recipes.apply(s, chorus, 'breakdown');
  assert.ok(M.slotSpan(chorus, chorus.slots[lane(s, 'drums').id]).out);
  assert.ok(Odd.recipes.describe(s, chorus).includes('sit out'));
  const copy = M.migrate(JSON.parse(JSON.stringify(ws)));
  const c2 = M.currentSession(copy).sections.find((x) => x.id === chorus.id);
  assert.strictEqual(c2.recipe, 'breakdown');
  assert.ok(M.slotSpan(c2, c2.slots[lane(s, 'drums').id]).out);
  // old data without the new fields
  const old = JSON.parse(JSON.stringify(ws));
  for (const x of old.sessions[0].sections) { delete x.curve; delete x.recipe; delete x.exit; }
  const m = M.migrate(old);
  for (const x of M.currentSession(m).sections) {
    assert.strictEqual(x.curve, 'flat');
    assert.strictEqual(x.recipe, null);
    assert.strictEqual(x.exit, 'auto');
  }
});
