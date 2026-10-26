/* Oddition — section types: ready-made ways for a section to set up or pay off.
 *
 * A section type is a gesture that writes ordinary section settings: which
 * bars each lane plays (slot.from / slot.to), the energy curve, the energy
 * level, and how the next section is entered (section.exit). Nothing it does
 * is hidden: after applying one, every setting can still be changed by hand.
 *
 * A type is described by waves of roles:
 *   enter: [{ roles, at }]   lanes come in at fraction `at` of the section
 *   leave: [{ roles, at }]   lanes drop out at fraction `at`
 *   rest:  'in' | 'out' | 'last'   lanes no wave names: play throughout,
 *                                   sit out, or come in with the last wave
 * Fractions snap to the phrase grid (4 bars in long sections, 2 in 8-bar
 * ones, 1 below), and `at` may also be { bars: n } for an exact bar.
 *
 * When a section has fewer than three parts, too few for its type to mean
 * anything, the type borrows parts from another section of the song ('next': the one it
 * leads into, 'peak': the most energetic, 'prev': the one before it).
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const M = Odd.model;

  const KINDS = {
    intro: { label: 'Intro', re: /intro|opening/i },
    verse: { label: 'Verse', re: /verse/i },
    pre: { label: 'Pre-chorus', re: /pre.?chorus|build|lift|rise|ramp/i },
    chorus: { label: 'Chorus', re: /chorus|hook|refrain|drop/i },
    break: { label: 'Break', re: /break|bridge|interlude|middle/i },
    outro: { label: 'Outro', re: /outro|end|coda/i },
  };
  const KIND_ORDER = ['intro', 'verse', 'pre', 'chorus', 'break', 'outro'];

  const RECIPES = [
    // ---- intros
    {
      id: 'slow-build', kind: 'intro', label: 'Slow build', bars: 16, borrow: 'next',
      blurb: 'Starts with a few parts and adds the rest phrase by phrase while the energy climbs.',
      enter: [{ roles: ['pad', 'chords', 'arp'] }, { roles: ['perc'] }, { roles: ['drums'] }, { roles: ['bass', 'lead'] }],
      rest: 'last', curve: 'rise', energy: 0.6,
    },
    {
      id: 'hook-first', kind: 'intro', label: 'Hook first', bars: 8, borrow: 'peak', needs: ['lead'],
      blurb: 'Opens on the chorus hook with little under it, then the band crashes in halfway.',
      enter: [{ roles: ['lead', 'pad', 'chords'], at: 0 }, { roles: ['drums', 'perc', 'bass', 'arp'], at: 0.5 }],
      rest: 'last', curve: 'flat', energy: 0.65,
    },
    {
      id: 'riff-first', kind: 'intro', label: 'Riff first', borrow: 'next',
      blurb: 'The bass or arp riff alone, then the drums, then everything else.',
      enter: [{ roles: ['bass', 'arp'], at: 0 }, { roles: ['drums', 'perc'], at: 0.5 }, { roles: ['chords', 'pad', 'lead'], at: 0.75 }],
      rest: 'last', curve: 'rise', energy: 0.55,
    },
    {
      id: 'drums-first', kind: 'intro', label: 'Drums first', borrow: 'next',
      blurb: 'A beat on its own sets the groove; the bass joins, then the rest.',
      enter: [{ roles: ['drums', 'perc'], at: 0 }, { roles: ['bass'], at: 0.5 }, { roles: ['chords', 'pad', 'arp', 'lead'], at: 0.75 }],
      rest: 'last', curve: 'rise', energy: 0.55,
    },
    {
      id: 'burst', kind: 'intro', label: 'Burst in', borrow: 'peak',
      blurb: 'No warm-up: everyone from the first bar, at full tilt.',
      enter: [], rest: 'in', curve: 'flat', energy: 0.8,
    },
    {
      id: 'atmosphere', kind: 'intro', label: 'Atmosphere', borrow: 'next',
      blurb: 'Only the pads, chords and arp, swelling and fading. The beat waits for the verse.',
      enter: [{ roles: ['pad', 'chords', 'arp'], at: 0 }], rest: 'out', curve: 'swell', energy: 0.35,
    },
    // ---- verses
    {
      id: 'full-groove', kind: 'verse', label: 'Full groove',
      blurb: 'Everyone plays the whole section at an even level.',
      enter: [], rest: 'in', curve: 'flat', energy: 0.5,
    },
    {
      id: 'sparse-start', kind: 'verse', label: 'Sparse start',
      blurb: 'Rhythm section first; chords and melody join halfway.',
      enter: [{ roles: ['drums', 'perc', 'bass'], at: 0 }, { roles: ['chords', 'pad', 'arp', 'lead'], at: 0.5 }],
      rest: 'last', curve: 'flat', energy: 0.5,
    },
    {
      id: 'pocket', kind: 'verse', label: 'Pocket',
      blurb: 'Drums, bass and chords only: room for a vocal or a lead to come later.',
      enter: [{ roles: ['drums', 'bass', 'chords'], at: 0 }], rest: 'out', curve: 'flat', energy: 0.45,
    },
    // ---- pre-choruses
    {
      id: 'lift', kind: 'pre', label: 'Lift', borrow: 'prev',
      blurb: 'Climbs all the way and hands over to the chorus with a snare build.',
      enter: [], rest: 'in', curve: 'rise', energy: 0.7, exit: 'build',
    },
    {
      id: 'hold-back', kind: 'pre', label: 'Hold back', borrow: 'prev',
      blurb: 'The bass drops out and the drums wait, so the chorus lands harder.',
      enter: [{ roles: ['pad', 'chords', 'lead', 'arp'], at: 0 }, { roles: ['drums', 'perc'], at: 0.5 }],
      rest: 'out', curve: 'rise', energy: 0.6, exit: 'gap',
    },
    {
      id: 'drop-out', kind: 'pre', label: 'Drop out', borrow: 'prev',
      blurb: 'Full band until the last bar, then the beat and bass vanish before the chorus.',
      enter: [], leave: [{ roles: ['drums', 'perc', 'bass'], at: { fromEnd: 1 } }],
      rest: 'in', curve: 'flat', energy: 0.65, exit: 'none',
    },
    // ---- choruses
    {
      id: 'full-band', kind: 'chorus', label: 'Full band',
      blurb: 'Everything at once, the payoff.',
      enter: [], rest: 'in', curve: 'flat', energy: 0.8,
    },
    {
      id: 'hook-alone', kind: 'chorus', label: 'Hook lands alone', needs: ['lead'], borrow: 'peak',
      blurb: 'The first bar is just the hook over the chords; the band lands on bar two.',
      enter: [{ roles: ['lead', 'chords', 'pad'], at: 0 }, { roles: ['drums', 'perc', 'bass', 'arp'], at: { bars: 1 } }],
      rest: 'last', curve: 'flat', energy: 0.8,
    },
    {
      id: 'climb', kind: 'chorus', label: 'Climb',
      blurb: 'Groove and chords first, the lead and arp take it higher halfway.',
      enter: [{ roles: ['drums', 'perc', 'bass', 'chords', 'pad'], at: 0 }, { roles: ['lead', 'arp'], at: 0.5 }],
      rest: 'last', curve: 'rise', energy: 0.85,
    },
    // ---- breaks and bridges
    {
      id: 'breakdown', kind: 'break', label: 'Breakdown', borrow: 'prev',
      blurb: 'Drums and bass step out; the harmony and melody hang in the air. Builds back in.',
      enter: [{ roles: ['pad', 'chords', 'lead', 'arp'], at: 0 }], rest: 'out', curve: 'flat', energy: 0.25, exit: 'build',
    },
    {
      id: 'rebuild', kind: 'break', label: 'Strip and rebuild', borrow: 'prev',
      blurb: 'Down to the pads, then the parts come back one by one.',
      enter: [{ roles: ['pad', 'chords'] }, { roles: ['lead', 'arp'] }, { roles: ['perc'] }, { roles: ['drums', 'bass'] }],
      rest: 'last', curve: 'rise', energy: 0.6, exit: 'build',
    },
    // ---- outros
    {
      id: 'strip-down', kind: 'outro', label: 'Strip down', borrow: 'prev',
      blurb: 'Parts leave one at a time until only the pad is left.',
      enter: [], leave: [{ roles: ['lead', 'arp'], at: 0.25 }, { roles: ['drums', 'perc'], at: 0.5 }, { roles: ['bass', 'chords'], at: 0.75 }],
      rest: 'in', curve: 'fall', energy: 0.55,
    },
    {
      id: 'fade', kind: 'outro', label: 'Fade out', borrow: 'prev',
      blurb: 'Everyone keeps playing while the energy drains away.',
      enter: [], rest: 'in', curve: 'fall', energy: 0.5,
    },
  ];
  const byId = {};
  for (const r of RECIPES) byId[r.id] = r;

  function kindOf(name) {
    // in KIND_ORDER, so "Pre-chorus" is tested as a pre-chorus before the chorus pattern sees it
    for (const k of KIND_ORDER) if (KINDS[k].re.test(String(name || ''))) return k;
    return 'verse';
  }

  function get(id) { return byId[id] || null; }

  /** types for a section: those for its kind first, then the rest grouped by kind */
  function forSection(section) {
    const kind = kindOf(section.name);
    const groups = [{ kind, label: KINDS[kind].label, suggested: true, recipes: RECIPES.filter((r) => r.kind === kind) }];
    for (const k of KIND_ORDER) {
      if (k === kind) continue;
      groups.push({ kind: k, label: KINDS[k].label, suggested: false, recipes: RECIPES.filter((r) => r.kind === k) });
    }
    return groups;
  }

  // below this many parts a section borrows from another one for its type
  const MIN_PARTS = 3;

  function quantum(bars) { return bars >= 16 ? 4 : bars >= 8 ? 2 : 1; }

  /** a wave's position in bars */
  function barOf(at, bars, fallback) {
    const q = quantum(bars);
    let b;
    if (at && typeof at === 'object') {
      if (at.bars != null) b = at.bars;
      else if (at.fromEnd != null) b = bars - at.fromEnd;
      else b = fallback;
      return Math.max(0, Math.min(bars, Math.round(b)));
    }
    const x = at == null ? fallback : at * bars;
    b = Math.round(x / q) * q;
    return Math.max(0, Math.min(bars, b));
  }

  /** the section whose parts a type borrows from */
  function sourceFor(session, section, how) {
    const order = session.arrangement.map((id) => M.findSection(session, id)).filter(Boolean);
    const at = order.indexOf(section);
    const filled = (s) => s && s !== section && Object.keys(s.slots).length > 0;
    if (how === 'next') {
      for (let i = at + 1; i < order.length; i++) if (filled(order[i])) return order[i];
    }
    if (how === 'prev') {
      for (let i = at - 1; i >= 0; i--) if (filled(order[i])) return order[i];
    }
    if (how === 'peak' || how === 'next' || how === 'prev') {
      let best = null;
      for (const s of session.sections) {
        if (!filled(s)) continue;
        const e = Odd.shape ? Odd.shape.energyOf(s) : 0.5;
        if (!best || e > best.e || (e === best.e && Object.keys(s.slots).length > Object.keys(best.s.slots).length)) best = { s, e };
      }
      return best ? best.s : null;
    }
    return null;
  }

  function rolesIn(waves) {
    const out = new Set();
    for (const w of waves || []) for (const r of w.roles) out.add(r);
    return out;
  }

  /**
   * Apply a section type. Returns { borrowed: [lane names] } so the UI can
   * say what was copied in.
   */
  function apply(session, section, id) {
    const r = byId[id];
    if (!r) return null;
    if (r.bars && section.bars < r.bars) M.setSectionBars(session, section, r.bars);
    const bars = section.bars;

    // borrow parts when the section is too thin for the type to mean anything
    const borrowed = [];
    let source = null;
    if (r.borrow) {
      const have = session.lanes.filter((l) => section.slots[l.id]);
      const missingNeed = (r.needs || []).some((role) => !have.some((l) => l.role === role));
      if (have.length < MIN_PARTS || missingNeed) {
        const src = sourceFor(session, section, r.borrow);
        if (src) {
          source = src.name;
          const named = rolesIn(r.enter);
          for (const lane of session.lanes) {
            if (section.slots[lane.id] || !src.slots[lane.id]) continue;
            // only roles the type uses, unless it keeps everyone
            if (r.rest === 'out' && !named.has(lane.role)) continue;
            if (have.length >= MIN_PARTS && !(r.needs || []).includes(lane.role)) continue;
            const copy = M.clone(src.slots[lane.id]);
            delete copy.from;
            delete copy.to;
            section.slots[lane.id] = copy;
            borrowed.push(lane.name);
          }
        }
      }
    }

    // entries
    const filled = session.lanes.filter((l) => section.slots[l.id]);
    const waves = (r.enter || []).map((w) => ({ w, lanes: filled.filter((l) => w.roles.includes(l.role)) })).filter((x) => x.lanes.length);
    const n = waves.length;
    const fromOf = new Map();
    waves.forEach((x, i) => {
      const b = barOf(x.w.at, bars, (i * bars) / Math.max(1, n));
      for (const l of x.lanes) if (!fromOf.has(l.id)) fromOf.set(l.id, Math.min(b, bars - 1));
    });
    const lastFrom = waves.length ? fromOf.get(waves[waves.length - 1].lanes[0].id) : 0;
    const named = rolesIn(r.enter);
    // exits
    const toOf = new Map();
    for (const w of r.leave || []) {
      const b = barOf(w.at, bars, bars);
      for (const l of filled) if (w.roles.includes(l.role) && !toOf.has(l.id)) toOf.set(l.id, Math.max(1, b));
    }

    for (const lane of filled) {
      let from;
      if (fromOf.has(lane.id)) from = fromOf.get(lane.id);
      else if (named.has(lane.role) || r.rest === 'in' || !n) from = 0;
      else if (r.rest === 'out') from = bars;
      else from = lastFrom;
      let to = toOf.has(lane.id) ? toOf.get(lane.id) : bars;
      if (from < bars) to = Math.max(from + 1, to);
      if (from >= bars) M.setSlotSpan(section, lane.id, bars, bars);
      else M.setSlotSpan(section, lane.id, from, to);
    }

    section.curve = r.curve || 'flat';
    if (r.energy != null) section.energy = r.energy;
    section.exit = r.exit || 'auto';
    section.recipe = r.id;
    return { borrowed: borrowed.length ? borrowed : [], from: borrowed.length ? source : null };
  }

  /** back to no type: everyone plays throughout, steady energy, automatic exit */
  function reset(section) {
    for (const k in section.slots) M.setSlotSpan(section, k, 0, null);
    section.curve = 'flat';
    section.exit = 'auto';
    section.recipe = null;
  }

  /** a short sentence of what each lane does in a section, for the readout */
  function describe(session, section) {
    const parts = [];
    const bars = section.bars;
    const out = [];

    const groups = new Map();
    for (const lane of session.lanes) {
      const slot = section.slots[lane.id];
      if (!slot) continue;
      const sp = M.slotSpan(section, slot);
      if (sp.out) { out.push(lane.name); continue; }
      const key = sp.from + ':' + sp.to;
      if (!groups.has(key)) groups.set(key, { sp, names: [] });
      groups.get(key).names.push(lane.name);
    }
    const list = [...groups.values()].sort((a, b) => a.sp.from - b.sp.from || b.sp.to - a.sp.to);
    for (const g of list) {
      const names = g.names.join(', ');
      if (g.sp.full) parts.push(names + ' throughout');
      else if (g.sp.to === bars) parts.push(names + ' from bar ' + (g.sp.from + 1));
      else if (g.sp.from === 0) parts.push(names + ' until bar ' + g.sp.to);
      else parts.push(names + ' in bars ' + (g.sp.from + 1) + '–' + g.sp.to);
    }
    if (out.length) parts.push(out.join(', ') + ' sit out');
    return parts.join(' · ');
  }

  Odd.recipes = { KINDS, KIND_ORDER, RECIPES, get, kindOf, forSection, apply, reset, describe, quantum };
})(globalThis.Odd = globalThis.Odd || {});
