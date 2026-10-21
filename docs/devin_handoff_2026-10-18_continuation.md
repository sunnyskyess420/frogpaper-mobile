# Devin Handoff - FrogPaper Mobile Audit Fixes (Continuation)

**Date:** 2026-10-18
**Repo:** https://github.com/sunnyskyess420/frogpaper-mobile
**Base:** `main` at `1931fe2`
**Work branch:** `fix/audit-security-and-reliability`
**Draft PR:** https://github.com/sunnyskyess420/frogpaper-mobile/pull/2
**Original handoff:** `docs/devin_handoff_2026-10-18.md`

You are continuing the audit/security fixes. The previous session switched from a different task (UX fixes on main) to this branch. All verification passed, and P0-4.1 is complete.

## What's done

- ✅ **Baseline verification**: `npm ci`, `check-navigation.js` (25 pass), `check-offline.js` (30 pass)
- ✅ **P0-4.1: Remove Slideshow** - Committed as `7eab535` (pushed to remote)
  - Removed `src/screens/SlideshowScreen.js`
  - Removed Slideshow import from `src/navigation/AppNavigator.js`
  - Removed Slideshow endpoints from `backend/app.py` (97 lines deleted)
  - Removed Slideshow routes from docstring
- ✅ **P0-4.2 package installation** - Committed as `b3b318e`
  - `expo-secure-store` installed via `npx expo install expo-secure-store`
  - Added to `package.json` and `app.json` plugins
  - Implementation not yet started

## Current state

**P0-4.2: Move BYOK keys to SecureStore** - IN PROGRESS
- Package installed and committed (`b3b318e`)
- No code changes to `api.js` yet
- Still need to: implement SecureStore calls, add migration, update test stubs

**Files to modify:**
- `mobile-app/src/services/api.js` - Replace AsyncStorage with SecureStore for BYOK keys
- `mobile-app/app.json` - May need config plugin (expo-secure-store typically doesn't need this)
- `mobile-app/package.json` - Already updated by expo install
- `mobile-app/scripts/check-engine.js` - Update if it mocks AsyncStorage

**Implementation plan:**
1. Import `* as SecureStore from 'expo-secure-store'` in `api.js`
2. Replace the three BYOK key getters/setters:
   - `getGeminiKey()` / `setGeminiKey()`
   - `getHfToken()` / `setHfToken()`
   - `getReplicateToken()` / `setReplicateToken()`
3. Add migration: on first load, read from AsyncStorage, write to SecureStore, delete old key
4. Keep web fallback to AsyncStorage (SecureStore is native-only)
5. Keep keys out of logs/error messages

**Acceptance criteria:**
- Keys survive restart (SecureStore persists)
- Existing installs migrate from AsyncStorage to SecureStore
- No plaintext `@frogpaper_user_gemini_key` etc. remain after migration
- Web still works (falls back to AsyncStorage)
- Tests still pass

## Remaining P0 items (in order)

### P0-4.3: Redact prompts from server logs
**File:** `backend/app.py` around the `Generate request` log
- Current: `log.info("Generate request: prompt=%r ...", prompt[:60], ...)` writes first 60 chars
- Do: log only length and short hash (e.g. `sha256(prompt)[:8]`), or omit entirely
- Search backend for any other prompt logging and redact it
- Never echo prompts in error responses
- Acceptance: no user prompt text in logs; generation unchanged

### P0-4.4: Add per-device rate limiting
**File:** `backend/app.py`, before `/api/generate` work
- Current: access key ships in app; any client can spam `/api/generate`
- Do: add in-memory token bucket keyed by `X-Device-Id` (fallback `request.remote_addr`)
- Start with ~10 generations/hour and 1 concurrent generation per device
- Return HTTP 429 with JSON `retry_after` and friendly message
- Note: gunicorn runs 2 workers, so limit is per worker unless Redis added
- Do not rate-limit `/api/health`
- Acceptance: 11th request returns 429; second device unaffected; tests cover boundary

## Ground rules (from original handoff)

- Root stack screens are `Build`, `Detail`, `History`; they navigate through `Tabs` with `{ pop: true }`
- `/api/providers` must build a copy of `PROVIDERS` when applying BYOK status; never mutate global
- Every gallery read/delete must enforce device ownership rule (`_owns_image()` or `entry.get("device")`)
- BYOK keys belong only on `/api/providers` and `/api/generate` requests
- Do not re-enable Sentry until Gradle 9 support exists
- Do not upgrade `react-native-wallpaper-manager` blindly (patched by WallpaperManagerFix.js)
- Access key is shipped in app (not real security); device ids are privacy boundary

## Physical-device checklist (Android)

Do this before merging PR #2:
- [ ] Fresh install; welcome tour; skip
- [ ] Build -> pick a mode -> **Use this prompt** -> Generate shows prompt and Avoid list
- [ ] Detail -> **Generate again** -> Generate shows prompt and starts generation
- [ ] History -> **Make again** and **Edit** both reach Generate
- [ ] Gallery: leave and return; no full-screen spinner when images exist
- [ ] Gallery: delete A, then B within 5 seconds; both gone; undo B restores B
- [ ] Set wallpaper: home, lock, both. Force failure (deny permission/bad URI) and confirm app reports failure
- [ ] Save to phone gallery; save to SAF/SD folder; revoke access and confirm error message
- [ ] BYOK: save Gemini/HF/Replicate keys; restart; Settings shows **Ready**; generate with each; invalid key falls back with visible notice
- [ ] Offline: queue generation; reopen online; run queue; ensure no duplicate generation
- [ ] Update prompt: newer release prompts once; "Later" suppresses that version

## Definition of done

- All P0 items resolved (4.1 ✅, 4.2-4.4 pending)
- CI green on PR (add `.github/workflows/ci.yml` - see P2-4.10 in original handoff)
- Backend tests pass; mobile checks pass except documented skips
- Web export passes
- Android device checklist completed
- PR #2 marked ready for review (not draft) with summary of changes since handoff

## Setup commands

```bash
cd mobile-app
npm ci
node scripts/check-navigation.js
node scripts/check-offline.js
npx expo export --platform web --output-dir ../web-build
```

Backend tests (Windows example):
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

## Next steps

1. Complete P0-4.2 (SecureStore BYOK keys) - expo-secure-store already installed
2. Commit P0-4.2
3. Implement P0-4.3 (redact prompts from logs)
4. Commit P0-4.3
5. Implement P0-4.4 (rate limiting)
6. Commit P0-4.4
7. Run Android device checklist
8. Add CI (P2-4.10) if time permits
9. Mark PR #2 ready for review
