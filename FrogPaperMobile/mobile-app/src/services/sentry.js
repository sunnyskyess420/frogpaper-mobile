// Sentry crash reporting service - runtime configuration + capture helpers.
//
// Why runtime DSN:
//   The Sentry DSN is not a secret (it's safe to embed in client builds), but
//   during onboarding we want to allow a tester to drop a DSN into Settings
//   without rebuilding the app. So we read the DSN from three sources in order:
//
//     1. AsyncStorage entry written by SettingsScreen ("@frogpaper_sentry_dsn")
//        - runtime override, highest priority for dev/test
//     2. The plugin config baked into app.json via expo-constants
//        - production-build DSN, embedded at build time
//     3. The `SENTRY_DSN` environment variable injected via Expo extra
//        - CI/EAS build override
//
// If none of the above resolve to a non-empty string, Sentry stays
// uninitialized and capture helpers become no-ops - the app keeps working
// as if crash reporting were not installed. This protects dev sessions from
// accidentally spamming a real Sentry project.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

const SENTRY_DSN_KEY = '@frogpaper_sentry_dsn';
const SENTRY_ENV_KEY = '@frogpaper_sentry_environment';

// A non-secret placeholder that ships in source. Replaced at build time
// via the @sentry/react-native Expo plugin config (see app.json) or by
// pasting a real DSN into Settings -> Diagnostics.
const BUILT_IN_DSN = readBuiltInDsn();

let initialized = false;
let cachedRuntimeDsn = null;

function readBuiltInDsn() {
  try {
    // Plugin config appears under expoConfig.plugins for Expo prebuild.
    // Also honour a SENTRY_DSN environment variable passed via EAS.
    const extra = Constants.expoConfig && Constants.expoConfig.extra;
    if (extra && typeof extra.SENTRY_DSN === 'string' && extra.SENTRY_DSN) {
      return extra.SENTRY_DSN;
    }
    // Look up @sentry/react-native plugin config from app.json plugins list.
    const plugins = Constants.expoConfig && Constants.expoConfig.plugins;
    if (Array.isArray(plugins)) {
      for (const plugin of plugins) {
        if (Array.isArray(plugin) && plugin[0] === '@sentry/react-native') {
          const cfg = plugin[1] || {};
          if (typeof cfg.dsn === 'string' && cfg.dsn && !cfg.dsn.startsWith('REPLACE_WITH')) {
            return cfg.dsn;
          }
        }
      }
    }
  } catch (error) {
    // fall through to null
  }
  return null;
}

function isValidDsn(dsn) {
  if (!dsn || typeof dsn !== 'string') return false;
  const trimmed = dsn.trim();
  if (!trimmed) return false;
  // Sentry DSNs look like https://<key>@<host>/<id> or http://...
  // We accept anything starting with http(s):// and containing '@'.
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (!trimmed.includes('@')) return false;
  if (trimmed.toUpperCase().startsWith('REPLACE_WITH')) return false;
  return true;
}

export async function getRuntimeDsn() {
  if (cachedRuntimeDsn !== null) return cachedRuntimeDsn;
  try {
    const value = await AsyncStorage.getItem(SENTRY_DSN_KEY);
    cachedRuntimeDsn = value || '';
    return cachedRuntimeDsn;
  } catch (error) {
    return '';
  }
}

export async function setRuntimeDsn(dsn) {
  const trimmed = (dsn || '').trim();
  if (!trimmed) {
    await AsyncStorage.removeItem(SENTRY_DSN_KEY);
    cachedRuntimeDsn = '';
  } else {
    await AsyncStorage.setItem(SENTRY_DSN_KEY, trimmed);
    cachedRuntimeDsn = trimmed;
  }
}

export async function getRuntimeEnvironment() {
  try {
    return (await AsyncStorage.getItem(SENTRY_ENV_KEY)) || '';
  } catch (error) {
    return '';
  }
}

export async function setRuntimeEnvironment(env) {
  const trimmed = (env || '').trim();
  if (!trimmed) {
    await AsyncStorage.removeItem(SENTRY_ENV_KEY);
  } else {
    await AsyncStorage.setItem(SENTRY_ENV_KEY, trimmed);
  }
}

export function isInitialized() {
  return initialized;
}

export function getEffectiveDsn() {
  if (cachedRuntimeDsn && isValidDsn(cachedRuntimeDsn)) {
    return cachedRuntimeDsn;
  }
  return BUILT_IN_DSN;
}

