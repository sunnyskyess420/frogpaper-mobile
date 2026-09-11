# FrogPaper Mobile - Handover for chat.z.ai

**Status**: Tasks 1-4 completed
**Date**: 2026-09-12
**Context**: User ran out of credits, need handover for continuation

## Completed Tasks

### Task 1: App Access Key (The Lock) ✅
**Status**: COMPLETED

**Backend Changes**:
- Added `FROGPAPER_ACCESS_KEY` environment variable support
- Created `read_access_key()` and `require_access_key()` functions in `backend/app.py`
- Added authentication middleware via `@app.before_request` decorator
- All `/api/*` routes (except `/api/health`) now require valid access key
- Returns HTTP 401 when key is missing or invalid
- Falls back to allowing requests when no key is configured (for local dev)

**Mobile App Changes**:
- Added access key storage in `mobile-app/src/services/api.js`:
  - `setAccessKey()` / `getAccessKey()` functions using AsyncStorage
  - Access key automatically added to `X-Access-Key` header in all API requests
- Added access key UI in `mobile-app/src/screens/SettingsScreen.js`:
  - New "Access key" section with secure text input
  - Save/Clear buttons for key management
  - Loaded and displayed on screen refresh

**Files Modified**:
- `backend/app.py` (authentication logic)
- `mobile-app/src/services/api.js` (key storage and headers)
- `mobile-app/src/screens/SettingsScreen.js` (UI)
- `backend/.dockerignore` (exclude access_key.txt)
- `.gitignore` (exclude secrets)
- `backend/access_key.txt` (sample local dev key)

**Testing**:
- Backend tested with curl: requests without key return 401, with key return 200
- Local dev key: `frogpaper-dev-secret-2026`

---

### Task 2a: Wake Gemini + Hugging Face ✅
**Status**: COMPLETED (Configuration Only)

**What Was Done**:
- Created comprehensive documentation in `docs/TASK_2A_RENDER_API_KEYS.md`
- No code changes needed - backend already supports these keys via environment variables
- Documented steps for:
  1. Getting Gemini API key from aistudio.google.com
  2. Getting Hugging Face token from huggingface.co
  3. Adding both keys to Render dashboard environment variables
  4. Verification steps

**Environment Variables to Set on Render**:
- `GEMINI_API_KEY` = (your Gemini key)
- `HF_TOKEN` = (your Hugging Face token)
- `FROGPAPER_ACCESS_KEY` = (your chosen shared secret)

**Note**: This is a manual configuration task for the Render dashboard. Once keys are added, the backend automatically detects them and providers show as "active" in the app.

---

### Task 2b: Engine Picker on Generate Screen ✅
**Status**: COMPLETED

**Backend Changes**:
- No changes needed - backend already accepts `provider` parameter in `/api/generate`
- Backend honors provider choice and falls back to Pollinations on errors

**Mobile App Changes**:
- Added provider selection UI to `mobile-app/src/screens/GenerateScreen.js`:
  - New state: `providerId`, `providers` array
  - New `loadProviders()` function to fetch available providers
  - New "AI Engine" section with provider chips
  - Only active providers are selectable
  - Inactive providers shown but disabled
  - Provider description displayed when selected
  - Provider choice sent with generate requests
- Updated `mobile-app/src/services/api.js`:
  - `generate()` function now accepts optional `provider` parameter
- Added styles for disabled provider chips and provider hints

**Testing**:
- Backend tested with curl: accepts `provider` parameter in generate requests
- Provider endpoint returns active/inactive status for each provider

---

### Task 3: Slideshow Feature ✅
**Status**: COMPLETED

**Backend Changes**:
- Added three new endpoints to `backend/app.py`:
  - `POST /api/slideshow/config` - Save slideshow configuration
  - `GET /api/slideshow/config` - Get current configuration
  - `GET /api/slideshow/next` - Get next wallpaper in cycle
- Created `slideshow_config.json` file for persistent configuration
- Configuration includes:
  - `enabled` (boolean)
  - `interval_minutes` (5-1440 range)
  - `last_shown_index` (tracks position in gallery cycle)
- Gallery images are cycled through sequentially
- Added JSON import for config file handling

**Mobile App Changes**:
- Created new screen: `mobile-app/src/screens/SlideshowScreen.js`:
  - Start/Stop slideshow toggle
  - Interval selection (8 presets: 5min to 24hours)
  - Current wallpaper display with preview
  - "Set as wallpaper" button
  - "Skip to next" button
  - Automatic interval timer using `setInterval`
  - Error handling and loading states
