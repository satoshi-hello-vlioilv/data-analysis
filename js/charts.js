/**
 * チャート層 — グラフモデルの構築と Chart.js への描画
 *
 * 描画の原則（認知負荷を下げるための一貫したビジュアル言語）:
 * - 軸は常に1本（二重Y軸は錯誤相関を生むため作らない）
 * - 細いマーク: 棒は最大24px・角丸はデータ端のみ、線は2px、点は表面色のリング付き
 * - グリッドは表面から一段ずらしたヘアライン実線、目盛りは控えめに
 * - 凡例は2系列以上で必ず表示、1系列ではタイトルが系列名を兼ねる
 * - ツールチップはX位置に吸着し、その位置の全系列を一度に読み上げる
 */
const Charts = (() => {
  'use strict';

  const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif';

  // ---------------------------------------------------------------
  // 数値フォーマット
  // ---------------------------------------------------------------

  /** 桁に応じて小数点以下を調整した表示用文字列 */
  function fmt(v) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v !== 'number') return String(v);
    const abs = Math.abs(v);
    let digits;
    if (Number.isInteger(v)) digits = 0;
    else if (abs >= 1000) digits = 0;
    else if (abs >= 100) digits = 1;
    else if (abs >= 1) digits = 2;
    else digits = 4;
    return v.toLocaleString('ja-JP', { maximumFractionDigits: digits });
  }

  // ---------------------------------------------------------------
  // 統計
  // ---------------------------------------------------------------

  /** 基本統計量（歪度・尖度は標本ベース、尖度は超過尖度） */
  function statistics(values) {
    const nums = values.filter(v => typeof v === 'number' && isFinite(v));
    const n = nums.length;
    if (n === 0) return null;
    const mean = nums.reduce((a, b) => a + b, 0) / n;
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const variance = n > 1 ? nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1) : 0;
    const std = Math.sqrt(variance);
    let skew = 0, kurt = 0;
    if (std > 0 && n > 2) {
      const m3 = nums.reduce((a, b) => a + Math.pow(b - mean, 3), 0) / n;
      const m2 = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      skew = m3 / Math.pow(m2, 1.5);
      const m4 = nums.reduce((a, b) => a + Math.pow(b - mean, 4), 0) / n;
      kurt = m4 / (m2 * m2) - 3;
    }
    return { n, mean, median, std, min: sorted[0], max: sorted[n - 1], skew, kurt };
  }

  /** 分布の形の言語化 */
  function distributionLabel(stats) {
    if (!stats || stats.n < 8) return 'データ数が少なく判定できません';
    const s = stats.skew, k = stats.kurt;
    if (Math.abs(s) < 0.5 && Math.abs(k) < 1) return '正規分布に近い形';
    if (s >= 1) return '右（大きい側）に裾が長い分布';
    if (s <= -1) return '左（小さい側）に裾が長い分布';
    if (k >= 1.5) return '中心が尖った分布（外れ値に注意）';
    if (k <= -1.2) return '平坦・二山の可能性がある分布';
    if (s > 0) return 'やや右に裾が長い分布';
    return 'やや左に裾が長い分布';
  }

  // ---------------------------------------------------------------
  // ヒストグラムの階級計算
  // ---------------------------------------------------------------

  function binCount(values, method, customCount) {
    const n = values.length;
    if (n === 0) return 10;
    if (method === 'custom') return Math.max(2, Math.min(200, customCount || 10));
    if (method === 'scott' || method === 'freedman') {
      const sorted = values.slice().sort((a, b) => a - b);
      const range = sorted[n - 1] - sorted[0];
      if (range <= 0) return 1;
      let h;
      if (method === 'scott') {
        const mean = values.reduce((a, b) => a + b, 0) / n;
        const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n - 1));
        h = 3.49 * std * Math.pow(n, -1 / 3);
      } else {
        const q1 = sorted[Math.floor(n * 0.25)];
        const q3 = sorted[Math.floor(n * 0.75)];
        h = 2 * (q3 - q1) * Math.pow(n, -1 / 3);
      }
      if (!h || h <= 0) return Math.ceil(Math.log2(n) + 1);
      return Math.max(2, Math.min(200, Math.ceil(range / h)));
    }
    // スタージェスの公式（既定）
    return Math.max(2, Math.min(200, Math.ceil(Math.log2(n) + 1)));
  }

  /**
   * 全系列の値域を共有した階級を計算。
   * rangeOverride が指定されている場合、階級数・階級幅の算出には元データ全体を
   * 使いつつ、実際に使う値域（min/max）だけを差し替える（表示範囲の絞り込み）。
   */
  function computeBins(allValues, method, customCount, rangeOverride) {
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    if (min === max) { min -= 0.5; max += 0.5; }
    const count = binCount(allValues, method, customCount);
    if (rangeOverride && typeof rangeOverride.min === 'number' && typeof rangeOverride.max === 'number' && rangeOverride.max > rangeOverride.min) {
      min = rangeOverride.min;
      max = rangeOverride.max;
    }
    const width = (max - min) / count;
    const edges = [];
    for (let i = 0; i <= count; i++) edges.push(min + width * i);
    return { min, max, count, width, edges };
  }

  function histCounts(values, bins) {
    const counts = new Array(bins.count).fill(0);
    values.forEach(v => {
      let idx = Math.floor((v - bins.min) / bins.width);
      if (idx >= bins.count) idx = bins.count - 1; // 最大値は最後の階級に含める
      if (idx >= 0 && idx < bins.count) counts[idx]++;
    });
    return counts;
  }

  /** 正規分布の期待度数カーブ（階級中心で評価） */
  function normalCurve(stats, bins) {
    if (!stats || stats.std <= 0) return null;
    const pdf = x => Math.exp(-0.5 * Math.pow((x - stats.mean) / stats.std, 2)) / (stats.std * Math.sqrt(2 * Math.PI));
    return bins.edges.slice(0, -1).map((e, i) => {
      const center = e + bins.width / 2;
      return stats.n * bins.width * pdf(center);
    });
  }

  // ---------------------------------------------------------------
  // グラフモデルの構築（クエリ結果 → 描画可能なモデル）
  // ---------------------------------------------------------------

  function sortKeyFn(type) {
    if (type === 'number') return v => (typeof v === 'number' ? v : DataLayer.toNumber(v));
    if (type === 'date') return v => DataLayer.parseDate(v);
    return null; // 文字列は元の順序を尊重
  }

  /** 系列値の最小・最大（複数系列にまたがる） */
  function extentOf(seriesValues) {
    const nums = seriesValues.flat().filter(v => typeof v === 'number' && isFinite(v));
    if (nums.length === 0) return null;
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }

  /** XYモード: フィルタ済み行 → ラベル・系列値 */
  function buildXYModel(state, rows, columns) {
    const q = state.query;
    const chart = state.chart;
    const xy = chart.xy || {};
    const typeOf = {};
    columns.forEach(c => { typeOf[c.name] = c.type; });

    const xName = q.groupBy || chart.x || null;
    const xType = xName ? (typeOf[xName] || 'string') : 'number';

    let entries; // [{key, values: {seriesIndex: number|null}}]

    if (q.groupBy) {
      const groups = QueryEngine.groupRows(rows, q.groupBy);
      entries = [...groups.entries()].map(([key, groupRows]) => ({
        key,
        values: chart.series.map(s => QueryEngine.aggregate(groupRows.map(r => r[s.column]), s.agg || 'sum'))
      }));
    } else {
      entries = rows.map((row, i) => ({
        key: xName ? row[xName] : i + 1,
        values: chart.series.map(s => (typeof row[s.column] === 'number' ? row[s.column] : null))
      }));
    }

    // 並び替え
    const keyFn = sortKeyFn(xType);
    const sortMode = q.sort || 'auto';
    if (sortMode === 'auto' || sortMode === 'x-desc') {
      if (keyFn) {
        entries.sort((a, b) => {
          const ka = keyFn(a.key), kb = keyFn(b.key);
          if (ka === null || ka === undefined) return 1;
          if (kb === null || kb === undefined) return -1;
          return ka - kb;
        });
      }
      if (sortMode === 'x-desc') entries.reverse();
    } else if (sortMode === 'value-desc' || sortMode === 'value-asc') {
      entries.sort((a, b) => {
        const va = a.values[0], vb = b.values[0];
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        return sortMode === 'value-desc' ? vb - va : va - vb;
      });
    }

    // 行数制限
    if (q.limit && q.limit > 0) entries = entries.slice(0, q.limit);

    // 散布図専用の線形軸（X列が数値で全系列が散布のとき）
    const linear = chart.series.length > 0 &&
      chart.series.every(s => s.type === 'scatter') &&
      xType === 'number' && !q.groupBy;

    // 表示範囲（カテゴリ軸のインデックス絞り込み）— スライダーの基準となる全件ラベルは保持
    const fullLabels = entries.map(e => e.key === null || e.key === undefined ? '（空欄）' : String(e.key));
    const fullCount = entries.length;
    let indexStart = 0;
    let indexEnd = Math.max(0, fullCount - 1);
    if (!linear && xy.xIndexRange && (xy.xIndexRange.start !== null || xy.xIndexRange.end !== null)) {
      indexStart = Math.max(0, Math.min(xy.xIndexRange.start ?? 0, fullCount - 1));
      indexEnd = Math.max(indexStart, Math.min(xy.xIndexRange.end ?? (fullCount - 1), fullCount - 1));
      entries = entries.slice(indexStart, indexEnd + 1);
    }

    const labels = fullLabels.slice(indexStart, indexEnd + 1);

    const toNum = k => {
      const n = typeof k === 'number' ? k : DataLayer.toNumber(k);
      return n === null || !isFinite(n) ? null : n;
    };

    const seriesModels = chart.series.map((s, i) => {
      const agg = q.groupBy ? QueryEngine.aggById(s.agg || 'sum') : null;
      return {
        id: s.id,
        slot: s.slot,
        type: s.type,
        label: s.column + (agg ? '（' + agg.label + '）' : ''),
        values: entries.map(e => e.values[i]),
        points: linear
          ? entries.map(e => ({ x: toNum(e.key), y: e.values[i] })).filter(p => p.x !== null && p.y !== null)
          : null
      };
    });

    const yExtent = extentOf(seriesModels.map(s => s.values));
    const xExtent = linear ? extentOf(seriesModels.map(s => (s.points || []).map(p => p.x))) : null;

    return {
      mode: 'xy',
      linear,
      labels,
      series: seriesModels,
      xTitle: (xy.xLabel && xy.xLabel.trim()) || xName || '行番号',
      yTitle: (xy.yLabel && xy.yLabel.trim()) || (chart.series.length === 1 ? seriesModels[0].label : ''),
      stacked: !!chart.stacked,
      entries,
      fullLabels,
      fullLabelCount: fullCount,
      xIndexRange: { start: indexStart, end: indexEnd },
      xExtent,
      yExtent
    };
  }

  /**
   * 基準線（UCL/LCLなど）がデータ範囲の外にあるとき、階級幅を保ったまま
   * 空の階級を前後に足して基準線が見える範囲まで広げる（管理図用途への配慮）
   */
  function extendBinsForRefLines(bins, refLines) {
    const refs = (refLines || [])
      .map(r => r.value)
      .filter(v => typeof v === 'number' && isFinite(v));
    if (refs.length === 0 || bins.width <= 0) return bins;
    const MAX_EXTRA = 30; // 遠すぎる基準線のために無限に階級を増やさない
    const lo = Math.min(...refs);
    const hi = Math.max(...refs);
    const before = lo < bins.min ? Math.min(MAX_EXTRA, Math.ceil((bins.min - lo) / bins.width + 0.25)) : 0;
    const after = hi > bins.max ? Math.min(MAX_EXTRA, Math.ceil((hi - bins.max) / bins.width + 0.25)) : 0;
    if (before === 0 && after === 0) return bins;
    const min = bins.min - before * bins.width;
    const count = bins.count + before + after;
    const edges = [];
    for (let i = 0; i <= count; i++) edges.push(min + bins.width * i);
    return { min, max: edges[count], count, width: bins.width, edges };
  }

  /** ヒストグラムモード */
  function buildHistModel(state, rows) {
    const chart = state.chart;
    const hist = chart.hist || {};
    const seriesValues = chart.series.map(s =>
      rows.map(r => r[s.column]).filter(v => typeof v === 'number' && isFinite(v))
    );
    const all = seriesValues.flat();
    if (all.length === 0) return null;
    const dataExtent = extentOf([all]);

    const rangeOverride = hist.valueRange && (typeof hist.valueRange.min === 'number' || typeof hist.valueRange.max === 'number')
      ? {
          min: typeof hist.valueRange.min === 'number' ? hist.valueRange.min : dataExtent.min,
          max: typeof hist.valueRange.max === 'number' ? hist.valueRange.max : dataExtent.max
        }
      : null;

    const bins = extendBinsForRefLines(
      computeBins(all, chart.bins.method, chart.bins.count, rangeOverride),
      state.refLines
    );
    const labels = bins.edges.slice(0, -1).map((e, i) =>
      fmt(e) + '–' + fmt(bins.edges[i + 1])
    );

    const seriesModels = chart.series.map((s, i) => {
      const stats = statistics(seriesValues[i]);
      return {
        id: s.id,
        slot: s.slot,
        label: s.column,
        counts: histCounts(seriesValues[i], bins),
        stats,
        curve: chart.normalCurve ? normalCurve(stats, bins) : null
      };
    });

    const xTitle = (hist.xLabel && hist.xLabel.trim()) || (chart.series.length === 1 ? seriesModels[0].label : '値の階級');
    const yTitle = (hist.yLabel && hist.yLabel.trim()) || '度数';

    return { mode: 'hist', bins, labels, series: seriesModels, xTitle, yTitle, dataExtent };
  }

  // ---------------------------------------------------------------
  // カスタムプラグイン
  // ---------------------------------------------------------------

  // 十字カーソル: 折れ線・面グラフでX位置を示すヘアライン
  const crosshairPlugin = {
    id: 'crosshair',
    afterDraw(chart) {
      const opts = chart.options.plugins.crosshair;
      if (!opts || !opts.enabled) return;
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || active.length === 0) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = opts.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  // 基準線: XYグラフでは水平線（値軸=Y）、ヒストグラムでは垂直線（値軸=X）
  const refLinesPlugin = {
    id: 'refLines',
    afterDatasetsDraw(chart) {
      const opts = chart.options.plugins.refLines;
      if (!opts || !opts.lines || opts.lines.length === 0) return;
      const ctx = chart.ctx;
      const area = chart.chartArea;
      ctx.save();
      ctx.font = '11px ' + FONT_STACK;
      opts.lines.forEach(line => {
        const v = line.value;
        if (v === null || v === undefined || !isFinite(v)) return;
        ctx.strokeStyle = opts.color;
        ctx.fillStyle = opts.textColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        if (opts.orientation === 'v') {
          // 値 → カテゴリ軸（階級）上の位置へ変換
          const { min, max } = opts.domain;
          if (v < min || v > max || max <= min) return;
          const x = area.left + ((v - min) / (max - min)) * (area.right - area.left);
          ctx.beginPath();
          ctx.moveTo(x + 0.5, area.top);
          ctx.lineTo(x + 0.5, area.bottom);
          ctx.stroke();
          const text = line.label + ' ' + fmt(v);
          const w = ctx.measureText(text).width;
          let tx = x + 5;
          if (tx + w > area.right) tx = x - w - 5;
          ctx.setLineDash([]);
          ctx.fillStyle = opts.badgeColor;
          ctx.fillRect(tx - 3, area.top + 2, w + 6, 16);
          ctx.fillStyle = opts.textColor;
          ctx.fillText(text, tx, area.top + 14);
        } else {
          const scale = chart.scales.y;
          if (!scale || v < scale.min || v > scale.max) return;
          const y = scale.getPixelForValue(v);
          ctx.beginPath();
          ctx.moveTo(area.left, y + 0.5);
          ctx.lineTo(area.right, y + 0.5);
          ctx.stroke();
          const text = line.label + ' ' + fmt(v);
          const w = ctx.measureText(text).width;
          const ty = y - 6 < area.top + 12 ? y + 14 : y - 6;
          ctx.setLineDash([]);
          ctx.fillStyle = opts.badgeColor;
          ctx.fillRect(area.right - w - 9, ty - 12, w + 6, 16);
          ctx.fillStyle = opts.textColor;
          ctx.fillText(text, area.right - w - 6, ty);
        }
      });
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------
  // Chart.js への変換・描画
  // ---------------------------------------------------------------

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isFiniteNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /** 系列モデル → Chart.js dataset */
  function toDataset(sm, model, theme, index, barMeta) {
    const t = Palette.tokens(theme);
    const color = Palette.seriesColor(theme, sm.slot);
    const base = { label: sm.label };

    if (model.mode === 'hist') {
      return {
        ...base,
        type: 'bar',
        data: sm.counts,
        backgroundColor: color,
        borderRadius: 3,
        borderSkipped: 'start',
        categoryPercentage: model.series.length > 1 ? 0.85 : 0.97,
        barPercentage: model.series.length > 1 ? 0.9 : 1.0,
        order: 2
      };
    }

    switch (sm.type) {
      case 'line':
      case 'area': {
        const isArea = sm.type === 'area';
        return {
          ...base,
          type: 'line',
          data: sm.values,
          borderColor: color,
          backgroundColor: isArea ? Palette.withAlpha(color, 0.12) : color,
          borderWidth: 2,
          cubicInterpolationMode: 'monotone',
          fill: isArea ? 'origin' : false,
          pointRadius: model.labels.length > 60 ? 0 : 3.5,
          pointBackgroundColor: color,
          pointBorderColor: t.surface,
          pointBorderWidth: 2,
          pointHoverRadius: 5,
          pointHitRadius: 10,
          spanGaps: true,
          order: 1,
          stack: model.stacked && isArea ? 'areas' : 'solo-' + index
        };
      }
      case 'scatter':
        return {
          ...base,
          type: 'scatter',
          data: sm.points || sm.values,
          backgroundColor: color,
          borderColor: t.surface,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHitRadius: 14,
          order: 0,
          stack: 'solo-' + index
        };
      case 'bar':
      default: {
        const stacked = model.stacked;
        const isTopOfStack = stacked && index === barMeta.lastBarIndex;
        return {
          ...base,
          type: 'bar',
          data: sm.values,
          backgroundColor: color,
          borderColor: stacked ? t.surface : undefined,
          borderWidth: stacked ? 1 : 0,
          borderSkipped: stacked ? false : 'start',
          borderRadius: stacked ? (isTopOfStack ? 4 : 0) : 4,
          maxBarThickness: 24,
          categoryPercentage: 0.72,
          barPercentage: 0.9,
          order: 2,
          stack: stacked ? 'bars' : undefined
        };
      }
    }
  }

  /** ヒストグラムの正規分布カーブ dataset */
  function curveDataset(sm, theme) {
    const color = Palette.seriesColor(theme, sm.slot);
    return {
      label: sm.label + '（正規分布）',
      type: 'line',
      data: sm.curve,
      borderColor: color,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHitRadius: 0,
      tension: 0.4,
      fill: false,
      order: 0,
      _isCurve: true
    };
  }

  /**
   * モデルを canvas に描画して Chart インスタンスを返す
   * viewOptions: { refLines: [{label,value}], xRange: {min,max}, yRange: {min,max} }
   *   xRange は線形X軸（散布図）のみに適用。カテゴリ軸の絞り込みはモデル構築時に
   *   labels/values を既にトリムしているため、ここでは何もしない。
   * theme: 'light' | 'dark'
   */
  function render(canvas, model, theme, viewOptions, existingChart) {
    const t = Palette.tokens(theme);
    const opts = viewOptions || {};
    const refLines = opts.refLines || [];
    const xRange = opts.xRange || {};
    const yRange = opts.yRange || {};
    if (existingChart) existingChart.destroy();

    Chart.defaults.font.family = FONT_STACK;
    Chart.defaults.font.size = 12;

    const hasBarLike = model.mode === 'hist' || model.series.some(s => s.type === 'bar' || s.type === 'area');
    const hasLineLike = model.mode !== 'hist' && model.series.some(s => s.type === 'line' || s.type === 'area');
    const barIndices = model.mode === 'hist' ? [] : model.series.map((s, i) => s.type === 'bar' ? i : -1).filter(i => i >= 0);
    const barMeta = { lastBarIndex: barIndices.length ? barIndices[barIndices.length - 1] : -1 };

    const datasets = model.series.map((sm, i) => toDataset(sm, model, theme, i, barMeta));
    if (model.mode === 'hist') {
      model.series.forEach(sm => { if (sm.curve) datasets.push(curveDataset(sm, theme)); });
    }

    const realSeriesCount = model.series.length;
    const linear = model.mode === 'xy' && model.linear;

    const config = {
      type: 'bar',
      data: { labels: linear ? undefined : model.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 300, easing: 'easeOutQuart' },
        interaction: linear
          ? { mode: 'nearest', intersect: false }
          : { mode: 'index', intersect: false },
        layout: { padding: { top: 8, right: 8 } },
        plugins: {
          legend: {
            display: realSeriesCount >= 2,
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              boxWidth: 9,
              boxHeight: 9,
              padding: 14,
              color: t.textSecondary,
              filter: item => !(datasets[item.datasetIndex] && datasets[item.datasetIndex]._isCurve),
              // 描画順（order）ではなく系列の定義順で凡例を並べる
              sort: (a, b) => a.datasetIndex - b.datasetIndex
            }
          },
          tooltip: {
            backgroundColor: theme === 'dark' ? '#262624' : '#ffffff',
            titleColor: t.textPrimary,
            bodyColor: t.textSecondary,
            borderColor: t.grid,
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            callbacks: {
              title(items) {
                if (!items.length) return '';
                if (linear) return model.xTitle + ': ' + fmt(items[0].parsed.x);
                return String(items[0].label);
              },
              label(ctx) {
                const v = linear ? ctx.parsed.y : ctx.parsed.y;
                return ' ' + ctx.dataset.label + ': ' + fmt(v);
              }
            }
          },
          crosshair: { enabled: hasLineLike && !linear, color: t.axis },
          refLines: {
            lines: refLines || [],
            orientation: model.mode === 'hist' ? 'v' : 'h',
            domain: model.mode === 'hist' ? { min: model.bins.min, max: model.bins.max } : null,
            color: t.textSecondary,
            textColor: t.textSecondary,
            badgeColor: Palette.withAlpha(theme === 'dark' ? '#1a1a19' : '#fcfcfb', 0.85)
          }
        },
        scales: {
          x: {
            type: linear ? 'linear' : 'category',
            stacked: model.mode === 'xy' && model.stacked,
            grid: { display: linear, color: t.grid, drawTicks: false },
            border: { color: t.axis },
            min: linear && isFiniteNum(xRange.min) ? xRange.min : undefined,
            max: linear && isFiniteNum(xRange.max) ? xRange.max : undefined,
            // カテゴリ軸に callback を渡すとデフォルトのラベル解決が壊れるため線形軸のみ
            ticks: Object.assign(
              {
                color: t.muted,
                maxRotation: model.mode === 'hist' ? 45 : 40,
                autoSkip: true,
                autoSkipPadding: 8
              },
              linear ? { callback: v => fmt(v) } : {}
            ),
            title: {
              display: !!model.xTitle,
              text: model.xTitle,
              color: t.muted,
              font: { size: 11 }
            }
          },
          y: {
            stacked: model.mode === 'xy' && model.stacked,
            beginAtZero: hasBarLike && !isFiniteNum(yRange.min),
            min: isFiniteNum(yRange.min) ? yRange.min : undefined,
            max: isFiniteNum(yRange.max) ? yRange.max : undefined,
            grid: { color: t.grid, drawTicks: false },
            border: { display: false },
            ticks: { color: t.muted, precision: model.mode === 'hist' ? 0 : undefined, callback: v => fmt(v) },
            title: {
              display: !!model.yTitle,
              text: model.yTitle || '',
              color: t.muted,
              font: { size: 11 }
            }
          }
        }
      },
      plugins: [crosshairPlugin, refLinesPlugin]
    };

    return new Chart(canvas.getContext('2d'), config);
  }

  // ---------------------------------------------------------------
  // エクスポート
  // ---------------------------------------------------------------

  /** チャートを背景色付きPNGとしてダウンロード */
  function exportPNG(chart, theme, filename) {
    const t = Palette.tokens(theme);
    const src = chart.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = filename;
    a.click();
  }

  return {
    fmt,
    statistics,
    distributionLabel,
    buildXYModel,
    buildHistModel,
    computeBins,
    render,
    exportPNG
  };
})();
