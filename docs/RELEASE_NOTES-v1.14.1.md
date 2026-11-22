# FrogPaper Mobile 1.14.1 - release notes

**App 1.14.1 (versionCode 57) · Android 7.0+**

A small release: the Build screen now explains itself, in the app.

## New

- **A guide to the Build screen, under Settings -> Help.** "How to build a
  prompt" opens a full-screen page that walks the rows in order: Recipe, Mode,
  Subject, Setting, Style, Lighting, Colour, Mood, Atmosphere - what each one
  wants, and the two traps worth knowing (a *thing* rather than a feeling as the
  subject; a *place* rather than a format as the setting).
- **What the buttons do** - Use this prompt, Randomise, Clear all (and its
  undo), plus the type-your-own field, the filter on long lists and the Recent
  chips.
- **Four rules that do most of the work**, and the worked example from a real
  attempt: Subject "Christmas" + Setting "Christmas movie poster" + Cinematic
  produced a lone tree in green fog, and the page shows the row-by-row fix that
  turns it into a Christmas card.
- **Both answers in one card.** Help also holds the existing "How do I get AI
  keys?" sheet, so the two questions people actually ask are next to each other.

## Unchanged from 1.14.0

Five themes (incl. Daylight), the filter and Recent chips in every picker,
undoable Clear all, the remembered Build selection, and the restored Recipes
picker - all still there.

## Checks

- `npm run check:screens` now opens the Help card and the guide, asserts every
  row is named and the worked example is present, then closes it (28 checks).
- Whole suite: 19 suites, 938 checks, 0 failures.

## Install

1. Download `FrogPaper-release-signed.apk` below.
2. Android 7.0 or newer. Allow installs from your browser or file manager when
   Android asks ("Install unknown apps").
3. Install over an existing FrogPaper install - this build is signed with the
   same release key, so there is no need to uninstall first.

APK SHA-256: `<fill in after signing>`
