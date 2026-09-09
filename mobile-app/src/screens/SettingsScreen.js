// Settings - backend connection info, provider details, about.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { discoverBaseUrl, getBaseUrl, LAN_IP } from '../services/api';
import { colors, radii, spacing } from '../theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState({
    loading: true,
    health: null,
    providers: [],
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      await discoverBaseUrl();
      const [health, providersResponse] = await Promise.all([
        api.health(),
        api.providers(),
      ]);
      setState({
        loading: false,
        health,
        providers: providersResponse.providers || [],
        error: null,
      });
    } catch (err) {
      setState({
        loading: false,
        health: null,
        providers: [],
        error: err.message || 'Backend unreachable',
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const online = state.health !== null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      <Text style={styles.sectionLabel}>Connection</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.rowValue}>
            {state.loading
              ? 'Checking...'
              : online
                ? 'Connected to backend'
                : 'Backend unreachable'}
          </Text>
        </View>
        <Text style={styles.monoText}>{getBaseUrl()}</Text>
        <Text style={styles.hint}>
          Android emulator reaches your PC via 10.0.2.2. Physical phones use the LAN IP
          ({LAN_IP}) - both are tried automatically. To change the LAN IP, edit
          LAN_IP in src/services/api.js.
        </Text>
        <Pressable style={styles.button} onPress={refresh} disabled={state.loading}>
          {state.loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.buttonText}>Re-test connection</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>AI provider</Text>
      {state.providers.map((provider) => (
        <View key={provider.id} style={styles.card}>
          <Text style={styles.rowValue}>{provider.name}</Text>
          <Text style={styles.hint}>{provider.description}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaChip}>model: {provider.model}</Text>
            <Text style={styles.metaChip}>status: {provider.status}</Text>
            <Text style={styles.metaChip}>
              api key: {provider.requires_api_key ? 'required' : 'not needed'}
            </Text>
          </View>
        </View>
      ))}

      <Text style={styles.sectionLabel}>About</Text>
      <View style={styles.card}>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>App</Text>
          <Text style={styles.aboutValue}>FrogPaper Mobile 1.5.0</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>Backend</Text>
          <Text style={styles.aboutValue}>
            {state.health ? `v${state.health.version}` : '-'}
          </Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>Images on server</Text>
          <Text style={styles.aboutValue}>
            {state.health ? String(state.health.images_count) : '-'}
          </Text>
        </View>
      </View>

      {state.error !== null && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{state.error}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotOnline: {
    backgroundColor: colors.accent,
  },
  dotOffline: {
    backgroundColor: colors.danger,
  },
  rowValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  monoText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  metaChip: {
    color: colors.accent,
    fontSize: 12,
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  aboutKey: {
    color: colors.muted,
    fontSize: 14,
  },
  aboutValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#2A1520',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
});
