// Small cached thumbnails for the gallery grid.
//
// The grid used to render every full-resolution wallpaper, which gets heavy once
// there are a lot of images. This makes a small JPEG (360px wide) per picture the
// first time it is shown, caches it in the cache directory, and reuses it after
// that. Cache-only on purpose: a cleared cache just regenerates them.
//
// Best-effort everywhere: web, a missing source, or any failure returns null and
// the caller falls back to the full image.
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const DIR_NAME = 'frogpaper-thumbs';
const THUMB_WIDTH = 360;

const supported = Platform.OS !== 'web';
let cachedDir = null;

function thumbsDir() {
  if (!supported) {
    return null;
  }
  try {
    if (cachedDir && cachedDir.exists) {
      return cachedDir;
    }
    const root = Paths && Paths.cache;
    if (!root) {
      return null;
    }
    cachedDir = new Directory(root, DIR_NAME);
    return cachedDir;
  } catch (err) {
    return null;
  }
}

function ensureDir() {
  const dir = thumbsDir();
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

// Keyed by filename + mtime, so regenerating or re-saving an image makes a fresh
// thumbnail instead of showing a stale one.
function keyFor(item) {
  const base = String(item.filename || 'thumb').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const stamp = item.mtime || 0;
  return `${base}-${stamp}.jpg`;
}

// The cached thumbnail uri for a local image, making one if needed. Null when
// thumbnails are unavailable (web, no source, or a failure).
export async function getThumbnailUri(item) {
  if (!supported || !item || !item.uri) {
    return null;
  }
  const dir = ensureDir();
  if (!dir) {
    return null;
  }
  try {
    const target = new File(dir, keyFor(item));
    if (target.exists) {
      return target.uri;
    }
    const result = await manipulateAsync(
      item.uri,
      [{ resize: { width: THUMB_WIDTH } }],
      { compress: 0.7, format: SaveFormat.JPEG }
    );
    if (!result || !result.uri) {
      return null;
    }
    const source = new File(result.uri);
    if (target.exists) {
      target.delete();
    }
    await source.copy(target);
    return target.exists ? target.uri : null;
  } catch (err) {
    return null;
  }
}

export async function getThumbnailStats() {
  const dir = thumbsDir();
  if (!dir || !dir.exists) {
    return { count: 0, bytes: 0 };
  }
  try {
    const files = dir.list().filter((entry) => typeof entry.list !== 'function');
    let bytes = 0;
    for (const file of files) {
      bytes += file.size || 0;
    }
    return { count: files.length, bytes };
  } catch (err) {
    return { count: 0, bytes: 0 };
  }
}

// Removes every cached thumbnail (not the images themselves).
export async function clearThumbnails() {
  const dir = thumbsDir();
  if (!dir || !dir.exists) {
    return { removed: 0 };
  }
  let removed = 0;
  try {
    const files = dir.list().filter((entry) => typeof entry.list !== 'function');
    for (const file of files) {
      try {
        file.delete();
        removed += 1;
      } catch (err) {
        // skip a locked file
      }
    }
  } catch (err) {
    // best-effort
  }
  return { removed };
}

export default { getThumbnailUri, getThumbnailStats, clearThumbnails };
