# FrogPaper Mobile 1.10.0 - release notes

**App 1.10.0 (versionCode 48) · Android 7.0+**

This is a big quality-of-life release: the gallery becomes searchable and easy to
manage, and the wallpaper you set is now fully in your control.

## New

- **Star wallpapers.** Tap the ★ on an image (or the ★ badge on a gallery tile).
  Wallpaper rotation's "My favourites" now rotates through your **starred
  pictures** - previously "favourites" meant favourite text prompts.
- **Search, sort & filter the gallery.** Search by the name **or the prompt**;
  sort by newest / oldest / favourites first / A-Z; a favourites-only filter; and
  a caption toggle (file name vs prompt). Your sort and filter are remembered
  between visits.
- **Long-press action sheet.** Long-press a tile for **Set as wallpaper / Add to
  favourites / Save to device / Share / Delete** - no need to open the image.
- **Undo a delete.** A delete is undoable for 5 seconds (a bar shows "Undo").
- **Prompt history.** A new screen lists every prompt your wallpapers were made
  from, built from the phone's own gallery, with **Make again** and **Edit**.
- **Share & bulk actions.** Share an image to any app through the system share
  sheet; a **Select** mode ticks several tiles to **Save** or **Delete** them
  together.
- **Faster gallery.** Cached 360px thumbnails plus list tuning keep the grid
  light with a large collection.
- **Engine status** in Settings - see which AI engines are ready right now.
- **Storage view & Clear cache** - gallery / thumbnails / offline-cache sizes,
  with a one-tap **Clear cache** that never touches your wallpapers.
- **Home / Lock / Both.** Choose which surface "Set as wallpaper" paints.
- **"New wallpaper now"** button on Home, and a one-time long-press tip.
- **Home / Lock screen / Both** chooser (Android).

## Backend

- **Searchable filenames.** Generated images now carry a short slug of the prompt,
  e.g. `pollinations_20260927-1502_lily-pond-at-dawn.png` (the provider prefix
  stays first so storage classification is unchanged). Uploads get a slug from
  the original name too. Takes effect on the next backend deploy / local run.

## Notes

- Nothing about your existing wallpapers changes; the new gallery features read
  the prompts already stored beside each saved image.
- Share works through the standard Android share sheet (one image at a time).
- App checks: 13 suites, 593 checks, all passing. Backend: subject enhancer 98 +
  filenames 17. Web bundle compiles. Release APK builds and installs on a Galaxy
  S9 (Android 10).
