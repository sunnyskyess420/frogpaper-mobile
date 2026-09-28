// Remembered gallery preferences (sort, favourites filter, caption style).
//
// The gallery used to reset to "Newest" and the file-name caption every time it
// opened. These choices now persist on the device, like every other preference
// here - best-effort, never fatal.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const GALLERY_PREFS_KEY = '@frogp…refs';

export const SORT_VALUES = ['newest', 'oldest', 'favorites', 'name'];
export const CAPTION_VALUES = ['name', 'prompt'];

export const DEFAULT_GALLERY_PREFS = {
  sortBy: 'newest',
  favoritesOnly: false,
  captionMode: 'name',
};

function sanitize(raw) {
  const prefs = { ...DEFAULT_GALLERY_PREFS };
  if (raw && typeof raw === 'object') {
    if (SORT_VALUES.includes(raw.sortBy)) {
      prefs.sortBy = raw.sortBy;
    }
    if (CAPTION_VALUES.includes(raw.captionMode)) {
      prefs.captionMode = raw.captionMode;
    }
    prefs.favoritesOnly = !!raw.favoritesOnly;
  }
  return prefs;
}

export async function loadGalleryPrefs() {
  try {
    const raw = await AsyncStorage.getItem(GALLERY_PREFS_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch (err) {
    return { ...DEFAULT_GALLERY_PREFS };
  }
}

export async function saveGalleryPrefs(prefs) {
  try {
    await AsyncStorage.setItem(GALLERY_PREFS_KEY, JSON.stringify(sanitize(prefs)));
  } catch (err) {
    // storage hiccup - the in-memory choice still applies
  }
}

export default { GALLERY_PREFS_KEY, loadGalleryPrefs, saveGalleryPrefs, DEFAULT_GALLERY_PREFS };
