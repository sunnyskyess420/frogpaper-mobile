// API service layer - talks to the Flask backend.
//
// Backend URL resolution is automatic per platform:
//   - web            -> http://localhost:5000
//   - Android device -> tries the Expo Go dev-host LAN IP (auto-detected),
//                       then emulator alias 10.0.2.2, then LAN_IP, then localhost
//   - iOS device     -> tries the Expo Go dev-host LAN IP (auto-detected),
//                       then LAN_IP, then localhost
//
// The auto-detected IP comes from Expo Go itself: when the phone loads the app
// from the dev server it already knows the PC's LAN address (expoConfig.hostUri,
// e.g. "192.168.1.20:8081"). The backend lives on the same PC, just on port 5000.
//
// LAN_IP is only a manual fallback: if auto-detection fails (e.g. production
// build), set it to your PC's LAN IP (run `ipconfig` on Windows and look for
// the IPv4 Address of your Wi-Fi adapter).

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAN_IP = '192.168.1.168'; // manual fallback - your Windows PC running the backend (check with `ipconfig` if your router reassigns IPs)
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
let accessKey = null;

// BYOK keys - cached in memory after first load. Updated by setX() functions.
let userGeminiKey = null;
let userHfToken = null;
let userReplicateToken = null;

export async function setAccessKey(key) {
  if (!key || key.trim() === '') {
    await AsyncStorage.removeItem(ACCESS_KEY_KEY);
    accessKey = null;
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
    accessKey = await AsyncStorage.getItem(ACCESS_KEY_KEY);
    return accessKey;
  } catch (error) {
    return null;
  }
}

// Load access key on startup
getAccessKey().catch(() => {});

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
Promise.all([getGeminiKey(), getHfToken(), getReplicateToken()]).catch(() => {});

// Returns a snapshot of all BYOK keys (for the Settings screen status row).
export function getByokSnapshot() {
  return {
    gemini: userGeminiKey || '',
    huggingface: userHfToken || '',
    replicate: userReplicateToken || '',
  };
}

export async function setCustomServerUrl(url) {
  if (!url || url.trim() === '') {
    await AsyncStorage.removeItem(CUSTOM_SERVER_KEY);
    customServerUrl = null;
  } else {
    const trimmed = url.trim();
    await AsyncStorage.setItem(CUSTOM_SERVER_KEY, trimmed);
    customServerUrl = trimmed;
  }
  // Reset baseUrl so next discovery uses the new setting
  baseUrl = null;
}

export async function getCustomServerUrl() {
  if (customServerUrl !== null) {
    return customServerUrl;
  }
  try {
    customServerUrl = await AsyncStorage.getItem(CUSTOM_SERVER_KEY);
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
      `http://${LAN_IP}:${PORT}`,
      `http://${EMULATOR_ALIAS}:${PORT}`,
      `http://localhost:${PORT}`,
    ].filter(Boolean);
  }
  // iOS
  return [devHostLanUrl(), `http://${LAN_IP}:${PORT}`, `http://localhost:${PORT}`].filter(
    Boolean,
  );
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
  const candidates = candidateBaseUrls();
  for (const candidate of candidates) {
    const reachable = await probe(candidate, timeoutMs);
    if (reachable) {
      baseUrl = candidate;
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

async function request(path, options = {}) {
  const base = getBaseUrl();
  const { signal, ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json' };

  // Add access key to headers if configured
  if (accessKey) {
    headers['X-Access-Key'] = accessKey;
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

  const response = await fetch(`${base}${path}`, {
    headers,
    ...fetchOptions,
    signal,
  });
  return parseResponse(response);
}

export const api = {
  async health() {
    if (!baseUrl) {
      await discoverBaseUrl();
    }
    return request('/api/health');
  },
  providers: () => request('/api/providers'),
  generate: ({ prompt, negativePrompt, width = 1080, height = 1920, seed, provider, signal }) =>
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
    const base = getBaseUrl();
    const form = new FormData();
    if (Platform.OS === 'web') {
      // web: turn the local blob/data URI into a real Blob part
      const blob = await (await fetch(asset.uri)).blob();
      form.append('file', blob, asset.fileName || 'upload.jpg');
    } else {
      // native: React Native FormData accepts a uri descriptor
      form.append('file', {
        uri: asset.uri,
        name: asset.fileName || 'upload.jpg',
        type: asset.mimeType || 'image/jpeg',
      });
    }
    // NOTE: no Content-Type header - fetch sets the multipart boundary
    const headers = {};
    if (accessKey) {
      headers['X-Access-Key'] = accessKey;
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
    const response = await fetch(`${base}/api/gallery/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    return parseResponse(response);
  },
  imageUrl: (filename) => `${getBaseUrl()}/api/images/${encodeURIComponent(filename)}`,
  slideshowConfig: () => request('/api/slideshow/config'),
  setSlideshowConfig: (config) =>
    request('/api/slideshow/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  slideshowNext: () => request('/api/slideshow/next'),
};

export default api;
