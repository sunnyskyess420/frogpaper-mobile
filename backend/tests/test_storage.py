"""Storage layer tests (v1.9.20): local disk, path traversal, app routes, S3.

Run from anywhere:
    python backend/tests/test_storage.py

Sections [1]-[4] need no network and no credentials. Section [5] drives the
S3 backend against a fake S3 from `moto` (a test-only dependency - install it
in a throwaway venv, never in the repo); when moto is missing that section is
skipped with a clear message instead of silently passing.

Nothing here touches the real gallery: every section works inside its own
temp directory.
"""
import base64
import io
import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Isolate the app under test from anything the developer has configured.
for _name in (
    "FROGPAPER_S3_BUCKET", "AWS_S3_BUCKET",
    "FROGPAPER_S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID",
    "FROGPAPER_S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY",
    "FROGPAPER_S3_ENDPOINT", "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3",
    "FROGPAPER_S3_REGION", "AWS_REGION", "AWS_DEFAULT_REGION",
    "FROGPAPER_S3_PREFIX",
):
    os.environ.pop(_name, None)

from services import storage as st  # noqa: E402
from services.storage import LocalFileStorage, create_storage  # noqa: E402

PASS, FAIL, SKIP = [], [], []

# A real (tiny) PNG so uploads pass the "is this actually an image" check.
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")


def _raises(exc_type, func, *args, **kwargs):
    """True when func(...) raises exc_type (and nothing else)."""
    try:
        func(*args, **kwargs)
    except exc_type:
        return True
    except Exception:  # noqa: BLE001 - a different error is still a failure
        return False
    return False


def temp_root():
    return Path(tempfile.mkdtemp(prefix="frogpaper_storage_"))


print("[1] local storage: write / list / read / delete / sidecar")
root = temp_root()
store = LocalFileStorage(root)
check("describe() names the directory", str(root) in store.describe(), store.describe())
check("local_root is the directory", store.local_root == root.resolve())
check("verify() passes on a writable dir", store.verify() == store.describe())
check("empty gallery lists nothing", store.list_images() == [])

store.write_image("pollinations_20260101-000000.png", PNG_1X1)
store.write_sidecar(
    "pollinations_20260101-000000.png",
    {"prompt": "a frog on a lilypad", "seed": 42, "provider": "pollinations"},
)
check("exists() after write", store.exists("pollinations_20260101-000000.png") is True)
check("exists() for a missing file", store.exists("nope.png") is False)
check("read_image round-trips", store.read_image("pollinations_20260101-000000.png") == PNG_1X1)
check(
    "read_sidecar round-trips",
    store.read_sidecar("pollinations_20260101-000000.png")
    == {"prompt": "a frog on a lilypad", "seed": 42, "provider": "pollinations"},
)
check("sidecar sits next to the image", (root / "pollinations_20260101-000000.json").is_file())

entries = store.list_images()
check("list has one image (sidecar not listed)", len(entries) == 1, f"got {len(entries)}")
entry = entries[0]
check("entry filename", entry["filename"] == "pollinations_20260101-000000.png")
check("entry url", entry["url"] == "/api/images/pollinations_20260101-000000.png")
check("entry source", entry["source"] == "generated")
check("entry dimensions from the PNG header", (entry["width"], entry["height"]) == (1, 1))
check("entry size_bytes", entry["size_bytes"] == len(PNG_1X1))
check("entry created_at is iso-8601", entry["created_at"][:2] == "20" and "T" in entry["created_at"])
check("entry carries sidecar metadata", entry["prompt"] == "a frog on a lilypad" and entry["seed"] == 42)

# newest first: add a second, newer image (touch the mtime into the future)
store.write_image("uploaded_20300101-000000.jpg", b"jpeg-bytes")
future = 2000000000  # 2033-05-18
os.utime(store.local_root / "uploaded_20300101-000000.jpg", (future, future))
entries = store.list_images()
check("newest first", [e["filename"] for e in entries][0] == "uploaded_20300101-000000.jpg",
      str([e["filename"] for e in entries]))
