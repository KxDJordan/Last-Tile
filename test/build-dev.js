// Dev build for UI work: test/ui-mocks.js first, then whichever real src modules exist.
// MOCK=core,ai,view node test/build-dev.js  -> force those modules to stay mocked.
// Output: test/out/dev.html
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const force = (process.env.MOCK || '').split(',').filter(Boolean);
const src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const parts = [`// ===== MOCKS =====\n` + fs.readFileSync(path.join(__dirname, 'ui-mocks.js'), 'utf8')];
const used = [];
for (const f of ['data.js', 'core.js', 'ai.js', 'view.js']) {
  if (force.includes(f.replace('.js', ''))) continue;
  if (fs.existsSync(path.join(root, 'src', f))) { parts.push(`// ===== ${f} =====\n` + src(f)); used.push(f); }
}
parts.push(src('ui.js'), src('main.js'));
let html = src('shell.html').replace('/*__STYLE__*/', () => src('style.css')).replace('/*__SCRIPTS__*/', () => parts.join('\n\n'));
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'dev.html'), html);
console.log('dev build with real:', used.join(', ') || '(none)');
