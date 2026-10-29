/* Oddition — the Song Builder's core: one or two ideas grown into a song.
 *
 * Pure (Node-testable). The screen is js/ui/song.js.
 *
 * A song is a row of sections. Each section has three parts: a way in (build
 * up), the section itself (substance), and a few bars after it before the next
 * one (finish). Bobby offers three options for each part, ranked by the
 * keywords the user put in order. A section is open (Bobby may change it) or
 * closed (hands off). The song is done when every section is closed.
 *
 *   song = { id, name, main: idea, guest: idea | null, role, kw: [{ id, lean }],
 *            secs: [sec], nid, lv, created, updated }
 *          main and guest are copies of ideas from the book, so a song still
 *          plays if the idea is later changed or deleted. Layers added in the
 *          Song Builder are voices appended to main (voice.added); removing one
 *          marks it voice.removed, so every layer key ('v<index>') stays put.
 *          lv counts layer changes.
 *   sec  = { id, name, named, kind, open, body: cfg | null, intro: part | null, outro: part | null, hist: [snap], tag }
 *          kind: the treatment it came from (TREAT ids, or 'main')
 *          named: the user named it, so a new substance keeps the name
 *          tag: the last change's tag (patchSec): repeats of a tagged change share one Undo step
 *   part = { k, bars }   k: INTROS / OUTROS id
 *   cfg  = { src, bars, arr, lay: { key: { on, form } }, tw: { key: { x, ds, oct } },
 *            half, shift, bpm, swing, energy, curve, twists: { bar: id }, edit }
 *          src    which melody: main | guest | answer | callans | bar2 | edit
 *          arr    which layers play when: full | breakdown | bones | climb | drums | strip | ...
 *          lay    per layer (one per voice of the main idea, keyed 'v<index>'):
 *                 on, and form (Odd.render FORMS)
 *          tw     per layer tweaks: x (half | double | chop), ds (scale steps), oct
 *          shift  semitones, the whole section (a key change)
 *          swing  0..0.6 (Odd.render.applySwing)
 *          energy 0..1, curve (Odd.shape CURVES): through Odd.shape.shapeLane
 *          twists one bar each: drop | fill | stop | stutter | breath | octave
 *          edit   the melody's notes when edited by hand (src 'edit')
 *
 * Rendering gives events in ticks at the section's own tempo; songs and
 * previews stretch each section to the song's tempo.
 *
 * A song is in its main idea's meter (C.meter, C.BAR ticks a bar): bars,
 * fills, stops and count-ins all follow it. A guest must share it.
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const R = Odd.render;
  const BEAT = T.BEAT, STEP = T.STEP;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r2 = (x) => Math.round(x * 100) / 100;
  const txt = (v, c) => (typeof v === 'function' ? v(c) : v);
  const uid = (p) => (Odd.model && Odd.model.uid ? Odd.model.uid(p) : p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

  // ---------------------------------------------------------------- vocabulary

  const ACTS = [
    { id: 'build', title: 'Build up', sub: 'Into this section', color: 'var(--r-pad)' },
    { id: 'sub', title: 'Substance', sub: 'The section itself', color: 'var(--r-lead)' },
    { id: 'fin', title: 'Finish / hand off', sub: 'After it, before the next', color: 'var(--r-arp)' },
  ];
  const ACT = {};
  ACTS.forEach((a) => { ACT[a.id] = a; });

  const ROLE_LABEL = { lead: 'Melody', chords: 'Chords', bass: 'Bass', pad: 'Pads', perc: 'Percussion', drums: 'Beat', arp: 'Arp' };
  const GROUP = { drums: 'rhy', perc: 'rhy', bass: 'bass', chords: 'harm', pad: 'harm', lead: 'mel', arp: 'mel' };
  const MIX = { lead: 0.9, arp: 0.6, chords: 0.55, pad: 0.45, bass: 0.8, perc: 0.7, drums: 0.8 };
  const DRUMS_FIRST = ['drums', 'perc', 'bass', 'chords', 'pad', 'arp', 'lead'];
  // Bones to Gold sounds (Odd.audition), for ideas built there
  const NEUTRAL = { lead: 'lead-soft', chords: 'keys', bass: 'bass-pluck', kit: 'kit-acoustic' };
  const PAD_PATCH = { pad: 'pad-warm', voice: 'epiano', strings: 'strings', glass: 'pad-glass' };
  const KICK = 36, SNARE = 38, HAT = 42, CRASH = 49;

  /* Keywords: each one moves real settings, paired with its opposite. Every
   * option carries a trait vector over these ids; ranking is the dot product
   * with the user's leans, weighted by rank. */
  const KW = [
    { id: 'drive', lo: 'Laid-back', hi: 'Driving' },
    { id: 'busy', lo: 'Spare', hi: 'Busy' },
    { id: 'full', lo: 'Roomy', hi: 'Full' },
    { id: 'bright', lo: 'Dark', hi: 'Bright' },
    { id: 'push', lo: 'Steady', hi: 'Pushing' },
    { id: 'change', lo: 'Repeating', hi: 'Changing' },
    { id: 'adv', lo: 'Expected', hi: 'Adventurous' },
    { id: 'long', lo: 'Short', hi: 'Long' },
  ];
  const KWD = {};
  KW.forEach((k) => { KWD[k.id] = k; });
  function defaultKw() { return KW.map((k) => ({ id: k.id, lean: 0 })); }

  function score(kw, t) {
    let s = 0;
    const n = kw.length;
    kw.forEach((k, i) => { if (k.lean) s += k.lean * (t[k.id] || 0) * (n - i) / n; });
    return s;
  }
  /** a short tag for a card: which leans it matches, or its strongest traits */
  function tagsOf(kw, t) {
    const leaned = kw.filter((k) => k.lean);
    if (leaned.length) {
      const yes = leaned.filter((k) => (t[k.id] || 0) * k.lean > 0.25).slice(0, 2).map((k) => (k.lean > 0 ? KWD[k.id].hi : KWD[k.id].lo));
      if (yes.length) return 'Matches ' + yes.join(', ');
      const no = leaned.find((k) => (t[k.id] || 0) * k.lean < -0.25);
      return no ? 'Not very ' + (no.lean > 0 ? KWD[no.id].hi : KWD[no.id].lo).toLowerCase() : '';
    }
    return Object.keys(t).filter((id) => KWD[id]).sort((a, b) => Math.abs(t[b]) - Math.abs(t[a])).slice(0, 2)
      .map((id) => (t[id] > 0 ? KWD[id].hi : KWD[id].lo)).join(', ');
  }

  // ---------------------------------------------------------------- context

  function leadOf(idea) {
    if (!idea) return -1;
    let i = idea.voices.findIndex((v) => v.role === 'lead' && v.part && !v.removed);
    if (i < 0) i = idea.voices.findIndex((v) => !T.isDrumRole(v.role) && v.part && !v.removed);
    return i;
  }

  function swingAmount(bonesSwing) { return bonesSwing > 0.5 ? clamp(bonesSwing * 4 - 2, 0, 0.6) : 0; }

  /**
   * Everything rendering needs from the song's ideas.
   * env: { bpm, swing, patchFor(role) } for ideas not built in Bones to Gold.
   */
  function context(song, env) {
    const E = env || {};
    const main = song.main, guest = song.guest || null;
    const bones = main.bones && main.bones.layers ? main.bones : null;
    const snd = bones ? bones.layers.sound : null;
    const G = snd && Odd.audition && Odd.audition.GENRES ? Odd.audition.GENRES[snd.id] : null;
    const P = G ? G.patches : NEUTRAL;
    const seen = {};
    const layers = [];
    main.voices.forEach((v, i) => {
      if (v.removed) return;
      seen[v.role] = (seen[v.role] || 0) + 1;
      const label = (ROLE_LABEL[v.role] || v.role) + (seen[v.role] > 1 ? ' ' + seen[v.role] : '');
      layers.push({ key: 'v' + i, i, role: v.role, label, voice: v, drum: T.isDrumRole(v.role), group: GROUP[v.role] || 'mel', added: !!v.added });
    });
    const li = leadOf(main);
    const lead = li >= 0 ? 'v' + li : null;
    const srcPart = (li >= 0 ? main.voices[li].part : null) || (main.voices.find((v) => v.part) || {}).part || null;
    const ctx = srcPart && srcPart.ctx ? srcPart.ctx : { tonic: 0, scale: 'major', prog: [{ deg: 0, beats: 4 }] };
    const patchFor = (role) => {
      if (bones) {
        if (role === 'lead' || role === 'arp') return P.lead;
        if (role === 'chords') return P.chords;
        if (role === 'bass') return P.bass;
        if (role === 'drums') return P.kit;
        if (role === 'perc') return 'kit-perc';
        if (role === 'pad') return PAD_PATCH[bones.layers.pads && bones.layers.pads.voice] || 'pad-warm';
      }
      return (E.patchFor && E.patchFor(role)) || (Odd.model ? Odd.model.roleInfo(role).defaultPatch : 'keys');
    };
    const tracks = {};
    let ch = 0;
    const nextCh = () => { const c = ch++; if (ch === 9) ch++; return c % 16; };
    layers.forEach((l) => {
      tracks['sm-' + l.key] = { role: l.role, patch: patchFor(l.role), volume: MIX[l.role] || 0.7, mute: false, solo: false, channel: l.drum ? 9 : nextCh(), name: l.label };
    });
    const byRole = (r) => layers.find((l) => l.role === r);
    const pk = (r, fb) => (byRole(r) ? tracks['sm-' + byRole(r).key].patch : fb);
    tracks['sm-fx'] = { role: 'drums', patch: pk('drums', G ? G.patches.kit : 'kit-acoustic'), volume: 0.8, mute: false, solo: false, channel: 9, name: 'Fills' };
    tracks['sm-hold'] = { role: 'pad', patch: pk('pad', pk('chords', 'pad-warm')), volume: 0.5, mute: false, solo: false, channel: nextCh(), name: 'Held chords' };
    tracks['sm-low'] = { role: 'bass', patch: pk('bass', 'bass-sub'), volume: 0.75, mute: false, solo: false, channel: nextCh(), name: 'Low notes' };
    const gi = leadOf(guest);
    const leadPart = lead ? main.voices[li].part : null;
    const meter = Odd.idea && Odd.idea.meterOf ? Odd.idea.meterOf(main) : '4/4', MT = T.meter(meter);
    return {
      meter, MT, BAR: MT.ticks,
      id: main.id + ':' + main.voices.length + ':' + (song.lv || 0) + '|' + (guest ? guest.id : ''),
      env: E, main, guest, layers, lead, tracks,
      guestLead: gi >= 0 ? guest.voices[gi] : null,
      tonic: ctx.tonic || 0, scale: ctx.scale || 'major', prog: ctx.prog && ctx.prog.length ? ctx.prog : [{ deg: 0, beats: 4 }],
      leadBase: leadPart ? (leadPart.base != null ? leadPart.base : 60) + 12 * (main.voices[li].oct || 0) : 72,
      bpm: snd ? snd.bpm : clamp(Math.round(Number(E.bpm) || 100), 40, 240),
      // meters that move in threes (6/8, 7/8) don't swing
      swing: MT.compound ? 0 : snd ? swingAmount(snd.swing) : clamp(Number(E.swing) || 0, 0, 0.6),
      ideaBars: main.bars || 2,
      genre: G ? G.name : '',
    };
  }

  // ---------------------------------------------------------------- sections

  function defaultBars(C) { const ib = Math.max(1, C.ideaBars); return Math.min(16, Math.ceil(8 / ib) * ib); }

  function baseCfg(C, o) {
    const off = (o && o.off) || [];
    const lay = {};
    C.layers.forEach((l) => { lay[l.key] = { on: !off.includes(l.role), form: 'full' }; });
    const cfg = { src: 'main', bars: defaultBars(C), arr: 'full', lay, tw: {}, half: false, shift: 0, bpm: C.bpm, swing: C.swing, energy: 0.7, curve: 'flat', twists: {}, edit: null };
    const over = Object.assign({}, o || {});
    delete over.off;
    return Object.assign(cfg, over);
  }

  const ROLES = {
    verse: { label: 'Verse', sub: 'Lighter: melody, chords, bass and a little percussion.', make: (C) => baseCfg(C, { energy: 0.45, off: ['drums', 'pad'] }) },
    chorus: { label: 'Chorus', sub: 'Everything in, full energy.', make: (C) => baseCfg(C, { energy: 0.75 }) },
    hook: { label: 'Hook', sub: 'Short and loud: the melody doubled an octave up.', make: (C) => baseCfg(C, { bars: Math.min(16, Math.max(4, C.ideaBars * 2)), energy: 0.9 }) },
  };
  const ROLE_ORDER = ['verse', 'chorus', 'hook'];

  const withMain = (c, over) => Object.assign(clone(c.mainCfg), over);
  const twLead = (c, w) => { const tw = {}; if (c.C.lead) tw[c.C.lead] = w; return tw; };

  /* What a section can be. c = { C, mainCfg, song } */
  const TREAT = [
    { id: 'asis', nm: 'Chorus', label: 'As written', sub: 'Your idea, exactly as you made it.', t: { adv: -1, change: -1, full: 0.6 }, cfg: (c) => clone(c.mainCfg) },
    { id: 'light', nm: 'Verse', label: 'Lighter', sub: 'Melody, chords, bass and a little percussion. Room to grow.', t: { full: -0.8, drive: -0.4, busy: -0.4 }, cfg: (c) => ROLES.verse.make(c.C) },
    { id: 'up4', nm: 'Last chorus', label: 'Up a fourth', sub: 'The same section, lifted five semitones. Classic for a last chorus.', t: { bright: 1, adv: 0.4, drive: 0.4, change: 0.5 }, cfg: (c) => withMain(c, { shift: 5 }) },
    { id: 'guest', nm: 'Verse', needs: 'guest', label: (c) => c.C.guest.name + ' melody', sub: (c) => c.C.guest.name + '’s tune, moved into your key, over your chords.', t: { adv: 1, change: 1 }, cfg: (c) => withMain(c, { src: 'guest', energy: 0.55 }) },
    { id: 'answer', nm: 'Verse', needs: 'lead', label: 'Answer phrase', sub: 'Your melody turned upside down, landing home.', t: { change: 0.8, adv: 0.4, bright: -0.3 }, cfg: (c) => withMain(c, { src: 'answer', energy: 0.55 }) },
    { id: 'callans', nm: 'Verse', needs: 'lead', label: 'Call and answer', sub: 'Your melody asks, its mirror answers.', t: { change: 1, busy: 0.3, long: 0.4 }, cfg: (c) => withMain(c, { src: 'callans', energy: 0.6 }) },
    { id: 'half', nm: 'Bridge', label: 'Half-time', sub: 'Everything at half speed, the first half stretched over the whole. Heavy and slow.', t: { drive: -1, busy: -0.8, adv: 0.5 }, cfg: (c) => withMain(c, { half: true, energy: 0.55 }) },
    { id: 'chop', nm: 'Drop', needs: 'lead', label: 'Chopped', sub: 'The melody’s first beat, stuttered across the bar.', t: { push: 1, busy: 0.8, adv: 0.8, change: 0.4 }, cfg: (c) => withMain(c, { tw: twLead(c, { x: 'chop' }), energy: 0.85 }) },
    { id: 'break', nm: 'Breakdown', label: 'Breakdown', sub: 'Drums and bass out. Melody, chords and pads breathe.', t: { full: -1, drive: -0.8, busy: -0.6, change: 0.4 }, cfg: (c) => withMain(c, { arr: 'breakdown', energy: 0.35 }) },
    { id: 'double', nm: 'Chorus', needs: 'lead', label: 'Double-time', sub: 'The melody twice as fast, played twice.', t: { busy: 1, drive: 1, adv: 0.6 }, cfg: (c) => withMain(c, { tw: twLead(c, { x: 'double' }), energy: 0.85 }) },
    { id: 'bones', nm: 'Interlude', needs: 'lead', label: 'Melody alone', sub: 'Just the melody, the way your idea started.', t: { busy: -1, full: -1, drive: -0.6, adv: 0.2 }, cfg: (c) => baseCfg(c.C, { bars: Math.min(16, Math.max(2, c.C.ideaBars * 2)), arr: 'bones', energy: 0.4 }) },
  ];
  const TREAT_BY = {};
  TREAT.forEach((t) => { TREAT_BY[t.id] = t; });

  /* Every section can have a way in and a way out (a few bars after it, before the next). */
  const INTROS = [
    { id: 'none', label: 'Straight in', sub: 'No build up. The section starts on its first beat.', bars: 0, t: { long: -1, adv: -0.3, drive: 0.4 } },
    { id: 'climb', label: 'The climb', sub: 'Its layers arrive one at a time, in the order you built them.', bars: 4, t: { long: 1, change: 0.6, adv: -0.5 } },
    { id: 'drums', label: 'Drums first', sub: 'The groove starts; everything else comes in on top.', bars: 4, t: { drive: 1, push: 0.6, long: 0.5 } },
    { id: 'tease', label: 'Tease', sub: 'Half the melody over chords: a hint of what’s coming.', bars: 2, t: { adv: 0.6, full: -0.6, busy: -0.5 } },
    { id: 'riser', label: 'Snare build', sub: 'The melody outlined while a snare roll builds into it.', bars: 2, t: { drive: 1, busy: 0.8, push: 0.4 } },
    { id: 'gap', label: 'Build, then silence', sub: 'A snare build that stops dead one beat before the section lands.', bars: 2, t: { push: 1, adv: 0.6, drive: 0.6 } },
    { id: 'swell', label: 'Pad swell', sub: 'Chords and pads alone, rising in volume.', bars: 2, t: { full: -0.4, drive: -0.6, long: 0.3 } },
    { id: 'pickup', label: 'Pickup fill', sub: 'One bar of drums tips you in.', bars: 1, t: { drive: 0.8, long: -0.6, busy: 0.4 } },
    { id: 'slow', label: 'Slow motion', sub: 'The section at half speed, before the real thing.', bars: 2, t: { drive: -1, adv: 0.8 } },
  ];
  const OUTROS = [
    { id: 'none', label: 'Straight on', sub: 'No tail. The next section starts right away.', bars: 0, t: { long: -1, drive: 0.4 } },
    { id: 'breath', label: 'Breathing room', sub: 'Everything drops to one held chord. A little emptiness.', bars: 2, t: { full: -1, drive: -0.8, busy: -0.8 } },
    { id: 'pulse', label: 'Tension pulse', sub: 'One note pulses with the kick while the hats tighten. Something is coming.', bars: 2, t: { push: 1, drive: 0.8, adv: 0.4 } },
    { id: 'strip', label: 'Strip down', sub: 'Layers leave one by one.', bars: 4, t: { full: -0.6, long: 0.6, adv: -0.4 } },
    { id: 'echo', label: 'Echo', sub: 'The last bar of the melody repeats as it fades.', bars: 2, t: { change: -0.6, full: -0.4, adv: 0.2 } },
    { id: 'fill', label: 'Fill into next', sub: 'One more bar, ending on a drum fill.', bars: 1, t: { drive: 1, busy: 0.6, long: -0.6 } },
    { id: 'stop', label: 'Stop and hold', sub: 'One hit, then a bar of silence.', bars: 1, t: { push: 1, adv: 0.6, long: -0.6 } },
    { id: 'handoff', label: 'Hand off', sub: 'This section fades while the next one’s groove starts underneath.', bars: 2, t: { change: 0.8, adv: 0.6, drive: 0.4 } },
    { id: 'ringout', label: 'Ring out', sub: 'The home chord rings and the melody lands home. Good for an ending.', bars: 4, t: { long: 0.4, adv: -0.8, full: 0.2 } },
    { id: 'slowout', label: 'Slow out', sub: 'Half speed as it winds down.', bars: 2, t: { drive: -1, adv: 0.5 } },
  ];
  const PART_BY = { intro: {}, outro: {} };
  INTROS.forEach((x) => { PART_BY.intro[x.id] = x; });
  OUTROS.forEach((x) => { PART_BY.outro[x.id] = x; });

  const VIBES = [
    { id: 'calm', label: 'Calmer', sub: 'A little slower and softer.', t: { drive: -1, busy: -0.4 }, f: (x) => ({ bpm: Math.round(x.bpm * 0.9), energy: clamp(x.energy - 0.25, 0.15, 1) }) },
    { id: 'energy', label: 'With energy', sub: 'Faster and harder.', t: { drive: 1, busy: 0.5 }, f: (x) => ({ bpm: Math.round(x.bpm * 1.08), energy: clamp(x.energy + 0.25, 0.15, 1) }) },
    { id: 'up', label: 'Up a step', sub: 'The whole section two semitones up.', t: { bright: 1, change: 0.3 }, f: (x) => ({ shift: x.shift + 2 }) },
    { id: 'down', label: 'Down a third', sub: 'Three semitones down. Darker, heavier.', t: { bright: -1, adv: 0.4 }, f: (x) => ({ shift: x.shift - 3 }) },
    { id: 'swing', label: (x) => (x.swing > 0.1 ? 'Straighten it' : 'Swing it'), sub: (x) => (x.swing > 0.1 ? 'Off-beats back on the grid.' : 'The off-beats lean late.'), t: { push: 0.7, drive: -0.3, adv: 0.3 }, f: (x) => ({ swing: x.swing > 0.1 ? 0 : 0.45 }) },
    { id: 'fuller', label: 'Fuller', sub: 'Every layer in.', t: { full: 1 }, ok: (x) => Object.keys(x.lay).some((k) => !x.lay[k].on), f: (x) => { const l = clone(x.lay); Object.keys(l).forEach((k) => { l[k].on = true; }); return { lay: l }; } },
    { id: 'rise', label: 'Rise through it', sub: 'Starts softer and climbs bar by bar.', t: { drive: 0.5, change: 0.6, long: 0.3 }, ok: (x) => x.curve !== 'rise', f: () => ({ curve: 'rise' }) },
    { id: 'swell', label: 'Swell', sub: 'Rises to the middle, then eases off.', t: { change: 0.5, adv: 0.3 }, ok: (x) => x.curve !== 'swell', f: () => ({ curve: 'swell' }) },
    { id: 'fall', label: 'Fall away', sub: 'Starts strong and dies away.', t: { change: 0.4, drive: -0.4 }, ok: (x) => x.curve !== 'fall', f: () => ({ curve: 'fall' }) },
    { id: 'flat', label: 'Even energy', sub: 'The same energy start to end.', t: { change: -0.6, adv: -0.4 }, ok: (x) => x.curve && x.curve !== 'flat', f: () => ({ curve: 'flat' }) },
    { id: 'thinner', label: 'Thinner', sub: 'Just melody, chords and bass.', t: { full: -1, busy: -0.4 }, needsC: true, f: (x, C) => { const l = clone(x.lay); C.layers.forEach((L) => { if (l[L.key]) l[L.key].on = ['lead', 'chords', 'bass'].includes(L.role); }); return { lay: l }; } },
  ];
  const IDEA_OPTS = [
    { id: 'main', src: 'main', label: 'Main idea', sub: 'Back to the melody as you made it.', t: { adv: -1, change: -1 } },
    { id: 'guest', src: 'guest', needs: 'guest', label: (c) => c.C.guest.name + ' melody', sub: (c) => c.C.guest.name + '’s tune over these chords.', t: { adv: 1, change: 1 } },
    { id: 'answer', src: 'answer', label: 'Answer phrase', sub: 'The melody upside down, landing home.', t: { change: 0.8, adv: 0.4 } },
    { id: 'callans', src: 'callans', label: 'Call and answer', sub: 'Melody, then its mirror.', t: { change: 1, long: 0.4 } },
    { id: 'bar2', src: 'bar2', needs: 'twobars', label: 'Second-bar motif', sub: 'Your melody’s second bar becomes the whole idea.', t: { change: 0.6, busy: -0.2, adv: 0.4 } },
  ];
  const X_LABEL = { half: 'stretched', double: 'squashed', chop: 'chopped' };
  const FORM_LABEL = { full: 'As written', outline: 'Outline', tease: 'Tease', fragment: 'Fragment', half: 'Half-time' };
  const twOf = (c, k) => c.tw[k] || {};
  const TWEAKS = [
    { id: 'half', label: 'Stretch', sub: 'Half speed: the first half stretched over the whole.', t: { busy: -1, drive: -0.6 }, ok: (L, c) => twOf(c, L.key).x !== 'half', tw: (w) => Object.assign({}, w, { x: 'half' }) },
    { id: 'double', label: 'Squash', sub: 'Twice as fast, played twice.', t: { busy: 1, drive: 0.6 }, ok: (L, c) => twOf(c, L.key).x !== 'double', tw: (w) => Object.assign({}, w, { x: 'double' }) },
    { id: 'chop', label: 'Chop', sub: 'The first beat, repeated.', t: { push: 0.8, change: 0.3, adv: 0.4 }, ok: (L, c) => twOf(c, L.key).x !== 'chop', tw: (w) => Object.assign({}, w, { x: 'chop' }) },
    { id: 'up', label: 'Up a scale step', sub: 'Same shape one step higher, still in key.', t: { bright: 0.8, adv: 0.5 }, ok: (L) => !L.drum, tw: (w) => Object.assign({}, w, { ds: (w.ds || 0) + 1 }) },
    { id: 'down', label: 'Down a scale step', sub: 'Same shape one step lower, still in key.', t: { bright: -0.8, adv: 0.5 }, ok: (L) => !L.drum, tw: (w) => Object.assign({}, w, { ds: (w.ds || 0) - 1 }) },
    { id: 'oct', label: 'Up an octave', sub: 'This layer only, an octave higher.', t: { bright: 1, full: -0.2 }, ok: (L, c) => !L.drum && !(twOf(c, L.key).oct > 0), tw: (w) => Object.assign({}, w, { oct: (w.oct || 0) + 1 }) },
    { id: 'octdown', label: 'Down an octave', sub: 'This layer only, an octave lower.', t: { bright: -1, full: 0.2 }, ok: (L, c) => !L.drum && !(twOf(c, L.key).oct < 0), tw: (w) => Object.assign({}, w, { oct: (w.oct || 0) - 1 }) },
    { id: 'reset', label: 'As written', sub: 'Back to the layer as written: no form, no tweaks.', t: { adv: -1, change: -1 }, ok: (L, c) => !!c.tw[L.key] || ((c.lay[L.key] || {}).form || 'full') !== 'full', tw: () => ({}) },
  ];
  /* how a layer plays its part (Odd.render FORMS), offered beside the tweaks */
  const FORM_OPTS = [
    { form: 'outline', t: { busy: -0.8, full: -0.4, adv: 0.2 } },
    { form: 'tease', t: { busy: -0.5, change: 0.6, adv: 0.4 } },
    { form: 'fragment', t: { change: -0.8, push: 0.4, adv: 0.3 } },
  ];
  const TWISTS = [
    { id: 'drop', label: 'Drop out', sub: 'Drums and bass vanish; the melody hangs.', t: { full: -1, adv: 0.3 }, first: 0.3 },
    { id: 'fill', label: 'Drum fill', sub: 'A snare run into whatever comes next.', t: { drive: 1, busy: 0.6 }, last: 0.6 },
    { id: 'stop', label: 'Stop-time', sub: 'Everyone hits beat one, then silence.', t: { push: 1, adv: 0.5 } },
    { id: 'stutter', label: 'Stutter', sub: 'The melody repeats its first beat.', t: { busy: 0.6, adv: 0.7, push: 0.4 } },
    { id: 'breath', label: 'Breath', sub: 'The last beat goes silent.', t: { full: -0.5, push: 0.5 }, last: 0.4 },
    { id: 'octave', label: 'Octave jump', sub: 'The melody leaps up an octave.', t: { bright: 1, change: 0.4 } },
  ];
  const TWIST_NAME = {};
  TWISTS.forEach((w) => { TWIST_NAME[w.id] = w.label; });

  // ---------------------------------------------------------------- notes

  /** a melody turned upside down around its first note, landing on it */
  function invertNotes(notes) {
    const pitched = notes.filter((n) => n.deg != null).sort((a, b) => a.t - b.t);
    if (!pitched.length) return notes.slice();
    const d0 = pitched[0].deg;
    const lastT = pitched[pitched.length - 1].t;
    return notes.map((n) => {
      if (n.deg == null) return n;
      const deg = n.t === lastT ? d0 : clamp(2 * d0 - n.deg, d0 - 7, d0 + 9);
      return Object.assign({}, n, { deg, acc: 0, st: n.st != null ? n.st : n.t });
    });
  }

  /** stretch, squash or chop a part's notes inside its own length (chop repeats the first beat: `beat` ticks) */
  function xNotes(notes, x, len, beat) {
    const BEAT = beat || T.BEAT;
    const tag = (n, o) => Object.assign({}, n, { st: n.st != null ? n.st : n.t }, o);
    if (x === 'half') return notes.filter((n) => n.t < len / 2).map((n) => tag(n, { t: n.t * 2, d: Math.max(30, n.d * 2) }));
    if (x === 'double') {
      const h = notes.map((n) => tag(n, { t: Math.floor(n.t / 2), d: Math.max(30, Math.round(n.d / 2)) }));
      return h.concat(h.map((n) => Object.assign({}, n, { t: n.t + len / 2 })));
    }
    if (x === 'chop') {
      const first = notes.filter((n) => n.t < BEAT);
      const out = [];
      for (let k = 0; k * BEAT < len; k++) first.forEach((n) => out.push(tag(n, { t: n.t + k * BEAT, d: Math.min(n.d, BEAT - n.t) })));
      return out;
    }
    return notes;
  }

  /** the melody this section plays, as a part */
  function leadPart(C, cfg) {
    const v = C.lead ? C.main.voices[Number(C.lead.slice(1))] : null;
    const base = v && v.part;
    if (!base) return null;
    const BAR = C.BAR, len = T.partTicks(base);
    const with_ = (o) => Object.assign({}, base, o);
    switch (cfg.src) {
      case 'edit': return cfg.edit ? with_({ notes: cfg.edit }) : base;
      case 'guest': return C.guestLead && C.guestLead.part ? C.guestLead.part : base;
      case 'answer': return with_({ notes: invertNotes(base.notes) });
      case 'callans': return with_({ bars: (base.bars || 1) * 2, notes: base.notes.concat(invertNotes(base.notes).map((n) => Object.assign({}, n, { t: n.t + len }))) });
      case 'bar2': {
        if ((base.bars || 1) < 2) return base;
        const h = base.notes.filter((n) => n.t >= BAR && n.t < 2 * BAR).map((n) => Object.assign({}, n, { t: n.t - BAR, st: n.st != null ? n.st : n.t }));
        const out = [];
        for (let k = 0; k * BAR < len; k++) h.forEach((n) => out.push(Object.assign({}, n, { t: n.t + k * BAR })));
        return with_({ notes: out });
      }
      default: return base;
    }
  }

  /** the melody's notes as material (what the note editor shows) */
  function material(C, cfg) {
    const p = leadPart(C, cfg);
    return p ? { bars: p.bars || 1, base: p.base, notes: p.notes.filter((n) => n.deg != null).map((n) => ({ t: n.t, d: n.d, deg: n.deg, acc: n.acc || 0, v: n.v })) } : null;
  }

  /** one layer of a section: its part, tweaked, through Odd.render */
  function layerEvents(C, cfg, L, length) {
    const lay = cfg.lay[L.key] || {};
    const tw = cfg.tw[L.key] || {};
    const isLead = L.key === C.lead;
    const part = isLead ? leadPart(C, cfg) : L.voice.part;
    if (!part) {
      return Odd.idea ? Odd.idea.voiceAt(L.voice, 'shape', { tonic: C.tonic, scale: C.scale, length }) : [];
    }
    const plen = T.partTicks(part);
    let notes = part.notes || [];
    if (tw.ds && !L.drum) notes = notes.map((n) => (n.deg == null ? n : Object.assign({}, n, { deg: n.deg + tw.ds })));
    if (tw.x) notes = xNotes(notes, tw.x, plen, C.MT.pulses[0].len * STEP);
    if (cfg.half) notes = xNotes(notes, 'half', plen);
    return R.partEvents(Object.assign({}, part, { notes }), {
      tonic: C.tonic, scale: C.scale, prog: C.prog, length,
      oct: (isLead && cfg.src === 'guest' && C.guestLead ? C.guestLead.oct || 0 : L.voice.oct || 0) + (tw.oct || 0),
      form: lay.form && lay.form !== 'full' ? lay.form : undefined,
      refit: !part.imported,
    });
  }

  /** which layers play in each bar */
  function maskFor(C, cfg) {
    const n = cfg.bars, all = C.layers.map((l) => l.key), out = [];
    const roles = (list) => C.layers.filter((l) => list.includes(l.role)).map((l) => l.key);
    const grow = (order, b) => order.slice(0, 1 + Math.floor(b * order.length / n));
    const drumsFirst = C.layers.slice().sort((a, b) => DRUMS_FIRST.indexOf(a.role) - DRUMS_FIRST.indexOf(b.role)).map((l) => l.key);
    for (let b = 0; b < n; b++) {
      let set;
      switch (cfg.arr) {
        case 'bones': set = C.lead ? [C.lead] : all.slice(0, 1); break;
        case 'climb': set = grow(all, b); break;
        case 'drums': set = grow(drumsFirst, b); break;
        case 'strip': set = all.slice(0, Math.max(1, all.length - Math.floor(b * all.length / n))); break;
        case 'tease': case 'breakdown': set = roles(['lead', 'arp', 'chords', 'pad']); break;
        case 'riser': set = roles(['lead', 'arp', 'chords', 'bass', 'pad']); break;
        case 'swell': set = roles(['chords', 'pad']); if (!set.length) set = roles(['lead']); break;
        case 'pickup': set = roles(['drums', 'perc']); break;
        case 'rhythm': set = roles(['drums', 'perc', 'bass']); break;
        default: set = all;
      }
      out.push(new Set(set));
    }
    return out;
  }

  /** the last beat of a bar in ticks (a quarter in 4/4, three eighths at the end of 7/8) */
  function lastBeat(C) { return C.MT.pulses[C.MT.pulses.length - 1].len * STEP; }
  /** the beats of a bar: [{ t, len, strong }] in ticks */
  function barBeats(C) { return C.MT.pulses.map((p) => ({ t: p.s * STEP, len: p.len * STEP, strong: C.MT.groupStarts.indexOf(p.s) >= 0 })); }
  function onBeatTick(C, t) { const x = T.mod(t, C.BAR); return C.MT.pulses.some((p) => p.s * STEP === x); }

  function triad(C, deg, base) { return [0, 2, 4].map((i) => T.pitchOf(deg + i, 0, C.tonic, C.scale, base)); }

  /** the section itself: { events } in ticks from 0; opts: { fade } */
  function renderBody(C, cfg, opts) {
    const o = opts || {};
    const BAR = C.BAR, n = Math.max(1, cfg.bars), length = n * BAR;
    const mask = maskFor(C, cfg);
    const roleOf = {};
    let out = [];
    for (const L of C.layers) {
      roleOf[L.key] = L.role;
      const lay = cfg.lay[L.key];
      if (!lay || !lay.on) continue;
      let evs = layerEvents(C, cfg, L, length).filter((e) => mask[Math.min(n - 1, Math.floor(e.t / BAR))].has(L.key));
      if (!evs.length) continue;
      if (Odd.shape) evs = Odd.shape.shapeLane(evs, { role: L.role, energy: cfg.energy, start: 0, end: length, curve: cfg.curve || 'flat', nextEnergy: null });
      for (const e of evs) {
        e.L = L.key;
        e.track = 'sm-' + L.key;
        if (!L.drum && cfg.shift) e.p = clamp(e.p + cfg.shift, 0, 127);
        if (o.fade) e.v = Math.max(1, Math.round(e.v * (1 - 0.75 * Math.floor(e.t / BAR) / n)));
        if (o.ramp) e.v = Math.max(1, Math.round(e.v * (0.3 + 0.7 * e.t / length)));
        out.push(e);
      }
    }
    out = applyTwists(C, cfg, out, roleOf);
    return out.sort(R.byTime);
  }

  const fx = (t, p, v, d) => ({ t: Math.round(t), d: d || 60, p, v: clamp(Math.round(v), 1, 127), track: 'sm-fx', L: 'fx' });
  const held = (t, d, p, v, track) => ({ t, d, p, v: clamp(Math.round(v), 1, 127), track: 'sm-' + track, L: track });

  function snareRoll(t0, t1, push, bar) {
    const BAR = bar || T.BAR;
    const snap = (x, g) => Math.round(x / g) * g;
    const w = t1 - t0;
    const qEnd = w >= 2 * BAR - BEAT ? t0 + snap(w / 2, BEAT) : t0;
    const eEnd = qEnd + snap((t1 - qEnd) / 2, BEAT / 2);
    const hits = [];
    for (let t = t0; t < qEnd; t += BEAT) hits.push(t);
    for (let t = qEnd; t < eEnd; t += BEAT / 2) hits.push(t);
    for (let t = eEnd; t < t1; t += STEP) hits.push(t);
    hits.forEach((t, i) => push(fx(t, SNARE, 46 + (72 * i) / Math.max(1, hits.length - 1))));
  }

  function applyTwists(C, cfg, events, roleOf) {
    const tw = cfg.twists || {};
    const bars = Object.keys(tw).map(Number).filter((b) => b >= 0 && b < cfg.bars);
    if (!bars.length) return events;
    let out = events;
    const group = (e) => (e.L === 'fx' ? 'rhy' : GROUP[roleOf[e.L]] || 'mel');
    const BAR = C.BAR, last = lastBeat(C), beats = barBeats(C);
    for (const b of bars) {
      const w = tw[b], a = b * BAR, z = a + BAR;
      const inBar = (e) => e.t >= a && e.t < z;
      if (w === 'drop') out = out.filter((e) => !inBar(e) || group(e) === 'mel' || group(e) === 'harm');
      else if (w === 'fill') {
        // a 16th-note snare run through the last beat
        const f = z - last;
        out = out.filter((e) => !(e.t >= f && e.t < z && group(e) === 'rhy'));
        out.push(fx(f, KICK, 100));
        for (let i = 0; i * STEP < last; i++) out.push(fx(f + i * STEP, SNARE, 70 + 14 * i));
      } else if (w === 'stop') {
        out = out.filter((e) => !inBar(e) || e.t === a).map((e) => (inBar(e) ? Object.assign({}, e, { d: Math.min(e.d, 2 * STEP) }) : e));
        out.push(fx(a, KICK, 112), fx(a, CRASH, 100, BAR));
      } else if (w === 'breath') {
        const f = z - last;
        out = out.filter((e) => !(e.t >= f && e.t < z)).map((e) => (inBar(e) && e.t + e.d > f ? Object.assign({}, e, { d: Math.max(30, f - e.t) }) : e));
      } else if (w === 'octave') out = out.map((e) => (inBar(e) && e.L === C.lead ? Object.assign({}, e, { p: Math.min(127, e.p + 12) }) : e));
      else if (w === 'stutter') {
        // the melody's first beat, played on every beat of the bar
        const len1 = beats[0].len;
        const first = out.filter((e) => e.L === C.lead && e.t >= a && e.t < a + len1);
        out = out.filter((e) => !(inBar(e) && e.L === C.lead));
        for (const bt of beats) first.forEach((e) => out.push(Object.assign({}, e, { t: e.t + bt.t, d: Math.min(e.d, a + len1 - e.t) })));
      }
    }
    return out;
  }

  function intoBars(cfg, n, over) {
    return Object.assign(clone(cfg), { bars: n, twists: {}, curve: 'flat' }, over || {});
  }

  /** a way in, n bars, from tick 0 */
  function introEvents(C, cfg, intro) {
    const BAR = C.BAR, n = intro.bars, k = intro.k, len = n * BAR;
    if (!n || k === 'none') return [];
    const base = intoBars(cfg, n);
    if (k === 'climb' || k === 'drums') return renderBody(C, Object.assign(base, { arr: k }));
    if (k === 'tease') { if (C.lead && base.lay[C.lead]) base.lay[C.lead].form = 'tease'; return renderBody(C, Object.assign(base, { arr: 'tease' })); }
    if (k === 'riser' || k === 'gap') {
      if (C.lead && base.lay[C.lead]) base.lay[C.lead].form = 'outline';
      let ev = renderBody(C, Object.assign(base, { arr: 'riser' }));
      snareRoll(0, len, (e) => ev.push(e), BAR);
      if (k === 'gap') {
        const g = len - lastBeat(C);
        ev = ev.filter((e) => e.t < g).map((e) => (e.t + e.d > g ? Object.assign({}, e, { d: Math.max(30, g - e.t) }) : e));
      }
      return ev.sort(R.byTime);
    }
    if (k === 'swell') return renderBody(C, Object.assign(base, { arr: 'swell', curve: 'rise' }), { ramp: true });
    if (k === 'pickup') {
      const tw = {};
      tw[n - 1] = 'fill';
      const ev = renderBody(C, Object.assign(base, { arr: 'pickup', twists: tw }));
      if (!C.layers.some((l) => l.role === 'drums' || l.role === 'perc')) {
        // a count-in: kick on the strong beats, snare on the others, the last beat left for the fill
        for (let b = 0; b < n; b++) barBeats(C).forEach((bt) => { const t = b * BAR + bt.t; if (t < len - lastBeat(C)) ev.push(fx(t, bt.strong ? KICK : SNARE, 96)); });
      }
      return ev.sort(R.byTime);
    }
    if (k === 'slow') return renderBody(C, Object.assign(base, { half: true }));
    return renderBody(C, base);
  }

  /** a way out, n bars, from tick 0 */
  function outroEvents(C, cfg, outro, nextCfg) {
    const BAR = C.BAR, n = outro.bars, k = outro.k, len = n * BAR;
    if (!n || k === 'none') return [];
    const base = intoBars(cfg, n);
    const s = cfg.shift || 0;
    const home = triad(C, 0, 48).map((p) => p + s);
    const root = T.pitchOf(0, 0, C.tonic, C.scale, 36) + s;
    let ev = [];
    if (k === 'strip') return renderBody(C, Object.assign(base, { arr: 'strip' }));
    if (k === 'slowout') return renderBody(C, Object.assign(base, { arr: 'strip', half: true }));
    if (k === 'fill') { const tw = {}; tw[n - 1] = 'fill'; return renderBody(C, Object.assign(base, { twists: tw })); }
    if (k === 'breath') home.forEach((p) => ev.push(held(0, len, p, 64, 'hold')));
    else if (k === 'pulse') {
      const five = triad(C, 4, 48).map((p) => p + s), r5 = T.pitchOf(4, 0, C.tonic, C.scale, 36) + s;
      five.forEach((p) => ev.push(held(0, len, p, 48, 'hold')));
      for (let t = 0; t < len; t += STEP) {
        const x = t / len;
        if (t % (2 * STEP) === 0) ev.push(held(t, 2 * STEP - 20, r5, 55 + 50 * x, 'low'));
        if (onBeatTick(C, t)) ev.push(fx(t, KICK, 70 + 45 * x));
        ev.push(fx(t, HAT, 25 + 85 * x));
      }
    } else if (k === 'echo') {
      const body = renderBody(C, Object.assign(clone(cfg), { twists: {} }));
      const a = (cfg.bars - 1) * BAR;
      const last = body.filter((e) => e.L === C.lead && e.t >= a);
      for (let b = 0; b < n; b++) last.forEach((e) => ev.push(Object.assign({}, e, { t: e.t - a + b * BAR, v: Math.max(1, Math.round(e.v * (0.7 - 0.55 * b / n))) })));
      home.forEach((p) => ev.push(held(0, len, p, 40, 'hold')));
    } else if (k === 'stop') {
      ev.push(fx(0, KICK, 115), fx(0, CRASH, 100, BAR));
      home.forEach((p) => ev.push(held(0, 2 * STEP, p, 100, 'hold')));
      ev.push(held(0, 2 * STEP, root, 105, 'low'));
    } else if (k === 'ringout') {
      home.forEach((p) => ev.push(held(0, len, p, 84, 'hold')));
      ev.push(held(0, len, root, 88, 'low'), fx(0, CRASH, 80, 2 * BAR));
      if (C.lead) ev.push({ t: 0, d: Math.min(len, 2 * BAR), p: T.pitchOf(0, 0, C.tonic, C.scale, C.leadBase) + s, v: 84, track: 'sm-' + C.lead, L: C.lead });
    } else if (k === 'handoff') {
      ev = renderBody(C, Object.assign(base, { arr: 'bones' }), { fade: true });
      if (nextCfg) ev = ev.concat(renderBody(C, intoBars(nextCfg, n, { arr: 'rhythm', half: false, energy: 0.45 })));
    } else return renderBody(C, base);
    return ev.sort(R.byTime);
  }

  // ---------------------------------------------------------------- whole sections

  const CACHE = new Map();
  function cached(key, fn) {
    if (CACHE.has(key)) return CACHE.get(key);
    const v = fn();
    if (CACHE.size > 600) CACHE.clear();
    CACHE.set(key, v);
    return v;
  }

  /**
   * A whole section: way in, the section, way out.
   * over: { body, intro, outro } to hear a change before using it.
   * -> { events, length, inLen, bodyLen, outLen, bpm, swing }
   */
  function renderSection(C, sec, next, over) {
    const o = Object.assign({ body: sec.body, intro: sec.intro || null, outro: sec.outro || null }, over || {});
    if (!o.body) return { events: [], length: 0, inLen: 0, bodyLen: 0, outLen: 0, bpm: C.bpm, swing: 0 };
    const nx = o.outro && o.outro.k === 'handoff' && next ? next.body : null;
    const key = C.id + '|' + JSON.stringify([o.body, o.intro, o.outro, nx]);
    return cached(key, () => {
      const BAR = C.BAR;
      const inLen = o.intro ? o.intro.bars * BAR : 0;
      const bodyLen = o.body.bars * BAR;
      const outLen = o.outro ? o.outro.bars * BAR : 0;
      const events = [];
      if (o.intro) for (const e of introEvents(C, o.body, o.intro)) events.push(e);
      for (const e of renderBody(C, o.body)) events.push(Object.assign(e, { t: e.t + inLen }));
      if (o.outro) for (const e of outroEvents(C, o.body, o.outro, nx)) events.push(Object.assign(e, { t: e.t + inLen + bodyLen }));
      events.sort(R.byTime);
      return { events, length: inLen + bodyLen + outLen, inLen, bodyLen, outLen, bpm: o.body.bpm || C.bpm, swing: C.MT.compound ? 0 : o.body.swing || 0 };
    });
  }

  /**
   * A transport sequence from windows of rendered sections, each stretched to
   * the song's tempo. pieces: [{ r (renderSection), from, to, id }]
   * -> { bpm, length, loop, events, tracks, markers: [{ id, start, end }] }
   */
  function sequence(C, pieces, loop) {
    const events = [], markers = [];
    let at = 0;
    for (const pc of pieces) {
      const r = pc.r;
      const from = pc.from || 0, to = pc.to == null ? r.length : pc.to;
      if (to <= from) continue;
      const k = C.bpm / (r.bpm || C.bpm);
      const swung = r.swing ? R.applySwing(r.events, r.swing) : r.events;
      for (const e of swung) {
        if (e.t < from || e.t >= to) continue;
        const t = e.t - from;
        const d = Math.min(e.d, to - e.t);
        events.push({ t: at + Math.round(t * k), d: Math.max(15, Math.round(d * k)), p: e.p, v: e.v, track: e.track, L: e.L });
      }
      const len = Math.round((to - from) * k);
      markers.push({ id: pc.id, start: at, end: at + len });
      at += len;
    }
    let out = events;
    if (Odd.shape && Odd.shape.humanize && out.length) {
      out = Odd.shape.humanize(out, { amount: 0.35, roleOf: (tr) => (C.tracks[tr] ? C.tracks[tr].role : 'lead'), length: at });
    }
    out.sort(R.byTime);
    return { bpm: C.bpm, length: Math.max(at, 1), loop: !!loop, events: out, tracks: C.tracks, markers };
  }

  function filled(song) { return song.secs.filter((s) => s.body); }
  function nextOf(song, sec) { const i = song.secs.indexOf(sec); return song.secs.slice(i + 1).find((s) => s.body) || null; }
  function prevOf(song, sec) { const i = song.secs.indexOf(sec); return song.secs.slice(0, i).reverse().find((s) => s.body) || null; }
  function findSec(song, id) { return song.secs.find((s) => s.id === id) || null; }

  function sectionSeq(C, song, sec) {
    return sequence(C, [{ r: renderSection(C, sec, nextOf(song, sec)), id: sec.id }], true);
  }
  function songSeq(C, song, loop) {
    const pieces = filled(song).map((s) => ({ r: renderSection(C, s, nextOf(song, s)), id: s.id }));
    return pieces.length ? sequence(C, pieces, !!loop) : null;
  }
  /**
   * Where each filled section sits in the song, in ticks at the song's tempo
   * (the same sums songSeq makes). -> { length, secs: [{ id, name, open, start, inEnd, outStart, end }] }
   */
  function timeline(C, song) {
    let at = 0;
    const secs = [];
    for (const s of filled(song)) {
      const r = renderSection(C, s, nextOf(song, s));
      const k = C.bpm / (r.bpm || C.bpm);
      const len = Math.round(r.length * k);
      if (len <= 0) continue;
      secs.push({ id: s.id, name: s.name, open: s.open, start: at, inEnd: at + Math.round(r.inLen * k), outStart: at + Math.round((r.inLen + r.bodyLen) * k), end: at + len });
      at += len;
    }
    return { length: Math.max(at, 1), secs };
  }
  /** the main idea on its own, for the idea book */
  function ideaSeq(C) {
    const cfg = baseCfg(C, { bars: Math.min(16, Math.max(4, C.ideaBars * 2)), energy: 0.6 });
    return sequence(C, [{ r: renderSection(C, { body: cfg }, null), id: 'idea' }], true);
  }

  // ---------------------------------------------------------------- the song

  function emptySec(id, name) { return { id, name: name || 'Open', kind: null, open: true, body: null, intro: null, outro: null, hist: [] }; }

  /** a new song: the idea as the verse, chorus or hook, with an open slot on each side */
  /** can these two ideas share a song? (one meter per song for now) */
  function sameMeter(a, b) { return !a || !b || !Odd.idea || Odd.idea.meterOf(a) === Odd.idea.meterOf(b); }

  function create(main, guest, role, env) {
    if (!sameMeter(main, guest)) guest = null;
    const song = { id: uid('song'), name: main.name + (guest ? ' with ' + guest.name : ''), main: clone(main), guest: guest ? clone(guest) : null, role: ROLES[role] ? role : 'chorus', kw: defaultKw(), secs: [], nid: 4, created: Date.now(), updated: Date.now() };
    const C = context(song, env);
    song.secs = [emptySec('s1'), { id: 's2', name: ROLES[song.role].label, kind: 'main', open: true, body: ROLES[song.role].make(C), intro: null, outro: null, hist: [] }, emptySec('s3')];
    return song;
  }

  const snap = (s) => ({ name: s.name, named: !!s.named, kind: s.kind, body: s.body, intro: s.intro || null, outro: s.outro || null });

  /**
   * change a section, keeping what it was one Undo away. tag: a run of changes
   * with the same tag in a row (a dial pressed again and again) is one Undo step.
   */
  function patchSec(song, id, ch, tag) {
    return Object.assign({}, song, {
      updated: Date.now(),
      secs: song.secs.map((s) => {
        if (s.id !== id) return s;
        const same = tag && s.tag === tag && s.hist.length;
        return Object.assign({}, s, ch, { tag: tag || '', hist: same ? s.hist : s.hist.concat([snap(s)]).slice(-20) });
      }),
    });
  }
  function undoSec(song, id) {
    const s = findSec(song, id);
    if (!s || !s.hist.length) return song;
    const prev = s.hist[s.hist.length - 1];
    return Object.assign({}, song, { updated: Date.now(), secs: song.secs.map((x) => (x.id === id ? Object.assign({}, x, prev, { tag: '', hist: x.hist.slice(0, -1) }) : x)) });
  }
  /** a name the user gave: kept when the section's substance changes */
  function renameSec(song, id, name) {
    const s = findSec(song, id), n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!s || !n || n === s.name) return song;
    return patchSec(song, id, { name: n, named: true });
  }
  function renameSong(song, name) {
    const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 60);
    return n && n !== song.name ? Object.assign({}, song, { name: n, updated: Date.now() }) : song;
  }
  /** swap a section with its neighbour: d -1 earlier, 1 later */
  function moveSec(song, id, d) {
    const i = song.secs.findIndex((s) => s.id === id), j = i + (d < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= song.secs.length) return song;
    const secs = song.secs.slice();
    secs[i] = song.secs[j];
    secs[j] = song.secs[i];
    return Object.assign({}, song, { secs, updated: Date.now() });
  }
  /** put a removed section back where it was (removeSec gives { sec, at }) */
  function insertSec(song, sec, at) {
    if (!sec) return song;
    let s = sec, nid = song.nid;
    if (findSec(song, sec.id)) { s = Object.assign({}, sec, { id: 's' + nid }); nid++; }
    const secs = song.secs.slice();
    secs.splice(clamp(at, 0, secs.length), 0, s);
    return Object.assign({}, song, { secs, nid, updated: Date.now() });
  }
  function addSec(song, at) {
    const id = 's' + song.nid;
    const secs = song.secs.slice();
    secs.splice(clamp(at, 0, secs.length), 0, emptySec(id));
    return { song: Object.assign({}, song, { secs, nid: song.nid + 1, updated: Date.now() }), id };
  }
  function dupSec(song, id) {
    const s = findSec(song, id);
    if (!s || !s.body) return { song, id };
    const nid = 's' + song.nid;
    const secs = song.secs.slice();
    secs.splice(song.secs.indexOf(s) + 1, 0, Object.assign(clone(s), { id: nid, open: true, hist: [] }));
    return { song: Object.assign({}, song, { secs, nid: song.nid + 1, updated: Date.now() }), id: nid };
  }
  /** -> { song, id: the section to select now, removed: { sec, at } | null for insertSec } */
  function removeSec(song, id) {
    if (song.secs.length <= 1) return { song, id, removed: null };
    const i = song.secs.findIndex((s) => s.id === id);
    if (i < 0) return { song, id, removed: null };
    const secs = song.secs.filter((s) => s.id !== id);
    return { song: Object.assign({}, song, { secs, updated: Date.now() }), id: secs[Math.max(0, i - 1)].id, removed: { sec: song.secs[i], at: i } };
  }
  function setOpen(song, id, open) {
    return Object.assign({}, song, { updated: Date.now(), secs: song.secs.map((s) => (s.id === id ? Object.assign({}, s, { open }) : s)) });
  }
  function allClosed(song) { return song.secs.length > 0 && song.secs.every((s) => !s.open); }

  /** a part's length: the body in 2-bar steps (2..16), a way in or out in bars (1..8) */
  function stepPart(song, id, field, d) {
    const s = findSec(song, id);
    if (!s || !s.body || !s.open) return song;
    if (field === 'body') {
      const body = clone(s.body);
      body.bars = clamp(body.bars + d * 2, 2, 16);
      const tw = {};
      Object.keys(body.twists).forEach((k) => { if (+k < body.bars) tw[k] = body.twists[k]; });
      body.twists = tw;
      return patchSec(song, id, { body });
    }
    if (!s[field]) return song;
    const ch = {};
    ch[field] = Object.assign({}, s[field], { bars: clamp(s[field].bars + d, 1, 8) });
    return patchSec(song, id, ch);
  }

  /* Dials: a section's settings set by hand, a step at a time (or typed, for
   * tempo). Pressing the same dial again and again is one Undo step. */
  const CURVE_LABEL = { flat: 'Even', rise: 'Rises', fall: 'Falls', swell: 'Swells', dip: 'Dips' };
  const CURVE_LIST = ['flat', 'rise', 'swell', 'fall', 'dip'];
  const SWINGS = [0, 0.15, 0.3, 0.45, 0.6];
  const SWING_LABEL = ['Straight', 'A touch', 'Medium', 'Heavy', 'Hard'];
  const nearest = (list, x) => list.reduce((bi, v, i) => (Math.abs(v - x) < Math.abs(list[bi] - x) ? i : bi), 0);
  const DIALS = [
    { id: 'bpm', label: 'Tempo', get: (b) => b.bpm, put: (b, v) => clamp(Math.round(v), 40, 240), step: (b, d) => b.bpm + d,
      text: (C, b) => b.bpm + ' BPM', min: (b) => b.bpm <= 40, max: (b) => b.bpm >= 240 },
    { id: 'shift', label: 'Key', get: (b) => b.shift || 0, put: (b, v) => clamp(Math.round(v), -12, 12), step: (b, d) => (b.shift || 0) + d,
      text: (C, b) => keyName(C, b).split(' ')[0] + (b.shift ? ' (' + (b.shift > 0 ? '+' : '−') + Math.abs(b.shift) + ')' : ''), min: (b) => b.shift <= -12, max: (b) => b.shift >= 12 },
    { id: 'energy', label: 'Energy', get: (b) => b.energy, put: (b, v) => clamp(Math.round(v * 10) / 10, 0.1, 1), step: (b, d) => b.energy + d / 10,
      text: (C, b) => Math.round(b.energy * 10) + ' of 10', min: (b) => b.energy <= 0.1, max: (b) => b.energy >= 1 },
    { id: 'curve', label: 'Shape', get: (b) => b.curve || 'flat', put: (b, v) => (CURVE_LIST.includes(v) ? v : 'flat'),
      step: (b, d) => CURVE_LIST[(CURVE_LIST.indexOf(b.curve || 'flat') + d + CURVE_LIST.length) % CURVE_LIST.length],
      text: (C, b) => CURVE_LABEL[b.curve || 'flat'], min: () => false, max: () => false },
    { id: 'swing', label: 'Swing', get: (b) => b.swing || 0, put: (b, v) => SWINGS[nearest(SWINGS, Number(v) || 0)],
      step: (b, d) => SWINGS[clamp(nearest(SWINGS, b.swing || 0) + d, 0, SWINGS.length - 1)],
      text: (C, b) => SWING_LABEL[nearest(SWINGS, b.swing || 0)], min: (b) => (b.swing || 0) <= 0, max: (b) => (b.swing || 0) >= SWINGS[SWINGS.length - 1] },
  ];
  const DIAL_BY = {};
  DIALS.forEach((x) => { DIAL_BY[x.id] = x; });

  /** set one dial of an open section to a value */
  function setDial(song, id, dial, v) {
    const s = findSec(song, id), D = DIAL_BY[dial];
    if (!s || !s.body || !s.open || !D) return song;
    const nv = D.put(s.body, v);
    if (nv === D.get(s.body)) return song;
    const body = clone(s.body);
    body[dial] = nv;
    return patchSec(song, id, { body }, 'dial:' + dial);
  }
  /** one step of a dial: d -1 or 1 */
  function stepDial(song, id, dial, d) {
    const s = findSec(song, id), D = DIAL_BY[dial];
    if (!s || !s.body || !D) return song;
    return setDial(song, id, dial, D.step(s.body, d < 0 ? -1 : 1));
  }

  // ---------------------------------------------------------------- what to offer

  /** a section's energy, 0..1: how many layers play, and its energy setting */
  function energyOf(C, body) {
    if (!body) return null;
    const mask = maskFor(C, body);
    let on = 0;
    mask.forEach((set) => { set.forEach((k) => { if (body.lay[k] && body.lay[k].on) on++; }); });
    const per = on / Math.max(1, mask.length);
    return clamp((per / Math.max(4, C.layers.length)) * 0.65 + body.energy * 0.35 + (body.half ? -0.08 : 0), 0, 1);
  }

  function rank(kw, pool, batch, bonus) {
    const sc = pool.map((o, i) => ({ o, i, s: score(kw, o.t || {}) + (bonus ? bonus(o) : 0) })).sort((a, b) => b.s - a.s || a.i - b.i);
    const n = sc.length;
    if (!n) return [];
    const b = (batch || 0) * 3, out = [];
    for (let k = 0; k < Math.min(3, n); k++) out.push(Object.assign({ _s: sc[(b + k) % n].s }, sc[(b + k) % n].o));
    return out;
  }

  function rankAll(kw, pool) {
    return pool.map((o, i) => ({ o, i, s: score(kw, o.t || {}) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => Object.assign({ _s: x.s }, x.o));
  }

  /** what fits where this section sits: the way in depends on what came before, the way out on what comes next */
  function partBonus(C, song, sec, act, id) {
    const prev = prevOf(song, sec), next = nextOf(song, sec), me = energyOf(C, sec.body) || 0.6;
    if (act === 'build') {
      if (!prev) return { climb: 0.9, swell: 0.5, drums: 0.4 }[id] || 0;
      const pe = energyOf(C, prev.body);
      if (me > pe + 0.08) return { riser: 0.8, gap: 0.6, pickup: 0.5 }[id] || 0;
      if (me < pe - 0.08) return { swell: 0.6, none: 0.4, tease: 0.4 }[id] || 0;
      return { none: 0.6, pickup: 0.4 }[id] || 0;
    }
    if (!next) return { ringout: 1, strip: 0.5, slowout: 0.4 }[id] || 0;
    const ne = energyOf(C, next.body);
    if (ne > me + 0.08) return { pulse: 0.9, fill: 0.6, handoff: 0.4 }[id] || 0;
    if (ne < me - 0.08) return { breath: 0.9, strip: 0.5, echo: 0.4 }[id] || 0;
    return { none: 0.6, handoff: 0.5 }[id] || 0;
  }

  function ok(c, x) {
    if (x.needs === 'guest') return !!(c.C.guest && c.C.guestLead);
    if (x.needs === 'lead') return !!c.C.lead;
    if (x.needs === 'twobars') return !!c.C.lead && c.C.ideaBars >= 2;
    return true;
  }
  function cx(C, song) { return { C, song, mainCfg: ROLES[song.role].make(C) }; }

  /**
   * Three options for one part of a section.
   * -> [{ key, group: 'act', act, label, sub, t, bars, _s, make(sec) -> changes }]
   */
  function actOptions(C, song, sec, act, batch) {
    const c = cx(C, song);
    // batch 'all': every option, best first (Bobby's pick leads)
    const pick = (pool, bonus) => (batch === 'all'
      ? pool.map((o, i) => ({ o, i, s: score(song.kw, o.t || {}) + (bonus ? bonus(o) : 0) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => Object.assign({ _s: x.s }, x.o))
      : rank(song.kw, pool, batch, bonus));
    if (act === 'sub') {
      return pick(TREAT.filter((t) => ok(c, t))).map((t) => ({
        key: 'a:' + t.id, _s: t._s, group: 'act', act, label: txt(t.label, c), sub: txt(t.sub, c), t: t.t,
        make: (s) => ({ name: s && s.named ? s.name : t.nm, kind: t.id, body: t.cfg(c) }),
      }));
    }
    if (!sec.body) return [];
    const field = act === 'build' ? 'intro' : 'outro', list = act === 'build' ? INTROS : OUTROS;
    return pick(list, (x) => partBonus(C, song, sec, act, x.id)).map((x) => ({
      key: act + ':' + x.id, _s: x._s, group: 'act', act, label: x.label, sub: x.sub, t: x.t || {}, bars: x.bars,
      make: () => { const m = {}; m[field] = x.bars ? { k: x.id, bars: x.bars } : null; return m; },
    }));
  }

  /**
   * Is this option what the section has now? A way in or out by its kind (its
   * length may differ); a substance only when the section is exactly that.
   */
  function isCurrent(C, song, sec, o) {
    if (!sec || !sec.body || o.group !== 'act') return false;
    if (o.act === 'build' || o.act === 'fin') {
      const p = sec[o.act === 'build' ? 'intro' : 'outro'];
      return o.key === o.act + ':' + (p ? p.k : 'none');
    }
    return canon(o.make(sec).body) === canon(sec.body);
  }
  /** JSON with sorted keys, so a loaded section compares equal to a fresh one */
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }

  /** all three columns, and Bobby's pick in each */
  function allActOptions(C, song, sec, batches) {
    const opts = {}, picks = {};
    ACTS.forEach((a) => {
      opts[a.id] = actOptions(C, song, sec, a.id, (batches || {})[a.id]);
      let best = null;
      opts[a.id].forEach((o) => { if (!best || o._s > best._s + 1e-9) best = o; });
      picks[a.id] = best ? best.key : '';
    });
    return { opts, picks };
  }

  /** Vibe, Idea, or Tweak notes on one layer -> options like actOptions (group = the tool) */
  function toolOptions(C, song, sec, tool, layerKey, batch) {
    const c = cx(C, song), body = sec.body;
    if (!body) return [];
    let pool = [];
    if (tool === 'vibe') {
      // no swing for meters that already move in threes
      pool = VIBES.filter((v) => (!v.ok || v.ok(body)) && !(v.id === 'swing' && C.MT.compound)).map((v) => ({ id: v.id, label: txt(v.label, body), sub: txt(v.sub, body), t: v.t, f: (x) => Object.assign(clone(x), v.f(x, C)) }));
    } else if (tool === 'idea') {
      pool = IDEA_OPTS.filter((o) => ok(c, o) && o.src !== body.src && !!C.lead).map((o) => ({ id: o.id, label: txt(o.label, c), sub: txt(o.sub, c), t: o.t, f: (x) => Object.assign(clone(x), { src: o.src, edit: null }) }));
    } else if (tool === 'tweak') {
      const L = C.layers.find((l) => l.key === layerKey) || C.layers[0];
      if (!L) return [];
      const cur = (body.lay[L.key] || {}).form || 'full';
      pool = FORM_OPTS.filter((o) => o.form !== cur).map((o) => ({ id: 'form-' + o.form + ':' + L.key, label: FORM_LABEL[o.form], sub: R.FORM_HINTS[o.form], t: o.t, f: (x) => {
        const y = clone(x);
        y.lay[L.key] = Object.assign({}, y.lay[L.key], { form: o.form });
        return y;
      } })).concat(TWEAKS.filter((o) => o.ok(L, body)).map((o) => ({ id: o.id + ':' + L.key, label: o.label, sub: o.sub, t: o.t, f: (x) => {
        const y = clone(x), w = o.tw(y.tw[L.key] || {});
        Object.keys(w).forEach((k) => { if (!w[k]) delete w[k]; });
        if (Object.keys(w).length) y.tw[L.key] = w; else delete y.tw[L.key];
        if (o.id === 'reset') y.lay[L.key] = Object.assign({}, y.lay[L.key], { form: 'full' });
        return y;
      } })));
      // every choice for one layer at once, Bobby's favourite first: you see what each one is before you hear it
      return rankAll(song.kw, pool).map((o) => ({ key: tool + ':' + o.id, group: tool, label: o.label, sub: o.sub, t: o.t, _s: o._s, make: (s) => ({ body: o.f(s.body) }) }));
    }
    return rank(song.kw, pool, batch).map((o) => ({ key: tool + ':' + o.id, group: tool, label: o.label, sub: o.sub, t: o.t, make: (s) => ({ body: o.f(s.body) }) }));
  }

  /** the bars picked in Bar Builder, or the last bar */
  function barSel(sec, bars) {
    const n = sec.body.bars, b = (bars || []).filter((x) => x < n);
    return b.length ? b : [n - 1];
  }
  function twistOptions(C, song, sec, bars, batch) {
    if (!sec.body) return [];
    const n = sec.body.bars, sel = barSel(sec, bars);
    const last = sel.includes(n - 1), first = sel.includes(0);
    return rank(song.kw, TWISTS, batch, (w) => (last ? w.last || 0 : 0) + (first ? w.first || 0 : 0)).map((w) => ({
      key: 'tw:' + w.id + ':' + sel.join('-'), group: 'twist', label: w.label, sub: w.sub, t: w.t,
      make: (s) => { const body = clone(s.body); sel.forEach((b) => { body.twists[b] = w.id; }); return { body }; },
    }));
  }

  /** take the twists off these bars (barSel's choice) */
  function clearTwists(song, id, bars) {
    const s = findSec(song, id);
    if (!s || !s.body || !s.open) return song;
    const body = clone(s.body);
    let n = 0;
    barSel(s, bars).forEach((b) => { if (body.twists[b]) { delete body.twists[b]; n++; } });
    return n ? patchSec(song, id, { body }) : song;
  }

  /** where Bobby would start on this section */
  function bobbyPick(C, song, sec, batches) {
    if (!sec) return null;
    const all = allActOptions(C, song, sec, batches);
    const find = (a) => all.opts[a].find((o) => o.key === all.picks[a]);
    if (!sec.body) return find('sub');
    if (!sec.intro) return find('build');
    if (!sec.outro) return find('fin');
    return find('sub');
  }

  /**
   * What an option plays: a way in runs into the section, a way out runs from
   * the section's last bars into the next one, anything else is the section.
   */
  function previewSeq(C, song, sec, o) { return windowSeq(C, song, sec, o, o.make(sec)); }

  /**
   * The same stretch an option's preview plays, as the section is now: flip
   * between the two to compare. null when there is nothing to compare with.
   */
  function nowSeq(C, song, sec, o) {
    if (o.group === 'layer') {
      const target = (sec && sec.body ? sec : null) || filled(song)[0];
      if (!target) return null;
      const body = Object.assign(clone(target.body), { arr: 'full', twists: {} });
      return sequence(C, [{ r: renderSection(C, { body }, null, { intro: null, outro: null }), id: sec ? sec.id : target.id }], true);
    }
    if (!sec || !sec.body) return null;
    const made = o.group === 'act' && o.act === 'build' ? { intro: sec.intro || null }
      : o.group === 'act' && o.act === 'fin' ? { outro: sec.outro || null } : { body: sec.body };
    return windowSeq(C, song, sec, o, made);
  }

  function windowSeq(C, song, sec, o, made) {
    const BAR = C.BAR;
    const nx = nextOf(song, sec);
    if (o.group === 'act' && o.act === 'build') {
      const r = renderSection(C, sec, nx, { intro: made.intro, outro: null });
      return sequence(C, [{ r, from: 0, to: r.inLen + Math.min(r.bodyLen, 2 * BAR), id: sec.id }], true);
    }
    if (o.group === 'act' && o.act === 'fin') {
      const r = renderSection(C, sec, nx, { intro: null, outro: made.outro });
      const pieces = [{ r, from: Math.max(0, r.bodyLen - 2 * BAR), to: r.length, id: sec.id }];
      if (nx) { const rn = renderSection(C, nx, nextOf(song, nx)); pieces.push({ r: rn, from: 0, to: rn.inLen + Math.min(rn.bodyLen, 2 * BAR), id: nx.id }); }
      return sequence(C, pieces, true);
    }
    const body = made.body || sec.body;
    const r = renderSection(C, { body }, null, { intro: null, outro: null });
    return sequence(C, [{ r, id: sec.id }], true);
  }

  // ---------------------------------------------------------------- adding layers

  /* Layers a song can grow. An idea built in the Idea Builder gets that
   * screen's own rounds, made against its melody; any other idea gets the
   * studio's generators, made to fit what the idea already plays. */
  const ADDS = [
    { role: 'chords', dir: 'chords', label: 'Chords', sub: 'Harmony under your melody.' },
    { role: 'bass', dir: 'bass', label: 'Bass', sub: 'Locks onto the melody, or fills its gaps.' },
    { role: 'pad', dir: 'pads', label: 'Pads', sub: 'Held notes that hold it all up.' },
    { role: 'perc', dir: 'perc', label: 'Percussion', sub: 'Claps and taps, nothing heavy.' },
    { role: 'drums', dir: 'beat', label: 'Beat', sub: 'Kick, snare and hats.' },
  ];
  const ADD_BY = {};
  ADDS.forEach((a) => { ADD_BY[a.role] = a; });
  const GEN_FEEL = [
    { label: 'Sparse', density: 0.25, t: { busy: -1, full: -0.4 } },
    { label: 'Steady', density: 0.5, t: { adv: -0.4, change: -0.3 } },
    { label: 'Busy', density: 0.8, t: { busy: 1, drive: 0.6 } },
  ];
  const cap = (x) => String(x || '').charAt(0).toUpperCase() + String(x || '').slice(1);

  function bonesOf(song) {
    const b = song.main && song.main.bones;
    return b && b.melody && b.melody.shape && Odd.audition && Odd.audition.toParts ? b : null;
  }
  /** the layers this song doesn't have yet */
  function addable(C) { return ADDS.filter((a) => !C.layers.some((l) => l.role === a.role)); }
  /** the layers added here that were removed again, newest first: they can come back */
  function removedLayers(C, song) {
    return song.main.voices.map((v, i) => ({ v, key: 'v' + i })).filter((x) => x.v.added && x.v.removed && !C.layers.some((l) => l.role === x.v.role))
      .reverse().map((x) => ({ key: x.key, role: x.v.role, label: (ADD_BY[x.v.role] || { label: ROLE_LABEL[x.v.role] || x.v.role }).label }));
  }

  /** three takes on a new layer. -> [{ key, group: 'layer', role, label, sub, stat, t, spec | part }] */
  function layerOptions(C, song, role, batch) {
    const a = ADD_BY[role];
    if (!a || C.layers.some((l) => l.role === role)) return [];
    const b = batch || 0;
    const B = bonesOf(song);
    if (B) {
      const A = Odd.audition;
      const idea = { melody: B.melody, layers: Object.assign({}, B.layers), order: (B.order || []).filter((d) => d !== a.dir) };
      delete idea.layers[a.dir];
      const opts = A.options(a.dir, { batch: b, steer: {} }, idea);
      return opts.map((o, i) => ({
        key: 'L:' + role + ':' + b + ':' + i, group: 'layer', role, dir: a.dir, spec: o,
        label: cap(A.tagOf(a.dir, o)), sub: a.label + ', ' + A.statOf(a.dir, o) + '. ' + a.sub, stat: a.label + ' · ' + A.statOf(a.dir, o),
        t: role === 'chords' ? { bright: i - 1 } : { busy: i - 1, full: (i - 1) * 0.4 },
      }));
    }
    // the style generators write 4/4 only
    if (!Odd.gen || !Odd.gen.generate || C.meter !== '4/4') return [];
    return cached('L|' + C.id + '|' + role + '|' + b, () => {
      const bars = clamp(C.ideaBars, 1, 16), len = bars * C.BAR;
      const style = (C.main.voices.find((v) => v.part && v.part.style) || { part: {} }).part.style || C.main.style || 'lofi';
      const cfg = baseCfg(C);
      const lanes = C.layers.map((L) => ({ role: L.role, events: layerEvents(C, cfg, L, len) }));
      const band = Odd.band ? Odd.band.hear(lanes, len, len) : null;
      let h = 0;
      const seedOf = (k) => { h = 0; const str = song.id + role + b + k; for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0; return h; };
      return GEN_FEEL.map((f, i) => {
        const part = Odd.gen.generate({ role, style, seed: seedOf(i), bars, tonic: C.tonic, scale: C.scale, prog: C.prog, params: { density: f.density }, band });
        return { key: 'L:' + role + ':' + b + ':' + i, group: 'layer', role, part, label: f.label + ' ' + a.label.toLowerCase(), sub: (part.name || a.label) + '. ' + a.sub, stat: a.label + ' · ' + part.notes.length + ' notes', t: f.t };
      });
    });
  }

  /** the song with a new layer (from layerOptions): on in every open section, off in closed ones */
  function addLayer(song, o) {
    if (!o || !Odd.idea) return song;
    const s = clone(song);
    let part = o.part ? clone(o.part) : null;
    const B = bonesOf(s);
    if (o.spec && B) {
      const A = Odd.audition;
      const layers = Object.assign({}, B.layers);
      layers[o.dir] = o.spec;
      const nb = { melody: B.melody, layers, order: (B.order || []).filter((d) => d !== o.dir).concat([o.dir]) };
      const parts = A.toParts(nb);
      const hit = parts.find((p) => p.part.role === o.role);
      if (!hit) return song;
      part = hit.part;
      // new chords: the melody now sits over them, and the other layers refit to them
      if (o.dir === 'chords') {
        const li = leadOf(s.main);
        if (li >= 0 && s.main.voices[li].part) s.main.voices[li].part.ctx = clone(parts[0].part.ctx);
      }
      s.main.bones = Object.assign({}, B, { layers: nb.layers, order: nb.order });
    }
    if (!part) return song;
    const made = Odd.idea.fromParts([{ part }]);
    if (!made) return song;
    const v = Object.assign(made.voices[0], { added: true });
    if (o.spec) v.spec = { dir: o.dir, o: clone(o.spec) };
    s.main.voices.push(v);
    const key = 'v' + (s.main.voices.length - 1);
    const put = (body, on) => { if (body && body.lay) body.lay[key] = { on, form: 'full' }; };
    s.secs.forEach((sec) => { put(sec.body, sec.open); (sec.hist || []).forEach((h) => put(h.body, sec.open)); });
    s.lv = (s.lv || 0) + 1;
    s.updated = Date.now();
    return s;
  }
  /** take a layer added here back out of the song (it can come back with restoreLayer) */
  function removeLayer(song, key) {
    const i = Number(String(key).slice(1));
    const v = song.main.voices[i];
    if (!v || !v.added || v.removed) return song;
    const s = clone(song);
    s.main.voices[i].removed = true;
    const B = bonesOf(s), a = ADD_BY[v.role];
    if (B && a && B.layers && B.layers[a.dir]) {
      const layers = Object.assign({}, B.layers);
      delete layers[a.dir];
      s.main.bones = Object.assign({}, B, { layers, order: (B.order || []).filter((d) => d !== a.dir) });
    }
    s.lv = (s.lv || 0) + 1;
    s.updated = Date.now();
    return s;
  }
  function restoreLayer(song, key) {
    const i = Number(String(key).slice(1));
    const v = song.main.voices[i];
    if (!v || !v.removed) return song;
    if (song.main.voices.some((x, j) => j !== i && !x.removed && x.role === v.role)) return song;
    const s = clone(song);
    delete s.main.voices[i].removed;
    const B = bonesOf(s);
    if (B && v.spec && v.spec.dir) {
      const layers = Object.assign({}, B.layers);
      layers[v.spec.dir] = v.spec.o;
      s.main.bones = Object.assign({}, B, { layers, order: (B.order || []).filter((d) => d !== v.spec.dir).concat([v.spec.dir]) });
    }
    s.secs.forEach((sec) => { if (sec.body && sec.body.lay && !sec.body.lay[key]) sec.body.lay[key] = { on: sec.open, form: 'full' }; });
    s.lv = (s.lv || 0) + 1;
    s.updated = Date.now();
    return s;
  }

  /** what a layer option plays: this section (or the first filled one), every layer in, with the new one */
  function layerPreview(C, song, sec, o) {
    const s2 = addLayer(song, o);
    if (s2 === song) return null;
    const C2 = context(s2, C.env);
    const target = (sec && sec.body ? findSec(s2, sec.id) : null) || filled(s2)[0];
    if (!target) return null;
    const body = clone(target.body);
    const key = 'v' + (s2.main.voices.length - 1);
    body.lay[key] = { on: true, form: 'full' };
    body.arr = 'full';
    body.twists = {};
    const seq = sequence(C2, [{ r: renderSection(C2, { body }, null, { intro: null, outro: null }), id: sec ? sec.id : target.id }], true);
    seq.rows = rowsOf(C2);
    seq.newKey = key;
    return seq;
  }

  // ---------------------------------------------------------------- pictures

  const ROW_COLOR = { lead: 'var(--r-lead)', arp: 'var(--r-arp)', chords: 'var(--r-chords)', pad: 'var(--r-pad)', bass: 'var(--r-bass)', perc: 'var(--r-perc)', drums: 'var(--r-drums)' };
  /** rows to draw for a song: its layers, then the extra tracks ways in and out use */
  function rowsOf(C) {
    return C.layers.map((l) => ({ key: l.key, label: l.label, role: l.role, color: ROW_COLOR[l.role] || 'var(--muted)', layer: true }))
      .concat([
        { key: 'fx', label: 'Fills', role: 'drums', color: 'var(--r-drums)', layer: false },
        { key: 'hold', label: 'Held chord', role: 'pad', color: 'var(--r-pad)', layer: false },
        { key: 'low', label: 'Low note', role: 'bass', color: 'var(--r-bass)', layer: false },
      ]);
  }
  /** a small picture: which rows play in which bar. -> { cells: [{ x, w, y, c }], h } */
  function mini(C, events, length, rowList) {
    const BAR = C.BAR;
    const n = Math.max(1, Math.round(length / BAR));
    const per = [];
    for (let b = 0; b < n; b++) per.push({});
    const used = {};
    for (const e of events) {
      const b = Math.min(n - 1, Math.floor(e.t / BAR));
      per[b][e.L] = 1;
      used[e.L] = 1;
    }
    const rows = (rowList || rowsOf(C)).filter((r) => used[r.key]);
    const cells = [];
    rows.forEach((r, i) => per.forEach((set, b) => { if (set[r.key]) cells.push({ x: r2(b / n * 100), w: r2(100 / n - 0.6), y: 3 + i * 7, c: r.color }); }));
    return { cells, h: 6 + Math.max(1, rows.length) * 7 };
  }
  const DRUM_Y = (p) => (p === KICK || p === 35 ? 23 : p === SNARE || p === 39 || p === 40 || p === 37 ? 13 : p === CRASH || p === 57 ? 1 : p === 42 || p === 44 || p === 46 || p === 70 ? 4 : 9);
  /** one row's notes as blocks over the length. -> [{ x, w, y, h }] */
  function blocks(events, length, key, drum) {
    const mine = events.filter((e) => e.L === key);
    if (!mine.length) return [];
    let lo = 127, hi = 0;
    if (!drum) mine.forEach((e) => { lo = Math.min(lo, e.p); hi = Math.max(hi, e.p); });
    const span = Math.max(1, hi - lo);
    const out = [];
    for (const e of mine) {
      if (out.length > 420) break;
      const x = r2(e.t / length * 100);
      if (drum) out.push({ x, w: r2(Math.max(0.3, 60 / length * 100)), y: DRUM_Y(e.p), h: 4 });
      else out.push({ x, w: r2(Math.max(0.3, e.d / length * 100 - 0.1)), y: Math.round(25 - (e.p - lo) / span * 22), h: 3 });
    }
    return out;
  }

  // ---------------------------------------------------------------- words

  function secsOf(r) { return r.length / T.PPQ * 60 / (r.bpm || 100); }
  function mmss(t) { const m = Math.floor(t / 60), s = Math.round(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  function keyName(C, body) {
    const sc = T.SCALES[C.scale];
    return T.NOTE_NAMES[T.mod(C.tonic + (body ? body.shift || 0 : 0), 12)] + (sc ? ' ' + sc.label.toLowerCase() : '');
  }
  function partsText(sec) {
    if (!sec.body) return 'Empty';
    const n = (p) => (p ? p.bars : 0);
    return (sec.intro ? n(sec.intro) + '+' : '') + sec.body.bars + (sec.outro ? '+' + n(sec.outro) : '') + ' bars';
  }
  function substanceLabel(C, song, sec) {
    if (sec.kind === 'main') return 'Your ' + song.role;
    const t = TREAT_BY[sec.kind];
    return t ? txt(t.label, cx(C, song)) : sec.name;
  }

  /** the left bubble: what this section is, in plain words */
  function describe(C, song, sec, i) {
    if (!sec) return '';
    if (!sec.body) return 'Section ' + (i + 1) + ' is open and empty. Pick what it is from the middle column up top; then it gets a way in and a way out.';
    const b = sec.body, t = TREAT_BY[sec.kind];
    const on = C.layers.filter((l) => b.lay[l.key] && b.lay[l.key].on).map((l) => l.label.toLowerCase());
    const what = sec.kind === 'main' ? 'Your idea as the ' + song.role + '.' : t ? txt(t.sub, cx(C, song)) : '';
    const tw = Object.keys(b.twists || {}).length;
    const part = (field, label) => (sec[field] ? ' ' + label + ': ' + PART_BY[field][sec[field].k].label.toLowerCase() + ', ' + sec[field].bars + (sec[field].bars === 1 ? ' bar.' : ' bars.') : '');
    return sec.name + ': ' + b.bars + ' bars at ' + b.bpm + ' BPM, in ' + keyName(C, b) + '. ' + what +
      (on.length ? ' Layers: ' + on.join(', ') + '.' : ' Every layer is off.') + part('intro', 'Way in') + part('outro', 'Way out') +
      (b.src === 'edit' ? ' Melody edited by hand.' : '') + (tw ? ' ' + tw + (tw === 1 ? ' bar twisted.' : ' bars twisted.') : '') + (sec.open ? '' : ' Closed.');
  }

  /** what a layer is doing in this section, for its row */
  function layerNote(C, body, L) {
    const lay = body.lay[L.key], tw = body.tw[L.key] || {};
    const bits = [];
    if (lay) bits.push(FORM_LABEL[lay.form || 'full'] || lay.form);
    if (tw.x) bits.push(X_LABEL[tw.x]);
    if (tw.ds) bits.push((tw.ds > 0 ? 'up ' : 'down ') + Math.abs(tw.ds) + (Math.abs(tw.ds) === 1 ? ' step' : ' steps'));
    if (tw.oct) bits.push(tw.oct > 0 ? 'octave up' : 'octave down');
    if (L.key === C.lead && body.src !== 'main') bits.push({ guest: C.guest ? C.guest.name : 'guest', answer: 'answer', callans: 'call and answer', bar2: 'second-bar motif', edit: 'edited' }[body.src] || '');
    return bits.filter(Boolean).join(' · ');
  }

  // ---------------------------------------------------------------- analysis

  /**
   * The song as it stands, and where Bobby sees room.
   * -> { stats: [{ k, v }], chart: [{ id, h, w, label, empty, name }], opps: [{ text, label, go }], open, seconds }
   *    go: { sel, tool?, panel?, bars?, add? } for the screen to act on
   */
  function analyse(C, song) {
    const BAR = C.BAR;
    let seconds = 0, bars = 0, appear = 0, twists = 0, trans = 0, guestUsed = false;
    const keys = {}, forms = {}, chart = [], en = {};
    song.secs.forEach((s, i) => {
      if (!s.body) { chart.push({ id: s.id, h: 4, w: 4, label: i + 1, empty: true, name: 'empty' }); return; }
      const r = renderSection(C, s, nextOf(song, s));
      seconds += secsOf(r);
      bars += Math.round(r.length / BAR);
      keys[keyName(C, s.body)] = 1;
      const b = s.body;
      if (C.lead && b.lay[C.lead] && b.lay[C.lead].on) {
        appear++;
        forms[[b.src, (b.tw[C.lead] || {}).x || '', b.lay[C.lead].form || 'full', b.half ? 1 : 0].join()] = 1;
      }
      twists += Object.keys(b.twists || {}).length;
      trans += (s.intro ? 1 : 0) + (s.outro ? 1 : 0);
      if (b.src === 'guest') guestUsed = true;
      const e = energyOf(C, b);
      en[s.id] = e;
      chart.push({ id: s.id, h: Math.round(10 + e * 88), w: Math.round(r.length / BAR), label: i + 1, empty: false, name: s.name, energy: e });
    });
    const full = filled(song), open = song.secs.filter((s) => s.open).length;
    const nf = Object.keys(forms).length;
    const stats = [
      { k: 'Length', v: mmss(seconds) + ' · ' + bars + ' bars' },
      { k: 'Sections', v: song.secs.length + ', ' + (song.secs.length - open) + ' closed' },
      { k: 'Your idea', v: 'In ' + appear + ' of ' + full.length + ', ' + nf + (nf === 1 ? ' form' : ' forms') },
      { k: 'Ways in and out', v: trans + ' of ' + full.length * 2 },
      { k: 'Keys', v: Object.keys(keys).join(', ') || '–' },
    ];
    const opps = [];
    const idx = (s) => song.secs.indexOf(s) + 1;
    const empty = song.secs.find((s) => !s.body);
    if (empty) opps.push({ text: 'Section ' + idx(empty) + ' is open and empty.', label: 'Go there', go: { sel: empty.id } });
    const first = full[0], last = full[full.length - 1];
    if (first && !first.intro) opps.push({ text: first.name + ' starts the song cold. A build up gives it a way in.', label: 'Show me', go: { sel: first.id } });
    if (last && !last.outro && last === song.secs[song.secs.length - 1]) opps.push({ text: 'The song stops dead after ' + last.name + '. Ring out or strip down gives it an ending.', label: 'Show me', go: { sel: last.id } });
    for (let k = 1; k < full.length; k++) {
      const a = full[k - 1], b = full[k], ia = idx(a), ib = idx(b);
      if (en[b.id] > en[a.id] + 0.12 && !a.outro && !b.intro) { opps.push({ text: 'Section ' + ia + ' runs straight into a much bigger section ' + ib + '. A tension pulse after ' + ia + ', or a snare build before ' + ib + ', sets it up.', label: 'Show me', go: { sel: a.open ? a.id : b.id } }); break; }
      if (en[b.id] < en[a.id] - 0.15 && !a.outro) { opps.push({ text: 'Section ' + ia + ' drops hard into section ' + ib + '. A bar or two of breathing room after ' + ia + ' softens the landing.', label: 'Show me', go: { sel: a.id } }); break; }
    }
    if (C.guest && C.guestLead && !guestUsed) {
      const t = song.secs.find((s) => s.open && s.body) || song.secs.find((s) => s.open);
      if (t) opps.push({ text: C.guest.name + ' hasn’t shown up yet. It could carry a verse.', label: 'Show me', go: { sel: t.id, tool: 'idea' } });
    }
    const subs = full.filter((s) => s.kind !== 'bones');
    if (Object.keys(keys).length === 1 && subs.length >= 2) opps.push({ text: 'Everything sits in ' + Object.keys(keys)[0] + '. Lifting the last chorus is the classic move.', label: 'Show me', go: { sel: subs[subs.length - 1].id, tool: 'vibe' } });
    if (!twists && full.length) {
      const t = full.find((s) => s.open);
      if (t) opps.push({ text: 'No bar has a twist yet. A stop-time bar in the middle of a chorus is an easy win.', label: 'Open Bar Builder', go: { sel: t.id, panel: 'bars', bars: [Math.max(0, Math.floor(t.body.bars / 2) - 1)] } });
    }
    if (seconds > 0 && seconds < 90) opps.push({ text: 'The song runs ' + mmss(seconds) + '. Most songs run two to four minutes; a repeat of the chorus is the cheap way there.', label: 'Add a section', go: { add: true } });
    return { stats, chart, opps, open, seconds };
  }

  // ---------------------------------------------------------------- export

  /** the song as a format-1 MIDI file */
  function midi(C, song) {
    const seq = songSeq(C, song);
    if (!seq || !Odd.midiFile) return null;
    const byTrack = {};
    seq.events.forEach((e) => { (byTrack[e.track] = byTrack[e.track] || []).push(e); });
    const gm = (patch) => (Odd.synth && Odd.synth.PATCHES && Odd.synth.PATCHES[patch] ? Odd.synth.PATCHES[patch].gm : 0);
    const tracks = Object.keys(C.tracks).filter((k) => byTrack[k]).map((k) => {
      const tr = C.tracks[k];
      return { name: tr.name, channel: tr.channel, program: tr.channel === 9 ? null : gm(tr.patch), notes: byTrack[k] };
    });
    return Odd.midiFile.write({
      name: song.name, bpm: seq.bpm, tonic: C.tonic, scale: C.scale, length: seq.length, meter: C.meter,
      markers: seq.markers.map((m) => ({ t: m.start, text: (findSec(song, m.id) || {}).name || '' })),
      tracks,
    });
  }

  // ---------------------------------------------------------------- loading

  function repairCfg(b, C) {
    if (!b || typeof b !== 'object') return null;
    const out = baseCfg(C, {});
    const lay = {};
    C.layers.forEach((l) => {
      const x = b.lay && b.lay[l.key];
      lay[l.key] = { on: x ? x.on !== false : true, form: x && R.FORMS.includes(x.form) ? x.form : 'full' };
    });
    out.lay = lay;
    out.src = ['main', 'guest', 'answer', 'callans', 'bar2', 'edit'].includes(b.src) ? b.src : 'main';
    out.bars = clamp(Math.round(Number(b.bars) || 8), 1, 16);
    out.arr = typeof b.arr === 'string' ? b.arr : 'full';
    out.tw = b.tw && typeof b.tw === 'object' ? b.tw : {};
    out.half = !!b.half;
    out.shift = clamp(Math.round(Number(b.shift) || 0), -12, 12);
    out.bpm = clamp(Math.round(Number(b.bpm) || C.bpm), 40, 240);
    out.swing = clamp(Number(b.swing) || 0, 0, 0.6);
    out.energy = clamp(Number(b.energy), 0, 1) || 0.5;
    out.curve = Odd.shape && Odd.shape.CURVES.includes(b.curve) ? b.curve : 'flat';
    out.twists = b.twists && typeof b.twists === 'object' ? b.twists : {};
    out.edit = Array.isArray(b.edit) ? b.edit : null;
    if (out.src === 'edit' && !out.edit) out.src = 'main';
    return out;
  }
  function repairPart(p, list) {
    if (!p || typeof p !== 'object' || !list[p.k]) return null;
    return { k: p.k, bars: clamp(Math.round(Number(p.bars) || list[p.k].bars || 1), 1, 8) };
  }

  /** repair a loaded song, or null when it cannot play */
  function repair(raw, env) {
    if (!raw || typeof raw !== 'object' || !Odd.idea) return null;
    const main = Odd.idea.repair(raw.main);
    if (!main) return null;
    const guest = raw.guest ? Odd.idea.repair(raw.guest) : null;
    // the idea's repair keeps only what an idea has; keep the song's layer marks too
    const rv = raw.main && Array.isArray(raw.main.voices) ? raw.main.voices : [];
    if (rv.length === main.voices.length) {
      main.voices.forEach((v, i) => {
        const r = rv[i] || {};
        if (r.added) v.added = true;
        if (r.removed) v.removed = true;
        if (r.spec && typeof r.spec === 'object') v.spec = r.spec;
      });
    }
    if (!main.voices.some((v) => !v.removed)) main.voices.forEach((v) => { delete v.removed; });
    const song = { id: String(raw.id || uid('song')), name: String(raw.name || main.name), main, guest, role: ROLES[raw.role] ? raw.role : 'chorus', kw: [], secs: [], nid: 1, lv: Math.max(0, Math.round(Number(raw.lv) || 0)), created: Number(raw.created) || Date.now(), updated: Number(raw.updated) || Date.now() };
    const kw = Array.isArray(raw.kw) ? raw.kw.filter((k) => k && KWD[k.id]) : [];
    const seen = new Set(kw.map((k) => k.id));
    song.kw = kw.map((k) => ({ id: k.id, lean: clamp(Math.round(Number(k.lean) || 0), -2, 2) })).concat(KW.filter((k) => !seen.has(k.id)).map((k) => ({ id: k.id, lean: 0 })));
    const C = context(song, env);
    let max = 0;
    (Array.isArray(raw.secs) ? raw.secs : []).forEach((s) => {
      if (!s || typeof s !== 'object') return;
      const id = String(s.id || 's' + (max + 1));
      const n = Number(String(id).replace(/\D/g, '')) || 0;
      max = Math.max(max, n);
      const body = repairCfg(s.body, C);
      song.secs.push({
        id, name: String(s.name || 'Open'), named: !!s.named, kind: s.kind || null, open: s.open !== false, body,
        intro: body ? repairPart(s.intro, PART_BY.intro) : null, outro: body ? repairPart(s.outro, PART_BY.outro) : null, hist: [],
      });
    });
    if (!song.secs.length) song.secs.push(emptySec('s1'));
    song.nid = Math.max(Number(raw.nid) || 0, max + 1);
    return song;
  }

  Odd.songmaker = {
    ACTS, ACT, KW, KWD, ROLES, ROLE_ORDER, TREAT, TREAT_BY, INTROS, OUTROS, PART_BY, VIBES, IDEA_OPTS, TWEAKS, FORM_OPTS, TWISTS, TWIST_NAME, FORM_LABEL, ADDS, ADD_BY,
    score, tagsOf, defaultKw, context, baseCfg, sameMeter,
    invertNotes, xNotes, leadPart, material, layerEvents, maskFor, renderBody, introEvents, outroEvents, renderSection,
    sequence, sectionSeq, songSeq, ideaSeq, previewSeq, timeline,
    addable, removedLayers, layerOptions, addLayer, removeLayer, restoreLayer, layerPreview,
    create, patchSec, undoSec, addSec, dupSec, removeSec, insertSec, moveSec, renameSec, renameSong, setOpen, allClosed, stepPart, findSec, nextOf, prevOf, filled,
    DIALS, DIAL_BY, CURVE_LABEL, setDial, stepDial, clearTwists,
    energyOf, actOptions, allActOptions, toolOptions, twistOptions, barSel, bobbyPick, isCurrent, nowSeq,
    rowsOf, mini, blocks, secsOf, mmss, keyName, partsText, substanceLabel, describe, layerNote,
    analyse, midi, repair,
  };
})(globalThis.Odd = globalThis.Odd || {});
