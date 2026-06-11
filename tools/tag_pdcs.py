#!/usr/bin/env python3
"""Tag every PDC in resources/data with a unique viewbox fingerprint.

The Pebble build assigns resource ids in an order that is NOT deterministic
across builds, and the FFI id table is not available on all firmware. The
watchface therefore identifies resources at runtime by their viewbox
(width, height), which must be UNIQUE per file. This script rewrites only
the two viewbox int16s in each PDC header — the draw commands (the art)
are untouched; the only visual effect is centering shifts of <= ~2px.

RUN THIS AFTER ADDING OR REPLACING ANY .pdc — exported art usually comes
out at the natural canvas size and will collide with its siblings.

Usage: python3 tools/tag_pdcs.py [resources/data]

KEEP THE TABLE IN SYNC with the FP table in src/embeddedjs/main.js.
"""
import struct, sys, os

# filename -> (viewbox_w, viewbox_h)
TAGS = {
    "petal_1.pdc":      (60, 130),
    "petal_2.pdc":      (61, 130),
    "petal_3.pdc":      (62, 130),
    "petal_fall_1.pdc": (50, 130),
    "petal_fall_2.pdc": (51, 130),
    "petal_fall_3.pdc": (52, 130),
    # faces: width = 104 + set (12_11=0 .. 2_1=5), height = 106 + frame
    "face_12_11_1.pdc": (104, 106), "face_12_11_2.pdc": (104, 107),
    "face_10_9_1.pdc":  (105, 106), "face_10_9_2.pdc":  (105, 107),
    "face_8_7_1.pdc":   (106, 106), "face_8_7_2.pdc":   (106, 107),
    "face_6_5_1.pdc":   (107, 106), "face_6_5_2.pdc":   (107, 107),
    "face_4_3_1.pdc":   (108, 106), "face_4_3_2.pdc":   (108, 107),
    "face_2_1_1.pdc":   (109, 106), "face_2_1_2.pdc":   (109, 107),
    "bee.pdc":          (50, 50),
    "icon_cloudy.pdc":  (24, 18),
    "icon_pcloudy.pdc": (24, 25),
    "icon_clear.pdc":   (40, 40),
    "icon_rain.pdc":    (24, 26),
    "icon_snow.pdc":    (41, 40),
    "icon_storm.pdc":   (42, 40),
}

def tag(path, w, h):
    data = bytearray(open(path, "rb").read())
    assert data[:4] == b"PDCI", f"{path}: not a PDC image"
    size = struct.unpack_from("<I", data, 4)[0]
    assert 8 + size == len(data), f"{path}: bad size field"
    ow, oh = struct.unpack_from("<hh", data, 10)
    if (ow, oh) == (w, h):
        return False
    struct.pack_into("<hh", data, 10, w, h)
    open(path, "wb").write(data)
    print(f"{os.path.basename(path)}: {ow}x{oh} -> {w}x{h}")
    return True

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "resources/data"
    fps, changed = {}, 0
    for name, (w, h) in TAGS.items():
        assert (w, h) not in fps, f"fingerprint collision: {name} vs {fps[(w,h)]}"
        fps[(w, h)] = name
        path = os.path.join(root, name)
        if not os.path.exists(path):
            print(f"MISSING: {name}")
            continue
        changed += tag(path, w, h)
    print(f"{changed} file(s) retagged; all fingerprints unique.")

if __name__ == "__main__":
    main()
