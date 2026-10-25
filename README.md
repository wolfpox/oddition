# Oddition

Compose music by trial and rules.

Oddition writes music for you, one stem at a time, and you decide what stays.
It works like an audition room: the booth plays a freshly generated part,
you **reject** it (and hear the next one), **vary** it, or **keep** it. Kept
parts go on the **shelf**. From the shelf you build a **song**: a sheet of
lanes (drums, bass, chords, pad, lead, arp) by sections (intro, verse,
chorus…), arranged in any order. Everything exports as standard MIDI, per
stem or as a whole song, ready for any DAW.

It is a plain web page: no install, no build step, no engine, no
dependencies. It runs offline.

## Run it

- **Easiest:** open `dist/oddition.html` in Chrome, Edge, Firefox or Safari.
  It is one self-contained file you can copy anywhere or send to someone.
- **From source:** open `index.html` directly, or serve the folder
  (`python3 -m http.server`) and visit `http://localhost:8000`.

Your work saves automatically in the browser. Use **Session › Save project
file** to keep a copy or move it to another machine.

## How it works

1. **Booth.** Pick a stem (keys `1`–`6`) and a section to audition over. Each
   take is generated from a seed, the session's style, key and mode, and the
   section's chords. Press `Space` to play, `X` to reject, `V` for a variation,
   `K` to keep, `P` to keep it and drop it straight into the song. `←` `→` step
   back through earlier takes. The controls under the pads (density,
   complexity, fills, range, arp pattern…) re-roll the current take with the
   same seed, so you can hear one idea get busier or simpler.
2. **Shelf.** Everything you keep, filterable by stem, searchable, with
   favourites. Preview a part over any section, place it, rename it, export it
   as `.mid`, or send it back to the booth for variations. Import your own MIDI
   clips here too.
3. **Song.** Lanes down the side, sections across the top. Select a slot, then
   audition for it or pick from the shelf (drag and drop works). The arrows on
   a selected slot swap through every shelf part for that stem while the music
   plays. Each lane has a sound, volume, mute, solo and MIDI channel; each
   section has a length, chords (edit them as roman numerals: `i VI III VII`),
   and an optional key shift. The strip above the sheet is the song order.

### Parts follow the chords

Pitched notes are stored as scale degrees, not fixed pitches. When a part sits
in a section with different chords, a different key, or a different mode, each
note moves to fit the chord under it. A one-bar bass riff kept over the verse
will follow the chorus progression on its own. Turn **Fit** off on a slot to
keep a part exactly as written.

### Chords from outside the key

Sections can use chords that the key doesn't contain. Type them in the chord
editor (click a section's chords):

| Write | Means | In C major |
| --- | --- | --- |
| `V` `v` | Capitals are major, small letters minor | G, Gm |
| `bVI` `bVII` `bIII` `iv` | Borrowed from the parallel minor (or major) | Ab, Bb, Eb, Fm |
| `V/V` `V7/ii` `vii°/vi` | Secondary chords: the V of another chord | D, A7, G#dim |
| `N` or `bII` | Neapolitan | Db |
| `bII7` | Tritone substitute for V7 | Db7 |
| `V7` `IVmaj7` `iiø7` `vii°7` | A seventh every part will play | G7, Fmaj7… |

Accidentals count from the major scale, as in most theory books, so `bVI` is
Ab in both C major and C minor (where it is simply `VI`). In a minor key
`V` is the major dominant and `v` the minor one.

Every part bends to the chord it is over. Over `V/V` in C the chords, bass,
pad, arp and lead all play F# instead of F, without being regenerated, and a
part moved from there to a plain `ii` goes back to F. Changing the session's
mode keeps such chords sounding the same: `bIII` in C major becomes plain
`III` in C minor.

**Harmony** in the session settings sets how often **New chords** (the dice
on a section) reaches outside the key: Plain, Some colour, Colourful or Rich.
Each style has its own default (lo-fi leans colourful, techno plain).
Repeats of a chord loop are coloured the same way each time.

### Song shape

Each section has an **energy** level, shown as the small meter next to its
bar count and as the fill behind each block in the song order. Energy is
guessed from the section's name (intro low, verse middle, chorus high, drop
highest) until you set it yourself: click the meter, or use **Energy and
entry…** in the section menu.