check("uploaded_ prefix -> source=uploaded", entries[0]["source"] == "uploaded")
store.write_image("random_pic.png", PNG_1X1)
check("unknown prefix -> source=imported",
      store.find_image("random_pic.png")["source"] == "imported")

check("find_image returns None for a missing image", store.find_image("gone.png") is None)
check("find_image ignores non-image extensions", store.find_image("pollinations_20260101-000000.json") is None)
check("recent_prompts reads sidecars", [p["prompt"] for p in store.recent_prompts()] == ["a frog on a lilypad"])

check("delete_image returns True", store.delete_image("pollinations_20260101-000000.png") is True)
check("image gone after delete", store.exists("pollinations_20260101-000000.png") is False)
check("sidecar gone with the image", not (root / "pollinations_20260101-000000.json").exists())
check("delete_image returns False for a missing image", store.delete_image("gone.png") is False)
check("read_image raises for a missing image", _raises(FileNotFoundError, store.read_image, "gone.png"))

print("[2] path traversal is rejected everywhere")
# The gallery lives inside its own parent so "did anything escape?" is a
# precise question (the shared temp dir is far too busy to compare).
parent = temp_root()
root2 = parent / "gallery"
root2.mkdir()
store2 = LocalFileStorage(root2)
before = set(p.name for p in parent.iterdir())
evil_names = ["../escaped.png", "..", ".", "nested/escaped.png", "nested\\escaped.png",
              "/etc/passwd", "C:\\Windows\\win.ini", "..\\..\\escaped.png", "a\x00b.png"]
results = []
for name in evil_names:
    results.append(store2.exists(name) is False)
    results.append(store2.delete_image(name) is False)
    results.append(store2.find_image(name) is None)
    results.append(_raises(FileNotFoundError, store2.read_image, name))
    results.append(_raises(ValueError, store2.write_image, name, PNG_1X1))
check("every traversal attempt refused", all(results), f"{results.count(False)} of {len(results)} allowed")
check("write_image rejects '..'", _raises(ValueError, store2.write_image, "..", b"x"))
check("clean_name strips directories", st.clean_name("../../evil.png") == "evil.png")
check("clean_name rejects '..'", st.clean_name("..") is None)
check("nothing was created outside the gallery", set(p.name for p in parent.iterdir()) == before)
check("gallery dir still empty", list(store2.local_root.iterdir()) == [])

print("[3] staging + publish")
root3 = temp_root()
store3 = LocalFileStorage(root3)
with store3.staging() as staging:
    check("local staging IS the gallery dir", Path(staging) == store3.local_root)
    staged = Path(staging) / "gemini_20260101-000000.png"
    staged.write_bytes(PNG_1X1)
    staged.with_suffix(".json").write_text('{"prompt": "staged frog", "seed": 7}', encoding="utf-8")
    published = store3.publish_from(staging, staged.name)
check("publish keeps the name when it is free", published == "gemini_20260101-000000.png")
check("published image readable", store3.read_image(published) == PNG_1X1)
check("published sidecar carried over", store3.read_sidecar(published)["seed"] == 7)

# Same name again, this time staged in a separate folder (the S3 code path
# regardless of backend): the gallery must not lose the first image.
staging_dir = temp_root()
(staging_dir / "gemini_20260101-000000.png").write_bytes(PNG_1X1)
(staging_dir / "gemini_20260101-000000.json").write_text('{"prompt": "second frog"}', encoding="utf-8")
renamed = store3.publish_from(staging_dir, "gemini_20260101-000000.png")
check("collision renamed instead of overwritten", renamed == "gemini_20260101-000000-1.png", renamed)
check("second sidecar written under the new name", store3.read_sidecar(renamed)["prompt"] == "second frog")
check("both images still in the gallery", len(store3.list_images()) == 2)
check("publish_from rejects an unknown staged file",
      _raises(FileNotFoundError, store3.publish_from, staging_dir, "nope.png"))
