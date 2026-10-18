# Devin Handoff — FrogPaper Mobile Audit Fixes

**Date:** 2026-10-18  
**Repo:** https://github.com/sunnyskyess420/frogpaper-mobile  
**Base:** `main` at `1931fe2`  
**Work branch:** `fix/audit-security-and-reliability` (code commit `897e163`; later commits add this handoff)  
**Draft PR:** https://github.com/sunnyskyess420/frogpaper-mobile/pull/2  
**Audit report:** `deliverables/frogpaper-app-audit-2026-10-18.md` (local artifact; summary below)

You are picking up a partially completed audit/fix branch. The branch is pushed and the PR is a **draft** — do not merge it until the remaining items and the device checklist are done.

## 0. Copy-paste brief

> You are Devin, continuing the FrogPaper Mobile audit fixes. Repo: https://github.com/sunnyskyess420/frogpaper-mobile. Base: `main` at `1931fe2`. Work branch: `fix/audit-security-and-reliability`. Draft PR: https://github.com/sunnyskyess420/frogpaper-mobile/pull/2. Read `docs/devin_handoff_2026-10-18.md` on that branch first. Then continue with the P0 items in order: (1) remove or rebuild Slideshow, (2) move BYOK keys to SecureStore with migration, (3) redact prompt text from backend logs, (4) add per-device rate limiting to `/api/generate`. Follow the constraints and acceptance criteria in the handoff. Keep PR #2 as a draft until the P0 items and the Android device checklist are done. Do not merge.

---

## 1. What is already done on this branch

All of the following are committed and tested:

1. **Root-stack → tab navigation fixed.**
   - `DetailScreen.js`, `HistoryScreen.js`, `PromptBuilderScreen.js`, and `SlideshowScreen.js` are on the root stack. They previously called `navigation.navigate('Generate')` / `navigate('Gallery')`, which the root stack does not contain, so the buttons silently did nothing.
   - They now use:
     ```js
     navigation.navigate(
       'Tabs',
       { screen: 'Generate', params: { ... } },
       { pop: true }
     );
     ```
   - `pop: true` is required. Without it, the stack pushes a second `Tabs` instance instead of returning to the existing one.
   - Verified end-to-end in the web build: **Build → Cinematic → Use this prompt** lands on Generate with the 371-character prompt and Avoid list populated.
   - Regression check: `mobile-app/scripts/check-navigation.js`.

2. **Cross-device gallery leaks closed.**
   - `DELETE /api/gallery/<filename>` now calls `_owns_image()` before deleting.
   - `GET /api/gallery` filters the already-enriched entries by `entry["device"]` instead of re-reading every sidecar through `_owns_image()`.
   - `GET /api/gallery/<filename>` reads the entry once and checks its `device`.
   - `/api/prompts/recent` is filtered by `device_id`; `ImageStorage.recent_prompts()` accepts an optional `device_id`.
   - Regression suite: `backend/tests/test_multiuser_isolation.py` (18/18 pass).

3. **Private images are no longer shared-cacheable.**
   - `/api/images/*` sends `Cache-Control: private, max-age=86400`.
   - `backend/tests/test_storage.py` and `docs/STORAGE.md` updated.

4. **`/api/health` no longer rebuilds the gallery.**
   - Added `ImageStorage.count_images()`; health uses it instead of `list_images()`.
   - Test proves health reads **zero** sidecars.

