// Appending a quick negative preset to the Generate screen's Avoid field.
//
// Pure on purpose: the screen owns the text, this service only computes the new
// text. The rule is "append, never clobber" - the owner's own words are kept
// exactly as typed and in order, and a preset term already present (matched
// case-insensitively, ignoring surrounding blanks) is never added twice.

// " text, watermark ,, logo " -> ["text", "watermark", "logo"]
export function parseTerms(text) {
  return String(text == null ? '' : text)
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);
}

// Appends a preset's comma-separated terms to the current Avoid text.
//
// Returns { text, added }: `text` is the new field value, `added` the terms that
// were actually appended (in the preset's own casing), so the screen can say
// "Added: No Text" honestly - an empty `added` means every term was already
// there and the field was left as it was.
//
// A blank/None preset appends nothing and returns the current text untouched.
export function appendPreset(currentText, presetTerms) {
  const existing = parseTerms(currentText);
  const seen = new Set(existing.map((term) => term.toLowerCase()));
  const added = [];

  for (const term of parseTerms(presetTerms)) {
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    added.push(term);
  }

  return { text: existing.concat(added).join(', '), added };
}

// The empty field value. Kept here so the screen never spells out '' itself and
// the clear behaviour is testable in one place.
export function clearPresetText() {
  return '';
}
