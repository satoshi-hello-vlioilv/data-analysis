/**
 * アプリケーション層 — 状態管理と UI の結線
 *
 * 情報アーキテクチャ（認知負荷を抑えるための設計）:
 *   「1. データ → 2. データ処理 → 3. グラフ」の3ステップをタブ形式の
 *   ステッパーで切り替える（Hickの法則: 一度に見える操作を絞り込むほど
 *   意思決定が速くなる）。各ステップ内はさらにアコーディオンで主要/詳細を
 *   分け、チャンキング（Millerの法則）で認知負荷を下げる。
 *   検出した列はドラッグ＆ドロップでX軸・グループ化・系列に直接割り当て
 *   られる（再認優位・直接操作 — プルダウンを探すより速く、確実）。
 *   系列の並び順はドラッグハンドルまたは矢印ボタンで入れ替え可能。
 *   すべての操作は即時に右のグラフ・テーブル・統計・クエリプレビューへ
 *   反映され、操作と結果の対応が常に見える状態を保つ。
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------

  const state = {
    raw: null, // { rows, columns, meta }
    activeStep: 'data', // 'data' | 'query' | 'chart' — サイドバーのステッパーで選択中のステップ
    query: { filters: [], groupBy: '', sort: 'auto', limit: null },
    chart: {
      mode: 'xy',            // 'xy' | 'hist'
      x: '',                 // X軸の列（'' = 行番号）
      series: [],            // [{ id, column, agg, type, slot }]
      stacked: false,
      bins: { method: 'sturges', count: 10 },
      normalCurve: false,
      title: '',             // グラフタイトルの手動指定（空欄=自動）
      xy: {
        xLabel: '', yLabel: '',                        // 軸ラベルの手動指定（空欄=自動）
        xRange: { min: null, max: null },               // 線形X軸（散布図）の表示範囲
        yRange: { min: null, max: null },               // Y軸の表示範囲
        xIndexRange: { start: null, end: null }          // カテゴリX軸の表示データ範囲（インデックス）
      },
      hist: {
        xLabel: '', yLabel: '',
        valueRange: { min: null, max: null },            // 値の表示範囲（階級の元になる範囲）
        freqRange: { min: null, max: null }               // 度数（Y軸）の表示範囲
      }
    },
    refLines: [],            // [{ id, label, value }]
    theme: 'light',
    view: 'chart',
    chartInstance: null,
    lastModel: null,
    lastTable: null,          // { columns: [names], rows: [[...]] } — グラフの等価テーブル

    // 取り込み設定（ヘッダー行・データ開始行の手動調整）— ファイル読込時のみ使用
    importRaw: null,          // { aoa, sourceName } | null（サンプルデータ利用時は null）
    importSuggested: null,    // { headerRowIndex, dataStartRowIndex } 自動検出値
    importHeaderRow: -1,
    importDataStart: 0,
    importExcludedRows: new Set() // データ開始行以降でも除外したい行番号（注記・小計行など）
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
    importAdjust: $('importAdjust'),
    importSummary: $('importSummary'),
    importHeaderRow: $('importHeaderRow'),
    importDataStartRow: $('importDataStartRow'),
    importAutoBtn: $('importAutoBtn'),
    openMatrixBtn: $('openMatrixBtn'),

    // 生データマトリクス（メイン画面・複雑な形式の取り込み調整）
    matrixTab: $('matrixTab'),
    matrixCard: $('matrixCard'),
    matrixNote: $('matrixNote'),
    matrixToolbar: $('matrixToolbar'),
    matrixSelectionLabel: $('matrixSelectionLabel'),
    matrixSetHeaderBtn: $('matrixSetHeaderBtn'),
    matrixSetDataStartBtn: $('matrixSetDataStartBtn'),
    matrixExcludeBtn: $('matrixExcludeBtn'),
    matrixIncludeBtn: $('matrixIncludeBtn'),
    matrixSetXBtn: $('matrixSetXBtn'),
    matrixAddSeriesBtn: $('matrixAddSeriesBtn'),
    matrixTable: $('matrixTable'),

    // ステッパー（ステップ切替タブ）
    stepTabData: $('stepTabData'),
    stepTabQuery: $('stepTabQuery'),
    stepTabChart: $('stepTabChart'),
    stepDataBadge: $('stepDataBadge'),
    stepDataPanel: $('stepDataPanel'),
    queryStepCount: $('queryStepCount'),
    chartStepCount: $('chartStepCount'),

    stepQuery: $('stepQuery'),
    stepChart: $('stepChart'),
    filterCount: $('filterCount'),
    filterList: $('filterList'),
    addFilterBtn: $('addFilterBtn'),
    groupByDropZone: $('groupByDropZone'),
    groupBySelect: $('groupBySelect'),
    sortSelect: $('sortSelect'),
    limitInput: $('limitInput'),
    queryCode: $('queryCode'),
    copyQueryBtn: $('copyQueryBtn'),

    // プリセット（処理内容一式の保存・書き出し・読み込み）
    presetAccordion: $('presetAccordion'),
    presetCount: $('presetCount'),
    presetNameInput: $('presetNameInput'),
    savePresetBtn: $('savePresetBtn'),
    presetList: $('presetList'),
    importPresetBtn: $('importPresetBtn'),
    presetFileInput: $('presetFileInput'),

    modeSegment: $('modeSegment'),
    metadataHint: $('metadataHint'),
    metadataCount: $('metadataCount'),
    metadataChips: $('metadataChips'),
    chartTitleInput: $('chartTitleInput'),
    xySettings: $('xySettings'),
    histSettings: $('histSettings'),
    xAxisDropZone: $('xAxisDropZone'),
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
    refLineAccordion: $('refLineAccordion'),
    refLineCount: $('refLineCount'),
    refLineList: $('refLineList'),
    quickRefs: $('quickRefs'),

    // 軸ラベル・表示範囲（XY）
    xLabelInput: $('xLabelInput'),
    yLabelInput: $('yLabelInput'),
    yRangeMin: $('yRangeMin'),
    yRangeMax: $('yRangeMax'),
    yRangeHint: $('yRangeHint'),
    xRangeNumericField: $('xRangeNumericField'),
    xRangeMin: $('xRangeMin'),
    xRangeMax: $('xRangeMax'),
    xRangeHint: $('xRangeHint'),
    xIndexRangeField: $('xIndexRangeField'),
    xIndexFill: $('xIndexFill'),
    xIndexMin: $('xIndexMin'),
    xIndexMax: $('xIndexMax'),
    xIndexFromLabel: $('xIndexFromLabel'),
    xIndexToLabel: $('xIndexToLabel'),

    // 軸ラベル・表示範囲（ヒストグラム）
    histXLabelInput: $('histXLabelInput'),
    histYLabelInput: $('histYLabelInput'),
    histValueMin: $('histValueMin'),
    histValueMax: $('histValueMax'),
    histValueHint: $('histValueHint'),
    histFreqMin: $('histFreqMin'),
    histFreqMax: $('histFreqMax'),
    contentToolbar: $('contentToolbar'),
    emptyState: $('emptyState'),
    chartCard: $('chartCard'),
    chartTitle: $('chartTitle'),
    chartMeta: $('chartMeta'),
    chartBody: $('chartBody'),
    chartCanvas: $('chartCanvas'),
    chartZoomBox: $('chartZoomBox'),
    chartZoomResetBtn: $('chartZoomResetBtn'),
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
    toastMessage: $('toastMessage'),
    fileDropOverlay: $('fileDropOverlay'),
    colPickerPortal: $('colPickerPortal')
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

  // ---------------------------------------------------------------
  // 列選択リストボックス（col-picker） — ネイティブ select の代替
  //
  // X軸・グループ化・系列の列名は、行の横幅次第では選択中の値が完全に
  // 見えなくなってしまう（ネイティブ select が幅0近くまで潰れると文字が
  // 表示されない）。トリガーは省略表示＋ツールチップに留めつつ、開いた
  // パネルは document.body 直下のポータルとして描画することで、行や
  // サイドバーの横幅・スクロール枠に縛られず全項目名を省略なく表示する。
  // 同時に開けるパネルは1つだけ（ネイティブ select と同じ振る舞い）。
  // ---------------------------------------------------------------

  let activeColPicker = null; // { trigger, options, onSelect }

  function closeColumnPicker() {
    if (!activeColPicker) return;
    const { trigger } = activeColPicker;
    el.colPickerPortal.hidden = true;
    el.colPickerPortal.textContent = '';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('active');
    activeColPicker = null;
  }

  /** パネルをトリガーの直下（画面端では上や左へ補正して）に配置する */
  function positionColPickerPanel(trigger) {
    const panel = el.colPickerPortal;
    const rect = trigger.getBoundingClientRect();
    panel.style.minWidth = Math.max(rect.width, 180) + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';
    const pr = panel.getBoundingClientRect(); // 配置後に実測して画面端のはみ出しを補正
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + pr.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pr.width - 8);
    if (top + pr.height > window.innerHeight - 8) top = rect.top - pr.height - 4;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  /**
   * トリガーボタンにパネルを開閉させる。options: [{value, label, type}]
   * onSelect(value) は項目クリック時に呼ばれる。
   */
  function toggleColumnPicker(trigger, options, currentValue, onSelect) {
    if (trigger.disabled) return;
    if (activeColPicker && activeColPicker.trigger === trigger) { closeColumnPicker(); return; }
    closeColumnPicker();

    const panel = el.colPickerPortal;
    panel.textContent = '';
    options.forEach(opt => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'col-picker-option';
      item.setAttribute('role', 'option');
      const isSelected = opt.value === currentValue;
      item.setAttribute('aria-selected', String(isSelected));
      if (isSelected) item.classList.add('selected');
      if (opt.type) {
        const badge = document.createElement('em');
        badge.className = 'col-picker-type type-' + opt.type;
        badge.textContent = TYPE_LABELS[opt.type] || '';
        item.appendChild(badge);
      }
      const label = document.createElement('span');
      label.className = 'col-picker-option-label';
      label.textContent = opt.label;
      item.appendChild(label);
      if (isSelected) {
        const check = document.createElement('span');
        check.className = 'col-picker-option-check';
        check.textContent = '✓';
        item.appendChild(check);
      }
      item.addEventListener('click', () => {
        closeColumnPicker();
        trigger.focus();
        onSelect(opt.value);
      });
      item.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); (item.nextElementSibling || panel.firstElementChild).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (item.previousElementSibling || panel.lastElementChild).focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeColumnPicker(); trigger.focus(); }
      });
      panel.appendChild(item);
    });

    panel.hidden = false;
    positionColPickerPanel(trigger);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('active');
    activeColPicker = { trigger };
    const selectedItem = panel.querySelector('.col-picker-option.selected') || panel.firstElementChild;
    if (selectedItem) selectedItem.focus();
  }

  /** 一度だけ呼ぶ: パネル外クリック・Escape・スクロール・リサイズで自動的に閉じる */
  function initColumnPickerGlobalHandlers() {
    document.addEventListener('mousedown', e => {
      if (!activeColPicker) return;
      if (el.colPickerPortal.contains(e.target) || activeColPicker.trigger.contains(e.target)) return;
      closeColumnPicker();
    });
    document.addEventListener('keydown', e => {
      if (activeColPicker && e.key === 'Escape') { const t = activeColPicker.trigger; closeColumnPicker(); t.focus(); }
    });
    window.addEventListener('scroll', () => closeColumnPicker(), true);
    window.addEventListener('resize', () => closeColumnPicker());
  }

  /**
   * ネイティブ select の代替となる列選択リストボックスを1つ生成する。
   * opts: { options: [{value,label,type}], value, ariaLabel, placeholder, onChange }
   * 戻り値の要素に setValue(v) / setDisabled(bool) を生やして返す（呼び出し側で
   * populateXSelect 等が再構築のたびに使う）。
   */
  function createColumnPicker(opts) {
    const options = opts.options || [];
    let currentValue = opts.value !== undefined ? opts.value : '';

    const wrap = document.createElement('div');
    wrap.className = 'col-picker';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'col-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (opts.ariaLabel) trigger.setAttribute('aria-label', opts.ariaLabel);

    const typeBadge = document.createElement('em');
    typeBadge.className = 'col-picker-type';
    const labelEl = document.createElement('span');
    labelEl.className = 'col-picker-label';
    const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    caret.setAttribute('class', 'col-picker-caret');
    caret.setAttribute('width', '11');
    caret.setAttribute('height', '11');
    caret.setAttribute('viewBox', '0 0 24 24');
    caret.setAttribute('fill', 'none');
    caret.setAttribute('stroke', 'currentColor');
    caret.setAttribute('stroke-width', '2.5');
    caret.setAttribute('stroke-linecap', 'round');
    caret.setAttribute('stroke-linejoin', 'round');
    caret.setAttribute('aria-hidden', 'true');
    const caretPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    caretPath.setAttribute('points', '6 9 12 15 18 9');
    caret.appendChild(caretPath);

    trigger.append(typeBadge, labelEl, caret);
    wrap.appendChild(trigger);

    function render() {
      const found = options.find(o => o.value === currentValue);
      labelEl.textContent = found ? found.label : (opts.placeholder || '');
      labelEl.classList.toggle('placeholder', !found);
      trigger.title = found ? found.label : (opts.placeholder || '');
      if (found && found.type) {
        typeBadge.hidden = false;
        typeBadge.textContent = TYPE_LABELS[found.type] || '';
        typeBadge.className = 'col-picker-type type-' + found.type;
      } else {
        typeBadge.hidden = true;
      }
    }
    render();

    trigger.addEventListener('click', () => {
      toggleColumnPicker(trigger, options, currentValue, val => {
        currentValue = val;
        render();
        opts.onChange(val);
      });
    });
    trigger.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!activeColPicker || activeColPicker.trigger !== trigger) {
          toggleColumnPicker(trigger, options, currentValue, val => { currentValue = val; render(); opts.onChange(val); });
        }
      }
    });

    wrap.setValue = v => { currentValue = v; render(); };
    wrap.getValue = () => currentValue;
    wrap.setDisabled = disabled => { trigger.disabled = disabled; };

    return wrap;
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
    document.documentElement.style.setProperty('--series-legend-color', Palette.seriesColor(theme, 0));
    try { localStorage.setItem('chartlab-theme', theme); } catch (e) { /* プライベートモード等 */ }
    renderSeriesList();
    renderHistSeriesList();
    scheduleUpdate();
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('chartlab-theme'); } catch (e) { /* noop */ }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.setProperty('--series-legend-color', Palette.seriesColor(state.theme, 0));
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
          // サンプルデータは既に整形済みのため、取り込み設定（生プレビュー）は不要
          state.importRaw = null;
          state.importSuggested = null;
          state.importExcludedRows = new Set();
          loadTable(sample.build());
          switchStep('chart'); // 読み込み直後は完成したグラフをすぐ見せる
          showToast('success', 'サンプル「' + sample.name + '」を読み込みました');
        });
        grid.appendChild(btn);
      });
    });
  }

  function handleFile(file) {
    if (!file) return;
    DataLayer.parseFileRaw(file)
      .then(({ aoa, sourceName }) => {
        const suggested = DataLayer.suggestStructure(aoa);
        state.importRaw = { aoa, sourceName };
        state.importSuggested = suggested;
        state.importExcludedRows = new Set();
        commitImport(suggested.headerRowIndex, suggested.dataStartRowIndex, { initial: true });
      })
      .catch(err => {
        showToast('error', err.message || 'ファイルの読み込みに失敗しました');
      });
  }

  /**
   * 画面全体をファイルのドロップ対象にする。
   * 列チップ・系列の並び替えなど、アプリ内の独自ドラッグ＆ドロップ（application/x-* 型）は
   * dataTransfer.types に "Files" を含まないため、ここでは干渉しない。
   */
  function initWindowFileDrop() {
    let dragCounter = 0;
    const isFileDrag = e => !!(e.dataTransfer && Array.prototype.includes.call(e.dataTransfer.types || [], 'Files'));

    window.addEventListener('dragenter', e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCounter++;
      el.fileDropOverlay.hidden = false;
    });
    window.addEventListener('dragover', e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', e => {
      if (!isFileDrag(e)) return;
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) el.fileDropOverlay.hidden = true;
    });
    window.addEventListener('drop', e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCounter = 0;
      el.fileDropOverlay.hidden = true;
      if (e.dataTransfer.files && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    // ブラウザ外へドラッグが抜けた場合の保険（dragleaveが発火しないケースへの対策）
    window.addEventListener('dragend', () => { dragCounter = 0; el.fileDropOverlay.hidden = true; });
  }

  /**
   * 取り込み設定（ヘッダー行・データ開始行・除外行）を確定し、テーブルを再構築する。
   * ファイル選択直後の初回確定にも、プレビュー／マトリクスでの手動調整にも使う。
   */
  function commitImport(headerRowIndex, dataStartRowIndex, opts) {
    if (!state.importRaw) return;
    opts = opts || {};
    let table;
    try {
      table = DataLayer.buildTable(state.importRaw.aoa, headerRowIndex, dataStartRowIndex, state.importRaw.sourceName, state.importExcludedRows);
    } catch (err) {
      showToast('error', err.message || 'この設定では取り込めません');
      return;
    }
    state.importHeaderRow = headerRowIndex;
    state.importDataStart = dataStartRowIndex;
    // ファイル読込直後は、まず生データマトリクスで自動検出結果を確認できるようにする
    // （サンプルデータや再調整時は、表示中のタブから強制的に切り替えない）
    loadTable(table, { view: opts.initial ? 'matrix' : null });
    if (opts.initial) {
      switchStep('data'); // マトリクスと一緒に、データタブのファイル情報・取り込み設定を見せる
      const parts = [table.rows.length.toLocaleString('ja-JP') + '行 × ' + table.columns.length + '列を読み込みました'];
      parts.push(table.meta.hasHeader ? 'ヘッダー行を検出' : '列名を自動生成');
      showToast('success', parts.join('・'));
    } else {
      // 取り込み設定の調整はデータタブで行うため、アクティブなステップは変えない
      showToast('info', '取り込み設定を変更しました（グラフ設定はリセットされます）');
    }
  }

  /** テーブルを取り込み、賢い初期設定でグラフを立ち上げる */
  function loadTable(table, loadOpts) {
    loadOpts = loadOpts || { view: 'chart' };
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
    state.chart.title = '';
    state.chart.xy = {
      xLabel: '', yLabel: '',
      xRange: { min: null, max: null },
      yRange: { min: null, max: null },
      xIndexRange: { start: null, end: null }
    };
    state.chart.hist = {
      xLabel: '', yLabel: '',
      valueRange: { min: null, max: null },
      freqRange: { min: null, max: null }
    };

    smartDefaults();

    // UI再構築
    el.fileInfo.hidden = false;
    el.fileInfoName.textContent = table.meta.sourceName;
    el.fileInfoDetail.textContent = table.rows.length.toLocaleString('ja-JP') + '行 × ' + table.columns.length + '列';
    renderColumnChips();
    renderMetadataChips();
    renderImportPanel();
    el.stepTabQuery.disabled = false;
    el.stepTabChart.disabled = false;
    el.stepDataBadge.textContent = '✓';
    el.stepDataBadge.classList.add('done');
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
    el.chartTitleInput.value = '';
    el.xLabelInput.value = '';
    el.yLabelInput.value = '';
    el.yRangeMin.value = ''; el.yRangeMax.value = '';
    el.xRangeMin.value = ''; el.xRangeMax.value = '';
    el.histXLabelInput.value = '';
    el.histYLabelInput.value = '';
    el.histValueMin.value = ''; el.histValueMax.value = '';
    el.histFreqMin.value = ''; el.histFreqMax.value = '';
    setMode('xy', true);
    renderFilters();
    renderSeriesList();
    renderHistSeriesList();
    renderRefLines();
    // 現在表示中のタブ（生データマトリクス等）を、可能な限り維持したまま再同期する
    switchView(loadOpts.view || state.view);
    scheduleUpdate();
  }

  // ---------------------------------------------------------------
  // 取り込み設定パネル（ヘッダー行・データ開始行の手動調整）
  // ---------------------------------------------------------------

  function renderImportPanel() {
    if (!state.importRaw) {
      el.importAdjust.hidden = true;
      el.importAdjust.open = false;
      el.matrixTab.hidden = true;
      if (state.view === 'matrix') switchView('chart');
      return;
    }
    el.importAdjust.hidden = false;
    el.matrixTab.hidden = false;
    const isAuto = !!state.importSuggested &&
      state.importHeaderRow === state.importSuggested.headerRowIndex &&
      state.importDataStart === state.importSuggested.dataStartRowIndex &&
      state.importExcludedRows.size === 0;
    const excludedNote = state.importExcludedRows.size ? ' / 除外' + state.importExcludedRows.size + '行' : '';
    el.importSummary.textContent = '取り込み設定 — ヘッダー: ' +
      (state.importHeaderRow >= 0 ? (state.importHeaderRow + 1) + '行目' : 'なし') +
      ' / データ開始: ' + (state.importDataStart + 1) + '行目' + excludedNote +
      (isAuto ? '（自動検出）' : '（手動調整）');
    el.importHeaderRow.value = state.importHeaderRow >= 0 ? state.importHeaderRow + 1 : 0;
    el.importDataStartRow.value = state.importDataStart + 1;
    if (!isAuto) el.importAdjust.open = true;
    renderMatrix();
  }

  // ---------------------------------------------------------------
  // 生データマトリクス（メイン画面・セル範囲のドラッグ選択で役割を割り当て）
  // ---------------------------------------------------------------

  const MATRIX_MAX_ROWS = 200;
  const MATRIX_MAX_COLS = 30;
  let matrixAnchor = null;      // { row, col } ドラッグ開始セル
  let matrixDragging = false;
  let matrixSelection = null;   // { r1, r2, c1, c2 }（0始まり・raw行/列インデックス）
  let matrixShownRows = 0;      // 表示中の行数（列見出しクリックで列全体を選択する際に使用）

  /** 0始まり列番号 → スプレッドシート風の列名（A, B, ..., Z, AA, AB, ...） */
  function colLetter(index) {
    let n = index, s = '';
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }

  /** 生データのマトリクス表（セルをドラッグ選択して役割を割り当てる） */
  function renderMatrix() {
    matrixAnchor = null;
    matrixDragging = false;
    matrixSelection = null;
    matrixColDragAnchor = null;

    const aoa = state.importRaw.aoa;
    const shown = Math.min(aoa.length, MATRIX_MAX_ROWS);
    const width = Math.min(MATRIX_MAX_COLS, Math.max(1, ...aoa.slice(0, shown).map(r => (Array.isArray(r) ? r.length : 0))));
    matrixShownRows = shown;

    el.matrixTable.textContent = '';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'matrix-corner';
    headRow.appendChild(corner);
    for (let c = 0; c < width; c++) {
      const th = document.createElement('th');
      th.textContent = colLetter(c);
      th.dataset.col = c;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    el.matrixTable.appendChild(thead);

    const tbody = document.createElement('tbody');

    for (let i = 0; i < shown; i++) {
      const row = Array.isArray(aoa[i]) ? aoa[i] : [];
      const tr = document.createElement('tr');
      const isHeader = i === state.importHeaderRow;
      const isExcludedManual = !isHeader && state.importExcludedRows.has(i);
      const isPreamble = !isHeader && !isExcludedManual && i < state.importDataStart;
      // 4カテゴリ（ヘッダー／前置き／除外／データ）を色分けし、自動検出の判定結果が
      // どの行にどう適用されたか一目で分かるようにする
      if (isHeader) tr.classList.add('row-header');
      else if (isPreamble) tr.classList.add('row-excluded', 'row-excluded-preamble');
      else if (isExcludedManual) tr.classList.add('row-excluded', 'row-excluded-manual');
      else tr.classList.add('row-data');

      const gutter = document.createElement('td');
      gutter.className = 'import-row-gutter';
      const inner = document.createElement('div');
      inner.className = 'import-row-gutter-inner';

      const num = document.createElement('span');
      num.className = 'import-row-num';
      num.textContent = String(i + 1);

      const actions = document.createElement('span');
      actions.className = 'import-row-actions';
      const hBtn = document.createElement('button');
      hBtn.type = 'button';
      hBtn.textContent = 'H';
      hBtn.title = 'この行をヘッダーに設定';
      hBtn.addEventListener('click', () => {
        const dataStart = state.importDataStart <= i ? i + 1 : state.importDataStart;
        commitImport(i, dataStart);
      });
      const sBtn = document.createElement('button');
      sBtn.type = 'button';
      sBtn.textContent = '▶';
      sBtn.title = 'この行からデータ開始';
      sBtn.addEventListener('click', () => commitImport(state.importHeaderRow, i));
      const xBtn = document.createElement('button');
      xBtn.type = 'button';
      xBtn.textContent = '✕';
      xBtn.title = isExcludedManual ? 'この行の除外を解除' : 'この行を除外（注記・小計行など）';
      xBtn.addEventListener('click', () => {
        if (isExcludedManual) state.importExcludedRows.delete(i); else state.importExcludedRows.add(i);
        commitImport(state.importHeaderRow, state.importDataStart);
      });
      actions.append(hBtn, sBtn, xBtn);
      inner.append(num, actions);

      // バッジは区分の境界（ヘッダー行・前置き行・除外行・データ開始行）にだけ付け、
      // データ本体の行すべてには繰り返さない（.row-data の帯色で「データ」区分を示す）
      let badgeText = '', badgeClass = '';
      if (isHeader) { badgeText = 'ヘッダー'; }
      else if (isExcludedManual) { badgeText = '除外'; badgeClass = 'import-row-exclude-badge'; }
      else if (isPreamble) { badgeText = '前置き'; badgeClass = 'import-row-preamble-badge'; }
      else if (i === state.importDataStart) { badgeText = 'データ開始'; badgeClass = 'import-row-data-badge'; }
      if (badgeText) {
        const badge = document.createElement('span');
        badge.className = 'import-row-badge' + (badgeClass ? ' ' + badgeClass : '');
        badge.textContent = badgeText;
        inner.appendChild(badge);
      }
      gutter.appendChild(inner);
      tr.appendChild(gutter);

      for (let c = 0; c < width; c++) {
        const td = document.createElement('td');
        const v = row[c];
        td.textContent = v === null || v === undefined || v === '' ? '' : String(v);
        td.dataset.row = i;
        td.dataset.col = c;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    el.matrixTable.appendChild(tbody);

    if (aoa.length > shown) {
      const tr = document.createElement('tr');
      tr.className = 'row-more';
      const td = document.createElement('td');
      td.colSpan = width + 1;
      td.textContent = '… 全' + aoa.length.toLocaleString('ja-JP') + '行中、先頭' + shown.toLocaleString('ja-JP') + '行を表示';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    updateMatrixToolbar();
    syncMatrixColumnRoles();
  }

  /** 現在のX軸・系列の割り当てを、マトリクスの列見出し（下線色）に反映する（軽量・全体再描画なし） */
  function syncMatrixColumnRoles() {
    if (!el.matrixTable || el.matrixCard.hidden || !state.raw) return;
    const ths = el.matrixTable.querySelectorAll('thead th[data-col]');
    if (!ths.length) return;
    const seriesByCol = new Map(state.chart.series.map(s => [s.column, s]));
    ths.forEach(th => {
      const c = +th.dataset.col;
      const col = state.raw.columns[c];
      th.style.borderBottomWidth = '';
      th.style.borderBottomColor = '';
      th.classList.remove('col-role-x', 'col-role-series');
      if (!col) return;
      if (col.name === state.chart.x) {
        th.classList.add('col-role-x');
        th.style.borderBottomWidth = '3px';
        th.style.borderBottomColor = 'var(--accent)';
      } else if (seriesByCol.has(col.name)) {
        th.classList.add('col-role-series');
        th.style.borderBottomWidth = '3px';
        th.style.borderBottomColor = Palette.seriesColor(state.theme, seriesByCol.get(col.name).slot);
      }
    });
  }

  function matrixCellAt(target) {
    const td = target.closest ? target.closest('td[data-row]') : null;
    if (!td || !el.matrixTable.contains(td)) return null;
    return { row: +td.dataset.row, col: +td.dataset.col };
  }

  /** th（列見出し）または td のどちらの上でも、その列番号を取り出す（列見出しのドラッグ選択用） */
  function matrixColAt(target) {
    if (!target.closest) return null;
    const th = target.closest('th[data-col]');
    if (th && el.matrixTable.contains(th)) return +th.dataset.col;
    const td = target.closest('td[data-row]');
    if (td && el.matrixTable.contains(td)) return +td.dataset.col;
    return null;
  }

  function setMatrixSelection(a, b) {
    if (!a || !b) {
      matrixSelection = null;
    } else {
      matrixSelection = {
        r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row),
        c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col)
      };
    }
    paintMatrixSelection();
    updateMatrixToolbar();
  }

  function paintMatrixSelection() {
    el.matrixTable.querySelectorAll('td.cell-selected').forEach(td => td.classList.remove('cell-selected'));
    if (!matrixSelection) return;
    const { r1, r2, c1, c2 } = matrixSelection;
    el.matrixTable.querySelectorAll('td[data-row]').forEach(td => {
      const r = +td.dataset.row, c = +td.dataset.col;
      if (r >= r1 && r <= r2 && c >= c1 && c <= c2) td.classList.add('cell-selected');
    });
  }

  const MATRIX_TOOLBAR_BUTTONS = [
    'matrixSetHeaderBtn', 'matrixSetDataStartBtn', 'matrixExcludeBtn',
    'matrixIncludeBtn', 'matrixSetXBtn', 'matrixAddSeriesBtn'
  ];

  /**
   * ツールバーは常に同じ高さで表示し続ける（hidden切替はしない）。
   * ドラッグ中に表示・非表示を切り替えると、その分レイアウトが動いてマウス座標と
   * セルの対応がずれてしまう（ドラッグ開始直後に別の行を選択してしまう不具合の原因になった）ため、
   * ボタンの有効/無効切替とラベル文言の更新だけで状態を伝える。
   */
  function updateMatrixToolbar() {
    const hasSelection = !!matrixSelection;
    MATRIX_TOOLBAR_BUTTONS.forEach(id => { el[id].disabled = !hasSelection; });
    if (!hasSelection) {
      el.matrixSelectionLabel.textContent = 'セルをドラッグ、または列見出しをクリックして範囲を選択してください';
      return;
    }
    const { r1, r2, c1, c2 } = matrixSelection;
    const rows = r2 - r1 + 1, cols = c2 - c1 + 1;
    el.matrixSelectionLabel.textContent = '選択範囲: ' + rows + '行 × ' + cols + '列 （' +
      colLetter(c1) + (r1 + 1) + ':' + colLetter(c2) + (r2 + 1) + '）';
  }

  let matrixColDragAnchor = null; // 列見出しからドラッグ開始した場合の起点列（複数列ドラッグ選択用）

  function initMatrixEvents() {
    el.matrixTable.addEventListener('mousedown', e => {
      // 列見出し（A, B, C…）のドラッグ・クリック → 列全体（複数可）を選択（スプレッドシートの慣習に合わせる）
      const th = e.target.closest ? e.target.closest('th[data-col]') : null;
      if (th) {
        e.preventDefault();
        matrixDragging = true;
        matrixColDragAnchor = +th.dataset.col;
        const lastRow = Math.max(0, matrixShownRows - 1);
        setMatrixSelection({ row: 0, col: matrixColDragAnchor }, { row: lastRow, col: matrixColDragAnchor });
        return;
      }
      const cell = matrixCellAt(e.target);
      if (!cell) return;
      e.preventDefault(); // ドラッグ中のテキスト選択を防ぐ
      matrixDragging = true;
      matrixColDragAnchor = null;
      matrixAnchor = cell;
      setMatrixSelection(cell, cell);
    });
    el.matrixTable.addEventListener('mouseover', e => {
      if (!matrixDragging) return;
      if (matrixColDragAnchor !== null) {
        const col = matrixColAt(e.target);
        if (col === null) return;
        const lastRow = Math.max(0, matrixShownRows - 1);
        setMatrixSelection({ row: 0, col: matrixColDragAnchor }, { row: lastRow, col });
        return;
      }
      const cell = matrixCellAt(e.target);
      if (!cell) return;
      setMatrixSelection(matrixAnchor, cell);
    });
    document.addEventListener('mouseup', () => { matrixDragging = false; matrixColDragAnchor = null; });

    el.matrixSetHeaderBtn.addEventListener('click', () => {
      if (!matrixSelection) return;
      const row = matrixSelection.r1;
      const dataStart = state.importDataStart <= row ? row + 1 : state.importDataStart;
      commitImport(row, dataStart);
      showToast('success', (row + 1) + '行目をヘッダーに設定しました');
    });
    el.matrixSetDataStartBtn.addEventListener('click', () => {
      if (!matrixSelection) return;
      commitImport(state.importHeaderRow, matrixSelection.r1);
    });
    el.matrixExcludeBtn.addEventListener('click', () => {
      if (!matrixSelection) return;
      for (let r = matrixSelection.r1; r <= matrixSelection.r2; r++) {
        if (r !== state.importHeaderRow) state.importExcludedRows.add(r);
      }
      commitImport(state.importHeaderRow, state.importDataStart);
      showToast('success', '選択範囲をデータから除外しました');
    });
    el.matrixIncludeBtn.addEventListener('click', () => {
      if (!matrixSelection) return;
      for (let r = matrixSelection.r1; r <= matrixSelection.r2; r++) state.importExcludedRows.delete(r);
      commitImport(state.importHeaderRow, state.importDataStart);
      showToast('success', '選択範囲の除外を解除しました');
    });
    el.matrixSetXBtn.addEventListener('click', () => {
      if (!matrixSelection || !state.raw) return;
      const col = state.raw.columns[matrixSelection.c1];
      if (!col) return;
      setXAxisColumn(col.name);
    });
    el.matrixAddSeriesBtn.addEventListener('click', () => {
      if (!matrixSelection || !state.raw) return;
      let added = 0, skipped = 0;
      for (let c = matrixSelection.c1; c <= matrixSelection.c2; c++) {
        const col = state.raw.columns[c];
        if (!col) continue;
        if (col.type !== 'number') { skipped++; continue; }
        if (state.chart.series.some(s => s.column === col.name)) continue;
        if (state.chart.series.length >= Palette.MAX_SERIES) { skipped++; continue; }
        addSeries(col.name);
        added++;
      }
      if (added > 0) {
        showToast('success', added + '列を系列に追加しました' + (skipped ? '（' + skipped + '列は対象外）' : ''));
      } else {
        showToast('warning', '数値の列を選択してください');
      }
    });
    el.openMatrixBtn.addEventListener('click', () => switchView('matrix'));
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
    state.importRaw = null;
    state.importSuggested = null;
    state.importHeaderRow = -1;
    state.importDataStart = 0;
    state.importExcludedRows = new Set();
    matrixSelection = null;
    matrixAnchor = null;
    matrixColDragAnchor = null;
    if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }
    el.fileInfo.hidden = true;
    el.columnSummary.hidden = true;
    el.importAdjust.hidden = true;
    el.importAdjust.open = false;
    el.matrixTab.hidden = true;
    el.metadataHint.hidden = true;
    el.stepTabQuery.disabled = true;
    el.stepTabChart.disabled = true;
    el.stepDataBadge.textContent = '1';
    el.stepDataBadge.classList.remove('done');
    switchStep('data');
    el.contentToolbar.hidden = true;
    el.chartCard.hidden = true;
    el.tableCard.hidden = true;
    el.statsCard.hidden = true;
    el.matrixCard.hidden = true;
    el.emptyState.hidden = false;
    el.fileInput.value = '';
    el.chartZoomResetBtn.hidden = true;
    el.chartZoomBox.hidden = true;
  }

  // ---------------------------------------------------------------
  // ステッパー（ステップ切替タブ）
  // ---------------------------------------------------------------

  function switchStep(step) {
    state.activeStep = step;
    [el.stepTabData, el.stepTabQuery, el.stepTabChart].forEach(btn => {
      const active = btn.dataset.step === step;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    el.stepDataPanel.hidden = step !== 'data';
    el.stepQuery.hidden = step !== 'query';
    el.stepChart.hidden = step !== 'chart';
  }

  function renderColumnChips() {
    el.columnSummary.hidden = false;
    el.columnChips.textContent = '';
    state.raw.columns.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'column-chip type-' + c.type;
      chip.draggable = true;
      chip.title = 'ドラッグしてX軸・グループ化・系列に設定';
      const mark = document.createElement('em');
      mark.textContent = TYPE_LABELS[c.type];
      const name = document.createElement('span');
      name.textContent = c.name;
      chip.append(mark, name);
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-column', c.name);
        if (c.type === 'number') e.dataTransfer.setData('application/x-column-number', c.name);
        e.dataTransfer.setData('text/plain', c.name);
        document.body.classList.add('dnd-column-active');
        requestAnimationFrame(() => chip.classList.add('dragging'));
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        document.body.classList.remove('dnd-column-active');
      });
      el.columnChips.appendChild(chip);
    });
  }

  // 直前にフォーカスしていたラベル系入力欄（メタデータチップの挿入先の記憶用）
  const LABEL_INPUT_IDS = ['chartTitleInput', 'xLabelInput', 'yLabelInput', 'histXLabelInput', 'histYLabelInput'];
  let lastFocusedLabelInput = null;

  /** 前置き行から抽出したメタデータを、タイトル・軸ラベルへワンクリックで挿入できるチップとして表示 */
  function renderMetadataChips() {
    const lines = (state.raw.meta.metadataLines || []).filter(Boolean);
    el.metadataHint.hidden = lines.length === 0;
    el.metadataCount.hidden = lines.length === 0;
    el.metadataCount.textContent = String(lines.length);
    el.metadataChips.textContent = '';
    lines.forEach(line => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip-btn';
      chip.textContent = line;
      chip.title = line + '（クリックで挿入）';
      chip.addEventListener('click', () => {
        const target = (lastFocusedLabelInput && document.contains(lastFocusedLabelInput)) ? lastFocusedLabelInput : el.chartTitleInput;
        target.value = target.value ? target.value + ' ' + line : line;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
      });
      el.metadataChips.appendChild(chip);
    });
  }

  /**
   * 要素を「列チップのドロップ先」にする。
   * numericOnly: 数値列のみ受け付ける（系列など）
   * onDrop: (columnName) => void
   */
  function bindColumnDropZone(zoneEl, { numericOnly, onDrop }) {
    if (!zoneEl) return;
    zoneEl.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('application/x-column')) return;
      if (numericOnly && !e.dataTransfer.types.includes('application/x-column-number')) {
        zoneEl.classList.add('drop-reject');
        return; // preventDefault しない → ブラウザが「ドロップ不可」カーソルを出す
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zoneEl.classList.add('drop-over');
    });
    zoneEl.addEventListener('dragleave', () => {
      zoneEl.classList.remove('drop-over', 'drop-reject');
    });
    zoneEl.addEventListener('drop', e => {
      zoneEl.classList.remove('drop-over', 'drop-reject');
      if (!e.dataTransfer.types.includes('application/x-column')) return;
      if (numericOnly && !e.dataTransfer.types.includes('application/x-column-number')) {
        showToast('warning', 'ここには数値の列だけドロップできます');
        return;
      }
      e.preventDefault();
      const column = e.dataTransfer.getData('application/x-column');
      if (column) onDrop(column);
    });
  }

  // ---------------------------------------------------------------
  // ステップ2: クエリ UI
  // ---------------------------------------------------------------

  let groupByPicker = null;

  function populateGroupBySelect() {
    // グループ化はカテゴリ・日付を先に（数値でのグループ化も可能）
    const ordered = [...state.raw.columns].sort((a, b) => {
      const rank = t => (t === 'string' ? 0 : t === 'date' ? 1 : 2);
      return rank(a.type) - rank(b.type);
    });
    const options = [{ value: '', label: 'なし（行をそのまま使う）', type: null }]
      .concat(ordered.map(c => ({ value: c.name, label: c.name, type: c.type })));
    el.groupBySelect.textContent = '';
    groupByPicker = createColumnPicker({
      options,
      value: state.query.groupBy,
      ariaLabel: 'グループ化して集計',
      onChange: val => {
        state.query.groupBy = val;
        syncGroupByUI();
        scheduleUpdate();
      }
    });
    el.groupBySelect.appendChild(groupByPicker);
    syncGroupByUI();
  }

  function populateSortSelect() {
    el.sortSelect.textContent = '';
    QueryEngine.SORTS.forEach(s => el.sortSelect.appendChild(makeOption(s.id, s.label)));
    el.sortSelect.value = state.query.sort;
  }

  function syncGroupByUI() {
    const grouped = !!state.query.groupBy;
    if (xPicker) xPicker.setDisabled(grouped);
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
    updateFilterCount();
  }

  function updateFilterCount() {
    const active = state.query.filters.filter(f => f.column && f.op && f.value !== '' && f.value !== null).length;
    el.filterCount.hidden = active === 0;
    el.filterCount.textContent = active;
  }

  /** ステッパー上の「処理」「グラフ」タブに件数バッジを表示（タブを開かなくても状況が分かる） */
  function updateStepperBadges() {
    if (!state.raw) return;
    const active = state.query.filters.filter(f => f.column && f.op && f.value !== '' && f.value !== null).length;
    el.queryStepCount.hidden = active === 0;
    el.queryStepCount.textContent = active;
    const seriesCount = state.chart.series.length;
    el.chartStepCount.hidden = seriesCount === 0;
    el.chartStepCount.textContent = seriesCount;
  }

  // ---------------------------------------------------------------
  // ステップ3: グラフ UI
  // ---------------------------------------------------------------

  let xPicker = null;

  function populateXSelect() {
    const options = [{ value: '', label: '行番号（1, 2, 3, …）', type: null }]
      .concat(state.raw.columns.map(c => ({ value: c.name, label: c.name, type: c.type })));
    el.xSelect.textContent = '';
    xPicker = createColumnPicker({
      options,
      value: state.chart.x,
      ariaLabel: 'X軸の列',
      onChange: val => { state.chart.x = val; scheduleUpdate(); }
    });
    el.xSelect.appendChild(xPicker);
    xPicker.setDisabled(!!state.query.groupBy);
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

  /** 系列を並び替える（ドラッグ・矢印ボタン共通） */
  function reorderSeries(from, to) {
    const arr = state.chart.series;
    if (isNaN(from) || from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    renderSeriesList();
    renderHistSeriesList();
    scheduleUpdate();
  }

  /** ドラッグハンドル（並び替え用の取っ手）を生成し、行への配置とドラッグ配線を行う */
  function createDragHandle(row, idx, label) {
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.draggable = true;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', label + 'をドラッグして並べ替え');
    handle.title = 'ドラッグして並べ替え';
    handle.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-series-reorder', String(idx));
      requestAnimationFrame(() => row.classList.add('dragging'));
    });
    handle.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('application/x-series-reorder')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', e => {
      if (!e.dataTransfer.types.includes('application/x-series-reorder')) return;
      e.preventDefault();
      row.classList.remove('drop-target');
      const from = parseInt(e.dataTransfer.getData('application/x-series-reorder'), 10);
      reorderSeries(from, idx);
    });
    return handle;
  }

  /** キーボードでも並び替えられる ↑/↓ ボタン（ドラッグのアクセシブルな代替） */
  function createReorderButtons(idx, total) {
    const wrap = document.createElement('span');
    wrap.className = 'reorder-btns';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '▲';
    up.setAttribute('aria-label', '1つ上へ移動');
    up.disabled = idx === 0;
    up.addEventListener('click', () => reorderSeries(idx, idx - 1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '▼';
    down.setAttribute('aria-label', '1つ下へ移動');
    down.disabled = idx === total - 1;
    down.addEventListener('click', () => reorderSeries(idx, idx + 1));
    wrap.append(up, down);
    return wrap;
  }

  /** XYモードの系列行 */
  function renderSeriesList() {
    if (!state.raw) return;
    el.seriesList.textContent = '';
    const nums = numericColumns();
    const grouped = !!state.query.groupBy;
    const total = state.chart.series.length;

    state.chart.series.forEach((series, idx) => {
      const row = document.createElement('div');
      row.className = 'series-row';

      const handle = createDragHandle(row, idx, series.column);

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = Palette.seriesColor(state.theme, series.slot);
      swatch.title = '系列カラー（' + Palette.SERIES_NAMES[series.slot] + '）';

      const colPicker = createColumnPicker({
        options: nums.map(c => ({ value: c.name, label: c.name, type: c.type })),
        value: series.column,
        ariaLabel: '系列の列',
        onChange: val => { series.column = val; scheduleUpdate(); }
      });
      colPicker.classList.add('grow');

      const aggSel = document.createElement('select');
      aggSel.setAttribute('aria-label', '集計方法');
      QueryEngine.AGGS.forEach(a => aggSel.appendChild(makeOption(a.id, a.label)));
      aggSel.value = series.agg || 'sum';
      aggSel.hidden = !grouped;

      const typeSel = document.createElement('select');
      typeSel.setAttribute('aria-label', 'グラフの種類');
      CHART_TYPES.forEach(t => typeSel.appendChild(makeOption(t.id, t.label)));
      typeSel.value = series.type;

      const reorderBtns = createReorderButtons(idx, total);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn sm';
      removeBtn.setAttribute('aria-label', 'この系列を削除');
      removeBtn.textContent = '×';
      removeBtn.disabled = state.chart.series.length <= 1;

      aggSel.addEventListener('change', () => { series.agg = aggSel.value; scheduleUpdate(); });
      typeSel.addEventListener('change', () => { series.type = typeSel.value; scheduleUpdate(); });
      removeBtn.addEventListener('click', () => {
        state.chart.series.splice(idx, 1);
        renderSeriesList();
        renderHistSeriesList();
        scheduleUpdate();
      });

      // 列名は独立した行に大きく確保し、集計・種類・並び替えは下段のコンパクトな行にまとめる
      // （1行に詰め込むと列ピッカーが幅0近くまで潰れ、列名が読めなくなるため）
      const mainLine = document.createElement('div');
      mainLine.className = 'series-row-main';
      mainLine.append(handle, swatch, colPicker, removeBtn);

      const subLine = document.createElement('div');
      subLine.className = 'series-row-sub';
      subLine.append(aggSel, typeSel, reorderBtns);

      row.append(mainLine, subLine);
      el.seriesList.appendChild(row);
    });

    el.addSeriesBtn.disabled = state.chart.series.length >= Palette.MAX_SERIES || nums.length === 0;
    el.addSeriesBtn.title = state.chart.series.length >= Palette.MAX_SERIES
      ? '系列は最大8つまでです（それ以上は「その他」への集約や複数グラフをご検討ください）'
      : '';
    updateStepperBadges();
  }

  /** ヒストグラムモードの対象列行（同じ series 配列を共有） */
  function renderHistSeriesList() {
    if (!state.raw) return;
    el.histSeriesList.textContent = '';
    const nums = numericColumns();
    const total = state.chart.series.length;

    state.chart.series.forEach((series, idx) => {
      const row = document.createElement('div');
      row.className = 'series-row';

      const handle = createDragHandle(row, idx, series.column);

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = Palette.seriesColor(state.theme, series.slot);

      const colPicker = createColumnPicker({
        options: nums.map(c => ({ value: c.name, label: c.name, type: c.type })),
        value: series.column,
        ariaLabel: '対象の列',
        onChange: val => { series.column = val; scheduleUpdate(); }
      });
      colPicker.classList.add('grow');

      const reorderBtns = createReorderButtons(idx, total);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn sm';
      removeBtn.setAttribute('aria-label', 'この列を削除');
      removeBtn.textContent = '×';
      removeBtn.disabled = state.chart.series.length <= 1;

      removeBtn.addEventListener('click', () => {
        state.chart.series.splice(idx, 1);
        renderSeriesList();
        renderHistSeriesList();
        scheduleUpdate();
      });

      const mainLine = document.createElement('div');
      mainLine.className = 'series-row-main';
      mainLine.append(handle, swatch, colPicker, reorderBtns, removeBtn);
      row.appendChild(mainLine);
      el.histSeriesList.appendChild(row);
    });

    el.addHistSeriesBtn.disabled = state.chart.series.length >= Palette.MAX_SERIES || nums.length === 0;
    updateStepperBadges();
  }

  /** 系列を1つ追加する。forcedColumn を指定すると（列チップのドロップ時など）その列を使う */
  function addSeries(forcedColumn) {
    const nums = numericColumns();
    if (!nums.length) return;
    if (state.chart.series.length >= Palette.MAX_SERIES) {
      showToast('warning', '系列は最大8つまでです');
      return;
    }
    let nextCol;
    if (forcedColumn) {
      if (state.chart.series.some(s => s.column === forcedColumn)) {
        showToast('info', '「' + forcedColumn + '」は既に系列に追加されています');
        return;
      }
      nextCol = nums.find(c => c.name === forcedColumn);
      if (!nextCol) return;
    } else {
      const usedCols = new Set(state.chart.series.map(s => s.column));
      nextCol = nums.find(c => !usedCols.has(c.name)) || nums[0];
    }
    const lastType = state.chart.series.length ? state.chart.series[state.chart.series.length - 1].type : 'bar';
    state.chart.series.push({ id: uid(), column: nextCol.name, agg: 'sum', type: lastType, slot: nextFreeSlot() });
    renderSeriesList();
    renderHistSeriesList();
    scheduleUpdate();
    if (forcedColumn) showToast('success', '「' + forcedColumn + '」を系列に追加しました');
  }

  /** X軸に列を割り当てる（列チップのドロップ・生データマトリクスからの割り当てで共用） */
  function setXAxisColumn(column) {
    state.chart.x = column;
    if (xPicker) xPicker.setValue(column);
    scheduleUpdate();
    showToast('success', 'X軸を「' + column + '」に設定しました');
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
    el.refLineCount.hidden = state.refLines.length === 0;
    el.refLineCount.textContent = state.refLines.length;
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
    el.refLineAccordion.open = true; // 追加した結果がすぐ見えるように展開
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

    // ステッパーのバッジ（フィルタ件数・系列数など、タブを開かなくても状況が分かるように）
    updateFilterCount();
    updateStepperBadges();

    // 軸ラベル・表示範囲コントロールの同期（データ範囲ヒント・スライダー等）
    syncAxisRangeUI(model);

    // グラフ描画
    const hasData = model && (model.mode === 'hist' ? model.series.length > 0 : model.labels.length > 0);
    if (hasData) {
      el.chartNotice.hidden = true;
      el.chartCanvas.hidden = false;
      const refs = state.refLines.filter(l => l.value !== null && l.value !== undefined && isFinite(l.value));
      const viewOptions = {
        refLines: refs,
        xRange: state.chart.mode === 'xy' ? state.chart.xy.xRange : {},
        yRange: state.chart.mode === 'xy' ? state.chart.xy.yRange : state.chart.hist.freqRange
      };
      state.chartInstance = Charts.render(el.chartCanvas, model, state.theme, viewOptions, state.chartInstance);
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

  // ---------------------------------------------------------------
  // 軸ラベル・表示範囲コントロール
  // ---------------------------------------------------------------

  function rangeHintText(ext) {
    return ext ? 'データの範囲: ' + Charts.fmt(ext.min) + ' 〜 ' + Charts.fmt(ext.max) : '';
  }

  /** モデルの実データ範囲に合わせて、範囲コントロールの表示切替・ヒント・スライダーを更新 */
  function syncAxisRangeUI(model) {
    if (state.chart.mode === 'xy') {
      const linear = !!(model && model.linear);
      el.xRangeNumericField.hidden = !linear;
      el.xIndexRangeField.hidden = linear;
      el.yRangeHint.textContent = model ? rangeHintText(model.yExtent) : '';
      el.xRangeHint.textContent = model && linear ? rangeHintText(model.xExtent) : '';
      if (!linear) syncIndexSlider(model);
    } else {
      el.histValueHint.textContent = model ? rangeHintText(model.dataExtent) : '';
    }
    updateChartZoomResetVisibility();
  }

  /** 範囲入力欄（空欄=自動）を数値または null に変換 */
  function parseRangeInput(inputEl) {
    const s = inputEl.value.trim();
    if (s === '') return null;
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
  }

  /** 範囲コントロールを自動（空欄）に戻す */
  function resetRange(kind) {
    switch (kind) {
      case 'xyY':
        state.chart.xy.yRange = { min: null, max: null };
        el.yRangeMin.value = ''; el.yRangeMax.value = '';
        break;
      case 'xyX':
        state.chart.xy.xRange = { min: null, max: null };
        el.xRangeMin.value = ''; el.xRangeMax.value = '';
        break;
      case 'xyIndex':
        state.chart.xy.xIndexRange = { start: null, end: null };
        break;
      case 'histValue':
        state.chart.hist.valueRange = { min: null, max: null };
        el.histValueMin.value = ''; el.histValueMax.value = '';
        break;
      case 'histFreq':
        state.chart.hist.freqRange = { min: null, max: null };
        el.histFreqMin.value = ''; el.histFreqMax.value = '';
        break;
      default: return;
    }
    scheduleUpdate();
  }

  /** カテゴリX軸の表示データ範囲を選ぶデュアルスライダーを同期 */
  function syncIndexSlider(model) {
    const count = model ? model.fullLabelCount : 0;
    const maxIdx = Math.max(0, count - 1);
    el.xIndexMin.min = 0; el.xIndexMin.max = maxIdx;
    el.xIndexMax.min = 0; el.xIndexMax.max = maxIdx;

    const range = state.chart.xy.xIndexRange;
    const start = range.start !== null ? Math.min(range.start, maxIdx) : 0;
    const end = range.end !== null ? Math.min(range.end, maxIdx) : maxIdx;
    el.xIndexMin.value = start;
    el.xIndexMax.value = end;
    el.xIndexMin.disabled = el.xIndexMax.disabled = count <= 1;

    const pct = v => maxIdx > 0 ? (v / maxIdx) * 100 : 0;
    el.xIndexFill.style.left = pct(start) + '%';
    el.xIndexFill.style.right = (100 - pct(end)) + '%';

    const labels = model ? model.fullLabels : [];
    el.xIndexFromLabel.textContent = labels[start] !== undefined ? labels[start] : '';
    el.xIndexToLabel.textContent = labels[end] !== undefined ? labels[end] : '';
  }

  // ---------------------------------------------------------------
  // グラフ上でのドラッグ操作（表示範囲をグラフ上で直接ズーム）
  // サイドバーの数値入力・スライダーと双方向に連動する：
  //   ドラッグでズーム → 数値入力欄にも反映 / 数値入力欄で調整 → グラフにも反映（既存動作）
  // 横方向のドラッグはX軸、縦方向はY軸、斜めなら両方を絞り込む。
  // ---------------------------------------------------------------

  let chartDragStart = null; // { x, y } キャンバス相対ピクセル（chartArea内にクランプ前の生値）
  let chartDragging = false;
  const CHART_DRAG_MIN_PX = 6; // これ未満の移動はクリック（ツールチップ用）とみなす

  function chartRelativePos(e) {
    return Chart.helpers.getRelativePosition(e, state.chartInstance);
  }

  function chartAreaClamp(pos) {
    const area = state.chartInstance.chartArea;
    return {
      x: Math.min(Math.max(pos.x, area.left), area.right),
      y: Math.min(Math.max(pos.y, area.top), area.bottom)
    };
  }

  function updateChartZoomBox(start, end) {
    el.chartZoomBox.style.left = Math.min(start.x, end.x) + 'px';
    el.chartZoomBox.style.top = Math.min(start.y, end.y) + 'px';
    el.chartZoomBox.style.width = Math.abs(end.x - start.x) + 'px';
    el.chartZoomBox.style.height = Math.abs(end.y - start.y) + 'px';
    el.chartZoomBox.hidden = false;
  }

  /** 現在いずれかの表示範囲が絞り込まれているか（リセットボタンの表示判定） */
  function hasActiveChartZoom() {
    if (state.chart.mode === 'hist') {
      const v = state.chart.hist.valueRange, f = state.chart.hist.freqRange;
      return v.min !== null || v.max !== null || f.min !== null || f.max !== null;
    }
    const y = state.chart.xy.yRange, x = state.chart.xy.xRange, idx = state.chart.xy.xIndexRange;
    return y.min !== null || y.max !== null || x.min !== null || x.max !== null || idx.start !== null || idx.end !== null;
  }

  function updateChartZoomResetVisibility() {
    if (el.chartZoomResetBtn) el.chartZoomResetBtn.hidden = !hasActiveChartZoom();
  }

  /** ピクセル→値変換の丸め誤差で 1795.00001488… のような値にならないよう、桁数に応じて丸める */
  function roundForRange(v) {
    if (!isFinite(v)) return v;
    const abs = Math.abs(v);
    if (abs === 0) return 0;
    const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
    const factor = Math.pow(10, digits);
    return Math.round(v * factor) / factor;
  }

  /**
   * ドラッグで選択した矩形（キャンバス相対ピクセル、chartArea内にクランプ済み）から
   * 実際の表示範囲を計算して state に反映する。applyX/applyY で軸ごとに適用するか選べる
   * （横方向だけのドラッグでY軸を意図せず絞り込まないようにするため）。
   */
  function applyChartZoomFromPixels(p1, p2, applyX, applyY) {
    const chart = state.chartInstance;
    const model = state.lastModel;
    if (!chart || !model) return;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;

    if (applyY) {
      const yMin = roundForRange(yScale.getValueForPixel(Math.max(p1.y, p2.y)));
      const yMax = roundForRange(yScale.getValueForPixel(Math.min(p1.y, p2.y)));
      if (model.mode === 'hist') {
        state.chart.hist.freqRange = { min: Math.max(0, yMin), max: yMax };
      } else {
        state.chart.xy.yRange = { min: yMin, max: yMax };
      }
    }

    if (applyX) {
      const px1 = Math.min(p1.x, p2.x), px2 = Math.max(p1.x, p2.x);
      if (model.mode === 'hist') {
        const i1 = xScale.getValueForPixel(px1);
        const i2 = xScale.getValueForPixel(px2);
        const v1 = roundForRange(model.bins.min + i1 * model.bins.width);
        const v2 = roundForRange(model.bins.min + i2 * model.bins.width);
        state.chart.hist.valueRange = { min: Math.min(v1, v2), max: Math.max(v1, v2) };
      } else if (model.linear) {
        const x1 = roundForRange(xScale.getValueForPixel(px1));
        const x2 = roundForRange(xScale.getValueForPixel(px2));
        state.chart.xy.xRange = { min: Math.min(x1, x2), max: Math.max(x1, x2) };
      } else {
        const i1 = xScale.getValueForPixel(px1);
        const i2 = xScale.getValueForPixel(px2);
        const base = model.xIndexRange.start;
        const fullMax = Math.max(0, model.fullLabelCount - 1);
        let start = Math.round(base + Math.min(i1, i2));
        let end = Math.round(base + Math.max(i1, i2));
        start = Math.max(0, Math.min(start, fullMax));
        end = Math.max(start, Math.min(end, fullMax));
        state.chart.xy.xIndexRange = { start, end };
      }
    }

    syncRangeInputs();
    const accordion = document.querySelector(model.mode === 'hist' ? '#histSettings .axis-adjust' : '#xySettings .axis-adjust');
    if (accordion) accordion.open = true;
    scheduleUpdate();
    updateChartZoomResetVisibility();
  }

  /** グラフ上のドラッグズームを解除し、両軸とも自動表示に戻す */
  function resetChartZoom() {
    if (!state.raw) return;
    if (state.chart.mode === 'hist') {
      resetRange('histValue');
      resetRange('histFreq');
    } else {
      resetRange('xyY');
      if (state.lastModel && state.lastModel.linear) resetRange('xyX');
      else resetRange('xyIndex');
    }
    updateChartZoomResetVisibility();
  }

  function initChartZoom() {
    el.chartCanvas.addEventListener('mousedown', e => {
      if (!state.chartInstance || !state.lastModel || e.button !== 0) return;
      const pos = chartRelativePos(e);
      const area = state.chartInstance.chartArea;
      if (pos.x < area.left || pos.x > area.right || pos.y < area.top || pos.y > area.bottom) return;
      chartDragging = true;
      chartDragStart = pos;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!chartDragging || !state.chartInstance) return;
      updateChartZoomBox(chartDragStart, chartAreaClamp(chartRelativePos(e)));
    });

    document.addEventListener('mouseup', e => {
      if (!chartDragging) return;
      chartDragging = false;
      el.chartZoomBox.hidden = true;
      if (!state.chartInstance) { chartDragStart = null; return; }
      const pos = chartAreaClamp(chartRelativePos(e));
      const dx = Math.abs(pos.x - chartDragStart.x);
      const dy = Math.abs(pos.y - chartDragStart.y);
      const applyX = dx >= CHART_DRAG_MIN_PX;
      const applyY = dy >= CHART_DRAG_MIN_PX;
      if (applyX || applyY) applyChartZoomFromPixels(chartDragStart, pos, applyX, applyY);
      chartDragStart = null;
    });

    el.chartCanvas.addEventListener('dblclick', () => resetChartZoom());
    el.chartZoomResetBtn.addEventListener('click', resetChartZoom);
  }

  function buildTitle() {
    const s = state.chart;
    if (s.title && s.title.trim()) return s.title.trim();
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
    el.matrixCard.hidden = view !== 'matrix';
    if (view === 'chart' && state.chartInstance) {
      // 非表示中にレイアウトが変わっている可能性があるため再計測
      requestAnimationFrame(() => state.chartInstance && state.chartInstance.resize());
    }
    if (view === 'matrix') syncMatrixColumnRoles();
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
  // プリセット — 取り込み設定・フィルタ・グラフ設定など「処理ステップ」一式を
  // 名前付きで記憶し、保存・書き出し（JSON）・読み込みで使い回せるようにする。
  // 以前「クエリ化」として依頼された内容の本来の意図はこちら（フィルタ/並び替え
  // だけのSQL風プレビューではなく、処理全体を再利用可能な形で残すこと）だったため、
  // その意図を汲んで実装している。
  // ---------------------------------------------------------------

  const PRESET_STORAGE_KEY = 'chartlab-presets';
  let presets = [];

  function loadPresetsFromStorage() {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      presets = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      presets = [];
    }
  }

  function savePresetsToStorage() {
    try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets)); } catch (e) { /* 容量超過・プライベートモード等 */ }
  }

  /** 現在の状態から、再現に必要な処理ステップ一式を抜き出す */
  function serializeCurrentConfig(name) {
    return {
      id: 'preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name,
      createdAt: new Date().toISOString(),
      version: 1,
      importStructure: state.importRaw ? {
        headerRowIndex: state.importHeaderRow,
        dataStartRowIndex: state.importDataStart,
        excludedRows: [...state.importExcludedRows]
      } : null,
      query: {
        filters: state.query.filters.map(f => ({ column: f.column, op: f.op, value: f.value })),
        groupBy: state.query.groupBy,
        sort: state.query.sort,
        limit: state.query.limit
      },
      chart: {
        mode: state.chart.mode,
        x: state.chart.x,
        series: state.chart.series.map(s => ({ column: s.column, agg: s.agg, type: s.type, slot: s.slot })),
        stacked: state.chart.stacked,
        bins: { ...state.chart.bins },
        normalCurve: state.chart.normalCurve,
        title: state.chart.title,
        xy: {
          xLabel: state.chart.xy.xLabel,
          yLabel: state.chart.xy.yLabel,
          xRange: { ...state.chart.xy.xRange },
          yRange: { ...state.chart.xy.yRange },
          xIndexRange: { ...state.chart.xy.xIndexRange }
        },
        hist: {
          xLabel: state.chart.hist.xLabel,
          yLabel: state.chart.hist.yLabel,
          valueRange: { ...state.chart.hist.valueRange },
          freqRange: { ...state.chart.hist.freqRange }
        }
      },
      refLines: state.refLines.map(l => ({ label: l.label, value: l.value }))
    };
  }

  function presetSummary(preset) {
    const parts = [];
    if (preset.importStructure) parts.push('取り込み設定あり');
    const filterCount = preset.query && preset.query.filters ? preset.query.filters.length : 0;
    if (filterCount) parts.push('フィルタ' + filterCount + '件');
    const seriesCount = preset.chart && preset.chart.series ? preset.chart.series.length : 0;
    parts.push('系列' + seriesCount + '件');
    parts.push(preset.chart && preset.chart.mode === 'hist' ? 'ヒストグラム' : 'XYグラフ');
    return parts.join('・');
  }

  function renderPresetList() {
    el.presetCount.hidden = presets.length === 0;
    el.presetCount.textContent = presets.length;
    el.presetList.textContent = '';
    if (presets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'preset-list-empty';
      empty.textContent = 'まだ保存されたプリセットはありません';
      el.presetList.appendChild(empty);
      return;
    }
    presets.forEach(preset => {
      const row = document.createElement('div');
      row.className = 'preset-row';

      const info = document.createElement('div');
      info.className = 'preset-row-info';
      const name = document.createElement('strong');
      name.textContent = preset.name;
      const detail = document.createElement('small');
      const date = new Date(preset.createdAt);
      const dateStr = isNaN(date.getTime()) ? '' : (date.getMonth() + 1) + '/' + date.getDate() + ' 保存 ・ ';
      detail.textContent = dateStr + presetSummary(preset);
      info.append(name, detail);

      const actions = document.createElement('div');
      actions.className = 'preset-row-actions';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn ghost sm';
      applyBtn.textContent = '適用';
      applyBtn.addEventListener('click', () => applyPreset(preset));

      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'icon-btn sm';
      exportBtn.setAttribute('aria-label', 'プリセットを書き出し');
      exportBtn.title = 'ファイルに書き出す';
      exportBtn.textContent = '↓';
      exportBtn.addEventListener('click', () => exportPreset(preset));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn sm';
      deleteBtn.setAttribute('aria-label', 'プリセットを削除');
      deleteBtn.title = '削除';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => deletePreset(preset.id));

      actions.append(applyBtn, exportBtn, deleteBtn);
      row.append(info, actions);
      el.presetList.appendChild(row);
    });
  }

  function saveCurrentAsPreset() {
    const name = el.presetNameInput.value.trim() || ('プリセット ' + (presets.length + 1));
    const preset = serializeCurrentConfig(name);
    presets.unshift(preset);
    savePresetsToStorage();
    renderPresetList();
    el.presetNameInput.value = '';
    showToast('success', '「' + name + '」を保存しました');
  }

  function deletePreset(id) {
    presets = presets.filter(p => p.id !== id);
    savePresetsToStorage();
    renderPresetList();
  }

  function exportPreset(preset) {
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeName = preset.name.replace(/[\\/:*?"<>|]/g, '_');
    a.download = 'preset_' + safeName + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast('success', 'プリセットを書き出しました');
  }

  function importPresetFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (err) {
        showToast('error', 'プリセットファイルの読み込みに失敗しました（JSON形式ではありません）');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || !parsed.chart || !parsed.query) {
        showToast('error', 'プリセットファイルの形式が正しくありません');
        return;
      }
      parsed.id = 'preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      parsed.name = parsed.name || 'インポートしたプリセット';
      presets.unshift(parsed);
      savePresetsToStorage();
      renderPresetList();
      showToast('success', '「' + parsed.name + '」を読み込みました');
    };
    reader.onerror = () => showToast('error', 'ファイルの読み込みに失敗しました');
    reader.readAsText(file);
  }

  /** 保存済みプリセットを現在のデータへ適用する（列名が一致しない設定は安全に読み飛ばす） */
  function applyPreset(preset) {
    if (!state.raw) { showToast('warning', '先にデータを読み込んでから適用してください'); return; }

    const applyQueryAndChart = () => {
      const cols = state.raw.columns;
      const numCols = new Set(cols.filter(c => c.type === 'number').map(c => c.name));
      const colExists = name => cols.some(c => c.name === name);

      const q = preset.query || {};
      state.query = {
        filters: (q.filters || []).filter(f => colExists(f.column)).map(f => ({ column: f.column, op: f.op, value: f.value })),
        groupBy: q.groupBy && colExists(q.groupBy) ? q.groupBy : '',
        sort: q.sort || 'auto',
        limit: q.limit || null
      };

      const c = preset.chart || {};
      state.chart.mode = c.mode === 'hist' ? 'hist' : 'xy';
      state.chart.x = c.x && colExists(c.x) ? c.x : '';
      state.chart.series = (c.series || [])
        .filter(s => numCols.has(s.column))
        .map(s => ({ id: uid(), column: s.column, agg: s.agg || 'sum', type: s.type || 'bar', slot: typeof s.slot === 'number' ? s.slot : nextFreeSlot() }));
      state.chart.stacked = !!c.stacked;
      state.chart.normalCurve = !!c.normalCurve;
      state.chart.bins = { method: (c.bins && c.bins.method) || 'sturges', count: (c.bins && c.bins.count) || 10 };
      state.chart.title = c.title || '';
      state.chart.xy = {
        xLabel: (c.xy && c.xy.xLabel) || '',
        yLabel: (c.xy && c.xy.yLabel) || '',
        xRange: { min: (c.xy && c.xy.xRange && c.xy.xRange.min) ?? null, max: (c.xy && c.xy.xRange && c.xy.xRange.max) ?? null },
        yRange: { min: (c.xy && c.xy.yRange && c.xy.yRange.min) ?? null, max: (c.xy && c.xy.yRange && c.xy.yRange.max) ?? null },
        xIndexRange: { start: (c.xy && c.xy.xIndexRange && c.xy.xIndexRange.start) ?? null, end: (c.xy && c.xy.xIndexRange && c.xy.xIndexRange.end) ?? null }
      };
      state.chart.hist = {
        xLabel: (c.hist && c.hist.xLabel) || '',
        yLabel: (c.hist && c.hist.yLabel) || '',
        valueRange: { min: (c.hist && c.hist.valueRange && c.hist.valueRange.min) ?? null, max: (c.hist && c.hist.valueRange && c.hist.valueRange.max) ?? null },
        freqRange: { min: (c.hist && c.hist.freqRange && c.hist.freqRange.min) ?? null, max: (c.hist && c.hist.freqRange && c.hist.freqRange.max) ?? null }
      };
      state.refLines = (preset.refLines || []).map(l => ({ id: uid(), label: l.label || '', value: l.value }));

      syncAllUIFromState();
      switchStep('chart');
      showToast('success', 'プリセット「' + preset.name + '」を適用しました');
    };

    if (preset.importStructure && state.importRaw) {
      state.importExcludedRows = new Set(preset.importStructure.excludedRows || []);
      commitImport(preset.importStructure.headerRowIndex, preset.importStructure.dataStartRowIndex);
    }
    applyQueryAndChart();
  }

  /** state.query / state.chart / state.refLines の内容を、すべての入力欄・一覧表示へ反映する */
  /** 表示範囲の数値入力欄8つを state の値に同期する（プリセット適用・グラフ上ドラッグ操作の後で使用） */
  function syncRangeInputs() {
    el.yRangeMin.value = state.chart.xy.yRange.min ?? '';
    el.yRangeMax.value = state.chart.xy.yRange.max ?? '';
    el.xRangeMin.value = state.chart.xy.xRange.min ?? '';
    el.xRangeMax.value = state.chart.xy.xRange.max ?? '';
    el.histValueMin.value = state.chart.hist.valueRange.min ?? '';
    el.histValueMax.value = state.chart.hist.valueRange.max ?? '';
    el.histFreqMin.value = state.chart.hist.freqRange.min ?? '';
    el.histFreqMax.value = state.chart.hist.freqRange.max ?? '';
  }

  function syncAllUIFromState() {
    populateXSelect();
    populateGroupBySelect(); // 内部で syncGroupByUI() → renderSeriesList() も走る
    el.sortSelect.value = state.query.sort;
    el.limitInput.value = state.query.limit || '';
    el.stackedToggle.checked = state.chart.stacked;
    el.normalCurveToggle.checked = state.chart.normalCurve;
    el.binMethodSelect.value = state.chart.bins.method;
    el.binCountRange.value = state.chart.bins.count;
    el.binCountOut.textContent = state.chart.bins.count;
    el.binCountField.hidden = state.chart.bins.method !== 'custom';
    el.chartTitleInput.value = state.chart.title;
    el.xLabelInput.value = state.chart.xy.xLabel;
    el.yLabelInput.value = state.chart.xy.yLabel;
    el.histXLabelInput.value = state.chart.hist.xLabel;
    el.histYLabelInput.value = state.chart.hist.yLabel;
    syncRangeInputs();
    setMode(state.chart.mode, true);
    renderFilters();
    renderHistSeriesList();
    renderRefLines();
    scheduleUpdate();
  }

  // ---------------------------------------------------------------
  // イベント結線
  // ---------------------------------------------------------------

  function bindEvents() {
    el.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    // ステッパー（ステップ切替タブ）
    [el.stepTabData, el.stepTabQuery, el.stepTabChart].forEach(btn => {
      btn.addEventListener('click', () => switchStep(btn.dataset.step));
    });

    // 列チップのドラッグ＆ドロップ — X軸・グループ化・系列へ直接割り当て
    bindColumnDropZone(el.xAxisDropZone, {
      numericOnly: false,
      onDrop: column => setXAxisColumn(column)
    });
    bindColumnDropZone(el.groupByDropZone, {
      numericOnly: false,
      onDrop: column => {
        state.query.groupBy = column;
        if (groupByPicker) groupByPicker.setValue(column);
        syncGroupByUI();
        scheduleUpdate();
        showToast('success', '「' + column + '」でグループ化しました');
      }
    });
    bindColumnDropZone(el.seriesList, { numericOnly: true, onDrop: column => addSeries(column) });
    bindColumnDropZone(el.histSeriesList, { numericOnly: true, onDrop: column => addSeries(column) });

    // ファイル読み込み（ドラッグ＆ドロップは画面全体で受け付ける — initWindowFileDrop 参照）
    el.dropArea.addEventListener('click', () => el.fileInput.click());
    el.dropArea.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
    });
    initWindowFileDrop();
    el.fileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files.length) handleFile(e.target.files[0]);
    });
    el.removeFileBtn.addEventListener('click', clearData);

    // 取り込み設定（ヘッダー行・データ開始行）
    el.importHeaderRow.addEventListener('change', () => {
      let v = parseInt(el.importHeaderRow.value, 10);
      if (!isFinite(v) || v < 0) v = 0;
      const header = v === 0 ? -1 : v - 1;
      let dataStart = state.importDataStart;
      if (header >= 0 && dataStart <= header) dataStart = header + 1;
      commitImport(header, dataStart);
    });
    el.importDataStartRow.addEventListener('change', () => {
      let v = parseInt(el.importDataStartRow.value, 10);
      if (!isFinite(v) || v < 1) v = 1;
      commitImport(state.importHeaderRow, v - 1);
    });
    el.importAutoBtn.addEventListener('click', () => {
      if (!state.importSuggested) return;
      state.importExcludedRows = new Set();
      commitImport(state.importSuggested.headerRowIndex, state.importSuggested.dataStartRowIndex);
    });
    initMatrixEvents();
    initChartZoom();
    initColumnPickerGlobalHandlers();

    // クエリ
    el.addFilterBtn.addEventListener('click', () => {
      const first = state.raw.columns.find(c => c.type === 'string') || state.raw.columns[0];
      state.query.filters.push({ column: first.name, op: QueryEngine.opsFor(first.type)[0].id, value: '' });
      renderFilters();
    });
    el.sortSelect.addEventListener('change', () => { state.query.sort = el.sortSelect.value; scheduleUpdate(); });
    el.limitInput.addEventListener('input', () => {
      const v = parseInt(el.limitInput.value, 10);
      state.query.limit = isFinite(v) && v > 0 ? v : null;
      scheduleUpdate();
    });
    el.copyQueryBtn.addEventListener('click', copyQuery);

    // プリセット
    el.savePresetBtn.addEventListener('click', saveCurrentAsPreset);
    el.presetNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveCurrentAsPreset(); }
    });
    el.importPresetBtn.addEventListener('click', () => el.presetFileInput.click());
    el.presetFileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files.length) importPresetFromFile(e.target.files[0]);
      el.presetFileInput.value = '';
    });

    // グラフ設定
    el.modeSegment.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode, false));
    });
    el.addSeriesBtn.addEventListener('click', () => addSeries());
    el.addHistSeriesBtn.addEventListener('click', () => addSeries());
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

    // グラフタイトル
    el.chartTitleInput.addEventListener('input', () => {
      state.chart.title = el.chartTitleInput.value;
      scheduleUpdate();
    });

    // メタデータチップの挿入先を、直前にフォーカスしていたラベル欄にする
    LABEL_INPUT_IDS.forEach(id => {
      el[id].addEventListener('focus', () => { lastFocusedLabelInput = el[id]; });
    });

    // 軸ラベル・表示範囲（XY）
    el.xLabelInput.addEventListener('input', () => { state.chart.xy.xLabel = el.xLabelInput.value; scheduleUpdate(); });
    el.yLabelInput.addEventListener('input', () => { state.chart.xy.yLabel = el.yLabelInput.value; scheduleUpdate(); });
    el.yRangeMin.addEventListener('input', () => { state.chart.xy.yRange.min = parseRangeInput(el.yRangeMin); scheduleUpdate(); });
    el.yRangeMax.addEventListener('input', () => { state.chart.xy.yRange.max = parseRangeInput(el.yRangeMax); scheduleUpdate(); });
    el.xRangeMin.addEventListener('input', () => { state.chart.xy.xRange.min = parseRangeInput(el.xRangeMin); scheduleUpdate(); });
    el.xRangeMax.addEventListener('input', () => { state.chart.xy.xRange.max = parseRangeInput(el.xRangeMax); scheduleUpdate(); });

    // 表示するデータ範囲（カテゴリX軸のインデックス範囲スライダー）
    el.xIndexMin.addEventListener('input', () => {
      let min = parseInt(el.xIndexMin.value, 10);
      const max = parseInt(el.xIndexMax.value, 10);
      if (min > max) { min = max; el.xIndexMin.value = min; }
      state.chart.xy.xIndexRange.start = min;
      state.chart.xy.xIndexRange.end = max;
      scheduleUpdate();
    });
    el.xIndexMax.addEventListener('input', () => {
      const min = parseInt(el.xIndexMin.value, 10);
      let max = parseInt(el.xIndexMax.value, 10);
      if (max < min) { max = min; el.xIndexMax.value = max; }
      state.chart.xy.xIndexRange.start = min;
      state.chart.xy.xIndexRange.end = max;
      scheduleUpdate();
    });

    // 軸ラベル・表示範囲（ヒストグラム）
    el.histXLabelInput.addEventListener('input', () => { state.chart.hist.xLabel = el.histXLabelInput.value; scheduleUpdate(); });
    el.histYLabelInput.addEventListener('input', () => { state.chart.hist.yLabel = el.histYLabelInput.value; scheduleUpdate(); });
    el.histValueMin.addEventListener('input', () => { state.chart.hist.valueRange.min = parseRangeInput(el.histValueMin); scheduleUpdate(); });
    el.histValueMax.addEventListener('input', () => { state.chart.hist.valueRange.max = parseRangeInput(el.histValueMax); scheduleUpdate(); });
    el.histFreqMin.addEventListener('input', () => { state.chart.hist.freqRange.min = parseRangeInput(el.histFreqMin); scheduleUpdate(); });
    el.histFreqMax.addEventListener('input', () => { state.chart.hist.freqRange.max = parseRangeInput(el.histFreqMax); scheduleUpdate(); });

    // 範囲リセットボタン
    document.querySelectorAll('.link-btn[data-reset]').forEach(btn => {
      btn.addEventListener('click', () => resetRange(btn.dataset.reset));
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
    loadPresetsFromStorage();
    renderPresetList();
    bindEvents();
    switchStep('data');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
