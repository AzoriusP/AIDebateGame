"""Package canvas-aligned 8-bit RGBA PNG layers into an ordinary raster PSD.

Example:
  python -B tools/live2d/package-layered-psd.py layers.json --output G:/WBSpace/AIDebate/design/live2d/male/source/male.psd

Manifest schema (layers are ordered from bottom to top):
  {"canvas":{"width":512,"height":512},"layers":[
    {"name":"Body","file":"Body.png","visible":true},
    {"name":"Alternate outfit","file":"OutfitB.png","visible":false}]}

Relative PNG paths resolve against the manifest directory. Outputs are the named
PSD, <stem>.preview.png (visible layers only), and <stem>.layers.json (provenance,
layer order, visibility, crop coordinates and hashes). Alpha bounds are cropped
by default without moving artwork; --no-crop stores full-canvas layer rectangles.
Requires Pillow. The PSD layout follows the project's successful proof writer,
including ResolutionInfo for Cubism 5.3.04 compatibility, plus visibility flags
and the standard Unicode layer-name tag. No original inputs are rewritten.
Layer channels preserve straight RGBA. The document's merged preview stores
RGB composited over white plus the original alpha, as expected by PSD readers;
un-matting that 8-bit preview can introduce rounding in its recovered RGB.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import struct
import sys

from PIL import Image


PROJECT = Path(__file__).resolve().parents[2]
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@dataclass
class Layer:
    name: str
    source: Path
    visible: bool
    image: Image.Image
    bounds: tuple[int, int, int, int]
    sha256: str


def u16(value: int) -> bytes:
    return struct.pack(">H", value)


def u32(value: int) -> bytes:
    if value < 0 or value > 0xFFFFFFFF:
        raise ValueError("PSD v1 section is too large; use smaller canvases/layers")
    return struct.pack(">I", value)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require_project_path(value: Path, label: str) -> Path:
    resolved = value.resolve()
    project = PROJECT.resolve()
    if resolved.drive.upper() != "G:" or not resolved.is_relative_to(project):
        raise ValueError(f"{label} must resolve inside the G: project: {project}")
    return resolved


def load_layers(manifest_path: Path, crop: bool) -> tuple[tuple[int, int], list[Layer]]:
    data = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict) or not isinstance(data.get("canvas"), dict):
        raise ValueError("Manifest requires a canvas object and a bottom-to-top layers array")
    canvas = data["canvas"]
    size = (canvas.get("width"), canvas.get("height"))
    if any(type(value) is not int or not 1 <= value <= 30000 for value in size):
        raise ValueError("PSD v1 canvas width/height must be integers in 1..30000")
    entries = data.get("layers")
    if not isinstance(entries, list) or not 2 <= len(entries) <= 32767:
        raise ValueError("At least 2 and at most 32767 independent layers are required")
    names: set[str] = set()
    layers: list[Layer] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"Layer {index} must be an object")
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip() or any(ord(char) < 32 for char in name):
            raise ValueError(f"Layer {index} needs a nonempty name without control characters")
        if name in names:
            raise ValueError(f"Duplicate layer name: {name}")
        names.add(name)
        # Explicitly reject invalid lone surrogates before any output is written.
        name.encode("utf-16-be")
        visible = entry.get("visible", True)
        if type(visible) is not bool:
            raise ValueError(f"Layer visibility must be a JSON boolean: {name}")
        filename = entry.get("file")
        if not isinstance(filename, str) or not filename:
            raise ValueError(f"Layer requires a PNG file: {name}")
        source = require_project_path(manifest_path.parent / filename, f"PNG for {name}")
        encoded = source.read_bytes()
        if len(encoded) < 33 or encoded[:8] != PNG_SIGNATURE or encoded[12:16] != b"IHDR":
            raise ValueError(f"Not a PNG: {source}")
        width, height, depth, color_type = struct.unpack(">IIBB", encoded[16:26])
        if depth != 8 or color_type != 6:
            raise ValueError(f"PNG must already be 8-bit RGBA (not RGB/indexed/16-bit): {source}")
        if (width, height) != size:
            raise ValueError(f"PNG canvas {(width, height)} differs from manifest {size}: {source}")
        with Image.open(source) as opened:
            if opened.format != "PNG" or opened.mode != "RGBA" or getattr(opened, "n_frames", 1) != 1:
                raise ValueError(f"Expected one ordinary RGBA PNG frame: {source}")
            opened.load()
            image = opened.copy()
        alpha_bounds = image.getchannel("A").getbbox()
        if alpha_bounds is None:
            raise ValueError(f"Layer alpha is entirely empty: {name}")
        bounds = alpha_bounds if crop else (0, 0, size[0], size[1])
        layers.append(Layer(name, source, visible, image, bounds, digest(encoded)))
    return size, layers


def merged_image(size: tuple[int, int], layers: list[Layer]) -> Image.Image:
    merged = Image.new("RGBA", size)
    for layer in layers:
        if layer.visible:
            merged = Image.alpha_composite(merged, layer.image)
    return merged


def name_data(name: str) -> bytes:
    # Pascal fallback is for legacy readers; luni preserves the full Unicode name.
    fallback = name.encode("mac_roman", errors="replace")[:255]
    pascal = bytes((len(fallback),)) + fallback
    pascal += b"\0" * (-len(pascal) % 4)
    unicode_name = name.encode("utf-16-be")
    unicode_data = u32(len(unicode_name) // 2) + unicode_name
    unicode_tag = b"8BIMluni" + u32(len(unicode_data)) + unicode_data
    unicode_tag += b"\0" * (len(unicode_data) % 2)
    return pascal + unicode_tag


def encode_psd(size: tuple[int, int], layers: list[Layer], merged: Image.Image) -> bytes:
    records: list[bytes] = []
    pixels: list[bytes] = []
    for layer in layers:
        left, top, right, bottom = layer.bounds
        channels = [u16(0) + band.tobytes() for band in layer.image.crop(layer.bounds).split()]
        record = struct.pack(">iiiiH", top, left, bottom, right, 4)
        for channel_id, channel in zip((0, 1, 2, -1), channels):
            record += struct.pack(">hI", channel_id, len(channel))
        # PSD flag bit 1 means hidden. Preserve the successful proof's bit 3.
        flags = 8 | (0 if layer.visible else 2)
        record += b"8BIMnorm" + bytes((255, 0, flags, 0))
        extra = u32(0) + u32(0) + name_data(layer.name)
        records.append(record + u32(len(extra)) + extra)
        pixels.extend(channels)
    layer_info = struct.pack(">h", -len(layers)) + b"".join(records + pixels)
    layer_info += b"\0" * (len(layer_info) % 2)
    layer_mask = u32(len(layer_info)) + layer_info + u32(0)
    header = b"8BPS" + u16(1) + b"\0" * 6
    header += u16(4) + u32(size[1]) + u32(size[0]) + u16(8) + u16(3)
    resolution = struct.pack(">IHHIHH", 72 << 16, 1, 1, 72 << 16, 1, 1)
    resources = b"8BIM" + u16(1005) + b"\0\0" + u32(len(resolution)) + resolution
    # The document preview uses white-matted RGB, unlike the straight RGBA
    # channels in each layer above. PSD readers remove this white matte when
    # recovering a transparent preview. Storing straight RGB here causes
    # dark/colored fringes wherever alpha is below 255.
    preview_rgb = Image.alpha_composite(Image.new("RGBA", size, "white"), merged)
    preview_rgb.putalpha(merged.getchannel("A"))
    merged_data = u16(0) + b"".join(band.tobytes() for band in preview_rgb.split())
    return header + u32(0) + u32(len(resources)) + resources + u32(len(layer_mask)) + layer_mask + merged_data


def package(manifest_path: Path, output_path: Path, *, crop: bool = True, overwrite: bool = False) -> dict:
    manifest_path = require_project_path(manifest_path, "Input manifest")
    output_path = require_project_path(output_path, "PSD output")
    if output_path.suffix.lower() != ".psd":
        raise ValueError("--output must name a .psd file")
    preview_path = require_project_path(output_path.with_suffix(".preview.png"), "Preview output")
    receipt_path = require_project_path(output_path.with_suffix(".layers.json"), "Layer receipt output")
    size, layers = load_layers(manifest_path, crop)
    inputs = {manifest_path, *(layer.source for layer in layers)}
    for destination in (output_path, preview_path, receipt_path):
        if destination in inputs:
            raise ValueError(f"An output would overwrite an input: {destination}")
        if destination.exists() and not overwrite:
            raise ValueError(f"Output already exists (use --overwrite to replace): {destination}")
    merged = merged_image(size, layers)
    payload = encode_psd(size, layers, merged)
    receipt = {
        "format": "ordinary-raster-psd-v1", "source_manifest": str(manifest_path),
        "source_manifest_sha256": digest(manifest_path.read_bytes()),
        "canvas": {"width": size[0], "height": size[1], "color_mode": "RGBA", "depth": 8},
        "layer_order": "bottom-to-top", "alpha_bounds_cropped": crop,
        "merged_includes": "visible layers only",
        "merged_rgb_storage": "white-matted RGB with original alpha; individual layers retain straight RGBA",
        "psd": str(output_path),
        "psd_sha256": digest(payload), "psd_bytes": len(payload),
        "preview": str(preview_path),
        "layers": [{"name": layer.name, "file": str(layer.source), "source_sha256": layer.sha256,
                    "visible": layer.visible, "bbox": list(layer.bounds),
                    "source_canvas": list(size)} for layer in layers],
        "cubism_import": "must be verified in Editor for each production package",
    }
    # All semantic validation finishes before the first output is created.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(payload)
    merged.save(preview_path)
    receipt["preview_sha256"] = digest(preview_path.read_bytes())
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path, help="JSON with canvas and bottom-to-top layers")
    parser.add_argument("--output", required=True, type=Path, help="Destination .psd in this G: project")
    parser.add_argument("--no-crop", action="store_true", help="Keep full-canvas layer rectangles")
    parser.add_argument("--overwrite", action="store_true", help="Replace existing generated PSD/preview/receipt")
    args = parser.parse_args()
    try:
        receipt = package(args.manifest, args.output, crop=not args.no_crop, overwrite=args.overwrite)
    except (OSError, ValueError, struct.error) as error:
        parser.exit(1, f"PSD packaging failed: {error}\n")
    print(json.dumps({"psd": receipt["psd"], "preview": receipt["preview"], "layers": len(receipt["layers"]),
                      "visible_layers": sum(layer["visible"] for layer in receipt["layers"]), "bytes": receipt["psd_bytes"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
