'use strict';
// Chords from outside the key: parsing, naming, generation, refit.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/index', 'core/shape', 'core/render', 'core/midi-file', 'core/zip', 'core/model', 'core/export',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const R = Odd.render;
const M = Odd.model;

const name = (tok, scale, tonic) => T.chordName(T.parseChord(tok, scale), tonic || 0, scale);
const pcs = (events) => Array.from(new Set(events.map((e) => T.NOTE_NAMES[e.p % 12]))).sort();

test('chord names in C major', () => {
  const want = {
    I: 'C', ii: 'Dm', V7: 'G7', 'V/V': 'D', 'V7/ii': 'A7', 'V/vi': 'E', bVI: 'Ab', bVII: 'Bb', bIII: 'Eb',
    iv: 'Fm', N: 'Db', bII7: 'Db7', I7: 'C7', 'vii°/V': 'F#dim', 'vii°7': 'Bdim7', viiø7: 'Bm7b5', IVmaj7: 'Fmaj7',
  };
  for (const [tok, n] of Object.entries(want)) assert.strictEqual(name(tok, 'major'), n, tok);
});

test('chord names in C minor: accidentals count from the major scale', () => {
  const want = { i: 'Cm', V: 'G', V7: 'G7', v: 'Gm', bVI: 'Ab', VI: 'Ab', bVII: 'Bb', VII: 'Bb', bIII: 'Eb', IV: 'F', N: 'Db', 'vii°7': 'Bdim7', I: 'C' };
  for (const [tok, n] of Object.entries(want)) assert.strictEqual(name(tok, 'minor'), n, tok);
  // the plain chords of the key need no accidental
  assert.ok(T.isDiatonic(T.parseChord('bVI', 'minor')));
});

test('plain chords keep their old numerals in every mode', () => {
  const want = {
    major: 'I ii iii IV V vi vii°',
    minor: 'i ii° III iv v VI VII',
    harmonicMinor: 'i ii° III+ iv V VI vii°',
    dorian: 'i ii III IV v vi° VII',
  };
  for (const [scale, text] of Object.entries(want)) {
    assert.strictEqual([0, 1, 2, 3, 4, 5, 6].map((d) => T.roman(d, scale)).join(' '), text, scale);
  }
});

test('every chord reads back as the same chord', () => {
  const toks = ['I', 'i', 'V', 'V7', 'v', 'V/V', 'V7/ii', 'V/vi', 'bVI', 'bVII', 'bIII', 'iv', 'IV', 'N', 'bII7', 'I7',
    'vii°/V', 'ii', 'iii', 'IVmaj7', 'viiø7', 'vii°7', 'VII', 'VI', '#iv°', 'vi', 'V/IV', 'V7/vi', 'vii°7/V', 'V/iii'];
  for (const scale of Object.keys(T.SCALES)) {
    for (const tok of toks) {
      const c = T.parseChord(tok, scale);
      assert.ok(c, scale + ' ' + tok);
      const back = T.parseChord(T.roman(c, scale), scale);
      assert.ok(T.sameChord(back, c), scale + ' ' + tok + ' -> ' + T.roman(c, scale));
    }
  }
});

test('secondary dominants read as V/x', () => {
  const r = (tok) => T.roman(T.parseChord(tok, 'major'), 'major');
  assert.strictEqual(r('II'), 'V/V');
  assert.strictEqual(r('III7'), 'V7/vi');
  assert.strictEqual(r('I7'), 'V7/IV');
  assert.strictEqual(r('bVI'), 'bVI');
  assert.strictEqual(r('N'), 'bII');
});

test('progression text round-trips with lengths and chromatic chords', () => {
  const prog = T.parseProg('I:4 V/V:2 V7:2 bVI:2 bVII:2 iv:4', 4, 'major');
  assert.strictEqual(T.progBeats(prog), 16);
  const text = T.formatProg(prog, 'major');
  assert.deepStrictEqual(T.parseProg(text, 4, 'major'), prog);
  // without a scale only the roots are kept (plain degrees)
  assert.ok(T.parseProg('bVI V/V', 2).every((c) => T.isDiatonic(c)));
  assert.strictEqual(T.parseProg('I X', 2, 'major'), null);
});

test('generated parts follow chromatic chords', () => {
  const prog = T.parseProg('I V/V V7 bVI bVII iv N V7', 8, 'major');
  for (const role of ['chords', 'pad', 'arp']) {
    for (let seed = 1; seed <= 6; seed++) {
      const p = Odd.gen.generate({ role, style: 'lofi', seed, bars: 8, tonic: 0, scale: 'major', prog });
      for (const e of R.partEvents(p, { tonic: 0, scale: 'major', prog: p.ctx.prog })) {
        const c = T.chordAt(prog, e.t).chord;
        const alt = T.chordAlt(c, 'major');
        const scalePcs = [0, 1, 2, 3, 4, 5, 6].map((k) => T.mod(T.degToSemis(k, 'major') + alt[k], 12));
        assert.ok(scalePcs.includes(T.mod(e.p, 12)), role + ' ' + T.midiName(e.p) + ' over ' + T.chordName(c, 0, 'major'));
      }
    }
  }
  const chords = Odd.gen.generate({ role: 'chords', style: 'lofi', seed: 3, bars: 1, tonic: 0, scale: 'major', prog: T.parseProg('V/V', 1, 'major') });
  const ev = R.partEvents(chords, { tonic: 0, scale: 'major', prog: chords.ctx.prog });
  assert.ok(pcs(ev).includes('F#') && !pcs(ev).includes('F'));
});

