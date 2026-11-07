// node test/play-through.js [file] [WxH] [prefix]
// Plays a whole match: the human moves toward the center or ends turn; on elimination it picks
// Spectate; it screenshots the elimination sheet and the end screen, then presses Play Again.
const { open } = require('./browser');
(async () => {
  const file = process.argv[2] || 'dist/last-tile.html';
  const [w, h] = (process.argv[3] || '390x844').split('x').map(Number);
  const pre = process.argv[4] || 'test/shots/ui/pt';
  const { browser, page, errors } = await open(file, { width: w, height: h });
  await page.waitForTimeout(500);
  await page.click('#play');
  const t0 = Date.now(); let turns = 0, shotElim = false, shotSpec = false;
  while (Date.now() - t0 < 9 * 60e3) {
    const st = await page.evaluate(() => {
      const M = UI.debug.M;
      return { turn: !!M.turn && !M.busy, elim: !!document.querySelector('.elim-modal'), end: !!document.querySelector('.end-modal'),
        cache: !!document.querySelector('.cache-modal'), round: M.game && M.game.round, spect: M.spectating };
    });
    if (st.end) break;
    if (st.cache) { await page.click('.cache-opt[data-i="0"]'); continue; }
    if (st.elim) {
      if (!shotElim) { await page.waitForTimeout(500); await page.screenshot({ path: `${pre}-elim.png` }); shotElim = true; }
      await page.click('.elim-modal [data-e="spec"]');
      await page.evaluate(() => VIEW.setSpeed(12));
      continue;
    }
    if (st.spect && !shotSpec) { await page.waitForTimeout(400); await page.screenshot({ path: `${pre}-spectate.png` }); shotSpec = true; }
    if (st.turn) {
      turns++;
      await page.evaluate(() => VIEW.setSpeed(12));
      await page.click('#btn-end');
    }
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${pre}-end.png` });
  const r = await page.evaluate(() => ({ round: UI.debug.M.game.round, over: UI.debug.M.game.over, title: (document.querySelector('.end-title') || {}).textContent }));
  console.log('human turns', turns, r, 'secs', Math.round((Date.now() - t0) / 1000));
  // Play Again then Back to Loadout through the menu
  if (await page.$('.end-modal [data-x="again"]')) {
    await page.click('.end-modal [data-x="again"]');
    await page.waitForFunction(() => UI.debug.M.turn, null, { timeout: 60000 }).catch(() => console.log('no human turn after replay'));
    await page.click('#ht-menu'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${pre}-menu.png` });
    await page.click('[data-m="leave"]'); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${pre}-back.png` });
    console.log('loadout visible', await page.evaluate(() => !document.querySelector('#loadout').classList.contains('hidden')));
  }
  console.log('errors:', errors.filter(e => !/ERR_FAILED/.test(e)));
  await browser.close();
})();
