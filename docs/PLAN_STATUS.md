# Plan Status - against the original 7-phase plan

Tracked against `docs/ORIGINAL_PROJECT_PLAN.md`. Updated 2026-09-10 after
the sandbox rebuild and live verification session.

## Snapshot

| Phase | Scope | Status | Progress |
|-------|-------|--------|----------|
| 1 | Architecture & planning | Done (adapted) | 90% |
| 2 | Backend API | Core + gallery mgmt live | 45% |
| 3 | Mobile app | Foundation + detail/upload/delete live | 30% |
| 4 | Mobile-specific features | Not started | 5% |
| 5 | Cloud integration | Not started | 0% |
| 6 | Testing & QA | Manual slice done | 10% |
| 7 | Deployment | Repo only | 5% |
| **All** | | **Working MVP verified end-to-end** | **~20%** |

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

Missing: Slideshow screen, pinch-zoom/swipe/long-press interactions,
generation cancellation, background jobs, history, batch, style transfer
UI, text overlay UI.

### Phase 4 - Mobile-specific: 5%
Nothing built yet. Recommended first move per the plan's own risk note
("focus Android first"): save-to-device-gallery via expo-media-library,
then Android set-as-wallpaper.

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

1. **Gallery management endpoints + UI actions** (Phase 2/3): delete,
   upload, detail - makes the gallery a real manager instead of a viewer.
2. **Save-to-device + set wallpaper (Android)** (Phase 4.1): the single
   most "why am I doing this" feature for a wallpaper app.
3. **Prompt builder upgrade** (Phase 3.2): structured presets, negative
   prompt field, generation history - cheap to add, big daily-use win.

Slideshow, style transfer and cloud sync stay parked until 1-3 ship.
