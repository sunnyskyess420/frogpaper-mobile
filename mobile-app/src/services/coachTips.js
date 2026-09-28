// One-time coaching tips.
//
// A small "you can also do X" nudge shown once, then never again. Keyed so each
// tip is independent. Best-effort: an unreadable store just means "already
// seen", so a tip can never get stuck on screen.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@frogp…seen:';

export async function hasSeenTip(key) {
  try {
    return (await AsyncStorage.getItem(PREFIX + key)) === '1';
  } catch (err) {
    return true;
  }
}

export async function markTipSeen(key) {
  try {
    await AsyncStorage.setItem(PREFIX + key, '1');
  } catch (err) {
    // best-effort
  }
}

export default { hasSeenTip, markTipSeen };
