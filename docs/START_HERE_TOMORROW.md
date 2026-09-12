# START HERE NEXT TIME

## Where we left off (Sept 12, 2026)
The app WORKS. Crash dead, BYOK works, first own-key wallpaper generated + set (Hugging Face FLUX). Engine picker done. Latest commit 60fbef5, pushed to GitHub origin/main.

## Where everything lives
- Project folder: C:\FrogPaperMobile\
- APK: C:\FrogPaperMobile\mobile-app\android\app\build\outputs\apk\release\app-release.apk
- Backend: https://frogpaper-mobile.onrender.com (live, auto-deploys on push)
- App version: 1.9.17 / versionCode 8 (bump to 1.9.18 / 9 at next feature release)
- Keys: stored ONLY on phone. HF key = working. Gemini key = saved but quota-blocked.

## Quick install (phone via USB)
%ANDROID_HOME%\platform-tools\adb.exe install -r C:\FrogPaperMobile\mobile-app\android\app\build\outputs\apk\release\app-release.apk

## Fixed today (all committed + pushed)
1. Launch crash (AnyTypeProvider): tilde version let npm install broken expo-clipboard 57.0.2 -> pinned exact 57.0.1
2. BYOK popup on every Settings refresh: refresh() reset state without byokHelpVisible -> Modal read undefined as true -> added it to all 3 state resets
3. Surprise Replicate charges: server REPLICATE_API_TOKEN auto-picked paid engine -> deleted from Render Environment
4. Grey engine chips despite saved keys: 3-layer fix - backend reads user keys BEFORE rejecting; app isUsable() lets own keys unlock chips; getByokSnapshotAsync fixes key-load race

## Discoveries
- Engine picker already existed (old notes were stale): "AI Engine" chips on Generate screen
- Backend silently falls back to Pollinations if chosen engine fails (make it visible later, to-do 3)
- Gemini free IMAGE quota is small; help modal "1,500/day" is the TEXT limit - wrong, fix text (to-do 4)
- New Gemini key also hit "daily limit used up" - retry after midnight Pacific; HF is the daily driver
- git pager freeze: press Q
- Notepad Ctrl+H truncates long pastes - use the script pattern instead
- uBlock "ClickFix" warning on pasted powershell: ours are safe (local edits only). Real red flags: iwr/iex/irm, -enc blobs, pressure

## Working now
- App opens, no crash; Settings connects to Render
- BYOK: HF key -> chip unlocks -> generates -> sets wallpaper (TESTED)
- Pollinations default (free); Replicate greyed (no key anywhere)
- GitHub and Expo tokens revoked

## To-do (priority order)
1. Gallery gestures - START HERE: pinch-to-zoom, swipe between images, long-press delete
2. Offline queueing: cache recent images, queue failed generations
3. Fallback notice on result ("Gemini limit reached - used Pollinations")
4. Fix help modal false "1,500/day" Gemini claim
5. Security: FROGPAPER_ACCESS_KEY on Render + same key in app Settings -> Access key
6. Housekeeping: delete fix-engines*.ps1 and test-gemini.ps1, bump version next build
7. Gemini: retry after quota reset

## Build cheat sheet
- JS-only changes (screens, api.js, app.py): cd mobile-app\android then gradlew assembleRelease (30s-2min)
- package.json changed: npm install in mobile-app first
- app.json changed: rmdir /s /q android, then npx expo prebuild --platform android, then gradlew (~12min)
- Then the adb install command above (no uninstall needed)

## Reminders
- Memory trouble from age 7 is OK - ask "where are we?" any time
- SHORT questions work best; say "too much" if overwhelmed
- Never paste keys/tokens in chat - first 4 characters only
- Do NOT re-add Replicate key unless you want to pay ~2.5 cents per wallpaper

## Next session plan
1. Gallery gestures (see the gallery screen file first)
2. Offline queueing
3. Small fixes 3 and 4 if time allows