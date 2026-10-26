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

test('forms: outline, tease, fragment and half-time reshape a part', () => {
  const notes = [
    { t: 0, d: 240, v: 90, deg: 0 }, { t: 240, d: 240, v: 80, deg: 1 }, { t: 480, d: 480, v: 90, deg: 2 },
    { t: BAR, d: 480, v: 90, deg: 4 }, { t: BAR + 960, d: 240, v: 70, deg: 3 },
    { t: 2 * BAR, d: 480, v: 90, deg: 5 }, { t: 3 * BAR + 120, d: 120, v: 60, deg: 6 },
  ];
  const len = 4 * BAR;
  const F = R.formNotes;
  assert.strictEqual(F(notes, 'full', len), notes);
  const half = F(notes, 'half', len);
  assert.deepStrictEqual(half.map((n) => n.t), [0, 480, 960, 2 * BAR, 3 * BAR]); // the first two bars, doubled
  assert.ok(half.every((n) => n.st != null), 'remembers the original time');
  const frag = F(notes, 'fragment', len);
  assert.strictEqual(frag.length, 3 * 4);
  assert.ok(frag.every((n) => n.st < BAR));
  const tease = F(notes, 'tease', len);
  assert.ok(tease.every((n) => Math.floor(n.t / BAR) % 2 === 0));
  assert.ok(tease.every((n) => n.t + n.d <= (Math.floor(n.t / BAR) + 1) * BAR));
  const outline = F(notes, 'outline', len);
  assert.ok(outline.every((n) => n.t % T.BEAT === 0));
  assert.ok(!outline.some((n) => n.t === 3 * BAR + 120));
  // held to the next on-beat onset
  assert.strictEqual(outline.find((n) => n.t === BAR).d, 960);
});

test('a form still refits each note against the chord it was written over', () => {
  const part = {
    role: 'bass', bars: 2, base: 36, notes: [{ t: 0, d: 480, v: 90, deg: 0, acc: 0 }, { t: BAR, d: 480, v: 90, deg: 3, acc: 0 }],
    ctx: { tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 4 }, { deg: 3, beats: 4 }] },
  };
  // half-time puts the first bar (over I) across both bars of a I - IV section:
  // the note over I in the source lands over IV and moves up a fourth
  const tgt = { tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 4 }, { deg: 3, beats: 4 }], length: 2 * BAR };
  const plain = R.partEvents(part, tgt);
  const half = R.partEvents(part, Object.assign({}, tgt, { form: 'half' }));
  assert.strictEqual(half.length, 1);
  assert.strictEqual(half[0].p, plain[0].p);
  assert.strictEqual(half[0].d, 960);
});

test('reuse places the same part elsewhere and the sheet sees a theme', () => {
  const { s } = filledSession();
  const chorus = sec(s, 'Chorus');
  const intro = sec(s, 'Intro');
  const verse = sec(s, 'Verse');
  const lead = lane(s, 'lead');
  assert.strictEqual(M.themes(s).size, 0);
  const n = M.reuseSlot(s, chorus.id, lead.id, { [intro.id]: 'outline', [verse.id]: 'fragment' });
  assert.strictEqual(n, 2);
  assert.strictEqual(intro.slots[lead.id].sourceId, chorus.slots[lead.id].sourceId);
  assert.strictEqual(intro.slots[lead.id].form, 'outline');
  const th = M.themes(s).get(chorus.slots[lead.id].sourceId);
  assert.strictEqual(th.letter, 'A');
  assert.deepStrictEqual(th.uses.map((u) => u.section.name).sort(), ['Chorus', 'Intro', 'Verse']);
  // rendered differently in each
  const ev = (x) => R.sectionEvents(s, x, { only: lead.id, shape: false }).length;
  assert.ok(ev(intro) > 0 && ev(verse) > 0);
  assert.ok(Odd.recipes.describe(s, intro).includes('(outline)'));
  // full stores no form
  M.reuseSlot(s, chorus.id, lead.id, { [verse.id]: 'full' });
  assert.ok(!('form' in verse.slots[lead.id]));
});

test('a groove that simply repeats is not a theme; a reshaped one is', () => {
  const { s } = filledSession();
  const chorus = sec(s, 'Chorus');
  const verse = sec(s, 'Verse');
  const drums = lane(s, 'drums');
  M.reuseSlot(s, chorus.id, drums.id, { [verse.id]: 'full' });
  assert.ok(!M.themes(s).has(chorus.slots[drums.id].sourceId));
  M.reuseSlot(s, chorus.id, drums.id, { [verse.id]: 'half' });
  assert.ok(M.themes(s).has(chorus.slots[drums.id].sourceId));
});
