// Wallpaper rotation - the single source of truth for "when" and "what".
//
// This merges the two opt-in features that used to sit side by side in
// Settings > Wallpaper and could be on at the same time:
//   - daily auto-wallpaper (services/dailyWallpaper.js): generate a fresh
//     wallpaper on the first open of each day,
//   - shuffle on app open (services/shuffle.js): set a random existing
//     gallery image on every open.
//
// One persisted preference now drives both:
//
//   frequency: 'off'    nothing ever happens automatically,
//              'open'   change once on every app launch,
//              'daily'  change once on the first launch of each calendar day.
//   source:    'surprise'  generate a brand-new wallpaper from the surprise ideas,
//              'favorites' set a random picture you starred with the ★ button,
//              'gallery'   set a random image already in the gallery.
//
// The download / set / generate work stays in the two older services - they
// are implementation details here, never duplicated. Their AsyncStorage keys
// are only read, once, by migrateLegacySettings(), so an existing user keeps
// the behaviour they had before this screen was merged.
//
// Nothing here ever throws: a failed generation or download resolves to
// { ok: false, message } so the app always starts normally.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { shuffleWallpaperOnce } from './shuffle';
import {
  FAIL_COOLDOWN_MS,
  getDailyGate,
  markDailyFailure,
  markDailyRun,
  readFavorites,
  runDailyWallpaper,
} from './dailyWallpaper';
import { readLastChange, writeLastChange } from './rotationHistory';

export { LAST_CHANGE_KEY } from './rotationHistory';

export const ROTATION_KEY = '@frogpaper/rotation';

// Legacy keys written by the two features this module replaces. They are only
// read (never written again) by the one-time migration below.
export const LEGACY_DAILY_ENABLED_KEY = '@frogpaper/daily_enabled';
export const LEGACY_DAILY_SOURCE_KEY = '@frogpaper/daily_source';
export const LEGACY_SHUFFLE_KEY = '@frogpaper_shuffle_on_open';

export const FREQUENCIES = ['off', 'open', 'daily'];
export const SOURCES = ['surprise', 'favorites', 'gallery'];
export const DEFAULT_ROTATION = { frequency: 'off', source: 'surprise' };

// Accepts anything and returns a valid preference or null. A stored value is
// only trusted when the frequency is one we know; a broken source degrades to
// 'surprise' rather than rejecting the whole record.
function normalize(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  if (!FREQUENCIES.includes(candidate.frequency)) {
    return null;
  }
  return {
    frequency: candidate.frequency,
    source: SOURCES.includes(candidate.source) ? candidate.source : 'surprise',
  };
}

async function readStoredRotation() {
  try {
    const raw = await AsyncStorage.getItem(ROTATION_KEY);
    if (!raw) {
      return null;
    }
    return normalize(JSON.parse(raw));
  } catch (err) {
    return null; // unreadable / malformed -> treat as absent
  }
}

async function persist(rotation) {
  try {
    await AsyncStorage.setItem(ROTATION_KEY, JSON.stringify(rotation));
  } catch (err) {
    // storage hiccup - the caller still gets the in-memory value
  }
}

// One-time migration from the legacy keys. Returns the stored preference when
// there already is one, so calling this twice never overwrites a choice the
// user made after the merge. Never crashes on missing/malformed legacy keys.
export async function migrateLegacySettings() {
  const existing = await readStoredRotation();
  if (existing) {
    return existing;
  }

  let derived = { ...DEFAULT_ROTATION };
  try {
    const [dailyEnabled, dailySource, shuffleEnabled] = await Promise.all([
      AsyncStorage.getItem(LEGACY_DAILY_ENABLED_KEY),
      AsyncStorage.getItem(LEGACY_DAILY_SOURCE_KEY),
      AsyncStorage.getItem(LEGACY_SHUFFLE_KEY),
    ]);
    if (dailyEnabled === '1') {
      // Daily wins when both legacy features were on: it is the richer
      // (generating) one, and it is what the old Home screen advertised.
      derived = {
        frequency: 'daily',
        source: dailySource === 'favorites' ? 'favorites' : 'surprise',
      };
    } else if (shuffleEnabled === '1') {
      derived = { frequency: 'open', source: 'gallery' };
    }
  } catch (err) {
    // missing / unreadable legacy keys -> keep the safe default
  }

  await persist(derived);
  return derived;
}

export async function loadRotation() {
  const stored = await readStoredRotation();
  if (stored) {
    return stored;
  }
  return migrateLegacySettings();
}

export async function setFrequency(frequency) {
  const current = await loadRotation();
  const next = {
    frequency: FREQUENCIES.includes(frequency) ? frequency : current.frequency,
    source: current.source,
  };
  await persist(next);
  return next;
}

