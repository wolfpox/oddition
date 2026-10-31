#!/usr/bin/env node
/* Browser smoke test: drives the main flows through the real UI in headless
 * Chromium. Needs Playwright with a Chromium build (npm i -D playwright &&
 * npx playwright install chromium), so it is not part of `npm test`.
 *
 *   node tools/smoke.js [path/to/index.html]
 *
 * Downloads and screenshots go to a temp folder printed at the end. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'oddition-smoke-'));
const url = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));

function ok(cond, msg) { if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok  ', msg); }

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto(url);
  await page.waitForTimeout(800);
  const shelfCount = () => page.evaluate(() => Odd.app.ws.library.length);
  const n0 = await shelfCount();

  // ---- home: the logo and Bobby, then his menu
  ok(await page.evaluate(() => document.body.dataset.screen === 'home' && !!document.querySelector('.h-bob') && getComputedStyle(document.querySelector('#desk')).display === 'none' && getComputedStyle(document.querySelector('#bones')).display === 'none'), 'opens on the home screen');
  ok(await page.evaluate(() => /great stuff to show you/.test(document.querySelector('.h-say').textContent)), 'Bobby calls you over');
  await page.screenshot({ path: path.join(out, 'home.png') });
  await page.click('.h-bob');
  await page.waitForTimeout(400);
  ok((await page.$$('.h-menu .h-card')).length === 3 && (await page.evaluate(() => document.querySelector('.h-bob').getAttribute('aria-expanded'))) === 'true', 'tapping Bobby opens three places');
  await page.screenshot({ path: path.join(out, 'home-menu.png') });
  await page.click('.h-card[data-to="song"]');
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => document.body.dataset.screen === 'song' && !!document.querySelector('.sg-emptybook [data-act="bones"]')), 'Song Builder with an empty book points to the Idea Builder');
  await page.click('#songb [data-act="home"]');
  await page.waitForTimeout(300);
  await page.click('.h-card[data-to="studio"]');
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => document.body.dataset.screen === 'studio' && getComputedStyle(document.querySelector('#home')).display === 'none'), 'Session Takeover opens the studio');
  await page.click('#topbar [data-act="home"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.body.dataset.screen === 'home' && !!document.querySelector('.h-menu')), 'the logo goes home, menu still open');
  await page.click('.h-card[data-to="bones"]');
  await page.waitForTimeout(900);

  // ---- Bones to Gold
  const Odd_ready = (t) => /talk about this one|explore that|Ask me about|story in that/.test(t);
  const bones = () => page.evaluate(() => ({ phase: Odd.bones.state.phase, sel: Odd.bones.state.sel, dir: Odd.bones.state.round && Odd.bones.state.round.dir, playing: Odd.bones.playing && Odd.transport.playing, order: Odd.bones.state.idea.order.slice() }));
  ok(await page.evaluate(() => document.body.dataset.screen === 'bones' && document.querySelectorAll('.b-open .b-big').length === 3 && getComputedStyle(document.querySelector('#desk')).display === 'none'), 'the Idea Builder opens on Groove, Melody or Riff');
  await page.click('.b-big[data-path="melody"] .b-hit');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => Odd.bones.playing && Odd.bones.state.peek === 'melody' && !!document.querySelector('.b-big.lifted [data-act="begin"]') && /melody/.test(document.querySelector('.b-say').textContent)), 'a tap plays an example and lifts its card');
  await page.click('.b-big[data-path="melody"] .b-hit');
  await page.waitForTimeout(500);
  ok((await page.$$('.b-cards .b-card')).length === 3, 'three rhythm-and-scale options');
  await page.click('.b-cards .b-card[data-i="0"] .b-hit');
  await page.waitForTimeout(500);
  let b = await bones();
  ok(b.playing && b.sel === 0, 'from silence a card plays at once and lifts');
  await page.click('.b-cards .b-card[data-i="2"] .b-hit');
  await page.waitForTimeout(250);
  b = await bones();
  ok(!b.playing && b.sel === -1 && (await page.$$('.b-card.is-wait')).length === 1, 'switching stops, lowers and waits');
  await page.waitForTimeout(2100);
  b = await bones();
  ok(b.playing && b.sel === 2, 'then the next one lifts and plays');
  // the booth: Bobby is ready to talk, and only says more when asked
  ok(Odd_ready(await page.textContent('.b-say')) && (await page.$$('.b-talk .b-q')).length >= 2 && (await page.$$('.b-card.lifted .b-bx')).length === 3 && !!(await page.$('.b-card.lifted .b-bx.tweak')), 'under the playing card: ✗, Tweak, ✓; Bobby offers questions');
  const q0 = await page.textContent('.b-talk .b-q');
  await page.click('.b-talk .b-q >> nth=0');
  ok((await page.textContent('.b-say')).length > 60 && !(await page.$$eval('.b-talk .b-q', (els) => els.map((e) => e.textContent))).includes(q0), 'a question gets an answer');
  await page.click('.b-card.lifted [data-act="nope"]');
  ok(/make the cut/.test(await page.textContent('.b-say')) && (await page.$$('.b-why')).length >= 5 && await page.isDisabled('[data-act="whydone"]'), '✗ asks why, and needs a reason');
  await page.click('.b-why[data-f="density"]');
  await page.click('.b-why[data-f="speed"]');
  await page.click('[data-act="whydone"]');
  ok((await page.$$('.b-facts li')).length === 2 && /notes in two bars/.test(await page.textContent('.b-facts')) && /Same on every card/.test(await page.textContent('.b-facts li.fixed')), 'each reason comes with what the card has');
  const card2 = await page.evaluate(() => JSON.stringify(Odd.audition.flow.options(Odd.bones.state)[2]));
  await page.click('[data-act="change"]');
  await page.waitForTimeout(2300);
  b = await bones();
  ok(b.playing && b.sel === 2 && /changed/.test(await page.textContent('.b-say')) && card2 !== (await page.evaluate(() => JSON.stringify(Odd.audition.flow.options(Odd.bones.state)[2]))), 'hear it changed: a new card takes its place and plays');
  await page.click('.b-card.lifted [data-act="nope"]');
  await page.click('.b-why[data-f="density"]');
  await page.click('[data-act="whydone"]');
  await page.click('[data-act="cutit"]');
  await page.waitForTimeout(2300);
  ok(/Filtered out/.test(await page.textContent('.b-say')) && !!(await page.$('.b-cutnote [data-act="uncut"]')), 'filter out cards like it, and it says how many are left');
  await page.click('[data-act="uncut"]');
  await page.waitForTimeout(200);
  ok(!(await page.$('.b-cutnote')), 'and they can all come back');
  // Tweak: the playing card's own dials, only once asked, each starting where the card sits
  await page.click('.b-cards .b-card[data-i="0"] .b-hit');
  await page.waitForTimeout(500);
  ok((await page.$$('.b-fader')).length === 0, 'no dials until Tweak');
  await page.click('.b-card.lifted [data-act="tweak"]');
  const dialIds = await page.$$eval('.b-card.lifted .b-fader', (els) => els.map((e) => e.dataset.f));
  const live = await page.$$eval('.b-card.lifted .b-fader:not(.fixed)', (els) => els.map((e) => e.dataset.f));
  const want = await page.evaluate(() => Odd.booth.dials(Odd.bones.state, 0).map((d) => d.id + ':' + d.pos.toFixed(3)).join());
  const shown = await page.$$eval('.b-card.lifted .b-fader', (els) => els.map((e) => e.dataset.f + ':' + Number(e.dataset.p).toFixed(3)).join());
  ok(dialIds.length >= 3 && live.length >= 2 && shown === want && /What if/.test(await page.textContent('.b-say')) && (await page.getAttribute('.b-card.lifted .b-bx.tweak', 'aria-expanded')) === 'true', 'Tweak opens the card’s own dials, each where the card already sits: ' + shown);
  await page.screenshot({ path: path.join(out, 'bones-tweak.png'), clip: await page.$eval('.b-card.lifted', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 20, y: r.y + scrollY - 20, width: r.width + 40, height: r.height + 110 }; }) });
  const tuneBefore = await page.evaluate(() => JSON.stringify(Odd.audition.flow.options(Odd.bones.state)[0]));
  const seedOf = () => page.evaluate(() => { const o = Odd.audition.flow.options(Odd.bones.state)[0]; return (o.mel || o).r.seed; });
  const seedBefore = await seedOf();
  const tr = await page.$eval('.b-card.lifted .b-fader[data-f="' + live[0] + '"] .b-ftrack', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, top: r.y, bottom: r.y + r.height }; });
  const startPos = await page.$eval('.b-card.lifted .b-fader[data-f="' + live[0] + '"]', (el) => Number(el.dataset.p));
  const toY = startPos > 0.5 ? tr.bottom - 2 : tr.top + 2;
  await page.mouse.move(tr.x, tr.bottom - startPos * (tr.bottom - tr.top));
  await page.mouse.down();
  await page.mouse.move(tr.x, toY, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  b = await bones();
  const tuneAfter = await page.evaluate(() => JSON.stringify(Odd.audition.flow.options(Odd.bones.state)[0]));
  ok(b.playing && b.sel === 0 && tuneBefore !== tuneAfter && (await seedOf()) === seedBefore && /instead of|ahead of the beat|onto the beat|accented/.test(await page.textContent('.b-say')), 'dragging a dial changes this card, not which card, and it plays at once: ' + (await page.textContent('.b-say')));
  ok((await page.$$('.b-card.lifted .b-fader')).length === dialIds.length && (await page.$$('.b-card.lifted .b-fhome')).length === 1 && !!(await page.$('.b-card.lifted [data-act="untweak"]')), 'the panel stays open on it, with a ring where it came and a way back');
  await page.focus('.b-card.lifted .b-fader[data-f="' + live[1] + '"] .b-ftrack');
  const p1 = await page.$eval('.b-card.lifted .b-fader[data-f="' + live[1] + '"]', (el) => ({ p: Number(el.dataset.p), top: Math.max.apply(null, el.querySelector('.b-ftrack').dataset.stops.split(',').map(Number)) }));
  await page.keyboard.press(p1.p < p1.top - 1e-4 ? 'ArrowUp' : 'ArrowDown');
  await page.waitForTimeout(700);
  ok(tuneAfter !== (await page.evaluate(() => JSON.stringify(Odd.audition.flow.options(Odd.bones.state)[0]))) && (await bones()).sel === 0 && await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role') === 'slider'), 'arrow keys step a dial to its next spot, and keep focus');
  await page.click('.b-card.lifted [data-act="untweak"]');
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => JSON.stringify(Odd.audition.flow.options(Odd.bones.state)[0]))) === tuneBefore && /how it came/.test(await page.textContent('.b-say')), 'back to how it came: the very card it was');
  if (dialIds.length > live.length) {
    await page.click('.b-card.lifted .b-fader.fixed .b-ftrack', { force: true });
    ok(/scale|seed|threes|accents|any further/.test(await page.textContent('.b-say')), 'a greyed dial says why: ' + (await page.textContent('.b-say')));
  }
  await page.click('.b-card.lifted [data-act="nudge"]');
  await page.waitForTimeout(900);
  ok(/leans|middle|turned it/.test(await page.textContent('.b-say')) && (await bones()).sel === 0 && tuneBefore !== (await page.evaluate(() => JSON.stringify(Odd.audition.flow.options(Odd.bones.state)[0]))), 'Bobby turns one himself: ' + (await page.textContent('.b-say')));
  await page.screenshot({ path: path.join(out, 'bones-tweak-turned.png'), clip: await page.$eval('.b-card.lifted', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 20, y: r.y + scrollY - 20, width: r.width + 40, height: r.height + 110 }; }) });
  await page.click('.b-card.lifted [data-act="tweak"]');
  await page.waitForTimeout(150);
  ok((await page.$$('.b-fader')).length === 0, 'Tweak again puts the dials away');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // the dev menu: blind mode leaves just the card, and the EQ plays in it
  await page.click('.b-dev .b-dev-tab');
  await page.click('.b-dev input[data-blind]');
  await page.click('.b-dev .b-dev-tab');
  await page.click('.b-cards .b-card[data-i="1"] .b-hit');
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => document.querySelector('#bones').classList.contains('hx-blind') && getComputedStyle(document.querySelector('.b-card .b-head')).display === 'none' && getComputedStyle(document.querySelector('.b-card.is-playing .b-eq')).display === 'block' && document.querySelector('.b-card.is-playing .b-eq').dataset.on === '1'), 'blind mode: just the card, with the EQ moving');
  await page.screenshot({ path: path.join(out, 'bones-blind.png') });
  await page.click('.b-dev .b-dev-tab');
  await page.click('.b-dev .b-dev-all');
  await page.click('.b-dev .b-dev-tab');
  ok(await page.evaluate(() => !document.querySelector('#bones').className.includes('hx-')), 'show everything again');
  await page.click('.b-card.lifted [data-act="promote"]');
  await page.waitForTimeout(2300);
  await page.waitForTimeout(500);
  b = await bones();
  ok(b.dir === 'seed2' && b.sel === 1, 'promoting moves on to the shape');
  ok(!!(await page.$('[data-act="own"]')) && !!(await page.$('[data-act="finish"]')) === false, 'the plain walk is on offer; gold waits for a melody');
  await page.click('.b-cards .b-card[data-i="1"] [data-act="promote"]');
  await page.waitForTimeout(500);
  b = await bones();
  ok(b.phase === 'next' && b.playing, 'the melody plays on its own');
  ok((await page.$$('.b-dir')).length === 5 && (await page.$$('.b-dir.tip, .b-pickb')).length === 0, 'five ways on, none highlighted');
  for (const d of ['perc', 'bass']) {
    await page.click('[data-act="go"][data-dir="' + d + '"]');
    await page.waitForTimeout(300);
    await page.click('.b-cards .b-card[data-i="1"] .b-hit');
    await page.waitForTimeout(2300);
    await page.click('.b-card.lifted [data-act="promote"]');
    await page.waitForTimeout(2300);
  }
  b = await bones();
  ok(b.order.join() === 'perc,bass' && (await page.$$('.b-dir')).length === 6, 'layers stack; grow the beat opens after percussion');
  ok((await page.$$('.b-row')).length === 5, 'every round is in the history, and the filter before it');
  await page.click('[data-act="finish"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="climb"]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => Odd.transport.playing && !Odd.transport.seq().loop && (document.querySelectorAll('.b-lin').length === 4)), 'gold plays the climb');
  const ideas0 = await page.evaluate(() => Odd.app.ws.ideas.length);
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate((n) => Odd.app.ws.ideas.length === n + 1 && Odd.app.ws.ideas[0].from === 'bones' && Odd.app.ws.ideas[0].voices.length === 3 && !!Odd.app.ws.ideas[0].bones, ideas0), 'save puts it in Ideas');
  await page.click('.b-row [data-act="back"] >> nth=1');
  await page.waitForTimeout(300);
  b = await bones();
  ok(b.phase === 'round' && b.dir === 'perc' && !b.playing, 'back to an earlier round');
  await page.screenshot({ path: path.join(out, 'bones.png'), fullPage: true });
  // a groove and a riff: three first screens each, then their own ways on
  for (const [p, dirs] of [['groove', 'perc,hook,pads,sound'], ['riff', 'drums,under,perc,sound']]) {
    await page.click('.b-top [data-act="restart"]');
    await page.waitForTimeout(300);
    await page.click('.b-big[data-path="' + p + '"] .b-hit');
    await page.waitForTimeout(300);
    await page.click('.b-big.lifted [data-act="begin"]');
    await page.waitForTimeout(400);
    for (let k = 0; k < 3; k++) {
      await page.click('.b-cards .b-card[data-i="0"] .b-hit');
      await page.waitForTimeout(300);
      await page.click('.b-card.lifted [data-act="promote"]');
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(2100); // promoted while playing: Bobby's two-second gap first
    b = await bones();
    const ways = await page.evaluate(() => [...document.querySelectorAll('.b-dir')].map((x) => x.dataset.dir).join());
    ok(b.phase === 'next' && b.playing && ways === dirs, 'a ' + p + ' in three screens, then ' + dirs);
    await page.screenshot({ path: path.join(out, 'bones-' + p + '.png') });
  }
  // watch Bobby build one: he steps on his own, the cards don't take clicks, Take over hands it back
  await page.click('.b-top [data-act="restart"]');
  await page.waitForTimeout(300);
  await page.click('.b-link[data-act="watch"]');
  await page.waitForTimeout(400);
  const wt = () => page.evaluate(() => Odd.bones.watching);
  let w = await wt();
  ok(!!w && w.kind === 'brief' && !!(await page.$('.b-watchbar')), 'Watch Bobby starts on his brief');
  for (let k = 0; k < 60 && (await wt()).kind !== 'choose'; k++) { await page.click('[data-act="wnext"]'); await page.waitForTimeout(80); }
  await page.waitForTimeout(300);
  ok((await wt()).kind === 'choose' && (await page.$$('.b-card.b-chosen')).length === 1, 'he marks the card he takes and says why');
  await page.click('[data-act="wpause"]');
  w = await wt();
  await page.waitForTimeout(1500);
  ok((await wt()).i === w.i && (await wt()).paused, 'pause holds him');
  await page.click('[data-act="wnext"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelectorAll('.b-wl-row').length === 1 && /Why it works/.test(document.querySelector('.b-watchlog').textContent)), 'the log keeps every decision');
  await page.click('[data-act="wtake"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !Odd.bones.watching && !document.querySelector('.b-watchbar')), 'Take over hands it back');
  await page.screenshot({ path: path.join(out, 'bones-watch.png'), fullPage: true });
  await page.click('[data-act="studio"]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.body.dataset.screen === 'studio' && !Odd.transport.playing && getComputedStyle(document.querySelector('#bones')).display === 'none'), 'Studio switches to the sheet, booth and shelf');

  // play the booth take
  await page.click('[data-act="play-booth"]');
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => Odd.transport.playing && Odd.app.ui.playing.kind === 'booth'), 'booth plays');
  ok(await page.evaluate(() => Odd.transport.position() > 0), 'playhead moves');

  // reject keeps playing with a new take
  const t1 = await page.evaluate(() => Odd.app.currentTake().id);
  await page.keyboard.press('x');
  await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => Odd.app.currentTake().id);
  ok(t1 !== t2, 'reject makes a new take');
  ok(await page.evaluate(() => Odd.transport.playing), 'still playing after reject');

  // keep
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  ok((await shelfCount()) === n0 + 1, 'keep adds to shelf');
  ok(await page.evaluate(() => Odd.app.currentTake().id) === t2, 'keep leaves the take in the booth');

  // vary
  const before = await page.evaluate(() => Odd.app.currentTake().id);
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  ok(await page.evaluate((b) => Odd.app.currentTake().parent === b, before), 'vary makes a child take');

  // switch roles 1-7 and generate each
  for (let i = 1; i <= 7; i++) {
    await page.keyboard.press(String(i));
    await page.waitForTimeout(150);
    const role = await page.evaluate(() => Odd.app.ui.booth.role);
    ok(role === Odd_roles()[i - 1], 'role key ' + i + ' -> ' + role);
  }
  function Odd_roles() { return ['drums', 'perc', 'bass', 'chords', 'pad', 'lead', 'arp']; }

  // param change re-rolls same seed (on the bass)
  await page.keyboard.press('3');
  const seedA = await page.evaluate(() => Odd.app.currentTake().seed);
  await page.evaluate(() => {
    const el = document.querySelector('[data-change="param"][data-key="density"]');
    el.value = 0.9; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  ok(await page.evaluate((s) => Odd.app.currentTake().seed === s && Odd.app.currentTake().params.density === 0.9, seedA), 'param change re-rolls with same seed');

  // keep & place into Verse/Bass
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  const placed = await page.evaluate(() => {
    const s = Odd.app.session(); const sec = Odd.app.selectedSection(); const lane = Odd.model.laneForRole(s, 'bass');
    return sec.slots[lane.id] && sec.slots[lane.id].part.name === Odd.app.currentTake().name;
  });
  ok(placed, 'keep & place fills the slot');
  await page.screenshot({ path: path.join(out, 'flow-placed.png') });

  // stop, then play the song
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !Odd.transport.playing), 'escape stops');
  await page.click('[data-act="play-song"]');
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => Odd.transport.playing && Odd.app.ui.playing.kind === 'song'), 'song plays');
  const lit = await page.evaluate(() => Array.from(document.querySelectorAll('[data-led]')).some((el) => Number(el.style.getPropertyValue('--lit')) > 0));
  ok(lit, 'lane lights flicker');
  ok(await page.evaluate(() => document.querySelectorAll('.nrg-btn').length === Odd.app.session().sections.length), 'sections show energy');
  ok(await page.evaluate(() => Odd.render.songEvents(Odd.app.session()).markers.every((m) => typeof m.energy === 'number')), 'song plan has energy');
  const verseBars = await page.evaluate(() => { const v = Odd.app.session().sections.find((x) => x.name === 'Verse'); return { id: v.id, song: Odd.model.songBars(Odd.app.session()) }; });
  await page.selectOption('#sb-' + verseBars.id, '16');
  await page.waitForTimeout(200);
  ok(await page.evaluate((id) => { const v = Odd.app.session().sections.find((x) => x.id === id); return v.bars === 16 && Odd.theory.progBeats(v.prog) === 64; }, verseBars.id), 'bars select changes section length');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'flow-song-playing.png') });

  // select a cell and swap
  await page.click('.cell[data-role="drums"] >> nth=1');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => Odd.app.ui.booth.role === 'drums'), 'selecting a cell targets the booth');
  const swapBtn = await page.$('.cell.is-selected [data-act="cell-swap"][data-dir="1"]');
  if (swapBtn) { await swapBtn.click(); await page.waitForTimeout(200); }
  ok(!!swapBtn, 'swap tool present');

  // section loop
  await page.click('[data-act="play-section"] >> nth=0');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => Odd.app.ui.playing && Odd.app.ui.playing.kind === 'section'), 'section loops');

  // undo
  const lib = await shelfCount();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  ok((await shelfCount()) <= lib, 'undo works');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');

  // exports
  async function grab(label, timeout) {
    await page.click('[data-act="export-menu"]');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: timeout || 20000 }), page.click('.menu-item:has-text("' + label + '")')]);
    const p = path.join(out, dl.suggestedFilename());
    await dl.saveAs(p);
    return p;
  }
  const mid = await grab('Song as MIDI');
  ok(fs.readFileSync(mid).slice(0, 4).toString() === 'MThd', 'song .mid downloads (' + path.basename(mid) + ')');
  const zip = await grab('Stems as MIDI');
  ok(fs.readFileSync(zip).readUInt32LE(0) === 0x04034b50, 'stems zip downloads (' + path.basename(zip) + ')');
  const wav = await grab('Stems as audio', 120000);
  ok(fs.statSync(wav).size > 100000, 'wav stems render (' + (fs.statSync(wav).size / 1e6).toFixed(1) + ' MB)');

  // ideas: capture from the booth with the section, hear the bones and the full parts, split, join
  await page.click('[data-act="tab"][data-tab="booth"]').catch(() => {});
  await page.keyboard.press('Escape');
  await page.evaluate(() => { Odd.app.ui.booth.context = true; });
  await page.keyboard.press('6'); // lead
  await page.waitForTimeout(200);
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  const boxes = await page.$$('#overlay input[data-i]');
  ok(boxes.length >= 2, 'capture asks which parts belong together (' + boxes.length + ' offered)');
  await page.fill('#dlg-idea-name', 'Smoke Idea');
  await page.click('#overlay .btn-primary');
  await page.waitForTimeout(300);
  const idea = await page.evaluate(() => Odd.app.ws.ideas[0] && { name: Odd.app.ws.ideas[0].name, voices: Odd.app.ws.ideas[0].voices.length, view: Odd.app.ui.shelf.view });
  ok(idea && idea.name === 'Smoke Idea' && idea.voices >= 2 && idea.view === 'ideas', 'idea captured with ' + (idea && idea.voices) + ' voices, shelf shows ideas');
  ok(await page.evaluate(() => !!document.querySelector('.idea-card canvas.idea-glyph') && document.querySelector('.idea-card canvas.idea-glyph').width > 0), 'idea card draws its glyph');
  await page.click('.idea-card [data-act="idea-play"][data-kind="bones"]');
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => Odd.transport.playing && Odd.app.ui.playing.kind === 'bones'), 'bones play');
  await page.click('.idea-card [data-act="idea-voice"][data-index="0"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => Odd.app.ideaMute(Odd.app.ws.ideas[0].id).includes(0) && !!document.querySelector('.idea-card .voice.is-off')), 'a voice can be left out');
  await page.click('.idea-card [data-act="idea-play"][data-kind="idea"]');
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => Odd.transport.playing && Odd.app.ui.playing.kind === 'idea'), 'full idea plays');
  await page.screenshot({ path: path.join(out, 'ideas.png'), fullPage: false });
  await page.keyboard.press('Escape');
  const nIdeas = await page.evaluate(() => Odd.app.ws.ideas.length);
  await page.click('.idea-card [data-act="idea-menu"]');
  await page.click('.menu .menu-item:has-text("' + (await page.evaluate(() => Odd.app.ws.ideas[0].voices[1].name)).replace(/"/g, '\\"') + '")');
  await page.waitForTimeout(300);
  ok(await page.evaluate((n) => Odd.app.ws.ideas.length === n + 1, nIdeas), 'split off a voice into its own idea');
  await page.click('.idea-card [data-act="idea-menu"]');
  await page.click('.menu .menu-item:has-text("Join with another idea")');
  await page.click('#overlay .btn-primary');
  await page.waitForTimeout(300);
  ok(await page.evaluate((n) => Odd.app.ws.ideas.length === n + 2, nIdeas), 'join two ideas into a new one');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  ok(await page.evaluate((n) => Odd.app.ws.ideas.length === n + 1, nIdeas), 'undo takes the join back');

  // the ladder: hear one idea step by step; moving a step keeps the loop going
  await page.click('.idea-card [data-act="idea-ladder"]');
  await page.waitForTimeout(300);
  ok((await page.$$('#overlay .rung')).length === 6, 'ladder shows six steps');
  ok(await page.evaluate(() => [...document.querySelectorAll('#overlay canvas.rung-roll')].every((c) => c.width > 0)), 'every step draws its picture');
  await page.click('#overlay [data-ladder-rung="rhythm"]');
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => Odd.transport.playing && Odd.app.ui.playing.kind === 'ladder' && Odd.app.ui.ladder.rung === 'rhythm'), 'a step plays');
  const posA = await page.evaluate(() => Odd.transport.position());
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  const lad = await page.evaluate(() => ({ rung: Odd.app.ui.ladder.rung, playing: Odd.transport.playing, pos: Odd.transport.position(), live: !!document.querySelector('#overlay .rung.is-live') }));
  ok(lad.playing && lad.live && ['band', 'sound'].includes(lad.rung) && lad.pos > posA, 'arrow keys climb without restarting (' + lad.rung + ')');
  await page.screenshot({ path: path.join(out, 'ladder.png') });
  await page.selectOption('#overlay [data-ladder-target]', '');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector('#overlay [data-ladder-rung="band"]').disabled && document.querySelector('#overlay .dialog-actions button[data-i="0"]').disabled), 'where it was found: no band, nothing to place into');
  await page.click('#overlay .btn-primary');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !Odd.app.ui.playing && !Odd.app.ui.ladder), 'closing the ladder stops it');

  // who leads: each part's role in its section, and who fits to whom
  await page.click('[data-act="tab"][data-tab="song"]').catch(() => {});
  await page.evaluate(() => { const s = Odd.app.session(); Odd.app.ui.sectionId = s.sections.find((x) => x.name === 'Chorus').id; Odd.app.paint(['song']); });
  await page.waitForTimeout(200);
  const tags = await page.$$eval('.cell .box-tag', (els) => els.map((e) => e.dataset.box));
  ok(tags.length >= 5 && tags.every((b) => ['hook', 'topline', 'groove', 'bed'].includes(b)), 'song sheet cells show their roles (' + [...new Set(tags)].join(', ') + ')');
  ok(await page.evaluate(() => /\S/.test((document.querySelector('.sec-lead') || {}).textContent || '')), 'the section story says who leads');
  await page.click('.sec-story [data-act="fit-open"]');
  await page.waitForTimeout(300);
  const fit0 = await page.evaluate(() => ({ nodes: document.querySelectorAll('#overlay .fit-node').length, lanes: Odd.relate.forSection(Odd.app.session(), Odd.app.selectedSection()).lanes.length, title: document.querySelector('#dlg-title').textContent }));
  ok(fit0.nodes > 0 && fit0.nodes === fit0.lanes && /Chorus/.test(fit0.title), 'who leads draws every part heard (' + fit0.nodes + ')');
  ok(await page.evaluate(() => document.querySelectorAll('#overlay .ribbon tbody tr').length > 0 && document.querySelectorAll('#overlay .ribbon thead th').length === Odd.app.session().arrangement.length + 1), 'the strip shows every section of the song');
  await page.screenshot({ path: path.join(out, 'fit.png') });
  await page.keyboard.press(' ');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => Odd.transport.playing && Odd.app.isPlaying('section', Odd.app.ui.fit.sectionId)), 'space loops the section');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const fit1 = await page.evaluate(() => ({ id: Odd.app.ui.fit.sectionId, title: document.querySelector('#dlg-title').textContent, playing: Odd.app.isPlaying('section', Odd.app.ui.fit.sectionId) }));
  ok(!/Chorus/.test(fit1.title) && fit1.playing, 'arrow keys step to another section and keep playing it (' + fit1.title + ')');
  await page.click('#overlay .ribbon-sec:has-text("Chorus")');
  await page.waitForTimeout(300);
  const mutedName = await page.evaluate(() => document.querySelector('#overlay .fit-part:not(.is-muted) strong').textContent);
  await page.click('#overlay .fit-part:not(.is-muted) [data-act="lane-mute"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate((n) => document.querySelectorAll('#overlay .fit-node').length === n - 1 && !!document.querySelector('#overlay .fit-part.is-muted'), fit0.nodes), 'muting a part takes it off the map (' + mutedName + ')');
  await page.click('#overlay .fit-part.is-muted [data-act="lane-mute"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate((n) => document.querySelectorAll('#overlay .fit-node').length === n, fit0.nodes), 'unmuting brings it back');
  // melody first: the lead's tune sets the chords
  const chords0 = await page.evaluate(() => Odd.theory.formatProg(Odd.app.selectedSection().prog, Odd.app.session().scale));
  const leadId = await page.evaluate(() => Odd.model.laneForRole(Odd.app.session(), 'lead').id);
  await page.click('#overlay [data-act="lead-toggle"][data-lane="' + leadId + '"]');
  await page.waitForTimeout(300);
  const led = await page.evaluate((id) => {
    const sec = Odd.app.selectedSection();
    return {
      leader: Odd.harmonise.leaderOf(sec), refit: sec.slots[id].refit,
      arrows: document.querySelectorAll('#overlay .fit-link[data-kind="harmony"]').length,
      row: !!document.querySelector('#overlay .fit-tune'), pressed: document.querySelector('#overlay [data-act="lead-toggle"][data-lane="' + id + '"]').getAttribute('aria-pressed'),
      headline: document.querySelector('#overlay .fit-headline').textContent,
    };
  }, leadId);
  ok(led.leader === leadId && led.refit === false && led.arrows > 0 && led.row && led.pressed === 'true' && /chords come from/.test(led.headline), 'a tune can set the chords, and the map shows the parts following it (' + led.arrows + ' arrows)');
  await page.screenshot({ path: path.join(out, 'fit-lead.png') });
  await page.click('#overlay .btn-primary');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !Odd.app.ui.fit && !document.querySelector('#overlay .fit')), 'done closes who leads');
  ok(await page.evaluate(() => !!document.querySelector('.sec-head.is-selected .chords-btn.is-led') && !!document.querySelector('.cell .lead-mark')), 'the sheet shows which tune sets the chords');
  const ledChords = await page.evaluate(() => Odd.theory.formatProg(Odd.app.selectedSection().prog, Odd.app.session().scale));
  await page.click('.sec-head.is-selected [data-act="new-chords"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate((c) => Odd.app.selectedSection().lead.variant === 1 && Odd.theory.formatProg(Odd.app.selectedSection().prog, Odd.app.session().scale) !== c, ledChords), 'the dice gives other chords for the same tune');
  // the booth: a take for the leading lane is heard leading
  await page.evaluate((id) => { Odd.app.ui.laneId = id; Odd.app.ui.booth.role = 'lead'; Odd.app.paint(); }, leadId);
  await page.click('[data-act="tab"][data-tab="booth"]').catch(() => {});
  await page.keyboard.press('x');
  await page.waitForTimeout(300);
  const booth = await page.evaluate(() => {
    const take = Odd.app.currentTake();
    const prog = Odd.app.leadProg(take, Odd.app.boothLane());
    return { leads: !!prog && Odd.app.boothTarget(take, take.bars * 1920).refit === false, line: !!document.querySelector('.booth .chord-line.is-led'), playing: Odd.transport.playing };
  });
  ok(booth.leads && booth.line && booth.playing, 'a new take for that lane plays with chords worked out from it');
  await page.keyboard.press('Escape');
  // H on the selected cell hands the chords back
  await page.click('[data-act="tab"][data-tab="song"]').catch(() => {});
  await page.evaluate((id) => { Odd.app.ui.laneId = id; Odd.app.paint(['song']); }, leadId);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('h');
  await page.waitForTimeout(200);
  ok(await page.evaluate((c) => !Odd.app.selectedSection().lead && Odd.theory.formatProg(Odd.app.selectedSection().prog, Odd.app.session().scale) === c && !document.querySelector('.chords-btn.is-led'), chords0), 'H lets the chords lead again, with the chords they had');
  await page.keyboard.press('Escape');
  await page.click('[data-act="roles-toggle"]');
  await page.waitForTimeout(200);
  ok((await page.$$('.cell .box-tag')).length === 0, 'roles can be hidden');
  await page.click('[data-act="roles-toggle"]');
  await page.waitForTimeout(200);

  // reload keeps the work
  await page.evaluate(() => Odd.store.flush());
  const libBefore = await shelfCount();
  const ideasBefore = await page.evaluate(() => Odd.app.ws.ideas.length);
  await page.reload();
  await page.waitForTimeout(600);
  ok((await shelfCount()) === libBefore, 'shelf survives reload');
  ok((await page.evaluate(() => Odd.app.ws.ideas.length)) === ideasBefore, 'ideas survive reload');
  ok(await page.evaluate(() => document.body.dataset.screen === 'home'), 'reload opens on the home screen');
  await page.click('.h-bob');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => /idea book: \d+ idea/.test(document.querySelector('.h-recent').textContent)), 'menu shows the idea book count');

  // phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'home fits a phone with no sideways scroll');
  await page.screenshot({ path: path.join(out, 'home-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ---- Song Builder: an idea from the book becomes a song
  const sg = () => page.evaluate(() => { const s = Odd.song.song; return { screen: document.body.dataset.screen, phase: Odd.song.state.phase, n: s ? s.secs.length : 0, sel: Odd.song.state.sel, heard: Odd.song.state.heard, playing: Odd.song.playing && Odd.transport.playing, closed: s ? s.secs.filter((x) => !x.open).length : 0, full: s ? s.secs.filter((x) => x.body).length : 0 }; });
  await page.click('.h-card[data-to="song"]');
  await page.waitForTimeout(900);
  let g = await sg();
  ok(g.screen === 'song' && (await page.$$('.sg-ideas .sg-ic')).length === ideasBefore && (await page.evaluate(() => getComputedStyle(document.querySelector('#desk')).display === 'none')), 'Song Builder lists the idea book');
  await page.click('.sg-ic .sg-hit');
  await page.waitForTimeout(400);
  ok((await sg()).playing && (await page.$$('.sg-ic.lifted')).length === 1, 'an idea plays when tapped');
  await page.click('.sg-ic [data-act="as-main"]');
  await page.waitForTimeout(200);
  ok((await page.$$('.sg-roles .sg-role')).length === 3, 'a main idea asks for its role');
  await page.click('.sg-role[data-role="chorus"]');
  await page.waitForTimeout(500);
  g = await sg();
  ok(g.phase === 'song' && g.n === 3 && g.full === 1 && !g.playing, 'the chorus starts a three-section song');
  ok((await page.$$('.sg-acts .sg-act')).length === 3 && (await page.$$('.sg-acts .sg-oc')).length === 9, 'three options each for build up, substance and finish');
  ok((await page.$$('.sg-sel .sg-srow')).length >= 2, 'the selected section shows its layers');
  await page.screenshot({ path: path.join(out, 'song.png'), fullPage: true });
  await page.click('.sg-act >> nth=0 >> .sg-oc >> nth=0 >> .sg-hit');
  await page.waitForTimeout(400);
  g = await sg();
  ok(g.playing && (await page.$$('.sg-oc.lifted [data-act="use"]')).length === 1, 'an option plays at once from silence and lifts');
  await page.click('.sg-act >> nth=0 >> .sg-oc >> nth=1 >> .sg-hit');
  await page.waitForTimeout(250);
  ok(!(await sg()).playing && (await page.$$('.sg-oc.wait')).length === 1, 'switching options pauses first');
  await page.waitForTimeout(750);
  // halfway through the pause: the old one partway down, the new one partway up
  const ups = await page.evaluate(() => ['sink', 'rise'].map((c) => { const el = document.querySelector('.sg-acts .sg-oc.' + c); return el ? parseFloat(getComputedStyle(el).getPropertyValue('--up')) : -1; }));
  ok(ups[0] > 0.05 && ups[0] < 0.95 && ups[1] > 0.05 && ups[1] < 0.95, 'the pause is a handover: one sinks while the next rises (' + ups.map((x) => x.toFixed(2)).join(' / ') + ')');
  await page.screenshot({ path: path.join(out, 'song-handover.png'), clip: await page.$eval('.sg-acts', (el) => { const r = el.getBoundingClientRect(); return { x: r.x - 10, y: r.y + scrollY - 30, width: r.width + 20, height: r.height + 60 }; }) });
  await page.waitForTimeout(1450);
  ok((await sg()).playing && (await page.$$('.sg-oc.lifted')).length === 1, 'then the next option plays');
  const sec2 = await page.evaluate(() => JSON.stringify(Odd.song.song.secs[1]));
  await page.click('.sg-oc.lifted [data-act="use"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate((b) => JSON.stringify(Odd.song.song.secs[1]) !== b && !!Odd.song.song.secs[1].intro, sec2), 'using a build up gives the section its way in');
  await page.click('.sg-sel [data-act="lock"]');
  await page.waitForTimeout(200);
  g = await sg();
  ok(g.closed === 1 && !!(await page.$('.sg-locked')), 'closing a section locks its options');
  await page.click('.sg-strip .sg-sc >> nth=0');
  await page.waitForTimeout(300);
  g = await sg();
  ok(g.sel !== (await page.evaluate(() => Odd.song.song.secs[1].id)) && !!(await page.$('.sg-sel .sg-empty')), 'an empty section can be picked');
  await page.click('.sg-act >> nth=1 >> .sg-oc >> nth=0 >> .sg-hit');
  await page.waitForTimeout(400);
  await page.click('.sg-oc.lifted [data-act="use"]');
  await page.waitForTimeout(300);
  ok((await sg()).full === 2, 'substance fills an empty section');
  await page.click('[data-act="play-song"]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => Odd.song.playing && Odd.transport.playing && !Odd.transport.seq().loop), 'the whole song plays through');
  ok(await page.evaluate(() => Object.keys(Odd.transport.seq().tracks).every((k) => k.indexOf('sm-') === 0) && !Odd.app.ui.playing), 'Play song plays the song, not the studio session');
  await page.click('[data-act="play-song"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !Odd.song.playing && !Odd.transport.playing), 'Stop stops');
  const takes0 = await page.evaluate(() => JSON.stringify(Odd.app.session()).length);
  await page.evaluate(() => { const s = Odd.song.song.secs.find((x) => x.open && x.body); if (Odd.song.state.sel !== s.id) document.querySelector('.sg-sc[data-id="' + s.id + '"]').click(); });
  await page.waitForTimeout(200);
  await page.click('.sg-sel [data-act="vary"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate((n) => Odd.song.state.tool === 'tweak' && document.querySelectorAll('.sg-tcards.all .sg-oc').length >= 6 && JSON.stringify(Odd.app.session()).length === n, takes0), 'Vary lists every named variation and leaves the studio alone');
  const body0 = await page.evaluate(() => JSON.stringify(Odd.song.song.secs.find((x) => x.id === Odd.song.state.sel).body));
  await page.click('.sg-tcards.all .sg-oc >> nth=0 >> .sg-hit');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => Odd.transport.playing && Object.keys(Odd.transport.seq().tracks).every((k) => k.indexOf('sm-') === 0)), 'a variation plays in the section');
  await page.click('.sg-oc.lifted [data-act="use"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate((b) => JSON.stringify(Odd.song.song.secs.find((x) => x.id === Odd.song.state.sel).body) !== b, body0), 'Use keeps the variation');
  // transport: play from the playhead, stop leaves it there, the timeline moves it
  await page.click('.sg-tpplay');
  await page.waitForTimeout(1200);
  await page.click('.sg-tpplay');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !Odd.transport.playing && document.querySelector('[data-time]').textContent !== '0:00'), 'Stop leaves the playhead where it stopped');
  const tlb = await page.$eval('.sg-tl', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.click('.sg-tpplay');
  await page.waitForTimeout(150);
  await page.mouse.click(tlb.x + tlb.w * 0.8, tlb.y + tlb.h / 2);
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Odd.transport.playing && Odd.transport.position() > Odd.transport.seq().length * 0.6), 'clicking the timeline plays from there');
  await page.click('.sg-tpplay');
  await page.waitForTimeout(150);
  // a new layer, made to fit, into every open section
  const nl = await page.evaluate(() => Odd.song.song.main.voices.filter((v) => !v.removed).length);
  await page.click('.sg-tab[data-id="add"]');
  await page.waitForTimeout(200);
  const role = await page.evaluate(() => { const b = document.querySelector('[data-act="add-role"]'); return b ? b.dataset.role : ''; });
  if (role) {
    await page.click('[data-act="add-role"][data-role="' + role + '"]');
    await page.waitForTimeout(300);
    ok((await page.$$('.sg-tcards .sg-oc')).length === 3, 'Add a layer offers three takes on ' + role);
    await page.click('.sg-tcards .sg-oc >> nth=0 >> .sg-hit');
    await page.waitForTimeout(400);
    await page.click('.sg-oc.lifted [data-act="use"]');
    await page.waitForTimeout(300);
    ok(await page.evaluate((n) => Odd.song.song.main.voices.filter((v) => !v.removed).length === n + 1, nl), 'the layer joins the song');
  } else ok(true, 'the idea already has every kind of layer');

  // ---- by hand: dials, rename, move, every option by name, compare, remove and undo
  await page.evaluate(() => { const s = Odd.song.song.secs.find((x) => !x.open); if (Odd.song.state.sel !== s.id) document.querySelector('.sg-sc[data-id="' + s.id + '"]').click(); });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelectorAll('.sg-sel.closed [data-act="dial"]').length === 10 && Array.from(document.querySelectorAll('.sg-sel.closed [data-act="dial"]')).every((b) => b.disabled)), 'a closed section’s dials are off');
  await page.evaluate(() => { const s = Odd.song.song.secs.find((x) => x.open && x.body); if (Odd.song.state.sel !== s.id) document.querySelector('.sg-sc[data-id="' + s.id + '"]').click(); });
  await page.waitForTimeout(200);
  const cur = () => page.evaluate(() => { const s = Odd.song.song.secs.find((x) => x.id === Odd.song.state.sel); return { id: s.id, i: Odd.song.song.secs.indexOf(s), name: s.name, bpm: s.body && s.body.bpm, hist: s.hist.length, open: s.open, full: !!s.body }; });
  let c0 = await cur();
  ok(c0.open && c0.full && (await page.$$('.sg-sel .sg-dial')).length === 5, 'an open section has five dials');
  for (let k = 0; k < 3; k++) { await page.click('.sg-sel [data-act="dial"][data-dial="bpm"][data-d="1"]'); await page.waitForTimeout(80); }
  let c1 = await cur();
  ok(c1.bpm === c0.bpm + 3 && c1.hist === c0.hist + 1, 'the tempo dial steps, and three presses are one Undo');
  await page.fill('.sg-sel [data-dial-in="bpm"]', '120');
  await page.press('.sg-sel [data-dial-in="bpm"]', 'Enter');
  await page.waitForTimeout(200);
  ok((await cur()).bpm === 120, 'a typed tempo sets it exactly');
  await page.click('.sg-sel [data-act="dial"][data-dial="curve"][data-d="1"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Odd.song.song.secs.find((x) => x.id === Odd.song.state.sel).body.curve === 'rise' && /Rises/.test(document.querySelector('.sg-sel .sg-dials').textContent)), 'the shape dial says what it does');
  await page.click('.sg-sel .sg-title');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('sg-rnin')), 'Rename opens a name box with the focus');
  await page.fill('.sg-sel .sg-rnin', 'Big one');
  await page.press('.sg-sel .sg-rnin', 'Enter');
  await page.waitForTimeout(200);
  ok((await cur()).name === 'Big one' && /Big one/.test(await page.textContent('.sg-sel h2')), 'Enter keeps the new name');
  c0 = await cur();
  const dir = c0.i === 0 ? 1 : -1;
  await page.click('.sg-sel [data-act="move"][data-d="' + dir + '"]');
  await page.waitForTimeout(200);
  c1 = await cur();
  ok(c1.id === c0.id && c1.i === c0.i + dir, 'Move swaps the section with its neighbour and keeps it selected');
  await page.click('.sg-sel [data-act="move"][data-d="' + -dir + '"]');
  await page.waitForTimeout(200);
  await page.click('.sg-act >> nth=0 >> [data-act="see-all"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelectorAll('.sg-all .sg-oc').length === Odd.songmaker.INTROS.length && document.querySelectorAll('.sg-all .sg-nowb').length === 1), 'See all lists every way in, the one in now marked');
  await page.screenshot({ path: path.join(out, 'song-hand.png'), fullPage: true });
  await page.click('.sg-all .sg-oc:not(.cur) >> nth=0 >> .sg-hit');
  await page.waitForTimeout(2600);
  ok(await page.evaluate(() => Odd.transport.playing && !!document.querySelector('.sg-all .sg-oc.lifted .sg-ab')), 'a heard option offers This and Now');
  await page.click('.sg-all .sg-oc.lifted [data-w="now"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Odd.transport.playing && document.querySelector('.sg-all .sg-oc.lifted [data-w="now"]').getAttribute('aria-pressed') === 'true'), 'Now plays the section as it is, straight away');
  await page.keyboard.press('c');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Odd.transport.playing && document.querySelector('.sg-all .sg-oc.lifted [data-w="opt"]').getAttribute('aria-pressed') === 'true'), 'C flips back to the option');
  await page.screenshot({ path: path.join(out, 'song-compare.png') });
  await page.keyboard.press('Escape');
  await page.click('.sg-act >> nth=0 >> [data-act="see-all"]');
  await page.waitForTimeout(200);
  ok(!(await page.$('.sg-all')), 'Hide all closes the list');
  c0 = await cur();
  const n0s = await page.evaluate(() => Odd.song.song.secs.length);
  await page.click('.sg-sel [data-act="remove"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate((n) => Odd.song.song.secs.length === n - 1, n0s) && !!(await page.$('.toast .toast-action')), 'a filled section can be removed, with Undo on offer');
  await page.click('.toast .toast-action');
  await page.waitForTimeout(250);
  c1 = await cur();
  ok(await page.evaluate((n) => Odd.song.song.secs.length === n, n0s) && c1.id === c0.id && c1.i === c0.i && c1.name === 'Big one', 'Undo puts it back where it was');

  const [sdl] =await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#songb [data-act="export"]')]);
  const songMid = path.join(out, sdl.suggestedFilename());
  await sdl.saveAs(songMid);
  ok(songMid && fs.statSync(songMid).size > 100 && fs.readFileSync(songMid).slice(0, 4).toString() === 'MThd', 'the song exports as MIDI');
  ok(await page.evaluate(() => Odd.app.ws.songs.length === 1 && Odd.app.ws.songs[0].secs.length === 3), 'the song is in the workspace');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'Song Builder fits a phone with no sideways scroll');
  await page.screenshot({ path: path.join(out, 'song-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => Odd.store.flush());
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('.h-bob');
  await page.waitForTimeout(300);
  await page.click('.h-card[data-to="song"]');
  await page.waitForTimeout(900);
  g = await sg();
  ok(g.phase === 'song' && g.n === 3 && g.closed === 1 && g.full === 2, 'the song comes back after a reload');
  await page.click('#songb [data-act="home"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.body.dataset.screen === 'home'), 'the logo goes home from the Song Builder');

  await page.screenshot({ path: path.join(out, 'flow-end.png') });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  if (errors.length) process.exitCode = 1;
  console.log('files in ' + out);
  await browser.close();
})();
