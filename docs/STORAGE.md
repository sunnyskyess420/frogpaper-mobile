# Image storage

Where the gallery lives, and how to make it survive a Render deploy.

Everything the backend does with an image goes through one small layer,
`backend/services/storage.py`, which has two interchangeable backends:

| Mode | When it is used | Survives a deploy? |
|------|-----------------|--------------------|
| **1. Local filesystem** (default) | nothing configured | no - the container disk is wiped |
| **2. A directory of your choosing** | `FROGPAPER_IMAGES_DIR` is set (e.g. a mounted Render disk) | yes, if the directory is a persistent disk |
| **3. S3-compatible bucket** | the S3 variables below are set (R2 / AWS S3 / MinIO) | yes |

Selection happens once at startup: **S3 wins when it is configured,
otherwise the local filesystem**. With no configuration at all you get
exactly the behaviour the backend always had, so local development needs no
setup.

The mobile app is untouched by all of this: it still calls `/api/gallery`,
`/api/images/<name>`, `/api/gallery/upload` and `/api/gallery/<name>` and
gets the same JSON. **The bucket is never public and the app never sees a
bucket URL** - images are streamed through the backend, so the access-key
gate keeps applying to every request.

## Environment variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `FROGPAPER_IMAGES_DIR` | Local gallery directory. Point it at a mounted Render disk to get mode 2. Missing -> `backend/static/images` | optional |
| `FROGPAPER_S3_BUCKET` | Bucket that holds the images | required for S3 |
| `FROGPAPER_S3_ACCESS_KEY_ID` | Access key for that bucket | required for S3 |
| `FROGPAPER_S3_SECRET_ACCESS_KEY` | Secret key for that bucket | required for S3 |
| `FROGPAPER_S3_ENDPOINT` | Custom endpoint. **Set it for R2** (`https://<account-id>.r2.cloudflarestorage.com`); leave it out for AWS S3 | optional |
| `FROGPAPER_S3_REGION` | Signing region. Defaults to `auto` when an endpoint is set (correct for R2) and `us-east-1` otherwise | optional |
| `FROGPAPER_S3_PREFIX` | Key prefix inside the bucket, e.g. `wallpapers` - useful if the bucket holds other data | optional |

The standard AWS names work as fallbacks, so an AWS-configured box only needs
to add the bucket: `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_REGION` / `AWS_DEFAULT_REGION`,
`AWS_ENDPOINT_URL` / `AWS_ENDPOINT_URL_S3`.

A bucket without credentials is ignored (with a warning in the log) and the
local filesystem is used instead - a half-filled config can never take the
gallery offline.

New dependency: `boto3` (in `backend/requirements.txt`). It is imported
lazily, so nothing else changes for local runs.

---

## Mode 2: a persistent Render disk

This is the smallest change that makes the gallery survive: keep the local
filesystem, but put it on a disk Render keeps between deploys.

1. Render dashboard -> your **frogpaper-backend** service -> **Disks** ->
   **Add Disk**.
2. Fill in:
   - **Name**: `data`
   - **Mount path**: `/app/static/images`
   - **Size**: 1 GB is plenty (a wallpaper is a few hundred KB)
3. **Environment** -> add `FROGPAPER_IMAGES_DIR` = `/app/static/images`
   (or `/data` if you mounted the disk somewhere else - any absolute path
   works).
4. **Save** (Render redeploys the service).
5. Verify: open `https://<your-service>.onrender.com/api/health` - the new
   `"storage"` field must read
   `"local filesystem (/app/static/images)"`.

`render.yaml` in `backend/` already declares the disk at
`/app/static/images`, so the blueprint path needs nothing more than the
environment variable.

**Caveat:** a Render disk pins the service to one instance and is lost if you
delete the service. It also cannot be attached to a free instance type on
some plans. If any of that bites, use R2 (mode 3) instead.

---

## Mode 3: Cloudflare R2 (step by step)

R2 is S3-compatible and has a free tier (10 GB storage, no egress fees), so
it is the cheapest way to make the gallery permanent. AWS S3 works with
exactly the same code - skip the endpoint variable and use an AWS region.

### 1. Create the bucket

1. Sign up / log in at <https://dash.cloudflare.com> -> **R2** in the sidebar.
2. **Create bucket** -> name it e.g. `frogpaper-gallery` -> location
   *Automatic* -> **Create bucket**.
3. Leave it **private** (do not enable public access / a custom domain).
   The backend streams the images itself.

### 2. Create an API token

1. In R2, open **API** -> **Manage API tokens** -> **Create API token**.
2. Permissions: **Object Read & Write**.
3. Scope it to *this bucket only* (`frogpaper-gallery`) - nothing else in the
   account is touched.
4. **Create**, then copy the three values shown once:
   - Access Key ID
   - Secret Access Key
   - the account's **S3 endpoint**: `https://<account-id>.r2.cloudflarestorage.com`

### 3. Put the values on Render

Service -> **Environment** -> add these five variables (no quotes around the
values):

