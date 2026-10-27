/* Oddition — Bones to Gold screen: audition a starting idea with Bobby Beatdown.
 *
 * Draws the rounds Odd.audition.flow steps through and plays them on the
 * app's transport. Listening paces itself: from silence a card plays at once;
 * switching away from something playing stops it, lowers its card, and gives
 * two seconds of quiet (Bobby says a line) before the next one lifts and plays.
 *
 * Odd.bones.mount(el, host) once; host = { toStudio, stopStudio, saveIdea, toast }.
 * Odd.bones.show(on) when the screen changes; Odd.bones.open(bones, ideaId)
 * reopens a saved idea at its gold stage.
 */
(function (Odd) {
  'use strict';
  const A = Odd.audition;
  const F = A.flow;
  const L = A.LINES;

  const PAUSE_MS = 2000;
  const STORE_KEY = 'oddition.bones.v1';
  const VW = 272, VH = 92;
  const r1 = (v) => Math.round(v * 10) / 10;
  const xOf = (s) => 4 + s * (VW - 8) / A.STEPS;
  const sw = (d) => d * (VW - 8) / A.STEPS;
  const mod = (a, n) => ((a % n) + n) % n;
  const VAR = { seed1: '--r-lead', seed2: '--r-lead', chords: '--r-chords', bass: '--r-bass', perc: '--r-perc', beat: '--r-drums', pads: '--r-pad', sound: '--r-arp' };
  const col = (d) => 'var(' + VAR[d] + ')';
  const PROMOTE = { seed1: 'Promote: give it a shape', seed2: 'Promote: that’s the melody' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  let root = null;
  let host = {};
  let S = null;
  let shown = false;
  // what is sounding: src is the key of what plays (or played last), pending the one waiting out its pause
  const P = { playing: false, src: '', pending: '', heard: '', climb: -1, passes: null, timer: 0, pc: 0 };
  let built = '';
  let lastAnim = -1, lastHid = -1, reqKey = '';
  let raf = 0, saveTimer = 0;

  // ---------------------------------------------------------------- state

  function load() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      return F.repair(raw ? JSON.parse(raw) : null);
    } catch (e) { return F.fresh(); }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked: the screen still works */ }
    }, 300);
  }
  function set(ns) {
    S = ns;
    save();
    render();
  }
  const curKey = (i) => 'c' + S.seq + '-' + i;

  // ---------------------------------------------------------------- sound

  function audioFor(key) {
    let m;
    if (key === 'all') return S.idea.melody ? { seq: () => A.seq(S.idea, null) } : null;
    if ((m = /^c(\d+)-(\d)$/.exec(key))) {
      if (!S.round || Number(m[1]) !== S.seq) return null;
      const i = Number(m[2]), o = F.options(S)[i];
      return o ? { seq: () => A.seq(S.idea, { dir: S.round.dir, spec: o }), extra: { sel: i } } : null;
    }
    if ((m = /^h(\d+)-(\d)$/.exec(key))) {
      const row = S.hist.find((r) => r.id === Number(m[1]));
      const o = row && row.opts[Number(m[2])];
      return o ? { seq: () => A.seq(row.idea, { dir: row.dir, spec: o }) } : null;
    }
    if ((m = /^g(\d+)$/.exec(key))) {
      const l = Number(m[1]);
      if (!S.idea.melody) return null;
      return { seq: () => (l === 0 ? A.seq(A.emptyIdea(), { dir: 'seed1', spec: { mel: S.idea.melody } }) : A.seq(A.upTo(S.idea, l - 1), null)) };
    }
    return null;
  }

  function run(seq) {
    if (!Odd.transport) return false;
    if (host.stopStudio) host.stopStudio();
    P.playing = true;
    P.passes = seq.passes || null;
    Odd.transport.play(seq).catch((e) => {
      P.playing = false;
      if (host.toast) host.toast('Audio could not start: ' + (e && e.message ? e.message : e), { kind: 'warn' });
      render();
    });
    loop();
    return true;
  }
  /** silence without touching the screen state */
  function halt() {
    clearTimeout(P.timer);
    P.timer = 0;
    P.pending = '';
    P.climb = -1;
    P.passes = null;
    const was = P.playing;
    P.playing = false;
    if (was && Odd.transport) Odd.transport.stop();
  }
  function stop() {
    halt();
    render();
  }

  /**
   * Fresh ears. From silence a sound starts at once. Switching away from
   * something playing is a transition: it stops, its card lowers, two seconds
   * of quiet while Bobby talks, then the next card lifts and plays.
   */
  function hear(key, line, busy) {
    const a = audioFor(key);
    if (!a) return;
    if (P.playing && P.src === key && !line) { stop(); return; }
    const wasBusy = busy != null ? busy : P.playing || !!P.pending;
    halt();
    if (!wasBusy) {
      run(a.seq());
      P.src = key;
      P.heard = key;
      set(Object.assign({}, S, { line: line || null }, a.extra));
      return;
    }
    P.pc = (P.pc + 1) % L.pause.length;
    P.pending = key;
    set(Object.assign({}, S, { line: line || L.pause[P.pc], sel: -1 }));
    P.timer = setTimeout(() => {
      if (P.pending !== key) return;
      P.pending = '';
      const b = audioFor(key);
      if (!b) { render(); return; }
      run(b.seq());
      P.src = key;
      P.heard = key;
      set(Object.assign({}, S, { line: null }, b.extra));
    }, PAUSE_MS);
  }

  function climbUp() {
    if (P.playing && P.src === 'climb') { stop(); return; }
    halt();
    const cs = A.climbSeq(S.idea);
    run(cs);
    P.src = 'climb';
    P.climb = 0;
    P.heard = '';
    set(Object.assign({}, S, { line: null }));
  }

  /** the playhead, and which pass of the climb is sounding */
  function loop() {
    if (raf) return;
    const tick = () => {
      raf = 0;
      if (!P.playing || !shown || !root) return;
      const pos = Odd.transport.position();
      let step;
      if (P.passes) {
        let i = P.passes.findIndex((p) => pos < p.start + p.length);
        if (i < 0) i = P.passes.length - 1;
        const p = P.passes[i];
        step = ((pos - p.start) / p.length) * A.STEPS;
        if (i !== P.climb) { P.climb = i; patch(); }
      } else {
        step = mod(pos, A.LENGTH) / A.STEP_TICKS;
      }
      const left = r1(xOf(Math.max(0, Math.min(A.STEPS, step)))) + 'px';
      root.querySelectorAll('.is-playing .b-ph').forEach((el) => { el.style.left = left; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- actions

  function promote(i, own) {
    if (!S.round) return;
    const dir = S.round.dir;
    const busy = P.playing || !!P.pending;
    halt();
    const ns = own ? F.keepWalk(S) : F.pick(S, i);
    P.src = '';
    P.heard = '';
    set(ns);
    if (ns.phase === 'next') {
      const line = dir === 'seed2' ? (own ? L.walk : A.line(L.melody, ns.seq)) : A.line(L.added, ns.seq).replace('{x}', A.DIRS[dir].label.toLowerCase());
      hear('all', line, busy);
    }
  }

  function request(idx) {
    const rq = (A.REQS[S.round.dir] || [])[idx];
    if (!rq) return;
    if (rq.why) { set(F.request(S, rq)); return; }
    const busy = P.playing || !!P.pending;
    halt();
    const ns = F.request(S, rq);
    set(ns);
    hear(curKey(1), rq.reply, busy);
  }

  function step(fn) {
    halt();
    P.src = '';
    set(fn(S));
  }

  function back(rowId) {
    const row = S.hist.find((r) => r.id === rowId);
    if (!row) return;
    step((s) => F.back(s, row));
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  function restart() {
    const prev = S;
    step(() => Object.assign(F.fresh(), { anim: prev.anim + 1 }));
    if (host.toast && prev.phase !== 'start') {
      host.toast('Started a new idea.', { action: { label: 'Bring the last one back', run: () => { halt(); set(prev); } } });
    }
  }

  function saveIdea() {
    if (!host.saveIdea || !S.idea.melody) return;
    const id = host.saveIdea({ sources: A.toParts(S.idea), name: A.ideaName(S.idea), bones: clone(S.idea) });
    if (id) set(Object.assign({}, S, { saved: id, line: L.saved }));
  }

  const ACTS = {
    begin: () => step((s) => F.enter(s, 'seed1')),
    hear: (el) => hear(el.dataset.key),
    promote: (el) => promote(Number(el.dataset.i)),
    walk: () => promote(-1, true),
    req: (el) => request(Number(el.dataset.i)),
    more: () => step(F.more),
    skip: () => step(F.skip),
    go: (el) => step((s) => F.enter(s, el.dataset.dir)),
    finish: () => step(F.finish),
    keep: () => step(F.keepBuilding),
    all: () => hear('all'),
    climb: () => climbUp(),
    save: () => saveIdea(),
    restart: () => restart(),
    back: (el) => back(Number(el.dataset.row)),
    studio: () => { halt(); if (host.toStudio) host.toStudio(); },
  };

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    const fn = ACTS[el.dataset.act];
    if (fn) fn(el);
  }

  /** keys while the screen shows: Space play/stop, 1-3 hear A-C, Escape stop. true when handled */
  function onKey(e) {
    if (!shown || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (k === 'Escape') { stop(); return true; }
    if (k === ' ') {
      if (e.target && e.target.closest && e.target.closest('button') && e.target.closest('#bones')) return false; // the button handles it
      e.preventDefault();
      if (P.playing || P.pending) stop();
      else if (S.phase === 'round') hear(curKey(Math.max(0, S.sel)));
      else if (S.phase === 'next' || S.phase === 'gold') hear('all');
      else ACTS.begin();
      return true;
    }
    if (/^[1-3]$/.test(k) && S.phase === 'round') {
      const i = Number(k) - 1;
      if (F.options(S)[i]) hear(curKey(i));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- pictures

  function blk(x, y, w, h, bg, cls) {
    return '<i class="b-blk' + (cls ? ' ' + cls : '') + '" style="left:' + r1(x) + 'px;top:' + r1(y) + 'px;width:' + r1(w) + 'px;height:' + r1(h) + 'px' + (bg ? ';background:' + bg : '') + '"></i>';
  }

  /** what makes the option special, drawn on a 272 x 92 screen */
  function vis(dir, o, idea) {
    let h = '';
    for (let i = 1; i < 8; i++) h += '<i class="b-gl' + (i === 4 ? ' bar' : '') + '" style="left:' + Math.round(xOf(i * 4)) + 'px"></i>';
    // the melody, faintly, under every layer: everything is made against it
    const ghost = (top, hgt) => {
      if (!idea || !idea.melody || !idea.melody.shape) return;
      const ns = A.melodyNotes(idea.melody), ms = ns.map((n) => n.m), lo = Math.min.apply(null, ms), hi = Math.max.apply(null, ms), span = Math.max(1, hi - lo);
      ns.forEach((n) => { h += blk(xOf(n.s), top + (hi - n.m) / span * (hgt - 4), Math.max(3, sw(n.d) - 2), 4, '', 'ghost'); });
    };
    if (dir === 'seed1') {
      o.mel.r.hits.forEach((x) => { const hh = [12, 20, 30][x[2]]; h += blk(xOf(x[0]), VH - 24 - hh, Math.max(4, sw(x[1]) - 2), hh, '', x[2] === 2 ? 'acc' : 'soft'); });
      const sc = A.SCALES[o.mel.scale], cw = (VW - 8) / 12;
      for (let pc = 0; pc < 12; pc++) h += '<i class="b-cell' + (pc === 0 ? ' root' : sc.includes(pc) ? ' on' : '') + '" style="left:' + r1(4 + pc * cw + 1) + 'px;top:' + (VH - 15) + 'px;width:' + r1(cw - 2) + 'px"></i>';
    } else if (dir === 'seed2') {
      const ns = A.melodyNotes(o.mel), ds = ns.map((n) => n.deg), lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds), span = Math.max(1, hi - lo);
      const yOf = (d) => 12 + (hi - d) / span * (VH - 36);
      ns.forEach((n) => { h += blk(xOf(n.s), VH - 9, Math.max(3, sw(n.d) - 2), 4, '', 'soft'); });
      const pts = ns.map((n) => ({ x: xOf(n.s) + 3, y: yOf(n.deg) }));
      pts.forEach((p, i) => {
        if (i > 0) {
          const q = pts[i - 1];
          h += '<i class="b-ln" style="left:' + r1(q.x) + 'px;top:' + r1(q.y) + 'px;width:' + r1(Math.hypot(p.x - q.x, p.y - q.y)) + 'px;transform:rotate(' + r1(Math.atan2(p.y - q.y, p.x - q.x) * 180 / Math.PI) + 'deg)"></i>';
        }
      });
      pts.forEach((p, i) => { h += '<i class="b-dot' + (i === pts.length - 1 ? ' land' : '') + '" style="left:' + r1(p.x) + 'px;top:' + r1(p.y) + 'px"></i>'; });
      const last = pts[pts.length - 1];
      h += '<span class="b-nlab" style="left:' + r1(Math.min(last.x - 4, VW - 22)) + 'px;top:' + r1(last.y < 22 ? last.y + 9 : last.y - 20) + 'px">' + esc(A.NAMES[mod(ns[ns.length - 1].m, 12)]) + '</span>';
    } else if (dir === 'chords') {
      ghost(6, 50);
      o.chords.forEach((c, i) => { h += '<span class="b-chd ' + (c.colour ? 'col' : c.q === '' ? 'maj' : 'min') + '" style="left:' + r1(xOf(i * 8)) + 'px;top:62px;width:' + r1(sw(8) - 3) + 'px">' + esc(A.chordName(c)) + '</span>'; });
    } else if (dir === 'bass') {
      ghost(6, 30);
      const ms = o.notes.map((n) => n.m), lo = Math.min.apply(null, ms), hi = Math.max.apply(null, ms), span = Math.max(1, hi - lo);
      o.notes.forEach((n) => { h += blk(xOf(n.s), 46 + (hi - n.m) / span * 34, Math.max(4, sw(n.d) - 2), 7, col('bass')); });
    } else if (dir === 'pads') {
      ghost(6, 26);
      const all = [].concat.apply([], o.notes.map((n) => n.ms)), lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), span = Math.max(1, hi - lo);
      o.notes.forEach((n) => n.ms.forEach((m) => { h += blk(xOf(n.s), 42 + (hi - m) / span * 38, Math.max(4, sw(n.d) - 2), 6, col('pads'), 'half'); }));
    } else if (dir === 'perc') {
      ghost(6, 26);
      const row = { clap: 44, tap: 58, tamb: 72, shaker: 72 };
      o.hits.forEach((x) => { const sh = x.k === 'shaker'; h += blk(xOf(x.s), row[x.k], sh ? 4 : 6, sh ? 6 : 10, col('perc'), sh ? 'half' : ''); });
    } else if (dir === 'beat') {
      ghost(6, 22);
      o.h.forEach((s) => { h += blk(xOf(s), 40, 4, 6, col('beat'), 'half'); });
      o.s.forEach((s) => { h += blk(xOf(s), 55, 7, 10, col('beat')); });
      o.k.forEach((s) => { h += blk(xOf(s), 72, 7, 12, col('beat'), 'kick'); });
    } else {
      ghost(8, 70);
      h += '<span class="b-nlab" style="left:10px;top:74px">' + esc(o.inst + (o.swing ? ' · swung' : '')) + '</span>';
    }
    return h + '<i class="b-ph"></i>';
  }

  function card(dir, o, idea, x) {
    const tag = A.tagOf(dir, o);
    const head = '<div class="b-head">' + (x.letter ? '<span class="b-letter">' + x.letter + '</span>' : '') + '<span class="b-tag">' + esc(tag) + '</span><span class="b-stat">' + esc(A.statOf(dir, o)) + '</span></div>';
    const label = (x.letter ? 'option ' + x.letter + ': ' : '') + tag;
    return '<div class="b-card' + (x.cls ? ' ' + x.cls : '') + '" data-key="' + x.key + '"' + (x.i != null ? ' data-i="' + x.i + '"' : '') + (x.style ? ' style="' + x.style + '"' : '') + '>' +
      '<button type="button" class="b-hit" data-act="hear" data-key="' + x.key + '" aria-label="Listen to ' + esc(label) + '"></button>' +
      (x.i != null ? '<div class="b-reqs-in" aria-label="Ask Bobby"></div>' : '') +
      head +
      '<div class="b-vis" aria-hidden="true">' + vis(dir, o, idea) + '</div>' +
      (x.promote ? '<button type="button" class="b-primary b-promote" data-act="promote" data-i="' + x.i + '">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        esc(x.promote) + '</button>' : '') +
      '</div>';
  }

  function mini(dir, o, idea, key, extra, letter) {
    return '<div class="b-mini ' + (extra || '') + '" data-key="' + key + '">' + card(dir, o, idea, { key, letter }) + '</div>';
  }

  // ---------------------------------------------------------------- the screen

  const BOBBY_SVG =
    '<svg class="b-face" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">' +
      '<path class="b-cloth" d="M30 92 C30 76, 66 76, 66 92 Z"/>' +
      '<circle cx="48" cy="54" r="19" fill="#c79f7c"/>' +
      '<path d="M30 56 C31 82, 65 82, 66 56 C61 66, 35 66, 30 56 Z" fill="#3b2b22"/>' +
      '<rect x="34" y="45" width="12" height="9" rx="3" fill="#0e1014"/>' +
      '<rect x="50" y="45" width="12" height="9" rx="3" fill="#0e1014"/>' +
      '<path d="M46 48 L50 48" stroke="#0e1014" stroke-width="2"/>' +
      '<path d="M42 65 Q48 69 54 65" stroke="#ecebe6" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '<path class="b-cloth" d="M30 36 C30 14, 66 14, 66 36 Z"/>' +
      '<rect x="31" y="29" width="34" height="5" fill="#f1cd58"/>' +
      '<ellipse class="b-cloth" cx="48" cy="37" rx="36" ry="6"/>' +
    '</svg>';

  function bobby(opts) {
    if (S.phase === 'start') return L.start;
    if (P.src === 'climb' && P.playing && P.climb >= 0) {
      if (P.climb === 0) return L.climbFirst;
      if (P.climb === 1) return L.climbMelody;
      const d = S.idea.order[P.climb - 2];
      return d ? '+ ' + A.DIRS[d].label + '.' + (P.climb - 1 === S.idea.order.length ? ' That’s gold.' : '') : 'That’s gold.';
    }
    if (S.line) return S.line;
    if (P.playing && P.src.charAt(0) === 'h') {
      const pr = P.src.slice(1).split('-').map(Number), row = S.hist.find((x) => x.id === pr[0]);
      if (row) return row.chosen === pr[1] ? L.picked : L.passed;
    }
    if (S.phase === 'next') return A.line(L.next, S.seq);
    if (S.phase === 'gold') return A.line(L.gold, S.hid);
    if (S.msg === 'more') return A.line(L.more, S.seq);
    if (S.sel >= 0 && P.heard === curKey(S.sel) && opts[S.sel]) return A.comment(S.round.dir, opts, S.sel);
    return A.line(L.entry[S.round.dir], S.seq);
  }

  function chipsHtml() {
    const idea = S.idea, out = [];
    const chip = (label, sub, cls, color) => '<span class="b-chip ' + cls + '"><i style="background:' + color + '"></i>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>';
    if (S.phase === 'start') return '';
    const dir = S.round ? S.round.dir : '';
    if (!idea.melody || !idea.melody.shape) {
      out.push(chip('Rhythm and scale', idea.melody ? 'picked' : '', idea.melody ? '' : 'now', col('seed1')));
      out.push(chip('Shape', '', idea.melody ? 'now' : 'todo', idea.melody ? col('seed2') : 'transparent'));
    } else {
      out.push(chip('Melody', 'leads', 'lead', col('seed2')));
      idea.order.forEach((d) => out.push(chip(A.DIRS[d].label, '', (S.added === d && S.anim !== lastAnim ? 'pop' : '') + (dir === d ? ' now' : ''), col(d))));
      if (S.round && idea.order.indexOf(dir) < 0) out.push(chip(A.DIRS[dir].label, 'choosing', 'now', col(dir)));
    }
    return out.join('');
  }

  function roundHtml(animate) {
    const dir = S.round.dir, opts = F.options(S);
    const kind = S.kind;
    const cards = opts.map((o, i) => {
      let anim = 'b-pop', delay = (i * 0.08).toFixed(2) + 's';
      if (kind === 'rise') { if (i === 1) { anim = 'b-rise'; delay = '0s'; } else delay = (0.18 + i * 0.05).toFixed(2) + 's'; }
      const style = animate ? 'animation-name:' + anim + ';animation-delay:' + delay : '';
      return card(dir, o, S.idea, { key: curKey(i), i, letter: A.ABC.charAt(i), promote: PROMOTE[dir] || 'Add it', style });
    }).join('');
    const callouts = opts.map((_, i) => '<div class="b-call" data-i="' + i + '"></div>').join('');
    return '<div class="b-callouts" style="grid-template-columns:repeat(' + opts.length + ',300px)">' + callouts + '</div>' +
      '<div class="b-cards">' + cards + '</div>' +
      '<div class="b-actions">' +
        '<button type="button" class="b-ghost" data-act="more">Three more</button>' +
        (dir === 'seed2' ? '<button type="button" class="b-ghost" data-act="walk">Keep the plain walk</button>' : '') +
        (/^seed/.test(dir) ? '' : '<button type="button" class="b-ghost" data-act="skip">Not now</button>') +
        '<span class="b-hint">Click a card to hear it, or press 1, 2, 3. Bobby gives your ears a moment between options.</span>' +
      '</div>';
  }

  function nextHtml(animate) {
    const sugg = A.suggestion(S.idea);
    const dirs = A.directions(S.idea).map((d, i) => {
      const has = S.idea.layers[d];
      return '<button type="button" class="b-dir' + (d === sugg ? ' tip' : '') + (has ? ' done' : '') + '" data-act="go" data-dir="' + d + '"' + (animate ? ' style="animation-delay:' + (i * 0.05).toFixed(2) + 's"' : ' style="animation:none"') + '>' +
        '<span class="b-dir-top"><i class="b-dot-c" style="background:' + col(d) + '"></i><b>' + esc(A.DIRS[d].label) + '</b>' +
          (d === sugg ? '<span class="b-pickb">Bobby’s pick</span>' : '') +
          (has ? '<span class="b-doneb">Added · try again</span>' : '') +
        '</span>' +
        '<span class="b-dir-sub">' + esc(has ? 'Now: ' + A.tagOf(d, has) : A.DIRS[d].sub) + '</span>' +
      '</button>';
    }).join('');
    return '<div class="b-dirs">' + dirs + '</div>' +
      '<div class="b-actions"><button type="button" class="b-ghost" data-act="all" data-label="all">Play the idea so far</button></div>';
  }

  function goldHtml(animate) {
    const steps = A.lineage(S.idea);
    const lin = steps.map((x, l) =>
      (l > 0 ? '<span class="b-plus" aria-hidden="true">+</span>' : '') +
      '<div class="b-lin"' + (animate ? ' style="animation-delay:' + (l * 0.08).toFixed(2) + 's"' : ' style="animation:none"') + '>' +
        '<span class="b-lin-l"><i style="background:' + col(x.dir) + '"></i>' + esc(x.stage) + '</span>' +
        mini(x.dir, x.spec, S.idea, 'g' + l, 'picked') +
      '</div>').join('');
    return '<div class="b-gold">' +
      '<div class="b-gold-actions">' +
        '<button type="button" class="b-primary" data-act="climb" data-label="climb"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2v10l9-5z" fill="currentColor"/></svg><span>Play the climb</span></button>' +
        '<button type="button" class="b-ghost" data-act="all" data-label="all">Play the idea so far</button>' +
        '<button type="button" class="b-ghost" data-act="keep">Keep building</button>' +
        '<button type="button" class="b-ghost" data-act="save" data-label="save">Save to Ideas</button>' +
        '<button type="button" class="b-ghost" data-act="restart">Start a new idea</button>' +
      '</div>' +
      '<span class="b-lin-title">How it got here</span>' +
      '<div class="b-lineage">' + lin + '</div>' +
    '</div>';
  }

  function historyHtml() {
    if (!S.hist.length) return '';
    const dropNew = S.hid !== lastHid;
    const rows = S.hist.map((row, ri) => {
      const others = [0, 1, 2].filter((x) => x !== row.chosen);
      const ord = row.chosen >= 0 ? [others[0], row.chosen, others[1]] : [0, 1, 2];
      const cards = ord.filter((ci) => row.opts[ci]).map((ci) => {
        const picked = ci === row.chosen;
        return '<div class="b-mini-wrap">' + (picked ? '<span class="b-badge">Picked</span>' : '') +
          mini(row.dir, row.opts[ci], row.idea, 'h' + row.id + '-' + ci, picked ? 'picked' : 'passed', A.ABC.charAt(ci)) + '</div>';
      }).join('');
      return '<div class="b-row' + (ri === 0 && dropNew ? ' drop' : '') + '">' +
        '<div class="b-row-label"><b><i class="b-dot-c" style="background:' + col(row.dir) + '"></i>' + esc(A.DIRS[row.dir].label) + '</b><span>' + esc(row.note) + '</span>' +
          (!row.marker && row.round ? '<button type="button" class="b-back" data-act="back" data-row="' + row.id + '">Back to this round</button>' : '') +
        '</div>' +
        '<div class="b-row-cards">' + cards + '</div>' +
      '</div>';
    }).join('');
    return '<section class="b-history" aria-label="Earlier rounds">' +
      '<div class="b-h-title"><span>Earlier rounds</span><span>Newest first. Click any card to hear it.</span></div>' + rows + '</section>';
  }

  function full() {
    const animate = S.anim !== lastAnim;
    const G = S.idea.layers.sound;
    let body = '';
    if (S.phase === 'start') {
      body = '<div class="b-start"><button type="button" class="b-go" data-act="begin">Audition a starting idea</button><p>A melody, 2 bars. No genre yet: just bones.</p></div>';
    } else if (S.phase === 'round') body = roundHtml(animate);
    else if (S.phase === 'next') body = nextHtml(animate);
    else body = goldHtml(animate);
    root.innerHTML =
      '<div class="b2g' + (animate ? ' b-animate' : '') + '">' +
        '<header class="b-top">' +
          '<div class="b-brand"><span class="wordmark">Oddition</span><span>Bones to Gold</span></div>' +
          '<nav class="b-chips" aria-label="Your idea so far">' + chipsHtml() + '</nav>' +
          '<div class="b-top-r">' +
            '<span class="b-meta">' + esc(G ? G.name + ' · ' + G.bpm + ' BPM' : 'Melody · 2 bars · 100 BPM') + '</span>' +
            (F.canFinish(S) ? '<button type="button" class="b-primary" data-act="finish">That’s the idea</button>' : '') +
            '<button type="button" class="b-ghost" data-act="studio" title="The song sheet, booth and shelf">Studio</button>' +
          '</div>' +
        '</header>' +
        '<main class="b-stage">' +
          '<section class="b-bobby">' + BOBBY_SVG + '<div class="b-bubble"><span class="b-who">Bobby Beatdown</span><span class="b-say" aria-live="polite"></span></div></section>' +
          body +
          historyHtml() +
        '</main>' +
      '</div>';
    lastAnim = S.anim;
    lastHid = S.hid;
    reqKey = '';
  }

  /** what changes without redrawing: who is lifted, playing or waiting, Bobby's line, button labels */
  function patch() {
    if (!root || !root.firstChild) return;
    const opts = S.phase === 'round' ? F.options(S) : [];
    const say = root.querySelector('.b-say');
    const text = bobby(opts);
    if (say && say.textContent !== text) say.textContent = text;
    const climbing = P.playing && P.src === 'climb';
    root.querySelectorAll('[data-key]').forEach((el) => {
      if (el.classList.contains('b-hit')) return;
      const key = el.dataset.key;
      const on = (P.playing && P.src === key) || (climbing && key === 'g' + P.climb);
      el.classList.toggle('is-playing', on);
      el.classList.toggle('is-wait', P.pending === key);
      if (el.dataset.i != null && el.classList.contains('b-card')) el.classList.toggle('lifted', S.sel === Number(el.dataset.i) && S.phase === 'round');
      const hit = el.querySelector('.b-hit');
      if (hit) hit.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // requests sit above the lifted card
    const rk = S.phase === 'round' ? S.seq + '|' + S.sel + '|' + P.pending + '|' + JSON.stringify(S.round.steer) : '';
    if (rk !== reqKey) {
      reqKey = rk;
      root.querySelectorAll('.b-call, .b-reqs-in').forEach((el) => { el.innerHTML = ''; });
      if (S.phase === 'round' && S.sel >= 0 && !P.pending) {
        const st = S.round.steer || {};
        const html = '<div class="b-reqs" aria-label="Ask Bobby">' + (A.REQS[S.round.dir] || []).map((rq, i) => {
          const active = (rq.x && st.x === rq.x) || (rq.p && Math.sign(st.p || 0) === Math.sign(rq.p)) || (rq.s && Math.sign(st.s || 0) === Math.sign(rq.s));
          return '<button type="button" class="b-req' + (active ? ' on' : '') + '" data-act="req" data-i="' + i + '">' + esc(rq.label) + '</button>';
        }).join('') + '</div>';
        const call = root.querySelector('.b-call[data-i="' + S.sel + '"]');
        if (call) call.innerHTML = html;
        const inCard = root.querySelector('.b-card[data-i="' + S.sel + '"] .b-reqs-in');
        if (inCard) inCard.innerHTML = html;
      }
    }
    root.querySelectorAll('[data-label="all"]').forEach((b) => { b.textContent = P.playing && P.src === 'all' ? 'Stop' : 'Play the idea so far'; });
    const cb = root.querySelector('[data-label="climb"] span');
    if (cb) cb.textContent = climbing ? 'Stop the climb' : 'Play the climb';
    const sb = root.querySelector('[data-label="save"]');
    if (sb) { sb.textContent = S.saved ? 'Saved to Ideas' : 'Save to Ideas'; sb.disabled = !!S.saved; }
  }

  function render() {
    if (!root || !shown) return;
    const key = [S.phase, S.seq, S.hid, S.anim, S.round ? S.round.dir : '', S.idea.order.join(',')].join('|');
    if (key !== built) { built = key; full(); }
    patch();
  }

  // ---------------------------------------------------------------- outside

  function mount(el, h) {
    root = el;
    host = h || {};
    S = load();
    root.addEventListener('click', onClick);
    if (Odd.transport && Odd.transport.on) {
      Odd.transport.on('end', () => { if (P.playing) { P.playing = false; P.climb = -1; P.passes = null; render(); } });
      Odd.transport.on('stall', () => { if (P.playing) { P.playing = false; P.climb = -1; render(); } });
    }
  }

  function show(on) {
    shown = !!on;
    if (!shown) { halt(); return; }
    built = '';
    render();
  }

  /** reopen a saved idea at its gold stage */
  function open(bones, ideaId) {
    halt();
    P.src = '';
    const ns = F.repair(Object.assign(F.fresh(), { phase: 'gold', idea: clone(bones), anim: (S ? S.anim : 0) + 1, saved: ideaId || null }));
    set(ns);
  }

  Odd.bones = {
    mount, show, open, onKey,
    get state() { return S; },
    get playing() { return P.playing; },
  };
})(globalThis.Odd = globalThis.Odd || {});
