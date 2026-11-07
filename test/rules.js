// Unit tests for the key rules. Usage: node test/rules.js
const { DATA, CORE, AI } = require('./load-core')();
let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; console.log(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

// A flat empty board with two live players at chosen spots; the rest are removed.
function arena(opts = {}) {
  const cls = opts.cls || ['vanguard', 'striker'];
  const loadouts = cls.concat(Array(8 - cls.length).fill('marksman')).map((c, i) => ({
    name: 'P' + i, cls: c, variant: DATA.CLASSES[c].variants[0].id, points: opts.points && opts.points[i] || { hp: 4, atk: 3, def: 0, spd: 3 },
    gb: DATA.CLASSES[c].gamebreakers[0], deck: DATA.starterDeck(c)
  }));
  const g = new CORE.Game({ loadouts, seed: 42, humanIndex: -1, controllers: [] });
  g.quiet = true;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) Object.assign(g.tiles[y][x], { h: 0, pillar: false, cache: null, trap: null, corrupted: false, warning: false });
  g.players.forEach((p, i) => { if (i >= cls.length) { p.alive = false; p.place = 8 - i; } });
  g._rebuildEntities();
  (opts.pos || [[5, 5], [6, 5]]).forEach((xy, i) => { g.players[i].x = xy[0]; g.players[i].y = xy[1]; });
  return g;
}

