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

  // join identical neighbours for display
  function mergeProg(prog) {
    const out = [];
    for (const c of prog) {
      const last = out[out.length - 1];
      if (last && last.deg === c.deg) last.beats += c.beats;
      else out.push({ deg: c.deg, beats: c.beats });
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
        '<label class="fld fld-range"><span>Swing <output id="o-swing">' + Math.round(s.swing * 200) + '%</output></span>' +
          '<input type="range" id="f-swing" data-input="swing" data-change="swing-commit" min="0" max="0.5" step="0.01" value="' + s.swing + '"></label>' +
        '<label class="fld fld-range"><span>Volume</span><input type="range" id="f-master" data-input="master" min="0" max="1" step="0.01" value="' + (app.ws.prefs.master != null ? app.ws.prefs.master : 0.8) + '"></label>' +
        qualityField(app) +
        '<canvas class="meter" id="meter" aria-hidden="true"></canvas>' +
        '<div class="phone-only fields-extra">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="midi-setup">' + icon('midi', 'ico-sm') + 'MIDI output</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="redo"' + (Odd.history.canRedo ? '' : ' disabled') + '>' + icon('redo', 'ico-sm') + 'Redo</button>' +
        '</div>' +
      '</div>';
    return { html, rolls: [] };
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
            (take.parent ? '<span class="pill">variation</span>' : '') +
            (kept ? '<span class="pill pill-keep">' + icon('check', 'ico-xs') + 'on the shelf</span>' : '') +
          '</div>' +
          '<h3 class="take-name">' + esc(take.name) + '</h3>' +
          '<p class="take-meta">' + esc(roleLabel(take.role)) + ' · ' + take.bars + (take.bars === 1 ? ' bar' : ' bars') + ' · ' +
            esc(Odd.model.styleOf(take.style).label) + ' · ' + esc(keyName(s, sec)) + ' · ' + r.events.length + ' notes</p>' +
        '</div>' +
        '<div class="screen" draggable="true" data-drag="take" title="Drag out as a MIDI file (Chrome)">' +
          rollSlot(rolls, { events: r.events, length: r.length, drums: take.role === 'drums', role: take.role, chords: r.chords }, 'roll-base') +
          '<canvas class="roll-head" id="booth-head" aria-hidden="true"></canvas>' +
        '</div>';
    } else {
      slate = '<div class="slate"><h3 class="take-name">No take yet</h3><p class="take-meta">Press New take to hear the first idea.</p></div><div class="screen"></div>';
    }

    const list = takes.list;
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
          '<label class="inline-fld"><span>Over</span><select id="b-section" data-change="booth-section">' + sectionOpts + '</select></label>' +
          '<span class="chord-line mono" title="Chords of ' + esc(sec.name) + '">' + esc(chordText(s, sec)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="roles" role="tablist" aria-label="Stem">' + roles + '</div>' +
      '<div class="take-area" data-role="' + b.role + '">' + slate + strip + '</div>' +
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
        '<label class="inline-fld"><span class="sr-only">Length</span><select id="b-bars" data-change="booth-bars">' + barsOpts + '</select></label>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="take-midi"' + (take ? '' : ' disabled') + ' title="Download this take as a MIDI file">' + icon('download', 'ico-sm') + '<span>.mid</span></button>' +
      '</div>' +
      '<div class="params">' + params +
        '<button type="button" class="btn btn-ghost btn-sm params-reset" data-act="params-reset" title="Reset these controls">Reset</button>' +
      '</div>';
    return { html, rolls };
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
        rollSlot(rolls, { events: evs, length: len, drums: p.role === 'drums', role: p.role, mini: true }) +
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

    // arrangement strip
    const chips = s.arrangement.map((sid, i) => {
      const sec = Odd.model.findSection(s, sid);
      if (!sec) return '';
      const hue = sectionHue(s, sid);
      const isSel = app.ui.arrIndex === i;
      return '<li class="arr-item' + (isSel ? ' is-selected' : '') + '" style="--sec-hue:' + hue + ';flex-grow:' + sec.bars + '" data-arr="' + i + '">' +
        '<button type="button" class="arr-chip" data-act="arr-select" data-index="' + i + '" title="' + esc(sec.name) + ', ' + sec.bars + ' bars. Double-click to play from here">' +
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

    // grid
    const cols = s.sections.length;
    let grid = '<div class="sheet" style="--cols:' + cols + '" role="grid" aria-label="Song sheet">';
    grid += '<div class="corner" role="columnheader"><span class="eyebrow">Lanes</span><button type="button" class="btn btn-ghost btn-sm" data-act="add-lane" aria-haspopup="menu" aria-expanded="false">' + icon('plus', 'ico-sm') + 'Lane</button></div>';
    for (const sec of s.sections) {
      const isSel = sec.id === sel.section.id;
      const bOpts = [1, 2, 4, 8, 16].map((n) => '<option value="' + n + '"' + (n === sec.bars ? ' selected' : '') + '>' + n + '</option>').join('');
      grid += '<div class="sec-head' + (isSel ? ' is-selected' : '') + '" data-section-col="' + sec.id + '" style="--sec-hue:' + sectionHue(s, sec.id) + '" role="columnheader">' +
        '<div class="sec-line">' +
          '<button type="button" class="sec-name" data-act="select-section" data-section="' + sec.id + '">' + esc(sec.name) + '</button>' +
          '<button type="button" class="icon-btn icon-btn-sm" data-act="play-section" data-section="' + sec.id + '" data-play-key="section:' + sec.id + '" aria-label="Loop ' + esc(sec.name) + '" title="Loop this section"><span class="when-stopped">' + icon('play') + '</span><span class="when-playing">' + icon('stop') + '</span></button>' +
          '<button type="button" class="icon-btn icon-btn-sm" data-act="section-menu" data-section="' + sec.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="Section options">' + icon('dots') + '</button>' +
        '</div>' +
        '<div class="sec-line sec-line-2">' +
          '<label class="bars-fld"><select id="sb-' + sec.id + '" data-change="section-bars" data-section="' + sec.id + '" aria-label="Bars in ' + esc(sec.name) + '">' + bOpts + '</select><span>bars</span></label>' +
          (sec.transpose ? '<span class="pill mono">' + (sec.transpose > 0 ? '+' : '') + sec.transpose + '</span>' : '') +
          '<button type="button" class="chords-btn mono" data-act="edit-chords" data-section="' + sec.id + '" title="Edit chords: ' + esc(chordNames(s, sec)) + '">' + esc(chordText(s, sec)) + '</button>' +
          '<button type="button" class="icon-btn icon-btn-xs" data-act="new-chords" data-section="' + sec.id + '" aria-label="New chords for ' + esc(sec.name) + '" title="New chords">' + icon('dice') + '</button>' +
        '</div>' +
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
        if (slot && slot.part) {
          const len = sec.bars * T.BAR;
          const evs = R.partEvents(slot.part, Object.assign(R.sectionTarget(s, sec, len), { oct: slot.oct || 0, refit: slot.refit !== false }));
          inner = '<span class="cell-name">' + esc(slot.part.name) + '</span>' +
            (slot.oct ? '<span class="pill mono cell-oct">' + (slot.oct > 0 ? '+' : '') + slot.oct + ' oct</span>' : '') +
            rollSlot(rolls, { events: evs, length: len, drums: slot.part.role === 'drums', role: lane.role, mini: true });
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
              (lane.role !== 'drums' ? '<button type="button" class="tiny-toggle' + (slot.refit !== false ? ' is-on' : '') + '" data-act="cell-refit" aria-pressed="' + (slot.refit !== false) + '" title="Follow this section\'s chords">Fit</button>' : '') +
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
        grid += '<div class="cell' + (slot ? ' is-filled' : '') + (isSel ? ' is-selected' : '') + (lane.mute ? ' is-muted' : '') +
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
          '<button type="button" class="btn btn-sm' + (app.ui.loopSong ? ' is-on' : ' btn-ghost') + '" data-act="loop-song" aria-pressed="' + !!app.ui.loopSong + '" title="Loop the whole song">' + icon('loop', 'ico-sm') + '<span>Loop</span></button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="add-section">' + icon('plus', 'ico-sm') + '<span>Section</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="arr-wrap">' +
        '<ol class="arrangement" aria-label="Song order">' + chips + '</ol>' +
        '<button type="button" class="btn btn-ghost btn-sm arr-add" data-act="arr-add" aria-haspopup="menu" aria-expanded="false" title="Add a section to the song order"' + (addOpts.length ? '' : ' disabled') + '>' + icon('plus', 'ico-sm') + '<span>Add</span></button>' +
      '</div>' +
      '<div class="sheet-wrap">' + grid + '</div>' +
      '<p class="hint">Select a slot, then audition or pick from the shelf. Drag shelf cards onto slots. Parts follow each section\'s chords.</p>';
    return { html, rolls };
  }

  function chordNames(s, sec) {
    const tonic = T.mod(s.tonic + (sec.transpose || 0), 12);
    return mergeProg(sec.prog).map((c) => T.chordName(c.deg, tonic, s.scale)).join(' ');
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

  Odd.views = { top, booth, shelf, song, tabs, keyName, chordText, chordNames, mergeProg, fmtTime, roleLabel, sectionHue };
})(globalThis.Odd = globalThis.Odd || {});
