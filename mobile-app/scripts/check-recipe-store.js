#!/usr/bin/env node
/**
 * check-recipe-store.js - headless verification of the owner's saved recipes.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-recipe-store.js
 * or via the npm script:
 *     npm run check:recipelib
 *
 * Proves, with no device and no network:
 *   1. a saved recipe keeps its prompt and negative
 *   2. newest first ordering
 *   3. the same name (any letter case) replaces instead of duplicating
 *   4. empty names and empty prompts are refused without throwing
 *   5. the 40-recipe cap drops the oldest
 *   6. starring, un-starring and favourite ordering
 *   7. deleting removes only that recipe
 *   8. damaged storage resets to empty and stays usable
 *   9. a failed write never propagates
 *  10. a saved recipe survives the real composer: renderRecipe gives the stored
 *      prompt back and recipeSlots finds nothing left to fill in
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

// --- in-memory AsyncStorage ------------------------------------------------
const store = new Map();
let failWrites = false;

const asyncStorageStub = {
  __esModule: true,
  default: {
    async getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async setItem(key, value) {
      if (failWrites) {
        throw new Error('storage full');
      }
      store.set(key, value);
    },
    async removeItem(key) {
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

// --- transpile the app's ESM on the fly ------------------------------------
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

const storePath = path.join(ROOT, 'src/services/recipeStore.js');
const composerPath = path.join(ROOT, 'src/services/recipeComposer.js');
const lib = require(storePath);
const composer = require(composerPath);
const BUILT_IN = require(path.join(ROOT, 'src/data/recipes.json'));

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

async function reset() {
  store.clear();
  failWrites = false;
  await lib.initRecipeStore();
}

async function main() {
  console.log('saved recipes');

  // 1. save then read back
  await reset();
  const first = await lib.saveUserRecipe({
    name: 'Golden ocean',
    description: 'Cinematic ocean at golden hour',
    prompt: 'A mysterious ocean landscape in cinematic style, with golden hour',
    negative: 'No text, no watermark',
  });
  check('save reports ok', first.ok === true, JSON.stringify(first));
  const listed = await lib.listUserRecipes();
  check('the recipe is listed', listed.length === 1, `${listed.length}`);
  check('the prompt survives', listed[0].prompt === first.recipe.prompt);
  check('the negative survives', listed[0].negative === 'No text, no watermark');
  check('the name survives', listed[0].name === 'Golden ocean');
  check('a save is stamped', !Number.isNaN(Date.parse(listed[0].savedAt)), listed[0].savedAt);

  // 2. newest first
  await lib.saveUserRecipe({ name: 'B', prompt: 'b prompt', savedAt: '2026-01-02T00:00:00.000Z' });
  await lib.saveUserRecipe({ name: 'C', prompt: 'c prompt' });
  const ordered = await lib.listUserRecipes();
  check('newest first', ordered[0].name === 'C', ordered.map((r) => r.name).join(' | '));

  // 3. duplicate names
  await reset();
  await lib.saveUserRecipe({ name: 'Evening', prompt: 'evening prompt' });
  await lib.saveUserRecipe({ name: 'evening', prompt: 'evening prompt two' });
  const deduped = await lib.listUserRecipes();
  check('same name replaces, case-insensitively', deduped.length === 1, `${deduped.length}`);
  check('the newer prompt wins', deduped[0].prompt === 'evening prompt two', deduped[0].prompt);

  // 4. refusals
  const noName = await lib.saveUserRecipe({ name: '   ', prompt: 'a prompt' });
  check('an empty name is refused', noName.ok === false && noName.reason === 'name');
  check('a refusal explains itself', typeof noName.message === 'string' && noName.message.length > 0);
  const noPrompt = await lib.saveUserRecipe({ name: 'Nameless', prompt: '' });
  check('an empty prompt is refused', noPrompt.ok === false && noPrompt.reason === 'prompt');
  check('nothing was stored by a refusal', (await lib.listUserRecipes()).length === 1);

  // 5. the cap
  await reset();
  for (let i = 0; i < 45; i += 1) {
    await lib.saveUserRecipe({ name: `recipe ${i}`, prompt: `prompt ${i}`, savedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` });
  }
  const capped = await lib.listUserRecipes();
  check('caps at 40', capped.length === lib.USER_RECIPE_LIMIT, `${capped.length}`);
  check('the oldest is dropped', capped[capped.length - 1].name === 'recipe 5', capped[capped.length - 1].name);

  // 6. favourites
  await reset();
  await lib.saveUserRecipe({ name: 'One', prompt: 'one prompt' });
  await lib.saveUserRecipe({ name: 'Two', prompt: 'two prompt' });
  check('nothing is starred to start', (await lib.listFavouriteRecipes()).length === 0);
  await lib.toggleFavouriteRecipe('Two');
  await lib.toggleFavouriteRecipe('One');
  const favourites = await lib.listFavouriteRecipes();
  check('starring sticks', favourites.length === 2, `${favourites.length}`);
  check('newest star first', favourites[0] === 'One', favourites.join(' | '));
  check('isFavouriteRecipe ignores case', (await lib.isFavouriteRecipe('two')) === true);
  await lib.toggleFavouriteRecipe('One');
  const afterUnstar = await lib.listFavouriteRecipes();
  check('un-starring removes it', afterUnstar.length === 1 && afterUnstar[0] === 'Two', afterUnstar.join(' | '));

  // 7. deleting
  await lib.saveUserRecipe({ name: 'Keep me', prompt: 'keep' });
  await lib.deleteUserRecipe('two');
  const afterDelete = await lib.listUserRecipes();
  check('delete removes only the named recipe', afterDelete.length === 2, `${afterDelete.length}`);
  check('the other recipe is untouched', afterDelete.some((r) => r.name === 'Keep me'));
  await lib.deleteUserRecipe('Keep me');
  const afterDelete2 = await lib.listUserRecipes();
  check('the named recipe is gone', !afterDelete2.some((r) => r.name === 'Keep me'), afterDelete2.map((r) => r.name).join(' | '));
  check('a built-in recipe name is never stored, so it cannot be deleted', !(await lib.listUserRecipes()).some((r) => r.name === BUILT_IN[0].name));

  // 8. damaged storage
  store.set(lib.RECIPES_KEY, '{ not json at all');
  check('damaged recipes reset to empty', (await lib.listUserRecipes()).length === 0);
  store.set(lib.RECIPES_KEY, JSON.stringify({ nope: true }));
  check('a non-array store also resets', (await lib.listUserRecipes()).length === 0);
  store.set(lib.RECIPE_FAVOURITES_KEY, 'broken');
  check('damaged favourites reset to empty', (await lib.listFavouriteRecipes()).length === 0);
  await lib.saveUserRecipe({ name: 'After damage', prompt: 'still works' });
  check('still usable after damage', (await lib.listUserRecipes()).length === 1);

  // 9. failing writes
  failWrites = true;
  let threw = false;
  let refused = null;
  try {
    refused = await lib.saveUserRecipe({ name: 'No room', prompt: 'no room prompt' });
  } catch (error) {
    threw = true;
  }
  let starThrew = false;
  try {
    await lib.toggleFavouriteRecipe('No room');
  } catch (error) {
    starThrew = true;
  }
  failWrites = false;
  check('a failed save never throws', !threw);
  check('a failed save reports storage trouble', refused && refused.ok === false, JSON.stringify(refused));
  check('a failed star never throws', !starThrew);

  // 10. through the real composer
  await reset();
  await lib.saveUserRecipe({
    name: 'Ocean evening',
    description: 'Saved from the builder',
    prompt: 'A mysterious ocean landscape in cinematic style, with golden hour and warm tones',
    negative: 'No text',
  });
  const [saved] = await lib.listComposerRecipes();
  check('the composer shape has a template', typeof saved.template === 'string' && saved.template.length > 0);
  check('the composer shape has no slots', Object.keys(saved.variables).length === 0);

  const slots = composer.recipeSlots(saved);
  check('recipeSlots finds nothing to fill in', Array.isArray(slots) && slots.length === 0, `${slots && slots.length}`);

  const rendered = composer.renderRecipe(saved);
  const normalise = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  check(
    'the stored prompt comes back unchanged',
    normalise(rendered) === normalise(saved.template),
    `got "${rendered}"`
  );

  const combined = [...BUILT_IN.map((recipe) => ({ ...recipe })), saved];
  check('the built-in recipe resolves by index 0', composer.selectedRecipe(combined, 0) === combined[0]);
  check('the saved recipe resolves by index 1', composer.selectedRecipe(combined, 1) === combined[1]);
  check('an out of range index gives nothing', !composer.selectedRecipe(combined, 99));

  const rolled = composer.rollRecipe(saved, () => 0.5);
  check('rolling a saved recipe leaves it alone', Object.keys(rolled).length === 0);
  // A saved recipe is a finished prompt: there is nothing left to roll, and
  // recipeIsUsable reports exactly that (which is why the screen shows its
  // roll button as unavailable).
  check('a saved recipe has nothing to roll', composer.recipeIsUsable(saved) === false);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('check crashed:', error);
  process.exit(1);
});
