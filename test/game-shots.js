// Integration screenshots of the built game (dist/last-tile.html): loadout + a few match frames.
// Usage: node build.js && node test/game-shots.js
const path = require('path'), fs = require('fs');
const { open } = require('./browser');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const o = await open(path.join(__dirname, '..', 'dist', 'last-tile.html'), { width: 390, height: 844 });
  await sleep(6000);
  await o.page.screenshot({ path: path.join(OUT, 'game-loadout.png') }); console.log('loadout');
  await o.page.click('#play').catch(e => console.log('no play', e.message));
  for (let i = 0; i < 4; i++) {
    await sleep(+(process.env.STEP || 9000));
    await o.page.screenshot({ path: path.join(OUT, 'game-match-' + i + '.png') }); console.log('match', i);
  }
  console.log('errors:', o.errors.length ? '\n  ' + o.errors.slice(0, 20).join('\n  ') : 'none');
  await o.browser.close();
})().catch(e => { console.error(e); process.exit(1); });
