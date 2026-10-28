/* Oddition — the Song Builder screen: grow ideas from the book into a song.
 *
 * Header: the transport, a timeline of the whole song with a playhead (click
 * to move it), play/stop from the playhead, back to the start, loop.
 * Top: Bobby, with what the selected section is (left) and his advice (right);
 * clicking him opens his services (Keywords, Bar Builder, Analysis). Then three
 * options for each part of the selected section: Build up, Substance, Finish.
 * Middle: the sections in song order (top to bottom on tall screens), the
 * selected one showing its layer stack. Below: Vibe, Idea, Vary a layer (every
 * named variation of one layer), Add a layer (three takes on chords, bass,
 * pads, percussion or a beat, made to fit the idea).
 *
 * Listening paces itself like Bones to Gold: from silence an option plays at
 * once; switching from one to another stops it and gives two seconds of quiet
 * while Bobby talks.
 *
 * Odd.song.mount(el, host) once; host = {
 *   ideas() -> the idea book, songs() -> saved songs, current() -> the open song or null,
 *   saveSong(song), deleteSong(id), env() -> { bpm, swing, patchFor },
 *   stopStudio(), toHome(), toStudio(), toBones(), toast(msg), download(name, bytes, mime) }
 * Odd.song.show(on) when the screen changes.
 */
