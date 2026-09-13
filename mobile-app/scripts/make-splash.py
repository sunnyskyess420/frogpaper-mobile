#!/usr/bin/env python3
# Regenerates generated icon/splash assets from the source art in ../assets/source.
# Run from anywhere: python mobile-app/scripts/make-splash.py
"""New FrogPaper launch screen artwork.

The old splash was a single opaque square PNG used as android:windowBackground,
so Android stretched it across the whole screen (that pale, washed-out look).
The new artwork is transparent with a soft green glow behind the frog, and it is
centred over a flat dark-navy background by a layer-list drawable.
"""
from PIL import Image, ImageOps
import os

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "source", "mascot-frog.png")
ASSETS = r"C:\FrogPaperMobile\mobile-app\assets"
RES = r"C:\FrogPaperMobile\mobile-app\android\app\src\main\res"

ACCENT = (52, 211, 153)     # the app's frog-green accent (#34D399)
DARK = (11, 18, 32)         # the app's background navy (#0B1220)
ART_FRACTION = 0.55         # frog height vs. the logo canvas
GLOW_ALPHA = 0.55
# Expo's splash canvas convention, already used by the existing files: 288dp square
DENSITIES = {"mdpi": 288, "hdpi": 432, "xhdpi": 576, "xxhdpi": 864, "xxxhdpi": 1152}


def tight(im):
    bbox = im.split()[-1].getbbox()
    return im.crop(bbox) if bbox else im


def glow(size, alpha):
    """Soft radial accent glow, brightest in the middle."""
    base = ImageOps.invert(Image.radial_gradient("L").resize((size, size), Image.BICUBIC))
    # Fade the glow to zero well before the canvas edge: the raw radial gradient
    # still has ~16% alpha at the edge midpoints, which read as a faint square
    # panel behind the frog on the launch screen.
    floor = 0.62
    base = base.point(lambda v: int(max(0.0, (v / 255.0 - floor) / (1.0 - floor)) * 255 * alpha))
    layer = Image.new("RGBA", (size, size), ACCENT + (0,))
    layer.putalpha(base)
    return layer


def splash(size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(glow(size, GLOW_ALPHA))
    target = int(round(size * ART_FRACTION))
    w, h = mascot.size
    scale = min(target / w, target / h)
    art = mascot.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


mascot = tight(Image.open(SRC).convert("RGBA"))
print(f"frog artwork: {mascot.size}")

written = []
for name, size in DENSITIES.items():
    path = os.path.join(RES, f"drawable-{name}", "splashscreen_logo.png")
    splash(size).save(path, "PNG", optimize=True)
    written.append(f"drawable-{name}/splashscreen_logo.png {size}x{size} ({round(os.path.getsize(path)/1024)} KB)")

# source-of-truth copy for future prebuilds (splash-icon.png is 1024x1024 today)
splash(1024).save(os.path.join(ASSETS, "splash-icon.png"), "PNG", optimize=True)
written.append("assets/splash-icon.png 1024x1024")

# a flat navy layer-list so the logo is centred instead of stretched
drawable_dir = os.path.join(RES, "drawable")
layer_list = """<?xml version="1.0" encoding="utf-8"?>
<!-- Launch screen: flat app-navy background with the mascot logo centred.
     The previous version used the square logo bitmap as the window
     background directly, which Android stretched over the whole screen. -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/splashscreen_background"/>
  <item>
    <bitmap android:gravity="center" android:src="@drawable/splashscreen_logo"/>
  </item>
</layer-list>
"""
with open(os.path.join(drawable_dir, "splashscreen.xml"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write(layer_list)
written.append("drawable/splashscreen.xml (navy background + centred logo)")

print("\n".join(written))
