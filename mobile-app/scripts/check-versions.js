#!/usr/bin/env node
/**
 * check-versions.js - the two version files must agree.
 *
 * app.json is what the app reads at runtime (Settings > About shows it via
 * expo-constants); android/app/build.gradle is what Android stamps on the APK.
 * They were found diverged (1.9.44 vs 1.9.50) after several bumps silently
 * missed one file, so this suite compares them.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

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

function main() {
  console.log('versions');
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');

  const gradleName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1];
  const gradleCode = (gradle.match(/versionCode\s+(\d+)/) || [])[1];
  const expo = appJson.expo || {};

  check('app.json has a version', typeof expo.version === 'string' && expo.version.length > 0, String(expo.version));
  check('build.gradle has a version name', !!gradleName, String(gradleName));
  check('the two version names agree', expo.version === gradleName, `app.json=${expo.version} gradle=${gradleName}`);
  check('app.json has a versionCode', Number.isInteger(expo.android && expo.android.versionCode), String(expo.android && expo.android.versionCode));
  check('the two version codes agree', String(expo.android && expo.android.versionCode) === String(gradleCode), `app.json=${expo.android && expo.android.versionCode} gradle=${gradleCode}`);
  check('the version looks like x.y.z', /^\d+\.\d+\.\d+$/.test(expo.version), String(expo.version));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
