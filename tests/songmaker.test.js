'use strict';
// Song Builder: a gold idea grown into sections, each with a way in and a way out.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad',
  'gen/lead', 'gen/arp', 'gen/band', 'gen/index', 'core/shape', 'core/render', 'core/edit', 'core/midi-file', 'core/model', 'core/idea',
  'core/audition', 'core/songmaker',
]) require(path.join(__dirname, '..', 'js', f + '.js'));

const Odd = globalThis.Odd;
const T = Odd.theory;
const A = Odd.audition;
const F = A.flow;
const SM = Odd.songmaker;

function gold(i1, i2, pick, dirs) {
  let S = F.enter(F.fresh(), 'seed1');
  S = F.pick(S, i1);
  S = F.pick(S, i2);
  for (const d of dirs || ['chords', 'bass', 'perc', 'beat', 'pads', 'sound']) S = F.pick(F.enter(S, d), pick);
  const idea = Odd.idea.fromParts(A.toParts(S.idea), { name: A.ideaName(S.idea), from: 'bones' });
  idea.bones = JSON.parse(JSON.stringify(S.idea));
  return idea;
}
const MAIN = gold(1, 1, 1);
const GUEST = gold(0, 2, 0, ['chords', 'bass', 'sound']);

function sane(seq, label) {
  assert.ok(seq.length > 0, label + ': has length');
  assert.ok(seq.events.length > 0, label + ': has notes');
  for (const e of seq.events) {
    assert.ok(seq.tracks[e.track], label + ': track ' + e.track + ' exists');
    assert.ok(Number.isFinite(e.t) && e.t >= 0 && e.t < seq.length + 1, label + ': time in range ' + e.t + ' / ' + seq.length);
    assert.ok(Number.isFinite(e.d) && e.d > 0, label + ': duration');
    assert.ok(e.p >= 0 && e.p <= 127 && e.v >= 1 && e.v <= 127, label + ': pitch and velocity');
  }
}

test('a new song: the idea as the chorus, with an open slot either side', () => {
  const song = SM.create(MAIN, null, 'chorus');
  assert.strictEqual(song.secs.length, 3);
  assert.deepStrictEqual(song.secs.map((s) => !!s.body), [false, true, false]);
  const C = SM.context(song);
  assert.strictEqual(C.layers.length, 6);
  assert.strictEqual(C.lead, 'v0');
  assert.strictEqual(C.bpm, MAIN.bones.layers.sound.bpm, 'tempo comes from the idea’s sound');
  const sec = song.secs[1];
  const r = SM.renderSection(C, sec, null);
  assert.strictEqual(r.length, sec.body.bars * T.BAR);
  const seq = SM.sectionSeq(C, song, sec);
  sane(seq, 'chorus');
  const used = new Set(seq.events.map((e) => e.track));
  assert.ok(C.layers.every((l) => used.has('sm-' + l.key)), 'every layer plays in a chorus');
});

test('a verse leaves the beat and pads out', () => {
  const song = SM.create(MAIN, null, 'verse');
  const C = SM.context(song);
  const evs = SM.renderBody(C, song.secs[1].body);
  const roles = new Set(evs.map((e) => C.layers.find((l) => l.key === e.L).role));
  assert.ok(!roles.has('drums') && !roles.has('pad'));
  assert.ok(roles.has('lead') && roles.has('bass'));
});

