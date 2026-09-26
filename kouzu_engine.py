"""公図PDFの候補線を抽出する独立エンジン。

原図に存在する線だけを出力する。筆界・区画の法的確定は行わない。
座標はPDFページ左上基準のptで保持し、出力時だけ実寸mmへ変換する。
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import io
import math
import re

import cv2
import ezdxf
import pymupdf
import numpy as np
from rapidocr_onnxruntime import RapidOCR


@dataclass(frozen=True)
class Settings:
    page_number: int = 1
    scale: int = 500
    dpi: int = 220
    top_exclusion: float = 0.07
    bottom_exclusion: float = 0.27

    def validate(self, page_count: int) -> None:
        if not 1 <= self.page_number <= page_count:
            raise ValueError("ページ番号が範囲外です")
        if not 100 <= self.scale <= 5000:
            raise ValueError("縮尺は1:100〜1:5000で指定してください")
        if not 120 <= self.dpi <= 400:
            raise ValueError("解像度は120〜400dpiで指定してください")
        if not 0 <= self.top_exclusion <= 0.4 or not 0 <= self.bottom_exclusion <= 0.6:
            raise ValueError("除外率が範囲外です")
        if self.top_exclusion + self.bottom_exclusion >= 0.8:
            raise ValueError("除外範囲が広すぎます")


def page_point_to_mm(x: float, y: float, page_height_pt: float, scale: int) -> list[float]:
    mm_per_pt = 25.4 / 72 * scale
    return [round(x * mm_per_pt, 3), round((page_height_pt - y) * mm_per_pt, 3)]


def pixel_center_to_pt(x: float, y: float, page_width_pt: float,
                       page_height_pt: float, width_px: int, height_px: int) -> tuple[float, float]:
    return ((x + 0.5) * page_width_pt / width_px,
            (y + 0.5) * page_height_pt / height_px)


def _feature(points_pt: list[tuple[float, float]], height_pt: float, scale: int,
             feature_id: str, role: str, origin: str) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [
            page_point_to_mm(x, y, height_pt, scale) for x, y in points_pt
        ]},
        "properties": {
            "lineId": feature_id, "role": role, "origin": origin,
            "state": "candidate", "units": "mm_realworld",
        },
    }


def _vector_features(page: pymupdf.Page, settings: Settings) -> list[dict]:
    features: list[dict] = []
    index = 0
    for drawing in page.get_drawings():
        if drawing.get("type") not in {"s", "fs"}:
            continue
        for item in drawing.get("items", []):
            kind = item[0]
            segments: list[list[tuple[float, float]]] = []
            if kind == "l":
                segments = [[tuple(item[1]), tuple(item[2])]]
            elif kind == "re":
                rect = item[1]
                corners = [(rect.x0, rect.y0), (rect.x1, rect.y0),
                           (rect.x1, rect.y1), (rect.x0, rect.y1), (rect.x0, rect.y0)]
                segments = [corners]
            elif kind == "c":
                p0, p1, p2, p3 = [tuple(point) for point in item[1:5]]
                length = math.dist(p0, p1) + math.dist(p1, p2) + math.dist(p2, p3)
                steps = max(4, min(64, math.ceil(length / 2)))
                curve = []
                for step in range(steps + 1):
                    t = step / steps
                    x = ((1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0]
                         + 3*(1-t)*t*t*p2[0] + t**3*p3[0])
                    y = ((1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1]
                         + 3*(1-t)*t*t*p2[1] + t**3*p3[1])
                    curve.append((x, y))
                segments = [curve]
            for points in segments:
                if len(points) < 2 or math.dist(points[0], points[-1]) < 0.01 and len(points) == 2:
                    continue
                features.append(_feature(points, page.rect.height, settings.scale,
                                         f"v{index}", "content", "vector"))
                index += 1
    return features


def _raster_features(gray: np.ndarray, page: pymupdf.Page, settings: Settings) -> list[dict]:
    height, width = gray.shape
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    top = round(height * settings.top_exclusion)
    bottom = round(height * (1 - settings.bottom_exclusion))
    ink[:top] = 0
    ink[bottom:] = 0
    # 白地の境界線を1画素の中心線に変換。OCRに未分類の短線も削除せず候補として残す。
    skeleton = cv2.ximgproc.thinning(ink)
    min_length = max(12, round(width * 0.005))
    segments = cv2.HoughLinesP(skeleton, 1, np.pi / 720, threshold=18,
                               minLineLength=min_length, maxLineGap=3)
    if segments is None:
        return []
    features = []
    for index, raw in enumerate(segments[:, 0]):
        x1, y1, x2, y2 = (int(value) for value in raw)
        points = [pixel_center_to_pt(x, y, page.rect.width, page.rect.height, width, height)
                  for x, y in ((x1, y1), (x2, y2))]
        near_edge = (min(x1, x2) < width * .1 or max(x1, x2) > width * .9 or
                     min(y1, y2) < top + (bottom - top) * .1 or
                     max(y1, y2) > bottom - (bottom - top) * .1)
        long_axis = math.hypot(x2 - x1, y2 - y1) > max(width, height) * .45
        role = "frame" if near_edge and long_axis else "boundary_candidate"
        features.append(_feature(points, page.rect.height, settings.scale,
                                 f"r{index}", role, "raster"))
    return features


def _embedded_text(page: pymupdf.Page, settings: Settings) -> list[dict]:
    features = []
    for index, word in enumerate(page.get_text("words")):
        x0, y0, x1, y1, text = word[:5]
        if y0 < page.rect.height * settings.top_exclusion:
            continue
        if y1 > page.rect.height * (1 - settings.bottom_exclusion):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": page_point_to_mm(
                (x0+x1)/2, (y0+y1)/2, page.rect.height, settings.scale)},
            "properties": {"text": text, "origin": "pdf_text", "role": "label",
                           "state": "candidate", "units": "mm_realworld"},
        })
    return features


@lru_cache(maxsize=1)
def _ocr_engine() -> RapidOCR:
    return RapidOCR()


def _ocr_labels(page: pymupdf.Page, settings: Settings) -> tuple[list[dict], list[tuple[float, float, float, float]]]:
    """低解像度OCRで地番候補を取得。線は削除せず重なりを分類する。"""
    scan_dpi = 120
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scan_dpi / 72, scan_dpi / 72),
                          colorspace=pymupdf.csRGB, alpha=False)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride // 3, 3)[:, :pix.width].copy()
    top = round(pix.height * settings.top_exclusion)
    bottom = round(pix.height * (1 - settings.bottom_exclusion))
    image[:top] = 255
    image[bottom:] = 255
    detections, _ = _ocr_engine()(image)
    labels = []
    boxes_mm = []
    for detection in detections or []:
        box, text, confidence = detection
        text = str(text).strip()
        if confidence < 0.6 or not re.search(r"[0-9０-９]|^[道水]$", text):
            continue
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        if min(ys) < top or max(ys) > bottom:
            continue
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        x_pt = cx * page.rect.width / pix.width
        y_pt = cy * page.rect.height / pix.height
        label = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": page_point_to_mm(
                x_pt, y_pt, page.rect.height, settings.scale)},
            "properties": {"text": text, "confidence": round(float(confidence), 3),
                           "origin": "ocr", "role": "label", "state": "candidate",
                           "units": "mm_realworld"},
        }
        labels.append(label)
        p0 = page_point_to_mm(min(xs) * page.rect.width / pix.width,
                              max(ys) * page.rect.height / pix.height,
                              page.rect.height, settings.scale)
        p1 = page_point_to_mm(max(xs) * page.rect.width / pix.width,
                              min(ys) * page.rect.height / pix.height,
                              page.rect.height, settings.scale)
        boxes_mm.append((p0[0], p0[1], p1[0], p1[1]))
    return labels, boxes_mm


def _classify_ocr_strokes(lines: list[dict], boxes_mm: list[tuple[float, float, float, float]]) -> None:
    for feature in lines:
        if feature["properties"].get("role") == "frame":
            continue
        (x0, y0), (x1, y1) = feature["geometry"]["coordinates"][:2]
        length = math.hypot(x1-x0, y1-y0)
        for left, bottom, right, top in boxes_mm:
            width = right-left
            height = top-bottom
            margin = max(width, height) * .15
            inside0 = left-margin <= x0 <= right+margin and bottom-margin <= y0 <= top+margin
            inside1 = left-margin <= x1 <= right+margin and bottom-margin <= y1 <= top+margin
            if inside0 and inside1 and length <= math.hypot(width, height) * 1.5:
                feature["properties"]["role"] = "text_stroke"
                feature["properties"]["ocrOverlap"] = True
                break


def convert_pdf(data: bytes, settings: Settings) -> tuple[dict, bytes]:
    if not data.startswith(b"%PDF-"):
        raise ValueError("PDFファイルとして読み取れません")
    with pymupdf.open(stream=data, filetype="pdf") as document:
        settings.validate(len(document))
        page = document[settings.page_number - 1]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(settings.dpi / 72,
                                                 settings.dpi / 72),
                              colorspace=pymupdf.csGRAY, alpha=False)
        gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width].copy()
        vector = _vector_features(page, settings)
        images = len(page.get_images())
        use_raster = (images > 0 and len(vector) < 8) or len(vector) == 0
        lines = _raster_features(gray, page, settings) if use_raster else vector
        labels = _embedded_text(page, settings)
        ocr_warning = ""
        if use_raster:
            try:
                ocr_labels, ocr_boxes = _ocr_labels(page, settings)
                labels.extend(ocr_labels)
                _classify_ocr_strokes(lines, ocr_boxes)
            except Exception as exc:
                ocr_warning = f"OCRに失敗しました: {exc.__class__.__name__}"
        preview_pix = page.get_pixmap(matrix=pymupdf.Matrix(110 / 72, 110 / 72),
                                      colorspace=pymupdf.csRGB, alpha=False)
        preview = preview_pix.tobytes("jpeg", jpg_quality=75)
        geojson = {
            "type": "FeatureCollection",
            "features": lines + labels,
            "properties": {
                "page": settings.page_number, "pageCount": len(document),
                "scaleDenominator": settings.scale, "coordinateSystem": "mm_realworld",
                "pageWidthMm": round(page.rect.width * 25.4 / 72 * settings.scale, 3),
                "pageHeightMm": round(page.rect.height * 25.4 / 72 * settings.scale, 3),
                "lineSource": "raster" if use_raster else "vector",
                "lineCount": len(lines), "embeddedTextCount": len(labels),
                "ocrStatus": "failed" if ocr_warning else ("completed" if use_raster else "not_required"),
                "ocrWarning": ocr_warning,
                "ocrLabelCount": sum(f["properties"].get("origin") == "ocr" for f in labels),
                "reviewRequired": True,
            },
        }
        return geojson, preview


def geojson_to_dxf(geojson: dict) -> bytes:
    drawing = ezdxf.new("R2010")
    drawing.header["$INSUNITS"] = 4  # millimeters
    drawing.header["$MEASUREMENT"] = 1
    model = drawing.modelspace()
    for layer, color in (("BOUNDARY_CANDIDATE", 2), ("FRAME", 8),
                         ("TEXT_STROKE", 9), ("LABEL", 3)):
        drawing.layers.new(layer, dxfattribs={"color": color})
    for feature in geojson.get("features", []):
        geometry = feature.get("geometry", {})
        props = feature.get("properties", {})
        if geometry.get("type") == "LineString":
            layer = {"frame": "FRAME", "text_stroke": "TEXT_STROKE"}.get(
                props.get("role"), "BOUNDARY_CANDIDATE")
            model.add_lwpolyline(geometry.get("coordinates", []), dxfattribs={"layer": layer})
        elif geometry.get("type") == "Point" and props.get("text"):
            model.add_text(str(props["text"]), dxfattribs={
                "layer": "LABEL", "height": 2.0,
                "insert": tuple(geometry["coordinates"]),
            })
    output = io.StringIO()
    drawing.write(output)
    return output.getvalue().encode("utf-8")
