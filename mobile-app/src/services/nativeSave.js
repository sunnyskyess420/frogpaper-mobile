// Shared native save-to-gallery logic (used by iOS and Android entries).
//
// Flow: download the backend image into the app cache directory, then move
// it into the device media library, then clean up the cache copy.
//
// SDK 57 notes:
//   - expo-file-system uses the new class API (File / Directory / Paths).
//   - expo-media-library's functional save API lives at
//     "expo-media-library/legacy" (the top-level one is a deprecated stub).
import * as MediaLibrary from 'expo-media-library/legacy';
import { File, Paths } from 'expo-file-system';

export async function ensureMediaPermission() {
  let status = await MediaLibrary.getPermissionsAsync();
  if (!status || !status.granted) {
    status = await MediaLibrary.requestPermissionsAsync();
  }
  if (!status || !status.granted) {
    const error = new Error(
      'Photo library permission denied. Allow photo access in system settings to save wallpapers.'
    );
    error.code = 'PERMISSION_DENIED';
    throw error;
  }
}

export async function downloadToCache(remoteUrl) {
  const file = await File.downloadFileAsync(remoteUrl, Paths.cache);
  if (!file || !file.uri) {
    throw new Error('Could not download the image for saving.');
  }
  return file;
}

export async function saveToDevice(remoteUrl) {
  await ensureMediaPermission();
  let cachedFile = null;
  try {
    cachedFile = await downloadToCache(remoteUrl);
    await MediaLibrary.saveToLibraryAsync(cachedFile.uri);
    return { ok: true };
  } finally {
    if (cachedFile) {
      try {
        cachedFile.delete();
      } catch (cleanupError) {
        // best-effort cache cleanup - never blocks the save result
      }
    }
  }
}

export { File };
