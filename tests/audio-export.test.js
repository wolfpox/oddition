'use strict';
// Audio export plumbing that runs without Web Audio: stem/mix mapping in
// stemsWav, renderOfflineMany's scheduling and failure handling, concurrency
// limits, WAV encoding, and patch resolution. The audio engine itself is
// stubbed where a real OfflineAudioContext would be needed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

for (const f of [
  'core/rng', 'core/theory', 'gen/styles', 'gen/names', 'gen/drums', 'gen/perc', 'gen/bass', 'gen/chords', 'gen/pad', 'gen/lead',
  'gen/arp', 'gen/index', 'core/render', 'core/midi-file', 'core/zip', 'core/model', 'core/export',
  'audio/synth', 'audio/webmidi', 'audio/transport',
]) require(path.join(__dirname, '..', 'js', f + '.js'));
const Odd = globalThis.Odd;

const real = { renderOffline: Odd.audio.renderOffline, encodeWav: Odd.audio.encodeWav, encodeWavAsync: Odd.audio.encodeWavAsync };
function restore() { Object.assign(Odd.audio, real); }

/** read a stored (uncompressed) zip into Map(name -> text) */
function unzip(bytes) {
  const out = new Map();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extra = dv.getUint16(p + 28, true);
    const name = Buffer.from(bytes.subarray(p + 30, p + 30 + nameLen)).toString('utf8');
    const start = p + 30 + nameLen + extra;
    out.set(name, Buffer.from(bytes.subarray(start, start + size)).toString('utf8'));
    p = start + size;
  }
  return out;
}

/** stand-in engine: each "buffer" names the tracks audible in its sequence */
function stubEngine(delayFor) {
  Odd.audio.renderOffline = (seq, opts) => {
    const audible = new Set();
    for (const e of seq.events) {
      const tr = seq.tracks[e.track];
      if (tr && !tr.mute) audible.add(String(e.track));
    }
    const tag = Array.from(audible).sort().join(',');
    return new Promise((resolve) => setTimeout(() => resolve({ tag, signal: opts && opts.signal }), delayFor(seq)));
  };
  Odd.audio.encodeWavAsync = async (buf) => new TextEncoder().encode(buf.tag);
  Odd.audio.encodeWav = (buf) => new TextEncoder().encode(buf.tag);
}

function starterSession(seed) {
  const ws = Odd.model.createWorkspace({ seed, style: 'house' });
  const s = Odd.model.currentSession(ws);
  Odd.model.fillStarter(ws, s, seed);
  return s;
}

test('stemsWav puts each stem under its own lane name and the mix last, whatever order renders finish in', async () => {
  const s = starterSession(21);
  // stems with fewer events finish later, so results arrive out of order
  stubEngine((seq) => Math.max(1, 40 - Math.min(39, seq.events.length / 20)));
  const progress = [];
  try {
    const z = await Odd.exporter.stemsWav(s, (done, total, label) => progress.push([done, total, label]));
    const files = unzip(z.bytes);
    const folder = Odd.exporter.safeName(s.name);
    const withNotes = s.lanes.filter((l) => Odd.render.songEvents(s).events.some((e) => e.track === l.id));
    assert.strictEqual(z.count, withNotes.length);
    withNotes.forEach((lane, i) => {
      const name = folder + '/' + String(i + 1).padStart(2, '0') + ' ' + Odd.exporter.safeName(lane.name) + '.wav';
      assert.strictEqual(files.get(name), lane.id, name);
    });
    assert.strictEqual(files.get(folder + '/' + folder + ' (mix).wav'), withNotes.map((l) => l.id).sort().join(','));
    const total = withNotes.length + 1;
    assert.deepStrictEqual(progress[0], [0, total, null]);
    assert.deepStrictEqual(progress.slice(1).map((p) => p[0]), Array.from({ length: total }, (_, i) => i + 1));
    assert.deepStrictEqual(progress.slice(1).map((p) => p[2]).sort(), withNotes.map((l) => l.name).concat(['Full mix']).sort());
  } finally {
    restore();
  }
});

test('stemsWav keeps a stem audible even when lane ids are numbers', async () => {
  const s = starterSession(5);
  // as in a hand-edited project file that skipped migrate()
  s.lanes.forEach((lane, i) => {
    const num = i + 1;
    for (const sec of s.sections) {
      if (sec.slots[lane.id]) { sec.slots[num] = sec.slots[lane.id]; delete sec.slots[lane.id]; }
    }
    lane.id = num;
  });
  stubEngine(() => 1);
  try {
    const files = unzip((await Odd.exporter.stemsWav(s)).bytes);
    const stems = Array.from(files).filter(([n]) => /\/\d\d .*\.wav$/.test(n));
    assert.ok(stems.length >= 3);
    for (const [name, tag] of stems) assert.match(tag, /^\d+$/, name + ' rendered silent');
  } finally {
    restore();
  }
});

