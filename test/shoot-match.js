// node test/shoot-match.js [file] [WxH] [prefix]  (uses mock VIEW's tileCenter to tap tiles)
const { open } = require('./browser');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const file = process.argv[2] || 'test/out/dev.html';
  const [w, h] = (process.argv[3] || '390x844').split('x').map(Number);
  const pre = process.argv[4] || 'test/shots/ui/m';
  const { browser, page, errors } = await open(file, { width: w, height: h });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload(); await page.waitForTimeout(500);
  await page.click('#play');
  // wait for human turn
  await page.waitForFunction(() => UI.debug.M.turn, null, { timeout: 30000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${pre}-hud.png` });
  const info = await page.evaluate(() => {
    const g = UI.debug.M.game, me = g.players[g.humanId];
    return { hand: me.hand.map(h => [h.uid, h.id, DATA.CARDS[h.id].pickCount, g.canPlay(me, h.uid).ok]), insets: VIEW._insets };
  });
  console.log(JSON.stringify(info));
  // pick a playable card with pickCount 1
  const c = info.hand.find(x => x[2] === 1 && x[3]);
  if (c) {
    await page.click(`.hand-card[data-uid="${c[0]}"]`); await page.waitForTimeout(400);
    await page.screenshot({ path: `${pre}-target.png` });
    const t = await page.evaluate(uid => { const g = UI.debug.M.game, me = g.players[g.humanId]; const ts = g.cardTargets(me, uid, []); return ts[0]; }, c[0]);
    const p = t && await page.evaluate(t => {
      if (typeof VIEW.tileCenter === 'function') return VIEW.tileCenter(t.x, t.y);
      // real VIEW: scan the stage with VIEW.pick for a point over the tile (tile only, no piece)
      for (let y = 110; y < innerHeight - 260; y += 4) for (let x = 4; x < innerWidth; x += 4) {
        const h = VIEW.pick(x, y); if (h && h.tile && h.tile.x === t.x && h.tile.y === t.y) return { x, y };
      }
      return null;
    }, t);
    if (p) {
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
      await page.screenshot({ path: `${pre}-preview.png` });
      await page.click('#detail [data-d="confirm"]'); await page.waitForTimeout(800);
      await page.screenshot({ path: `${pre}-after.png` });
    }
  }
  // Free walk: idle highlight -> tap preview -> confirm, turn continues
  if (await page.evaluate(() => !!UI.debug.M.turn)) {
    await page.screenshot({ path: `${pre}-walk-idle.png` });
    const wt = await page.evaluate(() => { const g = UI.debug.M.game, me = g.players[g.humanId]; const ts = g.walkTargets(me); return ts.length ? { t: ts[ts.length - 1], left: me.moveLeft } : null; });
    if (wt) {
      await page.evaluate(t => UI.onTileTap({ tile: t, entity: null }), wt.t); await page.waitForTimeout(500);
      await page.screenshot({ path: `${pre}-walk-preview.png` });
      await page.click('#detail [data-d="confirm"]');
      await page.waitForFunction(() => !UI.debug.M.busy, null, { timeout: 60000 }); await page.waitForTimeout(800);
      await page.screenshot({ path: `${pre}-walk-after.png` });
      console.log('walk', JSON.stringify(await page.evaluate(l => { const g = UI.debug.M.game, me = g.players[g.humanId]; return { before: l, left: me.moveLeft, turnStillMine: !!UI.debug.M.turn }; }, wt.left)));
    }
  }
  // GB inspect / select
  await page.click('#btn-gb'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${pre}-gb.png` });
  await page.click('#detail [data-d="cancel"]');
  // log expand
  await page.click('#log-toggle'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${pre}-log.png` });
  await page.click('#log-toggle');
  console.log('errors:', errors.filter(e => !/ERR_FAILED/.test(e)));
  await browser.close();
})();
