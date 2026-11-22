// FrogPaper Mobile - app entry point
import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { ActivityIndicator, View } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider, colors, useTheme } from './src/theme';
import { initSentry } from './src/services/sentry';
import { initErrorLog } from './src/services/errorLog';
import { initRecipeStore } from './src/services/recipeStore';
import { hasSeenWelcome, markWelcomeSeen } from './src/services/firstRun';
import WelcomeTutorial from './src/components/WelcomeTutorial';

// The navigation container's own theme (screen backgrounds, header tint) is
// rebuilt on every theme switch, so no screen flashes the previous palette. The
// light theme starts from DefaultTheme, so status text and separators flip too.
function useNavigationTheme() {
  const { id, scheme } = useTheme();
  return useMemo(() => {
    const base = scheme === 'light' ? DefaultTheme : DarkTheme;
    return {
      ...base,
      dark: scheme !== 'light',
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.bg,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        notification: colors.accent,
      },
    };
  }, [id, scheme]);
}

// ThemeProvider wraps the app so the palette is applied before anything paints;
// the shell below is what actually renders (and re-renders) with it.
export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

function AppShell() {
  const navigationTheme = useNavigationTheme();
  const { scheme } = useTheme();
  const [sentryReady, setSentryReady] = useState(false);
  // The walkthrough is shown once, after the app is up and only on a real
  // first launch - an install that already has data has seen it.
  const [showWelcome, setShowWelcome] = useState(false);

  // Initialise Sentry before the first render commits. initSentry is a
  // no-op when no DSN is configured, so it's safe to call unconditionally.
  // Install the error log first: it should catch anything that happens while
  // the rest of the app is still starting up.
  useEffect(() => {
    initErrorLog().catch(() => {});
    initRecipeStore().catch(() => {});
    hasSeenWelcome()
      .then((seen) => {
        if (!seen) {
          setShowWelcome(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    initSentry()
      .catch(() => {})
      .finally(() => {
        if (mounted) setSentryReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!sentryReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <NavigationContainer theme={navigationTheme}>
        <AppNavigator />
      </NavigationContainer>
      <WelcomeTutorial
        visible={showWelcome}
        onDone={() => {
          setShowWelcome(false);
          markWelcomeSeen().catch(() => {});
        }}
      />
    </SafeAreaProvider>
  );
}