(function (Odd) {
  'use strict';
  const SM = Odd.songmaker;
  const T = Odd.theory;

  const PAUSE_MS = 2000;
  const PAUSE = ['Just a moment.', 'Fresh ears. Okay.', 'Hang on.', 'Right. This one.', 'Let that settle. Okay.'];
  const START_LINE = 'Pick an idea from your book and we’ll grow it into a song. Tap one to hear it first.';
  const SERVICES = [
    { id: 'next', label: 'Audition the next open section', sub: 'I’ll go where the song is unfinished.' },
    { id: 'kw', label: 'Keywords', sub: 'Tell me what you like, in order.' },
    { id: 'bars', label: 'Bar Builder', sub: 'Pick bars; I’ll give them a twist.' },
    { id: 'an', label: 'Analysis', sub: 'A look at the song as it stands.' },
  ];
  const PANEL_TITLES = { kw: 'Keywords', bars: 'Bar Builder', an: 'Analysis' };
  const PANEL_LINES = {
    kw: 'Rank what you care about. The words at the top get the most say in what I offer.',
    bars: 'Pick the bars. I’ll give you three twists for them.',
    an: 'Here’s the song as it stands, and where I see room.',
  };
  const TABS = [
    { id: 'vibe', label: 'Vibe', sub: 'Tempo, key, energy, fullness' },
    { id: 'idea', label: 'Idea', sub: 'Main, guest, answer, motif' },
    { id: 'tweak', label: 'Vary a layer', sub: 'Outline, stretch, chop, shift' },
    { id: 'add', label: 'Add a layer', sub: 'Chords, bass, pads, a beat' },
  ];
  const ARROW = (d) => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="' + (d < 0 ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5') + '" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2v10l9-5z" fill="currentColor"/></svg>';
  const TO_START = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2.5" width="2" height="9" rx="0.6" fill="currentColor"/><path d="M12 2.5v9L5 7z" fill="currentColor"/></svg>';
  const PEN = '<svg class="sg-pen" width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M9.5 2.5l2 2L5 11l-2.6.6L3 9z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/></svg>';
  const STOP = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/></svg>';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r2 = (x) => Math.round(x * 100) / 100;

  let root = null, host = {}, shown = false;
  let song = null;   // the open song
  let C = null, Ckey = '';
  // all: a column shown in full ('build' | 'sub' | 'fin'); rename: 'song' or a section id being renamed;
  // ho: the option being heard (its key); chips: buttons under Bobby's line while it shows
  const S = { phase: 'start', main: '', guest: '', sel: '', layer: '', tool: '', panel: '', menu: false, batch: {}, bars: [], edit: false, msg: '', heard: '', centred: '', addRole: '', all: '', rename: '', renameFocus: false, ho: '', chips: [] };
  // head: the song's playhead in ticks (where Play starts); loop: the song plays round;
  // ab: while an option plays, 'opt' (the option) or 'now' (the section as it is, to compare)
  const P = { playing: false, key: '', pending: '', timer: 0, raf: 0, seq: null, pc: 0, head: 0, loop: false, tl: null, ab: 'opt', rise: null, sinks: [] };
  const SETTLE_MS = 350; // a card rising or sinking with no pause to fill
  let removed = null; // the last section removed: { songId, sec, at }, for Undo
  const OPTS = new Map();   // option key -> option, for the cards on screen
  const PREV = new Map();   // preview sequences
  const IDEA_C = new Map(); // idea id -> context, for the idea book

  // ---------------------------------------------------------------- helpers

  function env() { try { return (host.env && host.env()) || {}; } catch (e) { return {}; } }
  function ctx() {
    if (!song) return null;
    const k = song.id + '|' + song.main.id + '|' + song.main.voices.length + '|' + (song.lv || 0) + '|' + (song.guest ? song.guest.id : '');
    if (k !== Ckey) { C = SM.context(song, env()); Ckey = k; PREV.clear(); }
    return C;
  }
  function ideaCtx(idea) {
    const k = idea.id + '|' + (idea.created || '') + '|' + idea.voices.length;
    let c = IDEA_C.get(k);
    if (!c) { c = SM.context({ main: idea, guest: null }, env()); IDEA_C.set(k, c); }
    return c;
  }
  function ideas() { try { return (host.ideas && host.ideas()) || []; } catch (e) { return []; } }
  function sel() { return song ? SM.findSec(song, S.sel) || song.secs[0] : null; }
  function selIndex() { return song ? Math.max(0, song.secs.findIndex((s) => s.id === S.sel)) : 0; }

  function setSong(next, opts) {
    song = next;
    if (song) { song.updated = Date.now(); if (host.saveSong) host.saveSong(song); }
    // what's playing hears the change straight away
    if (!song || !P.playing || !Odd.transport) return;
    if (P.key === 'song') {
      const seq = SM.songSeq(ctx(), song, P.loop);
      if (seq) { P.seq = seq; Odd.transport.update(seq); } else stop();
    } else if (P.key === 'sec:' + S.sel) {
      const sec = sel();
      if (sec && sec.body) { P.seq = SM.sectionSeq(ctx(), song, sec); Odd.transport.update(P.seq); }
    }
  }

  // ---------------------------------------------------------------- sound

  function run(seq, key, startTick) {
    if (!Odd.transport || !seq) return;
    if (host.stopStudio) host.stopStudio();
    P.playing = true;
    P.key = key;
    P.seq = seq;
    P.ab = 'opt';
    Odd.transport.play(seq, { startTick: startTick || 0 }).catch((e) => {
      P.playing = false;
      if (host.toast) host.toast('Audio could not start: ' + (e && e.message ? e.message : e), { kind: 'warn' });
      render();
    });
    loop();
  }
  function halt() {
    clearTimeout(P.timer);
    P.timer = 0;
    P.pending = '';
    const was = P.playing;
    if (was && P.key === 'song' && Odd.transport) P.head = Odd.transport.position(); // Stop leaves the playhead where it is
    P.playing = false;
    P.key = '';
    P.ab = 'opt';
    if (was && Odd.transport) Odd.transport.stop();
  }
  function stop() { settle(P.pending || upKey(), ''); halt(); S.heard = ''; render(); }
  /** an audition: from silence at once; from another sound, two seconds of quiet first */
  function hear(key, make, line) {
    if (P.playing && P.key === key) { stop(); return; }
    if (P.pending === key) return; // already on its way up
    if (P.playing || P.pending) {
      // the pause is the handover: what was playing sinks while this one rises, over the whole wait
      settle(P.pending || upKey(), key, PAUSE_MS);
      halt();
      P.pending = key;
      S.heard = '';
      S.msg = PAUSE[P.pc++ % PAUSE.length];
      render();
      P.timer = setTimeout(() => { P.pending = ''; S.heard = key; S.msg = line; run(make(), key); render(); }, PAUSE_MS);
      return;
    }
    settle('', key);
    S.heard = key;
    S.msg = line;
    run(make(), key);
    render();
  }
  function play(key, make) {
    if (P.playing && P.key === key) { stop(); return; }
    settle(P.pending || upKey(), key);
    halt();
    S.heard = '';
    run(make(), key);
    render();
  }

  // ---------------------------------------------------------------- rise and sink

  /** the card that sits raised for what's playing now: an audition, or the section being heard */
  function upKey() { return S.heard || (P.playing && P.key.indexOf('sec:') === 0 ? P.key : ''); }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  /** how far up a card is right now, 0 to 1 */
  function height(key, now) {
    if (!key) return 0;
    const r = P.rise;
    if (r && r.key === key) return ease(clamp((now - r.t0) / r.dur, 0, 1));
    const s = P.sinks.find((x) => x.key === key);
    if (s) return s.from * (1 - ease(clamp((now - s.t0) / s.dur, 0, 1)));
    return key === upKey() ? 1 : 0;
  }
  /** start a handover: `down` sinks from wherever it is, `up` rises, both over `ms` */
  function settle(down, up, ms) {
    const now = performance.now(), dur = ms || SETTLE_MS;
    P.sinks = P.sinks.filter((x) => now - x.t0 < x.dur && x.key !== down && x.key !== up);
    if (down && down !== up) { const from = height(down, now); if (from > 0.01) P.sinks.push({ key: down, t0: now, dur, from: r2(from) }); }
    P.rise = up ? { key: up, t0: now, dur, from: height(up, now) } : null;
  }
  /**
   * The class and style that put a card at its height. Redraws replace the
   * cards, so a moving one carries how far along it is as a negative delay.
   */
  function lift(key, up) {
    const now = performance.now();
    const at = (m) => 'animation-duration:' + m.dur + 'ms;animation-delay:-' + Math.round(now - m.t0) + 'ms;--from:' + (m.from || 0) + ';';
    const r = P.rise;
    if (r && r.key === key && now - r.t0 < r.dur) return { cls: (up ? ' lifted' : '') + ' rise', style: at(r) };
    if (up) return { cls: ' lifted', style: '' };
    const s = P.sinks.find((x) => x.key === key && now - x.t0 < x.dur);
    if (s) return { cls: ' sink', style: at(s) };
    return { cls: '', style: '' };
  }

  /** playheads and the live section, without redrawing */
  function loop() {
    cancelAnimationFrame(P.raf);
    const tick = () => {
      if (!P.playing || !root || !shown) return;
      const seq = P.seq;
      const pos = Odd.transport.position();
      const frac = seq && seq.length ? pos / seq.length : 0;
      let liveId = '', secFrac = -1;
      if (seq && seq.markers) {
        const m = seq.markers.find((x) => pos >= x.start && pos < x.end);
        if (m && (P.key === 'song' || P.key.indexOf('sec:') === 0)) { liveId = m.id; secFrac = (pos - m.start) / Math.max(1, m.end - m.start); }
      }
      root.querySelectorAll('[data-ph]').forEach((el) => {
        const k = el.dataset.ph;
        let f = -1;
        if (k === P.key) f = frac;
        else if (k === 'row' && liveId && liveId === S.sel) f = secFrac;
        const ph = el.querySelector('.ph');
        if (!ph) return;
        ph.hidden = f < 0;
        if (f >= 0) ph.style.left = r2(clamp(f, 0, 1) * 100) + '%';
      });
      root.querySelectorAll('[data-sec]').forEach((el) => el.classList.toggle('live', el.dataset.sec === liveId));
      if (P.key === 'song') { P.head = pos; drawHead(); }
      P.raf = requestAnimationFrame(tick);
    };
    P.raf = requestAnimationFrame(tick);
  }

  /** the transport's playhead, time and section name, without redrawing */
  function drawHead() {
    const tl = P.tl;
    if (!tl || !root) return;
    const h = clamp(P.head, 0, tl.length);
    const ph = root.querySelector('.sg-tlhead');
    if (ph) ph.style.left = r2(h / tl.length * 100) + '%';
    const tm = root.querySelector('[data-time]');
    if (tm) tm.textContent = SM.mmss(secsAt(h));
    const nw = root.querySelector('[data-now]');
    const at = tl.secs.find((x) => h >= x.start && h < x.end) || tl.secs[tl.secs.length - 1];
    if (nw) nw.textContent = at ? (song.secs.findIndex((x) => x.id === at.id) + 1) + '. ' + at.name : '';
    const bar = root.querySelector('.sg-tl');
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(secsAt(h))));
  }
  function secsAt(ticks) { return ticks / T.PPQ * 60 / ((C && C.bpm) || 100); }

  // ---------------------------------------------------------------- options

  function previewOf(sec, o) {
    const k = o.key + '|' + sec.id + '|' + song.updated;
    let seq = PREV.get(k);
    if (!seq) {
      seq = o.group === 'layer' ? SM.layerPreview(ctx(), song, sec, o) : SM.previewSeq(ctx(), song, sec, o);
      if (PREV.size > 200) PREV.clear();
      PREV.set(k, seq);
    }
    return seq;
  }
  function nowOf(sec, o) {
    const k = 'now|' + o.key + '|' + sec.id + '|' + song.updated;
    if (!PREV.has(k)) {
      if (PREV.size > 200) PREV.clear();
      PREV.set(k, SM.nowSeq(ctx(), song, sec, o));
    }
    return PREV.get(k);
  }
  /** can this option be compared with the section as it is? */
  function comparable(sec, o) { return !SM.isCurrent(ctx(), song, sec, o) && !!nowOf(sec, o); }
  /**
   * Flip between an option and the section as it is, without the pause: the
   * same stretch either way, so it carries on from the same place (a way in
   * lines up on where the section lands).
   */
  function compare(o, w) {
    const sec = sel();
    if (!sec || P.pending) return;
    const key = 'o:' + o.key + ':' + sec.id;
    const seq = w === 'now' ? nowOf(sec, o) : previewOf(sec, o);
    if (!seq) return;
    let start = 0;
    if (P.playing && P.key === key && P.seq && Odd.transport) {
      const pos = Odd.transport.position(), was = P.seq.length;
      start = o.group === 'act' && o.act === 'build' ? seq.length - (was - pos) : pos;
      start = ((Math.round(start) % seq.length) + seq.length) % seq.length;
    }
    S.heard = key;
    S.ho = o.key;
    run(seq, key, start);
    P.ab = w === 'now' ? 'now' : 'opt';
    S.msg = P.ab === 'now' ? 'As it is now. Flip back to hear ' + o.label.toLowerCase() + ' again.' : o.label + ', back in.';
    render();
  }

  function listenOpt(o) {
    const sec = sel();
    if (!sec) return;
    const key = 'o:' + o.key + ':' + sec.id;
    const tail = o.group === 'layer' ? ' Heard in ' + (sec.body ? sec.name : 'your first section') + ' with every layer in.' : o.group === 'act' && o.act === 'build' ? ' Then it lands in the section.' : o.group === 'act' && o.act === 'fin' ? (SM.nextOf(song, sec) ? ' Then the next section comes in.' : ' That’s the end of the song.') : '';
    if (!previewOf(sec, o)) { S.msg = 'Fill a section first, then I can play that.'; render(); return; }
    S.ho = o.key;
    hear(key, () => previewOf(sec, o), o.label + ': ' + o.sub + tail);
  }
  function useOpt(o) {
    const sec = sel();
    if (o.group === 'layer') { useLayer(o); return; }
    if (!sec || !sec.open) return;
    const wasEmpty = !sec.body;
    halt();
    S.heard = '';
    setSong(SM.patchSec(song, sec.id, o.make(sec)));
    S.msg = o.group === 'act' && o.act === 'sub' ? (wasEmpty ? 'In. It’s still open, so keep pushing it around. Close it when you love it.' : 'Swapped. The old version is one Undo away.')
      : o.group === 'act' ? (o.act === 'build' ? 'That’s its way in now.' : 'That’s its way out now.') : o.group === 'twist' ? 'Twisted. You’ll see it marked on the bar.' : 'Done. Still open.';
    render();
  }
  /** a new layer into the song: on in every open section, off in closed ones */
  function useLayer(o) {
    halt();
    S.heard = '';
    const next = SM.addLayer(song, o);
    if (next === song) { S.msg = 'That one wouldn’t fit. Try another.'; render(); return; }
    setSong(next);
    const a = SM.ADD_BY[o.role], closed = song.secs.filter((x) => x.body && !x.open).length;
    S.layer = 'v' + (song.main.voices.length - 1);
    S.addRole = '';
    S.msg = a.label + ' is in: ' + o.label.toLowerCase() + '. It plays in every open section' + (closed ? '; closed ones stay as they were' : '') + '. Turn it off section by section in the stack, or vary it here.';
    S.tool = 'tweak';
    render();
  }
  function mutate(fn, line) {
    const sec = sel();
    if (!sec || !sec.body || !sec.open) return;
    const body = JSON.parse(JSON.stringify(sec.body));
    fn(body);
    setSong(SM.patchSec(song, sec.id, { body }), { live: true });
    if (line) S.msg = line;
    render();
  }

  // ---------------------------------------------------------------- by hand

  /** a dial: one step (d) or a typed value (v); heard straight away if the section or song plays */
  function dial(id, d, v) {
    const sec = sel(), D = SM.DIAL_BY[id];
    if (!sec || !sec.body || !sec.open || !D) return;
    const next = v != null ? SM.setDial(song, sec.id, id, v) : SM.stepDial(song, sec.id, id, d);
    if (next === song) { render(); return; }
    setSong(next);
    const b = sel().body, live = P.playing && (P.key === 'song' || P.key === 'sec:' + sec.id);
    S.msg = D.label + ': ' + D.text(ctx(), b) + '.' + (live ? '' : ' Hear section to try it.');
    S.chips = [];
    render();
  }
  function startRename(id) {
    S.rename = id;
    S.renameFocus = true;
    render();
  }
  function commitRename(value) {
    const id = S.rename;
    if (!id || !song) return;
    S.rename = '';
    const next = id === 'song' ? SM.renameSong(song, value) : SM.renameSec(song, id, value);
    if (next !== song) {
      setSong(next);
      S.msg = id === 'song' ? 'The song is called ' + song.name + ' now.' : 'Section ' + (song.secs.findIndex((x) => x.id === id) + 1) + ' is ' + SM.findSec(song, id).name + ' now. I’ll keep that name whatever goes in it.';
    }
    render();
  }
  function move(d) {
    const sec = sel();
    if (!sec) return;
    const next = SM.moveSec(song, sec.id, d);
    if (next === song) return;
    setSong(next);
    S.centred = '';
    S.msg = sec.name + ' moved ' + (d < 0 ? 'earlier' : 'later') + '. It’s section ' + (song.secs.findIndex((x) => x.id === sec.id) + 1) + ' now; ways in and out that lean on a neighbour follow along.';
    S.chips = [];
    render();
  }
  function removeSel() {
    const r = SM.removeSec(song, S.sel);
    if (!r.removed) return;
    const gone = r.removed.sec;
    if (P.playing && P.key !== 'song') halt();
    setSong(r.song);
    Object.assign(S, { sel: r.id, heard: '', bars: [], edit: false, rename: '' });
    if (!gone.body) { S.msg = ''; S.chips = []; render(); return; }
    removed = { songId: song.id, sec: gone, at: r.removed.at };
    S.msg = gone.name + ' is out of the song.';
    S.chips = [{ label: 'Put it back', go: { restore: true } }];
    S.chipMsg = S.msg;
    if (host.toast) host.toast(gone.name + ' removed', { action: { label: 'Undo', run: restoreRemoved }, duration: 6000 });
    render();
  }
  function restoreRemoved() {
    if (!removed || !song || song.id !== removed.songId) return;
    const at = removed.at;
    setSong(SM.insertSec(song, removed.sec, at));
    removed = null;
    const back = song.secs[Math.min(at, song.secs.length - 1)];
    if (P.playing && P.key !== 'song') halt();
    Object.assign(S, { sel: back.id, heard: '', bars: [], edit: false, msg: back.name + ' is back where it was.', chips: [] });
    render();
  }

  // ---------------------------------------------------------------- actions

  function select(id) {
    if (S.sel === id) return;
    if (P.playing && P.key !== 'song') halt();
    clearTimeout(P.timer);
    P.pending = '';
    Object.assign(S, { sel: id, heard: '', bars: [], msg: '', edit: false, menu: false });
    render();
  }
  function addAt(i) {
    const r = SM.addSec(song, i);
    setSong(r.song);
    if (P.playing && P.key !== 'song') halt();
    Object.assign(S, { sel: r.id, heard: '', bars: [], edit: false, msg: 'A fresh open section. Here’s what could go there.' });
    render();
  }
  function toggleLock() {
    const sec = sel();
    if (!sec) return;
    const closing = sec.open;
    setSong(SM.setOpen(song, sec.id, !sec.open));
    if (P.playing && P.key.indexOf('o:') === 0) halt();
    S.heard = '';
    S.edit = false;
    S.msg = SM.allClosed(song) ? 'Every section is closed. That’s a song. Export it, or reopen anything to keep going.' : closing ? 'Closed. That one’s yours now; I’ll keep my hands off it.' : 'Open again. I’m back on it.';
    render();
  }
  function service(id) {
    S.menu = false;
    if (S.phase !== 'song' && id !== 'kw') { S.msg = 'Pick an idea first. Then I’ve got plenty for you.'; render(); return; }
    if (id === 'next') { nextOpen(); return; }
    S.panel = id;
    S.msg = PANEL_LINES[id];
    if (id === 'bars' && !S.bars.length) S.bars = [];
    render();
  }
  function nextOpen() {
    const i = selIndex();
    const order = song.secs.slice(i + 1).concat(song.secs.slice(0, i + 1));
    const target = order.find((s) => s.open && !s.body) || order.find((s) => s.open);
    if (!target) { S.msg = 'Nothing’s open. Reopen a section and I’ll get to work.'; render(); return; }
    if (P.playing && P.key !== 'song') halt();
    Object.assign(S, { sel: target.id, panel: '', heard: '', bars: [], edit: false, msg: 'Section ' + (song.secs.indexOf(target) + 1) + ' is open. Here’s what I’d try.' });
    render();
    const p = SM.bobbyPick(ctx(), song, target, S.batch);
    if (p) listenOpt(p);
  }
  function startSong(role) {
    const book = ideas();
    const main = book.find((x) => x.id === S.main);
    if (!main) return;
    const guest = S.guest ? book.find((x) => x.id === S.guest) || null : null;
    halt();
    const s = SM.create(main, guest, role, env());
    setSong(s);
    P.head = 0;
    Object.assign(S, { phase: 'song', sel: s.secs[1].id, heard: '', tool: '', panel: '', edit: false, batch: {}, bars: [], layer: '' });
    S.msg = 'There’s your ' + SM.ROLES[role].label.toLowerCase() + '. Up top: ways into it, what it could be, and a few bars after it before the next section. Add sections around it with the + buttons.';
    render();
  }
  function openSong(id) {
    const list = (host.songs && host.songs()) || [];
    const s = list.find((x) => x.id === id);
    if (!s) return;
    halt();
    song = s;
    P.head = 0;
    const first = s.secs.find((x) => x.open) || s.secs[0];
    Object.assign(S, { phase: 'song', sel: first.id, heard: '', tool: '', panel: '', edit: false, batch: {}, bars: [], layer: '', msg: 'Back on ' + s.name + '. ' + (SM.allClosed(s) ? 'Every section is closed.' : 'Picking up where we left off.') });
    if (host.saveSong) host.saveSong(song);
    render();
  }
  function newSong() {
    halt();
    song = null;
    if (host.saveSong) host.saveSong(null);
    Object.assign(S, { phase: 'start', main: '', guest: '', sel: '', heard: '', panel: '', tool: '', menu: false, msg: '' });
    render();
  }
  function exportMidi() {
    if (!song) return;
    const bytes = SM.midi(ctx(), song);
    if (!bytes) { S.msg = 'Nothing to export yet. Fill a section first.'; render(); return; }
    const name = (Odd.exporter ? Odd.exporter.safeName(song.name) : song.name) + '.mid';
    if (host.download) host.download(name, bytes, 'audio/midi');
  }
  /** Play and Stop: from the playhead, and Stop leaves it there */
  function playSong() {
    if (P.playing && P.key === 'song') { stop(); return; }
    const seq = SM.songSeq(ctx(), song, P.loop);
    if (!seq) { S.msg = 'Nothing to play yet. Fill a section first.'; render(); return; }
    halt();
    S.heard = '';
    if (P.head >= seq.length - 1) P.head = 0;
    run(seq, 'song', P.head);
    render();
  }
  /** move the playhead; a playing song carries on from there */
  function seekTo(ticks) {
    const tl = P.tl || SM.timeline(ctx(), song);
    P.head = clamp(Math.round(ticks), 0, Math.max(0, tl.length - 1));
    if (P.playing && P.key === 'song') { const seq = SM.songSeq(ctx(), song, P.loop); if (seq) run(seq, 'song', P.head); }
    drawHead();
  }
  function scrollToTools() {
    const el = root && root.querySelector('.sg-tools');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function editCell(deg, step) {
    const sec = sel();
    if (!sec || !sec.body || !sec.open) return;
    const c = ctx();
    const mat = SM.material(c, sec.body);
    if (!mat) return;
    const len = mat.bars * T.BAR, t = step * T.STEP;
    let notes = mat.notes.map((n) => Object.assign({}, n));
    const hit = notes.findIndex((n) => n.deg === deg && n.t <= t && t < n.t + n.d);
    if (hit >= 0) notes.splice(hit, 1);
    else {
      notes = notes.filter((n) => n.t !== t);
      notes.forEach((n) => { if (n.t < t && n.t + n.d > t) n.d = t - n.t; });
      const next = notes.filter((n) => n.t > t).map((n) => n.t).sort((a, b) => a - b)[0];
      const d = Math.max(T.STEP, Math.min(2 * T.STEP, next == null ? 2 * T.STEP : next - t, len - t));
      notes.push({ t, d: d - 10, deg, acc: 0, v: 96 });
      notes.sort((a, b) => a.t - b.t);
    }
    mutate((b) => { b.src = 'edit'; b.edit = notes; });
  }

  const ACTS = {
    menu: () => { S.menu = !S.menu; render(); },
    service: (el) => service(el.dataset.id),
    chip: (el) => goTo(JSON.parse(el.dataset.go || '{}')),
    'close-panel': () => { S.panel = ''; S.msg = ''; S.heard = ''; render(); },
    listen: (el) => { const o = OPTS.get(el.dataset.o); if (o) listenOpt(o); },
    use: (el) => { const o = OPTS.get(el.dataset.o); if (o) useOpt(o); },
    more: (el) => { S.batch[el.dataset.g] = (S.batch[el.dataset.g] || 0) + 1; S.msg = 'Three more. The others come back if you go round again.'; render(); },
    reopen: () => toggleLock(),
    lock: () => toggleLock(),
    select: (el) => select(el.dataset.id),
    'add-at': (el) => addAt(Number(el.dataset.i)),
    dup: () => { const r = SM.dupSec(song, S.sel); setSong(r.song); if (P.playing && P.key !== 'song') halt(); Object.assign(S, { sel: r.id, heard: '', msg: 'A copy, right after it, and open. Change it or leave it as a repeat.' }); render(); },
    remove: () => removeSel(),
    move: (el) => move(Number(el.dataset.d)),
    rename: (el) => startRename(el.dataset.id),
    dial: (el) => dial(el.dataset.dial, Number(el.dataset.d)),
    ab: (el) => { const o = OPTS.get(el.dataset.o); if (o) compare(o, el.dataset.w); },
    'see-all': (el) => {
      const a = el.dataset.g;
      S.all = S.all === a ? '' : a;
      S.msg = S.all ? { build: 'Every way in I know, best fit first. Tap one to hear it.', sub: 'Everything this section could be, best fit first.', fin: 'Every way out I know, best fit first. Tap one to hear it into the next section.' }[a] : '';
      S.chips = [];
      render();
      const el2 = S.all && root.querySelector('.sg-all');
      if (el2 && el2.scrollIntoView) el2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    'clear-twists': () => {
      const sec = sel();
      const next = sec ? SM.clearTwists(song, sec.id, S.bars) : song;
      if (next === song) return;
      if (P.playing && P.key.indexOf('o:') === 0) halt();
      setSong(next);
      S.heard = '';
      S.msg = 'Twist off. The bar plays as written again.';
      render();
    },
    undo: () => { if (P.playing && P.key.indexOf('o:') === 0) halt(); setSong(SM.undoSec(song, S.sel), { live: true }); S.heard = ''; S.msg = 'Back one step.'; render(); },
    'play-sel': () => { const sec = sel(); if (sec && sec.body) play('sec:' + sec.id, () => SM.sectionSeq(ctx(), song, sec)); },
    'play-song': () => playSong(),
    'tp-start': () => seekTo(0),
    'tp-loop': () => {
      P.loop = !P.loop;
      if (P.playing && P.key === 'song') { const seq = SM.songSeq(ctx(), song, P.loop); if (seq) { P.seq = seq; Odd.transport.update(seq); } }
      render();
    },
    seek: (el, e) => {
      const tl = P.tl;
      if (!tl || !e || e.clientX == null) return;
      const rect = el.getBoundingClientRect();
      const t = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * tl.length;
      seekTo(t);
      const at = tl.secs.find((x) => t >= x.start && t < x.end);
      if (at && at.id !== S.sel) select(at.id);
    },
    step: (el) => { setSong(SM.stepPart(song, S.sel, el.dataset.f, Number(el.dataset.d)), { live: true }); render(); },
    layer: (el) => { S.layer = el.dataset.k; S.tool = 'tweak'; S.edit = false; S.msg = rowLabel(el.dataset.k) + ' picked. Every way to vary it is below.'; render(); },
    'layer-on': (el) => { const k = el.dataset.k; mutate((b) => { b.lay[k].on = !b.lay[k].on; }, rowLabel(k) + (sel().body.lay[k].on ? ' out.' : ' back in.')); },
    vary: (el) => {
      const k = el.dataset.k;
      Object.assign(S, { layer: k, tool: 'tweak', edit: false, heard: '' });
      S.msg = 'Everything I can do with the ' + rowLabel(k).toLowerCase() + ', by name. Tap one to hear it in this section; Use this keeps it.';
      render();
      scrollToTools();
    },
    'add-layer': () => { Object.assign(S, { tool: 'add', heard: '', edit: false }); S.msg = 'What should come in? Pick a layer and I’ll make three that fit your idea.'; render(); scrollToTools(); },
    'add-role': (el) => {
      const a = SM.ADD_BY[el.dataset.role];
      S.addRole = S.addRole === el.dataset.role ? '' : el.dataset.role;
      S.heard = '';
      S.msg = S.addRole && a ? 'Three takes on ' + a.label.toLowerCase() + ', made against your melody. Tap one to hear it with the section.' : '';
      render();
    },
    'drop-layer': (el) => {
      const k = el.dataset.k, label = rowLabel(k);
      if (P.playing && P.key.indexOf('o:') === 0) halt();
      setSong(SM.removeLayer(song, k));
      S.layer = '';
      S.heard = '';
      S.msg = label + ' is out of the song. Changed your mind? It’s waiting under Add a layer.';
      render();
    },
    'restore-layer': (el) => {
      if (P.playing && P.key.indexOf('o:') === 0) halt();
      setSong(SM.restoreLayer(song, el.dataset.k));
      S.layer = el.dataset.k;
      S.heard = '';
      S.msg = rowLabel(el.dataset.k) + ' is back, the way it was.';
      render();
    },
    tab: (el) => { S.tool = S.tool === el.dataset.id ? '' : el.dataset.id; S.heard = ''; S.edit = false; render(); },
    'edit-toggle': () => { S.edit = !S.edit; S.msg = S.edit ? 'All yours. Change any note; I won’t touch them unless you ask.' : ''; render(); },
    cell: (el) => editCell(Number(el.dataset.deg), Number(el.dataset.s)),
    'kw-move': (el) => {
      const kw = song.kw.slice(), i = kw.findIndex((k) => k.id === el.dataset.id), j = i + Number(el.dataset.d);
      if (j < 0 || j >= kw.length) return;
      const t = kw[i]; kw[i] = kw[j]; kw[j] = t;
      setSong(Object.assign({}, song, { kw }));
      S.batch = {};
      render();
    },
    lean: (el) => {
      const id = el.dataset.id, v = Number(el.dataset.v), k = SM.KWD[id];
      setSong(Object.assign({}, song, { kw: song.kw.map((x) => (x.id === id ? Object.assign({}, x, { lean: v }) : x)) }));
      S.batch = {};
      const word = v > 0 ? k.hi : v < 0 ? k.lo : '';
      S.msg = word ? (Math.abs(v) > 1 ? 'Very ' : 'A bit ') + word.toLowerCase() + '. My options just moved to match.' : 'No preference on ' + k.lo.toLowerCase() + ' or ' + k.hi.toLowerCase() + '.';
      render();
    },
    bar: (el) => {
      const b = Number(el.dataset.b), n = sel().body.bars, cur = S.bars.filter((x) => x < n);
      S.bars = cur.includes(b) ? cur.filter((x) => x !== b) : cur.concat([b]);
      S.heard = '';
      render();
    },
    'bar-all': () => {
      const n = sel().body.bars, whole = S.bars.filter((x) => x < n).length === n;
      S.bars = whole ? [] : Array.from({ length: n }, (_, i) => i);
      S.heard = '';
      render();
    },
    chart: (el) => select(el.dataset.id),
    // the idea book
    'idea-hear': (el) => {
      const idea = ideas().find((x) => x.id === el.dataset.id);
      if (!idea) return;
      hear('i:' + idea.id, () => SM.ideaSeq(ideaCtx(idea)), idea.name + ': ' + voicesText(idea) + '.');
    },
    'as-main': (el) => {
      const id = el.dataset.id, idea = ideas().find((x) => x.id === id);
      S.main = id;
      if (S.guest === id) S.guest = '';
      S.msg = (idea ? idea.name : 'That one') + '. Good bones. What is it in the song: the verse, the chorus, or the hook?';
      render();
    },
    'as-guest': (el) => {
      const id = el.dataset.id, idea = ideas().find((x) => x.id === id);
      if (S.main === id) return;
      const off = S.guest === id;
      S.guest = off ? '' : id;
      S.msg = off ? 'No guest. Just the one idea.' : (idea ? idea.name : 'That one') + ' comes along as a guest. I’ll move it into your key and weave it in.';
      render();
    },
    role: (el) => startSong(el.dataset.role),
    'open-song': (el) => openSong(el.dataset.id),
    'new-song': () => newSong(),
    export: () => exportMidi(),
    home: () => { halt(); if (host.toHome) host.toHome(); },
    studio: () => { halt(); if (host.toStudio) host.toStudio(); },
    bones: () => { halt(); if (host.toBones) host.toBones(); },
  };

  function goTo(go) {
    if (go.restore) { restoreRemoved(); return; }
    if (go.add) { addAt(selIndex() + 1); return; }
    if (go.export) { exportMidi(); return; }
    if (go.sel) { if (S.sel !== go.sel) select(go.sel); }
    if (go.tool) S.tool = go.tool;
    if (go.panel) { S.panel = go.panel; S.msg = PANEL_LINES[go.panel]; }
    if (go.bars) S.bars = go.bars;
    render();
  }

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    const fn = ACTS[el.dataset.act];
    if (fn) fn(el, e);
  }

  /** Space plays or stops the song from the playhead (anything else playing just stops),
   * arrows on the timeline move the playhead a bar, Escape stops and closes the menu. true when handled */
  function onKey(e) {
    if (e.key === 'Escape') {
      if (S.menu) { S.menu = false; render(); return true; }
      if (P.playing || P.pending) { stop(); return true; }
      return false;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home') && e.target && e.target.classList && e.target.classList.contains('sg-tl')) {
      e.preventDefault();
      seekTo(e.key === 'Home' ? 0 : P.head + (e.key === 'ArrowLeft' ? -1 : 1) * T.BAR);
      return true;
    }
    // C flips between the option being heard and the section as it is
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const o = S.ho && OPTS.get(S.ho), sec = sel();
      if (!o || !sec || !P.playing || P.key !== 'o:' + o.key + ':' + sec.id || !comparable(sec, o)) return false;
      compare(o, P.ab === 'now' ? 'opt' : 'now');
      return true;
    }
    // Space belongs to the transport, except on another control (a card, a chip) where it presses that
    const t = e.target && e.target.closest ? e.target : null;
    if (e.key === ' ' && !(t && t.closest('button, input, select, textarea') && !t.closest('.sg-tp'))) {
      e.preventDefault();
      if (S.phase !== 'song' || !song) { if (P.playing || P.pending) stop(); return true; }
      if ((P.playing && P.key !== 'song') || P.pending) stop();
      else playSong();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- drawing

  function rowLabel(k) { const r = SM.rowsOf(ctx()).find((x) => x.key === k); return r ? r.label : k; }
  function voicesText(idea) {
    const c = ideaCtx(idea);
    const names = c.layers.map((l) => l.label.toLowerCase());
    return names.length ? names[0].charAt(0).toUpperCase() + names.join(', ').slice(1) : 'Empty';
  }
  function miniHtml(m, phKey) {
    return '<span class="sg-mini"' + (phKey ? ' data-ph="' + esc(phKey) + '"' : '') + ' style="height:' + m.h + 'px">' +
      m.cells.map((c) => '<i style="left:' + c.x + '%;top:' + c.y + 'px;width:' + c.w + '%;background:' + c.c + '"></i>').join('') +
      (phKey ? '<i class="ph" hidden></i>' : '') + '</span>';
  }

  function card(sec, o, opts) {
    OPTS.set(o.key, o);
    const seq = previewOf(sec, o);
    const m = seq ? SM.mini(ctx(), seq.events, seq.length, seq.rows) : { cells: [], h: 10 };
    const key = 'o:' + o.key + ':' + sec.id;
    let stat;
    if (o.group === 'layer') stat = o.stat;
    else if (o.group === 'act' && o.act !== 'sub') stat = o.bars ? o.bars + (o.bars === 1 ? ' bar' : ' bars') : 'No extra bars';
    else { const b = o.make(sec).body; stat = b.bars + ' bars · ' + b.bpm + ' BPM' + (b.shift ? ' · ' + SM.keyName(ctx(), b).split(' ')[0] : ''); }
    const lifted = S.heard === key && (sec.open || o.group === 'layer');
    const cur = SM.isCurrent(ctx(), song, sec, o);
    const ab = lifted && P.playing && P.key === key && !cur && comparable(sec, o);
    const badges = (opts.pick ? '<span class="sg-pickb">Bobby’s pick</span>' : '') + (cur ? '<span class="sg-nowb">In now</span>' : '');
    const lf = lift(key, S.heard === key);
    return '<div class="sg-oc' + (opts.big ? ' big' : '') + (opts.pick ? ' pick' : '') + (cur ? ' cur' : '') + lf.cls + (P.pending === key ? ' wait' : '') + '"' + (lf.style ? ' style="' + lf.style + '"' : '') + '>' +
      '<button type="button" class="sg-hit" data-act="listen" data-o="' + esc(o.key) + '" aria-label="Hear ' + esc(o.label) + (cur ? ', in now' : '') + '" aria-pressed="' + (P.playing && P.key === key) + '"></button>' +
      (badges ? '<span class="sg-badges">' + badges + '</span>' : '') +
      '<b class="sg-oname">' + esc(o.label) + '</b>' +
      miniHtml(m, key) +
      '<span class="sg-ostat">' + esc(stat) + '</span>' +
      (opts.sub ? '<span class="sg-osub">' + esc(o.sub) + '</span>' : '') +
      '<span class="sg-otags">' + esc(SM.tagsOf(song.kw, o.t || {})) + '</span>' +
      (ab ? '<span class="sg-ab" role="group" aria-label="Compare (C)">' +
        '<button type="button" data-act="ab" data-o="' + esc(o.key) + '" data-w="opt" aria-pressed="' + (P.ab !== 'now') + '" title="Hear this option (C flips)">This</button>' +
        '<button type="button" data-act="ab" data-o="' + esc(o.key) + '" data-w="now" aria-pressed="' + (P.ab === 'now') + '" title="Hear the section as it is now (C flips)">Now</button></span>' : '') +
      (lifted && !cur ? '<button type="button" class="b-primary sg-use" data-act="use" data-o="' + esc(o.key) + '">' + esc(opts.useLabel || 'Use this') + '</button>' : '') +
    '</div>';
  }

  /** one column in full: every option by name, Bobby's pick first, the one in now marked */
  function allHtml(sec) {
    const a = SM.ACT[S.all];
    if (!a || !sec.open) return '';
    const opts = SM.actOptions(ctx(), song, sec, a.id, 'all');
    if (!opts.length) return '';
    const title = { build: 'Every way in', sub: 'Everything it could be', fin: 'Every way out' }[a.id];
    return '<section class="sg-all" aria-label="' + title + '"><div class="sg-panelh"><i class="sg-dotc" style="background:' + a.color + '"></i><h2>' + title + '</h2>' +
      '<span class="sg-pnote">' + opts.length + ' options, best fit first. Tap to hear; switch with This and Now while one plays.</span>' +
      '<button type="button" class="b-ghost sg-sm" data-act="see-all" data-g="' + a.id + '">Close</button></div>' +
      '<div class="sg-tcards all">' + opts.map((o, k) => card(sec, o, { big: true, sub: true, pick: k === 0, useLabel: a.id === 'sub' ? (sec.body ? 'Swap it in' : 'Put it here') : 'Use this' })).join('') + '</div></section>';
  }

  function bobbyRow(left, leftWho, right, chips) {
    return '<section class="sg-bobby">' +
      '<div class="sg-bub left"><span class="b-who">' + esc(leftWho) + '</span><span>' + esc(left) + '</span></div>' +
      '<div class="sg-bob">' +
        '<button type="button" class="sg-bob-btn' + (S.menu ? ' open' : '') + '" data-act="menu" aria-expanded="' + S.menu + '" aria-haspopup="menu" aria-label="Bobby’s services">' + Odd.brand.BOBBY + '<span>Services</span></button>' +
        (S.menu ? '<div class="sg-menu" role="menu" aria-label="Bobby’s services">' + SERVICES.map((s) => '<button type="button" class="sg-svc" role="menuitem" data-act="service" data-id="' + s.id + '"><b>' + esc(s.label) + '</b><span>' + esc(s.sub) + '</span></button>').join('') + '</div>' : '') +
      '</div>' +
      '<div class="sg-bub right"><span class="b-who">Bobby Beatdown</span><span class="sg-say" aria-live="polite">' + esc(right) + '</span>' +
        (chips.length ? '<div class="sg-chips">' + chips.map((c) => '<button type="button" class="b-req" data-act="chip" data-go="' + esc(JSON.stringify(c.go)) + '">' + esc(c.label) + '</button>').join('') + '</div>' : '') +
      '</div>' +
    '</section>';
  }

  function startHtml() {
    const book = ideas();
    const saved = ((host.songs && host.songs()) || []).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 6);
    let h = '';
    if (saved.length) {
      h += '<h2 class="sg-h">Pick up a song</h2><div class="sg-songs">' + saved.map((s) => {
        const closed = s.secs.filter((x) => !x.open).length;
        return '<button type="button" class="sg-song" data-act="open-song" data-id="' + esc(s.id) + '"><b>' + esc(s.name) + '</b><span>' + s.secs.length + ' sections, ' + closed + ' closed</span></button>';
      }).join('') + '</div>';
    }
    h += '<h2 class="sg-h">Your idea book</h2>';
    if (!book.length) {
      h += '<div class="sg-emptybook"><p>Your idea book is empty. Make an idea first, then come back and grow it.</p><button type="button" class="b-primary" data-act="bones">Make an idea</button></div>';
      return h;
    }
    h += '<div class="sg-ideas">' + book.map((idea) => {
      const c = ideaCtx(idea), key = 'i:' + idea.id;
      const seq = SM.ideaSeq(c), m = SM.mini(c, seq.events, seq.length);
      const isMain = S.main === idea.id, isGuest = S.guest === idea.id;
      const stat = (c.genre ? c.genre + ' · ' : '') + c.bpm + ' BPM · ' + idea.bars + (idea.bars === 1 ? ' bar' : ' bars');
      const lf = lift(key, S.heard === key);
      return '<div class="sg-ic' + (isMain ? ' main' : isGuest ? ' guest' : '') + lf.cls + (P.pending === key ? ' wait' : '') + '"' + (lf.style ? ' style="' + lf.style + '"' : '') + '>' +
        '<button type="button" class="sg-hit" data-act="idea-hear" data-id="' + esc(idea.id) + '" aria-label="Hear ' + esc(idea.name) + '"></button>' +
        '<div class="sg-ich"><b>' + esc(idea.name) + '</b><span>' + esc(stat) + '</span></div>' +
        '<span class="sg-mood">' + esc(voicesText(idea)) + '</span>' +
        miniHtml(m, key) +
        '<div class="sg-iacts">' +
          '<button type="button" class="sg-ib' + (isMain ? ' on' : '') + '" data-act="as-main" data-id="' + esc(idea.id) + '" aria-pressed="' + isMain + '">' + (isMain ? 'Main idea' : 'Use as main') + '</button>' +
          '<button type="button" class="sg-ib' + (isGuest ? ' on2' : '') + '" data-act="as-guest" data-id="' + esc(idea.id) + '" aria-pressed="' + isGuest + '"' + (isMain ? ' disabled' : '') + '>' + (isGuest ? 'Guest idea' : 'Add as guest') + '</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
    const main = book.find((x) => x.id === S.main);
    if (main) {
      h += '<h2 class="sg-h">What is ' + esc(main.name) + ' in the song?</h2><div class="sg-roles">' +
        SM.ROLE_ORDER.map((r) => '<button type="button" class="sg-role" data-act="role" data-role="' + r + '"><b>' + esc(SM.ROLES[r].label) + '</b><span>' + esc(SM.ROLES[r].sub) + '</span></button>').join('') + '</div>';
    }
    return h;
  }

  function smallCard(s, i) {
    const c = ctx();
    const base = 'data-act="select" data-id="' + esc(s.id) + '" data-sec="' + esc(s.id) + '"';
    if (!s.body) {
      return '<button type="button" class="sg-sc empty" ' + base + ' aria-label="Section ' + (i + 1) + ', ' + (s.named ? esc(s.name) + ', ' : '') + 'empty">' +
        '<span class="sg-sct"><i style="background:var(--line)"></i><b>' + (i + 1) + '. ' + esc(s.named ? s.name : 'Open') + '</b><span class="sg-lockt">Open</span></span>' +
        '<span class="sg-scs">Empty</span><span class="sg-mini" style="height:44px"></span><span class="sg-scw">Tap to fill it</span></button>';
    }
    const r = SM.renderSection(c, s, SM.nextOf(song, s));
    const m = SM.mini(c, r.events, r.length);
    // taller than the option cards' minis: rows 14px apart
    const tall = { h: Math.max(44, Math.round((m.h - 6) * 2 + 8)), cells: m.cells.map((x) => Object.assign({}, x, { y: (x.y - 3) * 2 + 4 })) };
    const way = (p, field, none) => (p ? SM.PART_BY[field][p.k].label : none);
    return '<button type="button" class="sg-sc' + (s.open ? '' : ' closed') + '" ' + base + ' aria-label="Section ' + (i + 1) + ', ' + esc(s.name) + (s.open ? ', open' : ', closed') + '">' +
      '<span class="sg-sct"><i style="background:var(--b-gold)"></i><b>' + (i + 1) + '. ' + esc(s.name) + '</b><span class="sg-lockt">' + (s.open ? 'Open' : 'Closed') + '</span></span>' +
      '<span class="sg-scs">' + esc(SM.partsText(s) + ' · ' + s.body.bpm + ' BPM · ' + SM.keyName(c, s.body).split(' ')[0]) + '</span>' + miniHtml(tall, '') +
      '<span class="sg-scw"><span>In: ' + esc(way(s.intro, 'intro', 'straight in')) + '</span><span>Out: ' + esc(way(s.outro, 'outro', 'straight on')) + '</span></span></button>';
  }

  function selCard(sec, i) {
    const c = ctx(), full = !!sec.body, open = sec.open, n = song.secs.length;
    const playingSel = P.playing && P.key === 'sec:' + sec.id;
    const lf = lift('sec:' + sec.id, playingSel);
    let h = '<div class="sg-sel' + (open ? '' : ' closed') + lf.cls + '" data-sec="' + esc(sec.id) + '"' + (lf.style ? ' style="' + lf.style + '"' : '') + '>' +
      '<div class="sg-selh"><div class="sg-selt"><span class="sg-acttag">Section ' + (i + 1) + ' of ' + n + '</span>' +
        (S.rename === sec.id ? '<input class="sg-rnin" value="' + esc(full || sec.named ? sec.name : '') + '" maxlength="32" placeholder="Name this section" aria-label="Section name. Enter keeps it, Escape leaves it.">'
          : '<h2><button type="button" class="sg-title" data-act="rename" data-id="' + esc(sec.id) + '" title="Rename" aria-label="' + esc((full || sec.named ? sec.name : 'Open section') + ', rename') + '">' + esc(full || sec.named ? sec.name : 'Open section') + PEN + '</button></h2>') +
      '<span class="sg-meta">' + esc(full ? SM.partsText(sec) + ' · ' + sec.body.bpm + ' BPM · ' + SM.keyName(c, sec.body) + (sec.body.swing > 0.1 ? ' · swung' : '') : 'Empty') + '</span></div>' +
      '<div class="sg-selb">' +
        (full ? '<button type="button" class="b-ghost sg-sm" data-act="play-sel" aria-pressed="' + playingSel + '">' + (playingSel ? STOP + ' Stop' : PLAY + ' Hear section') + '</button>' : '') +
        '<button type="button" class="sg-lockb' + (open ? '' : ' is-closed') + '" data-act="lock" aria-pressed="' + !open + '">' + (open ? 'Close section' : 'Closed · reopen') + '</button>' +
      '</div></div>';
    if (!full) {
      h += '<div class="sg-empty">Open and empty. Hear the Substance options above, then use one and it lands here.</div>';
    } else {
      const b = sec.body, inB = sec.intro ? sec.intro.bars : 0, outB = sec.outro ? sec.outro.bars : 0, bodyB = b.bars;
      const barsOf = (k) => (k ? k + (k === 1 ? ' bar' : ' bars') : 'no bars');
      const part = (act, field, name, bars, adj, min, max, less, more) =>
        '<div class="sg-part' + (bars ? '' : ' none') + '"><span class="sg-partl" style="color:' + SM.ACT[act].color + '">' + esc(SM.ACT[act].title.split(' /')[0]) + '</span>' +
        '<b>' + esc(name) + '</b><span class="sg-partn">' + barsOf(bars) + '</span>' +
        (adj ? '<button type="button" class="sg-pm" data-act="step" data-f="' + field + '" data-d="-1"' + (bars <= min ? ' disabled' : '') + ' aria-label="' + less + '">−</button><button type="button" class="sg-pm" data-act="step" data-f="' + field + '" data-d="1"' + (bars >= max ? ' disabled' : '') + ' aria-label="' + more + '">+</button>' : '') + '</div>';
      h += '<div class="sg-parts">' +
        part('build', 'intro', sec.intro ? SM.PART_BY.intro[sec.intro.k].label : 'Straight in', inB, open && inB > 0, 1, 8, 'Shorter build up', 'Longer build up') +
        part('sub', 'body', SM.substanceLabel(c, song, sec), bodyB, open, 2, 16, 'Shorter section', 'Longer section') +
        part('fin', 'outro', sec.outro ? SM.PART_BY.outro[sec.outro.k].label : 'Straight on', outB, open && outB > 0, 1, 8, 'Shorter finish', 'Longer finish') +
      '</div>';
      // the dials: set it yourself
      h += '<div class="sg-dials" role="group" aria-label="Set it yourself">' + SM.DIALS.map((D) => {
        const cyc = D.id === 'curve', lo = !open || D.min(b), hi = !open || D.max(b);
        const val = D.id === 'bpm'
          ? '<span class="sg-dialv"><input class="sg-dialin" type="number" inputmode="numeric" min="40" max="240" step="1" value="' + b.bpm + '" data-dial-in="bpm"' + (open ? '' : ' disabled') + ' aria-label="Tempo in BPM" title="Beats per minute: type a number, or use − and +"></span>'
          : '<span class="sg-dialv">' + esc(D.text(c, b)) + '</span>';
        return '<div class="sg-dial"><span class="sg-dialtop"><span class="sg-diall">' + D.label + '</span>' + val + '</span>' +
          '<button type="button" class="sg-pm" data-act="dial" data-dial="' + D.id + '" data-d="-1"' + (lo ? ' disabled' : '') + ' aria-label="' + (cyc ? 'Previous energy shape' : D.label + ' down') + '">' + (cyc ? '‹' : '−') + '</button>' +
          '<button type="button" class="sg-pm" data-act="dial" data-dial="' + D.id + '" data-d="1"' + (hi ? ' disabled' : '') + ' aria-label="' + (cyc ? 'Next energy shape' : D.label + ' up') + '">' + (cyc ? '›' : '+') + '</button></div>';
      }).join('') + '</div>';
      // ruler and rows over the whole section
      const r = SM.renderSection(c, sec, SM.nextOf(song, sec));
      const total = Math.max(1, Math.round(r.length / T.BAR));
      const picked = S.panel === 'bars' ? SM.barSel(sec, S.bars) : [];
      let ruler = '';
      for (let k = 0; k < total; k++) {
        const x = r2(k / total * 100), w = r2(100 / total);
        let cls = '', label = '';
        if (k < inB) { cls = 'zin'; label = k === 0 ? 'in' : ''; }
        else if (k >= inB + bodyB) { cls = 'zout'; label = k === inB + bodyB ? 'out' : ''; }
        else {
          const bb = k - inB, tw = b.twists[bb];
          label = String(bb + 1) + (tw && total <= 12 ? ' ' + SM.TWIST_NAME[tw] : '');
          cls = (tw ? 'tw' : '') + (picked.includes(bb) ? ' selb' : '');
        }
        ruler += '<span class="' + cls + '" style="left:' + x + '%;width:' + w + '%">' + esc(label) + '</span>';
      }
      let grid = '';
      for (let k = 1; k < total; k++) grid += '<i class="gl" style="left:' + r2(k / total * 100) + '%"></i>';
      const used = {};
      r.events.forEach((e) => { used[e.L] = 1; });
      const rows = SM.rowsOf(c).filter((row) => row.layer || used[row.key]);
      h += '<div class="sg-srow sg-rrow"><span></span><div class="sg-ruler">' + ruler + '</div><span></span></div>';
      h += rows.map((row) => {
        const L = c.layers.find((l) => l.key === row.key);
        const lay = L ? b.lay[L.key] : null, on = !!(lay && lay.on), cur = S.layer === row.key;
        const note = L ? SM.layerNote(c, b, L) : 'in a way in or out';
        const blocks = SM.blocks(r.events, r.length, row.key, row.role === 'drums' || row.role === 'perc');
        return '<div class="sg-srow' + (cur ? ' cur' : '') + (L && !on ? ' off' : '') + '">' +
          (L ? '<button type="button" class="sg-rname" data-act="layer" data-k="' + row.key + '" aria-pressed="' + cur + '">' : '<span class="sg-rname">') +
            '<i style="background:' + row.color + '"></i><span>' + esc(row.label) + '<small>' + esc(note) + '</small></span>' + (L ? '</button>' : '</span>') +
          '<div class="sg-rpic" data-ph="row" aria-hidden="true">' + grid + blocks.map((x) => '<i style="left:' + x.x + '%;top:' + x.y + 'px;width:' + x.w + '%;height:' + x.h + 'px;background:' + row.color + '"></i>').join('') + '<i class="ph" hidden></i></div>' +
          '<div class="sg-rb">' + (L ? '<button type="button" class="sg-minib" data-act="layer-on" data-k="' + row.key + '"' + (open ? '' : ' disabled') + ' aria-pressed="' + on + '" aria-label="' + (on ? 'Turn off ' : 'Turn on ') + esc(row.label) + '">' + (on ? 'On' : 'Off') + '</button>' +
            '<button type="button" class="sg-minib" data-act="vary" data-k="' + row.key + '"' + (open ? '' : ' disabled') + ' aria-label="Vary ' + esc(row.label) + '">Vary</button>' : '') + '</div>' +
        '</div>';
      }).join('');
      if (SM.addable(c).length || SM.removedLayers(c, song).length) h += '<div class="sg-srow sg-addrow"><button type="button" class="sg-addlayer" data-act="add-layer">+ Add a layer</button></div>';
    }
    h += '<div class="sg-self">' +
      '<button type="button" class="sg-link" data-act="add-at" data-i="' + i + '">+ Section before</button>' +
      (n > 1 ? '<button type="button" class="sg-link" data-act="move" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move this section earlier">← Move</button>' +
        '<button type="button" class="sg-link" data-act="move" data-d="1"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Move this section later">Move →</button>' : '') +
      (full ? '<button type="button" class="sg-link" data-act="dup">Duplicate</button>' : '') +
      (open && sec.hist.length ? '<button type="button" class="sg-link" data-act="undo">Undo (' + sec.hist.length + ')</button>' : '') +
      (open && n > 1 ? '<button type="button" class="sg-link" data-act="remove">Remove</button>' : '') +
      '<button type="button" class="sg-link r" data-act="add-at" data-i="' + (i + 1) + '">+ Section after</button>' +
    '</div></div>';
    return h;
  }

  function toolsHtml(sec) {
    const c = ctx(), full = !!(sec && sec.body), open = !!(sec && sec.open);
    let h = '<section class="sg-tools" aria-label="Change this section"><div class="sg-tabs">' +
      TABS.map((t) => '<button type="button" class="sg-tab' + (S.tool === t.id ? ' on' : '') + '" data-act="tab" data-id="' + t.id + '" aria-pressed="' + (S.tool === t.id) + '"><b>' + t.label + '</b><span>' + t.sub + '</span></button>').join('') + '</div>';
    if (S.tool === 'add') return h + addHtml(sec) + '</section>';
    if (S.tool) {
      const layerKey = c.layers.some((l) => l.key === S.layer) ? S.layer : c.lead || (c.layers[0] && c.layers[0].key);
      const L = c.layers.find((l) => l.key === layerKey);
      if (S.tool === 'tweak' && c.layers.length) {
        h += '<div class="sg-barchips" role="group" aria-label="Which layer to vary">' + c.layers.map((x) => '<button type="button" class="sg-bchip' + (x.key === layerKey ? ' on' : '') + '" data-act="layer" data-k="' + x.key + '" aria-pressed="' + (x.key === layerKey) + '"><i class="sg-dotc" style="background:' + (SM.rowsOf(c).find((r) => r.key === x.key) || {}).color + '"></i>' + esc(x.label) + '</button>').join('') + '</div>';
      }
      const now = L && full ? SM.layerNote(c, sec.body, L) : '';
      const note = !full ? 'Fill the section first, then change it here.' : !open ? 'This section is closed.'
        : S.tool === 'tweak' ? (L ? L.label : 'This layer') + ' in ' + sec.name + ' now: ' + (now || 'as written').toLowerCase() + (sec.body.lay[layerKey] && !sec.body.lay[layerKey].on ? ' (turned off here)' : '') + '. Every way to vary it is below, by name. Only this section changes.'
        : S.tool === 'idea' ? 'Which melody this section is built on.' : 'The whole section, a different feel.';
      h += '<p class="sg-note">' + esc(note) + '</p>';
      if (full && open) {
        const opts = SM.toolOptions(c, song, sec, S.tool, layerKey, S.batch[S.tool]);
        const all = S.tool === 'tweak';
        h += '<div class="sg-tcards' + (all ? ' all' : '') + '">' + opts.map((o, k) => card(sec, o, { big: true, sub: all, pick: k === 0 && song.kw.some((x) => x.lean) })).join('') + '</div>';
        const canHand = S.tool === 'tweak' && layerKey === c.lead && !!SM.material(c, sec.body);
        h += '<div class="sg-trow">' + (opts.length && !all ? '<button type="button" class="b-ghost sg-sm" data-act="more" data-g="' + S.tool + '">Three more</button>' : '') +
          (canHand ? '<button type="button" class="b-ghost sg-sm" data-act="edit-toggle" aria-pressed="' + S.edit + '">' + (S.edit ? 'Hide the note editor' : 'Edit notes by hand') + '</button>' : '') +
          (all && L && L.added ? '<button type="button" class="b-ghost sg-sm" data-act="drop-layer" data-k="' + L.key + '">Remove ' + esc(L.label.toLowerCase()) + ' from the song</button>' : '') + '</div>';
        if (canHand && S.edit) h += editorHtml(sec);
      } else if (S.tool === 'tweak' && L && L.added) {
        h += '<div class="sg-trow"><button type="button" class="b-ghost sg-sm" data-act="drop-layer" data-k="' + L.key + '">Remove ' + esc(L.label.toLowerCase()) + ' from the song</button></div>';
      }
    }
    return h + '</section>';
  }

  /** Add a layer: which kind, then Bobby's three takes on it */
  function addHtml(sec) {
    const c = ctx(), adds = SM.addable(c), back = SM.removedLayers(c, song);
    const any = SM.filled(song).length > 0;
    let h = '<p class="sg-note">' + esc(!any ? 'Fill a section first; then layers have something to fit.'
      : adds.length ? 'Pick a layer. I make three that fit your idea; hear each with ' + (sec.body ? 'this section' : 'your first section') + ', then use one. It goes into every open section.'
      : 'Every kind of layer is in. Turn layers off section by section in the stack, or remove one under Vary a layer.') + '</p>';
    if (!any) return h;
    if (adds.length || back.length) {
      h += '<div class="sg-barchips" role="group" aria-label="Layer to add">' +
        adds.map((a) => '<button type="button" class="sg-bchip' + (S.addRole === a.role ? ' on' : '') + '" data-act="add-role" data-role="' + a.role + '" aria-pressed="' + (S.addRole === a.role) + '">' + esc(a.label) + '</button>').join('') +
        back.map((b) => '<button type="button" class="sg-bchip back" data-act="restore-layer" data-k="' + b.key + '">Put back ' + esc(b.label.toLowerCase()) + '</button>').join('') +
      '</div>';
    }
    const a = SM.ADD_BY[S.addRole];
    if (a && adds.some((x) => x.role === a.role)) {
      const g = 'add:' + a.role;
      const opts = SM.layerOptions(c, song, a.role, S.batch[g]);
      let best = -1, bs = -Infinity;
      opts.forEach((o, k) => { const v = SM.score(song.kw, o.t || {}) + (k === 1 ? 1e-6 : 0); if (v > bs) { bs = v; best = k; } });
      h += '<p class="sg-note">' + esc(a.sub) + '</p>';
      h += '<div class="sg-tcards">' + opts.map((o, k) => card(sec, o, { big: true, pick: k === best, useLabel: 'Add it to the song' })).join('') + '</div>';
      h += '<div class="sg-trow"><button type="button" class="b-ghost sg-sm" data-act="more" data-g="' + g + '">Three more</button></div>';
    }
    return h;
  }

  /** the header's second row: play from the playhead, the whole song as a timeline */
  function transportHtml() {
    const c = ctx(), tl = SM.timeline(c, song);
    P.tl = tl;
    if (P.head > tl.length) P.head = 0;
    const playing = P.playing && P.key === 'song';
    const total = secsAt(tl.length);
    const pct = (x) => r2(x / tl.length * 100);
    let h = '<div class="sg-tp" role="group" aria-label="Transport">' +
      '<div class="sg-tpb">' +
        '<button type="button" class="sg-tpbtn" data-act="tp-start" aria-label="Back to the start" title="Back to the start">' + TO_START + '</button>' +
        '<button type="button" class="b-primary sg-tpplay" data-act="play-song" aria-pressed="' + playing + '" title="Space">' + (playing ? STOP + ' Stop' : PLAY + ' Play') + '</button>' +
        '<button type="button" class="sg-tpbtn sg-loop' + (P.loop ? ' on' : '') + '" data-act="tp-loop" aria-pressed="' + P.loop + '" title="Play the song round and round">Loop</button>' +
        '<span class="sg-time"><b data-time>' + SM.mmss(secsAt(P.head)) + '</b> / ' + SM.mmss(total) + '</span>' +
        '<span class="sg-tpnow" data-now></span>' +
      '</div>';
    if (!tl.secs.length) return h + '<div class="sg-tl empty">Fill a section and the song shows here.</div></div>';
    h += '<div class="sg-tl" data-act="seek" role="slider" tabindex="0" aria-label="Song position, in seconds. Arrow keys move a bar." aria-valuemin="0" aria-valuemax="' + Math.round(total) + '" aria-valuenow="' + Math.round(secsAt(P.head)) + '">' +
      tl.secs.map((x) => {
        const i = song.secs.findIndex((y) => y.id === x.id) + 1, w = x.end - x.start;
        return '<span class="sg-tls' + (x.id === S.sel ? ' sel' : '') + (x.open ? '' : ' closed') + '" data-sec="' + esc(x.id) + '" style="left:' + pct(x.start) + '%;width:' + pct(w) + '%">' +
          (x.inEnd > x.start ? '<i class="zin" style="width:' + r2((x.inEnd - x.start) / w * 100) + '%"></i>' : '') +
          (x.end > x.outStart ? '<i class="zout" style="width:' + r2((x.end - x.outStart) / w * 100) + '%"></i>' : '') +
          '<b>' + i + '. ' + esc(x.name) + '</b></span>';
      }).join('') +
      '<i class="sg-tlhead" style="left:' + pct(P.head) + '%"></i></div>';
    return h + '</div>';
  }

  function editorHtml(sec) {
    const c = ctx(), mat = SM.material(c, sec.body);
    const steps = Math.min(64, mat.bars * 16);
    const degs = mat.notes.map((n) => n.deg);
    const lo = Math.min.apply(null, degs.concat([0])) - 2, hi = Math.max(lo + 11, Math.max.apply(null, degs.concat([4])) + 2);
    const base = mat.base != null ? mat.base : 60;
    let h = '<p class="sg-note">Click a square to add a note, click a note to take it out. Every repeat of the phrase in this section changes with it.' + (mat.bars > 4 ? ' The first four bars show here.' : '') + '</p><div class="sg-editor" role="group" aria-label="Melody notes">';
    for (let deg = hi; deg >= lo; deg--) {
      const p = T.pitchOf(deg, 0, c.tonic, c.scale, base) + (sec.body.shift || 0);
      const name = T.NOTE_NAMES[T.mod(p, 12)];
      h += '<div class="sg-erow"><span class="sg-elab">' + esc(name) + '</span>';
      for (let s = 0; s < steps; s++) {
        const t = s * T.STEP;
        const nt = mat.notes.find((x) => x.deg === deg && x.t <= t && t < x.t + x.d);
        const cls = 'sg-ec' + (s % 16 === 0 ? ' b' : s % 4 === 0 ? ' q' : '') + (nt ? (Math.abs(nt.t - t) < T.STEP ? ' on' : ' hold') : '');
        h += '<button type="button" class="' + cls + '" data-act="cell" data-deg="' + deg + '" data-s="' + s + '" aria-label="' + esc(name) + ', bar ' + (Math.floor(s / 16) + 1) + ', step ' + ((s % 16) + 1) + (nt ? ', note' : '') + '"></button>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  function panelHtml(sec) {
    if (!S.panel) return '';
    const c = ctx();
    let h = '<section class="sg-panel" aria-label="' + PANEL_TITLES[S.panel] + '"><div class="sg-panelh"><h2>' + PANEL_TITLES[S.panel] + '</h2><button type="button" class="b-ghost sg-sm" data-act="close-panel">Close</button></div>';
    if (S.panel === 'kw') {
      h += '<p class="sg-pnote">Rank what matters to you: the higher a word sits, the more say it gets when Bobby picks what to offer. Leave a row in the middle for no preference.</p><ol class="sg-kw">' +
        song.kw.map((k, i) => {
          const d = SM.KWD[k.id];
          return '<li class="sg-kwrow"><span class="sg-kwn">' + (i + 1) + '</span><span class="sg-kwmove">' +
            '<button type="button" data-act="kw-move" data-id="' + k.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move ' + d.lo + ' or ' + d.hi + ' up">' + ARROW(-1) + '</button>' +
            '<button type="button" data-act="kw-move" data-id="' + k.id + '" data-d="1"' + (i === song.kw.length - 1 ? ' disabled' : '') + ' aria-label="Move ' + d.lo + ' or ' + d.hi + ' down">' + ARROW(1) + '</button></span>' +
            '<span class="sg-kwlo' + (k.lean < 0 ? ' on' : '') + '">' + d.lo + '</span><span class="sg-kwdots">' +
            [-2, -1, 0, 1, 2].map((x) => '<button type="button" class="sg-dot' + (x === 0 ? ' mid' : '') + (k.lean === x ? ' on' : '') + '" data-act="lean" data-id="' + k.id + '" data-v="' + x + '" aria-pressed="' + (k.lean === x) + '" aria-label="' + (x === 0 ? 'No preference' : (Math.abs(x) > 1 ? 'Very ' : 'A bit ') + (x < 0 ? d.lo : d.hi).toLowerCase()) + '"></button>').join('') +
            '</span><span class="sg-kwhi' + (k.lean > 0 ? ' on' : '') + '">' + d.hi + '</span></li>';
        }).join('') + '</ol>';
    } else if (S.panel === 'bars') {
      const ready = sec && sec.body && sec.open;
      h += '<p class="sg-pnote">' + esc(!sec || !sec.body ? 'Pick a filled section first.' : !sec.open ? 'This section is closed.' : 'Bars in ' + sec.name + '. Pick one or more, or the whole section; Bobby offers three twists. The last bar is picked unless you choose.') + '</p>';
      if (ready) {
        const n = sec.body.bars, picked = S.bars.filter((b) => b < n), whole = picked.length === n;
        h += '<div class="sg-barchips">';
        for (let b = 0; b < n; b++) h += '<button type="button" class="sg-bchip' + (picked.includes(b) ? ' on' : '') + '" data-act="bar" data-b="' + b + '" aria-pressed="' + picked.includes(b) + '">Bar ' + (b + 1) + '</button>';
        h += '<button type="button" class="sg-bchip' + (whole ? ' on' : '') + '" data-act="bar-all" aria-pressed="' + whole + '">Whole section</button></div>';
        h += '<div class="sg-tcards">' + SM.twistOptions(c, song, sec, S.bars, S.batch.twist).map((o, k) => card(sec, o, { big: true, pick: k === 0, useLabel: 'Twist it' })).join('') + '</div>';
        const picked2 = SM.barSel(sec, S.bars), twisted = picked2.filter((x) => sec.body.twists[x]);
        h += '<div class="sg-trow"><button type="button" class="b-ghost sg-sm" data-act="more" data-g="twist">Three more</button>' +
          (twisted.length ? '<button type="button" class="b-ghost sg-sm" data-act="clear-twists">Take the twist off ' + (twisted.length === 1 ? 'bar ' + (twisted[0] + 1) : twisted.length + ' bars') + '</button>' : '') + '</div>';
      }
    } else if (S.panel === 'an') {
      const an = SM.analyse(c, song);
      h += '<div class="sg-an"><div class="sg-stats">' + an.stats.map((s) => '<div class="sg-stat"><span>' + esc(s.k) + '</span><b>' + esc(s.v) + '</b></div>').join('') + '</div>' +
        '<div class="sg-chart" role="group" aria-label="Energy, section by section">' + an.chart.map((x) => '<button type="button" class="sg-barc' + (x.id === S.sel ? ' on' : '') + '" style="flex-grow:' + x.w + '" data-act="chart" data-id="' + esc(x.id) + '" aria-label="Section ' + x.label + ', ' + esc(x.name) + (x.empty ? '' : ', energy ' + Math.round(x.energy * 10) + ' of 10') + '"><i style="height:' + x.h + '%;background:' + (x.empty ? 'var(--line)' : 'var(--b-gold)') + '"></i><span>' + x.label + '</span></button>').join('') + '</div>' +
        '<ul class="sg-opps">' + (an.opps.length ? an.opps : [{ text: 'Nothing jumps out. It’s in good shape.', label: 'Play song', go: {} }]).map((o) => '<li><span>' + esc(o.text) + '</span><button type="button" class="b-ghost sg-sm" data-act="' + (o.go.sel || o.go.add ? 'chip' : 'play-song') + '" data-go="' + esc(JSON.stringify(o.go)) + '">' + esc(o.label) + '</button></li>').join('') + '</ul></div>';
    }
    return h + '</section>';
  }

  function songHtml() {
    const c = ctx(), sec = sel(), i = selIndex();
    let h = '';
    if (sec.open) {
      const all = SM.allActOptions(c, song, sec, S.batch);
      h += '<section class="sg-acts" aria-label="Bobby’s options for this section">' + SM.ACTS.map((a) => {
        const opts = all.opts[a.id];
        const cards = opts.map((o) => card(sec, o, { pick: o.key === all.picks[a.id], useLabel: a.id === 'sub' ? (sec.body ? 'Swap it in' : 'Put it here') : 'Use this' })).join('');
        return '<div class="sg-act' + (S.all === a.id ? ' all' : '') + '"><div class="sg-acth"><i style="background:' + a.color + '"></i><b>' + a.title + '</b><span>' + a.sub + '</span>' +
          (opts.length ? '<button type="button" class="sg-more" data-act="more" data-g="' + a.id + '">Three more</button>' +
            '<button type="button" class="sg-more" data-act="see-all" data-g="' + a.id + '" aria-pressed="' + (S.all === a.id) + '" aria-label="' + (S.all === a.id ? 'Hide the full list' : 'See every option for ' + a.title.split(' /')[0].toLowerCase()) + '">' + (S.all === a.id ? 'Hide all' : 'See all') + '</button>' : '') + '</div>' +
          (opts.length ? '<div class="sg-opts">' + cards + '</div>' : '<p class="sg-actnote">Pick what the section is first. Then it gets a ' + (a.id === 'build' ? 'way in.' : 'way out.') + '</p>') + '</div>';
      }).join('') + '</section>';
      h += allHtml(sec);
    } else {
      h += '<div class="sg-locked"><span>This section is closed, so Bobby keeps his hands off it.</span><button type="button" class="b-ghost sg-sm" data-act="reopen">Reopen it</button></div>';
    }
    h += '<section class="sg-strip" aria-label="Song sections">' +
      '<button type="button" class="sg-add" data-act="add-at" data-i="0" aria-label="Add a section at the start">+</button>' +
      song.secs.slice(0, i).map((s, k) => smallCard(s, k)).join('') +
      selCard(sec, i) +
      song.secs.slice(i + 1).map((s, k) => smallCard(s, i + 1 + k)).join('') +
      '<button type="button" class="sg-add" data-act="add-at" data-i="' + song.secs.length + '" aria-label="Add a section at the end">+</button>' +
    '</section>';
    h += toolsHtml(sec);
    return h;
  }

  function bubbles() {
    if (S.phase !== 'song') {
      return { leftWho: 'Your idea book', left: 'Gold ideas you saved in the Idea Builder. Pick one to grow. A second one can come along as a guest.', right: S.msg || START_LINE, chips: [] };
    }
    const c = ctx(), sec = sel(), i = selIndex();
    const out = { leftWho: 'Section ' + (i + 1) + ' of ' + song.secs.length, left: SM.describe(c, song, sec, i), right: S.msg, chips: S.msg && S.chips.length && S.chipMsg === S.msg ? S.chips : [] };
    if (!out.right) {
      if (SM.allClosed(song)) { out.right = 'Every section is closed. That’s a song. Export it, or reopen anything to keep going.'; out.chips = [{ label: 'Export MIDI', go: { export: true } }]; }
      else {
        const an = SM.analyse(c, song);
        if (an.opps.length) { out.right = an.opps[0].text; out.chips = [{ label: an.opps[0].label, go: an.opps[0].go }]; }
        else out.right = 'Sounding good. Close the sections you love; I’ll keep working on the open ones.';
      }
    }
    return out;
  }

  function render() {
    if (!root || !shown) return;
    OPTS.clear();
    const active = document.activeElement;
    const focusKey = active && root.contains(active) ? focusKeyOf(active) : '';
    const strip = root.querySelector('.sg-strip');
    const sx = strip ? strip.scrollLeft : 0;
    const isSong = S.phase === 'song' && song;
    if (isSong) ctx();
    const bb = bubbles();
    let meta = '', top = '';
    if (isSong) {
      const an = SM.analyse(C, song);
      const closed = song.secs.length - an.open;
      meta = '<div class="sg-songmeta">' + (S.rename === 'song'
        ? '<input class="sg-rnin sg-rnsong" value="' + esc(song.name) + '" maxlength="60" aria-label="Song name. Enter keeps it, Escape leaves it.">'
        : '<button type="button" class="sg-title sg-songname" data-act="rename" data-id="song" title="Rename the song" aria-label="' + esc(song.name) + ', rename the song">' + esc(song.name) + PEN + '</button>') + '<span class="sg-meta">' + closed + ' of ' + song.secs.length + ' sections closed · ' + SM.mmss(an.seconds) + '</span></div>';
      top = '<button type="button" class="b-ghost" data-act="export">Export MIDI</button>' +
        '<button type="button" class="b-ghost" data-act="new-song">New song</button>';
    }
    root.innerHTML =
      '<div class="sg">' +
        '<header class="b-top sg-top">' +
          '<div class="b-brand">' + Odd.brand.homeButton() + '<span>Song Builder</span></div>' + meta +
          '<div class="b-top-r">' + top + '<button type="button" class="b-ghost" data-act="studio" title="The song sheet, booth and shelf">Studio</button></div>' +
          (isSong ? transportHtml() : '') +
        '</header>' +
        '<main class="sg-stage">' +
          bobbyRow(bb.left, bb.leftWho, bb.right, bb.chips) +
          (isSong || S.panel === 'kw' ? panelHtml(isSong ? sel() : null) : '') +
          (isSong ? songHtml() : '<div class="sg-book">' + startHtml() + '</div>') +
        '</main>' +
      '</div>';
    const strip2 = root.querySelector('.sg-strip');
    if (strip2) {
      strip2.scrollLeft = sx;
      if (S.sel !== S.centred) {
        S.centred = S.sel;
        const el = strip2.querySelector('.sg-sel');
        if (el && strip2.scrollWidth > strip2.clientWidth && strip2.scrollTo) strip2.scrollTo({ left: Math.max(0, el.offsetLeft - (strip2.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' });
      }
    }
    const rn = S.renameFocus && root.querySelector('.sg-rnin');
    if (rn) { S.renameFocus = false; rn.focus({ preventScroll: true }); rn.select(); }
    else if (focusKey) {
      const el = root.querySelector(focusKey);
      if (el) el.focus({ preventScroll: true });
    }
    if (isSong) drawHead();
    if (P.playing) loop();
  }

  /** a selector that finds the same control after a redraw */
  function focusKeyOf(el) {
    const b = el.closest('[data-act]');
    if (!b) return '';
    const attrs = ['data-act', 'data-o', 'data-id', 'data-k', 'data-i', 'data-f', 'data-d', 'data-g', 'data-b', 'data-v', 'data-deg', 'data-s', 'data-role'];
    return attrs.filter((a) => b.hasAttribute(a)).map((a) => '[' + a + '="' + String(b.getAttribute(a)).replace(/["\\]/g, '\\$&') + '"]').join('');
  }

  // ---------------------------------------------------------------- outside

  function mount(el, h) {
    root = el;
    host = h || {};
    root.addEventListener('click', onClick);
    // renaming: Enter keeps the name, Escape leaves it, clicking away keeps it
    root.addEventListener('keydown', (e) => {
      if (!e.target.classList || !e.target.classList.contains('sg-rnin')) return;
      if (e.key === 'Enter') { e.preventDefault(); commitRename(e.target.value); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.rename = ''; render(); }
    });
    root.addEventListener('focusout', (e) => {
      if (e.target.classList && e.target.classList.contains('sg-rnin') && S.rename) commitRename(e.target.value);
    });
    // a typed tempo
    root.addEventListener('change', (e) => {
      const id = e.target.dataset && e.target.dataset.dialIn;
      if (id && e.target.value !== '') dial(id, 0, Number(e.target.value));
    });
    document.addEventListener('click', (e) => {
      if (S.menu && root && !e.target.closest('.sg-bob')) { S.menu = false; render(); }
    });
    if (Odd.transport && Odd.transport.on) {
      Odd.transport.on('end', () => { if (P.playing && shown) { if (P.key === 'song') P.head = 0; P.playing = false; P.key = ''; S.heard = ''; render(); } });
      Odd.transport.on('stall', () => { if (P.playing && shown) { P.playing = false; P.key = ''; render(); } });
    }
  }

  function show(on) {
    shown = !!on;
    if (!shown) { halt(); cancelAnimationFrame(P.raf); if (root) root.innerHTML = ''; return; }
    if (!song && host.current) {
      const cur = host.current();
      if (cur) {
        song = cur;
        const first = song.secs.find((x) => x.open) || song.secs[0];
        Object.assign(S, { phase: 'song', sel: S.sel && SM.findSec(song, S.sel) ? S.sel : first.id });
      }
    }
    if (song && !SM.findSec(song, S.sel)) S.sel = song.secs[0].id;
    S.centred = '';
    render();
  }

  Odd.song = {
    mount, show, onKey,
    get song() { return song; },
    get state() { return S; },
    get playing() { return P.playing; },
  };
})(globalThis.Odd = globalThis.Odd || {});
