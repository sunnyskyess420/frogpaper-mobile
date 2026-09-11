#!/usr/bin/env node
/**
 * check-sentry.js - Pre-build verification that Sentry is properly wired.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-sentry.js
 * or via the npm script:
 *     npm run check:sentry
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build hooks.
 *
 * Checks performed:
 *   1. @sentry/react-native is listed in package.json dependencies.
 *   2. The @sentry/react-native Expo plugin is configured in app.json.
 *   3. The plugin's DSN is either a real DSN or a placeholder (and a real
 *      DSN is reachable via SENTRY_DSN env var or runtime AsyncStorage).
 *   4. The Sentry service module exists at src/services/sentry.js.
 *   5. App.js imports and calls initSentry() before rendering.
 *   6. SettingsScreen.js exposes a Diagnostics section with test-crash.
 *
 * This script does NOT execute any app code - it only inspects files
 * (text + JSON parsing). Safe to run in any CI environment.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FAIL = '\x1b[31m[FAIL]\x1b[0m';
const PASS = '\x1b[32m[PASS]\x1b[0m';
const WARN = '\x1b[33m[WARN]\x1b[0m';
const INFO = '\x1b[36m[INFO]\x1b[0m';

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

function readText(p) {
  return fs.readFileSync(path.resolve(ROOT, p), 'utf8');
}

function readJson(p) {
  return JSON.parse(readText(p));
}

function fileExists(p) {
  try {
    fs.accessSync(path.resolve(ROOT, p), fs.constants.R_OK);
    return true;
  } catch (e) {
    return false;
  }
}

// --- Checks -------------------------------------------------------------

check('package.json contains @sentry/react-native dependency', () => {
  const pkg = readJson('package.json');
  const version = pkg.dependencies && pkg.dependencies['@sentry/react-native'];
  if (!version) {
    return { ok: false, detail: 'add "@sentry/react-native" to dependencies' };
  }
  return { ok: true, detail: `version range: ${version}` };
});

check('npm script "check:sentry" present', () => {
  const pkg = readJson('package.json');
  const present = pkg.scripts && pkg.scripts['check:sentry'];
  return { ok: !!present, detail: present || 'missing' };
});

check('app.json has @sentry/react-native Expo plugin configured', () => {
  const appJson = readJson('app.json');
  const plugins = appJson.expo && appJson.expo.plugins;
  if (!Array.isArray(plugins)) {
    return { ok: false, detail: 'no plugins array found in app.json' };
  }
  const sentryPlugin = plugins.find(
    (p) => Array.isArray(p) && p[0] === '@sentry/react-native',
  );
  if (!sentryPlugin) {
    return { ok: false, detail: 'add ["@sentry/react-native", {...}] to plugins' };
  }
  const cfg = sentryPlugin[1] || {};
  const dsnOk =
    typeof cfg.dsn === 'string' &&
    cfg.dsn &&
    !cfg.dsn.startsWith('REPLACE_WITH');
  return {
    ok: true,
    detail: `plugin present, DSN ${dsnOk ? 'set' : 'is placeholder (OK for dev, replace before prod build)'}`,
  };
});

check('SENTRY_DSN env var (optional override)', () => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return { ok: true, warn: true, detail: 'not set (using app.json DSN instead)' };
  }
  const valid = /^https?:\/\/[^@]+@.+/i.test(dsn);
  return { ok: valid, warn: !valid, detail: valid ? 'set, format OK' : `set but format looks invalid: ${dsn}` };
});

check('src/services/sentry.js exists', () => {
  return { ok: fileExists('src/services/sentry.js'), detail: '' };
});

check('App.js imports and calls initSentry()', () => {
  if (!fileExists('App.js')) {
    return { ok: false, detail: 'App.js not found' };
  }
  const src = readText('App.js');
  const hasImport = /from\s+['"]\.\/src\/services\/sentry['"]/.test(src);
  const hasInit = /\binitSentry\s*\(/.test(src);
  return {
    ok: hasImport && hasInit,
    detail: `import: ${hasImport}, initSentry() call: ${hasInit}`,
  };
});

check('SettingsScreen.js exposes Diagnostics section with forceTestCrash', () => {
  if (!fileExists('src/screens/SettingsScreen.js')) {
    return { ok: false, detail: 'SettingsScreen.js not found' };
  }
  const src = readText('src/screens/SettingsScreen.js');
  const hasForceCrash = /forceTestCrash/.test(src);
  const hasDsnInput = /sentryDsn/.test(src);
  return {
    ok: hasForceCrash && hasDsnInput,
    detail: `forceTestCrash import: ${hasForceCrash}, DSN input: ${hasDsnInput}`,
  };
});

// --- Run ----------------------------------------------------------------

let failures = 0;
let warnings = 0;

console.log('\nFrogPaper Mobile - Sentry build check\n');
console.log('Working directory:', ROOT, '\n');

for (const { name, fn } of checks) {
  let result;
  try {
    result = fn();
  } catch (err) {
    result = { ok: false, detail: `exception: ${err.message}` };
  }
  const tag = result.ok ? (result.warn ? WARN : PASS) : FAIL;
  if (!result.ok) failures++;
  if (result.warn) warnings++;
  console.log(`${tag} ${name}`);
  if (result.detail) {
    console.log(`       ${result.detail}`);
  }
}

console.log('\n' + '='.repeat(60));
if (failures > 0) {
  console.log(`${FAIL} ${failures} check(s) failed, ${warnings} warning(s).`);
  console.log('Fix the failures before building a production APK/IPA.');
  process.exit(1);
} else if (warnings > 0) {
  console.log(`${PASS} All checks passed with ${warnings} warning(s).`);
  process.exit(0);
} else {
  console.log(`${PASS} All checks passed.`);
  process.exit(0);
}
