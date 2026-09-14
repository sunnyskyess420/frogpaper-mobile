// Turns Build-screen selections into one prompt sentence.
//
// Pure and deterministic on purpose: the same selections must always compose the
// same text (the check script asserts this), and the only randomness in the
// feature lives in randomCombo(), behind the Randomise button.
import {
  ATMOSPHERES,
  LIGHTING,
  MODES,
  MOODS,
  SETTING_SUGGESTIONS,
  STYLES,
  SUBJECTS,
} from '../data/promptOptions';

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

export function composePrompt(selection = {}) {
  const subject = clean(selection.subject);
  const setting = clean(selection.setting);
  const style = clean(selection.style);
  const lighting = clean(selection.lighting);
  const mood = clean(selection.mood);
  const atmosphere = clean(selection.atmosphere);
  const mode = clean(selection.mode);

  const clauses = [];
  const place = settingClause(setting);
  if (subject) {
    const subjectClause = `${articleFor(subject)} ${subject}`;
    clauses.push(place ? `${subjectClause} ${place}` : subjectClause);
  } else if (place) {
    clauses.push(place);
  }
  if (style) {
    clauses.push(`${style} style`);
  }
  if (lighting) {
    clauses.push(`${lighting} lighting`);
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
  const sentence = clauses.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// One random option per row - what the Randomise button drops into the screen.
// `rand` is injectable so the check script can drive it deterministically.
export function randomCombo(rand = Math.random) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  return {
    mode: pick(MODES),
    subject: pick(SUBJECTS),
    setting: pick(SETTING_SUGGESTIONS),
    style: pick(STYLES),
    lighting: pick(LIGHTING),
    mood: pick(MOODS),
    atmosphere: pick(ATMOSPHERES),
  };
}