(async () => {
  // --- damage minus DEF, minimum 1
  {
    const g = arena({ points: [{ hp: 4, atk: 0, def: 3, spd: 3 }] });
    const t = g.players[0], a = g.players[1];
    const hp0 = t.hp;
    await g.damage(t, 5, { source: 'card', attacker: a });
    eq(hp0 - t.hp, 2, 'damage 5 vs DEF 3 deals 2');
    const hp1 = t.hp;
    await g.damage(t, 2, { source: 'card', attacker: a });
    eq(hp1 - t.hp, 1, 'damage below DEF still deals 1');
  }
  // --- pierce ignores DEF
  {
    const g = arena({ points: [{ hp: 4, atk: 0, def: 3, spd: 3 }] });
    const t = g.players[0], hp0 = t.hp;
    await g.damage(t, 5, { source: 'card', pierce: true, attacker: g.players[1] });
    eq(hp0 - t.hp, 5, 'pierce ignores DEF');
  }
  // --- shields absorb before HP
  {
    const g = arena();
    const t = g.players[0], hp0 = t.hp;
    t.shield = 4;
    const dealt = await g.damage(t, 6, { source: 'card', attacker: g.players[1] });
    eq([hp0 - t.hp, t.shield, dealt], [2, 0, 6], 'shield 4 absorbs 4 of 6');
    t.shield = 10;
    await g.damage(t, 3, { source: 'card', attacker: g.players[1] });
    eq([hp0 - t.hp, t.shield], [2, 7], 'shield larger than the hit absorbs it all');
  }
  // --- corruption: 3 + 2 x rings closed, ignores DEF and shields, Hexer halves
  {
    const g = arena({ cls: ['vanguard', 'hexer'], points: [{ hp: 4, atk: 0, def: 4, spd: 2 }, { hp: 4, atk: 3, def: 0, spd: 3 }] });
    g.ringsClosed = 2;
    eq(g.corruptionDamage(g.players[0]), 7, 'corruption damage with 2 rings closed = 7');
    eq(g.corruptionDamage(g.players[1]), 3, 'Hexer takes half (rounded down) = 3');
    g.ringsClosed = 0;
    eq(g.corruptionDamage(g.players[0]), 3, 'corruption damage with no ring closed = 3');
    g.ringsClosed = 2;
    const v = g.players[0];
    v.shield = 20; g.tile(v.x, v.y).corrupted = true; v.turnFlags = {};
    const hp0 = v.hp;
    await g._endTurn(v);
    eq([hp0 - v.hp, v.shield], [7, 20], 'end-of-turn corruption ignores DEF and shields');
    const h = g.players[1]; g.tile(h.x, h.y).corrupted = true; h.turnFlags = {};
    const hh = h.hp; await g._endTurn(h);
    eq(hh - h.hp, 3, 'Hexer end-of-turn corruption halved');
  }
  // --- movement: stepping up 1 costs 2, up 2 impossible, down is free
  {
    const g = arena({ pos: [[5, 5], [0, 0]] });
    const p = g.players[0];
    g.tile(6, 5).h = 1;            // step up
    g.tile(4, 5).h = 2;            // wall
    const r = g.reachable(p, 2);
    const at = (x, y) => r.find(n => n.x === x && n.y === y);
    eq(at(6, 5) && at(6, 5).cost, 2, 'stepping up 1 level costs 2 movement');
    ok(!at(7, 5), 'cannot continue after spending 2 on a climb');
    ok(!at(4, 5), 'cannot step up 2 levels');
    eq(at(5, 7) && at(5, 7).cost, 2, 'flat walking costs 1 per tile');
    const climb = g.reachable(p, 2, { climbFree: true });
    ok(climb.find(n => n.x === 7 && n.y === 5), 'Climb: climbing costs no extra movement');
    // down is free: from a high tile
    g.tile(5, 5).h = 2; g.tile(5, 4).h = 0;
    const down = g.reachable(p, 1);
    ok(down.find(n => n.x === 5 && n.y === 4), 'stepping down 2 levels costs 1');
  }
  // --- push collision deals 2 pierce
  {
    const g = arena({ points: [{ hp: 4, atk: 3, def: 0, spd: 3 }, { hp: 4, atk: 0, def: 5, spd: 3 }] });
    const a = g.players[0], t = g.players[1];
    g.tile(8, 5).pillar = true;
    const hp0 = t.hp;
    await g.push(t, { dx: 1, dy: 0 }, 3, a);
    eq([t.x, t.y], [7, 5], 'pushed piece stops before the pillar');
    eq(hp0 - t.hp, 2, 'collision deals 2 pierce damage despite DEF 5');
    const hp1 = t.hp;
    t.x = 6; t.y = 5;
    await g.push(t, { dx: 1, dy: 0 }, 1, a);
    eq(hp1 - t.hp, 0, 'unblocked push deals no damage');
    // edge of board
    t.x = 11; t.y = 5; const hp2 = t.hp;
    await g.push(t, { dx: 1, dy: 0 }, 2, a);
    eq(hp2 - t.hp, 2, 'pushing into the board edge collides');
    // 2-level wall
    t.x = 3; t.y = 3; g.tile(3, 2).h = 2; const hp3 = t.hp;
    await g.push(t, { dx: 0, dy: -1 }, 2, a);
    eq([t.y, hp3 - t.hp], [3, 2], 'a 2-level wall blocks pushes');
  }
  // --- ring schedule: round 4, then every 3 rounds, warning the round before
  {
    const g = arena();
    const closes = [], warns = [];
    g.view.ringClose = (ring) => { closes.push([g.round, ring]); return Promise.resolve(); };
    g.view.ringWarning = (ring) => { warns.push([g.round, ring]); return Promise.resolve(); };
    const nextIn = [];
    for (let r = 1; r <= 16; r++) { g.round = r; await g._roundRings(); nextIn.push(g.nextRingIn); }
    eq(closes, [[4, 0], [7, 1], [10, 2], [13, 3], [16, 4]], 'rings close at rounds 4, 7, 10, 13, 16');
    eq(warns, [[3, 0], [6, 1], [9, 2], [12, 3], [15, 4]], 'warning the round before each close');
    eq(nextIn.slice(0, 5), [3, 2, 1, 3, 2], 'nextRingIn counts down');
    eq(nextIn[15], null, 'nextRingIn is null once all rings are closed');
    ok(g.tile(0, 0).corrupted && g.tile(4, 4).corrupted && !g.tile(5, 5).corrupted, 'rings 0-4 corrupted, centre safe');
    eq(g.ringsClosed, 5, '5 rings closed');
    eq(g.corruptionDamage(g.players[0]), 13, 'corruption damage after 5 rings = 13');
    // cleansed tiles in closed rings are corrupted again on the next close
    const g2 = arena(); g2.round = 4; await g2._roundRings();
    g2.tile(0, 3).corrupted = false; g2.round = 7; await g2._roundRings();
    ok(g2.tile(0, 3).corrupted, 'cleansed tile re-corrupted when the next ring closes');
    // collapse restarts the schedule
    const g3 = arena(); g3.round = 5; await g3._roundRings(); g3.round = 5; await g3.collapseRing();
    eq([g3.ringsClosed, g3.nextRingIn], [2, 3], 'Collapse closes a ring now and restarts the schedule');
  }
  // --- deck validation
  {
    const d = DATA.starterDeck('striker');
    eq(DATA.validateDeck('striker', d).ok, true, 'starter deck valid');
    DATA.CLASS_IDS.forEach(c => eq(DATA.validateDeck(c, DATA.starterDeck(c)).ok, true, `${c} starter deck valid`));
    eq(DATA.validateDeck('striker', d.slice(1)).errors[0], 'Deck needs 1 more card', '15 cards');
    eq(DATA.validateDeck('striker', d.concat(['jab'])).errors[0], 'Remove 1 card (max 16)', '17 cards');
    const three = d.slice(); three[three.indexOf('lunge')] = 'flurry';
    ok(DATA.validateDeck('striker', three).errors.includes('Max 2 copies of Flurry'), '3 copies rejected');
    const gen = d.slice(); ['rising_kick', 'flurry'].forEach(id => { gen[gen.lastIndexOf(id)] = 'shove'; });
    const gv = DATA.validateDeck('striker', gen);
    ok(gv.errors.some(e => /General cards \(8\/6\)/.test(e)), 'more than 6 general cards rejected');
    ok(gv.errors.some(e => /more class card/.test(e)), 'fewer than 10 class cards rejected');
    const noRec = d.filter(id => DATA.CARDS[id].cat !== 'recovery').concat(['jab', 'lunge']);
    ok(DATA.validateDeck('striker', noRec).errors.includes('Deck needs 2 more Recovery cards'), 'category minimum');
    const oneRec = d.slice(); oneRec[oneRec.indexOf('bandage')] = 'shove';
    eq(DATA.validateDeck('striker', oneRec).errors[0], 'Deck needs 1 more Recovery card', 'Play-button reason for 1 missing Recovery');
    ok(!DATA.validateDeck('striker', d.slice(0, 15).concat(['long_shot'])).ok, 'other class card rejected');
    const l = { cls: 'striker', variant: 'brawler', points: { hp: 3, atk: 3, def: 1, spd: 0 }, gb: 'final_form', deck: d };
    eq(DATA.validateLoadout(l).errors[0], 'Spend 3 more points', 'loadout points reason');
    l.points = { hp: 7, atk: 3, def: 0, spd: 0 };
    ok(DATA.validateLoadout(l).errors.some(e => /at most 6/.test(e)), 'max 6 points per stat');
    l.points = { hp: 4, atk: 3, def: 1, spd: 2 };
    eq(DATA.validateLoadout(l).ok, true, 'valid loadout');
  }
  // --- other rules
  {
    // turn order: SPD desc, then lower HP
    const g = arena({ cls: ['vanguard', 'striker', 'hexer'], pos: [[1, 1], [3, 3], [5, 5]],
      points: [{ hp: 4, atk: 3, def: 0, spd: 3 }, { hp: 4, atk: 3, def: 0, spd: 3 }, { hp: 4, atk: 0, def: 0, spd: 6 }] });
    g.players[0].hp = 10;
    eq(g._order().map(p => p.id), [2, 0, 1], 'turn order: SPD first, then lower HP');
    // statsFromPoints
    eq(DATA.statsFromPoints({ hp: 2, atk: 3, def: 1, spd: 4 }, { hp: 1 }), { maxHp: 35, atk: 4, def: 1, spd: 5, hpPts: 3 }, 'stat formula incl. shards');
  }
  {
    // phantom passive halves first hit each round if it moved last turn
    const g = arena({ cls: ['phantom', 'striker'] });
    const ph = g.players[0]; ph.movedLastTurn = true; g.round = 3;
    let h = ph.hp; await g.damage(ph, 10, { source: 'card', attacker: g.players[1] }); eq(h - ph.hp, 5, 'Phantom first hit halved');
    h = ph.hp; await g.damage(ph, 10, { source: 'card', attacker: g.players[1] }); eq(h - ph.hp, 10, 'Phantom second hit full');
  }
  {
    // traps: owner does not trigger, enemy does
    const g = arena({ pos: [[5, 5], [7, 5]] });
    const a = g.players[0], b = g.players[1];
    g.tile(6, 5).trap = { ownerId: a.id, kind: 'snare', dmg: 5, root: true };
    a.x = 6; await g._land(a);
    ok(g.tile(6, 5).trap, 'owner does not trigger its own trap');
    a.x = 5; b.x = 6; const h = b.hp; await g._land(b);
    ok(!g.tile(6, 5).trap && h - b.hp === 5 && g.hasStatus(b, 'root'), 'enemy triggers trap: damage + root, trap removed');
  }
  {
    // striker passive +3 on first Damage card after moving; energy and stance
    const g = arena({ cls: ['striker', 'vanguard'], points: [{ hp: 4, atk: 3, def: 0, spd: 3 }, { hp: 4, atk: 0, def: 0, spd: 3 }] });
    const s = g.players[0], t = g.players[1];
    g.active = s; s.energy = 3; s.turnFlags = {}; s.movedThisTurn = true; s.stance = null; s.turnDone = false;
    s.hand = [{ uid: 1, id: 'jab' }, { uid: 2, id: 'jab' }];
    let h = t.hp; await g.playCard(s, 1, [{ x: 6, y: 5 }]);
    eq(h - t.hp, 2 + 4 + 3, 'Striker: first Damage card after moving deals +3');
    h = t.hp; await g.playCard(s, 2, [{ x: 6, y: 5 }]);
    eq(h - t.hp, 6, 'Striker bonus only on the first Damage card');
    eq([s.energy, s.stance, s.discard.length], [1, 'act', 2], 'energy spent, stance act, cards discarded');
    eq(g.walkTargets(s).length, 0, 'no Move stance after acting');
  }
  {
    // energy refill 3 + rings closed (max 6), draw up to 5
    const g = arena();
    const p = g.players[0];
    g.ringsClosed = 2;
    g.controllers = [{ takeTurn: () => Promise.resolve() }, { takeTurn: () => Promise.resolve() }];
    await g._turn(p);
    eq([p.maxEnergy, p.energy, p.hand.length], [5, 5, 5], 'energy 3 + rings, hand drawn to 5');
    g.ringsClosed = 5; await g._turn(p);
    eq(p.maxEnergy, 6, 'energy capped at 6');
  }
  {
    // invisibility: enemies cannot damage a vanished player; AI cannot see it
    const g = arena({ cls: ['phantom', 'striker'] });
    const ph = g.players[0];
    await g.addStatus(ph, 'vanish', 1);
    const h = ph.hp; await g.damage(ph, 8, { source: 'card', attacker: g.players[1] });
    eq(h - ph.hp, 0, 'invisible player is untargetable');
    eq(AI.perceive(g, g.players[1]).enemies.length, 0, 'AI cannot see invisible enemies');
  }
  console.log(`rules: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
