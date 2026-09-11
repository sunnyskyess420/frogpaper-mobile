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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import api, { getBaseUrl } from '../services/api';
import { dailyPhase, runDailyWallpaper } from '../services/dailyWallpaper';
import { colors, radii, spacing } from '../theme';

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState({ state: 'checking', info: null });

  const checkBackend = useCallback(async () => {
    setStatus({ state: 'checking', info: null });
    try {
      const health = await api.health();
      setStatus({ state: 'online', info: health });
    } catch (error) {
      setStatus({ state: 'offline', info: null });
    }
  }, []);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  // ---- Daily auto-wallpaper ---------------------------------------------
  // Phases: 'hidden' (off) | 'running' | 'done' | 'already-run' |
  //         'cooldown' | 'failed'
  const [daily, setDaily] = useState({ phase: 'hidden' });
  const dailyBusyRef = useRef(false);
  const onlineRef = useRef(false);

  const refreshDaily = useCallback(async () => {
    if (dailyBusyRef.current || !onlineRef.current) {
      return;
    }
    try {
      const { phase } = await dailyPhase();
      if (phase === 'hidden') {
        setDaily({ phase: 'hidden' });
        return;
      }
      if (phase === 'due') {
        dailyBusyRef.current = true;
        setDaily({ phase: 'running' });
        const result = await runDailyWallpaper();
        dailyBusyRef.current = false;
        setDaily(
          result.kind === 'ok'
            ? { phase: 'done', result }
            : { phase: 'failed', result }
        );
        return;
      }
      setDaily({ phase }); // 'already-run' | 'cooldown'
    } catch (err) {
      setDaily({ phase: 'hidden' }); // never let the daily feature break Home
    }
  }, []);

  useEffect(() => {
    onlineRef.current = status.state === 'online';
    if (onlineRef.current) {
      refreshDaily();
    } else {
      setDaily((prev) => (prev.phase === 'running' ? prev : { phase: 'hidden' }));
    }
  }, [status.state, refreshDaily]);

  useFocusEffect(
    useCallback(() => {
      // Re-check when the user returns to Home (e.g. after enabling the
      // feature in Settings) - the status effect only fires on state change.
      refreshDaily();
      return () => {};
    }, [refreshDaily])
  );

  const makeDailyNow = async () => {
    if (dailyBusyRef.current) {
      return;
    }
    dailyBusyRef.current = true;
    setDaily({ phase: 'running' });
    const result = await runDailyWallpaper({ force: true });
    dailyBusyRef.current = false;
    setDaily(
      result.kind === 'ok'
        ? { phase: 'done', result }
        : { phase: 'failed', result }
    );
  };

  const online = status.state === 'online';
  const checking = status.state === 'checking';

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
                  : `Cannot reach ${getBaseUrl()}. Start the backend with: cd backend, then python app.py`}
              </Text>
            </View>
          </>
        )}
      </View>

      {daily.phase !== 'hidden' && (
        <View style={[styles.dailyCard, daily.phase === 'failed' && styles.dailyCardFailed]}>
          {daily.phase === 'running' ? (
            <>
              <ActivityIndicator color={colors.accent} />
              <View style={styles.statusTextWrap}>
                <Text style={styles.dailyTitle}>Painting today's wallpaper...</Text>
                <Text style={styles.dailySub}>
                  The cloud is creating a fresh wallpaper and setting it for you. This can
                  take a minute or two.
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.dailyEmoji}>
                {daily.phase === 'done' || daily.phase === 'already-run'
                  ? '\u2705'
                  : daily.phase === 'cooldown'
                    ? '\u23F3'
                    : '\u26A0\uFE0F'}
              </Text>
              <View style={styles.statusTextWrap}>
                <Text style={styles.dailyTitle}>
                  {daily.phase === 'done' || daily.phase === 'already-run'
                    ? "Today's fresh wallpaper is set!"
                    : daily.phase === 'cooldown'
                      ? 'Daily wallpaper hit a snag'
                      : 'Daily wallpaper could not finish'}
                </Text>
                <Text style={styles.dailySub}>
                  {daily.phase === 'done' || daily.phase === 'already-run'
                    ? 'Come back tomorrow for another surprise.'
                    : daily.phase === 'cooldown'
                      ? 'FrogPaper will try again next time you open the app.'
                      : (daily.result && daily.result.message) ||
                        'Check your connection and try again.'}
                </Text>
              </View>
              {(daily.phase === 'failed' ||
                daily.phase === 'cooldown' ||
                daily.phase === 'already-run') && (
                <TouchableOpacity
                  style={styles.dailyButton}
                  onPress={makeDailyNow}
                  activeOpacity={0.8}
                >
                  <Text style={styles.dailyButtonText}>
                    {daily.phase === 'already-run' ? 'Another' : 'Try now'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

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
  dailyCard: {
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
  dailyCardFailed: {
    borderColor: colors.warn,
  },
  dailyEmoji: {
    fontSize: 22,
  },
  dailyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  dailySub: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  dailyButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  dailyButtonText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '800',
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
  footer: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