| Key | Value |
|-----|-------|
| `FROGPAPER_S3_BUCKET` | `frogpaper-gallery` |
| `FROGPAPER_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `FROGPAPER_S3_ACCESS_KEY_ID` | the access key id |
| `FROGPAPER_S3_SECRET_ACCESS_KEY` | the secret access key |
| `FROGPAPER_S3_REGION` | `auto` |

Optional: `FROGPAPER_S3_PREFIX` (e.g. `wallpapers`) if the bucket also holds
other things. Do **not** leave `FROGPAPER_IMAGES_DIR` pointing anywhere
important - once S3 is configured it is used for nothing but staging.

### 4. Redeploy

**Save** the environment (Render redeploys automatically), or **Manual
Deploy** -> *Deploy latest commit*.

### 5. Verify

1. **Deploy log** - near the top you must see:
   `Image storage ready: S3 bucket 'frogpaper-gallery' prefix '(no prefix)' via https://<account-id>.r2.cloudflarestorage.com`
   If it says `Image storage check failed (...)`, the credentials or the
   endpoint are wrong; the gallery will not work until it is fixed.
2. `https://<service>.onrender.com/api/health` -> `"storage"` must name the
   bucket, and `images_count` is the number of objects in it.
3. In the app (or with curl), upload/generate one image and reload the
   gallery - it should be listed. Then check the R2 dashboard: the object
   and its `.json` sidecar are there under the prefix.
4. `DELETE` the image in the app - both the object and the sidecar disappear
   from the bucket.

### Backing out

Remove the four/five `FROGPAPER_S3_*` variables and redeploy; the backend
goes back to the local filesystem (mode 1/2). Nothing in the app changes.

---

## Safety net: back the gallery up to your PC

`backend/scripts/backup_gallery.py` mirrors a running backend's gallery to a
local folder, images and `.json` sidecars alike. Run it **before** a deploy,
an experiment, or a switch between storage modes.

It only needs the standard library plus `requests`, so it runs with any
Python (no venv needed):

```bash
# local backend, no access key
python backend/scripts/backup_gallery.py

# a Render backend, access key from the environment
FROGPAPER_ACCESS_KEY=... python backend/scripts/backup_gallery.py \
    --url https://frogpaper-backend.onrender.com --out ./gallery_backup

# Render (PowerShell)
$env:FROGPAPER_ACCESS_KEY="..."; python backend\scripts\backup_gallery.py --url https://frogpaper-backend.onrender.com

# see what it would fetch without writing anything
python backend/scripts/backup_gallery.py --dry-run
```

| Argument | Default | Meaning |
|----------|---------|---------|
| `--url` | `http://127.0.0.1:5000` | backend to read from |
| `--out` | `./gallery_backup` | folder to mirror into |
| `--key` | `$FROGPAPER_ACCESS_KEY` | access key, if the backend needs one |
| `--dry-run` | off | print what would be downloaded, write nothing |

Behaviour: images already present with the same size are skipped, sidecars
are refreshed only when they changed, and a summary is printed at the end.
Exit status is `0` only when nothing failed (`1` on any download error or a
rejected access key). The output folder is a plain gallery directory - to
restore, copy the files into `backend/static/images/` (or
`FROGPAPER_IMAGES_DIR`) and the backend lists them again.

Typical session before moving to R2:

```bash
python backend/scripts/backup_gallery.py --url https://frogpaper-backend.onrender.com
# ... configure R2, redeploy, verify /api/health ...
# the backup is now the local copy of everything that used to be ephemeral
```

---

## Notes and gotchas

- **Existing images are not migrated.** Switching a *running* backend to S3
  changes where new images go; anything already written to the local disk
  stays there. Back it up with the script above, then re-upload what you
  want to keep (or copy the files into the bucket with `aws s3 cp`,
  `rclone`, or the R2 dashboard).
- **Local development is unchanged.** No variables -> local filesystem,
  same directory, same filenames, same JSON. The dimension cache and the
  sidecar layout are identical to before the refactor.
- **Sidecars always travel with the image.** `<name>.json` is written next to
  `<name>.png`/`.jpg` in the bucket too, and `DELETE /api/gallery/<name>`
  removes both. `GET /api/prompts/recent` reads them as before.
- **`/api/gallery` costs one listing plus one small ranged read per image**
  the first time it sees an image, to report width/height. Results are
  cached per object, so normal polling does not re-fetch anything.
- **Serving is streamed through the backend**, with `Cache-Control:
  public, max-age=86400` and an ETag, exactly like the local path. Range
  requests get the full object (S3 mode) rather than a 206.
- **A broken bucket config fails loudly, not silently:** `GET /api/health`
  still answers (so the app can reach the backend), but gallery calls return
  a JSON 500 and the deploy log carries the reason.
- **Tests:** `python backend/tests/test_storage.py` covers both backends. The
  S3 half uses [`moto`](https://github.com/getmoto/moto) (a test-only
  dependency; install it in a throwaway venv, never in the repo) and is
  skipped with a clear message when moto is missing.

## Hand-off window (images do not stay)

A generated image is written to the store only so the app can collect it, and is
deleted automatically once it is older than the hand-off window:

| Setting | Default | Meaning |
|---|---|---|
| `FROGPAPER_HANDOFF_TTL_MINUTES` | `60` | Minutes an image may sit on the server |

The sweep runs at the start of every `/api/generate` request, so a busy app keeps the
store nearly empty with no cron or background worker (a free instance has neither).
Failures are logged and ignored - a sweep must never break a request.

Why a window instead of deleting immediately: the app fetches the picture a second
time when the owner taps *Set as wallpaper* or *Save to device*, and that can happen
well after generating. A few minutes would break those taps; an hour covers a realistic
session while leaving nothing behind afterwards.

Images the owner keeps live on the phone (`mobile-app/src/services/localGallery.js`),
which is the only gallery the app reads.
