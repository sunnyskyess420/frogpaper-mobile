// The remembered "is there a newer FrogPaper?" answer.
//
// updateCheck.js does the actual GitHub lookup, but it is deliberately stateless
// and network-only. This module remembers the last answer on the device so the
// app can:
//   - check quietly at most once a day (instead of only when a button is tapped),
//   - show a small "update ready" dot on Home without asking GitHub every launch,
//   - keep the Settings card and the Home dot showing the same answer.
//
// Kept separate from updateCheck.js on purpose: the headless update check script
// loads updateCheck.js on its own, and it must not need an AsyncStorage stub.
//
// Everything here is best-effort and never throws - being offline, or having a
// malformed cache, simply means "no cached answer yet".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkForUpdate } from './updateCheck';

export const UPDATE_CACHE_KEY = '@frogpaper/update_check';
// A cached answer is trusted for this long before the launch check re-asks.
export const UPDATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// The stored answer, or null when there is none / it is unreadable.
export async function readCachedUpdate() {
  try {
    const raw = await AsyncStorage.getItem(UPDATE_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.state !== 'string') {
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

export async function writeCachedUpdate(record) {
  try {
    await AsyncStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(record));
  } catch (err) {
    // best-effort - the caller still gets the live result
  }
  return record;
}

export function isStale(cached, maxAgeMs, now = Date.now()) {
  if (!cached || typeof cached.checkedAt !== 'number') {
    return true;
  }
  return now - cached.checkedAt >= maxAgeMs;
}

// The launch entry point. Returns the freshest answer it can, asking GitHub only
// when the cached one is missing or older than maxAgeMs. Pass maxAgeMs: 0 to
// force a fresh check (the Settings "Check for updates" button does this).
// Never throws.
export async function refreshUpdateIfStale({ maxAgeMs = UPDATE_MAX_AGE_MS, now = Date.now() } = {}) {
  const cached = await readCachedUpdate();
  if (!isStale(cached, maxAgeMs, now)) {
    return cached;
  }
  let result;
  try {
    result = await checkForUpdate();
  } catch (err) {
    // checkForUpdate is written never to throw, but stay safe anyway.
    return cached || { state: 'offline', checkedAt: now };
  }
  const record = { checkedAt: now, ...result };
  await writeCachedUpdate(record);
  return record;
}

export default {
  UPDATE_CACHE_KEY,
  UPDATE_MAX_AGE_MS,
  readCachedUpdate,
  writeCachedUpdate,
  isStale,
  refreshUpdateIfStale,
};
