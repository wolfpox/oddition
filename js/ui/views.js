/* Oddition — view builders. Each returns { html, rolls } where rolls are the
 * canvases to draw once the HTML is in the page. State lives in Odd.app. */
(function (Odd) {
  'use strict';
  const T = Odd.theory;
  const R = Odd.render;
  const esc = (s) => Odd.dom.esc(s);
  const icon = (n, c) => Odd.icon(n, c);

  let rollSeq = 0;
  function rollSlot(rolls, opts, cls) {
    const id = 'roll-' + (++rollSeq);
    rolls.push({ id, opts });
    return '<canvas class="' + (cls || 'mini-roll') + '" id="' + id + '" aria-hidden="true"></canvas>';
  }

  function roleLabel(role) { return Odd.model.roleInfo(role).label; }
  function roleShort(role) { return Odd.model.roleInfo(role).short || role.slice(0, 3).toUpperCase(); }

  function tag(role) {
    return '<span class="tag" data-role="' + role + '">' + esc(roleShort(role)) + '</span>';
  }

  function keyName(session, section) {
    const tonic = T.mod(session.tonic + ((section && section.transpose) || 0), 12);
    return T.NOTE_NAMES[tonic] + ' ' + (T.SCALES[session.scale] ? T.SCALES[session.scale].label.toLowerCase() : session.scale);
  }

  function chordText(session, section) {
    return T.formatProg(mergeProg(section.prog), session.scale);
  }

  /** chords as shown: roman numerals, or chord names when the user prefers them */
  function chordShown(app, session, section) {
    return app.ws.prefs.chordNames ? chordNames(session, section) : chordText(session, section);
  }

  // join identical neighbours for display
  function mergeProg(prog) {
    const out = [];
    for (const c of prog) {
      const last = out[out.length - 1];
      if (last && T.sameChord(last, c)) last.beats += c.beats;
      else out.push(Object.assign(T.chordOnly(c), { beats: c.beats }));
    }
    return out;
  }

  function fmtTime(sec) {
    const s = Math.round(sec);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function patchOptions(selected, role) {
    const list = Odd.synth && Odd.synth.patchList ? Odd.synth.patchList(role) : [{ id: selected, label: selected, role }];
    const groups = {};
    const order = [];
    for (const p of list) {
      const g = p.role === role ? roleLabel(role) : roleLabel(p.role);
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(p);
    }
    return order.map((g) => '<optgroup label="' + esc(g) + '">' + groups[g].map((p) =>
      '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</optgroup>').join('');
  }

  // ======================= top bar =======================
  function top(app) {
    const s = app.session();
    const styles = Odd.styles ? Odd.styles.list() : [{ id: s.style, label: s.style }];
    const keys = T.NOTE_NAMES.map((n, i) => '<option value="' + i + '"' + (i === s.tonic ? ' selected' : '') + '>' + n + '</option>').join('');
    const scales = Object.keys(T.SCALES).map((k) => '<option value="' + k + '"' + (k === s.scale ? ' selected' : '') + '>' + esc(T.SCALES[k].label) + '</option>').join('');
    const styleOpts = styles.map((st) => '<option value="' + st.id + '"' + (st.id === s.style ? ' selected' : '') + '>' + esc(st.label) + '</option>').join('');
    const midiOn = Odd.webmidi && Odd.webmidi.mode !== 'internal' && Odd.webmidi.selectedId;
    const html =
      '<div class="top-row">' +
        '<div class="brand"><span class="wordmark">Oddition</span></div>' +
        '<button type="button" class="session-btn" data-act="session-menu" aria-haspopup="menu" aria-expanded="false" title="Sessions">' +
          '<span class="eyebrow">Session</span><span class="session-name">' + esc(s.name) + '</span>' + icon('chevron', 'ico-sm') +
        '</button>' +
        '<div class="transport">' +
          '<button type="button" class="play-main" data-act="play-song" data-play-key="song" aria-label="Play the song" title="Play the song from the top">' +
            '<span class="when-stopped">' + icon('play') + '</span><span class="when-playing">' + icon('stop') + '</span>' +
          '</button>' +
          '<div class="onair" id="onair" aria-live="polite"><span class="lamp"></span><span class="onair-text">Stopped</span></div>' +
        '</div>' +
        '<div class="top-actions">' +
          '<button type="button" class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo"' + (Odd.history.canUndo ? '' : ' disabled') + '>' + icon('undo') + '</button>' +
          '<button type="button" class="icon-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo"' + (Odd.history.canRedo ? '' : ' disabled') + '>' + icon('redo') + '</button>' +
          '<button type="button" class="icon-btn' + (midiOn ? ' is-on' : '') + '" data-act="midi-setup" title="MIDI output" aria-label="MIDI output">' + icon('midi') + '</button>' +
          '<button type="button" class="icon-btn" data-act="help" title="Shortcuts (?)" aria-label="Keyboard shortcuts">' + icon('help') + '</button>' +
          '<button type="button" class="btn btn-primary export-btn" data-act="export-menu" aria-haspopup="menu" aria-expanded="false">' + icon('download', 'ico-sm') + '<span>Export</span></button>' +
          '<button type="button" class="icon-btn fields-toggle" data-act="toggle-fields" aria-label="Session settings" aria-expanded="' + (app.ui.fieldsOpen ? 'true' : 'false') + '">' + icon('gear') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="fields' + (app.ui.fieldsOpen ? ' open' : '') + '">' +
        '<label class="fld fld-num"><span>Tempo</span><input type="number" id="f-bpm" data-change="bpm" min="40" max="240" step="1" value="' + s.bpm + '" inputmode="numeric"></label>' +
        '<label class="fld"><span>Key</span><select id="f-tonic" data-change="tonic">' + keys + '</select></label>' +
        '<label class="fld"><span>Mode</span><select id="f-scale" data-change="scale">' + scales + '</select></label>' +
        '<label class="fld"><span>Style</span><select id="f-style" data-change="style">' + styleOpts + '</select></label>' +
        '<label class="fld fld-range"><span>Volume</span><input type="range" id="f-master" data-input="master" min="0" max="1" step="0.01" value="' + (app.ws.prefs.master != null ? app.ws.prefs.master : 0.8) + '"></label>' +
        '<button type="button" class="btn btn-ghost btn-sm more-btn" data-act="toggle-more" aria-expanded="' + !!app.ui.moreOpen + '" title="Harmony, swing, feel, song shape and sound quality">' + icon('gear', 'ico-sm') + '<span>' + (app.ui.moreOpen ? 'Fewer settings' : 'More settings') + '</span></button>' +
        '<canvas class="meter" id="meter" aria-hidden="true"></canvas>' +
        '<div class="fields-more' + (app.ui.moreOpen ? ' open' : '') + '">' +
          harmonyField(s) +
          '<label class="fld fld-range"><span>Swing <output id="o-swing">' + Math.round(s.swing * 200) + '%</output></span>' +
            '<input type="range" id="f-swing" data-input="swing" data-change="swing-commit" min="0" max="0.5" step="0.01" value="' + s.swing + '"></label>' +
          shapeFields(s) +
          qualityField(app) +
        '</div>' +
        '<div class="phone-only fields-extra">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="midi-setup">' + icon('midi', 'ico-sm') + 'MIDI output</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="redo"' + (Odd.history.canRedo ? '' : ' disabled') + '>' + icon('redo', 'ico-sm') + 'Redo</button>' +
        '</div>' +
      '</div>';
    return { html, rolls: [] };
  }

  const HARMONY_LEVELS = [[0, 'Plain'], [0.3, 'Some colour'], [0.6, 'Colourful'], [0.9, 'Rich']];

  /** how often new chords reach outside the key; shows the nearest level */
  function harmonyField(s) {
    const h = Odd.model.harmonyOf(s);
    let near = HARMONY_LEVELS[0][0];
    for (const [v] of HARMONY_LEVELS) if (Math.abs(v - h) < Math.abs(near - h)) near = v;
    return '<label class="fld" title="How often New chords uses chords from outside the key: borrowed chords, secondary dominants, the Neapolitan. Chords you already have stay as they are."><span>Harmony</span>' +
      '<select id="f-harmony" data-change="harmony">' + HARMONY_LEVELS.map(([v, l]) => '<option value="' + v + '"' + (v === near ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
  }

  function shapeFields(s) {
    if (!Odd.shape) return '';
    const cfg = Odd.shape.settings(s);
    return '<label class="fld fld-range" title="Small timing and velocity differences, like a person playing"><span>Feel <output id="o-feel">' + Math.round(cfg.humanize * 100) + '%</output></span>' +
        '<input type="range" id="f-feel" data-input="feel" data-change="feel-commit" min="0" max="1" step="0.05" value="' + cfg.humanize + '"></label>' +
      '<label class="fld" title="Section energy, swells into new sections, fills and builds. Off plays the song exactly as the parts are written"><span>Shape</span>' +
        '<select id="f-shape" data-change="shape-on"><option value="on"' + (cfg.on ? ' selected' : '') + '>On</option><option value="off"' + (cfg.on ? '' : ' selected') + '>Off</option></select></label>';
  }

  /** five-step energy meter for a section header */
  function energyMeter(s, sec) {
    if (!Odd.shape) return '';
    const cfg = Odd.shape.settings(s);
    const e = Odd.shape.energyOf(sec);
    const auto = Odd.shape.isAuto(sec);
    const lit = Math.max(1, Math.round(e * 5));
    let bars = '';
    for (let i = 0; i < 5; i++) bars += '<i' + (i < lit ? ' class="on"' : '') + '></i>';
    const entry = Odd.shape.entryOf(sec);
    const title = 'Energy ' + Math.round(e * 100) + '%' + (auto ? ' (from the name)' : '') + ' · Entry: ' + Odd.shape.ENTRY_LABELS[entry] + (cfg.on ? '' : ' · Shape is off');
    return '<button type="button" class="nrg-btn' + (auto ? ' is-auto' : '') + (cfg.on ? '' : ' is-off') + '" data-act="section-shape" data-section="' + sec.id + '" aria-label="' + esc('Energy and entry for ' + sec.name + ': ' + title) + '" title="' + esc(title) + '">' +
      '<span class="nrg" aria-hidden="true">' + bars + '</span></button>';
  }

  function qualityField(app) {
    if (!Odd.audio || !Odd.audio.setQuality) return '';
    const set = app.ws.prefs.quality || 'auto';
    const now = Odd.audio.quality;
    const opts = [
      ['auto', set === 'auto' ? 'Auto (' + (now === 'light' ? 'Light' : 'Full') + ')' : 'Auto'],
      ['light', 'Light'],
      ['full', 'Full'],
    ];
    return '<label class="fld" title="Light needs less processing: use it if playback crackles or cuts out"><span>Sound</span>' +
      '<select id="f-quality" data-change="quality">' + opts.map(([v, l]) => '<option value="' + v + '"' + (v === set ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
  }

  // ======================= booth =======================
  function booth(app) {
    const s = app.session();
    const b = app.ui.booth;
    const sec = app.boothSection();
    const lane = app.boothLane();
    const take = app.currentTake();
    const takes = app.takesFor(b.role);
    const rolls = [];

    const roles = Odd.gen.ROLES.map((role, i) =>
      '<button type="button" class="role-btn' + (role === b.role ? ' is-active' : '') + '" data-act="booth-role" data-role="' + role + '" role="tab" aria-selected="' + (role === b.role) + '">' +
        '<span class="dot" data-role="' + role + '"></span><span>' + esc(roleLabel(role)) + '</span><kbd>' + (i + 1) + '</kbd></button>').join('');

    const sectionOpts = s.sections.map((x) => '<option value="' + x.id + '"' + (x.id === sec.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    const roleLanes = s.lanes.filter((l) => l.role === b.role);
    const laneSel = roleLanes.length > 1
      ? '<select id="b-lane" data-change="booth-lane" aria-label="Lane">' + roleLanes.map((l) => '<option value="' + l.id + '"' + (lane && l.id === lane.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select>'
      : '<span class="target-lane">' + esc(lane ? lane.name : roleLabel(b.role)) + '</span>';
    const barsOpts = [1, 2, 4, 8, 16].map((n) => '<option value="' + n + '"' + (n === b.bars ? ' selected' : '') + '>' + n + (n === 1 ? ' bar' : ' bars') + '</option>').join('');

    let slate;
    if (take) {
      const r = app.boothRoll(take);
      const kept = !!Odd.model.findPart(app.ws, take.id);
      slate =
        '<div class="slate">' +
          '<div class="slate-line">' +
            '<span class="take-no">Take ' + String(take.take || 1).padStart(3, '0') + '</span>' +
            '<span class="slate-sep"></span>' +
            '<span class="mono">seed ' + (take.seed >>> 0).toString(16).padStart(8, '0') + '</span>' +
            (take.parent && !take.edited ? '<span class="pill">variation</span>' : '') +
            (take.edited ? '<span class="pill">edited</span>' : '') +
            (kept ? '<span class="pill pill-keep">' + icon('check', 'ico-xs') + 'on the shelf</span>' : '') +
          '</div>' +
          '<h3 class="take-name">' + esc(take.name) + '</h3>' +
          '<p class="take-meta">' + esc(roleLabel(take.role)) + ' · ' + take.bars + (take.bars === 1 ? ' bar' : ' bars') + ' · ' +
            esc(Odd.model.styleOf(take.style).label) + ' · ' + esc(keyName(s, sec)) + ' · ' + r.events.length + ' notes</p>' +
          (take.heard && take.heard.length ? '<p class="take-heard" title="How this take fits the parts already in the section">' + icon('headphones', 'ico-xs') + esc(take.heard.join(' · ')) + '</p>' : '') +
        '</div>' +
        '<div class="screen' + (b.edit ? ' is-editing' : '') + '"' + (b.edit ? '' : ' draggable="true" data-drag="take" title="Drag out as a MIDI file (Chrome)"') + '>' +
          rollSlot(rolls, {
            events: r.events, length: r.length, drums: T.isDrumRole(take.role), role: take.role, chords: r.chords,
            rowsAlways: b.edit ? EDIT_ROWS[take.role] : null, locked: lockedBars(b, take),
          }, 'roll-base') +
          '<canvas class="roll-head" id="booth-head" aria-hidden="true"></canvas>' +
        '</div>';
    } else {
      slate = '<div class="slate"><h3 class="take-name">No take yet</h3><p class="take-meta">Press New take to hear the first idea.</p></div><div class="screen"></div>';
    }

    const list = takes.list;
    // edit notes, and bars to keep when re-rolling
    let tools = '';
    if (take) {
      const locks = lockedBars(b, take);
      let barBtns = '';
      for (let i = 0; i < take.bars; i++) {
        const on = locks.includes(i);
        barBtns += '<button type="button" class="lock-btn' + (on ? ' is-on' : '') + '" data-act="lock-bar" data-index="' + i + '" aria-pressed="' + on + '" title="' + (on ? 'Bar ' + (i + 1) + ' is kept: Reject and Vary only change the other bars' : 'Keep bar ' + (i + 1) + ' when re-rolling') + '">' + (on ? icon('lock', 'ico-xs') : '') + (i + 1) + '</button>';
      }
      tools = '<div class="take-tools">' +
        '<button type="button" class="tiny-toggle' + (b.edit ? ' is-on' : '') + '" data-act="booth-edit" aria-pressed="' + !!b.edit + '" title="Click the roll to add a note, click a note to remove it, drag a note up or down to change how hard it is played">' + icon('edit', 'ico-xs') + ' Edit notes</button>' +
        '<span class="locks" title="Kept bars stay when you press Reject or Vary; only the others change">' +
          '<span class="locks-label">Keep bars</span>' + barBtns +
        '</span>' +
        (b.edit ? '<span class="edit-hint">Click to add · click a note to remove · drag a note up or down for louder or softer</span>' : '') +
      '</div>';
    }
    const strip = list.length
      ? '<div class="takes" aria-label="Takes for ' + esc(roleLabel(b.role)) + '">' +
        '<button type="button" class="icon-btn icon-btn-sm" data-act="take-prev" aria-label="Previous take" title="Previous take (←)"' + (takes.index > 0 ? '' : ' disabled') + '>' + icon('back') + '</button>' +
        '<div class="take-dots">' + list.slice(-24).map((t, i) => {
          const idx = list.length - Math.min(24, list.length) + i;
          const kept = !!Odd.model.findPart(app.ws, t.id);
          return '<button type="button" class="take-dot' + (idx === takes.index ? ' is-current' : '') + (kept ? ' is-kept' : '') + '" data-act="take-goto" data-index="' + idx + '" aria-label="Take ' + (t.take || idx + 1) + (kept ? ', kept' : '') + '" title="Take ' + (t.take || idx + 1) + ': ' + esc(t.name) + '"></button>';
        }).join('') + '</div>' +
        '<button type="button" class="icon-btn icon-btn-sm" data-act="take-next" aria-label="Next take" title="Next take (→)"' + (takes.index < list.length - 1 ? '' : ' disabled') + '>' + icon('fwd') + '</button>' +
        '<span class="takes-count mono">' + (takes.index + 1) + '/' + list.length + '</span>' +
        '</div>'
      : '';

    const params = Odd.gen.params(b.role).map((p) => {
      const val = app.paramValue(b.role, p.key);
      const id = 'p-' + b.role + '-' + p.key;
      if (p.type === 'select') {
        return '<label class="param"><span class="param-label">' + esc(p.label) + '</span><select id="' + id + '" data-change="param" data-key="' + p.key + '"' + (p.hint ? ' title="' + esc(p.hint) + '"' : '') + '>' +
          p.options.map((o) => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(val) ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select></label>';
      }
      return '<label class="param"' + (p.hint ? ' title="' + esc(p.hint) + '"' : '') + '><span class="param-label">' + esc(p.label) + '<output id="o-' + id + '">' + fmtParam(p, val) + '</output></span>' +
        '<input type="range" id="' + id + '" data-input="param-live" data-change="param" data-key="' + p.key + '" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" value="' + val + '"></label>';
    }).join('');

    const html =
      '<div class="panel-head">' +
        '<h2 class="panel-title">' + icon('booth', 'ico-title') + 'Audition booth</h2>' +
        '<div class="booth-target">' +
          '<label class="inline-fld"><span>Section</span><select id="b-section" data-change="booth-section">' + sectionOpts + '</select></label>' +
          '<span class="chord-line mono" title="Chords of ' + esc(sec.name) + '">' + esc(chordShown(app, s, sec)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="roles" role="tablist" aria-label="Stem">' + roles + '</div>' +
      '<div class="take-area" data-role="' + b.role + '">' + slate + tools + strip + '</div>' +
      '<div class="pads">' +
        '<button type="button" class="pad pad-reject" data-act="reject" title="Reject and play a new take (X)">' + icon('x') + '<span>' + (take ? 'Reject' : 'New take') + '</span><kbd>X</kbd></button>' +
        '<button type="button" class="pad pad-vary" data-act="vary" title="Variation of this take (V)"' + (take ? '' : ' disabled') + '>' + icon('vary') + '<span>Vary</span><kbd>V</kbd></button>' +
        '<button type="button" class="pad pad-play" data-act="play-booth" data-play-key="booth" title="Play or stop (Space)"' + (take ? '' : ' disabled') + '>' +
          '<span class="when-stopped">' + icon('play') + '</span><span class="when-playing">' + icon('stop') + '</span><span class="when-stopped">Play</span><span class="when-playing">Stop</span><kbd>Space</kbd></button>' +
        '<button type="button" class="pad pad-keep" data-act="keep" title="Keep on the shelf (K)"' + (take ? '' : ' disabled') + '>' + icon('check') + '<span>Keep</span><kbd>K</kbd></button>' +
      '</div>' +
      '<div class="booth-row">' +
        '<div class="place-group">' +
          '<button type="button" class="btn btn-ghost" data-act="keep-place"' + (take ? '' : ' disabled') + ' title="Keep it and put it in the song (P)">' + icon('place', 'ico-sm') +
            '<span>Keep &amp; place</span><kbd>P</kbd></button>' +
          '<span class="place-target">in <strong>' + esc(sec.name) + '</strong> › ' + laneSel + '</span>' +
        '</div>' +
        '<label class="toggle"><input type="checkbox" id="b-context" data-change="booth-context"' + (b.context ? ' checked' : '') + '><span>Play with the section</span></label>' +
        '<label class="toggle" title="New takes hear the parts already in the section: bass locks to the kick, busy sections get sparser takes, crowded octaves are avoided, the arp leaves room for the lead"><input type="checkbox" id="b-listen" data-change="booth-listen"' + (b.listen ? ' checked' : '') + '><span>Listen to the section</span></label>' +
        '<label class="inline-fld"><span class="sr-only">Length</span><select id="b-bars" data-change="booth-bars">' + barsOpts + '</select></label>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="take-midi"' + (take ? '' : ' disabled') + ' title="Download this take as a MIDI file">' + icon('download', 'ico-sm') + '<span>.mid</span></button>' +
      '</div>' +
      '<div class="params">' + params +
        '<button type="button" class="btn btn-ghost btn-sm params-reset" data-act="params-reset" title="Reset these controls">Reset</button>' +
      '</div>';
    return { html, rolls };
  }

  // drum rows always offered while editing, so a sound that isn't there yet can be added
  const EDIT_ROWS = {
    drums: ['KICK', 'SNARE', 'CLAP', 'RIM', 'HAT', 'OPEN HAT', 'TOM LO', 'TOM HI', 'CRASH'],
    perc: ['CONGA', 'BONGO', 'SHAKER', 'BELL', 'PERC', 'TIMBALE'],
  };

  /** bars kept from re-rolling, for this take */
  function lockedBars(b, take) {
    return (b.locks || []).filter((i) => i < take.bars);
  }

  function fmtParam(p, v) {
    if (p.key === 'octave') return (v > 0 ? '+' : '') + v;
    if (p.max === 1 && p.min === 0) return Math.round(v * 100) + '%';
    return String(v);
  }

  // ======================= shelf =======================
  function shelf(app) {
    const s = app.session();
    const f = app.ui.shelf;
    const rolls = [];
    const all = app.ws.library;
    const counts = {};
    for (const p of all) counts[p.role] = (counts[p.role] || 0) + 1;
    const parts = app.shelfParts();

    const chips = ['all'].concat(Odd.gen.ROLES).map((r) =>
      '<button type="button" class="chip' + (f.role === r ? ' is-active' : '') + '" data-act="shelf-role" data-role="' + r + '" aria-pressed="' + (f.role === r) + '">' +
      (r === 'all' ? 'All' : '<span class="dot" data-role="' + r + '"></span>' + esc(roleLabel(r))) +
      '<span class="chip-n">' + (r === 'all' ? all.length : counts[r] || 0) + '</span></button>').join('');

    const sel = app.selectedSlot();
    const cards = parts.map((p) => {
      const used = Odd.model.usageCount(app.ws, p.id);
      const len = p.bars * T.BAR;
      const evs = R.partEvents(p, { tonic: s.tonic, scale: s.scale, prog: p.ctx.prog, length: len });
      const playing = app.isPlaying('preview', p.id);
      return '<li class="card" data-part="' + p.id + '" data-role="' + p.role + '" draggable="true">' +
        '<div class="card-top">' + tag(p.role) +
          '<span class="card-name" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
          '<button type="button" class="icon-btn icon-btn-sm star' + (p.starred ? ' is-on' : '') + '" data-act="part-star" data-id="' + p.id + '" aria-pressed="' + !!p.starred + '" aria-label="Favourite">' + icon(p.starred ? 'starFill' : 'star') + '</button>' +
        '</div>' +
        rollSlot(rolls, { events: evs, length: len, drums: T.isDrumRole(p.role), role: p.role, mini: true }) +
        '<div class="card-bottom">' +
          '<span class="card-meta">' + p.bars + (p.bars === 1 ? ' bar' : ' bars') + ' · ' + esc(Odd.model.styleOf(p.style).label) + (used ? ' · in ' + used + (used === 1 ? ' slot' : ' slots') : '') + '</span>' +
          '<span class="card-actions">' +
            '<button type="button" class="icon-btn icon-btn-sm' + (playing ? ' is-playing' : '') + '" data-act="part-preview" data-id="' + p.id + '" data-play-key="preview:' + p.id + '" aria-label="Preview in ' + esc(app.boothSection().name) + '" title="Preview in ' + esc(app.boothSection().name) + '"><span class="when-stopped">' + icon('play') + '</span><span class="when-playing">' + icon('stop') + '</span></button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="part-place" data-id="' + p.id + '" title="Put it in ' + esc(sel.section.name) + '">Place</button>' +
            '<button type="button" class="icon-btn icon-btn-sm" data-act="part-menu" data-id="' + p.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="More">' + icon('dots') + '</button>' +
          '</span>' +
        '</div>' +
      '</li>';
    }).join('');

    let empty = '';
    if (!all.length) {
      empty = '<div class="empty"><p class="empty-title">The shelf is empty</p><p>Parts you keep in the booth land here. Press <kbd>K</kbd> on a take you like.</p></div>';
    } else if (!parts.length) {
      empty = '<div class="empty"><p class="empty-title">Nothing matches</p><p>Try another stem or clear the search.</p></div>';
    }

    const sorts = [['new', 'Newest'], ['old', 'Oldest'], ['name', 'Name'], ['role', 'Stem']].map(([v, l]) =>
      '<option value="' + v + '"' + (f.sort === v ? ' selected' : '') + '>' + l + '</option>').join('');

    const html =
      '<div class="panel-head">' +
        '<h2 class="panel-title">' + icon('shelf', 'ico-title') + 'Shelf <span class="count mono">' + all.length + '</span></h2>' +
        '<div class="panel-tools">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="import-midi" title="Add a MIDI file to the shelf">' + icon('upload', 'ico-sm') + '<span>Import MIDI</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="chips" role="toolbar" aria-label="Filter by stem">' + chips + '</div>' +
      '<div class="shelf-tools">' +
        '<input type="search" id="shelf-q" data-input="shelf-query" placeholder="Find a part by name" value="' + esc(f.query) + '" aria-label="Find a part">' +
        '<button type="button" class="icon-btn star' + (f.starred ? ' is-on' : '') + '" data-act="shelf-starred" aria-pressed="' + !!f.starred + '" aria-label="Only favourites" title="Only favourites">' + icon(f.starred ? 'starFill' : 'star') + '</button>' +
        '<select id="shelf-sort" data-change="shelf-sort" aria-label="Sort">' + sorts + '</select>' +
      '</div>' +
      (empty || '<ul class="cards">' + cards + '</ul>');
    return { html, rolls };
  }

  // ======================= song =======================
  function song(app) {
    const s = app.session();
    const rolls = [];
    const sel = app.selectedSlot();
    const bars = Odd.model.songBars(s);

    // arrangement strip; the fill behind each chip is its energy
    const shapeOn = !!(Odd.shape && Odd.shape.settings(s).on);
    const planned = new Map();
    if (Odd.shape) for (const en of Odd.shape.plan(s)) planned.set(en.index, en);
    const chips = s.arrangement.map((sid, i) => {
      const sec = Odd.model.findSection(s, sid);
      if (!sec) return '';
      const hue = sectionHue(s, sid);
      const isSel = app.ui.arrIndex === i;
      const en = planned.get(i);
      const energy = en ? en.energy : 0.5;
      const entry = shapeOn && en ? en.entry : 'none';
      const entryText = entry !== 'none' ? ' Enters with ' + Odd.shape.ENTRY_LABELS[entry].toLowerCase() + '.' : '';
      const energyText = shapeOn ? ' Energy ' + Math.round(energy * 100) + '%.' : '';
      return '<li class="arr-item' + (isSel ? ' is-selected' : '') + '" style="--sec-hue:' + hue + ';flex-grow:' + sec.bars + ';--energy:' + energy.toFixed(2) + '" data-arr="' + i + '">' +
        '<button type="button" class="arr-chip" data-act="arr-select" data-index="' + i + '" title="' + esc(sec.name) + ', ' + sec.bars + ' bars.' + energyText + entryText + ' Double-click to play from here">' +
          (shapeOn ? '<span class="arr-energy" aria-hidden="true"></span>' : '') +
          (entry !== 'none' ? '<span class="arr-entry arr-entry-' + entry + '" aria-hidden="true"></span>' : '') +
          '<span class="arr-name">' + esc(sec.name) + '</span><span class="arr-bars mono">' + sec.bars + '</span>' +
          '<span class="arr-progress" data-arr-progress="' + i + '"></span>' +
        '</button>' +
        (isSel
          ? '<span class="arr-tools">' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="arr-left" data-index="' + i + '" aria-label="Move earlier"' + (i > 0 ? '' : ' disabled') + '>' + icon('back') + '</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="arr-play" data-index="' + i + '" aria-label="Play from here">' + icon('play') + '</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="arr-right" data-index="' + i + '" aria-label="Move later"' + (i < s.arrangement.length - 1 ? '' : ' disabled') + '>' + icon('fwd') + '</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="arr-remove" data-index="' + i + '" aria-label="Remove from the song">' + icon('x') + '</button>' +
            '</span>'
          : '') +
      '</li>';
    }).join('');

    // material that recurs across sections gets a letter
    const themes = Odd.model.themes ? Odd.model.themes(s) : new Map();

    // grid
    const cols = s.sections.length;
    let grid = '<div class="sheet" style="--cols:' + cols + '" role="grid" aria-label="Song sheet">';
    grid += '<div class="corner" role="columnheader"><span class="eyebrow">Lanes</span><button type="button" class="btn btn-ghost btn-sm" data-act="add-lane" aria-haspopup="menu" aria-expanded="false">' + icon('plus', 'ico-sm') + 'Lane</button></div>';
    for (const sec of s.sections) {
      const isSel = sec.id === sel.section.id;
      const sizes = [1, 2, 4, 8, 12, 16, 24, 32];
      if (!sizes.includes(sec.bars)) sizes.push(sec.bars);
      sizes.sort((a, b) => a - b);
      const bOpts = sizes.map((n) => '<option value="' + n + '"' + (n === sec.bars ? ' selected' : '') + '>' + n + '</option>').join('');
      grid += '<div class="sec-head' + (isSel ? ' is-selected' : '') + '" data-section-col="' + sec.id + '" style="--sec-hue:' + sectionHue(s, sec.id) + '" role="columnheader">' +
        '<div class="sec-line">' +
          '<button type="button" class="sec-name" data-act="select-section" data-section="' + sec.id + '">' + esc(sec.name) + '</button>' +
          '<button type="button" class="icon-btn icon-btn-sm" data-act="play-section" data-section="' + sec.id + '" data-play-key="section:' + sec.id + '" aria-label="Loop ' + esc(sec.name) + '" title="Loop this section"><span class="when-stopped">' + icon('play') + '</span><span class="when-playing">' + icon('stop') + '</span></button>' +
          '<button type="button" class="icon-btn icon-btn-sm" data-act="section-menu" data-section="' + sec.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="Section options">' + icon('dots') + '</button>' +
        '</div>' +
        '<div class="sec-line sec-line-2">' +
          '<label class="bars-fld"><select id="sb-' + sec.id + '" data-change="section-bars" data-section="' + sec.id + '" aria-label="Bars in ' + esc(sec.name) + '">' + bOpts + '</select><span>bars</span></label>' +
          energyMeter(s, sec) +
          (sec.transpose ? '<span class="pill mono">' + (sec.transpose > 0 ? '+' : '') + sec.transpose + '</span>' : '') +
          '<button type="button" class="chords-btn mono" data-act="edit-chords" data-section="' + sec.id + '" title="Edit chords: ' + esc(app.ws.prefs.chordNames ? chordText(s, sec) : chordNames(s, sec)) + '">' + esc(chordShown(app, s, sec)) + '</button>' +
          '<button type="button" class="icon-btn icon-btn-xs" data-act="new-chords" data-section="' + sec.id + '" aria-label="New chords for ' + esc(sec.name) + '" title="New chords">' + icon('dice') + '</button>' +
        '</div>' +
        typeLine(sec) +
      '</div>';
    }

    for (const lane of s.lanes) {
      grid += '<div class="lane-head" data-lane-row="' + lane.id + '" data-role="' + lane.role + '" role="rowheader">' +
        '<div class="lane-line">' +
          '<span class="led" data-led="' + lane.id + '" data-role="' + lane.role + '"></span>' +
          '<button type="button" class="lane-name" data-act="lane-menu" data-lane="' + lane.id + '" aria-haspopup="menu" aria-expanded="false" title="' + esc(lane.name) + ' · MIDI channel ' + (lane.channel + 1) + '">' + esc(lane.name) + '</button>' +
          '<button type="button" class="ms' + (lane.mute ? ' is-on' : '') + '" data-act="lane-mute" data-lane="' + lane.id + '" aria-pressed="' + !!lane.mute + '" title="Mute">M</button>' +
          '<button type="button" class="ms ms-solo' + (lane.solo ? ' is-on' : '') + '" data-act="lane-solo" data-lane="' + lane.id + '" aria-pressed="' + !!lane.solo + '" title="Solo">S</button>' +
        '</div>' +
        '<div class="lane-line">' +
          '<select class="patch-sel" id="lp-' + lane.id + '" data-change="lane-patch" data-lane="' + lane.id + '" aria-label="Sound for ' + esc(lane.name) + '">' + patchOptions(lane.patch, lane.role) + '</select>' +
          '<input type="range" class="vol" id="lv-' + lane.id + '" data-input="lane-volume" data-change="lane-volume-commit" data-lane="' + lane.id + '" min="0" max="1" step="0.01" value="' + lane.volume + '" aria-label="Volume for ' + esc(lane.name) + '">' +
        '</div>' +
      '</div>';
      for (const sec of s.sections) {
        const slot = sec.slots[lane.id];
        const isSel = sec.id === sel.section.id && sel.lane && lane.id === sel.lane.id;
        let inner;
        const span = slot && slot.part ? Odd.model.slotSpan(sec, slot) : null;
        if (slot && slot.part) {
          const len = sec.bars * T.BAR;
          // as written, but only in the bars the slot plays
          const evs = R.sectionEvents(s, sec, { only: lane.id, shape: false });
          const th = slot.sourceId ? themes.get(slot.sourceId) : null;
          const form = slot.form && slot.form !== 'full' ? R.FORM_LABELS[slot.form] : '';
          const where = th ? th.uses.filter((u) => u.section.id !== sec.id).map((u) => u.section.name + (u.form !== 'full' ? ' (' + R.FORM_LABELS[u.form].toLowerCase() + ')' : '')) : [];
          inner = '<span class="cell-name">' +
              (th ? '<span class="theme-badge" title="' + esc('Theme ' + th.letter + ': also in ' + [...new Set(where)].join(', ')) + '">' + th.letter + '</span>' : '') +
              esc(slot.part.name) +
              (form ? ' <span class="form-tag">' + esc(form.toLowerCase()) + '</span>' : '') + '</span>' +
            (slot.oct ? '<span class="pill mono cell-oct">' + (slot.oct > 0 ? '+' : '') + slot.oct + ' oct</span>' : '') +
            spanBar(sec, span) +
            rollSlot(rolls, { events: evs, length: len, drums: T.isDrumRole(slot.part.role), role: lane.role, mini: true });
        } else {
          inner = '<span class="cell-empty">' + icon('plus', 'ico-sm') + '</span>';
        }
        let tools = '';
        if (isSel) {
          if (slot && slot.part) {
            tools = '<div class="cell-tools">' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="cell-swap" data-dir="-1" aria-label="Previous part from the shelf" title="Swap in the previous ' + esc(roleLabel(lane.role)) + ' from the shelf">' + icon('back') + '</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="cell-swap" data-dir="1" aria-label="Next part from the shelf" title="Swap in the next ' + esc(roleLabel(lane.role)) + ' from the shelf">' + icon('fwd') + '</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="cell-oct" data-dir="-1" aria-label="Octave down" title="Octave down">' + icon('minus') + '</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="cell-oct" data-dir="1" aria-label="Octave up" title="Octave up">' + icon('plus') + '</button>' +
              (!T.isDrumRole(lane.role) ? '<button type="button" class="tiny-toggle' + (slot.refit !== false ? ' is-on' : '') + '" data-act="cell-refit" aria-pressed="' + (slot.refit !== false) + '" title="Follow this section\'s chords">Fit</button>' : '') +
              '<button type="button" class="tiny-toggle' + (span.full ? '' : ' is-on') + '" data-act="cell-span" title="Which bars of the section this part plays">Bars</button>' +
              '<button type="button" class="tiny-toggle' + (slot.form && slot.form !== 'full' ? ' is-on' : '') + '" data-act="cell-form" aria-haspopup="menu" aria-expanded="false" title="Play this part another way here: outline, tease, fragment, half-time">Form</button>' +
              '<button type="button" class="tiny-toggle" data-act="cell-reuse" title="Use this part in other sections, as a theme that comes back">Reuse</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="cell-audition" aria-label="Audition another" title="Audition a replacement in the booth">' + icon('booth') + '</button>' +
              '<button type="button" class="icon-btn icon-btn-xs" data-act="cell-clear" aria-label="Clear slot" title="Clear">' + icon('trash') + '</button>' +
            '</div>';
          } else {
            tools = '<div class="cell-tools cell-tools-empty">' +
              '<button type="button" class="btn btn-ghost btn-xs" data-act="cell-audition">' + icon('booth', 'ico-xs') + 'Audition</button>' +
              '<button type="button" class="btn btn-ghost btn-xs" data-act="cell-swap" data-dir="1">' + icon('shelf', 'ico-xs') + 'From shelf</button>' +
            '</div>';
          }
        }
        grid += '<div class="cell' + (slot ? ' is-filled' : '') + (span && span.out ? ' is-out' : '') + (isSel ? ' is-selected' : '') + (lane.mute ? ' is-muted' : '') +
          '" data-act="select-cell" data-section="' + sec.id + '" data-lane="' + lane.id + '" data-role="' + lane.role + '" data-drop="cell" tabindex="0" role="gridcell" aria-selected="' + isSel + '"' +
          ' aria-label="' + esc(sec.name + ', ' + lane.name + ': ' + (slot ? slot.part.name : 'empty')) + '">' + inner + tools + '</div>';
      }
    }
    grid += '</div>';

    const addOpts = s.sections.map((x) => ({ id: x.id, name: x.name }));
    const html =
      '<div class="panel-head">' +
        '<h2 class="panel-title">' + icon('song', 'ico-title') + 'Song</h2>' +
        '<span class="song-stats mono">' + bars + ' bars · ' + fmtTime(Odd.model.songSeconds(s)) + '</span>' +
        '<div class="panel-tools">' +
          '<button type="button" class="btn btn-sm btn-ghost chord-mode" data-act="chord-mode" aria-pressed="' + !!app.ws.prefs.chordNames + '" title="Show chords as ' + (app.ws.prefs.chordNames ? 'roman numerals (i VI III VII)' : 'chord names (Am F C G)') + '"><span class="mono">' + (app.ws.prefs.chordNames ? 'Am F' : 'i VI') + '</span></button>' +
          '<button type="button" class="btn btn-sm' + (app.ui.loopSong ? ' is-on' : ' btn-ghost') + '" data-act="loop-song" aria-pressed="' + !!app.ui.loopSong + '" title="Loop the whole song">' + icon('loop', 'ico-sm') + '<span>Loop</span></button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="add-section">' + icon('plus', 'ico-sm') + '<span>Section</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="arr-wrap">' +
        '<span class="eyebrow arr-label" title="The order sections play in. A section can appear more than once.">Song order</span>' +
        '<ol class="arrangement" aria-label="Song order">' + chips + '</ol>' +
        '<button type="button" class="btn btn-ghost btn-sm arr-add" data-act="arr-add" aria-haspopup="menu" aria-expanded="false" title="Add a section to the song order"' + (addOpts.length ? '' : ' disabled') + '>' + icon('plus', 'ico-sm') + '<span>Add</span></button>' +
      '</div>' +
      storyLine(s, sel.section) +
      '<div class="sheet-wrap">' + grid + '</div>' +
      '<p class="hint">Each section appears once on the sheet; the song order above says when it plays. Select a slot, then audition or pick from the shelf. Drag shelf cards onto slots. Parts follow each section\'s chords.</p>';
    return { html, rolls };
  }

  const CURVE_PATHS = {
    rise: 'M1 11 L21 2', fall: 'M1 2 L21 11', swell: 'M1 11 Q11 -7 21 11', dip: 'M1 2 Q11 20 21 2',
  };
  function curveGlyph(curve) {
    const d = CURVE_PATHS[curve];
    if (!d) return '';
    return '<svg class="curve-glyph" viewBox="0 0 22 13" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  /** the section's type and energy curve */
  function typeLine(sec) {
    if (!Odd.recipes) return '';
    const r = sec.recipe && Odd.recipes.get(sec.recipe);
    const curve = sec.curve && sec.curve !== 'flat' ? sec.curve : null;
    const curveLabel = curve && Odd.shape ? Odd.shape.CURVE_LABELS[curve] : '';
    return '<div class="sec-line sec-line-3">' +
      '<button type="button" class="type-btn' + (r ? ' is-set' : '') + '" data-act="section-type" data-section="' + sec.id + '" title="Section type: how this section sets up or pays off">' +
        (r ? esc(r.label) : 'Choose a type…') + '</button>' +
      (curve ? '<span class="curve-tag" title="Energy: ' + esc(curveLabel) + '">' + curveGlyph(curve) + '</span>' : '') +
    '</div>';
  }

  /** a thin track under a slot's name showing the bars it plays */
  function spanBar(sec, span) {
    if (!span || span.full) return '';
    if (span.out) return '<span class="span-note">Sits out</span>';
    const a = (span.from / sec.bars) * 100, w = ((span.to - span.from) / sec.bars) * 100;
    const label = span.to === sec.bars ? 'from bar ' + (span.from + 1) : span.from === 0 ? 'until bar ' + span.to : 'bars ' + (span.from + 1) + '–' + span.to;
    return '<span class="span-bar" title="Plays ' + label + '"><i style="left:' + a.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></i></span>';
  }

  /** what the selected section does, in words */
  function storyLine(s, sec) {
    if (!sec || !Odd.recipes || !Object.keys(sec.slots).length) return '';
    const r = sec.recipe && Odd.recipes.get(sec.recipe);
    const what = Odd.recipes.describe(s, sec);
    const curve = sec.curve && sec.curve !== 'flat' && Odd.shape ? ' · energy: ' + Odd.shape.CURVE_LABELS[sec.curve].toLowerCase() : '';
    return '<p class="sec-story"><strong>' + esc(sec.name) + '</strong>' + (r ? ' · ' + esc(r.label) : '') + curve + ' — ' + esc(what) + '</p>';
  }

  function chordNames(s, sec) {
    const tonic = T.mod(s.tonic + (sec.transpose || 0), 12);
    return mergeProg(sec.prog).map((c) => T.chordName(c, tonic, s.scale)).join(' ');
  }

  function sectionHue(s, sid) {
    const i = s.sections.findIndex((x) => x.id === sid);
    return [28, 200, 330, 150, 260, 90, 0, 180][((i % 8) + 8) % 8];
  }

  function tabs(app) {
    const t = app.ui.tab;
    const n = app.ws.library.length;
    const item = (id, label, ic, extra) => '<button type="button" class="tab' + (t === id ? ' is-active' : '') + '" data-act="tab" data-tab="' + id + '" aria-pressed="' + (t === id) + '">' + icon(ic) + '<span>' + label + (extra || '') + '</span></button>';
    return { html: item('booth', 'Booth', 'booth') + item('shelf', 'Shelf', 'shelf', n ? ' <span class="tab-n mono">' + n + '</span>' : '') + item('song', 'Song', 'song'), rolls: [] };
  }

  Odd.views = { top, booth, shelf, song, tabs, keyName, chordText, chordShown, chordNames, mergeProg, fmtTime, roleLabel, sectionHue };
})(globalThis.Odd = globalThis.Odd || {});