5. **Android wallpaper false-success fixed.**
   - `deviceMedia.android.js` now treats `result.status === 'error'` (the native module's actual shape) as failure and surfaces `result.msg`.
   - This affects Detail, Generate, Gallery, daily rotation, and shuffle. **Still needs a physical Android device test.**

6. **Gallery focus spinner fixed.**
   - `GalleryScreen.js` used `useFocusEffect` with a stale `images.length` closure, so every focus showed a spinner. Now uses `imageCountRef`.

7. **Duplicate offline queue runs prevented.**
   - `generationQueue.js` has a module-level in-flight promise; Home’s automatic run and Generate’s manual run join the same pass.
   - `check-offline.js` includes a new concurrency check.

8. **BYOK headers scoped.**
   - `api.js` sends `X-Gemini-Key`, `X-Hf-Token`, `X-Replicate-Token` only to `/api/providers` and `/api/generate`.
   - Upload no longer sends them and now awaits the access-key preload.

9. **Invalid Expo config removed.**
   - Removed `android.usesCleartextTraffic` from `app.json`; the `WallpaperManagerFix` plugin already sets it on the generated manifest.

### Current verification

| Check | Result |
|---|---|
| Mobile headless checks | **713 pass** across 14 of 16 suites |
| `check:sentry` | Fails: Sentry is intentionally disabled; script still expects the plugin |
| `check:versions` | Fails on clean clone: needs generated `android/app/build.gradle` |
| Web export | Passes (635 modules, ~1.1 MB) |
| `expo-doctor` | 1 failure: intentional `@sentry/react-native` version mismatch |
| Backend isolation | 18/18 |
| Backend device images | 15/15 |
| Backend storage | 83 pass / 2 skipped (S3 needs `moto`) |
| Backend filenames | 17/17 |
| Backend handoff | 9/9 |
| Backend subject enhancer | 98/98 |

---

## 2. Set up

```bash
git clone https://github.com/sunnyskyess420/frogpaper-mobile.git
cd frogpaper-mobile
git fetch origin
git checkout fix/audit-security-and-reliability
```

Mobile:

```bash
cd mobile-app
npm ci
node scripts/check-navigation.js
node scripts/check-offline.js
npx expo export --platform web --output-dir ../web-build
```

Backend (Windows example; use `python3` on macOS/Linux):

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python.exe tests\test_multiuser_isolation.py
..\.venv\Scripts\python.exe tests\test_device_images.py
..\.venv\Scripts\python.exe tests\test_storage.py
..\.venv\Scripts\python.exe tests\test_filenames.py
..\.venv\Scripts\python.exe tests\test_handoff.py
..\.venv\Scripts\python.exe tests\test_subject_enhancer.py
```

`backend/tests/test_wallpaper_fit.py` has a live-network section that currently gets HTTP 402 from Pollinations on some networks; that is not a code regression. `test_provider_chain.py` also makes live calls.

Do not commit `.venv`, `node_modules`, `web-build`, generated `android/`, or token files.

---

## 3. Ground rules / architecture constraints

- **Root stack screens** are `Build`, `Detail`, `Slideshow`, `History`; they are siblings of `Tabs`. To reach `Home` / `Generate` / `Gallery` / `Settings`, always go through `Tabs` with `{ pop: true }`. `check-navigation.js` enforces this for the current root screens.
- **`/api/providers`** must build a **copy** of `PROVIDERS` when applying per-request BYOK status. Never mutate the global list with user keys.
- **Every gallery read/delete** must enforce the device ownership rule. If you add a new route, call `_owns_image()` or compare `entry.get("device")`.
- **BYOK keys** belong only on `/api/providers` and `/api/generate` requests. Do not re-add them to `request()` globally.
- **Do not re-enable Sentry** until `@sentry/react-native` supports Gradle 9 / Expo SDK 57. The current `react-native.config.js` disables native autolinking intentionally.
- **Do not upgrade `react-native-wallpaper-manager`** blindly. `WallpaperManagerFix.js` patches its 2016 native code at prebuild time; treat that as load-bearing.
- **Access key is shipped in the app** and is not real security. Device ids are the privacy boundary. Do not weaken ownership checks to “make tests pass.”

---

## 4. Remaining work, in priority order

### P0 — product/security decisions

#### 4.1 Slideshow: remove it or finish it

**Files:** `mobile-app/src/navigation/AppNavigator.js`, `mobile-app/src/screens/SlideshowScreen.js`, `backend/app.py` (`/api/slideshow/*`).

**Current state:**
- `SlideshowScreen` is registered in `AppNavigator`, but no screen navigates to it.
- It does **not** call `setAsWallpaper`; it only displays an image and offers Save.
- `slideshow_config.json` is a single server-wide config, not per device.
- `/api/slideshow/next` lists **all** images, not just the caller’s.
- The JS interval only runs while the screen is mounted; it cannot change the wallpaper in the background.

**Recommendation:** remove the route and screen for now. It is unreachable dead code and its copy promises behavior it does not deliver. If the product wants it back, rebuild it properly:
- Store config per device id (`{"devices": {"<id>": {...}}}`) with migration from the old flat file.
- `GET`/`POST /api/slideshow/config` read/write the caller’s entry.
- `/api/slideshow/next` filters `IMAGE_STORAGE.list_images()` by `entry.get("device") == device_id`.
- On each interval, call `setAsWallpaper(api.imageUrl(filename))`; if `{ok:false}`, stop and show the message.
- Make the copy explicit that the app must stay open/foreground, or add a native background task if that is truly required.

**Acceptance:** no cross-user config or images; actual wallpaper changes; timer stops on unmount; no misleading copy.

#### 4.2 Move BYOK keys to SecureStore

**Files:** `mobile-app/src/services/api.js`, `mobile-app/app.json`, `package.json`.

**Current:** Gemini/HF/Replicate keys live in AsyncStorage (`@frogpaper_user_*`). AsyncStorage is sandboxed but not encrypted.

**Do:**
- Add `expo-secure-store` (`npx expo install expo-secure-store`).
- Replace the three getters/setters with SecureStore calls.
- Migrate existing AsyncStorage values once: read, write to SecureStore, remove the old key.
- Keep a web fallback to AsyncStorage because SecureStore is native-only.
- Update `scripts/check-engine.js` / other stubs if they mock AsyncStorage.
- Keep keys out of logs and error messages.

**Acceptance:** keys survive restart; existing installs migrate; no plaintext `@frogpaper_user_gemini_key` etc. remain after migration; web still works.

#### 4.3 Redact prompts from server logs

**File:** `backend/app.py` around the `Generate request` log.

**Current:** `log.info("Generate request: prompt=%r ...", prompt[:60], ...)` writes the first 60 characters of every prompt to Render logs.

**Do:** log only length and a short hash (e.g. `sha256(prompt)[:8]`), or omit prompt text entirely. Search the backend for any other prompt logging and redact it too. Never echo prompts in error responses.

**Acceptance:** no user prompt text in logs; generation behavior unchanged.

#### 4.4 Add per-device rate limiting

**File:** `backend/app.py`, before `/api/generate` work.

**Current:** the access key ships in the app; any client can spam `/api/generate` and burn Pollinations or a server-side provider key.

**Do:** add a small in-memory token bucket keyed by `X-Device-Id` (fallback `request.remote_addr`). Start with something like 10 generations/hour and 1 concurrent generation per device. Return HTTP 429 with a JSON `retry_after` and a friendly message. Note that gunicorn runs 2 workers, so the limit is per worker unless you add Redis; document that limitation. Do not rate-limit `/api/health`.

**Acceptance:** 11th request in the window returns 429; a second device is unaffected; tests cover the boundary.

### P1 — reliability and performance

#### 4.5 Gallery listing performance

**Files:** `backend/services/storage.py`, `backend/app.py`.

**Current:** `list_images()` enriches every image (reads every sidecar and may fetch up to 512 KB of image header) before the route applies `limit`/`offset`. On S3 with a large gallery this is expensive.

**Do, in order:**
1. Reduce `DIMENSION_HEADER_BYTES` from `512 * 1024` to `64 * 1024` (PNG IHDR/JPEG SOF are early).
2. Prefer `width`/`height` already present in the sidecar before reading image bytes.
3. Add a short-lived entry cache keyed by `(name, size, last_modified)` so repeated gallery polls don’t re-read sidecars.
4. Add storage-level pagination (`list_images_page(limit, offset)`) so only the requested page is enriched. Device filtering still needs sidecar reads; cache helps.
5. Store actual `width`/`height` in generated sidecars so most entries never need an image header read.

**Acceptance:** `/api/gallery?limit=200` enriches only the page; repeated polls hit cache; no behavior change for the app.

#### 4.6 Delete-undo race

**File:** `mobile-app/src/screens/GalleryScreen.js`.

**Current:** `armDelete` clears the previous timer but does not commit the previous pending item. Delete A, then B within 5 seconds: A stays hidden forever and is never deleted.

**Do:** before arming a new delete, commit the previous `undo.item` (fire-and-forget with its own error handling), or maintain a queue of pending deletes. Ensure undo only restores the item it refers to.

**Acceptance:** deleting A then B within 5 seconds deletes both; undo B restores B; A remains deleted; no hidden ghost after reload.

#### 4.7 Share cache cleanup

**File:** `mobile-app/src/services/share.js`.

**Current:** `downloadToCache` puts the image in the cache root and never deletes it; `imageCache.pruneToMax` only prunes its own `wallpapers` subdirectory.

**Do:** delete the downloaded file in a `finally` block after `Sharing.shareAsync` resolves. If there is a race with the target app reading the file, use a uniquely named temp file and defer deletion briefly; document the choice.

**Acceptance:** repeated shares do not grow cache usage indefinitely.

#### 4.8 Home “server wallpapers” count is global

**Files:** `backend/app.py` (`/api/health`), `mobile-app/src/screens/HomeScreen.js`.

**Current:** `images_count` counts every install’s images, and Home shows it as “N wallpapers on the server.”

**Do:** either label it generically (“Server gallery”) or add a per-device count. A cheap option is `/api/gallery?limit=1` for the own total, but don’t make `/api/health` expensive again.

**Acceptance:** Home never displays another user’s image count.

#### 4.9 Upload timeout

**File:** `mobile-app/src/services/api.js` (`uploadImage`).

**Current:** `expoFetch` has no AbortController; a stalled upload can hang forever.

**Do:** add the same 60–180 s timeout pattern used by `request()`, with a user-friendly abort message.

**Acceptance:** stalled upload fails cleanly within the timeout.

### P2 — tooling, CI, dependencies

#### 4.10 Add CI

Add `.github/workflows/ci.yml`:
- Node 22, `npm ci` in `mobile-app`, run the check scripts (or a curated subset), run `npx expo export --platform web`.
- Python 3.11/3.14, install `backend/requirements.txt`, run the backend test scripts.
- Do not require secrets or live provider calls.

Fix the two known tooling failures first:
- `check:sentry`: Sentry is intentionally disabled; either remove the package/check or make the script report “disabled (Gradle 9)” and exit 0.
- `check:versions`: skip the Gradle comparison when `android/app/build.gradle` is missing, or run it only after `expo prebuild`.

**Acceptance:** green CI on the PR; no live-network tests required.

#### 4.11 Dependency and config cleanup

- `@sentry/react-native` is disabled and mismatched (6.10 vs expected ~7.11). Remove it, `react-native.config.js`, and the dead Sentry handlers/state in `SettingsScreen.js`/`sentry.js`; or keep it but make the check honest. Don’t re-enable native Sentry until Gradle 9 is supported.
- Run `npx expo install --check` and upgrade the 8 patch-level Expo packages in a separate commit; rebuild and device-test.
- Remove unused `axios` from `package.json`.
- `app.json`: remove `READ_MEDIA_VIDEO` / `READ_MEDIA_AUDIO` if nothing uses them; change iOS `NSAllowsArbitraryLoads` to `NSAllowsLocalNetworking`; keep Android cleartext only for debug/LAN if possible.
- Update `backend/app.py` `APP_VERSION` and stale docs (`START_HERE_TOMORROW.md` says 693 checks, check:sentry skipped, crash log not started). Update counts and status.
- `mobile-app/src/screens/SettingsScreen.js` has unused Sentry state/handlers (`sentryDsn`, `crashTapCount`, `diagnosticsRevealed`, etc.) and `openCards.advanced`; remove if Sentry is removed.
- `mobile-app/src/services/updateCheck.js` comment says the update check is manual; Home now calls it automatically once a day. Update the comment.

#### 4.12 Native wallpaper library

`react-native-wallpaper-manager@0.3.16` is a 2016 library patched by `mobile-app/src/plugins/WallpaperManagerFix.js` at prebuild. It works today but is fragile across Expo/RN upgrades. Consider a small first-party Android native module (BitmapFactory + WallpaperManager) or a maintained library. Do not combine this with the other fixes unless the build is already broken.

---

## 5. Physical-device checklist (Android)

Do this before merging the PR:

- [ ] Fresh install; welcome tour; skip.
- [ ] Build → pick a mode → **Use this prompt** → Generate shows the prompt and Avoid list.
- [ ] Detail → **Generate again** → Generate shows the prompt and starts generation.
- [ ] History → **Make again** and **Edit** both reach Generate.
- [ ] Gallery: leave and return; no full-screen spinner when images exist.
- [ ] Gallery: delete A, then B within 5 seconds; both are gone; undo B restores B.
- [ ] Set wallpaper: home, lock, both. Force a failure (deny permission / bad URI) and confirm the app reports failure, not success.
- [ ] Save to phone gallery; save to SAF/SD folder; revoke access and confirm the error message.
- [ ] BYOK: save Gemini/HF/Replicate keys; restart; Settings shows **Ready**; generate with each; invalid key falls back with a visible notice.
- [ ] Offline: queue a generation; reopen online; run queue; ensure no duplicate generation.
- [ ] Slideshow if kept: it actually changes the wallpaper; leaving the screen stops the timer.
- [ ] Update prompt: a newer release prompts once; “Later” suppresses that version.

---

## 6. Definition of done

- All P0 items resolved.
- CI green on the PR.
- Backend tests (including new ones) pass; mobile checks pass except documented, intentional skips.
- Web export passes.
- Android device checklist completed.
- PR #2 is marked ready for review (not draft) and has a short summary of what changed since this handoff.
