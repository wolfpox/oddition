'use strict';
// Parts listening to each other: a new take hears what its section already plays.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/model',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const R = Odd.render;
const B = Odd.band;
const G = Odd.gen;

const prog = T.parseProg('i VI III VII', 4, 'minor');
const req = (role, style, seed, band) => ({ role, style, seed, bars: 4, tonic: 0, scale: 'minor', prog, band });
const events = (part) => R.partEvents(part, {});
const stepOf = (t) => Math.round(t / T.STEP);

test('hearing: kicks, bass onsets and lead activity over the take length', () => {
  const kick = [0, 4, 8, 12].map((s) => ({ t: s * T.STEP, d: 60, p: 36, v: 100 }));
  const band = B.hear([
    { role: 'drums', events: kick.concat([{ t: 2 * T.STEP, d: 60, p: 42, v: 80 }]) },
    { role: 'lead', events: [{ t: 0, d: T.BEAT, p: 72, v: 90 }] },
  ], T.BAR, 2 * T.BAR);
  assert.strictEqual(band.steps, 32);
  // a one-bar section loops under a two-bar take
  assert.deepStrictEqual([0, 4, 8, 12, 16, 20].map((s) => band.kick[s]), [1, 1, 1, 1, 1, 1]);
  assert.strictEqual(band.kick[2], 0, 'hi-hats are not kicks');
  assert.strictEqual(band.lead[0], 1);
  assert.strictEqual(band.lead[4], 0);
  assert.strictEqual(band.lead[16], 1);
  assert.strictEqual(B.hear([], T.BAR, T.BAR), null);
  // a longer section folds onto a shorter take: kicks in half the passes count half
  const half = B.hear([{ role: 'drums', events: [{ t: 0, d: 60, p: 36, v: 100 }] }], 2 * T.BAR, T.BAR);
  assert.strictEqual(half.kick[0], 0.5);
});

test('no band, same take: listening never changes a take on its own', () => {
  for (const role of G.ROLES) {
    const a = G.generate(req(role, 'lofi', 5));
    const b = G.generate(req(role, 'lofi', 5, null));
    assert.deepStrictEqual(a.notes, b.notes, role);
    assert.ok(!a.heard, role);
  }
  // a band heard over another length is ignored
  const band = B.hear([{ role: 'drums', events: [{ t: 0, d: 60, p: 36, v: 100 }] }], T.BAR, T.BAR);
  assert.deepStrictEqual(G.generate(req('bass', 'trap', 3, band)).notes, G.generate(req('bass', 'trap', 3)).notes);
});

function lockRate(style, listen) {
  let on = 0, all = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const dev = events(G.generate(req('drums', style, seed)));
    const kicks = new Set(dev.filter((e) => e.p === 36).map((e) => stepOf(e.t)));
    const band = listen ? B.hear([{ role: 'drums', events: dev }], 4 * T.BAR, 4 * T.BAR) : null;
    for (const n of G.generate(req('bass', style, seed + 50, band)).notes) {
      all++;
      if (kicks.has(stepOf(n.t))) on++;
    }
  }
  return on / all;
}

test('bass locks onto the kick', () => {
  for (const style of ['boombap', 'trap']) {
    const alone = lockRate(style, false), heard = lockRate(style, true);
    assert.ok(heard > alone + 0.1, style + ': ' + alone.toFixed(2) + ' -> ' + heard.toFixed(2));
  }
});

test('house bass moves off a kick it would land on', () => {
  // kicks on every 8th: some of the bass's offbeats hit them
  const kicks = [];
  for (let s = 0; s < 64; s += 2) kicks.push({ t: s * T.STEP, d: 60, p: 36, v: 100 });
  const band = B.hear([{ role: 'drums', events: kicks }], 4 * T.BAR, 4 * T.BAR);
  let before = 0, after = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const on = (p) => p.notes.filter((n) => stepOf(n.t) % 2 === 0).length / p.notes.length;
    before += on(G.generate(req('bass', 'house', seed)));
    const heard = G.generate(req('bass', 'house', seed, band));
    after += on(heard);
  }
  assert.ok(after < before, before.toFixed(2) + ' -> ' + after.toFixed(2));
});

test('drums lean the kick onto the bass', () => {
  let alone = 0, heard = 0, a = 0, h = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const bev = events(G.generate(req('bass', 'boombap', seed + 9)));
    const on = new Set(bev.map((e) => stepOf(e.t)));
    const band = B.hear([{ role: 'bass', events: bev }], 4 * T.BAR, 4 * T.BAR);
    for (const n of G.generate(req('drums', 'boombap', seed)).notes) if (n.p === 36) { a++; if (on.has(stepOf(n.t))) alone++; }
    for (const n of G.generate(req('drums', 'boombap', seed, band)).notes) if (n.p === 36) { h++; if (on.has(stepOf(n.t))) heard++; }
  }
  assert.ok(heard / h > alone / a, (alone / a).toFixed(2) + ' -> ' + (heard / h).toFixed(2));
});

