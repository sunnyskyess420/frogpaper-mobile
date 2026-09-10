"""
Image generation service (Pollinations.ai provider).

The service layer is framework-agnostic on purpose: it raises
GenerationError on failure and returns plain dicts, so app.py stays thin.
"""

import base64
import io
import json
import logging
import math
import os
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

# --- Google Gemini ("nano banana" image model) -----------------------------
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"
GEMINI_KEY_FILE = Path(__file__).resolve().parent.parent / "gemini_api_key.txt"
GEMINI_REQUEST_TIMEOUT = (10, 180)

# Aspect ratios Gemini 2.5 Flash Image supports (name, width/height value).
_ASPECT_RATIOS = [
    ("21:9", 21 / 9),
    ("16:9", 16 / 9),
    ("3:2", 3 / 2),
    ("4:3", 4 / 3),
    ("1:1", 1.0),
    ("3:4", 3 / 4),
    ("2:3", 2 / 3),
    ("9:16", 9 / 16),
]


def read_gemini_api_key():
    """Gemini API key from the env var, or backend/gemini_api_key.txt."""
    env_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if env_key:
        return env_key
    try:
        if GEMINI_KEY_FILE.is_file():
            key = GEMINI_KEY_FILE.read_text(encoding="utf-8").strip()
            if key:
                return key
    except OSError:
        pass
    return None


def gemini_configured():
    """True when a Gemini API key is available."""
    return bool(read_gemini_api_key())


def default_provider_id():
    """Best available provider: Gemini when configured, else Pollinations."""
    return "gemini" if gemini_configured() else "pollinations"


def _aspect_ratio_for(width, height):
    """Snap a width/height pair to the nearest ratio Gemini supports."""
    target = math.log(max(width, 1) / max(height, 1))
    return min(_ASPECT_RATIOS, key=lambda item: abs(math.log(item[1]) - target))[0]


PROVIDERS = [
    {
        "id": "gemini",
        "name": "Google Gemini (Nano Banana)",
        "model": GEMINI_IMAGE_MODEL,
        "status": "active" if gemini_configured() else "inactive",
        "requires_api_key": True,
        "max_side": 2048,
        "description": (
            "Google's top image model - sharp, detailed wallpapers. "
            "Free daily generations with an API key, paid after that."
        ),
    },
    {
        "id": "pollinations",
        "name": "Pollinations.ai",
        "model": DEFAULT_MODEL,
        "status": "active",
        "requires_api_key": False,
        "max_side": 2048,
        "description": "Free text-to-image generation (Flux model), no API key required.",
    },
]

# (connect timeout, read timeout) - first generations can be slow
REQUEST_TIMEOUT = (10, 120)
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0
VALID_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
USER_AGENT = "FrogPaper/1.7 (mobile app backend)"
MAX_NEGATIVE_PROMPT_LENGTH = 300


class GenerationError(Exception):
    """Raised when the provider cannot produce an image."""


def _extension_for(content_type: str) -> str:
    content_type = (content_type or "").split(";")[0].strip().lower()
    if content_type == "image/png":
        return ".png"
    if content_type == "image/webp":
        return ".webp"
    return ".jpg"  # pollinations usually returns jpeg


def _sidecar_path(image_path: Path) -> Path:
    """Sidecar metadata file for an image (same name, .json extension)."""
    return image_path.with_suffix(".json")


