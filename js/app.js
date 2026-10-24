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
      tab: 'booth',
      sectionId: null,
      laneId: null,
      arrIndex: null,
      fieldsOpen: false,
      loopSong: false,
      playing: null,
      lastPlay: { kind: 'booth', id: null },
      booth: { role: 'drums', bars: 4, context: true, autoNext: true, takeNo: 0, takes: {} },
      shelf: { role: 'all', query: '', starred: false, sort: 'new' },
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

  app.boothRoll = (part) => {
    const s = app.session();
    const sec = app.selectedSection();
    const length = part.bars * T.BAR;
    const tgt = R.sectionTarget(s, sec, length);
    return {
      events: R.partEvents(part, tgt),
      length,
      chords: R.chordLabels(sec.prog, tgt.tonic, s.scale, length),
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
  }

  function drawRolls(rolls) {
    for (const r of rolls) {
      const c = document.getElementById(r.id);
      if (c && c.clientWidth) Odd.roll.draw(c, r.opts);
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
      role: b.role, bars: b.bars, context: b.context, autoNext: b.autoNext,
      shelf: { role: app.ui.shelf.role, sort: app.ui.shelf.sort, starred: app.ui.shelf.starred },
      loopSong: app.ui.loopSong,
    });
    persist();
  }

  // ======================= playback =======================
  const TAKE_TRACK = '__take';

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
      const tgt = R.sectionTarget(s, sec, length);
      let events = R.partEvents(part, tgt);
      for (const e of events) e.track = TAKE_TRACK;
      if (withSection) events = events.concat(R.sectionEvents(s, sec, { length, exclude: lane && lane.id }));
      const take = {
        patch: lane ? lane.patch : M.roleInfo(part.role).defaultPatch,
        volume: lane ? lane.volume : 0.75,
        mute: false,
        solo: false,
        channel: lane ? lane.channel : part.role === 'drums' ? 9 : 0,
      };
      const seq = R.sequence(s, events, length, true, { [TAKE_TRACK]: take });
      for (const k in seq.tracks) seq.tracks[k].solo = false; // solo is for the song sheet
      seq.partLength = partLen;
      return seq;
    }
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

  // live visuals: playheads, lane lights, meter
  let meterBuf = null;
  function frame() {
    const tr = Odd.transport;
    const p = app.ui.playing;
    const pos = tr && tr.playing && p ? tr.position() : null;

    const head = $('#booth-head');
    if (head) {
      const take = app.currentTake();
      if (p && p.kind === 'booth' && pos != null && take) {
        Odd.roll.head(head, pos % (take.bars * T.BAR), take.bars * T.BAR, { drums: take.role === 'drums' });
        head.dataset.on = '1';
      } else if (head.dataset.on) {
        Odd.roll.head(head, null);
        delete head.dataset.on;
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
    for (const el of $$('[data-arr-progress]')) {
      const i = Number(el.dataset.arrProgress);
      el.style.transform = 'scaleX(' + (i === liveArr ? frac : 0) + ')';
    }
    for (const el of $$('[data-section-col]')) el.classList.toggle('is-live', el.dataset.sectionCol === liveSection);

    // lane lights
    if (tr && tr.lastHit && Odd.audio && Odd.audio.ctx) {
      const now = Odd.audio.now();
      for (const el of $$('[data-led]')) {
        const hit = p ? tr.lastHit(el.dataset.led) : null;
        let level = 0;
        if (hit) {
          const age = now - hit.time;
          level = age >= 0 ? Math.max(0, 1 - age / 0.28) * (0.5 + 0.5 * hit.v / 127) : 0;
        }
        el.style.setProperty('--lit', level.toFixed(3));
      }
    }

    // meter
    const meter = $('#meter');
    if (meter && Odd.audio && Odd.audio.analyser && meter.clientWidth) {
      const an = Odd.audio.analyser;
      if (!meterBuf || meterBuf.length !== an.fftSize) meterBuf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(meterBuf);
      let peak = 0;
      for (let i = 0; i < meterBuf.length; i++) peak = Math.max(peak, Math.abs(meterBuf[i]));
      drawMeter(meter, peak);
    }
    requestAnimationFrame(frame);
  }

  let meterPeak = 0;
  function drawMeter(c, peak) {
    meterPeak = Math.max(peak, meterPeak * 0.92);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    const segs = 16;
    const gap = Math.max(1, dpr);
    const sw = (w - gap * (segs - 1)) / segs;
    const lit = Math.round(Math.min(1, meterPeak * 1.15) * segs);
    for (let i = 0; i < segs; i++) {
      const hot = i >= segs - 2;
      ctx.fillStyle = i < lit ? (hot ? cs.getPropertyValue('--tally') : cs.getPropertyValue('--keep')) : cs.getPropertyValue('--line');
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
    });
    part.id = M.uid('p');
    addTake(part, o.replace);
    return part;
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
    const v = Odd.gen.vary(cur, { seed: Odd.rng.newSeed(), amount: 0.35 });
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
    if (place) D.toast('Placed “' + cur.name + '” in ' + sec.name + ' › ' + laneName, { action: { label: 'Undo', run: undo } });
    else {
      D.toast('Kept “' + cur.name + '” on the shelf', { action: { label: 'Undo', run: undo } });
      if (app.ui.booth.autoNext) newTake();
    }
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
    const preview = (text) => {
      const prog = T.parseProg(text, section.bars);
      if (!prog) return '<span class="bad">Use roman numerals such as i VI III VII</span>';
      return Odd.views.mergeProg(prog).map((c) => esc(T.chordName(c.deg, tonic, s.scale)) + '<small>' + c.beats + '</small>').join(' ');
    };
    const result = await D.dialog({
      title: 'Chords for ' + section.name,
      body:
        '<label class="field"><span>Chords (' + section.bars + ' bars, ' + esc(Odd.views.keyName(s, section)) + ')</span>' +
        '<input type="text" id="dlg-chords" class="mono" value="' + esc(current) + '" autocomplete="off" spellcheck="false"></label>' +
        '<p class="chord-preview mono" id="dlg-chord-preview">' + preview(current) + '</p>' +
        '<p class="help">Roman numerals count up the scale from the key. Chords are built from the scale, so <span class="mono">V</span> and <span class="mono">v</span> mean the same chord. Chords share the bars evenly; add <span class="mono">:beats</span> to set a length, for example <span class="mono">i:8 VI:4 VII:4</span>.</p>',
      onOpen: (el) => {
        const inp = $('#dlg-chords', el);
        inp.addEventListener('input', () => { $('#dlg-chord-preview', el).innerHTML = preview(inp.value); });
      },
      actions: [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, validate: (el) => !!T.parseProg($('#dlg-chords', el).value, section.bars), value: (el) => $('#dlg-chords', el).value },
      ],
    });
    if (result == null) return;
    const prog = T.parseProg(result, section.bars);
    if (prog) commit('Edit chords', () => { section.prog = prog; });
  }

  function sectionMenu(anchor, section) {
    const s = app.session();
    D.menu(anchor, [
      { label: 'Rename…', run: async () => {
        const name = await D.prompt('Rename section', 'Name', section.name);
        if (name) commit('Rename section', () => { section.name = name; });
      } },
      { label: 'Edit chords…', run: () => editChords(section) },
      { label: 'New chords', run: () => commit('New chords', () => { section.prog = M.newProgression(s, section.bars); }) },
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
      const z = await Odd.exporter.stemsWav(s, (done, total, label) => {
        $('.toast-msg', el).textContent = 'Rendering ' + label + ' (' + Math.min(done + 1, total) + ' of ' + total + ')';
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
      body: '<p>This file has ' + incoming.sessions.length + (incoming.sessions.length === 1 ? ' session' : ' sessions') + ' and ' + incoming.library.length + ' shelf parts.</p><p class="help">Adding keeps everything you have now. Replacing swaps your whole workspace for the file. Either can be undone.</p>',
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
        ws.currentId = incoming.currentId;
      } else {
        const ids = new Set(ws.library.map((p) => p.id));
        for (const p of incoming.library) if (!ids.has(p.id)) ws.library.push(p);
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
      ['← →', 'Step through takes'], ['1 – 6', 'Switch stem: drums, bass, chords, pad, lead, arp'],
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

  function goTab(tab) {
    if (app.ui.tab === tab) return;
    app.ui.tab = tab;
    syncTabs();
    paint([tab, 'tabs']); // canvases need a visible panel to size themselves
  }

  // ======================= event wiring =======================
  const actions = {
    // top
    'play-song': () => toggle('song'),
    'session-menu': (el) => sessionMenu(el),
    'export-menu': (el) => exportMenu(el),
    'midi-setup': () => midiSetup(),
    help: () => helpDialog(),
    undo, redo,
    'toggle-fields': () => { app.ui.fieldsOpen = !app.ui.fieldsOpen; paint(['top']); },
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

    // song
    'select-cell': (el) => selectCell(el.dataset.section, el.dataset.lane),
    'select-section': (el) => { app.ui.sectionId = el.dataset.section; paint(['booth', 'shelf', 'song']); refreshIfAudition(); },
    'play-section': (el) => toggle('section', el.dataset.section),
    'section-menu': (el) => { const sec = M.findSection(app.session(), el.dataset.section); if (sec) sectionMenu(el, sec); },
    'edit-chords': (el) => { const sec = M.findSection(app.session(), el.dataset.section); if (sec) editChords(sec); },
    'new-chords': (el) => { const s = app.session(); const sec = M.findSection(s, el.dataset.section); if (sec) commit('New chords', () => { sec.prog = M.newProgression(s, sec.bars); }); },
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
      if (slot) commit('Toggle chord fit', () => { slot.refit = slot.refit === false; }, ['song']);
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
    scale: (el) => commit('Change mode', (s) => { s.scale = el.value; }),
    style: (el) => {
      const st = Odd.styles.get(el.value);
      commit('Change style', (s) => { M.applyStyle(s, el.value); });
      D.toast(st.label + ': ' + app.session().bpm + ' BPM, lane sounds updated. New takes use this style.');
    },
    'swing-commit': () => persist(),
    'booth-section': (el) => { app.ui.sectionId = el.value; paint(['booth', 'shelf', 'song']); refreshIfAudition(); },
    'booth-lane': (el) => { app.ui.laneId = el.value; paint(['booth', 'song']); refreshIfAudition(); },
    'booth-bars': (el) => { app.ui.booth.bars = Number(el.value); savePrefs(); rerollTake(); },
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

  function wire() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
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
    const themeChange = () => { Odd.roll.resetTokens(); paint(['booth', 'shelf', 'song']); };
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
      case 'ArrowLeft': if (!e.target.matches('input[type=range]')) { e.preventDefault(); stepTake(-1); } break;
      case 'ArrowRight': if (!e.target.matches('input[type=range]')) { e.preventDefault(); stepTake(1); } break;
      case 'Escape': stop(); break;
      case '?': helpDialog(); break;
      default:
        if (/^[1-6]$/.test(k)) setRole(Odd.gen.ROLES[Number(k) - 1]);
    }
  }

  // ======================= boot =======================
  function boot() {
    roots.top = $('#topbar');
    roots.booth = $('#booth');
    roots.shelf = $('#shelf');
    roots.song = $('#song');
    roots.tabs = $('#tabs');

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
    paint();
    if (firstRun) persist();
    requestAnimationFrame(frame);
    document.body.classList.add('is-ready');

    if (firstRun) {
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
    const b = app.ui.booth;
    if (pr.role && Odd.gen.ROLES.includes(pr.role)) b.role = pr.role;
    if ([1, 2, 4, 8, 16].includes(pr.bars)) b.bars = pr.bars;
    if (pr.context != null) b.context = !!pr.context;
    if (pr.autoNext != null) b.autoNext = !!pr.autoNext;
    if (pr.shelf) Object.assign(app.ui.shelf, pr.shelf, { query: '' });
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
