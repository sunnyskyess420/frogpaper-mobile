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
import { loadRotation, runOnLaunch } from '../services/wallpaperRotation';
import { describeQueueRun, listQueue, processQueue } from '../services/generationQueue';
import { colors, radii, spacing } from '../theme';

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState({ state: 'checking', info: null });
  // Guards the merged wallpaper rotation so it can only fire once per app
  // launch, no matter how often the backend check re-runs (pull-to-refresh).
  const rotationRanRef = useRef(false);

  // ---- Queued generations (saved while the backend was unreachable) -------
  const [queueCount, setQueueCount] = useState(0);
  const [queueNotice, setQueueNotice] = useState(null);
  const queueRunRef = useRef(false);
  const queueRunningRef = useRef(false);

  // ---- Wallpaper rotation (off / every open / once a day) ----------------
  // Phases: 'hidden' (nothing happened) | 'running' | 'done' | 'already-run' |
  //         'cooldown' | 'failed'
  const [rotation, setRotation] = useState({ phase: 'hidden' });

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

  // The merged wallpaper rotation: one call decides whether this launch is
  // due and does the work (generate/save/set or random-from-gallery). Guarded
  // so it runs at most once per app launch, however often Home re-checks.
  const runRotationOnce = useCallback(async () => {
    if (rotationRanRef.current) {
      return;
    }
    rotationRanRef.current = true;

    let info;
    try {
      info = await loadRotation();
    } catch (err) {
      info = { frequency: 'off', source: 'surprise' };
    }
    if (info.frequency === 'off') {
      setRotation({ phase: 'hidden' });
      return;
    }

    // Generating takes a minute or two, so show the progress card; a gallery
    // shuffle is instant and stays quiet unless it fails.
    const generates = info.source !== 'gallery';
    if (generates) {
      setRotation({ phase: 'running' });
    }

    const result = await runOnLaunch().catch((err) => ({
      ok: false,
      acted: true,
      message: (err && err.message) || 'Could not change the wallpaper.',
    }));

    if (result.acted) {
      if (!result.ok) {
        setRotation({ phase: 'failed', message: result.message });
      } else if (generates) {
        setRotation({ phase: 'done' });
      } else {
        setRotation({ phase: 'hidden' });
      }
      return;
    }
    if (result.reason === 'already-run' && result.frequency === 'daily') {
      setRotation({ phase: 'already-run' });
      return;
    }
    if (result.reason === 'cooldown') {
      setRotation({ phase: 'cooldown' });
      return;
    }
    setRotation({ phase: 'hidden' });
  }, []);

  const checkBackend = useCallback(async () => {
    setStatus({ state: 'checking', info: null });
    try {
      const health = await api.health();
      setStatus({ state: 'online', info: health });
      // Wallpapers queued while offline are owed to the user - run them now
      // that the backend answers (not awaited: this can take minutes, and it
      // must not wait for a wallpaper generation below).
      runQueueOnce();
      // Change the wallpaper if the rotation setting says this launch is due.
      // Best-effort and silent on success - never blocks startup.
      await runRotationOnce();
    } catch (error) {
      setStatus({ state: 'offline', info: null });
    }
  }, [runRotationOnce, runQueueOnce]);

  useEffect(() => {
    checkBackend();
    refreshQueueCount();
  }, [checkBackend, refreshQueueCount]);

  useFocusEffect(
    useCallback(() => {
      refreshQueueCount(); // the user may have queued a prompt on Generate
      return () => {};
    }, [refreshQueueCount])
  );

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

      {rotation.phase !== 'hidden' && (
        <View style={[styles.dailyCard, rotation.phase === 'failed' && styles.dailyCardFailed]}>
          {rotation.phase === 'running' ? (
            <>
              <ActivityIndicator color={colors.accent} />
              <View style={styles.statusTextWrap}>
                <Text style={styles.dailyTitle}>Painting your new wallpaper...</Text>
                <Text style={styles.dailySub}>
                  The cloud is creating a fresh wallpaper and setting it for you. This can
                  take a minute or two.
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.dailyEmoji}>
                {rotation.phase === 'done' || rotation.phase === 'already-run'
                  ? '\u2705'
                  : rotation.phase === 'cooldown'
                    ? '\u23F3'
                    : '\u26A0\uFE0F'}
              </Text>
              <View style={styles.statusTextWrap}>
                <Text style={styles.dailyTitle}>
                  {rotation.phase === 'done'
                    ? 'Your new wallpaper is set!'
                    : rotation.phase === 'already-run'
                      ? "Today's wallpaper is already set"
                      : rotation.phase === 'cooldown'
                        ? 'Wallpaper change hit a snag'
                        : 'Could not change the wallpaper'}
                </Text>
                <Text style={styles.dailySub}>
                  {rotation.phase === 'done'
                    ? 'FrogPaper changed it automatically on this launch.'
                    : rotation.phase === 'already-run'
                      ? 'FrogPaper changes it once a day - come back tomorrow.'
                      : rotation.phase === 'cooldown'
                        ? 'FrogPaper will try again next time you open the app.'
                        : rotation.message || 'Check your connection and try again.'}
                </Text>
              </View>
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