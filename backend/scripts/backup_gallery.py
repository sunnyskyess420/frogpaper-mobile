#!/usr/bin/env python3
"""
Back up a running FrogPaper backend's gallery to a local folder
===============================================================

Safety net for the cloud gallery: pull every wallpaper (and the sidecar JSON
that carries its prompt/seed) down to your PC *before* a deploy, a Render
spin-down or an S3 migration. The output folder is a plain mirror of the
gallery directory, so if you ever need it back you can drop the files
straight into backend/static/images/ (or FROGPAPER_IMAGES_DIR) and the
backend will list them again.

Only the standard library and ``requests`` (already a backend dependency)
are used, so it runs without the backend's virtualenv.

Usage
-----
    # local backend, no access key
    python backend/scripts/backup_gallery.py

    # a Render backend, access key from the environment
    FROGPAPER_ACCESS_KEY=... python backend/scripts/backup_gallery.py \
        --url https://frogpaper-backend.onrender.com --out ./gallery_backup

    # see what would happen without writing anything
    python backend/scripts/backup_gallery.py --dry-run

Exit status is 0 only when nothing failed.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote, urljoin

import requests

DEFAULT_URL = "http://127.0.0.1:5000"
DEFAULT_OUT = "./gallery_backup"
PAGE_LIMIT = 200
TIMEOUT = (10, 180)  # (connect, read) - cloud downloads can be slow


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Mirror a running FrogPaper backend's gallery to a local folder.",
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help=f"Backend base URL (default: {DEFAULT_URL})",
    )
    parser.add_argument(
        "--out",
        default=DEFAULT_OUT,
        help=f"Destination folder (default: {DEFAULT_OUT})",
    )
    parser.add_argument(
        "--key",
        default=os.environ.get("FROGPAPER_ACCESS_KEY", "").strip() or None,
        help="Access key (default: the FROGPAPER_ACCESS_KEY environment variable)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be downloaded without writing anything",
    )
    return parser.parse_args(argv)


def human_bytes(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} GB"


def build_session(key):
    session = requests.Session()
    session.headers["User-Agent"] = "FrogPaperBackup/1.0"
    if key:
        # Same header every JSON call uses; image URLs also accept ?key=...
        session.headers["X-Access-Key"] = key
    return session


def fetch_gallery(session, base_url):
    """Every gallery entry, newest first, following the pagination."""
    images = []
    offset = 0
    total = None
    while True:
        response = session.get(
            urljoin(base_url + "/", "api/gallery"),
            params={"limit": PAGE_LIMIT, "offset": offset},
            timeout=TIMEOUT,
        )
        if response.status_code == 401:
            raise RuntimeError(
                "the backend rejected the request (401). Pass the access key "
                "with --key or set FROGPAPER_ACCESS_KEY."
            )
        response.raise_for_status()
        payload = response.json()
        page = payload.get("images") or []
        images.extend(page)
        total = payload.get("total")
        offset += len(page)
        if not page or (total is not None and offset >= total):
            break
    return images


def download(session, url, params, expected_size=None):
    """GET one file; returns bytes, or None when the backend has no such file."""
    response = session.get(url, params=params, timeout=TIMEOUT)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    content = response.content
    if expected_size is not None and len(content) != expected_size:
        raise RuntimeError(
            f"expected {expected_size} bytes, received {len(content)}"
        )
    return content


def target_for(out_dir, filename):
    """Local path for a gallery filename, or None if the name is unsafe."""
    name = Path(str(filename)).name
    if not name or name != filename or name in {".", ".."}:
        return None
    return out_dir / name


def sidecar_name(filename):
    return Path(str(filename)).with_suffix(".json").name


def main(argv=None) -> int:
    args = parse_args(argv)
    base_url = args.url.rstrip("/")
    out_dir = Path(args.out).expanduser().resolve()
    session = build_session(args.key)

    print("FrogPaper gallery backup")
    print(f"  backend : {base_url}")
    print(f"  folder  : {out_dir}")
    print(f"  key     : {'yes' if args.key else 'none'}")
    print(f"  mode    : {'DRY RUN (nothing is written)' if args.dry_run else 'download'}")
    print()

    try:
        images = fetch_gallery(session, base_url)
    except (requests.RequestException, ValueError, RuntimeError) as exc:
        print(f"FAILED to list the gallery: {exc}", file=sys.stderr)
        return 1

    if not images:
        print("The backend reports an empty gallery - nothing to do.")
        return 0

    print(f"Backend has {len(images)} image(s).")
    print()

    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    downloaded = skipped = sidecars = missing_sidecars = 0
    failures = []
    written_bytes = 0

    for entry in images:
        filename = entry.get("filename") or ""
        size = entry.get("size_bytes")
        local = target_for(out_dir, filename)
        if local is None:
            failures.append(f"{filename}: unsafe filename, skipped")
            print(f"  SKIP  {filename}  (unsafe filename)")
            continue

        # --- image -----------------------------------------------------
        already_have_image = (
            local.is_file() and size is not None and local.stat().st_size == size
        )
        if already_have_image:
            skipped += 1
            print(f"  have  {filename}  ({human_bytes(size)})")
        elif args.dry_run:
            downloaded += 1
            print(f"  get   {filename}  (dry run)")
        else:
            params = {"key": args.key} if args.key else None
            try:
                content = download(
                    session,
                    urljoin(base_url + "/", f"api/images/{quote(filename, safe='')}"),
                    params,
                    size,
                )
            except (requests.RequestException, RuntimeError) as exc:
                failures.append(f"{filename}: {exc}")
                print(f"  FAIL  {filename}  ({exc})")
                continue
            if content is None:
                failures.append(f"{filename}: 404 from the backend")
                print(f"  FAIL  {filename}  (404)")
                continue
            local.write_bytes(content)
            downloaded += 1
            written_bytes += len(content)
            print(f"  get   {filename}  ({human_bytes(len(content))})")

        # --- sidecar (prompt/seed metadata) ----------------------------
        sidecar_file = out_dir / sidecar_name(filename)
        if args.dry_run:
            print(f"        + {sidecar_name(filename)}  (dry run)")
            continue
        try:
            content = download(
                session,
                urljoin(
                    base_url + "/",
                    f"api/images/{quote(sidecar_name(filename), safe='')}",
                ),
                {"key": args.key} if args.key else None,
            )
        except requests.RequestException as exc:
            failures.append(f"{sidecar_name(filename)}: {exc}")
            print(f"  FAIL  {sidecar_name(filename)}  ({exc})")
            continue
        if content is None:
            missing_sidecars += 1
            if not sidecar_file.is_file():
                print(f"        - {sidecar_name(filename)}  (none on the server)")
            continue
        if sidecar_file.is_file() and sidecar_file.read_bytes() == content:
            continue
        sidecar_file.write_bytes(content)
        sidecars += 1

    print()
    print("Summary")
    print(f"  images downloaded : {downloaded} ({human_bytes(written_bytes)})")
    print(f"  images skipped    : {skipped} (already present, same size)")
    print(f"  sidecars saved    : {sidecars}")
    if missing_sidecars:
        print(f"  sidecars missing  : {missing_sidecars} (older images have none)")
    print(f"  failures          : {len(failures)}")
    print(f"  folder            : {out_dir}")
    if failures:
        print()
        for failure in failures:
            print(f"  ! {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
