// A small, dependency-free error log.
//
// Sentry cannot be enabled in this project (its Android plugin does not build
// with the Gradle version we use), so the app keeps its own ring buffer of the
// most recent JavaScript errors instead. Two honest limits:
//   - JavaScript only: a hard native crash of the whole process cannot be
//     recorded from inside the process.
//   - It records what the app can see: uncaught JS errors, unhandled promise
//     rejections, and failures the API layer reports (minus the normal
//     offline/cancel noise).
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@frogpaper/errorLog';
export const MAX_ENTRIES = 20;
const MAX_MESSAGE = 500;
const MAX_STACK = 1500;

// In-memory mirror (oldest first). `null` means "not loaded yet".
let entries = null;
let loadPromise = null;
let installed = false;

function trimText(value, limit) {
  const text = typeof value === 'string' ? value : String(value === undefined ? '' : value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}\u2026`;
}

// Failures that are expected and would only fill the log with noise:
// no connection, a request the app itself cancelled, or a timeout.
const NOISE = /network request failed|network error|failed to fetch|offline|unreachable|timed? ?out|abort/i;

export function isNoiseError(error) {
  if (!error) {
    return true;
  }
  const name = String(error.name || '');
  if (name === 'AbortError') {
    return true;
  }
  return NOISE.test(String(error.message || error));
}

export function describeErrorEntry(entry) {
  if (!entry) {
    return '';
  }
  const when = entry.at ? new Date(entry.at).toLocaleString() : 'unknown time';
  const parts = [`[${when}]`, entry.context ? `${entry.context}:` : '', entry.message || '(no message)'];
  const head = parts.filter(Boolean).join(' ');
  return entry.stack ? `${head}\n${entry.stack}` : head;
}

export function formatErrorEntry(entry) {
  return describeErrorEntry(entry);
}

async function load() {
  if (entries) {
    return entries;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        entries = Array.isArray(parsed)
          ? parsed.filter((item) => item && typeof item === 'object')
          : [];
      } catch (error) {
        // Corrupt or unreadable storage must never break the app.
        entries = [];
      }
      return entries;
    })();
  }
  return loadPromise;
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries || []));
  } catch (error) {
    // Logging is best-effort; failing to persist must never throw upwards.
  }
}

// Never throws: a logger that can crash the app is worse than no logger.
export async function recordError(error, context = '') {
  try {
    if (isNoiseError(error)) {
      return;
    }
    const list = await load();
    const message = error && error.message ? error.message : String(error);
    list.push({
      at: new Date().toISOString(),
      context: trimText(context, 80),
      message: trimText(message, MAX_MESSAGE),
      stack: trimText((error && error.stack) || '', MAX_STACK),
    });
    while (list.length > MAX_ENTRIES) {
      list.shift();
    }
    await persist();
  } catch (ignored) {
    // deliberately swallowed
  }
}

// Newest first, for display.
export async function listErrors() {
  await load();
  return [...(entries || [])].reverse();
}

export async function errorCount() {
  await load();
  return (entries || []).length;
}

export async function clearErrors() {
  entries = [];
  await persist();
}

// Installs the global handlers once, chaining to whatever was installed before
// so the normal crash/warning behaviour is untouched.
export async function initErrorLog() {
  if (installed) {
    return;
  }
  installed = true;
  await load();

  try {
    const errorUtils = global.ErrorUtils;
    if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
      const previous = typeof errorUtils.getGlobalHandler === 'function'
        ? errorUtils.getGlobalHandler()
        : null;
      errorUtils.setGlobalHandler((error, isFatal) => {
        recordError(error, isFatal ? 'fatal error' : 'error');
        if (typeof previous === 'function') {
          previous(error, isFatal);
        }
      });
    }
  } catch (ignored) {
    // no global handler available: the explicit recordError calls still work
  }

  try {
    // React Native ships this tracker; it reports promise rejections nobody
    // handled, which is where a lot of quiet failures end up.
    // eslint-disable-next-line global-require
    const tracking = require('promise/setimmediate/rejection-tracking');
    tracking.enable({
      allRejections: true,
      onUnhandled: (id, error) => recordError(error, 'unhandled promise'),
      onHandled: () => {},
    });
  } catch (ignored) {
    // tracker not present in this runtime: fine
  }
}
