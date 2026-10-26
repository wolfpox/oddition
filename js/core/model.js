/* Oddition — workspace data model.
 *
 * workspace = { version, library: [part], ideas: [idea], sessions: [session], currentId, prefs }
 *             ideas: the idea library (see Odd.idea)
 * session   = { id, name, style, tonic, scale, bpm, swing, lanes, sections, arrangement }
 * lane      = { id, role, name, patch, volume, mute, solo, channel }
 * section   = { id, name, bars, prog, transpose, energy, entry, exit, curve, recipe, slots: { [laneId]: slot } }
 *             energy: 0..1 or null (guessed from the name); entry: 'auto' | Odd.shape.ENTRIES
 *             exit: how the next section is entered when its own entry is 'auto' ('auto' = guess)
 *             curve: energy across the section, Odd.shape.CURVES; recipe: Odd.recipes id or null
 * session.shape = { on, humanize, lift } (see Odd.shape)
 * slot      = { part (a copy), sourceId, oct, refit, from, to, form }
 *             form: how the part is played here (Odd.render.FORMS; none = as written)
 *             from/to: the bars of the section it plays (from inclusive, to exclusive;
 *             to null = to the end). from >= to: the part sits this section out.
 * arrangement = [sectionId, ...] in play order (a section may appear many times)
 */
