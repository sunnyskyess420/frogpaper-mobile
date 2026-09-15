// Turns Build-screen selections into one prompt sentence.
//
// Pure and deterministic on purpose: the same selections must always compose the
// same text (the check script asserts this), and the only randomness in the
// feature lives in randomCombo(), behind the Randomise button.
//
// A selected Mode brings real data with it (src/data/promptModes.json, ported
// verbatim from the desktop app): style wording, quality cues that land early
// and close the sentence, and a mode-specific negative list. The mode's own
// wording replaces the bare mode word the composer used to append, so a mode
// still colours the whole sentence without saying its name twice.
import { MODES, SETTING_SUGGESTIONS } from '../data/promptOptions';
import PROMPT_MODES from '../data/promptModes.json';
import {
  ATMOSPHERE_OPTIONS,
  COLOR_OPTIONS,
  LIGHTING_OPTIONS,
  MOOD_OPTIONS,
  STYLE_OPTIONS,
  SUBJECT_OPTIONS,
} from './keywordBank';

// A setting already starting with one of these reads as a place on its own
// ("under the sea"), so the composer must not prepend "in a".
const SETTING_PREPOSITIONS = [
  'in',
  'on',
  'at',
  'under',
  'over',
  'inside',
  'outside',
  'among',
  'amidst',
  'beside',
  'near',
  'across',
  'through',
  'beyond',
  'beneath',
  'below',
  'above',
  'around',
  'within',
  'behind',
  'against',
];

const SETTING_ARTICLES = ['a', 'an', 'the'];

// Words too generic to prove that a fragment's idea is already in the prompt.
const DEDUPE_IGNORED_WORDS = ['and', 'the', 'with', 'style'];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstWord(text) {
  return text.toLowerCase().split(/\s+/)[0];
}

function articleFor(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

// "lily pond at dawn" -> "in a lily pond at dawn"
// "under the sea"     -> "under the sea"
// "the old mill"      -> "in the old mill"
function settingClause(setting) {
  const text = clean(setting);
  if (!text) {
    return '';
  }
  const first = firstWord(text);
  if (SETTING_PREPOSITIONS.includes(first)) {
    return text;
  }
  if (SETTING_ARTICLES.includes(first)) {
    return `in ${text}`;
  }
  return `in ${articleFor(text)} ${text}`;
}

// The opening clause every composition starts with: the subject in its setting
// when both are set, otherwise whichever of the two is present.
function subjectAndPlace(selection) {
  const subject = clean(selection.subject);
  const place = settingClause(selection.setting);
  if (subject) {
    const subjectClause = `${articleFor(subject)} ${subject}`;
    return place ? `${subjectClause} ${place}` : subjectClause;
  }
  return place;
}

// The desktop data keys modes by slug ("dark-fantasy"), the screen labels them
// in title case ("Dark Fantasy"), so the two are matched on the slug.
export function modeKey(modeLabel) {
  return clean(modeLabel).toLowerCase().replace(/\s+/g, '-');
}

export function modeData(modeLabel) {
  const key = modeKey(modeLabel);
  if (!key || !Object.prototype.hasOwnProperty.call(PROMPT_MODES, key)) {
    return null;
  }
  const data = PROMPT_MODES[key];
  return data && typeof data === 'object' ? data : null;
}

// --- assembling a prompt from clauses -------------------------------------
// Clauses are joined with ", " and only the first letter is capitalised, which
// is what keeps the output reading as one sentence.

// The meaningful words of a fragment, used to spot an idea that a previous row
// already stated. Punctuation and generic words carry no idea of their own.
function significantWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length >= 3 && !DEDUPE_IGNORED_WORDS.includes(word));
}

// Appends raw clause text (an exact row choice, never dropped) and records its
// words so later mode fragments do not repeat the same idea.
function pushClause(clauses, text, seen) {
  clauses.push(text);
  for (const word of significantWords(text)) {
    seen.add(word);
  }
}

