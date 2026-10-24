/* Oddition — transport: a lookahead scheduler.
 *
 * A timer wakes every 25 ms and schedules every note that starts in the next
 * ~120 ms at an exact audio-clock time ("A Tale of Two Clocks" pattern).
 * Positions are tracked as an unwrapped tick count U; with looping, the local
 * tick is U mod length. Swapping the sequence (update) or the mix (setTracks)
 * cancels notes that have not started yet and reschedules them from the new
 * data, so nothing plays twice or goes missing.
 */
(function (Odd) {
  'use strict';

  const LOOKAHEAD = 0.12;
  // phones (light sound mode): schedule further ahead so a busy main thread
  // (layout, garbage collection) can't make notes late
  const LOOKAHEAD_LIGHT = 0.3;
  const HIDDEN_LOOKAHEAD = 1.2;
  // the audio clock may not advance for this long before playback counts as stalled
  const STALL_SEC = 2.5;
  const INTERVAL = 25;
  const START_DELAY = 0.06;
  const CUT_MARGIN = 0.02;
  const DEFAULT_TRACK = { patch: 'keys', volume: 1, mute: false, solo: false, channel: 0 };

  function ppq() { return (Odd.theory && Odd.theory.PPQ) || 480; }
  function mod(n, m) { return ((n % m) + m) % m; }
  function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  function clampBpm(b) { return Math.max(20, Math.min(400, Number(b) || 120)); }
  function sptOf(bpm) { return 60 / (clampBpm(bpm) * ppq()); }

  const listeners = { start: [], stop: [], end: [], loop: [], stall: [] };
  function emit(name) {
    (listeners[name] || []).slice().forEach((fn) => {
      try { fn(name); } catch (e) { console.error(e); }
    });
  }

  const st = {
    seq: null, playing: false, ctx: null, spt: sptOf(120),
    anchorTime: 0, anchorTick: 0, nextTick: 0,
    playStart: 0, playStartTick: 0,
    scheduled: [], hits: {}, lastHits: {},
    timers: [], endTimer: null, interval: null, worker: null, workerBroken: false,
    token: 0, lastPos: 0, solo: false,
    clockT: 0, clockWall: 0, resumeTry: 0,
  };

  function lookahead() { return Odd.audio && Odd.audio.quality === 'light' ? LOOKAHEAD_LIGHT : LOOKAHEAD; }

  function tickToTime(U) { return st.anchorTime + (U - st.anchorTick) * st.spt; }
  function timeToTick(T) { return st.anchorTick + (T - st.anchorTime) / st.spt; }
  function latency() { return (st.ctx && (st.ctx.outputLatency || st.ctx.baseLatency)) || 0; }

  function norm(seq) {
    const s = Object.assign({}, seq || {});
    s.bpm = clampBpm(s.bpm);
    s.length = Math.max(1, Number(s.length) || ppq() * 4);
    s.loop = !!s.loop;
    s.tracks = s.tracks || {};
    let ev = Array.isArray(s.events) ? s.events : [];
    for (let i = 1; i < ev.length; i++) {
      if (ev[i].t < ev[i - 1].t) { ev = ev.slice().sort((a, b) => a.t - b.t); break; }
    }
    s.events = ev;
    return s;
  }

  // ---- routing

  function midiReady() {
    const wm = Odd.webmidi;
    return !!(wm && wm.mode !== 'internal' && wm.ready && wm.ready());
  }
  function useInternal() {
    const wm = Odd.webmidi;
    return !wm || wm.mode !== 'midi' || !midiReady();
  }
  function soloIn(tracks) { return Object.keys(tracks).some((k) => tracks[k] && tracks[k].solo); }
  function audibleIn(tracks, solo, key) {
    const tr = tracks[key];
    if (!tr) return !solo;
    if (tr.mute) return false;
    return !solo || !!tr.solo;
  }
  function audible(key) { return audibleIn(st.seq.tracks, st.solo, key); }
  // same rule as offline renders, so live playback and WAV export always agree
  function patchOf(tr) { return Odd.synth.resolvePatch(tr); }

  function syncBuses() {
    st.solo = soloIn(st.seq.tracks);
    if (!st.ctx || !Odd.synth) return;
    const keys = new Set(Object.keys(st.seq.tracks));
    for (const e of st.seq.events) keys.add(e.track);
    for (const key of keys) {
      const tr = st.seq.tracks[key] || DEFAULT_TRACK;
      try {
        const b = Odd.synth.bus(key, st.ctx);
        b.setVolume(tr.volume == null ? 1 : tr.volume);
        b.setMute(!audible(key));
        if (tr.pan != null && b.setPan) b.setPan(tr.pan);
      } catch (e) { console.error(e); }
    }
  }

  function sendPrograms(tracks, only) {
    if (!midiReady() || !Odd.synth) return;
    for (const key of Object.keys(tracks)) {
      if (only && !only.has(key)) continue;
      const tr = tracks[key];
      const patch = patchOf(tr);
      if (Odd.synth.isKit(patch)) continue;
      const P = Odd.synth.PATCHES[patch];
      if (P) Odd.webmidi.programChange((tr.channel || 0) & 15, P.gm);
    }
  }

  // ---- scheduling

  function toMs(t) { return nowMs() + (t - st.ctx.currentTime) * 1000; }

  function lowerBound(ev, t) {
    let lo = 0, hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].t < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function scheduleNote(e, when) {
    const key = e.track;
    if (!audible(key)) return;
    const tr = st.seq.tracks[key] || DEFAULT_TRACK;
    const dur = Math.max(0.005, (e.d || 1) * st.spt);
    const ent = { track: key, start: when, end: when + dur, voice: null, midi: null };
    if (useInternal() && Odd.synth) {
      try {
        const b = Odd.synth.bus(key, st.ctx);
        ent.voice = Odd.synth.play(patchOf(tr), e.p, e.v, when, dur, b.input);
        if (ent.voice && ent.voice.end) ent.end = Math.max(ent.end, ent.voice.end);
      } catch (err) { console.error(err); }
    }
    if (midiReady()) {
      const ch = (tr.channel == null ? 0 : tr.channel) & 15;
      const onMs = toMs(when);
      const offMs = Math.max(onMs + 1, toMs(when + dur) - 1);
      Odd.webmidi.noteOn(ch, e.p, e.v, onMs);
      Odd.webmidi.noteOff(ch, e.p, offMs);
      ent.midi = { ch, p: e.p, onMs, offMs };
    }
    st.scheduled.push(ent);
    const h = st.hits[key] || (st.hits[key] = []);
    h.push({ time: when, v: e.v });
    if (h.length > 128) h.splice(0, h.length - 128);
  }

  function scheduleRange(a, b, base) {
    const ev = st.seq.events;
    for (let i = lowerBound(ev, a); i < ev.length && ev[i].t < b; i++) {
      scheduleNote(ev[i], tickToTime(base + ev[i].t));
    }
  }

  function later(at, fn) {
    const delay = Math.max(0, (at - st.ctx.currentTime) * 1000);
    const item = { at, id: 0 };
    item.id = setTimeout(() => {
      st.timers = st.timers.filter((x) => x !== item);
      fn();
    }, delay);
    st.timers.push(item);
  }

  function clearTimers(fromTime) {
    st.timers = st.timers.filter((x) => {
      if (fromTime == null || x.at >= fromTime) { clearTimeout(x.id); return false; }
      return true;
    });
    if (st.endTimer) { clearTimeout(st.endTimer); st.endTimer = null; }
  }

  function prune() {
    const t = st.ctx.currentTime - 0.05;
    const ms = nowMs();
    if (st.scheduled.length > 64) {
      st.scheduled = st.scheduled.filter((e) => e.end > t || (e.midi && e.midi.offMs > ms));
    }
  }

  function armEnd() {
    const token = st.token;
    const delay = Math.max(0, (tickToTime(st.seq.length) - st.ctx.currentTime + latency()) * 1000);
    st.endTimer = setTimeout(() => {
      st.endTimer = null;
      if (!st.playing || token !== st.token) return;
      st.playing = false;
      stopTimer();
      clearTimers();
      st.lastPos = st.seq.length;
      emit('end');
      emit('stop');
    }, delay);
  }

  /*
   * Watchdog. A suspended or frozen audio clock means silence while the page
   * still looks like it's playing: phones do this when the OS takes audio away
   * or the audio thread can't keep up. Try to resume; if the clock stays stuck
   * past STALL_SEC, stop and emit 'stall' so the app can say so.
   */
  function stalled() {
    const ctx = st.ctx;
    const now = nowMs();
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (ctx.currentTime !== st.clockT || hidden) {
      // moving (or the page is in the background, where browsers may pause audio)
      st.clockT = ctx.currentTime;
      st.clockWall = now;
      return false;
    }
    if (ctx.state !== 'running' && ctx.resume && now - st.resumeTry > 500) {
      st.resumeTry = now;
      try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* closed */ }
    }
    return (now - st.clockWall) / 1000 > STALL_SEC;
  }

  function pump() {
    if (!st.playing || !st.ctx) return;
    if (stalled()) {
      halt();
      emit('stall');
      emit('stop');
      return;
    }
    const seq = st.seq;
    const L = seq.length;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const horizon = timeToTick(st.ctx.currentTime + (hidden ? HIDDEN_LOOKAHEAD : lookahead()));
    prune();
    if (horizon <= st.nextTick) return;
    if (!seq.loop) {
      const to = Math.min(horizon, L);
      if (to > st.nextTick) {
        scheduleRange(st.nextTick, to, 0);
        st.nextTick = to;
      }
      if (st.nextTick >= L && !st.endTimer) armEnd();
      return;
    }
    let from = st.nextTick;
    let guard = 0;
    while (from < horizon && guard++ < 10000) {
      const k = Math.floor(from / L + 1e-9);
      const base = k * L;
      const segEnd = Math.min(horizon, base + L);
      if (segEnd > from) scheduleRange(from - base, segEnd - base, base);
      if (segEnd >= base + L) {
        later(tickToTime(base + L) + latency(), () => emit('loop'));
        from = base + L;
      } else {
        from = segEnd;
      }
    }
    st.nextTick = horizon;
  }

  // ---- timers (a worker timer keeps going in background tabs)

  function startTimer() {
    stopTimer();
    st.interval = setInterval(pump, INTERVAL);
    if (st.workerBroken) return;
    try {
      if (!st.worker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined' &&
          typeof URL !== 'undefined' && URL.createObjectURL) {
        const src = 'var id=null;onmessage=function(e){clearInterval(id);id=null;' +
          'if(e.data==="start")id=setInterval(function(){postMessage(0)},' + INTERVAL + ');};';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(url);
        w.onmessage = pump;
        w.onerror = () => {
          try { w.terminate(); } catch (e) { /* gone */ }
          st.worker = null;
          st.workerBroken = true;
        };
        st.worker = w;
      }
      if (st.worker) st.worker.postMessage('start');
    } catch (e) {
      st.worker = null;
      st.workerBroken = true;
    }
  }

  function stopTimer() {
    if (st.interval) clearInterval(st.interval);
    st.interval = null;
    if (st.worker) {
      try { st.worker.postMessage('stop'); } catch (e) { /* gone */ }
    }
  }

  // ---- MIDI hanging-note protection

  function midiOffs(filterFn) {
    const wm = Odd.webmidi;
    if (!wm) return;
    const t = nowMs();
    for (const ent of st.scheduled) {
      if (!ent.midi || ent.midi.offMs <= t) continue;
      if (filterFn && !filterFn(ent)) continue;
      wm.noteOff(ent.midi.ch, ent.midi.p, t);
      // a note-on still queued for the future would arrive after that off
      if (ent.midi.onMs > t) wm.noteOff(ent.midi.ch, ent.midi.p, ent.midi.onMs + 1);
      ent.midi.offMs = t;
    }
  }

  // ---- public API

  function position() {
    if (!st.playing || !st.ctx) return st.lastPos;
    const heard = st.ctx.currentTime - latency();
    if (heard < st.playStart) return st.playStartTick;
    const U = timeToTick(heard);
    const L = st.seq.length;
    if (st.seq.loop) return mod(U, L);
    return Math.max(0, Math.min(L, U));
  }

  function halt() {
    st.lastPos = position();
    st.playing = false;
    stopTimer();
    clearTimers();
    if (Odd.synth && st.ctx) Odd.synth.stopAll();
    if (Odd.webmidi) Odd.webmidi.clear();
    midiOffs();
    st.scheduled = [];
    st.hits = {};
  }

  function play(seq, opts) {
    opts = opts || {};
    const token = ++st.token;
    if (!Odd.audio) return Promise.reject(new Error('Audio engine not loaded'));
    return Odd.audio.ensure().then((ctx) => {
      if (token !== st.token) return;
      if (st.playing) halt();
      st.ctx = ctx;
      st.seq = norm(seq);
      st.spt = sptOf(st.seq.bpm);
      const L = st.seq.length;
      let start = Math.max(0, Number(opts.startTick) || 0);
      if (st.seq.loop) start = mod(start, L);
      else if (start >= L) start = 0;
      st.anchorTime = ctx.currentTime + START_DELAY;
      st.anchorTick = start;
      st.nextTick = start;
      st.playStart = st.anchorTime;
      st.playStartTick = start;
      st.scheduled = [];
      st.hits = {};
      st.lastHits = {};
      st.clockT = ctx.currentTime;
      st.clockWall = nowMs();
      st.playing = true;
      syncBuses();
      sendPrograms(st.seq.tracks);
      startTimer();
      pump();
      emit('start');
    });
  }

  /** move the scheduling point to "now" and continue with `next` from the same musical spot */
  function reschedule(next) {
    const ctx = st.ctx;
    const old = st.seq;
    let cut, posTick;
    if (!midiReady()) {
      cut = Math.max(ctx.currentTime + CUT_MARGIN, st.anchorTime);
      posTick = timeToTick(cut);
      const snapped = Math.round(posTick);
      if (Math.abs(posTick - snapped) < 0.01) {
        posTick = snapped;
        cut = tickToTime(posTick);
      }
      if (posTick > st.nextTick) { posTick = st.nextTick; cut = tickToTime(posTick); }
      const keep = [];
      for (const ent of st.scheduled) {
        if (ent.start >= cut - 1e-6) {
          if (ent.voice) ent.voice.stop(ent.start);
        } else {
          keep.push(ent);
        }
      }
      st.scheduled = keep;
      for (const key of Object.keys(st.hits)) st.hits[key] = st.hits[key].filter((h) => h.time < cut - 1e-6);
      clearTimers(cut);
    } else {
      // queued MIDI cannot be recalled, so continue after what was already sent
      posTick = st.nextTick;
      cut = tickToTime(posTick);
      clearTimers(cut);
    }
    let local = old.loop ? mod(posTick, old.length) : posTick;
    if (next.loop) local = mod(local, next.length);
    st.seq = next;
    st.spt = sptOf(next.bpm);
    st.anchorTime = cut;
    st.anchorTick = local;
    st.nextTick = local;
    syncBuses();
    pump();
  }

  function update(seq) {
    const next = norm(seq);
    if (!st.playing || !st.ctx) { st.seq = next; return; }
    reschedule(next);
  }

  function setTracks(tracks) {
    tracks = tracks || {};
    if (!st.seq) st.seq = norm({ tracks });
    const prev = st.seq.tracks || {};
    const next = Object.assign({}, st.seq, { tracks });
    if (!st.playing || !st.ctx) {
      st.seq = next;
      if (st.ctx) syncBuses();
      return;
    }
    const prevSolo = soloIn(prev);
    const nextSolo = soloIn(tracks);
    const keys = new Set(Object.keys(prev).concat(Object.keys(tracks)));
    const silenced = new Set();
    const programs = new Set();
    let resched = false;
    for (const key of keys) {
      const was = audibleIn(prev, prevSolo, key);
      const is = audibleIn(tracks, nextSolo, key);
      if (was && !is) silenced.add(key);
      if (!was && is) resched = true;
      const a = prev[key] || {};
      const b = tracks[key] || {};
      if (a.patch !== b.patch) { resched = true; programs.add(key); }
      if ((a.channel || 0) !== (b.channel || 0)) { resched = true; programs.add(key); }
    }
    st.seq = next;
    syncBuses();
    if (silenced.size) {
      const now = st.ctx.currentTime;
      for (const ent of st.scheduled) {
        if (silenced.has(ent.track) && ent.voice) ent.voice.stop(now);
      }
      midiOffs((ent) => silenced.has(ent.track));
    }
    if (programs.size) sendPrograms(tracks, programs);
    if (resched) reschedule(next);
  }

  function setBpm(bpm) {
    if (!st.seq) return;
    update(Object.assign({}, st.seq, { bpm }));
  }

  function stop() {
    st.token++;
    const was = st.playing;
    if (was) halt();
    else if (Odd.synth && st.ctx) Odd.synth.stopAll(); // silence ringing tails after an 'end'
    if (was) emit('stop');
  }

  function lastHit(track) {
    if (!st.ctx) return null;
    const t = st.ctx.currentTime - latency();
    const arr = st.hits[track];
    if (arr && arr.length) {
      let i = -1;
      while (i + 1 < arr.length && arr[i + 1].time <= t) i++;
      if (i >= 0) {
        st.lastHits[track] = arr[i];
        arr.splice(0, i + 1);
      }
    }
    return st.lastHits[track] || null;
  }

  function on(name, fn) {
    if (!listeners[name]) listeners[name] = [];
    listeners[name].push(fn);
  }

  function off(name, fn) {
    if (!listeners[name]) return;
    listeners[name] = listeners[name].filter((f) => f !== fn);
  }

  Odd.transport = {
    play,
    update,
    setTracks,
    setBpm,
    stop,
    position,
    lastHit,
    on,
    off,
    seq() { return st.seq; },
    get playing() { return st.playing; },
  };
})(globalThis.Odd = globalThis.Odd || {});
