// Where *saved* wallpapers land.
//
// Default (and the only option on iOS/web): the phone's photo gallery, through
// expo-media-library - the behaviour the app has always had.
//
// On Android the user can point saves at a folder on the SD card instead. That
// matters on a phone with a full internal storage, and it uses the Storage
// Access Framework: Android's own directory picker grants write access to one
// folder, the granted tree URI is remembered (Android keeps the grant across
// restarts), and every later save writes straight into it. No storage
// permission is added to the manifest and nothing is copied into the internal
// library.
//
// SAF lives in expo-file-system's legacy entrypoint - the new File/Directory
// API has no directory-picker or SAF create-file binding in SDK 57.
//
// This setting only affects wallpapers the user saves. The offline cache
// (src/services/imageCache.js) is a different thing: it always lives in the app
// cache directory inside internal storage, stays bounded, and is never written
// to the card no matter what is chosen here.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { downloadToCache } from './nativeSave';
import { saveToDevice } from './deviceMedia';

export const GALLERY = 'gallery';
export const FOLDER = 'folder';

const TARGET_KEY = '@frogpaper/save_target'; // set to 'folder' only while a folder is chosen
const FOLDER_KEY = '@frogpaper/save_folder'; // JSON { uri, name }
// Only the picker is Android-specific; reads still resolve to the gallery
// default elsewhere so screens can call saveWallpaper unconditionally.
const SAF_SUPPORTED = Platform.OS === 'android';

// The MIME type drives the extension Android gives the created document, so it
// is derived from the source filename where the backend gave us a usable one.
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const DEFAULT_MIME = 'image/jpeg';

function mimeFor(sourceFilename) {
  const name = String(sourceFilename || '');
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return DEFAULT_MIME;
  }
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] || DEFAULT_MIME;
}

// frogpaper-YYYYMMDD-HHMMSS. The clock is local time on purpose: the name is
// for the human browsing the folder, not for the server.
function timestampName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `frogpaper-${stamp}`;
}

// SAF tree URIs look like
//   content://com.android.externalstorage.documents/tree/1234-5678%3ASunset
// and there is no API that returns the folder's display name, so it is pulled
// out of the URI. The name is stored alongside the URI at pick time anyway -
// this is only what the picker gets to show when it comes back.
function folderNameFromUri(uri) {
  try {
    const afterTree = decodeURIComponent(String(uri)).split('/tree/').pop() || '';
    const colon = afterTree.indexOf(':');
    const name = colon >= 0 ? afterTree.slice(colon + 1) : afterTree;
    // The card's own root has no name after the colon.
    return name || 'SD card folder';
  } catch (err) {
    return 'SD card folder';
  }
}

// What saves should do right now: the phone gallery, or a SAF folder.
// Never throws - a missing/broken preference means "phone gallery".
export async function getSaveTarget() {
  if (!SAF_SUPPORTED) {
    return { target: GALLERY, folderName: null, folderUri: null };
  }
  try {
    const [marker, rawFolder] = await Promise.all([
      AsyncStorage.getItem(TARGET_KEY),
      AsyncStorage.getItem(FOLDER_KEY),
    ]);
    if (marker === FOLDER && rawFolder) {
      const folder = JSON.parse(rawFolder);
      if (folder && folder.uri) {
        return {
          target: FOLDER,
          folderName: folder.name || 'SD card folder',
          folderUri: folder.uri,
        };
      }
    }
  } catch (err) {
    // unreadable preference - fall back to the gallery default below
  }
  return { target: GALLERY, folderName: null, folderUri: null };
}

// Opens Android's directory picker. Resolves to { cancelled: true } when the
// user backs out - the current target is deliberately left untouched then.
// Throws only for unexpected native failures (e.g. a picker already open).
export async function chooseSaveFolder() {
  if (!SAF_SUPPORTED) {
    return {
      cancelled: true,
      message: 'Choosing an SD card folder is only available on Android.',
    };
  }
  const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!result || !result.granted || !result.directoryUri) {
    return { cancelled: true };
  }
  const name = folderNameFromUri(result.directoryUri);
  // Name is stored too: it is what Settings shows, and it cannot be recovered
  // from the URI for every provider.
  await AsyncStorage.setItem(TARGET_KEY, FOLDER);
  await AsyncStorage.setItem(FOLDER_KEY, JSON.stringify({ uri: result.directoryUri, name }));
  return { cancelled: false, name, uri: result.directoryUri };
}

// Back to the default - the SD card grant itself belongs to Android, not us.
export async function usePhoneGallery() {
  await AsyncStorage.removeItem(TARGET_KEY);
  await AsyncStorage.removeItem(FOLDER_KEY);
}

async function saveToFolder(remoteUrl, sourceFilename, folder) {
  let cachedFile = null;
  try {
    cachedFile = await downloadToCache(remoteUrl);
    // SAF has no "copy this file here" call: the bytes go through JS as base64
    // (writeAsStringAsync is the only SAF write binding in expo-file-system).
    const base64 = await cachedFile.base64();
    // createFileAsync wants the name *without* the extension - the provider
    // appends the right one from the MIME type, so a JPEG lands on the card as
    // frogpaper-YYYYMMDD-HHMMSS.jpg. Android uniques the name if a wallpaper
    // was already saved in the same second.
    const createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
      folder.uri,
      timestampName(),
      mimeFor(sourceFilename)
    );
    await FileSystem.StorageAccessFramework.writeAsStringAsync(createdUri, base64, {
      encoding: 'base64',
    });
    return { ok: true, target: FOLDER, message: `Saved to ${folder.name}.` };
  } catch (err) {
    // The folder can be deleted from a file manager, and access can be revoked
    // (or lost after a reboot) between saves. Report it - falling back to the
    // gallery here would put the picture somewhere the user did not ask for.
    console.warn('[FrogPaper] SD card save failed:', err);
    return {
      ok: false,
      target: FOLDER,
      message:
        `Could not save to ${folder.name}. The folder may have been removed, ` +
        "FrogPaper's access to it revoked, or the card may be full - open " +
        'Settings > Save location and choose the folder again.',
    };
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

// Single entry point for every save in the app. Resolves to
// { ok, target, message } instead of throwing, so callers can show the same
// notice whether the gallery or the card was the destination.
export async function saveWallpaper(remoteUrl, filename) {
  const target = await getSaveTarget();
  if (target.target === FOLDER && target.folderUri) {
    return saveToFolder(remoteUrl, filename, {
      uri: target.folderUri,
      name: target.folderName,
    });
  }
  try {
    await saveToDevice(remoteUrl);
    return {
      ok: true,
      target: GALLERY,
      message:
        Platform.OS === 'web'
          ? 'Downloaded to your downloads folder.'
          : 'Saved to your phone gallery.',
    };
  } catch (err) {
    // Permission denied, no space, network gone - the platform saver's message
    // is already written for the user.
    return {
      ok: false,
      target: GALLERY,
      message: (err && err.message) || 'Could not save the image.',
    };
  }
}

export default {
  GALLERY,
  FOLDER,
  getSaveTarget,
  chooseSaveFolder,
  usePhoneGallery,
  saveWallpaper,
};
