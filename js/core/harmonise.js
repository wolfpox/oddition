/* Oddition — melody first: chords chosen to fit a tune.
 *
 * Normally a section's chords lead: every pitched part is bent to them
 * (refit). A section can hand the lead to a tune instead. The tune then
 * plays as written, the section's chords are worked out from its notes, and
 * every other part fits to those chords, so the tune steers the harmony.
 *
 * The harmoniser cuts the section into half-bar slots and scores each chord
 * against the tune's notes in it: chord tones are good, a note a semitone off
 * a chord tone clashes, other notes are passing colour. Long notes and notes
 * on the beat count most. It then picks the best path through the slots:
 * changing chord costs a little (more in the middle of a bar, unless the
 * style moves two chords a bar), chords from outside the key cost more, and
 * a root falling a fifth (V to I) is a little cheaper. Where the tune rests,
 * the chords the section had before stay.
 *
 * section.lead = { lane, variant, prev, refit }
 *   lane     the lane whose part sets the chords
 *   variant  0 = the best fit; higher numbers are other good fits
 *   prev     the chords before the tune took over (restored on release)
 *   refit    the slot's refit before it led (restored on release)
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const BEAT = T.BEAT, BAR = T.BAR;
  const SLOT = 2 * BEAT; // half a bar

  /** extra chords worth trying, by scale family (plain chords of the scale are always tried) */
  const COLOUR = {
    major: [['V7', 4], ['iv'], ['bVI'], ['bVII'], ['V/V', 4], ['V/vi', 5], ['V/ii', 1], ['V7/IV', 3]],
    minor: [['V', 0], ['V7', 0], ['IV'], ['V/iv', 3], ['V/III', 2]],
  };

  const candCache = new Map();
  /** the chords a tune in `scale` may get: [{ chord, tones, root, deg, prior, to }] */
  function candidates(scale) {
    if (candCache.has(scale)) return candCache.get(scale);
    const out = [];
    const seen = new Set();
    const add = (chord, prior, to) => {
      const sh = T.chordShape(chord, scale);
      const root = T.mod(sh.root, 12);
      const tones = [0, sh.third, sh.fifth].concat(chord.sev ? [sh.seventh] : []);
      const key = root + ':' + tones.join(',');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ chord: T.chordOnly(chord), root, deg: T.mod(chord.deg, 7), third: sh.third, fifth: sh.fifth, seventh: sh.seventh, sev: !!chord.sev, prior, to: to == null ? null : to, plain: T.isDiatonic(chord) });
    };
    for (let d = 0; d < 7; d++) {
      const q = T.chordQuality(d, scale);
      add({ deg: d }, q === 'maj' || q === 'min' ? 0 : q === 'dim' ? 1 : 1.6);
    }
    const fam = (T.SCALES[scale] || T.SCALES.minor).family;
    for (const [tok, to] of COLOUR[fam]) {
      const c = T.parseChord(tok, scale);
      if (!c) continue;
      add(c, (T.isDiatonic(c) ? 0.15 : 0.55) + (c.sev ? 0.1 : 0), to);
    }
    candCache.set(scale, out);
    return out;
  }

  /** how well one note (pitch class above the tonic) sits on a chord */
  function noteScore(pc, c) {
    const i = T.mod(pc - c.root, 12);
    if (i === 0) return 1.1;
    if (i === c.third || i === c.fifth) return 1;
    if (c.sev && i === c.seventh) return 0.9;
    if (i === c.seventh) return 0.3; // adds the seventh: colour, not a clash
    const tones = [0, c.third, c.fifth];
    let d = 12;
    for (const x of tones) d = Math.min(d, Math.abs(i - x), 12 - Math.abs(i - x));
    return d <= 1 ? -1 : 0.05;
  }

  /** how much a note counts in a slot: its length there, more on the beat */
  function weightIn(n, a, b) {
    const s = Math.max(a, n.t), e = Math.min(b, n.t + n.d);
    if (e <= s) return 0;
    // a short note is still heard as that pitch: it counts as at least an 8th
    const beats = n.t < a ? Math.min(2, (e - s) / BEAT) : Math.max(0.5, Math.min(2, (e - s) / BEAT));
    let accent;
    if (n.t < a) accent = 0.6; // held over from before
    else if (n.t === a) accent = 1.6;
    else if (n.t % BEAT === 0) accent = 1.25;
    else if (n.t % (BEAT / 2) === 0) accent = 1;
    else accent = 0.7;
    return beats * accent;
  }

  /** root motion from chord j to chord k */
  function motion(j, k) {
    if (j.to != null) return k.deg === j.to ? -0.3 : 0.4; // V/V wants to go to V
    const dd = T.mod(k.deg - j.deg, 7);
    if (dd === 3) return -0.15; // down a fifth
    if (dd === 2 || dd === 5) return 0.1;
    return 0.05;
  }

  /**
   * Chords for a tune.
   * events: the tune's notes, { t, d, p } with absolute pitches.
   * opts: { tonic, scale, bars, rate (chords per bar the style likes: 0.5 | 1 | 2),
   *         color (0..1, how readily chords leave the key), variant, prev (a progression) }
   * Returns { prog, chords: [{ chord, start, beats, fit, notes }], fit (share of the
   *           tune's weight on chord tones), heard (the tune had notes) }
   */
  function harmonise(events, opts) {
    const o = opts || {};
    const scale = o.scale || 'major';
    const bars = Math.max(1, o.bars || 4);
    const rate = o.rate || 1;
    const color = o.color != null ? o.color : 0.3;
    const tonic = T.mod(o.tonic || 0, 12);
    const cands = candidates(scale);
    const K = cands.length;
    const S = bars * 2;
    const notes = (events || []).filter((e) => e.p != null && e.d > 0);
    const prior = cands.map((c) => (c.plain ? c.prior : c.prior * (1.6 - color)));

    // each slot: the tune's weight on every chord, and how much tune there is
    const base = [];
    const amount = [];
    const pcs = [];
    for (let t = 0; t < S; t++) {
      const a = t * SLOT, b = a + SLOT;
      const row = new Array(K).fill(0);
      let w = 0;
      const heard = new Set();
      for (const n of notes) {
        const x = weightIn(n, a, b);
        if (!x) continue;
        const pc = T.mod(n.p - tonic, 12);
        heard.add(pc);
        w += x;
        for (let k = 0; k < K; k++) row[k] += x * noteScore(pc, cands[k]);
      }
      base.push(row);
      amount.push(w);
      pcs.push(heard);
    }
    const heard = amount.some((w) => w > 0);
    // costs are in the same units as the tune's weight: a sparse tune pays less to change chord
    const busy = amount.filter((w) => w > 0).sort((x, y) => x - y);
    const unit = busy.length ? Math.max(0.4, Math.min(1.2, busy[Math.floor(busy.length / 2)] / 2.5)) : 1;

    // where the tune rests, the old chords stay
    const prev = o.prev && o.prev.length ? o.prev : null;
    const keep = (t, k) => {
      if (!prev) return 0;
      const c = cands[k];
      const was = T.chordAt(prev, t * SLOT).chord;
      const sh = T.chordShape(was, scale);
      const same = T.mod(sh.root, 12) === c.root && sh.third === c.third && sh.fifth === c.fifth;
      return same ? 0.9 * Math.max(0, 1 - amount[t]) : 0;
    };

    const fam = (T.SCALES[scale] || T.SCALES.minor).family;
    const homeRel = fam === 'major' ? 5 : 2; // vi in major, III in minor
    const change = (t) => {
      const mid = t % 2 === 1;
      if (mid) return rate >= 2 ? 0.1 : rate >= 1 ? 0.8 : 1.4;
      if (rate < 1 && t % 4 === 2) return 0.5;
      return 0;
    };

    const solve = (noise) => {
      const score = base.map((row, t) => row.map((x, k) => {
        let v = x + unit * (keep(t, k) + (noise ? noise(t, k) : 0));
        const c = cands[k];
        if (t === 0 && c.plain) v += unit * (c.deg === 0 ? 0.45 : c.deg === homeRel ? 0.15 : 0);
        if (t === S - 1 && [4, 3, 6].includes(c.deg)) v += unit * 0.15;
        return v;
      }));
      // best path through the slots
      let val = score[0].map((x, k) => x - unit * (0.3 + prior[k]));
      const back = [];
      for (let t = 1; t < S; t++) {
        const nv = new Array(K);
        const bk = new Array(K);
        for (let k = 0; k < K; k++) {
          let best = -Infinity, arg = 0;
          for (let j = 0; j < K; j++) {
            const cost = j === k ? 0 : unit * (0.3 + prior[k] + change(t) + motion(cands[j], cands[k]));
            const v = val[j] - cost;
            if (v > best) { best = v; arg = j; }
          }
          nv[k] = best + score[t][k];
          bk[k] = arg;
        }
        back.push(bk);
        val = nv;
      }
      let k = 0;
      for (let i = 1; i < K; i++) if (val[i] > val[k]) k = i;
      const path = new Array(S);
      path[S - 1] = k;
      for (let t = S - 1; t > 0; t--) { k = back[t - 1][k]; path[t - 1] = k; }
      return path;
    };

    const same = (a, b) => a.every((x, i) => x === b[i]);
    let path = solve(null);
    const variant = Math.max(0, Math.round(o.variant || 0));
    if (variant > 0) {
      // another good fit: nudge the scores until the answer changes
      const plain = path;
      for (let tries = 0; tries < 8; tries++) {
        const rng = Odd.rng.create('harmonise:' + variant + ':' + tries);
        const bias = cands.map(() => rng.gauss() * 0.35);
        const cell = base.map(() => cands.map(() => rng.gauss()));
        const amp = 0.45 + tries * 0.2;
        const p = solve((t, k) => bias[k] + cell[t][k] * amp);
        path = p;
        if (!same(p, plain)) break;
      }
    }

    // merge slots into chords
    const chords = [];
    let good = 0, all = 0;
    for (let t = 0; t < S; t++) {
      const c = cands[path[t]];
      const last = chords[chords.length - 1];
      if (last && last.k === path[t]) {
        last.beats += 2;
        for (const pc of pcs[t]) last.pcs.add(pc);
      } else {
        chords.push({ k: path[t], chord: c.chord, start: t * SLOT, beats: 2, pcs: new Set(pcs[t]), w: 0, ok: 0 });
      }
      const cur = chords[chords.length - 1];
      for (const n of notes) {
        const x = weightIn(n, t * SLOT, (t + 1) * SLOT);
        if (!x) continue;
        const sc = noteScore(T.mod(n.p - tonic, 12), c);
        cur.w += x; all += x;
        if (sc >= 0.9) { cur.ok += x; good += x; }
      }
    }
    const prog = T.fitProg(chords.map((c) => Object.assign({}, c.chord, { beats: c.beats })), bars);
    return {
      prog,
      chords: chords.map((c) => ({ chord: c.chord, start: c.start, beats: c.beats, fit: c.w ? c.ok / c.w : null, notes: [...c.pcs].sort((a, b) => a - b) })),
      fit: all ? good / all : null,
      heard,
    };
  }

  // ---------------- a section led by a tune ----------------

  function leaderOf(section) {
    return section && section.lead && section.lead.lane ? section.lead.lane : null;
  }

  /** the tune's notes in the section, as written (optionally with another part in its slot) */
  function tuneEvents(session, section, laneId, part) {
    const slot = section.slots && section.slots[laneId];
    if (!slot || !(part || slot.part)) return [];
    const asWritten = Object.assign({}, slot, { refit: false }, part ? { part } : {});
    const view = Object.assign({}, section, { slots: { [laneId]: asWritten } });
    return Odd.render.sectionEvents(session, view, { only: laneId, shape: false });
  }

  function styleRate(session) {
    const st = Odd.model ? Odd.model.styleOf(session.style) : null;
    return (st && st.rate) || 1;
  }

  /**
   * the chords `laneId`'s part (or `opts.part` in its place) would give the
   * section. opts: { part, variant (default: the section's) }
   */
  function forSection(session, section, laneId, opts) {
    const o = opts || {};
    const lead = section.lead && section.lead.lane === laneId ? section.lead : null;
    const tgt = Odd.render.sectionTarget(session, section);
    return harmonise(tuneEvents(session, section, laneId, o.part), {
      tonic: tgt.tonic, scale: session.scale, bars: section.bars, rate: styleRate(session),
      color: Odd.model ? Odd.model.harmonyOf(session) : 0.3,
      variant: o.variant != null ? o.variant : lead ? lead.variant : 0,
      prev: lead ? lead.prev : section.prog,
    });
  }

  /** can this lane's part in this section set the chords? */
  function canLead(session, section, laneId) {
    const lane = session.lanes.find((l) => l.id === laneId);
    const slot = section.slots && section.slots[laneId];
    return !!(lane && slot && slot.part && !T.isDrumRole(lane.role));
  }

  /** let a lane's tune set the section's chords */
  function lead(session, section, laneId) {
    if (!canLead(session, section, laneId)) return false;
    const slot = section.slots[laneId];
    const old = section.lead;
    if (old && old.lane !== laneId) release(session, section);
    if (!section.lead) {
      section.lead = { lane: laneId, variant: 0, prev: section.prog.map((c) => Object.assign({}, c)), refit: slot.refit !== false };
    }
    slot.refit = false;
    section.prog = forSection(session, section, laneId).prog;
    return true;
  }

  /**
   * hand the lead back to the chords. keep: the chords the tune gave stay
   * (and the tune keeps its own notes); otherwise the old chords come back.
   */
  function release(session, section, opts) {
    const L = section.lead;
    if (!L) return false;
    const keep = !!(opts && opts.keep);
    const slot = section.slots && section.slots[L.lane];
    if (!keep) {
      if (L.prev && L.prev.length) section.prog = T.fitProg(L.prev, section.bars);
      if (slot) slot.refit = L.refit !== false;
    }
    delete section.lead;
    return true;
  }

  /** another good set of chords for the same tune */
  function vary(session, section, dir) {
    const L = section.lead;
    if (!L) return false;
    L.variant = Math.max(0, (L.variant || 0) + (dir || 1));
    section.prog = forSection(session, section, L.lane).prog;
    return true;
  }

  /**
   * Keep every tune-led section's chords in step with its tune. Called after
   * each change: a new take, an edit, other bars. A lead whose part has gone
   * is handed back to the old chords.
   */
  function sync(session) {
    for (const section of session.sections) {
      const L = section.lead;
      if (!L) continue;
      if (!canLead(session, section, L.lane)) { release(session, section); continue; }
      section.slots[L.lane].refit = false;
      section.prog = forSection(session, section, L.lane).prog;
    }
  }

  Odd.harmonise = { harmonise, candidates, leaderOf, tuneEvents, forSection, canLead, lead, release, vary, sync };
})(globalThis.Odd = globalThis.Odd || {});
