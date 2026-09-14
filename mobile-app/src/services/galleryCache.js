// Offline gallery list.
//
// The grid needs a list of filenames before it can show anything, and without
// the backend there is no list at all - the app would look empty even though
// imageCache still holds the actual image files. The last successful
// /api/gallery response is kept in AsyncStorage and replayed when the live
// fetch fails, so the UI can say "showing wallpapers saved on this phone"
// instead of "No wallpapers yet".
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { DEFAULT_MAX_FILES, startGalleryCacheRun } from './imageCache';

const GALLERY_CACHE_KEY = '@frogpaper/gallery_cache';

function normalize(response) {
  const images = Array.isArray(response && response.images) ? response.images : [];
  return {
    images: images.filter((image) => image && typeof image.filename === 'string'),
    total: (response && response.total) || images.length,
    savedAt: Date.now(),
  };
}

// Best-effort: a failed write (storage full) only means the next offline start
// has nothing to show - it must never fail the live gallery load.
export async function saveGalleryCache(response) {
  const snapshot = normalize(response);
  try {
    await AsyncStorage.setItem(GALLERY_CACHE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // ignore - the live response still went to the UI
  }
  return snapshot;
}

export async function readGalleryCache() {
  try {
    const raw = await AsyncStorage.getItem(GALLERY_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const images = Array.isArray(parsed && parsed.images) ? parsed.images : [];
    const valid = images.filter((image) => image && typeof image.filename === 'string');
    if (valid.length === 0) {
      return null; // an empty cached list is the same as no cache
    }
    return { images: valid, total: parsed.total || valid.length, savedAt: parsed.savedAt || 0 };
  } catch (err) {
    return null;
  }
}

export async function clearGalleryCache() {
  try {
    await AsyncStorage.removeItem(GALLERY_CACHE_KEY);
  } catch (err) {
    // ignore
  }
}

// Live list first; on any failure fall back to the saved copy.
//
// `offline` is true only when nothing answered (see api.isOfflineError) - a
// server that answered with an error is still reachable, so the banner wording
// differs ("offline" vs "server problem").
//
// A live answer that is reachable but empty also falls back to the saved copy,
// flagged `stale: true, serverEmpty: true`, instead of showing an empty grid.
//
// Throws when the fetch fails AND there is no cached list: the screen then
// keeps its original error path.
export async function loadGallery({ limit = 200, cacheImages = true } = {}) {
  try {
    const response = await api.gallery(limit);
    const live = normalize(response);
    // A successful-but-empty answer is not "the gallery is empty": the server's
    // storage is ephemeral, and this phone may still hold the last list. Keep
    // showing those copies (and do not wipe the cache with the empty answer) so
    // the grid never blanks itself after a deploy.
    if (live.images.length === 0) {
      const cached = await readGalleryCache();
      if (cached) {
        return {
          images: cached.images,
          total: cached.total,
          offline: false,
          stale: true,
          serverEmpty: true,
          savedAt: cached.savedAt,
        };
      }
      return { images: [], total: 0, offline: false, savedAt: live.savedAt };
    }
    const snapshot = await saveGalleryCache(response);
    if (cacheImages) {
      // Fire and forget: the grid renders from the network response, and the
      // device copies fill in over the next few seconds/minutes.
      startGalleryCacheRun(
        snapshot.images.map((image) => image.filename),
        DEFAULT_MAX_FILES
      ).catch(() => {});
    }
    return { images: snapshot.images, total: snapshot.total, offline: false, savedAt: snapshot.savedAt };
  } catch (error) {
    const cached = await readGalleryCache();
    if (!cached) {
      throw error;
    }
    return {
      images: cached.images,
      total: cached.total,
      offline: true,
      savedAt: cached.savedAt,
      error,
    };
  }
}

// Offline-first list for screens that only need filenames (Detail neighbors):
// never throws, returns [] when there is nothing saved.
export async function loadGalleryFilenames({ limit = 200 } = {}) {
  try {
    const result = await loadGallery({ limit, cacheImages: false });
    return result.images.map((image) => image.filename);
  } catch (err) {
    return [];
  }
}

export default {
  saveGalleryCache,
  readGalleryCache,
  clearGalleryCache,
  loadGallery,
  loadGalleryFilenames,
};
