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
    from PIL import Image, ImageFilter  # optional: metadata + enhancement
except ImportError:  # pragma: no cover
    Image = None
    ImageFilter = None

log = logging.getLogger("frogpaper.generation")

POLLINATIONS_ENDPOINT = "https://image.pollinations.ai/prompt/{prompt}"
DEFAULT_MODEL = "flux"

# Quality boosters appended to every Pollinations prompt. The model reacts
# strongly to style guidance, and wallpapers specifically need vertical
# composition + detail cues to look good on a phone screen.
POLLINATIONS_QUALITY_SUFFIX = (
    ". Breathtaking professional phone wallpaper, one strong clear focal "
    "point, generous negative space, rich saturated colors with cinematic "
    "color grading, dramatic atmospheric lighting, sense of depth and "
    "scale, intricate detail, masterpiece quality, 8k, clean edges "
    "suitable for a phone home screen"
)

# Subject-aware boosters. Flux renders animals inconsistently from bare
# prompts ("frog" alone is a coin flip), so popular subjects get anatomy
# and photography cues that measurably raise the hit rate.
_SUBJECT_ENHANCERS = {
    "frog": (
        "cute tree frog with big glossy eyes, smooth vivid green skin, "
        "perched on a wet leaf, professional wildlife macro photography, "
        "correct anatomy"
    ),
    "toad": (
        "cute toad with big golden eyes and detailed skin, professional "
        "wildlife macro photography, correct anatomy"
    ),
}
_GENERIC_ANIMAL_WORDS = (
    "cat", "kitten", "dog", "puppy", "fox", "owl", "wolf", "deer",
    "horse", "bird", "tiger", "lion", "panda", "rabbit", "bunny",
    "whale", "turtle", "fish", "koi", "dragon", "axolotl",
)


def _subject_enhancer(prompt: str) -> str:
    """Extra subject-specific phrases for prompts featuring known subjects."""
    text = f" {prompt.lower()} "
    for word, phrase in _SUBJECT_ENHANCERS.items():
        if f" {word}" in text or f"{word}s " in text:
            return f", {phrase}"
    if any(f" {word}" in text or f"{word}s " in text for word in _GENERIC_ANIMAL_WORDS):
        return (
            ", adorable healthy animal with expressive eyes and correct "
            "anatomy, professional wildlife photography"
        )
    return ""

# --- Google Gemini ("nano banana" image model) -----------------------------
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"
# Google retires image model names now and then (the 2.0 preview image
# model and even gemini-2.5-flash-image-preview were gone by Sept 2026),
# so instead of guessing names the backend ASKS Google which image
# models this key can actually see (ListModels) and works through that
# list. This static chain is only the fallback used when the model
# listing cannot be fetched - it holds the names verified live on
# 2026-09-10 (each answered 429 quota, i.e. they exist, unlike the
# retired names that answer 404).
GEMINI_IMAGE_MODEL_FALLBACKS = ["gemini-3-pro-image", "gemini-3-pro-image-preview"]
GEMINI_KEY_FILE = Path(__file__).resolve().parent.parent / "gemini_api_key.txt"
GEMINI_REQUEST_TIMEOUT = (10, 180)
GEMINI_LIST_TIMEOUT = (10, 30)
GEMINI_MODEL_CACHE_TTL = 600

# Discovered image-model names, cached for GEMINI_MODEL_CACHE_TTL seconds
# so each wallpaper generation does not re-list every time.
_GEMINI_MODEL_CACHE = {"at": 0.0, "models": None}

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


# --- Hugging Face Inference (full-quality FLUX.1 models) -------------------
HF_ROUTER_URL = "https://router.huggingface.co/hf-inference/models/{model}"
# Best model first; schnell is the automatic fallback when dev is gated or
# unavailable. (num_inference_steps differs per model.)
HF_IMAGE_MODELS = [
    ("black-forest-labs/FLUX.1-dev", 28),
    ("black-forest-labs/FLUX.1-schnell", 4),
]
HF_TOKEN_FILE = Path(__file__).resolve().parent.parent / "huggingface_token.txt"
HF_REQUEST_TIMEOUT = (10, 180)
# FLUX renders on grids of 32 pixels. We request the biggest canvas that fits
# this budget and let _enhance_resolution upscale to the exact requested size.
HF_MAX_CANVAS_SIDE = 1280


