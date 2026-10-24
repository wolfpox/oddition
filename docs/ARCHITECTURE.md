# Oddition architecture

Oddition is a static web app: plain HTML, CSS and JavaScript with no
libraries, no build step and no server. Open `index.html` in a browser.

All scripts are classic `<script>` files (not ES modules) so the app also
works from `file://`. Each file attaches to one global namespace:

```js
(function (Odd) {
  'use strict';
  // ...
  Odd.something = { ... };
})(globalThis.Odd = globalThis.Odd || {});
```

The same files load in Node for tests (`require('./js/core/theory.js')`).
Nothing outside `js/audio` and `js/ui` may touch `window`, `document` or Web
Audio.

## Load order

```
js/core/rng.js        seeded PRNG                       Odd.rng
js/core/theory.js     scales, degrees, progressions     Odd.theory
js/gen/styles.js      genre presets                     Odd.styles
js/gen/names.js       part names                        Odd.gen (names)
js/gen/drums.js ...   one file per role                 Odd.gen.roles.<role>
js/gen/index.js       generate / vary entry points      Odd.gen
js/core/render.js     part -> playable events (refit)   Odd.render
js/core/midi-file.js  Standard MIDI File writer/reader  Odd.midiFile
js/core/zip.js        store-only .zip writer            Odd.zip
js/core/model.js      workspace, sessions, sections     Odd.model
js/core/export.js     .mid / .zip / project builders    Odd.exporter
js/core/store.js      localStorage autosave, undo       Odd.store, Odd.history
js/audio/synth.js     Web Audio instruments + mixer     Odd.audio, Odd.synth
js/audio/webmidi.js   optional Web MIDI output          Odd.webmidi
js/audio/transport.js lookahead scheduler               Odd.transport
js/ui/*.js            dom helpers, icons, piano roll,   Odd.dom, Odd.icon,
                      view builders                     Odd.roll, Odd.views
js/app.js             state, actions, playback, boot    Odd.app
```

`js/platform/artifact.js` is only bundled into the hosted build
(`node tools/build.js --fragment --platform js/platform/artifact.js`). It sets
`Odd.platform.download` (save prompts through the host) and
`Odd.platform.sync` (workspace kept in the host's per-user store). The plain
app never loads it and falls back to browser downloads and `localStorage`.

## Units

- Ticks: 480 per quarter note (`Odd.theory.PPQ`). 4/4 only: 1 bar = 1920
  ticks, a 16th step = 120 ticks.
- Velocity: 1–127. Pitch: MIDI note 0–127.

## Notes and parts

Pitched notes are stored as **scale degrees**, not MIDI pitches:

```js
{ t, d, v, deg, acc }   // pitched: t/d ticks, deg scale degree, acc semitone offset
{ t, d, v, p }          // drums: p = General MIDI drum note (channel 10)
```

`deg 0` is the tonic. `deg 7` is the tonic an octave up and `deg -1` the
seventh below. MIDI pitch is
`Odd.theory.pitchOf(deg, acc, tonic, scale, base)`, where `base` is a C (a
multiple of 12) chosen per part to set its register.

A **part** is one generated clip for one stem role:

```js
{
  id, name, role,        // role: drums | bass | chords | pad | lead | arp
  style, seed, bars,     // bars: 1 | 2 | 4 | 8 | 16
  params,                // generator settings used (density, complexity, ...)
  ctx: { tonic, scale, prog },  // harmony it was written against
  base,                  // register anchor (null for drums)
  notes: [...],
  created, starred, tags
}
```

A **progression** is `[{ deg, beats }]`: chord roots as scale degrees (0–6),
chords built from the scale, each lasting `beats` quarter notes.

## Refit

Because notes are degrees, a part can play over any section. For each note,
`Odd.render` finds the chord under it in the part's own `ctx.prog` and the
chord under it in the target section, then shifts the note by the shortest
diatonic distance between the two roots (`Odd.theory.wrapDelta`). Key and
mode changes come for free: degrees are rendered in the target key and scale.
Drums are never shifted. A part shorter than its section loops.

## Generators (`Odd.gen`)

```js
Odd.gen.ROLES                 // ['drums','bass','chords','pad','lead','arp']
Odd.gen.roleInfo[role]        // { label, short, base, defaultPatch }
Odd.gen.params(role)          // slider/select specs for the booth UI
Odd.gen.generate(req) -> part // req: { role, style, seed, bars, tonic, scale, prog, params }
Odd.gen.vary(part, { seed, amount }) -> part
```

Generators are deterministic for a given request. Each part also records
`seeds`, one per internal random stream (motif rhythm, motif pitch, form,
fills...). `vary()` re-rolls some streams and keeps the rest, which is why a
variation keeps the hook of a melody but changes how it develops.

## Audio (`Odd.audio`, `Odd.synth`, `Odd.transport`)

Built-in synthesis only (no samples). Patches have ids such as `kit-808`,
`bass-sub`, `epiano`, `pad-warm`, `lead-square`, `pluck`. The transport plays
a flat, sorted event list:

```js
Odd.transport.play({
  bpm, length, loop,                       // length in ticks
  events: [{ t, d, p, v, track }],         // absolute pitches, ticks
  tracks: { [track]: { patch, volume, mute, solo, channel } },
}, { startTick })
Odd.transport.update(seq)   // swap the sequence without stopping
Odd.transport.stop()
Odd.transport.position()    // current tick
```

Offline rendering (WAV export) uses the same patches and effects:
`Odd.audio.renderOfflineMany(seqs, opts, onEach)` renders several sequences
in parallel, as many at once as a memory budget allows (one at a time on
phones), and stops cleanly if one fails. `Odd.audio.encodeWavAsync` encodes
in slices so the other renders and the UI keep moving. Live playback and
offline renders pick a track's sound with the same rule,
`Odd.synth.resolvePatch`.

## Booth playback

The booth plays the current take on a temporary track (`__take`) that uses the
target lane's sound, volume and channel. With "Play with the section" on, the
section's other filled slots play too (the target lane is left out, since the
take replaces it) and the loop runs for the longer of the take and the
section.

## Persistence

The whole workspace (shelf + sessions) autosaves to `localStorage` and can be
exported or imported as a `.oddition.json` file. Every change made through
`commit()` in `app.js` snapshots the workspace first, which is what undo and
redo restore. Takes in the booth are scratch state and are not saved.
