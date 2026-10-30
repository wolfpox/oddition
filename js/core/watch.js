/* Oddition — Watch Bobby: he builds an idea himself and says why at every step.
 *
 * Odd.watch.plan({ seed, path, brief }) works out the whole run up front as a
 * list of steps over Odd.audition.flow states: the same decks, requests and
 * words the Idea Builder uses. The cards are never ranked. Bobby starts from
 * a brief, a mood set on five qualities (dark or bright, calm or driving,
 * airy or full, straight or loose, light or heavy). Each round's three cards
 * are spread along one quality (AXIS), so he takes the card at the end the
 * brief points to, or the middle one when the brief doesn't lean. Every pick
 * comes with a reason, and the two he passed over stay valid choices.
 *
 * step = { kind, S, say, hear, i }
 *   kind  brief | enter | request | more | hear | choose | why | ways | done
 *   hear  a card index on S's screen, 'all' (the idea so far), or null
 *   i     the card a choose/why step is about (-1: the round's own way out)
 * S.watch = { brief, path, log } grows as he decides:
 *   log entry = { dir, label, pick, stat, reason, why, others, asked }
 */
(function (Odd) {
  'use strict';
  const A = Odd.audition;
  const F = A.flow;

  // the five qualities a brief sets, and their words at each end
  const TRAITS = { dark: ['dark', 'bright'], energy: ['calm', 'driving'], space: ['airy', 'full'], lean: ['straight', 'loose'], weight: ['light', 'heavy'] };

  const BRIEFS = {
    late: { label: 'Late night', line: 'dark, slow, lots of air, a little loose', t: { dark: -1, energy: -1, space: -1, lean: 1, weight: 0 }, paths: { groove: 2, melody: 2, riff: 1 } },
    stomp: { label: 'Stomp', line: 'heavy, straight and hard, a bit dark', t: { dark: -1, energy: 1, space: 0, lean: -1, weight: 1 }, paths: { groove: 1, melody: 1, riff: 3 } },
    sunny: { label: 'Sunny', line: 'bright, busy, light on its feet', t: { dark: 1, energy: 1, space: 1, lean: 0, weight: -1 }, paths: { groove: 2, melody: 3, riff: 1 } },
    lazy: { label: 'Lazy afternoon', line: 'slow and loose, nothing in a hurry', t: { dark: 0, energy: -1, space: -1, lean: 1, weight: -1 }, paths: { groove: 3, melody: 2, riff: 1 } },
    tense: { label: 'Tense', line: 'dark and busy, leaning against the beat', t: { dark: -1, energy: 1, space: 1, lean: 1, weight: 0 }, paths: { groove: 1, melody: 2, riff: 2 } },
    wide: { label: 'Wide open', line: 'calm and bright, straight, lots of room', t: { dark: 1, energy: -1, space: -1, lean: -1, weight: -1 }, paths: { groove: 1, melody: 3, riff: 1 } },
    plain: { label: 'Middle of the road', line: 'nothing pushed anywhere, so you can hear each part do its job', t: { dark: 0, energy: 0, space: 0, lean: 0, weight: 0 }, paths: { groove: 1, melody: 1, riff: 1 } },
  };
  const BRIEF_ORDER = Object.keys(BRIEFS);

  // the quality each round's three are spread along (low a = the trait's first word, high a = its second)
  const AXIS = {
    seed1: 'space', seed2: 'energy', chords: 'dark', bass: 'weight', perc: 'energy', beat: 'lean', pads: 'space', sound: 'energy',
    pocket: 'lean', gbass: 'weight', keys: 'energy', hook: 'space', rrhythm: 'lean', rnotes: 'space', weight: 'weight', drums: 'lean', under: 'space',
  };
  // requests he makes before listening, when the brief leans that way: [trait, { side: the request's label }]
  const ASKS = {
    seed1: [['dark', { '-1': 'Darker scale', 1: 'Brighter scale' }]],
    seed2: [['space', { '-1': 'Subtler', 1: 'Bigger' }]],
    bass: [['space', { '-1': 'Simpler', 1: 'Busier' }]],
    pocket: [['energy', { '-1': 'Slower', 1: 'Faster' }], ['lean', { 1: 'Swing it' }]],
    gbass: [['dark', { '-1': 'Darker', 1: 'Brighter' }]],
    keys: [['space', { '-1': 'Thinner', 1: 'Fuller' }]],
    rrhythm: [['space', { '-1': 'Sparser', 1: 'Busier' }]],
    rnotes: [['dark', { '-1': 'Darker', 1: 'Brighter' }]],
    drums: [['weight', { 1: 'Harder' }]],
  };
  const FIRST = { seed1: true, pocket: true, rrhythm: true }; // rounds with Another meter

  const PATH_WHY = {
    groove: 'I’ll start with a groove: the beat and the bass set the feel, and the feel is the brief.',
    melody: 'I’ll start with a melody: a tune first, then everything built to hold it up.',
    riff: 'I’ll start with a riff: one stubborn figure, and the rest built around it.',
  };
  // the ways on he takes after the first screens, in order, and why
  function waysFor(path, t) {
    const out = [];
    if (path === 'melody') {
      out.push('chords', 'bass');
      if (t.energy >= 0 || t.lean > 0) out.push('perc');
      if (out.indexOf('perc') >= 0 && (t.energy > 0 || t.lean > 0) && t.weight >= 0) out.push('beat');
      if (t.space >= 0 || t.energy < 0) out.push('pads');
    } else if (path === 'groove') {
      if (t.space >= 0) out.push('hook');
      if (t.lean > 0 || t.energy > 0) out.push('perc');
      if (t.energy < 0 || t.space > 0) out.push('pads');
    } else {
      out.push('drums', 'under');
      if (t.energy > 0 || t.lean > 0) out.push('perc');
    }
    out.push('sound');
    return out;
  }
  const WAY = {
    chords: () => 'Chords first: the bass and everything after lean on them.',
    bass: (t) => 'A bass to hold the floor' + (t.weight > 0 ? '. The brief is heavy, so it matters.' : '.'),
    perc: (t) => t.lean > 0 ? 'Percussion: the brief is loose, and claps and taps can lean.' : 'Percussion, for motion' + (t.energy > 0 ? ': the brief is driving.' : '.'),
    beat: () => 'Now I grow those claps into a full beat.',
    pads: (t) => t.space < 0 ? 'Pads, but thin: a shadow, so the air stays.' : 'Pads, to fill the space around it.',
    hook: () => 'A hook on top. The brief wants it full, so the groove gets a tune.',
    drums: () => 'Drums first: a riff needs to know where the beat is.',
    under: (t) => t.space < 0 ? 'Something under it. The brief is airy, so I’m expecting a drone.' : 'Something under it, to give the riff some colour.',
    sound: () => 'Last, the sound: instruments, tempo and swing. It comes last so the idea could live in many genres.',
  };
  const LEFT_OUT = {
    perc: 'percussion (the parts carry the rhythm themselves)',
    beat: 'a full beat (claps and taps were enough)',
    pads: 'pads (I wanted air around it)',
    hook: 'a hook (the groove is the idea, so I left the space)',
  };

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
    for (const k in W) tot += W[k];
    let x = R() * tot;
    for (const k in W) { x -= W[k]; if (x <= 0) return k; }
    return Object.keys(W)[0];
  }
  const word = (trait, v) => TRAITS[trait][v > 0 ? 1 : 0];
  const quote = (s) => '“' + s + '”';
  function joinAnd(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }

  /** a round's name in his mouth: a groove's shape round is its hook's */
  function roundLabel(S, dir) { return dir === 'seed2' && A.pathOf(S.idea) !== 'melody' ? 'The hook’s shape' : A.DIRS[dir].label; }

  /** what he listens for in a round, from the brief */
  function intent(S, t) {
    const dir = S.round.dir, tr = AXIS[dir], v = t[tr], D = A.DIRS[dir], inf = F.info(S);
    const head = roundLabel(S, dir) + ': ' + inf.total + ' in the deck. ';
    if (!v) return head + 'The brief doesn’t push this one either way, so I’m after the middle, between ' + quote(D.low) + ' and ' + quote(D.high) + '.';
    return head + 'The brief is ' + word(tr, v) + ', so I’m listening for ' + quote(v > 0 ? D.high : D.low) + '.';
  }

  /** the card the brief points to: the low end, the high end or the middle of the three (they're dealt sorted along the axis) */
  function target(opts, v) {
    if (opts.length < 2) return 0;
    if (v < 0) return 0;
    if (v > 0) return opts.length - 1;
    return Math.floor((opts.length - 1) / 2);
  }

  /**
   * The whole run. opts: { seed, path, brief } (path and brief are picked
   * from the seed when not given). Returns { path, brief, steps }.
   */
  function plan(opts) {
    const o = opts || {};
    const seed = o.seed == null ? 1 : o.seed;
    const R = rng(seed);
    const bid = BRIEFS[o.brief] ? o.brief : BRIEF_ORDER[Math.floor(R() * BRIEF_ORDER.length)];
    const B = BRIEFS[bid], t = B.t;
    const path = A.PATHS[o.path] ? o.path : weighted(R, B.paths);
    const steps = [];
    let log = [];
    const watch = () => ({ brief: bid, path, seed, log });
    const push = (kind, S, say, hear, i) => { steps.push({ kind, S: Object.assign({}, S, { watch: watch() }), say, hear: hear == null ? null : hear, i: i == null ? null : i }); };

    let S = Object.assign(F.fresh(), { peek: path });
    push('brief', S, 'Sit back: I’ll build one and tell you why as I go. Today’s brief: ' + B.label + '. That means ' + B.line + '. ' + PATH_WHY[path]);
    S = F.begin(Object.assign({}, S, { peek: null }), path);

    /** one round, from what he listens for to the card he takes; returns the state after the pick */
    const round = () => {
      const dir = S.round.dir, tr = AXIS[dir], v = t[tr], asked = [];
      push('enter', S, intent(S, t));
      const reqs = A.REQS[dir] || [];
      const ask = (rq, say) => { S = F.request(S, rq); asked.push(rq.label); push('request', S, say); };
      // now and then, out of 4/4
      if (FIRST[dir] && R() < 0.3) {
        const rq = reqs.find((q) => q.m);
        const n = R() < 0.5 ? 1 : 2;
        for (let k = 0; k < n; k++) { S = F.request(S, rq); }
        asked.push(rq.label + (n > 1 ? ' (twice)' : ''));
        push('request', S, 'Not 4/4 this time. ' + S.line);
      }
      (ASKS[dir] || []).forEach(([trait, sides]) => {
        const side = t[trait], label = side && sides[side];
        // dark or bright is a scale, and asking is the only way to steer it; the rest he asks for most of the time
        if (!label || asked.length >= 2 || (trait !== 'dark' && R() > 0.75)) return;
        const rq = reqs.find((q) => q.label === label);
        if (!rq) return;
        if (rq.x === 'swing' && Odd.theory.meter(S.round.steer.m).compound) return;
        ask(rq, label + ': the brief is ' + word(trait, side) + '. ' + (rq.reply || ''));
      });
      const listen = () => {
        const opts = F.options(S);
        opts.forEach((_, i) => push('hear', Object.assign({}, S, { sel: i }), A.comment(dir, opts, i, S.idea), i));
      };
      S = Object.assign({}, S, { sel: -1 });
      listen();
      const inf = F.info(S);
      // now and then, three more from somewhere further into the deck
      if (inf.batches > 1 && R() < 0.3) {
        const b = 1 + Math.floor(R() * (inf.batches - 1));
        S = Object.assign(F.to(S, b), { sel: -1 });
        push('more', S, 'Let me hear three more before I choose, from further into the deck. ' + inf.total + ' cards fit this round; the first three are just the clearest.');
        listen();
      }
      const opts = F.options(S);
      // the round's own way out, when the brief asks for less
      const ownNow = (dir === 'keys' && t.space < 0 && t.energy <= 0 && R() < 0.6) || (dir === 'seed2' && A.pathOf(S.idea) === 'melody' && bid === 'plain' && R() < 0.35);
      const i = ownNow ? -1 : target(opts, v);
      const others = opts.map((_, j) => j).filter((j) => j !== i);
      const name = (j) => A.ABC.charAt(j) + ' (' + A.tagOf(dir, opts[j]) + ')';
      let reason, why, othersLine;
      if (ownNow) {
        reason = dir === 'keys'
          ? 'None of them: no chords. The brief wants air, and the bass already says where the harmony is.'
          : 'None of them: the plain walk. The brief is middle of the road, and the walk through the scale already makes a tune.';
        why = dir === 'keys' ? A.whyText('keys', A.NO_CHORDS) : 'A shape pushes a tune somewhere: up like a question, down like an answer. The plain walk doesn’t push, which is what this brief asks for.';
        othersLine = 'Any of the three would fit; they’d just fill space this idea wants empty.';
      } else {
        const o2 = opts[i], D = A.DIRS[dir];
        reason = A.ABC.charAt(i) + ', ' + A.tagOf(dir, o2) + '. ' + (v
          ? 'Of these three it’s furthest toward ' + quote(v > 0 ? D.high : D.low) + ', and the brief is ' + word(tr, v) + '.'
          : 'It sits between the other two, and the brief keeps this part in the middle.');
        why = A.whyText(dir, o2, S.idea);
        othersLine = others.length ? joinAnd(others.map(name)) + (others.length > 1 ? ' fit too' : ' fits too') + (v
          ? '. Nothing wrong with ' + (others.length > 1 ? 'them' : 'it') + '; ' + (others.length > 1 ? 'they’re' : 'it’s') + ' just less ' + word(tr, v) + '.'
          : ', one each side of the middle.') : '';
      }
      const entry = { dir, label: roundLabel(S, dir), pick: ownNow ? A.ownLabel(dir) : A.ABC.charAt(i) + ' · ' + A.tagOf(dir, opts[i]), stat: ownNow ? '' : A.statOf(dir, opts[i]), reason, why, others: othersLine, asked };
      log = log.concat([entry]);
      const at = Object.assign({}, S, { sel: i });
      push('choose', at, reason + (othersLine ? ' ' + othersLine : ''), ownNow ? null : i, i);
      push('why', at, 'Why it works: ' + why, ownNow ? null : i, i);
      const before = S;
      S = ownNow ? F.own(S) : F.pick(S, i);
      S = Object.assign({}, S, { watch: watch() });
      return { dir, own: ownNow, before };
    };

    // the first screens, in order
    let last = null;
    while (S.phase === 'round') last = round();
    // then the ways on
    const ways = waysFor(path, t);
    ways.forEach((d, k) => {
      const lead = k === 0 ? A.pickedLine(S.idea, last.dir, last.own, S.seq) : 'Here’s where it stands.';
      push('ways', S, lead + ' Next: ' + A.DIRS[d].label.toLowerCase() + '. ' + WAY[d](t), 'all');
      S = F.enter(S, d);
      do last = round(); while (S.phase === 'round'); // a hook goes on to its shape
    });
    S = F.finish(S);
    const left = A.PATHS[path].next.filter((d) => ways.indexOf(d) < 0 && LEFT_OUT[d]).map((d) => LEFT_OUT[d]);
    push('done', S, 'That’s the idea: ' + A.ideaName(S.idea) + '. ' + (left.length ? 'I left out ' + joinAnd(left) + '. ' : '') + 'Every card I passed over fit as well; the brief is what chose. Watch another, or take this one and keep building.', 'all');
    return { path, brief: bid, steps };
  }

  /** the run as plain text, for notes: the brief, then each round's pick, reason and the ones passed over */
  function transcript(w) {
    if (!w) return '';
    const B = BRIEFS[w.brief];
    const lines = ['Bobby built a ' + A.PATHS[w.path].label.toLowerCase() + '. Brief: ' + (B ? B.label + ' (' + B.line + ')' : w.brief) + '.', ''];
    w.log.forEach((e, n) => {
      lines.push((n + 1) + '. ' + e.label + ': ' + e.pick + (e.stat ? ' (' + e.stat + ')' : ''));
      if (e.asked && e.asked.length) lines.push('   Asked for: ' + e.asked.join(', '));
      lines.push('   ' + e.reason);
      lines.push('   Why it works: ' + e.why);
      if (e.others) lines.push('   ' + e.others);
    });
    return lines.join('\n');
  }

  Odd.watch = { TRAITS, BRIEFS, BRIEF_ORDER, AXIS, plan, transcript, waysFor };
})(globalThis.Odd = globalThis.Odd || {});
