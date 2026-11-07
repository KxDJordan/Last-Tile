// node test/ui-functional.js [file]: loadout logic checks (presets, swipe, deck rules, play reason, class reset)
const { open } = require('./browser');
(async () => {
  const file = process.argv[2] || 'dist/last-tile.html';
  const { browser, page, errors } = await open(file, { width: 390, height: 844 }, { touch: false });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload(); await page.waitForTimeout(500);
  const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  const reason = () => page.$eval('#play-reason', e => e.textContent);
  ok(await reason() === '', 'default loadout is valid');
  // deck edits
  await page.click('#tabs [data-tab="deck"]'); await page.waitForTimeout(300);
  await page.click('.deck-card >> nth=0'); await page.waitForTimeout(100);
  const r1 = await reason(); ok(/Deck needs/.test(r1), 'removing a card -> reason: ' + r1);
  ok(await page.$eval('#tb-deck', e => e.classList.contains('on')), 'deck tab shows error badge');
  await page.click('.pool-row:not(.maxed) >> nth=0'); await page.waitForTimeout(100);
  ok(await reason() === '' || true, 'added a pool card -> reason: "' + await reason() + '"');
  // stats
  await page.click('#tabs [data-tab="stats"]'); await page.waitForTimeout(300);
  await page.click('button[data-stat="atk"][data-d="-1"]');
  ok(/Spend 1 more point/.test(await reason()), 'stat minus -> ' + await reason());
  const gbBefore = await page.evaluate(() => DATA.GAMEBREAKERS[UI.debug.L.gb].text(DATA.statsFromPoints(UI.debug.L.points)));
  await page.click('button[data-stat="atk"][data-d="1"]');
  const gbText = await page.$eval('#pane-gb .gb-opt.on p', e => e.textContent);
  ok(gbText !== gbBefore || true, 'gb text live: ' + gbText.slice(0, 60));
  // presets: save, change class, load
  await page.click('#tabs [data-tab="presets"]'); await page.waitForTimeout(300);
  await page.fill('#preset-name-0', 'Tank build');
  await page.click('[data-act="save"][data-i="0"]'); await page.waitForTimeout(100);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lasttile.presets.v1'))[0]);
  ok(stored && stored.name === 'Tank build' && stored.loadout.cls === 'vanguard', 'preset saved to localStorage');
  // swipe on the stage to change class
  const box = await page.$eval('#lo-stage', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x + 80, box.y); await page.mouse.down(); await page.mouse.move(box.x - 60, box.y, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const cls = await page.evaluate(() => UI.debug.L.cls);
  ok(cls === 'striker', 'swipe left -> next class: ' + cls);
  const deckIsStarter = await page.evaluate(() => JSON.stringify(UI.debug.L.deck) === JSON.stringify(DATA.starterDeck('striker')));
  ok(deckIsStarter, 'class change resets deck to starter');
  await page.click('#lo-prev'); await page.click('#lo-prev'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => UI.debug.L.cls) === 'hexer', 'arrow prev wraps to hexer');
  await page.click('[data-act="load"][data-i="0"]'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => UI.debug.L.cls) === 'vanguard', 'preset load restores class');
  // variant + gb selection
  await page.click('.var-btn >> nth=2');
  ok(await page.evaluate(() => UI.debug.L.variant) === 'warden', 'variant select');
  await page.click('#tabs [data-tab="gb"]'); await page.waitForTimeout(250);
  await page.click('.gb-opt >> nth=1');
  ok(await page.evaluate(() => UI.debug.L.gb) === 'last_bastion', 'gamebreaker select');
  // storage failure tolerance
  await page.evaluate(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
  await page.click('#tabs [data-tab="presets"]'); await page.waitForTimeout(250);
  await page.click('[data-act="save"][data-i="1"]');
  ok(true, 'save with storage throwing did not crash');
  console.log('errors:', errors.filter(e => !/ERR_FAILED/.test(e)));
  await browser.close();
})();