# --- Replicate (paid FLUX renders, ~$0.003-0.025 per picture) -------------
REPLICATE_API_BASE = "https://api.replicate.com/v1"
# Best value first: FLUX.1-dev is the same engine the frog tests loved
# (~$0.025 per picture); schnell is the ultra-cheap automatic fallback
# (~$0.003 per picture).
REPLICATE_IMAGE_MODELS = [
    "black-forest-labs/flux-dev",
    "black-forest-labs/flux-schnell",
]
REPLICATE_TOKEN_FILE = (
    Path(__file__).resolve().parent.parent / "replicate_api_token.txt"
)
REPLICATE_REQUEST_TIMEOUT = (10, 60)
REPLICATE_DOWNLOAD_TIMEOUT = (10, 120)
REPLICATE_POLL_INTERVAL = 2.0
REPLICATE_POLL_LIMIT = 75  # ~150 s max wait for a finished render
# Aspect ratios FLUX models accept on Replicate (no 21:9 on flux-dev).
_REPLICATE_RATIOS = [
    ("16:9", 16 / 9),
    ("3:2", 3 / 2),
    ("4:3", 4 / 3),
    ("1:1", 1.0),
    ("3:4", 3 / 4),
    ("2:3", 2 / 3),
    ("9:16", 9 / 16),
]


def read_replicate_api_token():
    """Replicate token from env vars, or backend/replicate_api_token.txt."""
    for env_name in ("REPLICATE_API_TOKEN", "REPLICATE_TOKEN"):
        env_key = (os.environ.get(env_name) or "").strip()
        if env_key:
            return env_key
    try:
        if REPLICATE_TOKEN_FILE.is_file():
            token = REPLICATE_TOKEN_FILE.read_text(encoding="utf-8").strip()
            if token:
                return token
    except OSError:
        pass
    return None


def replicate_configured():
    """True when a Replicate API token is available."""
    return bool(read_replicate_api_token())


def read_huggingface_token():
    """Hugging Face token from env vars, or backend/huggingface_token.txt."""
    for env_name in ("HF_TOKEN", "HUGGINGFACE_TOKEN"):
        env_key = (os.environ.get(env_name) or "").strip()
        if env_key:
            return env_key
    try:
        if HF_TOKEN_FILE.is_file():
            token = HF_TOKEN_FILE.read_text(encoding="utf-8").strip()
            if token:
                return token
    except OSError:
        pass
    return None


def huggingface_configured():
    """True when a Hugging Face token is available."""
    return bool(read_huggingface_token())


def default_provider_id():
    """Best available provider: paid Replicate first, then HF/Gemini."""
    if replicate_configured():
        return "replicate"
    if huggingface_configured():
        return "huggingface"
    if gemini_configured():
        return "gemini"
    return "pollinations"


def refresh_provider_statuses():
    """Re-evaluate key-file-dependent provider statuses (in place).

    PROVIDERS is built once at import time; if the user adds or removes a
    key file while the backend is running, the status flags would go stale
    and /api/generate would reject a now-configured provider. Called before
    every provider-listing / generation request.
    """
    for provider in PROVIDERS:
        if provider["id"] == "replicate":
            provider["status"] = (
                "active" if replicate_configured() else "inactive"
            )
        elif provider["id"] == "gemini":
            provider["status"] = "active" if gemini_configured() else "inactive"
        elif provider["id"] == "huggingface":
            provider["status"] = (
                "active" if huggingface_configured() else "inactive"
            )


def _aspect_ratio_for(width, height):
    """Snap a width/height pair to the nearest ratio Gemini supports."""
    target = math.log(max(width, 1) / max(height, 1))
    return min(_ASPECT_RATIOS, key=lambda item: abs(math.log(item[1]) - target))[0]


