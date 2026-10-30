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

The page opens on the home screen: the logo, and Bobby Beatdown calling you
over. Tap Bobby for his menu:

- **Idea Builder** opens **Bones to Gold**, where you audition a starting
  idea with Bobby (below).
- **Song Builder** grows an idea from your book into a song, section by
  section (below).
- **Session Takeover** opens the Studio: the song sheet, with the booth and
  the shelf below it.

The logo at the top left of every screen goes back home. **Studio** and
**Bones to Gold** in the top bars switch between those two directly; the
Song Builder has **Studio** too. In the Studio, the top bar holds tempo, key, mode, style and volume; **More settings**
opens harmony, swing, feel, song shape and sound quality. The **i VI**
button on the song panel switches chords between roman numerals and chord
names (Am F C G); you still type numerals to edit them.

Your work saves automatically in the browser. Use **Session › Save project
file** to keep a copy or move it to another machine.

## Bones to Gold: audition a starting idea

Press **Audition a starting idea** and Bobby asks what you're in the mood
for: **Groove**, **Melody** or **Riff**. Each card plays an example when you
tap it (or press `1` `2` `3`); tap it again, or press **Start with a ...**,
to begin. You pick one; there is no default. The choice decides what the idea
is built around and which rounds come first. **New idea** (top right, during
the rounds) goes back to this choice.

Whichever you pick, the idea grows from the bottom up, one layer at a time.
Every round is a deck: its whole pool of options (80
rhythms, around 70 shapes, 24 chord progressions, ...), dealt three at a
time. The three are spread along what matters most for that layer, so they
sound clearly different; options that sound alike are never dealt together.
Click a card to hear it (or press `1` `2` `3`); keep the one you like.
The arrows beside the cards (or `←` `→`) slide to the next three or back to
the three before. Under the cards, a strip shows the deck, one tick per card,
and how far you've dealt; click it to jump. Every card comes up once before
anything repeats; after the last three the deck is shuffled and dealt again
in new threes. The first three are each round's clearest; the unusual ones
(shapes past an octave or with big jumps, chords that fit less well) come
later, not never. Every round you kept from stays in the history below,
where you can hear its cards again or go **Back to this round** and build
again from there.

### Melody: a tune first

1. **Rhythm and scale.** A 2-bar rhythm walked up and down a scale, so you
   hear its mood. One sparse, one busy, one in between. No genre yet.
   **Another meter** switches all three to 3/4, then 6/8, 5/4, 7/8 and back
   to 4/4. The meter stays with the idea: chords change on its strong beats,
   the drums are built from how its beats are grouped (7/8 as short, short,
   long), and the Song Builder plays and exports the song in it.
2. **Shape.** Same rhythm and scale; now where the melody goes and the note
   it lands on: one falls like an answer, one rises like a question, one
   stays near home. Each three mixes sizes: one small (a step or two, with
   repeated notes, so the rhythm carries it), one medium and one big sweep.
   **Subtler** and **Bigger** move all three that way; press Subtler again
   for smoother shapes, and a third time for ones that barely move. Shapes
   move smoothly by default. **Keep the plain walk** keeps round 1's walk as the melody.
3. **Where next.** The melody now leads, and you choose what backs it up, in
   any order: **Chords** (dark to bright), **Bass** (fills the gaps to locks
   on), **Percussion** (claps and taps, sparse to driving; then **Grow the
   beat**, on the grid to against it), **Pads and support** (thin to full) and
   **Sound and feel** (instrument, tempo and swing: calm to energetic). Each
   is worked out from the melody and the layers under it, nothing else.
   Bobby doesn't pick one for you. Each layer's deck is every sensible mix of
   a few ingredients: a bass is a job (steady, locks on, driving eighths,
   pushing ahead, dotted, walking, ...) with its notes (roots, root and
   fifth, octaves, chord tones, leading into the next chord), held or short;
   a pad is a rhythm with a voicing and an instrument; percussion is one of
   twelve hand instruments (congas, bongos, claves, cowbell, agogô, guiro,
   ...) with a pattern that suits it; a beat is a kick pattern with a snare
   placement and hats, and every meter has its own (a waltz, a hemiola
   across two bars in 3/4; galloping and tumbling in 6/8; three-then-two or
   two-then-three in 5/4; short, short, long in 7/8); a sound is a genre mix as it is, or slower, faster,
   swung, straight or with another lead. Each batch mixes families (three
   different bass jobs, three instruments), plain versions first.

### Groove: the beat and bass first

1. **The pocket.** Just drums: a kick, snare and hats with a tempo and a
   swing. **Slower**, **Faster**, **Busier**, **Sparser**, **Swing it** and
   **Another meter** steer it.
