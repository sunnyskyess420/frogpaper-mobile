"""
Pluggable image storage for the FrogPaper backend
=================================================

Wallpapers used to live only in ``backend/static/images`` on the container's
local disk, so every Render deploy / restart / free-tier spin-down wiped the
gallery. This module puts every gallery read and write behind one small
interface and ships two backends:

* ``LocalFileStorage`` - the historical behaviour, unchanged. This is the
  default (nothing to configure), so local development works exactly as
  before. It also honours ``FROGPAPER_IMAGES_DIR``, which is how a Render
  persistent disk is pointed at the gallery without any code change.
* ``S3Storage`` - any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO).
  Selected automatically once the S3 environment variables are present.

Routes no longer touch the filesystem themselves: they call
``list_images`` / ``read_image`` / ``write_image`` / ``delete_image`` /
``exists`` / ``open_stream`` on the object returned by ``create_storage()``.
Image bytes keep being served *through* the backend at
``/api/images/<filename>`` - the bucket is never made public and the
access-key gate keeps applying.

Sidecars
--------
Generation metadata (prompt, seed, provider, ...) is still stored *next to*
the image as ``<name>.json``. Both backends keep that layout, the metadata
travels with the image into the bucket, and ``delete_image`` removes the
sidecar together with the image.

See docs/STORAGE.md for the operational side (Render disk, R2 setup).
"""

from __future__ import annotations

import io
import json
import logging
import os
import shutil
import tempfile
from abc import ABC, abstractmethod
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import BinaryIO, Iterator, Optional

log = logging.getLogger("frogpaper.storage")

try:  # optional: only used to read image dimensions for /api/gallery
    from PIL import Image
except ImportError:  # pragma: no cover - Pillow is in requirements.txt
    Image = None


VALID_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
SIDECAR_SUFFIX = ".json"

MIMETYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".json": "application/json",
}

GENERATED_PREFIXES = ("pollinations_", "gemini_", "huggingface_", "replicate_")

# Only the first chunk of an image is fetched to read its header. PIL needs a
# few KB at most, and on S3 this turns a full image download into one small
# range request per image (memoised below, so /api/gallery stays cheap).
DIMENSION_HEADER_BYTES = 512 * 1024

