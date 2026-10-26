'use strict';
// Melody first: chords worked out from a tune, and sections the tune leads.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/model', 'core/idea', 'core/harmonise', 'core/relate',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const M = Odd.model;
const R = Odd.render;
const H = Odd.harmonise;
const { BAR, BEAT } = T;

/** one bar per list of pitches, quarter notes */
function tune(bars) {
  const out = [];
  bars.forEach((ps, b) => ps.forEach((p, i) => out.push({ t: b * BAR + i * BEAT, d: BEAT, p, v: 96 })));
  return out;
}

test('arpeggios get the chords they spell', () => {
  const r = H.harmonise(tune([[60, 64, 67, 64], [65, 69, 72, 69], [67, 71, 74, 71], [72, 67, 64, 60]]), { tonic: 0, scale: 'major', bars: 4 });
  assert.strictEqual(T.formatProg(r.prog, 'major'), 'I IV V I');
  assert.strictEqual(r.fit, 1);
  assert.strictEqual(T.progBeats(r.prog), 16);
  assert.deepStrictEqual(r.chords.map((c) => c.start), [0, BAR, 2 * BAR, 3 * BAR]);
  // the same tune in A minor, transposed: i iv v i
  const m = H.harmonise(tune([[69, 72, 76, 72], [74, 77, 81, 77], [76, 79, 83, 79], [81, 76, 72, 69]]), { tonic: 9, scale: 'minor', bars: 4 });
  assert.strictEqual(T.formatProg(m.prog, 'minor'), 'i iv v i');
});

test('a sharp in the tune brings a chord from outside the key', () => {
  // C major: D F# A over bar 3 wants D major (V/V), then G
  const r = H.harmonise(tune([[60, 64, 67, 64], [65, 69, 72, 69], [62, 66, 69, 66], [67, 71, 74, 71]]), { tonic: 0, scale: 'major', bars: 4 });
  assert.strictEqual(T.roman(T.chordAt(r.prog, 2 * BAR).chord, 'major'), 'V/V');
  // a minor tune with the raised seventh gets the major V
  const m = H.harmonise(tune([[69, 72, 76, 72], [74, 77, 81, 77], [76, 80, 83, 80], [81, 76, 72, 69]]), { tonic: 9, scale: 'minor', bars: 4 });
  assert.strictEqual(T.chordQuality(T.chordAt(m.prog, 2 * BAR).chord, 'minor'), 'maj');
});

test('other variants are other good fits, and the same variant is the same answer', () => {
  const ev = tune([[60, 64, 67, 64], [65, 69, 72, 69], [67, 71, 74, 71], [72, 67, 64, 60]]);
  const o = { tonic: 0, scale: 'major', bars: 4 };
  const best = T.formatProg(H.harmonise(ev, o).prog, 'major');
  const seen = new Set();
  for (let v = 1; v <= 3; v++) {
    const r = H.harmonise(ev, Object.assign({ variant: v }, o));
    assert.notStrictEqual(T.formatProg(r.prog, 'major'), best, 'variant ' + v + ' differs');
    assert.ok(r.fit >= 0.6, 'variant ' + v + ' still fits: ' + r.fit);
    assert.strictEqual(T.formatProg(H.harmonise(ev, Object.assign({ variant: v }, o)).prog, 'major'), T.formatProg(r.prog, 'major'));
    seen.add(T.formatProg(r.prog, 'major'));
  }
  assert.ok(seen.size >= 2);
});

test('where the tune rests, the old chords stay', () => {
  const ev = tune([[60, 64, 67, 72]]); // bar 1 only
  const prev = T.parseProg('vi IV I V', 4, 'major');
  const r = H.harmonise(ev, { tonic: 0, scale: 'major', bars: 4, prev });
  assert.strictEqual(T.formatProg(r.prog, 'major'), 'I IV I V');
  const none = H.harmonise([], { tonic: 0, scale: 'major', bars: 4, prev });
  assert.strictEqual(T.formatProg(none.prog, 'major'), 'vi IV I V');
  assert.strictEqual(none.heard, false);
});

test('generated melodies get chords that fit them', () => {
  const fits = [];
  let seed = 3;
  for (const style of ['lofi', 'house', 'pop', 'synthwave', 'trap', 'ambient', 'dnb', 'boombap', 'techno']) {
    for (const scale of ['minor', 'major', 'dorian']) {
      const prog = T.generateProgression(Odd.rng.create(seed), { scale, bars: 8 });
      const part = Odd.gen.generate({ role: 'lead', style, seed: seed++, bars: 8, tonic: 2, scale, prog });
      const ev = R.partEvents(part, { tonic: 2, scale, prog, length: 8 * BAR });
      const r = H.harmonise(ev, { tonic: 2, scale, bars: 8, rate: Odd.styles.get(style).rate });
      assert.strictEqual(T.progBeats(r.prog), 32);
      fits.push(r.fit);
    }
  }
  const mean = fits.reduce((a, b) => a + b, 0) / fits.length;
  assert.ok(mean >= 0.75, 'mean fit ' + mean.toFixed(2));
  assert.ok(Math.min(...fits) >= 0.45, 'worst fit ' + Math.min(...fits).toFixed(2));
});

