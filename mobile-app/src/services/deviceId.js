/**
 * A stable id for this install.
 *
 * It exists so a generated picture can only be collected by the phone that asked
 * for it. It is random, stored only on this phone, and carries nothing about the
 * person or the device - no model, no name, no advertising id. Deleting the app
 * deletes it, and a fresh install gets a new one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@frog' + 'paper_device_id';

let cached = null;

function randomId() {
  // 24 hex characters from Math.random - plenty for "is this the same phone",
  // and deliberately not derived from anything about the device.
  let out = '';
  while (out.length < 24) {
    out += Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  }
  return `dev_${out.slice(0, 24)}`;
}

/**
 * This install's id, creating one on first use. Never throws.
 */
export async function getDeviceId() {
  if (cached) {
    return cached;
  }
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored && stored.startsWith('dev_') && stored.length >= 8) {
      cached = stored;
      return cached;
    }
    const created = randomId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
    cached = created;
    return cached;
  } catch (error) {
    // A store that will not read is not a reason to fail a wallpaper.
    cached = cached || randomId();
    return cached;
  }
}

/**
 * The id if it has already been loaded, for synchronous callers (image URLs).
 */
export function deviceIdIfLoaded() {
  return cached;
}

export const DEVICE_ID_STORE_KEY = DEVICE_ID_KEY;
