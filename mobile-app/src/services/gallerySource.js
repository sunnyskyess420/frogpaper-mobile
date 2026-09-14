// Which gallery the rest of the app reads: the phone's own store or the server.
//
// The backend's image storage is ephemeral (a deploy wipes it), so the app
// defaults to the copy on the phone. The choice is persisted like every other
// preference here - AsyncStorage, best-effort, never fatal.
//
// Installs that already have FrogPaper data are migrated to 'phone' once, with
// a one-line notice the next time the gallery is opened; a fresh install just
// starts on 'phone' silently. Nothing else is touched by the migration.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const GALLERY_SOURCE_KEY = '@frogpaper/gallery_source';
export const GALLERY_NOTICE_KEY = '@frogpaper/gallery_source_notice';

export const PHONE = 'phone';
export const SERVER = 'server';
export const DEFAULT_SOURCE = PHONE;

// Any of these being present means this install has been used before the
// gallery source existed - i.e. it is an upgrade, not a fresh install.
const EXISTING_INSTALL_KEYS = [
  '@frogpaper/rotation',
  '@frogpaper/gallery_cache',
  '@frogpaper/save_target',
  '@frogpaper/save_folder',
  '@frogpaper/engine_preference',
  '@frogpaper/favorite_prompts',
  '@frogpaper/generation_queue',
];

export const NOTICE_TEXT =
  'New here: your gallery now shows the wallpapers kept on this phone. ' +
  'Switch to the server list any time in Settings > Wallpaper > Gallery source.';

async function looksLikeExistingInstall() {
  try {
    const found = await Promise.all(
      EXISTING_INSTALL_KEYS.map((key) => AsyncStorage.getItem(key))
    );
    return found.some((value) => value !== null && value !== undefined);
  } catch (err) {
    return false;
  }
}

// The current choice. On the first call for an install that predates this
// setting it persists 'phone' and arms the one-time notice. Always resolves -
// an unreadable store means the safe default.
export async function getGallerySource() {
  try {
    const raw = await AsyncStorage.getItem(GALLERY_SOURCE_KEY);
    if (raw === PHONE || raw === SERVER) {
      return raw;
    }
    await AsyncStorage.setItem(GALLERY_SOURCE_KEY, DEFAULT_SOURCE);
    if (await looksLikeExistingInstall()) {
      await AsyncStorage.setItem(GALLERY_NOTICE_KEY, '1');
    }
    return DEFAULT_SOURCE;
  } catch (err) {
    return DEFAULT_SOURCE;
  }
}

// Persists the choice. Unknown values are ignored, so the stored choice wins -
// the same "clamp, never corrupt" rule the other setters use.
export async function setGallerySource(source) {
  if (source !== PHONE && source !== SERVER) {
    return getGallerySource();
  }
  try {
    await AsyncStorage.setItem(GALLERY_SOURCE_KEY, source);
  } catch (err) {
    // the UI keeps its optimistic value; the next read falls back to default
  }
  return source;
}

// The migration notice, once. Returns the one-liner the first time and null
// afterwards, so the gallery can show it exactly once.
export async function takeGallerySourceNotice() {
  try {
    const armed = await AsyncStorage.getItem(GALLERY_NOTICE_KEY);
    if (armed !== '1') {
      return null;
    }
    await AsyncStorage.removeItem(GALLERY_NOTICE_KEY);
    return NOTICE_TEXT;
  } catch (err) {
    return null;
  }
}

export default {
  PHONE,
  SERVER,
  DEFAULT_SOURCE,
  GALLERY_SOURCE_KEY,
  getGallerySource,
  setGallerySource,
  takeGallerySourceNotice,
};
