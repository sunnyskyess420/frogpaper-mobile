// Daily auto-wallpaper.
//
// Idea: once per local day, the first time the user opens FrogPaper while
// the backend is reachable, quietly generate a fresh wallpaper, save it to
// the device gallery and set it as the phone wallpaper.
//
// Deliberately NO native background scheduler (WorkManager / background
// fetch): those get throttled or killed by Samsung battery management and
// can wake the cloud for nothing. Running "on first open of the day" is
// 100% reliable, costs zero battery and still feels magical.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { saveToDevice, setAsWallpaper } from './deviceMedia';
import { IDEAS, FAVORITES_KEY } from './promptLibrary';

const DAILY_ENABLED_KEY = '@frogpaper/daily_enabled';
const DAILY_SOURCE_KEY = '@frogpaper/daily_source'; // 'surprise' | 'favorites'
const DAILY_LASTRUN_KEY = '@frogpaper/daily_lastrun'; // 'YYYY-MM-DD' (local)
const DAILY_LASTFAIL_KEY = '@frogpaper/daily_lastfail'; // epoch ms
// After a failed attempt, wait 2 hours before auto-retrying so a flaky
// morning connection cannot burn through the provider quota all day.
const FAIL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function isDailyEnabled() {
  return (await AsyncStorage.getItem(DAILY_ENABLED_KEY)) === '1';
}

export async function setDailyEnabled(enabled) {
  if (enabled) {
    await AsyncStorage.setItem(DAILY_ENABLED_KEY, '1');
  } else {
    await AsyncStorage.removeItem(DAILY_ENABLED_KEY);
  }
}

export async function getDailySource() {
  return (await AsyncStorage.getItem(DAILY_SOURCE_KEY)) || 'surprise';
}

export async function setDailySource(source) {
  await AsyncStorage.setItem(
    DAILY_SOURCE_KEY,
    source === 'favorites' ? 'favorites' : 'surprise'
  );
}

async function readFavorites() {
  try {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch (err) {
    return [];
  }
}

async function pickDailyPrompt(source) {
  if (source === 'favorites') {
    const favorites = await readFavorites();
    if (favorites.length > 0) {
      return favorites[Math.floor(Math.random() * favorites.length)];
    }
  }
  return IDEAS[Math.floor(Math.random() * IDEAS.length)];
}

export async function getDailyInfo() {
  const [enabled, source, lastRun, lastFail] = await Promise.all([
    isDailyEnabled(),
    getDailySource(),
    AsyncStorage.getItem(DAILY_LASTRUN_KEY),
    AsyncStorage.getItem(DAILY_LASTFAIL_KEY),
  ]);
  return {
    enabled,
    source,
    lastRun,
    lastFail: parseInt(lastFail || '0', 10) || 0,
  };
}

// Which phase is the daily wallpaper in right now? Purely informational -
// nothing is generated here.
//   'hidden'      feature is off
//   'already-run' today's wallpaper was already set
//   'cooldown'    last attempt failed recently; waiting before auto-retry
//   'due'         enabled and today's wallpaper is still owed
export async function dailyPhase() {
  const info = await getDailyInfo();
  if (!info.enabled) {
    return { phase: 'hidden', info };
  }
  if (info.lastRun === localDateKey()) {
    return { phase: 'already-run', info };
  }
  if (info.lastFail && Date.now() - info.lastFail < FAIL_COOLDOWN_MS) {
    return { phase: 'cooldown', info };
  }
  return { phase: 'due', info };
}

// Generate + save + set. force=true ignores the "already ran today" and
// cooldown checks (that is what the manual button uses); it is never
// triggered automatically.
export async function runDailyWallpaper({ force = false } = {}) {
  const info = await getDailyInfo();
  if (!force) {
    if (!info.enabled) {
      return { kind: 'disabled' };
    }
    if (info.lastRun === localDateKey()) {
      return { kind: 'already-run' };
    }
    if (info.lastFail && Date.now() - info.lastFail < FAIL_COOLDOWN_MS) {
      return { kind: 'cooldown' };
    }
  }

  const prompt = await pickDailyPrompt(info.source);
  try {
    // 180s ceiling: nobody is watching a progress bar with a Cancel button,
    // so give slow peak-hour queues room to finish.
    const response = await api.generate({
      prompt,
      negativePrompt: null,
      width: 1080,
      height: 1920,
      timeoutMs: 180000,
    });
    const image = response.image || {};
    const url = api.imageUrl(image.filename);

    // Save into the device gallery first (a bonus, never blocks the set).
    let saved = false;
    try {
      await saveToDevice(url);
      saved = true;
    } catch (saveErr) {
      // permission missing or storage hiccup - the wallpaper still gets set
    }

    const setResult = await setAsWallpaper(url);
    if (!setResult || !setResult.ok) {
      throw new Error(
        (setResult && setResult.message) || 'Could not set the wallpaper.'
      );
    }

    await AsyncStorage.setItem(DAILY_LASTRUN_KEY, localDateKey());
    await AsyncStorage.removeItem(DAILY_LASTFAIL_KEY);
    return { kind: 'ok', filename: image.filename, prompt, saved };
  } catch (err) {
    await AsyncStorage.setItem(DAILY_LASTFAIL_KEY, String(Date.now()));
    return {
      kind: 'error',
      message: (err && err.message) || 'Daily wallpaper failed.',
    };
  }
}