PROVIDERS = [
    {
        "id": "replicate",
        "name": "Replicate FLUX (paid)",
        "model": "black-forest-labs/flux-dev",
        "status": "active" if replicate_configured() else "inactive",
        "requires_api_key": True,
        "max_side": 2048,
        "description": (
            "The full-quality FLUX.1 engine via your paid Replicate account "
            "(about 2.5 cents per wallpaper). The same engine that drew the "
            "good frogs - no watermarks, your $5 credit lasts ~200 pictures."
        ),
    },
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
        "id": "huggingface",
        "name": "Hugging Face FLUX",
        "model": "black-forest-labs/FLUX.1-dev",
        "status": "active" if huggingface_configured() else "inactive",
        "requires_api_key": True,
        "max_side": 2048,
        "description": (
            "The full-quality FLUX.1 image model via Hugging Face - richer "
            "light and detail than the free tier. Uses free monthly credits "
            "with your own access token (hf_...)."
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


def _enhance_resolution(data: bytes, width: int, height: int):
    """Upscale + sharpen when the provider returns less than requested.

    The free Pollinations tier caps every image at 576x1024 no matter what
    size is requested (verified 2026-09: flux and turbo both capped), so a
    phone stretches that tiny image across a 1080p+ screen and everything
    looks blurry. A Lanczos upscale with a mild unsharp mask brings it to
    full wallpaper size with far better perceived detail.

    Returns {"data", "extension", "upscaled_from"} or None when no
    enhancement is needed (provider honored the size, or PIL is missing).
    Enhancement must never break saving, so any failure returns None.
    """
    if Image is None or ImageFilter is None:
        return None
    try:
        with Image.open(io.BytesIO(data)) as img:
            ret_w, ret_h = img.size
            if ret_w >= width and ret_h >= height:
                return None  # provider delivered full size - leave untouched
            img = img.convert("RGB")
            # Pollinations stamps a "pollinations.ai" badge in the top-right
            # and bottom-right corners of anonymous-tier images even with
            # nologo=true (verified 2026-09). Trim those margins before
            # upscaling - the cover-scale below restores the exact requested
            # size, so the crop costs nothing in final resolution.
            img = img.crop(
                (0, int(ret_h * 0.07), ret_w, ret_h - int(ret_h * 0.065))
            )
            ret_w, ret_h = img.size
            # Cover-scale so both dimensions reach the request, then
            # center-crop to exactly width x height (no distortion, no
            # letterboxing - matches how Android fits wallpapers).
            factor = max(width / ret_w, height / ret_h)
            new_w = max(width, round(ret_w * factor))
            new_h = max(height, round(ret_h * factor))
            upscaled = img.resize((new_w, new_h), Image.LANCZOS)
            left = (new_w - width) // 2
            top = (new_h - height) // 2
            enhanced = upscaled.crop((left, top, left + width, top + height))
            enhanced = enhanced.filter(
                ImageFilter.UnsharpMask(radius=1.6, percent=120, threshold=2)
            )
            buf = io.BytesIO()
            enhanced.save(buf, format="JPEG", quality=92, optimize=True)
            return {
                "data": buf.getvalue(),
                "extension": ".jpg",
                "upscaled_from": f"{ret_w}x{ret_h}",
            }
    except Exception as exc:  # noqa: BLE001 - metadata-grade best effort
        log.warning("Resolution enhancement skipped: %s", exc)
        return None


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
    # Quality suffix tunes every request toward wallpaper-grade output.
    effective_prompt = f"{prompt}{_subject_enhancer(prompt)}{POLLINATIONS_QUALITY_SUFFIX}"
    if negative_prompt:
        effective_prompt = f"{effective_prompt} Avoid: {negative_prompt}."

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
                enhancement = _enhance_resolution(data, width, height)
                upscale_note = None
                if enhancement is not None:
                    data = enhancement["data"]
                    extension = enhancement["extension"]
                    upscale_note = enhancement["upscaled_from"]
                    log.info(
                        "Provider returned %s - enhanced to %dx%d",
                        upscale_note, width, height,
                    )
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
                        "upscaled_from": upscale_note,
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


def _image_models_from_page(payload):
    """Image-capable model names from one ListModels page.

    A model counts when it supports generateContent (the call we make) and
    its name says "image". Embedding/TTS/live models never qualify even
    when their names mention other media types.
    """
    names = []
    for item in payload.get("models") or []:
        name = (item.get("name") or "").rsplit("/", 1)[-1]
        methods = item.get("supportedGenerationMethods") or []
        lowered = name.lower()
        if "generateContent" not in methods:
            continue
        if "image" not in lowered:
            continue
        if any(bad in lowered for bad in ("embedding", "tts", "audio")):
            continue
        names.append(name)
    return names


def _order_image_models(models):
    """Known-good names first, then the rest newest-looking first."""
    priority = ["gemini-3-pro-image", "gemini-2.5-flash-image"]
    ordered = [m for m in priority if m in models]
    ordered += sorted((m for m in models if m not in priority), reverse=True)
    if ordered:
        log.info(
            "Gemini image models this key can use: %s", ", ".join(ordered)
        )
    else:
        log.warning(
            "Gemini listed zero image models for this key - Google may not "
            "have granted image generation to this account yet."
        )
    return ordered


def _fetch_gemini_image_models(api_key):
    """Ask Google which image models this key can use (ListModels).

    Returns a list of model names, or None when the listing itself could
    not be fetched (network trouble or a rejected request) - callers then
    fall back to the built-in static chain.
    """
    names = []
    page_token = None
    for _page in range(4):
        params = {"pageSize": 1000}
        if page_token:
            params["pageToken"] = page_token
        try:
            response = requests.get(
                GEMINI_API_BASE,
                params=params,
                timeout=GEMINI_LIST_TIMEOUT,
                headers={"x-goog-api-key": api_key, "User-Agent": USER_AGENT},
            )
        except requests.RequestException as exc:
            log.warning(
                "Gemini model listing unreachable (%s) - using built-in "
                "model list", exc,
            )
            return None
        if response.status_code != 200:
            log.warning(
                "Gemini model listing failed (HTTP %s) - using built-in "
                "model list", response.status_code,
            )
            return None
        payload = response.json()
        names.extend(_image_models_from_page(payload))
        page_token = payload.get("nextPageToken")
        if not page_token:
            break
    return names


def _gemini_model_candidates(api_key, primary):
    """Ordered model chain: primary, then everything this key can see."""
    now = time.time()
    cached = _GEMINI_MODEL_CACHE["models"]
    if cached is not None and now - _GEMINI_MODEL_CACHE["at"] < GEMINI_MODEL_CACHE_TTL:
        available = cached
    else:
        available = _fetch_gemini_image_models(api_key)
        if available is not None:
            available = _order_image_models(available)
            _GEMINI_MODEL_CACHE["at"] = now
            _GEMINI_MODEL_CACHE["models"] = available
    if not available:
        available = []
    chain = [primary]
    for name in GEMINI_IMAGE_MODEL_FALLBACKS + available:
        if name not in chain:
            chain.append(name)
    return chain


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

    if "location is not supported" in text:
        return GenerationError(
            "Google says this location can't use the Gemini API - this is "
            "about the network's region, not the key. If you're on a VPN, "
            "try switching it off (or on), then restart the backend."
        )
    if status in (400, 401) and ("api key" in text or "api_key" in text):
        return GenerationError(
            "Google rejected the API key - check the key inside "
            "backend/gemini_api_key.txt (new Google keys start with 'AQ.', "
            "older ones with 'AIza')."
        )
    if status == 429 or "resource_exhausted" in text or "quota" in text:
        quota_id, retry_delay = "", ""
        try:
            details = response.json().get("error", {}).get("details") or []
        except ValueError:
            details = []
        for item in details:
            for violation in item.get("violations") or []:
                quota_id = quota_id or str(violation.get("quotaId") or "")
            retry_delay = retry_delay or str(item.get("retryDelay") or "")
        if quota_id:
            log.warning(
                "Gemini quota detail: %s (retry after %s)",
                quota_id, retry_delay or "?",
            )
        if "PerMinute" in quota_id:
            base = (
                "Google's per-minute limit for the image model was hit - "
                "wait one minute, then try again."
            )
        elif "PerDay" in quota_id:
            base = (
                "Google's free daily limit for this image model is used "
                "up - it resets after midnight Pacific time."
            )
        else:
            base = (
                "Google's free limit for this image model is used up for "
                "now - wait a bit and try again."
            )
        if retry_delay:
            base += f" Google says retry in ~{retry_delay}."
        return GenerationError(base)
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
    model=None,
    images_dir=None,
    retries=2,
    negative_prompt=None,
):
    """Call Google's Gemini image model and persist the result.

    Asks Google which image models this key can actually see and works
    through them (each model has its own free-tier bucket), falling back
    to a built-in chain when the listing is unavailable. Returns the same
    metadata dict shape as generate_image(). Raises GenerationError with
    a user-friendly message on any failure.
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
    primary = model or GEMINI_IMAGE_MODEL
    models_to_try = _gemini_model_candidates(api_key, primary)
    base_body = {"contents": [{"parts": [{"text": effective_prompt}]}]}

    last_error = None
    for current_model in models_to_try:
        url = f"{GEMINI_API_BASE}/{current_model}:generateContent"
        for attempt in range(1, retries + 1):
            move_to_next_model = False
            for config in _gemini_image_configs(aspect_ratio):
                body = dict(base_body)
                if config:
                    body["generationConfig"] = config
                try:
                    log.info(
                        "Gemini attempt %d/%d (%s, %dx%d -> %s, config=%s)",
                        attempt, retries, current_model, width, height,
                        aspect_ratio,
                        sorted(config.get("imageConfig", {}).keys()) or "plain",
                    )
                    response = requests.post(
                        url,
                        json=body,
                        timeout=GEMINI_REQUEST_TIMEOUT,
                        headers={
                            "x-goog-api-key": api_key,
                            "User-Agent": USER_AGENT,
                        },
                    )
                except requests.RequestException as exc:
                    last_error = GenerationError(
                        f"Network error talking to Google: {exc}"
                    )
                    continue

                if response.status_code == 200:
                    try:
                        return _finish_gemini_image(
                            response, prompt, negative_prompt, seed,
                            current_model, width, height, images_dir,
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
                    or "aspect" in text
                ):
                    last_error = _gemini_error_for(response)
                    continue

                last_error = _gemini_error_for(response)
                # Quota / key / missing-model errors cannot be fixed by
                # retrying the same model - but the next model may have its
                # own free quota bucket. Move on.
                if response.status_code in (400, 401, 403, 404, 429):
                    move_to_next_model = True
                    break

            if move_to_next_model:
                break
            if attempt < retries:
                pause = RETRY_BACKOFF_SECONDS * attempt
                log.warning(
                    "Gemini attempt %d failed (%s); retrying",
                    attempt, last_error,
                )
                time.sleep(pause)

    raise last_error


def _hf_dimensions_for(width, height):
    """Nearest FLUX-friendly canvas (multiples of 32) for a requested size."""
    scale = min(1.0, HF_MAX_CANVAS_SIDE / max(width, height))
    render_w = max(256, int(round(width * scale / 32.0)) * 32)
    render_h = max(256, int(round(height * scale / 32.0)) * 32)
    return render_w, render_h


def _hf_error_for(response, model):
    """Map a Hugging Face error response to a friendly GenerationError."""
    try:
        message = response.json().get("error", "")
        if isinstance(message, dict):
            message = message.get("message", "")
    except ValueError:
        message = response.text[:200]
    text = str(message).lower()
    status = response.status_code

    if status == 401 or "invalid api token" in text or "bad token" in text:
        return GenerationError(
            "Hugging Face rejected the token - check the token inside "
            "backend/huggingface_token.txt (it should start with 'hf_')."
        )
    if status == 403 or "gated" in text or "agree" in text:
        return GenerationError(
            f"Model {model} needs one-time permission: open its page on "
            "huggingface.co while signed in and click 'Agree' to unlock it."
        )
    if status == 404 or "no inference provider" in text or "not deployed" in text:
        return GenerationError(
            f"Model {model} is not available on Hugging Face right now."
        )
    if status in (429, 503) or "quota" in text or "credit" in text:
        return GenerationError(
            "Hugging Face free credits are used up or the model is busy - "
            "credits reset monthly. Try again soon."
        )
    return GenerationError(
        f"Hugging Face returned HTTP {status}: {str(message)[:300]}"
    )


def _finish_huggingface_image(
    image_bytes, content_type, hf_model, prompt, negative_prompt, seed,
    width, height, render_w, render_h, images_dir,
):
    """Save a successful Hugging Face image and build its metadata dict."""
    if len(image_bytes) < 1024:
        raise GenerationError(
            "Hugging Face returned a suspiciously small image payload."
        )

    extension = _extension_for(content_type)
    enhancement = _enhance_resolution(image_bytes, width, height)
    upscale_note = None
    if enhancement is not None:
        image_bytes = enhancement["data"]
        extension = enhancement["extension"]
        upscale_note = enhancement["upscaled_from"]
        log.info(
            "Hugging Face rendered %dx%d - enhanced to %dx%d",
            render_w, render_h, width, height,
        )

    filename = _save_image(
        image_bytes, images_dir, extension, provider="huggingface"
    )
    dimensions = _read_dimensions(image_bytes) or {}
    saved_path = images_dir / filename
    stat = saved_path.stat()
    _write_sidecar(
        saved_path,
        {
            "provider": "huggingface",
            "model": hf_model,
            "prompt": prompt,
            "negative_prompt": negative_prompt or None,
            "seed": seed,
            "requested_width": width,
            "requested_height": height,
            "rendered_width": render_w,
            "rendered_height": render_h,
            "upscaled_from": upscale_note,
        },
    )
    return {
        "filename": filename,
        "url": f"/api/images/{filename}",
        "provider": "huggingface",
        "model": hf_model,
        "source": "generated",
        "prompt": prompt,
        "negative_prompt": negative_prompt or None,
        "seed": seed,
        "width": dimensions.get("width", width),
        "height": dimensions.get("height", height),
        "size_bytes": stat.st_size,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def generate_image_huggingface(
    prompt,
    width=1080,
    height=1920,
    seed=None,
    model=None,
    images_dir=None,
    retries=2,
    negative_prompt=None,
):
    """Call Hugging Face Inference (FLUX.1) and persist the result.

    Tries the best model first (FLUX.1-dev) and automatically falls back to
    the open-license FLUX.1-schnell when dev is gated or unavailable. Raises
    GenerationError with a friendly message on failure - app.py then falls
    back to Pollinations so the user is never blocked.
    """
    token = read_huggingface_token()
    if not token:
        raise GenerationError(
            "No Hugging Face token found - save it to backend/huggingface_token.txt."
        )
    if images_dir is None:
        raise GenerationError("images_dir is required")
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    effective_prompt = (
        f"{prompt}{_subject_enhancer(prompt)}{POLLINATIONS_QUALITY_SUFFIX}"
    )
    if negative_prompt:
        effective_prompt = f"{effective_prompt} Avoid: {negative_prompt}."

    seed = seed or random.randint(1, 999_999_999)
    render_w, render_h = _hf_dimensions_for(width, height)

    model_list = [(model, 28)] if model else list(HF_IMAGE_MODELS)
    last_error = None
    for hf_model, steps in model_list:
        url = HF_ROUTER_URL.format(model=hf_model)
        body = {
            "inputs": effective_prompt,
            "parameters": {
                "width": render_w,
                "height": render_h,
                "num_inference_steps": steps,
                "seed": seed,
            },
        }
        for attempt in range(1, retries + 1):
            try:
                log.info(
                    "Hugging Face attempt %d/%d (%s, %dx%d canvas, seed=%d)",
                    attempt, retries, hf_model, render_w, render_h, seed,
                )
                response = requests.post(
                    url,
                    json=body,
                    timeout=HF_REQUEST_TIMEOUT,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "User-Agent": USER_AGENT,
                    },
                )
            except requests.RequestException as exc:
                last_error = GenerationError(
                    f"Network error talking to Hugging Face: {exc}"
                )
                continue

            content_type = response.headers.get("Content-Type", "")
            if response.status_code == 200 and content_type.startswith("image/"):
                return _finish_huggingface_image(
                    response.content, content_type, hf_model, prompt,
                    negative_prompt, seed, width, height,
                    render_w, render_h, images_dir,
                )

            last_error = _hf_error_for(response, hf_model)
            # A rejected token, gated model or missing model will not improve
            # by retrying this model - move on to the next one (if any).
            if response.status_code in (400, 401, 403, 404):
                break
            if attempt < retries:
                pause = RETRY_BACKOFF_SECONDS * attempt
                log.warning(
                    "Hugging Face attempt %d failed (%s); retrying in %.1fs",
                    attempt, last_error, pause,
                )
                time.sleep(pause)

    raise last_error or GenerationError(
        "Hugging Face could not generate an image."
    )


# --- Replicate (paid FLUX renders, ~$0.003-0.025 per picture) ---------------
# (constants + token helpers live near the top, next to the HF section)


def _replicate_aspect_ratio(width, height):
    """Snap a width/height pair to the nearest ratio FLUX supports."""
    target = math.log(max(width, 1) / max(height, 1))
    return min(
        _REPLICATE_RATIOS, key=lambda item: abs(math.log(item[1]) - target)
    )[0]


def _replicate_error_for(response):
    """Map a Replicate API error to a friendly GenerationError."""
    try:
        detail = response.json().get("detail", "")
    except ValueError:
        detail = response.text[:200]
    text = str(detail).lower()
    status = response.status_code

    if status == 401 or "invalid token" in text:
        return GenerationError(
            "Replicate rejected the API token - check the token inside "
            "backend/replicate_api_token.txt (it should start with 'r8_')."
        )
    if status == 402 or "credit" in text or "billing" in text or "payment" in text:
        return GenerationError(
            "The Replicate account is out of credit - add more at "
            "replicate.com/account/billing when you want to continue."
        )
    if status == 404 or "not found" in text:
        return GenerationError(
            f"Replicate model is not available right now ({str(detail)[:150]})."
        )
    if status == 422:
        return GenerationError(
            f"Replicate rejected the picture request ({str(detail)[:150]})."
        )
    if status == 429:
        return GenerationError(
            "Replicate is rate-limiting this token - wait a minute and "
            "try again."
        )
    return GenerationError(
        f"Replicate returned HTTP {status}: {str(detail)[:300]}"
    )


def _replicate_wait(poll_url, auth):
    """Poll a Replicate prediction until it succeeds or gives up.

    Returns (image_url, None) on success, or (None, GenerationError).
    """
    for _poll in range(1, REPLICATE_POLL_LIMIT + 1):
        try:
            poll_resp = requests.get(
                poll_url, headers=auth, timeout=REPLICATE_REQUEST_TIMEOUT
            )
        except requests.RequestException as exc:
            return None, GenerationError(
                f"Network error while waiting for Replicate: {exc}"
            )
        if poll_resp.status_code != 200:
            return None, _replicate_error_for(poll_resp)
        prediction = poll_resp.json()
        status = prediction.get("status")
        if status == "succeeded":
            output = prediction.get("output")
            if isinstance(output, list):
                output = output[0] if output else None
            if not output:
                return None, GenerationError(
                    "Replicate finished but returned no image."
                )
            return output, None
        if status in ("failed", "canceled"):
            err = str(prediction.get("error") or "").strip() or (
                "the model could not render this prompt"
            )
            lowered = err.lower()
            if "nsfw" in lowered or "safety" in lowered or "flagged" in lowered:
                return None, GenerationError(
                    "Replicate's safety filter blocked this prompt - try "
                    "rewording it a little."
                )
            return None, GenerationError(
                f"Replicate render failed: {err[:250]}"
            )
        time.sleep(REPLICATE_POLL_INTERVAL)
    return None, GenerationError(
        "Replicate took too long to render - try again in a moment."
    )


def _finish_replicate_image(
    image_url, rl_model, prompt, negative_prompt, seed,
    width, height, images_dir,
):
    """Download a finished Replicate render, save it, build metadata."""
    try:
        download = requests.get(
            image_url,
            timeout=REPLICATE_DOWNLOAD_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
        )
    except requests.RequestException as exc:
        raise GenerationError(
            f"Could not download the finished picture: {exc}"
        )
    if download.status_code != 200:
        raise GenerationError(
            f"The finished picture could not be downloaded "
            f"(HTTP {download.status_code})."
        )
    image_bytes = download.content
    if len(image_bytes) < 1024:
        raise GenerationError(
            "Replicate returned a suspiciously small image payload."
        )

    extension = _extension_for(download.headers.get("Content-Type", ""))
    enhancement = _enhance_resolution(image_bytes, width, height)
    upscale_note = None
    if enhancement is not None:
        image_bytes = enhancement["data"]
        extension = enhancement["extension"]
        upscale_note = enhancement["upscaled_from"]
        log.info("Replicate render enhanced to %dx%d", width, height)

    filename = _save_image(
        image_bytes, images_dir, extension, provider="replicate"
    )
    dimensions = _read_dimensions(image_bytes) or {}
    saved_path = images_dir / filename
    stat = saved_path.stat()
    _write_sidecar(
        saved_path,
        {
            "provider": "replicate",
            "model": rl_model,
            "prompt": prompt,
            "negative_prompt": negative_prompt or None,
            "seed": seed,
            "requested_width": width,
            "requested_height": height,
            "upscaled_from": upscale_note,
        },
    )
    return {
        "filename": filename,
        "url": f"/api/images/{filename}",
        "provider": "replicate",
        "model": rl_model,
        "source": "generated",
        "prompt": prompt,
        "negative_prompt": negative_prompt or None,
        "seed": seed,
        "width": dimensions.get("width", width),
        "height": dimensions.get("height", height),
        "size_bytes": stat.st_size,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def generate_image_replicate(
    prompt,
    width=1080,
    height=1920,
    seed=None,
    model=None,
    images_dir=None,
    retries=2,
    negative_prompt=None,
):
    """Render through Replicate's paid FLUX models and persist the result.

    Creates a prediction on the best model (FLUX.1-dev), polls until the
    render finishes, downloads the picture and upscales it to the exact
    requested wallpaper size. Falls back to the ultra-cheap FLUX.1-schnell
    when dev misbehaves. Raises GenerationError with a friendly message on
    failure - app.py then falls back to Pollinations so the user is never
    blocked.
    """
    token = read_replicate_api_token()
    if not token:
        raise GenerationError(
            "No Replicate API token found - save it to "
            "backend/replicate_api_token.txt."
        )
    if images_dir is None:
        raise GenerationError("images_dir is required")
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    effective_prompt = (
        f"{prompt}{_subject_enhancer(prompt)}{POLLINATIONS_QUALITY_SUFFIX}"
    )
    if negative_prompt:
        effective_prompt = f"{effective_prompt} Avoid: {negative_prompt}."

    seed = seed or random.randint(1, 999_999_999)
    aspect_ratio = _replicate_aspect_ratio(width, height)
    auth = {"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}

    models_to_try = [model] if model else list(REPLICATE_IMAGE_MODELS)
    last_error = None
    for rl_model in models_to_try:
        for attempt in range(1, retries + 1):
            try:
                log.info(
                    "Replicate attempt %d/%d (%s, %dx%d -> %s, seed=%d)",
                    attempt, retries, rl_model, width, height,
                    aspect_ratio, seed,
                )
                create = requests.post(
                    f"{REPLICATE_API_BASE}/models/{rl_model}/predictions",
                    json={
                        "input": {
                            "prompt": effective_prompt,
                            "aspect_ratio": aspect_ratio,
                            "output_format": "jpg",
                            "seed": seed,
                        }
                    },
                    headers=auth,
                    timeout=REPLICATE_REQUEST_TIMEOUT,
                )
            except requests.RequestException as exc:
                last_error = GenerationError(
                    f"Network error talking to Replicate: {exc}"
                )
                continue

            if create.status_code not in (200, 201):
                last_error = _replicate_error_for(create)
                # Token/billing problems are hopeless for every model -
                # stop the whole chain right away.
                if create.status_code in (401, 402):
                    raise last_error
                # Bad model or bad request: the next model may work.
                if create.status_code in (404, 422):
                    break
                if attempt < retries:
                    time.sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue

            prediction = create.json()
            poll_url = (prediction.get("urls") or {}).get("get")
            if not poll_url:
                last_error = GenerationError(
                    "Replicate did not return a prediction to wait for."
                )
                continue
            image_url, poll_error = _replicate_wait(poll_url, auth)
            if image_url:
                return _finish_replicate_image(
                    image_url, rl_model, prompt, negative_prompt, seed,
                    width, height, images_dir,
                )
            last_error = poll_error
            if attempt < retries:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    raise last_error or GenerationError(
        "Replicate could not generate an image."
    )


MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


def _entry_for(path: Path):
    """Build gallery metadata for one file (dimension result is cached)."""
    stat = path.stat()
    cache_key = (path.name, stat.st_mtime_ns, stat.st_size)
    dimensions = _dimension_cache.get(cache_key)
    if dimensions is None:
        dimensions = _dimensions_from_path(path)
        _dimension_cache[cache_key] = dimensions
    if path.name.startswith(("pollinations_", "gemini_", "huggingface_", "replicate_")):
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
