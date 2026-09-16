/**
 * Whether the owner has already seen the welcome walkthrough.
 *
 * Shown once, on the very first launch. A store that cannot be read counts as
 * "not seen" only the first time - if writing fails, the walkthrough simply
 * appears again next launch rather than being lost.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const WELCOME_KEY = '@frog' + 'paper_welcome_seen';

let cachedSeen = null;

export async function hasSeenWelcome() {
  if (cachedSeen !== null) {
    return cachedSeen;
  }
  try {
    cachedSeen = (await AsyncStorage.getItem(WELCOME_KEY)) === '1';
  } catch (error) {
    cachedSeen = false;
  }
  return cachedSeen;
}

export async function markWelcomeSeen() {
  cachedSeen = true;
  try {
    await AsyncStorage.setItem(WELCOME_KEY, '1');
  } catch (error) {
    // Best effort: worst case the walkthrough shows once more.
  }
}

/** Lets Settings offer to show it again. */
export async function resetWelcome() {
  cachedSeen = false;
  try {
    await AsyncStorage.removeItem(WELCOME_KEY);
  } catch (error) {
    // ignore
  }
}

export const WELCOME_STORE_KEY = WELCOME_KEY;
