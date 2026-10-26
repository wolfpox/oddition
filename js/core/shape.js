/* Oddition — song shape: energy, dynamics, transitions and human feel.
 *
 * Everything here works on rendered events ({ t, d, p, v, track }), never on
 * stored parts, so kept parts adapt to wherever they are placed and changing a
 * setting re-renders instead of rewriting notes.
 *
 *   energy       0..1 per section (null = guessed from its name). 0.5 plays
 *                parts as written; lower thins and softens them, higher plays
 *                harder and doubles the lead an octave up.
 *   dynamics     a small swell across each 4-bar phrase, and a crescendo or
 *                diminuendo over the last bars when the next section's energy
 *                is higher or lower.
 *   entry        how a section is entered in the song: none, a drum fill, a
 *                snare build, or a build with a beat of silence before it.
 *                'auto' picks one from the energy jump.
 *   humanize     small timing and velocity offsets per role, strummed chords.
 *                Seeded from each note, so playback and export always match.
 *
 *   curve        how energy moves across a section: flat, rise (builds up to
 *                the section's energy), fall (starts there and dies away),
 *                swell (up and back down) or dip (drops in the middle).
 *
 * session.shape = { on, humanize, lift }    see DEFAULTS
 * section.energy = number | null,  section.entry = 'auto' | ENTRIES
 * section.exit = 'auto' | ENTRIES: how the next section is entered when its
 *                own entry is 'auto' (a pre-chorus that always ends in a build)
 * section.curve = CURVES
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const BAR = T.BAR, BEAT = T.BEAT, STEP = T.STEP;

  const DEFAULTS = { on: true, humanize: 0.4, lift: true };
  const ENTRIES = ['none', 'fill', 'build', 'gap'];
  const ENTRY_LABELS = {
    auto: 'Auto', none: 'Straight in', fill: 'Drum fill', build: 'Snare build', gap: 'Build and a gap',
  };
  const CURVES = ['flat', 'rise', 'fall', 'swell', 'dip'];
  const CURVE_LABELS = { flat: 'Steady', rise: 'Rise', fall: 'Fall away', swell: 'Swell', dip: 'Dip' };
  // how far a curve moves below the section's energy
  const CURVE_DEPTH = 0.4;

  // energy guessed from a section's name; first match wins
  const NAME_ENERGY = [
    [/pre.?chorus|build|lift|rise/i, 0.62],
    [/breakdown|break/i, 0.25],
    [/intro/i, 0.3],
    [/outro|end/i, 0.3],
    [/verse/i, 0.5],
    [/chorus|hook|refrain/i, 0.75],
    [/drop/i, 0.9],
    [/bridge/i, 0.45],
    [/solo/i, 0.7],
  ];

  const KICKS = new Set([35, 36]);
  const BACKBEAT = new Set([38, 39, 40]);
  const HATS = new Set([42, 44, 46]);
  const CYMBALS = new Set([49, 51, 53, 57, 59]);
  const TOMS = new Set([41, 43, 45, 47, 48, 50]);
  const CRASH = 49, SNARE = 38;

  // how much of a part low energy may remove (0 = never thin)
  const MAX_CUT = { drums: 0.8, perc: 0.8, bass: 0.55, chords: 0.6, pad: 0, lead: 0.5, arp: 0.7 };

  // humanize at amount 1: timing mean and spread, velocity spread (ticks / velocity units)
  const FEEL = {
    drums: { mean: 0, sd: 8, vel: 10 },
    perc: { mean: 2, sd: 10, vel: 12 },
    bass: { mean: 10, sd: 8, vel: 8 },
    chords: { mean: 2, sd: 8, vel: 8, strum: 10 },
    pad: { mean: 0, sd: 4, vel: 4 },
    lead: { mean: 6, sd: 14, vel: 10 },
    arp: { mean: 0, sd: 4, vel: 7 },
  };

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function vel(x) { return clamp(Math.round(x), 1, 127); }

  /** uniform 0..1 from any key (stable across runs) */
  function hash01(key) { return Odd.rng.hash(key) / 4294967296; }

  /** roughly normal, from a key */
  function hashGauss(key) {
    return (hash01(key + 'a') + hash01(key + 'b') + hash01(key + 'c') - 1.5) * 2;
  }

  // ---------------- settings ----------------

  function settings(session) {
    return Object.assign({}, DEFAULTS, (session && session.shape) || {});
  }

  function autoEnergy(name) {
    for (const [re, e] of NAME_ENERGY) if (re.test(String(name || ''))) return e;
    return 0.5;
  }

  /** the section's own energy (before repeats lift it) */
  function energyOf(section) {
    if (section && typeof section.energy === 'number' && isFinite(section.energy)) return clamp(section.energy, 0, 1);
    return autoEnergy(section && section.name);
  }

  function isAuto(section) { return !(section && typeof section.energy === 'number'); }

  function entryOf(section) {
    const e = section && section.entry;
    return ENTRIES.includes(e) ? e : 'auto';
  }

  /** resolve 'auto' from the energy jump between two arrangement entries */
  function resolveEntry(setting, fromE, toE) {
    if (setting && setting !== 'auto') return setting;
    const delta = toE - fromE;
    if (delta >= 0.3) return toE >= 0.85 ? 'gap' : 'build';
    if (delta >= 0.12) return 'fill';
    return 'none';
  }

  /**
   * The song order with shape resolved:
   * [{ index, section, sectionId, start, end, energy, entry, delta }]
   * entry is how this entry is reached from the previous one ('none' for the first).
   */
  function plan(session) {
    const cfg = settings(session);
    const out = [];
    const seen = new Map();
    let pos = 0;
    session.arrangement.forEach((sid, index) => {
      const section = session.sections.find((s) => s.id === sid);
      if (!section) return;
      const n = seen.get(sid) || 0;
      seen.set(sid, n + 1);
      let energy = energyOf(section);
      if (cfg.lift && n > 0) energy = clamp(energy + Math.min(0.15, 0.06 * n), 0, 1);
      const len = section.bars * BAR;
      const prev = out[out.length - 1];
      const delta = prev ? energy - prev.energy : 0;
      // the section's own entry wins; on 'auto' the previous section's exit decides
      let setting = entryOf(section);
      if (setting === 'auto' && prev && ENTRIES.includes(prev.section.exit)) setting = prev.section.exit;
      const entry = prev && cfg.on ? resolveEntry(setting, prev.energy, energy) : 'none';
      out.push({ index, section, sectionId: sid, start: pos, end: pos + len, energy, entry, delta });
      pos += len;
    });
    return out;
  }

  // ---------------- energy on one lane ----------------

  /** how much an onset matters at its place in the bar */
  function metric(pos) {
    if (pos === 0) return 1;
    if (pos === 2 * BEAT) return 0.85;
    if (pos % BEAT === 0) return 0.7;
    if (pos % (BEAT / 2) === 0 || pos % (BEAT / 3) === 0) return 0.45; // 8ths, 8th triplets
    if (pos % STEP === 0 || pos % (BEAT / 6) === 0) return 0.25; // 16ths, 16th triplets
    return 0.15;
  }

  function importance(e, start, role) {
    const pos = T.mod(e.t - start, BAR);
    let x = metric(pos) + ((e.v || 90) - 85) / 220;
    // jitter by onset only, so chord notes stay or go together
    x += (hash01((e.track || role) + ':' + e.t) - 0.5) * 0.16;
    if (role === 'drums') {
      if (CYMBALS.has(e.p)) return 2;
      if (KICKS.has(e.p)) x += 0.1;
      else if (BACKBEAT.has(e.p) && pos % (2 * BEAT) === BEAT && (e.v || 0) >= 70) x = Math.max(x, 0.95);
      else if (HATS.has(e.p)) x -= 0.05;
      else if (!TOMS.has(e.p) && !BACKBEAT.has(e.p)) x -= 0.1;
    }
    return x;
  }

  /** energy at position x (0..1) through a section of energy e with this curve */
  function curveAt(e, curve, x) {
    const k = clamp(x, 0, 1);
    let drop = 0;
    if (curve === 'rise') drop = 1 - k;
    else if (curve === 'fall') drop = k;
    else if (curve === 'swell') drop = 1 - Math.sin(Math.PI * k);
    else if (curve === 'dip') drop = Math.sin(Math.PI * k);
    return clamp(e - CURVE_DEPTH * drop, 0, 1);
  }

  /**
   * Shape one lane's events inside one section (events already at song time).
   * o: { role, energy, start, end, curve, nextEnergy (null at the song end or when looping a section) }
   */
  function shapeLane(events, o) {
    if (!events.length) return events;
    const role = o.role;
    const e = clamp(o.energy == null ? 0.5 : o.energy, 0, 1);
    const len = o.end - o.start;
    const curve = CURVES.includes(o.curve) ? o.curve : 'flat';
    // energy where an event sits; snapped to the bar so a chord's notes agree
    const eAt = curve === 'flat' ? () => e : (ev) => {
      const bar = Math.floor((ev.t - o.start) / BAR);
      const bars = Math.max(1, Math.round(len / BAR));
      return curveAt(e, curve, bars > 1 ? bar / (bars - 1) : 1);
    };

    // 1. thin when energy is low
    let kept = events;
    const maxCut = MAX_CUT[role] == null ? 0.5 : MAX_CUT[role];
    const cutAt = (ev) => Math.max(0, (0.5 - eAt(ev)) * 2) * maxCut;
    if (curve !== 'flat' || cutAt(events[0]) > 0) {
      kept = events.filter((ev) => { const c = cutAt(ev); return c <= 0 || importance(ev, o.start, role) >= c; });
      if (!kept.length) kept = events.filter((ev) => T.mod(ev.t - o.start, BAR) === 0);
      if (!kept.length) kept = events.filter((ev) => ev.t === events[0].t);
    }

    // 2. velocity: energy, phrase swell, ramp into the next section
    const endE = curve === 'flat' ? e : curveAt(e, curve, 1);
    const delta = o.nextEnergy == null ? 0 : o.nextEnergy - endE;
    const rampLen = Math.abs(delta) < 0.08 ? 0 : Math.min(len / 2, (Math.abs(delta) >= 0.3 ? 2 : 1) * BAR);
    const rampK = clamp(delta, -0.5, 0.5) * 0.6;
    const phrase = 4 * BAR;
    const out = kept.map((ev) => {
      const rel = ev.t - o.start;
      const base = 0.72 + 0.56 * eAt(ev);
      let m = base * (1 + 0.04 * Math.sin(Math.PI * (T.mod(rel, phrase) / phrase)));
      if (rampLen && rel >= len - rampLen) m *= 1 + rampK * ((rel - (len - rampLen)) / rampLen);
      return Object.assign({}, ev, { v: vel(ev.v * m) });
    });

    // 3. high energy doubles the lead an octave up
    if (role === 'lead' && e >= 0.8) {
      const extra = [];
      for (const ev of out) if (ev.p + 12 <= 108 && eAt(ev) >= 0.8) extra.push(Object.assign({}, ev, { p: ev.p + 12, v: vel(ev.v * 0.55) }));
      return out.concat(extra);
    }
    return out;
  }

  // ---------------- transitions ----------------

  function fillKinds(session) {
    const st = Odd.styles && Odd.styles.get ? Odd.styles.get(session.style) : null;
    const kinds = st && st.drums && st.drums.fills;
    return kinds && kinds.length ? kinds : ['snare'];
  }

  function writeFill(kind, t0, beats, rng, push) {
    const drums = Odd.gen && Odd.gen.roles && Odd.gen.roles.drums;
    if (drums && drums.writeFill) { drums.writeFill(kind, t0, beats, rng, 0.5, push); return; }
    const n = Math.round(beats * 4);
    for (let i = 0; i < n; i++) push(t0 + i * STEP, SNARE, 60 + (54 * i) / Math.max(1, n - 1), 100);
  }

  /** snare build over [t0, t1): quarters, then 8ths, then 16ths, getting louder */
  function writeBuild(t0, t1, push) {
    const snap = (x, g) => Math.round(x / g) * g;
    const w = t1 - t0;
    const qEnd = w >= 2 * BAR - BEAT ? t0 + snap(w / 2, BEAT) : t0;
    const eEnd = qEnd + snap((t1 - qEnd) / 2, BEAT / 2);
    const hits = [];
    for (let t = t0; t < qEnd; t += BEAT) hits.push(t);
    for (let t = qEnd; t < eEnd; t += BEAT / 2) hits.push(t);
    for (let t = eEnd; t < t1; t += STEP) hits.push(t);
    hits.forEach((t, i) => push(t, SNARE, 46 + (72 * i) / Math.max(1, hits.length - 1), 60));
  }

  /**
   * Add fills, builds, gaps and landing crashes between arrangement entries.
   * Returns a new event list.
   */
  function transitions(session, events, entries) {
    const drumLanes = session.lanes.filter((l) => l.role === 'drums').map((l) => l.id);
    if (!entries.length) return events;
    const drops = [];   // [{ track (null = every track), from, to, keep(e) }]
    const adds = [];
    const gaps = [];
    const fills = fillKinds(session);

    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const cur = entries[i];
      const kind = cur.entry;
      if (kind === 'none') continue;
      const rng = Odd.rng.create(Odd.rng.hash(session.id + ':entry:' + i + ':' + cur.sectionId));
      const hasIn = (track, from, to) => events.some((e) => e.track === track && e.t >= from && e.t < to);
      const prevDrums = drumLanes.filter((id) => hasIn(id, prev.start, prev.end));
      const curDrums = drumLanes.filter((id) => hasIn(id, cur.start, cur.end));
      const lenPrev = prev.end - prev.start;
      const gapLen = kind === 'gap' ? Math.min(BEAT, lenPrev / 4) : 0;
      const tailEnd = prev.end - gapLen;

      if (kind === 'fill') {
        const beats = cur.delta >= 0.2 ? 2 : 1;
        const from = Math.max(prev.start, tailEnd - beats * BEAT);
        const fillKind = rng.pick(fills);
        for (const track of prevDrums) {
          drops.push({ track, from, to: tailEnd, keep: (e) => e.p === 42 || e.p === 44 });
          writeFill(fillKind, from, (tailEnd - from) / BEAT, rng, (t, p, v, d) => adds.push({ t, d: d || 60, p, v: vel(v), track }));
        }
      } else {
        // build (and gap): snare build on the drum lanes, or the first drum lane
        const bars = Math.max(1, Math.min(2, Math.floor(prev.section.bars / 2)));
        const from = Math.max(prev.start, prev.end - bars * BAR);
        const targets = prevDrums.length ? prevDrums : drumLanes.slice(0, 1);
        for (const track of targets) {
          drops.push({ track, from, to: tailEnd, keep: (e) => !(BACKBEAT.has(e.p) || TOMS.has(e.p) || e.p === 37) });
          writeBuild(from, tailEnd, (t, p, v, d) => adds.push({ t, d, p, v: vel(v), track }));
        }
        if (gapLen) gaps.push({ from: tailEnd, to: prev.end });
      }

      // land on a crash
      for (const track of curDrums.length ? curDrums : []) {
        const has = events.some((e) => e.track === track && e.t === cur.start && CYMBALS.has(e.p));
        if (!has) adds.push({ t: cur.start, d: 2 * BEAT, p: CRASH, v: vel(96 + 20 * cur.energy), track });
      }
    }

    let out = events.filter((e) => !drops.some((d) => e.track === d.track && e.t >= d.from && e.t < d.to && !d.keep(e)));
    out = out.concat(adds);
    if (gaps.length) {
      out = out.filter((e) => !gaps.some((g) => e.t >= g.from && e.t < g.to)).map((e) => {
        for (const g of gaps) {
          if (e.t < g.from && e.t + e.d > g.from) return Object.assign({}, e, { d: Math.max(1, g.from - e.t) });
        }
        return e;
      });
    }
    return out;
  }

  // ---------------- human feel ----------------

  /**
   * Timing and velocity offsets per role. Apply after swing.
   * o: { amount 0..1, roleOf(track) -> role, length (ticks, optional) }
   */
  function humanize(events, o) {
    const amount = clamp(Number(o && o.amount) || 0, 0, 1);
    if (!amount || !events.length) return events.slice();
    const roleOf = (o && o.roleOf) || (() => 'lead');
    const length = o && o.length;

    // strum order for chords: rank of each note among notes starting together
    const rank = new Map();
    const groups = new Map();
    events.forEach((e, i) => {
      if (roleOf(e.track) !== 'chords') return;
      const k = e.track + ':' + e.t;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    for (const idx of groups.values()) {
      if (idx.length < 2) continue;
      idx.sort((a, b) => events[a].p - events[b].p).forEach((i, r) => rank.set(i, r));
    }

    const out = events.map((e, i) => {
      const role = roleOf(e.track);
      const f = FEEL[role] || FEEL.lead;
      const key = e.track + ':' + e.t + ':' + e.p;
      let sd = f.sd;
      if (role === 'drums' && HATS.has(e.p)) sd *= 1.5;
      if (role === 'drums' && CYMBALS.has(e.p)) sd *= 0.5;
      let dt = (f.mean + sd * hashGauss(key)) * amount;
      if (f.strum && rank.has(i)) dt += rank.get(i) * f.strum * amount;
      let t = Math.max(0, Math.round(e.t + dt));
      if (length != null && t >= length) t = Math.max(0, length - 1);
      let d = e.d;
      if (length != null) d = Math.max(1, Math.min(d, length - t));
      const v = vel(e.v + f.vel * amount * hashGauss(key + 'v'));
      return Object.assign({}, e, { t, d, v });
    });

    // a moved note must not overlap the next note of the same pitch
    const last = new Map();
    const order = out.map((e, i) => i).sort((a, b) => out[a].t - out[b].t);
    for (const i of order) {
      const e = out[i];
      const k = e.track + ':' + e.p;
      const j = last.get(k);
      if (j != null) {
        const p = out[j];
        if (p.t + p.d > e.t) p.d = Math.max(1, e.t - p.t);
      }
      last.set(k, i);
    }
    return out;
  }

  Odd.shape = {
    DEFAULTS, ENTRIES, ENTRY_LABELS, CURVES, CURVE_LABELS,
    settings, curveAt, autoEnergy, energyOf, isAuto, entryOf, resolveEntry, plan,
    shapeLane, transitions, humanize, importance,
  };
})(globalThis.Odd = globalThis.Odd || {});
