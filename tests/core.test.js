'use strict';
// Core modules: theory, render (refit), MIDI files, zip, model, export.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

for (const f of ['rng', 'theory', 'render', 'midi-file', 'zip', 'model', 'export', 'store']) {
  require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
}
const Odd = globalThis.Odd;
const T = Odd.theory;

function part(overrides) {
  return Object.assign({
    role: 'bass', bars: 1, base: 36,
    ctx: { tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 4 }] },
    notes: [{ t: 0, d: 480, v: 100, deg: 0, acc: 0 }, { t: 960, d: 480, v: 90, deg: 4, acc: 0 }],
  }, overrides);
}

test('pitchOf keeps registers centred across keys', () => {
  for (let tonic = 0; tonic < 12; tonic++) {
    const p = T.pitchOf(0, 0, tonic, 'minor', 48);
    assert.ok(p >= 43 && p <= 54, `tonic ${tonic} -> ${p}`);
  }
  assert.strictEqual(T.pitchOf(7, 0, 0, 'major', 60), 72);
  assert.strictEqual(T.pitchOf(-1, 0, 0, 'major', 60), 59);
  assert.strictEqual(T.pitchOf(2, 0, 0, 'minor', 60), 63);
});

test('progressions fill the section exactly', () => {
  const rng = Odd.rng.create(7);
  for (const scale of Object.keys(T.SCALES)) {
    for (const bars of [1, 2, 4, 8, 16]) {
      for (const rate of [0.5, 1, 2]) {
        const prog = T.generateProgression(rng, { scale, bars, rate });
        assert.strictEqual(T.progBeats(prog), bars * 4);
        for (const c of prog) assert.ok(c.deg >= 0 && c.deg < 7 && c.beats > 0);
      }
    }
  }
});

test('modes only borrow progressions with stable chords', () => {
  const rng = Odd.rng.create(99);
  for (const scale of ['dorian', 'lydian', 'mixolydian', 'phrygian', 'harmonicMinor']) {
    for (let i = 0; i < 300; i++) {
      const prog = T.generateProgression(rng, { scale, bars: 8, rate: 1, vamp: i % 5 === 0 });
      for (const c of prog) {
        const q = T.chordQuality(c.deg, scale);
        if (scale === 'harmonicMinor') assert.notStrictEqual(q, 'aug', scale + ' ' + c.deg);
        else assert.ok(q === 'maj' || q === 'min', scale + ' got ' + q + ' on degree ' + c.deg);
      }
    }
  }
});

test('roman numeral text round-trips', () => {
  const prog = T.parseProg('i VI III VII', 4);
  assert.deepStrictEqual(prog.map((c) => c.deg), [0, 5, 2, 6]);
  assert.strictEqual(T.formatProg(prog, 'minor'), 'i VI III VII');
  assert.strictEqual(T.parseProg('nonsense', 4), null);
  const odd = [{ deg: 0, beats: 4 }, { deg: 6, beats: 4 }, { deg: 0, beats: 8 }, { deg: 3, beats: 4 }, { deg: 0, beats: 4 }, { deg: 6, beats: 4 }, { deg: 3, beats: 4 }];
  assert.strictEqual(T.formatProg(odd, 'minor'), 'i VII i:8 iv i VII iv');
  assert.deepStrictEqual(T.parseProg(T.formatProg(odd, 'minor'), 8), odd);
  assert.strictEqual(T.chordName(0, 9, 'minor'), 'Am');
  assert.strictEqual(T.chordName(4, 0, 'major', 4), 'G7');
});

test('render loops a short part across a longer section', () => {
  const evs = Odd.render.partEvents(part(), { tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 16 }], length: 4 * T.BAR });
  assert.strictEqual(evs.length, 8);
  assert.strictEqual(evs[2].t, T.BAR);
});

