#!/usr/bin/env node
/**
 * check-errorlog.js - headless verification of the built-in error log.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-errorlog.js
 * or via the npm script:
 *     npm run check:errorlog
 *
 * Proves, with no device and no network:
 *   1. entries are recorded newest-first with context and timestamp
 *   2. expected noise (offline / aborted / cancelled) is skipped
 *   3. the buffer keeps only the last 20 entries
 *   4. long messages and stacks are truncated to their caps
 *   5. clearing empties and persists
 *   6. corrupt stored data resets instead of throwing
 *   7. a logger that cannot write never propagates an error
 *
 * Loads the ESM service the same way the other check scripts do: transpiled to
 * CommonJS with babel, with AsyncStorage stubbed by an in-memory double.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

// --- in-memory AsyncStorage ------------------------------------------------
const store = new Map();
let failWrites = false;

const asyncStorageStub = {
  __esModule: true,
  default: {
    async getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async setItem(key, value) {
      if (failWrites) {
        throw new Error('storage full');
      }
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return asyncStorageStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

// --- transpile the app's ESM on the fly ------------------------------------
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

const errorLogPath = path.join(ROOT, 'src/services/errorLog.js');
const log = require(errorLogPath);
const KEY = '@frogpaper/errorLog';

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
  console.log('error log');

  // 1. basics
  await log.clearErrors();
  await log.recordError(new Error('first failure'), 'generate');
  await log.recordError(new Error('second failure'), 'upload image');
  const two = await log.listErrors();
  check('records entries', two.length === 2, `got ${two.length}`);
  check('newest first', two[0].message === 'second failure', two[0].message);
  check('keeps the context', two[0].context === 'upload image', two[0].context);
  check('timestamps are ISO', !Number.isNaN(Date.parse(two[0].at)), two[0].at);
  check('count matches', (await log.errorCount()) === 2);

  // 2. noise
  await log.clearErrors();
  await log.recordError(new Error('Network request failed'), 'generate');
  await log.recordError(new Error('Request timed out'), 'generate');
  await log.recordError(new Error('The operation was aborted'), 'generate');
  const aborted = new Error('cancelled');
  aborted.name = 'AbortError';
  await log.recordError(aborted, 'generate');
  check('offline / timeout / abort noise skipped', (await log.errorCount()) === 0, `${await log.errorCount()} stored`);
  await log.recordError(new Error('a real problem'), 'save to device');
  check('real errors still recorded', (await log.errorCount()) === 1);

  // 3. the cap
  await log.clearErrors();
  for (let i = 0; i < 35; i += 1) {
    await log.recordError(new Error(`failure ${i}`), 'cap');
  }
  const capped = await log.listErrors();
  check('keeps at most 20', capped.length === log.MAX_ENTRIES, `got ${capped.length}`);
  check('newest survives the cap', capped[0].message === 'failure 34', capped[0].message);
  check('oldest are dropped', capped[capped.length - 1].message === 'failure 15', capped[capped.length - 1].message);

  // 4. truncation
  await log.clearErrors();
  await log.recordError(new Error('m'.repeat(2000)), 'long message');
  const long = (await log.listErrors())[0];
  check('message capped at 500', long.message.length === 500, `${long.message.length}`);
  check('truncation is marked', long.message.endsWith('\u2026'));

  const stacked = new Error('with a stack');
  stacked.stack = 'x'.repeat(4000);
  await log.recordError(stacked, 'long stack');
  check('stack capped at 1500', (await log.listErrors())[0].stack.length === 1500);

  // 5. clearing
  await log.clearErrors();
  check('clear empties in memory', (await log.errorCount()) === 0);
  check('clear persists', JSON.parse(store.get(KEY) || '[]').length === 0);

  // 6. corrupt storage
  store.set(KEY, '{ not json at all');
  delete require.cache[require.resolve(errorLogPath)];
  const reloaded = require(errorLogPath);
  check('corrupt storage resets to empty', (await reloaded.errorCount()) === 0);
  await reloaded.recordError(new Error('after corruption'), 'recovery');
  check('still usable after corruption', (await reloaded.errorCount()) === 1);
  store.set(KEY, JSON.stringify({ nope: true }));
  delete require.cache[require.resolve(errorLogPath)];
  const reloaded2 = require(errorLogPath);
  check('non-array storage also resets cleanly', (await reloaded2.errorCount()) === 0);

  // 7. never throws
  failWrites = true;
  let threw = false;
  try {
    await reloaded2.recordError(new Error('write will fail'), 'storage');
  } catch (error) {
    threw = true;
  }
  failWrites = false;
  check('a failing write never propagates', !threw);

  let threwNull = false;
  try {
    await reloaded2.recordError(null, 'null error');
  } catch (error) {
    threwNull = true;
  }
  check('a null error is handled', !threwNull);

  // 8. display helper
  const described = reloaded2.describeErrorEntry({
    at: new Date().toISOString(),
    context: 'generate',
    message: 'boom',
    stack: 'line1\nline2',
  });
  check('display shows context and message', described.includes('generate') && described.includes('boom'));
  check('display shows the stack', described.includes('line1'));
  check('display tolerates an empty entry', reloaded2.describeErrorEntry(null) === '');

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('check crashed:', error);
  process.exit(1);
});
