# Task 4: Crash Reporting with Sentry

**Status**: COMPLETED
**Date**: 2026-09-12
**Work order**: FrogPaper-Devin-Work-Order.docx (Task 4)

## Summary

Integrated `@sentry/react-native` (v6.10.x) into the FrogPaper Mobile app for crash reporting. Sentry is initialised at app startup and captures both JS exceptions and native crashes (in dev-client / standalone builds). A hidden Diagnostics section in Settings lets a tester paste a DSN, switch environment labels, and force a real test crash to verify the dashboard end-to-end.

## Files Modified

| File | Change |
|------|--------|
| `mobile-app/package.json` | Added `@sentry/react-native: ~6.10.0` dependency; added `check:sentry` npm script; bumped app version to 1.7.0 |
| `mobile-app/app.json` | Added `@sentry/react-native` Expo plugin with placeholder DSN, organization, project, native + session tracking flags |
| `mobile-app/App.js` | Added `useEffect` that calls `initSentry()` before rendering root; loading spinner while Sentry init runs |
| `mobile-app/src/screens/SettingsScreen.js` | Added Diagnostics section (hidden by default, revealed by 5 taps on the About title) with DSN input, environment label input, save/clear buttons, status row, and "JS throw" + "Native crash" test buttons |
| `.gitignore` | Added entries for `mobile-app/.env*`, `mobile-app/sentry.properties` |

## Files Created

| File | Purpose |
|------|---------|
| `mobile-app/src/services/sentry.js` | Sentry service module - runtime DSN config via AsyncStorage, init wrapper, no-op capture helpers when uninitialised, `forceTestCrash()` for the test button |
| `mobile-app/scripts/check-sentry.js` | Pre-build verification script. Run with `npm run check:sentry`. Verifies package.json dependency, Expo plugin config, service module existence, App.js init call, and SettingsScreen crash-button presence |

## Architecture

### DSN Resolution (in priority order)

1. **AsyncStorage override** (`@frogpaper_sentry_dsn`) - runtime DSN set via Settings screen. Highest priority for dev/test.
2. **app.json plugin config** - production-build DSN, embedded at build time via the `@sentry/react-native` Expo plugin.
3. **EAS `SENTRY_DSN` env var** (read via `Constants.expoConfig.extra.SENTRY_DSN`) - CI/EAS build override.

If none resolve to a valid `https://...@...` DSN, Sentry stays uninitialised and all capture helpers become no-ops. The app keeps running as if crash reporting were not installed.

### Initialisation Flow

```
App.js useEffect -> initSentry() -> reads AsyncStorage DSN -> validates -> Sentry.init({ dsn, environment, ... })
```

`initSentry()` is idempotent (subsequent calls are no-ops) and never throws - a Sentry init failure cannot break the app.

### Test Crash Strategies

The Diagnostics section exposes two buttons:

- **JS throw** - throws an uncaught `Error('FrogPaper Sentry test crash - JS throw')`. Captured by the JS Sentry SDK in any build environment including Expo Go.
- **Native crash** - calls `Sentry.nativeCrash()`. Requires a dev-client or standalone build; no-op inside Expo Go (a fallback alert is shown).

## Setup Steps for a New Sentry Project

### 1. Sign up for Sentry (free tier)

1. Go to https://sentry.io/signup/
2. Create a free account (5K events/month free)
3. Create a new project: platform = React Native, name = `frogpaper-mobile`
4. Copy the DSN from the project settings. It looks like:
   ```
   https://abc123def456@o789012.ingest.sentry.io/1234567
   ```

### 2. Test in dev without rebuilding

The easiest way to test Sentry in development is to use the in-app Diagnostics UI:

1. Open the app
2. Go to Settings
3. Tap the "About" title 5 times to reveal the Diagnostics section
4. Paste your Sentry DSN into the DSN input
5. (Optional) Set the environment label (e.g. `development`)
6. Tap "Save"
7. Restart the app so Sentry re-initialises with the new DSN
8. Open Diagnostics again, tap "JS throw" -> "Crash"
9. Wait ~30 seconds, then check your Sentry dashboard for a new issue

### 3. Bake DSN into production build

For production builds (EAS Build / standalone APK), replace the placeholder in `mobile-app/app.json`:

```json
[
  "@sentry/react-native",
  {
    "url": "https://sentry.io/",
    "organization": "frogpaper",
    "project": "frogpaper-mobile",
    "dsn": "https://abc123def456@o789012.ingest.sentry.io/1234567",
    "enableNative": true,
    "enableAutoSessionTracking": true
  }
]
```

