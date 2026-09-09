// Platform entrypoint: Android.
//
// - save to device: expo-media-library, works inside Expo Go.
// - set wallpaper: react-native-wallpaper-manager is a third-party NATIVE
//   module. Expo Go ships only Expo's own native modules, so inside Expo Go
//   we detect the missing module and degrade gracefully with guidance
//   instead of crashing. After `npx expo prebuild` (development build) the
//   direct wallpaper path becomes fully functional.
import { NativeModules } from 'react-native';
import { saveToDevice, downloadToCache } from './nativeSave';

export { saveToDevice };

export async function setAsWallpaper(remoteUrl) {
  const nativeModule = NativeModules.WallPaperManager;
  if (!nativeModule || typeof nativeModule.setWallpaper !== 'function') {
    return {
      ok: false,
      reason: 'requires-dev-build',
      message:
        'Direct wallpaper setting needs a development build (npx expo prebuild). For now, save the image and set it from your Gallery app.',
    };
  }

  let cachedFile = null;
  try {
    cachedFile = await downloadToCache(remoteUrl);
    const WallpaperManager = require('react-native-wallpaper-manager');
    const result = await new Promise((resolve) => {
      try {
        WallpaperManager.setWallpaper({ uri: cachedFile.uri }, (response) =>
          resolve(response)
        );
      } catch (callError) {
        resolve({ error: String(callError && callError.message) });
      }
    });
    if (result && result.error) {
      throw new Error(`Wallpaper error: ${result.error}`);
    }
    return { ok: true };
  } finally {
    if (cachedFile) {
      try {
        cachedFile.delete();
      } catch (cleanupError) {
        // best-effort cache cleanup
      }
    }
  }
}

export const capabilities = {
  canSave: true,
  // The button is shown on Android; if the native module is missing
  // (Expo Go) setAsWallpaper returns a clear explanation instead.
  canSetWallpaper: true,
};
