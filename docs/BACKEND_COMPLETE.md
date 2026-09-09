# Backend API - Complete Reference

Base URL: `http://127.0.0.1:5000` (LAN: `http://<your-ip>:5000`, host bound to `0.0.0.0`)

All responses are JSON. Errors always use the same envelope:

```json
{ "success": false, "error": { "message": "...", "status": 400 } }
```

CORS is enabled for all origins on `/api/*` so the Expo web client
(`localhost:8081`) can call the API directly.

---

## Endpoints

### `GET /api/health`

Health check. The mobile app uses this to auto-detect the backend.

```json
{
  "success": true,
  "status": "ok",
  "app": "FrogPaper Mobile",
  "version": "1.5.0",
  "server_time": "2026-09-09T20:55:48.791823+00:00",
  "images_count": 1,
  "providers_active": ["pollinations"]
}
```

### `GET /api/providers`

Lists generation providers.

```json
{
  "success": true,
  "active": "pollinations",
  "providers": [
    {
      "id": "pollinations",
      "name": "Pollinations.ai",
      "model": "flux",
      "status": "active",
      "requires_api_key": false,
      "max_side": 2048,
      "description": "Free text-to-image generation (Flux model), no API key required."
    }
  ]
}
```

### `POST /api/generate`

Generates one wallpaper and saves it to `static/images/`.

Request body (JSON):

| Field  | Type   | Required | Constraints                     | Default |
|--------|--------|----------|---------------------------------|---------|
| prompt | string | yes      | 3-600 characters                | -       |
| width  | int    | no       | 256-2048 (clamped)              | 1080    |
| height | int    | no       | 256-2048 (clamped)              | 1920    |
| seed   | int    | no       | 1-999999999                     | random  |
| provider | string | no     | must be `pollinations`          | `pollinations` |

Example:

```bash
curl -X POST http://127.0.0.1:5000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A serene frog pond at dusk","width":1080,"height":1920}'
```

Success (HTTP 201):

```json
{
  "success": true,
  "image": {
    "filename": "pollinations_20260909-205551.jpg",
    "url": "/api/images/pollinations_20260909-205551.jpg",
    "provider": "pollinations",
    "model": "flux",
    "prompt": "A serene frog pond at dusk, pastel colors, phone wallpaper",
    "seed": 221082962,
    "width": 576,
    "height": 1024,
    "size_bytes": 40384,
    "created_at": "2026-09-09T20:55:51.699751+00:00"
  }
}
```

Error codes: `400` invalid input, `503` provider not active, `502` provider
failed after 3 retries.

**Resolution note:** the Flux endpoint buckets sizes - a 1080x1920 request
currently returns 576x1024. Always trust the `width`/`height` in the
response over what you asked for.

### `GET /api/gallery?limit=200&offset=0`

Lists images in `static/images/`, newest first. `limit` is clamped to 1-500.

```json
{
  "success": true,
  "total": 82,
  "count": 82,
  "offset": 0,
  "images": [
    {
      "filename": "pollinations_20260909-205551.jpg",
      "url": "/api/images/pollinations_20260909-205551.jpg",
      "width": 576,
      "height": 1024,
      "size_bytes": 40384,
      "created_at": "2026-09-09T20:55:51.685112+00:00"
    }
  ]
}
```

Recognized extensions: `.png`, `.jpg`, `.jpeg`, `.webp`. There is no
database - dropping files into `static/images/` is enough for them to show
up (pull-to-refresh in the app).

### `GET /api/images/<filename>`

Serves one image file with 1-day browser caching. Path traversal is
neutralised (basename only). Unknown files return the JSON 404 envelope.

---

## Generation service internals

`backend/services/image_generation.py`

- Pollinations endpoint: `https://image.pollinations.ai/prompt/<urlencoded prompt>`
  with `width`, `height`, `seed`, `model=flux`, `nologo=true`.
- Timeouts: 10s connect / 120s read. Retries: 3 attempts, linear backoff.
- The response content type decides the saved extension (jpg/png/webp).
- Filenames: `pollinations_YYYYMMDD-HHMMSS.ext`, with `-1`, `-2`... suffixes
  on same-second collisions.
- Gallery metadata is framework-agnostic: the service returns plain dicts
  and raises `GenerationError`; `app.py` maps that to HTTP 502.

## Standalone test (no HTTP server needed)

```powershell
cd E:\FROGPAPER\FrogPaperMobile\backend
.\venv\Scripts\activate
python test_generation.py "a neon frog in a cyberpunk city"
```

## Security notes

This is a **development server** (Flask built-in, `debug=False`, threaded).
Fine for home use on your LAN. If you ever expose it to the internet, put a
real WSGI server (waitress/gunicorn) plus a reverse proxy with rate
limiting in front - Pollinations generation is unauthenticated by design.