test('refit follows the target chords and keys', () => {
  const p = part();
  // over a IV chord, C-G becomes F-C
  const evs = Odd.render.partEvents(p, { tonic: 0, scale: 'major', prog: [{ deg: 3, beats: 4 }], length: T.BAR });
  assert.deepStrictEqual(evs.map((e) => e.p % 12), [5, 0]);
  // over a V chord it moves down (shortest move), staying in register
  const v = Odd.render.partEvents(p, { tonic: 0, scale: 'major', prog: [{ deg: 4, beats: 4 }], length: T.BAR });
  assert.ok(v[0].p < 36 && v[0].p % 12 === 7);
  // refit off keeps the degrees, new key still applies
  const raw = Odd.render.partEvents(p, { tonic: 2, scale: 'major', prog: [{ deg: 3, beats: 4 }], length: T.BAR, refit: false });
  assert.deepStrictEqual(raw.map((e) => e.p % 12), [2, 9]);
  // drums never move
  const drums = Odd.render.partEvents({ role: 'drums', bars: 1, base: null, ctx: p.ctx, notes: [{ t: 0, d: 60, v: 100, p: 36 }] },
    { tonic: 5, scale: 'minor', prog: [{ deg: 3, beats: 4 }], length: T.BAR });
  assert.strictEqual(drums[0].p, 36);
});

test('swing delays only off-beat 16ths', () => {
  const out = Odd.render.applySwing([{ t: 0, d: 120 }, { t: 120, d: 120 }, { t: 240, d: 120 }, { t: 160, d: 80 }], 0.5);
  assert.deepStrictEqual(out.map((e) => e.t), [0, 180, 240, 160]);
});

