"""
Render the PNG app icons from the same geometry as public/icon.svg (Pillow, 4x supersampled).
Run: python apps/web/scripts/make-icons.py   (writes into apps/web/public)

  icon-192.png, icon-512.png   rounded tile with transparent corners ("any")
  icon-maskable-512.png        full-bleed tile, artwork inside the maskable safe zone
  apple-touch-icon.png (180)   full-bleed square; iOS rounds the corners itself and ignores SVG
"""
import math
import os
from PIL import Image, ImageDraw

GREEN, CREAM, ORANGE = (0x2F, 0x6F, 0x4F, 255), (0xF7, 0xF6, 0xF3, 255), (0xF0, 0x88, 0x3E, 255)
OUT = os.path.join(os.path.dirname(__file__), "..", "public")
SS = 4  # supersampling


def cubic(p0, p1, p2, p3, n=48):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def flame():
    # M206 300 c0-48 22-86 50-112 28 26 50 64 50 112 a50 50 0 0 1-100 0z  (SVG units)
    pts = cubic((206, 300), (206, 252), (228, 214), (256, 188))
    pts += cubic((256, 188), (284, 214), (306, 252), (306, 300))[1:]
    # half circle under the flame, from (306,300) round the bottom to (206,300)
    pts += [(256 + 50 * math.cos(a), 300 + 50 * math.sin(a)) for a in (i / 48 * math.pi for i in range(1, 49))]
    return pts


def render(size, *, rounded, art_scale, art_center=(256, 268), target=(256, 268)):
    S = size * SS
    k = S / 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=112 * k, fill=GREEN)
    else:
        d.rectangle((0, 0, S, S), fill=GREEN)

    def tx(p):  # SVG point → pixels, with the artwork scaled about its centre
        x = (p[0] - art_center[0]) * art_scale + target[0]
        y = (p[1] - art_center[1]) * art_scale + target[1]
        return (x * k, y * k)

    r, w = 150 * art_scale * k, 36 * art_scale * k
    cx, cy = tx((256, 268))
    d.ellipse((cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2), outline=CREAM, width=round(w))
    d.arc((cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2), start=-90, end=0, fill=ORANGE, width=round(w))
    for ex, ey in (tx((256, 118)), tx((406, 268))):  # round line caps
        d.ellipse((ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2), fill=ORANGE)
    d.polygon([tx(p) for p in flame()], fill=CREAM)
    return img.resize((size, size), Image.LANCZOS)


def main():
    render(192, rounded=True, art_scale=1).save(os.path.join(OUT, "icon-192.png"), optimize=True)
    render(512, rounded=True, art_scale=1).save(os.path.join(OUT, "icon-512.png"), optimize=True)
    # Same transform as icon-maskable.svg: art at 72%, centred at (256, 262).
    render(512, rounded=False, art_scale=0.72, target=(256, 262)).save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)
    apple = render(180, rounded=False, art_scale=0.8, target=(256, 262)).convert("RGB")  # iOS: no transparency
    apple.save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    print("icons written to", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
