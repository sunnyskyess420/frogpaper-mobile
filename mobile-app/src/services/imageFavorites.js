// Starred wallpapers.
//
// A picture the owner has marked with the ★ button (on the Detail screen). The
// list is a plain array of filenames kept in AsyncStorage - one star per image,
// keyed by the filename the gallery and Detail screens already use.
//
// This is deliberately separate from the *prompt* favourites in promptLibrary.js
// (those star a text prompt on the Generate screen). This module stars the
// pictures themselves, and is what "My favourites" in wallpaper rotation and the
// Gallery filter read.
//
// Everything here is best-effort: an unreadable or malformed store degrades to
// "nothing starred", never to an exception.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FAVORITE_IMAGES_KEY = '@frogpaper/favorite_images';

function cleanList(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  // De-duplicate while keeping insertion order.
  const seen = new Set();
  const out = [];
  for (const name of list) {
    if (typeof name === 'string' && name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// The starred filenames, newest star last. Never throws.
export async function favoriteImageNames() {
  try {
    const raw = await AsyncStorage.getItem(FAVORITE_IMAGES_KEY);
    return cleanList(raw ? JSON.parse(raw) : []);
  } catch (err) {
    return [];
  }
}

// A Set for O(1) lookups in list rendering.
export async function favoriteImageSet() {
  return new Set(await favoriteImageNames());
}

export async function favoriteImageCount() {
  return (await favoriteImageNames()).length;
}

export async function isImageFavorite(filename) {
  if (!filename) {
    return false;
  }
  return (await favoriteImageNames()).includes(filename);
}

async function persist(list) {
  try {
    await AsyncStorage.setItem(FAVORITE_IMAGES_KEY, JSON.stringify(list));
  } catch (err) {
    // storage hiccup - the caller still gets the in-memory result
  }
  return list;
}

// Explicitly set (or clear) a star. Returns the new list.
export async function setImageFavorite(filename, on) {
  if (!filename) {
    return favoriteImageNames();
  }
  const list = await favoriteImageNames();
  const without = list.filter((name) => name !== filename);
  const next = on ? [...without, filename] : without;
  return persist(next);
}

// Flip the star. Returns { favorite, list } so the caller can update the UI
// without a second read.
export async function toggleImageFavorite(filename) {
  const list = await favoriteImageNames();
  const wasFavorite = list.includes(filename);
  const next = wasFavorite
    ? list.filter((name) => name !== filename)
    : [...list, filename];
  await persist(next);
  return { favorite: !wasFavorite, list: next };
}

// Reconciles the star list against the images that actually exist, so deleting a
// wallpaper also drops its star. Called with the current gallery filenames.
export async function pruneFavorites(existingFilenames) {
  const existing = new Set(existingFilenames || []);
  const list = await favoriteImageNames();
  const next = list.filter((name) => existing.has(name));
  if (next.length !== list.length) {
    await persist(next);
  }
  return next;
}

export default {
  FAVORITE_IMAGES_KEY,
  favoriteImageNames,
  favoriteImageSet,
  favoriteImageCount,
  isImageFavorite,
  setImageFavorite,
  toggleImageFavorite,
  pruneFavorites,
};
