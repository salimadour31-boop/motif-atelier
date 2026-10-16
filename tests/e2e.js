// Tests de bout en bout (Playwright). Lancer : python3 -m http.server 8765 & npm i playwright-core && node tests/e2e.js
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const URL0 = process.env.MOTIF_URL || 'http://127.0.0.1:8765/index.html';
const out = [];
const ok = (c, m) => { out.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, acceptDownloads: true, deviceScaleFactor: vp.name === 'mobile' ? 2 : 1, locale: 'fr-FR' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(URL0);
    await page.waitForTimeout(400);
    const P = vp.name + ': ';

    // Langues
    for (const [lang, expect] of [['en', 'Tile SVG'], ['kab', 'Taxxamt SVG'], ['fr', 'Tuile SVG']]) {
      await page.selectOption('#lang', lang);
      const txt = await page.textContent('#btnSvg');
      const opt = await page.textContent('#mode option[value=mirror]');
      const htmlLang = await page.getAttribute('html', 'lang');
      ok(txt === expect && htmlLang === lang, P + `lang ${lang} -> "${txt}" / mode option "${opt}"`);
    }
    // Clés manquantes
    const missing = await page.evaluate(() => { const fr = Object.keys(I18N.fr); return ['en', 'kab'].map(l => l + ':' + fr.filter(k => !(k in I18N[l])).join(',')); });
    ok(missing.every(m => m.endsWith(':')), P + 'i18n keys complete ' + missing.join(' '));

    if (vp.name === 'desktop') {
      // Chaque mode, chaque style : rendu + raccord
      const modes = ['grid', 'halfdrop', 'brick', 'mirror', 'rotate4', 'hex', 'scatter'];
      for (const mode of modes) {
        for (const style of ['fill', 'stroke', 'mix']) {
          const r = await page.evaluate(({ mode, style }) => {
            const shapes = Motif.SHAPE_KEYS;
            MotifApp.setState({ mode, style, shapes, tile: 200, count: 8, sizeMin: 10, sizeMax: 40, jitter: 90, seed: 'test-' + mode, stroke: 3 });
            const model = Motif.generate(MotifApp.getState());
            const T = model.T;
            // Tuile répétée (motif canvas) décalée de T/2
            const tile = Motif.renderTile(document.createElement('canvas'), model, 1);
            const a = document.createElement('canvas'); a.width = a.height = 2 * T;
            const actx = a.getContext('2d');
            actx.translate(-T / 2, -T / 2);
            actx.fillStyle = actx.createPattern(tile, 'repeat');
            actx.fillRect(T / 2, T / 2, 2 * T, 2 * T);
            // Rendu direct du motif infini sur la même zone
            const b = document.createElement('canvas'); b.width = b.height = 2 * T;
            Motif.drawRegion(b.getContext('2d'), model, T / 2, T / 2, 2 * T, 2 * T);
            const da = actx.getImageData(0, 0, 2 * T, 2 * T).data, db = b.getContext('2d').getImageData(0, 0, 2 * T, 2 * T).data;
            let sum = 0, max = 0, bad = 0;
            for (let i = 0; i < da.length; i += 4) {
              const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
              sum += d; if (d > max) max = d; if (d > 60) bad++;
            }
            // Continuité des bords : écart col 0 / col T-1 vs écart moyen entre colonnes voisines intérieures
            const td = tile.getContext('2d').getImageData(0, 0, T, T).data;
            const px = (x, y, c) => td[(y * T + x) * 4 + c];
            function colDiff(x1, x2) { let s = 0; for (let y = 0; y < T; y++) for (let c = 0; c < 3; c++) s += Math.abs(px(x1, y, c) - px(x2, y, c)); return s / T; }
            function rowDiff(y1, y2) { let s = 0; for (let x = 0; x < T; x++) for (let c = 0; c < 3; c++) s += Math.abs(px(x, y1, c) - px(x, y2, c)); return s / T; }
            let interior = 0, n = 0;
            for (let x = 1; x < T; x += 7) { interior += colDiff(x - 1, x); n++; }
            interior /= n;
            let distinct = new Set(); for (let i = 0; i < td.length; i += 400) distinct.add(td[i] + ',' + td[i + 1] + ',' + td[i + 2]);
            // Périodicité exacte : la zone décalée d'une tuile entière doit être identique pixel pour pixel
            const e = document.createElement('canvas'); e.width = e.height = T;
            Motif.drawRegion(e.getContext('2d'), model, T, -T, T, T);
            const de = e.getContext('2d').getImageData(0, 0, T, T).data;
            let periodBad = 0; for (let i = 0; i < td.length; i++) if (td[i] !== de[i]) periodBad++;
            const svg = Motif.toSVG(model);
            const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
            return { periodBad, items: model.items.length, mean: sum / (da.length / 4), max, bad, edgeX: colDiff(T - 1, 0), edgeY: rowDiff(T - 1, 0), interior, distinct: distinct.size, svgOk: !doc.querySelector('parsererror') && doc.documentElement.nodeName === 'svg', paths: doc.querySelectorAll('path').length };
          }, { mode, style });
          const pass = r.items > 0 && r.distinct > 2 && r.periodBad === 0 && r.bad / (4 * 200 * 200) < 0.005 && r.mean < 2 && r.edgeX < r.interior * 3 + 5 && r.edgeY < r.interior * 3 + 5 && r.svgOk;
          ok(pass, P + `mode=${mode} style=${style} periodExactDiff=${r.periodBad} items=${r.items} paths=${r.paths} colors=${r.distinct} wrapDiff mean=${r.mean.toFixed(3)} max=${r.max} halfShiftAApx=${r.bad} edgeX=${r.edgeX.toFixed(1)} edgeY=${r.edgeY.toFixed(1)} interior=${r.interior.toFixed(1)} svgOk=${r.svgOk}`);
        }
      }

      // Rendu SVG rasterisé == rendu canvas (même chemins)
      const svgVsCanvas = await page.evaluate(async () => {
        MotifApp.setState({ mode: 'mirror', shapes: Motif.SHAPE_KEYS, tile: 160, count: 6, sizeMin: 10, sizeMax: 45, style: 'mix', seed: 'svgcmp' });
        const model = Motif.generate(MotifApp.getState());
        const svg = Motif.toSVG(model);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
        const c1 = document.createElement('canvas'); c1.width = c1.height = 160; c1.getContext('2d').drawImage(img, 0, 0);
        const c2 = Motif.renderTile(document.createElement('canvas'), model, 1);
        const a = c1.getContext('2d').getImageData(0, 0, 160, 160).data, b = c2.getContext('2d').getImageData(0, 0, 160, 160).data;
        let bad = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 90) bad++;
        // CSS data URI chargeable
        const css = Motif.toCSS(model);
        const uri = /url\("([^"]+)"\)/.exec(css)[1];
        const img2 = new Image();
        const loaded = await new Promise(res => { img2.onload = () => res(img2.naturalWidth); img2.onerror = () => res(-1); img2.src = uri; });
        return { badFrac: bad / (160 * 160), cssLoaded: loaded, cssLen: css.length };
      });
      ok(svgVsCanvas.badFrac < 0.01, P + 'SVG raster matches canvas, mismatched px fraction=' + svgVsCanvas.badFrac.toFixed(4));
      ok(svgVsCanvas.cssLoaded === 160, P + `CSS data URI loads as image (width=${svgVsCanvas.cssLoaded}, ${svgVsCanvas.cssLen} chars)`);

      // Reproductibilité : même graine => même modèle ; autre graine => différent
      const repro = await page.evaluate(() => {
        const s = Motif.sanitize({ mode: 'scatter', seed: 'abc' });
        const a = JSON.stringify(Motif.generate(s).items.map(i => [i.x, i.y, i.s]));
        const b = JSON.stringify(Motif.generate(s).items.map(i => [i.x, i.y, i.s]));
        const c = JSON.stringify(Motif.generate(Object.assign({}, s, { seed: 'abd' })).items.map(i => [i.x, i.y, i.s]));
        return a === b && a !== c;
      });
      ok(repro, P + 'seed reproducible & re-roll changes output');

      // Sanitize contre entrées hostiles
      const san = await page.evaluate(() => { const s = Motif.sanitize({ mode: 'x', tile: 1e9, colors: ['red', '#12345g'], bg: '<script>', shapes: ['nope'] }); return s.tile === 1024 && s.mode === 'grid' && s.colors.length === 3 && s.bg[0] === '#' && s.shapes[0] === 'circle'; });
      ok(san, P + 'sanitize rejects invalid input');

      // Exports via boutons
      await page.evaluate(() => MotifApp.setState({ mode: 'halfdrop', tile: 240, seed: 'export-test', shapes: ['leaf', 'circle', 'star', 'wave'] }));
      await page.waitForTimeout(200);
      const dl = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = path.join('/tmp/motif-dl', d.suggestedFilename()); await d.saveAs(p); return p; };
      fs.mkdirSync('/tmp/motif-dl', { recursive: true });
      const svgP = await dl('#btnSvg');
      const svgTxt = fs.readFileSync(svgP, 'utf8');
      ok(svgTxt.startsWith('<svg') && svgTxt.includes('clipPath') && svgTxt.trim().endsWith('</svg>'), P + 'SVG export ' + path.basename(svgP) + ' ' + svgTxt.length + ' bytes');
      const pngInfo = p => { const b = fs.readFileSync(p); return { sig: b.slice(1, 4).toString(), w: b.readUInt32BE(16), h: b.readUInt32BE(20), size: b.length }; };
      await page.selectOption('#tileScale', '2');
      const tileP = await dl('#btnTile'); const ti = pngInfo(tileP);
      ok(ti.sig === 'PNG' && ti.w === 480 && ti.h === 480 && ti.size > 1000, P + `tile PNG ${ti.w}x${ti.h} ${ti.size} bytes`);
      for (const size of ['1920x1080', '3000x3000']) {
        await page.selectOption('#largeSize', size);
        const p = await dl('#btnLarge'); const li = pngInfo(p);
        ok(li.sig === 'PNG' && li.w + 'x' + li.h === size && li.size > 10000, P + `large PNG ${li.w}x${li.h} ${li.size} bytes`);
      }
      await page.selectOption('#largeSize', 'custom');
      ok(await page.isVisible('#customSize'), P + 'custom size inputs shown');
      await page.fill('#customW', '800'); await page.fill('#customH', '500');
      { const p = await dl('#btnLarge'); const li = pngInfo(p); ok(li.w === 800 && li.h === 500, P + `custom PNG ${li.w}x${li.h}`); }
      const jsonP = await dl('#btnJson');
      const j = JSON.parse(fs.readFileSync(jsonP, 'utf8'));
      ok(j.app === 'motif-atelier' && j.settings.mode === 'halfdrop' && j.settings.seed === 'export-test', P + 'JSON export valid');
      // Import JSON après reset
      await page.click('#btnReset');
      ok((await page.evaluate(() => MotifApp.getState().mode)) === 'grid', P + 'reset works');
      await page.setInputFiles('#fileJson', jsonP);
      await page.waitForTimeout(300);
      const imp = await page.evaluate(() => [MotifApp.getState().mode, document.getElementById('mode').value, document.getElementById('seed').value]);
      ok(imp[0] === 'halfdrop' && imp[1] === 'halfdrop' && imp[2] === 'export-test', P + 'JSON import restores state ' + imp.join(','));
      // CSS
      const cssVal = await page.inputValue('#cssOut');
      ok(cssVal.startsWith('.motif-atelier {') && cssVal.includes('data:image/svg+xml,'), P + 'CSS snippet present (' + cssVal.length + ' chars)');
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.click('summary'); await page.click('#btnCss'); await page.waitForTimeout(200);
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e));
      ok(clip === cssVal, P + 'CSS copied to clipboard');
      // Lien de partage
      await page.click('#btnLink'); await page.waitForTimeout(200);
      const link = await page.evaluate(() => navigator.clipboard.readText());
      ok(/#s=[A-Za-z0-9_-]+$/.test(link), P + 'share link ' + link.length + ' chars');
      // UI controls
      await page.click('#btnReroll'); const s1 = await page.inputValue('#seed');
      await page.click('#btnRandPal');
      while (await page.isEnabled('#btnRemoveColor')) await page.click('#btnRemoveColor');
      const n3 = await page.evaluate(() => MotifApp.getState().colors.length);
      await page.click('#btnAddColor'); await page.click('#btnAddColor');
      const nc = await page.evaluate(() => MotifApp.getState().colors.length);
      ok(n3 === 3 && nc === 5 && !(await page.isEnabled('#btnAddColor')) && s1 !== 'export-test', P + `reroll seed=${s1}, colors=${nc}`);
      await page.click('.pal[data-id=neon]');
      ok((await page.evaluate(() => MotifApp.getState().bg)) === '#120c24', P + 'built-in palette applied');
      for (let i = 0; i < 5; i++) await page.click('#btnSurprise');
      await page.check('#bounds');
      await page.waitForTimeout(200);
      // Persistance localStorage
      const before = await page.evaluate(() => JSON.stringify(MotifApp.getState()));
      await page.waitForTimeout(400);
      await page.reload(); await page.waitForTimeout(400);
      const after = await page.evaluate(() => JSON.stringify(MotifApp.getState()));
      ok(before === after, P + 'localStorage persistence');
      // Hash
      const p2 = await ctx.newPage();
      await p2.goto(link); await p2.waitForTimeout(400);
      const hs = await p2.evaluate(() => MotifApp.getState());
      ok(hs.mode === 'halfdrop' && hs.seed === 'export-test', P + 'share link restores settings');
      await p2.close();
      // Capture desktop
      await page.evaluate(() => { MotifApp.setState({ mode: 'halfdrop', shapes: ['leaf', 'circle', 'arch', 'dots', 'wave', 'star'], tile: 200, count: 10, sizeMin: 8, sizeMax: 22, rotBase: 0, jitter: 45, style: 'fill', stroke: 3, bg: '#0f3d5c', colors: ['#f6f1e7', '#3fa7c9', '#f2b134', '#e4572e'], seed: 'tafsut-7' }); });
      await page.uncheck('#bounds'); await page.check('#bounds');
      await page.waitForTimeout(300);
      await page.screenshot({ path: ROOT + '/captures/desktop.png' });
    } else {
      // Mobile : pas de débordement horizontal
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= vp.width, P + 'no horizontal overflow (scrollWidth=' + sw + ')');
      for (const mode of ['grid', 'halfdrop', 'brick', 'mirror', 'rotate4', 'hex', 'scatter']) {
        await page.selectOption('#mode', mode); await page.waitForTimeout(80);
      }
      await page.evaluate(() => { MotifApp.setState({ mode: 'hex', shapes: ['hexagon', 'star', 'ring'], tile: 200, count: 4, sizeMin: 14, sizeMax: 26, jitter: 0, style: 'mix', stroke: 3, bg: '#f3e6d3', colors: ['#c4552d', '#2f4858', '#e2a33b', '#7a9e7e'], seed: 'tiziri' }); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: ROOT + '/captures/mobile.png' });
      await page.screenshot({ path: '/tmp/motif-mobile-full.png', fullPage: true });
    }
    ok(errors.length === 0, P + 'no console errors/warnings ' + JSON.stringify(errors));
    await ctx.close();
  }
  await browser.close();
  console.log(out.join('\n'));
})().catch(e => { console.log(out.join('\n')); console.error(e); process.exit(2); });
