'use strict';
// Who leads: how the parts of a section fit to each other (salience, authority, links, boxes).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/model', 'core/idea', 'core/relate',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const M = Odd.model;
const R = Odd.render;
const X = Odd.relate;
const { BAR, BEAT, STEP } = T;
const LEN = 4 * BAR;

/** events on the given 16th steps of every bar */
function onSteps(steps, p, opts) {
  const o = opts || {};
  const out = [];
  for (let b = 0; b < 4; b++) {
    steps.forEach((s, i) => out.push({ t: b * BAR + s * STEP, d: o.d || STEP, p: Array.isArray(p) ? p[(i + b) % p.length] : p, v: 96 }));
  }
  return out;
}

const lane = (id, role, events, extra) => Object.assign({ id, role, name: id, events, heard: [], fits: T.isDrumRole(role) ? null : true }, extra);
const find = (res, id) => res.lanes.find((l) => l.id === id);
const linkOf = (res, from, to) => res.links.find((l) => (l.from === from && l.to === to) || (l.mutual && l.from === to && l.to === from));

// a syncopated kick, hats on every 8th, snare on 2 and 4
const KICK = [0, 3, 6, 10, 11];
const drums = () => onSteps(KICK, 36).concat(onSteps([0, 2, 4, 6, 8, 10, 12, 14], 42), onSteps([4, 12], 38));

test('bass on some of the kick\'s off-beat hits locks to the drums, and the drums steer', () => {
  const res = X.analyse([
    lane('Drums', 'drums', drums()),
    lane('Bass', 'bass', onSteps([0, 3, 10], [36, 39, 41], { d: 2 * STEP })),
  ], { length: LEN });
  const l = linkOf(res, 'Bass', 'Drums');
  assert.ok(l, 'a link from bass to drums');
  assert.strictEqual(l.kind, 'lock');
  assert.ok(!l.mutual && l.kick, 'the bass follows the kick, not the other way');
  assert.strictEqual(l.text, 'Bass locks to the kick in Drums');
  assert.strictEqual(X.verb('Drums', 'locks', 'lock'), 'lock');
  assert.strictEqual(X.verb('Bass', 'locks', 'lock'), 'locks');
  assert.match(l.detail, /^100% of its off-beat notes/);
  assert.ok(find(res, 'Drums').steers, 'the drums shape the bass');
  assert.ok(!find(res, 'Bass').steers);
  // the same rhythm exactly is a pair
  const same = X.analyse([lane('Drums', 'drums', drums()), lane('Bass', 'bass', onSteps(KICK, 36))], { length: LEN });
  assert.strictEqual(linkOf(same, 'Bass', 'Drums').kind, 'pair');
});

test('a bass between a four-on-the-floor kick avoids it', () => {
  const res = X.analyse([
    lane('Drums', 'drums', onSteps([0, 4, 8, 12], 36).concat(onSteps([2, 6, 10, 14], 42))),
    lane('Bass', 'bass', onSteps([2, 6, 10, 14], [36, 36, 43, 41])),
  ], { length: LEN });
  const l = linkOf(res, 'Bass', 'Drums');
  assert.ok(l && l.kind === 'avoid', 'bass keeps off the kick');
  assert.match(l.text, /plays between the kicks/);
});

test('parts that take turns trade phrases; a logged answer makes the lead a hook', () => {
  // lead plays the first half of every bar, high and moving; arp fills the second half
  const lead = [];
  const arp = [];
  for (let b = 0; b < 4; b++) {
    [0, 2, 3, 5, 6].forEach((s, i) => lead.push({ t: b * BAR + s * STEP, d: STEP, p: [76, 79, 81, 79, 84][i], v: 100 }));
    [9, 10, 11, 13, 14, 15].forEach((s) => arp.push({ t: b * BAR + s * STEP, d: STEP, p: 64, v: 80 }));
  }
  const pad = [0, 1, 2, 3].map((b) => ({ t: b * BAR, d: BAR, p: 55, v: 70 }));
  let res = X.analyse([lane('Lead', 'lead', lead), lane('Arp', 'arp', arp), lane('Pad', 'pad', pad)], { length: LEN });
  const l = linkOf(res, 'Arp', 'Lead');
  assert.strictEqual(l.kind, 'trade');
  assert.ok(l.mutual);
  assert.ok(find(res, 'Lead').stands, 'the high moving line stands out');
  assert.strictEqual(find(res, 'Lead').box, 'topline', 'trading alone does not make it steer');
  assert.strictEqual(find(res, 'Pad').box, 'bed');
  assert.strictEqual(res.top, 'Lead');
  // the arp was made listening to the lead: now the lead is what it is built around
  res = X.analyse([lane('Lead', 'lead', lead), lane('Arp', 'arp', arp, { heard: ['Leaves room for the lead and answers in its rests'] }), lane('Pad', 'pad', pad)], { length: LEN });
  assert.strictEqual(find(res, 'Lead').box, 'hook');
  assert.ok(linkOf(res, 'Arp', 'Lead').logged);
});

