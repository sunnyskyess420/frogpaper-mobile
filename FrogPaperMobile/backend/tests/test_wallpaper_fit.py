"""v1.9.9 tests: tall-phone wallpaper shape (Galaxy S9 zoom fix).

Repo-portable version. Run from anywhere:
    python backend/tests/test_wallpaper_fit.py

Sections [1]-[4] need no real token (they use a fake token and the
pollinations fallback). Section [5] is a LIVE paid render that only
runs when a real Replicate token is found in the REPLICATE_API_TOKEN
env var or backend/replicate_api_token.txt.
"""
import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# A real token (env var first, then the gitignored local file) unlocks
# the LIVE section. Everything else works with fakes.
real_token = os.environ.get("REPLICATE_API_TOKEN", "").strip()
if not real_token:
    _f = BACKEND / "replicate_api_token.txt"
    if _f.is_file():
        _cand = _f.read_text().strip()
        if _cand.startswith("r8_") and len(_cand) > 10:
            real_token = _cand

os.environ["REPLICATE_API_TOKEN"] = "r8_fake_token_for_401_test"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("HF_TOKEN", None)
os.environ.pop("HUGGINGFACE_TOKEN", None)

from services import image_generation as ig  # noqa: E402
import app as flask_app  # noqa: E402

PASS, FAIL, SKIP = [], [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")


print("[1] fit_device_wallpaper retarget rules")
check("1080x1920 -> 1080x2220", ig.fit_device_wallpaper(1080, 1920) == (1080, 2220))
check("1440x2560 -> 1440x2960", ig.fit_device_wallpaper(1440, 2560) == (1440, 2960))
check("landscape untouched", ig.fit_device_wallpaper(1920, 1080) == (1920, 1080))
check("square untouched", ig.fit_device_wallpaper(1080, 1080) == (1080, 1080))
check("already-tall untouched", ig.fit_device_wallpaper(1080, 2280) == (1080, 2280))
check("9:21 request untouched", ig.fit_device_wallpaper(768, 1792) == (768, 1792))

print("[2] flux ratio snapping with live-verified enum")
check("1080x2220 -> 9:21", ig._replicate_aspect_ratio(1080, 2220) == "9:21")
check("1080x1920 -> 9:16", ig._replicate_aspect_ratio(1080, 1920) == "9:16")
check("1920x1080 -> 16:9", ig._replicate_aspect_ratio(1920, 1080) == "16:9")
check("1080x1080 -> 1:1", ig._replicate_aspect_ratio(1080, 1080) == "1:1")

print("[3] app-level retarget through /api/generate (fake-token fallback path)")
ig.refresh_provider_statuses()
client = flask_app.app.test_client()
resp = client.post("/api/generate", json={
    "prompt": "tall frog wallpaper", "width": 1080, "height": 1920,
})
body = resp.json.get("image", {})
print("   status:", resp.status_code, "| provider:", body.get("provider"),
      "| size:", body.get("width"), "x", body.get("height"))
check("HTTP 201 delivered", resp.status_code == 201)
check("retargeted to tall shape", body.get("width") == 1080 and body.get("height") == 2220)
check("fallback still flagged", body.get("provider_fallback_from") == "replicate")

print("[4] explicit tall request passes through")
resp2 = client.post("/api/generate", json={
    "prompt": "tall frog wallpaper", "width": 1080, "height": 2220,
})
body2 = resp2.json.get("image", {})
check("2220 request stays 2220", body2.get("width") == 1080 and body2.get("height") == 2220)

print("[5] LIVE: real token, 1080x2220 flux-dev render through backend code")
if real_token:
    os.environ["REPLICATE_API_TOKEN"] = real_token
    ig.refresh_provider_statuses()
    out = Path(tempfile.mkdtemp(prefix="frogpaper_live_"))
    try:
        result = ig.generate_image_replicate(
            prompt=(
                "a red-eyed tree frog clinging to a tall leaf, misty rainforest "
                "canopy, macro photography, vivid detail"
            ),
            width=1080,
            height=2220,
            images_dir=out,
        )
        print("   model :", result["model"], "| size: %dx%d" % (result["width"], result["height"]),
              "| bytes:", result["size_bytes"], "| file:", result["filename"])
        check("render is exactly 1080x2220", result["width"] == 1080 and result["height"] == 2220)
    except Exception as exc:  # noqa: BLE001
        print("   FAILED:", type(exc).__name__, "->", exc)
        check("live tall render", False)
else:
    SKIP.append("live tall render (no real token found)")
    print("   SKIPPED - no real token in env or backend/replicate_api_token.txt")

print()
print("RESULT: %d PASS / %d FAIL / %d SKIPPED" % (len(PASS), len(FAIL), len(SKIP)))
sys.exit(1 if FAIL else 0)
