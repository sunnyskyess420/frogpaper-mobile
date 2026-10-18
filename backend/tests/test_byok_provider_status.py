"""Prove /api/providers reflects per-request BYOK headers safely.

The endpoint used to report only server-side configuration, so a phone with
saved keys still saw "Needs a key" for every paid engine. This test pins the
fix: headers make the response say active, only the providers whose header was
sent change, the global PROVIDERS list is never mutated, and the key itself is
never echoed back.
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# This test is about BYOK only: make sure no server-side keys exist.
for name in (
    "GEMINI_API_KEY",
    "HF_TOKEN",
    "HUGGINGFACE_TOKEN",
    "REPLICATE_API_TOKEN",
    "FROGPAPER_ACCESS_KEY",
):
    os.environ.pop(name, None)

import app as flask_app  # noqa: E402
import services.image_generation as ig  # noqa: E402

client = flask_app.app.test_client()


def statuses(response):
    return {
        provider["id"]: (provider["status"], provider.get("key_source"))
        for provider in response.json["providers"]
    }


# 1. No headers: paid engines are inactive (server has no keys).
response = client.get("/api/providers")
assert response.status_code == 200, response.status_code
baseline = statuses(response)
for provider_id in ("gemini", "huggingface", "replicate"):
    assert baseline[provider_id][0] == "inactive", (provider_id, baseline[provider_id])

# 2. All three headers: each engine is active and marked as using a user key.
response = client.get(
    "/api/providers",
    headers={
        "X-Gemini-Key": "AQ.test-gemini",
        "X-Hf-Token": "hf_test",
        "X-Replicate-Token": "r8_test",
    },
)
assert response.status_code == 200, response.status_code
with_keys = statuses(response)
for provider_id in ("gemini", "huggingface", "replicate"):
    assert with_keys[provider_id] == ("active", "user"), (
        provider_id,
        with_keys[provider_id],
    )

# 3. Only the provider whose header is sent changes.
response = client.get(
    "/api/providers",
    headers={"X-Gemini-Key": "AQ.test-gemini"},
)
partial = statuses(response)
assert partial["gemini"] == ("active", "user"), partial["gemini"]
assert partial["huggingface"][0] == "inactive", partial["huggingface"]
assert partial["replicate"][0] == "inactive", partial["replicate"]

# 4. The shared PROVIDERS list must not retain one caller's key state.
global_status = {provider["id"]: provider["status"] for provider in ig.PROVIDERS}
assert global_status["gemini"] == "inactive", global_status

# 5. Never echo the key back.
body = response.get_data(as_text=True)
for secret in ("AQ.test-gemini", "hf_test", "r8_test"):
    assert secret not in body, "response leaked a BYOK credential"

print("PASS: /api/providers reports BYOK status per request without leaking keys")