check("publish_from refuses a traversal name",
      _raises(FileNotFoundError, store3.publish_from, staging_dir, "../evil.png"))

print("[4] backend selection + the Flask routes")
check("no S3 vars -> local storage", isinstance(create_storage(Path(tempfile.mkdtemp())), LocalFileStorage))
os.environ["FROGPAPER_S3_BUCKET"] = "some-bucket"
selected = create_storage(Path(tempfile.mkdtemp()))
check("bucket without credentials stays local", isinstance(selected, LocalFileStorage))
os.environ["FROGPAPER_S3_ACCESS_KEY_ID"] = "test-key-id"
os.environ["FROGPAPER_S3_SECRET_ACCESS_KEY"] = "test-secret"
selected = create_storage(Path(tempfile.mkdtemp()))
check("bucket + credentials -> S3", isinstance(selected, st.S3Storage),
      type(selected).__name__)
check("S3 keeps serving through the backend (no local_root)",
      selected.local_root is None and "bucket" in selected.describe())
for _name in ("FROGPAPER_S3_BUCKET", "FROGPAPER_S3_ACCESS_KEY_ID", "FROGPAPER_S3_SECRET_ACCESS_KEY"):
    os.environ.pop(_name, None)

# The app reads its storage config at import time, so set it up first.
app_root = temp_root()
ACCESS_KEY = "storage-test-key-1234567890"
os.environ["FROGPAPER_IMAGES_DIR"] = str(app_root)
os.environ["FROGPAPER_ACCESS_KEY"] = ACCESS_KEY

import app as flask_app  # noqa: E402

client = flask_app.app.test_client()
headers = {"X-Access-Key": ACCESS_KEY}

check("app picked up FROGPAPER_IMAGES_DIR",
      flask_app.IMAGE_STORAGE.local_root == app_root.resolve(),
      str(flask_app.IMAGE_STORAGE.describe()))
check("26 MB request cap preserved", flask_app.app.config["MAX_CONTENT_LENGTH"] == 26 * 1024 * 1024)

resp = client.get("/api/health")
check("/api/health 200 without a key", resp.status_code == 200, str(resp.status_code))
check("health reports the storage mode", "storage" in (resp.json or {}))
check("health counts an empty gallery", resp.json.get("images_count") == 0)

check("/api/gallery 401 without a key", client.get("/api/gallery").status_code == 401)
resp = client.get("/api/gallery", headers=headers)
check("/api/gallery 200 with the header", resp.status_code == 200, str(resp.status_code))
check("gallery shape unchanged",
      sorted(resp.json.keys()) == ["count", "images", "offset", "success", "total"],
      str(sorted(resp.json.keys())))
check("gallery is empty to start", resp.json["total"] == 0 and resp.json["count"] == 0)

check("upload rejects a non-image", client.post(
    "/api/gallery/upload",
    data={"file": (io.BytesIO(b"not an image"), "notes.txt")},
    headers=headers, content_type="multipart/form-data",
).status_code == 400)

resp = client.post(
    "/api/gallery/upload",
    data={"file": (io.BytesIO(PNG_1X1), "my-frog.png")},
    headers=headers,
    content_type="multipart/form-data",
)
check("upload 201", resp.status_code == 201, str(resp.status_code))
uploaded = (resp.json or {}).get("image", {})
uploaded_name = uploaded.get("filename")
check("uploaded name is prefixed", str(uploaded_name).startswith("uploaded_"), str(uploaded_name))
check("uploaded metadata is the usual shape",
      {"filename", "url", "source", "width", "height", "size_bytes", "created_at"} <= set(uploaded),
      str(sorted(uploaded.keys())))
check("uploaded source", uploaded.get("source") == "uploaded")
check("upload wrote a sidecar in the gallery dir",
      (app_root / Path(uploaded_name).with_suffix(".json").name).is_file())

