# Development build guide (Android wallpaper feature)

The "Set as wallpaper" button on Android is wired to
[`react-native-wallpaper-manager`](https://www.npmjs.com/package/react-native-wallpaper-manager),
a **third-party native module**. Expo Go only ships Expo's own native
modules, so:

| Environment | Save to device | Set as wallpaper (Android) |
|---|---|---|
| Expo Go | works | button explains it needs a dev build (graceful degradation, no crash) |
| Development build (`expo prebuild`) | works | **fully functional** |
| Web browser | downloads the file | not possible from browsers |

## Build a development APK on your Windows PC

```bash
cd mobile-app
npx expo prebuild --platform android   # generates the android/ project
npx expo run:android                   # build + install on a connected device/emulator
```

Requirements: Android Studio (SDK 35 + platform tools), JDK 17+,
`ANDROID_HOME` set. The first Gradle build downloads a lot - be patient.

The JS side needs zero changes: `src/services/deviceMedia.android.js`
detects the native `WallPaperManager` module at runtime and switches from
the guidance message to the real wallpaper call
(`WallpaperManager.setWallpaper({ uri: <local cache file> }, callback)`).

## Notes and honest caveats

- The wallpaper path downloads the image into the app cache first
  (`expo-file-system` new API), hands the local `file://` URI to the native
  module, then deletes the cache copy. The native side handles `file://`,
  `http(s)://` and data URIs; we prefer the local copy for reliability.
- The library sets the **system wallpaper**; choosing between home screen
  and lock screen is not exposed by its current API (v0.3.16).
- This flow has not been verified on a physical device yet - if the native
  call fails, the app shows the error in the notice bar and the save button
  still works as a fallback.
- iOS: Apple does not allow apps to change the wallpaper. There the UI
  offers save + "Photos > Share > Use as Wallpaper" guidance only.
