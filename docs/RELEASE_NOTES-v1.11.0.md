# FrogPaper Mobile 1.11.0 - Halloween Edition - release notes

**App 1.11.0 (versionCode 49) · Android 7.0+**

A small seasonal release: the app puts on its Halloween costume.

## New

- **Halloween theme.** For this release the app is dressed in pumpkin orange
  on a haunted purple night - buttons, cards, notices, controls and every
  surface follow the seasonal palette. Nothing about how the app works
  changes; it just looks ready for the 31st.
- **Full file name on the image screen.** The detail view now shows the
  complete file name (it wraps, and you can select it); gallery captions wrap
  to two lines so long names stay readable.
- **Palette check.** A new headless check (`npm run check:theme`) keeps the
  classic and Halloween palettes interchangeable - same tokens, the same
  contrast floors, and no brand colours leaking out of the theme file.

## Notes

- Your wallpapers, gallery, prompts, keys and settings are untouched.
- The frog-green look is not gone: the next release flips one switch
  (`EDITION` in `src/theme.js`) and the app returns to it.
- App checks: 15 suites, 630 checks, all passing. The release APK builds and
  is signed with the FrogPaper release key (signature verified against the
  documented fingerprint).