resp = client.get("/api/gallery", headers=headers)
check("gallery count grew to 1", resp.json["total"] == 1, str(resp.json["total"]))
check("gallery entry carries original_name", resp.json["images"][0].get("original_name") == "my-frog.png")

resp = client.get(f"/api/images/{uploaded_name}")
check("/api/images 401 without a key", resp.status_code == 401, str(resp.status_code))
resp = client.get(f"/api/images/{uploaded_name}?key={ACCESS_KEY}")
check("/api/images 200 with ?key=", resp.status_code == 200, str(resp.status_code))
check("/api/images bytes match", resp.data == PNG_1X1)
check("/api/images cache header", resp.headers.get("Cache-Control") == "public, max-age=86400",
      str(resp.headers.get("Cache-Control")))
# Windows: an open send_from_directory handle blocks the later DELETE, so
# release the response before moving on (POSIX would not care).
resp.close()
resp = client.get(f"/api/images/{uploaded_name}", headers=headers)
check("/api/images 200 with the header too", resp.status_code == 200)
resp.close()
check("/api/images 404 for a missing file",
      client.get("/api/images/not-here.png", headers=headers).status_code == 404)
check("/api/images traversal is 404",
      client.get("/api/images/..%2F..%2Fapp.py", headers=headers).status_code == 404)

check("/api/prompts/recent 200", client.get("/api/prompts/recent", headers=headers).status_code == 200)
check("/api/gallery/<name> 200", client.get(f"/api/gallery/{uploaded_name}", headers=headers).status_code == 200)
check("/api/gallery/<name> 404 for a missing image",
      client.get("/api/gallery/nope.png", headers=headers).status_code == 404)

resp = client.delete(f"/api/gallery/{uploaded_name}", headers=headers)
check("delete 200", resp.status_code == 200, str(resp.status_code))
check("delete reports the new count", resp.json.get("images_count") == 0, str(resp.json.get("images_count")))
check("delete removed the sidecar", not (app_root / Path(uploaded_name).with_suffix(".json").name).exists())
check("delete again -> 404", client.delete(f"/api/gallery/{uploaded_name}", headers=headers).status_code == 404)
check("gallery back to empty", client.get("/api/gallery", headers=headers).json["total"] == 0)

# The old directory-based helpers must still agree with the storage layer.
from services import image_generation as ig  # noqa: E402

ig_root = temp_root()
(LocalFileStorage(ig_root)).write_image("pollinations_20260101-000000.png", PNG_1X1)
check("image_generation.list_gallery_images still works",
      ig.list_gallery_images(ig_root)[0]["filename"] == "pollinations_20260101-000000.png")
check("...and matches LocalFileStorage.list_images",
      ig.list_gallery_images(ig_root) == LocalFileStorage(ig_root).list_images())
check("image_generation.find_gallery_image still works",
      ig.find_gallery_image(ig_root, "pollinations_20260101-000000.png")["width"] == 1)
check("find_gallery_image rejects traversal",
      ig.find_gallery_image(ig_root, "../app.py") is None)

print("[5] S3 backend against a fake S3 (moto)")
try:
    import boto3
    from moto import mock_aws
except ImportError:
    boto3 = None
    mock_aws = None
    SKIP.append("S3 backend (moto is not installed)")
    print("   SKIPPED - install moto in a throwaway venv: pip install moto")

