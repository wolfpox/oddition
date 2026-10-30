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
 * The only fixed assumptions: 2 bars on a 16th grid, 100 BPM until a sound
 * is picked, key of C. The meter is picked with the rhythm (4/4 unless asked:
 * "Another meter" goes through 3/4, 6/8, 5/4 and 7/8), and every later layer
 * follows it: chords change on its strong beats, drums are built from its
 * groups.
 *
 * That is the Melody path. The Idea Builder opens on a choice of three
 * (PATHS): a Groove starts from the pocket (a beat at a tempo), a bass line
 * that sets the chords, and chords on top; a Riff from a rhythm with accents,
 * its notes and its weight. After those first screens any order goes. An
 * idea remembers its path (idea.path, 'melody' when absent).
 *
 * Every round deals its whole pool as a deck, three cards at a time, the
 * three spread along that layer's most telling difference (sparse..busy,
 * answer..question, dark..bright, ...). Previous and Next move through it;
 * every card comes up before the deck is shuffled. Requests narrow the
 * pool and deal again ("Busier", "Darker", "Surprise me").
 *
 *   idea  = { path, melody, riff, layers: { [dir]: option }, order: [dir] }
 *   melody = { r: rhythm, scale, shape }   shape null until round 2
 *   riff   = { r: rhythm with accents, scale, notes, weight }   null until picked
 *   rhythm = { id, hits: [[step, length, weight]], n, off }
 *   round = { dir, batch, deal, seen, steer: { p, s, x, m } }
 *           batch: which three of the deck; deal: how often it was shuffled; seen: the furthest batch dealt
 *
 * flow.* are pure state steps for the screen (Odd.bones); seq() turns an idea
 * into a transport sequence; toParts() into parts for the idea shelf.
 */
