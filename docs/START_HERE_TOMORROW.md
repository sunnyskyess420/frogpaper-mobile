# START HERE NEXT TIME

Last updated: **2026-09-13, end of day** (this file replaces the stacked updates
from earlier sessions; older notes are in the git history).

## Where things stand

- **App 1.9.27** (versionCode 18) is installed on the Galaxy S9.
- **Backend 1.9.28** is live at `https://frogpaper-mobile.onrender.com` (auto-deploys
  on push to `main`).
- Everything is committed and pushed. The server's gallery is intentionally empty
  right now - wallpapers are personal images and are no longer committed to git
  (this repository is public).

## What shipped on 2026-09-13

1. **Restored three features** that commit `3965c0a` had wiped: Surprise-me dice +
   20 curated prompts, prompt favourites, and the daily auto-wallpaper.
2. **Honest fallback notice** on the result card when a paid engine fails and the
   free one is used.
3. **Access key armed** on Render (and in app Settings). `/api/images/*` also accepts
   `?key=...`, because image tags and file downloads cannot send headers.
4. **Offline support**: cached gallery list + cached images, and a queue for
   generations that fail while the backend is unreachable.
5. **Pluggable storage** in the backend: local disk, a custom directory, or any
   S3-compatible bucket (Cloudflare R2 / AWS S3). Not configured - everything is free.
6. **New look**: the frog mascot is the app icon and the launch screen (no more
   stretched pale square), Home shows the mascot instead of the "FP" tile, and the
   Settings buttons were fixed (they were near-black on near-black).
7. **Save to SD card** via Android's folder picker (Settings -> Save location).
8. **Generate screen rebuilt** so the button sits right after the inputs and the
   long "Need inspiration?" list is collapsed below it.
9. **Clear "No internet connection" + Retry** instead of an empty engine list.
10. **Frog variety in the backend**: 17 frog + 5 toad breeds, picked per generation
    (deterministic when a seed is given), instead of one fixed tree-frog phrase.
11. **Git history purged** of the wallpapers and old screenshots (the repo is public).

## Verified on the device

- App installs and runs (1.9.27), no launch crash, new icon + launch screen
- Gallery loads with the access key; offline it shows the saved copies
- Airplane mode: the offline gallery works and the engine area explains the problem
- Generation queue: a generation made offline ran when the connection returned
- Saving to the SD card works
- Button contrast measured on screen: 12.9:1 (was ~1.1:1)

## Open / not finished

- **Crash reporting**: the standard tool (Sentry) cannot be enabled - its Android
  plugin is incompatible with the Gradle version this project builds with. Plan:
  a small built-in error log shown in Settings -> Diagnostics. Not built yet.
- **Settings screen tidy-up**: the owner finds it unfriendly. Waiting on what
  specifically bothers them before changing it.
- **Frog pool rebalance** (optional): the free model occasionally mangles the more
  obscure breeds (golden toad, glass frog, flying frog); the pool could be trimmed
  toward reliably-rendered frogs.
- **Gemini key**: was quota-blocked; Hugging Face is the daily driver.

## Where everything lives

- Project: `C:\FrogPaperMobile`
- APK: `C:\FrogPaperMobile\mobile-app\android\app\build\outputs\apk\release\app-release.apk`
- Backups on this PC: `C:\FrogPaperBackups` (wallpapers + a pre-purge repo bundle)
- Keys: on the phone only. The server's access key is `backend\access_key.txt` (gitignored).

## Build + install cheat sheet

```powershell
$env:ANDROID_HOME = 'C:\Users\alive\AppData\Local\Android\Sdk'   # required for Gradle
cd C:\FrogPaperMobile\mobile-app\android
.\gradlew.bat assembleRelease          # ~1-2 min for JS-only changes
adb install -r app\build\outputs\apk\release\app-release.apk
```

- `app.json` changed → mirror `versionCode` / `versionName` in
  `mobile-app\android\app\build.gradle` (fast), or re-run `npx expo prebuild` (~12 min,
  and re-apply the icon/splash scripts in `mobile-app/scripts/` if you do).
- Bundle check: `cd mobile-app` then `npx expo export --platform web`.
- Backend-only changes need no APK: push and Render redeploys.
- Icons changed but the phone still shows the old one? Remove and re-add the
  home-screen shortcut.

## To-do (priority order)

1. Crash reporting (built-in error log) - planned, not built.
2. Settings tidy-up - needs one sentence from the owner about what is unfriendly.
3. Optional: rebalance the frog pool toward reliably-rendered breeds.
4. Gemini: retry after the daily quota resets.

## Decided against - do not build these

- **Style transfer / image filters** - never.
- **Text overlay on images** - never.
- **Store release (Play / App Store)** - no store fees. Distribution is a direct APK.
- **Paid services of any kind** - free options only.
- **The app syncing anything to the PC** - the phone and the server only.

## Working with me (the owner)

- Short questions work best; say "too much" if it gets overwhelming.
- Never paste keys or tokens here - first four characters only.
- Replicate is the only paid engine (~2.5c per wallpaper): the key is saved on the
  phone, so just don't pick that chip unless you mean to pay.
- The owner does the phone-side taps; I do the code, the builds and the verification.
