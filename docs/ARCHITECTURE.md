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
js/gen/drums.js ...   one file per role (perc.js too)   Odd.gen.roles.<role>
js/gen/band.js        what a section already plays      Odd.band
js/gen/index.js       generate / vary entry points      Odd.gen
js/core/shape.js      energy, transitions, human feel   Odd.shape
js/core/render.js     part -> playable events (refit)   Odd.render
js/core/edit.js       keep bars, add/remove notes       Odd.edit
js/core/midi-file.js  Standard MIDI File writer/reader  Odd.midiFile
js/core/zip.js        store-only .zip writer            Odd.zip
js/core/model.js      workspace, sessions, sections     Odd.model
js/core/idea.js       the core of parts: ideas          Odd.idea
js/core/harmonise.js  melody first: chords from a tune  Odd.harmonise
js/core/relate.js     who leads: roles and links        Odd.relate
js/core/audition.js   Bones to Gold engine and flow      Odd.audition
js/core/songmaker.js  Song Builder: songs from ideas    Odd.songmaker
js/core/recipes.js    section types (intro builds...)   Odd.recipes
js/core/export.js     .mid / .zip / project builders    Odd.exporter
js/core/store.js      localStorage autosave, undo       Odd.store, Odd.history
js/audio/synth.js     Web Audio instruments + mixer     Odd.audio, Odd.synth
js/audio/webmidi.js   optional Web MIDI output          Odd.webmidi
js/audio/transport.js lookahead scheduler               Odd.transport
js/ui/*.js            dom helpers, icons, piano roll,   Odd.dom, Odd.icon,
                      view builders                     Odd.roll, Odd.views
js/ui/bones.js        the Bones to Gold screen          Odd.bones
js/ui/home.js         the home screen, Bobby's menu     Odd.home
js/ui/song.js         the Song Builder screen           Odd.song
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

## Song structure: slot spans and section types

A slot can play only some bars of its section:

```js
slot = { part, sourceId, oct, refit, from?, to? }   // bars; from inclusive, to exclusive
```

No `from` means bar 0, no `to` means the section end, and `from >= to`
means the part sits the section out (it stays in the slot).
`Odd.model.slotSpan(section, slot)` reads it as `{ from, to, full, out }`,
`setSlotSpan(section, laneId, from, to)` writes it (a full span stores
nothing). `Odd.render.sectionEvents` renders a late part over the chords
of its own bars (`T.sliceProg`), so it starts from its own top; a section
rendered longer than itself (the booth) repeats the span each pass
(`spanWindows`). `placePart` keeps the span when a part is swapped.

`slot.form` plays a part another way in one section (`Odd.render.FORMS`:
outline, tease, fragment, half; none = as written). `formNotes` reshapes
the part's notes before looping and marks each with `st`, its original
time, so refit still reads the chord it was written over.
`Odd.model.reuseSlot(session, sectionId, laneId, { [sectionId]: form })`
places the same shelf part in other sections; `themes(session)` letters
the recurring material (lead and arp parts, or any part in another form).

`Odd.recipes` (js/core/recipes.js) holds the section types. A type is
data: waves of roles that enter (`enter: [{ roles, at }]`) or leave
(`leave`) at a fraction of the section (snapped to 4-bar phrases in long
sections, 2 in 8-bar ones), what happens to unnamed lanes (`rest`), and the
section's `curve`, `energy` and `exit`. `apply(session, section, id)`
writes those into the section, borrows slots from another section when it
has fewer than three parts (`borrow: 'next' | 'peak' | 'prev'`, `needs`),
and records `section.recipe`. `describe()` turns a section's spans into the
sentence shown above the sheet. `kindOf(name)` picks which types are
suggested.

## Ideas (`Odd.idea`)

An idea is the core of some music: what is left once key, chords, exact
pitches, register, sound and feel are taken away. Influence lives in parts;
the idea keeps them as source material.

```js
idea  = { id, name, bars, voices: [voice], style, from, created, starred, tags }
voice = { role, name, sourceId, part, oct, form, core }   // part: copy as found (or null)
core  = { len, drum, hits: [{ t, d, w, h }], land, root }
```

- `t`, `d`: onset and length in ticks.
- `w`: weight 0 ghost / 1 normal / 2 accent. A score from velocity (relative
  to the voice's own range; flat dynamics count as middling), place in the
  bar (`metric`: downbeat 1, beat 3 0.75, other beats 0.5, off-beat 8ths
  0.25) and, for pitched voices, length.
- `h`: pitched, scale steps from the first note (accidentals dropped: they are
  colour, not contour). Drums, 0 low / 1 mid / 2 high (`drumClass`).
- `land`: the hit the voice heads for (`landing`): a long note on a strong
  beat late in the idea; for drums a strong low or mid hit late in the cycle.
- `root`: the first note's degree, only so the bones can sound in a key.

A pitched voice is one line: where notes start together, the top note is the
line (the bottom one for bass). Drums keep one hit per onset and height.
`extract(part, { form })` reads a part as it was played where it was found,
form included; `voiceFrom({ part, oct, form, sourceId })` builds a voice.
The core is invariant under key, register and chord changes (tested), which
is what makes it the idea's identity.

`fromParts(sources)`, `split(idea, i)`, `join(ideas)` and `removeVoice` make
and reshape ideas. `describe(voice)` says a core in words. `events(idea, {
mode: 'bones' | 'full', tonic, scale, mute, prefix })` renders one track per
voice: bones sound the core plainly (pitched contour as plain scale steps from
`root` in the voice's register, drums as kick/snare/hat, velocity from weight);
full renders each voice's part over its own `ctx.prog` in the session key.
The app plays bones straight (no swing or humanize) and full through
`Odd.render.sequence`. `repair` cleans loaded ideas (`Odd.model.migrate`
calls it, rebuilding a missing core from its part).

The ladder (`RUNGS`: rhythm, shape, notes, harmony, sound, band) hears an
idea one layer at a time. `voiceAt(voice, rung, { tonic, scale, prog,
length })` gives one voice's events at a step: rhythm puts every hit on one
sound (the first note's pitch, or a side stick for drums, one tap per onset);
shape is the bones; notes is the part as written over its own chords; harmony
refits it to `prog` (imported parts keep their notes); sound and band play the
same notes. `rungEvents(idea, { rung, ..., mute, prefix })` does every voice.
The app (`ladderSeq` in `js/app.js`) plays steps up to harmony plain and
straight, switches to the lane sounds with `Odd.render.sequence` at sound,
and at band adds the section's other lanes (those the voices don't take over)
and runs the voices through `Odd.shape.shapeLane` at the section's energy.
Every step is rendered over the same length (the longer of the idea and the
section), so `Odd.transport.update` swaps steps without losing the beat.
`Odd.roll.stack` draws each step, one band per lane.

Ideas are stored in `workspace.ideas` (`Odd.model.addIdea`, `findIdea`,
`removeIdea`), saved and undone like everything else, and synced by the
hosted build as one document each (`kind: 'idea'`).

## Who leads (`Odd.relate`)

Primacy is measured on two axes per part of a section, from the events the
section plays (muted lanes left out; only soloed lanes if any are soloed):

- **Salience** (`salienceOf`): 0.4 role prior + 0.2 height (mean pitch of the
  line) + 0.2 motion (how often the line changes pitch, times how busy it is)
  + 0.2 space (share of its onsets where no other melodic part starts)
  − 0.1 repetition (bars that repeat an earlier bar). `rel` is salience over
  the section's highest. A part stands out at `rel >= STAND` (0.85) if it is
  also in the top half by salience.
- **Authority**: `1 − Π(1 − strength · PULL[kind])` over the links pointing
  at the part. It steers at `>= STEER` (0.45).

A link goes from a follower to the part it fits to:

- `lock`: the follower's off-beat onsets land on the other's (drums offer
  their kick, or kick and snare together). The score is above chance, and it
  shrinks below 8 onsets. Both ways at once is a `pair` (mutual).
- `avoid`: onsets keep off a kick that is there at least 12% of the time.
- `answer`: the follower sounds mostly while the other rests. Both ways is a
  `trade` (mutual).
- Logged: `part.heard` lines are parsed by the `HEARD` table into `lock`,
  `avoid`, `answer` and `clear` links to the lane of the named role.
  `balance` lines stay notes. A logged answer turns a measured trade into
  a one-way answer. A test checks that every line the generators write is
  understood.

Each follower keeps its two strongest links. Pitched lanes that refit are
listed in `harmony.follow` and the others in `harmony.own`; these links point
at the chords, not at a lane, and give no authority. `analyse(lanes, {
length })` is the pure core, `forSection(session, section)` reads a section,
and `song(session)` measures each section of the song order once. `top` is
the part with the most primacy: a hook, else the top topline, else the
strongest groove. The views draw the boxes on sheet cells, the headline in
the section story, and the dialog (`fitDialog` in `js/app.js`): the plane,
links in words, and the strip across the song.

When a tune sets the section's chords, `sectionLanes` marks it `leads`, and
every pitched lane that refits gets a `harmony` link to it (strength 1 for
chords and pad, .85 bass, .7 others; `PULL.harmony` .8). These links are not
capped at two. `harmony.leader` names the tune, which leaves `own`.

## Melody first (`Odd.harmonise`)

`harmonise(events, { tonic, scale, bars, rate, color, variant, prev })` picks
chords for a tune. Each half-bar slot scores every candidate chord: the
scale's own triads (prior cost 1 for dim, 1.6 for aug), plus a few colours per
family (major: V7, iv, bVI, bVII, V/V, V/vi, V/ii, V7/IV; minor: V, V7, IV,
V/iv, V/III) with a prior cost scaled by `1.6 − color`. A note scores 1.1 on
the root, 1 on the 3rd or 5th, .9 on an asked-for 7th, .3 on the chord's own
7th, −1 a semitone off a chord tone and .05 otherwise. Its weight is its
length in the slot (at least an 8th for a note that starts there, at most 2
beats) times an accent (1.6 on the slot start, 1.25 on a beat, 1 on an 8th,
.7 otherwise, .6 when held over). A Viterbi pass finds the best path: a change
costs .3 + prior + mid-bar cost (.1 at rate 2, .8 at rate 1, 1.4 at rate .5)
+ root motion (−.15 down a fifth; a secondary chord −.3 into its target, .4
elsewhere). Costs scale with the median slot weight, so a sparse tune can
still change chord. Slot 0 favours the tonic; the last slot favours V, IV or
VII. Where the tune is quiet, the chord `prev` had there scores up to .9.
`variant > 0` adds seeded noise until the path changes. Same input, same
output.

`section.lead = { lane, variant, prev, refit }`. `lead()` stores the old
chords and fit, sets the slot's `refit` false (the tune plays as written; its
notes never depend on the chords made from it) and writes `section.prog`.
`sync(session)` runs after every `commit` in the app and re-works the chords
of each led section, or `release`s a lead whose part is gone. `release()`
restores `prev` and the old `refit`; `{ keep: true }` keeps the chords and the
tune's own notes (used when the user writes chords). `vary()` steps the
variant. Because the derived progression is stored in `section.prog`,
playback, export and the views need no special case. The booth asks
`app.leadProg(part, lane)`: a take for the leading lane plays with
`refit: false` over the chords it would give, and so does the band behind
it. `migrate` keeps a lead only while its slot exists; `setScale` rescales
`prev` too.

## Bones to Gold (`Odd.audition`, `Odd.bones`)

`body[data-screen]` is `home`, `bones`, `song` or `studio`; the app always opens on
`home` (`Odd.home`: the logo, Bobby, his menu of Idea Builder, Song Builder
and Session Takeover). `setScreen()` in `js/app.js` switches, stops whatever
the other screen plays, and remembers the last working screen in
`ws.prefs.screen`. The studio's document click handler ignores clicks inside
`#bones`, `#home` and `#songb`, and `onKey` hands keys to `Odd.home.onKey`,
`Odd.bones.onKey` or `Odd.song.onKey` while those screens show. The logo and Bobby's drawing live
in `Odd.brand` (`js/ui/icons.js`); every top bar's logo is a
`data-act="home"` button.

`Odd.audition` is pure (Node-testable). An idea is built bottom up and each
layer is made only from the layers below it; there is no style until the
**sound** layer picks one. Fixed assumptions: 4/4, 2 bars, a 16th grid
(`STEPS` 32, 120 ticks a step), key of C, 100 BPM until a sound is picked.

```
idea   = { melody, layers: { chords, bass, perc, beat, pads, sound }, order: [dir] }
melody = { r: { id, hits: [[step, length, weight 0-2]], n, off }, scale, shape }
shape  = { kind, amp, start }   null after round 1 (the plain walk)
round  = { dir, batch, steer: { p, s, x } }
```

- **seed1** (rhythm and scale): `rhythmPool()` makes 80 seeded rhythms from
  density × push (per-beat cells: quarter, 8ths, off-beat, 16ths, dotted,
  syncopated, anticipation, rest, hold; bar 2 echoes bar 1), deduplicated.
  Scales run dark to bright: phrygian, minor, harmonic, dorian, penta,
  mixolydian, major, lydian. The melody is `WALK` up and down from home.
- **seed2** (shape): 18 shape kinds × 4 amplitudes, in scale steps, no more
  than an octave. The small kinds (lean, sigh, chant, step up/down) use the
  rhythm's weights to move on strong notes. `shapeOptions` picks one that
  falls, one that ends level and one that rises, and gives them a size each
  (`sizeOf(range)`: small ≤ 2, medium 3–4, big ≥ 5): one of each by default,
  all small for `steer.s < 0`, medium to big for `steer.s > 0`. The size
  order and the shape in each place are shuffled from the rhythm id and the
  batch. By default only leaps ≤ 2. The landing is the root when the shape
  falls, the 5th when it rises, else the 3rd; `start` is solved so the last
  note lands there.
- **chords**: one triad per half bar, scored against `slotWeights` (how long,
  where and how strongly each pitch class sounds in the slot); every 4-chord
  path is enumerated, with colour chords borrowed from outside the scale.
  The top 24 that differ in 2+ slots form the pool (`fit`, `bright`,
  `changes`).
- **bass, pads, perc, beat**: small style banks built against the melody's
  notes and the chords (`chordsFor`: the picked ones, else the best fit),
  each with the feature its round spreads on (`lock`, `voices`, `n`, `off`).
- **sound**: genres ranked by how well they suit the rhythm (density, push,
  note length), each a tempo, swing and patch set.

`spread(cands, steer, batch)` gives three options along `a`, the layer's
telling difference: the low end, the high end and the nearest the middle.
`steer.p` / `steer.s` halve the pool toward one end of `a` / `b` first;
`batch` (Three more) takes the next nearest, up to six batches before
repeating. `REQS` maps each request to a steer (`x` is a filter such as
`colour`, `home`, `follow`).

`flow` steps the screen state without side effects: `enter`, `pick`,
`keepWalk`, `more`, `request`, `back`, `skip`, `finish`, `keepBuilding`,
`repair`. State is `{ phase: start | round | next | gold, idea, round, hist,
hid, sel, seq, anim, ... }`; `hist` (newest first, capped at 80) keeps each
round's options with the idea and round they were offered in, so `back()`
restores exactly that round. Picking a new shape clears the layers above it.

`seq(idea, aud)` builds a looping transport sequence on tracks `b2g-*`; while
one option is auditioned (`aud = { dir, spec }`) the other layers play at .6
and the melody at .75. Swing above .5 delays the "and" 16ths.
`climbSeq(idea)` is one non-looping sequence: the bones, the melody, then
each layer, each pass time-stretched to keep its own tempo at the final BPM.
`toParts(idea)` makes studio parts (scale `penta` stored as major, chords as
a `prog` via `theory.resolveChord`) for `Odd.idea.fromParts`; the saved idea
keeps the recipe as `idea.bones`.

`Odd.bones` draws the screen into `#bones`, rebuilding the DOM only when the
round changes (`phase|seq|hid|anim|...`) and patching lift, play and wait
classes in place so cards animate. `hear(key)` plays at once from silence;
from sound it stops, lowers the card, waits `PAUSE_MS` (2 s) with a Bobby
line, then lifts and plays. Its state autosaves to `localStorage`
(`oddition.bones.v1`), apart from the workspace.

## Song Builder (`Odd.songmaker`, `Odd.song`)

`Odd.songmaker` is pure (Node-testable) and renders through the real engine
(`Odd.render.partEvents`, `Odd.shape`, `applySwing`, `humanize`). A song is
stored in `ws.songs` (and `ws.prefs.songId`); `repair()` cleans it on load.

```
song = { id, name, main: idea copy, guest, role, kw, secs, nid, lv, created, updated }
         main.voices[i].added / .removed: layers added in the Song Builder (removed
         ones stay in place so every 'v<i>' key keeps its meaning); lv counts them
sec  = { id, name, named, kind, open, body: cfg | null, intro: { k, bars } | null, outro, hist, tag }
cfg  = { src, bars, arr, lay: { v<i>: { on, form } }, tw: { key: { x, ds, oct } },
         half, shift, bpm, swing, energy, curve, twists, edit }
```

`context(song, env)` builds `C`: the idea's layers in its own key (`tonic` 0,
its scale and progression), the guest moved into that key, track patches from
the idea's sound. `renderSection(C, sec, next)` (cached) gives the intro,
body and outro events; an outro that hands off borrows the next section's
rhythm. `sequence()` stretches every piece to the song tempo, so each section
can keep its own BPM. Options come from `allActOptions` (build up, substance,
finish; ranked by the keywords and a few contextual bonuses, `bobbyPick`
first) and `toolOptions` (Vibe, Idea, and Tweak: every form and tweak of one
layer, all at once); every option has `make(sec)` returning a patch, and its
preview is the section rendered with it. `layerOptions(C, song, role)` makes
three takes on a new layer: `Odd.audition.options` against the idea's
`bones` when it came from the Idea Builder, `Odd.gen.generate` (hearing the
idea through `Odd.band`) otherwise. `addLayer` appends the voice and turns
it on in open sections; new chords move the melody's `ctx` onto them so it
stays as written while older layers refit. `timeline()` gives each
section's place in the song sequence, for the transport.
`analyse()` gives stats, the chart and suggestions with a `go` target.
`midi(C, song)` writes one track per layer.

User control sits beside Bobby's options. `DIALS` (tempo, key shift,
energy, curve, swing) are stepped with `stepDial` or set with `setDial`;
both go through `patchSec(song, id, ch, tag)`, and repeats of the same tag
share one undo snapshot. `renameSec` sets `named`, so a substance option's
`make(sec)` keeps the user's name. `moveSec` swaps neighbours; `removeSec`
returns `removed: { sec, at }` for `insertSec` to put back. `actOptions(...,
'all')` ranks the whole pool (the first three match the normal batch);
`isCurrent` says which option the section has now (a way in or out by kind,
a substance by canonical equality of the body). `nowSeq(C, song, sec, o)`
is the same stretch `previewSeq` plays for `o`, with the section as it is;
the screen flips between the two (`P.ab`), keeping the position (a way in
is aligned on where the section lands). `clearTwists` removes twists from
the Bar Builder's bars.

`Odd.song` draws `#songb` as HTML strings and redraws on each change, keeping
focus and the strip's scroll. It plays through `Odd.transport` with the same
2 s pause rule as Bones to Gold, and saves through `host.saveSong`. The pause
is drawn as a handover: `settle(down, up, ms)` records a sink (from wherever
that card is) and a rise in `P.sinks` / `P.rise`, and `lift(key, up)` gives a
card its class plus a negative `animation-delay`, so a redraw mid-pause picks
the motion up where it was. The CSS animates a registered `--up` (0 to 1) that
drives the card's lift, scale, glow and border. The
transport keeps a playhead (`P.head`, ticks): Play starts there, Stop keeps
it, the timeline moves it; a playing song or section is updated in place
(`Odd.transport.update`) on every change.

The app's document click handler skips clicks that started in `#songb`,
`#bones` or `#home` by the event's `composedPath()`: those screens redraw on
click, so the clicked element may already be gone from the page, and their
action names (`play-song`, `vary`, `undo`, `export`) also exist in the Studio.

## Song shape (`Odd.shape`)

Shape works on rendered events, never on stored parts, so it re-renders when
anything changes and kept parts take on the shape of wherever they sit.

```js
session.shape = { on, humanize, lift }   // on: energy + transitions; humanize 0..1; lift: repeats gain energy
section.energy = 0..1 | null             // null: guessed from the name (Odd.shape.autoEnergy)
section.entry  = 'auto' | 'none' | 'fill' | 'build' | 'gap'
section.exit   = 'auto' | same as entry  // how the next section is entered when its entry is auto
section.curve  = 'flat' | 'rise' | 'fall' | 'swell' | 'dip'
```

- `Odd.shape.plan(session)` resolves the song order into
  `[{ index, section, start, end, energy, entry, delta }]`: repeat lift
  applied, `auto` entries resolved from the energy jump.
- `curveAt(e, curve, x)` is the energy at fraction x of a section: rise
  climbs from `e - 0.4` to `e`, fall the reverse, swell and dip move in the
  middle. `shapeLane` thins and scales each bar by its own energy.
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
Odd.gen.ROLES                 // ['drums','perc','bass','chords','pad','lead','arp']
Odd.gen.roleInfo[role]        // { label, short, base, defaultPatch }
Odd.gen.params(role)          // slider/select specs for the booth UI
Odd.gen.generate(req) -> part // req: { role, style, seed, bars, tonic, scale, prog, params }
Odd.gen.vary(part, { seed, amount }) -> part
```

`drums` and `perc` are drum roles (`Odd.theory.isDrumRole`): their notes
are GM drum notes (`p`), they play on channel 10 and they never refit. Both
take `touch` and `accent` params, applied by `Odd.gen.dynamics` before
`finalize`: accent spreads velocities away from 76, touch scales them, and
both are neutral at 0.5 so older parts are unchanged. The percussion
generator (`js/gen/perc.js`) picks a main instrument family (weighted per
style by `style.perc.kits`, or the `kit` param), one of its traditional
patterns, and texture layers as density rises. Its grids add `g` (ghost tap)
and `h` (ghost tap half the time) to the drum grid characters.

The synth turns velocity into timbre as well as level: every drum voice
gets `vel` (0..1) and opens filters, adds attack noise and raises the
starting pitch on hard hits. Hand drums (`dHand`) use it as articulation:
GM 62 is a soft heel tap or a hard slap, open tones gain a slap edge when
struck hard.

Generators are deterministic for a given request. Each part also records
`seeds`, one per internal random stream (motif rhythm, motif pitch, form,
fills...). `vary()` re-rolls some streams and keeps the rest, which is why a
variation keeps the hook of a melody but changes how it develops.

## Booth edits (`Odd.edit`)

`splice(old, new, lockedBars)` joins two takes of the same role, length and
chords: the old one's notes in locked bars, the new one's elsewhere, cut at
the borders. The booth runs every new take (Reject, Vary, a control change)
through it while bars are locked. `addNote(part, target, { t, d, p, v })`
takes a pitch as the booth shows it over `target` (a section) and stores it
as a degree in the part's own frame, undoing the refit, so it plays where it
was drawn. `removeNote` / `setVelocity` work on note indices: the booth
renders with `withIndex: true`, which gives each event `i`. `Odd.roll.draw`
keeps its layout on the canvas and `Odd.roll.hit(canvas, x, y)` maps a
pointer to `{ t, p, row, hit }`.

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

The whole workspace (shelf, ideas and sessions) autosaves to `localStorage` and can be
exported or imported as a `.oddition.json` file. Every change made through
`commit()` in `app.js` snapshots the workspace first, which is what undo and
redo restore. Takes in the booth are scratch state and are not saved.
