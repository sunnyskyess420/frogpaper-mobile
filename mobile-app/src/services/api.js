// API service layer - talks to the Flask backend.
//
// Backend URL resolution is automatic per platform:
//   - web            -> http://localhost:5000
//   - Android device -> tries emulator alias 10.0.2.2, then LAN IP, then localhost
//   - iOS device     -> tries LAN IP, then localhost
//
// If your PC's LAN IP changes, update LAN_IP below (run `ipconfig` on Windows
// and look for the IPv4 Address of your Wi-Fi adapter).

import { Platform } from 'react-native';

export const LAN_IP = '10.2.0.2'; // your Windows PC running the backend
export const EMULATOR_ALIAS = '10.0.2.2'; // Android emulator alias for the host machine
const PORT = 5000;

function candidateBaseUrls() {
  if (Platform.OS === 'web') {
    return [`http://localhost:${PORT}`];
  }
  if (Platform.OS === 'android') {
    return [
      `http://${EMULATOR_ALIAS}:${PORT}`,
      `http://${LAN_IP}:${PORT}`,
      `http://localhost:${PORT}`,
    ];
  }
  // iOS
  return [`http://${LAN_IP}:${PORT}`, `http://localhost:${PORT}`];
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
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
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
  generate: ({ prompt, width = 1080, height = 1920, seed }) =>
    request('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        width,
        height,
        ...(seed !== undefined && seed !== null ? { seed } : {}),
      }),
    }),
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