2. **Bass line.** A bass over the pocket: a job (locks to the kick, walks,
   pumps eighths, ...) moving through two chords in a scale, from minor
   pentatonic and blues to major and the modes. **Darker** and **Brighter**
   move the scale.
3. **Chords on top.** Keys over the bass, from held to chopped, thin to full.
   **No chords: drums and bass are enough** skips them.
4. **Where next.** **Percussion**, **A hook** (a short tune that sits in the
   gaps of the bass and kick; or **Leave the space**), **Pads and support**
   and **Sound and feel**, in any order.

### Riff: one figure first

1. **The riff's rhythm.** A 2-bar figure on one note: accents, held notes,
   threes against the beat. **Straighter** and **Against the beat** steer it.
2. **Its notes.** The same rhythm in a family of notes: a pedal, a blues
   turn, a climb, a crawl. **Stranger** brings out the odd ones (the tritone,
   half steps).
3. **Its weight.** Who plays it: a bass alone, a gritty guitar, both in
   octaves, in fifths, power chords or thirds.
4. **Where next.** **Drums** (with the riff or against it), **Under it** (a
   drone or slow chords; or **Nothing under it**), **Percussion** and
   **Sound and feel** (stoner, metal, post-punk, funk, surf, ...).

### Keep it, pass on it, or ask

The card that's playing lifts, and under it are three buttons:

- **✓** keeps it and builds on it (`Enter`).
- **?** has Bobby say what it is next to the other two, and why it works (`?`).
- **✗** passes on it (`X`). Bobby asks *Why didn't that one make the cut?*
  and you tick one or more reasons: **Speed**, **Instrument**, **Rhythm**,
  **Pitch**, **Range**, **Density**, **Note length**, **Thickness**, **Mood**
  (only the ones that apply: drums have no pitch). For each, he says what the
  card has, measured from what it plays (*88 BPM: relaxed, a head-nodding
  pace*; *19 hits over two bars, 11 of them between the beats*), and says so
  when every card in the round shares it (the speed of a bass line is set
  elsewhere). Then:
  - **Hear it changed** swaps in the card from the deck that moves furthest
    from it on those reasons while staying closest on everything else, and
    says what changed (*Faster: 127 BPM instead of 80 BPM*).
  - **Filter out cards like it** takes everything at that end of the deck
    out (*anything 110 BPM or faster*), never leaving fewer than three, and
    deals again. **Bring them back** under the deck undoes it.
  - **Neither** leaves it marked where it is.

Bobby doesn't describe a card unless asked. While one plays he says *I can
talk about this one* or *We can explore that*, and his bubble holds the
questions it raises (*Why would a beat go slow?*, *What is swing?*, *Why do
some chords sound sad?*). Each answer ties the theory to this card's numbers
and ends with the ways the deck can go from there (**Slower**, **Faster**,
**Swing it**, **Another meter**, **Darker scale**, ...), which re-deal the
three with that steer. When something is playing and you pick another card,
it stops, its card lowers, and Bobby gives your ears two seconds before the
next one plays.

A **Dev** tab on the left edge hides what the cards show, one kind at a
time: descriptive words, BPM, key (note names), scale, chords, the piano
roll, instrument names, meter, numbers, the letters A B C, and the deck
counter. **Blind mode** hides all of it and leaves just the card. With the
piano roll hidden, the playing card shows the sound's EQ instead, lows to
highs, so you listen as if in an audition booth.

### Watch Bobby build one

Under the three opening cards, **Or watch Bobby build one** hands him the
controls. He starts from a brief, a mood set on five qualities (dark or
bright, calm or driving, airy or full, straight or loose, light or heavy),
and picks a path. Every round he says what he's listening for, asks for what
the brief wants (**Darker scale**, **Slower**, **Swing it**, sometimes
**Another meter**), plays the three cards with a word on each, and takes the
one at the end of the round's range the brief points to (or the middle one).
Then he says why it works, and that the two he passed over fit too. He
doesn't rank the cards: the brief does the choosing. Sometimes he deals three
more from further into the deck first, and with a brief that wants air he may
take a round's own way out (no chords, the plain walk).

**Pause** (`Space`), **Back** and **Next** (`←` `→`) move through his steps;
**Take over** stops him and leaves you in the same spot with everything live.
Below the cards, **How Bobby built it** lists each decision with its reason,
the theory and the cards passed over; **Copy as text** copies it. At the end,
**Watch Bobby build another** runs again (any path, or Groove, Melody, Riff).

