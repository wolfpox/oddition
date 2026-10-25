/* Oddition — genre presets.
 *
 * A style is a bundle of tables the generators read: drum step grids, bass
 * and chord rhythm pools, melody rhythm-cell weights and so on.
 *
 * Step-grid strings (spaces are ignored, 16 chars = 1 bar of 16ths, 32 = 2 bars):
 *   drums:  '.' or '0' never, '1'..'9' = 10%..90% chance, 'x' always, 'X' always + accent
 *   bass:   'R' root, 'O' octave up, 'L' octave down, '5' fifth, '3' third,
 *           'A' approach to the next chord, 'x' free choice, '-' hold, '.' rest
 *   chords: 'X' accented hit, 'x' hit, '>' hit that anticipates the next chord,
 *           '-' hold, '.' rest
 */
(function (Odd) {
  'use strict';

  const STYLES = [
    {
      id: 'lofi',
      label: 'Lo-fi',
      blurb: 'Dusty, swung beats under jazzy seventh chords.',
      tempo: [70, 90],
      swing: 0.28,
      scales: ['dorian', 'minor', 'major'],
      rate: 1,
      vamp: false,
      patches: { drums: 'kit-lofi', bass: 'bass-pluck', chords: 'epiano', pad: 'pad-warm', lead: 'lead-soft', arp: 'pluck' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 100, len: 120, kick: true, grid: 'x..2 ..4. .5x. ..3.' },
          { name: 'snare', p: 38, v: 92, len: 120, snare: true, grid: '.... x... .... x...' },
          { name: 'hat', p: 42, v: 62, len: 60, hat: true, grid: 'x.8. x.8. x.8. x.82' },
          { name: 'ohat', p: 46, v: 56, len: 200, hat: true, open: true, grid: '.... .... .... ..2.' },
          { name: 'rim', p: 37, v: 48, len: 60, perc: true, grid: '.... ...1 .... ..1.' },
          { name: 'shaker', p: 70, v: 34, len: 60, perc: true, grid: '..2. ..2. ..2. ..2.' },
        ],
        ghost: 0.6, ghostNote: 38, rolls: 0, fills: ['snare', 'kick'], crash: 0.12,
      },
      bass: {
        center: 40, gate: 0.92, approach: 0.5, chromatic: 0.3, vel: 96,
        rhythms: [
          'R--- ---- ---- ----',
          'R--- ---- ..x- ----',
          'R--- ---. ..x- --A.',
          'R--- -.R- ---- 5-A-',
          'R--. .R-- -.5- -.A.',
          'R-.R --.5 -.R- -.A-',
        ],
      },
      chords: {
        ext: 0.9, ninth: 0.5, rootless: 0.35, center: 62, gate: 0.96, spread: 0.2,
        comps: [
          'X--- ---- ---- ----',
          'X--- ---- --x- ----',
          'X--- --x- ---- ----',
          'X--- ---. .x-- -->-',
          'X--. .x-- -.x- ----',
        ],
      },
      pad: { center: 50, color: 0.7, templates: ['open7', 'add9', 'open'] },
      lead: {
        cells: { q: 2, e: 3, e1: 2, off: 2, es: 1, se: 1, dot: 2, trip: 1, rest: 2, h: 1, dq: 1 },
        penta: 0.7, center: 2, span: 9, gate: 0.85, stableExt: true, rep: 0.12, leap: 1, sustain: 0.3,
      },
      arp: { rate: '8t', pattern: 'updown', seventh: 0.8, low: 55 },
    },
    {
      id: 'boombap',
      label: 'Boom bap',
      blurb: 'Hard kicks and snares with a head-nod swing.',
      tempo: [84, 96],
      swing: 0.18,
      scales: ['minor', 'dorian'],
      rate: 1,
      vamp: false,
      patches: { drums: 'kit-acoustic', bass: 'bass-pluck', chords: 'keys', pad: 'strings', lead: 'bell', arp: 'pluck' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 108, len: 120, kick: true, grid: 'x.3. ...4 ..x. .3..' },
          { name: 'snare', p: 38, v: 104, len: 120, snare: true, grid: '.... X... .... X..1' },
          { name: 'hat', p: 42, v: 66, len: 60, hat: true, grid: 'x.7. x.7. x.7. x.7.' },
          { name: 'ohat', p: 46, v: 58, len: 200, hat: true, open: true, grid: '.... .... .... ..3.' },
          { name: 'tamb', p: 54, v: 44, len: 60, perc: true, grid: '.... 2... .... 2...' },
        ],
        ghost: 0.5, ghostNote: 38, rolls: 0, fills: ['snare', 'kick', 'toms'], crash: 0.25,
      },
      bass: {
        center: 38, gate: 0.85, approach: 0.45, chromatic: 0.25, vel: 100,
        rhythms: [
          'R--. .... R-.. ....',
          'R--. ..R. .x-. ....',
          'R--. ..R- ..x- ..A.',
          'R-.R ..x- R-.. .A..',
          'R-.x .-R- ..5. x.A.',
        ],
      },
      chords: {
        ext: 0.7, ninth: 0.35, rootless: 0.2, center: 61, gate: 0.9, spread: 0.2,
        comps: [
          'X--- ---- ---- ----',
          'X--- --x- ---- ----',
          'X--. ..x- ---. ....',
          'X-.. ..x- ..x. ....',
        ],
      },
      pad: { center: 50, color: 0.5, templates: ['open', 'open7'] },
      lead: {
        cells: { q: 2, e: 2, e1: 2, off: 2, dot: 2, rest: 3, h: 1, sync: 1 },
        penta: 0.8, center: 0, span: 8, gate: 0.8, stableExt: true, rep: 0.15, leap: 1, sustain: 0.25,
      },
      arp: { rate: '8', pattern: 'up', seventh: 0.6, low: 55 },
    },
    {
      id: 'trap',
      label: 'Trap',
      blurb: 'Half-time snares, rolling hi-hats and long 808s.',
      tempo: [130, 150],
      swing: 0,
      scales: ['minor', 'harmonicMinor', 'phrygian'],
      rate: 0.5,
      vamp: false,
      patches: { drums: 'kit-808', bass: 'bass-808', chords: 'keys', pad: 'pad-glass', lead: 'bell', arp: 'pluck' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 112, len: 240, kick: true, grid: 'x... ...4 ..5. .... x.3. ...3 .4.. ..2.' },
          { name: 'snare', p: 38, v: 104, len: 160, snare: true, grid: '.... .... x... .... .... .... x... ...1' },
          { name: 'clap', p: 39, v: 88, len: 160, layer: true, grid: '.... .... x... .... .... .... x... ....' },
          { name: 'hat', p: 42, v: 70, len: 50, hat: true, grid: 'x3x3 x3x3 x3x3 x3x3' },
          { name: 'ohat', p: 46, v: 60, len: 220, hat: true, open: true, grid: '.... .... .... ..2. .... .... .... ..3.' },
        ],
        ghost: 0.1, ghostNote: 38, rolls: 0.6, fills: ['roll'], crash: 0.2,
      },
      bass: {
        center: 35, gate: 1, approach: 0.35, chromatic: 0.15, vel: 112, glide: true,
        rhythms: [
          'R--- ---- ---- ---- R--- ---- ---- ----',
          'R--- ---R --R- ---- R--- ---- ---- ----',
          'R--- ---R --R- ---- R--- ---- --x- --A-',
          'R--- ---R --R- ---- R-x- ---x -R-- --A.',
          'R--. ..R- ..R- .x.- R--- ..R- -x-. x-A.',
        ],
      },
      chords: {
        ext: 0.3, ninth: 0.2, rootless: 0, center: 62, gate: 0.97, spread: 0.3,
        comps: [
          'X--- ---- ---- ----',
          'X--- ---- X--- ----',
          'X--. ..x- ---- ....',
        ],
      },
      pad: { center: 50, color: 0.3, templates: ['open', 'sus2', 'shimmer'] },
      lead: {
        cells: { s: 2, es: 2, se: 2, trip: 2, e: 2, q: 1, rest: 1, anti: 1, sync: 1 },
        penta: 0.4, center: 2, span: 7, gate: 0.7, stableExt: false, rep: 0.28, leap: 0.8, sustain: 0.15,
      },
      arp: { rate: '8t', pattern: 'pedal', seventh: 0.2, low: 57 },
    },
    {
      id: 'house',
      label: 'House',
      blurb: 'Four-on-the-floor kicks, offbeat hats and stab chords.',
      tempo: [120, 126],
      swing: 0.08,
      scales: ['minor', 'dorian', 'major'],
      rate: 1,
      vamp: false,
      patches: { drums: 'kit-909', bass: 'bass-saw', chords: 'stab', pad: 'strings', lead: 'lead-soft', arp: 'pluck' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 110, len: 160, kick: true, grid: 'x... x... x... x..1' },
          { name: 'clap', p: 39, v: 96, len: 120, snare: true, grid: '.... x... .... x...' },
          { name: 'ohat', p: 46, v: 72, len: 180, hat: true, open: true, grid: '..x. ..x. ..x. ..x.' },
          { name: 'hat', p: 42, v: 54, len: 50, hat: true, grid: '5..5 5..5 5..5 5..5' },
          { name: 'shaker', p: 70, v: 34, len: 50, perc: true, grid: '6464 6464 6464 6464' },
          { name: 'perc', p: 75, v: 46, len: 60, perc: true, grid: '...2 ..2. .2.. ....' },
        ],
        ghost: 0.15, ghostNote: 38, rolls: 0, fills: ['clap', 'snare'], crash: 0.35, kickDrop: true,
      },
      bass: {
        center: 41, gate: 0.78, approach: 0.4, chromatic: 0.2, vel: 100,
        rhythms: [
          '..R- ..R- ..R- ..R-',
          '..R. ..R. ..R. ..R.',
          'R-.. ..R. ..O. ..R.',
          '..R- .R.. ..R- .xA.',
          '.RR. ..R. .R.R ..O.',
        ],
      },
      chords: {
        ext: 0.75, ninth: 0.45, rootless: 0.3, center: 64, gate: 0.7, spread: 0,
        comps: [
          'X--- ---- ---- ----',
          '..x. ..x. ..x. ..x.',
          '..X. .x.. ..X. ..x.',
          'x..x ..x. ..x. x...',
          '..x- ..x- .x.. x.x.',
        ],
      },
      pad: { center: 52, color: 0.6, templates: ['open7', 'add9'] },
      lead: {
        cells: { e: 2, off: 3, sync: 2, e1: 2, q: 1, anti: 1, rest: 1, dot: 1 },
        penta: 0.5, center: 2, span: 8, gate: 0.6, stableExt: true, rep: 0.2, leap: 0.9, sustain: 0.15,
      },
      arp: { rate: '16', pattern: 'up', seventh: 0.6, low: 57 },
    },
    {
      id: 'techno',
      label: 'Techno',
      blurb: 'Driving, hypnotic loops built on one or two chords.',
      tempo: [126, 134],
      swing: 0,
      scales: ['minor', 'phrygian', 'dorian'],
      rate: 0.5,
      vamp: true,
      patches: { drums: 'kit-909', bass: 'bass-saw', chords: 'stab', pad: 'pad-glass', lead: 'lead-saw', arp: 'pluck' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 116, len: 160, kick: true, grid: 'x... x... x... x...' },
          { name: 'clap', p: 39, v: 88, len: 120, snare: true, grid: '.... 8... .... 8...' },
          { name: 'ohat', p: 46, v: 70, len: 160, hat: true, open: true, grid: '..x. ..x. ..x. ..x.' },
          { name: 'hat', p: 42, v: 56, len: 40, hat: true, grid: '6464 6464 6464 6464' },
          { name: 'rim', p: 37, v: 58, len: 50, perc: true, grid: '..3. .3.. 3..3 ..3.' },
          { name: 'ride', p: 51, v: 46, len: 200, perc: true, grid: '..2. ..2. ..2. ..2.' },
        ],
        ghost: 0.05, ghostNote: 37, rolls: 0, fills: ['clap', 'kick'], crash: 0.15, kickDrop: true,
      },
      bass: {
        center: 38, gate: 0.6, approach: 0.2, chromatic: 0.1, vel: 104,
        rhythms: [
          '..R. ..R. ..R. ..R.',
          '..R- ..R- ..R- ..R-',
          '.RR. .RR. .RR. .RR.',
          '..RR ..R. ..RR ..R.',
          '.RRR .RR. .RRR .RO.',
        ],
      },
      chords: {
        ext: 0.6, ninth: 0.2, rootless: 0, center: 60, gate: 0.55, spread: 0,
        comps: [
          '..x. .... ..x. ....',
          '...x ..x. ...x ..x.',
          'x... ..x. .x.. x...',
          '..x. .x.. x..x ..x.',
        ],
      },
      pad: { center: 50, color: 0.3, templates: ['open', 'sus2'] },
      lead: {
        cells: { off: 3, e1: 2, e: 1, rest: 1.5, q: 1, anti: 1, sync: 1.5, s: 1 },
        penta: 0.3, center: 1, span: 5, gate: 0.4, stableExt: false, rep: 0.3, leap: 0.6, sustain: 0.05,
      },
      arp: { rate: '16', pattern: 'pedal', seventh: 0.3, low: 55 },
    },
    {
      id: 'synthwave',
      label: 'Synthwave',
      blurb: 'Neon eighties pulse with big pads and soaring leads.',
      tempo: [84, 112],
      swing: 0,
      scales: ['minor', 'dorian'],
      rate: 1,
      vamp: false,
      patches: { drums: 'kit-808', bass: 'bass-saw', chords: 'stab', pad: 'pad-warm', lead: 'lead-saw', arp: 'pluck' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 110, len: 160, kick: true, grid: 'x... ..3. x.3. ....' },
          { name: 'snare', p: 38, v: 108, len: 200, snare: true, grid: '.... X... .... X...' },
          { name: 'clap', p: 39, v: 70, len: 160, layer: true, grid: '.... 5... .... 5...' },
          { name: 'hat', p: 42, v: 62, len: 50, hat: true, grid: 'x.8. x.8. x.8. x.8.' },
          { name: 'ohat', p: 46, v: 56, len: 200, hat: true, open: true, grid: '.... .... .... ..3.' },
        ],
        ghost: 0.15, ghostNote: 38, rolls: 0, fills: ['toms', 'snare'], crash: 0.5,
      },
      bass: {
        center: 40, gate: 0.7, approach: 0.3, chromatic: 0.1, vel: 100,
        rhythms: [
          'R--- R--- R--- R---',
          'R-R- R-R- R-R- R-R-',
          'R-O- R-O- R-O- R-O-',
          'RRRR RRRR RRRR RRRR',
          'RRRO RRRO RRRO RR5A',
        ],
      },
      chords: {
        ext: 0.35, ninth: 0.25, rootless: 0, center: 62, gate: 0.97, spread: 0.35,
        comps: [
          'X--- ---- ---- ----',
          'X--- ---- X--- ----',
          'X--- --x- ---- x---',
          'x-x- x-x- x-x- x-x-',
        ],
      },
      pad: { center: 50, color: 0.4, templates: ['open', 'open7', 'shimmer'] },
      lead: {
        cells: { q: 3, h: 2, e: 2, dq: 2, dot: 1, rest: 1, w: 0.3 },
        penta: 0.4, center: 2, span: 11, gate: 0.95, stableExt: false, rep: 0.1, leap: 1.4, sustain: 0.35,
        motifBars: 2,
      },
      arp: { rate: '16', pattern: 'up', seventh: 0.3, low: 55 },
    },
    {
      id: 'pop',
      label: 'Pop',
      blurb: 'Bright, singable hooks over a steady backbeat.',
      tempo: [96, 124],
      swing: 0.05,
      scales: ['major', 'mixolydian', 'minor'],
      rate: 1,
      vamp: false,
      patches: { drums: 'kit-acoustic', bass: 'bass-pluck', chords: 'keys', pad: 'strings', lead: 'lead-square', arp: 'bell' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 106, len: 140, kick: true, grid: 'x... ..4. x.3. ...2' },
          { name: 'snare', p: 38, v: 104, len: 140, snare: true, grid: '.... X... .... X...' },
          { name: 'hat', p: 42, v: 64, len: 60, hat: true, grid: 'x.8. x.8. x.8. x.8.' },
          { name: 'ohat', p: 46, v: 58, len: 200, hat: true, open: true, grid: '.... .... .... ..3.' },
          { name: 'tamb', p: 54, v: 52, len: 60, perc: true, grid: '.... 6... .... 6...' },
        ],
        ghost: 0.25, ghostNote: 38, rolls: 0, fills: ['toms', 'snare'], crash: 0.5,
      },
      bass: {
        center: 40, gate: 0.88, approach: 0.45, chromatic: 0.15, vel: 98,
        rhythms: [
          'R--- ---- R--- ----',
          'R--- R--- R--- R-A-',
          'R-R- R-R- R-R- R-A-',
          'R--R --R- R--R --A-',
          'R-.R .R-5 R-.R .5A-',
        ],
      },
      chords: {
        ext: 0.15, ninth: 0.15, rootless: 0, center: 62, gate: 0.92, spread: 0.2,
        comps: [
          'X--- ---- ---- ----',
          'X--- ---- X--- ----',
          'X--- --x- ---x --x-',
          'x-x- x-x- x-x- x->-',
          'X--. .x-- x--. .>--',
        ],
      },
      pad: { center: 50, color: 0.3, templates: ['open', 'sus2', 'open7'] },
      lead: {
        cells: { q: 3, e: 3, dot: 2, h: 1, dq: 1, rest: 1, off: 1, sync: 1 },
        penta: 0.5, center: 2, span: 9, gate: 0.85, stableExt: false, rep: 0.12, leap: 1, sustain: 0.25,
      },
      arp: { rate: '8', pattern: 'updown', seventh: 0.1, low: 57 },
    },
    {
      id: 'ambient',
      label: 'Ambient',
      blurb: 'Slow, spacious washes with soft, sparse rhythm.',
      tempo: [60, 80],
      swing: 0,
      scales: ['lydian', 'major', 'dorian'],
      rate: 0.5,
      vamp: false,
      patches: { drums: 'kit-lofi', bass: 'bass-sub', chords: 'epiano', pad: 'pad-glass', lead: 'bell', arp: 'bell' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 82, len: 200, kick: true, grid: '6... .... ..2. ....' },
          { name: 'rim', p: 37, v: 52, len: 60, snare: true, grid: '.... .... 5... ....' },
          { name: 'shaker', p: 70, v: 34, len: 60, perc: true, grid: '4.3. 4.3. 4.3. 4.3.' },
          { name: 'hat', p: 42, v: 38, len: 50, hat: true, grid: '.... ..2. .... ..2.' },
          { name: 'clave', p: 75, v: 40, len: 60, perc: true, grid: '...2 .... .... ....' },
        ],
        ghost: 0, ghostNote: 37, rolls: 0, fills: ['soft'], crash: 0,
      },
      bass: {
        center: 38, gate: 0.98, approach: 0.15, chromatic: 0, vel: 84,
        rhythms: [
          'R--- ---- ---- ---- ---- ---- ---- ----',
          'R--- ---- ---- ---- ---- ---- ---- ----',
          'R--- ---- ---- ---- 5--- ---- ---- ----',
          'R--- ---- 5--- ---- R--- ---- ---- ----',
        ],
      },
      chords: {
        ext: 0.6, ninth: 0.6, rootless: 0.2, center: 62, gate: 0.98, spread: 0.5,
        comps: [
          'X--- ---- ---- ----',
          'X--- ---- ---- ----',
          'X--- ---- x--- ----',
        ],
      },
      pad: { center: 50, color: 0.7, templates: ['add9', 'shimmer', 'sus2', 'open7'] },
      lead: {
        cells: { h: 3, w: 2, q: 1, rest: 2, dq: 1 },
        penta: 0.6, center: 0, span: 12, gate: 1, stableExt: true, rep: 0.08, leap: 1.6, sustain: 0.5,
        motifBars: 2,
      },
      arp: { rate: '8', pattern: 'converge', seventh: 0.6, low: 60 },
    },
    {
      id: 'dnb',
      label: 'Drum & bass',
      blurb: 'Fast two-step breaks under rolling, liquid basslines.',
      tempo: [168, 176],
      swing: 0.04,
      scales: ['minor', 'dorian'],
      rate: 0.5,
      vamp: false,
      patches: { drums: 'kit-acoustic', bass: 'bass-sub', chords: 'epiano', pad: 'pad-warm', lead: 'lead-soft', arp: 'pluck' },
      drums: {
        lanes: [
          { name: 'kick', p: 36, v: 110, len: 140, kick: true, grid: 'x... .... ..x. .... x... ...3 ..x. ..2.' },
          { name: 'snare', p: 38, v: 106, len: 140, snare: true, grid: '.... X... .... X... .... X... .... X..2' },
          { name: 'hat', p: 42, v: 60, len: 40, hat: true, grid: 'x.8. x.8. x.8. x.8. x.8. x.8. x.8. x.8.' },
          { name: 'ride', p: 51, v: 48, len: 200, perc: true, grid: '..3. ..3. ..3. ..3. ..3. ..3. ..3. ..3.' },
          { name: 'ohat', p: 46, v: 54, len: 160, hat: true, open: true, grid: '.... .... .... ..2. .... .... .... ....' },
        ],
        ghost: 0.7, ghostNote: 38, rolls: 0.1, fills: ['break', 'snare'], crash: 0.3,
      },
      bass: {
        center: 37, gate: 0.95, approach: 0.4, chromatic: 0.2, vel: 104,
        rhythms: [
          'R--- ---- ---- ---- R--- ---- ---- ----',
          'R--- ---- --R- ---- R--- ---- --R- -.A-',
          'R--- --R- --R- ---- R--- ---R --x- --A-',
          'R-.R --.R -.R- -.x- R-.R --.R -.x- .xA-',
        ],
      },
      chords: {
        ext: 0.8, ninth: 0.5, rootless: 0.3, center: 63, gate: 0.97, spread: 0.3,
        comps: [
          'X--- ---- ---- ----',
          'X--- ---- --x- ----',
          'X... ..x. ..x. ....',
        ],
      },
      pad: { center: 52, color: 0.6, templates: ['open7', 'add9', 'shimmer'] },
      lead: {
        cells: { h: 2, q: 2, e: 2, dq: 1, rest: 2, sync: 1, off: 1 },
        penta: 0.5, center: 2, span: 10, gate: 0.9, stableExt: true, rep: 0.1, leap: 1.2, sustain: 0.35,
      },
      arp: { rate: '16', pattern: 'updown', seventh: 0.7, low: 57 },
    },
  ];

  // how often new chord progressions reach outside the key (0..1), per style
  const HARMONY = { lofi: 0.55, boombap: 0.35, trap: 0.15, house: 0.3, techno: 0.05, synthwave: 0.35, pop: 0.3, ambient: 0.2, dnb: 0.25 };
  for (const s of STYLES) if (s.harmony == null) s.harmony = HARMONY[s.id] != null ? HARMONY[s.id] : 0.3;

  const byId = {};
  for (const s of STYLES) byId[s.id] = s;

  /** '.... x...' -> array of characters with spaces removed */
  function steps(str) {
    return String(str).replace(/\s+/g, '').split('');
  }

  Odd.styles = {
    DEFAULT: 'lofi',
    ids: STYLES.map((s) => s.id),
    list() {
      return STYLES.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb }));
    },
    get(id) {
      return byId[id] || byId.lofi;
    },
    steps,
  };
})(globalThis.Odd = globalThis.Odd || {});