test('every option for every part plays, for every kind of section', () => {
  let song = SM.create(MAIN, GUEST, 'chorus');
  const C = SM.context(song);
  // fill the open slots so ways in and out have neighbours
  for (const id of ['s1', 's3']) {
    const sec = SM.findSec(song, id);
    const o = SM.actOptions(C, song, sec, 'sub', 0)[0];
    song = SM.patchSec(song, id, o.make(sec));
  }
  let n = 0;
  for (const t of SM.TREAT) {
    const sec = SM.findSec(song, 's2');
    const made = t.cfg({ C, song, mainCfg: SM.ROLES.chorus.make(C) });
    const s2 = SM.patchSec(song, 's2', { body: made, kind: t.id });
    const sec2 = SM.findSec(s2, 's2');
    sane(SM.sectionSeq(C, s2, sec2), 'treatment ' + t.id);
    for (const act of ['build', 'fin']) {
      for (let b = 0; b < 4; b++) {
        for (const o of SM.actOptions(C, s2, sec2, act, b)) {
          if (o.bars === 0) continue;
          sane(SM.previewSeq(C, s2, sec2, o), t.id + ' ' + o.key);
          n++;
        }
      }
    }
    for (const tool of ['vibe', 'idea', 'tweak']) {
      for (const L of C.layers) {
        for (let b = 0; b < 3; b++) for (const o of SM.toolOptions(C, s2, sec2, tool, L.key, b)) sane(SM.previewSeq(C, s2, sec2, o), t.id + ' ' + o.key);
      }
    }
    for (let b = 0; b < 2; b++) for (const o of SM.twistOptions(C, s2, sec2, [0, sec2.body.bars - 1], b)) sane(SM.previewSeq(C, s2, sec2, o), t.id + ' ' + o.key);
    assert.ok(sec);
  }
  assert.ok(n > 100, 'previewed ' + n + ' ways in and out');
});

test('each way in and way out has its own sound', () => {
  const song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const body = song.secs[1].body;
  const sig = (evs) => evs.map((e) => e.L + e.t + ':' + e.p).join(',');
  const ins = SM.INTROS.filter((x) => x.bars).map((x) => sig(SM.introEvents(C, body, { k: x.id, bars: 2 })));
  assert.strictEqual(new Set(ins).size, ins.length, 'ways in all differ');
  const outs = SM.OUTROS.filter((x) => x.bars && x.id !== 'handoff').map((x) => sig(SM.outroEvents(C, body, { k: x.id, bars: 2 }, null)));
  assert.strictEqual(new Set(outs).size, outs.length, 'ways out all differ');
  const gap = SM.introEvents(C, body, { k: 'gap', bars: 2 });
  assert.ok(gap.every((e) => e.t + e.d <= 2 * T.BAR - T.BEAT), 'build then silence: the last beat is empty');
  const breath = SM.outroEvents(C, body, { k: 'breath', bars: 2 }, null);
  assert.ok(breath.every((e) => e.L === 'hold'), 'breathing room is one held chord');
});

test('the song plays every section in order, each at its own tempo', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const sec = SM.findSec(song, 's3');
  song = SM.patchSec(song, 's3', { body: Object.assign(SM.ROLES.verse.make(C), { bpm: Math.round(C.bpm / 2) }), name: 'Verse', kind: 'light' });
  song = SM.patchSec(song, 's2', { outro: { k: 'pulse', bars: 2 } });
  const seq = SM.songSeq(C, song);
  sane(seq, 'song');
  assert.deepStrictEqual(seq.markers.map((m) => m.id), ['s2', 's3'], 'empty sections are skipped');
  const [a, b] = seq.markers;
  assert.strictEqual(a.end - a.start, (8 + 2) * T.BAR);
  assert.strictEqual(b.end - b.start, 8 * T.BAR * 2, 'half the tempo takes twice as long');
  assert.ok(sec);
});

test('keywords reorder what Bobby offers, and his pick depends on the neighbours', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const sec = song.secs[1];
  const plain = SM.actOptions(C, song, sec, 'sub', 0).map((o) => o.key);
  song = Object.assign({}, song, { kw: [{ id: 'drive', lean: -2 }, { id: 'busy', lean: -2 }].concat(SM.defaultKw().filter((k) => k.id !== 'drive' && k.id !== 'busy')) });
  const calm = SM.actOptions(C, song, sec, 'sub', 0);
  assert.notDeepStrictEqual(calm.map((o) => o.key), plain);
  assert.ok(['a:half', 'a:bones', 'a:break', 'a:light'].includes(calm[0].key), 'laid-back and spare first: ' + calm[0].key);
  assert.match(SM.tagsOf(song.kw, calm[0].t), /Laid-back|Spare/);
  // alone in the song: first and last, so it climbs in and rings out
  const lone = SM.create(MAIN, null, 'chorus');
  const all = SM.allActOptions(C, lone, lone.secs[1]);
  assert.strictEqual(all.picks.build, 'build:climb');
  assert.strictEqual(all.picks.fin, 'fin:ringout');
});

