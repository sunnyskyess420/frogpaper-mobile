// A small persisted record of the last automatic wallpaper change.
//
// The Home card already announces a failed or successful run while it is on
// screen, but once the card disappears there is no trace left - so a 7 a.m.
// failure was invisible by the time the owner opened the app at lunch. This
// module stores one record (the latest) under @frogpaper/rotation_last_change
// so Settings > Wallpaper can show what happened and Home can survive a
// restart during the cooldown.
//
// Storage here is best-effort by design. A write failure must never block a
// wallpaper change or break the launch flow, and a malformed record on disk
// must read back as null instead of crashing the Settings card.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAST_CHANGE_KEY = '@frogpaper/rotation_last_change';

// The four sources the record can come from. Kept in sync with the rotation
// service's SOURCES list; if a new source is ever added there it must be
// added here too, otherwise writeLastChange will reject it.
const VALID_SOURCES = ['surprise', 'favorites', 'gallery'];

// Returns the stored record or null. Malformed, unreadable, or
// shape-mismatched values all read back as null - the Settings row treats
// null as "no automatic change yet", which is the only honest answer.
export async function readLastChange() {
  try {
    const raw = await AsyncStorage.getItem(LAST_CHANGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return isValidRecord(parsed) ? normalizeRecord(parsed) : null;
  } catch (err) {
    return null;
  }
}

// Best-effort write. Never throws: a storage failure is swallowed silently
// because the wallpaper itself has already been changed (or attempted) by
// the time this is called, and we would rather lose the audit trail than
// roll back the change.
export async function writeLastChange(record) {
  try {
    if (!isValidRecord(record)) {
      return;
    }
    await AsyncStorage.setItem(LAST_CHANGE_KEY, JSON.stringify(normalizeRecord(record)));
  } catch (err) {
    // intentionally swallowed - see above
  }
}

function isValidRecord(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) {
    return false;
  }
  if (typeof candidate.ok !== 'boolean') {
    return false;
  }
  if (!VALID_SOURCES.includes(candidate.source)) {
    return false;
  }
  // engine is null for gallery/favorites sources, and the provider id for
  // a generated wallpaper. Anything other than a string or null is rejected.
  if (candidate.engine !== null && typeof candidate.engine !== 'string') {
    return false;
  }
  if (typeof candidate.message !== 'string') {
    return false;
  }
  return true;
}

// Builds the canonical shape so callers cannot accidentally persist extra
// fields (a future migration would otherwise have to scrub them).
function normalizeRecord(record) {
  return {
    at: record.at,
    ok: record.ok,
    source: record.source,
    engine: record.engine === null ? null : String(record.engine),
    message: record.message,
  };
}
