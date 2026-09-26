"""公図PDF変換のVPS向けWeb API。PDFはメモリ内で処理し保存しない。"""
from __future__ import annotations

import base64
import os

from flask import Flask, Response, jsonify, render_template, request

from kouzu_engine import Settings, convert_pdf, geojson_to_dxf

PREFIX = os.environ.get("KOUZU_URL_PREFIX", "/kouzu").rstrip("/")
app = Flask(__name__, template_folder="v2/templates", static_folder="v2/static",
            static_url_path=f"{PREFIX}/static")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024


@app.get(f"{PREFIX}/")
def index():
    return render_template("index.html", prefix=PREFIX)


@app.get(f"{PREFIX}/healthz")
def healthz():
    return jsonify(status="ok", engine="python")


@app.post(f"{PREFIX}/api/convert")
def convert():
    upload = request.files.get("pdf")
    if not upload or not (upload.filename or "").lower().endswith(".pdf"):
        return jsonify(error="公図PDFを選択してください"), 400
    try:
        settings = Settings(
            page_number=int(request.form.get("page", "1")),
            scale=int(request.form.get("scale", "500")),
            dpi=int(request.form.get("dpi", "220")),
            top_exclusion=float(request.form.get("top_exclusion", "7")) / 100,
            bottom_exclusion=float(request.form.get("bottom_exclusion", "27")) / 100,
        )
        geojson, preview = convert_pdf(upload.read(), settings)
    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        app.logger.exception("公図PDFの変換に失敗しました")
        return jsonify(error="変換できませんでした。PDFの形式とページを確認してください"), 422
    return jsonify(
        geojson=geojson,
        preview="data:image/jpeg;base64," + base64.b64encode(preview).decode("ascii"),
    )


@app.post(f"{PREFIX}/api/export-dxf")
def export_dxf():
    payload = request.get_json(silent=True) or {}
    geojson = payload.get("geojson")
    if not isinstance(geojson, dict) or geojson.get("type") != "FeatureCollection":
        return jsonify(error="変換結果がありません"), 400
    try:
        body = geojson_to_dxf(geojson)
    except (ValueError, TypeError, KeyError):
        return jsonify(error="DXFの作成に失敗しました"), 400
    return Response(body, mimetype="application/dxf", headers={
        "Content-Disposition": "attachment; filename=kouzu_conversion.dxf"
    })


@app.errorhandler(413)
def too_large(_error):
    return jsonify(error="PDFサイズの上限は50MBです"), 413


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8511")))