test('sections: undo, duplicate, remove, close, lengths', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const before = song.secs[1].body.bars;
  song = SM.stepPart(song, 's2', 'body', 1);
  assert.strictEqual(song.secs[1].body.bars, before + 2);
  song = SM.undoSec(song, 's2');
  assert.strictEqual(song.secs[1].body.bars, before);
  let r = SM.dupSec(song, 's2');
  song = r.song;
  assert.strictEqual(song.secs.length, 4);
  assert.strictEqual(song.secs[2].id, r.id);
  r = SM.removeSec(song, 's1');
  song = r.song;
  assert.strictEqual(song.secs.length, 3);
  song.secs.forEach((s) => { song = SM.setOpen(song, s.id, false); });
  assert.ok(SM.allClosed(song));
  assert.strictEqual(SM.stepPart(song, 's2', 'body', 1), song, 'closed sections do not change');
  assert.ok(C);
});

test('analysis counts the song and points at what is missing', () => {
  const song = SM.create(MAIN, GUEST, 'chorus');
  const C = SM.context(song);
  const an = SM.analyse(C, song);
  assert.strictEqual(an.stats.length, 5);
  const texts = an.opps.map((o) => o.text).join(' | ');
  assert.match(texts, /open and empty/);
  assert.match(texts, /starts the song cold/);
  assert.match(texts, /hasn’t shown up yet/);
  assert.ok(an.opps.every((o) => o.go && (o.go.sel || o.go.add)));
});

test('the guest melody moves into the main idea’s key', () => {
  const song = SM.create(MAIN, GUEST, 'chorus');
  const C = SM.context(song);
  const body = Object.assign(SM.ROLES.chorus.make(C), { src: 'guest' });
  const lead = SM.renderBody(C, body).filter((e) => e.L === C.lead);
  assert.ok(lead.length > 0);
  const sc = T.SCALES[C.scale];
  const pcs = new Set(sc.steps ? sc.steps.map((s) => T.mod(C.tonic + s, 12)) : []);
  if (pcs.size) {
    const inKey = lead.filter((e) => pcs.has(T.mod(e.p, 12))).length / lead.length;
    assert.ok(inKey > 0.7, 'mostly in key: ' + inKey);
  }
});

test('songs survive saving, and export to MIDI', () => {
  let song = SM.create(MAIN, GUEST, 'hook');
  song = SM.patchSec(song, 's2', { intro: { k: 'riser', bars: 2 }, outro: { k: 'ringout', bars: 4 } });
  const back = SM.repair(JSON.parse(JSON.stringify(song)));
  assert.ok(back);
  assert.strictEqual(back.secs.length, 3);
  assert.deepStrictEqual(back.secs[1].intro, { k: 'riser', bars: 2 });
  assert.deepStrictEqual(back.secs[1].body.lay, song.secs[1].body.lay);
  assert.strictEqual(back.nid, song.nid);
  assert.strictEqual(SM.repair({ main: null }), null);
  const bytes = SM.midi(SM.context(back), back);
  assert.ok(bytes && bytes.length > 100);
  assert.strictEqual(String.fromCharCode.apply(null, bytes.slice(0, 4)), 'MThd');
});

test('an idea from the studio (not Bones to Gold) works too', () => {
  const s = Odd.model.createSession({ style: 'lofi' });
  const parts = ['lead', 'bass', 'drums'].map((role) => Odd.gen.generate({ role, style: 'lofi', seed: 7, bars: 4, tonic: s.tonic, scale: s.scale, prog: T.sliceProg(s.sections[0].prog, 0, 4 * T.BAR) }));
  const idea = Odd.idea.fromParts(parts.map((part) => ({ part })), { name: 'Booth idea' });
  const song = SM.create(idea, null, 'chorus', { bpm: 90, patchFor: () => 'keys' });
  const C = SM.context(song, { bpm: 90, patchFor: () => 'keys' });
  assert.strictEqual(C.bpm, 90);
  assert.strictEqual(song.secs[1].body.bars, 8);
  sane(SM.sectionSeq(C, song, song.secs[1]), 'booth idea');
});

