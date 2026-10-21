const assert = require('node:assert');

// The plugin requires @expo/config-plugins, which only exists inside the mobile
// project. Stub it for this test: withAppBuildGradle(config, fn) just calls fn.
const Module = require('node:module');
const load = Module._load;
Module._load = function (request) {
  if (request === '@expo/config-plugins') {
    return { withAppBuildGradle: (config, fn) => fn(config) };
  }
  return load.apply(this, arguments);
};

// Works from either layout:
//   tools/android-ci/SigningConfig.test.js              (next to SigningConfig.js)
//   mobile-app/scripts/check-signing-config.js          (../src/plugins/SigningConfig/index.js)
const fs = require('node:fs');
const path = require('node:path');
const candidates = [
  './SigningConfig.js',
  './index.js',
  '../src/plugins/SigningConfig/index.js',
  '../tools/android-ci/SigningConfig.js',
];
const pluginPath = candidates.find((p) => fs.existsSync(path.resolve(__dirname, p)));
if (!pluginPath) {
  console.error('Could not find SigningConfig.js. Looked in: ' + candidates.join(', '));
  process.exit(1);
}
const resolved = path.resolve(__dirname, pluginPath);
const { applySigningConfig } = require(resolved);
console.log('plugin: ' + resolved);

// The shape of android/app/build.gradle as expo prebuild (SDK 57) generates it.
const TEMPLATE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"

android {
    ndkVersion rootProject.ext.ndkVersion
    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace 'com.frogpaper.mobile'
    defaultConfig {
        applicationId 'com.frogpaper.mobile'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 51
        versionName "1.12.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
`;

const patched = applySigningConfig(TEMPLATE);

// 1. release block got a signingConfig for the real key
assert.ok(patched.includes('release {'), 'release block still present');
assert.ok(patched.includes('@frogpaper-signing-start'), 'signing block inserted');
assert.ok(patched.includes("rootProject.file('keystore.properties')"), 'reads keystore.properties');
assert.ok(patched.includes('signingConfig signingConfigs.release'), 'release points at the release key');

// 2. the debug signingConfig line is gone from the release block (commented out)
const btAt = patched.indexOf('buildTypes {');
const releaseSection = patched.slice(patched.indexOf('release {', btAt));
assert.ok(/\/\/\s*signingConfig\s+signingConfigs\.debug/.test(releaseSection), 'debug line commented in release block');
assert.ok(!/^\s*signingConfig signingConfigs\.debug/m.test(releaseSection.replace(/\/\/.*$/gm, '')), 'no live debug signing in release');

// 3. the debug build type is untouched
const debugSection = patched.slice(patched.indexOf('debug {', patched.indexOf('buildTypes {')));
assert.ok(/^\s*signingConfig signingConfigs\.debug/m.test(debugSection.split('release {')[0]), 'debug build still signs with debug key');

// 4. idempotent: running prebuild/plugin twice must not duplicate anything
const twice = applySigningConfig(patched);
assert.strictEqual(twice, patched, 'second pass is a no-op');
assert.strictEqual((patched.match(/@frogpaper-signing-start/g) || []).length, 1, 'marker appears once');

// 5. a template with no signingConfigs block gets one created
const noSigning = `android {
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;
const created = applySigningConfig(noSigning);
assert.ok(created.includes('signingConfigs {'), 'signingConfigs block created');
assert.ok(created.includes('signingConfig signingConfigs.release'), 'release rewired');
assert.ok(created.indexOf('signingConfigs {') < created.indexOf('buildTypes {'), 'signingConfigs comes before buildTypes');

// 6. unknown template is left alone rather than corrupted
const junk = 'apply plugin: "com.android.application"\n';
assert.strictEqual(applySigningConfig(junk), junk, 'unrecognised template untouched');
assert.strictEqual(applySigningConfig(''), '', 'empty input untouched');

console.log('PASS: 6 checks on applySigningConfig');
console.log('--- patched release block ---');
console.log(patched.slice(patched.indexOf('    signingConfigs {')));
