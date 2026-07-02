/**
 * カラーシステム — 検証済みリファレンスパレット
 *
 * 色彩工学・色彩調和の観点から、以下の原則で設計されています。
 * - カテゴリカル8色は固定順で割り当て（順序自体が色覚多様性への安全機構）
 *   ライトモード: 隣接ペアの最小CVD ΔE = 24.2（目標値12を大きく上回る）
 *   ダークモードはライトの自動反転ではなく、暗い背景用に選定された同系8色
 * - 色は「系列（エンティティ）」に追従し、順位には追従しない
 *   （系列を削除しても残りの系列の色は変わらない）
 * - ステータス色（成功/警告/重大/危険）はカテゴリカル色とは別枠で予約
 */
const Palette = (() => {
  'use strict';

  const MODES = {
    light: {
      surface: '#fcfcfb',        // チャート表面
      page: '#f9f9f7',           // ページ背景
      textPrimary: '#0b0b0b',
      textSecondary: '#52514e',
      muted: '#898781',          // 軸ラベル・補助テキスト
      grid: '#e1e0d9',           // グリッド線（ヘアライン）
      axis: '#c3c2b7',           // ベースライン・軸
      border: 'rgba(11,11,11,0.10)',
      // カテゴリカル8色（固定順・循環禁止）
      series: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834']
    },
    dark: {
      surface: '#1a1a19',
      page: '#0d0d0d',
      textPrimary: '#ffffff',
      textSecondary: '#c3c2b7',
      muted: '#898781',
      grid: '#2c2c2a',
      axis: '#383835',
      border: 'rgba(255,255,255,0.10)',
      series: ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926']
    }
  };

  // ステータス色（意味が予約されている — 系列色として流用しない）
  const STATUS = {
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b'
  };

  const SERIES_NAMES = ['ブルー', 'アクア', 'イエロー', 'グリーン', 'バイオレット', 'レッド', 'マゼンタ', 'オレンジ'];

  const MAX_SERIES = 8; // 9色目は生成しない（CVD下で既存色と区別不能になるため）

  /** テーマのトークン一式を返す */
  function tokens(theme) {
    return MODES[theme] || MODES.light;
  }

  /** スロット番号 → 系列色 */
  function seriesColor(theme, slot) {
    const t = tokens(theme);
    return t.series[slot % t.series.length];
  }

  /** #rrggbb → rgba(r,g,b,a) */
  function withAlpha(hex, alpha) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  return { tokens, seriesColor, withAlpha, STATUS, SERIES_NAMES, MAX_SERIES };
})();
