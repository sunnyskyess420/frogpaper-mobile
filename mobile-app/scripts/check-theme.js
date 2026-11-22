#!/usr/bin/env node
/**
 * check-theme.js - the app's themes stay sane and interchangeable.
 *
 * The app ships four palettes (Halloween, classic frog green, Tide, Blossom) and
 * Settings -> Appearance switches between them at runtime. This suite keeps them
 * honest without importing the app:
 *
 *   1. Every palette exists, defines the same token set, and every required
 *      token is present (a screen that reads colors.x must never get undefined).
 *   2. Key text/surface pairs keep sensible contrast in EVERY palette, including
 *      the ones added later.
 *   3. The theme registry points at real palettes, with unique ids and labels,
 *      and the default theme is one of them.
 *   4. No raw hex literals live in screens, components, navigation or App.js -
 *      colours come from the palette - and no screen still calls
 *      StyleSheet.create directly (that would freeze one theme's colours).
 *
 * Run with:  npm run check:theme
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

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

/* ── tiny WCAG helpers ────────────────────────────────────────────── */

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── parse theme.js (text-level, no imports needed) ───────────────── */

const REQUIRED = [
  'bg', 'card', 'cardAlt', 'border', 'text', 'muted',
  'accent', 'accentDim', 'danger', 'warn',
  'control', 'controlBorder', 'noticeBg',
  'onControl', 'dangerBg', 'dangerText', 'dangerStrong',
  'onImage', 'onImageMuted',
];
function parsePalettes(src) {
  const out = {};
  const re = /const (\w+) = \{([\s\S]*?)\n\};/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const body = m[2];
    const tokens = {};
    const tre = /(\w+):\s*'(#[0-9A-Fa-f]{6})'/g;
    let t;
    while ((t = tre.exec(body)) !== null) {
      tokens[t[1]] = t[2].toUpperCase();
    }
    if (Object.keys(tokens).length) out[name] = tokens;
  }
  return out;
}

function parseRegistry(src) {
  const entries = [];
  const re = /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*palette:\s*(\w+),\s*scheme:\s*'([^']+)'\s*\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    entries.push({ id: m[1], label: m[2], palette: m[3], scheme: m[4] });
  }
  return entries;
}

function jsFiles(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return [];
  if (!fs.statSync(p).isDirectory()) return [p];
  return fs
    .readdirSync(p)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(p, f));
}

function main() {
  console.log('theme');

  const themeSrc = fs.readFileSync(path.join(ROOT, 'src/theme.js'), 'utf8');
  const palettes = parsePalettes(themeSrc);
  const registry = parseRegistry(themeSrc);

  // --- 1: structure -------------------------------------------------------
  const names = Object.keys(palettes);
  check('every palette is parsed', names.length >= 5, names.join(', '));
  check(
    'the registry lists every palette once',
    registry.length === names.length && names.every((n) => registry.some((e) => e.palette === n)),
    `registry=[${registry.map((e) => e.palette)}] palettes=[${names}]`
  );

  const ids = registry.map((e) => e.id);
  check('theme ids are unique', new Set(ids).size === ids.length, ids.join(', '));
  const labels = registry.map((e) => e.label);
  check('theme labels are unique and non-empty', new Set(labels).size === labels.length && labels.every(Boolean), labels.join(', '));

  const defaultId = (themeSrc.match(/export const DEFAULT_THEME = '([^']+)'/) || [])[1];
  check('the default theme is one of the registry ids', ids.includes(defaultId), String(defaultId));

  // Every theme must say whether it is light or dark, for the status bar and the
  // navigator's base theme - and that claim has to match the palette it ships.
  const missingScheme = registry.filter((entry) => entry.scheme !== 'light' && entry.scheme !== 'dark');
  check('every theme declares light or dark', missingScheme.length === 0, missingScheme.map((e) => e.id).join(', '));

  const mismatched = registry.filter((entry) => {
    const bg = palettes[entry.palette] && palettes[entry.palette].bg;
    if (!bg) return true;
    const lightBg = luminance(bg) > 0.5;
    return (entry.scheme === 'light') !== lightBg;
  });
  check(
    'each theme\'s scheme matches its background',
    mismatched.length === 0,
    mismatched.map((e) => `${e.id}:${e.scheme}`).join(', ')
  );

  const baseKeys = Object.keys(palettes[names[0]] || {}).sort();
  let sameSet = true;
  for (const name of names) {
    if (Object.keys(palettes[name]).sort().join(',') !== baseKeys.join(',')) {
      sameSet = false;
      check(`${name}: defines the same token set`, false, Object.keys(palettes[name]).sort().join(','));
    }
  }
  check('all palettes define the same token set', sameSet);

  const missing = [];
  for (const name of names) {
    for (const key of REQUIRED) {
      if (!palettes[name][key]) missing.push(`${name}.${key}`);
    }
  }
  check('every required token exists in every palette', missing.length === 0, missing.join(', '));

  // --- 2: contrast --------------------------------------------------------
  // These are the roles screens assume. Each palette must satisfy them all, so
  // a new theme cannot ship unreadable text.
  const PAIRS = [
    ['text', 'bg', 7.0, 'body text on the app background'],
    ['muted', 'card', 4.5, 'muted text on cards'],
    ['accent', 'bg', 3.0, 'accent (icons/titles) on background'],
    ['bg', 'accent', 4.5, 'dark label on accent-filled buttons'],
    ['danger', 'card', 4.5, 'danger text on cards'],
    ['onControl', 'control', 4.5, 'label on a control-filled button'],
    ['dangerText', 'dangerBg', 4.5, 'danger text on a danger panel'],
    ['onImage', 'dangerStrong', 4.5, 'label on a filled delete button'],
  ];

  for (const name of names) {
    const tokens = palettes[name];
    for (const [fg, bg, min, label] of PAIRS) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      check(
        `${name}: ${label} \u2265 ${min}:1`,
        ratio >= min,
        `${tokens[fg]} on ${tokens[bg]} = ${ratio.toFixed(2)}:1`
      );
    }
  }

  // --- 3: no literals, no frozen stylesheets ------------------------------
  const dirs = ['src/screens', 'src/components', 'src/navigation', 'App.js'];
  const leaks = [];
  const frozen = [];
  for (const rel of dirs) {
    for (const file of jsFiles(rel)) {
      const text = fs.readFileSync(file, 'utf8');
      // A literal colour in a string is a colour the theme cannot change.
      if (/'#[0-9A-Fa-f]{3,8}'/.test(text)) leaks.push(path.relative(ROOT, file));
      if (/StyleSheet\.create\(/.test(text)) frozen.push(path.relative(ROOT, file));
    }
  }
  check('no raw hex colours in screens/components/navigation/App', leaks.length === 0, leaks.join(', '));
  check(
    'every stylesheet goes through themedStyles()',
    frozen.length === 0,
    frozen.join(', ')
  );

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