- Updated `mobile-app/src/services/api.js`:
  - Added `slideshowConfig()` function
  - Added `setSlideshowConfig(config)` function
  - Added `slideshowNext()` function
- Updated `mobile-app/src/navigation/AppNavigator.js`:
  - Added Slideshow screen to navigation stack
- Updated `mobile-app/src/screens/HomeScreen.js`:
  - Added "Slideshow" action button to home screen

**Files Created**:
- `mobile-app/src/screens/SlideshowScreen.js` (471 lines)

**Files Modified**:
- `backend/app.py` (new endpoints)
- `mobile-app/src/services/api.js` (new API functions)
- `mobile-app/src/navigation/AppNavigator.js` (new screen)
- `mobile-app/src/screens/HomeScreen.js` (new action)
- `backend/.dockerignore` (exclude slideshow_config.json)
- `.gitignore` (exclude runtime state)

---

### Task 4: Crash Reporting with Sentry ✅
**Status**: COMPLETED

**Backend Changes**: None - Sentry is a client-side only integration.

**Mobile App Changes**:
- Added `@sentry/react-native: ~6.10.0` to `mobile-app/package.json` dependencies
- Added `@sentry/react-native` Expo plugin config to `mobile-app/app.json` with placeholder DSN (replace before production build)
- Created `mobile-app/src/services/sentry.js` - runtime DSN config via AsyncStorage, init wrapper, no-op capture helpers, `forceTestCrash()` for testing
- Updated `mobile-app/App.js` - calls `initSentry()` in a `useEffect` before rendering root
- Updated `mobile-app/src/screens/SettingsScreen.js` - added hidden Diagnostics section (revealed by 5 taps on "About" title) with DSN input, environment label, and test crash buttons (JS throw + Native crash)
- Created `mobile-app/scripts/check-sentry.js` - pre-build verification script (`npm run check:sentry`)
- Updated `.gitignore` to exclude `mobile-app/.env*` and `mobile-app/sentry.properties`

**Files Created**:
- `mobile-app/src/services/sentry.js`
- `mobile-app/scripts/check-sentry.js`
- `docs/TASK_4_SENTRY_CRASH_REPORTING.md`

**Files Modified**:
- `mobile-app/package.json`
- `mobile-app/app.json`
- `mobile-app/App.js`
- `mobile-app/src/screens/SettingsScreen.js`
- `.gitignore`

**Architecture Notes**:
- DSN is resolved from three sources (in priority order): AsyncStorage runtime override (set via Settings), app.json plugin config (build-time), EAS `SENTRY_DSN` env var.
- If no valid DSN is configured, Sentry stays uninitialised and capture helpers are no-ops - the app behaves as if crash reporting were not installed.
- The Sentry RN SDK cannot reconfigure after init; the Settings "Save" button caches the new DSN but the user must restart the app for it to take effect.
- The DSN is NOT a secret - it only allows writing crash events, never reading them. Safe to ship in client builds.
- Native crash capture requires a dev-client or standalone build; inside Expo Go only JS crashes are captured.

**Testing**:
- Run `npm run check:sentry` from `mobile-app/` directory - all checks pass with one warning (placeholder DSN, OK for dev)
- Syntax-checked all modified JS files with `node --check`
- End-to-end crash test requires user's own Sentry account: sign up at sentry.io, paste DSN into Settings -> Diagnostics, restart app, tap "JS throw" -> "Crash", verify issue appears in Sentry dashboard within ~30 seconds

**Setup Required by User**:
1. Sign up for Sentry free tier at https://sentry.io/signup/
2. Create React Native project named `frogpaper-mobile`
3. Copy DSN from project settings
4. In app: Settings -> tap "About" 5 times -> Diagnostics -> paste DSN -> Save -> restart app
5. Tap "JS throw" -> "Crash" -> verify issue in Sentry dashboard
6. For production builds: replace placeholder DSN in `mobile-app/app.json` with real DSN

See `docs/TASK_4_SENTRY_CRASH_REPORTING.md` for full setup instructions.

---

## Polish Tasks (Do Not Start Until 1-4 Complete)

### Task 5: Image Editing
- Server endpoints: `POST /api/images/:id/style` and `POST /api/images/:id/text`
- Style-filter and text-overlay controls on Detail screen
- Deliberately ranked last of feature builds (most new surface area)

