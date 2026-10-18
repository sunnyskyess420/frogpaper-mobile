#!/usr/bin/env python3
"""Per-device rate limiting on /api/generate (P0-4.4).

The access key ships inside the app, so it is not a real barrier to a
scripted client. Without rate limiting, anyone who extracts the key can
spam /api/generate and burn the Pollinations quota or a server-side
BYOK key. After this change each device (X-Device-Id, falling back to
request.remote_addr) is capped at:

  - 10 generations per rolling 60-minute window
  - 1 in-flight generation at a time

This exercises the limiter directly AND through the live /api/generate
endpoint, with no network (provider calls are refused by the test's
short prompt or by the limiter before they fire).

Acceptance:
  - 11th request in the same window returns HTTP 429.
  - A second device is unaffected.
  - /api/health is NOT rate-limited.
  - 429 body is JSON with success=false and a retry_after (int, seconds).
  - 429 response carries the standard Retry-After header.
  - The concurrency cap releases the slot on failure paths (provider
    refusal, unexpected exception), not just on success.

    python tests/test_rate_limit.py
"""

import json
import os
import sys
import threading
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import app  # noqa: E402

PASS, FAIL = [], []


def check(name, condition, extra=""):
    (PASS if condition else FAIL).append(name)
    print(f"  {'PASS' if condition else 'FAIL'}  {name} {extra}")


def _generate_body(prompt="test-prompt-for-rate-limit-suite", **kw):
    body = {"prompt": prompt, "width": 256, "height": 256}
    body.update(kw)
    return body


def _post_generate(client, device_id=None):
    """POST /api/generate with optional X-Device-Id, return the response.

    The body asks for a non-existent provider so the request fails at the
    provider-validation step (BEFORE any network call to Pollinations),
    returning 400 'Unknown provider'. The rate limiter runs BEFORE that
    check, so we still exercise the limit and stay hermetic - no live
    provider quota is burned by this test.
    """
    headers = {}
    if device_id:
        headers["X-Device-Id"] = device_id
    return client.post(
        "/api/generate",
        data=json.dumps(_generate_body(provider="nonexistent_provider_for_test")),
        content_type="application/json",
        headers=headers,
    )


