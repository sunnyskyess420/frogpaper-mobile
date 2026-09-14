// Shuffle service - picks a random gallery image and sets it as wallpaper.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { setAsWallpaper } from './deviceMedia';
import { PHONE, getGallerySource } from './gallerySource';
import { listLocalImages } from './localGallery';

const SHUFFLE_ON_OPEN_KEY = '@frogpaper_shuffle_on_open';

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

// Picks a random gallery image and sets it as the wallpaper.
// Returns { ok, message } - never throws.
export async function shuffleWallpaperOnce() {
  try {
    const source = await getGallerySource();
    if (source === PHONE) {
      // The phone's own gallery is what the owner is looking at, so draw from
      // it first. Only when it is empty does the server list stand in, so an
      // automatic change never goes dead on a fresh phone.
      const locals = await listLocalImages();
      if (locals.length > 0) {
        const pick = locals[Math.floor(Math.random() * locals.length)];
        const result = await setAsWallpaper(pick.uri);
        if (result && result.ok) {
          return { ok: true, message: 'Wallpaper set: ' + pick.filename };
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
    const pick = images[Math.floor(Math.random() * images.length)];
    const result = await setAsWallpaper(api.imageUrl(pick.filename));
    if (result && result.ok) {
      return { ok: true, message: 'Wallpaper set: ' + pick.filename };
    }
    return {
      ok: false,
      message: (result && result.message) || 'Could not set the wallpaper.',
    };
  } catch (err) {
    return { ok: false, message: (err && err.message) || 'Shuffle failed.' };
  }
}