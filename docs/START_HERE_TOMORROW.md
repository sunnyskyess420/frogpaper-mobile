# START HERE TOMORROW 📋

## Where we left off (Sept 11, 2026 — late night)

The build **succeeded** but the new APK is "a mess" at runtime. We didn't get to debug what's still wrong because you're exhausted. That's tomorrow's first job.

---

## Where everything lives on your PC

- **Project folder:** `C:\FrogPaperMobile\` (NOT in OneDrive anymore — we moved it for the short-path build)
- **The new APK:** `C:\FrogPaperMobile\mobile-app\android\app\build\outputs\apk\release\app-release.apk`
- **Your backend URL:** `https://frogpaper-mobile.onrender.com` (alive — I verified `/api/health` returns `200 OK`)
- **Backend version:** 1.9.17 (my BYOK code is deployed)

---

## Tomorrow's first task: capture the actual error

Plug phone into PC via USB, allow USB debugging, then run this in Command Prompt:

```
%ANDROID_HOME%\platform-tools\adb.exe logcat -d -s "ReactNativeJS:E" "AndroidRuntime:E" > crash.log
notepad crash.log
```

Copy the error lines and paste them to me. We'll fix in 15 minutes.

(If no error shows up, the issue might be UI rendering — tell me what you see on screen.)

---

## What we already fixed today (in case the same bugs come back)

| Bug | Symptom | Fix commit |
|---|---|---|
| `jcenter()` Gradle error | Build failed at gradlew step | `4c39a03` (restored `WallpaperManagerFix.js`) |
| `sentry.gradle` exec() error | Build failed at gradlew step | `14c59b9` + `da76604` (disabled Sentry autolinking) |
| Launch crash on `AnyTypeProvider` | App crashes immediately on open | `e248ae2` (pinned `expo-clipboard ~57.0.1`) |
| "Backend unreachable" | App can't connect to Render | `2d2f95f` (restored URL sanitizing + patient retry) |
| Sentry JS code crash | App crashes on launch | `6b82068` (made sentry.js a true no-op) |

All committed and pushed to GitHub `origin/main`. Latest commit: `2d2f95f`.

---

## Today's feature work that IS done

- ✅ **BYOK** — users bring their own Gemini/HF/Replicate keys in Settings → "Your API keys"
- ✅ **In-app help modal** — `ByokHelpModal.js`, opens from "How do I get API keys?" button
- ✅ Version 1.9.17 / versionCode 8
- ✅ All pushed to GitHub + Render backend deployed

---

## What's still on the to-do list (your decision, not done)

You said you DON'T want:
- ~~Slideshow feature~~ (no point for your use case)
- ~~Image editing (text + filters)~~
- ~~Google Play publication~~ ($25 fee — you said no)
- ~~iOS version~~ (blocked by Apple's wallpaper limits + $99/yr)

You DO want (in priority order):
1. **Engine picker** — dropdown so user can choose Pollinations (free) vs their Gemini key vs their Replicate key per wallpaper
2. **Gallery gestures** — pinch-to-zoom, swipe between images, long-press to delete
3. **Offline queueing** — cache recent images for offline browsing; queue failed generations to retry

---

## Pending security items (do these tomorrow)

- ❌ **Revoke GitHub Personal Access Token** — the one you pasted in chat earlier today starts with `ghp_`. Go to https://github.com/settings/tokens → find the token starting with `ghp_hqLClS...` → Delete it
- ❌ **Revoke Expo Access Token** — the one you pasted in chat earlier today starts with `Toi_`. Go to https://expo.dev/settings/access-tokens → find the token starting with `Toi_ydJ...` → Revoke it

(Both were pasted in chat earlier today, so they should be considered compromised. Don't paste the actual strings anywhere — just describe what they start with, like above.)

---

## Pending user-side setup items

- ❌ **Lock server with FROGPAPER_ACCESS_KEY** (recommended first) — Render → Environment → add `FROGPAPER_ACCESS_KEY` with a random password → Save → paste same password in app's Settings → Access key → Save
- ❌ **Verify Sentry** (skip — Sentry native is disabled, JS-side is no-op)
- ❌ **Verify BYOK** — depends on getting the new APK working first (Step 1 of tomorrow)

---

## Build commands cheat sheet

To rebuild the APK after future changes:

```bash
cd C:\FrogPaperMobile
git pull origin main
cd mobile-app
rmdir /s /q node_modules   # only if package.json changed
npm install                # only if you deleted node_modules
rmdir /s /q android       # only if app.json changed
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease
explorer app\build\outputs\apk\release
```

First build: ~12 min. Subsequent builds: ~1-2 min (Gradle caches).

---

## Quick reminders

- You have memory trouble from hitting your head at age 7 — that's OK. I'll be your memory for this project. Ask "where are we?" any time.
- I respond best to SHORT questions. If I give too much at once, just say "too much."
- Your other email (the one you use only for FrogPaper) is a good backup account for things like a fresh EAS account if you ever need it.
- Don't paste the same GitHub/Expo token in chat twice — once it's in chat history, treat it as compromised and revoke + regenerate.

---

## Tomorrow's plan in 3 steps

1. **Plug phone in via USB, capture logcat crash log, paste it to me**
2. **Fix whatever the log says** (probably one more JS error from today's BYOK additions)
3. **Once the app works → test BYOK (paste Gemini key, generate wallpaper) → then start on engine picker**

Good night. You did incredible work today. See you tomorrow.
