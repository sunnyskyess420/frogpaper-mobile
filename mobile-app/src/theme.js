// Shared design tokens for FrogPaper Mobile.
//
// Two palettes live here: the classic frog-green look and the Halloween
// Edition (pumpkin orange on a haunted purple night). `EDITION` picks which
// one the app uses - for the Halloween Edition release it is 'halloween';
// set it back to 'classic' in the next release (one line) and the app
// returns to frog green. Screens and components read only from `colors` -
// the raw palettes never leave this file.
export const EDITION = 'halloween';

export const EDITION_NAME = EDITION === 'halloween' ? 'Halloween Edition' : '';

const classic = {
  bg: '#0B1220',
  card: '#121D30',
  cardAlt: '#0F1828',
  border: '#20304A',
  text: '#E7EEF7',
  muted: '#8DA2BC',
  accent: '#34D399',
  accentDim: '#10B981',
  danger: '#F87171',
  warn: '#FBBF24',
  // Interactive controls sitting on dark cards: a fill + border pair that stays
  // visible against colors.card, and high-contrast text on top of it.
  control: '#1C2B45',
  controlBorder: '#35507A',
  // Tinted surface for notice / status bars (pairs with an accent border and
  // light text on top).
  noticeBg: '#12291B',
};

const halloween = {
  bg: '#140D1C', // haunted purple-black
  card: '#1D1329', // spellbook purple
  cardAlt: '#171025', // recessed well
  border: '#4A3060',
  text: '#F3E9D9', // bone white
  muted: '#B09CC6', // dusty lavender
  accent: '#FF8C1A', // pumpkin orange
  accentDim: '#D97218', // candle flame
  danger: '#FF7A70',
  warn: '#FFC857', // candy corn
  // Same roles as the classic palette - see the comment there.
  control: '#2A1D38',
  controlBorder: '#5F4278',
  noticeBg: '#2A1808', // dark pumpkin wash
};

export const palettes = { classic, halloween };

export const colors = palettes[EDITION] || classic;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};
