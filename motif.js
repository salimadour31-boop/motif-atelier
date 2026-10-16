/*
 * motif.js — moteur de génération de motifs répétables (tiles) sans raccord.
 * Motif Atelier — MIT © 2026 Amirouche Amwanes.
 *
 * Principe :
 *  1. generate(settings) produit une liste d'« éléments » (forme, position,
 *     rayon, rotation, miroir, couleur, plein/contour) dans l'espace d'une tuile
 *     carrée de côté T. Toutes les positions sont ramenées modulo T.
 *  2. Au rendu (canvas ou SVG), chaque élément est dessiné à sa position ET
 *     décalé de ±T horizontalement/verticalement lorsqu'il déborde d'un bord.
 *     Une forme qui sort à droite réapparaît donc à gauche : la tuile est
 *     mathématiquement périodique, donc sans raccord visible.
 *  3. Chaque forme est décrite par une seule chaîne de chemin SVG (« d »),
 *     utilisée à la fois par Path2D (canvas) et par l'export SVG : l'aperçu et
 *     le fichier vectoriel sont strictement identiques.
 *
 * Aucune dépendance externe.
 */
(function (global) {
  'use strict';

  /* ---------- Hasard reproductible (graine texte -> PRNG) ---------- */

  // Hachage d'une chaîne en entier 32 bits (variante de cyrb53 simplifiée).
  function hashString(str) {
    var h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return h1 >>> 0;
  }

  // PRNG mulberry32 : rapide, suffisant pour du graphisme.
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRandom(seed) { return mulberry32(hashString(String(seed))); }

  /* ---------- Bibliothèque de formes (chemins SVG, centrés sur 0,0) ---------- */

  // Arrondi à 2 décimales pour des fichiers SVG compacts.
  function f(n) { return String(Math.round(n * 100) / 100); }

  function polygon(points) {
    return 'M' + points.map(function (p) { return f(p[0]) + ' ' + f(p[1]); }).join('L') + 'Z';
  }
  function regular(n, r, startDeg) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (startDeg + i * 360 / n) * Math.PI / 180;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }
  function circlePath(cx, cy, r) {
    return 'M' + f(cx + r) + ' ' + f(cy) +
      'A' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(cx - r) + ' ' + f(cy) +
      'A' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(cx + r) + ' ' + f(cy) + 'Z';
  }

  /*
   * Chaque forme : path(r) -> chaîne « d » pour un rayon r (demi-taille).
   * open: true  => forme linéaire, toujours tracée en contour.
   */
  var SHAPES = {
    circle: { path: function (r) { return circlePath(0, 0, r); } },
    ring: { path: function (r) { return circlePath(0, 0, r) + circlePath(0, 0, r * 0.56); } },
    square: { path: function (r) { var a = r * 0.82; return polygon([[-a, -a], [a, -a], [a, a], [-a, a]]); } },
    triangle: { path: function (r) { return polygon(regular(3, r, -90)); } },
    hexagon: { path: function (r) { return polygon(regular(6, r, 0)); } },
    star: {
      path: function (r) {
        var pts = [];
        for (var i = 0; i < 10; i++) {
          var a = (-90 + i * 36) * Math.PI / 180, rr = i % 2 ? r * 0.44 : r;
          pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        return polygon(pts);
      }
    },
    cross: {
      path: function (r) {
        var w = r * 0.34;
        return polygon([[-w, -r], [w, -r], [w, -w], [r, -w], [r, w], [w, w], [w, r], [-w, r], [-w, w], [-r, w], [-r, -w], [-w, -w]]);
      }
    },
    leaf: {
      // Feuille en amande + nervure (la nervure n'a pas d'aire : visible en contour seulement).
      path: function (r) {
        return 'M0 ' + f(-r) + 'Q' + f(r * 0.78) + ' 0 0 ' + f(r) + 'Q' + f(-r * 0.78) + ' 0 0 ' + f(-r) + 'Z' +
          'M0 ' + f(-r * 0.7) + 'L0 ' + f(r * 0.7);
      }
    },
    arch: {
      // Demi-anneau (arc-en-ciel).
      path: function (r) {
        var i = r * 0.55;
        return 'M' + f(-r) + ' ' + f(r * 0.3) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(r) + ' ' + f(r * 0.3) +
          'L' + f(i) + ' ' + f(r * 0.3) + 'A' + f(i) + ' ' + f(i) + ' 0 0 0 ' + f(-i) + ' ' + f(r * 0.3) + 'Z';
      }
    },
    dots: {
      // Grille 3 × 3 de petites pastilles.
      path: function (r) {
        var d = '', s = r * 0.62, pr = r * 0.17;
        for (var y = -1; y <= 1; y++) for (var x = -1; x <= 1; x++) d += circlePath(x * s, y * s, pr);
        return d;
      }
    },
    line: { open: true, path: function (r) { return 'M' + f(-r) + ' 0L' + f(r) + ' 0'; } },
    wave: {
      open: true,
      // Quatre demi-ondes en courbes quadratiques.
      path: function (r) {
        var d = 'M' + f(-r) + ' 0', step = r / 2, amp = r * 0.32;
        for (var k = 0; k < 4; k++) {
          var x0 = -r + k * step;
          d += 'Q' + f(x0 + step / 2) + ' ' + f(k % 2 ? amp * 2 : -amp * 2) + ' ' + f(x0 + step) + ' 0';
        }
        return d;
      }
    }
  };
  var SHAPE_KEYS = Object.keys(SHAPES);
  var MODES = ['grid', 'halfdrop', 'brick', 'mirror', 'rotate4', 'hex', 'scatter'];

  /* ---------- Réglages par défaut + validation ---------- */

  var DEFAULTS = {
    mode: 'grid',
    shapes: ['circle', 'leaf', 'star'],
    tile: 240,          // côté de la tuile en px
    count: 5,           // densité : éléments par cellule (ou densité du réseau)
    sizeMin: 8,         // taille min en % du côté de la tuile
    sizeMax: 22,        // taille max en %
    rotBase: 0,         // rotation de base (degrés)
    jitter: 40,         // variation aléatoire de rotation ± (degrés)
    style: 'fill',      // fill | stroke | mix
    stroke: 3,          // épaisseur de contour (px à l'échelle 1)
    bg: '#f3e6d3',
    colors: ['#c4552d', '#2f4858', '#e2a33b', '#7a9e7e'],
    seed: 'tafsut-1'
  };

  function clamp(v, a, b) { v = Number(v); if (!isFinite(v)) v = a; return Math.min(b, Math.max(a, v)); }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }

  // Nettoie un objet de réglages (import JSON, URL, localStorage) — jamais de confiance aveugle.
  function sanitize(s) {
    s = s || {};
    var o = {};
    o.mode = MODES.indexOf(s.mode) >= 0 ? s.mode : DEFAULTS.mode;
    o.shapes = Array.isArray(s.shapes) ? s.shapes.filter(function (k) { return SHAPES[k]; }) : DEFAULTS.shapes.slice();
    if (!o.shapes.length) o.shapes = ['circle'];
    o.tile = Math.round(clamp(s.tile != null ? s.tile : DEFAULTS.tile, 64, 1024));
    o.count = Math.round(clamp(s.count != null ? s.count : DEFAULTS.count, 1, 40));
    o.sizeMin = clamp(s.sizeMin != null ? s.sizeMin : DEFAULTS.sizeMin, 1, 60);
    o.sizeMax = clamp(s.sizeMax != null ? s.sizeMax : DEFAULTS.sizeMax, 1, 60);
    if (o.sizeMax < o.sizeMin) { var t = o.sizeMax; o.sizeMax = o.sizeMin; o.sizeMin = t; }
    o.rotBase = clamp(s.rotBase != null ? s.rotBase : DEFAULTS.rotBase, 0, 360);
    o.jitter = clamp(s.jitter != null ? s.jitter : DEFAULTS.jitter, 0, 180);
    o.style = ['fill', 'stroke', 'mix'].indexOf(s.style) >= 0 ? s.style : DEFAULTS.style;
    o.stroke = clamp(s.stroke != null ? s.stroke : DEFAULTS.stroke, 0.5, 20);
    o.bg = isHex(s.bg) ? s.bg.toLowerCase() : DEFAULTS.bg;
    o.colors = Array.isArray(s.colors) ? s.colors.filter(isHex).map(function (c) { return c.toLowerCase(); }).slice(0, 5) : DEFAULTS.colors.slice();
    while (o.colors.length < 3) o.colors.push(DEFAULTS.colors[o.colors.length]);
    o.seed = (s.seed != null && String(s.seed).trim()) ? String(s.seed).slice(0, 64) : DEFAULTS.seed;
    return o;
  }

  /* ---------- Placement ---------- */

  function mod(a, n) { return ((a % n) + n) % n; }

  // Distance torique (sur une surface qui se répète tous les « p » pixels).
  function torDist2(ax, ay, bx, by, p) {
    var dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    dx = Math.min(dx, p - dx); dy = Math.min(dy, p - dy);
    return dx * dx + dy * dy;
  }

  // Échantillonnage « meilleur candidat » (Mitchell) : points bien répartis
  // dans un carré périodique de côté p. Le premier point est au centre si centerFirst.
  function bestCandidate(rand, n, p, centerFirst) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      if (i === 0 && centerFirst) { pts.push([p / 2, p / 2]); continue; }
      var best = null, bestD = -1, tries = 6 + Math.min(14, i * 2);
      for (var k = 0; k < tries; k++) {
        var cx = rand() * p, cy = rand() * p, dmin = Infinity;
        for (var j = 0; j < pts.length; j++) {
          var d = torDist2(cx, cy, pts[j][0], pts[j][1], p);
          if (d < dmin) dmin = d;
        }
        if (dmin > bestD) { bestD = dmin; best = [cx, cy]; }
      }
      pts.push(best);
    }
    return pts;
  }

  // Crée un élément aléatoire à la position (x, y).
  function makeItem(rand, s, x, y) {
    var T = s.tile;
    var shape = s.shapes[Math.floor(rand() * s.shapes.length) % s.shapes.length];
    var pct = s.sizeMin + (s.sizeMax - s.sizeMin) * rand();
    var r = Math.min(T * 0.5, (pct / 100) * T / 2);   // rayon borné : ≤ T/2
    var rot = s.rotBase + s.jitter * (rand() * 2 - 1);
    var c = Math.floor(rand() * s.colors.length) % s.colors.length;
    var mixRoll = rand();                            // toujours consommé : même graine => même placement
    var filled = s.style === 'fill' || (s.style === 'mix' && mixRoll < 0.5);
    return { s: shape, x: x, y: y, r: r, rot: rot, fx: 1, fy: 1, c: c, f: filled };
  }

  function copyItem(it, x, y, extra) {
    var o = { s: it.s, x: x, y: y, r: it.r, rot: it.rot, fx: it.fx, fy: it.fy, c: it.c, f: it.f };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  /*
   * generate(settings) -> { T, items[] }
   * Modes « cellule » (grid, halfdrop, brick, mirror, rotate4) : la tuile
   * contient 2 × 2 cellules de côté T/2 ; une cellule de base est remplie
   * puis recopiée selon la règle de répétition. hex / scatter remplissent la
   * tuile entière.
   */
  function generate(settings) {
    var s = sanitize(settings);
    var T = s.tile, h = T / 2;
    var rand = makeRandom(s.seed + '|' + s.mode);
    var items = [];
    var base = [];

    if (['grid', 'halfdrop', 'brick', 'mirror', 'rotate4'].indexOf(s.mode) >= 0) {
      bestCandidate(rand, s.count, h, true).forEach(function (p) { base.push(makeItem(rand, s, p[0], p[1])); });
    }

    switch (s.mode) {
      case 'grid':      // répétition droite : 4 copies identiques
        base.forEach(function (it) {
          [[0, 0], [h, 0], [0, h], [h, h]].forEach(function (o) { items.push(copyItem(it, it.x + o[0], it.y + o[1])); });
        });
        break;
      case 'halfdrop':  // demi-chute : la 2e colonne descend d'une demi-cellule
        base.forEach(function (it) {
          [[0, 0], [0, h], [h, h / 2], [h, h * 1.5]].forEach(function (o) { items.push(copyItem(it, it.x + o[0], it.y + o[1])); });
        });
        break;
      case 'brick':     // brique : la 2e rangée est décalée d'une demi-cellule
        base.forEach(function (it) {
          [[0, 0], [h, 0], [h / 2, h], [h * 1.5, h]].forEach(function (o) { items.push(copyItem(it, it.x + o[0], it.y + o[1])); });
        });
        break;
      case 'mirror':    // miroir : réflexions autour des axes x = T/2 et y = T/2
        base.forEach(function (it) {
          items.push(copyItem(it, it.x, it.y));
          items.push(copyItem(it, T - it.x, it.y, { fx: -it.fx }));
          items.push(copyItem(it, it.x, T - it.y, { fy: -it.fy }));
          items.push(copyItem(it, T - it.x, T - it.y, { fx: -it.fx, fy: -it.fy }));
        });
        break;
      case 'rotate4':   // rotation d'ordre 4 autour du centre de la tuile
        base.forEach(function (it) {
          var x = it.x, y = it.y;
          for (var k = 0; k < 4; k++) {
            items.push(copyItem(it, x, y, { rot: it.rot + 90 * k }));
            var nx = h - (y - h), ny = h + (x - h);   // rotation de 90° du point
            x = nx; y = ny;
          }
        });
        break;
      case 'hex': {     // réseau quasi hexagonal, nombre pair de rangées => raccord parfait
        var cols = Math.max(2, Math.min(16, Math.round(Math.sqrt(s.count) * 2)));
        var rows = Math.max(2, 2 * Math.round(cols / Math.sqrt(3)));
        var dx = T / cols, dy = T / rows;
        for (var j = 0; j < rows; j++) {
          for (var i = 0; i < cols; i++) {
            items.push(makeItem(rand, s, (i + 0.5 + (j % 2) * 0.5) * dx, (j + 0.5) * dy));
          }
        }
        break;
      }
      case 'scatter':   // semis aléatoire bien réparti (distance torique)
        bestCandidate(rand, s.count * 4, T, false).forEach(function (p) { items.push(makeItem(rand, s, p[0], p[1])); });
        break;
    }

    // Normalisation modulo T + pré-calcul du chemin de chaque élément.
    items.forEach(function (it) {
      it.x = mod(it.x, T); it.y = mod(it.y, T);
      it.d = SHAPES[it.s].path(it.r);
      it.open = !!SHAPES[it.s].open;
    });
    return { T: T, items: items, settings: s };
  }

  /* ---------- Rendu ---------- */

  function strokeWidthFor(it, s) {
    // Les formes linéaires restent lisibles en mode « plein ».
    return it.open && it.f ? Math.max(s.stroke, it.r * 0.18) : s.stroke;
  }

  // Liste des décalages k·T à appliquer pour que l'élément couvre la zone [x0, x0+w].
  function offsets(pos, br, T, x0, w) {
    var out = [];
    var kmin = Math.ceil((x0 - pos - br) / T), kmax = Math.floor((x0 + w - pos + br) / T);
    for (var k = kmin; k <= kmax; k++) out.push(k * T);
    return out;
  }

  /*
   * drawRegion(ctx, model, x0, y0, w, h)
   * Dessine la zone [x0,x0+w]×[y0,y0+h] du motif infini (coordonnées tuile)
   * dans ctx (déjà mis à l'échelle). Sert au rendu de la tuile (0,0,T,T) et
   * à la vérification de raccord (zones à cheval sur plusieurs tuiles).
   */
  function drawRegion(ctx, model, x0, y0, w, h) {
    var s = model.settings, T = model.T;
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    model.items.forEach(function (it) {
      if (!it.p2d) it.p2d = new Path2D(it.d);
      var sw = strokeWidthFor(it, s);
      var br = it.r * 1.2 + sw;                     // rayon englobant prudent
      var color = s.colors[it.c % s.colors.length];
      offsets(it.x, br, T, x0, w).forEach(function (ox) {
        offsets(it.y, br, T, y0, h).forEach(function (oy) {
          ctx.save();
          ctx.translate(it.x + ox - x0, it.y + oy - y0);
          ctx.scale(it.fx, it.fy);
          ctx.rotate(it.rot * Math.PI / 180);
          if (it.f && !it.open) {
            ctx.fillStyle = color;
            ctx.fill(it.p2d, 'evenodd');
          } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = sw;
            ctx.stroke(it.p2d);
          }
          ctx.restore();
        });
      });
    });
  }

  // Rend une tuile seule dans un canvas, à l'échelle demandée (1 = T px).
  function renderTile(canvas, model, scale) {
    scale = scale || 1;
    var px = Math.max(1, Math.round(model.T * scale));
    canvas.width = px; canvas.height = px;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(px / model.T, 0, 0, px / model.T, 0, 0);
    drawRegion(ctx, model, 0, 0, model.T, model.T);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  // Remplit un canvas W×H en répétant la tuile (motif « papier peint »).
  function renderRepeat(canvas, model, W, H, tileScale) {
    var tile = renderTile(document.createElement('canvas'), model, tileScale || 1);
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, W, H);
    return canvas;
  }

  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  /*
   * toSVG(model) -> chaîne SVG d'UNE tuile sans raccord.
   * Les formes qui chevauchent un bord sont dupliquées sur le bord opposé,
   * puis le tout est découpé (clipPath) au carré de la tuile.
   */
  function toSVG(model) {
    var s = model.settings, T = model.T;
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + T + '" height="' + T + '" viewBox="0 0 ' + T + ' ' + T + '">');
    out.push('<!-- Motif Atelier — tuile sans raccord | mode ' + esc(s.mode) + ' | graine ' + esc(s.seed).replace(/--/g, '- -') + ' -->');
    out.push('<defs><clipPath id="ma-tile"><rect width="' + T + '" height="' + T + '"/></clipPath></defs>');
    out.push('<rect width="' + T + '" height="' + T + '" fill="' + s.bg + '"/>');
    out.push('<g clip-path="url(#ma-tile)" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round">');
    model.items.forEach(function (it) {
      var sw = strokeWidthFor(it, s);
      var br = it.r * 1.2 + sw;
      var color = s.colors[it.c % s.colors.length];
      var paint = (it.f && !it.open) ? 'fill="' + color + '"' : 'fill="none" stroke="' + color + '" stroke-width="' + f(sw) + '"';
      offsets(it.x, br, T, 0, T).forEach(function (ox) {
        offsets(it.y, br, T, 0, T).forEach(function (oy) {
          var tr = 'translate(' + f(it.x + ox) + ' ' + f(it.y + oy) + ')';
          if (it.fx !== 1 || it.fy !== 1) tr += ' scale(' + it.fx + ' ' + it.fy + ')';
          if (Math.abs(it.rot) > 0.001) tr += ' rotate(' + f(it.rot) + ')';
          out.push('<path d="' + it.d + '" transform="' + tr + '" ' + paint + '/>');
        });
      });
    });
    out.push('</g></svg>');
    return out.join('\n');
  }

  // Extrait CSS : la tuile SVG en data URI, répétée en arrière-plan.
  function toCSS(model) {
    var svg = toSVG(model).replace(/<!--[\s\S]*?-->\n?/g, '').replace(/\n/g, '');
    var uri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
    return '.motif-atelier {\n' +
      '  background-color: ' + model.settings.bg + ';\n' +
      '  background-image: url("' + uri + '");\n' +
      '  background-size: ' + model.T + 'px ' + model.T + 'px;\n' +
      '  background-repeat: repeat;\n' +
      '}';
  }

  global.Motif = {
    SHAPES: SHAPES, SHAPE_KEYS: SHAPE_KEYS, MODES: MODES, DEFAULTS: DEFAULTS,
    sanitize: sanitize, generate: generate, makeRandom: makeRandom,
    drawRegion: drawRegion, renderTile: renderTile, renderRepeat: renderRepeat,
    toSVG: toSVG, toCSS: toCSS
  };
})(window);