test('an explicit 7th is always played', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const p = Odd.gen.generate({ role: 'chords', style: 'trap', seed, bars: 1, tonic: 0, scale: 'major', prog: T.parseProg('V7', 1, 'major') });
    assert.ok(pcs(R.partEvents(p, { tonic: 0, scale: 'major', prog: p.ctx.prog })).includes('F'), 'seed ' + seed);
  }
});

test('refit swaps the old chord\'s accidentals for the new chord\'s', () => {
  const at = (p, tok) => pcs(R.partEvents(p, { tonic: 0, scale: 'major', prog: T.parseProg(tok, 1, 'major') }));
  const overVV = Odd.gen.generate({ role: 'chords', style: 'lofi', seed: 3, bars: 1, tonic: 0, scale: 'major', prog: T.parseProg('V/V', 1, 'major') });
  assert.ok(!at(overVV, 'ii').includes('F#') && at(overVV, 'ii').includes('F'));
  const overII = Odd.gen.generate({ role: 'chords', style: 'lofi', seed: 3, bars: 1, tonic: 0, scale: 'major', prog: T.parseProg('ii', 1, 'major') });
  assert.ok(at(overII, 'V/V').includes('F#'));
  const ab = at(overII, 'bVI');
  assert.ok(ab.includes('Ab') && ab.includes('Eb') && !ab.includes('A') && !ab.includes('E'), ab.join(' '));
});

test('bass approach notes aim at the real next root', () => {
  // into bVI (Ab) a chromatic approach is G or A, never Ab itself early
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const prog = T.parseProg('I bVI', 2, 'major');
    const p = Odd.gen.generate({ role: 'bass', style: 'boombap', seed, bars: 2, tonic: 0, scale: 'major', prog, params: { movement: 1 } });
    for (const e of R.partEvents(p, { tonic: 0, scale: 'major', prog: p.ctx.prog })) {
      if (e.t >= T.BAR || e.t < T.BAR - T.BEAT) continue;
      checked++;
      assert.notStrictEqual(T.NOTE_NAMES[e.p % 12], 'Ab', 'Ab before the bVI at seed ' + seed);
    }
  }
  assert.ok(checked > 0);
});

test('colour: off leaves chords plain, on keeps the length and repeats loops the same way', () => {
  for (let i = 0; i < 50; i++) {
    const plain = T.generateProgression(Odd.rng.create(i), { scale: 'major', bars: 8 });
    const zero = T.generateProgression(Odd.rng.create(i), { scale: 'major', bars: 8, color: 0 });
    assert.deepStrictEqual(zero, plain);
    assert.ok(plain.every((c) => T.isDiatonic(c)));
    const rich = T.generateProgression(Odd.rng.create(i), { scale: 'minor', bars: 8, color: 0.9 });
    assert.strictEqual(T.progBeats(rich), 32);
  }
  const loop = T.parseProg('I IV vi V I IV vi V', 8, 'major');
  for (let i = 0; i < 40; i++) {
    const out = T.colorProgression(loop, Odd.rng.create(i), 'major', 0.9);
    const text = T.formatProg(out, 'major').split(' ');
    const half = text.length / 2;
    if (Number.isInteger(half) && T.progBeats(out.slice(0, half)) === 16) {
      assert.deepStrictEqual(text.slice(0, half), text.slice(half), text.join(' '));
    }
  }
  let colored = 0;
  for (let i = 0; i < 100; i++) {
    if (T.generateProgression(Odd.rng.create(i), { scale: 'major', bars: 8, color: 0.6 }).some((c) => !T.isDiatonic(c))) colored++;
  }
  assert.ok(colored > 30 && colored < 95, 'colourful sections: ' + colored + '%');
});

test('changing the mode keeps chromatic chords sounding the same', () => {
  const ws = M.createWorkspace({ seed: 2, style: 'pop', scale: 'major' });
  const s = ws.sessions[0];
  s.sections[0].prog = T.parseProg('I bIII V/V iv', s.sections[0].bars, 'major');
  const before = s.sections[0].prog.map((c) => T.chordName(c, 0, 'major'));
  M.setScale(s, 'minor');
  const after = s.sections[0].prog.map((c) => T.chordName(c, 0, 'minor'));
  assert.deepStrictEqual(after.slice(1), before.slice(1)); // I becomes i: plain chords follow the mode
  assert.strictEqual(after[0], 'Cm');
  assert.ok(T.isDiatonic(s.sections[0].prog[1]), 'bIII is plain III in minor');
});

test('saved chords are cleaned when loading', () => {
  const ws = M.createWorkspace({ seed: 4 });
  const sec = ws.sessions[0].sections[0];
  sec.prog = [{ deg: 1, beats: 8, acc: '-1', mode: 'lydian' }, { deg: 2, beats: 8, mode: 'nonsense', acc: 9 }];
  const back = M.migrate(JSON.parse(JSON.stringify(ws)));
  const p = back.sessions[0].sections[0].prog;
  assert.deepStrictEqual(T.chordOnly(p[0]), { deg: 1, acc: -1, mode: 'lydian' });
  assert.ok(!p[1].mode && p[1].acc === 2);
  assert.strictEqual(T.progBeats(p), back.sessions[0].sections[0].bars * 4);
});

test('a song with chromatic chords exports', () => {
  const ws = M.createWorkspace({ seed: 7, style: 'lofi' });
  const s = ws.sessions[0];
  M.fillStarter(ws, s, 8);
  for (const sec of s.sections) sec.prog = T.parseProg('i bII7 V7/iv iv', sec.bars, s.scale);
  const file = Odd.midiFile.read(Odd.exporter.songMidi(s));
  assert.ok(file.tracks.some((t) => t.notes.length));
});
