// Daily auto-wallpaper.
//
// Idea: once per local day, the first time the user opens FrogPaper while
// the backend is reachable, quietly generate a fresh wallpaper, save it
// (phone gallery, or the SD-card folder from Settings > Save location) and
// set it as the phone wallpaper.
//
// Deliberately NO native background scheduler (WorkManager / background
// fetch): those get throttled or killed by Samsung battery management and
// can wake the cloud for nothing. Running "on first open of the day" is
// 100% reliable, costs zero battery and still feels magical.
//
// Off by default: nothing here runs unless the rotation service (see
// services/wallpaperRotation.js) decides it is due. Keys stay on the device -
// the shared api layer attaches any saved BYOK keys to the request.
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { saveWallpaper } from './saveTarget';
import { setAsWallpaper } from './deviceMedia';
import { FAVORITES_KEY } from './promptLibrary';
import { SURPRISE_NEGATIVE, surprisePrompt } from './promptComposer';
import { PHONE, getGallerySource } from './gallerySource';
import { saveLocalImage } from './localGallery';

const DAILY_ENABLED_KEY = '@frogpaper/daily_enabled';
const DAILY_SOURCE_KEY = '@frogpaper/daily_source'; // 'surprise' | 'favorites'
const DAILY_LASTRUN_KEY = '@frogpaper/daily_lastrun'; // 'YYYY-MM-DD' (local)
const DAILY_LASTFAIL_KEY = '@frogpaper/daily_lastfail'; // epoch ms
// After a failed attempt, wait 2 hours before auto-retrying so a flaky
// morning connection cannot burn through the provider quota all day.
export const FAIL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export function localDateKey(date = new Date()) {
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

export async function readFavorites() {
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
  // "Surprise me" composes a fresh wallpaper prompt from the same vocabulary the
  // Build screen offers, so an unattended wallpaper is never a one-line idea that
  // turns into a flat white background.
  return surprisePrompt();
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

// The "once a day" gate is shared with the rotation service, which owns the
// merged frequency setting: it needs to know whether today's wallpaper is
// already done, and to record the outcome after a gallery-sourced change (the
// generate path records lastRun/lastFail itself inside runDailyWallpaper).
export async function getDailyGate() {
  const [lastRun, lastFail] = await Promise.all([
    AsyncStorage.getItem(DAILY_LASTRUN_KEY),
    AsyncStorage.getItem(DAILY_LASTFAIL_KEY),
  ]);
  return {
    lastRun: lastRun || null,
    lastFail: parseInt(lastFail || '0', 10) || 0,
    today: localDateKey(),
  };
}

export async function markDailyRun() {
  try {
    await AsyncStorage.setItem(DAILY_LASTRUN_KEY, localDateKey());
    await AsyncStorage.removeItem(DAILY_LASTFAIL_KEY);
  } catch (err) {
    // best-effort - a failed write must never break the app
  }
}

export async function markDailyFailure() {
  try {
    await AsyncStorage.setItem(DAILY_LASTFAIL_KEY, String(Date.now()));
  } catch (err) {
    // best-effort - a failed write must never break the app
  }
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
// cooldown checks (that is what "Change it now" uses); it is never triggered
// automatically. `source` lets the rotation service pick the pool explicitly
// instead of reading the legacy daily_source key.
export async function runDailyWallpaper({ force = false, source: sourceOverride = null } = {}) {
  const info = await getDailyInfo();
  if (sourceOverride === 'surprise' || sourceOverride === 'favorites') {
    info.source = sourceOverride;
  }
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
      // Always sent: the owner only sees the result of this run, so keep text,
      // watermarks and phone-mockup framing out of it either way.
      negativePrompt: SURPRISE_NEGATIVE,
      width: 1080,
      height: 1920,
      timeoutMs: 180000,
    });
    const image = response.image || {};
    const url = api.imageUrl(image.filename);

    // Save into the device gallery first (a bonus, never blocks the set).
    // Follows the Save location setting, so an SD-card folder gets the file too.
    let saved = false;
    try {
      const saveResult = await saveWallpaper(url, image.filename);
      saved = !!saveResult.ok;
    } catch (saveErr) {
      // permission missing or storage hiccup - the wallpaper still gets set
    }

    // Phone-gallery mode keeps the owner's own work on the phone as well, so
    // the gallery still has it after the server's storage is wiped. Best-effort
    // and not awaited: the wallpaper set below must not wait on it.
    if ((await getGallerySource()) === PHONE) {
      saveLocalImage({ remoteUrl: url, filename: image.filename, meta: { source: PHONE, prompt } });
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
