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
 *   6. A selected mode uses its real data (promptModes.json): styleBase wording,
 *      qualityLead early and qualityClose last, and composeSelection() hands back
 *      that mode's negative list. With no mode the composition and the empty
 *      negative are unchanged from before modes changed the writing.
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
const PROMPT_MODES = require(path.join(ROOT, 'src/data/promptModes.json'));
const {
  composePrompt,
  composeSelection,
  modeData,
  modeKey,
  randomCombo,
} = require(path.join(ROOT, 'src/services/promptComposer.js'));

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

  // A mode brings real data (see the Modes section below), so a full selection
  // reads subject/setting, the mode's quality cues, its style wording, then the
  // remaining rows, and the mode's closing cues - not the bare mode word.
  checkComposes(
    'a full selection composes subject + setting, mode quality/style, then the other rows',
    {
      subject: 'frog',
      setting: 'lily pond at dawn',
      mode: 'Cinematic',
      style: 'oil painting',
      lighting: 'golden hour',
      mood: 'serene',
      atmosphere: 'forest fog',
    },
    'A frog in a lily pond at dawn, movie-poster depth of field, dramatic lighting ratio, ' +
      'rich shadow and highlight detail, subject must remain clearly recognizable, ' +
      'cinematic widescreen composition, anamorphic lens render, film-quality lighting and ' +
      'colour grade, oil painting style, golden hour lighting, serene mood, forest fog, ' +
      'professional colour grading, sharp foreground with atmospheric background, ' +
      'no flat or amateur lighting, style must not obscure subject identity'
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

  // Mode-only still starts capitalised, but now carries the mode's own wording.
  checkComposes(
    'mode-only composes the mode data, capitalised',
    { mode: 'Pixel Art' },
    'Clean pixel-perfect edges, readable silhouette at all scales, intentional dithering, ' +
      'subject must remain clearly recognizable, high-quality pixel art, crisp pixel grid, ' +
      'retro game aesthetic, limited colour palette, 16-bit or 32-bit era quality, ' +
      'consistent pixel size, strong contrast between foreground and background, ' +
      'style must not obscure subject identity'
  );

  // The other rows keep their places around the mode's data.
  checkComposes(
    'mood and mode data keep their order',
    { mood: 'cozy', mode: 'Dark Fantasy' },
    'Rich shadow detail, high contrast chiaroscuro, brooding colour palette, epic scale, ' +
      'subject must remain clearly recognizable, dark fantasy concept art, dramatic shadows, ' +
      'moody atmospheric depth, gothic grandeur, cozy mood, AAA game concept art quality, ' +
      'painterly textures, no flat shading, deep atmospheric perspective, ' +
      'style must not obscure subject identity'
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
  const firstBoth = composeSelection(selection);
  const secondBoth = composeSelection({ ...selection });
  check(
    'composeSelection is deterministic (prompt and negative)',
    firstBoth.prompt === secondBoth.prompt && firstBoth.negative === secondBoth.negative,
    firstBoth.prompt
  );
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

// --- 6: no-mode fidelity --------------------------------------------------
// The mode work must not change a single character of what the composer did
// before, for selections without a mode. These literals are that old output.
function checkNoModeFidelity() {
  console.log('\nNo-mode fidelity (unchanged behaviour)');
  checkComposes(
    'no mode: every non-mode row still composes in order',
    {
      subject: 'frog',
      setting: 'lily pond at dawn',
      style: 'oil painting',
      lighting: 'golden hour',
      mood: 'serene',
      atmosphere: 'forest fog',
    },
    'A frog in a lily pond at dawn, oil painting style, golden hour lighting, serene mood, forest fog'
  );
  checkComposes(
    'no mode: a partial selection is untouched',
    { subject: 'astronaut', setting: 'under the sea', style: 'watercolor storybook' },
    'An astronaut under the sea, watercolor storybook style'
  );
  checkComposes('no mode: setting-only is untouched', { setting: 'the old mill' }, 'In the old mill');
  checkComposes(
    'no mode: the empty selection is still empty',
    { subject: '  ', style: '', mode: '' },
    ''
  );
  const unknown = { mode: 'Not A Real Mode' };
  check(
    'an unknown mode keeps the old bare-word behaviour',
    composePrompt(unknown) === 'Not a real mode',
    composePrompt(unknown)
  );
  check(
    'an unknown mode returns no negative',
    composeSelection(unknown).negative === '',
    JSON.stringify(composeSelection(unknown).negative)
  );
}

// --- 7: modes that change the writing -------------------------------------
// Each of the 10 modes must carry real data and actually shape both outputs.
function checkModes() {
  console.log('\nModes');
  const labels = options.MODES;

  check(
    'promptModes.json holds exactly the 10 Build modes, keyed by slug',
    Object.keys(PROMPT_MODES).length === labels.length &&
      labels.every((label) =>
        Object.prototype.hasOwnProperty.call(PROMPT_MODES, modeKey(label))
      ),
    `keys=${Object.keys(PROMPT_MODES).join(',')}`
  );

  // All four fields must exist and be non-empty for every mode.
  const fields = ['styleBase', 'qualityLead', 'qualityClose', 'negative'];
  for (const field of fields) {
    const missing = labels.filter((label) => {
      const data = modeData(label);
      return !data || typeof data[field] !== 'string' || data[field].trim().length === 0;
    });
    check(
      `every mode has a non-empty ${field}`,
      missing.length === 0,
      `missing/blank: ${missing.join(', ') || 'none'}`
    );
  }
  const shortNegatives = labels.filter((label) => {
    const data = modeData(label);
    if (!data) {
      return true;
    }
    return data.negative.split(',').filter((term) => term.trim().length > 0).length < 80;
  });
  check(
    'every mode negative lists at least 80 comma-separated terms',
    shortNegatives.length === 0,
    `too short: ${shortNegatives.join(', ') || 'none'}`
  );

  const opening = 'A frog in a lily pond at dawn, ';
  for (const label of labels) {
    const data = modeData(label);

    // styleBase supplies the style wording, qualityClose closes the sentence.
    const modeOnly = composePrompt({ mode: label });
    check(
      `${label}: the prompt uses its styleBase and closes with its qualityClose`,
      modeOnly.includes(data.styleBase) && modeOnly.endsWith(data.qualityClose),
      modeOnly
    );

    // qualityLead lands early - right after the subject/setting clause.
    const withOpening = composePrompt({
      subject: 'frog',
      setting: 'lily pond at dawn',
      mode: label,
    });
    check(
      `${label}: qualityLead lands after the subject/setting clause, before the style base`,
      withOpening.startsWith(`${opening}${data.qualityLead}`) &&
        withOpening.indexOf(data.styleBase) > withOpening.indexOf(data.qualityLead),
      withOpening
    );

    // The mode's negative travels with the composition.
    const selection = composeSelection({ mode: label });
    check(
      `${label}: composeSelection returns that mode's negative`,
      selection.negative === PROMPT_MODES[modeKey(label)].negative &&
        selection.negative.length > 0,
      `got ${selection.negative.length} chars`
    );

    // A Style chosen by hand survives alongside the mode's style wording.
    const styled = composePrompt({ mode: label, style: 'oil painting' });
    check(
      `${label}: mode + Style keeps both the styleBase and the chosen style`,
      styled.includes(data.styleBase) && styled.includes('oil painting style'),
      styled
    );
  }

  // A mode is never tacked on as a bare word any more.
  const bareWord = labels.filter((label) =>
    composePrompt({ mode: label }).endsWith(label.toLowerCase())
  );
  check(
    'no mode is appended as a bare word',
    bareWord.length === 0,
    bareWord.join(', ')
  );

  // A fragment another row already stated is not repeated by the mode data.
  const deduped = composePrompt({
    setting: 'cinematic widescreen composition',
    mode: 'Cinematic',
  });
  check(
    'a mode fragment already stated by another row is not repeated',
    deduped.split('cinematic widescreen composition').length - 1 === 1,
    deduped
  );

  const both = composeSelection({ subject: 'frog', mode: 'Anime', style: 'stained glass' });
  check(
    'composePrompt stays in step with composeSelection().prompt',
    composePrompt({ subject: 'frog', mode: 'Anime', style: 'stained glass' }) === both.prompt,
    both.prompt
  );
  check(
    'no mode selected returns an empty negative',
    composeSelection({ subject: 'frog', style: 'ink and wash' }).negative === ''
  );
}

(async () => {
  try {
    checkComposer();
    checkEmpty();
    checkLists();
    checkRandomCombo();
    checkDeterminism();
    checkNoModeFidelity();
    checkModes();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
