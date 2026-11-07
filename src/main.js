var MAIN = (function () {
  'use strict';

  var VIEW_METHODS = ['init', 'refresh', 'wait', 'roundStart', 'turnStart', 'tilesChanged', 'move', 'collide', 'attack',
    'hit', 'heal', 'shield', 'status', 'death', 'spawn', 'remove', 'ringWarning', 'ringClose', 'fx', 'banner', 'log', 'gameOver'];
  var BOT_NAMES = ['Ash', 'Briar', 'Cinder', 'Dusk', 'Ember', 'Fable', 'Gale', 'Hollow', 'Iris', 'Jinx', 'Kestrel', 'Lark', 'Moth', 'Nyx', 'Onyx', 'Pike', 'Quill', 'Rook', 'Sable', 'Thorn', 'Vale', 'Wren'];

  var hasView = typeof VIEW !== 'undefined' && !!VIEW;
  var mounted = false;
  var lastLoadout = null;
  var matchToken = 0;
  var reducedMQ = null;

  function vfn(name) { return hasView && typeof VIEW[name] === 'function' ? VIEW[name] : null; }
  function safe(fn, args, label) {
    try { return fn ? fn.apply(null, args) : undefined; } catch (e) { console.error(label || 'call', e); return undefined; }
  }
  function settle(p, label) {
    return Promise.resolve(p).catch(function (e) { console.error(label, e); });
  }
  function yieldTick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // The composite view: every CONTRACT method goes to VIEW (3D) and, when present, to UI.hooks.
  function makeCompositeView(game, token) {
    var inited = false;
    var v = {};
    function dead() { return token !== matchToken || UI.isAbandoned(); }
    function ensureInit() {
      if (inited) return;
      inited = true;
      var f = vfn('init');
      if (f) safe(function () { return f.call(VIEW, game); }, [], 'VIEW.init');
      if (UI.hooks.init) safe(UI.hooks.init, [game], 'UI.init');
    }
    VIEW_METHODS.forEach(function (name) {
      v[name] = function () {
        var args = arguments;
        if (dead()) return yieldTick();
        if (name === 'init') {
          if (inited) return Promise.resolve();
          inited = true;
          var fi = vfn('init');
          var pi = fi ? safe(function () { return fi.apply(VIEW, args); }, [], 'VIEW.init') : undefined;
          if (UI.hooks.init) safe(UI.hooks.init, [game], 'UI.init');
          return settle(pi, 'VIEW.init');
        }
        if (name !== 'log' && name !== 'wait') ensureInit();
        var f = vfn(name);
        var p1 = f ? safe(function () { return f.apply(VIEW, args); }, [], 'VIEW.' + name) : undefined;
        if (name === 'wait' && !f) {
          var ms = (+args[0] || 0) / (UI.getSpeed() || 1);
          p1 = new Promise(function (r) { setTimeout(r, ms); });
        }
        var h = UI.hooks[name];
        var p2 = h ? safe(function () { return h.apply(null, args); }, [], 'UI.' + name) : undefined;
        return Promise.all([settle(p1, 'VIEW.' + name), settle(p2, 'UI.' + name)]).then(function (r) { return r[0]; });
      };
    });
    return v;
  }

  function measureInsets() {
    var match = document.getElementById('match');
    if (!match || match.classList.contains('hidden')) return;
    var top = document.getElementById('hud-top'), bot = document.getElementById('hud-bottom');
    var stage = document.getElementById('stage');
    var sr = stage.getBoundingClientRect();
    var t = top ? Math.max(0, top.getBoundingClientRect().bottom - sr.top) : 0;
    var b = bot ? Math.max(0, sr.bottom - bot.getBoundingClientRect().top) : 0;
    var f = vfn('setInsets');
    if (f) safe(function () { f.call(VIEW, { top: Math.round(t), bottom: Math.round(b) }); }, [], 'VIEW.setInsets');
  }

  function rng() { return Math.random(); }

  function buildLoadouts(human) {
    var los = [Object.assign({}, human, { name: 'You', isHuman: true })];
    var names = BOT_NAMES.slice().sort(function () { return Math.random() - 0.5; });
    var used = { You: true };
    for (var i = 0; i < 7; i++) {
      var lo = null;
      try { lo = DATA.randomLoadout(rng); } catch (e) { console.error('randomLoadout', e); }
      if (!lo) {
        var cls = DATA.CLASS_IDS[Math.floor(Math.random() * DATA.CLASS_IDS.length)];
        lo = { cls: cls, variant: DATA.CLASSES[cls].variants[0].id, points: { hp: 4, atk: 2, def: 2, spd: 2 }, gb: DATA.CLASSES[cls].gamebreakers[0], deck: DATA.starterDeck(cls) };
      }
      if (!lo.name || lo.name === 'You' || used[lo.name]) lo.name = names.filter(function (n) { return !used[n]; })[0] || ('Bot ' + (i + 1));
      used[lo.name] = true;
      lo.isHuman = false;
      los.push(lo);
    }
    return los;
  }

  function startMatch(loadout) {
    lastLoadout = loadout;
    var token = ++matchToken;
    var stage = document.getElementById('stage'), overlay = document.getElementById('overlay');

    // Show the HUD first so the stage has its real size before VIEW mounts.
    document.getElementById('loadout').classList.add('hidden');
    document.getElementById('match').classList.remove('hidden');
    if (!mounted) {
      var mf = vfn('mount');
      if (mf) safe(function () { mf.call(VIEW, stage, overlay); }, [], 'VIEW.mount');
      mounted = true;
    }
    if (hasView) {
      VIEW.onTap = function (hit) { UI.onTileTap(hit); };
      var st = vfn('start'); if (st) safe(function () { st.call(VIEW); }, [], 'VIEW.start');
    }

    var loadouts = buildLoadouts(loadout);
    var humanCtl = UI.createHumanController();
    var controllers = loadouts.map(function (lo, i) {
      return i === 0 ? humanCtl : AI.createController({ delay: 400 });
    });
    var game;
    var view = null;
    var proxy = {};
    // The view needs the game for lazy init, so build it through a forwarding proxy.
    try {
      game = new CORE.Game({
        loadouts: loadouts, seed: (Math.random() * 0x7fffffff) | 0, view: proxy,
        controllers: controllers, humanIndex: 0
      });
    } catch (e) {
      console.error('Game construction failed', e);
      UI.showLoadout();
      return;
    }
    view = makeCompositeView(game, token);
    Object.keys(view).forEach(function (k) { proxy[k] = view[k]; });
    if (game.view !== proxy && game.view && typeof game.view === 'object') {
      Object.keys(view).forEach(function (k) { game.view[k] = view[k]; });
    }

    var hid = game.humanId != null && game.humanId >= 0 ? game.humanId : 0;
    var sh = vfn('setHumanId'); if (sh) safe(function () { sh.call(VIEW, hid); }, [], 'VIEW.setHumanId');
    var rm = vfn('setReducedMotion'); if (rm) safe(function () { rm.call(VIEW, isReduced()); }, [], 'VIEW.setReducedMotion');
    UI.startMatch(game, hid);
    requestAnimationFrame(measureInsets);
    setTimeout(measureInsets, 250);

    Promise.resolve().then(function () { return game.run(); }).catch(function (e) {
      console.error('game.run failed', e);
    });
  }

  function isReduced() { return !!(reducedMQ && reducedMQ.matches); }
  function applyReduced() {
    var r = isReduced();
    UI.setReducedMotion(r);
    var f = vfn('setReducedMotion'); if (f) safe(function () { f.call(VIEW, r); }, [], 'VIEW.setReducedMotion');
  }

  function boot() {
    try { reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { reducedMQ = null; }
    if (reducedMQ) {
      if (reducedMQ.addEventListener) reducedMQ.addEventListener('change', applyReduced);
      else if (reducedMQ.addListener) reducedMQ.addListener(applyReduced);
    }
    applyReduced();
    UI.initLoadout({
      reducedMotion: isReduced(),
      onPlay: startMatch,
      onPlayAgain: function () { if (lastLoadout) startMatch(lastLoadout); },
      onLeave: function () { matchToken++; }
    });
    window.addEventListener('resize', function () { requestAnimationFrame(measureInsets); });
    window.addEventListener('orientationchange', function () { setTimeout(measureInsets, 300); });
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { measureInsets(); });
      ['hud-top', 'hud-bottom'].forEach(function (id) { var el = document.getElementById(id); if (el) ro.observe(el); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { startMatch: startMatch, measureInsets: measureInsets };
})();
