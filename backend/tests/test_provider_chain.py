"""v1.9.8 tests: Replicate provider wiring + fallback resilience."""
import os, sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Token env BEFORE importing anything - provider statuses read it live.
os.environ["REPLICATE_API_TOKEN"] = "r8_fake_token_for_401_test"
os.environ.pop("GEMINI_API_KEY", None)      # isolate: only replicate present
os.environ.pop("HF_TOKEN", None)
os.environ.pop("HUGGINGFACE_TOKEN", None)

from services import image_generation as ig  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")


print("[1] token reading + config")
check("env token read", ig.read_replicate_api_token() == "r8_fake_token_for_401_test")
check("replicate_configured True", ig.replicate_configured() is True)
os.environ.pop("REPLICATE_API_TOKEN")
check("no token -> None", ig.read_replicate_api_token() is None)

print("[2] aspect ratio snapping (flux-safe list)")
check("1080x1920 -> 9:16", ig._replicate_aspect_ratio(1080, 1920) == "9:16")
check("1920x1080 -> 16:9", ig._replicate_aspect_ratio(1920, 1080) == "16:9")
check("1080x1080 -> 1:1", ig._replicate_aspect_ratio(1080, 1080) == "1:1")
check("no 21:9 ever emitted", ig._replicate_aspect_ratio(2100, 900) != "21:9")

print("[3] friendly error mapping (mocked responses)")


class FakeResp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


err = ig._replicate_error_for(FakeResp(401, {"title": "Invalid token", "detail": "Invalid token.", "status": 401}))
check("401 -> token hint with r8_", "r8_" in str(err))
err = ig._replicate_error_for(FakeResp(402, {"detail": "No credit available", "status": 402}))
check("402 -> credit hint", "credit" in str(err).lower())

print("[4] provider registry")
ig.refresh_provider_statuses()
os.environ["REPLICATE_API_TOKEN"] = "r8_fake_token_for_401_test"
ig.refresh_provider_statuses()
rep = next(p for p in ig.PROVIDERS if p["id"] == "replicate")
check("replicate active with token", rep["status"] == "active")
check("default provider = replicate", ig.default_provider_id() == "replicate")
check("pollinations still active", any(p["id"] == "pollinations" and p["status"] == "active" for p in ig.PROVIDERS))

print("[5] LIVE: full app flow, fake token -> 401 -> pollinations fallback (HTTP 201)")
import app as flask_app
client = flask_app.app.test_client()
resp = client.post("/api/generate", json={
    "prompt": "frog on a lilypad", "width": 1080, "height": 1920,
})
print("   status:", resp.status_code, "| provider:", resp.json.get("image", {}).get("provider"),
      "| fallback_from:", resp.json.get("image", {}).get("provider_fallback_from"))
check("HTTP 201 delivered", resp.status_code == 201)
body = resp.json.get("image", {})
check("fallback flagged to replicate", body.get("provider_fallback_from") == "replicate")
check("fallback reason mentions token", "token" in str(body.get("fallback_reason", "")).lower())
check("image saved full size (tall shape)", body.get("width") == 1080 and body.get("height") == 2220)

print("[6] /api/providers lists replicate")
plist = client.get("/api/providers").json.get("providers", [])
ids = [p["id"] for p in plist]
check("replicate listed first", ids and ids[0] == "replicate", str(ids))

print()
print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
