# 公図PDF変換（VPS版）

公図PDFから線と文字候補を抽出し、原本との重ね合わせで確認・修正して GeoJSON、DXF、PNG を出力するWebアプリです。新しい処理系は `v2_app.py` と `kouzu_engine.py` にあります。従来のブラウザ内処理版は `kouzu_reader.html` と `app.py` に残しています。

## 処理と精度

- ベクターPDFは PyMuPDF で線を直接抽出します。画像PDFは OpenCV の二値化・細線化・直線検出を使います。
- 文字は OCR で候補として表示します。文字に重なる線は削除せず `text_stroke` として分類し、画面上で境界候補へ戻せます。
- 誤抽出・未抽出の可能性があります。原本との重ね合わせを確認し、境界・地番の法的判断には原本や測量成果を使用してください。
- GeoJSON/DXF の座標は、指定縮尺から換算した現地相対座標（mm）です。地理座標系や絶対位置は付与しません。DXF も mm 単位です。
- 距離測定は指定縮尺に基づく概算です。

## ローカル実行

Python 3.11 または 3.12 を推奨します。

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements-v2.txt
.venv/Scripts/python v2_app.py
```

Windows 以外では `.venv/bin/python` を使います。`http://127.0.0.1:8511/kouzu/` にアクセスしてください。`/kouzu/healthz` で稼働確認できます。

## VPS 配置

`deploy/kouzu-reader.service` は Gunicorn を 127.0.0.1:8511 で起動します。Nginx で `/kouzu/` をプロキシし、旧版は `/kouzu/legacy/` から提供できます。PDF はメモリ上で一時処理し、アプリ側では保存しません。アップロードの上限は 50 MB です。

```bash
python -m pytest tests/test_v2_engine.py
```

実PDFを使うブラウザテストは `KOUZU_SAMPLE_PDF` を指定して `node tests/test_v2_browser.js` を実行します。
