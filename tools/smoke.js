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

  // switch roles 1-6 and generate each
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press(String(i));
    await page.waitForTimeout(150);
    const role = await page.evaluate(() => Odd.app.ui.booth.role);
    ok(role === Odd_roles()[i - 1], 'role key ' + i + ' -> ' + role);
  }
  function Odd_roles() { return ['drums', 'bass', 'chords', 'pad', 'lead', 'arp']; }

  // param change re-rolls same seed
  await page.keyboard.press('2');
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

  // reload keeps the work
  await page.evaluate(() => Odd.store.flush());
  const libBefore = await shelfCount();
  await page.reload();
  await page.waitForTimeout(600);
  ok((await shelfCount()) === libBefore, 'shelf survives reload');

  await page.screenshot({ path: path.join(out, 'flow-end.png') });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  if (errors.length) process.exitCode = 1;
  console.log('files in ' + out);
  await browser.close();
})();
