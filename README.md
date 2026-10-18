# FrogPaper Mobile

AI wallpaper studio for Android. Generate phone wallpapers from a text prompt or
build them from dropdowns, keep them on the phone where they cannot be lost, and
rotate them as your wallpaper.

**Versions:** app **1.12.0** (versionCode 51) · backend **1.9.45**.
They move independently - the backend version changes when the API changes, the
app version when the APK changes.

**Download:** [latest Android release](https://github.com/sunnyskyess420/frogpaper-mobile/releases/latest)
· [landing page](https://sunnyskyess420.github.io/frogpaper-website/)

## What it does

### New in 1.12.0

- **Automatic wallpapers use your engine** - "Once a day" / "Every time I open"
  with "Surprise me" now generate through the engine saved on the Generate
  screen (Hugging Face, Gemini, Replicate or Pollinations) instead of always
  using the free default. With no engine ever saved, a fresh install behaves
  exactly as before.
- **No silent Pollinations downgrade** - if the saved engine is gone, its key
  was removed, or the backend paints a fallback image, the automatic run is
  skipped: the current wallpaper stays, the run is reported as a failure, and
  the normal 2-hour cooldown applies.
- **11 new rotation checks** cover the saved-engine request, the rejected
  fallback (nothing saved or set) and the skipped generation when an engine is
  unavailable.

### New in 1.11.1

- **Type your own value in any Build-screen option** - every row's picker
  (mode, subject, setting, style, lighting, colour, mood, atmosphere, and
  recipe slots) now has a text field at the top: type anything, tap **Use**,
  and it lands in the prompt exactly as typed. Values you typed show up
  selected, and opening the sheet again starts from your text so it can be
  edited. Built on the composer being selection-agnostic - five new builder
  checks pin the behaviour down.

### New in 1.11.0 - Halloween Edition

- **Halloween theme** - for this release the app wears its costume: pumpkin
  orange on a haunted purple night (buttons, notices, cards, every surface).
  The frog-green look is one line away (`EDITION` in `src/theme.js`); the next
  release flips it back.
- **Full file name on the image screen** - the detail view shows the complete
  file name, wrapped and selectable; gallery captions wrap to two lines.
- **Palette check** - `npm run check:theme` keeps both palettes
  interchangeable: same tokens, same contrast thresholds, no brand colours
  leaking into screens.

### New in 1.10.0

- **Star wallpapers** - a `★` button on an image and a `★` badge on gallery tiles.
  Rotation's "My favourites" now means your **starred pictures**, not prompts.
- **Search, sort & filter the gallery** - search by name **or prompt**, sort
  (newest / oldest / favourites first / A-Z), a favourites-only filter, and a
  name-vs-prompt caption toggle. Your sort and filter are remembered.
- **Long-press action sheet** - set wallpaper / star / save / share / delete from
  the grid, and **Delete is undoable for 5 seconds**.
- **Prompt history screen** - every prompt your wallpapers were made from, built
  from the phone's own gallery (so it works offline), with "Make again" / "Edit".
- **Share & bulk actions** - share an image through the system share sheet;
  multi-select to save or delete several at once.
- **Faster gallery** - cached 360px thumbnails plus list tuning.
- **Engine status** in Settings - which AI engines are ready right now.
- **Storage view & Clear cache** - gallery / thumbnails / cache sizes with a
  one-tap cache clear that never touches your wallpapers.
- **Searchable filenames** (backend) - generated files carry a prompt slug, e.g.
  `pollinations_20260927-1502_lily-pond-at-dawn.png`.
- **Home / Lock / Both** choice when setting a wallpaper (Android).
- **"New wallpaper now"** button and a first-run long-press tip.

- **Generate** from a prompt, or **build** one from dropdowns (see below). 7 size
  presets (inside *More options*), a seed (same seed + prompt = same image), a
  cancel button with elapsed timer, recent prompts, and a *Surprise me* dice with
  20 curated ideas. The primary action is pinned to the bottom of the screen, so
  it is always reachable.
- **Build screen** - assemble a prompt from the desktop app's own lists:
  10 **modes** (each with its real style/quality wording and its own negative
  list), 16 subjects, 23 styles, 19 lighting, 19 moods, 10 atmospheres, a free-text
  setting, **recipes** (templates with rollable variable slots) and **quick
  negative presets**. A live preview shows the sentence as it forms; *Use this
  prompt* hands the prompt (and the mode's negatives) to Generate.
- **Engines** - Pollinations (free, no key), Google Gemini, Hugging Face, Replicate
  (paid). The last three use **your own** keys, stored on the phone only. Your
  engine choice is remembered across restarts; if a saved engine stops being
  usable the app says so instead of silently switching. When a paid engine fails,
  the free one is used and the app tells you.
- **Gallery** - runs from **this phone** by default (your own images, immune to
  server wipes), with the server list available as the other source. Import the
  wallpapers you saved to an SD-card folder, upload from the device, delete, and a
  full-screen viewer with swipe, pinch-zoom, pan and double-tap.
- **When a generation finishes** the image opens full-screen by itself with
  *Set as wallpaper*, *Save to device* and *Generate again* (which re-runs the same
  prompt), plus Copy and Delete.
- **Wallpaper rotation** - one control: `Off` / `Every time I open` / `Once a day`,
  with the source `Surprise me` / `My favourites` / `Random from my gallery`.
  It only ever acts while the app is open, and a failed run backs off for 2 hours.
- **Access key** - optional shared secret (`FROGPAPER_ACCESS_KEY`). Image URLs also
  accept it as `?key=***` because `<Image>` and `File.downloadFileAsync` cannot send
  headers.

## Repository layout

```
FrogPaperMobile/
|-- backend/                          Flask API (port 5000)
|   |-- app.py                        Routes, validation, JSON errors, access key
|   |-- services/
|   |   |-- image_generation.py       Providers, prompt building, frog/breed variety
|   |   `-- storage.py                Local dir / mounted dir / S3-compatible storage
|   |-- scripts/backup_gallery.py     Mirror a running server's gallery to this PC
|   |-- tests/                        Plain-python test scripts (see Tests)
|   `-- requirements.txt
|-- mobile-app/                       Expo app (SDK 57, RN 0.86)
|   |-- src/data/                     Ported desktop data: promptModes, recipes,
|   |                                 negativePresets, promptOptions
|   |-- src/services/                 api, localGallery, gallerySource, galleryCache,
|   |                                 imageCache, generationQueue, saveTarget,
|   |                                 recipeComposer, negativePresets, promptComposer,
|   |                                 enginePreference, wallpaperRotation, shuffle,
|   |                                 dailyWallpaper, deviceMedia, nativeSave, sentry
|   |-- src/screens/                  Home, Generate, Gallery, Detail, Slideshow,
|   |                                 Settings, Build (PromptBuilder)
|   |-- src/components/               WallpaperImage, ProviderFallbackNotice
|   |-- scripts/                      check-* (node) + extract-desktop-* (python)
|   `-- assets/                       Icons, splash art, mascot (+ assets/source)
`-- docs/                             Status, API, storage, BYOK, cloud notes
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
| **Phone - the app's own store** (`<documentDirectory>/wallpapers/`) | the default gallery | persistent, survives every restart and every server deploy |
| Phone - your SD-card / photo folder | what you tap *Save to device* on, and what **Import from my SD folder** reads | destination chosen in Settings -> Wallpaper |
| Server gallery (`backend/static/images`, or your bucket when S3 is configured) | the optional "server" gallery source | on Render this is **ephemeral** - a deploy or restart wipes it |
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

Details in `docs/STORAGE.md`. The app resolves the backend automatically (Expo dev
host, or LAN IP / emulator alias) and can be pointed at any URL in
Settings -> Advanced.

## Tests

Plain Python and Node scripts - no pytest, no test runner to install.

| Command | What it covers |
|---------|----------------|
| `npm run check:local-gallery` (in `mobile-app/`) | phone gallery store, SD import bridge (36) |
| `npm run check:recipes` | recipes, variable slots, negative presets (117) |
| `npm run check:builder` | prompt builder, modes, composition (92) |
| `npm run check:engine` | engine preference persistence + provider info labels & filename prefixes (64) |
| `npm run check:rotation` | wallpaper rotation, cooldown retryAt, last-change record, legacy migration, saved engine (64) |
| `npm run check:offline` | offline cache + generation queue (29) |
| `npm run check:favorites` | starred pictures + remembered update answer (21) |
| `npm run check:update` | version compare, offline / no-releases states, one-time update prompt decision (35) |
| `npm run check:theme` | both palettes interchangeable, no brand colours leak (16) |
| `python backend/tests/test_filenames.py` | searchable filename slugs (17) |
| `python backend/tests/test_subject_enhancer.py` | prompt building + frog variety (98) |
| `python backend/tests/test_storage.py` | storage layer, routes, S3 via a fake bucket (131) |
| `python backend/tests/test_provider_chain.py` | provider wiring + fallbacks (17) |
| `python backend/tests/test_wallpaper_fit.py` | tall-wallpaper geometry (14) |

The two provider/wallpaper scripts talk to the *running* server paths and need
`backend/access_key.txt` moved aside temporarily (they do not send the key).

## Verified (2026-10-18)

| Check | Result |
|-------|--------|
| App checks (the `check:*` suites) | PASS - 15 suites, 693 checks (`check:sentry` still needs a Sentry DSN; `check:versions` needs a generated `android/` dir) |
| Backend checks (offline) | PASS - subject enhancer 98 + filenames 17 |
| Release APK builds and is release-key signed | PASS - 1.12.0 / versionCode 51 (`apksigner verify`) |
| Web bundle compiles (`npx expo export --platform web`) | PASS |
| Access key gate | PASS - `/api/gallery` 401 without the key, 200 with it |
| Offline gallery + generation queue | PASS - verified in airplane mode on the device |
| Phone gallery + SD import | PASS - imported 8 wallpapers from the owner's folder on the device |
| Frog variety | PASS - 17 frog + 5 toad breeds, different species across live generations |
| Engine choice persistence | PASS - survives screen changes and a full app restart |
| Automatic wallpaper engine | PASS - saved engine sent, fallback rejected, 64 + 64 rotation/engine checks |
| Locked-engine help + bottom tabs + update prompt | PASS - new in this revision (locked-engine BYOK sheet, 4-destination tab bar, one-time-per-version modal, Detail 'Made with' row, Settings 'Last automatic change' row) |

## Troubleshooting

**The gallery looked empty / "lost my images"** - before 1.9.39 the gallery was only
the server's list, and the server's storage is wiped by every deploy. The default
source is now **this phone**; switch sources in Settings -> Wallpaper -> Gallery
source, and pull older saves in with **Import from my SD folder**.

**The engine list is empty** - the phone has no internet. The app now says so and
offers Retry; check Wi-Fi or airplane mode.

**"Backend offline"** - the backend isn't running or isn't reachable. Locally start
`python app.py`. On the LAN make sure Windows Firewall allows Python on private
networks.

**Odd or incoherent generations** - the free Pollinations model is the weak one,
especially with unusual subjects; switching to Hugging Face gives noticeably better
results.

## Documentation

- `docs/START_HERE_TOMORROW.md` - current state, build cheat sheet, to-dos
- `docs/BACKEND_COMPLETE.md`, `docs/STORAGE.md`, `docs/BYOK_USER_API_KEYS.md`
- `docs/CLOUD_DEPLOY.md`, `docs/CLOUD_PERSISTENCE.md`, `docs/DEV_BUILD.md`
- `docs/PLAN_STATUS.md` - the project against the original conversion plan
