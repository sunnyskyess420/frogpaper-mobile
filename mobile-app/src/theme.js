// Shared design tokens and the app's themes.
//
// Four palettes ship here: the classic frog green, the Halloween Edition
// (pumpkin orange on a haunted purple night), Tide (deep sea blue and cyan) and
// Blossom (plum night and pink). Settings -> Appearance switches between them at
// runtime, and the choice is remembered on the phone.
//
// How a switch reaches a stylesheet: every screen builds its styles through
// themedStyles() instead of StyleSheet.create(). That returns a proxy which
// rebuilds (and caches) the real stylesheet whenever the active theme changes,
// so a module-level `styles` object still resolves to the current palette on the
// next render. Screens subscribe with useTheme() so that render happens - the
// palette itself (colors) is mutated in place, so ordinary colour reads inside
// JSX are always current too.
//
// Raw palettes never leave this file: screens and components read `colors`.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  // Text drawn on a `control` fill (secondary buttons, chips).
  onControl: '#EAF7F1',
  // Destructive panels: wash, text and the strong fill for a delete button.
  dangerBg: '#2A1520',
  dangerText: '#FEE2E2',
  dangerStrong: '#7F1D1D',
  // Text and rules drawn over a photo (zoom viewer, gallery overlays). These
  // stay near-white in every theme because the backdrop is the image itself.
  onImage: '#FFFFFF',
  onImageMuted: '#BBBBBB',
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
  control: '#2A1D38',
  controlBorder: '#5F4278',
  noticeBg: '#2A1808', // dark pumpkin wash
  onControl: '#F3E9D9',
  dangerBg: '#2A1520',
  dangerText: '#FFE0DC',
  dangerStrong: '#7F1D1D',
  onImage: '#FFFFFF',
  onImageMuted: '#D9CFC2',
};

const ocean = {
  bg: '#061824', // deep water
  card: '#0D2534', // wet slate
  cardAlt: '#091E2B',
  border: '#1E4258',
  text: '#E4F1F7', // sea foam
  muted: '#8FB3C4', // hazy blue
  accent: '#22D3EE', // shallow-water cyan
  accentDim: '#0E7490',
  danger: '#FB7185',
  warn: '#FBBF24',
  control: '#14334A',
  controlBorder: '#2A5B78',
  noticeBg: '#0B2A33',
  onControl: '#E6F6FB',
  dangerBg: '#2A1520',
  dangerText: '#FEE2E2',
  dangerStrong: '#7F1D1D',
  onImage: '#FFFFFF',
  onImageMuted: '#BFD4DE',
};

const sakura = {
  bg: '#170D16', // plum night
  card: '#241325',
  cardAlt: '#1C0F1D',
  border: '#4E2A4A',
  text: '#F8E9F2', // blossom white
  muted: '#C79DB8', // dusty petal
  accent: '#F472B6', // cherry pink
  accentDim: '#BE185D',
  danger: '#FF8A8A',
  warn: '#FCD34D',
  control: '#33192F',
  controlBorder: '#5E3155',
  noticeBg: '#2B1220',
  onControl: '#FBEAF3',
  dangerBg: '#2A1520',
  dangerText: '#FFE0E4',
  dangerStrong: '#7F1D1D',
  onImage: '#FFFFFF',
  onImageMuted: '#D8C2D0',
};

// The one light palette. Every role keeps its meaning rather than flipping:
// `bg` is still the label colour on an accent-filled button (so it has to be
// LIGHT), `control` is still a fill, `onControl` the text on it. accent/accentDim
// stay dark enough for white labels, which is what the screens assume.
const daylight = {
  bg: '#F4F7FA', // daylight paper
  card: '#FFFFFF',
  cardAlt: '#EDF2F7',
  border: '#D5DEE8',
  text: '#14202B', // ink
  muted: '#55677A',
  accent: '#0F766E', // deep teal
  accentDim: '#0B5C55',
  danger: '#B42318',
  warn: '#A16207', // amber, dark enough on white
  control: '#E7EDF4',
  controlBorder: '#C3D0DC',
  noticeBg: '#E6F4EA',
  onControl: '#16202B',
  dangerBg: '#FDECEA',
  dangerText: '#8C1D18',
  dangerStrong: '#991B1B',
  onImage: '#FFFFFF',
  onImageMuted: '#E2E8F0',
};

