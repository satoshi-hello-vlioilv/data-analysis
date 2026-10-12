/**
 * 主観採点（scores-<round>.json）と客観指標（variants/<id>/metrics.json）を合算して順位表を出す。
 * 使い方: node tools/uiux-eval/score.js <round>   例: node tools/uiux-eval/score.js r1
 *   作業ディレクトリ（UIUX_WORK_DIR）の scores-<round>.json に主観点と根拠を書いておく:
 *   { "<variantId>": { "label", "hierarchy"(/8), "clarity", "intuitive", "usability", "visual"(各/15), "note" } }
 * 合計は小数第1位で比較し、同点は「客観指標の合計」→「使いやすさ」の順で決める（CLAUDE.md の規則）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const WORK_DIR = process.env.UIUX_WORK_DIR || path.join(os.tmpdir(), 'chartlab-uiux');
const round = process.argv[2];
const subj = JSON.parse(fs.readFileSync(path.join(WORK_DIR, `scores-${round}.json`), 'utf8'));

const rows = Object.entries(subj).map(([id, s]) => {
  const m = JSON.parse(fs.readFileSync(path.join(WORK_DIR, 'variants', id, 'metrics.json'), 'utf8')).objective;
  const hier = m.hierarchyObj + s.hierarchy;
  const total = m.mainArea + hier + s.clarity + s.intuitive + s.usability + s.visual + m.generality;
  return {
    id, label: s.label,
    main: m.mainArea, hier, clarity: s.clarity, intuitive: s.intuitive, usability: s.usability, visual: s.visual, gen: m.generality,
    obj: m.total, total: +total.toFixed(1), note: s.note
  };
}).sort((a, b) => b.total - a.total || b.obj - a.obj || b.usability - a.usability);

const f = v => (Math.round(v * 10) / 10).toFixed(1);
let md = '| 順位 | 案 | メイン領域 /15 | 階層 /15 | わかりやすさ /15 | 直感性 /15 | 使いやすさ /15 | 視覚表現 /15 | 汎用性 /10 | **合計 /100** |\n|---|---|---|---|---|---|---|---|---|---|\n';
rows.forEach((r, i) => {
  md += `| ${i + 1} | ${r.label} | ${f(r.main)} | ${f(r.hier)} | ${f(r.clarity)} | ${f(r.intuitive)} | ${f(r.usability)} | ${f(r.visual)} | ${f(r.gen)} | **${f(r.total)}** |\n`;
});
md += '\n';
rows.forEach(r => { md += `- **${r.label}**: ${r.note}\n`; });
fs.writeFileSync(path.join(WORK_DIR, `ranking-${round}.md`), md);
console.log(md);
const top = rows.filter(r => r.id !== 'base');
console.log(`1位 ${top[0].label} ${top[0].total} / 2位 ${top[1].label} ${top[1].total} / 差 ${(top[0].total - top[1].total).toFixed(1)}`);
