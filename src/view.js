// LAST TILE: VIEW (Three.js r128). Rendering, pieces, VFX, camera, DOM overlay.
// Implements the CORE->view interface (every method returns a Promise) plus the UI sync API.
var VIEW = (function () {
  'use strict';

  /* ======================================================================
   * 0. Constants, palettes, small utilities
   * ==================================================================== */
  var LEVEL = 0.34;          // height per elevation level
  var BASE_TOP = 0.22;      // top of a level-0 tile
  var CAP = 0.12;           // thickness of the beveled stone cap
  var BED = -0.55;          // island surface under the tiles
  var PIECE_SCALE = 1.68, BASE_REL = 1.18 / 1.68;

  var DEFAULT_TEAM = ['#ffd34d', '#ff4f6a', '#3fc8ff', '#6dff7a', '#c27bff', '#ff9636', '#3cf2cf', '#ff6fd8'];

  var CLASS_PAL = {
    vanguard:   { main: 0x4a7cc0, dark: 0x263a5e, light: 0xa9c4e6, metal: 0xc9d4e2, trim: 0xe3b856, glow: 0x7cc8ff },
    striker:    { main: 0xff7a2c, dark: 0x6a2c14, light: 0xffc08a, metal: 0x4a3a34, trim: 0xffd060, glow: 0xffa43a },
    marksman:   { main: 0x3e9a4f, dark: 0x1d4428, light: 0x9fd18a, metal: 0x5a5048, trim: 0xb88a4e, glow: 0xb6ff7a },
    phantom:    { main: 0x8a5cc8, dark: 0x2c2044, light: 0xcdb6ff, metal: 0xd0d0e0, trim: 0x5a3a8a, glow: 0xc49cff },
    lifebinder: { main: 0x2db3a5, dark: 0x13554f, light: 0xa6f0e2, metal: 0xe6c060, trim: 0xf0d27a, glow: 0x8affdc },
    hexer:      { main: 0xd23ccc, dark: 0x3e1044, light: 0xff9cf2, metal: 0x3a2a36, trim: 0x9a6a3a, glow: 0xff4ff0 }
  };
  var CLASS_IDS = ['vanguard', 'striker', 'marksman', 'phantom', 'lifebinder', 'hexer'];
  var VARIANTS = {
    vanguard: ['bastion', 'colossus', 'warden'],
    striker: ['brawler', 'duelist', 'tempest'],
    marksman: ['ranger', 'gunslinger', 'artillerist'],
    phantom: ['shade', 'specter', 'veilblade'],
    lifebinder: ['verdant', 'seraph', 'bloodoracle'],
    hexer: ['rotcaller', 'witchlight', 'voidmask']
  };
  var SKIN = [0xf2c9a0, 0xd9a273, 0xa86f48, 0xf6d7b8];

  function hasData() { return typeof DATA !== 'undefined' && DATA; }
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeOut3(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { return t * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOutBack(t) { var c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  // deterministic hash noise for per-tile variation
  function hash(x, y, s) { var n = Math.sin(x * 127.1 + y * 311.7 + (s || 0) * 74.7) * 43758.5453; return n - Math.floor(n); }
  function resolved() { return Promise.resolve(); }

  function normClass(c) {
    var n = norm(c);
    for (var i = 0; i < CLASS_IDS.length; i++) if (n === CLASS_IDS[i] || n.indexOf(CLASS_IDS[i]) >= 0) return CLASS_IDS[i];
    if (/^\d+$/.test(n)) return CLASS_IDS[(+n) % 6];
    return 'vanguard';
  }
  function normVariant(cls, v) {
    var list = VARIANTS[cls];
    if (typeof v === 'number' && list[v]) return list[v];
    var n = norm(v);
    if (/^\d$/.test(n) && list[+n]) return list[+n];
    // DATA-declared variant ids: map by position
    if (hasData() && DATA.CLASSES && DATA.CLASSES[cls] && DATA.CLASSES[cls].variants) {
      var vs = DATA.CLASSES[cls].variants;
      for (var i = 0; i < vs.length; i++) {
        if (vs[i] && (vs[i].id === v || norm(vs[i].id) === n)) {
          var nn = norm(vs[i].name || vs[i].id);
          for (var j = 0; j < list.length; j++) if (nn.indexOf(list[j]) >= 0 || list[j].indexOf(nn) >= 0) return list[j];
          if (list[i]) return list[i];
        }
      }
    }
    for (var k = 0; k < list.length; k++) if (n && (n.indexOf(list[k]) >= 0 || (n.length > 3 && list[k].indexOf(n) >= 0))) return list[k];
    if (n.indexOf('blood') >= 0 || n.indexOf('oracle') >= 0) return 'bloodoracle';
    if (n.indexOf('void') >= 0 || n.indexOf('mask') >= 0) return 'voidmask';
    return list[0];
  }
  function teamColors() {
    return (hasData() && DATA.TEAM_COLORS && DATA.TEAM_COLORS.length >= 8) ? DATA.TEAM_COLORS : DEFAULT_TEAM;
  }
  function toHex(c) {
    if (typeof c === 'number') return c;
    if (typeof c === 'string') { var s = c.replace('#', ''); if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]; var v = parseInt(s, 16); return isNaN(v) ? 0xffffff : v; }
    return 0xffffff;
  }
  function hexStr(c) { var h = toHex(c).toString(16); while (h.length < 6) h = '0' + h; return '#' + h; }
  function entColor(e) {
    if (!e) return 0xffffff;
    if (e.color != null && e.color !== '') return toHex(e.color);
    var tc = teamColors(); var i = e.colorIndex != null ? e.colorIndex : (e.index != null ? e.index : 0);
    return toHex(tc[((i % 8) + 8) % 8]);
  }

  /* ======================================================================
   * 1. Module state
   * ==================================================================== */
  var renderer = null, canvas = null, curW = 0, curH = 0;
  var scene = null, camera = null, world = null, boardGroup = null, fxGroup = null;
  var stageEl = null, overlayEl = null, mounted = false, stopped = false;
  var speed = 1, reduced = false, humanId = null, insets = { top: 0, bottom: 0 };
  var game = null, N = 12;
  var rafId = 0, lastT = 0, time = 0;
  var tweens = [], updaters = [];
  var envTex = null;
  var lights = {};
  var dpr = 1;

  /* ======================================================================
   * 2. Canvas textures
   * ==================================================================== */
  var TEX = {};
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
  function canvasTex(c, srgb, repeat) {
    var t = new THREE.CanvasTexture(c);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
  }
  function tex(name) {
    if (TEX[name]) return TEX[name];
    var c, g, i, x, y, r;
    switch (name) {
      case 'glow': {
        c = mkCanvas(128); g = c.getContext('2d');
        var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
        gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 128, 128); break;
      }
      case 'soft': {
        c = mkCanvas(64); g = c.getContext('2d');
        var gs = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gs.addColorStop(0, 'rgba(255,255,255,1)'); gs.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gs.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gs; g.fillRect(0, 0, 64, 64); break;
      }
      case 'spark': {
        c = mkCanvas(64); g = c.getContext('2d');
        var gk = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gk.addColorStop(0, 'rgba(255,255,255,1)'); gk.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gk.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gk; g.fillRect(0, 0, 64, 64);
        g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.moveTo(32, 0); g.lineTo(35, 29); g.lineTo(64, 32); g.lineTo(35, 35); g.lineTo(32, 64); g.lineTo(29, 35); g.lineTo(0, 32); g.lineTo(29, 29); g.closePath(); g.fill();
        break;
      }
      case 'ring': {
        c = mkCanvas(256); g = c.getContext('2d');
        var gg = g.createRadialGradient(128, 128, 60, 128, 128, 128);
        gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.62, 'rgba(255,255,255,0.0)'); gg.addColorStop(0.82, 'rgba(255,255,255,1)');
        gg.addColorStop(0.9, 'rgba(255,255,255,0.5)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gg; g.fillRect(0, 0, 256, 256); break;
      }
      case 'activeRing': {
        c = mkCanvas(256); g = c.getContext('2d');
        var ga = g.createRadialGradient(128, 128, 40, 128, 128, 128);
        ga.addColorStop(0, 'rgba(255,255,255,0)'); ga.addColorStop(0.55, 'rgba(255,255,255,0.08)'); ga.addColorStop(0.78, 'rgba(255,255,255,1)');
        ga.addColorStop(0.86, 'rgba(255,255,255,0.35)'); ga.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = ga; g.fillRect(0, 0, 256, 256);
        g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6;
        for (i = 0; i < 4; i++) { var a0 = i * Math.PI / 2 + 0.25; g.beginPath(); g.arc(128, 128, 116, a0, a0 + 0.9); g.stroke(); }
        break;
      }
      case 'stone': {
        c = mkCanvas(128); g = c.getContext('2d');
        g.fillStyle = '#c2ad92'; g.fillRect(0, 0, 128, 128);
        for (i = 0; i < 900; i++) { var v = Math.random(); g.fillStyle = 'rgba(' + (v > 0.5 ? '255,245,225' : '40,30,25') + ',' + (Math.random() * 0.09) + ')'; r = rnd(1, 5); g.fillRect(Math.random() * 128, Math.random() * 128, r, r); }
        // large soft mottling
        for (i = 0; i < 14; i++) { var m = g.createRadialGradient(x = rnd(0, 128), y = rnd(0, 128), 0, x, y, r = rnd(15, 40)); m.addColorStop(0, 'rgba(' + (Math.random() > 0.5 ? '90,70,50' : '255,240,210') + ',0.10)'); m.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = m; g.fillRect(0, 0, 128, 128); }
        // cracks
        g.strokeStyle = 'rgba(50,38,30,0.45)'; g.lineWidth = 1;
        for (i = 0; i < 3; i++) { g.beginPath(); x = rnd(10, 118); y = rnd(10, 118); g.moveTo(x, y); for (var k = 0; k < 5; k++) { x += rnd(-14, 14); y += rnd(-14, 14); g.lineTo(x, y); } g.stroke(); }
        // inset edge: lighter rim, darker groove just inside
        g.strokeStyle = 'rgba(255,248,230,0.35)'; g.lineWidth = 3; g.strokeRect(3, 3, 122, 122);
        g.strokeStyle = 'rgba(60,45,35,0.35)'; g.lineWidth = 2; g.strokeRect(9, 9, 110, 110);
        break;
      }
      case 'side': {
        c = mkCanvas(64, 128); g = c.getContext('2d');
        var gsd = g.createLinearGradient(0, 0, 0, 128); gsd.addColorStop(0, '#8a7a6a'); gsd.addColorStop(1, '#4a3e3a');
        g.fillStyle = gsd; g.fillRect(0, 0, 64, 128);
        for (i = 0; i < 6; i++) { g.fillStyle = 'rgba(30,22,20,' + rnd(0.1, 0.3) + ')'; g.fillRect(0, rnd(0, 128), 64, rnd(1, 3)); }
        for (i = 0; i < 300; i++) { g.fillStyle = 'rgba(' + (Math.random() > 0.5 ? '255,240,220' : '20,15,15') + ',' + rnd(0, 0.12) + ')'; g.fillRect(rnd(0, 64), rnd(0, 128), 2, 2); }
        break;
      }
      case 'rock': {
        c = mkCanvas(128); g = c.getContext('2d');
        g.fillStyle = '#6a5c58'; g.fillRect(0, 0, 128, 128);
        for (i = 0; i < 1200; i++) { g.fillStyle = 'rgba(' + (Math.random() > 0.5 ? '230,210,200' : '20,15,25') + ',' + rnd(0, 0.15) + ')'; r = rnd(1, 4); g.fillRect(rnd(0, 128), rnd(0, 128), r, r); }
        for (i = 0; i < 10; i++) { g.strokeStyle = 'rgba(25,18,25,0.35)'; g.beginPath(); x = rnd(0, 128); y = rnd(0, 128); g.moveTo(x, y); g.lineTo(x + rnd(-30, 30), y + rnd(5, 30)); g.stroke(); }
        break;
      }
      case 'warn': {
        c = mkCanvas(128); g = c.getContext('2d');
        g.shadowColor = '#fff'; g.shadowBlur = 10; g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 7;
        g.strokeRect(10, 10, 108, 108);
        g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 6;
        g.save(); g.beginPath(); g.rect(12, 12, 104, 104); g.clip();
        for (i = -128; i < 256; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); }
        g.restore(); break;
      }
      case 'hl': {
        c = mkCanvas(128); g = c.getContext('2d');
        g.fillStyle = 'rgba(255,255,255,0.28)'; roundRect(g, 10, 10, 108, 108, 14); g.fill();
        g.shadowColor = '#fff'; g.shadowBlur = 8; g.strokeStyle = '#fff'; g.lineWidth = 6; roundRect(g, 10, 10, 108, 108, 14); g.stroke();
        break;
      }
      case 'hlFill': {
        c = mkCanvas(128); g = c.getContext('2d');
        var gf = g.createRadialGradient(64, 64, 10, 64, 64, 80); gf.addColorStop(0, 'rgba(255,255,255,0.55)'); gf.addColorStop(1, 'rgba(255,255,255,0.9)');
        g.fillStyle = gf; roundRect(g, 6, 6, 116, 116, 12); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 5; roundRect(g, 6, 6, 116, 116, 12); g.stroke();
        break;
      }
      case 'flash': {
        c = mkCanvas(128); g = c.getContext('2d');
        var gfl = g.createRadialGradient(64, 64, 0, 64, 64, 90); gfl.addColorStop(0, 'rgba(255,255,255,1)'); gfl.addColorStop(1, 'rgba(255,255,255,0.15)');
        g.fillStyle = gfl; roundRect(g, 4, 4, 120, 120, 10); g.fill(); break;
      }
      case 'hex': {
        c = mkCanvas(256, 128); g = c.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#fff'; g.lineWidth = 3;
        var s = 16, hh = s * Math.sqrt(3);
        for (var row = -1; row < 6; row++) for (var col = -1; col < 12; col++) {
          var cx = col * s * 1.5 * 1.42, cy = row * hh * 1.0 + (col % 2 ? hh / 2 : 0);
          g.beginPath(); for (var q = 0; q < 6; q++) { var an = q * Math.PI / 3; var px = cx + Math.cos(an) * s, py = cy + Math.sin(an) * s; if (q) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); g.stroke();
        }
        break;
      }
      case 'slash': {
        c = mkCanvas(256); g = c.getContext('2d');
        for (i = 0; i < 40; i++) {
          var t0 = i / 40; g.strokeStyle = 'rgba(255,255,255,' + (Math.pow(t0, 1.6) * 0.9) + ')'; g.lineWidth = 2 + t0 * 22;
          g.beginPath(); g.arc(128, 150, 96, Math.PI * (1.05 + t0 * 0.75), Math.PI * (1.08 + t0 * 0.75)); g.stroke();
        }
        g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 4; g.beginPath(); g.arc(128, 150, 100, Math.PI * 1.35, Math.PI * 1.85); g.stroke();
        break;
      }
      case 'beam': {
        c = mkCanvas(16, 128); g = c.getContext('2d');
        var gb = g.createLinearGradient(0, 0, 16, 0); gb.addColorStop(0, 'rgba(255,255,255,0)'); gb.addColorStop(0.5, 'rgba(255,255,255,1)'); gb.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gb; g.fillRect(0, 0, 16, 128); break;
      }
      case 'aura': {
        c = mkCanvas(64, 128); g = c.getContext('2d');
        var gau = g.createLinearGradient(0, 128, 0, 0); gau.addColorStop(0, 'rgba(255,255,255,0.95)'); gau.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gau.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gau; g.fillRect(0, 0, 64, 128);
        g.globalCompositeOperation = 'destination-out';
        for (i = 0; i < 8; i++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * 8 + 2, 0, 3, 128); }
        break;
      }
      case 'mark': {
        c = mkCanvas(128); g = c.getContext('2d');
        g.shadowColor = '#fff'; g.shadowBlur = 6; g.strokeStyle = '#fff'; g.lineWidth = 6;
        g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 22, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 5; [[64, 4, 64, 30], [64, 98, 64, 124], [4, 64, 30, 64], [98, 64, 124, 64]].forEach(function (l) { g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(l[2], l[3]); g.stroke(); });
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, 128, 128);
        break;
      }
      case 'trap': {
        c = mkCanvas(128); g = c.getContext('2d');
        g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#fff';
        for (i = 0; i < 8; i++) { var aa = i * Math.PI / 4; g.beginPath(); g.moveTo(64 + Math.cos(aa) * 52, 64 + Math.sin(aa) * 52); g.lineTo(64 + Math.cos(aa + 0.18) * 36, 64 + Math.sin(aa + 0.18) * 36); g.lineTo(64 + Math.cos(aa - 0.18) * 36, 64 + Math.sin(aa - 0.18) * 36); g.fill(); }
        g.beginPath(); g.arc(64, 64, 8, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'rune': {
        c = mkCanvas(256); g = c.getContext('2d');
        g.translate(128, 128); g.strokeStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 8;
        g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 96, 0, Math.PI * 2); g.stroke();
        g.font = 'bold 18px serif'; g.fillStyle = '#fff'; g.textAlign = 'center';
        var glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ';
        for (i = 0; i < 16; i++) { g.save(); g.rotate(i * Math.PI / 8); g.fillText(glyphs[i], 0, -101); g.restore(); }
        g.lineWidth = 2; for (i = 0; i < 6; i++) { g.save(); g.rotate(i * Math.PI / 3); g.beginPath(); g.moveTo(0, -80); g.lineTo(69, 40); g.stroke(); g.restore(); }
        break;
      }
      case 'cloud': {
        c = mkCanvas(512); g = c.getContext('2d');
        for (i = 0; i < 70; i++) {
          x = rnd(40, 472); y = rnd(40, 472); r = rnd(30, 90);
          var gc = g.createRadialGradient(x, y, 0, x, y, r);
          gc.addColorStop(0, 'rgba(255,255,255,' + rnd(0.08, 0.22) + ')'); gc.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gc; g.fillRect(0, 0, 512, 512);
        }
        var mask = g.createRadialGradient(256, 256, 120, 256, 256, 256);
        g.globalCompositeOperation = 'destination-in'; mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = mask; g.fillRect(0, 0, 512, 512);
        break;
      }
      case 'sky': {
        c = mkCanvas(16, 512); g = c.getContext('2d');
        var gsk = g.createLinearGradient(0, 0, 0, 512);
        gsk.addColorStop(0.0, '#05061a'); gsk.addColorStop(0.25, '#141043'); gsk.addColorStop(0.42, '#3a2368');
        gsk.addColorStop(0.49, '#8a4a86'); gsk.addColorStop(0.505, '#b9688a'); gsk.addColorStop(0.53, '#7a4688');
        gsk.addColorStop(0.66, '#3e2670'); gsk.addColorStop(0.85, '#22184c'); gsk.addColorStop(1.0, '#120e30');
        g.fillStyle = gsk; g.fillRect(0, 0, 16, 512); break;
      }
      case 'shard': {
        c = mkCanvas(64); g = c.getContext('2d'); g.fillStyle = '#fff';
        g.beginPath(); g.moveTo(32, 2); g.lineTo(44, 32); g.lineTo(32, 62); g.lineTo(20, 32); g.closePath(); g.fill(); break;
      }
      default: {
        c = mkCanvas(4); c.getContext('2d').fillStyle = '#fff'; c.getContext('2d').fillRect(0, 0, 4, 4);
      }
    }
    var srgb = (name === 'stone' || name === 'side' || name === 'rock' || name === 'sky');
    var t = canvasTex(c, srgb, name === 'hex' || name === 'stone' || name === 'rock' || name === 'side' || name === 'cloud' || name === 'aura');
    TEX[name] = t; return t;
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath(); }

  // Corruption vein textures: a dark violet colour map plus an emissive vein map.
  var VEIN = [];
  function veinPair(seed) {
    if (VEIN[seed]) return VEIN[seed];
    var S = 256, cm = mkCanvas(S), em = mkCanvas(S), gc = cm.getContext('2d'), ge = em.getContext('2d');
    var bg = gc.createRadialGradient(128, 128, 10, 128, 128, 180); bg.addColorStop(0, '#3a1448'); bg.addColorStop(1, '#16061f');
    gc.fillStyle = bg; gc.fillRect(0, 0, S, S); ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
    for (var i = 0; i < 500; i++) { gc.fillStyle = 'rgba(' + (Math.random() > 0.5 ? '120,40,140' : '5,0,10') + ',' + rnd(0.05, 0.25) + ')'; var r = rnd(1, 6); gc.fillRect(rnd(0, S), rnd(0, S), r, r); }
    function branch(x, y, a, w, depth) {
      var len = rnd(8, 18);
      for (var s = 0; s < 14 && w > 0.6; s++) {
        var nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
        [ge, gc].forEach(function (g, k) {
          g.strokeStyle = k ? 'rgba(255,90,240,0.55)' : 'rgba(255,255,255,1)'; g.lineWidth = w; g.lineCap = 'round';
          g.shadowColor = k ? '#ff40e0' : '#ffffff'; g.shadowBlur = k ? 6 : 10;
          g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        });
        x = nx; y = ny; a += rnd(-0.6, 0.6); w *= 0.86;
        if (depth < 3 && Math.random() < 0.28) branch(x, y, a + (Math.random() > 0.5 ? 1 : -1) * rnd(0.5, 1.2), w * 0.8, depth + 1);
      }
    }
    var n = 5 + seed;
    for (var b = 0; b < n; b++) {
      var side = b % 4, p = rnd(20, 236);
      var sx = side === 0 ? 0 : side === 1 ? S : p, sy = side === 2 ? 0 : side === 3 ? S : p;
      branch(sx, sy, Math.atan2(128 - sy, 128 - sx) + rnd(-0.5, 0.5), rnd(4, 6), 0);
    }
    // glowing node in the middle
    var nod = ge.createRadialGradient(128, 128, 0, 128, 128, 40); nod.addColorStop(0, 'rgba(255,255,255,0.6)'); nod.addColorStop(1, 'rgba(0,0,0,0)');
    ge.shadowBlur = 0; ge.fillStyle = nod; ge.fillRect(0, 0, S, S);
    var pair = { map: canvasTex(cm, true), emissive: canvasTex(em, true) };
    VEIN[seed] = pair; return pair;
  }

  /* ======================================================================
   * 3. Shared geometry and material caches
   * ==================================================================== */
  var GEO = {}, MAT = {};
  function geo(key, make) { return GEO[key] || (GEO[key] = make()); }
  function col(hex) { return new THREE.Color(toHex(hex)).convertSRGBToLinear(); }
  function mStd(hex, rough, metal, extra) {
    var key = 's' + toHex(hex) + '_' + rough + '_' + metal + (extra ? JSON.stringify(extra, function (k, v) { return (v && v.isTexture) ? v.uuid : v; }) : '');
    if (MAT[key]) return MAT[key];
    var o = { color: col(hex), roughness: rough == null ? 0.6 : rough, metalness: metal || 0 };
    if (extra) for (var k in extra) o[k] = extra[k];
    if (o.emissive != null && !(o.emissive instanceof THREE.Color)) o.emissive = col(o.emissive);
    var m = new THREE.MeshStandardMaterial(o);
    MAT[key] = m; return m;
  }
  function mEmi(hex, emi, ei) { return mStd(hex, 0.4, 0.1, { emissive: emi == null ? hex : emi, emissiveIntensity: ei == null ? 1.2 : ei }); }
  function mBasic(hex, opts) {
    var key = 'b' + toHex(hex) + (opts ? JSON.stringify(opts) : '');
    if (MAT[key]) return MAT[key];
    var o = { color: col(hex), toneMapped: false }; if (opts) for (var k in opts) o[k] = opts[k];
    return (MAT[key] = new THREE.MeshBasicMaterial(o));
  }
  function spriteMat(hex, texName, opacity, shared) {
    var key = 'sp' + toHex(hex) + texName + (opacity == null ? 1 : opacity);
    if (shared !== false && MAT[key]) return MAT[key];
    var m = new THREE.SpriteMaterial({ map: tex(texName || 'glow'), color: col(hex), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: opacity == null ? 1 : opacity, toneMapped: false });
    if (shared !== false) MAT[key] = m; return m;
  }
  function glowSprite(hex, size, opacity, texName, shared) {
    var s = new THREE.Sprite(spriteMat(hex, texName, opacity, shared));
    s.scale.set(size, size, size); s.renderOrder = 5; return s;
  }
  function addMat(hex, texName, opacity, side) {
    return new THREE.MeshBasicMaterial({ map: texName ? tex(texName) : null, color: col(hex), transparent: true, opacity: opacity == null ? 1 : opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: side || THREE.DoubleSide, toneMapped: false });
  }

  function gSph(r, w, h) { return geo('sph' + r + '_' + (w || 16), function () { return new THREE.SphereGeometry(r, w || 16, h || Math.max(6, Math.round((w || 16) * 0.75))); }); }
  function gHemi(r) { return geo('hemi' + r, function () { return new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); }); }
  function gCyl(rt, rb, h, s, open, ts, tl) { return geo('cyl' + [rt, rb, h, s, open, ts, tl].join('_'), function () { return new THREE.CylinderGeometry(rt, rb, h, s || 14, 1, !!open, ts || 0, tl == null ? Math.PI * 2 : tl); }); }
  function gBox(w, h, d) { return geo('box' + [w, h, d].join('_'), function () { return new THREE.BoxGeometry(w, h, d); }); }
  function gCone(r, h, s) { return geo('cone' + [r, h, s].join('_'), function () { return new THREE.ConeGeometry(r, h, s || 14); }); }
  function gTor(r, t, arc, rs, ts) { return geo('tor' + [r, t, arc, rs, ts].join('_'), function () { return new THREE.TorusGeometry(r, t, rs || 8, ts || 24, arc == null ? Math.PI * 2 : arc); }); }
  function gOct(r) { return geo('oct' + r, function () { return new THREE.OctahedronGeometry(r, 0); }); }
  function gIco(r, d) { return geo('ico' + r + '_' + (d || 0), function () { return new THREE.IcosahedronGeometry(r, d || 0); }); }
  function gCap(r, len, seg) { // capsule via LatheGeometry (CapsuleGeometry does not exist in r128)
    return geo('cap' + r + '_' + len, function () {
      var pts = [], n = 6, i, a;
      for (i = 0; i <= n; i++) { a = -Math.PI / 2 + (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r + 1e-4, Math.sin(a) * r - len / 2)); }
      for (i = 0; i <= n; i++) { a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r + 1e-4, Math.sin(a) * r + len / 2)); }
      return new THREE.LatheGeometry(pts, seg || 12);
    });
  }
  function gLathe(key, pts, seg) { return geo('lathe' + key, function () { return new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 18); }); }
  function gPlane(w, h) { return geo('pl' + w + '_' + (h || w), function () { var g = new THREE.PlaneGeometry(w, h || w); g.rotateX(-Math.PI / 2); return g; }); }
  function gShape(key, build, depth, bevel) {
    return geo('shape' + key, function () {
      var s = new THREE.Shape(); build(s);
      var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: 2, curveSegments: 10 });
      g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return g;
    });
  }

  function P(parent, g, m, x, y, z, rx, ry, rz, sx, sy, sz) {
    var o = new THREE.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) o.rotation.set(rx || 0, ry || 0, rz || 0);
    if (sx != null) o.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    o.castShadow = true; o.receiveShadow = false;
    parent.add(o); return o;
  }
  function Grp(parent, x, y, z) { var g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(g); return g; }

  /* ======================================================================
   * 4. Tweens, timers and the render loop
   * ==================================================================== */
  function tween(ms, fn, ease) {
    return new Promise(function (res) {
      var d = Math.max(1, ms / speed);
      var tw = { t0: now(), d: d, fn: fn, ease: ease || null, res: res, done: false };
      tw.safety = setTimeout(function () { finishTween(tw); }, d + 500);
      tweens.push(tw); kick();
    });
  }
  function finishTween(tw) {
    if (tw.done) return; tw.done = true; clearTimeout(tw.safety);
    try { tw.fn(1); } catch (e) { console.error(e); }
    tw.res();
  }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms / speed)); }); }
  function runTweens() {
    if (!tweens.length) return;
    var t = now(), list = tweens; tweens = [];
    for (var i = 0; i < list.length; i++) {
      var tw = list[i]; if (tw.done) continue;
      var k = (t - tw.t0) / tw.d;
      if (k >= 1) { finishTween(tw); continue; }
      try { tw.fn(tw.ease ? tw.ease(k) : k); } catch (e) { console.error(e); }
      tweens.push(tw);
    }
  }
  // transient visual objects with their own per-frame update; removed when update returns false
  var transients = [];
  function addTransient(obj, life, update, parent) {
    (parent || fxGroup || scene).add(obj);
    transients.push({ obj: obj, t: 0, life: Math.max(0.016, life / 1000), update: update });
    kick(); return obj;
  }
  function runTransients(dt) {
    for (var i = transients.length - 1; i >= 0; i--) {
      var tr = transients[i]; tr.t += dt;
      var k = Math.min(1, tr.t / tr.life), keep = true;
      try { keep = tr.update ? tr.update(k, tr.obj, dt) !== false : true; } catch (e) { keep = false; }
      if (k >= 1 || !keep) { if (tr.obj.parent) tr.obj.parent.remove(tr.obj); disposeFx(tr.obj); transients.splice(i, 1); }
    }
  }
  function disposeFx(o) {
    o.traverse(function (c) {
      if (c.material && c.material.userData && c.material.userData.own) c.material.dispose();
      if (c.geometry && c.geometry.userData && c.geometry.userData.own) c.geometry.dispose();
    });
  }
  function own(m) { m.userData.own = true; return m; }

  function kick() { if (!rafId && typeof requestAnimationFrame !== 'undefined') rafId = requestAnimationFrame(frame); }

  /* ======================================================================
   * 5. Particle pools (one draw call each)
   * ==================================================================== */
  function ParticlePool(max, additive, texName) {
    this.max = max;
    var g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max); this.sway = new Float32Array(max);
    for (var i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex(texName || 'soft') }, uScale: { value: 400 } },
      vertexShader: 'attribute vec3 pcolor; attribute float psize; attribute float palpha; uniform float uScale; varying vec3 vC; varying float vA;' +
        'void main(){ vC=pcolor; vA=palpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=max(1.0, 1.5*psize*uScale/max(0.1,-mv.z)); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D uTex; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(uTex, gl_PointCoord); gl_FragColor=vec4(vC*t.rgb, t.a*vA); if(gl_FragColor.a<0.01) discard; }',
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 10;
    this.cursor = 0; this.live = 0;
  }
  ParticlePool.prototype.emit = function (o) {
    var n = o.count || 1, c = new THREE.Color(toHex(o.color == null ? 0xffffff : o.color));
    if (reduced) n = Math.ceil(n * 0.5);
    for (var k = 0; k < n; k++) {
      var i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      var sp = o.spread == null ? 0.1 : o.spread;
      var px = o.x + rnd(-sp, sp), py = o.y + rnd(-sp, sp) * (o.flat ? 0.2 : 1), pz = o.z + rnd(-sp, sp);
      this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
      var sv = o.speed == null ? 1 : o.speed, dir;
      if (o.dir) { dir = o.dir; this.vel[i * 3] = dir.x * sv + rnd(-1, 1) * (o.jitter || 0.3); this.vel[i * 3 + 1] = dir.y * sv + rnd(-1, 1) * (o.jitter || 0.3); this.vel[i * 3 + 2] = dir.z * sv + rnd(-1, 1) * (o.jitter || 0.3); }
      else {
        var th = Math.random() * Math.PI * 2, ph = o.up ? rnd(0.2, 1) : rnd(-1, 1), rr = Math.sqrt(1 - ph * ph);
        var s = sv * rnd(0.4, 1);
        this.vel[i * 3] = Math.cos(th) * rr * s; this.vel[i * 3 + 1] = ph * s + (o.lift || 0); this.vel[i * 3 + 2] = Math.sin(th) * rr * s;
      }
      var cv = o.colorVar || 0;
      this.col[i * 3] = clamp(c.r + rnd(-cv, cv), 0, 1); this.col[i * 3 + 1] = clamp(c.g + rnd(-cv, cv), 0, 1); this.col[i * 3 + 2] = clamp(c.b + rnd(-cv, cv), 0, 1);
      this.maxLife[i] = this.life[i] = (o.life || 0.8) * rnd(0.7, 1.15);
      this.grav[i] = o.gravity == null ? -2 : o.gravity; this.drag[i] = o.drag == null ? 1.5 : o.drag;
      this.s0[i] = (o.size || 0.12) * rnd(0.7, 1.3); this.s1[i] = o.size1 == null ? 0 : o.size1 * rnd(0.7, 1.3);
      this.a0[i] = o.alpha == null ? 1 : o.alpha; this.sway[i] = o.sway || 0;
      this.size[i] = this.s0[i]; this.alpha[i] = this.a0[i];
    }
    this.live = this.max; kick();
  };
  ParticlePool.prototype.update = function (dt) {
    if (!this.live) return;
    var any = 0;
    for (var i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -999; continue; }
      any++;
      var k = 1 - this.life[i] / this.maxLife[i], d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      if (this.sway[i]) { this.vel[i * 3] += Math.sin(time * 3 + i) * this.sway[i] * dt; this.vel[i * 3 + 2] += Math.cos(time * 2.6 + i * 1.7) * this.sway[i] * dt; }
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = lerp(this.s0[i], this.s1[i], k);
      this.alpha[i] = this.a0[i] * (k < 0.15 ? k / 0.15 : 1) * (1 - Math.pow(k, 2));
    }
    this.live = any;
    var a = this.points.geometry.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.psize.needsUpdate = a.palpha.needsUpdate = true;
  };
  var PFX = null, PDUST = null, PMOTE = null;

  /* ======================================================================
   * 6. Piece library: 18 procedural miniatures
   *    Model space: origin on top of the base disc, +z faces forward, ~0.85 tall.
   * ==================================================================== */
  var PI = Math.PI;
  function legs(g, m, o) {
    o = o || {}; var r = o.r || 0.055, len = o.len == null ? 0.1 : o.len, sp = o.spread || 0.065, res = [];
    for (var s = -1; s <= 1; s += 2) {
      var l = P(g, gCap(r, len), m, s * sp, r + len / 2 + 0.01, 0);
      if (o.boot) P(g, gSph(r * 1.15, 12), o.boot, s * sp, r * 0.8, 0.02, 0, 0, 0, 1, 0.75, 1.3);
      res.push(l);
    }
    return res;
  }
  function torso(g, m, o) {
    o = o || {}; var rb = o.rb || 0.12, rt = o.rt || 0.155, h = o.h || 0.26;
    var key = 'torso' + rb + '_' + rt + '_' + h;
    var t = P(g, gLathe(key, [[0.0001, 0], [rb * 0.9, 0], [rb, h * 0.12], [rb * 1.02, h * 0.45], [rt, h * 0.82], [rt * 0.75, h * 0.98], [0.0001, h]]), m, 0, o.y == null ? 0.2 : o.y, 0);
    if (o.sx) t.scale.set(o.sx, 1, o.sz || 1);
    return t;
  }
  function robe(g, m, o) {
    o = o || {}; var rb = o.rb || 0.2, rt = o.rt || 0.12, h = o.h || 0.45;
    var key = 'robe' + rb + '_' + rt + '_' + h;
    return P(g, gLathe(key, [[0.0001, 0], [rb, 0], [rb * 0.96, h * 0.08], [rb * 0.8, h * 0.4], [rt * 1.05, h * 0.82], [rt * 0.8, h], [0.0001, h + 0.01]], 20), m, 0, o.y || 0.005, 0);
  }
  function head(g, skin, o) {
    o = o || {}; var r = o.r || 0.125, y = o.y || 0.6;
    var h = P(g, gSph(r, 18), skin, 0, y, 0);
    if (!o.noEyes) {
      var em = mStd(0x161018, 0.3, 0);
      P(g, gSph(r * 0.13, 8), em, -r * 0.36, y + r * 0.05, r * 0.9);
      P(g, gSph(r * 0.13, 8), em, r * 0.36, y + r * 0.05, r * 0.9);
    }
    return h;
  }
  function arm(g, side, m, o) {
    o = o || {}; var pivot = Grp(g, side * (o.x || 0.165), o.y || 0.43, o.z || 0);
    var len = o.len || 0.11, r = o.r || 0.042;
    P(pivot, gCap(r, len), m, 0, -(len / 2 + r * 0.6), 0);
    var hand = Grp(pivot, 0, -(len + r * 1.4), 0);
    if (o.handMat) P(hand, gSph(o.handR || r * 1.15, 10), o.handMat, 0, 0, 0);
    pivot.rotation.set(-(o.fwd || 0), 0, side * (o.out == null ? 0.22 : o.out));
    var holder = Grp(hand); holder.rotation.set(-pivot.rotation.x, -pivot.rotation.y, -pivot.rotation.z, 'ZYX');
    return { pivot: pivot, hand: hand, holder: holder };
  }
  function eyesGlow(g, hex, y, z, sp, r) {
    var m = mBasic(hex);
    P(g, gSph(r || 0.018, 8), m, -sp, y, z).castShadow = false;
    P(g, gSph(r || 0.018, 8), m, sp, y, z).castShadow = false;
  }

  var BUILD = {};

  // ---------------- VANGUARD (steel blue) ----------------
  BUILD.bastion = function (g, pal) {
    var steel = mStd(pal.metal, 0.3, 0.8), blue = mStd(pal.main, 0.42, 0.45), dark = mStd(pal.dark, 0.55, 0.4), gold = mStd(pal.trim, 0.28, 0.9), plumeM = mStd(0xd2333f, 0.75, 0);
    legs(g, dark, { r: 0.06, boot: steel });
    torso(g, blue, { rb: 0.13, rt: 0.17, h: 0.27 });
    P(g, gSph(0.15, 16), steel, 0, 0.37, 0.045, 0, 0, 0, 1, 1.0, 0.7);
    P(g, gTor(0.135, 0.024), gold, 0, 0.22, 0, PI / 2);
    P(g, gHemi(0.095), steel, 0.185, 0.45, 0, 0, 0, -0.55); P(g, gHemi(0.095), steel, -0.185, 0.45, 0, 0, 0, 0.55);
    // great helm
    P(g, gSph(0.14, 18), steel, 0, 0.62, 0, 0, 0, 0, 1, 1.08, 1);
    P(g, gCyl(0.142, 0.13, 0.08, 18), steel, 0, 0.56, 0);
    P(g, gBox(0.17, 0.026, 0.06), mEmi(0x0a1020, 0x6ab8ff, 2.2), 0, 0.62, 0.115);
    P(g, gBox(0.026, 0.12, 0.05), steel, 0, 0.57, 0.135);
    P(g, gBox(0.03, 0.05, 0.28), gold, 0, 0.765, -0.01);
    var plume = Grp(g, 0, 0.78, 0.02);
    for (var i = 0; i < 5; i++) { var a = i / 4; P(plume, gSph(0.065 - i * 0.006, 10), plumeM, 0, 0.03 + Math.sin(a * 2.6) * 0.05 - a * a * 0.08, 0.02 - a * 0.22, 0, 0, 0, 0.75, 0.9, 1.25); }
    // sword arm
    var ra = arm(g, 1, blue, { out: 0.35, fwd: 0.5, handMat: steel });
    var sw = Grp(ra.holder, 0, 0, 0.02); sw.rotation.x = 0.25;
    P(sw, gBox(0.032, 0.36, 0.014), steel, 0, 0.21, 0); P(sw, gBox(0.13, 0.026, 0.035), gold, 0, 0.025, 0); P(sw, gSph(0.022, 8), gold, 0, -0.045, 0);
    arm(g, -1, blue, { out: 0.3, fwd: 0.6, handMat: steel });
    // tower shield
    var sh = Grp(g, -0.16, 0.34, 0.17); sh.rotation.set(0, 0.42, 0.04);
    var tower = function (s) { s.moveTo(-0.16, -0.25); s.lineTo(0.16, -0.25); s.lineTo(0.16, 0.13); s.quadraticCurveTo(0.16, 0.25, 0, 0.29); s.quadraticCurveTo(-0.16, 0.25, -0.16, 0.13); s.closePath(); };
    P(sh, gShape('tower', tower, 0.035, 0.012), blue, 0, 0, 0);
    P(sh, gShape('towerRim', tower, 0.02, 0.0), gold, 0, 0, -0.022, 0, 0, 0, 1.1, 1.08, 1);
    P(sh, gBox(0.04, 0.3, 0.02), gold, 0, 0.0, 0.03); P(sh, gBox(0.2, 0.04, 0.02), gold, 0, 0.06, 0.03);
    P(sh, gSph(0.035, 10), steel, 0, 0.06, 0.04);
    g.userData.headY = 0.64;
    return function (t) { plume.rotation.x = Math.sin(t * 2.1) * 0.08; plume.rotation.z = Math.sin(t * 1.3) * 0.05; };
  };
  BUILD.colossus = function (g, pal) {
    var steel = mStd(pal.metal, 0.35, 0.75), blue = mStd(pal.main, 0.45, 0.45), dark = mStd(pal.dark, 0.6, 0.35), gold = mStd(pal.trim, 0.3, 0.9), wood = mStd(0x6a4428, 0.8, 0);
    legs(g, dark, { r: 0.078, len: 0.07, spread: 0.095, boot: steel });
    var body = P(g, gSph(0.2, 18), blue, 0, 0.37, 0, 0, 0, 0, 1.25, 1.05, 0.95);
    P(g, gSph(0.17, 16), steel, 0, 0.36, 0.06, 0, 0, 0, 1.15, 0.9, 0.75);
    P(g, gTor(0.18, 0.03), gold, 0, 0.23, 0, PI / 2, 0, 0, 1.15, 1, 1);
    // huge pauldrons with spikes
    for (var s = -1; s <= 1; s += 2) {
      P(g, gSph(0.13, 16), steel, s * 0.25, 0.5, 0, 0, 0, 0, 1, 0.8, 1);
      P(g, gTor(0.11, 0.022), gold, s * 0.25, 0.45, 0, PI / 2);
      P(g, gCone(0.035, 0.1, 8), steel, s * 0.3, 0.6, 0, 0, 0, -s * 0.5);
      arm(g, s, dark, { x: 0.26, y: 0.44, r: 0.06, len: 0.1, out: 0.25, fwd: s > 0 ? 0.9 : 0.3, handMat: steel, handR: 0.07 });
    }
    // small helmed head sunk between shoulders
    P(g, gSph(0.11, 16), steel, 0, 0.6, 0.0, 0, 0, 0, 1, 1.05, 1);
    P(g, gBox(0.15, 0.022, 0.05), mEmi(0x0a1020, 0x6ab8ff, 2.2), 0, 0.6, 0.095);
    P(g, gCone(0.03, 0.09, 8), gold, -0.07, 0.69, 0, 0, 0, 0.5); P(g, gCone(0.03, 0.09, 8), gold, 0.07, 0.69, 0, 0, 0, -0.5);
    // warhammer on the right, head held high
    var hm = Grp(g, 0.25, 0.3, 0.2); hm.rotation.set(0.1, 0, -0.25);
    P(hm, gCyl(0.024, 0.024, 0.62, 8), wood, 0, 0.18, 0);
    var hh = Grp(hm, 0, 0.5, 0);
    P(hh, gBox(0.3, 0.15, 0.15), steel, 0, 0, 0); P(hh, gBox(0.04, 0.17, 0.17), gold, -0.09, 0, 0); P(hh, gBox(0.04, 0.17, 0.17), gold, 0.09, 0, 0);
    P(hh, gCone(0.05, 0.08, 4), steel, -0.19, 0, 0, 0, 0, PI / 2);
    g.userData.headY = 0.6;
    return function (t) { body.scale.y = 1.05 + Math.sin(t * 1.6) * 0.02; hm.rotation.z = -0.25 + Math.sin(t * 1.6) * 0.03; };
  };
  BUILD.warden = function (g, pal) {
    var steel = mStd(pal.metal, 0.3, 0.75), blue = mStd(pal.main, 0.45, 0.35), dark = mStd(pal.dark, 0.6, 0.2), gold = mStd(pal.trim, 0.28, 0.9), leather = mStd(0x6a4630, 0.75, 0), cape = mStd(0x1c2c58, 0.8, 0, { side: THREE.DoubleSide }), skin = mStd(SKIN[1], 0.7, 0);
    legs(g, dark, { r: 0.05, len: 0.12, boot: leather });
    torso(g, blue, { rb: 0.11, rt: 0.145, h: 0.26 });
    P(g, gTor(0.12, 0.022), leather, 0, 0.22, 0, PI / 2);
    P(g, gSph(0.12, 14), steel, 0, 0.38, 0.03, 0, 0, 0, 1, 0.95, 0.75);
    var cp = Grp(g, 0, 0.47, -0.04);
    P(cp, gCyl(0.15, 0.25, 0.46, 16, true, PI * 0.55, PI * 0.9), cape, 0, -0.23, 0);
    P(cp, gTor(0.15, 0.012, PI * 0.9, 6, 16), gold, 0, 0, 0, PI / 2, 0, PI * 0.55 - PI / 2 + PI);
    head(g, skin, { r: 0.12, y: 0.6 });
    P(g, gSph(0.128, 16, 8), steel, 0, 0.615, -0.005, -0.25, 0, 0, 1, 0.85, 1); // open helm
    P(g, gBox(0.02, 0.07, 0.02), steel, 0, 0.6, 0.125);
    P(g, gCone(0.02, 0.09, 6), gold, 0, 0.75, -0.02);
    // spear
    var ra = arm(g, 1, blue, { out: 0.32, fwd: 0.35, handMat: leather });
    var sp = Grp(ra.holder, 0, 0, 0);
    P(sp, gCyl(0.014, 0.014, 0.95, 6), leather, 0, 0.18, 0);
    P(sp, gCone(0.035, 0.13, 6), steel, 0, 0.71, 0);
    P(sp, gBox(0.08, 0.02, 0.02), gold, 0, 0.64, 0);
    var pen = P(sp, gBox(0.005, 0.07, 0.11), mStd(pal.trim, 0.7, 0, { side: THREE.DoubleSide }), 0, 0.58, -0.06);
    // round shield
    var la = arm(g, -1, blue, { out: 0.4, fwd: 0.7, handMat: leather });
    var rs = Grp(g, -0.2, 0.33, 0.15); rs.rotation.set(0, -0.5, 0);
    P(rs, gCyl(0.16, 0.16, 0.03, 22), blue, 0, 0, 0, PI / 2);
    P(rs, gTor(0.16, 0.016, null, 8, 28), gold, 0, 0, 0.0);
    P(rs, gSph(0.045, 12), steel, 0, 0, 0.02, 0, 0, 0, 1, 1, 0.6);
    P(rs, gTor(0.09, 0.01, null, 6, 20), steel, 0, 0, 0.016);
    g.userData.headY = 0.62;
    return function (t) { cp.rotation.x = 0.12 + Math.sin(t * 1.8) * 0.07; pen.rotation.y = Math.sin(t * 3) * 0.3; };
  };

  // ---------------- STRIKER (ember orange) ----------------
  BUILD.brawler = function (g, pal) {
    var skin = mStd(SKIN[2], 0.65, 0), orange = mStd(pal.main, 0.55, 0.1), dark = mStd(0x2a2230, 0.7, 0.1), iron = mStd(0x3a3438, 0.35, 0.8), glowM = mEmi(0x401000, pal.glow, 2.4), band = mStd(0xe8382a, 0.6, 0);
    legs(g, dark, { r: 0.062, len: 0.08, spread: 0.075, boot: mStd(0x5a3a2a, 0.7, 0) });
    var body = Grp(g, 0, 0, 0);
    torso(body, skin, { rb: 0.125, rt: 0.17, h: 0.27, sx: 1.08 });
    P(body, gCyl(0.135, 0.13, 0.1, 16), orange, 0, 0.25, 0);
    P(body, gTor(0.13, 0.026), dark, 0, 0.21, 0, PI / 2);
    P(body, gBox(0.07, 0.06, 0.03), mStd(pal.trim, 0.3, 0.9), 0, 0.21, 0.13);
    head(body, skin, { r: 0.12, y: 0.6 });
    P(body, gSph(0.124, 14), dark, 0, 0.635, -0.015, -0.4, 0, 0, 1, 0.8, 1); // hair
    P(body, gTor(0.122, 0.022), band, 0, 0.64, 0, PI / 2 + 0.1);
    var tails = Grp(body, 0, 0.64, -0.12);
    P(tails, gBox(0.03, 0.012, 0.16), band, 0.03, -0.02, -0.07, 0.4, 0.3, 0); P(tails, gBox(0.03, 0.012, 0.14), band, -0.03, -0.04, -0.06, 0.6, -0.3, 0);
    // giant glowing gauntlets
    var fists = [];
    for (var s = -1; s <= 1; s += 2) {
      var a = arm(body, s, skin, { out: 0.55, fwd: 1.1, len: 0.09, r: 0.045, y: 0.45 });
      var f = Grp(a.holder, 0, 0.02, 0.02);
      P(f, gSph(0.105, 16), iron, 0, 0, 0, 0, 0, 0, 1, 0.95, 1.05);
      P(f, gTor(0.085, 0.024, PI, 8, 14), glowM, 0, 0.02, 0.05, 0, 0, 0);
      P(f, gCyl(0.08, 0.09, 0.07, 14), mStd(0x5a2a1a, 0.6, 0.3), 0, -0.08, 0);
      f.add(glowSprite(pal.glow, 0.32, 0.5));
      fists.push(a.pivot);
    }
    g.userData.headY = 0.6;
    return function (t) {
      body.position.y = Math.abs(Math.sin(t * 4)) * 0.025;
      fists[0].rotation.x = -1.1 - Math.max(0, Math.sin(t * 2)) * 0.25; fists[1].rotation.x = -1.1 - Math.max(0, -Math.sin(t * 2)) * 0.25;
      tails.rotation.x = Math.sin(t * 6) * 0.15;
    };
  };
  BUILD.duelist = function (g, pal) {
    var skin = mStd(SKIN[0], 0.65, 0), orange = mStd(pal.main, 0.5, 0.1), dark = mStd(0x2c2026, 0.6, 0.1), steel = mStd(0xe0e4ea, 0.2, 0.9), edge = mBasic(0xffb060), scarfM = mStd(0xff4a2a, 0.7, 0, { side: THREE.DoubleSide }), hair = mStd(0x2a1a14, 0.7, 0);
    legs(g, dark, { r: 0.045, len: 0.15, spread: 0.06, boot: mStd(0x5a3020, 0.6, 0.1) });
    torso(g, orange, { rb: 0.1, rt: 0.13, h: 0.26, y: 0.24 });
    P(g, gTor(0.1, 0.018), dark, 0, 0.26, 0, PI / 2);
    P(g, gBox(0.012, 0.25, 0.02), mStd(pal.trim, 0.3, 0.9), 0.0, 0.37, 0.125, 0, 0, 0.3);
    head(g, skin, { r: 0.11, y: 0.63 });
    P(g, gSph(0.115, 14), hair, 0, 0.66, -0.02, -0.5, 0, 0, 1, 0.8, 1);
    P(g, gCone(0.05, 0.22, 8), hair, 0, 0.62, -0.17, -1.9, 0, 0);
    // flowing scarf: chain of segments
    var scarf = Grp(g, 0, 0.53, -0.03), segs = [], parent = scarf;
    P(g, gTor(0.085, 0.03), scarfM, 0, 0.53, 0, PI / 2);
    for (var i = 0; i < 6; i++) { var sg = Grp(parent, 0, 0, i ? -0.075 : -0.06); P(sg, gBox(0.07 - i * 0.005, 0.012, 0.08), scarfM, 0, 0, -0.035); segs.push(sg); parent = sg; }
    // twin blades held low and wide
    for (var s = -1; s <= 1; s += 2) {
      var a = arm(g, s, orange, { out: 0.55, fwd: 0.25, len: 0.12, r: 0.037, y: 0.46, x: 0.14, handMat: dark });
      var b = Grp(a.holder, 0, 0, 0); b.rotation.set(0.9, 0, s * 0.9);
      P(b, gBox(0.04, 0.46, 0.01), steel, 0, 0.24, 0);
      P(b, gBox(0.01, 0.44, 0.014), edge, s * 0.02, 0.24, 0).castShadow = false;
      P(b, gBox(0.07, 0.02, 0.025), mStd(pal.trim, 0.3, 0.9), 0, 0.01, 0);
    }
    g.userData.headY = 0.63;
    return function (t) {
      for (var i = 0; i < segs.length; i++) { segs[i].rotation.x = 0.35 + Math.sin(t * 4 - i * 0.8) * 0.22; segs[i].rotation.y = Math.sin(t * 2.3 - i * 0.6) * 0.18; }
      scarf.rotation.x = -0.2;
    };
  };
  BUILD.tempest = function (g, pal) {
    var skin = mStd(SKIN[3], 0.65, 0), orange = mStd(pal.main, 0.45, 0.15), dark = mStd(0x3a2420, 0.6, 0.2), bolt = mBasic(0xffe27a), hairM = mEmi(0xffb030, 0xffa020, 1.6);
    legs(g, dark, { r: 0.05, len: 0.12, boot: mStd(0x6a3a20, 0.6, 0.2) });
    torso(g, orange, { rb: 0.11, rt: 0.15, h: 0.27 });
    P(g, gTor(0.115, 0.02), mStd(pal.trim, 0.3, 0.9), 0, 0.22, 0, PI / 2);
    var zz = Grp(g, 0, 0.36, 0.13);
    P(zz, gBox(0.025, 0.08, 0.01), bolt, 0.01, 0.03, 0, 0, 0, -0.5).castShadow = false; P(zz, gBox(0.025, 0.08, 0.01), bolt, -0.01, -0.03, 0, 0, 0, -0.5).castShadow = false;
    head(g, skin, { r: 0.115, y: 0.61 });
    // flame-spike hair
    var spikes = [[0, 0.11, -0.02, 0, 0], [0.06, 0.09, -0.03, 0, -0.6], [-0.06, 0.09, -0.03, 0, 0.6], [0.03, 0.08, -0.08, -0.6, -0.3], [-0.03, 0.08, -0.08, -0.6, 0.3], [0, 0.06, -0.1, -1.0, 0]];
    spikes.forEach(function (sp) { P(g, gCone(0.045, 0.16, 6), hairM, sp[0], 0.61 + sp[1], sp[2], sp[3], 0, sp[4]); });
    for (var s = -1; s <= 1; s += 2) {
      var a = arm(g, s, orange, { out: 0.9, fwd: 0.3, len: 0.1, handMat: mEmi(0xffe080, 0xffc040, 2) });
      a.hand.add(glowSprite(0xffc040, 0.22, 0.8));
    }
    var aura = glowSprite(pal.glow, 1.1, 0.32); aura.position.y = 0.4; g.add(aura);
    var ring = P(g, gTor(0.24, 0.012, null, 6, 32), bolt, 0, 0.2, 0, PI / 2); ring.castShadow = false;
    var orbit = Grp(g, 0, 0.42, 0), sparks = [];
    for (var i = 0; i < 5; i++) {
      var sk = Grp(orbit, 0, 0, 0); sk.userData = { r: 0.28 + (i % 2) * 0.05, ph: i * PI * 2 / 5, y: (i % 3 - 1) * 0.15, sp: 1.5 + i * 0.25 };
      P(sk, gOct(0.035), bolt, 0, 0, 0).castShadow = false; sk.add(glowSprite(0xffd060, 0.16, 0.9));
      sparks.push(sk);
    }
    g.userData.headY = 0.62;
    return function (t) {
      for (var i = 0; i < sparks.length; i++) { var d = sparks[i].userData, a = t * d.sp + d.ph; sparks[i].position.set(Math.cos(a) * d.r, d.y + Math.sin(t * 3 + i) * 0.04, Math.sin(a) * d.r); sparks[i].rotation.y = a * 2; }
      aura.material.opacity = 0.26 + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.3) * 0.04;
      ring.rotation.z = t * 2; ring.position.y = 0.2 + Math.sin(t * 2.5) * 0.04;
      g.position.y = Math.sin(t * 2) * 0.012 + 0.012;
    };
  };

  // ---------------- MARKSMAN (forest green) ----------------
  BUILD.ranger = function (g, pal) {
    var green = mStd(pal.main, 0.75, 0), dgreen = mStd(pal.dark, 0.8, 0, { side: THREE.DoubleSide }), leather = mStd(0x7a5232, 0.7, 0), wood = mStd(0x8a5a2a, 0.6, 0), skin = mStd(SKIN[0], 0.65, 0), str = mBasic(0xeeeedd);
    legs(g, mStd(0x3a3024, 0.8, 0), { r: 0.05, len: 0.12, boot: leather });
    torso(g, green, { rb: 0.11, rt: 0.14, h: 0.26 });
    P(g, gTor(0.115, 0.02), leather, 0, 0.23, 0, PI / 2);
    P(g, gBox(0.02, 0.3, 0.02), leather, 0, 0.36, 0.12, 0, 0, 0.6);
    var cl = Grp(g, 0, 0.5, -0.02); P(cl, gCyl(0.14, 0.23, 0.44, 16, true, PI * 0.5, PI), dgreen, 0, -0.22, 0);
    head(g, skin, { r: 0.11, y: 0.6 });
    // hood: cone + back shell
    P(g, gSph(0.135, 16), green, 0, 0.615, -0.025, 0, 0, 0, 1, 1, 1.05);
    P(g, gCone(0.115, 0.2, 14), green, 0, 0.73, -0.06, -0.55, 0, 0);
    P(g, gSph(0.112, 14), mStd(0x101410, 0.9, 0), 0, 0.605, 0.03, 0, 0, 0, 0.95, 0.95, 0.85);
    head(g, skin, { r: 0.095, y: 0.595, noEyes: false }).position.z = 0.04;
    // quiver
    var q = Grp(g, 0.07, 0.42, -0.14); q.rotation.set(0.15, 0, -0.35);
    P(q, gCyl(0.045, 0.04, 0.26, 10), leather, 0, 0, 0);
    for (var i = 0; i < 3; i++) { P(q, gCyl(0.006, 0.006, 0.1, 4), wood, (i - 1) * 0.02, 0.16, 0); P(q, gBox(0.025, 0.04, 0.004), mStd(i === 1 ? 0xd8d0c0 : 0xc23a2a, 0.7, 0), (i - 1) * 0.02, 0.22, 0); }
    // longbow in the left hand
    var la = arm(g, -1, green, { out: 0.35, fwd: 0.9, handMat: skin });
    var bow = Grp(la.holder, 0, 0, 0.02); bow.rotation.set(0, PI / 2 - 0.25, 0.1);
    P(bow, gTor(0.34, 0.017, PI * 0.82, 6, 24), wood, 0, 0, 0, 0, 0, PI / 2 + PI * 0.09 + PI);
    P(bow, gCyl(0.004, 0.004, 0.64, 4), str, -0.04, 0, 0).castShadow = false;
    P(bow, gCyl(0.02, 0.02, 0.06, 6), leather, -0.34, 0, 0);
    arm(g, 1, green, { out: 0.3, fwd: 0.6, handMat: skin });
    g.userData.headY = 0.62;
    return function (t) { cl.rotation.x = 0.1 + Math.sin(t * 1.7) * 0.06; };
  };
  BUILD.gunslinger = function (g, pal) {
    var green = mStd(pal.main, 0.7, 0), dgreen = mStd(pal.dark, 0.75, 0, { side: THREE.DoubleSide }), leather = mStd(0x6a4428, 0.65, 0), hat = mStd(0x5a3e26, 0.7, 0), metal = mStd(0x2a2a30, 0.3, 0.85), wood = mStd(0x7a4a24, 0.55, 0), skin = mStd(SKIN[1], 0.65, 0), red = mStd(0xb8282a, 0.7, 0);
    legs(g, mStd(0x2e2a26, 0.8, 0), { r: 0.05, len: 0.13, boot: leather });
    // long coat
    P(g, gCyl(0.13, 0.2, 0.34, 18, true), dgreen, 0, 0.27, 0);
    torso(g, green, { rb: 0.11, rt: 0.145, h: 0.26 });
    P(g, gTor(0.12, 0.02), leather, 0, 0.24, 0, PI / 2); P(g, gBox(0.04, 0.035, 0.02), mStd(pal.trim, 0.3, 0.9), 0, 0.24, 0.12);
    P(g, gCone(0.13, 0.12, 16), red, 0, 0.5, 0.0, PI);
    head(g, skin, { r: 0.11, y: 0.6 });
    // wide-brim hat
    var hg = Grp(g, 0, 0.68, 0); hg.rotation.x = 0.12;
    P(hg, gCyl(0.25, 0.25, 0.018, 24), hat, 0, 0, 0);
    P(hg, gCyl(0.1, 0.12, 0.13, 16), hat, 0, 0.07, 0);
    P(hg, gTor(0.115, 0.014), mStd(pal.main, 0.5, 0), 0, 0.025, 0, PI / 2);
    P(hg, gBox(0.02, 0.03, 0.06), mStd(pal.trim, 0.4, 0.6), 0.1, 0.03, 0.04, 0, 0.6, 0);
    // long rifle across the body
    var ra = arm(g, 1, green, { out: 0.2, fwd: 0.9, handMat: leather });
    arm(g, -1, green, { out: 0.2, fwd: 1.1, handMat: leather });
    var rf = Grp(g, 0.0, 0.36, 0.17); rf.rotation.set(0, 0, 0.75);
    P(rf, gCyl(0.016, 0.016, 0.72, 8), metal, 0, 0.12, 0);
    P(rf, gBox(0.05, 0.22, 0.04), wood, 0, -0.25, 0);
    P(rf, gBox(0.035, 0.08, 0.05), metal, 0, -0.1, 0);
    P(rf, gCyl(0.02, 0.02, 0.12, 8), metal, 0.03, 0.0, 0);
    P(rf, gCyl(0.022, 0.016, 0.04, 8), mStd(pal.trim, 0.3, 0.8), 0, 0.47, 0);
    g.userData.headY = 0.62;
    return function (t) { hg.rotation.z = Math.sin(t * 1.4) * 0.03; rf.rotation.z = 0.75 + Math.sin(t * 1.4) * 0.02; };
  };
  BUILD.artillerist = function (g, pal) {
    var green = mStd(pal.main, 0.7, 0.05), dark = mStd(pal.dark, 0.7, 0), brass = mStd(0xd8a84a, 0.3, 0.9), iron = mStd(0x34343a, 0.35, 0.8), skin = mStd(SKIN[0], 0.65, 0), lens = mEmi(0x402000, 0xffb040, 1.8), leather = mStd(0x6a4428, 0.7, 0);
    legs(g, dark, { r: 0.06, len: 0.08, spread: 0.075, boot: leather });
    torso(g, green, { rb: 0.135, rt: 0.16, h: 0.25, sx: 1.08 });
    P(g, gTor(0.135, 0.024), leather, 0, 0.22, 0, PI / 2);
    for (var i = -1; i <= 1; i++) P(g, gCyl(0.018, 0.018, 0.05, 8), brass, i * 0.045, 0.25, 0.13, PI / 2);
    head(g, skin, { r: 0.12, y: 0.58 });
    P(g, gSph(0.124, 14, 8), mStd(0x7a5a3a, 0.8, 0), 0, 0.6, -0.01, -0.3, 0, 0, 1, 0.75, 1);
    // goggles on forehead
    P(g, gTor(0.122, 0.014), leather, 0, 0.64, 0, PI / 2 - 0.2);
    for (var s = -1; s <= 1; s += 2) { P(g, gTor(0.034, 0.012, null, 6, 14), brass, s * 0.045, 0.665, 0.105, -0.35); P(g, gCyl(0.032, 0.032, 0.01, 12), lens, s * 0.045, 0.666, 0.108, PI / 2 - 0.35); }
    // backpack + cannon over right shoulder
    var bp = Grp(g, 0, 0.36, -0.15);
    P(bp, gBox(0.24, 0.26, 0.12), leather, 0, 0, 0);
    P(bp, gBox(0.26, 0.04, 0.13), iron, 0, 0.08, 0);
    P(bp, gCyl(0.04, 0.04, 0.12, 10), brass, -0.08, -0.12, 0.02, 0, 0, PI / 2);
    var cn = Grp(g, 0.13, 0.55, -0.08); cn.rotation.set(-1.15, 0, 0);
    P(cn, gCyl(0.075, 0.09, 0.5, 16), iron, 0, 0.12, 0);
    P(cn, gTor(0.08, 0.018), brass, 0, 0.36, 0, PI / 2); P(cn, gTor(0.09, 0.018), brass, 0, -0.05, 0, PI / 2); P(cn, gTor(0.085, 0.014), brass, 0, 0.15, 0, PI / 2);
    P(cn, gCyl(0.05, 0.05, 0.02, 12), mBasic(0x120a08), 0, 0.375, 0, 0, 0, 0).castShadow = false;
    P(cn, gSph(0.09, 12), iron, 0, -0.13, 0);
    var a1 = arm(g, 1, green, { out: 0.4, fwd: 0.4, handMat: leather }), a2 = arm(g, -1, green, { out: 0.35, fwd: 0.5, handMat: leather });
    P(a2.holder, gCyl(0.03, 0.03, 0.09, 8), brass, 0, 0.02, 0.02, PI / 2);
    g.userData.headY = 0.6;
    return function (t) { cn.rotation.x = -1.15 + Math.sin(t * 1.3) * 0.04; cn.position.y = 0.55 + Math.sin(t * 1.3) * 0.008; };
  };

  // ---------------- PHANTOM (smoky violet) ----------------
  BUILD.shade = function (g, pal) {
    var cloak = mStd(pal.main, 0.8, 0, { transparent: true, opacity: 0.78, side: THREE.DoubleSide }), inner = mStd(0x0a0612, 0.9, 0), dark = mStd(pal.dark, 0.8, 0, { transparent: true, opacity: 0.85 });
    var body = Grp(g, 0, 0.06, 0);
    // tattered conical cloak
    var cg = geo('shadeCloak', function () {
      var c = new THREE.ConeGeometry(0.27, 0.66, 18, 3, true), p = c.attributes.position;
      for (var i = 0; i < p.count; i++) { var y = p.getY(i); if (y < -0.3) { var a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, y + (Math.sin(a * 7) * 0.5 + 0.5) * 0.09); } }
      c.computeVertexNormals(); return c;
    });
    var cm = P(body, cg, cloak, 0, 0.3, 0);
    P(body, gCyl(0.12, 0.2, 0.4, 16), dark, 0, 0.25, 0);
    // hood with a void inside and glowing eyes
    P(body, gSph(0.15, 16), cloak, 0, 0.62, -0.02, 0, 0, 0, 1, 1.05, 1.1);
    P(body, gCone(0.11, 0.2, 12), cloak, 0, 0.74, -0.09, -0.75, 0, 0);
    P(body, gSph(0.12, 14), inner, 0, 0.6, 0.045, 0, 0, 0, 1, 1, 0.8);
    eyesGlow(body, 0xe8d0ff, 0.62, 0.135, 0.042, 0.02);
    var eg = glowSprite(0xc8a0ff, 0.3, 0.55); eg.position.set(0, 0.62, 0.14); body.add(eg);
    for (var s = -1; s <= 1; s += 2) { var sl = P(body, gCone(0.06, 0.24, 8, 1), cloak, s * 0.17, 0.38, 0.02, 0, 0, s * 0.35); }
    var wisp = glowSprite(pal.glow, 0.9, 0.18); wisp.position.y = 0.2; body.add(wisp);
    g.userData.headY = 0.68;
    return function (t) { body.position.y = 0.06 + Math.sin(t * 1.8) * 0.035; cm.scale.set(1 + Math.sin(t * 3) * 0.03, 1, 1 + Math.cos(t * 2.6) * 0.03); cm.rotation.y = t * 0.3; };
  };
  BUILD.specter = function (g, pal) {
    var robe1 = mStd(pal.main, 0.7, 0), dark = mStd(pal.dark, 0.8, 0), bone = mStd(0xf2ece0, 0.35, 0.05), slit = mBasic(0x0a0610), steel = mStd(0xdadce8, 0.2, 0.9), vio = mEmi(0x401060, 0xb070ff, 1.5);
    var body = Grp(g, 0, 0.04, 0);
    robe(body, dark, { rb: 0.2, rt: 0.12, h: 0.42 });
    torso(body, robe1, { rb: 0.12, rt: 0.15, h: 0.24, y: 0.22 });
    P(body, gTor(0.12, 0.02), mStd(pal.trim, 0.5, 0.2), 0, 0.26, 0, PI / 2);
    P(body, gSph(0.15, 16), dark, 0, 0.62, -0.03, 0, 0, 0, 1.05, 1.08, 1); // hood
    P(body, gCone(0.13, 0.1, 14), dark, 0, 0.5, 0, PI);
    // the mask
    var mask = Grp(body, 0, 0.6, 0.11); mask.rotation.x = -0.35;
    P(mask, gSph(0.13, 18), bone, 0, 0, 0, 0, 0, 0, 0.95, 1.15, 0.6);
    P(mask, gBox(0.055, 0.016, 0.04), slit, -0.045, 0.02, 0.06, 0, 0, -0.25).castShadow = false; P(mask, gBox(0.055, 0.016, 0.04), slit, 0.045, 0.02, 0.06, 0, 0, 0.25).castShadow = false;
    P(mask, gSph(0.012, 8), mBasic(0xff60d0), -0.045, 0.02, 0.075).castShadow = false; P(mask, gSph(0.012, 8), mBasic(0xff60d0), 0.045, 0.02, 0.075).castShadow = false;
    P(mask, gBox(0.012, 0.05, 0.02), mStd(pal.main, 0.5, 0), 0, -0.06, 0.065);
    P(mask, gBox(0.07, 0.008, 0.02), slit, 0, -0.06, 0.063).castShadow = false;
    for (var s = -1; s <= 1; s += 2) arm(body, s, robe1, { out: 0.5, fwd: 0.5, handMat: bone });
    // orbiting daggers
    var orb = Grp(body, 0, 0.36, 0), daggers = [];
    for (var i = 0; i < 4; i++) {
      var d = Grp(orb, 0, 0, 0); d.userData.ph = i * PI / 2;
      var dd = Grp(d, 0.34, 0, 0); dd.rotation.set(0, 0, -PI / 2);
      P(dd, gBox(0.03, 0.16, 0.008), steel, 0, 0.06, 0); P(dd, gCone(0.015, 0.04, 4), steel, 0, 0.16, 0);
      P(dd, gBox(0.06, 0.015, 0.02), vio, 0, -0.025, 0); P(dd, gCyl(0.012, 0.012, 0.05, 6), dark, 0, -0.055, 0);
      daggers.push(d);
    }
    g.userData.headY = 0.68;
    return function (t) {
      body.position.y = 0.04 + Math.sin(t * 1.6) * 0.025;
      orb.rotation.y = t * 1.2; orb.rotation.z = Math.sin(t * 0.7) * 0.12;
      for (var i = 0; i < daggers.length; i++) daggers[i].rotation.y = daggers[i].userData.ph;
      mask.rotation.z = Math.sin(t * 0.9) * 0.06;
    };
  };
  BUILD.veilblade = function (g, pal) {
    var suit = mStd(0x3c3058, 0.5, 0.2), vio = mStd(0xa070e8, 0.45, 0.1, { emissive: 0x5a2aa0, emissiveIntensity: 0.4 }), wrap = mStd(0x4a3a68, 0.65, 0), glow = mBasic(0xd8a8ff), steel = mStd(0xe2e4ee, 0.2, 0.9), skinM = mStd(SKIN[1], 0.65, 0);
    var body = Grp(g, 0, 0, 0);
    legs(body, suit, { r: 0.045, len: 0.13, spread: 0.07, boot: wrap });
    var up = Grp(body, 0, 0.2, 0); up.rotation.x = 0.1;
    torso(up, suit, { rb: 0.1, rt: 0.13, h: 0.25, y: 0 });
    P(up, gTor(0.102, 0.02), vio, 0, 0.03, 0, PI / 2);
    P(up, gBox(0.2, 0.025, 0.02), vio, 0, 0.17, 0.08, 0, 0, 0.7);
    var hd = head(up, wrap, { r: 0.108, y: 0.39, noEyes: true });
    P(up, gBox(0.17, 0.035, 0.05), skinM, 0, 0.405, 0.085);
    P(up, gBox(0.16, 0.02, 0.03), glow, 0, 0.405, 0.108).castShadow = false; var vg = glowSprite(0xc090ff, 0.32, 0.5); vg.position.set(0, 0.405, 0.12); up.add(vg);
    var tails = Grp(up, 0, 0.42, -0.1);
    P(tails, gBox(0.025, 0.01, 0.2), vio, 0.025, 0, -0.09, 0.3, 0.2, 0); P(tails, gBox(0.025, 0.01, 0.17), vio, -0.025, -0.02, -0.08, 0.5, -0.2, 0);
    // katana on the back
    var kt = Grp(up, 0, 0.2, -0.12); kt.rotation.set(0, 0, 0.8);
    P(kt, gBox(0.024, 0.44, 0.012), steel, 0, -0.03, 0); P(kt, gCyl(0.018, 0.018, 0.13, 6), vio, 0, 0.25, 0); P(kt, gCyl(0.035, 0.035, 0.012, 10), mStd(pal.trim, 0.3, 0.8), 0, 0.185, 0, 0, 0, 0);
    for (var s = -1; s <= 1; s += 2) {
      var a = arm(up, s, suit, { y: 0.21, out: 0.55, fwd: s > 0 ? 0.9 : 0.2, len: 0.1, r: 0.036, handMat: wrap });
      if (s > 0) { var kn = Grp(a.holder, 0, 0, 0); kn.rotation.set(0.4, 0, -1.4); P(kn, gBox(0.018, 0.13, 0.006), steel, 0, 0.07, 0); }
    }
    var wisps = [];
    for (var i = 0; i < 4; i++) { var w = glowSprite(pal.glow, 0.18, 0.5, 'soft'); w.userData.ph = i / 4; body.add(w); wisps.push(w); }
    g.userData.headY = 0.62;
    return function (t) {
      up.rotation.x = 0.1 + Math.sin(t * 2.2) * 0.03; tails.rotation.x = Math.sin(t * 5) * 0.2;
      for (var i = 0; i < wisps.length; i++) { var k = (t * 0.6 + wisps[i].userData.ph) % 1; wisps[i].position.set(Math.sin(i * 2.1 + t) * 0.12, 0.15 + k * 0.5, -0.12 - k * 0.25); wisps[i].material.opacity = 0.45; wisps[i].scale.setScalar(0.2 * (1 - k)); }
    };
  };

  // ---------------- LIFEBINDER (teal and gold) ----------------
  BUILD.verdant = function (g, pal) {
    var teal = mStd(pal.main, 0.65, 0.05), dteal = mStd(pal.dark, 0.7, 0), gold = mStd(pal.trim, 0.3, 0.85), wood = mStd(0x6a4428, 0.8, 0), leaf = mStd(0x58b83a, 0.6, 0, { side: THREE.DoubleSide }), skin = mStd(SKIN[1], 0.65, 0), seed = mEmi(0xb0ff60, 0x9cff40, 2.2), hair = mStd(0x6a3e1e, 0.8, 0);
    robe(g, teal, { rb: 0.2, rt: 0.13, h: 0.46 });
    P(g, gTor(0.19, 0.014, null, 6, 28), gold, 0, 0.03, 0, PI / 2);
    P(g, gTor(0.135, 0.02), mStd(0x8a6a3a, 0.7, 0), 0, 0.3, 0, PI / 2);
    P(g, gBox(0.06, 0.32, 0.01), gold, 0, 0.17, 0.165, -0.33, 0, 0);
    head(g, skin, { r: 0.115, y: 0.59 });
    P(g, gSph(0.12, 14), hair, 0, 0.61, -0.025, -0.35, 0, 0, 1, 0.9, 1.05);
    P(g, gCyl(0.06, 0.035, 0.18, 8), hair, 0, 0.47, -0.08, 0.2, 0, 0);
    // leafy crown
    var crown = Grp(g, 0, 0.68, 0);
    for (var i = 0; i < 9; i++) {
      var a = i / 9 * PI * 2, lf = Grp(crown, Math.sin(a) * 0.1, 0, Math.cos(a) * 0.1); lf.rotation.set(0, a, 0);
      P(lf, gSph(0.05, 8), leaf, 0, 0.04, 0.02, -0.5, 0, 0, 0.45, 1, 0.18);
    }
    P(crown, gSph(0.02, 8), mEmi(0xffe080, 0xffd040, 1.5), 0.0, 0.02, 0.11);
    // staff with glowing seed
    var a2 = arm(g, 1, teal, { out: 0.3, fwd: 0.5, handMat: skin });
    arm(g, -1, teal, { out: 0.3, fwd: 0.3, handMat: skin });
    var st = Grp(a2.holder, 0, 0, 0.01);
    P(st, gCyl(0.018, 0.024, 0.85, 6), wood, 0, 0.13, 0);
    for (var k = 0; k < 3; k++) { var cl = Grp(st, 0, 0.55, 0); cl.rotation.y = k * PI * 2 / 3; P(cl, gCone(0.014, 0.14, 5), wood, 0.04, 0.05, 0, 0, 0, -0.5); }
    P(st, gSph(0.045, 8), leaf, 0.03, 0.45, 0, 0, 0, 0.8, 0.5, 1, 0.2);
    var sd = P(st, gSph(0.05, 14), seed, 0, 0.62, 0); sd.castShadow = false;
    var sg = glowSprite(0xb0ff70, 0.45, 0.7); sg.position.y = 0.62; st.add(sg);
    g.userData.headY = 0.6;
    return function (t) { var p = 1 + Math.sin(t * 2.6) * 0.12; sd.scale.setScalar(p); sg.scale.setScalar(0.42 * p); crown.rotation.y = Math.sin(t) * 0.08; };
  };
  BUILD.seraph = function (g, pal) {
    var ivory = mStd(0xf4ecdc, 0.55, 0.05), teal = mStd(pal.main, 0.6, 0.05), gold = mStd(pal.trim, 0.25, 0.95), wingM = mStd(0xfffaf0, 0.5, 0, { emissive: 0xffe8b0, emissiveIntensity: 0.25, side: THREE.DoubleSide }), skin = mStd(SKIN[3], 0.6, 0), hair = mStd(0xf0c050, 0.5, 0.1), halo = mBasic(0xffe080);
    robe(g, ivory, { rb: 0.19, rt: 0.12, h: 0.46 });
    P(g, gTor(0.185, 0.016, null, 6, 28), gold, 0, 0.035, 0, PI / 2);
    P(g, gTor(0.13, 0.024), teal, 0, 0.3, 0, PI / 2);
    P(g, gBox(0.07, 0.3, 0.01), teal, 0, 0.16, 0.16, -0.33, 0, 0);
    head(g, skin, { r: 0.112, y: 0.59 });
    P(g, gSph(0.118, 14), hair, 0, 0.61, -0.02, -0.4, 0, 0, 1.02, 0.95, 1.05);
    P(g, gSph(0.07, 10), hair, 0, 0.53, -0.08, 0, 0, 0, 1.2, 1.3, 0.8);
    var hg = Grp(g, 0, 0.8, 0), hl = P(hg, gTor(0.1, 0.016, null, 8, 32), halo, 0, 0, 0, PI / 2 - 0.25); hl.castShadow = false;
    var hs = glowSprite(0xffd860, 0.42, 0.55); hg.add(hs);
    // wings
    var wing = function (s) { s.moveTo(0, 0); s.quadraticCurveTo(0.12, 0.2, 0.34, 0.24); s.lineTo(0.29, 0.15); s.lineTo(0.33, 0.11); s.lineTo(0.25, 0.06); s.lineTo(0.28, 0.0); s.lineTo(0.17, -0.02); s.quadraticCurveTo(0.07, -0.06, 0, 0); };
    var wings = [];
    for (var s = -1; s <= 1; s += 2) {
      var wp = Grp(g, s * 0.05, 0.43, -0.1); var w = P(wp, gShape('wing', wing, 0.018, 0.004), wingM, 0, 0, 0, 0, 0, 0, s, 1, 1);
      wp.rotation.y = s * 0.5; wings.push(wp);
    }
    var ra = arm(g, 1, ivory, { out: 0.3, fwd: 0.5, handMat: skin }); arm(g, -1, ivory, { out: 0.35, fwd: 0.6, handMat: skin });
    var st = Grp(ra.holder, 0, 0, 0.01);
    P(st, gCyl(0.014, 0.014, 0.82, 6), gold, 0, 0.13, 0);
    P(st, gTor(0.06, 0.011, null, 6, 20), gold, 0, 0.6, 0);
    var so = P(st, gSph(0.035, 12), mEmi(0xd0fff4, 0x80ffe0, 2.2), 0, 0.6, 0); so.castShadow = false;
    var sos = glowSprite(0x80ffe0, 0.3, 0.6); sos.position.y = 0.6; st.add(sos);
    g.userData.headY = 0.6;
    return function (t) {
      var f = Math.sin(t * 3.2) * 0.25; wings[0].rotation.y = -0.5 - f; wings[1].rotation.y = 0.5 + f;
      hg.position.y = 0.8 + Math.sin(t * 2) * 0.02; hl.rotation.z = t * 0.8;
      g.position.y = 0.01 + Math.sin(t * 1.6) * 0.012;
    };
  };
  BUILD.bloodoracle = function (g, pal) {
    var crimson = mStd(0x9a1a2c, 0.6, 0.05), dcrim = mStd(0x4a0a16, 0.7, 0), gold = mStd(pal.trim, 0.28, 0.9), teal = mStd(pal.main, 0.6, 0), skin = mStd(0xf0dcd0, 0.55, 0), orbM = mEmi(0xff2030, 0xff1020, 2.4);
    robe(g, crimson, { rb: 0.21, rt: 0.13, h: 0.46 });
    P(g, gTor(0.205, 0.016, null, 6, 28), gold, 0, 0.035, 0, PI / 2);
    P(g, gTor(0.135, 0.022), teal, 0, 0.3, 0, PI / 2);
    P(g, gBox(0.05, 0.3, 0.01), gold, 0, 0.16, 0.168, -0.34, 0, 0);
    head(g, skin, { r: 0.108, y: 0.585, noEyes: true });
    P(g, gBox(0.03, 0.008, 0.01), mStd(0x3a1010, 0.5, 0), -0.04, 0.59, 0.104).castShadow = false; P(g, gBox(0.03, 0.008, 0.01), mStd(0x3a1010, 0.5, 0), 0.04, 0.59, 0.104).castShadow = false;
    P(g, gSph(0.012, 8), mBasic(0xff3040), 0, 0.64, 0.1).castShadow = false;
    // crimson hood with gold rim
    P(g, gSph(0.14, 16), crimson, 0, 0.61, -0.035, 0, 0, 0, 1.02, 1.05, 1.05);
    P(g, gCone(0.11, 0.17, 14), crimson, 0, 0.73, -0.06, -0.4, 0, 0);
    P(g, gTor(0.115, 0.012, PI * 1.2, 6, 20), gold, 0, 0.6, 0.06, 0, 0, -0.1 * PI);
    P(g, gCone(0.14, 0.12, 14), dcrim, 0, 0.5, 0, PI);
    for (var s = -1; s <= 1; s += 2) arm(g, s, crimson, { out: 0.75, fwd: 0.9, handMat: skin });
    // floating blood orb with droplets
    var og = Grp(g, 0, 0.5, 0.25);
    var orb = P(og, gSph(0.075, 18), orbM, 0, 0, 0); orb.castShadow = false;
    var os = glowSprite(0xff2a3a, 0.55, 0.7); og.add(os);
    var drops = [];
    for (var i = 0; i < 3; i++) { var d = P(og, gSph(0.018, 8), orbM, 0, 0, 0); d.castShadow = false; drops.push(d); }
    g.userData.headY = 0.6;
    return function (t) {
      og.position.y = 0.52 + Math.sin(t * 1.8) * 0.035;
      var p = 1 + Math.sin(t * 4) * 0.08; orb.scale.setScalar(p); os.scale.setScalar(0.55 * p);
      for (var i = 0; i < drops.length; i++) { var a = t * 2.5 + i * PI * 2 / 3; drops[i].position.set(Math.cos(a) * 0.12, Math.sin(a * 1.3) * 0.03, Math.sin(a) * 0.12); }
    };
  };

  // ---------------- HEXER (corruption magenta) ----------------
  BUILD.rotcaller = function (g, pal) {
    var robeM = mStd(0x4a1a48, 0.8, 0), mag = mStd(pal.main, 0.6, 0.05), bone = mStd(0xe8dcc0, 0.5, 0), root = mStd(0x4a3020, 0.85, 0), glowM = mEmi(0x600050, pal.glow, 2.4), inner = mStd(0x08040a, 0.9, 0);
    robe(g, robeM, { rb: 0.21, rt: 0.13, h: 0.36 });
    P(g, gTor(0.205, 0.016, null, 6, 28), mag, 0, 0.03, 0, PI / 2);
    var up = Grp(g, 0, 0.3, 0.0); up.rotation.x = 0.45;
    torso(up, robeM, { rb: 0.13, rt: 0.17, h: 0.22, y: 0, sx: 1.05 });
    P(up, gSph(0.14, 12), mag, 0, 0.18, -0.06, 0, 0, 0, 1.2, 0.8, 1); // hump
    var hd = Grp(up, 0, 0.28, 0.06); hd.rotation.x = -0.35;
    P(hd, gSph(0.135, 16), mag, 0, 0, -0.01, 0, 0, 0, 1, 1.05, 1.1);
    P(hd, gSph(0.105, 14), inner, 0, -0.01, 0.045, 0, 0, 0, 1, 1, 0.8);
    eyesGlow(hd, 0xd4ff50, 0.0, 0.13, 0.038, 0.017);
    // curling horns
    for (var s = -1; s <= 1; s += 2) {
      var h = Grp(hd, s * 0.09, 0.07, -0.02); h.rotation.set(0, s * -0.4, s * -0.3);
      P(h, gTor(0.075, 0.022, PI * 1.1, 6, 14), bone, 0, 0.07, 0, 0, PI / 2, 0, 1, 1, 1);
    }
    for (var s2 = -1; s2 <= 1; s2 += 2) arm(up, s2, robeM, { y: 0.17, out: 0.35, fwd: s2 > 0 ? 0.9 : 0.4, len: 0.1, handMat: bone });
    // twisted root staff (TubeGeometry helix strands)
    var st = Grp(g, 0.22, 0.0, 0.16);
    var strand = geo('rootStrand', function () {
      var pts = []; for (var i = 0; i <= 16; i++) { var y = i / 16 * 0.9, a = y * 11; pts.push(new THREE.Vector3(Math.cos(a) * 0.022, y, Math.sin(a) * 0.022)); }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.013, 5, false);
    });
    for (var k = 0; k < 3; k++) P(st, strand, root, 0, 0, 0, 0, k * PI * 2 / 3, 0);
    for (var k2 = 0; k2 < 4; k2++) { var br = Grp(st, 0, 0.88, 0); br.rotation.y = k2 * PI / 2; P(br, gCone(0.012, 0.12, 4), root, 0.035, 0.03, 0, 0, 0, -0.8); }
    var kn = P(st, gIco(0.045, 0), glowM, 0, 0.94, 0); kn.castShadow = false;
    var ks = glowSprite(pal.glow, 0.4, 0.7); ks.position.y = 0.94; st.add(ks);
    g.userData.headY = 0.62;
    return function (t) { up.rotation.x = 0.45 + Math.sin(t * 1.5) * 0.04; kn.rotation.y = t * 1.5; ks.material.opacity = 0.6 + Math.sin(t * 5) * 0.1; st.rotation.z = Math.sin(t * 1.5) * 0.03; };
  };
  BUILD.witchlight = function (g, pal) {
    var robeM = mStd(0x5a1a5a, 0.7, 0), mag = mStd(pal.main, 0.55, 0.05), hatM = mStd(0x2a1030, 0.7, 0), gold = mStd(0xe0b050, 0.3, 0.85), skin = mStd(0xe8d0e8, 0.6, 0), hair = mStd(0x8a3aa0, 0.7, 0), wood = mStd(0x3a2618, 0.8, 0), flame = mBasic(0xff70ff, { transparent: true, opacity: 0.9 }), iron = mStd(0x2a2028, 0.4, 0.7);
    robe(g, robeM, { rb: 0.19, rt: 0.12, h: 0.46 });
    P(g, gTor(0.185, 0.016, null, 6, 28), mag, 0, 0.03, 0, PI / 2);
    P(g, gTor(0.125, 0.02), gold, 0, 0.3, 0, PI / 2);
    head(g, skin, { r: 0.11, y: 0.58 });
    P(g, gCyl(0.1, 0.12, 0.3, 12, false), hair, 0, 0.47, -0.05);
    P(g, gSph(0.115, 14), hair, 0, 0.6, -0.03, -0.3, 0, 0, 1.05, 0.9, 1.05);
    // tall bent pointed hat
    var hg = Grp(g, 0, 0.66, -0.01); hg.rotation.x = -0.08;
    P(hg, gCyl(0.24, 0.24, 0.016, 26), hatM, 0, 0, 0);
    P(hg, gCyl(0.075, 0.12, 0.2, 16), hatM, 0, 0.1, 0);
    P(hg, gTor(0.112, 0.016), mag, 0, 0.03, 0, PI / 2);
    P(hg, gBox(0.04, 0.035, 0.02), gold, 0, 0.03, 0.115);
    var tip = Grp(hg, 0, 0.2, 0); tip.rotation.x = -0.45;
    P(tip, gCyl(0.03, 0.075, 0.16, 12), hatM, 0, 0.08, 0);
    var tip2 = Grp(tip, 0, 0.16, 0); tip2.rotation.x = -0.6; P(tip2, gCone(0.03, 0.12, 10), hatM, 0, 0.06, 0);
    // lantern on a crooked stick
    var ra = arm(g, 1, robeM, { out: 0.55, fwd: 0.85, handMat: skin }); arm(g, -1, robeM, { out: 0.3, fwd: 0.3, handMat: skin });
    var stick = Grp(ra.holder, 0, 0, 0); stick.rotation.set(0.6, 0, -0.3);
    P(stick, gCyl(0.012, 0.012, 0.3, 5), wood, 0, 0.12, 0);
    var lan = Grp(stick, 0, 0.26, 0.0), lp = Grp(lan, 0, 0, 0);
    lan.rotation.x = -0.6;
    P(lp, gCyl(0.004, 0.004, 0.07, 4), iron, 0, -0.035, 0);
    var body = Grp(lp, 0, -0.12, 0);
    P(body, gCyl(0.045, 0.05, 0.02, 8), iron, 0, 0.055, 0); P(body, gCone(0.05, 0.04, 8), iron, 0, 0.08, 0);
    P(body, gCyl(0.05, 0.045, 0.02, 8), iron, 0, -0.055, 0);
    P(body, gCyl(0.04, 0.04, 0.09, 8, true), mBasic(0xc040ff, { transparent: true, opacity: 0.45, side: THREE.DoubleSide }), 0, 0, 0).castShadow = false;
    var fl = P(body, gSph(0.026, 10), flame, 0, 0, 0); fl.castShadow = false; fl.scale.set(1, 1.5, 1);
    var fs = glowSprite(0xe060ff, 0.5, 0.85); body.add(fs);
    g.userData.headY = 0.6;
    return function (t) {
      lp.rotation.z = Math.sin(t * 2) * 0.25; lp.rotation.x = Math.cos(t * 1.7) * 0.15;
      var f = 1 + Math.sin(t * 17) * 0.1 + Math.sin(t * 9) * 0.08; fl.scale.set(f, 1.5 * f, f); fs.scale.setScalar(0.48 * f);
      tip.rotation.z = Math.sin(t * 1.4) * 0.08;
    };
  };
  BUILD.voidmask = function (g, pal) {
    var maskM = mStd(0xece2f2, 0.3, 0.1), rim = mStd(pal.main, 0.4, 0.3, { emissive: pal.main, emissiveIntensity: 0.35 }), glow = mBasic(0xff50f0), smoke = mStd(0x2a0a30, 0.9, 0, { transparent: true, opacity: 0.7 }), crys = mEmi(0x600060, pal.glow, 2.0);
    var body = Grp(g, 0, 0.0, 0);
    // smoky wisp body
    var sm = P(body, gCone(0.17, 0.42, 14, 1, true), smoke, 0, 0.26, 0, PI);
    P(body, gSph(0.12, 12), smoke, 0, 0.42, -0.02);
    var fog = glowSprite(0xa020c0, 0.8, 0.3); fog.position.y = 0.25; body.add(fog);
    // large floating mask
    var mk = Grp(body, 0, 0.6, 0.02);
    P(mk, gSph(0.19, 20), maskM, 0, 0, 0, 0, 0, 0, 0.92, 1.18, 0.55);
    P(mk, gTor(0.17, 0.016, null, 8, 32), rim, 0, 0, 0.0, 0, 0, 0, 0.92, 1.18, 1);
    var eyeG = function (s) { s.moveTo(-0.05, 0.012); s.lineTo(0.05, 0.03); s.lineTo(0.04, -0.014); s.lineTo(-0.045, -0.01); s.closePath(); };
    P(mk, gShape('voidEye', eyeG, 0.02), glow, -0.065, 0.03, 0.095, 0, 0.3, -0.25).castShadow = false;
    P(mk, gShape('voidEye', eyeG, 0.02), glow, 0.065, 0.03, 0.095, 0, -0.3, PI + 0.25).castShadow = false;
    P(mk, gBox(0.012, 0.1, 0.02), glow, 0, -0.08, 0.095).castShadow = false;
    P(mk, gBox(0.008, 0.07, 0.02), glow, 0.03, 0.13, 0.08, 0, 0, -0.4).castShadow = false;
    for (var i = 0; i < 5; i++) { var a = (i - 2) * 0.42; P(mk, gCone(0.03, 0.13 - Math.abs(i - 2) * 0.025, 6), rim, Math.sin(a) * 0.17, 0.2 + Math.cos(a) * 0.02 - Math.abs(i - 2) * 0.02, -0.02, 0, 0, -a); }
    P(mk, gBox(0.006, 0.09, 0.012), mBasic(0x1a0820), -0.09, -0.06, 0.088, 0, 0, 0.5).castShadow = false; P(mk, gBox(0.005, 0.06, 0.012), mBasic(0x1a0820), 0.1, 0.07, 0.085, 0, 0, -0.3).castShadow = false;
    var ms = glowSprite(0xff40e0, 0.4, 0.3); ms.position.set(0, 0.03, 0.1); mk.add(ms);
    // orbiting octahedron crystals
    var orb = Grp(body, 0, 0.45, 0), cs = [];
    for (var j = 0; j < 3; j++) { var c = Grp(orb); c.userData.ph = j * PI * 2 / 3; P(c, gOct(0.06), crys, 0, 0, 0, 0, 0, 0, 0.8, 1.4, 0.8).castShadow = true; c.add(glowSprite(pal.glow, 0.22, 0.6)); cs.push(c); }
    g.userData.headY = 0.62;
    return function (t) {
      body.position.y = 0.05 + Math.sin(t * 1.7) * 0.04;
      mk.rotation.z = Math.sin(t * 0.8) * 0.08; mk.rotation.y = Math.sin(t * 0.6) * 0.15;
      for (var i = 0; i < cs.length; i++) { var a = t * 1.4 + cs[i].userData.ph; cs[i].position.set(Math.cos(a) * 0.3, Math.sin(t * 2 + i) * 0.08, Math.sin(a) * 0.3); cs[i].rotation.y = t * 3; }
      sm.scale.x = sm.scale.z = 1 + Math.sin(t * 3) * 0.05;
    };
  };

  // Base disc with glowing team rim
  function makeBase(teamHex) {
    var b = new THREE.Group();
    var d = P(b, gCyl(0.37, 0.4, 0.07, 32), mStd(0x2b2733, 0.5, 0.4), 0, 0.035, 0); d.receiveShadow = true;
    P(b, gCyl(0.33, 0.33, 0.074, 32), mStd(0x3a3544, 0.6, 0.25), 0, 0.037, 0).receiveShadow = true;
    var rm = mStd(teamHex, 0.35, 0.2, { emissive: teamHex, emissiveIntensity: 1.5 });
    P(b, gTor(0.368, 0.024, null, 8, 48), rm, 0, 0.07, 0, PI / 2).castShadow = false;
    P(b, gTor(0.33, 0.01, null, 6, 48), rm, 0, 0.075, 0, PI / 2).castShadow = false;
    var gp = new THREE.Mesh(gPlane(1.15), MAT['bg' + teamHex] || (MAT['bg' + teamHex] = addMat(teamHex, 'glow', 0.28)));
    gp.scale.setScalar(0.85); gp.position.y = 0.004; gp.renderOrder = 2; b.add(gp);
    return b;
  }

  // Public: build a full piece (base + model). Returns a THREE.Group with userData {idle, model, base, headY, cls, variant}.
  function buildPiece(clsId, variantId, colorHex) {
    var cls = normClass(clsId), v = normVariant(cls, variantId), pal = CLASS_PAL[cls];
    var root = new THREE.Group(), base = makeBase(toHex(colorHex == null ? 0xffd34d : colorHex));
    base.scale.setScalar(BASE_REL); root.add(base);
    var model = new THREE.Group(); model.position.y = 0.072 * BASE_REL; root.add(model);
    var inner = new THREE.Group(); model.add(inner);
    var idle = null;
    try { idle = BUILD[v](inner, pal); } catch (e) { console.error('VIEW piece build failed', cls, v, e); }
    root.userData = { idle: idle, model: model, inner: inner, base: base, headY: (inner.userData.headY || 0.62) + 0.072 * BASE_REL, cls: cls, variant: v, phase: Math.random() * 10 };
    root.scale.setScalar(PIECE_SCALE);
    return root;
  }

  /* ======================================================================
   * 7. Renderer, environment and the static world
   * ==================================================================== */
  function ensureRenderer() {
    if (renderer) return renderer;
    canvas = document.createElement('canvas');
    canvas.className = 'ltv-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;-webkit-user-select:none;user-select:none;outline:none;';
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    try { makeEnv(); } catch (e) { console.warn('VIEW env map failed', e); }
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); }, false);
    return renderer;
  }
  function makeEnv() {
    var es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ map: tex('sky'), side: THREE.BackSide })));
    var warm = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 2.4) }));
    warm.position.set(-6, 5, 5); es.add(warm);
    var cool = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.5, 2.6) }));
    cool.position.set(6, 3, -6); es.add(cool);
    var floor = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.18, 0.3) }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -3; es.add(floor);
    var pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromScene(es, 0.04).texture; pm.dispose();
    if (scene) scene.environment = envTex;
    for (var k in PEDS) if (PEDS[k].scene) PEDS[k].scene.environment = envTex;
  }
  function setSize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w !== curW || h !== curH) { renderer.setSize(w, h, false); curW = w; curH = h; }
  }

  var island = null, fragments = [], clouds = [], skyMesh = null, sunGlow = null;
  function buildWorld() {
    if (scene) return;
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x2c1d52, 0.0062);
    if (envTex) scene.environment = envTex;
    camera = new THREE.PerspectiveCamera(28, 0.5, 0.5, 900);
    world = Grp(scene); boardGroup = Grp(scene); fxGroup = Grp(scene);

    // Sky dome with gradient; stars as points
    skyMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 24), new THREE.MeshBasicMaterial({ map: tex('sky'), side: THREE.BackSide, fog: false, depthWrite: false }));
    skyMesh.renderOrder = -10; world.add(skyMesh);
    var sp = [], sc = [], i;
    for (i = 0; i < 700; i++) {
      var u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      var y = u; if (y < -0.15 && Math.random() < 0.55) y = -y; // more stars above
      sp.push(Math.cos(th) * rr * 470, y * 470, Math.sin(th) * rr * 470);
      var b = rnd(0.35, 1) * (y < 0 ? 0.55 : 1), tint = Math.random();
      sc.push(b * (tint > 0.7 ? 1 : 0.85), b * 0.88, b * (tint < 0.3 ? 0.8 : 1));
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    var stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, map: tex('spark'), vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    stars.renderOrder = -9; world.add(stars);
    sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: col(0xff9a70), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.55, toneMapped: false }));
    sunGlow.scale.set(260, 160, 1); sunGlow.position.set(-300, 8, 260); sunGlow.renderOrder = -8; world.add(sunGlow);

    // Lights
    var key = new THREE.DirectionalLight(0xffc890, 2.7);
    key.position.set(-7, 14, 8); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    var sc2 = key.shadow.camera; sc2.left = -10; sc2.right = 10; sc2.top = 10; sc2.bottom = -10; sc2.near = 2; sc2.far = 40;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.025;
    scene.add(key); scene.add(key.target);
    var hemi = new THREE.HemisphereLight(0x8c9cff, 0x3a2446, 0.55);
    scene.add(hemi);
    var rim = new THREE.DirectionalLight(0x9cbcff, 1.25); rim.position.set(6, 7, -10); scene.add(rim); scene.add(rim.target);
    var under = new THREE.PointLight(0xc040ff, 1.2, 26, 1.6); under.position.set(0, -5, 0); scene.add(under);
    lights = { key: key, hemi: hemi, rim: rim, under: under, base: { key: 2.7, hemi: 0.55, rim: 1.25, under: 1.2 } };

    buildIsland();
    buildClouds();

    PFX = new ParticlePool(900, true, 'soft'); scene.add(PFX.points);
    PDUST = new ParticlePool(260, false, 'soft'); scene.add(PDUST.points);
    PMOTE = new ParticlePool(220, true, 'spark'); scene.add(PMOTE.points);

    buildHelpersMeshes();
  }

  function squircle(theta, a, n) { var c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta)); return a / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n); }
  function rockGeo(radius, detail, amt, seed) {
    var g = new THREE.IcosahedronGeometry(radius, detail || 0), p = g.attributes.position, v = new THREE.Vector3();
    var map = {};
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      var k = v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3);
      if (map[k] == null) map[k] = 1 + (hash(v.x * 3, v.y * 3 + v.z * 5, seed) - 0.5) * amt;
      v.multiplyScalar(map[k]); p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals(); return g;
  }
  function buildIsland() {
    island = Grp(world);
    var SEG = 72, RINGS = 12, half = 6, a = 6.95, nexp = 7;
    var pos = [], colr = [], idx = [], i, j;
    var topC = new THREE.Color(0x6e5a4c), midC = new THREE.Color(0x4a3a4a), botC = new THREE.Color(0x24183a);
    for (i = 0; i <= RINGS; i++) {
      var t = i / RINGS;
      for (j = 0; j <= SEG; j++) {
        var th = (j % SEG) / SEG * Math.PI * 2, n1 = hash(i, j % SEG, 3), n2 = hash(i * 2.1, (j % SEG) * 1.3, 7);
        var base = squircle(th, a, nexp);
        var shrink = i === 0 ? 1 : Math.pow(1 - t, 0.85) * (0.92 + 0.12 * Math.sin(th * 3 + 1.3) * t) + (i < 3 ? 0.04 : 0);
        var r = base * shrink * (i === 0 ? 1 : (0.9 + n1 * 0.22));
        var y = BED - (i === 0 ? 0 : (Math.pow(t, 1.15) * 8.5 + (n2 - 0.5) * 0.6 + (i === 1 ? -0.25 : 0)));
        if (i === RINGS) r = 0.25;
        pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
        var c = t < 0.3 ? topC.clone().lerp(midC, t / 0.3) : midC.clone().lerp(botC, (t - 0.3) / 0.7);
        var sh = 0.85 + n2 * 0.3; colr.push(c.r * sh, c.g * sh, c.b * sh);
      }
    }
    for (i = 0; i < RINGS; i++) for (j = 0; j < SEG; j++) {
      var p0 = i * (SEG + 1) + j, p1 = p0 + 1, p2 = p0 + SEG + 1, p3 = p2 + 1;
      idx.push(p0, p1, p2, p1, p3, p2);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx); g = g.toNonIndexed(); g.computeVertexNormals();
    var rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05, flatShading: true, map: tex('rock') });
    var body = new THREE.Mesh(g, rockMat); body.receiveShadow = true; island.add(body);
    // top surface
    var shp = new THREE.Shape();
    for (j = 0; j <= SEG; j++) { var tt = j / SEG * Math.PI * 2, rr = squircle(tt, a, nexp); if (j) shp.lineTo(Math.cos(tt) * rr, Math.sin(tt) * rr); else shp.moveTo(Math.cos(tt) * rr, Math.sin(tt) * rr); }
    var tg = new THREE.ShapeGeometry(shp, 4); tg.rotateX(Math.PI / 2);
    var top = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: col(0x5c4c44), roughness: 0.95, map: tex('rock') }));
    top.position.y = BED + 0.001; top.receiveShadow = true; island.add(top);
    // rubble ring between board and the rim (instanced)
    var rub = new THREE.InstancedMesh(rockGeo(0.16, 0, 0.5, 2), new THREE.MeshStandardMaterial({ color: col(0x8a7a6a), roughness: 0.9, flatShading: true }), 90);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p3v = new THREE.Vector3(), cc = new THREE.Color();
    for (i = 0; i < 90; i++) {
      var ang = i / 90 * Math.PI * 2 + rnd(-0.03, 0.03), rad = squircle(ang, a, nexp) - rnd(0.15, 0.6);
      var px = Math.cos(ang) * rad, pz = Math.sin(ang) * rad;
      if (Math.abs(px) < half + 0.15 && Math.abs(pz) < half + 0.15) { px *= 1.06; pz *= 1.06; }
      var sc = rnd(0.5, 1.6); s3.set(sc, sc * rnd(0.5, 1), sc);
      e.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); q.setFromEuler(e); p3v.set(px, BED + 0.05 * sc, pz);
      m4.compose(p3v, q, s3); rub.setMatrixAt(i, m4);
      cc.setHex(Math.random() > 0.5 ? 0x9a8a78 : 0x6a5c58).convertSRGBToLinear(); rub.setColorAt(i, cc);
    }
    rub.castShadow = true; rub.receiveShadow = true; island.add(rub);
    // hanging rock spikes
    var spk = new THREE.MeshStandardMaterial({ color: col(0x3e2c48), roughness: 0.95, flatShading: true, map: tex('rock') });
    for (i = 0; i < 9; i++) {
      var an = i / 9 * Math.PI * 2 + 0.3, rd = rnd(2.5, 5.4), len = rnd(1.8, 4.5);
      var cg = new THREE.ConeGeometry(rnd(0.5, 1.0), len, 6, 3); cg.rotateX(Math.PI);
      var pp = cg.attributes.position; for (var k = 0; k < pp.count; k++) { pp.setX(k, pp.getX(k) * rnd(0.8, 1.2)); pp.setZ(k, pp.getZ(k) * rnd(0.8, 1.2)); } cg.computeVertexNormals();
      var cm = new THREE.Mesh(cg, spk); cm.position.set(Math.cos(an) * rd, BED - 1.6 - (6.2 - rd) * 1.1 - len / 2, Math.sin(an) * rd); island.add(cm);
    }
    // drifting rock fragments around the island
    for (i = 0; i < 8; i++) {
      var fr = Grp(world), rg = rockGeo(rnd(0.35, 0.9), 1, 0.45, i + 10);
      var fm = new THREE.Mesh(rg, rockMat); fm.scale.y = 0.7; fm.castShadow = false; fr.add(fm);
      var tp = new THREE.Mesh(gCyl(0.5, 0.42, 0.12, 7), mStd(0x7a6658, 0.9, 0)); tp.scale.setScalar(fm.geometry.parameters ? 1 : 1); tp.position.y = 0.32; fr.add(tp); tp.scale.set(1, 1, 1);
      if (i % 3 === 0) { var cr = new THREE.Mesh(gOct(0.14), mEmi(0x601060, 0xff50f0, 1.6)); cr.position.set(0.15, 0.5, 0); cr.scale.y = 2; fr.add(cr); var fgs = glowSprite(0xff50f0, 0.9, 0.4); fgs.position.set(0.15, 0.55, 0); fr.add(fgs); }
      var ang2 = i / 8 * Math.PI * 2 + rnd(-0.3, 0.3);
      fr.userData = { r: rnd(9.5, 14), a: ang2, y: rnd(-5, 0.5), sp: rnd(0.015, 0.04) * (i % 2 ? 1 : -1), bob: rnd(0, 6), spin: rnd(0.1, 0.3) };
      fragments.push(fr);
    }
  }
  function buildClouds() {
    for (var i = 0; i < 22; i++) {
      var m = new THREE.MeshBasicMaterial({ map: tex('cloud'), color: col(i % 3 ? 0xb890e0 : 0xf0a0c8), transparent: true, opacity: rnd(0.6, 0.95), depthWrite: false, fog: true });
      var c = new THREE.Mesh(gPlane(1), m), s = rnd(60, 120);
      c.scale.set(s, 1, s * rnd(0.6, 1)); var a = rnd(0, Math.PI * 2), r = rnd(25, 110);
      c.position.set(Math.cos(a) * r, rnd(-42, -24), Math.sin(a) * r); c.rotation.y = rnd(0, 6); c.renderOrder = -5;
      c.userData = { a: a, r: r, sp: rnd(0.004, 0.01) };
      world.add(c); clouds.push(c);
    }
  }

  /* ======================================================================
   * 8. Board: tiles, overlays, pillars, caches, traps, markers
   * ==================================================================== */
  var capMesh = null, colMesh = null, tv = null, corruptList = [], warnMat = null, veinMats = [], markMat = null, markFillMat = null, trapMats = {};
  var activeRing = null;
  function tileX(x) { return x - (N - 1) / 2; }
  function tileZ(y) { return y - (N - 1) / 2; }
  function topY(h) { return BASE_TOP + h * LEVEL; }
  function visTop(x, y) { var t = tv && tv[y] && tv[y][x]; return topY(t ? t.vh : 0); }
  function capGeometry() {
    return geo('tileCap', function () {
      var s = new THREE.Shape(), w = 0.41, r = 0.07;
      s.moveTo(-w + r, -w); s.lineTo(w - r, -w); s.quadraticCurveTo(w, -w, w, -w + r); s.lineTo(w, w - r); s.quadraticCurveTo(w, w, w - r, w); s.lineTo(-w + r, w); s.quadraticCurveTo(-w, w, -w, w - r); s.lineTo(-w, -w + r); s.quadraticCurveTo(-w, -w, -w + r, -w);
      var g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2, curveSegments: 3 });
      g.rotateX(-Math.PI / 2); g.computeBoundingBox(); g.translate(0, -g.boundingBox.max.y, 0);
      var p = g.attributes.position, uv = g.attributes.uv;
      for (var i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + 0.5, p.getZ(i) + 0.5);
      g.computeVertexNormals(); return g;
    });
  }
  function buildHelpersMeshes() {
    warnMat = addMat(0xff3ad8, 'warn', 0.7);
    markMat = addMat(0xff6a2a, 'mark', 0.9); markFillMat = addMat(0xff4a1a, 'hlFill', 0.25);
    for (var i = 0; i < 3; i++) {
      var vp = veinPair(i);
      veinMats.push(new THREE.MeshStandardMaterial({ map: vp.map, emissiveMap: vp.emissive, emissive: col(0xff3ae0), emissiveIntensity: 1.2, roughness: 0.55, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }));
    }
    activeRing = new THREE.Mesh(gPlane(1.35), addMat(0xffe7a0, 'activeRing', 0.9)); activeRing.visible = false; activeRing.renderOrder = 3; scene.add(activeRing);
  }
  var LEVEL_CAP = [0x7e624a, 0xa8835a, 0xcfa56e, 0xf0cf92], LEVEL_SIDE = [0x3e302c, 0x523e34, 0x684e3e, 0x7e604a];
  function buildBoard(g) {
    // clear previous board
    while (boardGroup.children.length) { var c = boardGroup.children.pop(); disposeFx(c); }
    for (var k in pieces) removePiece(k, true);
    clearHighlight();
    N = g.size || (g.tiles ? g.tiles.length : 12);
    var count = N * N;
    var capMat = new THREE.MeshStandardMaterial({ map: tex('stone'), roughness: 0.82, metalness: 0.02, bumpMap: tex('stone'), bumpScale: 0.015 });
    var colMat = new THREE.MeshStandardMaterial({ map: tex('side'), roughness: 0.9, metalness: 0.0 });
    capMesh = new THREE.InstancedMesh(capGeometry(), capMat, count);
    colMesh = new THREE.InstancedMesh(geo('tileCol', function () { var b = new THREE.BoxGeometry(0.97, 1, 0.97); b.translate(0, -0.5, 0); return b; }), colMat, count);
    capMesh.castShadow = capMesh.receiveShadow = true; colMesh.castShadow = colMesh.receiveShadow = true;
    capMesh.userData.isTiles = colMesh.userData.isTiles = true;
    boardGroup.add(capMesh); boardGroup.add(colMesh);
    tv = []; corruptList = [];
    for (var y = 0; y < N; y++) {
      tv.push([]);
      for (var x = 0; x < N; x++) {
        var t = g.tiles[y][x];
        tv[y].push({ x: x, y: y, h: t.h || 0, vh: t.h || 0, rot: Math.floor(hash(x, y, 1) * 4), corrupted: false, warning: false, pillar: false, cache: false, trap: null, marked: false });
      }
    }
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) syncTile(x, y, false);
    capMesh.instanceMatrix.needsUpdate = colMesh.instanceMatrix.needsUpdate = true;
  }
  var _cool = new THREE.Color(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _yAxis = new THREE.Vector3(0, 1, 0);
  function applyTileMatrix(x, y) {
    var t = tv[y][x], i = y * N + x, top = topY(t.vh), wx = tileX(x), wz = tileZ(y);
    _q.setFromAxisAngle(_yAxis, t.rot * Math.PI / 2); _v.set(wx, top, wz); _s.set(1, 1, 1);
    _m4.compose(_v, _q, _s); capMesh.setMatrixAt(i, _m4);
    _q.identity(); _v.set(wx, top - 0.08, wz); _s.set(1, Math.max(0.05, top - 0.08 - BED + 0.02), 1);
    _m4.compose(_v, _q, _s); colMesh.setMatrixAt(i, _m4);
    capMesh.instanceMatrix.needsUpdate = colMesh.instanceMatrix.needsUpdate = true;
    // things standing on the tile follow its visual height
    var yy = top + 0.004;
    if (t.corruptMesh) t.corruptMesh.position.y = yy + 0.001;
    if (t.warnMesh) t.warnMesh.position.y = yy + 0.006;
    if (t.markMesh) t.markMesh.position.y = yy + 0.01;
    if (t.trapMesh) t.trapMesh.position.y = yy + 0.008;
    if (t.perchMesh) t.perchMesh.position.y = yy + 0.012;
    if (t.pillarObj) t.pillarObj.position.y = top;
    if (t.cacheObj) t.cacheObj.userData.baseY = top;
  }
  function applyTileColor(x, y) {
    var t = tv[y][x], i = y * N + x, lv = clamp(Math.round(t.h), 0, 3), v = 0.92 + hash(x, y, 2) * 0.16;
    if (t.corrupted) _c.setHex(0x5a3468); else _c.setHex(LEVEL_CAP[lv]);
    _c.convertSRGBToLinear().multiplyScalar(v);
    if (!t.corrupted) { var hv = hash(x, y, 9); if (hv < 0.18) _c.lerp(_cool.setRGB(0.32, 0.32, 0.36), 0.35); else if (hv > 0.88) _c.lerp(_cool.setRGB(0.55, 0.42, 0.28), 0.25); } capMesh.setColorAt(i, _c);
    if (t.corrupted) _c.setHex(0x4a2a58); else _c.setHex(LEVEL_SIDE[lv]);
    _c.convertSRGBToLinear().multiplyScalar(0.95 + hash(x, y, 4) * 0.1); colMesh.setColorAt(i, _c);
    if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
    if (colMesh.instanceColor) colMesh.instanceColor.needsUpdate = true;
  }
  function tileState(x, y) { return game && game.tiles && game.tiles[y] ? game.tiles[y][x] : null; }
  function syncTile(x, y, animate, ovr) {
    var s = tileState(x, y), t = tv && tv[y] && tv[y][x];
    if (s && ovr) { var s2 = {}; for (var kk in s) s2[kk] = s[kk]; for (var k2 in ovr) s2[k2] = ovr[k2]; s = s2; }
    if (!s || !t) return;
    var top = topY(t.vh), wx = tileX(x), wz = tileZ(y);
    var nh = s.h || 0;
    if (nh !== t.h) {
      var from = t.vh; t.h = nh;
      if (animate) {
        tween(450, function (k) { t.vh = lerp(from, nh, k); applyTileMatrix(x, y); }, easeOutBack);
        dustRing(wx, topY(Math.min(from, nh)), wz, 0x9a8a78);
      } else { t.vh = nh; }
    }
    // corruption
    var cor = !!s.corrupted;
    if (cor !== t.corrupted) {
      t.corrupted = cor;
      if (cor) {
        if (!t.corruptMesh) { t.corruptMesh = new THREE.Mesh(gPlane(0.9), veinMats[(x * 7 + y * 3) % 3]); t.corruptMesh.rotation.y = t.rot * Math.PI / 2; t.corruptMesh.receiveShadow = true; t.corruptMesh.position.set(wx, top + 0.005, wz); t.corruptMesh.renderOrder = 1; boardGroup.add(t.corruptMesh); }
        t.corruptMesh.visible = true; corruptList.push(t);
        if (animate) { burst(wx, top + 0.1, wz, 0xff40e0, 14, { speed: 1.6, up: true, life: 0.8, size: 0.14 }); tileFlash(x, y, 0xff50e0, 0, 500); }
      } else {
        if (t.corruptMesh) t.corruptMesh.visible = false;
        var ix = corruptList.indexOf(t); if (ix >= 0) corruptList.splice(ix, 1);
      }
      applyTileColor(x, y);
    }
    // warning
    var warn = !!s.warning && !cor;
    if (warn !== t.warning) {
      t.warning = warn;
      if (warn && !t.warnMesh) { t.warnMesh = new THREE.Mesh(gPlane(0.96), warnMat); t.warnMesh.position.set(wx, top + 0.01, wz); t.warnMesh.renderOrder = 4; boardGroup.add(t.warnMesh); }
      if (t.warnMesh) t.warnMesh.visible = warn;
    }
    // pillar
    var pil = !!s.pillar;
    if (pil !== t.pillar) {
      t.pillar = pil;
      if (pil) { t.pillarObj = makePillar(x, y); t.pillarObj.position.set(wx, top, wz); boardGroup.add(t.pillarObj); if (animate) { dustRing(wx, top, wz, 0x9a8a78); } }
      else if (t.pillarObj) { var po = t.pillarObj; boardGroup.remove(po); t.pillarObj = null; if (animate) dustRing(wx, top, wz, 0x9a8a78); }
    }
    // cache
    var ca = !!s.cache;
    if (ca !== t.cache) {
      t.cache = ca;
      if (ca) { t.cacheObj = makeCache(); t.cacheObj.position.set(wx, top, wz); t.cacheObj.userData.baseY = top; t.cacheObj.userData.tile = { x: x, y: y }; boardGroup.add(t.cacheObj); }
      else if (t.cacheObj) { var co = t.cacheObj; t.cacheObj = null; if (!co.userData.opening) { if (animate) { burst(wx, top + 0.3, wz, 0xffd060, 16, { speed: 1.5, life: 0.7 }); } boardGroup.remove(co); } }
    }
    // trap (owner-only)
    var tr = s.trap && (humanId == null ? false : String(s.trap.ownerId) === String(humanId)) ? s.trap : null;
    var trKey = tr ? (tr.kind || 'trap') : null;
    if (trKey !== t.trap) {
      t.trap = trKey;
      if (t.trapMesh) { boardGroup.remove(t.trapMesh); t.trapMesh = null; }
      if (trKey) { t.trapMesh = new THREE.Mesh(gPlane(0.72), trapMat(trKey)); t.trapMesh.position.set(wx, top + 0.012, wz); t.trapMesh.renderOrder = 4; boardGroup.add(t.trapMesh); }
    }
    // Eagle's Perch lock
    var pl = s.perchLock != null && s.perchLock !== false;
    if (pl !== !!t.perch) {
      t.perch = pl;
      if (pl) { t.perchMesh = new THREE.Mesh(gPlane(1.0), MAT.perchMat || (MAT.perchMat = addMat(0xb6ff7a, 'rune', 0.8))); t.perchMesh.position.set(wx, top + 0.016, wz); t.perchMesh.renderOrder = 5; boardGroup.add(t.perchMesh); }
      else if (t.perchMesh) { boardGroup.remove(t.perchMesh); t.perchMesh = null; }
    }
    // Skyfall mark
    var mk = !!s.marked;
    if (mk !== t.marked) {
      t.marked = mk;
      if (mk) { if (!t.markMesh) { t.markMesh = new THREE.Group(); var f = new THREE.Mesh(gPlane(0.96), markFillMat); f.renderOrder = 4; t.markMesh.add(f); t.markMesh.position.set(wx, top + 0.014, wz); boardGroup.add(t.markMesh); } t.markMesh.visible = true; }
      else if (t.markMesh) t.markMesh.visible = false;
      refreshMarkCenters();
    }
    applyTileMatrix(x, y); applyTileColor(x, y);
  }
  function trapMat(kind) {
    var k = norm(kind), hex = k.indexOf('snare') >= 0 ? 0xc8ff5a : k.indexOf('caltrop') >= 0 ? 0xd08cff : 0xffffff;
    return trapMats[hex] || (trapMats[hex] = addMat(hex, 'trap', 0.4));
  }
  var markCenters = [];
  function refreshMarkCenters() {
    markCenters.forEach(function (m) { if (m.parent) m.parent.remove(m); }); markCenters = [];
    if (!tv) return;
    for (var y = 1; y < N - 1; y++) for (var x = 1; x < N - 1; x++) {
      var all = true;
      for (var dy = -1; dy <= 1 && all; dy++) for (var dx = -1; dx <= 1; dx++) if (!tv[y + dy][x + dx].marked) { all = false; break; }
      if (all) { var c = new THREE.Mesh(gPlane(3), markMat); c.position.set(tileX(x), visTop(x, y) + 0.03, tileZ(y)); c.renderOrder = 6; boardGroup.add(c); markCenters.push(c); }
    }
    // isolated marks (not part of a full 3x3) get their own small crosshair
    for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) if (tv[yy][xx].marked && !markCenters.length) { var s = new THREE.Mesh(gPlane(0.9), markMat); s.position.set(tileX(xx), visTop(xx, yy) + 0.03, tileZ(yy)); s.renderOrder = 6; boardGroup.add(s); markCenters.push(s); }
  }

  function pillarGeometry(k) {
    return geo('pillar' + k, function () {
      var H = 1.05 + k * 0.28, g = new THREE.CylinderGeometry(0.25, 0.28, H, 32, 8, false), p = g.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.sqrt(x * x + z * z);
        if (r > 0.01) { var f = 1 - 0.07 * Math.pow(0.5 + 0.5 * Math.cos(a * 16), 3); x *= f; z *= f; }
        if (y > H / 2 - 0.01) { y -= (0.5 + 0.5 * Math.sin(a * 3 + k * 2)) * 0.22 + hash(a * 10, k, 5) * 0.08; if (r < 0.01) y = H / 2 - 0.2; }
        else if (y > H / 2 - H / 8 - 0.01) { y -= hash(a * 10, k, 6) * 0.06; x *= 0.97 + hash(a, k, 8) * 0.06; z *= 0.97 + hash(a, k, 9) * 0.06; }
        p.setXYZ(i, x, y + H / 2, z);
      }
      g.computeVertexNormals(); return g;
    });
  }
  function makePillar(x, y) {
    var g = new THREE.Group(), k = Math.floor(hash(x, y, 11) * 3);
    var marble = mStd(0xd8ccb6, 0.75, 0.02, { map: tex('rock') }), dark = mStd(0x9a8c7c, 0.85, 0.0, { map: tex('rock') }), gold = mStd(0xd8a84a, 0.35, 0.85);
    P(g, gBox(0.84, 0.12, 0.84), dark, 0, 0.06, 0).receiveShadow = true;
    P(g, gBox(0.68, 0.1, 0.68), marble, 0, 0.17, 0).receiveShadow = true;
    P(g, gCyl(0.31, 0.33, 0.08, 24), marble, 0, 0.26, 0);
    var col1 = P(g, pillarGeometry(k), marble, 0, 0.3, 0); col1.rotation.y = hash(x, y, 12) * 6; col1.receiveShadow = true;
    var H = 1.05 + k * 0.28;
    P(g, gTor(0.27, 0.025, Math.PI * 1.3, 6, 20), gold, 0, 0.3 + H * 0.62, 0, Math.PI / 2, 0, hash(x, y, 13) * 6);
    // chunks fallen at the foot
    for (var i = 0; i < 3; i++) { var a = hash(x, y, 20 + i) * 6.28; var ch = P(g, gIco(0.07 + i * 0.02, 0), marble, Math.cos(a) * 0.36, 0.14 + 0.02 * i, Math.sin(a) * 0.36, a, a * 2, 0); }
    g.userData.tile = { x: x, y: y };
    return g;
  }
  function makeCache() {
    var g = new THREE.Group(), body = Grp(g, 0, 0.18, 0);
    var wood = mStd(0x7a3e22, 0.7, 0.0), gold = mStd(0xf0c050, 0.25, 0.95, { emissive: 0x4a3000, emissiveIntensity: 0.6 }), gem = mEmi(0xff6080, 0xff3060, 1.6);
    P(body, gBox(0.38, 0.22, 0.27), wood, 0, 0, 0);
    P(body, gBox(0.4, 0.035, 0.29), gold, 0, -0.1, 0);
    for (var s = -1; s <= 1; s += 2) { P(body, gBox(0.04, 0.24, 0.29), gold, s * 0.15, 0.0, 0); }
    var lid = Grp(body, 0, 0.11, -0.135);
    P(lid, gCyl(0.135, 0.135, 0.38, 16, false, 0, Math.PI), wood, 0, 0, 0.135, 0, 0, Math.PI / 2);
    P(lid, gCyl(0.142, 0.142, 0.045, 16, false, 0, Math.PI), gold, 0.15, 0, 0.135, 0, 0, Math.PI / 2);
    P(lid, gCyl(0.142, 0.142, 0.045, 16, false, 0, Math.PI), gold, -0.15, 0, 0.135, 0, 0, Math.PI / 2);
    P(body, gBox(0.07, 0.08, 0.03), gold, 0, 0.06, 0.145); P(body, gOct(0.025), gem, 0, 0.06, 0.165).castShadow = false;
    var gl = glowSprite(0xffc850, 1.1, 0.55); gl.position.y = 0.25; g.add(gl);
    var gp = new THREE.Mesh(gPlane(0.9), MAT.cacheGlow || (MAT.cacheGlow = addMat(0xffb040, 'glow', 0.55))); gp.position.y = 0.01; g.add(gp);
    g.userData = { body: body, lid: lid, glow: gl, phase: Math.random() * 6, baseY: 0 };
    body.scale.setScalar(1.3);
    return g;
  }

  /* ======================================================================
   * 9. Pieces on the board, DOM overlay (bars + floating numbers)
   * ==================================================================== */
  var pieces = {};
  var shieldMatBase = null;
  function shieldMaterial() {
    if (!shieldMatBase) {
      var ht = tex('hex');
      shieldMatBase = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: ht }, uColor: { value: new THREE.Color(0x8fe0ff) }, uOpacity: { value: 1 }, uTime: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
        fragmentShader: 'uniform sampler2D uTex; uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec2 vUv;' +
          'void main(){ float f=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.2); float h=texture2D(uTex, vUv*vec2(3.0,2.0)+vec2(uTime*0.02,0.0)).r; float a=(f*0.42+h*(0.06+0.35*f))*uOpacity; gl_FragColor=vec4(uColor*(0.7+f*0.8), a); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide
      });
    }
    var m = shieldMatBase.clone(); m.uniforms.uTex.value = shieldMatBase.uniforms.uTex.value; return m;
  }
  var auraMat = null;
  function makeAura() {
    if (!auraMat) auraMat = addMat(0xffc848, 'aura', 0.75);
    var g = new THREE.Group();
    var c = new THREE.Mesh(gCyl(0.42, 0.46, 1.0, 24, true), auraMat); c.position.y = 0.5; c.renderOrder = 7; g.add(c);
    var c2 = new THREE.Mesh(gCyl(0.3, 0.38, 0.7, 24, true), auraMat); c2.position.y = 0.35; c2.renderOrder = 7; g.add(c2);
    var s = glowSprite(0xffc848, 1.3, 0.45); s.position.y = 0.3; g.add(s);
    g.userData = { c: c, c2: c2, s: s }; g.visible = false;
    return g;
  }
  function findPlayer(id) {
    if (!game || !game.players) return null;
    for (var i = 0; i < game.players.length; i++) if (String(game.players[i].id) === String(id)) return game.players[i];
    return null;
  }
  function ownerOf(e) { if (e && e.isDecoy) return findPlayer(e.ownerId) || e; return e; }
  function pieceOf(e) { if (e == null) return null; var k = String(typeof e === 'object' ? e.id : e); return pieces[k] || null; }
  function entName(e) { var o = ownerOf(e); return (o && o.name) || ('P' + (o && o.id != null ? o.id : '?')); }

  function createPiece(e) {
    var key = String(e.id);
    if (pieces[key]) return pieces[key];
    var o = ownerOf(e);
    var grp = buildPiece(o.cls, o.variant, entColor(o));
    var root = new THREE.Group(), lift = new THREE.Group();
    root.add(lift); lift.add(grp);
    var sh = new THREE.Mesh(gIco(0.56, 2), shieldMaterial()); sh.position.y = 0.6; sh.visible = false; sh.renderOrder = 8; lift.add(sh);
    var aura = makeAura(); lift.add(aura);
    root.userData.pieceKey = key;
    var pc = { key: key, ent: e, root: root, lift: lift, grp: grp, model: grp.userData.model, idle: grp.userData.idle, headY: grp.userData.headY,
      tx: e.x, ty: e.y, busy: 0, face: cam.yaw, faceGoal: null, alive: e.alive !== false, shield: sh, shieldK: 0, aura: aura, ghost: false, hidden: false,
      phase: grp.userData.phase, bar: null, last: {} };
    root.position.set(tileX(e.x), visTop(e.x, e.y), tileZ(e.y));
    boardGroup.add(root);
    pc.bar = makeBar(pc);
    pieces[key] = pc;
    if (!pc.alive) { root.visible = false; }
    return pc;
  }
  function removePiece(key, instant) {
    var pc = pieces[key]; if (!pc) return;
    if (pc.root.parent) pc.root.parent.remove(pc.root);
    if (pc.bar && pc.bar.el.parentNode) pc.bar.el.parentNode.removeChild(pc.bar.el);
    if (pc.shield) pc.shield.material.dispose();
    if (pc.ghostMats) pc.ghostMats.forEach(function (m) { m.dispose(); });
    delete pieces[key];
  }
  function setGhost(pc, on) {
    if (pc.ghost === on) return; pc.ghost = on;
    if (on && !pc.origMats) {
      pc.origMats = []; pc.ghostMats = [];
      pc.grp.traverse(function (o) {
        if (o.isMesh && o.material && !o.material.isShaderMaterial) {
          var m = o.material.clone(); m.transparent = true; m.opacity = (o.material.opacity || 1) * 0.32; m.depthWrite = false;
          pc.origMats.push([o, o.material]); pc.ghostMats.push(m); o.userData.ghostMat = m;
        }
      });
    }
    if (pc.origMats) pc.origMats.forEach(function (pair) { pair[0].material = on ? pair[0].userData.ghostMat : pair[1]; pair[0].castShadow = !on; });
  }

  // DOM overlay -----------------------------------------------------------
  var cssInjected = false;
  function injectCss() {
    if (cssInjected || typeof document === 'undefined') return; cssInjected = true;
    var st = document.createElement('style'); st.id = 'ltv-style';
    st.textContent = [
      '.ltv-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}',
      '.ltv-tag{position:absolute;left:0;top:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;will-change:transform;transition:opacity .2s;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
      '.ltv-name{display:flex;align-items:center;gap:3px;font-weight:700;font-size:9px;line-height:1;color:#fff;letter-spacing:.02em;white-space:nowrap;max-width:76px;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 4px rgba(0,0,0,.7);margin-bottom:2px}',
      '.ltv-name i{display:inline-block;width:6px;height:6px;border-radius:50%;flex:none;box-shadow:0 0 4px currentColor}',
      '.ltv-hp{position:relative;width:38px;height:5px;border-radius:3px;background:rgba(12,8,24,.82);box-shadow:0 0 0 1px rgba(255,255,255,.28),0 1px 3px rgba(0,0,0,.6);overflow:hidden}',
      '.ltv-hp b{position:absolute;top:0;bottom:0;left:0;transition:width .25s ease-out,left .25s ease-out}',
      '.ltv-fill{background:linear-gradient(#8dff9a,#2fcf5a)}',
      '.ltv-fill.mid{background:linear-gradient(#ffe37a,#f0a020)}',
      '.ltv-fill.low{background:linear-gradient(#ff8a7a,#e02a3a)}',
      '.ltv-lag{background:rgba(255,255,255,.55)}',
      '.ltv-shd{background:linear-gradient(#e0f6ff,#6cc8ff);opacity:.95}',
      '.ltv-tag.me .ltv-hp{box-shadow:0 0 0 1px #ffe08a,0 1px 3px rgba(0,0,0,.6)}',
      '.ltv-tag.act .ltv-name{color:#ffe7a0}',
      '.ltv-tag.ghost{opacity:.55}',
      '.ltv-num{position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;font-family:Cinzel,Georgia,"Times New Roman",serif;font-weight:800;font-size:20px;line-height:1;color:#fff;-webkit-text-stroke:1px rgba(20,6,20,.85);text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 10px rgba(0,0,0,.5);animation:ltv-rise 1s cubic-bezier(.2,.8,.3,1) forwards;will-change:transform,opacity}',
      '.ltv-num.big{font-size:28px}',
      '.ltv-num.small{font-size:12px;font-family:Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}',
      '@keyframes ltv-rise{0%{transform:translate(-50%,-50%) translateY(6px) scale(.4);opacity:0}15%{transform:translate(-50%,-50%) translateY(-8px) scale(1.25);opacity:1}30%{transform:translate(-50%,-50%) translateY(-14px) scale(1)}100%{transform:translate(-50%,-50%) translateY(-46px) scale(.95);opacity:0}}',
      '@media (prefers-reduced-motion: reduce){.ltv-num{animation-duration:.9s}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  var layer = null;
  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    injectCss();
    var host = overlayEl || stageEl; if (!host) return null;
    layer = document.createElement('div'); layer.className = 'ltv-layer';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(layer);
    return layer;
  }
  function makeBar(pc) {
    var L = ensureLayer(); if (!L) return null;
    var o = ownerOf(pc.ent);
    var el = document.createElement('div'); el.className = 'ltv-tag';
    el.innerHTML = '<div class="ltv-name"><i></i><span></span></div><div class="ltv-hp"><b class="ltv-lag"></b><b class="ltv-fill"></b><b class="ltv-shd"></b></div>';
    var dot = el.querySelector('i'); dot.style.background = hexStr(entColor(o)); dot.style.color = hexStr(entColor(o));
    el.querySelector('span').textContent = entName(pc.ent);
    if (humanId != null && String(o.id) === String(humanId)) el.classList.add('me');
    L.appendChild(el);
    return { el: el, fill: el.querySelector('.ltv-fill'), lag: el.querySelector('.ltv-lag'), shd: el.querySelector('.ltv-shd'), name: el.querySelector('span') };
  }
  function updateBarValues(pc) {
    var b = pc.bar; if (!b) return;
    var o = ownerOf(pc.ent), hp = Math.max(0, o.hp || 0), mx = Math.max(1, o.maxHp || 1), shd = Math.max(0, o.shield || 0);
    var key = hp + '/' + mx + '/' + shd;
    if (pc.last.bar === key) return; pc.last.bar = key;
    var tot = Math.max(mx, hp + shd), wHp = hp / tot * 100, wS = shd / tot * 100;
    b.fill.style.width = wHp + '%'; b.shd.style.left = wHp + '%'; b.shd.style.width = wS + '%';
    var r = hp / mx; b.fill.className = 'ltv-fill' + (r <= 0.25 ? ' low' : r <= 0.5 ? ' mid' : '');
    clearTimeout(pc.lagT); pc.lagT = setTimeout(function () { b.lag.style.width = wHp + '%'; }, 380);
    if (pc.last.lagInit == null) { b.lag.style.width = wHp + '%'; pc.last.lagInit = 1; }
  }
  var _pv = new THREE.Vector3();
  var stageRect = null, layerRect = null;
  function projectToLayer(v) {
    _pv.copy(v).project(camera);
    if (_pv.z > 1) return null;
    var r = stageRect; if (!r) return null;
    return { x: (r.left - layerRect.left) + (_pv.x * 0.5 + 0.5) * r.width, y: (r.top - layerRect.top) + (-_pv.y * 0.5 + 0.5) * r.height };
  }
  function updateOverlay() {
    if (!layer || !canvas) return;
    stageRect = canvas.getBoundingClientRect(); layerRect = layer.getBoundingClientRect();
    for (var k in pieces) {
      var pc = pieces[k], b = pc.bar; if (!b) continue;
      var show = pc.alive && !pc.hidden && pc.root.visible;
      if (show) {
        _v.set(0, (pc.headY + 0.36) * PIECE_SCALE * pc.lift.scale.y + pc.lift.position.y, 0); pc.root.localToWorld(_v);
        var p = projectToLayer(_v);
        if (p) { b.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,-100%)'; }
        else show = false;
      }
      if (b.shown !== show) { b.el.style.display = show ? '' : 'none'; b.shown = show; }
    }
  }
  function floatText(worldPos, text, color, cls) {
    var L = ensureLayer(); if (!L || !camera || !canvas) return;
    stageRect = canvas.getBoundingClientRect(); layerRect = L.getBoundingClientRect();
    var p = projectToLayer(worldPos); if (!p) return;
    var el = document.createElement('div'); el.className = 'ltv-num' + (cls ? ' ' + cls : '');
    el.textContent = text; el.style.color = color;
    el.style.left = (p.x + rnd(-6, 6)) + 'px'; el.style.top = p.y + 'px';
    el.style.animationDuration = (1.05 / Math.min(2, speed)) + 's';
    L.appendChild(el);
    var rm = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    el.addEventListener('animationend', rm); setTimeout(rm, 2200);
  }
  function headPos(pc, extra) { var v = new THREE.Vector3(0, (pc.headY + (extra || 0.1)) * PIECE_SCALE + pc.lift.position.y, 0); pc.root.localToWorld(v); return v; }
  function piecePos(pc, h) { var v = pc.root.position.clone(); v.y += (h == null ? 0.45 : h); return v; }

  /* ======================================================================
   * 10. Camera rig and controls
   * ==================================================================== */
  var cam = { yaw: 0.0, pitch: 0.84, zoom: 1, dist: 30, fit: 30, target: new THREE.Vector3(0, 0.3, 0), base: new THREE.Vector3(0, 0.3, 0), shake: 0, shakeT: 0 };
  var PITCH_MIN = 0.55, PITCH_MAX = 1.32;
  function placeCamera(c, yaw, pitch, dist, target) {
    c.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    c.lookAt(target);
  }
  function stageSize() { var w = stageEl ? stageEl.clientWidth : 390, h = stageEl ? stageEl.clientHeight : 844; return { w: Math.max(1, w), h: Math.max(1, h) }; }
  function applyViewOffset(W, H) {
    camera.aspect = W / H;
    var top = clamp(insets.top || 0, 0, H * 0.45), bot = clamp(insets.bottom || 0, 0, H * 0.6);
    var cy = top + (H - top - bot) / 2;
    camera.setViewOffset(W, H, 0, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  function fitCamera() {
    if (!camera) return;
    var sz = stageSize(), W = sz.w, H = sz.h;
    applyViewOffset(W, H);
    var top = clamp(insets.top || 0, 0, H * 0.45), bot = clamp(insets.bottom || 0, 0, H * 0.6);
    var half = N / 2 + 0.05, pts = [];
    [-half, half].forEach(function (x) { [-half, half].forEach(function (z) { pts.push(new THREE.Vector3(x, 0.1, z), new THREE.Vector3(x, 0.9, z)); }); });
    var padX = 16, padY = 22, lo = 6, hi = 140, v = new THREE.Vector3();
    for (var it = 0; it < 26; it++) {
      var d = (lo + hi) / 2, ok = true;
      placeCamera(camera, cam.yaw, cam.pitch, d, cam.base); camera.updateMatrixWorld();
      for (var i = 0; i < pts.length && ok; i++) {
        v.copy(pts[i]).project(camera);
        var sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
        if (sx < padX || sx > W - padX || sy < top + padY || sy > H - bot - 4) ok = false;
      }
      if (ok) hi = d; else lo = d;
    }
    cam.fit = hi;
  }
  var raycaster = null;
  function updateCamera(dt) {
    var sz = stageSize();
    applyViewOffset(sz.w, sz.h);
    var d = cam.fit * cam.zoom;
    placeCamera(camera, cam.yaw, cam.pitch, d, cam.target);
    if (cam.shake > 0.001) {
      var a = cam.shake * (reduced ? 0.3 : 1);
      camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a; camera.position.z += (Math.random() - 0.5) * a;
      cam.shake *= Math.pow(0.02, dt / Math.max(0.05, cam.shakeT));
    }
    // rim light sits behind the board relative to the camera
    if (lights.rim) lights.rim.position.set(-Math.sin(cam.yaw) * 10, 7, -Math.cos(cam.yaw) * 10);
  }
  function shake(amount, dur) { cam.shake = Math.max(cam.shake, amount); cam.shakeT = (dur || 400) / 1000; kick(); }

  // pointer input --------------------------------------------------------
  var ptrs = {}, drag = null, pinch = null, inputBound = false;
  function bindInput() {
    if (inputBound || !canvas) return; inputBound = true;
    canvas.addEventListener('pointerdown', function (e) {
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 1) drag = { sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, t: now() };
      else if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.zoom }; if (drag) drag.moved = true; }
      kick();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId].x = e.clientX; ptrs[e.pointerId].y = e.clientY;
      var ids = Object.keys(ptrs);
      if (ids.length >= 2 && pinch) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        cam.zoom = clamp(pinch.z * pinch.d / d, 0.55, 1.45); kick(); return;
      }
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) { drag.moved = true; drag.lx = e.clientX; drag.ly = e.clientY; }
      if (drag.moved) {
        var dx = e.clientX - drag.lx, dy = e.clientY - drag.ly; drag.lx = e.clientX; drag.ly = e.clientY;
        cam.yaw -= dx * 0.0085; cam.pitch = clamp(cam.pitch + dy * 0.005, PITCH_MIN, PITCH_MAX); kick();
      }
    });
    var end = function (e) {
      if (!ptrs[e.pointerId]) return;
      delete ptrs[e.pointerId];
      var n = Object.keys(ptrs).length;
      if (n < 2) pinch = null;
      if (n === 0) {
        if (drag && !drag.moved && e.type === 'pointerup') doTap(e.clientX, e.clientY);
        drag = null;
      } else if (drag) drag.moved = true;
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); cam.zoom = clamp(cam.zoom * (1 + Math.sign(e.deltaY) * 0.08), 0.55, 1.45); kick(); }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  function pickAt(clientX, clientY) {
    if (!camera || !canvas || !tv) return { tile: null, entity: null };
    var r = canvas.getBoundingClientRect();
    var ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster = raycaster || new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    // pieces first (visible ones only)
    var best = null, bestD = Infinity;
    for (var k in pieces) {
      var pc = pieces[k]; if (!pc.alive || pc.hidden || !pc.root.visible) continue;
      var hits = raycaster.intersectObject(pc.grp, true);
      for (var i = 0; i < hits.length; i++) { if (hits[i].object.isSprite) continue; if (hits[i].distance < bestD) { bestD = hits[i].distance; best = pc; } break; }
    }
    // generous fallback: a tap close to a piece on screen still selects it
    if (!best) {
      var bd = 22;
      for (var k2 in pieces) {
        var p2 = pieces[k2]; if (!p2.alive || p2.hidden || !p2.root.visible) continue;
        var sp = piecePos(p2, 0.35).project(camera), sx = (sp.x * 0.5 + 0.5) * r.width + r.left, sy = (-sp.y * 0.5 + 0.5) * r.height + r.top;
        var dd = Math.hypot(sx - clientX, sy - clientY); if (dd < bd) { bd = dd; best = p2; }
      }
    }
    if (best) {
      var e = best.ent;
      return { tile: { x: best.tx, y: best.ty }, entity: e };
    }
    var objs = [capMesh, colMesh];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) { if (tv[y][x].pillarObj) objs.push(tv[y][x].pillarObj); if (tv[y][x].cacheObj) objs.push(tv[y][x].cacheObj); }
    var th = raycaster.intersectObjects(objs, true);
    for (var j = 0; j < th.length; j++) {
      var h = th[j];
      if (h.object.isSprite) continue;
      if ((h.object === capMesh || h.object === colMesh) && h.instanceId != null) return { tile: { x: h.instanceId % N, y: Math.floor(h.instanceId / N) }, entity: null };
      var o = h.object; while (o && !(o.userData && o.userData.tile)) o = o.parent;
      if (o) return { tile: { x: o.userData.tile.x, y: o.userData.tile.y }, entity: null };
    }
    return { tile: null, entity: null };
  }
  function doTap(cx, cy) {
    var hit = pickAt(cx, cy);
    if (typeof API.onTap === 'function') { try { API.onTap(hit); } catch (e) { console.error(e); } }
  }

  /* ======================================================================
   * 11. Highlights
   * ==================================================================== */
  var hlPool = [], hlUsed = 0, hlMatSoft = null, hlMatStrong = null, hlMatStrongEdge = null;
  function clearHighlight() { for (var i = 0; i < hlPool.length; i++) hlPool[i].visible = false; hlUsed = 0; }
  function hlMesh() {
    var m = hlPool[hlUsed];
    if (!m) { m = new THREE.Mesh(gPlane(0.94), hlMatSoft); m.renderOrder = 6; hlPool.push(m); if (boardGroup) boardGroup.add(m); }
    if (!m.parent && boardGroup) boardGroup.add(m);
    hlUsed++; m.visible = true; return m;
  }
  function highlight(o) {
    clearHighlight(); if (!tv || !o) return;
    var c = toHex(o.color || 0x5fe3ff);
    if (!hlMatSoft) { hlMatSoft = addMat(c, 'hl', 0.6); hlMatStrong = addMat(c, 'hlFill', 0.55); }
    hlMatSoft.color.copy(col(c)); hlMatStrong.color.copy(col(c));
    var areaSet = {};
    (o.area || []).forEach(function (t) { areaSet[t.x + ',' + t.y] = 1; });
    (o.targets || []).forEach(function (t) {
      if (!tv[t.y] || !tv[t.y][t.x] || areaSet[t.x + ',' + t.y]) return;
      var m = hlMesh(); m.material = hlMatSoft; m.position.set(tileX(t.x), visTop(t.x, t.y) + 0.02, tileZ(t.y)); m.scale.setScalar(1); m.userData.kind = 'soft';
    });
    (o.area || []).forEach(function (t) {
      if (!tv[t.y] || !tv[t.y][t.x]) return;
      var m = hlMesh(); m.material = hlMatStrong; m.position.set(tileX(t.x), visTop(t.x, t.y) + 0.025, tileZ(t.y)); m.scale.setScalar(1); m.userData.kind = 'strong';
    });
    kick();
  }

  /* ======================================================================
   * 12. Frame loop
   * ==================================================================== */
  function mainVisible() {
    return !!(mounted && !stopped && renderer && scene && stageEl && stageEl.clientWidth > 0 && stageEl.clientHeight > 0 && !(typeof document !== 'undefined' && document.hidden));
  }
  function frame() {
    rafId = 0;
    var t = now(), dt = Math.min(0.05, Math.max(0.001, (t - (lastT || t)) / 1000)); lastT = t;
    var sdt = dt * speed; time += sdt;
    runTweens();
    var renderMain = mainVisible(), pedsActive = pedestalsActive();
    if (scene) {
      runTransients(sdt);
      if (PFX) { PFX.update(sdt); PDUST.update(sdt); PMOTE.update(sdt); }
    }
    if (renderMain) {
      updateScene(sdt, dt);
      var sz = stageSize();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      setSize(sz.w * dpr, sz.h * dpr);
      updateCamera(dt);
      var sc = curH * camera.projectionMatrix.elements[5] * 0.5;
      PFX.mat.uniforms.uScale.value = PDUST.mat.uniforms.uScale.value = PMOTE.mat.uniforms.uScale.value = sc;
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, curW, curH); renderer.setScissorTest(false);
      renderer.setClearColor(0x0a0820, 1);
      renderer.render(scene, camera);
      updateOverlay();
    }
    if (pedsActive) renderPedestals(dt);
    if (renderMain || pedsActive || tweens.length || transients.length) kick();
  }
  function updateScene(dt, rdt) {
    // idle animations & piece upkeep
    for (var k in pieces) {
      var pc = pieces[k];
      if (!pc.alive) continue;
      if (!pc.busy) { pc.root.position.set(tileX(pc.tx), visTop(pc.tx, pc.ty), tileZ(pc.ty)); }
      if (pc.idle) { try { pc.idle(time + pc.phase); } catch (e) { pc.idle = null; } }
      pc.grp.userData.inner.scale.y = 1 + Math.sin((time + pc.phase) * 2.3) * 0.012;
      var goal = pc.faceGoal != null ? pc.faceGoal : cam.yaw;
      var df = Math.atan2(Math.sin(goal - pc.face), Math.cos(goal - pc.face));
      pc.face += df * Math.min(1, dt * (pc.faceGoal != null ? 14 : 4));
      pc.model.rotation.y = pc.face;
      if (pc.shield.visible) { pc.shield.material.uniforms.uTime.value = time; pc.shield.rotation.y += dt * 0.3; var so = pc.shieldK * (0.85 + Math.sin(time * 3 + pc.phase) * 0.15); pc.shield.material.uniforms.uOpacity.value = so; }
      if (pc.aura.visible) { var u = pc.aura.userData; u.c.rotation.y += dt * 0.8; u.c2.rotation.y -= dt * 1.3; u.c.scale.y = 1 + Math.sin(time * 4 + pc.phase) * 0.08; u.s.material.opacity = 0.35 + Math.sin(time * 3) * 0.1; if (Math.random() < dt * 6) burst(pc.root.position.x, pc.root.position.y + 0.1, pc.root.position.z, 0xffd060, 1, { speed: 0.2, dir: { x: 0, y: 1, z: 0 }, jitter: 0.15, spread: 0.32, gravity: 0.6, life: 1.0, size: 0.07, drag: 0.5 }); }
    }
    if (auraMat) auraMat.opacity = 0.55 + Math.sin(time * 3.2) * 0.15;
    // active ring
    if (activeRing && activeRing.visible && activeRing.userData.pc) {
      var ap = activeRing.userData.pc;
      if (!ap.alive || ap.hidden) activeRing.visible = false;
      activeRing.position.set(ap.root.position.x, ap.root.position.y + 0.012, ap.root.position.z);
      var s = 1 + Math.sin(time * 4) * 0.06; activeRing.scale.set(s, 1, s); activeRing.rotation.y = time * 0.6;
      activeRing.material.opacity = 0.7 + Math.sin(time * 4) * 0.25;
    }
    // board ambience
    var pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
    for (var i = 0; i < veinMats.length; i++) veinMats[i].emissiveIntensity = 0.7 + 0.7 * (0.5 + 0.5 * Math.sin(time * 2.0 + i * 2.1));
    if (warnMat) warnMat.opacity = 0.25 + 0.6 * pulse;
    if (markMat) markMat.opacity = 0.6 + 0.35 * Math.sin(time * 5);
    markCenters.forEach(function (m) { m.rotation.y = time * 0.5; });
    if (MAT.perchMat) MAT.perchMat.opacity = 0.55 + 0.25 * Math.sin(time * 2.5);
    if (hlMatSoft) hlMatSoft.opacity = 0.45 + 0.25 * Math.sin(time * 5);
    if (hlMatStrong) hlMatStrong.opacity = 0.5 + 0.12 * Math.sin(time * 6);
    for (var key in trapMats) trapMats[key].opacity = 0.26 + 0.1 * Math.sin(time * 2);
    if (tv) for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var c = tv[y][x].cacheObj; if (!c || c.userData.opening) continue;
      var u2 = c.userData; c.position.y = u2.baseY; u2.body.position.y = 0.18 + 0.04 + Math.sin(time * 2 + u2.phase) * 0.04; u2.body.rotation.y = Math.sin(time * 0.7 + u2.phase) * 0.3;
      u2.glow.material.opacity = 0.45 + 0.15 * Math.sin(time * 3 + u2.phase);
    }
    // corruption motes (one shared particle system)
    if (corruptList.length && PMOTE) {
      var rate = Math.min(45, corruptList.length * 0.7) * (reduced ? 0.4 : 1), n = Math.floor(rate * dt + Math.random());
      for (var m = 0; m < n; m++) {
        var t = corruptList[Math.floor(Math.random() * corruptList.length)];
        PMOTE.emit({ x: tileX(t.x) + rnd(-0.4, 0.4), y: topY(t.vh) + 0.05, z: tileZ(t.y) + rnd(-0.4, 0.4), count: 1, spread: 0, color: Math.random() > 0.3 ? 0xff4ff0 : 0xb070ff, dir: { x: 0, y: 1, z: 0 }, speed: rnd(0.3, 0.7), jitter: 0.05, gravity: 0.15, drag: 0.2, life: rnd(1.6, 2.8), size: rnd(0.06, 0.12), size1: 0.02, sway: 0.4 });
      }
    }
    // world motion
    fragments.forEach(function (f) { var u = f.userData; u.a += u.sp * dt; f.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(time * 0.5 + u.bob) * 0.35, Math.sin(u.a) * u.r); f.rotation.y += u.spin * dt; });
    clouds.forEach(function (c) { var u = c.userData; u.a += u.sp * dt; c.position.x = Math.cos(u.a) * u.r; c.position.z = Math.sin(u.a) * u.r; });
  }

  /* ======================================================================
   * 13. VFX primitives
   * ==================================================================== */
  function burst(x, y, z, color, count, o) {
    if (!PFX) return; o = o || {};
    var e = { x: x, y: y, z: z, color: color, count: count, speed: 1.6, life: 0.7, size: 0.1, size1: 0.02, gravity: -2.5, drag: 1.8, spread: 0.08 };
    for (var k in o) e[k] = o[k];
    PFX.emit(e);
  }
  function dust(x, y, z, count, o) {
    if (!PDUST) return; o = o || {};
    var e = { x: x, y: y, z: z, color: 0xb9a68e, count: count, speed: 0.9, life: 0.9, size: 0.18, size1: 0.45, gravity: 0.25, drag: 2.5, spread: 0.12, alpha: 0.55, up: true };
    for (var k in o) e[k] = o[k];
    PDUST.emit(e);
  }
  function dustRing(x, y, z, color, n) {
    n = n || 14;
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; dust(x + Math.cos(a) * 0.3, y + 0.05, z + Math.sin(a) * 0.3, 1, { color: color || 0xb9a68e, dir: { x: Math.cos(a), y: 0.25, z: Math.sin(a) }, speed: 1.6, jitter: 0.2 }); }
  }
  function V(x, y, z) { return new THREE.Vector3(x, y, z); }
  function tilePos(t, h) { return V(tileX(t.x), visTop(t.x, t.y) + (h || 0), tileZ(t.y)); }
  function flashAt(pos, color, size, ms, texName, opacity) {
    var s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: tex(texName || 'glow'), color: col(color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: opacity == null ? 1 : opacity })));
    s.position.copy(pos); s.renderOrder = 12; var o0 = s.material.opacity;
    addTransient(s, ms || 400, function (k) { var sc = size * (0.4 + easeOut(k) * 0.8); s.scale.set(sc, sc, sc); s.material.opacity = o0 * (1 - k); });
    return s;
  }
  function shockwave(pos, color, radius, ms, o) {
    o = o || {};
    var m = new THREE.Mesh(gPlane(2), own(addMat(color, o.tex || 'ring', o.opacity == null ? 1 : o.opacity)));
    m.position.copy(pos); m.position.y += 0.03; m.renderOrder = 9; var r0 = o.from == null ? 0.1 : o.from;
    addTransient(m, ms || 600, function (k) { var r = lerp(r0, radius, easeOut3(k)); m.scale.set(r, 1, r); m.material.opacity = (o.opacity == null ? 1 : o.opacity) * (1 - k); if (o.spin) m.rotation.y += o.spin * 0.016; });
    return m;
  }
  function columnFx(pos, color, height, radius, ms, o) {
    o = o || {};
    var g = new THREE.Group(), m = new THREE.Mesh(gCyl(1, 1, 1, 24, true), own(addMat(color, 'aura', 0.9)));
    m.position.y = 0.5; g.add(m); g.position.copy(pos); m.renderOrder = 9;
    var m2 = new THREE.Mesh(gCyl(1, 1, 1, 24, true), own(addMat(0xffffff, 'aura', 0.5))); m2.position.y = 0.5; m2.renderOrder = 9; g.add(m2);
    var gs = glowSprite(color, 1, 0.8, 'glow', false); own(gs.material); g.add(gs);
    addTransient(g, ms || 800, function (k) {
      var gr = easeOut3(Math.min(1, k * 2.5)), fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      g.scale.set(radius * (o.shrink ? (1 - k * 0.6) : (0.6 + 0.4 * gr)), height * gr, radius * (o.shrink ? (1 - k * 0.6) : (0.6 + 0.4 * gr)));
      m.material.opacity = fade; m2.material.opacity = 0.6 * fade; gs.position.y = 0.15; gs.scale.set(2.2 / Math.max(0.2, radius), 0.5, 1); gs.material.opacity = 0.7 * fade; m2.scale.set(0.45, 1, 0.45); m.rotation.y += 0.05; m2.rotation.y -= 0.08;
    });
    return g;
  }
  var _up = V(0, 1, 0);
  function beamGeo() {
    return geo('beamX', function () {
      var a = new THREE.PlaneGeometry(1, 1), b = new THREE.PlaneGeometry(1, 1); b.rotateY(Math.PI / 2);
      var pos = [], uv = [], idx = [];
      [a, b].forEach(function (g, gi) {
        var p = g.attributes.position, u = g.attributes.uv, off = gi * 4;
        for (var i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i) + 0.5, p.getZ(i)); uv.push(u.getX(i), u.getY(i)); }
        var ix = g.index.array; for (var j = 0; j < ix.length; j++) idx.push(ix[j] + off);
      });
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      return g;
    });
  }
  function orientBetween(obj, a, b) {
    var d = b.clone().sub(a), len = Math.max(0.001, d.length());
    obj.position.copy(a); obj.quaternion.setFromUnitVectors(_up, d.normalize()); return len;
  }
  function beamFx(a, b, color, width, ms, o) {
    o = o || {};
    var g = new THREE.Group(), m = new THREE.Mesh(beamGeo(), own(addMat(color, 'beam', 1))), core = new THREE.Mesh(beamGeo(), own(addMat(0xffffff, 'beam', 1)));
    m.renderOrder = core.renderOrder = 11; g.add(m); g.add(core);
    var len = orientBetween(g, a, b);
    addTransient(g, ms || 500, function (k) {
      var grow = o.grow ? easeOut3(Math.min(1, k * 4)) : 1, w = width * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85 * 0.9) * (1 + Math.sin(k * 60) * 0.08);
      m.scale.set(w, len * grow, w); core.scale.set(w * 0.35, len * grow, w * 0.35);
      m.material.opacity = 1 - Math.pow(k, 2); core.material.opacity = 1 - k;
    });
    return g;
  }
  function boltFx(a, b, color, ms, jag) {
    var g = new THREE.Group(), pts = [a.clone()], n = 7, d = b.clone().sub(a);
    for (var i = 1; i < n; i++) { var p = a.clone().addScaledVector(d, i / n); p.x += rnd(-1, 1) * (jag || 0.25); p.y += rnd(-1, 1) * (jag || 0.25) * 0.6; p.z += rnd(-1, 1) * (jag || 0.25); pts.push(p); }
    pts.push(b.clone());
    var mats = [own(addMat(color, 'beam', 1)), own(addMat(0xffffff, 'beam', 1))];
    for (var j = 0; j < pts.length - 1; j++) {
      var s = new THREE.Group(), l = orientBetween(s, pts[j], pts[j + 1]);
      var m1 = new THREE.Mesh(beamGeo(), mats[0]); m1.scale.set(0.16, l, 0.16); var m2 = new THREE.Mesh(beamGeo(), mats[1]); m2.scale.set(0.05, l, 0.05);
      m1.renderOrder = m2.renderOrder = 11; s.add(m1); s.add(m2); g.add(s);
    }
    addTransient(g, ms || 260, function (k) { var f = (1 - k) * (0.6 + 0.4 * Math.random()); mats[0].opacity = f; mats[1].opacity = f; });
    return g;
  }
  function tileFlash(x, y, color, delayMs, ms, texName) {
    if (!tv || !tv[y] || !tv[y][x]) return;
    var go = function () {
      var m = new THREE.Mesh(gPlane(0.96), own(addMat(color, texName || 'flash', 0.6)));
      m.position.set(tileX(x), visTop(x, y) + 0.03, tileZ(y)); m.renderOrder = 9;
      addTransient(m, ms || 450, function (k) { m.material.opacity = 0.62 * (1 - k * k); m.position.y = visTop(x, y) + 0.03 + k * 0.12; var s = 1 + k * 0.08; m.scale.set(s, 1, s); });
    };
    if (delayMs) setTimeout(go, delayMs / speed); else go();
  }
  function slashFx(pos, color, size, rot, ms) {
    var s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: tex('slash'), color: col(color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, rotation: rot || 0 })));
    s.position.copy(pos); s.renderOrder = 12;
    addTransient(s, ms || 320, function (k) { var sc = size * (0.6 + easeOut3(k) * 0.6); s.scale.set(sc, sc, sc); s.material.rotation = (rot || 0) - k * 1.2; s.material.opacity = k < 0.2 ? 1 : 1 - (k - 0.2) / 0.8; });
    return s;
  }
  function projectileFx(a, b, color, ms, arcH, o) {
    o = o || {};
    return new Promise(function (res) {
      var g = new THREE.Group(), core = glowSprite(0xffffff, 0.25, 1, 'glow', false), halo = glowSprite(color, 0.7, 0.9, 'glow', false);
      own(core.material); own(halo.material); g.add(halo); g.add(core); g.position.copy(a);
      var done = false, h = arcH == null ? 1 : arcH;
      addTransient(g, ms, function (k) {
        var p = a.clone().lerp(b, k); p.y += Math.sin(k * Math.PI) * h; g.position.copy(p);
        if (Math.random() < 0.9) burst(p.x, p.y, p.z, o.trail || color, 1, { speed: 0.2, life: 0.35, size: (o.size || 0.12), size1: 0, gravity: 0, spread: 0.03 });
        if (k >= 1 && !done) { done = true; res(); }
      });
      setTimeout(function () { if (!done) { done = true; res(); } }, ms / speed + 400);
    });
  }
  function dimScene(amount, ms) {
    if (!lights.key) return;
    var b = lights.base;
    tween(ms || 300, function (k) { var f = 1 - amount * k; lights.key.intensity = b.key * f; lights.hemi.intensity = b.hemi * (1 - amount * 0.6 * k); lights.rim.intensity = b.rim * f; });
  }
  function undim(ms) {
    if (!lights.key) return;
    var b = lights.base, k0 = lights.key.intensity / b.key, h0 = lights.hemi.intensity / b.hemi;
    tween(ms || 400, function (k) { lights.key.intensity = b.key * lerp(k0, 1, k); lights.hemi.intensity = b.hemi * lerp(h0, 1, k); lights.rim.intensity = b.rim * lerp(k0, 1, k); });
  }
  function pieceTint(pc, color, ms) {
    if (!pc) return;
    var s = glowSprite(color, 1.3, 0.9, 'glow', false); own(s.material); s.position.y = 0.45;
    addTransient(s, ms || 300, function (k) { s.material.opacity = 0.9 * (1 - k); }, pc.lift);
  }
  function classGlow(e) { var o = ownerOf(e); return o && CLASS_PAL[normClass(o.cls)] ? CLASS_PAL[normClass(o.cls)].glow : 0xffffff; }

  /* ======================================================================
   * 14. The view interface (CORE -> view). Every method returns a Promise.
   * ==================================================================== */
  var pendingSnap = {};
  function isHumanId(id) { return humanId != null && String(id) === String(humanId); }
  function gbReady(p) {
    try {
      if (!p || p.alive === false || p.isDecoy) return false;
      if (!hasData() || !DATA.GAMEBREAKERS || p.gb == null) return false;
      var gb = DATA.GAMEBREAKERS[p.gb]; if (!gb) return false;
      return (p.meter || 0) >= (gb.cost || 100);
    } catch (e) { return false; }
  }
  function entities() { return game ? (game.entities || game.players || []) : []; }

  function init(g) {
    game = g;
    if (g && g.humanId != null && g.humanId >= 0) humanId = g.humanId;
    if (typeof THREE === 'undefined') return resolved();
    buildWorld();
    buildBoard(g);
    entities().forEach(function (e) { if (e.alive !== false) createPiece(e); });
    refresh(g);
    cam.base.set(0, 0.3, 0); cam.target.copy(cam.base);
    fitCamera();
    stopped = false; kick();
    return resolved();
  }
  function refresh(g) {
    if (g) game = g;
    if (!tv || !game) return resolved();
    var seen = {};
    entities().forEach(function (e) {
      var key = String(e.id); seen[key] = 1;
      var pc = pieces[key];
      if (!pc) { if (e.alive === false) return; pc = createPiece(e); }
      pc.ent = e;
      if (e.alive === false && pc.alive && !pc.dying) { pc.alive = false; pc.root.visible = false; }
      if (!pc.alive) return;
      if (!pc.busy && (pc.tx !== e.x || pc.ty !== e.y)) {
        if (!pendingSnap[key]) pendingSnap[key] = now();
        else if (now() - pendingSnap[key] > 150) { pc.tx = e.x; pc.ty = e.y; delete pendingSnap[key]; }
        else { var kk = key; setTimeout(function () { var p2 = pieces[kk]; if (p2 && !p2.busy && pendingSnap[kk]) { p2.tx = p2.ent.x; p2.ty = p2.ent.y; delete pendingSnap[kk]; } }, 180); }
      } else delete pendingSnap[key];
      var o = ownerOf(e);
      // shield bubble
      var sh = (o.shield || 0) > 0 && !e.isDecoy;
      if (sh && !pc.shield.visible) { pc.shield.visible = true; pc.shieldK = 1; }
      else if (!sh && pc.shield.visible) { pc.shield.visible = false; }
      pc.aura.visible = gbReady(o) && !pc.hidden;
      // invisibility
      var inv = !!o.invisible;
      if (inv && isHumanId(o.id)) { pc.hidden = false; pc.root.visible = true; setGhost(pc, true); }
      else if (inv) { pc.hidden = true; pc.root.visible = false; }
      else { pc.hidden = false; if (!pc.dying) pc.root.visible = true; setGhost(pc, false); }
      if (pc.bar) {
        updateBarValues(pc);
        pc.bar.el.classList.toggle('ghost', inv);
        pc.bar.el.classList.toggle('me', isHumanId(o.id));
        pc.bar.el.classList.toggle('act', !!(game.active && String(game.active.id) === String(o.id) && !e.isDecoy));
        if (pc.last.name !== o.name) { pc.bar.name.textContent = entName(e); pc.last.name = o.name; }
      }
    });
    for (var k in pieces) if (!seen[k] && !pieces[k].dying) removePiece(k);
    kick();
    return resolved();
  }
  function wait(ms) { return delay(ms || 0); }
  function roundStart(round) {
    if (activeRing) activeRing.visible = false;
    return resolved();
  }
  function turnStart(player) {
    stopped = false;
    var pc = pieceOf(player);
    refresh();
    if (!pc || !pc.alive) { if (activeRing) activeRing.visible = false; return resolved(); }
    if (activeRing) { activeRing.userData.pc = pc; activeRing.visible = !pc.hidden; activeRing.material.color.copy(col(entColor(ownerOf(player)))).lerp(new THREE.Color(1, 1, 1), 0.35); }
    var goal = V(tileX(pc.tx) * 0.1, 0.3, tileZ(pc.ty) * 0.1), from = cam.target.clone();
    if (!pc.hidden) { var hp = piecePos(pc, 0.05); shockwave(hp, entColor(ownerOf(player)), 0.9, 600, { opacity: 0.8 }); }
    return tween(650, function (k) { cam.target.copy(from).lerp(goal, k); }, easeInOut);
  }
  function tilesChanged(tiles) {
    if (!tv || !tiles) return resolved();
    var raised = false;
    tiles.forEach(function (t) { var s = tileState(t.x, t.y), v = tv[t.y] && tv[t.y][t.x]; if (s && v && (s.h || 0) !== v.h) raised = true; syncTile(t.x, t.y, true); });
    if (raised) shake(0.08, 300);
    return raised ? delay(460) : resolved();
  }

  // movement ---------------------------------------------------------------
  function faceDir(pc, dx, dz) { if (dx || dz) pc.faceGoal = Math.atan2(dx, dz); }
  function move(entity, path, mode) {
    var pc = pieceOf(entity);
    if (!pc || !path || !path.length) return resolved();
    delete pendingSnap[pc.key];
    var end = path[path.length - 1];
    if (pc.hidden || !tv) { pc.tx = end.x; pc.ty = end.y; return resolved(); }
    pc.busy++;
    var p0 = path[0];
    pc.root.position.set(tileX(p0.x), visTop(p0.x, p0.y), tileZ(p0.y));
    var done = function () { pc.busy = Math.max(0, pc.busy - 1); pc.tx = end.x; pc.ty = end.y; pc.faceGoal = null; pc.lift.position.set(0, 0, 0); pc.lift.scale.set(1, 1, 1); };
    mode = mode || 'walk';
    var chain = Promise.resolve();
    if (mode === 'walk') {
      path.slice(1).forEach(function (t, i) {
        chain = chain.then(function () {
          var a = path[i], b = t, ax = tileX(a.x), az = tileZ(a.y), bx = tileX(b.x), bz = tileZ(b.y), ay = visTop(a.x, a.y), by = visTop(b.x, b.y);
          faceDir(pc, bx - ax, bz - az);
          var hop = 0.22 + Math.max(0, by - ay) * 0.9;
          return tween(240, function (k) {
            var e = easeInOut(k);
            pc.root.position.set(lerp(ax, bx, e), lerp(ay, by, e) + Math.sin(k * Math.PI) * hop, lerp(az, bz, e));
            var sq = k > 0.85 ? 1 - Math.sin((k - 0.85) / 0.15 * Math.PI) * 0.12 : 1;
            pc.lift.scale.set(1 + (1 - sq) * 0.6, sq, 1 + (1 - sq) * 0.6);
          }).then(function () { dust(bx, by + 0.02, bz, 4, { speed: 0.5, size: 0.12, size1: 0.3, life: 0.5 }); });
        });
      });
    } else if (mode === 'dash') {
      var pts = path.map(function (t) { return V(tileX(t.x), visTop(t.x, t.y), tileZ(t.y)); });
      var total = 0, seg = [0]; for (var i = 1; i < pts.length; i++) { total += pts[i].distanceTo(pts[i - 1]); seg.push(total); }
      faceDir(pc, pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].z - pts[0].z);
      var gl = classGlow(entity), lastGhost = -1;
      chain = tween(160 + total * 55, function (k) {
        var d = easeOut(k) * total, j = 1; while (j < seg.length - 1 && seg[j] < d) j++;
        var f = seg[j] - seg[j - 1] > 0 ? (d - seg[j - 1]) / (seg[j] - seg[j - 1]) : 1;
        var p = pts[j - 1].clone().lerp(pts[j], clamp(f, 0, 1)); pc.root.position.copy(p);
        pc.lift.rotation.x = 0;
        var step = Math.floor(k * 10);
        if (step !== lastGhost && k < 0.9) { lastGhost = step; flashAt(V(p.x, p.y + 0.45, p.z), gl, 1.1, 380, 'soft', 0.55); }
        burst(p.x, p.y + 0.3, p.z, gl, 2, { speed: 0.3, life: 0.4, size: 0.12, gravity: 0, spread: 0.2 });
        dust(p.x, p.y + 0.02, p.z, 1, { speed: 0.4, life: 0.5, size: 0.1, size1: 0.3, alpha: 0.4 });
      });
    } else if (mode === 'teleport') {
      var gl2 = classGlow(entity), A = tilePos(p0), B = tilePos(end);
      chain = tween(260, function (k) { pc.lift.scale.set(1 - k * 0.9, 1 + k * 0.6, 1 - k * 0.9); pc.lift.position.y = k * 0.2; }, easeIn).then(function () {
        burst(A.x, A.y + 0.4, A.z, gl2, 22, { speed: 1.4, life: 0.6, size: 0.1, gravity: 1.5, spread: 0.25 });
        columnFx(A, gl2, 1.6, 0.35, 450, { shrink: true });
        pc.root.position.copy(B); pc.lift.scale.set(0.01, 1.6, 0.01);
        columnFx(B, gl2, 1.6, 0.35, 500);
        burst(B.x, B.y + 0.4, B.z, gl2, 18, { speed: 1.2, life: 0.6, size: 0.1, gravity: -1, spread: 0.3 });
        return tween(300, function (k) { pc.lift.scale.set(0.1 + k * 0.9, 1.6 - k * 0.6, 0.1 + k * 0.9); pc.lift.position.y = 0.2 * (1 - k); }, easeOutBack);
      });
    } else { // push / pull: slide without turning, quick
      var pts2 = path.map(function (t) { return V(tileX(t.x), visTop(t.x, t.y), tileZ(t.y)); });
      var last = pts2[pts2.length - 1], first = pts2[0];
      chain = tween(140 + (pts2.length - 1) * 110, function (k) {
        var e = easeOut3(k), idx = e * (pts2.length - 1), j = Math.min(pts2.length - 2, Math.floor(idx));
        if (pts2.length < 2) { pc.root.position.copy(first); return; }
        var p = pts2[j].clone().lerp(pts2[j + 1], idx - j); pc.root.position.copy(p);
        pc.lift.rotation.z = Math.sin(k * Math.PI) * 0.15 * (mode === 'pull' ? -1 : 1);
        if (Math.random() < 0.6) dust(p.x, p.y + 0.02, p.z, 1, { speed: 0.3, size: 0.12, size1: 0.35, life: 0.6 });
      }).then(function () { pc.lift.rotation.z = 0; dust(last.x, last.y + 0.03, last.z, 6, { speed: 0.8 }); });
    }
    return chain.then(done, function (e) { done(); });
  }
  function collide(entity, dir) {
    var pc = pieceOf(entity); if (!pc || pc.hidden) return resolved();
    dir = dir || { dx: 0, dy: 0 };
    var p = pc.root.position, ex = p.x + dir.dx * 0.45, ez = p.z + dir.dy * 0.45, ey = p.y + 0.25;
    dust(ex, ey, ez, 14, { speed: 1.4, size: 0.16, size1: 0.5, life: 0.8, up: false, spread: 0.1, gravity: 0.3, alpha: 0.65 });
    burst(ex, ey, ez, 0xfff0c0, 10, { speed: 2.2, life: 0.35, size: 0.07 });
    flashAt(V(ex, ey, ez), 0xffe0a0, 0.9, 220);
    shake(0.12, 260);
    pc.busy++;
    return tween(260, function (k) { var s = Math.sin(k * Math.PI) * (k < 0.4 ? 1 : 0.6); pc.lift.position.set(dir.dx * 0.12 * s, 0, dir.dy * 0.12 * s); pc.lift.scale.set(1 + (dir.dx ? -0.1 : 0.05) * s, 1 - 0.06 * s, 1 + (dir.dy ? -0.1 : 0.05) * s); })
      .then(function () { pc.busy = Math.max(0, pc.busy - 1); pc.lift.position.set(0, 0, 0); pc.lift.scale.set(1, 1, 1); });
  }

  // attacks ----------------------------------------------------------------
  function attack(user, spec) {
    spec = spec || {};
    var pc = pieceOf(user), color = spec.color != null ? toHex(spec.color) : classGlow(user);
    var from = spec.from || (pc ? { x: pc.tx, y: pc.ty } : null), target = spec.target || (spec.tiles && spec.tiles[0]) || from;
    if (!from || !tv) return resolved();
    var A = pc && !pc.hidden ? piecePos(pc, 0.5) : tilePos(from, 0.5), B = target ? tilePos(target, 0.45) : A.clone();
    if (pc && target && (target.x !== from.x || target.y !== from.y)) faceDir(pc, B.x - A.x, B.z - A.z);
    var style = spec.style || 'melee';
    var release = function () { if (pc) setTimeout(function () { pc.faceGoal = null; }, 500 / speed); };
    if (style === 'melee') {
      if (!pc) { slashFx(B, color, 1.2, rnd(0, 6), 300); return delay(150).then(release); }
      var dx = B.x - A.x, dz = B.z - A.z, L = Math.max(0.001, Math.hypot(dx, dz)); dx /= L; dz /= L;
      pc.busy++;
      return tween(130, function (k) { pc.lift.position.set(-dx * 0.08 * k, 0.02 * k, -dz * 0.08 * k); }, easeOut).then(function () {
        return tween(110, function (k) { pc.lift.position.set(dx * (0.34 * k - 0.08 * (1 - k)), 0.04 * (1 - k), dz * (0.34 * k - 0.08 * (1 - k))); }, easeIn);
      }).then(function () {
        var mid = A.clone().lerp(B, 0.75); mid.y = B.y + 0.05;
        slashFx(mid, color, 1.25, Math.atan2(dz, dx) + rnd(-0.4, 0.4), 320);
        slashFx(mid, 0xffffff, 0.9, Math.atan2(dz, dx) + 0.3, 220);
        burst(B.x, B.y, B.z, color, 8, { speed: 2, life: 0.4, size: 0.08 });
        tween(260, function (k) { pc.lift.position.set(dx * 0.34 * (1 - k), 0, dz * 0.34 * (1 - k)); }, easeOut).then(function () { pc.busy = Math.max(0, pc.busy - 1); pc.lift.position.set(0, 0, 0); });
        release();
      });
    }
    if (style === 'projectile') {
      if (pc) pieceTint(pc, color, 250);
      flashAt(A, color, 0.8, 200);
      var d = A.distanceTo(B);
      return projectileFx(A, B, color, 260 + d * 55, 0.4 + d * 0.18).then(function () { flashAt(B, color, 1.4, 300); flashAt(B, 0xffffff, 0.6, 180); burst(B.x, B.y, B.z, color, 16, { speed: 2.2, life: 0.5, size: 0.09 }); release(); });
    }
    if (style === 'beam') {
      var tiles = spec.tiles && spec.tiles.length ? spec.tiles : [target];
      var far = tiles.reduce(function (best, t) { var dd = Math.abs(t.x - from.x) + Math.abs(t.y - from.y); return dd > best.d ? { d: dd, t: t } : best; }, { d: -1, t: target }).t;
      var E = tilePos(far, 0.45);
      // extend half a tile past the last tile
      var dir = E.clone().sub(A); dir.y = 0; if (dir.lengthSq() > 0) { dir.normalize(); E.addScaledVector(dir, 0.4); }
      if (pc) pieceTint(pc, color, 300);
      flashAt(A, color, 1.0, 250);
      return delay(110).then(function () {
        beamFx(A, E, color, 0.32, 480, { grow: true });
        tiles.forEach(function (t, i) { tileFlash(t.x, t.y, color, i * 35, 400); var P2 = tilePos(t, 0.4); setTimeout(function () { burst(P2.x, P2.y, P2.z, color, 6, { speed: 1.4, life: 0.4, size: 0.08 }); }, i * 35 / speed); });
        return delay(160);
      }).then(release);
    }
    if (style === 'area') {
      var ts = spec.tiles && spec.tiles.length ? spec.tiles : [target];
      var c = target || from;
      if (pc) { pieceTint(pc, color, 300); pc.busy++; tween(220, function (k) { pc.lift.position.y = Math.sin(k * Math.PI) * 0.18; }).then(function () { pc.busy = Math.max(0, pc.busy - 1); pc.lift.position.y = 0; }); }
      var sorted = ts.slice().sort(function (a, b) { return (Math.abs(a.x - c.x) + Math.abs(a.y - c.y)) - (Math.abs(b.x - c.x) + Math.abs(b.y - c.y)); });
      var maxD = 0;
      sorted.forEach(function (t) { var dd = Math.abs(t.x - c.x) + Math.abs(t.y - c.y); maxD = Math.max(maxD, dd); tileFlash(t.x, t.y, color, 60 + dd * 70, 420); setTimeout(function () { var P3 = tilePos(t, 0.1); burst(P3.x, P3.y, P3.z, color, 6, { speed: 1.5, up: true, life: 0.5, size: 0.09 }); }, (60 + dd * 70) / speed); });
      shockwave(tilePos(c), color, 1.6 + maxD * 0.6, 500);
      return delay(100 + maxD * 70 + 60).then(release);
    }
    // self
    if (pc) { columnFx(piecePos(pc, 0), color, 1.4, 0.45, 600); shockwave(piecePos(pc, 0.02), color, 1.2, 500); burst(A.x, A.y - 0.3, A.z, color, 14, { speed: 0.8, up: true, gravity: 1.2, life: 0.8, size: 0.08, spread: 0.3 }); }
    return delay(200).then(release);
  }
  function hit(entity, amount, info) {
    info = info || {};
    var pc = pieceOf(entity); if (!pc || !tv) return resolved();
    var big = !!info.big || amount >= 10, P0 = piecePos(pc, 0.45);
    var corr = info.source === 'corruption', dot = info.source === 'dot';
    if (!pc.hidden) {
      var hpLoss = Math.max(0, (amount || 0) - (info.absorbed || 0));
      var num = hpLoss > 0 ? '-' + hpLoss : (info.absorbed ? 'Block' : '0');
      floatText(headPos(pc, 0.25), num, hpLoss > 0 ? (corr ? '#ff6af0' : dot ? '#d68cff' : '#ff5a5a') : '#8fdcff', big ? 'big' : '');
      if (info.absorbed) setTimeout(function () { floatText(headPos(pc, 0.05), '⛨' + info.absorbed, '#8fdcff', 'small'); }, 120 / speed);
      if (corr) {
        burst(P0.x, P0.y - 0.3, P0.z, 0xff40e0, 26, { speed: 1.6, up: true, gravity: 1.5, life: 0.9, size: 0.12, spread: 0.25 });
        columnFx(piecePos(pc, 0), 0xd030ff, 1.3, 0.42, 600); flashAt(P0, 0xb030ff, 1.6, 350);
      } else {
        burst(P0.x, P0.y, P0.z, info.pierce ? 0xfff0a0 : 0xffd0a0, big ? 22 : 12, { speed: 2.4, life: 0.45, size: 0.08 });
        flashAt(P0, info.pierce ? 0xffffff : 0xff6040, big ? 1.8 : 1.2, 260);
      }
      if (info.absorbed && pc.shield.visible) { pc.shieldK = 2.2; tween(400, function (k) { pc.shieldK = lerp(2.2, 1, k); }); }
      if (big) shake(0.22, 380); else shake(0.05, 160);
    }
    pc.busy++;
    var pos0 = pc.root.position.clone(), rx = rnd(-1, 1), rz = rnd(-1, 1);
    return tween(300, function (k) { var s = Math.sin(k * Math.PI) * (1 - k); pc.lift.position.set(rx * 0.1 * s, 0, rz * 0.1 * s); pc.lift.rotation.x = -0.35 * s * rz; pc.lift.rotation.z = 0.35 * s * rx; })
      .then(function () { pc.busy = Math.max(0, pc.busy - 1); pc.lift.position.set(0, 0, 0); pc.lift.rotation.set(0, 0, 0); updateBarValues(pc); });
  }
  function heal(entity, amount) {
    var pc = pieceOf(entity); if (!pc || pc.hidden || !tv) return resolved();
    var P0 = piecePos(pc, 0.1);
    floatText(headPos(pc, 0.25), '+' + amount, '#6dff9a', amount >= 10 ? 'big' : '');
    for (var i = 0; i < 3; i++) setTimeout(function () { burst(P0.x, P0.y, P0.z, Math.random() > 0.4 ? 0x7dffa0 : 0xffe080, 8, { speed: 0.6, dir: { x: 0, y: 1, z: 0 }, jitter: 0.25, spread: 0.3, gravity: 0.8, drag: 0.5, life: 1.0, size: 0.09, size1: 0.02 }); }, i * 90 / speed);
    shockwave(piecePos(pc, 0.03), 0x6dffa0, 1.0, 600, { opacity: 0.8 });
    pieceTint(pc, 0x6dffa0, 400);
    return delay(320);
  }
  function shield(entity, amount) {
    var pc = pieceOf(entity); if (!pc || pc.hidden || !tv) return resolved();
    pc.shield.visible = true;
    floatText(headPos(pc, 0.25), '+' + amount, '#8fdcff', '');
    var P0 = piecePos(pc, 0.55);
    burst(P0.x, P0.y, P0.z, 0x9fe6ff, 14, { speed: 1.2, life: 0.5, size: 0.07, gravity: 0 });
    return tween(420, function (k) { pc.shieldK = 1 + (1 - k) * 2.5; pc.shield.scale.setScalar(0.6 + easeOutBack(k) * 0.4); }).then(function () { pc.shield.scale.setScalar(1); pc.shieldK = 1; });
  }
  var STATUS = {
    root: ['Rooted', 0x9cff5a], sap: ['Sapped', 0xffb060], curse: ['Cursed', 0xff4ff0], renew: ['Renew', 0x6dffb0], veil: ['Veiled', 0xc0a0ff],
    tether: ['Tethered', 0xff4060], undying: ['Undying', 0xffe080], finalform: ['Final Form', 0xff9a3c], bastion: ['Bastion', 0x8fd0ff],
    perch: ['Perched', 0xb6ff7a], vanish: ['Vanished', 0xc49cff], rotembrace: ['Rot Embrace', 0xff4ff0], aim: ['Steady Aim', 0xffe27a]
  };
  function status(entity, type) {
    var pc = pieceOf(entity); if (!pc || !tv) return resolved();
    var st = STATUS[norm(type)] || [String(type || ''), 0xffffff];
    if (pc.hidden) return resolved();
    floatText(headPos(pc, 0.3), st[0], hexStr(st[1]), 'small');
    shockwave(piecePos(pc, 0.03), st[1], 0.9, 500, { opacity: 0.9 });
    var P0 = piecePos(pc, 0.3); burst(P0.x, P0.y, P0.z, st[1], 10, { speed: 0.8, up: true, gravity: 0.6, life: 0.7, size: 0.08, spread: 0.3 });
    return delay(260);
  }
  var shardGeos = null;
  function death(entity, place) {
    var pc = pieceOf(entity); if (!pc) return resolved();
    if (pc.hidden || !tv) { pc.alive = false; pc.root.visible = false; return resolved(); }
    pc.dying = true; pc.busy++;
    var cols = [], seenC = {};
    pc.grp.traverse(function (o) { if (o.isMesh && o.material && o.material.color && !o.material.transparent && cols.length < 6) { var h = o.material.color.getHex(); if (!seenC[h]) { seenC[h] = 1; cols.push(o.material); } } });
    if (!cols.length) cols.push(mStd(0x888888, 0.6, 0));
    var P0 = piecePos(pc, 0.4);
    flashAt(P0, 0xffffff, 2.2, 350); flashAt(P0, classGlow(entity), 3, 600);
    shockwave(piecePos(pc, 0.03), classGlow(entity), 2.0, 700);
    burst(P0.x, P0.y, P0.z, classGlow(entity), 30, { speed: 2.6, life: 0.8, size: 0.1 });
    shake(0.3, 450);
    if (!shardGeos) shardGeos = [gBox(0.12, 0.09, 0.07), gIco(0.07, 0), gOct(0.07), gBox(0.08, 0.14, 0.06), new THREE.TetrahedronGeometry(0.09)];
    var floorY = pc.root.position.y;
    var count = reduced ? 10 : 18;
    for (var i = 0; i < count; i++) {
      (function (i) {
        var m = new THREE.Mesh(shardGeos[i % shardGeos.length], cols[i % cols.length]); m.castShadow = true;
        var a = rnd(0, Math.PI * 2), sp = rnd(0.8, 2.2);
        m.position.set(P0.x + rnd(-0.15, 0.15), floorY + rnd(0.1, 0.8), P0.z + rnd(-0.15, 0.15));
        var vel = V(Math.cos(a) * sp, rnd(1.5, 3.5), Math.sin(a) * sp), av = V(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)), bounced = 0;
        addTransient(m, 1600 + rnd(0, 300), function (k, o, dt) {
          vel.y -= 9 * dt; o.position.addScaledVector(vel, dt);
          o.rotation.x += av.x * dt; o.rotation.y += av.y * dt; o.rotation.z += av.z * dt;
          var gx = Math.round(o.position.x + (N - 1) / 2), gz = Math.round(o.position.z + (N - 1) / 2);
          var onBoard = gx >= 0 && gz >= 0 && gx < N && gz < N, fy = onBoard ? visTop(gx, gz) + 0.04 : -99;
          if (o.position.y < fy && bounced < 2 && vel.y < 0 && o.position.y > fy - 0.3) { o.position.y = fy; vel.y *= -0.35; vel.x *= 0.6; vel.z *= 0.6; av.multiplyScalar(0.5); bounced++; }
          if (k > 0.7) o.scale.setScalar(Math.max(0.01, 1 - (k - 0.7) / 0.3));
        });
      })(i);
    }
    // soul wisp rising
    var soul = glowSprite(classGlow(entity), 0.8, 0.9, 'glow', false); own(soul.material); soul.position.copy(P0);
    addTransient(soul, 1400, function (k) { soul.position.y = P0.y + k * 2.2; soul.material.opacity = 0.9 * (1 - k); soul.scale.setScalar(0.8 * (1 - k * 0.5)); });
    pc.root.visible = false; pc.alive = false;
    if (activeRing && activeRing.userData.pc === pc) activeRing.visible = false;
    return delay(900).then(function () { pc.busy = 0; pc.dying = false; });
  }
  function spawn(entity) {
    if (!tv) return resolved();
    var pc = pieceOf(entity) || createPiece(entity);
    pc.alive = true; pc.root.visible = true; pc.tx = entity.x; pc.ty = entity.y;
    var P0 = tilePos({ x: entity.x, y: entity.y }, 0.4), gl = classGlow(entity);
    dust(P0.x, P0.y - 0.3, P0.z, 10, { color: 0x6a4a9a, speed: 0.8, alpha: 0.6 });
    burst(P0.x, P0.y, P0.z, gl, 16, { speed: 1.2, life: 0.6, size: 0.1 });
    refresh();
    return tween(380, function (k) { pc.lift.scale.setScalar(Math.max(0.01, easeOutBack(k))); }).then(function () { pc.lift.scale.setScalar(1); });
  }
  function removeEnt(entity) {
    var pc = pieceOf(entity); if (!pc) return resolved();
    if (pc.hidden || !tv) { removePiece(pc.key); return resolved(); }
    var P0 = piecePos(pc, 0.4);
    dust(P0.x, P0.y - 0.2, P0.z, 16, { color: 0x5a3a8a, speed: 1.0, alpha: 0.7, size: 0.2, size1: 0.6 });
    burst(P0.x, P0.y, P0.z, 0xc49cff, 18, { speed: 1.6, life: 0.5, size: 0.09 });
    flashAt(P0, 0xc49cff, 1.4, 300);
    pc.dying = true;
    return tween(260, function (k) { pc.lift.scale.set(1 + k * 0.3, Math.max(0.01, 1 - k), 1 + k * 0.3); }).then(function () { removePiece(pc.key); });
  }
  var forcedWarn = {};
  function ringWarning(ring, tiles) {
    if (!tv || !tiles) return resolved();
    tiles.forEach(function (t, i) {
      var v = tv[t.y] && tv[t.y][t.x]; if (!v) return;
      var s = tileState(t.x, t.y);
      if (s && !s.warning && !s.corrupted) { syncTile(t.x, t.y, true, { warning: true }); } else syncTile(t.x, t.y, true);
      tileFlash(t.x, t.y, 0xff40d8, i * 12, 500, 'warn');
    });
    return delay(Math.min(700, tiles.length * 12 + 300));
  }
  function ringClose(ring, tiles) {
    if (!tv || !tiles || !tiles.length) return resolved();
    var c0 = (N - 1) / 2;
    tiles = tiles.slice().sort(function (a, b) { var aa = Math.atan2(a.y - c0, a.x - c0), bb = Math.atan2(b.y - c0, b.x - c0); return ((aa + 2.4 + Math.PI * 4) % (Math.PI * 2)) - ((bb + 2.4 + Math.PI * 4) % (Math.PI * 2)); });
    var step = Math.max(8, Math.min(45, 1300 / tiles.length));
    var total = step * tiles.length;
    var rumble = setInterval(function () { shake(0.12, 300); }, 200);
    setTimeout(function () { clearInterval(rumble); }, (total + 200) / speed);
    shake(0.18, 400);
    dimScene(0.25, 250);
    return new Promise(function (res) {
      tiles.forEach(function (t, i) {
        setTimeout(function () {
          syncTile(t.x, t.y, true, { corrupted: true, warning: false });
          var P0 = tilePos(t, 0.05);
          if (i % 2 === 0) dust(P0.x, P0.y, P0.z, 2, { color: 0x6a2a7a, speed: 0.6, alpha: 0.5 });
        }, i * step / speed);
      });
      setTimeout(function () { clearInterval(rumble); undim(400); res(); }, (total + 250) / speed);
    });
  }

  // fx ---------------------------------------------------------------------
  function fx(type, data) {
    data = data || {};
    if (!tv) return resolved();
    var t = norm(type);
    try {
      switch (t) {
        case 'cacheopen': return fxCacheOpen(data);
        case 'trapplaced': {
          var tl = data.tile; if (!tl) return resolved();
          if (isHumanId(data.ownerId)) { syncTile(tl.x, tl.y, true); var P1 = tilePos(tl, 0.05); shockwave(P1, 0xd0ff80, 0.7, 400, { opacity: 0.7 }); }
          return delay(120);
        }
        case 'traptrigger': {
          var tt = data.tile || (data.entity && { x: data.entity.x, y: data.entity.y }); if (!tt) return resolved();
          var P2 = tilePos(tt, 0);
          var sp = new THREE.Group(); sp.position.copy(P2);
          for (var i = 0; i < 7; i++) { var a = i / 7 * Math.PI * 2; var c = new THREE.Mesh(gCone(0.05, 0.32, 5), mStd(0xc8c8d0, 0.3, 0.8)); c.position.set(Math.cos(a) * 0.25, 0.16, Math.sin(a) * 0.25); c.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); sp.add(c); }
          addTransient(sp, 700, function (k) { var s = k < 0.15 ? easeOutBack(k / 0.15) : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1; sp.scale.set(1, Math.max(0.01, s), 1); });
          flashAt(V(P2.x, P2.y + 0.2, P2.z), 0xff6040, 1.6, 300); burst(P2.x, P2.y + 0.2, P2.z, 0xffa060, 16, { speed: 2, life: 0.5, size: 0.08 });
          shake(0.1, 250); syncTile(tt.x, tt.y, true);
          return delay(250);
        }
        case 'tileraise': {
          (data.tiles || []).forEach(function (q) { syncTile(q.x, q.y, true); var P3 = tilePos(q, 0); dustRing(P3.x, P3.y, P3.z); });
          shake(0.12, 400); return delay(450);
        }
        case 'cleanse': {
          (data.tiles || []).forEach(function (q, i) { setTimeout(function () { syncTile(q.x, q.y, true); var P4 = tilePos(q, 0.05); burst(P4.x, P4.y, P4.z, i % 2 ? 0xbffff0 : 0x7affd8, 10, { speed: 0.8, dir: { x: 0, y: 1, z: 0 }, jitter: 0.3, spread: 0.35, gravity: 0.5, life: 0.9, size: 0.08 }); tileFlash(q.x, q.y, 0xbffff0, 0, 500); }, i * 40 / speed); });
          return delay(350);
        }
        case 'corrupt': {
          (data.tiles || []).forEach(function (q, i) { setTimeout(function () { syncTile(q.x, q.y, true, { corrupted: true }); var P5 = tilePos(q, 0.05); burst(P5.x, P5.y, P5.z, 0xff40e0, 12, { speed: 1.5, up: true, life: 0.8, size: 0.12 }); }, i * 50 / speed); });
          return delay(350);
        }
        case 'draw': {
          var pc = pieceOf(data.player); if (!pc || pc.hidden) return resolved();
          var H = headPos(pc, 0.15);
          burst(H.x, H.y, H.z, 0x9fe6ff, 4 + 2 * (data.n || 1), { speed: 0.5, dir: { x: 0, y: 1, z: 0 }, jitter: 0.3, gravity: 0, life: 0.6, size: 0.07 });
          return delay(150);
        }
        case 'mark': {
          var ts = data.tiles || [];
          ts.forEach(function (q, i) { syncTile(q.x, q.y, true, { marked: true }); tileFlash(q.x, q.y, 0xff6a2a, i * 30, 500); });
          if (ts.length) { var cx = 0, cz = 0; ts.forEach(function (q) { cx += q.x; cz += q.y; }); var C = tilePos({ x: Math.round(cx / ts.length), y: Math.round(cz / ts.length) }, 0.05); shockwave(C, 0xff6a2a, 1.7, 600, { from: 3, tex: 'mark', opacity: 0.8 }); }
          return delay(400);
        }
        case 'decoyhit': {
          var dp = pieceOf(data.entity); if (!dp) return resolved();
          var P6 = piecePos(dp, 0.4); flashAt(P6, 0xc49cff, 1.6, 300); dust(P6.x, P6.y - 0.2, P6.z, 14, { color: 0x6a4aa0, speed: 1.2, alpha: 0.7 });
          floatText(headPos(dp, 0.2), 'Decoy!', '#d8c0ff', 'small');
          return delay(200);
        }
        case 'gamebreaker': return gbFx(data);
      }
    } catch (e) { console.error('VIEW fx error', type, e); }
    return resolved();
  }
  function fxCacheOpen(data) {
    var tl = data.tile || (data.entity && { x: data.entity.x, y: data.entity.y }); if (!tl) return resolved();
    var v = tv[tl.y] && tv[tl.y][tl.x]; var P0 = tilePos(tl, 0.3);
    var chest = v && v.cacheObj;
    if (v) { v.cache = false; v.cacheObj = null; }
    flashAt(P0, 0xffd060, 2.2, 600); columnFx(tilePos(tl, 0), 0xffc040, 2.2, 0.4, 900);
    burst(P0.x, P0.y, P0.z, 0xffd870, 30, { speed: 2.2, up: true, gravity: -3, life: 0.9, size: 0.1, colorVar: 0.1 });
    if (chest) {
      chest.userData.opening = true;
      var lid = chest.userData.lid, body = chest.userData.body;
      return tween(700, function (k) {
        lid.rotation.x = -easeOutBack(Math.min(1, k * 2)) * 1.9;
        var s = k < 0.6 ? 1 + k * 0.3 : (1.18) * (1 - (k - 0.6) / 0.4);
        body.scale.setScalar(Math.max(0.01, s) * 1.3);
      }).then(function () { if (chest.parent) chest.parent.remove(chest); });
    }
    return delay(400);
  }

  /* ======================================================================
   * 15. Gamebreaker showpieces (18 + generic)
   * ==================================================================== */
  var GB_KEYS = [
    ['irontide', /iron|tide/], ['lastbastion', /bastion/], ['earthshatter', /earth|shatter/],
    ['thousandcuts', /thousand|cuts/], ['blitzchain', /blitz/], ['finalform', /final|form/],
    ['railpiercer', /rail|piercer/], ['skyfallvolley', /skyfall|volley/], ['eaglesperch', /eagle|perch/],
    ['grandswap', /grand|swap/], ['mirrorlegion', /mirror|legion/], ['vanish', /vanish/],
    ['undyingpulse', /undying/], ['siphonfield', /siphon/], ['bloodtether', /tether/],
    ['collapse', /collapse/], ['blightbloom', /bloom/], ['rotembrace', /embrace|rotemb/]
  ];
  function gbKey(id) {
    var n = norm(id).replace(/[0-9]/g, '');
    for (var i = 0; i < GB_KEYS.length; i++) if (n === GB_KEYS[i][0]) return n;
    for (var j = 0; j < GB_KEYS.length; j++) if (GB_KEYS[j][1].test(n)) return GB_KEYS[j][0];
    if (hasData() && DATA.GAMEBREAKERS && DATA.GAMEBREAKERS[id] && DATA.GAMEBREAKERS[id].name) { var nm = norm(DATA.GAMEBREAKERS[id].name); if (nm !== n) return gbKey(nm); }
    return 'generic';
  }
  function gbFx(d) {
    var user = d.user, pc = pieceOf(user);
    var U = pc ? piecePos(pc, 0) : (user ? tilePos(user, 0) : V(0, BASE_TOP, 0));
    var ut = pc ? { x: pc.tx, y: pc.ty } : (user ? { x: user.x, y: user.y } : { x: 0, y: 0 });
    var picks = d.picks || [], tiles = d.tiles || [];
    var p0 = picks[0], dir = { dx: 0, dy: 1 };
    if (p0) { var ddx = p0.x - ut.x, ddy = p0.y - ut.y; if (Math.abs(ddx) >= Math.abs(ddy) && ddx) dir = { dx: Math.sign(ddx), dy: 0 }; else if (ddy) dir = { dx: 0, dy: Math.sign(ddy) }; }
    var key = gbKey(d.gb);
    var hidden = pc && pc.hidden;
    if (pc) faceDir(pc, dir.dx, dir.dy);
    dimScene(0.45, 250);
    var fn = GBFX[key] || GBFX.generic, p;
    try { p = fn({ U: U, ut: ut, pc: pc, picks: picks, tiles: tiles, dir: dir, user: user, hidden: hidden, color: classGlow(user) }); } catch (e) { console.error('gb fx', key, e); p = delay(600); }
    return Promise.resolve(p).then(function () { undim(450); if (pc) pc.faceGoal = null; });
  }
  function areaCenter(ts, fallback) {
    if (!ts || !ts.length) return fallback;
    var x = 0, y = 0; ts.forEach(function (t) { x += t.x; y += t.y; }); return { x: Math.round(x / ts.length), y: Math.round(y / ts.length) };
  }
  function ringTiles(c, r) { var out = []; for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) { if (!dx && !dy) continue; var x = c.x + dx, y = c.y + dy; if (x >= 0 && y >= 0 && x < N && y < N) out.push({ x: x, y: y }); } return out; }
  function lift(pc, h, ms) { if (!pc) return resolved(); pc.busy++; return tween(ms, function (k) { pc.lift.position.y = Math.sin(k * Math.PI) * h; }).then(function () { pc.busy = Math.max(0, pc.busy - 1); pc.lift.position.y = 0; }); }

  var GBFX = {
    irontide: function (c) {
      var col1 = 0x7cc8ff, start = c.U.clone().add(V(0, 0.05, 0)), dv = V(c.dir.dx, 0, c.dir.dy);
      columnFx(c.U, col1, 1.8, 0.5, 500); shockwave(c.U, col1, 1.6, 500);
      var wall = new THREE.Group(), m = new THREE.Mesh(gPlane(1), own(addMat(col1, 'aura', 1)));
      m.rotation.x = Math.PI / 2; m.scale.set(1.6, 1, 1.4); m.position.y = 0.7; wall.add(m); var wg = glowSprite(col1, 2.2, 0.8, 'glow', false); own(wg.material); wg.position.y = 0.5; wall.add(wg);
      var m2 = new THREE.Mesh(gPlane(1), own(addMat(0xffffff, 'aura', 0.7))); m2.rotation.x = Math.PI / 2; m2.scale.set(0.8, 1, 0.8); m2.position.y = 0.4; wall.add(m2);
      wall.rotation.y = Math.atan2(c.dir.dx, c.dir.dy);
      return delay(320).then(function () {
        shake(0.2, 900);
        addTransient(wall, 900, function (k) {
          var p = start.clone().addScaledVector(dv, easeIn(k) * 6.2); wall.position.copy(p);
          m.material.opacity = k < 0.8 ? 1 : (1 - k) * 5; m2.material.opacity = m.material.opacity * 0.7;
          dust(p.x, p.y + 0.05, p.z, 2, { speed: 0.9, size: 0.2, size1: 0.55, alpha: 0.6 });
          burst(p.x, p.y + 0.4, p.z, col1, 2, { speed: 1.2, life: 0.4, size: 0.1, gravity: 0, spread: 0.35 });
        });
        for (var i = 1; i <= 6; i++) { var tx = c.ut.x + c.dir.dx * i, ty = c.ut.y + c.dir.dy * i; if (tx >= 0 && ty >= 0 && tx < N && ty < N) tileFlash(tx, ty, col1, 120 + i * 120, 450); }
        return delay(950);
      }).then(function () { var E = start.clone().addScaledVector(dv, 6); shockwave(E, col1, 2.2, 500); flashAt(E.add(V(0, 0.5, 0)), 0xffffff, 2, 300); });
    },
    lastbastion: function (c) {
      var gold = 0xffd060, dome = new THREE.Mesh(gIco(1, 2), shieldMaterial()); own(dome.material);
      dome.material.uniforms.uColor.value = new THREE.Color(0xffd27a); dome.position.copy(c.U).add(V(0, 0.3, 0));
      addTransient(dome, 1500, function (k) { var s = k < 0.3 ? lerp(3, 0.75, easeIn(k / 0.3)) : 0.75 + Math.sin((k - 0.3) * 20) * 0.04 * (1 - k); dome.scale.setScalar(s); dome.material.uniforms.uOpacity.value = k < 0.8 ? 1.4 : (1 - k) * 7; dome.material.uniforms.uTime.value += 0.03; });
      var rune = new THREE.Mesh(gPlane(2.6), own(addMat(gold, 'rune', 1))); rune.position.copy(c.U).add(V(0, 0.04, 0)); rune.renderOrder = 9;
      addTransient(rune, 1500, function (k) { rune.rotation.y = k * 2; rune.material.opacity = k < 0.2 ? k * 5 : 1 - Math.max(0, (k - 0.7) / 0.3); var s = 0.6 + easeOutBack(Math.min(1, k * 3)) * 0.4; rune.scale.set(s, 1, s); });
      return delay(430).then(function () {
        shake(0.25, 400); shockwave(c.U, gold, 2.6, 600); flashAt(c.U.clone().add(V(0, 0.5, 0)), 0xffffff, 2.6, 300);
        for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; columnFx(c.U.clone().add(V(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9)), gold, 1.4, 0.12, 800); }
        return delay(900);
      });
    },
    earthshatter: function (c) {
      var brown = 0xffa860;
      return lift(c.pc, 0.7, 380).then(function () {
        shake(0.45, 700); shockwave(c.U, brown, 3.2, 700); shockwave(c.U, 0xffffff, 2.0, 400);
        dustRing(c.U.x, c.U.y, c.U.z, 0xa89070, 24);
        ringTiles(c.ut, 1).forEach(function (t, i) {
          var P0 = tilePos(t, 0); tileFlash(t.x, t.y, brown, i * 25, 500);
          var sp = new THREE.Mesh(rockGeoCached(i), mStd(0x8a7462, 0.9, 0, { flatShading: true })); sp.position.copy(P0); sp.castShadow = true;
          addTransient(sp, 1100, function (k) { var s = k < 0.2 ? easeOutBack(k / 0.2) : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1; sp.scale.set(0.8, Math.max(0.01, s) * 1.3, 0.8); sp.position.y = P0.y + 0.15 * s; });
          dust(P0.x, P0.y + 0.1, P0.z, 4, { speed: 1.2, size: 0.2, size1: 0.5 });
        });
        return delay(1000);
      });
    },
    thousandcuts: function (c) {
      var col2 = 0xff9a3c, P0 = c.U.clone().add(V(0, 0.5, 0));
      columnFx(c.U, col2, 1.5, 0.5, 1200);
      for (var i = 0; i < 16; i++) (function (i) { setTimeout(function () { var o = V(rnd(-0.6, 0.6), rnd(-0.2, 0.5), rnd(-0.6, 0.6)); slashFx(P0.clone().add(o), i % 3 ? col2 : 0xffffff, rnd(1.3, 2.0), rnd(0, 6.28), 300); burst(P0.x + o.x, P0.y + o.y, P0.z + o.z, 0xffd080, 4, { speed: 2, life: 0.3, size: 0.06 }); if (i % 4 === 0) shake(0.06, 120); }, i * 60 / speed); })(i);
      return delay(1050).then(function () { slashFx(P0, 0xffffff, 2.4, 0.8, 380); slashFx(P0, col2, 2.4, -0.8 + Math.PI, 380); shockwave(c.U, col2, 2, 500); shake(0.2, 300); return delay(300); });
    },
    blitzchain: function (c) {
      var y = 0xffe060, P0 = c.U.clone().add(V(0, 0.5, 0));
      flashAt(P0, y, 2, 1200, 'glow', 0.7);
      for (var i = 0; i < 10; i++) (function (i) { setTimeout(function () { var a = rnd(0, 6.28), r = rnd(1.2, 2.6); var E = c.U.clone().add(V(Math.cos(a) * r, 0.1, Math.sin(a) * r)); boltFx(P0, E, y, 240, 0.22); burst(E.x, E.y, E.z, y, 8, { speed: 2, life: 0.35, size: 0.07 }); flashAt(E, y, 0.9, 200); }, i * 100 / speed); })(i);
      var ring = shockwave(c.U, y, 2.4, 1200, { tex: 'activeRing', from: 2.2, spin: 8 });
      return delay(1150).then(function () { shake(0.15, 250); });
    },
    finalform: function (c) {
      var o = 0xff7a2c;
      columnFx(c.U, o, 4.5, 0.55, 1500); columnFx(c.U, 0xffd060, 3, 0.3, 1300);
      shockwave(c.U, o, 2.6, 700);
      var t0 = setInterval(function () { burst(c.U.x, c.U.y + 0.1, c.U.z, Math.random() > 0.5 ? 0xffa040 : 0xff5020, 6, { speed: 1.4, dir: { x: 0, y: 1, z: 0 }, jitter: 0.5, spread: 0.4, gravity: 1.5, life: 1.0, size: 0.12, size1: 0.02 }); }, 50);
      setTimeout(function () { clearInterval(t0); }, 1300 / speed);
      shake(0.2, 600);
      if (c.pc) { c.pc.busy++; tween(1300, function (k) { var s = 1 + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.3; c.pc.lift.scale.setScalar(s); }).then(function () { c.pc.busy--; c.pc.lift.scale.setScalar(1); }); }
      return delay(1400);
    },
    railpiercer: function (c) {
      var g = 0xb6ff7a, P0 = c.U.clone().add(V(0, 0.55, 0));
      var ch = flashAt(P0, g, 1.6, 700, 'glow', 1);
      var t0 = setInterval(function () { var a = rnd(0, 6.28), r = 1.2; PFX.emit({ x: P0.x + Math.cos(a) * r, y: P0.y + rnd(-0.4, 0.4), z: P0.z + Math.sin(a) * r, dir: { x: -Math.cos(a), y: 0, z: -Math.sin(a) }, speed: 2.2, jitter: 0, color: g, count: 1, life: 0.5, size: 0.08, gravity: 0, drag: 0 }); }, 25);
      return delay(600).then(function () {
        clearInterval(t0);
        var E = P0.clone().add(V(c.dir.dx * 14, 0, c.dir.dy * 14));
        beamFx(P0, E, g, 0.9, 800, { grow: true }); beamFx(P0, E, 0xffffff, 0.35, 650, { grow: true });
        shake(0.35, 600); flashAt(P0, 0xffffff, 2.6, 300);
        for (var i = 1; i < N; i++) { var tx = c.ut.x + c.dir.dx * i, ty = c.ut.y + c.dir.dy * i; if (tx < 0 || ty < 0 || tx >= N || ty >= N) break; tileFlash(tx, ty, g, i * 25, 500); var Q = tilePos({ x: tx, y: ty }, 0.5); (function (Q, i) { setTimeout(function () { burst(Q.x, Q.y, Q.z, g, 6, { speed: 1.8, life: 0.4, size: 0.08 }); }, i * 25 / speed); })(Q, i); }
        return delay(800);
      });
    },
    skyfallvolley: function (c) {
      var r = 0xff6a2a, P0 = c.U.clone().add(V(0, 0.7, 0));
      var area = c.tiles.length ? c.tiles : (c.picks[0] ? ringTiles(c.picks[0], 1).concat([c.picks[0]]) : []);
      var ctr = areaCenter(area, c.picks[0] || c.ut), C = tilePos(ctr, 0.05);
      return projectileFx(P0, P0.clone().add(V(0, 7, 0)), 0xffc060, 450, 0).then(function () {
        flashAt(P0.clone().add(V(0, 7, 0)), 0xffffff, 2, 300);
        for (var i = 0; i < 9; i++) (function (i) { setTimeout(function () { var o = V(rnd(-1.3, 1.3), 0, rnd(-1.3, 1.3)); var top = C.clone().add(o).add(V(rnd(-1, 1), 6, rnd(-1, 1))); beamFx(top, top.clone().lerp(C.clone().add(o), 0.6), r, 0.1, 260); }, i * 55 / speed); })(i);
        shockwave(C, r, 1.7, 700, { tex: 'mark', from: 3.5, opacity: 0.8 });
        area.forEach(function (t, i) { tileFlash(t.x, t.y, r, 200 + i * 30, 500); });
        return delay(700);
      }).then(function () { shake(0.15, 300); shockwave(C, r, 2.0, 500); return delay(250); });
    },
    eaglesperch: function (c) {
      var g = 0xb6ff7a;
      columnFx(c.U, g, 3.5, 0.5, 1300); shockwave(c.U, 0xffffff, 1.8, 600);
      var t0 = 0, iv = setInterval(function () { t0 += 0.35; for (var k = 0; k < 2; k++) { var a = t0 + k * Math.PI; PFX.emit({ x: c.U.x + Math.cos(a) * 0.55, y: c.U.y + 0.05 + (t0 % 3) * 0.3, z: c.U.z + Math.sin(a) * 0.55, dir: { x: -Math.sin(a), y: 1.4, z: Math.cos(a) }, speed: 1, jitter: 0.05, color: k ? 0xeaffd0 : g, count: 1, life: 0.9, size: 0.1, size1: 0.03, gravity: 0, drag: 0.4 }); } }, 30);
      setTimeout(function () { clearInterval(iv); }, 1100 / speed);
      return lift(c.pc, 0.35, 900).then(function () { shockwave(c.U, g, 2.2, 500); return delay(300); });
    },
    grandswap: function (c) {
      var v = 0xc49cff, a = c.picks[0] || c.ut, b = c.picks[1] || c.ut, A = tilePos(a, 0.05), B = tilePos(b, 0.05);
      [A, B].forEach(function (P0) {
        var portal = new THREE.Mesh(gPlane(1.6), own(addMat(v, 'activeRing', 1))); portal.position.copy(P0); portal.renderOrder = 9;
        addTransient(portal, 1400, function (k) { portal.rotation.y += 0.12; var s = k < 0.2 ? easeOutBack(k / 0.2) : k > 0.8 ? (1 - k) * 5 : 1; portal.scale.set(s, 1, s); });
        columnFx(P0, v, 2, 0.45, 1200);
      });
      return delay(300).then(function () {
        var A2 = A.clone().add(V(0, 0.5, 0)), B2 = B.clone().add(V(0, 0.5, 0)), h = 1 + A.distanceTo(B) * 0.2;
        return Promise.all([projectileFx(A2, B2, v, 600, h), projectileFx(B2, A2, 0xffffff, 600, h, { trail: v })]);
      }).then(function () { flashAt(A.clone().add(V(0, 0.5, 0)), v, 2, 350); flashAt(B.clone().add(V(0, 0.5, 0)), v, 2, 350); shake(0.15, 300); return delay(450); });
    },
    mirrorlegion: function (c) {
      var v = 0xc49cff, P0 = c.U.clone().add(V(0, 0.5, 0)), shards = [];
      for (var i = 0; i < 8; i++) {
        var s = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: tex('shard'), color: col(i % 2 ? 0xffffff : v), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })));
        s.userData.a = i / 8 * Math.PI * 2; shards.push(s);
        (function (s) { addTransient(s, 1200, function (k) { var a = s.userData.a + k * 5, r = 0.3 + easeOut(k) * 1.4; s.position.set(P0.x + Math.cos(a) * r, P0.y + Math.sin(k * 8 + a) * 0.1, P0.z + Math.sin(a) * r); s.scale.set(0.25, 0.5, 1); s.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3; }); })(s);
      }
      flashAt(P0, v, 2.4, 500); shockwave(c.U, v, 2.2, 700);
      return delay(800).then(function () { flashAt(P0, 0xffffff, 1.6, 250); return delay(350); });
    },
    vanish: function (c) {
      var v = 0x8a5cc8, P0 = c.U.clone().add(V(0, 0.4, 0));
      dust(P0.x, P0.y - 0.3, P0.z, 30, { color: 0x7a5aa8, speed: 1.6, size: 0.3, size1: 0.9, alpha: 0.85, life: 1.3, gravity: 0.2 });
      burst(P0.x, P0.y, P0.z, 0xc49cff, 30, { speed: 2.2, life: 0.7, size: 0.1 });
      flashAt(P0, 0xc49cff, 2.6, 500); shockwave(c.U, v, 2.0, 700);
      if (c.pc) { c.pc.busy++; tween(700, function (k) { c.pc.lift.scale.set(1 - k * 0.5, 1 + k * 0.3, 1 - k * 0.5); }).then(function () { c.pc.busy--; c.pc.lift.scale.setScalar(1); }); }
      return delay(1100);
    },
    undyingpulse: function (c) {
      var g = 0xffe080, t = 0x6dffd0, P0 = c.U.clone().add(V(0, 0.5, 0));
      columnFx(c.U, g, 2.6, 0.45, 1400);
      var beat = function (cc) { shockwave(c.U, cc, 2.4, 600); flashAt(P0, cc, 2.2, 300); if (c.pc) { c.pc.busy++; tween(250, function (k) { c.pc.lift.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.18); }).then(function () { c.pc.busy--; c.pc.lift.scale.setScalar(1); }); } };
      beat(g);
      setTimeout(function () { beat(t); }, 380 / speed);
      var ank = glowSprite(g, 1, 1, 'spark', false); own(ank.material); ank.position.copy(P0);
      addTransient(ank, 1400, function (k) { ank.position.y = P0.y + 0.4 + k * 1.2; ank.scale.setScalar(0.6 + k * 0.8); ank.material.opacity = 1 - k; ank.material.rotation = k * 2; });
      burst(P0.x, P0.y, P0.z, t, 24, { speed: 0.8, dir: { x: 0, y: 1, z: 0 }, jitter: 0.6, spread: 0.4, gravity: 0.5, life: 1.2, size: 0.09 });
      return delay(1300);
    },
    siphonfield: function (c) {
      var g = 0x7affb0, red = 0xff4060;
      var disc = new THREE.Mesh(gPlane(5.2), own(addMat(g, 'rune', 0.9))); disc.position.copy(c.U).add(V(0, 0.05, 0)); disc.renderOrder = 9;
      addTransient(disc, 1500, function (k) { disc.rotation.y = -k * 2; disc.material.opacity = 0.9 * (k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1); });
      ringTiles(c.ut, 2).forEach(function (t, i) { tileFlash(t.x, t.y, g, i * 10, 500, 'hl'); });
      var targets = [];
      for (var k in pieces) { var p = pieces[k]; if (p === c.pc || !p.alive || p.hidden) continue; if (Math.max(Math.abs(p.tx - c.ut.x), Math.abs(p.ty - c.ut.y)) <= 2) targets.push(p); }
      return delay(350).then(function () {
        var U2 = c.U.clone().add(V(0, 0.55, 0));
        targets.forEach(function (p) { var S = piecePos(p, 0.5); flashAt(S, red, 1.2, 300); for (var i = 0; i < 4; i++) (function (i) { setTimeout(function () { projectileFx(S, U2, i % 2 ? red : g, 500, 0.6); }, i * 90 / speed); })(i); });
        if (!targets.length) for (var i = 0; i < 6; i++) { var a = i / 6 * 6.28, S2 = c.U.clone().add(V(Math.cos(a) * 2, 0.4, Math.sin(a) * 2)); projectileFx(S2, U2, g, 500, 0.5); }
        return delay(750);
      }).then(function () { flashAt(c.U.clone().add(V(0, 0.5, 0)), g, 2.2, 400); columnFx(c.U, g, 1.6, 0.45, 600); return delay(300); });
    },
    bloodtether: function (c) {
      var red = 0xff2a4a, tg = c.picks[0] || c.ut, A = c.U.clone().add(V(0, 0.55, 0)), B = tilePos(tg, 0.55);
      flashAt(A, red, 1.6, 400);
      return projectileFx(A, B, red, 380, 0.4).then(function () {
        flashAt(B, red, 2, 400); shockwave(tilePos(tg, 0.03), red, 1.3, 500);
        beamFx(A, B, red, 0.18, 1000); beamFx(A, B, 0xffffff, 0.06, 900);
        var beads = setInterval(function () { projectileFx(B, A, 0xff6070, 380, 0.05, { size: 0.08 }); }, 110);
        setTimeout(function () { clearInterval(beads); }, 800 / speed);
        return delay(1000);
      }).then(function () { flashAt(A, red, 1.4, 300); });
    },
    collapse: function (c) {
      var m = 0xff3ae0;
      dimScene(0.65, 300); shake(0.4, 1600);
      var ring = new THREE.Mesh(gPlane(2), own(addMat(m, 'ring', 1))); ring.position.set(0, BASE_TOP + 0.1, 0); ring.renderOrder = 9;
      addTransient(ring, 1500, function (k) { var r = lerp(9.5, 0.5, easeIn(k)); ring.scale.set(r, 1, r); ring.material.opacity = k < 0.85 ? 1 : (1 - k) / 0.15; });
      var ring2 = new THREE.Mesh(gPlane(2), own(addMat(0xffffff, 'ring', 0.6))); ring2.position.set(0, BASE_TOP + 0.12, 0); ring2.renderOrder = 9;
      addTransient(ring2, 1500, function (k) { var r = lerp(9, 0.4, easeIn(k)); ring2.scale.set(r, 1, r); ring2.material.opacity = 0.6 * (1 - k); });
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) { var ri = Math.min(x, y, N - 1 - x, N - 1 - y); tileFlash(x, y, m, ri * 220, 400, 'warn'); }
      columnFx(c.U, m, 3, 0.5, 1400);
      var iv = setInterval(function () { var a = rnd(0, 6.28), r = rnd(5, 7.5); burst(Math.cos(a) * r, BASE_TOP + 0.2, Math.sin(a) * r, m, 4, { speed: 1.6, up: true, gravity: 0.5, life: 1, size: 0.14 }); }, 40);
      return delay(1600).then(function () { clearInterval(iv); });
    },
    blightbloom: function (c) {
      var m = 0xff40e0, area = c.tiles.length ? c.tiles : (c.picks[0] ? ringTiles(c.picks[0], 1).concat([c.picks[0]]) : []);
      var ctr = areaCenter(area, c.picks[0] || c.ut), C = tilePos(ctr, 0.05);
      projectileFx(c.U.clone().add(V(0, 0.6, 0)), C.clone().add(V(0, 0.3, 0)), m, 450, 1.6).then(function () {
        shockwave(C, m, 2.6, 700); flashAt(C.clone().add(V(0, 0.4, 0)), m, 3, 500); shake(0.25, 400);
        var petals = new THREE.Group(); petals.position.copy(C);
        for (var i = 0; i < 8; i++) { var p = new THREE.Mesh(gCone(0.22, 1.0, 6), mEmi(0x601060, m, 1.6)); var a = i / 8 * Math.PI * 2; p.position.set(Math.cos(a) * 0.4, 0.4, Math.sin(a) * 0.4); p.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); petals.add(p); }
        addTransient(petals, 1000, function (k) { var s = k < 0.3 ? easeOutBack(k / 0.3) : 1 - (k - 0.3) / 0.7; petals.scale.setScalar(Math.max(0.01, s)); petals.rotation.y += 0.04; });
        area.forEach(function (t, i) { tileFlash(t.x, t.y, m, i * 40, 500); var Q = tilePos(t, 0.1); burst(Q.x, Q.y, Q.z, m, 8, { speed: 1.5, up: true, gravity: 0.6, life: 1.1, size: 0.12, sway: 1 }); });
      });
      return delay(1450);
    },
    rotembrace: function (c) {
      var m = 0xff40e0;
      columnFx(c.U, 0x8a20a0, 2.2, 0.55, 1300);
      var t0 = 0, iv = setInterval(function () { t0 += 0.4; for (var k = 0; k < 3; k++) { var a = t0 + k * 2.09, h = (t0 * 0.12) % 1.2; PFX.emit({ x: c.U.x + Math.cos(a) * 0.45, y: c.U.y + 0.05 + h, z: c.U.z + Math.sin(a) * 0.45, count: 1, spread: 0, color: k ? m : 0x8aff40, dir: { x: 0, y: 0.6, z: 0 }, speed: 1, jitter: 0.05, gravity: 0, drag: 1, life: 0.8, size: 0.11, size1: 0.03 }); } }, 30);
      setTimeout(function () { clearInterval(iv); }, 1100 / speed);
      ringTiles(c.ut, 1).forEach(function (t, i) { tileFlash(t.x, t.y, m, 300 + i * 40, 500); });
      shockwave(c.U, m, 1.8, 800);
      return delay(1300);
    },
    generic: function (c) {
      columnFx(c.U, c.color, 3, 0.5, 1100); shockwave(c.U, c.color, 2.4, 700); flashAt(c.U.clone().add(V(0, 0.5, 0)), 0xffffff, 2.2, 350);
      burst(c.U.x, c.U.y + 0.4, c.U.z, c.color, 30, { speed: 2, life: 0.8, size: 0.1 }); shake(0.2, 400);
      return delay(1100);
    }
  };
  var rockCache = [];
  function rockGeoCached(i) { var k = i % 3; return rockCache[k] || (rockCache[k] = (function () { var g = new THREE.ConeGeometry(0.22, 0.7, 5, 1); g.translate(0, 0.35, 0); return g; })()); }

  /* ======================================================================
   * 16. Pedestal (loadout preview) and portraits, both on the shared renderer
   * ==================================================================== */
  var PEDS = {}, pedSeq = 0;
  function buildPedScene() {
    var s = new THREE.Scene(); if (envTex) s.environment = envTex;
    var key = new THREE.DirectionalLight(0xffd8b0, 2.4); key.position.set(-2, 4, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    var k2 = key.shadow.camera; k2.left = -1.5; k2.right = 1.5; k2.top = 1.5; k2.bottom = -1.5; k2.near = 0.5; k2.far = 12; key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
    s.add(key); s.add(new THREE.HemisphereLight(0x9aa8ff, 0x402a50, 0.85));
    var rim = new THREE.DirectionalLight(0xa8c4ff, 1.8); rim.position.set(2, 3, -4); s.add(rim);
    var rim2 = new THREE.DirectionalLight(0xff9ad0, 0.7); rim2.position.set(-3, 1, -3); s.add(rim2);
    var ped = Grp(s, 0, 0, 0);
    var stone = mStd(0x4a4256, 0.6, 0.2, { map: tex('rock') }), gold = mStd(0xe0b050, 0.28, 0.9);
    P(ped, gCyl(0.72, 0.82, 0.22, 48), stone, 0, -0.11, 0).receiveShadow = true;
    P(ped, gCyl(0.62, 0.7, 0.1, 48), mStd(0x5a5268, 0.5, 0.25), 0, 0.03, 0).receiveShadow = true;
    P(ped, gTor(0.72, 0.022, null, 8, 64), gold, 0, 0.0, 0, Math.PI / 2);
    P(ped, gTor(0.62, 0.016, null, 8, 64), gold, 0, 0.08, 0, Math.PI / 2);
    P(ped, gCyl(0.95, 1.05, 0.3, 48), mStd(0x2a2434, 0.8, 0.1), 0, -0.36, 0).receiveShadow = true;
    var rune = new THREE.Mesh(gPlane(1.3), addMat(0x9ad0ff, 'rune', 0.85)); rune.position.y = 0.084; rune.renderOrder = 3; ped.add(rune);
    var glow = new THREE.Mesh(gPlane(3.2), addMat(0x7a9cff, 'glow', 0.45)); glow.position.y = -0.2; glow.renderOrder = 2; ped.add(glow);
    var beam = new THREE.Mesh(gCyl(0.6, 0.62, 2.0, 32, true), addMat(0x8ab0ff, 'aura', 0.25)); beam.position.y = 1.0; beam.renderOrder = 4; ped.add(beam);
    var motes = new ParticlePool(80, true, 'spark'); s.add(motes.points);
    var cam2 = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    return { scene: s, camera: cam2, ped: ped, rune: rune, glow: glow, beam: beam, motes: motes, holder: Grp(s, 0, 0.084, 0) };
  }
  function pedestalsActive() {
    for (var k in PEDS) { var p = PEDS[k]; if (p.canvas && p.canvas.isConnected && p.canvas.clientWidth > 0 && !(typeof document !== 'undefined' && document.hidden)) return true; }
    return false;
  }
  function renderPedestals(dt) {
    for (var k in PEDS) {
      var p = PEDS[k], cv = p.canvas;
      if (!cv || !cv.isConnected || cv.clientWidth === 0) continue;
      var r = Math.min(2, window.devicePixelRatio || 1), w = Math.round(cv.clientWidth * r), h = Math.round(cv.clientHeight * r);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      var S = p.S; p.t += dt;
      // spin, with a quick spin-in when the piece changes
      p.spin += dt * (0.45 + p.boost * 6); p.boost *= Math.pow(0.02, dt);
      S.holder.rotation.y = p.spin;
      if (p.piece) { var ud = p.piece.userData; if (ud.idle) try { ud.idle(p.t); } catch (e) { } ud.inner.scale.y = 1 + Math.sin(p.t * 2.3) * 0.012; var ps = Math.min(1, p.pop); p.pop += dt * 3; p.piece.scale.setScalar(PIECE_SCALE * 1.0 * easeOutBack(Math.min(1, ps))); }
      S.rune.rotation.y = -p.t * 0.25; S.beam.material.opacity = 0.18 + Math.sin(p.t * 2) * 0.05;
      if (Math.random() < dt * 14) S.motes.emit({ x: rnd(-0.5, 0.5), y: 0.1, z: rnd(-0.5, 0.5), count: 1, spread: 0, color: p.glow, dir: { x: 0, y: 1, z: 0 }, speed: rnd(0.2, 0.45), jitter: 0.03, gravity: 0.05, drag: 0.1, life: 2.4, size: rnd(0.03, 0.06), size1: 0.0, sway: 0.2 });
      S.motes.update(dt);
      var aspect = w / h; S.camera.aspect = aspect;
      var fitH = 3.1, dist = (fitH / 2) / Math.tan(S.camera.fov * Math.PI / 360) / Math.min(1, aspect / 0.95);
      S.camera.position.set(0, 0.9 + dist * 0.24, dist); S.camera.lookAt(0, 0.9, 0); S.camera.updateProjectionMatrix();
      S.motes.mat.uniforms.uScale.value = h * S.camera.projectionMatrix.elements[5] * 0.5;
      setSize(w, h);
      renderer.setViewport(0, 0, w, h); renderer.setScissorTest(false);
      renderer.setClearColor(0x000000, 0); renderer.render(S.scene, S.camera);
      var ctx = p.ctx || (p.ctx = cv.getContext('2d'));
      if (ctx) { ctx.clearRect(0, 0, w, h); ctx.drawImage(renderer.domElement, 0, 0, w, h, 0, 0, w, h); }
    }
  }
  function pedestal(canvasEl) {
    if (typeof THREE === 'undefined' || !canvasEl) return { set: function () { }, resize: function () { }, dispose: function () { } };
    ensureRenderer();
    var id = ++pedSeq;
    var p = { canvas: canvasEl, S: buildPedScene(), piece: null, t: 0, spin: 0.4, boost: 0, pop: 1, glow: 0x9ad0ff, ctx: null };
    PEDS[id] = p; kick();
    return {
      set: function (clsId, variantId, colorIndex) {
        var c = normClass(clsId), tc = teamColors(), color = typeof colorIndex === 'string' && colorIndex.charAt(0) === '#' ? colorIndex : tc[((colorIndex || 0) % 8 + 8) % 8];
        if (p.piece) p.S.holder.remove(p.piece);
        p.piece = buildPiece(c, variantId, toHex(color));
        p.piece.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
        p.S.holder.add(p.piece); p.pop = 0.35; p.boost = 1;
        var pal = CLASS_PAL[c]; p.glow = pal.glow;
        p.S.rune.material.color.copy(col(pal.glow)); p.S.glow.material.color.copy(col(pal.main)); p.S.beam.material.color.copy(col(pal.glow));
        kick();
      },
      resize: function () { kick(); },
      dispose: function () { if (p.piece) p.S.holder.remove(p.piece); delete PEDS[id]; }
    };
  }
  var portraitCache = {}, portraitRig = null;
  function portrait(clsId, variantId, colorIndex) {
    if (typeof THREE === 'undefined') return '';
    var c = normClass(clsId), v = normVariant(c, variantId), tc = teamColors();
    var color = typeof colorIndex === 'string' && colorIndex.charAt(0) === '#' ? colorIndex : tc[((colorIndex || 0) % 8 + 8) % 8];
    var key = c + '|' + v + '|' + color;
    if (portraitCache[key]) return portraitCache[key];
    try {
      ensureRenderer();
      if (!portraitRig) {
        var s = new THREE.Scene(); if (envTex) s.environment = envTex;
        var kl = new THREE.DirectionalLight(0xffe0c0, 2.6); kl.position.set(-1.5, 2, 3); s.add(kl);
        s.add(new THREE.HemisphereLight(0xa0b0ff, 0x503060, 1.0));
        var rl = new THREE.DirectionalLight(0xa8c4ff, 2.0); rl.position.set(2, 2, -3); s.add(rl);
        portraitRig = { scene: s, camera: new THREE.PerspectiveCamera(24, 1, 0.05, 20), holder: Grp(s) };
      }
      var R = portraitRig;
      while (R.holder.children.length) R.holder.remove(R.holder.children[0]);
      var pc = buildPiece(c, v, toHex(color)); pc.userData.base.visible = false; pc.scale.setScalar(1);
      if (pc.userData.idle) try { pc.userData.idle(0.6); } catch (e) { }
      pc.rotation.y = 0.35; R.holder.add(pc);
      var hy = pc.userData.headY;
      R.camera.position.set(0.12, hy + 0.06, 1.55); R.camera.lookAt(0, hy - 0.06, 0); R.camera.updateProjectionMatrix();
      var S = 128; setSize(S, S);
      renderer.setViewport(0, 0, S, S); renderer.setScissorTest(false);
      renderer.setClearColor(0x000000, 0); renderer.render(R.scene, R.camera);
      var cv = mkCanvas(S); cv.getContext('2d').drawImage(renderer.domElement, 0, 0, S, S, 0, 0, S, S);
      var url = cv.toDataURL('image/png');
      portraitCache[key] = url;
      R.holder.remove(pc);
      return url;
    } catch (e) { console.error('portrait failed', e); return ''; }
  }

  /* ======================================================================
   * 17. Public API
   * ==================================================================== */
  function mount(stage, overlay) {
    if (typeof THREE === 'undefined') { console.error('VIEW: THREE missing'); return; }
    stageEl = stage; overlayEl = overlay || null;
    ensureRenderer(); buildWorld();
    if (canvas.parentNode !== stageEl) stageEl.appendChild(canvas);
    if (layer && layer.parentNode && layer.parentNode !== (overlayEl || stageEl)) { layer.parentNode.removeChild(layer); layer = null; }
    ensureLayer();
    // re-home bars into the (new) layer
    for (var k in pieces) if (pieces[k].bar) layer.appendChild(pieces[k].bar.el);
    bindInput();
    mounted = true; stopped = false;
    fitCamera();
    if (!API._resizeBound) { API._resizeBound = true; window.addEventListener('resize', function () { fitCamera(); kick(); }); document.addEventListener('visibilitychange', function () { lastT = 0; kick(); }); }
    kick();
  }
  function setInsets(o) { o = o || {}; insets = { top: o.top || 0, bottom: o.bottom || 0 }; fitCamera(); kick(); }
  function setSpeed(m) { speed = Math.max(0.25, +m || 1); }
  function setReducedMotion(b) { reduced = !!b; }
  function setHumanId(id) {
    humanId = id;
    if (tv) for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) syncTile(x, y, false);
    for (var k in pieces) if (pieces[k].bar) pieces[k].bar.el.classList.toggle('me', isHumanId(ownerOf(pieces[k].ent).id));
    refresh();
  }
  function stop() { stopped = true; }
  function start() { stopped = false; kick(); }
  function noop() { return resolved(); }

  var API = {
    // CORE -> view
    init: init, refresh: refresh, wait: wait, roundStart: roundStart, turnStart: turnStart, tilesChanged: tilesChanged,
    move: move, collide: collide, attack: attack, hit: hit, heal: heal, shield: shield, status: status, death: death,
    spawn: spawn, remove: removeEnt, ringWarning: ringWarning, ringClose: ringClose, fx: fx,
    banner: noop, log: noop, gameOver: function () { if (activeRing) activeRing.visible = false; return resolved(); },
    // UI sync API
    mount: mount, setInsets: setInsets, setSpeed: setSpeed, setReducedMotion: setReducedMotion, onTap: null,
    highlight: highlight, clearHighlight: clearHighlight, setHumanId: setHumanId, pedestal: pedestal, portrait: portrait,
    buildPiece: function (c, v, colorHex) { return buildPiece(c, v, colorHex); }, stop: stop,
    // extras (optional)
    start: start, resetCamera: function () { cam.yaw = 0; cam.pitch = 0.84; cam.zoom = 1; fitCamera(); kick(); },
    pick: function (x, y) { return pickAt(x, y); }, shake: function (a, ms) { shake(a || 0.2, ms || 400); },
    _debug: { pieces: function () { return pieces; }, cam: cam, CLASS_IDS: CLASS_IDS, VARIANTS: VARIANTS, renderer: function () { return renderer; }, scene: function () { return scene; }, camera: function () { return camera; }, gbKey: gbKey }
  };
  return API;
})();