- At 50% parts play as written. Lower energy thins them out (quiet ghost
  notes and busy hi-hats go first, the kick on one and the backbeat stay)
  and plays softer. Higher energy plays harder, and above 80% the lead is
  doubled an octave up. Pads are never thinned.
- A section that comes back later in the song gets a little more energy each
  time, so the last chorus lifts.
- Every 4-bar phrase swells slightly, and the last bar or two of a section
  gets louder or softer when the next section's energy is higher or lower.
- **Entry** sets how the song gets into a section: straight in, a drum fill,
  a snare build over the last bars before it, or a build and then a beat of
  silence. **Auto** chooses from the jump in energy. The marks on the left
  edge of the song-order blocks show the entry each one gets.

All of this happens when the song plays or exports, so a part you kept is
never changed: move it to another section and it takes on that section's
shape. The booth always plays takes as written. Turn **Shape** off in the
session settings to hear the song exactly as the parts were written.

**Feel** (session settings) adds small timing and velocity differences, like
a person playing: drums stay close to the grid, bass sits slightly behind
the beat, chords are strummed upwards, the lead is loosest. The same notes
always get the same offsets, so playback, MIDI and audio export match. Set
it to 0% for a fully quantised export.

### Styles

Lo-fi, boom bap, trap, house, techno, synthwave, pop, ambient and drum & bass.
A style sets tempo, swing and default sounds for a session, and shapes how
every generator writes: drum grids, bass rhythms, comping patterns, chord
colour, melody density.

## Export

- **Song as MIDI**: one format-1 `.mid`, a track per lane, with tempo, key
  signature and section markers.
- **Stems as MIDI**: a `.zip` with one `.mid` per lane, each spanning the whole
  song so they line up when dropped in at bar 1.
- **Stems as audio**: a `.zip` of `.wav` files (one per lane plus the mix)
  rendered with the built-in synth.
- **Section** or **single part** as `.mid`. In Chrome you can also drag the
  booth's piano roll or a shelf card straight onto your desktop or DAW.
- **Project file** (`.oddition.json`): sessions and shelf, for backup.

Drums use General MIDI channel 10. Each lane's sound maps to a General MIDI
program, so files sound reasonable in any GM player before you pick your own
instruments.

### Play through your own instruments

In Chrome, Edge or Opera, the MIDI button sends notes live to a hardware
synth or to a DAW through a virtual port (IAC Driver on macOS, loopMIDI on
Windows). Choose whether you also hear the built-in sounds.

### Sound on phones

Phones have less processing power for audio than computers. Oddition detects
phones and tablets and plays in **Light** sound: fewer layers per note, simpler
hi-hats, a mono reverb, and bigger audio buffers. You can switch between Auto,
Light and Full under **Sound** in the session settings (the gear button on a
phone). If a device still falls behind or the browser pauses audio, playback
stops with a message and a **Play again** button rather than going silent.
WAV export always renders at full quality.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / stop |
| `X` | Reject, play a new take |
| `K` | Keep on the shelf |
| `P` | Keep and place in the selected section |
| `V` | Variation of the take |
| `←` `→` | Previous / next take |
| `1`–`6` | Drums, bass, chords, pad, lead, arp |
| `Esc` | Stop |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z` | Undo, redo |

## Develop

```
npm test             # unit tests (Node 18+, no packages needed)
npm run build        # rebuild dist/oddition.html after changing sources
```

`docs/ARCHITECTURE.md` explains the modules and data formats. In short:

```
js/core/   seeded random, music theory, rendering, MIDI files, zip, data model, export, storage
js/gen/    the generators (one file per stem) and the style presets
js/audio/  Web Audio synth and drum kits, the scheduler, Web MIDI output
js/ui/     views and helpers
js/app.js  wiring, actions, keyboard
```

Limits today: 4/4 time only, one tempo per song, and the built-in synth is
meant for auditioning rather than final mixes.
