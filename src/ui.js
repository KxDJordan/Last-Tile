var UI = (function () {
  'use strict';

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attempt(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { console.error(e); return fallback; } }
  function vcall(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof VIEW === 'undefined' || !VIEW || typeof VIEW[name] !== 'function') return undefined;
    try { return VIEW[name].apply(VIEW, args); } catch (e) { console.error('VIEW.' + name, e); return undefined; }
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function sameTile(a, b) { return !!a && !!b && a.x === b.x && a.y === b.y; }
  function hasTile(list, t) { return !!list && list.some(function (o) { return sameTile(o, t); }); }
  // Force text presentation for symbol glyphs so they never turn into emoji.
  function glyph(s) { return esc(s) + '︎'; }
  // Emphasise numbers in live card text.
  function liveText(s) {
    return String(s == null ? '' : s).split(/([+\u2212]?\d+(?:\.\d+)?%?)/).map(function (part, i) {
      return i % 2 ? '<b class="num">' + esc(part) + '</b>' : esc(part);
    }).join('');
  }
  function hexA(hex, a) {
    var h = String(hex || '#888').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var reduced = false;
  var speed = 1;
  var handlers = {};
  var STAT_KEYS = ['hp', 'atk', 'def', 'spd'];
  var STAT_INFO = {
    hp: { name: 'HP', desc: 'Max health. +5 per point', icon: '♥' },
    atk: { name: 'ATK', desc: 'Boosts most damage', icon: '⚔' },
    def: { name: 'DEF', desc: 'Reduces each hit taken', icon: '⛨' },
    spd: { name: 'SPD', desc: 'Turn order and agility', icon: '➤' }
  };
  var CLASS_GLYPH = { vanguard: '⛨', striker: '✦', marksman: '➶', phantom: '☽', lifebinder: '❦', hexer: '☠' };

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  var toastTimer = 0;
  function toast(msg, kind) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 1800);
  }

  // ------------------------------------------------------------------
  // Card face (shared by the hand, deck, cache and end screen)
  // ------------------------------------------------------------------
  function catOf(card) {
    return (DATA.CATEGORIES && DATA.CATEGORIES[card.cat]) || { name: card.cat || '?', color: '#9a8fd0', icon: '◆' };
  }
  function cardFace(card, stats, o) {
    o = o || {};
    var cat = catOf(card);
    var key = attempt(function () { return card.key ? card.key(stats) : ''; }, '');
    var cost = o.cost != null ? o.cost : card.cost;
    var cls = card.cls && card.cls !== 'general' && DATA.CLASSES[card.cls] ? DATA.CLASSES[card.cls] : null;
    var style = '--cc:' + cat.color + ';--cca:' + hexA(cat.color, 0.35) + ';' + (cls ? '--kc:' + cls.color + ';' : '') + (o.style || '');
    var costCls = o.costDelta < 0 ? ' cheap' : (o.costDelta > 0 ? ' dear' : '');
    return '<div class="tcg cat-' + esc(card.cat) + (cls ? ' is-class' : ' is-general') + (o.cls ? ' ' + o.cls : '') + '" style="' + style + '"' + (o.attrs || '') + '>' +
      '<div class="tcg-in">' +
        '<div class="tcg-art"><i class="tcg-ico">' + glyph(cat.icon) + '</i>' +
          '<b class="tcg-key' + (String(key).length > 3 ? ' long' : '') + '">' + esc(key) + '</b></div>' +
        '<div class="tcg-band">' + glyph(cat.icon) + ' ' + esc(cat.name) + '</div>' +
        '<div class="tcg-name">' + esc(card.name) + '</div>' +
        (cls ? '<i class="tcg-cls" title="' + esc(cls.name) + '"></i>' : '') +
      '</div>' +
      '<div class="tcg-gem' + costCls + '"><span>' + esc(cost) + '</span></div>' +
      (o.badge ? '<i class="tcg-badge">' + o.badge + '</i>' : '') +
      (card.temp || o.temp ? '<i class="tcg-temp">Temp</i>' : '') +
    '</div>';
  }

  // ------------------------------------------------------------------
  // LOADOUT
  // ------------------------------------------------------------------
  var LS_PRESETS = 'lasttile.presets.v1';
  var LS_LAST = 'lasttile.last.v1';
  var L = { clsIdx: 0, cls: null, variant: null, points: null, gb: null, deck: [], tab: 'stats', presets: null };
  var pedestal = null;
  var loadoutBuilt = false;

  function lsGet(k) { try { var s = window.localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function statInfo(k) {
    var d = DATA.STAT_INFO && DATA.STAT_INFO[k];
    var base = STAT_INFO[k];
    return d ? { name: d.name || base.name, desc: String(d.desc || base.desc).replace(/\.$/, ''), icon: base.icon } : base;
  }
  function defaultPoints() { return { hp: 4, atk: 2, def: 2, spd: 2 }; }
  function pointsUsed(p) { return STAT_KEYS.reduce(function (s, k) { return s + (p[k] | 0); }, 0); }
  function curStats() { return attempt(function () { return DATA.statsFromPoints(L.points); }, { maxHp: 20, atk: 1, def: 0, spd: 1, hpPts: 0 }); }

  function setClassById(clsId, keepDeck) {
    var idx = DATA.CLASS_IDS.indexOf(clsId);
    if (idx < 0) idx = 0;
    var c = DATA.CLASSES[DATA.CLASS_IDS[idx]];
    L.clsIdx = idx;
    L.cls = c.id;
    L.variant = c.variants[0].id;
    L.gb = c.gamebreakers[0];
    if (!keepDeck) L.deck = attempt(function () { return DATA.starterDeck(c.id).slice(); }, []);
  }

  function applyLoadout(lo) {
    if (!lo || !DATA.CLASSES[lo.cls]) return false;
    var c = DATA.CLASSES[lo.cls];
    setClassById(lo.cls, true);
    if (c.variants.some(function (v) { return v.id === lo.variant; })) L.variant = lo.variant;
    if (lo.points) {
      var p = {};
      STAT_KEYS.forEach(function (k) { p[k] = Math.max(0, Math.min(6, lo.points[k] | 0)); });
      L.points = p;
    }
    if (c.gamebreakers.indexOf(lo.gb) >= 0) L.gb = lo.gb;
    var deck = Array.isArray(lo.deck) ? lo.deck.filter(function (id) { return !!DATA.CARDS[id]; }) : [];
    L.deck = deck.length ? deck : DATA.starterDeck(c.id).slice();
    return true;
  }

  function getLoadout() {
    return { name: 'You', cls: L.cls, variant: L.variant, points: Object.assign({}, L.points), gb: L.gb, deck: L.deck.slice(), isHuman: true };
  }

  function initLoadout(opts) {
    handlers = opts || {};
    reduced = !!handlers.reducedMotion;
    L.points = defaultPoints();
    setClassById(DATA.CLASS_IDS[0], false);
    var last = lsGet(LS_LAST);
    if (last) applyLoadout(last);
    loadPresets();
    if (!loadoutBuilt) buildLoadoutDom();
    loadoutBuilt = true;
    renderLoadout();
    selectTab(L.tab, true);
    mountPedestal();
  }

  function loadPresets() {
    var p = lsGet(LS_PRESETS);
    if (!Array.isArray(p)) p = [];
    L.presets = [0, 1, 2, 3].map(function (i) {
      var s = p[i] || {};
      return { name: typeof s.name === 'string' && s.name ? s.name.slice(0, 18) : 'Slot ' + (i + 1), loadout: s.loadout || null };
    });
  }
  function savePresets() {
    if (!lsSet(LS_PRESETS, L.presets)) toast('Could not save. Storage unavailable', 'bad');
  }

  function buildLoadoutDom() {
    $('#lo-prev').addEventListener('click', function () { cycleClass(-1); });
    $('#lo-next').addEventListener('click', function () { cycleClass(1); });
    $$('#tabs [data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { selectTab(b.dataset.tab); });
    });
    $('#play').addEventListener('click', function () {
      var v = attempt(function () { return DATA.validateLoadout(getLoadout()); }, { ok: false, errors: ['Loadout error'] });
      if (!v.ok) { toast(v.errors[0] || 'Loadout invalid', 'bad'); return; }
      lsSet(LS_LAST, getLoadout());
      if (handlers.onPlay) handlers.onPlay(getLoadout());
    });
    // Swipe on the pedestal to change class.
    var stage = $('#lo-stage'), sx = 0, sy = 0, down = false;
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      down = true; sx = e.clientX; sy = e.clientY;
    });
    window.addEventListener('pointerup', function (e) {
      if (!down) return; down = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) cycleClass(dx < 0 ? 1 : -1);
    });
    window.addEventListener('pointercancel', function () { down = false; });
    window.addEventListener('resize', function () { if (pedestal && pedestal.resize) attempt(function () { pedestal.resize(); }); positionInk(); });

    // Delegated events for panes.
    $('#pane-stats').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-stat]');
      if (!b || b.disabled) return;
      var k = b.dataset.stat, d = +b.dataset.d;
      var nv = (L.points[k] | 0) + d;
      if (nv < 0 || nv > 6) return;
      if (d > 0 && pointsUsed(L.points) >= 10) return;
      L.points[k] = nv;
      pulse(b);
      renderStats(); renderGb(); renderDeck(); renderPlay();
    });
    $('#pane-gb').addEventListener('click', function (e) {
      var b = e.target.closest('[data-gb]');
      if (!b) return;
      L.gb = b.dataset.gb;
      renderGb(); renderPlay();
    });
    $('#pane-deck').addEventListener('click', function (e) {
      var r = e.target.closest('[data-reset]');
      if (r) { L.deck = DATA.starterDeck(L.cls).slice(); renderDeck(); renderPlay(); toast('Starter deck restored'); return; }
      var rm = e.target.closest('[data-rm]');
      if (rm) {
        var i = L.deck.lastIndexOf(rm.dataset.rm);
        if (i >= 0) L.deck.splice(i, 1);
        renderDeck(); renderPlay(); return;
      }
      var add = e.target.closest('[data-add]');
      if (add) {
        var id = add.dataset.add;
        var n = L.deck.filter(function (x) { return x === id; }).length;
        if (L.deck.length >= 16) { toast('Deck is full (16). Tap a deck card to remove it', 'bad'); return; }
        if (n >= 2) { toast('Max 2 copies of a card', 'bad'); return; }
        L.deck.push(id);
        pulse(add);
        renderDeck(); renderPlay();
      }
    });
    $('#pane-presets').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var i = +b.dataset.i, slot = L.presets[i];
      if (b.dataset.act === 'save') {
        var inp = $('#preset-name-' + i);
        slot.name = (inp && inp.value.trim()) || slot.name;
        slot.loadout = getLoadout();
        savePresets(); renderPresets(); toast('Saved to ' + slot.name);
      } else if (b.dataset.act === 'load' && slot.loadout) {
        var prevCls = L.cls;
        applyLoadout(slot.loadout);
        renderLoadout(prevCls !== L.cls ? 1 : 0);
        toast('Loaded ' + slot.name);
      } else if (b.dataset.act === 'clear') {
        slot.loadout = null; slot.name = 'Slot ' + (i + 1);
        savePresets(); renderPresets();
      }
    });
    $('#pane-presets').addEventListener('change', function (e) {
      var inp = e.target.closest('input[data-i]');
      if (!inp) return;
      var s = L.presets[+inp.dataset.i];
      s.name = inp.value.trim().slice(0, 18) || s.name;
      savePresets();
    });
  }

  function pulse(el) {
    if (reduced || !el) return;
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  }

  function mountPedestal() {
    var wrap = $('#lo-canvas-wrap');
    wrap.innerHTML = '';
    var cv = document.createElement('canvas');
    cv.id = 'pedestal';
    wrap.appendChild(cv);
    pedestal = null;
    if (typeof VIEW !== 'undefined' && VIEW && typeof VIEW.pedestal === 'function') {
      pedestal = attempt(function () { return VIEW.pedestal(cv); }, null);
    }
    $('#lo-fallback').classList.toggle('on', !pedestal);
    updatePedestal();
  }
  function disposePedestal() {
    if (pedestal && pedestal.dispose) attempt(function () { pedestal.dispose(); });
    pedestal = null;
  }
  function updatePedestal() {
    if (pedestal && pedestal.set) attempt(function () { pedestal.set(L.cls, L.variant, 0); });
    var c = DATA.CLASSES[L.cls];
    $('#lo-fallback').innerHTML = '<div class="fb-piece" style="--k:' + c.color + ';--k2:' + (c.color2 || c.color) + '"><i>' + glyph(CLASS_GLYPH[c.id] || '◆') + '</i></div>';
  }

  function cycleClass(dir) {
    var n = DATA.CLASS_IDS.length;
    var idx = (L.clsIdx + dir + n) % n;
    setClassById(DATA.CLASS_IDS[idx], false);
    renderLoadout(dir);
  }

  function renderLoadout(dir) {
    var c = DATA.CLASSES[L.cls];
    var root = $('#loadout');
    root.style.setProperty('--k', c.color);
    root.style.setProperty('--k2', c.color2 || c.color);
    root.style.setProperty('--ka', hexA(c.color, 0.45));
    var name = $('#lo-name');
    name.textContent = c.name;
    $('#lo-role').textContent = c.role || '';
    if (dir && !reduced) {
      var t = $('.lo-title');
      t.classList.remove('slide-l', 'slide-r'); void t.offsetWidth;
      t.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    }
    $('#lo-dots').innerHTML = DATA.CLASS_IDS.map(function (id, i) {
      return '<i class="' + (i === L.clsIdx ? 'on' : '') + '" style="--d:' + DATA.CLASSES[id].color + '"></i>';
    }).join('');
    $('#lo-passive').innerHTML = '<span class="pv-tag">Passive</span><b>' + esc(c.passiveName || 'Passive') + '</b> <span class="pv-text">' + esc(c.passiveText || '') + '</span>';
    renderVariants();
    renderStats(); renderGb(); renderDeck(); renderPresets(); renderPlay();
    updatePedestal();
  }

  function renderVariants() {
    var c = DATA.CLASSES[L.cls];
    var el = $('#lo-variants');
    el.innerHTML = c.variants.map(function (v) {
      var on = v.id === L.variant;
      return '<button role="radio" aria-checked="' + on + '" class="var-btn' + (on ? ' on' : '') + '" data-v="' + esc(v.id) + '" title="' + esc(v.desc || '') + '">' + esc(v.name) + '</button>';
    }).join('');
    $$('button', el).forEach(function (b) {
      b.addEventListener('click', function () { L.variant = b.dataset.v; renderVariants(); updatePedestal(); });
    });
  }

  function renderStats() {
    var used = pointsUsed(L.points), left = 10 - used;
    var st = curStats();
    var vals = { hp: st.maxHp, atk: st.atk, def: st.def, spd: st.spd };
    var html = '<div class="pts-head' + (left === 0 ? ' done' : (left < 0 ? ' over' : '')) + '">' +
      '<div><small>Points remaining</small><b class="pts-num">' + left + '</b><span class="pts-of">/ 10</span></div>' +
      '<div class="pts-hint">' + (left > 0 ? 'Spend all 10. Max 6 per stat' : left < 0 ? 'Too many points spent' : 'All points spent') + '</div></div>';
    html += STAT_KEYS.map(function (k) {
      var p = L.points[k] | 0, info = statInfo(k);
      var pips = '';
      for (var i = 0; i < 6; i++) pips += '<i class="' + (i < p ? 'on' : '') + '"></i>';
      return '<div class="stat-row s-' + k + '">' +
        '<div class="stat-id"><span class="stat-ico">' + glyph(info.icon) + '</span><div><b>' + info.name + '</b><small>' + esc(info.desc) + '</small></div></div>' +
        '<div class="stat-ctl">' +
          '<button class="round-btn" data-stat="' + k + '" data-d="-1" aria-label="Decrease ' + info.name + '"' + (p <= 0 ? ' disabled' : '') + '>−</button>' +
          '<div class="pips">' + pips + '</div>' +
          '<button class="round-btn" data-stat="' + k + '" data-d="1" aria-label="Increase ' + info.name + '"' + (p >= 6 || left <= 0 ? ' disabled' : '') + '>+</button>' +
        '</div>' +
        '<div class="stat-val"><small>' + info.name + '</small><b>' + vals[k] + '</b></div>' +
      '</div>';
    }).join('');
    $('#pane-stats').innerHTML = html;
    var badge = $('#tb-stats');
    badge.textContent = left !== 0 ? String(left) : '';
    badge.classList.toggle('on', left !== 0);
  }

  function renderGb() {
    var c = DATA.CLASSES[L.cls], st = curStats();
    $('#pane-gb').innerHTML = '<p class="pane-intro">Your ultimate. Charge the Break meter by hitting, getting hit, opening caches and surviving ring closes.</p>' +
      c.gamebreakers.map(function (id) {
        var g = DATA.GAMEBREAKERS[id];
        if (!g) return '';
        var on = id === L.gb;
        return '<button class="gb-opt' + (on ? ' on' : '') + '" data-gb="' + esc(id) + '" aria-pressed="' + on + '">' +
          '<div class="gb-opt-head"><b>' + esc(g.name) + '</b><span class="gb-cost"><i>⚡︎</i>' + esc(g.cost) + '</span></div>' +
          '<p>' + liveText(attempt(function () { return g.text(st); }, '')) + '</p>' +
          (on ? '<span class="gb-check">Equipped</span>' : '') +
        '</button>';
      }).join('');
  }

  function renderDeck() {
    var st = curStats();
    var v = attempt(function () { return DATA.validateDeck(L.cls, L.deck); }, { ok: false, errors: [], counts: {} });
    var cnt = v.counts || {};
    function chip(label, val, ok) { return '<span class="rule ' + (ok ? 'ok' : 'bad') + '"><i>' + (ok ? '✓' : '!') + '</i>' + label + ' <b>' + val + '</b></span>'; }
    var cats = DATA.CATEGORIES;
    var rules = chip('Cards', L.deck.length + '/16', L.deck.length === 16) +
      chip('Class', (cnt['class'] | 0) + ' (10+)', (cnt['class'] | 0) >= 10) +
      chip('General', (cnt.general | 0) + ' (≤6)', (cnt.general | 0) <= 6);
    var catChips = Object.keys(cats).map(function (k) {
      var n = cnt[k] | 0;
      return '<span class="rule cat ' + (n >= 2 ? 'ok' : 'bad') + '" style="--cc:' + cats[k].color + '"><i>' + glyph(cats[k].icon) + '</i>' + esc(cats[k].name) + ' <b>' + n + '</b></span>';
    }).join('');

    // Group the deck by card id, keeping the pool order.
    var pool = attempt(function () { return DATA.cardPool(L.cls); }, Object.keys(DATA.CARDS));
    var order = pool.slice();
    L.deck.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    var counts = {};
    L.deck.forEach(function (id) { counts[id] = (counts[id] | 0) + 1; });
    var deckHtml = order.filter(function (id) { return counts[id]; }).map(function (id) {
      var card = DATA.CARDS[id];
      return '<button class="deck-card" data-rm="' + esc(id) + '" aria-label="Remove ' + esc(card.name) + '">' +
        cardFace(card, st, { badge: counts[id] > 1 ? '×' + counts[id] : '' }) + '</button>';
    }).join('');
    var poolHtml = pool.map(function (id) {
      var card = DATA.CARDS[id];
      if (!card) return '';
      var cat = catOf(card), n = counts[id] | 0;
      var full = n >= 2 || L.deck.length >= 16;
      return '<button class="pool-row' + (n >= 2 ? ' maxed' : '') + (full ? ' full' : '') + '" data-add="' + esc(id) + '" style="--cc:' + cat.color + '">' +
        '<span class="pr-gem"><i>' + esc(card.cost) + '</i></span>' +
        '<span class="pr-main"><span class="pr-top"><b>' + esc(card.name) + '</b><em class="pr-cat">' + glyph(cat.icon) + ' ' + esc(cat.name) + '</em>' +
          (card.cls === 'general' ? '<em class="pr-gen">General</em>' : '') + '</span>' +
          '<span class="pr-text">' + liveText(attempt(function () { return card.text(st); }, '')) + '</span></span>' +
        '<span class="pr-count' + (n ? ' has' : '') + '"><i>' + n + '/2</i><b>+</b></span>' +
      '</button>';
    }).join('');

    $('#pane-deck').innerHTML =
      '<div class="rules">' + rules + catChips + '</div>' +
      '<div class="sec-head"><h3>Your deck <small>tap to remove</small></h3><button class="link-btn" data-reset="1">Reset to starter</button></div>' +
      '<div class="deck-grid">' + (deckHtml || '<p class="empty">Deck is empty. Add cards from the pool below.</p>') + '</div>' +
      '<div class="sec-head"><h3>Card pool <small>tap to add</small></h3></div>' +
      '<div class="pool">' + poolHtml + '</div>';
    var badge = $('#tb-deck');
    badge.textContent = v.ok ? '' : '!';
    badge.classList.toggle('on', !v.ok);
  }

  function renderPresets() {
    var html = '<p class="pane-intro">Save up to 4 loadouts on this device. Saving stores class, piece, stats, Gamebreaker and deck.</p>';
    html += L.presets.map(function (s, i) {
      var lo = s.loadout, sum = 'Empty slot';
      if (lo && DATA.CLASSES[lo.cls]) {
        var c = DATA.CLASSES[lo.cls];
        var vr = c.variants.filter(function (x) { return x.id === lo.variant; })[0];
        var g = DATA.GAMEBREAKERS[lo.gb];
        sum = '<i class="ps-dot" style="background:' + c.color + '"></i>' + esc(c.name) + ' · ' + esc(vr ? vr.name : '') +
          '<br><span class="ps-stats">HP ' + (lo.points.hp | 0) + ' · ATK ' + (lo.points.atk | 0) + ' · DEF ' + (lo.points.def | 0) + ' · SPD ' + (lo.points.spd | 0) + (g ? ' · ' + esc(g.name) : '') + '</span>';
      }
      return '<div class="preset' + (lo ? ' filled' : '') + '">' +
        '<input id="preset-name-' + i + '" data-i="' + i + '" maxlength="18" value="' + esc(s.name) + '" aria-label="Preset name">' +
        '<div class="ps-sum">' + sum + '</div>' +
        '<div class="ps-btns">' +
          '<button class="chip-btn gold" data-act="save" data-i="' + i + '">Save</button>' +
          '<button class="chip-btn" data-act="load" data-i="' + i + '"' + (lo ? '' : ' disabled') + '>Load</button>' +
          (lo ? '<button class="chip-btn ghost" data-act="clear" data-i="' + i + '" aria-label="Clear slot">✕</button>' : '') +
        '</div></div>';
    }).join('');
    $('#pane-presets').innerHTML = html;
  }

  function renderPlay() {
    var v = attempt(function () { return DATA.validateLoadout(getLoadout()); }, { ok: false, errors: ['Loadout error'] });
    var b = $('#play');
    b.classList.toggle('disabled', !v.ok);
    b.setAttribute('aria-disabled', String(!v.ok));
    $('#play-reason').textContent = v.ok ? '' : (v.errors[0] || 'Loadout invalid');
  }

  function selectTab(tab, instant) {
    L.tab = tab;
    var tabs = $$('#tabs [data-tab]');
    tabs.forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    var idx = tabs.map(function (b) { return b.dataset.tab; }).indexOf(tab);
    $$('#tab-body .pane').forEach(function (p, i) {
      p.classList.toggle('on', p.dataset.pane === tab);
      p.classList.toggle('left', i < idx);
      p.classList.toggle('right', i > idx);
    });
    $('#tab-body').scrollTop = 0;
    $$('#tab-body .pane').forEach(function (p) { p.scrollTop = 0; });
    positionInk(instant);
  }
  function positionInk(instant) {
    var on = $('#tabs [data-tab].on'), ink = $('#tab-ink');
    if (!on || !ink) return;
    if (instant) ink.style.transition = 'none';
    ink.style.width = on.offsetWidth - 16 + 'px';
    ink.style.transform = 'translateX(' + (on.offsetLeft + 8) + 'px)';
    if (instant) { void ink.offsetWidth; ink.style.transition = ''; }
  }

  function showLoadout() {
    closeModal();
    $('#match').classList.add('hidden');
    $('#loadout').classList.remove('hidden');
    $('#spectate-chip').classList.add('hidden');
    vcall('stop');
    mountPedestal();
    renderLoadout();
    selectTab(L.tab, true);
  }

  // ------------------------------------------------------------------
  // MATCH HUD
  // ------------------------------------------------------------------
  var M = {
    game: null, humanId: -1, turn: null, sel: null, busy: false, inspect: null,
    logOpen: false, rafPending: false, elimOffered: false, spectating: false, abandoned: false,
    lastBanner: { text: '', t: 0 }, bannerQ: [], bannerBusy: false, hudBuilt: false, portraits: {}
  };

  function human() { return M.game && M.humanId >= 0 ? M.game.players[M.humanId] : null; }
  function myTurn() { return !!M.turn && !M.busy && !M.abandoned; }

  function buildHudDom() {
    if (M.hudBuilt) return;
    M.hudBuilt = true;
    $('#btn-end').addEventListener('click', function () { press(this); endTurn(); });
    $('#btn-move').addEventListener('click', function () { press(this); onMoveButton(); });
    $('#btn-gb').addEventListener('click', function () { press(this); onGbButton(); });
    $('#ht-speed').addEventListener('click', function () { setSpeed(speed === 2 ? 1 : 2); });
    $('#ht-menu').addEventListener('click', openMenu);
    $('#log-toggle').addEventListener('click', toggleLog);
    $('#log-lines').addEventListener('click', toggleLog);
    $('#spec-leave').addEventListener('click', leaveMatch);
    $('#hand').addEventListener('click', function (e) {
      var c = e.target.closest('[data-uid]');
      if (!c) return;
      onCardTap(c.dataset.uid);
    });
    $('#detail').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-d]');
      if (!b || b.disabled) return;
      press(b);
      if (b.dataset.d === 'cancel') cancelSel();
      else if (b.dataset.d === 'confirm') commitSel();
    });
    document.addEventListener('keydown', function (e) {
      if ($('#match').classList.contains('hidden')) return;
      if (e.key === 'Escape') cancelSel();
      else if (e.key === 'Enter' && M.sel) commitSel();
    });
    window.addEventListener('resize', function () { scheduleRender(); });
  }

  function press(el) {
    if (reduced || !el) return;
    el.classList.remove('pressed'); void el.offsetWidth; el.classList.add('pressed');
  }

  function setSpeed(s) {
    speed = s;
    vcall('setSpeed', s);
    var b = $('#ht-speed');
    b.classList.toggle('on', s === 2);
    b.setAttribute('aria-pressed', String(s === 2));
    $('span', b).textContent = s + '×';
  }

  function startMatch(game, humanId) {
    buildHudDom();
    disposePedestal();
    M.game = game; M.humanId = humanId == null ? (game.humanId != null ? game.humanId : 0) : humanId;
    M.turn = null; M.sel = null; M.busy = false; M.inspect = null; M.elimOffered = false;
    M.spectating = false; M.abandoned = false; M.bannerQ = []; M.portraits = {};
    $('#banners').innerHTML = '';
    $('#log-lines').innerHTML = '';
    M.logLines = [];
    M.logOpen = false; $('#log').classList.remove('open');
    renderLog();
    closeModal();
    $('#loadout').classList.add('hidden');
    $('#match').classList.remove('hidden');
    $('#spectate-chip').classList.add('hidden');
    $('#detail').classList.add('hidden');
    $('#log').classList.remove('hidden');
    setSpeed(1);
    var me = human();
    if (me) {
      var g = DATA.GAMEBREAKERS[me.gb];
      $('#gb-icon').textContent = CLASS_GLYPH[me.cls] ? CLASS_GLYPH[me.cls] + '︎' : '✦';
      $('#btn-gb').style.setProperty('--k', DATA.CLASSES[me.cls].color);
      $('#btn-gb').setAttribute('aria-label', 'Gamebreaker: ' + (g ? g.name : ''));
    }
    renderHud();
  }

  function stage() { return $('#stage'); }
  function overlay() { return $('#overlay'); }

  function scheduleRender() {
    if (M.rafPending) return;
    M.rafPending = true;
    requestAnimationFrame(function () { M.rafPending = false; renderHud(); });
  }

  function renderHud() {
    if (!M.game) return;
    renderTop(); renderHand(); renderBar(); renderDetail();
    checkElimination();
  }

  function portraitSrc(p) {
    var key = p.cls + '|' + p.variant + '|' + p.colorIndex;
    if (M.portraits[key] === undefined) {
      M.portraits[key] = attempt(function () { return VIEW && VIEW.portrait ? VIEW.portrait(p.cls, p.variant, p.colorIndex) : null; }, null) || null;
    }
    return M.portraits[key];
  }
  function portraitHTML(p, extra) {
    var c = DATA.CLASSES[p.cls] || { color: '#888' };
    var src = portraitSrc(p);
    var team = p.color || (DATA.TEAM_COLORS && DATA.TEAM_COLORS[p.colorIndex]) || c.color;
    return '<span class="pt ' + (extra || '') + '" style="--k:' + c.color + ';--t:' + team + '">' +
      (src ? '<img alt="" src="' + src + '">' : '<i>' + glyph(CLASS_GLYPH[p.cls] || '◆') + '</i>') + '</span>';
  }

  function renderTop() {
    var g = M.game;
    $('#ht-round').textContent = g.round || 1;
    var ring = $('#ht-ring'), pill = $('#ht-ring-pill');
    var n = g.nextRingIn, sn = g.nextSurgeIn;
    var surge = n == null && sn != null;
    pill.classList.toggle('warn', n === 1 || n === 0 || (surge && sn <= 1));
    pill.classList.toggle('final', n == null && !surge);
    pill.classList.toggle('surge', surge || (g.surges | 0) > 0);
    if (n != null) ring.textContent = n <= 0 ? 'Ring closing!' : n === 1 ? 'Ring next round' : 'Ring in ' + n;
    else if (surge) ring.textContent = sn <= 0 ? 'Rot surging!' : sn === 1 ? ((g.surges | 0) ? 'Surge next round' : 'Sudden death next') : ((g.surges | 0) ? 'Surge in ' + sn : 'Sudden death in ' + sn);
    else ring.textContent = (g.surges | 0) ? 'Sudden death' : 'Final ring';
    var alive = g.players.filter(function (p) { return p.alive; }).length;
    $('#ht-alive').textContent = alive;
    var order = (g.turnOrder || []).slice();
    g.players.forEach(function (p) { if (order.indexOf(p) < 0) order.push(p); });
    order.sort(function (a, b) { return (b.alive ? 1 : 0) - (a.alive ? 1 : 0); });
    var html = order.map(function (p) {
      var cls = (p.alive ? '' : 'dead ') + (g.active === p ? 'active ' : '') + (p.id === M.humanId ? 'me ' : '');
      var hpPct = p.maxHp ? Math.max(0, Math.min(100, p.hp / p.maxHp * 100)) : 0;
      return '<div class="st-item ' + cls + '" title="' + esc(p.name) + '">' + portraitHTML(p) +
        '<i class="st-hp"><b style="width:' + hpPct + '%"></b></i>' +
        (p.id === M.humanId ? '<em>You</em>' : '') + '</div>';
    }).join('');
    var strip = $('#ht-strip');
    if (strip._html !== html) { strip.innerHTML = html; strip._html = html; }
  }

  function handCards() {
    var me = human();
    return me ? (me.hand || []) : [];
  }

  function renderHand() {
    var me = human(), el = $('#hand');
    if (!me) { el.innerHTML = ''; return; }
    var st = attempt(function () { return M.game.stats(me); }, curStats());
    var cards = handCards();
    var n = cards.length;
    var W = el.clientWidth || 360;
    var cw = Math.min(76, Math.max(60, (W - 16) / 4.8));
    var step = n > 1 ? Math.min(cw + 4, (W - cw - 30) / (n - 1)) : 0;
    var selUid = M.sel && M.sel.kind === 'card' ? M.sel.uid : (M.inspect && M.inspect.kind === 'card' ? M.inspect.uid : null);
    var turn = !!M.turn;
    var html = cards.map(function (hc, i) {
      var card = DATA.CARDS[hc.id];
      if (!card) return '';
      var off = i - (n - 1) / 2;
      var rot = n > 1 ? off * Math.min(5, 26 / n) : 0;
      var lift = Math.abs(off) * Math.abs(off) * 1.6;
      var left = W / 2 + off * step - cw / 2;
      var can = turn ? attempt(function () { return M.game.canPlay(me, hc.uid); }, { ok: false }) : { ok: true };
      var cost = attempt(function () { return M.game.cardCost ? M.game.cardCost(me, hc.uid) : card.cost; }, card.cost);
      var sel = selUid === hc.uid;
      var tr = sel ? 'translate(' + left + 'px,-16px) rotate(0deg) scale(1.08)' : 'translate(' + left + 'px,' + lift + 'px) rotate(' + rot + 'deg)';
      var cls = 'hand-card' + (turn && !can.ok ? ' dim' : '') + (turn && can.ok ? ' playable' : '') + (sel ? ' sel' : '');
      return '<button class="' + cls + '" data-uid="' + esc(hc.uid) + '" style="--w:' + cw + 'px;transform:' + tr + ';z-index:' + (sel ? 50 : i + 1) + '" aria-label="' + esc(card.name) + '">' +
        cardFace(Object.assign({}, card, { temp: hc.temp }), st, { cost: cost, costDelta: cost - card.cost }) + '</button>';
    }).join('');
    if (!n) html = '<div class="hand-empty">No cards in hand</div>';
    if (!me.alive) html = '<div class="hand-empty dead-msg"><b>Eliminated \u2014 ' + ordinal(me.place || 8) + '</b><span>' + (M.spectating ? 'Spectating at 2\u00D7 speed' : 'The arena fights on') + '</span></div>';
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  }

  function renderBar() {
    var me = human(); if (!me) return;
    var g = M.game;
    var hpPct = me.maxHp ? Math.max(0, me.hp / me.maxHp * 100) : 0;
    $('#hp-fill').style.width = hpPct + '%';
    $('#hp-fill').classList.toggle('low', hpPct <= 30);
    $('#hp-shield').style.width = Math.min(100, (me.shield || 0) / (me.maxHp || 1) * 100) + '%';
    $('#hp-text').textContent = Math.max(0, me.hp) + ' / ' + me.maxHp + (me.shield ? '  ⛨' + me.shield : '');
    var en = '', maxE = Math.max(me.maxEnergy || 3, me.energy || 0);
    for (var i = 0; i < maxE; i++) en += '<i class="' + (i < me.energy ? 'on' : '') + '"></i>';
    en += '<b>' + (me.energy | 0) + '</b>';
    var eEl = $('#energy');
    if (eEl._html !== en) { eEl.innerHTML = en; eEl._html = en; }

    var gb = DATA.GAMEBREAKERS[me.gb], cost = gb ? gb.cost : 100;
    var pct = Math.max(0, Math.min(100, (me.meter || 0) / cost * 100));
    var gbBtn = $('#btn-gb');
    gbBtn.style.setProperty('--pct', pct.toFixed(1));
    var ready = pct >= 100 && !me.gbUsedThisTurn;
    gbBtn.classList.toggle('ready', ready);
    gbBtn.classList.toggle('used', !!me.gbUsedThisTurn);
    gbBtn.classList.toggle('sel', !!(M.sel && M.sel.kind === 'gb'));
    $('#gb-pct').textContent = (me.meter | 0) + '/' + cost;

    var turn = !!M.turn && !M.abandoned;
    var walk = turn ? attempt(function () { return g.walkTargets(me); }, []) : [];
    var mv = $('#btn-move');
    mv.disabled = !turn || M.busy || !walk.length;
    mv.classList.toggle('on', !!(M.sel && M.sel.kind === 'move'));
    $('#btn-end').disabled = !turn || M.busy;
    $('#btn-end').classList.toggle('glow', turn && !M.busy && !anyPlayable());
    $('#hud-bottom').classList.toggle('my-turn', turn);
    $('#hud-bottom').classList.toggle('busy', M.busy);
    $('#hud-bottom').classList.toggle('dead', !me.alive);
  }

  function anyPlayable() {
    var me = human();
    if (!me || !M.turn) return false;
    var cardOk = handCards().some(function (hc) { return attempt(function () { return M.game.canPlay(me, hc.uid).ok; }, false); });
    var gbOk = attempt(function () { return M.game.canUseGb(me).ok; }, false);
    var walk = attempt(function () { return M.game.walkTargets(me).length > 0; }, false);
    return cardOk || gbOk || walk;
  }

  // ---------- detail panel ----------
  function renderDetail() {
    var d = $('#detail'), log = $('#log');
    var s = M.sel || M.inspect;
    if (!s) { d.classList.add('hidden'); log.classList.remove('hidden'); d._html = ''; return; }
    var me = human();
    var st = attempt(function () { return M.game.stats(me); }, curStats());
    var title, cat, cost, text, color, reason = '', status = '', canConfirm = false;
    if (s.kind === 'card') {
      var hc = handCards().filter(function (c) { return c.uid === s.uid; })[0];
      if (!hc) { M.sel = null; M.inspect = null; d.classList.add('hidden'); log.classList.remove('hidden'); return; }
      var card = DATA.CARDS[hc.id], c = catOf(card);
      title = card.name; color = c.color;
      cat = glyph(c.icon) + ' ' + esc(c.name);
      cost = attempt(function () { return M.game.cardCost(me, hc.uid); }, card.cost);
      text = attempt(function () { return card.text(st); }, '');
    } else if (s.kind === 'gb') {
      var g = DATA.GAMEBREAKERS[me.gb];
      title = g ? g.name : 'Gamebreaker'; color = '#ffc94d';
      cat = 'Gamebreaker'; cost = '⚡︎' + (g ? g.cost : '');
      text = g ? attempt(function () { return g.text(st); }, '') : '';
    } else {
      title = 'Move'; color = '#38d6ff'; cat = 'Stance'; cost = '';
      text = 'Walk up to 2 tiles, then draw 1 card. Ends your turn.';
    }
    if (M.sel) {
      if (s.blocked) reason = s.blocked;
      else if (s.pickCount === 0) { status = 'Self-targeted. Confirm to play'; canConfirm = true; }
      else if (!s.targets || !s.targets.length) reason = 'No valid targets';
      else if (s.pending) { status = 'Tap the tile again or Confirm'; canConfirm = true; }
      else status = s.pickCount > 1 ? 'Pick tile ' + (s.picks.length + 1) + ' of ' + s.pickCount : (s.kind === 'move' ? 'Tap a highlighted tile' : 'Tap a highlighted tile to aim');
    } else {
      status = M.inspect.note || (M.turn ? '' : 'Not your turn');
    }
    var html = '<div class="dt-card" style="--cc:' + color + '">' +
      '<div class="dt-head">' + (cost !== '' ? '<span class="dt-gem">' + cost + '</span>' : '') +
        '<div class="dt-title"><b>' + esc(title) + '</b><small>' + cat + '</small></div></div>' +
      '<p class="dt-text">' + liveText(text) + '</p>' +
      '<div class="dt-foot"><span class="dt-status' + (reason ? ' bad' : '') + '">' + esc(reason || status) + '</span>' +
        '<div class="dt-btns"><button class="dt-btn ghost" data-d="cancel">' + (M.sel ? 'Cancel' : 'Close') + '</button>' +
        (M.sel ? '<button class="dt-btn go" data-d="confirm"' + (canConfirm ? '' : ' disabled') + '>Confirm</button>' : '') +
      '</div></div></div>';
    if (d._html !== html) { d.innerHTML = html; d._html = html; }
    d.classList.remove('hidden');
    log.classList.add('hidden');
  }

  // ---------- log ----------
  function addLog(text) {
    M.logLines = M.logLines || [];
    M.logLines.push(String(text));
    if (M.logLines.length > 200) M.logLines.shift();
    renderLog();
  }
  function renderLog() {
    var lines = M.logLines || [];
    var show = M.logOpen ? lines.slice(-60) : lines.slice(-3);
    var el = $('#log-lines');
    el.innerHTML = show.map(function (l, i) {
      return '<div class="ll' + (i === show.length - 1 ? ' new' : '') + '">' + esc(l) + '</div>';
    }).join('') || '<div class="ll muted">The arena awaits…</div>';
    el.scrollTop = el.scrollHeight;
  }
  function toggleLog() {
    M.logOpen = !M.logOpen;
    $('#log').classList.toggle('open', M.logOpen);
    $('#log-toggle').setAttribute('aria-label', M.logOpen ? 'Collapse log' : 'Expand log');
    renderLog();
  }

  // ---------- banners ----------
  function banner(text, kind) {
    var now = Date.now();
    if (M.lastBanner.text === text && now - M.lastBanner.t < 1500) return Promise.resolve();
    M.lastBanner = { text: text, t: now };
    M.bannerQ.push({ text: text, kind: kind || 'info' });
    if (M.bannerQ.length > 3) M.bannerQ.splice(0, M.bannerQ.length - 3);
    pumpBanners();
    return new Promise(function (r) { setTimeout(r, 200); });
  }
  function pumpBanners() {
    if (M.bannerBusy || !M.bannerQ.length) return;
    M.bannerBusy = true;
    var b = M.bannerQ.shift();
    var el = document.createElement('div');
    el.className = 'banner b-' + b.kind;
    var sub = { turn: 'Your move', ring: 'Corruption', gb: 'Gamebreaker', elim: 'Eliminated', info: '' }[b.kind] || '';
    el.innerHTML = (sub && b.kind !== 'turn' ? '<small>' + sub + '</small>' : '') + '<b>' + esc(b.text) + '</b>';
    $('#banners').appendChild(el);
    var dur = (b.kind === 'gb' ? 1500 : 1150) / speed;
    if (reduced) dur = Math.max(dur, 900);
    void el.offsetWidth;
    el.classList.add('in');
    setTimeout(function () {
      el.classList.remove('in'); el.classList.add('out');
      setTimeout(function () { el.remove(); M.bannerBusy = false; pumpBanners(); }, reduced ? 120 : 280);
    }, dur);
  }

  // ---------- highlight ----------
  function highlightFor(s) {
    if (!s) { idleHighlight(); return; }
    var area = (s.area || []).slice();
    if (s.pending && !hasTile(area, s.pending)) area.push(s.pending);
    vcall('highlight', { targets: s.targets || [], area: area, color: s.color });
  }
  function idleHighlight() {
    var me = human();
    if (myTurn() && me) {
      var walk = attempt(function () { return M.game.walkTargets(me); }, []);
      if (walk.length) { vcall('highlight', { targets: walk, area: [], color: '#9fe8ff' }); return; }
    }
    vcall('clearHighlight');
  }

  // ---------- selection flow ----------
  function onCardTap(uidStr) {
    var me = human(); if (!me) return;
    var found = handCards().filter(function (c) { return String(c.uid) === String(uidStr); })[0];
    if (!found) return;
    var uid = found.uid;
    if (M.sel && M.sel.kind === 'card' && M.sel.uid === uid) { cancelSel(); return; }
    if (!myTurn()) {
      // Inspect only.
      M.inspect = M.inspect && M.inspect.uid === uid ? null : { kind: 'card', uid: uid, note: M.busy ? 'Resolving…' : (M.turn ? '' : 'Not your turn') };
      renderHud();
      return;
    }
    M.inspect = null;
    var hc = handCards().filter(function (c) { return c.uid === uid; })[0];
    if (!hc) return;
    var card = DATA.CARDS[hc.id];
    var can = attempt(function () { return M.game.canPlay(me, uid); }, { ok: false, reason: 'Cannot play' });
    var g = M.game;
    var sel = {
      kind: 'card', uid: uid, picks: [], pending: null, pickCount: card.pickCount | 0, color: catOf(card).color,
      blocked: can.ok ? '' : (can.reason || 'Cannot play'),
      targetsFn: function (picks) { return attempt(function () { return g.cardTargets(me, uid, picks); }, []); },
      areaFn: function (picks) { return attempt(function () { return g.cardArea(me, uid, picks); }, []); },
      exec: function (picks) { return g.playCard(me, uid, picks); }
    };
    beginSel(sel);
  }

  function onGbButton() {
    var me = human(); if (!me) return;
    if (M.sel && M.sel.kind === 'gb') { cancelSel(); return; }
    if (!myTurn()) {
      M.inspect = M.inspect && M.inspect.kind === 'gb' ? null : { kind: 'gb', note: M.turn ? '' : 'Not your turn' };
      renderHud();
      return;
    }
    var gb = DATA.GAMEBREAKERS[me.gb];
    var can = attempt(function () { return M.game.canUseGb(me); }, { ok: false, reason: 'Unavailable' });
    var g = M.game;
    beginSel({
      kind: 'gb', picks: [], pending: null, pickCount: gb ? gb.pickCount | 0 : 0, color: '#ffc94d',
      blocked: can.ok ? '' : (can.reason || 'Not charged'),
      targetsFn: function (picks) { return attempt(function () { return g.gbTargets(me, picks); }, []); },
      areaFn: function (picks) { return attempt(function () { return g.gbArea(me, picks); }, []); },
      exec: function (picks) { return g.useGb(me, picks); }
    });
  }

  function onMoveButton(pendingTile) {
    var me = human(); if (!me || !myTurn()) return;
    if (M.sel && M.sel.kind === 'move' && !pendingTile) { cancelSel(); return; }
    var g = M.game;
    var walk = attempt(function () { return g.walkTargets(me); }, []);
    beginSel({
      kind: 'move', picks: [], pending: pendingTile || null, pickCount: 1, color: '#38d6ff',
      blocked: walk.length ? '' : (me.stance === 'act' ? 'Already acted this turn' : 'Cannot move'),
      targetsFn: function () { return walk; },
      areaFn: function (picks) { return picks.slice(-1); },
      exec: function (picks) { return g.doMove(me, picks[0]); },
      endsTurn: true
    });
  }

  function beginSel(sel) {
    M.inspect = null;
    M.sel = sel;
    if (!sel.blocked) {
      sel.targets = sel.pickCount > 0 ? sel.targetsFn([]) : [];
      sel.area = sel.pickCount === 0 ? sel.areaFn([]) : (sel.pending ? sel.areaFn([sel.pending]) : []);
      highlightFor(sel);
    } else {
      sel.targets = []; sel.area = [];
      vcall('clearHighlight');
    }
    renderHud();
  }

  function cancelSel() {
    if (M.inspect) { M.inspect = null; renderHud(); return; }
    if (!M.sel) return;
    M.sel = null;
    idleHighlight();
    renderHud();
  }

  function onTileTap(hit) {
    if (!M.game || M.abandoned) return;
    var t = hit && (hit.tile || (hit.entity ? { x: hit.entity.x, y: hit.entity.y } : null));
    if (!t || !myTurn()) return;
    var s = M.sel;
    if (!s) {
      var me = human();
      var walk = attempt(function () { return M.game.walkTargets(me); }, []);
      if (hasTile(walk, t)) onMoveButton({ x: t.x, y: t.y });
      return;
    }
    if (s.blocked) return;
    if (!hasTile(s.targets, t)) {
      if (s.pickCount > 0) toast('Pick a highlighted tile');
      return;
    }
    if (s.pending && sameTile(s.pending, t)) { commitSel(); return; }
    s.pending = { x: t.x, y: t.y };
    s.area = s.areaFn(s.picks.concat([s.pending]));
    highlightFor(s);
    renderHud();
  }

  function commitSel() {
    var s = M.sel;
    if (!s || s.blocked || !myTurn()) return;
    if (s.pickCount > 0) {
      if (!s.pending) return;
      s.picks.push(s.pending);
      s.pending = null;
      if (s.picks.length < s.pickCount) {
        s.targets = s.targetsFn(s.picks);
        s.area = s.areaFn(s.picks);
        highlightFor(s);
        renderHud();
        return;
      }
    }
    execSel(s);
  }

  function execSel(s) {
    var me = human();
    M.sel = null;
    M.busy = true;
    vcall('clearHighlight');
    renderHud();
    var p;
    try { p = Promise.resolve(s.exec(s.picks)); } catch (e) { p = Promise.reject(e); }
    p.catch(function (e) { console.error(e); toast('Action failed', 'bad'); return false; }).then(function (res) {
      M.busy = false;
      if (res === false) toast('That move isn\u2019t allowed', 'bad');
      if (!M.turn) { renderHud(); return; }
      if ((s.endsTurn && res !== false) || !me.alive || M.game.over) { finishTurn(); return; }
      idleHighlight();
      renderHud();
    });
  }

  function endTurn() {
    if (!M.turn || M.busy) return;
    finishTurn();
  }
  function finishTurn() {
    var t = M.turn;
    M.turn = null; M.sel = null; M.inspect = null;
    vcall('clearHighlight');
    renderHud();
    if (t) t.resolve();
  }

  // ---------- human controller ----------
  function createHumanController() {
    return {
      takeTurn: function (game, player) {
        if (M.abandoned || game !== M.game || !player.alive) return Promise.resolve();
        return new Promise(function (resolve) {
          M.turn = { player: player, resolve: resolve };
          M.sel = null; M.inspect = null; M.busy = false;
          idleHighlight();
          renderHud();
        });
      },
      chooseCache: function (game, player, options) {
        if (M.abandoned || game !== M.game) {
          var si = options.map(function (o) { return o.type; }).indexOf('shard');
          return Promise.resolve(si >= 0 ? { index: si, stat: 'hp' } : { index: 0 });
        }
        return showCacheModal(game, player, options);
      }
    };
  }

  // ---------- modal plumbing ----------
  function openModal(html, cls) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-back"></div><div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    root.classList.add('on');
    void root.offsetWidth;
    root.classList.add('in');
    return $('.modal', root);
  }
  function closeModal() {
    var root = $('#modal-root');
    if (!root) return;
    root.classList.remove('in', 'on');
    root.innerHTML = '';
  }

  function showCacheModal(game, player, options) {
    return new Promise(function (resolve) {
      var st = attempt(function () { return game.stats(player); }, curStats());
      var html = '<div class="mh"><span class="mh-ico">❖</span><small>Cache opened</small><h2>Choose one</h2></div><div class="cache-opts">';
      options.forEach(function (o, i) {
        if (o.type === 'cards') {
          html += '<button class="cache-opt" data-i="' + i + '"><div class="co-cards">' +
            (o.cards || []).map(function (id) { var c = DATA.CARDS[id]; return c ? cardFace(c, st, { style: '--w:76px' }) : ''; }).join('') +
            '</div><div class="co-names">' + (o.cards || []).map(function (id) { var c = DATA.CARDS[id]; return c ? '<span>' + esc(c.name) + '</span>' : ''; }).join('') + '</div><span class="co-label">Take both cards</span></button>';
        } else {
          html += '<button class="cache-opt shard" data-i="' + i + '"><div class="shard-gem"><i></i></div><b>Stat Shard</b><span class="co-label">+1 to a stat. Ignores the cap</span></button>';
        }
      });
      html += '</div><div class="shard-pick hidden" id="shard-pick"><p>Choose a stat for the shard</p><div class="shard-stats">' +
        STAT_KEYS.map(function (k) {
          var desc = k === 'hp' ? '+5 max HP, heal 5' : '+1 ' + STAT_INFO[k].name + ' (' + st[k] + ' → ' + (st[k] + 1) + ')';
          return '<button class="shard-stat s-' + k + '" data-stat="' + k + '"><b>' + STAT_INFO[k].name + '</b><small>' + desc + '</small></button>';
        }).join('') + '</div><button class="link-btn" id="shard-back">Back</button></div>';
      var m = openModal(html, 'cache-modal');
      var shardIdx = -1;
      m.addEventListener('click', function (e) {
        var o = e.target.closest('.cache-opt');
        if (o) {
          var i = +o.dataset.i;
          if (options[i].type === 'shard') {
            shardIdx = i;
            $('.cache-opts', m).classList.add('hidden');
            $('#shard-pick', m).classList.remove('hidden');
            return;
          }
          closeModal(); resolve({ index: i }); return;
        }
        var s = e.target.closest('.shard-stat');
        if (s) { closeModal(); resolve({ index: shardIdx, stat: s.dataset.stat }); return; }
        if (e.target.closest('#shard-back')) {
          $('.cache-opts', m).classList.remove('hidden');
          $('#shard-pick', m).classList.add('hidden');
        }
      });
    });
  }

  function openMenu() {
    var m = openModal('<div class="mh"><small>Paused menu</small><h2>Match</h2></div>' +
      '<div class="menu-btns"><button class="btn-wide" data-m="resume">Resume</button>' +
      '<button class="btn-wide ghost" data-m="log">Full combat log</button>' +
      '<button class="btn-wide danger" data-m="leave">Leave match</button></div>', 'menu-modal');
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      closeModal();
      if (b.dataset.m === 'leave') leaveMatch();
      else if (b.dataset.m === 'log' && !M.logOpen) toggleLog();
    });
    $('.modal-back').addEventListener('click', closeModal);
  }

  // ---------- elimination / spectate / end ----------
  function checkElimination() {
    var me = human();
    if (!me || me.alive || M.elimOffered || M.abandoned || (M.game && M.game.over)) return;
    M.elimOffered = true;
    if (M.turn) finishTurn();
    setTimeout(function () {
      if (M.abandoned || (M.game && M.game.over)) return;
      var place = me.place || M.game.players.filter(function (p) { return p.alive; }).length + 1;
      var m = openModal('<div class="end-mini">' + portraitHTML(me, 'big dead') +
        '<small>You were eliminated</small><h2 class="elim-title">Eliminated — ' + ordinal(place) + '</h2>' +
        '<p>The arena keeps crumbling. Watch the bots fight it out, or head back.</p>' +
        '<div class="menu-btns"><button class="btn-wide gold" data-e="spec">Spectate <small>2× speed</small></button>' +
        '<button class="btn-wide ghost" data-e="leave">Leave</button></div></div>', 'elim-modal');
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-e]'); if (!b) return;
        closeModal();
        if (b.dataset.e === 'spec') {
          M.spectating = true;
          setSpeed(2);
          $('#spectate-chip').classList.remove('hidden');
        } else leaveMatch();
      });
    }, reduced ? 300 : 900);
  }

  function leaveMatch() {
    M.abandoned = true;
    if (M.turn) finishTurn();
    closeModal();
    if (handlers.onLeave) handlers.onLeave();
    showLoadout();
  }

  function gameOver(results) {
    if (M.abandoned || !M.game) return Promise.resolve();
    M.turn = null; M.sel = null; M.inspect = null;
    vcall('clearHighlight');
    $('#spectate-chip').classList.add('hidden');
    var me = human();
    var res = results || {};
    var rp = (res.players || []).filter(function (p) { return p.id === M.humanId; })[0] || {};
    var place = rp.place || (me && me.place) || (res.winnerId === M.humanId ? 1 : 0);
    var won = place === 1 || res.winnerId === M.humanId;
    var stats = rp.stats || (me && me.stats) || {};
    var winner = M.game.players[res.winnerId];
    var standings = (res.placements || []).map(function (id, i) {
      var p = M.game.players[id]; if (!p) return '';
      var c = DATA.CLASSES[p.cls] || {};
      return '<li class="' + (id === M.humanId ? 'me' : '') + '"><span class="sd-place">' + (i + 1) + '</span>' + portraitHTML(p) +
        '<span class="sd-name">' + esc(id === M.humanId ? 'You' : p.name) + '<small>' + esc(c.name || '') + '</small></span>' +
        '<span class="sd-dmg">' + ((p.stats && p.stats.dmgDealt) | 0) + '<small>dmg</small></span></li>';
    }).join('');
    function stat(label, v) { return '<div class="es-stat"><b>' + (v | 0) + '</b><small>' + label + '</small></div>'; }
    setTimeout(function () {
      if (M.abandoned) return;
      var m = openModal(
        '<div class="end ' + (won ? 'won' : 'lost') + '">' +
          '<div class="end-rays"></div>' +
          (me ? portraitHTML(me, 'big' + (won ? '' : ' dead')) : '') +
          '<small class="end-kicker">' + (res.endedByCap ? 'Time up' + (res.rounds ? ' after ' + res.rounds + ' rounds' : '') : won ? 'Last piece standing' + (res.rounds ? ' \u00B7 ' + res.rounds + ' rounds' : '') : (winner ? esc(winner.name) + ' took the last tile' : 'Match over')) + '</small>' +
          '<h2 class="end-title">' + (won ? 'Victory' : 'Eliminated — ' + ordinal(place || 8)) + '</h2>' +
          '<div class="es-grid">' + stat('Damage dealt', stats.dmgDealt) + stat('Eliminations', stats.kills) + stat('Caches opened', stats.caches) + stat('Gamebreakers', stats.gbUsed) + '</div>' +
          (standings ? '<ol class="standings">' + standings + '</ol>' : '') +
          '<div class="end-btns"><button class="btn-wide gold" data-x="again">Play Again</button><button class="btn-wide ghost" data-x="loadout">Back to Loadout</button></div>' +
        '</div>', 'end-modal');
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-x]'); if (!b) return;
        closeModal();
        if (b.dataset.x === 'again' && handlers.onPlayAgain) handlers.onPlayAgain();
        else showLoadout();
      });
    }, reduced ? 200 : 700);
    return Promise.resolve();
  }

  // ------------------------------------------------------------------
  // View hooks (called by the composite view in main.js)
  // ------------------------------------------------------------------
  var hooks = {
    init: function (game) { if (M.game !== game) startMatch(game); scheduleRender(); },
    refresh: function () { scheduleRender(); },
    roundStart: function () { scheduleRender(); },
    turnStart: function (player) {
      if (M.inspect && !M.turn) M.inspect = null;
      scheduleRender();
    },
    banner: function (text, kind) { if (M.abandoned) return; return banner(text, kind); },
    log: function (text) { if (!M.abandoned) addLog(text); },
    death: function (entity) { if (entity && !entity.isDecoy) scheduleRender(); },
    tilesChanged: function () { if (M.sel || M.turn) { /* targets may have changed; recompute lazily */ } },
    gameOver: gameOver
  };

  function setReducedMotion(b) {
    reduced = !!b;
    document.documentElement.classList.toggle('reduced-motion', reduced);
  }

  return {
    initLoadout: initLoadout,
    getLoadout: getLoadout,
    showLoadout: showLoadout,
    startMatch: startMatch,
    hooks: hooks,
    createHumanController: createHumanController,
    onTileTap: onTileTap,
    setReducedMotion: setReducedMotion,
    getSpeed: function () { return speed; },
    setSpeed: setSpeed,
    stageEl: stage,
    overlayEl: overlay,
    isAbandoned: function () { return M.abandoned; },
    cardFace: cardFace,
    debug: { M: M, L: L }
  };
})();
