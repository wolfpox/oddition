/* Oddition — percussion generator (congas, bongos, shakers, bells, clave...).
 *
 * A percussion part is one main instrument family playing a traditional
 * pattern (a conga tumbao, a bongo martillo, a son clave...) plus, at higher
 * density, one or two texture layers (shaker, tambourine, bell).
 *
 * Pattern grids are 16 or 32 steps, spaces ignored:
 *   'X' accent   'x' hit   'g' ghost tap   'h' ghost tap, half the time
 *   '1'..'9' a hit 10%..90% of the time   '.' rest
 * Ghost taps are what make hand percussion breathe: quiet heel and finger
 * strokes between the tones. The synth plays them duller, and plays hard
 * hits with a slap edge, so velocity is the articulation.
 */
(function (Odd) {
  'use strict';

  const T = Odd.theory;
  const STEP = T.STEP, BAR = T.BAR, BEAT = T.BEAT;

  const FAMILIES = {
    congas: {
      label: 'Congas',
      patterns: [
        { name: 'Tumbao', lanes: [
          { p: 62, v: 82, grid: 'g.h. X.h. g.h. ....' },
          { p: 63, v: 90, len: 160, grid: '.... .... .... x...' },
          { p: 64, v: 92, len: 180, grid: '.... .... .... ..x.' },
        ] },
        { name: 'House conga', lanes: [
          { p: 63, v: 88, len: 160, grid: '..x. ..4. ..x. .5..' },
          { p: 64, v: 92, len: 180, grid: '.... ...x .... x...' },
          { p: 62, v: 76, grid: 'g... X... g.h. ....' },
        ] },
        { name: 'Afro conga', lanes: [
          { p: 63, v: 88, len: 160, grid: '..x. .x.. ..x. x... ..x. .x.. x.x. ....' },
          { p: 64, v: 94, len: 180, grid: 'x... .... .... ..x. x... .... .... .x..' },
          { p: 62, v: 72, grid: '.h.h ..h. .h.. .h.h .h.h ..h. .h.. ..h.' },
        ] },
      ],
    },
    bongos: {
      label: 'Bongos',
      patterns: [
        { name: 'Martillo', lanes: [
          { p: 60, v: 86, grid: 'X.g. x.g. X.g. x...' },
          { p: 61, v: 90, grid: '.... .... .... ..x.' },
        ] },
        { name: 'Bongo sixteenths', lanes: [
          { p: 60, v: 82, grid: 'xghg Xghg xghg Xg..' },
          { p: 61, v: 88, grid: '.... .... .... ..xx' },
        ] },
        { name: 'Bongo call', lanes: [
          { p: 60, v: 88, grid: '..x. ..x. .... x.x. ..x. ..x. .x.. ....' },
          { p: 61, v: 90, grid: '.... .... x... .... .... .... ..x. x.x.' },
        ] },
      ],
    },
    shakers: {
      label: 'Shakers',
      texture: true,
      patterns: [
        { name: 'Shaker sixteenths', lanes: [{ p: 70, v: 66, grid: 'ggXg ggXg ggXg ggXg' }] },
        { name: 'Shaker eighths', lanes: [{ p: 70, v: 62, grid: 'x.X. x.X. x.X. x.X.' }] },
        { name: 'Cabasa', lanes: [{ p: 69, v: 62, grid: 'Xgxg Xgxg Xgxg Xgxh' }] },
      ],
    },
    tamb: {
      label: 'Tambourine',
      texture: true,
      patterns: [
        { name: 'Backbeat tambourine', lanes: [{ p: 54, v: 74, grid: 'g.h. X.h. g.h. X.h.' }] },
        { name: 'Tambourine sixteenths', lanes: [{ p: 54, v: 68, grid: 'xgXg xgXg xgXg xgXg' }] },
      ],
    },
    bells: {
      label: 'Bells',
      texture: true,
      patterns: [
        { name: 'Cowbell offbeats', lanes: [{ p: 56, v: 76, grid: '..x. ..x. ..x. ..x.' }] },
        { name: 'Agogo', lanes: [
          { p: 67, v: 80, grid: 'X.x. ..x. x... x.x.' },
          { p: 68, v: 82, grid: '.... x... ..x. ....' },
        ] },
        { name: 'Cascara bell', lanes: [{ p: 56, v: 74, grid: 'X.x. x.X. x.x. X.x.' }] },
      ],
    },
    clave: {
      label: 'Clave',
      texture: true,
      patterns: [
        { name: 'Son clave', lanes: [{ p: 75, v: 88, grid: 'x... ..x. .... x... .... x... x... ....' }] },
        { name: 'Rumba clave', lanes: [{ p: 75, v: 88, grid: 'x... ..x. .... ..x. .... x... x... ....' }] },
        { name: 'Tresillo', lanes: [{ p: 75, v: 84, grid: 'x..x ..x. x..x ..x.' }] },
      ],
    },
    wood: {
      label: 'Wood & rim',
      texture: true,
      patterns: [
        { name: 'Woodblocks', lanes: [
          { p: 76, v: 74, grid: '..x. .3.. x..4 ..x.' },
          { p: 77, v: 76, grid: 'x... ...4 .... .x..' },
        ] },
        { name: 'Rim ticks', lanes: [{ p: 37, v: 68, grid: '...x ..x. .x.. x..3' }] },
        { name: 'Click sixteenths', lanes: [{ p: 75, v: 62, grid: 'x.gx .gx. gx.g x.g.' }] },
      ],
    },
    toms: {
      label: 'Toms',
      patterns: [
        { name: 'Floor tom pulse', lanes: [
          { p: 41, v: 94, len: 160, grid: 'X..g ..x. X..g ..x.' },
          { p: 45, v: 86, len: 140, grid: '.... x... .... x.h.' },
        ] },
        { name: 'Tribal toms', lanes: [
          { p: 43, v: 92, len: 140, grid: 'X.gx .gx. X.gx .gxg' },
          { p: 47, v: 84, len: 120, grid: '...x .... ..x. x...' },
        ] },
        { name: 'Tom gallop', lanes: [{ p: 41, v: 94, len: 140, grid: 'X.xx X.xx X.xx X.x.' }] },
      ],
    },
    timbales: {
      label: 'Timbales',
      patterns: [
        { name: 'Timbale cascara', lanes: [
          { p: 65, v: 82, grid: 'X.x. x.X. x.x. X.x.' },
          { p: 66, v: 86, grid: '.... .... .... ..x.' },
        ] },
      ],
    },
    triangle: {
      label: 'Triangle',
      texture: true,
      patterns: [
        { name: 'Triangle', lanes: [
          { p: 80, v: 60, grid: 'gg.g gg.g gg.g gg.g' },
          { p: 81, v: 68, len: 240, grid: '..x. ..x. ..x. ..x.' },
        ] },
      ],
    },
  };
  const FAMILY_IDS = Object.keys(FAMILIES);
  const DEFAULT_WEIGHTS = { congas: 2, bongos: 2, shakers: 2, tamb: 1, bells: 1 };

  function parseGrid(str) {
    return Odd.styles.steps(str).map((ch) => {
      if (ch === 'X') return { prob: 1, anchor: true, accent: true };
      if (ch === 'x') return { prob: 1, anchor: true };
      if (ch === 'g') return { prob: 1, ghost: true };
      if (ch === 'h') return { prob: 0.5, ghost: true };
      if (ch >= '1' && ch <= '9') return { prob: (ch.charCodeAt(0) - 48) / 10 };
      return { prob: 0 };
    });
  }

  function weightsFor(style) {
    return (style.perc && style.perc.kits) || DEFAULT_WEIGHTS;
  }

  function generate(ctx) {
    const { params, bars, u } = ctx;
    const density = params.density;
    const complexity = params.complexity;
    const coreRng = ctx.rngFor('core');
    const varyRng = ctx.rngFor('vary');
    const fillRng = ctx.rngFor('fill');
    const layerRng = ctx.rngFor('layers');
    const weights = weightsFor(ctx.style);

    // --- which instruments: the main family, then texture layers
    let mainId = params.kit && FAMILIES[params.kit] ? params.kit : null;
    if (!mainId) mainId = layerRng.weighted(FAMILY_IDS.filter((f) => weights[f]).map((f) => [f, weights[f]]));
    const main = FAMILIES[mainId];
    const picks = [{ id: mainId, pattern: layerRng.pick(main.patterns), main: true }];
    let extra = density < 0.4 ? 0 : density < 0.72 ? (layerRng.chance(0.7) ? 1 : 0) : layerRng.chance(0.5) ? 2 : 1;
    const pool = FAMILY_IDS.filter((f) => f !== mainId && FAMILIES[f].texture && weights[f]);
    while (extra-- > 0 && pool.length) {
      const id = layerRng.weighted(pool.map((f) => [f, weights[f]]));
      pool.splice(pool.indexOf(id), 1);
      picks.push({ id, pattern: layerRng.pick(FAMILIES[id].patterns), main: false });
    }

    const lanes = [];
    for (const pk of picks) {
      for (const l of pk.pattern.lanes) {
        lanes.push(Object.assign({ len: 60 }, l, {
          cells: parseGrid(l.grid),
          main: pk.main,
          // texture layers sit under the main instrument
          v: pk.main ? l.v : l.v - 10,
        }));
      }
    }
    const coreBars = lanes.some((l) => l.cells.length > 16) ? 2 : 1;
    const mult = 0.35 + 1.3 * density;
    const ghostKeep = 0.35 + 0.65 * Math.min(1, density * 1.4);

    // listening: hand percussion leaves the kick's strongest steps to the kick
    const kickAt = ctx.band && ctx.band.kick && ctx.band.kick.some((x) => x > 0) ? Odd.band.fold(ctx.band.kick, coreBars * 16) : null;
    let cleared = 0;

    function cellVel(lane, cell) {
      if (cell.ghost) return lane.v * 0.42 + coreRng.int(-4, 4);
      return lane.v + (cell.accent ? 18 : 0);
    }

    function sampleBar(barIdx, rng, baseBar, mutRate) {
      const hits = [];
      for (const lane of lanes) {
        for (let s = 0; s < 16; s++) {
          const cell = lane.cells[(barIdx * 16 + s) % lane.cells.length];
          if (cell.prob <= 0) continue;
          let on;
          if (cell.anchor) on = true;
          else if (baseBar && !rng.chance(mutRate)) on = baseBar.some((h) => h.lane === lane && h.step === s);
          else if (cell.ghost) on = rng.chance(cell.prob * ghostKeep);
          else on = rng.chance(Math.min(0.97, cell.prob * mult));
          if (on && kickAt && !cell.anchor && !lane.main && kickAt[(barIdx * 16 + s) % kickAt.length] > 0.5 && rng.chance(0.6)) {
            cleared++;
            on = false;
          }
          if (on) hits.push({ lane, step: s, cell, v: cellVel(lane, cell) });
        }
      }
      return hits;
    }

    const core = [];
    for (let b = 0; b < coreBars; b++) core.push(sampleBar(b, coreRng, null, 0));
    if (coreBars === 1 && bars >= 2) core.push(sampleBar(0, coreRng, core[0], 0.08 + 0.2 * complexity));

    const mainLanes = lanes.filter((l) => l.main);
    const notes = [];
    const push = (t, p, v, d) => notes.push({ t, p, v, d: d || 60 });

    for (let b = 0; b < bars; b++) {
      const barStart = b * BAR;
      let hits = core[b % core.length].map((h) => Object.assign({}, h));

      // later passes drift: a ghost goes missing, another turns up
      if (b >= core.length && complexity > 0) {
        const rate = 0.12 * complexity;
        hits = hits.filter((h) => !h.cell.ghost || !varyRng.chance(rate));
        for (const lane of mainLanes) {
          for (let s = 1; s < 16; s += 2) {
            if (hits.some((h) => h.step === s && h.lane.main)) continue;
            if (varyRng.chance(rate * 0.5)) hits.push({ lane, step: s, cell: { ghost: true }, v: lane.v * 0.4 });
          }
        }
      }

      // a run on the main drums at phrase ends
      const n = b + 1;
      let fillFrom = 16;
      if (bars >= 2 && (n % 4 === 0 || n === bars) && fillRng.chance(0.2 + 0.5 * complexity)) {
        fillFrom = (n % 8 === 0 || n === bars) && complexity > 0.5 && fillRng.chance(0.5) ? 8 : 12;
        hits = hits.filter((h) => h.step < fillFrom || !h.lane.main);
        const pitches = [...new Set(mainLanes.map((l) => l.p))].sort((a, c) => a - c);
        const len = 16 - fillFrom;
        for (let i = 0; i < len; i++) {
          if (i % 4 === 3 && fillRng.chance(0.3)) continue;
          // high drum to low across the run
          const p = pitches[Math.min(pitches.length - 1, Math.floor(((len - 1 - i) * pitches.length) / len))];
          const v = 58 + (i / Math.max(1, len - 1)) * 50;
          push(barStart + (fillFrom + i) * STEP, p, v, 80);
        }
      }

      for (const h of hits) {
        const t = barStart + h.step * STEP;
        const v = h.v + varyRng.int(-5, 5);
        // flams on accents: a grace note just ahead
        if (h.cell.accent && complexity > 0.55 && varyRng.chance((complexity - 0.5) * 0.8) && t >= 30) {
          push(t - 30, h.lane.p, v * 0.5, 30);
        }
        push(t, h.lane.p, v, h.lane.len);
      }
    }

    // a lone first hit for very sparse settings so a part is never silent
    if (!notes.length) push(0, mainLanes[0].p, mainLanes[0].v, 60);

    if (cleared) ctx.heard.push('Leaves the kick room');
    return notes.map((x) => Object.assign(x, { v: u.vel(x.v) }));
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.roles = Odd.gen.roles || {};
  Odd.gen.roles.perc = {
    aspects: ['vary', 'fill', 'core', 'layers'],
    params: [
      {
        key: 'kit', label: 'Instrument', type: 'select', default: 'auto', hint: 'The main instrument; Auto picks one for the style',
        options: [{ value: 'auto', label: 'Auto' }].concat(FAMILY_IDS.map((id) => ({ value: id, label: FAMILIES[id].label }))),
      },
    ],
    generate,
    FAMILIES,
  };
})(globalThis.Odd = globalThis.Odd || {});
