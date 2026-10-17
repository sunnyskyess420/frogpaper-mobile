/**
 * "Is there a newer FrogPaper?" - asked of the public GitHub releases page.
 *
 * Deliberately simple and honest:
 *   - no token, no account, nothing about the phone is sent
 *   - before the first release exists GitHub answers 404, which is reported as
 *     "no releases yet" rather than dressed up as an error
 *   - it never blocks or throws: the app works exactly the same offline
 *
 * The check is manual (a button in Settings). Nothing runs on its own.
 */
import Constants from 'expo-constants';

const RELEASES_API = 'https://api.github.com/repos/sunnyskyess420/frogpaper-mobile/releases/latest';
const RELEASES_PAGE = 'https://github.com/sunnyskyess420/frogpaper-mobile/releases/latest';

export const RELEASES_URL = RELEASES_PAGE;

export function runningVersion() {
  return (Constants.expoConfig && Constants.expoConfig.version) || '0.0.0';
}

/** "v1.2.3" / "1.2.3" / "1.2" -> [1, 2, 3]; anything unusable -> null. */
export function parseVersion(text) {
  const cleaned = String(text || '').trim().replace(/^v/i, '');
  if (!cleaned) {
    return null;
  }
  const parts = cleaned.split('.');
  const numbers = [];
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    numbers.push(value);
  }
  while (numbers.length < 3) {
    numbers.push(0);
  }
  return numbers.slice(0, 3);
}

/** 1 when a is newer, -1 when b is newer, 0 when equal. Unusable input = 0. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] > right[index] ? 1 : -1;
    }
  }
  return 0;
}

/**
 * Asks GitHub what the latest release is.
 *
 * Returns one of:
 *   { state: 'update', current, latest, url }
 *   { state: 'current', current }
 *   { state: 'none' }          - no release has been published yet
 *   { state: 'offline' }       - could not reach GitHub
 */
export async function checkForUpdate({ timeoutMs = 15000 } = {}) {
  const current = runningVersion();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FrogPaper-Mobile' },
      signal: controller ? controller.signal : undefined,
    });
    if (response.status === 404) {
      return { state: 'none', current };
    }
    if (!response.ok) {
      return { state: 'offline', current };
    }
    const release = await response.json();
    const tag = release && (release.tag_name || release.name);
    if (!tag) {
      return { state: 'none', current };
    }
    if (compareVersions(tag, current) > 0) {
      return {
        state: 'update',
        current,
        latest: String(tag).replace(/^v/i, ''),
        url: release.html_url || RELEASES_PAGE,
      };
    }
    return { state: 'current', current };
  } catch (error) {
    return { state: 'offline', current };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Pure decision helper for "should Home show the update modal this launch?".
 *
 * Returns true only when:
 *   - record.state === 'update' (a newer release was seen),
 *   - record.latest exists (the version string the modal would advertise),
 *   - the dismissed version differs from record.latest (a newer release must
 *     re-prompt even after the user dismissed an older one).
 *
 * Kept storage-free on purpose: scripts/check-update.js loads this module
 * without an AsyncStorage stub, and HomeScreen owns the dismissed-version
 * key. The function never throws - any malformed input simply means "do
 * not prompt".
 */
export function shouldPromptUpdate(record, dismissedVersion) {
  if (!record || typeof record !== 'object') {
    return false;
  }
  if (record.state !== 'update') {
    return false;
  }
  if (typeof record.latest !== 'string' || record.latest.length === 0) {
    return false;
  }
  if (typeof dismissedVersion !== 'string' || dismissedVersion.length === 0) {
    // Nothing dismissed yet - always prompt for an update.
    return true;
  }
  return record.latest !== dismissedVersion;
}
