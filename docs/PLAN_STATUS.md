# Plan Status - against the original 7-phase plan

Tracked against `docs/ORIGINAL_PROJECT_PLAN.md`. Updated 2026-09-10 after
the sandbox rebuild and live verification session.

## Snapshot

| Phase | Scope | Status | Progress |
|-------|-------|--------|----------|
| 1 | Architecture & planning | Done (adapted) | 90% |
| 2 | Backend API | Core + gallery mgmt live | 45% |
| 3 | Mobile app | Foundation + detail/upload/delete/save live | 35% |
| 4 | Mobile-specific features | Save-to-device live, wallpaper on Android | 40% |
| 5 | Cloud integration | Not started | 0% |
| 6 | Testing & QA | Manual slice done | 10% |
| 7 | Deployment | Repo only | 5% |
| **All** | | **Working MVP verified end-to-end** | **~25%** |

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
- POST /api/gallery/upload, DELETE /api/gallery/:id, GET /api/gallery/:id
- Style transfer, text overlay, download-with-processing endpoints
- Slideshow endpoints (config/next)
- Tags endpoints
- Rate limiting + API keys if ever exposed beyond home LAN
- SQLite migration (currently filesystem-based by design)

### Phase 3 - Mobile App: 30%
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

Missing: Slideshow screen, pinch-zoom/swipe/long-press interactions,
generation cancellation, background jobs, history, batch, style transfer
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
  NOT yet verified on a real Android device.

Remaining: verify wallpaper on a real device dev build, lock-screen vs
home-screen choice, share sheet, widgets, notifications.

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

## Suggested next three moves (highest value first)

1. ~~Gallery management endpoints + UI actions~~ **DONE 2026-09-10**
   (upload / detail / delete, verified API + UI).
2. ~~Save-to-device + set wallpaper (Android)~~ **DONE 2026-09-10** (web
   verified end-to-end; Android wallpaper needs a real-device dev build).
3. **Prompt builder upgrade** (Phase 3.2): structured presets, negative
   prompt field, generation history - cheap to add, big daily-use win.

Slideshow, style transfer and cloud sync stay parked until 3 ships.