**That's the idea** (available once the opening rounds are done) shows how it got
here: **Play the climb** plays the bones, then the melody (or the pocket, or the
riff's rhythm and notes), then each layer as
it was added. **Save to Ideas** puts it on the Studio's shelf as an idea with
a part per layer; its menu there has **Keep building in Bones to Gold**.

## Song Builder: grow an idea into a song

Pick an idea from your book (tap it to hear it) with **Use as main**; a
second one can come along with **Add as guest**, moved into your key. Then
say what the main idea is in the song: the **verse**, the **chorus** or the
**hook**. You get three sections: your idea in the middle, an open empty one
each side.

- **Up top, three options each** for the selected section: **Build up** (its
  way in), **Substance** (what the section is) and **Finish / hand off**
  (its way out, before the next section). Bobby marks his pick. Tap a card
  to hear it; the card playing sits raised. Switching cards takes two
  seconds: the one that was playing sinks while the next one rises, and it
  plays once it's up. **Use this** puts it
  in. **Three more** deals another three; **See all** lists every option in
  that column by name, best fit first, with the one the section has now
  marked **In now**.
- **Compare:** while an option plays, **This** and **Now** under it flip
  between the option and the section as it is, straight away and from the
  same place (`C` flips too).
- **The sections** run left to right (top to bottom on a tall screen), the
  selected one large with its layers: each layer can go **On**/off, and
  **Vary** opens every way to vary it. `−` `+` stretch each part; **Undo**
  steps back.
- **Set it yourself:** the dials under the parts set the section's
  **Tempo** (type a number, or `−` `+`), **Key** (a semitone at a time),
  **Energy**, energy **Shape** (even, rises, swells, falls, dips) and
  **Swing**. A playing section or song changes as you turn them, and a run
  of presses on one dial is one Undo step.
- **Arrange:** tap a section's name (or the song's, up top) to rename it; a
  name you give stays when you swap what's in the section. **← Move** and
  **Move →** swap it with its neighbour. **Remove** takes out any open
  section; **Undo** on the note that pops up (or Bobby's **Put it back**)
  returns it to its place.
- **Vibe** and **Idea** below give three options each: tempo, key and
  energy; the main or guest idea, an answer, a motif. **Vary a layer** lists
  every named variation of one layer (outline, tease, fragment, stretch,
  squash, chop, a scale step or an octave up or down, as written); tap one
  to hear it in the section, **Use this** keeps it. **Edit notes by hand**
  opens a grid for the melody.
- **Chords** below makes the section's chords go somewhere instead of
  looping: **Answers itself** (every second time round, close relatives of
  the chords), **Goes somewhere** (the middle passes move away and come back),
  **Borrowed colour** (chords from the parallel key near the end), each with an
  ending that **lands home** or **ends open**. Each card shows its chords
  and why they work. The melody never moves: Bobby only offers chords that
  fit it, and the chords, bass and pads follow. **Lighter** sections end
  open and **Up a fourth** lands home by default; ways in and out keep the
  idea's own loop.
- **Add a layer** (or **+ Add a layer** under the stack): pick chords, bass,
  pads, percussion or a beat and Bobby makes three that fit your idea (an
  idea from the Idea Builder gets that screen's own layer rounds; any other
  gets the studio's generators). The one you use plays in every open
  section; closed sections stay as they were. A layer added here can be
  removed from the song under Vary a layer, and put back.
- **Open and closed:** Bobby only works on open sections. **Close section**
  when you love it; the song is done when every section is closed.
- **Bobby's services** (tap him): the next open section, **Keywords** (what
  you like, in order; his options follow it), **Bar Builder** (pick bars,
  get a twist, or take one off again) and **Analysis** (length, keys, and where he sees room).
- **The transport** (under the top bar; docked at the bottom on a phone):
  **Play** plays the song from the playhead, every way in and out, and
  **Stop** leaves the playhead where it stopped. `⏮` goes back to the
  start, **Loop** plays it round. The timeline shows every section (ways in
  and out shaded); click it to jump there. Changes you make while it plays
  are heard straight away. **Export MIDI** saves the song as a .mid. Songs
  save with your work.

## How it works (the Studio)

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

On the home screen: `Esc` closes Bobby's menu. In Bones to Gold: on the opening choice `1` `2` `3` hear Groove, Melody and
Riff; in a round they hear options A, B, C, and on the card playing `Enter`
keeps it, `X` passes on it and `?` asks about it; while watching Bobby, `Space`
pauses and `←` `→` step back and on; `Space` plays or stops;
`Esc` stops. In the Song Builder: `Space` plays the song from the playhead
or stops it; `C` flips between the option you're hearing and the section as
it is; on the timeline `←` `→` move the playhead a bar and `Home`
goes to the start; `Esc` closes Bobby's menu or stops. In the Studio:

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

Limits today: the Studio (Session Takeover) is 4/4 only, so ideas in other
meters grow in the Song Builder instead; a song keeps one meter and one tempo;
and the built-in synth is meant for auditioning rather than final mixes.
