/* 補助キャプチャ P: 詳細設定を開いた状態（1440×900）と、そのときグラフが隠されずに見えている割合
   使い方: NODE_PATH=/opt/node22/lib/node_modules node tools/uiux-eval/detail-open.js <variantId> ...
   （harness.js で一度生成した案が対象。"詳細設定" か "軸・範囲" と書かれたボタンを押して撮る） */
const { chromium } = require('playwright');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WORK_DIR = process.env.UIUX_WORK_DIR || path.join(os.tmpdir(), 'chartlab-uiux');
const APP_DIR = path.resolve(__dirname, '../..');
const ids = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const id of ids) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('chartlab-theme', 'light'); } catch (e) {}
      document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.toast{display:none!important}'; document.head.appendChild(s); });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log(id, 'PAGE ERROR', e.message));
    // "base" は現在のアプリそのもの
    await page.goto('file://' + (id === 'base' ? path.join(APP_DIR, 'index.html') : path.join(WORK_DIR, 'variants', id, 'index.html')));
    await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelectorAll('.sample-card')].find(x => x.textContent.includes('月次売上実績')).click());
    await page.waitForTimeout(700);
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(x => x.offsetParent && /詳細設定|軸・範囲/.test(x.textContent));
      if (btn) { btn.click(); return btn.textContent.trim(); }
      return null;
    });
    await page.waitForTimeout(600);
    const vis = await page.evaluate(() => {
      const c = document.getElementById('chartCanvas');
      const r = c.getBoundingClientRect();
      let seen = 0, total = 0;
      for (let x = r.left + 5; x < Math.min(r.right, innerWidth); x += 20) {
        for (let y = r.top + 5; y < Math.min(r.bottom, innerHeight); y += 20) {
          total++;
          const e = document.elementFromPoint(x, y);
          if (e === c || (e && e.closest && e.closest('#chartBody'))) seen++;
        }
      }
      const visibleArea = (Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      return { unoccludedRatio: +((seen / Math.max(1, total)) * visibleArea / (innerWidth * innerHeight)).toFixed(3) };
    });
    fs.mkdirSync(path.join(WORK_DIR, 'variants', id, 'shots'), { recursive: true });
    await page.screenshot({ path: path.join(WORK_DIR, 'variants', id, 'shots', 'P.png') });
    console.log(id.padEnd(8), 'clicked=', clicked, ' 詳細を開いた状態で隠されずに見えるグラフ面積比=', vis.unoccludedRatio);
    await ctx.close();
  }
  await b.close();
})();
