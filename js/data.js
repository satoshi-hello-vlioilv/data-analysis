/**
 * データ層 — ファイル読込・ヘッダー抽出・型推論・サンプルデータ
 *
 * CSV / Excel を「行列（配列の配列 = AOA）」に正規化した上で、3段のパイプ
 * ラインに通します。
 *   1. parseFileRaw    — ファイル → AOA（生の行列、フィルタ・加工なし）
 *   2. suggestStructure — AOA → ヘッダー行・データ開始行の推定（ヒューリスティック）
 *   3. buildTable       — AOA + ヘッダー行/データ開始行 → { rows, columns, meta }
 *                          （列名の補完・重複解消、列ごとの型推論と値の正規化）
 * 2と3を分離しているのは、UI側でヘッダー行/データ開始行を手動調整できるように
 * するため（自動推定はあくまで初期値の提案）。
 */
const DataLayer = (() => {
  'use strict';

  // ---------------------------------------------------------------
  // 値の判定・変換ヘルパー
  // ---------------------------------------------------------------

  /** 数値として解釈できるか（"1,234" "45%" "  12.5 " も許容） */
  function isNumLike(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string') return false;
    const s = v.trim().replace(/,/g, '').replace(/[%％]$/, '');
    if (s === '' || s === '-' || s === '+') return false;
    return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
  }

  /** 数値へ変換（できなければ null） */
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/,/g, '').replace(/[%％]$/, '');
    if (!isNumLike(s)) return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  const DATE_PATTERNS = [
    /^\d{4}[-/年]\d{1,2}([-/月]\d{1,2}日?)?$/, // 2024-01-05 / 2024/1/5 / 2024年1月 / 2024-01
    /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/,           // 05/01/2024
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}/ // 2024-01-05 12:30
  ];

  /** 日付文字列として解釈できるか */
  function isDateLike(v) {
    if (v instanceof Date) return !isNaN(v.getTime());
    if (typeof v !== 'string') return false;
    const s = v.trim();
    return DATE_PATTERNS.some(re => re.test(s)) && parseDate(s) !== null;
  }

  /** タイムスタンプ（ms）へ変換（できなければ null）。ソート・比較用 */
  function parseDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    if (typeof v !== 'string') return null;
    let s = v.trim()
      .replace(/年|月/g, '-')
      .replace(/日/g, '')
      .replace(/\//g, '-');
    if (/^\d{4}-\d{1,2}$/.test(s)) s += '-1'; // 年月のみ → 月初
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})([ T](\d{1,2}):(\d{2})(:(\d{2}))?)?$/.exec(s);
    if (m) {
      const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[5] || 0), +(m[6] || 0), +(m[8] || 0)).getTime();
      return isNaN(t) ? null : t;
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  /** Date → "YYYY-MM-DD" */
  function formatDate(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function isEmptyCell(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  }

  // ---------------------------------------------------------------
  // 1. ファイル読込 → 生の行列（AOA）
  // ---------------------------------------------------------------

  /**
   * バイト列 → 文字列。まずUTF-8として厳密にデコードし、不正なバイト列（=UTF-8ではない）
   * であればShift-JIS（CP932）として再デコードする。日本語圏のExcelはCSVをShift-JISで
   * 出力することが多く、既定でUTF-8扱いすると文字化けするため。
   */
  function decodeTextBuffer(buffer) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'UTF-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('shift-jis', { fatal: true }).decode(buffer), encoding: 'Shift_JIS' };
      } catch (e2) {
        // どちらでも厳密デコードできない場合は、UTF-8で緩くデコードして読み込みだけは継続する
        return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'UTF-8' };
      }
    }
  }

  /** CSV / TSV ファイル → 生の行列（フィルタ・型推論なし、行番号を保つ） */
  function parseCSVRaw(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const { text } = decodeTextBuffer(e.target.result);
        Papa.parse(text, {
          header: false,
          dynamicTyping: false,
          skipEmptyLines: false,
          delimitersToGuess: [',', '\t', ';', '|'],
          complete: results => {
            if (!results.data || results.data.length === 0) {
              reject(new Error('ファイルにデータが含まれていません'));
              return;
            }
            const aoa = results.data;
            // BOM 除去（TextDecoderが除去しない場合の保険）
            if (typeof aoa[0][0] === 'string') aoa[0][0] = aoa[0][0].replace(/^﻿/, '');
            resolve({ aoa, sourceName: file.name });
          },
          error: err => reject(new Error('CSVの解析に失敗しました: ' + err.message))
        });
      };
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
      reader.readAsArrayBuffer(file);
    });
  }

  /** Excel (.xlsx / .xls) ファイル → 生の行列（先頭シート） */
  function parseExcelRaw(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          const sheetName = wb.SheetNames[0];
          if (!sheetName) { reject(new Error('シートが見つかりません')); return; }
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
          if (aoa.length === 0) { reject(new Error('シートにデータが含まれていません')); return; }
          resolve({ aoa, sourceName: file.name + ' (' + sheetName + ')' });
        } catch (err) {
          reject(new Error('Excelの解析に失敗しました: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
      reader.readAsArrayBuffer(file);
    });
  }

  /** 拡張子で振り分け → { aoa, sourceName } */
  function parseFileRaw(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseExcelRaw(file);
    if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return parseCSVRaw(file);
    return Promise.reject(new Error('対応していないファイル形式です（CSV / TSV / XLSX / XLS）'));
  }

  // ---------------------------------------------------------------
  // 2. 構造推定 — ヘッダー行・データ開始行をヒューリスティックで提案
  // ---------------------------------------------------------------

  /**
   * AOA → { headerRowIndex, dataStartRowIndex }（いずれも0始まりの行番号）
   * headerRowIndex = -1 はヘッダー行なしを意味する。
   * あくまで初期値の「提案」であり、UI側で手動上書き可能。
   */
  function suggestStructure(aoa) {
    const nonBlank = []; // 元の行番号のうち非空行のインデックス
    aoa.forEach((row, i) => {
      if (Array.isArray(row) && row.some(c => !isEmptyCell(c))) nonBlank.push(i);
    });
    if (nonBlank.length === 0) return { headerRowIndex: -1, dataStartRowIndex: 0 };

    const grid = nonBlank.map(i => aoa[i]);

    // 本来の列数 = 非空セル数の最頻値（先頭50行から推定）
    const counts = grid.slice(0, 50).map(r => r.filter(c => !isEmptyCell(c)).length);
    const freq = {};
    counts.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
    let bodyWidth = 1;
    let best = 0;
    Object.keys(freq).forEach(k => {
      const n = +k;
      if (freq[k] > best || (freq[k] === best && n > bodyWidth)) { best = freq[k]; bodyWidth = n; }
    });

    // 前置きのタイトル行（本体より明らかにセル数が少ない行）を先頭から最大5行スキップ
    let skipped = 0;
    while (
      skipped < Math.min(5, grid.length - 1) &&
      bodyWidth >= 2 &&
      grid[skipped].filter(c => !isEmptyCell(c)).length < Math.max(2, Math.ceil(bodyWidth / 2))
    ) {
      skipped++;
    }

    const candPos = skipped; // grid上の位置
    const cand = grid[candPos];
    const body = grid.slice(candPos + 1, candPos + 26);
    const width = Math.max(...grid.slice(candPos).map(r => r.length));
    let hasHeader = false;

    if (grid.length - candPos <= 1) {
      hasHeader = false; // 1行だけならデータ行とみなす
    } else {
      let score = 0;
      for (let c = 0; c < width; c++) {
        const cell = cand[c];
        if (isEmptyCell(cell)) continue;
        const bodyVals = body.map(r => r[c]).filter(v => !isEmptyCell(v));
        if (bodyVals.length === 0) continue;
        const numRatio = bodyVals.filter(isNumLike).length / bodyVals.length;
        const dateRatio = bodyVals.filter(isDateLike).length / bodyVals.length;
        const candIsNum = isNumLike(cell);
        const candIsDate = isDateLike(cell);
        if (!candIsNum && !candIsDate && (numRatio >= 0.7 || dateRatio >= 0.7)) {
          score += 2; // 本体は数値/日付なのに先頭だけ文字列 → ヘッダーらしい
        } else if (candIsNum && numRatio >= 0.7) {
          score -= 2; // 先頭も数値 → データ行らしい
        } else if (candIsDate && dateRatio >= 0.7) {
          score -= 2;
        }
      }
      if (score > 0) {
        hasHeader = true;
      } else if (score === 0) {
        const cells = cand.slice(0, width);
        const nonEmpty = cells.filter(c => !isEmptyCell(c));
        const uniq = new Set(nonEmpty.map(c => String(c).trim()));
        hasHeader = nonEmpty.length === width &&
          nonEmpty.every(c => !isNumLike(c)) &&
          uniq.size === nonEmpty.length;
      }
    }

    const headerRowIndex = hasHeader ? nonBlank[candPos] : -1;
    const dataStartRowIndex = hasHeader ? nonBlank[candPos] + 1 : nonBlank[candPos];
    return { headerRowIndex, dataStartRowIndex };
  }

  // ---------------------------------------------------------------
  // 3. テーブル構築 — 指定したヘッダー行/データ開始行で確定
  // ---------------------------------------------------------------

  /**
   * AOA + ヘッダー行/データ開始行 → { rows, columns, meta }
   * headerRowIndex: -1 = ヘッダーなし（列名は「列1」「列2」…を自動生成）
   * dataStartRowIndex: この行（0始まり）からをデータ本体として扱う
   * excludedRows: データ開始行以降にあっても除外したい行番号（0始まり）の Set。
   *   注記・小計行などがデータの途中や末尾に混在する複雑な形式に対応するため。
   */
  function buildTable(aoa, headerRowIndex, dataStartRowIndex, sourceName, excludedRows) {
    excludedRows = excludedRows || new Set();
    const hasHeader = headerRowIndex !== null && headerRowIndex !== undefined && headerRowIndex >= 0 && headerRowIndex < aoa.length;
    const startIndex = Math.max(0, Math.min(dataStartRowIndex, aoa.length));
    const headerRow = hasHeader ? aoa[headerRowIndex] : null;

    const bodyRows = aoa
      .slice(startIndex)
      .filter((row, i) => {
        const idx = startIndex + i;
        return idx !== headerRowIndex && !excludedRows.has(idx); // ヘッダー行・手動除外行は二重計上しない
      })
      .filter(row => Array.isArray(row) && row.some(c => !isEmptyCell(c)));

    const width = Math.max(
      headerRow ? headerRow.length : 0,
      ...bodyRows.map(r => r.length),
      1
    );

    if (bodyRows.length === 0 && !hasHeader) {
      throw new Error('データが含まれていません（データ開始行を見直してください）');
    }

    // --- 列名の決定（空欄補完・重複解消） ---
    const names = [];
    const used = new Set();
    for (let c = 0; c < width; c++) {
      let name = hasHeader && headerRow && !isEmptyCell(headerRow[c]) ? String(headerRow[c]).trim() : '列' + (c + 1);
      let unique = name;
      let k = 2;
      while (used.has(unique)) { unique = name + '_' + k; k++; }
      used.add(unique);
      names.push(unique);
    }

    // --- 型推論（列ごと・最大1000行サンプル） ---
    const types = names.map((_, c) => {
      const sample = [];
      for (let r = 0; r < bodyRows.length && sample.length < 1000; r++) {
        const v = bodyRows[r][c];
        if (!isEmptyCell(v)) sample.push(v);
      }
      if (sample.length === 0) return 'string';
      const numRatio = sample.filter(isNumLike).length / sample.length;
      if (numRatio >= 0.85) return 'number';
      const dateRatio = sample.filter(isDateLike).length / sample.length;
      if (dateRatio >= 0.85) return 'date';
      return 'string';
    });

    // --- 行オブジェクト化＋値の正規化 ---
    const rows = bodyRows.map(r => {
      const obj = {};
      for (let c = 0; c < width; c++) {
        let v = r[c];
        if (isEmptyCell(v)) { obj[names[c]] = null; continue; }
        if (types[c] === 'number') {
          obj[names[c]] = toNumber(v);
        } else if (v instanceof Date) {
          obj[names[c]] = formatDate(v);
        } else {
          obj[names[c]] = String(v).trim();
        }
      }
      return obj;
    });

    const columns = names.map((name, i) => ({ name, type: types[i] }));

    return {
      rows,
      columns,
      meta: {
        sourceName: sourceName || 'データ',
        hasHeader,
        headerRowIndex: hasHeader ? headerRowIndex : -1,
        dataStartRowIndex: startIndex,
        totalRawRows: aoa.length,
        excludedRowCount: excludedRows.size
      }
    };
  }

  /** ファイル → テーブル（自動推定した構造でそのまま確定する簡易パス） */
  function parseFile(file) {
    return parseFileRaw(file).then(({ aoa, sourceName }) => {
      const s = suggestStructure(aoa);
      return buildTable(aoa, s.headerRowIndex, s.dataStartRowIndex, sourceName);
    });
  }

  // ---------------------------------------------------------------
  // サンプルデータ（シード付き乱数で毎回同じ値を生成）
  // ---------------------------------------------------------------

  /** mulberry32 — 再現可能な擬似乱数 */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Box-Muller — 正規乱数 */
  function gauss(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function buildSales() {
    const rand = rng(20240101);
    const regions = ['東京', '大阪', '名古屋'];
    const base = { '東京': 820, '大阪': 560, '名古屋': 390 };
    const rows = [];
    for (let m = 0; m < 24; m++) {
      const year = 2024 + Math.floor(m / 12);
      const month = (m % 12) + 1;
      const label = year + '-' + String(month).padStart(2, '0');
      regions.forEach(region => {
        const season = 1 + 0.18 * Math.sin((month - 3) / 12 * 2 * Math.PI);
        const growth = 1 + m * 0.012;
        const sales = Math.round(base[region] * season * growth * (1 + gauss(rand) * 0.06));
        const ad = Math.round(sales * (0.08 + rand() * 0.04));
        const profit = Math.round(sales * (0.12 + gauss(rand) * 0.03));
        rows.push({ '月': label, '地域': region, '売上高': sales, '広告費': ad, '利益': profit });
      });
    }
    return {
      rows,
      columns: [
        { name: '月', type: 'date' },
        { name: '地域', type: 'string' },
        { name: '売上高', type: 'number' },
        { name: '広告費', type: 'number' },
        { name: '利益', type: 'number' }
      ],
      meta: { sourceName: '月次売上実績（サンプル）', hasHeader: true }
    };
  }

  function buildQuality() {
    const rand = rng(50505);
    const lines = ['ライン A', 'ライン B'];
    const inspectors = ['佐藤', '鈴木', '高橋'];
    const rows = [];
    for (let i = 0; i < 300; i++) {
      const line = lines[i % 2];
      const mu = line === 'ライン A' ? 50.00 : 50.12; // ラインBはわずかに偏り
      const value = mu + gauss(rand) * 0.15;
      const day = 1 + Math.floor(i / 25);
      rows.push({
        '測定日': '2026-06-' + String(Math.min(day, 30)).padStart(2, '0'),
        'ライン': line,
        '検査員': inspectors[Math.floor(rand() * 3)],
        '測定値': Math.round(value * 1000) / 1000
      });
    }
    return {
      rows,
      columns: [
        { name: '測定日', type: 'date' },
        { name: 'ライン', type: 'string' },
        { name: '検査員', type: 'string' },
        { name: '測定値', type: 'number' }
      ],
      meta: { sourceName: '部品寸法測定（サンプル）', hasHeader: true }
    };
  }

  function buildStores() {
    const rand = rng(777);
    const stores = ['新宿店', '渋谷店', '横浜店', '大宮店', '千葉店'];
    const cats = ['食品', '衣料', '雑貨', '家電'];
    const catBase = { '食品': 420, '衣料': 300, '雑貨': 180, '家電': 260 };
    const rows = [];
    stores.forEach((store, si) => {
      cats.forEach(cat => {
        const scale = 1.25 - si * 0.12;
        const cur = Math.round(catBase[cat] * scale * (1 + gauss(rand) * 0.10));
        const prev = Math.round(cur * (0.9 + rand() * 0.2));
        rows.push({ '店舗': store, 'カテゴリ': cat, '売上': cur, '前年売上': prev });
      });
    });
    return {
      rows,
      columns: [
        { name: '店舗', type: 'string' },
        { name: 'カテゴリ', type: 'string' },
        { name: '売上', type: 'number' },
        { name: '前年売上', type: 'number' }
      ],
      meta: { sourceName: '店舗別カテゴリ売上（サンプル）', hasHeader: true }
    };
  }

  function buildWeather() {
    const rand = rng(31415);
    const weather = ['晴れ', '曇り', '雨'];
    const rows = [];
    for (let d = 0; d < 61; d++) {
      const date = new Date(2026, 5, 1 + d); // 6/1〜7/31
      const w = weather[Math.floor(rand() * 3)];
      const seasonal = 22 + d * 0.12;
      const temp = Math.round((seasonal + gauss(rand) * 2.2 - (w === '雨' ? 2 : 0)) * 10) / 10;
      const sales = Math.max(0, Math.round(temp * 14 - 180 + gauss(rand) * 30 - (w === '雨' ? 60 : 0)));
      rows.push({ '日付': formatDate(date), '天気': w, '平均気温': temp, '販売数': sales });
    }
    return {
      rows,
      columns: [
        { name: '日付', type: 'date' },
        { name: '天気', type: 'string' },
        { name: '平均気温', type: 'number' },
        { name: '販売数', type: 'number' }
      ],
      meta: { sourceName: '気温とアイス販売（サンプル）', hasHeader: true }
    };
  }

  const SAMPLES = [
    {
      id: 'sales', name: '月次売上実績', desc: '24ヶ月 × 3地域の売上・広告費・利益。時系列や混在グラフに',
      build: buildSales
    },
    {
      id: 'quality', name: '部品寸法測定', desc: '300件の測定値。ヒストグラムと管理限界線の分析に',
      build: buildQuality
    },
    {
      id: 'stores', name: '店舗別カテゴリ売上', desc: '5店舗 × 4カテゴリ。グループ化・積み上げ棒に',
      build: buildStores
    },
    {
      id: 'weather', name: '気温とアイス販売', desc: '61日分の気温と販売数。散布図で相関の確認に',
      build: buildWeather
    }
  ];

  return {
    parseFileRaw,
    suggestStructure,
    buildTable,
    parseFile,
    SAMPLES,
    isNumLike,
    toNumber,
    isDateLike,
    parseDate,
    formatDate
  };
})();
