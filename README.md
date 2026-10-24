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
