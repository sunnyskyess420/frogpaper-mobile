#!/usr/bin/env node
/**
 * check-engine.js - headless verification of the saved AI-engine preference.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-engine.js
 * or via the npm script:
 *     npm run check:engine
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build hooks.
 *
 * What it proves (no device, no backend, no network):
 *   1. Persistence: a saved engine id round-trips, saving overwrites, saving a
 *      blank/malformed id clears, clearEnginePreference() removes the key, and
 *      malformed stored values (bad JSON, blanks, non-strings, over-long ids)
 *      or a storage that throws all read as "nothing saved" instead of crashing.
 *   2. Restore: a saved engine that is in the live provider list and usable is
 *      selected (a free engine, or a paid one with its saved key). A paid engine
 *      whose key is gone falls back to the free default with a "needs a saved
 *      key" note. An engine that vanished from the list falls back and says so.
 *      Nothing saved selects the free default with no note (today's behaviour).
 *   3. The free-first default order is unchanged, and the paid/free usability
 *      rule (backend "active", or a saved BYOK key) is exactly the old one.
 *
 * How it loads the app code: same trick as check-offline.js - the service is
 * plain ESM, so this script transpiles it to CommonJS on the fly (babel, no
 * config files) and stubs AsyncStorage with an in-memory double.
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
let failReads = false;
let failWrites = false;
const asyncStorageMock = {
  getItem: async (key) => {
    if (failReads) {
      throw new Error('storage unavailable');
    }
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem: async (key, value) => {
    if (failWrites) {
      throw new Error('storage full');
    }
    storage.set(key, String(value));
  },
  removeItem: async (key) => {
    if (failWrites) {
      throw new Error('storage unavailable');
    }
    storage.delete(key);
  },
  clear: async () => storage.clear(),
};

const mocks = {
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorageMock },
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

const engine = require(path.join(ROOT, 'src/services/enginePreference.js'));
const KEY = engine.ENGINE_PREFERENCE_KEY;

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

async function expectNoThrow(name, fn) {
  try {
    await fn();
    check(name, true);
  } catch (err) {
    check(name, false, `threw: ${err && err.message}`);
  }
}

// The live provider list as the backend reports it: everything but the free
// engine is "inactive" until a BYOK key is saved for it.
function providersFixture(overrides = {}) {
  const base = [
    { id: 'replicate', name: 'Replicate FLUX (paid)', status: 'inactive' },
    { id: 'gemini', name: 'Google Gemini (Nano Banana)', status: 'inactive' },
    { id: 'huggingface', name: 'Hugging Face FLUX', status: 'inactive' },
    { id: 'pollinations', name: 'Pollinations.ai', status: 'active' },
  ];
  return base.map((p) => (overrides[p.id] ? { ...p, ...overrides[p.id] } : p));
}

// --- 1: persistence --------------------------------------------------------
async function checkPersistence() {
  console.log('\nPersistence');

  storage.clear();
  check('nothing saved -> loadEnginePreference() is null', (await engine.loadEnginePreference()) === null);

  await engine.saveEnginePreference('huggingface');
  check(
    'a saved engine id round-trips',
    (await engine.loadEnginePreference()) === 'huggingface',
    String(await engine.loadEnginePreference())
  );
  check('the id is stored under the shared key', storage.get(KEY) === 'huggingface', String(storage.get(KEY)));

  await engine.saveEnginePreference('pollinations');
  check(
    'saving again overwrites the previous choice',
    (await engine.loadEnginePreference()) === 'pollinations' && storage.get(KEY) === 'pollinations',
    String(storage.get(KEY))
  );

  await engine.saveEnginePreference('  gemini  ');
  check(
    'a padded id is stored trimmed',
    (await engine.loadEnginePreference()) === 'gemini' && storage.get(KEY) === 'gemini',
    String(storage.get(KEY))
  );

  await engine.clearEnginePreference();
  check(
    'clearEnginePreference() removes the saved engine',
    (await engine.loadEnginePreference()) === null && !storage.has(KEY)
  );

  // A blank / malformed id must clear instead of storing junk.
  await engine.saveEnginePreference('huggingface');
  await engine.saveEnginePreference('');
  check('saving an empty id clears the saved engine', (await engine.loadEnginePreference()) === null);

  await engine.saveEnginePreference('huggingface');
  await engine.saveEnginePreference(null);
  check('saving null clears the saved engine', (await engine.loadEnginePreference()) === null);

  await engine.saveEnginePreference('huggingface');
  await engine.saveEnginePreference('{not json}');
  check('saving a malformed id clears instead of storing junk', (await engine.loadEnginePreference()) === null);

  // Malformed stored values never throw and always mean "nothing saved".
  const malformed = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['broken JSON', '{not json'],
    ['a JSON object', '{"id":"gemini"}'],
    ['a non-string value', 123],
    ['an over-long value', 'x'.repeat(300)],
  ];
  for (const [label, value] of malformed) {
    storage.clear();
    storage.set(KEY, value);
    let loaded;
    let threw = false;
    try {
      loaded = await engine.loadEnginePreference();
    } catch (err) {
      threw = true;
    }
    check(`malformed stored value (${label}) does not throw and reads as none`, !threw && loaded === null, String(loaded));
  }

  // Storage failures are survivable: the screen must load either way.
  storage.clear();
  failReads = true;
  await expectNoThrow('an unreadable storage does not throw on load', () => engine.loadEnginePreference());
  check('an unreadable storage reads as "nothing saved"', (await engine.loadEnginePreference()) === null);
  failReads = false;

  await engine.saveEnginePreference('huggingface');
  failWrites = true;
  await expectNoThrow('a failed save does not throw', () => engine.saveEnginePreference('gemini'));
  await expectNoThrow('a failed clear does not throw', () => engine.clearEnginePreference());
  failWrites = false;
  check(
    'a failed write leaves the previous saved engine in place',
    (await engine.loadEnginePreference()) === 'huggingface',
    String(await engine.loadEnginePreference())
  );
}

// --- 2: restore / fallback decision ---------------------------------------
async function checkResolve() {
  console.log('\nRestore and fallback');
  const providers = providersFixture();

  // Nothing saved: today's default, and no note.
  let resolved = engine.resolveEnginePreference({ savedId: null, providers, byok: null });
  check(
    'nothing saved -> the free default, no note',
    resolved.providerId === 'pollinations' && resolved.restored === false && resolved.note === null,
    JSON.stringify(resolved)
  );

  // A saved free engine is honoured.
  resolved = engine.resolveEnginePreference({ savedId: 'pollinations', providers, byok: null });
  check(
    'a saved free engine is restored',
    resolved.providerId === 'pollinations' && resolved.restored === true && resolved.note === null,
    JSON.stringify(resolved)
  );

  // A saved paid engine with its key is honoured.
  resolved = engine.resolveEnginePreference({
    savedId: 'huggingface',
    providers,
    byok: { huggingface: 'hf_saved' },
  });
  check(
    'a saved paid engine with a saved key is restored',
    resolved.providerId === 'huggingface' && resolved.restored === true && resolved.note === null,
    JSON.stringify(resolved)
  );

  // A saved paid engine whose key was cleared: fall back and say why.
  resolved = engine.resolveEnginePreference({ savedId: 'huggingface', providers, byok: null });
  check(
    'a saved paid engine without a key falls back to the free default',
    resolved.providerId === 'pollinations' && resolved.restored === false,
    JSON.stringify(resolved)
  );
  check(
    "the fallback carries the 'needs a saved key' reason flag",
    resolved.reason === 'needs-key',
    String(resolved.reason)
  );
  check(
    'the note names the engine and says a key is needed',
    /Hugging Face FLUX needs a saved key/.test(resolved.note || '') &&
      /using Pollinations\.ai instead/.test(resolved.note || ''),
    String(resolved.note)
  );

  // A saved engine that vanished from the list: fall back and say so.
  resolved = engine.resolveEnginePreference({ savedId: 'dalle', providers, byok: null });
  check(
    'a saved engine missing from the provider list falls back to the free default',
    resolved.providerId === 'pollinations' && resolved.restored === false,
    JSON.stringify(resolved)
  );
  check(
    "the missing-engine fallback is flagged 'unavailable', not 'needs-key'",
    resolved.reason === 'unavailable' && !/needs a saved key/.test(resolved.note || '') && !!resolved.note,
    JSON.stringify({ reason: resolved.reason, note: resolved.note })
  );

  // A paid engine the backend itself reports active needs no BYOK key.
  resolved = engine.resolveEnginePreference({
    savedId: 'gemini',
    providers: providersFixture({ gemini: { status: 'active' } }),
    byok: null,
  });
  check(
    'a saved engine the backend reports active is restored without a BYOK key',
    resolved.providerId === 'gemini' && resolved.restored === true,
    JSON.stringify(resolved)
  );

  // The note must name the engine that was actually chosen.
  resolved = engine.resolveEnginePreference({
    savedId: 'huggingface',
    providers: providersFixture({ pollinations: { status: 'inactive' }, gemini: { status: 'active' } }),
    byok: null,
  });
  check(
    'the fallback note names the engine actually selected',
    resolved.providerId === 'gemini' && /using Google Gemini \(Nano Banana\) instead/.test(resolved.note || ''),
    JSON.stringify({ providerId: resolved.providerId, note: resolved.note })
  );

  // Degenerate inputs must not throw.
  resolved = engine.resolveEnginePreference({ savedId: 'huggingface', providers: [], byok: null });
  check(
    'an empty provider list leaves the selection empty and explains the saved engine',
    resolved.providerId === null && resolved.restored === false && !!resolved.note,
    JSON.stringify(resolved)
  );
  await expectNoThrow('resolveEnginePreference() with no arguments does not throw', () =>
    Promise.resolve(engine.resolveEnginePreference())
  );
  resolved = engine.resolveEnginePreference();
  check(
    'resolveEnginePreference() with no arguments selects nothing',
    resolved.providerId === null && resolved.restored === false && resolved.note === null,
    JSON.stringify(resolved)
  );

  const before = JSON.stringify(providers);
  engine.resolveEnginePreference({ savedId: 'huggingface', providers, byok: null });
  check('resolving does not mutate the provider list', JSON.stringify(providers) === before);
}

// --- 3: default order + usability rule (unchanged behaviour) ---------------
async function checkDefaultAndUsability() {
  console.log('\nDefault order and usability rule');

  const freeFirst = engine.pickDefaultProvider(
    providersFixture({ gemini: { status: 'active' } }),
    null
  );
  check(
    'the default is still the free engine, even when a paid one is usable',
    freeFirst && freeFirst.id === 'pollinations',
    String(freeFirst && freeFirst.id)
  );

  const paidOnly = engine.pickDefaultProvider(
    providersFixture({ pollinations: { status: 'inactive' } }),
    { gemini: 'saved' }
  );
  check(
    'with the free engine unusable the default is the next usable engine',
    paidOnly && paidOnly.id === 'gemini',
    String(paidOnly && paidOnly.id)
  );

  check('pickDefaultProvider([]) is null, not a throw', engine.pickDefaultProvider([], null) === null);
  check('pickDefaultProvider(undefined) is null', engine.pickDefaultProvider(undefined, null) === null);

  const paid = { id: 'replicate', name: 'Replicate FLUX (paid)', status: 'inactive' };
  check(
    'usability: backend-active is usable',
    engine.isProviderUsable({ id: 'pollinations', status: 'active' }, null) === true
  );
  check(
    'usability: an inactive engine with a saved BYOK key is usable',
    engine.isProviderUsable(paid, { replicate: 'r8_token' }) === true
  );
  check(
    'usability: an inactive engine without a key is not usable',
    engine.isProviderUsable(paid, null) === false
  );
  check(
    "usability: another engine's key does not make it usable",
    engine.isProviderUsable(paid, { gemini: 'key' }) === false
  );
  check('usability: a missing provider is not usable', engine.isProviderUsable(null, null) === false);
}

// --- 4: end to end ---------------------------------------------------------
async function checkEndToEnd() {
  console.log('\nSave -> load -> restore');
  const providers = providersFixture();

  storage.clear();
  await engine.saveEnginePreference('huggingface');
  let resolved = engine.resolveEnginePreference({
    savedId: await engine.loadEnginePreference(),
    providers,
    byok: { huggingface: 'hf_saved' },
  });
  check(
    'the engine saved on tap comes back on the next screen load',
    resolved.providerId === 'huggingface' && resolved.restored === true,
    JSON.stringify(resolved)
  );

  // Same saved id, but the key was cleared in Settings since: honest fallback.
  resolved = engine.resolveEnginePreference({
    savedId: await engine.loadEnginePreference(),
    providers,
    byok: { gemini: '', huggingface: '', replicate: '' },
  });
  check(
    'a saved engine whose key was cleared since falls back with the note',
    resolved.providerId === 'pollinations' && resolved.reason === 'needs-key' && !!resolved.note,
    JSON.stringify(resolved)
  );

  // The owner taps "Free" instead: the new choice sticks.
  await engine.saveEnginePreference('pollinations');
  resolved = engine.resolveEnginePreference({
    savedId: await engine.loadEnginePreference(),
    providers,
    byok: null,
  });
  check(
    'tapping a new engine replaces the saved one',
    resolved.providerId === 'pollinations' && resolved.restored === true && resolved.note === null,
    JSON.stringify(resolved)
  );
}

(async () => {
  try {
    await checkPersistence();
    await checkResolve();
    await checkDefaultAndUsability();
    await checkEndToEnd();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
