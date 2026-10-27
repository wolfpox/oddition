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

  // ---- Bones to Gold: the opening screen
  const bones = () => page.evaluate(() => ({ phase: Odd.bones.state.phase, sel: Odd.bones.state.sel, dir: Odd.bones.state.round && Odd.bones.state.round.dir, playing: Odd.bones.playing && Odd.transport.playing, order: Odd.bones.state.idea.order.slice() }));
  ok(await page.evaluate(() => document.body.dataset.screen === 'bones' && !!document.querySelector('[data-act="begin"]') && getComputedStyle(document.querySelector('#desk')).display === 'none'), 'opens on Bones to Gold');
  await page.click('[data-act="begin"]');
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
  ok((await page.$$('.b-call .b-req')).length >= 4, 'requests sit above the lifted card');
  await page.click('.b-call .b-req >> text=Why does that work?');
  ok(/scale|minor|major|Dorian|Lydian|Phrygian|Mixolydian|Pentatonic/i.test(await page.textContent('.b-say')), 'Bobby says why');
  await page.click('.b-card.lifted [data-act="promote"]');
  await page.waitForTimeout(500);
  b = await bones();
  ok(b.dir === 'seed2' && b.sel === 1, 'promoting moves on to the shape');
  ok(!!(await page.$('[data-act="walk"]')) && !!(await page.$('[data-act="finish"]')) === false, 'the plain walk is on offer; gold waits for a melody');
  await page.click('.b-cards .b-card[data-i="1"] [data-act="promote"]');
  await page.waitForTimeout(500);
  b = await bones();
  ok(b.phase === 'next' && b.playing, 'the melody plays on its own');
  ok((await page.$$('.b-dir')).length === 5 && (await page.$$('.b-dir.tip')).length === 1, 'five ways on, one highlighted');
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
  ok((await page.$$('.b-row')).length === 4, 'every round is in the history');
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

  await page.screenshot({ path: path.join(out, 'flow-end.png') });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  if (errors.length) process.exitCode = 1;
  console.log('files in ' + out);
  await browser.close();
})();
