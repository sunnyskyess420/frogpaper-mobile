// Shuffle service - picks a random gallery image and sets it as wallpaper.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { setAsWallpaper } from './deviceMedia';
import { PHONE, getGallerySource } from './gallerySource';
import { listLocalImages } from './localGallery';
import { favoriteImageNames } from './imageFavorites';

const SHUFFLE_ON_OPEN_KEY = '@frogp…open';

export async function getShuffleOnOpen() {
  try {
    return (await AsyncStorage.getItem(SHUFFLE_ON_OPEN_KEY)) === '1';
  } catch (err) {
    return false;
  }
}

export async function setShuffleOnOpen(enabled) {
  try {
    if (enabled) {
      await AsyncStorage.setItem(SHUFFLE_ON_OPEN_KEY, '1');
    } else {
      await AsyncStorage.removeItem(SHUFFLE_ON_OPEN_KEY);
    }
    return true;
  } catch (err) {
    return false;
  }
}

// Narrows a pool of images to the ones the owner has starred. Returns the pool
// unchanged (and a note) when nothing in it is starred, so an automatic change
// never goes dead just because a star was not set yet.
function starredOnly(pool, starredSet) {
  const starred = pool.filter((img) => starredSet.has(img.filename));
  if (starred.length > 0) {
    return { pool: starred, note: '' };
  }
  return {
    pool,
    note: ' No starred wallpapers yet, so a random one from your gallery was used.',
  };
}

// Picks a random gallery image and sets it as the wallpaper.
//   favoritesOnly: draw only from the owner's starred pictures (falling back to
//                  the whole gallery when none are starred).
// Returns { ok, message } - never throws.
export async function shuffleWallpaperOnce({ favoritesOnly = false } = {}) {
  try {
    const starredSet = favoritesOnly
      ? new Set(await favoriteImageNames())
      : null;

    const source = await getGallerySource();
    if (source === PHONE) {
      // The phone's own gallery is what the owner is looking at, so draw from
      // it first. Only when it is empty does the server list stand in, so an
      // automatic change never goes dead on a fresh phone.
      const locals = await listLocalImages();
      if (locals.length > 0) {
        const narrowed = favoritesOnly ? starredOnly(locals, starredSet) : { pool: locals, note: '' };
        const pick = narrowed.pool[Math.floor(Math.random() * narrowed.pool.length)];
        const result = await setAsWallpaper(pick.uri);
        if (result && result.ok) {
          const label = favoritesOnly ? 'Wallpaper set from your favourites: ' : 'Wallpaper set: ';
          return { ok: true, message: `${label}${pick.filename}${narrowed.note}` };
        }
        return {
          ok: false,
          message: (result && result.message) || 'Could not set the wallpaper.',
        };
      }
    }
    const response = await api.gallery(200);
    const images = response.images || [];
    if (images.length === 0) {
      return { ok: false, message: 'No wallpapers in the gallery yet.' };
    }
    const narrowed = favoritesOnly ? starredOnly(images, starredSet) : { pool: images, note: '' };
    const pick = narrowed.pool[Math.floor(Math.random() * narrowed.pool.length)];
    const result = await setAsWallpaper(api.imageUrl(pick.filename));
    if (result && result.ok) {
      const label = favoritesOnly ? 'Wallpaper set from your favourites: ' : 'Wallpaper set: ';
      return { ok: true, message: `${label}${pick.filename}${narrowed.note}` };
    }
    return {
      ok: false,
      message: (result && result.message) || 'Could not set the wallpaper.',
    };
  } catch (err) {
    return { ok: false, message: (err && err.message) || 'Shuffle failed.' };
  }
}
