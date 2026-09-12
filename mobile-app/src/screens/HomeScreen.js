// Home - landing screen with live backend status and quick actions.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import api, { getBaseUrl } from '../services/api';
import {
  shuffleWallpaperOnce,
  getShuffleOnOpen,
  setShuffleOnOpen,
} from '../services/shuffle';
import { colors, radii, spacing } from '../theme';

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState({ state: 'checking', info: null });
  const [shuffling, setShuffling] = useState(false);
  const [shuffleNotice, setShuffleNotice] = useState(null);
  const [shuffleOnOpen, setShuffleOnOpenState] = useState(false);
  const autoShuffledRef = useRef(false);

  const checkBackend = useCallback(async () => {
    setStatus({ state: 'checking', info: null });
    try {
      const health = await api.health();
      setStatus({ state: 'online', info: health });
      // Auto-shuffle once per app open, if the user enabled it. Best-effort
      // and silent - never blocks startup or shows errors on its own.
      if (!autoShuffledRef.current) {
        autoShuffledRef.current = true;
        try {
          if (await getShuffleOnOpen()) {
            await shuffleWallpaperOnce();
          }
        } catch (err) {
          // ignore
        }
      }
    } catch (error) {
      setStatus({ state: 'offline', info: null });
    }
  }, []);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  useEffect(() => {
    (async () => {
      setShuffleOnOpenState(await getShuffleOnOpen());
    })();
  }, []);

  const online = status.state === 'online';
  const checking = status.state === 'checking';

  const doShuffle = async () => {
    setShuffling(true);
    setShuffleNotice(null);
    const result = await shuffleWallpaperOnce();
    setShuffleNotice({ kind: result.ok ? 'ok' : 'error', text: result.message });
    setShuffling(false);
  };

  const toggleShuffleOnOpen = async () => {
    const next = !shuffleOnOpen;
    setShuffleOnOpenState(next);
    const saved = await setShuffleOnOpen(next);
    setShuffleNotice({
      kind: saved ? 'ok' : 'error',
      text: saved
        ? next
          ? 'Auto-shuffle ON - a random wallpaper is set each time you open FrogPaper.'
          : 'Auto-shuffle OFF.'
        : 'Could not save the setting.',
    });
  };

  const actions = [
    {
      label: 'Generate a wallpaper',
      sub: 'Turn a text prompt into art',
      onPress: () => navigation.navigate('Generate'),
    },
    {
      label: 'Browse gallery',
      sub:
        status.info && status.info.images_count !== undefined
          ? `${status.info.images_count} wallpapers on the server`
          : 'Your saved wallpapers',
      onPress: () => navigation.navigate('Gallery'),
    },
    {
      label: 'Settings',
      sub: 'Connection and provider details',
      onPress: () => navigation.navigate('Settings'),
    },
  ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={
        <RefreshControl
          refreshing={checking}
          onRefresh={checkBackend}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>FP</Text>
        </View>
        <Text style={styles.heroTitle}>FrogPaper</Text>
        <Text style={styles.heroTagline}>AI wallpaper studio for your phone</Text>
      </View>

      <View style={[styles.statusCard, !online && styles.statusCardOffline]}>
        {checking ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusText}>{online ? 'Backend online' : 'Backend offline'}</Text>
              <Text style={styles.statusDetail}>
                {online
                  ? `${getBaseUrl()}  |  ${status.info.images_count} images  |  v${status.info.version}`
                  : `Cannot reach ${getBaseUrl()}. Check Settings for connection options.`}
              </Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.actionList}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.actionCard}
            onPress={action.onPress}
            activeOpacity={0.8}
          >
            <Text style={styles.actionLabel}>{action.label}</Text>
            <Text style={styles.actionSub}>{action.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Wallpaper shuffle</Text>
      <View style={styles.actionList}>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={doShuffle}
          activeOpacity={0.8}
          disabled={shuffling}
        >
          {shuffling ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Text style={styles.actionLabel}>Shuffle wallpaper now</Text>
              <Text style={styles.actionSub}>
                Pick a random gallery image and set it as your wallpaper
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, shuffleOnOpen && styles.actionCardActive]}
          onPress={toggleShuffleOnOpen}
          activeOpacity={0.8}
        >
          <Text style={styles.actionLabel}>
            Shuffle on app open: {shuffleOnOpen ? 'ON' : 'OFF'}
          </Text>
          <Text style={styles.actionSub}>
            {shuffleOnOpen
              ? 'A random wallpaper is set every time you open FrogPaper'
              : 'Tap to turn on automatic wallpaper changes'}
          </Text>
        </TouchableOpacity>
      </View>

      {shuffleNotice !== null && (
        <Text
          style={[
            styles.shuffleNotice,
            shuffleNotice.kind === 'error' ? styles.shuffleNoticeError : null,
          ]}
        >
          {shuffleNotice.text}
        </Text>
      )}

      <Text style={styles.footer}>Pull down to re-check the backend connection.</Text>
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
  hero: {
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  heroBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroBadgeText: {
    color: colors.bg,
    fontSize: 24,
    fontWeight: '800',
  },
  heroTitle: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
  },
  heroTagline: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.accentDim,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  statusCardOffline: {
    borderColor: colors.danger,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotOnline: {
    backgroundColor: colors.accent,
  },
  dotOffline: {
    backgroundColor: colors.danger,
  },
  statusTextWrap: {
    flex: 1,
  },
  statusText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  statusDetail: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  actionList: {
    gap: spacing.md,
  },
  actionCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  actionCardActive: {
    borderColor: colors.accent,
  },
  actionLabel: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  actionSub: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    marginLeft: spacing.xs,
  },
  shuffleNotice: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  shuffleNoticeError: {
    color: colors.danger,
  },
  footer: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});