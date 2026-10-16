/*
 * app.js — interface de Motif Atelier : contrôles, aperçu répété, exports,
 * mémorisation (localStorage) et lien de partage (#s=...).
 * MIT © 2026 Amirouche Amwanes.
 */
(function () {
  'use strict';

  var M = window.Motif;
  var STORE_KEY = 'motif-atelier:v1';
  var LANG_KEY = 'motif-atelier:lang';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Palettes intégrées (créations originales) ---------- */
  var PALETTES = [
    { id: 'kasbah', bg: '#f3e6d3', colors: ['#c4552d', '#2f4858', '#e2a33b', '#7a9e7e'] },
    { id: 'mediterranee', bg: '#0f3d5c', colors: ['#f6f1e7', '#3fa7c9', '#f2b134', '#e4572e'] },
    { id: 'djurdjura', bg: '#1f2b22', colors: ['#8fb573', '#d9e4c8', '#4e7d4a', '#e0b04f'] },
    { id: 'sahara', bg: '#e9c89b', colors: ['#a0522d', '#6b3e26', '#f5e6c8', '#d98c4a'] },
    { id: 'neon', bg: '#120c24', colors: ['#ff3d81', '#36e2d4', '#ffd23f', '#7b5cff'] },
    { id: 'pastel', bg: '#fdf6f0', colors: ['#f7b6c2', '#a8d8ea', '#c3e8bd', '#ffd8a8'] },
    { id: 'mono', bg: '#f4f4f4', colors: ['#111111', '#555555', '#9a9a9a'] },
    { id: 'indigo', bg: '#10162f', colors: ['#3d5afe', '#8c9eff', '#e8eaf6', '#ffb74d'] },
    { id: 'agrumes', bg: '#fff8e1', colors: ['#ff7043', '#ffca28', '#9ccc65', '#26a69a'] },
    { id: 'primaires', bg: '#f2efe6', colors: ['#d7263d', '#1b4e9b', '#f4c20d', '#111111'] },
    { id: 'henne', bg: '#3a1f14', colors: ['#d9894a', '#f1d3a5', '#8c3b20', '#b5651d'] },
    { id: 'ocean', bg: '#e6f2f5', colors: ['#0b4f6c', '#01baef', '#20bf55', '#f39237'] }
  ];

  var state = M.sanitize(M.DEFAULTS);
  var model = null;
  var view = { zoom: 1, bounds: false };

  /* ---------- Utilitaires ---------- */

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast(t('exported') + name);
  }

  function baseName() {
    return 'motif-' + state.mode + '-' + String(state.seed).replace(/[^a-z0-9_-]+/gi, '').slice(0, 24);
  }

  function hsl(h, s, l) {
    // HSL (0-360, 0-1, 0-1) -> #rrggbb
    var a = s * Math.min(l, 1 - l);
    function k(n) {
      var kk = (n + h / 30) % 12;
      var c = l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1));
      return ('0' + Math.round(c * 255).toString(16)).slice(-2);
    }
    return '#' + k(0) + k(8) + k(4);
  }

  function randomSeed() {
    var syll = ['ta', 'zu', 'ri', 'ma', 'ne', 'lo', 'ka', 'fi', 'su', 'de', 'ya', 'ou'];
    var s = '';
    for (var i = 0; i < 3; i++) s += syll[Math.floor(Math.random() * syll.length)];
    return s + '-' + Math.floor(Math.random() * 1000);
  }

  // Palette harmonieuse aléatoire (analogue, triadique ou complémentaire).
  function randomPalette() {
    var h = Math.random() * 360;
    var schemes = [[0, 25, 50, -25, 180], [0, 120, 240, 60, 180], [0, 180, 20, 200, 90]];
    var sc = schemes[Math.floor(Math.random() * schemes.length)];
    var dark = Math.random() < 0.5;
    var n = 3 + Math.floor(Math.random() * 3);
    var colors = [];
    for (var i = 0; i < n; i++) {
      colors.push(hsl((h + sc[i] + 360) % 360, 0.5 + Math.random() * 0.4, dark ? 0.5 + Math.random() * 0.25 : 0.35 + Math.random() * 0.25));
    }
    return { bg: hsl((h + 200) % 360, dark ? 0.35 : 0.3, dark ? 0.1 + Math.random() * 0.06 : 0.92 + Math.random() * 0.05), colors: colors };
  }

  /* ---------- Rendu ---------- */

  var rafPending = false;
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; render(); });
  }

  function render() {
    model = M.generate(state);
    var canvas = $('view');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 600, cssH = canvas.clientHeight || 400;
    var W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

    // Taille de tuile en pixels écran (entière => répétition parfaite).
    var tp = Math.max(8, Math.round(model.T * view.zoom * dpr));
    var tile = M.renderTile(document.createElement('canvas'), model, tp / model.T);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, W, H);

    if (view.bounds) {
      ctx.save();
      ctx.lineWidth = Math.max(1, dpr);
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (var x = 0; x <= W; x += tp) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
      for (var y = 0; y <= H; y += tp) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineDashOffset = 6 * dpr;
      ctx.stroke();
      // Tuile d'origine mise en évidence
      ctx.setLineDash([]);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = '#f2b134';
      ctx.strokeRect(1.5 * dpr, 1.5 * dpr, tp - 3 * dpr, tp - 3 * dpr);
      ctx.restore();
    }

    $('cssOut').value = M.toCSS(model);
    save();
  }

  /* ---------- Synchronisation interface <-> état ---------- */

  var RANGES = {
    tile: ['outTile', function (v) { return v + ' px'; }],
    count: ['outCount', String],
    sizeMin: ['outSizeMin', function (v) { return v + ' %'; }],
    sizeMax: ['outSizeMax', function (v) { return v + ' %'; }],
    rotBase: ['outRotBase', function (v) { return v + '°'; }],
    jitter: ['outJitter', function (v) { return '±' + v + '°'; }],
    stroke: ['outStroke', function (v) { return v + ' px'; }]
  };

  function buildShapes() {
    var box = $('shapes');
    box.innerHTML = '';
    M.SHAPE_KEYS.forEach(function (k) {
      var lab = document.createElement('label');
      lab.className = 'shape';
      var inp = document.createElement('input');
      inp.type = 'checkbox'; inp.value = k; inp.id = 'sh-' + k;
      inp.addEventListener('change', function () {
        var on = Array.prototype.filter.call(box.querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; });
        if (!on.length) { inp.checked = true; toast(t('shapesNeed')); return; }
        state.shapes = on;
        scheduleRender();
      });
      // Pictogramme dessiné avec le même chemin que le moteur.
      var svg = '<svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true"><path d="' + M.SHAPES[k].path(9) + '" fill-rule="evenodd" ' +
        (M.SHAPES[k].open ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' : 'fill="currentColor"') + '/></svg>';
      var span = document.createElement('span');
      span.setAttribute('data-i18n', 'sh_' + k);
      span.textContent = t('sh_' + k);
      lab.appendChild(inp);
      lab.insertAdjacentHTML('beforeend', svg);
      lab.appendChild(span);
      box.appendChild(lab);
    });
  }

  function buildColors() {
    var box = $('colors');
    box.innerHTML = '';
    function add(label, value, onInput, id) {
      var lab = document.createElement('label');
      lab.className = 'ctl ctl-color';
      var span = document.createElement('span');
      span.textContent = label;
      var inp = document.createElement('input');
      inp.type = 'color'; inp.value = value; inp.id = id;
      inp.setAttribute('aria-label', label);
      inp.addEventListener('input', function () { onInput(inp.value); scheduleRender(); });
      lab.appendChild(span); lab.appendChild(inp);
      box.appendChild(lab);
    }
    add(t('background'), state.bg, function (v) { state.bg = v; }, 'col-bg');
    state.colors.forEach(function (c, i) {
      add(t('color') + ' ' + (i + 1), c, function (v) { state.colors[i] = v; }, 'col-' + i);
    });
    $('btnAddColor').disabled = state.colors.length >= 5;
    $('btnRemoveColor').disabled = state.colors.length <= 3;
  }

  function buildPalettes() {
    var box = $('palettes');
    box.innerHTML = '';
    PALETTES.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pal';
      b.dataset.id = p.id;
      var sw = '<span class="pal-sw" style="background:' + p.bg + '">' +
        p.colors.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span>';
      b.innerHTML = sw + '<span data-i18n="p_' + p.id + '">' + t('p_' + p.id) + '</span>';
      b.addEventListener('click', function () {
        state.bg = p.bg; state.colors = p.colors.slice();
        buildColors(); scheduleRender();
      });
      box.appendChild(b);
    });
  }

  // Remplit les contrôles à partir de l'état.
  function syncUI() {
    $('mode').value = state.mode;
    Object.keys(RANGES).forEach(function (k) {
      $(k).value = state[k];
      $(RANGES[k][0]).textContent = RANGES[k][1](state[k]);
    });
    $('seed').value = state.seed;
    document.querySelectorAll('input[name=style]').forEach(function (r) { r.checked = r.value === state.style; });
    M.SHAPE_KEYS.forEach(function (k) { $('sh-' + k).checked = state.shapes.indexOf(k) >= 0; });
    $('zoom').value = view.zoom;
    $('outZoom').textContent = Math.round(view.zoom * 100) + ' %';
    $('bounds').checked = view.bounds;
    buildColors();
  }

  /* ---------- Persistance ---------- */

  function exportable() {
    return { app: 'motif-atelier', version: 1, settings: M.sanitize(state), view: { zoom: view.zoom, bounds: view.bounds } };
  }

  function applyImported(obj) {
    var s = obj && obj.settings ? obj.settings : obj;
    state = M.sanitize(s);
    if (obj && obj.view) {
      view.zoom = Math.min(2, Math.max(0.25, Number(obj.view.zoom) || 1));
      view.bounds = !!obj.view.bounds;
    }
    syncUI();
    scheduleRender();
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(exportable())); } catch (e) { /* stockage indisponible */ }
    }, 250);
  }

  // Encodage base64url UTF-8 pour le lien de partage.
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function load() {
    var m = /[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      try { applyImportedSilently(JSON.parse(b64decode(m[1]))); return; } catch (e) { /* lien invalide : on ignore */ }
    }
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) applyImportedSilently(JSON.parse(raw));
    } catch (e) { /* ignoré */ }
  }
  function applyImportedSilently(obj) {
    var s = obj && obj.settings ? obj.settings : obj;
    state = M.sanitize(s);
    if (obj && obj.view) {
      view.zoom = Math.min(2, Math.max(0.25, Number(obj.view.zoom) || 1));
      view.bounds = !!obj.view.bounds;
    }
  }

  function copyText(text, textarea) {
    function fallback() {
      try {
        var ta = textarea || document.createElement('textarea');
        if (!textarea) { ta.value = text; document.body.appendChild(ta); }
        ta.select();
        var ok = document.execCommand('copy');
        if (!textarea) ta.remove();
        toast(ok ? t('copied') : t('copyFail'));
      } catch (e) { toast(t('copyFail')); }
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(t('copied')); }, fallback);
    } else fallback();
  }

  /* ---------- Exports ---------- */

  function exportSVG() {
    download(baseName() + '-tuile.svg', new Blob([M.toSVG(model || M.generate(state))], { type: 'image/svg+xml' }));
  }

  function exportTilePNG() {
    var scale = Number($('tileScale').value) || 1;
    var c = M.renderTile(document.createElement('canvas'), model || M.generate(state), scale);
    c.toBlob(function (b) { download(baseName() + '-tuile-' + c.width + 'px.png', b); }, 'image/png');
  }

  function largeSize() {
    var v = $('largeSize').value;
    if (v === 'custom') {
      return [Math.round(Math.min(8000, Math.max(16, Number($('customW').value) || 1920))),
        Math.round(Math.min(8000, Math.max(16, Number($('customH').value) || 1080)))];
    }
    return v.split('x').map(Number);
  }

  function exportLargePNG() {
    var wh = largeSize();
    toast(t('rendering'));
    setTimeout(function () {
      var c = M.renderRepeat(document.createElement('canvas'), model || M.generate(state), wh[0], wh[1], 1);
      c.toBlob(function (b) { download(baseName() + '-' + wh[0] + 'x' + wh[1] + '.png', b); }, 'image/png');
    }, 30);
  }

  function exportJSON() {
    download(baseName() + '.json', new Blob([JSON.stringify(exportable(), null, 2)], { type: 'application/json' }));
  }

  /* ---------- Langue ---------- */

  function setLang(lang) {
    if (!window.I18N[lang]) lang = 'fr';
    $('lang').value = lang;
    window.applyI18n(lang);
    buildColors();   // libellés « Couleur n » générés en JS
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignoré */ }
  }

  function detectLang() {
    try { var l = localStorage.getItem(LANG_KEY); if (l && window.I18N[l]) return l; } catch (e) { /* ignoré */ }
    var nav = (navigator.language || 'fr').toLowerCase();
    if (nav.indexOf('kab') === 0) return 'kab';
    if (nav.indexOf('en') === 0) return 'en';
    return 'fr';
  }

  /* ---------- Branchements ---------- */

  function bind() {
    $('lang').addEventListener('change', function () { setLang(this.value); });
    $('mode').addEventListener('change', function () { state.mode = this.value; scheduleRender(); });

    Object.keys(RANGES).forEach(function (k) {
      $(k).addEventListener('input', function () {
        state[k] = Number(this.value);
        // Garde min ≤ max pour la plage de tailles.
        if (k === 'sizeMin' && state.sizeMin > state.sizeMax) { state.sizeMax = state.sizeMin; $('sizeMax').value = state.sizeMax; $('outSizeMax').textContent = RANGES.sizeMax[1](state.sizeMax); }
        if (k === 'sizeMax' && state.sizeMax < state.sizeMin) { state.sizeMin = state.sizeMax; $('sizeMin').value = state.sizeMin; $('outSizeMin').textContent = RANGES.sizeMin[1](state.sizeMin); }
        $(RANGES[k][0]).textContent = RANGES[k][1](state[k]);
        scheduleRender();
      });
    });

    $('seed').addEventListener('input', function () { state.seed = this.value.trim() || M.DEFAULTS.seed; scheduleRender(); });
    function reroll() { state.seed = randomSeed(); $('seed').value = state.seed; scheduleRender(); }
    $('btnReroll').addEventListener('click', reroll);
    $('btnReroll2').addEventListener('click', reroll);

    document.querySelectorAll('input[name=style]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { state.style = r.value; scheduleRender(); } });
    });

    $('zoom').addEventListener('input', function () {
      view.zoom = Number(this.value);
      $('outZoom').textContent = Math.round(view.zoom * 100) + ' %';
      scheduleRender();
    });
    $('bounds').addEventListener('change', function () { view.bounds = this.checked; scheduleRender(); });

    $('btnAddColor').addEventListener('click', function () {
      if (state.colors.length >= 5) return;
      state.colors.push(randomPalette().colors[0]);
      buildColors(); scheduleRender();
    });
    $('btnRemoveColor').addEventListener('click', function () {
      if (state.colors.length <= 3) return;
      state.colors.pop();
      buildColors(); scheduleRender();
    });
    $('btnRandPal').addEventListener('click', function () {
      var p = randomPalette(); state.bg = p.bg; state.colors = p.colors;
      buildColors(); scheduleRender();
    });

    $('btnSurprise').addEventListener('click', function () {
      var keys = M.SHAPE_KEYS.slice().sort(function () { return Math.random() - 0.5; });
      var p = Math.random() < 0.5 ? PALETTES[Math.floor(Math.random() * PALETTES.length)] : randomPalette();
      var minS = 4 + Math.floor(Math.random() * 14);
      state = M.sanitize({
        mode: M.MODES[Math.floor(Math.random() * M.MODES.length)],
        shapes: keys.slice(0, 1 + Math.floor(Math.random() * 3)),
        tile: state.tile,
        count: 2 + Math.floor(Math.random() * 10),
        sizeMin: minS,
        sizeMax: minS + 4 + Math.floor(Math.random() * 16),
        rotBase: [0, 0, 45, 90][Math.floor(Math.random() * 4)],
        jitter: [0, 15, 45, 180][Math.floor(Math.random() * 4)],
        style: ['fill', 'fill', 'stroke', 'mix'][Math.floor(Math.random() * 4)],
        stroke: 1.5 + Math.floor(Math.random() * 6),
        bg: p.bg, colors: p.colors.slice(), seed: randomSeed()
      });
      syncUI(); scheduleRender();
    });

    $('largeSize').addEventListener('change', function () { $('customSize').hidden = this.value !== 'custom'; });
    $('btnSvg').addEventListener('click', exportSVG);
    $('btnTile').addEventListener('click', exportTilePNG);
    $('btnLarge').addEventListener('click', exportLargePNG);
    $('btnJson').addEventListener('click', exportJSON);
    $('btnCss').addEventListener('click', function () { copyText($('cssOut').value, $('cssOut')); });
    $('btnLink').addEventListener('click', function () {
      var url = location.href.split('#')[0] + '#s=' + b64encode(JSON.stringify(exportable()));
      copyText(url);
    });

    $('fileJson').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var input = this;
      file.text().then(function (txt) {
        applyImported(JSON.parse(txt));
        toast(t('imported'));
      }).catch(function () { toast(t('importError')); }).then(function () { input.value = ''; });
    });

    $('btnReset').addEventListener('click', function () {
      state = M.sanitize(M.DEFAULTS);
      view.zoom = 1; view.bounds = false;
      syncUI(); scheduleRender();
    });

    window.addEventListener('resize', scheduleRender);
  }

  /* ---------- Démarrage ---------- */
  load();
  buildShapes();
  buildPalettes();
  bind();
  setLang(detectLang());
  syncUI();
  render();

  // Petit point d'accès pour les tests automatisés et la console.
  window.MotifApp = {
    getState: function () { return M.sanitize(state); },
    setState: function (s) { applyImported({ settings: s }); },
    getModel: function () { return model; },
    palettes: PALETTES
  };
})();