// Initialise Sentry as early as possible - call from App entry before
// rendering the root component. Safe to call multiple times; subsequent
// calls become no-ops once initialised.
export async function initSentry() {
  if (initialized) return;

  // Make sure we have the latest AsyncStorage value before deciding.
  await getRuntimeDsn();

  const dsn = getEffectiveDsn();
  if (!isValidDsn(dsn)) {
    // No DSN available - Sentry stays a no-op. Capture helpers below
    // also short-circuit when not initialised.
    return;
  }

  const environment =
    (await getRuntimeEnvironment()) ||
    (process.env.NODE_ENV === 'production' ? 'production' : 'development');

  try {
    Sentry.init({
      dsn,
      environment,
      enableAutoSessionTracking: true,
      // In dev we still want to see crashes, but with debug logs off so
      // the console stays clean for the rest of the app.
      debug: false,
      attachStacktrace: true,
      // 1.0 = send 100% of sessions. Drop to 0.1 in production once the
      // project's quota starts filling.
      tracesSampleRate: 1.0,
      // Don't run native auto-init - the Expo plugin handles native
      // crashes; this JS-side init only wires the JS SDK to the bridge.
      enableNative: true,
    });
    initialized = true;
  } catch (error) {
    // Never let a Sentry init failure break the app.
    initialized = false;
  }
}

// Re-initialise after the runtime DSN has been updated. Used by
// SettingsScreen so the user doesn't have to restart the app.
export async function reinitSentry() {
  if (!initialized) {
    return initSentry();
  }
  // Sentry RN SDK doesn't support reconfiguration cleanly after init;
  // the new DSN will take effect after the next app launch. We still
  // refresh the cache so getEffectiveDsn() returns the right value.
  await getRuntimeDsn();
}

// --- Capture helpers (safe no-ops when Sentry isn't initialised) --------

export function captureException(error, context) {
  if (!initialized || !error) return;
  try {
    if (context) {
      Sentry.captureException(error, { extra: context });
    } else {
      Sentry.captureException(error);
    }
  } catch (_) {
    // swallow - never let error reporting crash the app
  }
}

export function captureMessage(message, level = 'info') {
  if (!initialized || !message) return;
  try {
    Sentry.captureMessage(message, level);
  } catch (_) {
    // swallow
  }
}

export function setTag(key, value) {
  if (!initialized) return;
  try {
    Sentry.setTag(key, String(value));
  } catch (_) {
    // swallow
  }
}

export function setUser({ id, email, username } = {}) {
  if (!initialized) return;
  try {
    Sentry.setUser({ id, email, username });
  } catch (_) {
    // swallow
  }
}

// Forces a real crash that the native Sentry SDK will catch and report.
// Use this from the hidden "Test crash" button in Settings -> Diagnostics.
//
// Two strategies are supported:
//   - throwError: throws an uncaught JS Error (caught by Sentry JS SDK)
//   - nativeCrash: calls Sentry.nativeCrash() (only works in a dev-client
//     or standalone build, not Expo Go)
export function forceTestCrash(strategy = 'throwError') {
  if (!initialized) {
    // Even when not initialised, throw so the developer sees something happen.
    throw new Error('Sentry test crash: SDK not initialised (no DSN configured).');
  }
  if (strategy === 'nativeCrash') {
    try {
      Sentry.nativeCrash();
    } catch (error) {
      // Likely running in Expo Go - fall back to JS throw
      throw new Error('Sentry native crash unavailable in this build (Expo Go?). Falling back to JS throw.');
    }
    return;
  }
  // Default: throw a clearly-labelled JS error so it's easy to spot in the
  // Sentry dashboard.
  throw new Error('FrogPaper Sentry test crash - JS throw');
}

// Sends a test event to Sentry via captureException. More reliable on web
// than throwing uncaught from inside a React event handler.
//
// Returns true if the event was queued for send, false if Sentry isn't
// initialised.
export function sendTestEvent(message = 'FrogPaper Sentry test event - captureException') {
  if (!initialized) return false;
  try {
    const error = new Error(message);
    error.name = 'FrogPaperTestError';
    Sentry.captureException(error);
    return true;
  } catch (_) {
    return false;
  }
}

export default {
  initSentry,
  reinitSentry,
  isInitialized,
  getEffectiveDsn,
  getRuntimeDsn,
  setRuntimeDsn,
  getRuntimeEnvironment,
  setRuntimeEnvironment,
  captureException,
  captureMessage,
  setTag,
  setUser,
  forceTestCrash,
  sendTestEvent,
};