test('a busy section makes takes sparser, a sparse one a little busier', () => {
  const busy = { roles: ['lead', 'arp', 'bass'], load: 2.8 };
  const quiet = { roles: ['bass'], load: 0.2 };
  const mid = { roles: ['bass', 'chords'], load: 1.1 };
  assert.ok(B.balance('lead', 0.5, busy, 'pop').density < 0.4);
  assert.ok(B.balance('lead', 0.5, quiet, 'pop').density > 0.5);
  assert.strictEqual(B.balance('lead', 0.5, mid, 'pop').density, 0.5);
  assert.strictEqual(B.balance('pad', 0.5, busy, 'pop').density, 0.5, 'pads are left alone');
  assert.strictEqual(B.balance('lead', 0.5, { roles: ['bass'], load: 0.1 }, 'ambient').density, 0.5, 'ambient is meant to be sparse');
  // the take records what was asked, not the nudged value
  const lanes = ['lead', 'arp', 'chords', 'bass'].map((role, i) => ({ role, events: events(G.generate(req(role, 'pop', 40 + i, null))) }));
  const band = B.hear(lanes.map((l) => ({ role: l.role, events: l.events.concat(l.events.map((e) => Object.assign({}, e, { t: e.t + 60 }))) })), 4 * T.BAR, 4 * T.BAR);
  const p = G.generate(Object.assign(req('lead', 'pop', 8, band), { params: { density: 0.5 } }));
  assert.strictEqual(p.params.density, 0.5);
  assert.ok(p.heard.some((h) => /sparser/.test(h)), JSON.stringify(p.heard));
});

test('a take moves an octave out of a crowded register, unless an octave was asked for', () => {
  // an arp right where a new arp would sit
  const other = events(G.generate(req('arp', 'synthwave', 2)));
  const doubled = other.concat(other.map((e) => Object.assign({}, e, { p: e.p + 2 })));
  const band = B.hear([{ role: 'arp', events: doubled }], 4 * T.BAR, 4 * T.BAR);
  const plain = G.generate(req('arp', 'synthwave', 2));
  const heard = G.generate(req('arp', 'synthwave', 2, band));
  assert.ok(Math.abs(heard.base - plain.base) === 12, plain.base + ' -> ' + heard.base);
  assert.ok(heard.heard.some((h) => /octave/.test(h)));
  const asked = G.generate(Object.assign(req('arp', 'synthwave', 2, band), { params: { octave: 1 } }));
  assert.strictEqual(asked.base, plain.base + 12);
  // the bass never moves
  const bass = G.generate(req('bass', 'synthwave', 2, B.hear([{ role: 'bass', events: events(G.generate(req('bass', 'synthwave', 2))) }], 4 * T.BAR, 4 * T.BAR)));
  assert.strictEqual(bass.base, G.generate(req('bass', 'synthwave', 2)).base);
});

test('arp leaves room while the lead plays', () => {
  let under = 0, gaps = 0, plainUnder = 0, plainGaps = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const lead = events(G.generate(req('lead', 'synthwave', seed)));
    const band = B.hear([{ role: 'lead', events: lead }], 4 * T.BAR, 4 * T.BAR);
    const count = (p) => {
      let u = 0, g = 0;
      for (const n of p.notes) (band.lead[stepOf(n.t) % band.steps] > 0.5 ? u++ : g++);
      return [u, g];
    };
    const [pu, pg] = count(G.generate(req('arp', 'synthwave', seed + 3)));
    const [hu, hg] = count(G.generate(req('arp', 'synthwave', seed + 3, band)));
    plainUnder += pu; plainGaps += pg; under += hu; gaps += hg;
  }
  assert.ok(under < plainUnder * 0.85, plainUnder + ' -> ' + under);
  assert.strictEqual(gaps, plainGaps, 'notes in the rests stay');
});

test('vary keeps listening when given the band', () => {
  const dev = events(G.generate(req('drums', 'trap', 1)));
  const band = B.hear([{ role: 'drums', events: dev }], 4 * T.BAR, 4 * T.BAR);
  const p = G.generate(req('bass', 'trap', 4, band));
  const v = G.vary(p, { seed: 9, band });
  assert.ok(v.heard && v.heard.length, 'variation heard the band');
  assert.ok(!G.vary(p, { seed: 9 }).heard);
});
