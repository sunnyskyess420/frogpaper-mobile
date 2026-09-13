# Cloud Gallery Persistence

> **Update (2026-09-13):** pluggable storage now exists - see
> **[docs/STORAGE.md](STORAGE.md)** for the three modes, the exact Render
> persistent-disk steps, the step-by-step Cloudflare R2 setup and the
> gallery backup script. This file is kept for the background/context below.

## Current Design
The FrogPaper backend stores generated images as files in `backend/static/images/` with sidecar JSON files for metadata (prompt, seed, provider, etc.). This works great on a local PC where files persist indefinitely.

## Cloud Deployment Tradeoff
Free cloud hosting services (like Render, Railway, Heroku free tier) use **ephemeral storage** - any files stored on disk are wiped when:
- The service redeploys (new code push)
- The service restarts (automatic scaling, maintenance)
- The service is recreated

**This means:** On free cloud hosting, your gallery images will be lost periodically.

## Options for Persistence

### Option 1: Accept Ephemeral Storage (default for quick testing)
- **Pros:** Free, simple, no configuration needed
- **Cons:** Images lost on redeploy/restart
- **Best for:** Testing cloud deployment, occasional use
- **Status:** Still the default when nothing is configured - the backend keeps using the local filesystem, exactly as before.
- **Mitigation:** `backend/scripts/backup_gallery.py` pulls the whole gallery (images + metadata) down to your PC, so ephemeral does not have to mean lost.

### Option 2: Persistent Directory (`FROGPAPER_IMAGES_DIR`) - **implemented**
- **Pros:** Tiny change - mount a Render disk, set one environment variable
- **Cons:** Pins the service to a single instance
- **Status:** Implemented. Mount the disk and set `FROGPAPER_IMAGES_DIR`. Steps: [docs/STORAGE.md](STORAGE.md#mode-2-a-persistent-render-disk).

### Option 3: S3-Compatible Storage (Cloudflare R2 / AWS S3 / MinIO) - **implemented**
- **Pros:** True persistence, survives restarts and redeploys, works across instances, R2's free tier covers a gallery many times over
- **Cons:** Requires a bucket and credentials (and R2/AWS account setup)
- **Implementation:** `backend/services/storage.py` (`S3Storage`) plus `boto3` in `requirements.txt`. Set `FROGPAPER_S3_BUCKET`, `FROGPAPER_S3_ENDPOINT`, `FROGPAPER_S3_ACCESS_KEY_ID`, `FROGPAPER_S3_SECRET_ACCESS_KEY` (and optionally `FROGPAPER_S3_REGION`, `FROGPAPER_S3_PREFIX`).
- **Note:** The bucket stays private; images are still served through `/api/images/<name>`, so the app and the access key are unaffected.
- **Status:** Implemented and tested (local backend, plus the S3 path against a fake S3 in tests). Steps: [docs/STORAGE.md](STORAGE.md#mode-3-cloudflare-r2-step-by-step).

### Option 4: SQLite + Local Files (mixed approach)
- **Pros:** Metadata persists even if images don't
- **Cons:** More complex, still loses images on redeploy
- **Status:** Not implemented - superseded by options 2 and 3, which keep the images themselves.

## Recommendation
Use **Option 1** for throwaway experiments, **Option 2** if you want
persistence with the least setup, and **Option 3 (R2)** if the gallery should
outlive the service itself. In every mode run
`backend/scripts/backup_gallery.py` before a deploy if the images matter.

The mobile app also still has "Save to device", so individual wallpapers can
always live on the phone regardless of what the server does.
