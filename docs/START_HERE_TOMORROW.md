# START HERE NEXT TIME

Last updated: **2026-09-13, end of night** (this file replaces earlier notes; older
versions are in the git history).

## Where things stand

- **App 1.9.39** (versionCode 29) installed on the Galaxy S9.
- **Backend 1.9.28** live on Render (auto-deploys on push to `main`).
- **353 app checks + 295 backend checks** passing; everything committed and pushed.
- The owner's gallery now reads from **the phone**, so server wipes no longer matter.

## What shipped today (in order)

1. **Restored three features** wiped by commit `3965c0a`: Surprise-me dice + 20
   prompts, prompt favourites, daily auto-wallpaper.
2. **Honest fallback notice** when a paid engine failed and the free one was used.
3. **Access key armed** (server + app); `/api/images/*` also accepts `?key=***`.
4. **Offline support**: cached gallery list + cached images, and a queue for
   generations that fail while the backend is unreachable.
5. **Pluggable backend storage** (local dir / mounted dir / S3-compatible) - built
   but not configured, since everything has to stay free.
6. **New look**: frog mascot as the app icon and launch screen, mascot on Home,
   Settings button contrast fixed (was ~1.1:1, now 12.9:1).
7. **Save to SD card** via Android's folder picker.
8. **Generate screen rebuilt**: pinned action bar, prompt lists below, clear
   "No internet connection" + Retry.
9. **Frog variety in the backend**: 17 frog + 5 toad breeds, deterministic per seed.
10. **Git history purged** of wallpapers and old screenshots (the repo is public).
11. **Engine choice persists** across screens and restarts, with an honest note if a
    saved engine is unavailable.
12. **Generated images open full-screen** with Set as wallpaper / Save / Generate
    again; the result card gained Set as wallpaper too.
13. **Build screen stage 1**: dropdown prompt builder from the desktop lists.
14. **Build screen stage 2**: modes use the desktop's real per-mode wording, and each
    mode's negative list fills the Avoid field.
15. **Build screen stage 3**: recipes with rollable variable slots, and quick
    negative presets in Avoid.
16. **Wallpaper rotation merged** into one control (Off / Every open / Once a day +
    source), migrating the old daily + shuffle settings.
17. **The phone is now a gallery source**: local store, SD-folder import, local-aware
    delete/detail/rotation, and the server list as the other option.

## Verified on the device

- Installs and runs; new icon + launch screen; no crash
- Access key gate: 401 without, 200 with; `/api/images/<f>?key=***` 200
- Airplane mode: offline gallery + queue + "No internet" messaging
- SD-card save; importing 8 wallpapers into the phone gallery
- Frog variety across live generations (yellow dart frog, bullfrog, mossy frog...)
- Engine choice surviving a full restart
- Recipe roll rendering "A mysterious ocean landscape in cinematic style..."
- Quick-negative chip appending its terms with an "Added" confirmation

## Open - not built

1. **Release prep + first GitHub Release** - see *Sharing the app* below.
2. **Crash log** (JS-only error history in Settings -> Diagnostics). Approved, small
   (~20 min), not started. Catches JS errors, not native crashes.
3. **Keyword bank** from the desktop (`keywords.json`: 49 subjects, 27 styles,
   26 moods, 27 atmospheres...) - bigger subsystem, deliberately deferred.
4. **Gallery organisation** (tags/favourites).
5. **Gemini key**: retry after the quota resets; Hugging Face is the daily engine.
6. Docs: the README/plans are current as of tonight; the desktop's own docs are not
   this project's concern.

## Decided against - do not build

- Style transfer / image filters - never.
- Text overlay on images - never.
- Store release (Play / App Store) - no store fees; distribution is a direct APK.
- Paid services of any kind - free options only.
- The app syncing anything to the PC - phone and server only.

## Sharing the app - the plan (agreed 2026-09-13)

Distribution is **GitHub Releases**, not a store (no fees, no listing). The repo
already has zero tags and zero releases, so the first one starts clean.

When the owner says "cut a release":

1. Bump the version in `mobile-app/app.json`, `mobile-app/android/app/build.gradle`
   and the Settings About string; run every `check:*` suite; build the release APK.
2. Tag the commit (`v<version>`) and push the tag.
3. GitHub -> repo -> **Releases -> Draft a new release**: pick the tag, title
   `FrogPaper Mobile <version>`, attach `app-release.apk`, publish.
   Stable link afterwards: `https://github.com/sunnyskyess420/frogpaper-mobile/releases/latest`
4. Release notes should carry: what's new, **Android 7.0+**, the
   allow-unknown-apps install steps, the file checksum, and the honest backend
   caveat (generation needs a backend).

**Settled already:** the APK can be offered on the owner's website by linking to
the release; friends can install it directly. `C:\FrogPaperBackups\SEND-TO-A-FRIEND.txt`
already contains hand-off instructions (and `FrogPaper-1.9.39.apk` sits next to it).

**To decide / do before strangers install it:**

- **Signing** - the APK is signed with this PC's *debug* keystore. Fine for friends
  and for updates built here, but a proper release keystore is safer for public
  distribution, and it must be backed up: lose it and nobody can update over an
  existing install (they would have to uninstall first).
- **Backend for other people** - everyone needs one to generate. Pointing them all
  at the current Render server means free-tier rate limits and handing out the
  access key as a shared secret. The cleaner model is bring-your-own-keys (already
  supported) or each user running their own backend.
- **In-app update check** - the app can read
  `https://api.github.com/repos/sunnyskyess420/frogpaper-mobile/releases/latest`
  (public, no auth) and offer "version X is out - tap to download". That restores
  the auto-update a store would have given.
- **Download page** - optional: a small page on the owner's site with the version,
  install steps and a Download button pointing at the release link.

## Where everything lives

- Project: `C:\FrogPaperMobile` · APK: `mobile-app\android\app\build\outputs\apk\release\app-release.apk`
- Phone gallery: the app's own document directory (persists; see Settings -> Wallpaper)
- Server gallery: ephemeral by design
- PC backups: `C:\FrogPaperBackups` (wallpapers + a pre-purge repo bundle)
- Desktop FrogPaper (reference for ports): `E:\FROGPAPER\FROGPAPER 1.5.0`

## Build + install cheat sheet

```powershell
$env:ANDROID_HOME = 'C:\Users\alive\AppData\Local\Android\Sdk'   # required for Gradle
cd C:\FrogPaperMobile\mobile-app\android
.\gradlew.bat assembleRelease          # ~1 min for JS-only changes
adb install -r app\build\outputs\apk\release\app-release.apk
```

- `app.json` changed -> mirror `versionCode` / `versionName` in
  `mobile-app\android\app\build.gradle` (fast), or re-run `npx expo prebuild` (~12 min)
  and re-apply the icon/splash scripts in `mobile-app/scripts/`.
- Bundle check: `cd mobile-app` then `npx expo export --platform web`.
- Backend-only changes need no APK: push and Render redeploys.
- Icon changed but the phone shows the old one? Remove and re-add the shortcut.
- All `check:*` suites are plain node: `npm run check:recipes` etc.

## Working with the owner

- Short questions work best; say "too much" if it gets overwhelming.
- Never paste keys or tokens in chat - first four characters only.
- **Any test generation must use the free Pollinations engine.** Replicate is paid
  per image; Hugging Face and Gemini spend the owner's own quota.
- Replicate is the only paid engine: the key stays on the phone, so simply don't
  choose that chip unless you mean to pay.
- The owner does the phone-side taps; I do the code, builds and verification.