// Appends comma-separated mode data, skipping a fragment whose every meaningful
// word is already present: the idea is already said, so saying it twice would
// read as a raw dump rather than a sentence.
function pushData(clauses, text, seen) {
  const fragments = clean(text)
    .split(',')
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  for (const fragment of fragments) {
    const words = significantWords(fragment);
    if (words.length > 0 && words.every((word) => seen.has(word))) {
      continue;
    }
    clauses.push(fragment);
    for (const word of words) {
      seen.add(word);
    }
  }
}

function capitalise(sentence) {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// The composition used when no mode is selected - unchanged from the original
// behaviour, which existing checks compare against byte for byte.
function composePlain(selection) {
  const style = clean(selection.style);
  const lighting = clean(selection.lighting);
  const color = clean(selection.color);
  const mood = clean(selection.mood);
  const atmosphere = clean(selection.atmosphere);
  const mode = clean(selection.mode);

  const clauses = [];
  const opening = subjectAndPlace(selection);
  if (opening) {
    clauses.push(opening);
  }
  if (style) {
    clauses.push(`${style} style`);
  }
  if (lighting) {
    clauses.push(`${lighting} lighting`);
  }
  // Colour reads with the light, so it sits right after it.
  if (color) {
    clauses.push(`${color} tones`);
  }
  if (mood) {
    clauses.push(`${mood} mood`);
  }
  if (atmosphere) {
    clauses.push(atmosphere);
  }
  // The mode is the adjective that colours the whole sentence, so it closes it.
  if (mode) {
    clauses.push(mode.toLowerCase());
  }

  if (clauses.length === 0) {
    return '';
  }
  return capitalise(clauses.join(', '));
}

// With mode data the sentence is: subject/setting, the mode's quality cues
// early, its style wording (then any Style the owner also chose, so both
// survive), the remaining rows, and the mode's closing quality cues.
function composeWithMode(selection, mode) {
  const style = clean(selection.style);
  const lighting = clean(selection.lighting);
  const color = clean(selection.color);
  const mood = clean(selection.mood);
  const atmosphere = clean(selection.atmosphere);

  const clauses = [];
  const seen = new Set();

  const opening = subjectAndPlace(selection);
  if (opening) {
    pushClause(clauses, opening, seen);
  }
  pushData(clauses, mode.qualityLead, seen);
  pushData(clauses, mode.styleBase, seen);
  if (style) {
    // The owner's explicit choice is never dropped, even when the mode's style
    // base already covers a similar idea.
    pushClause(clauses, `${style} style`, seen);
  }
  if (lighting) {
    pushClause(clauses, `${lighting} lighting`, seen);
  }
  if (color) {
    pushClause(clauses, `${color} tones`, seen);
  }
  if (mood) {
    pushClause(clauses, `${mood} mood`, seen);
  }
  if (atmosphere) {
    pushClause(clauses, atmosphere, seen);
  }
  pushData(clauses, mode.qualityClose, seen);

  if (clauses.length === 0) {
    return '';
  }
  return capitalise(clauses.join(', '));
}

// Returns both halves of a composition: the prompt sentence and the mode's
// negative list ('' when no mode is selected).
export function composeSelection(selection = {}) {
  const mode = modeData(selection.mode);
  if (!mode) {
    return { prompt: composePlain(selection), negative: '' };
  }
  return {
    prompt: composeWithMode(selection, mode),
    negative: clean(mode.negative),
  };
}

export function composePrompt(selection = {}) {
  return composeSelection(selection).prompt;
}

// One random option per row - what the Randomise button drops into the screen.
// It draws from the same enriched lists the screen shows, so a surprise can use
// every word the keyword bank offers. `rand` is injectable so the check script
// can drive it deterministically.
export function randomCombo(rand = Math.random) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  return {
    mode: pick(MODES),
    subject: pick(SUBJECT_OPTIONS),
    setting: pick(SETTING_SUGGESTIONS),
    style: pick(STYLE_OPTIONS),
    lighting: pick(LIGHTING_OPTIONS),
    color: pick(COLOR_OPTIONS),
    mood: pick(MOOD_OPTIONS),
    atmosphere: pick(ATMOSPHERE_OPTIONS),
  };
}
