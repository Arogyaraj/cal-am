#!/usr/bin/env python3
"""Generates the PWA icons into ../icons. Standard library only."""
import math, os, struct, zlib

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons"))
C1, C2 = (99, 102, 241), (139, 92, 246)  # indigo to violet

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def render(size, full_bleed):
    r = 0 if full_bleed else size * 0.22
    k = 0.8 if full_bleed else 1.0
    off = (1 - k) / 2
    pts = [(off + u * k, off + v * k) for u, v in [(0.27, 0.52), (0.43, 0.68), (0.74, 0.35)]]
    w = 0.085 * k
    out = bytearray()
    for y in range(size):
        for x in range(size):
            if r:
                cx = min(max(x + 0.5, r), size - r)
                cy = min(max(y + 0.5, r), size - r)
                if math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r:
                    out += b"\x00\x00\x00\x00"
                    continue
            t = (x + y) / (2 * size)
            R = C1[0] + (C2[0] - C1[0]) * t
            G = C1[1] + (C2[1] - C1[1]) * t
            B = C1[2] + (C2[2] - C1[2]) * t
            u, v = (x + 0.5) / size, (y + 0.5) / size
            d = min(seg_dist(u, v, *pts[0], *pts[1]), seg_dist(u, v, *pts[1], *pts[2]))
            cov = max(0.0, min(1.0, 0.5 + (w / 2 - d) * size))
            R += (255 - R) * cov
            G += (255 - G) * cov
            B += (255 - B) * cov
            out += bytes((int(R), int(G), int(B), 255))
    return bytes(out)

def write_png(path, size, data):
    raw = b"".join(b"\x00" + data[y * size * 4:(y + 1) * size * 4] for y in range(size))
    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)

if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, True),
    ]
    for name, size, full in jobs:
        write_png(os.path.join(ROOT, name), size, render(size, full))
        print("wrote", name)
