// node test/shoot-misc.js [file] [WxH] [prefix]: banner, GB targeting, elimination sheet, reduced-motion flag
const { open } = require('./browser');
(async () => {
  const file = process.argv[2] || 'dist/last-tile.html';
  const [w, h] = (process.argv[3] || '390x844').split('x').map(Number);
  const pre = process.argv[4] || 'test/shots/ui/misc';
  const { browser, page, errors } = await open(file, { width: w, height: h });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(400);
  console.log('reduced flag', await page.evaluate(() => document.documentElement.classList.contains('reduced-motion')));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.click('#play');
  await page.waitForFunction(() => UI.debug.M.turn, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => UI.hooks.banner('Ring closing next round', 'ring'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${pre}-banner.png` });
  await page.waitForTimeout(1500);
  // charge the gamebreaker and open it
  await page.evaluate(() => { const g = UI.debug.M.game; g.players[g.humanId].meter = 100; UI.hooks.refresh(); });
  await page.waitForTimeout(300);
  await page.click('#btn-gb'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${pre}-gb.png` });
  const gbinfo = await page.evaluate(() => { const s = UI.debug.M.sel; return s && { kind: s.kind, pc: s.pickCount, targets: (s.targets || []).length, blocked: s.blocked }; });
  console.log('gb sel', gbinfo);
  await page.click('#detail [data-d="cancel"]');
  // Move mode
  await page.click('#btn-move'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${pre}-move.png` });
  await page.click('#detail [data-d="cancel"]');
  // inspect not-my-turn: end turn then tap a card
  // elimination sheet (fake: mark the human dead)
  await page.evaluate(() => { const g = UI.debug.M.game, me = g.players[g.humanId]; me.alive = false; me.hp = 0; me.place = 6; UI.hooks.refresh(); });
  await page.waitForSelector('.elim-modal', { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${pre}-elim.png` });
  console.log('errors:', errors.filter(e => !/ERR_FAILED/.test(e)));
  await browser.close();
})();
