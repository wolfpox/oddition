/* Oddition — short evocative names for generated parts. */
(function (Odd) {
  'use strict';

  const NOUNS = {
    drums: ['Pocket', 'Shuffle', 'Knock', 'Stomp', 'Rattle', 'Break', 'Strut', 'Clatter', 'Bounce', 'Snap',
      'Thump', 'Shake', 'Swagger', 'Tumble', 'March', 'Stride', 'Clap', 'Kick'],
    perc: ['Conga', 'Rattle', 'Shaker', 'Bongo', 'Patter', 'Clave', 'Ritual', 'Carnival', 'Tumble', 'Chatter',
      'Drizzle', 'Market', 'Woodpile', 'Tapestry', 'Firelight'],
    bass: ['Undertow', 'Floor', 'Rumble', 'Current', 'Anchor', 'Bedrock', 'Sway', 'Walk', 'Groundswell',
      'Hum', 'Weight', 'Root', 'Tremor', 'Riverbed', 'Low End'],
    chords: ['Changes', 'Stack', 'Bloom', 'Haze', 'Glow', 'Comp', 'Palette', 'Swell', 'Chorale', 'Mood',
      'Colours', 'Voicings', 'Hymn', 'Lantern', 'Window'],
    pad: ['Fog', 'Drift', 'Horizon', 'Veil', 'Tide', 'Halo', 'Cloud', 'Mist', 'Aurora', 'Ether',
      'Field', 'Dusk', 'Canopy', 'Breath', 'Glacier'],
    lead: ['Hook', 'Whistle', 'Thread', 'Line', 'Figure', 'Tune', 'Spark', 'Ribbon', 'Call', 'Signal',
      'Refrain', 'Motif', 'Song', 'Kite', 'Lullaby'],
    arp: ['Spiral', 'Cascade', 'Ripple', 'Sequence', 'Wheel', 'Stair', 'Shimmer', 'Orbit', 'Lattice',
      'Pinwheel', 'Clockwork', 'Fountain', 'Sprinkle', 'Weave', 'Ladder'],
  };

  const ADJECTIVES = {
    lofi: ['Dusty', 'Warm', 'Sleepy', 'Faded', 'Rainy', 'Vinyl', 'Mellow', 'Hazy', 'Late', 'Cozy'],
    boombap: ['Gritty', 'Crate', 'Dusted', 'Smoky', 'Concrete', 'Raw', 'Brick', 'Golden', 'Corner', 'Rugged'],
    trap: ['Icy', 'Dark', 'Heavy', 'Chrome', 'Night', 'Venom', 'Frozen', 'Smoke', 'Diamond', 'Shadow'],
    house: ['Sunlit', 'Deep', 'Velvet', 'Disco', 'Warehouse', 'Loose', 'Bright', 'Saturday', 'Garage', 'Silk'],
    techno: ['Steel', 'Grey', 'Machine', 'Tunnel', 'Cold', 'Iron', 'Static', 'Basement', 'Strobe', 'Mono'],
    synthwave: ['Neon', 'Midnight', 'Laser', 'Sunset', 'Retro', 'Arcade', 'Electric', 'Turbo', 'Vapor', 'Cassette'],
    pop: ['Bright', 'Candy', 'Summer', 'Lucky', 'Paper', 'Easy', 'Open', 'Sugar', 'Weekend', 'Sunny'],
    ambient: ['Glass', 'Slow', 'Pale', 'Distant', 'Quiet', 'Still', 'Silver', 'Drifting', 'Hollow', 'Tidal'],
    dnb: ['Rolling', 'Liquid', 'Rapid', 'Jungle', 'Breakneck', 'Pressure', 'Midnight', 'Blue', 'Sprint', 'Halftone'],
  };

  const SHARED = ['Velvet', 'Rust', 'Copper', 'Amber', 'Indigo', 'Paper', 'Hidden', 'Crooked', 'Lunar', 'Honey',
    'Hollow', 'Wild', 'Little', 'Odd', 'Lazy', 'Golden', 'Secret', 'Tin', 'Cobalt', 'Moss'];

  function name(role, rng, style) {
    const nouns = NOUNS[role] || NOUNS.lead;
    const styled = ADJECTIVES[style] || [];
    const adj = rng.chance(0.65) && styled.length ? rng.pick(styled) : rng.pick(SHARED);
    let noun = rng.pick(nouns);
    if (noun === adj) noun = nouns[(nouns.indexOf(noun) + 1) % nouns.length];
    return adj + ' ' + noun;
  }

  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  /** "Dusty Pocket" -> "Dusty Pocket II"; "Dusty Pocket II" -> "Dusty Pocket III" */
  function variantName(original) {
    const s = String(original || 'Untitled').trim();
    const m = /^(.*?)\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/.exec(s);
    if (m) {
      const idx = ROMAN.indexOf(m[2]);
      if (idx > 0 && idx < ROMAN.length - 1) return m[1] + ' ' + ROMAN[idx + 1];
      return m[1] + ' ' + (idx + 1);
    }
    const n = /^(.*?)\s+(\d+)$/.exec(s);
    if (n) return n[1] + ' ' + (parseInt(n[2], 10) + 1);
    return s + ' II';
  }

  Odd.gen = Odd.gen || {};
  Odd.gen.name = name;
  Odd.gen.variantName = variantName;
})(globalThis.Odd = globalThis.Odd || {});
