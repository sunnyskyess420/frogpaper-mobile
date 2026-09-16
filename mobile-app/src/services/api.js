// API service layer - talks to the Flask backend.
//
// Backend URL resolution is automatic per platform:
//   - web            -> http://localhost:5000
//   - Android device -> tries the Expo Go dev-host LAN IP (auto-detected),
//                       then emulator alias 10.0.2.2, then localhost
//   - iOS device     -> tries the Expo Go dev-host LAN IP (auto-detected)
//
// The auto-detected IP comes from Expo Go itself: when the phone loads the app
// from the dev server it already knows the PC's LAN address (expoConfig.hostUri,
// e.g. "192.168.1.20:8081"). The backend lives on the same PC, just on port 5000.
//
// No address is hardcoded anywhere: a shipped build talks to the cloud backend
// (or a server the owner typed in), and only a development build can discover the
// PC it was loaded from.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordError } from './errorLog';
import { getDeviceId } from './deviceId';

export const EMULATOR_ALIAS = '10.0.2.2'; // Android emulator alias for the host machine
const PORT = 5000;
const CUSTOM_SERVER_KEY = '@frogpaper_custom_server_url';
const ACCESS_KEY_KEY = '@frogpaper_access_key';

// BYOK keys - stored only on this device, sent with each generate request.
// The backend uses these INSTEAD of any server-side keys when present, and
// never logs or persists them. Cleared by tapping "Clear" in Settings.
const GEMINI_KEY_STORE = '@frogpaper_user_gemini_key';
const HF_TOKEN_STORE = '@frogpaper_user_hf_token';
const REPLICATE_TOKEN_STORE = '@frogpaper_user_replicate_token';

// Derives http://<PC-LAN-IP>:5000 from the Expo Go dev server host, or null
// when not running inside Expo Go (web, production build).
function devHostLanUrl() {
  try {
    const hostUri = Constants.expoConfig && Constants.expoConfig.hostUri;
    if (typeof hostUri === 'string' && hostUri.includes(':')) {
      const host = hostUri.split(':')[0];
      // only trust dotted LAN hosts (e.g. "192.168.1.20"), never localhost
      if (host && host.includes('.') && host !== '127.0.0.1' && !host.endsWith('.exp.direct')) {
        return `http://${host}:${PORT}`;
      }
    }
  } catch (error) {
    // Constants unavailable - fall through to static candidates
  }
  return null;
}

let customServerUrl = null;
// Ships with the app so a fresh install needs no setup: generating simply
// works. Honest note: because it travels inside the app, it can be read out of
// it. It keeps random scanners off the server; it is not real security.
export const BUILT_IN_ACCESS_KEY = 'frogpaper-dev-secret-2026';

let accessKey = null;
// Cached so the synchronous imageUrl() can include it.
let deviceId = null;

// BYOK keys - cached in memory after first load. Updated by setX() functions.
let userGeminiKey = null;
let userHfToken = null;
let userReplicateToken = null;

export async function setAccessKey(key) {
  if (!key || key.trim() === '') {
    // Clearing means "go back to the shipped key", not "have no key at all" -
    // an empty key would make every request fail.
    await AsyncStorage.removeItem(ACCESS_KEY_KEY);
    accessKey = BUILT_IN_ACCESS_KEY;
  } else {
    const trimmed = key.trim();
    await AsyncStorage.setItem(ACCESS_KEY_KEY, trimmed);
    accessKey = trimmed;
  }
}

export async function getAccessKey() {
  if (accessKey !== null) {
    return accessKey;
  }
  try {
    accessKey = (await AsyncStorage.getItem(ACCESS_KEY_KEY)) || BUILT_IN_ACCESS_KEY;
    return accessKey;
  } catch (error) {
    return BUILT_IN_ACCESS_KEY;
  }
}

// Load access key on startup. Kept as a named promise so the first request of
// the session can wait for the AsyncStorage read instead of racing it.
const accessKeyPreloadPromise = getAccessKey().catch(() => {});

// Loaded at startup too, and ordered after the key so an id is in place before
// the first image URL is built.
const deviceIdPreloadPromise = accessKeyPreloadPromise
  .then(() => getDeviceId())
  .then((id) => {
    deviceId = id;
    return id;
  })
  .catch(() => {});

