#!/usr/bin/env python3
# Regenerates generated icon/splash assets from the source art in ../assets/source.
# Run from anywhere: python mobile-app/scripts/make-icons.py
"""Rebuild the FrogPaper icon set from the frog-alone mascot (tall artwork)."""
from PIL import Image, ImageDraw, ImageOps

ACCENT = (52, 211, 153)      # frog-green accent, for the glow behind the frog
GLOW_FLOOR = 0.62            # glow fades to nothing before the canvas edge
import os

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "source", "mascot-frog.png")
ASSETS = r"C:\FrogPaperMobile\mobile-app\assets"
RES = r"C:\FrogPaperMobile\mobile-app\android\app\src\main\res"

BG = (11, 18, 32, 255)       # app navy (#0B1220) - matches the launch screen and the app theme
FOREGROUND_COVERAGE = 0.66     # tallest side vs. the 108dp adaptive layer (keeps the frog inside the safe zone)
LEGACY_COVERAGE = 0.86         # tallest side vs. the legacy square icon
ROUND_COVERAGE = 0.82
MONO_COVERAGE = 0.66
FAVICON_COVERAGE = 0.94


def tight(im):
    bbox = im.split()[-1].getbbox()
    return im.crop(bbox) if bbox else im


def backdrop(size, glow_alpha=0.28):
    """Navy background with a soft accent glow, so the icon has depth and
    matches the launch screen instead of looking like a flat pale square."""
    canvas = Image.new("RGBA", (size, size), BG)
    base = ImageOps.invert(Image.radial_gradient("L").resize((size, size), Image.BICUBIC))
    base = base.point(lambda v: int(max(0.0, (v / 255.0 - GLOW_FLOOR) / (1.0 - GLOW_FLOOR)) * 255 * glow_alpha))
    glow = Image.new("RGBA", (size, size), ACCENT + (0,))
    glow.putalpha(base)
    canvas.alpha_composite(glow)
    return canvas


def compose(art, size, coverage, background=None, mask=None):
    canvas = backdrop(size) if background == "backdrop" else Image.new("RGBA", (size, size), background if background else (0, 0, 0, 0))
    target = max(1, int(round(size * coverage)))
    w, h = art.size
    scale = min(target / w, target / h)          # tall art is height-limited
    new = art.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)
    canvas.alpha_composite(new, ((size - new.width) // 2, (size - new.height) // 2))
    if mask is not None:
        solid = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        solid.alpha_composite(canvas, (0, 0))
        solid.putalpha(Image.composite(canvas.split()[-1], Image.new("L", (size, size), 0), mask))
        canvas = solid
    return canvas


def silhouette(art, size, coverage):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    target = max(1, int(round(size * coverage)))
    w, h = art.size
    scale = min(target / w, target / h)
    new = art.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)
    shape = Image.new("RGBA", new.size, (0, 0, 0, 255))
    shape.putalpha(new.split()[-1])
    canvas.alpha_composite(shape, ((size - new.width) // 2, (size - new.height) // 2))
    return canvas


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


mascot = tight(Image.open(SRC).convert("RGBA"))
print(f"source artwork after trim: {mascot.size} (aspect {mascot.width/mascot.height:.2f})")

DENSITIES = {"mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216), "xxhdpi": (144, 324), "xxxhdpi": (192, 432)}
count = 0
for name, (legacy, layer) in DENSITIES.items():
    folder = os.path.join(RES, f"mipmap-{name}")
    compose(mascot, legacy, LEGACY_COVERAGE, background="backdrop").save(os.path.join(folder, "ic_launcher.webp"), "WEBP", quality=92, method=6)
    compose(mascot, legacy, ROUND_COVERAGE, background="backdrop", mask=circle_mask(legacy)).save(os.path.join(folder, "ic_launcher_round.webp"), "WEBP", quality=92, method=6)
    backdrop(layer).save(os.path.join(folder, "ic_launcher_background.webp"), "WEBP", quality=92, method=6)
    compose(mascot, layer, FOREGROUND_COVERAGE).save(os.path.join(folder, "ic_launcher_foreground.webp"), "WEBP", quality=92, method=6)
    silhouette(mascot, layer, MONO_COVERAGE).save(os.path.join(folder, "ic_launcher_monochrome.webp"), "WEBP", quality=92, method=6)
    count += 4

compose(mascot, 1024, LEGACY_COVERAGE, background="backdrop").convert("RGB").save(os.path.join(ASSETS, "icon.png"))
backdrop(512).save(os.path.join(ASSETS, "android-icon-background.png"))
compose(mascot, 512, FOREGROUND_COVERAGE).save(os.path.join(ASSETS, "android-icon-foreground.png"))
silhouette(mascot, 432, MONO_COVERAGE).save(os.path.join(ASSETS, "android-icon-monochrome.png"))
compose(mascot, 48, FAVICON_COVERAGE).save(os.path.join(ASSETS, "favicon.png"))
count += 4
print(f"icon files written: {count}")
