// Headless 8-bot match runner with invariant checks.
// Usage: node test/headless.js [N=200] [--seed=S] [--verbose] [--class=<id>] (forces one bot of that class to be studied)
const load = require('./load-core');
const { DATA, CORE, AI } = load();

const args = process.argv.slice(2);
const N = parseInt(args.find(a => /^\d+$/.test(a)) || '200', 10);
const seedArg = args.find(a => a.startsWith('--seed='));
const BASE_SEED = seedArg ? parseInt(seedArg.split('=')[1], 10) : 1000;
const VERBOSE = args.includes('--verbose');
const STEP_LIMIT = 4000;          // max turns per match
const WALL_MS = 20000;            // wall-clock watchdog per match

const gbStats = {};
const stats = { matches: 0, errors: [], invariant: [], stuck: 0, capped: 0, rounds: [], wins: {}, appear: {}, place: {}, turns: 0, gb: {}, kills: {} };
DATA.CLASS_IDS.forEach(c => { stats.wins[c] = 0; stats.appear[c] = 0; stats.place[c] = 0; stats.gb[c] = 0; });

function checkStarterDecks() {
  DATA.CLASS_IDS.forEach(c => {
    const v = DATA.validateDeck(c, DATA.starterDeck(c));
    if (!v.ok) stats.invariant.push(`starter deck ${c} invalid: ${v.errors.join('; ')}`);
  });
  const rng = CORE.mulberry32(7);
  for (let i = 0; i < 300; i++) {
    const l = DATA.randomLoadout(rng);
    const v = DATA.validateLoadout(l);
    if (!v.ok) stats.invariant.push(`random loadout invalid (${l.cls}): ${v.errors.join('; ')}`);
  }
  // every card and gamebreaker has the required interface
  Object.values(DATA.CARDS).forEach(c => {
    ['targets', 'area', 'apply', 'text', 'key'].forEach(k => { if (typeof c[k] !== 'function') stats.invariant.push(`card ${c.id} missing ${k}`); });
    if (typeof c.pickCount !== 'number') stats.invariant.push(`card ${c.id} missing pickCount`);
    const s = DATA.statsFromPoints({ hp: 3, atk: 3, def: 2, spd: 2 });
    if (/NaN|undefined/.test(c.text(s) + c.key(s))) stats.invariant.push(`card ${c.id} text broken`);
  });
  Object.values(DATA.GAMEBREAKERS).forEach(c => {
    ['targets', 'area', 'apply', 'text'].forEach(k => { if (typeof c[k] !== 'function') stats.invariant.push(`gb ${c.id} missing ${k}`); });
    const s = DATA.statsFromPoints({ hp: 3, atk: 3, def: 2, spd: 2 });
    if (/NaN|undefined/.test(c.text(s))) stats.invariant.push(`gb ${c.id} text broken`);
  });
  const real = Object.values(DATA.CARDS).filter(c => c.cls !== 'temp').length;
  if (real !== 56) stats.invariant.push(`expected 56 cards, found ${real}`);
  if (Object.keys(DATA.GAMEBREAKERS).length !== 18) stats.invariant.push('expected 18 gamebreakers');
}

