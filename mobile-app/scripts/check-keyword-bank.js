#!/usr/bin/env node
/**
 * check-keyword-bank.js - headless verification of the merged Build word lists.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-keyword-bank.js
 * or via the npm script:
 *     npm run check:keywords
 *
 * Proves, with no device and no network:
 *   1. the bank data is present, shaped right and free of blanks
 *   2. merging keeps the app's own words first, in their original order
 *   3. repeats (including different letter cases) are dropped
 *   4. the cap is respected and nothing overflows past it
 *   5. the extra words really did arrive (subjects, moods, atmospheres...)
 *   6. subject aliases expand, and unknown subjects fall back to nothing
 *   7. the data file itself stays JSON-clean and free of the two lists we
 *      deliberately left on the desktop
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

const bankPath = path.join(ROOT, 'src/data/keywordBank.json');
const BANK = require(bankPath);
const options = require('../src/data/promptOptions');
const kb = require(path.join(ROOT, 'src/services/keywordBank.js'));

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

function lower(list) {
  return list.map((item) => String(item).trim().toLowerCase());
}

function main() {
  console.log('keyword bank');

  // 1. the data
  const listKeys = ['subjects', 'styles', 'mood', 'colors', 'lighting', 'atmosphere', 'composition', 'prompt_boosters', 'avoid'];
  listKeys.forEach((key) => {
    const value = BANK[key];
    check(`${key} is a non-empty list`, Array.isArray(value) && value.length > 0, `${Array.isArray(value) ? value.length : typeof value}`);
    if (Array.isArray(value)) {
      check(`${key} has no blanks`, value.every((item) => typeof item === 'string' && item.trim().length > 0));
      check(`${key} has no repeats`, lower(value).length === new Set(lower(value)).size);
    }
  });
  check('subject aliases are a map', BANK.SUBJECT_ALIASES && typeof BANK.SUBJECT_ALIASES === 'object');
  check('the desktop-only element lists were left behind', !BANK.tech_elements && !BANK.weed_elements);
  check('the file says where the words came from', typeof BANK._comment === 'string' && BANK._comment.length > 20);

  // 2. the app's own words come first
  check('subjects keep the app words first', kb.SUBJECT_OPTIONS[0] === options.SUBJECTS[0], kb.SUBJECT_OPTIONS[0]);
  check('styles keep the app words first', kb.STYLE_OPTIONS[0] === options.STYLES[0], kb.STYLE_OPTIONS[0]);
  check('moods keep the app words first', kb.MOOD_OPTIONS[0] === options.MOODS[0], kb.MOOD_OPTIONS[0]);
  check('atmospheres keep the app words first', kb.ATMOSPHERE_OPTIONS[0] === options.ATMOSPHERES[0], kb.ATMOSPHERE_OPTIONS[0]);
  check('lighting keeps the app words first', kb.LIGHTING_OPTIONS[0] === options.LIGHTING[0], kb.LIGHTING_OPTIONS[0]);

  const appWordsSurvive = options.SUBJECTS.every((word) => lower(kb.SUBJECT_OPTIONS).includes(word.toLowerCase()));
  check('every app subject survives the merge', appWordsSurvive);
  check('the app order is preserved', lower(kb.SUBJECT_OPTIONS).slice(0, options.SUBJECTS.length).join('|') === lower(options.SUBJECTS).join('|'));

  // 3. no repeats after merging
  ['SUBJECT_OPTIONS', 'STYLE_OPTIONS', 'MOOD_OPTIONS', 'ATMOSPHERE_OPTIONS', 'LIGHTING_OPTIONS'].forEach((name) => {
    const list = kb[name];
    check(`${name} has no repeats`, lower(list).length === new Set(lower(list)).size, `${list.length} entries`);
  });

  // 4. the cap
  ['SUBJECT_OPTIONS', 'STYLE_OPTIONS', 'MOOD_OPTIONS', 'ATMOSPHERE_OPTIONS', 'LIGHTING_OPTIONS'].forEach((name) => {
    check(`${name} stays within the cap`, kb[name].length <= kb.MAX_OPTIONS, `${kb[name].length}`);
  });
  const long = kb.mergeOptions(['a', 'b'], Array.from({ length: 100 }, (_, i) => `word ${i}`), 10);
  check('the cap is enforced while merging', long.length === 10, `${long.length}`);
  check('a merged list never has a blank', long.every((item) => item.trim().length > 0));

  // 5. the extras arrived
  check('subjects gained words', kb.SUBJECT_OPTIONS.length > options.SUBJECTS.length, `${options.SUBJECTS.length} -> ${kb.SUBJECT_OPTIONS.length}`);
  check('moods gained words', kb.MOOD_OPTIONS.length > options.MOODS.length, `${options.MOODS.length} -> ${kb.MOOD_OPTIONS.length}`);
  check('atmospheres gained words', kb.ATMOSPHERE_OPTIONS.length > options.ATMOSPHERES.length, `${options.ATMOSPHERES.length} -> ${kb.ATMOSPHERE_OPTIONS.length}`);
  check('lighting gained words', kb.LIGHTING_OPTIONS.length > options.LIGHTING.length, `${options.LIGHTING.length} -> ${kb.LIGHTING_OPTIONS.length}`);
  check('a bank-only subject is offered', lower(kb.SUBJECT_OPTIONS).includes('glowing frog'), lower(kb.SUBJECT_OPTIONS).slice(-5).join(' | '));
  check('colours are carried over', kb.COLOR_OPTIONS.length > 0, `${kb.COLOR_OPTIONS.length}`);
  check('composition notes are carried over', kb.COMPOSITION_OPTIONS.length > 0, `${kb.COMPOSITION_OPTIONS.length}`);
  check('prompt boosters are carried over', kb.PROMPT_BOOSTERS.length > 0, `${kb.PROMPT_BOOSTERS.length}`);
  check('an extra avoid list is carried over', kb.BANK_AVOID.length > 0, `${kb.BANK_AVOID.length}`);
  check('the extra count is positive', kb.bankExtraCount() > 0, `${kb.bankExtraCount()}`);

  // 6. aliases
  check('a known subject expands', kb.expandSubject('tree frog') === 'detailed tree frog on branch', kb.expandSubject('tree frog'));
  check('expanding ignores case', kb.expandSubject('Tree Frog') === 'detailed tree frog on branch', kb.expandSubject('Tree Frog'));
  check('an unknown subject gives nothing', kb.expandSubject('a subject that does not exist') === '');
  check('an empty subject gives nothing', kb.expandSubject('') === '');
  check('a null subject gives nothing', kb.expandSubject(null) === '');
  const aliasKeys = Object.keys(BANK.SUBJECT_ALIASES);
  check('every alias key is a real subject', aliasKeys.every((name) => lower(BANK.subjects).includes(name.toLowerCase())), aliasKeys.join(', '));
  check('every alias value is a phrase', aliasKeys.every((name) => String(BANK.SUBJECT_ALIASES[name]).trim().split(/\s+/).length >= 3));

  // 7. the colour row reaches the prompt
  const composer = require(path.join(ROOT, 'src/services/promptComposer.js'));
  const withColour = composer.composeSelection({ subject: 'frog', color: 'neon purple' }).prompt;
  check('a chosen colour reaches the prompt', withColour.includes('neon purple tones'), withColour);
  const colourLater = composer.composeSelection({ subject: 'frog', lighting: 'golden hour', color: 'acid green', mood: 'cozy' }).prompt;
  check('the colour sits with the light', colourLater.indexOf('acid green tones') > colourLater.indexOf('golden hour lighting') && colourLater.indexOf('cozy mood') > colourLater.indexOf('acid green tones'), colourLater);
  check('no colour means no colour clause', !composer.composeSelection({ subject: 'frog' }).prompt.includes('tones'), composer.composeSelection({ subject: 'frog' }).prompt);
  const emptyColour = composer.composeSelection({ subject: 'frog', color: '   ' }).prompt;
  check('whitespace is not a colour', emptyColour === composer.composeSelection({ subject: 'frog' }).prompt, emptyColour);
  const modedColour = composer.composeSelection({ mode: 'Cinematic', subject: 'frog', color: 'midnight black' }).prompt;
  check('a colour works with a mode too', modedColour.includes('midnight black tones'), modedColour);
  const draw = composer.randomCombo(() => 0.99);
  check('randomise offers a colour', kb.COLOR_OPTIONS.includes(draw.color), String(draw.color));
  check('every row uses an enriched list', [
    kb.SUBJECT_OPTIONS.includes(draw.subject),
    kb.STYLE_OPTIONS.includes(draw.style),
    kb.MOOD_OPTIONS.includes(draw.mood),
    kb.ATMOSPHERE_OPTIONS.includes(draw.atmosphere),
    kb.LIGHTING_OPTIONS.includes(draw.lighting),
  ].every(Boolean), JSON.stringify(draw));
  check('randomise fills every row', Object.keys(draw).sort().join(',') === 'atmosphere,color,lighting,mode,mood,setting,style,subject', Object.keys(draw).sort().join(','));

  // 8. the unattended daily wallpaper prompt
  const surprise = composer.surprisePrompt(() => 0.5);
  check('a surprise prompt is produced', typeof surprise === 'string' && surprise.length > 20, surprise);
  check('it asks for a vertical phone wallpaper', surprise.toLowerCase().endsWith(composer.WALLPAPER_TAIL.toLowerCase()), surprise);
  check('it is one line', !surprise.includes('\n'), JSON.stringify(surprise));
  check('it is deterministic for a given draw', composer.surprisePrompt(() => 0.5) === surprise);
  const otherDraw = composer.surprisePrompt(() => 0.1);
  check('a different draw gives a different prompt', otherDraw !== surprise, otherDraw);
  check('the surprise prompt never asks for a white background', !surprise.toLowerCase().includes('white background'), surprise);
  const manyDraws = Array.from({ length: 200 }, (_, i) => composer.surprisePrompt(() => (i % 100) / 100));
  check('no draw asks for a white background', manyDraws.every((text) => !text.toLowerCase().includes('white background')));
  check('every draw ends with the vertical phone cue', manyDraws.every((text) => text.toLowerCase().endsWith(composer.WALLPAPER_TAIL.toLowerCase())));
  check('every draw has real words', manyDraws.every((text) => text.split(/\s+/).length >= 6));

  const guard = composer.SURPRISE_NEGATIVE;
  check('the guard is a non-empty string', typeof guard === 'string' && guard.length > 20, `${guard && guard.length}`);
  check('the guard fits the soft-append limit', guard.length <= 400, `${guard.length} chars`);
  ['text', 'watermark', 'phone', 'mockup', 'background'].forEach((word) => {
    check(`the guard rules out ${word}`, guard.toLowerCase().includes(word), guard);
  });

  // The daily run must actually use both of them - a regression guard, since the
  // old code silently drew from the IDEAS list with no negative at all.
  const dailySource = fs.readFileSync(path.join(ROOT, 'src/services/dailyWallpaper.js'), 'utf8');
  check('the daily run composes its own prompt', dailySource.includes('surprisePrompt'));
  check('the daily run sends the guard', dailySource.includes('SURPRISE_NEGATIVE'));
  check('the daily run no longer draws from the old idea list', !dailySource.includes('IDEAS'));

  // 9. the rewritten idea list
  const library = require(path.join(ROOT, 'src/services/promptLibrary.js'));
  check('the idea list has entries', Array.isArray(library.IDEAS) && library.IDEAS.length >= 10, `${library.IDEAS.length}`);
  check('no idea asks for a white background', library.IDEAS.every((idea) => !idea.toLowerCase().includes('white background')));
  check('no idea is blank', library.IDEAS.every((idea) => typeof idea === 'string' && idea.trim().length > 10));
  check('the ideas lead with frogs', library.IDEAS.slice(0, 8).some((idea) => idea.toLowerCase().includes('frog')), library.IDEAS[0]);

  // 10. merge behaviour on its own
  check('merging nothing gives nothing', kb.mergeOptions([], []).length === 0);
  check('merging tolerates junk', kb.mergeOptions([null, '', '  ', 'x'], [undefined, 'y']).join(',') === 'x,y', kb.mergeOptions([null, '', '  ', 'x'], [undefined, 'y']).join(','));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
