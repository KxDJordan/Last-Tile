// Drives one "human" seat through the public controller API with random legal choices,
// the way the UI would (walkTargets/doMove, canPlay/cardTargets/cardArea/playCard, gbTargets/useGb, chooseCache).
// Usage: node test/api.js [N=30]
const { DATA, CORE, AI } = require('./load-core')();
const N = parseInt(process.argv[2] || '30', 10);
let errors = [], wins = 0, humanPlays = 0, humanMoves = 0, humanGb = 0, caches = 0;

function randomHuman(rng) {
  const pick = a => a[Math.floor(rng() * a.length)];
  return {
    async takeTurn(g, p) {
      const walk = async () => {
        const w = g.walkTargets(p);
        if (!w.length) return;
        const t = pick(w), cost = g.walkCost(p, t), before = p.moveLeft;
        if (cost == null || cost > before) errors.push('walkTargets offered an unaffordable tile');
        if (await g.doMove(p, t)) { humanMoves++; if (p.alive && p.moveLeft !== before - cost && !g.hasStatus(p, 'root')) errors.push('moveLeft not reduced by walkCost'); }
        else errors.push('doMove refused a walk target');
        if (p.alive && !g.over && p.turnDone) errors.push('walking ended the turn');
      };
      if (rng() < 0.5) await walk();
      for (let i = 0; i < 10 && !g.over && p.alive; i++) {
        if (rng() < 0.2) await walk();
        if (g.canUseGb(p).ok && rng() < 0.5) {
          const gb = DATA.GAMEBREAKERS[p.gb], picks = [];
          for (let k = 0; k < gb.pickCount; k++) { const t = g.gbTargets(p, picks); if (!t.length) break; picks.push(pick(t)); }
          g.gbArea(p, picks);
          if (await g.useGb(p, picks)) humanGb++; else errors.push('useGb refused legal picks for ' + gb.id);
          continue;
        }
        const playable = p.hand.filter(c => g.canPlay(p, c.uid).ok);
        if (!playable.length) break;
        const c = pick(playable), def = DATA.CARDS[c.id], picks = [];
        for (let k = 0; k < def.pickCount; k++) { const t = g.cardTargets(p, c.uid, picks); if (!t.length) break; picks.push(pick(t)); }
        g.cardArea(p, c.uid, picks);
        const cost = g.cardCost(p, c.uid), e0 = p.energy;
        if (await g.playCard(p, c.uid, picks)) {
          humanPlays++;
          if (c.id !== 'adrenaline' && p.alive && p.energy !== e0 - cost) errors.push(`energy mismatch after ${c.id}`);
        } else errors.push('playCard refused legal picks for ' + c.id);
        // illegal picks must be refused without side effects
        const other = p.hand.find(h => DATA.CARDS[h.id].pickCount > 0 && g.canPlay(p, h.uid).ok);
        if (other) { const r = await g.playCard(p, other.uid, [{ x: -1, y: -1 }]); if (r) errors.push('illegal pick accepted'); }
      }
      if (p.alive && !g.over && rng() < 0.5) await walk();
    },
    chooseCache(g, p, options) {
      caches++;
      if (options.length !== 3 || options[2].type !== 'shard' || options[0].type !== 'cards' || options[0].cards.length !== 2) errors.push('bad cache options');
      const i = Math.floor(rng() * 3);
      return Promise.resolve({ index: i, stat: pick(['hp', 'atk', 'def', 'spd']) });
    }
  };
}

(async () => {
  for (let i = 0; i < N; i++) {
    const seed = 777 + i * 101;
    const rng = CORE.mulberry32(seed);
    const loadouts = [];
    for (let k = 0; k < 8; k++) loadouts.push(DATA.randomLoadout(rng));
    loadouts[0].name = 'Hero'; loadouts[0].isHuman = true;
    const controllers = loadouts.map((l, k) => k === 0 ? randomHuman(rng) : AI.createController({ delay: 0 }));
    const g = new CORE.Game({ loadouts, seed, view: CORE.stubView(), controllers, humanIndex: 0 });
    g.quiet = true;
    try {
      const r = await g.run();
      if (g.players[0].name !== 'Hero' || g.players[0].colorIndex !== 0 || g.humanId !== 0) errors.push('human seat setup wrong');
      if (new Set(g.players.map(p => p.name)).size !== 8) errors.push('duplicate player names: ' + g.players.map(p => p.name).join(','));
      if (r.winnerId === 0) wins++;
      g.errors.forEach(e => errors.push(e.split('\n')[0]));
    } catch (e) { errors.push(e.stack); }
  }
  console.log(`api: ${N} matches, random human won ${wins}, plays ${humanPlays}, moves ${humanMoves}, gamebreakers ${humanGb}, caches ${caches}, errors ${errors.length}`);
  [...new Set(errors)].slice(0, 10).forEach(e => console.log('  ' + e));
  process.exitCode = errors.length ? 1 : 0;
})();
