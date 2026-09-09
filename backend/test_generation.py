"""
Standalone generation test - bypasses HTTP and calls the service directly.

Usage (from the backend folder, venv activated):
    python test_generation.py "optional prompt text"
"""

import sys
from pathlib import Path

from services.image_generation import generate_image, list_gallery_images

IMAGES_DIR = Path(__file__).resolve().parent / "static" / "images"


def main():
    prompt = (
        " ".join(sys.argv[1:])
        or "A serene frog pond at dusk, pastel colors, phone wallpaper"
    )
    print(f"Generating image for prompt: {prompt!r}")
    image = generate_image(
        prompt=prompt,
        width=1080,
        height=1920,
        images_dir=IMAGES_DIR,
    )
    print(
        f"OK -> {image['filename']} "
        f"({image['size_bytes']} bytes, {image['width']}x{image['height']})"
    )
    total = len(list_gallery_images(IMAGES_DIR))
    print(f"Gallery now holds {total} image(s).")


if __name__ == "__main__":
    main()
