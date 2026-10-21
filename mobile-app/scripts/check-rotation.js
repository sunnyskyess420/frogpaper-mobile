#!/usr/bin/env node
/**
 * check-rotation.js - headless verification of the merged wallpaper rotation.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-rotation.js
 * or via the npm script:
 *     npm run check:rotation
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build hooks.
 *
 * What it proves (no device, no backend, no network):
 *   1. migrateLegacySettings()/loadRotation() derive the merged preference from
 *      the old daily/shuffle keys (daily beats shuffle when both were on), are
 *      idempotent, and survive missing or malformed legacy values.
 *   2. The frequency gate: 'off' never acts, 'open' acts on every launch,
 *      'daily' acts once per calendar day and again the next day, and
 *      changeNow() acts regardless of the frequency.
 *   3. Source routing: 'gallery' and 'favorites' both set an existing image
 *      (favourites draws from the starred pool, falling back to the whole
 *      gallery when nothing is starred); only 'surprise' generates.
 *   4. Failures never throw: a failed wallpaper set, a thrown native error and
 *      an offline request all resolve to { ok: false, message }.
 *   5. Engine choice: an automatic surprise run sends the engine saved on the
 *      Generate screen, skips the run (never falling back to Pollinations) when
 *      that engine is gone, and rejects a backend fallback image instead of
 *      setting it. With nothing saved the request carries no provider at all.
 *   6. Retry time and last-change record: a failed run returns retryAt
 *      (lastFail + FAIL_COOLDOWN_MS), the cooldown result carries the same
 *      retryAt, every attempted outcome is persisted to
 *      @frogpaper/rotation_last_change with the engine that was sent to
 *      /api/generate, and a malformed record reads back as null.
 *
 * How it loads the app code: the app modules are plain ESM, so this script
 * transpiles them to CommonJS on the fly (babel, no config files) and stubs the
 * native modules they import (react-native, expo-constants, expo-file-system,
 * the media library, AsyncStorage and the platform wallpaper setter) with
 * in-memory doubles. global.fetch is replaced with a routed fake so the routing
 * assertions can see /api/gallery vs /api/generate. Date is replaced with a
 * controllable clock so "once a day" can be tested across day boundaries.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

// --- in-memory AsyncStorage ------------------------------------------------
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

// --- injectable clock ------------------------------------------------------
// Replacing Date lets a test cross a midnight boundary; node's timers do not
// use the JS Date object, so nothing else is affected.
const RealDate = Date;
let clock = new RealDate('2026-09-13T09:00:00').getTime();
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(clock);
    } else {
      super(...args);
    }
  }
  static now() {
    return clock;
  }
}
global.Date = FakeDate;

// Bodies of the /api/generate requests, in order, so a test can prove which
// engine the automatic run actually asked the backend to use.
const generateBodies = [];

global.fetch = async (url, options) => {
  fetchLog.push(String(url));
  if (String(url).includes('/api/generate') && options && typeof options.body === 'string') {
    try {
      generateBodies.push(JSON.parse(options.body));
    } catch (err) {
      generateBodies.push(null);
    }
  }
  if (!fetchHandler) {
    throw new TypeError('Network request failed');
  }
  return fetchHandler(String(url), options);
};

// --- stub the native modules and the platform wallpaper setter -------------
const deviceState = { fail: false, throw: false, setCalls: 0 };
const deviceMediaMock = {
  saveToDevice: async () => ({ ok: true }),
  setAsWallpaper: async () => {
    deviceState.setCalls += 1;
    if (deviceState.throw) {
      throw new Error('wallpaper manager exploded');
    }
    if (deviceState.fail) {
      return { ok: false, message: 'Wallpaper manager unavailable.' };
    }
    return { ok: true };
  },
};

const mocks = {
  'react-native': {
    Platform: {
      OS: 'android',
      select: (options) => (options && (options.android || options.default)) || null,
    },
    NativeModules: {},
  },
  // src/services/api.js pulls in the BYOK key store since P0-4.2. Rotation does
  // not care where keys live, but the real module is ESM with extensionless
  // imports and cannot be required under Node, so stub it out.
  'expo-secure-store': {
    __esModule: true,
    async getItemAsync() {
      return null;
    },
    async setItemAsync() {},
    async deleteItemAsync() {},
  },
  'expo-constants': { __esModule: true, default: { expoConfig: null }, expoConfig: null },
  'expo-file-system': { __esModule: true, File: class {}, Paths: { cache: {} } },
  'expo-file-system/legacy': { __esModule: true, StorageAccessFramework: {} },
  'expo-media-library/legacy': { __esModule: true },
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorageMock },
  './deviceMedia': { __esModule: true, ...deviceMediaMock },
};

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

// --- routed fake network ---------------------------------------------------
const fetchLog = [];
let fetchHandler = null;

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

// The live provider list as the backend reports it. Everything but the free
// engine is inactive until a key is saved for it, so a test that wants a saved
// paid engine to be usable has to mark it active here.
let providersPayload = [
  { id: 'pollinations', name: 'Pollinations', status: 'active' },
  { id: 'gemini', name: 'Gemini', status: 'inactive' },
  { id: 'huggingface', name: 'Hugging Face', status: 'inactive' },
  { id: 'replicate', name: 'Replicate', status: 'inactive' },
];

const defaultFetch = async (url) => {
  if (url.includes('/api/gallery')) {
    return jsonResponse({
      success: true,
      total: 2,
      images: [{ filename: 'gallery-one.png' }, { filename: 'gallery-two.png' }],
    });
  }
  if (url.includes('/api/providers')) {
    return jsonResponse({ success: true, active: 'pollinations', providers: providersPayload });
  }
  if (url.includes('/api/generate')) {
    return jsonResponse({ success: true, image: { filename: 'generated-one.png' } }, 201);
  }
  if (url.includes('/api/health')) {
    return jsonResponse({ status: 'ok', version: '1.0', images_count: 2 });
  }
  return jsonResponse({});
};
fetchHandler = defaultFetch;

const rotation = require(path.join(ROOT, 'src/services/wallpaperRotation.js'));
const daily = require(path.join(ROOT, 'src/services/dailyWallpaper.js'));
const enginePreference = require(path.join(ROOT, 'src/services/enginePreference.js'));
const rotationHistory = require(path.join(ROOT, 'src/services/rotationHistory.js'));

const countGallery = () => fetchLog.filter((url) => url.includes('/api/gallery')).length;
const countGenerate = () => fetchLog.filter((url) => url.includes('/api/generate')).length;

// --- assertion helpers -----------------------------------------------------
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

// --- 1: migration ----------------------------------------------------------
async function checkMigration() {
  console.log('\nMigration from the legacy keys');
  const R = rotation.ROTATION_KEY;
  const persisted = () => {
    const raw = storage.get(R);
    return raw ? JSON.parse(raw) : null;
  };

  // (a) daily on, default source -> surprise
  storage.clear();
  storage.set(rotation.LEGACY_DAILY_ENABLED_KEY, '1');
  let merged = await rotation.loadRotation();
  check(
    'legacy daily on -> { daily, surprise }',
    merged.frequency === 'daily' && merged.source === 'surprise',
    JSON.stringify(merged)
  );
  check(
    'the derived choice is persisted under the new key',
    JSON.stringify(persisted()) === JSON.stringify(merged),
    storage.get(R)
  );

  // (b) daily on + favourites
  storage.clear();
  storage.set(rotation.LEGACY_DAILY_ENABLED_KEY, '1');
  storage.set(rotation.LEGACY_DAILY_SOURCE_KEY, 'favorites');
  merged = await rotation.loadRotation();
  check(
    'legacy daily on + favourites -> { daily, favorites }',
    merged.frequency === 'daily' && merged.source === 'favorites',
    JSON.stringify(merged)
  );

  // (c) shuffle on only
  storage.clear();
  storage.set(rotation.LEGACY_SHUFFLE_KEY, '1');
  merged = await rotation.loadRotation();
  check(
    'legacy shuffle-on-open only -> { open, gallery }',
    merged.frequency === 'open' && merged.source === 'gallery',
    JSON.stringify(merged)
  );

  // (d) both off
  storage.clear();
  merged = await rotation.loadRotation();
  check(
    'no legacy flags -> { off, surprise }',
    merged.frequency === 'off' && merged.source === 'surprise',
    JSON.stringify(merged)
  );

  // (e) both on -> daily wins
  storage.clear();
  storage.set(rotation.LEGACY_DAILY_ENABLED_KEY, '1');
  storage.set(rotation.LEGACY_SHUFFLE_KEY, '1');
  merged = await rotation.loadRotation();
  check(
    'both legacy features on -> daily wins',
    merged.frequency === 'daily' && merged.source === 'surprise',
    JSON.stringify(merged)
  );

  // idempotency: never overwrite a choice made after the merge
  storage.clear();
  storage.set(rotation.LEGACY_DAILY_ENABLED_KEY, '1');
  storage.set(R, JSON.stringify({ frequency: 'off', source: 'gallery' }));
  merged = await rotation.loadRotation();
  check(
    'an existing merged choice is never overwritten by migration',
    merged.frequency === 'off' && merged.source === 'gallery',
    JSON.stringify(merged)
  );
  const direct = await rotation.migrateLegacySettings();
  check(
    'migrateLegacySettings() is idempotent when called directly',
    direct.frequency === 'off' && direct.source === 'gallery',
    JSON.stringify(direct)
  );
  check(
    'the legacy keys are left untouched (read-only migration)',
    storage.get(rotation.LEGACY_DAILY_ENABLED_KEY) === '1'
  );

  // malformed / missing values must not crash
  storage.clear();
  storage.set(R, '{not json');
  storage.set(rotation.LEGACY_DAILY_ENABLED_KEY, '1');
  storage.set(rotation.LEGACY_DAILY_SOURCE_KEY, 'nonsense');
  merged = await rotation.loadRotation();
  check(
    'malformed stored value re-runs migration; unknown legacy source -> surprise',
    merged.frequency === 'daily' && merged.source === 'surprise',
    JSON.stringify(merged)
  );

  storage.clear();
  storage.set(rotation.LEGACY_DAILY_ENABLED_KEY, 'garbage');
  merged = await rotation.loadRotation();
  check(
    'a malformed legacy flag does not crash and means off',
    merged.frequency === 'off' && merged.source === 'surprise',
    JSON.stringify(merged)
  );

  // setters round-trip and clamp unknown values
  storage.clear();
  await rotation.setFrequency('open');
  await rotation.setSource('gallery');
  merged = await rotation.loadRotation();
  check(
    'setFrequency/setSource persist a merged record',
    merged.frequency === 'open' && merged.source === 'gallery',
    JSON.stringify(merged)
  );
  const badFrequency = await rotation.setFrequency('sometimes');
  check('an unknown frequency is ignored', badFrequency.frequency === 'open', JSON.stringify(badFrequency));
  const badSource = await rotation.setSource('nope');
  check('an unknown source is ignored', badSource.source === 'gallery', JSON.stringify(badSource));
}

// --- 2: frequency gate -----------------------------------------------------
async function checkFrequency() {
  console.log('\nFrequency');
  const R = rotation.ROTATION_KEY;

  // off never acts, but the manual button still works
  storage.clear();
  deviceState.fail = false;
  deviceState.throw = false;
  fetchLog.length = 0;
  storage.set(R, JSON.stringify({ frequency: 'off', source: 'gallery' }));
  let result = await rotation.runOnLaunch();
  check(
    "'off' never acts automatically",
    result.acted === false && result.ok === true && result.reason === 'off',
    JSON.stringify(result)
  );
  check("'off' makes no network call", fetchLog.length === 0, fetchLog.join(','));
  const manual = await rotation.changeNow();
  check(
    'changeNow() acts regardless of the frequency',
    manual.ok === true && countGallery() === 1,
    JSON.stringify({ manual, galleryCalls: countGallery() })
  );

  // open acts on every launch
  storage.clear();
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'gallery' }));
  fetchLog.length = 0;
  const open1 = await rotation.runOnLaunch();
  const open2 = await rotation.runOnLaunch();
  check(
    "'open' acts on every launch",
    open1.acted === true && open2.acted === true,
    JSON.stringify({ open1, open2 })
  );
  check("'open' changed the wallpaper twice in two launches", countGallery() === 2, `gallery calls=${countGallery()}`);

  // daily: once per calendar day, again the next day
  storage.clear();
  storage.set(R, JSON.stringify({ frequency: 'daily', source: 'gallery' }));
  fetchLog.length = 0;
  clock = new RealDate('2026-09-13T09:00:00').getTime();
  const day1 = await rotation.runOnLaunch();
  const day1Again = await rotation.runOnLaunch();
  check(
    "'daily' acts on the first launch of the day",
    day1.acted === true && day1.ok === true,
    JSON.stringify(day1)
  );
  check(
    "'daily' does nothing on later launches the same day",
    day1Again.acted === false && day1Again.reason === 'already-run',
    JSON.stringify(day1Again)
  );
  check("'daily' ran exactly once that day", countGallery() === 1, `gallery calls=${countGallery()}`);
  clock = new RealDate('2026-09-14T08:30:00').getTime();
  const day2 = await rotation.runOnLaunch();
  check(
    "'daily' acts again the next day",
    day2.acted === true && day2.ok === true,
    JSON.stringify(day2)
  );
  check("'daily' ran twice across two days", countGallery() === 2, `gallery calls=${countGallery()}`);
}

// --- 3: source routing -----------------------------------------------------
async function checkRouting() {
  console.log('\nSource routing');
  const R = rotation.ROTATION_KEY;
  storage.clear();
  deviceState.fail = false;
  deviceState.throw = false;
  fetchHandler = defaultFetch;

  // gallery -> random existing image
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'gallery' }));
  fetchLog.length = 0;
  let result = await rotation.runOnLaunch();
  check(
    "source 'gallery' uses the random-gallery path only",
    result.ok === true && countGallery() === 1 && countGenerate() === 0,
    JSON.stringify({ result, gallery: countGallery(), generate: countGenerate() })
  );

  // surprise -> generate
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'surprise' }));
  fetchLog.length = 0;
  generateBodies.length = 0;
  result = await rotation.runOnLaunch();
  check(
    "source 'surprise' uses the generate path only",
    result.ok === true && countGenerate() === 1 && countGallery() === 0,
    JSON.stringify({ result, gallery: countGallery(), generate: countGenerate() })
  );
  check(
    'with no saved engine the request carries no provider (backend default)',
    generateBodies.length === 1 && !('provider' in generateBodies[0]),
    JSON.stringify(generateBodies)
  );
  check('the surprise result names the surprise pool', /surprise idea/.test(result.message), result.message);

  // favourites -> random starred image (gallery path, never generates)
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'favorites' }));
  storage.set('@frogpaper/favorite_images', JSON.stringify(['gallery-one.png']));
  fetchLog.length = 0;
  result = await rotation.runOnLaunch();
  check(
    "source 'favorites' uses the gallery path only",
    result.ok === true && countGallery() === 1 && countGenerate() === 0,
    JSON.stringify({ result, gallery: countGallery(), generate: countGenerate() })
  );
  check('the favourites result names the favourites', /favourites/.test(result.message), result.message);

  // favourites empty -> still sets one (falls back to the whole gallery), and says so
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'favorites' }));
  storage.delete('@frogpaper/favorite_images');
  fetchLog.length = 0;
  result = await rotation.runOnLaunch();
  check(
    'no starring yet still sets a gallery wallpaper',
    result.ok === true && countGallery() === 1 && countGenerate() === 0,
    JSON.stringify(result)
  );
  check(
    'the message says it fell back to the gallery',
    /No starred wallpapers yet/.test(result.message),
    result.message
  );
}

// --- 4: saved engine -------------------------------------------------------
async function checkSavedEngine() {
  console.log('\nSaved engine');
  const R = rotation.ROTATION_KEY;
  const LASTFAIL = '@frogpaper/daily_lastfail';

  // (a) a saved, usable engine is the one the automatic run asks for
  storage.clear();
  await enginePreference.saveEnginePreference('huggingface');
  providersPayload = providersPayload.map((p) =>
    p.id === 'huggingface' ? { ...p, status: 'active' } : p
  );
  fetchHandler = defaultFetch;
  deviceState.fail = false;
  deviceState.throw = false;
  deviceState.setCalls = 0;
  fetchLog.length = 0;
  generateBodies.length = 0;
  clock = new RealDate('2026-09-20T09:00:00').getTime();
  storage.set(R, JSON.stringify({ frequency: 'daily', source: 'surprise' }));
  const auto = await rotation.runOnLaunch();
  check(
    'an automatic surprise run asks for the saved engine',
    auto.ok === true &&
      generateBodies.length === 1 &&
      generateBodies[0].provider === 'huggingface',
    JSON.stringify({ auto, bodies: generateBodies })
  );
  check(
    'the automatic run checks the live provider list before generating',
    fetchLog.some((url) => url.includes('/api/providers')),
    fetchLog.join(',')
  );
  check(
    'the automatic run still sets the wallpaper',
    deviceState.setCalls === 1,
    `set calls=${deviceState.setCalls}`
  );

  // (b) the backend quietly falling back to Pollinations is a failure here
  clock = new RealDate('2026-09-21T09:00:00').getTime();
  fetchHandler = async (url) => {
    if (url.includes('/api/providers')) {
      return jsonResponse({ success: true, providers: providersPayload });
    }
    if (url.includes('/api/generate')) {
      return jsonResponse(
        { success: true, image: { filename: 'x.png', provider_fallback_from: 'huggingface' } },
        201
      );
    }
    return defaultFetch(url);
  };
  fetchLog.length = 0;
  generateBodies.length = 0;
  deviceState.setCalls = 0;
  const fellBack = await daily.runDailyWallpaper({ force: true, source: 'surprise' });
  check(
    'a silent free fallback is reported as an error',
    fellBack.kind === 'error' && /free fallback was skipped/.test(fellBack.message || ''),
    JSON.stringify(fellBack)
  );
  check(
    'a silent free fallback is never set as the wallpaper',
    deviceState.setCalls === 0,
    `set calls=${deviceState.setCalls}`
  );
  check(
    'the failed run starts the 2-hour cooldown',
    (storage.get(LASTFAIL) || '').length > 0,
    storage.get(LASTFAIL)
  );
  storage.set(R, JSON.stringify({ frequency: 'daily', source: 'surprise' }));
  const cooling = await rotation.runOnLaunch();
  check(
    'the automatic run then waits out the cooldown instead of regenerating',
    cooling.acted === false && cooling.reason === 'cooldown',
    JSON.stringify(cooling)
  );

  // (c) a saved engine the backend no longer offers blocks the run entirely
  storage.clear();
  await enginePreference.saveEnginePreference('dalle');
  fetchHandler = defaultFetch;
  fetchLog.length = 0;
  generateBodies.length = 0;
  deviceState.setCalls = 0;
  clock = new RealDate('2026-09-22T09:00:00').getTime();
  const blocked = await daily.runDailyWallpaper({ force: true, source: 'surprise' });
  check(
    'a saved engine the backend does not offer blocks the run',
    blocked.kind === 'error' && /saved engine is not available/i.test(blocked.message || ''),
    JSON.stringify(blocked)
  );
  check(
    'a blocked engine makes no generate request',
    countGenerate() === 0,
    fetchLog.join(',')
  );
  check(
    'a blocked engine leaves the current wallpaper alone',
    deviceState.setCalls === 0,
    `set calls=${deviceState.setCalls}`
  );
}

// --- 5: graceful failures --------------------------------------------------
async function checkErrors() {
  console.log('\nGraceful failures');
  const R = rotation.ROTATION_KEY;
  storage.clear();
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'gallery' }));
  fetchLog.length = 0;

  // the platform refuses to set the wallpaper
  deviceState.throw = false;
  deviceState.fail = true;
  let result = await rotation.runOnLaunch();
  check(
    'a refused wallpaper set returns { ok:false } instead of throwing',
    result.ok === false && result.acted === true && !!result.message,
    JSON.stringify(result)
  );
  const refusedManual = await rotation.changeNow();
  check(
    'changeNow() reports a refused set the same way',
    refusedManual.ok === false && !!refusedManual.message,
    JSON.stringify(refusedManual)
  );

  // the native call throws
  deviceState.fail = false;
  deviceState.throw = true;
  fetchLog.length = 0;
  result = await rotation.runOnLaunch();
  check(
    'a thrown native error is caught and reported',
    result.ok === false && result.acted === true && !!result.message,
    JSON.stringify(result)
  );

  // offline
  deviceState.throw = false;
  fetchHandler = null;
  fetchLog.length = 0;
  result = await rotation.runOnLaunch();
  check(
    'an offline failure is caught and reported',
    result.ok === false && result.acted === true && !!result.message,
    JSON.stringify(result)
  );
  const offlineManual = await rotation.changeNow();
  check(
    'changeNow() never throws while offline',
    offlineManual.ok === false && !!offlineManual.message,
    JSON.stringify(offlineManual)
  );

  // a failed daily run backs off instead of hammering the provider
  storage.clear();
  storage.set(R, JSON.stringify({ frequency: 'daily', source: 'gallery' }));
  fetchHandler = defaultFetch;
  deviceState.fail = true;
  clock = new RealDate('2026-09-15T07:00:00').getTime();
  const failed = await rotation.runOnLaunch();
  const backedOff = await rotation.runOnLaunch();
  check(
    "a failed 'daily' run reports the failure",
    failed.ok === false && failed.acted === true,
    JSON.stringify(failed)
  );
  check(
    "a failed 'daily' run backs off instead of retrying at once",
    backedOff.acted === false && backedOff.reason === 'cooldown',
    JSON.stringify(backedOff)
  );

  deviceState.fail = false;
}

// --- 6: retryAt and the last-change record --------------------------------
// The old cooldown card said "FrogPaper will try again next time you open
// the app", which was wrong (the real rule is a 2-hour cooldown) and was the
// only trace of a failed 7 a.m. run. Now runOnLaunch returns retryAt, and
// every attempted outcome is persisted so Settings can show it after the
// Home card disappears.
async function checkRetryAndHistory() {
  console.log('\nRetry time and last-change record');
  const R = rotation.ROTATION_KEY;
  const LASTFAIL = '@frogpaper/daily_lastfail';
  const LC = rotationHistory.LAST_CHANGE_KEY;
  const lastChange = async () => {
    const raw = storage.get(LC);
    return raw ? JSON.parse(raw) : null;
  };

  // (a) the cooldown result carries retryAt = lastFail + FAIL_COOLDOWN_MS
  storage.clear();
  deviceState.fail = true;
  fetchHandler = defaultFetch;
  clock = new RealDate('2026-09-15T07:00:00').getTime();
  storage.set(R, JSON.stringify({ frequency: 'daily', source: 'gallery' }));
  const firstFailure = await rotation.runOnLaunch();
  check(
    'a failed run returns retryAt roughly 2 hours ahead (fake clock)',
    typeof firstFailure.retryAt === 'number' &&
      firstFailure.retryAt - clock === daily.FAIL_COOLDOWN_MS,
    JSON.stringify({ retryAt: firstFailure.retryAt, clock })
  );

  // The lastFail the cooldown branch sees was just written by the failed
  // run above, so the cooldown result's retryAt must equal that stored
  // lastFail + FAIL_COOLDOWN_MS.
  const storedLastFail = parseInt(storage.get(LASTFAIL) || '0', 10);
  const cooling = await rotation.runOnLaunch();
  check(
    'the cooldown result carries retryAt equal to lastFail + FAIL_COOLDOWN_MS',
    cooling.acted === false &&
      cooling.reason === 'cooldown' &&
      typeof cooling.retryAt === 'number' &&
      cooling.retryAt === storedLastFail + daily.FAIL_COOLDOWN_MS,
    JSON.stringify({ cooling, storedLastFail })
  );

  // (b) a successful surprise run writes a record with ok:true and the engine
  // that was actually sent to /api/generate.
  storage.clear();
  deviceState.fail = false;
  deviceState.throw = false;
  fetchHandler = defaultFetch;
  providersPayload = providersPayload.map((p) =>
    p.id === 'huggingface' ? { ...p, status: 'active' } : { ...p, status: 'inactive' }
  );
  await enginePreference.saveEnginePreference('huggingface');
  clock = new RealDate('2026-09-16T07:00:00').getTime();
  fetchLog.length = 0;
  generateBodies.length = 0;
  storage.set(R, JSON.stringify({ frequency: 'daily', source: 'surprise' }));
  const success = await rotation.runOnLaunch();
  check(
    'a successful surprise run reports ok:true',
    success.ok === true && success.acted === true,
    JSON.stringify(success)
  );
  check(
    'the request carried the saved engine id',
    generateBodies.length === 1 && generateBodies[0].provider === 'huggingface',
    JSON.stringify(generateBodies)
  );
  const okRecord = await lastChange();
  check(
    'a successful run writes a last-change record with ok:true',
    !!okRecord && okRecord.ok === true && okRecord.source === 'surprise',
    JSON.stringify(okRecord)
  );
  check(
    "the success record's engine matches the engine that was sent to /api/generate",
    !!okRecord && okRecord.engine === 'huggingface',
    JSON.stringify(okRecord)
  );
  check(
    'the success record carries the at timestamp as a number',
    !!okRecord && typeof okRecord.at === 'number' && okRecord.at === clock,
    JSON.stringify(okRecord)
  );

  // (c) a failed run writes ok:false and keeps the last failure message.
  storage.clear();
  deviceState.fail = true;
  fetchHandler = defaultFetch;
  clock = new RealDate('2026-09-17T07:00:00').getTime();
  storage.set(R, JSON.stringify({ frequency: 'daily', source: 'gallery' }));
  const failRun = await rotation.runOnLaunch();
  const errRecord = await lastChange();
  check(
    'a failed run writes a last-change record with ok:false',
    !!errRecord && errRecord.ok === false && errRecord.source === 'gallery',
    JSON.stringify(errRecord)
  );
  check(
    'the failure record keeps the run message',
    !!errRecord && typeof errRecord.message === 'string' && errRecord.message === failRun.message,
    JSON.stringify({ errRecord, failRun })
  );
  check(
    'the failure record has engine:null (no generation happened)',
    !!errRecord && errRecord.engine === null,
    JSON.stringify(errRecord)
  );

  // (d) source 'gallery' / 'favorites' records carry no engine.
  storage.clear();
  deviceState.fail = false;
  fetchHandler = defaultFetch;
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'favorites' }));
  storage.set('@frogpaper/favorite_images', JSON.stringify(['gallery-one.png']));
  const favRun = await rotation.runOnLaunch();
  const favRecord = await lastChange();
  check(
    "a favourites run records ok:true and source:'favorites'",
    favRun.ok === true && !!favRecord && favRecord.ok === true && favRecord.source === 'favorites',
    JSON.stringify({ favRun, favRecord })
  );
  check(
    'a favourites record carries no engine',
    !!favRecord && favRecord.engine === null,
    JSON.stringify(favRecord)
  );

  // (e) a malformed persisted record reads back as null, never crashes.
  storage.set(LC, '{not json');
  const malformed = await rotationHistory.readLastChange();
  check(
    'a malformed last-change record reads back as null',
    malformed === null,
    JSON.stringify(malformed)
  );

  // (f) writeLastChange never throws, even when AsyncStorage is fine.
  storage.delete(LC);
  await rotationHistory.writeLastChange({
    at: clock,
    ok: true,
    source: 'surprise',
    engine: 'pollinations',
    message: 'ok',
  });
  const written = await lastChange();
  check(
    'writeLastChange persists a valid record',
    !!written && written.engine === 'pollinations' && written.ok === true,
    JSON.stringify(written)
  );

  // (g) an invalid record shape is silently dropped (no write, no throw).
  storage.delete(LC);
  await rotationHistory.writeLastChange({ at: 'no', ok: 'maybe', source: 'weird' });
  const dropped = await lastChange();
  check(
    'writeLastChange drops an invalid record instead of persisting garbage',
    dropped === null,
    JSON.stringify(dropped)
  );

  deviceState.fail = false;
}

(async () => {
  try {
    await checkMigration();
    await checkFrequency();
    await checkRouting();
    await checkSavedEngine();
    await checkErrors();
    await checkRetryAndHistory();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
