// UI development mocks. Loaded BEFORE the real modules by test/build-dev.js, so any real
// src/data.js, core.js, ai.js or view.js that exists overrides the matching mock.
// Exposes MOCK for tests: MOCK.game (current fake game).

var MOCK = { game: null };

// ---------------------------------------------------------------- DATA (minimal)
var DATA = (function () {
  var CAT = { movement: { name: 'Movement', color: '#38d6ff', icon: '➜' }, damage: { name: 'Damage', color: '#ff4d5e', icon: '⚔' },
    utility: { name: 'Utility', color: '#ffc94d', icon: '✦' }, recovery: { name: 'Recovery', color: '#4dff9a', icon: '✚' } };
  var ids = ['vanguard', 'striker', 'marksman', 'phantom', 'lifebinder', 'hexer'];
  var cols = ['#4a7fd4', '#ff7a2e', '#3fae5a', '#8a5cd6', '#2ec4b6', '#e040a0'];
  var CLASSES = {}, CARDS = {}, GB = {};
  function card(id, name, cls, cat, cost, pick, f, t) {
    CARDS[id] = { id: id, name: name, cls: cls, cat: cat, cost: cost, pickCount: pick,
      key: function (s) { return String(f(s)); }, text: function (s) { return t.replace('#', f(s)); } };
  }
  card('quick_step', 'Quick Step', 'general', 'movement', 1, 1, function () { return 2; }, 'Walk up to # tiles.');
  card('jab', 'Jab', 'general', 'damage', 1, 1, function (s) { return 2 + s.atk; }, 'Deal # to an adjacent tile.');
  card('bandage', 'Bandage', 'general', 'recovery', 1, 0, function (s) { return '+' + (4 + s.hpPts); }, 'Restore # HP.');
  card('brace', 'Brace', 'general', 'utility', 1, 0, function (s) { return '+' + (2 + s.def); }, 'Gain a shield of #.');
  ids.forEach(function (id, i) {
    CLASSES[id] = { id: id, name: id[0].toUpperCase() + id.slice(1), role: 'Role line', color: cols[i], color2: '#fff', passiveName: 'Passive', passiveText: 'Passive text.',
      starterDupes: [], idealRange: 2, variants: [{ id: id + 'a', name: 'Alpha', desc: '' }, { id: id + 'b', name: 'Beta', desc: '' }, { id: id + 'c', name: 'Gamma', desc: '' }],
      gamebreakers: [id + '_g1', id + '_g2', id + '_g3'] };
    [1, 2, 3].forEach(function (n) { GB[id + '_g' + n] = { id: id + '_g' + n, cls: id, name: 'Break ' + n, cost: 40 + n * 20, pickCount: n === 1 ? 1 : 0, text: function (s) { return 'Deal ' + (4 + s.atk) + '.'; } }; });
    ['movement', 'damage', 'utility', 'recovery'].forEach(function (c, j) {
      card(id + '_' + c + '1', 'Class ' + c, id, c, 1 + (j % 2), c === 'recovery' || c === 'utility' ? 0 : 1, function (s) { return 2 + s.atk; }, 'Effect #.');
      card(id + '_' + c + '2', 'Class ' + c + ' II', id, c, 2, 1, function (s) { return 3 + s.atk; }, 'Effect #.');
    });
  });
  function statsFromPoints(p, sh) { sh = sh || {}; var v = function (k) { return (p[k] | 0) + (sh[k] | 0); }; return { maxHp: 20 + 5 * v('hp'), atk: 1 + v('atk'), def: v('def'), spd: 1 + v('spd'), hpPts: v('hp') }; }
  function cardPool(cls) { return Object.keys(CARDS).filter(function (id) { return CARDS[id].cls === cls || CARDS[id].cls === 'general'; }); }
  function starterDeck(cls) { var d = cardPool(cls).filter(function (id) { return CARDS[id].cls === cls; }); return d.concat(d.slice(0, 4), ['quick_step', 'jab', 'bandage', 'brace']); }
  function validateDeck(cls, deck) {
    var c = { 'class': 0, general: 0, movement: 0, damage: 0, utility: 0, recovery: 0 }, e = [];
    deck.forEach(function (id) { var k = CARDS[id]; c[k.cls === 'general' ? 'general' : 'class']++; c[k.cat]++; });
    if (deck.length !== 16) e.push(deck.length < 16 ? 'Deck needs ' + (16 - deck.length) + ' more cards' : 'Deck has too many cards');
    ['movement', 'damage', 'utility', 'recovery'].forEach(function (k) { if (c[k] < 2) e.push('Deck needs ' + (2 - c[k]) + ' more ' + CAT[k].name + ' card'); });
    return { ok: !e.length, errors: e, counts: c };
  }
  function validateLoadout(lo) {
    var used = lo.points.hp + lo.points.atk + lo.points.def + lo.points.spd, e = [];
    if (used < 10) e.push('Spend ' + (10 - used) + ' more points');
    e = e.concat(validateDeck(lo.cls, lo.deck).errors);
    return { ok: !e.length, errors: e };
  }
  function randomLoadout(rng, cls) {
    cls = cls || ids[Math.floor(rng() * 6)];
    return { name: 'Bot', cls: cls, variant: CLASSES[cls].variants[0].id, points: { hp: 4, atk: 2, def: 2, spd: 2 }, gb: CLASSES[cls].gamebreakers[0], deck: starterDeck(cls), isHuman: false };
  }
  return { CLASS_IDS: ids, CLASSES: CLASSES, CATEGORIES: CAT, TEAM_COLORS: ['#ffd84d', '#ff5a5a', '#4da6ff', '#5dff8a', '#c77dff', '#ff9a3c', '#3cf0e0', '#ff6fc8'],
    CARDS: CARDS, GAMEBREAKERS: GB, statsFromPoints: statsFromPoints, validateLoadout: validateLoadout, validateDeck: validateDeck,
    starterDeck: starterDeck, cardPool: cardPool, randomLoadout: randomLoadout };
})();

