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
    { label: 'BELL', notes: [56, 67, 68, 80, 81] },
    { label: 'SHAKER', notes: [54, 69, 70, 73, 74] },
    { label: 'PERC', notes: [75, 76, 77, 71, 72, 78, 79] },
    { label: 'TIMBALE', notes: [65, 66] },
    { label: 'BONGO', notes: [60, 61] },
    { label: 'CONGA', notes: [62, 63, 64] },
    { label: 'TOM HI', notes: [50, 48] },
    { label: 'TOM LO', notes: [47, 45, 43, 41] },
    { label: 'RIM', notes: [37] },
    { label: 'CLAP', notes: [39] },
    { label: 'SNARE', notes: [38, 40] },
    { label: 'KICK', notes: [36, 35] },
  ];
  const DRUM_INDEX = {};
  DRUM_ROWS.forEach((r, i) => r.notes.forEach((n) => { DRUM_INDEX[n] = i; }));
  const OTHER = DRUM_ROWS.findIndex((r) => r.label === 'PERC');

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
   *         mini (no labels), background (bool, default true),
   *         rowsAlways (drum row labels to show even when empty, for editing),
   *         locked (bar indices to mark as kept) }
   * The layout is kept on the canvas so hit() can map a pointer to a note.
   */
  function draw(canvas, opts) {
    if (!canvas || !canvas.getContext) return;
    const o = opts || {};
    canvas._opts = o;
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
      for (const e of events) present.add(DRUM_INDEX[e.p] != null ? DRUM_INDEX[e.p] : OTHER);
      for (const label of o.rowsAlways || []) {
        const ri = DRUM_ROWS.findIndex((r) => r.label === label);
        if (ri >= 0) present.add(ri);
      }
      rows = DRUM_ROWS.map((r, i) => i).filter((i) => present.has(i));
      if (!rows.length) rows = [DRUM_ROWS.length - 1];
      const pos = {};
      rows.forEach((ri, i) => { pos[ri] = i; });
      rowOf = (p) => pos[DRUM_INDEX[p] != null ? DRUM_INDEX[p] : OTHER];
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
    // what a click on each row would add: the row's sound already in use, else its first
    const rowNote = o.drums
      ? rows.map((ri) => {
        const used = events.find((e) => (DRUM_INDEX[e.p] != null ? DRUM_INDEX[e.p] : OTHER) === ri);
        return used ? used.p : DRUM_ROWS[ri].notes[0];
      })
      : rows.slice();
    canvas._roll = { plotX, plotW, plotH, rowH, rows, rowNote, drums: !!o.drums, length, dpr, events };

    // kept bars
    if (o.locked && o.locked.length) {
      ctx.fillStyle = tk.black;
      for (const b of o.locked) {
        const x0 = xOf(b * T.BAR), x1 = xOf((b + 1) * T.BAR);
        ctx.fillRect(x0, 0, x1 - x0, plotH);
      }
    }

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

  /**
   * Where a pointer is on a drawn roll: { t, p, row, hit } in ticks and MIDI
   * pitch, with `hit` the event under it (or null). null outside the notes area.
   */
  function hit(canvas, clientX, clientY) {
    const L = canvas && canvas._roll;
    if (!L) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * L.dpr;
    const y = (clientY - rect.top) * L.dpr;
    if (x < L.plotX || x > L.plotX + L.plotW || y < 0 || y >= L.plotH) return null;
    const t = ((x - L.plotX) / L.plotW) * L.length;
    const row = Math.max(0, Math.min(L.rows.length - 1, Math.floor(y / L.rowH)));
    const p = L.rowNote[row];
    const rowOfEvent = (e) => (L.drums ? L.rowNote.indexOf(e.p) === row || rowIndexFor(L, e.p) === row : e.p === p);
    const slack = L.length / 64;
    let found = null;
    for (const e of L.events) {
      if (!rowOfEvent(e)) continue;
      const end = e.t + (L.drums ? Math.max(T.STEP, Math.min(e.d, T.STEP)) : e.d);
      if (t >= e.t - (L.drums ? slack / 2 : 0) && t < end + (L.drums ? slack / 2 : 0)) { found = e; break; }
    }
    return { t, p, row, hit: found };
  }

  function rowIndexFor(L, p) {
    const ri = DRUM_INDEX[p] != null ? DRUM_INDEX[p] : OTHER;
    return L.rows.indexOf(ri);
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

  Odd.roll = { draw, head, hit, roleColor, resetTokens, DRUM_ROWS };
})(globalThis.Odd = globalThis.Odd || {});
