# FrogPaper Mobile 1.14.0 - release notes

**App 1.14.0 (versionCode 56) · Android 7.0+**

Themes you can pick, a Build screen that gets out of the way, and the Recipes
picker working again.

## New

- **Five themes, switched in Settings.** Appearance now offers Halloween, frog
  green, Tide (deep sea blue), Blossom (plum and pink) and **Daylight**, a
  proper light theme for bright rooms. Tapping one repaints the whole app -
  headers, cards, buttons, sheets and notices - and the choice is remembered on
  the phone. Halloween is still the default, so nothing changes until you pick.
- **Filter and Recents in every picker.** Rows with 12+ options (subjects,
  styles, lighting, moods, atmospheres) get a filter field, and the last five
  values you picked for a row come back as chips at the top of its sheet.
- **Clear all is undoable.** Six seconds to take back an accidental wipe, right
  under the buttons.
- **Build remembers your choices.** A half-built prompt survives closing the
  app, and the last change is written even if you leave immediately.

## Fixed

- **Recipes are reachable again.** The Recipes row, its picker (star, "Yours",
  delete) and the save panel had been left as unreachable code: the state,
  handlers and styles were all there, but nothing in the rendered screen opened
  them. Recipe mode and every recipe slot work once more.
- **History keeps the Avoid list.** "Make again" and "Edit" used to hand only
  the prompt to Generate, dropping the entry's negative prompt - the same prompt
  could quietly come back different. Both now carry the Avoid text with it.
- **Deleting the recipe you are previewing** no longer leaves the screen
  pointing at something that no longer exists.
- **The picker sheet lifts above the keyboard.** On iOS the custom-value field
  and the lower options could sit behind the keyboard; the sheet now moves and
  dragging the list dismisses it.

## Under the hood

- Screens build their styles through `themedStyles()`, which rebuilds them when
  the palette changes; raw hex colours no longer live in screens, components or
  the navigator.
- `npm run check:ui` mounts the Build screen and drives every dropdown, filter,
  recent, undo and recipe flow (130 checks).
- `npm run check:screens` mounts all seven screens and the shared components,
  then drives Settings -> Appearance through all five themes (22 checks).
- `npm run check:theme` now covers five palettes: same tokens, same contrast
  thresholds, light/dark scheme declared and matching, no raw colours (51
  checks).
- `npm run check:versions` compares `app.json` and `package.json`, and skips the
  Gradle comparison when `android/` has not been generated instead of crashing.

## Install

1. Download `FrogPaper-release-signed.apk` below.
2. Android 7.0 or newer. Allow installs from your browser or file manager when
   Android asks ("Install unknown apps").
3. Install over an existing FrogPaper install - this build is signed with the
   same release key, so there is no need to uninstall first.

APK SHA-256: `<fill in after signing: Get-FileHash .\FrogPaper-release-signed.apk -Algorithm SHA256>`
