# FrogPaper Mobile

AI wallpaper studio for Android. Generate phone wallpapers from a text prompt with
free engines or your own API keys, browse them with gestures, and rotate them as
your wallpaper.

**Versions:** app **1.9.27** (versionCode 18) · backend **1.9.28**.
They move independently - the backend version changes when the API changes, the app
version when the APK changes.

## What it does

- **Generate** from a prompt: 7 style presets, a negative-prompt field, three size
  presets, a seed (same seed + prompt = same image), cancel button with elapsed
  timer, recent prompts, favourite prompts, and a *Surprise me* dice with 20
  curated ideas.
- **Engines** - Pollinations (free, no key), Google Gemini, Hugging Face, Replicate
  (paid). The last three use **your own** keys, stored on the phone only and sent
  per request; unavailable engines are greyed out. If a paid engine fails, the
  backend falls back to the free one and the app says so on the result card.
- **Gallery** - lazy grid, upload from the device, delete, full-screen viewer with
  swipe between images, pinch-zoom, pan, double-tap and hold-to-save.
- **Wallpaper** - save to the phone gallery **or a folder on the SD card**, set as
  wallpaper (Android), shuffle now / shuffle on app open, opt-in daily
  auto-wallpaper, and a slideshow screen.
- **Offline** - the newest ~60 wallpapers are cached on the phone and the gallery
  list is stored, so the app still opens with no connection. Generations that fail
  because the backend is unreachable can be queued and run later.
- **Access key** - optional shared secret (`FROGPAPER_ACCESS_KEY`). Image URLs also
  accept it as `?key=...` because `<Image>` and `File.downloadFileAsync` cannot send
  headers.

## Repository layout

```
FrogPaperMobile/
|-- backend/                          Flask API (port 5000)
|   |-- app.py                        Routes, validation, JSON errors, access key
|   |-- services/
|   |   |-- image_generation.py       Providers + prompt building + subject variety
|   |   `-- storage.py                Local dir / mounted dir / S3-compatible storage
|   |-- scripts/backup_gallery.py     Mirror a running server's gallery to this PC
|   |-- tests/                        Plain-python test scripts (see Tests below)
|   `-- requirements.txt
|-- mobile-app/                       Expo app (SDK 57, RN 0.86)
|   |-- App.js, app.json              Entry + app config (icon, permissions, version)
|   |-- assets/                       Icons, splash art, mascot (+ assets/source)
|   |-- scripts/                      Icon + splash generators, check-offline/sentry
|   `-- src/
|       |-- screens/                  Home, Generate, Gallery, Detail, Slideshow, Settings
|       |-- components/               WallpaperImage (remote -> cached -> placeholder)
|       |-- services/                 api, imageCache, galleryCache, generationQueue,
|       |                             saveTarget (gallery/SD card), deviceMedia, shuffle,
|       |                             dailyWallpaper, sentry
|       `-- theme.js                  Dark theme tokens (frog-green accent)
`-- docs/                             This folder: status, API, storage, BYOK, cloud
```

## Running it

### Backend

```powershell
cd C:\FrogPaperMobile\backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python app.py                # http://127.0.0.1:5000, also reachable on the LAN
```

### App (development)

```powershell
cd C:\FrogPaperMobile\mobile-app
npm install
npx expo start --web                  # web test at http://localhost:8081
npx expo export --platform web        # bundle check used throughout this project
```

### Release APK for the phone

```powershell
$env:ANDROID_HOME = 'C:\Users\alive\AppData\Local\Android\Sdk'   # required, or Gradle
                                                                     # says "SDK location not found"
cd C:\FrogPaperMobile\mobile-app\android
.\gradlew.bat assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

The APK is written to `mobile-app\android\app\build\outputs\apk\release\app-release.apk`.
If the launcher still shows an older icon after reinstalling, remove and re-add the
home-screen shortcut - Android caches launcher icons aggressively.

## Where wallpapers live

