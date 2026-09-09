"""
Image generation service (Pollinations.ai provider).

The service layer is framework-agnostic on purpose: it raises
GenerationError on failure and returns plain dicts, so app.py stays thin.
"""

import io
import logging
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests

try:
    from PIL import Image  # optional: only used for richer metadata
except ImportError:  # pragma: no cover
    Image = None

log = logging.getLogger("frogpaper.generation")

POLLINATIONS_ENDPOINT = "https://image.pollinations.ai/prompt/{prompt}"
DEFAULT_MODEL = "flux"

PROVIDERS = [
    {
        "id": "pollinations",
        "name": "Pollinations.ai",
        "model": DEFAULT_MODEL,
        "status": "active",
        "requires_api_key": False,
        "max_side": 2048,
        "description": "Free text-to-image generation (Flux model), no API key required.",
    }
]

# (connect timeout, read timeout) - first generations can be slow
REQUEST_TIMEOUT = (10, 120)
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0
VALID_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
USER_AGENT = "FrogPaper/1.5 (mobile app backend)"


class GenerationError(Exception):
    """Raised when the provider cannot produce an image."""


def _extension_for(content_type: str) -> str:
    content_type = (content_type or "").split(";")[0].strip().lower()
    if content_type == "image/png":
        return ".png"
    if content_type == "image/webp":
        return ".webp"
    return ".jpg"  # pollinations usually returns jpeg


