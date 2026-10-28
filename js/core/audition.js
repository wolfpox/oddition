/* Oddition — Bones to Gold: audition an idea from the bottom up.
 *
 * An idea grows one layer at a time, and each layer is made only from the
 * layers below it. Nothing picks a style or genre first and reveals it:
 *
 *   seed1  rhythm and scale   a rhythm made from density and push, walked up
 *                             and down a scale so its mood is heard
 *   seed2  shape              where the melody goes and the note it lands on
 *   then, in any order, each made against the melody (it always leads):
 *          chords, bass, perc (claps and taps), beat (grows the perc),
 *          pads (support), sound (instrument, tempo and swing: the genre)
 *
 * The only fixed assumptions: 4/4, 2 bars on a 16th grid, 100 BPM until a
 * sound is picked, key of C.
 *
 * Every round offers three options spread along that layer's most telling
 * difference (sparse..busy, answer..question, dark..bright, ...). Requests
 * steer the spread ("Busier", "Darker", "Surprise me").
 *
 *   idea  = { melody, layers: { [dir]: option }, order: [dir] }
 *   melody = { r: rhythm, scale, shape }   shape null until round 2
 *   rhythm = { id, hits: [[step, length, weight]], n, off }
 *   round = { dir, batch, steer: { p, s, x } }
 *
 * flow.* are pure state steps for the screen (Odd.bones); seq() turns an idea
 * into a transport sequence; toParts() into parts for the idea shelf.
 */