(function (Odd) {
  'use strict';

  // two bars of 4/4; an idea in another meter has its own (stepsOf)
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
    // a groove
    pocket: { label: 'The pocket', color: '#f27b62', low: 'right on the grid', high: 'leaning against it' },
    gbass: { label: 'Bass line', color: '#a395ff', low: 'plays between the kicks', high: 'locks to the kick' },
    keys: { label: 'Chords on top', color: '#4ec8b2', low: 'held', high: 'chopped' },
    hook: { label: 'A hook on top', color: '#f1cd58', sub: 'Optional. Plenty of grooves leave the space empty', low: 'sparse', high: 'busy' },
    // a riff
    rrhythm: { label: 'Riff rhythm', color: '#f1cd58', low: 'on the grid', high: 'against it' },
    rnotes: { label: 'Riff notes', color: '#f1cd58', low: 'barely moves', high: 'travels' },
    weight: { label: 'Weight', color: '#f1cd58', low: 'lean', high: 'heavy' },
    drums: { label: 'Drums', color: '#f27b62', sub: 'With the riff, or against it', low: 'with the riff', high: 'against it' },
    under: { label: 'Under it', color: '#6fb0ff', sub: 'A drone, or chords that move under the riff', low: 'still', high: 'moving' },
  };
  const NEXT_ORDER = ['chords', 'bass', 'perc', 'beat', 'pads', 'sound'];
  const LAYER_ORDER = ['pocket', 'gbass', 'keys', 'chords', 'bass', 'pads', 'under', 'perc', 'beat', 'drums'];

  // Three ways in. Each path's first screens (open) make the idea, in order; then any of `next`, in any order
  const PATHS = {
    groove: { label: 'Groove', line: 'Start with the body: drums and bass that make heads nod. A tune can come later, or never.', open: ['pocket', 'gbass', 'keys'], next: ['perc', 'hook', 'pads', 'sound'] },
    melody: { label: 'Melody', line: 'Start with a line you could hum. Everything else gets built to hold it up.', open: ['seed1', 'seed2'], next: NEXT_ORDER },
    riff: { label: 'Riff', line: 'Start with a figure that repeats and hits hard. Short and stubborn, and it can carry a whole song.', open: ['rrhythm', 'rnotes', 'weight'], next: ['drums', 'under', 'perc', 'sound'] },
  };
  const PATH_ORDER = ['groove', 'melody', 'riff'];
  // what a layer is for, when a path changes it
  const SUBS = {
    groove: { perc: 'Spice: hand percussion over the pocket', pads: 'Pads and strings around the groove', sound: 'Its kit, bass and keys. The tempo stays' },
    riff: { perc: 'Claps, shakers and bells over the riff', sound: 'Its instruments, tempo and swing' },
  };
  // a round's own way out: kept as it is, or nothing at all
  const OWN = { seed2: ['Keep the plain walk', 'Kept the plain walk'], keys: ['No chords: drums and bass are enough', 'No chords'] };
  const SKIP_LABEL = { hook: 'Leave the space', under: 'Nothing under it' };
  const REQS = {
    seed1: [{ label: 'Busier', p: 1, reply: 'Busier. Okay, let’s hear it.' }, { label: 'Sparser', p: -1, reply: 'More space. Here.' }, { label: 'Darker scale', s: -1, reply: 'Darker scales. Give me a second.' }, { label: 'Brighter scale', s: 1, reply: 'Brighter. Here we go.' }, { label: 'Another meter', m: 1 }, WHY],
    seed2: [{ label: 'Subtler', s: -1, reply: 'Smaller moves. Listen to how the rhythm comes forward.' }, { label: 'Bigger', s: 1, reply: 'Bigger shapes. These travel.' }, { label: 'More jumps', x: 'jumpy', reply: 'Jumpier. Here.' }, { label: 'Land on home', x: 'home', reply: 'All three land on home now. Hear how finished that sounds?' }, WHY],
    chords: [{ label: 'Darker', p: -1, reply: 'Darker. Same melody, more shadow.' }, { label: 'Brighter', p: 1, reply: 'Brighter. Here.' }, { label: 'Surprise me', x: 'colour', reply: 'Okay, a chord or two from outside the scale. Still fits.' }, WHY],
    bass: [{ label: 'Busier', s: 1, reply: 'Busier bass. Here.' }, { label: 'Simpler', s: -1, reply: 'Simpler. Less is more, sometimes.' }, { label: 'Lock tighter', p: 1, reply: 'Tighter to the melody. Listen.' }, WHY],
    perc: [{ label: 'More drive', p: 1, reply: 'More drive. Here.' }, { label: 'Calmer', p: -1, reply: 'Calmer. Just a touch.' }, { label: 'Follow the melody', x: 'follow', reply: 'These ones follow the melody’s rhythm.' }, WHY],
    beat: [{ label: 'Straighter', p: -1, reply: 'Straighter. Right on the grid.' }, { label: 'Looser', p: 1, reply: 'Looser. Let it lean.' }, { label: 'Harder', s: 1, reply: 'Harder. Here.' }, WHY],
    pads: [{ label: 'Fuller', p: 1, reply: 'Fuller. Here.' }, { label: 'Thinner', p: -1, reply: 'Thinner. Just a shadow.' }, { label: 'Higher', s: 1, reply: 'Higher up. Listen.' }, WHY],
    sound: [{ label: 'More energy', p: 1, reply: 'More energy. Here.' }, { label: 'Calmer', p: -1, reply: 'Calmer. Here.' }, { label: 'Surprise me', x: 'any', reply: 'Anything goes. Let’s see what fits.' }, WHY],
    pocket: [{ label: 'Slower', t: -1, reply: 'Slower. Same pockets, more weight.' }, { label: 'Faster', t: 1, reply: 'Faster. Here.' }, { label: 'Busier', s: 1, reply: 'Busier. More hits.' }, { label: 'Sparser', s: -1, reply: 'Sparser. More air.' }, { label: 'Swing it', x: 'swing', reply: 'Swung. The off-beats come a little late.' }, { label: 'Another meter', m: 1 }, WHY],
    gbass: [{ label: 'Darker', c: -1, reply: 'Darker. Same pocket, more shadow.' }, { label: 'Brighter', c: 1, reply: 'Brighter. Here.' }, { label: 'Simpler', s: -1, reply: 'Simpler. Fewer notes.' }, { label: 'Busier', s: 1, reply: 'Busier bass. Here.' }, WHY],
    keys: [{ label: 'More held', p: -1, reply: 'Longer chords. Here.' }, { label: 'More chopped', p: 1, reply: 'Chopped up. The chords join the rhythm.' }, { label: 'Fuller', s: 1, reply: 'Fuller chords. Here.' }, { label: 'Thinner', s: -1, reply: 'Thinner. A couple of notes.' }, WHY],
    hook: [{ label: 'Busier', p: 1, reply: 'Busier. Here.' }, { label: 'Sparser', p: -1, reply: 'Fewer notes. Here.' }, { label: 'In the gaps', x: 'gaps', reply: 'These stay out of the bass’s way.' }, WHY],
    rrhythm: [{ label: 'Busier', s: 1, reply: 'Busier. More hits.' }, { label: 'Sparser', s: -1, reply: 'More rests. Here.' }, { label: 'Straighter', p: -1, reply: 'Straighter. Right on the beat.' }, { label: 'Against the beat', p: 1, reply: 'The accents move off the beat. Hear it pull?' }, { label: 'Another meter', m: 1 }, WHY],
    rnotes: [{ label: 'Darker', s: -1, reply: 'Darker scales. Here.' }, { label: 'Brighter', s: 1, reply: 'Brighter. Here.' }, { label: 'Simpler', p: -1, reply: 'Fewer notes. The rhythm does more.' }, { label: 'Wider', p: 1, reply: 'Wider. These travel.' }, { label: 'Stranger', x: 'odd', reply: 'Notes from outside the scale. On purpose.' }, WHY],
    weight: [{ label: 'Heavier', p: 1, reply: 'Heavier. Here.' }, { label: 'Lighter', p: -1, reply: 'Lighter. Here.' }, WHY],
    drums: [{ label: 'With the riff', p: -1, reply: 'These follow the riff.' }, { label: 'Against it', p: 1, reply: 'These push against it.' }, { label: 'Harder', s: 1, reply: 'Harder. Here.' }, WHY],
    under: [{ label: 'Stiller', p: -1, reply: 'Stiller. Let the riff grind on it.' }, { label: 'More movement', p: 1, reply: 'Chords that move. Same riff, new colour.' }, WHY],
  };

  // Bobby's lines. Lists are picked from by a counter so he doesn't repeat himself.
  const LINES = {
    start: 'What are you in the mood for, boss? Pick any of them. I’ve got lots of material to work with.',
    peek: {
      groove: ['That’s a groove: drums and bass first. Every one I play you is different. Tap it again to start there.', 'Another groove. Tap again to start one of your own.'],
      melody: ['That’s a melody, with a little behind it. Tap it again to start there.', 'Another tune. Tap again to start one of your own.'],
      riff: ['That’s a riff: short and stubborn. Tap it again to start there.', 'Another riff. Tap again to start one of your own.'],
    },
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
      pocket: ['Start with the pocket: a beat at a tempo. Speed is part of the feel, so it gets picked here. One right on the grid, one leaning, one in between.'],
      gbass: ['Now the bass. It locks to that kick or plays between it, and it decides the chords: stay on one, sway between two, or walk a loop.'],
      keys: ['Chords on top of that bass. Held, chopped, or somewhere between. Or none: plenty of grooves are just drums and bass.'],
      hook: ['A hook on top: a short line that sits in the groove’s gaps. Like a melody, rhythm first, then its shape.'],
      rrhythm: ['A riff starts as a rhythm. One note, hits and rests, and which hits land hard. One right on the grid, one against it, one in between.'],
      rnotes: ['Same rhythm. Now the notes. Some barely move, some travel. The rhythm does half the work either way.'],
      weight: ['Now its weight: who plays it, and how thick. One lean, one heavy, one in between.'],
      drums: ['Drums for the riff. One follows it, one pushes against it, one in between.', 'The kit. With the riff, against it, or somewhere between.'],
      under: ['Something under the riff. A drone it can grind against, or chords that move while it stays put.'],
    },
    more: ['Three more from the deck. The last three are still there: go back any time.', 'Next three. Nothing’s thrown away; they’re just to the left.', 'Fresh three. Every one in the pool gets its turn before anything repeats.'],
    prev: ['The three before. Still here.', 'Back a step. Same three as before.'],
    shuffled: ['That’s every one in the pool. Shuffled: same cards, new company.', 'You’ve heard the whole deck. Shuffled, dealing again: new threes this time.'],
    next: ['The melody leads; everything we add backs it up. Where to?', 'Where next? Nothing’s wrong from here, only different.', 'Your melody is the boss. What should back it up?'],
    nextBy: {
      groove: ['The groove leads now. What goes with it?', 'Where next? Nothing’s wrong from here, only different.', 'Spice, a hook, or the sound. Or just call it.'],
      riff: ['The riff is the boss. What goes around it?', 'Where next? Nothing’s wrong from here, only different.', 'Drums, something under it, or the sound.'],
    },
    goldBy: {
      groove: ['That’s gold. A while ago it was a beat. Play the climb to hear how it got here.'],
      riff: ['Gold. It started as hits on one note. Play the climb.'],
    },
    climbBy: {
      groove: ['The pocket: just the beat.'],
      riff: ['The riff’s rhythm, on one note.', '+ Its notes.', '+ Its weight. That’s the riff.'],
    },
    grooveDone: 'That’s your groove: drums, bass and chords. From here, anything goes.',
    noChords: 'No chords. Drums and bass, and plenty of room.',
    riffDone: 'That’s your riff. Now let’s build around it.',
    hook: 'There’s your hook, sitting in the groove.',
    hookWalk: 'The plain walk it is. A hook can be that simple.',
    swingCompound: 'It already rolls in threes, so there’s nothing to swing. Same pockets.',
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

  // one beat's worth of rhythm. A quarter-note beat is 4 steps; a beat of
  // three eighths (6/8, the long beat of 7/8) is 6 steps, with its own cells
  const CELLS = { q: [[0, 4]], e: [[0, 2], [2, 2]], off: [[2, 2]], s: [[0, 1], [1, 1], [2, 1], [3, 1]], dot: [[0, 3], [3, 1]], sync: [[0, 1], [1, 2], [3, 1]], es: [[0, 2], [2, 1], [3, 1]], ant: [[3, 1]], rest: [], hold: [] };
  const CELLS6 = { q: [[0, 6]], e: [[0, 2], [2, 2], [4, 2]], off: [[2, 2], [4, 2]], s: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 2]], dot: [[0, 4], [4, 2]], sync: [[0, 2], [2, 4]], es: [[0, 2], [2, 2], [4, 1], [5, 1]], ant: [[4, 2]], rest: [], hold: [] };

  // ---------------------------------------------------------------- meter
  // An idea's meter is its rhythm's (rhythm.m, absent for 4/4). Every later
  // layer reads it from the melody, so the whole idea stays in one meter.

  const METER_ORDER = ['4/4', '3/4', '6/8', '5/4', '7/8'];
  function meterOf(mel) { return Odd.theory.meter(mel && mel.r ? mel.r.m : null); }
  /** the steps in an idea's two bars */
  function stepsOf(mel) { return 2 * meterOf(mel).steps; }
  function onPulse(m, s) { const x = mod(s, m.steps); return m.pulses.some((p) => p.s === x); }
  /** each beat of both bars: [{ s, len, bar, k }] (k: the beat's place in its bar) */
  function beatsOf(m) {
    const out = [];
    for (let bar = 0; bar < 2; bar++) m.pulses.forEach((p, k) => out.push({ s: bar * m.steps + p.s, len: p.len, bar, k }));
    return out;
  }
  /** where chords sit in both bars: [{ s, len }], one per change (half bars in 4/4) */
  function slotsOf(m) {
    const out = [];
    for (let bar = 0; bar < 2; bar++) m.harm.forEach((h, j) => out.push({ s: bar * m.steps + h, len: (j + 1 < m.harm.length ? m.harm[j + 1] : m.steps) - h }));
    return out;
  }
  function slotAt(slots, s) {
    const x = mod(s, slots[slots.length - 1].s + slots[slots.length - 1].len);
    for (let i = slots.length - 1; i >= 0; i--) if (x >= slots[i].s) return i;
    return 0;
  }
  /** the beats that answer the strong ones (2 and 4 in 4/4), for claps and snares: [step in bar] */
  function backsOf(m) {
    const weak = m.pulses.map((p) => p.s).filter((s) => m.groupStarts.indexOf(s) < 0);
    return weak.length ? weak : m.groupStarts.slice(1);
  }
  /** notes that lean against the beat: off the beat, or (in eighth-note meters) off the eighths or held over one */
  function offCount(m, hits) {
    if (!m.compound) return hits.filter((h) => !onPulse(m, h[0])).length;
    return hits.filter((h) => h[0] % 2 !== 0 || (!onPulse(m, h[0]) && h[1] > 2)).length;
  }

  /** a 2-bar rhythm from density d and push y (0..1), one beat-cell at a time, in meter mid (default 4/4) */
  function makeRhythm(seed, d, y, mid) {
    const m = Odd.theory.meter(mid), total = 2 * m.steps;
    const R = rng(seed);
    const W = { rest: 1.1 * (1 - d), hold: 1.4 * (1 - d), q: 1, e: 0.4 + 1.2 * d, off: 0.9 * y, s: 1.6 * d * d, dot: 0.5 + 0.3 * y, sync: 1.4 * y * d, es: 0.7 * d, ant: 0.6 * y };
    const first = { q: 1, e: 0.4 + d, dot: 0.6, s: d * d, es: 0.6 * d, sync: y * d };
    const bar1 = [weighted(R, first)];
    for (let b = 1; b < m.pulses.length; b++) bar1.push(weighted(R, W));
    // bar 2 echoes the start of bar 1 more often than not
    const bar2 = bar1.map((c, i) => (i < 2 && R() < 0.6 ? c : i === 0 ? weighted(R, first) : weighted(R, W)));
    const hits = [];
    const beats = beatsOf(m);
    bar1.concat(bar2).forEach((c, b) => {
      const bt = beats[b];
      if (c === 'hold') { const p = hits[hits.length - 1]; if (p && p[0] + p[1] === bt.s) p[1] += bt.len; return; }
      (bt.len === 6 ? CELLS6 : CELLS)[c].forEach((x) => hits.push([bt.s + x[0], x[1]]));
    });
    if (hits.length < 3) return null;
    const last = hits[hits.length - 1];
    last[1] = Math.min(total - last[0], Math.max(last[1], 4));
    hits.forEach((h) => { const x = mod(h[0], m.steps); h[2] = m.groupStarts.indexOf(x) >= 0 ? 2 : onPulse(m, x) ? 1 : h[1] >= 3 ? 2 : 0; });
    hits[0][2] = 2;
    return hits;
  }
  function rhythmPool(mid) {
    const m = Odd.theory.meter(mid);
    return cached('rpool' + m.id, () => {
      const seen = {}, out = [];
      const DS = [0.05, 0.3, 0.55, 0.8, 1], YS = [0, 0.35, 0.7, 1];
      for (let i = 0; i < 80; i++) {
        const hits = makeRhythm(1009 + i * 7919, DS[i % 5], YS[Math.floor(i / 5) % 4], m.id);
        if (!hits) continue;
        const key = JSON.stringify(hits);
        if (seen[key]) continue;
        seen[key] = 1;
        const r = { id: 'r' + i, hits, n: hits.length, off: offCount(m, hits) };
        if (m.id !== '4/4') Object.assign(r, { id: 'r' + i + '@' + m.id, m: m.id });
        out.push(r);
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
    // for grooves and riffs
    mpenta: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
  };
  // the seven-note scale a five- or six-note one lives in, for its chords
  const PARENT = { penta: 'major', mpenta: 'minor', blues: 'minor' };
  const SCALE_ORDER = ['phrygian', 'minor', 'harmonic', 'dorian', 'penta', 'mixolydian', 'major', 'lydian']; // dark to bright
  // the studio's name for each scale (pentatonic lives inside major)
  const STUDIO_SCALE = { phrygian: 'phrygian', minor: 'minor', harmonic: 'harmonicMinor', dorian: 'dorian', penta: 'major', mixolydian: 'mixolydian', major: 'major', lydian: 'lydian', mpenta: 'minor', blues: 'minor' };
  const MODE = {
    phrygian: { name: 'Phrygian', mood: 'tense', why: 'Phrygian has the note just above home only a half step away. That closeness sounds tense.' },
    minor: { name: 'Minor', mood: 'dark', why: 'Minor lowers the 3rd note of the scale, and that one note does most of the darkening.' },
    harmonic: { name: 'Harmonic minor', mood: 'dramatic', why: 'Harmonic minor raises minor’s 7th, leaving a wide gap that sounds dramatic, almost exotic.' },
    dorian: { name: 'Dorian', mood: 'cool', why: 'Dorian is minor with one brighter note, the 6th. That’s why it sounds cool rather than sad.' },
    penta: { name: 'Pentatonic', mood: 'open', why: 'Pentatonic keeps five notes and drops the two that rub, so any order of them sounds fine.' },
    mixolydian: { name: 'Mixolydian', mood: 'loose', why: 'Mixolydian is major with a lowered 7th, which takes away the pull home. It feels laid back.' },
    major: { name: 'Major', mood: 'bright', why: 'Major puts a major 3rd above home, and that interval is most of what we hear as bright.' },
    lydian: { name: 'Lydian', mood: 'floating', why: 'Lydian raises the 4th. That note wants to go up, so the tune seems to float.' },
    mpenta: { name: 'Minor pentatonic', mood: 'raw', why: 'Minor pentatonic is minor with the two notes that rub taken out. Most riffs live in this box.' },
    blues: { name: 'Blues', mood: 'gritty', why: 'The blues scale is minor pentatonic plus the ♭5, a note that rubs on purpose.' },
  };
  function degMidi(scale, deg) { const s = SCALES[scale]; return 60 + 12 * Math.floor(deg / s.length) + s[mod(deg, s.length)]; }
  function parentScale(scale) { return SCALES[PARENT[scale] || scale]; }
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

  /** how much each pitch class sounds in each chord slot: long, strong and accented notes count most */
  function slotWeights(notes, m) {
    const slots = slotsOf(m);
    const W = slots.map(() => new Array(12).fill(0));
    notes.forEach((e) => {
      slots.forEach((sl, k) => {
        const a = Math.max(e.s, sl.s), b = Math.min(e.s + e.d, sl.s + sl.len);
        if (b <= a) return;
        let w = (b - a) * (e.s === sl.s ? 1.5 : onPulse(m, e.s) ? 1.2 : 1) * (e.w === 2 ? 1.3 : 1);
        if (e.s < sl.s) w *= 0.6; // carried over from the slot before
        W[k][mod(e.m, 12)] += w;
      });
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
  /** chord paths (one chord per slot: half bars in 4/4) for a melody, best fit first */
  function chordPool(mel, colour) {
    return cached('cp' + JSON.stringify(mel) + colour, () => chordPaths(slotWeights(melodyNotes(mel), meterOf(mel)), mel.scale, colour));
  }
  /** chord paths that fit the notes weighed into W (slotWeights), best first, each differing from the others in 2+ slots (1 when there are only 2) */
  function chordPaths(W, scale, colour) {
    {
      const C = chordCands(scale);
      const S = W.map((ws) => C.map((c) => {
        let s = 0;
        ws.forEach((w, pc) => { if (w) s += c.pcs.includes(pc) ? w : -0.45 * w; });
        if (c.q === '°' || c.q === '+') s -= 1.2;
        if (c.colour) s += colour ? 0.4 : -0.9;
        return s;
      }));
      const N = C.length, K = W.length, all = [];
      // every path through the slots, in order (slot 0's chord changing slowest)
      const p = new Array(K).fill(0);
      for (;;) {
        if (!colour || p.some((i) => C[i].colour)) {
          let s = 0;
          for (let i = 0; i < K; i++) s += S[i][p[i]];
          s += C[p[0]].root === 0 && !C[p[0]].colour ? 1.5 : 0;
          for (let i = 1; i < K; i++) if (p[i] !== p[i - 1]) s -= 0.35;
          all.push({ p: p.slice(), s });
        }
        let k = K - 1;
        while (k >= 0 && p[k] === N - 1) { p[k] = 0; k--; }
        if (k < 0) break;
        p[k]++;
      }
      all.sort((x, y) => y.s - x.s);
      const diff = (x, y) => x.filter((v, i) => v !== y[i]).length;
      // with only two chords (3/4: one a bar) one new chord is already a new path
      const apart = K > 2 ? 2 : 1;
      const picked = [];
      for (const c of all) { if (picked.length >= 24) break; if (picked.every((q) => diff(q.p, c.p) >= apart)) picked.push(c); }
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
    }
  }
  /**
   * The chords other layers play against: the picked ones, a groove's bass
   * line's, what's under a riff (its home chord until then), or the melody's
   * best fit.
   */
  function chordsFor(idea) {
    const L = idea.layers;
    if (L.chords) return L.chords.chords;
    if (L.gbass) return L.gbass.chords;
    if (L.under && L.under.chords) return L.under.chords;
    if (pathOf(idea) === 'riff') { const home = chordCands(scaleOf(idea))[0]; return slotsOf(ideaMeter(idea)).map(() => home); }
    return chordPool(idea.melody, false)[0].chords;
  }

  // ---------------------------------------------------------------- three ways in: which path, and what an idea is made of

  function pathOf(idea) { return idea && PATHS[idea.path] ? idea.path : 'melody'; }
  function isOpening(idea, dir) { return PATHS[pathOf(idea)].open.indexOf(dir) >= 0; }
  /** has this first-screen been picked */
  function hasOpen(idea, d) {
    if (d === 'seed1') return !!idea.melody;
    if (d === 'seed2') return !!(idea.melody && idea.melody.shape);
    if (d === 'rrhythm') return !!idea.riff;
    if (d === 'rnotes') return !!(idea.riff && idea.riff.notes);
    if (d === 'weight') return !!(idea.riff && idea.riff.weight);
    return !!idea.layers[d];
  }
  /** the path's first screens are all picked: the idea exists */
  function isDone(idea) { const o = PATHS[pathOf(idea)].open; return hasOpen(idea, o[o.length - 1]); }
  function isStarted(idea) { return hasOpen(idea, PATHS[pathOf(idea)].open[0]); }
  /** the idea's meter; in one of its first rounds, the auditioned option's (aud = { dir, spec }) */
  function ideaMeter(idea, aud) {
    const T = Odd.theory, sp = aud && aud.spec;
    if (sp && sp.mel) return meterOf(sp.mel);
    if (sp && aud.dir === 'rrhythm') return T.meter(sp.r.m);
    if (sp && aud.dir === 'pocket') return T.meter(sp.m);
    if (idea.riff) return T.meter(idea.riff.r.m);
    if (idea.layers && idea.layers.pocket) return T.meter(idea.layers.pocket.m);
    return meterOf(idea.melody);
  }
  function scaleOf(idea) {
    const p = pathOf(idea);
    if (p === 'riff') return (idea.riff && idea.riff.scale) || 'minor';
    if (p === 'groove') return idea.layers.gbass ? idea.layers.gbass.scale : 'minor';
    return idea.melody ? idea.melody.scale : 'major';
  }
  /** the hook a groove grew (a melody with its shape), or null */
  function hookOf(idea) { return pathOf(idea) === 'groove' && idea.layers.hook ? idea.layers.hook.mel : null; }
  /**
   * What the later layers are made against: the melody, the riff, or a
   * groove's bass line (its kick, before there is one). [{ s, d, w, m }]
   */
  function refNotes(idea) {
    const p = pathOf(idea);
    if (p === 'riff') return idea.riff ? riffNotes(idea.riff) : [];
    if (p === 'groove') {
      const L = idea.layers;
      if (!L.pocket) return [];
      const kick = {};
      L.pocket.k.forEach((s) => { kick[s] = 1; });
      if (L.gbass) return L.gbass.notes.map((n) => ({ s: n.s, d: n.d, w: kick[n.s] ? 2 : 1, m: n.m }));
      const end = 2 * ideaMeter(idea).steps;
      return L.pocket.k.map((s, i, a) => ({ s, d: Math.min(4, (i + 1 < a.length ? a[i + 1] : end) - s), w: 2, m: 36 }));
    }
    return idea.melody && idea.melody.shape ? melodyNotes(idea.melody) : [];
  }
  function dirSub(idea, d) { const s = SUBS[pathOf(idea)]; return (s && s[d]) || DIRS[d].sub; }
  /** a round's own way out (the plain walk, no chords): its button, or '' */
  function ownLabel(dir) { return OWN[dir] ? OWN[dir][0] : ''; }

  // ---------------------------------------------------------------- the other layers, each made against the melody

  function coverage(notes, total) {
    const covered = new Array(total).fill(false);
    notes.forEach((n) => { for (let t = n.s; t < Math.min(total, n.s + n.d); t++) covered[t] = true; });
    return covered;
  }
  function onsetsOf(notes) { const o = {}; notes.forEach((n) => { o[n.s] = 1; }); return o; }
  /** every eighth note of both bars */
  function evensOf(total) { return Array.from({ length: total / 2 }, (_, i) => i * 2); }

  // ---------------------------------------------------------------- the later layers, from ingredients
  //
  // Each layer's pool is every sensible mix of a few ingredients, worked out
  // from the melody, the chords and the meter (bass: a job x its notes x held
  // or short; pads: a rhythm x a voicing x an instrument; percussion: an
  // instrument x a pattern; beats: a kick x a snare x hats). Mixes that come
  // out as the same notes merge, the first name found keeping it.

  /** options whose content is the same merge into the first: key(o) names the content */
  function unique(list, key) {
    const seen = {};
    return list.filter((o) => { const k = key(o); if (seen[k]) return false; seen[k] = 1; return true; });
  }
  /** a sorted list of steps, each lasting until the next (the last until `end`) */
  function until(ss, end) {
    const xs = ss.filter((x, i) => ss.indexOf(x) === i).sort((a, b) => a - b);
    return xs.map((x, i) => ({ s: x, d: (i + 1 < xs.length ? xs[i + 1] : end) - x }));
  }
  /** in each group of the meter (both bars), a note every three 16ths: 3+3+2 in a group of 8 */
  function dottedOf(m) {
    const out = [];
    for (let bar = 0; bar < 2; bar++) m.groupStarts.forEach((g, j) => {
      const end = j + 1 < m.groupStarts.length ? m.groupStarts[j + 1] : m.steps;
      for (let x = g; x < end; x += 3) if (end - x >= 2) out.push(bar * m.steps + x);
    });
    return out;
  }
  /** the stretches where the melody rests: [[start, length]] */
  function gapsOf(notes, total) {
    const covered = coverage(notes, total), out = [];
    for (let t = 0; t < total; t++) if (!covered[t] && (t === 0 || covered[t - 1])) { let e = t; while (e < total && !covered[e]) e++; out.push([t, e - t]); }
    return out;
  }

  // a bass's job: when it plays. [id, name, can it be short]
  const BASS_JOBS = [['lock', 'Locks on', 1], ['double', 'Every note with it', 1], ['steady', 'Steady', 1], ['pedal', 'Long pedal', 0], ['pulse', 'On every beat', 1],
    ['eighths', 'Driving eighths', 0], ['offbeat', 'Off-beat', 0], ['push', 'Pushing ahead', 1], ['dotted', 'Dotted', 1], ['gaps', 'Fills the gaps', 1], ['answer', 'Answers back', 0]];
  // and which notes: [id, words]
  const BASS_NOTES = [['root', ''], ['fifth', 'root and fifth'], ['oct', 'octaves'], ['tones', 'chord tones'], ['lead', 'leading in']];

  function bassStyles(idea) {
    const m = ideaMeter(idea), STEPS = 2 * m.steps, slots = slotsOf(m);
    const notes = melodyNotes(idea.melody), chords = chordsFor(idea);
    const si = (s) => slotAt(slots, s);
    const ch = (s) => chords[si(s)];
    const root = (s) => 36 + ch(s).root;
    const tone = (s, k) => { const c = ch(s); return 36 + c.root + mod(c.pcs[k % c.pcs.length] - c.root, 12); };
    const gaps = gapsOf(notes, STEPS), evens = evensOf(STEPS), beats = beatsOf(m), last = m.pulses.length - 1;
    // each job's notes: [{ s, d, c }] (c: where its chord is read, when that isn't s)
    const jobs = {
      lock: notes.filter((n) => n.w >= 1).map((n) => ({ s: n.s, d: Math.min(n.d, 4) })),
      double: notes.map((n) => ({ s: n.s, d: Math.min(n.d, 3) })),
      steady: slots.map((sl) => ({ s: sl.s, d: sl.len - 1 })),
      pedal: [0, m.steps].map((x) => ({ s: x, d: m.steps - 1 })),
      pulse: beats.map((b) => ({ s: b.s, d: b.len })),
      eighths: evens.map((x) => ({ s: x, d: 2 })),
      offbeat: evens.filter((x) => !onPulse(m, x)).map((x) => ({ s: x, d: 2 })),
      // each chord comes in an eighth early
      push: slots.map((sl, i) => (i === 0 ? { s: 0, d: sl.len - 2 } : { s: sl.s - 2, d: sl.len, c: sl.s })),
      dotted: until(dottedOf(m), STEPS).map((x) => ({ s: x.s, d: Math.min(x.d, 3) })),
      gaps: gaps.filter((g) => g[1] >= 2).map((g) => ({ s: g[0], d: Math.min(g[1], 4) })),
      answer: [].concat.apply([], gaps.filter((g) => g[1] >= 3).map((g) => { const out = []; for (let t = g[0]; t < g[0] + g[1]; t += 2) out.push({ s: t, d: 2 }); return out; })),
    };
    jobs.push = jobs.push.map((x) => Object.assign(x, { d: Math.min(x.d, STEPS - x.s) }));
    /** the pitch of each note: its place among the notes on the same chord picks it */
    const pitched = (list, how) => {
      const n = list.map((x) => ({ s: x.s, d: x.d, c: x.c == null ? x.s : x.c }));
      return n.map((x, i) => {
        const k = n.filter((y, j) => j < i && si(y.c) === si(x.c)).length;
        const lastOnChord = !n.some((y, j) => j > i && si(y.c) === si(x.c)) && k > 0;
        const r = root(x.c);
        let p = r;
        if (how === 'fifth') p = k % 2 ? r + 7 : r;
        else if (how === 'oct') p = onPulse(m, x.s) ? r : r + 12;
        else if (how === 'tones') p = tone(x.c, k);
        else if (how === 'lead' && lastOnChord) {
          // a half step into the next chord's root
          const nr = 36 + chords[(si(x.c) + 1) % chords.length].root;
          if (nr !== r) p = nr > r ? nr - 1 : nr + 1;
        }
        return { s: x.s, d: x.d, m: p };
      });
    };
    const out = [];
    BASS_JOBS.forEach(([job, name, canShort]) => {
      const list = jobs[job];
      if (!list.length) return;
      BASS_NOTES.forEach(([how, words]) => [0, 1].forEach((short) => {
        if (short && !canShort) return;
        const ns = pitched(list, how).map((x) => (short ? Object.assign(x, { d: 1 }) : x));
        const tag = job === 'eighths' && how === 'oct' ? 'Bouncing octaves' : name;
        out.push({ id: job + '-' + how + (short ? '-short' : ''), fam: job, twist: (how === 'root' ? 0 : 1) + short, tag, detail: [words, short ? 'short' : ''].filter(Boolean).join(', '), notes: ns });
      }));
    });
    // walking: a chord tone on each beat, and a half step below the next bar's root on the last one
    out.push({ id: 'walk', tag: 'Walking', detail: '', notes: beats.map((b) => ({ s: b.s, d: b.len, m: b.k === last ? root(b.s + b.len) - 1 : tone(b.s, b.k % 3) })) });
    const onsets = onsetsOf(notes);
    // a bass line needs at least a note a bar
    return unique(out.filter((x) => x.notes.length >= 2), (x) => JSON.stringify(x.notes))
      .map((x) => Object.assign(x, { lock: Math.round(100 * x.notes.filter((n) => onsets[n.s]).length / x.notes.length) / 100, n: x.notes.length }));
  }

  // pads: when they play, how the chord is voiced, and on what
  const PAD_RHYTHMS = [['held', 'Held chords'], ['breath', 'Breathing'], ['stabs', 'Off-beat stabs'], ['pulse', 'On the beats'], ['push', 'Pushed ahead'], ['accents', 'On its accents']];
  const PAD_VOICINGS = [['one', 'one note'], ['two', 'two notes'], ['three', 'triad'], ['open', 'open fifths'], ['wide', 'wide']];
  const PAD_INST = { pad: 'warm pad', strings: 'strings', glass: 'glass', voice: 'e-piano' };

  function padStyles(idea) {
    const notes = refNotes(idea), chords = chordsFor(idea), sc = scaleOf(idea);
    const m = ideaMeter(idea), slots = slotsOf(m), STEPS = 2 * m.steps;
    const tune = pathOf(idea) === 'melody' ? idea.melody : hookOf(idea), tuneNotes = tune ? melodyNotes(tune) : [];
    const ch = (s) => chords[slotAt(slots, s)];
    const voiced = (c, base) => c.pcs.map((pc) => base + mod(pc - base, 12));
    const VOICE = {
      one: (c, hi) => [(hi ? 72 : 60) + mod(c.pcs[1] - (hi ? 72 : 60), 12)],
      two: (c, hi) => [c.pcs[1], c.pcs[2]].map((pc) => (hi ? 72 : 60) + mod(pc, 12)),
      three: (c, hi) => voiced(c, hi ? 67 : 55),
      open: (c, hi) => { const r = (hi ? 60 : 48) + c.root; return [r, r + 7, r + 12]; },
      wide: (c) => [48 + c.root].concat(voiced(c, 55), [67 + mod(c.pcs[2] - 7, 12)]),
    };
    const evens = evensOf(STEPS), beats = beatsOf(m);
    const accents = notes.filter((n) => n.w === 2).map((n) => n.s);
    const RH = {
      held: slots.map((sl) => ({ s: sl.s, d: sl.len })),
      breath: slots.map((sl) => ({ s: sl.s, d: Math.ceil(sl.len / 2) })),
      stabs: evens.filter((x) => !onPulse(m, x)).map((x) => ({ s: x, d: 1 })),
      pulse: beats.map((b) => ({ s: b.s, d: b.len - 1 })),
      push: slots.map((sl, i) => (i === 0 ? { s: 0, d: sl.len - 2 } : { s: sl.s - 2, d: Math.min(sl.len, STEPS - sl.s + 2), c: sl.s })),
      accents: until(accents, STEPS),
    };
    const out = [];
    PAD_RHYTHMS.forEach(([rh, name]) => {
      if (!RH[rh].length) return;
      PAD_VOICINGS.forEach(([v, words]) => [0, 1].forEach((hi) => {
        if (hi && (v === 'wide' || !/held|breath|stabs/.test(rh))) return;
        // held chords come on every instrument; the rest on the one that suits them
        const insts = rh === 'held' ? ['pad', 'strings', 'glass', 'voice'] : [rh === 'stabs' || rh === 'pulse' ? 'voice' : hi ? 'glass' : v === 'wide' ? 'strings' : 'pad'];
        insts.forEach((inst) => out.push({
          id: rh + '-' + v + (hi ? '-hi' : '') + '-' + inst, fam: rh, twist: (v === 'three' ? 0 : 1) + hi + (inst === insts[0] ? 0 : 1), tag: name, voice: inst, detail: words + (hi ? ', high' : '') + ' · ' + PAD_INST[inst],
          notes: RH[rh].map((x) => ({ s: x.s, d: x.d, ms: VOICE[v](ch(x.c == null ? x.s : x.c), hi) })),
        }));
      }));
    });
    // lines that move with the melody (when there is one), and drones under it
    if (tuneNotes.length) {
      const ts = tune.scale;
      out.push(
        { id: 'shadow', tag: 'Shadow voice', voice: 'voice', detail: 'a third below', notes: tuneNotes.map((n) => ({ s: n.s, d: n.d, ms: [degMidi(ts, n.deg - 2)] })) },
        { id: 'above', tag: 'Harmony above', voice: 'voice', detail: 'a third above', notes: tuneNotes.map((n) => ({ s: n.s, d: n.d, ms: [degMidi(ts, n.deg + 2)] })) },
        { id: 'sixth', tag: 'Harmony below', voice: 'voice', detail: 'a sixth below', notes: tuneNotes.map((n) => ({ s: n.s, d: n.d, ms: [degMidi(ts, n.deg - 5)] })) },
      );
    }
    out.push(
      { id: 'drone', tag: 'One quiet drone', voice: 'pad', detail: 'the home note', notes: [{ s: 0, d: STEPS, ms: [60 + chords[0].root] }] },
      { id: 'fifths', tag: 'Open drone', voice: 'strings', detail: 'home and its fifth', notes: [{ s: 0, d: STEPS, ms: [48 + chords[0].root, 55 + chords[0].root] }] },
    );
    return unique(out, (x) => x.voice + JSON.stringify(x.notes)).map((x) => {
      const tot = x.notes.reduce((a, n) => a + n.d, 0) || 1;
      const voices = x.notes.reduce((a, n) => a + n.ms.length * n.d, 0) / tot;
      const reg = x.notes.reduce((a, n) => a + n.ms.reduce((b, mm) => b + mm, 0) / n.ms.length, 0) / x.notes.length;
      return Object.assign(x, { voices: Math.round(voices * 10) / 10, reg });
    });
  }

  /** steps in bar terms, repeated in both bars */
  function bothBars(m, xs) { return xs.concat(xs.map((x) => x + m.steps)); }

  // hand percussion: [id, name, high sound, low sound (on the strong beats) or none]
  const PERC_INST = [['clap', 'Claps', 'clap'], ['tap', 'Woodblock', 'tap', 'tapLo'], ['shaker', 'Shaker', 'shaker'], ['tamb', 'Tambourine', 'tamb'], ['rim', 'Rimshot', 'rim'],
    ['cowbell', 'Cowbell', 'cowbell'], ['conga', 'Congas', 'conga', 'congaLo'], ['bongo', 'Bongos', 'bongo', 'bongoLo'], ['claves', 'Claves', 'claves'],
    ['agogo', 'Agogô', 'agogo', 'agogoLo'], ['guiro', 'Guiro', 'guiro'], ['tri', 'Triangle', 'tri']];
  // where they play, and which instruments suit it
  const PERC_PATTERNS = [
    ['accents', 'on its accents', 'clap conga cowbell tamb rim bongo claves'], ['backs', 'on the backbeat', 'clap rim tamb tap claves cowbell'],
    ['beats', 'on every beat', 'clap tap cowbell conga rim claves tri'], ['eighths', 'in eighths', 'shaker tamb cowbell agogo conga bongo claves tap tri rim'],
    ['offs', 'off the beat', 'tamb shaker cowbell tri rim tap agogo clap'], ['sixteenths', 'in sixteenths', 'shaker tamb guiro bongo'],
    ['melody', 'with the melody', 'tap conga bongo claves rim agogo'], ['gaps', 'in the gaps', 'conga bongo tap shaker claves'],
    ['dotted', 'dotted', 'claves rim cowbell conga tap agogo'], ['clave', 'in a clave', 'claves rim tap cowbell'],
  ];
  // a shaker, tambourine, guiro or triangle keeping time can have claps on the backbeat too
  const PERC_LAYER = ['shaker', 'tamb', 'guiro', 'tri'];

  function percStyles(idea) {
    const notes = refNotes(idea), lead = { melody: 'the melody', groove: 'the bass', riff: 'the riff' }[pathOf(idea)];
    const m = ideaMeter(idea), STEPS = 2 * m.steps;
    const evens = evensOf(STEPS), backs = bothBars(m, backsOf(m)), pulses = bothBars(m, m.pulses.map((p) => p.s));
    const strong = (s) => m.groupStarts.indexOf(mod(s, m.steps)) >= 0;
    const covered = coverage(notes, STEPS);
    const P = {
      accents: notes.filter((n) => n.w === 2).map((n) => ({ s: n.s, v: 1 })),
      backs: backs.map((x) => ({ s: x, v: 1 })),
      beats: pulses.map((x) => ({ s: x, v: strong(x) ? 1 : 0.8 })),
      eighths: evens.map((x) => ({ s: x, v: onPulse(m, x) ? 1 : 0.6 })),
      offs: evens.filter((x) => !onPulse(m, x)).map((x) => ({ s: x, v: 0.85 })),
      sixteenths: Array.from({ length: STEPS }, (_, x) => ({ s: x, v: onPulse(m, x) ? 1 : x % 2 ? 0.5 : 0.8 })),
      melody: notes.map((n) => ({ s: n.s, v: [0.5, 0.75, 1][n.w] })),
      gaps: evens.filter((x) => !covered[x]).map((x) => ({ s: x, v: 0.7 })),
      dotted: dottedOf(m).map((x) => ({ s: x, v: strong(x) ? 1 : 0.8 })),
      // son clave, 3 then 2: only where the bar is four beats long
      clave: m.id === '4/4' ? [0, 6, 12, 20, 24].map((x) => ({ s: x, v: 1 })) : [],
    };
    const out = [];
    PERC_PATTERNS.forEach(([pat, words, fits]) => {
      if (!P[pat].length) return;
      fits.split(' ').forEach((iid) => {
        const inst = PERC_INST.find((x) => x[0] === iid);
        const hits = P[pat].map((h) => ({ s: h.s, k: inst[3] && strong(h.s) ? inst[3] : inst[2], v: h.v }));
        const tag = inst[1] + ' ' + words.replace('the melody', lead);
        out.push({ id: iid + '-' + pat, fam: iid, tag, detail: '', hits });
        if (PERC_LAYER.indexOf(iid) >= 0 && /eighths|offs|sixteenths/.test(pat)) {
          const claps = pat === 'sixteenths' ? P.accents : P.backs;
          if (claps.length) out.push({ id: iid + '-' + pat + '-claps', fam: iid, twist: 1, tag, detail: '+ claps', hits: hits.concat(claps.map((h) => ({ s: h.s, k: 'clap', v: 1 }))) });
        }
      });
    });
    // the woodblock counts the groups and the claps answer
    out.push({ id: 'tapclap', tag: 'Tap, clap', detail: '', hits: bothBars(m, m.groupStarts).map((x) => ({ s: x, k: 'tap', v: 1 })).concat(backs.map((x) => ({ s: x, k: 'clap', v: 1 }))) });
    const onsets = onsetsOf(notes);
    return unique(out.filter((x) => x.hits.length), (x) => JSON.stringify(x.hits.slice().sort((a, b) => a.s - b.s || (a.k < b.k ? -1 : 1))))
      .map((x) => Object.assign(x, { n: x.hits.length, follow: x.hits.filter((h) => onsets[h.s]).length / x.hits.length }));
  }

  // beats: a kick pattern, where the snare goes, and the hats. Every meter has its own kicks and
  // snares, in 16ths: [id, name, bar one, bar two (when it differs), what else suits it]
  // (r: ride and beat hats, l: a late snare, s: swing; 6/8 and 7/8 already move in threes, so never swing)
  const KICKS = {
    '4/4': [['four', 'Four on the floor', [0, 4, 8, 12]], ['rock', 'Straight rock', [0, 8], null, 'rs'], ['rockpush', 'Rock, pushed', [0, 8, 10], null, 'r'],
      ['back', 'Backbeat', [0, 10], null, 'rs'], ['boombap', 'Boom bap', [0, 7, 10], null, 'ls'], ['broken', 'Broken', [0, 6, 10], [3, 6], 'ls'], ['half', 'Half-time kick', [0, 11, 14], [6]],
      ['bounce', 'Bouncing kick', [0, 3, 8, 11], null, 'l'], ['tresillo', 'Tresillo kick', [0, 6, 12]], ['pushing', 'Pushing kick', [0, 8, 14], null, 'l'], ['one', 'Kick on the one', [0], null, 'rs']],
    // ONE two three
    '3/4': [['one', 'Kick on the one', [0], null, 'rs'], ['onethree', 'One and three', [0, 8], null, 'rs'], ['drive', 'Driving', [0, 4, 8], null, 'r'],
      ['lilt', 'Lilting kick', [0, 6], null, 'ls'], ['push', 'Pushing kick', [0, 10], null, 'l'], ['skip', 'Skipping kick', [0, 3, 8], null, 'ls'],
      ['float', 'Floating kick', [0], [0, 6], 'rs'], ['answer', 'Kick and answer', [0], [0, 6, 10], 'l'], ['long', 'Two-bar kick', [0, 8], [0]],
      ['hemiola', 'Hemiola: three across two', [0, 8], [4], 'r']],
    // ONE-and-a TWO-and-a
    '6/8': [['one', 'Kick on the one', [0], null, 'r'], ['both', 'Both big beats', [0, 6], null, 'r'], ['lean', 'Leaning kick', [0, 4], null, 'l'],
      ['push', 'Pushing kick', [0, 10], null, 'l'], ['gallop', 'Galloping', [0, 4, 6]], ['roll', 'Rolling kick', [0, 2, 6, 8]],
      ['dotted', 'Dotted kick', [0, 3, 6, 9]], ['shuffle', 'Long-short kick', [0, 4, 6, 10], null, 'l'], ['answer', 'Kick and answer', [0], [0, 4, 10], 'r'],
      ['tumble', 'Tumbling', [0, 10], [4, 6], 'l']],
    // ONE two three FOUR five
    '5/4': [['one', 'Kick on the one', [0], null, 'rs'], ['groups', 'Three then two', [0, 12], null, 'rs'], ['twothree', 'Two then three', [0, 8], null, 'rs'],
      ['drive', 'Driving', [0, 4, 8, 12, 16], null, 'r'], ['push', 'Pushing kick', [0, 12, 18], null, 'l'], ['lean', 'Leaning kick', [0, 10], null, 'ls'],
      ['boombap', 'Boom bap five', [0, 7, 12], null, 'ls'], ['dotted', 'Dotted kick', [0, 6, 12]], ['answer', 'Kick and answer', [0, 12], [0, 8, 14], 'l'],
      ['broken', 'Broken', [0, 6, 12], [2, 10], 'l']],
    // short, short, long
    '7/8': [['one', 'Kick on the one', [0], null, 'r'], ['groups', 'Every group', [0, 4, 8], null, 'r'], ['ends', 'Short, short, long', [0, 8], null, 'r'],
      ['lean', 'Leaning kick', [0, 6], null, 'l'], ['push', 'Pushing kick', [0, 12], null, 'l'], ['double', 'Double kick', [0, 2, 8]],
      ['rolling', 'Rolling into the long', [0, 8, 12], null, 'l'], ['threetwo', 'Three, two, two', [0, 6, 10], null, 'r'],
      ['answer', 'Kick and answer', [0, 8], [0, 4, 10], 'l']],
  };
  // snares: the plain one ('back') and a second ('half') go with every kick; the rest come with 8th hats
  const SNARES = {
    '4/4': { back: ['backbeat', [4, 12]], half: ['half-time', [8]] },
    '3/4': { back: ['snare on 2 and 3', [4, 8]], half: ['snare on 3', [8]], two: ['snare on 2', [4]], wide: ['half-time', [], [0]] },
    '6/8': { back: ['backbeat', [6]], half: ['half-time', [], [6]], jig: ['snare on 3 and 6', [4, 10]], pickup: ['snare and pickup', [6, 10]] },
    '5/4': { back: ['snare on 3 and 5', [8, 16]], half: ['snare on 4', [12]], twofive: ['snare on 2 and 5', [4, 16]] },
    '7/8': { back: ['snare on 3 and 6', [4, 10]], half: ['snare on 5', [8]], two: ['snare on 3', [4]] },
  };
  const HATS = [['e8', '8ths'], ['s16', '16ths'], ['off', 'open off-beats'], ['ride', 'ride'], ['q', 'quarter hats']];
  const HAT_P = { e8: 42, s16: 42, off: 46, ride: 51, q: 42 };

  function kitsFor(m) {
    const bars = (a, b) => a.concat((b || a).map((x) => x + m.steps));
    const B = (xs) => bothBars(m, xs);
    const pulses = m.pulses.map((p) => p.s);
    const eighths = evensOf(m.steps), offs = eighths.filter((s) => !onPulse(m, s));
    const kicks = (KICKS[m.id] || KICKS['4/4']).map(([id, tag, a, b, fit]) => ({ id, tag, k: bars(a, b), fit: fit || '' }));
    const SN = {};
    Object.keys(SNARES[m.id] || SNARES['4/4']).forEach((id) => { const [words, a, b] = SNARES[m.id][id]; SN[id] = { words, s: bars(a, b) }; });
    // the last snare of the second bar comes a 16th late
    const bk = SN.back.s;
    SN.late = { words: 'late snare', s: bk.map((x, i) => (i === bk.length - 1 ? x + 1 : x)) };
    const hatWord = (hat) => (hat === 'q' && m.id !== '4/4' ? 'hats on the beat' : HATS.find((x) => x[0] === hat)[1]);
    const H = { e8: B(eighths), s16: Array.from({ length: 2 * m.steps }, (_, i) => i), off: B(offs.length ? offs : eighths), ride: B(eighths), q: B(pulses) };
    const out = [];
    const add = (kk, sn, hat, swing) => {
      out.push({ id: kk.id + '-' + sn + '-' + hat + (swing ? '-swung' : ''), fam: kk.id, twist: (hat === 'e8' ? 0 : 1) + (swing ? 1 : 0), tag: kk.tag, detail: (sn === 'back' ? '' : SN[sn].words + ' · ') + hatWord(hat), k: kk.k, s: SN[sn].s, h: H[hat], hp: HAT_P[hat], swing: swing ? 0.6 : 0 });
    };
    const extra = Object.keys(SN).filter((id) => !/^(back|half|late)$/.test(id));
    kicks.forEach((kk) => {
      ['e8', 's16', 'off'].forEach((hat) => { add(kk, 'back', hat); add(kk, 'half', hat); });
      extra.forEach((sn) => add(kk, sn, 'e8'));
      if (kk.fit.includes('r')) { add(kk, 'back', 'ride'); add(kk, 'back', 'q'); }
      if (kk.fit.includes('l')) add(kk, 'late', 'e8');
      if (!m.compound && kk.fit.includes('s')) add(kk, 'back', 'e8', 1);
    });
    return unique(out, (x) => JSON.stringify([x.k, x.s, x.h, x.hp, x.swing])).map((x) => {
      const ks = x.k.concat(x.s);
      return Object.assign(x, { off: ks.filter((s) => !onPulse(m, s)).length / Math.max(1, ks.length) + x.swing * 0.5, n: x.k.length + x.s.length + x.h.length });
    });
  }

  // ---------------------------------------------------------------- a groove: the pocket, a bass line that sets the chords, chords on top
  //
  // A groove starts with no melody. The pocket is a beat at a tempo (the
  // meter's beat deck, each at the speed its kick suits); the bass is made
  // against its kick and picks the harmony as it goes; the chords on top
  // play what the bass implies.

  // where each kick tends to sit, in BPM (16th hats, a half-time snare, swing and Slower/Faster move it)
  const POCKET_BPM = {
    four: 122, rock: 112, rockpush: 108, back: 96, boombap: 88, broken: 132, half: 74, bounce: 100, tresillo: 104, pushing: 116, one: 92,
    onethree: 96, drive: 128, lilt: 92, push: 100, skip: 104, float: 84, answer: 96, long: 80, hemiola: 108,
    both: 108, lean: 96, gallop: 120, roll: 112, dotted: 104, shuffle: 92, tumble: 100,
    groups: 116, twothree: 108, ends: 120, double: 128, rolling: 112, threetwo: 116,
  };
  function pocketStyles(m, st) {
    const t = st.t || 0, swingIt = st.x === 'swing' && !m.compound;
    const out = kitsFor(m).map((k) => {
      let bpm = POCKET_BPM[k.fam] || 100;
      if (/-half-/.test(k.id)) bpm *= 1.2; // half-time feels slow, so it can run faster
      if (k.h.length >= 2 * m.steps) bpm *= 0.86; // 16th hats sit best a little slower
      if (k.swing) bpm *= 0.92;
      bpm = Math.max(56, Math.min(180, 2 * Math.round(bpm * Math.pow(1.12, t) / 2)));
      const swung = swingIt && !k.swing;
      return Object.assign({}, k, { id: k.id + (swung ? '-swung' : ''), m: m.id, bpm, swing: swung ? 0.6 : k.swing, off: k.off + (swung ? 0.3 : 0) });
    });
    return unique(out, (x) => JSON.stringify([x.k, x.s, x.h, x.hp, x.swing]));
  }

  const GROOVE_SCALES = ['phrygian', 'minor', 'mpenta', 'dorian', 'blues', 'mixolydian', 'major']; // dark to bright
  // how the harmony moves over the two bars, a scale degree per half bar (meters with a chord a bar take every other one)
  const MOVES = [
    ['stay', [0, 0, 0, 0]], ['sway7', [0, 0, 6, 6]], ['sway4', [0, 0, 3, 3]], ['sway6', [0, 0, 5, 5]],
    ['turn', [0, 0, 0, 6]], ['rock', [0, 3, 0, 3]], ['loop', [0, 6, 5, 6]], ['loop4', [0, 5, 3, 4]],
  ];
  // a groove bass's job: when it plays, against the kick
  const GBASS_JOBS = [['lock', 'Locks to the kick'], ['short', 'Short, with the kick'], ['pump', 'Pumping eighths'], ['offs', 'Off-beat'], ['octpop', 'Octave pops'],
    ['answer', 'Answers the kick'], ['fill', 'Plays between the kicks'], ['sync', 'Syncopated'], ['walk', 'Walking'], ['long', 'Long notes'], ['push', 'Pushes the changes']];
  /** chord names along a path, each change once */
  function chordLine(chords) { return chords.map(chordName).filter((x, i, a) => i === 0 || x !== a[i - 1]).join(' '); }

  /**
   * Bass lines for a groove, each also picking the harmony: a job (when it
   * plays against the kick) x how the chords move x a scale. The scales take
   * turns so the deck spans dark to bright; Darker and Brighter (steer.c)
   * narrow them.
   */
  function grooveBass(idea, st) {
    const pk = idea.layers.pocket, m = ideaMeter(idea), STEPS = 2 * m.steps, slots = slotsOf(m), K = slots.length;
    const c = (st && st.c) || 0;
    let scales = GROOVE_SCALES.slice();
    if (c < 0) scales = scales.slice(0, c <= -2 ? 2 : 4);
    if (c > 0) scales = scales.slice(c >= 2 ? 5 : 3);
    const kicks = pk.k.slice().sort((a, b) => a - b), isKick = {};
    kicks.forEach((s) => { isKick[s] = 1; });
    const nextKick = (s) => { const n = kicks.find((x) => x > s); return n == null ? STEPS : n; };
    const evens = evensOf(STEPS), beats = beatsOf(m), last = m.pulses.length - 1;
    const near = (s) => isKick[s] || isKick[s - 1] || isKick[s + 1];
    // each job's notes: [{ s, d, c (where its chord is read), up (an octave up), tone, lead (into the next chord) }]
    const jobs = {
      lock: kicks.map((s) => ({ s, d: Math.min(4, nextKick(s) - s) })),
      short: kicks.map((s) => ({ s, d: 1 })),
      pump: evens.map((s) => ({ s, d: 2 })),
      offs: evens.filter((s) => !onPulse(m, s)).map((s) => ({ s, d: 2 })),
      octpop: evens.map((s) => ({ s, d: 1, up: !onPulse(m, s) })),
      answer: [].concat.apply([], kicks.map((s) => [{ s, d: 2 }].concat(s + 3 < Math.min(nextKick(s), STEPS) ? [{ s: s + 3, d: 1, up: true }] : []))),
      fill: evens.filter((s) => !near(s)).map((s) => ({ s, d: 2 })),
      sync: kicks.map((s) => ({ s, d: 2 })).concat(pk.s.filter((s) => s > 0 && !isKick[s - 1]).map((s) => ({ s: s - 1, d: 1 }))).sort((a, b) => a.s - b.s),
      walk: beats.map((b) => ({ s: b.s, d: b.len, tone: b.k % 3, lead: b.k === last })),
      long: slots.map((sl) => ({ s: sl.s, d: sl.len - 1 })),
      push: slots.map((sl, i) => (i === 0 ? { s: 0, d: sl.len - 2 } : { s: sl.s - 2, d: sl.len, c: sl.s })),
    };
    const si = (s) => slotAt(slots, s);
    const line = (list, chords, how) => list.map((x, i) => {
      const at = x.c == null ? x.s : x.c, ch = chords[si(at)], r = 36 + ch.root;
      let p = x.up ? r + 12 : r;
      if (how === 'fifth' && list.filter((y, j) => j < i && si(y.c == null ? y.s : y.c) === si(at)).length % 2) p = r + 7;
      if (x.tone != null) p = r + mod(ch.pcs[x.tone] - ch.root, 12);
      if (x.lead) { const nr = 36 + chords[(si(at) + 1) % chords.length].root; p = nr === r ? r + 7 : nr > r ? nr - 1 : nr + 1; }
      return { s: x.s, d: Math.max(1, Math.min(x.d, STEPS - x.s)), m: p };
    });
    const out = [];
    GBASS_JOBS.forEach(([job, name], ji) => {
      if (jobs[job].length < 2) return;
      MOVES.forEach(([mv, degs], mi) => {
        // the scales take turns; one whose chords there would be diminished passes to the next
        for (let k = 0; k < scales.length; k++) {
          const scale = scales[(ji * 3 + mi * 2 + k) % scales.length], cands = chordCands(scale);
          const chords = slots.map((_, i) => cands[degs[Math.floor(i * 4 / K)]]);
          if (chords.some((ch) => ch.q === '°' || ch.q === '+')) continue;
          ['root', 'fifth'].forEach((how) => {
            if (how === 'fifth' && !/^(lock|pump|long)$/.test(job)) return;
            out.push({ id: job + '-' + mv + '-' + scale + (how === 'fifth' ? '-5' : ''), fam: job, twist: how === 'fifth' ? 1 : 0, tag: name, detail: chordLine(chords) + ' · ' + MODE[scale].name.toLowerCase(), notes: line(jobs[job], chords, how), chords, scale, move: mv, c: GROOVE_SCALES.indexOf(scale) });
          });
          break;
        }
      });
    });
    return unique(out, (x) => JSON.stringify([x.notes, x.chords.map((ch) => ch.root + ch.q)]))
      .map((x) => Object.assign(x, { lock: Math.round(100 * x.notes.filter((n) => isKick[n.s]).length / x.notes.length) / 100, n: x.notes.length }));
  }

  // chords on top of a groove: when they play, how they're voiced, on what
  const KEY_RHYTHMS = [['held', 'Held chords'], ['breath', 'Breathing'], ['stabs', 'Off-beat stabs'], ['chank', '16th chank'], ['skank', 'On the backbeat'],
    ['kick', 'Stabs with the kick'], ['answer', 'Answers the kick'], ['push', 'Pushed ahead'], ['pulse', 'On every beat']];
  const KEY_VOICINGS = [['three', 'triad'], ['seven', 'sevenths'], ['shell', 'two notes'], ['open', 'open fifths']];
  const KEY_WORD = { epiano: 'e-piano', organ: 'organ', stab: 'synth stab', keys: 'soft keys', pluck: 'pluck' };
  const KEY_FIT = { held: 'epiano organ keys', breath: 'epiano keys', stabs: 'stab organ epiano', chank: 'keys pluck', skank: 'organ epiano', kick: 'stab epiano', answer: 'epiano pluck', push: 'epiano stab', pulse: 'keys organ' };
  const NO_CHORDS = { id: 'none', none: true, tag: 'No chords', detail: 'drums and bass are enough', voice: 'epiano', notes: [], n: 0, voices: 0 };

  function keysStyles(idea) {
    const pk = idea.layers.pocket, m = ideaMeter(idea), STEPS = 2 * m.steps, slots = slotsOf(m), chords = chordsFor(idea);
    const sc = parentScale(scaleOf(idea)), ch = (s) => chords[slotAt(slots, s)];
    const isKick = {};
    pk.k.forEach((s) => { isKick[s] = 1; });
    const voiced = (pcs, base) => pcs.map((pc) => base + mod(pc - base, 12));
    // the scale's 7th above the chord (a minor 7th for chords from outside it)
    const seventh = (c) => { const i = sc.indexOf(c.root); return i < 0 ? mod(c.root + 10, 12) : sc[(i + 6) % 7]; };
    const VOICE = {
      three: (c) => voiced(c.pcs, 57),
      seven: (c) => voiced(c.pcs.concat([seventh(c)]), 57),
      shell: (c) => voiced([c.pcs[1], seventh(c)], 60),
      open: (c) => [48 + c.root, 55 + c.root, 60 + c.root],
    };
    const evens = evensOf(STEPS), all = Array.from({ length: STEPS }, (_, x) => x);
    const RH = {
      held: slots.map((sl) => ({ s: sl.s, d: sl.len })),
      breath: slots.map((sl) => ({ s: sl.s, d: Math.ceil(sl.len / 2) })),
      stabs: evens.filter((x) => !onPulse(m, x)).map((x) => ({ s: x, d: 1 })),
      chank: all.filter((x) => !onPulse(m, x) && (x % 2 === 0 || x % 8 === 7)).map((x) => ({ s: x, d: 1 })),
      skank: bothBars(m, backsOf(m)).map((x) => ({ s: x, d: 2 })),
      kick: pk.k.map((x) => ({ s: x, d: 2 })),
      answer: evens.filter((x) => !isKick[x] && !isKick[x - 1] && !onPulse(m, x)).map((x) => ({ s: x, d: 1 })),
      push: slots.map((sl, i) => (i === 0 ? { s: 0, d: sl.len - 2 } : { s: sl.s - 2, d: Math.min(sl.len, STEPS - sl.s + 2), c: sl.s })),
      pulse: beatsOf(m).map((b) => ({ s: b.s, d: Math.max(1, b.len - 2) })),
    };
    const out = [];
    KEY_RHYTHMS.forEach(([rh, name]) => {
      if (RH[rh].length < 2) return;
      const insts = KEY_FIT[rh].split(' ');
      KEY_VOICINGS.forEach(([v, words]) => {
        if (v === 'open' && !/^(held|stabs|kick)$/.test(rh)) return;
        (v === 'three' ? insts : insts.slice(0, 1)).forEach((inst, ii) => out.push({
          id: rh + '-' + v + '-' + inst, fam: rh, twist: (v === 'three' ? 0 : 1) + (ii ? 1 : 0), tag: name, voice: inst, detail: words + ' · ' + KEY_WORD[inst],
          notes: RH[rh].map((x) => ({ s: x.s, d: x.d, ms: VOICE[v](ch(x.c == null ? x.s : x.c)) })),
        }));
      });
    });
    return unique(out, (x) => x.voice + JSON.stringify(x.notes)).map((x) => Object.assign(x, { n: x.notes.length, voices: x.notes[0].ms.length }));
  }

  /** hook rhythms for a groove, in its scale; clash: how many land where the bass or kick already hits */
  function hookStyles(idea) {
    const m = ideaMeter(idea), scale = scaleOf(idea), busy = {};
    refNotes(idea).forEach((n) => { busy[n.s] = 1; });
    idea.layers.pocket.k.forEach((s) => { busy[s] = 1; });
    return rhythmPool(m.id).map((r) => {
      const clash = Math.round(100 * r.hits.filter((h) => busy[h[0]]).length / r.n) / 100;
      return { a: r.n + 0.3 * r.off, b: clash, clash, mel: { r, scale, shape: null } };
    });
  }

  // ---------------------------------------------------------------- a riff: a rhythm with accents, its notes, its weight
  //
  // A riff is rhythm first: hits on one note, some hard (accents), some
  // muted, with rests that matter as much. Then the notes on that rhythm,
  // then who plays it and how thick. It usually is the harmony.

  // one beat of a riff: [start, length]; beats of three eighths (6/8, 7/8's long group) have their own
  const RCELLS = { chug: [[0, 2], [2, 2]], gallop: [[0, 2], [2, 1], [3, 1]], rgallop: [[0, 1], [1, 1], [2, 2]], sixteen: [[0, 1], [1, 1], [2, 1], [3, 1]], stab: [[0, 1]], hold: [[0, 4]], push: [[3, 1]], off: [[2, 2]], dot: [[0, 3], [3, 1]], rest: [] };
  const RCELLS6 = { chug: [[0, 2], [2, 2], [4, 2]], gallop: [[0, 2], [2, 1], [3, 1], [4, 2]], rgallop: [[0, 1], [1, 1], [2, 2], [4, 2]], sixteen: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]], stab: [[0, 1]], hold: [[0, 6]], push: [[5, 1]], off: [[2, 2], [4, 2]], dot: [[0, 4], [4, 2]], rest: [] };
  const RIFF_TAG = { chug: 'Chug', gallop: 'Gallop', rgallop: 'Reverse gallop', sixteen: 'Hammering 16ths', stab: 'Stabs and space', hold: 'Hits and holds', push: 'Pushing', off: 'Off the beat', dot: 'Dotted', threes: 'Accents in threes', stop: 'Stop-start' };

  /** where accents in threes fall across a bar: 3+3+2 in 16ths, or three against the beat in 3/4 and 6/8 */
  function threesOf(m) {
    if (m.id === '3/4') return [0, 3, 6, 9];
    if (m.id === '6/8') return [0, 4, 8];
    const out = [], pat = [3, 3, 2];
    for (let x = 0, i = 0; x < m.steps && m.steps - x >= 2; x += pat[i++ % 3]) out.push(x);
    return out;
  }
  /** a riff's accents, as [s, length, w]: w 2 hits hard, 1 a plain hit, 0 muted */
  function accentRiff(m, hits, threes) {
    const T3 = threes ? threesOf(m) : null;
    hits.forEach((h, i) => {
      const x = mod(h[0], m.steps), nx = hits[i + 1];
      if (T3) { h[2] = T3.indexOf(x) >= 0 ? 2 : 0; return; }
      // a lone 16th off the eighths pushes into what comes next
      const push = x % 2 === 1 && (!nx || nx[0] > h[0] + 1);
      h[2] = m.groupStarts.indexOf(x) >= 0 || push || h[1] >= 3 ? 2 : onPulse(m, x) ? 1 : 0;
    });
    return hits;
  }
  /** a 2-bar riff rhythm from density d, push y and rests (0..1); bar two repeats bar one, sometimes with a new ending */
  function makeRiff(seed, d, y, rest, mid) {
    const m = Odd.theory.meter(mid), R = rng(seed), beats = beatsOf(m), nb = m.pulses.length;
    const W = { chug: 1.2, gallop: 0.3 + 0.9 * d, rgallop: 0.5 * d, sixteen: 1.3 * d * d, stab: 0.3 + 0.8 * rest, hold: 0.5 * (1 - d), push: 0.8 * y, off: 0.7 * y, dot: 0.5, rest: 1.3 * rest };
    const first = { chug: 1, gallop: 0.4 + d, stab: 0.4 + rest, hold: 0.5 * (1 - d), sixteen: d * d, dot: 0.5 };
    const bar = [weighted(R, first)];
    for (let b = 1; b < nb; b++) bar.push(weighted(R, W));
    const turn = nb > 1 && R() < 0.35;
    const bar2 = bar.slice();
    if (turn) { const W2 = Object.assign({}, W); W2[bar[nb - 1]] = 0; bar2[nb - 1] = weighted(R, W2); }
    const hits = [];
    bar.concat(bar2).forEach((c, i) => { const bt = beats[i]; (bt.len === 6 ? RCELLS6 : RCELLS)[c].forEach((x) => hits.push([bt.s + x[0], Math.min(x[1], bt.len - x[0])])); });
    if (hits.length < 4) return null;
    const count = {};
    bar.forEach((c) => { if (c !== 'rest') count[c] = (count[c] || 0) + 1; });
    const gaps = bar.filter((c) => c === 'rest' || c === 'stab' || c === 'push').length;
    const fam = gaps * 2 >= nb && bar.indexOf('rest') >= 0 ? 'stop' : Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    return { hits: accentRiff(m, hits, false), fam, turn: turn && bar2[nb - 1] !== bar[nb - 1] };
  }
  /** accents in threes across the beat, muted 16ths between them as density d allows */
  function makeThrees(seed, d, mid) {
    const m = Odd.theory.meter(mid), R = rng(seed), acc = threesOf(m), bar = [];
    acc.forEach((a, j) => {
      const end = j + 1 < acc.length ? acc[j + 1] : m.steps;
      bar.push([a, d < 0.45 ? Math.min(2, end - a) : 1]);
      if (d >= 0.45) for (let x = a + 1; x < end; x++) if (R() < d) bar.push([x, 1]);
    });
    return { hits: accentRiff(m, bar.concat(bar.map((h) => [h[0] + m.steps, h[1]])), true), fam: 'threes', turn: false };
  }
  /** every riff rhythm for a meter: { id, m, hits, n, off (share of accents off the beat), fam, turn } */
  function riffPool(mid) {
    const m = Odd.theory.meter(mid);
    return cached('riffs' + m.id, () => {
      const seen = {}, out = [];
      const add = (x, i) => {
        if (!x) return;
        const key = JSON.stringify(x.hits);
        if (seen[key]) return;
        seen[key] = 1;
        const acc = x.hits.filter((h) => h[2] === 2);
        const off = acc.filter((h) => !onPulse(m, h[0])).length / Math.max(1, acc.length);
        out.push({ id: 'rf' + i + '@' + m.id, m: m.id, hits: x.hits, n: x.hits.length, off: Math.round(off * 100) / 100, fam: x.fam, turn: x.turn });
      };
      const DS = [0.1, 0.4, 0.7, 1], YS = [0, 0.5, 1], RS = [0, 0.4, 0.8];
      for (let i = 0; i < 72; i++) add(makeRiff(4001 + i * 6007, DS[i % 4], YS[Math.floor(i / 4) % 3], RS[Math.floor(i / 12) % 3], m.id), i);
      for (let i = 0; i < 8; i++) add(makeThrees(9001 + i * 31, [0.2, 0.5, 0.75, 0.9][i % 4], m.id), 100 + i);
      return out;
    });
  }
  function riffTag(r) { return RIFF_TAG[r.fam] || 'Riff'; }
  /**
   * A riff's notes as played: accents ring for their length, plain hits for
   * an eighth at most, muted ones a 16th. x: semitones above home; m: one
   * voice's pitch, for the layers made against it.
   */
  function riffNotes(riff) {
    const ms = riff.notes ? riff.notes.ms : null;
    return riff.r.hits.map((h, i) => ({ s: h[0], d: h[2] === 2 ? h[1] : h[2] === 1 ? Math.min(h[1], 2) : 1, w: h[2], x: ms ? ms[i] : 0, m: 48 + (ms ? ms[i] : 0) }));
  }

  const RIFF_SCALES = ['phrygian', 'harmonic', 'minor', 'blues', 'mpenta', 'dorian', 'mixolydian', 'penta', 'major']; // dark to bright
  // the notes on a riff's rhythm: [id, name, words, the scales it suits (the first keeps notes they share), outside the scale on purpose]
  const RIFF_NOTES = [
    ['pedal', 'Pedal', 'hammers the root and flicks up on the accents', 'minor phrygian mixolydian'],
    ['fifth', 'Root and fifth', 'the fifth on the accents', 'minor'],
    ['octaves', 'Octave jumps', 'the accents jump an octave', 'minor'],
    ['box', 'Pentatonic box', 'up and down the box', 'mpenta blues penta'],
    ['walk', 'Walks the scale', 'the accents step up the scale', 'minor phrygian harmonic dorian mixolydian major'],
    ['drop', 'Drops to the ♭7', 'the root, then down to the ♭7 and the 5', 'minor mixolydian'],
    ['newend', 'Same twice, new ending', 'bar two ends somewhere new', 'minor phrygian dorian mixolydian'],
    ['blues', 'Blues turn', 'root, ♭3, 4, ♭5, 5', 'blues'],
    ['crawl', 'Chromatic crawl', 'the accents climb a half step at a time', 'minor phrygian', 1],
    ['sink', 'Sinks', 'the accents sink a half step at a time', 'harmonic minor', 1],
    ['menace', 'Half step above', 'the accents rub against the ♭2', 'phrygian minor', 1],
    ['tritone', 'Tritone', 'the accents hit the ♭5, the devil’s interval', 'minor phrygian', 1],
  ];
  /** semitones above home for each hit of a riff (`fam` from RIFF_NOTES); the first hit of each bar stays home */
  function riffLine(fam, hits, scale, m) {
    const sc = SCALES[scale];
    const near = (want) => sc.reduce((b, x) => (Math.abs(x - want) < Math.abs(b - want) ? x : b), sc[0]);
    const third = sc.indexOf(3) >= 0 ? 3 : near(4), fourth = near(5), fifth = near(7), sev = sc.indexOf(10) >= 0 ? 10 : near(11);
    const out = hits.map(() => 0);
    const at = (h) => mod(h[0], m.steps);
    // the accents that move, counted from each bar's start (bar two says it again)
    let j = 0;
    const movers = [];
    hits.forEach((h, i) => { if (at(h) === 0) j = 0; if (h[2] === 2 && at(h) !== 0) movers.push([i, j++]); });
    const lastIn = (i) => !movers.some(([k]) => k > i && Math.floor(hits[k][0] / m.steps) === Math.floor(hits[i][0] / m.steps));
    if (fam === 'pedal') { const fl = [third, fourth, third, fifth]; movers.forEach(([i, k]) => { out[i] = fl[k % 4]; }); }
    else if (fam === 'fifth') movers.forEach(([i]) => { out[i] = fifth; });
    else if (fam === 'octaves') movers.forEach(([i]) => { out[i] = 12; });
    else if (fam === 'walk') movers.forEach(([i, k]) => { out[i] = sc[(k + 1) % sc.length]; });
    else if (fam === 'crawl') movers.forEach(([i, k]) => { out[i] = (k % 3) + 1; });
    else if (fam === 'sink') movers.forEach(([i, k]) => { out[i] = -((k % 3) + 1); });
    else if (fam === 'menace') movers.forEach(([i]) => { out[i] = 1; });
    else if (fam === 'tritone') movers.forEach(([i]) => { out[i] = hits[i][0] >= m.steps && lastIn(i) ? fifth : 6; });
    else if (fam === 'drop') hits.forEach((h, i) => { const p = at(h) / m.steps; out[i] = p < 0.5 ? 0 : p < 0.75 ? sev - 12 : fifth - 12; });
    else if (fam === 'box' || fam === 'blues') {
      // a line through the box: muted hits stay on the note before them
      const line = fam === 'blues' ? [0, 3, 5, 6, 7, 10, 7, 5] : [0, 1, 2, 1, 0, 2, 3, 1].map((k) => sc.concat([12])[k % (sc.length + 1)]);
      let k = 0, cur = 0;
      hits.forEach((h, i) => { if (at(h) === 0) k = 0; if (h[2] >= 1 || at(h) === 0) cur = line[k++ % line.length]; out[i] = cur; });
    } else if (fam === 'newend') {
      movers.forEach(([i]) => { out[i] = fifth; });
      // bar two's last three hits run somewhere new
      const end = hits.map((h, i) => i).filter((i) => hits[i][0] >= m.steps && hits[i][2] >= 1).slice(-3);
      const run = SCALE_ORDER.indexOf(scale) % 2 ? [third, fourth, fifth] : [sev - 12, near(8) - 12, fifth - 12];
      end.forEach((i, k) => { out[i] = run[k + 3 - end.length]; });
    }
    return out;
  }
  function riffNoteStyles(riff) {
    const m = Odd.theory.meter(riff.r.m), hits = riff.r.hits, out = [];
    RIFF_NOTES.forEach(([fam, tag, words, scales, odd]) => scales.split(' ').forEach((scale) => {
      const ms = riffLine(fam, hits, scale, m);
      out.push({ id: fam + '-' + scale, fam, tag, words, detail: MODE[scale].name.toLowerCase(), scale, ms, odd: !!odd, distinct: new Set(ms).size, span: maxOf(ms) - minOf(ms), dark: RIFF_SCALES.indexOf(scale) });
    }));
    // the same notes in another scale sound the same: the first keeps them
    return unique(out, (o) => JSON.stringify(o.ms));
  }

  // who plays a riff, and doubled how: [id, name, words, voices: [part, offset]] (low: a bass; high: an octave up; 'third': a third up, in the scale)
  const WEIGHTS = [
    ['bass', 'Bass alone', 'just the low end', [['low', 0]]],
    ['guitar', 'Guitar alone', 'no bass under it', [['high', 0]]],
    ['octave', 'Bass and guitar', 'the two an octave apart', [['low', 0], ['high', 0]]],
    ['fifths', 'Fifths', 'the guitar plays the root and its fifth', [['high', 0], ['high', 7]]],
    ['power', 'Power chords', 'root, fifth and octave, over the bass', [['low', 0], ['high', 0], ['high', 7], ['high', 12]]],
    ['thirds', 'In thirds', 'a second voice a third up, in the scale', [['low', 0], ['high', 0], ['high', 'third']]],
    ['up', 'Up high', 'the guitar an octave up, over the bass', [['low', 0], ['high', 12]]],
  ];
  const LOW_PATCH = [['bass-pluck', 'picked bass'], ['bass-saw', 'saw bass'], ['bass-808', '808 bass']];
  const HIGH_PATCH = [['grit', 'gritty guitar'], ['lead-saw', 'saw synth'], ['organ', 'organ']];
  const RIFF_BASE = { low: 36, high: 48 };
  function weightStyles() {
    const out = [];
    WEIGHTS.forEach(([id, tag, words, vs]) => {
      const hasLo = vs.some((v) => v[0] === 'low'), hasHi = vs.some((v) => v[0] === 'high');
      const lows = hasLo ? LOW_PATCH.slice(0, hasHi ? 2 : 3) : [null], highs = hasHi ? HIGH_PATCH : [null];
      lows.forEach((lo, li) => highs.forEach((hi, hk) => out.push({
        id: [id, lo && lo[0], hi && hi[0]].filter(Boolean).join('-'), fam: id, twist: li + hk, tag, words,
        detail: [lo && lo[1], hi && hi[1]].filter(Boolean).join(' and '),
        voices: vs.map(([part, off]) => ({ part, off, patch: part === 'low' ? lo[0] : hi[0] })),
        heavy: vs.length + (hasLo ? 1 : 0) + (id === 'power' ? 1 : 0), bright: hasHi ? hk + (hasLo ? 0 : 1) : 0,
      })));
    });
    return out;
  }
  /** the semitones a third up from x in the scale (a 4th in pentatonic boxes) */
  function thirdUp(scale, x) {
    const sc = SCALES[scale || 'minor'], n = sc.length, pc = mod(x, 12);
    let i = n - 1;
    while (i > 0 && sc[i] > pc) i--;
    return sc[(i + 2) % n] + 12 * Math.floor((i + 2) / n) - sc[i];
  }
  function riffVoices(riff) { return riff.weight ? riff.weight.voices : [{ part: 'high', off: 0, patch: 'grit' }]; }
  function riffPitch(v, x, scale) { return RIFF_BASE[v.part] + x + (v.off === 'third' ? thirdUp(scale, x) : v.off); }

  /** drums for a riff: the meter's beats, and kicks made from the riff itself; follow: how many kicks land on its hits */
  function riffKits(idea) {
    const m = ideaMeter(idea), riff = idea.riff, B = (xs) => bothBars(m, xs);
    const sn = SNARES[m.id] || SNARES['4/4'], bars = (a, b) => a.concat((b || a).map((x) => x + m.steps));
    const back = bars(sn.back[1], sn.back[2]), half = bars(sn.half[1], sn.half[2]);
    const acc = riff.r.hits.filter((h) => h[2] === 2).map((h) => h[0]), plain = riff.r.hits.filter((h) => h[2] >= 1).map((h) => h[0]);
    const eighths = B(evensOf(m.steps)), beats = B(m.pulses.map((p) => p.s));
    const mine = [
      ['accents', 'Kick on its accents', acc, back, eighths, 42, '8ths'],
      ['accents', 'Kick on its accents', acc, back, beats, 42, 'hats on the beat'],
      ['accents', 'Kick on its accents', acc, half, eighths, 51, 'half-time · ride'],
      ['double', 'Kick doubles the riff', plain, back, beats, 42, 'hats on the beat'],
      ['double', 'Kick doubles the riff', plain, half, eighths, 51, 'half-time · ride'],
      ['under', 'Half-time under it', [0, m.steps], half, beats, 51, 'ride'],
    ].map(([fam, tag, k, s, h, hp, detail], i) => ({ id: 'riff-' + fam + '-' + i, fam: 'riff-' + fam, twist: i % 3 ? 1 : 0, tag, detail, k: k.filter((x) => s.indexOf(x) < 0), s, h, hp, swing: 0 }));
    const onRiff = {};
    riff.r.hits.forEach((h) => { onRiff[h[0]] = 1; });
    return unique(kitsFor(m).concat(mine.filter((x) => x.k.length)), (x) => JSON.stringify([x.k, x.s, x.h, x.hp, x.swing])).map((x) => Object.assign({}, x, {
      follow: Math.round(100 * x.k.filter((s) => onRiff[s]).length / Math.max(1, x.k.length)) / 100, n: x.k.length + x.s.length + x.h.length,
    }));
  }

  const UNDER_INST = { 'pad-warm': 'warm pad', strings: 'strings', organ: 'organ' };
  /** under a riff: drones, or chords that move (the paths that fit its notes, starting home) while it stays put */
  function underStyles(idea) {
    const riff = idea.riff, scale = riff.scale, m = ideaMeter(idea), slots = slotsOf(m), STEPS = 2 * m.steps;
    const home = chordCands(scale)[0], out = [];
    [['root', 'One low drone', 'the home note', [48]], ['fifth', 'Open drone', 'home and its fifth', [48, 55]], ['wide', 'Wide drone', 'home, fifth and octave', [36, 43, 48]]].forEach(([id, tag, words, ps]) =>
      ['pad-warm', 'strings', 'organ'].forEach((inst, k) => out.push({
        id: 'drone-' + id + '-' + inst, fam: 'drone-' + id, twist: k, tag, detail: words + ' · ' + UNDER_INST[inst], voice: inst,
        chords: slots.map(() => home), changes: 0, notes: [{ s: 0, d: STEPS, ms: ps.map((p) => p + home.root) }],
      })));
    const voiced = (c) => c.pcs.map((pc) => 55 + mod(pc - 55, 12));
    chordPaths(slotWeights(riffNotes(riff), m), scale, false)
      .filter((p) => p.changes >= 1 && p.chords[0].root === home.root && p.chords.every((c) => !c.colour && c.q !== '°' && c.q !== '+')).slice(0, 8)
      .forEach((p, pi) => [['held', 'strings'], ['held', 'pad-warm'], ['pulse', 'organ']].forEach(([rh, inst], k) => out.push({
        id: 'move' + pi + '-' + rh + '-' + inst, fam: 'move' + pi, twist: k, tag: rh === 'held' ? 'Chords that move' : 'Moving chords, on the beat', detail: chordLine(p.chords) + ' · ' + UNDER_INST[inst], voice: inst,
        chords: p.chords, changes: p.changes,
        notes: rh === 'held' ? slots.map((sl, i) => ({ s: sl.s, d: sl.len, ms: voiced(p.chords[i]) })) : beatsOf(m).map((b) => ({ s: b.s, d: Math.max(1, b.len - 1), ms: voiced(p.chords[slotAt(slots, b.s)]) })),
      })));
    return out.map((x) => Object.assign(x, { voices: x.notes[0].ms.length }));
  }

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
  // a sound's lead instrument, in words
  const LEAD_WORD = { epiano: 'electric piano', keys: 'soft keys', bell: 'bell', pluck: 'pluck', 'lead-saw': 'saw lead', 'lead-square': 'square lead', 'lead-soft': 'soft lead', organ: 'organ' };
  const LEADS = Object.keys(LEAD_WORD);
  /** the genres, best fit for the melody's rhythm first */
  function genreFit(idea) {
    const r = idea.melody.r, offR = r.off / r.n, avg = r.hits.reduce((a, h) => a + h[1], 0) / r.n;
    const fit = {
      lofi: 2 - Math.abs(r.n - 8) / 6 + 0.6 * offR, ambient: (r.n <= 6 ? 1.5 : 0) + avg / 4, boombap: 1.2 + 0.5 * offR - Math.abs(r.n - 9) / 10,
      pop: (1 - offR) * 1.6 + 0.3, synthwave: avg / 3 + 0.4, house: 2.4 * offR + (avg < 3 ? 0.8 : 0), trap: r.n / 8 + 0.3, dnb: r.n / 10 + offR,
    };
    return Object.keys(fit).sort((a, b) => fit[b] - fit[a]);
  }
  // a riff's sounds: the high voice is `lead`, the low one `bass`
  const RIFF_GENRES = {
    stoner: { name: 'Stoner', bpm: 76, swing: 0, patches: { lead: 'grit', bass: 'bass-saw', chords: 'organ', kit: 'kit-acoustic' }, why: 'slow and heavy: every hit gets to ring' },
    metal: { name: 'Metal', bpm: 150, swing: 0, patches: { lead: 'grit', bass: 'bass-pluck', chords: 'strings', kit: 'kit-acoustic' }, why: 'fast and tight, the riff right on the kick' },
    postpunk: { name: 'Post-punk', bpm: 138, swing: 0, patches: { lead: 'pluck', bass: 'bass-pluck', chords: 'pad-glass', kit: 'kit-909' }, why: 'the bass carries it and the guitar gets out of the way' },
    funk: { name: 'Funk', bpm: 102, swing: 0.56, patches: { lead: 'stab', bass: 'bass-pluck', chords: 'epiano', kit: 'kit-acoustic' }, why: 'short notes and rests leave room for the pocket' },
    surf: { name: 'Surf', bpm: 168, swing: 0, patches: { lead: 'lead-square', bass: 'bass-pluck', chords: 'organ', kit: 'kit-acoustic' }, why: 'fast picking on a bright, twangy voice' },
    industrial: { name: 'Industrial', bpm: 118, swing: 0, patches: { lead: 'lead-saw', bass: 'bass-saw', chords: 'stab', kit: 'kit-909' }, why: 'machines: hard and exact' },
    desert: { name: 'Desert rock', bpm: 92, swing: 0.58, patches: { lead: 'grit', bass: 'bass-sub', chords: 'organ', kit: 'kit-lofi' }, why: 'a lazy lean under a heavy riff' },
    darkwave: { name: 'Darkwave', bpm: 112, swing: 0, patches: { lead: 'lead-saw', bass: 'bass-808', chords: 'pad-warm', kit: 'kit-808' }, why: 'cold synths that let a minor riff brood' },
  };
  const VOICE_WORD = { grit: 'gritty guitar', 'lead-saw': 'saw synth', pluck: 'pluck', organ: 'organ', stab: 'synth stab', 'lead-square': 'square lead' };
  const RIFF_LEADS = Object.keys(VOICE_WORD);
  const BASS_WORD = { 'bass-sub': 'sub bass', 'bass-saw': 'saw bass', 'bass-808': '808 bass', 'bass-pluck': 'picked bass' };
  const KIT_WORD = { 'kit-acoustic': 'live kit', 'kit-808': '808 kit', 'kit-909': '909 kit', 'kit-lofi': 'dusty kit' };
  // what each genre's kit and bass do to a groove
  const GROOVE_WHY = {
    lofi: 'a dusty kit and a round sub, a little worn', ambient: 'a soft kit and a sub, so it floats', boombap: 'a crunchy kit that hits like a record',
    pop: 'a clean live kit and a picked bass', synthwave: 'an 808 and a saw bass: neon', house: 'a 909 and a rubbery saw bass',
    trap: 'an 808 kit and a long 808 bass', dnb: 'a live kit over a deep sub',
  };
  /** the riff sounds, best fit first: slow and sparse riffs lean heavy, busy and bright ones fast */
  function riffFit(idea) {
    const r = idea.riff.r, m = ideaMeter(idea), busy = r.n / (2 * m.steps), dark = 1 - Math.max(0, RIFF_SCALES.indexOf(idea.riff.scale)) / (RIFF_SCALES.length - 1);
    const fit = {
      stoner: 1.4 - 2 * busy + 0.6 * dark, metal: 2 * busy + 0.8 * dark, postpunk: 1.2 - 2 * Math.abs(busy - 0.4), funk: r.off + 0.8 * (1 - dark) + (busy > 0.3 ? 0.3 : 0),
      surf: busy + (1 - dark), industrial: 1.1 - r.off + 0.3 * dark, desert: 0.9 + 0.5 * r.off, darkwave: 1.2 * dark + 0.2,
    };
    return Object.keys(fit).sort((a, b) => fit[b] - fit[a]);
  }
  /** a groove's sounds: every genre's kit and bass at the pocket's own tempo and swing, nearest tempo first; picked keys keep their instrument */
  function grooveSounds(idea) {
    const pk = idea.layers.pocket, keys = idea.layers.keys, out = [];
    const order = Object.keys(GENRES).sort((a, b) => Math.abs(GENRES[a].bpm - pk.bpm) - Math.abs(GENRES[b].bpm - pk.bpm));
    order.forEach((g, rank) => {
      const G = GENRES[g];
      const patches = Object.assign({}, G.patches, keys && !keys.none ? { chords: keys.voice } : {});
      const base = { genre: g, name: G.name, bpm: pk.bpm, swing: pk.swing, up: 0, why: GROOVE_WHY[g], en: G.bpm };
      const add = (id, tag, ch, rare) => out.push(Object.assign({}, base, { id, fam: g, twist: rare ? 1 : 0, tag, name: tag, rare: rank >= 5 || !!rare, patches: Object.assign({}, patches, ch) }));
      add(g, G.name, {});
      ['bass-sub', 'bass-saw', 'bass-808', 'bass-pluck'].filter((b) => b !== G.patches.bass).slice(0, 2).forEach((b) => add(g + '-' + b, G.name + ' with ' + BASS_WORD[b], { bass: b }, 1));
      const kit = Object.keys(KIT_WORD).find((k) => k !== G.patches.kit && k !== 'kit-acoustic') || 'kit-acoustic';
      add(g + '-' + kit, G.name + ', ' + KIT_WORD[kit], { kit }, 1);
    });
    return out.map((o) => Object.assign(o, { inst: KIT_WORD[o.patches.kit], detail: KIT_WORD[o.patches.kit] + ' · ' + BASS_WORD[o.patches.bass] }));
  }
  /** a riff's sounds: each genre as it is, slower, faster, and with two other high voices */
  function riffSounds(idea) {
    const m = ideaMeter(idea), out = [];
    riffFit(idea).forEach((g, rank) => {
      const G = RIFF_GENRES[g];
      const base = { genre: g, name: G.name, bpm: G.bpm, swing: m.compound ? 0 : G.swing, up: 0, why: G.why, inst: VOICE_WORD[G.patches.lead] };
      const add = (id, tag, ch, rare) => out.push(Object.assign({}, base, { id, fam: g, twist: rare ? 1 : 0, tag, name: tag, rare: rank >= 5 || !!rare }, ch, { patches: Object.assign({}, G.patches, ch.patches || {}) }));
      add(g, G.name, {});
      add(g + '-slow', G.name + ', slower', { bpm: Math.round(G.bpm * 0.82) }, 1);
      add(g + '-fast', G.name + ', faster', { bpm: Math.round(G.bpm * 1.18) }, 1);
      const own = RIFF_LEADS.indexOf(G.patches.lead);
      [1, 3].forEach((k) => { const lead = RIFF_LEADS[(own + k) % RIFF_LEADS.length]; add(g + '-' + lead, G.name + ' with ' + VOICE_WORD[lead], { inst: VOICE_WORD[lead], patches: { lead } }, 1); });
    });
    return out.map((o) => Object.assign(o, { en: o.bpm }));
  }

  /**
   * Sounds: each genre mix as it is (a reliable starting point), and the same
   * mix slower, faster, swung or straight, and with other lead instruments.
   * A genre is a recipe of ingredients, not a lock. `rare`: the genres that
   * suit the rhythm least, and the changed recipes, come later in the deck.
   */
  function soundStyles(idea) {
    if (pathOf(idea) === 'groove') return grooveSounds(idea);
    if (pathOf(idea) === 'riff') return riffSounds(idea);
    const order = genreFit(idea), out = [];
    order.forEach((g, rank) => {
      const G = GENRES[g];
      const base = { genre: g, name: G.name, bpm: G.bpm, swing: G.swing, inst: G.inst, up: G.up || 0, why: G.why, patches: Object.assign({}, G.patches) };
      const add = (id, tag, ch, rare) => out.push(Object.assign({}, base, { id, fam: g, twist: rare ? 1 : 0, tag, name: tag, rare: rank >= 5 || !!rare }, ch, { patches: Object.assign({}, base.patches, ch.patches || {}) }));
      add(g, G.name, {});
      add(g + '-slow', G.name + ', slower', { bpm: Math.round(G.bpm * 0.82) }, 1);
      add(g + '-fast', G.name + ', faster', { bpm: Math.round(G.bpm * 1.18) }, 1);
      if (G.swing) add(g + '-straight', G.name + ', straight', { swing: 0 }, 1);
      else if (G.bpm < 130) add(g + '-swung', G.name + ', swung', { swing: 0.6 }, 1);
      // two other leads, the next ones round the list
      const own = LEADS.indexOf(G.patches.lead);
      [1, 3].forEach((k) => {
        const lead = LEADS[(own + k) % LEADS.length];
        add(g + '-' + lead, G.name + ' with ' + LEAD_WORD[lead], { inst: LEAD_WORD[lead], up: 0, patches: { lead } }, 1);
      });
    });
    return out.map((o) => Object.assign(o, { en: o.bpm }));
  }

  // ---------------------------------------------------------------- the deck: every option, three at a time
  //
  // A round's pool is a deck, dealt three cards at a time. The pool is sorted
  // along the layer's telling difference (sparse..busy, dark..bright, ...) and
  // cut into three bands; each batch takes one card from each band, so the
  // three on screen always differ, and cards that sound alike (the same band)
  // never sit side by side. Every card comes up once before any repeats:
  // past the last batch the deck is shuffled and dealt again (round.deal).
  // The first batch is each band's clearest card (its end, or the middle);
  // cards a round once left out (shapes past an octave or with big jumps,
  // chord paths past the best 18, sounds that fit least) come last, not never.

  /** the candidates a steer leaves: each step halves the pool toward one end (p on a, s on b), sorted along a */
  function steerPool(cands, steer) {
    let pool = cands.slice();
    const half = (arr, f, dir) => { const s = arr.slice().sort((a, b) => f(a) - f(b)); const k = Math.max(3, Math.ceil(s.length / 2)); return dir < 0 ? s.slice(0, k) : s.slice(s.length - k); };
    for (let i = 0; i < Math.abs(steer.s || 0); i++) pool = half(pool, (c) => c.b, steer.s);
    for (let i = 0; i < Math.abs(steer.p || 0); i++) pool = half(pool, (c) => c.a, steer.p);
    return pool.sort((x, y) => x.a - y.a || x.b - y.b);
  }

  /**
   * Batches of three from three bands. pick(band, i, plan, used) takes the
   * band's next card (default: the first), with plan(bands, k) worked out
   * once per batch; a band that runs out early is covered by the one with
   * most left. Each batch reads low to high along a.
   */
  function dealBands(bands, pick, plan) {
    const qs = bands.map((b) => b.slice()), out = [];
    let P = null;
    const take = (i, used) => { const q = qs[i]; const j = pick ? pick(q, i, P, used) : apart(q, used); return q.splice(j, 1)[0]; };
    for (let k = 0; qs.some((q) => q.length); k++) {
      const batch = [];
      P = plan ? plan(qs, k) : null;
      qs.forEach((q, i) => { if (q.length) batch.push(take(i, batch)); });
      while (batch.length < 3 && qs.some((q) => q.length)) {
        let i = 0;
        qs.forEach((q, j) => { if (q.length > qs[i].length) i = j; });
        batch.push(take(i, batch));
      }
      out.push(batch.sort((x, y) => x.a - y.a || x.b - y.b));
    }
    return out;
  }

  /** an option's family: the ingredient that most changes how it sounds (bass job, pad rhythm, instrument, kick, genre) */
  function famOf(o) { return o.fam || o.tag; }
  /** the first of the next few cards that shares neither family nor detail with the batch so far (else neither family) */
  function apart(q, used) {
    const look = Math.min(q.length, 8);
    for (let j = 0; j < look; j++) if (!used.some((u) => famOf(u) === famOf(q[j]) || (u.detail && u.detail === q[j].detail))) return j;
    for (let j = 0; j < look; j++) if (!used.some((u) => famOf(u) === famOf(q[j]))) return j;
    return 0;
  }
  /**
   * A band's cards taking turns by family, in the order each family first
   * comes, so neighbours differ. plain: each family's plainest version first
   * (twist counts the ingredients changed from its plain form).
   */
  function byTurns(list, plain) {
    const fams = [], groups = {};
    list.forEach((o) => { const f = famOf(o); if (!groups[f]) { groups[f] = []; fams.push(f); } groups[f].push(o); });
    if (plain) {
      fams.forEach((f) => { groups[f] = groups[f].map((o, i) => [o, i]).sort((x, y) => (x[0].twist || 0) - (y[0].twist || 0) || x[1] - y[1]).map((x) => x[0]); });
      // families with a plain version here lead; one whose plain version fell in the next band waits
      const lead = (f) => groups[f][0].twist || 0;
      fams.sort((a, b2) => lead(a) - lead(b2) || fams.indexOf(a) - fams.indexOf(b2));
    }
    const out = [];
    for (let k = 0; out.length < list.length; k++) fams.forEach((f) => { if (groups[f][k]) out.push(groups[f][k]); });
    return out;
  }
  /** a sorted pool cut in thirds, each third ordered clearest first, cards once left out last; shuffled on later deals */
  function bandsOf(pool, deal, seed) {
    const n = pool.length;
    if (n <= 3) return [pool.slice(0, 1), pool.slice(1, 2), pool.slice(2)];
    const t1 = Math.round(n / 3), t2 = Math.round(2 * n / 3);
    const mid = (pool[0].a + pool[n - 1].a) / 2;
    const bands = [pool.slice(0, t1), pool.slice(t1, t2).sort((x, y) => Math.abs(x.a - mid) - Math.abs(y.a - mid)), pool.slice(t2).reverse()];
    return bands.map((b, i) => {
      if (deal) return byTurns(shuffled(b, rng(seedOf(seed + ':' + deal + ':' + i))));
      return byTurns(b.filter((c) => !c.rare), true).concat(byTurns(b.filter((c) => c.rare), true));
    });
  }

  /** the batches for a round: [[option x3]], plus the pool's size */
  function deckOf(dir, round, idea) {
    const st = round.steer || {}, deal = round.deal || 0;
    return cached('d' + dir + deal + JSON.stringify(st) + JSON.stringify(idea), () => {
      if (dir === 'seed1') {
        const pool = steerPool(rhythmPool(st.m).map((r) => ({ r, a: r.n + 0.3 * r.off, b: 0 })), { p: st.p });
        let sl = SCALE_ORDER.slice();
        if (st.s < 0) sl = sl.slice(0, 4);
        if (st.s > 0) sl = sl.slice(4);
        // each batch spreads its scales dark, middle, bright, turning each time
        const batches = dealBands(bandsOf(pool, deal, 'seed1')).map((cs, k) => {
          const b = k + deal * 5;
          const ps = [0, Math.floor(sl.length / 2), sl.length - 1].map((i) => sl[(i + b) % sl.length]);
          const perm = [[1, 0, 2], [2, 1, 0], [0, 2, 1]][b % 3];
          return cs.map((c, i) => ({ a: c.a, mel: { r: c.r, scale: ps[perm[i % 3]], shape: null } }));
        });
        return { batches, total: pool.length };
      }
      if (dir === 'seed2') return shapeDeck(idea.melody, st, deal);
      const keep = (list, f) => { const x = list.filter(f); return x.length >= 3 ? x : list; };
      let cands;
      if (dir === 'chords') cands = chordPool(idea.melody, st.x === 'colour').map((c, i) => Object.assign({ a: c.bright, b: c.changes, rare: i >= 18 }, c));
      else if (dir === 'bass') cands = bassStyles(idea).map((c) => Object.assign(c, { a: c.lock, b: c.n }));
      else if (dir === 'pads') cands = padStyles(idea).map((c) => Object.assign(c, { a: c.voices, b: c.reg }));
      else if (dir === 'perc') {
        cands = percStyles(idea);
        if (st.x === 'follow') { const f = cands.filter((c) => c.follow >= 0.5); if (f.length >= 3) cands = f; }
        cands = cands.map((c) => Object.assign(c, { a: c.n, b: c.follow }));
      } else if (dir === 'beat') cands = kitsFor(ideaMeter(idea)).map((c) => Object.assign({}, c, { a: c.off, b: c.n }));
      else if (dir === 'pocket') cands = pocketStyles(Odd.theory.meter(st.m), st).map((c) => Object.assign(c, { a: c.off, b: c.n }));
      else if (dir === 'gbass') cands = grooveBass(idea, st).map((c) => Object.assign(c, { a: c.lock, b: c.n }));
      else if (dir === 'keys') cands = keysStyles(idea).map((c) => Object.assign(c, { a: c.n, b: c.voices }));
      else if (dir === 'hook') {
        cands = hookStyles(idea);
        if (st.x === 'gaps') { const by = cands.slice().sort((x, y) => x.clash - y.clash); cands = by.slice(0, Math.max(3, Math.ceil(by.length / 3))); }
      } else if (dir === 'rrhythm') cands = riffPool(st.m).map((r) => ({ r, a: r.off + 0.002 * r.n, b: r.n }));
      else if (dir === 'rnotes') cands = keep(riffNoteStyles(idea.riff), (c) => st.x !== 'odd' || c.odd).map((c) => Object.assign(c, { a: c.distinct + c.span / 12, b: c.dark }));
      else if (dir === 'weight') cands = weightStyles().map((c) => Object.assign(c, { a: c.heavy, b: c.bright }));
      else if (dir === 'drums') cands = riffKits(idea).map((c) => Object.assign(c, { a: 1 - c.follow, b: c.n }));
      else if (dir === 'under') cands = underStyles(idea).map((c) => Object.assign(c, { a: c.changes + 0.1 * c.voices, b: c.voices }));
      // the sounds that fit the rhythm least come last; "Surprise me" deals them in from the start
      else cands = soundStyles(idea).map((c) => Object.assign(c, { a: c.en, b: c.swing }));
      const pool = steerPool(cands, st);
      const shake = st.x === 'any' ? deal + 1 : deal;
      return { batches: dealBands(bandsOf(pool, shake, dir)), total: pool.length };
    });
  }

  /**
   * Round 2's deck. The bands are directions: falls (an answer), stays near
   * home, rises (a question). Each batch also mixes a small, a medium and a
   * big shape, and never the same shape twice. Requests narrow the pool
   * (Subtler: small, then smoother, then barely moving; Bigger: no small,
   * then only big; More jumps; Land on home).
   */
  function shapeDeck(mel, st, deal) {
    const s = st.s || 0;
    let pool = shapeCands(mel);
    const keep = (f) => { const x = pool.filter(f); if (x.length >= 3) pool = x; };
    if (s <= -1) keep((c) => c.size === 0);
    if (s <= -2) keep((c) => c.leap <= 1);
    if (s <= -3) keep((c) => c.range <= 1);
    if (s === 1) keep((c) => c.size >= 1);
    if (s >= 2) keep((c) => c.size === 2);
    if (st.x === 'smooth') keep((c) => c.leap <= 1);
    if (st.x === 'jumpy') keep((c) => c.leap >= 3);
    // past an octave or with big jumps comes later (unless that's what was asked for)
    const maxRange = s >= 2 ? 9 : 7, maxLeap = st.x === 'jumpy' ? 99 : s >= 2 ? 3 : 2;
    const opts = pool.map((c) => Object.assign(shapeOpt(mel, st, c), { rare: c.range > maxRange || c.leap > maxLeap }));
    const seed = mel.r.id + ':' + mel.scale + ':' + deal;
    const bands = [-1, 0, 1].map((d) => shuffled(opts.filter((o) => Math.sign(o.end) === d), rng(seedOf(seed + ':' + d))));
    // which band gets which size: the order (tried shuffled per batch) that finds the most of them
    // (the sizes a batch wants: one of each, or what Subtler and Bigger ask for)
    const SZ = s <= -1 ? [0, 0, 0] : s === 1 ? [1, 2, 2] : s >= 2 ? [2, 2, 2] : [0, 1, 2];
    const plan = (qs, k) => {
      const has = (i, z) => qs[i].some((o) => o.size === z && !o.rare);
      let best = SZ, hits = -1;
      for (const perm of shuffled(PERMS, rng(seedOf(seed + ':' + k)))) {
        const sizes = perm.map((j) => SZ[j]), h = sizes.filter((z, i) => has(i, z)).length;
        if (h > hits) { best = sizes; hits = h; }
        if (h === 3) break;
      }
      return best;
    };
    const pick = (q, i, perm, used) => {
      const want = perm[i], near = [want, want - 1, want + 1, want - 2, want + 2].filter((z) => z >= 0 && z <= 2);
      const ok = (o) => !used.some((u) => u.mel.shape.kind === o.mel.shape.kind);
      for (const rare of [false, true]) for (const z of near) {
        let j = q.findIndex((o) => o.size === z && !!o.rare === rare && ok(o));
        if (j >= 0) return j;
        j = q.findIndex((o) => o.size === z && !!o.rare === rare);
        if (j >= 0) return j;
      }
      return 0;
    };
    const batches = dealBands(bands, pick, plan).map((b) => b.sort((x, y) => x.end - y.end || x.range - y.range));
    return { batches, total: pool.length };
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

  /** a shape candidate as an option: it starts where it lands on the note its direction wants */
  function shapeOpt(mel, st, c) {
    const sc = SCALES[mel.scale];
    const land = st.x === 'home' || c.end < 0 ? 0 : c.end > 0 ? 7 : sc.indexOf(4) >= 0 ? 4 : 3;
    const start = startFor(mel.scale, c.s, land);
    return { a: c.end + c.range * 0.01, b: c.range, land, leap: c.leap, range: c.range, end: c.end, size: c.size, mel: { r: mel.r, scale: mel.scale, shape: { kind: c.kind, amp: c.amp, start } } };
  }

  /** the scale step a shape starts on so that it lands on `target` semitones above home */
  function startFor(scale, steps, target) {
    const sc = SCALES[scale];
    let start = sc.indexOf(target) - steps[steps.length - 1];
    while (start < -4) start += sc.length;
    while (start > 5) start -= sc.length;
    return start;
  }

  /** the three options on screen: batch round.batch of the round's deck */
  function options(dir, round, idea) {
    const bs = deckOf(dir, round, idea).batches;
    return bs.length ? bs[Math.max(0, Math.min(bs.length - 1, round.batch || 0))] : [];
  }
  /** where the round is in its deck: batch, batches, cards from..to of total */
  function deckInfo(dir, round, idea) {
    const d = deckOf(dir, round, idea), b = Math.max(0, Math.min(d.batches.length - 1, round.batch || 0));
    const from = d.batches.slice(0, b).reduce((n, x) => n + x.length, 0);
    return { batch: b, batches: d.batches.length, sizes: d.batches.map((x) => x.length), from: from + 1, to: from + d.batches[b].length, total: d.total, deal: round.deal || 0 };
  }

  /** round 2's extra choice: keep the melody exactly as it walked through its scale in round 1 */
  function walkOption(mel) {
    return { a: 0, land: 0, leap: 1, range: 4, end: 0, size: 1, walk: true, mel: { r: mel.r, scale: mel.scale, shape: { kind: 'walk', amp: 1, start: 0 } } };
  }

  // ---------------------------------------------------------------- words

  /** Bobby on switching to a meter */
  function meterLine(id) {
    const m = Odd.theory.meter(id);
    if (m.id === '4/4') return 'Back to four: ' + m.feel + '. Most music lives here.';
    return m.id + ' now: ' + m.feel + '. Count along with one.';
  }
  /** the meter, said only when it isn't 4/4 */
  function meterNote(mel) { const m = meterOf(mel); return m.id === '4/4' ? '' : m.id; }

  function shapeTag(kind, range) {
    return SWEEPS.indexOf(kind) >= 0 && range != null && range <= 2 ? 'Gentle ' + SHAPE_TAG[kind].toLowerCase() : SHAPE_TAG[kind];
  }
  function tagOf(dir, o) {
    if (dir === 'seed1') return rhythmTag(o.mel.r);
    if (dir === 'hook') return o.tag || rhythmTag(o.mel.r);
    if (dir === 'rrhythm') return riffTag(o.r);
    if (dir === 'seed2') return shapeTag(o.mel.shape.kind, o.range);
    if (dir === 'chords') return (o.bright <= -2 ? 'Dark' : o.bright >= 2 ? 'Bright' : 'In between') + (o.colour ? ' + colour' : '');
    return o.tag;
  }
  function statOf(dir, o) {
    if (dir === 'seed1') return MODE[o.mel.scale].name.toLowerCase() + (meterNote(o.mel) ? ' · ' + meterNote(o.mel) : '');
    if (dir === 'seed2') return 'lands on ' + IV[o.land];
    if (dir === 'chords') return o.fit + '% fit';
    if (dir === 'bass') return o.detail || o.n + (o.n === 1 ? ' note' : ' notes');
    if (dir === 'pads') return o.detail || o.voices + (o.voices === 1 ? ' voice' : ' voices');
    if (dir === 'perc') return o.detail || o.n + ' hits';
    if (dir === 'pocket') return o.bpm + ' BPM · ' + (o.swing ? 'swung · ' : '') + o.detail + (o.m !== '4/4' ? ' · ' + o.m : '');
    if (dir === 'hook') return Math.round(100 * (1 - o.clash)) + '% in the gaps';
    if (dir === 'rrhythm') return o.r.n + ' hits' + (o.r.turn ? ' · new ending' : '') + (o.r.m !== '4/4' ? ' · ' + o.r.m : '');
    if (/^(gbass|keys|rnotes|weight|under)$/.test(dir)) return o.detail;
    if (o.detail && dir === 'sound') return o.bpm + ' BPM · ' + o.detail;
    if (dir === 'beat' || dir === 'drums') return (o.swing ? 'swung' + (o.detail ? ' · ' : '') : '') + (o.detail || (o.swing ? '' : Math.round(o.off * 100) + '% off grid'));
    return o.bpm + ' BPM' + (o.swing && o.swing > 0.5 ? ' · swung' : '');
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
      const sc = m.name + ', so it sounds ' + m.mood + '.' + (meterNote(o.mel) ? ' In ' + meterNote(o.mel) + '.' : '');
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
    if (dir === 'pads') return rk === 'low' ? 'Barely there. A shadow, nothing more.' : rk === 'high' ? 'Full and wide. Everything else floats on top.' : o.tag + '. Fills in without taking over.';
    if (dir === 'pocket') return (rk === 'low' ? 'Right on the grid at ' + o.bpm + '. Solid, easy to trust.' : rk === 'high' ? 'Leans against the grid: hits land between the beats. ' + o.bpm + ' BPM of swagger.' : o.tag + ' at ' + o.bpm + '. Somewhere between steady and loose.') + (o.swing ? ' Swung, too.' : '');
    if (dir === 'gbass') {
      const how = o.move === 'stay' ? 'It stays on ' + chordName(o.chords[0]) + ', so the groove does the moving.' : o.move.indexOf('loop') === 0 ? 'It walks a loop: ' + chordLine(o.chords) + '.' : 'It sways between ' + chordLine(o.chords).split(' ').slice(0, 2).join(' and ') + '.';
      return (rk === 'high' ? 'Locks to the kick: they land together, so the low end hits as one. ' : rk === 'low' ? 'Plays between the kicks, so kick and bass take turns. ' : o.tag + '. ') + how;
    }
    if (dir === 'keys') return rk === 'low' ? 'Held chords: a floor under the groove.' : rk === 'high' ? 'Chopped short, so the chords join the rhythm.' : o.tag + ', on ' + KEY_WORD[o.voice] + '.';
    if (dir === 'hook') return (rk === 'low' ? 'Just a few notes, ' : rk === 'high' ? 'Busy: ' + o.mel.r.n + ' notes, ' : o.mel.r.n + ' notes, ') + Math.round(100 * (1 - o.clash)) + '% of them in the groove’s gaps. It walks the scale for now; the shape comes next.';
    if (dir === 'rrhythm') return rk === 'low' ? 'Right on the grid. Every hard hit lands where you’d tap your foot.' : rk === 'high' ? 'The accents land against the beat. That pull is what makes a riff stick.' : riffTag(o.r) + '. ' + o.r.n + ' hits, some of them hard.';
    if (dir === 'rnotes') return (rk === 'low' ? 'Barely moves: one note doing the work, so the rhythm carries it.' : rk === 'high' ? 'Travels: ' + o.distinct + ' different notes.' : o.tag + ': ' + o.words + '.') + (o.odd ? ' Some of those notes are outside the scale. That’s the point.' : '');
    if (dir === 'weight') return (rk === 'low' ? 'Lean: ' : rk === 'high' ? 'Heavy: ' : o.tag + ': ') + o.words + '.';
    if (dir === 'drums') return rk === 'low' ? 'The kick follows the riff, so they hit as one.' : rk === 'high' ? 'The drums push against the riff: two rhythms at once.' : o.tag + '. Some with the riff, some against it.';
    if (dir === 'under') return rk === 'low' ? 'Hardly moves: a drone the riff can grind against.' : rk === 'high' ? 'The chords move while the riff stays put: ' + chordLine(o.chords) + '. Same riff, new colour.' : o.tag + ': ' + o.detail.split(' · ')[0] + ', on ' + UNDER_INST[o.voice] + '.';
    const t = o.name + ' at ' + o.bpm + '. ' + cap(o.why) + '.';
    return rk === 'low' ? t + ' Calmest of the three.' : rk === 'high' ? t + ' Most energy of the three.' : t;
  }
  function whyText(dir, o) {
    if (dir === 'seed1') {
      const mt = meterOf(o.mel);
      const t = MODE[o.mel.scale].why + ' And the rhythm: ' + o.mel.r.off + ' of its ' + o.mel.r.n + ' notes land between the beats. That lean against the pulse is called syncopation.';
      if (mt.id === '4/4') return t;
      return t + ' It’s in ' + mt.id + ': ' + mt.feel + '. ' + (mt.compound ? 'The top number counts eighth notes, and how they’re grouped decides where the strong beats fall.' : 'The top number is how many beats fill a bar.');
    }
    if (dir === 'seed2') return 'Where a tune stops decides how finished it feels. This one lands on the ' + IV[o.land] + ', so it sounds ' + landFeel(o.land) + '. ' + (o.end > 0 ? 'Ending higher than it started makes it a question.' : o.end < 0 ? 'Ending lower makes it an answer.' : 'Staying near home keeps it calm.') + (o.size === 0 ? ' It only moves a step or two, so repeated notes and rhythm make the hook.' : o.size === 2 ? ' It travels a long way, so the tune itself is the hook. Too many of those and a song gets tiring.' : '');
    if (dir === 'chords') { const col = o.chords.find((c) => c.colour); return 'Each chord was picked so the melody’s long, strong notes are notes of the chord: ' + o.fit + '% of the melody sits on them. ' + (col ? chordName(col) + ' is borrowed from outside the scale; it works because the melody note above it belongs to it.' : 'Minor chords under the same notes sound darker, major ones brighter.'); }
    if (dir === 'bass') return o.lock > 0.6 ? 'When bass and melody hit together, both sound heavier and the rhythm gets louder.' : o.lock < 0.3 ? 'The bass plays when the melody rests. They take turns, call and response, so each stays clear.' : 'Roots on the strong beats tell your ear which chord you are on, without getting in the melody’s way.';
    if (dir === 'pads') return 'Pads only use notes from the chords or the scale, so they can’t fight the melody. ' + (o.voices <= 1.2 ? 'One quiet voice adds depth without crowding.' : 'More voices fill the space around the melody, so it floats on top.');
    if (dir === 'perc') return 'Claps on the melody’s accents make those notes jump out. A steady shaker gives a pulse the melody can lean against.';
    if (dir === 'pocket') return 'A groove is mostly where the hits sit and how fast they come. The same kick and snare at 72 and at 120 are different grooves, so the speed is picked with the beat.' + (o.swing ? ' Swing plays each off-beat a little late, which gives the bounce.' : '');
    if (dir === 'gbass') return 'In a groove the bass decides the harmony. ' + (o.move === 'stay' ? 'Staying on one chord keeps all the attention on the rhythm.' : 'Moving between ' + chordLine(o.chords) + ' gives it somewhere to go without a tune.') + ' ' + (o.lock > 0.6 ? 'Hitting with the kick makes them one big low sound.' : o.lock < 0.3 ? 'Playing between the kicks keeps the low end busy without crowding.' : '');
    if (dir === 'keys') return o.none ? 'No chords leaves room. The bass already says where the harmony is.' : 'These play the chords the bass implies, so they can’t clash with it. ' + (o.n > 8 ? 'Short, choppy chords become part of the rhythm.' : 'Long chords give the groove a floor to sit on.');
    if (dir === 'hook') return 'A hook in a groove works best where the bass and kick leave space. Notes that land in the gaps get heard; notes on top of the kick get swallowed.';
    if (dir === 'rrhythm') return 'A riff is a rhythm first. The accents, the hard hits, decide how it feels: on the beat it sounds solid; off the beat it pulls.' + (o.r.fam === 'threes' ? ' Accents in threes cross the beat, so the riff seems to turn over itself.' : '') + ' The rests do as much as the notes.';
    if (dir === 'rnotes') return (o.odd ? 'Some of these notes aren’t in the scale. A riff can rub on purpose; the rhythm holds it together. ' : '') + MODE[o.scale].why + (o.distinct <= 2 ? ' With one or two notes, the rhythm is the riff.' : '');
    if (dir === 'weight') return 'The same notes get heavier the more voices play them and the lower they go. Power chords are just the root and its fifth; with no third they aren’t major or minor, so they sound hard.';
    if (dir === 'drums') return o.follow > 0.6 ? 'When the kick doubles the riff, the two become one big sound. That’s how heavy riffs get heavy.' : o.follow < 0.3 ? 'Drums against the riff make two rhythms at once. The riff pulls, the beat holds.' : 'Some kicks with the riff, some against it: it locks in places and leans in others.';
    if (dir === 'under') return o.changes ? 'The riff stays the same while the chords under it change, so the same notes take on a new colour each time. That’s how one riff can carry a whole song.' : 'A drone holds still, so every note in the riff rubs against it a little differently.';
    if (dir === 'beat') return o.off > 0.3 ? 'Kicks and snares between the beats are syncopation: the beat leans, and that leaning is swagger.' : 'Kick and snare right on the beat give a grid you can trust. That’s why dance music lives there.';
    return 'A genre is a bundle of habits: tempo, drums, sounds. It comes last, so the same idea can live in many of them. This one: ' + o.why + '.';
  }
  /** directions open from here: the path's own, and Grow the beat needs percussion first */
  function directions(idea) { return PATHS[pathOf(idea)].next.filter((d) => d !== 'beat' || !!idea.layers.perc); }

  // ---------------------------------------------------------------- sound

  const NEUTRAL = { lead: 'lead-soft', chords: 'keys', bass: 'bass-pluck', kit: 'kit-acoustic' };
  const PAD_PATCH = { pad: 'pad-warm', voice: 'epiano', strings: 'strings', glass: 'pad-glass' };
  const DRUM = {
    clap: 39, tap: 76, tapLo: 77, shaker: 70, tamb: 54, rim: 37, cowbell: 56, conga: 62, congaLo: 64, bongo: 60, bongoLo: 61,
    claves: 75, agogo: 67, agogoLo: 68, guiro: 73, tri: 81, kick: 36, snare: 38, hat: 42,
  };
  /** a hat's loudness: 16ths lean on the eighths, open and ride hats sit back a little */
  function hatVel(o, s) { return o.hp === 46 ? 58 : o.hp === 51 ? (s % 4 ? 52 : 66) : s % 2 ? 50 : 78; }
  const MIX = { mel: 0.9, chd: 0.5, bas: 0.8, pad: 0.45, prc: 0.75, bt: 0.75, kys: 0.5, und: 0.42, rlo: 0.8, rhi: 0.62, tik: 0.5 };
  const TRACK = { mel: 'b2g-mel', chd: 'b2g-chd', bas: 'b2g-bas', pad: 'b2g-pad', prc: 'b2g-prc', bt: 'b2g-bt', kys: 'b2g-kys', und: 'b2g-und', rlo: 'b2g-rlo', rhi: 'b2g-rhi', tik: 'b2g-tik' };
  const RIFF_VEL = [62, 88, 116];

  function emptyIdea(path) { return { path: PATHS[path] ? path : 'melody', melody: null, riff: null, layers: {}, order: [] }; }
  /** the idea with only its first `count` layers */
  function upTo(idea, count) {
    const layers = {};
    idea.order.slice(0, count).forEach((d) => { layers[d] = idea.layers[d]; });
    return { path: pathOf(idea), melody: idea.melody, riff: idea.riff || null, layers, order: idea.order.slice(0, count) };
  }

  /**
   * A looping transport sequence for the idea, or for the idea with one
   * option auditioned in place: aud = { dir, spec }. While a layer is
   * auditioned the layers already in sit back a little, so the new one is
   * heard. Rhythm-and-scale options play as the plain walk; a riff's rhythm
   * plays on one note, with a quiet hat counting the beats until it has drums.
   */
  function seq(idea, aud) {
    const path = pathOf(idea);
    const pick = (d) => (aud && aud.dir === d ? aud.spec : idea.layers[d]);
    const sound = pick('sound'), pocket = pick('pocket'), kit = pocket || pick('beat') || pick('drums');
    const G = sound ? GENRES[sound.genre || sound.id] : null;
    const P = (sound && sound.patches) || (G ? G.patches : NEUTRAL);
    const seeding = path === 'melody' && aud && (aud.dir === 'seed1' || aud.dir === 'seed2');
    // what's auditioned is the idea itself (a tune, or the riff), not a layer under it
    const auMel = aud && aud.spec && aud.spec.mel && /^(seed1|seed2|hook)$/.test(aud.dir) ? aud.spec.mel : null;
    const itself = !!auMel || !!(aud && /^(rrhythm|rnotes|weight)$/.test(aud.dir));
    const mel = auMel || (path === 'melody' ? idea.melody : hookOf(idea));
    let riff = path === 'riff' ? idea.riff : null;
    if (aud && aud.dir === 'rrhythm') riff = { r: aud.spec.r, scale: null, notes: null, weight: null };
    else if (aud && aud.dir === 'rnotes') riff = Object.assign({}, riff, { scale: aud.spec.scale, notes: aud.spec, weight: null });
    else if (aud && aud.dir === 'weight') riff = Object.assign({}, riff, { weight: aud.spec });
    const m = ideaMeter(idea, aud), STEPS = 2 * m.steps, LENGTH = STEPS * STEP_TICKS, slots = slotsOf(m);
    // swing delays the off-beat eighths; meters that move in threes (6/8, 7/8) don't swing
    const swing = m.compound ? 0 : sound ? sound.swing : kit ? kit.swing : 0;
    const shift = swing > 0.5 ? Math.round((swing * 4 - 2) * STEP_TICKS) : 0;
    const tick = (s) => s * STEP_TICKS + (mod(s, 4) === 2 ? shift : 0);
    const events = [];
    const note = (track, s, d, p, v, gap) => {
      const t = tick(s);
      const end = s + d >= STEPS ? LENGTH : tick(s + d);
      events.push({ t, d: Math.max(30, end - t - (gap == null ? 10 : gap)), p, v: Math.max(1, Math.min(127, Math.round(v))), track });
    };
    const hit = (track, s, p, v) => events.push({ t: tick(s), d: 60, p, v: Math.max(1, Math.min(127, Math.round(v))), track });
    const g = (d) => (!aud || aud.dir === d || aud.dir === 'sound' ? 1 : 0.6);
    const lead = aud && !itself && aud.dir !== 'sound' ? 0.75 : 1;
    const tracks = {};
    const track = (key, patch, vol) => { tracks[TRACK[key]] = { patch, volume: vol, mute: false, solo: false, channel: key === 'prc' || key === 'bt' || key === 'tik' ? 9 : 0 }; };

    if (mel) {
      const up = (sound && sound.up) || 0;
      track('mel', P.lead, MIX.mel * lead);
      melodyNotes(mel, aud && aud.dir === 'seed1').forEach((n) => note(TRACK.mel, n.s, n.d, n.m + up, [64, 90, 115][n.w], 14));
    }
    if (riff) {
      const vs = riffVoices(riff);
      vs.forEach((v) => { const k = v.part === 'low' ? 'rlo' : 'rhi'; track(k, sound ? (v.part === 'low' ? P.bass : P.lead) : v.patch, MIX[k] * lead); });
      riffNotes(riff).forEach((n) => vs.forEach((v) => note(TRACK[v.part === 'low' ? 'rlo' : 'rhi'], n.s, n.d, riffPitch(v, n.x, riff.scale), RIFF_VEL[n.w], 12)));
      if (!kit && (!riff.weight || itself)) {
        track('tik', P.kit, MIX.tik);
        beatsOf(m).forEach((b) => hit(TRACK.tik, b.s, DRUM.hat, b.k === 0 ? 50 : 34));
      }
    }
    if (!seeding) {
      LAYER_ORDER.forEach((d) => {
        const o = pick(d);
        if (!o) return;
        if (d === 'chords') {
          track('chd', P.chords, MIX.chd * g(d));
          o.chords.forEach((c, i) => c.pcs.forEach((pc) => note(TRACK.chd, slots[i].s, slots[i].len, 48 + c.root + mod(pc - c.root, 12), 80, 20)));
        } else if (d === 'bass' || d === 'gbass') {
          track('bas', P.bass, MIX.bas * g(d));
          o.notes.forEach((n) => note(TRACK.bas, n.s, n.d, n.m, 100, 16));
        } else if (d === 'pads') {
          track('pad', PAD_PATCH[o.voice] || 'pad-warm', MIX.pad * g(d));
          o.notes.forEach((n) => n.ms.forEach((p) => note(TRACK.pad, n.s, n.d, p, 80, 6)));
        } else if (d === 'keys') {
          if (!o.notes.length) return;
          track('kys', o.voice, MIX.kys * g(d));
          o.notes.forEach((n) => n.ms.forEach((p) => note(TRACK.kys, n.s, n.d, p, 84, 8)));
        } else if (d === 'under') {
          track('und', o.voice, MIX.und * g(d));
          o.notes.forEach((n) => n.ms.forEach((p) => note(TRACK.und, n.s, n.d, p, 76, 6)));
        } else if (d === 'perc') {
          track('prc', 'kit-perc', MIX.prc * g(d));
          o.hits.forEach((h) => hit(TRACK.prc, h.s, DRUM[h.k] || DRUM.tap, 40 + 80 * (h.v || 1)));
        } else if (d === 'beat' || d === 'pocket' || d === 'drums') {
          track('bt', P.kit, MIX.bt * g(d));
          o.k.forEach((s) => hit(TRACK.bt, s, DRUM.kick, 112));
          o.s.forEach((s) => hit(TRACK.bt, s, o.sn || DRUM.snare, 105));
          o.h.forEach((s) => hit(TRACK.bt, s, o.hp || DRUM.hat, hatVel(o, s)));
        }
      });
    }
    events.sort((a, b) => a.t - b.t);
    return { bpm: sound ? sound.bpm : pocket ? pocket.bpm : 100, length: LENGTH, loop: true, tracks, events, steps: STEPS, meter: m.id };
  }

  /** the climb, a pass at a time: what the idea was made from, then each layer added in the order it was picked */
  function climb(idea) {
    const p = pathOf(idea), out = [];
    if (p === 'melody') out.push(seq(emptyIdea(), { dir: 'seed1', spec: { mel: idea.melody } }));
    if (p === 'riff') {
      const r = idea.riff, bare = emptyIdea('riff');
      out.push(seq(Object.assign({}, bare, { riff: { r: r.r, scale: null, notes: null, weight: null } }), null));
      out.push(seq(Object.assign({}, bare, { riff: Object.assign({}, r, { weight: null }) }), null));
    }
    // a groove's first pass is its pocket, already a layer
    for (let i = p === 'groove' ? 1 : 0; i <= idea.order.length; i++) out.push(seq(upTo(idea, i), null));
    return out;
  }
  /** what Bobby says over each pass of the climb */
  function climbLines(idea) {
    const p = pathOf(idea), out = p === 'melody' ? [LINES.climbFirst, LINES.climbMelody] : LINES.climbBy[p].slice();
    idea.order.forEach((d, i) => {
      if (p === 'groove' && i === 0) return;
      const o = idea.layers[d];
      out.push(d === 'keys' && o && o.none ? '+ No chords: just drums and bass.' : '+ ' + (d === 'hook' ? 'The hook' : DIRS[d].label) + '.');
    });
    out[out.length - 1] += ' That’s gold.';
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
    return { bpm, length: at, loop: false, tracks, events, passes, steps: parts[0].steps, meter: parts[0].meter };
  }

  /** each step of how the idea got here, one per pass of the climb: [{ dir, spec, stage }] */
  function lineage(idea) {
    const p = pathOf(idea), steps = [];
    const tune = (mel, stage) => { const ns = melodyNotes(mel); return { dir: 'seed2', spec: { mel, land: mod(ns[ns.length - 1].m, 12), end: 0, leap: 0 }, stage }; };
    if (p === 'melody') steps.push({ dir: 'seed1', spec: { mel: idea.melody }, stage: 'Rhythm and scale' }, tune(idea.melody, 'Melody'));
    if (p === 'riff') steps.push({ dir: 'rrhythm', spec: { r: idea.riff.r }, stage: 'Riff rhythm' }, { dir: 'rnotes', spec: idea.riff.notes, stage: 'Riff notes' }, { dir: 'weight', spec: idea.riff.weight, stage: 'Weight' });
    idea.order.forEach((d) => steps.push(d === 'hook' ? tune(idea.layers.hook.mel, 'Hook') : { dir: d, spec: idea.layers[d], stage: DIRS[d].label }));
    return steps;
  }

  // ---------------------------------------------------------------- into the studio's ideas

  function ideaName(idea) {
    const p = pathOf(idea), s = idea.layers.sound, tail = s ? ' (' + s.name + ')' : '';
    if (p === 'groove') { const pk = idea.layers.pocket; return pk ? pk.tag + ' groove, ' + pk.bpm + tail : 'Groove'; }
    if (p === 'riff') {
      const r = idea.riff;
      if (!r) return 'Riff';
      const what = (r.notes ? r.notes.tag : riffTag(r.r)).toLowerCase(), sc = r.scale ? MODE[r.scale].name : '';
      return cap((sc && what.indexOf(sc.toLowerCase()) < 0 ? sc + ' ' : '') + what) + ' riff' + tail;
    }
    const m = idea.melody;
    if (!m) return 'Bones';
    const shape = m.shape ? SHAPE_TAG[m.shape.kind].toLowerCase() : rhythmTag(m.r).toLowerCase();
    return MODE[m.scale].name + ' ' + shape + tail;
  }
  /** the screen's top line: what it is, its tempo, its meter when not 4/4 */
  function metaOf(idea) {
    const s = idea.layers.sound, pk = idea.layers.pocket, p = pathOf(idea);
    const bpm = s ? s.bpm : pk ? pk.bpm : 100, mt = isStarted(idea) ? ideaMeter(idea).id : '4/4';
    return (s ? s.name : PATHS[p].label) + ' · 2 bars · ' + bpm + ' BPM' + (mt !== '4/4' ? ' · ' + mt : '');
  }

  /**
   * Parts for each layer, as the studio stores them (key of C, the idea's
   * scale), ready for Odd.idea.fromParts: [{ part, label }].
   */
  function toParts(idea) {
    const T = Odd.theory;
    const M = Odd.model;
    if (!T || !isDone(idea)) return [];
    const path = pathOf(idea);
    const scale = STUDIO_SCALE[scaleOf(idea)] || 'major';
    const sound = idea.layers.sound;
    const uid = (p) => (M && M.uid ? M.uid(p) : p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const QUAL = { '': 'maj', m: 'min', '°': 'dim', '+': 'aug' };
    const chords = chordsFor(idea);
    const m = ideaMeter(idea), slots = slotsOf(m);
    const prog = chords.map((c, i) => {
      const at = T.degreeOf(60 + c.root, 0, scale, 60);
      const ch = T.resolveChord ? T.resolveChord(scale, at.deg, at.acc, QUAL[c.q] || 'maj') : { deg: at.deg };
      return Object.assign(T.chordOnly(ch), { beats: slots[i].len / 4 });
    });
    const ctx = { tonic: 0, scale, prog };
    const tk = (s) => s * STEP_TICKS;
    // a part in another meter says so; parts without one are 4/4
    const meta = m.id === '4/4' ? {} : { meter: m.id };
    const pitched = (role, name, base, notes) => Object.assign({
      id: uid('p'), role, name, style: null, bars: 2, base, ctx: clone(ctx), tags: ['bones'], created: Date.now(), starred: false,
      notes: notes.map((n) => Object.assign({ t: tk(n.s), d: Math.max(30, tk(n.d) - 10), v: n.v || 96 }, T.degreeOf(n.m, 0, scale, base))),
    }, meta);
    const drums = (role, name, hits) => Object.assign({
      id: uid('p'), role, name, style: null, bars: 2, base: null, ctx: clone(ctx), tags: ['bones'], created: Date.now(), starred: false,
      notes: hits.map((h) => ({ t: tk(h.s), d: 60, p: h.p, v: h.v })).sort((a, b) => a.t - b.t),
    }, meta);
    const chordNotes = (o, v) => [].concat.apply([], o.notes.map((n) => n.ms.map((p) => ({ s: n.s, d: n.d, m: p, v }))));
    const out = [];
    const up = (sound && sound.up) || 0;
    const tune = path === 'melody' ? idea.melody : hookOf(idea);
    if (tune) out.push({ label: path === 'melody' ? 'Melody' : 'Hook', part: pitched('lead', (path === 'melody' ? 'Melody: ' : 'Hook: ') + ideaName(idea), 60 + up, melodyNotes(tune).map((n) => ({ s: n.s, d: n.d, m: n.m + up, v: [64, 90, 115][n.w] }))) });
    if (path === 'riff') {
      const r = idea.riff, vs = riffVoices(r), ns = riffNotes(r);
      const of = (part) => [].concat.apply([], ns.map((n) => vs.filter((v) => v.part === part).map((v) => ({ s: n.s, d: n.d, m: riffPitch(v, n.x, r.scale), v: RIFF_VEL[n.w] }))));
      if (vs.some((v) => v.part === 'high')) out.push({ label: 'Riff', part: pitched('lead', 'Riff: ' + ideaName(idea), 48, of('high')) });
      if (vs.some((v) => v.part === 'low')) out.push({ label: 'Riff, low', part: pitched('bass', 'Riff (low): ' + ideaName(idea), 36, of('low')) });
    }
    const kitOf = (o) => o.k.map((s) => ({ s, p: DRUM.kick, v: 112 })).concat(o.s.map((s) => ({ s, p: o.sn || DRUM.snare, v: 105 })), o.h.map((s) => ({ s, p: o.hp || DRUM.hat, v: hatVel(o, s) })));
    for (const d of idea.order) {
      const o = idea.layers[d];
      if (d === 'chords') out.push({ label: 'Chords', part: pitched('chords', 'Chords: ' + o.chords.map(chordName).join(' '), 48, [].concat.apply([], o.chords.map((c, i) => c.pcs.map((pc) => ({ s: slots[i].s, d: slots[i].len, m: 48 + c.root + mod(pc - c.root, 12), v: 80 }))))) });
      if (d === 'bass' || d === 'gbass') out.push({ label: 'Bass', part: pitched('bass', 'Bass: ' + o.tag, 36, o.notes.map((n) => ({ s: n.s, d: n.d, m: n.m, v: 100 }))) });
      if (d === 'pads') out.push({ label: 'Pads', part: pitched('pad', 'Pad: ' + o.tag, 48, chordNotes(o, 80)) });
      if (d === 'keys' && o.notes.length) out.push({ label: 'Chords', part: pitched('chords', 'Chords: ' + o.tag, 48, chordNotes(o, 84)) });
      if (d === 'under') out.push({ label: 'Under it', part: pitched('pad', 'Under: ' + o.tag, 48, chordNotes(o, 76)) });
      if (d === 'perc') out.push({ label: 'Percussion', part: drums('perc', 'Percussion: ' + o.tag, o.hits.map((h) => ({ s: h.s, p: DRUM[h.k] || DRUM.tap, v: Math.round(40 + 80 * (h.v || 1)) }))) });
      if (d === 'beat' || d === 'pocket' || d === 'drums') out.push({ label: 'Beat', part: drums('drums', 'Beat: ' + o.tag, kitOf(o)) });
    }
    return out;
  }

  /** a short example of a path for the opening cards: a random walk through its first screens, picked as a deck would deal them */
  function example(path, n) {
    return cached('ex' + path + ':' + n, () => {
      const R = rng(seedOf('ex:' + path + ':' + n));
      let S = flow.begin(flow.fresh(), path);
      const take = () => { const inf = flow.info(S); S = flow.to(S, Math.floor(R() * inf.batches)); S = flow.pick(S, Math.floor(R() * flow.options(S).length)); };
      PATHS[S.idea.path].open.forEach(take);
      ({ melody: ['chords', 'bass'], groove: [], riff: ['drums'] }[S.idea.path]).forEach((d) => { S = flow.enter(S, d); take(); });
      return seq(S.idea, null);
    });
  }
  /** Bobby, when a pick finishes a round and the idea plays */
  function pickedLine(idea, dir, own, n) {
    const p = pathOf(idea);
    if (dir === 'seed2') return p === 'melody' ? (own ? LINES.walk : line(LINES.melody, n)) : own ? LINES.hookWalk : LINES.hook;
    if (dir === 'keys') return own ? LINES.noChords : LINES.grooveDone;
    if (dir === 'weight') return LINES.riffDone;
    return line(LINES.added, n).replace('{x}', DIRS[dir].label.toLowerCase());
  }

  // ---------------------------------------------------------------- flow: pure steps for the screen

  /*
   * state = { phase: 'start' | 'round' | 'next' | 'gold', idea, round, hist, hid,
   *           sel, seq, anim, kind, added, line, msg, saved, peek }
   *   start  the opening choice (Groove, Melody, Riff); peek: the card lifted there
   *   seq   bumps whenever the cards on screen change (new round, more, request)
   *   anim  bumps whenever the screen should animate in
   *   hist  newest first: { id, dir, opts, chosen, note, idea, round, marker }
   */
  const MAX_HIST = 80;
  /** a groove that left its hook's shape round without one keeps no half-made tune */
  function settled(idea) {
    if (pathOf(idea) === 'melody' || !idea.melody || hookOf(idea) === idea.melody) return idea;
    return Object.assign({}, idea, { melody: hookOf(idea) });
  }
  const flow = {
    fresh() {
      return { phase: 'start', idea: emptyIdea(), round: null, hist: [], hid: 0, sel: -1, seq: 0, anim: 0, kind: 'pop', added: null, line: null, msg: null, saved: null, peek: null };
    },
    /** start down a path: a new idea, and its first round */
    begin(S, path) {
      const p = PATHS[path] ? path : 'melody';
      return flow.enter(Object.assign({}, S, { idea: emptyIdea(p), peek: null, saved: null }), PATHS[p].open[0]);
    },
    enter(S, dir) {
      return Object.assign({}, S, { phase: 'round', round: { dir, batch: 0, steer: { p: 0, s: 0, x: null } }, sel: -1, msg: null, line: null, seq: S.seq + 1, anim: S.anim + 1, kind: 'pop', added: null });
    },
    options(S) { return S.round ? options(S.round.dir, S.round, S.idea) : []; },
    row(S, extra) {
      const row = Object.assign({ id: S.hid + 1, dir: S.round.dir, opts: flow.options(S), chosen: -1, note: '', idea: S.idea, round: S.round }, extra);
      return { hist: [row].concat(S.hist).slice(0, MAX_HIST), hid: S.hid + 1 };
    },
    /**
     * Promote option i (or `own`, an option of the screen's own such as the
     * plain walk). A path's first screens lead into each other; a new pick
     * there starts over what was built on it (it stays in the history).
     */
    pick(S, i, own) {
      const r = S.round, o = own || flow.options(S)[i];
      if (!r || !o) return S;
      const path = pathOf(S.idea), open = PATHS[path].open, d = r.dir;
      const idea = { path, melody: S.idea.melody, riff: S.idea.riff || null, layers: Object.assign({}, S.idea.layers), order: S.idea.order.slice() };
      const note = own ? (OWN[d] ? OWN[d][1] : 'Kept it') : 'Picked ' + ABC.charAt(i) + ': ' + tagOf(d, o);
      const ns = Object.assign({}, S, flow.row(S, { chosen: own ? -1 : i, note }), { anim: S.anim + 1, msg: null, line: null, seq: S.seq + 1, idea, saved: null });
      const onward = (dir) => Object.assign(ns, { phase: 'round', round: { dir, batch: 0, steer: { p: 0, s: 0, x: null } }, sel: 1, kind: 'rise', added: null });
      const done = (added) => Object.assign(ns, { phase: 'next', round: null, sel: -1, kind: 'pop', added });
      const clear = () => { idea.layers = {}; idea.order = []; };
      if (d === 'seed1') { idea.melody = { r: o.mel.r, scale: o.mel.scale, shape: null }; return onward('seed2'); }
      if (d === 'seed2') {
        idea.melody = o.mel;
        if (path === 'melody') { clear(); return done('seed2'); }
        // a groove's hook
        idea.layers.hook = { tag: o.walk ? 'Plain walk' : shapeTag(o.mel.shape.kind, o.range), mel: o.mel };
        if (idea.order.indexOf('hook') < 0) idea.order.push('hook');
        return done('hook');
      }
      if (d === 'hook') { idea.melody = { r: o.mel.r, scale: o.mel.scale, shape: null }; return onward('seed2'); }
      if (d === 'rrhythm') { idea.riff = { r: o.r, scale: null, notes: null, weight: null }; clear(); return onward('rnotes'); }
      if (d === 'rnotes') { idea.riff = Object.assign({}, idea.riff, { scale: o.scale, notes: o, weight: null }); clear(); return onward('weight'); }
      if (d === 'weight') { idea.riff = Object.assign({}, idea.riff, { weight: o }); return done('weight'); }
      const k = open.indexOf(d);
      if (k >= 0) {
        // a groove's pocket, bass and chords: each is built on the ones before
        const layers = {};
        open.slice(0, k).forEach((x) => { if (idea.layers[x]) layers[x] = idea.layers[x]; });
        layers[d] = o;
        Object.assign(idea, { layers, order: open.slice(0, k + 1), melody: null });
        return k + 1 < open.length ? onward(open[k + 1]) : done(d);
      }
      idea.layers[d] = o;
      if (idea.order.indexOf(d) < 0) idea.order.push(d);
      return done(d);
    },
    /** the round's own way out: the plain walk for a shape, no chords for a groove */
    own(S) {
      const d = S.round && S.round.dir;
      if (d === 'seed2') return flow.pick(S, -1, walkOption(S.idea.melody));
      if (d === 'keys') return flow.pick(S, -1, NO_CHORDS);
      return S;
    },
    keepWalk(S) { return flow.own(S); },
    info(S) { return S.round ? deckInfo(S.round.dir, S.round, S.idea) : null; },
    /** the next three of the deck; past the last, the deck is shuffled and dealt again from the top */
    next(S) {
      const r = S.round, inf = flow.info(S);
      if (!inf) return S;
      const last = inf.batch >= inf.batches - 1;
      const round = last ? Object.assign({}, r, { batch: 0, deal: (r.deal || 0) + 1, seen: 0 }) : Object.assign({}, r, { batch: inf.batch + 1, seen: Math.max(r.seen || 0, inf.batch + 1) });
      return Object.assign({}, S, { round, seq: S.seq + 1, sel: -1, msg: last ? 'shuffled' : 'more', line: null, anim: S.anim + 1, kind: 'next' });
    },
    /** the three before; the first three stay put */
    prev(S) {
      const inf = flow.info(S);
      if (!inf || inf.batch === 0) return S;
      return Object.assign({}, S, { round: Object.assign({}, S.round, { batch: inf.batch - 1 }), seq: S.seq + 1, sel: -1, msg: 'prev', line: null, anim: S.anim + 1, kind: 'prev' });
    },
    /** jump to batch b of the deck (the pool strip), as far as has been dealt */
    to(S, b) {
      const inf = flow.info(S);
      if (!inf) return S;
      const t = Math.max(0, Math.min(inf.batches - 1, b));
      if (t === inf.batch) return S;
      return Object.assign({}, S, { round: Object.assign({}, S.round, { batch: t, seen: Math.max(S.round.seen || 0, t) }), seq: S.seq + 1, sel: -1, msg: t > inf.batch ? 'more' : 'prev', line: null, anim: S.anim + 1, kind: t > inf.batch ? 'next' : 'prev' });
    },
    more(S) { return flow.next(S); },
    /** a request re-rolls the three with a steer; "why" only explains. Returns the new state; play the middle one */
    request(S, rq) {
      if (rq.why) return Object.assign({}, S, { line: S.sel >= 0 ? whyText(S.round.dir, flow.options(S)[S.sel]) : S.line });
      const steer = Object.assign({}, S.round.steer);
      if (rq.p) steer.p = Math.max(-2, Math.min(2, (steer.p || 0) + rq.p));
      // shapes can get flatter one step further than the other rounds' -2
      const sLo = S.round.dir === 'seed2' ? -3 : -2;
      if (rq.s) steer.s = Math.max(sLo, Math.min(2, (steer.s || 0) + rq.s));
      if (rq.t) steer.t = Math.max(-3, Math.min(3, (steer.t || 0) + rq.t));
      if (rq.c) steer.c = Math.max(-2, Math.min(2, (steer.c || 0) + rq.c));
      const was = S.round.steer;
      const stuck = (rq.s && steer.s === (was.s || 0)) || (rq.t && steer.t === (was.t || 0)) || (rq.c && steer.c === (was.c || 0));
      if (rq.x) steer.x = steer.x === rq.x ? null : rq.x;
      let reply = rq.reply;
      if (rq.x === 'swing' && Odd.theory.meter(steer.m).compound) reply = LINES.swingCompound;
      if (rq.m) {
        // the next meter round the list; 4/4 drops the key so the steer reads as before
        const next = METER_ORDER[(METER_ORDER.indexOf(Odd.theory.meter(steer.m).id) + 1) % METER_ORDER.length];
        if (next === '4/4') delete steer.m; else steer.m = next;
        reply = meterLine(next);
      }
      return Object.assign({}, S, flow.row(S, { note: 'Before “' + rq.label + '”' }), { round: Object.assign({}, S.round, { steer, batch: 0, deal: 0, seen: 0 }), seq: S.seq + 1, sel: 1, anim: S.anim + 1, kind: 'pop', msg: null, line: stuck ? 'That’s as far as it goes.' : reply });
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
    skip(S) { return Object.assign({}, S, { phase: 'next', round: null, sel: -1, line: line(LINES.skipped, S.seq), added: null, anim: S.anim + 1, idea: settled(S.idea) }); },
    finish(S) { return Object.assign({}, S, { phase: 'gold', round: null, sel: -1, line: null, anim: S.anim + 1, idea: settled(S.idea) }); },
    keepBuilding(S) { return Object.assign({}, S, { phase: 'next', round: null, sel: -1, line: null, anim: S.anim + 1 }); },
    canFinish(S) { return isDone(S.idea) && S.phase !== 'gold'; },
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
        if (out.phase === 'round' && out.round.dir !== PATHS[pathOf(out.idea)].open[0] && !isStarted(out.idea)) return flow.fresh();
        if ((out.phase === 'next' || out.phase === 'gold') && !isDone(out.idea)) return flow.fresh();
        if (out.phase === 'round') flow.options(out); // throws on a broken idea
        out.line = null;
        return out;
      } catch (e) { return flow.fresh(); }
    },
  };

  Odd.audition = {
    STEPS, STEP_TICKS, LENGTH, ABC, NAMES, IV, DIRS, NEXT_ORDER, LAYER_ORDER, REQS, LINES, line,
    SCALES, SCALE_ORDER, MODE, SHAPES, SHAPE_TAG, GENRES, RIFF_GENRES, LEAD_WORD, TRACK, METER_ORDER,
    PATHS, PATH_ORDER, SKIP_LABEL, pathOf, isOpening, hasOpen, isDone, isStarted, ideaMeter, scaleOf, refNotes, dirSub, ownLabel,
    pocketStyles, grooveBass, keysStyles, hookStyles, riffPool, riffTag, threesOf, riffNotes, riffNoteStyles, weightStyles, riffKits, underStyles,
    riffVoices, riffPitch, chordLine, climbLines, metaOf, example, pickedLine, NO_CHORDS,
    meterOf, stepsOf, slotsOf, kitsFor, meterLine,
    makeRhythm, rhythmPool, rhythmTag, shapeOf, shapeSteps, shapeTag, sizeOf, melodyNotes, startFor,
    chordCands, chordPool, chordsFor, chordName, bassStyles, padStyles, percStyles, soundStyles,
    steerPool, deckOf, deckInfo, options, walkOption, tagOf, statOf, rankOf, comment, whyText, directions,
    emptyIdea, upTo, seq, climb, climbSeq, lineage, ideaName, toParts, flow,
  };
})(globalThis.Odd = globalThis.Odd || {});
