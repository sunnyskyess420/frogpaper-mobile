#!/usr/bin/env node
/**
 * check-recipes.js - headless verification of the recipe and negative-preset logic.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-recipes.js
 * or via the npm script:
 *     npm run check:recipes
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build hooks.
 *
 * What it proves (no device, no backend, no network):
 *   1. Every recipe in src/data/recipes.json is well formed: name, description,
 *      a template whose {slots} all exist in variables, and a non-empty option
 *      list of non-blank strings for each slot.
 *   2. renderRecipe() fills every slot from the recipe's own options, and the
 *      result carries no leftover "{slot}", no double comma and no dangling one.
 *   3. A slot left unset removes only its own chunk and leaves the rest of the
 *      sentence intact: the literal noun naming the slot ("{style} style",
 *      "{weather} weather") goes with it, a following noun that means something
 *      else ("{color} tones") stays, the conjunction joining it to its neighbour
 *      goes, and a clause where no slot is set at all is dropped instead of
 *      leaving an orphan fragment. The owner's eight acceptance examples are
 *      asserted verbatim.
 *   4. All 2^6 = 64 set/unset combinations of the real template render with no
 *      "{slot}", no double space, no stray separator, no lost set value, no
 *      leaked unset value, and deterministically.
 *   5. selectedRecipe() turns the screen's index state into a recipe (or null
 *      for the normal builder), tolerating null/out-of-range indices.
 *   6. rollRecipe() fills every slot with an option taken from that slot's list,
 *      and is drivable with an injected rng.
 *   7. renderRecipe() is deterministic and does not mutate its values.
 *   8. appendPreset() appends without duplicating terms already present
 *      (case-insensitive), keeps the owner's own text verbatim and in order,
 *      returns the added terms, treats blank/None presets as no-ops, and never
 *      re-adds a term on a second tap.
 *   9. Every preset in src/data/negativePresets.json has an id and a label, and
 *      every preset except the blank "none" entry has non-empty terms.
 *   4. selectedRecipe() turns the screen's index state into a recipe (or null
 *      for the normal builder), tolerating null/out-of-range indices.
 *   5. rollRecipe() fills every slot with an option taken from that slot's list,
 *      and is drivable with an injected rng.
 *   6. renderRecipe() is deterministic and does not mutate its values.
 *   7. appendPreset() appends without duplicating terms already present
 *      (case-insensitive), keeps the owner's own text verbatim and in order,
 *      returns the added terms, treats blank/None presets as no-ops, and never
 *      re-adds a term on a second tap.
 *   8. Every preset in src/data/negativePresets.json has an id and a label, and
 *      every preset except the blank "none" entry has non-empty terms.
 *
 * How it loads the app code: same trick as check-builder.js - the app modules are
 * plain ESM, so this script transpiles them to CommonJS on the fly (babel, no
 * config files) and stubs the native modules they might import. The recipe
 * composer and the preset service are pure JS, so no device or bundle is needed.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

// --- stub the native modules the app modules may pull in -------------------
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

const RECIPES = require(path.join(ROOT, 'src/data/recipes.json'));
const PRESET_DATA = require(path.join(ROOT, 'src/data/negativePresets.json'));
const {
  recipeIsUsable,
  recipeSlots,
  renderRecipe,
  rollRecipe,
  selectedRecipe,
  slotLabel,
} = require(path.join(ROOT, 'src/services/recipeComposer.js'));
const {
  appendPreset,
  clearPresetText,
  parseTerms,
} = require(path.join(ROOT, 'src/services/negativePresets.js'));

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

// The formatting rules every rendered recipe must obey. Each entry is
// [pattern, what it means]; shapeProblems() reports the ones a text trips so a
// failure says what actually went wrong instead of just "mismatch".
const BAD_SHAPES = [
  [/\{/, 'a leftover "{"'],
  [/\}/, 'a leftover "}"'],
  [/ {2,}/, 'a double space'],
  [/^\s|\s$/, 'leading/trailing whitespace'],
  [/^,|,$/, 'leading/trailing comma'],
  [/,,|,\s*,/, 'an empty clause'],
  [/\s,/, 'a space before a comma'],
  [/,\s*and\b/, '", and"'],
  [/\band\s*,/, '"and ,"'],
  [/^[,;.]|^\s*(and|or)\b/, 'a leading separator/conjunction'],
  [/\b(and|or|in|with|of|on|at|from|for|by|to)\s*$/, 'a dangling connector'],
];

function shapeProblems(text) {
  return BAD_SHAPES.filter(([pattern]) => pattern.test(text)).map(([, why]) => why);
}

function hasNoPlaceholder(text) {
  return !text.includes('{') && !text.includes('}');
}

// The formatting rules every rendered recipe must obey.
function isWellShaped(text) {
  return shapeProblems(text).length === 0;
}

// A deterministic "all slots set" value map straight from the recipe's options.
function fullValues(recipe) {
  const values = {};
  for (const slot of recipeSlots(recipe)) {
    values[slot] = (recipe.variables[slot] || [])[0];
  }
  return values;
}

// --- 1: recipe data shape -------------------------------------------------
function checkRecipeData() {
  console.log('\nRecipe data');
  check(
    'recipes.json holds at least one recipe',
    Array.isArray(RECIPES) && RECIPES.length > 0,
    `got ${Array.isArray(RECIPES) ? RECIPES.length : typeof RECIPES}`
  );

  RECIPES.forEach((recipe, index) => {
    const name = (recipe && recipe.name) || `recipe #${index}`;
    check(`${name}: has a non-empty name`, typeof recipe.name === 'string' && recipe.name.trim().length > 0);
    check(
      `${name}: has a non-empty description`,
      typeof recipe.description === 'string' && recipe.description.trim().length > 0
    );
    check(
      `${name}: has a template with at least one {slot}`,
      typeof recipe.template === 'string' && recipeSlots(recipe).length > 0,
      recipe.template
    );
    const slots = recipeSlots(recipe);
    const missing = slots.filter(
      (slot) => !Array.isArray(recipe.variables && recipe.variables[slot])
    );
    check(
      `${name}: every template slot has a variables list`,
      missing.length === 0,
      `missing: ${missing.join(', ') || 'none'}`
    );
    const emptyLists = slots.filter((slot) => {
      const list = recipe.variables && recipe.variables[slot];
      return !Array.isArray(list) || list.length === 0;
    });
    check(
      `${name}: every slot list is non-empty`,
      emptyLists.length === 0,
      `empty: ${emptyLists.join(', ') || 'none'}`
    );
    const blanks = slots.filter((slot) => {
      const list = (recipe.variables && recipe.variables[slot]) || [];
      return list.some((option) => typeof option !== 'string' || option.trim().length === 0);
    });
    check(
      `${name}: every option is a non-blank string`,
      blanks.length === 0,
      `slots with blanks: ${blanks.join(', ') || 'none'}`
    );
    check(`${name}: is usable in the screen`, recipeIsUsable(recipe) === true);
  });

  // slotLabel is what the slot row shows; it must never be blank.
  const blankLabels = [];
  for (const recipe of RECIPES) {
    for (const slot of recipeSlots(recipe)) {
      if (slotLabel(slot).length === 0) {
        blankLabels.push(slot);
      }
    }
  }
  check('every slot has a display label', blankLabels.length === 0, blankLabels.join(', '));
  check(
    'slotLabel humanises underscores',
    slotLabel('landscape_type') === 'Landscape type',
    slotLabel('landscape_type')
  );
}

// --- 2 & 3: rendering -----------------------------------------------------
// The values the acceptance examples use. Every one is a real option of the
// owner's Cinematic Landscape recipe, so the examples exercise the shipped data
// rather than a made-up fixture.
const ACCEPTANCE_VALUES = {
  mood: 'dramatic',
  landscape_type: 'mountain',
  style: 'cinematic',
  lighting: 'golden hour',
  color: 'vibrant',
  weather: 'stormy',
};

// The owner's eight required outputs, quoted verbatim.
const ACCEPTANCE_EXAMPLES = [
  {
    label: 'every slot set',
    missing: [],
    expected:
      'A dramatic mountain landscape in cinematic style, with golden hour and vibrant tones, stormy weather',
  },
  {
    label: '"mood" unset',
    missing: ['mood'],
    expected:
      'A mountain landscape in cinematic style, with golden hour and vibrant tones, stormy weather',
  },
  {
    label: '"style" unset',
    missing: ['style'],
    expected:
      'A dramatic mountain landscape, with golden hour and vibrant tones, stormy weather',
  },
  {
    label: '"lighting" unset',
    missing: ['lighting'],
    expected:
      'A dramatic mountain landscape in cinematic style, with vibrant tones, stormy weather',
  },
  {
    label: '"color" unset',
    missing: ['color'],
    expected:
      'A dramatic mountain landscape in cinematic style, with golden hour tones, stormy weather',
  },
  {
    label: '"weather" unset',
    missing: ['weather'],
    expected:
      'A dramatic mountain landscape in cinematic style, with golden hour and vibrant tones',
  },
  {
    label: '"landscape_type" unset',
    missing: ['landscape_type'],
    expected:
      'A dramatic landscape in cinematic style, with golden hour and vibrant tones, stormy weather',
  },
  {
    label: 'everything unset',
    missing: ['mood', 'landscape_type', 'style', 'lighting', 'color', 'weather'],
    expected: '',
  },
];

// The owner's template - the first recipe in the shipped data.
const TEMPLATE_RECIPE = RECIPES[0];

// Case-insensitive containment, because capitalising the sentence can uppercase
// the first letter of whatever value ends up first.
function containsValue(text, value) {
  return text.toLowerCase().includes(String(value).toLowerCase());
}

function valuesFor(missing) {
  const values = {};
  for (const slot of recipeSlots(TEMPLATE_RECIPE)) {
    if (!missing.includes(slot)) {
      values[slot] = ACCEPTANCE_VALUES[slot];
    }
  }
  return values;
}

function checkRendering() {
  console.log('\nRecipe rendering');

  for (const recipe of RECIPES) {
    const slots = recipeSlots(recipe);
    const values = fullValues(recipe);
    const rendered = renderRecipe(recipe, values);

    check(
      `${recipe.name}: renders a non-empty prompt with every slot set`,
      rendered.length > 0,
      rendered
    );
    check(
      `${recipe.name}: no "{slot}" survives a full render`,
      hasNoPlaceholder(rendered),
      rendered
    );
    check(
      `${recipe.name}: a full render has no double spaces or stray separators`,
      isWellShaped(rendered),
      `${shapeProblems(rendered).join(', ')} -> ${rendered}`
    );
    const allValuesPresent = slots.every((slot) => containsValue(rendered, values[slot]));
    check(
      `${recipe.name}: every chosen value appears in the render`,
      allValuesPresent,
      rendered
    );
    const clauses = rendered.split(',').map((part) => part.trim()).filter(Boolean);
    check(
      `${recipe.name}: a full render lists one clause per template clause`,
      clauses.length === recipe.template.split(',').filter((part) => part.trim()).length,
      `${clauses.length} clauses: ${rendered}`
    );

    // Leaving one slot out must take that slot's chunk (and nothing else) with
    // it: its value disappears, every other slot's value stays, and the leftover
    // sentence has no artifacts.
    for (const slot of slots) {
      const partial = { ...values };
      delete partial[slot];
      const text = renderRecipe(recipe, partial);
      const label = `${recipe.name} without "${slot}"`;
      check(`${label}: the {${slot}} placeholder is gone`, hasNoPlaceholder(text), text);
      check(
        `${label}: no double spaces or stray separators`,
        isWellShaped(text),
        `${shapeProblems(text).join(', ')} -> ${text}`
      );
      check(
        `${label}: the unset slot's own value is not in the text`,
        !containsValue(text, values[slot]),
        text
      );
      check(
        `${label}: every other slot's value survives`,
        slots.filter((other) => other !== slot).every((other) => containsValue(text, values[other])),
        text
      );
      check(
        `${label}: the first letter is capitalised and nothing dangles`,
        text === '' || /^[A-Z]/.test(text),
        text
      );
    }

    // Nothing set at all -> empty string (the screen keeps Use this prompt off).
    check(
      `${recipe.name}: an all-unset render is empty`,
      renderRecipe(recipe, {}) === '',
      JSON.stringify(renderRecipe(recipe, {}))
    );
    // Whitespace-only values behave as unset.
    const spaces = {};
    for (const slot of slots) {
      spaces[slot] = '   ';
    }
    check(
      `${recipe.name}: whitespace-only values behave as unset`,
      renderRecipe(recipe, spaces) === '',
      JSON.stringify(renderRecipe(recipe, spaces))
    );
  }

  // Synthetic templates pin the chunk rule itself, so a change in the real
  // recipe data cannot quietly hide it.

  // 1. The literal noun that names the slot goes with it; a following noun that
  // means something else stays to be modified by whatever precedes it.
  const naming = {
    template: 'a {mood} mood, {weather} weather',
    variables: { mood: ['calm'], weather: ['stormy'] },
  };
  check(
    'the noun naming its own slot is dropped with it',
    renderRecipe(naming, { mood: 'calm' }) === 'A calm mood' &&
      renderRecipe(naming, { weather: 'stormy' }) === 'Stormy weather' &&
      renderRecipe(naming, {}) === '',
    `${renderRecipe(naming, { mood: 'calm' })} | ${renderRecipe(naming, { weather: 'stormy' })}`
  );

  const otherNoun = {
    template: 'a {landscape_type} landscape in {style} style',
    variables: { landscape_type: ['mountain'], style: ['cinematic'] },
  };
  check(
    'a following noun that does not name the slot survives',
    renderRecipe(otherNoun, { style: 'cinematic' }) === 'A landscape in cinematic style' &&
      renderRecipe(otherNoun, { landscape_type: 'mountain' }) === 'A mountain landscape',
    `${renderRecipe(otherNoun, { style: 'cinematic' })} | ${renderRecipe(otherNoun, { landscape_type: 'mountain' })}`
  );

  // 2. Two slots joined by "and" in one clause: only the unset slot's chunk and
  // the conjunction go, the other slot's value stays.
  const synthetic = {
    template: 'a {a} thing, with {b} and {c} trims, {d} finish',
    variables: { a: ['red'], b: ['gold'], c: ['blue'], d: ['matte'] },
  };
  check(
    'the "and" joining two slots goes when the second slot is unset',
    renderRecipe(synthetic, { a: 'red', b: 'gold', d: 'matte' }) ===
      'A red thing, with gold trims, matte finish',
    renderRecipe(synthetic, { a: 'red', b: 'gold', d: 'matte' })
  );
  check(
    'the "and" joining two slots goes when the first slot is unset',
    renderRecipe(synthetic, { a: 'red', c: 'blue', d: 'matte' }) ===
      'A red thing, with blue trims, matte finish',
    renderRecipe(synthetic, { a: 'red', c: 'blue', d: 'matte' })
  );
  check(
    'a clause with no set slot is dropped whole, with its comma',
    renderRecipe(synthetic, { b: 'gold', c: 'blue', d: 'matte' }) ===
      'With gold and blue trims, matte finish' &&
      renderRecipe(synthetic, { a: 'red', b: 'gold', c: 'blue' }) ===
        'A red thing, with gold and blue trims',
    renderRecipe(synthetic, { b: 'gold', c: 'blue', d: 'matte' })
  );
  check(
    'an all-set synthetic render still carries every value',
    renderRecipe(synthetic, { a: 'red', b: 'gold', c: 'blue', d: 'matte' }) ===
      'A red thing, with gold and blue trims, matte finish',
    renderRecipe(synthetic, { a: 'red', b: 'gold', c: 'blue', d: 'matte' })
  );

  // Non-string and missing values are tolerated, never rendered as "undefined".
  const junk = renderRecipe(RECIPES[0], { mood: null });
  check('null values are treated as unset, not rendered', !junk.includes('null'), junk);
  check(
    'a recipe with no template renders empty',
    renderRecipe({ variables: {} }, {}) === '' && renderRecipe(null, {}) === ''
  );
}

// The screen capitalises the first letter (promptComposer's convention, so the
// prompt reads as one sentence); renderRecipe does the same, and the checks
// above compare against that same output.

// --- 3: the owner's acceptance examples ----------------------------------
// The exact outputs the owner signed off, asserted verbatim against the real
// recipe and the real option values.
function checkAcceptanceExamples() {
  console.log('\nAcceptance examples (the owner\'s template)');

  const slots = recipeSlots(TEMPLATE_RECIPE);
  const optionSets = slots.filter(
    (slot) => !(TEMPLATE_RECIPE.variables[slot] || []).includes(ACCEPTANCE_VALUES[slot])
  );
  check(
    'every acceptance value is a real option of the template recipe',
    optionSets.length === 0,
    optionSets.join(', ')
  );
  check(
    'the template recipe is the owner\'s "{mood} {landscape_type} landscape" template',
    TEMPLATE_RECIPE.template ===
      'a {mood} {landscape_type} landscape in {style} style, with {lighting} and {color} tones, {weather} weather',
    TEMPLATE_RECIPE.template
  );

  for (const { label, missing, expected } of ACCEPTANCE_EXAMPLES) {
    const text = renderRecipe(TEMPLATE_RECIPE, valuesFor(missing));
    check(
      `acceptance: ${label}`,
      text === expected,
      `got ${JSON.stringify(text)}, want ${JSON.stringify(expected)}`
    );
    check(
      `acceptance: ${label} - no artifacts`,
      text === '' ? true : isWellShaped(text) && hasNoPlaceholder(text),
      `${shapeProblems(text).join(', ')} -> ${text}`
    );
  }
}

// --- 4: every set/unset combination of the real template -----------------
// 2^6 = 64 combinations, each checked for artifacts, lost/leaked values,
// placeholder leftovers, emptiness and determinism.
function checkAllCombinations() {
  console.log('\nAll slot combinations (2^6 = 64)');

  const slots = recipeSlots(TEMPLATE_RECIPE);
  const total = 2 ** slots.length;
  check('the template exposes exactly 6 slots', slots.length === 6, slots.join(', '));

  const shapeFailures = [];
  const placeholderFailures = [];
  const lostFailures = [];
  const leakFailures = [];
  const emptyFailures = [];
  const caseFailures = [];
  const detFailures = [];

  for (let mask = 0; mask < total; mask += 1) {
    const values = {};
    const setSlots = [];
    const unsetSlots = [];
    slots.forEach((slot, index) => {
      if (mask & (1 << index)) {
        values[slot] = ACCEPTANCE_VALUES[slot];
        setSlots.push(slot);
      } else {
        unsetSlots.push(slot);
      }
    });

    const text = renderRecipe(TEMPLATE_RECIPE, values);
    const where = `mask ${mask} (${setSlots.join('+') || 'none set'}): ${JSON.stringify(text)}`;

    const problems = shapeProblems(text);
    if (problems.length > 0) {
      shapeFailures.push(`${where} -> ${problems.join(', ')}`);
    }
    if (!hasNoPlaceholder(text)) {
      placeholderFailures.push(where);
    }
    const lost = setSlots.filter((slot) => !containsValue(text, values[slot]));
    if (lost.length > 0) {
      lostFailures.push(`${where} -> lost ${lost.join(', ')}`);
    }
    const leaked = unsetSlots.filter((slot) => containsValue(text, ACCEPTANCE_VALUES[slot]));
    if (leaked.length > 0) {
      leakFailures.push(`${where} -> leaked ${leaked.join(', ')}`);
    }
    if (mask === 0 ? text !== '' : text === '') {
      emptyFailures.push(where);
    }
    if (text !== '' && !/^[A-Z]/.test(text)) {
      caseFailures.push(where);
    }
    if (renderRecipe(TEMPLATE_RECIPE, { ...values }) !== text) {
      detFailures.push(where);
    }
  }

  check(
    `all ${total} combinations have no double spaces or stray separators`,
    shapeFailures.length === 0,
    shapeFailures.slice(0, 3).join(' | ')
  );
  check(
    `no combination leaves a "{slot}" in the output`,
    placeholderFailures.length === 0,
    placeholderFailures.slice(0, 3).join(' | ')
  );
  check(
    `every set slot's value survives in all ${total} combinations`,
    lostFailures.length === 0,
    lostFailures.slice(0, 3).join(' | ')
  );
  check(
    `no unset slot's value leaks into any of the ${total} combinations`,
    leakFailures.length === 0,
    leakFailures.slice(0, 3).join(' | ')
  );
  check(
    'only the fully-unset combination renders empty',
    emptyFailures.length === 0,
    emptyFailures.slice(0, 3).join(' | ')
  );
  check(
    `every non-empty combination starts with a capital letter`,
    caseFailures.length === 0,
    caseFailures.slice(0, 3).join(' | ')
  );
  check(
    `all ${total} combinations render deterministically`,
    detFailures.length === 0,
    detFailures.slice(0, 3).join(' | ')
  );

  // The fully-unset case, spelled out.
  const noneSet = {};
  check(
    'a fully-unset template renders as the empty string',
    renderRecipe(TEMPLATE_RECIPE, noneSet) === '',
    JSON.stringify(renderRecipe(TEMPLATE_RECIPE, noneSet))
  );
  check(
    'a fully-unset template does not fall back to its literal words',
    !/landscape|weather|tones|style/i.test(renderRecipe(TEMPLATE_RECIPE, noneSet))
  );
}

// --- 5: which recipe is selected ------------------------------------------
// The screen holds an index (null = the normal builder) and derives the recipe
// through this helper, so the "recipe mode is on" decision is testable here.
function checkSelection() {
  console.log('\nRecipe selection');
  check(
    'a null index means the normal builder',
    selectedRecipe(RECIPES, null) === null
  );
  check(
    'an undefined index means the normal builder',
    selectedRecipe(RECIPES, undefined) === null
  );
  check(
    'a valid index returns that recipe',
    selectedRecipe(RECIPES, 0) === RECIPES[0]
  );
  check(
    'an out-of-range index falls back to the normal builder',
    selectedRecipe(RECIPES, 99) === null
  );
  check(
    'a non-array recipe list falls back to the normal builder',
    selectedRecipe(null, 0) === null
  );
}

// --- 6: rolling -----------------------------------------------------------
function checkRolling() {
  console.log('\nRoll all');

  for (const recipe of RECIPES) {
    const slots = recipeSlots(recipe);
    let fromOwnList = true;
    let firstBad = null;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const rolled = rollRecipe(recipe);
      for (const slot of slots) {
        if (!recipe.variables[slot].includes(rolled[slot])) {
          fromOwnList = false;
          firstBad = firstBad || `${slot}=${JSON.stringify(rolled[slot])}`;
        }
      }
    }
    check(
      `${recipe.name}: 300 rolls always fill every slot from that slot's own list`,
      fromOwnList,
      firstBad || undefined
    );
    check(
      `${recipe.name}: a roll fills every slot`,
      Object.keys(rollRecipe(recipe)).sort().join(',') === [...slots].sort().join(','),
      JSON.stringify(rollRecipe(recipe))
    );

    const firsts = rollRecipe(recipe, () => 0);
    check(
      `${recipe.name}: an injected rng of 0 picks the first option of every slot`,
      slots.every((slot) => firsts[slot] === recipe.variables[slot][0]),
      JSON.stringify(firsts)
    );

    const rolled = rollRecipe(recipe, () => 0.999);
    check(
      `${recipe.name}: a rolled recipe renders to a full prompt`,
      renderRecipe(recipe, rolled).length > 0 &&
        hasNoPlaceholder(renderRecipe(recipe, rolled)),
      renderRecipe(recipe, rolled)
    );
  }
}

// --- 7: determinism -------------------------------------------------------
function checkDeterminism() {
  console.log('\nDeterminism');

  for (const recipe of RECIPES) {
    const values = fullValues(recipe);
    const first = renderRecipe(recipe, values);
    const second = renderRecipe(recipe, { ...values });
    check(`${recipe.name}: the same values render byte-identical text`, first === second, first);
    check(
      `${recipe.name}: rendering does not mutate the values object`,
      JSON.stringify(values) === JSON.stringify(fullValues(recipe))
    );
  }

  const combo = rollRecipe(RECIPES[0], () => 0.4);
  const a = renderRecipe(RECIPES[0], combo);
  const b = renderRecipe(RECIPES[0], { ...combo });
  check('a rolled recipe renders deterministically', a === b, a);

  check(
    'recipeSlots is stable and de-duplicated, in template order',
    JSON.stringify(recipeSlots(RECIPES[0])) ===
      JSON.stringify(recipeSlots({ ...RECIPES[0], template: RECIPES[0].template }))
  );
}

// --- 8: appendPreset ------------------------------------------------------
function checkAppendPreset() {
  console.log('\nappendPreset');

  const first = appendPreset('', 'text, watermark, logo');
  check(
    'an empty field takes the whole preset',
    first.text === 'text, watermark, logo' && first.added.length === 3,
    JSON.stringify(first)
  );

  const kept = appendPreset('my own thing, text', 'text, watermark, logo');
  check(
    'the owner\'s own text is never lost',
    kept.text.startsWith('my own thing, text'),
    kept.text
  );
  check(
    'terms already present are not added again',
    !kept.added.includes('text') && kept.added.join(',') === 'watermark,logo',
    JSON.stringify(kept)
  );
  check(
    'a term already present is not duplicated in the text',
    parseTerms(kept.text).filter((term) => term === 'text').length === 1,
    kept.text
  );

  const caseInsensitive = appendPreset('Watermark', 'watermark, LOGO');
  check(
    'duplicate detection is case-insensitive',
    caseInsensitive.added.join(',') === 'LOGO',
    JSON.stringify(caseInsensitive)
  );
  check(
    'the owner\'s casing is preserved',
    caseInsensitive.text.startsWith('Watermark'),
    caseInsensitive.text
  );

  const repeated = appendPreset('text, watermark, logo', 'text, watermark, logo');
  check(
    'tapping the same preset twice adds nothing the second time',
    repeated.added.length === 0 && repeated.text === 'text, watermark, logo',
    JSON.stringify(repeated)
  );

  const blanks = appendPreset('keep me', '  ,   , ');
  check(
    'a preset of blanks (or the None entry) is ignored',
    blanks.text === 'keep me' && blanks.added.length === 0,
    JSON.stringify(blanks)
  );
  check(
    'a blank terms string is ignored',
    appendPreset('keep me', '').text === 'keep me'
  );
  check(
    'a null current field is handled',
    appendPreset(null, 'a, b').text === 'a, b',
    appendPreset(null, 'a, b').text
  );

  const trimmed = appendPreset('  a ,, b  ', 'c');
  check(
    'blank entries in the current text are trimmed out',
    trimmed.text === 'a, b, c',
    trimmed.text
  );

  check('clearPresetText() is the empty string', clearPresetText() === '');

  // Building up a real sequence must never lose a term or duplicate one.
  const sequence = ['busy background, clutter', 'clutter, text, watermark', 'text, logo'];
  let accumulated = '';
  for (const terms of sequence) {
    accumulated = appendPreset(accumulated, terms).text;
  }
  const terms = parseTerms(accumulated).map((term) => term.toLowerCase());
  check(
    'a run of appends keeps every term exactly once',
    terms.length === new Set(terms).size &&
      ['busy background', 'clutter', 'text', 'watermark', 'logo'].every((term) =>
        terms.includes(term)
      ),
    accumulated
  );
}

// --- 9: preset data -------------------------------------------------------
function checkPresetData() {
  console.log('\nNegative preset data');
  const presets = PRESET_DATA.presets;
  check('negativePresets.json holds a non-empty presets list', Array.isArray(presets) && presets.length > 0);

  check(
    'every preset has a non-empty id and label',
    presets.every(
      (preset) =>
        typeof preset.id === 'string' &&
        preset.id.trim().length > 0 &&
        typeof preset.label === 'string' &&
        preset.label.trim().length > 0
    ),
    presets.map((preset) => preset.id).join(', ')
  );

  const ids = presets.map((preset) => preset.id);
  check('preset ids are unique', ids.length === new Set(ids).size, ids.join(', '));

  const noneEntries = presets.filter((preset) => preset.id === 'none');
  check('there is exactly one blank "none" entry', noneEntries.length === 1);
  check(
    'the "none" entry has blank terms',
    noneEntries.length === 1 && String(noneEntries[0].terms || '').trim() === '',
    noneEntries.length === 1 ? JSON.stringify(noneEntries[0].terms) : 'missing'
  );

  const emptyTerms = presets.filter(
    (preset) => preset.id !== 'none' && String(preset.terms || '').trim() === ''
  );
  check(
    'every preset except "none" has non-empty terms',
    emptyTerms.length === 0,
    emptyTerms.map((preset) => preset.id).join(', ')
  );

  const emptyDescriptions = presets.filter(
    (preset) => typeof preset.description !== 'string' || preset.description.trim() === ''
  );
  check(
    'every preset has a description for its accessibility hint',
    emptyDescriptions.length === 0,
    emptyDescriptions.map((preset) => preset.id).join(', ')
  );

  // Every non-blank preset must actually do something when appended.
  const inert = presets
    .filter((preset) => preset.id !== 'none')
    .filter((preset) => appendPreset('', preset.terms).added.length === 0);
  check(
    'every non-blank preset appends at least one term to an empty field',
    inert.length === 0,
    inert.map((preset) => preset.id).join(', ')
  );
}

// --- 10: the live example --------------------------------------------------
// The rendered Cinematic Landscape recipe for the report's sanity check.
function showExample() {
  console.log('\nExample (Cinematic Landscape, all slots set to first options)');
  const recipe = RECIPES.find((item) => /cinematic/i.test(item.name)) || RECIPES[0];
  const values = fullValues(recipe);
  console.log(`  ${recipe.name}`);
  console.log(`  values: ${JSON.stringify(values)}`);
  console.log(`  -> ${renderRecipe(recipe, values)}`);
  const partial = { ...values };
  delete partial.weather;
  console.log(`  without weather -> ${renderRecipe(recipe, partial)}`);
}

(async () => {
  try {
    checkRecipeData();
    checkRendering();
    checkAcceptanceExamples();
    checkAllCombinations();
    checkSelection();
    checkRolling();
    checkDeterminism();
    checkAppendPreset();
    checkPresetData();
    showExample();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
