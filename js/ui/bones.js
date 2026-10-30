/* Oddition — Bones to Gold screen: audition a starting idea with Bobby Beatdown.
 *
 * Opens on a choice of three (Groove, Melody, Riff): tapping a card plays
 * an example of that kind of idea, a second tap starts down its path.
 * Draws the rounds Odd.audition.flow steps through and plays them on the
 * app's transport. Listening paces itself: from silence a card plays at once;
 * switching away from something playing stops it, lowers its card, and gives
 * two seconds of quiet (Bobby says a line) before the next one lifts and plays.
 *
 * Odd.bones.mount(el, host) once; host = { toStudio, toHome, stopStudio, saveIdea, toast }.
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
  // cards are drawn across their idea's two bars: NS steps (32 in 4/4, 24 in 3/4, ...), set per card by vis()
  let NS = A.STEPS;
  const xOf = (s, n) => 4 + s * (VW - 8) / (n || NS);
  const sw = (d) => d * (VW - 8) / NS;
  const mod = (a, n) => ((a % n) + n) % n;
  const VAR = {
    seed1: '--r-lead', seed2: '--r-lead', chords: '--r-chords', bass: '--r-bass', perc: '--r-perc', beat: '--r-drums', pads: '--r-pad', sound: '--r-arp',
    pocket: '--r-drums', gbass: '--r-bass', keys: '--r-chords', hook: '--r-lead', rrhythm: '--r-lead', rnotes: '--r-lead', weight: '--r-lead', drums: '--r-drums', under: '--r-pad',
  };
  const col = (d) => 'var(' + VAR[d] + ')';
  const PROMOTE = {
    seed1: 'Promote: give it a shape', seed2: 'Promote: that’s the melody', pocket: 'Promote: add a bass line', gbass: 'Promote: put chords on top', keys: 'Promote: that’s the groove',
    hook: 'Promote: give it a shape', rrhythm: 'Promote: give it notes', rnotes: 'Promote: give it weight', weight: 'Promote: that’s the riff',
  };
  // what a round's deck holds, for the counter under the cards
  const NOUN = {
    seed1: 'rhythms', seed2: 'shapes', chords: 'chord progressions', bass: 'bass lines', pads: 'pads', perc: 'percussion parts', beat: 'beats', sound: 'sounds',
    pocket: 'beats', gbass: 'bass lines', keys: 'ways to play the chords', hook: 'hook rhythms', rrhythm: 'riff rhythms', rnotes: 'note patterns', weight: 'weights', drums: 'beats', under: 'things to put under it',
  };
  const SLIDE_MS = 200;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  let root = null;
  let host = {};
  let S = null;
  let shown = false;
  // what is sounding: src is the key of what plays (or played last), pending the one waiting out its pause
  const P = { playing: false, src: '', pending: '', heard: '', climb: -1, passes: null, timer: 0, pc: 0, steps: A.STEPS, len: A.LENGTH, ex: {} };
  let built = '';
  let lastAnim = -1, lastHid = -1, reqKey = '';
  let raf = 0, saveTimer = 0, sliding = false;

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
    if (key === 'all') return A.isStarted(S.idea) ? { seq: () => A.seq(S.idea, null) } : null;
    // an example of a path, on the opening cards: a new one each time a card is lifted
    if ((m = /^x-(\w+)$/.exec(key))) return A.PATHS[m[1]] ? { seq: () => A.example(m[1], P.ex[m[1]] || 0), extra: { peek: m[1] } } : null;
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
      if (!A.isDone(S.idea)) return null;
      return { seq: () => A.climb(S.idea)[l] };
    }
    return null;
  }

  function run(seq) {
    if (!Odd.transport) return false;
    if (host.stopStudio) host.stopStudio();
    P.playing = true;
    P.passes = seq.passes || null;
    P.steps = seq.steps || A.STEPS;
    P.len = seq.length || A.LENGTH;
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
    set(Object.assign({}, S, { line: line || L.pause[P.pc], sel: -1, peek: null }));
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
        step = ((pos - p.start) / p.length) * P.steps;
        if (i !== P.climb) { P.climb = i; patch(); }
      } else {
        step = mod(pos, P.len) / A.STEP_TICKS;
      }
      const left = r1(xOf(Math.max(0, Math.min(P.steps, step)), P.steps)) + 'px';
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
    const ns = own ? F.own(S) : F.pick(S, i);
    P.src = '';
    P.heard = '';
    set(ns);
    if (ns.phase === 'next') hear('all', A.pickedLine(ns.idea, dir, own, ns.seq), busy);
  }

  function request(idx) {
    const rq = (A.REQS[S.round.dir] || [])[idx];
    if (!rq) return;
    if (rq.why) { set(F.request(S, rq)); return; }
    const busy = P.playing || !!P.pending;
    halt();
    const ns = F.request(S, rq);
    set(ns);
    hear(curKey(1), ns.line || rq.reply, busy);
  }

  function step(fn) {
    halt();
    P.src = '';
    set(fn(S));
  }

  /** move through the deck: the three on screen slide off to one side, the next three come in from the other */
  function slide(fn) {
    if (sliding || S.phase !== 'round') return;
    const ns = fn(S);
    if (ns === S) return;
    const deal = root.querySelector('.b-deal');
    let still = false;
    try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* no matchMedia: animate */ }
    if (!deal || still) { step(() => ns); return; }
    halt();
    P.src = '';
    sliding = true;
    deal.classList.add(ns.kind === 'prev' ? 'out-r' : 'out-l');
    setTimeout(() => { sliding = false; step(fn); }, SLIDE_MS);
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

  /** an opening card: the first tap plays an example and lifts it, a second goes in */
  function peek(path) {
    if (S.phase !== 'start') return;
    if (S.peek === path) { begin(path); return; }
    P.ex[path] = (P.ex[path] || 0) + 1;
    hear('x-' + path, A.line(L.peek[path], P.ex[path] - 1));
  }
  function begin(path) {
    step((s) => F.begin(s, path));
  }

  function saveIdea() {
    if (!host.saveIdea || !A.isDone(S.idea)) return;
    const id = host.saveIdea({ sources: A.toParts(S.idea), name: A.ideaName(S.idea), bones: clone(S.idea) });
    if (id) set(Object.assign({}, S, { saved: id, line: L.saved }));
  }

  const ACTS = {
    peek: (el) => peek(el.dataset.path),
    begin: (el) => begin(el.dataset.path),
    hear: (el) => hear(el.dataset.key),
    promote: (el) => promote(Number(el.dataset.i)),
    own: () => promote(-1, true),
    req: (el) => request(Number(el.dataset.i)),
    next: () => slide(F.next),
    prev: () => slide(F.prev),
    jump: (el) => slide((s) => F.to(s, Number(el.dataset.b))),
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
    home: () => { halt(); if (host.toHome) host.toHome(); },
  };

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    const fn = ACTS[el.dataset.act];
    if (fn) fn(el);
  }

  /** keys while the screen shows: Space play/stop, 1-3 hear A-C, ←/→ the three before or after, Escape stop. true when handled */
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
      return true;
    }
    if (/^[1-3]$/.test(k) && S.phase === 'start') { peek(A.PATH_ORDER[Number(k) - 1]); return true; }
    if (/^[1-3]$/.test(k) && S.phase === 'round') {
      const i = Number(k) - 1;
      if (F.options(S)[i]) hear(curKey(i));
      return true;
    }
    if ((k === 'ArrowRight' || k === 'ArrowLeft') && S.phase === 'round') {
      if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return false;
      e.preventDefault();
      slide(k === 'ArrowRight' ? F.next : F.prev);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- pictures

  function blk(x, y, w, h, bg, cls) {
    return '<i class="b-blk' + (cls ? ' ' + cls : '') + '" style="left:' + r1(x) + 'px;top:' + r1(y) + 'px;width:' + r1(w) + 'px;height:' + r1(h) + 'px' + (bg ? ';background:' + bg : '') + '"></i>';
  }

  /** the meter a card is drawn in: its own in a first round, else the idea's */
  function meterFor(dir, o, idea) {
    const T = Odd.theory;
    if (o.mel) return A.meterOf(o.mel);
    if (dir === 'pocket') return T.meter(o.m);
    if (dir === 'rrhythm') return T.meter(o.r.m);
    return A.ideaMeter(idea);
  }
  /** blocks for a run of notes, their height by pitch between top and top + hgt */
  function lane(ns, top, hgt, color, cls, thick) {
    if (!ns.length) return '';
    const ms = ns.map((n) => n.m), lo = Math.min.apply(null, ms), hi = Math.max.apply(null, ms), span = Math.max(1, hi - lo);
    return ns.map((n) => blk(xOf(n.s), top + (hi - n.m) / span * (hgt - (thick || 6)), Math.max(3, sw(n.d) - 2), thick || 6, color, cls)).join('');
  }
  function kitVis(o) {
    let h = '';
    o.h.forEach((s) => { h += blk(xOf(s), 40, 4, 6, col('beat'), 'half'); });
    o.s.forEach((s) => { h += blk(xOf(s), 55, 7, 10, col('beat')); });
    o.k.forEach((s) => { h += blk(xOf(s), 72, 7, 12, col('beat'), 'kick'); });
    return h;
  }
  function chordRow(chords, m, top) {
    const slots = A.slotsOf(m);
    return chords.map((c, i) => '<span class="b-chd ' + (c.colour ? 'col' : c.q === '' ? 'maj' : 'min') + '" style="left:' + r1(xOf(slots[i].s)) + 'px;top:' + top + 'px;width:' + r1(sw(slots[i].len) - 3) + 'px">' + esc(A.chordName(c)) + '</span>').join('');
  }

  /** what makes the option special, drawn on a 272 x 92 screen */
  function vis(dir, o, idea) {
    let h = '';
    const m = meterFor(dir, o, idea);
    NS = 2 * m.steps;
    // a line on each beat, a darker one between the bars
    for (let bar = 0; bar < 2; bar++) m.pulses.forEach((p) => { const s = bar * m.steps + p.s; if (s) h += '<i class="b-gl' + (s === m.steps ? ' bar' : '') + '" style="left:' + Math.round(xOf(s)) + 'px"></i>'; });
    // what the layer is made against (the melody, the riff, a groove's bass), faintly, under it
    const ghost = (top, hgt) => { if (idea) h += lane(A.refNotes(idea), top, hgt, '', 'ghost', 4); };
    if (dir === 'seed1') {
      o.mel.r.hits.forEach((x) => { const hh = [12, 20, 30][x[2]]; h += blk(xOf(x[0]), VH - 24 - hh, Math.max(4, sw(x[1]) - 2), hh, '', x[2] === 2 ? 'acc' : 'soft'); });
      const sc = A.SCALES[o.mel.scale], cw = (VW - 8) / 12;
      for (let pc = 0; pc < 12; pc++) h += '<i class="b-cell' + (pc === 0 ? ' root' : sc.includes(pc) ? ' on' : '') + '" style="left:' + r1(4 + pc * cw + 1) + 'px;top:' + (VH - 15) + 'px;width:' + r1(cw - 2) + 'px"></i>';
    } else if (dir === 'seed2') {
      // one scale for every card (at least an octave tall), so a small shape looks small
      const ns = A.melodyNotes(o.mel), ds = ns.map((n) => n.deg), lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds), span = Math.max(7, hi - lo);
      const top = (hi + lo) / 2 + span / 2;
      const yOf = (d) => 12 + (top - d) / span * (VH - 36);
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
      const slots = A.slotsOf(m);
      o.chords.forEach((c, i) => { h += '<span class="b-chd ' + (c.colour ? 'col' : c.q === '' ? 'maj' : 'min') + '" style="left:' + r1(xOf(slots[i].s)) + 'px;top:62px;width:' + r1(sw(slots[i].len) - 3) + 'px">' + esc(A.chordName(c)) + '</span>'; });
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
      // claps and sticks on top, wood and bells, then skins, then the shakers and jingles that keep time
      const ROW = { clap: 42, rim: 42, claves: 42, tap: 52, tapLo: 52, cowbell: 52, agogo: 52, agogoLo: 52, conga: 62, congaLo: 62, bongo: 62, bongoLo: 62, shaker: 74, tamb: 74, guiro: 74, tri: 74 };
      o.hits.forEach((x) => { const sh = ROW[x.k] === 74; h += blk(xOf(x.s), (ROW[x.k] || 52) + (/Lo$/.test(x.k) ? 4 : 0), sh ? 4 : 6, sh ? 6 : 10, col('perc'), sh ? 'half' : ''); });
    } else if (dir === 'beat' || dir === 'drums') {
      ghost(6, 22);
      h += kitVis(o);
    } else if (dir === 'pocket') {
      h += kitVis(o);
      h += '<span class="b-nlab" style="left:8px;top:8px">' + esc(o.bpm + ' BPM' + (o.swing ? ' · swung' : '')) + '</span>';
    } else if (dir === 'gbass') {
      // the kick it plays against, the bass, and the chords it implies
      idea.layers.pocket.k.forEach((s) => { h += blk(xOf(s), 82, 5, 6, '', 'ghost'); });
      h += lane(o.notes, 32, 46, col('gbass'), '', 7);
      h += chordRow(o.chords, m, 4);
    } else if (dir === 'keys') {
      ghost(70, 18);
      if (o.none) h += '<span class="b-nlab" style="left:10px;top:24px">no chords: just drums and bass</span>';
      else o.notes.forEach((n) => n.ms.forEach((p, k) => { h += blk(xOf(n.s), 52 - k * 9, Math.max(3, sw(n.d) - 2), 6, col('keys'), 'half'); }));
      h += chordRow(idea.layers.gbass ? idea.layers.gbass.chords : [], m, 4);
    } else if (dir === 'hook') {
      ghost(6, 30);
      o.mel.r.hits.forEach((x) => { const hh = [10, 16, 24][x[2]]; h += blk(xOf(x[0]), VH - 8 - hh, Math.max(4, sw(x[1]) - 2), hh, '', x[2] === 2 ? 'acc' : 'soft'); });
    } else if (dir === 'rrhythm') {
      // hard hits tall, plain ones short, muted ones a sliver
      o.r.hits.forEach((x) => { const hh = [8, 22, 44][x[2]]; h += blk(xOf(x[0]), VH - 10 - hh, Math.max(3, sw(x[1]) - 2), hh, '', x[2] === 2 ? 'acc' : 'soft'); });
    } else if (dir === 'rnotes') {
      // drawn at the rhythm's lengths, so muted hits still show
      const ns = A.riffNotes({ r: idea.riff.r, notes: o }).map((n, i) => Object.assign(n, { d: idea.riff.r.hits[i][1] }));
      h += lane(ns, 10, 72, '', 'acc', 7);
    } else if (dir === 'weight') {
      // a lane per voice: the bass at the bottom, the doubles above
      const ns = A.riffNotes(idea.riff), vs = o.voices, gap = Math.min(20, 78 / vs.length);
      vs.slice().sort((a, b) => A.riffPitch(b, 0, idea.riff.scale) - A.riffPitch(a, 0, idea.riff.scale)).forEach((v, k) => {
        ns.forEach((n) => { h += blk(xOf(n.s), 8 + k * gap, Math.max(3, sw(n.d) - 2), Math.max(4, gap - 6), v.part === 'low' ? col('bass') : '', v.part === 'low' ? '' : 'acc'); });
      });
    } else if (dir === 'under') {
      ghost(6, 24);
      o.notes.forEach((n) => n.ms.forEach((p, k) => { h += blk(xOf(n.s), 78 - k * 10, Math.max(3, sw(n.d) - 2), 6, col('under'), 'half'); }));
      if (o.changes) h += chordRow(o.chords, m, 36);
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

  const BOBBY_SVG = Odd.brand.BOBBY;

  function bobby(opts) {
    if (S.phase === 'start') return S.peek ? A.line(L.peek[S.peek], (P.ex[S.peek] || 1) - 1) : S.line || L.start;
    if (P.src === 'climb' && P.playing && P.climb >= 0) return A.climbLines(S.idea)[P.climb] || 'That’s gold.';
    if (S.line) return S.line;
    if (P.playing && P.src.charAt(0) === 'h') {
      const pr = P.src.slice(1).split('-').map(Number), row = S.hist.find((x) => x.id === pr[0]);
      if (row) return row.chosen === pr[1] ? L.picked : L.passed;
    }
    const path = A.pathOf(S.idea);
    if (S.phase === 'next') return A.line(path === 'melody' ? L.next : L.nextBy[path], S.seq);
    if (S.phase === 'gold') return A.line(path === 'melody' ? L.gold : L.goldBy[path], S.hid);
    if (S.msg === 'more' || S.msg === 'prev' || S.msg === 'shuffled') return A.line(L[S.msg], S.seq);
    if (S.sel >= 0 && P.heard === curKey(S.sel) && opts[S.sel]) return A.comment(S.round.dir, opts, S.sel);
    return A.line(L.entry[S.round.dir], S.seq);
  }

  function chipsHtml() {
    const idea = S.idea, out = [];
    const chip = (label, sub, cls, color) => '<span class="b-chip ' + cls + '"><i style="background:' + color + '"></i>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>';
    if (S.phase === 'start') return '';
    const dir = S.round ? S.round.dir : '', path = A.pathOf(idea), open = A.PATHS[path].open;
    const pop = (d) => (S.added === d && S.anim !== lastAnim ? 'pop' : '');
    if (path === 'melody' && !(idea.melody && idea.melody.shape)) {
      out.push(chip('Rhythm and scale', idea.melody ? 'picked' : '', idea.melody ? '' : 'now', col('seed1')));
      out.push(chip('Shape', '', idea.melody ? 'now' : 'todo', idea.melody ? col('seed2') : 'transparent'));
      return out.join('');
    }
    if (path === 'melody') out.push(chip('Melody', 'leads', 'lead', col('seed2')));
    else if (!A.isDone(idea)) {
      // a groove's or riff's first screens, in order
      open.forEach((d) => { const has = A.hasOpen(idea, d); out.push(chip(A.DIRS[d].label, has ? 'picked' : '', dir === d ? 'now' : has ? '' : 'todo', has || dir === d ? col(d) : 'transparent')); });
      return out.join('');
    } else out.push(chip(A.PATHS[path].label, 'leads', 'lead', col(open[0])));
    idea.order.filter((d) => open.indexOf(d) < 0).forEach((d) => out.push(chip(d === 'hook' ? 'Hook' : A.DIRS[d].label, '', pop(d) + (dir === d ? ' now' : ''), col(d))));
    const now = dir === 'seed2' && path !== 'melody' ? 'hook' : dir;
    if (S.round && idea.order.indexOf(now) < 0) out.push(chip(now === 'hook' ? 'Hook' : A.DIRS[now].label, dir === 'seed2' ? 'its shape' : 'choosing', 'now', col(now)));
    return out.join('');
  }

  function roundHtml(animate) {
    const dir = S.round.dir, opts = F.options(S), inf = F.info(S);
    const kind = S.kind;
    const cards = opts.map((o, i) => {
      let anim = 'b-pop', delay = (i * 0.08).toFixed(2) + 's';
      if (kind === 'rise') { if (i === 1) { anim = 'b-rise'; delay = '0s'; } else delay = (0.18 + i * 0.05).toFixed(2) + 's'; }
      // dealt from the deck: the row slides in from the side it came from, the leading card first
      if (kind === 'next') { anim = 'b-in-r'; delay = (i * 0.05).toFixed(2) + 's'; }
      if (kind === 'prev') { anim = 'b-in-l'; delay = ((opts.length - 1 - i) * 0.05).toFixed(2) + 's'; }
      const style = animate ? 'animation-name:' + anim + ';animation-delay:' + delay : '';
      const prom = dir === 'seed2' && A.pathOf(S.idea) !== 'melody' ? 'Promote: that’s the hook' : PROMOTE[dir] || 'Add it';
      return card(dir, o, S.idea, { key: curKey(i), i, letter: A.ABC.charAt(i), promote: prom, style });
    }).join('');
    const callouts = opts.map((_, i) => '<div class="b-call" data-i="' + i + '"></div>').join('');
    const last = inf.batch >= inf.batches - 1;
    const arrow = (side, act, label, glyph, off) => '<button type="button" class="b-arrow ' + side + '" data-act="' + act + '" aria-label="' + label + '" title="' + label + '"' + (off ? ' disabled' : '') + '>' + glyph + '</button>';
    const LEFT = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const RIGHT = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4l6 6-6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const SHUF = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h3.5c2 0 3 1 4 4s2 4 4 4H17M3 14h3.5c1.2 0 2-.4 2.7-1.2M17 6h-2.5c-1.2 0-2 .4-2.7 1.2M14.5 3.5 17 6l-2.5 2.5M14.5 11.5 17 14l-2.5 2.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    // the pool: one tick per card, grouped in the threes they're dealt in
    const seen = Math.max(S.round.seen || 0, inf.batch);
    const strip = inf.sizes.map((n, b) => '<button type="button" class="b-seg' + (b === inf.batch ? ' now' : b <= seen ? ' seen' : '') + '" data-act="jump" data-b="' + b + '" tabindex="-1" aria-label="Cards ' + (inf.sizes.slice(0, b).reduce((t, x) => t + x, 0) + 1) + ' to ' + (inf.sizes.slice(0, b + 1).reduce((t, x) => t + x, 0)) + '">' + '<i></i>'.repeat(n) + '</button>').join('');
    const count = (inf.from === inf.to ? inf.from : inf.from + '–' + inf.to) + ' of ' + inf.total + ' ' + NOUN[dir] + (inf.deal ? ' · shuffled' : '');
    return '<div class="b-deal">' +
        '<div class="b-callouts" style="grid-template-columns:repeat(' + opts.length + ',300px)">' + callouts + '</div>' +
        arrow('prev', 'prev', 'The three before', LEFT, inf.batch === 0) +
        '<div class="b-cards">' + cards + '</div>' +
        (last ? arrow('next shuf', 'next', 'That’s all of them: shuffle and deal again', SHUF, inf.batches < 2) : arrow('next', 'next', 'The next three', RIGHT, false)) +
      '</div>' +
      '<div class="b-pool" aria-label="The deck">' +
        '<div class="b-strip">' + strip + '</div>' +
        '<span class="b-count">' + esc(count) + '</span>' +
      '</div>' +
      '<div class="b-actions">' +
        (A.ownLabel(dir) ? '<button type="button" class="b-ghost" data-act="own">' + esc(A.ownLabel(dir)) + '</button>' : '') +
        (A.isOpening(S.idea, dir) ? '' : '<button type="button" class="b-ghost" data-act="skip">' + esc(A.SKIP_LABEL[dir] || 'Not now') + '</button>') +
        '<span class="b-hint">Click a card to hear it, or press 1, 2, 3. The arrows (or ← →) deal the three before or after; nothing is lost.</span>' +
      '</div>';
  }

  function nextHtml(animate) {
    const dirs = A.directions(S.idea).map((d, i) => {
      const has = S.idea.layers[d];
      return '<button type="button" class="b-dir' + (has ? ' done' : '') + '" data-act="go" data-dir="' + d + '"' + (animate ? ' style="animation-delay:' + (i * 0.05).toFixed(2) + 's"' : ' style="animation:none"') + '>' +
        '<span class="b-dir-top"><i class="b-dot-c" style="background:' + col(d) + '"></i><b>' + esc(A.DIRS[d].label) + '</b>' +
          (has ? '<span class="b-doneb">Added · try again</span>' : '') +
        '</span>' +
        '<span class="b-dir-sub">' + esc(has ? 'Now: ' + A.tagOf(d, has) : A.dirSub(S.idea, d)) + '</span>' +
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

  /** the opening choice: three big cards, a tap to hear one, a second to start there */
  function openHtml(animate) {
    const cards = A.PATH_ORDER.map((p, i) => {
      const P0 = A.PATHS[p], name = P0.label.toLowerCase();
      return '<div class="b-big" data-key="x-' + p + '" data-path="' + p + '"' + (animate ? ' style="animation-delay:' + (i * 0.08).toFixed(2) + 's"' : ' style="animation:none"') + '>' +
        '<button type="button" class="b-hit" data-act="peek" data-path="' + p + '" aria-label="' + esc(P0.label + ': hear an example. Tap again to start with a ' + name) + '"></button>' +
        '<span class="b-big-name" style="color:' + col(A.PATHS[p].open[0]) + '">' + esc(P0.label) + '</span>' +
        '<span class="b-big-line">' + esc(P0.line) + '</span>' +
        '<button type="button" class="b-primary b-big-go" data-act="begin" data-path="' + p + '">Start with a ' + esc(name) + '</button>' +
      '</div>';
    }).join('');
    return '<div class="b-open">' + cards + '</div><p class="b-hint b-open-hint">Tap a card to hear an example of it. Each time is a new one.</p>';
  }

  function full() {
    const animate = S.anim !== lastAnim;
    let body = '';
    if (S.phase === 'start') body = openHtml(animate);
    else if (S.phase === 'round') body = roundHtml(animate);
    else if (S.phase === 'next') body = nextHtml(animate);
    else body = goldHtml(animate);
    root.innerHTML =
      '<div class="b2g' + (animate ? ' b-animate' : '') + '">' +
        '<header class="b-top">' +
          '<div class="b-brand">' + Odd.brand.homeButton() + '<span>Bones to Gold</span></div>' +
          '<nav class="b-chips" aria-label="Your idea so far">' + chipsHtml() + '</nav>' +
          '<div class="b-top-r">' +
            (S.phase === 'start' ? '' : '<span class="b-meta">' + esc(A.metaOf(S.idea)) + '</span>') +
            (F.canFinish(S) ? '<button type="button" class="b-primary" data-act="finish">That’s the idea</button>' : '') +
            (S.phase === 'round' || S.phase === 'next' ? '<button type="button" class="b-ghost" data-act="restart" title="Back to Groove, Melody or Riff">New idea</button>' : '') +
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
      if (el.classList.contains('b-big')) el.classList.toggle('lifted', S.phase === 'start' && S.peek === el.dataset.path);
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
          const same = (k) => rq[k] && Math.sign(st[k] || 0) === Math.sign(rq[k]);
          const active = (rq.x && st.x === rq.x) || same('p') || same('s') || same('t') || same('c');
          if (rq.m && st.m) return '<button type="button" class="b-req on" data-act="req" data-i="' + i + '">' + esc(rq.label + ' (' + st.m + ')') + '</button>';
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
