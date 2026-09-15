/**
 * The Build screen's word lists, enriched from the desktop keyword bank.
 *
 * The desktop app ships a much bigger vocabulary than the phone did: more
 * subjects, moods, atmospheres and lighting, plus colours, composition notes and
 * prompt boosters the phone never had. This module merges that bank into the
 * app's own lists so the pickers open on the words the owner already knows, with
 * the extra choices right below them.
 *
 * It is data only - the desktop's thesaurus/semantic expansion engine (NLTK,
 * sentence-transformers, a database) stays on the desktop where it belongs.
 */
import BANK from '../data/keywordBank.json';
import {
  ATMOSPHERES,
  LIGHTING,
  MOODS,
  STYLES,
  SUBJECTS,
} from '../data/promptOptions';

// A picker that scrolls forever is worse than one with fewer words, so the
// merged lists stop here. The app's own words always fit - they come first.
export const MAX_OPTIONS = 60;

function key(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * The app's own words first, then the bank's extras. Case-insensitive, with
 * blanks and repeats dropped, and never longer than the cap.
 */
export function mergeOptions(primary = [], extra = [], limit = MAX_OPTIONS) {
  const merged = [];
  const seen = new Set();
  const add = (value) => {
    const text = String(value || '').trim();
    const id = key(text);
    if (!text || seen.has(id) || merged.length >= limit) {
      return;
    }
    seen.add(id);
    merged.push(text);
  };
  primary.forEach(add);
  extra.forEach(add);
  return merged;
}

function bankList(name) {
  const value = BANK ? BANK[name] : null;
  return Array.isArray(value) ? value : [];
}

export const SUBJECT_OPTIONS = mergeOptions(SUBJECTS, bankList('subjects'));
export const STYLE_OPTIONS = mergeOptions(STYLES, bankList('styles'));
export const MOOD_OPTIONS = mergeOptions(MOODS, bankList('mood'));
export const ATMOSPHERE_OPTIONS = mergeOptions(ATMOSPHERES, bankList('atmosphere'));
export const LIGHTING_OPTIONS = mergeOptions(LIGHTING, bankList('lighting'));

// Not on screen yet - carried over so a later row (or the Automate screen) can
// use them without touching the source file again.
export const COLOR_OPTIONS = bankList('colors');
export const COMPOSITION_OPTIONS = bankList('composition');
export const PROMPT_BOOSTERS = bankList('prompt_boosters');
export const BANK_AVOID = bankList('avoid');

/**
 * Some subjects have a richer phrase behind them ("tree frog" ->
 * "detailed tree frog on branch"). Returns '' when there is nothing richer,
 * so callers can fall back to the subject itself.
 */
export function expandSubject(subject) {
  const aliases = BANK && BANK.SUBJECT_ALIASES ? BANK.SUBJECT_ALIASES : {};
  const exact = aliases[subject];
  if (typeof exact === 'string' && exact.trim()) {
    return exact.trim();
  }
  const wanted = key(subject);
  const match = Object.keys(aliases).find((name) => key(name) === wanted);
  return match ? String(aliases[match]).trim() : '';
}

/**
 * How many extra words the bank added in total - used by the Settings summary
 * and the check script.
 */
export function bankExtraCount() {
  return (
    Math.max(0, SUBJECT_OPTIONS.length - SUBJECTS.length) +
    Math.max(0, STYLE_OPTIONS.length - STYLES.length) +
    Math.max(0, MOOD_OPTIONS.length - MOODS.length) +
    Math.max(0, ATMOSPHERE_OPTIONS.length - ATMOSPHERES.length) +
    Math.max(0, LIGHTING_OPTIONS.length - LIGHTING.length)
  );
}
