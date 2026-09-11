// API service layer - talks to the Flask backend.
//
// Backend URL resolution order:
//   1. Custom server URL saved in Settings (e.g. https://your-backend.onrender.com)
//      - tried first, with a patient timeout (cloud servers sleep and wake slowly)
//   2. Android emulator alias 10.0.2.2, LAN IP, localhost (PC backend workflow)
//
// The custom URL is persisted with AsyncStorage so it survives app restarts.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAN_IP = '192.168.1.168'; // manual fallback - your Windows PC running the backend (check with `ipconfig` if your router reassigns IPs)
export const EMULATOR_ALIAS = '10.0.2.2'; // Android emulator alias for the host machine
const PORT = 5000;
const CUSTOM_URL_KEY = '@frogpaper/custom_server_url';

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

// Cleans up what the user typed in Settings:
//   "  my-backend.onrender.com/  " -> "https://my-backend.onrender.com"
export function sanitizeCustomUrl(url) {
  if (typeof url !== 'string') return '';
  let value = url.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  while (value.endsWith('/')) {
    value = value.slice(0, -1);
  }
  // people often paste the health-check page - the app adds these paths itself
  value = value.replace(/\/api\/health$/i, '');
  value = value.replace(/\/api$/i, '');
  // stray punctuation from phone keyboards
  value = value.replace(/[.,;:!]+$/, '');
  while (value.endsWith('/')) {
    value = value.slice(0, -1);
  }
  return value;
}

export async function getCustomServerUrl() {
  try {
    const saved = await AsyncStorage.getItem(CUSTOM_URL_KEY);
    return saved ? sanitizeCustomUrl(saved) : null;
  } catch (error) {
    return null;
  }
}

export async function setCustomServerUrl(url) {
  const cleaned = sanitizeCustomUrl(url);
  try {
    if (cleaned) {
      await AsyncStorage.setItem(CUSTOM_URL_KEY, cleaned);
    } else {
      await AsyncStorage.removeItem(CUSTOM_URL_KEY);
    }
  } catch (error) {
    // storage unavailable - still apply in-memory so this session works
  }
  customUrl = cleaned || null;
  baseUrl = customUrl; // force re-discovery on the next request
  return cleaned;
}

let customUrl = null; // in-memory cache of the saved custom server URL

function candidateBaseUrls() {
  const candidates = [];
  if (customUrl) {
    candidates.push(customUrl);
  }
  if (Platform.OS === 'web') {
    candidates.push(`http://localhost:${PORT}`);
    return candidates.filter(Boolean);
  }
  if (Platform.OS === 'android') {
    candidates.push(
      devHostLanUrl(),
      `http://${LAN_IP}:${PORT}`,
      `http://${EMULATOR_ALIAS}:${PORT}`,
      `http://localhost:${PORT}`,
    );
  } else {
    candidates.push(devHostLanUrl(), `http://${LAN_IP}:${PORT}`, `http://localhost:${PORT}`);
  }
  return candidates.filter(Boolean);
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
  if (customUrl === null) {
    customUrl = await getCustomServerUrl();
  }
  const candidates = candidateBaseUrls();
  for (const candidate of candidates) {
    // the custom URL usually points at a cloud host that may be waking from
    // sleep - give it a much more patient timeout than the LAN probes
    const isCustom = customUrl && candidate === customUrl;
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
  if (customUrl) {
    const reachable = await probe(customUrl, 30000);
    if (reachable) {
      baseUrl = customUrl;
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
  // every request gets a safety timeout so the UI can never spin forever;
  // callers that pass their own AbortController signal (e.g. generate cancel)
  // keep full control instead
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      signal: options.signal || controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
  generate: ({ prompt, negativePrompt, width = 1080, height = 1920, seed, signal }) =>
    request('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        width,
        height,
        ...(seed !== undefined && seed !== null ? { seed } : {}),
      }),
      ...(signal ? { signal } : {}),
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
    const response = await fetch(`${base}/api/gallery/upload`, {
      method: 'POST',
      body: form,
    });
    return parseResponse(response);
  },
  imageUrl: (filename) => `${getBaseUrl()}/api/images/${encodeURIComponent(filename)}`,
};

export default api;
