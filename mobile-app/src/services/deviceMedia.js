// Platform entrypoint: iOS (and any other native platform).
//
// - save to device: works (expo-media-library)
// - set wallpaper: iOS does not expose an API for apps to change the
//   wallpaper, so we return a clear manual fallback message instead.
import { Platform } from 'react-native';
import { saveToDevice } from './nativeSave';

export { saveToDevice };

export async function setAsWallpaper(_remoteUrl) {
  return {
    ok: false,
    reason: 'unsupported',
    message:
      Platform.OS === 'ios'
        ? 'iOS does not let apps change the wallpaper directly. Save the image, then open Photos > Share > "Use as Wallpaper".'
        : 'Changing the wallpaper directly is not supported on this platform.',
  };
}

export const capabilities = {
  canSave: true,
  canSetWallpaper: false,
};
