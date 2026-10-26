# Oddition

Compose music by trial and rules.

Oddition writes music for you, one stem at a time, and you decide what stays.
It works like an audition room: the booth plays a freshly generated part,
you **reject** it (and hear the next one), **vary** it, or **keep** it. Kept
parts go on the **shelf**. From the shelf you build a **song**: a sheet of
lanes (drums, percussion, bass, chords, pad, lead, arp) by sections (intro, verse,
chorus…), arranged in any order. Everything exports as standard MIDI, per
stem or as a whole song, ready for any DAW.

It is a plain web page: no install, no build step, no engine, no
dependencies. It runs offline.

## Run it

- **Easiest:** open `dist/oddition.html` in Chrome, Edge, Firefox or Safari.
  It is one self-contained file you can copy anywhere or send to someone.
- **From source:** open `index.html` directly, or serve the folder
  (`python3 -m http.server`) and visit `http://localhost:8000`.

The page opens on the song sheet, with the booth and the shelf below it.
The top bar holds tempo, key, mode, style and volume; **More settings**
opens harmony, swing, feel, song shape and sound quality. The **i VI**
button on the song panel switches chords between roman numerals and chord
names (Am F C G); you still type numerals to edit them.

Your work saves automatically in the browser. Use **Session › Save project
file** to keep a copy or move it to another machine.

## How it works

1. **Booth.** Pick a stem (keys `1`–`7`) and a section to audition over. Each
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

### Keep bars, edit notes

Under the booth's piano roll:

- **Keep bars**: lock the bars you like (1, 2, 3…). **Reject** and **Vary**
  then only change the other bars, so you can keep a great first bar and
  re-roll the answer to it. Locks stay on until you switch stem or length.
- **Edit notes**: click empty space to add a note, click a note to remove
  it, drag a note up or down to play it harder or softer. Drum rolls show
  the main kit rows even when empty, so you can add a sound that isn't
  there yet. An edited take is marked *edited*; Keep stores the edit.

To edit a part that is already in the song, open it from its shelf card's
menu (**Open in the booth**), edit it, and use **Keep & place**.

### Parts follow the chords

Pitched notes are stored as scale degrees, not fixed pitches. When a part sits
in a section with different chords, a different key, or a different mode, each
note moves to fit the chord under it. A one-bar bass riff kept over the verse
will follow the chorus progression on its own. Turn **Fit** off on a slot to
keep a part exactly as written.

### Takes listen to the section

With **Listen to the section** on (in the booth, next to Play with the
section), a new take hears the parts already in the section it is
auditioned over and fits around them:

- The bass puts its notes on the kick drum, or plays between the kicks in
  house and techno. New drums lean their kick onto the bass.
- A busy section gets sparser takes; a near-empty one gets slightly busier
  ones. Ambient stays sparse.
- Chords, pad, lead and arp move an octave if another part already crowds
  their register (unless you set the Octave control yourself).
- The arp and chords leave room while the lead plays and answer in its rests.

The booth says what a take did under its name ("Locks to the kick"). Only
new takes listen: parts you kept never change. Turn it off to hear takes
written on their own.

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

### Section types: how a section sets up or pays off

Real intros don't all work the same way. Some build for sixteen bars, some
open on the hook, some start with a lone riff. Click **Choose a type…** under
a section's name (or **Section type…** in its menu) to pick one:

| Section | Types |
| --- | --- |
| Intro | Slow build, Hook first, Riff first, Drums first, Burst in, Atmosphere |
| Verse | Full groove, Sparse start, Pocket |
| Pre-chorus | Lift, Hold back, Drop out |
| Chorus | Full band, Hook lands alone, Climb |
| Break / bridge | Breakdown, Strip and rebuild |
| Outro | Strip down, Fade out |

The types for the section's name come first; every other type is under
**Other types**. A type only writes ordinary settings, which you can change
afterwards:

- **Which bars each part plays.** Parts come in and drop out on phrase
  boundaries. Select a slot and use **Bars** to set it by hand: where the
  part comes in, where it stops, or that it sits the section out. A part
  that comes in late starts from its own first bar. The thin line under a
  part's name shows the bars it plays.
- **How the energy moves across the section**: steady, rise, fall away,
  swell or dip (also under **Energy and entry…**).
- **How the song leaves the section**: a pre-chorus set to Lift always
  hands over with a snare build, Hold back with a build and a gap. The next
  section's own Entry setting still wins when it isn't Auto.

