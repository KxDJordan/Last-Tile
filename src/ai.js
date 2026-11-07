// AI: bot decision-making. DOM-free. Uses only information a player could see:
// no enemy traps, no invisible enemies, enemy decoys are treated as real pieces.
var AI = (function () {
  'use strict';
  var P = DATA.patterns;
  var MAX_ACTIONS = 12;
  var GB_THRESHOLD = 8;
  var PLAY_THRESHOLD = 0.3;

  var CLASS_AI = {
    vanguard: { ideal: 1, aggr: 1.0, heal: 1.0, shield: 1.3, elev: 0.2, retreat: 0.2 },
    striker: { ideal: 1, aggr: 1.15, heal: 1.0, shield: 0.9, elev: 0.0, retreat: 0.3, threat: 0.45 },
    marksman: { ideal: 4, aggr: 1.0, heal: 1.1, shield: 1.0, elev: 1.0, retreat: 0.45, threat: 0.65 },
    phantom: { ideal: 2, aggr: 1.1, heal: 1.0, shield: 0.9, elev: 0.1, retreat: 0.35 },
    lifebinder: { ideal: 2, aggr: 0.95, heal: 1.3, shield: 1.0, elev: 0.2, retreat: 0.3 },
    hexer: { ideal: 3, aggr: 1.0, heal: 1.0, shield: 0.9, elev: 0.3, retreat: 0.35 }
  };
  // How far each Damage card reaches, for "what could I hit from there" estimates.
  var REACH = {
    jab: ['adj'], sling_shot: ['range', 4], shield_bash: ['adj'], ground_slam: ['adj'], lance_thrust: ['line', 2],
    rising_kick: ['adj'], flurry: ['adj'], haymaker: ['adj'], long_shot: ['range', 6], piercing_bolt: ['line', 6],
    scatter_shot: ['cone'], backstab: ['adj'], dagger_fan: ['diag', 2], flicker_strike: ['range', 4], drain_touch: ['adj'],
    life_spear: ['line', 3], rot_lash: ['line', 4], hex_bolt: ['range', 5]
  };

  function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function reaches(g, kind, from, e) {
    var dx = Math.abs(e.x - from.x), dy = Math.abs(e.y - from.y), d = dx + dy;
    switch (kind[0]) {
      case 'adj': return d === 1;
      case 'line': return (dx === 0 || dy === 0) && d >= 1 && d <= kind[1];
      case 'range': return d >= 1 && d <= kind[1] && g.los(from, e);
      case 'diag': return dx === dy && dx >= 1 && dx <= kind[1];
      case 'cone': { var al = Math.max(dx, dy), pe = Math.min(dx, dy); return (al === 1 && pe === 0) || (al === 2 && pe <= 1); }
    }
    return false;
  }

  // ------------------------------------------------------------------ perception
  function perceive(g, me) {
    var cw = CLASS_AI[me.cls] || CLASS_AI.vanguard;
    var s = g.stats(me);
    var enemies = [];
    g.entities.forEach(function (e) {
      if (!e.alive || g.ownerId(e) === me.id || !g.canAffect(me, e)) return;
      var o = g.ownerOf(e), os = g.stats(o);
      enemies.push({ e: e, x: e.x, y: e.y, hp: o.hp, maxHp: o.maxHp, shield: o.shield, def: os.def, atk: os.atk, cls: o.cls,
        phantomHalf: o.cls === 'phantom' && o.tilesMovedLastTurn >= CORE.PHANTOM_TILES && o.phantomHitRound !== g.round, statuses: o.statuses, immovable: g.isImmovable(e) });
    });
    enemies.forEach(function (en) { en.pen = Math.max(0, en.def - 1) * 0.35 + Math.min(en.shield, 10) * 0.08 + (en.hp / en.maxHp) * 1.0; });
    var hpFrac = me.hp / me.maxHp;
    var ideal = cw.ideal + (hpFrac < cw.retreat ? 2 : 0);
    var mod = { add: 0, mult: 1 };
    if (me.cls === 'striker' && !me.turnFlags.strikerUsed && me.movedThisTurn) mod.add += CORE.STRIKER_BONUS;
    var aim = g.hasStatus(me, 'aim'); if (aim) mod.add += aim.amount || 0;
    if (g.hasStatus(me, 'vanishdmg')) mod.mult = 2;
    var threatW = (cw.threat || 0.25) * (hpFrac < 0.5 ? 1.8 : 1) * (30 / Math.max(15, me.hp + me.shield));
    var ctx = { g: g, me: me, s: s, cw: cw, enemies: enemies, hpFrac: hpFrac, ideal: ideal, mod: mod, corr: g.corruptionDamage(me), threatW: threatW };
    ctx.V = valueMap(ctx);
    ctx.walk = g.walkTargets(me).length ? g.reachable(me, me.moveLeft) : [];
    ctx.walkSet = {};
    ctx.walk.forEach(function (n) { ctx.walkSet[n.x + ',' + n.y] = n.cost; });
    return ctx;
  }
  function enemyAt(ctx, x, y) { for (var i = 0; i < ctx.enemies.length; i++) if (ctx.enemies[i].x === x && ctx.enemies[i].y === y) return ctx.enemies[i]; return null; }

  // Rough damage enemies could deal to me next round if I stood at (x,y).
  function threatAt(ctx, x, y) {
    var th = 0, def = ctx.s.def, n = 0;
    for (var i = 0; i < ctx.enemies.length; i++) {
      var en = ctx.enemies[i], d = Math.abs(en.x - x) + Math.abs(en.y - y);
      if (d > 4) continue;
      var w = d <= 1 ? 1 : d <= 3 ? 0.7 : 0.4;
      th += Math.max(1, en.atk + 3 - def) * w; n++;
    }
    return th;
  }
  // Position value for every tile.
  function valueMap(ctx) {
    var g = ctx.g, me = ctx.me, V = [];
    var embrace = !!g.hasStatus(me, 'rotembrace');
    for (var y = 0; y < g.size; y++) {
      var row = [];
      for (var x = 0; x < g.size; x++) {
        var t = g.tiles[y][x];
        if (t.pillar) { row.push(-99); continue; }
        var v = 0;
        if (t.corrupted) v += embrace ? ctx.corr * 0.5 : -(ctx.corr * 2.2 + 3);
        else if (t.warning) v -= (3 + 2 * (g.ringsClosed + 1)) * 1.6 + 2;
        else if (g.nextRingIn !== null && t.ring === g.ringsClosed) v -= g.nextRingIn <= 2 ? 3 : 1;
        else if (g.nextRingIn !== null && t.ring === g.ringsClosed + 1 && g.nextRingIn <= 2) v -= 0.6;
        v -= 0.3 * Math.max(Math.abs(x - 5.5), Math.abs(y - 5.5));
        if (t.cache) v += 4.5;
        if (t.marked && !g.hasStatus(me, 'skyfall')) v -= 9;
        if (t.perchLock === me.id) v += 6;   // stay on our Eagle's Perch
        v += t.h * ctx.cw.elev;
        if (ctx.enemies.length) {
          var nd = 99, adj = 0, near = 0, bestT = 99;
          for (var i = 0; i < ctx.enemies.length; i++) {
            var en = ctx.enemies[i];
            var d = Math.abs(en.x - x) + Math.abs(en.y - y);
            if (d < nd) nd = d;
            if (d === 1) adj++;
            if (d <= 2) near++;
            // prefer standing at our ideal range from a target we can actually hurt
            var tv = Math.abs(d - ctx.ideal) * 1.2 + en.pen;
            if (tv < bestT) bestT = tv;
          }
          v -= Math.min(bestT, Math.abs(nd - ctx.ideal) * 1.2 + 2);
          if (ctx.ideal >= 2) v -= adj * 1.5;
          if (ctx.hpFrac < 0.35) v -= near * 1.2;
          v -= threatAt(ctx, x, y) * ctx.threatW;
        }
        row.push(v);
      }
      V.push(row);
    }
    return V;
  }

  // Expected value of dealing `raw` x hits to an enemy view.
  function dmgValue(ctx, en, raw, hits, pierce) {
    raw = Math.max(0, Math.floor(raw));
    var per = pierce ? raw : Math.max(1, raw - en.def);
    var tot = per * (hits || 1);
    if (en.phantomHalf) tot = Math.max(1, Math.floor(tot / 2));
    var shield = en.shield, hpLoss = Math.max(0, tot - shield);
    var v = hpLoss + Math.min(tot, shield) * 0.8;
    if (hpLoss >= en.hp) v += 14 + en.maxHp * 0.15;
    else v *= 1 + (1 - en.hp / en.maxHp) * 0.3;
    return v * ctx.cw.aggr;
  }
  function healValue(ctx, amt) {
    var me = ctx.me, missing = me.maxHp - me.hp, eff = Math.min(amt, missing);
    var w = ctx.hpFrac < 0.5 ? 1.3 : 0.9;
    return eff * w * ctx.cw.heal;
  }
  function enemiesWithin(ctx, from, r) { var n = 0; ctx.enemies.forEach(function (e) { if (dist(from, e) <= r) n++; }); return n; }

  // Best damage I could deal from `from` with remaining energy (excluding a card uid).
  function potential(ctx, from, energy, excludeUid) {
    var g = ctx.g, me = ctx.me, best = 0;
    var moved = (from.x !== me.x || from.y !== me.y) ? true : me.movedThisTurn;
    var proxy = Object.create(me); proxy.x = from.x; proxy.y = from.y; proxy.movedThisTurn = moved;
    var flowAdd = me.cls === 'striker' && !me.turnFlags.strikerUsed && moved ? CORE.STRIKER_BONUS : 0;
    for (var i = 0; i < me.hand.length; i++) {
      var c = me.hand[i]; if (c.uid === excludeUid) continue;
      var def = DATA.CARDS[c.id]; if (def.cat !== 'damage' || !REACH[c.id]) continue;
      if (g.cardCost(me, c.uid) > energy) continue;
      for (var j = 0; j < ctx.enemies.length; j++) {
        var en = ctx.enemies[j];
        if (!reaches(g, REACH[c.id], from, en)) continue;
        var raw = def.amt(g, proxy, en.e, [], ctx.s) + flowAdd;
        var v = dmgValue(ctx, en, raw, def.hits || 1, def.pierce);
        if (v > best) best = v;
      }
    }
    return best;
  }
  function hasFlowCards(ctx) {
    var me = ctx.me;
    if (me.movedThisTurn) return false;
    return me.hand.some(function (c) {
      var d = DATA.CARDS[c.id];
      if (me.cls === 'striker' && d.cat === 'damage' && !me.turnFlags.strikerUsed) return true;
      return c.id === 'haymaker' || c.id === 'backstab' || c.id === 'rising_kick';
    });
  }

  // Simulate where a push would leave an enemy: {tile, collide}
  function simPush(g, e, d, n, stopAt) {
    var x = e.x, y = e.y;
    for (var i = 0; i < n; i++) {
      var dir = typeof d === 'function' ? d(x, y) : d;
      var nx = x + dir.dx, ny = y + dir.dy;
      if (stopAt && nx === stopAt.x && ny === stopAt.y) return { x: x, y: y, collide: false };
      var a = g.tile(x, y), b = g.tile(nx, ny);
      var occ = b ? g.pieceAt(nx, ny) : null;
      if (!b || b.pillar || b.perchLock !== null || (occ && occ !== e) || b.h - a.h >= 2) return { x: x, y: y, collide: true };
      x = nx; y = ny;
    }
    return { x: x, y: y, collide: false };
  }
  function displaceValue(ctx, en, res, towardMe) {
    var g = ctx.g, v = 0;
    if (en.immovable) return 0;
    if (res.collide) v += dmgValue(ctx, en, 2, 1, true);
    var t = g.tile(res.x, res.y);
    if (t.corrupted) v += g.corruptionDamage(g.ownerOf(en.e)) * 0.6;
    else if (t.warning) v += 2;
    if (t.trap && t.trap.ownerId === ctx.me.id) v += t.trap.dmg * 0.8;
    var dNew = dist(res, ctx.me), dOld = dist(en, ctx.me);
    if (ctx.ideal <= 1) v += (dOld - dNew) * 0.8; else v += (dNew - dOld) * 0.5;
    return v;
  }

  // ------------------------------------------------------------------ card scoring
  function scoreCard(ctx, c, def, picks, energy) {
    var g = ctx.g, me = ctx.me, s = ctx.s;
    var cost = g.cardCost(me, c.uid);
    var base = -cost * 0.6;
    var kind = def.ai && def.ai.kind;
    var cur = { x: me.x, y: me.y };
    if ((def.cat === 'damage' && !kind) || kind === 'flicker') {
      if (c.id === 'flicker_strike') {
        var en0 = enemyAt(ctx, picks[0].x, picks[0].y); if (!en0) return -1;
        var spot = def.spot(g, me, picks[0]);
        var raw0 = (def.amt(g, me, en0.e, picks, s) + ctx.mod.add) * ctx.mod.mult;
        return base + dmgValue(ctx, en0, raw0, 1, false) + (spot ? (ctx.V[spot.y][spot.x] - ctx.V[me.y][me.x]) * 0.6 : 0);
      }
      var area = def.area(g, me, picks), v = 0;
      for (var i = 0; i < area.length; i++) {
        var en = enemyAt(ctx, area[i].x, area[i].y);
        if (!en) continue;
        var raw = (def.amt(g, me, en.e, picks, s) + ctx.mod.add) * ctx.mod.mult;
        var dv = dmgValue(ctx, en, raw, def.hits || 1, def.pierce);
        v += dv;
        var pushN = (def.ai && def.ai.push) || (c.id === 'rising_kick' && me.movedThisTurn ? 1 : 0);
        if (pushN && en.hp > raw) v += displaceValue(ctx, en, simPush(g, en, P.dirOf(me, en), pushN), false) * 0.7;
        if (def.ai && def.ai.drain) v += healValue(ctx, Math.max(1, raw - en.def)) * 0.6;
      }
      if (v <= 0) return -1;
      return base + v + (ctx.mod.add > 0 || ctx.mod.mult > 1 ? 0 : 0.5);
    }
    switch (kind) {
      case 'move': {
        var dest = picks[0];
        var gain = ctx.V[dest.y][dest.x] - ctx.V[cur.y][cur.x];
        var eLeft = energy - cost;
        var pot = potential(ctx, dest, eLeft, c.uid) - potential(ctx, cur, eLeft, c.uid);
        var v2 = base + gain + 0.7 * pot + (hasFlowCards(ctx) ? 2 : 0);
        // a tile we could simply walk to is worth nothing extra; only the card's rider counts
        if (ctx.walkSet[dest.x + ',' + dest.y] !== undefined) v2 = base - 0.5;
        var proxy = { x: dest.x, y: dest.y };
        if (def.ai.adjDmg) ctx.enemies.forEach(function (en) { if (dist(en, proxy) === 1) v2 += dmgValue(ctx, en, def.ai.adjDmg(s), 1, false); });
        if (def.ai.oneDmg) { var bb = 0; ctx.enemies.forEach(function (en) { if (dist(en, proxy) === 1) bb = Math.max(bb, dmgValue(ctx, en, def.ai.oneDmg(s), 1, false)); }); v2 += bb; }
        if (def.ai.heal) v2 += healValue(ctx, def.ai.heal);
        if (def.ai.rift && g.tile(dest.x, dest.y).corrupted) v2 += ctx.corr * 2.2 + 3;
        return v2;
      }
      case 'heal': return base + healValue(ctx, def.heal(s, g, me));
      case 'renew': if (g.hasStatus(me, 'renew')) return -1; return base + Math.min(def.heal(s), me.maxHp - me.hp + 4) * 0.7 * ctx.cw.heal;
      case 'shield': {
        var nearE = enemiesWithin(ctx, me, 3);
        var sv = def.shieldAmt(s) * (0.25 + 0.3 * Math.min(3, nearE)) * ctx.cw.shield;
        if (me.shield > 12) sv *= 0.4;
        if (def.ai.adjDmg) ctx.enemies.forEach(function (en) { if (dist(en, me) === 1) sv += dmgValue(ctx, en, def.ai.adjDmg(s), 1, false); });
        if (def.ai.raise) { var t = g.tile(me.x, me.y); if (t.h < 2) sv += ctx.cw.elev * 1.5; }
        return base + sv;
      }
      case 'draw': {
        var n = def.ai.n, room = 7 - me.hand.length + 1;
        var useful = Math.min(n, room, me.deck.length + me.discard.length);
        var after = energy - cost + (def.ai.energy || 0);
        return base + useful * (after >= 1 ? 1.6 : 0.8) + (def.ai.energy || 0) * 2.2;
      }
      case 'aim': {
        if (g.hasStatus(me, 'aim')) return -1;
        var p2 = potential(ctx, cur, energy - cost, c.uid);
        return p2 > 0 ? base + s.atk * 0.9 : -1;
      }
      case 'veil': return base + (g.hasStatus(me, 'veil') ? 0 : Math.min(2, enemiesWithin(ctx, me, 4)) * 1.8) + 1.2;
      case 'trap': {
        var tt = picks[0], dmg = def.trapDmg(s), tv = 0;
        ctx.enemies.forEach(function (en) { var d = dist(en, tt); if (d === 1) tv += 0.45 * dmg; else if (d === 2) tv += 0.2 * dmg; });
        tv = Math.min(tv, dmg * 1.1);
        if (c.id === 'snare' && tv > 0) tv += 1.5;
        return base + tv;
      }
      case 'debuff': {
        var en2 = enemyAt(ctx, picks[0].x, picks[0].y); if (!en2) return -1;
        var has = en2.statuses.some(function (st) { return st.type === def.ai.status; });
        if (has) return -1;
        if (def.ai.status === 'curse') return base + (en2.hp <= 6 ? 8 : 4.8);
        return base + (en2.atk >= 3 && dist(en2, me) <= 4 ? 2.6 : 0.8);
      }
      case 'push': {
        var en3 = enemyAt(ctx, picks[0].x, picks[0].y); if (!en3) return -1;
        return base + displaceValue(ctx, en3, simPush(g, en3, P.dirOf(me, en3), def.ai.n), false);
      }
      case 'warcry': {
        var wv = 0;
        ctx.enemies.forEach(function (en) {
          var d = dist(en, me); if (d > 3 || d <= 1) return;
          wv += displaceValue(ctx, en, simPush(g, en, function (x, y) { return P.dirOf({ x: x, y: y }, me); }, 1, me), true);
        });
        return base + wv;
      }
      case 'hook': {
        var e4 = def.first(g, me, picks[0]); if (!e4) return -1;
        var en4 = enemyAt(ctx, e4.x, e4.y); if (!en4) return -1;
        var r4 = simPush(g, en4, function (x, y) { return P.dirOf({ x: x, y: y }, me); }, 4, me);
        var hv = displaceValue(ctx, en4, r4, true);
        if (dist(r4, me) === 1) hv += potential(ctx, cur, energy - cost, c.uid) * 0.6 * (ctx.ideal <= 1 ? 1 : 0.2);
        return base + hv;
      }
      case 'swap': {
        var e5 = g.pieceAt(picks[0].x, picks[0].y); if (!e5 || g.ownerId(e5) === me.id) return -1;
        var gain5 = ctx.V[e5.y][e5.x] - ctx.V[me.y][me.x];
        var en5 = enemyAt(ctx, e5.x, e5.y);
        var myT = g.tile(me.x, me.y);
        if (en5 && myT.corrupted) gain5 += g.corruptionDamage(g.ownerOf(e5)) * 0.6;
        return base + gain5;
      }
      case 'corrupt': {
        var tc = g.tile(picks[0].x, picks[0].y), cv = 0;
        var en6 = enemyAt(ctx, tc.x, tc.y);
        if (en6) cv += g.corruptionDamage(g.ownerOf(en6.e)) * 0.6 + 1;
        var syn = me.hand.some(function (q) { return q.id === 'rot_lash' || q.id === 'hex_bolt'; });
        if (syn) ctx.enemies.forEach(function (en) { if (dist(en, tc) <= 1) cv += 1; });
        if (tc.x === me.x && tc.y === me.y && !g.hasStatus(me, 'rotembrace')) cv -= 6;
        return base + cv;
      }
      case 'cleanse': {
        var tiles = def.pickCount === 0 ? def.area(g, me, []) : [picks[0]];
        var onMe = tiles.some(function (t) { return t.x === me.x && t.y === me.y; }) && g.tile(me.x, me.y).corrupted;
        if (!onMe || g.hasStatus(me, 'rotembrace')) return -1;
        return base + ctx.corr * 1.1;
      }
    }
    return -1;
  }

  // ------------------------------------------------------------------ gamebreaker scoring
  function allTiles(g) { var r = []; for (var y = 0; y < g.size; y++) for (var x = 0; x < g.size; x++) r.push({ x: x, y: y }); return r; }
  function bestGb(ctx, energy) {
    var g = ctx.g, me = ctx.me, s = ctx.s, gb = DATA.GAMEBREAKERS[me.gb];
    if (!g.canUseGb(me).ok) return null;
    var best = null;
    function consider(picks, score) { if (!best || score > best.score) best = { gb: true, picks: picks, score: score }; }
    var near4 = enemiesWithin(ctx, me, 4), pot = potential(ctx, me, energy, null);
    var dmgCards = me.hand.filter(function (c) { return DATA.CARDS[c.id].cat === 'damage'; });
    switch (gb.id) {
      case 'iron_tide':
        gb.targets(g, me, []).forEach(function (t) {
          var r = gb.plan(g, me, t); if (!r.hit) return;
          var en = enemyAt(ctx, r.hit.x, r.hit.y); if (!en) return;
          consider([t], dmgValue(ctx, en, 3 + s.def + s.atk, 1, false) + displaceValue(ctx, en, simPush(g, en, r.d, 3), false));
        }); break;
      case 'last_bastion': if (near4 && ctx.hpFrac < 0.8) consider([], (s.def + 3) * 0.8 + 3 * near4); break;
      case 'earthshatter': {
        var v = 0; P.around(g, me).forEach(function (t) { var en = enemyAt(ctx, t.x, t.y); if (en) v += dmgValue(ctx, en, 1 + s.def * 2, 1, false) + 2; });
        consider([], v); break;
      }
      case 'thousand_cuts': {
        var c0 = 0; dmgCards.forEach(function (c) { c0 += DATA.CARDS[c.id].cost; });
        if (pot > 0 && dmgCards.length >= 2) consider([], c0 * 2.5); break;
      }
      case 'blitz_chain': if (pot > 0 && dmgCards.length >= 2) consider([], 4 + dmgCards.length * 2); break;
      case 'final_form': if (pot > 0 && dmgCards.length >= 1) consider([], s.spd * 1.5 * Math.min(3, dmgCards.length)); break;
      case 'railpiercer':
        gb.targets(g, me, []).forEach(function (t) {
          var v1 = 0; gb.area(g, me, [t]).forEach(function (q) { var en = enemyAt(ctx, q.x, q.y); if (en) v1 += dmgValue(ctx, en, 6 + s.atk * 2, 1, true); });
          consider([t], v1);
        }); break;
      case 'skyfall_volley':
        allTiles(g).forEach(function (t) {
          var v2 = 0, self = false;
          P.square(g, t, 1).forEach(function (q) { var en = enemyAt(ctx, q.x, q.y); if (en) v2 += dmgValue(ctx, en, 8 + s.atk * 2, 1, false) * 0.55; if (q.x === me.x && q.y === me.y) self = true; });
          consider([t], v2 - (self ? 2 : 0));
        }); break;
      case 'eagles_perch': consider([], enemiesWithin(ctx, me, 8) ? 9 : 2); break;
      case 'grand_swap': {
        var ents = g.entities.filter(function (e) { return e.alive && g.canAffect(me, e) && !(e.isDecoy && e.ownerId === me.id); });
        for (var i = 0; i < ents.length; i++) for (var j = i + 1; j < ents.length; j++) {
          var a = ents[i], b = ents[j], v3 = 0;
          [[a, b], [b, a]].forEach(function (pr) {
            var x = pr[0], to = pr[1];
            var tt = g.tile(to.x, to.y);
            if (x === me) v3 += ctx.V[to.y][to.x] - ctx.V[me.y][me.x];
            else if (enemyAt(ctx, x.x, x.y)) { if (tt.corrupted) v3 += g.corruptionDamage(g.ownerOf(x)) * 0.8; else if (tt.warning) v3 += 3; }
          });
          consider([{ x: a.x, y: a.y }, { x: b.x, y: b.y }], v3);
        }
        break;
      }
      case 'mirror_legion': if (enemiesWithin(ctx, me, 5)) consider([], 9 + (ctx.hpFrac < 0.5 ? 3 : 0)); break;
      case 'vanish': if (ctx.hpFrac < 0.45 && near4) consider([], 14); else if (pot > 8) consider([], pot * 0.9); break;
      case 'undying_pulse': if (ctx.hpFrac < 0.5 && near4) consider([], 14); break;
      case 'siphon_field': { var n2 = enemiesWithin(ctx, me, 2); consider([], n2 * (2 + Math.floor(s.hpPts / 2)) * 1.6); break; }
      case 'blood_tether': {
        var tgts = gb.targets(g, me, []); if (!tgts.length) break;
        var bt = null; tgts.forEach(function (t) { var en = enemyAt(ctx, t.x, t.y); if (en && (!bt || en.hp < bt.hp)) bt = en; });
        if (bt && (pot > 0 || near4 >= 2)) consider([{ x: bt.x, y: bt.y }], 8); break;
      }
      case 'collapse': {
        var k = g.ringsClosed, on = 0;
        ctx.enemies.forEach(function (en) { var t = g.tile(en.x, en.y); if (t.ring <= k) on++; });
        var meOn = g.tile(me.x, me.y).ring <= k;
        consider([], 5 + on * 3 - (meOn ? 4 : 0)); break;
      }
      case 'blight_bloom':
        allTiles(g).forEach(function (t) {
          var v4 = 0;
          gb.area(g, me, [t]).forEach(function (q) {
            var tq = g.tile(q.x, q.y); if (tq.corrupted) return;
            var en = enemyAt(ctx, q.x, q.y); if (en) v4 += g.corruptionDamage(g.ownerOf(en.e)) * 0.8 + 1.5;
            if (q.x === me.x && q.y === me.y && !g.hasStatus(me, 'rotembrace')) v4 -= 6;
          });
          consider([t], v4);
        }); break;
      case 'rot_embrace': {
        var t0 = g.tile(me.x, me.y);
        if (t0.corrupted || t0.warning || g.ringsClosed >= 2 || enemiesWithin(ctx, me, 1)) consider([], 10);
        break;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ turn
  function bestCardAction(ctx, banned) {
    var g = ctx.g, me = ctx.me, best = null, perCard = [];
    for (var i = 0; i < me.hand.length; i++) {
      var c = me.hand[i];
      if (banned[c.uid]) continue;
      if (!g.canPlay(me, c.uid).ok) continue;
      var def = DATA.CARDS[c.id];
      var cbest = -99;
      if (def.pickCount === 0) {
        var sc = scoreCard(ctx, c, def, [], me.energy);
        if (!best || sc > best.score) best = { uid: c.uid, picks: [], score: sc };
        perCard.push({ score: sc, cost: g.cardCost(me, c.uid) });
        continue;
      }
      var tg = g.cardTargets(me, c.uid, []);
      for (var j = 0; j < tg.length; j++) {
        var t = tg[j];
        // never target our own decoys or ourselves
        var occ = g.pieceAt(t.x, t.y);
        if (occ && occ.isDecoy && occ.ownerId === me.id && def.cat !== 'movement') continue;
        if (occ && occ.isDecoy && occ.ownerId === me.id && def.ai && (def.ai.kind === 'swap' || def.ai.kind === 'push')) continue;
        var sc2 = scoreCard(ctx, c, def, [t], me.energy);
        if (sc2 > cbest) cbest = sc2;
        if (!best || sc2 > best.score) best = { uid: c.uid, picks: [t], score: sc2 };
      }
      perCard.push({ score: cbest, cost: g.cardCost(me, c.uid) });
    }
    return best;
  }
  // Best free walk: position gain plus how much better our attacks would be from there.
  // dPot > 0 means walking first improves what the cards in hand can do (walk-then-act);
  // otherwise walking is pure repositioning, done after the cards (act-then-walk, kiting).
  function bestWalk(ctx) {
    var me = ctx.me, best = null;
    if (!ctx.walk.length) return null;
    var cur = { x: me.x, y: me.y };
    var potNow = potential(ctx, cur, me.energy, null);
    var budgetLeft = me.moveLeft;
    ctx.walk.forEach(function (n) {
      var dV = ctx.V[n.y][n.x] - ctx.V[cur.y][cur.x];
      var dPot = me.energy > 0 ? potential(ctx, n, me.energy, null) - potNow : 0;
      // keep some budget for later unless the move is clearly worth it
      var sc = dV + 0.9 * dPot - 0.12 * n.cost * (budgetLeft > 0 ? 1 : 0);
      if (!best || sc > best.score) best = { dest: { x: n.x, y: n.y }, score: sc, dPot: dPot, dV: dV };
    });
    return best;
  }

  function createController(opts) {
    opts = opts || {};
    var delay = opts.delay === undefined ? 400 : opts.delay;
    var rng = null;
    function wait(g) { return delay > 0 ? Promise.resolve(g.view.wait(delay)) : Promise.resolve(); }
    function takeTurn(g, me) {
      if (!rng) rng = CORE.mulberry32((g.seed ^ (me.id * 2654435761)) >>> 0);
      var actions = 0, banned = {}, fails = 0;
      function step() {
        if (g.over || !me.alive || g.active !== me || me.turnDone || actions >= MAX_ACTIONS || fails > 3) return Promise.resolve();
        var ctx = perceive(g, me);
        var gbOpt = bestGb(ctx, me.energy);
        if (gbOpt && gbOpt.score >= GB_THRESHOLD) {
          actions++;
          return wait(g).then(function () { return g.useGb(me, gbOpt.picks); }).then(function (ok) { if (!ok) fails++; return step(); });
        }
        var act = bestCardAction(ctx, banned);
        var walk = bestWalk(ctx);
        var doWalk = function () {
          actions++;
          return wait(g).then(function () { return g.doMove(me, walk.dest); }).then(function (ok) { if (!ok) fails++; return step(); });
        };
        // walk first when it sets up better attacks (cards stay playable afterwards)
        if (walk && walk.dPot > 0.5 && walk.score > 0.5) return doWalk();
        if (!act || act.score <= PLAY_THRESHOLD) {
          if (walk && walk.score > 0.4) return doWalk();
          return Promise.resolve();
        }
        actions++;
        return wait(g).then(function () { return g.playCard(me, act.uid, act.picks); })
          .then(function (ok) { if (!ok) { banned[act.uid] = true; fails++; } return step(); });
      }
      return step();
    }
    var STAT_PREF = { vanguard: 'def', striker: 'atk', marksman: 'atk', phantom: 'spd', lifebinder: 'hp', hexer: 'atk' };
    function chooseCache(g, me, options) {
      if (!rng) rng = CORE.mulberry32((g.seed ^ (me.id * 2654435761)) >>> 0);
      // Prefer the class stat shard; take cards only when the hand is nearly empty.
      if (me.hand.length <= 2) {
        var bi = 0, bv = -1;
        options.forEach(function (o, i) {
          if (o.type !== 'cards') return;
          var v = 0; o.cards.forEach(function (id) { var d = DATA.CARDS[id]; v += d.cat === 'damage' ? 3 : 2; if (d.cls !== 'general') v += 1; });
          if (v > bv) { bv = v; bi = i; }
        });
        return Promise.resolve({ index: bi });
      }
      var stat = STAT_PREF[me.cls] || 'hp';
      if (me.hp < me.maxHp * 0.5) stat = 'hp';
      var idx = 0; options.forEach(function (o, i) { if (o.type === 'shard') idx = i; });
      return Promise.resolve({ index: idx, stat: stat });
    }
    return { takeTurn: takeTurn, chooseCache: chooseCache, isBot: true };
  }

  return { createController: createController, CLASS_AI: CLASS_AI, perceive: perceive, REACH: REACH, _score: scoreCard, _walk: bestWalk, _gb: bestGb, MAX_ACTIONS: MAX_ACTIONS };
})();
