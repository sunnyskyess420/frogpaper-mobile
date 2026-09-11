# FrogPaper Mobile

AI wallpaper studio for Android. Describe anything - frogs, castles, galaxies,
your cat as a knight - and FrogPaper paints it at wallpaper resolution, saves
it to your gallery and can set it as your phone wallpaper in one tap.

The heavy lifting happens in the cloud, so the phone works even when your PC
is powered off.

```
+------------------+        HTTPS         +--------------------+       HTTPS       +------------------+
|  Android app     |  <-----------------> |  Flask backend     | <---------------> |  pollinations.ai |
|  (Expo / RN)     |   /api/* JSON        |  on Render.com     |   image prompt    |  Flux model      |
|  APK install     |                      |  frogpaper-mobile  |   <--- jpeg ---   |  (free, no key)  |
+------------------+                      +--------------------+                   +------------------+
```

- **Backend (cloud)**: https://frogpaper-mobile.onrender.com - free Render
  instance. It sleeps after ~15 minutes of quiet and wakes in a few seconds on
  the next request; the app probes patiently, so the first tap after a break
  just takes a little longer.
- **Backend (optional, PC)**: the same Flask app in `backend/` runs fine on any
  computer (`python app.py`, port 5000). Useful for development or offline use.

## What the app can do (v1.9.16)

**Generate screen**
- Prompt box with 4 size presets (phone portrait 1080x1920, landscape,
  square, wide) and optional negative prompt + seed controls
- **12 style engines**: Natural, Vivid, Dark fantasy, Minimalist, Oil painting,
  Anime, Watercolor, Pixel art, 3D render, Synthwave, Low poly
- **Surprise me** dice: rolls a random curated idea (20 prompts, frogs and
  non-frogs mixed), never repeating the prompt currently in the box
- **Prompt favorites**: tap the star to save a prompt (up to 12), tap a chip
  to reuse it, X to delete - favorites survive app restarts
- Cancel button and a 180-second ceiling so slow peak-hour cloud queues
  cannot hang the app

**Any subject, not just frogs**
The AI paints whatever the prompt describes. Frogs are the mascot and fill a
good share of the curated idea list, but the backend detects the subject and
only adds matching quality cues: frogs get frog touches, common animals
(cat, dog, owl, dragon and more) get an animal booster, and everything else
passes through untouched with a neutral quality suffix. Subject words are
matched with word boundaries, so "gothic cathedral" is never cat-ified.

**Home screen**
- Live backend status (checking / online / offline) with the cloud version
- **Daily wallpaper card**: if enabled in Settings, the first time you open
  FrogPaper each day it quietly generates a fresh wallpaper (surprise idea or
  one of your starred favorites), saves it to the gallery and sets it as the
  wallpaper. If an attempt fails it waits 2 hours before auto-retrying, and
  Try now / Another buttons let you force a new one any time. Deliberately no
  background scheduler - it only runs while the app is open, so Samsung
  battery management cannot kill it and it costs zero battery.

**Gallery + Detail**
- Every generation is kept in the backend gallery and shown with real
  dimensions and the prompt used
- Save any image to the device gallery (photo permission requested once)

**Settings**
- Custom server address with one-time Save (auto-fixes missing `https://`,
  trailing slashes and stray punctuation; strips accidental `/api/health`
  suffixes) plus a Clear button
- Daily wallpaper toggle + idea source (Surprise me / My favorites)
- AI provider status and app/backend version info

## Install on your phone

1. Get the newest `FrogPaper-v1.9.16.apk` and copy it to the phone.
2. Tap it; allow "install from this source" if Android asks. Installing over
   an older FrogPaper keeps your saved address, favorites and settings.
3. Open FrogPaper. Check **Settings > About** shows `FrogPaper Mobile 1.9.16`.
4. In **Settings**, enter `frogpaper-mobile.onrender.com` as the server
   address and tap **Save URL** - one time only, it is remembered. The Home
   dot turns green when the cloud answers.
5. Generate something. Wait out the green dot if the cloud was asleep.

## Version history

| Version | What changed |
|---------|--------------|
| 1.9.16 | Launch-crash fix: `useFocusEffect` import missing in HomeScreen (v1.9.15 died on open); new missing-import scanner added to the pre-build checks |
| 1.9.15 | 5 new style engines (12 total), daily auto-wallpaper, subject boosters for cat/dog/owl/dragon, word-boundary matching fix, 180 s generate timeout |
| 1.9.14 | Surprise me dice, prompt favorites (star/chips), backend version sync |
| 1.9.13 | Readable Save/Clear buttons, smarter address sanitizer and hint |
| 1.9.12 | Custom server URL saved on the phone, patient cloud wake-up probing, working Cancel button - first fully cloud build |
| <1.9.11 | PC/LAN-only era: app needed the PC backend on the same Wi-Fi |

## Repository structure

```
frogpaper-mobile/
|-- backend/                  Flask API (Render deploy + local dev)
|   |-- app.py                Routes, JSON errors, CORS, health endpoint
|   |-- services/
|   |   `-- image_generation.py   Pollinations provider + subject boosters
|   |-- static/images/        Generated wallpapers (cloud: ephemeral)
|   `-- requirements.txt
|-- mobile-app/               Expo app (SDK 57, RN 0.86, Hermes)
|   |-- app.json              Version + versionCode live here
|   `-- src/
|       |-- screens/          Home, Generate, Gallery, Detail, Settings
|       |-- services/
|       |   |-- api.js        URL resolution, patient probing, generate()
|       |   |-- dailyWallpaper.js Daily logic (phases, cooldown, run)
|       |   |-- promptLibrary.js  Shared idea list + favorites key
|       |   `-- deviceMedia.*.js  Save-to-gallery + wallpaper per platform
|       `-- theme.js          Dark theme tokens (frog-green accent)
`-- docs/                     API reference and handover notes
```

## Building the APK

```bash
cd mobile-app
npm install
eas build --platform android --profile preview      # needs an Expo token
```

Pre-delivery checks used for every release:

```bash
npx esbuild --loader:.js=jsx src/screens/File.js --outfile=/dev/null   # syntax
python3 ../scripts/scan_undef.py src/screens/*.js src/services/*.js    # missing imports
python3 ../scripts/verify_bundle.py FrogPaper-vX.Y.Z.apk               # 21 markers
```

`scan_undef.py` exists because v1.9.15 shipped a missing hook import that
syntax checks cannot see and that crashed the app on launch.

## Troubleshooting

**Green dot takes a while** - the free cloud tier sleeps; the first request
wakes it (a few seconds, occasionally longer at peak). Later requests are fast.

**HTTP 404 on connect** - check the saved address letter by letter: it must be
`frogpaper-mobile.onrender.com` (not `frogpaper-website...`). Tap Clear, type
it again, Save.

**Generation fails or times out** - Pollinations is a free community service
and rate-limits at busy times. The backend retries with backoff; wait a minute
and try again. Daily wallpaper attempts enter a 2-hour cooldown after a
failure and retry on the next app open.

**Wallpaper "Try now" says it needs a development build** - direct wallpaper
setting uses a native module that ships inside the release APK; inside Expo Go
it degrades gracefully with a save-to-gallery fallback instead.

## Documentation

- `docs/BACKEND_COMPLETE.md` - full API reference with examples
- `docs/HANDOVER_2026-09-10.md` - original rebuild and test notes