When a section has fewer than three parts, its type borrows from another
section: an intro takes parts from the section it leads into, Hook first
copies the lead from the chorus, an outro from the section before it. The
message after applying says what was borrowed.

The line above the sheet tells you what the selected section does, for
example *Intro · Slow build · energy: rise — Pad, Chords throughout · Drums
from bar 5 · Bass from bar 13*.

### Themes: set it up, pay it off

Songs feel written when material comes back: the chorus hook hinted at in
the intro, a fragment of it looping under the pre-chorus, the whole thing in
the chorus. Select a part on the sheet and press **Reuse** to place it in
other sections, each in a **form**:

| Form | Plays |
| --- | --- |
| As written | the part unchanged |
| Outline | only the notes on the beat, each held: the bones of the idea |
| Tease | the first bar of every two, then a gap |
| Fragment | the first bar, over and over |
| Half-time | the first half of the part stretched over the whole |

**Suggest forms** fills in a guess from each section's name (outline in an
intro, fragment in a pre-chorus, half-time in an outro). **Form** on a
selected part changes how it plays in that section alone. Every section
still follows its own chords.

A lead or arp that plays in more than one section, and any part that comes
back in another form, gets a letter (A, B…) on the sheet so you can see
the themes at a glance; hover it to see where else it plays.

### Ideas: the core of the music

Under every part is a simple idea: when its notes fall, which of them are
strong, which way the line moves, and the note it heads for. Key, chords,
exact pitches, register, sound and feel are layers on top. Oddition can pull
that core out and keep it in an **idea library** (the **Ideas** side of the
shelf).

An idea can hold more than one part. You often hear a part *with* others, and
the combination is the idea: a kick and a bass locked together, or a riff
answering a lead. Ways to capture one:

- **In the booth**: **Capture idea** (`I`). With *Play with the section* on,
  the parts you hear the take with are ticked too; untick what doesn't belong.
- **On the song sheet**: **Capture an idea from this section…** in a
  section's menu.
- **On the shelf**: **Capture as an idea** in a part's menu.

Each idea card draws its voices from their cores alone. Pitched voices show
their contour (a dash per note at its height). Drums show low, mid and high
hits. Bigger dots are stronger notes, and a ring marks where each voice lands.
Under the drawing, each voice is described in words, for example *21 notes ·
rises and falls back within a 6th · some off-beats · lands on bar 4, beat 1*.

- **Bones** plays only the core: plain sounds, no chords, no swing or human
  feel, velocity from note strength alone. Chords and pads play as their top
  line, bass as its bottom line.
- **Full** plays the parts as they were found, through the lane sounds.
- Click a voice's name to leave it out of playback, so you can hear the
  others apart from it.
- The card menu places the idea's parts in the selected section, splits a
  voice off into an idea of its own, joins two ideas into a new one, or opens
  a voice in the booth.

An idea keeps the parts it came from, so nothing is lost by capturing.

**Ladder** (on an idea card) plays one idea step by step, from the bare
rhythm up to a full mix, each step adding one layer:

| Step | Adds |
| --- | --- |
| 1 Rhythm | when the notes fall and which are strong: one sound, no pitch |
| 2 Shape | which way it moves, as plain scale steps (the bones) |
| 3 Notes | the notes as written: chords, passing notes, sharps and flats, lengths, dynamics |
| 4 Harmony | every note bent to the chords of the section you fit it into |
| 5 Sound and feel | the lane sounds, swing and human timing |
| 6 Band | what else that section plays, and the section's energy |

The first three are the idea on its own; the last three fit it into the
section picked at the top (or *where it was found*, over its own chords).
Each step draws what it plays, so you can see what each layer adds. Click a
step to loop it; while it plays, click another or press `↑` `↓` and the
music changes without stopping. **Place in…** puts the idea's parts in that
section.

### Who leads

Some parts stand out and some sit back. Some parts steer the others, and
some fit themselves around the others. Oddition measures both for every part
of a section and puts it in one of four boxes:

| | Steers others | Fits to others |
| --- | --- | --- |
| **Stands out** | **Hook**: the idea everything else is built around | **Topline**: out front, fitting over the others |
| **Sits back** | **Groove**: other parts lock to it | **Bed**: fills and supports |

- **Stands out** comes from how high and how much a part moves, and how
  often it plays where the others leave space. A part that repeats the same
  bar sinks back a little. It is relative: alone with a pad, the drums are
  what you hear. At most half the parts stand out.
