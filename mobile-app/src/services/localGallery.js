// The phone's own wallpaper gallery.
//
// The backend's image storage is ephemeral - a deploy wipes it - so the phone
// keeps its own copy of every wallpaper the owner generates, saves or imports.
// Files live in the *document* directory (persistent: Android may clear the
// cache directory under storage pressure, which is fine for the offline cache
// but not for the owner's images), one file per image, with an optional JSON
// sidecar carrying what we know about it (prompt, size, where it came from).
//
// Everything here is best-effort: a missing folder, a revoked SD-card grant or
// a malformed sidecar must degrade to "no images", never to an exception.
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { FOLDER, getSaveTarget } from './saveTarget';

const DIR_NAME = 'wallpapers';
const META_SUFFIX = '.json';

export const SOURCE_PHONE = 'phone';
export const SOURCE_IMPORTED = 'imported';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'];

// expo-file-system is a stub on web and there is no document directory to keep
// a gallery in - every function here is a no-op there.
const supported = Platform.OS !== 'web';

let cachedDir = null;

// Lazy on purpose: the headless checks stub expo-file-system with a minimal
// double, and touching Paths/Directory at import time would crash them.
function localDir() {
  if (!supported) {
    return null;
  }
  try {
    if (cachedDir && cachedDir.exists) {
      return cachedDir;
    }
    const root = Paths && Paths.document;
    if (!root) {
      return null;
    }
    const dir = new Directory(root, DIR_NAME);
    cachedDir = dir;
    return dir;
  } catch (err) {
    return null;
  }
}

// Creates <documents>/wallpapers if needed. Returns the Directory, or null when
// the store is unavailable (web, no document directory).
export function ensureLocalDir() {
  const dir = localDir();
  if (!dir) {
    return null;
  }
  try {
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
    return dir.exists ? dir : null;
  } catch (err) {
    return null;
  }
}

// The API serves filenames through <path:filename>, so a name may contain a
// separator. The store is flat, so separators are folded - still deterministic,
// so a filename maps straight back to its file.
function storeName(filename) {
  return String(filename || '').replace(/[\\/]+/g, '__');
}

function isDirectoryEntry(entry) {
  return !!entry && typeof entry.list === 'function';
}

function isMetaName(name) {
  return String(name).endsWith(META_SUFFIX);
}

function isImageName(name) {
  const value = String(name);
  const dot = value.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return IMAGE_EXTENSIONS.includes(value.slice(dot + 1).toLowerCase());
}

function lastModified(file) {
  const stamp = file.lastModified || file.modificationTime || 0;
  return Number.isFinite(stamp) ? stamp : 0;
}

function listImages(dir) {
  try {
    return dir
      .list()
      .filter((entry) => !isDirectoryEntry(entry))
      .filter((file) => isImageName(file.name) && !isMetaName(file.name));
  } catch (err) {
    return [];
  }
}

