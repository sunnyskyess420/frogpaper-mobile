#!/usr/bin/env node
/**
 * check-update.js - the "is there a newer FrogPaper?" check.
 *
 *     node scripts/check-update.js
 *     npm run check:update
 *
 * Proves, with no network:
 *   1. version strings parse, in every shape GitHub might hand us
 *   2. comparison is numeric, not alphabetical (1.9.10 > 1.9.9)
 *   3. a newer release is reported as an update, an older one does not nag
 *   4. no releases yet (GitHub 404) is reported honestly, not as an error
 *   5. a dead network is reported as offline, never thrown
 *   6. nothing about the phone is sent, and no token is used
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

const expoConstantsStub = { __esModule: true, default: { expoConfig: { version: '1.9.57' } } };

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
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

let capturedRequest = null;
global.fetch = async (url, options) => {
  capturedRequest = { url, options };
  if (global.__mode === 'offline') {
    throw new Error('network down');
  }
  if (global.__mode === 'none') {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ tag_name: global.__tag, html_url: 'https://example.test/release' }),
  };
};

const updatePath = path.join(ROOT, 'src/services/updateCheck.js');
const update = require(updatePath);

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
  console.log('update check');

  check('the running version is read from app.json', update.runningVersion() === '1.9.57', update.runningVersion());

  check('a plain version parses', JSON.stringify(update.parseVersion('1.9.57')) === '[1,9,57]');
  check('a v-prefixed tag parses', JSON.stringify(update.parseVersion('v1.9.57')) === '[1,9,57]');
  check('a short version pads with zeros', JSON.stringify(update.parseVersion('1.10')) === '[1,10,0]');
  check('junk gives nothing', update.parseVersion('latest') === null && update.parseVersion('') === null && update.parseVersion(null) === null);

  check('a higher patch is newer', update.compareVersions('1.9.58', '1.9.57') === 1);
  check('numeric, not alphabetical', update.compareVersions('1.9.10', '1.9.9') === 1);
  check('a higher minor is newer', update.compareVersions('1.10.0', '1.9.99') === 1);
  check('equal versions tie', update.compareVersions('1.9.57', 'v1.9.57') === 0);
  check('an older release is older', update.compareVersions('1.9.50', '1.9.57') === -1);
  check('junk never claims an update', update.compareVersions('nonsense', '1.9.57') === 0);

  global.__mode = 'release';
  global.__tag = 'v1.9.58';
  let result = await update.checkForUpdate();
  check('a newer release is reported', result.state === 'update', JSON.stringify(result));
  check('it names both versions', result.current === '1.9.57' && result.latest === '1.9.58', JSON.stringify(result));
  check('it offers the release page', typeof result.url === 'string' && result.url.includes('release'), String(result.url));

  global.__tag = 'v1.9.57';
  result = await update.checkForUpdate();
  check('the same version is not an update', result.state === 'current', JSON.stringify(result));

  global.__tag = 'v1.9.10';
  result = await update.checkForUpdate();
  check('an older release does not nag', result.state === 'current', JSON.stringify(result));

  global.__mode = 'none';
  result = await update.checkForUpdate();
  check('no releases yet is reported honestly', result.state === 'none', JSON.stringify(result));

  global.__mode = 'offline';
  let threw = false;
  try {
    result = await update.checkForUpdate();
  } catch (error) {
    threw = true;
  }
  check('a dead network never throws', !threw);
  check('a dead network reports offline', result && result.state === 'offline', JSON.stringify(result));

  // Nothing about the phone, and no credential.
  const headers = (capturedRequest && capturedRequest.options && capturedRequest.options.headers) || {};
  const headerText = JSON.stringify(headers).toLowerCase();
  check('no token is sent', !headerText.includes('token') && !headerText.includes('authorization'), headerText);
  check('it only asks for the public release info', String(capturedRequest.url).includes('api.github.com') && String(capturedRequest.url).endsWith('/releases/latest'), capturedRequest.url);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('check crashed:', error);
  process.exit(1);
});
