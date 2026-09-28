// Platform entrypoint: Android.
//
// - save to device: expo-media-library, works inside Expo Go.
// - set wallpaper: react-native-wallpaper-manager is a third-party NATIVE
//   module. Expo Go ships only Expo's own native modules, so inside Expo Go
//   we detect the missing module and degrade gracefully with guidance
//   instead of crashing. After `npx expo prebuild` (development build) the
//   direct wallpaper path becomes fully functional.
//
// Target: `target` chooses which surface to paint - 'home' (the default, and
// what every older build did), 'lock', or 'both'. The native module reads it and
// passes the matching WallpaperManager flag. A build that predates this option
// simply ignores the extra key and sets the home screen, so passing it is safe.
import { NativeModules } from 'react-native';
import { saveToDevice, downloadToCache } from './nativeSave';

export { saveToDevice };

export const WALLPAPER_TARGETS = ['home', 'lock', 'both'];

function normalizeTarget(target) {
  return WALLPAPER_TARGETS.includes(target) ? target : 'home';
}

export async function setAsWallpaper(remoteUrl, target = 'home') {
  const nativeModule = NativeModules.WallPaperManager;
  if (!nativeModule || typeof nativeModule.setWallpaper !== 'function') {
    return {
      ok: false,
      reason: 'requires-dev-build',
      message:
        'Direct wallpaper setting needs a development build (npx expo prebuild). For now, save the image and set it from your Gallery app.',
    };
  }

  const which = normalizeTarget(target);
  let cachedFile = null;
  try {
    cachedFile = await downloadToCache(remoteUrl);
    // Call the native module directly (not through the library's JS wrapper) so
    // the `target` key reaches our WallPaperManager.java untouched.
    const result = await new Promise((resolve) => {
      try {
        nativeModule.setWallpaper({ uri: cachedFile.uri, target: which }, (response) =>
          resolve(response)
        );
      } catch (callError) {
        resolve({ error: String(callError && callError.message) });
      }
    });
    if (result && result.error) {
      throw new Error(`Wallpaper error: ${result.error}`);
    }
    return { ok: true, target: which };
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
  // Whether the lock/home choice is offered. The native build honours it; an
  // older build degrades to the home screen.
  wallpaperTargets: WALLPAPER_TARGETS,
};
