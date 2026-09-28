// Share a wallpaper out to other apps (Messages, Instagram, ...) through the
// Android/iOS share sheet.
//
// A remote image is downloaded to the cache first, and a local file is copied
// there too, so expo-sharing can hand a real file to the target app.
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { downloadToCache } from './nativeSave';

export async function shareWallpaper(remoteOrLocalUri) {
  try {
    if (!remoteOrLocalUri) {
      return { ok: false, message: 'There is nothing to share.' };
    }
    if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
      return { ok: false, message: 'Sharing is not available on this device.' };
    }
    // A file in the cache is what expo-sharing can expose to other apps.
    const file = await downloadToCache(remoteOrLocalUri);
    if (!file || !file.uri) {
      return { ok: false, message: 'Could not prepare the image to share.' };
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'image/*',
      dialogTitle: 'Share wallpaper',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err && err.message) || 'Could not share that image.' };
  }
}

export default { shareWallpaper };