test('a melody-only idea grows layers, and the melody stays as written', () => {
  const lone = gold(1, 1, 1, []);
  let song = SM.create(lone, null, 'chorus');
  let C = SM.context(song);
  assert.deepStrictEqual(C.layers.map((l) => l.role), ['lead']);
  assert.deepStrictEqual(SM.addable(C).map((a) => a.role), ['chords', 'bass', 'pad', 'perc', 'drums']);
  const melody = (s) => { const c = SM.context(s); return SM.renderBody(c, s.secs[1].body).filter((e) => e.L === c.lead).map((e) => e.t + ':' + e.p).join(); };
  const before = melody(song);
  song = SM.setOpen(SM.addSec(song, 3).song, 's1', false);
  for (const role of ['chords', 'bass', 'drums']) {
    const opts = SM.layerOptions(C, song, role, 0);
    assert.strictEqual(opts.length, 3, role + ': three takes');
    sane(SM.layerPreview(C, song, song.secs[1], opts[0]), role + ' preview');
    song = SM.addLayer(song, opts[0]);
    C = SM.context(song);
  }
  assert.deepStrictEqual(C.layers.map((l) => l.role), ['lead', 'chords', 'bass', 'drums']);
  assert.strictEqual(melody(song), before, 'new chords leave the melody alone');
  const body = song.secs.find((s) => s.id === 's2').body;
  assert.ok(['v1', 'v2', 'v3'].every((k) => body.lay[k].on), 'on in an open section');
  sane(SM.songSeq(C, song), 'song with new layers');
  // remove, put back, and it survives saving
  song = SM.removeLayer(song, 'v2');
  C = SM.context(song);
  assert.deepStrictEqual(C.layers.map((l) => l.role), ['lead', 'chords', 'drums']);
  assert.deepStrictEqual(SM.removedLayers(C, song).map((x) => x.key), ['v2']);
  const saved = SM.repair(JSON.parse(JSON.stringify(song)));
  assert.deepStrictEqual(SM.context(saved).layers.map((l) => l.role), ['lead', 'chords', 'drums']);
  song = SM.restoreLayer(saved, 'v2');
  assert.deepStrictEqual(SM.context(song).layers.map((l) => l.role), ['lead', 'chords', 'bass', 'drums']);
});

test('ideas from the studio get generated layers that fit', () => {
  const lead = Odd.gen.generate({ role: 'lead', style: 'lofi', seed: 7, bars: 2, tonic: 2, scale: 'minor', prog: [{ deg: 0, beats: 4 }, { deg: 5, beats: 4 }] });
  const idea = Odd.idea.fromParts([{ part: lead }], { name: 'Hook' });
  let song = SM.create(idea, null, 'chorus');
  const C = SM.context(song);
  const opts = SM.layerOptions(C, song, 'bass', 0);
  assert.strictEqual(opts.length, 3);
  assert.deepStrictEqual(opts.map((o) => o.label), ['Sparse bass', 'Steady bass', 'Busy bass']);
  song = SM.addLayer(song, opts[1]);
  const C2 = SM.context(song);
  assert.deepStrictEqual(C2.layers.map((l) => l.role), ['lead', 'bass']);
  sane(SM.sectionSeq(C2, song, song.secs[1]), 'generated bass');
});

test('Vary a layer: every form and tweak by name, and As written undoes them', () => {
  const song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const sec = song.secs[1];
  const opts = SM.toolOptions(C, song, sec, 'tweak', C.lead);
  const names = opts.map((o) => o.label);
  for (const n of ['Outline', 'Tease', 'Fragment', 'Stretch', 'Chop', 'Up an octave']) assert.ok(names.includes(n), n);
  const outlined = opts.find((o) => o.label === 'Outline').make(sec).body;
  assert.strictEqual(outlined.lay[C.lead].form, 'outline');
  const sec2 = Object.assign({}, sec, { body: outlined });
  const back = SM.toolOptions(C, song, sec2, 'tweak', C.lead).find((o) => o.label === 'As written');
  assert.ok(back, 'As written is offered once something changed');
  assert.strictEqual(back.make(sec2).body.lay[C.lead].form, 'full');
});

