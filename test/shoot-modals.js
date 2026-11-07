// node test/shoot-modals.js [file] [WxH] [prefix]: cache modal, shard pick, eliminated sheet, end screens
const { open } = require('./browser');
(async () => {
  const file = process.argv[2] || 'test/out/dev.html';
  const [w, h] = (process.argv[3] || '390x844').split('x').map(Number);
  const pre = process.argv[4] || 'test/shots/ui/x';
  const { browser, page, errors } = await open(file, { width: w, height: h });
  await page.waitForTimeout(400);
  await page.click('#play');
  await page.waitForFunction(() => UI.debug.M.turn, null, { timeout: 30000 });
  await page.waitForTimeout(1300);
  // cache modal via the human controller
  await page.evaluate(() => {
    const g = UI.debug.M.game, me = g.players[g.humanId];
    const pool = DATA.cardPool(me.cls);
    window.__cache = UI.createHumanController().chooseCache(g, me, [{ type: 'cards', cards: [pool[0], pool[3]] }, { type: 'cards', cards: [pool[5], pool[9]] }, { type: 'shard' }]);
    window.__cache.then(r => { window.__cacheRes = r; });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${pre}-cache.png` });
  await page.click('.cache-opt.shard'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${pre}-shard.png` });
  await page.click('.shard-stat.s-atk'); await page.waitForTimeout(200);
  console.log('cache result', await page.evaluate(() => window.__cacheRes));
  // end screen (victory)
  const results = await page.evaluate(() => {
    const g = UI.debug.M.game;
    g.players.forEach((p, i) => { p.stats = p.stats || {}; p.stats.dmgDealt = 10 + i * 7; });
    return { winnerId: 0, placements: g.players.map(p => p.id), players: g.players.map((p, i) => ({ id: p.id, name: p.name, cls: p.cls, place: i + 1, stats: { dmgDealt: 87, kills: 3, caches: 2, gbUsed: 1 } })) };
  });
  await page.evaluate(r => UI.hooks.gameOver(r), results);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${pre}-victory.png` });
  // lost
  await page.evaluate(() => { document.querySelector('#modal-root').innerHTML = ''; });
  results.winnerId = 3; results.players[0].place = 5; results.placements = [3, 1, 2, 4, 0, 5, 6, 7];
  await page.evaluate(r => UI.hooks.gameOver(r), results);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${pre}-lost.png` });
  console.log('errors:', errors.filter(e => !/ERR_FAILED/.test(e)));
  await browser.close();
})();