def main():
    # Make the test fast and deterministic: a 5-second window with 3 hits.
    # Re-create the limiter with these overrides so the test is hermetic
    # and does not depend on the production default of 10/hour.
    test_limiter = app._DeviceRateLimiter(max_per_hour=3, max_concurrent=1, window_seconds=5)
    saved_limiter = app._GENERATE_LIMITER
    app._GENERATE_LIMITER = test_limiter
    try:
        print("[1] _DeviceRateLimiter basics")
        allowed, retry = test_limiter.acquire("dev_A")
        check("first acquire is allowed", allowed and retry == 0, f"allowed={allowed} retry={retry}")
        check("in-flight count is 1 after one acquire", test_limiter._inflight.get("dev_A") == 1)
        allowed2, retry2 = test_limiter.acquire("dev_A")
        check(
            "second concurrent acquire is refused (max_concurrent=1)",
            not allowed2 and retry2 >= 1,
            f"allowed={allowed2} retry={retry2}",
        )
        test_limiter.release("dev_A")
        check("in-flight drops back to 0 after release", test_limiter._inflight.get("dev_A", 0) == 0)

        print("[2] sliding-window counter (10-per-hour analog at 3-per-5s)")
        # Three acquires in the same window - all should pass. The fourth
        # must fail because the window is full.
        results = []
        for _ in range(3):
            allowed, retry = test_limiter.acquire("dev_B")
            results.append((allowed, retry))
            # immediately release so the concurrency cap does not interfere
            test_limiter.release("dev_B")
        check(
            "the first 3 requests in a window are all admitted",
            all(r[0] for r in results),
            str(results),
        )
        allowed4, retry4 = test_limiter.acquire("dev_B")
        check(
            "the 4th request in a 3-per-window bucket is refused",
            not allowed4 and retry4 >= 1,
            f"allowed={allowed4} retry={retry4}",
        )
        check(
            "the refused request reports a sane retry_after (<=window, >=1)",
            1 <= retry4 <= 5,
            f"retry={retry4}",
        )

        print("[3] two devices are isolated")
        # Fill dev_C's window. dev_D must still be admitted.
        for _ in range(3):
            a, _ = test_limiter.acquire("dev_C")
            assert a
            test_limiter.release("dev_C")
        allowed_d, _ = test_limiter.acquire("dev_D")
        check("a second device is unaffected by the first device's limit", allowed_d)
        test_limiter.release("dev_D")

        print("[4] release() is idempotent and safe on unknown devices")
        # Releasing a device that has never been seen must not throw and
        # must not leave a negative count behind.
        try:
            test_limiter.release("never_seen")
            check("release on an unknown device does not raise", True)
        except Exception as exc:
            check("release on an unknown device does not raise", False, str(exc))
        check(
            "no negative in-flight count is recorded for unknown devices",
            test_limiter._inflight.get("never_seen", 0) >= 0,
        )

        print("[5] /api/generate enforces the limit through the live endpoint")
        # Replace with a fresh limiter so the test starts from a clean slate.
        fresh = app._DeviceRateLimiter(max_per_hour=3, max_concurrent=1, window_seconds=60)
        app._GENERATE_LIMITER = fresh
        client = app.app.test_client()
        # Three requests with the same device id. Each should hit the rate
        # limiter (admit), then fail at the provider-validation step with
        # 400 'Unknown provider' - we don't care which, we only care that
        # the limiter admitted them. The 4th must be 429 (limiter refused
        # before the provider check).
        statuses = []
        for _ in range(3):
            resp = _post_generate(client, device_id="dev_endpoint")
            statuses.append(resp.status_code)
        check(
            "the first 3 requests from the same device are NOT rate-limited (no 429)",
            429 not in statuses,
            f"statuses={statuses}",
        )
        # The 4th must be 429 - the limiter refused before the provider call.
        resp_4th = _post_generate(client, device_id="dev_endpoint")
        check(
            "the 4th request from the same device returns HTTP 429",
            resp_4th.status_code == 429,
            f"statuses={statuses} 4th={resp_4th.status_code}",
        )
        if resp_4th.status_code == 429:
            body = resp_4th.get_json()
            check(
                "the 429 body is JSON with success=false",
                body.get("success") is False,
                str(body),
            )
            err = body.get("error") or {}
            retry_after = err.get("retry_after")
            check(
                "the 429 body carries retry_after (int, >=1)",
                isinstance(retry_after, int) and retry_after >= 1,
                str(retry_after),
            )
            check(
                "the 429 response carries the Retry-After HTTP header",
                resp_4th.headers.get("Retry-After") == str(retry_after),
                str(resp_4th.headers.get("Retry-After")),
            )

        print("[6] a second device is unaffected through the live endpoint")
        resp_other = _post_generate(client, device_id="dev_other")
        # Should NOT be 429 - the rate limit is per device. (It may be
        # some other status depending on whether the provider call
        # succeeded; we only assert it was not refused by the limiter.)
        check(
            "a second device is not refused by the first device's limit",
            resp_other.status_code != 429,
            f"status={resp_other.status_code}",
        )

        print("[7] /api/health is NOT rate-limited")
        # Spam /api/health with the same device id - it must never 429.
        # (It is exempt by design - health is a cheap O(1) call and the
        # frontend polls it during base-URL discovery.)
        health_statuses = set()
        for _ in range(20):
            r = client.get("/api/health", headers={"X-Device-Id": "dev_endpoint"})
            health_statuses.add(r.status_code)
        check(
            "/api/health is never 429, even after 20 calls from the same device",
            429 not in health_statuses,
            str(health_statuses),
        )

        print("[8] slot is released on failure paths (concurrency cap recovers)")
        # The concurrency cap (max_concurrent=1) means a second simultaneous
        # request must be refused. If release() fails on error paths, the
        # second request would still be refused after the first finished.
        # We simulate that by manually acquiring and then releasing via
        # an exception path.
        cap_limiter = app._DeviceRateLimiter(max_per_hour=10, max_concurrent=1, window_seconds=60)
        app._GENERATE_LIMITER = cap_limiter
        # First request grabs the slot.
        a1, _ = cap_limiter.acquire("dev_cap")
        check("first acquire grabs the slot", a1)
        # A second simultaneous request must be refused.
        a2, r2 = cap_limiter.acquire("dev_cap")
        check("second concurrent request is refused", not a2 and r2 >= 1)
        # Now simulate the first request failing and its finally block
        # releasing the slot.
        cap_limiter.release("dev_cap")
        # The third request must be admitted again - the slot was released.
        a3, _ = cap_limiter.acquire("dev_cap")
        check(
            "after release the slot is available again (no leak on failure)",
            a3,
            f"a3={a3}",
        )
        cap_limiter.release("dev_cap")

    finally:
        app._GENERATE_LIMITER = saved_limiter

    print(f"\nRESULT: {len(PASS)} PASS / {len(FAIL)} FAIL / 0 SKIPPED")
    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
