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
 *   3. Source routing: 'gallery' goes to the random-gallery path, while
 *      'surprise' and 'favorites' both go to the generate path; an empty
 *      favourites list falls back to surprise and says so.
 *   4. Failures never throw: a failed wallpaper set, a thrown native error and
 *      an offline request all resolve to { ok: false, message }.
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

global.fetch = async (url, options) => {
  fetchLog.push(String(url));
  if (!fetchHandler) {
    throw new TypeError('Network request failed');
  }
  return fetchHandler(String(url), options);
};

// --- stub the native modules and the platform wallpaper setter -------------
const deviceState = { fail: false, throw: false };
const deviceMediaMock = {
  saveToDevice: async () => ({ ok: true }),
  setAsWallpaper: async () => {
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
  'react-native': { Platform: { OS: 'android' }, NativeModules: {} },
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

const defaultFetch = async (url) => {
  if (url.includes('/api/gallery')) {
    return jsonResponse({
      success: true,
      total: 2,
      images: [{ filename: 'gallery-one.png' }, { filename: 'gallery-two.png' }],
    });
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
  result = await rotation.runOnLaunch();
  check(
    "source 'surprise' uses the generate path only",
    result.ok === true && countGenerate() === 1 && countGallery() === 0,
    JSON.stringify({ result, gallery: countGallery(), generate: countGenerate() })
  );
  check('the surprise result names the surprise pool', /surprise idea/.test(result.message), result.message);

  // favourites (saved) -> generate
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'favorites' }));
  storage.set('@frogpaper/favorite_prompts', JSON.stringify(['a starred prompt']));
  fetchLog.length = 0;
  result = await rotation.runOnLaunch();
  check(
    "source 'favorites' uses the generate path only",
    result.ok === true && countGenerate() === 1 && countGallery() === 0,
    JSON.stringify({ result, gallery: countGallery(), generate: countGenerate() })
  );
  check('the favourites result names the favourites', /favourites/.test(result.message), result.message);

  // favourites empty -> fall back to surprise, and say so
  storage.set(R, JSON.stringify({ frequency: 'open', source: 'favorites' }));
  storage.delete('@frogpaper/favorite_prompts');
  fetchLog.length = 0;
  result = await rotation.runOnLaunch();
  check(
    'empty favourites still generates (fallback to surprise)',
    result.ok === true && countGenerate() === 1,
    JSON.stringify(result)
  );
  check(
    'the message says it fell back to a surprise idea',
    /no favourite prompts saved/.test(result.message) &&
      /surprise idea was used instead/.test(result.message),
    result.message
  );
}

// --- 4: graceful failures --------------------------------------------------
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

(async () => {
  try {
    await checkMigration();
    await checkFrequency();
    await checkRouting();
    await checkErrors();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
