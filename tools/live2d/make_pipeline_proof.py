"""Create an original geometry-only layered PSD to verify the Cubism toolchain.

This file is not character art, a Cubism rig, or a compiled model. It deliberately
uses five simple, fully painted layers so importing/meshing/binding/exporting can
be tested independently of character art production. Requires only Pillow.

PSD structure follows Adobe's public Photoshop File Formats Specification:
https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct

from PIL import Image, ImageDraw


PROJECT = Path(__file__).resolve().parents[2]
OUT = PROJECT / "design" / "live2d" / "pipeline-proof" / "source"
SIZE = (512, 512)


def u16(value: int) -> bytes:
    return struct.pack(">H", value)


def u32(value: int) -> bytes:
    return struct.pack(">I", value)


def psd_bytes(layers_bottom_first: list[tuple[str, Image.Image]]) -> bytes:
    """Write a small 8-bit RGBA PSD with ordinary raster layers, no effects."""
    composite = Image.new("RGBA", SIZE)
    for _, layer in layers_bottom_first:
        composite = Image.alpha_composite(composite, layer)

    records = []
    pixels = []
    # PSD stores raster layer records in stacking order, bottom to top.
    # A merged preview alone cannot detect accidentally reversed layer records.
    for name, layer in layers_bottom_first:
        bbox = layer.getchannel("A").getbbox()
        if bbox is None:
            raise ValueError(f"Layer has no painted pixels: {name}")
        left, top, right, bottom = bbox
        crop = layer.crop(bbox)
        channels = [u16(0) + band.tobytes() for band in crop.split()]
        encoded_name = name.encode("ascii")
        pascal_name = bytes([len(encoded_name)]) + encoded_name
        pascal_name += b"\0" * (-len(pascal_name) % 4)
        extra = u32(0) + u32(0) + pascal_name
        record = struct.pack(">iiiiH", top, left, bottom, right, 4)
        for channel_id, channel_data in zip((0, 1, 2, -1), channels):
            record += struct.pack(">hI", channel_id, len(channel_data))
        record += b"8BIMnorm" + bytes((255, 0, 8, 0))
        record += u32(len(extra)) + extra
        records.append(record)
        pixels.extend(channels)

    # Negative layer count identifies the merged fourth channel as transparency.
    layer_info = struct.pack(">h", -len(records)) + b"".join(records + pixels)
    layer_info += b"\0" * (len(layer_info) % 2)
    layer_mask = u32(len(layer_info)) + layer_info + u32(0)
    header = b"8BPS" + u16(1) + b"\0" * 6
    header += u16(4) + u32(SIZE[1]) + u32(SIZE[0]) + u16(8) + u16(3)
    merged = u16(0) + b"".join(band.tobytes() for band in composite.split())
    # Cubism 5.3.04 rejected our empty resource section at byte 0x26. Supply
    # standard 72 dpi ResolutionInfo (ID 1005) as emitted by mainstream PSD
    # editors. Actual Cubism import must still validate this compatibility fix.
    # Resource names are Pascal strings padded to an even number of bytes.
    resolution = struct.pack(">IHHIHH", 72 << 16, 1, 1, 72 << 16, 1, 1)
    resources = b"8BIM" + u16(1005) + b"\0\0" + u32(len(resolution)) + resolution
    return header + u32(0) + u32(len(resources)) + resources + u32(len(layer_mask)) + layer_mask + merged


def make_layer(draw_callback) -> Image.Image:
    layer = Image.new("RGBA", SIZE)
    draw_callback(ImageDraw.Draw(layer))
    return layer


def main() -> None:
    if PROJECT.drive.upper() != "G:":
        raise SystemExit("This task's source and output files must stay on G:.")
    OUT.mkdir(parents=True, exist_ok=True)
    outline = "#17293E"
    layers = [
        ("Proof_Body", make_layer(lambda d: d.rounded_rectangle(
            (144, 272, 312, 450), radius=28, fill="#D54554", outline=outline, width=8))),
        ("Proof_Head", make_layer(lambda d: d.rounded_rectangle(
            (132, 110, 324, 294), radius=48, fill="#EEDABC", outline=outline, width=8))),
        ("Proof_EyeL", make_layer(lambda d: d.ellipse(
            (174, 166, 194, 216), fill=outline))),
        ("Proof_EyeR", make_layer(lambda d: d.ellipse(
            (262, 166, 282, 216), fill=outline))),
        ("Proof_ArrowArm", make_layer(lambda d: d.polygon(
            [(280, 302), (384, 302), (384, 280), (444, 326),
             (384, 372), (384, 350), (280, 350)],
            fill="#E1B24C", outline=outline, width=8))),
    ]
    composite = Image.new("RGBA", SIZE)
    entries = []
    for name, layer in layers:
        destination = OUT / f"{name}.png"
        layer.save(destination)
        composite = Image.alpha_composite(composite, layer)
        entries.append({
            "name": name,
            "file": destination.name,
            "bbox": layer.getchannel("A").getbbox(),
            "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        })
    composite.save(OUT / "pipeline-proof.png")
    psd_path = OUT / "pipeline-proof.psd"
    psd_path.write_bytes(psd_bytes(layers))

    # A separate decoder checks that the saved PSD is readable and preserves
    # the merged RGBA pixels and all five named layers.
    with Image.open(psd_path) as decoded:
        if decoded.convert("RGBA").tobytes() != composite.tobytes():
            raise RuntimeError("PSD merged RGBA pixels did not round-trip")
        decoded_layers = decoded.layers
        expected = [name for name, _ in layers]
        if [layer[0] for layer in decoded_layers] != expected:
            raise RuntimeError("PSD named layers did not round-trip")

    manifest = {
        "kind": "original-geometry-pipeline-test-only",
        "production_character": False,
        "purpose": "Verify layered PSD import, real Cubism mesh/parameter setup and real Editor export.",
        "canvas": {"width": SIZE[0], "height": SIZE[1], "color_mode": "RGBA", "depth": 8},
        "layers_bottom_first": entries,
        "psd": psd_path.name,
        "psd_sha256": hashlib.sha256(psd_path.read_bytes()).hexdigest(),
        "source_script": "tools/live2d/make_pipeline_proof.py",
        "provenance": "Original simple shapes authored programmatically for this project; no AI/image/reference assets.",
        "validation": {
            "pillow_psd_read": "passed",
            "merged_rgba_pixel_roundtrip": "passed",
            "five_named_raster_layers": "passed",
            "cubism_import": "must be checked in real Editor",
            "cubism_export": "must be performed in real Editor",
        },
        "suggested_bindings": {
            "ParamBreath": "Proof_Body vertical scaling from lower edge, 0..1",
            "ParamEyeLOpen": "Proof_EyeL vertical compression about center, 0..1",
            "ParamEyeROpen": "Proof_EyeR vertical compression about center, 0..1",
            "ParamObjection": "Proof_ArrowArm movement/rotation, 0..1",
        },
        "limitations": "This geometric proof is not the male player, an NPC, a production rig, or an artistic approval candidate.",
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"psd": str(psd_path), "layers": len(layers), "bytes": psd_path.stat().st_size, "roundtrip": "passed"}))


if __name__ == "__main__":
    main()