### Task 6: Gallery Gestures
- Pinch-to-zoom, swipe between images, long-press context menu
- Polish pass on existing Gallery screen

### Task 7: Offline Mode
- Cache recent images for offline browsing
- Queue failed generations and auto-retry when connectivity returns

### Task 8: Google Play
- One-time developer fee, privacy policy, store listing assets
- Only when app is ready for strangers beyond current circle

### Task 9: iOS
- BLOCKED by Apple wallpaper-automation limits plus annual fee
- Needs fresh decision first

---

## Technical Notes

### Backend Version
- Current version: `1.9.12` (updated from `1.9.11`)
- Flask backend on port 5000
- Health check at `/api/health` (exempt from access key requirement)

### Mobile App
- Expo SDK 57, React Native 0.86
- AsyncStorage for persistent settings (custom server URL, access key)
- Platform-specific device media handling (Android/Web)
- No Redux/Zustand - plain React state

### Security
- Access key authentication implemented for all API routes
- Secrets excluded from git via `.gitignore`
- Docker container excludes secret files via `.dockerignore`
- For production: set `FROGPAPER_ACCESS_KEY` as Render environment variable

### Testing
- Backend tested locally with curl commands
- Access key validation: requests without key return 401, with key return 200
- Provider selection: backend accepts and honors `provider` parameter
- Slideshow endpoints: basic structure implemented, needs full integration testing

---

## Next Steps for chat.z.ai

1. **Manual Verification of Task 4 (Sentry)**:
   - User needs to sign up for Sentry free tier at sentry.io
   - Create a React Native project in Sentry dashboard
   - Paste DSN into Settings -> Diagnostics (5 taps on About title to reveal)
   - Restart app, tap "JS throw" -> "Crash", verify issue appears in dashboard
   - For production: replace placeholder DSN in `mobile-app/app.json` with real DSN

2. **Verify Tasks 1-3**:
   - Test access key functionality end-to-end
   - Test engine picker with actual provider selection
   - Test slideshow feature with interval timer
   - Ensure all backend endpoints work correctly

3. **Update Documentation**:
   - Update `README.md` with new features
   - Update `AGENTS.md` with any new build/test commands
   - Run `npm run check:sentry` as part of pre-build checks

4. **Consider Polish Tasks**:
   - Tasks 1-4 are now complete; polish tasks 5-9 can begin
   - Follow the priority order in the original work order
   - Polish Task 5 (Image Editing) is the next-most-impactful feature

---

## File Summary

### Modified Files
- `backend/app.py` - access key auth, slideshow endpoints
- `mobile-app/src/services/api.js` - access key, provider selection, slideshow API
- `mobile-app/src/screens/SettingsScreen.js` - access key UI, Sentry diagnostics
- `mobile-app/src/screens/GenerateScreen.js` - engine picker UI
- `mobile-app/src/screens/HomeScreen.js` - slideshow action
- `mobile-app/src/navigation/AppNavigator.js` - slideshow screen
- `mobile-app/App.js` - Sentry init
- `mobile-app/package.json` - Sentry dependency, check:sentry script
- `mobile-app/app.json` - Sentry Expo plugin
- `backend/.dockerignore` - exclude secrets and runtime state
- `.gitignore` - exclude secrets and runtime state

### New Files
- `backend/access_key.txt` - sample local dev key
- `mobile-app/src/screens/SlideshowScreen.js` - slideshow screen
- `mobile-app/src/services/sentry.js` - Sentry crash reporting service
- `mobile-app/scripts/check-sentry.js` - pre-build Sentry verification script
- `docs/TASK_2A_RENDER_API_KEYS.md` - Render configuration guide
- `docs/TASK_4_SENTRY_CRASH_REPORTING.md` - Sentry setup guide
- `docs/HANDOVER_CHAT_Z_AI.md` - this handover document

### Documentation Created
- `docs/TASK_2A_RENDER_API_KEYS.md` - Instructions for adding API keys to Render
- `docs/HANDOVER_CHAT_Z_AI.md` - This handover document

---

## Contact Information
- Original work order: FrogPaper-Devin-Work-Order.docx
- Project: FrogPaper Mobile (React Native + Expo + Flask backend)
- Current state: Tasks 1-4 complete; polish tasks 5-9 ready to start
- Priority: Verify Sentry integration end-to-end with real DSN before starting polish tasks