if mock_aws is not None:
    bucket = "frogpaper-test-bucket"
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=bucket)
        # No custom endpoint here: moto intercepts botocore's default S3
        # endpoint, but a custom one goes out to the real network. The
        # endpoint variable itself is covered in section [4].
        s3 = st.S3Storage(
            bucket,
            access_key_id="test-key-id",
            secret_access_key="test-secret",
            region="us-east-1",
            prefix="wallpapers",
        )
        check("describe() names bucket and prefix",
              bucket in s3.describe() and "wallpapers" in s3.describe(), s3.describe())
        check("verify() finds the bucket", s3.verify() == s3.describe())
        check("no local filesystem behind it", s3.local_root is None)
        check("empty bucket lists nothing", s3.list_images() == [])
        check("S3 rejects traversal", s3.exists("../x.png") is False
              and s3.find_image("../../app.py") is None)

        s3.write_image("pollinations_20260101-000000.png", PNG_1X1)
        s3.write_sidecar("pollinations_20260101-000000.png",
                         {"prompt": "frog in a bucket", "seed": 5, "provider": "pollinations"})
        check("S3 exists()", s3.exists("pollinations_20260101-000000.png") is True)
        check("S3 read_image round-trips",
              s3.read_image("pollinations_20260101-000000.png") == PNG_1X1)
        check("S3 sidecar round-trips",
              s3.read_sidecar("pollinations_20260101-000000.png")["seed"] == 5)
        objects = [o["Key"] for o in
                   boto3.client("s3", region_name="us-east-1").list_objects_v2(
                       Bucket=bucket)["Contents"]]
        check("objects live under the prefix",
              sorted(objects) == ["wallpapers/pollinations_20260101-000000.json",
                                  "wallpapers/pollinations_20260101-000000.png"], str(objects))

        entries = s3.list_images()
        check("S3 entry shape matches local",
              sorted(entries[0].keys()) == ["created_at", "filename", "height", "prompt",
                                            "provider", "seed", "size_bytes", "source",
                                            "url", "width"],
              str(sorted(entries[0].keys())))
        check("S3 entry filename drops the prefix",
              entries[0]["filename"] == "pollinations_20260101-000000.png")
        check("S3 dimensions read via a range request",
              (entries[0]["width"], entries[0]["height"]) == (1, 1))
        check("S3 size_bytes", entries[0]["size_bytes"] == len(PNG_1X1))
        check("S3 source", entries[0]["source"] == "generated")

        streamed = s3.open_stream("pollinations_20260101-000000.png")
        check("S3 stream content", streamed.stream.read() == PNG_1X1)
        check("S3 stream mimetype from the object",
              streamed.mimetype == "image/png", streamed.mimetype)
        check("S3 open_stream raises for a missing object",
              _raises(FileNotFoundError, s3.open_stream, "gone.png"))

        # generation path: temp staging -> bucket
        with s3.staging() as staging:
            check("S3 staging is a local temp dir", Path(staging) != s3.local_root
                  and Path(staging).is_dir())
            staged = Path(staging) / "gemini_20260101-000000.png"
            staged.write_bytes(PNG_1X1)
            staged.with_suffix(".json").write_text('{"prompt": "staged in s3"}', encoding="utf-8")
            staging_path = Path(staging)
            published = s3.publish_from(staging, staged.name)
        check("S3 publish keeps the name", published == "gemini_20260101-000000.png", published)
        check("S3 published image is in the bucket", s3.read_image(published) == PNG_1X1)
        check("S3 published sidecar is in the bucket",
              s3.read_sidecar(published)["prompt"] == "staged in s3")
        check("staging dir cleaned up", not staging_path.exists())
        check("bucket now lists two images", len(s3.list_images()) == 2)

        # collision: same timestamped name published twice
        again = temp_root()
        (again / "gemini_20260101-000000.png").write_bytes(PNG_1X1)
        renamed = s3.publish_from(again, "gemini_20260101-000000.png")
        check("S3 collision renamed", renamed == "gemini_20260101-000000-1.png", renamed)
        check("S3 kept the first image", len(s3.list_images()) == 3)

        check("S3 delete returns True", s3.delete_image("pollinations_20260101-000000.png") is True)
        check("S3 image gone", s3.exists("pollinations_20260101-000000.png") is False)
        check("S3 sidecar deleted with the image",
              s3.read_sidecar("pollinations_20260101-000000.png") == {})
        check("S3 delete returns False for a missing image",
              s3.delete_image("gone.png") is False)
        check("S3 read_image raises for a missing image",
              _raises(FileNotFoundError, s3.read_image, "gone.png"))
        check("S3 newest-first ordering",
              [e["filename"] for e in s3.list_images()]
              == ["gemini_20260101-000000-1.png", "gemini_20260101-000000.png"],
              str([e["filename"] for e in s3.list_images()]))

