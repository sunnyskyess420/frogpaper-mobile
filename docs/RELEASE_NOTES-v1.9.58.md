# FrogPaper Mobile 1.9.58 — first public release

Turn a few words into a phone wallpaper. No account, no sign-up, nothing to configure —
install it and start typing.

## Install (Android 7.0 or newer)

1. Download **FrogPaper-1.9.58-release-signed.apk** from this release.
2. Android will ask whether to allow installing from this source — allow it.
   (That question appears for anything not installed from the Play Store.)
3. Open FrogPaper, type two words like "frog in a lily pond", tap **Generate**.

## What's in it

- **Make wallpapers from words** — two words is enough. Tap the dice for a surprise, or
  open **Build** and pick from lists (subject, style, lighting, colour, mood, atmosphere).
- **Set it as your wallpaper** in one tap, or let FrogPaper change it once a day on its own.
- **Everything stays on your phone.** Wallpapers are saved on the device, never on a
  server, and nothing is uploaded anywhere.
- **Offline-friendly** — the newest wallpapers stay on the phone, so the gallery opens
  with no signal. Anything that could not be made is retried later.
- **No account, no ads, no tracking, free.** The default engine needs no key at all.
- **Optional:** add your own free Google Gemini or Hugging Face key in Settings for
  sharper results. Entirely optional — the app never uses anyone else's keys.

## Good to know

- **The first wallpaper can take up to a minute.** The image service sleeps when nobody
  is using it and wakes when you ask. After that it is quick. If it times out, tap
  **Retry** — it costs nothing.
- **Backend:** a small free-tier server handles the generation. If it is busy you may see
  a brief wait.
- **Requirements:** Android 7.0+, roughly 80 MB of storage.

## File

```
FrogPaper-1.9.58-release-signed.apk
75.3 MB
SHA-256: 35259f6a02598b32c40f7c1e09f5d1d9a6696056eb7bd4f5fcdc6cd32bcd63c2
```

To check the download: on Windows, `certutil -hashfile FrogPaper-1.9.58-release-signed.apk SHA256`
should print exactly that.
