# 公図PDF変換ツール（Streamlit版）

公図PDFを画像化し、区画を自動抽出してGeoJSON / DXF / JWC形式に変換するツールです。
処理はすべてブラウザ内（JavaScript）で完結し、PDFやデータがサーバーに送信されることはありません。

## ローカルでの起動方法

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Streamlit Community Cloudへのデプロイ

1. https://share.streamlit.io にアクセスしGitHubアカウントでログイン
2. 「New app」→ このリポジトリを選択
3. Main file path に `app.py` を指定してデプロイ

## ファイル構成

- `app.py` — Streamlitラッパー（kouzu_reader.htmlを埋め込み表示）
- `kouzu_reader.html` — 公図PDF変換ツール本体（単一HTML、pdf.jsを使用）
