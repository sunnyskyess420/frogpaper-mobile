// Home - landing screen with live backend status and quick actions.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { shuffleWallpaperOnce, getShuffleOnOpen } from '../services/shuffle';
import { dailyPhase, runDailyWallpaper } from '../services/dailyWallpaper';
import { describeQueueRun, listQueue, processQueue } from '../services/generationQueue';
import { colors, radii, spacing } from '../theme';

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState({ state: 'checking', info: null });
  const autoShuffledRef = useRef(false);

  // ---- Queued generations (saved while the backend was unreachable) -------
  const [queueCount, setQueueCount] = useState(0);
  const [queueNotice, setQueueNotice] = useState(null);
  const queueRunRef = useRef(false);
  const queueRunningRef = useRef(false);

  // ---- Daily auto-wallpaper (opt-in, off by default) --------------------
  // Phases: 'hidden' (off) | 'running' | 'done' | 'already-run' |
  //         'cooldown' | 'failed'
  const [daily, setDaily] = useState({ phase: 'hidden' });
  const dailyBusyRef = useRef(false);
  const onlineRef = useRef(false);

  const refreshQueueCount = useCallback(async () => {
    try {
      setQueueCount((await listQueue()).length);
    } catch (err) {
      // the count is informational - never break Home over it
    }
  }, []);

  // Runs the queue once per app open, best-effort and quiet like the
  // shuffle-on-open in checkBackend below. Entries the server already refused
  // are skipped: only the explicit "Run queued" button on Generate retries those.
  const runQueueOnce = useCallback(async () => {
    if (queueRunRef.current || queueRunningRef.current) {
      return;
    }
    let pending = [];
    try {
      pending = await listQueue();
    } catch (err) {
      return;
    }
    if (pending.length === 0) {
      setQueueCount(0);
      return;
    }
    queueRunRef.current = true;
    queueRunningRef.current = true;
    setQueueNotice({ kind: 'ok', text: `Generating ${pending.length} queued wallpaper(s)...` });
    try {
      const summary = await processQueue({ includeFailed: false });
      setQueueNotice({
        kind: summary.succeeded.length > 0 ? 'ok' : 'error',
        text: describeQueueRun(summary),
      });
    } catch (err) {
      setQueueNotice({
        kind: 'error',
        text: (err && err.message) || 'Could not run the queued requests.',
      });
    } finally {
      queueRunningRef.current = false;
      await refreshQueueCount();
    }
  }, [refreshQueueCount]);

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
        // Wallpapers queued while offline are owed to the user - run them
        // now that the backend answers (not awaited: this can take minutes).
        runQueueOnce();
      }
    } catch (error) {
      setStatus({ state: 'offline', info: null });
    }
  }, [runQueueOnce]);

  useEffect(() => {
    checkBackend();
    refreshQueueCount();
  }, [checkBackend, refreshQueueCount]);

  // Daily auto-wallpaper: only ever generates when the user turned it on in
  // Settings. Runs on the first open of the day while the backend is online.
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
      refreshQueueCount(); // the user may have queued a prompt on Generate
      return () => {};
    }, [refreshDaily, refreshQueueCount])
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
        <Image
          source={require('../../assets/mascot.png')}
          style={styles.heroMascot}
          resizeMode="contain"
        />
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

      {queueCount > 0 && (
        <View style={styles.queueCard}>
          <Text style={styles.queueCountText}>
            {queueCount} waiting to generate
          </Text>
          <Text style={styles.queueSubText}>
            Saved on this phone from an offline session. They run while the app is open -
            tap "Run queued" on the Generate screen to retry now.
          </Text>
        </View>
      )}

      {queueNotice !== null && (
        <Text
          style={[
            styles.notice,
            queueNotice.kind === 'error' ? styles.noticeError : null,
          ]}
        >
          {queueNotice.text}
        </Text>
      )}

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
  // The frog mascot replaces the old "FP" tile. Fixed box + contain so the
  // tall artwork never distorts.
  heroMascot: {
    width: 76,
    height: 120,
    marginBottom: spacing.md,
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
  queueCard: {
    backgroundColor: colors.card,
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  queueCountText: {
    color: colors.warn,
    fontSize: 15,
    fontWeight: '700',
  },
  queueSubText: {
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
  notice: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  noticeError: {
    color: colors.danger,
  },
  footer: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});