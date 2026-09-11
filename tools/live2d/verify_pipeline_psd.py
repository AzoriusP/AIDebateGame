"""Independently decode/recompose the proof PSD with psd-tools, not its writer."""

from pathlib import Path
import hashlib
import json
import struct
import sys

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT / "work" / "live2d" / "psd-compatibility"
sys.path.insert(0, str(WORK / "python-libs"))
from psd_tools import PSDImage
from psd_tools.constants import Resource


def canonical_rgba(image):
    data = np.array(image.convert("RGBA"))
    data[data[:, :, 3] == 0, :3] = 0
    return data


def inspect(path):
    source = PROJECT / "design" / "live2d" / "pipeline-proof" / "source"
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    psd = PSDImage.open(path)
    checks = []
    for layer in psd:
        expected = Image.open(source / f"{layer.name}.png").convert("RGBA").crop(layer.bbox)
        actual = layer.topil().convert("RGBA")
        checks.append({
            "name": layer.name,
            "bbox": list(layer.bbox),
            "visible": layer.visible,
            "pixel_match": bool(np.array_equal(canonical_rgba(actual), canonical_rgba(expected))),
        })
    merged = psd.composite(force=True)
    preview = Image.open(source / "pipeline-proof.png").convert("RGBA")
    forced_match = bool(np.array_equal(canonical_rgba(merged), canonical_rgba(preview)))
    expected_names = [x["name"] for x in manifest["layers_bottom_first"]]
    actual_names = [x.name for x in psd]

    data = path.read_bytes()
    position = 26
    section_bounds = []
    for name in ("color_mode_data", "image_resources", "layer_and_mask"):
        size = struct.unpack_from(">I", data, position)[0]
        start, end = position + 4, position + 4 + size
        if end > len(data):
            raise ValueError(f"{name} exceeds file bounds")
        section_bounds.append({"name": name, "length_offset": position, "data_start": start, "data_end": end, "size": size})
        position = end
    report = {
        "path": str(path),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "parser": "psd-tools 1.19.0",
        "header": {"width": psd.width, "height": psd.height, "depth": psd.depth, "color_mode": psd.color_mode.name},
        "section_bounds": section_bounds,
        "resolution_info_resource": Resource.RESOLUTION_INFO in psd.image_resources,
        "layer_record_order_bottom_first": actual_names,
        "layer_order_matches_source": actual_names == expected_names,
        "layers": checks,
        "forced_recomposition_matches_source": forced_match,
        "cubism_import": "requires real Editor verification",
    }
    return report, merged


def main():
    source_path = PROJECT / "design" / "live2d" / "pipeline-proof" / "source" / "pipeline-proof.psd"
    report, merged = inspect(source_path)
    WORK.mkdir(parents=True, exist_ok=True)
    merged.save(WORK / "psd-tools-recomposed-fixed.png")
    (WORK / "independent-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not (report["layer_order_matches_source"] and report["forced_recomposition_matches_source"]
            and all(x["pixel_match"] and x["visible"] for x in report["layers"])):
        raise SystemExit("Independent PSD validation failed; see report")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