- **Steers** comes from what the other parts do about it. One part can lock
  to another's off-beat hits, play between its kicks, or answer it in its
  gaps. Two parts can also move together or trade phrases. Some of this was
  heard when a take was made with *Listen to the section*; the rest is
  measured from the notes. Pitched parts also follow the section's chords.

Each filled slot on the song sheet shows its box (**Roles** hides them). The
line above the sheet says who leads the selected section. **Who leads?** (or
`W`, or the section menu) opens the full picture:

- A map with standing out going up and steering going right. Arrows point
  from each part to the part it fits to.
- Every link in words, with the evidence, e.g. *Bass locks to the kick in
  Drums · 100% of its off-beat notes land with it*.
- **Across the song**: each lane's box in every section of the song order,
  so you can see the lead move. For example, the arp leads the intro, the
  chords lead the verse, and the lead takes over in the chorus.

Mute a part in the dialog to hear and see who takes over. Step through
sections with `←` `→` while it loops (`Space`).

### Melody first: let a tune set the chords

Normally a section's chords lead and every pitched part bends to them. You
can flip that: pick a part, usually the melody, and let its tune set the
chords. The tune then plays exactly as written, the section's chords are
worked out from its notes, and every other part that fits to chords follows
them. So the tune leads and the harmony follows it.

- Turn it on with **Lead** on a selected slot, `H`, **Sets chords** in the
  Who leads dialog, or **Let a tune set the chords…** in the section menu
  (it shows the chords each part would give).
- The chords follow the tune from then on. Swap in another take or edit its
  notes and the chords change with it. In the booth, a take for that lane is
  heard leading: the chord line and *Play with the section* use the chords
  that take would give.
- The dice next to the chords gives other good chords for the same tune.
- **Lead** again, `H`, or **Chords lead again** brings back the chords the
  section had before. Writing your own chords also ends it, but keeps the
  tune as written.

How the chords are picked: each half bar is scored against the notes that
sound in it. Chord tones count for, notes a semitone off a chord tone count
against, and long notes and notes on the beat count most. Changing chord in
the middle of a bar costs extra unless the style moves two chords a bar.
Chords from outside the key need a note that asks for them, such as F♯ for
D major in C. Where the tune rests, the old chords stay.

Who leads shows the flip: dash-dot arrows run from every part bent to the
chords to the tune, which usually becomes the hook.

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

### Percussion and dynamics

The **Percussion** lane plays hand percussion next to the kit: congas,
bongos, shakers, tambourine, bells (cowbell, agogo), clave, woodblocks, toms,
timbales and triangle. Each take is a traditional pattern for its main
instrument (a conga tumbao, a bongo martillo, a son or rumba clave, a
tribal tom pulse…). Higher density adds a texture layer or two underneath,
such as a shaker or a bell. **Instrument** in the booth picks the main
instrument; **Auto** chooses one that suits the style.

Hand drums are full of quiet strokes between the loud ones: heel and
fingertip taps around the tones and slaps. Velocity is the articulation:
a soft conga stroke is a dull tap, a hard one is a cracking slap or a
ringing open tone. The same goes for the kit: harder hits are brighter,
with more attack and a little more pitch, not just louder.

Two booth controls on drums and percussion shape this:

- **Touch**: light taps (low) to hard hits (high).
- **Accents**: how far the accents stand out from the quiet hits around
  them. Low evens everything out; high makes ghost notes whisper and
  accents crack.

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
| `I` | Capture the take as an idea (with the parts you hear it with) |
| `W` | Who leads: how the parts of the selected section fit to each other |
| `H` | Let the selected part's tune set its section's chords, or hand them back |
| `←` `→` | Previous / next take |
| `1`–`7` | Drums, percussion, bass, chords, pad, lead, arp |
| `Esc` | Stop |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z` | Undo, redo |

## Develop

```
npm test             # unit tests (Node 18+, no packages needed)
npm run build        # rebuild dist/oddition.html after changing sources
```

`docs/ARCHITECTURE.md` explains the modules and data formats. In short:

```
js/core/   seeded random, music theory, rendering, MIDI files, zip, data model, ideas, export, storage
js/gen/    the generators (one file per stem) and the style presets
js/audio/  Web Audio synth and drum kits, the scheduler, Web MIDI output
js/ui/     views and helpers
js/app.js  wiring, actions, keyboard
```

Limits today: 4/4 time only, one tempo per song, and the built-in synth is
meant for auditioning rather than final mixes.
