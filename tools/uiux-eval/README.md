# UI/UX 案の評価ツール

`CLAUDE.md` の「UI/UX 修正の意思決定プロセス」で使う評価ハーネス。案ごとの客観指標の計測、キャプチャ、順位付けを自動で行う。

## 使い方

```sh
export UIUX_WORK_DIR=<スクラッチパッド>/uiux      # 出力先（既定: OS の一時ディレクトリ/chartlab-uiux）
export NODE_PATH=/opt/node22/lib/node_modules

# 1. 案を作る: $UIUX_WORK_DIR/variants/<id>/ に variant.css / variant.js / patch.html / label.txt を置く
#    （本物のアプリに注入され、DOM を組み替えて案の画面にする。どれも任意）
# 2. 計測・撮影（"base" は現在のアプリそのもの）
node tools/uiux-eval/harness.js base r1-A r1-B ...
# 3. 必要なら補助キャプチャ（詳細設定を開いた状態）
node tools/uiux-eval/detail-open.js r1-A r1-B ...
# 4. 主観点を $UIUX_WORK_DIR/scores-r1.json に書き、順位表を出す
node tools/uiux-eval/score.js r1
```

## 出力

- `variants/<id>/shots/{D,L,M,E,H}.png` — キャプチャ（D: 1440×900 作業画面、L: 1280×720、M: 390×844、E: 初回画面、H: ヒストグラム）
- `variants/<id>/contact.png` — 5枚をまとめたコンタクトシート（案ごとの見比べ用）
- `variants/<id>/metrics.json` — 客観指標（グラフ面積比、設定パネルのスクロール量、見えている操作部品の数、モバイルの横はみ出し、モバイルで見えるグラフの高さ、主要操作が1280×720で届くか、ヒストグラムの成立）と客観スコア
- `ranking-<round>.md` — 順位表と根拠

## 案から参照できる約束事

- `data-eval="settings"` を付けた要素を設定パネルとしてスクロール量を測る（なければ `.sidebar`）
- `data-eval="x"` を付けた要素の中の列ピッカーを「X軸」の役割とみなす
- `window.__evalOpenChartSettings()` を定義すると、撮影前に呼ばれる（グラフ設定を開いた状態にする用）
- 作業ディレクトリに `proto-lib.js` を置くと各案の `variant.js` より先に読み込まれる（共通部品）

キャプチャや計測結果はリポジトリにコミットしない。評価の記録は `docs/design-reviews/` にまとめる。
