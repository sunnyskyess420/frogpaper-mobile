#!/usr/bin/env node
/**
 * check-theme.js - the palette switch (and the Halloween Edition) stays sane.
 *
 * The app ships ONE visual theme per build - `EDITION` in src/theme.js picks
 * between the classic frog-green palette and the Halloween Edition pumpkin
 * palette. This suite keeps the two interchangeable and readable:
 *
 *   1. EDITION points at a palette that exists (and is 'halloween' for this
 *      release - flip it back, and this check reminds you to flip it back).
 *   2. Both palettes define exactly the same token set, all as 6-digit hex.
 *   3. Key text/surface pairs keep sensible contrast in BOTH palettes.
 *   4. No raw brand hexes (the classic greens) leak into screens or
 *      components - palette colours only live in theme.js.
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

/* ── tiny WCAG helpers ─────────────────────────────────────────────── */

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

/* ── parse theme.js (text-level, no imports needed) ────────────────── */

const REQUIRED = [
  'bg', 'card', 'cardAlt', 'border', 'text', 'muted',
  'accent', 'accentDim', 'danger', 'warn',
  'control', 'controlBorder', 'noticeBg',
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

function main() {
  console.log('theme');

  const themePath = path.join(ROOT, 'src/theme.js');
  const themeSrc = fs.readFileSync(themePath, 'utf8');

  const edition = (themeSrc.match(/export const EDITION = '([^']+)'/) || [])[1];
  const palettes = parsePalettes(themeSrc);

  check(
    'EDITION is a known palette',
    edition === 'classic' || edition === 'halloween',
    String(edition)
  );
  check(
    'this release ships the Halloween Edition',
    edition === 'halloween',
    `EDITION=${edition} (flip to 'classic' next release, and update this check)`
  );

  const names = Object.keys(palettes).sort();
  check(
    'both palettes are parsed',
    names.length === 2,
    names.join(', ')
  );

  const classic = palettes.classic || {};
  const halloween = palettes.halloween || {};
  const classicKeys = Object.keys(classic).sort();
  const halloweenKeys = Object.keys(halloween).sort();
  check(
    'both palettes define the same token set',
    classicKeys.length > 0 && classicKeys.join(',') === halloweenKeys.join(','),
    `classic=[${classicKeys}] halloween=[${halloweenKeys}]`
  );
  check(
    'every required token exists in both palettes',
    REQUIRED.every((k) => classic[k] && halloween[k]),
    REQUIRED.filter((k) => !classic[k] || !halloween[k]).join(', ')
  );

  // Contrast pairs: the same five pairings must hold in whichever palette
  // is active, because screens assume these roles.
  const PAIRS = [
    ['text', 'bg', 7.0, 'body text on the app background'],
    ['muted', 'card', 4.5, 'muted text on cards'],
    ['accent', 'bg', 3.0, 'accent (icons/titles) on background'],
    ['bg', 'accent', 4.5, 'dark label on accent-filled buttons'],
    ['danger', 'card', 4.5, 'danger text on cards'],
  ];

  for (const [pname, tokens] of Object.entries(palettes)) {
    for (const [fg, bg, min, label] of PAIRS) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      check(
        `${pname}: ${label} ≥ ${min}:1`,
        ratio >= min,
        `${tokens[fg]} on ${tokens[bg]} = ${ratio.toFixed(2)}:1`
      );
    }
  }

  // Brand colours must not leak into screens/components.
  const dirs = ['src/screens', 'src/components', 'App.js'];
  const leaks = [];
  for (const rel of dirs) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const files = fs.statSync(p).isDirectory()
      ? fs.readdirSync(p).filter((f) => f.endsWith('.js')).map((f) => path.join(p, f))
      : [p];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (/#34D399|#10B981/i.test(text)) {
        leaks.push(path.relative(ROOT, file));
      }
    }
  }
  check(
    'no classic brand hexes leak into screens/components',
    leaks.length === 0,
    leaks.join(', ')
  );

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