test('the timeline matches the song sequence', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const o = SM.actOptions(C, song, song.secs[0], 'sub', 0)[0];
  song = SM.patchSec(song, 's1', o.make(song.secs[0]));
  song = SM.patchSec(song, 's2', { intro: { k: 'climb', bars: 4 }, outro: { k: 'breath', bars: 2 } });
  const tl = SM.timeline(C, song), seq = SM.songSeq(C, song);
  assert.strictEqual(tl.length, seq.length);
  assert.deepStrictEqual(tl.secs.map((x) => [x.start, x.end]), seq.markers.map((m) => [m.start, m.end]));
  const s2 = tl.secs.find((x) => x.id === 's2');
  assert.ok(s2.inEnd > s2.start && s2.outStart < s2.end);
  assert.strictEqual(SM.songSeq(C, song, true).loop, true);
});

test('arrange: move, rename, remove a filled section and put it back', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  assert.strictEqual(SM.moveSec(song, 's1', -1), song, 'the first section cannot move earlier');
  song = SM.moveSec(song, 's2', -1);
  assert.deepStrictEqual(song.secs.map((s) => s.id), ['s2', 's1', 's3']);
  song = SM.moveSec(song, 's2', 1);
  assert.deepStrictEqual(song.secs.map((s) => s.id), ['s1', 's2', 's3']);

  song = SM.renameSec(song, 's2', '  Big   chorus ');
  assert.strictEqual(SM.findSec(song, 's2').name, 'Big chorus');
  assert.strictEqual(SM.renameSec(song, 's2', '   '), song, 'an empty name changes nothing');
  // a new substance keeps a name the user gave; an unnamed section takes the option's
  const sub = SM.actOptions(C, song, SM.findSec(song, 's2'), 'sub', 'all').find((o) => o.key === 'a:break');
  song = SM.patchSec(song, 's2', sub.make(SM.findSec(song, 's2')));
  assert.strictEqual(SM.findSec(song, 's2').name, 'Big chorus');
  song = SM.undoSec(song, 's2');
  song = SM.undoSec(song, 's2');
  assert.strictEqual(SM.findSec(song, 's2').name, 'Chorus', 'renaming is one Undo step');
  assert.ok(!SM.findSec(song, 's2').named);
  song = SM.patchSec(song, 's1', sub.make(SM.findSec(song, 's1')));
  assert.strictEqual(SM.findSec(song, 's1').name, 'Breakdown');

  const r = SM.removeSec(song, 's2');
  assert.strictEqual(r.song.secs.length, 2);
  assert.deepStrictEqual(r.removed && r.removed.at, 1);
  const back = SM.insertSec(r.song, r.removed.sec, r.removed.at);
  assert.deepStrictEqual(back.secs.map((s) => s.id), ['s1', 's2', 's3']);
  assert.deepStrictEqual(SM.findSec(back, 's2').body, SM.findSec(song, 's2').body);
  assert.strictEqual(SM.renameSong(song, ' New name ').name, 'New name');
});

