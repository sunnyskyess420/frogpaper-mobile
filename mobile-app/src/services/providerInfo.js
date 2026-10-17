// Provider-id utilities shared by the screens that need to turn an engine id
// into a human-readable label, and by anyone that needs to know which engine
// produced an image from its filename alone.
//
// Generated filenames already start with the provider id - e.g.
// `huggingface_20260927-1502_lily-pond-at-dawn.png` - so the information is
// present; this module is the only place that turns it back into a name.
//
// PROVIDER_LABELS is the single source of truth for the display names.
// ProviderFallbackNotice, DetailScreen's "Made with" row, and Settings'
// last-change row all import from here so the labels cannot drift between
// screens.

export const PROVIDER_LABELS = {
  pollinations: 'Pollinations',
  gemini: 'Gemini',
  huggingface: 'Hugging Face',
  replicate: 'Replicate',
};

// Returns the provider id when the filename starts with `<id>_`, otherwise
// null. The match is strict: a filename like `pollinations_extra.png` does
// not count, only `pollinations_...` does. Non-strings and null/undefined
// return null instead of throwing.
export function providerFromFilename(filename) {
  if (typeof filename !== 'string' || filename.length === 0) {
    return null;
  }
  const underscore = filename.indexOf('_');
  if (underscore <= 0) {
    return null;
  }
  const prefix = filename.slice(0, underscore);
  if (Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, prefix)) {
    return prefix;
  }
  return null;
}

// Returns the display name for a known provider id, or null for an unknown
// one or a non-string. We intentionally do not fall back to the raw id - a
// "Made with: dalle" row would be worse than no row at all, since the
// detail screen has no way to verify a legacy/unknown id actually rendered
// the image. Callers that want the id echoed back can do so themselves.
export function providerLabel(id) {
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  return PROVIDER_LABELS[id] || null;
}
