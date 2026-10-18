#!/usr/bin/env python3
"""Cross-install isolation for gallery metadata, prompt history, and delete.

The app ships a shared access key, so the device id is the privacy boundary.
These checks pin the routes that used to ignore it:

  * /api/gallery and /api/gallery/<name> only expose this install's pictures
  * /api/prompts/recent never merges another install's prompt text
  * DELETE refuses an image owned by another install (and leaves it on disk)
  * /api/health counts images without building the full gallery payload

    python tests/test_multiuser_isolation.py
"""
import io
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import app  # noqa: E402

PASS, FAIL = [], []
MINE = "dev_aaaaaaaaaaaaaaaaaaaaaaaa"
THEIRS = "dev_bbbbbbbbbbbbbbbbbbbbbbbb"
NAME_MINE = "isolation_mine.png"
NAME_THEIRS = "isolation_theirs.png"
PROMPT_MINE = "my private frog prompt"
PROMPT_THEIRS = "their private frog prompt"


def check(name, condition, extra=""):
    (PASS if condition else FAIL).append(name)
    print(f"  {'PASS' if condition else 'FAIL'}  {name} {extra}")


def write_image(directory, name, prompt, device):
    with io.open(directory / name, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    app.IMAGE_STORAGE.write_sidecar(
        name, {"prompt": prompt, "device": device}
    )


def main():
    key = app.read_access_key() or ""
    access = {"X-Access-Key": key} if key else {}
    client = app.app.test_client()

    directory = BACKEND / "static" / "images"
    directory.mkdir(parents=True, exist_ok=True)
    write_image(directory, NAME_MINE, PROMPT_MINE, MINE)
    write_image(directory, NAME_THEIRS, PROMPT_THEIRS, THEIRS)

    mine_headers = {**access, "X-Device-Id": MINE}
    theirs_headers = {**access, "X-Device-Id": THEIRS}

    print("[1] gallery lists are per install")
    mine = client.get("/api/gallery", headers=mine_headers).get_json()
    theirs = client.get("/api/gallery", headers=theirs_headers).get_json()
    mine_names = [item.get("filename") for item in mine.get("images", [])]
    theirs_names = [item.get("filename") for item in theirs.get("images", [])]
    check("my list has my image", NAME_MINE in mine_names, str(mine_names))
    check("my list hides their image", NAME_THEIRS not in mine_names, str(mine_names))
    check("their list has their image", NAME_THEIRS in theirs_names, str(theirs_names))
    check("their list hides my image", NAME_MINE not in theirs_names, str(theirs_names))

    print("[2] gallery detail is per install")
    check(
        "I can read my metadata",
        client.get(f"/api/gallery/{NAME_MINE}", headers=mine_headers).status_code
        == 200,
    )
    check(
        "I cannot read their metadata",
        client.get(f"/api/gallery/{NAME_THEIRS}", headers=mine_headers).status_code
        == 404,
    )

    print("[3] prompt history is per install")
    mine_prompts = client.get(
        "/api/prompts/recent?limit=50", headers=mine_headers
    ).get_json().get("prompts", [])
    theirs_prompts = client.get(
        "/api/prompts/recent?limit=50", headers=theirs_headers
    ).get_json().get("prompts", [])
    mine_text = [item.get("prompt") for item in mine_prompts]
    theirs_text = [item.get("prompt") for item in theirs_prompts]
    check("my prompt is in my history", PROMPT_MINE in mine_text, str(mine_text))
    check("their prompt is not in my history", PROMPT_THEIRS not in mine_text, str(mine_text))
    check("their prompt is in their history", PROMPT_THEIRS in theirs_text, str(theirs_text))
    check("my prompt is not in their history", PROMPT_MINE not in theirs_text, str(theirs_text))
    anonymous = client.get("/api/prompts/recent?limit=50").get_json().get("prompts", [])
    check("no device id -> no prompt history", anonymous == [], str(anonymous))

    print("[4] delete is per install")
    blocked = client.delete(f"/api/gallery/{NAME_THEIRS}", headers=mine_headers)
    check("another install cannot delete my image", blocked.status_code == 404, str(blocked.status_code))
    check("the blocked image is still on disk", (directory / NAME_THEIRS).is_file())
    allowed = client.delete(f"/api/gallery/{NAME_MINE}", headers=mine_headers)
    check("I can delete my own image", allowed.status_code == 200, str(allowed.status_code))
    check("my image is gone", not (directory / NAME_MINE).is_file())

    print("[5] health counts without building the gallery payload")
    reads = {"sidecars": 0}
    original_read_sidecar = app.IMAGE_STORAGE.read_sidecar

    def counting_read_sidecar(name):
        reads["sidecars"] += 1
        return original_read_sidecar(name)

    app.IMAGE_STORAGE.read_sidecar = counting_read_sidecar
    health = client.get("/api/health").get_json()
    app.IMAGE_STORAGE.read_sidecar = original_read_sidecar
    check("health returns a numeric count", isinstance(health.get("images_count"), int), str(health.get("images_count")))
    check("health still reports storage", "storage" in health)
    check("health reads no sidecars", reads["sidecars"] == 0, str(reads["sidecars"]))

    for name in (NAME_MINE, NAME_THEIRS):
        for leftover in (directory / name, directory / Path(name).with_suffix(".json")):
            try:
                os.remove(leftover)
            except OSError:
                pass

    print(f"RESULT: {len(PASS)} PASS / {len(FAIL)} FAIL")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