def _write_sidecar(image_path: Path, extra: dict):
    """Persist generation metadata next to the image (best-effort)."""
    try:
        _sidecar_path(image_path).write_text(
            json.dumps(extra, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:  # noqa: BLE001 - metadata must never break saving
        log.warning("Could not write sidecar for %s: %s", image_path.name, exc)


def _read_sidecar(image_path: Path) -> dict:
    """Load sidecar metadata for an image, or {} when absent/corrupt."""
    sidecar = _sidecar_path(image_path)
    if not sidecar.is_file():
        return {}
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as exc:  # noqa: BLE001
        log.warning("Could not read sidecar for %s: %s", image_path.name, exc)
        return {}


def delete_sidecar(images_dir, filename):
    """Remove the sidecar file for an image, if any (best-effort)."""
    sidecar = _sidecar_path(Path(images_dir) / Path(filename).name)
    try:
        if sidecar.is_file():
            sidecar.unlink()
    except OSError as exc:  # noqa: BLE001
        log.warning("Could not delete sidecar for %s: %s", sidecar.name, exc)


def _save_image(data: bytes, images_dir: Path, extension: str, provider: str = "pollinations") -> str:
    """Write bytes to the gallery dir with a unique timestamped filename."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base = f"{provider}_{stamp}"
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
    negative_prompt=None,
):
    """Call Pollinations.ai and persist the result. Returns image metadata dict."""
    if images_dir is None:
        raise GenerationError("images_dir is required")
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    # Flux has no true negative-prompt parameter; we append it as soft
    # guidance text and document that limitation in the API docs.
    effective_prompt = prompt
    if negative_prompt:
        effective_prompt = f"{prompt}. Avoid: {negative_prompt}."

    seed = seed or random.randint(1, 999_999_999)
    url = POLLINATIONS_ENDPOINT.format(prompt=quote(effective_prompt, safe=""))
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
                saved_path = images_dir / filename
                stat = saved_path.stat()
                _write_sidecar(
                    saved_path,
                    {
                        "provider": "pollinations",
                        "model": model,
                        "prompt": prompt,
                        "negative_prompt": negative_prompt or None,
                        "seed": seed,
                        "requested_width": width,
                        "requested_height": height,
                    },
                )
                return {
                    "filename": filename,
                    "url": f"/api/images/{filename}",
                    "provider": "pollinations",
                    "model": model,
                    "source": "generated",
                    "prompt": prompt,
                    "negative_prompt": negative_prompt or None,
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


def _gemini_image_configs(aspect_ratio):
    """Request configs to try, best first (2K detail -> ratio only -> plain)."""
    return [
        {"imageConfig": {"aspectRatio": aspect_ratio, "imageSize": "2K"}},
        {"imageConfig": {"aspectRatio": aspect_ratio}},
        {},
    ]


def _finish_gemini_image(response, prompt, negative_prompt, seed, model, width, height, images_dir):
    """Parse a successful Gemini response, save the image, return metadata."""
    payload = response.json()
    candidates = payload.get("candidates") or []
    image_bytes = None
    mime_type = ""

    if candidates:
        finish_reason = (candidates[0].get("finishReason") or "").upper()
        parts = ((candidates[0].get("content") or {}).get("parts")) or []
        for part in parts:
            inline = part.get("inlineData") or {}
            if inline.get("data"):
                image_bytes = base64.b64decode(inline["data"])
                mime_type = inline.get("mimeType", "image/png")
                break
        if image_bytes is None and finish_reason in (
            "SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKED",
        ):
            raise GenerationError(
                "Google refused this prompt (safety filter) - try rewording it."
            )
    if image_bytes is None:
        block = ((payload.get("promptFeedback") or {}).get("blockReason")) or ""
        if block:
            raise GenerationError(
                f"Google refused this prompt ({block}) - try rewording it."
            )
        raise GenerationError("Google returned a response without an image.")

    if len(image_bytes) < 1024:
        raise GenerationError("Google returned a suspiciously small image payload.")

    extension = _extension_for(mime_type)
    filename = _save_image(image_bytes, images_dir, extension, provider="gemini")
    dimensions = _read_dimensions(image_bytes) or {}
    saved_path = images_dir / filename
    stat = saved_path.stat()
    _write_sidecar(
        saved_path,
        {
            "provider": "gemini",
            "model": model,
            "prompt": prompt,
            "negative_prompt": negative_prompt or None,
            "seed": seed,
            "requested_width": width,
            "requested_height": height,
            "aspect_ratio": _aspect_ratio_for(width, height),
        },
    )
    return {
        "filename": filename,
        "url": f"/api/images/{filename}",
        "provider": "gemini",
        "model": model,
        "source": "generated",
        "prompt": prompt,
        "negative_prompt": negative_prompt or None,
        "seed": seed,
        "width": dimensions.get("width", width),
        "height": dimensions.get("height", height),
        "size_bytes": stat.st_size,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _gemini_error_for(response):
    """Map a Gemini API error response to a friendly GenerationError."""
    try:
        message = (response.json().get("error") or {}).get("message", "")
    except ValueError:
        message = response.text[:200]
    text = message.lower()
    status = response.status_code

    if status in (400, 401) and ("api key" in text or "api_key" in text):
        return GenerationError(
            "Google rejected the API key - check the key inside "
            "backend/gemini_api_key.txt (it should start with 'AIza')."
        )
    if status == 429 or "resource_exhausted" in text or "quota" in text:
        return GenerationError(
            "Gemini's free daily limit is used up. It resets tomorrow - "
            "or enable billing on your Google project for more."
        )
    if status == 403:
        return GenerationError(
            "Google denied access (403). The key may need billing enabled, "
            "or the image model is not allowed for this key."
        )
    return GenerationError(f"Google returned HTTP {status}: {message[:300]}")


def generate_image_gemini(
    prompt,
    width=1080,
    height=1920,
    seed=None,
    model=GEMINI_IMAGE_MODEL,
    images_dir=None,
    retries=2,
    negative_prompt=None,
):
    """Call Google's Gemini image model and persist the result.

    Returns the same metadata dict shape as generate_image(). Raises
    GenerationError with a user-friendly message on any failure.
    """
    api_key = read_gemini_api_key()
    if not api_key:
        raise GenerationError(
            "No Gemini API key found - save it to backend/gemini_api_key.txt."
        )
    if images_dir is None:
        raise GenerationError("images_dir is required")
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    effective_prompt = prompt
    if negative_prompt:
        effective_prompt = f"{prompt}. Avoid: {negative_prompt}."
    aspect_ratio = _aspect_ratio_for(width, height)
    url = f"{GEMINI_API_BASE}/{model}:generateContent"
    base_body = {"contents": [{"parts": [{"text": effective_prompt}]}]}

    last_error = None
    for attempt in range(1, retries + 1):
        for config in _gemini_image_configs(aspect_ratio):
            body = dict(base_body)
            if config:
                body["generationConfig"] = config
            try:
                log.info(
                    "Gemini attempt %d/%d (%dx%d -> %s, config=%s)",
                    attempt, retries, width, height, aspect_ratio,
                    sorted(config.get("imageConfig", {}).keys()) or "plain",
                )
                response = requests.post(
                    url,
                    json=body,
                    timeout=GEMINI_REQUEST_TIMEOUT,
                    headers={"x-goog-api-key": api_key, "User-Agent": USER_AGENT},
                )
            except requests.RequestException as exc:
                last_error = GenerationError(f"Network error talking to Google: {exc}")
                continue

            if response.status_code == 200:
                try:
                    return _finish_gemini_image(
                        response, prompt, negative_prompt, seed, model,
                        width, height, images_dir,
                    )
                except GenerationError as exc:
                    # A 200 without an image (safety block) won't improve
                    # with a different imageConfig - stop immediately.
                    raise exc

            # Bad imageConfig -> try the next (simpler) config
            text = response.text.lower()
            if response.status_code == 400 and (
                "imageconfig" in text or "image_config" in text
                or "imagesize" in text or "image_size" in text
            ):
                last_error = _gemini_error_for(response)
                continue

            last_error = _gemini_error_for(response)
            break  # real error (key/quota/network-shape) - no config will fix it

        if attempt < retries:
            pause = RETRY_BACKOFF_SECONDS * attempt
            log.warning("Gemini attempt %d failed (%s); retrying", attempt, last_error)
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
    if path.name.startswith(("pollinations_", "gemini_")):
        source = "generated"
    elif path.name.startswith("uploaded_"):
        source = "uploaded"
    else:
        source = "imported"
    entry = {
        "filename": path.name,
        "url": f"/api/images/{path.name}",
        "source": source,
        "width": dimensions.get("width"),
        "height": dimensions.get("height"),
        "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }
    # Merge persisted sidecar metadata (prompt, seed, ...) when present.
    entry.update({k: v for k, v in _read_sidecar(path).items() if v is not None})
    return entry


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


def recent_prompts(images_dir, limit=12):
    """Distinct recently-used prompts, newest first (from sidecar files)."""
    seen = set()
    prompts = []
    for entry in list_gallery_images(images_dir):
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
    saved_path = images_dir / candidate
    _write_sidecar(
        saved_path,
        {"original_name": clean_name},
    )

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