def _save_image(data: bytes, images_dir: Path, extension: str) -> str:
    """Write bytes to the gallery dir with a unique timestamped filename."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base = f"pollinations_{stamp}"
    candidate = f"{base}{extension}"
    counter = 1
    while (images_dir / candidate).exists():
        candidate = f"{base}-{counter}{extension}"
        counter += 1
    (images_dir / candidate).write_bytes(data)
    return candidate


def _read_dimensions(data: bytes):
    """Best-effort dimensions from image bytes (returns None if PIL missing)."""
    if Image is None:
        return None
    try:
        with Image.open(io.BytesIO(data)) as img:
            return {"width": img.width, "height": img.height}
    except Exception:  # noqa: BLE001 - metadata is best-effort only
        return None


def _dimensions_from_path(path: Path):
    """Header-only dimension read - cheap even for large galleries."""
    if Image is None:
        return {}
    try:
        with Image.open(path) as img:
            return {"width": img.width, "height": img.height}
    except Exception:  # noqa: BLE001
        return {}


_dimension_cache = {}


def generate_image(
    prompt,
    width=1080,
    height=1920,
    seed=None,
    model=DEFAULT_MODEL,
    images_dir=None,
    retries=MAX_RETRIES,
):
    """Call Pollinations.ai and persist the result. Returns image metadata dict."""
    if images_dir is None:
        raise GenerationError("images_dir is required")
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    seed = seed or random.randint(1, 999_999_999)
    url = POLLINATIONS_ENDPOINT.format(prompt=quote(prompt, safe=""))
    params = {
        "width": width,
        "height": height,
        "seed": seed,
        "model": model,
        "nologo": "true",
    }

    last_error = None
    for attempt in range(1, retries + 1):
        try:
            log.info(
                "Pollinations attempt %d/%d (%dx%d, seed=%d)",
                attempt,
                retries,
                width,
                height,
                seed,
            )
            response = requests.get(
                url,
                params=params,
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": USER_AGENT},
            )

            content_type = response.headers.get("Content-Type", "")
            if response.status_code == 200 and content_type.startswith("image/"):
                data = response.content
                if len(data) < 1024:
                    raise GenerationError("Provider returned a suspiciously small payload.")
                extension = _extension_for(content_type)
                filename = _save_image(data, images_dir, extension)
                dimensions = _read_dimensions(data) or {}
                stat = (images_dir / filename).stat()
                return {
                    "filename": filename,
                    "url": f"/api/images/{filename}",
                    "provider": "pollinations",
                    "model": model,
                    "source": "generated",
                    "prompt": prompt,
                    "seed": seed,
                    "width": dimensions.get("width", width),
                    "height": dimensions.get("height", height),
                    "size_bytes": stat.st_size,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }

            last_error = GenerationError(
                f"Provider returned HTTP {response.status_code} "
                f"({content_type or 'unknown content type'})."
            )
        except requests.RequestException as exc:
            last_error = GenerationError(f"Network error talking to the provider: {exc}")
        except GenerationError as exc:
            last_error = exc

        if attempt < retries:
            pause = RETRY_BACKOFF_SECONDS * attempt
            log.warning("Attempt %d failed (%s); retrying in %.1fs", attempt, last_error, pause)
            time.sleep(pause)

    raise last_error


MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


def _entry_for(path: Path):
    """Build gallery metadata for one file (dimension result is cached)."""
    stat = path.stat()
    cache_key = (path.name, stat.st_mtime_ns, stat.st_size)
    dimensions = _dimension_cache.get(cache_key)
    if dimensions is None:
        dimensions = _dimensions_from_path(path)
        _dimension_cache[cache_key] = dimensions
    if path.name.startswith("pollinations_"):
        source = "generated"
    elif path.name.startswith("uploaded_"):
        source = "uploaded"
    else:
        source = "imported"
    return {
        "filename": path.name,
        "url": f"/api/images/{path.name}",
        "source": source,
        "width": dimensions.get("width"),
        "height": dimensions.get("height"),
        "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def find_gallery_image(images_dir, filename):
    """Metadata for one gallery image, or None if it does not exist."""
    safe_name = Path(filename).name
    target = Path(images_dir) / safe_name
    if not target.is_file() or target.suffix.lower() not in VALID_EXTENSIONS:
        return None
    return _entry_for(target)


def list_gallery_images(images_dir):
    """List images in the gallery dir, newest first, with metadata."""
    images_dir = Path(images_dir)
    if not images_dir.exists():
        return []

    entries = []
    for path in images_dir.iterdir():
        if not path.is_file() or path.suffix.lower() not in VALID_EXTENSIONS:
            continue
        entries.append(_entry_for(path))

    entries.sort(key=lambda item: item["created_at"], reverse=True)
    return entries


def save_uploaded_image(data, original_filename, images_dir):
    """Validate and persist a user-uploaded image. Returns metadata dict.

    Raises ValueError with a user-friendly message on bad input.
    """
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    clean_name = Path(str(original_filename or "")).name
    extension = Path(clean_name).suffix.lower()
    if extension not in VALID_EXTENSIONS:
        allowed = ", ".join(sorted(VALID_EXTENSIONS))
        raise ValueError(
            f"Unsupported file type '{extension or '(none)'}'. Allowed: {allowed}."
        )
    if len(data) == 0:
        raise ValueError("The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("The uploaded file is larger than 20 MB.")

    dimensions = {}
    if Image is not None:
        try:
            with Image.open(io.BytesIO(data)) as img:
                img.verify()  # rejects corrupted files / renamed non-images
            with Image.open(io.BytesIO(data)) as img:
                dimensions = {"width": img.width, "height": img.height}
        except Exception as exc:  # noqa: BLE001
            raise ValueError("The file does not contain a valid image.") from exc

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base = f"uploaded_{stamp}"
    candidate = f"{base}{extension}"
    counter = 1
    while (images_dir / candidate).exists():
        candidate = f"{base}-{counter}{extension}"
        counter += 1
    (images_dir / candidate).write_bytes(data)
    stat = (images_dir / candidate).stat()

    return {
        "filename": candidate,
        "url": f"/api/images/{candidate}",
        "source": "uploaded",
        "original_name": clean_name,
        "width": dimensions.get("width"),
        "height": dimensions.get("height"),
        "size_bytes": stat.st_size,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