// ---------------------------------------------------------------- CORE (fake game)
var CORE = (function () {
  function Game(o) {
    var g = this;
    MOCK.game = g;
    g.size = 12; g.view = o.view; g.controllers = o.controllers; g.humanId = o.humanIndex;
    g.round = 0; g.ringsClosed = 0; g.nextRingIn = 3; g.log = []; g.over = false; g.winner = null; g.active = null;
    g.tiles = [];
    for (var y = 0; y < 12; y++) {
      var row = [];
      for (var x = 0; x < 12; x++) {
        var ring = Math.min(x, y, 11 - x, 11 - y);
        row.push({ x: x, y: y, h: (Math.sin(x * 1.3) + Math.cos(y * 0.9) > 1.1) ? 1 : 0, ring: ring, corrupted: false, warning: false, pillar: false, cache: null, trap: null, marked: false });
      }
      g.tiles.push(row);
    }
    [[3, 3], [8, 3], [3, 8], [8, 8], [5, 2], [2, 6], [9, 5], [6, 9]].forEach(function (p) { g.tiles[p[1]][p[0]].pillar = true; });
    [[1, 4], [10, 7], [4, 10], [7, 1], [2, 2], [9, 9]].forEach(function (p) { g.tiles[p[1]][p[0]].cache = {}; });
    var spawns = [[1, 1], [5, 1], [10, 1], [10, 5], [10, 10], [6, 10], [1, 10], [1, 6]];
    var uid = 0;
    g.players = o.loadouts.map(function (lo, i) {
      var st = DATA.statsFromPoints(lo.points);
      var deck = lo.deck.map(function (id) { return { uid: 'c' + (uid++), id: id }; });
      return { id: i, index: i, name: lo.name, cls: lo.cls, variant: lo.variant, colorIndex: i, color: DATA.TEAM_COLORS[i], isHuman: !!lo.isHuman,
        x: spawns[i][0], y: spawns[i][1], hp: st.maxHp, maxHp: st.maxHp, shield: 0, energy: 3, maxEnergy: 3, hand: [], deck: deck, discard: [],
        meter: i === 0 ? 85 : 20, gb: lo.gb, gbUsedThisTurn: false, alive: true, place: 0, statuses: [], stance: null, movedThisTurn: false,
        stats: { dmgDealt: 0, kills: 0, caches: 0, gbUsed: 0 }, points: lo.points };
    });
    g.entities = g.players.slice();
    g.turnOrder = g.players.slice();
  }
  var P = Game.prototype;
  P.tile = function (x, y) { return x < 0 || y < 0 || x > 11 || y > 11 ? null : this.tiles[y][x]; };
  P.stats = function (p) { return DATA.statsFromPoints(p.points); };
  P.occupied = function (x, y) { return this.players.some(function (p) { return p.alive && p.x === x && p.y === y; }); };
  P.within = function (p, r, needEmpty) {
    var out = [], g = this;
    for (var y = 0; y < 12; y++) for (var x = 0; x < 12; x++) {
      var d = Math.abs(x - p.x) + Math.abs(y - p.y);
      if (d === 0 || d > r || g.tiles[y][x].pillar) continue;
      if (needEmpty && g.occupied(x, y)) continue;
      out.push({ x: x, y: y });
    }
    return out;
  };
  P.walkTargets = function (p) { return p.stance === 'act' ? [] : this.within(p, 2, true); };
  P.card = function (p, uid) { var h = p.hand.filter(function (c) { return c.uid === uid; })[0]; return h ? DATA.CARDS[h.id] : null; };
  P.cardCost = function (p, uid) { var c = this.card(p, uid); return c ? c.cost : 0; };
  P.canPlay = function (p, uid) {
    var c = this.card(p, uid);
    if (!c) return { ok: false, reason: 'Not in hand' };
    if (p.stance === 'move') return { ok: false, reason: 'Already moved' };
    if (c.cost > p.energy) return { ok: false, reason: 'Not enough Energy' };
    return { ok: true };
  };
  P.cardTargets = function (p, uid, picks) {
    var c = this.card(p, uid);
    if (!c || c.pickCount === 0) return [];
    if (c.cat === 'movement') return this.within(p, 3, true);
    return this.within(p, c.cost >= 2 ? 4 : 1, false);
  };
  P.cardArea = function (p, uid, picks) {
    var c = this.card(p, uid);
    if (!c) return [];
    if (!c.pickCount) return [{ x: p.x, y: p.y }];
    var t = picks[picks.length - 1];
    if (!t) return [];
    if (c.cat === 'damage' && c.cost >= 2) return [t, { x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 }].filter(function (q) { return q.x >= 0 && q.y >= 0 && q.x < 12 && q.y < 12; });
    return [t];
  };
  P.canUseGb = function (p) {
    var gb = DATA.GAMEBREAKERS[p.gb];
    if (p.gbUsedThisTurn) return { ok: false, reason: 'Already used this turn' };
    if (p.meter < gb.cost) return { ok: false, reason: 'Needs ' + gb.cost + ' charge' };
    return { ok: true };
  };
  P.gbTargets = function (p, picks) {
    var gb = DATA.GAMEBREAKERS[p.gb];
    if (!gb.pickCount) return [];
    return this.players.filter(function (q) { return q.alive && !picks.some(function (k) { return k.x === q.x && k.y === q.y; }); }).map(function (q) { return { x: q.x, y: q.y }; });
  };
  P.gbArea = function (p, picks) { return picks.slice(); };
  P.useGb = async function (p, picks) {
    var gb = DATA.GAMEBREAKERS[p.gb];
    p.meter -= gb.cost; p.gbUsedThisTurn = true; p.stats.gbUsed++;
    if (p.stance == null) p.stance = 'act';
    await this.view.banner(gb.name, 'gb');
    await this.view.fx('gamebreaker', { gb: gb.id, user: p, picks: picks, tiles: picks });
    this.addLog(p.name + ' unleashes ' + gb.name);
    await this.view.refresh(this);
  };
  P.addLog = function (s) { this.log.push(s); this.view.log(s); };
  P.draw = function (p, n) {
    for (var i = 0; i < n && p.hand.length < 7; i++) {
      if (!p.deck.length) { p.deck = p.discard; p.discard = []; }
      if (!p.deck.length) return;
      p.hand.push(p.deck.splice(Math.floor(Math.random() * p.deck.length), 1)[0]);
    }
  };
  P.damage = async function (src, target, amt) {
    var st = this.stats(target);
    var dealt = Math.max(1, amt - st.def);
    var abs = Math.min(target.shield, dealt); target.shield -= abs; dealt -= abs;
    target.hp -= dealt;
    src.stats.dmgDealt += dealt;
    src.meter = Math.min(100, src.meter + 10);
    await this.view.hit(target, dealt, { pierce: false, source: 'card', absorbed: abs, big: dealt >= 8 });
    if (target.hp <= 0) await this.kill(target, src);
  };
  P.kill = async function (t, src) {
    t.alive = false; t.hp = 0;
    var alive = this.players.filter(function (p) { return p.alive; }).length;
    t.place = alive + 1;
    if (src) src.stats.kills++;
    this.addLog(t.name + ' was eliminated (' + t.place + ')');
    await this.view.death(t, t.place);
    await this.view.banner(t.name + ' eliminated', 'elim');
  };
  P.playCard = async function (p, uid, picks) {
    var c = this.card(p, uid);
    p.energy -= c.cost; p.stance = 'act';
    p.hand = p.hand.filter(function (h) { return h.uid !== uid; });
    p.discard.push({ uid: uid, id: c.id });
    var st = this.stats(p), g = this;
    this.addLog(p.name + ' plays ' + c.name);
    if (c.cat === 'movement' && picks[0]) {
      var path = [{ x: p.x, y: p.y }, picks[0]];
      await this.view.move(p, path, 'dash');
      p.x = picks[0].x; p.y = picks[0].y; p.movedThisTurn = true;
      await this.maybeCache(p);
    } else if (c.cat === 'damage') {
      var area = this.cardArea(p, uid, picks);
      await this.view.attack(p, { style: area.length > 1 ? 'area' : 'melee', from: { x: p.x, y: p.y }, target: picks[0], tiles: area, color: '#ff4d5e', cardId: c.id });
      var amt = parseInt(c.key(st), 10) || 3;
      var hits = this.players.filter(function (q) { return q.alive && q !== p && area.some(function (t) { return t.x === q.x && t.y === q.y; }); });
      for (var i = 0; i < hits.length; i++) await g.damage(p, hits[i], amt);
    } else if (c.cat === 'recovery') {
      var h = parseInt(String(c.key(st)).replace('+', ''), 10) || 4;
      p.hp = Math.min(p.maxHp, p.hp + h);
      await this.view.heal(p, h);
    } else {
      p.shield += 2 + st.def;
      await this.view.shield(p, p.shield);
    }
    await this.view.refresh(this);
    this.checkOver();
  };
  P.maybeCache = async function (p) {
    var t = this.tile(p.x, p.y);
    if (!t.cache) return;
    t.cache = null; p.meter = Math.min(100, p.meter + 15); p.stats.caches++;
    await this.view.fx('cache-open', { entity: p, tile: t });
    await this.view.tilesChanged([t]);
    var pool = DATA.cardPool(p.cls);
    var pick = function () { return pool[Math.floor(Math.random() * pool.length)]; };
    var opts = [{ type: 'cards', cards: [pick(), pick()] }, { type: 'cards', cards: [pick(), pick()] }, { type: 'shard' }];
    var ch = await this.controllers[p.id].chooseCache(this, p, opts);
    var o = opts[ch.index];
    if (o.type === 'cards') o.cards.forEach(function (id, i) { p.hand.push({ uid: 'x' + Math.random(), id: id }); });
    else { p.points = Object.assign({}, p.points); p.points[ch.stat]++; if (ch.stat === 'hp') { p.maxHp += 5; p.hp += 5; } }
    this.addLog(p.name + ' opens a cache');
  };
  P.doMove = async function (p, t) {
    p.stance = 'move';
    await this.view.move(p, [{ x: p.x, y: p.y }, t], 'walk');
    p.x = t.x; p.y = t.y; p.movedThisTurn = true;
    this.draw(p, 1);
    this.addLog(p.name + ' moves');
    await this.maybeCache(p);
    await this.view.refresh(this);
  };
  P.checkOver = function () {
    var alive = this.players.filter(function (p) { return p.alive; });
    if (alive.length <= 1 && !this.over) { this.over = true; this.winner = alive[0] || null; if (alive[0]) alive[0].place = 1; }
  };
  P.run = async function () {
    var g = this;
    await g.view.init(g);
    while (!g.over && g.round < 60) {
      g.round++;
      g.nextRingIn = 3 - ((g.round - 1) % 3);
      await g.view.roundStart(g.round);
      if (g.nextRingIn === 1) await g.view.banner('Ring closing next round', 'ring');
      g.turnOrder = g.players.filter(function (p) { return p.alive; }).sort(function (a, b) { return g.stats(b).spd - g.stats(a).spd; });
      for (var i = 0; i < g.turnOrder.length && !g.over; i++) {
        var p = g.turnOrder[i];
        if (!p.alive) continue;
        g.active = p; p.stance = null; p.gbUsedThisTurn = false; p.movedThisTurn = false;
        p.maxEnergy = Math.min(6, 3 + g.ringsClosed); p.energy = p.maxEnergy;
        g.draw(p, 5 - p.hand.length);
        await g.view.turnStart(p);
        await g.view.refresh(g);
        await g.controllers[p.id].takeTurn(g, p);
        g.checkOver();
      }
      g.active = null;
    }
    g.checkOver();
    var placements = g.players.slice().sort(function (a, b) { return (a.place || 1) - (b.place || 1); }).map(function (p) { return p.id; });
    var res = { winnerId: g.winner ? g.winner.id : -1, placements: placements, players: g.players.map(function (p) { return { id: p.id, name: p.name, cls: p.cls, place: p.place || 1, stats: p.stats }; }) };
    await g.view.gameOver(res);
    return res;
  };
  function stubView() {
    var v = {};
    ['init', 'refresh', 'wait', 'roundStart', 'turnStart', 'tilesChanged', 'move', 'collide', 'attack', 'hit', 'heal', 'shield', 'status', 'death', 'spawn', 'remove', 'ringWarning', 'ringClose', 'fx', 'banner', 'log', 'gameOver']
      .forEach(function (k) { v[k] = function () { return Promise.resolve(); }; });
    return v;
  }
  return { Game: Game, stubView: stubView };
})();

