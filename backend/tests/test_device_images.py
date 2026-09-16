#!/usr/bin/env python3
"""Only the install that made a picture can collect it.

The app's key is shared (it ships inside the app), so it stops strangers but not a
curious friend using the same app. Each picture therefore records the install that
asked for it, and every read path refuses anything else.

    python tests/test_device_images.py
"""

import io
import json
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
NAME = "device_test_owner.png"


def check(name, condition, extra=""):
    (PASS if condition else FAIL).append(name)
    print(f"  {'PASS' if condition else 'FAIL'}  {name} {extra}")


def main():
    key = app.read_access_key() or ""
    headers = {"X-Access-Key": key} if key else {}
    client = app.app.test_client()

    directory = BACKEND / "static" / "images"
    directory.mkdir(parents=True, exist_ok=True)
    image = directory / NAME
    with io.open(image, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    app.IMAGE_STORAGE.write_sidecar(NAME, {"prompt": "a test frog", "device": MINE})

    print("[1] the install that made it can fetch it")
    ok = client.get(f"/api/images/{NAME}?device={MINE}", headers=headers)
    check("its own install gets 200", ok.status_code == 200, str(ok.status_code))

    print("[2] nobody else can")
    other = client.get(f"/api/images/{NAME}?device={THEIRS}", headers=headers)
    check("another install gets 404", other.status_code == 404, str(other.status_code))
    none = client.get(f"/api/images/{NAME}", headers=headers)
    check("a request with no id gets 404", none.status_code == 404, str(none.status_code))
    header_way = client.get(f"/api/images/{NAME}", headers={**headers, "X-Device-Id": MINE})
    check("the header form works too", header_way.status_code == 200, str(header_way.status_code))

    print("[3] the gallery list is per install")
    mine = client.get(f"/api/gallery?device={MINE}", headers=headers).get_json()
    check("my list includes my picture", any(i.get("filename") == NAME for i in mine.get("images", [])))
    theirs = client.get(f"/api/gallery?device={THEIRS}", headers=headers).get_json()
    check("their list does not", not any(i.get("filename") == NAME for i in theirs.get("images", [])))
    anonymous = client.get("/api/gallery", headers=headers).get_json()
    check("a list with no id is empty", anonymous.get("images") == [], str(len(anonymous.get("images", []))))

    print("[4] the metadata route is guarded too")
    detail_other = client.get(f"/api/gallery/{NAME}?device={THEIRS}", headers=headers)
    check("another install cannot read its metadata", detail_other.status_code == 404, str(detail_other.status_code))

    print("[5] recording the owner")
    app.IMAGE_STORAGE.write_sidecar(NAME, {"prompt": "keep me"})
    app._remember_device(NAME, MINE)
    sidecar = app.IMAGE_STORAGE.read_sidecar(NAME) or {}
    check("the prompt is not clobbered", sidecar.get("prompt") == "keep me", json.dumps(sidecar)[:80])
    check("the owner is recorded", sidecar.get("device") == MINE, str(sidecar.get("device")))
    app._remember_device(NAME, "")
    check("an empty id changes nothing", (app.IMAGE_STORAGE.read_sidecar(NAME) or {}).get("device") == MINE)

    print("[6] ids are validated")
    with app.app.test_request_context("/?device=" + "x" * 100):
        check("an oversized id is refused", app._request_device_id() == "")
    with app.app.test_request_context("/?device=bad id!"):
        check("junk is refused", app._request_device_id() == "")
    with app.app.test_request_context(f"/?device={MINE}"):
        check("a proper id passes", app._request_device_id() == MINE)

    print("[7] an unowned image is not claimable")
    plain = directory / "device_test_unowned.png"
    with io.open(plain, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    app.IMAGE_STORAGE.write_sidecar(plain.name, {"prompt": "older than the rule"})
    check("an image with no owner is refused", app._owns_image(plain.name, MINE) is False)

    for leftover in (image, plain):
        try:
            os.remove(leftover)
        except OSError:
            pass
    for suffix in (".json",):
        for leftover in (NAME + suffix, plain.name + suffix):
            try:
                os.remove(directory / leftover)
            except OSError:
                pass
    print("   (test files cleaned up)")

    print(f"RESULT: {len(PASS)} PASS / {len(FAIL)} FAIL / 0 SKIPPED")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