test('migrate turns numeric ids into strings', () => {
  const ws = Odd.model.createWorkspace({ seed: 2 });
  const raw = JSON.parse(JSON.stringify(ws));
  const s = raw.sessions[0];
  s.lanes[0].id = 7;
  s.sections[0].id = 3;
  s.arrangement = [3, s.sections[1].id];
  raw.currentId = s.id;
  const m = Odd.model.migrate(raw);
  assert.strictEqual(m.sessions[0].lanes[0].id, '7');
  assert.strictEqual(m.sessions[0].sections[0].id, '3');
  assert.deepStrictEqual(m.sessions[0].arrangement, ['3', s.sections[1].id]);
});

test('renderOfflineMany: after a failure, running renders are dropped and it rejects only once they stop', async () => {
  const log = [];
  let onEachCalls = 0;
  Odd.audio.renderOffline = (seq, opts) => new Promise((resolve, reject) => {
    if (seq.name === 'bad') setTimeout(() => { log.push('bad failed'); reject(new Error('out of memory')); }, 5);
    else setTimeout(() => { log.push('slow done, aborted=' + opts.signal.aborted); resolve({}); }, 40);
  });
  try {
    const seqs = [{ name: 'slow', events: [1, 2, 3] }, { name: 'bad', events: [1] }, { name: 'never', events: [] }];
    await assert.rejects(
      Odd.audio.renderOfflineMany(seqs, { concurrency: 2 }, () => { onEachCalls++; return 'x'; }),
      /out of memory/,
    );
    log.push('rejected');
    assert.deepStrictEqual(log, ['bad failed', 'slow done, aborted=true', 'rejected']);
    assert.strictEqual(onEachCalls, 0);
  } finally {
    restore();
  }
});

test('renderOfflineMany returns results in input order and caps how many run at once', async () => {
  let running = 0;
  let peak = 0;
  Odd.audio.renderOffline = (seq) => new Promise((resolve) => {
    running++;
    peak = Math.max(peak, running);
    setTimeout(() => { running--; resolve({ name: seq.name }); }, 5 + seq.events.length);
  });
  try {
    const seqs = ['a', 'b', 'c', 'd', 'e'].map((name, i) => ({ name, events: new Array(10 - i * 2).fill(0) }));
    const out = await Odd.audio.renderOfflineMany(seqs, { concurrency: 2 }, (buf) => buf.name.toUpperCase());
    assert.deepStrictEqual(out, ['A', 'B', 'C', 'D', 'E']);
    assert.strictEqual(peak, 2);
  } finally {
    restore();
  }
});

test('render concurrency fits a memory budget', () => {
  const minutes = (m) => ({ bpm: 120, length: m * 120 * 480 }); // 120 beats per minute
  assert.strictEqual(Odd.audio.renderConcurrency([minutes(10)], {}), 1);
  const short = Odd.audio.renderConcurrency([minutes(2)], {});
  assert.ok(short >= 1 && short <= 3);
  assert.strictEqual(Odd.audio.renderConcurrency([minutes(10)], { concurrency: 4 }), 4);
});

test('WAV encoding: sliced async output matches the one-shot encoder', async () => {
  const L = new Float32Array([0, 1, -1, 0.5, NaN, 2, -3, 0.25, -0.25]);
  const R = new Float32Array([0.1, -0.1, 0, 1, -1, 0, 0, 0, 0.75]);
  const buf = { length: L.length, sampleRate: 44100, numberOfChannels: 2, getChannelData: (c) => (c ? R : L) };
  const one = real.encodeWav(buf);
  const sliced = await real.encodeWavAsync(buf, { slice: 4 });
  assert.deepStrictEqual(Buffer.from(sliced), Buffer.from(one));
  const dv = new DataView(one.buffer);
  assert.strictEqual(Buffer.from(one.subarray(0, 4)).toString(), 'RIFF');
  assert.strictEqual(dv.getUint32(40, true), L.length * 4);
  const left = (i) => dv.getInt16(44 + 4 * i, true);
  assert.deepStrictEqual([0, 1, 2, 4, 5, 6].map(left), [0, 32767, -32768, 0, 32767, -32768]);
  assert.strictEqual(dv.getInt16(46 + 4 * 3, true), 32767);
});

test('unknown patches resolve the same way everywhere', () => {
  const r = Odd.synth.resolvePatch;
  assert.strictEqual(r({ patch: 'kit-trap', channel: 9 }), 'kit-acoustic');
  assert.strictEqual(r({ patch: 'mystery', channel: 3 }), 'keys');
  assert.strictEqual(r({ patch: 'pad-glass', channel: 9 }), 'pad-glass');
  assert.strictEqual(r(null), 'keys');
});

test('sound quality: auto, light and full', () => {
  const was = Odd.audio.qualitySetting;
  try {
    assert.strictEqual(Odd.audio.setQuality('light'), 'light');
    assert.strictEqual(Odd.audio.quality, 'light');
    assert.strictEqual(Odd.audio.setQuality('full'), 'full');
    assert.strictEqual(Odd.audio.setQuality('nonsense'), Odd.audio.quality); // falls back to auto
    assert.strictEqual(Odd.audio.qualitySetting, 'auto');
  } finally {
    Odd.audio.setQuality(was);
  }
});
