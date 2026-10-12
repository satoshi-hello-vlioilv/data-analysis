/**
 * UI/UX 案の評価ハーネス（CLAUDE.md の「キャプチャ条件」「評価軸」の客観指標を自動計測）
 *
 * 使い方: NODE_PATH=/opt/node22/lib/node_modules node tools/uiux-eval/harness.js <variantId> [<variantId> ...]
 *   作業ディレクトリ（環境変数 UIUX_WORK_DIR、既定は OS の一時ディレクトリ/chartlab-uiux）の
 *   variants/<id>/variant.css・variant.js・patch.html（どれも任意）を本物のアプリに注入した
 *   プロトタイプを生成し、D/L/M/E/H を撮影、客観指標を計測、コンタクトシートを作る。
 *   id が "base" のときは何も注入せず、現在のアプリそのものを評価する。
 *   作業ディレクトリに proto-lib.js があれば、variant.js より先に読み込む（案どうしの共通部品）。
 *   キャプチャや計測結果はリポジトリに書き込まない（CLAUDE.md の「記録」参照）。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const os = require('os');
const APP_DIR = path.resolve(__dirname, '../..');
const EVAL_DIR = process.env.UIUX_WORK_DIR || path.join(os.tmpdir(), 'chartlab-uiux');
const VARIANTS_DIR = path.join(EVAL_DIR, 'variants');

function buildVariantHtml(id) {
  const dir = path.join(VARIANTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  let html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  // 相対パス → 本物のアプリへの絶対パス
  html = html.replace(/(href|src)="(styles\.css|js\/[^"]+|vendor\/[^"]+)"/g, (m, attr, p) => `${attr}="file://${APP_DIR}/${p}"`);
  const css = path.join(dir, 'variant.css');
  const js = path.join(dir, 'variant.js');
  const htmlPatch = path.join(dir, 'patch.html'); // body 先頭に差し込む追加マークアップ（任意）
  if (fs.existsSync(css)) html = html.replace('</head>', `  <link rel="stylesheet" href="variant.css">\n</head>`);
  if (fs.existsSync(htmlPatch)) html = html.replace('<body>', '<body>\n' + fs.readFileSync(htmlPatch, 'utf8'));
  const lib = path.join(EVAL_DIR, 'proto-lib.js');
  if (fs.existsSync(js)) {
    const libTag = fs.existsSync(lib) ? `  <script src="../../proto-lib.js"></script>\n` : '';
    html = html.replace('</body>', libTag + `  <script src="variant.js"></script>\n</body>`);
  }
  const out = path.join(dir, 'index.html');
  fs.writeFileSync(out, html);
  return out;
}

async function newPage(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('chartlab-theme', 'light'); } catch (e) {} });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  PAGE ERROR:', e.message));
  // トーストは数秒で消える一時表示なので、レイアウト比較のキャプチャからは除外する
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = '.toast{display:none!important}';
      document.head.appendChild(st);
    });
  });
  return { ctx, page };
}

async function loadSample(page, name) {
  const btn = page.locator('.sample-card', { hasText: name }).filter({ visible: true }).first();
  if (await btn.count()) {
    await btn.click();
  } else {
    // 案によってサンプルが畳まれている場合は、DOM 上の任意のサンプルボタンを JS でクリック
    await page.evaluate(n => {
      const b = [...document.querySelectorAll('.sample-card')].find(x => x.textContent.includes(n));
      if (b) b.click();
    }, name);
  }
  await page.waitForTimeout(700);
}

/** 案の JS が提供する「グラフ設定を開いた状態」へのフック（なければ何もしない） */
async function openChartSettings(page) {
  await page.evaluate(() => { if (window.__evalOpenChartSettings) window.__evalOpenChartSettings(); });
  await page.waitForTimeout(300);
}

function visibleRatio(rect, vw, vh) {
  const w = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const h = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  return (w * h) / (vw * vh);
}