test('two parts in the same rhythm move together and steer each other', () => {
  const riff = [0, 3, 6, 7, 10, 13];
  const res = X.analyse([
    lane('Bass', 'bass', onSteps(riff, [36, 39, 41, 43, 41, 39])),
    lane('Chords', 'chords', onSteps(riff, [60, 63, 65, 67, 65, 63])),
  ], { length: LEN });
  const pairs = res.links.filter((l) => l.kind === 'pair');
  assert.strictEqual(pairs.length, 1, 'one link for the pair, not two');
  assert.ok(pairs[0].mutual);
  assert.ok(find(res, 'Bass').steers && find(res, 'Chords').steers);
});

test('salience is relative: with only drums and a pad, something still stands out', () => {
  const pad = [0, 2].map((b) => ({ t: b * BAR, d: 2 * BAR, p: 55, v: 70 }));
  const res = X.analyse([lane('Drums', 'drums', drums()), lane('Pad', 'pad', pad)], { length: LEN });
  assert.ok(res.lanes.some((l) => l.stands));
  assert.ok(res.lanes.every((l) => l.rel <= 1 && l.rel >= 0));
  for (const l of res.lanes) assert.ok(X.BOXES[l.box], 'every part is in a box');
});

test('logged listening becomes links, but only to parts the section has', () => {
  const base = [
    lane('Drums', 'drums', onSteps([0, 8], 36).concat(onSteps([4, 12], 38))),
    lane('Bass', 'bass', onSteps([0, 8], 36, { d: BEAT }), { heard: ['Locks to the kick', 'Plays sparser: the section is busy'] }),
    lane('Arp', 'arp', onSteps([0, 4, 8, 12], 67), { heard: ['Leaves room for the lead and answers in its rests', 'Moved up an octave to clear the percussion'] }),
  ];
  const res = X.analyse(base, { length: LEN });
  const l = linkOf(res, 'Bass', 'Drums');
  assert.ok(l && l.logged, 'bass listened to the kick');
  assert.ok(!res.links.some((k) => k.to === 'Lead' || k.from === 'Lead'), 'no lead in the section, so no link to it');
  assert.deepStrictEqual(find(res, 'Bass').notes, ['Plays sparser: the section is busy']);
});

test('every listening note the generators write is understood', () => {
  const prog = T.parseProg('i VI III VII', 4, 'minor');
  const seen = new Set();
  const styles = ['lofi', 'house', 'trap', 'pop', 'techno', 'ambient', 'dnb', 'boombap', 'synthwave'];
  let seed = 1;
  for (const style of styles) {
    const lanes = [];
    for (const role of ['drums', 'bass', 'lead', 'chords', 'arp', 'pad', 'perc', 'drums', 'bass']) {
      const band = lanes.length ? Odd.band.hear(lanes, LEN, LEN) : null;
      const part = Odd.gen.generate({ role, style, seed: seed++, bars: 4, tonic: 0, scale: 'minor', prog, band });
      for (const h of part.heard || []) seen.add(h);
      lanes.push({ role, events: R.partEvents(part, {}) });
    }
  }
  assert.ok(seen.size >= 4, 'the generators listened: ' + [...seen].join(' / '));
  for (const h of seen) assert.ok(X.readHeard(h), 'understood: ' + h);
  assert.strictEqual(X.readHeard('Something new'), null);
  assert.deepStrictEqual(X.readHeard('Moved down an octave to clear the percussion'), { to: 'perc', kind: 'clear', kick: false });
});

test('a section: harmony followers, muted and soloed lanes, and the song in order', () => {
  const ws = M.createWorkspace({ seed: 5, style: 'pop' });
  const s = ws.sessions[0];
  M.fillStarter(ws, s, 9);
  const chorus = s.sections.find((x) => x.name === 'Chorus');
  const lead = M.laneForRole(s, 'lead');
  const bass = M.laneForRole(s, 'bass');
  let res = X.forSection(s, chorus);
  assert.ok(res.lanes.length >= 5);
  assert.ok(res.harmony.follow.includes(lead.id), 'a refit part follows the chords');
  assert.ok(!res.harmony.follow.includes(M.laneForRole(s, 'drums').id), 'drums have no chords to follow');
  chorus.slots[bass.id].refit = false;
  assert.ok(X.forSection(s, chorus).harmony.own.includes(bass.id));
  lead.mute = true;
  assert.ok(!X.forSection(s, chorus).lanes.some((l) => l.id === lead.id), 'a muted lane is not heard');
  lead.mute = false;
  bass.solo = true;
  assert.deepStrictEqual(X.forSection(s, chorus).lanes.map((l) => l.id), [bass.id]);
  bass.solo = false;
  const song = X.song(s);
  assert.strictEqual(song.length, s.arrangement.length);
  const verses = song.filter((e) => e.section.name === 'Verse');
  assert.strictEqual(verses[0].fit, verses[1].fit, 'a repeated section is measured once');
  res = X.forSection(s, s.sections.find((x) => x.name === 'Intro'));
  assert.ok(res.lanes.every((l) => ['pad', 'arp'].includes(l.role)));
});
