// Loads DATA, CORE, AI into a node vm context (no DOM). Usage: const {DATA,CORE,AI} = require('./load-core')();
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function load() {
  const ctx = { console, setTimeout, clearTimeout, Promise, Math, JSON, Date };
  vm.createContext(ctx);
  for (const f of ['data.js', 'core.js', 'ai.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    vm.runInContext(code + `\n;this.${f === 'data.js' ? 'DATA' : f === 'core.js' ? 'CORE' : 'AI'} = ${f === 'data.js' ? 'DATA' : f === 'core.js' ? 'CORE' : 'AI'};`, ctx, { filename: f });
  }
  return { DATA: ctx.DATA, CORE: ctx.CORE, AI: ctx.AI };
};
