# 公図PDF変換ツール（Xserver VPS版）

公図PDFを画像化し、区画を自動抽出してGeoJSON / DXF形式に変換するツールです。
処理はすべてブラウザ内（JavaScript）で完結し、PDFやデータがサーバーに送信されることはありません。

## ローカルでの起動方法

```bash
python app.py
```

`http://127.0.0.1:8501/kouzu/` を開きます。

## Xserver VPSへのデプロイ

アプリ本体は単一HTMLで、PDF処理は引き続きブラウザ内だけで完結します。
本番では `kouzu_reader.html` をNginxから `/kouzu/` として直接配信するため、
StreamlitプロセスやPython依存パッケージは不要です。設定例は
`deploy/nginx-location.conf` を参照してください。

## ファイル構成

- `app.py` — ローカル確認用の標準Python HTTPサーバー
- `kouzu_reader.html` — 公図PDF変換ツール本体（単一HTML、pdf.jsを使用）
