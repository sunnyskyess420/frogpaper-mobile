// Turns a saved desktop recipe (src/data/recipes.json) into a prompt sentence.
//
// A recipe is { name, description, template, variables }, where the template
// carries "{slot}" placeholders and variables maps each slot to its option list.
// This is the mobile port of the desktop app's "pre-loaded variables".
//
// Pure and deterministic on purpose, like promptComposer: the same recipe and
// the same values must always render the same text (the check script asserts
// this), and the only randomness lives in rollRecipe() behind the Roll all
// button. Nothing here touches the network - the recipe data ships in the bundle.

// A value counts as set only when it is a non-empty string once trimmed, so
// null/undefined/whitespace all behave as "not chosen".
function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function capitalise(sentence) {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// Literal words that only glue a phrase together. When the slot they
// introduced is taken out, one left dangling at the end of a clause goes with
// it ("... landscape in" -> "... landscape") instead of stranding a
// preposition. Chosen values are never treated as connectors.
const CONNECTORS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on',
  'or', 'over', 'the', 'to', 'under', 'with',
]);

// "landscape_type" and "Landscape type" compare equal, and surrounding
// punctuation is ignored, so the literal word after a slot can be tested
// against the slot's own name.
function wordKey(text) {
  return clean(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// A clause as an ordered list of tokens: {slot} placeholders and literal words.
function tokenise(clause) {
  const tokens = [];
  const pattern = /\{([^{}]+)\}|[^\s{}]+/g;
  let match;
  while ((match = pattern.exec(clause)) !== null) {
    if (match[1] === undefined) {
      tokens.push({ word: match[0] });
    } else {
      tokens.push({ slot: match[1].trim() });
    }
  }
  return tokens;
}

// Renders one comma-separated clause, taking out only the chunks that belong to
// unset slots and leaving the rest of the phrase untouched.
//
// A slot's chunk is its placeholder plus the literal word right after it when
// that word repeats the slot's own name ("{style} style", "{weather} weather") -
// the noun exists only to name the slot, so it goes too. A following word that
// means something else ("{color} tones") still has a noun of its own to modify,
// so it stays. The conjunction that joined the slot to its neighbour ("with
// {lighting} and {color}") has nothing left to join, so it is removed as well.
//
// A clause where no slot is set at all is dropped entirely: the leftover
// literals are the slots' own nouns, so keeping them would leave an orphan
// fragment ("a landscape in"). A clause with no slots at all is literal text
// and is kept as-is.
function renderClause(clause, values) {
  const tokens = tokenise(clause);
  const filled = (slot) => clean(values[slot]);
  const slotTokens = tokens.filter((token) => token.slot);

  if (slotTokens.length > 0 && !slotTokens.some((token) => filled(token.slot))) {
    return '';
  }

  const drop = new Set();
  tokens.forEach((token, index) => {
    if (!token.slot || filled(token.slot)) {
      return;
    }
    drop.add(index);

    const after = tokens[index + 1];
    if (
      after &&
      after.word &&
      wordKey(after.word) === wordKey(slotLabel(token.slot))
    ) {
      drop.add(index + 1);
    }

    const before = tokens[index - 1];
    if (before && before.word && /^(and|or)$/.test(wordKey(before.word))) {
      drop.add(index - 1);
    } else if (after && after.word && /^(and|or)$/.test(wordKey(after.word))) {
      drop.add(index + 1);
    }
  });

  const parts = [];
  tokens.forEach((token, index) => {
    if (drop.has(index)) {
      return;
    }
    if (token.slot) {
      const value = filled(token.slot);
      if (value) {
        parts.push({ text: value, literal: false });
      }
    } else {
      parts.push({ text: token.word, literal: true });
    }
  });

  while (
    parts.length > 0 &&
    parts[parts.length - 1].literal &&
    CONNECTORS.has(wordKey(parts[parts.length - 1].text))
  ) {
    parts.pop();
  }

  return parts
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The recipe the screen is in, given its index state. null index means the
// normal seven-row builder; an out-of-range index (or a stray non-object entry)
// degrades to the normal builder rather than throwing.
export function selectedRecipe(recipes, index) {
  if (index === null || index === undefined) {
    return null;
  }
  const list = Array.isArray(recipes) ? recipes : [];
  const recipe = list[index];
  return recipe && typeof recipe === 'object' ? recipe : null;
}

// Every distinct {slot} the template mentions, in the order it first appears.
// The screen uses this to build one row per slot without caring about the raw
// template text.
export function recipeSlots(recipe) {
  const template = clean(recipe && recipe.template);
  if (!template) {
    return [];
  }
  const seen = new Set();
  const slots = [];
  const pattern = /\{([^{}]+)\}/g;
  let match;
  while ((match = pattern.exec(template)) !== null) {
    const key = match[1].trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      slots.push(key);
    }
  }
  return slots;
}

// "landscape_type" -> "Landscape type", the label the slot's picker row shows.
export function slotLabel(slot) {
  const text = clean(slot).replace(/[_-]+/g, ' ');
  return text ? capitalise(text) : '';
}

// Renders the template with the chosen values.
//
// The template reads as comma-separated clauses ("a {mood} {landscape_type}
// landscape in {style} style, with {lighting} and {color} tones, {weather}
// weather"). Each clause is rendered on its own by renderClause(), which takes
// out only the chunks belonging to unset slots; the surviving clauses are
// joined with ", " and the first letter is capitalised so the result still
// reads as one sentence, the same convention promptComposer uses. The output
// therefore never contains a literal "{slot}", a double space, a stray comma
// or a dangling conjunction.
export function renderRecipe(recipe, values = {}) {
  const template = clean(recipe && recipe.template);
  if (!template) {
    return '';
  }
  const source = values && typeof values === 'object' ? values : {};
  const clauses = template
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean);

  const kept = [];
  for (const clause of clauses) {
    const text = renderClause(clause, source);
    if (text) {
      kept.push(text);
    }
  }

  if (kept.length === 0) {
    return '';
  }
  return capitalise(kept.join(', '));
}

// One random option per slot, each drawn from that slot's own option list - what
// the Roll all button drops into the screen. `rand` is injectable so the check
// script can drive it deterministically.
export function rollRecipe(recipe, rand = Math.random) {
  const values = {};
  for (const slot of recipeSlots(recipe)) {
    const options = recipe && recipe.variables ? recipe.variables[slot] : null;
    if (Array.isArray(options) && options.length > 0) {
      const index = Math.min(options.length - 1, Math.floor(rand() * options.length));
      values[slot] = options[index];
    }
  }
  return values;
}

// True when the recipe carries at least one slot with options to choose from -
// the screen uses it to avoid offering an empty recipe.
export function recipeIsUsable(recipe) {
  return recipeSlots(recipe).some((slot) => {
    const options = recipe && recipe.variables ? recipe.variables[slot] : null;
    return Array.isArray(options) && options.length > 0;
  });
}
