#!/usr/bin/env python3
"""Prompt redaction from server logs (P0-4.3).

The backend's `Generate request` log line used to write the first 60 chars of
every prompt to the Render logs. After this change it logs only a short
non-reversible fingerprint: ``len:<N>:<sha256-prefix-8>``. The fingerprint
is enough to correlate the request with the downstream `Generated <name>`
line and to spot "the same prompt twice", but it is not the prompt text.

This exercises:
  1. `_prompt_fingerprint()` returns the documented shape and is stable.
  2. Two different prompts produce two different fingerprints.
  3. The same prompt always produces the same fingerprint.
  4. The empty/short prompt path returns ``len:0:`` and never throws.
  5. The fingerprint is NOT the prompt text, and a long prompt's text does
     not appear in the fingerprint at all.
  6. The actual log line written by `/api/generate` carries the fingerprint,
     not the prompt text. (Captured by a logging handler in the test.)

    python tests/test_prompt_redaction.py
"""

import io
import json
import logging
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import app  # noqa: E402

PASS, FAIL = [], []


def check(name, condition, extra=""):
    (PASS if condition else FAIL).append(name)
    print(f"  {'PASS' if condition else 'FAIL'}  {name} {extra}")


def main():
    print("[1] _prompt_fingerprint shape and stability")
    test_prompt = "a frog on a lily pad"
    fp = app._prompt_fingerprint(test_prompt)
    check(
        "a fingerprint has the len:N:prefix shape",
        isinstance(fp, str)
        and fp.startswith(f"len:{len(test_prompt)}:")
        and len(fp.split(":")[2]) == 8,
        fp,
    )
    check(
        "the same prompt gives the same fingerprint",
        app._prompt_fingerprint(test_prompt) == fp,
        fp,
    )

    print("[2] fingerprint is not the prompt text")
    long_prompt = "x" * 400 + " unique-marker-do-not-log-me " + "y" * 100
    fp_long = app._prompt_fingerprint(long_prompt)
    check(
        "the fingerprint does not contain the prompt text",
        "unique-marker-do-not-log-me" not in fp_long and "x" * 10 not in fp_long,
        fp_long,
    )
    check(
        "the fingerprint reports the correct length",
        fp_long.startswith(f"len:{len(long_prompt)}:"),
        fp_long,
    )

    print("[3] different prompts produce different fingerprints")
    fp_a = app._prompt_fingerprint("a frog on a lily pad")
    fp_b = app._prompt_fingerprint("a toad on a riverbank")
    check("two different prompts give different fingerprints", fp_a != fp_b, f"{fp_a} vs {fp_b}")

    # A near-miss: same length, different content, must still differ.
    fp_c = app._prompt_fingerprint("a frog on a lily pae")
    check(
        "a single-character change produces a different fingerprint",
        fp_a != fp_c,
        f"{fp_a} vs {fp_c}",
    )

    print("[4] edge cases never throw")
    check(
        "an empty prompt yields len:0:",
        app._prompt_fingerprint("") == "len:0:",
        app._prompt_fingerprint(""),
    )
    check(
        "a None prompt yields len:0: (defensive)",
        app._prompt_fingerprint(None) == "len:0:",
        app._prompt_fingerprint(None),
    )
    check(
        "a one-character prompt has the len:1: prefix",
        app._prompt_fingerprint("z").startswith("len:1:"),
        app._prompt_fingerprint("z"),
    )
    # Unicode should not crash the encoder.
    fp_uni = app._prompt_fingerprint("frog \U0001f438 on a lily pad")
    check(
        "a unicode prompt is hashed without raising",
        isinstance(fp_uni, str) and fp_uni.startswith("len:"),
        fp_uni,
    )

    print("[5] the actual /api/generate log line carries the fingerprint, not the text")
    # Capture log records emitted by the root logger.
    records: list = []

    class _CaptureHandler(logging.Handler):
        def emit(self, record):
            records.append(record)

    handler = _CaptureHandler(level=logging.INFO)
    root = logging.getLogger()
    saved_level = root.level
    saved_handlers = list(root.handlers)
    root.setLevel(logging.INFO)
    root.handlers[:] = [handler]
    try:
        client = app.app.test_client()
        prompt_text = "do-not-log-this-prompt-text-please-7c9f"
        response = client.post(
            "/api/generate",
            data=json.dumps({"prompt": prompt_text, "width": 256, "height": 256}),
            content_type="application/json",
        )
        # We don't care whether the request succeeded - we only care about
        # what the log line wrote. It may have been refused for provider
        # reasons, that's fine.
        _ = response.status_code
    finally:
        root.handlers[:] = saved_handlers
        root.setLevel(saved_level)

    # Find any Generate-request log line.
    generate_records = [
        r for r in records if "Generate request" in (r.getMessage() or "")
    ]
    check(
        "at least one Generate request log line was emitted",
        len(generate_records) >= 1,
        f"{len(generate_records)} records",
    )
    if generate_records:
        body = generate_records[-1].getMessage()
        check(
            "the prompt text does NOT appear in the log line",
            prompt_text not in body and "do-not-log-this" not in body,
            body,
        )
        check(
            "the fingerprint shape DOES appear in the log line",
            "len:" in body and app._prompt_fingerprint(prompt_text) in body,
            body,
        )

    print(f"\nRESULT: {len(PASS)} PASS / {len(FAIL)} FAIL / 0 SKIPPED")
    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
