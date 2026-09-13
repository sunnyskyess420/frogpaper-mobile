#!/usr/bin/env node
/**
 * check-offline.js - headless verification of the offline paths.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-offline.js
 * or via the npm script:
 *     npm run check:offline
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build hooks.
 *
 * What it proves (no device, no backend, no network):
 *   1. The gallery list falls back to the copy saved in AsyncStorage when the
 *      live /api/gallery fetch cannot reach the server, and reports `offline`.
 *   2. With nothing cached the same helper still throws, so the screens keep
 *      their original "could not load" error path.
 *   3. Cached images are downloaded through api.imageUrl (access key included),
 *      filename -> local path lookup works, and the cache stays bounded.
 *   4. processQueue() stops on the first network failure, keeps those entries,
 *      removes the ones that succeed, and marks server-refused entries failed
 *      instead of retrying them forever.
 *
 * How it loads the app code: the service modules are plain ESM, so this script
 * transpiles them to CommonJS on the fly (babel, no config files) and stubs the
 * native modules they import (react-native, expo-file-system, expo-constants,
 * AsyncStorage) with in-memory doubles. No app bundle and no emulator needed.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

// --- tiny in-memory device -------------------------------------------------
const disk = new Map(); // uri -> { bytes, mtime }
const dirs = new Set();
let clock = Date.now();
const downloadLog = [];
let fetchHandler = null;

function joinUri(parts) {
  return parts
    .map((part) =>
      part && typeof part === 'object' && typeof part.uri === 'string' ? part.uri : String(part)
    )
    .join('/');
}

class MockFile {
  constructor(...parts) {
    this._uri = joinUri(parts);
  }
  get uri() {
    return this._uri;
  }
  get name() {
    return this._uri.split('/').pop();
  }
  get exists() {
    return disk.has(this._uri);
  }
  get size() {
    const entry = disk.get(this._uri);
    return entry ? entry.bytes : 0;
  }
  get lastModified() {
    const entry = disk.get(this._uri);
    return entry ? entry.mtime : null;
  }
  get modificationTime() {
    return this.lastModified;
  }
  delete() {
    if (!disk.has(this._uri)) {
      throw new Error(`Cannot delete a missing file: ${this._uri}`);
    }
    disk.delete(this._uri);
  }
  async move(destination) {
    const entry = disk.get(this._uri);
    if (!entry) {
      throw new Error(`Cannot move a missing file: ${this._uri}`);
    }
    disk.set(destination.uri, entry);
    disk.delete(this._uri);
  }
  static async downloadFileAsync(url, destination, options) {
    downloadLog.push({ url, destination: destination.uri, options: options || null });
    if (!fetchHandler) {
      throw new TypeError('Network request failed');
    }
    disk.set(destination.uri, { bytes: 2048, mtime: clock++ });
    return new MockFile(destination.uri);
  }
}

class MockDirectory {
  constructor(...parts) {
    this._uri = joinUri(parts);
  }
  get uri() {
    return this._uri;
  }
  get name() {
    return this._uri.split('/').pop();
  }
  get exists() {
    return dirs.has(this._uri);
  }
  create() {
    dirs.add(this._uri);
  }
  delete() {
    for (const key of [...disk.keys()]) {
      if (key.startsWith(`${this._uri}/`)) {
        disk.delete(key);
      }
    }
    dirs.delete(this._uri);
  }
  list() {
    if (!dirs.has(this._uri)) {
      throw new Error(`Directory does not exist: ${this._uri}`);
    }
    return [...disk.keys()]
      .filter((key) => key.startsWith(`${this._uri}/`))
      .sort()
      .map((key) => new MockFile(key));
  }
}

const cacheDirUri = 'file:///cache';
dirs.add(cacheDirUri);

const storage = new Map();
const asyncStorageMock = {
  getItem: async (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: async (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: async (key) => {
    storage.delete(key);
  },
  clear: async () => storage.clear(),
};

const mocks = {
  'react-native': { Platform: { OS: 'android' } },
  'expo-constants': { __esModule: true, default: { expoConfig: null }, expoConfig: null },
  'expo-file-system': {
    __esModule: true,
    File: MockFile,
    Directory: MockDirectory,
    Paths: { cache: new MockDirectory(cacheDirUri) },
  },
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorageMock },
};

// --- load the app's service modules ---------------------------------------
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) {
    return mocks[request];
  }
  return originalLoad.apply(this, arguments);
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

global.fetch = async (url, options) => {
  if (!fetchHandler) {
    throw new TypeError('Network request failed');
  }
  return fetchHandler(String(url), options);
};

const apiModule = require(path.join(ROOT, 'src/services/api.js'));
const api = apiModule.default || apiModule; // the api object; named exports hang off apiModule
const galleryCache = require(path.join(ROOT, 'src/services/galleryCache.js'));
const imageCache = require(path.join(ROOT, 'src/services/imageCache.js'));
const generationQueue = require(path.join(ROOT, 'src/services/generationQueue.js'));

// --- assertion helpers ----------------------------------------------------
let failures = 0;
let passes = 0;

function check(name, condition, detail) {
  if (condition) {
    passes += 1;
    console.log(`${PASS} ${name}`);
  } else {
    failures += 1;
    console.log(`${FAIL} ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

async function expectThrow(name, fn) {
  try {
    await fn();
    check(name, false, 'no error thrown');
  } catch (err) {
    check(name, true);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- 1 + 2: gallery list cache -------------------------------------------
async function checkGalleryCache() {
  console.log('\nGallery list cache');
  storage.clear();

  fetchHandler = async () =>
    jsonResponse({
      success: true,
      total: 2,
      images: [{ filename: 'newest.png' }, { filename: 'older.png' }],
    });
  const live = await galleryCache.loadGallery({ cacheImages: false });
  check(
    'live /api/gallery response is returned and marked online',
    live.offline === false && live.images.length === 2 && live.total === 2,
    JSON.stringify(live)
  );

  fetchHandler = null; // everything now fails like an unreachable backend
  const offline = await galleryCache.loadGallery({ cacheImages: false });
  check(
    'offline fetch falls back to the saved list and reports offline',
    offline.offline === true &&
      offline.images.map((image) => image.filename).join(',') === 'newest.png,older.png',
    JSON.stringify(offline)
  );
  check('the fallback carries a savedAt timestamp', offline.savedAt > 0);
  check(
    'the fallback still carries the live error for logging',
    !!offline.error && apiModule.isOfflineError(offline.error)
  );

  // A server that answers with an error is NOT "offline".
  fetchHandler = async () => jsonResponse({ error: { message: 'boom' } }, 500);
  const serverErr = await galleryCache.loadGallery({ cacheImages: false });
  check(
    'a 500 answer is treated as a server error, not as offline',
    serverErr.images.length === 2 && !apiModule.isOfflineError(serverErr.error)
  );
  check('api.isOfflineError: server errors are not offline', apiModule.isOfflineError({ status: 500 }) === false);
  check('api.isOfflineError: no status means offline', apiModule.isOfflineError(new Error('Network request failed')) === true);

  // Nothing saved: the caller must still get the error.
  storage.clear();
  fetchHandler = null;
  await expectThrow('no cached list -> loadGallery still throws', () => galleryCache.loadGallery());

  // The live list schedules the device copies of its images.
  storage.clear();
  fetchHandler = async () =>
    jsonResponse({ success: true, total: 1, images: [{ filename: 'cached-1.png' }] });
  await galleryCache.loadGallery({ cacheImages: true });
  let cachedAfterLoad = false;
  for (let attempt = 0; attempt < 100 && !cachedAfterLoad; attempt += 1) {
    await wait(10); // the cache run is deliberately fire-and-forget
    cachedAfterLoad = (await imageCache.getCacheStats()).count === 1;
  }
  check('a successful gallery load caches its images on the device', cachedAfterLoad);
}

// --- 3: image cache -------------------------------------------------------
async function checkImageCache() {
  console.log('\nImage cache');
  await imageCache.clearCache();
  downloadLog.length = 0;
  fetchHandler = async () => jsonResponse({});

  await apiModule.setAccessKey('TESTKEY123');
  const uri = await imageCache.ensureCached('wall ones.png');
  check(
    'ensureCached downloads through api.imageUrl (access key included)',
    downloadLog.length === 1 &&
      downloadLog[0].url === api.imageUrl('wall ones.png') &&
      downloadLog[0].url.includes('?key=TESTKEY123'),
    downloadLog.length ? downloadLog[0].url : 'no download recorded'
  );
  check(
    'the cached copy is stored under the server filename',
    typeof uri === 'string' && uri.endsWith('/wallpapers/wall ones.png'),
    String(uri)
  );
  check('getCachedUri finds it by filename', imageCache.getCachedUri('wall ones.png') === uri);
  check('getCachedUri returns null for an unknown file', imageCache.getCachedUri('nope.png') === null);

  downloadLog.length = 0;
  const again = await imageCache.ensureCached('wall ones.png');
  check('a cached image is not downloaded twice', downloadLog.length === 0 && again === uri);

  const stats = await imageCache.getCacheStats();
  check('getCacheStats reports count and bytes', stats.count === 1 && stats.bytes === 2048, JSON.stringify(stats));

  for (const name of ['b.png', 'c.png', 'd.png', 'e.png']) {
    await imageCache.ensureCached(name);
  }
  const pruned = await imageCache.pruneToMax(2);
  const remaining = await imageCache.getCacheStats();
  check(
    'pruneToMax keeps the newest files only',
    pruned.removed === 3 && remaining.count === 2,
    JSON.stringify({ pruned, remaining })
  );
  check('the oldest file was the one deleted', imageCache.getCachedUri('wall ones.png') === null);

  const cleared = await imageCache.clearCache();
  const clearedStats = await imageCache.getCacheStats();
  check(
    'clearCache empties the cache',
    clearedStats.count === 0 && clearedStats.bytes === 0 && cleared.removed === 2,
    JSON.stringify({ cleared, clearedStats })
  );

  await apiModule.setAccessKey('');
}

// --- 4: generation queue --------------------------------------------------
async function checkQueue() {
  console.log('\nGeneration queue');
  await generationQueue.clearQueue();
  storage.clear();
  fetchHandler = null;

  for (let i = 1; i <= 3; i += 1) {
    await generationQueue.enqueue({ prompt: `prompt ${i}`, width: 1080, height: 1920, provider: 'gemini' });
  }
  const queued = await generationQueue.listQueue();
  check('enqueue persists the request fields', queued.length === 3 && queued[0].prompt === 'prompt 1');
  check(
    'entries carry id/createdAt/width/height/provider',
    queued.every((entry) => entry.id && entry.createdAt && entry.width === 1080 && entry.provider === 'gemini')
  );

  // Cap: the oldest entry is dropped and reported.
  let dropped = null;
  for (let i = 4; i <= 11; i += 1) {
    const result = await generationQueue.enqueue({ prompt: `prompt ${i}` });
    dropped = result.dropped;
  }
  const capped = await generationQueue.listQueue();
  check(
    'the queue is capped at 10 and reports the dropped entry',
    capped.length === 10 && !!dropped && dropped.prompt === 'prompt 1' && capped[0].prompt === 'prompt 2',
    JSON.stringify({ length: capped.length, dropped: dropped && dropped.prompt, first: capped[0].prompt })
  );

  // Network failure: stop immediately, keep everything.
  fetchHandler = null;
  const offlineRun = await generationQueue.processQueue({ includeFailed: false });
  check(
    'processQueue stops at the first network failure',
    offlineRun.attempted === 1 && offlineRun.stoppedOffline === true && offlineRun.succeeded.length === 0,
    JSON.stringify(offlineRun)
  );
  check(
    'nothing is lost when the run stops offline',
    offlineRun.remaining === 10 && (await generationQueue.listQueue()).length === 10,
    `remaining=${offlineRun.remaining}`
  );

  // Server error: mark failed, do not retry automatically, keep it for a manual retry.
  await generationQueue.clearQueue();
  storage.clear();
  await generationQueue.enqueue({ prompt: 'rejected prompt' });
  fetchHandler = async () => jsonResponse({ error: { message: 'prompt rejected' } }, 400);
  const failedRun = await generationQueue.processQueue({ includeFailed: true });
  const afterFailure = await generationQueue.listQueue();
  check(
    'a server-side error is recorded as failed, not retried forever',
    failedRun.failed.length === 1 &&
      failedRun.stoppedOffline === false &&
      afterFailure.length === 1 &&
      afterFailure[0].failed === true,
    JSON.stringify({ failedRun, afterFailure })
  );

  const autoRun = await generationQueue.processQueue({ includeFailed: false });
  check(
    'the automatic run skips server-refused entries',
    autoRun.attempted === 0 && autoRun.failed.length === 0,
    JSON.stringify(autoRun)
  );

  const manualRun = await generationQueue.processQueue({ includeFailed: true });
  check(
    'the manual run retries a refused entry',
    manualRun.attempted === 1 && manualRun.failed.length === 1,
    JSON.stringify(manualRun)
  );

  // Success: the entry leaves the queue.
  await generationQueue.clearQueue();
  await generationQueue.enqueue({ prompt: 'good prompt', seed: 7 });
  await generationQueue.enqueue({ prompt: 'second prompt' });
  const bodies = [];
  fetchHandler = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return jsonResponse({ success: true, image: { filename: 'made.png' } }, 201);
  };
  const okRun = await generationQueue.processQueue({ includeFailed: false });
  const afterOk = await generationQueue.listQueue();
  check(
    'successful entries are removed from the queue',
    okRun.succeeded.length === 2 && okRun.succeeded[0].image.filename === 'made.png' && afterOk.length === 0,
    JSON.stringify({ okRun, afterOk })
  );
  check(
    'the stored seed and prompt are replayed to the backend',
    bodies.length === 2 && bodies[0].seed === 7 && bodies[0].prompt === 'good prompt',
    JSON.stringify(bodies)
  );
  check('describeQueueRun phrases the outcome', /Generated 2/.test(generationQueue.describeQueueRun(okRun)), generationQueue.describeQueueRun(okRun));

  await generationQueue.clearQueue();
}

(async () => {
  try {
    await checkGalleryCache();
    await checkImageCache();
    await checkQueue();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
