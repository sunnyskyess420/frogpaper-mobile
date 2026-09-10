# Cloud Gallery Persistence

## Current Design
The FrogPaper backend stores generated images as files in `backend/static/images/` with sidecar JSON files for metadata (prompt, seed, provider, etc.). This works great on a local PC where files persist indefinitely.

## Cloud Deployment Tradeoff
Free cloud hosting services (like Render, Railway, Heroku free tier) use **ephemeral storage** - any files stored on disk are wiped when:
- The service redeploys (new code push)
- The service restarts (automatic scaling, maintenance)
- The service is recreated

**This means:** On free cloud hosting, your gallery images will be lost periodically.

## Options for Persistence

### Option 1: Accept Ephemeral Storage (Recommended for Testing)
- **Pros:** Free, simple, no configuration needed
- **Cons:** Images lost on redeploy/restart
- **Best for:** Testing cloud deployment, occasional use
- **Status:** This is the default with the current setup

### Option 2: Add S3-Compatible Storage (Recommended for Production)
- **Pros:** True persistence, images survive redeployments
- **Cons:** Requires AWS S3 or compatible service account, small costs
- **Implementation needed:**
  - Add `boto3` dependency to requirements.txt
  - Add S3 upload logic in `image_generation.py`
  - Add env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`
  - Modify image serving to serve from S3 URLs instead of local files
- **Status:** Not implemented yet - can be added when you need persistence

### Option 3: SQLite + Local Files (Mixed Approach)
- **Pros:** Metadata persists even if images don't
- **Cons:** More complex, still loses images on redeploy
- **Implementation needed:**
  - Add SQLite database for image metadata
  - Keep file storage as-is (still ephemeral)
  - Database survives redeploy, but images don't
- **Status:** Not implemented - limited benefit over Option 1

## Recommendation
For now, **use Option 1 (ephemeral storage)** for cloud deployment. It's free, simple, and lets you test the cloud workflow. If you find yourself generating images you want to keep long-term, we can implement Option 2 (S3 storage) later.

The mobile app already has "Save to device" functionality, so users can save important wallpapers to their phone gallery regardless of cloud persistence.