// --- BYOK (Bring Your Own Key) helpers -------------------------------------
// These functions store the user's personal API keys on this device only.
// They are sent as headers on every generate request and never appear in
// URLs, body, or logs. They persist across app restarts until cleared.

async function _loadByokKey(storageKey, setter) {
  try {
    const value = await AsyncStorage.getItem(storageKey);
    setter(value || '');
    return value || '';
  } catch (error) {
    return '';
  }
}

async function _saveByokKey(storageKey, value, setter) {
  if (!value || value.trim() === '') {
    await AsyncStorage.removeItem(storageKey);
    setter('');
  } else {
    const trimmed = value.trim();
    await AsyncStorage.setItem(storageKey, trimmed);
    setter(trimmed);
  }
}

export async function setGeminiKey(key) {
  await _saveByokKey(GEMINI_KEY_STORE, key, (v) => { userGeminiKey = v; });
}

export async function getGeminiKey() {
  if (userGeminiKey !== null) return userGeminiKey;
  return _loadByokKey(GEMINI_KEY_STORE, (v) => { userGeminiKey = v; });
}

export async function setHfToken(token) {
  await _saveByokKey(HF_TOKEN_STORE, token, (v) => { userHfToken = v; });
}

export async function getHfToken() {
  if (userHfToken !== null) return userHfToken;
  return _loadByokKey(HF_TOKEN_STORE, (v) => { userHfToken = v; });
}

export async function setReplicateToken(token) {
  await _saveByokKey(REPLICATE_TOKEN_STORE, token, (v) => { userReplicateToken = v; });
}

export async function getReplicateToken() {
  if (userReplicateToken !== null) return userReplicateToken;
  return _loadByokKey(REPLICATE_TOKEN_STORE, (v) => { userReplicateToken = v; });
}

// Preload all BYOK keys on startup so the first request can attach them.
const byokPreloadPromise = Promise.all([getGeminiKey(), getHfToken(), getReplicateToken()]).catch(() => {});

// Async snapshot: waits until preloaded keys are actually in memory.
// Fixes the race where the Generate screen read keys before they loaded.
export async function getByokSnapshotAsync() {
  await byokPreloadPromise;
  return getByokSnapshot();
}

// Returns a snapshot of all BYOK keys (for the Settings screen status row).
export function getByokSnapshot() {
  return {
    gemini: userGeminiKey || '',
    huggingface: userHfToken || '',
    replicate: userReplicateToken || '',
  };
}

export async function setCustomServerUrl(url) {
  // Sanitize before saving: auto-prepend https:// if missing, strip trailing
  // slashes, strip any /api/health suffix the user might have pasted.
  const cleaned = sanitizeCustomUrl(url);
  if (!cleaned) {
    await AsyncStorage.removeItem(CUSTOM_SERVER_KEY);
    customServerUrl = null;
  } else {
    await AsyncStorage.setItem(CUSTOM_SERVER_KEY, cleaned);
    customServerUrl = cleaned;
  }
  // Reset baseUrl so next discovery uses the new setting
  baseUrl = null;
}

