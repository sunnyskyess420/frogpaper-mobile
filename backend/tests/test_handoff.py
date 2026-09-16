#!/usr/bin/env python3
"""Hand-off window: generated images must not pile up on the server.

The owner's rule is that images live on the user's phone. The server has to hold a
picture for a moment to hand it over, so it keeps each one for a bounded window
(default 60 minutes) and sweeps the rest.

This exercises the real sweeper against the configured image store, using uniquely
named files it cleans up afterwards. No network, no provider calls.

    python tests/test_handoff.py
"""

import io
import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import app  # noqa: E402

PASS, FAIL = [], []


def check(name, condition, extra=""):
    (PASS if condition else FAIL).append(name)
    print(f"  {'PASS' if condition else 'FAIL'}  {name} {extra}")


def store_dir():
    """Where the configured store keeps files."""
    for attr in ("images_dir", "dir", "root", "_dir"):
        value = getattr(app.IMAGE_STORAGE, attr, None)
        if value:
            return Path(str(value))
    return BACKEND / "static" / "images"


def write_fake(path, age_seconds):
    with io.open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    stamp = time.time() - age_seconds
    os.utime(path, (stamp, stamp))


def main():
    print("[1] configuration")
    check("a hand-off window is configured", isinstance(app.HANDOFF_TTL_MINUTES, int), str(app.HANDOFF_TTL_MINUTES))
    check("the window is a sensible length", 0 <= app.HANDOFF_TTL_MINUTES <= 24 * 60, str(app.HANDOFF_TTL_MINUTES))
    check("the sweeper is callable", callable(app.sweep_handoff_images))

    print("[2] sweeping")
    directory = store_dir()
    print(f"   store: {directory}")
    directory.mkdir(parents=True, exist_ok=True)

    old = directory / "handoff_test_old.png"
    fresh = directory / "handoff_test_fresh.png"
    write_fake(old, 60 * 60 * 3)  # three hours old
    write_fake(fresh, 5)  # five seconds old

    check("an empty sweep returns a number", isinstance(app.sweep_handoff_images(), int))
    check("the old image was swept", not old.exists())
    check("the fresh image was kept", fresh.exists())
    check("the fresh image is still listed", any(
        os.path.basename(entry["filename"]) == fresh.name
        for entry in app.IMAGE_STORAGE.list_images()
    ))
    check("an empty store does not raise", isinstance(app.sweep_handoff_images(), int))

    print("[3] the window is respected, not just age")
    # A file older than a minute but newer than the window must survive.
    middle = directory / "handoff_test_middle.png"
    write_fake(middle, 60)
    app.sweep_handoff_images()
    check("an image inside the window survives", middle.exists())

    for leftover in (fresh, middle):
        try:
            os.remove(leftover)
        except OSError:
            pass
    print("   (test files cleaned up)")

    print(f"RESULT: {len(PASS)} PASS / {len(FAIL)} FAIL / 0 SKIPPED")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
