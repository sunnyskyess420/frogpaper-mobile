# START HERE NEXT TIME

Last updated: **2026-10-18** (this file replaces earlier notes; older
versions are in the git history).

## Where things stand

- **App 1.12.0** (versionCode 51) built and released; 1.11.1 is what is installed
  on the Galaxy S9 until the new APK is sideloaded. The five UX fixes from the
  2026-10-18 sweep (locked-engine BYOK sheet, honest cooldown + last-change
  record, Detail "Made with" row, bottom tabs, one-time update prompt) are
  committed on top of 1.12.0 and pending the next release.
- **Backend 1.9.45** live on Render (auto-deploys on push to `main`); the new
  prompt-slug filenames take effect on the next deploy / local run.
- **693 app checks across 15 suites** passing (rotation 64, engine 64,
  update 35, theme 16, versions 6); only `check:sentry` is skipped, because
  no Sentry DSN is configured, and `check:versions` needs the generated
  `android/` directory.
  Everything through the five UX fixes is pushed to `main` (local commits
  ahead of `origin/main`).
- The owner's gallery reads from **the phone**, so server wipes no longer matter.

## What shipped in the 2026-10-18 UX sweep (in commit order)

1. **Generate: tapping a locked engine explains how to add a key.** A greyed
   engine chip on Generate now opens the BYOK help sheet instead of
   swallowing the tap; the sheet gains an "Open Settings" button that lands
   on Settings with the Optional AI keys card already expanded. A short
   hint under the chips names the behaviour.
2. **Rotation: honest cooldown time and a persistent last-change record.**
   Home now says "Retrying after 3:40 PM" (a real local time) on a failed
   or cooldown card instead of the misleading "next time you open the app".
   Every attempted outcome is persisted under
   `@frogpaper/rotation_last_change` (at, ok, source, engine, message), so
   Settings > Wallpaper gains a "Last automatic change" row that survives a
   restart and names the engine when the source was a generated wallpaper.
3. **Detail: show which engine made an image.** A new `providerInfo.js`
   module turns the `<id>_` prefix in a generated filename back into a
   label; Detail shows "Made with: Hugging Face" / "Pollinations" / etc.
   right after Source. Older imports (IMG_1234.jpg) simply omit the row.
   The labels moved out of `ProviderFallbackNotice.js` into `providerInfo`
   so the Generate fallback notice, Detail, and Settings' last-change row
   share one source of truth.
4. **Navigation: bottom tabs for the four daily destinations.**
   `@react-navigation/bottom-tabs` ^7.21.0 is now installed. The four daily
   screens (Home, Generate, Gallery, Settings) live in a bottom tab bar;
   Build, Detail, Slideshow, History push on top of the tabs so Back returns
   to whichever tab the user came from. Tab icons are plain Unicode glyphs
   (house, palette, picture frame, gear) - no second icon dependency. Every
   tab has a `tabBarAccessibilityLabel`.
5. **Home: a one-time update prompt per release version.** A new pure helper
   `shouldPromptUpdate(record, dismissedVersion)` decides when to show a
   modal: update + the latest version differs from the dismissed one. The
   dismissed version is stored under `@frogpaper/update_prompt_dismissed`,
   so the same release prompts once and a newer release later re-prompts.
   "Get update" is the only path that opens the browser; "Later" just
   dismisses. Never shown during the welcome walkthrough, or for current /
   offline / no-releases states.

## What shipped in 1.11.2 (2026-10-15)

Automatic wallpapers use the engine saved on the Generate screen (Hugging
Face, Gemini, Replicate or Pollinations) instead of always using the free
default. With no engine ever saved, a fresh install behaves exactly as
before. If the saved engine is gone or the backend paints a fallback
image, the run is skipped and the normal 2-hour cooldown applies.

## What shipped in 1.10.0 (2026-09-27)

Starred pictures, gallery search/sort/favourites with remembered prefs, a
long-press action sheet, 5-second undo, share, bulk select, cached thumbnails,
prompt history (built from the phone's own gallery), an engine-status panel, a
storage view + clear cache, Home/Lock/Both, a "New wallpaper now" button, a
first-run long-press tip, and backend prompt-slug filenames. Full detail:
`docs/RELEASE_NOTES-v1.10.0.md`.

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

1. **Device check of the automatic-engine fix** - sideload 1.11.2 on the S9,
   pick Hugging Face, then let a daily rotation run and confirm the result came
   from that engine.
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

## Release signing (done 2026-09-15)

Release builds are signed with FrogPaper's own key, not the debug key. Created on this
PC; nothing about it is in the repository.

| Where | What |
|---|---|
| `C:\FrogPaperBackups\keys\frogpaper-release.keystore` | the key itself (keep this folder) |
| `C:\FrogPaperBackups\keys\READ-ME-FIRST.txt` | the password, and what losing it means |
| `mobile-app/android/keystore.properties` | how the build finds it (android/ is gitignored) |
| `mobile-app/android/app/frogpaper-release.keystore` | the working copy the build signs with |

Signature of the release APK (check with `apksigner verify --print-certs`):

    CN=FrogPaper, OU=Mobile, O=FrogPaper, L=Edmonton, ST=Alberta, C=CA
    SHA-256: f59a1728b2c14921358137277d596125845b0a83f7e45aaf9c54137307bc0644

**The rule: never lose the backup folder.** If the key is lost, the app can never be
updated for anyone who already installed it - they would have to uninstall and install
again. Keep a second copy somewhere offline.

Building a signed release is unchanged:

    cd mobile-app\android
    $env:ANDROID_HOME='C:\Users\alive\AppData\Local\Android\Sdk'
    .\gradlew.bat assembleRelease

With no `keystore.properties` (a fresh clone, another machine) the build falls back to
the debug key and still succeeds.

**One consequence to remember:** switching from the old debug-signed installs to this
key means Android sees a different app. Every existing install - including the owner's
phone - must be uninstalled and installed again. Save anything worth keeping to the
phone gallery first; the SD-folder import can bring them back afterwards.

## Sharing the app

Distribution is **GitHub Releases**, not a store (no fees, no listing). Releases
through **v1.11.2** are published, each with the signed
`FrogPaper-release-signed.apk` attached; the stable link is
`https://github.com/sunnyskyess420/frogpaper-mobile/releases/latest`.

The landing page offers the same link in its Android section:
`https://sunnyskyess420.github.io/frogpaper-website/`, and `downloads.html`
reads download counts from the public releases API.

When cutting a release:

1. Bump `mobile-app/app.json` (`version`, `android.versionCode`) and
   `mobile-app/android/app/build.gradle` (`versionName`, `versionCode`); run
   every runnable `check:*` suite.
2. Build the signed APK (below) and verify with `apksigner verify --print-certs`
   that it still carries `CN=FrogPaper` / SHA-256
   `f59a1728b2c14921358137277d596125845b0a83f7e45aaf9c54137307bc0644`.
3. Commit + push `main`, tag `v<version>`, then publish with
   `gh release create v<version> --notes-file docs/RELEASE_NOTES-v<version>.md`
   and attach the APK as **FrogPaper-release-signed.apk**. The asset name
   matters: the website and the app update check both assume it.
4. Release notes carry: what is new, **Android 7.0+**, the allow-unknown-apps
   install steps, the APK SHA-256, and the backend caveat (generation needs a
   reachable backend).

The in-app update check is built (Settings -> About, manual button) and reads
the same public releases API. There is no release automation in `.github` - a
release is the four steps above.

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