// The order here is the order of the chips in Settings. `scheme` tells the app
// whether the status bar and the navigator should go light-on-dark or dark-on-light.
export const THEMES = [
  { id: 'halloween', label: 'Halloween', palette: halloween, scheme: 'dark' },
  { id: 'classic', label: 'Frog green', palette: classic, scheme: 'dark' },
  { id: 'ocean', label: 'Tide', palette: ocean, scheme: 'dark' },
  { id: 'sakura', label: 'Blossom', palette: sakura, scheme: 'dark' },
  { id: 'daylight', label: 'Daylight', palette: daylight, scheme: 'light' },
];

// A fresh install keeps the look this release has been shipping.
export const DEFAULT_THEME = 'halloween';

export const THEME_STORAGE_KEY = '@frogpaper/theme';

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

export function themeIds() {
  return THEMES.map((theme) => theme.id);
}

// A copy, not the palette itself, so callers cannot reach the raw objects.
export const colors = { ...themeById(DEFAULT_THEME).palette };

let currentThemeId = DEFAULT_THEME;

// Every themedStyles factory caches the stylesheet it built for one theme.
const styleCache = new Map();

export function activeThemeId() {
  return currentThemeId;
}

export function activeThemeLabel() {
  return themeById(currentThemeId).label;
}

/**
 * Make `id` the active theme. The palette is mutated in place so `colors` keeps
 * working in JSX, and the cache is dropped so the next render rebuilds styles.
 * Returns the id that was actually applied (an unknown id falls back to the
 * first theme rather than throwing).
 */
export function applyTheme(id) {
  const theme = themeById(id);
  if (theme.id !== currentThemeId) {
    styleCache.clear();
  }
  Object.assign(colors, theme.palette);
  currentThemeId = theme.id;
  return theme.id;
}

/**
 * A stylesheet that follows the active theme. Pass a factory, not an object:
 *
 *     const styles = themedStyles(() => ({ card: { backgroundColor: colors.card } }));
 *
 * The factory runs once per theme (then the result is cached), and reads
 * `colors` at that moment, so tokens resolve to the palette in force.
 */
export function themedStyles(factory) {
  return new Proxy(
    {},
    {
      get(target, prop) {
        let entry = styleCache.get(factory);
        if (!entry || entry.id !== currentThemeId) {
          entry = { id: currentThemeId, sheet: StyleSheet.create(factory()) };
          styleCache.set(factory, entry);
        }
        return entry.sheet[prop];
      },
      has(target, prop) {
        return prop in StyleSheet.create(factory());
      },
    }
  );
}

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

// --- runtime ---------------------------------------------------------------

const ThemeContext = createContext({
  id: DEFAULT_THEME,
  label: themeById(DEFAULT_THEME).label,
  scheme: themeById(DEFAULT_THEME).scheme,
  themes: THEMES,
  setTheme: () => {},
});

/**
 * Holds the chosen theme for the whole app: applies it before rendering, loads
 * the saved choice once on start, and re-renders the tree when it changes.
 */
export function ThemeProvider({ children }) {
  const [id, setId] = useState(() => applyTheme(DEFAULT_THEME));

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (!cancelled && saved) {
          setId(applyTheme(saved));
        }
      })
      .catch(() => {
        // A missing or unreadable preference just means the default theme.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((next) => {
    const applied = applyTheme(next);
    setId(applied);
    AsyncStorage.setItem(THEME_STORAGE_KEY, applied).catch(() => {
      // The theme still applies for this session; it just will not persist.
    });
  }, []);

  const value = useMemo(
    () => ({
      id,
      label: themeById(id).label,
      scheme: themeById(id).scheme,
      themes: THEMES,
      setTheme,
    }),
    [id, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Subscribe to the active theme. Screens call this so a switch re-renders them;
 * the colours themselves come from `colors` and themedStyles().
 */
export function useTheme() {
  return useContext(ThemeContext);
}
