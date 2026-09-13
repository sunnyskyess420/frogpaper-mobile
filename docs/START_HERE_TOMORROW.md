# START HERE NEXT TIME

> **UPDATE 2026-09-13 (end of day)**
>
> - **The access key is armed and working.** `FROGPAPER_ACCESS_KEY` is set on Render and the
>   key is entered in app Settings on the S9. Verified from the PC: `/api/gallery` returns 401
>   without the key and 200 with it; the app loads all 12 wallpapers again.
> - `/api/images/*` also accepts `?key=***` (commit `fb056c0`) because `<Image>` and
>   `File.downloadFileAsync` cannot send headers. Without that, arming the key would have
>   broken every thumbnail, save-to-device and set-as-wallpaper action.
> - The masked key box **cannot** be filled over USB: Android blocks synthetic typing into
>   password fields. It has to be typed on the phone (or pasted by the user).
> - Phone test results for 1.9.18 (installed, versionCode 9): Surprise Me dice works, the Daily
>   wallpaper section is present, and the fallback notice appeared for real ("Gemini was
>   unavailable - used the free Pollinations engine"). Still untested on the phone: favorites
>   across restarts, save-to-device, set-as-wallpaper, the daily run itself.
> - Commits today: `fe8b7f0` (restore + fixes), `a0cec63` (docs), `fb056c0` (key fix).

---


## Where we left off (Sept 13, 2026)

Restored the features that commit `3965c0a` had silently deleted, plus two small fixes and a
version bump. Latest commit `5822bcb` (local only - not pushed yet). A fresh release APK is
built and build-verified, but NOT yet installed or tested on the phone.

## What changed today

1. Surprise Me dice + the 20 curated prompts are back (Generate screen).
2. Prompt favorites are back (star to save, tap a chip to reuse, X to delete, max 12).
3. Daily auto-wallpaper is back - opt-in and default OFF: first open of the day generates,
   saves and sets a wallpaper. Switch + source (Surprise / Favorites) live in Settings.
4. The result card now says when a paid engine fell back to the free Pollinations engine.
5. The in-app help no longer claims Gemini gives ~1,500 images/day (that is the text limit).
6. `api.js` now honours a per-call `timeoutMs`, so generation really gets 180s on slow queues.
7. Version 1.9.18 / versionCode 9 (app.json + the generated android/app/build.gradle).

Deliberately NOT restored: the 5 extra art engines (watercolor / pixel / 3D / synthwave /
low-poly). You said no. The 7 style presets are unchanged.

## Where everything lives

- Project folder: C:\FrogPaperMobile\
- APK: C:\FrogPaperMobile\mobile-app\android\app\build\outputs\apk\release\app-release.apk
  (78.4 MB, built 2026-09-13 11:59)
- Backend: https://frogpaper-mobile.onrender.com (live, auto-deploys on push)
- App version: 1.9.18 / versionCode 9
- API keys: stored ONLY on the phone.

## Install on the phone

1. Plug the phone in with USB debugging on.
2. `%ANDROID_HOME%\platform-tools\adb.exe install -r C:\FrogPaperMobile\mobile-app\android\app\build\outputs\apk\release\app-release.apk`
3. No uninstall needed (same package, higher versionCode).

## Build cheat sheet (updated)

- Set the SDK path first in a new terminal, or Gradle fails with "SDK location not found":
  `$env:ANDROID_HOME = 'C:\Users\alive\AppData\Local\Android\Sdk'`
- JS-only change (screens, api.js, services): `cd mobile-app\android` then `.\gradlew.bat assembleRelease` (~2 min)
- app.json changed: mirror versionCode/versionName in `mobile-app\android\app\build.gradle`
  (fast, what we did) or delete android\ and `npx expo prebuild --platform android` (~12 min)
- Web bundle check: `cd mobile-app` then `npx expo export --platform web`
- package.json changed: run `npm install` in mobile-app first

## Verified today

- Web bundle: `npx expo export --platform web` exit 0 (re-run independently by AutoCoder)
- Release build: `gradlew assembleRelease` exit 0; `aapt dump badging` reports
  versionCode 9 / versionName 1.9.18
- NOT verified: the new UI on a real device (Surprise Me, favorites, fallback banner,
  daily wallpaper).

## To-do (priority order)

1. Install the new APK and test: Surprise Me dice, favorites, daily-wallpaper switch,
   the fallback banner.
2. Arm the access key: Render -> Environment -> add `FROGPAPER_ACCESS_KEY` (use the value in
   `backend\access_key.txt`), then paste the same value into app Settings -> Access key.
   Right now the API answers anyone who knows the URL.
3. Gemini: retry after the daily quota reset (Hugging Face stays the daily driver).
4. Cloud images live on ephemeral storage - the 12 images vanish on the next redeploy.
   Needs S3/R2 or a Render disk.
5. Offline cache + queued generations.

The full list with A/B/C/D/E/F IDs is the checklist AutoCoder delivered on 2026-09-13.

## Reminders

- Memory trouble from age 7 is OK - ask "where are we?" any time
- SHORT questions work best; say "too much" if overwhelmed
- Never paste keys/tokens in chat - first 4 characters only
- Do NOT re-add a Replicate key unless you want to pay ~2.5 cents per wallpaper
- `docs\WHERE_WE_STAND_2026-09-13.md` was written by another session. It claims the Sept 12 APK
  definitely contains the gestures - nobody verified that. Keep or delete as you like.