test('MIDI writer output reads back identically', () => {
  const notes = [{ t: 0, d: 480, p: 60, v: 100 }, { t: 0, d: 480, p: 64, v: 90 }, { t: 480, d: 960, p: 67, v: 80 }];
  const bytes = Odd.midiFile.write({
    name: 'Test', bpm: 93, tonic: 9, scale: 'minor', length: 1920,
    markers: [{ t: 0, text: 'Verse' }],
    tracks: [{ name: 'Keys', channel: 2, program: 4, notes }, { name: 'Drums', channel: 9, notes: [{ t: 0, d: 60, p: 36, v: 120 }] }],
  });
  assert.strictEqual(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  const mf = Odd.midiFile.read(bytes);
  assert.strictEqual(mf.format, 1);
  assert.strictEqual(mf.ppq, 480);
  assert.strictEqual(mf.bpm, 93);
  assert.deepStrictEqual(mf.keySig, { sf: 0, minor: true });
  assert.strictEqual(mf.markers[0].text, 'Verse');
  assert.strictEqual(mf.tracks.length, 3);
  assert.strictEqual(mf.tracks[1].name, 'Keys');
  assert.strictEqual(mf.tracks[1].program, 4);
  assert.deepStrictEqual(mf.tracks[1].notes.map(({ t, d, p, v }) => ({ t, d, p, v })), notes.slice().sort((a, b) => a.t - b.t || a.p - b.p));
  assert.strictEqual(mf.tracks[2].notes[0].ch, 9);
});

test('MIDI writer trims overlapping same-pitch notes', () => {
  const clean = Odd.midiFile.cleanNotes([{ t: 0, d: 500, p: 42, v: 90 }, { t: 240, d: 100, p: 42, v: 80 }, { t: 240, d: 100, p: 42, v: 100 }]);
  clean.sort((a, b) => a.t - b.t);
  assert.deepStrictEqual(clean.map((n) => [n.t, n.d, n.v]), [[0, 240, 90], [240, 100, 100]]);
});

test('zip archive is valid', (t) => {
  const bytes = Odd.zip.create([{ name: 'a/one.txt', data: 'hello' }, { name: 'a/two.bin', data: new Uint8Array([1, 2, 3]) }]);
  assert.strictEqual(Odd.zip.crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const file = path.join(os.tmpdir(), 'oddition-test-' + process.pid + '.zip');
  fs.writeFileSync(file, bytes);
  try {
    execFileSync('unzip', ['-tq', file]);
  } catch (e) {
    if (e.code === 'ENOENT') t.skip('unzip not installed');
    else throw e;
  } finally {
    fs.unlinkSync(file);
  }
});

test('model: sessions, sections, slots and the song', () => {
  const ws = Odd.model.createWorkspace({ seed: 3, style: 'lofi' });
  const s = Odd.model.currentSession(ws);
  assert.strictEqual(s.lanes.length, 7);
  assert.strictEqual(s.lanes.find((l) => l.role === 'drums').channel, 9);
  assert.strictEqual(s.lanes.find((l) => l.role === 'perc').channel, 9);
  // drums and percussion share GM channel 10; every other lane has its own
  assert.strictEqual(new Set(s.lanes.map((l) => l.channel)).size, 6);
  assert.strictEqual(s.sections.length, 3);
  assert.strictEqual(Odd.model.songBars(s), 4 + 8 + 8 + 8 + 8);

  const stored = Odd.model.addToLibrary(ws, part({ name: 'Test bass' }));
  assert.ok(stored.id);
  assert.strictEqual(Odd.model.addToLibrary(ws, stored), stored);
  const verse = s.sections[1];
  const bassLane = Odd.model.laneForRole(s, 'bass');
  Odd.model.placePart(s, verse.id, bassLane.id, stored);
  assert.strictEqual(Odd.model.usageCount(ws, stored.id), 1);

  const song = Odd.render.songEvents(s);
  assert.strictEqual(song.length, 36 * T.BAR);
  assert.strictEqual(song.markers.length, 5);
  assert.ok(song.events.length > 0 && song.events.every((e) => e.track === bassLane.id));

  const lane = Odd.model.addLane(s, 'bass');
  assert.strictEqual(s.lanes[s.lanes.indexOf(bassLane) + 1], lane);
  Odd.model.duplicateSection(s, verse.id);
  assert.strictEqual(s.sections.length, 4);
  assert.ok(Odd.model.removeSection(s, verse.id));
  assert.ok(!s.arrangement.includes(verse.id));

  const again = Odd.model.migrate(JSON.parse(JSON.stringify(ws)));
  assert.ok(again && again.sessions.length === 1);
});

test('exports: song, stems zip, part, project, MIDI import', () => {
  const ws = Odd.model.createWorkspace({ seed: 11, style: 'lofi' });
  const s = Odd.model.currentSession(ws);
  const stored = Odd.model.addToLibrary(ws, part({ name: 'Root bass' }));
  for (const sec of s.sections) Odd.model.placePart(s, sec.id, Odd.model.laneForRole(s, 'bass').id, stored);

  const song = Odd.midiFile.read(Odd.exporter.songMidi(s));
  assert.strictEqual(song.tracks.length, 2);
  assert.strictEqual(song.markers.length, 5);

  const stems = Odd.exporter.stemsZip(s);
  assert.strictEqual(stems.count, 1);
  assert.ok(stems.bytes.length > 100);

  const one = Odd.midiFile.read(Odd.exporter.partMidi(stored, s));
  assert.strictEqual(one.tracks[1].notes.length, 2);

  const proj = Odd.exporter.parseProject(Odd.exporter.projectJson(ws));
  assert.strictEqual(proj.workspace.sessions[0].name, s.name);
  assert.throws(() => Odd.exporter.parseProject('{"hello":1}'));

  const imported = Odd.exporter.importMidi(Odd.exporter.partMidi(stored, s), s, 'riff.mid');
  assert.strictEqual(imported.length, 1);
  assert.strictEqual(imported[0].role, 'bass');
  const back = Odd.render.partEvents(imported[0], { tonic: s.tonic, scale: s.scale, prog: [{ deg: 0, beats: 4 }], length: T.BAR, refit: false });
  const orig = Odd.render.partEvents(stored, { tonic: s.tonic, scale: s.scale, prog: stored.ctx.prog, length: T.BAR });
  assert.deepStrictEqual(back.map((e) => e.p), orig.map((e) => e.p));
});

test('undo history restores snapshots', () => {
  const ws = { a: 1 };
  Odd.history.clear();
  Odd.history.record(ws, 'change a');
  ws.a = 2;
  const u = Odd.history.undo(ws);
  assert.strictEqual(u.ws.a, 1);
  const r = Odd.history.redo(u.ws);
  assert.strictEqual(r.ws.a, 2);
});
