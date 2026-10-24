/* Oddition — built-in synthesizer.
 *
 * Every sound is made with the Web Audio API: no samples, no network.
 * Graph per audio context:
 *
 *   voice -> track bus (fader, mute, pan) -> master -> compressor -> soft clip -> analyser -> out
 *                                  \-> reverb send / delay send -> master
 *
 * The same graph can be built on an OfflineAudioContext, so WAV renders sound
 * like live playback. Synth code always takes its context from the node it is
 * given, never from a global.
 */
(function (Odd) {
  'use strict';

  const W = typeof window !== 'undefined' ? window : null;
  const VOICE_CAP = 96;
  const VOICE_CAP_LIGHT = 40;
  const KILL_TC = 0.012;
  const DEFAULT_VOLUME = 0.85;

  // ---------------------------------------------------------------- patches

  const PATCHES = {
    'kit-acoustic': { label: 'Acoustic Kit', role: 'drums', gm: 0 },
    'kit-808': { label: '808 Kit', role: 'drums', gm: 0 },
    'kit-909': { label: '909 Kit', role: 'drums', gm: 0 },
    'kit-lofi': { label: 'Lo-fi Kit', role: 'drums', gm: 0 },
    'bass-sub': { label: 'Sub Bass', role: 'bass', gm: 38 },
    'bass-saw': { label: 'Saw Bass', role: 'bass', gm: 39 },
    'bass-808': { label: '808 Bass', role: 'bass', gm: 38 },
    'bass-pluck': { label: 'Pluck Bass', role: 'bass', gm: 33 },
    epiano: { label: 'E-Piano', role: 'chords', gm: 4 },
    keys: { label: 'Soft Keys', role: 'chords', gm: 0 },
    organ: { label: 'Organ', role: 'chords', gm: 16 },
    stab: { label: 'Synth Stab', role: 'chords', gm: 90 },
    'pad-warm': { label: 'Warm Pad', role: 'pad', gm: 89 },
    'pad-glass': { label: 'Glass Pad', role: 'pad', gm: 88 },
    strings: { label: 'Strings', role: 'pad', gm: 48 },
    'lead-square': { label: 'Square Lead', role: 'lead', gm: 80 },
    'lead-saw': { label: 'Saw Lead', role: 'lead', gm: 81 },
    'lead-soft': { label: 'Soft Lead', role: 'lead', gm: 73 },
    bell: { label: 'Bell', role: 'lead', gm: 11 },
    pluck: { label: 'Pluck', role: 'arp', gm: 45 },
  };

  // [reverb send, delay send]
  const SENDS = {
    'kit-acoustic': [0.14, 0], 'kit-808': [0.05, 0], 'kit-909': [0.06, 0], 'kit-lofi': [0.1, 0],
    'bass-sub': [0, 0], 'bass-saw': [0.03, 0], 'bass-808': [0, 0], 'bass-pluck': [0.05, 0],
    epiano: [0.25, 0.07], keys: [0.22, 0.04], organ: [0.16, 0], stab: [0.22, 0.12],
    'pad-warm': [0.42, 0.05], 'pad-glass': [0.5, 0.14], strings: [0.36, 0],
    'lead-square': [0.2, 0.16], 'lead-saw': [0.18, 0.14], 'lead-soft': [0.3, 0.18], bell: [0.4, 0.22],
    pluck: [0.26, 0.2],
  };

  function isKit(id) { return !!(PATCHES[id] && PATCHES[id].role === 'drums'); }

  function patchList(role) {
    const all = Object.keys(PATCHES).map((id) => ({ id, label: PATCHES[id].label, role: PATCHES[id].role }));
    if (!role) return all;
    return all.filter((p) => p.role === role).concat(all.filter((p) => p.role !== role));
  }

  // ---------------------------------------------------------------- helpers

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function mtof(p) { return 440 * Math.pow(2, (p - 69) / 12); }
  function velAmp(v) { return Math.pow(clamp(v, 1, 127) / 127, 1.6); }
  function pitchFactor(p) { return clamp(1.5 - (p - 48) / 40, 0.45, 1.5); }
  function relT(base, dur) { return Math.min(base, 0.04 + dur * 0.8); }
  function attT(base, dur) { return Math.min(base, Math.max(0.003, dur * 0.45)); }
  function nyq(f) { return clamp(f, 20, 18000); }
  /** the patch a track plays: its own if known, else the GM-drums kit on channel 10, else keys */
  function resolvePatch(tr) {
    const id = tr && tr.patch;
    if (id && PATCHES[id]) return id;
    return tr && tr.channel === 9 ? 'kit-acoustic' : 'keys';
  }

  function kRate(param) {
    try { if (param && 'automationRate' in param) param.automationRate = 'k-rate'; } catch (e) { /* fixed-rate param */ }
  }

  function lcg(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s / 4294967296) * 2 - 1;
    };
  }

  const curves = {};
  function curve(key, fn) {
    if (!curves[key]) {
      const n = 2048;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
      curves[key] = c;
    }
    return curves[key];
  }
  function driveCurve(k) { return curve('drive' + k, (x) => Math.tanh(k * x) / Math.tanh(k)); }
  function crushCurve() {
    return curve('crush', (x) => {
      const q = Math.round(x * 20) / 20;
      return (0.92 * Math.tanh(1.5 * (0.55 * x + 0.45 * q))) / Math.tanh(1.5);
    });
  }

  /** amplitude ADSR on a gain param; returns the time the sound is gone */
  function adsr(param, when, dur, peak, a, d, s, r) {
    a = Math.max(0.001, a);
    const hold = when + Math.max(dur, a + 0.004);
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(peak, when + a);
    if (s < 0.999) param.setTargetAtTime(peak * s, when + a, Math.max(0.004, d / 3));
    param.setTargetAtTime(0, hold, Math.max(0.004, r / 4));
    return hold + r * 1.7;
  }

  /** envelope for a filter cutoff (or any param) */
  function sweep(param, when, dur, base, peak, a, d, s, r) {
    a = Math.max(0.001, a);
    const hold = when + Math.max(dur, a + 0.004);
    if (a <= 0.006 && param.automationRate === 'k-rate') {
      // a control-rate param takes one value per 128 samples, so a ramp this
      // short would be skipped: open instantly, covering the first block too
      param.value = peak;
      param.setValueAtTime(peak, when);
    } else {
      param.setValueAtTime(base, when);
      param.linearRampToValueAtTime(peak, when + a);
    }
    param.setTargetAtTime(base + (peak - base) * s, when + a, Math.max(0.004, d / 3));
    param.setTargetAtTime(base, hold, Math.max(0.004, r / 3));
  }

  /** percussive envelope: fast attack, exponential decay; returns end time */
  function hit(param, when, peak, a, tc) {
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(peak, when + a);
    param.setTargetAtTime(0, when + a, tc);
    return when + a + tc * 7;
  }

  // ---------------------------------------------------------------- per-context graph

  const envs = new WeakMap();
  let realtime = null;
  let masterVolume = DEFAULT_VOLUME;
  let unlocked = false;

  /*
   * Sound quality for live playback: 'full' or 'light'. Phones can't keep up
   * with the full graph: their audio thread misses its deadline (crackle) and
   * some browsers then go silent. Light mode stacks fewer oscillators per
   * note, uses simpler hi-hats, a mono reverb, fewer voices at once and
   * control-rate filters, and asks for bigger output buffers. Offline renders
   * (WAV export) are not real-time, so they always use full quality unless
   * told otherwise.
   */
  let qualitySetting = 'auto';
  let quality = autoQuality();

  function autoQuality() {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : {};
      const ua = nav.userAgent || '';
      const touchMac = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1; // iPadOS reports as a Mac
      const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      const small = nav.deviceMemory && nav.deviceMemory <= 4;
      return coarse || touchMac || small || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ? 'light' : 'full';
    } catch (e) {
      return 'full';
    }
  }

  /** 'auto' | 'light' | 'full'. A realtime context built for the other quality is replaced on next ensure(). */
  function setQuality(q) {
    qualitySetting = q === 'light' || q === 'full' ? q : 'auto';
    quality = qualitySetting === 'auto' ? autoQuality() : qualitySetting;
    if (realtime) {
      const env = envs.get(realtime);
      if (env && env.light !== (quality === 'light')) restart();
    }
    return quality;
  }

  /** drop the realtime context; the next ensure() builds a fresh one */
  function restart() {
    const old = realtime;
    realtime = null;
    unlocked = false;
    Odd.audio.ctx = null;
    Odd.audio.analyser = null;
    if (old) {
      envs.delete(old);
      try { const p = old.close(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* already closed */ }
    }
  }

  function masterGainFor(v) { return 0.95 * v * v; }

  function offlineClass() { return W && (W.OfflineAudioContext || W.webkitOfflineAudioContext); }
  function isOfflineCtx(ctx) {
    const Off = offlineClass();
    return !!(Off && ctx instanceof Off);
  }

  function noiseBuf(env) {
    if (env.noise) return env.noise;
    const ctx = env.ctx;
    const len = Math.floor(ctx.sampleRate * 2);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = lcg(12345);
    for (let i = 0; i < len; i++) d[i] = r();
    env.noise = b;
    return b;
  }

  /**
   * mono reverb impulse: decaying, darkening noise plus a few early reflections.
   * The decay is shaped for `shapeSec` but the buffer stops at `sec`; what is
   * cut is below -56 dB, and convolution cost grows with buffer length.
   */
  function impulse(ctx, sec, shapeSec, channels) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * sec));
    const shapeLen = sr * (shapeSec || sec);
    const chans = channels || 2;
    const b = ctx.createBuffer(chans, len, sr);
    const fadeIn = Math.floor(sr * 0.004);
    const fadeOut = Math.floor(sr * 0.06);
    for (let ch = 0; ch < chans; ch++) {
      const d = b.getChannelData(ch);
      const r = lcg(777 + ch * 31); // different noise per side keeps the tail wide
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = Math.min(1, i / shapeLen);
        const env = Math.exp(-6.4 * t) * (1 - t) * (i < fadeIn ? i / fadeIn : 1) * Math.min(1, (len - i) / fadeOut);
        const alpha = 0.82 - 0.68 * t; // darker as it decays
        lp += alpha * (r() - lp);
        d[i] = lp * env;
      }
      const taps = [0.009, 0.015, 0.023, 0.031, 0.043, 0.057];
      taps.forEach((tt, j) => {
        const idx = Math.floor((tt + ch * 0.0037) * sr);
        if (idx < len) d[idx] += (j % 2 ? -1 : 1) * (0.42 - j * 0.05);
      });
    }
    return b;
  }

  function pulseWave(env, duty) {
    const key = 'pulse' + duty;
    if (env.waves[key]) return env.waves[key];
    const n = 48;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    env.waves[key] = env.ctx.createPeriodicWave(re, im);
    return env.waves[key];
  }

  // drawbars 8', 4', 2 2/3', 2', 1 1/3' as [ratio, weight]; the 16' sub is its own oscillator
  const ORGAN_PARTIALS = [[1, 1], [2, 0.55], [3, 0.3], [4, 0.22], [6, 0.1]];
  const ORGAN_TOP = 12000; // partials above this are left out, as on a real drawbar organ's top end

  /**
   * One wave per pitch band, holding only the partials below ORGAN_TOP.
   * Browsers scale a PeriodicWave to peak 1 (and some ignore
   * disableNormalization), so the true peak of the weighted sum is measured
   * here and applied as gain: the level is then the same in every browser.
   * Returns { wave, peak }.
   */
  function organWave(env, f) {
    const n = Math.max(1, ORGAN_PARTIALS.filter(([r]) => f * r <= ORGAN_TOP).length);
    const key = 'organ' + n;
    if (env.waves[key]) return env.waves[key];
    const used = ORGAN_PARTIALS.slice(0, n);
    const size = used[used.length - 1][0] + 1;
    const re = new Float32Array(size);
    const im = new Float32Array(size);
    for (const [r, wt] of used) im[r] = wt;
    let peak = 0;
    for (let i = 0; i < 4096; i++) {
      const th = (i / 4096) * 2 * Math.PI;
      let x = 0;
      for (const [r, wt] of used) x += wt * Math.sin(r * th);
      peak = Math.max(peak, Math.abs(x));
    }
    env.waves[key] = { wave: env.ctx.createPeriodicWave(re, im), peak };
    return env.waves[key];
  }

  /**
   * fx: { reverb, delay } (default both on). Offline renders leave out effects
   * no patch sends to: the echo's feedback loop and the convolver keep
   * processing long after the last note, which dominates render time.
   */
  function buildEnv(ctx, offline, fx, light) {
    fx = fx || {};
    const env = {
      ctx, offline: !!offline, light: !!light, buses: new Map(), inputs: new WeakMap(), voices: [],
      chokes: new WeakMap(), noise: null, waves: {}, rand: lcg(99),
    };
    const master = ctx.createGain();
    master.gain.value = masterGainFor(offline ? DEFAULT_VOLUME : masterVolume);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 16;
    comp.ratio.value = 2.2;
    comp.attack.value = 0.012;
    comp.release.value = 0.22;
    const pre = ctx.createGain();
    pre.gain.value = 0.5;
    const clip = ctx.createWaveShaper();
    clip.curve = curve('softclip', (x) => 0.98 * Math.tanh(2 * x));
    clip.oversample = light ? 'none' : '2x';
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    master.connect(comp);
    comp.connect(pre);
    pre.connect(clip);
    clip.connect(analyser);
    analyser.connect(ctx.destination);

    // shared stereo reverb: each side is convolved with its own impulse, so
    // panned tracks keep their reverb level and side, and the tail stays
    // mono-compatible (no delayed copy of one side). The impulse is cut at
    // 1.7 s, where its 2.2 s decay is already below -56 dB. Light mode uses
    // one mono convolution (half the work), heard equally on both sides.
    const revIn = ctx.createGain();
    if (light) {
      revIn.channelCount = 1;
      revIn.channelCountMode = 'explicit';
    }
    if (fx.reverb !== false) {
      const revHp = ctx.createBiquadFilter();
      revHp.type = 'highpass';
      revHp.frequency.value = 200;
      const preDelay = ctx.createDelay(0.2);
      preDelay.delayTime.value = 0.02;
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.7, 2.2, light ? 1 : 2);
      const revOut = ctx.createGain();
      revOut.gain.value = 0.7;
      revIn.connect(revHp);
      revHp.connect(preDelay);
      preDelay.connect(conv);
      conv.connect(revOut);
      revOut.connect(master);
    }

    // tempo-free stereo echo
    const delIn = ctx.createGain();
    if (fx.delay !== false) {
      const delOut = ctx.createGain();
      delOut.gain.value = 0.5;
      [[0.27, -0.55], [0.39, 0.55]].forEach(([time, panv]) => {
        const d = ctx.createDelay(1.5);
        d.delayTime.value = time;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        const fb = ctx.createGain();
        fb.gain.value = 0.34;
        delIn.connect(d);
        d.connect(lp);
        lp.connect(fb);
        fb.connect(d);
        if (ctx.createStereoPanner) {
          const p = ctx.createStereoPanner();
          p.pan.value = panv;
          lp.connect(p);
          p.connect(delOut);
        } else {
          lp.connect(delOut);
        }
      });
      delOut.connect(master);
    }

    Object.assign(env, { master, comp, analyser, revIn, delIn });
    envs.set(ctx, env);
    return env;
  }

  function envFor(ctx) { return envs.get(ctx) || buildEnv(ctx, isOfflineCtx(ctx)); }

  function realtimeCtx() {
    if (realtime) return realtime;
    const C = W && (W.AudioContext || W.webkitAudioContext);
    if (!C) throw new Error('Web Audio is not available in this browser.');
    // light mode asks for bigger output buffers: more headroom for the audio
    // thread on slow devices, at the cost of a little more latency
    const light = quality === 'light';
    try { realtime = new C({ latencyHint: light ? 'playback' : 'interactive' }); } catch (e) { realtime = new C(); }
    const env = buildEnv(realtime, false, null, light);
    Odd.audio.ctx = realtime;
    Odd.audio.analyser = env.analyser;
    return realtime;
  }

  function setParam(ctx, param, value) {
    if (isOfflineCtx(ctx) || ctx.currentTime === 0) {
      param.cancelScheduledValues(0);
      param.setValueAtTime(value, 0);
    } else {
      param.cancelScheduledValues(ctx.currentTime);
      param.setTargetAtTime(value, ctx.currentTime, 0.02);
    }
  }

  // ---------------------------------------------------------------- buses

  function makeBus(env, key) {
    const ctx = env.ctx;
    const input = ctx.createGain();
    const fader = ctx.createGain();
    const muteG = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const rev = ctx.createGain();
    const del = ctx.createGain();
    rev.gain.value = 0;
    del.gain.value = 0;
    input.connect(fader);
    fader.connect(muteG);
    let out = muteG;
    if (pan) { muteG.connect(pan); out = pan; }
    out.connect(env.master);
    out.connect(rev);
    rev.connect(env.revIn);
    out.connect(del);
    del.connect(env.delIn);
    const bus = {
      key, input, volume: 1, muted: false, patch: null,
      setVolume(v) {
        bus.volume = clamp(Number(v) || 0, 0, 1.5);
        setParam(ctx, fader.gain, bus.volume * bus.volume);
      },
      setMute(m) {
        bus.muted = !!m;
        setParam(ctx, muteG.gain, bus.muted ? 0 : 1);
      },
      setPan(x) { if (pan) setParam(ctx, pan.pan, clamp(Number(x) || 0, -1, 1)); },
      setSends(r, d) {
        setParam(ctx, rev.gain, r);
        setParam(ctx, del.gain, d);
      },
      dispose() {
        [input, fader, muteG, pan, rev, del].forEach((n) => { if (n) try { n.disconnect(); } catch (e) { /* gone */ } });
        env.buses.delete(key);
      },
    };
    env.inputs.set(input, bus);
    env.buses.set(key, bus);
    return bus;
  }

  function bus(key, ctxOrDest) {
    let ctx;
    if (ctxOrDest && typeof ctxOrDest.createGain === 'function') ctx = ctxOrDest;
    else if (ctxOrDest && ctxOrDest.context) ctx = ctxOrDest.context;
    else ctx = realtimeCtx();
    const env = envFor(ctx);
    const k = String(key);
    return env.buses.get(k) || makeBus(env, k);
  }

  // ---------------------------------------------------------------- voices

  function newVoice(env, dest, when) {
    const kill = env.ctx.createGain();
    kill.gain.value = 1;
    kill.connect(dest);
    const v = { env, start: when, end: when + 1, kill, sources: [], nodes: [kill], done: false };
    v.stop = function (t) { stopVoice(v, t); };
    return v;
  }

  function stopVoice(v, t) {
    if (v.done) return;
    const ctx = v.env.ctx;
    const at = Math.max(t == null ? ctx.currentTime : t, ctx.currentTime);
    if (at >= v.end) return;
    let e;
    if (at <= v.start) {
      e = v.start; // never sounds
    } else {
      v.kill.gain.cancelScheduledValues(at);
      v.kill.gain.setTargetAtTime(0, at, KILL_TC);
      e = at + KILL_TC * 7;
    }
    for (const s of v.sources) {
      try { s.stop(s._end != null ? Math.min(s._end, e) : e); } catch (err) { /* already stopped */ }
    }
    v.end = e;
  }

  function finishVoice(v, end) {
    v.end = end;
    let left = v.sources.length;
    const done = () => {
      if (--left > 0) return;
      v.done = true;
      for (const n of v.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } }
    };
    for (const s of v.sources) {
      s.onended = done;
      s.stop(s._end != null ? Math.min(s._end, end) : end);
    }
    if (!left) v.done = true;
  }

  function register(env, v) {
    const pruneT = env.offline ? v.start : env.ctx.currentTime;
    env.voices = env.voices.filter((x) => !x.done && x.end > pruneT);
    const active = env.voices.filter((x) => x.start <= v.start && x.end > v.start);
    const cap = env.light ? VOICE_CAP_LIGHT : VOICE_CAP;
    while (active.length >= cap) active.shift().stop(v.start);
    env.voices.push(v);
  }

  /** node factory bound to one voice; everything it makes is cleaned up with the voice */
  function tools(env, v) {
    const ctx = env.ctx;
    const k = {
      /** light mode: builders leave out layers that cost more than they add on a phone */
      light: env.light,
      osc(type, f, when) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(nyq(f), when);
        o.start(when);
        v.sources.push(o);
        v.nodes.push(o);
        return o;
      },
      wave(pw, f, when) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(pw);
        o.frequency.setValueAtTime(nyq(f), when);
        o.start(when);
        v.sources.push(o);
        v.nodes.push(o);
        return o;
      },
      noise(when, len) {
        const s = ctx.createBufferSource();
        s.buffer = noiseBuf(env);
        s.loop = true;
        s.start(when, (env.rand() + 1) * 0.7);
        if (len) s._end = when + len;
        v.sources.push(s);
        v.nodes.push(s);
        return s;
      },
      gain(val) {
        const g = ctx.createGain();
        g.gain.value = val;
        v.nodes.push(g);
        return g;
      },
      filter(type, f, q) {
        const b = ctx.createBiquadFilter();
        b.type = type;
        const res = q == null ? 0.7 : q;
        // Per-sample coefficient updates are the biggest per-voice cost, and on
        // gentle filters a cutoff that moves once per 128 samples is inaudible.
        // Resonant filters (Q >= 2) stay per-sample: stepping a swept cutoff
        // there makes zipper noise.
        if (res < 2 || env.light) {
          kRate(b.frequency);
          kRate(b.Q);
          kRate(b.gain);
        }
        b.frequency.value = nyq(f);
        b.Q.value = res;
        v.nodes.push(b);
        return b;
      },
      shaper(c) {
        const s = ctx.createWaveShaper();
        s.curve = c;
        v.nodes.push(s);
        return s;
      },
      /**
       * LFO into params; depth fades in after `delay` over `ramp` seconds.
       * Targets run at control rate, which is cheap and inaudible for vibrato
       * and slow filter sweeps. Pass `smooth` for amplitude (gain) targets:
       * stepping a gain every 128 samples buzzes.
       */
      lfo(rate, depth, targets, when, delay, ramp, smooth) {
        const o = k.osc('sine', rate, when);
        const g = k.gain(0);
        g.gain.setValueAtTime(0, when);
        g.gain.setValueAtTime(0, when + (delay || 0));
        g.gain.linearRampToValueAtTime(depth, when + (delay || 0) + (ramp || 0.01));
        o.connect(g);
        targets.forEach((t) => { if (!smooth) kRate(t); g.connect(t); });
        return o;
      },
    };
    return k;
  }

  // ---------------------------------------------------------------- pitched patches
  // builder(k, v, f, amp, vel, when, dur, pitch) -> end time

  const BUILD = {
    'bass-sub'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const drv = k.shaper(driveCurve(1.6));
      const lp = k.filter('lowpass', Math.min(1200, 300 + f * 6), 0.4);
      k.osc('sine', f, w).connect(k.gain(0.62)).connect(drv);
      k.osc('triangle', f, w).connect(k.gain(0.14)).connect(drv);
      if (!k.light) k.osc('sine', f * 2, w).connect(k.gain(0.07)).connect(drv);
      drv.connect(lp).connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.6 * amp, 0.006, 0.4, 0.85, relT(0.09, dur));
    },
    'bass-saw'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', 300, 8);
      const mix = k.gain(k.light ? 0.52 : 0.3);
      mix.connect(lp);
      k.osc('sawtooth', f, w).connect(mix);
      if (!k.light) {
        const o2 = k.osc('sawtooth', f, w);
        o2.detune.value = 8;
        o2.connect(mix);
      }
      k.osc('square', f / 2, w).connect(k.gain(0.16)).connect(lp);
      sweep(lp.frequency, w, dur, nyq(160 + f * 1.5), nyq(450 + 3200 * vel), 0.004, 0.22, 0.15, 0.08);
      lp.connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.75 * amp, 0.004, 0.25, 0.75, relT(0.07, dur));
    },
    'bass-808'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const o = k.osc('sine', f * 2.2, w);
      o.frequency.exponentialRampToValueAtTime(nyq(f), w + 0.06);
      const pre = k.gain(0.75);
      const sh = k.shaper(driveCurve(2.4));
      const lp = k.filter('lowpass', 1800 + 2000 * vel, 0.3);
      o.connect(vca).connect(pre).connect(sh).connect(lp).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.9 * amp, 0.003, 2.0, 0, relT(0.12, dur));
    },
    'bass-pluck'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', 400, 2);
      k.osc('triangle', f, w).connect(k.gain(0.5)).connect(lp);
      k.osc('sawtooth', f, w).connect(k.gain(0.18)).connect(lp);
      sweep(lp.frequency, w, dur, nyq(220 + f), nyq(700 + 2600 * vel), 0.002, 0.15, 0.1, 0.06);
      lp.connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.95 * amp, 0.002, 0.45, 0.25, relT(0.08, dur));
    },
    epiano(k, v, f, amp, vel, w, dur, p) {
      const vca = k.gain(0);
      const car = k.osc('sine', f, w);
      const mod = k.osc('sine', f, w);
      const mg = k.gain(0);
      mod.connect(mg).connect(car.frequency);
      mg.gain.setValueAtTime(f * (1.1 + 2.4 * vel), w);
      mg.gain.setTargetAtTime(f * 0.18, w + 0.005, 0.35);
      const tine = k.osc('sine', f * 14, w);
      tine._end = w + 0.25; // its envelope is silent by then; don't run it for the whole note
      const tg = k.gain(0);
      tine.connect(tg).connect(car.frequency);
      tg.gain.setValueAtTime(f * 0.9 * vel, w);
      tg.gain.setTargetAtTime(0, w + 0.002, 0.025);
      car.connect(k.gain(k.light ? 0.82 : 0.75)).connect(vca);
      if (!k.light) {
        const body = k.osc('sine', f, w);
        body.detune.value = 5;
        body.connect(k.gain(0.3)).connect(vca);
      }
      vca.connect(v.kill);
      const pf = pitchFactor(p);
      return adsr(vca.gain, w, dur, 0.32 * amp, 0.002, 2.6 * pf, 0.15, relT(0.28, dur));
    },
    keys(k, v, f, amp, vel, w, dur, p) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', 1000, 0.5);
      k.osc('triangle', f, w).connect(k.gain(k.light ? 0.62 : 0.5)).connect(lp);
      if (!k.light) {
        const o2 = k.osc('triangle', f, w);
        o2.detune.value = 7;
        o2.connect(k.gain(0.22)).connect(lp);
        k.osc('sine', f * 3, w).connect(k.gain(0.05)).connect(lp);
      }
      k.osc('sine', f * 2, w).connect(k.gain(0.16)).connect(lp);
      const pf = pitchFactor(p);
      sweep(lp.frequency, w, dur, nyq(700 + f * 1.5), nyq(1800 + 6500 * vel), 0.002, 0.7 * pf, 0.25, 0.2);
      if (!k.light) {
        const hb = k.filter('bandpass', 2400, 1);
        const hg = k.gain(0);
        hit(hg.gain, w, 0.06 * vel, 0.001, 0.006);
        k.noise(w, 0.06).connect(hb).connect(hg).connect(vca);
      }
      lp.connect(vca);
      vca.connect(v.kill);
      return adsr(vca.gain, w, dur, 0.4 * amp, 0.002, 3.2 * pf, 0, relT(0.2, dur));
    },
    organ(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      // drawbars in one wave (see organWave), plus the 16' sub
      const ow = organWave(v.env, f);
      const bars = k.wave(ow.wave, f, w);
      const sub = k.osc('sine', f * 0.5, w);
      bars.connect(k.gain(0.12 * ow.peak)).connect(vca);
      sub.connect(k.gain(0.42 * 0.12)).connect(vca);
      k.lfo(6.2, 9, [bars.detune, sub.detune], w, 0, 0.2);
      if (!k.light) {
        const hp = k.filter('highpass', 3000, 0.7);
        const cg = k.gain(0);
        hit(cg.gain, w, 0.05 * vel, 0.001, 0.004);
        k.noise(w, 0.04).connect(hp).connect(cg).connect(vca);
      }
      vca.connect(v.kill);
      return adsr(vca.gain, w, dur, amp, 0.008, 0.1, 1, relT(0.07, dur));
    },
    stab(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', 800, 3);
      const mix = k.gain(k.light ? 0.28 : 0.2);
      mix.connect(lp);
      (k.light ? [-12, 12] : [-14, 0, 13]).forEach((dt) => {
        const o = k.osc('sawtooth', f, w);
        o.detune.value = dt;
        o.connect(mix);
      });
      k.osc('sawtooth', f * 2, w).connect(k.gain(0.08)).connect(lp);
      sweep(lp.frequency, w, dur, nyq(500 + f), nyq(2500 + 7000 * vel), 0.002, 0.16, 0.12, 0.08);
      lp.connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.75 * amp, 0.002, 0.24, 0.2, relT(0.1, dur));
    },
    'pad-warm'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', 600, 1.2);
      const mix = k.gain(k.light ? 0.245 : 0.2);
      mix.connect(lp);
      (k.light ? [-10, 10] : [-11, 0, 10]).forEach((dt) => {
        const o = k.osc('sawtooth', f, w);
        o.detune.value = dt;
        o.connect(mix);
      });
      k.osc('triangle', f / 2, w).connect(k.gain(0.16)).connect(lp);
      const cutoff = Math.min(3000, 450 + f * 0.9 + 900 * vel);
      const a = attT(0.6, dur);
      lp.frequency.setValueAtTime(cutoff * 0.5, w);
      lp.frequency.linearRampToValueAtTime(cutoff, w + a * 1.5);
      k.lfo(0.17, cutoff * 0.25, [lp.frequency], w, 0, 0.5);
      lp.connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.38 * amp, a, 1.2, 0.85, relT(1.4, dur));
    },
    'pad-glass'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const hp = k.filter('highpass', 180, 0.5);
      const trem = k.gain(k.light ? 1.1 : 1);
      k.osc('sine', f, w).connect(k.gain(0.32)).connect(trem);
      const o2 = k.osc('triangle', f, w);
      o2.detune.value = 7;
      o2.connect(k.gain(0.22)).connect(trem);
      if (!k.light) {
        const o3 = k.osc('sine', f * 2, w);
        o3.detune.value = -6;
        o3.connect(k.gain(0.12)).connect(trem);
        k.osc('triangle', f * 3, w).connect(k.gain(0.04)).connect(trem);
      }
      k.lfo(4.2, 0.1, [trem.gain], w, 0.2, 0.6, true);
      trem.connect(hp).connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.34 * amp, attT(0.4, dur), 1.5, 0.8, relT(1.6, dur));
    },
    strings(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', Math.min(9000, 1500 + 3000 * vel + f), 0.5);
      const hp = k.filter('highpass', 150, 0.5);
      const mix = k.gain(k.light ? 0.226 : 0.16);
      mix.connect(lp);
      const oscs = (k.light ? [-12, 11] : [-16, -5, 6, 15]).map((dt) => {
        const o = k.osc('sawtooth', f, w);
        o.detune.value = dt;
        o.connect(mix);
        return o;
      });
      k.lfo(5.3, 11, oscs.map((o) => o.detune), w, 0.3, 0.5);
      lp.connect(hp).connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.4 * amp, attT(0.3, dur), 0.6, 0.9, relT(0.6, dur));
    },
    'lead-square'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', Math.min(12000, 2000 + 4000 * vel + f * 2), 1);
      const o = k.wave(pulseWave(v.env, 0.3), f, w);
      const s = k.osc('square', f / 2, w);
      o.connect(k.gain(0.5)).connect(lp);
      s.connect(k.gain(0.08)).connect(lp);
      k.lfo(5.6, 16, [o.detune, s.detune], w, 0.22, 0.35);
      lp.connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.52 * amp, 0.006, 0.25, 0.75, relT(0.14, dur));
    },
    'lead-saw'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', 1400, 4);
      const o1 = k.osc('sawtooth', f, w);
      const o2 = k.osc('sawtooth', f, w);
      o1.detune.value = -6;
      o2.detune.value = 6;
      const mix = k.gain(0.26);
      mix.connect(lp);
      o1.connect(mix);
      o2.connect(mix);
      sweep(lp.frequency, w, dur, nyq(1000 + f), nyq(1800 + 5000 * vel + f * 2), 0.005, 0.3, 0.35, 0.12);
      k.lfo(5.5, 12, [o1.detune, o2.detune], w, 0.25, 0.35);
      lp.connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.62 * amp, 0.005, 0.3, 0.8, relT(0.14, dur));
    },
    'lead-soft'(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const o1 = k.osc('sine', f, w);
      const o2 = k.osc('triangle', f, w);
      o1.connect(k.gain(0.42)).connect(vca);
      o2.connect(k.gain(0.14)).connect(vca);
      const vib = [o1.detune, o2.detune];
      const r = relT(0.16, dur);
      if (!k.light) {
        const o3 = k.osc('sine', f * 2, w);
        o3.connect(k.gain(0.05)).connect(vca);
        vib.push(o3.detune);
        const hold = w + Math.max(dur, 0.03);
        const bp = k.filter('bandpass', Math.min(f * 2.2, 12000), 1.4);
        const bg = k.gain(0);
        bg.gain.setValueAtTime(0, w);
        bg.gain.linearRampToValueAtTime(0.16 * vel, w + 0.02);
        bg.gain.setTargetAtTime(0.035 * vel, w + 0.02, 0.08);
        bg.gain.setTargetAtTime(0, hold, r / 4);
        k.noise(w).connect(bp).connect(bg).connect(vca);
      }
      k.lfo(5, 10, vib, w, 0.3, 0.4);
      vca.connect(v.kill);
      return adsr(vca.gain, w, dur, 0.55 * amp, attT(0.045, dur), 0.2, 0.85, r);
    },
    bell(k, v, f, amp, vel, w, dur, p) {
      const vca = k.gain(0);
      const pf = pitchFactor(p);
      const car = k.osc('sine', f, w);
      const mod = k.osc('sine', f * 3.5, w);
      const mg = k.gain(0);
      mod.connect(mg).connect(car.frequency);
      mg.gain.setValueAtTime(f * (1.2 + 2.2 * vel), w);
      mg.gain.setTargetAtTime(f * 0.05, w + 0.002, 0.45 * pf);
      const car2 = k.osc('sine', f * 2.76, w);
      const g2 = k.gain(0);
      hit(g2.gain, w, 0.12, 0.002, 0.4 * pf);
      car.connect(k.gain(0.7)).connect(vca);
      car2.connect(g2).connect(vca);
      vca.connect(v.kill);
      return adsr(vca.gain, w, dur, 0.45 * amp, 0.002, 3.2 * pf, 0, Math.max(0.35, relT(0.9, dur)));
    },
    pluck(k, v, f, amp, vel, w, dur) {
      const vca = k.gain(0);
      const lp = k.filter('lowpass', 300, 5);
      k.osc('sawtooth', f, w).connect(k.gain(0.3)).connect(lp);
      const sq = k.osc('square', f, w);
      sq.detune.value = -6;
      sq.connect(k.gain(0.12)).connect(lp);
      sweep(lp.frequency, w, dur, nyq(200 + f * 0.6), nyq(900 + 6000 * vel + f * 2), 0.001, 0.14, 0, 0.1);
      if (!k.light) {
        const hp = k.filter('highpass', 4000, 0.7);
        const ng = k.gain(0);
        hit(ng.gain, w, 0.05 * vel, 0.0005, 0.004);
        k.noise(w, 0.03).connect(hp).connect(ng).connect(vca);
      }
      lp.connect(vca).connect(v.kill);
      return adsr(vca.gain, w, dur, 0.8 * amp, 0.001, 0.45, 0, relT(0.1, dur));
    },
  };

  // ---------------------------------------------------------------- drum kits

  const KITS = {
    'kit-acoustic': {
      kick: { f0: 125, f1: 52, pd: 0.075, dec: 0.12, click: 0.32, drive: 1.2, lvl: 1 },
      snare: { tone: 185, tone2: 0, tDec: 0.06, nDec: 0.075, hp: 1300, bp: 3200, tMix: 0.42, nMix: 0.9 },
      hat: { type: 'noise', hp: 7200, bp: 10500, tune: 1, cDec: 0.022, oDec: 0.13, lvl: 0.7 },
      tom: { dec: 0.17, tune: 1, tri: 0.3 }, cym: { dec: 0.6, tune: 1 }, clap: { bp: 1150, dec: 0.06 },
      lp: 0, crush: 0,
    },
    'kit-808': {
      kick: { f0: 150, f1: 46, pd: 0.045, dec: 0.36, click: 0.06, drive: 1.4, lvl: 1 },
      snare: { tone: 238, tone2: 476, tDec: 0.045, nDec: 0.06, hp: 1900, bp: 0, tMix: 0.45, nMix: 0.6 },
      hat: { type: 'metal', hp: 7500, bp: 10000, tune: 1, cDec: 0.02, oDec: 0.12, lvl: 1.1 },
      tom: { dec: 0.28, tune: 0.92, tri: 0 }, cym: { dec: 0.55, tune: 1.05 }, clap: { bp: 1050, dec: 0.08 },
      lp: 0, crush: 0,
    },
    'kit-909': {
      kick: { f0: 330, f1: 54, pd: 0.032, dec: 0.15, click: 0.55, drive: 2.2, lvl: 0.95 },
      snare: { tone: 200, tone2: 0, tDec: 0.05, nDec: 0.1, hp: 1100, bp: 0, tMix: 0.38, nMix: 0.7 },
      hat: { type: 'mix', hp: 8000, bp: 11000, tune: 1.12, cDec: 0.018, oDec: 0.1, lvl: 0.9 },
      tom: { dec: 0.19, tune: 1.05, tri: 0.15 }, cym: { dec: 0.5, tune: 1.15 }, clap: { bp: 1300, dec: 0.07 },
      lp: 0, crush: 0,
    },
    'kit-lofi': {
      kick: { f0: 105, f1: 50, pd: 0.06, dec: 0.14, click: 0.12, drive: 1.3, lvl: 1 },
      snare: { tone: 175, tone2: 0, tDec: 0.06, nDec: 0.07, hp: 900, bp: 2200, tMix: 0.48, nMix: 0.85 },
      hat: { type: 'noise', hp: 6000, bp: 8000, tune: 1, cDec: 0.02, oDec: 0.1, lvl: 0.75 },
      tom: { dec: 0.15, tune: 0.95, tri: 0.25 }, cym: { dec: 0.45, tune: 0.9 }, clap: { bp: 1000, dec: 0.06 },
      lp: 5500, crush: 1,
    },
  };

  const METAL = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const METAL_LIGHT = [2, 4.16, 6.79];
  const TOMS = { 41: 82, 43: 97, 45: 110, 47: 130, 48: 147, 50: 174 };
  const HAND = { 60: [440, 0.07], 61: [330, 0.09], 62: [290, 0.035], 63: [260, 0.12], 64: [180, 0.16] };

  function metal(k, base, w, dest, level) {
    const ratios = k.light ? METAL_LIGHT : METAL;
    const g = k.gain(level / Math.sqrt(6 * ratios.length)); // same loudness with fewer squares
    ratios.forEach((r) => k.osc('square', base * r, w).connect(g));
    g.connect(dest);
    return g;
  }

  function dKick(k, P, out, amp, w, tune) {
    const o = k.osc('sine', P.f0 * tune, w);
    o.frequency.exponentialRampToValueAtTime(P.f1 * tune, w + P.pd);
    o.frequency.exponentialRampToValueAtTime(P.f1 * tune * 0.9, w + P.pd + P.dec * 4);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, w);
    g.gain.linearRampToValueAtTime(amp * P.lvl * 0.9, w + 0.0025);
    g.gain.setTargetAtTime(0, w + 0.012, P.dec);
    o.connect(g);
    if (P.drive) g.connect(k.shaper(driveCurve(P.drive))).connect(out);
    else g.connect(out);
    if (P.click) {
      const hp = k.filter('highpass', 2500, 0.7);
      const cg = k.gain(0);
      hit(cg.gain, w, amp * P.click * 0.5, 0.0005, 0.004);
      k.noise(w, 0.04).connect(hp).connect(cg).connect(out);
    }
    return w + 0.012 + P.dec * 6.5;
  }

  function dSnare(k, P, out, amp, w, bright, alt) {
    const tone = P.tone * (alt ? 1.08 : 1);
    const o = k.osc('triangle', tone * 1.25, w);
    o.frequency.exponentialRampToValueAtTime(tone, w + 0.025);
    const tg = k.gain(0);
    hit(tg.gain, w, amp * P.tMix, 0.002, P.tDec);
    o.connect(tg).connect(out);
    if (P.tone2) {
      const o2 = k.osc('sine', P.tone2, w);
      const g2 = k.gain(0);
      hit(g2.gain, w, amp * P.tMix * 0.5, 0.002, P.tDec * 0.8);
      o2.connect(g2).connect(out);
    }
    const hp = k.filter('highpass', P.hp * (alt ? 1.3 : 1), 0.7);
    let chain = k.noise(w).connect(hp);
    if (P.bp) {
      const body = k.filter('peaking', P.bp, 0.8);
      body.gain.value = 5;
      chain = chain.connect(body);
    }
    const ng = k.gain(0);
    hit(ng.gain, w, amp * P.nMix * bright, 0.0015, P.nDec * (alt ? 0.8 : 1));
    chain.connect(ng).connect(out);
    return w + 0.004 + Math.max(P.tDec, P.nDec) * 7;
  }

  function dClap(k, P, out, amp, w) {
    const hp = k.filter('highpass', 500, 0.5);
    const bp = k.filter('bandpass', P.bp, 1.1);
    const g = k.gain(0);
    const pk = amp * 2.2;
    g.gain.setValueAtTime(0, w);
    let t = w;
    for (let i = 0; i < 3; i++) {
      g.gain.linearRampToValueAtTime(pk, t + 0.0012);
      g.gain.linearRampToValueAtTime(pk * 0.12, t + 0.0085);
      t += 0.0095;
    }
    g.gain.linearRampToValueAtTime(pk, t + 0.0012);
    g.gain.setTargetAtTime(0, t + 0.0015, P.dec);
    k.noise(w).connect(hp).connect(bp).connect(g).connect(out);
    return t + P.dec * 7;
  }

  function dHat(k, P, out, amp, w, dec, bright) {
    const g = k.gain(0);
    const end = hit(g.gain, w, amp * P.lvl * bright, 0.001, dec);
    const hp = k.filter('highpass', P.hp, 0.6);
    hp.connect(g).connect(out);
    if (P.type !== 'metal') k.noise(w).connect(k.gain(P.type === 'mix' ? 0.55 : 1)).connect(hp);
    if (P.type !== 'noise') {
      // six detuned squares (808 style) with a presence lift near P.bp
      const lift = k.filter('peaking', P.bp, 0.9);
      lift.gain.value = 6;
      metal(k, 100 * P.tune, w, lift, P.type === 'mix' ? 0.5 : 2.2);
      lift.connect(hp);
    }
    return end;
  }

  function dTom(k, P, out, amp, w, note) {
    const f = TOMS[note] * P.tune;
    const o = k.osc('sine', f * 1.6, w);
    o.frequency.exponentialRampToValueAtTime(f, w + 0.06);
    const g = k.gain(0);
    const end = hit(g.gain, w, amp * 0.8, 0.002, P.dec);
    o.connect(g);
    if (P.tri && !k.light) {
      const t2 = k.osc('triangle', f * 2.4, w);
      t2.frequency.exponentialRampToValueAtTime(f * 1.5, w + 0.06);
      t2.connect(k.gain(P.tri)).connect(g);
    }
    const bp = k.filter('bandpass', f * 6, 1);
    const ng = k.gain(0);
    hit(ng.gain, w, amp * 0.25, 0.001, 0.01);
    k.noise(w, 0.06).connect(bp).connect(ng).connect(out);
    g.connect(out);
    return end;
  }

  function dCrash(k, P, out, amp, w, note) {
    const alt = note === 57;
    const dec = P.dec * (alt ? 1.25 : 1);
    const g = k.gain(0);
    const end = hit(g.gain, w, amp * 0.5, 0.003, dec);
    const hp = k.filter('highpass', 4500, 0.5);
    k.noise(w).connect(k.gain(0.7)).connect(hp);
    const bp = k.filter('bandpass', 8000, 0.6);
    metal(k, 130 * P.tune * (alt ? 1.1 : 1), w, bp, 3);
    bp.connect(hp);
    hp.connect(g).connect(out);
    return end;
  }

  function dRide(k, P, out, amp, w, note) {
    const alt = note === 59;
    const g = k.gain(0);
    const end = hit(g.gain, w, amp * 0.4, 0.002, alt ? 0.4 : 0.32);
    const bp = k.filter('bandpass', 5200, 1.6);
    metal(k, 170 * P.tune * (alt ? 1.1 : 1), w, bp, 4);
    const hp = k.filter('highpass', 7000, 0.6);
    k.noise(w).connect(k.gain(0.3)).connect(hp).connect(g);
    bp.connect(g);
    g.connect(out);
    return end;
  }

  function dRideBell(k, P, out, amp, w) {
    const g = k.gain(0);
    const end = hit(g.gain, w, amp * 0.5, 0.001, 0.38);
    const bp = k.filter('bandpass', 2700, 2.5);
    metal(k, 105 * P.tune, w, bp, 3);
    bp.connect(g).connect(out);
    return end;
  }

  function dTamb(k, P, out, amp, w) {
    const g = k.gain(0);
    const pk = amp * 0.9;
    g.gain.setValueAtTime(0, w);
    g.gain.linearRampToValueAtTime(pk, w + 0.001);
    g.gain.linearRampToValueAtTime(pk * 0.3, w + 0.012);
    g.gain.linearRampToValueAtTime(pk * 0.7, w + 0.018);
    g.gain.setTargetAtTime(0, w + 0.02, 0.06);
    const hp = k.filter('highpass', 6500, 0.7);
    const bp = k.filter('bandpass', 9500, 0.8);
    k.noise(w).connect(hp);
    metal(k, 240, w, hp, 1);
    hp.connect(bp).connect(g).connect(out);
    return w + 0.02 + 0.06 * 7;
  }

  function dCowbell(k, P, out, amp, w) {
    const g = k.gain(0);
    const pk = amp * 0.5;
    g.gain.setValueAtTime(0, w);
    g.gain.linearRampToValueAtTime(pk, w + 0.001);
    g.gain.setTargetAtTime(pk * 0.3, w + 0.002, 0.012);
    g.gain.setTargetAtTime(0, w + 0.03, 0.09);
    const bp = k.filter('bandpass', 900, 1.3);
    k.osc('square', 540, w).connect(k.gain(0.5)).connect(bp);
    k.osc('square', 800, w).connect(k.gain(0.5)).connect(bp);
    bp.connect(g).connect(out);
    return w + 0.03 + 0.09 * 7;
  }

  function dShaker(k, P, out, amp, w, note) {
    const g = k.gain(0);
    g.gain.setValueAtTime(0, w);
    g.gain.linearRampToValueAtTime(amp * 0.45, w + 0.012);
    g.gain.setTargetAtTime(0, w + 0.014, 0.028);
    const hp = k.filter('highpass', note === 70 ? 6500 : 5000, 0.7);
    k.noise(w).connect(hp).connect(g).connect(out);
    return w + 0.014 + 0.028 * 7;
  }

  function dTone(k, out, type, f, amp, w, tc, drop) {
    const o = k.osc(type, f * (drop || 1), w);
    if (drop) o.frequency.exponentialRampToValueAtTime(f, w + 0.025);
    const g = k.gain(0);
    const end = hit(g.gain, w, amp, 0.001, tc);
    o.connect(g).connect(out);
    return end;
  }

  function dRim(k, P, out, amp, w) {
    const hp = k.filter('highpass', 600, 0.7);
    const e1 = dTone(k, hp, 'triangle', 1700, amp * 0.5, w, 0.01);
    hp.connect(out);
    dTone(k, out, 'sine', 480, amp * 0.3, w, 0.012);
    const bp = k.filter('bandpass', 2400, 2);
    const ng = k.gain(0);
    hit(ng.gain, w, amp * 0.6, 0.0005, 0.006);
    k.noise(w, 0.04).connect(bp).connect(ng).connect(out);
    return Math.max(e1, w + 0.1);
  }

  function dHand(k, P, out, amp, w, note) {
    const [f, tc] = HAND[note];
    const end = dTone(k, out, 'sine', f, amp * 0.7, w, tc, 1.25);
    if (note === 62 || note === 63) {
      const bp = k.filter('bandpass', 2000, 1.2);
      const ng = k.gain(0);
      hit(ng.gain, w, amp * (note === 62 ? 0.5 : 0.25), 0.0005, 0.008);
      k.noise(w, 0.05).connect(bp).connect(ng).connect(out);
    }
    return end;
  }

  function drum(env, v, kitId, note, vel, amp, w, dest) {
    const K = KITS[kitId] || KITS['kit-acoustic'];
    const k = tools(env, v);
    const out = k.gain(1);
    let tail = out;
    if (K.lp) tail = tail.connect(k.filter('lowpass', K.lp, 0.4));
    // light mode skips the per-hit crusher; a plain gain keeps the level it added
    if (K.crush) tail = tail.connect(k.light ? k.gain(1.3) : k.shaper(crushCurve()));
    tail.connect(v.kill);
    const bright = 0.6 + 0.4 * vel;

    switch (note) {
      case 35: return dKick(k, K.kick, out, amp, w, 0.88);
      case 36: return dKick(k, K.kick, out, amp, w, 1);
      case 37: return dRim(k, K, out, amp, w);
      case 38: return dSnare(k, K.snare, out, amp, w, bright, false);
      case 40: return dSnare(k, K.snare, out, amp, w, bright, true);
      case 39: return dClap(k, K.clap, out, amp, w);
      case 42:
      case 44: {
        const o = env.chokes.get(dest);
        if (o && !o.done && o.start < w && o.end > w) o.stop(w);
        const pedal = note === 44;
        return dHat(k, K.hat, out, amp * (pedal ? 0.55 : 1), w, K.hat.cDec * (pedal ? 0.7 : 1), bright);
      }
      case 46: {
        const end = dHat(k, K.hat, out, amp * 0.7, w, K.hat.oDec, bright);
        env.chokes.set(dest, v);
        return end;
      }
      case 41: case 43: case 45: case 47: case 48: case 50:
        return dTom(k, K.tom, out, amp, w, note);
      case 49: case 57: return dCrash(k, K.cym, out, amp, w, note);
      case 51: case 59: return dRide(k, K.cym, out, amp, w, note);
      case 53: return dRideBell(k, K.cym, out, amp, w);
      case 54: return dTamb(k, K, out, amp, w);
      case 56: return dCowbell(k, K, out, amp, w);
      case 69: case 70: return dShaker(k, K, out, amp, w, note);
      case 75: return dTone(k, out, 'sine', 2500, amp * 0.5, w, 0.022);
      case 76: return dTone(k, out, 'triangle', 1050, amp * 0.6, w, 0.028, 1.06);
      case 77: return dTone(k, out, 'triangle', 790, amp * 0.6, w, 0.028, 1.06);
      case 60: case 61: case 62: case 63: case 64: return dHand(k, K, out, amp, w, note);
      default: return dTone(k, out, 'sine', 1200, amp * 0.35, w, 0.01);
    }
  }

  // ---------------------------------------------------------------- play

  function play(patchId, pitch, velocity, when, dur, dest) {
    const ctx = dest ? dest.context : realtimeCtx();
    const env = envFor(ctx);
    if (!dest) dest = bus('__preview', ctx).input;
    const patch = PATCHES[patchId] ? patchId : 'keys';
    const b = env.inputs.get(dest);
    if (b && b.patch !== patch) {
      b.patch = patch;
      const s = SENDS[patch] || [0, 0];
      b.setSends(s[0], s[1]);
    }
    const w = Math.max(Number(when) || 0, ctx.currentTime);
    const d = Math.max(0.01, Number(dur) || 0.25);
    const vel = clamp((Number(velocity) || 100) / 127, 0.01, 1);
    const amp = velAmp(Number(velocity) || 100);
    const p = clamp(Math.round(Number(pitch) || 60), 0, 127);
    const v = newVoice(env, dest, w);
    let end;
    try {
      if (isKit(patch)) end = drum(env, v, patch, p, vel, amp, w, dest);
      else end = BUILD[patch](tools(env, v), v, mtof(p), amp, vel, w, d, p);
    } catch (err) {
      for (const n of v.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } }
      for (const s of v.sources) { try { s.stop(); } catch (e) { /* gone */ } }
      throw err;
    }
    finishVoice(v, end);
    register(env, v);
    return v;
  }

  function stopAll() {
    if (!realtime) return;
    const env = envs.get(realtime);
    if (!env) return;
    const now = realtime.currentTime;
    for (const v of env.voices) v.stop(now);
    env.voices = [];
  }

  let previewVoices = [];
  function preview(patchId) {
    return Odd.audio.ensure().then((ctx) => {
      previewVoices.forEach((v) => v.stop(ctx.currentTime));
      previewVoices = [];
      const P = PATCHES[patchId];
      if (!P) return;
      const b = bus('__preview', ctx);
      b.setVolume(0.9);
      b.setMute(false);
      const t0 = ctx.currentTime + 0.05;
      const notes = [];
      if (P.role === 'drums') {
        const s = 60 / 110 / 2;
        [[36, 0, 110], [42, 0, 80], [42, 1, 70], [38, 2, 105], [42, 2, 80], [42, 3, 70],
          [36, 4, 105], [42, 4, 80], [36, 5, 90], [42, 5, 70], [38, 6, 110], [46, 7, 80]]
          .forEach(([n, i, vv]) => notes.push([n, t0 + i * s, 0.1, vv]));
      } else if (P.role === 'bass') {
        [36, 36, 43, 46].forEach((n, i) => notes.push([n, t0 + i * 0.25, 0.22, 100]));
      } else if (P.role === 'chords' || P.role === 'pad') {
        [60, 64, 67, 71].forEach((n) => notes.push([n, t0, P.role === 'pad' ? 1.6 : 0.9, 90]));
      } else {
        [72, 74, 76, 79, 76, 74].forEach((n, i) => notes.push([n, t0 + i * 0.16, 0.15, 95]));
      }
      notes.forEach(([n, t, d, vv]) => previewVoices.push(play(patchId, n, vv, t, d, b.input)));
    });
  }

  // ---------------------------------------------------------------- Odd.audio

  function ensure() {
    let ctx;
    try { ctx = realtimeCtx(); } catch (e) { return Promise.reject(e); }
    if (!unlocked) {
      unlocked = true;
      try {
        // iOS: play a silent buffer inside the gesture to unlock output
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) { /* ignore */ }
    }
    if (ctx.state !== 'running' && ctx.resume) {
      const resumed = ctx.resume().then(() => ctx, () => ctx);
      const timeout = new Promise((res) => setTimeout(() => res(ctx), 1500));
      return Promise.race([resumed, timeout]);
    }
    return Promise.resolve(ctx);
  }

  function setMasterVolume(v) {
    masterVolume = clamp(Number(v) || 0, 0, 1);
    if (!realtime) return;
    const env = envs.get(realtime);
    if (env) setParam(realtime, env.master.gain, masterGainFor(masterVolume));
  }

  function renderOffline(seq, opts) {
    opts = opts || {};
    const Off = offlineClass();
    if (!Off) return Promise.reject(new Error('Offline audio rendering is not available in this browser.'));
    const ppq = (Odd.theory && Odd.theory.PPQ) || 480;
    const bpm = clamp(Number(seq.bpm) || 120, 20, 400);
    const spt = 60 / (bpm * ppq);
    const sr = opts.sampleRate || 44100;
    const tail = opts.tailSec == null ? 2 : opts.tailSec;
    const length = Number(seq.length) || 0;
    const lenSec = Math.max(0.05, length * spt) + Math.max(0, tail);
    const frames = Math.ceil(lenSec * sr);
    const ctx = new Off(2, frames, sr);
    const tracks = seq.tracks || {};
    const solo = Object.keys(tracks).some((k) => tracks[k] && tracks[k].solo);

    // Only audible notes become voices; muted tracks cost nothing.
    const audible = [];
    let wantRev = false;
    let wantDel = false;
    for (const e of seq.events || []) {
      if (length && e.t >= length) continue;
      const tr = tracks[e.track] || { volume: 1 };
      if (tr.mute || (solo && !tr.solo)) continue;
      if (tr.volume != null && !(tr.volume > 0)) continue;
      const patch = resolvePatch(tr);
      const sends = SENDS[patch] || [0, 0];
      if (sends[0] > 0) wantRev = true;
      if (sends[1] > 0) wantDel = true;
      audible.push({ e, tr, patch });
    }
    const env = buildEnv(ctx, true, { reverb: wantRev, delay: wantDel }, opts.quality === 'light');
    const buses = {};
    const notes = [];
    for (const { e, tr, patch } of audible) {
      let b = buses[e.track];
      if (!b) {
        b = buses[e.track] = makeBus(env, String(e.track));
        b.setVolume(tr.volume == null ? 1 : tr.volume);
        if (tr.pan != null) b.setPan(tr.pan);
      }
      notes.push({
        time: e.t * spt,
        dur: Math.max(0.01, (e.d || 1) * spt),
        patch,
        p: e.p,
        v: e.v,
        input: b.input,
      });
    }
    notes.sort((a, b) => a.time - b.time);

    // Voices are built a window at a time: the render suspends every WINDOW
    // seconds and the next stretch is scheduled. Unstarted nodes still cost
    // processing every render quantum, so building a whole song up front is
    // far slower than this.
    const WINDOW = 1;
    const AHEAD = 0.25;
    const signal = opts.signal || null; // { aborted }: stop adding voices, finish quickly
    let idx = 0;
    const feed = (until) => {
      if (signal && signal.aborted) { idx = notes.length; return; }
      while (idx < notes.length && notes[idx].time < until) {
        const n = notes[idx++];
        play(n.patch, n.p, n.v, n.time, n.dur, n.input);
      }
    };
    const incremental = typeof ctx.suspend === 'function';
    feed(incremental ? WINDOW + AHEAD : Infinity);

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (buf) => { if (!settled) { settled = true; resolve(buf); } };
      const fail = (err) => { if (!settled) { settled = true; reject(err); } };
      if (incremental) {
        let k = 1;
        const arm = () => {
          const at = k * WINDOW;
          if (idx >= notes.length || at * sr >= frames - 256) return;
          ctx.suspend(at).then(() => {
            feed(at + WINDOW + AHEAD);
            k++;
            arm();
            return ctx.resume();
          }).catch(fail);
        };
        arm();
      }
      ctx.oncomplete = (ev) => done(ev.renderedBuffer);
      const p = ctx.startRendering();
      if (p && typeof p.then === 'function') p.then(done, fail);
    });
  }

  function seqSeconds(seq) {
    const ppq = (Odd.theory && Odd.theory.PPQ) || 480;
    const bpm = clamp(Number(seq.bpm) || 120, 20, 400);
    return (Number(seq.length) || 0) * 60 / (bpm * ppq);
  }

  /**
   * How many offline renders to run at once. Each render holds its whole
   * output as 32-bit stereo floats until it is encoded, so the count is capped
   * by a memory budget as well as by cores. Phones and small-memory devices
   * get one at a time. navigator.deviceMemory is Chromium-only; elsewhere the
   * smaller budget applies.
   */
  function renderConcurrency(seqs, opts) {
    opts = opts || {};
    if (opts.concurrency) return Math.max(1, Math.floor(opts.concurrency));
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const mem = nav.deviceMemory;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (coarse || (mem && mem <= 4)) return 1;
    const cores = nav.hardwareConcurrency || 2;
    const sr = opts.sampleRate || 44100;
    const tail = opts.tailSec == null ? 2 : opts.tailSec;
    let sec = 0;
    for (const q of seqs || []) sec = Math.max(sec, seqSeconds(q) + tail);
    const bytes = Math.max(1, sec * sr * 2 * 4);
    const budget = (mem && mem >= 8 ? 512 : 256) * 1024 * 1024;
    return clamp(Math.floor(budget / bytes), 1, Math.min(3, Math.max(1, cores - 1)));
  }

  /**
   * Render several sequences a few at a time; each offline render runs on its
   * own audio thread, so this is much faster than one after another.
   * onEach(buffer, index) runs as each one finishes (it may be async); when
   * given, its return value is kept instead of the buffer, so big buffers can
   * be dropped early. opts: renderOffline options plus { concurrency }
   * (default: renderConcurrency). Jobs start heaviest first; results come back
   * in input order.
   *
   * If any job fails, no new jobs start, renders still running stop adding
   * voices and their results are dropped (onEach is not called for them), and
   * the promise rejects only once every render has stopped, so a caller can
   * safely start again right after.
   */
  function renderOfflineMany(seqs, opts, onEach) {
    opts = opts || {};
    const list = Array.from(seqs || []);
    const conc = Math.max(1, Math.min(list.length || 1, renderConcurrency(list, opts)));
    const results = new Array(list.length);
    // heaviest first, so the longest render (usually the full mix) is not left for last
    const order = list.map((q, i) => i)
      .sort((a, b) => ((list[b].events || []).length - (list[a].events || []).length) || a - b);
    const signal = { aborted: false };
    const jobOpts = Object.assign({}, opts, { signal });
    let error = null;
    let next = 0;
    const worker = async () => {
      while (next < order.length && !signal.aborted) {
        const i = order[next++];
        try {
          // looked up at call time so tests can stand in for the audio engine
          const buf = await Odd.audio.renderOffline(list[i], jobOpts);
          if (signal.aborted) break;
          results[i] = onEach ? await onEach(buf, i) : buf;
        } catch (err) {
          if (!signal.aborted) { signal.aborted = true; error = err; }
        }
      }
    };
    const workers = [];
    for (let i = 0; i < conc; i++) workers.push(worker());
    return Promise.all(workers).then(() => {
      if (error) throw error;
      return results;
    });
  }

  // ---------------------------------------------------------------- WAV

  const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  /** header + output array for a 16-bit stereo WAV of `buf` */
  function wavStart(buf) {
    const n = buf.length;
    const sr = buf.sampleRate;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const dataLen = n * 4;
    const out = new Uint8Array(44 + dataLen);
    const dv = new DataView(out.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) out[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF');
    dv.setUint32(4, 36 + dataLen, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 2, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * 4, true);
    dv.setUint16(32, 4, true);
    dv.setUint16(34, 16, true);
    str(36, 'data');
    dv.setUint32(40, dataLen, true);
    // WAV samples are little-endian: write them through a typed array when the
    // platform matches (much faster than DataView), else byte by byte
    const pcm = LITTLE_ENDIAN ? new Int16Array(out.buffer, 44, n * 2) : null;
    return { out, dv, pcm, L, R, n };
  }

  function toInt16(x) {
    if (!(x === x)) return 0; // NaN
    const s = x < -1 ? -1 : x > 1 ? 1 : x;
    return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }

  /** interleave frames [from, to) */
  function wavFill(w, from, to) {
    const { pcm, dv, L, R } = w;
    if (pcm) {
      for (let i = from; i < to; i++) {
        pcm[2 * i] = toInt16(L[i]);
        pcm[2 * i + 1] = toInt16(R[i]);
      }
    } else {
      for (let i = from; i < to; i++) {
        dv.setInt16(44 + 4 * i, toInt16(L[i]), true);
        dv.setInt16(46 + 4 * i, toInt16(R[i]), true);
      }
    }
  }

  function encodeWav(buf) {
    const w = wavStart(buf);
    wavFill(w, 0, w.n);
    return w.out;
  }

  // yield to the event loop without timer throttling (background tabs clamp setTimeout)
  function yieldTask() {
    return new Promise((resolve) => {
      if (typeof MessageChannel === 'undefined') { setTimeout(resolve, 0); return; }
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    });
  }

  /**
   * encodeWav in slices, yielding between them, so other offline renders
   * (which need the main thread at every scheduling window) and the UI keep
   * moving while a long file is encoded. Same bytes as encodeWav.
   */
  async function encodeWavAsync(buf, opts) {
    const slice = (opts && opts.slice) || 1 << 16;
    const w = wavStart(buf);
    for (let i = 0; i < w.n; i += slice) {
      wavFill(w, i, Math.min(w.n, i + slice));
      if (i + slice < w.n) await yieldTask();
    }
    return w.out;
  }

  Odd.audio = {
    ctx: null,
    analyser: null,
    ensure,
    now() { return realtime ? realtime.currentTime : 0; },
    setMasterVolume,
    getMasterVolume() { return masterVolume; },
    setQuality,
    get quality() { return quality; },
    get qualitySetting() { return qualitySetting; },
    restart,
    renderOffline,
    renderOfflineMany,
    renderConcurrency,
    encodeWav,
    encodeWavAsync,
  };

  Odd.synth = {
    PATCHES,
    SENDS,
    patchList,
    isKit,
    resolvePatch,
    play,
    bus,
    preview,
    stopAll,
  };
})(globalThis.Odd = globalThis.Odd || {});