(function (Odd) {
  'use strict';
  const T = Odd.theory;

  const VERSION = 1;
  const ROLE_ORDER = ['drums', 'perc', 'bass', 'chords', 'pad', 'lead', 'arp'];
  const ROLE_FALLBACK = {
    drums: { label: 'Drums', short: 'DRM', base: null, defaultPatch: 'kit-808' },
    perc: { label: 'Percussion', short: 'PRC', base: null, defaultPatch: 'kit-perc' },
    bass: { label: 'Bass', short: 'BAS', base: 36, defaultPatch: 'bass-sub' },
    chords: { label: 'Chords', short: 'CHD', base: 60, defaultPatch: 'epiano' },
    pad: { label: 'Pad', short: 'PAD', base: 48, defaultPatch: 'pad-warm' },
    lead: { label: 'Lead', short: 'LEAD', base: 72, defaultPatch: 'lead-square' },
    arp: { label: 'Arp', short: 'ARP', base: 60, defaultPatch: 'pluck' },
  };

  const SESSION_NAMES = [
    'Night Bus', 'Paper Moons', 'Static Garden', 'Low Tide', 'Glass Hours', 'Copper Rain',
    'Slow Orbit', 'Velvet Signal', 'Late Ferry', 'Brick & Fog', 'Quiet Engine', 'Salt Light',
    'Second Floor', 'Blue Hum', 'Field Notes', 'Afterimage', 'Rooftop Weather', 'Cold Neon',
  ];

  let counter = 0;
  function uid(prefix) {
    counter = (counter + 1) % 1296;
    return prefix + '_' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function roleInfo(role) {
    const info = Odd.gen && Odd.gen.roleInfo && Odd.gen.roleInfo[role];
    return info || ROLE_FALLBACK[role] || ROLE_FALLBACK.lead;
  }

  function styleOf(id) {
    if (Odd.styles && Odd.styles.get) return Odd.styles.get(id);
    return {
      id: 'lofi', label: 'Lo-fi', tempo: [76, 90], swing: 0.2, scales: ['minor', 'dorian'], rate: 1, vamp: false,
      patches: {},
    };
  }

  function patchFor(style, role) {
    return (style.patches && style.patches[role]) || roleInfo(role).defaultPatch;
  }

  // ---------------- lanes ----------------

  function nextChannel(session, role) {
    if (T.isDrumRole(role)) return 9;
    const used = new Set(session.lanes.map((l) => l.channel));
    for (let c = 0; c < 16; c++) {
      if (c === 9) continue;
      if (!used.has(c)) return c;
    }
    return 0;
  }

  function createLane(session, role, name) {
    const style = styleOf(session.style);
    const sameRole = session.lanes.filter((l) => l.role === role).length;
    return {
      id: uid('l'),
      role,
      name: name || roleInfo(role).label + (sameRole ? ' ' + (sameRole + 1) : ''),
      patch: patchFor(style, role),
      volume: role === 'pad' ? 0.62 : role === 'arp' || role === 'perc' ? 0.6 : 0.75,
      mute: false,
      solo: false,
      channel: nextChannel(session, role),
    };
  }

  function addLane(session, role) {
    const lane = createLane(session, role);
    // keep lanes grouped by role
    let idx = -1;
    session.lanes.forEach((l, i) => { if (l.role === role) idx = i; });
    if (idx < 0) {
      const order = ROLE_ORDER.indexOf(role);
      idx = session.lanes.findIndex((l) => ROLE_ORDER.indexOf(l.role) > order) - 1;
      if (idx < -1) idx = session.lanes.length - 1;
    }
    session.lanes.splice(idx + 1, 0, lane);
    return lane;
  }

  function removeLane(session, laneId) {
    session.lanes = session.lanes.filter((l) => l.id !== laneId);
    for (const s of session.sections) delete s.slots[laneId];
  }

  function findLane(session, id) { return session.lanes.find((l) => l.id === id) || null; }

  function laneForRole(session, role) { return session.lanes.find((l) => l.role === role) || null; }

  // ---------------- sections ----------------

  function newProgression(session, bars, rng) {
    const style = styleOf(session.style);
    return T.generateProgression(rng || Odd.rng.create(Odd.rng.newSeed()), {
      scale: session.scale, bars, rate: style.rate || 1, vamp: !!style.vamp, color: harmonyOf(session),
    });
  }

  /** how often new chords reach outside the key: the session's setting, else the style's */
  function harmonyOf(session) {
    if (typeof session.harmony === 'number') return session.harmony;
    const st = styleOf(session.style);
    return st.harmony != null ? st.harmony : 0.3;
  }

  function createSection(session, opts) {
    const o = opts || {};
    const bars = o.bars || 8;
    return {
      id: uid('s'),
      name: o.name || 'Section',
      bars,
      prog: o.prog ? T.fitProg(o.prog, bars) : newProgression(session, bars, o.rng),
      transpose: 0,
      energy: null,
      entry: 'auto',
      exit: 'auto',
      curve: 'flat',
      recipe: null,
      slots: {},
    };
  }

  function findSection(session, id) { return session.sections.find((s) => s.id === id) || null; }

  const SECTION_NAMES = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Drop', 'Break', 'Hook', 'Outro'];

  function nextSectionName(session) {
    const used = new Set(session.sections.map((s) => s.name));
    for (const n of SECTION_NAMES) if (!used.has(n)) return n;
    let i = 2;
    while (used.has('Part ' + i)) i++;
    return 'Part ' + i;
  }

  function addSection(session, opts) {
    const section = createSection(session, Object.assign({ name: nextSectionName(session) }, opts));
    session.sections.push(section);
    session.arrangement.push(section.id);
    return section;
  }

  function duplicateSection(session, id) {
    const src = findSection(session, id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = uid('s');
    copy.name = src.name + ' 2';
    session.sections.splice(session.sections.indexOf(src) + 1, 0, copy);
    const lastUse = session.arrangement.lastIndexOf(id);
    session.arrangement.splice(lastUse >= 0 ? lastUse + 1 : session.arrangement.length, 0, copy.id);
    return copy;
  }

  function removeSection(session, id) {
    if (session.sections.length <= 1) return false;
    session.sections = session.sections.filter((s) => s.id !== id);
    session.arrangement = session.arrangement.filter((sid) => sid !== id);
    return true;
  }

  /** change the session's mode; chromatic chords keep their sound (see theory.rescaleChord) */
  function setScale(session, scale) {
    if (!T.SCALES[scale] || scale === session.scale) return;
    for (const sec of session.sections) {
      sec.prog = sec.prog.map((c) => Object.assign(T.rescaleChord(c, session.scale, scale), { beats: c.beats }));
    }
    session.scale = scale;
  }

  function setSectionBars(session, section, bars) {
    section.bars = bars;
    section.prog = T.fitProg(section.prog, bars);
  }

  // ---------------- slots ----------------

  function placePart(session, sectionId, laneId, part) {
    const section = findSection(session, sectionId);
    if (!section || !findLane(session, laneId)) return null;
    const prev = section.slots[laneId];
    const slot = {
      part: clone(part),
      sourceId: part.id || null,
      oct: prev ? prev.oct || 0 : 0,
      // imported clips already carry their own harmony, so play them as written
      refit: part.imported ? false : prev ? prev.refit !== false : true,
    };
    // a new part takes over the bars the old one played
    if (prev && prev.from) slot.from = prev.from;
    if (prev && prev.to != null) slot.to = prev.to;
    if (prev && prev.form) slot.form = prev.form;
    section.slots[laneId] = slot;
    return slot;
  }

  /** the bars a slot plays in its section: { from, to, full, out } */
  function slotSpan(section, slot) {
    const bars = section.bars;
    const from = Math.max(0, Math.min(bars, Math.round(Number(slot && slot.from) || 0)));
    const rawTo = slot && slot.to != null ? Math.round(Number(slot.to)) : bars;
    const to = Math.max(from, Math.min(bars, isFinite(rawTo) ? rawTo : bars));
    return { from, to, full: from === 0 && to === bars, out: from >= to };
  }

  /** set the bars a slot plays; to null (or the section length) means to the end */
  function setSlotSpan(section, laneId, from, to) {
    const slot = section.slots[laneId];
    if (!slot) return;
    const bars = section.bars;
    const f = Math.max(0, Math.min(bars, Math.round(from || 0)));
    const t = to == null ? bars : Math.max(f, Math.min(bars, Math.round(to)));
    if (f) slot.from = f; else delete slot.from;
    if (t < bars) slot.to = t; else delete slot.to;
  }

  function clearSlot(session, sectionId, laneId) {
    const section = findSection(session, sectionId);
    if (section) delete section.slots[laneId];
  }

  /**
   * Material that recurs: slots across a session that play the same shelf
   * part. Returns Map(sourceId -> { letter, uses: [{ section, laneId, form }] })
   * lettered A, B, C... in song order, for parts used in two or more sections
   * that are hook material (lead, arp) or come back in another form. A groove
   * or chord part that simply repeats is how songs work, not a theme.
   */
  const THEME_ROLES = new Set(['lead', 'arp']);
  function themes(session) {
    const uses = new Map();
    const order = session.arrangement.map((id) => findSection(session, id)).filter(Boolean);
    for (const sec of session.sections) if (!order.includes(sec)) order.push(sec);
    const seen = new Set();
    for (const sec of order) {
      if (seen.has(sec.id)) continue;
      seen.add(sec.id);
      for (const lane of session.lanes) {
        const slot = sec.slots[lane.id];
        if (!slot || !slot.sourceId) continue;
        if (!uses.has(slot.sourceId)) uses.set(slot.sourceId, []);
        uses.get(slot.sourceId).push({ section: sec, laneId: lane.id, role: lane.role, form: slot.form || 'full' });
      }
    }
    const out = new Map();
    let i = 0;
    for (const [id, list] of uses) {
      if (new Set(list.map((u) => u.section.id)).size < 2) continue;
      if (!list.some((u) => THEME_ROLES.has(u.role) || u.form !== 'full')) continue;
      out.set(id, { letter: String.fromCharCode(65 + (i++ % 26)), uses: list });
    }
    return out;
  }

  /** place a slot's part in other sections, played in the given forms: { [sectionId]: form } */
  function reuseSlot(session, fromSectionId, laneId, targets) {
    const src = findSection(session, fromSectionId);
    const slot = src && src.slots[laneId];
    if (!slot) return 0;
    let n = 0;
    for (const sid in targets) {
      const sec = findSection(session, sid);
      if (!sec || sec === src) continue;
      const form = targets[sid];
      if (!form) continue;
      const part = Object.assign(clone(slot.part), { id: slot.sourceId || slot.part.id });
      const placed = placePart(session, sid, laneId, part);
      if (!placed) continue;
      placed.oct = slot.oct || 0;
      placed.refit = slot.refit !== false;
      if (form === 'full') delete placed.form;
      else placed.form = form;
      n++;
    }
    return n;
  }

  // ---------------- arrangement ----------------

  function moveArrangement(session, index, dir) {
    const a = session.arrangement;
    const j = index + dir;
    if (index < 0 || index >= a.length || j < 0 || j >= a.length) return false;
    [a[index], a[j]] = [a[j], a[index]];
    return true;
  }

  function songBars(session) {
    let bars = 0;
    for (const sid of session.arrangement) {
      const s = findSection(session, sid);
      if (s) bars += s.bars;
    }
    return bars;
  }

  function songSeconds(session) {
    return (songBars(session) * 4 * 60) / (session.bpm || 120);
  }

  // ---------------- sessions ----------------

  function defaultShape() {
    return Object.assign({}, (Odd.shape && Odd.shape.DEFAULTS) || { on: true, humanize: 0.4, lift: true });
  }

  function createSession(opts) {
    const o = opts || {};
    const rng = Odd.rng.create(o.seed != null ? o.seed : Odd.rng.newSeed());
    const style = styleOf(o.style || (Odd.styles && Odd.styles.DEFAULT) || 'lofi');
    const scale = o.scale || rng.pick(style.scales && style.scales.length ? style.scales : ['minor']);
    const session = {
      id: uid('ss'),
      name: o.name || rng.pick(SESSION_NAMES),
      style: style.id,
      tonic: o.tonic != null ? o.tonic : rng.int(0, 11),
      scale,
      bpm: o.bpm || Math.round(rng.range(style.tempo[0], style.tempo[1])),
      swing: style.swing || 0,
      harmony: style.harmony != null ? style.harmony : 0.3,
      shape: defaultShape(),
      lanes: [],
      sections: [],
      arrangement: [],
      created: Date.now(),
      updated: Date.now(),
    };
    for (const role of ROLE_ORDER) session.lanes.push(createLane(session, role));

    const verse = createSection(session, { name: 'Verse', bars: 8, rng: rng.fork('verse') });
    let chorus = null;
    for (let i = 0; i < 6; i++) {
      chorus = createSection(session, { name: 'Chorus', bars: 8, rng: rng.fork('chorus' + i) });
      if (T.formatProg(chorus.prog, scale) !== T.formatProg(verse.prog, scale)) break;
    }
    const intro = createSection(session, { name: 'Intro', bars: 4, prog: verse.prog });
    session.sections = [intro, verse, chorus];
    session.arrangement = [intro.id, verse.id, chorus.id, verse.id, chorus.id];
    return session;
  }

  /** apply a style preset to an existing session: tempo, swing and lane sounds */
  function applyStyle(session, styleId, rng) {
    const style = styleOf(styleId);
    const r = rng || Odd.rng.create(Odd.rng.newSeed());
    session.style = style.id;
    session.bpm = Math.round(r.range(style.tempo[0], style.tempo[1]));
    session.swing = style.swing || 0;
    session.harmony = style.harmony != null ? style.harmony : 0.3;
    for (const lane of session.lanes) lane.patch = patchFor(style, lane.role);
  }

  function duplicateSession(ws, id) {
    const src = ws.sessions.find((s) => s.id === id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = uid('ss');
    copy.name = src.name + ' (copy)';
    copy.created = copy.updated = Date.now();
    ws.sessions.splice(ws.sessions.indexOf(src) + 1, 0, copy);
    return copy;
  }

  function removeSession(ws, id) {
    if (ws.sessions.length <= 1) return false;
    ws.sessions = ws.sessions.filter((s) => s.id !== id);
    if (ws.currentId === id) ws.currentId = ws.sessions[0].id;
    return true;
  }

  function currentSession(ws) {
    return ws.sessions.find((s) => s.id === ws.currentId) || ws.sessions[0];
  }

  // ---------------- library (the shelf) ----------------

  function stamp(part) {
    const p = clone(part);
    if (!p.id) p.id = uid('p');
    if (!p.created) p.created = Date.now();
    if (p.starred == null) p.starred = false;
    if (!p.tags) p.tags = [];
    return p;
  }

  function addToLibrary(ws, part) {
    const existing = part.id && ws.library.find((p) => p.id === part.id);
    if (existing) return existing;
    const p = stamp(part);
    ws.library.unshift(p);
    return p;
  }

  function findPart(ws, id) { return ws.library.find((p) => p.id === id) || null; }

  function removeFromLibrary(ws, id) {
    ws.library = ws.library.filter((p) => p.id !== id);
  }

  /** how many slots across all sessions came from this shelf part */
  function usageCount(ws, partId) {
    let n = 0;
    for (const s of ws.sessions) {
      for (const sec of s.sections) {
        for (const k in sec.slots) if (sec.slots[k].sourceId === partId) n++;
      }
    }
    return n;
  }

  // ---------------- ideas ----------------

  function addIdea(ws, idea) {
    if (!ws.ideas) ws.ideas = [];
    ws.ideas.unshift(idea);
    return idea;
  }

  function findIdea(ws, id) { return (ws.ideas || []).find((x) => x.id === id) || null; }

  function removeIdea(ws, id) {
    ws.ideas = (ws.ideas || []).filter((x) => x.id !== id);
  }

  // ---------------- workspace ----------------

  function createWorkspace(opts) {
    const session = createSession(opts);
    // `fresh` marks a workspace nobody has worked in yet; it never wins a sync
    return { version: VERSION, library: [], ideas: [], sessions: [session], currentId: session.id, prefs: {}, fresh: true };
  }

  /** fill a session with starter parts so a first visit makes sound right away */
  function fillStarter(ws, session, seed) {
    if (!Odd.gen || !Odd.gen.generate) return;
    const rng = Odd.rng.create(seed != null ? seed : Odd.rng.newSeed());
    const plan = {
      Intro: ['pad', 'arp'],
      Verse: ['drums', 'bass', 'chords'],
      Chorus: ['drums', 'perc', 'bass', 'chords', 'pad', 'lead'],
    };
    for (const section of session.sections) {
      for (const role of plan[section.name] || []) {
        const lane = laneForRole(session, role);
        if (!lane) continue;
        const bars = 4;
        const part = Odd.gen.generate({
          role, style: session.style, seed: rng.int(1, 4294967295), bars,
          tonic: session.tonic, scale: session.scale, prog: T.sliceProg(section.prog, 0, bars * T.BAR),
          params: section.name === 'Chorus' ? { density: 0.62 } : {},
        });
        part.tags = ['starter'];
        const stored = addToLibrary(ws, part);
        placePart(session, section.id, lane.id, stored);
      }
    }
  }

  /** repair anything missing in loaded data */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions) || !raw.sessions.length) return null;
    const ws = raw;
    ws.version = VERSION;
    ws.library = Array.isArray(ws.library) ? ws.library.filter((p) => p && p.role && Array.isArray(p.notes)) : [];
    ws.ideas = Array.isArray(ws.ideas) && Odd.idea ? ws.ideas.map(Odd.idea.repair).filter(Boolean) : Array.isArray(ws.ideas) ? ws.ideas : [];
    ws.prefs = ws.prefs || {};
    ws.sessions = ws.sessions.filter((s) => s && Array.isArray(s.sections) && s.sections.length);
    if (!ws.sessions.length) return null;
    // ids are compared with === against DOM data attributes and object keys,
    // which are always strings: a hand-edited file with numeric ids would
    // otherwise match nothing
    const sid = (x) => (x == null ? x : String(x));
    for (const p of ws.library) p.id = sid(p.id);
    ws.currentId = sid(ws.currentId);
    for (const s of ws.sessions) {
      s.id = sid(s.id);
      s.lanes = Array.isArray(s.lanes) ? s.lanes : [];
      for (const l of s.lanes) l.id = sid(l.id);
      s.arrangement = (Array.isArray(s.arrangement) ? s.arrangement : []).map(sid);
      for (const sec of s.sections) {
        sec.id = sid(sec.id);
        for (const k in sec.slots || {}) {
          const slot = sec.slots[k];
          if (slot && slot.sourceId != null) slot.sourceId = sid(slot.sourceId);
          if (slot && slot.part && slot.part.id != null) slot.part.id = sid(slot.part.id);
        }
      }
      s.bpm = Math.max(30, Math.min(300, Number(s.bpm) || 100));
      s.swing = Math.max(0, Math.min(0.6, Number(s.swing) || 0));
      s.harmony = typeof s.harmony === 'number' && isFinite(s.harmony) ? Math.max(0, Math.min(1, s.harmony)) : harmonyOf(Object.assign({}, s, { harmony: null }));
      s.tonic = T.mod(Number(s.tonic) || 0, 12);
      if (!T.SCALES[s.scale]) s.scale = 'minor';
      const shape = Object.assign(defaultShape(), s.shape && typeof s.shape === 'object' ? s.shape : {});
      s.shape = {
        on: shape.on !== false,
        humanize: Math.max(0, Math.min(1, Number(shape.humanize) || 0)),
        lift: shape.lift !== false,
      };
      const entries = (Odd.shape && Odd.shape.ENTRIES) || ['none', 'fill', 'build', 'gap'];
      for (const sec of s.sections) {
        sec.slots = sec.slots || {};
        sec.bars = sec.bars || 8;
        sec.transpose = sec.transpose || 0;
        const en = Number(sec.energy);
        sec.energy = sec.energy == null || sec.energy === '' || !isFinite(en) ? null : Math.max(0, Math.min(1, en));
        if (!entries.includes(sec.entry)) sec.entry = 'auto';
        if (!entries.includes(sec.exit)) sec.exit = 'auto';
        const curves = (Odd.shape && Odd.shape.CURVES) || ['flat'];
        if (!curves.includes(sec.curve)) sec.curve = 'flat';
        if (typeof sec.recipe !== 'string') sec.recipe = null;
        for (const k in sec.slots) {
          const slot = sec.slots[k];
          if (!slot) continue;
          if (slot.from != null && !(Number(slot.from) >= 0)) delete slot.from;
          if (slot.to != null && !(Number(slot.to) >= 0)) delete slot.to;
          const forms = (Odd.render && Odd.render.FORMS) || ['full'];
          if (slot.form != null && (!forms.includes(slot.form) || slot.form === 'full')) delete slot.form;
        }
        sec.prog = T.fitProg(sec.prog || [], sec.bars);
      }
      const ids = new Set(s.sections.map((x) => x.id));
      s.arrangement = s.arrangement.filter((id) => ids.has(id));
      // sessions from before the percussion lane get one
      if (s.lanes.length && !s.lanes.some((l) => l.role === 'perc')) addLane(s, 'perc');
    }
    if (!ws.sessions.find((s) => s.id === ws.currentId)) ws.currentId = ws.sessions[0].id;
    return ws;
  }

  Odd.model = {
    VERSION, ROLE_ORDER, SECTION_NAMES, uid, clone, roleInfo, styleOf, patchFor,
    createLane, addLane, removeLane, findLane, laneForRole,
    newProgression, harmonyOf, createSection, findSection, addSection, duplicateSection, removeSection, setScale, setSectionBars,
    placePart, clearSlot, slotSpan, setSlotSpan, themes, reuseSlot, moveArrangement, songBars, songSeconds,
    createSession, defaultShape, applyStyle, duplicateSession, removeSession, currentSession,
    stamp, addToLibrary, findPart, removeFromLibrary, usageCount,
    addIdea, findIdea, removeIdea,
    createWorkspace, fillStarter, migrate,
  };
})(globalThis.Odd = globalThis.Odd || {});
