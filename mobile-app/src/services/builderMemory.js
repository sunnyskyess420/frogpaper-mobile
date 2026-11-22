/**
 * What the Build screen remembers between visits.
 *
 * Two separate things live here, both on this phone only (AsyncStorage):
 *   - the selection itself, so a half-built prompt survives closing the app;
 *   - the last few values picked for each row, so the sheet can offer them
 *     back under "Recent" instead of making the owner scroll 60 names.
 *
 * Like the recipe store, every function is safe to call at any time: a missing
 * or damaged value reads back as empty and a failed write is swallowed, so the
 * screen around it keeps working.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BUILDER_SELECTION_KEY = '@frogpaper/builderSelection';
export const BUILDER_RECENTS_KEY = '@frogpaper/builderRecents';

// Enough to cover the usual rotation without turning the sheet header into a
// second list.
export const RECENT_LIMIT = 5;
// Recipes and rows share the map; this is only a guard against unbounded growth.
const KEY_LIMIT = 40;
const VALUE_LIMIT = 80;

// The normal builder's fields, in the order the rows read. Anything else in a
// stored object is ignored, so an older or hand-edited value cannot inject a
// key the composer does not understand.
export const BUILDER_FIELDS = [
  'mode',
  'subject',
  'setting',
  'style',
  'lighting',
  'color',
  'mood',
  'atmosphere',
];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Keep only the known fields, non-empty, trimmed and length-capped. Returns a
 * fresh object: never the caller's.
 */
export function sanitiseSelection(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return out;
  }
  BUILDER_FIELDS.forEach((field) => {
    const value = clean(raw[field]);
    if (value) {
      out[field] = value.slice(0, VALUE_LIMIT);
    }
  });
  return out;
}

/**
 * The "Recent" list after picking `value` for `key`: most recent first, no
 * repeats, capped. Pure - the caller decides when to write it.
 */
export function rememberRecentValue(map, key, value, limit = RECENT_LIMIT) {
  const text = clean(value).slice(0, VALUE_LIMIT);
  if (!key || !text) {
    return map && typeof map === 'object' ? map : {};
  }
  const source = map && typeof map === 'object' ? map : {};
  const current = Array.isArray(source[key]) ? source[key] : [];
  const next = [text, ...current.filter((item) => item !== text)].slice(0, limit);
  const out = { ...source, [key]: next };
  const keys = Object.keys(out);
  if (keys.length > KEY_LIMIT) {
    keys.slice(0, keys.length - KEY_LIMIT).forEach((extra) => {
      delete out[extra];
    });
  }
  return out;
}

/**
 * Read back the saved map, dropping anything malformed. Keys with no usable
 * values are removed rather than kept as empty arrays.
 */
export function sanitiseRecents(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return out;
  }
  Object.keys(raw).forEach((key) => {
    const list = raw[key];
    if (!Array.isArray(list)) {
      return;
    }
    const seen = new Set();
    const values = [];
    list.forEach((item) => {
      const value = clean(item).slice(0, VALUE_LIMIT);
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    });
    if (values.length > 0) {
      out[key] = values.slice(0, RECENT_LIMIT);
    }
  });
  return out;
}

export async function loadSelection() {
  try {
    const raw = await AsyncStorage.getItem(BUILDER_SELECTION_KEY);
    return raw ? sanitiseSelection(JSON.parse(raw)) : {};
  } catch (error) {
    return {};
  }
}

export async function saveSelection(selection) {
  try {
    const safe = sanitiseSelection(selection);
    if (Object.keys(safe).length === 0) {
      await AsyncStorage.removeItem(BUILDER_SELECTION_KEY);
      return;
    }
    await AsyncStorage.setItem(BUILDER_SELECTION_KEY, JSON.stringify(safe));
  } catch (error) {
    // A failed write only costs the next visit its head start.
  }
}

export async function clearSelection() {
  try {
    await AsyncStorage.removeItem(BUILDER_SELECTION_KEY);
  } catch (error) {
    // Nothing to do - the next save overwrites it anyway.
  }
}

export async function loadRecents() {
  try {
    const raw = await AsyncStorage.getItem(BUILDER_RECENTS_KEY);
    return raw ? sanitiseRecents(JSON.parse(raw)) : {};
  } catch (error) {
    return {};
  }
}

export async function saveRecents(map) {
  try {
    const safe = sanitiseRecents(map);
    if (Object.keys(safe).length === 0) {
      await AsyncStorage.removeItem(BUILDER_RECENTS_KEY);
      return;
    }
    await AsyncStorage.setItem(BUILDER_RECENTS_KEY, JSON.stringify(safe));
  } catch (error) {
    // Recents are a convenience; losing them is not worth surfacing.
  }
}
