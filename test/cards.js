// Smoke test: plays every card and every Gamebreaker many times on random boards and checks invariants.
// Usage: node test/cards.js [trialsPerCard=40]
const { DATA, CORE, AI } = require('./load-core')();
const TRIALS = parseInt(process.argv[2] || '40', 10);
let errors = [], played = 0, fizzled = 0;
const viewCalls = {};

function makeView() {
  const v = CORE.stubView();
  CORE.VIEW_METHODS.forEach(m => { const o = v[m]; v[m] = function () { viewCalls[m] = (viewCalls[m] || 0) + 1; return o.apply(this, arguments); }; });
  return v;
}
function check(g, label) {
  const seen = {};
  g.entities.forEach(e => {
    const k = e.x + ',' + e.y;
    if (seen[k]) errors.push(`${label}: overlap at ${k}`);
    seen[k] = 1;
    const t = g.tile(e.x, e.y);
    if (!t || t.pillar) errors.push(`${label}: piece on invalid tile ${k}`);
  });
  g.players.forEach(p => {
    if (p.hp > p.maxHp) errors.push(`${label}: hp > maxHp`);
    if (p.energy < 0) errors.push(`${label}: negative energy`);
    if (p.alive && p.hp <= 0) errors.push(`${label}: alive at ${p.hp}`);
  });
  if (g.errors.length) { errors.push(`${label}: ${g.errors[0].split('\n')[0]}`); g.errors.length = 0; }
}
function setup(seed, cls) {
  const rng = CORE.mulberry32(seed);
  const loadouts = [];
  for (let i = 0; i < 8; i++) loadouts.push(DATA.randomLoadout(rng, i === 0 ? cls : undefined));
  const g = new CORE.Game({ loadouts, seed, view: makeView(), controllers: loadouts.map(() => AI.createController({ delay: 0 })), humanIndex: -1 });
  g.quiet = true;
  // crowd pieces near the user so area effects hit things
  const u = g.players[0];
  const spots = [];
  for (let y = 3; y <= 8; y++) for (let x = 3; x <= 8; x++) if (!g.tile(x, y).pillar) spots.push({ x, y });
  g.shuffle(spots);
  g.players.forEach((p, i) => { p.x = spots[i].x; p.y = spots[i].y; p.hp = 1 + g.randInt(p.maxHp); });
  // random corruption, a trap, a decoy
  for (let k = 0; k < 10; k++) { const t = g.tile(g.randInt(12), g.randInt(12)); if (!t.pillar && !DATA.isCenter(t)) t.corrupted = true; }
  if (rng() < 0.5) { const s = spots[9]; g.tile(s.x, s.y).trap = { ownerId: 3, kind: 'caltrops', dmg: 4, root: rng() < 0.5 }; }
  if (rng() < 0.5) { const s = spots[10]; g.decoys.push({ id: 'dX', isDecoy: true, ownerId: 2, x: s.x, y: s.y, alive: true, name: g.players[2].name, statuses: [] }); g._rebuildEntities(); }
  g.round = 1 + g.randInt(12);
  g.ringsClosed = Math.min(4, Math.floor(g.round / 3));
  g.active = u; u.energy = 10; u.turnFlags = {}; u.stance = null; u.turnDone = false;
  u.meter = 100;
  return g;
}

(async () => {
  const ids = Object.keys(DATA.CARDS);
  for (const id of ids) {
    const card = DATA.CARDS[id];
    const cls = card.cls === 'general' || card.cls === 'temp' ? DATA.CLASS_IDS[ids.indexOf(id) % 6] : card.cls;
    for (let t = 0; t < TRIALS; t++) {
      const g = setup(1000 + t * 31 + ids.indexOf(id) * 7, cls);
      const u = g.players[0];
      u.hand = [{ uid: 999, id, temp: id === 'blitz_step' }];
      try {
        const picks = [];
        for (let k = 0; k < card.pickCount; k++) {
          const tg = g.cardTargets(u, 999, picks);
          if (!tg.length) break;
          picks.push(tg[g.randInt(tg.length)]);
        }
        g.cardArea(u, 999, picks);
        const ok = await g.playCard(u, 999, picks);
        if (ok) played++; else fizzled++;
        check(g, `card ${id} trial ${t}`);
      } catch (e) { errors.push(`card ${id}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
    }
  }
  for (const id of Object.keys(DATA.GAMEBREAKERS)) {
    const gb = DATA.GAMEBREAKERS[id];
    for (let t = 0; t < TRIALS; t++) {
      const g = setup(5000 + t * 17, gb.cls);
      const u = g.players[0];
      u.gb = id;
      try {
        const picks = [];
        for (let k = 0; k < gb.pickCount; k++) {
          const tg = g.gbTargets(u, picks);
          if (!tg.length) break;
          picks.push(tg[g.randInt(tg.length)]);
        }
        g.gbArea(u, picks);
        const ok = await g.useGb(u, picks);
        if (ok) played++; else fizzled++;
        // run the start of the next turn to resolve delayed effects (Skyfall, Siphon, statuses)
        await g._startStatuses(u);
        await g._startStatuses(u);
        check(g, `gb ${id} trial ${t}`);
      } catch (e) { errors.push(`gb ${id}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
    }
  }
  console.log(`cards+gamebreakers: ${played} resolved, ${fizzled} refused (no legal target), errors: ${errors.length}`);
  [...new Set(errors)].slice(0, 15).forEach(e => console.log('  ' + e));
  const unused = CORE.VIEW_METHODS.filter(m => !viewCalls[m] && !['init', 'gameOver', 'roundStart', 'turnStart', 'ringWarning', 'ringClose', 'wait'].includes(m));
  if (unused.length) console.log('view methods never called:', unused.join(', '));
  process.exitCode = errors.length ? 1 : 0;
})();