test('a tune leads its section: it plays as written, the chords follow it, and it can hand them back', () => {
  const ws = M.createWorkspace({ seed: 5, style: 'pop' });
  const s = ws.sessions[0];
  M.fillStarter(ws, s, 9);
  const sec = s.sections.find((x) => x.name === 'Chorus');
  const lead = M.laneForRole(s, 'lead');
  const chords = M.laneForRole(s, 'chords');
  const before = T.formatProg(sec.prog, s.scale);
  const written = R.sectionEvents(s, sec, { only: lead.id, shape: false }).map((e) => e.p);
  assert.ok(H.canLead(s, sec, lead.id));
  assert.ok(!H.canLead(s, sec, M.laneForRole(s, 'drums').id), 'drums have no tune');

  assert.ok(H.lead(s, sec, lead.id));
  assert.strictEqual(H.leaderOf(sec), lead.id);
  assert.strictEqual(sec.slots[lead.id].refit, false, 'the tune plays as written');
  assert.strictEqual(T.progBeats(sec.prog), sec.bars * 4);
  assert.deepStrictEqual(sec.prog, H.forSection(s, sec, lead.id).prog);
  // as written: the same notes whatever the chords
  const asWritten = R.partEvents(sec.slots[lead.id].part, Object.assign(R.sectionTarget(s, sec), { refit: false })).map((e) => e.p);
  assert.deepStrictEqual(R.sectionEvents(s, sec, { only: lead.id, shape: false }).map((e) => e.p), asWritten);

  // who leads: the parts bent to the chords now follow the tune, and it steers
  const fit = Odd.relate.forSection(s, sec);
  assert.strictEqual(fit.harmony.leader, lead.id);
  assert.ok(!fit.harmony.own.includes(lead.id));
  const hk = fit.links.find((k) => k.kind === 'harmony' && k.from === chords.id);
  assert.ok(hk && hk.to === lead.id && hk.logged);
  assert.strictEqual(hk.text, chords.name + ' fit to the chords ' + lead.name + ' sets');
  assert.ok(fit.lanes.find((l) => l.id === lead.id).steers, 'the tune steers');
  assert.ok(fit.lanes.find((l) => l.id === lead.id).why.includes('Sets the chords'));

  // reused elsewhere, the tune fits that section's chords as it did before it led
  const verse = s.sections.find((x) => x.name === 'Verse');
  M.reuseSlot(s, sec.id, lead.id, { [verse.id]: 'full' });
  assert.strictEqual(verse.slots[lead.id].refit, true);

  // other chords for the same tune
  const first = T.formatProg(sec.prog, s.scale);
  H.vary(s, sec, 1);
  assert.strictEqual(sec.lead.variant, 1);
  assert.notStrictEqual(T.formatProg(sec.prog, s.scale), first);
  H.vary(s, sec, -1);
  assert.strictEqual(T.formatProg(sec.prog, s.scale), first);

  // a new tune in the slot: sync re-works the chords
  const other = Odd.gen.generate({ role: 'lead', style: 'pop', seed: 77, bars: sec.bars, tonic: s.tonic, scale: s.scale, prog: sec.prog });
  M.placePart(s, sec.id, lead.id, other);
  H.sync(s);
  assert.strictEqual(sec.slots[lead.id].refit, false);
  assert.deepStrictEqual(sec.prog, H.forSection(s, sec, lead.id).prog);

  // saved and loaded, the lead survives; a new scale carries the old chords along
  const loaded = M.migrate(JSON.parse(JSON.stringify(ws)));
  const lsec = loaded.sessions[0].sections.find((x) => x.id === sec.id);
  assert.strictEqual(H.leaderOf(lsec), lead.id);
  M.setScale(s, 'dorian');
  assert.ok(sec.lead.prev.every((c) => c.beats > 0));
  M.setScale(s, 'minor');

  // hand back: the old chords and the old fit return
  H.release(s, sec);
  assert.strictEqual(H.leaderOf(sec), null);
  assert.strictEqual(T.formatProg(sec.prog, s.scale), before);
  assert.strictEqual(sec.slots[lead.id].refit, true);
  assert.ok(written.length);

  // keep: the tune's chords stay, and the tune keeps its own notes
  H.lead(s, sec, lead.id);
  const kept = T.formatProg(sec.prog, s.scale);
  H.release(s, sec, { keep: true });
  assert.strictEqual(T.formatProg(sec.prog, s.scale), kept);
  assert.strictEqual(sec.slots[lead.id].refit, false);

  // a lead whose part is gone goes back to the old chords
  sec.slots[lead.id].refit = true;
  H.lead(s, sec, lead.id);
  M.clearSlot(s, sec.id, lead.id);
  H.sync(s);
  assert.strictEqual(H.leaderOf(sec), null);
  assert.strictEqual(T.formatProg(sec.prog, s.scale), kept);
});