test('dials set a section by hand, and pressing one again and again is one Undo', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const b0 = SM.findSec(song, 's2').body;
  for (let k = 0; k < 5; k++) song = SM.stepDial(song, 's2', 'bpm', 1);
  assert.strictEqual(SM.findSec(song, 's2').body.bpm, b0.bpm + 5);
  song = SM.stepDial(song, 's2', 'shift', -1);
  song = SM.stepDial(song, 's2', 'shift', -1);
  assert.strictEqual(SM.findSec(song, 's2').body.shift, -2);
  assert.strictEqual(SM.findSec(song, 's2').hist.length, 2, 'two dials, two Undo steps');
  song = SM.undoSec(song, 's2');
  assert.strictEqual(SM.findSec(song, 's2').body.shift, 0);
  assert.strictEqual(SM.findSec(song, 's2').body.bpm, b0.bpm + 5);
  song = SM.undoSec(song, 's2');
  assert.strictEqual(SM.findSec(song, 's2').body.bpm, b0.bpm);

  song = SM.setDial(song, 's2', 'bpm', 999);
  assert.strictEqual(SM.findSec(song, 's2').body.bpm, 240, 'tempo is clamped');
  assert.strictEqual(SM.stepDial(song, 's2', 'bpm', 1), song, 'nothing past the top');
  song = SM.setDial(song, 's2', 'energy', 0.33);
  assert.strictEqual(SM.findSec(song, 's2').body.energy, 0.3);
  song = SM.stepDial(song, 's2', 'curve', 1);
  assert.strictEqual(SM.findSec(song, 's2').body.curve, 'rise');
  song = SM.stepDial(song, 's2', 'swing', 1);
  assert.strictEqual(SM.findSec(song, 's2').body.swing, 0.15);
  for (const D of SM.DIALS) assert.ok(D.text(C, SM.findSec(song, 's2').body), D.id + ' has words');
  // the section plays, and plays slower or faster with its tempo
  sane(SM.sectionSeq(C, song, SM.findSec(song, 's2')), 'dialled');
  const closed = SM.setOpen(song, 's2', false);
  assert.strictEqual(SM.stepDial(closed, 's2', 'bpm', -1), closed, 'closed sections keep their dials');
});

test('every option by name, the one in now, and the section as it is to compare with', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const sec = () => SM.findSec(song, 's2');
  assert.strictEqual(SM.actOptions(C, song, sec(), 'build', 'all').length, SM.INTROS.length);
  assert.strictEqual(SM.actOptions(C, song, sec(), 'fin', 'all').length, SM.OUTROS.length);
  const top = SM.actOptions(C, song, sec(), 'build', 0), all = SM.actOptions(C, song, sec(), 'build', 'all');
  assert.deepStrictEqual(all.slice(0, 3).map((o) => o.key), top.map((o) => o.key), 'the full list starts with Bobby’s three');
  const none = all.find((o) => o.key === 'build:none');
  assert.ok(SM.isCurrent(C, song, sec(), none), 'no way in: Straight in is in now');
  const climb = all.find((o) => o.key === 'build:climb');
  song = SM.patchSec(song, 's2', climb.make(sec()));
  song = SM.stepPart(song, 's2', 'intro', 1);
  assert.ok(SM.isCurrent(C, song, sec(), climb), 'a longer climb is still the climb');
  assert.ok(!SM.isCurrent(C, song, sec(), none));
  const asis = SM.actOptions(C, song, sec(), 'sub', 'all').find((o) => o.key === 'a:asis');
  assert.ok(SM.isCurrent(C, song, sec(), asis), 'the chorus is the idea as written');
  assert.ok(SM.isCurrent(C, SM.repair(JSON.parse(JSON.stringify(song))), sec(), asis), 'still after saving');
  song = SM.stepDial(song, 's2', 'bpm', 1);
  assert.ok(!SM.isCurrent(C, song, sec(), asis), 'not once a dial moves');

  // compare: the same stretch, as it is
  const o = SM.actOptions(C, song, sec(), 'build', 'all').find((x) => x.key === 'build:riser');
  const a = SM.previewSeq(C, song, sec(), o), b = SM.nowSeq(C, song, sec(), o);
  sane(a, 'option');
  sane(b, 'as it is');
  const inNow = { group: 'act', act: 'build', make: () => ({ intro: sec().intro }) };
  assert.strictEqual(b.length, SM.previewSeq(C, song, sec(), inNow).length, 'as it is = the 5-bar climb that is in');
  assert.ok(b.length > a.length);
  assert.strictEqual(SM.nowSeq(C, song, SM.findSec(song, 's1'), SM.actOptions(C, song, SM.findSec(song, 's1'), 'sub', 0)[0]), null, 'an empty section has nothing to compare');
  const vibe = SM.toolOptions(C, song, sec(), 'vibe', null, 0)[0];
  sane(SM.nowSeq(C, song, sec(), vibe), 'vibe as it is');
});

