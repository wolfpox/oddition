/* Oddition — ideas: the core of a piece of music, apart from what shapes it.
 *
 * An idea is what is left of some music once its influences are stripped
 * away: when its notes fall and which of them are strong (rhythm), which way
 * it moves (contour), and the note it heads for (landing). Key, chords,
 * exact pitches, register, sound, swing and dynamics are influence. They stay
 * in the parts the idea was found in, which the idea keeps as source
 * material.
 *
 * An idea has one or more voices, so a lone hook, a kick-and-bass lock or a
 * whole riff section can each be one idea. Voices can be split off into ideas
 * of their own, and ideas can be joined.
 *
 *   idea  = { id, name, bars, voices: [voice], style, from, created, starred, tags, bones, meter? }
 *           meter: its time signature ('3/4', '7/8', ...) when it isn't 4/4. Every
 *           voice of an idea shares one meter (join refuses to mix them).
 *           from: where it was captured ('booth' | 'section' | 'shelf' | 'join' | 'split' | 'bones')
 *           bones: (optional) the Bones to Gold idea it was built from (Odd.audition), to keep building it there
 *   voice = { role, name, sourceId, part, oct, form, core }
 *           part: a copy of the part as found (null for a voice that is only a core)
 *           oct, form: how the part was played where it was found (slot octave and form)
 *   core  = { len, drum, hits: [{ t, d, w, h }], land, root, meter? }
 *           t, d  onset and length in ticks
 *           w     weight: 0 ghost, 1 normal, 2 accent (from velocity, place in the bar, length)
 *           h     height. Pitched: scale steps from the first note (+2 is a third up).
 *                 Drums: 0 low (kicks, low toms, low congas), 1 mid (snares, claps,
 *                 hand drums), 2 high (hats, cymbals, shakers, bells)
 *           land  index of the hit the idea heads for
 *           root  pitched only: the first note's scale degree, used to sound the
 *                 bones in a key. It is not part of the idea's identity.
 *
 * A pitched voice is one line. Where several notes start together (a chord)
 * the top note is the line, as the ear hears it, except for bass, where the
 * lowest is.
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;

  const MAX_BARS = 16;

  // ---------------- extraction ----------------

  const LOW_DRUMS = new Set([35, 36, 41, 43, 45, 47, 64, 66]);
  const HIGH_DRUMS = new Set([42, 44, 46, 49, 51, 52, 53, 54, 55, 56, 57, 59, 67, 68, 69, 70, 73, 74, 75, 76, 77, 80, 81]);

  /** 0 low, 1 mid, 2 high */
  function drumClass(p) {
    if (LOW_DRUMS.has(p)) return 0;
    if (HIGH_DRUMS.has(p)) return 2;
    return 1;
  }

  /**
   * How strong a place in the bar is: 1 the downbeat, 0.75 beat 3, 0.5 other
   * beats, 0.25 off-beat 8ths, 0 the rest. In another meter (mid), beat 3 is
   * any group start (Odd.theory.stepWeight).
   */
  function metric(t, mid) {
    if (mid && mid !== '4/4') {
      const m = T.meter(mid), x = T.mod(t, m.ticks);
      return x % T.STEP === 0 ? T.stepWeight(m, x / T.STEP) : 0;
    }
    const x = T.mod(t, T.BAR);
    if (x === 0) return 1;
    if (x === 2 * T.BEAT) return 0.75;
    if (x % T.BEAT === 0) return 0.5;
    if (x % (T.BEAT / 2) === 0) return 0.25;
    return 0;
  }

  /** a note's place in semitones above the tonic, for picking the top or bottom of a chord */
  function height(n) {
    return Math.floor(n.deg / 7) * 12 + [0, 2, 4, 5, 7, 9, 11][T.mod(n.deg, 7)] + (n.acc || 0);
  }

  /** the notes a part plays where it was found: its form applied, cut to its length */
  function heardNotes(part, form) {
    const len = T.partTicks(part);
    const drum = T.isDrumRole(part.role);
    const notes = form && form !== 'full' && Odd.render ? Odd.render.formNotes(part.notes || [], form, len, drum, part.meter) : part.notes || [];
    return notes.filter((n) => n.t >= 0 && n.t < len);
  }

  /**
   * The pure core of one part: rhythm, weight, contour and landing.
   * opts: { form } plays the part in a form first (Odd.render.FORMS).
   */
  function extract(part, opts) {
    const o = opts || {};
    const mid = T.meter(part.meter).id;
    const len = Math.max(1, Math.min(MAX_BARS, part.bars || 1)) * T.barTicks(mid);
    const drum = T.isDrumRole(part.role);
    const notes = heardNotes(part, o.form);
    const meta = mid === '4/4' ? {} : { meter: mid };
    let raw = [];
    if (drum) {
      // one hit per onset and height: kick and floor tom together are one low hit
      const at = new Map();
      for (const n of notes) {
        if (n.p == null) continue;
        const h = drumClass(n.p);
        const key = n.t + ':' + h;
        const cur = at.get(key);
        if (!cur) at.set(key, { t: n.t, d: n.d, v: n.v || 90, h });
        else { cur.v = Math.max(cur.v, n.v || 90); cur.d = Math.max(cur.d, n.d); }
      }
      raw = [...at.values()];
    } else {
      // one note per onset: the top of a chord, or the bottom for bass
      const low = part.role === 'bass';
      const at = new Map();
      for (const n of notes) {
        if (n.deg == null) continue;
        const cur = at.get(n.t);
        if (!cur || (low ? height(n) < height(cur.n) : height(n) > height(cur.n))) at.set(n.t, { n, v: Math.max(n.v || 90, cur ? cur.v : 0) });
        else cur.v = Math.max(cur.v, n.v || 90);
      }
      raw = [...at.values()].map(({ n, v }) => ({ t: n.t, d: n.d, v, deg: n.deg }));
    }
    raw.sort((a, b) => a.t - b.t || (a.h || 0) - (b.h || 0));
    if (!raw.length) return Object.assign({ len, drum, hits: [], land: -1, root: drum ? null : 0 }, meta);

    let vmin = 127, vmax = 1;
    for (const r of raw) { vmin = Math.min(vmin, r.v); vmax = Math.max(vmax, r.v); }
    const spread = vmax - vmin;
    const root = drum ? null : raw[0].deg;
    const hits = raw.map((r) => {
      const vel = spread >= 10 ? (r.v - vmin) / spread : 0.5;
      const m = metric(r.t, mid);
      const score = drum ? 0.65 * vel + 0.35 * m : 0.55 * vel + 0.3 * m + 0.15 * Math.min(1, r.d / T.BEAT);
      const w = score >= 0.6 ? 2 : score < 0.28 ? 0 : 1;
      const d = Math.max(1, Math.min(r.d, len - r.t));
      return { t: r.t, d, w, h: drum ? r.h : r.deg - root };
    });
    return Object.assign({ len, drum, hits, land: landing(hits, len, drum, mid), root }, meta);
  }

  /**
   * The hit an idea heads for. Pitched: a long note on a strong beat, late in
   * the idea. Drums: a strong hit late in the cycle, low or mid before high.
   */
  function landing(hits, len, drum, mid) {
    let best = -1, bestScore = -1;
    hits.forEach((x, i) => {
      if (x.w === 0) return;
      const pos = x.t / len;
      const score = drum
        ? 0.4 * (x.w / 2) + 0.3 * metric(x.t, mid) + 0.2 * pos + (x.h < 2 ? 0.1 : 0)
        : 0.45 * Math.min(1, x.d / (2 * T.BEAT)) + 0.3 * metric(x.t, mid) + 0.25 * pos;
      if (score >= bestScore) { best = i; bestScore = score; }
    });
    return best >= 0 ? best : hits.length - 1;
  }

  // ---------------- building ideas ----------------

  function uid() { return Odd.model ? Odd.model.uid('i') : 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** source: { part, oct, form, sourceId } */
  function voiceFrom(src) {
    const part = clone(src.part);
    const form = src.form && src.form !== 'full' ? src.form : null;
    const v = {
      role: part.role,
      name: part.name || roleLabel(part.role),
      sourceId: src.sourceId != null ? String(src.sourceId) : part.id != null ? String(part.id) : null,
      part,
      oct: Math.max(-3, Math.min(3, Math.round(Number(src.oct) || 0))),
      form,
      core: extract(part, { form }),
    };
    return v;
  }

  function barsOf(voices) {
    let bars = 1;
    for (const v of voices) bars = Math.max(bars, Math.round(v.core.len / T.barTicks(v.core.meter)));
    return Math.min(MAX_BARS, bars);
  }
  /** the voices' meter: '4/4' unless they say otherwise */
  function meterOfVoices(voices) {
    const v = voices.find((x) => x.core && x.core.meter);
    return v ? T.meter(v.core.meter).id : '4/4';
  }
  /** an idea's meter ('4/4', '3/4', '7/8', ...) */
  function meterOf(idea) { return T.meter(idea && idea.meter).id; }
  /** an idea's length in ticks: its bars in its meter */
  function lengthOf(idea) { return Math.max(1, (idea && idea.bars) || 1) * T.barTicks(meterOf(idea)); }
  /** { meter } for an idea in another meter, nothing for 4/4 */
  function meterField(voices) { const m = meterOfVoices(voices); return m === '4/4' ? {} : { meter: m }; }

  function nameFor(voices) {
    const names = [...new Set(voices.map((v) => v.name))];
    if (!names.length) return 'Idea';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' & ' + names[1];
    return names[0] + ' & ' + (names.length - 1) + ' more';
  }

  /**
   * A new idea from parts heard together.
   * sources: [{ part, oct, form, sourceId }]; opts: { name, style, from }
   */
  function fromParts(sources, opts) {
    const o = opts || {};
    const voices = sources.filter((s) => s && s.part && Array.isArray(s.part.notes)).map(voiceFrom);
    if (!voices.length) return null;
    return make(voices, {
      name: o.name || nameFor(voices),
      style: o.style || voices[0].part.style || null,
      from: o.from || 'booth',
    });
  }

  function make(voices, o) {
    return Object.assign({
      id: uid(),
      name: o.name || nameFor(voices),
      bars: barsOf(voices),
      voices,
      style: o.style || null,
      from: o.from || 'booth',
      created: Date.now(),
      starred: false,
      tags: [],
    }, meterField(voices));
  }

  /** a new idea holding one voice of another */
  function split(idea, index) {
    const v = idea.voices[index];
    if (!v) return null;
    return make([clone(v)], { name: v.name, style: idea.style, from: 'split' });
  }

  /** a new idea holding every voice of the given ideas, in order; null when their meters differ */
  function join(ideas, opts) {
    if (new Set(ideas.map(meterOf)).size > 1) return null;
    const voices = [];
    for (const idea of ideas) for (const v of idea.voices) voices.push(clone(v));
    if (!voices.length) return null;
    const o = opts || {};
    return make(voices, {
      name: o.name || [...new Set(ideas.map((i) => i.name))].join(' & '),
      style: ideas[0].style,
      from: 'join',
    });
  }

  /** remove a voice in place; returns it (an idea keeps at least one) */
  function removeVoice(idea, index) {
    if (idea.voices.length <= 1 || !idea.voices[index]) return null;
    const [v] = idea.voices.splice(index, 1);
    idea.bars = barsOf(idea.voices);
    return v;
  }

  // ---------------- words ----------------

  const INTERVALS = ['a unison', 'a 2nd', 'a 3rd', 'a 4th', 'a 5th', 'a 6th', 'a 7th', 'an octave'];

  /** which way a line moves: 'repeats' | 'climbs' | 'falls' | 'arches' | 'dips' | 'hovers' */
  function contourOf(core) {
    const hs = core.hits.map((x) => x.h);
    if (!hs.length) return null;
    const first = hs[0], last = hs[hs.length - 1];
    const hi = Math.max(...hs), lo = Math.min(...hs);
    if (hi === lo) return 'repeats';
    const net = last - first;
    const peak = hi - Math.max(first, last);
    const trough = Math.min(first, last) - lo;
    if (peak >= 2 && peak >= Math.abs(net)) return 'arches';
    if (trough >= 2 && trough >= Math.abs(net)) return 'dips';
    if (net >= 2) return 'climbs';
    if (net <= -2) return 'falls';
    return 'hovers';
  }

  const CONTOUR_WORDS = {
    repeats: 'repeats one note', climbs: 'climbs', falls: 'falls', arches: 'rises and falls back', dips: 'dips and comes back', hovers: 'hovers',
  };

  /** "beat 3", "the and of 2", "just after beat 4", with the bar when the idea is longer than one */
  function placeName(t, len, mid) {
    const m = T.meter(mid), BAR = m.ticks;
    const bar = Math.floor(t / BAR) + 1;
    const x = T.mod(t, BAR);
    // the beat it falls in: quarters in x/4, the groups in 6/8 and 7/8
    let k = 0;
    m.pulses.forEach((p, i) => { if (p.s * T.STEP <= x) k = i; });
    const p = m.pulses[k], beat = k + 1, off = x - p.s * T.STEP;
    const where = off === 0 ? 'beat ' + beat : p.len === 4 && off === T.BEAT / 2 ? 'the and of ' + beat : 'just after beat ' + beat;
    return len > BAR ? 'bar ' + bar + ', ' + where : where;
  }

  /** share of the hits that matter (not ghosts) that fall off the beat */
  function offBeat(core) {
    const real = core.hits.filter((x) => x.w > 0);
    if (!real.length) return 0;
    const m = T.meter(core.meter);
    const onBeat = (t) => m.pulses.some((p) => p.s * T.STEP === T.mod(t, m.ticks));
    return real.filter((x) => !onBeat(x.t)).length / real.length;
  }

  /** a short description of one voice's core, e.g. "9 notes · rises and falls back within a 5th · lands on bar 2, beat 1" */
  function describe(voice) {
    const c = voice.core;
    const n = c.hits.length;
    if (!n) return 'silent';
    const parts = [];
    const accents = c.hits.filter((x) => x.w === 2).length;
    if (c.drum) {
      parts.push(n + (n === 1 ? ' hit' : ' hits') + (accents ? ', ' + accents + ' strong' : ''));
      const used = [0, 1, 2].filter((h) => c.hits.some((x) => x.h === h)).map((h) => ['low', 'mid', 'high'][h]);
      parts.push(used.length === 3 ? 'low, mid and high' : used.join(' and ') + ' only');
    } else {
      parts.push(n + (n === 1 ? ' note' : ' notes'));
      const shape = contourOf(c);
      const hs = c.hits.map((x) => x.h);
      const range = Math.max(...hs) - Math.min(...hs);
      if (shape === 'repeats') parts.push(CONTOUR_WORDS.repeats);
      else parts.push(CONTOUR_WORDS[shape] + ' ' + (range > 7 ? 'over more than an octave' : 'within ' + INTERVALS[range]));
    }
    const off = offBeat(c);
    parts.push(off < 0.25 ? 'on the beat' : off < 0.55 ? 'some off-beats' : 'syncopated');
    const land = c.hits[c.land];
    if (land && n > 1) parts.push('lands on ' + placeName(land.t, c.len, c.meter));
    return parts.join(' · ');
  }

  function roleLabel(role) {
    return Odd.model ? Odd.model.roleInfo(role).label : role;
  }

  // ---------------- sounding ----------------

  const BONES_VEL = [52, 84, 112];
  const BONES_DRUMS = [36, 38, 42]; // kick, snare, closed hat

  /** the register a voice plays in: its part's, moved by the octave it had where it was found */
  function baseOf(voice) {
    const info = Odd.model ? Odd.model.roleInfo(voice.role) : null;
    const b = voice.part && voice.part.base != null ? voice.part.base : info && info.base != null ? info.base : 60;
    return b + 12 * (voice.oct || 0);
  }

  /**
   * The bones of one voice: only its core, sounded plainly. Pitched voices
   * play their contour as plain scale steps from where they start (no chords,
   * no accidentals); drums play kick, snare and hat for low, mid and high.
   * Velocity comes only from the weight. Loops to `length`.
   * target: { tonic, scale, length }
   */
  function bonesEvents(voice, target) {
    const c = voice.core;
    const tg = target || {};
    const len = c.len || T.BAR;
    const length = tg.length || len;
    const base = baseOf(voice);
    const out = [];
    for (let start = 0; start < length; start += len) {
      for (const x of c.hits) {
        const t = start + x.t;
        if (t >= length) continue;
        const v = BONES_VEL[x.w] || 84;
        if (c.drum) out.push({ t, d: 60, p: BONES_DRUMS[x.h] || 38, v });
        else {
          const d = Math.max(30, Math.min(x.d, length - t));
          out.push({ t, d, p: T.pitchOf((c.root || 0) + x.h, 0, tg.tonic || 0, tg.scale || 'major', base), v });
        }
      }
    }
    return out.sort((a, b) => a.t - b.t || a.p - b.p);
  }

  /** a voice as it was found: its part, in its form and octave, over its own chords, in the target key */
  function fullEvents(voice, target) {
    const tg = target || {};
    return voiceAt(voice, 'notes', { tonic: tg.tonic, scale: tg.scale, length: tg.length || voice.core.len });
  }

  // ---------------- the ladder ----------------

  /*
   * The ladder: one idea heard from its bones up to a full mix, each step
   * adding one layer of influence. The first three are the idea on its own;
   * the last three fit it into a section.
   *   rhythm   when the notes fall and how strong they are: one sound, no pitch
   *   shape    + which way it moves: plain scale steps (the bones)
   *   notes    + the notes as written: chords, accidentals, lengths, dynamics,
   *            over the chords it was written on
   *   harmony  + bent to the target's chords (refit)
   *   sound    + lane sounds, swing and human timing (the app's job)
   *   band     + the target's other parts and its energy (the app's job)
   * Events for harmony, sound and band are the same notes; what changes on
   * the last two is how they are played and what plays with them.
   */
  const RUNGS = [
    { id: 'rhythm', label: 'Rhythm', group: 'idea' },
    { id: 'shape', label: 'Shape', group: 'idea' },
    { id: 'notes', label: 'Notes', group: 'idea' },
    { id: 'harmony', label: 'Harmony', group: 'fit' },
    { id: 'sound', label: 'Sound and feel', group: 'fit' },
    { id: 'band', label: 'Band', group: 'fit' },
  ];
  const RUNG_IDS = RUNGS.map((r) => r.id);
  const RHYTHM_DRUM = 37; // side stick: a tap on the table

  function rungIndex(id) { return Math.max(0, RUNG_IDS.indexOf(id)); }

  /** rhythm alone: every hit on one sound (the first note's pitch, or a side stick), velocity from weight */
  function rhythmEvents(voice, target) {
    const c = voice.core;
    const tg = target || {};
    const len = c.len || T.BAR;
    const length = tg.length || len;
    const p = c.drum ? RHYTHM_DRUM : T.pitchOf(c.root || 0, 0, tg.tonic || 0, tg.scale || 'major', baseOf(voice));
    const out = [];
    const seen = new Set();
    for (let start = 0; start < length; start += len) {
      for (const x of c.hits) {
        const t = start + x.t;
        if (t >= length || seen.has(t)) continue; // drums hit low and high together: one tap
        seen.add(t);
        out.push({ t, d: c.drum ? 60 : Math.max(30, Math.min(x.d, length - t)), p, v: BONES_VEL[x.w] || 84 });
      }
      seen.clear();
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /**
   * One voice at a step of the ladder.
   * target: { tonic, scale, length, prog } (prog: the chords to fit to; none = its own)
   * A voice with no part (a core alone) plays its bones from 'notes' up.
   */
  function voiceAt(voice, rung, target) {
    const tg = target || {};
    const i = rungIndex(rung);
    if (i === 0) return rhythmEvents(voice, tg);
    if (i === 1 || !voice.part || !Odd.render) return bonesEvents(voice, tg);
    const part = voice.part;
    const ctx = part.ctx || {};
    const fit = i >= 3 && tg.prog && tg.prog.length && !part.imported;
    return Odd.render.partEvents(part, {
      tonic: tg.tonic != null ? tg.tonic : ctx.tonic,
      scale: tg.scale || ctx.scale,
      prog: fit ? tg.prog : ctx.prog, // over its own chords, refitting changes nothing
      length: tg.length || voice.core.len,
      oct: voice.oct || 0,
      form: voice.form || undefined,
    });
  }

  /**
   * Events for a whole idea at a step, one track per voice ("<prefix><index>").
   * opts: { rung, tonic, scale, prog, length (default the idea's), mute: [voice indices], prefix }
   */
  function rungEvents(idea, opts) {
    const o = opts || {};
    const length = o.length || lengthOf(idea);
    const prefix = o.prefix || '__v';
    const mute = new Set(o.mute || []);
    const out = [];
    idea.voices.forEach((v, i) => {
      if (mute.has(i)) return;
      for (const e of voiceAt(v, o.rung, { tonic: o.tonic, scale: o.scale, prog: o.prog, length })) {
        e.track = prefix + i;
        out.push(e);
      }
    });
    return out.sort((a, b) => a.t - b.t || a.p - b.p);
  }

  /**
   * Events for a whole idea, one track per voice ("<prefix><index>").
   * opts: { mode: 'bones' (the shape step) | 'full' (the notes step), tonic, scale, mute, prefix }
   */
  function events(idea, opts) {
    const o = opts || {};
    return rungEvents(idea, Object.assign({}, o, { rung: o.mode === 'full' ? 'notes' : 'shape', prog: null }));
  }

  // ---------------- loading ----------------

  /** repair a loaded idea, or null when nothing usable is left */
  function repair(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.voices)) return null;
    const voices = [];
    for (const v of raw.voices) {
      if (!v || typeof v !== 'object') continue;
      const part = v.part && typeof v.part === 'object' && v.part.role && Array.isArray(v.part.notes) ? v.part : null;
      const role = part ? part.role : v.role;
      if (!role) continue;
      let core = v.core;
      const coreOk = core && Array.isArray(core.hits) && core.len > 0;
      if (!coreOk && !part) continue;
      if (!coreOk) core = extract(part, { form: v.form });
      voices.push({
        role,
        name: String(v.name || (part && part.name) || roleLabel(role)),
        sourceId: v.sourceId != null ? String(v.sourceId) : null,
        part,
        oct: Math.max(-3, Math.min(3, Math.round(Number(v.oct) || 0))),
        form: typeof v.form === 'string' && v.form !== 'full' ? v.form : null,
        core,
      });
    }
    if (!voices.length) return null;
    // an idea is one meter: voices that disagree with the first are dropped
    const mid = meterOfVoices(voices);
    for (let i = voices.length - 1; i >= 0; i--) if (T.meter(voices[i].core.meter).id !== mid) voices.splice(i, 1);
    return {
      ...meterField(voices),
      id: raw.id != null ? String(raw.id) : uid(),
      name: String(raw.name || nameFor(voices)),
      bars: barsOf(voices),
      voices,
      style: raw.style || null,
      from: raw.from || 'booth',
      created: Number(raw.created) || Date.now(),
      starred: !!raw.starred,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      ...(raw.bones && typeof raw.bones === 'object' && (raw.bones.melody || raw.bones.path) ? { bones: raw.bones } : {}),
    };
  }

  Odd.idea = {
    MAX_BARS, drumClass, metric, extract, landing, meterOf, lengthOf,
    fromParts, voiceFrom, split, join, removeVoice, nameFor,
    contourOf, describe, placeName, offBeat,
    bonesEvents, fullEvents, events, repair,
    RUNGS, rungIndex, rhythmEvents, voiceAt, rungEvents,
  };
})(globalThis.Odd = globalThis.Odd || {});
