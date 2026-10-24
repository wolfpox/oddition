/* Oddition — piano-roll drawing on <canvas>. Colours come from CSS tokens so
 * both themes work. */
(function (Odd) {
  'use strict';
  const T = Odd.theory;

  const DRUM_ROWS = [
    { label: 'CRASH', notes: [49, 57, 55, 52] },
    { label: 'RIDE', notes: [51, 59, 53] },
    { label: 'OPEN HAT', notes: [46] },
    { label: 'HAT', notes: [42, 44] },
    { label: 'PERC', notes: [54, 56, 69, 70, 75, 76, 77, 60, 61, 62, 63, 64] },
    { label: 'TOM HI', notes: [50, 48] },
    { label: 'TOM LO', notes: [47, 45, 43, 41] },
    { label: 'RIM', notes: [37] },
    { label: 'CLAP', notes: [39] },
    { label: 'SNARE', notes: [38, 40] },
    { label: 'KICK', notes: [36, 35] },
  ];
  const DRUM_INDEX = {};
  DRUM_ROWS.forEach((r, i) => r.notes.forEach((n) => { DRUM_INDEX[n] = i; }));

  let tokenCache = null;
  function tokens() {
    if (tokenCache) return tokenCache;
    const cs = getComputedStyle(document.documentElement);
    const g = (k, f) => (cs.getPropertyValue(k).trim() || f);
    tokenCache = {
      screen: g('--screen', '#101216'),
      line: g('--line', '#2e3340'),
      grid: g('--grid', 'rgba(255,255,255,0.05)'),
      faint: g('--faint', '#626879'),
      muted: g('--muted', '#959aa8'),
      ink: g('--ink', '#ecebe6'),
      tally: g('--tally', '#ff5b4e'),
      black: g('--roll-black', 'rgba(0,0,0,0.18)'),
      mono: g('--font-mono', 'monospace'),
    };
    return tokenCache;
  }
  function resetTokens() { tokenCache = null; }

  function roleColor(role) {
    const cs = getComputedStyle(document.documentElement);
    return cs.getPropertyValue('--r-' + role).trim() || '#888';
  }

  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /**
   * opts: { events, length, drums, role | color, chords: [{start,end,label}],
   *         mini (no labels), background (bool, default true) }
   */
  function draw(canvas, opts) {
    if (!canvas || !canvas.getContext) return;
    const o = opts || {};
    const { w, h, dpr } = fit(canvas);
    const ctx = canvas.getContext('2d');
    const tk = tokens();
    const color = o.color || roleColor(o.role || 'lead');
    const length = Math.max(T.BEAT, o.length || T.BAR);
    const events = o.events || [];
    const mini = !!o.mini;
    const labelW = !mini && o.drums ? Math.round(64 * dpr) : 0;
    const chordH = !mini && o.chords && o.chords.length ? Math.round(20 * dpr) : 0;
    const plotX = labelW;
    const plotW = w - labelW;
    const plotH = h - chordH;

    ctx.clearRect(0, 0, w, h);
    if (o.background !== false) {
      ctx.fillStyle = tk.screen;
      ctx.fillRect(0, 0, w, h);
    }

    const xOf = (t) => plotX + (t / length) * plotW;

    // rows
    let rows, rowOf;
    if (o.drums) {
      const present = new Set();
      for (const e of events) present.add(DRUM_INDEX[e.p] != null ? DRUM_INDEX[e.p] : 4);
      rows = DRUM_ROWS.map((r, i) => i).filter((i) => present.has(i));
      if (!rows.length) rows = [10];
      const pos = {};
      rows.forEach((ri, i) => { pos[ri] = i; });
      rowOf = (p) => pos[DRUM_INDEX[p] != null ? DRUM_INDEX[p] : 4];
    } else {
      let lo = 127, hi = 0;
      for (const e of events) { lo = Math.min(lo, e.p); hi = Math.max(hi, e.p); }
      if (lo > hi) { lo = 60; hi = 72; }
      const minSpan = mini ? 8 : 14;
      if (hi - lo < minSpan) {
        const pad = Math.ceil((minSpan - (hi - lo)) / 2);
        lo -= pad; hi += pad;
      }
      lo -= 1; hi += 1;
      rows = [];
      for (let p = hi; p >= lo; p--) rows.push(p);
      rowOf = (p) => hi - p;
    }
    const rowH = plotH / rows.length;

    // black-key shading
    if (!o.drums && !mini) {
      ctx.fillStyle = tk.black;
      rows.forEach((p, i) => {
        if ([1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)) ctx.fillRect(plotX, i * rowH, plotW, rowH);
      });
    }

    // grid: beats + bars
    const beats = Math.round(length / T.BEAT);
    for (let b = 0; b <= beats; b++) {
      const x = Math.round(xOf(b * T.BEAT)) + 0.5;
      const isBar = b % 4 === 0;
      if (mini && !isBar) continue;
      ctx.strokeStyle = isBar ? tk.line : tk.grid;
      ctx.lineWidth = isBar ? Math.max(1, dpr) : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH);
      ctx.stroke();
    }

    // drum labels + row lines
    if (o.drums && !mini) {
      ctx.font = `${Math.round(9.5 * dpr)}px ${tk.mono}`;
      ctx.textBaseline = 'middle';
      rows.forEach((ri, i) => {
        ctx.fillStyle = tk.faint;
        ctx.fillText(DRUM_ROWS[ri].label, 8 * dpr, i * rowH + rowH / 2);
        ctx.strokeStyle = tk.grid;
        ctx.beginPath();
        ctx.moveTo(plotX, Math.round((i + 1) * rowH) + 0.5);
        ctx.lineTo(w, Math.round((i + 1) * rowH) + 0.5);
        ctx.stroke();
      });
    }

    // notes
    const gap = Math.max(1, dpr * (mini ? 0.5 : 1));
    for (const e of events) {
      const r = rowOf(e.p);
      if (r == null || r < 0 || r >= rows.length) continue;
      const x = xOf(e.t);
      let nw = o.drums ? Math.max(2 * dpr, Math.min(xOf(e.t + Math.min(e.d, T.STEP)) - x, 10 * dpr)) : Math.max(1.5 * dpr, xOf(e.t + e.d) - x - gap);
      const y = r * rowH + gap / 2;
      const nh = Math.max(1, rowH - gap);
      ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, (e.v || 100) / 127);
      ctx.fillStyle = color;
      if (mini || nh < 4) ctx.fillRect(x, y, nw, nh);
      else { roundRect(ctx, x, y, nw, nh, 2 * dpr); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    // chord strip
    if (chordH) {
      ctx.fillStyle = tk.black;
      ctx.fillRect(0, plotH, w, chordH);
      ctx.font = `${Math.round(10 * dpr)}px ${tk.mono}`;
      ctx.textBaseline = 'middle';
      for (const c of o.chords) {
        const x0 = xOf(c.start);
        const x1 = xOf(c.end);
        ctx.strokeStyle = tk.line;
        ctx.beginPath();
        ctx.moveTo(Math.round(x0) + 0.5, plotH);
        ctx.lineTo(Math.round(x0) + 0.5, h);
        ctx.stroke();
        if (x1 - x0 > 22 * dpr) {
          ctx.fillStyle = tk.muted;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, plotH, x1 - x0 - 2, chordH);
          ctx.clip();
          ctx.fillText(c.label, x0 + 6 * dpr, plotH + chordH / 2);
          ctx.restore();
        }
      }
    }
  }

  /** playhead overlay on its own transparent canvas; tick null clears it */
  function head(canvas, tick, length, opts) {
    if (!canvas) return;
    const { w, h, dpr } = fit(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (tick == null) return;
    const labelW = opts && opts.drums && !opts.mini ? Math.round(64 * dpr) : 0;
    const x = Math.round(labelW + (((tick % length) + length) % length) / length * (w - labelW)) + 0.5;
    ctx.strokeStyle = tokens().tally;
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  Odd.roll = { draw, head, roleColor, resetTokens, DRUM_ROWS };
})(globalThis.Odd = globalThis.Odd || {});
