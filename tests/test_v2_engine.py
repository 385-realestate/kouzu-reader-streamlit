import io

import cv2
import ezdxf
import numpy as np
import pymupdf

import kouzu_engine
from kouzu_engine import Settings, convert_pdf, geojson_to_dxf, pixel_center_to_pt
from v2_app import app


def test_vector_pdf_coordinates_and_dxf_roundtrip():
    document = pymupdf.open()
    page = document.new_page(width=100, height=100)
    page.draw_line((10, 10), (90, 10), width=1)
    geojson, preview = convert_pdf(document.tobytes(), Settings(scale=500,
        top_exclusion=0, bottom_exclusion=0))
    assert geojson["properties"]["lineSource"] == "vector"
    assert geojson["properties"]["lineCount"] == 1
    assert preview.startswith(b"\xff\xd8")
    coordinates = geojson["features"][0]["geometry"]["coordinates"]
    assert coordinates[0] == [1763.889, 15875.0]
    assert coordinates[1] == [15875.0, 15875.0]
    dxf = ezdxf.read(io.StringIO(geojson_to_dxf(geojson).decode("utf-8")))
    assert dxf.header["$INSUNITS"] == 4
    points = list(next(iter(dxf.modelspace().query("LWPOLYLINE"))).get_points("xy"))
    for actual, expected in zip(points, coordinates):
        assert max(abs(a-b) for a, b in zip(actual, expected)) <= 0.001


def test_raster_pdf_keeps_line_candidates(monkeypatch):
    raster = np.full((400, 400, 3), 255, dtype=np.uint8)
    cv2.line(raster, (50, 180), (350, 180), (0, 0, 0), 3)
    encoded = cv2.imencode(".png", raster)[1].tobytes()
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    page.insert_image(page.rect, stream=encoded)
    monkeypatch.setattr(kouzu_engine, "_ocr_labels", lambda *_: ([], []))
    geojson, _ = convert_pdf(document.tobytes(), Settings(scale=500, dpi=180,
        top_exclusion=0, bottom_exclusion=0))
    assert geojson["properties"]["lineSource"] == "raster"
    assert geojson["properties"]["lineCount"] > 0
    assert all(f["properties"]["state"] == "candidate" for f in geojson["features"])


def test_pixel_coordinate_uses_cell_center():
    assert pixel_center_to_pt(0, 0, 100, 200, 100, 200) == (0.5, 0.5)


def test_api_rejects_non_pdf_and_reports_health():
    client = app.test_client()
    assert client.get("/kouzu/healthz").get_json()["engine"] == "python"
    response = client.post("/kouzu/api/convert", data={"pdf": (io.BytesIO(b"bad"), "bad.pdf")},
                           content_type="multipart/form-data")
    assert response.status_code == 400
