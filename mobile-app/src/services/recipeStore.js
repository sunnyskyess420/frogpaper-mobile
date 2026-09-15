/**
 * The owner's own recipes, and which recipes they have starred.
 *
 * Both lists live only on this phone (AsyncStorage) - nothing is sent anywhere.
 * A saved recipe is a snapshot of a finished prompt, so it behaves in the Build
 * screen exactly like a built-in recipe that happens to have no slots left to
 * fill in.
 *
 * Everything here is written to be safe to call at any time: a missing or
 * damaged store resets to empty instead of throwing, and a failed write is
 * swallowed so the screen around it keeps working.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const RECIPES_KEY = '@frogpaper/userRecipes';
export const RECIPE_FAVOURITES_KEY = '@frogpaper/recipeFavourites';

// Enough to keep a lifetime of good prompts without letting the list grow
// without bound (the whole list is rewritten on every save).
export const USER_RECIPE_LIMIT = 40;
export const FAVOURITE_LIMIT = 40;

const NAME_LIMIT = 60;
const DESCRIPTION_LIMIT = 120;
const PROMPT_LIMIT = 2000;
const NEGATIVE_LIMIT = 2000;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shorten(value, limit) {
  const text = clean(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}\u2026` : text;
}

function stamp(item) {
  return item && typeof item === 'object' ? String(item.savedAt || '') : '';
}

// Newest first, with anything missing a timestamp pushed to the end. Saves are
// stamped by the caller so the check script can drive the order deterministically.
function newestFirst(list) {
  return [...list].sort((a, b) => {
    const left = stamp(a);
    const right = stamp(b);
    if (left === right) {
      return 0;
    }
    if (!left) {
      return 1;
    }
    if (!right) {
      return -1;
    }
    return left < right ? 1 : -1;
  });
}

async function readList(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item != null) : [];
  } catch (error) {
    // Corrupt or unreadable: start clean rather than break the screen.
    return [];
  }
}

async function writeList(key, list) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list));
    return true;
  } catch (error) {
    // A full or unavailable store must never take the screen down with it.
    return false;
  }
}

function sameName(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

/**
 * Called once at app start so the first read is cheap. Never throws.
 */
export async function initRecipeStore() {
  await listUserRecipes();
  await listFavouriteRecipes();
  return true;
}

/**
 * The owner's saved recipes, newest first.
 */
export async function listUserRecipes() {
  const list = await readList(RECIPES_KEY);
  return newestFirst(list.filter((item) => item && clean(item.name) && clean(item.prompt)));
}

/**
 * Save the current build as a recipe.
 *
 * Returns { ok, reason, recipe }. Saving with a name that already exists
 * replaces that recipe instead of creating a second copy.
 */
export async function saveUserRecipe({ name, description, prompt, negative } = {}) {
  const safeName = shorten(name, NAME_LIMIT);
  const safePrompt = shorten(prompt, PROMPT_LIMIT);
  if (!safeName) {
    return { ok: false, reason: 'name', message: 'Give your recipe a name first.' };
  }
  if (!safePrompt) {
    return {
      ok: false,
      reason: 'prompt',
      message: 'There is nothing to save yet - pick a few options first.',
    };
  }

  const recipe = {
    name: safeName,
    description: shorten(description, DESCRIPTION_LIMIT),
    prompt: safePrompt,
    negative: shorten(negative, NEGATIVE_LIMIT),
    savedAt: new Date().toISOString(),
  };

  const current = await readList(RECIPES_KEY);
  const kept = current.filter((item) => item && !sameName(item.name, safeName));
  const next = [recipe, ...kept].slice(0, USER_RECIPE_LIMIT);
  const stored = await writeList(RECIPES_KEY, next);
  if (!stored) {
    return { ok: false, reason: 'storage', message: 'Could not save that recipe on this phone.' };
  }
  return { ok: true, recipe };
}

/**
 * Remove one of the owner's recipes. Built-in recipes are not stored here, so
 * they can never be deleted by this.
 */
export async function deleteUserRecipe(name) {
  const current = await readList(RECIPES_KEY);
  const next = current.filter((item) => item && !sameName(item.name, name));
  const stored = await writeList(RECIPES_KEY, next);
  return stored && next.length !== current.length;
}

/**
 * Recipe names the owner has starred, newest first.
 */
export async function listFavouriteRecipes() {
  const list = await readList(RECIPE_FAVOURITES_KEY);
  return list.filter((item) => typeof item === 'string' && clean(item)).map(clean);
}

export async function isFavouriteRecipe(name) {
  const list = await listFavouriteRecipes();
  return list.some((item) => sameName(item, name));
}

/**
 * Star or un-star a recipe. Returns the new favourite list.
 */
export async function toggleFavouriteRecipe(name) {
  const safeName = clean(name);
  if (!safeName) {
    return [];
  }
  const current = await listFavouriteRecipes();
  const already = current.some((item) => sameName(item, safeName));
  const next = already
    ? current.filter((item) => !sameName(item, safeName))
    : [safeName, ...current].slice(0, FAVOURITE_LIMIT);
  await writeList(RECIPE_FAVOURITES_KEY, next);
  return next;
}

/**
 * Turn a saved recipe into the shape the composer already understands: a
 * template with no slots left to fill in.
 */
export function toComposerRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    return null;
  }
  return {
    name: clean(recipe.name),
    description: clean(recipe.description),
    template: clean(recipe.prompt),
    variables: {},
    negative: clean(recipe.negative),
  };
}

/**
 * The saved recipes as composer recipes, newest first.
 */
export async function listComposerRecipes() {
  const list = await listUserRecipes();
  return list.map(toComposerRecipe).filter(Boolean);
}
