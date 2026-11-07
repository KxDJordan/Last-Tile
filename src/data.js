// DATA: classes, variants, cards, Gamebreakers, deck rules and pattern helpers.
// Plain script, no DOM / THREE / storage. Card effects call into the CORE game object passed as `g`.
var DATA = (function () {
  'use strict';
  var f = Math.floor;

  // ------------------------------------------------------------------ constants
  var CLASS_IDS = ['vanguard', 'striker', 'marksman', 'phantom', 'lifebinder', 'hexer'];
  var CATEGORIES = {
    movement: { name: 'Movement', color: '#38d6ff', icon: '➜' },
    damage: { name: 'Damage', color: '#ff4d5e', icon: '⚔' },
    utility: { name: 'Utility', color: '#ffc94d', icon: '✦' },
    recovery: { name: 'Recovery', color: '#4dff9a', icon: '✚' }
  };
  var TEAM_COLORS = ['#ffd84d', '#ff5a5a', '#4da6ff', '#5dff8a', '#c77dff', '#ff9a3c', '#3cf0e0', '#ff6fc8'];
  var BOT_NAMES = ['Ash', 'Vex', 'Mira', 'Kael', 'Rook', 'Nyx', 'Thorn', 'Sable', 'Lyra', 'Orin', 'Zed', 'Brin',
    'Fen', 'Juno', 'Kira', 'Rune', 'Wren', 'Dax', 'Isla', 'Corvin', 'Eira', 'Talon', 'Moss', 'Vela'];
  var STAT_BASE = { hp: 20, atk: 1, def: 0, spd: 1 };
  var STAT_PER = { hp: 5, atk: 1, def: 1, spd: 1 };
  var STAT_INFO = {
    hp: { name: 'HP', desc: 'Max health. +5 per point.' },
    atk: { name: 'ATK', desc: 'Raises most damage.' },
    def: { name: 'DEF', desc: 'Reduces each hit taken.' },
    spd: { name: 'SPD', desc: 'Tiles you can walk each turn; acts earlier.' }
  };
  var POINTS_TOTAL = 10, POINTS_MAX = 6, DECK_SIZE = 16;

  var CLASSES = {
    vanguard: {
      id: 'vanguard', name: 'Vanguard', role: 'Frontline tank that shoves and shields', color: '#4a7fd4', color2: '#c9d8f0',
      passiveName: 'Unbreakable', passiveText: 'At the start of your turn, your shield becomes at least your DEF.',
      starterDupes: ['shield_bash', 'lance_thrust'], idealRange: 1,
      variants: [
        { id: 'bastion', name: 'Bastion', desc: 'Knight with a huge tower shield and plumed helm.' },
        { id: 'colossus', name: 'Colossus', desc: 'Hulking frame with shoulder plates and a hammer.' },
        { id: 'warden', name: 'Warden', desc: 'Lighter armor, round shield, spear and cape.' }],
      gamebreakers: ['iron_tide', 'last_bastion', 'earthshatter']
    },
    striker: {
      id: 'striker', name: 'Striker', role: 'Mobile brawler that hits hardest on the move', color: '#ff7a2e', color2: '#ffd2a8',
      passiveName: 'Momentum', passiveText: 'Your first Damage card each turn deals +2 if you moved this turn.',
      starterDupes: ['rising_kick', 'flurry'], idealRange: 1,
      variants: [
        { id: 'brawler', name: 'Brawler', desc: 'Oversized glowing gauntlets and a headband.' },
        { id: 'duelist', name: 'Duelist', desc: 'Slim build, twin blades, long flowing scarf.' },
        { id: 'tempest', name: 'Tempest', desc: 'Crackling energy aura with orbiting sparks.' }],
      gamebreakers: ['thousand_cuts', 'blitz_chain', 'final_form']
    },
    marksman: {
      id: 'marksman', name: 'Marksman', role: 'Long-range sniper that loves high ground', color: '#3fa34d', color2: '#c8f0b0',
      passiveName: 'High Ground', passiveText: '+1 range for each elevation level you stand above your target tile.',
      starterDupes: ['long_shot', 'scatter_shot'], idealRange: 4,
      variants: [
        { id: 'ranger', name: 'Ranger', desc: 'Hooded archer with longbow and quiver.' },
        { id: 'gunslinger', name: 'Gunslinger', desc: 'Wide-brim hat and a long rifle.' },
        { id: 'artillerist', name: 'Artillerist', desc: 'Backpack cannon and goggles.' }],
      gamebreakers: ['railpiercer', 'skyfall_volley', 'eagles_perch']
    },
    phantom: {
      id: 'phantom', name: 'Phantom', role: 'Elusive assassin that strikes and vanishes', color: '#8a5cc7', color2: '#d9c6ff',
      passiveName: 'Elusive', passiveText: "The first time you're hit each round, take half damage if you moved 3+ tiles during your last turn.",
      starterDupes: ['backstab', 'flicker_strike'], idealRange: 2,
      variants: [
        { id: 'shade', name: 'Shade', desc: 'Flowing cloak over a semi-transparent body.' },
        { id: 'specter', name: 'Specter', desc: 'Masked face with orbiting daggers.' },
        { id: 'veilblade', name: 'Veilblade', desc: 'Sleek ninja form trailing wisps.' }],
      gamebreakers: ['grand_swap', 'mirror_legion', 'vanish']
    },
    lifebinder: {
      id: 'lifebinder', name: 'Lifebinder', role: 'Resilient healer that drains its foes', color: '#1fb5a5', color2: '#ffd36b',
      passiveName: 'Lifebond', passiveText: 'Heal 1 whenever you deal damage.',
      starterDupes: ['drain_touch', 'life_spear'], idealRange: 2,
      variants: [
        { id: 'verdant', name: 'Verdant', desc: 'Leafy crown and a staff with a glowing seed.' },
        { id: 'seraph', name: 'Seraph', desc: 'Halo, small wings and a gold staff.' },
        { id: 'blood_oracle', name: 'Blood Oracle', desc: 'Crimson robes and a floating red orb.' }],
      gamebreakers: ['undying_pulse', 'siphon_field', 'blood_tether']
    },
    hexer: {
      id: 'hexer', name: 'Hexer', role: 'Corruption caster that weaponizes the rot', color: '#d63ad6', color2: '#ffb3f5',
      passiveName: 'Rotborn', passiveText: 'Take half corruption damage.',
      starterDupes: ['hex_bolt', 'rot_lash'], idealRange: 3,
      variants: [
        { id: 'rotcaller', name: 'Rotcaller', desc: 'Hunched, horned hood and a staff of roots.' },
        { id: 'witchlight', name: 'Witchlight', desc: 'Tall pointed hat and a lantern of purple flame.' },
        { id: 'void_mask', name: 'Void Mask', desc: 'Floating mask with orbiting crystals.' }],
      gamebreakers: ['collapse', 'blight_bloom', 'rot_embrace']
    }
  };

  // ------------------------------------------------------------------ pattern helpers
  var DIRS4 = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  var DIAG4 = [{ dx: 1, dy: -1 }, { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }];
  var DIRS8 = DIRS4.concat(DIAG4);
  function xy(x, y) { return { x: x, y: y }; }
  function inb(g, x, y) { return x >= 0 && y >= 0 && x < g.size && y < g.size; }
  function open(g, x, y) { var t = g.tile(x, y); return !!t && !t.pillar; }
  function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function cheb(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  function same(a, b) { return !!a && !!b && a.x === b.x && a.y === b.y; }
  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  // Unit direction from a to b: diagonal when exactly diagonal, otherwise the dominant axis.
  function dirOf(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
    if (Math.abs(dx) === Math.abs(dy)) return { dx: sign(dx), dy: sign(dy) };
    if (Math.abs(dx) > Math.abs(dy)) return { dx: sign(dx), dy: 0 };
    return { dx: 0, dy: sign(dy) };
  }
  var P = {
    adjacent: function (g, c) { var r = []; DIRS4.forEach(function (d) { if (open(g, c.x + d.dx, c.y + d.dy)) r.push(xy(c.x + d.dx, c.y + d.dy)); }); return r; },
    around: function (g, c) { var r = []; DIRS8.forEach(function (d) { if (open(g, c.x + d.dx, c.y + d.dy)) r.push(xy(c.x + d.dx, c.y + d.dy)); }); return r; },
    cross: function (g, c, len) { var r = []; DIRS4.forEach(function (d) { r = r.concat(P.line(g, c, d, len)); }); return r; },
    // Tiles from c+dir outward, stopping before a pillar unless `through`.
    line: function (g, c, d, len, through) {
      var r = [];
      for (var i = 1; i <= len; i++) {
        var x = c.x + d.dx * i, y = c.y + d.dy * i;
        if (!inb(g, x, y)) break;
        if (g.tile(x, y).pillar) { if (through) continue; break; }
        r.push(xy(x, y));
      }
      return r;
    },
    // 1 tile then 3 tiles.
    cone: function (g, c, d) {
      var px = d.dy, py = d.dx, r = [];
      var a = xy(c.x + d.dx, c.y + d.dy);
      if (open(g, a.x, a.y)) r.push(a);
      var b = xy(c.x + 2 * d.dx, c.y + 2 * d.dy);
      [b, xy(b.x + px, b.y + py), xy(b.x - px, b.y - py)].forEach(function (t) { if (open(g, t.x, t.y)) r.push(t); });
      return r;
    },
    diagX: function (g, c, len) { var r = []; for (var k = 1; k <= len; k++) DIAG4.forEach(function (d) { if (open(g, c.x + d.dx * k, c.y + d.dy * k)) r.push(xy(c.x + d.dx * k, c.y + d.dy * k)); }); return r; },
    square: function (g, c, rad) { var r = []; rad = rad || 1; for (var y = c.y - rad; y <= c.y + rad; y++) for (var x = c.x - rad; x <= c.x + rad; x++) if (inb(g, x, y)) r.push(xy(x, y)); return r; },
    within: function (g, c, rad) { var r = []; for (var y = c.y - rad; y <= c.y + rad; y++) for (var x = c.x - rad; x <= c.x + rad; x++) if (inb(g, x, y) && dist(c, xy(x, y)) <= rad && !(x === c.x && y === c.y)) r.push(xy(x, y)); return r; },
    dirOf: dirOf, dist: dist, cheb: cheb, same: same
  };
  function isCenter(t) { return (t.x === 5 || t.x === 6) && (t.y === 5 || t.y === 6); }

  // ------------------------------------------------------------------ stats
  function statsFromPoints(points, shards) {
    points = points || {}; shards = shards || {};
    function v(k) { return (points[k] || 0) + (shards[k] || 0); }
    return { maxHp: STAT_BASE.hp + STAT_PER.hp * v('hp'), atk: STAT_BASE.atk + v('atk'), def: STAT_BASE.def + v('def'), spd: STAT_BASE.spd + v('spd'), hpPts: v('hp') };
  }

  // ------------------------------------------------------------------ targeting builders
  function U(u) { return { x: u.x, y: u.y }; }
  var T = {
    self: function () { return []; },
    adj: function (g, u) { return P.adjacent(g, u); },
    adjPiece: function (g, u) { return P.adjacent(g, u).filter(function (t) { var e = g.pieceAt(t.x, t.y); return e && g.canAffect(u, e); }); },
    dirs: function (g, u) { return P.adjacent(g, u); },
    ranged: function (r) {
      return function (g, u) {
        return P.within(g, u, r + 6).filter(function (t) {
          var tt = g.tile(t.x, t.y); if (tt.pillar) return false;
          return dist(u, t) <= r + g.rangeBonus(u, t) && g.los(u, t);
        });
      };
    },
    // An enemy piece (or decoy) within r, needing line of sight.
    enemy: function (r, los) {
      return function (g, u) {
        var res = [];
        g.entities.forEach(function (e) {
          if (!e.alive || !g.isEnemy(u, e) || !g.canAffect(u, e)) return;
          if (dist(u, e) > r + g.rangeBonus(u, e)) return;
          if (los !== false && !g.los(u, e)) return;
          res.push(xy(e.x, e.y));
        });
        return res;
      };
    },
    emptyWithin: function (r) { return function (g, u) { return P.within(g, u, r).filter(function (t) { return g.isEmpty(t.x, t.y); }); }; },
    walk: function (budget, climbFree) { return function (g, u) { return g.reachable(u, budget, { climbFree: climbFree }).map(function (n) { return xy(n.x, n.y); }); }; },
    dash: function (lenFn) { return function (g, u) { return g.dashTargets(u, lenFn(g.stats(u))); }; },
    trapWithin: function (r) { return function (g, u) { return P.within(g, u, r).filter(function (t) { var tt = g.tile(t.x, t.y); return !tt.pillar && !(tt.trap && tt.trap.ownerId === u.id) && !g.pieceAt(t.x, t.y) && !tt.cache; }); }; }
  };
  var A = {
    self: function (g, u) { return [U(u)]; },
    pick: function (g, u, p) { return p.length ? [xy(p[0].x, p[0].y)] : []; },
    line: function (len) { return function (g, u, p) { return p.length ? P.line(g, u, dirOf(u, p[0]), len) : []; }; },
    adj4: function (g, u) { return P.adjacent(g, u); }
  };

  // ------------------------------------------------------------------ cards
  var CARDS = {};
  var CARD_ORDER = [];
  function card(id, o) {
    o.id = id;
    if (o.pickCount === undefined) o.pickCount = 1;
    if (!o.targets) o.targets = T.self;
    if (!o.area) o.area = o.pickCount === 0 ? A.self : A.pick;
    CARDS[id] = o; CARD_ORDER.push(id);
    return o;
  }
  // Damage card builder. amt(g,u,e,picks,s) -> raw amount (before DEF) for entity e.
  function dmgCard(id, o) {
    o.cat = 'damage';
    var style = o.style || 'melee';
    o.apply = o.apply || function (g, u, picks) {
      var tiles = o.area(g, u, picks);
      var s = g.stats(u);
      return g.strike(u, tiles, function (e) { return o.amt(g, u, e, picks, s); }, {
        style: style, target: picks[0] || U(u), cardId: id, hits: o.hits || 1, pierce: !!o.pierce
      }).then(function (hits) { return o.after ? o.after(g, u, picks, hits, s) : hits; });
    };
    return card(id, o);
  }
  function pushHits(n, flowOnly) {
    return function (g, u, picks, hits) {
      if (flowOnly && !u.movedThisTurn) return Promise.resolve();
      var chain = Promise.resolve();
      hits.forEach(function (h) { chain = chain.then(function () { if (h.entity.alive) return g.push(h.entity, dirOf(u, h.entity), n, u); }); });
      return chain;
    };
  }
  function walkCard(id, o, budgetFn, climbFree, after) {
    o.cat = 'movement';
    o.targets = function (g, u) { return T.walk(budgetFn(g.stats(u)), climbFree)(g, u); };
    o.apply = function (g, u, p) { return g.walkTo(u, p[0], budgetFn(g.stats(u)), { climbFree: climbFree }).then(function () { return after ? after(g, u, p) : null; }); };
    o.ai = o.ai || { kind: 'move' };
    return card(id, o);
  }
  function dashCard(id, o, lenFn, after) {
    o.cat = 'movement';
    o.targets = T.dash(lenFn);
    o.apply = function (g, u, p) { return g.dashTo(u, p[0]).then(function () { return after ? after(g, u, p) : null; }); };
    o.ai = o.ai || { kind: 'move' };
    return card(id, o);
  }
  function tpCard(id, o, r, after) {
    o.cat = 'movement';
    o.targets = T.emptyWithin(r);
    o.apply = function (g, u, p) { return g.teleport(u, p[0]).then(function () { return after ? after(g, u, p) : null; }); };
    o.ai = o.ai || { kind: 'move' };
    return card(id, o);
  }
  function healCard(id, o, amtFn) {
    o.cat = o.cat || 'recovery'; o.pickCount = 0;
    o.heal = amtFn;
    o.apply = o.apply || function (g, u) { return g.attackSelf(u, id).then(function () { return g.heal(u, amtFn(g.stats(u), g, u)); }); };
    o.ai = o.ai || { kind: 'heal' };
    return card(id, o);
  }
  function onCorruption(g, e) { var t = g.tile(e.x, e.y); return !!t && t.corrupted; }
  function nearCorruption(g, e) {
    if (onCorruption(g, e)) return true;
    return P.adjacent(g, e).some(function (t) { return g.tile(t.x, t.y).corrupted; });
  }

  // ---- General
  walkCard('quick_step', { name: 'Quick Step', cls: 'general', cost: 1, text: function () { return 'Walk up to 2 tiles.'; }, key: function () { return '2'; } }, function () { return 2; });
  dashCard('sprint', { name: 'Sprint', cls: 'general', cost: 2,
    text: function (s) { return 'Dash in a straight line up to ' + (2 + f(s.spd / 2)) + ' tiles.'; }, key: function (s) { return '' + (2 + f(s.spd / 2)); } },
  function (s) { return 2 + f(s.spd / 2); });
  card('shove', { name: 'Shove', cls: 'general', cat: 'movement', cost: 1, targets: T.adjPiece,
    text: function () { return 'Push an adjacent piece 2 tiles.'; }, key: function () { return '2'; },
    apply: function (g, u, p) { var e = g.pieceAt(p[0].x, p[0].y); return g.attackMelee(u, p[0], 'shove').then(function () { return e ? g.push(e, dirOf(u, e), 2, u) : null; }); },
    ai: { kind: 'push', n: 2 } });
  dmgCard('jab', { name: 'Jab', cls: 'general', cost: 1, targets: T.adj,
    amt: function (g, u, e, p, s) { return 2 + s.atk; },
    text: function (s) { return 'Deal ' + (2 + s.atk) + ' to an adjacent tile.'; }, key: function (s) { return '' + (2 + s.atk); } });
  dmgCard('sling_shot', { name: 'Sling Shot', cls: 'general', cost: 2, targets: T.ranged(4), style: 'projectile',
    amt: function (g, u, e, p, s) { return 2 + s.atk; },
    text: function (s) { return 'Deal ' + (2 + s.atk) + ' to a tile within 4.'; }, key: function (s) { return '' + (2 + s.atk); } });
  healCard('bandage', { name: 'Bandage', cls: 'general', cost: 1,
    text: function (s) { return 'Restore ' + (4 + s.hpPts) + ' HP.'; }, key: function (s) { return '+' + (4 + s.hpPts); } },
  function (s) { return 4 + s.hpPts; });
  card('brace', { name: 'Brace', cls: 'general', cat: 'utility', cost: 1, pickCount: 0,
    shieldAmt: function (s) { return 2 + s.def; },
    text: function (s) { return 'Gain a shield of ' + (2 + s.def) + '.'; }, key: function (s) { return '+' + (2 + s.def); },
    apply: function (g, u) { return g.addShield(u, 2 + g.stats(u).def); }, ai: { kind: 'shield' } });
  card('flare', { name: 'Flare', cls: 'general', cat: 'utility', cost: 1, pickCount: 0,
    text: function () { return 'Draw 2 cards.'; }, key: function () { return '2'; },
    apply: function (g, u) { return g.draw(u, 2); }, ai: { kind: 'draw', n: 2 } });

  // ---- Vanguard
  dmgCard('shield_bash', { name: 'Shield Bash', cls: 'vanguard', cost: 2, targets: T.adj,
    amt: function (g, u, e, p, s) { return 2 + s.def; }, after: pushHits(1),
    text: function (s) { return 'Deal ' + (2 + s.def) + ' to an adjacent tile. Push the target 1.'; }, key: function (s) { return '' + (2 + s.def); }, ai: { push: 1 } });
  card('bulwark', { name: 'Bulwark', cls: 'vanguard', cat: 'recovery', cost: 1, pickCount: 0,
    shieldAmt: function (s) { return 2 + f(s.def * 1.5); },
    text: function (s) { return 'Gain a shield of ' + (2 + f(s.def * 1.5)) + '.'; }, key: function (s) { return '+' + (2 + f(s.def * 1.5)); },
    apply: function (g, u) { return g.addShield(u, 2 + f(g.stats(u).def * 1.5)); }, ai: { kind: 'shield' } });
  dashCard('charge', { name: 'Charge', cls: 'vanguard', cost: 2, dmgAdj: function (s) { return 1 + s.def; },
    text: function (s) { return 'Dash up to 3 tiles. Adjacent enemies where you stop take ' + (1 + s.def) + '.'; }, key: function (s) { return '' + (1 + s.def); },
    ai: { kind: 'move', adjDmg: function (s) { return 1 + s.def; } } },
  function () { return 3; },
  function (g, u) {
    var tiles = P.adjacent(g, u).filter(function (t) { var e = g.pieceAt(t.x, t.y); return e && g.isEnemy(u, e); });
    if (!tiles.length) return null;
    var s = g.stats(u);
    return g.strike(u, tiles, function () { return 1 + s.def; }, { style: 'area', target: U(u), cardId: 'charge' });
  });
  card('fortify', { name: 'Fortify', cls: 'vanguard', cat: 'utility', cost: 2, pickCount: 0,
    shieldAmt: function (s) { return 1 + s.def; },
    text: function (s) { return 'Raise your tile 1 level (max 2). Gain a shield of ' + (1 + s.def) + '.'; }, key: function (s) { return '+' + (1 + s.def); },
    apply: function (g, u) { return g.raiseTiles([U(u)], 1, 2).then(function () { return g.addShield(u, 1 + g.stats(u).def); }); }, ai: { kind: 'shield', raise: true } });
  dmgCard('ground_slam', { name: 'Ground Slam', cls: 'vanguard', cost: 3, pickCount: 0, area: A.adj4, style: 'area',
    amt: function (g, u, e, p, s) { return 2 + s.def + f(s.atk / 2); }, after: pushHits(1),
    text: function (s) { return 'Deal ' + (2 + s.def + f(s.atk / 2)) + ' to all 4 adjacent tiles. Push each target 1.'; }, key: function (s) { return '' + (2 + s.def + f(s.atk / 2)); }, ai: { push: 1 } });
  card('war_cry', { name: 'War Cry', cls: 'vanguard', cat: 'utility', cost: 1, pickCount: 0,
    area: function (g, u) { return P.within(g, u, 3); },
    text: function () { return 'Pull every enemy within 3 one tile toward you.'; }, key: function () { return '3'; },
    apply: function (g, u) {
      var es = g.entities.filter(function (e) { return e.alive && g.isEnemy(u, e) && dist(u, e) <= 3 && dist(u, e) > 1 && g.canAffect(u, e); });
      es.sort(function (a, b) { return dist(u, a) - dist(u, b); });
      var chain = g.attackSelf(u, 'war_cry');
      es.forEach(function (e) { chain = chain.then(function () { if (e.alive) return g.pull(e, u, 1, u); }); });
      return chain;
    }, ai: { kind: 'warcry' } });
  healCard('iron_will', { name: 'Iron Will', cls: 'vanguard', cost: 2,
    text: function (s) { return 'Restore ' + (2 + s.def + s.hpPts) + ' HP.'; }, key: function (s) { return '+' + (2 + s.def + s.hpPts); } },
  function (s) { return 2 + s.def + s.hpPts; });
  dmgCard('lance_thrust', { name: 'Lance Thrust', cls: 'vanguard', cost: 2, targets: T.dirs, area: A.line(2), style: 'beam',
    amt: function (g, u, e, p, s) { return 3 + s.atk; },
    text: function (s) { return 'Deal ' + (3 + s.atk) + ' to a line of 2.'; }, key: function (s) { return '' + (3 + s.atk); } });

  // ---- Striker
  dmgCard('rising_kick', { name: 'Rising Kick', cls: 'striker', cost: 2, pickCount: 0, area: A.adj4, style: 'area',
    amt: function (g, u, e, p, s) { return 3 + s.atk; }, after: pushHits(1, true),
    text: function (s) { return 'Deal ' + (3 + s.atk) + ' to all 4 adjacent tiles. Flow: push each target 1.'; }, key: function (s) { return '' + (3 + s.atk); } });
  dashCard('breaker_rush', { name: 'Breaker Rush', cls: 'striker', cost: 2,
    text: function (s) { return 'Dash up to ' + (1 + Math.ceil(s.spd / 2)) + ' tiles. If you stop next to an enemy, deal ' + (3 + s.atk) + ' to one.'; },
    key: function (s) { return '' + (3 + s.atk); }, ai: { kind: 'move', oneDmg: function (s) { return 3 + s.atk; } } },
  function (s) { return 1 + Math.ceil(s.spd / 2); },
  function (g, u) {
    var best = null;
    P.adjacent(g, u).forEach(function (t) {
      var e = g.pieceAt(t.x, t.y);
      if (e && g.isEnemy(u, e) && g.canAffect(u, e) && (!best || g.hpOf(e) < g.hpOf(best))) best = e;
    });
    if (!best) return null;
    var s = g.stats(u);
    return g.strike(u, [U(best)], function () { return 3 + s.atk; }, { style: 'melee', target: U(best), cardId: 'breaker_rush' });
  });
  dmgCard('flurry', { name: 'Flurry', cls: 'striker', cost: 1, targets: T.adj, hits: 2,
    amt: function (g, u, e, p, s) { return 2 + s.atk; },
    text: function (s) { return 'Hit an adjacent tile twice for ' + (2 + s.atk) + ' each.'; }, key: function (s) { return '2×' + (2 + s.atk); } });
  walkCard('lunge', { name: 'Lunge', cls: 'striker', cost: 1, text: function () { return 'Walk up to 3 tiles.'; }, key: function () { return '3'; } }, function () { return 3; });
  dmgCard('haymaker', { name: 'Haymaker', cls: 'striker', cost: 3, targets: T.adj,
    amt: function (g, u, e, p, s) { return 6 + f(s.atk * 1.5) + (u.movedThisTurn ? 3 : 0); },
    text: function (s) { return 'Deal ' + (6 + f(s.atk * 1.5)) + ' to an adjacent tile. Flow: +3 damage.'; }, key: function (s) { return '' + (6 + f(s.atk * 1.5)); } });
  healCard('second_wind', { name: 'Second Wind', cls: 'striker', cost: 1,
    text: function (s) { return 'Restore ' + (5 + s.spd + s.hpPts) + ' HP.'; }, key: function (s) { return '+' + (5 + s.spd + s.hpPts); } },
  function (s) { return 5 + s.spd + s.hpPts; });
  function hookFirst(g, u, dirTile) {
    var line = P.line(g, u, dirOf(u, dirTile), 4);
    for (var i = 0; i < line.length; i++) { var e = g.pieceAt(line[i].x, line[i].y); if (e) return e; }
    return null;
  }
  card('hook_chain', { name: 'Hook Chain', cls: 'striker', cat: 'movement', cost: 2, targets: T.dirs, area: A.line(4),
    text: function () { return 'Pull the first piece in a line of 4 to the tile next to you.'; }, key: function () { return '4'; },
    first: hookFirst,
    apply: function (g, u, p) {
      var e = hookFirst(g, u, p[0]);
      var spec = { style: 'beam', target: e ? U(e) : p[0], tiles: A.line(4)(g, u, p) };
      return g.attackFx(u, spec, 'hook_chain').then(function () { if (e && g.canAffect(u, e)) return g.pull(e, u, 4, u); });
    }, ai: { kind: 'hook' } });
  card('adrenaline', { name: 'Adrenaline', cls: 'striker', cat: 'utility', cost: 1, pickCount: 0,
    text: function () { return 'Draw 2. Gain 1 Energy.'; }, key: function () { return '+1'; },
    apply: function (g, u) { u.energy += 1; return g.draw(u, 2); }, ai: { kind: 'draw', n: 2, energy: 1 } });

  // ---- Marksman
  dmgCard('long_shot', { name: 'Long Shot', cls: 'marksman', cost: 2, targets: T.ranged(6), style: 'projectile',
    amt: function (g, u, e, p, s) { return 5 + s.atk; },
    text: function (s) { return 'Deal ' + (5 + s.atk) + ' to a tile within 6.'; }, key: function (s) { return '' + (5 + s.atk); } });
  dmgCard('piercing_bolt', { name: 'Piercing Bolt', cls: 'marksman', cost: 3, targets: T.dirs, style: 'beam',
    area: function (g, u, p) { return p.length ? P.line(g, u, dirOf(u, p[0]), 6 + g.rangeBonus(u, null)) : []; },
    amt: function (g, u, e, p, s) { return 3 + s.atk; },
    text: function (s) { return 'Deal ' + (3 + s.atk) + ' to every piece in a line of 6.'; }, key: function (s) { return '' + (3 + s.atk); } });
  dmgCard('scatter_shot', { name: 'Scatter Shot', cls: 'marksman', cost: 2, targets: T.dirs, style: 'area',
    area: function (g, u, p) { return p.length ? P.cone(g, u, dirOf(u, p[0])) : []; },
    amt: function (g, u, e, p, s) { return 3 + s.atk; },
    text: function (s) { return 'Deal ' + (3 + s.atk) + ' in a cone.'; }, key: function (s) { return '' + (3 + s.atk); } });
  walkCard('climb', { name: 'Climb', cls: 'marksman', cost: 1, text: function () { return 'Walk up to 3 tiles; climbing costs no extra movement.'; }, key: function () { return '3'; } }, function () { return 3; }, true);
  tpCard('grapple', { name: 'Grapple', cls: 'marksman', cost: 1, text: function () { return 'Teleport to an empty tile within 3.'; }, key: function () { return '3'; } }, 3);
  card('snare', { name: 'Snare', cls: 'marksman', cat: 'utility', cost: 1, targets: T.trapWithin(3),
    trapDmg: function (s) { return 2 + s.atk; },
    text: function (s) { return 'Place a trap within 3: deals ' + (2 + s.atk) + ' and roots (no walking or Movement cards next turn).'; }, key: function (s) { return '' + (2 + s.atk); },
    apply: function (g, u, p) { return g.placeTrap(u, p[0], 'snare', 2 + g.stats(u).atk, true); }, ai: { kind: 'trap' } });
  card('steady_aim', { name: 'Steady Aim', cls: 'marksman', cat: 'utility', cost: 1, pickCount: 0,
    text: function (s) { return 'Your next Damage card deals +' + s.atk + '.'; }, key: function (s) { return '+' + s.atk; },
    apply: function (g, u) { return g.addStatus(u, 'aim', null, { amount: g.stats(u).atk }); }, ai: { kind: 'aim' } });
  healCard('field_dressing', { name: 'Field Dressing', cls: 'marksman', cost: 1,
    text: function (s) { return 'Restore ' + (7 + s.hpPts) + ' HP.'; }, key: function (s) { return '+' + (7 + s.hpPts); } },
  function (s) { return 7 + s.hpPts; });

  // ---- Phantom
  tpCard('phase_step', { name: 'Phase Step', cls: 'phantom', cost: 1, text: function () { return 'Teleport to an empty tile within 3.'; }, key: function () { return '3'; } }, 3);
  function flickerSpot(g, u, e) {
    var best = null, bd = 99;
    P.adjacent(g, e).forEach(function (t) {
      if (!g.isEmpty(t.x, t.y) && !(t.x === u.x && t.y === u.y)) return;
      var d = dist(u, t); if (d < bd) { bd = d; best = t; }
    });
    return best;
  }
  dmgCard('flicker_strike', { name: 'Flicker Strike', cls: 'phantom', cost: 2,
    targets: function (g, u) { return T.enemy(4)(g, u).filter(function (t) { return !!flickerSpot(g, u, t); }); },
    amt: function (g, u, e, p, s) { return 2 + s.spd; }, spot: flickerSpot,
    text: function (s) { return 'Choose an enemy within 4. Teleport next to it and deal ' + (2 + s.spd) + '.'; }, key: function (s) { return '' + (2 + s.spd); },
    apply: function (g, u, p) {
      var spot = flickerSpot(g, u, p[0]);
      var s0 = g.stats(u);
      var go = spot && !(spot.x === u.x && spot.y === u.y) ? g.teleport(u, spot) : Promise.resolve();
      return go.then(function () {
        if (!u.alive) return null;
        var s = g.stats(u);
        return g.strike(u, [xy(p[0].x, p[0].y)], function () { return 2 + s.spd; }, { style: 'melee', target: p[0], cardId: 'flicker_strike' });
      });
    }, ai: { kind: 'flicker' } });
  card('shadow_swap', { name: 'Shadow Swap', cls: 'phantom', cat: 'movement', cost: 2,
    targets: function (g, u) { return g.entities.filter(function (e) { return e.alive && e !== u && dist(u, e) <= 4 && g.canAffect(u, e); }).map(function (e) { return xy(e.x, e.y); }); },
    text: function () { return 'Swap places with any piece within 4.'; }, key: function () { return '4'; },
    apply: function (g, u, p) { var e = g.pieceAt(p[0].x, p[0].y); return e ? g.swap(u, e) : Promise.resolve(); }, ai: { kind: 'swap' } });
  card('caltrops', { name: 'Caltrops', cls: 'phantom', cat: 'utility', cost: 1, targets: T.trapWithin(3),
    trapDmg: function (s) { return 2 + s.spd; },
    text: function (s) { return 'Place a trap within 3 that deals ' + (2 + s.spd) + '.'; }, key: function (s) { return '' + (2 + s.spd); },
    apply: function (g, u, p) { return g.placeTrap(u, p[0], 'caltrops', 2 + g.stats(u).spd, false); }, ai: { kind: 'trap' } });
  card('smoke_veil', { name: 'Smoke Veil', cls: 'phantom', cat: 'utility', cost: 2, pickCount: 0,
    text: function () { return 'The next hit against you deals half damage. Draw 1.'; }, key: function () { return '½'; },
    apply: function (g, u) { return g.addStatus(u, 'veil', null).then(function () { return g.draw(u, 1); }); }, ai: { kind: 'veil' } });
  dmgCard('backstab', { name: 'Backstab', cls: 'phantom', cost: 2, targets: T.adj,
    amt: function (g, u, e, p, s) { return 3 + s.spd + (u.movedThisTurn ? 2 : 0); },
    text: function (s) { return 'Deal ' + (3 + s.spd) + ' to an adjacent tile. Flow: +2 damage.'; }, key: function (s) { return '' + (3 + s.spd); } });
  dmgCard('dagger_fan', { name: 'Dagger Fan', cls: 'phantom', cost: 2, pickCount: 0, style: 'area',
    area: function (g, u) { return P.diagX(g, u, 2); },
    amt: function (g, u, e, p, s) { return 1 + s.spd; },
    text: function (s) { return 'Deal ' + (1 + s.spd) + ' to all 8 diagonal tiles within 2.'; }, key: function (s) { return '' + (1 + s.spd); } });
  healCard('mend_shadows', { name: 'Mend Shadows', cls: 'phantom', cost: 1,
    text: function (s) { return 'Restore ' + (3 + s.spd + s.hpPts) + ' HP.'; }, key: function (s) { return '+' + (3 + s.spd + s.hpPts); } },
  function (s) { return 3 + s.spd + s.hpPts; });

  // ---- Lifebinder
  dmgCard('drain_touch', { name: 'Drain Touch', cls: 'lifebinder', cost: 2, targets: T.adj,
    amt: function (g, u, e, p, s) { return 2 + s.atk; },
    after: function (g, u, p, hits) { var t = 0; hits.forEach(function (h) { t += h.dealt; }); return t > 0 ? g.heal(u, t) : null; },
    text: function (s) { return 'Deal ' + (2 + s.atk) + ' to an adjacent tile. Heal for the damage dealt.'; }, key: function (s) { return '' + (2 + s.atk); }, ai: { drain: true } });
  card('renew', { name: 'Renew', cls: 'lifebinder', cat: 'recovery', cost: 1, pickCount: 0,
    heal: function (s) { return 3 * (2 + f(s.hpPts / 2)); },
    text: function (s) { return 'Regenerate ' + (2 + f(s.hpPts / 2)) + ' HP at the start of each of your next 3 turns.'; }, key: function (s) { return '3×' + (2 + f(s.hpPts / 2)); },
    apply: function (g, u) { return g.addStatus(u, 'renew', 3, { amount: 2 + f(g.stats(u).hpPts / 2) }); }, ai: { kind: 'renew' } });
  healCard('mending_light', { name: 'Mending Light', cls: 'lifebinder', cost: 2,
    text: function (s) { return 'Restore ' + (4 + s.hpPts) + ' HP.'; }, key: function (s) { return '+' + (4 + s.hpPts); } },
  function (s) { return 4 + s.hpPts; });
  dmgCard('life_spear', { name: 'Life Spear', cls: 'lifebinder', cost: 2, targets: T.dirs, area: A.line(3), style: 'beam',
    amt: function (g, u, e, p, s) { return 2 + s.atk + f(s.hpPts / 2); },
    text: function (s) { return 'Deal ' + (2 + s.atk + f(s.hpPts / 2)) + ' to a line of 3.'; }, key: function (s) { return '' + (2 + s.atk + f(s.hpPts / 2)); } });
  card('thorn_bloom', { name: 'Thorn Bloom', cls: 'lifebinder', cat: 'utility', cost: 2, pickCount: 0,
    shieldAmt: function (s) { return 1 + s.hpPts; }, dmgAdj: function (s) { return 2 + f(s.hpPts / 2); },
    area: function (g, u) { return [U(u)].concat(P.adjacent(g, u)); },
    text: function (s) { return 'Gain a shield of ' + (1 + s.hpPts) + '. Adjacent enemies take ' + (2 + f(s.hpPts / 2)) + '.'; }, key: function (s) { return '+' + (1 + s.hpPts); },
    apply: function (g, u) {
      var s = g.stats(u);
      return g.addShield(u, 1 + s.hpPts).then(function () {
        var tiles = P.adjacent(g, u).filter(function (t) { var e = g.pieceAt(t.x, t.y); return e && g.isEnemy(u, e); });
        if (tiles.length) return g.strike(u, tiles, function () { return 2 + f(s.hpPts / 2); }, { style: 'area', target: U(u), cardId: 'thorn_bloom' });
      });
    }, ai: { kind: 'shield', adjDmg: function (s) { return 2 + f(s.hpPts / 2); } } });
  walkCard('spirit_step', { name: 'Spirit Step', cls: 'lifebinder', cost: 1, text: function () { return 'Walk up to 3 tiles. Restore 2 HP.'; }, key: function () { return '3'; }, ai: { kind: 'move', heal: 2 } },
    function () { return 3; }, false, function (g, u) { return g.heal(u, 2); });
  card('sap', { name: 'Sap', cls: 'lifebinder', cat: 'utility', cost: 1, targets: T.enemy(3),
    text: function () { return 'An enemy within 3 gets −2 ATK for 2 rounds.'; }, key: function () { return '−2'; },
    apply: function (g, u, p) { var e = g.pieceAt(p[0].x, p[0].y); return g.attackFx(u, { style: 'projectile', target: p[0], tiles: [p[0]] }, 'sap').then(function () { return e ? g.debuff(u, e, 'sap', 3, { amount: 2 }) : null; }); },
    ai: { kind: 'debuff', status: 'sap' } });
  card('sanctuary', { name: 'Sanctuary', cls: 'lifebinder', cat: 'utility', cost: 2, pickCount: 0,
    area: function (g, u) { return [U(u)].concat(P.adjacent(g, u)); },
    text: function () { return 'Cleanse corruption from your tile and adjacent tiles.'; }, key: function () { return '5'; },
    apply: function (g, u) { return g.cleanseTiles([U(u)].concat(P.adjacent(g, u))); }, ai: { kind: 'cleanse' } });

  // ---- Hexer
  dmgCard('rot_lash', { name: 'Rot Lash', cls: 'hexer', cost: 2, targets: T.dirs, area: A.line(4), style: 'beam',
    amt: function (g, u, e, p, s) { return 2 + s.atk + (nearCorruption(g, e) ? 3 : 0); },
    text: function (s) { return 'Deal ' + (2 + s.atk) + ' to a line of 4. +3 to targets on or next to corruption.'; }, key: function (s) { return '' + (2 + s.atk); } });
  card('blight_seed', { name: 'Blight Seed', cls: 'hexer', cat: 'utility', cost: 1,
    targets: function (g, u) { return P.within(g, u, 3).concat([U(u)]).filter(function (t) { var tt = g.tile(t.x, t.y); return !tt.pillar && !tt.corrupted && !isCenter(t); }); },
    text: function () { return 'Corrupt a tile within 3 (not the center 2×2).'; }, key: function () { return '3'; },
    apply: function (g, u, p) { return g.attackFx(u, { style: 'projectile', target: p[0], tiles: [p[0]] }, 'blight_seed').then(function () { return g.corruptTiles([p[0]]); }); },
    ai: { kind: 'corrupt' } });
  walkCard('riftwalker', { name: 'Riftwalker', cls: 'hexer', cost: 2, text: function () { return 'Walk up to 3 tiles. Ignore corruption damage this turn.'; }, key: function () { return '3'; }, ai: { kind: 'move', rift: true } },
    function () { return 3; }, false, function (g, u) { u.turnFlags.riftwalk = true; return Promise.resolve(); });
  dmgCard('hex_bolt', { name: 'Hex Bolt', cls: 'hexer', cost: 2, targets: T.ranged(5), style: 'projectile',
    amt: function (g, u, e, p, s) { return 3 + s.atk + (onCorruption(g, e) ? 3 : 0); },
    text: function (s) { return 'Deal ' + (3 + s.atk) + ' to a tile within 5. +3 if the target is on corruption.'; }, key: function (s) { return '' + (3 + s.atk); } });
  card('grasping_rot', { name: 'Grasping Rot', cls: 'hexer', cat: 'movement', cost: 2, targets: T.enemy(3),
    text: function () { return 'Push an enemy within 3 two tiles away from you.'; }, key: function () { return '2'; },
    apply: function (g, u, p) { var e = g.pieceAt(p[0].x, p[0].y); return g.attackFx(u, { style: 'projectile', target: p[0], tiles: [p[0]] }, 'grasping_rot').then(function () { return e ? g.push(e, dirOf(u, e), 2, u) : null; }); },
    ai: { kind: 'push', n: 2 } });
  card('cleanse', { name: 'Cleanse', cls: 'hexer', cat: 'utility', cost: 1,
    targets: function (g, u) { return P.within(g, u, 2).concat([U(u)]).filter(function (t) { return g.tile(t.x, t.y).corrupted; }); },
    text: function () { return 'Remove corruption from a tile within 2.'; }, key: function () { return '2'; },
    apply: function (g, u, p) { return g.cleanseTiles([p[0]]); }, ai: { kind: 'cleanse' } });
  card('withering_curse', { name: 'Withering Curse', cls: 'hexer', cat: 'utility', cost: 1, targets: T.enemy(4),
    text: function () { return 'An enemy within 4 takes 2 pierce damage at the start of each of its next 3 turns.'; }, key: function () { return '3×2'; },
    apply: function (g, u, p) { var e = g.pieceAt(p[0].x, p[0].y); return g.attackFx(u, { style: 'projectile', target: p[0], tiles: [p[0]] }, 'withering_curse').then(function () { return e ? g.debuff(u, e, 'curse', 3, { amount: 2 }) : null; }); },
    ai: { kind: 'debuff', status: 'curse' } });
  healCard('dark_pact', { name: 'Dark Pact', cls: 'hexer', cost: 1,
    text: function (s) { return 'Restore ' + (4 + s.atk + s.hpPts) + ' HP. Doubled if you\'re on or next to corruption.'; }, key: function (s) { return '+' + (4 + s.atk + s.hpPts); } },
  function (s, g, u) { var b = 4 + s.atk + s.hpPts; return g && u && nearCorruption(g, u) ? b * 2 : b; });

  // ---- Temporary
  walkCard('blitz_step', { name: 'Blitz Step', cls: 'temp', cost: 0, text: function () { return 'Walk up to 3 tiles. Vanishes at end of turn.'; }, key: function () { return '3'; } }, function () { return 3; });

  // ------------------------------------------------------------------ gamebreakers
  var GAMEBREAKERS = {};
  function gb(id, o) { o.id = id; if (o.pickCount === undefined) o.pickCount = 0; if (!o.targets) o.targets = T.self; if (!o.area) o.area = A.self; GAMEBREAKERS[id] = o; return o; }

  function ironTidePath(g, u, dirTile) {
    var d = dirOf(u, dirTile), path = [U(u)], x = u.x, y = u.y, hitE = null;
    for (var i = 0; i < 6; i++) {
      var nx = x + d.dx, ny = y + d.dy;
      if (!inb(g, nx, ny)) break;
      var e = g.pieceAt(nx, ny);
      if (e) { hitE = e; break; }
      if (!g.canStepDash(x, y, nx, ny)) break;
      x = nx; y = ny; path.push(xy(x, y));
    }
    return { path: path, d: d, hit: hitE };
  }
  gb('iron_tide', { cls: 'vanguard', name: 'Iron Tide', cost: 80, pickCount: 1, targets: T.dirs,
    area: function (g, u, p) { if (!p.length) return []; var r = ironTidePath(g, u, p[0]); var a = r.path.slice(1); if (r.hit) a.push(xy(r.hit.x, r.hit.y)); return a; },
    text: function (s) { return 'Pick a direction. Charge up to 6 tiles, stopping before the first piece or obstacle. A piece you stop at takes ' + (3 + s.def + s.atk) + ' and is knocked back 3.'; },
    plan: ironTidePath,
    apply: function (g, u, p) {
      var r = ironTidePath(g, u, p[0]);
      var go = r.path.length > 1 ? g.moveAlong(u, r.path, 'dash') : Promise.resolve();
      return go.then(function () {
        if (!r.hit || !u.alive || !r.hit.alive) return null;
        var s = g.stats(u), e = r.hit;
        return g.strike(u, [U(e)], function () { return 3 + s.def + s.atk; }, { style: 'melee', target: U(e), cardId: 'iron_tide', gb: true })
          .then(function () { if (e.alive) return g.push(e, r.d, 3, u); });
      });
    } });
  gb('last_bastion', { cls: 'vanguard', name: 'Last Bastion', cost: 60,
    text: function (s) { return 'Gain a shield of ' + (s.def + 3) + '. For 2 rounds, you can\'t be moved and you reflect half of the damage you take (pierce) to the attacker.'; },
    apply: function (g, u) { return g.addShield(u, g.stats(u).def + 3).then(function () { return g.addStatus(u, 'bastion', 2); }); } });
  gb('earthshatter', { cls: 'vanguard', name: 'Earthshatter', cost: 100,
    area: function (g, u) { return P.around(g, u); },
    text: function (s) { return 'Raise all tiles in a 3×3 around you by 1 (max 2). All pieces in the 8 tiles around you take ' + (1 + s.def * 2) + ' and are pushed 2.'; },
    apply: function (g, u) {
      var s = g.stats(u);
      return g.raiseTiles(P.square(g, u, 1), 1, 2).then(function () {
        var tiles = P.around(g, u);
        return g.strike(u, tiles, function () { return 1 + s.def * 2; }, { style: 'area', target: U(u), cardId: 'earthshatter', gb: true });
      }).then(function (hits) {
        var chain = Promise.resolve();
        (hits || []).forEach(function (h) { chain = chain.then(function () { if (h.entity.alive) return g.push(h.entity, dirOf(u, h.entity), 2, u); }); });
        return chain;
      });
    } });
  gb('thousand_cuts', { cls: 'striker', name: 'Thousand Cuts', cost: 60,
    text: function () { return 'Your Damage cards cost 0 Energy for the rest of this turn.'; },
    apply: function (g, u) { u.turnFlags.thousandCuts = true; return Promise.resolve(); } });
  gb('blitz_chain', { cls: 'striker', name: 'Blitz Chain', cost: 70,
    text: function () { return 'For the rest of this turn, each Damage card that hits adds a temporary 0-cost Blitz Step (walk up to 3) to your hand.'; },
    apply: function (g, u) { u.turnFlags.blitz = true; return Promise.resolve(); } });
  gb('final_form', { cls: 'striker', name: 'Final Form', cost: 100,
    text: function (s) { return 'For 2 rounds, gain +' + s.spd + ' ATK (equal to your SPD).'; },
    apply: function (g, u) { return g.addStatus(u, 'finalform', 2, { amount: g.stats(u).spd }); } });
  function railTiles(g, u, dirTile) { return P.line(g, u, dirOf(u, dirTile), 12, true); }
  gb('railpiercer', { cls: 'marksman', name: 'Railpiercer', cost: 80, pickCount: 1, targets: T.dirs,
    area: function (g, u, p) { return p.length ? railTiles(g, u, p[0]) : []; },
    text: function (s) { return 'Pick a direction. Deal ' + (6 + s.atk * 2) + ' pierce to every piece in that line across the entire board, ignoring pillars.'; },
    apply: function (g, u, p) { var s = g.stats(u); return g.strike(u, railTiles(g, u, p[0]), function () { return 6 + s.atk * 2; }, { style: 'beam', target: p[0], cardId: 'railpiercer', pierce: true, gb: true }); } });
  gb('skyfall_volley', { cls: 'marksman', name: 'Skyfall Volley', cost: 80, pickCount: 1,
    targets: function (g) { var r = []; for (var y = 0; y < g.size; y++) for (var x = 0; x < g.size; x++) r.push(xy(x, y)); return r; },
    area: function (g, u, p) { return p.length ? P.square(g, p[0], 1) : []; },
    text: function (s) { return 'Mark a 3×3 area anywhere. At the start of your next turn, deal ' + (8 + s.atk * 2) + ' to every piece inside. The marker is visible to all.'; },
    apply: function (g, u, p) { return g.markSkyfall(u, P.square(g, p[0], 1)); } });
  gb('eagles_perch', { cls: 'marksman', name: "Eagle's Perch", cost: 60,
    text: function () { return 'Raise your tile to level 3. For 2 rounds, gain +2 range and your tile can\'t be entered by any movement.'; },
    apply: function (g, u) { return g.perch(u); } });
  gb('grand_swap', { cls: 'phantom', name: 'Grand Swap', cost: 80, pickCount: 2,
    targets: function (g, u, p) {
      return g.entities.filter(function (e) { return e.alive && g.canAffect(u, e) && !(p.length && e.x === p[0].x && e.y === p[0].y); }).map(function (e) { return xy(e.x, e.y); });
    },
    area: function (g, u, p) { return p.map(function (t) { return xy(t.x, t.y); }); },
    text: function () { return 'Pick any two pieces on the board. Swap their positions.'; },
    apply: function (g, u, p) { var a = g.pieceAt(p[0].x, p[0].y), b = g.pieceAt(p[1].x, p[1].y); return a && b ? g.swap(a, b) : Promise.resolve(); } });
  gb('mirror_legion', { cls: 'phantom', name: 'Mirror Legion', cost: 60,
    area: function (g, u) { return P.within(g, u, 2).filter(function (t) { return g.isEmpty(t.x, t.y); }); },
    text: function () { return 'Create 2 decoys on empty tiles within 2. They look identical to you, never take turns, and vanish when hit.'; },
    apply: function (g, u) {
      var spots = P.within(g, u, 2).filter(function (t) { return g.isEmpty(t.x, t.y); });
      g.shuffle(spots);
      var chain = Promise.resolve();
      spots.slice(0, 2).forEach(function (t) { chain = chain.then(function () { return g.spawnDecoy(u, t); }); });
      return chain;
    } });
  gb('vanish', { cls: 'phantom', name: 'Vanish', cost: 100,
    text: function () { return 'Become invisible and untargetable until your next turn. Your next Damage card deals double.'; },
    apply: function (g, u) { return g.addStatus(u, 'vanish', 1).then(function () { return g.addStatus(u, 'vanishdmg', null); }); } });
  gb('undying_pulse', { cls: 'lifebinder', name: 'Undying Pulse', cost: 100,
    text: function (s) { return 'For 3 rounds, the first lethal hit leaves you at 1 HP and heals ' + f(s.maxHp * 0.3) + ' (30% max HP).'; },
    apply: function (g, u) { return g.addStatus(u, 'undying', 3); } });
  gb('siphon_field', { cls: 'lifebinder', name: 'Siphon Field', cost: 80,
    area: function (g, u) { return P.within(g, u, 2); },
    text: function (s) { return 'Now and at the start of your next turn, every enemy within 2 loses ' + (2 + f(s.hpPts / 2)) + ' HP (pierce), and you heal the total.'; },
    apply: function (g, u) { return g.siphonPulse(u).then(function () { return g.addStatus(u, 'siphon', 1); }); } });
  gb('blood_tether', { cls: 'lifebinder', name: 'Blood Tether', cost: 60, pickCount: 1, targets: T.enemy(4, false),
    text: function () { return 'Link to an enemy within 4 for 2 rounds. You heal for half of all damage it takes.'; },
    apply: function (g, u, p) { var e = g.pieceAt(p[0].x, p[0].y); var tid = e ? (e.isDecoy ? e.id : e.id) : null; return g.addStatus(u, 'tether', 2, { targetId: tid }); } });
  gb('collapse', { cls: 'hexer', name: 'Collapse', cost: 100,
    text: function () { return 'The next corruption ring closes immediately. The ring schedule restarts from now.'; },
    apply: function (g, u) { return g.collapseRing(u); } });
  gb('blight_bloom', { cls: 'hexer', name: 'Blight Bloom', cost: 80, pickCount: 1,
    targets: function (g) { var r = []; for (var y = 0; y < g.size; y++) for (var x = 0; x < g.size; x++) r.push(xy(x, y)); return r; },
    area: function (g, u, p) { return p.length ? P.square(g, p[0], 1).filter(function (t) { return !isCenter(t) && !g.tile(t.x, t.y).pillar; }) : []; },
    text: function () { return 'Corrupt a 3×3 area anywhere (center 2×2 excluded).'; },
    apply: function (g, u, p) { return g.corruptTiles(P.square(g, p[0], 1).filter(function (t) { return !isCenter(t); })); } });
  gb('rot_embrace', { cls: 'hexer', name: 'Rot Embrace', cost: 60,
    text: function () { return 'For 3 rounds, corruption heals you instead of hurting you, and every tile next to where you end your turn becomes corrupted.'; },
    apply: function (g, u) { return g.addStatus(u, 'rotembrace', 3); } });

  // ------------------------------------------------------------------ deck rules
  function starterDeck(cls) {
    var c = CLASSES[cls]; if (!c) return [];
    var ids = classCards(cls).slice();
    ids = ids.concat(c.starterDupes);
    ids = ids.concat(['quick_step', 'sprint', 'jab', 'bandage', 'brace', 'flare']);
    return ids;
  }
  function classCards(cls) { return CARD_ORDER.filter(function (id) { return CARDS[id].cls === cls; }); }
  function generalCards() { return CARD_ORDER.filter(function (id) { return CARDS[id].cls === 'general'; }); }
  function cardPool(cls) { return classCards(cls).concat(generalCards()); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  function validateDeck(cls, deck) {
    var errors = [];
    var counts = { class: 0, general: 0, movement: 0, damage: 0, utility: 0, recovery: 0 };
    deck = deck || [];
    if (!CLASSES[cls]) return { ok: false, errors: ['Pick a class'], counts: counts };
    var copies = {}, bad = [];
    deck.forEach(function (id) {
      var c = CARDS[id];
      if (!c || (c.cls !== cls && c.cls !== 'general')) { bad.push(id); return; }
      if (c.cls === 'general') counts.general++; else counts.class++;
      counts[c.cat]++;
      copies[id] = (copies[id] || 0) + 1;
    });
    if (bad.length) errors.push((CARDS[bad[0]] ? CARDS[bad[0]].name : bad[0]) + ' is not in the ' + CLASSES[cls].name + ' pool');
    if (deck.length < DECK_SIZE) errors.push('Deck needs ' + plural(DECK_SIZE - deck.length, 'more card'));
    if (deck.length > DECK_SIZE) errors.push('Remove ' + plural(deck.length - DECK_SIZE, 'card') + ' (max ' + DECK_SIZE + ')');
    Object.keys(copies).forEach(function (id) { if (copies[id] > 2) errors.push('Max 2 copies of ' + CARDS[id].name); });
    if (counts.general > 6) errors.push('Too many General cards (' + counts.general + '/6)');
    if (counts.class < 10) errors.push('Deck needs ' + plural(10 - counts.class, 'more class card'));
    ['movement', 'damage', 'utility', 'recovery'].forEach(function (cat) {
      if (counts[cat] < 2) errors.push('Deck needs ' + (2 - counts[cat]) + ' more ' + CATEGORIES[cat].name + ' card' + (2 - counts[cat] === 1 ? '' : 's'));
    });
    return { ok: errors.length === 0, errors: errors, counts: counts };
  }

  function validateLoadout(l) {
    var errors = [];
    if (!l || !CLASSES[l.cls]) return { ok: false, errors: ['Pick a class'] };
    var c = CLASSES[l.cls];
    if (!c.variants.some(function (v) { return v.id === l.variant; })) errors.push('Pick a piece');
    var pts = l.points || {}, sum = 0, over = null;
    ['hp', 'atk', 'def', 'spd'].forEach(function (k) {
      var v = pts[k] || 0;
      if (v < 0 || v !== f(v)) over = over || (STAT_INFO[k].name + ' points are invalid');
      if (v > POINTS_MAX) over = over || (STAT_INFO[k].name + ' can have at most ' + POINTS_MAX + ' points');
      sum += v;
    });
    if (sum < POINTS_TOTAL) errors.push('Spend ' + plural(POINTS_TOTAL - sum, 'more point'));
    if (sum > POINTS_TOTAL) errors.push('Remove ' + plural(sum - POINTS_TOTAL, 'point'));
    if (over) errors.push(over);
    if (c.gamebreakers.indexOf(l.gb) < 0) errors.push('Pick a Gamebreaker');
    var d = validateDeck(l.cls, l.deck);
    errors = errors.concat(d.errors);
    return { ok: errors.length === 0, errors: errors };
  }

  // Weighted stat spreads so bots build sensibly for their class.
  var BOT_WEIGHTS = {
    vanguard: { hp: 2, atk: 2.5, def: 1.5, spd: 1.5 },
    striker: { hp: 4, atk: 3, def: 2, spd: 1 },
    marksman: { hp: 4, atk: 3, def: 2, spd: 2 },
    phantom: { hp: 3, atk: 0.5, def: 1.5, spd: 3 },
    lifebinder: { hp: 2.5, atk: 2, def: 1, spd: 1.5 },
    hexer: { hp: 2.5, atk: 3, def: 1, spd: 2 }
  };
  function randomLoadout(rng, cls) {
    rng = rng || Math.random;
    function pick(a) { return a[f(rng() * a.length)]; }
    cls = cls || pick(CLASS_IDS);
    var c = CLASSES[cls], w = BOT_WEIGHTS[cls];
    var pts = { hp: 0, atk: 0, def: 0, spd: 0 };
    for (var i = 0; i < POINTS_TOTAL; i++) {
      var keys = ['hp', 'atk', 'def', 'spd'].filter(function (k) { return pts[k] < POINTS_MAX; });
      var tot = 0; keys.forEach(function (k) { tot += w[k]; });
      var r = rng() * tot, chosen = keys[keys.length - 1];
      for (var j = 0; j < keys.length; j++) { r -= w[keys[j]]; if (r <= 0) { chosen = keys[j]; break; } }
      pts[chosen]++;
    }
    var deck = starterDeck(cls);
    // Occasionally swap one General card for another legal General card.
    if (rng() < 0.5) {
      var gens = generalCards();
      for (var tries = 0; tries < 6; tries++) {
        var idx = f(rng() * deck.length), id = deck[idx];
        if (CARDS[id].cls !== 'general') continue;
        var nd = deck.slice(); nd[idx] = pick(gens);
        if (validateDeck(cls, nd).ok) { deck = nd; break; }
      }
    }
    return { name: pick(BOT_NAMES), cls: cls, variant: pick(c.variants).id, points: pts, gb: pick(c.gamebreakers), deck: deck, isHuman: false };
  }

  return {
    CLASS_IDS: CLASS_IDS, CLASSES: CLASSES, CATEGORIES: CATEGORIES, TEAM_COLORS: TEAM_COLORS, BOT_NAMES: BOT_NAMES,
    STAT_BASE: STAT_BASE, STAT_PER: STAT_PER, STAT_INFO: STAT_INFO, POINTS_TOTAL: POINTS_TOTAL, POINTS_MAX: POINTS_MAX, DECK_SIZE: DECK_SIZE,
    CARDS: CARDS, CARD_ORDER: CARD_ORDER, GAMEBREAKERS: GAMEBREAKERS, BOT_WEIGHTS: BOT_WEIGHTS,
    patterns: P, DIRS4: DIRS4, DIRS8: DIRS8, isCenter: isCenter, nearCorruption: nearCorruption, onCorruption: onCorruption,
    statsFromPoints: statsFromPoints, validateDeck: validateDeck, validateLoadout: validateLoadout,
    starterDeck: starterDeck, cardPool: cardPool, classCards: classCards, generalCards: generalCards, randomLoadout: randomLoadout
  };
})();
