// The AI engine the owner picked on the Generate screen, remembered across
// screen mounts and app restarts.
//
// The choice used to be plain component state, so leaving the screen (or
// restarting the app) silently dropped the owner back onto the free default -
// picking Hugging Face never stuck. It now lives under one AsyncStorage key as
// a plain provider id.
//
// The saved id is re-validated against the live provider list on every load
// instead of being trusted blindly: an engine that disappeared, or a paid one
// whose saved key was cleared, falls back to the free default and says so.
// `resolveEnginePreference` holds that decision as a pure function so
// scripts/check-engine.js can prove every branch without a device.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ENGINE_PREFERENCE_KEY = '@frogpaper/engine_preference';

// Provider ids are backend slugs (pollinations, gemini, huggingface, replicate).
// A value that does not look like one is treated as "nothing saved", so a
// corrupted entry can never be mistaken for a real engine.
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

// The engine the owner chose, or null when there is none / it is unreadable.
export async function loadEnginePreference() {
  try {
    const raw = await AsyncStorage.getItem(ENGINE_PREFERENCE_KEY);
    if (typeof raw !== 'string') {
      return null;
    }
    const id = raw.trim();
    return ID_PATTERN.test(id) ? id : null;
  } catch (err) {
    // Unreadable storage means "no preference", never a crash on screen load.
    return null;
  }
}

// Remember a choice. A blank / malformed id clears the preference instead of
// storing junk, and a failed write only costs the preference - the screen has
// already switched engines by then.
export async function saveEnginePreference(id) {
  try {
    const cleanId = typeof id === 'string' ? id.trim() : '';
    if (ID_PATTERN.test(cleanId)) {
      await AsyncStorage.setItem(ENGINE_PREFERENCE_KEY, cleanId);
    } else {
      await AsyncStorage.removeItem(ENGINE_PREFERENCE_KEY);
    }
  } catch (err) {
    // best-effort - never break generation over a failed preference write
  }
}

export async function clearEnginePreference() {
  try {
    await AsyncStorage.removeItem(ENGINE_PREFERENCE_KEY);
  } catch (err) {
    // best-effort
  }
}

// Usability rule shared by the engine chips and the restore decision: the
// backend says the engine is ready, or the owner saved their own key for it.
export function isProviderUsable(provider, byok) {
  if (!provider) {
    return false;
  }
  return provider.status === 'active' || !!(byok && byok[provider.id]);
}

// The free-engine-first order the screen has always used when nothing is saved.
export function pickDefaultProvider(providers, byok) {
  const list = Array.isArray(providers) ? providers : [];
  const usable = (p) => isProviderUsable(p, byok);
  return (
    list.find((p) => p.id === 'pollinations' && usable(p)) ||
    list.find((p) => p.id === 'gemini' && usable(p)) ||
    list.find((p) => p.id === 'huggingface' && usable(p)) ||
    list.find((p) => usable(p)) ||
    list[0] ||
    null
  );
}

// Turn the saved id plus the live provider list into the selection the screen
// should show:
//   providerId  the engine to select (null only when the list is empty)
//   restored    true only when the saved engine is actually in effect
//   reason      'needs-key' | 'unavailable' when it could not be, else null
//   note        one honest sentence for the engine section, else null
export function resolveEnginePreference({ savedId, providers, byok } = {}) {
  const list = Array.isArray(providers) ? providers : [];
  const fallback = pickDefaultProvider(list, byok);
  const fallbackName = fallback ? fallback.name : null;

  if (!savedId) {
    // Nothing saved is not a fallback - it is today's normal default, so no note.
    return {
      providerId: fallback ? fallback.id : null,
      restored: false,
      reason: null,
      note: null,
    };
  }

  const saved = list.find((p) => p.id === savedId);
  if (!saved) {
    return {
      providerId: fallback ? fallback.id : null,
      restored: false,
      reason: 'unavailable',
      note: fallbackName
        ? `Your saved engine is not available right now - using ${fallbackName} instead.`
        : 'Your saved engine is not available right now.',
    };
  }

  if (!isProviderUsable(saved, byok)) {
    return {
      providerId: fallback ? fallback.id : null,
      restored: false,
      reason: 'needs-key',
      note: fallbackName
        ? `${saved.name} needs a saved key - using ${fallbackName} instead.`
        : `${saved.name} needs a saved key.`,
    };
  }

  return { providerId: saved.id, restored: true, reason: null, note: null };
}
