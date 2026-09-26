"""実PDFの候補線を原図に重ねて目視検証する（画像はコミットしない）。"""
import argparse
from pathlib import Path

import cv2
import numpy as np

from kouzu_engine import Settings, convert_pdf


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--scale", type=int, default=500)
    args = parser.parse_args()
    geojson, preview = convert_pdf(args.pdf.read_bytes(), Settings(scale=args.scale))
    image = cv2.imdecode(np.frombuffer(preview, np.uint8), cv2.IMREAD_COLOR)
    height, width = image.shape[:2]
    page_width = geojson["properties"]["pageWidthMm"]
    page_height = geojson["properties"]["pageHeightMm"]
    for feature in geojson["features"]:
        if feature["geometry"]["type"] != "LineString":
            continue
        role = feature["properties"].get("role")
        color = {"frame": (180, 180, 180), "text_stroke": (230, 170, 30)}.get(role, (20, 20, 230))
        points = np.array([[round(x / page_width * width), round((page_height-y) / page_height * height)]
                           for x, y in feature["geometry"]["coordinates"]], np.int32)
        cv2.polylines(image, [points], False, color, 1)
    encoded = cv2.imencode(".png", image)[1]
    encoded.tofile(str(args.output))
    print({"lines": geojson["properties"]["lineCount"],
           "ocrLabels": geojson["properties"]["ocrLabelCount"],
           "output": str(args.output)})


if __name__ == "__main__":
    main()
