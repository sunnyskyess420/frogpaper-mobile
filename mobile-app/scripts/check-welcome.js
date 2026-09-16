#!/usr/bin/env node
/**
 * check-welcome.js - the first-launch walkthrough appears exactly once.
 *
 *     node scripts/check-welcome.js
 *     npm run check:welcome
 *
 * Proves, with no device:
 *   1. a brand-new install has not seen it
 *   2. marking it seen sticks, including across a restart
 *   3. Settings can arm it again
 *   4. a store that will not read or write never throws
 *   5. the walkthrough is actually reachable from the app, and is skippable
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

const store = new Map();
let broken = false;

const asyncStorageStub = {
  __esModule: true,
  default: {
    async getItem(key) {
      if (broken) throw new Error('store unavailable');
      return store.has(key) ? store.get(key) : null;
    },
    async setItem(key, value) {
      if (broken) throw new Error('store unavailable');
      store.set(key, value);
    },
    async removeItem(key) {
      if (broken) throw new Error('store unavailable');
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

const servicePath = path.join(ROOT, 'src/services/firstRun.js');
const tutorialPath = path.join(ROOT, 'src/components/WelcomeTutorial.js');

function fresh() {
  delete require.cache[require.resolve(servicePath)];
  return require(servicePath);
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
  console.log('welcome walkthrough');

  store.clear();
  const first = fresh();
  check('a fresh install has not seen it', (await first.hasSeenWelcome()) === false);

  await first.markWelcomeSeen();
  check('marking it seen works', (await first.hasSeenWelcome()) === true);
  const restarted = fresh();
  check('and it stays seen after a restart', (await restarted.hasSeenWelcome()) === true);

  await restarted.resetWelcome();
  check('Settings can arm it again', (await restarted.hasSeenWelcome()) === false);
  const third = fresh();
  check('the arming survives a restart too', (await third.hasSeenWelcome()) === false);

  broken = true;
  let threw = false;
  try {
    const damaged = fresh();
    await damaged.hasSeenWelcome();
    await damaged.markWelcomeSeen();
    await damaged.resetWelcome();
  } catch (error) {
    threw = true;
  }
  broken = false;
  check('a broken store never throws', !threw);

  // Reachability: the app must actually be able to show it.
  const appSource = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
  check('the app shows the walkthrough', appSource.includes('WelcomeTutorial'));
  check('only for a first launch', appSource.includes('hasSeenWelcome') && appSource.includes('!seen'));
  check('and records that it was seen', appSource.includes('markWelcomeSeen'));

  const settings = fs.readFileSync(path.join(ROOT, 'src/screens/SettingsScreen.js'), 'utf8');
  check('Settings can arm it again', settings.includes('resetWelcome') && settings.includes('Show it again'));

  const tutorial = fs.readFileSync(tutorialPath, 'utf8');
  const steps = (tutorial.match(/title: '/g) || []).length;
  check('it is a short tour', steps >= 3 && steps <= 6, `${steps} steps`);
  check('it can be skipped', tutorial.includes('Skip'));
  check('and it says where to find it again', tutorial.includes('Settings'));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('check crashed:', error);
  process.exit(1);
});
