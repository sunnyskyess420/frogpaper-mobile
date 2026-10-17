# FrogPaper Mobile 1.11.2 - release notes

**App 1.11.2 (versionCode 51) · Android 7.0+**

A small, focused fix: automatic wallpapers now use the engine you picked.

## Fixed

- **Automatic wallpapers use your saved engine.** "Once a day" and "Every time
  I open" with the "Surprise me" source used to generate through Pollinations
  even after you chose Hugging Face, Gemini or Replicate on the Generate screen.
  The automatic run now reads the saved engine, checks it is still usable
  (active, or with your own key), and asks the backend for that engine
  explicitly.
- **No more silent Pollinations wallpaper.** If the selected engine's key is
  gone, the engine is no longer offered, or the backend quietly falls back to
  the free engine, the run is treated as a failure: the current wallpaper stays,
  and the usual 2-hour retry cooldown applies.
- **Fresh installs are unchanged.** With no engine ever saved, the backend
  default (free Pollinations) is used exactly as before.

## Install

1. Download `FrogPaper-release-signed.apk` below.
2. Android 7.0 or newer. Allow installs from your browser or file manager when
   Android asks ("Install unknown apps").
3. Install over an existing FrogPaper install - this build is signed with the
   same release key, so there is no need to uninstall first.

APK SHA-256: `eccc88aa5ab4fae9d08a8b8a073ba0c2dae874818a648300fe7873b490b23baa`

## Notes

- Generating needs a reachable FrogPaper backend; the app ships pointing at the
  public one. Your own API keys stay on the phone.
- App checks: 15 suites, 646 checks passing (`check:sentry` needs a DSN). The APK is signed
  with the FrogPaper release key (`CN=FrogPaper`).