print("[6] the real app routes through S3 (bucket stays private)")
if mock_aws is None:
    SKIP.append("app-over-S3 (moto is not installed)")
    print("   SKIPPED - moto is not installed")
else:
    with mock_aws():
        route_bucket = "frogpaper-routes-bucket"
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=route_bucket)
        s3_store = st.S3Storage(
            route_bucket,
            access_key_id="test-key-id",
            secret_access_key="test-secret",
            region="us-east-1",
        )
        previous_storage = flask_app.IMAGE_STORAGE
        flask_app.IMAGE_STORAGE = s3_store
        try:
            s3_client = flask_app.app.test_client()
            resp = s3_client.get("/api/health")
            check("health reports S3", route_bucket in (resp.json or {}).get("storage", ""),
                  str((resp.json or {}).get("storage")))

            resp = s3_client.post(
                "/api/gallery/upload",
                data={"file": (io.BytesIO(PNG_1X1), "in-the-bucket.png")},
                headers=headers,
                content_type="multipart/form-data",
            )
            check("upload 201 through S3", resp.status_code == 201, str(resp.status_code))
            s3_name = (resp.json or {}).get("image", {}).get("filename")
            check("uploaded object is in the bucket", s3_store.exists(s3_name) is True, str(s3_name))
            check("uploaded sidecar is in the bucket",
                  s3_store.read_sidecar(s3_name) == {"original_name": "in-the-bucket.png"},
                  str(s3_store.read_sidecar(s3_name)))
            check("nothing was written to the local gallery dir",
                  list(app_root.iterdir()) == [], str(list(app_root.iterdir())))

            resp = s3_client.get("/api/gallery", headers=headers)
            check("gallery lists the bucket object", resp.json["total"] == 1 and
                  resp.json["images"][0]["filename"] == s3_name, str(resp.json))
            check("gallery url stays on the backend",
                  resp.json["images"][0]["url"] == f"/api/images/{s3_name}")

            resp = s3_client.get(f"/api/images/{s3_name}")
            check("/api/images 401 without a key (S3)", resp.status_code == 401)
            resp = s3_client.get(f"/api/images/{s3_name}?key={ACCESS_KEY}")
            check("/api/images streams from S3 with ?key=", resp.status_code == 200,
                  str(resp.status_code))
            check("streamed bytes match", resp.data == PNG_1X1)
            check("streamed mimetype from the object",
                  resp.headers.get("Content-Type") == "image/png",
                  str(resp.headers.get("Content-Type")))
            check("streamed cache header",
                  resp.headers.get("Cache-Control") == "public, max-age=86400",
                  str(resp.headers.get("Cache-Control")))
            check("streamed Content-Length is set",
                  resp.headers.get("Content-Length") == str(len(PNG_1X1)),
                  str(resp.headers.get("Content-Length")))
            resp.close()
            resp = s3_client.get(f"/api/images/{s3_name}", headers=headers)
            check("stream tolerates a Range request",
                  s3_client.get(f"/api/images/{s3_name}", headers={**headers, "Range": "bytes=0-9"}
                                ).status_code == 200)
            resp.close()

            resp = s3_client.delete(f"/api/gallery/{s3_name}", headers=headers)
            check("delete 200 through S3", resp.status_code == 200, str(resp.status_code))
            check("delete emptied the bucket", s3_store.list_images() == [])
            check("sidecar left the bucket too", s3_store.read_sidecar(s3_name) == {})
        finally:
            flask_app.IMAGE_STORAGE = previous_storage

print()
print(f"RESULT: {len(PASS)} PASS / {len(FAIL)} FAIL / {len(SKIP)} SKIPPED")
for name in FAIL:
    print(f"  failed: {name}")
for name in SKIP:
    print(f"  skipped: {name}")
sys.exit(1 if FAIL else 0)