// Cleans up what the user typed in Settings:
//   "  frogpaper-mobile.onrender.com/  "  ->  "https://frogpaper-mobile.onrender.com"
//   "https://frogpaper-mobile.onrender.com/api/health"  ->  "https://frogpaper-mobile.onrender.com"
//   "  http://192.168.1.20:5000/  "  ->  "http://192.168.1.20:5000"
export function sanitizeCustomUrl(url) {
  if (typeof url !== 'string') return '';
  let value = url.trim();
  if (!value) return '';
  // Auto-prepend https:// if no scheme is present
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  // Strip stray keyboard punctuation that often tags along when pasting
  value = value.replace(/[`'"]+$/, '');
  // Strip any /api/* suffix the user might have copied along with the URL
  value = value.replace(/\/api\/?(health)?\/?$/i, '');
  // Strip trailing slashes
  while (value.endsWith('/')) {
    value = value.slice(0, -1);
  }
  return value;
}

export async function getCustomServerUrl() {
  if (customServerUrl !== null) {
    return customServerUrl;
  }
  try {
    const saved = await AsyncStorage.getItem(CUSTOM_SERVER_KEY);
    // Sanitize on read too - in case an unsanitized URL was saved by an
    // older build. Strips trailing slashes, fixes missing https://, etc.
    customServerUrl = saved ? sanitizeCustomUrl(saved) : null;
    return customServerUrl;
  } catch (error) {
    return null;
  }
}

// Load custom URL on startup
getCustomServerUrl().catch(() => {});

function candidateBaseUrls() {
  if (customServerUrl) {
    return [customServerUrl];
  }
  
  if (Platform.OS === 'web') {
    return [`http://localhost:${PORT}`];
  }
  if (Platform.OS === 'android') {
    return [
      devHostLanUrl(),
      `http://${EMULATOR_ALIAS}:${PORT}`,
      `http://localhost:${PORT}`,
    ].filter(Boolean);
  }
  // iOS
  return [devHostLanUrl(), `http://localhost:${PORT}`].filter(Boolean);
}

let baseUrl = null;

async function probe(base, timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${base}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Tries each candidate URL and remembers the first one that answers /api/health.
export async function discoverBaseUrl(timeoutMs = 2500) {
  // Make sure we have the latest custom URL loaded before picking candidates
  if (customServerUrl === null) {
    await getCustomServerUrl();
  }
  const candidates = candidateBaseUrls();
  for (const candidate of candidates) {
    // the custom URL usually points at a cloud host that may be waking from
    // sleep - give it a much more patient timeout than the LAN probes
    const isCustom = customServerUrl && candidate === customServerUrl;
    const timeout = isCustom ? Math.max(timeoutMs * 4, 10000) : timeoutMs;
    const reachable = await probe(candidate, timeout);
    if (reachable) {
      baseUrl = candidate;
      return baseUrl;
    }
  }
  // Cloud servers asleep on the free tier can take up to a minute to answer.
  // If a custom URL is configured, give it one long patient retry before
  // declaring the backend unreachable.
  if (customServerUrl) {
    const reachable = await probe(customServerUrl, 30000);
    if (reachable) {
      baseUrl = customServerUrl;
      return baseUrl;
    }
  }
  // Fall back to the first candidate so callers get a meaningful error.
  baseUrl = candidates[0];
  return baseUrl;
}

export function getBaseUrl() {
  if (!baseUrl) {
    baseUrl = candidateBaseUrls()[0];
  }
  return baseUrl;
}

async function parseResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    // non-JSON body (e.g. a proxy error page) - fall through to status check
  }
  if (!response.ok) {
    const message =
      (payload && payload.error && payload.error.message) ||
      `Request failed (HTTP ${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

// Distinguishes the two ways a request can fail:
//   - "offline": nothing came back at all (DNS failure, refused connection,
//     our own timeout). No HTTP status - the request may well work later.
//   - "server error": the backend answered with 4xx/5xx, which parseResponse
//     carries on error.status. That is a verdict about THIS request, so
//     retrying it blindly only burns provider quota.
// The generation queue holds only the offline kind.
export function isOfflineError(error) {
  return !error || error.status === undefined || error.status === null;
}

async function request(path, options = {}) {
  const base = getBaseUrl();
  // A cold start can reach the first screen before the startup AsyncStorage
  // read has cached the access key. Wait for it here so those requests (and
  // the image URLs built from the same cached key afterwards) still carry
  // the key on a server where it is armed.
  await accessKeyPreloadPromise;
  // Wait for the id too: the very first generate must already be attributable.
  await deviceIdPreloadPromise;
  const { signal, timeoutMs, ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json' };

  // Add access key to headers if configured
  if (accessKey) {
    headers['X-Access-Key'] = accessKey;
  }

  // Identifies this install, so only this phone can collect the pictures it made.
  if (deviceId) {
    headers['X-Device-Id'] = deviceId;
  }

  // Attach BYOK keys (if the user has set any). The backend uses these
  // INSTEAD OF any server-side keys when present, and never logs them.
  // All three are sent on every API request so the backend can pick the
  // right one for whichever provider the user picked (or the default).
  if (userGeminiKey) {
    headers['X-Gemini-Key'] = userGeminiKey;
  }
  if (userHfToken) {
    headers['X-Hf-Token'] = userHfToken;
  }
  if (userReplicateToken) {
    headers['X-Replicate-Token'] = userReplicateToken;
  }

  // 60s safety timeout so the UI can never spin forever; callers that pass
  // their own AbortController signal (e.g. generate cancel) keep full control.
  // A caller-supplied timeoutMs (generate uses 180s for peak-hour queues)
  // overrides the default.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 60000);
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      headers,
      ...fetchOptions,
      signal: signal || controller.signal,
    });
    return parseResponse(response);
  } catch (error) {
    // Quiet failures are worth keeping: record everything except the app's own
    // offline/cancel noise (the error log filters those out) so the owner can
    // show me what actually went wrong later.
    recordError(error, path);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  async health() {
    if (!baseUrl) {
      await discoverBaseUrl();
    }
    return request('/api/health');
  },
  providers: () => request('/api/providers'),
  generate: ({ prompt, negativePrompt, width = 1080, height = 1920, seed, provider, timeoutMs, signal }) =>
    request('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        width,
        height,
        ...(seed !== undefined && seed !== null ? { seed } : {}),
        ...(provider ? { provider } : {}),
      }),
      timeoutMs,
      signal,
    }),
  recentPrompts: (limit = 8) =>
    request(`/api/prompts/recent?limit=${limit}`),
  gallery: (limit = 200) => request(`/api/gallery?limit=${limit}`),
  imageDetail: (filename) =>
    request(`/api/gallery/${encodeURIComponent(filename)}`),
  deleteImage: (filename) =>
    request(`/api/gallery/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),
  uploadImage: async (asset) => {

    // Loaded lazily: the headless check scripts stub the native modules, and a
    // top-level import of expo/fetch would drag the native runtime into them.
    // eslint-disable-next-line global-require
    const { fetch: expoFetch } = require('expo/fetch');
    // eslint-disable-next-line global-require
    const { File } = require('expo-file-system');
    const base = getBaseUrl();
    const form = new FormData();
    if (Platform.OS === 'web') {
      // web: turn the local blob/data URI into a real Blob part
      const blob = await (await fetch(asset.uri)).blob();
      form.append('file', blob, asset.fileName || 'upload.jpg');
    } else {
      // Native: this React Native version rejects the legacy {uri,name,type}
      // descriptor with "Unsupported FormDataPart implementation", so the form
      // gets a real File object instead.
      form.append('file', new File(asset.uri), asset.fileName || 'upload.jpg');
    }
    // NOTE: no Content-Type header - fetch sets the multipart boundary
    const headers = {};
    if (accessKey) {
      headers['X-Access-Key'] = accessKey;
    }
    const uploadDeviceId = deviceId || (await getDeviceId());
    if (uploadDeviceId) {
      headers['X-Device-Id'] = uploadDeviceId;
    }
    // Attach BYOK keys on upload too (consistent with all other requests).
    if (userGeminiKey) {
      headers['X-Gemini-Key'] = userGeminiKey;
    }
    if (userHfToken) {
      headers['X-Hf-Token'] = userHfToken;
    }
    if (userReplicateToken) {
      headers['X-Replicate-Token'] = userReplicateToken;
    }
    // expo/fetch is the implementation that understands a File part.
    const response = await expoFetch(`${base}/api/gallery/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    return parseResponse(response);
  },
  // <Image source={{ uri }}> and File.downloadFileAsync (save, set-as-wallpaper,
  // daily wallpaper) cannot send headers, so the backend also accepts the key
  // as ?key=... on /api/images/* only. With no key set the URL is unchanged.
  imageUrl: (filename) => {
    const url = `${getBaseUrl()}/api/images/${encodeURIComponent(filename)}`;
    const parts = [];
    if (accessKey) {
      parts.push(`key=${encodeURIComponent(accessKey)}`);
    }
    if (deviceId) {
      parts.push(`device=${encodeURIComponent(deviceId)}`);
    }
    return parts.length ? `${url}?${parts.join('&')}` : url;
  },
  slideshowConfig: () => request('/api/slideshow/config'),
  setSlideshowConfig: (config) =>
    request('/api/slideshow/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  slideshowNext: () => request('/api/slideshow/next'),
};

export default api;
