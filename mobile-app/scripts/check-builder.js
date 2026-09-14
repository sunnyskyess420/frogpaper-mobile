#!/usr/bin/env node
/**
 * check-builder.js - headless verification of the Build screen's prompt logic.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-builder.js
 * or via the npm script:
 *     npm run check:builder
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build hooks.
 *
 * What it proves (no device, no backend, no network):
 *   1. composePrompt() renders a sensible sentence for a full selection, for
 *      partial selections (subject only, setting only, no subject, ...) and for
 *      free-text settings that already read as a place ("under the sea").
 *   2. An empty (or all-whitespace) selection composes to the empty string, so
 *      the screen can keep its "Use this prompt" button disabled.
 *   3. The option lists the screen shows have exactly the expected lengths.
 *   4. randomCombo() only ever returns values taken from those lists.
 *   5. composePrompt() is deterministic: the same selection twice is
 *      byte-identical.
 *
 * How it loads the app code: same trick as check-offline.js - the app modules
 * are plain ESM, so this script transpiles them to CommonJS on the fly (babel,
 * no config files) and stubs the native modules they might import. The composer
 * and the option lists are pure JS, so no device or bundle is needed.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

// --- stub the native modules the app modules may pull in -------------------
// (the composer itself is pure JS; these keep the Module hook honest if the
// dependency graph ever grows a react-native import).
const mocks = {
  'react-native': { Platform: { OS: 'android' } },
  'expo-constants': { __esModule: true, default: { expoConfig: null }, expoConfig: null },
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
  },
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

const options = require(path.join(ROOT, 'src/data/promptOptions.js'));
const { composePrompt, randomCombo } = require(path.join(ROOT, 'src/services/promptComposer.js'));

// --- assertion helpers ----------------------------------------------------
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

function checkComposes(name, selection, expected) {
  const actual = composePrompt(selection);
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// --- 1: composer output ---------------------------------------------------
function checkComposer() {
  console.log('\nComposer');

  // The example from the feature request: the mode closes the sentence.
  checkComposes(
    'a full selection composes subject + setting, then style/lighting/mood/atmosphere/mode',
    {
      subject: 'frog',
      setting: 'lily pond at dawn',
      mode: 'Cinematic',
      style: 'oil painting',
      lighting: 'golden hour',
      mood: 'serene',
      atmosphere: 'forest fog',
    },
    'A frog in a lily pond at dawn, oil painting style, golden hour lighting, serene mood, forest fog, cinematic'
  );

  // Vowel subjects take "an"; a preposition setting is used verbatim.
  checkComposes(
    'a partial selection adds only the chosen clauses (an + preposition setting)',
    { subject: 'astronaut', setting: 'under the sea', style: 'watercolor storybook' },
    'An astronaut under the sea, watercolor storybook style'
  );

  checkComposes(
    'setting-only composes as a place',
    { setting: 'the old mill' },
    'In the old mill'
  );

  checkComposes(
    'a bare noun setting gets "in a"',
    { setting: 'misty forest' },
    'In a misty forest'
  );

  checkComposes(
    'mode-only is capitalised and lowercased in the body',
    { mode: 'Pixel Art' },
    'Pixel art'
  );

  checkComposes(
    'mood + mode keep their order',
    { mood: 'cozy', mode: 'Dark Fantasy' },
    'Cozy mood, dark fantasy'
  );

  // Unselected / blank keys are skipped, not rendered as empty clauses.
  checkComposes(
    'blank and undefined values are skipped',
    { subject: '  dragon  ', style: '', lighting: undefined, mood: null, setting: '   ' },
    'A dragon'
  );

  checkComposes(
    'a style that already ends in "style" still reads correctly',
    { style: 'cyberpunk' },
    'Cyberpunk style'
  );
}

// --- 2: empty selection ---------------------------------------------------
function checkEmpty() {
  console.log('\nEmpty selection');
  check('no selection composes to the empty string', composePrompt() === '');
  check('an empty object composes to the empty string', composePrompt({}) === '');
  check(
    'an all-whitespace selection composes to the empty string',
    composePrompt({ subject: ' ', setting: '  ', mode: '\t', style: '', mood: null }) === ''
  );
}

// --- 3: option lists ------------------------------------------------------
function checkLists() {
  console.log('\nOption lists');
  const expected = {
    MODES: 10,
    SUBJECTS: 16,
    STYLES: 23,
    LIGHTING: 19,
    MOODS: 19,
    ATMOSPHERES: 10,
  };
  for (const [key, length] of Object.entries(expected)) {
    const list = options[key];
    check(
      `${key} has ${length} entries`,
      Array.isArray(list) && list.length === length,
      `got ${Array.isArray(list) ? list.length : typeof list}`
    );
    check(
      `${key} holds non-empty strings`,
      Array.isArray(list) && list.every((item) => typeof item === 'string' && item.trim().length > 0)
    );
  }
  check(
    'SETTING_SUGGESTIONS is a short non-empty list of strings',
    Array.isArray(options.SETTING_SUGGESTIONS) &&
      options.SETTING_SUGGESTIONS.length >= 6 &&
      options.SETTING_SUGGESTIONS.length <= 8 &&
      options.SETTING_SUGGESTIONS.every((item) => typeof item === 'string' && item.trim().length > 0),
    `length=${options.SETTING_SUGGESTIONS && options.SETTING_SUGGESTIONS.length}`
  );
}

// --- 4: randomCombo -------------------------------------------------------
function checkRandomCombo() {
  console.log('\nrandomCombo');
  const lists = {
    mode: options.MODES,
    subject: options.SUBJECTS,
    setting: options.SETTING_SUGGESTIONS,
    style: options.STYLES,
    lighting: options.LIGHTING,
    mood: options.MOODS,
    atmosphere: options.ATMOSPHERES,
  };

  let allFromLists = true;
  let firstBad = null;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const combo = randomCombo();
    for (const [key, list] of Object.entries(lists)) {
      if (!list.includes(combo[key])) {
        allFromLists = false;
        firstBad = firstBad || `${key}=${JSON.stringify(combo[key])}`;
      }
    }
  }
  check('500 draws always return values from the option lists', allFromLists, firstBad || undefined);
  check('every draw fills every row', Object.keys(randomCombo()).sort().join(',') === Object.keys(lists).sort().join(','));

  // An injected rng at the bottom of the range picks the first entry of each list.
  const firsts = randomCombo(() => 0);
  check(
    'an injected rng of 0 picks the first entry of every list',
    Object.entries(lists).every(([key, list]) => firsts[key] === list[0]),
    JSON.stringify(firsts)
  );

  // randomCombo output must be composable as-is.
  const composed = composePrompt(randomCombo(() => 0.999));
  check('a randomised combo composes to a non-empty prompt', composed.length > 0, composed);
}

// --- 5: determinism -------------------------------------------------------
function checkDeterminism() {
  console.log('\nDeterminism');
  const selection = {
    mode: 'Surreal',
    subject: 'bioengineered creature',
    setting: 'floating island',
    style: 'stained glass',
    lighting: 'bioluminescent glow',
    mood: 'dreamlike',
    atmosphere: 'stardust',
  };
  const first = composePrompt(selection);
  const second = composePrompt({ ...selection });
  check('the same selection composes byte-identical text', first === second, first);
  check(
    'composing does not mutate the selection object',
    JSON.stringify(selection) ===
      JSON.stringify({
        mode: 'Surreal',
        subject: 'bioengineered creature',
        setting: 'floating island',
        style: 'stained glass',
        lighting: 'bioluminescent glow',
        mood: 'dreamlike',
        atmosphere: 'stardust',
      })
  );
}

(async () => {
  try {
    checkComposer();
    checkEmpty();
    checkLists();
    checkRandomCombo();
    checkDeterminism();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
