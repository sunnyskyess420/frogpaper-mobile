#!/usr/bin/env node
/**
 * check-byok.js - headless verification of the BYOK key storage.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-byok.js
 * or via the npm script:
 *     npm run check:byok
 *
 * Proves, with no device and no network:
 *   1. A saved Gemini / HF / Replicate key round-trips through the storage
 *      backend and survives a fresh module load (simulated restart).
 *   2. Clearing a key (setX('')) wipes it from both SecureStore and the
 *      legacy AsyncStorage slot.
 *   3. Migration: a key left in AsyncStorage by a previous install is
 *      picked up on the first read of the new SecureStore backend, copied
 *      across, and the legacy slot is wiped - all on the next get() call.
 *   4. Migration is idempotent: a second get() after migration returns the
 *      same value, and the legacy slot stays empty.
 *   5. Keys never appear in api.imageUrl() output, byokSnapshot reports
 *      the saved key as present (non-empty) without leaking the value.
 *   6. Whitespace is trimmed when saving, matching the access-key path.
 *
 * Same ESM transpile + native-module stub trick as the other check scripts.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

// Two independent backing maps so the migration step has a real "legacy"
// pool to read from. AsyncStorage is the legacy pool; SecureStore is the
// new pool. The api module decides which pool to read based on Platform.OS.
const asyncStorageMap = new Map();
const secureStoreMap = new Map();

const asyncStorageStub = {
  __esModule: true,
  default: {
    async getItem(key) {
      return asyncStorageMap.has(key) ? asyncStorageMap.get(key) : null;
    },
    async setItem(key, value) {
      asyncStorageMap.set(key, value);
    },
    async removeItem(key) {
      asyncStorageMap.delete(key);
    },
  },
};

const secureStoreStub = {
  __esModule: true,
  async getItemAsync(key) {
    return secureStoreMap.has(key) ? secureStoreMap.get(key) : null;
  },
  async setItemAsync(key, value) {
    secureStoreMap.set(key, value);
  },
  async deleteItemAsync(key) {
    secureStoreMap.delete(key);
  },
};

const reactNativeStub = {
  __esModule: true,
  Platform: {
    // 'android' exercises the SecureStore code path; this script does not
    // need a web fallback case because USE_SECURE_STORE is false on web and
    // the code collapses to AsyncStorage.getItem/setItem which is already
    // covered by the access-key test.
    OS: 'android',
    select: (options) => (options && (options.android || options.default)) || null,
  },
};

const expoConstantsStub = {
  __esModule: true,
  default: { expoConfig: { version: '1.9.50' } },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return asyncStorageStub;
  }
  if (request === 'react-native') {
    return reactNativeStub;
  }
  if (request === 'expo-constants') {
    return expoConstantsStub;
  }
  if (request === 'expo-secure-store') {
    return secureStoreStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const originalJs = Module._extensions['.js'];
Module._extensions['.js'] = function (mod, filename) {
  if (filename.includes('node_modules')) {
    return originalJs(mod, filename);
  }
  const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  mod._compile(code, filename);
};

// The api module caches BYOK keys in memory after first load, so each
// scenario needs a fresh module instance.
const apiPath = path.join(ROOT, 'src/services/api.js');
function freshApi() {
  delete require.cache[require.resolve(apiPath)];
  return require(apiPath);
}

let passes = 0;
let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    passes += 1;
    console.log(`${PASS} ${name}`);
  } else {
    failures += 1;
    console.log(`${FAIL} ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function main() {
  console.log('BYOK key storage');

  // 1. Save -> restart -> read round trip for each provider.
  for (const [label, setFn, getFn, storeKey] of [
    ['gemini', 'setGeminiKey', 'getGeminiKey', '@frogpaper_user_gemini_key'],
    ['huggingface', 'setHfToken', 'getHfToken', '@frogpaper_user_hf_token'],
    ['replicate', 'setReplicateToken', 'getReplicateToken', '@frogpaper_user_replicate_token'],
  ]) {
    asyncStorageMap.clear();
    secureStoreMap.clear();
    const api = freshApi();
    await api[setFn](`secret-${label}-token-123`);

    // The save must go to SecureStore, NOT AsyncStorage (post-migration).
    check(
      `${label}: a saved key lands in SecureStore`,
      secureStoreMap.get(storeKey) === `secret-${label}-token-123`,
      `secureStore=${JSON.stringify(secureStoreMap.get(storeKey))} asyncStorage=${JSON.stringify(asyncStorageMap.get(storeKey))}`
    );
    check(
      `${label}: a saved key does NOT land in AsyncStorage`,
      !asyncStorageMap.has(storeKey) || asyncStorageMap.get(storeKey) == null,
      `asyncStorage=${JSON.stringify(asyncStorageMap.get(storeKey))}`
    );

    // Restart: drop the module cache so the in-memory cache is gone, then read.
    const restarted = freshApi();
    const value = await restarted[getFn]();
    check(
      `${label}: the key survives a restart`,
      value === `secret-${label}-token-123`,
      `got=${JSON.stringify(value)}`
    );

    // byokSnapshot reports presence without leaking the value to a URL.
    const snapshot = restarted.getByokSnapshot();
    check(
      `${label}: getByokSnapshot() reports the key as set`,
      snapshot[label === 'huggingface' ? 'huggingface' : label] === `secret-${label}-token-123`,
      JSON.stringify(snapshot)
    );
  }

  // 2. Whitespace is trimmed when saving (matches access-key path).
  asyncStorageMap.clear();
  secureStoreMap.clear();
  {
    const api = freshApi();
    await api.setGeminiKey('   padded-gemini-key   ');
    check(
      'whitespace is trimmed when saving a BYOK key',
      secureStoreMap.get('@frogpaper_user_gemini_key') === 'padded-gemini-key',
      JSON.stringify(secureStoreMap.get('@frogpaper_user_gemini_key'))
    );
  }

  // 3. Clearing a key wipes both backends.
  asyncStorageMap.clear();
  secureStoreMap.clear();
  {
    const api = freshApi();
    await api.setHfToken('hf-keep-then-clear');
    // Simulate a stale legacy copy left over from before migration ran.
    asyncStorageMap.set('@frogpaper_user_hf_token', 'hf-keep-then-clear');
    await api.setHfToken('');
    check(
      'clear wipes SecureStore',
      !secureStoreMap.has('@frogpaper_user_hf_token'),
      JSON.stringify(secureStoreMap.get('@frogpaper_user_hf_token'))
    );
    check(
      'clear wipes the legacy AsyncStorage slot too',
      !asyncStorageMap.has('@frogpaper_user_hf_token'),
      JSON.stringify(asyncStorageMap.get('@frogpaper_user_hf_token'))
    );
    const restarted = freshApi();
    check(
      'a cleared key reads back as empty after restart',
      (await restarted.getHfToken()) === '',
      JSON.stringify(await restarted.getHfToken())
    );
  }

  // 4. Migration: legacy AsyncStorage value -> SecureStore on first get().
  asyncStorageMap.clear();
  secureStoreMap.clear();
  {
    // Pre-populate the legacy AsyncStorage slot as if a v1.11 install saved
    // the key, then upgraded to a SecureStore-aware build.
    asyncStorageMap.set('@frogpaper_user_replicate_token', 'legacy-replicate-key-xyz');
    const api = freshApi();
    const value = await api.getReplicateToken();
    check(
      'migration: the legacy AsyncStorage value is returned on first read',
      value === 'legacy-replicate-key-xyz',
      JSON.stringify(value)
    );
    check(
      'migration: the value is now in SecureStore',
      secureStoreMap.get('@frogpaper_user_replicate_token') === 'legacy-replicate-key-xyz',
      JSON.stringify(secureStoreMap.get('@frogpaper_user_replicate_token'))
    );
    check(
      'migration: the legacy AsyncStorage slot is wiped',
      !asyncStorageMap.has('@frogpaper_user_replicate_token') ||
        asyncStorageMap.get('@frogpaper_user_replicate_token') == null,
      JSON.stringify(asyncStorageMap.get('@frogpaper_user_replicate_token'))
    );
  }

  // 5. Migration is idempotent: a second read after migration returns the
  // same value, and the legacy slot stays empty.
  {
    const restarted = freshApi();
    const value = await restarted.getReplicateToken();
    check(
      'migration: a second read returns the migrated value',
      value === 'legacy-replicate-key-xyz',
      JSON.stringify(value)
    );
    check(
      'migration: the legacy slot is still empty on the second read',
      !asyncStorageMap.has('@frogpaper_user_replicate_token') ||
        asyncStorageMap.get('@frogpaper_user_replicate_token') == null,
      JSON.stringify(asyncStorageMap.get('@frogpaper_user_replicate_token'))
    );
  }

  // 6. Keys never appear in image URL output.
  asyncStorageMap.clear();
  secureStoreMap.clear();
  {
    const apiModule = freshApi();
    const api = apiModule.default || apiModule.api || apiModule;
    await apiModule.setGeminiKey('super-secret-gemini-key-9382');
    await apiModule.setHfToken('super-secret-hf-token-1029');
    await apiModule.setReplicateToken('super-secret-replicate-token-4477');
    const url = api.imageUrl('test_image.png');
    check(
      'BYOK keys never appear in image URLs',
      !url.includes('gemini') &&
        !url.includes('hf') &&
        !url.includes('replicate') &&
        !url.includes('super-secret'),
      url
    );
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
