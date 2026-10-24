/* Oddition — music theory helpers.
 *
 * Time is in ticks: 480 per quarter note, 4/4 only (1 bar = 1920 ticks).
 * Pitched notes are stored as scale degrees, so a part can be re-voiced into
 * any key, mode, or chord progression ("refit") without being regenerated.
 *
 *   deg 0 = tonic, 1 = second ... 7 = tonic an octave up, -1 = seventh below.
 *   acc   = chromatic offset in semitones (usually 0).
 *   base  = MIDI note of a C (multiple of 12) that anchors the register.
 *
 * A progression is [{ deg, beats }] where deg is the chord root as a scale
 * degree (0..6) and chords are built diatonically from the current scale.
 */
(function (Odd) {
  'use strict';

  const PPQ = 480;
  const BEAT = PPQ;
  const BAR = PPQ * 4;
  const STEP = PPQ / 4; // 16th note

  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  const SCALES = {
    major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], family: 'major' },
    minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10], family: 'minor' },
    dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], family: 'minor' },
    phrygian: { label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], family: 'minor' },
    lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], family: 'major' },
    mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], family: 'major' },
    harmonicMinor: { label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11], family: 'minor' },
  };

  function mod(n, m) { return ((n % m) + m) % m; }

  function scaleSteps(scale) {
    return (SCALES[scale] || SCALES.major).steps;
  }

  /** semitones above the tonic for a (possibly negative or > 6) scale degree */
  function degToSemis(deg, scale) {
    const steps = scaleSteps(scale);
    const n = steps.length;
    const d = Math.round(deg);
    const oct = Math.floor(d / n);
    return oct * 12 + steps[d - oct * n];
  }

  /** tonic offset kept within -5..+6 of the base C so registers stay put across keys */
  function tonicOffset(tonic) {
    const t = mod(tonic, 12);
    return t > 6 ? t - 12 : t;
  }

  function clampPitch(p) { return Math.max(0, Math.min(127, p)); }

  function pitchOf(deg, acc, tonic, scale, base) {
    return clampPitch(base + tonicOffset(tonic) + degToSemis(deg, scale) + (acc || 0));
  }

  /** nearest scale degree (and accidental) for a MIDI pitch */
  function degreeOf(pitch, tonic, scale, base) {
    const rel = pitch - base - tonicOffset(tonic);
    const oct = Math.floor(rel / 12);
    const pc = rel - oct * 12;
    const steps = scaleSteps(scale);
    let best = 0, bestDist = 99;
    for (let i = 0; i < steps.length; i++) {
      const dist = Math.abs(steps[i] - pc);
      if (dist < bestDist) { best = i; bestDist = dist; }
    }
    return { deg: oct * steps.length + best, acc: pc - steps[best] };
  }

  function midiName(p) {
    return NOTE_NAMES[mod(p, 12)] + (Math.floor(p / 12) - 1);
  }

  // ---- chords ----

  /** chord tones as scale degrees: size 3 = triad, 4 = 7th, 5 = 9th */
  function chordDegs(root, size) {
    const out = [];
    for (let i = 0; i < (size || 3); i++) out.push(root + i * 2);
    return out;
  }

  /** is `deg` a chord tone of the chord on `root`? (size 3 = triad, 4 = with 7th) */
  function isChordTone(deg, root, size) {
    const rel = mod(deg - root, 7);
    if (rel === 0 || rel === 2 || rel === 4) return true;
    return (size || 3) >= 4 && rel === 6;
  }

  function chordQuality(root, scale) {
    const r = degToSemis(root, scale);
    const third = degToSemis(root + 2, scale) - r;
    const fifth = degToSemis(root + 4, scale) - r;
    if (third === 4 && fifth === 7) return 'maj';
    if (third === 3 && fifth === 7) return 'min';
    if (third === 3 && fifth === 6) return 'dim';
    if (third === 4 && fifth === 8) return 'aug';
    return 'maj';
  }

  function chordName(root, tonic, scale, size) {
    const pc = mod(tonic + degToSemis(root, scale), 12);
    const q = chordQuality(root, scale);
    let name = NOTE_NAMES[pc];
    if ((size || 3) >= 4) {
      const seventh = degToSemis(root + 6, scale) - degToSemis(root, scale);
      if (q === 'maj') name += seventh === 11 ? 'maj7' : '7';
      else if (q === 'min') name += seventh === 10 ? 'm7' : 'm(maj7)';
      else if (q === 'dim') name += seventh === 10 ? 'm7b5' : 'dim7';
      else name += '+7';
    } else {
      name += { maj: '', min: 'm', dim: 'dim', aug: '+' }[q];
    }
    return name;
  }

  function roman(root, scale) {
    const q = chordQuality(root, scale);
    let n = NUMERALS[mod(root, 7)];
    if (q === 'min' || q === 'dim') n = n.toLowerCase();
    if (q === 'dim') n += '°';
    if (q === 'aug') n += '+';
    return n;
  }

  /** shortest diatonic move between chord roots, in -3..+3 */
  function wrapDelta(d) {
    let x = mod(d, 7);
    if (x > 3) x -= 7;
    return x;
  }

  // ---- progressions ----

  function progBeats(prog) {
    let b = 0;
    for (const c of prog) b += c.beats;
    return b;
  }

  function progTicks(prog) { return progBeats(prog) * BEAT; }

  /** chord sounding at `tick` (progression loops) */
  function chordAt(prog, tick) {
    if (!prog || !prog.length) return { chord: { deg: 0, beats: 4 }, index: 0, start: 0, end: BAR };
    const total = progTicks(prog);
    const t = mod(tick, total);
    const loopStart = tick - t;
    let pos = 0;
    for (let i = 0; i < prog.length; i++) {
      const len = prog[i].beats * BEAT;
      if (t < pos + len) {
        return { chord: prog[i], index: i, start: loopStart + pos, end: loopStart + pos + len };
      }
      pos += len;
    }
    const last = prog.length - 1;
    return { chord: prog[last], index: last, start: loopStart + total - prog[last].beats * BEAT, end: loopStart + total };
  }

  /** copy of `prog` covering exactly startTick..startTick+lenTicks (looping, clipping) */
  function sliceProg(prog, startTick, lenTicks) {
    const out = [];
    let t = startTick;
    const end = startTick + lenTicks;
    let guard = 0;
    while (t < end && guard++ < 1000) {
      const c = chordAt(prog, t);
      const stop = Math.min(c.end, end);
      const beats = (stop - t) / BEAT;
      if (beats > 0) out.push({ deg: c.chord.deg, beats });
      t = stop;
    }
    return out;
  }

  /** repeat / truncate a progression to exactly `bars` bars */
  function fitProg(prog, bars) {
    return sliceProg(prog && prog.length ? prog : [{ deg: 0, beats: 4 }], 0, bars * BAR);
  }

  const POOLS = {
    major: [
      [0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 5, 4], [0, 3, 0, 4],
      [1, 4, 0, 0], [0, 2, 3, 4], [3, 4, 2, 5], [0, 3, 1, 4], [3, 0, 4, 5],
      [0, 4, 3, 3], [0, 5, 1, 4],
    ],
    minor: [
      [0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 5, 3, 4], [0, 3, 6, 2],
      [0, 5, 6, 0], [5, 6, 0, 0], [0, 2, 6, 3], [0, 3, 5, 6], [0, 6, 3, 5],
      [3, 0, 5, 6],
    ],
    dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 3, 6, 3], [0, 2, 3, 0], [0, 1, 6, 3]],
    mixolydian: [[0, 6, 3, 0], [0, 6, 0, 6], [0, 3, 6, 3], [0, 4, 6, 3]],
    phrygian: [[0, 1, 0, 1], [0, 1, 6, 0], [0, 5, 6, 1], [0, 6, 5, 1]],
    lydian: [[0, 1, 0, 1], [0, 1, 4, 0], [0, 1, 6, 5]],
    harmonicMinor: [[0, 3, 4, 0], [0, 5, 3, 4], [0, 5, 1, 4], [0, 3, 0, 4]],
  };

  const VAMPS = {
    major: [[0], [0, 3], [0, 6], [0, 4], [0, 5]],
    minor: [[0], [0, 5], [0, 3], [0, 6], [0, 2]],
  };

  /**
   * New chord progression for a section.
   * opts: { scale, bars, rate (chords per bar: 0.5 | 1 | 2), vamp (bool) }
   */
  function generateProgression(rng, opts) {
    const scale = opts.scale || 'minor';
    const bars = opts.bars || 4;
    const rate = opts.rate || 1;
    const fam = (SCALES[scale] || SCALES.minor).family;
    // borrowed family progressions must not land on dim/aug chords in this mode
    // (e.g. dorian's vi°); each mode's own pool is curated and kept as is
    const stable = (p) => p.every((d) => {
      const q = chordQuality(d, scale);
      return q === 'maj' || q === 'min';
    });
    let pool;
    if (opts.vamp) pool = VAMPS[fam].filter(stable);
    else pool = (scale === fam ? [] : POOLS[scale] || []).concat(POOLS[fam].filter(stable));
    if (!pool.length) pool = [[0]];
    const degs = rng.pick(pool).slice();

    const beatsPer = 4 / rate;
    const slots = Math.max(1, Math.round(bars * rate));
    const out = [];
    for (let i = 0; i < slots; i++) out.push(degs[i % degs.length]);

    // longer sections: vary the second half's ending so it doesn't just loop
    if (slots >= 8 && degs.length >= 4 && !opts.vamp && rng.chance(0.5)) {
      const alt = rng.pick(pool);
      out[slots - 2] = alt[2 % alt.length];
      out[slots - 1] = alt[3 % alt.length];
    }

    // merge identical neighbours into longer chords
    const prog = [];
    for (const d of out) {
      const last = prog[prog.length - 1];
      if (last && last.deg === d && last.beats < 8) last.beats += beatsPer;
      else prog.push({ deg: d, beats: beatsPer });
    }
    return fitProg(prog, bars);
  }

  /** "i VI III VII" style text; ":n" sets beats, e.g. "i:2 iv:2 VI" */
  function formatProg(prog, scale) {
    if (!prog.length) return '';
    // only chords that differ from the most common length get a ":beats" suffix;
    // parseProg shares the leftover bars evenly, so this round-trips
    const counts = new Map();
    for (const c of prog) counts.set(c.beats, (counts.get(c.beats) || 0) + 1);
    let common = prog[0].beats;
    for (const [b, n] of counts) if (n > counts.get(common)) common = b;
    return prog.map((c) => roman(c.deg, scale) + (c.beats === common ? '' : ':' + c.beats)).join(' ');
  }

  /** parse roman-numeral text into a progression spanning `bars` bars; null if invalid */
  function parseProg(text, bars) {
    const tokens = String(text).replace(/[|,]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    const items = [];
    for (const tok of tokens) {
      const m = /^(b|#)?([ivIV]+)[°o+]?(?:maj7|m7|7|dim|sus\d)?(?::(\d+(?:\.\d+)?))?$/.exec(tok);
      if (!m) return null;
      const idx = NUMERALS.indexOf(m[2].toUpperCase());
      if (idx < 0) return null;
      items.push({ deg: idx, beats: m[3] ? parseFloat(m[3]) : null });
    }
    const total = bars * 4;
    const fixed = items.reduce((s, it) => s + (it.beats || 0), 0);
    const free = items.filter((it) => !it.beats).length;
    const each = free ? Math.max(0.5, (total - fixed) / free) : 0;
    const prog = items.map((it) => ({ deg: it.deg, beats: it.beats || each }));
    return fitProg(prog, bars);
  }

  Odd.theory = {
    PPQ, BEAT, BAR, STEP, NOTE_NAMES, NUMERALS, SCALES,
    mod, scaleSteps, degToSemis, tonicOffset, pitchOf, degreeOf, midiName, clampPitch,
    chordDegs, isChordTone, chordQuality, chordName, roman, wrapDelta,
    progBeats, progTicks, chordAt, sliceProg, fitProg, generateProgression,
    formatProg, parseProg,
  };
})(globalThis.Odd = globalThis.Odd || {});
