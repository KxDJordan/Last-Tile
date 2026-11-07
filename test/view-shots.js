// Screenshot driver for the VIEW sandbox.  Usage: node test/view-shots.js [shot ...]
// Shots: board sheet corrupt ped demo gb:<id> fx:<action>   Output: test/shots/*.png
const path = require('path'), fs = require('fs');
const { open } = require('./browser');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const FILE = path.join(__dirname, 'view-sandbox.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(query, vp) {
  const o = await open(FILE, vp || { width: 390, height: 844 });
  await o.page.goto('file://' + FILE + query);
  return o;
}
async function shot(o, name) { const f = path.join(OUT, name + '.png'); await o.page.screenshot({ path: f }); console.log('wrote', f); }
function report(o, name) { if (o.errors.length) console.log('ERRORS in', name, '\n  ' + o.errors.join('\n  ')); }

const shots = {
  async board() {
    const o = await page('?mode=board');
    await o.page.waitForFunction('window.READY', null, { timeout: 60000 }); await sleep(1500);
    await shot(o, 'board'); report(o, 'board'); await o.browser.close();
  },
  async nohud() {
    const o = await page('?mode=board&nohud=1');
    await o.page.waitForFunction('window.READY', null, { timeout: 60000 }); await sleep(1200);
    await o.page.evaluate(() => VIEW.setInsets({ top: 0, bottom: 0 })); await sleep(600);
    await shot(o, 'board-nohud'); report(o, 'nohud'); await o.browser.close();
  },
  async sheet() {
    const o = await page('?mode=sheet');
    await o.page.waitForFunction('window.SHEET_READY', null, { timeout: 60000 }); await sleep(1500);
    await shot(o, 'contact-sheet'); report(o, 'sheet'); await o.browser.close();
  },
  async sheetbig() {
    const o = await page('?mode=sheet&zoom=1.0', { width: 900, height: 1500 });
    await o.page.waitForFunction('window.SHEET_READY', null, { timeout: 60000 }); await sleep(1500);
    await shot(o, 'contact-sheet-large'); report(o, 'sheetbig'); await o.browser.close();
  },
  async sheetback() {
    const o = await page('?mode=sheet&turn=2.4', { width: 900, height: 1500 });
    await o.page.waitForFunction('window.SHEET_READY', null, { timeout: 60000 }); await sleep(1500);
    await shot(o, 'contact-sheet-back'); report(o, 'sheetback'); await o.browser.close();
  },
  async corrupt() {
    const o = await page('?mode=board');
    await o.page.waitForFunction('window.READY', null, { timeout: 60000 }); await sleep(500);
    await o.page.evaluate(() => SANDBOX.A.corruptedState()); await sleep(800);
    await o.page.evaluate(() => { SANDBOX.A.highlight(); SANDBOX.A.invisible(); });
    await sleep(1200); await shot(o, 'corrupted');
    // ring close mid-sweep
    await o.page.evaluate(() => { SANDBOX.A.visible(); VIEW.clearHighlight(); SANDBOX.A.ringClose(); });
    await sleep(700); await shot(o, 'ring-close');
    await sleep(1500); await shot(o, 'ring-closed');
    report(o, 'corrupt'); await o.browser.close();
  },
  async ped() {
    const o = await page('?mode=ped&cls=lifebinder&variant=seraph');
    await o.page.waitForFunction('window.SHEET_READY', null, { timeout: 60000 }); await sleep(1500);
    await shot(o, 'pedestal'); report(o, 'ped'); await o.browser.close();
  },
  async fxs() {
    const o = await page('?mode=board');
    await o.page.waitForFunction('window.READY', null, { timeout: 60000 }); await sleep(600);
    if (process.env.ZOOM) await o.page.evaluate(z => { VIEW._debug.cam.zoom = +z; }, process.env.ZOOM);
    const list = (process.env.FX || 'dash,melee,projectile,beam,area,heal,shield,corruptionHit,death,teleport,cache,decoys').split(',');
    for (const a of list) {
      await o.page.evaluate(a => { window.__p = SANDBOX.A[a](); }, a);
      await sleep(+(process.env.FXDELAY || 230)); await shot(o, 'fx-' + a);
      await o.page.evaluate(() => window.__p); await sleep(300);
    }
    report(o, 'fxs'); await o.browser.close();
  },
  async gbs() {
    const o = await page('?mode=board');
    await o.page.waitForFunction('window.READY', null, { timeout: 60000 }); await sleep(600);
    if (process.env.ZOOM) await o.page.evaluate(z => { VIEW._debug.cam.zoom = +z; }, process.env.ZOOM);
    const list = (process.env.GB || 'iron_tide,last_bastion,earthshatter,thousand_cuts,blitz_chain,final_form,railpiercer,skyfall_volley,eagles_perch,grand_swap,mirror_legion,vanish,undying_pulse,siphon_field,blood_tether,collapse,blight_bloom,rot_embrace').split(',');
    const area = []; for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) area.push({ x, y });
    for (const g of list) {
      await o.page.evaluate(([g, area]) => { window.__p = SANDBOX.A.gb(g, { user: 7, picks: [{ x: 6, y: 5 }, { x: 2, y: 1 }], tiles: area }); }, [g, area]);
      await sleep(+(process.env.GBDELAY || 650)); await shot(o, 'gb-' + g);
      await o.page.evaluate(() => window.__p); await sleep(300);
    }
    report(o, 'gbs'); await o.browser.close();
  },
  async demo() {
    const o = await page('?mode=demo');
    await o.page.waitForFunction('window.DEMO_DONE', null, { timeout: 240000 });
    await shot(o, 'demo-end'); report(o, 'demo'); console.log('demo complete, errors:', o.errors.length); await o.browser.close();
  },
  async tap() {
    const o = await page('?mode=board');
    await o.page.waitForFunction('window.READY', null, { timeout: 60000 }); await sleep(800);
    // project player 1's position and tap it, then tap an empty spot
    const pt = await o.page.evaluate(() => { const pc = VIEW._debug.pieces()['1']; const v = pc.root.position.clone(); v.y += 0.4; v.project(VIEW._debug.camera()); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
    await o.page.mouse.click(pt.x, pt.y); await sleep(200);
    console.log('tap piece ->', await o.page.evaluate(() => JSON.stringify({ tile: LAST_TAP.tile, e: LAST_TAP.entity && LAST_TAP.entity.id })));
    await o.page.mouse.click(195, 420); await sleep(200);
    console.log('tap board ->', await o.page.evaluate(() => JSON.stringify({ tile: LAST_TAP.tile, e: LAST_TAP.entity && LAST_TAP.entity.id })));
    // drag rotate
    await o.page.mouse.move(100, 400); await o.page.mouse.down(); await o.page.mouse.move(220, 380, { steps: 8 }); await o.page.mouse.up(); await sleep(500);
    await shot(o, 'rotated'); report(o, 'tap'); await o.browser.close();
  }
};

(async () => {
  const want = process.argv.slice(2).filter(a => a[0] !== '-'); if (process.argv.includes('--real')) return; const run = want.length ? want : ['board', 'sheet', 'corrupt'];
  for (const s of run) { if (!shots[s]) { console.log('unknown shot', s); continue; } const t = Date.now(); await shots[s](); console.log(s, 'took', Date.now() - t, 'ms'); }
})().catch(e => { console.error(e); process.exit(1); });

// Real CORE + AI driving VIEW (8 bots). node test/view-shots.js --real
if (process.argv.includes('--real')) (async () => {
  const o = await open(path.join(__dirname, 'view-real.html'), { width: 390, height: 844 });
  const t0 = Date.now(); let i = 0;
  while (Date.now() - t0 < (+process.env.REALMS || 420000)) {
    await sleep(25000);
    await o.page.screenshot({ path: path.join(OUT, 'real-' + (i++) + '.png') });
    const st = await o.page.evaluate(() => ({ done: !!window.REAL_DONE, round: REAL.game.round, err: REAL.error, alive: REAL.game.players.filter(p => p.alive).length, gerr: (REAL.game.errors || []).slice(0, 5) }));
    console.log('t=' + Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(st));
    if (st.done) break;
  }
  console.log('calls', JSON.stringify(await o.page.evaluate(() => REAL.calls)));
  console.log('errors:', o.errors.length ? '\n  ' + o.errors.slice(0, 20).join('\n  ') : 'none');
  await o.browser.close();
})();
