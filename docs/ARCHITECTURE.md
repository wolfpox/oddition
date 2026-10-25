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
js/gen/band.js        what a section already plays      Odd.band
js/gen/index.js       generate / vary entry points      Odd.gen
js/core/shape.js      energy, transitions, human feel   Odd.shape
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

A **progression** is `[{ deg, beats, acc?, mode?, sev? }]`, each chord lasting
`beats` quarter notes. A plain chord is just `deg` (root as a scale degree,
0–6) and is built from the scale. A chromatic chord adds:

```js
{ deg: 5, acc: -1, mode: 'lydian', beats: 4 }        // bVI in C major (Ab)
{ deg: 1, mode: 'mixolydian', sev: 1, beats: 4 }     // V7/V in C major (D7)
```

- `acc`: semitones from the scale degree to the root.
- `mode`: the chord's own scale, one of `Odd.theory.MODES` (every mode of
  major, harmonic minor and melodic minor). It fixes the chord tones and the
  notes between them, so a melody over D7 in C uses F#.
- `sev`: the seventh was written ("V7"); generators always play it.

`Odd.theory.chordAlt(chord, scale)` turns this into an accidental per scale
degree (all zeros for a plain chord). `parseChord`/`roman` read and write the
roman numerals (`bVI`, `V7/ii`, `N`). An accidental counts from the major
scale. Without one, the numeral is the scale's own degree, or the major
scale's if that needs fewer changes (`vii°7` in minor is the leading-tone
chord). `resolveChord` picks the chord scale that changes the fewest notes
of the key, which for borrowed chords is the parallel minor or major.
`roman` only writes text that reads back as the same chord.
`colorProgression` adds such chords to generated progressions
(`session.harmony`, default per style).

## Generators and chromatic chords

Generators keep writing plain scale degrees. `finalize` (in `js/gen/index.js`)
then gives each note the accidental its chord's `chordAlt` table has for that
degree. A note marked `fix: true` (bass approach notes, lead chromatic
passing notes) has a deliberate accidental and is left alone. Occurrences
(`ctx.occ`) carry each chord's `alt` table, and `goodSeventh`/`goodNinth`
take it, so 7ths and 9ths are judged on the real chord.

## Refit

Because notes are degrees, a part can play over any section. For each note,
`Odd.render` finds the chord under it in the part's own `ctx.prog` and the
chord under it in the target section, then shifts the note by the shortest
diatonic distance between the two roots (`Odd.theory.wrapDelta`). A note
whose accidental is the one its old chord gave that degree takes the new
chord's accidental instead (F# over D7 becomes F over Dm); any other
accidental is deliberate and kept. Key and mode changes come for free:
degrees are rendered in the target key and scale (`Odd.model.setScale`
re-reads chromatic chords so they keep sounding the same). Drums are never
shifted. A part shorter than its section loops.

## Listening (`Odd.band`)

A take can be generated against what its section already plays.
`Odd.band.hear(lanes, sectionLength, takeLength)` takes the other lanes'
rendered events (`[{ role, events }]`, unshaped) and lays them over the
take's length (a longer section folds onto the take, a shorter one loops
under it):

```js
{ total, steps, roles,
  kick[], bassOn[],   // per 16th step: share of passes with a kick / bass onset
  lead[],             // per step: share of passes where the lead sounds
  load,               // how busy the section is (pads and drums excluded)
  notes }             // pitched events, for register checks
```

Pass it as `req.band` to `Odd.gen.generate` (or `opts.band` to `vary`); a
band heard over another length is ignored. With a band:

- `balance` nudges density down when `load` is high, up a little when low
  (per-style quiet threshold). `part.params` keeps the value asked for.
- bass runs each bar's onsets through `lockBass` (`Odd.band.LOCK` per style:
  positive locks to the kick, negative plays between kicks); drums raise the
  kick's odds where the bass plays.
- `answer` thins arp and chord hits under a busy lead (never on a chord
  change or a beat) and lifts those in its rests.
- `clearRegister` moves chords, pad, lead or arp an octave (via
  `part.base`) when their notes overlap other parts' in time and pitch,
  unless the Octave param is set.

Each change adds a line to `part.heard`. Listening uses its own random
stream (`listen`), so the rest of the take stays what the seed gives.
The booth builds the band with `app.boothBand()`, leaving out the lane the
take is for.

## Song shape (`Odd.shape`)

Shape works on rendered events, never on stored parts, so it re-renders when
anything changes and kept parts take on the shape of wherever they sit.

```js
session.shape = { on, humanize, lift }   // on: energy + transitions; humanize 0..1; lift: repeats gain energy
section.energy = 0..1 | null             // null: guessed from the name (Odd.shape.autoEnergy)
section.entry  = 'auto' | 'none' | 'fill' | 'build' | 'gap'
```

- `Odd.shape.plan(session)` resolves the song order into
  `[{ index, section, start, end, energy, entry, delta }]`: repeat lift
  applied, `auto` entries resolved from the energy jump.
- `Odd.render.sectionEvents` runs `shapeLane` on each lane: low energy drops
  the least important onsets (by place in the bar, velocity and drum type;
  chord notes go together), velocity scales with energy, each 4-bar phrase
  swells a little, and the section's end ramps towards the next section's
  energy. Pass `shape: false` for raw events (the booth does).
- `Odd.render.songEvents` then runs `transitions`: drum fills (the style's own
  fill kinds, via `Odd.gen.roles.drums.writeFill`), snare builds, a silent
  beat for `gap`, and a crash where a drum lane lands in the new section.
- `Odd.render.perform(session, events, opts)` is the last step for both
  playback (`Odd.render.sequence`) and export: swing, then `humanize`.
  Humanize offsets are hashed from each note (track, tick, pitch), so the
  same song always renders identically, and stems match the mix. Swing
  runs first because it looks for notes on exact 16th positions.

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

Live sound has two qualities (`Odd.audio.setQuality('auto' | 'light' |
'full')`). Light, the default on phones and tablets, drops the costliest layers
of each patch, uses a mono reverb, fewer voices, control-rate filters, larger
output buffers (`latencyHint: 'playback'`) and a 300 ms scheduling lookahead.
The transport watches the audio clock: if it stops advancing for 2.5 s while
playing, it stops and emits `stall`, and the app offers a restart on a fresh
context.

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
