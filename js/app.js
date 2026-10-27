/* Oddition — app controller: state, actions, playback, keyboard, boot. */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const M = Odd.model;
  const R = Odd.render;
  const D = Odd.dom;
  const $ = D.$;
  const $$ = D.$$;
  const esc = D.esc;

  const app = {
    ws: null,
    ui: {
      screen: 'bones', // 'bones' (Bones to Gold) | 'studio'
      tab: 'booth',
      sectionId: null,
      laneId: null,
      arrIndex: null,
      fieldsOpen: false,
      loopSong: false,
      playing: null,
      lastPlay: { kind: 'booth', id: null },
      booth: { role: 'drums', bars: 4, context: true, listen: true, takeNo: 0, takes: {}, edit: false, locks: [] },
      shelf: { role: 'all', query: '', starred: false, sort: 'new', view: 'parts' },
      ideaMute: {}, // idea id -> voice indices left out of playback
    },
  };
  Odd.app = app;

  // ======================= getters used by views =======================
  app.session = () => M.currentSession(app.ws);

  app.selectedSection = () => {
    const s = app.session();
    return M.findSection(s, app.ui.sectionId) || s.sections[Math.min(1, s.sections.length - 1)];
  };
  app.boothSection = app.selectedSection;

  app.boothLane = () => {
    const s = app.session();
    const lane = M.findLane(s, app.ui.laneId);
    if (lane && lane.role === app.ui.booth.role) return lane;
    return M.laneForRole(s, app.ui.booth.role);
  };

  /**
   * what the section already plays, for a new take to fit around (null when
   * listening is off or the section is empty). The lane the take is for is
   * left out: the take replaces it.
   */
  app.boothBand = () => {
    if (!app.ui.booth.listen || !Odd.band) return null;
    const s = app.session();
    const sec = app.selectedSection();
    const target = app.boothLane();
    const lanes = [];
    for (const lane of s.lanes) {
      if (target && lane.id === target.id) continue;
      const slot = sec.slots && sec.slots[lane.id];
      if (!slot || !slot.part) continue;
      lanes.push({ role: lane.role, events: R.sectionEvents(s, sec, { only: lane.id, shape: false }) });
    }
    return Odd.band.hear(lanes, sec.bars * T.BAR, app.ui.booth.bars * T.BAR);
  };

  app.selectedSlot = () => ({ section: app.selectedSection(), lane: M.findLane(app.session(), app.ui.laneId) });

  app.takesFor = (role) => {
    const t = app.ui.booth.takes;
    if (!t[role]) t[role] = { list: [], index: -1 };
    return t[role];
  };

  app.currentTake = () => {
    const tk = app.takesFor(app.ui.booth.role);
    return tk.list[tk.index] || null;
  };

  app.paramValue = (role, key) => {
    const saved = (app.ws.prefs.params || {})[role] || {};
    if (saved[key] != null) return saved[key];
    const d = Odd.gen.defaults(role);
    return d[key];
  };

  /**
   * When `lane`'s tune sets the selected section's chords, a part auditioned
   * for that lane leads too: the chords it would give the section. null otherwise.
   */
  app.leadProg = (part, lane) => {
    const H = Odd.harmonise;
    const sec = app.selectedSection();
    if (!H || !part || !sec || !lane || H.leaderOf(sec) !== lane.id || part.role !== lane.role) return null;
    return H.forSection(app.session(), sec, lane.id, { part }).prog;
  };

  /** where a booth take plays: the selected section, or the chords it sets there when it leads */
  app.boothTarget = (part, length, lane) => {
    const s = app.session();
    const tgt = R.sectionTarget(s, app.selectedSection(), length);
    const prog = app.leadProg(part, lane || app.boothLane());
    return prog ? Object.assign(tgt, { prog, refit: false, leads: true }) : tgt;
  };

  app.boothRoll = (part) => {
    const s = app.session();
    const length = part.bars * T.BAR;
    const tgt = app.boothTarget(part, length);
    return {
      events: R.partEvents(part, Object.assign({ withIndex: true }, tgt)),
      length,
      chords: R.chordLabels(tgt.prog, tgt.tonic, s.scale, length),
    };
  };

  app.shelfParts = () => {
    const f = app.ui.shelf;
    const q = f.query.trim().toLowerCase();
    let list = app.ws.library.filter((p) =>
      (f.role === 'all' || p.role === f.role) &&
      (!f.starred || p.starred) &&
      (!q || p.name.toLowerCase().includes(q) || (p.tags || []).some((t) => t.includes(q))));
    const order = M.ROLE_ORDER;
    if (f.sort === 'old') list = list.slice().sort((a, b) => a.created - b.created);
    else if (f.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    else if (f.sort === 'role') list = list.slice().sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || b.created - a.created);
    else list = list.slice().sort((a, b) => b.created - a.created);
    return list;
  };

  /** ideas shown in the shelf: same filters as parts (a stem filter shows ideas with that voice) */
  app.shelfIdeas = () => {
    const f = app.ui.shelf;
    const q = f.query.trim().toLowerCase();
    let list = (app.ws.ideas || []).filter((idea) =>
      (f.role === 'all' || idea.voices.some((v) => v.role === f.role)) &&
      (!f.starred || idea.starred) &&
      (!q || idea.name.toLowerCase().includes(q) || idea.voices.some((v) => v.name.toLowerCase().includes(q))));
    const order = M.ROLE_ORDER;
    if (f.sort === 'old') list = list.slice().sort((a, b) => a.created - b.created);
    else if (f.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    else if (f.sort === 'role') list = list.slice().sort((a, b) => order.indexOf(a.voices[0].role) - order.indexOf(b.voices[0].role) || b.created - a.created);
    else list = list.slice().sort((a, b) => b.created - a.created);
    return list;
  };

  app.ideaMute = (id) => app.ui.ideaMute[id] || [];

  app.isPlaying = (kind, id) => {
    const p = app.ui.playing;
    return !!p && p.kind === kind && (id == null || p.id === id);
  };

  // ======================= painting =======================
  const roots = {};

  function focusKey(el) {
    if (!el || el === document.body) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    if (!el.dataset || !el.dataset.act) return null;
    let sel = '[data-act="' + el.dataset.act + '"]';
    for (const k of ['id', 'section', 'lane', 'role', 'index', 'dir', 'tab']) {
      if (el.dataset[k] != null) sel += '[data-' + k + '="' + CSS.escape(el.dataset[k]) + '"]';
    }
    return sel;
  }

  function paint(which) {
    const views = which || ['top', 'booth', 'shelf', 'song', 'tabs'];
    const key = focusKey(document.activeElement);
    const sheet = $('.sheet-wrap');
    const scroll = {
      sheetX: sheet ? sheet.scrollLeft : 0,
      sheetY: sheet ? sheet.scrollTop : 0,
      cards: $('.cards') ? $('.cards').scrollTop : 0,
      arr: $('.arrangement') ? $('.arrangement').scrollLeft : 0,
    };
    syncTabs(); // panels must be visible before their canvases are measured
    for (const v of views) {
      const root = roots[v];
      if (!root) continue;
      const out = Odd.views[v](app);
      root.innerHTML = out.html;
      drawRolls(out.rolls);
    }
    if (views.includes('song')) {
      const sw = $('.sheet-wrap');
      if (sw) { sw.scrollLeft = scroll.sheetX; sw.scrollTop = scroll.sheetY; }
      const ar = $('.arrangement');
      if (ar) ar.scrollLeft = scroll.arr;
    }
    if (views.includes('shelf') && $('.cards')) $('.cards').scrollTop = scroll.cards;
    if (key) {
      const el = document.querySelector(key);
      if (el && el !== document.activeElement) try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    syncTabs();
    syncPlayState();
    live = null;
    idle = false;
  }

  function drawRolls(rolls) {
    for (const r of rolls) {
      const c = document.getElementById(r.id);
      if (!c || !c.clientWidth) continue;
      if (r.opts.glyph) Odd.roll.glyph(c, r.opts);
      else if (r.opts.stack) Odd.roll.stack(c, r.opts);
      else Odd.roll.draw(c, r.opts);
    }
  }

  function syncTabs() {
    for (const k of ['booth', 'shelf', 'song']) {
      if (roots[k]) roots[k].classList.toggle('is-tab', app.ui.tab === k);
    }
    document.body.dataset.tab = app.ui.tab;
  }

  // ======================= saving & history =======================
  let saveWarned = false;
  function onSaved(res) {
    if (res && !res.ok && !saveWarned) {
      saveWarned = true;
      D.toast('This browser would not save your work (storage is full or blocked). Use Export › Project file to keep it.', { kind: 'warn', duration: 8000 });
    }
  }

  function persist() {
    app.ws.savedAt = Date.now();
    Odd.store.schedule(app.ws, 400, onSaved);
    if (Odd.platform && Odd.platform.sync) Odd.platform.sync.save(app.ws);
  }

  /** undoable change to the workspace */
  function commit(label, fn, views) {
    Odd.history.record(app.ws, label);
    delete app.ws.fresh; // the starter workspace now holds real work
    const result = fn(app.session(), app.ws);
    // a section led by a tune re-works its chords whenever the tune changes
    if (Odd.harmonise) Odd.harmonise.sync(app.session());
    app.session().updated = Date.now();
    persist();
    paint(views);
    refreshPlayback();
    return result;
  }

  function fixSelection() {
    const s = app.session();
    if (!M.findSection(s, app.ui.sectionId)) {
      const verse = s.sections.find((x) => x.name === 'Verse') || s.sections[Math.min(1, s.sections.length - 1)];
      app.ui.sectionId = verse.id;
    }
    if (app.ui.laneId && !M.findLane(s, app.ui.laneId)) app.ui.laneId = null;
    if (app.ui.arrIndex != null && app.ui.arrIndex >= s.arrangement.length) app.ui.arrIndex = null;
  }

  function undo() {
    const r = Odd.history.undo(app.ws);
    if (!r) return;
    app.ws = r.ws;
    fixSelection();
    persist();
    paint();
    refreshPlayback();
    D.toast('Undid ' + (r.label || 'last change').toLowerCase());
  }

  function redo() {
    const r = Odd.history.redo(app.ws);
    if (!r) return;
    app.ws = r.ws;
    fixSelection();
    persist();
    paint();
    refreshPlayback();
    D.toast('Redid ' + (r.label || 'change').toLowerCase());
  }

  function savePrefs() {
    const b = app.ui.booth;
    Object.assign(app.ws.prefs, {
      role: b.role, bars: b.bars, context: b.context, listen: b.listen,
      shelf: { role: app.ui.shelf.role, sort: app.ui.shelf.sort, starred: app.ui.shelf.starred, view: app.ui.shelf.view },
      loopSong: app.ui.loopSong,
      moreOpen: !!app.ui.moreOpen,
    });
    persist();
  }

  // ======================= playback =======================
  const TAKE_TRACK = '__take';
  const IDEA_TRACK = '__v'; // one track per voice: __v0, __v1...
  const BONES_PATCH = { drum: 'kit-acoustic', pitched: 'keys' };

  function laneForPart(part) {
    const s = app.session();
    const lane = M.findLane(s, app.ui.laneId);
    if (lane && lane.role === part.role) return lane;
    return M.laneForRole(s, part.role);
  }

  function buildSeq(kind, id) {
    const s = app.session();
    if (kind === 'booth' || kind === 'preview') {
      const part = kind === 'booth' ? app.currentTake() : M.findPart(app.ws, id);
      if (!part) return null;
      const sec = app.selectedSection();
      const lane = kind === 'booth' ? app.boothLane() : laneForPart(part);
      const partLen = part.bars * T.BAR;
      const withSection = app.ui.booth.context;
      const length = withSection ? Math.max(partLen, sec.bars * T.BAR) : partLen;
      // a take for the lane whose tune sets the chords is heard leading them
      const tgt = app.boothTarget(part, length, lane);
      let events = R.partEvents(part, tgt);
      for (const e of events) e.track = TAKE_TRACK;
      // the booth plays parts as written: song shape only applies on the song sheet
      const band = tgt.leads ? Object.assign({}, sec, { prog: tgt.prog }) : sec;
      if (withSection) events = events.concat(R.sectionEvents(s, band, { length, exclude: lane && lane.id, shape: false }));
      const take = {
        role: part.role,
        patch: lane ? lane.patch : M.roleInfo(part.role).defaultPatch,
        volume: lane ? lane.volume : 0.75,
        mute: false,
        solo: false,
        channel: lane ? lane.channel : T.isDrumRole(part.role) ? 9 : 0,
      };
      const seq = R.sequence(s, events, length, true, { [TAKE_TRACK]: take });
      for (const k in seq.tracks) seq.tracks[k].solo = false; // solo is for the song sheet
      seq.partLength = partLen;
      return seq;
    }
    if (kind === 'bones' || kind === 'idea') return ideaSeq(kind, id);
    if (kind === 'ladder') return ladderSeq();
    if (kind === 'section') {
      const sec = M.findSection(s, id);
      if (!sec) return null;
      return R.sequence(s, R.sectionEvents(s, sec), sec.bars * T.BAR, true);
    }
    if (kind === 'song') {
      const song = R.songEvents(s);
      if (!song.length) return null;
      const seq = R.sequence(s, song.events, song.length, app.ui.loopSong);
      seq.markers = song.markers;
      return seq;
    }
    return null;
  }

  /**
   * An idea on its own. Bones: the cores in plain sounds, straight (no swing,
   * no human feel), in the session's key. Full: the parts as they were found,
   * over their own chords, through the lane sounds, with the session's feel.
   */
  function ideaSeq(kind, id) {
    const s = app.session();
    const idea = M.findIdea(app.ws, id);
    if (!idea) return null;
    const bones = kind === 'bones';
    const length = idea.bars * T.BAR;
    const events = Odd.idea.events(idea, { mode: bones ? 'bones' : 'full', tonic: s.tonic, scale: s.scale, mute: app.ideaMute(id), prefix: IDEA_TRACK });
    const { tracks } = ideaTracks(idea, bones);
    if (bones) return { bpm: s.bpm, length, loop: true, events: events.sort(R.byTime), tracks };
    const seq = R.sequence(s, events, length, true, tracks);
    for (const k in seq.tracks) seq.tracks[k].solo = false; // solo is for the song sheet
    return seq;
  }

  /**
   * A transport track per voice of an idea. plain: the neutral bones sounds;
   * otherwise each voice sounds like a lane of its stem (a second voice of the
   * same stem takes the second lane, if there is one).
   * Returns { tracks, lanes: Set of the lane ids the voices sound like }.
   */
  function ideaTracks(idea, plain) {
    const s = app.session();
    const tracks = {};
    const lanes = new Set();
    idea.voices.forEach((v, i) => {
      const drum = T.isDrumRole(v.role);
      const lane = s.lanes.find((l) => l.role === v.role && !lanes.has(l.id)) || M.laneForRole(s, v.role);
      if (lane) lanes.add(lane.id);
      tracks[IDEA_TRACK + i] = {
        role: v.role,
        patch: plain ? (drum ? BONES_PATCH.drum : BONES_PATCH.pitched) : lane ? lane.patch : M.roleInfo(v.role).defaultPatch,
        volume: plain ? 0.75 : lane ? lane.volume : 0.75,
        mute: false,
        solo: false,
        channel: drum ? 9 : lane ? lane.channel : i,
      };
    });
    return { tracks, lanes };
  }

  // ======================= the ladder =======================
  /*
   * One idea heard step by step from its bones to a full mix (Odd.idea.RUNGS).
   * app.ui.ladder = { ideaId, rung, target } while the ladder is open;
   * target is a section id, or '' for where the idea was found (its own chords).
   * Steps up to harmony play plain and straight; sound and feel switches to
   * the lane sounds with swing and human timing; band adds the section's other
   * parts and shapes everything with the section's energy.
   */
  const RUNG_TEXT = {
    rhythm: () => 'When the notes fall and which are strong. One sound, no pitch.',
    shape: () => 'Adds which way it moves: plain steps up and down the scale. These are the bones.',
    notes: () => 'Adds the notes as written: chords, passing notes, sharps and flats, lengths and dynamics.',
    harmony: (sec) => (sec ? 'Bends every note to the chords of ' + sec.name + '.' : 'Plays over the chords it was written on. Pick a section above to fit it somewhere.'),
    sound: () => 'Adds the lane sounds, swing and human timing.',
    band: (sec) => (sec ? 'Adds what else ' + sec.name + ' plays, and the section\'s energy.' : ''),
  };

  function ladderCtx() {
    const L = app.ui.ladder;
    if (!L) return null;
    const s = app.session();
    const idea = M.findIdea(app.ws, L.ideaId);
    if (!idea) return null;
    const sec = L.target ? M.findSection(s, L.target) : null;
    const length = Math.max(idea.bars, sec ? sec.bars : 0) * T.BAR;
    const tgt = sec ? R.sectionTarget(s, sec, length) : { tonic: s.tonic, scale: s.scale, prog: null, length };
    // the voices take over their stems' lanes; the band is everything else the section plays
    const taken = ideaTracks(idea, false).lanes;
    const band = sec ? s.lanes.filter((l) => sec.slots[l.id] && sec.slots[l.id].part && !taken.has(l.id)) : [];
    return { s, idea, sec, length, tgt, band };
  }

  /** a step's events: { events (voices, one track each), band: [{ lane, events }] } */
  function ladderEvents(c, rung, mute) {
    const top = rung === 'band' && c.sec && c.band.length;
    let events = Odd.idea.rungEvents(c.idea, {
      rung, tonic: c.tgt.tonic, scale: c.tgt.scale, prog: c.sec ? c.sec.prog : null, length: c.length, mute, prefix: IDEA_TRACK,
    });
    const band = [];
    if (top) {
      if (Odd.shape && Odd.shape.settings(c.s).on) {
        const energy = Odd.shape.energyOf(c.sec);
        const shaped = [];
        c.idea.voices.forEach((v, i) => {
          const evs = events.filter((e) => e.track === IDEA_TRACK + i);
          if (evs.length) for (const e of Odd.shape.shapeLane(evs, { role: v.role, energy, start: 0, end: c.length, curve: c.sec.curve, nextEnergy: null })) shaped.push(e);
        });
        events = shaped.sort(R.byTime);
      }
      for (const lane of c.band) band.push({ lane, events: R.sectionEvents(c.s, c.sec, { only: lane.id, length: c.length }) });
    }
    return { events, band };
  }

  function ladderSeq() {
    const c = ladderCtx();
    if (!c) return null;
    const rung = app.ui.ladder.rung;
    const i = Odd.idea.rungIndex(rung);
    const plain = i <= Odd.idea.rungIndex('harmony');
    const { events, band } = ladderEvents(c, rung, app.ideaMute(c.idea.id));
    const { tracks } = ideaTracks(c.idea, plain);
    let all = events;
    for (const b of band) all = all.concat(b.events);
    if (plain) return { bpm: c.s.bpm, length: c.length, loop: true, events: all.sort(R.byTime), tracks };
    const seq = R.sequence(c.s, all, c.length, true, tracks);
    for (const k in seq.tracks) seq.tracks[k].solo = false; // solo is for the song sheet
    return seq;
  }

  /** what the ladder view draws */
  app.ladderData = () => {
    const c = ladderCtx();
    if (!c) return null;
    const mute = app.ideaMute(c.idea.id);
    const rungs = Odd.idea.RUNGS.map((r) => {
      const disabled = r.id === 'band' && (!c.sec || !c.band.length);
      // draw every voice (left-out ones dimmed), count only what plays
      const { events, band } = ladderEvents(c, disabled ? 'sound' : r.id, []);
      const lanes = c.idea.voices.map((v, vi) => ({
        role: v.role, drums: T.isDrumRole(v.role), dim: mute.includes(vi), events: events.filter((e) => e.track === IDEA_TRACK + vi),
      }));
      for (const b of band) lanes.push({ role: b.lane.role, drums: T.isDrumRole(b.lane.role), dim: true, events: b.events });
      let count = lanes.filter((l) => !l.dim).reduce((n, l) => n + l.events.length, 0);
      if (band.length) count += band.reduce((n, b) => n + b.events.length, 0);
      return {
        id: r.id, label: r.label, group: r.group, lanes, count, disabled,
        text: disabled ? (c.sec ? c.sec.name + ' has nothing else playing.' : 'Pick a section above to hear it with a band.') : RUNG_TEXT[r.id](c.sec),
      };
    });
    return { idea: c.idea, sec: c.sec, length: c.length, rungs, rung: app.ui.ladder.rung, sections: c.s.sections, mute, bandSize: c.band.length };
  };

  async function ladderDialog(idea) {
    const sel = app.selectedSection();
    app.ui.ladder = { ideaId: idea.id, rung: 'shape', target: sel ? sel.id : '' };
    let host = null;
    let dlgEl = null;
    const enabled = () => (app.ladderData() || { rungs: [] }).rungs.filter((r) => !r.disabled).map((r) => r.id);
    const render = () => {
      if (!host) return;
      const hadFocus = host.contains(document.activeElement);
      const out = Odd.views.ladder(app);
      host.innerHTML = out.html;
      drawRolls(out.rolls);
      const L = app.ui.ladder;
      const sec = L.target ? M.findSection(app.session(), L.target) : null;
      const place = $('.dialog-actions button[data-i="0"]', dlgEl);
      if (place) { place.textContent = sec ? 'Place in ' + sec.name : 'Place'; place.disabled = !sec; }
      if (hadFocus) { const b = $('[data-ladder-rung="' + L.rung + '"]', host); if (b) b.focus({ preventScroll: true }); }
    };
    const pick = (rung) => {
      const L = app.ui.ladder;
      if (!L || !enabled().includes(rung)) return;
      if (L.rung === rung && app.isPlaying('ladder')) stop();
      else {
        L.rung = rung;
        if (app.isPlaying('ladder')) refreshPlayback();
        else play('ladder');
      }
      render();
      syncPlayState();
    };
    const res = await D.dialog({
      title: 'Ladder · ' + idea.name,
      wide: true,
      body: '<div class="ladder" id="ladder"></div>',
      onOpen: (el) => {
        dlgEl = el;
        host = $('#ladder', el);
        render();
        host.addEventListener('click', (e) => {
          const r = e.target.closest('[data-ladder-rung]');
          if (r && !r.disabled) { pick(r.dataset.ladderRung); return; }
          const v = e.target.closest('[data-ladder-voice]');
          if (v) {
            const i = Number(v.dataset.ladderVoice);
            const cur = app.ideaMute(idea.id);
            let next = cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i);
            if (next.length >= idea.voices.length) next = [];
            app.ui.ideaMute[idea.id] = next;
            render();
            paint(['shelf']);
            if (app.isPlaying('ladder')) refreshPlayback();
          }
        });
        host.addEventListener('change', (e) => {
          const t = e.target.closest('[data-ladder-target]');
          if (!t) return;
          app.ui.ladder.target = t.value;
          if (!enabled().includes(app.ui.ladder.rung)) app.ui.ladder.rung = 'sound';
          render();
          if (app.isPlaying('ladder')) refreshPlayback();
        });
      },
      onKey: (e) => {
        if (e.target && e.target.tagName === 'SELECT') return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const list = enabled();
          const at = list.indexOf(app.ui.ladder.rung);
          const next = list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
          if (next && next !== app.ui.ladder.rung) {
            app.ui.ladder.rung = next;
            if (app.isPlaying('ladder')) refreshPlayback();
            render();
            syncPlayState();
          }
          return true;
        }
        if (e.key === ' ') {
          if (app.isPlaying('ladder')) stop(); else play('ladder');
          render();
          return true;
        }
        return false;
      },
      actions: [
        { label: 'Place', value: 'place' },
        { label: 'Done', primary: true, value: null },
      ],
    });
    const target = app.ui.ladder && app.ui.ladder.target;
    if (app.isPlaying('ladder')) stop();
    app.ui.ladder = null;
    if (res === 'place' && target) {
      const sec = M.findSection(app.session(), target);
      if (sec) placeIdea(idea, sec);
    }
  }

  /**
   * Who leads: how the parts of a section fit to each other (Odd.relate).
   * app.ui.fit = { sectionId } while the dialog is open. Sections step in song
   * order (each once), then any the song doesn't play.
   */
  app.fitOrder = () => {
    const s = app.session();
    const out = [];
    for (const id of s.arrangement) {
      const sec = M.findSection(s, id);
      if (sec && !out.includes(sec)) out.push(sec);
    }
    for (const sec of s.sections) if (!out.includes(sec)) out.push(sec);
    return out;
  };

  async function fitDialog(sectionId) {
    const s = app.session();
    if (!Odd.relate || !M.findSection(s, sectionId)) return;
    app.ui.fit = { sectionId };
    let host = null, dlgEl = null;
    const render = () => {
      if (!host || !app.ui.fit) return;
      const sec = M.findSection(app.session(), app.ui.fit.sectionId);
      // keep focus on the same control across the redraw
      const f = document.activeElement;
      let again = null;
      if (f && host.contains(f)) {
        if (f.dataset.fitStep) again = '[data-fit-step="' + f.dataset.fitStep + '"]';
        else if (f.matches('[data-fit-section]')) again = '[data-fit-section]';
        else if (f.dataset.fitPick) again = '[data-fit-pick="' + f.dataset.fitPick + '"]';
        else if (f.dataset.act) again = '[data-act="' + f.dataset.act + '"]' + (f.dataset.lane ? '[data-lane="' + f.dataset.lane + '"]' : '');
      }
      host.innerHTML = Odd.views.fit(app).html;
      const back = again && ($(again, host) || $('[data-act="play-section"]', host));
      if (back && !back.disabled) back.focus({ preventScroll: true });
      const t = $('#dlg-title', dlgEl);
      if (t && sec) t.textContent = 'Who leads · ' + sec.name;
      syncPlayState();
    };
    const go = (id) => {
      const L = app.ui.fit;
      if (!L || !id || id === L.sectionId) return;
      const was = app.isPlaying('section', L.sectionId);
      L.sectionId = id;
      app.ui.sectionId = id;
      render();
      paint(['song']);
      if (was) play('section', id);
    };
    const step = (dir) => {
      const order = app.fitOrder();
      const at = order.findIndex((x) => x.id === app.ui.fit.sectionId);
      const next = order[at + dir];
      if (next) go(next.id);
    };
    await D.dialog({
      title: 'Who leads · ' + M.findSection(s, sectionId).name,
      wide: true,
      body: '<div class="fit" id="fit"></div>',
      onOpen: (el) => {
        dlgEl = el;
        host = $('#fit', el);
        render();
        // start on the play button: keys typed into the section list belong to it
        setTimeout(() => { const p = $('[data-act="play-section"]', host); if (p) p.focus({ preventScroll: true }); }, 0);
        host.addEventListener('click', (e) => {
          const st = e.target.closest('[data-fit-step]');
          if (st && !st.disabled) { step(Number(st.dataset.fitStep)); return; }
          const pk = e.target.closest('[data-fit-pick]');
          if (pk) { go(pk.dataset.fitPick); return; }
          // muting runs in the page's own click handler, after this one
          if (e.target.closest('[data-act="lane-mute"], [data-act="lane-solo"], [data-act="lead-toggle"]')) setTimeout(render, 0);
        });
        host.addEventListener('change', (e) => {
          const t = e.target.closest('[data-fit-section]');
          if (t) go(t.value);
        });
      },
      onKey: (e) => {
        if (e.target && e.target.tagName === 'SELECT') return false;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { step(e.key === 'ArrowLeft' ? -1 : 1); return true; }
        if (e.key === ' ') {
          const id = app.ui.fit.sectionId;
          if (app.isPlaying('section', id)) stop(); else play('section', id);
          return true;
        }
        return false;
      },
      actions: [{ label: 'Done', primary: true, value: null }],
    });
    app.ui.fit = null;
  }

  let currentSeq = null;

  async function play(kind, id, opts) {
    const seq = buildSeq(kind, id);
    if (!seq) {
      if (kind === 'song') D.toast('The song order is empty. Add a section to it first.');
      return;
    }
    if (!Odd.transport) { D.toast('Audio is not available in this browser.', { kind: 'warn' }); return; }
    if (Odd.transport.playing) Odd.transport.stop();
    app.ui.playing = { kind, id: id == null ? null : id };
    app.ui.lastPlay = { kind, id: id == null ? null : id };
    currentSeq = seq;
    syncPlayState();
    try {
      await Odd.transport.play(seq, { startTick: (opts && opts.startTick) || 0 });
    } catch (e) {
      app.ui.playing = null;
      syncPlayState();
      D.toast('Audio could not start: ' + (e && e.message ? e.message : e), { kind: 'warn' });
    }
  }

  /**
   * The audio clock stopped while we were playing: the browser suspended audio
   * or the device fell behind. Say so (instead of showing "playing" over
   * silence) and offer a restart, which needs a tap on phones. On a device
   * that was on full quality, switch to light first.
   */
  function onStall() {
    const was = app.ui.playing;
    const at = Odd.transport.position();
    app.ui.playing = null;
    currentSeq = null;
    syncPlayState();
    if (Odd.audio.restart) Odd.audio.restart();
    let msg = 'Sound stopped: this device paused the audio or fell behind.';
    if (Odd.audio.quality === 'full' && Odd.audio.setQuality) {
      Odd.audio.setQuality('light');
      app.ws.prefs.quality = 'light';
      persist();
      paint(['top']);
      msg += ' Switched to Light sound, which needs less processing.';
    }
    D.toast(msg, {
      kind: 'warn',
      duration: 15000,
      action: was ? { label: 'Play again', run: () => play(was.kind, was.id, { startTick: was.kind === 'song' ? at : 0 }) } : null,
    });
  }

  function stop() {
    if (Odd.transport) Odd.transport.stop();
    app.ui.playing = null;
    currentSeq = null;
    syncPlayState();
  }

  function toggle(kind, id) {
    if (app.isPlaying(kind, id == null ? null : id) && (Odd.transport && Odd.transport.playing)) stop();
    else play(kind, id);
  }

  function refreshPlayback() {
    const p = app.ui.playing;
    if (!p || !Odd.transport || !Odd.transport.playing) return;
    const seq = buildSeq(p.kind, p.id);
    if (!seq) { stop(); return; }
    currentSeq = seq;
    Odd.transport.update(seq);
  }

  /** after the take changes: hear it from bar 1 (unless something else is playing) */
  function autoPlayBooth() {
    if (app.isPlaying('booth') || (!app.ui.playing && app.ws.prefs.autoplay !== false)) play('booth');
  }

  function syncPlayState() {
    const p = app.ui.playing;
    const keys = p ? [p.kind, p.kind + ':' + p.id] : [];
    for (const el of $$('[data-play-key]')) el.classList.toggle('is-playing', keys.includes(el.dataset.playKey));
    const onair = $('#onair');
    if (onair) {
      let text = 'Stopped';
      if (p) {
        const s = app.session();
        if (p.kind === 'booth') {
          const t = app.currentTake();
          text = 'Booth' + (t ? ' · Take ' + String(t.take || 1).padStart(3, '0') : '');
        } else if (p.kind === 'preview') {
          const part = M.findPart(app.ws, p.id);
          text = 'Shelf · ' + (part ? part.name : '');
        } else if (p.kind === 'ladder') {
          const r = app.ui.ladder && Odd.idea.RUNGS.find((x) => x.id === app.ui.ladder.rung);
          text = 'Ladder · ' + (r ? r.label : '');
        } else if (p.kind === 'bones' || p.kind === 'idea') {
          const idea = M.findIdea(app.ws, p.id);
          text = 'Idea · ' + (idea ? idea.name : '') + (p.kind === 'bones' ? ' (bones)' : '');
        } else if (p.kind === 'section') {
          const sec = M.findSection(s, p.id);
          text = 'Loop · ' + (sec ? sec.name : '');
        } else text = 'Song';
      }
      onair.classList.toggle('is-live', !!p);
      $('.onair-text', onair).textContent = text;
    }
    document.body.classList.toggle('is-playing', !!p);
  }

  // live visuals: playheads, lane lights, meter.
  // Element lists are cached per paint and styles are written only when they
  // change: on a phone the main thread also has to keep the audio scheduler fed.
  let meterBuf = null;
  let live = null; // cached element lists, rebuilt after each paint
  let idle = false; // visuals already reset to "stopped"
  let lastFrame = 0;
  function liveEls() {
    if (!live) {
      live = {
        arr: $$('[data-arr-progress]'),
        cols: $$('[data-section-col]'),
        leds: $$('[data-led]'),
        head: $('#booth-head'),
        meter: $('#meter'),
      };
    }
    return live;
  }

  function setStyle(el, prop, value) {
    if (el['_' + prop] === value) return;
    el['_' + prop] = value;
    el.style.setProperty(prop, value);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    // 30 fps is plenty for meters and playheads, and halves the work on 60-120 Hz phone screens
    if (Odd.audio && Odd.audio.quality === 'light' && now - lastFrame < 32) return;
    lastFrame = now;
    const tr = Odd.transport;
    const p = app.ui.playing;
    const pos = tr && tr.playing && p ? tr.position() : null;
    const els = liveEls();
    const busy = pos != null;
    if (!busy && idle) { meterFrame(els, true); return; }
    idle = !busy;

    if (els.head) {
      const take = app.currentTake();
      if (p && p.kind === 'booth' && pos != null && take) {
        Odd.roll.head(els.head, pos % (take.bars * T.BAR), take.bars * T.BAR, { drums: T.isDrumRole(take.role) });
        els.head.dataset.on = '1';
      } else if (els.head.dataset.on) {
        Odd.roll.head(els.head, null);
        delete els.head.dataset.on;
      }
    }

    // song + section progress
    let liveSection = null;
    let liveArr = -1;
    let frac = 0;
    if (pos != null && p.kind === 'song' && currentSeq && currentSeq.markers) {
      const m = currentSeq.markers.find((x) => pos >= x.start && pos < x.end);
      if (m) { liveSection = m.sectionId; liveArr = m.index; frac = (pos - m.start) / (m.end - m.start); }
    } else if (pos != null && p.kind === 'section') {
      liveSection = p.id;
    }
    for (const el of els.arr) {
      const i = Number(el.dataset.arrProgress);
      setStyle(el, 'transform', 'scaleX(' + (i === liveArr ? frac.toFixed(3) : 0) + ')');
    }
    for (const el of els.cols) el.classList.toggle('is-live', el.dataset.sectionCol === liveSection);

    // lane lights
    if (tr && tr.lastHit && Odd.audio && Odd.audio.ctx) {
      const t = Odd.audio.now();
      for (const el of els.leds) {
        const hit = busy ? tr.lastHit(el.dataset.led) : null;
        let level = 0;
        if (hit) {
          const age = t - hit.time;
          level = age >= 0 ? Math.max(0, 1 - age / 0.28) * (0.5 + 0.5 * hit.v / 127) : 0;
        }
        setStyle(el, '--lit', level.toFixed(2));
      }
    }
    meterFrame(els, false);
  }

  function meterFrame(els, quiet) {
    const meter = els.meter;
    if (!meter || !Odd.audio || !Odd.audio.analyser || !meter.clientWidth) return;
    if (quiet && meterPeak < 0.002) return; // stopped and already drawn empty
    const an = Odd.audio.analyser;
    if (!meterBuf || meterBuf.length !== an.fftSize) meterBuf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(meterBuf);
    let peak = 0;
    for (let i = 0; i < meterBuf.length; i++) peak = Math.max(peak, Math.abs(meterBuf[i]));
    drawMeter(meter, peak);
  }

  let meterPeak = 0;
  let meterColors = null;
  function drawMeter(c, peak) {
    meterPeak = Math.max(peak, meterPeak * 0.92);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!meterColors) {
      const cs = getComputedStyle(document.documentElement);
      meterColors = { hot: cs.getPropertyValue('--tally'), on: cs.getPropertyValue('--keep'), off: cs.getPropertyValue('--line') };
    }
    const segs = 16;
    const gap = Math.max(1, dpr);
    const sw = (w - gap * (segs - 1)) / segs;
    const lit = Math.round(Math.min(1, meterPeak * 1.15) * segs);
    for (let i = 0; i < segs; i++) {
      const hot = i >= segs - 2;
      ctx.fillStyle = i < lit ? (hot ? meterColors.hot : meterColors.on) : meterColors.off;
      ctx.fillRect(i * (sw + gap), 0, sw, h);
    }
  }

  // ======================= booth =======================
  function genTake(opts) {
    const o = opts || {};
    const s = app.session();
    const b = app.ui.booth;
    const sec = app.selectedSection();
    const role = b.role;
    const params = Object.assign({}, Odd.gen.defaults(role), (app.ws.prefs.params || {})[role] || {});
    const seed = o.seed != null ? o.seed : Odd.rng.newSeed();
    const part = Odd.gen.generate({
      role, style: s.style, seed, bars: b.bars,
      tonic: T.mod(s.tonic + (sec.transpose || 0), 12), scale: s.scale,
      prog: T.sliceProg(sec.prog, 0, b.bars * T.BAR), params,
      band: app.boothBand(),
    });
    const kept = withLocks(part);
    kept.id = M.uid('p');
    addTake(kept, o.replace);
    return kept;
  }

  /** a new take keeps the current take's locked bars, if any */
  function withLocks(part) {
    const b = app.ui.booth;
    if (!b.locks || !b.locks.length) return part;
    const cur = app.currentTake();
    const merged = cur && cur.role === part.role ? Odd.edit.splice(cur, part, b.locks) : null;
    if (merged) {
      merged.parent = cur.id;
      return merged;
    }
    // the bars can't be kept (another length or other chords): start over
    b.locks = [];
    D.toast('Kept bars were let go: the new take has a different length or chords.');
    return part;
  }

  /** replace the current take with an edited copy (a new id, so Keep stores the edit) */
  function setEditedTake(part, opts) {
    const tk = app.takesFor(part.role);
    const cur = tk.list[tk.index];
    if (!cur) return;
    part.take = cur.take;
    if (!cur.edited || M.findPart(app.ws, cur.id)) {
      part.parent = cur.id;
      part.id = M.uid('p');
    }
    part.edited = true;
    tk.list[tk.index] = part;
    if (!(opts && opts.quiet)) {
      paint(['booth']);
      if (app.isPlaying('booth')) refreshPlayback();
    }
  }

  function addTake(part, replace) {
    const b = app.ui.booth;
    const tk = app.takesFor(part.role);
    if (replace && tk.index >= 0) {
      part.take = tk.list[tk.index].take;
      tk.list[tk.index] = part;
    } else {
      part.take = ++b.takeNo;
      tk.list.push(part);
      while (tk.list.length > 60) tk.list.shift();
      tk.index = tk.list.length - 1;
    }
  }

  function newTake() {
    genTake();
    paint(['booth']);
    autoPlayBooth();
  }

  function vary() {
    const cur = app.currentTake();
    if (!cur) return newTake();
    const band = cur.bars === app.ui.booth.bars ? app.boothBand() : null;
    const v = withLocks(Odd.gen.vary(cur, { seed: Odd.rng.newSeed(), amount: 0.35, band }));
    v.id = M.uid('p');
    v.parent = cur.id;
    addTake(v);
    paint(['booth']);
    autoPlayBooth();
  }

  /** re-roll the current take with the same seed (after a control changes) */
  function rerollTake() {
    const cur = app.currentTake();
    if (cur && !cur.imported) genTake({ seed: cur.seed, replace: true });
    else genTake();
    paint(['booth']);
    if (app.isPlaying('booth')) refreshPlayback();
  }

  function keep(place) {
    const cur = app.currentTake();
    if (!cur) return;
    const s = app.session();
    const sec = app.selectedSection();
    const already = M.findPart(app.ws, cur.id);
    if (already && !place) { D.toast('“' + cur.name + '” is already on the shelf.'); return; }
    let laneName = '';
    const from = snapshotTake();
    commit(place ? 'Keep and place' : 'Keep', () => {
      const stored = M.addToLibrary(app.ws, cur);
      if (place) {
        let lane = app.boothLane();
        if (!lane) lane = M.addLane(s, cur.role);
        M.placePart(s, sec.id, lane.id, stored);
        app.ui.laneId = lane.id;
        laneName = lane.name;
      }
    });
    flashKeep();
    // the take stays in the booth; a copy of it flies to where it went
    flyTake(from, place ? keepTargetCell(sec.id, app.ui.laneId) : keepTargetShelf(cur.id));
    if (place) D.toast('Placed “' + cur.name + '” in ' + sec.name + ' › ' + laneName, { action: { label: 'Undo', run: undo } });
    else D.toast('Kept “' + cur.name + '” on the shelf', { action: { label: 'Undo', run: undo } });
  }

  /** the booth's piano roll as an image, with where it sits on screen */
  function snapshotTake() {
    const screen = $('.booth .screen');
    const canvas = screen && $('canvas.roll-base', screen);
    if (!screen || !canvas) return null;
    const rect = screen.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    let src = null;
    try { src = canvas.toDataURL(); } catch (e) { /* draw nothing then */ }
    return { rect, src, role: app.ui.booth.role };
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }

  /** the new shelf card, or the shelf heading, or (phones) the Shelf tab */
  function keepTargetShelf(partId) {
    const card = $('.shelf .card[data-part="' + partId + '"]');
    if (visible(card)) return { el: card, land: card, hide: true }; // the copy becomes the card
    const title = $('.shelf .panel-title');
    if (visible(title)) return { el: title, land: card || title };
    const tab = $('[data-act="tab"][data-tab="shelf"]');
    return visible(tab) ? { el: tab, land: tab } : null;
  }

  function keepTargetCell(sectionId, laneId) {
    const cell = $('.cell[data-section="' + sectionId + '"][data-lane="' + laneId + '"]');
    if (visible(cell)) return { el: cell, land: cell };
    const tab = $('[data-act="tab"][data-tab="song"]');
    return visible(tab) ? { el: tab, land: tab } : null;
  }

  function landed(el) {
    if (!el) return;
    el.classList.remove('just-kept');
    void el.offsetWidth;
    el.classList.add('just-kept');
    setTimeout(() => el.classList.remove('just-kept'), 900);
  }

  function flyTake(from, to) {
    if (!to) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!from || reduce || !document.body.animate) { landed(to.land); return; }
    const end = to.el.getBoundingClientRect();
    const a = from.rect;
    const fly = document.createElement('div');
    fly.className = 'take-fly';
    fly.dataset.role = from.role;
    fly.setAttribute('aria-hidden', 'true');
    if (from.src) {
      const img = document.createElement('img');
      img.src = from.src;
      img.alt = '';
      fly.appendChild(img);
    }
    Object.assign(fly.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
    document.body.appendChild(fly);
    // land centred on the target, scaled to its width (or a small chip for tiny targets)
    const scale = Math.max(0.12, Math.min(1, end.width / a.width));
    const dx = end.left + end.width / 2 - (a.left + a.width / 2);
    const dy = end.top + end.height / 2 - (a.top + a.height / 2);
    const lift = Math.min(80, Math.abs(dx) * 0.15 + 30);
    const hidden = to.hide ? to.el : null;
    if (hidden) hidden.style.visibility = 'hidden';
    const anim = fly.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: 'translate(0, -6px) scale(0.92)', opacity: 1, offset: 0.18 },
      { transform: 'translate(' + dx * 0.55 + 'px, ' + (dy * 0.55 - lift) + 'px) scale(' + (0.92 + scale) / 2 + ')', opacity: 1, offset: 0.6 },
      { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')', opacity: 0.85 },
    ], { duration: 620, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' });
    const done = () => {
      fly.remove();
      if (hidden) hidden.style.visibility = '';
      landed(to.land);
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  function flashKeep() {
    const area = $('.take-area');
    if (!area) return;
    area.classList.remove('flash');
    void area.offsetWidth;
    area.classList.add('flash');
  }

  function setRole(role, opts) {
    const b = app.ui.booth;
    if (!Odd.gen.ROLES.includes(role)) return;
    if (b.role !== role) b.locks = [];
    b.role = role;
    const s = app.session();
    const lane = M.findLane(s, app.ui.laneId);
    if (!lane || lane.role !== role) {
      const l = M.laneForRole(s, role);
      app.ui.laneId = l ? l.id : null;
    }
    if (!app.takesFor(role).list.length) genTake();
    savePrefs();
    paint((opts && opts.views) || ['booth', 'song']);
    if (app.isPlaying('booth')) refreshPlayback();
  }

  function stepTake(dir) {
    const tk = app.takesFor(app.ui.booth.role);
    const n = tk.index + dir;
    if (n >= tk.list.length) { newTake(); return; }
    if (n < 0) return;
    tk.index = n;
    paint(['booth']);
    autoPlayBooth();
  }

  function loadIntoBooth(part, andVary) {
    app.ui.booth.role = part.role;
    const copy = M.clone(part);
    addTake(copy);
    savePrefs();
    if (andVary) vary();
    else { paint(['booth', 'song']); autoPlayBooth(); }
    goTab('booth');
  }

  // ======================= shelf helpers =======================
  function placeFromShelf(part, sectionId, laneId) {
    const s = app.session();
    const sec = M.findSection(s, sectionId) || app.selectedSection();
    let laneName = '';
    commit('Place part', () => {
      let lane = laneId ? M.findLane(s, laneId) : null;
      if (!lane) {
        const sel = M.findLane(s, app.ui.laneId);
        lane = sel && sel.role === part.role ? sel : M.laneForRole(s, part.role);
      }
      if (!lane) lane = M.addLane(s, part.role);
      M.placePart(s, sec.id, lane.id, part);
      app.ui.sectionId = sec.id;
      app.ui.laneId = lane.id;
      laneName = lane.name;
    });
    D.toast('Placed “' + part.name + '” in ' + sec.name + ' › ' + laneName, { action: { label: 'Undo', run: undo } });
  }

  function partMenu(anchor, part) {
    D.menu(anchor, [
      { label: 'Rename…', run: async () => {
        const name = await D.prompt('Rename part', 'Name', part.name);
        if (name) commit('Rename part', () => { part.name = name; }, ['booth', 'shelf']);
      } },
      { label: 'Open in the booth', run: () => loadIntoBooth(part) },
      { label: 'Make a variation in the booth', run: () => loadIntoBooth(part, true) },
      { label: 'Capture as an idea', run: () => captureIdea([{ part, sourceId: part.id }], { from: 'shelf' }) },
      { label: 'Download MIDI', run: () => downloadPart(part) },
      '-',
      { label: 'Remove from shelf', kind: 'danger', run: () => {
        const used = M.usageCount(app.ws, part.id);
        commit('Remove part', (s, ws) => M.removeFromLibrary(ws, part.id), ['shelf', 'booth', 'tabs']);
        D.toast('Removed “' + part.name + '”' + (used ? '. Copies in the song stay.' : ''), { action: { label: 'Undo', run: undo } });
      } },
    ], { align: 'right' });
  }

  function downloadPart(part) {
    const s = app.session();
    const bytes = Odd.exporter.partMidi(part, s, laneForPart(part));
    D.download(Odd.exporter.safeName(part.name) + '.mid', bytes, 'audio/midi');
  }

  // ======================= song helpers =======================
  function selectCell(sectionId, laneId) {
    const s = app.session();
    const lane = M.findLane(s, laneId);
    app.ui.sectionId = sectionId;
    app.ui.laneId = laneId;
    if (lane && lane.role !== app.ui.booth.role) {
      app.ui.booth.role = lane.role;
      if (!app.takesFor(lane.role).list.length) genTake();
    }
    paint(['booth', 'shelf', 'song']);
    if (app.isPlaying('booth') || app.isPlaying('preview')) refreshPlayback();
  }

  function swapSlot(dir) {
    const s = app.session();
    const { section, lane } = app.selectedSlot();
    if (!lane) return;
    const candidates = app.ws.library.filter((p) => p.role === lane.role).sort((a, b) => b.created - a.created);
    if (!candidates.length) {
      app.ui.shelf.role = lane.role;
      D.toast('No ' + Odd.views.roleLabel(lane.role).toLowerCase() + ' parts on the shelf yet. Keep one in the booth first.');
      paint(['shelf']);
      return;
    }
    const slot = section.slots[lane.id];
    let i = slot ? candidates.findIndex((p) => p.id === slot.sourceId) : -1;
    i = i < 0 ? (dir > 0 ? 0 : candidates.length - 1) : T.mod(i + dir, candidates.length);
    const next = candidates[i];
    commit('Swap part', () => { M.placePart(s, section.id, lane.id, next); }, ['song', 'shelf']);
  }

  function auditionCell() {
    const { lane } = app.selectedSlot();
    if (lane) app.ui.booth.role = lane.role;
    if (!app.takesFor(app.ui.booth.role).list.length) genTake();
    savePrefs();
    paint(['booth', 'song']);
    goTab('booth');
    if (window.innerWidth > 900 && roots.booth) roots.booth.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    autoPlayBooth();
  }

  async function editChords(section) {
    const s = app.session();
    const current = Odd.views.chordText(s, section);
    const tonic = T.mod(s.tonic + (section.transpose || 0), 12);
    const parse = (text) => T.parseProg(text, section.bars, s.scale);
    const preview = (text) => {
      const prog = parse(text);
      if (!prog) return '<span class="bad">Use roman numerals such as i VI III VII</span>';
      return Odd.views.mergeProg(prog).map((c) => esc(T.chordName(c, tonic, s.scale)) + '<small>' + c.beats + '</small>').join(' ');
    };
    const m = (x) => '<span class="mono">' + x + '</span>';
    const H = Odd.harmonise;
    const leader = H && H.leaderOf(section) ? M.findLane(s, H.leaderOf(section)) : null;
    const result = await D.dialog({
      title: 'Chords for ' + section.name,
      body:
        (leader ? '<p class="help lead-note">' + Odd.icon('tune', 'ico-xs') + ' These chords are worked out from ' + esc(leader.name) + '\'s tune. Writing your own hands the lead back to the chords; ' + esc(leader.name) + ' keeps its notes as written.</p>' : '') +
        '<label class="field"><span>Chords (' + section.bars + ' bars, ' + esc(Odd.views.keyName(s, section)) + ')</span>' +
        '<input type="text" id="dlg-chords" class="mono" value="' + esc(current) + '" autocomplete="off" spellcheck="false"></label>' +
        '<p class="chord-preview mono" id="dlg-chord-preview">' + preview(current) + '</p>' +
        '<p class="help">Roman numerals count up the scale from the key. Capitals are major chords and small letters minor, so in a minor key ' + m('V') + ' is the major dominant and ' + m('v') + ' the minor one. Chords share the bars evenly; add ' + m(':beats') + ' to set a length, for example ' + m('i:8 VI:4 VII:4') + '.</p>' +
        '<p class="help">Chords from outside the key: ' + m('bVI') + ' ' + m('bVII') + ' ' + m('iv') + ' (borrowed), ' + m('V/V') + ' ' + m('V7/ii') + ' ' + m('vii°/vi') + ' (secondary), ' + m('N') + ' (Neapolitan), ' + m('bII7') + ' (tritone sub). Add ' + m('7') + ' or ' + m('maj7') + ' to make a part always play the seventh.</p>',
      onOpen: (el) => {
        const inp = $('#dlg-chords', el);
        inp.addEventListener('input', () => { $('#dlg-chord-preview', el).innerHTML = preview(inp.value); });
      },
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, validate: (el) => !!parse($('#dlg-chords', el).value), value: (el) => $('#dlg-chords', el).value },
      ],
    });
    if (result == null) return;
    const prog = parse(result);
    if (prog) commit('Edit chords', () => { if (leader) H.release(s, section, { keep: true }); section.prog = prog; });
  }

  // ======================= melody first =======================
  /** chords as shown, for a progression the section might get */
  function progShown(s, section, prog) {
    return Odd.views.chordShown(app, s, Object.assign({}, section, { prog }));
  }

  /** let a lane's tune set a section's chords, or hand them back to the chords */
  function toggleLead(section, laneId) {
    const H = Odd.harmonise;
    const s = app.session();
    const lane = M.findLane(s, laneId);
    if (!H || !section || !lane) return;
    if (H.leaderOf(section) === laneId) {
      commit('Chords lead again', () => { H.release(s, section); });
      D.toast('The chords lead ' + section.name + ' again: ' + Odd.views.chordShown(app, s, section), { action: { label: 'Undo', run: undo } });
      return;
    }
    if (!H.canLead(s, section, laneId)) { D.toast('Only a pitched part in this section can set its chords.'); return; }
    commit(lane.name + ' sets the chords', () => { H.lead(s, section, laneId); });
    D.toast(lane.name + ' sets the chords of ' + section.name + ': ' + Odd.views.chordShown(app, s, section), { action: { label: 'Undo', run: undo } });
  }

  /** another good set of chords for the tune that leads */
  function varyLead(section, dir) {
    const H = Odd.harmonise;
    if (!H || !H.leaderOf(section)) return;
    const s = app.session();
    commit('Other chords for the tune', () => { H.vary(s, section, dir || 1); });
  }

  /** pick which part's tune sets the chords */
  async function tuneDialog(section) {
    const H = Odd.harmonise;
    const s = app.session();
    const lanes = s.lanes.filter((l) => H.canLead(s, section, l.id));
    if (!lanes.length) { D.toast('Put a melody or another pitched part in ' + section.name + ' first.'); return; }
    if (lanes.length === 1) { toggleLead(section, lanes[0].id); return; }
    const fit = Odd.relate ? Odd.relate.forSection(s, section) : null;
    const rank = (l) => (l.role === 'lead' ? 3 : 0) + (fit && fit.top === l.id ? 2 : 0) + (l.role === 'arp' ? 1 : 0);
    const pick = lanes.slice().sort((a, b) => rank(b) - rank(a))[0];
    const rows = lanes.map((l) => {
      const r = H.forSection(s, section, l.id, { variant: 0 });
      const pct = r.fit != null ? Math.round(r.fit * 100) + '% of its notes are chord tones' : 'it rests throughout';
      return '<label class="type-opt" data-role="' + l.role + '"><input type="radio" name="dlg-tune" value="' + l.id + '"' + (l === pick ? ' checked' : '') + '>' +
        '<span><strong>' + esc(l.name) + ' · ' + esc(section.slots[l.id].part.name) + '</strong>' +
        '<small class="mono">' + esc(progShown(s, section, r.prog)) + '</small><small>' + esc(pct) + '</small></span></label>';
    }).join('');
    const v = await D.dialog({
      title: 'Which tune sets the chords of ' + section.name + '?',
      body: '<div class="tune-opts">' + rows + '</div>' +
        '<p class="help">The part you pick plays as written, and the section\'s chords are worked out from its notes. Every other part that fits to the chords follows them, so this part leads. Change the tune later and the chords follow it.</p>',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Let it lead', primary: true, value: (el) => { const c = $('input[name="dlg-tune"]:checked', el); return c ? c.value : null; } },
      ],
    });
    if (v) toggleLead(section, v);
  }

  async function shapeDialog(section) {
    const S = Odd.shape;
    const s = app.session();
    const guess = S.autoEnergy(section.name);
    const auto = S.isAuto(section);
    const energy = S.energyOf(section);
    const entry = S.entryOf(section);
    const pct = (x) => Math.round(x * 100) + '%';
    const entryOpts = ['auto'].concat(S.ENTRIES).map((k) => '<option value="' + k + '"' + (k === entry ? ' selected' : '') + '>' + esc(S.ENTRY_LABELS[k]) + '</option>').join('');
    const exit = S.ENTRIES.includes(section.exit) ? section.exit : 'auto';
    const exitOpts = ['auto'].concat(S.ENTRIES).map((k) => '<option value="' + k + '"' + (k === exit ? ' selected' : '') + '>' + esc(k === 'auto' ? 'Let the next section decide' : S.ENTRY_LABELS[k]) + '</option>').join('');
    const curve = S.CURVES.includes(section.curve) ? section.curve : 'flat';
    const curveOpts = S.CURVES.map((k) => '<option value="' + k + '"' + (k === curve ? ' selected' : '') + '>' + esc(S.CURVE_LABELS[k]) + '</option>').join('');
    const result = await D.dialog({
      title: 'Energy and entry for ' + section.name,
      body:
        '<label class="field"><span>Energy <output id="dlg-e-out">' + pct(energy) + '</output></span>' +
        '<input type="range" id="dlg-energy" min="0" max="1" step="0.05" value="' + energy + '"></label>' +
        '<label class="toggle"><input type="checkbox" id="dlg-e-auto"' + (auto ? ' checked' : '') + '><span>Guess from the name (' + esc(section.name) + ': ' + pct(guess) + ')</span></label>' +
        '<label class="field"><span>Across the section</span><select id="dlg-curve">' + curveOpts + '</select></label>' +
        '<label class="field"><span>Entry</span><select id="dlg-entry">' + entryOpts + '</select></label>' +
        '<label class="field"><span>Into the next section</span><select id="dlg-exit">' + exitOpts + '</select></label>' +
        '<p class="help">At 50% parts play as written. Lower thins and softens them, higher plays harder, and above 80% the lead doubles an octave up. A section played again later in the song gets a little more energy each time.</p>' +
        '<p class="help">Across the section: Rise starts lower and climbs to this energy by the last bar, Fall away starts here and drains, Swell goes up and back down, Dip drops in the middle.</p>' +
        '<p class="help">Entry is how the song gets into this section: straight in, a drum fill, a snare build over the last bars before it, or a build then a beat of silence. Auto picks from the jump in energy, unless the section before says how to leave it (Into the next section).</p>' +
        (S.settings(s).on ? '' : '<p class="help help-warn">Shape is off for this session (session settings), so these have no effect until you turn it on.</p>'),
      onOpen: (el) => {
        const r = $('#dlg-energy', el);
        const box = $('#dlg-e-auto', el);
        const out = $('#dlg-e-out', el);
        r.addEventListener('input', () => { box.checked = false; out.textContent = pct(Number(r.value)); });
        box.addEventListener('change', () => { if (box.checked) { r.value = guess; out.textContent = pct(guess); } });
      },
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, value: (el) => ({
          energy: $('#dlg-e-auto', el).checked ? null : Number($('#dlg-energy', el).value),
          entry: $('#dlg-entry', el).value,
          exit: $('#dlg-exit', el).value,
          curve: $('#dlg-curve', el).value,
        }) },
      ],
    });
    if (!result) return;
    commit('Change section shape', () => {
      section.energy = result.energy;
      section.entry = result.entry;
      section.exit = result.exit;
      section.curve = result.curve;
    }, ['song']);
  }

  async function typeDialog(section) {
    const s = app.session();
    const RC = Odd.recipes;
    const groups = RC.forSection(section);
    const option = (r) => '<label class="type-opt"><input type="radio" name="dlg-type" value="' + r.id + '"' + (section.recipe === r.id ? ' checked' : '') + '>' +
      '<span><strong>' + esc(r.label) + '</strong>' + (r.bars && section.bars < r.bars ? ' <small class="mono">' + r.bars + ' bars</small>' : '') + '<small>' + esc(r.blurb) + '</small></span></label>';
    const first = groups[0];
    const others = groups.slice(1);
    const current = section.recipe && RC.get(section.recipe);
    const openOthers = current && current.kind !== first.kind;
    const body =
      '<p class="help">A type sets which bars each part plays, how the energy moves, and how the song leaves this section. It changes settings you can still adjust afterwards: the Bars button on a part, and Energy and entry.</p>' +
      '<fieldset class="type-group"><legend>For ' + (/^[aeiou]/i.test(first.label) ? 'an ' : 'a ') + esc(first.label.toLowerCase()) + '</legend>' + first.recipes.map(option).join('') + '</fieldset>' +
      '<details class="type-more"' + (openOthers ? ' open' : '') + '><summary>Other types</summary>' +
        others.map((g) => '<fieldset class="type-group"><legend>' + esc(g.label) + '</legend>' + g.recipes.map(option).join('') + '</fieldset>').join('') +
      '</details>' +
      '<label class="type-opt type-none"><input type="radio" name="dlg-type" value=""' + (section.recipe ? '' : ' checked') + '><span><strong>No type</strong><small>Every part plays the whole section at a steady level.</small></span></label>';
    const id = await D.dialog({
      title: 'Section type for ' + section.name,
      body,
      wide: true,
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, value: (el) => { const r = $('input[name="dlg-type"]:checked', el); return r ? r.value : null; } },
      ],
    });
    if (id == null) return;
    let res = null;
    commit('Section type', () => {
      if (id) res = RC.apply(s, section, id);
      else RC.reset(section);
    }, ['song', 'booth']);
    if (id) {
      const r = RC.get(id);
      let msg = section.name + ': ' + r.label.toLowerCase();
      if (res && res.borrowed.length) msg += '. Borrowed ' + res.borrowed.join(', ') + ' from ' + res.from;
      D.toast(msg, { action: { label: 'Undo', run: undo } });
    }
  }

  async function reuseDialog() {
    const s = app.session();
    const { section, lane } = app.selectedSlot();
    const slot = lane && section.slots[lane.id];
    if (!slot) return;
    const others = s.sections.filter((x) => x.id !== section.id);
    if (!others.length) { D.toast('Add another section first.'); return; }
    // a sensible first guess for each section, from its kind
    const guess = { intro: 'outline', verse: '', pre: 'fragment', chorus: 'full', break: 'half', outro: 'half' };
    const formOpts = (sel) => '<option value="">Not there</option>' + R.FORMS.map((f) => '<option value="' + f + '"' + (f === sel ? ' selected' : '') + '>' + esc(R.FORM_LABELS[f]) + '</option>').join('');
    const rows = others.map((x) => {
      const there = x.slots[lane.id];
      const same = there && there.sourceId && there.sourceId === slot.sourceId;
      const kind = Odd.recipes ? Odd.recipes.kindOf(x.name) : 'verse';
      const sel = same ? there.form || 'full' : '';
      const note = there && !same ? '<small>replaces ' + esc(there.part.name) + '</small>' : '';
      return '<label class="field reuse-row"><span>' + esc(x.name) + ' ' + note + '</span><select data-sec="' + x.id + '" data-guess="' + (guess[kind] || '') + '">' + formOpts(sel) + '</select></label>';
    }).join('');
    const v = await D.dialog({
      title: 'Reuse ' + slot.part.name,
      body:
        '<p class="help">Bring this ' + esc(Odd.views.roleLabel(lane.role).toLowerCase()) + ' back in other sections, so the song sets it up and pays it off: outline or tease it in the intro, loop a fragment in the pre-chorus, play it in full in the chorus, half-time in the outro. Every section follows its own chords.</p>' +
        '<div class="reuse-list">' + rows + '</div>' +
        '<div><button type="button" class="btn btn-ghost btn-sm" id="dlg-reuse-guess">Suggest forms</button></div>',
      onOpen: (el) => {
        $('#dlg-reuse-guess', el).addEventListener('click', () => {
          for (const sel of $$('select[data-sec]', el)) if (!sel.value) sel.value = sel.dataset.guess;
        });
      },
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, value: (el) => {
          const out = {};
          for (const sel of $$('select[data-sec]', el)) out[sel.dataset.sec] = sel.value;
          return out;
        } },
      ],
    });
    if (!v) return;
    let n = 0;
    commit('Reuse part', () => {
      // sections set to "Not there" that held this part lose it
      for (const sid in v) {
        const x = M.findSection(s, sid);
        const there = x && x.slots[lane.id];
        if (!v[sid] && there && there.sourceId && there.sourceId === slot.sourceId) M.clearSlot(s, sid, lane.id);
      }
      n = M.reuseSlot(s, section.id, lane.id, v);
    }, ['song', 'shelf']);
    if (n) D.toast(slot.part.name + ' now plays in ' + (n + 1) + ' sections', { action: { label: 'Undo', run: undo } });
  }

  async function spanDialog() {
    const { section, lane } = app.selectedSlot();
    const slot = lane && section.slots[lane.id];
    if (!slot) return;
    const sp = M.slotSpan(section, slot);
    const bars = section.bars;
    let fromOpts = '', toOpts = '';
    for (let b = 0; b < bars; b++) fromOpts += '<option value="' + b + '"' + (b === Math.min(sp.from, bars - 1) ? ' selected' : '') + '>Bar ' + (b + 1) + '</option>';
    for (let b = 1; b <= bars; b++) toOpts += '<option value="' + b + '"' + (b === (sp.out ? bars : sp.to) ? ' selected' : '') + '>' + (b === bars ? 'The end (bar ' + b + ')' : 'Bar ' + b) + '</option>';
    const v = await D.dialog({
      title: lane.name + ' in ' + section.name,
      body:
        '<div class="field-row">' +
          '<label class="field"><span>Comes in at</span><select id="dlg-from">' + fromOpts + '</select></label>' +
          '<label class="field"><span>Plays until</span><select id="dlg-to">' + toOpts + '</select></label>' +
        '</div>' +
        '<label class="toggle"><input type="checkbox" id="dlg-out"' + (sp.out ? ' checked' : '') + '><span>Sits this section out</span></label>' +
        '<p class="help">A part that comes in late starts from its own first bar. The part stays in the slot when it sits out, so you can bring it back.</p>',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Whole section', value: { from: 0, to: null } },
        { label: 'Apply', primary: true, value: (el) => {
          if ($('#dlg-out', el).checked) return { from: bars, to: bars };
          const f = Number($('#dlg-from', el).value);
          const t = Math.max(f + 1, Number($('#dlg-to', el).value));
          return { from: f, to: t };
        } },
      ],
    });
    if (!v) return;
    commit('Change the bars a part plays', () => { M.setSlotSpan(section, lane.id, v.from, v.to); }, ['song']);
  }

  function sectionMenu(anchor, section) {
    const s = app.session();
    D.menu(anchor, [
      { label: 'Rename…', run: async () => {
        const name = await D.prompt('Rename section', 'Name', section.name);
        if (name) commit('Rename section', () => { section.name = name; });
      } },
      { label: 'Edit chords…', run: () => editChords(section) },
      { label: 'Section type…', run: () => typeDialog(section) },
      { label: 'Energy and entry…', run: () => shapeDialog(section) },
      { label: 'Who leads…', disabled: !Object.keys(section.slots).length, run: () => fitDialog(section.id) },
      { label: 'Capture an idea from this section…', disabled: !Object.keys(section.slots).length, run: () => captureFromSection(section) },
      ...(Odd.harmonise && Odd.harmonise.leaderOf(section)
        ? [
          { label: 'Other chords for the tune', run: () => varyLead(section, 1) },
          { label: 'Chords lead again', run: () => toggleLead(section, Odd.harmonise.leaderOf(section)) },
        ]
        : [
          { label: 'Let a tune set the chords…', disabled: !Odd.harmonise || !s.lanes.some((l) => Odd.harmonise.canLead(s, section, l.id)), run: () => tuneDialog(section) },
          { label: 'New chords', run: () => commit('New chords', () => { section.prog = M.newProgression(s, section.bars); }) },
        ]),
      { label: 'Key up a semitone', run: () => commit('Change section key', () => { section.transpose = Math.min(11, (section.transpose || 0) + 1); }) },
      { label: 'Key down a semitone', run: () => commit('Change section key', () => { section.transpose = Math.max(-11, (section.transpose || 0) - 1); }) },
      { label: 'Reset section key', disabled: !section.transpose, run: () => commit('Change section key', () => { section.transpose = 0; }) },
      '-',
      { label: 'Add to the end of the song', run: () => commit('Add to song', () => { s.arrangement.push(section.id); }, ['song']) },
      { label: 'Duplicate', run: () => commit('Duplicate section', () => { const c = M.duplicateSection(s, section.id); app.ui.sectionId = c.id; }) },
      { label: 'Download section MIDI', run: () => D.download(Odd.exporter.safeName(s.name + ' - ' + section.name) + '.mid', Odd.exporter.sectionMidi(s, section), 'audio/midi') },
      '-',
      { label: 'Delete section', kind: 'danger', disabled: s.sections.length <= 1, run: () => {
        commit('Delete section', () => { M.removeSection(s, section.id); fixSelection(); });
        D.toast('Deleted ' + section.name, { action: { label: 'Undo', run: undo } });
      } },
    ], { align: 'right' });
  }

  function laneMenu(anchor, lane) {
    const s = app.session();
    const used = s.sections.filter((x) => x.slots[lane.id]).length;
    D.menu(anchor, [
      { heading: Odd.views.roleLabel(lane.role) + ' · MIDI channel ' + (lane.channel + 1) },
      { label: 'Rename…', run: async () => {
        const name = await D.prompt('Rename lane', 'Name', lane.name);
        if (name) commit('Rename lane', () => { lane.name = name; }, ['song', 'booth']);
      } },
      { label: 'MIDI channel…', run: () => channelDialog(lane) },
      { label: 'Preview the sound', run: () => Odd.synth && Odd.synth.preview(lane.patch) },
      { label: 'Audition a part for this lane', run: () => { app.ui.laneId = lane.id; auditionCell(); } },
      '-',
      { label: 'Remove lane', kind: 'danger', run: () => {
        commit('Remove lane', () => { M.removeLane(s, lane.id); fixSelection(); });
        D.toast('Removed ' + lane.name + (used ? ' and its ' + used + (used === 1 ? ' part' : ' parts') : ''), { action: { label: 'Undo', run: undo } });
      } },
    ]);
  }

  async function channelDialog(lane) {
    const opts = [];
    for (let c = 0; c < 16; c++) opts.push('<option value="' + c + '"' + (c === lane.channel ? ' selected' : '') + '>' + (c + 1) + (c === 9 ? ' (GM drums)' : '') + '</option>');
    const v = await D.dialog({
      title: 'MIDI channel for ' + lane.name,
      body: '<label class="field"><span>Channel</span><select id="dlg-ch">' + opts.join('') + '</select></label><p class="help">Used for MIDI export and live MIDI output. General MIDI plays channel 10 as drums.</p>',
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: (el) => Number($('#dlg-ch', el).value) }],
    });
    if (v != null) commit('Change MIDI channel', () => { lane.channel = v; }, ['song']);
  }

  // ======================= ideas =======================
  /**
   * Save parts heard together as an idea. sources: [{ part, oct, form,
   * sourceId, label, checked }]. With more than one source (or opts.ask), a
   * dialog asks which belong in the idea.
   */
  async function captureIdea(sources, opts) {
    const o = opts || {};
    const s = app.session();
    let chosen = sources;
    let name = '';
    if (sources.length > 1 || o.ask) {
      const rows = sources.map((src, i) =>
        '<label class="toggle capture-row" data-role="' + src.part.role + '"><input type="checkbox" data-i="' + i + '"' + (src.checked !== false ? ' checked' : '') + '>' +
        '<span><span class="tag" data-role="' + src.part.role + '">' + esc(M.roleInfo(src.part.role).short || src.part.role) + '</span> ' + esc(src.label || src.part.name) + '</span></label>').join('');
      const v = await D.dialog({
        title: o.title || 'Capture an idea',
        body:
          '<p class="help">An idea keeps the rhythm and shape of each part: when the notes fall, which are strong, which way the line moves and where it lands. The parts themselves come along as source material. Pick the parts that belong together; you can split them apart later.</p>' +
          '<div class="capture-list">' + rows + '</div>' +
          '<label class="field"><span>Name</span><input type="text" id="dlg-idea-name" maxlength="80" placeholder="Named after its parts"></label>',
        actions: [
          { label: 'Cancel', value: null },
          { label: 'Capture', primary: true, validate: (el) => $$('input[data-i]:checked', el).length > 0, value: (el) => ({
            picks: $$('input[data-i]:checked', el).map((x) => Number(x.dataset.i)),
            name: $('#dlg-idea-name', el).value.trim(),
          }) },
        ],
      });
      if (!v) return null;
      chosen = v.picks.map((i) => sources[i]);
      name = v.name;
    }
    const idea = Odd.idea.fromParts(chosen, { name: name || undefined, style: s.style, from: o.from });
    if (!idea) { D.toast('Those parts have no notes to make an idea from.'); return null; }
    // show the ideas, with filters that let the new one through
    const f = app.ui.shelf;
    f.view = 'ideas';
    if (f.role !== 'all' && !idea.voices.some((v) => v.role === f.role)) f.role = 'all';
    f.starred = false;
    f.query = '';
    savePrefs();
    commit('Capture idea', (ss, ws) => { M.addIdea(ws, idea); }, ['shelf', 'tabs']);
    const n = idea.voices.length;
    D.toast('Captured idea “' + idea.name + '”' + (n > 1 ? ' (' + n + ' voices)' : ''), {
      action: app.ui.tab !== 'shelf' && window.innerWidth <= 900 ? { label: 'Show', run: () => goTab('shelf') } : { label: 'Undo', run: undo },
    });
    return idea;
  }

  /** the booth take, plus whatever the section plays with it (ticked when you hear them together) */
  function captureFromBooth() {
    const take = app.currentTake();
    if (!take) return;
    const s = app.session();
    const sec = app.selectedSection();
    const target = app.boothLane();
    const sources = [{ part: take, sourceId: take.id, label: 'This take: ' + take.name, checked: true }];
    for (const lane of s.lanes) {
      if (target && lane.id === target.id) continue;
      const slot = sec.slots[lane.id];
      if (!slot || !slot.part) continue;
      sources.push({
        part: slot.part, oct: slot.oct, form: slot.form, sourceId: slot.sourceId,
        label: lane.name + ': ' + slot.part.name, checked: !!app.ui.booth.context,
      });
    }
    captureIdea(sources, { from: 'booth', title: 'Capture an idea from take ' + String(take.take || 1).padStart(3, '0') });
  }

  function captureFromSection(section) {
    const s = app.session();
    const sources = [];
    for (const lane of s.lanes) {
      const slot = section.slots[lane.id];
      if (!slot || !slot.part) continue;
      sources.push({
        part: slot.part, oct: slot.oct, form: slot.form, sourceId: slot.sourceId,
        label: lane.name + ': ' + slot.part.name, checked: !M.slotSpan(section, slot).out,
      });
    }
    if (!sources.length) { D.toast(section.name + ' has no parts yet.'); return; }
    captureIdea(sources, { from: 'section', ask: true, title: 'Capture an idea from ' + section.name });
  }

  /** put each voice's part in a section (the selected one by default), in a lane of its stem */
  function placeIdea(idea, section) {
    const s = app.session();
    const sec = section || app.selectedSection();
    const voices = idea.voices.filter((v) => v.part);
    if (!voices.length) { D.toast('This idea has no parts to place.'); return; }
    const where = [];
    commit('Place idea', () => {
      const used = new Set();
      for (const v of voices) {
        let lane = s.lanes.find((l) => l.role === v.role && !used.has(l.id));
        if (!lane) lane = M.addLane(s, v.role);
        used.add(lane.id);
        const part = Object.assign(M.clone(v.part), { id: v.sourceId || v.part.id });
        const slot = M.placePart(s, sec.id, lane.id, part);
        if (!slot) continue;
        slot.oct = v.oct || 0;
        if (v.form) slot.form = v.form; else delete slot.form;
        where.push(lane.name);
      }
      app.ui.sectionId = sec.id;
    }, ['song', 'shelf', 'booth']);
    D.toast('Placed “' + idea.name + '” in ' + sec.name + ': ' + where.join(', '), { action: { label: 'Undo', run: undo } });
  }

  function splitVoice(idea, index) {
    const v = idea.voices[index];
    if (!v || idea.voices.length < 2) return;
    let made = null;
    commit('Split idea', (s, ws) => {
      made = Odd.idea.split(idea, index);
      Odd.idea.removeVoice(idea, index);
      M.addIdea(ws, made);
    }, ['shelf', 'tabs']);
    delete app.ui.ideaMute[idea.id];
    D.toast(v.name + ' is now an idea of its own', { action: { label: 'Undo', run: undo } });
  }

  async function joinDialog(idea) {
    const others = (app.ws.ideas || []).filter((x) => x.id !== idea.id);
    if (!others.length) { D.toast('Capture another idea first.'); return; }
    const rows = others.map((x, i) =>
      '<label class="type-opt"><input type="radio" name="dlg-join" value="' + esc(x.id) + '"' + (i ? '' : ' checked') + '>' +
      '<span><strong>' + esc(x.name) + '</strong><small>' + esc(x.voices.map((v) => M.roleInfo(v.role).label).join(', ')) + ' · ' + x.bars + (x.bars === 1 ? ' bar' : ' bars') + '</small></span></label>').join('');
    const id = await D.dialog({
      title: 'Join “' + idea.name + '” with…',
      body: '<p class="help">Makes a new idea with the voices of both, so you can hear them together. Both ideas stay as they are.</p><div class="join-list">' + rows + '</div>',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Join', primary: true, value: (el) => { const r = $('input[name="dlg-join"]:checked', el); return r ? r.value : null; } },
      ],
    });
    const other = id && M.findIdea(app.ws, id);
    if (!other) return;
    const joined = Odd.idea.join([idea, other]);
    commit('Join ideas', (s, ws) => { M.addIdea(ws, joined); }, ['shelf', 'tabs']);
    D.toast('Joined into “' + joined.name + '”', { action: { label: 'Undo', run: undo } });
  }

  function ideaMenu(anchor, idea) {
    const sec = app.selectedSection();
    const items = [
      { label: 'Rename…', run: async () => {
        const name = await D.prompt('Rename idea', 'Name', idea.name);
        if (name) commit('Rename idea', () => { idea.name = name; }, ['shelf']);
      } },
      { label: 'Ladder: hear it step by step…', run: () => ladderDialog(idea) },
      ...(idea.bones && Odd.bones ? [{ label: 'Keep building in Bones to Gold', run: () => { Odd.bones.open(idea.bones, idea.id); setScreen('bones'); } }] : []),
      { label: 'Place in ' + sec.name, disabled: !idea.voices.some((v) => v.part), run: () => placeIdea(idea) },
      { label: 'Join with another idea…', disabled: (app.ws.ideas || []).length < 2, run: () => joinDialog(idea) },
    ];
    if (idea.voices.length > 1) {
      items.push('-', { heading: 'Split off' });
      idea.voices.forEach((v, i) => items.push({ label: v.name, hint: M.roleInfo(v.role).short, run: () => splitVoice(idea, i) }));
    }
    const openable = idea.voices.filter((v) => v.part);
    if (openable.length) {
      items.push('-', { heading: 'Open in the booth' });
      for (const v of openable) items.push({ label: v.name, hint: M.roleInfo(v.role).short, run: () => loadIntoBooth(v.part) });
    }
    items.push('-', { label: 'Delete idea', kind: 'danger', run: () => {
      if (app.isPlaying('bones', idea.id) || app.isPlaying('idea', idea.id)) stop();
      commit('Delete idea', (s, ws) => M.removeIdea(ws, idea.id), ['shelf', 'tabs']);
      D.toast('Deleted idea “' + idea.name + '”', { action: { label: 'Undo', run: undo } });
    } });
    D.menu(anchor, items, { align: 'right' });
  }

  // ======================= sessions =======================
  function switchSession(id) {
    stop();
    app.ws.currentId = id;
    app.ui.booth.takes = {};
    app.ui.sectionId = null;
    app.ui.laneId = null;
    app.ui.arrIndex = null;
    fixSelection();
    genTake();
    persist();
    paint();
  }

  async function newSessionDialog() {
    const styles = Odd.styles.list();
    const cur = app.session();
    const keyOpts = '<option value="">Random</option>' + T.NOTE_NAMES.map((n, i) => '<option value="' + i + '">' + n + '</option>').join('');
    const scaleOpts = '<option value="">Suits the style</option>' + Object.keys(T.SCALES).map((k) => '<option value="' + k + '">' + esc(T.SCALES[k].label) + '</option>').join('');
    const result = await D.dialog({
      title: 'New session',
      body:
        '<label class="field"><span>Name</span><input type="text" id="ns-name" maxlength="60" value="' + esc(M.createSession({ style: cur.style }).name) + '"></label>' +
        '<label class="field"><span>Style</span><select id="ns-style">' + styles.map((st) => '<option value="' + st.id + '"' + (st.id === cur.style ? ' selected' : '') + '>' + esc(st.label) + ' — ' + esc(st.blurb) + '</option>').join('') + '</select></label>' +
        '<div class="field-row"><label class="field"><span>Key</span><select id="ns-key">' + keyOpts + '</select></label>' +
        '<label class="field"><span>Mode</span><select id="ns-scale">' + scaleOpts + '</select></label></div>' +
        '<label class="toggle"><input type="checkbox" id="ns-starter"><span>Start with a few parts already in place</span></label>',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Create', primary: true, value: (el) => ({
          name: $('#ns-name', el).value.trim(),
          style: $('#ns-style', el).value,
          tonic: $('#ns-key', el).value === '' ? null : Number($('#ns-key', el).value),
          scale: $('#ns-scale', el).value || null,
          starter: $('#ns-starter', el).checked,
        }) },
      ],
    });
    if (!result) return;
    commit('New session', (s, ws) => {
      const ns = M.createSession({ name: result.name || undefined, style: result.style, tonic: result.tonic, scale: result.scale || undefined });
      ws.sessions.push(ns);
      if (result.starter) M.fillStarter(ws, ns);
      ws.currentId = ns.id;
    }, []);
    switchSession(app.ws.currentId);
    D.toast('New session: ' + app.session().name);
  }

  function sessionMenu(anchor) {
    const ws = app.ws;
    const cur = app.session();
    const items = [{ heading: 'Sessions' }];
    for (const s of ws.sessions.slice().sort((a, b) => b.updated - a.updated)) {
      items.push({ label: s.name, checked: s.id === cur.id, hint: Odd.model.styleOf(s.style).label, run: () => { if (s.id !== cur.id) switchSession(s.id); } });
    }
    items.push('-',
      { label: 'New session…', run: newSessionDialog },
      { label: 'Duplicate this session', run: () => { commit('Duplicate session', (s, w) => { const c = M.duplicateSession(w, cur.id); w.currentId = c.id; }, []); switchSession(app.ws.currentId); } },
      { label: 'Rename…', run: async () => {
        const name = await D.prompt('Rename session', 'Name', cur.name);
        if (name) commit('Rename session', () => { cur.name = name; }, ['top']);
      } },
      { label: 'Delete this session…', kind: 'danger', disabled: ws.sessions.length <= 1, run: async () => {
        const ok = await D.confirm('Delete “' + cur.name + '”?', 'Its sections and arrangement go away. Parts on the shelf stay. You can undo this.', 'Delete', true);
        if (!ok) return;
        commit('Delete session', (s, w) => { M.removeSession(w, cur.id); }, []);
        switchSession(app.ws.currentId);
      } },
      '-',
      { label: 'Save project file', run: exportProject },
      { label: 'Open project file…', run: importProject },
      { label: 'Import a MIDI clip…', run: importMidi },
    );
    D.menu(anchor, items);
  }

  // ======================= import / export =======================
  function exportMenu(anchor) {
    const s = app.session();
    const sec = app.selectedSection();
    D.menu(anchor, [
      { heading: s.name },
      { label: 'Song as MIDI (.mid)', run: () => D.download(Odd.exporter.safeName(s.name) + '.mid', Odd.exporter.songMidi(s), 'audio/midi') },
      { label: 'Stems as MIDI (.zip)', run: () => {
        const z = Odd.exporter.stemsZip(s);
        if (!z.count) { D.toast('The song has no parts yet.'); return; }
        D.download(Odd.exporter.safeName(s.name) + ' - MIDI stems.zip', z.bytes, 'application/zip');
        D.toast(z.count + (z.count === 1 ? ' stem' : ' stems') + ' exported, each spanning the whole song.');
      } },
      { label: 'Stems as audio (.wav zip)', disabled: !(Odd.audio && Odd.audio.renderOffline), run: exportWav },
      { label: 'Section “' + sec.name + '” as MIDI', run: () => D.download(Odd.exporter.safeName(s.name + ' - ' + sec.name) + '.mid', Odd.exporter.sectionMidi(s, sec), 'audio/midi') },
      '-',
      { label: 'Project file (.json)', run: exportProject },
    ], { align: 'right' });
  }

  let rendering = false;
  async function exportWav() {
    if (rendering) return;
    const s = app.session();
    if (!R.songEvents(s).events.length) { D.toast('The song has no parts yet.'); return; }
    rendering = true;
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast toast-progress';
    el.innerHTML = '<span class="toast-msg">Rendering audio…</span><span class="bar"><span></span></span>';
    host.appendChild(el);
    try {
      const z = await Odd.exporter.stemsWav(s, (done, total) => {
        $('.toast-msg', el).textContent = 'Rendering audio: ' + done + ' of ' + total + ' files done';
        $('.bar span', el).style.transform = 'scaleX(' + (done / total) + ')';
      });
      D.download(Odd.exporter.safeName(s.name) + ' - audio stems.zip', z.bytes, 'application/zip');
      D.toast('Rendered ' + z.count + ' audio stems and a mix.');
    } catch (e) {
      D.toast('Rendering failed: ' + (e && e.message ? e.message : e), { kind: 'warn' });
    } finally {
      el.remove();
      rendering = false;
    }
  }

  function exportProject() {
    const s = app.session();
    D.download(Odd.exporter.safeName(s.name) + '.oddition.json', Odd.exporter.projectJson(app.ws), 'application/json');
  }

  async function importProject() {
    const f = await D.pickFile('.json,application/json');
    if (!f) return;
    let data;
    try { data = Odd.exporter.parseProject(f.text); } catch (e) { D.toast(e.message, { kind: 'warn' }); return; }
    if (data.session) {
      commit('Open session', (s, ws) => { data.session.id = M.uid('ss'); ws.sessions.push(data.session); ws.currentId = data.session.id; }, []);
      switchSession(app.ws.currentId);
      D.toast('Opened session “' + app.session().name + '”');
      return;
    }
    const incoming = data.workspace;
    const choice = await D.dialog({
      title: 'Open project',
      body: '<p>This file has ' + incoming.sessions.length + (incoming.sessions.length === 1 ? ' session' : ' sessions') + ', ' + incoming.library.length + ' shelf parts and ' + (incoming.ideas || []).length + ' ideas.</p><p class="help">Adding keeps everything you have now. Replacing swaps your whole workspace for the file. Either can be undone.</p>',
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Replace everything', value: 'replace', kind: 'danger' },
        { label: 'Add to my workspace', value: 'merge', primary: true },
      ],
    });
    if (!choice) return;
    commit('Open project', (s, ws) => {
      if (choice === 'replace') {
        ws.sessions = incoming.sessions;
        ws.library = incoming.library;
        ws.ideas = incoming.ideas || [];
        ws.currentId = incoming.currentId;
      } else {
        const ids = new Set(ws.library.map((p) => p.id));
        for (const p of incoming.library) if (!ids.has(p.id)) ws.library.push(p);
        ws.ideas = ws.ideas || [];
        const iids = new Set(ws.ideas.map((x) => x.id));
        for (const x of incoming.ideas || []) if (!iids.has(x.id)) ws.ideas.push(x);
        const sids = new Set(ws.sessions.map((x) => x.id));
        for (const ss of incoming.sessions) { if (sids.has(ss.id)) ss.id = M.uid('ss'); ws.sessions.push(ss); }
        ws.currentId = incoming.sessions[0].id;
      }
    }, []);
    switchSession(app.ws.currentId);
    D.toast('Opened ' + f.name);
  }

  async function importMidi() {
    const f = await D.pickFile('.mid,.midi,audio/midi');
    if (!f) return;
    let parts;
    try { parts = Odd.exporter.importMidi(f.bytes, app.session(), f.name); } catch (e) { D.toast('Could not read that MIDI file: ' + e.message, { kind: 'warn' }); return; }
    if (!parts.length) { D.toast('That MIDI file has no notes in it.'); return; }
    commit('Import MIDI', (s, ws) => { for (const p of parts.reverse()) M.addToLibrary(ws, p); }, ['shelf', 'tabs']);
    D.toast('Added ' + parts.length + (parts.length === 1 ? ' part' : ' parts') + ' from ' + f.name + ' to the shelf');
  }

  // ======================= MIDI out + help =======================
  async function midiSetup() {
    const W = Odd.webmidi;
    if (!W || !W.supported) {
      await D.dialog({
        title: 'MIDI output',
        body: '<p>This browser cannot send live MIDI. Chrome, Edge and Opera can, and Firefox can after you allow it for the site.</p><p class="help">You can still export .mid files and drop them into any DAW.</p>',
        actions: [{ label: 'OK', value: true, primary: true }],
      });
      return;
    }
    let outs = [];
    try { outs = await W.init(); } catch (e) { outs = []; }
    const outOpts = '<option value="">None</option>' + outs.map((o) => '<option value="' + esc(o.id) + '"' + (o.id === W.selectedId ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('');
    const modes = [['internal', 'Built-in sounds only'], ['both', 'Built-in sounds and MIDI out'], ['midi', 'MIDI out only']];
    const result = await D.dialog({
      title: 'MIDI output',
      body:
        (outs.length ? '' : '<p class="help">No MIDI outputs found. Connect a device or create a virtual port, then open this again.</p>') +
        '<label class="field"><span>Send to</span><select id="mo-out">' + outOpts + '</select></label>' +
        '<fieldset class="field"><legend>Play through</legend>' + modes.map(([v, l]) =>
          '<label class="radio"><input type="radio" name="mo-mode" value="' + v + '"' + (W.mode === v ? ' checked' : '') + '><span>' + l + '</span></label>').join('') + '</fieldset>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="mo-test">Send a test note</button>' +
        '<p class="help">To hear Oddition through instruments in your DAW, create a virtual MIDI port (IAC Driver on macOS, loopMIDI on Windows), pick it here, and set your DAW tracks to the lane channels. Drums use channel 10.</p>',
      onOpen: (el) => {
        $('#mo-test', el).addEventListener('click', () => {
          W.select($('#mo-out', el).value || null);
          const t = performance.now();
          W.noteOn(0, 60, 100, t);
          W.noteOff(0, 60, t + 400);
        });
      },
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Save', primary: true, value: (el) => ({ out: $('#mo-out', el).value || null, mode: ($('input[name="mo-mode"]:checked', el) || {}).value || 'internal' }) },
      ],
    });
    if (!result) return;
    W.select(result.out);
    W.setMode(result.out ? result.mode : 'internal');
    app.ws.prefs.midi = { out: result.out, mode: W.mode };
    persist();
    paint(['top']);
    if (result.out && result.mode !== 'internal') D.toast('Sending MIDI to ' + (outs.find((o) => o.id === result.out) || {}).name);
  }

  function helpDialog() {
    const rows = [
      ['Space', 'Play or stop'], ['X', 'Reject and hear a new take'], ['K', 'Keep the take on the shelf'],
      ['P', 'Keep and place it in the selected section'], ['V', 'Make a variation of the take'],
      ['I', 'Capture the take as an idea (with the parts you hear it with)'],
      ['W', 'Who leads: how the parts of the selected section fit to each other'],
      ['H', 'Let the selected part\'s tune set its section\'s chords, or hand them back'],
      ['← →', 'Step through takes'], ['1 – 7', 'Switch stem: drums, percussion, bass, chords, pad, lead, arp'],
      ['Esc', 'Stop'], ['Ctrl Z', 'Undo'], ['Ctrl Shift Z', 'Redo'],
    ];
    D.dialog({
      title: 'Shortcuts',
      wide: true,
      body: '<table class="keys">' + rows.map(([k, v]) => '<tr><td><kbd>' + esc(k) + '</kbd></td><td>' + esc(v) + '</td></tr>').join('') + '</table>' +
        '<p class="help">How it works: the booth writes a new part each time you reject one. Keep the ones you like; they go on the shelf. Place shelf parts into the song sheet, where every part follows the chords of the section it sits in. Export the song or its stems as MIDI files for your DAW.</p>',
      actions: [{ label: 'Close', value: true, primary: true }],
    });
  }

  // ======================= screens =======================
  /** 'bones' (Bones to Gold, the idea audition) or 'studio' (sheet, booth, shelf) */
  function setScreen(name, opts) {
    const o = opts || {};
    const next = name === 'studio' ? 'studio' : 'bones';
    const was = app.ui.screen;
    app.ui.screen = next;
    document.body.dataset.screen = next;
    if (next === 'bones') {
      stop();
      if (Odd.bones) Odd.bones.show(true);
    } else {
      if (Odd.bones) Odd.bones.show(false);
      paint();
    }
    if (was !== next && !o.boot) {
      app.ws.prefs.screen = next;
      persist();
      try { window.scrollTo(0, 0); } catch (e) { /* no window */ }
    }
  }

  /** what the Bones to Gold screen asks of the app */
  const bonesHost = {
    toStudio: () => setScreen('studio'),
    stopStudio: () => { if (app.ui.playing) stop(); },
    toast: (msg, opts) => D.toast(msg, opts),
    /** a finished idea onto the shelf; returns its id */
    saveIdea({ sources, name, bones }) {
      const idea = Odd.idea.fromParts(sources, { name, from: 'bones' });
      if (!idea) { D.toast('That idea has no notes to save yet.'); return null; }
      idea.bones = bones;
      const f = app.ui.shelf;
      f.view = 'ideas';
      f.role = 'all';
      f.starred = false;
      f.query = '';
      savePrefs();
      commit('Save idea', (ss, ws) => { M.addIdea(ws, idea); }, ['shelf', 'tabs']);
      D.toast('Saved “' + idea.name + '” to Ideas', { action: { label: 'Show in the Studio', run: () => { setScreen('studio'); if (window.innerWidth <= 900) goTab('shelf'); } } });
      return idea.id;
    },
  };

  function goTab(tab) {
    if (app.ui.tab === tab) return;
    app.ui.tab = tab;
    syncTabs();
    paint([tab, 'tabs']); // canvases need a visible panel to size themselves
  }

  // ======================= event wiring =======================
  const actions = {
    // top
    'screen-bones': () => setScreen('bones'),
    'play-song': () => toggle('song'),
    'session-menu': (el) => sessionMenu(el),
    'export-menu': (el) => exportMenu(el),
    'midi-setup': () => midiSetup(),
    help: () => helpDialog(),
    undo, redo,
    'toggle-fields': () => { app.ui.fieldsOpen = !app.ui.fieldsOpen; paint(['top']); },
    'toggle-more': () => { app.ui.moreOpen = !app.ui.moreOpen; savePrefs(); paint(['top']); },
    'roles-toggle': () => { app.ws.prefs.roles = app.ws.prefs.roles === false; persist(); paint(['song']); },
    'fit-open': (el) => fitDialog(el.dataset.section || app.selectedSection().id),
    'chord-mode': () => { app.ws.prefs.chordNames = !app.ws.prefs.chordNames; persist(); paint(['song', 'booth']); },
    tab: (el) => goTab(el.dataset.tab),

    // booth
    'booth-role': (el) => setRole(el.dataset.role),
    reject: () => newTake(),
    vary: () => vary(),
    keep: () => keep(false),
    'keep-place': () => keep(true),
    'play-booth': () => { if (!app.currentTake()) newTake(); else toggle('booth'); },
    'take-prev': () => stepTake(-1),
    'take-next': () => stepTake(1),
    'take-goto': (el) => { const tk = app.takesFor(app.ui.booth.role); tk.index = Number(el.dataset.index); paint(['booth']); autoPlayBooth(); },
    'take-midi': () => { const t = app.currentTake(); if (t) downloadPart(t); },
    'capture-idea': () => captureFromBooth(),
    'params-reset': () => {
      if (app.ws.prefs.params) delete app.ws.prefs.params[app.ui.booth.role];
      persist();
      rerollTake();
    },

    // shelf
    'shelf-role': (el) => { app.ui.shelf.role = el.dataset.role; savePrefs(); paint(['shelf']); },
    'shelf-starred': () => { app.ui.shelf.starred = !app.ui.shelf.starred; savePrefs(); paint(['shelf']); },
    'part-star': (el) => { const p = M.findPart(app.ws, el.dataset.id); if (p) commit(p.starred ? 'Unfavourite' : 'Favourite', () => { p.starred = !p.starred; }, ['shelf']); },
    'part-preview': (el) => toggle('preview', el.dataset.id),
    'part-place': (el) => { const p = M.findPart(app.ws, el.dataset.id); if (p) placeFromShelf(p); },
    'part-menu': (el) => { const p = M.findPart(app.ws, el.dataset.id); if (p) partMenu(el, p); },
    'import-midi': () => importMidi(),
    'shelf-view': (el) => {
      const view = el.dataset.view === 'ideas' ? 'ideas' : 'parts';
      if (app.ui.shelf.view === view) return;
      app.ui.shelf.view = view;
      savePrefs();
      paint(['shelf']);
    },
    'idea-play': (el) => toggle(el.dataset.kind === 'bones' ? 'bones' : 'idea', el.dataset.id),
    'idea-voice': (el) => {
      const id = el.dataset.id;
      const i = Number(el.dataset.index);
      const idea = M.findIdea(app.ws, id);
      if (!idea) return;
      const cur = app.ideaMute(id);
      let next = cur.includes(i) ? cur.filter((x) => x !== i) : cur.concat(i);
      if (next.length >= idea.voices.length) next = []; // leaving every voice out means hear them all again
      app.ui.ideaMute[id] = next;
      paint(['shelf']);
      if (app.isPlaying('bones', id) || app.isPlaying('idea', id)) refreshPlayback();
    },
    'idea-ladder': (el) => { const x = M.findIdea(app.ws, el.dataset.id); if (x) ladderDialog(x); },
    'idea-star': (el) => { const x = M.findIdea(app.ws, el.dataset.id); if (x) commit(x.starred ? 'Unfavourite' : 'Favourite', () => { x.starred = !x.starred; }, ['shelf']); },
    'idea-menu': (el) => { const x = M.findIdea(app.ws, el.dataset.id); if (x) ideaMenu(el, x); },

    // song
    'select-cell': (el) => selectCell(el.dataset.section, el.dataset.lane),
    'select-section': (el) => { app.ui.sectionId = el.dataset.section; paint(['booth', 'shelf', 'song']); refreshIfAudition(); },
    'play-section': (el) => toggle('section', el.dataset.section),
    'section-menu': (el) => { const sec = M.findSection(app.session(), el.dataset.section); if (sec) sectionMenu(el, sec); },
    'section-shape': (el) => { const sec = M.findSection(app.session(), el.dataset.section); if (sec) shapeDialog(sec); },
    'section-type': (el) => { const sec = M.findSection(app.session(), el.dataset.section); if (sec) typeDialog(sec); },
    'cell-span': () => spanDialog(),
    'cell-form': (el) => {
      const { section, lane } = app.selectedSlot();
      const slot = lane && section.slots[lane.id];
      if (!slot) return;
      const cur = slot.form || 'full';
      D.menu(el, [{ heading: 'Play it here as' }].concat(R.FORMS.map((f) => ({
        label: R.FORM_LABELS[f] + (f === cur ? '  ✓' : ''),
        run: () => commit('Change form', () => { if (f === 'full') delete slot.form; else slot.form = f; }, ['song']),
      }))));
    },
    'cell-reuse': () => reuseDialog(),
    'booth-edit': () => { app.ui.booth.edit = !app.ui.booth.edit; paint(['booth']); },
    'lock-bar': (el) => {
      const b = app.ui.booth;
      const i = Number(el.dataset.index);
      b.locks = b.locks.includes(i) ? b.locks.filter((x) => x !== i) : b.locks.concat(i).sort((x, y) => x - y);
      paint(['booth']);
    },
    'edit-chords': (el) => { const sec = M.findSection(app.session(), el.dataset.section); if (sec) editChords(sec); },
    'new-chords': (el) => {
      const s = app.session();
      const sec = M.findSection(s, el.dataset.section);
      if (!sec) return;
      if (Odd.harmonise && Odd.harmonise.leaderOf(sec)) varyLead(sec, 1);
      else commit('New chords', () => { sec.prog = M.newProgression(s, sec.bars); });
    },
    'add-section': () => commit('Add section', (s) => { const sec = M.addSection(s, { bars: 8 }); app.ui.sectionId = sec.id; }),
    'add-lane': (el) => D.menu(el, [{ heading: 'Add a lane' }].concat(Odd.gen.ROLES.map((r) => ({
      label: Odd.views.roleLabel(r), run: () => commit('Add lane', (s) => { const l = M.addLane(s, r); app.ui.laneId = l.id; }, ['song', 'booth']),
    })))),
    'lane-menu': (el) => { const l = M.findLane(app.session(), el.dataset.lane); if (l) laneMenu(el, l); },
    'lane-mute': (el) => laneFlag(el.dataset.lane, 'mute'),
    'lane-solo': (el) => laneFlag(el.dataset.lane, 'solo'),
    'cell-swap': (el) => swapSlot(Number(el.dataset.dir) || 1),
    'cell-oct': (el) => {
      const { section, lane } = app.selectedSlot();
      const slot = lane && section.slots[lane.id];
      if (slot) commit('Change octave', () => { slot.oct = Math.max(-3, Math.min(3, (slot.oct || 0) + Number(el.dataset.dir))); }, ['song']);
    },
    'cell-refit': () => {
      const { section, lane } = app.selectedSlot();
      const slot = lane && section.slots[lane.id];
      if (!slot) return;
      if (Odd.harmonise && Odd.harmonise.leaderOf(section) === lane.id) { D.toast(lane.name + ' sets the chords here, so it plays as written. Turn off Lead to fit it to chords.'); return; }
      commit('Toggle chord fit', () => { slot.refit = slot.refit === false; }, ['song']);
    },
    'cell-lead': () => {
      const { section, lane } = app.selectedSlot();
      if (lane && section.slots[lane.id]) toggleLead(section, lane.id);
    },
    'lead-toggle': (el) => {
      const sec = M.findSection(app.session(), el.dataset.section);
      if (sec) toggleLead(sec, el.dataset.lane);
    },
    'cell-clear': () => {
      const { section, lane } = app.selectedSlot();
      if (lane && section.slots[lane.id]) {
        commit('Clear slot', (s) => M.clearSlot(s, section.id, lane.id), ['song', 'shelf']);
        D.toast('Cleared ' + section.name + ' › ' + lane.name, { action: { label: 'Undo', run: undo } });
      }
    },
    'cell-audition': () => auditionCell(),
    'loop-song': () => { app.ui.loopSong = !app.ui.loopSong; savePrefs(); paint(['song']); refreshPlayback(); },
    'arr-select': (el, e) => {
      const i = Number(el.dataset.index);
      const s = app.session();
      if (e && e.detail >= 2) { playFrom(i); return; }
      app.ui.arrIndex = app.ui.arrIndex === i ? null : i;
      if (s.arrangement[i]) app.ui.sectionId = s.arrangement[i];
      paint(['booth', 'shelf', 'song']);
      refreshIfAudition();
    },
    'arr-left': (el) => moveArr(Number(el.dataset.index), -1),
    'arr-right': (el) => moveArr(Number(el.dataset.index), 1),
    'arr-play': (el) => playFrom(Number(el.dataset.index)),
    'arr-remove': (el) => {
      const i = Number(el.dataset.index);
      commit('Remove from song', (s) => { s.arrangement.splice(i, 1); app.ui.arrIndex = null; }, ['song', 'top']);
    },
    'arr-add': (el) => {
      const s = app.session();
      D.menu(el, [{ heading: 'Add to the song' }].concat(s.sections.map((sec) => ({
        label: sec.name + ' · ' + sec.bars + ' bars',
        run: () => commit('Add to song', () => {
          const at = app.ui.arrIndex != null ? app.ui.arrIndex + 1 : s.arrangement.length;
          s.arrangement.splice(at, 0, sec.id);
          app.ui.arrIndex = at;
        }, ['song']),
      }))), { align: 'right' });
    },
  };

  function refreshIfAudition() {
    if (app.isPlaying('booth') || app.isPlaying('preview')) refreshPlayback();
  }

  function moveArr(i, dir) {
    commit('Reorder song', (s) => { if (M.moveArrangement(s, i, dir)) app.ui.arrIndex = i + dir; }, ['song']);
  }

  function playFrom(i) {
    const song = R.songEvents(app.session());
    const m = song.markers.find((x) => x.index === i);
    play('song', null, { startTick: m ? m.start : 0 });
  }

  function laneFlag(laneId, flag) {
    const lane = M.findLane(app.session(), laneId);
    if (!lane) return;
    lane[flag] = !lane[flag];
    persist();
    paint(['song']);
    if (Odd.transport && Odd.transport.playing && currentSeq) {
      const tracks = Object.assign({}, currentSeq.tracks, R.tracksFor(app.session()));
      if (app.isPlaying('booth') || app.isPlaying('preview')) for (const k in tracks) tracks[k].solo = false;
      currentSeq.tracks = tracks;
      Odd.transport.setTracks(tracks);
    }
  }

  const changes = {
    bpm: (el) => {
      const v = Math.round(Number(el.value));
      if (!(v >= 30 && v <= 300)) { el.value = app.session().bpm; return; }
      commit('Change tempo', (s) => { s.bpm = v; }, ['top', 'song']);
    },
    tonic: (el) => commit('Change key', (s) => { s.tonic = Number(el.value); }),
    scale: (el) => commit('Change mode', (s) => { M.setScale(s, el.value); }),
    style: (el) => {
      const st = Odd.styles.get(el.value);
      commit('Change style', (s) => { M.applyStyle(s, el.value); });
      D.toast(st.label + ': ' + app.session().bpm + ' BPM, lane sounds updated. New takes use this style.');
    },
    harmony: (el) => {
      const v = Number(el.value);
      commit('Change harmony', (s) => { s.harmony = v; }, ['top']);
      D.toast(v ? 'New chords will reach outside the key more' + (v >= 0.6 ? ' often.' : ' now and then.') + ' Press the dice on a section to hear it.' : 'New chords will stay in the key.');
    },
    'swing-commit': () => persist(),
    'feel-commit': () => persist(),
    'shape-on': (el) => commit(el.value === 'on' ? 'Turn shape on' : 'Turn shape off', (s) => {
      s.shape = Object.assign(M.defaultShape(), s.shape, { on: el.value === 'on' });
    }, ['top', 'song']),
    quality: (el) => {
      const was = app.ui.playing;
      const at = was && Odd.transport ? Odd.transport.position() : 0;
      if (was) stop();
      app.ws.prefs.quality = el.value;
      Odd.audio.setQuality(el.value);
      persist();
      paint(['top']);
      D.toast(Odd.audio.quality === 'light' ? 'Light sound: fewer layers per note, for phones and tablets.' : 'Full sound: every layer, for computers.');
      if (was) play(was.kind, was.id, { startTick: was.kind === 'song' ? at : 0 });
    },
    'section-bars': (el) => {
      const s = app.session();
      const sec = M.findSection(s, el.dataset.section);
      const bars = Number(el.value);
      if (!sec || ![1, 2, 4, 8, 16].includes(bars) || bars === sec.bars) return;
      commit('Change section length', () => { M.setSectionBars(s, sec, bars); }, ['top', 'booth', 'song']);
    },
    'booth-section': (el) => { app.ui.sectionId = el.value; paint(['booth', 'shelf', 'song']); refreshIfAudition(); },
    'booth-lane': (el) => { app.ui.laneId = el.value; paint(['booth', 'song']); refreshIfAudition(); },
    'booth-bars': (el) => { app.ui.booth.bars = Number(el.value); app.ui.booth.locks = []; savePrefs(); rerollTake(); },
    'booth-listen': (el) => { app.ui.booth.listen = el.checked; savePrefs(); rerollTake(); },
    'booth-context': (el) => { app.ui.booth.context = el.checked; savePrefs(); refreshIfAudition(); },
    param: (el) => {
      const role = app.ui.booth.role;
      const spec = Odd.gen.params(role).find((p) => p.key === el.dataset.key);
      if (!spec) return;
      const v = spec.type === 'select' ? (typeof spec.default === 'number' ? Number(el.value) : el.value) : Number(el.value);
      const prefs = app.ws.prefs;
      prefs.params = prefs.params || {};
      prefs.params[role] = Object.assign({}, prefs.params[role], { [spec.key]: v });
      persist();
      rerollTake();
    },
    'shelf-sort': (el) => { app.ui.shelf.sort = el.value; savePrefs(); paint(['shelf']); },
    'lane-patch': (el) => {
      const lane = M.findLane(app.session(), el.dataset.lane);
      if (!lane) return;
      commit('Change sound', () => { lane.patch = el.value; }, ['song']);
      if (!app.ui.playing && Odd.synth) Odd.synth.preview(lane.patch);
    },
    'lane-volume-commit': () => persist(),
  };

  let queryTimer = null;
  const inputs = {
    feel: (el) => {
      const s = app.session();
      s.shape = Object.assign(M.defaultShape(), s.shape, { humanize: Number(el.value) });
      const out = $('#o-feel');
      if (out) out.textContent = Math.round(s.shape.humanize * 100) + '%';
      refreshPlayback();
    },
    swing: (el) => {
      const s = app.session();
      s.swing = Number(el.value);
      const out = $('#o-swing');
      if (out) out.textContent = Math.round(s.swing * 200) + '%';
      refreshPlayback();
    },
    master: (el) => {
      const v = Number(el.value);
      app.ws.prefs.master = v;
      if (Odd.audio && Odd.audio.setMasterVolume) Odd.audio.setMasterVolume(v);
      persist();
    },
    'param-live': (el) => {
      const spec = Odd.gen.params(app.ui.booth.role).find((p) => p.key === el.dataset.key);
      const out = document.getElementById('o-' + el.id);
      if (spec && out) {
        const v = Number(el.value);
        out.textContent = spec.key === 'octave' ? (v > 0 ? '+' : '') + v : spec.max === 1 && spec.min === 0 ? Math.round(v * 100) + '%' : String(v);
      }
    },
    'shelf-query': (el) => {
      app.ui.shelf.query = el.value;
      clearTimeout(queryTimer);
      queryTimer = setTimeout(() => paint(['shelf']), 120);
    },
    'lane-volume': (el) => {
      const lane = M.findLane(app.session(), el.dataset.lane);
      if (!lane) return;
      lane.volume = Number(el.value);
      if (Odd.transport && Odd.transport.playing && currentSeq) {
        if (currentSeq.tracks[lane.id]) currentSeq.tracks[lane.id].volume = lane.volume;
        if ((app.isPlaying('booth') || app.isPlaying('preview')) && app.boothLane() && app.boothLane().id === lane.id && currentSeq.tracks[TAKE_TRACK]) {
          currentSeq.tracks[TAKE_TRACK].volume = lane.volume;
        }
        Odd.transport.setTracks(currentSeq.tracks);
      }
    },
  };

  /**
   * Booth note editing. Click empty space to add a note, click a note to
   * remove it, drag a note up or down to play it harder or softer.
   */
  function onRollPointer(e) {
    if (e.button !== 0) return;
    const screen = e.target.closest && e.target.closest('.booth .screen.is-editing');
    if (!screen) return;
    const base = $('canvas.roll-base', screen);
    const take = app.currentTake();
    if (!base || !take) return;
    const h = Odd.roll.hit(base, e.clientX, e.clientY);
    if (!h) return;
    e.preventDefault();
    const s = app.session();
    const target = app.boothTarget(take, take.bars * T.BAR);
    const drum = T.isDrumRole(take.role);
    if (!h.hit) {
      const t = Math.floor(h.t / T.STEP) * T.STEP;
      setEditedTake(Odd.edit.addNote(take, target, { t, d: drum ? 60 : 2 * T.STEP, p: h.p, v: 96 }));
      return;
    }
    const idx = h.hit.i;
    if (idx == null || !take.notes[idx]) return;
    const startY = e.clientY;
    const v0 = take.notes[idx].v;
    let moved = false;
    let edited = take;
    const tip = $('.edit-hint', roots.booth);
    const move = (ev) => {
      const dy = startY - ev.clientY;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      edited = Odd.edit.setVelocity(take, idx, v0 + dy * 0.7);
      const r = app.boothRoll(edited);
      Odd.roll.draw(base, Object.assign({}, base._opts, { events: r.events }));
      if (tip) tip.textContent = 'Velocity ' + edited.notes[idx].v;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (moved) setEditedTake(edited);
      else setEditedTake(Odd.edit.removeNote(take, idx));
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  function wire() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      if (el.closest('#bones')) return; // Bones to Gold handles its own clicks
      // clicks on controls inside a cell belong to the control, not the cell
      if (el.dataset.act === 'select-cell' && e.target.closest('select, input, label')) return;
      const fn = actions[el.dataset.act];
      if (fn) fn(el, e);
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (el && changes[el.dataset.change]) changes[el.dataset.change](el, e);
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el, e);
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', (e) => {
      if (e.key === ' ' && !isTyping(e.target) && !overlayOpen()) e.preventDefault();
    });

    // edit notes on the booth roll
    document.addEventListener('pointerdown', onRollPointer);

    // drag shelf parts onto slots; drag MIDI out to the desktop (Chrome)
    document.addEventListener('dragstart', (e) => {
      const card = e.target.closest && e.target.closest('.card[data-part]');
      const screen = e.target.closest && e.target.closest('[data-drag="take"]');
      let part = null;
      if (card) {
        part = M.findPart(app.ws, card.dataset.part);
        if (part) e.dataTransfer.setData('text/x-oddition-part', part.id);
      } else if (screen) {
        part = app.currentTake();
        if (part) e.dataTransfer.setData('text/x-oddition-take', part.id);
      }
      if (!part) return;
      e.dataTransfer.effectAllowed = 'copy';
      try {
        const bytes = Odd.exporter.partMidi(part, app.session(), laneForPart(part));
        const name = Odd.exporter.safeName(part.name) + '.mid';
        e.dataTransfer.setData('DownloadURL', 'audio/midi:' + name + ':data:audio/midi;base64,' + D.base64(bytes));
      } catch (err) { /* drag-out is a bonus */ }
      document.body.classList.add('is-dragging');
    });
    document.addEventListener('dragend', () => {
      document.body.classList.remove('is-dragging');
      for (const c of $$('.cell.is-drop')) c.classList.remove('is-drop');
    });
    document.addEventListener('dragover', (e) => {
      const cell = e.target.closest && e.target.closest('[data-drop="cell"]');
      if (!cell) return;
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes('text/x-oddition-part') && !types.includes('text/x-oddition-take')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      for (const c of $$('.cell.is-drop')) if (c !== cell) c.classList.remove('is-drop');
      cell.classList.add('is-drop');
    });
    document.addEventListener('drop', (e) => {
      const cell = e.target.closest && e.target.closest('[data-drop="cell"]');
      if (!cell) return;
      e.preventDefault();
      cell.classList.remove('is-drop');
      const id = e.dataTransfer.getData('text/x-oddition-part');
      const takeId = e.dataTransfer.getData('text/x-oddition-take');
      if (id) {
        const part = M.findPart(app.ws, id);
        if (part) placeFromShelf(part, cell.dataset.section, cell.dataset.lane);
      } else if (takeId) {
        const take = app.currentTake();
        if (!take) return;
        commit('Keep and place', (s, ws) => { const stored = M.addToLibrary(ws, take); M.placePart(s, cell.dataset.section, cell.dataset.lane, stored); });
        flashKeep();
      }
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => paint(['booth', 'shelf', 'song']), 150);
    });
    const themeChange = () => { Odd.roll.resetTokens(); meterColors = null; paint(['booth', 'shelf', 'song']); };
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', themeChange);
    }
    new MutationObserver(themeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const flushAll = () => {
      Odd.store.flush();
      if (Odd.platform && Odd.platform.sync) Odd.platform.sync.flush();
    };
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', flushAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
    if (Odd.transport && Odd.transport.on) {
      Odd.transport.on('end', () => { app.ui.playing = null; currentSeq = null; syncPlayState(); });
      Odd.transport.on('stall', onStall);
    }
  }

  function isTyping(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type) || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function overlayOpen() {
    const o = $('#overlay');
    return o && !o.hidden;
  }

  function onKey(e) {
    if (overlayOpen()) return;
    if (app.ui.screen === 'bones') {
      if (!isTyping(e.target) && Odd.bones) Odd.bones.onKey(e);
      return;
    }
    if (isTyping(e.target)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;

    // cells act like buttons
    if ((k === 'Enter') && e.target.matches && e.target.matches('[data-act][tabindex]')) { e.preventDefault(); e.target.click(); return; }

    switch (k) {
      case ' ': {
        e.preventDefault();
        const last = app.ui.lastPlay || { kind: 'booth' };
        if (app.ui.playing) stop();
        else if (last.kind === 'booth') { if (app.currentTake()) play('booth'); else newTake(); }
        else play(last.kind, last.id);
        break;
      }
      case 'x': case 'X': newTake(); break;
      case 'k': case 'K': keep(false); break;
      case 'p': case 'P': keep(true); break;
      case 'v': case 'V': vary(); break;
      case 'i': case 'I': captureFromBooth(); break;
      case 'w': case 'W': fitDialog(app.selectedSection().id); break;
      case 'h': case 'H': {
        const { section, lane } = app.selectedSlot();
        if (lane && section.slots[lane.id]) toggleLead(section, lane.id);
        else tuneDialog(section);
        break;
      }
      case 'ArrowLeft': if (!e.target.matches('input[type=range]')) { e.preventDefault(); stepTake(-1); } break;
      case 'ArrowRight': if (!e.target.matches('input[type=range]')) { e.preventDefault(); stepTake(1); } break;
      case 'Escape': stop(); break;
      case '?': helpDialog(); break;
      default:
        if (/^[1-7]$/.test(k)) setRole(Odd.gen.ROLES[Number(k) - 1]);
    }
  }

  // ======================= boot =======================
  function boot() {
    roots.top = $('#topbar');
    roots.booth = $('#booth');
    roots.shelf = $('#shelf');
    roots.song = $('#song');
    roots.tabs = $('#tabs');
    roots.bones = $('#bones');

    let ws = Odd.store.load();
    const firstRun = !ws;
    if (!ws) {
      ws = M.createWorkspace({ style: (Odd.styles && Odd.styles.DEFAULT) || 'lofi' });
      try { M.fillStarter(ws, M.currentSession(ws)); } catch (e) { console.error(e); }
    }
    app.ws = ws;
    const pr = ws.prefs;
    applyPrefs(pr);
    if (window.innerWidth > 900) app.ui.fieldsOpen = true;

    if (Odd.webmidi && pr.midi && pr.midi.out && Odd.webmidi.supported) {
      Odd.webmidi.init().then((outs) => {
        if (outs.some((o) => o.id === pr.midi.out)) { Odd.webmidi.select(pr.midi.out); Odd.webmidi.setMode(pr.midi.mode || 'internal'); paint(['top']); }
      }).catch(() => {});
    }
    // apply master volume once audio exists
    const unlock = () => {
      if (Odd.audio && Odd.audio.ensure) {
        Odd.audio.ensure().then(() => { if (Odd.audio.setMasterVolume) Odd.audio.setMasterVolume(pr.master != null ? pr.master : 0.8); }).catch(() => {});
      }
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);

    fixSelection();
    genTake();
    wire();
    if (Odd.bones && roots.bones) Odd.bones.mount(roots.bones, bonesHost);
    app.ui.screen = pr.screen === 'studio' || !Odd.bones ? 'studio' : 'bones';
    document.body.dataset.screen = app.ui.screen;
    paint();
    if (app.ui.screen === 'bones') Odd.bones.show(true);
    if (firstRun) persist();
    requestAnimationFrame(frame);
    document.body.classList.add('is-ready');

    if (firstRun && app.ui.screen === 'studio') {
      D.toast('This starter session already has a few parts. Press play at the top to hear the song, or press Space to audition takes.', { duration: 9000 });
    }

    // hosted build: pick up work saved to the viewer's account
    if (Odd.platform && Odd.platform.sync) {
      Odd.platform.sync.start(() => app.ws).then((remote) => {
        if (!remote) return;
        stop();
        app.ws = remote;
        Odd.history.clear();
        app.ui.booth.takes = {};
        applyPrefs(remote.prefs || {});
        fixSelection();
        genTake();
        Odd.store.save(remote);
        paint();
        D.toast('Loaded your saved work.');
      }).catch(() => {});
    }
  }

  function applyPrefs(pr) {
    if (Odd.audio && Odd.audio.setQuality) Odd.audio.setQuality(pr.quality || 'auto');
    const b = app.ui.booth;
    if (pr.role && Odd.gen.ROLES.includes(pr.role)) b.role = pr.role;
    if ([1, 2, 4, 8, 16].includes(pr.bars)) b.bars = pr.bars;
    if (pr.context != null) b.context = !!pr.context;
    if (pr.listen != null) b.listen = !!pr.listen;
    app.ui.moreOpen = !!pr.moreOpen;
    if (pr.shelf) Object.assign(app.ui.shelf, pr.shelf, { query: '' });
    if (app.ui.shelf.view !== 'ideas') app.ui.shelf.view = 'parts';
    app.ui.loopSong = !!pr.loopSong;
  }

  app.actions = actions;
  app.play = play;
  app.stop = stop;
  app.paint = paint;
  app.boot = boot;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(globalThis.Odd = globalThis.Odd || {});
