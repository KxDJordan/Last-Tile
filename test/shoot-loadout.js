// node test/shoot-loadout.js [file] [WxH] [prefix]
const { open } = require('./browser');
(async () => {
  const file = process.argv[2] || 'test/out/dev.html';
  const [w, h] = (process.argv[3] || '390x844').split('x').map(Number);
  const pre = process.argv[4] || 'test/shots/ui/lo';
  const { browser, page, errors } = await open(file, { width: w, height: h });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload(); await page.waitForTimeout(900);
  await page.screenshot({ path: `${pre}-stats.png` });
  for (const t of ['gb', 'deck', 'presets']) {
    await page.click(`#tabs [data-tab="${t}"]`); await page.waitForTimeout(450);
    await page.screenshot({ path: `${pre}-${t}.png` });
  }
  // deck scrolled to pool
  await page.click('#tabs [data-tab="deck"]'); await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector('#pane-deck').scrollTop = 420; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${pre}-deck2.png` });
  // invalid state
  await page.click('#tabs [data-tab="stats"]'); await page.waitForTimeout(300);
  await page.click('button[data-stat="hp"][data-d="-1"]');
  await page.click('button[data-stat="hp"][data-d="-1"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${pre}-invalid.png` });
  await page.click('#lo-next'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${pre}-next.png` });
  // overlap check: elements outside viewport
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#loadout button').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.width && (r.height < 43.5 || r.width < 43.5) && !b.closest('.pane:not(.on)')) out.push((b.id || b.className || b.textContent).slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    return out;
  });
  console.log('small targets:', bad);
  console.log('errors:', errors);
  await browser.close();
})();
