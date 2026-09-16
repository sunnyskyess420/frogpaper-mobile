#!/usr/bin/env node
/**
 * check-accesskey.js - the app works with no setup, and a real key still wins.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-accesskey.js
 * or via the npm script:
 *     npm run check:accesskey
 *
 * Proves, with no device and no network:
 *   1. a built-in key ships with the app
 *   2. a brand-new install (nothing saved) uses it, so generating just works
 *   3. a key the owner typed in Settings wins over the built-in
 *   4. clearing the saved key falls back to the built-in instead of leaving the
 *      app with no key at all (which would break every request)
 *   5. image URLs carry the key, since <Image> and downloads cannot send headers
 *
 * Transpiles the app's ESM the same way the other check scripts do.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

const store = new Map();

const asyncStorageStub = {
  __esModule: true,
  default: {
    async getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
  },
};

// api.js imports Platform from react-native, which cannot be parsed outside the
// bundler, so the few pieces it uses are stubbed here.
const reactNativeStub = {
  __esModule: true,
  Platform: {
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

// The module caches the key in memory, so each scenario needs a fresh copy.
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
  console.log('access key');

  const first = freshApi();
  const builtIn = first.BUILT_IN_ACCESS_KEY;
  check('a built-in key ships with the app', typeof builtIn === 'string' && builtIn.length >= 8, String(builtIn && builtIn.length));
  check('it is not a placeholder', !/change|example|placeholder|xxx/i.test(builtIn), builtIn);

  // 2. a brand-new install
  store.clear();
  const fresh = freshApi();
  check('a new install uses the built-in key', (await fresh.getAccessKey()) === builtIn);

  // 3. an owner-typed key wins
  store.clear();
  const typed = freshApi();
  await typed.setAccessKey('my-own-key-123');
  check('a saved key wins over the built-in', (await typed.getAccessKey()) === 'my-own-key-123');
  const restarted = freshApi();
  check('the saved key survives a restart', (await restarted.getAccessKey()) === 'my-own-key-123');
  check('whitespace is trimmed when saving', (await typed.setAccessKey('   spaced-key   ')) === undefined && (await typed.getAccessKey()) === 'spaced-key');

  // 4. clearing falls back, and never leaves the app keyless
  const cleared = freshApi();
  await cleared.setAccessKey('temporary');
  await cleared.setAccessKey('');
  const afterClear = await cleared.getAccessKey();
  check('clearing falls back to the built-in', afterClear === builtIn, String(afterClear));
  check('the app is never left with no key', !!afterClear);

  // 5. the key actually travels with requests. Checked against the source:
  // image URLs must carry it (Image and downloads cannot send headers) and
  // JSON calls must send the header.
  const source = fs.readFileSync(apiPath, 'utf8');
  check('image urls carry the key', source.includes('?key=') && source.includes('encodeURIComponent'));
  check('requests send the key header', source.includes('X-Access-Key'));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('check crashed:', error);
  process.exit(1);
});
