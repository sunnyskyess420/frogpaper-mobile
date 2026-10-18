// Prompt history - every prompt your wallpapers were made from, newest first,
// with one-tap "Make again" (fire it straight away) or "Edit" (load it into
// Generate).
//
// Built from the phone's own gallery first (each saved image carries the prompt
// it was made from), so it works offline and survives the server's storage being
// wiped. Recent prompts from the backend are merged in as a bonus.
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import api, { isOfflineError } from '../services/api';
import { listLocalImages } from '../services/localGallery';
import { colors, radii, spacing } from '../theme';

function dedupeBy(list, keyOf) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const key = keyOf(entry);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

export default function HistoryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);

    // 1) The phone's own gallery: reliable, offline, and the app's source of
    //    truth. Every saved image carries the prompt it was made from.
    let local = [];
    try {
      const files = await listLocalImages();
      local = files
        .filter((file) => typeof file.prompt === 'string' && file.prompt.trim().length >= 3)
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
        .map((file) => ({
          prompt: file.prompt.trim(),
          negative_prompt:
            typeof file.negativePrompt === 'string' ? file.negativePrompt : null,
          at: file.mtime || 0,
        }));
      local = dedupeBy(local, (entry) => entry.prompt.toLowerCase());
    } catch (err) {
      // an unreadable store just means no local prompts
    }

    // 2) Recent prompts from the backend (adds anything made before the phone
    //    kept its own copy). Best-effort - a failure here must not blank a list
    //    we already have from the phone.
    let server = [];
    let serverError = null;
    try {
      const response = await api.recentPrompts(40);
      server = (response.prompts || [])
        .map((entry) => ({
          prompt: String(entry.prompt || '').trim(),
          negative_prompt: entry.negative_prompt || null,
        }))
        .filter((entry) => entry.prompt.length >= 3);
    } catch (err) {
      serverError = err;
    }

    const seen = new Set(local.map((entry) => entry.prompt.toLowerCase()));
    const merged = [...local];
    for (const entry of server) {
      const key = entry.prompt.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }

    // Only surface an error when we have nothing to show AND the backend was the
    // problem - never hide a good local list behind a server hiccup.
    if (merged.length === 0 && serverError && isOfflineError(serverError)) {
      setError(
        'No internet connection. Prompts saved on this phone still show here, but none have been saved yet.'
      );
    }

    setItems(merged);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load])
  );

  const makeAgain = (item) => {
    const nonce = Date.now();
    // History is on the root stack; Generate lives inside the tab navigator.
    navigation.navigate('Tabs', {
      screen: 'Generate',
      params: {
        builtPrompt: item.prompt,
        builtPromptNonce: nonce,
        autoGenerate: true,
        autoGenerateNonce: nonce,
      },
    }, { pop: true });
  };

  const editPrompt = (item) => {
    navigation.navigate('Tabs', {
      screen: 'Generate',
      params: {
        builtPrompt: item.prompt,
        builtPromptNonce: Date.now(),
      },
    }, { pop: true });
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.promptText}>{item.prompt}</Text>
      {item.negative_prompt ? (
        <Text style={styles.avoidText} numberOfLines={2}>
          Avoid: {item.negative_prompt}
        </Text>
      ) : null}
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={() => makeAgain(item)}>
          <Text style={styles.primaryButtonText}>Make again</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => editPrompt(item)}>
          <Text style={styles.secondaryButtonText}>Edit</Text>
        </Pressable>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading your prompts...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${index}-${item.prompt}`}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(false);
            }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.header}>
              {items.length} prompt{items.length === 1 ? '' : 's'}
            </Text>
            {error !== null && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable style={styles.secondaryButton} onPress={() => load(true)}>
                  <Text style={styles.secondaryButtonText}>Retry</Text>
                </Pressable>
              </View>
            )}
            {error === null && items.length > 0 && (
              <Text style={styles.hint}>
                Prompts your wallpapers were made from. Tap "Make again" to generate from
                one, or "Edit" to tweak it first.
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          error === null ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No prompts yet</Text>
              <Text style={styles.emptyText}>
                Generate a wallpaper and its prompt shows up here, ready to reuse.
                Wallpapers you saved before this feature existed may not appear.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
  },
  listContent: {
    padding: spacing.lg,
  },
  headerBlock: {
    marginBottom: spacing.md,
  },
  header: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  promptText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  avoidText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#EAF7F1',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: '#2A1520',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
