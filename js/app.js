/**
 * アプリケーション層 — 状態管理と UI の結線
 *
 * 情報アーキテクチャ:
 *   「1. データ → 2. データ処理（クエリ） → 3. グラフ」の3ステップを
 *   左パネルに直列に配置し、段階的開示（データ読込後に後続ステップを表示）で
 *   認知負荷を抑えます。すべての操作は即時に右のグラフ・テーブル・統計・
 *   クエリプレビューへ反映され、操作と結果の対応が常に見える状態を保ちます。
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------

  const state = {
    raw: null, // { rows, columns, meta }
    query: { filters: [], groupBy: '', sort: 'auto', limit: null },
    chart: {
      mode: 'xy',            // 'xy' | 'hist'
      x: '',                 // X軸の列（'' = 行番号）
      series: [],            // [{ id, column, agg, type, slot }]
      stacked: false,
      bins: { method: 'sturges', count: 10 },
      normalCurve: false
    },
    refLines: [],            // [{ id, label, value }]
    theme: 'light',
    view: 'chart',
    chartInstance: null,
    lastModel: null,
    lastTable: null           // { columns: [names], rows: [[...]] } — グラフの等価テーブル
  };

  let uidCounter = 0;
  const uid = () => 's' + (++uidCounter);

  // ---------------------------------------------------------------
  // DOM 参照
  // ---------------------------------------------------------------

  const el = {
    themeToggle: $('themeToggle'),
    sampleGrid: $('sampleGrid'),
    emptySampleGrid: $('emptySampleGrid'),
    dropArea: $('dropArea'),
    fileInput: $('fileInput'),
    fileInfo: $('fileInfo'),
    fileInfoName: $('fileInfoName'),
    fileInfoDetail: $('fileInfoDetail'),
    removeFileBtn: $('removeFileBtn'),
    columnSummary: $('columnSummary'),
    columnChips: $('columnChips'),
    stepQuery: $('stepQuery'),
    stepChart: $('stepChart'),
    filterList: $('filterList'),
    addFilterBtn: $('addFilterBtn'),
    groupBySelect: $('groupBySelect'),
    sortSelect: $('sortSelect'),
    limitInput: $('limitInput'),
    queryCode: $('queryCode'),
    copyQueryBtn: $('copyQueryBtn'),
    modeSegment: $('modeSegment'),
    xySettings: $('xySettings'),
    histSettings: $('histSettings'),
    xSelect: $('xSelect'),
    xHint: $('xHint'),
    seriesList: $('seriesList'),
    addSeriesBtn: $('addSeriesBtn'),
    stackedToggle: $('stackedToggle'),
    histSeriesList: $('histSeriesList'),
    addHistSeriesBtn: $('addHistSeriesBtn'),
    binMethodSelect: $('binMethodSelect'),
    binCountField: $('binCountField'),
    binCountRange: $('binCountRange'),
    binCountOut: $('binCountOut'),
    normalCurveToggle: $('normalCurveToggle'),
    refLineList: $('refLineList'),
    quickRefs: $('quickRefs'),
    contentToolbar: $('contentToolbar'),
    emptyState: $('emptyState'),
    chartCard: $('chartCard'),
    chartTitle: $('chartTitle'),
    chartMeta: $('chartMeta'),
    chartCanvas: $('chartCanvas'),
    chartNotice: $('chartNotice'),
    tableCard: $('tableCard'),
    tableNote: $('tableNote'),
    dataTable: $('dataTable'),
    statsCard: $('statsCard'),
    statsNote: $('statsNote'),
    statsContent: $('statsContent'),
    downloadPngBtn: $('downloadPngBtn'),
    exportCsvBtn: $('exportCsvBtn'),
    toast: $('toast'),
    toastIcon: $('toastIcon'),
    toastMessage: $('toastMessage')
  };

  // ---------------------------------------------------------------
  // 汎用ヘルパー
  // ---------------------------------------------------------------

  const TYPE_LABELS = { number: '数値', date: '日付', string: 'テキスト' };
  const CHART_TYPES = [
    { id: 'bar', label: '棒' },
    { id: 'line', label: '折れ線' },
    { id: 'area', label: '面' },
    { id: 'scatter', label: '散布' }
  ];

  function numericColumns() {
    return state.raw ? state.raw.columns.filter(c => c.type === 'number') : [];
  }

  function columnType(name) {
    const c = state.raw && state.raw.columns.find(c => c.name === name);
    return c ? c.type : 'string';
  }

  /** 未使用の最小スロット（色はエンティティに追従し、削除後も再割当しない） */
  function nextFreeSlot() {
    const used = new Set(state.chart.series.map(s => s.slot));
    for (let i = 0; i < Palette.MAX_SERIES; i++) {
      if (!used.has(i)) return i;
    }
    return 0;
  }

  function makeOption(value, label) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  let toastTimer = null;
  function showToast(type, message) {
    const icons = { success: '✓', info: 'i', warning: '!', error: '×' };
    el.toast.hidden = false;
    el.toast.dataset.type = type;
    el.toastIcon.textContent = icons[type] || 'i';
    el.toastMessage.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  let updateTimer = null;
  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 60);
  }

  // ---------------------------------------------------------------
  // テーマ
  // ---------------------------------------------------------------

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('gcs-theme', theme); } catch (e) { /* プライベートモード等 */ }
    renderSeriesList();
    renderHistSeriesList();
    scheduleUpdate();
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('gcs-theme'); } catch (e) { /* noop */ }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = state.theme;
  }

  // ---------------------------------------------------------------
  // データ読み込み
  // ---------------------------------------------------------------

  function renderSampleGrids() {
    [el.sampleGrid, el.emptySampleGrid].forEach(grid => {
      if (!grid) return;
      grid.textContent = '';
      DataLayer.SAMPLES.forEach(sample => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sample-card';
        const name = document.createElement('strong');
        name.textContent = sample.name;
        const desc = document.createElement('small');
        desc.textContent = sample.desc;
        btn.append(name, desc);
        btn.addEventListener('click', () => {
          loadTable(sample.build());
          showToast('success', 'サンプル「' + sample.name + '」を読み込みました');
        });
        grid.appendChild(btn);
      });
    });
  }

  function handleFile(file) {
    if (!file) return;
    DataLayer.parseFile(file)
      .then(table => {
        loadTable(table);
        const parts = [table.rows.length.toLocaleString('ja-JP') + '行 × ' + table.columns.length + '列を読み込みました'];
        parts.push(table.meta.hasHeader ? 'ヘッダー行を検出' : '列名を自動生成');
        if (table.meta.skippedRows > 0) parts.push('前置き' + table.meta.skippedRows + '行をスキップ');
        showToast('success', parts.join('・'));
      })
      .catch(err => {
        showToast('error', err.message || 'ファイルの読み込みに失敗しました');
      });
  }

  /** テーブルを取り込み、賢い初期設定でグラフを立ち上げる */
  function loadTable(table) {
    // 前のデータセットのフィルタ候補リストを掃除（同名列との混同を防ぐ）
    document.querySelectorAll('datalist[id^="dl-"]').forEach(d => d.remove());
    state.raw = table;
    state.query = { filters: [], groupBy: '', sort: 'auto', limit: null };
    state.refLines = [];
    state.chart.mode = 'xy';
    state.chart.stacked = false;
    state.chart.normalCurve = false;
    state.chart.bins = { method: 'sturges', count: 10 };
    state.chart.series = [];

    smartDefaults();

    // UI再構築
    el.fileInfo.hidden = false;
    el.fileInfoName.textContent = table.meta.sourceName;
    el.fileInfoDetail.textContent = table.rows.length.toLocaleString('ja-JP') + '行 × ' + table.columns.length + '列';
    renderColumnChips();
    el.stepQuery.hidden = false;
    el.stepChart.hidden = false;
    el.contentToolbar.hidden = false;
    el.emptyState.hidden = true;

    populateXSelect();
    populateGroupBySelect();
    el.sortSelect.value = state.query.sort;
    el.limitInput.value = '';
    el.stackedToggle.checked = false;
    el.normalCurveToggle.checked = false;
    el.binMethodSelect.value = 'sturges';
    el.binCountField.hidden = true;
    setMode('xy', true);
    renderFilters();
    renderSeriesList();
    renderHistSeriesList();
    renderRefLines();
    switchView('chart');
    scheduleUpdate();
  }

  /**
   * データの形から初期グラフを推定:
   * X軸は日付 > テキスト > 行番号の優先で選び、X値が重複するデータは
   * 自動的にグループ化＋合計に設定して、最初から意味の通るグラフを出す。
   */
  function smartDefaults() {
    const cols = state.raw.columns;
    const nums = cols.filter(c => c.type === 'number');
    const dates = cols.filter(c => c.type === 'date');
    const cats = cols.filter(c => c.type === 'string');

    const x = dates[0] ? dates[0].name : (cats[0] ? cats[0].name : '');
    state.chart.x = x;

    if (nums.length > 0) {
      const type = dates[0] ? 'line' : 'bar';
      state.chart.series = [{ id: uid(), column: nums[0].name, agg: 'sum', type, slot: 0 }];
    }

    // X値が重複しているなら集計しないと意味を成さない → 自動でグループ化
    if (x && state.raw.rows.length > 0) {
      const unique = new Set(state.raw.rows.map(r => String(r[x]))).size;
      if (unique > 0 && state.raw.rows.length / unique >= 1.5 && unique <= 500) {
        state.query.groupBy = x;
      }
    }
  }

  function clearData() {
    state.raw = null;
    state.chart.series = [];
    state.refLines = [];
    if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }
    el.fileInfo.hidden = true;
    el.columnSummary.hidden = true;
    el.stepQuery.hidden = true;
    el.stepChart.hidden = true;
    el.contentToolbar.hidden = true;
    el.chartCard.hidden = true;
    el.tableCard.hidden = true;
    el.statsCard.hidden = true;
    el.emptyState.hidden = false;
    el.fileInput.value = '';
  }

  function renderColumnChips() {
    el.columnSummary.hidden = false;
    el.columnChips.textContent = '';
    state.raw.columns.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'column-chip type-' + c.type;
      const mark = document.createElement('em');
      mark.textContent = TYPE_LABELS[c.type];
      const name = document.createElement('span');
      name.textContent = c.name;
      chip.append(mark, name);
      el.columnChips.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------
  // ステップ2: クエリ UI
  // ---------------------------------------------------------------

  function populateGroupBySelect() {
    el.groupBySelect.textContent = '';
    el.groupBySelect.appendChild(makeOption('', 'なし（行をそのまま使う）'));
    // グループ化はカテゴリ・日付を先に（数値でのグループ化も可能）
    const ordered = [...state.raw.columns].sort((a, b) => {
      const rank = t => (t === 'string' ? 0 : t === 'date' ? 1 : 2);
      return rank(a.type) - rank(b.type);
    });
    ordered.forEach(c => {
      el.groupBySelect.appendChild(makeOption(c.name, c.name + '（' + TYPE_LABELS[c.type] + '）'));
    });
    el.groupBySelect.value = state.query.groupBy;
    syncGroupByUI();
  }

  function populateSortSelect() {
    el.sortSelect.textContent = '';
    QueryEngine.SORTS.forEach(s => el.sortSelect.appendChild(makeOption(s.id, s.label)));
    el.sortSelect.value = state.query.sort;
  }

  function syncGroupByUI() {
    const grouped = !!state.query.groupBy;
    el.xSelect.disabled = grouped;
    el.xHint.hidden = !grouped;
    // 集計セレクトの表示切替は系列リスト再描画で行う
    renderSeriesList();
  }

  /** 文字列列のフィルタ入力用に候補データリストを用意 */
  function ensureDatalist(column) {
    const id = 'dl-' + encodeURIComponent(column).replace(/%/g, '_');
    if (document.getElementById(id)) return id;
    const values = new Set();
    for (const row of state.raw.rows) {
      const v = row[column];
      if (v !== null && v !== undefined) values.add(String(v));
      if (values.size >= 50) break;
    }
    const dl = document.createElement('datalist');
    dl.id = id;
    [...values].forEach(v => dl.appendChild(makeOption(v, v)));
    document.body.appendChild(dl);
    return id;
  }

  function renderFilters() {
    el.filterList.textContent = '';
    state.query.filters.forEach((filter, idx) => {
      const row = document.createElement('div');
      row.className = 'filter-row';

      const colSel = document.createElement('select');
      colSel.setAttribute('aria-label', 'フィルタ対象の列');
      state.raw.columns.forEach(c => colSel.appendChild(makeOption(c.name, c.name)));
      colSel.value = filter.column;

      const opSel = document.createElement('select');
      opSel.setAttribute('aria-label', '条件');
      const fillOps = () => {
        opSel.textContent = '';
        QueryEngine.opsFor(columnType(colSel.value)).forEach(op => {
          opSel.appendChild(makeOption(op.id, op.label));
        });
      };
      fillOps();
      opSel.value = filter.op;
      if (!opSel.value) { opSel.selectedIndex = 0; filter.op = opSel.value; }

      const valInput = document.createElement('input');
      valInput.setAttribute('aria-label', '値');
      const syncInputKind = () => {
        const t = columnType(colSel.value);
        valInput.type = t === 'number' ? 'number' : 'text';
        valInput.step = 'any';
        valInput.placeholder = t === 'date' ? 'YYYY-MM-DD' : '値';
        if (t === 'string') valInput.setAttribute('list', ensureDatalist(colSel.value));
        else valInput.removeAttribute('list');
      };
      syncInputKind();
      valInput.value = filter.value === null || filter.value === undefined ? '' : filter.value;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn sm';
      removeBtn.setAttribute('aria-label', 'このフィルタを削除');
      removeBtn.textContent = '×';

      colSel.addEventListener('change', () => {
        filter.column = colSel.value;
        fillOps();
        filter.op = opSel.value;
        filter.value = '';
        valInput.value = '';
        syncInputKind();
        scheduleUpdate();
      });
      opSel.addEventListener('change', () => { filter.op = opSel.value; scheduleUpdate(); });
      valInput.addEventListener('input', () => { filter.value = valInput.value; scheduleUpdate(); });
      removeBtn.addEventListener('click', () => {
        state.query.filters.splice(idx, 1);
        renderFilters();
        scheduleUpdate();
      });

      row.append(colSel, opSel, valInput, removeBtn);
      el.filterList.appendChild(row);
    });
  }

  // ---------------------------------------------------------------
  // ステップ3: グラフ UI
  // ---------------------------------------------------------------

  function populateXSelect() {
    el.xSelect.textContent = '';
    el.xSelect.appendChild(makeOption('', '行番号（1, 2, 3, …）'));
    state.raw.columns.forEach(c => {
      el.xSelect.appendChild(makeOption(c.name, c.name + '（' + TYPE_LABELS[c.type] + '）'));
    });
    el.xSelect.value = state.chart.x;
  }

  function setMode(mode, silent) {
    state.chart.mode = mode;
    el.modeSegment.querySelectorAll('button').forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    el.xySettings.hidden = mode !== 'xy';
    el.histSettings.hidden = mode !== 'hist';
    if (mode === 'hist' && state.chart.series.length === 0) {
      const nums = numericColumns();
      if (nums.length) state.chart.series.push({ id: uid(), column: nums[0].name, agg: 'sum', type: 'bar', slot: nextFreeSlot() });
      renderHistSeriesList();
    }
    if (!silent) scheduleUpdate();
  }

  /** XYモードの系列行 */
  function renderSeriesList() {
    if (!state.raw) return;
    el.seriesList.textContent = '';
    const nums = numericColumns();
    const grouped = !!state.query.groupBy;

    state.chart.series.forEach((series, idx) => {
      const row = document.createElement('div');
      row.className = 'series-row';

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = Palette.seriesColor(state.theme, series.slot);
      swatch.title = '系列カラー（' + Palette.SERIES_NAMES[series.slot] + '）';

      const colSel = document.createElement('select');
      colSel.className = 'grow';
      colSel.setAttribute('aria-label', '系列の列');
      nums.forEach(c => colSel.appendChild(makeOption(c.name, c.name)));
      colSel.value = series.column;

      const aggSel = document.createElement('select');
      aggSel.setAttribute('aria-label', '集計方法');
      QueryEngine.AGGS.forEach(a => aggSel.appendChild(makeOption(a.id, a.label)));
      aggSel.value = series.agg || 'sum';
      aggSel.hidden = !grouped;

      const typeSel = document.createElement('select');
      typeSel.setAttribute('aria-label', 'グラフの種類');
      CHART_TYPES.forEach(t => typeSel.appendChild(makeOption(t.id, t.label)));
      typeSel.value = series.type;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn sm';
      removeBtn.setAttribute('aria-label', 'この系列を削除');
      removeBtn.textContent = '×';
      removeBtn.disabled = state.chart.series.length <= 1;

      colSel.addEventListener('change', () => { series.column = colSel.value; scheduleUpdate(); });
      aggSel.addEventListener('change', () => { series.agg = aggSel.value; scheduleUpdate(); });
      typeSel.addEventListener('change', () => { series.type = typeSel.value; scheduleUpdate(); });
      removeBtn.addEventListener('click', () => {
        state.chart.series.splice(idx, 1);
        renderSeriesList();
        renderHistSeriesList();
        scheduleUpdate();
      });

      row.append(swatch, colSel, aggSel, typeSel, removeBtn);
      el.seriesList.appendChild(row);
    });

    el.addSeriesBtn.disabled = state.chart.series.length >= Palette.MAX_SERIES || nums.length === 0;
    el.addSeriesBtn.title = state.chart.series.length >= Palette.MAX_SERIES
      ? '系列は最大8つまでです（それ以上は「その他」への集約や複数グラフをご検討ください）'
      : '';
  }

  /** ヒストグラムモードの対象列行（同じ series 配列を共有） */
  function renderHistSeriesList() {
    if (!state.raw) return;
    el.histSeriesList.textContent = '';
    const nums = numericColumns();

    state.chart.series.forEach((series, idx) => {
      const row = document.createElement('div');
      row.className = 'series-row';

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = Palette.seriesColor(state.theme, series.slot);

      const colSel = document.createElement('select');
      colSel.className = 'grow';
      colSel.setAttribute('aria-label', '対象の列');
      nums.forEach(c => colSel.appendChild(makeOption(c.name, c.name)));
      colSel.value = series.column;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn sm';
      removeBtn.setAttribute('aria-label', 'この列を削除');
      removeBtn.textContent = '×';
      removeBtn.disabled = state.chart.series.length <= 1;

      colSel.addEventListener('change', () => { series.column = colSel.value; scheduleUpdate(); });
      removeBtn.addEventListener('click', () => {
        state.chart.series.splice(idx, 1);
        renderSeriesList();
        renderHistSeriesList();
        scheduleUpdate();
      });

      row.append(swatch, colSel, removeBtn);
      el.histSeriesList.appendChild(row);
    });

    el.addHistSeriesBtn.disabled = state.chart.series.length >= Palette.MAX_SERIES || nums.length === 0;
  }

  function addSeries() {
    const nums = numericColumns();
    if (!nums.length || state.chart.series.length >= Palette.MAX_SERIES) return;
    const usedCols = new Set(state.chart.series.map(s => s.column));
    const nextCol = nums.find(c => !usedCols.has(c.name)) || nums[0];
    const lastType = state.chart.series.length ? state.chart.series[state.chart.series.length - 1].type : 'bar';
    state.chart.series.push({ id: uid(), column: nextCol.name, agg: 'sum', type: lastType, slot: nextFreeSlot() });
    renderSeriesList();
    renderHistSeriesList();
    scheduleUpdate();
  }

  // ---------------------------------------------------------------
  // 基準線
  // ---------------------------------------------------------------

  function renderRefLines() {
    el.refLineList.textContent = '';
    state.refLines.forEach((line, idx) => {
      const row = document.createElement('div');
      row.className = 'refline-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = line.label;
      labelInput.setAttribute('aria-label', '基準線のラベル');

      const valueInput = document.createElement('input');
      valueInput.type = 'number';
      valueInput.step = 'any';
      valueInput.value = line.value;
      valueInput.setAttribute('aria-label', '基準線の値');

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn sm';
      removeBtn.setAttribute('aria-label', 'この基準線を削除');
      removeBtn.textContent = '×';

      labelInput.addEventListener('input', () => { line.label = labelInput.value; scheduleUpdate(); });
      valueInput.addEventListener('input', () => {
        const v = parseFloat(valueInput.value);
        line.value = isFinite(v) ? v : null;
        scheduleUpdate();
      });
      removeBtn.addEventListener('click', () => {
        state.refLines.splice(idx, 1);
        renderRefLines();
        scheduleUpdate();
      });

      row.append(labelInput, valueInput, removeBtn);
      el.refLineList.appendChild(row);
    });
  }

  function addQuickRef(kind) {
    if (!state.raw || state.chart.series.length === 0) {
      showToast('warning', '先に系列（対象列）を設定してください');
      return;
    }
    const col = state.chart.series[0].column;
    const filtered = QueryEngine.runFilters(state.raw.rows, state.raw.columns, state.query.filters);
    const stats = Charts.statistics(filtered.map(r => r[col]));
    if (!stats) {
      showToast('warning', '「' + col + '」に数値データがありません');
      return;
    }
    const round = v => Math.round(v * 10000) / 10000;
    const defs = {
      mean: { label: '平均', value: round(stats.mean) },
      median: { label: '中央値', value: round(stats.median) },
      p3s: { label: 'UCL(+3σ)', value: round(stats.mean + 3 * stats.std) },
      m3s: { label: 'LCL(−3σ)', value: round(stats.mean - 3 * stats.std) },
      custom: { label: '基準値', value: round(stats.mean) }
    };
    const def = defs[kind];
    if (!def) return;
    state.refLines.push({ id: uid(), label: def.label, value: def.value });
    renderRefLines();
    scheduleUpdate();
  }

  // ---------------------------------------------------------------
  // メイン更新（クエリ適用 → モデル構築 → 描画・テーブル・統計・SQL）
  // ---------------------------------------------------------------

  function update() {
    if (!state.raw) return;

    const filtered = QueryEngine.runFilters(state.raw.rows, state.raw.columns, state.query.filters);

    let model = null;
    if (state.chart.series.length > 0) {
      model = state.chart.mode === 'hist'
        ? Charts.buildHistModel(state, filtered)
        : Charts.buildXYModel(state, filtered, state.raw.columns);
    }
    state.lastModel = model;

    // クエリプレビュー
    el.queryCode.textContent = QueryEngine.buildSQL(state, state.raw.columns);

    // タイトル・メタ情報
    el.chartTitle.textContent = buildTitle();
    el.chartMeta.textContent = buildMeta(filtered, model);

    // グラフ描画
    const hasData = model && (model.mode === 'hist' ? model.series.length > 0 : model.labels.length > 0);
    if (hasData) {
      el.chartNotice.hidden = true;
      el.chartCanvas.hidden = false;
      const refs = state.refLines.filter(l => l.value !== null && l.value !== undefined && isFinite(l.value));
      state.chartInstance = Charts.render(el.chartCanvas, model, state.theme, refs, state.chartInstance);
    } else {
      if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }
      el.chartCanvas.hidden = true;
      el.chartNotice.hidden = false;
      el.chartNotice.textContent = state.chart.series.length === 0
        ? '数値の列を系列として追加するとグラフが表示されます'
        : '条件に合うデータがありません。フィルタを見直してください';
    }

    buildTableView(model, filtered);
    buildStatsView(filtered);
    switchView(state.view);
  }

  function buildTitle() {
    const s = state.chart;
    if (s.series.length === 0) return 'グラフ';
    if (s.mode === 'hist') {
      return [...new Set(s.series.map(x => x.column))].join('・') + ' の分布';
    }
    const grouped = !!state.query.groupBy;
    const names = s.series.map(x => x.column + (grouped ? '（' + QueryEngine.aggById(x.agg || 'sum').label + '）' : ''));
    const xName = state.query.groupBy || s.x;
    return names.join('・') + (xName ? ' — ' + xName + '別' : '');
  }

  function buildMeta(filtered, model) {
    const total = state.raw.rows.length;
    const activeFilters = state.query.filters.filter(f => f.column && f.op && f.value !== '' && f.value !== null).length;
    const parts = [];
    parts.push('対象 ' + filtered.length.toLocaleString('ja-JP') + '行 / 全' + total.toLocaleString('ja-JP') + '行');
    if (activeFilters > 0) parts.push('フィルタ' + activeFilters + '件');
    if (state.chart.mode === 'xy' && state.query.groupBy && model) {
      parts.push('「' + state.query.groupBy + '」で' + model.labels.length + 'グループに集計');
    }
    if (state.chart.mode === 'hist' && model) {
      parts.push('階級数 ' + model.bins.count);
    }
    parts.push('出典: ' + state.raw.meta.sourceName);
    return parts.join(' ・ ');
  }

  // ---------------------------------------------------------------
  // テーブルビュー（グラフの等価テーブル）
  // ---------------------------------------------------------------

  function buildTableView(model, filtered) {
    el.dataTable.textContent = '';

    let columns = [];
    let rows = [];

    if (model && model.mode === 'hist') {
      columns = ['階級', ...model.series.map(s => s.label + ' の度数')];
      rows = model.labels.map((label, i) => [label, ...model.series.map(s => s.counts[i])]);
    } else if (model && model.mode === 'xy') {
      columns = [model.xTitle, ...model.series.map(s => s.label)];
      rows = model.labels.map((label, i) => [label, ...model.series.map(s => s.values[i])]);
    } else {
      columns = state.raw.columns.map(c => c.name);
      rows = filtered.slice(0, 1000).map(r => columns.map(c => r[c]));
    }

    state.lastTable = { columns, rows };

    const MAX_DISPLAY = 1000;
    const displayRows = rows.slice(0, MAX_DISPLAY);

    // 数値列はヘッダーも右揃えにする（本文セルと揃える）
    const numericCol = columns.map((_, ci) =>
      displayRows.some(r => typeof r[ci] === 'number')
    );

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    columns.forEach((c, ci) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      if (numericCol[ci]) th.className = 'num';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    displayRows.forEach(r => {
      const tr = document.createElement('tr');
      r.forEach(v => {
        const td = document.createElement('td');
        if (typeof v === 'number') {
          td.textContent = Charts.fmt(v);
          td.className = 'num';
        } else {
          td.textContent = v === null || v === undefined ? '—' : String(v);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    el.dataTable.append(thead, tbody);
    el.tableNote.textContent = rows.length > MAX_DISPLAY
      ? '全' + rows.length.toLocaleString('ja-JP') + '行のうち先頭' + MAX_DISPLAY.toLocaleString('ja-JP') + '行を表示（CSV出力には全行が含まれます）'
      : rows.length.toLocaleString('ja-JP') + '行（グラフと同じ内容）';
  }

  // ---------------------------------------------------------------
  // 統計ビュー
  // ---------------------------------------------------------------

  function buildStatsView(filtered) {
    el.statsContent.textContent = '';
    const cols = [...new Set(state.chart.series.map(s => s.column))];
    el.statsNote.textContent = 'フィルタ適用後の元データ（集計前の値）に対する統計です';

    if (cols.length === 0) {
      const p = document.createElement('p');
      p.className = 'stats-empty';
      p.textContent = '系列を追加すると統計が表示されます';
      el.statsContent.appendChild(p);
      return;
    }

    const table = document.createElement('table');
    table.className = 'stats-table';
    const metrics = [
      ['件数', s => s.n.toLocaleString('ja-JP')],
      ['平均', s => Charts.fmt(s.mean)],
      ['中央値', s => Charts.fmt(s.median)],
      ['標準偏差', s => Charts.fmt(s.std)],
      ['最小', s => Charts.fmt(s.min)],
      ['最大', s => Charts.fmt(s.max)],
      ['歪度', s => Charts.fmt(s.skew)],
      ['尖度', s => Charts.fmt(s.kurt)],
      ['分布の形', s => Charts.distributionLabel(s)]
    ];

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.scope = 'col';
    th0.textContent = '列';
    hr.appendChild(th0);
    metrics.forEach(([label]) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      hr.appendChild(th);
    });
    thead.appendChild(hr);

    const tbody = document.createElement('tbody');
    cols.forEach(col => {
      const stats = Charts.statistics(filtered.map(r => r[col]));
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      const series = state.chart.series.find(s => s.column === col);
      if (series) {
        const dot = document.createElement('span');
        dot.className = 'swatch sm';
        dot.style.background = Palette.seriesColor(state.theme, series.slot);
        th.appendChild(dot);
      }
      th.appendChild(document.createTextNode(col));
      tr.appendChild(th);
      metrics.forEach(([label, f]) => {
        const td = document.createElement('td');
        td.className = label === '分布の形' ? '' : 'num';
        td.textContent = stats ? f(stats) : '—';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    el.statsContent.appendChild(table);
  }

  // ---------------------------------------------------------------
  // ビュー切替・エクスポート
  // ---------------------------------------------------------------

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.tab').forEach(tab => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    el.chartCard.hidden = view !== 'chart';
    el.tableCard.hidden = view !== 'table';
    el.statsCard.hidden = view !== 'stats';
    if (view === 'chart' && state.chartInstance) {
      // 非表示中にレイアウトが変わっている可能性があるため再計測
      requestAnimationFrame(() => state.chartInstance && state.chartInstance.resize());
    }
  }

  function timestamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function exportCSV() {
    if (!state.lastTable) return;
    const csv = Papa.unparse({ fields: state.lastTable.columns, data: state.lastTable.rows });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }); // BOM付き（Excelでの文字化け防止）
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data_' + timestamp() + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast('success', 'テーブルをCSVとして出力しました');
  }

  function copyQuery() {
    const text = el.queryCode.textContent;
    if (!text) return;
    const done = () => showToast('success', 'クエリをコピーしました');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { showToast('error', 'コピーできませんでした'); }
    ta.remove();
  }

  // ---------------------------------------------------------------
  // イベント結線
  // ---------------------------------------------------------------

  function bindEvents() {
    el.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    // ファイル読み込み
    el.dropArea.addEventListener('click', () => el.fileInput.click());
    el.dropArea.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
    });
    ['dragenter', 'dragover'].forEach(ev => el.dropArea.addEventListener(ev, e => {
      e.preventDefault();
      el.dropArea.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => el.dropArea.addEventListener(ev, e => {
      e.preventDefault();
      el.dropArea.classList.remove('dragover');
    }));
    el.dropArea.addEventListener('drop', e => {
      if (e.dataTransfer.files && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    el.fileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files.length) handleFile(e.target.files[0]);
    });
    el.removeFileBtn.addEventListener('click', clearData);

    // クエリ
    el.addFilterBtn.addEventListener('click', () => {
      const first = state.raw.columns.find(c => c.type === 'string') || state.raw.columns[0];
      state.query.filters.push({ column: first.name, op: QueryEngine.opsFor(first.type)[0].id, value: '' });
      renderFilters();
    });
    el.groupBySelect.addEventListener('change', () => {
      state.query.groupBy = el.groupBySelect.value;
      syncGroupByUI();
      scheduleUpdate();
    });
    el.sortSelect.addEventListener('change', () => { state.query.sort = el.sortSelect.value; scheduleUpdate(); });
    el.limitInput.addEventListener('input', () => {
      const v = parseInt(el.limitInput.value, 10);
      state.query.limit = isFinite(v) && v > 0 ? v : null;
      scheduleUpdate();
    });
    el.copyQueryBtn.addEventListener('click', copyQuery);

    // グラフ設定
    el.modeSegment.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode, false));
    });
    el.xSelect.addEventListener('change', () => { state.chart.x = el.xSelect.value; scheduleUpdate(); });
    el.addSeriesBtn.addEventListener('click', addSeries);
    el.addHistSeriesBtn.addEventListener('click', addSeries);
    el.stackedToggle.addEventListener('change', () => { state.chart.stacked = el.stackedToggle.checked; scheduleUpdate(); });
    el.binMethodSelect.addEventListener('change', () => {
      state.chart.bins.method = el.binMethodSelect.value;
      el.binCountField.hidden = state.chart.bins.method !== 'custom';
      scheduleUpdate();
    });
    el.binCountRange.addEventListener('input', () => {
      state.chart.bins.count = parseInt(el.binCountRange.value, 10);
      el.binCountOut.textContent = el.binCountRange.value;
      scheduleUpdate();
    });
    el.normalCurveToggle.addEventListener('change', () => {
      state.chart.normalCurve = el.normalCurveToggle.checked;
      scheduleUpdate();
    });

    // 基準線
    el.quickRefs.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => addQuickRef(btn.dataset.ref));
    });

    // ビュー切替・エクスポート
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });
    el.downloadPngBtn.addEventListener('click', () => {
      if (!state.chartInstance) { showToast('warning', '保存できるグラフがありません'); return; }
      if (state.view !== 'chart') switchView('chart');
      Charts.exportPNG(state.chartInstance, state.theme, 'graph_' + timestamp() + '.png');
      showToast('success', 'グラフをPNGとして保存しました');
    });
    el.exportCsvBtn.addEventListener('click', exportCSV);
  }

  // ---------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------

  function init() {
    initTheme();
    renderSampleGrids();
    populateSortSelect();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