// ---------------------------------------------------------------- AI (fake bots)
var AI = (function () {
  function createController(opts) {
    return {
      takeTurn: async function (g, p) {
        await g.view.wait(opts.delay || 400);
        var dmg = p.hand.filter(function (h) { var c = DATA.CARDS[h.id]; return c.cat === 'damage' && g.canPlay(p, h.uid).ok; })[0];
        if (dmg) {
          var t = g.cardTargets(p, dmg.uid, []).filter(function (t) { return g.players.some(function (q) { return q.alive && q !== p && q.x === t.x && q.y === t.y; }); })[0];
          if (t) { await g.playCard(p, dmg.uid, [t]); return; }
        }
        var w = g.walkTargets(p);
        if (w.length) {
          w.sort(function (a, b) { return (Math.abs(a.x - 5.5) + Math.abs(a.y - 5.5)) - (Math.abs(b.x - 5.5) + Math.abs(b.y - 5.5)); });
          await g.doMove(p, w[0]);
        }
      },
      chooseCache: function () { return Promise.resolve({ index: 0 }); }
    };
  }
  return { createController: createController };
})();

// ---------------------------------------------------------------- VIEW (2D canvas stub)
var VIEW = (function () {
  var stageEl, cv, ctx, game = null, insets = { top: 0, bottom: 0 }, hl = { targets: [], area: [], color: '#fff' }, speed = 1, raf = 0;
  var api = { onTap: null };
  function geom() {
    var w = cv.width, h = cv.height, avail = h - insets.top - insets.bottom;
    var cell = Math.min((w - 16) / 12, (avail - 16) / 12);
    return { cell: cell, ox: (w - cell * 12) / 2, oy: insets.top + (avail - cell * 12) / 2 };
  }
  function draw() {
    if (!ctx) return;
    var g = geom();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!game) return;
    for (var y = 0; y < 12; y++) for (var x = 0; x < 12; x++) {
      var t = game.tiles[y][x], px = g.ox + x * g.cell, py = g.oy + y * g.cell;
      ctx.fillStyle = t.pillar ? '#3a3448' : t.corrupted ? '#5a1a6a' : ['#8a7a64', '#a08f74', '#b8a684'][t.h] || '#ccc';
      ctx.fillRect(px + 1, py + 1, g.cell - 2, g.cell - 2);
      if (t.warning) { ctx.strokeStyle = '#e04dff'; ctx.strokeRect(px + 2, py + 2, g.cell - 4, g.cell - 4); }
      if (t.cache) { ctx.fillStyle = '#ffd36b'; ctx.fillRect(px + g.cell * .3, py + g.cell * .35, g.cell * .4, g.cell * .3); }
    }
    function mark(list, a, fill) {
      list.forEach(function (t) {
        ctx.fillStyle = fill; ctx.globalAlpha = a;
        ctx.fillRect(g.ox + t.x * g.cell + 1, g.oy + t.y * g.cell + 1, g.cell - 2, g.cell - 2);
        ctx.globalAlpha = 1;
      });
    }
    mark(hl.targets, .35, hl.color || '#fff');
    mark(hl.area, .75, hl.color || '#fff');
    game.players.forEach(function (p) {
      if (!p.alive) return;
      var cx = g.ox + (p.x + .5) * g.cell, cy = g.oy + (p.y + .5) * g.cell;
      ctx.beginPath(); ctx.arc(cx, cy, g.cell * .34, 0, 7); ctx.fillStyle = DATA.CLASSES[p.cls].color; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = p.color; ctx.stroke();
      if (game.active === p) { ctx.beginPath(); ctx.arc(cx, cy, g.cell * .46, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = '#000a'; ctx.fillRect(cx - g.cell * .4, cy - g.cell * .62, g.cell * .8, 4);
      ctx.fillStyle = '#4dff9a'; ctx.fillRect(cx - g.cell * .4, cy - g.cell * .62, g.cell * .8 * Math.max(0, p.hp / p.maxHp), 4);
    });
  }
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms / speed); }); }
  api.mount = function (s) {
    stageEl = s; cv = document.createElement('canvas'); ctx = cv.getContext('2d'); s.appendChild(cv);
    function size() { cv.width = s.clientWidth; cv.height = s.clientHeight; }
    size(); window.addEventListener('resize', size);
    cv.addEventListener('click', function (e) {
      var r = cv.getBoundingClientRect(), g = geom();
      var x = Math.floor((e.clientX - r.left - g.ox) / g.cell), y = Math.floor((e.clientY - r.top - g.oy) / g.cell);
      var tile = x >= 0 && y >= 0 && x < 12 && y < 12 ? { x: x, y: y } : null;
      if (api.onTap) api.onTap({ tile: tile, entity: null });
    });
  };
  api.init = function (g) { game = g; cancelAnimationFrame(raf); loop(); return Promise.resolve(); };
  api.stop = function () { cancelAnimationFrame(raf); };
  api.setInsets = function (i) { insets = i; api._insets = i; };
  api.setSpeed = function (s) { speed = s; };
  api.setReducedMotion = function () {};
  api.setHumanId = function () {};
  api.highlight = function (h) { hl = { targets: h.targets || [], area: h.area || [], color: h.color }; };
  api.clearHighlight = function () { hl = { targets: [], area: [] }; };
  api.tileCenter = function (x, y) { var g = geom(), r = cv.getBoundingClientRect(); return { x: r.left + g.ox + (x + .5) * g.cell, y: r.top + g.oy + (y + .5) * g.cell }; };
  api.wait = wait;
  ['refresh', 'roundStart', 'turnStart', 'tilesChanged', 'collide', 'heal', 'shield', 'status', 'death', 'spawn', 'remove', 'ringWarning', 'ringClose', 'fx'].forEach(function (k) { api[k] = function () { return Promise.resolve(); }; });
  ['move', 'attack', 'hit'].forEach(function (k) { api[k] = function () { return wait(150); }; });
  api.pedestal = function (canvas) {
    var c2 = canvas.getContext('2d'), cls = 'vanguard', t = 0, alive = true;
    function fr() {
      if (!alive) return;
      canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
      var w = canvas.width, h = canvas.height, col = DATA.CLASSES[cls].color;
      c2.clearRect(0, 0, w, h);
      var gr = c2.createRadialGradient(w / 2, h * .72, 5, w / 2, h * .72, w * .4); gr.addColorStop(0, col); gr.addColorStop(1, 'transparent');
      c2.fillStyle = gr; c2.fillRect(0, 0, w, h);
      c2.fillStyle = '#2a2050'; c2.beginPath(); c2.ellipse(w / 2, h * .74, w * .2, h * .05, 0, 0, 7); c2.fill();
      c2.fillStyle = col; c2.beginPath(); c2.ellipse(w / 2, h * .48 + Math.sin(t / 30) * 4, w * .07 * Math.abs(Math.cos(t / 60)) + 8, h * .2, 0, 0, 7); c2.fill();
      t++; requestAnimationFrame(fr);
    }
    fr();
    return { set: function (c) { cls = c; }, resize: function () {}, dispose: function () { alive = false; } };
  };
  var cache = {};
  api.portrait = function (cls, v, ci) {
    var k = cls + v + ci; if (cache[k]) return cache[k];
    var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    var gr = x.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#2a1f5c'); gr.addColorStop(1, '#0e0a26'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    x.fillStyle = DATA.CLASSES[cls].color; x.beginPath(); x.arc(32, 26, 12, 0, 7); x.fill(); x.beginPath(); x.ellipse(32, 62, 22, 18, 0, 0, 7); x.fill();
    return (cache[k] = c.toDataURL());
  };
  return api;
})();
