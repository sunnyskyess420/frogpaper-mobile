# Plan Status - against the original 7-phase plan

Tracked against `docs/ORIGINAL_PROJECT_PLAN.md`. Updated 2026-09-10 after
the sandbox rebuild and live verification session, then again after the
standalone APK build sessions (commits 7545e15 -> 44edaed -> 1ecfc78).

## Snapshot

| Phase | Scope | Status | Progress |
|-------|-------|--------|----------|
| 1 | Architecture & planning | Done (adapted) | 90% |
| 2 | Backend API | Core + gallery mgmt + prompt history live | 50% |
| 3 | Mobile app | Foundation + mgmt/save + prompt builder live | 45% |
| 4 | Mobile-specific features | Save-to-device live, wallpaper on Android | 40% |
| 5 | Cloud integration | Not started (parked by choice) | 0% |
| 6 | Testing & QA | Manual slice done + 2 real EAS builds analyzed | 15% |
| 7 | Deployment | GitHub public + EAS linked, APK build in progress | 25% |
| **All** | | **Working MVP verified end-to-end** | **~35%** |

The MVP is deliberately a vertical slice: it proves the riskiest
assumptions (app-to-PC-backend connectivity, real generation, gallery
flow) before the deep feature work starts.

## Phase detail

### Phase 1 - Architecture & Planning: 90%
- Stack chosen and VALIDATED by working code: Expo/React Native (SDK 57),
  Flask (the plan's "Option B - reuse existing logic"), React Navigation.
- Deviations from the plan, all intentional for now:
  - No SQLite yet - the gallery is filesystem-based on the PC backend
    (zero-migration, your existing 82 images work instantly). Revisit when
    offline mode or cloud sync arrives.
  - No Redux/Zustand - plain React state is enough at this size.
  - `shared/` folder not ported yet (types are simple JSON dicts).
- Remaining: write the architecture decision record (this file + HANDOVER
  cover most of it).

### Phase 2 - Backend API: 35%
Live and tested on 2026-09-10:
- POST /api/generate (real Pollinations/Flux call, retries, validation)
- GET /api/providers
- GET /api/gallery (list, metadata, newest-first, pagination)
- GET /api/images/<file> (serve with cache + traversal guard)
- Health check used for auto-discovery

From the plan, still missing:
- POST /api/providers/config (credentials) - low priority: Pollinations
  needs no key
- Style transfer, text overlay, download-with-processing endpoints
- Slideshow endpoints (config/next)
- Tags endpoints
- Rate limiting + API keys if ever exposed beyond home LAN
- SQLite migration (currently filesystem-based by design; sidecar JSON
  covers prompt/seed history)

### Phase 3 - Mobile App: 45%
Built and browser-verified:
- Home, Generate, Gallery, Detail, Settings screens (5 of the plan's 6)
- Prompt input + inspiration chips + size presets (subset of 3.2)
- Lazy 2-column grid, pull-to-refresh, fullscreen viewer (subset of 3.3)
- Loading/error/empty states, result preview (subset of 3.4)
- Gallery management in-app: upload from device (expo-image-picker),
  detail screen with metadata, delete with in-app confirmation and
  automatic list refresh on return (verified in browser 2026-09-10)
- Save-to-device on Detail + Generate screens: web downloads via object-URL
  anchor (verified with real files landing on disk), native uses
  expo-media-library after download-to-cache (verified in browser 2026-09-10)
- Prompt builder: 7 style presets, negative-prompt field (soft guidance),
  recent-prompts chips with one-tap reuse; Detail shows prompt/seed/
  avoided text; backend persists prompt+seed in sidecar JSON files and
  exposes GET /api/prompts/recent (verified API + UI 2026-09-10)

Missing: Slideshow screen, pinch-zoom/swipe/long-press interactions,
generation cancellation, background jobs, batch, style transfer
UI, text overlay UI.

### Phase 4 - Mobile-specific: 40%
Live and verified on web 2026-09-10:
- Save-to-device from Detail screen and from the generation result card
  (platform-split service: browser anchor download / expo-media-library
  on native, with download-to-cache via the new expo-file-system API)
- Android "Set as wallpaper" entry: wired through react-native-wallpaper-
  manager behind a platform-split module with graceful degradation -
  inside Expo Go it explains that a development build is needed (see
  docs/DEV_BUILD.md); after `npx expo prebuild` the direct path activates.
  **VERIFIED on a real device 2026-09-11**: user's Galaxy S9 - home-screen wallpaper fills edge-to-edge, no zoom.

Remaining: lock-screen vs home-screen choice, share sheet, widgets,
notifications.

Note: iOS cannot set wallpapers from apps by design - the UI only offers
save + manual instructions there.

### Phase 5 - Cloud: 0%
Deliberately deferred until local experience is complete.

### Phase 6 - Testing & QA: 10%
Done: live API smoke tests, real end-to-end generation (API-driven and
UI-driven), headless-browser navigation of all 4 screens, exported web
bundle compile. Missing: automated test suite, device matrix, beta track.

### Phase 7 - Deployment: 5%
Done: source control (GitHub), reproducible setup docs. Missing:
automated test suite, device matrix, beta track, store builds
(EAS), cloud hosting.

## Standalone APK build - current workstream (2026-09-10 evening)

Goal: an installable APK that does NOT need Expo Go, unlocks
save-to-device + set-as-wallpaper for real (Phase 4.1 on a device).

Progress so far:
- v1.8.0 build prep (7545e15): eas.json (preview=apk, production=bundle),
  android package id, cli.appVersionSource=remote, LAN IP auto-detect.
- EAS cloud build #1 failed: react-native-wallpaper-manager is a legacy
  library (jcenter refs, no AGP 8 namespace, createJSModules removed in
  RN 0.86). Bytecode analysis of the .aar confirmed the old Java
  overrides are otherwise still source-compatible.
- Fix 1 (44edaed): config plugin `src/plugins/WallpaperManagerFix.js`
  patches the library during cloud prebuild (gradle namespace +
  implementation deps, manifest without package attr, modernized
  WallPaperPackage.java). Verified: plugin ran in cloud, all 3 original
  errors gone.
- EAS cloud build #2 (536b3ab6) failed on a NEW error: Glide 3.7.0
  overloads reference android.support.v4.app.Fragment/FragmentActivity;
  class missing in the androidx world -> javac error at
  WallPaperManager.java:105/:162.
- Fix 2 (1ecfc78): plugin's gradle patch now also adds
  `com.android.support:support-v4:28.0.0` (downloadability verified,
  runtime only uses the Context overload). Pushed; raw file serves 200.

- EAS cloud build #3 failed on a THIRD error: checkReleaseDuplicateClasses
  - support-v4 28.0.0 (added in fix 2) collides with androidx.core 1.17.0
  (both ship INotificationSideChannel, ResultReceiver, etc).
- Fix 3 (634b009): removed Glide + support-v4 entirely. Plugin now
  replaces WallPaperManager.java with a pure framework implementation
  (BitmapFactory two-pass decode, HttpURLConnection with custom
  headers, WallpaperManager.setBitmap + center-crop). Java verified
  compile-clean via ecj 3.33 + API stubs (0 errors). Deleted
  MyGlideModule.java; gradle deps = react-native only.
- EAS cloud build #4 (after f1e3cc22): SUCCESS. APK v1.8.0 installed
  on the user's phone. Artifact:
  https://expo.dev/artifacts/eas/pMbEAm20UBR34m1e83YFxItiRnyO3Wl.zyXBVlwtFi0E.apk
- NEW ISSUE (installed app shows "backend offline"): phone browser
  reaches http://192.168.1.168:5000 fine (backend logs the phone's
  requests) but the app reports offline after restarts. Diagnosis:
  Android 9+ cleartext-HTTP block inside the release APK - the
  prebuilt manifest had NO usesCleartextTraffic, so every http://
  fetch is blocked by the OS (Expo Go allowed it; the standalone APK
  does not). Fix (bbfda6f + 5d5ad72): plugin's withAndroidManifest
  mod sets android:usesCleartextTraffic="true" on the main manifest.
  Verified via local prebuild: attribute lands in the manifest.

Remaining for this workstream:
1. Push cleartext fix -> user re-curls the one plugin file -> EAS
   build #5 -> reinstall APK -> backend online.
2. Test save + set-as-wallpaper on the phone.
3. Revoke the EAS access token + GitHub token used for CLI auth.
4. Refresh the downloadable project zip backup.

## Suggested next three moves (highest value first)

1. ~~Gallery management endpoints + UI actions~~ **DONE 2026-09-10**
   (upload / detail / delete, verified API + UI).
2. ~~Save-to-device + set wallpaper (Android)~~ **DONE 2026-09-10** (web
   verified end-to-end; Android wallpaper needs a real-device dev build).
3. ~~Prompt builder upgrade~~ **DONE 2026-09-10** (style presets, negative
   field, recent-prompts reuse, prompt/seed on detail; verified API + UI).

Next candidates, in rough value order:

- **Run it on a real Android phone**: Expo Go for the save flow, then a
  `expo prebuild` development build to activate direct wallpaper setting
  (see docs/DEV_BUILD.md). This is the biggest untested surface.
- **Generation UX hardening**: cancel button, seed lock/reuse control,
  progress feedback while Flux is painting.
- **Fullscreen viewer interactions**: pinch-zoom, swipe between gallery
  images, long-press for quick actions (Phase 3.3 leftovers).

Slideshow, style transfer, tags and cloud sync stay parked.