function invariants(game, where) {
  const bad = [];
  const seen = {};
  game.entities.forEach(e => {
    if (!e.alive) return;
    const k = e.x + ',' + e.y;
    if (seen[k]) bad.push(`two pieces on ${k} (${seen[k]} & ${e.name || e.id})`);
    seen[k] = e.name || e.id;
    const t = game.tile(e.x, e.y);
    if (!t) bad.push(`${e.id} out of bounds`);
    else if (t.pillar) bad.push(`${e.id} on a pillar`);
  });
  game.players.forEach(p => {
    if (p.hp > p.maxHp) bad.push(`${p.name} hp ${p.hp} > maxHp ${p.maxHp}`);
    if (p.energy < 0) bad.push(`${p.name} energy ${p.energy}`);
    if (p.shield < 0) bad.push(`${p.name} shield ${p.shield}`);
    if (p.meter < 0 || p.meter > 100) bad.push(`${p.name} meter ${p.meter}`);
    if (p.hand.length > 7) bad.push(`${p.name} hand ${p.hand.length}`);
    if (p.alive && p.hp <= 0) bad.push(`${p.name} alive with hp ${p.hp}`);
  });
  bad.forEach(b => stats.invariant.push(`[seed ${game.seed} r${game.round} ${where}] ${b}`));
}
function cardCount(game) {
  game.players.forEach(p => {
    if (!p.alive) return;
    const all = p.deck.concat(p.hand, p.discard).filter(c => !c.temp && !c.cache);
    if (all.length !== 16) stats.invariant.push(`[seed ${game.seed} r${game.round}] ${p.name} owns ${all.length} base cards`);
    const uids = new Set(p.deck.concat(p.hand, p.discard).map(c => c.uid));
    if (uids.size !== p.deck.length + p.hand.length + p.discard.length) stats.invariant.push(`[seed ${game.seed}] ${p.name} duplicate card uid`);
  });
}

function makeView(game_ref) {
  const v = CORE.stubView();
  v.refresh = (g) => { invariants(g, 'refresh'); return Promise.resolve(); };
  v.turnStart = (p) => { const g = game_ref.g; g._steps = (g._steps || 0) + 1; if (g._steps > STEP_LIMIT) throw new Error('step limit'); invariants(g, 'turnStart'); cardCount(g); return Promise.resolve(); };
  v.death = (p) => { const g = game_ref.g; if (g.active === p && g.tile(p.x, p.y).corrupted) g._corrDeaths = (g._corrDeaths || 0) + 1; return Promise.resolve(); };
  v.attackCalls = 0; v.hitCalls = 0;
  v.attack = () => { v.attackCalls++; return Promise.resolve(); };
  v.hit = (e, amt, info) => { v.hitCalls++; if (!(amt >= 0)) stats.invariant.push('hit with bad amount ' + amt); return Promise.resolve(); };
  v.move = (e, path, mode) => {
    if (!['walk', 'dash', 'teleport', 'push', 'pull'].includes(mode)) stats.invariant.push('bad move mode ' + mode);
    if (!path || path.length < 2) stats.invariant.push('short move path');
    const last = path[path.length - 1];
    if (last.x !== e.x || last.y !== e.y) stats.invariant.push('move path does not end at entity position');
    return Promise.resolve();
  };
  v.fx = (type, data) => { if (type === 'gamebreaker') game_ref.gbFx = (game_ref.gbFx || 0) + 1; return Promise.resolve(); };
  return v;
}