async function measureWorking(page, vw, vh) {
  return page.evaluate(({ vw, vh }) => {
    const canvas = document.getElementById('chartCanvas');
    const r = canvas && canvas.offsetParent ? canvas.getBoundingClientRect() : null;
    const clip = rect => {
      const w = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
      const h = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      return { w, h };
    };
    const chartVis = r ? clip(r) : { w: 0, h: 0 };
    const chartRatio = (chartVis.w * chartVis.h) / (vw * vh);

    // 設定パネルのスクロール量: 案が data-eval="settings" を付けた要素（なければ .sidebar）＋ページ自体
    const settings = document.querySelector('[data-eval="settings"]') || document.querySelector('.sidebar');
    let settingsOverflow = 0;
    if (settings && settings.offsetParent !== null) {
      settingsOverflow = Math.max(0, settings.scrollHeight - settings.clientHeight);
    }
    const se = document.scrollingElement;
    const pageOverflow = Math.max(0, se.scrollHeight - window.innerHeight);
    const overflow = Math.max(settingsOverflow, pageOverflow);

    // ビューポート内に見えている操作部品の数
    const sel = 'button, select, input:not([type=hidden]), summary, [role=button], [draggable=true]';
    const isVisible = el => {
      if (el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false;
      const rr = el.getBoundingClientRect();
      if (rr.width < 2 || rr.height < 2) return false;
      if (rr.bottom <= 0 || rr.right <= 0 || rr.top >= vh || rr.left >= vw) return false;
      // 祖先のスクロール枠の外に出ていないか
      let p = el.parentElement;
      while (p && p !== document.body) {
        const pcs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(pcs.overflowY + pcs.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (rr.bottom <= pr.top || rr.top >= pr.bottom || rr.right <= pr.left || rr.left >= pr.right) return false;
        }
        p = p.parentElement;
      }
      return true;
    };
    const controls = [...document.querySelectorAll(sel)].filter(isVisible);
    // input[type=range] の二重スライダーや label 内の checkbox などで二重計上しないよう、要素数そのまま
    const controlCount = controls.length;

    // 主要操作（種類・X軸・系列・系列追加）がスクロールなしで見えているか
    // 各役割の候補のうち、どれか1つでも見えていれば「届く」とみなす
    const mainOps = {
      type: '#chartTypePicker .chart-type-btn, #seriesList select[aria-label="グラフの種類"]',
      x: '[data-eval="x"] .col-picker-trigger, #xSelect .col-picker-trigger',
      series: '#seriesList .col-picker-trigger',
      add: '#addSeriesBtn'
    };
    const mainOpsVisible = {};
    Object.entries(mainOps).forEach(([k, s]) => { mainOpsVisible[k] = [...document.querySelectorAll(s)].some(isVisible); });

    const hOverflow = se.scrollWidth > window.innerWidth + 1;
    return {
      chartRatio,
      chartRect: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
      chartVisibleH: chartVis.h,
      overflow, settingsOverflow, pageOverflow,
      controlCount,
      mainOpsVisible,
      hOverflow
    };
  }, { vw, vh });
}

function lerp(x, x0, x1, y0, y1) {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

function mainAreaScore(r) {
  const pts = [[0.25, 3], [0.30, 6], [0.40, 9], [0.50, 12], [0.60, 15]];
  if (r <= pts[0][0]) return 3;
  if (r >= pts[pts.length - 1][0]) return 15;
  for (let i = 0; i < pts.length - 1; i++) {
    if (r >= pts[i][0] && r <= pts[i + 1][0]) return lerp(r, pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1]);
  }
  return 3;
}

async function evaluate(browser, id) {
  const file = id === 'base' ? path.join(APP_DIR, 'index.html') : buildVariantHtml(id);
  const url = 'file://' + file;
  const outDir = path.join(VARIANTS_DIR, id, 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\n=== ${id} ===`);

  const result = { id };

  // E: 初回画面
  {
    const { ctx, page } = await newPage(browser, 1440, 900);
    await page.goto(url);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'E.png') });
    await ctx.close();
  }

  // D: 1440×900 作業画面
  {
    const { ctx, page } = await newPage(browser, 1440, 900);
    await page.goto(url);
    await loadSample(page, '月次売上実績');
    await openChartSettings(page);
    await page.waitForTimeout(400);
    result.D = await measureWorking(page, 1440, 900);
    await page.screenshot({ path: path.join(outDir, 'D.png') });
    await ctx.close();
  }

  // L: 1280×720
  {
    const { ctx, page } = await newPage(browser, 1280, 720);
    await page.goto(url);
    await loadSample(page, '月次売上実績');
    await openChartSettings(page);
    await page.waitForTimeout(400);
    result.L = await measureWorking(page, 1280, 720);
    await page.screenshot({ path: path.join(outDir, 'L.png') });
    await ctx.close();
  }

  // M: 390×844
  {
    const { ctx, page } = await newPage(browser, 390, 844);
    await page.goto(url);
    await loadSample(page, '月次売上実績');
    await openChartSettings(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    result.M = await measureWorking(page, 390, 844);
    await page.screenshot({ path: path.join(outDir, 'M.png') });
    await ctx.close();
  }

  // H: ヒストグラム
  {
    const { ctx, page } = await newPage(browser, 1440, 900);
    await page.goto(url);
    await loadSample(page, '部品寸法測定');
    await openChartSettings(page);
    await page.evaluate(() => {
      const b = document.querySelector('[data-mode="hist"]');
      if (b) b.click();
    });
    await page.waitForTimeout(700);
    const hist = await page.evaluate(() => {
      const c = document.getElementById('chartCanvas');
      const r = c && c.offsetParent ? c.getBoundingClientRect() : null;
      return {
        canvasOk: !!(r && r.width > 100 && r.height > 100),
        binSelectExists: !!document.getElementById('binMethodSelect'),
        histVisible: !!(document.getElementById('histSettings') && document.getElementById('histSettings').offsetParent)
      };
    });
    result.H = hist;
    await page.screenshot({ path: path.join(outDir, 'H.png') });
    await ctx.close();
  }

  // 客観スコア
  const rAvg = (result.D.chartRatio + result.L.chartRatio) / 2;
  const sMain = mainAreaScore(rAvg);
  const sOverflow = lerp(result.D.overflow, 0, 600, 4, 0);
  const sControls = lerp(result.D.controlCount, 25, 60, 3, 0);
  const sMobileNoOverflow = result.M.hOverflow ? 0 : 3;
  const sMobileChart = result.M.chartVisibleH >= 150 ? 3 : (result.M.chartVisibleH > 0 ? 1.5 : 0);
  const opsVisible = Object.values(result.L.mainOpsVisible).filter(Boolean).length;
  const sLaptopOps = opsVisible / 4 * 2;
  const sHist = result.H.canvasOk && result.H.binSelectExists ? 2 : 0;
  result.objective = {
    chartRatioAvg: +rAvg.toFixed(3),
    mainArea: +sMain.toFixed(2),
    hierarchyObj: +(sOverflow + sControls).toFixed(2),
    hierarchyObjDetail: { overflowPx: Math.round(result.D.overflow), overflowPts: +sOverflow.toFixed(2), controls: result.D.controlCount, controlsPts: +sControls.toFixed(2) },
    generality: +(sMobileNoOverflow + sMobileChart + sLaptopOps + sHist).toFixed(2),
    generalityDetail: { mobileNoOverflow: sMobileNoOverflow, mobileChart: sMobileChart, mobileChartVisibleH: Math.round(result.M.chartVisibleH), laptopOps: +sLaptopOps.toFixed(2), laptopOpsVisible: result.L.mainOpsVisible, hist: sHist }
  };
  result.objective.total = +(result.objective.mainArea + result.objective.hierarchyObj + result.objective.generality).toFixed(2);
  fs.writeFileSync(path.join(VARIANTS_DIR, id, 'metrics.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.objective, null, 1));

  // コンタクトシート
  await contactSheet(browser, id, outDir);
  return result;
}

async function contactSheet(browser, id, outDir) {
  const label = (fs.existsSync(path.join(VARIANTS_DIR, id, 'label.txt')) ? fs.readFileSync(path.join(VARIANTS_DIR, id, 'label.txt'), 'utf8').trim() : id);
  const img = n => `file://${path.join(outDir, n)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#2b2b2b;font-family:system-ui,"Noto Sans JP",sans-serif;color:#eee}
    h1{font-size:22px;margin:10px 14px}
    .grid{display:grid;grid-template-columns:900px 900px 244px;gap:12px;padding:0 14px 14px}
    figure{margin:0} figcaption{font-size:13px;margin:4px 0;color:#bbb}
    img{display:block;border:1px solid #555;background:#fff}
    .d img{width:900px} .e img{width:900px} .m img{width:244px}
    .l img{width:900px} .h img{width:900px}
  </style></head><body>
  <h1>${label}</h1>
  <div class="grid">
    <figure class="d"><figcaption>D: 1440×900 作業画面</figcaption><img src="${img('D.png')}"></figure>
    <figure class="l"><figcaption>L: 1280×720</figcaption><img src="${img('L.png')}"></figure>
    <figure class="m" style="grid-row:span 2"><figcaption>M: 390×844</figcaption><img src="${img('M.png')}"></figure>
    <figure class="e"><figcaption>E: 初回画面</figcaption><img src="${img('E.png')}"></figure>
    <figure class="h"><figcaption>H: ヒストグラム</figcaption><img src="${img('H.png')}"></figure>
  </div></body></html>`;
  const sheetHtml = path.join(outDir, 'contact.html');
  fs.writeFileSync(sheetHtml, html);
  const { ctx, page } = await newPage(browser, 2100, 1300);
  await page.goto('file://' + sheetHtml);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(VARIANTS_DIR, id, 'contact.png'), fullPage: true });
  await ctx.close();
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) { console.error('variant id を指定してください'); process.exit(1); }
  const browser = await chromium.launch();
  const all = [];
  for (const id of ids) all.push(await evaluate(browser, id));
  await browser.close();
  console.log('\n--- 客観スコア一覧 ---');
  all.forEach(r => console.log(`${r.id.padEnd(14)} main=${r.objective.mainArea.toFixed(2).padStart(5)} (ratio ${r.objective.chartRatioAvg})  hier=${r.objective.hierarchyObj.toFixed(2).padStart(4)} (ovf ${r.objective.hierarchyObjDetail.overflowPx}px, ctl ${r.objective.hierarchyObjDetail.controls})  gen=${r.objective.generality.toFixed(2).padStart(5)}  objTotal=${r.objective.total.toFixed(2)}/32`));
})().catch(e => { console.error(e); process.exit(1); });
