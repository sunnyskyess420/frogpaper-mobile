"""
FrogPaper Mobile - Backend API
==============================
Hardened rebuild of the Flask backend (handover 2026-09-10).

Endpoints
---------
GET  /api/health          -> service + gallery health summary
GET  /api/providers       -> image generation providers
POST /api/generate        -> generate an image (Gemini or Pollinations)
GET  /api/gallery         -> list generated images (newest first)
GET  /api/gallery/<name>  -> single image metadata (incl. prompt/seed)
DELETE /api/gallery/<name> -> delete an image
POST /api/gallery/upload  -> add your own image
GET  /api/prompts/recent  -> distinct recently-used prompts
GET  /api/images/<name>   -> serve one image file
POST /api/slideshow/config -> save slideshow configuration (interval, enabled)
GET  /api/slideshow/config -> get current slideshow configuration
GET  /api/slideshow/next   -> get next wallpaper for slideshow

Run (Windows)
-------------
cd E:\\FROGPAPER\\FrogPaperMobile\\backend
.\\venv\\Scripts\\activate
python app.py
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from services.image_generation import (
    MAX_NEGATIVE_PROMPT_LENGTH,
    PROVIDERS,
    GenerationError,
    default_provider_id,
    delete_sidecar,
    find_gallery_image,
    fit_device_wallpaper,
    generate_image,
    generate_image_gemini,
    generate_image_huggingface,
    generate_image_replicate,
    list_gallery_images,
    recent_prompts,
    refresh_provider_statuses,
    save_uploaded_image,
)

BASE_DIR = Path(__file__).resolve().parent
IMAGES_DIR = BASE_DIR / "static" / "images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

APP_NAME = "FrogPaper Mobile"
APP_VERSION = "1.9.12"

# Access key for API authentication (shared secret between app and backend)
# Set via RENDER_ACCESS_KEY environment variable on Render, or fallback to local file
ACCESS_KEY_FILE = BASE_DIR / "access_key.txt"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 26 * 1024 * 1024  # 26 MB request cap (uploads)

# The Expo web client (localhost:8081) talks to this API cross-origin,
# so permissive CORS is required on /api/*.
CORS(app, resources={r"/api/*": {"origins": "*"}})

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
log = logging.getLogger("frogpaper")


# ---------------------------------------------------------------------------
# Authentication middleware
# ---------------------------------------------------------------------------

@app.before_request
def check_access_key():
    """Require access key for all /api/* routes."""
    # Only check API routes
    if not request.path.startswith("/api/"):
        return
    
    # Health check is exempt for connectivity testing
    if request.path == "/api/health":
        return
    
    if not require_access_key():
        log.warning("Request rejected: missing or invalid access key from %s", request.remote_addr)
        return _error_response("Access key required. Configure it in app Settings.", 401)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_access_key():
    """Read the access key from environment variable or file."""
    env_key = os.environ.get("FROGPAPER_ACCESS_KEY", "").strip()
    if env_key:
        return env_key
    try:
        if ACCESS_KEY_FILE.is_file():
            key = ACCESS_KEY_FILE.read_text(encoding="utf-8").strip()
            if key:
                return key
    except OSError:
        pass
    return None


def require_access_key():
    """Check if the request has a valid access key in headers."""
    expected_key = read_access_key()
    # If no key is configured, allow requests (for local development)
    if not expected_key:
        return True
    
    provided_key = request.headers.get("X-Access-Key", "").strip()
    if not provided_key:
        return False
    
    # Constant-time comparison to prevent timing attacks
    return provided_key == expected_key

def _parse_int(value, default, minimum, maximum):
    """Parse an int with clamping - never let bad input crash a route."""
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _read_user_key(header_name):
    """Read a user-supplied API key from a request header.

    SECURITY: This is the ONLY place user keys are touched. They are:
      - Never logged (we never pass them to log.*)
      - Never stored on disk (no file write, no DB write)
      - Never echoed back in error responses
      - Only handed to the provider function for the current request
    Keys are stripped of surrounding whitespace and returned as None when
    absent or empty - the provider functions then know to fall back to
    the server's env var (legacy behavior) or fail cleanly.
    """
    raw = request.headers.get(header_name, "")
    if not raw:
        return None
    cleaned = raw.strip()
    return cleaned or None


def _error_response(message, status, details=None):
    body = {"success": False, "error": {"message": message, "status": status}}
    if details:
        body["error"]["details"] = details
    return jsonify(body), status


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    """Health check used by the mobile app to detect the backend."""
    refresh_provider_statuses()
    images = list_gallery_images(IMAGES_DIR)
    return jsonify(
        {
            "success": True,
            "status": "ok",
            "app": APP_NAME,
            "version": APP_VERSION,
            "server_time": datetime.now(timezone.utc).isoformat(),
            "images_count": len(images),
            "providers_active": [p["id"] for p in PROVIDERS if p["status"] == "active"],
        }
    )


@app.get("/api/providers")
def providers():
    """List available image generation providers."""
    refresh_provider_statuses()
    return jsonify({"success": True, "active": default_provider_id(), "providers": PROVIDERS})


@app.post("/api/generate")
def generate():
    """Generate a wallpaper image from a text prompt."""
    data = request.get_json(silent=True) or {}

    prompt = str(data.get("prompt", "")).strip()
    if len(prompt) < 3:
        return _error_response("Prompt must be at least 3 characters long.", 400)
    if len(prompt) > 600:
        return _error_response("Prompt must be 600 characters or fewer.", 400)

    negative_prompt = str(data.get("negative_prompt") or "").strip()
    if len(negative_prompt) > MAX_NEGATIVE_PROMPT_LENGTH:
        return _error_response(
            "Negative prompt must be 300 characters or fewer.", 400
        )

    width = _parse_int(data.get("width"), 1080, 256, 2048)
    height = _parse_int(data.get("height"), 1920, 256, 2560)
    # Legacy 16:9 portrait requests are rendered in the phone's real tall
    # shape so wallpapers fill the screen with no zoom or side cropping.
    width, height = fit_device_wallpaper(width, height)
    seed = data.get("seed")
    if seed is not None:
        seed = _parse_int(seed, 1, 1, 999999999)

    refresh_provider_statuses()
    provider_id = str(data.get("provider") or default_provider_id()).strip().lower()
    provider = next((p for p in PROVIDERS if p["id"] == provider_id), None)
    if provider is None:
        return _error_response(f"Unknown provider '{provider_id}'.", 400)
    if provider["status"] != "active":
        return _error_response(f"Provider '{provider_id}' is not available yet.", 503)

    # BYOK: read user-supplied keys from headers. Keys are never logged
    # (see _read_user_key docstring). They are passed to the provider
    # function for THIS request only, then discarded.
    user_gemini_key = _read_user_key("X-Gemini-Key")
    user_hf_token = _read_user_key("X-Hf-Token")
    user_replicate_token = _read_user_key("X-Replicate-Token")
    byok_summary = []
    if user_gemini_key:
        byok_summary.append("gemini")
    if user_hf_token:
        byok_summary.append("huggingface")
    if user_replicate_token:
        byok_summary.append("replicate")

    log.info(
        "Generate request: prompt=%r %dx%d provider=%s byok=%s",
        prompt[:60],
        width,
        height,
        provider_id,
        ",".join(byok_summary) if byok_summary else "none",
    )
    try:
        if provider_id == "replicate":
            try:
                image = generate_image_replicate(
                    prompt=prompt,
                    width=width,
                    height=height,
                    seed=seed,
                    images_dir=IMAGES_DIR,
                    negative_prompt=negative_prompt or None,
                    user_api_token=user_replicate_token,
                )
            except GenerationError as rep_exc:
                # Safety net: a bad token / outage / rejected request must
                # never block the user - fall back to the free provider.
                fallback = next(
                    (p for p in PROVIDERS if p["id"] == "pollinations"), None
                )
                if fallback is None or fallback["status"] != "active":
                    raise
                log.warning(
                    "Replicate failed (%s); falling back to Pollinations",
                    rep_exc,
                )
                image = generate_image(
                    prompt=prompt,
                    width=width,
                    height=height,
                    seed=seed,
                    model=fallback.get("model", "flux"),
                    images_dir=IMAGES_DIR,
                    negative_prompt=negative_prompt or None,
                )
                image["provider_fallback_from"] = "replicate"
                image["fallback_reason"] = str(rep_exc)
        elif provider_id == "gemini":
            try:
                image = generate_image_gemini(
                    prompt=prompt,
                    width=width,
                    height=height,
                    seed=seed,
                    model=provider.get("model", "gemini-2.5-flash-image"),
                    images_dir=IMAGES_DIR,
                    negative_prompt=negative_prompt or None,
                    user_api_key=user_gemini_key,
                )
            except GenerationError as gem_exc:
                # Safety net: a broken/expired/rejected Gemini key must never
                # block the user - fall back to the free provider instead.
                fallback = next(
                    (p for p in PROVIDERS if p["id"] == "pollinations"), None
                )
                if fallback is None or fallback["status"] != "active":
                    raise
                log.warning(
                    "Gemini failed (%s); falling back to Pollinations", gem_exc
                )
                image = generate_image(
                    prompt=prompt,
                    width=width,
                    height=height,
                    seed=seed,
                    model=fallback.get("model", "flux"),
                    images_dir=IMAGES_DIR,
                    negative_prompt=negative_prompt or None,
                )
                image["provider_fallback_from"] = "gemini"
                image["fallback_reason"] = str(gem_exc)
        elif provider_id == "huggingface":
            try:
                image = generate_image_huggingface(
                    prompt=prompt,
                    width=width,
                    height=height,
                    seed=seed,
                    images_dir=IMAGES_DIR,
                    negative_prompt=negative_prompt or None,
                    user_api_token=user_hf_token,
                )
            except GenerationError as hf_exc:
                # Safety net: a bad token / DNS outage / gated model must
                # never block the user - fall back to the free provider.
                fallback = next(
                    (p for p in PROVIDERS if p["id"] == "pollinations"), None
                )
                if fallback is None or fallback["status"] != "active":
                    raise
                log.warning(
                    "Hugging Face failed (%s); falling back to Pollinations",
                    hf_exc,
                )
                image = generate_image(
                    prompt=prompt,
                    width=width,
                    height=height,
                    seed=seed,
                    model=fallback.get("model", "flux"),
                    images_dir=IMAGES_DIR,
                    negative_prompt=negative_prompt or None,
                )
                image["provider_fallback_from"] = "huggingface"
                image["fallback_reason"] = str(hf_exc)
        else:
            image = generate_image(
                prompt=prompt,
                width=width,
                height=height,
                seed=seed,
                model=provider.get("model", "flux"),
                images_dir=IMAGES_DIR,
                negative_prompt=negative_prompt or None,
            )
    except GenerationError as exc:
        log.error("Generation failed: %s", exc)
        return _error_response(
            "The image provider failed to return an image.",
            502,
            {"cause": str(exc)},
        )

    log.info("Generated %s", image["filename"])
    return jsonify({"success": True, "image": image}), 201


@app.get("/api/gallery")
def gallery():
    """List generated images, newest first."""
    limit = _parse_int(request.args.get("limit"), 200, 1, 500)
    offset = _parse_int(request.args.get("offset"), 0, 0, 100000)

    images = list_gallery_images(IMAGES_DIR)
    total = len(images)
    page = images[offset : offset + limit]
    return jsonify(
        {
            "success": True,
            "total": total,
            "count": len(page),
            "offset": offset,
            "images": page,
        }
    )


@app.get("/api/gallery/<path:filename>")
def gallery_detail(filename):
    """Metadata for a single gallery image."""
    entry = find_gallery_image(IMAGES_DIR, filename)
    if entry is None:
        return _error_response(f"Image '{Path(filename).name}' not found.", 404)
    return jsonify({"success": True, "image": entry})


@app.delete("/api/gallery/<path:filename>")
def gallery_delete(filename):
    """Delete an image from the gallery directory."""
    safe_name = Path(filename).name
    target = IMAGES_DIR / safe_name
    if not target.is_file():
        return _error_response(f"Image '{safe_name}' not found.", 404)
    try:
        target.unlink()
        delete_sidecar(IMAGES_DIR, safe_name)
    except OSError as exc:
        log.error("Delete failed for %s: %s", safe_name, exc)
        return _error_response("Could not delete the image file.", 500)
    log.info("Deleted %s", safe_name)
    return jsonify(
        {
            "success": True,
            "deleted": safe_name,
            "images_count": len(list_gallery_images(IMAGES_DIR)),
        }
    )


@app.post("/api/gallery/upload")
def gallery_upload():
    """Upload a custom image (multipart/form-data, field name: 'file')."""
    file = request.files.get("file")
    if file is None or not file.filename:
        return _error_response(
            "Send multipart/form-data with an image in the 'file' field.", 400
        )
    data = file.read()
    try:
        image = save_uploaded_image(data, file.filename, IMAGES_DIR)
    except ValueError as exc:
        return _error_response(str(exc), 400)
    log.info("Uploaded %s", image["filename"])
    return jsonify({"success": True, "image": image}), 201


@app.get("/api/prompts/recent")
def prompts_recent():
    """Distinct recently-used prompts, newest first (for quick-reuse chips)."""
    limit = _parse_int(request.args.get("limit"), 12, 1, 50)
    prompts = recent_prompts(IMAGES_DIR, limit=limit)
    return jsonify({"success": True, "count": len(prompts), "prompts": prompts})


@app.get("/api/images/<path:filename>")
def serve_image(filename):
    """Serve a single image file from the gallery directory."""
    safe_name = Path(filename).name  # neutralise any path traversal
    target = IMAGES_DIR / safe_name
    if not target.is_file():
        return _error_response(f"Image '{safe_name}' not found.", 404)
    response = send_from_directory(IMAGES_DIR, safe_name, conditional=True)
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


# ---------------------------------------------------------------------------
# Slideshow endpoints
# ---------------------------------------------------------------------------

SLIDESHOW_CONFIG_FILE = BASE_DIR / "slideshow_config.json"


def _read_slideshow_config():
    """Read slideshow configuration from file, return defaults if missing."""
    try:
        if SLIDESHOW_CONFIG_FILE.is_file():
            data = SLIDESHOW_CONFIG_FILE.read_text(encoding="utf-8")
            config = json.loads(data)
            # Ensure required fields exist
            return {
                "enabled": config.get("enabled", False),
                "interval_minutes": config.get("interval_minutes", 60),
                "last_shown_index": config.get("last_shown_index", 0),
            }
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        log.warning("Could not read slideshow config: %s", exc)
    return {"enabled": False, "interval_minutes": 60, "last_shown_index": 0}


def _write_slideshow_config(config):
    """Write slideshow configuration to file."""
    try:
        SLIDESHOW_CONFIG_FILE.write_text(
            json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        log.error("Could not write slideshow config: %s", exc)
        raise


@app.post("/api/slideshow/config")
def slideshow_config_post():
    """Save slideshow configuration."""
    data = request.get_json(silent=True) or {}
    
    enabled = bool(data.get("enabled", False))
    interval_minutes = _parse_int(data.get("interval_minutes"), 60, 5, 1440)  # 5 min to 24 hours
    
    config = _read_slideshow_config()
    config["enabled"] = enabled
    config["interval_minutes"] = interval_minutes
    # Reset index when enabling or changing interval
    if enabled:
        config["last_shown_index"] = 0
    
    _write_slideshow_config(config)
    log.info("Slideshow config updated: enabled=%s, interval=%d min", enabled, interval_minutes)
    
    return jsonify({"success": True, "config": config})


@app.get("/api/slideshow/config")
def slideshow_config_get():
    """Get current slideshow configuration."""
    config = _read_slideshow_config()
    return jsonify({"success": True, "config": config})


@app.get("/api/slideshow/next")
def slideshow_next():
    """Get the next wallpaper for slideshow, cycling through gallery."""
    config = _read_slideshow_config()
    
    if not config["enabled"]:
        return _error_response("Slideshow is not enabled.", 400)
    
    images = list_gallery_images(IMAGES_DIR)
    if not images:
        return _error_response("No images available for slideshow.", 404)
    
    # Get next image in cycle
    current_index = config.get("last_shown_index", 0)
    next_index = (current_index + 1) % len(images)
    next_image = images[next_index]
    
    # Update the index
    config["last_shown_index"] = next_index
    _write_slideshow_config(config)
    
    log.info("Slideshow next: image %d/%d (%s)", next_index + 1, len(images), next_image["filename"])
    
    return jsonify({
        "success": True,
        "image": next_image,
        "index": next_index,
        "total": len(images),
    })


# ---------------------------------------------------------------------------
# Error handling - always JSON, mobile clients depend on it
# ---------------------------------------------------------------------------

@app.errorhandler(HTTPException)
def handle_http_exception(exc):
    return _error_response(exc.description or exc.name, exc.code or 500)


@app.errorhandler(Exception)
def handle_unexpected(exc):
    log.exception("Unhandled error")
    return _error_response("Unexpected server error.", 500)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    # host 0.0.0.0 so phones and emulators on the LAN can reach the backend
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