# --- environment variables -------------------------------------------------
#
# FROGPAPER_IMAGES_DIR   local gallery directory (mode 2: a Render disk)
# FROGPAPER_S3_BUCKET    bucket name       -> with credentials, mode 3 (S3/R2)
# FROGPAPER_S3_ENDPOINT  custom endpoint (R2/MinIO); omit for AWS S3
# FROGPAPER_S3_ACCESS_KEY_ID / FROGPAPER_S3_SECRET_ACCESS_KEY
# FROGPAPER_S3_REGION    "auto" for R2 (the default when an endpoint is set)
# FROGPAPER_S3_PREFIX    optional key prefix inside the bucket
#
# The standard AWS_* names work as fallbacks so an AWS-configured box only
# has to add the bucket name.
ENV_IMAGES_DIR = "FROGPAPER_IMAGES_DIR"
S3_ENV_ALIASES = {
    "bucket": ("FROGPAPER_S3_BUCKET", "AWS_S3_BUCKET"),
    "endpoint": ("FROGPAPER_S3_ENDPOINT", "AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL"),
    "access_key_id": ("FROGPAPER_S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
    "secret_access_key": ("FROGPAPER_S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    "region": ("FROGPAPER_S3_REGION", "AWS_REGION", "AWS_DEFAULT_REGION"),
    "prefix": ("FROGPAPER_S3_PREFIX",),
}


class StorageError(Exception):
    """Raised when the configured storage backend cannot be used."""


def _env(*names: str) -> Optional[str]:
    """First non-empty environment variable out of ``names``."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def mimetype_for(name: str) -> str:
    return MIMETYPES.get(Path(str(name)).suffix.lower(), "application/octet-stream")


def source_for(name: str) -> str:
    """Same three buckets the gallery always reported."""
    if name.startswith(GENERATED_PREFIXES):
        return "generated"
    if name.startswith("uploaded_"):
        return "uploaded"
    return "imported"


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _clean_etag(value) -> Optional[str]:
    """S3 hands out ETags already quoted ('"abc"'); Flask wants them bare.

    werkzeug's set_etag raises ValueError on a pre-quoted value, so a quoted
    ETag from the bucket would turn every image request into a 500.
    """
    if not value:
        return None
    etag = str(value).strip()
    if etag.startswith("W/"):
        etag = etag[2:]
    etag = etag.strip().strip('"')
    if not etag or '"' in etag:
        return None
    return etag


def _iso(moment: datetime) -> str:
    return _as_utc(moment).isoformat()


def _is_unsafe_name(name: str) -> bool:
    """True when a client-supplied name must never reach a path or S3 key.

    This is the single path-traversal guard: it rejects empty names, ``.`` /
    ``..``, anything with a separator (either flavour), NUL bytes, and
    Windows drive/absolute forms. Backends add a second check of their own.
    """
    if not name or name in {".", ".."} or "\x00" in name:
        return True
    if "/" in name or "\\" in name:
        return True
    if Path(name).name != name:
        return True
    windows = PureWindowsPath(name)
    if windows.drive or windows.is_absolute():
        return True
    return False


def clean_name(filename) -> Optional[str]:
    """Return the safe bare name, or None when it must be rejected.

    Used by the read paths, which mirror the old ``Path(name).name``
    behaviour: a stray directory component in a URL is dropped rather than
    treated as an error (it can never reach outside the gallery anyway).
    """
    name = Path(str(filename or "")).name
    if _is_unsafe_name(name):
        return None
    return name


def strict_name(filename) -> str:
    """Bare name, or ValueError - for the operations that only ever write.

    No legitimate caller hands a directory component to ``write_image`` /
    ``write_sidecar`` (the app uploads and the providers both staged a bare
    filename first), so those reject rather than silently rewrite the name.
    """
    raw = str(filename or "")
    name = Path(raw).name
    if _is_unsafe_name(name) or name != raw:
        raise ValueError(f"Unsafe image name: {filename!r}")
    return name


def _dimensions_from_bytes(data: Optional[bytes]) -> dict:
    if Image is None or not data:
        return {}
    try:
        with Image.open(io.BytesIO(data)) as img:
            return {"width": img.width, "height": img.height}
    except Exception:  # noqa: BLE001 - metadata must never break listing
        return {}


# name -> dimensions, so a gallery poll does not re-read every header.
_DIMENSION_CACHE: dict = {}
_DIMENSION_CACHE_MAX = 1000


@dataclass(frozen=True)
class StoredObject:
    """One stored object (image or sidecar) as reported by a backend listing."""

    name: str
    size_bytes: int
    last_modified: datetime
    etag: Optional[str] = None

    @property
    def created_at(self) -> str:
        return _iso(self.last_modified)


@dataclass
class ImageStream:
    """A readable handle on one stored image (used by /api/images/<name>)."""

    stream: BinaryIO
    size_bytes: int
    mimetype: str
    etag: Optional[str] = None
    last_modified: Optional[datetime] = None


class ImageStorage(ABC):
    """The whole gallery, behind one small interface.

    Subclasses implement the six primitive ``_``-prefixed methods; every
    gallery-level behaviour (listing shape, sidecars, staging/publish) is
    shared here so both backends behave identically.
    """

    #: identifies the backend in the dimension cache (one per gallery)
    cache_scope = "default"

    # ------------------------------------------------------------------
    # Interface used by the routes
    # ------------------------------------------------------------------
    def exists(self, filename) -> bool:
        name = clean_name(filename)
        return bool(name) and self._stat(name) is not None

    def read_image(self, filename) -> bytes:
        """Image bytes; raises FileNotFoundError when absent/rejected."""
        name = clean_name(filename)
        if not name:
            raise FileNotFoundError(f"Unsafe image name: {filename!r}")
        data = self._read(name)
        if data is None:
            raise FileNotFoundError(name)
        return data

    def write_image(self, filename, data: bytes) -> None:
        name = strict_name(filename)
        self._write(name, data, mimetype_for(name))

    def delete_image(self, filename) -> bool:
        """Delete image + sidecar. False when there was nothing to delete."""
        name = clean_name(filename)
        if not name:
            return False
        if not self._remove(name):
            return False
        self._remove(self.sidecar_name(name))  # the sidecar follows the image
        return True

    def list_images(self) -> list:
        """Gallery entries, newest first, in the shape the app expects."""
        entries = []
        for stored in self._list_objects():
            if stored.name.endswith(SIDECAR_SUFFIX):
                continue
            if Path(stored.name).suffix.lower() not in VALID_EXTENSIONS:
                continue
            entries.append(self._entry_for(stored))
        entries.sort(key=lambda item: item["created_at"], reverse=True)
        return entries

    def find_image(self, filename) -> Optional[dict]:
        name = clean_name(filename)
        if not name or Path(name).suffix.lower() not in VALID_EXTENSIONS:
            return None
        stored = self._stat(name)
        if stored is None:
            return None
        return self._entry_for(stored)

    def read_sidecar(self, filename) -> dict:
        name = clean_name(filename)
        if not name:
            return {}
        data = self._read(self.sidecar_name(name))
        if data is None:
            return {}
        try:
            parsed = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:  # noqa: BLE001
            log.warning("Could not read sidecar for %s: %s", name, exc)
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def write_sidecar(self, filename, metadata: dict) -> None:
        name = strict_name(filename)
        payload = json.dumps(metadata, ensure_ascii=False, indent=2).encode("utf-8")
        self._write(self.sidecar_name(name), payload, MIMETYPES[SIDECAR_SUFFIX])

    def recent_prompts(self, limit: int = 12) -> list:
        """Distinct recently-used prompts, newest first (for reuse chips)."""
        seen = set()
        prompts = []
        for entry in self.list_images():
            text = (entry.get("prompt") or "").strip()
            if len(text) < 3 or text in seen:
                continue
            seen.add(text)
            prompts.append(
                {
                    "prompt": text,
                    "negative_prompt": entry.get("negative_prompt"),
                    "used_at": entry.get("created_at"),
                }
            )
            if len(prompts) >= limit:
                break
        return prompts

    def open_stream(self, filename) -> ImageStream:
        """Streaming handle for serving; raises FileNotFoundError."""
        name = clean_name(filename)
        if not name:
            raise FileNotFoundError(f"Unsafe image name: {filename!r}")
        stream = self._open(name)
        if stream is None:
            raise FileNotFoundError(name)
        return stream

    @property
    def local_root(self) -> Optional[Path]:
        """Directory backing this gallery, or None for remote storage.

        ``/api/images`` uses it to keep serving local files through
        ``send_from_directory`` (ETag / 304 / byte ranges for free) exactly
        as before.
        """
        return None

    @staticmethod
    def sidecar_name(filename) -> str:
        """``foo.jpg`` -> ``foo.json`` (same name as before the refactor)."""
        return Path(str(filename)).with_suffix(SIDECAR_SUFFIX).name

    # ------------------------------------------------------------------
    # Staging: providers need a *local* directory to write into
    # ------------------------------------------------------------------
    @contextmanager
    def staging(self) -> Iterator[Path]:
        """Local directory the provider code writes the new image into.

        Local storage hands out the gallery directory itself, so generation
        writes exactly where it always did (no copy, no behaviour change).
        Remote storage hands out a temp dir that ``publish_from`` uploads
        from and that is removed again afterwards.
        """
        gallery = self._gallery_dir()
        if gallery is not None:
            yield gallery
            return
        staging_dir = Path(tempfile.mkdtemp(prefix="frogpaper-staging-"))
        try:
            yield staging_dir
        finally:
            shutil.rmtree(staging_dir, ignore_errors=True)

    def publish_from(self, staging_dir, filename) -> str:
        """Move a freshly written image (+ sidecar) into the gallery.

        Returns the name it is stored under - for remote backends that can
        differ from the staged name when the timestamped name is already
        taken, so callers must use the return value.
        """
        staging = Path(staging_dir)
        name = clean_name(filename)
        source = staging / name if name else None
        if source is None or not source.is_file():
            raise FileNotFoundError(f"Nothing staged at {staging / str(filename)}")
        if self._is_gallery_dir(staging):
            return name  # local: the file is already in place
        stored_name = self._allocate_name(name)
        self._write(stored_name, source.read_bytes(), mimetype_for(stored_name))
        sidecar = source.with_suffix(SIDECAR_SUFFIX)
        if sidecar.is_file():
            try:
                metadata = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                metadata = {}
            if isinstance(metadata, dict) and metadata:
                self.write_sidecar(stored_name, metadata)
        return stored_name

    def _allocate_name(self, name: str) -> str:
        """First free ``name`` / ``stem-1.ext`` / ``stem-2.ext`` / ..."""
        if not self.exists(name):
            return name
        stem, suffix = Path(name).stem, Path(name).suffix
        counter = 1
        while True:
            candidate = f"{stem}-{counter}{suffix}"
            if not self.exists(candidate):
                return candidate
            counter += 1

    # ------------------------------------------------------------------
    # Shared entry building
    # ------------------------------------------------------------------
    def _entry_for(self, stored: StoredObject) -> dict:
        dimensions = self._dimensions_for(stored)
        entry = {
            "filename": stored.name,
            "url": f"/api/images/{stored.name}",
            "source": source_for(stored.name),
            "width": dimensions.get("width"),
            "height": dimensions.get("height"),
            "size_bytes": stored.size_bytes,
            "created_at": stored.created_at,
        }
        # Merge persisted sidecar metadata (prompt, seed, ...) when present.
        entry.update(
            {k: v for k, v in self.read_sidecar(stored.name).items() if v is not None}
        )
        return entry

    def _dimensions_for(self, stored: StoredObject) -> dict:
        if Image is None:
            return {}
        key = (self.cache_scope, stored.name, stored.size_bytes, stored.created_at)
        cached = _DIMENSION_CACHE.get(key)
        if cached is not None:
            return cached
        dimensions = _dimensions_from_bytes(
            self._read(stored.name, limit=DIMENSION_HEADER_BYTES)
        )
        if len(_DIMENSION_CACHE) >= _DIMENSION_CACHE_MAX:
            _DIMENSION_CACHE.clear()
        _DIMENSION_CACHE[key] = dimensions
        return dimensions

    # ------------------------------------------------------------------
    # Backend primitives
    # ------------------------------------------------------------------
    def _gallery_dir(self) -> Optional[Path]:
        """Local dir that can be handed out for staging, if any."""
        return None

    def _is_gallery_dir(self, directory: Path) -> bool:
        return False

    @abstractmethod
    def _list_objects(self) -> list:
        """Every stored object, images and sidecars alike."""

    @abstractmethod
    def _stat(self, name: str) -> Optional[StoredObject]:
        """Metadata for one object, or None when it does not exist."""

    @abstractmethod
    def _read(self, name: str, limit: Optional[int] = None) -> Optional[bytes]:
        """Bytes of one object (at most ``limit`` of them), or None."""

    @abstractmethod
    def _write(self, name: str, data: bytes, content_type: str) -> None:
        """Create or replace one object."""

    @abstractmethod
    def _remove(self, name: str) -> bool:
        """Delete one object; False when it did not exist."""

    @abstractmethod
    def _open(self, name: str) -> Optional[ImageStream]:
        """Open one object for streaming, or None when it does not exist."""

    @abstractmethod
    def describe(self) -> str:
        """Human-readable backend description (logs + /api/health)."""

    def verify(self) -> str:
        """Best-effort startup check; returns describe() when it passes."""
        return self.describe()


# ---------------------------------------------------------------------------
# Mode 1 + 2: local filesystem (default) / FROGPAPER_IMAGES_DIR
# ---------------------------------------------------------------------------
class LocalFileStorage(ImageStorage):
    """Images as plain files in a directory - the original behaviour.

    ``root`` comes from ``FROGPAPER_IMAGES_DIR`` when set, otherwise
    ``backend/static/images``. Pointing that variable at a Render persistent
    disk is all it takes to survive redeploys (see docs/STORAGE.md).
    """

    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.cache_scope = f"local:{self.root}"

    @property
    def local_root(self) -> Optional[Path]:
        return self.root

    def describe(self) -> str:
        return f"local filesystem ({self.root})"

    def verify(self) -> str:
        probe = self.root / "frogpaper-storage-probe.tmp"
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            probe.write_bytes(b"frogpaper storage probe")
            if probe.read_bytes() != b"frogpaper storage probe":
                raise StorageError("Could not read back the probe file.")
        except OSError as exc:
            raise StorageError(f"{self.root} is not writable: {exc}") from exc
        finally:
            try:
                probe.unlink()
            except OSError:
                pass
        return self.describe()

    # -- paths ---------------------------------------------------------
    def _path(self, name: str) -> Optional[Path]:
        """Resolve ``name`` inside the gallery dir, or None if it escapes."""
        if _is_unsafe_name(name):
            return None
        candidate = self.root / name
        try:
            # Belt and braces on top of _is_unsafe_name: a symlink inside the
            # gallery must not be able to reach outside of it.
            if candidate.resolve().parent != self.root:
                return None
        except OSError:  # pragma: no cover - unreadable path
            return None
        return candidate

    def _gallery_dir(self) -> Optional[Path]:
        return self.root

    def _is_gallery_dir(self, directory: Path) -> bool:
        try:
            return Path(directory).resolve() == self.root
        except OSError:  # pragma: no cover
            return False

    # -- primitives ----------------------------------------------------
    def _list_objects(self) -> list:
        try:
            children = list(self.root.iterdir())
        except OSError as exc:
            log.error("Could not list %s: %s", self.root, exc)
            return []
        objects = []
        for path in children:
            if not path.is_file():
                continue
            try:
                stat = path.stat()
            except OSError:  # vanished mid-listing
                continue
            objects.append(
                StoredObject(
                    name=path.name,
                    size_bytes=stat.st_size,
                    last_modified=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
                )
            )
        return objects

    def _stat(self, name: str) -> Optional[StoredObject]:
        path = self._path(name)
        if path is None or not path.is_file():
            return None
        stat = path.stat()
        return StoredObject(
            name=name,
            size_bytes=stat.st_size,
            last_modified=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
        )

    def _read(self, name: str, limit: Optional[int] = None) -> Optional[bytes]:
        path = self._path(name)
        if path is None or not path.is_file():
            return None
        try:
            with path.open("rb") as handle:
                return handle.read() if limit is None else handle.read(limit)
        except OSError as exc:
            log.error("Could not read %s: %s", path, exc)
            return None

    def _write(self, name: str, data: bytes, content_type: str) -> None:
        path = self._path(name)
        if path is None:
            raise ValueError(f"Unsafe image name: {name!r}")
        path.write_bytes(data)

    def _remove(self, name: str) -> bool:
        path = self._path(name)
        if path is None or not path.is_file():
            return False
        path.unlink()
        return True

    def _open(self, name: str) -> Optional[ImageStream]:
        path = self._path(name)
        if path is None or not path.is_file():
            return None
        stat = path.stat()
        return ImageStream(
            stream=path.open("rb"),
            size_bytes=stat.st_size,
            mimetype=mimetype_for(name),
            last_modified=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
        )


# ---------------------------------------------------------------------------
# Mode 3: S3-compatible object storage (Cloudflare R2, AWS S3, MinIO, ...)
# ---------------------------------------------------------------------------
class S3Storage(ImageStorage):
    """Images as objects in a bucket. The bucket stays private.

    Works with R2 and AWS S3 (both S3-compatible): set an endpoint for R2,
    omit it for AWS. Signature V4 is forced because R2 does not support the
    legacy signing scheme.
    """

    def __init__(
        self,
        bucket: str,
        *,
        endpoint: Optional[str] = None,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        region: Optional[str] = None,
        prefix: str = "",
    ):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover - boto3 is in requirements
            raise StorageError(
                "S3 storage needs boto3 - run: pip install -r requirements.txt"
            ) from exc

        self.bucket = bucket
        self.endpoint = endpoint or None
        # R2 wants "auto"; AWS needs a real region when none is given.
        self.region = region or ("auto" if self.endpoint else "us-east-1")
        prefix = (prefix or "").strip().strip("/")
        self.prefix = f"{prefix}/" if prefix else ""
        self.cache_scope = f"s3:{self.bucket}/{self.prefix}"

        self.client = boto3.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=self.region,
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=10,
                read_timeout=60,
            ),
        )

    def describe(self) -> str:
        where = self.endpoint or f"AWS S3 ({self.region})"
        prefix = self.prefix or "(no prefix)"
        return f"S3 bucket '{self.bucket}' prefix '{prefix}' via {where}"

    def verify(self) -> str:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.client.head_bucket(Bucket=self.bucket)
        except (ClientError, BotoCoreError) as exc:
            raise StorageError(f"Cannot reach bucket '{self.bucket}': {exc}") from exc
        return self.describe()

    # -- keys ----------------------------------------------------------
    def _key(self, name: str) -> str:
        return f"{self.prefix}{name}"

    @staticmethod
    def _is_missing(exc) -> bool:
        """True when a ClientError means 'that object is not there'."""
        response = getattr(exc, "response", None) or {}
        code = str((response.get("Error") or {}).get("Code", ""))
        status = (response.get("ResponseMetadata") or {}).get("HTTPStatusCode")
        return code in {"404", "NoSuchKey", "NotFound"} or status == 404

    # -- primitives ----------------------------------------------------
    def _list_objects(self) -> list:
        objects = []
        token = None
        while True:
            kwargs = {"Bucket": self.bucket, "Prefix": self.prefix}
            if token:
                kwargs["ContinuationToken"] = token
            response = self.client.list_objects_v2(**kwargs)
            for item in response.get("Contents", []):
                key = item.get("Key", "")
                if key.endswith("/"):  # folder placeholder
                    continue
                name = key[len(self.prefix):]
                if not name:
                    continue
                objects.append(
                    StoredObject(
                        name=name,
                        size_bytes=int(item.get("Size", 0)),
                        last_modified=item.get("LastModified")
                        or datetime.now(timezone.utc),
                        etag=_clean_etag(item.get("ETag")),
                    )
                )
            if not response.get("IsTruncated"):
                break
            token = response.get("NextContinuationToken")
            if not token:
                break
        return objects

    def _stat(self, name: str) -> Optional[StoredObject]:
        from botocore.exceptions import ClientError

        try:
            head = self.client.head_object(Bucket=self.bucket, Key=self._key(name))
        except ClientError as exc:
            if self._is_missing(exc):
                return None
            raise
        return StoredObject(
            name=name,
            size_bytes=int(head.get("ContentLength", 0)),
            last_modified=head.get("LastModified") or datetime.now(timezone.utc),
            etag=_clean_etag(head.get("ETag")),
        )

    def _read(self, name: str, limit: Optional[int] = None) -> Optional[bytes]:
        from botocore.exceptions import ClientError

        kwargs = {"Bucket": self.bucket, "Key": self._key(name)}
        if limit:
            kwargs["Range"] = f"bytes=0-{limit - 1}"
        try:
            response = self.client.get_object(**kwargs)
        except ClientError as exc:
            if self._is_missing(exc):
                return None
            raise
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()

    def _write(self, name: str, data: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=self._key(name),
            Body=data,
            ContentType=content_type,
        )

    def _remove(self, name: str) -> bool:
        if self._stat(name) is None:
            return False
        self.client.delete_object(Bucket=self.bucket, Key=self._key(name))
        return True

    def _open(self, name: str) -> Optional[ImageStream]:
        from botocore.exceptions import ClientError

        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self._key(name))
        except ClientError as exc:
            if self._is_missing(exc):
                return None
            raise
        return ImageStream(
            stream=response["Body"],
            size_bytes=int(response.get("ContentLength", 0)),
            mimetype=response.get("ContentType") or mimetype_for(name),
            etag=_clean_etag(response.get("ETag")),
            last_modified=response.get("LastModified"),
        )


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------
def create_storage(default_images_dir) -> ImageStorage:
    """Pick a backend from the environment (see docs/STORAGE.md).

    S3 wins when a bucket *and* credentials are present; everything else
    falls back to the local filesystem, which keeps local development
    working with no configuration at all.
    """
    bucket = _env(*S3_ENV_ALIASES["bucket"])
    access_key_id = _env(*S3_ENV_ALIASES["access_key_id"])
    secret_access_key = _env(*S3_ENV_ALIASES["secret_access_key"])

    if bucket and access_key_id and secret_access_key:
        return S3Storage(
            bucket,
            endpoint=_env(*S3_ENV_ALIASES["endpoint"]),
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            region=_env(*S3_ENV_ALIASES["region"]),
            prefix=_env(*S3_ENV_ALIASES["prefix"]) or "",
        )
    if bucket:
        log.warning(
            "S3 bucket '%s' is configured but the credentials are missing "
            "(FROGPAPER_S3_ACCESS_KEY_ID / FROGPAPER_S3_SECRET_ACCESS_KEY) - "
            "staying on the local filesystem.",
            bucket,
        )

    root = _env(ENV_IMAGES_DIR) or str(default_images_dir)
    return LocalFileStorage(root)
