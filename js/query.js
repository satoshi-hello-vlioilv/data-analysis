/**
 * クエリエンジン — データ処理内容の「クエリ化」
 *
 * フィルタ・グループ化・集計・並び替え・行数制限の各操作を
 * 宣言的なクエリオブジェクトとして保持し、
 *   1. データへの適用（runFilters / aggregate）
 *   2. SQL風テキストへの変換（buildSQL）— 処理内容の透明化・共有用
 * の2つの形で解釈します。UIの操作は常にこのクエリを編集しているだけ、
 * という単一の情報モデルに統一しています。
 */
const QueryEngine = (() => {
  'use strict';

  // 列型ごとのフィルタ演算子
  const FILTER_OPS = {
    number: [
      { id: 'eq', label: '＝', sql: '=' },
      { id: 'neq', label: '≠', sql: '<>' },
      { id: 'gt', label: '＞', sql: '>' },
      { id: 'gte', label: '≧', sql: '>=' },
      { id: 'lt', label: '＜', sql: '<' },
      { id: 'lte', label: '≦', sql: '<=' }
    ],
    date: [
      { id: 'eq', label: '＝', sql: '=' },
      { id: 'neq', label: '≠', sql: '<>' },
      { id: 'gte', label: '以降', sql: '>=' },
      { id: 'lte', label: '以前', sql: '<=' }
    ],
    string: [
      { id: 'eq', label: '一致', sql: '=' },
      { id: 'neq', label: '不一致', sql: '<>' },
      { id: 'contains', label: '含む', sql: 'LIKE' },
      { id: 'notContains', label: '含まない', sql: 'NOT LIKE' },
      { id: 'startsWith', label: 'で始まる', sql: 'LIKE' }
    ]
  };

  // 集計関数
  const AGGS = [
    { id: 'sum', label: '合計', sql: 'SUM' },
    { id: 'avg', label: '平均', sql: 'AVG' },
    { id: 'median', label: '中央値', sql: 'MEDIAN' },
    { id: 'max', label: '最大', sql: 'MAX' },
    { id: 'min', label: '最小', sql: 'MIN' },
    { id: 'count', label: '件数', sql: 'COUNT' },
    { id: 'std', label: '標準偏差', sql: 'STDDEV' }
  ];

  // 並び替えオプション
  const SORTS = [
    { id: 'auto', label: 'X軸 昇順（自動）' },
    { id: 'x-desc', label: 'X軸 降順' },
    { id: 'value-desc', label: '値の大きい順' },
    { id: 'value-asc', label: '値の小さい順' },
    { id: 'none', label: '元の順序のまま' }
  ];

  function opsFor(type) {
    return FILTER_OPS[type] || FILTER_OPS.string;
  }

  function aggById(id) {
    return AGGS.find(a => a.id === id) || AGGS[0];
  }

  // ---------------------------------------------------------------
  // フィルタ適用
  // ---------------------------------------------------------------

  /** 1件のフィルタ条件を評価する述語を返す */
  function predicate(filter, colType) {
    const { column, op, value } = filter;
    if (colType === 'number') {
      const target = DataLayer.toNumber(value);
      if (target === null) return null;
      return row => {
        const v = row[column];
        if (v === null || v === undefined) return false;
        switch (op) {
          case 'eq': return v === target;
          case 'neq': return v !== target;
          case 'gt': return v > target;
          case 'gte': return v >= target;
          case 'lt': return v < target;
          case 'lte': return v <= target;
          default: return true;
        }
      };
    }
    if (colType === 'date') {
      const target = DataLayer.parseDate(value);
      if (target === null) return null;
      return row => {
        const t = DataLayer.parseDate(row[column]);
        if (t === null) return false;
        switch (op) {
          case 'eq': return t === target;
          case 'neq': return t !== target;
          case 'gte': return t >= target;
          case 'lte': return t <= target;
          default: return true;
        }
      };
    }
    const target = String(value);
    return row => {
      const v = row[column];
      if (v === null || v === undefined) return false;
      const s = String(v);
      switch (op) {
        case 'eq': return s === target;
        case 'neq': return s !== target;
        case 'contains': return s.includes(target);
        case 'notContains': return !s.includes(target);
        case 'startsWith': return s.startsWith(target);
        default: return true;
      }
    };
  }

  /** 有効なフィルタをすべて適用した行を返す */
  function runFilters(rows, columns, filters) {
    const typeOf = {};
    columns.forEach(c => { typeOf[c.name] = c.type; });
    const preds = (filters || [])
      .filter(f => f.column && f.op && f.value !== '' && f.value !== null && f.value !== undefined)
      .map(f => predicate(f, typeOf[f.column]))
      .filter(p => p !== null);
    if (preds.length === 0) return rows;
    return rows.filter(row => preds.every(p => p(row)));
  }

  // ---------------------------------------------------------------
  // 集計
  // ---------------------------------------------------------------

  /** 数値配列に集計関数を適用 */
  function aggregate(values, fn) {
    const nums = values.filter(v => typeof v === 'number' && isFinite(v));
    if (fn === 'count') return values.filter(v => v !== null && v !== undefined).length;
    if (nums.length === 0) return null;
    switch (fn) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'median': {
        const s = nums.slice().sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      }
      case 'max': return Math.max(...nums);
      case 'min': return Math.min(...nums);
      case 'std': {
        if (nums.length < 2) return 0;
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        return Math.sqrt(nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (nums.length - 1));
      }
      default: return null;
    }
  }

  /** 行をキー列でグループ化 → Map<キー, 行配列>（出現順を保持） */
  function groupRows(rows, column) {
    const map = new Map();
    rows.forEach(row => {
      const key = row[column] === null || row[column] === undefined ? '（空欄）' : String(row[column]);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return map;
  }

  // ---------------------------------------------------------------
  // SQL風プレビュー
  // ---------------------------------------------------------------

  /** 識別子のクォート（日本語列名も見やすいよう "…" で囲む） */
  function ident(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function literal(value, type) {
    if (type === 'number') {
      const n = DataLayer.toNumber(value);
      return n === null ? "''" : String(n);
    }
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  /**
   * 現在の状態を SQL 風テキストに変換する。
   * 実行エンジンではなく「処理内容の写し」— コピーして共有・再現できる。
   */
  function buildSQL(state, columns) {
    const typeOf = {};
    columns.forEach(c => { typeOf[c.name] = c.type; });
    const q = state.query;
    const lines = [];

    // SELECT 句
    if (state.chart.mode === 'hist') {
      const cols = state.chart.series.map(s => ident(s.column));
      lines.push('SELECT ' + (cols.length ? cols.join(', ') : '*'));
    } else if (q.groupBy) {
      const parts = [ident(q.groupBy)];
      state.chart.series.forEach(s => {
        const agg = aggById(s.agg);
        parts.push(agg.sql + '(' + ident(s.column) + ') AS ' + ident(s.column + '_' + agg.label));
      });
      lines.push('SELECT ' + parts.join(', '));
    } else {
      const parts = [];
      if (state.chart.x) parts.push(ident(state.chart.x));
      state.chart.series.forEach(s => {
        if (!parts.includes(ident(s.column))) parts.push(ident(s.column));
      });
      lines.push('SELECT ' + (parts.length ? parts.join(', ') : '*'));
    }

    lines.push('FROM ' + ident(state.raw.meta.sourceName.replace(/\.(csv|tsv|txt|xlsx|xls).*$/i, '')));

    // WHERE 句
    const active = (q.filters || []).filter(f => f.column && f.op && f.value !== '' && f.value !== null);
    if (active.length) {
      const conds = active.map(f => {
        const type = typeOf[f.column] || 'string';
        const op = opsFor(type).find(o => o.id === f.op) || { sql: '=' };
        if (f.op === 'contains') return ident(f.column) + " LIKE '%" + String(f.value).replace(/'/g, "''") + "%'";
        if (f.op === 'notContains') return ident(f.column) + " NOT LIKE '%" + String(f.value).replace(/'/g, "''") + "%'";
        if (f.op === 'startsWith') return ident(f.column) + " LIKE '" + String(f.value).replace(/'/g, "''") + "%'";
        return ident(f.column) + ' ' + op.sql + ' ' + literal(f.value, type);
      });
      lines.push('WHERE ' + conds.join('\n  AND '));
    }

    // GROUP BY / ORDER BY / LIMIT（XYモードのみ）
    if (state.chart.mode !== 'hist') {
      if (q.groupBy) lines.push('GROUP BY ' + ident(q.groupBy));
      const xName = q.groupBy || state.chart.x;
      const first = state.chart.series[0];
      switch (q.sort) {
        case 'auto': if (xName) lines.push('ORDER BY ' + ident(xName) + ' ASC'); break;
        case 'x-desc': if (xName) lines.push('ORDER BY ' + ident(xName) + ' DESC'); break;
        case 'value-desc':
          if (first) {
            lines.push('ORDER BY ' + (q.groupBy ? aggById(first.agg).sql + '(' + ident(first.column) + ')' : ident(first.column)) + ' DESC');
          }
          break;
        case 'value-asc':
          if (first) {
            lines.push('ORDER BY ' + (q.groupBy ? aggById(first.agg).sql + '(' + ident(first.column) + ')' : ident(first.column)) + ' ASC');
          }
          break;
        default: break;
      }
      if (q.limit && q.limit > 0) lines.push('LIMIT ' + q.limit);
    } else {
      const s = state.chart;
      const methodLabel = { sturges: 'スタージェス', scott: 'スコット', freedman: 'フリードマン・ダイアコニス', custom: 'カスタム' }[s.bins.method] || s.bins.method;
      lines.push('-- ヒストグラム: 階級 = ' + methodLabel + (s.bins.method === 'custom' ? '（' + s.bins.count + '区間）' : ''));
    }

    return lines.join('\n');
  }

  return { FILTER_OPS, AGGS, SORTS, opsFor, aggById, runFilters, aggregate, groupRows, buildSQL };
})();
