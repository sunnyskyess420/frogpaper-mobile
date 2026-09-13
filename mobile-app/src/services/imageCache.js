// Offline image cache.
//
// Every gallery tile, detail view and slideshow frame points at
// /api/images/<filename>. When the backend is unreachable those requests fail
// and the UI would show empty boxes even though the wallpaper still exists on
// this phone. This module keeps a copy of the newest images on the device,
// named after the server file, so filename -> local path is a direct lookup
// (no index that could drift out of sync with the directory).
//
// The copies live in the app cache directory: Android/iOS are free to delete
// them under storage pressure, which is harmless - the next successful gallery
// load refills the newest ones.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import api from './api';

const CACHE_DIR_NAME = 'wallpapers';
const PART_SUFFIX = '.part';
export const DEFAULT_MAX_FILES = 60;

// expo-file-system is a warning stub on web (and the browser has its own image
// cache), so every function here is a no-op there and callers fall back to the
// plain remote URL.
const supported = Platform.OS !== 'web';

let cachedDir = null;
// Concurrent gallery loads (e.g. Home + Gallery) must not download the same
// 60 files twice; later callers join the run already in flight.
let cacheRun = null;

function cacheDir() {
  if (!supported) {
    return null;
  }
  // Re-check existence instead of trusting the cached handle: Android/iOS may
  // wipe the cache directory while the app is running.
  if (cachedDir && cachedDir.exists) {
    return cachedDir;
  }
  const dir = new Directory(Paths.cache, CACHE_DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  cachedDir = dir;
  return dir;
}

// The API serves filenames through <path:filename>, so a name may contain a
// separator. A flat cache directory cannot hold subfolders, so separators are
// folded into the name - still deterministic, so the lookup stays direct.
function localName(filename) {
  return String(filename).replace(/[\\/]+/g, '__');
}

function cacheFile(filename) {
  const dir = cacheDir();
  if (!dir || !filename) {
    return null;
  }
  return new File(dir, localName(filename));
}

function lastModified(file) {
  // lastModified is the non-deprecated name; fall back for older SDK builds.
  const stamp = file.lastModified || file.modificationTime || 0;
  return Number.isFinite(stamp) ? stamp : 0;
}

// Duck-typed on purpose: list() hands back File/Directory instances whose
// prototype chain is not guaranteed across SDK builds, but only directories
// expose list().
function isDirectoryEntry(entry) {
  return !!entry && typeof entry.list === 'function';
}

function listCacheFiles() {
  const dir = cacheDir();
  if (!dir || !dir.exists) {
    return [];
  }
  try {
    return dir
      .list()
      .filter((entry) => !isDirectoryEntry(entry))
      .sort((a, b) => lastModified(a) - lastModified(b)); // oldest first
  } catch (err) {
    return [];
  }
}

// SYNC on purpose: the render path (<WallpaperImage>) needs to know whether a
// local copy exists without awaiting, so it can pick a source in one pass.
// Returns a local file:// uri, or null when nothing is cached.
export function getCachedUri(filename) {
  if (!supported || !filename) {
    return null;
  }
  try {
    const file = cacheFile(filename);
    return file && file.exists ? file.uri : null;
  } catch (err) {
    return null;
  }
}

// Downloads the image if it is not cached yet. Resolves to the local uri, or
// null when the download did not work (offline, server error, no disk space).
export async function ensureCached(filename) {
  if (!supported || !filename) {
    return null;
  }
  const existing = getCachedUri(filename);
  if (existing) {
    return existing;
  }
  const target = cacheFile(filename);
  if (!target) {
    return null;
  }
  // Download into a temp file first: Android leaves a partially written file
  // behind when a download dies, and a truncated file would otherwise be
  // served as a "cached" wallpaper forever.
  const temp = new File(cacheDir(), `${localName(filename)}${PART_SUFFIX}`);
  try {
    const downloaded = await File.downloadFileAsync(api.imageUrl(filename), temp, {
      idempotent: true,
    });
    if (!downloaded || !downloaded.exists || !(downloaded.size > 0)) {
      return null;
    }
    if (target.exists) {
      target.delete();
    }
    await downloaded.move(target);
    return target.exists ? target.uri : null;
  } catch (err) {
    try {
      if (temp.exists) {
        temp.delete();
      }
    } catch (cleanupError) {
      // best-effort - the next prune sweep removes stale temp files
    }
    return null;
  }
}

// Keeps the newest `max` files (by modification time) and deletes the rest, so
// the cache cannot grow without bound on a phone with limited storage.
export async function pruneToMax(max = DEFAULT_MAX_FILES) {
  if (!supported) {
    return { removed: 0, kept: 0 };
  }
  const files = listCacheFiles();
  const doomed = files.slice(0, Math.max(0, files.length - max));
  let removed = 0;
  for (const file of doomed) {
    try {
      file.delete();
      removed += 1;
    } catch (err) {
      // a file we cannot delete just stays until the next sweep
    }
  }
  return { removed, kept: files.length - removed };
}

// Caches up to `max` images, newest first (the gallery API returns newest
// first). Downloads run one at a time: 60 parallel requests would fight over
// the phone's connection and the queue would still only get one image per
// request from the server anyway. Returns how many images are on disk.
export async function cacheGalleryImages(filenames, max = DEFAULT_MAX_FILES) {
  if (!supported || !Array.isArray(filenames) || filenames.length === 0) {
    return 0;
  }
  const wanted = filenames.slice(0, Math.max(1, max));
  let cached = 0;
  for (const filename of wanted) {
    if (getCachedUri(filename)) {
      cached += 1;
      continue;
    }
    const uri = await ensureCached(filename);
    if (uri) {
      cached += 1;
    }
  }
  await pruneToMax(max);
  return cached;
}

// Shared entry point used by the screens: coalesces overlapping runs.
export function startGalleryCacheRun(filenames, max = DEFAULT_MAX_FILES) {
  if (cacheRun) {
    return cacheRun;
  }
  cacheRun = cacheGalleryImages(filenames, max).finally(() => {
    cacheRun = null;
  });
  return cacheRun;
}

export async function clearCache() {
  if (!supported) {
    return { removed: 0 };
  }
  const dir = cacheDir();
  let removed = 0;
  try {
    removed = dir && dir.exists ? listCacheFiles().length : 0;
    if (dir && dir.exists) {
      dir.delete(); // deletes the directory and everything inside it
    }
  } catch (err) {
    // leave cachedDir alone below so the next call retries the delete
  }
  cachedDir = null; // recreated on the next use
  return { removed };
}

export async function getCacheStats() {
  if (!supported) {
    return { count: 0, bytes: 0 };
  }
  const files = listCacheFiles().filter((file) => !file.name.endsWith(PART_SUFFIX));
  let bytes = 0;
  for (const file of files) {
    bytes += file.size || 0;
  }
  return { count: files.length, bytes };
}

export default {
  getCachedUri,
  ensureCached,
  cacheGalleryImages,
  startGalleryCacheRun,
  pruneToMax,
  clearCache,
  getCacheStats,
};
