#!/usr/bin/env python3
"""Build the install icons and a monochrome toolbar icon strip."""

import math
import struct
import sys
import zlib
from pathlib import Path


def png(path, width, height, pixel):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    scanlines = bytearray()
    for y in range(height):
        scanlines.append(0)
        for x in range(width):
            scanlines.extend(pixel(x, y))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(scanlines, 9)) + chunk(b"IEND", b""))


def segment_distance(px, py, start, end):
    x, y = start
    dx, dy = end[0] - x, end[1] - y
    fraction = max(0, min(1, ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - x - fraction * dx, py - y - fraction * dy)


# Paths sit on a 24 × 24 grid. Their order is also used by the CSS mask.
ICONS = [
    [[(12, 5), (12, 19)], [(5, 12), (19, 12)]],
    [[(4, 5), (20, 5), (20, 16), (9, 16), (4, 20), (4, 5)]],
    [[(5, 6), (19, 6)], [(5, 12), (19, 12)], [(5, 18), (19, 18)], [(9, 4), (9, 8)], [(15, 10), (15, 14)], [(11, 16), (11, 20)]],
    [[(12, 16), (12, 4)], [(7, 9), (12, 4), (17, 9)], [(5, 14), (5, 20), (19, 20), (19, 14)]],
    [[(6, 6), (18, 18)], [(18, 6), (6, 18)]],
    [[(6, 10), (12, 16), (18, 10)]],
    [[(12, 19), (12, 5)], [(6, 11), (12, 5), (18, 11)]],
    [[(5, 20), (5, 5), (12, 7), (19, 5), (19, 20), (12, 21), (5, 20)], [(12, 7), (12, 21)]],
    [[(13, 3), (5, 13), (11, 13), (10, 21), (19, 10), (13, 10), (13, 3)]],
    [[(12, 4), (18, 7), (18, 13), (15, 18), (12, 20), (9, 18), (6, 13), (6, 7), (12, 4)], [(9, 12), (11, 14), (15, 10)]],
    [[(6, 4), (14, 4), (18, 8), (18, 20), (6, 20), (6, 4)], [(14, 4), (14, 8), (18, 8)], [(9, 12), (15, 12)], [(9, 16), (15, 16)]],
    [[(5, 11), (10, 16), (19, 7)]],
    [[(5, 5), (19, 5), (19, 19), (5, 19), (5, 5)], [(9, 5), (9, 19)]],
    [[(5, 12), (19, 12)], [(12, 5), (19, 12), (12, 19)]],
    [[(5, 4), (18, 4), (18, 14), (5, 14), (5, 4)], [(8, 18), (15, 18)], [(11, 14), (11, 18)]]
]


def icon_pixel(paths, x, y):
    distance = min(segment_distance(x, y, a, b) for path in paths for a, b in zip(path, path[1:]))
    return 255, 255, 255, round(max(0, min(1, (0.99 - distance) * 3)) * 255)


def strip_pixel(x, y):
    return icon_pixel(ICONS[x // 72], (x % 72 + 0.5) / 3, (y + 0.5) / 3)


def app_pixel(size, x, y):
    px, py = ((x + 0.5) * 100 / size, (y + 0.5) * 100 / size)
    distance = min(
        segment_distance(px, py, (34, 60), (34, 50)),
        segment_distance(px, py, (45, 64), (45, 41)),
        segment_distance(px, py, (56, 56), (56, 35)),
        segment_distance(px, py, (67, 57), (67, 46))
    )
    intensity = max(0, min(1, (3.15 - distance) * size / 100))
    tone = 0.6 * (x + y) / (2 * size)
    background = (22 + 15 * tone, 35 + 18 * tone, 40 + 38 * tone)
    foreground = (148, 239, 201)
    return tuple(round(base + (accent - base) * intensity) for base, accent in zip(background, foreground)) + (255,)


def main():
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    png(target / "icons.png", 72 * len(ICONS), 72, strip_pixel)
    for size in [192, 512]:
        png(target / f"icon-{size}.png", size, size, lambda x, y: app_pixel(size, x, y))


if __name__ == "__main__":
    main()
