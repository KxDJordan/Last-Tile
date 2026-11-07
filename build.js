// node build.js -> dist/last-tile.html (single self-contained file)
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const order = ['data.js', 'core.js', 'ai.js', 'view.js', 'ui.js', 'main.js'];
const js = order.filter(f => fs.existsSync(path.join(__dirname, 'src', f)))
  .map(f => `// ===== ${f.replace('.js', '').toUpperCase()} =====\n${src(f)}`).join('\n\n');
if (/<\/script/i.test(js)) throw new Error('source contains </script');
let html = src('shell.html');
html = html.replace('/*__STYLE__*/', () => src('style.css')).replace('/*__SCRIPTS__*/', () => js);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'last-tile.html'), html);
console.log('built dist/last-tile.html', (html.length / 1024).toFixed(1) + ' KB');
