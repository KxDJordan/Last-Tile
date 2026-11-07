// Playwright helper: opens a local HTML file with the three.js r128 CDN routed to node_modules.
// const { open } = require('./browser'); const { browser, page, errors } = await open('dist/last-tile.html', {width:390,height:844});
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const THREE_FILE = path.join(__dirname, '..', 'node_modules/three/build/three.min.js');
async function open(file, viewport = { width: 390, height: 844 }, opts = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  await page.route(THREE_URL, r => r.fulfill({ body: fs.readFileSync(THREE_FILE), contentType: 'application/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(file));
  return { browser, page, errors };
}
module.exports = { open };