export async function setSource(source) {
  const current = await loadRotation();
  const next = {
    frequency: current.frequency,
    source: SOURCES.includes(source) ? source : current.source,
  };
  await persist(next);
  return next;
}

// How many favourite *prompts* are saved (the Generate screen's stars). Kept for
// callers that still ask; wallpaper rotation's "My favourites" now means starred
// pictures, ranked by imageFavorites.js, not saved prompts.
export async function savedFavoriteCount() {
  try {
    return (await readFavorites()).length;
  } catch (err) {
    return 0;
  }
}

// One source's action, normalised to { ok, message, engine }. Never throws.
// `engine` is the provider id a generated wallpaper was actually sent to,
// or null when no generation happened (gallery / favourites sources) or when
// the surprise run fell back to the backend's free default. Callers that
// only need ok/message can ignore it.
async function performSource(source) {
  try {
    // Both 'gallery' and 'favorites' set an existing picture; favourites only
    // draws from the starred ones. Neither generates anything.
    if (source === 'gallery' || source === 'favorites') {
      const result = await shuffleWallpaperOnce({ favoritesOnly: source === 'favorites' });
      const ok = !!(result && result.ok);
      return {
        ok,
        engine: null,
        message: (result && result.message) || (ok ? 'Wallpaper changed.' : 'Could not set the wallpaper.'),
      };
    }

    // 'surprise' -> paint a brand-new wallpaper from the surprise idea pool.
    const result = await runDailyWallpaper({ force: true, source: 'surprise' });
    if (result && result.kind === 'ok') {
      const savedNote = result.saved ? ' It was also saved to your device.' : '';
      return {
        ok: true,
        engine: result.engine || null,
        message: `New wallpaper set from a surprise idea.${savedNote}`,
      };
    }
    const failure = (result && result.message) || 'Could not create a new wallpaper.';
    return { ok: false, engine: null, message: failure };
  } catch (err) {
    return { ok: false, engine: null, message: (err && err.message) || 'Could not change the wallpaper.' };
  }
}

async function readGateSafe() {
  try {
    return await getDailyGate();
  } catch (err) {
    return { lastRun: null, lastFail: 0, today: null };
  }
}

// The launch entry point. Runs the configured action when the frequency says
// this launch is due; returns what happened so the caller can show/ignore it.
// Never throws and never blocks startup.
export async function runOnLaunch() {
  let rotation = DEFAULT_ROTATION;
  try {
    rotation = await loadRotation();
  } catch (err) {
    return {
      ok: false,
      acted: false,
      ...DEFAULT_ROTATION,
      reason: 'error',
      message: 'Could not read your wallpaper settings.',
    };
  }

  const { frequency, source } = rotation;

  if (frequency === 'off') {
    return { ok: true, acted: false, frequency, source, reason: 'off' };
  }

  if (frequency === 'daily') {
    const gate = await readGateSafe();
    if (gate.today && gate.lastRun === gate.today) {
      return { ok: true, acted: false, frequency, source, reason: 'already-run' };
    }
    if (gate.lastFail && Date.now() - gate.lastFail < FAIL_COOLDOWN_MS) {
      // A real time the user can plan around, instead of the old "next time
      // you open the app" wording that was wrong: the cooldown is two hours,
      // not "next open".
      return {
        ok: true,
        acted: false,
        frequency,
        source,
        reason: 'cooldown',
        retryAt: gate.lastFail + FAIL_COOLDOWN_MS,
      };
    }
  }

  const outcome = await performSource(source);
  // Every actual attempt (success or failure) leaves a persisted trace so
  // Settings > Wallpaper can show what happened after the Home card fades.
  // Best-effort: a storage failure here must never break the change itself.
  await writeLastChange({
    at: Date.now(),
    ok: outcome.ok,
    source,
    engine: outcome.engine,
    message: outcome.message,
  });
  if (frequency === 'daily') {
    if (outcome.ok) {
      await markDailyRun();
    } else {
      await markDailyFailure();
    }
  }
  return {
    ok: outcome.ok,
    acted: true,
    frequency,
    source,
    reason: outcome.ok ? 'done' : 'failed',
    // On a fresh failure the cooldown starts now, so the next possible
    // automatic attempt is FAIL_COOLDOWN_MS away. The Home card shows this
    // as a real local time so the owner can stop watching the screen.
    retryAt: outcome.ok ? undefined : Date.now() + FAIL_COOLDOWN_MS,
    message: outcome.message,
  };
}

// The "Change it now" button: performs the current source's action straight
// away, whatever the frequency is. Never throws.
export async function changeNow() {
  let source = DEFAULT_ROTATION.source;
  try {
    source = (await loadRotation()).source;
  } catch (err) {
    // fall through with the default source
  }
  const outcome = await performSource(source);
  return { ok: outcome.ok, source, message: outcome.message };
}
