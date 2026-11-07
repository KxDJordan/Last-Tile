// CORE: the Game class with all rules. DOM-free; every visual consequence goes through the injected view.
var CORE = (function () {
  'use strict';
  var f = Math.floor;
  var MOVE_CAP = 99, PHANTOM_TILES = 3, STRIKER_BONUS = 2, SURGE_STEP = 3, SUDDEN_DEATH_DELAY = 3;
  var SIZE = 12, HAND_MAX = 7, DRAW_TO = 5, RING_FIRST = 4, RING_EVERY = 3, RINGS_TOTAL = 5;
  var VIEW_STATUSES = { root: 1, sap: 1, curse: 1, renew: 1, veil: 1, tether: 1, undying: 1, finalform: 1, bastion: 1, perch: 1, vanish: 1, rotembrace: 1, aim: 1 };
  var P = DATA.patterns;

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function xy(x, y) { return { x: x, y: y }; }
  function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function ringOf(x, y) { return Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y); }
  function resolved() { return Promise.resolve(); }

  var VIEW_METHODS = ['init', 'refresh', 'wait', 'roundStart', 'turnStart', 'tilesChanged', 'move', 'collide', 'attack', 'hit', 'heal',
    'shield', 'status', 'death', 'spawn', 'remove', 'ringWarning', 'ringClose', 'fx', 'banner', 'log', 'gameOver'];
  function stubView() { var v = {}; VIEW_METHODS.forEach(function (m) { v[m] = resolved; }); return v; }

  // ================================================================== Game
  function Game(opts) {
    opts = opts || {};
    this.size = SIZE;
    this.seed = (opts.seed === undefined ? 12345 : opts.seed) >>> 0;
    this.rng = mulberry32(this.seed);
    var sv = stubView(), v = opts.view || {};
    VIEW_METHODS.forEach(function (m) { if (typeof v[m] !== 'function') v[m] = sv[m]; });
    this.view = v;
    this.controllers = opts.controllers || [];
    this.humanIndex = opts.humanIndex === undefined ? -1 : opts.humanIndex;
    this.humanId = this.humanIndex >= 0 ? this.humanIndex : -1;
    this.maxRounds = opts.maxRounds || 60;
    this.round = 0; this.ringsClosed = 0; this.surges = 0; this.nextRingRound = RING_FIRST; this.nextRingIn = RING_FIRST;
    this.turnOrder = []; this.active = null; this.over = false; this.winner = null; this.endedByCap = false;
    this.log = []; this.errors = []; this.decoys = []; this.entities = [];
    this._uid = 1; this._decoyN = 1; this._mod = null; this.turnCount = 0;
    this._genBoard();
    this._makePlayers(opts.loadouts || []);
    this._rebuildEntities();
  }
  var G = Game.prototype;

  G.rand = function () { return this.rng(); };
  G.randInt = function (n) { return f(this.rng() * n); };
  G.shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = f(this.rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  G.tile = function (x, y) { if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null; return this.tiles[y][x]; };

  // ------------------------------------------------------------------ board generation
  G._genBoard = function () {
    var rng = this.rng, self = this, x, y;
    var tiles = [];
    for (y = 0; y < SIZE; y++) { tiles.push([]); for (x = 0; x < SIZE; x++) tiles[y].push({ x: x, y: y, h: 0, ring: ringOf(x, y), corrupted: false, warning: false, pillar: false, cache: null, trap: null, marked: false, perchLock: null }); }
    this.tiles = tiles;
    // smoothed value noise -> percentile quantised heights
    var C = 5, coarse = [];
    for (y = 0; y < C; y++) { coarse.push([]); for (x = 0; x < C; x++) coarse[y].push(rng()); }
    var vals = [];
    for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) {
      var gx = x / (SIZE - 1) * (C - 1), gy = y / (SIZE - 1) * (C - 1);
      var x0 = Math.min(C - 2, f(gx)), y0 = Math.min(C - 2, f(gy)), fx = gx - x0, fy = gy - y0;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var v = coarse[y0][x0] * (1 - fx) * (1 - fy) + coarse[y0][x0 + 1] * fx * (1 - fy) + coarse[y0 + 1][x0] * (1 - fx) * fy + coarse[y0 + 1][x0 + 1] * fx * fy;
      tiles[y][x].n = v + rng() * 0.15;
    }
    for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) {
      var s = tiles[y][x].n * 2, c = 2;
      P.adjacent(this, xy(x, y)).forEach(function (t) { s += tiles[t.y][t.x].n; c++; });
      tiles[y][x].m = s / c; vals.push(tiles[y][x].m);
    }
    vals.sort(function (a, b) { return a - b; });
    var t0 = vals[f(vals.length * 0.42)], t1 = vals[f(vals.length * 0.78)];
    for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) { var tt = tiles[y][x]; tt.h = tt.m < t0 ? 0 : tt.m < t1 ? 1 : 2; delete tt.n; delete tt.m; }
    for (y = 5; y <= 6; y++) for (x = 5; x <= 6; x++) tiles[y][x].h = Math.min(tiles[y][x].h, 1);

    // spawns: evenly spread around ring 1
    var per = [];
    for (x = 1; x <= 10; x++) per.push(xy(x, 1));
    for (y = 2; y <= 10; y++) per.push(xy(10, y));
    for (x = 9; x >= 1; x--) per.push(xy(x, 10));
    for (y = 9; y >= 2; y--) per.push(xy(1, y));
    var off = f(rng() * 4.5);
    this.spawns = [];
    for (var i = 0; i < 8; i++) this.spawns.push(per[(off + Math.round(i * per.length / 8)) % per.length]);
    var isSpawnNear = function (t, r) { return self.spawns.some(function (s) { return P.cheb(s, t) <= r; }); };

    // pillars with connectivity check
    var placed = 0, tries = 0;
    while (placed < 8 && tries < 400) {
      tries++;
      x = f(rng() * SIZE); y = f(rng() * SIZE);
      var t = tiles[y][x];
      if (t.pillar || t.ring > 4 || DATA.isCenter(t) || isSpawnNear(t, 1)) continue;
      var nearP = false;
      P.square(this, t, 1).forEach(function (q) { if (tiles[q.y][q.x].pillar) nearP = true; });
      if (nearP) continue;
      t.pillar = true;
      if (!this._connected()) { t.pillar = false; continue; }
      placed++;
    }
    // make every open tile reachable with |dh|<=1 steps from the centre
    for (var guard = 0; guard < 50; guard++) {
      var reach = this._reachMap();
      var changed = false;
      for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) {
        var q = tiles[y][x];
        if (q.pillar || reach[y][x]) continue;
        var nb = P.adjacent(this, q).filter(function (n) { return reach[n.y][n.x]; })[0];
        if (nb) { var nh = tiles[nb.y][nb.x].h; q.h = nh + (q.h > nh ? 1 : -1); changed = true; }
      }
      if (!changed) break;
    }
    // caches on rings 0-3
    var cands = [];
    for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) { var c2 = tiles[y][x]; if (!c2.pillar && c2.ring <= 3 && !isSpawnNear(c2, 0)) cands.push(c2); }
    this.shuffle(cands);
    var caches = [];
    for (i = 0; i < cands.length && caches.length < 10; i++) {
      if (caches.some(function (c) { return P.cheb(c, cands[i]) < 2; })) continue;
      cands[i].cache = { id: caches.length }; caches.push(cands[i]);
    }
  };
  G._connected = function () {
    var start = null, total = 0, x, y;
    for (y = 0; y < SIZE; y++) for (x = 0; x < SIZE; x++) if (!this.tiles[y][x].pillar) { total++; if (!start) start = this.tiles[y][x]; }
    var seen = {}, q = [start], n = 0; seen[start.x + ',' + start.y] = 1;
    while (q.length) { var c = q.pop(); n++; var self = this; P.adjacent(this, c).forEach(function (t) { var k = t.x + ',' + t.y; if (!seen[k]) { seen[k] = 1; q.push(t); } }); }
    return n === total;
  };
  G._reachMap = function () {
    var r = [], x, y, tiles = this.tiles;
    for (y = 0; y < SIZE; y++) { r.push([]); for (x = 0; x < SIZE; x++) r[y].push(false); }
    var q = [tiles[5][5]]; r[5][5] = true;
    while (q.length) {
      var c = q.pop();
      P.adjacent(this, c).forEach(function (t) { if (!r[t.y][t.x] && Math.abs(tiles[t.y][t.x].h - c.h) <= 1) { r[t.y][t.x] = true; q.push(tiles[t.y][t.x]); } });
    }
    return r;
  };

  // ------------------------------------------------------------------ players
  G._makePlayers = function (loadouts) {
    var self = this;
    var names = this.shuffle(DATA.BOT_NAMES.slice());
    var used = {};
    if (this.humanIndex >= 0 && loadouts[this.humanIndex]) used[(loadouts[this.humanIndex].name || 'You')] = 1;
    var spawnOrder = this.shuffle(this.spawns.slice());
    var colorNext = 1;
    this.players = loadouts.map(function (l, i) {
      var cls = DATA.CLASSES[l.cls];
      var isHuman = i === self.humanIndex;
      var name = l.name;
      if (isHuman) name = name || 'You';
      else {
        if (!name || used[name]) { name = names.filter(function (n) { return !used[n]; })[0] || ('Bot ' + (i + 1)); }
        used[name] = 1;
      }
      var colorIndex = self.humanIndex < 0 ? i : (isHuman ? 0 : colorNext++);
      var sp = spawnOrder[i % spawnOrder.length];
      var p = {
        id: i, index: i, name: name, cls: l.cls, variant: l.variant || cls.variants[0].id, colorIndex: colorIndex, color: DATA.TEAM_COLORS[colorIndex % 8],
        isHuman: isHuman, x: sp.x, y: sp.y, hp: 0, maxHp: 0, shield: 0, energy: 0, maxEnergy: 3,
        hand: [], deck: [], discard: [], meter: 0, gb: l.gb || cls.gamebreakers[0], gbUsedThisTurn: false, alive: true, place: null,
        statuses: [], invisible: false, stance: null, moveMax: 0, moveLeft: 0, movedThisTurn: false, movedLastTurn: false, tilesMovedThisTurn: 0, tilesMovedLastTurn: 0,
        stats: { dmgDealt: 0, kills: 0, caches: 0, gbUsed: 0 },
        points: { hp: (l.points || {}).hp || 0, atk: (l.points || {}).atk || 0, def: (l.points || {}).def || 0, spd: (l.points || {}).spd || 0 },
        shards: { hp: 0, atk: 0, def: 0, spd: 0 }, turnFlags: {}, turnDone: false, phantomHitRound: -1, loadout: l
      };
      var s = DATA.statsFromPoints(p.points, p.shards);
      p.maxHp = s.maxHp; p.hp = s.maxHp;
      p.deck = self.shuffle((l.deck || DATA.starterDeck(l.cls)).map(function (id) { return { uid: self._uid++, id: id, temp: false }; }));
      return p;
    });
  };
  G._rebuildEntities = function () { this.entities = this.players.filter(function (p) { return p.alive; }).concat(this.decoys.filter(function (d) { return d.alive; })); };

  // ------------------------------------------------------------------ queries
  G.stats = function (p) {
    if (p && p.isDecoy) p = this.players[p.ownerId];
    var s = DATA.statsFromPoints(p.points, p.shards);
    for (var i = 0; i < p.statuses.length; i++) {
      var st = p.statuses[i];
      if (st.type === 'sap') s.atk = Math.max(0, s.atk - (st.amount || 2));
      if (st.type === 'finalform') s.atk += st.amount || 0;
    }
    return s;
  };
  G.ownerId = function (e) { return e.isDecoy ? e.ownerId : e.id; };
  G.ownerOf = function (e) { return e.isDecoy ? this.players[e.ownerId] : e; };
  G.hpOf = function (e) { return this.ownerOf(e).hp + this.ownerOf(e).shield; };
  G.isEnemy = function (u, e) { return this.ownerId(e) !== this.ownerId(u); };
  G.canAffect = function (u, e) { if (!e || !e.alive) return false; if (e.invisible && this.ownerId(e) !== this.ownerId(u)) return false; return true; };
  G.pieceAt = function (x, y) { for (var i = 0; i < this.entities.length; i++) { var e = this.entities[i]; if (e.alive && e.x === x && e.y === y) return e; } return null; };
  G.isEmpty = function (x, y) { var t = this.tile(x, y); return !!t && !t.pillar && t.perchLock === null && !this.pieceAt(x, y); };
  G.hasStatus = function (p, type) { if (!p || !p.statuses) return null; for (var i = 0; i < p.statuses.length; i++) if (p.statuses[i].type === type) return p.statuses[i]; return null; };
  G.alivePlayers = function () { return this.players.filter(function (p) { return p.alive; }); };
  // During sudden death (after the first surge) the Rot Storm ignores Hexer's passive, Riftwalker and Rot Embrace.
  // Walking budget per turn: effective SPD, capped.
  G.moveAllowance = function (p) { return Math.max(0, Math.min(MOVE_CAP, this.stats(p).spd)); };
  G.corruptionDamage = function (p) { var d = 3 + 2 * this.ringsClosed + SURGE_STEP * this.surges; if (p && p.cls === 'hexer' && !this.surges) d = f(d / 2); return d; };
  G.rangeBonus = function (u, t) {
    if (!u || u.isDecoy) return 0;
    var b = 0;
    if (u.cls === 'marksman' && t) { var a = this.tile(u.x, u.y), c = this.tile(t.x, t.y); if (a && c) b += Math.max(0, a.h - c.h); }
    if (this.hasStatus(u, 'perch')) b += 2;
    return b;
  };
  G.los = function (a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, steps = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
    for (var i = 1; i < steps; i++) {
      var t = i / steps, px = Math.round(a.x + dx * t), py = Math.round(a.y + dy * t);
      if ((px === a.x && py === a.y) || (px === b.x && py === b.y)) continue;
      var tt = this.tile(px, py);
      if (tt && tt.pillar) return false;
    }
    return true;
  };
  // Walk step cost from (x,y) to (nx,ny); Infinity if impossible.
  G.stepCost = function (x, y, nx, ny, climbFree) {
    var a = this.tile(x, y), b = this.tile(nx, ny);
    if (!b || b.pillar || b.perchLock !== null || this.pieceAt(nx, ny)) return Infinity;
    var dh = b.h - a.h;
    if (dh >= 2) return Infinity;
    return dh === 1 && !climbFree ? 2 : 1;
  };
  G.canStepDash = function (x, y, nx, ny) { return this.stepCost(x, y, nx, ny, true) < Infinity; };
  // Reachable tiles (excluding the start) within budget: [{x,y,cost,path}]
  G.reachable = function (u, budget, opts) {
    var climbFree = opts && opts.climbFree;
    var best = {}, out = [], start = xy(u.x, u.y);
    best[u.x + ',' + u.y] = { x: u.x, y: u.y, cost: 0, path: [start] };
    var frontier = [best[u.x + ',' + u.y]];
    while (frontier.length) {
      frontier.sort(function (a, b) { return a.cost - b.cost; });
      var c = frontier.shift();
      for (var i = 0; i < 4; i++) {
        var d = DATA.DIRS4[i], nx = c.x + d.dx, ny = c.y + d.dy;
        var sc = this.stepCost(c.x, c.y, nx, ny, climbFree);
        if (sc === Infinity) continue;
        var nc = c.cost + sc;
        if (nc > budget) continue;
        var k = nx + ',' + ny;
        if (best[k] && best[k].cost <= nc) continue;
        best[k] = { x: nx, y: ny, cost: nc, path: c.path.concat([xy(nx, ny)]) };
        frontier.push(best[k]);
      }
    }
    for (var key in best) if (best[key].cost > 0) out.push(best[key]);
    return out;
  };
  G.dashTargets = function (u, len) {
    var out = [];
    for (var i = 0; i < 4; i++) {
      var d = DATA.DIRS4[i], x = u.x, y = u.y;
      for (var k = 0; k < len; k++) {
        var nx = x + d.dx, ny = y + d.dy;
        if (!this.canStepDash(x, y, nx, ny)) break;
        x = nx; y = ny; out.push(xy(x, y));
      }
    }
    return out;
  };

  // ------------------------------------------------------------------ logging / view helpers
  G.say = function (text) { this.log.push(text); if (this.log.length > 300) this.log.shift(); return this.view.log(text); };
  G.refresh = function () { return this.view.refresh(this); };
  G.classColor = function (u) { return DATA.CLASSES[this.ownerOf(u).cls].color; };

  // ------------------------------------------------------------------ movement primitives
  G._setPos = function (e, x, y) {
    if (e.x === x && e.y === y) return;
    var d = Math.abs(e.x - x) + Math.abs(e.y - y);
    e.x = x; e.y = y;
    if (!e.isDecoy && e === this.active) { e.movedThisTurn = true; e.tilesMovedThisTurn = (e.tilesMovedThisTurn || 0) + d; }
  };
  G.moveAlong = function (e, path, mode) {
    var self = this;
    if (!path || path.length < 2 || !e.alive) return resolved();
    var last = path[path.length - 1];
    this._setPos(e, last.x, last.y);
    return Promise.resolve(this.view.move(e, path, mode)).then(function () { return self._land(e); });
  };
  G.walkTo = function (u, dest, budget, opts) {
    var r = this.reachable(u, budget, opts).filter(function (n) { return n.x === dest.x && n.y === dest.y; })[0];
    if (!r) return resolved();
    return this.moveAlong(u, r.path, 'walk');
  };
  G.dashTo = function (u, dest) {
    var d = P.dirOf(u, dest), path = [xy(u.x, u.y)], x = u.x, y = u.y;
    for (var i = 0; i < 12 && !(x === dest.x && y === dest.y); i++) {
      var nx = x + d.dx, ny = y + d.dy;
      if (!this.canStepDash(x, y, nx, ny)) break;
      x = nx; y = ny; path.push(xy(x, y));
    }
    return this.moveAlong(u, path, 'dash');
  };
  G.teleport = function (u, t) {
    if (!this.isEmpty(t.x, t.y)) return resolved();
    return this.moveAlong(u, [xy(u.x, u.y), xy(t.x, t.y)], 'teleport');
  };
  G.isImmovable = function (e) { return !e.isDecoy && !!this.hasStatus(e, 'bastion'); };
  // Push/pull: tile by tile; blocked -> stop and take 2 pierce collision damage.
  G._displace = function (e, dirFn, n, attacker, mode, stopAt) {
    var self = this;
    if (!e || !e.alive || n <= 0) return resolved();
    if (this.isImmovable(e)) return resolved();
    if (attacker && !this.canAffect(attacker, e)) return resolved();
    var path = [xy(e.x, e.y)], x = e.x, y = e.y, collided = null;
    for (var i = 0; i < n; i++) {
      var d = dirFn(x, y);
      if (!d || (d.dx === 0 && d.dy === 0)) break;
      var nx = x + d.dx, ny = y + d.dy;
      if (stopAt && nx === stopAt.x && ny === stopAt.y) break;
      var a = this.tile(x, y), b = this.tile(nx, ny);
      var occ = b ? this.pieceAt(nx, ny) : null;
      if (!b || b.pillar || b.perchLock !== null || (occ && occ !== e) || b.h - a.h >= 2) { collided = d; break; }
      x = nx; y = ny; path.push(xy(x, y));
    }
    var chain = resolved();
    if (path.length > 1) {
      var last = path[path.length - 1];
      this._setPos(e, last.x, last.y);
      chain = Promise.resolve(this.view.move(e, path, mode));
    }
    return chain.then(function () {
      if (collided && e.alive) {
        return Promise.resolve(self.view.collide(e, collided)).then(function () {
          return self.damage(e, 2, { pierce: true, source: 'collision', attacker: attacker });
        });
      }
    }).then(function () { if (path.length > 1 && e.alive) return self._land(e); });
  };
  G.push = function (e, dir, n, attacker) { return this._displace(e, function () { return dir; }, n, attacker, 'push', null); };
  G.pull = function (e, toward, n, attacker) {
    var to = xy(toward.x, toward.y);
    return this._displace(e, function (x, y) { return P.dirOf(xy(x, y), to); }, n, attacker, 'pull', to);
  };
  G.swap = function (a, b) {
    var self = this;
    if (!a.alive || !b.alive || a === b || this.isImmovable(a) || this.isImmovable(b)) return resolved();
    if (this.tile(a.x, a.y).perchLock !== null || this.tile(b.x, b.y).perchLock !== null) return resolved();
    var pa = xy(a.x, a.y), pb = xy(b.x, b.y);
    // put both in place before animating so state is never overlapping
    a.x = pb.x; a.y = pb.y; b.x = pa.x; b.y = pa.y;
    var sd = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
    if (a === this.active) { a.movedThisTurn = true; a.tilesMovedThisTurn = (a.tilesMovedThisTurn || 0) + sd; }
    if (b === this.active) { b.movedThisTurn = true; b.tilesMovedThisTurn = (b.tilesMovedThisTurn || 0) + sd; }
    return Promise.all([this.view.move(a, [pa, pb], 'teleport'), this.view.move(b, [pb, pa], 'teleport')])
      .then(function () { return self._land(a); }).then(function () { return self._land(b); });
  };
  // A piece lands on a tile: traps then caches.
  G._land = function (e) {
    var self = this;
    if (!e.alive || e.isDecoy) return resolved();
    var t = this.tile(e.x, e.y);
    var chain = resolved();
    if (t.trap && t.trap.ownerId !== e.id) {
      var trap = t.trap; t.trap = null;
      var owner = this.players[trap.ownerId];
      chain = chain.then(function () { return self.view.fx('trap-trigger', { tile: xy(t.x, t.y), entity: e }); })
        .then(function () { return self.view.tilesChanged([t]); })
        .then(function () { return self.say(e.name + ' triggered a trap'); })
        .then(function () { return self.damage(e, trap.dmg, { source: 'trap', attacker: owner && owner.alive ? owner : null }); })
        .then(function () { if (trap.root && e.alive) return self.addStatus(e, 'root', 2); });
    }
    return chain.then(function () { if (e.alive && t.cache) return self._openCache(e, t); });
  };
  G._openCache = function (p, t) {
    var self = this;
    t.cache = null;
    var pool = DATA.cardPool(p.cls);
    var pick = function () { return pool[self.randInt(pool.length)]; };
    var options = [{ type: 'cards', cards: [pick(), pick()] }, { type: 'cards', cards: [pick(), pick()] }, { type: 'shard' }];
    var ctrl = this.controllers[p.id];
    return Promise.resolve(this.view.fx('cache-open', { entity: p, tile: xy(t.x, t.y) }))
      .then(function () { return self.view.tilesChanged([t]); })
      .then(function () {
        if (!ctrl || !ctrl.chooseCache) return { index: 2, stat: 'hp' };
        return Promise.resolve().then(function () { return ctrl.chooseCache(self, p, options); }).catch(function (err) { self._err(err); return { index: 2, stat: 'hp' }; });
      })
      .then(function (choice) {
        choice = choice || { index: 2, stat: 'hp' };
        var opt = options[choice.index] || options[2];
        p.meter = Math.min(100, p.meter + 15);
        p.stats.caches++;
        if (opt.type === 'shard') {
          var stat = ['hp', 'atk', 'def', 'spd'].indexOf(choice.stat) >= 0 ? choice.stat : 'hp';
          p.shards[stat]++;
          p.maxHp = self.stats(p).maxHp;
          var msg = self.say(p.name + ' found a ' + DATA.STAT_INFO[stat].name + ' shard');
          if (stat === 'hp') return Promise.resolve(msg).then(function () { return self.heal(p, 5); });
          return msg;
        }
        opt.cards.forEach(function (id) {
          var c = { uid: self._uid++, id: id, temp: false, cache: true };
          if (p.hand.length < HAND_MAX) p.hand.push(c); else p.discard.push(c);
        });
        return self.say(p.name + ' found ' + opt.cards.map(function (id) { return DATA.CARDS[id].name; }).join(' and '));
      })
      .then(function () { return self.refresh(); });
  };

  // ------------------------------------------------------------------ combat primitives
  G.attackFx = function (u, spec, cardId) {
    spec = spec || {};
    var s = { style: spec.style || 'self', from: xy(u.x, u.y), target: spec.target ? xy(spec.target.x, spec.target.y) : xy(u.x, u.y), tiles: (spec.tiles || []).map(function (t) { return xy(t.x, t.y); }), color: this.classColor(u), cardId: cardId };
    return Promise.resolve(this.view.attack(u, s));
  };
  G.attackSelf = function (u, cardId) { return this.attackFx(u, { style: 'self', tiles: [u] }, cardId); };
  G.attackMelee = function (u, t, cardId) { return this.attackFx(u, { style: 'melee', target: t, tiles: [t] }, cardId); };

  // Hit every piece standing on `tiles`. amtFn(entity) -> raw amount. Returns [{entity, dealt}].
  G.strike = function (u, tiles, amtFn, opts) {
    var self = this;
    opts = opts || {};
    var card = DATA.CARDS[opts.cardId];
    var isDmgCard = !opts.gb && card && card.cat === 'damage';
    var mod = isDmgCard ? this._mod : null;
    var hits = [];
    var chain = this.attackFx(u, { style: opts.style || 'melee', target: opts.target || tiles[0] || u, tiles: tiles }, opts.cardId);
    tiles.forEach(function (t) {
      chain = chain.then(function () {
        var e = self.pieceAt(t.x, t.y);
        if (!e || self.ownerId(e) === self.ownerId(u) || !self.canAffect(u, e)) return;
        var n = opts.hits || 1, dealtTot = 0, real = !e.isDecoy;
        var one = function (k) {
          if (k >= n || !e.alive) return resolved();
          var raw = amtFn(e);
          if (mod) raw = (raw + mod.add) * mod.mult;
          return self.damage(e, raw, { pierce: !!opts.pierce, source: 'card', attacker: u, big: !!opts.gb })
            .then(function (d) { dealtTot += d; return one(k + 1); });
        };
        return one(0).then(function () { hits.push({ entity: e, dealt: dealtTot, real: real }); });
      });
    });
    return chain.then(function () {
      if (isDmgCard && hits.some(function (h) { return h.real; })) u.meter = Math.min(100, u.meter + 10);
      if (isDmgCard && u.turnFlags && u.turnFlags.blitz && hits.length && u.alive && u.hand.length < HAND_MAX) {
        u.hand.push({ uid: self._uid++, id: 'blitz_step', temp: true });
      }
      return hits;
    });
  };

  // Core damage resolution. Returns total damage dealt (HP lost + shield absorbed).
  G.damage = function (e, amount, info) {
    var self = this;
    info = info || {};
    var source = info.source || 'card', attacker = info.attacker || null;
    if (!e || !e.alive) return Promise.resolve(0);
    if (e.isDecoy) return this.removeDecoy(e, true).then(function () { return 0; });
    var p = e;
    if (source !== 'corruption' && attacker && attacker !== p && p.invisible && this.ownerId(attacker) !== p.id) return Promise.resolve(0);
    var amt = Math.max(0, f(amount));
    var corr = source === 'corruption';
    if (!info.pierce && !corr) amt = Math.max(1, amt - this.stats(p).def);
    if (!corr && source !== 'dot') {
      if (p.cls === 'phantom' && p.phantomHitRound !== this.round) {
        p.phantomHitRound = this.round;
        if (p.tilesMovedLastTurn >= PHANTOM_TILES) amt = Math.max(1, f(amt / 2));
      }
      var veil = this.hasStatus(p, 'veil');
      if (veil) { amt = Math.max(1, f(amt / 2)); this._removeStatus(p, veil); }
    }
    var absorbed = 0;
    if (!corr && p.shield > 0) { absorbed = Math.min(p.shield, amt); p.shield -= absorbed; amt -= absorbed; }
    var loss = amt, undying = null;
    if (p.hp - loss <= 0) { undying = this.hasStatus(p, 'undying'); if (undying) loss = p.hp - 1; }
    p.hp -= loss;
    var total = loss + absorbed;
    if (total > 0) p.meter = Math.min(100, p.meter + 5);
    var chain = Promise.resolve(this.view.hit(p, total, { pierce: !!info.pierce || corr, source: source, absorbed: absorbed, big: !!info.big || total >= 10 }));
    if (attacker && attacker !== p && !attacker.isDecoy) {
      attacker.stats.dmgDealt += total;
      if (attacker.cls === 'lifebinder' && total > 0 && attacker.alive) chain = chain.then(function () { return self.heal(attacker, 1); });
    }
    var srcName = attacker && attacker !== p ? attacker.name : null;
    chain = chain.then(function () {
      if (source === 'corruption') return self.say(p.name + ' took ' + total + ' corruption damage');
      if (source === 'collision') return self.say(p.name + ' crashed for ' + total);
      if (srcName) return self.say(srcName + ' hit ' + p.name + ' for ' + total);
      return self.say(p.name + ' took ' + total);
    });
    if (total > 0) {
      this.players.forEach(function (q) {
        if (q === p || !q.alive) return;
        var tt = self.hasStatus(q, 'tether');
        if (tt && tt.targetId === p.id) chain = chain.then(function () { return self.heal(q, f(total / 2)); });
      });
      if (this.hasStatus(p, 'bastion') && attacker && attacker !== p && attacker.alive && !attacker.isDecoy && (source === 'card' || source === 'trap')) {
        var back = f(total / 2);
        if (back > 0) chain = chain.then(function () { return self.damage(attacker, back, { pierce: true, source: 'reflect', attacker: p }); });
      }
    }
    if (undying && p.alive) {
      chain = chain.then(function () {
        self._removeStatus(p, undying);
        return Promise.resolve(self.view.banner(p.name + ' refuses to fall!', 'gb')).then(function () { return self.heal(p, f(p.maxHp * 0.3)); });
      });
    }
    return chain.then(function () {
      if (p.alive && p.hp <= 0) return self.kill(p, attacker);
    }).then(function () { return total; });
  };
  G.kill = function (p, killer) {
    var self = this;
    if (!p.alive) return resolved();
    p.alive = false; p.hp = 0; p.shield = 0;
    var aliveCount = this.alivePlayers().length;
    p.place = aliveCount + 1;
    if (killer && killer !== p && !killer.isDecoy) killer.stats.kills++;
    var chain = resolved();
    // clean up things the dead player owns
    this.decoys.filter(function (d) { return d.alive && d.ownerId === p.id; }).forEach(function (d) { chain = chain.then(function () { return self.removeDecoy(d, false); }); });
    var changed = [];
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) {
      var t = this.tiles[y][x];
      if (t.trap && t.trap.ownerId === p.id) { t.trap = null; changed.push(t); }
    }
    var sk = this.hasStatus(p, 'skyfall');
    if (sk) sk.tiles.forEach(function (q) { var t = self.tile(q.x, q.y); t.marked = false; changed.push(t); });
    var pr = this.hasStatus(p, 'perch');
    if (pr) changed.push(this._unperch(pr));
    p.statuses = []; p.invisible = false;
    this._rebuildEntities();
    return chain.then(function () { return self.view.death(p, p.place); })
      .then(function () { if (changed.length) return self.view.tilesChanged(changed); })
      .then(function () { return self.view.banner(p.name + ' eliminated' + (killer && killer !== p ? ' by ' + killer.name : ''), 'elim'); })
      .then(function () { return self.say(p.name + ' was eliminated' + (killer && killer !== p ? ' by ' + killer.name : '')); })
      .then(function () {
        var alive = self.alivePlayers();
        if (alive.length <= 1 && !self.over) { self.over = true; self.winner = alive[0] || p; if (alive[0]) alive[0].place = 1; }
      });
  };
  G.heal = function (p, amt) {
    if (!p || !p.alive || p.isDecoy) return Promise.resolve(0);
    amt = f(amt);
    if (this.surges > 0) amt = f(amt / 2);   // sudden death: the rot festers, healing is halved
    amt = Math.min(amt, p.maxHp - p.hp);
    if (amt <= 0) return Promise.resolve(0);
    p.hp += amt;
    var self = this;
    return Promise.resolve(this.view.heal(p, amt)).then(function () { return amt; });
  };
  G.addShield = function (p, amt) {
    amt = f(amt);
    if (!p.alive || amt <= 0) return resolved();
    p.shield += amt;
    var self = this;
    return Promise.resolve(this.view.shield(p, amt)).then(function () { return self.say(p.name + ' gained ' + amt + ' shield'); });
  };
  G.addStatus = function (p, type, turns, extra) {
    if (!p.alive) return resolved();
    var old = this.hasStatus(p, type);
    if (old) this._removeStatus(p, old, true);
    var st = { type: type, turns: turns };
    if (extra) for (var k in extra) st[k] = extra[k];
    p.statuses.push(st);
    if (type === 'vanish') p.invisible = true;
    if (type === 'root') p.moveLeft = 0;
    return VIEW_STATUSES[type] ? Promise.resolve(this.view.status(p, type)) : resolved();
  };
  G.debuff = function (u, e, type, turns, extra) {
    if (!e || !e.alive || !this.canAffect(u, e)) return resolved();
    if (e.isDecoy) return this.removeDecoy(e, true);
    extra = extra || {}; extra.from = u.id;
    var self = this;
    return this.addStatus(e, type, turns, extra).then(function () { return self.say(u.name + ' cursed ' + e.name + (type === 'sap' ? ' (−2 ATK)' : '')); });
  };
  G._removeStatus = function (p, st, replacing) {
    var i = p.statuses.indexOf(st);
    if (i >= 0) p.statuses.splice(i, 1);
    if (st.type === 'vanish') p.invisible = false;
    if (st.type === 'perch' && !replacing) { var t = this._unperch(st); this.view.tilesChanged([t]); }
    if (st.type === 'skyfall' && !replacing) { var self = this; st.tiles.forEach(function (q) { self.tile(q.x, q.y).marked = false; }); }
  };
  G._unperch = function (st) {
    var t = this.tile(st.x, st.y);
    if (t.h === 3) t.h = st.origH;
    t.perchLock = null;
    return t;
  };
  G.draw = function (p, n) {
    var drawn = 0;
    for (var i = 0; i < n; i++) {
      if (p.hand.length >= HAND_MAX) break;
      if (!p.deck.length) {
        if (!p.discard.length) break;
        p.deck = this.shuffle(p.discard); p.discard = [];
      }
      p.hand.push(p.deck.pop()); drawn++;
    }
    if (!drawn) return resolved();
    return Promise.resolve(this.view.fx('draw', { player: p, n: drawn }));
  };
  G.placeTrap = function (u, t, kind, dmg, root) {
    var tt = this.tile(t.x, t.y);
    if (!tt || tt.pillar || (tt.trap && tt.trap.ownerId === u.id)) return resolved();
    tt.trap = { ownerId: u.id, kind: kind, dmg: dmg, root: !!root };
    var self = this;
    return this.attackFx(u, { style: 'projectile', target: t, tiles: [t] }, kind)
      .then(function () { return self.view.fx('trap-placed', { tile: xy(t.x, t.y), ownerId: u.id }); })
      .then(function () { return self.view.tilesChanged([tt]); });
  };
  G.corruptTiles = function (list) {
    var self = this, changed = [];
    list.forEach(function (q) { var t = self.tile(q.x, q.y); if (t && !t.pillar && !DATA.isCenter(t) && !t.corrupted) { t.corrupted = true; changed.push(t); } });
    if (!changed.length) return resolved();
    return Promise.resolve(this.view.fx('corrupt', { tiles: changed.map(function (t) { return xy(t.x, t.y); }) })).then(function () { return self.view.tilesChanged(changed); });
  };
  G.cleanseTiles = function (list) {
    var self = this, changed = [];
    if (this.surges > 0) return resolved();
    list.forEach(function (q) { var t = self.tile(q.x, q.y); if (t && t.corrupted) { t.corrupted = false; changed.push(t); } });
    if (!changed.length) return resolved();
    return Promise.resolve(this.view.fx('cleanse', { tiles: changed.map(function (t) { return xy(t.x, t.y); }) })).then(function () { return self.view.tilesChanged(changed); });
  };
  G.raiseTiles = function (list, by, max) {
    var self = this, changed = [];
    list.forEach(function (q) { var t = self.tile(q.x, q.y); if (t && !t.pillar && t.perchLock === null && t.h < max) { t.h = Math.min(max, t.h + by); changed.push(t); } });
    if (!changed.length) return resolved();
    return Promise.resolve(this.view.fx('tile-raise', { tiles: changed.map(function (t) { return xy(t.x, t.y); }) })).then(function () { return self.view.tilesChanged(changed); });
  };
  G.spawnDecoy = function (owner, t) {
    if (!this.isEmpty(t.x, t.y)) return resolved();
    var self = this;
    var d = { id: 'd' + (this._decoyN++), isDecoy: true, ownerId: owner.id, x: t.x, y: t.y, alive: true, name: owner.name, cls: owner.cls, variant: owner.variant, colorIndex: owner.colorIndex, color: owner.color, statuses: [], invisible: false };
    ['hp', 'maxHp', 'shield', 'meter'].forEach(function (k) { Object.defineProperty(d, k, { enumerable: true, get: function () { return self.players[d.ownerId][k]; } }); });
    this.decoys.push(d);
    this._rebuildEntities();
    return Promise.resolve(this.view.spawn(d));
  };
  G.removeDecoy = function (d, hit) {
    if (!d.alive) return resolved();
    d.alive = false;
    this.decoys = this.decoys.filter(function (q) { return q !== d; });
    this._rebuildEntities();
    var self = this;
    var chain = hit ? Promise.resolve(this.view.fx('decoy-hit', { entity: d })) : resolved();
    return chain.then(function () { return self.view.remove(d); }).then(function () { if (hit) return self.say('A decoy of ' + d.name + ' shattered'); });
  };
  G.markSkyfall = function (u, tiles) {
    var self = this;
    var list = tiles.map(function (q) { return xy(q.x, q.y); });
    list.forEach(function (q) { self.tile(q.x, q.y).marked = true; });
    return this.addStatus(u, 'skyfall', 1, { tiles: list })
      .then(function () { return self.view.fx('mark', { tiles: list }); })
      .then(function () { return self.view.tilesChanged(list.map(function (q) { return self.tile(q.x, q.y); })); });
  };
  G.perch = function (u) {
    var t = this.tile(u.x, u.y);
    var st = { x: t.x, y: t.y, origH: t.h };
    t.h = 3; t.perchLock = u.id;
    var self = this;
    return this.addStatus(u, 'perch', 2, st)
      .then(function () { return self.view.fx('tile-raise', { tiles: [xy(t.x, t.y)] }); })
      .then(function () { return self.view.tilesChanged([t]); });
  };
  G.siphonPulse = function (u) {
    var self = this, s = this.stats(u), total = 0;
    var targets = this.entities.filter(function (e) { return e.alive && self.isEnemy(u, e) && self.canAffect(u, e) && dist(u, e) <= 2; });
    var chain = this.attackFx(u, { style: 'area', tiles: P.within(this, u, 2) }, 'siphon_field');
    targets.forEach(function (e) { chain = chain.then(function () { if (e.alive) return self.damage(e, 2 + f(s.hpPts / 2), { pierce: true, source: 'card', attacker: u }).then(function (d) { total += d; }); }); });
    return chain.then(function () { if (total > 0 && u.alive) return self.heal(u, total); });
  };
  G.collapseRing = function () {
    if (this.ringsClosed >= RINGS_TOTAL) return resolved();
    var self = this;
    return this._closeRing().then(function () {
      self.nextRingRound = self.round + RING_EVERY;
      self.nextRingIn = self.ringsClosed < RINGS_TOTAL ? self.nextRingRound - self.round : null;
      self.players.forEach(function (p) { p.maxEnergy = Math.min(6, 3 + self.ringsClosed); });
    });
  };

  // ------------------------------------------------------------------ rings
  G.ringTiles = function (k) {
    var out = [], x, y, a = k, b = SIZE - 1 - k;
    for (x = a; x <= b; x++) out.push(this.tiles[a][x]);
    for (y = a + 1; y <= b; y++) out.push(this.tiles[y][b]);
    for (x = b - 1; x >= a; x--) out.push(this.tiles[b][x]);
    for (y = b - 1; y > a; y--) out.push(this.tiles[y][a]);
    return out;
  };
  G._closeRing = function () {
    var self = this, k = this.ringsClosed, changed = [];
    var ring = this.ringTiles(k);
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) {
      var t = this.tiles[y][x];
      if (t.ring > k) continue;
      var ch = false;
      if (!t.corrupted && !t.pillar) { t.corrupted = true; ch = true; }
      if (t.warning) { t.warning = false; ch = true; }
      if (t.cache) { t.cache = null; ch = true; }
      if (ch) changed.push(t);
    }
    this.ringsClosed++;
    this.players.forEach(function (p) { if (p.alive) p.meter = Math.min(100, p.meter + 20); p.maxEnergy = Math.min(6, 3 + self.ringsClosed); });
    return Promise.resolve(this.view.ringClose(k, ring.filter(function (t) { return !t.pillar; }).map(function (t) { return xy(t.x, t.y); })))
      .then(function () { return self.view.tilesChanged(changed); })
      .then(function () { return self.view.banner('Ring ' + (k + 1) + ' has fallen', 'ring'); })
      .then(function () { return self.say('Ring ' + (k + 1) + ' closed'); })
      .then(function () { return self.refresh(); });
  };
  // Sudden death: 3 rounds after the last ring, the rot surges and swallows every tile, the centre
  // included; after that it surges again every round (+2 corruption damage each time). This guarantees an ending.
  G._surge = function () {
    var self = this, changed = [];
    this.surges++;
    for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) {
      var t = this.tiles[y][x];
      if (!t.pillar && (!t.corrupted || t.warning)) { t.corrupted = true; t.warning = false; t.cache = null; changed.push(t); }
    }
    return Promise.resolve(changed.length ? this.view.ringClose(RINGS_TOTAL, changed.map(function (t) { return xy(t.x, t.y); })) : null)
      .then(function () { if (changed.length) return self.view.tilesChanged(changed); })
      .then(function () { return self.view.banner('The rot surges', 'ring'); })
      .then(function () { return self.say('The rot surges: corruption now deals ' + self.corruptionDamage(null)); });
  };
  G._allTiles = function () { var r = []; for (var y = 0; y < SIZE; y++) for (var x = 0; x < SIZE; x++) r.push(this.tiles[y][x]); return r; };
  G._roundRings = function () {
    var self = this, chain = resolved();
    if (this.ringsClosed < RINGS_TOTAL && this.round >= this.nextRingRound) {
      chain = chain.then(function () { return self._closeRing(); }).then(function () { self.nextRingRound = self.round + (self.ringsClosed >= RINGS_TOTAL ? SUDDEN_DEATH_DELAY : RING_EVERY); });
    } else if (this.ringsClosed >= RINGS_TOTAL && this.round >= this.nextRingRound) {
      chain = chain.then(function () { return self._surge(); }).then(function () { self.nextRingRound = self.round + 1; });
    }
    return chain.then(function () {
      if (self.round === self.nextRingRound - 1) {
        var k = Math.min(self.ringsClosed, RINGS_TOTAL), tiles = self.ringTiles(k).filter(function (t) { return !t.pillar && !t.corrupted; });
        if (k === RINGS_TOTAL) tiles = self.ringTiles(k).filter(function (t) { return !t.pillar; }).concat(self._allTiles().filter(function (t) { return !t.pillar && !t.corrupted && t.ring < RINGS_TOTAL; }));
        if (!tiles.length) return;
        tiles.forEach(function (t) { t.warning = true; });
        return Promise.resolve(self.view.ringWarning(k, tiles.map(function (t) { return xy(t.x, t.y); })))
          .then(function () { return self.view.tilesChanged(tiles); })
          .then(function () { return self.view.banner('Ring closing next round', 'ring'); });
      }
    }).then(function () {
      self.nextRingIn = self.ringsClosed < RINGS_TOTAL ? self.nextRingRound - self.round : null;
      self.nextSurgeIn = self.ringsClosed >= RINGS_TOTAL ? self.nextRingRound - self.round : null;
    });
  };

  // ------------------------------------------------------------------ controller API
  G._findCard = function (p, uid) { for (var i = 0; i < p.hand.length; i++) if (p.hand[i].uid === uid) return p.hand[i]; return null; };
  // Free walking: any number of walks per turn, before, between or after cards, until moveLeft runs out.
  G._canWalk = function (p) {
    return !this.over && p === this.active && p.alive && !p.turnDone && !this.hasStatus(p, 'root') && p.moveLeft > 0;
  };
  G.walkTargets = function (p) {
    if (!this._canWalk(p)) return [];
    return this.reachable(p, p.moveLeft).map(function (n) { return xy(n.x, n.y); });
  };
  // Cost of the cheapest walking path to `tile` (ignores the remaining budget), or null if no path exists.
  G.walkCost = function (p, tile) {
    if (!p || !tile) return null;
    if (tile.x === p.x && tile.y === p.y) return 0;
    var n = this.reachable(p, 99).filter(function (q) { return q.x === tile.x && q.y === tile.y; })[0];
    return n ? n.cost : null;
  };
  G.doMove = function (p, dest) {
    var self = this;
    if (!dest || !this._canWalk(p)) return Promise.resolve(false);
    var node = this.reachable(p, p.moveLeft).filter(function (n) { return n.x === dest.x && n.y === dest.y; })[0];
    if (!node) return Promise.resolve(false);
    p.moveLeft -= node.cost;
    return this.moveAlong(p, node.path, 'walk')
      .then(function () { return self.refresh(); })
      .then(function () { return true; });
  };
  G.cardCost = function (p, uid) {
    var c = this._findCard(p, uid); if (!c) return 0;
    var def = DATA.CARDS[c.id];
    if (p.turnFlags && p.turnFlags.thousandCuts && def.cat === 'damage') return 0;
    return def.cost;
  };
  G.canPlay = function (p, uid) {
    if (this.over) return { ok: false, reason: 'Game over' };
    if (!p || !p.alive) return { ok: false, reason: 'Eliminated' };
    if (p !== this.active) return { ok: false, reason: 'Not your turn' };
    if (p.turnDone) return { ok: false, reason: 'Turn is over' };
    var c = this._findCard(p, uid);
    if (!c) return { ok: false, reason: 'Card not in hand' };
    var def = DATA.CARDS[c.id];
    if (def.cat === 'movement' && this.hasStatus(p, 'root')) return { ok: false, reason: 'Rooted' };
    if (p.energy < this.cardCost(p, uid)) return { ok: false, reason: 'Not enough Energy' };
    if ((c.id === 'cleanse' || c.id === 'sanctuary') && this.surges > 0) return { ok: false, reason: 'The rot can no longer be cleansed' };
    if (def.pickCount > 0 && !def.targets(this, p, []).length) return { ok: false, reason: 'No targets' };
    return { ok: true, reason: '' };
  };
  G.cardTargets = function (p, uid, picks) {
    var c = this._findCard(p, uid); if (!c) return [];
    var def = DATA.CARDS[c.id]; picks = picks || [];
    if (picks.length >= def.pickCount) return [];
    return def.targets(this, p, picks);
  };
  G.cardArea = function (p, uid, picks) {
    var c = this._findCard(p, uid); if (!c) return [];
    var def = DATA.CARDS[c.id]; picks = picks || [];
    if (picks.length < def.pickCount) return [];
    return def.area(this, p, picks);
  };
  G._validPicks = function (def, p, picks) {
    picks = picks || [];
    if (picks.length !== def.pickCount) return false;
    for (var i = 0; i < picks.length; i++) {
      var pk = picks[i];
      if (!pk || !def.targets(this, p, picks.slice(0, i)).some(function (t) { return t.x === pk.x && t.y === pk.y; })) return false;
    }
    return true;
  };
  G.playCard = function (p, uid, picks) {
    var self = this;
    var chk = this.canPlay(p, uid);
    if (!chk.ok) return Promise.resolve(false);
    var c = this._findCard(p, uid), def = DATA.CARDS[c.id];
    picks = (picks || []).map(function (t) { return xy(t.x, t.y); });
    if (!this._validPicks(def, p, picks)) return Promise.resolve(false);
    p.energy -= this.cardCost(p, uid);
    p.hand.splice(p.hand.indexOf(c), 1);
    this._mod = null;
    if (def.cat === 'damage') {
      var mod = { add: 0, mult: 1 };
      if (p.cls === 'striker' && !p.turnFlags.strikerUsed) { p.turnFlags.strikerUsed = true; if (p.movedThisTurn) mod.add += STRIKER_BONUS; }
      var aim = this.hasStatus(p, 'aim'); if (aim) { mod.add += aim.amount || 0; this._removeStatus(p, aim); }
      var vd = this.hasStatus(p, 'vanishdmg'); if (vd) { mod.mult = 2; this._removeStatus(p, vd); }
      this._mod = mod;
    }
    return Promise.resolve(this.say(p.name + ' played ' + def.name))
      .then(function () { return def.apply(self, p, picks); })
      .catch(function (err) { self._err(err); })
      .then(function () {
        self._mod = null;
        if (!c.temp) p.discard.push(c);
        return self.refresh();
      }).then(function () { return true; });
  };
  G.canUseGb = function (p) {
    if (this.over) return { ok: false, reason: 'Game over' };
    if (!p || !p.alive || p !== this.active) return { ok: false, reason: 'Not your turn' };
    if (p.turnDone) return { ok: false, reason: 'Turn is over' };
    if (p.gbUsedThisTurn) return { ok: false, reason: 'Already used this turn' };
    var gb = DATA.GAMEBREAKERS[p.gb];
    if (p.meter < gb.cost) return { ok: false, reason: 'Needs ' + gb.cost + ' charge' };
    if (gb.id === 'collapse' && this.ringsClosed >= RINGS_TOTAL) return { ok: false, reason: 'No rings left' };
    if (gb.pickCount > 0 && !gb.targets(this, p, []).length) return { ok: false, reason: 'No targets' };
    return { ok: true, reason: '' };
  };
  G.gbTargets = function (p, picks) { var gb = DATA.GAMEBREAKERS[p.gb]; picks = picks || []; if (picks.length >= gb.pickCount) return []; return gb.targets(this, p, picks); };
  G.gbArea = function (p, picks) { var gb = DATA.GAMEBREAKERS[p.gb]; picks = picks || []; if (picks.length < gb.pickCount) return []; return gb.area(this, p, picks); };
  G.useGb = function (p, picks) {
    var self = this;
    if (!this.canUseGb(p).ok) return Promise.resolve(false);
    var gb = DATA.GAMEBREAKERS[p.gb];
    picks = (picks || []).map(function (t) { return xy(t.x, t.y); });
    if (!this._validPicks(gb, p, picks)) return Promise.resolve(false);
    p.gbUsedThisTurn = true; p.meter -= gb.cost; p.stats.gbUsed++;
    var tiles = gb.area(this, p, picks);
    return Promise.resolve(this.view.banner(p.name + ': ' + gb.name, 'gb'))
      .then(function () { return self.view.fx('gamebreaker', { gb: gb.id, user: p, picks: picks, tiles: tiles }); })
      .then(function () { return self.say(p.name + ' unleashed ' + gb.name); })
      .then(function () { return gb.apply(self, p, picks); })
      .catch(function (err) { self._err(err); })
      .then(function () { return self.refresh(); }).then(function () { return true; });
  };
  G._err = function (err) {
    this.errors.push(err && err.stack ? err.stack : String(err));
    if (typeof console !== 'undefined' && console.error && !this.quiet) console.error(err);
  };

  // ------------------------------------------------------------------ turn flow
  G._startStatuses = function (p) {
    var self = this, chain = resolved();
    // Shields fade: any remaining shield is lost at the start of your turn.
    if (p.shield > 0) p.shield = 0;
    if (p.cls === 'vanguard') {
      var def = this.stats(p).def;
      if (p.shield < def) { var add = def - p.shield; chain = chain.then(function () { return self.addShield(p, add); }); }
    }
    p.statuses.slice().forEach(function (st) {
      chain = chain.then(function () {
        if (!p.alive || self.over) return;
        if (st.type === 'renew') return self.heal(p, st.amount);
        if (st.type === 'curse') { var src = self.players[st.from]; return self.damage(p, st.amount || 2, { pierce: true, source: 'dot', attacker: src && src.alive ? src : null }); }
        if (st.type === 'siphon') return self.siphonPulse(p);
        if (st.type === 'skyfall') {
          var s = self.stats(p);
          var tiles = st.tiles.slice();
          st.tiles.forEach(function (q) { self.tile(q.x, q.y).marked = false; });
          return self.strike(p, tiles, function () { return 8 + s.atk * 2; }, { style: 'area', target: tiles[4] || tiles[0], cardId: 'skyfall_volley', gb: true })
            .then(function () { return self.view.tilesChanged(tiles.map(function (q) { return self.tile(q.x, q.y); })); });
        }
      });
    });
    return chain.then(function () {
      if (!p.alive) return;
      var expired = [];
      p.statuses.forEach(function (st) { if (st.turns !== null && st.turns !== undefined) { st.turns--; if (st.turns <= 0) expired.push(st); } });
      expired.forEach(function (st) { self._removeStatus(p, st); });
    });
  };
  G._turn = function (p) {
    var self = this;
    this.active = p; this.turnCount++;
    p.movedThisTurn = false; p.tilesMovedThisTurn = 0; p.stance = null; p.gbUsedThisTurn = false; p.turnDone = false; p.turnFlags = {}; p.moveLeft = 0;
    return Promise.resolve(this.view.turnStart(p))
      .then(function () { if (p.isHuman) return self.view.banner('Your turn', 'turn'); })
      .then(function () { return self._startStatuses(p); })
      .then(function () {
        if (!p.alive || self.over) return;
        p.maxEnergy = Math.min(6, 3 + self.ringsClosed);
        p.energy = p.maxEnergy;
        p.moveMax = self.moveAllowance(p);
        p.moveLeft = self.hasStatus(p, 'root') ? 0 : p.moveMax;
        var need = Math.max(0, DRAW_TO - p.hand.length);
        return self.draw(p, need);
      })
      .then(function () { return self.refresh(); })
      .then(function () {
        if (!p.alive || self.over) return;
        var ctrl = self.controllers[p.id];
        if (!ctrl || !ctrl.takeTurn) return;
        return Promise.resolve().then(function () { return ctrl.takeTurn(self, p); }).catch(function (err) { self._err(err); });
      })
      .then(function () { if (p.alive && !self.over) return self._endTurn(p); })
      .then(function () {
        p.hand = p.hand.filter(function (c) { return !c.temp; });
        p.movedLastTurn = p.movedThisTurn;
        p.tilesMovedLastTurn = p.tilesMovedThisTurn;
        p.stance = null; p.turnFlags = {}; p.turnDone = true; p.moveLeft = 0;
        self.active = null;
        return self.refresh();
      });
  };
  G._endTurn = function (p) {
    var self = this, chain = resolved();
    var t = this.tile(p.x, p.y);
    var embrace = this.hasStatus(p, 'rotembrace') && !this.surges;
    if (t.corrupted && (!p.turnFlags.riftwalk || this.surges)) {
      var dmg = this.corruptionDamage(p);
      if (embrace) chain = chain.then(function () { return self.heal(p, dmg); });
      else chain = chain.then(function () { return self.damage(p, dmg, { source: 'corruption', pierce: true }); });
    }
    if (embrace) chain = chain.then(function () { if (p.alive) return self.corruptTiles(P.adjacent(self, p)); });
    return chain;
  };
  G._order = function () {
    var self = this;
    var list = this.alivePlayers().map(function (p) { return { p: p, spd: self.stats(p).spd, r: self.rand() }; });
    list.sort(function (a, b) { return (b.spd - a.spd) || (a.p.hp - b.p.hp) || (a.r - b.r); });
    return list.map(function (o) { return o.p; });
  };
  G._finishByCap = function () {
    this.endedByCap = true;
    var alive = this.alivePlayers().sort(function (a, b) { return (b.hp - a.hp) || (a.id - b.id); });
    var self = this;
    alive.forEach(function (p, i) { p.place = i + 1; if (i > 0) { p.alive = false; } });
    this.winner = alive[0] || null;
    this.over = true;
    this._rebuildEntities();
    return Promise.resolve(this.say('Time is up: ' + (this.winner ? this.winner.name : 'nobody') + ' wins with the most HP'))
      .then(function () { return self.view.banner('Time up!', 'info'); });
  };
  G.results = function () {
    var placements = this.players.slice().sort(function (a, b) { return (a.place || 99) - (b.place || 99); }).map(function (p) { return p.id; });
    return {
      winnerId: this.winner ? this.winner.id : null,
      placements: placements,
      players: this.players.map(function (p) { return { id: p.id, name: p.name, cls: p.cls, place: p.place, stats: { dmgDealt: p.stats.dmgDealt, kills: p.stats.kills, caches: p.stats.caches, gbUsed: p.stats.gbUsed } }; }),
      rounds: this.round, endedByCap: this.endedByCap
    };
  };
  G.run = function () {
    var self = this;
    var loopRound = function () {
      if (self.over) return resolved();
      if (self.round >= self.maxRounds) return self._finishByCap();
      self.round++;
      return self._roundRings()
        .then(function () { self.turnOrder = self._order(); return self.view.roundStart(self.round); })
        .then(function () { return self.refresh(); })
        .then(function () {
          var order = self.turnOrder.slice(), i = 0;
          var next = function () {
            if (self.over || i >= order.length) return resolved();
            var p = order[i++];
            if (!p.alive) return next();
            return self._turn(p).then(next);
          };
          return next();
        })
        .then(loopRound);
    };
    return Promise.resolve(this.view.init(this))
      .then(function () { return self.say('The battle begins'); })
      .then(function () { return self.refresh(); })
      .then(loopRound)
      .then(function () {
        var r = self.results();
        return Promise.resolve(self.view.gameOver(r)).then(function () { return r; });
      });
  };

  return { Game: Game, stubView: stubView, STRIKER_BONUS: STRIKER_BONUS, MOVE_CAP: MOVE_CAP, PHANTOM_TILES: PHANTOM_TILES, mulberry32: mulberry32, VIEW_METHODS: VIEW_METHODS, ringOf: ringOf,
    RING_FIRST: RING_FIRST, RING_EVERY: RING_EVERY, RINGS_TOTAL: RINGS_TOTAL, HAND_MAX: HAND_MAX };
})();
