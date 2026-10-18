#!/usr/bin/env node
/**
 * check-navigation.js - catch the "stack screen calls a tab screen directly"
 * regression that shipped with the bottom-tab refactor.
 *
 * Root-stack screens (Build, Detail, History) are siblings of the
 * Tabs navigator, not children of it. `navigation.navigate('Generate')` from
 * one of them is not handled by the root stack, so the button silently does
 * nothing. The working form is:
 *
 *     navigation.navigate('Tabs', { screen: 'Generate', params: {...} })
 *
 * This is a static check: it reads the screen sources and the navigator.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';
const TAB_NAMES = ['Home', 'Generate', 'Gallery', 'Settings'];
const ROOT_SCREENS = [
  'DetailScreen.js',
  'HistoryScreen.js',
  'PromptBuilderScreen.js',
];

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

const navigator = fs.readFileSync(
  path.join(ROOT, 'src', 'navigation', 'AppNavigator.js'),
  'utf8'
);
check(
  'the root stack contains a Tabs screen',
  /<Stack\.Screen\s+name="Tabs"/.test(navigator)
);

for (const screen of ROOT_SCREENS) {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'screens', screen),
    'utf8'
  );
  check(
    `${screen} navigates through the Tabs route`,
    /navigation\.navigate\(\s*['"]Tabs['"]/.test(source)
  );
  check(
    `${screen} pops back to the existing Tabs route`,
    /pop:\s*true/.test(source)
  );
  for (const tab of TAB_NAMES) {
    const direct = new RegExp(
      `navigation\\.navigate\\(\\s*['"]${tab}['"]`
    );
    check(
      `${screen} does not call the ${tab} tab directly`,
      !direct.test(source)
    );
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