(function (Odd) {
  'use strict';

  const STEPS = 32;
  const STEP_TICKS = 120; // a 16th at PPQ 480
  const LENGTH = STEPS * STEP_TICKS;
  const ABC = 'ABC';
  const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const IV = ['root', '♭2nd', '2nd', '♭3rd', '3rd', '4th', '♯4th', '5th', '♭6th', '6th', '♭7th', '7th'];

  const mod = (a, n) => ((a % n) + n) % n;
  const maxOf = (a) => Math.max.apply(null, a);
  const minOf = (a) => Math.min.apply(null, a);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // a small memo: options are rebuilt often while the screen repaints
  const CACHE = new Map();
  function cached(key, fn) {
    if (CACHE.has(key)) return CACHE.get(key);
    const v = fn();
    CACHE.set(key, v);
    if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
    return v;
  }

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function weighted(R, W) {
    let tot = 0;
    for (const k in W) tot += Math.max(0, W[k]);
    let x = R() * tot;
    for (const k in W) { x -= Math.max(0, W[k]); if (x <= 0) return k; }
    return Object.keys(W)[0];
  }

  // ---------------------------------------------------------------- layers and words

  const WHY = { label: 'Why does that work?', why: true };
  const DIRS = {
    seed1: { label: 'Rhythm and scale', color: '#f1cd58', low: 'sparse', high: 'busy' },
    seed2: { label: 'Shape', color: '#f1cd58', low: 'falls like an answer', high: 'rises like a question' },
    chords: { label: 'Chords', color: '#4ec8b2', sub: 'Worked out from your melody', low: 'darker', high: 'brighter' },
    bass: { label: 'Bass', color: '#a395ff', sub: 'Locks onto it, or fills its gaps', low: 'fills the gaps', high: 'locks onto the melody' },
    perc: { label: 'Percussion', color: '#a9d15a', sub: 'Claps and taps, nothing heavy yet', low: 'sparse', high: 'driving' },
    beat: { label: 'Grow the beat', color: '#f27b62', sub: 'Turn the claps into a full beat', low: 'right on the grid', high: 'leaning against it' },
    pads: { label: 'Pads and support', color: '#6fb0ff', sub: 'Pads, strings, a second voice', low: 'thin', high: 'full' },
    sound: { label: 'Sound and feel', color: '#ef84c7', sub: 'Its instrument, tempo and swing', low: 'calm', high: 'with energy' },
  };
  const NEXT_ORDER = ['chords', 'bass', 'perc', 'beat', 'pads', 'sound'];
  const LAYER_ORDER = ['chords', 'bass', 'pads', 'perc', 'beat'];
  const REQS = {
    seed1: [{ label: 'Busier', p: 1, reply: 'Busier. Okay, let’s hear it.' }, { label: 'Sparser', p: -1, reply: 'More space. Here.' }, { label: 'Darker scale', s: -1, reply: 'Darker scales. Give me a second.' }, { label: 'Brighter scale', s: 1, reply: 'Brighter. Here we go.' }, WHY],
    seed2: [{ label: 'Subtler', s: -1, reply: 'Smaller moves. Listen to how the rhythm comes forward.' }, { label: 'Bigger', s: 1, reply: 'Bigger shapes. These travel.' }, { label: 'More jumps', x: 'jumpy', reply: 'Jumpier. Here.' }, { label: 'Land on home', x: 'home', reply: 'All three land on home now. Hear how finished that sounds?' }, WHY],
    chords: [{ label: 'Darker', p: -1, reply: 'Darker. Same melody, more shadow.' }, { label: 'Brighter', p: 1, reply: 'Brighter. Here.' }, { label: 'Surprise me', x: 'colour', reply: 'Okay, a chord or two from outside the scale. Still fits.' }, WHY],
    bass: [{ label: 'Busier', s: 1, reply: 'Busier bass. Here.' }, { label: 'Simpler', s: -1, reply: 'Simpler. Less is more, sometimes.' }, { label: 'Lock tighter', p: 1, reply: 'Tighter to the melody. Listen.' }, WHY],
    perc: [{ label: 'More drive', p: 1, reply: 'More drive. Here.' }, { label: 'Calmer', p: -1, reply: 'Calmer. Just a touch.' }, { label: 'Follow the melody', x: 'follow', reply: 'These ones follow the melody’s rhythm.' }, WHY],
    beat: [{ label: 'Straighter', p: -1, reply: 'Straighter. Right on the grid.' }, { label: 'Looser', p: 1, reply: 'Looser. Let it lean.' }, { label: 'Harder', s: 1, reply: 'Harder. Here.' }, WHY],
    pads: [{ label: 'Fuller', p: 1, reply: 'Fuller. Here.' }, { label: 'Thinner', p: -1, reply: 'Thinner. Just a shadow.' }, { label: 'Higher', s: 1, reply: 'Higher up. Listen.' }, WHY],
    sound: [{ label: 'More energy', p: 1, reply: 'More energy. Here.' }, { label: 'Calmer', p: -1, reply: 'Calmer. Here.' }, { label: 'Surprise me', x: 'any', reply: 'Anything goes. Let’s see what fits.' }, WHY],
  };

  // Bobby's lines. Lists are picked from by a counter so he doesn't repeat himself.
  const LINES = {
    start: 'Hey, I’m Bobby. Let’s find an idea. We start with bones: a rhythm and a scale. No genre yet.',
    pause: ['Just a moment.', 'Okay, let’s hear that one.', 'Hang on. Fresh ears.', 'Right. This one.', 'Let that settle. Okay.', 'Clear your ears. Now this.', 'Breathe. Next one.', 'Give it a second.'],
    entry: {
      seed1: ['Three starting points. Each is a rhythm and a scale, walking up and down so you hear its mood. One sparse, one busy, one in between.'],
      seed2: ['Same rhythm, same scale. Now it gets a shape: where it goes and where it lands. One falls like an answer, one rises like a question, one stays near home. And one barely moves, one travels.'],
      chords: ['Chords worked out from your melody. One darker, one brighter, one in between.', 'Three sets of chords, all made to fit your melody. Dark, bright, and one in the middle.'],
      bass: ['Three basses under your melody. One fills its gaps, one locks right onto it, one in between.', 'Bass time. One answers in the gaps, one hits with the melody, one sits between.'],
      perc: ['Claps and taps, nothing heavy. One sparse, one driving, one in between.', 'Some hands on the table. One barely there, one driving, one in between.'],
      beat: ['Let’s grow those claps into a beat. One right on the grid, one leaning against it, one in between.'],
      pads: ['Something to fill the space around the melody. One thin, one full, one in between.', 'Support for the melody. One just a shadow, one wide and full, one in between.'],
      sound: ['Same idea, three ways to dress it. One calm, one with energy, one in between.', 'Now the clothes: instrument, tempo, swing. Calm, energetic, and one between.'],
    },
    more: ['Three more. The others dropped down below; nothing gets thrown away.', 'Fresh three. The last ones are down in the history if you miss them.', 'Here’s three more. Nothing’s lost: scroll down for the others.'],
    next: ['The melody leads; everything we add backs it up. Where to?', 'Where next? Nothing’s wrong from here, only different.', 'Your melody is the boss. What should back it up?'],
    melody: ['That’s your melody. Here it is on its own. From now on, it leads.'],
    added: ['Here it is with the {x} in.', 'There it is, with the {x}. Hear how the melody sits now.', 'With the {x}. Still the melody up front.'],
    skipped: ['Fine by me. Where else?', 'Not every idea needs that. Pick another way.'],
    gold: ['That’s gold. A while ago it was a rhythm and a scale. Play the climb to hear how it got here.', 'Gold. Bones, a shape, then everything around it. Play the climb.'],
    climbFirst: 'Bones: the rhythm and the scale.',
    climbMelody: 'The melody, with its shape.',
    back: 'Back to that {x} round, as it was. Everything you did after it is still down in the history.',
    walk: 'The plain walk it is. Sometimes the bones are the best part.',
    picked: 'Your pick from that round. What came after grew out of this one.',
    passed: 'One you passed on. Still here: nothing gets thrown away.',
    saved: 'Saved to Ideas. You can find it on the shelf in the Studio.',
  };
  function line(list, n) { return Array.isArray(list) ? list[mod(n || 0, list.length)] : list; }

  // ---------------------------------------------------------------- rhythm

  const CELLS = { q: [[0, 4]], e: [[0, 2], [2, 2]], off: [[2, 2]], s: [[0, 1], [1, 1], [2, 1], [3, 1]], dot: [[0, 3], [3, 1]], sync: [[0, 1], [1, 2], [3, 1]], es: [[0, 2], [2, 1], [3, 1]], ant: [[3, 1]], rest: [], hold: [] };

  /** a 2-bar rhythm from density d and push y (0..1), one beat-cell at a time */
  function makeRhythm(seed, d, y) {
    const R = rng(seed);
    const W = { rest: 1.1 * (1 - d), hold: 1.4 * (1 - d), q: 1, e: 0.4 + 1.2 * d, off: 0.9 * y, s: 1.6 * d * d, dot: 0.5 + 0.3 * y, sync: 1.4 * y * d, es: 0.7 * d, ant: 0.6 * y };
    const first = { q: 1, e: 0.4 + d, dot: 0.6, s: d * d, es: 0.6 * d, sync: y * d };
    const bar1 = [weighted(R, first)];
    for (let b = 1; b < 4; b++) bar1.push(weighted(R, W));
    // bar 2 echoes the start of bar 1 more often than not
    const bar2 = bar1.map((c, i) => (i < 2 && R() < 0.6 ? c : i === 0 ? weighted(R, first) : weighted(R, W)));
    const hits = [];
    bar1.concat(bar2).forEach((c, b) => {
      if (c === 'hold') { const p = hits[hits.length - 1]; if (p && p[0] + p[1] === b * 4) p[1] += 4; return; }
      CELLS[c].forEach((x) => hits.push([b * 4 + x[0], x[1]]));
    });
    if (hits.length < 3) return null;
    const last = hits[hits.length - 1];
    last[1] = Math.min(STEPS - last[0], Math.max(last[1], 4));
    hits.forEach((h) => { h[2] = h[0] % 8 === 0 ? 2 : h[0] % 4 === 0 ? 1 : h[1] >= 3 ? 2 : 0; });
    hits[0][2] = 2;
    return hits;
  }
  function rhythmPool() {
    return cached('rpool', () => {
      const seen = {}, out = [];
      const DS = [0.05, 0.3, 0.55, 0.8, 1], YS = [0, 0.35, 0.7, 1];
      for (let i = 0; i < 80; i++) {
        const hits = makeRhythm(1009 + i * 7919, DS[i % 5], YS[Math.floor(i / 5) % 4]);
        if (!hits) continue;
        const key = JSON.stringify(hits);
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({ id: 'r' + i, hits, n: hits.length, off: hits.filter((h) => h[0] % 4 !== 0).length });
      }
      return out;
    });
  }
  function rhythmTag(r) {
    const w = r.n <= 6 ? 'Spare' : r.n <= 10 ? 'Relaxed' : r.n <= 16 ? 'Moving' : r.n <= 21 ? 'Busy' : 'Packed';
    return r.off / r.n > 0.35 ? w + ', pushing' : w;
  }

  // ---------------------------------------------------------------- scales

  const SCALES = {
    phrygian: [0, 1, 3, 5, 7, 8, 10], minor: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
    penta: [0, 2, 4, 7, 9], mixolydian: [0, 2, 4, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11],
  };
  const SCALE_ORDER = ['phrygian', 'minor', 'harmonic', 'dorian', 'penta', 'mixolydian', 'major', 'lydian']; // dark to bright
  // the studio's name for each scale (pentatonic lives inside major)
  const STUDIO_SCALE = { phrygian: 'phrygian', minor: 'minor', harmonic: 'harmonicMinor', dorian: 'dorian', penta: 'major', mixolydian: 'mixolydian', major: 'major', lydian: 'lydian' };
  const MODE = {
    phrygian: { name: 'Phrygian', mood: 'tense', why: 'Phrygian has the note just above home only a half step away. That closeness sounds tense.' },
    minor: { name: 'Minor', mood: 'dark', why: 'Minor lowers the 3rd note of the scale, and that one note does most of the darkening.' },
    harmonic: { name: 'Harmonic minor', mood: 'dramatic', why: 'Harmonic minor raises minor’s 7th, leaving a wide gap that sounds dramatic, almost exotic.' },
    dorian: { name: 'Dorian', mood: 'cool', why: 'Dorian is minor with one brighter note, the 6th. That’s why it sounds cool rather than sad.' },
    penta: { name: 'Pentatonic', mood: 'open', why: 'Pentatonic keeps five notes and drops the two that rub, so any order of them sounds fine.' },
    mixolydian: { name: 'Mixolydian', mood: 'loose', why: 'Mixolydian is major with a lowered 7th, which takes away the pull home. It feels laid back.' },
    major: { name: 'Major', mood: 'bright', why: 'Major puts a major 3rd above home, and that interval is most of what we hear as bright.' },
    lydian: { name: 'Lydian', mood: 'floating', why: 'Lydian raises the 4th. That note wants to go up, so the tune seems to float.' },
  };
  function degMidi(scale, deg) { const s = SCALES[scale]; return 60 + 12 * Math.floor(deg / s.length) + s[mod(deg, s.length)]; }
  function parentScale(scale) { return SCALES[scale].length === 7 ? SCALES[scale] : SCALES.major; }
  function landFeel(iv) { return iv === 0 ? 'finished, like home' : iv === 3 || iv === 4 ? 'settled' : iv === 7 ? 'open, like there’s more to say' : 'like it wants to keep going'; }

  // ---------------------------------------------------------------- shape

  const SHAPES = ['walkup', 'walkdown', 'turn', 'twice', 'arch', 'climb', 'hover', 'fall', 'wave', 'leap', 'valley', 'echo', 'early', 'lean', 'sigh', 'chant', 'stepup', 'stepdown'];
  const SHAPE_TAG = {
    walk: 'Plain walk', walkup: 'Walk, then home', walkdown: 'Walk down', turn: 'Turns', twice: 'Says it twice', arch: 'Arch', climb: 'Climb', hover: 'Hover', fall: 'Fall', wave: 'Wave', leap: 'Leaps', valley: 'Dip', echo: 'Echo', early: 'Early peak',
    lean: 'Leans', sigh: 'Sighs', chant: 'Chant', stepup: 'Steps up', stepdown: 'Steps down',
  };
  // shapes that are sweeps at full size; when scaled down they are called gentle
  const SWEEPS = ['walkup', 'walkdown', 'arch', 'climb', 'fall', 'wave', 'valley', 'echo', 'early'];
  const AMPS = [0.4, 0.6, 1, 1.5];
  const WALK = [0, 1, 2, 3, 4, 3, 2, 1];

  /** heights in scale steps for n notes; hits (optional) let the small shapes move on the strong notes */
  function shapeOf(kind, n, hits) {
    const out = [];
    const L = Math.max(1, n - 1);
    const half = Math.ceil(n / 2);
    const ws = hits && hits.length === n ? hits.map((x) => x[2]) : null;
    const weak = ws ? ws.filter((w) => w === 0).length : 0;
    let wk = 0;
    for (let i = 0; i < n; i++) {
      const p = i / L;
      const last = i === n - 1;
      let h = 0;
      // walk-based shapes keep round 1's stepwise feel and change only where it goes
      if (kind === 'walk') h = last ? 0 : WALK[i % 8];
      else if (kind === 'walkup') h = last ? 0 : Math.min(i, 4) - (i > 4 ? i - 4 : 0) * 0.5;
      else if (kind === 'walkdown') h = last ? 0 : [4, 3, 2, 1, 0, 1, 2, 3][i % 8];
      else if (kind === 'turn') h = last ? 0 : [0, 1, 0, -1, 0, 1, 2, 1][i % 8];
      else if (kind === 'twice') h = last ? 0 : [0, 1, 2, 1, 2, 3][(i < half ? i : i - half) % 6];
      else if (kind === 'arch') h = 4 * Math.sin(Math.PI * Math.min(1, p * 1.05));
      else if (kind === 'climb') h = 7 * p - (i % 2 && p > 0.2 && p < 0.9 ? 1 : 0);
      else if (kind === 'hover') h = last ? 2 : [0, 1, 0, -1][i % 4];
      else if (kind === 'fall') h = 6 - 7 * p;
      else if (kind === 'wave') h = 2.4 * Math.sin(p * Math.PI * 2.5 + 0.3);
      else if (kind === 'leap') h = last ? 0 : (i % 2 ? 4 : 0) + 2 * p;
      else if (kind === 'valley') h = -4 * Math.sin(Math.PI * p);
      else if (kind === 'echo') { const j = i < half ? i : i - half; h = 3 * Math.sin(Math.PI * 0.8 * (j / Math.max(1, half - 1))) + (i < half ? 0 : 1); }
      else if (kind === 'early') h = 5 * Math.exp(-((p - 0.15) * (p - 0.15)) / 0.03);
      // small shapes: repeated notes and one-step moves, so the rhythm carries the tune
      else if (kind === 'lean') h = last ? 0 : ws && weak >= 2 ? (ws[i] ? 0 : wk++ % 2 ? -1 : 1) : [0, 0, 1, 0, 0, 0, -1, 0][i % 8];
      else if (kind === 'sigh') h = last ? 0 : (i < half ? 1 : 0) + (ws ? (ws[i] ? 1 : 0) : i % 2 ? 0 : 1);
      else if (kind === 'chant') h = last ? 2 : i < half ? 0 : 1;
      else if (kind === 'stepup') h = [0, 1, 0][i % 3] + Math.floor(p * 2.99);
      else if (kind === 'stepdown') h = [1, 0, 0][i % 3] + 2 - Math.floor(p * 2.99);
      out.push(h);
    }
    return out;
  }
  function shapeSteps(kind, n, amp, hits) { return shapeOf(kind, n, hits).map((h) => Math.round(h * amp)); }

  /** the melody's notes: { s, d, w, deg, m }. walk = round 1 (rhythm and scale only) */
  function melodyNotes(mel, walk) {
    const hs = mel.r.hits, n = hs.length;
    let steps, start = 0;
    if (walk || !mel.shape) steps = hs.map((_, i) => (i === n - 1 ? 0 : WALK[i % 8]));
    else { steps = shapeSteps(mel.shape.kind, n, mel.shape.amp, hs); start = mel.shape.start; }
    return hs.map((h, i) => ({ s: h[0], d: h[1], w: h[2], deg: start + steps[i], m: degMidi(mel.scale, start + steps[i]) }));
  }

  // ---------------------------------------------------------------- chords, worked out from the melody

  /** how much each pitch class sounds in each half-bar slot: long, strong and accented notes count most */
  function slotWeights(notes) {
    const W = [0, 1, 2, 3].map(() => new Array(12).fill(0));
    notes.forEach((e) => {
      for (let sl = 0; sl < 4; sl++) {
        const a = Math.max(e.s, sl * 8), b = Math.min(e.s + e.d, (sl + 1) * 8);
        if (b <= a) continue;
        let w = (b - a) * (e.s === sl * 8 ? 1.5 : e.s % 4 === 0 ? 1.2 : 1) * (e.w === 2 ? 1.3 : 1);
        if (e.s < sl * 8) w *= 0.6; // carried over from the slot before
        W[sl][mod(e.m, 12)] += w;
      }
    });
    return W;
  }
  function chordName(c) { return NAMES[c.root] + (c.q === 'm' ? 'm' : c.q); }
  /** triads of the scale, plus "colour" chords borrowed from outside it */
  function chordCands(scale) {
    const sc = parentScale(scale), out = [];
    for (let d = 0; d < 7; d++) {
      const pcs = [0, 2, 4].map((o) => sc[(d + o) % 7]);
      const t = mod(pcs[1] - pcs[0], 12), f = mod(pcs[2] - pcs[0], 12);
      out.push({ root: sc[d], q: t === 4 ? (f === 8 ? '+' : '') : f === 6 ? '°' : 'm', pcs, colour: false });
    }
    const extra = sc[2] === 4 ? [[10, ''], [5, 'm'], [8, ''], [2, '']] : [[7, ''], [5, ''], [1, '']];
    extra.forEach((x) => {
      const r = x[0], q = x[1];
      if (out.some((c) => c.root === r && c.q === q)) return;
      out.push({ root: r, q, pcs: [r, mod(r + (q === 'm' ? 3 : 4), 12), mod(r + 7, 12)], colour: true });
    });
    return out;
  }
  /** chord paths (one chord per half bar), best fit first, each differing from the others in 2+ slots */
  function chordPool(mel, colour) {
    return cached('cp' + JSON.stringify(mel) + colour, () => {
      const W = slotWeights(melodyNotes(mel));
      const C = chordCands(mel.scale);
      const S = W.map((ws) => C.map((c) => {
        let s = 0;
        ws.forEach((w, pc) => { if (w) s += c.pcs.includes(pc) ? w : -0.45 * w; });
        if (c.q === '°' || c.q === '+') s -= 1.2;
        if (c.colour) s += colour ? 0.4 : -0.9;
        return s;
      }));
      const N = C.length, all = [];
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) for (let d = 0; d < N; d++) {
        const p = [a, b, c, d];
        if (colour && !p.some((i) => C[i].colour)) continue;
        let s = S[0][a] + S[1][b] + S[2][c] + S[3][d] + (C[a].root === 0 && !C[a].colour ? 1.5 : 0);
        for (let i = 1; i < 4; i++) if (p[i] !== p[i - 1]) s -= 0.35;
        all.push({ p, s });
      }
      all.sort((x, y) => y.s - x.s);
      const diff = (x, y) => x.filter((v, i) => v !== y[i]).length;
      const picked = [];
      for (const c of all) { if (picked.length >= 24) break; if (picked.every((q) => diff(q.p, c.p) >= 2)) picked.push(c); }
      return picked.map((x) => {
        const chords = x.p.map((i) => C[i]);
        let on = 0, tot = 0;
        W.forEach((ws, sl) => ws.forEach((w, pc) => { tot += w; if (chords[sl].pcs.includes(pc)) on += w; }));
        return {
          chords, fit: tot ? Math.round(100 * on / tot) : 100,
          bright: chords.reduce((a, c) => a + (c.q === '' ? 1 : c.q === 'm' ? -1 : -0.5), 0),
          changes: x.p.filter((v, i) => i > 0 && v !== x.p[i - 1]).length, colour: chords.some((c) => c.colour),
        };
      });
    });
  }
  /** the chords other layers play against: the picked ones, or the melody's best fit */
  function chordsFor(idea) { return idea.layers.chords ? idea.layers.chords.chords : chordPool(idea.melody, false)[0].chords; }

  // ---------------------------------------------------------------- the other layers, each made against the melody

  function coverage(notes) {
    const covered = new Array(STEPS).fill(false);
    notes.forEach((n) => { for (let t = n.s; t < Math.min(STEPS, n.s + n.d); t++) covered[t] = true; });
    return covered;
  }
  function onsetsOf(notes) { const o = {}; notes.forEach((n) => { o[n.s] = 1; }); return o; }

  function bassStyles(idea) {
    const notes = melodyNotes(idea.melody), chords = chordsFor(idea);
    const covered = coverage(notes);
    const ch = (s) => chords[Math.floor(mod(s, STEPS) / 8)];
    const root = (s) => 36 + ch(s).root;
    const tone = (s, k) => 36 + ch(s).root + mod(ch(s).pcs[k] - ch(s).root, 12);
    const gapsAt = [];
    for (let t = 0; t < STEPS; t++) if (!covered[t] && (t === 0 || covered[t - 1])) { let e = t; while (e < STEPS && !covered[e]) e++; gapsAt.push([t, e - t]); }
    const evens = Array.from({ length: 16 }, (_, i) => i * 2);
    const S = [
      { id: 'lock', tag: 'Locks on', notes: notes.filter((n) => n.w >= 1).map((n) => ({ s: n.s, d: Math.min(n.d, 4), m: root(n.s) })) },
      { id: 'double', tag: 'Every note with it', notes: notes.map((n) => ({ s: n.s, d: Math.min(n.d, 3), m: root(n.s) })) },
      { id: 'steady', tag: 'Steady roots', notes: [0, 8, 16, 24].map((s) => ({ s, d: 7, m: root(s) })) },
      { id: 'pedal', tag: 'Long pedal', notes: [0, 16].map((s) => ({ s, d: 15, m: root(s) })) },
      { id: 'bounce', tag: 'Bouncing octaves', notes: evens.map((s) => ({ s, d: 2, m: root(s) + (s % 4 === 2 ? 12 : 0) })) },
      { id: 'walk', tag: 'Walking', notes: [0, 4, 8, 12, 16, 20, 24, 28].map((s, i) => ({ s, d: 4, m: i % 4 === 3 ? root(s + 4) - 1 : tone(s, i % 4) })) },
      { id: 'gaps', tag: 'Fills the gaps', notes: gapsAt.filter((g) => g[1] >= 2).map((g, i) => ({ s: g[0], d: Math.min(g[1], 4), m: i % 2 ? tone(g[0], 2) : root(g[0]) })) },
      { id: 'answer', tag: 'Answers back', notes: [].concat.apply([], gapsAt.filter((g) => g[1] >= 3).map((g) => { const out = []; for (let t = g[0]; t < g[0] + g[1]; t += 2) out.push({ s: t, d: 2, m: (t - g[0]) % 4 ? tone(t, 1) : root(t) }); return out; })) },
    ];
    const onsets = onsetsOf(notes);
    return S.filter((x) => x.notes.length).map((x) => Object.assign(x, { lock: x.notes.filter((n) => onsets[n.s]).length / x.notes.length, n: x.notes.length }));
  }

  function padStyles(idea) {
    const notes = melodyNotes(idea.melody), chords = chordsFor(idea), sc = idea.melody.scale;
    const voiced = (c, base) => c.pcs.map((pc) => base + mod(pc - base, 12));
    const S = [
      { id: 'drone', tag: 'One quiet drone', voice: 'pad', notes: [{ s: 0, d: STEPS, ms: [60 + chords[0].root] }] },
      { id: 'shadow', tag: 'Shadow voice', voice: 'voice', notes: notes.map((n) => ({ s: n.s, d: n.d, ms: [degMidi(sc, n.deg - 2)] })) },
      { id: 'above', tag: 'Harmony above', voice: 'voice', notes: notes.map((n) => ({ s: n.s, d: n.d, ms: [degMidi(sc, n.deg + 2)] })) },
      { id: 'dyad', tag: 'Two-note pad', voice: 'pad', notes: chords.map((c, i) => ({ s: i * 8, d: 8, ms: [c.pcs[1], c.pcs[2]].map((pc) => 60 + mod(pc, 12)) })) },
      { id: 'held', tag: 'Held chords', voice: 'pad', notes: chords.map((c, i) => ({ s: i * 8, d: 8, ms: voiced(c, 55) })) },
      { id: 'wide', tag: 'Wide strings', voice: 'strings', notes: chords.map((c, i) => ({ s: i * 8, d: 8, ms: [48 + c.root].concat(voiced(c, 55), [67 + mod(c.pcs[2] - 7, 12)]) })) },
      { id: 'high', tag: 'High shimmer', voice: 'glass', notes: chords.map((c, i) => ({ s: i * 8, d: 8, ms: voiced(c, 72) })) },
    ];
    return S.map((x) => {
      const tot = x.notes.reduce((a, n) => a + n.d, 0) || 1;
      const voices = x.notes.reduce((a, n) => a + n.ms.length * n.d, 0) / tot;
      const reg = x.notes.reduce((a, n) => a + n.ms.reduce((b, m) => b + m, 0) / n.ms.length, 0) / x.notes.length;
      return Object.assign(x, { voices: Math.round(voices * 10) / 10, reg });
    });
  }

  function percStyles(idea) {
    const notes = melodyNotes(idea.melody);
    const at = (arr, k, v) => arr.map((s) => ({ s, k, v: v || 1 }));
    const evens = Array.from({ length: 16 }, (_, i) => i * 2);
    const backs = [4, 12, 20, 28];
    const S = [
      { id: 'accents', tag: 'Claps on its accents', hits: notes.filter((n) => n.w === 2).map((n) => ({ s: n.s, k: 'clap', v: 1 })) },
      { id: 'back', tag: 'Backbeat claps', hits: at(backs, 'clap') },
      { id: 'taps', tag: 'Taps with the melody', hits: notes.map((n) => ({ s: n.s, k: 'tap', v: [0.5, 0.75, 1][n.w] })) },
      { id: 'onetwo', tag: 'Tap, clap', hits: at([0, 8, 16, 24], 'tap').concat(at(backs, 'clap')) },
      { id: 'shake8', tag: 'Shaker and claps', hits: evens.map((s) => ({ s, k: 'shaker', v: s % 4 ? 0.6 : 1 })).concat(at(backs, 'clap')) },
      { id: 'shake16', tag: 'Busy shaker', hits: Array.from({ length: STEPS }, (_, s) => ({ s, k: 'shaker', v: s % 2 ? 0.5 : 0.9 })).concat(notes.filter((n) => n.w === 2).map((n) => ({ s: n.s, k: 'clap', v: 1 }))) },
      { id: 'tamb', tag: 'Off-beat tambourine', hits: at([2, 6, 10, 14, 18, 22, 26, 30], 'tamb').concat(at([12, 28], 'clap')) },
    ];
    const onsets = onsetsOf(notes);
    return S.filter((x) => x.hits.length).map((x) => Object.assign(x, { n: x.hits.length, follow: x.hits.filter((h) => onsets[h.s]).length / x.hits.length }));
  }

  const EVENS = Array.from({ length: 16 }, (_, i) => i * 2);
  const KITS = [
    { id: 'four', tag: 'Four on the floor', k: [0, 4, 8, 12, 16, 20, 24, 28], s: [4, 12, 20, 28], h: [2, 6, 10, 14, 18, 22, 26, 30], swing: 0 },
    { id: 'back', tag: 'Backbeat', k: [0, 10, 16, 26], s: [4, 12, 20, 28], h: EVENS, swing: 0 },
    { id: 'half', tag: 'Half-time', k: [0, 11, 14, 22], s: [8, 24], h: Array.from({ length: STEPS }, (_, i) => i), swing: 0 },
    { id: 'boombap', tag: 'Boom bap swing', k: [0, 7, 10, 16, 23, 26], s: [4, 12, 20, 28], h: EVENS, swing: 0.6 },
    { id: 'broken', tag: 'Broken', k: [0, 6, 10, 19, 22], s: [4, 13, 20, 29], h: EVENS, swing: 0 },
    { id: 'bounce', tag: 'Bouncing kick', k: [0, 3, 8, 11, 16, 19, 24, 27], s: [4, 12, 20, 28], h: [2, 6, 10, 14, 18, 22, 26, 30], swing: 0 },
  ].map((x) => Object.assign(x, { off: x.k.concat(x.s).filter((s) => s % 4 !== 0).length / (x.k.length + x.s.length) + x.swing * 0.5, n: x.k.length + x.s.length + x.h.length }));

  // a genre is the last thing picked: a bundle of tempo, swing and instruments
  const GENRES = {
    lofi: { name: 'Lo-fi', bpm: 80, swing: 0.62, inst: 'electric piano', patches: { lead: 'epiano', chords: 'keys', bass: 'bass-sub', kit: 'kit-lofi' }, why: 'your notes leave gaps, and swing fills them with a lazy bounce' },
    ambient: { name: 'Ambient', bpm: 70, swing: 0, inst: 'bell', patches: { lead: 'bell', chords: 'pad-glass', bass: 'bass-sub', kit: 'kit-lofi' }, why: 'long notes and space: it gets room to breathe' },
    boombap: { name: 'Boom bap', bpm: 90, swing: 0.58, inst: 'dusty keys', patches: { lead: 'keys', chords: 'epiano', bass: 'bass-pluck', kit: 'kit-lofi' }, why: 'it sits in the pocket, and a little swing gives it a nod' },
    pop: { name: 'Pop', bpm: 108, swing: 0, inst: 'pluck', patches: { lead: 'pluck', chords: 'keys', bass: 'bass-pluck', kit: 'kit-acoustic' }, why: 'it sits on the beat, so it’s easy to sing along to' },
    synthwave: { name: 'Synthwave', bpm: 100, swing: 0, inst: 'saw lead', patches: { lead: 'lead-saw', chords: 'stab', bass: 'bass-saw', kit: 'kit-808' }, why: 'long notes get room to ring over a steady drive' },
    house: { name: 'House', bpm: 122, swing: 0, inst: 'organ', patches: { lead: 'organ', chords: 'stab', bass: 'bass-saw', kit: 'kit-909' }, why: 'off-beat notes sound great against a steady pulse' },
    trap: { name: 'Trap', bpm: 140, swing: 0, inst: 'bell', up: 12, patches: { lead: 'bell', chords: 'pad-warm', bass: 'bass-808', kit: 'kit-808' }, why: 'quick notes ride on top of rolling hi-hats' },
    dnb: { name: 'Drum and bass', bpm: 172, swing: 0, inst: 'square lead', patches: { lead: 'lead-square', chords: 'pad-warm', bass: 'bass-sub', kit: 'kit-acoustic' }, why: 'it’s busy enough to keep up with a fast break' },
  };
  /** genres ranked by how well they suit the melody's rhythm (top five, or all with "Surprise me") */
  function soundStyles(idea, any) {
    const r = idea.melody.r, offR = r.off / r.n, avg = r.hits.reduce((a, h) => a + h[1], 0) / r.n;
    const fit = {
      lofi: 2 - Math.abs(r.n - 8) / 6 + 0.6 * offR, ambient: (r.n <= 6 ? 1.5 : 0) + avg / 4, boombap: 1.2 + 0.5 * offR - Math.abs(r.n - 9) / 10,
      pop: (1 - offR) * 1.6 + 0.3, synthwave: avg / 3 + 0.4, house: 2.4 * offR + (avg < 3 ? 0.8 : 0), trap: r.n / 8 + 0.3, dnb: r.n / 10 + offR,
    };
    const ids = Object.keys(fit).sort((a, b) => fit[b] - fit[a]);
    return (any ? ids : ids.slice(0, 5)).map((id) => ({ id, tag: GENRES[id].name, name: GENRES[id].name, bpm: GENRES[id].bpm, swing: GENRES[id].swing, inst: GENRES[id].inst, up: GENRES[id].up || 0, why: GENRES[id].why }));
  }

  // ---------------------------------------------------------------- three options, spread along what matters

  /**
   * Three candidates that differ most along `a` (the layer's telling
   * difference): the low end, the high end and the one nearest the middle.
   * Steering halves the pool toward one end first (p on a, s on b). Each
   * "three more" batch takes the next nearest to each target, up to six
   * batches before they repeat.
   */
  function spread(cands, steer, batch) {
    let pool = cands.slice();
    const half = (arr, f, dir) => { const s = arr.slice().sort((a, b) => f(a) - f(b)); const k = Math.max(3, Math.ceil(s.length / 2)); return dir < 0 ? s.slice(0, k) : s.slice(s.length - k); };
    for (let i = 0; i < Math.abs(steer.s || 0); i++) pool = half(pool, (c) => c.b, steer.s);
    for (let i = 0; i < Math.abs(steer.p || 0); i++) pool = half(pool, (c) => c.a, steer.p);
    pool.sort((x, y) => x.a - y.a || x.b - y.b);
    if (pool.length <= 3) return pool.slice(0, 3);
    const lo = pool[0].a, hi = pool[pool.length - 1].a, used = [];
    // how many fresh batches before they come round again: more for a bigger pool, never so many the ends blur
    const fresh = Math.max(2, Math.min(6, Math.floor(pool.length / 3)));
    return [lo, (lo + hi) / 2, hi].map((target) => {
      const near = pool.filter((c) => used.indexOf(c) < 0).sort((x, y) => Math.abs(x.a - target) - Math.abs(y.a - target));
      const c = near[Math.min(near.length - 1, batch % Math.min(fresh, near.length))];
      used.push(c);
      return c;
    }).sort((x, y) => x.a - y.a);
  }

  function shapeCands(mel) {
    const hs = mel.r.hits, n = hs.length;
    const seen = {}, cands = [];
    SHAPES.forEach((kind) => AMPS.forEach((amp) => {
      const s = shapeSteps(kind, n, amp, hs), key = s.join();
      if (seen[key]) return;
      seen[key] = 1;
      let leap = 0;
      for (let i = 1; i < n; i++) leap = Math.max(leap, Math.abs(s[i] - s[i - 1]));
      const range = maxOf(s) - minOf(s);
      if (range < 1) return; // a single repeated note is not a shape
      cands.push({ kind, amp, s, end: s[n - 1] - s[0], range, leap, size: sizeOf(range) });
    }));
    return cands;
  }
  /** how far a shape moves: 0 small (2 scale steps or less), 1 medium, 2 big (5 or more) */
  function sizeOf(range) { return range <= 2 ? 0 : range <= 4 ? 1 : 2; }
  function seedOf(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function shuffled(arr, R) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  /**
   * Round 2: one shape that falls (an answer), one that stays near home, one
   * that rises (a question). How far each moves is picked apart from where it
   * goes, so a round mixes a small, a medium and a big shape (steer.s: -1
   * small, -2 smoothest, -3 barely moving, +1 bigger, +2 biggest). Which shape fills each place
   * is shuffled per rhythm, and "three more" walks on through them.
   */
  function shapeOptions(mel, st, b) {
    const cands = shapeCands(mel), s = st.s || 0;
    // at most an octave across the two bars (a little more when asked twice for bigger)
    const all = cands.filter((c) => c.range <= (s >= 2 ? 9 : 7));
    let pool = all.filter((c) => c.leap <= 2);
    if (s >= 2) pool = all.filter((c) => c.leap <= 3);
    if (st.x === 'smooth' || s <= -2) pool = all.filter((c) => c.leap <= 1);
    if (st.x === 'jumpy') pool = all.filter((c) => c.leap >= 3);
    if (pool.length < 3) pool = all.filter((c) => c.leap <= 2);
    if (pool.length < 3) pool = all;
    // a third Subtler: shapes that barely move (one scale step), where the rhythm has them
    if (s <= -3) { const flat = pool.filter((c) => c.range <= 1); if (flat.length >= 3) pool = flat; }
    const dirs = [-1, 0, 1];
    const sizes = s <= -1 ? [0, 0, 0] : s === 1 ? [1, 2, 2] : s >= 2 ? [2, 2, 2] : [0, 1, 2];
    const cell = (d, z) => pool.filter((c) => Math.sign(c.end) === d && c.size === z);
    // which direction gets which size changes with the rhythm and each "three more"
    const R = rng(seedOf(mel.r.id + ':' + mel.scale + ':' + b));
    let best = null, bestHits = -1;
    for (const perm of shuffled(PERMS, R)) {
      const hits = perm.filter((k, i) => cell(dirs[i], sizes[k]).length).length;
      if (hits > bestHits) { best = perm; bestHits = hits; }
      if (hits === 3) break;
    }
    const used = [];
    const out = dirs.map((d, i) => {
      const want = sizes[best[i]];
      // the wanted size, else the nearest size that way (never smaller when asked for bigger,
      // never bigger when asked for subtler), else that size in any direction
      const near = s > 0 ? [want, want + 1, want - 1].filter((z) => z >= 1) : s < 0 ? [0] : [want, want - 1, want + 1, want - 2, want + 2];
      let cs = [];
      for (const z of near) { cs = cell(d, z); if (cs.length) break; }
      if (!cs.length) cs = pool.filter((c) => near.indexOf(c.size) >= 0);
      if (!cs.length) cs = pool;
      let order = shuffled(cs, rng(seedOf(mel.r.id + ':' + d + ':' + want + ':' + s + ':' + (st.x || ''))));
      // standing in for another size: the nearest to the size wanted first
      if (cs[0].size !== want) { const aim = [1.5, 3.5, 6][want]; order = order.sort((x, y) => Math.abs(x.range - aim) - Math.abs(y.range - aim)); }
      const fresh = order.filter((c) => used.indexOf(c) < 0 && !used.some((u) => u.kind === c.kind));
      const from = fresh.length ? fresh : order.filter((c) => used.indexOf(c) < 0);
      const list = from.length ? from : order;
      const c = list[b % list.length];
      used.push(c);
      return c;
    });
    const sc = SCALES[mel.scale];
    return out.sort((x, y) => x.end - y.end || x.range - y.range).map((c) => {
      const land = st.x === 'home' || c.end < 0 ? 0 : c.end > 0 ? 7 : sc.indexOf(4) >= 0 ? 4 : 3;
      const start = startFor(mel.scale, c.s, land);
      return { a: c.end + c.range * 0.01, b: c.range, land, leap: c.leap, range: c.range, end: c.end, size: c.size, mel: { r: mel.r, scale: mel.scale, shape: { kind: c.kind, amp: c.amp, start } } };
    });
  }

  /** the scale step a shape starts on so that it lands on `target` semitones above home */
  function startFor(scale, steps, target) {
    const sc = SCALES[scale];
    let start = sc.indexOf(target) - steps[steps.length - 1];
    while (start < -4) start += sc.length;
    while (start > 5) start -= sc.length;
    return start;
  }

  /** the three options of a round: { a, ...layer fields } */
  function options(dir, round, idea) {
    const st = round.steer || {};
    return cached('o' + dir + round.batch + JSON.stringify(st) + JSON.stringify(idea), () => {
      const b = round.batch || 0;
      if (dir === 'seed1') {
        const rs = spread(rhythmPool().map((r) => ({ r, a: r.n + 0.3 * r.off, b: 0 })), { p: st.p }, b);
        let sl = SCALE_ORDER.slice();
        if (st.s < 0) sl = sl.slice(0, 4);
        if (st.s > 0) sl = sl.slice(4);
        const ps = [0, Math.floor(sl.length / 2), sl.length - 1].map((i) => sl[(i + b) % sl.length]);
        const perm = [[1, 0, 2], [2, 1, 0], [0, 2, 1]][b % 3];
        return rs.map((c, i) => ({ a: c.a, mel: { r: c.r, scale: ps[perm[i]], shape: null } }));
      }
      if (dir === 'seed2') return shapeOptions(idea.melody, st, b);
      if (dir === 'chords') return spread(chordPool(idea.melody, st.x === 'colour').slice(0, 18).map((c) => Object.assign({ a: c.bright, b: c.changes }, c)), st, b);
      if (dir === 'bass') return spread(bassStyles(idea).map((c) => Object.assign(c, { a: c.lock, b: c.n })), st, b);
      if (dir === 'pads') return spread(padStyles(idea).map((c) => Object.assign(c, { a: c.voices, b: c.reg })), st, b);
      if (dir === 'perc') {
        let pool = percStyles(idea);
        if (st.x === 'follow') { const f = pool.filter((c) => c.follow >= 0.5); if (f.length >= 3) pool = f; }
        return spread(pool.map((c) => Object.assign(c, { a: c.n, b: c.follow })), st, b);
      }
      if (dir === 'beat') return spread(KITS.map((c) => Object.assign({}, c, { a: c.off, b: c.n })), st, b);
      return spread(soundStyles(idea, st.x === 'any').map((c) => Object.assign(c, { a: c.bpm, b: 0 })), st, b);
    });
  }

  /** round 2's extra choice: keep the melody exactly as it walked through its scale in round 1 */
  function walkOption(mel) {
    return { a: 0, land: 0, leap: 1, range: 4, end: 0, size: 1, walk: true, mel: { r: mel.r, scale: mel.scale, shape: { kind: 'walk', amp: 1, start: 0 } } };
  }

  // ---------------------------------------------------------------- words

  function shapeTag(kind, range) {
    return SWEEPS.indexOf(kind) >= 0 && range != null && range <= 2 ? 'Gentle ' + SHAPE_TAG[kind].toLowerCase() : SHAPE_TAG[kind];
  }
  function tagOf(dir, o) {
    if (dir === 'seed1') return rhythmTag(o.mel.r);
    if (dir === 'seed2') return shapeTag(o.mel.shape.kind, o.range);
    if (dir === 'chords') return (o.bright <= -2 ? 'Dark' : o.bright >= 2 ? 'Bright' : 'In between') + (o.colour ? ' + colour' : '');
    return o.tag;
  }
  function statOf(dir, o) {
    if (dir === 'seed1') return MODE[o.mel.scale].name.toLowerCase();
    if (dir === 'seed2') return 'lands on ' + IV[o.land];
    if (dir === 'chords') return o.fit + '% fit';
    if (dir === 'bass') return o.n + (o.n === 1 ? ' note' : ' notes');
    if (dir === 'pads') return o.voices + (o.voices === 1 ? ' voice' : ' voices');
    if (dir === 'perc') return o.n + ' hits';
    if (dir === 'beat') return o.swing ? 'swung' : Math.round(o.off * 100) + '% off grid';
    return o.bpm + ' BPM';
  }
  function rankOf(opts, i) {
    const as = opts.map((o) => o.a);
    return as[i] === minOf(as) ? 'low' : as[i] === maxOf(as) ? 'high' : 'mid';
  }
  /** Bobby on the option just heard, set against the other two */
  function comment(dir, opts, i) {
    const o = opts[i], rk = rankOf(opts, i);
    if (dir === 'seed1') {
      const r = o.mel.r, m = MODE[o.mel.scale];
      const sc = m.name + ', so it sounds ' + m.mood + '.';
      if (rk === 'high') return 'Not bad, it’s got motion. Busiest of the three' + (r.off ? ', ' + r.off + ' notes pushing off the beat' : '') + '. ' + sc;
      if (rk === 'low') return 'Lots of air: just ' + r.n + ' notes. ' + sc;
      return 'Middle ground, ' + r.n + ' notes. ' + sc;
    }
    if (dir === 'seed2') {
      let t = o.end < 0 ? 'Falls and lands on the ' + IV[o.land] + '. Sounds like an answer.' : o.end > 0 ? 'Ends higher than it starts, on the ' + IV[o.land] + ': a question. Leaves you wanting the next bar.' : 'Stays near home and lands on the ' + IV[o.land] + ': settled, but not closed.';
      if (o.size === 0) t += ' Small moves, so the rhythm does the talking.';
      else if (o.size === 2) t += ' A big sweep; it’s the event.';
      if (o.leap >= 3) t += ' Some jumps in there; they grab the ear.';
      return t;
    }
    if (dir === 'chords') {
      const names = o.chords.map(chordName).filter((n, i, a) => i === 0 || n !== a[i - 1]).join(', ');
      let t = rk === 'low' ? 'Darkest of the three: ' + names + '. Minor chords put a shadow under the same notes.' : rk === 'high' ? 'Brightest: ' + names + '. Same melody, sunnier floor.' : names + '. A bit of both.';
      const col = o.chords.find((c) => c.colour);
      if (col) t += ' That ' + chordName(col) + ' isn’t from the scale. Your melody makes it work.';
      return t;
    }
    if (dir === 'bass') return rk === 'high' ? 'Locks onto the melody: they hit together, so it sounds heavier.' : rk === 'low' ? 'Waits for the melody to breathe, then answers in the gaps. Call and response.' : o.tag + '. Holds the floor without crowding the melody.';
    if (dir === 'perc') return rk === 'low' ? 'Barely there. The melody still does the talking.' : rk === 'high' ? 'This one drives: ' + o.n + ' hits in two bars. Motion under the long notes.' : o.tag + '. Just enough to nod along.';
    if (dir === 'beat') return rk === 'low' ? 'Right on the grid. Solid, dance-floor straight.' : rk === 'high' ? 'Leans against the grid: kicks land between the beats. More swagger.' : o.tag + '. Somewhere between steady and loose.';
    if (dir === 'pads') return rk === 'low' ? 'Barely there. Gives the melody a shadow, nothing more.' : rk === 'high' ? 'Full and wide. The melody floats on top.' : o.tag + '. Fills in without taking over.';
    const t = o.name + ' at ' + o.bpm + '. ' + cap(o.why) + '.';
    return rk === 'low' ? t + ' Calmest of the three.' : rk === 'high' ? t + ' Most energy of the three.' : t;
  }
  function whyText(dir, o) {
    if (dir === 'seed1') return MODE[o.mel.scale].why + ' And the rhythm: ' + o.mel.r.off + ' of its ' + o.mel.r.n + ' notes land between the beats. That lean against the pulse is called syncopation.';
    if (dir === 'seed2') return 'Where a tune stops decides how finished it feels. This one lands on the ' + IV[o.land] + ', so it sounds ' + landFeel(o.land) + '. ' + (o.end > 0 ? 'Ending higher than it started makes it a question.' : o.end < 0 ? 'Ending lower makes it an answer.' : 'Staying near home keeps it calm.') + (o.size === 0 ? ' It only moves a step or two, so repeated notes and rhythm make the hook.' : o.size === 2 ? ' It travels a long way, so the tune itself is the hook. Too many of those and a song gets tiring.' : '');
    if (dir === 'chords') { const col = o.chords.find((c) => c.colour); return 'Each chord was picked so the melody’s long, strong notes are notes of the chord: ' + o.fit + '% of the melody sits on them. ' + (col ? chordName(col) + ' is borrowed from outside the scale; it works because the melody note above it belongs to it.' : 'Minor chords under the same notes sound darker, major ones brighter.'); }
    if (dir === 'bass') return o.lock > 0.6 ? 'When bass and melody hit together, both sound heavier and the rhythm gets louder.' : o.lock < 0.3 ? 'The bass plays when the melody rests. They take turns, call and response, so each stays clear.' : 'Roots on the strong beats tell your ear which chord you are on, without getting in the melody’s way.';
    if (dir === 'pads') return 'Pads only use notes from the chords or the scale, so they can’t fight the melody. ' + (o.voices <= 1.2 ? 'One quiet voice adds depth without crowding.' : 'More voices fill the space around the melody, so it floats on top.');
    if (dir === 'perc') return 'Claps on the melody’s accents make those notes jump out. A steady shaker gives a pulse the melody can lean against.';
    if (dir === 'beat') return o.off > 0.3 ? 'Kicks and snares between the beats are syncopation: the beat leans, and that leaning is swagger.' : 'Kick and snare right on the beat give a grid you can trust. That’s why dance music lives there.';
    return 'A genre is a bundle of habits: tempo, drums, sounds. It comes last, so the same idea can live in many of them. This one, because ' + o.why + '.';
  }
  /** the layer Bobby would add next (shown as a highlighted card, not said) */
  function suggestion(idea) {
    const has = (d) => !!idea.layers[d];
    const notes = melodyNotes(idea.melody), r = idea.melody.r;
    const gaps = coverage(notes).filter((c) => !c).length;
    if (!has('chords') && notes.some((n) => n.d >= 6)) return 'chords';
    if (!has('bass') && gaps >= 8) return 'bass';
    if (!has('perc') && r.off / r.n > 0.3) return 'perc';
    if (has('perc') && !has('beat')) return 'beat';
    if (has('chords') && !has('pads')) return 'pads';
    for (const d of NEXT_ORDER) if (!has(d) && (d !== 'beat' || has('perc'))) return d;
    return '';
  }
  /** directions open from here: Grow the beat needs percussion first */
  function directions(idea) { return NEXT_ORDER.filter((d) => d !== 'beat' || !!idea.layers.perc); }

  // ---------------------------------------------------------------- sound

  const NEUTRAL = { lead: 'lead-soft', chords: 'keys', bass: 'bass-pluck', kit: 'kit-acoustic' };
  const PAD_PATCH = { pad: 'pad-warm', voice: 'epiano', strings: 'strings', glass: 'pad-glass' };
  const DRUM = { clap: 39, tap: 76, shaker: 70, tamb: 54, kick: 36, snare: 38, hat: 42 };
  const MIX = { mel: 0.9, chd: 0.5, bas: 0.8, pad: 0.45, prc: 0.75, bt: 0.75 };
  const TRACK = { mel: 'b2g-mel', chd: 'b2g-chd', bas: 'b2g-bas', pad: 'b2g-pad', prc: 'b2g-prc', bt: 'b2g-bt' };

  function emptyIdea() { return { melody: null, layers: {}, order: [] }; }
  /** the idea with only its first `count` layers */
  function upTo(idea, count) {
    const layers = {};
    idea.order.slice(0, count).forEach((d) => { layers[d] = idea.layers[d]; });
    return { melody: idea.melody, layers, order: idea.order.slice(0, count) };
  }

  /**
   * A looping transport sequence for the idea, or for the idea with one
   * option auditioned in place: aud = { dir, spec }. While a layer is
   * auditioned the layers already in sit back a little, so the new one is
   * heard. Rhythm-and-scale options play as the plain walk.
   */
  function seq(idea, aud) {
    const pick = (d) => (aud && aud.dir === d ? aud.spec : idea.layers[d]);
    const sound = pick('sound'), beat = pick('beat');
    const G = sound ? GENRES[sound.id] : null;
    const P = G ? G.patches : NEUTRAL;
    const swing = sound ? sound.swing : beat ? beat.swing : 0;
    const shift = swing > 0.5 ? Math.round((swing * 4 - 2) * STEP_TICKS) : 0;
    const tick = (s) => s * STEP_TICKS + (mod(s, 4) === 2 ? shift : 0);
    const events = [];
    const note = (track, s, d, p, v, gap) => {
      const t = tick(s);
      const end = s + d >= STEPS ? LENGTH : tick(s + d);
      events.push({ t, d: Math.max(30, end - t - (gap == null ? 10 : gap)), p, v: Math.max(1, Math.min(127, Math.round(v))), track });
    };
    const hit = (track, s, p, v) => events.push({ t: tick(s), d: 60, p, v: Math.max(1, Math.min(127, Math.round(v))), track });
    const seeding = aud && (aud.dir === 'seed1' || aud.dir === 'seed2');
    const g = (d) => (!aud || aud.dir === d || aud.dir === 'sound' ? 1 : 0.6);
    const tracks = {};
    const track = (key, patch, vol) => { tracks[TRACK[key]] = { patch, volume: vol, mute: false, solo: false, channel: key === 'prc' || key === 'bt' ? 9 : 0 }; };

    const mel = seeding ? aud.spec.mel : idea.melody;
    if (mel) {
      const up = (sound && sound.up) || 0;
      track('mel', P.lead, MIX.mel * (aud && !seeding && aud.dir !== 'sound' ? 0.75 : 1));
      melodyNotes(mel, aud && aud.dir === 'seed1').forEach((n) => note(TRACK.mel, n.s, n.d, n.m + up, [64, 90, 115][n.w], 14));
    }
    if (!seeding) {
      LAYER_ORDER.forEach((d) => {
        const o = pick(d);
        if (!o) return;
        if (d === 'chords') {
          track('chd', P.chords, MIX.chd * g(d));
          o.chords.forEach((c, i) => c.pcs.forEach((pc) => note(TRACK.chd, i * 8, 8, 48 + c.root + mod(pc - c.root, 12), 80, 20)));
        } else if (d === 'bass') {
          track('bas', P.bass, MIX.bas * g(d));
          o.notes.forEach((n) => note(TRACK.bas, n.s, n.d, n.m, 100, 16));
        } else if (d === 'pads') {
          track('pad', PAD_PATCH[o.voice] || 'pad-warm', MIX.pad * g(d));
          o.notes.forEach((n) => n.ms.forEach((m) => note(TRACK.pad, n.s, n.d, m, 80, 6)));
        } else if (d === 'perc') {
          track('prc', 'kit-perc', MIX.prc * g(d));
          o.hits.forEach((h) => hit(TRACK.prc, h.s, DRUM[h.k] || DRUM.tap, 40 + 80 * (h.v || 1)));
        } else if (d === 'beat') {
          track('bt', P.kit, MIX.bt * g(d));
          o.k.forEach((s) => hit(TRACK.bt, s, DRUM.kick, 112));
          o.s.forEach((s) => hit(TRACK.bt, s, DRUM.snare, 105));
          o.h.forEach((s) => hit(TRACK.bt, s, DRUM.hat, s % 2 ? 50 : 78));
        }
      });
    }
    events.sort((a, b) => a.t - b.t);
    return { bpm: sound ? sound.bpm : 100, length: LENGTH, loop: true, tracks, events };
  }

  /** the climb: the bones (walk), the melody, then each layer added in the order it was picked */
  function climb(idea) {
    const out = [seq(emptyIdea(), { dir: 'seed1', spec: { mel: idea.melody } })];
    for (let i = 0; i <= idea.order.length; i++) out.push(seq(upTo(idea, i), null));
    return out;
  }

  /**
   * The climb as one sequence that plays once: each pass after the last, at
   * the final tempo, with earlier passes stretched so they keep their own
   * tempo. A track that changes instrument along the way gets a track per
   * instrument. passes: [{ start, length }] in ticks.
   */
  function climbSeq(idea) {
    const parts = climb(idea);
    const bpm = parts[parts.length - 1].bpm;
    const tracks = {}, events = [], passes = [];
    let at = 0;
    for (const p of parts) {
      const k = bpm / p.bpm;
      const len = Math.round(p.length * k);
      for (const e of p.events) {
        const tr = p.tracks[e.track];
        const key = e.track + '~' + tr.patch;
        if (!tracks[key]) tracks[key] = Object.assign({}, tr);
        events.push({ t: at + Math.round(e.t * k), d: Math.max(30, Math.round(e.d * k)), p: e.p, v: e.v, track: key });
      }
      passes.push({ start: at, length: len });
      at += len;
    }
    events.sort((a, b) => a.t - b.t);
    return { bpm, length: at, loop: false, tracks, events, passes };
  }

  /** each step of how the idea got here: [{ dir, spec, stage }] */
  function lineage(idea) {
    const ns = melodyNotes(idea.melody);
    const steps = [
      { dir: 'seed1', spec: { mel: idea.melody }, stage: 'Rhythm and scale' },
      { dir: 'seed2', spec: { mel: idea.melody, land: mod(ns[ns.length - 1].m, 12), end: 0, leap: 0 }, stage: 'Melody' },
    ];
    idea.order.forEach((d) => steps.push({ dir: d, spec: idea.layers[d], stage: DIRS[d].label }));
    return steps;
  }

  // ---------------------------------------------------------------- into the studio's ideas

  function ideaName(idea) {
    const m = idea.melody;
    if (!m) return 'Bones';
    const shape = m.shape ? SHAPE_TAG[m.shape.kind].toLowerCase() : rhythmTag(m.r).toLowerCase();
    const s = idea.layers.sound;
    return MODE[m.scale].name + ' ' + shape + (s ? ' (' + s.name + ')' : '');
  }

  /**
   * Parts for each layer, as the studio stores them (key of C, the idea's
   * scale), ready for Odd.idea.fromParts: [{ part, label }].
   */
  function toParts(idea) {
    const T = Odd.theory;
    const M = Odd.model;
    if (!T || !idea.melody) return [];
    const scale = STUDIO_SCALE[idea.melody.scale] || 'major';
    const sound = idea.layers.sound;
    const uid = (p) => (M && M.uid ? M.uid(p) : p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const QUAL = { '': 'maj', m: 'min', '°': 'dim', '+': 'aug' };
    const chords = chordsFor(idea);
    const prog = chords.map((c) => {
      const at = T.degreeOf(60 + c.root, 0, scale, 60);
      const ch = T.resolveChord ? T.resolveChord(scale, at.deg, at.acc, QUAL[c.q] || 'maj') : { deg: at.deg };
      return Object.assign(T.chordOnly(ch), { beats: 2 });
    });
    const ctx = { tonic: 0, scale, prog };
    const tk = (s) => s * STEP_TICKS;
    const pitched = (role, name, base, notes) => ({
      id: uid('p'), role, name, style: null, bars: 2, base, ctx: clone(ctx), tags: ['bones'], created: Date.now(), starred: false,
      notes: notes.map((n) => Object.assign({ t: tk(n.s), d: Math.max(30, tk(n.d) - 10), v: n.v || 96 }, T.degreeOf(n.m, 0, scale, base))),
    });
    const drums = (role, name, hits) => ({
      id: uid('p'), role, name, style: null, bars: 2, base: null, ctx: clone(ctx), tags: ['bones'], created: Date.now(), starred: false,
      notes: hits.map((h) => ({ t: tk(h.s), d: 60, p: h.p, v: h.v })).sort((a, b) => a.t - b.t),
    });
    const out = [];
    const up = (sound && sound.up) || 0;
    out.push({ label: 'Melody', part: pitched('lead', 'Melody: ' + ideaName(idea), 60 + up, melodyNotes(idea.melody).map((n) => ({ s: n.s, d: n.d, m: n.m + up, v: [64, 90, 115][n.w] }))) });
    for (const d of idea.order) {
      const o = idea.layers[d];
      if (d === 'chords') out.push({ label: 'Chords', part: pitched('chords', 'Chords: ' + o.chords.map(chordName).join(' '), 48, [].concat.apply([], o.chords.map((c, i) => c.pcs.map((pc) => ({ s: i * 8, d: 8, m: 48 + c.root + mod(pc - c.root, 12), v: 80 }))))) });
      if (d === 'bass') out.push({ label: 'Bass', part: pitched('bass', 'Bass: ' + o.tag, 36, o.notes.map((n) => ({ s: n.s, d: n.d, m: n.m, v: 100 }))) });
      if (d === 'pads') out.push({ label: 'Pads', part: pitched('pad', 'Pad: ' + o.tag, 48, [].concat.apply([], o.notes.map((n) => n.ms.map((m) => ({ s: n.s, d: n.d, m, v: 80 }))))) });
      if (d === 'perc') out.push({ label: 'Percussion', part: drums('perc', 'Percussion: ' + o.tag, o.hits.map((h) => ({ s: h.s, p: DRUM[h.k] || DRUM.tap, v: Math.round(40 + 80 * (h.v || 1)) }))) });
      if (d === 'beat') out.push({ label: 'Beat', part: drums('drums', 'Beat: ' + o.tag, o.k.map((s) => ({ s, p: DRUM.kick, v: 112 })).concat(o.s.map((s) => ({ s, p: DRUM.snare, v: 105 })), o.h.map((s) => ({ s, p: DRUM.hat, v: s % 2 ? 50 : 78 })))) });
    }
    return out;
  }

  // ---------------------------------------------------------------- flow: pure steps for the screen

  /*
   * state = { phase: 'start' | 'round' | 'next' | 'gold', idea, round, hist, hid,
   *           sel, seq, anim, kind, added, line, msg, saved }
   *   seq   bumps whenever the cards on screen change (new round, more, request)
   *   anim  bumps whenever the screen should animate in
   *   hist  newest first: { id, dir, opts, chosen, note, idea, round, marker }
   */
  const MAX_HIST = 80;
  const flow = {
    fresh() {
      return { phase: 'start', idea: emptyIdea(), round: null, hist: [], hid: 0, sel: -1, seq: 0, anim: 0, kind: 'pop', added: null, line: null, msg: null, saved: null };
    },
    enter(S, dir) {
      return Object.assign({}, S, { phase: 'round', round: { dir, batch: 0, steer: { p: 0, s: 0, x: null } }, sel: -1, msg: null, line: null, seq: S.seq + 1, anim: S.anim + 1, kind: 'pop', added: null });
    },
    options(S) { return S.round ? options(S.round.dir, S.round, S.idea) : []; },
    row(S, extra) {
      const row = Object.assign({ id: S.hid + 1, dir: S.round.dir, opts: flow.options(S), chosen: -1, note: '', idea: S.idea, round: S.round }, extra);
      return { hist: [row].concat(S.hist).slice(0, MAX_HIST), hid: S.hid + 1 };
    },
    /** promote option i (or `own`, an option of the screen's own such as the plain walk) */
    pick(S, i, own) {
      const r = S.round, o = own || flow.options(S)[i];
      if (!r || !o) return S;
      const idea = { melody: S.idea.melody, layers: Object.assign({}, S.idea.layers), order: S.idea.order.slice() };
      const ns = Object.assign({}, S, flow.row(S, { chosen: own ? -1 : i, note: own ? 'Kept the plain walk' : 'Picked ' + ABC.charAt(i) + ': ' + tagOf(r.dir, o) }), { anim: S.anim + 1, msg: null, line: null, seq: S.seq + 1, idea, saved: null });
      if (r.dir === 'seed1') {
        idea.melody = { r: o.mel.r, scale: o.mel.scale, shape: null };
        return Object.assign(ns, { phase: 'round', round: { dir: 'seed2', batch: 0, steer: { p: 0, s: 0, x: null } }, sel: 1, kind: 'rise', added: null });
      }
      if (r.dir === 'seed2') idea.melody = o.mel;
      else { idea.layers[r.dir] = o; if (idea.order.indexOf(r.dir) < 0) idea.order.push(r.dir); }
      // a new shape changes everything built on the melody, so its layers go (they stay in the history)
      if (r.dir === 'seed2') { idea.layers = {}; idea.order = []; }
      return Object.assign(ns, { phase: 'next', round: null, sel: -1, kind: 'pop', added: r.dir });
    },
    keepWalk(S) { return flow.pick(S, -1, walkOption(S.idea.melody)); },
    more(S) {
      return Object.assign({}, S, flow.row(S, { note: 'Passed over' }), { round: Object.assign({}, S.round, { batch: S.round.batch + 1 }), seq: S.seq + 1, sel: -1, msg: 'more', line: null, anim: S.anim + 1, kind: 'pop' });
    },
    /** a request re-rolls the three with a steer; "why" only explains. Returns the new state; play the middle one */
    request(S, rq) {
      if (rq.why) return Object.assign({}, S, { line: S.sel >= 0 ? whyText(S.round.dir, flow.options(S)[S.sel]) : S.line });
      const steer = Object.assign({}, S.round.steer);
      if (rq.p) steer.p = Math.max(-2, Math.min(2, (steer.p || 0) + rq.p));
      // shapes can get flatter one step further than the other rounds' -2
      const sLo = S.round.dir === 'seed2' ? -3 : -2;
      if (rq.s) steer.s = Math.max(sLo, Math.min(2, (steer.s || 0) + rq.s));
      const stuck = rq.s && steer.s === (S.round.steer.s || 0);
      if (rq.x) steer.x = steer.x === rq.x ? null : rq.x;
      return Object.assign({}, S, flow.row(S, { note: 'Before “' + rq.label + '”' }), { round: Object.assign({}, S.round, { steer, batch: 0 }), seq: S.seq + 1, sel: 1, anim: S.anim + 1, kind: 'pop', msg: null, line: stuck ? 'That’s as far as it goes.' : rq.reply });
    },
    /** go back to an earlier round as it was; everything after it stays in the history */
    back(S, row) {
      if (!row || !row.round) return S;
      const mark = { id: S.hid + 1, dir: row.dir, opts: [], chosen: -1, note: 'You went back to this round', idea: row.idea, marker: true };
      return Object.assign({}, S, {
        phase: 'round', round: row.round, idea: row.idea, sel: -1, seq: S.seq + 1, anim: S.anim + 1, kind: 'pop', msg: null, added: null, saved: null,
        line: LINES.back.replace('{x}', DIRS[row.dir].label.toLowerCase()),
        hist: [mark].concat(S.hist).slice(0, MAX_HIST), hid: S.hid + 1,
      });
    },
    skip(S) { return Object.assign({}, S, { phase: 'next', round: null, sel: -1, line: line(LINES.skipped, S.seq), added: null, anim: S.anim + 1 }); },
    finish(S) { return Object.assign({}, S, { phase: 'gold', round: null, sel: -1, line: null, anim: S.anim + 1 }); },
    keepBuilding(S) { return Object.assign({}, S, { phase: 'next', round: null, sel: -1, line: null, anim: S.anim + 1 }); },
    canFinish(S) { return !!(S.idea.melody && S.idea.melody.shape) && S.phase !== 'gold'; },
    /** a loaded state, or a fresh one when it doesn't hold together */
    repair(raw) {
      const S = flow.fresh();
      if (!raw || typeof raw !== 'object' || !['start', 'round', 'next', 'gold'].includes(raw.phase)) return S;
      try {
        const out = Object.assign(S, raw, { hist: Array.isArray(raw.hist) ? raw.hist.slice(0, MAX_HIST) : [] });
        if (!out.idea || typeof out.idea !== 'object') out.idea = emptyIdea();
        if (!out.idea.layers) out.idea.layers = {};
        if (!Array.isArray(out.idea.order)) out.idea.order = [];
        if (out.phase === 'round' && (!out.round || !DIRS[out.round.dir])) return flow.fresh();
        if (out.phase === 'round' && out.round.dir !== 'seed1' && !out.idea.melody) return flow.fresh();
        if ((out.phase === 'next' || out.phase === 'gold') && !(out.idea.melody && out.idea.melody.shape)) return flow.fresh();
        if (out.phase === 'round') flow.options(out); // throws on a broken idea
        out.line = null;
        return out;
      } catch (e) { return flow.fresh(); }
    },
  };

  Odd.audition = {
    STEPS, STEP_TICKS, LENGTH, ABC, NAMES, IV, DIRS, NEXT_ORDER, LAYER_ORDER, REQS, LINES, line,
    SCALES, SCALE_ORDER, MODE, SHAPES, SHAPE_TAG, KITS, GENRES, TRACK,
    makeRhythm, rhythmPool, rhythmTag, shapeOf, shapeSteps, shapeTag, sizeOf, melodyNotes, startFor,
    chordCands, chordPool, chordsFor, chordName, bassStyles, padStyles, percStyles, soundStyles,
    spread, options, walkOption, tagOf, statOf, rankOf, comment, whyText, suggestion, directions,
    emptyIdea, upTo, seq, climb, climbSeq, lineage, ideaName, toParts, flow,
  };
})(globalThis.Odd = globalThis.Odd || {});
