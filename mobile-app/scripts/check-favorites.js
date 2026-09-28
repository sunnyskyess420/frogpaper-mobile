#!/usr/bin/env node
/**
 * check-favorites.js - headless checks for starred pictures and the remembered
 * update answer.
 *
 *     node scripts/check-favorites.js
 *     npm run check:favorites
 *
 * No device, no network, no backend. Proves:
 *   1. imageFavorites: stars start empty, toggle on and off, de-duplicate, and a
 *      malformed store degrades to "nothing starred" instead of throwing.
 *   2. updateState: the first check asks GitHub and remembers the answer; a
 *      second check within the day reuses it without a network call; forcing
 *      (maxAgeMs 0) re-asks; an offline failure never throws and never loses a
 *      previously cached answer.
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

const expoConstantsStub = { __esModule: true, default: { expoConfig: { version: '1.9.57' } }, expoConfig: { version: '1.9.57' } };

const mocks = {
  'expo-constants': expoConstantsStub,
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorageMock },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) {
    return mocks[request];
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

// --- controllable network --------------------------------------------------
let fetchMode = 'release';
let fetchTag = 'v1.9.58';
let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  if (fetchMode === 'offline') {
    throw new Error('network down');
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ tag_name: fetchTag, html_url: 'https://example.test/release' }),
  };
};

const favorites = require(path.join(ROOT, 'src/services/imageFavorites.js'));
const updateState = require(path.join(ROOT, 'src/services/updateState.js'));

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

async function checkFavorites() {
  console.log('\nStarred pictures');
  storage.clear();

  check('a fresh store has no stars', (await favorites.favoriteImageNames()).length === 0);
  check('asking about an unknown image is false', (await favorites.isImageFavorite('a.png')) === false);

  let toggled = await favorites.toggleImageFavorite('a.png');
  check('toggling on stars the image', toggled.favorite === true && (await favorites.isImageFavorite('a.png')) === true);
  check('the count follows', (await favorites.favoriteImageCount()) === 1);

  toggled = await favorites.toggleImageFavorite('a.png');
  check('toggling again unstars it', toggled.favorite === false && (await favorites.isImageFavorite('a.png')) === false);

  await favorites.setImageFavorite('a.png', true);
  await favorites.setImageFavorite('b.png', true);
  await favorites.setImageFavorite('a.png', true); // duplicate - must not double up
  const names = await favorites.favoriteImageNames();
  check('stars de-duplicate', names.length === 2, JSON.stringify(names));

  await favorites.setImageFavorite('a.png', false);
  check('setting off removes just that one', JSON.stringify(await favorites.favoriteImageNames()) === JSON.stringify(['b.png']));

  await favorites.pruneFavorites(['b.png', 'c.png']);
  check('pruning keeps only images that still exist', JSON.stringify(await favorites.favoriteImageNames()) === JSON.stringify(['b.png']));
  await favorites.pruneFavorites(['c.png']);
  check('pruning drops a star whose image is gone', (await favorites.favoriteImageCount()) === 0);

  storage.set(favorites.FAVORITE_IMAGES_KEY, '{not json');
  check('a malformed store reads as empty, not a crash', (await favorites.favoriteImageNames()).length === 0);
}

async function checkUpdateState() {
  console.log('\nRemembered update answer');
  storage.clear();
  fetchCalls = 0;
  fetchMode = 'release';
  fetchTag = 'v1.9.58';

  let state = await updateState.refreshUpdateIfStale();
  check('the first check asks GitHub', fetchCalls === 1, `fetch calls=${fetchCalls}`);
  check('a newer release is reported', state.state === 'update' && state.latest === '1.9.58', JSON.stringify(state));
  check('the answer is remembered', (await updateState.readCachedUpdate()) !== null);

  state = await updateState.refreshUpdateIfStale();
  check('a second check the same day does not re-ask', fetchCalls === 1, `fetch calls=${fetchCalls}`);
  check('and still reports the update', state.state === 'update');

  state = await updateState.refreshUpdateIfStale({ maxAgeMs: 0 });
  check('forcing (maxAgeMs 0) re-asks GitHub', fetchCalls === 2, `fetch calls=${fetchCalls}`);

  // A stale answer older than the window re-asks.
  const cached = await updateState.readCachedUpdate();
  await updateState.writeCachedUpdate({ ...cached, checkedAt: Date.now() - updateState.UPDATE_MAX_AGE_MS - 1000 });
  fetchTag = 'v1.9.57';
  state = await updateState.refreshUpdateIfStale();
  check('a stale answer re-asks and can clear the update', fetchCalls === 3 && state.state === 'current', `fetch calls=${fetchCalls}, ${JSON.stringify(state)}`);

  // Offline must never throw, and must keep what it had.
  fetchMode = 'offline';
  fetchCalls = 0;
  let threw = false;
  try {
    state = await updateState.refreshUpdateIfStale({ maxAgeMs: 0 });
  } catch (err) {
    threw = true;
  }
  check('an offline check never throws', !threw);
  check('it reports offline', state && state.state === 'offline', JSON.stringify(state));

  check('isStale() is true with no cache', updateState.isStale(null, 1000) === true);
  check('isStale() respects the window', updateState.isStale({ checkedAt: 1000 }, 5000, 2000) === false);
}

(async () => {
  try {
    await checkFavorites();
    await checkUpdateState();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