Or pass the DSN via environment variable when building with EAS:

```bash
SENTRY_DSN=https://abc123def456@o789012.ingest.sentry.io/1234567 eas build --platform android
```

### 4. Verify build configuration

Before building, run:

```bash
cd mobile-app
npm run check:sentry
```

This script inspects `package.json`, `app.json`, `App.js`, `src/services/sentry.js`, and `src/screens/SettingsScreen.js` to confirm everything is wired correctly. It exits non-zero on failure so it can be used in CI / pre-build hooks.

Expected output (placeholder DSN is OK for dev):

```
FrogPaper Mobile - Sentry build check

[PASS] package.json contains @sentry/react-native dependency
[PASS] npm script "check:sentry" present
[PASS] app.json has @sentry/react-native Expo plugin configured
       plugin present, DSN is placeholder (OK for dev, replace before prod build)
[WARN] SENTRY_DSN env var (optional override)
       not set (using app.json DSN instead)
[PASS] src/services/sentry.js exists
[PASS] App.js imports and calls initSentry()
[PASS] SettingsScreen.js exposes Diagnostics section with forceTestCrash

============================================================
[PASS] All checks passed with 1 warning(s).
```

For production builds, fix the warning by either:
- Setting a real DSN in `app.json` (preferred)
- Or passing `SENTRY_DSN` env var at build time

## Testing Verification

### Dev test (Expo Go)

1. Start the dev server: `cd mobile-app && npm start`
2. Open the app in Expo Go
3. Settings -> tap "About" title 5 times
4. Paste DSN -> Save -> restart app
5. Settings -> Diagnostics -> "JS throw" -> "Crash"
6. Sentry dashboard shows new issue within ~30s

### Production test (dev client / standalone APK)

1. Build with EAS: `eas build --platform android --profile preview`
2. Install the APK
3. Repeat the dev test steps - now "Native crash" also works
4. Verify native crashes appear in Sentry dashboard (slower than JS, ~1-5 minutes for symbolication)

## Security Notes

- The Sentry **DSN is NOT a secret**. It is safe to ship in client builds (binary or source). It only grants write access for new events, never read access to existing events.
- The Sentry **auth token** (used by EAS Build to upload debug symbols) IS a secret. Set it via `SENTRY_AUTH_TOKEN` env var in EAS, never commit it.
- The runtime DSN configured via the Settings screen is stored in AsyncStorage - it persists across launches but is sandboxed per-app on both iOS and Android.

## Captured Event Types

| Type | Source | Captured in Expo Go? | Captured in production build? |
|------|--------|---------------------|------------------------------|
| Uncaught JS exceptions | JS thread | Yes | Yes |
| `captureException()` calls | JS code | Yes | Yes |
| `captureMessage()` calls | JS code | Yes | Yes |
| Native crashes (C++/ObjC/Java) | Native thread | No (requires dev-client) | Yes (after symbol upload) |
| ANRs (Android Not Responding) | Native watchdog | No | Yes (Android only) |
| Session tracking (healthy / crashed) | Both | Yes | Yes |

## Future Improvements

Once Sentry is live and producing real data, consider:

- **Sample rate tuning**: Drop `tracesSampleRate` from `1.0` to `0.1` or `0.05` once the project's quota starts filling. Performance traces are by far the largest volume contributor.
- **Release health**: Tag releases with `Sentry.setTag('app_version', ...)` so you can filter issues by app version.
- **User feedback**: Add `Sentry.captureUserFeedback()` to a future "Report a bug" screen.
- **Source maps**: For production builds, upload source maps via `@sentry/cli` so stack traces are readable. Configure in `eas.json` post-build hook.

## Acceptance Criteria

- [x] Sentry SDK installed (`@sentry/react-native` in package.json)
- [x] Sentry initialises on app startup (`initSentry()` in App.js)
- [x] DSN configurable at runtime via Settings (no rebuild required for dev)
- [x] DSN configurable at build time via app.json plugin
- [x] Build check script verifies configuration (`npm run check:sentry`)
- [x] Test crash button forces a real crash (JS throw + native crash)
- [x] Sentry becomes a no-op when DSN is absent (never breaks the app)
- [x] Documentation explains setup + verification steps
- [ ] **Manual verification**: User signs up for Sentry, pastes DSN, taps JS throw button, sees issue in Sentry dashboard. (This step requires the user's own Sentry account and a real device or emulator - cannot be automated here.)
