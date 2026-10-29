/* Oddition — music theory helpers.
 *
 * Time is in ticks: 480 per quarter note. BAR is a 4/4 bar (1920 ticks);
 * code that knows other meters uses meter() below instead.
 * Pitched notes are stored as scale degrees, so a part can be re-voiced into
 * any key, mode, or chord progression ("refit") without being regenerated.
 *
 *   deg 0 = tonic, 1 = second ... 7 = tonic an octave up, -1 = seventh below.
 *   acc   = chromatic offset in semitones (usually 0).
 *   base  = MIDI note of a C (multiple of 12) that anchors the register.
 *
 * A progression is [{ deg, beats, acc?, mode?, sev? }]. deg is the chord root
 * as a scale degree (0..6). Without acc/mode the chord is built from the
 * current scale. A chromatic chord (V/V, bVI, the Neapolitan...) adds
 *   acc   semitone offset of the root (bVI in major: deg 5, acc -1)
 *   mode  its chord scale, a name from MODES (V/V in major: 'mixolydian')
 *   sev   1 when the seventh was asked for explicitly ("V7")
 * chordAlt() turns that into a per-degree accidental table. Generators write
 * plain scale degrees and the chord's table bends them, so a melody over V/V
 * picks up the F# without knowing about it.
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

  // ---- chord scales ----

  // every mode of major, harmonic minor and melodic minor, as semitones from its root
  const PARENTS = {
    major: { steps: [0, 2, 4, 5, 7, 9, 11], names: ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'] },
    harmonicMinor: { steps: [0, 2, 3, 5, 7, 8, 11], names: ['harmonicMinor', 'locrianNat6', 'ionianAug', 'dorianSharp4', 'phrygianDominant', 'lydianSharp2', 'superlocrian'] },
    melodicMinor: { steps: [0, 2, 3, 5, 7, 9, 11], names: ['melodicMinor', 'dorianFlat2', 'lydianAug', 'lydianDominant', 'mixolydianFlat6', 'locrianNat2', 'altered'] },
  };
  const MODES = {};
  for (const fam of Object.keys(PARENTS)) {
    const P = PARENTS[fam];
    P.names.forEach((name, k) => {
      MODES[name] = { family: fam, steps: P.steps.map((_, i) => mod(P.steps[(i + k) % 7] - P.steps[k], 12)) };
    });
  }
  const MODE_ORDER = Object.keys(MODES);

  /** fold a semitone difference into -6..+5 */
  function wrapSemis(x) {
    const m = mod(x, 12);
    return m > 5 ? m - 12 : m;
  }

  const ZERO = Object.freeze([0, 0, 0, 0, 0, 0, 0]);
  const altCache = new Map();

  /** is this a plain chord built from the scale? */
  function isDiatonic(chord) {
    return !chord || (!chord.acc && !chord.mode);
  }

  /**
   * accidental for each scale degree (index deg mod 7) while `chord` sounds.
   * All zeros for a diatonic chord.
   */
  function chordAlt(chord, scale) {
    if (isDiatonic(chord)) return ZERO;
    const key = scale + '|' + chord.deg + '|' + (chord.acc || 0) + '|' + (chord.mode || '');
    let alt = altCache.get(key);
    if (alt) return alt;
    const out = ZERO.slice();
    const root = degToSemis(chord.deg, scale) + (chord.acc || 0);
    const m = MODES[chord.mode];
    for (let i = 0; i < 7; i++) {
      const k = chord.deg + i;
      const keySemis = degToSemis(k, scale);
      const want = m ? root + m.steps[i] : keySemis + (chord.acc || 0);
      out[mod(k, 7)] = wrapSemis(want - keySemis);
    }
    alt = Object.freeze(out);
    altCache.set(key, alt);
    return alt;
  }

  /** semitones of the chord's 3rd, 5th and 7th above its root, and the root above the tonic */
  function chordShape(chord, scale) {
    const c = typeof chord === 'object' ? chord : { deg: chord };
    const alt = chordAlt(c, scale);
    const at = (d) => degToSemis(d, scale) + alt[mod(d, 7)];
    const r = at(c.deg);
    return { root: r, third: at(c.deg + 2) - r, fifth: at(c.deg + 4) - r, seventh: at(c.deg + 6) - r };
  }

  function qualityOf(third, fifth) {
    if (third === 4 && fifth === 7) return 'maj';
    if (third === 3 && fifth === 7) return 'min';
    if (third === 3 && fifth === 6) return 'dim';
    if (third === 4 && fifth === 8) return 'aug';
    return 'maj';
  }

  function sameChord(a, b) {
    return !!a && !!b && a.deg === b.deg && (a.acc || 0) === (b.acc || 0) && (a.mode || '') === (b.mode || '') && !!a.sev === !!b.sev;
  }

  /** chord fields without the length */
  function chordOnly(c) {
    const out = { deg: c.deg };
    const acc = Math.round(Number(c.acc) || 0);
    if (acc) out.acc = Math.max(-2, Math.min(2, acc));
    if (c.mode && Object.prototype.hasOwnProperty.call(MODES, c.mode)) out.mode = c.mode;
    if (c.sev) out.sev = 1;
    return out;
  }

  /**
   * the same chord, read in another scale: a chromatic chord keeps its sound
   * (bIII in C major stays Eb in C minor, where it is just III); a plain chord
   * stays a plain chord of the new scale.
   */
  function rescaleChord(chord, from, to) {
    const c = chordOnly(chord);
    if (isDiatonic(c)) return c;
    const root = degToSemis(c.deg, from) + (c.acc || 0);
    const acc = wrapSemis(root - degToSemis(c.deg, to));
    const out = Object.assign({}, c);
    if (acc) out.acc = acc; else delete out.acc;
    // the chord scale is absolute, so nothing else moves. If the new scale
    // already has this chord, it becomes that plain chord.
    if (!acc) {
      const plain = { deg: c.deg, sev: c.sev };
      const a = chordShape(out, to), b = chordShape(plain, to);
      if (a.third === b.third && a.fifth === b.fifth && (!c.sev || a.seventh === b.seventh)) {
        delete out.acc; delete out.mode;
      }
    }
    return out;
  }

  /**
   * Chord on `deg` (+ root `acc`) with the given triad quality and optional
   * seventh (semitones: 9, 10, 11). Diatonic when the scale already has it;
   * otherwise picks the chord scale that changes the fewest notes of the key.
   */
  function resolveChord(scale, deg, acc, quality, seventh) {
    const d = mod(deg, 7);
    const a = acc || 0;
    if (!a) {
      const sh = chordShape({ deg: d }, scale);
      if (qualityOf(sh.third, sh.fifth) === quality && (seventh == null || sh.seventh === seventh)) return { deg: d };
    }
    let best = null, bestCost = Infinity;
    for (let pass = 0; pass < 2 && !best; pass++) {
      MODE_ORDER.forEach((name, order) => {
        const m = MODES[name];
        if (qualityOf(m.steps[2], m.steps[4]) !== quality) return;
        if (pass === 0 && seventh != null && m.steps[6] !== seventh) return;
        const c = { deg: d, acc: a, mode: name };
        const alt = chordAlt(c, scale);
        const cost = alt.filter((x) => x !== 0).length + (m.family === 'major' ? 0 : 1) + order * 0.001;
        if (cost < bestCost) { bestCost = cost; best = c; }
      });
    }
    if (!best.acc) delete best.acc;
    return best;
  }

  /** chord number `step` (0-6) in the key of the chord `target`: V/V, vii°/ii... */
  function secondaryChord(scale, step, target, quality, seventh) {
    const tq = chordQuality(target, scale);
    const parent = PARENTS[tq === 'maj' || tq === 'aug' ? 'major' : 'harmonicMinor'];
    const tRoot = degToSemis(target.deg, scale) + (target.acc || 0);
    const deg = target.deg + step;
    const acc = wrapSemis(tRoot + parent.steps[step] - degToSemis(deg, scale));
    const mode = parent.names[step];
    const m = MODES[mode];
    if (qualityOf(m.steps[2], m.steps[4]) === quality && (seventh == null || m.steps[6] === seventh)) {
      const c = { deg: mod(deg, 7), mode };
      if (acc) c.acc = acc;
      // a secondary chord the key already has stays plain
      return chordAlt(c, scale).every((x) => x === 0) ? { deg: c.deg } : c;
    }
    return resolveChord(scale, deg, acc, quality, seventh);
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

  /** triad quality; `root` is a degree or a chord object */
  function chordQuality(root, scale) {
    const sh = chordShape(root, scale);
    return qualityOf(sh.third, sh.fifth);
  }

  const MAJOR = SCALES.major.steps;
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /** how far a chord's root sits from the same numeral in the major scale (bVI: -1) */
  function majorAcc(c, scale) {
    return wrapSemis(chordShape(c, scale).root - MAJOR[mod(c.deg, 7)]);
  }

  /** chord symbol; `root` is a degree or a chord object */
  function chordName(root, tonic, scale, size) {
    const c = typeof root === 'object' ? root : { deg: root };
    const sh = chordShape(c, scale);
    const q = qualityOf(sh.third, sh.fifth);
    // chromatic roots are spelt the way their numeral reads: bII is Db, #iv is F#
    const ma = isDiatonic(c) ? 0 : majorAcc(c, scale);
    const names = ma < 0 ? FLAT_NAMES : ma > 0 ? SHARP_NAMES : NOTE_NAMES;
    let name = names[mod(tonic + sh.root, 12)];
    if ((size || 3) >= 4 || c.sev) {
      const seventh = sh.seventh;
      if (q === 'maj') name += seventh === 11 ? 'maj7' : '7';
      else if (q === 'min') name += seventh === 10 ? 'm7' : 'm(maj7)';
      else if (q === 'dim') name += seventh === 10 ? 'm7b5' : 'dim7';
      else name += '+7';
    } else {
      name += { maj: '', min: 'm', dim: 'dim', aug: '+' }[q];
    }
    return name;
  }

  /**
   * roman numeral for a chord (a degree or chord object). Chromatic chords
   * get an accidental, a 7th or a /target: whichever reads back as the same chord.
   */
  function roman(root, scale) {
    const c = typeof root === 'object' ? chordOnly(root) : { deg: root };
    const cands = romanCandidates(c, scale);
    const parsed = cands.map((tok) => parseChord(tok, scale));
    for (let i = 0; i < cands.length; i++) if (parsed[i] && sameChord(parsed[i], c)) return cands[i];
    // text cannot pick every chord scale; fall back to one with the same chord tones
    const want = chordShape(c, scale);
    for (let i = 0; i < cands.length; i++) {
      const b = parsed[i];
      if (!b || !!b.sev !== !!c.sev) continue;
      const sh = chordShape(b, scale);
      if (sh.root === want.root && sh.third === want.third && sh.fifth === want.fifth && (!c.sev || sh.seventh === want.seventh)) return cands[i];
    }
    return cands[0];
  }

  /**
   * numeral for a chord. `prefix`: null for a bare numeral, otherwise the
   * accidental is written relative to the major scale (bVI, ♮vii°).
   */
  function romanBase(c, scale, withSeventh, prefix) {
    const sh = chordShape(c, scale);
    const q = qualityOf(sh.third, sh.fifth);
    let n = NUMERALS[mod(c.deg, 7)];
    if (q === 'min' || q === 'dim') n = n.toLowerCase();
    let acc = '';
    if (prefix) {
      const a = majorAcc(c, scale);
      acc = a < 0 ? 'b'.repeat(-a) : a > 0 ? '#'.repeat(a) : '♮';
    }
    const tok = acc + n;
    if (!withSeventh) return tok + (q === 'dim' ? '°' : q === 'aug' ? '+' : '');
    if (q === 'dim') return tok + (sh.seventh === 10 ? 'ø7' : '°7');
    if (q === 'aug') return tok + '+7';
    if (q === 'maj') return tok + (sh.seventh === 11 ? 'maj7' : '7');
    return tok + (sh.seventh === 10 ? '7' : 'maj7');
  }

  function romanCandidates(c, scale) {
    const forms = (prefix) => {
      const plain = romanBase(c, scale, false, prefix);
      const seventh = romanBase(c, scale, true, prefix);
      return c.sev ? [seventh, plain] : [plain, seventh];
    };
    let list = forms(false);
    if (isDiatonic(c)) return list;
    // a chromatic major chord on a natural root usually reads best as a
    // secondary dominant: II is V/V, III7 is V7/vi, I7 is V7/IV
    const sh = chordShape(c, scale);
    const dominant = qualityOf(sh.third, sh.fifth) === 'maj' && majorAcc(c, scale) === 0 && (!c.sev || sh.seventh === 10);
    const fam = (SCALES[scale] || SCALES.major).family;
    const preferSecondary = dominant && (c.sev || (fam === 'major' ? [1, 2, 5, 6].includes(mod(c.deg, 7)) : mod(c.deg, 7) === 1));
    // with an accidental, unless the bare numeral already reads right
    for (const tok of forms(true)) if (!/^♮/.test(tok) || !list.includes(tok.slice(1))) list.push(tok);
    // secondary forms over the plain major/minor chords of the key
    const heads = c.sev ? ['V7', 'vii°7', 'viiø7'] : ['V', 'vii°'];
    // secondary chords before the Neapolitan's N: they read as more than a name
    const heads0 = list.length;
    for (let t = 1; t < 7; t++) {
      for (const target of [NUMERALS[t], NUMERALS[t].toLowerCase()]) {
        for (const h of heads) list.push(h + '/' + target);
      }
    }
    if (!c.sev && majorAcc(c, scale) === -1 && mod(c.deg, 7) === 1) list.splice(heads0, 0, 'N');
    if (preferSecondary) list = list.slice(heads0).concat(list.slice(0, heads0));
    return list;
  }

  /** cost of a chord: how many notes of the key it changes (+1 outside the major-mode family) */
  function chordCost(c, scale) {
    if (isDiatonic(c)) return 0;
    const m = MODES[c.mode];
    return chordAlt(c, scale).filter((x) => x !== 0).length + (m && m.family !== 'major' ? 1 : 0);
  }

  /**
   * chord for numeral `idx`. An accidental counts from the major scale
   * (bVI is Ab in C major and in C minor, where it is the plain VI). A bare
   * numeral is the scale's own degree, or the major scale's when that needs
   * fewer changes: vii°7 in C minor is B°7, VII is Bb.
   */
  function numeralChord(scale, idx, accStr, quality, seventh) {
    if (accStr) {
      let a = 0;
      for (const ch of accStr) a += ch === 'b' || ch === '♭' ? -1 : ch === '#' || ch === '♯' ? 1 : 0;
      return resolveChord(scale, idx, wrapSemis(MAJOR[idx] + a - degToSemis(idx, scale)), quality, seventh);
    }
    const own = resolveChord(scale, idx, 0, quality, seventh);
    const shift = wrapSemis(MAJOR[idx] - degToSemis(idx, scale));
    if (!shift) return own;
    const other = resolveChord(scale, idx, shift, quality, seventh);
    return chordCost(other, scale) < chordCost(own, scale) ? other : own;
  }

  /** parse one chord token ("bVI", "V7/V", "N", "iv"); null if it is not one */
  function parseChord(tok, scale) {
    const m = /^([b#♭♯♮]*)(N|[ivIV]+)(°|o|ø|\+|dim|aug)?(maj7|M7|7|m7b5|m7)?(?:sus\d|add\d)?(?:\/([b#♭♯♮]*)([ivIV]+))?$/.exec(tok);
    if (!m) return null;
    if (m[2] === 'N') return numeralChord(scale, 1, 'b', 'maj', null); // Neapolitan: bII
    const idx = NUMERALS.indexOf(m[2].toUpperCase());
    if (idx < 0) return null;
    const upper = m[2] === m[2].toUpperCase();
    const mark = m[3] || '';
    const sev = m[4] || '';
    let quality = upper ? 'maj' : 'min';
    if (mark === '°' || mark === 'o' || mark === 'dim' || mark === 'ø') quality = 'dim';
    if (mark === '+' || mark === 'aug') quality = 'aug';
    let seventh = null;
    if (mark === 'ø' || sev === 'm7b5') { quality = 'dim'; seventh = 10; }
    else if (sev === 'maj7' || sev === 'M7') seventh = 11;
    else if (sev) seventh = quality === 'dim' ? 9 : 10;
    let chord;
    if (m[6]) {
      const tIdx = NUMERALS.indexOf(m[6].toUpperCase());
      if (tIdx < 0) return null;
      const target = numeralChord(scale, tIdx, m[5], m[6] === m[6].toUpperCase() ? 'maj' : 'min', null);
      chord = secondaryChord(scale, idx, target, quality, seventh);
    } else {
      chord = numeralChord(scale, idx, m[1], quality, seventh);
    }
    if (seventh != null) chord.sev = 1;
    return chord;
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
      if (beats > 0) out.push(Object.assign(chordOnly(c.chord), { beats }));
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
   * Colour a plain progression with chords from outside the key. amount 0..1
   * (0 leaves it alone). In major: iv, bVI, bVII borrowed from minor. In
   * minor: the major V before i, a dorian IV, the Neapolitan before V. In
   * both: secondary dominants into the next chord, and with a lot of colour a
   * tritone sub for V7 into I.
   */
  function colorProgression(prog, rng, scale, amount) {
    if (!(amount > 0) || !prog.length) return prog;
    const fam = (SCALES[scale] || SCALES.minor).family;
    const P = (tok, beats) => Object.assign(parseChord(tok, scale), { beats });
    const changed = new WeakSet();
    const list = prog.map((c) => Object.assign({}, c));
    // one decision per chord move, so a repeated loop is coloured the same way each time
    const decided = new Map();
    const decide = (key, p) => {
      if (!decided.has(key)) decided.set(key, rng.chance(Math.min(1, p)));
      return decided.get(key);
    };
    const moveKey = (kind, c, next) => kind + ':' + c.deg + '>' + (next ? next.deg : '-');
    // sections loop, so the last chord leads back into the first
    const after = (arr, i) => (arr.length > 1 ? arr[(i + 1) % arr.length] : null);

    // 1. borrowed chords
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!isDiatonic(c) || (i === 0 && c.deg === 0)) continue;
      const next = after(list, i);
      const q = chordQuality(c, scale);
      let tok = null, p = 0;
      if (fam === 'major') {
        if (c.deg === 3 && q === 'maj') { tok = 'iv'; p = 0.35; }
        else if (c.deg === 5 && q === 'min') { tok = 'bVI'; p = 0.3; }
        else if (c.deg === 6) { tok = 'bVII'; p = 0.45; }
      } else {
        if (c.deg === 4 && q === 'min' && (!next || next.deg === 0)) { tok = 'V'; p = 0.7; }
        else if (c.deg === 3 && q === 'min') { tok = 'IV'; p = 0.2; }
        else if (c.deg === 1 && next && next.deg === 4) { tok = 'N'; p = 0.3; }
      }
      if (tok && decide(moveKey('b', c, next), p * amount)) { list[i] = P(tok, c.beats); changed.add(list[i]); }
    }

    // 2. secondary dominants into the next chord (not the tonic: V/I is just V)
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const next = after(list, i);
      out.push(c);
      if (!next || changed.has(c) || changed.has(next) || next.deg === 0) continue;
      const nq = chordQuality(next, scale);
      if (nq !== 'maj' && nq !== 'min') continue;
      const key = moveKey('s', c, next);
      if (!decide(key, 0.22 * amount)) continue;
      const target = (nq === 'maj' ? NUMERALS[next.deg] : NUMERALS[next.deg].toLowerCase());
      const sev = decide(key + ':7', 0.4 + 0.4 * amount);
      const split = decide(key + ':split', 0.6);
      const sec = parseChord((sev ? 'V7/' : 'V/') + target, scale);
      if (!sec || sameChord(sec, c)) continue;
      // the opening chord (and its repeats) is never replaced, only shortened
      const keepFirst = c.deg === list[0].deg;
      if (c.beats >= 4 && (keepFirst || split)) {
        // the second half of this chord leads into the next
        const half = c.beats / 2;
        c.beats = half;
        const s = Object.assign(sec, { beats: half });
        changed.add(s);
        out.push(s);
      } else if (!keepFirst) {
        const s = Object.assign(sec, { beats: c.beats });
        changed.add(s);
        out[out.length - 1] = s;
      }
    }

    // 3. tritone sub: V7 into I becomes bII7 (only with a lot of colour)
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      const next = after(out, i);
      if (next && c.deg === 4 && chordQuality(c, scale) === 'maj' && next.deg === 0 && !changed.has(c) &&
          decide('t', Math.max(0, amount - 0.5) * 0.9)) {
        out[i] = P('bII7', c.beats);
      }
    }
    return out;
  }

  /**
   * New chord progression for a section.
   * opts: { scale, bars, rate (chords per bar: 0.5 | 1 | 2), vamp (bool),
   *         color (0..1: chords from outside the key, see colorProgression) }
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
    let prog = [];
    for (const d of out) {
      const last = prog[prog.length - 1];
      if (last && last.deg === d && last.beats < 8) last.beats += beatsPer;
      else prog.push({ deg: d, beats: beatsPer });
    }
    // a separate stream, so the same seed gives the same plain chords at any colour
    if (opts.color > 0 && !opts.vamp) prog = colorProgression(prog, rng.fork('color'), scale, opts.color);
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
    return prog.map((c) => roman(c, scale) + (c.beats === common ? '' : ':' + c.beats)).join(' ');
  }

  /**
   * parse roman-numeral text into a progression spanning `bars` bars; null if invalid.
   * Case sets the quality (V major, v minor), so "V" in a minor key is the
   * major dominant. Also: b/# roots (bVI), 7ths (V7, ii7, IVmaj7), ° ø +,
   * secondary chords (V/V, V7/ii, vii°/vi) and N for the Neapolitan.
   * Without `scale` only the chord roots are kept (plain degrees).
   */
  function parseProg(text, bars, scale) {
    const tokens = String(text).replace(/[|,]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    const items = [];
    for (const tok of tokens) {
      const m = /^(.+?)(?::(\d+(?:\.\d+)?))?$/.exec(tok);
      const chord = m && parseChord(m[1], scale || 'major');
      if (!chord) return null;
      const c = scale ? chord : { deg: chord.deg };
      items.push(Object.assign(c, { beats: m[2] ? parseFloat(m[2]) : null }));
    }
    const total = bars * 4;
    const fixed = items.reduce((s, it) => s + (it.beats || 0), 0);
    const free = items.filter((it) => !it.beats).length;
    const each = free ? Math.max(0.5, (total - fixed) / free) : 0;
    const prog = items.map((it) => Object.assign(it, { beats: it.beats || each }));
    return fitProg(prog, bars);
  }

  /** roles whose notes are GM drum sounds (channel 10), not scale degrees */
  function isDrumRole(role) { return role === 'drums' || role === 'perc'; }

  // ---------------- meters

  /*
   * A meter is n beats of 1/d notes per bar, felt in groups (in 1/d units):
   * 7/8 as 2+2+3 puts the strong beats on eighths 1, 3 and 5. The rest of the
   * engine still works in 4/4 (BAR); these helpers are for code that has been
   * taught other meters. Everything is on the 16th-note grid ("steps").
   *
   *   meter(id) = { id, n, d, groups, unit, steps, ticks, beats, pulses,
   *                 groupStarts, harm, compound, name, feel }
   *   unit         steps in one 1/d note (4 for quarters, 2 for eighths)
   *   steps/ticks  one bar
   *   beats        one bar in quarter notes (7/8 = 3.5)
   *   pulses       [{ s, len }] the beats you tap: each quarter in x/4, each
   *                group in x/8 (6/8 is tapped in two, 7/8 as short-short-long)
   *   groupStarts  steps where a group starts: the strong beats
   *   harm         steps where chords usually change: each group start, or
   *                for three groups or more, the downbeat and the group start
   *                nearest the middle of the bar
   */
  const METERS = {
    '4/4': { n: 4, d: 4, groups: [2, 2], name: 'Four', feel: 'four steady beats to a bar' },
    '3/4': { n: 3, d: 4, groups: [3], name: 'Three', feel: 'three beats to a bar, like a waltz: ONE two three' },
    '6/8': { n: 6, d: 8, groups: [3, 3], name: 'Six-eight', feel: 'two big beats, each split in three, so it rolls: ONE-and-a TWO-and-a' },
    '5/4': { n: 5, d: 4, groups: [3, 2], name: 'Five', feel: 'five beats to a bar, felt as three then two: ONE two three FOUR five' },
    '7/8': { n: 7, d: 8, groups: [2, 2, 3], name: 'Seven-eight', feel: 'seven quick beats, felt as two, two, three: short, short, long' },
  };
  const METER_IDS = Object.keys(METERS);
  const meterCache = {};

  function meter(id) {
    const key = METERS[id] ? id : '4/4';
    if (meterCache[key]) return meterCache[key];
    const m = METERS[key];
    const unit = 16 / m.d;
    const steps = m.n * unit;
    const groupStarts = [];
    let at = 0;
    m.groups.forEach((g) => { groupStarts.push(at); at += g * unit; });
    const pulses = [];
    if (m.d === 4) for (let s = 0; s < steps; s += unit) pulses.push({ s, len: unit });
    else m.groups.forEach((g, i) => pulses.push({ s: groupStarts[i], len: g * unit }));
    let harm = groupStarts.slice();
    if (groupStarts.length > 2) {
      const mid = groupStarts.slice(1).sort((a, b) => Math.abs(a - steps / 2) - Math.abs(b - steps / 2) || a - b)[0];
      harm = [0, mid];
    }
    const out = {
      id: key, n: m.n, d: m.d, groups: m.groups.slice(), unit, steps, ticks: steps * STEP, beats: steps / 4,
      pulses, groupStarts, harm, compound: m.d === 8, name: m.name, feel: m.feel,
    };
    meterCache[key] = out;
    return out;
  }
  /** the step within its bar */
  function barStep(m, s) { return mod(s, m.steps); }
  /** how strong a step is: 1 the downbeat, 0.75 a group start, 0.5 another beat, 0.25 an eighth, 0 the rest */
  function stepWeight(m, s) {
    const x = barStep(m, s);
    if (x === 0) return 1;
    if (m.groupStarts.indexOf(x) >= 0) return 0.75;
    if (m.pulses.some((p) => p.s === x)) return 0.5;
    return x % 2 === 0 ? 0.25 : 0;
  }
  /** one bar of a meter in ticks */
  function barTicks(id) { return meter(id).ticks; }
  /** a part's length in ticks: its bars, in its meter (parts without one are 4/4) */
  function partTicks(part) { return Math.max(1, (part && part.bars) || 1) * meter(part && part.meter).ticks; }
  /** the MIDI time signature bytes: numerator, log2 denominator, clocks per click, 32nds per quarter */
  function timeSigBytes(id) {
    const m = meter(id);
    const click = m.d === 4 ? 24 : m.groups.every((g) => g === 3) ? 36 : 12;
    return [m.n, Math.round(Math.log2(m.d)), click, 8];
  }

  Odd.theory = {
    isDrumRole,
    METERS, METER_IDS, meter, barStep, stepWeight, timeSigBytes, barTicks, partTicks,
    PPQ, BEAT, BAR, STEP, NOTE_NAMES, NUMERALS, SCALES,
    mod, scaleSteps, degToSemis, tonicOffset, pitchOf, degreeOf, midiName, clampPitch,
    MODES, chordAlt, chordShape, isDiatonic, sameChord, chordOnly, rescaleChord, resolveChord, parseChord,
    chordDegs, isChordTone, chordQuality, chordName, roman, wrapDelta,
    progBeats, progTicks, chordAt, sliceProg, fitProg, generateProgression, colorProgression,
    formatProg, parseProg,
  };
})(globalThis.Odd = globalThis.Odd || {});