test('Bar Builder takes twists back off', () => {
  let song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const sec = SM.findSec(song, 's2');
  const o = SM.twistOptions(C, song, sec, [1, 2], 0)[0];
  song = SM.patchSec(song, 's2', o.make(sec));
  assert.strictEqual(Object.keys(SM.findSec(song, 's2').body.twists).length, 2);
  song = SM.clearTwists(song, 's2', [2]);
  assert.deepStrictEqual(Object.keys(SM.findSec(song, 's2').body.twists), ['1']);
  assert.strictEqual(SM.clearTwists(song, 's2', [3]), song, 'nothing to clear');
});

test('chords that go somewhere: the section develops, the melody stays, the rest follows', () => {
  const song = SM.create(MAIN, null, 'chorus');
  const C = SM.context(song);
  const body = Object.assign({}, song.secs[1].body, { bars: 8 });
  const lead = (r) => JSON.stringify(r.filter((e) => e.L === C.lead).map((e) => [e.t, e.p]));
  const follow = C.layers.filter((l) => ['chords', 'bass', 'pad'].includes(l.role)).map((l) => l.key);
  const under = (r) => JSON.stringify(r.filter((e) => follow.includes(e.L)).map((e) => [e.t, e.p]));
  const plain = SM.renderBody(C, body);
  // no harm, or loop as written: exactly the section as before
  assert.strictEqual(JSON.stringify(SM.renderBody(C, Object.assign({}, body, { harm: { dev: 'loop', end: 'same' } }))), JSON.stringify(plain));
  const passes = SM.harmOf(C, body).names.length;
  assert.strictEqual(passes, 8 * C.BAR / T.progTicks(C.prog), 'one pass of chords per time round');
  for (const d of SM.DEVS) for (const e of SM.ENDS) {
    const b = Object.assign({}, body, { harm: { dev: d.id, end: e.id } });
    const h = SM.harmOf(C, b);
    assert.strictEqual(T.progTicks(h.prog), 8 * C.BAR, d.id + '/' + e.id + ' spans the section');
    const r = SM.renderBody(C, b);
    assert.strictEqual(lead(r), lead(plain), d.id + '/' + e.id + ': the melody never moves');
    assert.ok(r.every((x) => x.t >= 0 && x.t < 8 * C.BAR && x.p >= 0 && x.p <= 127));
    assert.ok(h.items.every((x) => T.chordQuality(x.c, C.scale) !== 'dim' || C.prog.some((c) => T.sameChord(T.chordOnly(c), x.c))), 'no new diminished chords');
    if (h.changed) assert.notStrictEqual(under(r), under(plain), d.id + '/' + e.id + ': chords, bass and pads follow the new chords');
  }
  // landing home ends on the home chord (when the melody allows it)
  const home = SM.harmOf(C, Object.assign({}, body, { harm: { dev: 'loop', end: 'home' } }));
  const fin = home.items[home.items.length - 1].c;
  assert.ok(fin.deg === 0 || T.sameChord(fin, T.chordOnly(C.prog[C.prog.length - 1])), 'ends on I');
  // the Chords tab: different chords each, none the same as now, each written out
  const sec = Object.assign({}, song.secs[1], { body });
  const opts = [0, 1, 2, 3].flatMap((b) => SM.toolOptions(C, song, sec, 'harm', null, b));
  assert.ok(opts.length >= 3);
  assert.ok(opts.every((o) => !o.sub.endsWith(SM.harmText(C, body))), 'nothing the same as now');
  // ways in and out loop the idea's chords; Lighter ends open, Up a fourth lands home
  assert.deepStrictEqual(SM.TREAT_BY.light.cfg({ C, song, mainCfg: SM.ROLES.chorus.make(C) }).harm, { dev: 'loop', end: 'open' });
  const withIntro = Object.assign({}, sec, { body: Object.assign({}, body, { harm: { dev: 'answer', end: 'home' } }), intro: { k: 'tease', bars: 2 } });
  const rs = SM.renderSection(C, withIntro, null);
  assert.ok(rs.events.every((x) => x.t >= 0 && x.t < rs.length));
});
