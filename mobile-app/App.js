// FrogPaper Mobile - app entry point
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { ActivityIndicator, View } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { colors } from './src/theme';
import { initSentry } from './src/services/sentry';
import { initErrorLog } from './src/services/errorLog';

const FrogPaperTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

export default function App() {
  const [sentryReady, setSentryReady] = useState(false);

  // Initialise Sentry before the first render commits. initSentry is a
  // no-op when no DSN is configured, so it's safe to call unconditionally.
  // Install the error log first: it should catch anything that happens while
  // the rest of the app is still starting up.
  useEffect(() => {
    initErrorLog().catch(() => {});
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
      <StatusBar style="light" />
      <NavigationContainer theme={FrogPaperTheme}>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
