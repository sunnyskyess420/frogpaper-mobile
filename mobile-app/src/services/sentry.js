// Sentry crash reporting service - runtime configuration + capture helpers.
//
// STATUS: temporarily disabled (2026-09-11). The @sentry/react-native
// native plugin is incompatible with Gradle 9 (Expo SDK 57), so we
// disabled autolinking via react-native.config.js. To prevent any
// runtime access to the missing native bridge from crashing the app,
// ALL functions in this file are now safe no-ops. The SettingsScreen
// Diagnostics section will still render, but the test-crash buttons
// won't actually do anything until Sentry ships a Gradle-9-compatible
// release and we re-enable native autolinking.
//
// To re-enable later:
//   1. Delete mobile-app/react-native.config.js
//   2. Add the @sentry/react-native plugin back to mobile-app/app.json
//   3. Restore the original Sentry.init() code in this file (git history:
//      commit 205e84a or earlier had it)

import AsyncStorage from '@react-native-async-storage/async-storage';

const SENTRY_DSN_KEY = '@frogpaper_sentry_dsn';
const SENTRY_ENV_KEY = '@frogpaper_sentry_environment';

let cachedRuntimeDsn = null;

export async function getRuntimeDsn() {
  if (cachedRuntimeDsn !== null) return cachedRuntimeDsn;
  try {
    cachedRuntimeDsn = (await AsyncStorage.getItem(SENTRY_DSN_KEY)) || '';
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
  return false;
}

export function getEffectiveDsn() {
  if (cachedRuntimeDsn) return cachedRuntimeDsn;
  return null;
}

// All no-ops - native Sentry bridge is disabled
export async function initSentry() {
  // Pre-load the AsyncStorage value so SettingsScreen can display it.
  await getRuntimeDsn();
  return;
}

export async function reinitSentry() {
  await getRuntimeDsn();
  return;
}

export function captureException(error, context) {
  // No-op - Sentry disabled
  return;
}

export function captureMessage(message, level = 'info') {
  // No-op - Sentry disabled
  return;
}

export function setTag(key, value) {
  // No-op - Sentry disabled
  return;
}

export function setUser({ id, email, username } = {}) {
  // No-op - Sentry disabled
  return;
}

export function forceTestCrash(strategy = 'throwError') {
  // Even though Sentry is disabled, we still throw so the developer sees
  // something happen when they tap the test button.
  throw new Error('FrogPaper test crash - Sentry is disabled, but here is a JS throw anyway.');
}

export function sendTestEvent(message = 'FrogPaper test event') {
  // No-op - Sentry disabled
  return false;
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
