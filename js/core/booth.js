/* Oddition — the audition booth: listen, then keep a card, pass on it, or tweak it.
 *
 * Cards say little; Bobby knows the rest. This module measures what a card
 * actually plays (its tempo, notes, range, instrument...), turns a "no"
 * into reasons with the numbers behind them, finds a version of the card
 * changed on those reasons, or filters the deck of cards like it. Tweak
 * turns the card's own dials (Odd.tweak): what if it were brighter, busier?
 * It also holds Bobby's encyclopedia: questions a card raises, and his
 * answers, each ending in directions the deck can be steered in.
 *
 * Pure: everything takes the flow state (Odd.audition.flow) or a card and
 * gives back words or a new state.
 */
(function (Odd) {
  'use strict';
  const A = Odd.audition;
  const F = A.flow;

  // ---------------------------------------------------------------- what a card plays

  // the transport tracks a round's own cards play on (a sound changes everything)
  const OWN = {
    seed1: ['mel'], seed2: ['mel'], hook: ['mel'], rrhythm: ['rlo', 'rhi'], rnotes: ['rlo', 'rhi'], weight: ['rlo', 'rhi'],
    chords: ['chd'], bass: ['bas'], gbass: ['bas'], pads: ['pad'], keys: ['kys'], under: ['und'], perc: ['prc'],
    beat: ['bt'], pocket: ['bt'], drums: ['bt'],
  };
  const PATCH_WORD = {
    'kit-acoustic': 'a live kit', 'kit-808': 'an 808 kit', 'kit-909': 'a 909 kit', 'kit-lofi': 'a dusty kit', 'kit-perc': 'hand percussion',
    'bass-sub': 'sub bass', 'bass-saw': 'saw bass', 'bass-808': '808 bass', 'bass-pluck': 'picked bass',
    epiano: 'electric piano', keys: 'soft keys', organ: 'organ', stab: 'synth stabs', 'pad-warm': 'a warm pad', 'pad-glass': 'a glassy pad', strings: 'strings',
    'lead-square': 'a square lead', 'lead-saw': 'a saw lead', 'lead-soft': 'a soft lead', grit: 'gritty guitar', bell: 'bells', pluck: 'a pluck',
  };
  const PERC_WORD = {
    clap: 'claps', tap: 'woodblock', tapLo: 'woodblock', shaker: 'shaker', tamb: 'tambourine', rim: 'rimshot', cowbell: 'cowbell', conga: 'congas', congaLo: 'congas',
    bongo: 'bongos', bongoLo: 'bongos', claves: 'claves', agogo: 'agogô', agogoLo: 'agogô', guiro: 'guiro', tri: 'triangle',
  };
  const DRUMS = /^(perc|beat|pocket|drums)$/;
  // how bright each interval above home sounds: the major 3rd most, the minor 3rd least
  const LIGHT = { 1: -0.8, 3: -1, 4: 1, 6: 0.4, 8: -0.6, 9: 0.6, 10: -0.4, 11: 0.5 };

  const MEMO = new WeakMap();
  const listOf = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const mod = (a, n) => ((a % n) + n) % n;
  const r1 = (x) => Math.round(x * 10) / 10;

  /** what a card plays, measured: null fields don't apply to it (drums have no pitch) */
  function measure(dir, o, idea) {
    let byIdea = MEMO.get(idea);
    if (!byIdea) { byIdea = new WeakMap(); MEMO.set(idea, byIdea); }
    const hit = byIdea.get(o);
    if (hit) return hit;
    const q = A.seq(idea, { dir, spec: o });
    const own = OWN[dir] ? OWN[dir].map((k) => 'b2g-' + k) : Object.keys(q.tracks);
    const evs = q.events.filter((e) => own.indexOf(e.track) >= 0);
    const drum = (e) => q.tracks[e.track] && q.tracks[e.track].channel === 9;
    const pit = evs.filter((e) => !drum(e));
    const m = A.ideaMeter(idea, { dir, spec: o });
    const steps = q.steps || 2 * m.steps;
    const onsets = {};
    evs.forEach((e) => { onsets[Math.round(e.t / A.STEP_TICKS)] = (onsets[Math.round(e.t / A.STEP_TICKS)] || 0) + 1; });
    const at = Object.keys(onsets).map(Number);
    const offs = at.filter((s) => !m.pulses.some((p) => p.s === mod(s, m.steps))).length;
    const sound = dir === 'sound' ? o : idea.layers.sound;
    const kit = /^(pocket|beat|drums)$/.test(dir) ? o : idea.layers.pocket || idea.layers.beat || idea.layers.drums;
    const swing = m.compound ? 0 : sound ? sound.swing || 0 : kit ? kit.swing || 0 : 0;
    // instruments: the patches heard, or for hand percussion the instruments it hits
    let inst;
    if (dir === 'perc') inst = Array.from(new Set(o.hits.map((h) => PERC_WORD[h.k] || 'woodblock')));
    else inst = Array.from(new Set(own.filter((k) => q.tracks[k] && evs.some((e) => e.track === k)).map((k) => PATCH_WORD[q.tracks[k].patch] || q.tracks[k].patch)));
    const out = {
      bpm: q.bpm, steps, n: at.length, off: at.length ? offs / at.length : 0, offs, swing: swing > 0.5, meter: m.id,
      inst: inst.length ? listOf(inst) : null, drums: DRUMS.test(dir),
      lo: null, hi: null, avg: null, range: null, len: null, thick: null, mood: null,
    };
    if (pit.length) {
      const ps = pit.map((e) => e.p), dur = pit.reduce((t, e) => t + e.d, 0) || 1;
      out.lo = Math.min.apply(null, ps);
      out.hi = Math.max.apply(null, ps);
      out.range = out.hi - out.lo;
      out.avg = pit.reduce((t, e) => t + e.p * e.d, 0) / dur;
      out.len = pit.reduce((t, e) => t + e.d, 0) / pit.length / (A.STEP_TICKS * 4);
      const pon = new Set(pit.map((e) => Math.round(e.t / A.STEP_TICKS)));
      out.thick = pit.length / Math.max(1, pon.size);
      // everything is in C here: an interval above home is the pitch class
      out.mood = pit.reduce((t, e) => t + (LIGHT[mod(e.p, 12)] || 0) * e.d, 0) / dur;
      out.scale = scaleOfCard(dir, o, idea);
    }
    byIdea.set(o, out);
    return out;
  }
  function scaleOfCard(dir, o, idea) {
    if (o.mel && o.mel.scale) return o.mel.scale;
    if (o.scale && A.MODE[o.scale]) return o.scale;
    try { return A.scaleOf(idea); } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- words for numbers

  const IV_NAME = ['one note', 'a half step', 'a whole step', 'a minor 3rd', 'a major 3rd', 'a 4th', 'a tritone', 'a 5th', 'a minor 6th', 'a major 6th', 'a minor 7th', 'a major 7th', 'an octave'];
  function intervalName(st) {
    if (st <= 12) return IV_NAME[Math.max(0, st)];
    if (st < 24) return 'an octave and ' + IV_NAME[st - 12].replace(/^an? /, 'a ');
    return 'two octaves or more';
  }
  function noteName(p) { const r = Math.round(p); return A.NAMES[mod(r, 12)] + (Math.floor(r / 12) - 1); }
  function tempoWord(bpm) {
    return bpm < 70 ? 'slow, near a resting heartbeat' : bpm < 90 ? 'relaxed, a head-nodding pace' : bpm < 108 ? 'about walking pace' : bpm < 125 ? 'brisk, where a lot of dance music sits' : bpm < 145 ? 'fast' : 'very fast';
  }
  function regWord(p) {
    return p < 36 ? 'very low, down where you feel it more than hear it' : p < 48 ? 'low, in the bass' : p < 60 ? 'low-middle, under a singing voice' : p < 72 ? 'in the middle, where a voice sings' : p < 84 ? 'high' : 'very high';
  }
  function lenWord(b) { return b < 0.3 ? 'short and choppy' : b < 0.6 ? 'clipped' : b < 1.3 ? 'medium' : b < 2.5 ? 'long' : 'held'; }
  function beatsWord(b) { return b < 0.3 ? 'a quarter of a beat or less' : b < 0.7 ? 'about half a beat' : b < 1.5 ? 'about a beat' : 'about ' + Math.round(b) + ' beats'; }
  function moodWord(x) { return x < -0.35 ? 'dark: the notes that sound minor lead' : x < -0.1 ? 'a little dark' : x < 0.1 ? 'neither dark nor bright' : x < 0.35 ? 'a little bright' : 'bright: the notes that sound major lead'; }
  /** what a card's sounds are called: hits for drums and a riff's rhythm, chords when they stack */
  function unitOf(dir, m) { return DRUMS.test(dir) || dir === 'rrhythm' ? 'hits' : m && m.thick >= 1.5 && dir !== 'sound' ? 'chords' : 'notes'; }
  const semis = (n) => n + (n === 1 ? ' semitone' : ' semitones');
  function pct(x) { return Math.round(100 * x) + '%'; }

  // ---------------------------------------------------------------- why not: the reasons

  /*
   * A reason to pass on a card. val reads it off a measured card (null: it
   * doesn't apply); words says what the card has; up and down name the two
   * ways it can change; show formats a value.
   */
  const FACTORS = [
    { id: 'speed', label: 'Speed', val: (m) => m.bpm, eps: 1, up: 'faster', down: 'slower', show: (v) => Math.round(v) + ' BPM',
      words: (m) => m.bpm + ' BPM: ' + m.bpm + ' beats a minute, ' + tempoWord(m.bpm) + '.' },
    { id: 'inst', label: 'Instrument', cat: true, val: (m) => m.inst, show: (v) => v,
      words: (m) => A.cap(m.inst) + '.' },
    { id: 'rhythm', label: 'Rhythm', val: (m) => (m.n ? m.off : null), eps: 0.02, up: 'more off the beat', down: 'straighter', show: (v) => pct(v) + ' off the beat',
      words: (m, dir) => m.n + ' ' + unitOf(dir, m) + ' over two bars, ' + (m.offs ? m.offs + ' of them between the beats' : 'every one on a beat') + '. ' + (m.swing ? 'Swung: the off-beats come a little late.' : 'Straight, not swung.') },
    { id: 'pitch', label: 'Pitch', val: (m) => m.avg, eps: 0.5, up: 'higher', down: 'lower', show: (v) => 'around ' + noteName(v),
      words: (m) => 'It sits around ' + noteName(m.avg) + ', ' + regWord(m.avg) + '.' },
    { id: 'range', label: 'Range', val: (m) => m.range, eps: 0.5, up: 'wider', down: 'narrower', show: (v) => semis(Math.round(v)),
      words: (m) => (m.range ? 'From ' + noteName(m.lo) + ' up to ' + noteName(m.hi) + ': ' + semis(m.range) + ', ' + intervalName(m.range) + '.' : 'One note, ' + noteName(m.lo) + ': no range at all.') },
    { id: 'density', label: 'Density', val: (m) => m.n, eps: 0.5, up: 'busier', down: 'sparser', show: (v, dir, m) => Math.round(v) + ' ' + (Math.round(v) === 1 ? unitOf(dir, m).replace(/s$/, '') : unitOf(dir, m)),
      words: (m, dir) => m.n + ' ' + unitOf(dir, m) + ' in two bars, about ' + r1(m.n / 2) + ' a bar.' },
    { id: 'length', label: 'Note length', val: (m) => m.len, eps: 0.03, up: 'longer', down: 'shorter', show: (v) => beatsWord(v),
      words: (m) => 'Its notes last ' + beatsWord(m.len) + ' on average: ' + lenWord(m.len) + '.' },
    { id: 'thick', label: 'Thickness', val: (m) => m.thick, eps: 0.05, up: 'thicker', down: 'thinner', show: (v) => (v < 1.15 ? 'one note at a time' : 'about ' + r1(v) + ' notes at once'),
      words: (m) => (m.thick < 1.15 ? 'One note at a time.' : 'About ' + r1(m.thick) + ' notes sounding at once.') },
    { id: 'mood', label: 'Mood', val: (m) => m.mood, eps: 0.02, up: 'brighter', down: 'darker', show: (v) => moodWord(v).split(':')[0],
      words: (m) => A.cap(moodWord(m.mood)) + '.' + (m.scale && A.MODE[m.scale] ? ' Its scale is ' + A.MODE[m.scale].name + ', which sounds ' + A.MODE[m.scale].mood + '.' : '') },
  ];
  const FAC = {};
  FACTORS.forEach((f) => { FAC[f.id] = f; });

  /** every card in the round's deck as it stands (filters applied) */
  function poolOf(S) {
    return [].concat.apply([], A.deckOf(S.round.dir, S.round, S.idea).batches);
  }
  /** how a factor spreads over a pool: lo, hi, median, and whether it changes at all */
  function spread(dir, pool, idea, f) {
    const vs = pool.map((c) => f.val(measure(dir, c, idea))).filter((v) => v != null);
    if (!vs.length) return { varies: false };
    if (f.cat) return { varies: new Set(vs).size > 1, values: vs };
    const s = vs.slice().sort((a, b) => a - b);
    return { lo: s[0], hi: s[s.length - 1], med: s[Math.floor(s.length / 2)], varies: s[s.length - 1] - s[0] > f.eps };
  }
  /** where something the round can't change gets picked instead */
  function elsewhere(f, dir, idea) {
    const p = A.pathOf(idea);
    if (f.id === 'speed') return p === 'groove' ? 'The speed was set with the pocket, the groove’s first screen.' : 'The speed gets picked later, in Sound and feel.';
    if (f.id === 'inst') return dir === 'sound' ? '' : 'Instruments get picked later, in Sound and feel.';
    return '';
  }

  /** the reasons a card can be passed on for: the factors that apply to it */
  function reasonsFor(dir, o, idea) {
    const m = measure(dir, o, idea);
    return FACTORS.filter((f) => f.val(m) != null).map((f) => ({ id: f.id, label: f.label }));
  }

  /** what the card has, factor by factor, and whether this deck can change it: [{ id, label, text, fixed }] */
  function facts(S, i, ids) {
    const dir = S.round.dir, o = F.options(S)[i], idea = S.idea, m = measure(dir, o, idea), pool = poolOf(S);
    return ids.map((id) => {
      const f = FAC[id], sp = spread(dir, pool, idea, f);
      let text = f.words(m, dir);
      if (!sp.varies) text += ' Same on every card in this round. ' + elsewhere(f, dir, idea);
      return { id, label: f.label, text: text.trim(), fixed: !sp.varies };
    });
  }

  /** which way to move a factor: away from the card's end of the pool, toward the middle */
  function wayOf(v, sp) {
    if (v > sp.med) return -1;
    if (v < sp.med) return 1;
    return sp.hi - v >= v - sp.lo ? 1 : -1;
  }

  /**
   * The card again, changed on the given reasons: the card in the deck that
   * moves furthest toward the middle on each of them while staying closest
   * on everything else. { card, text } or null.
   */
  function changed(S, i, ids) {
    const dir = S.round.dir, opts = F.options(S), o = opts[i], idea = S.idea, m = measure(dir, o, idea);
    const pool = poolOf(S).filter((c) => fp(c) !== fp(o) && opts.indexOf(c) < 0);
    const all = FACTORS.map((f) => ({ f, sp: spread(dir, pool.concat([o]), idea, f) })).filter((x) => x.sp.varies && x.f.val(m) != null);
    const on = all.filter((x) => ids.indexOf(x.f.id) >= 0);
    if (!on.length) return null;
    on.forEach((x) => { if (!x.f.cat) x.way = wayOf(x.f.val(m), x.sp); });
    let best = null, bestD = Infinity;
    pool.forEach((c) => {
      const mc = measure(dir, c, idea);
      let d = 0;
      for (const x of on) {
        const a = x.f.val(m), b = x.f.val(mc);
        if (b == null) return;
        if (x.f.cat) { if (a === b) return; continue; }
        const span = x.sp.hi - x.sp.lo, move = (b - a) * x.way / span;
        if (move < 0.12) return;
        d += 0.4 * Math.abs(move - 0.35);
      }
      for (const x of all) {
        if (ids.indexOf(x.f.id) >= 0) continue;
        const a = x.f.val(m), b = x.f.val(mc);
        if (b == null) { d += 1; continue; }
        d += x.f.cat ? (a === b ? 0 : 1) : Math.abs(b - a) / (x.sp.hi - x.sp.lo);
      }
      if (d < bestD) { bestD = d; best = c; }
    });
    if (!best) return null;
    const mb = measure(dir, best, idea);
    const parts = on.map((x) => (x.f.cat ? 'on ' + x.f.val(mb) + ' instead of ' + x.f.val(m) : (x.way > 0 ? x.f.up : x.f.down) + ': ' + x.f.show(x.f.val(mb), dir, mb) + ' instead of ' + x.f.show(x.f.val(m), dir, m)));
    const kept = all.filter((x) => ids.indexOf(x.f.id) < 0).length;
    return { card: best, text: A.cap(listOf(parts)) + '.' + (kept ? ' Everything else as close as the deck allows.' : '') };
  }

  /**
   * Filters for cards like this one on the given reasons: everything at the
   * card's end of the pool and beyond, or near it when it sits in the middle.
   * Instruments: everything on the same one. { cut: [...], text } or null.
   */
  function cutsFor(S, i, ids) {
    const dir = S.round.dir, o = F.options(S)[i], idea = S.idea, m = measure(dir, o, idea), pool = poolOf(S);
    const cut = [], words = [];
    ids.forEach((id) => {
      const f = FAC[id], sp = spread(dir, pool, idea, f), v = f.val(m);
      if (!sp.varies || v == null) return;
      if (f.cat) { cut.push({ f: id, ne: v }); words.push(/ and /.test(v) ? 'anything with that same line-up' : 'anything on ' + v); return; }
      const span = sp.hi - sp.lo, tol = 0.05 * span, w = wayOf(v, sp);
      if (v !== sp.med) {
        if (w < 0) { cut.push({ f: id, lt: v - tol }); words.push('anything ' + f.show(v, dir, m).replace(/^around /, '') + ' or ' + f.up); } else { cut.push({ f: id, gt: v + tol }); words.push('anything ' + f.show(v, dir, m).replace(/^around /, '') + ' or ' + f.down); }
      } else {
        cut.push({ f: id, far: v, by: 0.15 * span });
        words.push('anything close to it on ' + f.label.toLowerCase());
      }
    });
    if (!cut.length) return null;
    return { cut, text: listOf(words) };
  }
  function passes(e, m) {
    const v = FAC[e.f].val(m);
    if (v == null) return true;
    if (e.ne != null) return v !== e.ne;
    if (e.lt != null) return v < e.lt;
    if (e.gt != null) return v > e.gt;
    return Math.abs(v - e.far) > e.by;
  }
  /** the cards a set of filters keeps; never fewer than three, the nearest misses come back first */
  function keep(dir, cards, cut, idea) {
    const fails = (c) => { const m = measure(dir, c, idea); return cut.filter((e) => !passes(e, m)).length; };
    const scored = cards.map((c) => ({ c, x: fails(c) }));
    const out = scored.filter((s) => !s.x).map((s) => s.c);
    if (out.length >= 3 || out.length === cards.length) return out;
    const back = scored.filter((s) => s.x).sort((a, b) => a.x - b.x).slice(0, 3 - out.length).map((s) => s.c);
    return out.concat(back);
  }

  /** a short fingerprint of a card, to remember the ones passed on */
  function fp(o) {
    const s = JSON.stringify(o);
    let h = 2166136261;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function isOut(S, o) { return !!(S.round && S.round.rej && o && S.round.rej.indexOf(fp(o)) >= 0); }

  // ---------------------------------------------------------------- tweaks: what if it were...
  //
  // The dials change the card itself, not which card it is (Odd.tweak has
  // the dials and how far each reaches); these read them off the round.

  /** whether this round's cards can be tweaked at all */
  function canTweak(S, i) { const o = F.options(S)[i]; return !!o && Odd.tweak.has(S.round.dir, o); }
  /** the dials for the card in slot i */
  function dials(S, i) { const o = F.options(S)[i]; return o ? Odd.tweak.dialsFor(S.round.dir, o, S.idea) : []; }
  /** Bobby's turn of a dial on the card in slot i: { id, pos, line } or null */
  function nudge(S, i, last) { const o = F.options(S)[i]; return o ? Odd.tweak.nudge(S.round.dir, o, S.idea, last) : null; }
  function isTweaked(S, i) { return Odd.tweak.tweaked(F.options(S)[i]); }
  /** a card takes slot i of the batch on screen, and lifts there */
  function swap(S, i, card) {
    const b = F.info(S).batch;
    const subs = Object.assign({}, S.round.subs);
    subs[b] = Object.assign({}, subs[b], { [i]: card });
    return Object.assign({}, S, { round: Object.assign({}, S.round, { subs }), seq: S.seq + 1, sel: i, msg: null, line: null, kind: 'pop' });
  }

  // ---------------------------------------------------------------- flow: pure steps

  const flow = {
    /** mark the card a no; it stays in its place, dimmed */
    reject(S, i, ids) {
      const o = F.options(S)[i];
      if (!o) return S;
      const rej = (S.round.rej || []).filter((x) => x !== fp(o)).concat([fp(o)]);
      const why = Object.assign({}, S.round.why, { [fp(o)]: ids });
      return Object.assign({}, S, { round: Object.assign({}, S.round, { rej, why }) });
    },
    /** the changed version takes the card's place: { S, text } or null */
    change(S, i, ids) {
      const c = changed(S, i, ids);
      if (!c) return null;
      return { S: swap(S, i, c.card), text: c.text };
    },
    /**
     * One dial turned on the card in slot i: the card itself, tweaked, takes
     * its place. { S, text, limit }; { S, same, text, limit } when the dial
     * was already there (limit: asked past where it stays itself); null
     * when it can't turn.
     */
    tune(S, i, fid, pos) {
      const o = F.options(S)[i];
      const r = o ? Odd.tweak.turn(S.round.dir, o, S.idea, fid, pos) : null;
      if (!r) return null;
      if (r.same) return { S, same: true, text: r.text, limit: r.limit };
      return { S: swap(S, i, r.card), text: r.text, limit: r.limit };
    },
    /** every dial back: the card as it came. { S, text } or null when it wasn't tweaked */
    untweak(S, i) {
      const o = F.options(S)[i];
      if (!o || !o.tw) return null;
      return { S: swap(S, i, Odd.tweak.reset(o)), text: 'Back to how it came.' };
    },
    /** filter the deck of cards like it, and deal again: { S, text, gone, left } or null */
    cut(S, i, ids) {
      const c = cutsFor(S, i, ids);
      if (!c) return null;
      const before = F.info(S).total;
      const round = Object.assign({}, S.round, { cut: (S.round.cut || []).concat(c.cut), batch: 0, seen: 0, subs: null });
      const note = 'Before filtering out ' + listOf(ids.map((id) => FAC[id].label.toLowerCase()).filter((x, k, a) => a.indexOf(x) === k));
      const ns = Object.assign({}, S, F.row(S, { note }), { round, seq: S.seq + 1, sel: -1, anim: S.anim + 1, kind: 'pop', msg: null, line: null });
      const left = F.info(ns).total;
      return { S: ns, text: c.text, gone: before - left, left };
    },
    /** every card back */
    uncut(S) {
      const round = Object.assign({}, S.round, { cut: [], batch: 0, seen: 0, subs: null });
      return Object.assign({}, S, { round, seq: S.seq + 1, sel: -1, anim: S.anim + 1, kind: 'pop', msg: null, line: 'Everything’s back in the deck.' });
    },
  };

  // ---------------------------------------------------------------- Bobby's encyclopedia

  const READY = ['I can talk about this one.', 'We can explore that.', 'Ask me about this one.', 'There’s a story in that one.'];
  const ASK_WHY = 'Why didn’t that one make the cut?';

  /*
   * A topic: a question a card raises (q), Bobby's answer (a), and the
   * requests that steer the deck that way (acts, by label; only the ones
   * the round has are offered). when: only for cards it fits.
   */
  const T = {
    tempo: {
      q: (c) => (c.m.bpm >= 118 ? 'Why do people like a fast beat?' : c.m.bpm <= 88 ? 'Why would a beat go slow?' : 'What does the speed change?'),
      a: (c) => 'This one’s at ' + c.m.bpm + ' BPM: ' + c.m.bpm + ' beats a minute, ' + tempoWord(c.m.bpm) + '. ' +
        (c.m.bpm >= 118 ? 'Fast beats move bodies. Dance music lives around 120 to 130, drum and bass up near 170. Speed is energy, and it gives each hit less time to hang in the air.'
          : c.m.bpm <= 88 ? 'Slow beats give every hit time to land, so each one feels heavier. A lot of hip hop sits between 80 and 95, slow R&B lower still. Slow isn’t lazy; it’s room.'
            : 'The middle: fast enough to move, slow enough for every hit to land. Most pop and hip hop sits around here.') +
        ' The same pattern at another speed is a different groove.',
      acts: ['Slower', 'Faster', 'More energy', 'Calmer'],
    },
    swing: {
      q: (c) => (c.m.swing ? 'What makes this one bounce?' : 'What is swing?'),
      a: (c) => 'Swing plays every second eighth note a little late, so pairs go long-short instead of even: da-DUM, da-DUM. Jazz, shuffle blues and plenty of hip hop and house use it. ' +
        (c.m.swing ? 'This one swings; that’s its bounce.' : 'This one is straight: every eighth even, which feels tighter and more machine-like, in a good way.'),
      acts: ['Swing it'],
      when: (c) => !Odd.theory.meter(c.m.meter).compound,
    },
    meter: {
      q: (c) => (c.m.meter !== '4/4' ? 'Why count it in ' + c.m.meter + '?' : 'Does music always count in four?'),
      a: (c) => {
        const mt = Odd.theory.meter(c.m.meter);
        return c.m.meter !== '4/4'
          ? 'This one is in ' + mt.id + ': ' + mt.feel + '. Most music you hear is in four, so your body keeps expecting a beat that comes early or late here. That little surprise is the attraction. Waltzes live in three, a lot of folk rolls in 6/8, and prog rock loves five and seven.'
          : 'Mostly, yes: four beats to a bar, which is why bands count “one, two, three, four”. But three gives a waltz its sway, 6/8 rolls, and five or seven feel like a limp you start to enjoy. The count decides where the strong beats fall.';
      },
      acts: ['Another meter'],
    },
    offbeat: {
      q: (c) => (c.m.off >= 0.3 ? 'Why put hits between the beats?' : 'Why keep it right on the beat?'),
      a: (c) => (c.m.off >= 0.3
        ? pct(c.m.off) + ' of this one’s ' + unitOf(c.dir, c.m) + ' land between the beats. That’s syncopation: the rhythm leans against the pulse your foot is tapping, and that lean is what makes it groove. Funk, reggae and Latin music are built on it.'
        : 'Most of this one lands right on the beat (' + (c.m.n - c.m.offs) + ' of ' + c.m.n + '). On-the-beat rhythms are easy to follow and easy to dance to: four-on-the-floor house, marching bands, a lot of rock. They sound sure of themselves. The opposite is syncopation: hits between the beats that lean against the pulse.'),
      acts: ['Straighter', 'Looser', 'Against the beat', 'With the riff', 'Against it'],
    },
    density: {
      q: (c) => (c.rk === 'high' ? 'When is busy better?' : c.rk === 'low' ? 'Why leave so much space?' : 'How busy should a part be?'),
      a: (c) => {
        const n = c.m.n + ' ' + unitOf(c.dir, c.m) + ' in two bars';
        if (c.rk === 'high') return 'This one has ' + n + '. Busy parts bring energy and motion, and they work best when something else holds still: busy hats over a slow bass, a fast riff over long chords. Two busy parts at once start to fight.';
        if (c.rk === 'low') return 'This one has just ' + n + '. Space is part of rhythm: the gaps let each note land and leave room for other parts to answer. Plenty of great hooks are three or four notes.';
        return n + ': room to breathe, enough to move. The trick is balance. When one part gets busier, another usually gets simpler.';
      },
      acts: ['Busier', 'Sparser', 'Simpler', 'More drive', 'Calmer'],
    },
    scale: {
      q: (c) => { const md = A.MODE[c.m.scale]; return 'What makes ' + md.name + ' sound ' + md.mood + '?'; },
      a: (c) => 'A scale is the set of notes a tune is allowed to use, usually seven of the twelve. Which ones it keeps sets the mood before a note is played. ' + A.MODE[c.m.scale].why,
      acts: ['Darker scale', 'Brighter scale', 'Darker', 'Brighter'],
      when: (c) => !!(c.m.scale && A.MODE[c.m.scale]),
    },
    landing: {
      q: () => 'Why does where it ends matter?',
      a: (c) => 'This one lands on the ' + A.IV[c.o.land] + '. Ending on home, the note the scale is built on, sounds finished, like a full stop. Ending anywhere else sounds like a comma or a question and makes you want the next bar. Songs often pair them: a phrase that asks, then one that answers.',
      acts: ['Land on home'],
      when: (c) => c.o.land != null,
    },
    contour: {
      q: (c) => (c.o.size === 2 || c.o.leap >= 3 ? 'Why do big leaps stand out?' : 'Why do small moves work?'),
      a: (c) => (c.o.size === 2 || c.o.leap >= 3
        ? 'Big moves are the event: the ear jumps with them, so they’re what people remember. Too many and a tune gets tiring to follow, which is why singable melodies mostly step and save the leap for the moment that matters.'
        : 'Small steps are easy to sing and easy to remember. When the notes barely move, rhythm and repetition carry the hook. Lots of famous choruses use three or four neighbouring notes.') +
        (c.m.range != null ? ' This one spans ' + intervalName(c.m.range) + '.' : ''),
      acts: ['Subtler', 'Bigger', 'More jumps'],
    },
    chordfit: {
      q: () => 'How do chords fit a melody?',
      a: (c) => 'Each chord here was picked so the melody’s long, strong notes belong to it: ' + c.o.fit + '% of this melody sits on chord notes. When a melody note is in the chord under it, they blend. When it isn’t, it rubs, and the ear wants it to move. A bit of rub is spice; a lot is a clash.',
      acts: ['Darker', 'Brighter'],
      when: (c) => c.o.fit != null,
    },
    chordmood: {
      q: () => 'Why do some chords sound sad?',
      a: (c) => {
        const cs = c.o.chords || [], mi = cs.filter((x) => x.q === 'm').length;
        return 'A chord is usually three notes stacked a third apart. Lower the middle one by a half step and major becomes minor: that one note is most of what we hear as happy or sad.' +
          (cs.length ? ' This one: ' + A.chordLine(cs) + '. ' + (mi ? mi + ' of its ' + cs.length + ' chords are minor.' : 'All major.') : '');
      },
      acts: ['Darker', 'Brighter'],
      when: (c) => !!(c.o.chords && c.o.chords.length && (c.dir !== 'under' || c.o.changes)),
    },
    borrowed: {
      q: (c) => (c.o.chords.some((x) => x.colour) ? 'Why does a chord from outside the scale work?' : 'Can chords come from outside the scale?'),
      a: (c) => {
        const col = c.o.chords.find((x) => x.colour);
        return (col ? A.chordName(col) + ' isn’t in the scale. ' : 'They can. ') + 'Borrowing a chord from a neighbouring key is an old trick; the Beatles did it constantly. It works when the melody note above it belongs to the borrowed chord, so the surprise has a reason. The ear hears colour, not a mistake.';
      },
      acts: ['Surprise me'],
      when: (c) => !!c.o.chords,
    },
    basslock: {
      q: (c) => (c.o.lock > 0.6 ? 'Why hit with the melody?' : c.o.lock < 0.3 ? 'Why play in the gaps?' : 'Should the bass follow the melody?'),
      a: (c) => (c.o.lock > 0.6 ? 'When bass and melody hit together they sound like one bigger instrument, and the rhythm gets louder. That’s how a lot of rock and funk unisons hit so hard.'
        : c.o.lock < 0.3 ? 'Playing in the melody’s gaps is call and response: one speaks, the other answers. Each stays clear because they never talk at once. It’s as old as work songs and gospel.'
          : 'Most bass lines do a bit of both: hit with the melody on the strong beats so the chord is clear, then move in the gaps.'),
      acts: ['Lock tighter', 'Busier', 'Simpler'],
      when: (c) => c.o.lock != null,
    },
    bassroot: {
      q: () => 'What does a bass line actually do?',
      a: (c) => 'Two jobs. It tells your ear which chord you’re on, mostly by playing the chord’s root (the note it’s named after) on the strong beats. And it locks with the drums, so the rhythm has weight. When the bass leaves the root, the chord sounds less sure, which can be lovely.' +
        (c.m.lo != null ? ' This one: ' + c.m.n + ' notes, from ' + noteName(c.m.lo) + ' to ' + noteName(c.m.hi) + '.' : ''),
      acts: ['Simpler', 'Busier'],
    },
    kicklock: {
      q: (c) => (c.o.lock > 0.6 ? 'Why lock the bass to the kick?' : 'Why play between the kicks?'),
      a: (c) => (c.o.lock > 0.6 ? 'Bass and kick are both low. When they land together they fuse into one big thump: that’s the punch of most dance music and hip hop.'
        : 'When the bass plays between the kicks, the two take turns filling the low end, so it bounces instead of thumps. Funk and reggae bass lines live there.'),
      acts: ['Simpler', 'Busier'],
      when: (c) => c.o.lock != null,
    },
    grooveharm: {
      q: () => 'How can a bass line make the chords?',
      a: (c) => (c.o.move === 'stay'
        ? 'This one stays on ' + A.chordName(c.o.chords[0]) + '. A groove that sits on one chord is a vamp: funk, Afrobeat and a lot of house do it for minutes, so all the interest is in the rhythm.'
        : 'This one moves through ' + A.chordLine(c.o.chords) + '. Nobody plays a chord, but the bass notes alone tell your ear where the harmony goes. Two chords swaying back and forth is one of the most common moves in pop and soul.'),
      acts: ['Darker', 'Brighter'],
      when: (c) => !!(c.o.chords && c.o.move),
    },
    heldchop: {
      q: (c) => (c.m.len != null && c.m.len < 0.6 ? 'Why chop the chords up?' : 'Why hold the chords?'),
      a: (c) => (c.m.len != null && c.m.len < 0.6
        ? 'Short, chopped chords join the drums. In funk it’s the chank, in reggae the skank on the backbeat: the chord becomes a rhythm part.'
        : 'Held chords give the groove a floor, a bed everything else sits on. Soul, gospel and lo-fi lean on them.'),
      acts: ['More held', 'More chopped'],
      when: (c) => !c.o.none,
    },
    nochords: {
      q: () => 'Does a groove need chords at all?',
      a: (c) => 'No. Plenty of grooves are just drums and bass: the bass already says where the harmony is. Leaving chords out leaves room for a voice or a hook later.' + (c.o.none ? ' This one has none.' : ''),
      acts: [],
    },
    voicing: {
      q: (c) => (c.m.thick > 2.2 ? 'What does a fuller chord add?' : 'Why so few notes at once?'),
      a: (c) => 'This one plays ' + FAC.thick.show(c.m.thick) + '. A chord’s voicing is which notes you play and how you stack them. More notes spread wide sound rich and fill the room; two or three close together sound lean and leave space. Sevenths add a fourth note that makes chords sound jazzier and softer.',
      acts: ['Fuller', 'Thinner'],
      when: (c) => c.m.thick != null,
    },
    register: {
      q: () => 'Why does it matter how high it sits?',
      a: (c) => 'This one sits around ' + noteName(c.m.avg) + ', ' + regWord(c.m.avg) + '. Every part needs its own floor in the range. Low parts carry weight but turn muddy when they crowd together; high parts sparkle but get thin. Pads usually sit above the bass and around or under the tune, so they glue without getting in the way.',
      acts: ['Higher'],
      when: (c) => c.m.avg != null,
    },
    padjob: {
      q: () => 'What is a pad for?',
      a: () => 'A pad is a long, soft sound that fills the space between the bass and the tune, like the air in a room. You barely notice it until it’s gone. A second voice, a harmony a third above or below, does the same job with a tune of its own.',
      acts: ['Fuller', 'Thinner'],
    },
    percjob: {
      q: () => 'What does hand percussion add?',
      a: (c) => 'Shakers and tambourines keep a steady pulse between the big hits; claps and woodblocks mark the accents. They’re the small motion that makes a part feel alive, even before there’s a drum kit. This one: ' + c.m.n + ' hits, on ' + c.m.inst + '.',
      acts: ['More drive', 'Calmer', 'Follow the melody'],
    },
    backbeat: {
      q: () => 'Why is the snare usually on 2 and 4?',
      a: () => 'That’s the backbeat. The kick takes the strong beats, 1 and 3, and the snare answers on 2 and 4. Rock, pop, soul and hip hop are built on it. Move the snare and the whole feel changes: half-time puts it only on 3, and it feels twice as heavy.',
      acts: ['Harder'],
      when: (c) => c.m.meter === '4/4',
    },
    genre: {
      q: (c) => 'What makes this one ' + String(c.o.name || 'that style').split(/,| with /)[0].toLowerCase() + '?',
      a: (c) => 'A genre is a bundle of habits: a tempo range, a drum kit, a few typical sounds, swing or no swing. Change those and the same tune moves house. This one: ' + c.m.bpm + ' BPM, ' + c.m.inst + (c.m.swing ? ', swung' : '') + '.' + (c.o.why ? ' ' + A.cap(c.o.why) + '.' : ''),
      acts: ['More energy', 'Calmer', 'Surprise me'],
    },
    timbre: {
      q: () => 'Why does the instrument change the feel?',
      a: (c) => 'The same notes on another instrument can feel like another song. Every instrument has its own tone, or timbre: how bright it is, how it starts (plucked, bowed, hit) and how it fades. A saw synth is buzzy and modern, an electric piano warm, a gritty guitar aggressive. This one: ' + c.m.inst + '.',
      acts: ['Surprise me', 'Heavier', 'Lighter'],
      when: (c) => !!c.m.inst,
    },
    hookgaps: {
      q: () => 'Where should a hook sit in a groove?',
      a: (c) => 'In the gaps. ' + Math.round(100 * (1 - (c.o.clash || 0))) + '% of this hook’s notes land where the bass and kick are quiet. Notes there get heard; notes on top of the kick get swallowed. Think of it as a conversation: the groove talks, the hook answers.',
      acts: ['In the gaps', 'Busier', 'Sparser'],
    },
    riffstick: {
      q: () => 'What makes a riff stick?',
      a: (c) => 'Repetition and accents. A riff repeats until it’s part of the furniture, and its hard hits are what you remember. Put those accents off the beat and the riff pulls against the drums; that pull is why some riffs stay in your head for days. This one: ' + c.m.n + ' hits, ' + pct(c.m.off) + ' between the beats.',
      acts: ['Straighter', 'Against the beat', 'Busier', 'Sparser'],
    },
    riffnotes: {
      q: (c) => (c.o.distinct <= 2 ? 'Why so few notes?' : 'How many notes should a riff use?'),
      a: (c) => 'Fewer than you’d think. Many famous riffs use two or three notes and let the rhythm do the rest. More notes make a riff travel, more like a tune; fewer make it stubborn and heavy. This one uses ' + c.o.distinct + ' different notes across ' + intervalName(c.o.span || 0) + '.',
      acts: ['Simpler', 'Wider'],
      when: (c) => c.o.distinct != null,
    },
    outside: {
      q: (c) => (c.o.odd ? 'Why play notes outside the scale?' : 'Can a riff break the scale?'),
      a: (c) => 'It can. Notes from outside the scale rub, and in a riff that rub is attitude: the blues lives on the note between the 4th and 5th, and metal leans on the half step above home. The repeating rhythm holds it together, so the clash sounds meant.' + (c.o.odd ? ' This one does it.' : ''),
      acts: ['Stranger'],
    },
    power: {
      q: () => 'What is a power chord?',
      a: () => 'Two notes: a root and the 5th above it. With no 3rd it isn’t major or minor, so it sounds hard and neutral, and it stays clear even through heavy distortion. That’s why rock and metal riffs are built on them.',
      acts: ['Heavier', 'Lighter'],
    },
    doubling: {
      q: () => 'Why double a riff?',
      a: (c) => 'Doubling, the same riff on two instruments or in two octaves, makes it thicker and heavier without adding a single new note. A bass an octave under a guitar is the classic.' + (c.o.words ? ' This one: ' + c.o.words + '.' : ''),
      acts: ['Heavier', 'Lighter'],
    },
    drumsriff: {
      q: (c) => (c.o.follow > 0.6 ? 'Why have the kick follow the riff?' : 'Why play drums against the riff?'),
      a: (c) => (c.o.follow > 0.6 ? 'When the kick doubles the riff, they hit as one huge sound. That’s how heavy music gets heavy.'
        : 'Drums against the riff make two rhythms at once: the riff pulls one way, the beat holds the other. That tension keeps a repeating riff from going stale.'),
      acts: ['With the riff', 'Against it', 'Harder'],
      when: (c) => c.o.follow != null,
    },
    drone: {
      q: (c) => (c.o.changes ? 'Why move the chords under a riff?' : 'What does a drone do?'),
      a: (c) => (c.o.changes
        ? 'The riff stays the same while the chords under it change (' + A.chordLine(c.o.chords) + '), so the same notes take on a new colour each time. That’s how one riff can carry a whole song.'
        : 'A drone is one note, or a note and its 5th, held underneath. Every note of the riff rubs against it a little differently, so the drone makes the riff’s tension audible. Indian classical music, bagpipes and doom metal all love one.'),
      acts: ['Stiller', 'More movement'],
    },
  };
  const TOPICS = {
    seed1: ['scale', 'offbeat', 'density', 'meter'],
    seed2: ['landing', 'contour', 'density'],
    chords: ['chordfit', 'chordmood', 'borrowed'],
    bass: ['basslock', 'bassroot', 'density'],
    perc: ['percjob', 'offbeat', 'density'],
    beat: ['backbeat', 'offbeat', 'density'],
    pads: ['padjob', 'voicing', 'register'],
    sound: ['genre', 'tempo', 'timbre', 'swing'],
    pocket: ['tempo', 'offbeat', 'swing', 'backbeat', 'meter', 'density'],
    gbass: ['grooveharm', 'kicklock', 'bassroot', 'scale'],
    keys: ['heldchop', 'voicing', 'nochords'],
    hook: ['hookgaps', 'density', 'offbeat'],
    rrhythm: ['riffstick', 'offbeat', 'meter', 'density'],
    rnotes: ['riffnotes', 'scale', 'outside'],
    weight: ['power', 'doubling', 'timbre'],
    drums: ['drumsriff', 'backbeat', 'density'],
    under: ['drone', 'voicing', 'chordmood'],
  };

  function ctxOf(S, i) {
    const dir = S.round.dir, opts = F.options(S), o = opts[i];
    return { dir, o, opts, i, idea: S.idea, m: measure(dir, o, S.idea), rk: A.rankOf(opts, i) };
  }
  /** the questions this card raises, most telling first: [{ id, q }]. An odd meter jumps the queue */
  function questions(S, i) {
    const c = ctxOf(S, i);
    let ids = (TOPICS[c.dir] || []).filter((id) => !T[id].when || T[id].when(c));
    if (c.m.meter !== '4/4' && ids.indexOf('meter') > 0) ids = ['meter'].concat(ids.filter((x) => x !== 'meter'));
    return ids.map((id) => ({ id, q: T[id].q(c) }));
  }
  /** Bobby's answer, and the requests (by index into REQS[dir]) that steer the deck that way */
  function answer(S, i, id) {
    const c = ctxOf(S, i), t = T[id];
    return { text: t.a(c), acts: actsOf(c.dir, t.acts) };
  }
  function actsOf(dir, labels) {
    const reqs = A.REQS[dir] || [];
    return labels.map((l) => reqs.findIndex((r) => r.label === l)).filter((k) => k >= 0);
  }
  /** "?": what this card is, set against the other two, and why it works; then every way to steer */
  function explain(S, i) {
    const dir = S.round.dir, opts = F.options(S);
    const reqs = A.REQS[dir] || [];
    return { text: A.comment(dir, opts, i, S.idea) + ' ' + A.whyText(dir, opts[i], S.idea), acts: reqs.map((r, k) => (r.why ? -1 : k)).filter((k) => k >= 0) };
  }
  function ready(n) { return READY[mod(n || 0, READY.length)]; }

  Odd.booth = {
    FACTORS, TOPICS, TOPIC: T, READY, ASK_WHY, OWN,
    measure, reasonsFor, facts, changed, cutsFor, keep, fp, isOut, poolOf,
    canTweak, dials, nudge, isTweaked,
    questions, answer, explain, ready, intervalName, noteName,
    flow,
  };
})(globalThis.Odd = globalThis.Odd || {});