async function readMeta(dir, filename) {
  try {
    const metaFile = new File(dir, filename + META_SUFFIX);
    if (!metaFile.exists) {
      return null;
    }
    const parsed = JSON.parse(await metaFile.text());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

async function writeMeta(dir, filename, meta) {
  if (!meta || typeof meta !== 'object' || Object.keys(meta).length === 0) {
    return false;
  }
  try {
    const metaFile = new File(dir, filename + META_SUFFIX);
    if (metaFile.exists) {
      metaFile.delete();
    }
    metaFile.write(JSON.stringify(meta));
    return true;
  } catch (err) {
    return false;
  }
}

function describe(file, meta) {
  const info = meta && typeof meta === 'object' ? meta : null;
  const descriptor = {
    filename: file.name,
    uri: file.uri,
    size: file.size || 0,
    mtime: lastModified(file),
    source: info && info.source === SOURCE_IMPORTED ? SOURCE_IMPORTED : SOURCE_PHONE,
  };
  if (info && Number.isFinite(info.width)) {
    descriptor.width = info.width;
  }
  if (info && Number.isFinite(info.height)) {
    descriptor.height = info.height;
  }
  return descriptor;
}

// Newest first, so the grid matches the server list's ordering. Never throws:
// an unavailable store is simply an empty gallery.
export async function listLocalImages() {
  const dir = localDir();
  if (!dir || !dir.exists) {
    return [];
  }
  const images = listImages(dir);
  const out = [];
  for (const file of images) {
    const meta = await readMeta(dir, file.name);
    out.push(describe(file, meta));
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export async function localImageCount() {
  const dir = localDir();
  if (!dir || !dir.exists) {
    return 0;
  }
  return listImages(dir).length;
}

// One image plus whatever the sidecar knew (used by the Detail screen).
export async function getLocalImage(filename) {
  const dir = localDir();
  const name = storeName(filename);
  if (!dir || !dir.exists || !name) {
    return null;
  }
  try {
    const file = new File(dir, name);
    if (!file.exists) {
      return null;
    }
    const meta = await readMeta(dir, name);
    return { ...describe(file, meta), meta: meta || null };
  } catch (err) {
    return null;
  }
}

// Stores one image. `remoteUrl` downloads it (the generation/save path);
// `bytes` writes already-held data - a base64 string (the SD import path) or a
// Uint8Array. Idempotent by filename: saving the same name again overwrites
// that file instead of adding a second copy.
export async function saveLocalImage({ bytes, remoteUrl, localUri, filename, meta } = {}) {
  const dir = ensureLocalDir();
  if (!dir) {
    return { ok: false, message: 'This phone cannot keep a local gallery.' };
  }
  const name = storeName(filename);
  if (!name) {
    return { ok: false, message: 'The image has no filename.' };
  }

  try {
    const dest = new File(dir, name);
    if (bytes !== undefined && bytes !== null) {
      if (dest.exists) {
        dest.delete();
      }
      if (typeof bytes === 'string') {
        dest.write(bytes, { encoding: 'base64' });
      } else {
        dest.write(bytes);
      }
    } else if (localUri) {
      // A picture that is already on this phone (picked from the library):
      // copy the file itself - no download, no re-encode, whatever format it is.
      const source = new File(localUri);
      if (!source.exists) {
        return { ok: false, message: "Couldn't read that image from your phone." };
      }
      await source.copy(dest);
    } else if (remoteUrl) {
      await File.downloadFileAsync(remoteUrl, dest, { idempotent: true });
    } else {
      return { ok: false, message: 'There is nothing to save.' };
    }
    await writeMeta(dir, name, meta);
    return { ok: true, filename: name, uri: dest.uri, size: dest.size || 0 };
  } catch (err) {
    return {
      ok: false,
      message: (err && err.message) || 'Could not save the image on this phone.',
    };
  }
}

// Removes the image and its sidecar - and nothing else.
export async function deleteLocalImage(filename) {
  const dir = localDir();
  const name = storeName(filename);
  if (!dir || !dir.exists || !name) {
    return { ok: true, removed: 0 };
  }
  let removed = 0;
  try {
    const file = new File(dir, name);
    if (file.exists) {
      file.delete();
      removed = 1;
    }
  } catch (err) {
    // fall through - the sidecar is still worth removing
  }
  try {
    const metaFile = new File(dir, name + META_SUFFIX);
    if (metaFile.exists) {
      metaFile.delete();
    }
  } catch (err) {
    // best-effort
  }
  return { ok: true, removed };
}

// SAF document URIs look like
//   content://.../document/1234-5678%3ASunset%2Ffrogpaper-20260101-101010.jpg
// so the human name is the last path segment, with the provider's "primary:"
// prefix (if any) stripped.
function nameFromSafUri(uri) {
  try {
    const decoded = decodeURIComponent(String(uri));
    const last = decoded.split('/').pop() || '';
    const colon = last.lastIndexOf(':');
    return colon >= 0 ? last.slice(colon + 1) : last;
  } catch (err) {
    return '';
  }
}

function indexBySize(dir) {
  const index = new Map();
  for (const file of listImages(dir)) {
    index.set(file.name, file.size || 0);
  }
  return index;
}

// A free name: the wanted one, or name-1/name-2... when a different file
// already owns it.
function uniqueName(index, name) {
  if (!index.has(name)) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let counter = 1;
  let candidate = `${stem}-${counter}${ext}`;
  while (index.has(candidate)) {
    counter += 1;
    candidate = `${stem}-${counter}${ext}`;
  }
  return candidate;
}

// Copies the images out of the chosen SD-card folder into the phone store,
// skipping anything whose name+size is already here, newest information first
// where Android gives it. `max` caps how many images one run imports.
export async function importFromFolder({ max = 40 } = {}) {
  const empty = { imported: 0, skipped: 0, failed: 0 };
  const dir = ensureLocalDir();
  if (!dir) {
    return { ok: false, ...empty, reason: 'unsupported', message: 'This phone cannot keep a local gallery.' };
  }

  const target = await getSaveTarget();
  if (target.target !== FOLDER || !target.folderUri) {
    return {
      ok: false,
      ...empty,
      reason: 'no-folder',
      folderName: null,
      message:
        'No SD card folder is chosen yet. Open Settings > Wallpaper and choose ' +
        'the folder FrogPaper saves to.',
    };
  }

  let uris;
  try {
    uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(target.folderUri);
  } catch (err) {
    // Access can be revoked from a file manager, or lost after a reboot.
    return {
      ok: false,
      ...empty,
      reason: 'unreadable',
      folderName: target.folderName,
      message:
        `Could not read ${target.folderName || 'that folder'}. Android may have ` +
        'revoked access - choose the folder again in Settings.',
    };
  }

  if (!Array.isArray(uris) || uris.length === 0) {
    return {
      ok: true,
      ...empty,
      reason: 'empty',
      folderName: target.folderName,
      message: 'That folder has no images yet.',
    };
  }

  const index = indexBySize(dir);
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const candidates = [];
  for (const uri of uris) {
    const name = nameFromSafUri(uri);
    if (!name) {
      continue;
    }
    if (!isImageName(name)) {
      skipped += 1; // e.g. a subfolder or a .txt note in the same folder
      continue;
    }
    candidates.push({ uri, name });
  }

  for (const candidate of candidates) {
    if (imported >= Math.max(1, max)) {
      break;
    }
    try {
      const info = await FileSystem.getInfoAsync(candidate.uri, { size: true });
      if (!info || !info.exists || info.isDirectory) {
        skipped += 1;
        continue;
      }
      const size = Number(info.size) || 0;
      if (index.has(candidate.name) && index.get(candidate.name) === size) {
        skipped += 1; // already imported at this exact size
        continue;
      }
      const base64 = await FileSystem.StorageAccessFramework.readAsStringAsync(
        candidate.uri,
        { encoding: 'base64' }
      );
      if (!base64) {
        failed += 1;
        continue;
      }
      const name = uniqueName(index, candidate.name);
      const dest = new File(dir, name);
      if (dest.exists) {
        dest.delete();
      }
      dest.write(base64, { encoding: 'base64' });
      await writeMeta(dir, name, {
        source: SOURCE_IMPORTED,
        importedFrom: target.folderName || null,
        importedAt: Date.now(),
      });
      index.set(name, dest.size || size);
      imported += 1;
    } catch (err) {
      failed += 1; // one unreadable file must not stop the rest
    }
  }

  const skipNote = skipped > 0 ? ` ${skipped} already here or not an image.` : '';
  const failNote = failed > 0 ? ` ${failed} could not be copied.` : '';
  return {
    ok: true,
    imported,
    skipped,
    failed,
    folderName: target.folderName,
    reason: imported > 0 ? null : 'nothing-new',
    message:
      imported > 0
        ? `Imported ${imported} image${imported === 1 ? '' : 's'} from ${
            target.folderName || 'your folder'
          }.${skipNote}${failNote}`
        : `Nothing new to import from ${target.folderName || 'that folder'}.${skipNote}${failNote}`,
  };
}

// One-line wording shared by the Gallery and Settings screens.
export function describeImport(result) {
  if (!result) {
    return 'Import did not run.';
  }
  if (result.message) {
    return result.message;
  }
  if (result.ok) {
    return `Imported ${result.imported} image${result.imported === 1 ? '' : 's'}.`;
  }
  return 'Could not import from the folder.';
}

export default {
  SOURCE_PHONE,
  SOURCE_IMPORTED,
  ensureLocalDir,
  listLocalImages,
  localImageCount,
  getLocalImage,
  saveLocalImage,
  deleteLocalImage,
  importFromFolder,
  describeImport,
};
