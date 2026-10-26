/* Oddition — who leads: how the parts of a section fit to each other.
 *
 * Primacy has two sides, measured separately:
 *   salience   does a part stand out? Height, movement, playing where the
 *              others leave space; a part that repeats itself bar after bar
 *              sinks back a little. It is relative: in a section of drums and
 *              a pad, the drums are what you hear.
 *   authority  are other parts shaped by it? It comes from links.
 * At most half the parts stand out: the foreground is a minority.
 * Together they put each part in one of four boxes:
 *
 *                   steers others   fits to others
 *     stands out    hook            topline
 *     background    groove          bed
 *
 * A link points from a follower to the part it fits to:
 *   logged    what a take did when it listened to its section (part.heard)
 *   measured  what the notes show: onsets that land on another part's hits
 *             (lock) or keep off them (avoid), notes in another part's gaps
 *             (answer). Both ways at once is a pair (move together, trade).
 * Pitched parts that refit follow the section's chords; that link goes to
 * the harmony, which is not a lane, and does not count as a lane steering.
 * Unless a tune sets the chords (Odd.harmonise): then every part bent to
 * them follows that tune (harmony links), and the tune steers.
 *
 * Only what is heard counts: muted lanes are left out, and with any lane
 * soloed only the soloed ones count.
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const STEP = T.STEP, BAR = T.BAR;
  const SPB = BAR / STEP; // steps per bar

  const BOXES = {
    hook: { label: 'Hook', stands: true, steers: true, blurb: 'Stands out, and other parts are built around it.' },
    topline: { label: 'Topline', stands: true, steers: false, blurb: 'Stands out, and fits itself over the others.' },
    groove: { label: 'Groove', stands: false, steers: true, blurb: 'Sits back, and other parts lock to it.' },
    bed: { label: 'Bed', stands: false, steers: false, blurb: 'Sits back, filling and supporting.' },
  };
  const BOX_ORDER = ['hook', 'topline', 'groove', 'bed'];

  /** how much a role tends to be heard as foreground, before its notes are looked at */
  const PRIOR = { lead: 0.75, arp: 0.45, chords: 0.35, bass: 0.3, pad: 0.12, drums: 0.35, perc: 0.2 };
  /** salience, relative to the most salient part, needed to stand out */
  const STAND = 0.85;
  /** authority needed to steer */
  const STEER = 0.45;
  const LOCK = 0.55, PAIR = 0.6, ANSWER = 0.5, AVOID = 0.75;
  /** how much each kind of link shapes the part it points to */
  const PULL = { lock: 1, avoid: 0.9, answer: 0.9, clear: 0.4, pair: 0.6, trade: 0.4, harmony: 0.8 };
  const ROLE_OF = { drums: 'drums', percussion: 'perc', bass: 'bass', chords: 'chords', pad: 'pad', lead: 'lead', arp: 'arp' };

  /** what part.heard says, as links. `to` is a role. */
  const HEARD = [
    { re: /^Locks to the kick$/, to: 'drums', kind: 'lock', kick: true },
    { re: /^Plays between the kicks$/, to: 'drums', kind: 'avoid', kick: true },
    { re: /^Kick leans on the bass$/, to: 'bass', kind: 'lock' },
    { re: /^Kick keeps clear of the bass$/, to: 'bass', kind: 'avoid' },
    { re: /^Leaves the kick room$/, to: 'drums', kind: 'avoid', kick: true },
    { re: /^Leaves room for the lead/, to: 'lead', kind: 'answer' },
    { re: /^Moved (?:up|down) an octave to clear the (\w+)$/, to: (m) => ROLE_OF[m[1]], kind: 'clear' },
    { re: /^Plays (?:sparser|a little busier)/, to: null, kind: 'balance' },
  ];

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  /** the verb that agrees with a lane name: "Bass locks", "Drums lock" */
  function verb(name, one, many) { return /[^s]s$/i.test(String(name || '').trim()) ? many : one; }

  /** one heard line as { to (role or null), kind, kick }, or null */
  function readHeard(line) {
    for (const h of HEARD) {
      const m = h.re.exec(String(line || ''));
      if (!m) continue;
      return { to: typeof h.to === 'function' ? h.to(m) : h.to, kind: h.kind, kick: !!h.kick };
    }
    return null;
  }

  // ---------------- one part's profile ----------------

  function profile(lane, steps) {
    const drum = T.isDrumRole(lane.role);
    const on = new Set(), kick = new Set(), hits = new Set();
    const sound = new Uint8Array(steps);
    const line = new Map(); // step -> the pitch the ear follows
    for (const e of lane.events || []) {
      const s = Math.round(e.t / STEP);
      if (s < 0 || s >= steps) continue;
      on.add(s);
      if (drum) {
        const c = Odd.idea ? Odd.idea.drumClass(e.p) : e.p === 35 || e.p === 36 ? 0 : 1;
        if (c === 0) kick.add(s);
        if (c < 2) hits.add(s);
        sound[s] = 1;
        continue;
      }
      const end = Math.min(steps, Math.max(s + 1, Math.round((e.t + e.d) / STEP)));
      for (let j = s; j < end; j++) sound[j] = 1;
      const cur = line.get(s);
      if (cur == null || (lane.role === 'bass' ? e.p < cur : e.p > cur)) line.set(s, e.p);
    }
    // what the part follows with, and what others can lock to
    const follows = drum && lane.role === 'drums' && kick.size >= 2 ? kick : on;
    const offers = drum ? [kick.size >= 2 ? { set: kick, kick: true } : null, hits.size ? { set: hits, kick: false } : null].filter(Boolean) : [{ set: on, kick: false }];
    let sounding = 0;
    for (let j = 0; j < steps; j++) sounding += sound[j];
    return { lane, drum, on, kick, hits, sound, sounding, line, follows, offers };
  }

  /** bars that repeat an earlier bar exactly, as a fraction of the bars after the first */
  function repetition(P, bars) {
    if (bars < 2) return 0;
    const sig = [];
    for (let b = 0; b < bars; b++) {
      const bits = [];
      for (let s = b * SPB; s < (b + 1) * SPB; s++) if (P.on.has(s)) bits.push((s - b * SPB) + ':' + (P.line.get(s) != null ? P.line.get(s) : ''));
      sig.push(bits.join(','));
    }
    let same = 0;
    for (let b = 1; b < bars; b++) if (sig[b] && sig.slice(0, b).includes(sig[b])) same++;
    return same / (bars - 1);
  }

  /**
   * How much a part stands out, before comparing it with the others.
   * others: onsets of the section's other melodic parts (not pads or drums).
   */
  function salienceOf(P, others, bars) {
    const n = P.on.size;
    const role = P.lane.role;
    if (!n) return { score: 0, height: 0, motion: 0, space: 0, repeat: 0 };
    const perBar = n / bars;
    let height, motion;
    if (P.drum) {
      height = role === 'perc' ? 0.35 : 0.25;
      motion = 0.3;
    } else {
      const ps = [...P.line.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
      height = clamp((mean - 45) / 35, 0, 1);
      let changes = 0;
      for (let i = 1; i < ps.length; i++) if (ps[i] !== ps[i - 1]) changes++;
      motion = (ps.length > 1 ? changes / (ps.length - 1) : 0) * Math.sqrt(Math.min(1, perBar / 6));
    }
    let alone = 0;
    for (const s of P.on) if (!others.has(s)) alone++;
    const space = alone / n;
    const repeat = repetition(P, bars);
    let score = 0.4 * (PRIOR[role] != null ? PRIOR[role] : 0.3) + 0.2 * height + 0.2 * motion + 0.2 * space - 0.1 * repeat;
    if (perBar < 0.5) score *= perBar / 0.5;
    return { score: Math.max(0, score), height, motion, space, repeat };
  }

  // ---------------- measured links ----------------

  const SPBEAT = T.BEAT / STEP;

  /**
   * How much A's off-beat onsets land on `set`, beyond chance: 1 always, 0
   * chance. Notes on the beat are left out, since every part plays there.
   * Sure only with enough notes: the score shrinks below 8 of them.
   */
  function lockOf(A, set, steps) {
    const off = [...A.follows].filter((s) => s % SPBEAT !== 0);
    if (off.length < 4 || !set.size) return null;
    let hit = 0, bOff = 0;
    for (const s of off) if (set.has(s)) hit++;
    for (const s of set) if (s % SPBEAT !== 0) bOff++;
    const room = steps - steps / SPBEAT;
    const chance = room > 0 ? bOff / room : 0;
    if (!bOff || chance > 0.6) return null;
    const ratio = hit / off.length;
    const sure = Math.min(1, off.length / 8);
    return { lock: ((ratio - chance) / (1 - chance)) * sure, ratio, chance, n: off.length };
  }

  /** how much A keeps off B's kicks, beyond chance (house bass between a four-on-the-floor kick) */
  function avoidOf(A, B, steps) {
    if (!B.drum || B.kick.size < 2 || A.lane.role === 'drums' || A.on.size < 6) return null;
    const chance = B.kick.size / steps;
    if (chance < 0.12) return null;
    let hit = 0;
    for (const s of A.on) if (B.kick.has(s)) hit++;
    const ratio = hit / A.on.size;
    return { avoid: clamp(1 - ratio / chance, 0, 1) * Math.min(1, A.on.size / 12), ratio };
  }

  /** how much of A's sound falls in B's gaps, beyond chance */
  function answerOf(A, B, steps) {
    if (A.drum || B.drum || A.lane.role === 'pad' || B.lane.role === 'pad') return null;
    const rest = 1 - B.sounding / steps;
    if (rest < 0.2 || rest > 0.75 || A.on.size < 4 || !A.sounding) return null;
    let inRest = 0;
    for (let j = 0; j < steps; j++) if (A.sound[j] && !B.sound[j]) inRest++;
    const ratio = inRest / A.sounding;
    return { answer: ((ratio - rest) / (1 - rest)) * Math.min(1, A.on.size / 8), ratio };
  }

  /** the strongest lock of A onto B: { lock, kick, ratio } */
  function rhythmOf(A, B, steps) {
    let best = null;
    for (const o of B.offers) {
      const r = lockOf(A, o.set, steps);
      if (r && (!best || r.lock > best.lock)) best = Object.assign({ kick: o.kick }, r);
    }
    return best;
  }

  // ---------------- a section ----------------

  /**
   * lanes: [{ id, role, name, events: [{ t, d, p, v }] (ticks from the
   *          section start), heard: [string], fits (pitched: follows the
   *          section's chords; null for drums), leads (its tune sets the chords) }]
   * opts: { length (ticks) }
   * Returns { lanes: [{ id, role, name, salience, rel, authority, box, stands,
   *           steers, why, notes }], links: [{ from, to, kind, strength,
   *           logged, measured, mutual, kick, text }], harmony: { follow, own, leader },
   *           top (lane id of the part with the most primacy, or null) }
   */
  function analyse(lanes, opts) {
    const length = Math.max(STEP, (opts && opts.length) || BAR);
    const steps = Math.max(1, Math.round(length / STEP));
    const bars = Math.max(1, length / BAR);
    const list = (lanes || []).filter((l) => l && l.events && l.events.length);
    const P = list.map((l) => profile(l, steps));
    const byId = new Map(P.map((p) => [p.lane.id, p]));
    const name = (id) => byId.get(id).lane.name;

    // salience, then relative to the most salient part
    const melodic = (p) => !p.drum && p.lane.role !== 'pad';
    const sal = P.map((p) => {
      const others = new Set();
      for (const q of P) if (q !== p && melodic(q)) for (const s of q.on) others.add(s);
      return salienceOf(p, others, bars);
    });
    const top = Math.max(1e-6, ...sal.map((x) => x.score));
    const topPart = P[sal.findIndex((x) => x.score === top)] || null;

    // links, keyed by pair
    const links = new Map();
    const key = (a, b) => a + '>' + b;
    const add = (l) => {
      for (const f in l) if (l[f] === undefined) delete l[f];
      const k = key(l.from, l.to);
      const cur = links.get(k);
      if (!cur || l.strength > cur.strength) links.set(k, Object.assign({}, cur || {}, l, { logged: !!((cur && cur.logged) || l.logged) }));
      else if (l.logged) cur.logged = true;
    };
    const notes = new Map(P.map((p) => [p.lane.id, []]));

    // measured
    for (const A of P) {
      for (const B of P) {
        if (A === B) continue;
        const r = rhythmOf(A, B, steps);
        const back = rhythmOf(B, A, steps);
        if (r && back && r.lock >= PAIR && back.lock >= PAIR) {
          if (A.lane.id < B.lane.id) add({ from: A.lane.id, to: B.lane.id, kind: 'pair', strength: Math.min(r.lock, back.lock), measured: Math.min(r.ratio, back.ratio), mutual: true });
          continue;
        }
        if (r && r.lock >= LOCK) add({ from: A.lane.id, to: B.lane.id, kind: 'lock', strength: clamp(r.lock, 0, 1), measured: r.ratio, kick: r.kick });
        const v = avoidOf(A, B, steps);
        if (v && v.avoid >= AVOID) add({ from: A.lane.id, to: B.lane.id, kind: 'avoid', strength: v.avoid, measured: 1 - v.ratio, kick: true });
        const a = answerOf(A, B, steps);
        const b = answerOf(B, A, steps);
        if (a && b && a.answer >= ANSWER && b.answer >= ANSWER) {
          if (A.lane.id < B.lane.id) add({ from: A.lane.id, to: B.lane.id, kind: 'trade', strength: Math.min(a.answer, b.answer), measured: Math.min(a.ratio, b.ratio), mutual: true });
        } else if (a && a.answer >= ANSWER && !(r && r.lock >= LOCK)) {
          add({ from: A.lane.id, to: B.lane.id, kind: 'answer', strength: clamp(a.answer, 0, 1), measured: a.ratio });
        }
      }
    }

    // logged: what the take did when it listened
    for (const A of P) {
      for (const line of A.lane.heard || []) {
        const h = readHeard(line);
        if (!h) continue;
        if (h.kind === 'balance') { notes.get(A.lane.id).push(line); continue; }
        for (const B of P) {
          if (B === A || B.lane.role !== h.to) continue;
          const pair = links.get(key(A.lane.id, B.lane.id)) || links.get(key(B.lane.id, A.lane.id));
          // a take that listened says who adapted: a trade becomes an answer
          if (pair && pair.mutual && !(pair.kind === 'trade' && h.kind === 'answer')) { pair.logged = true; continue; }
          if (pair && pair.mutual) links.delete(key(pair.from, pair.to));
          add({ from: A.lane.id, to: B.lane.id, kind: h.kind, strength: 0.85, logged: true, kick: h.kick, measured: pair && pair.mutual ? pair.measured : undefined });
        }
      }
    }

    // a follower draws at most its two strongest links (pairs are kept)
    const out = [];
    for (const A of P) {
      const mine = [...links.values()].filter((l) => l.from === A.lane.id && !l.mutual).sort((x, y) => y.strength - x.strength);
      for (const l of mine.slice(0, 2)) out.push(l);
    }
    for (const l of links.values()) if (l.mutual) out.push(l);
    // a tune that sets the chords shapes every part bent to them
    const leader = P.find((p) => p.lane.leads && !p.drum) || null;
    if (leader) {
      for (const p of P) {
        if (p === leader || p.drum || !p.lane.fits) continue;
        const r = p.lane.role;
        out.push({ from: p.lane.id, to: leader.lane.id, kind: 'harmony', strength: r === 'chords' || r === 'pad' ? 1 : r === 'bass' ? 0.85 : 0.7, logged: true });
      }
    }
    for (const l of out) { l.text = linkText(l, name); l.detail = detailOf(l, name); }

    // authority: chance that at least one follower is shaped by the part
    const auth = new Map(P.map((p) => [p.lane.id, 1]));
    for (const l of out) {
      const pull = clamp(l.strength * (PULL[l.kind] || 0.5), 0, 0.98);
      auth.set(l.to, auth.get(l.to) * (1 - pull));
      if (l.mutual) auth.set(l.from, auth.get(l.from) * (1 - pull));
    }

    const follow = [], own = [];
    for (const p of P) {
      if (p.drum || p.lane.fits == null || p === leader) continue;
      (p.lane.fits ? follow : own).push(p.lane.id);
    }

    // the foreground is a minority: at most half the parts stand out
    const order = sal.map((x, i) => i).sort((a, b) => sal[b].score - sal[a].score);
    const room = Math.max(1, Math.floor(P.length / 2));
    const res = P.map((p, i) => {
      const id = p.lane.id;
      const rel = sal[i].score / top;
      const authority = 1 - auth.get(id);
      const stands = rel >= STAND && order.indexOf(i) < room;
      const steers = authority >= STEER;
      const box = stands ? (steers ? 'hook' : 'topline') : steers ? 'groove' : 'bed';
      return {
        id, role: p.lane.role, name: p.lane.name, part: p.lane.part,
        salience: sal[i].score, rel, authority, stands, steers, box,
        why: whyOf(sal[i], stands, steers, out.filter((l) => l.to === id || (l.mutual && l.from === id)), id, name, topPart).concat(p === leader ? ['Sets the chords'] : []),
        follows: out.filter((l) => l.from === id || (l.mutual && l.to === id)).length + (follow.includes(id) ? 1 : 0),
        notes: notes.get(id),
      };
    });
    // the part with the most primacy: a hook, else what stands out most, else what steers most
    const rank = (r) => (r.box === 'hook' ? 3 : r.box === 'topline' ? 2 : r.box === 'groove' ? 1 : 0);
    let lead = null;
    for (const r of res) {
      if (!lead) { lead = r; continue; }
      const d = rank(r) - rank(lead);
      if (d > 0 || (d === 0 && (r.box === 'groove' ? r.authority > lead.authority : r.rel > lead.rel))) lead = r;
    }
    return { lanes: res, links: out, harmony: { follow, own, leader: leader ? leader.lane.id : null }, top: lead ? lead.id : null, length };
  }

  function linkText(l, name) {
    const a = name(l.from), b = name(l.to);
    switch (l.kind) {
      case 'lock': return a + verb(a, ' locks to ', ' lock to ') + (l.kick ? 'the kick in ' + b : b);
      case 'avoid': return a + verb(a, ' plays between ', ' play between ') + (l.kick ? 'the kicks in ' + b : b + '\'s notes');
      case 'answer': return a + verb(a, ' answers ', ' answer ') + b + ' in ' + verb(b, 'its', 'their') + ' gaps';
      case 'clear': return a + ' moved an octave to clear ' + b;
      case 'pair': return a + ' and ' + b + ' move together';
      case 'trade': return a + ' and ' + b + ' trade phrases';
      case 'harmony': return a + verb(a, ' fits to ', ' fit to ') + 'the chords ' + b + verb(b, ' sets', ' set');
      default: return a + verb(a, ' fits to ', ' fit to ') + b;
    }
  }

  /** the evidence for a link, in words */
  function detailOf(l, name) {
    if (l.kind === 'harmony') return 'The section\'s chords are worked out from ' + name(l.to) + '\'s notes';
    const pct = l.measured != null ? Math.round(l.measured * 100) + '%' : '';
    const said = l.logged ? 'It listened for this when it was made' : '';
    let seen = '';
    if (pct) {
      if (l.kind === 'lock') seen = pct + ' of its off-beat notes land with it';
      else if (l.kind === 'avoid') seen = pct + ' of its notes miss the kick';
      else if (l.kind === 'answer') seen = pct + ' of the time it sounds, the other is resting';
      else if (l.kind === 'pair') seen = pct + ' of their off-beat notes land together';
      else if (l.kind === 'trade') seen = 'Each plays mostly while the other rests';
    }
    return [seen, said].filter(Boolean).join('. ');
  }

  /** a part's box in words: why it stands out or sits back, and who it steers */
  function whyOf(s, stands, steers, incoming, id, name, topP) {
    const out = [];
    if (stands) {
      const bits = [];
      if (s.height >= 0.6) bits.push('high');
      if (s.motion >= 0.45) bits.push('moving');
      if (s.space >= 0.5) bits.push('in the gaps');
      out.push(bits.length ? 'Stands out: ' + bits.join(', ') : 'Stands out: the most present part here');
    } else {
      const bits = [];
      if (s.repeat >= 0.6) bits.push('repeats');
      if (s.space < 0.3) bits.push('plays with the others');
      if (s.height < 0.35) bits.push('low');
      out.push(bits.length ? 'Sits back: ' + bits.join(', ') : topP && topP.lane.id !== id ? 'Sits back behind ' + topP.lane.name : 'Sits back');
    }
    const who = [...new Set(incoming.map((l) => name(l.from === id ? l.to : l.from)))];
    if (steers && who.length) out.push('Shapes ' + who.join(', '));
    return out;
  }

  /** the lanes a section plays, as heard: muted lanes out, and only soloed ones if any are */
  function sectionLanes(session, section) {
    const R = Odd.render;
    const solo = session.lanes.some((l) => l.solo);
    const out = [];
    for (const lane of session.lanes) {
      const slot = section.slots && section.slots[lane.id];
      if (!slot || !slot.part) continue;
      if (lane.mute || (solo && !lane.solo)) continue;
      const events = R.sectionEvents(session, section, { only: lane.id, shape: false });
      if (!events.length) continue;
      const drum = T.isDrumRole(lane.role);
      out.push({
        id: lane.id, role: lane.role, name: lane.name, part: slot.part.name, events,
        heard: slot.part.heard || [],
        fits: drum ? null : slot.refit !== false && !slot.part.imported,
        leads: !drum && !!Odd.harmonise && Odd.harmonise.leaderOf(section) === lane.id,
      });
    }
    return out;
  }

  function forSection(session, section) {
    return analyse(sectionLanes(session, section), { length: section.bars * BAR });
  }

  /** every section of the song order, in order: [{ index, section, fit }] (each section measured once) */
  function song(session) {
    const seen = new Map();
    const out = [];
    session.arrangement.forEach((sid, index) => {
      const section = session.sections.find((x) => x.id === sid);
      if (!section) return;
      if (!seen.has(sid)) seen.set(sid, forSection(session, section));
      out.push({ index, section, fit: seen.get(sid) });
    });
    return out;
  }

  Odd.relate = { BOXES, BOX_ORDER, HEARD, readHeard, verb, analyse, sectionLanes, forSection, song, STAND, STEER };
})(globalThis.Odd = globalThis.Odd || {});
