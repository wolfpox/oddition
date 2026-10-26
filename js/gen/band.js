/* Oddition — parts listening to each other.
 *
 * A new take can hear what is already in its section. Odd.band.hear()
 * sums the section's other parts up into a small "band" summary, laid over
 * the take's own length:
 *
 *   { total, steps, roles, kick[], bassOn[], lead[], load, notes[] }
 *
 * Generators read it through ctx.band:
 *   - bass locks its notes onto the kick, or plays between the kicks;
 *   - drums lean the kick onto the bass;
 *   - busy sections make new takes sparser, quiet ones a little busier;
 *   - lead, chords, pad and arp move an octave if the register is crowded;
 *   - arp and chords leave room while the lead plays.
 * Each change adds a short line to part.heard, shown in the booth.
 * Kept parts never change: only new takes listen.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const STEP = T.STEP, BAR = T.BAR;
  const KICKS = new Set([35, 36]);
  const MAX_NOTES = 3000;

  /** how strongly the bass follows the kick (-1 plays between kicks .. 1 locks to them) */
  const LOCK = { lofi: 0.5, boombap: 0.65, trap: 0.9, house: -0.6, techno: -0.7, synthwave: 0.3, pop: 0.5, ambient: 0, dnb: 0.6 };

  /** register each role may be moved into (lowest / highest average pitch) */
  const ROOM = { chords: [52, 80], pad: [42, 76], lead: [62, 86], arp: [54, 86] };
  /** how much sharing a register with each role counts: a pad is meant to sit under things */
  const CLASH = { pad: 0.3, chords: 0.6, lead: 1, arp: 0.8 };

  /** below this load a section counts as sparse (ambient is meant to be) */
  const QUIET = { ambient: 0.15, techno: 0.4 };

  const ROLE_NAMES = { drums: 'drums', perc: 'percussion', bass: 'bass', chords: 'chords', pad: 'pad', lead: 'lead', arp: 'arp' };

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  /**
   * lanes: [{ role, events: [{ t, d, p, v }] }] (ticks from the section start)
   * length: the section's length in ticks; total: the take's length in ticks.
   * Returns null when there is nothing to hear.
   */
  function hear(lanes, length, total) {
    const list = (lanes || []).filter((l) => l && l.events && l.events.length);
    if (!list.length || !(total > 0) || !(length > 0)) return null;
    const steps = Math.round(total / STEP);
    // the take loops over the section (or the section under the take)
    const passes = Math.max(1, Math.ceil(length / total));
    const tiles = Math.max(1, Math.ceil(total / length));
    const kick = new Array(steps).fill(0);
    const bassOn = new Array(steps).fill(0);
    const lead = new Array(steps).fill(0);
    const onsets = {};
    const notes = [];
    const roles = [];
    const bars = Math.max(1, length / BAR);

    for (const lane of list) {
      if (!roles.includes(lane.role)) roles.push(lane.role);
      const seen = new Set();
      for (const e of lane.events) {
        if (e.t < 0 || e.t >= length) continue;
        seen.add(Math.round(e.t / STEP));
        for (let k = 0; k < tiles; k++) {
          const at = e.t + k * length;
          if (at >= total * passes) continue;
          const t = at % total;
          const s = Math.round(t / STEP) % steps;
          if (Odd.theory.isDrumRole(lane.role)) {
            if (lane.role === 'drums' && KICKS.has(e.p)) kick[s] = Math.min(passes, kick[s] + 1);
            continue;
          }
          if (lane.role === 'bass') bassOn[s] = Math.min(passes, bassOn[s] + 1);
          if (lane.role === 'lead') {
            const end = Math.min(steps, Math.ceil((t + e.d) / STEP));
            for (let j = Math.floor(t / STEP); j < end; j++) lead[j] += 1;
          }
          if (notes.length < MAX_NOTES) notes.push({ t, d: e.d, p: e.p, role: lane.role });
        }
      }
      onsets[lane.role] = (onsets[lane.role] || 0) + seen.size / bars;
    }
    const norm = (a) => a.map((x) => Math.min(1, x / passes));
    // how busy the section already is: pads and drums don't count
    let load = 0;
    for (const r in onsets) if (r !== 'pad' && !Odd.theory.isDrumRole(r)) load += Math.min(1, onsets[r] / 8);
    return {
      total, steps, roles,
      kick: norm(kick), bassOn: norm(bassOn), lead: norm(lead).map((x) => Math.min(1, x)),
      onsets, load, notes,
    };
  }

  /** a profile folded onto `period` steps (a drum groove's one or two bars) */
  function fold(arr, period) {
    const out = new Array(period).fill(0);
    const n = new Array(period).fill(0);
    for (let i = 0; i < arr.length; i++) { out[i % period] += arr[i]; n[i % period]++; }
    return out.map((x, i) => (n[i] ? x / n[i] : 0));
  }

  const has = (band, role) => !!(band && band.roles.includes(role));
  const lockOf = (styleId) => (LOCK[styleId] != null ? LOCK[styleId] : 0.4);

  /**
   * density nudge for a new take from how busy the section is.
   * Returns { density, note } (note null when nothing changed).
   */
  function balance(role, density, band, styleId) {
    if (!band || role === 'pad') return { density, note: null };
    const melodic = band.roles.some((r) => !Odd.theory.isDrumRole(r) && r !== 'pad');
    if (!melodic && !Odd.theory.isDrumRole(role)) return { density, note: null };
    const weight = { drums: 0.12, perc: 0.18, bass: 0.15, chords: 0.25, lead: 0.3, arp: 0.3 }[role] || 0.2;
    // between about one and one and a half busy parts is neutral
    const load = band.load;
    const quiet = QUIET[styleId] != null ? QUIET[styleId] : 0.6;
    const over = load > 1.5 ? load - 1.5 : load < quiet ? load - quiet : 0;
    const shift = clamp(-weight * 1.5 * over, -0.3, 0.12);
    if (Math.abs(shift) < 0.05) return { density, note: null };
    const next = clamp(density + shift, 0, 1);
    return { density: next, note: shift < 0 ? 'Plays sparser: the section is busy' : 'Plays a little busier: the section is sparse' };
  }

  /**
   * bass onsets for one bar, nudged onto the kick (lock > 0) or off it
   * (lock < 0). onsets: [{ step, type, len }] from the style pattern.
   * keep(step): true for steps that must stay (a chord change).
   */
  function lockBass(onsets, kick, lock, rng, keep) {
    if (!kick || !kick.some((x) => x > 0.5) || !lock) return { onsets, moved: 0 };
    const on = (s) => kick[s] > 0.5;
    let list = onsets.map((o) => Object.assign({}, o));
    let moved = 0;
    const taken = () => new Set(list.map((o) => o.step));
    if (lock > 0) {
      // slide onsets that just miss a kick onto it
      for (const o of list) {
        if (on(o.step) || keep(o.step) || !rng.chance(lock * 0.8)) continue;
        const busy = taken();
        const near = [o.step - 1, o.step + 1, o.step - 2, o.step + 2].find((s) => s >= 0 && s < 16 && on(s) && !busy.has(s) && !keep(s));
        if (near == null) continue;
        o.len = Math.max(1, o.len + (o.step - near));
        o.step = near;
        moved++;
      }
      // kicks with no bass under them get a note
      for (let s = 0; s < 16; s++) {
        if (!on(s) || taken().has(s) || !rng.chance(lock * 0.6 * kick[s])) continue;
        list.push({ step: s, type: 'x', len: 1 });
        moved++;
      }
      // a style that locks hard drops notes far from any kick
      if (lock > 0.4) {
        const far = (st) => ![-2, -1, 0, 1, 2].some((k) => on(st + k));
        const before = list.length;
        list = list.filter((o, i) => i === 0 || keep(o.step) || !far(o.step) || !rng.chance((lock - 0.4) * 0.9));
        moved += before - list.length;
      }
    } else {
      // play between the kicks: an onset on a kick moves off it
      for (const o of list) {
        if (!on(o.step) || keep(o.step) || !rng.chance(-lock)) continue;
        const busy = taken();
        const free = [o.step + 2, o.step + 1, o.step - 2].find((s) => s >= 0 && s < 16 && !on(s) && !busy.has(s));
        if (free == null) continue;
        o.step = free;
        moved++;
      }
    }
    list.sort((a, b) => a.step - b.step);
    // a note lasts until the next one starts
    for (let i = 0; i < list.length; i++) {
      const next = list[i + 1] ? list[i + 1].step : 16;
      list[i].len = clamp(list[i].len, 1, Math.max(1, next - list[i].step));
    }
    // same step twice: keep the first
    list = list.filter((o, i) => i === 0 || o.step !== list[i - 1].step);
    return { onsets: list, moved };
  }

  /**
   * octave move (-12, 0 or 12) that keeps a take out of other parts' way.
   * events: the take's pitched events { t, d, p } at its normal register.
   */
  function clearRegister(role, events, band) {
    const room = ROOM[role];
    if (!room || !band || !events.length) return { shift: 0, note: null, crowd: 0 };
    const others = band.notes.filter((n) => n.role !== 'bass');
    if (!others.length) return { shift: 0, note: null, crowd: 0 };
    let dur = 0;
    for (const e of events) dur += e.d;
    const mean = events.reduce((a, e) => a + e.p, 0) / events.length;
    const cost = (shift) => {
      let c = 0;
      const by = {};
      for (const e of events) {
        const p = e.p + shift;
        for (const o of others) {
          if (Math.abs(p - o.p) > 2) continue;
          const ov = Math.min(e.t + e.d, o.t + o.d) - Math.max(e.t, o.t);
          if (ov <= 0) continue;
          const w = ov * (p === o.p ? 1 : 0.6) * (CLASH[o.role] != null ? CLASH[o.role] : 0.6);
          c += w;
          by[o.role] = (by[o.role] || 0) + w;
        }
      }
      return { c: c / dur, by };
    };
    const here = cost(0);
    if (here.c < 0.45) return { shift: 0, note: null, crowd: here.c };
    let best = { shift: 0, c: here.c };
    for (const shift of [12, -12]) {
      if (mean + shift < room[0] || mean + shift > room[1]) continue;
      const k = cost(shift).c;
      if (k < best.c * 0.4 && k < best.c - 0.3) best = { shift, c: k };
    }
    if (!best.shift) return { shift: 0, note: null, crowd: here.c };
    const who = Object.keys(here.by).sort((a, b) => here.by[b] - here.by[a])[0];
    return {
      shift: best.shift, crowd: here.c,
      note: 'Moved ' + (best.shift > 0 ? 'up' : 'down') + ' an octave to clear the ' + (ROLE_NAMES[who] || who),
    };
  }

  /**
   * arp and chords leave room while the lead plays: hits under a busy lead
   * may drop out (never on a chord change or a downbeat), and hits in the
   * lead's rests come forward. notes: raw generator notes { t, d, v, ... }.
   */
  function answer(role, notes, band, rng, keep) {
    if ((role !== 'arp' && role !== 'chords') || !has(band, 'lead')) return { notes, note: null };
    const lead = band.lead;
    if (!lead.some((x) => x > 0)) return { notes, note: null };
    const groups = new Map();
    for (const n of notes) {
      if (!groups.has(n.t)) groups.set(n.t, []);
      groups.get(n.t).push(n);
    }
    const strength = role === 'arp' ? 0.55 : 0.35;
    const drop = new Set();
    let thinned = 0, lifted = 0;
    for (const [t, g] of groups) {
      const s = Math.round(t / STEP) % lead.length;
      const busy = lead[s];
      if (busy > 0.5) {
        for (const n of g) n.v -= 6;
        if (!keep(t) && t % (BAR / 4) !== 0 && rng.chance(strength * busy)) {
          for (const n of g) drop.add(n);
          thinned++;
        }
      } else if (busy === 0) {
        for (const n of g) n.v += 6;
        lifted++;
      }
    }
    const out = drop.size ? notes.filter((n) => !drop.has(n)) : notes;
    if (!out.length) return { notes, note: null };
    return { notes: out, note: thinned || lifted ? 'Leaves room for the lead and answers in its rests' : null };
  }

  Odd.band = { hear, fold, balance, lockBass, clearRegister, answer, lockOf, has, LOCK, ROOM };
})(globalThis.Odd = globalThis.Odd || {});
