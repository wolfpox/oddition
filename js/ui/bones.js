/* Oddition — Bones to Gold screen: audition a starting idea with Bobby Beatdown.
 *
 * Opens on a choice of three (Groove, Melody, Riff): tapping a card plays
 * an example of that kind of idea, a second tap starts down its path.
 * Draws the rounds Odd.audition.flow steps through and plays them on the
 * app's transport. Listening paces itself: from silence a card plays at once;
 * switching away from something playing stops it, lowers its card, and gives
 * two seconds of quiet (Bobby says a line) before the next one lifts and plays.
 *
 * The booth: the card playing lifts, and under it are three answers: ✗ not
 * it (Bobby asks why, says what the card has on each reason, and offers it
 * changed or the deck filtered), Tweak (what if? the card's own dials, from
 * where it sits to as far as it stays itself: Odd.tweak) and ✓ (keep it and
 * build on it). Bobby's bubble holds the questions a card raises (Odd.booth).
 * A dev menu on the left edge hides what the cards show, one kind at a
 * time; with the piano roll hidden a card shows the sound's EQ instead.
 *
 * Watch Bobby: from the opener he can build one himself (Odd.watch plans
 * the run), playing each card and saying why he takes the one he takes.
 * While he works, the screen only listens: Pause, Back, Next and Take over.
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
  const DEV_KEY = 'oddition.dev.v1';
  const B = Odd.booth;
  // what the dev menu can hide on the cards: [key, label]
  const HIDES = [
    ['words', 'Descriptive words'], ['bpm', 'BPM'], ['key', 'Key (note names)'], ['scale', 'Scale'], ['chords', 'Chords'], ['roll', 'Piano roll'],
    ['inst', 'Instrument names'], ['meter', 'Meter (3/4, 6/8…)'], ['num', 'Numbers (counts, %, intervals)'], ['letter', 'Letters A B C'], ['deck', 'Deck counter'],
  ];
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
  let lastAnim = -1, lastHid = -1;
  let raf = 0, saveTimer = 0, sliding = false;
  // Bobby building one himself: the planned steps, where he is, and the timer to the next
  let W = null;
  const WATCH_ACTS = { wpause: 1, wnext: 1, wprev: 1, wtake: 1, wcopy: 1, home: 1, studio: 1 };
  // talking about the lifted card: ready, answer, why (the reasons for a no), facts (what it has)
  let T = { key: '', mode: 'ready' };
  let talkKey = '';
  // a line that stays with the card it came with (a request's reply, what changed)
  let held = { key: '', text: '' };
  // tweaking: the panel open (on the card in slot), the panel last drawn, a dial to focus after a turn, the dial Bobby turned last, a drag in progress
  const TU = { open: false, slot: '', key: '', focus: '', last: '', drag: null, timer: 0 };
  let dev = { open: false, hide: {} };
  let devEl = null;
  const EQ = { buf: null, lv: [], pk: [], colors: null };

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
      if (root.classList.contains('hx-roll')) drawEq();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  /**
   * The booth's view of the sound with the piano roll hidden: what's
   * playing, as energy across the range, lows on the left. Bands are spaced
   * like the ear hears them (each a step up in pitch, not in Hz).
   */
  const EQ_BANDS = 30, EQ_LO = 35, EQ_HI = 14000;
  function drawEq() {
    const an = Odd.audio && Odd.audio.analyser;
    const cs = Array.from(new Set(root.querySelectorAll('.is-playing .b-eq')));
    if (!an || !cs.length) return;
    if (!EQ.buf || EQ.buf.length !== an.frequencyBinCount) EQ.buf = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(EQ.buf);
    const hz = an.context.sampleRate / an.fftSize;
    if (!EQ.colors) {
      const st = getComputedStyle(root);
      EQ.colors = ['--r-bass', '--r-chords', '--r-lead', '--faint'].map((v) => st.getPropertyValue(v).trim() || '#999');
    }
    for (let k = 0; k < EQ_BANDS; k++) {
      const f0 = EQ_LO * Math.pow(EQ_HI / EQ_LO, k / EQ_BANDS), f1 = EQ_LO * Math.pow(EQ_HI / EQ_LO, (k + 1) / EQ_BANDS);
      let v = 0;
      for (let b = Math.floor(f0 / hz); b <= Math.max(Math.floor(f0 / hz), Math.ceil(f1 / hz) - 1) && b < EQ.buf.length; b++) v = Math.max(v, EQ.buf[b]);
      v /= 255;
      EQ.lv[k] = Math.max(v, (EQ.lv[k] || 0) * 0.86);
      EQ.pk[k] = Math.max(EQ.lv[k], (EQ.pk[k] || 0) - 0.008);
    }
    cs.forEach((c) => {
      const g = c.getContext('2d'), W0 = c.width, H0 = c.height, base = H0 - 30, bw = W0 / EQ_BANDS;
      c.dataset.on = '1';
      g.clearRect(0, 0, W0, H0);
      for (let k = 0; k < EQ_BANDS; k++) {
        const f = EQ_LO * Math.pow(EQ_HI / EQ_LO, (k + 0.5) / EQ_BANDS);
        g.fillStyle = f < 250 ? EQ.colors[0] : f < 2500 ? EQ.colors[1] : EQ.colors[2];
        const h = Math.max(2, EQ.lv[k] * (base - 8));
        g.globalAlpha = 0.85;
        g.fillRect(k * bw + 2, base - h, bw - 4, h);
        g.globalAlpha = 1;
        g.fillRect(k * bw + 2, base - EQ.pk[k] * (base - 8) - 3, bw - 4, 3);
      }
      g.fillStyle = EQ.colors[3];
      g.font = '600 18px ui-monospace, monospace';
      const xAt = (f) => Math.log(f / EQ_LO) / Math.log(EQ_HI / EQ_LO) * W0;
      g.fillText('LOWS', 8, H0 - 8);
      g.fillText('MIDS', xAt(250) + 8, H0 - 8);
      g.fillText('HIGHS', xAt(2500) + 8, H0 - 8);
      g.fillRect(xAt(250), base + 4, 2, 24);
      g.fillRect(xAt(2500), base + 4, 2, 24);
    });
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
    held = { key: curKey(1), text: ns.line || rq.reply };
    hear(curKey(1), ns.line || rq.reply, busy);
  }

  // ---------------------------------------------------------------- the booth: keep, pass, ask

  /** the talk about the lifted card, fresh whenever another card lifts */
  function talk() {
    const k = S.phase === 'round' && S.sel >= 0 ? curKey(S.sel) : '';
    if (T.key !== k) T = { key: k, mode: 'ready', why: [] };
    return T;
  }
  function talking() { return S.phase === 'round' && S.sel >= 0 && !P.pending && P.heard === curKey(S.sel) && !!F.options(S)[S.sel]; }
  function nope(i) {
    if (!talking() || S.sel !== i) return;
    Object.assign(talk(), { mode: 'why', why: [] });
    render();
  }
  function toggleWhy(id) {
    const t = talk();
    t.why = t.why.indexOf(id) >= 0 ? t.why.filter((x) => x !== id) : t.why.concat([id]);
    render();
  }
  function whyDone() {
    const t = talk();
    if (!t.why.length) return;
    const ids = B.FACTORS.map((f) => f.id).filter((id) => t.why.indexOf(id) >= 0);
    const ns = B.flow.reject(S, S.sel, ids);
    Object.assign(t, { mode: 'facts', why: ids, facts: B.facts(ns, S.sel, ids), canChange: !!B.changed(ns, S.sel, ids), canCut: !!B.cutsFor(ns, S.sel, ids), note: '' });
    set(Object.assign({}, ns, { line: null }));
  }
  function changeIt() {
    const t = talk(), busy = P.playing || !!P.pending;
    const r = B.flow.change(S, S.sel, t.why);
    if (!r) { t.canChange = false; t.note = 'Nothing else in this deck goes the other way on that.'; render(); return; }
    halt();
    set(r.S);
    const line = 'Here it is changed. ' + r.text;
    held = { key: curKey(r.S.sel), text: line };
    hear(curKey(r.S.sel), line, busy);
  }
  function cutIt() {
    const t = talk(), busy = P.playing || !!P.pending;
    const r = B.flow.cut(S, S.sel, t.why);
    if (!r) { t.canCut = false; render(); return; }
    halt();
    P.src = '';
    set(r.S);
    const line = 'Filtered out ' + r.text + ': ' + (r.gone === 1 ? 'one card' : r.gone + ' cards') + ' gone, ' + r.left + ' left. Here’s one of them.';
    held = { key: curKey(1), text: line };
    hear(curKey(1), line, busy);
  }
  function passIt() {
    halt();
    T = { key: '', mode: 'ready', why: [] };
    set(Object.assign({}, S, { sel: -1, line: 'Noted. It stays where it is, marked, in case you change your mind. Try another.' }));
  }
  function ask(id) {
    if (!talking()) return;
    const an = B.answer(S, S.sel, id);
    Object.assign(talk(), { mode: 'answer', said: an.text, acts: an.acts, topic: id });
    render();
  }

  // ---------------------------------------------------------------- tweak: the lifted card's own dials

  const TWEAK_HELLO = 'What if? Each dial starts where this card already sits. Turn one and you hear this card changed, not another card. The bright part of a track is as far as it goes and stays itself.';
  /** the slot the panel belongs to: it closes when another card lifts */
  const slotKey = () => (S.round && S.sel >= 0 ? [S.round.dir, F.info(S).batch, S.sel].join('|') : '');
  function tweakOpen() { return TU.open && TU.slot === slotKey() && talking() && !W; }
  /** Tweak: open the dials on the card that's playing, or close them */
  function tweakIt(i) {
    if (!talking() || S.sel !== i) return;
    talk().mode = 'ready';
    if (!B.canTweak(S, i)) {
      held = { key: curKey(i), text: 'Nothing to tweak on ' + (NOUN[S.round.dir] || 'these') + ' yet. Pick by ear, or pass on it.' };
      render();
      return;
    }
    TU.open = !tweakOpen();
    TU.slot = slotKey();
    held = TU.open ? { key: curKey(i), text: TWEAK_HELLO } : { key: '', text: '' };
    render();
  }

  /** the knob at p, the fill from the middle line to it */
  function faderStyle(p) {
    return '--p:' + p.toFixed(3) + ';--fb:' + (Math.min(p, 0.5) * 100).toFixed(1) + '%;--fh:' + (Math.abs(p - 0.5) * 100).toFixed(1) + '%';
  }
  function leanText(d, p) {
    const a = Math.abs(p - 0.5) * 2, end = (p > 0.5 ? d.hi : d.lo).toLowerCase();
    if (a < 0.12) return 'in the middle';
    return a < 0.55 ? 'a little ' + end : a < 0.95 ? end : 'all the way ' + end;
  }
  function tuneHtml() {
    const ds = B.dials(S, S.sel);
    if (!ds.length) return '';
    const faders = ds.map((d) => {
      const stops = d.stops.map((m) => '<i class="b-fmark" style="bottom:' + (m * 100).toFixed(1) + '%"></i>').join('');
      // the reach: as far as it goes and stays itself; the home mark: where the card came
      const reach = d.fixed ? '' : '<i class="b-freach" style="bottom:calc(' + (d.reach[0] * 100).toFixed(1) + '% - 7px);height:calc(' + ((d.reach[1] - d.reach[0]) * 100).toFixed(1) + '% + 14px)"></i>';
      const home = d.fixed || Math.abs(d.home - d.pos) < 1e-6 ? '' : '<i class="b-fhome" style="bottom:' + (d.home * 100).toFixed(1) + '%" title="Where it came"></i>';
      return '<div class="b-fader' + (d.fixed ? ' fixed' : '') + '" data-f="' + d.id + '" data-p="' + d.pos.toFixed(3) + '" data-start="' + d.pos.toFixed(3) + '" style="' + faderStyle(d.pos) + '">' +
        '<span class="b-fend hi">' + esc(d.hi) + '</span>' +
        '<div class="b-ftrack" role="slider" tabindex="0" aria-orientation="vertical" aria-label="' + esc(d.lo + ' to ' + d.hi) + '"' +
          ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(d.pos * 100) + '" aria-valuetext="' + esc(d.fixed ? d.why : leanText(d, d.pos)) + '"' +
          (d.fixed ? ' aria-disabled="true" title="' + esc(d.why) + '"' : '') + ' data-stops="' + d.stops.join(',') + '">' +
          reach + stops + home + '<i class="b-ffill"></i><i class="b-fknob"></i>' +
        '</div>' +
        '<span class="b-fend lo">' + esc(d.lo) + '</span>' +
      '</div>';
    }).join('');
    const back = B.isTweaked(S, S.sel) ? '<button type="button" class="b-link" data-act="untweak">Back to how it came</button>' : '';
    return '<div class="b-faders">' + faders + '</div>' +
      '<div class="b-tune-do"><button type="button" class="b-link" data-act="nudge">Let Bobby turn one</button>' + back + '</div>';
  }
  function setFader(fader, p) {
    fader.dataset.p = p.toFixed(3);
    fader.setAttribute('style', faderStyle(p));
    const tr = fader.querySelector('.b-ftrack');
    tr.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    const d = { lo: fader.querySelector('.b-fend.lo').textContent, hi: fader.querySelector('.b-fend.hi').textContent };
    tr.setAttribute('aria-valuetext', leanText(d, p));
  }
  /** a dial that can't move here: Bobby says why */
  function dialWhy(fid) {
    const d = B.dials(S, S.sel).find((x) => x.id === fid);
    if (!d) return;
    talk().mode = 'ready';
    held = { key: curKey(S.sel), text: d.lo + ' to ' + d.hi + ': ' + d.why };
    render();
  }
  /** turn a dial: the card itself changes and plays at once */
  function tuneTo(fid, pos, by) {
    if (S.phase !== 'round' || !talking()) return;
    const r = B.flow.tune(S, S.sel, fid, pos);
    if (!r || r.same) {
      talk().mode = 'ready';
      const text = (by ? by + ' ' : '') + (r && r.text ? r.text : '');
      if (text.trim()) held = { key: curKey(S.sel), text: text.trim() };
      TU.key = '';
      render();
      return;
    }
    hearSwap(r.S, (by ? by + ' ' : '') + r.text);
  }
  /** the tweaked (or untweaked) card in its slot, heard at once, the panel staying open on it */
  function hearSwap(ns, line) {
    halt();
    set(ns);
    TU.slot = slotKey();
    held = { key: curKey(ns.sel), text: line };
    hear(curKey(ns.sel), line, false);
  }
  function untweak() {
    if (!talking()) return;
    const r = B.flow.untweak(S, S.sel);
    if (r) hearSwap(r.S, r.text);
  }
  function nudge() {
    if (!talking()) return;
    const n = B.nudge(S, S.sel, TU.last);
    if (!n) { held = { key: curKey(S.sel), text: 'Every dial here is as far as it goes. Pass on it, or keep it.' }; render(); return; }
    TU.last = n.id;
    const fader = root.querySelector('.b-card.lifted .b-fader[data-f="' + n.id + '"]');
    if (fader) setFader(fader, n.pos);
    clearTimeout(TU.timer);
    // long enough to see the knob travel before the card changes
    TU.timer = setTimeout(() => tuneTo(n.id, n.pos, n.line), 450);
  }
  function trackAt(e) {
    const tr = e.target && e.target.closest ? e.target.closest('.b-ftrack') : null;
    return tr && root.contains(tr) && !W ? tr : null;
  }
  function yPos(tr, y) {
    const r = tr.getBoundingClientRect();
    return Math.max(0, Math.min(1, (r.bottom - y) / r.height));
  }
  function dialDown(e) {
    const tr = trackAt(e);
    if (!tr || (e.button != null && e.button > 0)) return;
    const fader = tr.closest('.b-fader');
    if (tr.getAttribute('aria-disabled') === 'true') { dialWhy(fader.dataset.f); return; }
    e.preventDefault();
    try { tr.setPointerCapture(e.pointerId); } catch (x) { /* capture is a nicety */ }
    tr.focus({ preventScroll: true });
    clearTimeout(TU.timer);
    TU.drag = { id: e.pointerId, fader, fid: fader.dataset.f, start: Number(fader.dataset.start) };
    fader.classList.add('drag');
    setFader(fader, yPos(tr, e.clientY));
  }
  function dialMove(e) {
    const g = TU.drag;
    if (!g || e.pointerId !== g.id) return;
    setFader(g.fader, yPos(g.fader.querySelector('.b-ftrack'), e.clientY));
  }
  function dialUp(e) {
    const g = TU.drag;
    if (!g || e.pointerId !== g.id) return;
    TU.drag = null;
    g.fader.classList.remove('drag');
    const p = Number(g.fader.dataset.p);
    // a tap on the knob is not a turn
    if (e.type === 'pointercancel' || Math.abs(p - g.start) < 0.04) { setFader(g.fader, g.start); return; }
    TU.focus = g.fid;
    tuneTo(g.fid, p);
  }
  /** ↑ → one step toward the top word, ↓ ← toward the bottom one, Home and End as far as it goes: a step is the next spot it can go */
  function dialKey(e) {
    const tr = trackAt(e);
    if (!tr) return;
    const k = e.key, up = k === 'ArrowUp' || k === 'ArrowRight', down = k === 'ArrowDown' || k === 'ArrowLeft';
    if (!up && !down && k !== 'Home' && k !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const fader = tr.closest('.b-fader');
    if (tr.getAttribute('aria-disabled') === 'true') { dialWhy(fader.dataset.f); return; }
    const cur = Number(fader.dataset.p), stops = tr.dataset.stops.split(',').map(Number);
    const next = k === 'Home' ? stops[0] : k === 'End' ? stops[stops.length - 1] : up ? stops.find((m) => m > cur + 1e-4) : stops.slice().reverse().find((m) => m < cur - 1e-4);
    if (next == null) return;
    setFader(fader, next);
    clearTimeout(TU.timer);
    // a run of presses is one turn
    TU.timer = setTimeout(() => { TU.focus = fader.dataset.f; tuneTo(fader.dataset.f, next); }, 350);
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
    if (W) { clearTimeout(W.timer); W = null; }
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

  // ---------------------------------------------------------------- watch Bobby

  // a steady pace: a step with sound lasts one pass of it (two at most, when he has more to say); one without, long enough to read
  const passMs = (q) => (q ? (q.length / (A.STEP_TICKS * 4)) * (60000 / q.bpm) : 0);
  const readMs = (text) => 1000 + 28 * String(text || '').length;

  /** Bobby builds one: on a path, or one he picks */
  function watch(path) {
    halt();
    P.src = '';
    const run = Odd.watch.plan({ seed: (Date.now() % 1e9) + Math.floor(Math.random() * 1e6), path: A.PATHS[path] ? path : null });
    // offsets keep this run's screens from matching an earlier run's
    W = { steps: run.steps, i: -1, paused: false, timer: 0, brief: run.brief, path: run.path, seq: S.seq + 1, anim: S.anim + 1 };
    goStep(0);
  }
  function goStep(i) {
    if (!W) return;
    clearTimeout(W.timer);
    if (i >= W.steps.length) { endWatch(); return; }
    W.i = Math.max(0, i);
    const st = W.steps[W.i];
    set(Object.assign({}, st.S, { line: st.say, seq: st.S.seq + W.seq, anim: st.S.anim + W.anim }));
    const key = st.hear == null ? '' : st.hear === 'all' ? 'all' : curKey(st.hear);
    let ms = Math.min(6000, readMs(st.say));
    const a = key ? audioFor(key) : null; // paused, Back and Next still play the step; it just doesn't move on
    if (a) {
      const q = a.seq(), pass = passMs(q) + 250;
      if (!(P.playing && P.src === key)) { halt(); run(q); P.src = key; P.heard = key; }
      ms = Math.max(pass, Math.min(readMs(st.say), 2 * pass));
    } else if (!key) halt();
    render();
    if (!W.paused) W.timer = setTimeout(() => goStep(W.i + 1), ms);
  }
  function pauseWatch() {
    if (!W) return;
    if (W.paused) { W.paused = false; goStep(W.i); return; }
    W.paused = true;
    clearTimeout(W.timer);
    halt();
    render();
  }
  function endWatch() {
    if (!W) return;
    clearTimeout(W.timer);
    W = null;
    halt();
    render();
  }
  /** stop watching and carry on from here, everything live again */
  function takeOver() {
    if (!W) return;
    clearTimeout(W.timer);
    W = null;
    set(Object.assign({}, S, { line: 'Your turn. Everything’s live again: pick, ask, go back.' }));
  }
  function copyLog() {
    const txt = Odd.watch.transcript(S.watch);
    const done = () => { if (host.toast) host.toast('Copied how Bobby built it.'); };
    try { navigator.clipboard.writeText(txt).then(done, () => { if (host.toast) host.toast('Couldn’t copy here.', { kind: 'warn' }); }); } catch (e) { if (host.toast) host.toast('Couldn’t copy here.', { kind: 'warn' }); }
  }

  const ACTS = {
    watch: (el) => watch(el.dataset.path),
    wpause: () => pauseWatch(),
    wnext: () => goStep(W ? W.i + 1 : 0),
    wprev: () => goStep(W ? W.i - 1 : 0),
    wtake: () => takeOver(),
    wcopy: () => copyLog(),
    peek: (el) => peek(el.dataset.path),
    begin: (el) => begin(el.dataset.path),
    hear: (el) => hear(el.dataset.key),
    promote: (el) => promote(Number(el.dataset.i)),
    nope: (el) => nope(Number(el.dataset.i)),
    tweak: (el) => tweakIt(Number(el.dataset.i)),
    ask: (el) => ask(el.dataset.t),
    why: (el) => toggleWhy(el.dataset.f),
    whydone: () => whyDone(),
    whycancel: () => { talk().mode = 'ready'; render(); },
    change: () => changeIt(),
    cutit: () => cutIt(),
    pass: () => passIt(),
    uncut: () => { halt(); P.src = ''; set(B.flow.uncut(S)); },
    untweak: () => untweak(),
    nudge: () => nudge(),
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
    if (W && !WATCH_ACTS[el.dataset.act]) return; // he's working: the screen only listens
    const fn = ACTS[el.dataset.act];
    if (fn) fn(el);
  }

  /** keys while the screen shows: Space play/stop, 1-3 hear A-C, ←/→ the three before or after, Escape stop. true when handled */
  function onKey(e) {
    if (!shown || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    if (W) {
      if (k === ' ' && e.target && e.target.closest && e.target.closest('button') && e.target.closest('#bones')) return false;
      if (k === ' ' || k === 'Escape') { e.preventDefault(); if (k === ' ' || !W.paused) pauseWatch(); return true; }
      if (k === 'ArrowRight') { e.preventDefault(); goStep(W.i + 1); return true; }
      if (k === 'ArrowLeft') { e.preventDefault(); goStep(W.i - 1); return true; }
      return false;
    }
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
    // the booth: x pass, T tweak, Enter keep, on the card that's lifted
    if (S.phase === 'round' && talking() && !(e.target && e.target.closest && e.target.closest('button, input, textarea, select, [role="slider"]'))) {
      if (k === 'x' || k === 'X' || k === 'Delete' || k === 'Backspace') { e.preventDefault(); nope(S.sel); return true; }
      if (k === 't' || k === 'T') { e.preventDefault(); tweakIt(S.sel); return true; }
      if (k === 'Enter') { e.preventDefault(); promote(S.sel); return true; }
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
    return chords.map((c, i) => '<span data-x="chords" class="b-chd ' + (c.colour ? 'col' : c.q === '' ? 'maj' : 'min') + '" style="left:' + r1(xOf(slots[i].s)) + 'px;top:' + top + 'px;width:' + r1(sw(slots[i].len) - 3) + 'px">' + esc(A.chordName(c)) + '</span>').join('');
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
      for (let pc = 0; pc < 12; pc++) h += '<i data-x="scale" class="b-cell' + (pc === 0 ? ' root' : sc.includes(pc) ? ' on' : '') + '" style="left:' + r1(4 + pc * cw + 1) + 'px;top:' + (VH - 15) + 'px;width:' + r1(cw - 2) + 'px"></i>';
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
      h += '<span data-x="key" class="b-nlab" style="left:' + r1(Math.min(last.x - 4, VW - 22)) + 'px;top:' + r1(last.y < 22 ? last.y + 9 : last.y - 20) + 'px">' + esc(A.NAMES[mod(ns[ns.length - 1].m, 12)]) + '</span>';
    } else if (dir === 'chords') {
      ghost(6, 50);
      const slots = A.slotsOf(m);
      o.chords.forEach((c, i) => { h += '<span data-x="chords" class="b-chd ' + (c.colour ? 'col' : c.q === '' ? 'maj' : 'min') + '" style="left:' + r1(xOf(slots[i].s)) + 'px;top:62px;width:' + r1(sw(slots[i].len) - 3) + 'px">' + esc(A.chordName(c)) + '</span>'; });
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
      h += '<span data-x="bpm" class="b-nlab" style="left:8px;top:8px">' + esc(o.bpm + ' BPM') + '</span>' + (o.swing ? '<span data-x="words" class="b-nlab" style="left:62px;top:8px">swung</span>' : '');
    } else if (dir === 'gbass') {
      // the kick it plays against, the bass, and the chords it implies
      idea.layers.pocket.k.forEach((s) => { h += blk(xOf(s), 82, 5, 6, '', 'ghost'); });
      h += lane(o.notes, 32, 46, col('gbass'), '', 7);
      h += chordRow(o.chords, m, 4);
    } else if (dir === 'keys') {
      ghost(70, 18);
      if (o.none) h += '<span data-x="words" class="b-nlab" style="left:10px;top:24px">no chords: just drums and bass</span>';
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
      h += '<span data-x="inst" class="b-nlab" style="left:10px;top:74px">' + esc(o.inst) + '</span>' + (o.swing ? '<span data-x="words" class="b-nlab" style="left:10px;top:60px">swung</span>' : '');
    }
    return h + '<i class="b-ph"></i><canvas class="b-eq" width="544" height="184"></canvas>';
  }

  /**
   * What a card says in words, each piece tagged with what it is so the dev
   * menu can hide it: [kind, text]. alt: shown only when the piano roll
   * (which already draws it) is hidden.
   */
  function headFacts(dir, o, idea) {
    const f = [], add = (x, t) => { if (t != null && t !== '') f.push([x, String(t)]); };
    const parts = (d) => String(d || '').split(' · ');
    const meter = (id) => add('meter', id && id !== '4/4' ? id : '');
    const swung = (x) => add('words', x ? 'swung' : '');
    if (dir === 'seed1') { add('scale', A.MODE[o.mel.scale].name.toLowerCase()); meter(A.meterOf(o.mel).id); } else if (dir === 'seed2') {
      add('num', 'lands on ' + A.IV[o.land]);
      const ns = A.melodyNotes(o.mel);
      add('key alt', 'ends on ' + A.NAMES[mod(ns[ns.length - 1].m, 12)]);
    } else if (dir === 'chords') { add('chords alt', A.chordLine(o.chords)); add('num', o.fit + '% fit'); } else if (dir === 'bass') add(o.detail ? 'words' : 'num', o.detail || o.n + (o.n === 1 ? ' note' : ' notes'));
    else if (dir === 'pads') { if (o.detail) { add('words', parts(o.detail)[0]); add('inst', parts(o.detail)[1]); } else add('num', o.voices + (o.voices === 1 ? ' voice' : ' voices')); } else if (dir === 'perc') add(o.detail ? 'words' : 'num', o.detail || o.n + ' hits');
    else if (dir === 'pocket') { add('bpm', o.bpm + ' BPM'); swung(o.swing); parts(o.detail).forEach((x) => add('words', x)); meter(o.m); } else if (dir === 'hook') add('num', Math.round(100 * (1 - o.clash)) + '% in the gaps');
    else if (dir === 'rrhythm') { add('num', o.r.n + ' hits'); add('words', o.r.turn ? 'new ending' : ''); meter(o.r.m); } else if (dir === 'gbass') { add('chords', A.chordLine(o.chords)); add('scale', A.MODE[o.scale].name.toLowerCase()); } else if (dir === 'keys') {
      if (o.none) add('words', o.detail);
      else { add('words', parts(o.detail)[0]); add('inst', parts(o.detail)[1]); }
      if (idea && idea.layers.gbass) add('chords alt', A.chordLine(idea.layers.gbass.chords));
    } else if (dir === 'rnotes') add('scale', o.detail);
    else if (dir === 'weight') add('inst', o.detail);
    else if (dir === 'under') { add(o.changes ? 'chords' : 'words', parts(o.detail)[0]); add('inst', parts(o.detail)[1]); } else if (dir === 'beat' || dir === 'drums') { swung(o.swing); add(o.detail ? 'words' : 'num', o.detail || Math.round(o.off * 100) + '% off grid'); } else if (dir === 'sound') {
      add('bpm', o.bpm + ' BPM');
      if (o.detail) parts(o.detail).forEach((x) => add('inst', x));
      else { add('inst', o.inst); swung(o.swing && o.swing > 0.5); }
    }
    return f;
  }

  const X_SVG = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M6.5 6.5l13 13M19.5 6.5l-13 13" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>';
  const TWEAK_SVG = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M6.5 4.5v17M13 4.5v17M19.5 4.5v17" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".4"/><rect x="3.5" y="13" width="6" height="3.6" rx="1.4" fill="currentColor"/><rect x="10" y="7" width="6" height="3.6" rx="1.4" fill="currentColor"/><rect x="16.5" y="15.5" width="6" height="3.6" rx="1.4" fill="currentColor"/></svg>';
  const OK_SVG = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M5.5 13.5l5 5L20.5 7" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function card(dir, o, idea, x) {
    const tag = A.tagOf(dir, o);
    const facts = headFacts(dir, o, idea).map((f) => '<span class="b-f' + (/ alt$/.test(f[0]) ? ' alt' : '') + '" data-x="' + f[0].replace(/ alt$/, '') + '">' + esc(f[1]) + '</span>').join('');
    const head = '<div class="b-head">' + (x.letter ? '<span class="b-letter" data-x="letter">' + x.letter + '</span>' : '') + '<span class="b-tag" data-x="words">' + esc(tag) + '</span><span class="b-stat">' + facts + '</span></div>';
    const label = (x.letter ? 'option ' + x.letter + ': ' : '') + tag;
    // under the lifted card: not it, tweak it, keep
    const booth = x.i != null ? '<div class="b-booth">' +
      '<button type="button" class="b-bx no" data-act="nope" data-i="' + x.i + '" title="Not it (X)" aria-label="Not it: pass on this one">' + X_SVG + '</button>' +
      '<button type="button" class="b-bx tweak' + (x.tweak ? '' : ' off') + '" data-act="tweak" data-i="' + x.i + '" title="' + (x.tweak ? 'Tweak it: what if? (T)' : 'Nothing to tweak here yet') + '" aria-label="Tweak it: what if it were…" aria-expanded="false">' + TWEAK_SVG + '</button>' +
      '<button type="button" class="b-bx yes" data-act="promote" data-i="' + x.i + '" title="' + esc((x.promote || 'Keep it') + ' (Enter)') + '" aria-label="' + esc(x.promote || 'Keep it') + '">' + OK_SVG + '</button>' +
    '</div>' : '';
    return '<div class="b-card' + (x.cls ? ' ' + x.cls : '') + '" data-key="' + x.key + '"' + (x.i != null ? ' data-i="' + x.i + '"' : '') + (x.style ? ' style="' + x.style + '"' : '') + '>' +
      '<button type="button" class="b-hit" data-act="hear" data-key="' + x.key + '" aria-label="Listen to ' + esc(label) + '"></button>' +
      head +
      '<div class="b-vis" aria-hidden="true">' + vis(dir, o, idea) + '</div>' +
      (x.i != null ? '<div class="b-tune" role="group" aria-label="Tune it"></div>' : '') +
      booth +
      '</div>';
  }

  function mini(dir, o, idea, key, extra, letter) {
    return '<div class="b-mini ' + (extra || '') + '" data-key="' + key + '">' + card(dir, o, idea, { key, letter }) + '</div>';
  }

  // ---------------------------------------------------------------- the screen

  const BOBBY_SVG = Odd.brand.BOBBY;

  function bobby(opts) {
    if (W && S.line) return S.line;
    if (S.phase === 'start') return S.peek ? A.line(L.peek[S.peek], (P.ex[S.peek] || 1) - 1) : S.line || L.start;
    if (P.src === 'climb' && P.playing && P.climb >= 0) return A.climbLines(S.idea)[P.climb] || 'That’s gold.';
    // the lifted card: he's ready to talk about it, and only says more when asked
    if (talking()) {
      const t = talk();
      if (t.mode === 'why') return B.ASK_WHY;
      if (t.mode === 'facts') return 'Here’s what you passed on.';
      if (t.mode === 'answer') return t.said;
      if (held.key === curKey(S.sel)) return held.text;
      return S.line || B.ready(S.seq + S.sel);
    }
    if (S.line) return S.line;
    if (P.playing && P.src.charAt(0) === 'h') {
      const pr = P.src.slice(1).split('-').map(Number), row = S.hist.find((x) => x.id === pr[0]);
      if (row) return row.chosen === pr[1] ? L.picked : L.passed;
    }
    const path = A.pathOf(S.idea);
    if (S.phase === 'next') return A.line(path === 'melody' ? L.next : L.nextBy[path], S.seq);
    if (S.phase === 'gold') return A.line(path === 'melody' ? L.gold : L.goldBy[path], S.hid);
    if (S.msg === 'more' || S.msg === 'prev' || S.msg === 'shuffled') return A.line(L[S.msg], S.seq);
    return A.line(L.entry[S.round.dir], S.seq);
  }

  /** what sits in Bobby's bubble under his line: questions, ways to steer, the reasons for a no */
  function talkHtml() {
    if (W || !talking()) return '';
    const t = talk(), dir = S.round.dir, reqs = A.REQS[dir] || [];
    const qs = (skip) => B.questions(S, S.sel).filter((q) => q.id !== skip).slice(0, 3).map((q) => '<button type="button" class="b-q" data-act="ask" data-t="' + q.id + '">' + esc(q.q) + '</button>').join('');
    if (t.mode === 'ready') return '<div class="b-qs">' + qs() + '</div>';
    if (t.mode === 'answer') {
      const acts = (t.acts || []).map((k) => '<button type="button" class="b-steer" data-act="req" data-i="' + k + '">' + esc(reqs[k].label) + '</button>').join('');
      return (acts ? '<div class="b-steers"><span>Hear the deck go:</span>' + acts + '</div>' : '') + '<div class="b-qs">' + qs(t.topic) + '</div>';
    }
    const o = F.options(S)[S.sel];
    if (t.mode === 'why') {
      const boxes = B.reasonsFor(dir, o, S.idea).map((r) => {
        const on = t.why.indexOf(r.id) >= 0;
        return '<button type="button" class="b-why' + (on ? ' on' : '') + '" data-act="why" data-f="' + r.id + '" role="checkbox" aria-checked="' + on + '"><i aria-hidden="true"></i>' + esc(r.label) + '</button>';
      }).join('');
      return '<div class="b-whys" role="group" aria-label="Why not">' + boxes + '</div>' +
        '<div class="b-talk-do"><button type="button" class="b-primary" data-act="whydone"' + (t.why.length ? '' : ' disabled') + '>That’s why</button>' +
        '<button type="button" class="b-ghost" data-act="whycancel">Never mind</button></div>';
    }
    if (t.mode === 'facts') {
      const list = (t.facts || []).map((f) => '<li' + (f.fixed ? ' class="fixed"' : '') + '><b>' + esc(f.label) + '</b> ' + esc(f.text) + '</li>').join('');
      const can = t.canChange || t.canCut;
      return '<ul class="b-facts">' + list + '</ul>' + (t.note ? '<p class="b-talk-note">' + esc(t.note) + '</p>' : '') +
        '<p class="b-talk-ask">' + esc(can ? (t.canChange && t.canCut ? 'Want to hear it changed, or should I filter out cards like it?' : t.canChange ? 'Want to hear it changed?' : 'Want me to filter out cards like it?') : 'Nothing in this round changes that, so there’s nothing to filter. Listen for it later.') + '</p>' +
        '<div class="b-talk-do">' +
          (t.canChange ? '<button type="button" class="b-primary" data-act="change">Hear it changed</button>' : '') +
          (t.canCut ? '<button type="button" class="b-ghost" data-act="cutit">Filter out cards like it</button>' : '') +
          '<button type="button" class="b-ghost" data-act="pass">' + (can ? 'Neither. Next.' : 'Okay') + '</button>' +
        '</div>';
    }
    return '';
  }

  /** the top line in pieces, so the dev menu can hide them */
  function metaHtml(idea) {
    const s0 = idea.layers.sound, pk = idea.layers.pocket, p = A.pathOf(idea);
    const bpm = s0 ? s0.bpm : pk ? pk.bpm : 100, mt = A.isStarted(idea) ? A.ideaMeter(idea).id : '4/4';
    return '<span data-x="words">' + esc(s0 ? s0.name : A.PATHS[p].label) + '</span> · 2 bars<span data-x="bpm"> · ' + bpm + ' BPM</span>' + (mt !== '4/4' ? '<span data-x="meter"> · ' + esc(mt) + '</span>' : '');
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
      const prom = dir === 'seed2' && A.pathOf(S.idea) !== 'melody' ? 'Keep it: that’s the hook' : (PROMOTE[dir] || 'Keep it: add it').replace(/^Promote/, 'Keep it');
      return card(dir, o, S.idea, { key: curKey(i), i, letter: A.ABC.charAt(i), promote: prom, style, tweak: B.canTweak(S, i) });
    }).join('');
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
        arrow('prev', 'prev', 'The three before', LEFT, inf.batch === 0) +
        '<div class="b-cards">' + cards + '</div>' +
        (last ? arrow('next shuf', 'next', 'That’s all of them: shuffle and deal again', SHUF, inf.batches < 2) : arrow('next', 'next', 'The next three', RIGHT, false)) +
      '</div>' +
      '<div class="b-pool" aria-label="The deck" data-x="deck">' +
        '<div class="b-strip">' + strip + '</div>' +
        '<span class="b-count">' + esc(count) + '</span>' +
      '</div>' +
      (inf.cut ? '<div class="b-cutnote">' + esc((inf.cut === 1 ? 'One card' : inf.cut + ' cards') + ' filtered out') + ' <button type="button" class="b-link" data-act="uncut">Bring them back</button></div>' : '') +
      '<div class="b-actions">' +
        (A.ownLabel(dir) ? '<button type="button" class="b-ghost" data-act="own">' + esc(A.ownLabel(dir)) + '</button>' : '') +
        (A.isOpening(S.idea, dir) ? '' : '<button type="button" class="b-ghost" data-act="skip">' + esc(A.SKIP_LABEL[dir] || 'Not now') + '</button>') +
        '<span class="b-hint">Click a card to hear it, or press 1, 2, 3. Under the one playing: ✗ not it (X), the sliders to tweak it, what if it were brighter, busier… (T), ✓ keep it (Enter). The arrows (or ← →) deal the three before or after; nothing is lost.</span>' +
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
      (S.watch && !W ? '<div class="b-again"><span>Watch Bobby build another:</span>' +
        ['', 'groove', 'melody', 'riff'].map((p) => '<button type="button" class="b-ghost" data-act="watch"' + (p ? ' data-path="' + p + '"' : '') + '>' + (p ? A.PATHS[p].label : 'Any') + '</button>').join('') + '</div>' : '') +
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
    return '<div class="b-open">' + cards + '</div><p class="b-hint b-open-hint">Tap a card to hear an example of it. Each time is a new one.</p>' +
      (W ? '' : '<button type="button" class="b-link" data-act="watch">Or watch Bobby build one, and hear why he picks what he picks</button>');
  }

  /** while he works: what he's going for, where he is, and the controls */
  function watchBar() {
    if (!W) return '';
    const B = Odd.watch.BRIEFS[W.brief];
    return '<div class="b-watchbar" role="region" aria-label="Watching Bobby">' +
      '<div class="b-wb-what"><b>Watching Bobby build a ' + esc(A.PATHS[W.path].label.toLowerCase()) + '</b><span>Brief: ' + esc(B.label) + ' · ' + esc(B.line) + '</span></div>' +
      '<div class="b-wb-ctl">' +
        '<span class="b-wb-step"></span>' +
        '<button type="button" class="b-ghost" data-act="wprev" title="Back a step (←)">Back</button>' +
        '<button type="button" class="b-ghost" data-act="wpause" data-label="wpause" title="Space">Pause</button>' +
        '<button type="button" class="b-ghost" data-act="wnext" title="Next step (→)">Next</button>' +
        '<button type="button" class="b-primary" data-act="wtake" title="Stop watching and carry on from here yourself">Take over</button>' +
      '</div>' +
      '<i class="b-wb-bar"><i></i></i>' +
    '</div>';
  }

  /** every decision so far, in order: the pick, why, why it works, and the ones passed over */
  function watchLog() {
    const w = S.watch;
    if (!w || !w.log.length) return '';
    const B = Odd.watch.BRIEFS[w.brief];
    const rows = w.log.map((e, n) =>
      '<li class="b-wl-row">' +
        '<div class="b-wl-head"><span class="b-wl-n">' + (n + 1) + '</span><i class="b-dot-c" style="background:' + col(e.dir) + '"></i><b>' + esc(e.label) + '</b><span class="b-wl-pick">' + esc(e.pick) + '</span>' + (e.stat ? '<span class="b-wl-stat">' + esc(e.stat) + '</span>' : '') + '</div>' +
        (e.asked && e.asked.length ? '<p class="b-wl-asked">Asked for: ' + esc(e.asked.join(', ')) + '</p>' : '') +
        '<p>' + esc(e.reason) + '</p>' +
        '<p class="b-wl-why"><b>Why it works:</b> ' + esc(e.why) + '</p>' +
        (e.others ? '<p class="b-wl-others">' + esc(e.others) + '</p>' : '') +
      '</li>').join('');
    return '<section class="b-watchlog" aria-label="How Bobby built it">' +
      '<div class="b-h-title"><span>How Bobby built it · brief: ' + esc(B ? B.label : w.brief) + '</span>' +
        '<button type="button" class="b-link" data-act="wcopy">Copy as text</button></div>' +
      '<ol>' + rows + '</ol></section>';
  }

  function full() {
    const animate = S.anim !== lastAnim;
    let body = '';
    if (S.phase === 'start') body = openHtml(animate);
    else if (S.phase === 'round') body = roundHtml(animate);
    else if (S.phase === 'next') body = nextHtml(animate);
    else body = goldHtml(animate);
    root.innerHTML =
      '<div class="b2g' + (animate ? ' b-animate' : '') + (W ? ' b-watching' : '') + '">' +
        '<header class="b-top">' +
          '<div class="b-brand">' + Odd.brand.homeButton() + '<span>Bones to Gold</span></div>' +
          '<nav class="b-chips" aria-label="Your idea so far">' + chipsHtml() + '</nav>' +
          '<div class="b-top-r">' +
            (S.phase === 'start' ? '' : '<span class="b-meta">' + metaHtml(S.idea) + '</span>') +
            (F.canFinish(S) && !W ? '<button type="button" class="b-primary" data-act="finish">That’s the idea</button>' : '') +
            ((S.phase === 'round' || S.phase === 'next') && !W ? '<button type="button" class="b-ghost" data-act="restart" title="Back to Groove, Melody or Riff">New idea</button>' : '') +
            '<button type="button" class="b-ghost" data-act="studio" title="The song sheet, booth and shelf">Studio</button>' +
          '</div>' +
        '</header>' +
        '<main class="b-stage">' +
          '<section class="b-bobby">' + BOBBY_SVG + '<div class="b-bubble"><span class="b-who">Bobby Beatdown</span><span class="b-say" aria-live="polite"></span><div class="b-talk"></div></div></section>' +
          watchBar() +
          body +
          watchLog() +
          historyHtml() +
        '</main>' +
      '</div>';
    lastAnim = S.anim;
    lastHid = S.hid;
    talkKey = '';
    TU.key = '';
    EQ.colors = null;
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
    // what Bobby has to offer about the lifted card
    const t = talking() ? talk() : null;
    const tk = t ? [S.seq, S.sel, t.mode, t.topic, (t.why || []).join(), t.note, t.canChange, t.canCut, W ? 'w' : ''].join('|') : '';
    if (tk !== talkKey) {
      talkKey = tk;
      const el = root.querySelector('.b-talk');
      if (el) el.innerHTML = talkHtml();
    }
    // the dials on the lifted card, once Tweak opens them
    const open = tweakOpen();
    if (!open && TU.open && talking() && TU.slot !== slotKey()) TU.open = false; // another card lifted: the panel shuts
    root.querySelectorAll('.b-bx.tweak').forEach((el) => {
      const on = open && Number(el.dataset.i) === S.sel;
      el.classList.toggle('on', on);
      el.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    const tuk = open ? [S.seq, S.sel].join('|') : '';
    if (tuk !== TU.key) {
      TU.key = tuk;
      root.querySelectorAll('.b-tune').forEach((el) => { if (el.innerHTML) el.innerHTML = ''; });
      const el = tuk ? root.querySelector('.b-cards .b-card[data-i="' + S.sel + '"] .b-tune') : null;
      if (el) {
        el.innerHTML = tuneHtml();
        const f = TU.focus && el.querySelector('.b-fader[data-f="' + TU.focus + '"] .b-ftrack');
        if (f) f.focus({ preventScroll: true });
        TU.focus = '';
      }
    }
    // the ones passed on stay where they are, marked
    root.querySelectorAll('.b-cards .b-card[data-i]').forEach((el) => el.classList.toggle('b-nope', B.isOut(S, opts[Number(el.dataset.i)])));
    root.querySelectorAll('.b-eq').forEach((c) => { if (!c.closest('.is-playing') && c.dataset.on) { delete c.dataset.on; c.getContext('2d').clearRect(0, 0, c.width, c.height); } });
    const st = W ? W.steps[W.i] : null;
    root.querySelectorAll('.b-card[data-i]').forEach((el) => el.classList.toggle('b-chosen', !!st && st.kind === 'choose' && st.i === Number(el.dataset.i)));
    if (W) {
      const n = root.querySelector('.b-wb-step');
      if (n) n.textContent = 'Step ' + (W.i + 1) + ' of ' + W.steps.length;
      const pb = root.querySelector('[data-label="wpause"]');
      if (pb) pb.textContent = W.paused ? 'Play' : 'Pause';
      const bar = root.querySelector('.b-wb-bar i');
      if (bar) bar.style.width = (100 * (W.i + 1) / W.steps.length).toFixed(1) + '%';
    }
    root.querySelectorAll('[data-label="all"]').forEach((b) => { b.textContent = P.playing && P.src === 'all' ? 'Stop' : 'Play the idea so far'; });
    const cb = root.querySelector('[data-label="climb"] span');
    if (cb) cb.textContent = climbing ? 'Stop the climb' : 'Play the climb';
    const sb = root.querySelector('[data-label="save"]');
    if (sb) { sb.textContent = S.saved ? 'Saved to Ideas' : 'Save to Ideas'; sb.disabled = !!S.saved; }
  }

  function render() {
    if (!root || !shown) return;
    const key = [S.phase, S.seq, S.hid, S.anim, S.round ? S.round.dir : '', S.idea.order.join(','), W ? 'w' : '', S.watch ? S.watch.log.length + S.watch.brief : ''].join('|');
    if (key !== built) { built = key; full(); }
    patch();
  }

  // ---------------------------------------------------------------- the dev menu: what the cards show

  function loadDev() {
    try { const d = JSON.parse(window.localStorage.getItem(DEV_KEY) || 'null'); if (d && typeof d === 'object') return { open: !!d.open, hide: d.hide || {} }; } catch (e) { /* blocked: defaults */ }
    return { open: false, hide: {} };
  }
  function saveDev() { try { window.localStorage.setItem(DEV_KEY, JSON.stringify(dev)); } catch (e) { /* blocked: this visit only */ } }
  const blind = () => HIDES.every((h) => dev.hide[h[0]]);
  function applyDev() {
    if (!root) return;
    HIDES.forEach((h) => root.classList.toggle('hx-' + h[0], !!dev.hide[h[0]]));
    root.classList.toggle('hx-blind', blind());
    if (!devEl) return;
    devEl.classList.toggle('open', dev.open);
    const tab = devEl.querySelector('.b-dev-tab'), n = HIDES.filter((h) => dev.hide[h[0]]).length;
    tab.setAttribute('aria-expanded', String(dev.open));
    tab.textContent = 'Dev' + (blind() ? ' · blind' : n ? ' · ' + n + ' hidden' : '');
    devEl.querySelectorAll('input[data-show]').forEach((el) => { el.checked = !dev.hide[el.dataset.show]; });
    devEl.querySelector('input[data-blind]').checked = blind();
  }
  function mountDev() {
    devEl = document.createElement('aside');
    devEl.className = 'b-dev';
    devEl.hidden = true;
    devEl.setAttribute('aria-label', 'Dev: what the cards show');
    devEl.innerHTML = '<button type="button" class="b-dev-tab" aria-controls="b-dev-panel">Dev</button>' +
      '<div class="b-dev-panel" id="b-dev-panel">' +
        '<b>What the cards show</b>' +
        '<label class="b-dev-blind"><input type="checkbox" data-blind> Blind mode</label>' +
        HIDES.map((h, k) => (k === 6 ? '<span class="b-dev-sub">Also on cards</span>' : '') + '<label><input type="checkbox" data-show="' + h[0] + '" checked> ' + esc(h[1]) + '</label>').join('') +
        '<button type="button" class="b-dev-all">Show everything</button>' +
      '</div>';
    devEl.addEventListener('click', (e) => {
      if (e.target.closest('.b-dev-tab')) { dev.open = !dev.open; saveDev(); applyDev(); }
      if (e.target.closest('.b-dev-all')) { dev.hide = {}; saveDev(); applyDev(); }
    });
    devEl.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.blind != null) { dev.hide = {}; if (el.checked) HIDES.forEach((h) => { dev.hide[h[0]] = true; }); } else if (el.dataset.show) dev.hide[el.dataset.show] = !el.checked;
      saveDev();
      applyDev();
      EQ.colors = null;
    });
    document.body.appendChild(devEl);
  }

  // ---------------------------------------------------------------- outside

  function mount(el, h) {
    root = el;
    host = h || {};
    S = load();
    dev = loadDev();
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', dialDown);
    root.addEventListener('pointermove', dialMove);
    root.addEventListener('pointerup', dialUp);
    root.addEventListener('pointercancel', dialUp);
    root.addEventListener('keydown', dialKey);
    if (typeof document !== 'undefined' && document.body) mountDev();
    applyDev();
    if (Odd.transport && Odd.transport.on) {
      Odd.transport.on('end', () => { if (P.playing) { P.playing = false; P.climb = -1; P.passes = null; render(); } });
      Odd.transport.on('stall', () => { if (P.playing) { P.playing = false; P.climb = -1; render(); } });
    }
  }

  function show(on) {
    shown = !!on;
    if (devEl) devEl.hidden = !shown;
    if (!shown) {
      if (W && !W.paused) { W.paused = true; clearTimeout(W.timer); }
      halt();
      return;
    }
    built = '';
    render();
  }

  /** reopen a saved idea at its gold stage */
  function open(bones, ideaId) {
    if (W) { clearTimeout(W.timer); W = null; }
    halt();
    P.src = '';
    const ns = F.repair(Object.assign(F.fresh(), { phase: 'gold', idea: clone(bones), anim: (S ? S.anim : 0) + 1, saved: ideaId || null }));
    set(ns);
  }

  Odd.bones = {
    mount, show, open, onKey,
    get state() { return S; },
    get playing() { return P.playing; },
    get talk() { return talking() ? Object.assign({}, talk()) : null; },
    get dev() { return JSON.parse(JSON.stringify(dev)); },
    get watching() { return W ? { i: W.i, steps: W.steps.length, paused: W.paused, brief: W.brief, path: W.path, kind: W.steps[W.i].kind } : null; },
  };
})(globalThis.Odd = globalThis.Odd || {});