| Where | What is there | Notes |
|-------|---------------|-------|
| Server gallery (`backend/static/images`, or your bucket when S3 is configured) | the list the app shows | on Render this is **ephemeral** - a deploy or restart wipes it |
| Phone - app cache | newest ~60 images | internal storage, bounded, invisible to the gallery app |
| Phone - photo gallery or SD-card folder | whatever you tap *Save to device* on | destination chosen in Settings -> Save location |
| PC - `C:\FrogPaperBackups` | manual backups | `backend/scripts/backup_gallery.py` mirrors a running server |

Generated wallpapers are deliberately **not committed to git**: the repository is
public and they are personal images.

## Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | backend port | `5000` |
| `FROGPAPER_ACCESS_KEY` | optional shared secret; when set, every `/api/*` call needs it | unset (open) |
| `FROGPAPER_IMAGES_DIR` | gallery directory (e.g. a mounted Render disk) | `backend/static/images` |
| `FROGPAPER_S3_*` | S3-compatible storage (Cloudflare R2 / AWS S3 / MinIO) | unset (local disk) |

Full details for the storage modes are in `docs/STORAGE.md`. The app resolves the
backend automatically (Expo dev host, or LAN IP / emulator alias) and can also be
pointed at any URL in Settings -> Custom server address.

## Tests

Plain Python and Node scripts - no pytest, no test runner to install.

| Command | What it covers |
|---------|----------------|
| `python backend/tests/test_provider_chain.py` | provider wiring + fallbacks (17 checks) |
| `python backend/tests/test_wallpaper_fit.py` | tall-wallpaper geometry (14 checks, live render opt-in) |
| `python backend/tests/test_storage.py` | storage layer, routes, S3 via a fake bucket (131 checks) |
| `python backend/tests/test_subject_enhancer.py` | prompt building + frog/breed variety (98 checks) |
| `npm run check:offline` (in `mobile-app/`) | offline cache + generation queue (29 checks) |
| `npm run check:sentry` (in `mobile-app/`) | Sentry configuration check |

The first two scripts talk to the *running* server paths; they need
`backend/access_key.txt` moved aside temporarily, because they do not send the key.

## Verified (2026-09-13)

| Check | Result |
|-------|--------|
| Release APK builds and installs (S9, Android 10) | PASS - 1.9.27 / versionCode 18 |
| Access key gate | PASS - `/api/gallery` 401 without the key, 200 with it; `/api/images/<f>?key=...` 200 |
| Offline gallery (airplane mode) | PASS - cached list + images, "Offline - showing wallpapers saved on this phone" |
| Offline queue | PASS - generation queued offline and run when the connection returned |
| SD-card saving | PASS - wallpapers written to the chosen SD-card folder |
| Backend storage layer | PASS - 131 checks including an S3-compatible bucket run |
| Prompt variety for frogs | PASS - 17 frog + 5 toad breeds, verified across live generations |

## Troubleshooting

**The engine list is empty** - the phone has no internet. The app now says
"No internet connection" and offers Retry; check Wi-Fi or airplane mode.

**"Backend offline"** - the backend isn't running (or isn't reachable). Locally:
start `python app.py` and check `http://127.0.0.1:5000/api/health`. On the LAN:
confirm the phone is on the same Wi-Fi and that Windows Firewall allows Python on
private networks; the manifest enables cleartext HTTP for local backends.

**Generation returns odd or incoherent images** - the free Pollinations model is the
weak one, especially with unusual subjects. Switching to Hugging Face (your own free
token) gives noticeably better results.

**Generation returns HTTP 502** - Pollinations rate-limits or times out; the backend
retries with backoff, try again shortly.

## Documentation

- `docs/START_HERE_TOMORROW.md` - current state, build cheat sheet, to-dos
- `docs/BACKEND_COMPLETE.md` - API reference
- `docs/STORAGE.md` - local / mounted-dir / S3-compatible storage
- `docs/BYOK_USER_API_KEYS.md` - bringing your own API keys
- `docs/CLOUD_DEPLOY.md`, `docs/CLOUD_PERSISTENCE.md`, `docs/DEV_BUILD.md`
- `docs/PLAN_STATUS.md` - the project against the original conversion plan