async function runMatch(i) {
  const seed = BASE_SEED + i * 7919;
  const rng = CORE.mulberry32(seed ^ 0x9e3779b9);
  // each class appears roughly equally: 6 classes over 8 slots, rotated per match
  const classes = [];
  for (let k = 0; k < 8; k++) classes.push(DATA.CLASS_IDS[(i * 8 + k) % 6]);
  const loadouts = classes.map(c => DATA.randomLoadout(rng, c));
  const ref = {};
  const view = makeView(ref);
  const controllers = loadouts.map(() => AI.createController({ delay: 0 }));
  const game = new CORE.Game({ loadouts, seed, view, controllers, humanIndex: -1 });
  game.quiet = true;
  ref.g = game;
  let timer;
  const watchdog = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('wall-clock watchdog')), WALL_MS); });
  try {
    const res = await Promise.race([game.run(), watchdog]);
    clearTimeout(timer);
    stats.matches++;
    stats.rounds.push(res.rounds);
    stats.turns += game.turnCount;
    if (res.endedByCap) stats.capped++;
    if (game.surges > 0) stats.sd = (stats.sd || 0) + 1;
    stats.corrDeaths = (stats.corrDeaths || 0) + (game._corrDeaths || 0);
    game.errors.forEach(e => stats.errors.push(`[seed ${seed}] ${e}`));
    res.players.forEach(p => {
      stats.appear[p.cls]++;
      stats.place[p.cls] += p.place;
      stats.gb[p.cls] += p.stats.gbUsed;
      if (p.place == null) stats.invariant.push(`[seed ${seed}] ${p.name} has no place`);
    });
    const places = res.players.map(p => p.place).sort((a, b) => a - b).join(',');
    if (places !== '1,2,3,4,5,6,7,8') stats.invariant.push(`[seed ${seed}] bad placements ${places}`);
    const w = res.players.find(p => p.id === res.winnerId);
    game.players.forEach(p => { const k = p.gb; gbStats[k] = gbStats[k] || { n: 0, w: 0 }; gbStats[k].n++; if (p.id === res.winnerId) gbStats[k].w++; });
    if (w) stats.wins[w.cls]++;
    if (VERBOSE) console.log(`match ${i} seed ${seed}: ${w ? w.name + ' (' + w.cls + ')' : 'none'} won in ${res.rounds} rounds${res.endedByCap ? ' [cap]' : ''}`);
  } catch (err) {
    clearTimeout(timer);
    if (/watchdog|step limit/.test(err.message)) stats.stuck++;
    stats.errors.push(`[seed ${seed}] ${err.stack || err}`);
  }
}

(async () => {
  const t0 = Date.now();
  checkStarterDecks();
  for (let i = 0; i < N; i++) await runMatch(i);
  const avg = stats.rounds.reduce((a, b) => a + b, 0) / Math.max(1, stats.rounds.length);
  const sorted = stats.rounds.slice().sort((a, b) => a - b);
  console.log(`\nLAST TILE headless: ${stats.matches}/${N} matches completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`reached sudden death (centre corrupted): ${stats.sd || 0}, eliminations by corruption: ${stats.corrDeaths || 0} of ${stats.matches * 7}`);
  console.log(`avg rounds ${avg.toFixed(1)} (median ${sorted[sorted.length >> 1]}, min ${sorted[0]}, max ${sorted[sorted.length - 1]}), ended by round cap: ${stats.capped}, stuck: ${stats.stuck}`);
  console.log('\nclass        appear   wins   win%   per-slot%  avg place  gb/match');
  DATA.CLASS_IDS.forEach(c => {
    const a = stats.appear[c];
    const winPct = stats.wins[c] / Math.max(1, stats.matches) * 100;
    const perSlot = stats.wins[c] / Math.max(1, a) * 100;
    console.log(`${c.padEnd(12)} ${String(a).padStart(6)} ${String(stats.wins[c]).padStart(6)} ${winPct.toFixed(1).padStart(6)} ${perSlot.toFixed(1).padStart(10)} ${(stats.place[c] / Math.max(1, a)).toFixed(2).padStart(10)} ${(stats.gb[c] / Math.max(1, a)).toFixed(2).padStart(9)}`);
  });
  if (args.includes('--gb')) Object.keys(gbStats).sort().forEach(k => console.log(`  gb ${k.padEnd(16)} ${String(gbStats[k].n).padStart(5)} picks  ${(gbStats[k].w / gbStats[k].n * 100).toFixed(1)}% per-slot win`));
  console.log(`\nerrors: ${stats.errors.length}   invariant violations: ${stats.invariant.length}`);
  const show = (arr, label) => { const uniq = [...new Set(arr)]; uniq.slice(0, 8).forEach(e => console.log(`  ${label}: ${e.split('\n').slice(0, 6).join('\n    ')}`)); };
  show(stats.errors, 'ERR');
  show(stats.invariant, 'INV');
  process.exitCode = stats.errors.length || stats.invariant.length ? 1 : 0;
})();
