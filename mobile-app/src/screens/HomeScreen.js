// Home - landing screen with live backend status and quick actions.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
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
import { getGallerySource, PHONE as PHONE_SOURCE } from '../services/gallerySource';
import { localImageCount } from '../services/localGallery';
import { readCachedUpdate, refreshUpdateIfStale } from '../services/updateState';
import { RELEASES_URL, shouldPromptUpdate } from '../services/updateCheck';
import { hasSeenWelcome } from '../services/firstRun';
import { shuffleWallpaperOnce } from '../services/shuffle';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage key for the version string the user dismissed with "Later" or
// "Get update". A newer version later must re-prompt, so we store the
// version (not a boolean) - the decision helper compares it to record.latest.
const UPDATE_DISMISSED_KEY = '@frogpaper/update_prompt_dismissed';

// Formats retryAt as a local-time "Retrying after 3:40 PM" sentence, or
// returns an empty string when there is no concrete time to show. The
// device's own locale and timezone drive the format so the user reads a
// time that matches their clock, not a UTC value.
function retryAfterText(retryAt, prefix = 'Retrying after ') {
  if (typeof retryAt !== 'number' || !Number.isFinite(retryAt)) {
    return '';
  }
  try {
    const formatted = new Date(retryAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${prefix}${formatted}.`;
  } catch (err) {
    return '';
  }
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState({ state: 'checking', info: null });
  // Subtitle for the gallery card. Null means the server wording, which is
  // derived from the health check below.
  const [phoneGallerySub, setPhoneGallerySub] = useState(null);
  // Guards the merged wallpaper rotation so it can only fire once per app
  // launch, no matter how often the backend check re-runs (pull-to-refresh).
  const rotationRanRef = useRef(false);

  // A newer FrogPaper release has been seen (a small dot on the Settings card).
  const [updateReady, setUpdateReady] = useState(false);
  // Result text for the "New wallpaper now" button.
  const [shuffleNotice, setShuffleNotice] = useState(null);

  // ---- One-time update prompt (per release version) ----------------------
  // The first launch after a newer release shows a modal. "Later" or
  // "Get update" persists the dismissed version, so the modal stays quiet
  // for that release - but a still newer release later must prompt again,
  // so we store the version string (not a boolean) and compare it to the
  // record's `latest`. Never shows during the welcome walkthrough or for
  // current / offline / no-releases states.
  const [updateModal, setUpdateModal] = useState(null); // { latest, url } | null

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
        setRotation({
          phase: 'failed',
          message: result.message,
          retryAt: typeof result.retryAt === 'number' ? result.retryAt : null,
        });
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
      setRotation({
        phase: 'cooldown',
        retryAt: typeof result.retryAt === 'number' ? result.retryAt : null,
      });
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

  // The gallery source decides what this card advertises: the phone's own store,
  // or the server's count from the health check.
  const refreshGallerySub = useCallback(async () => {
    try {
      const source = await getGallerySource();
      if (source !== PHONE_SOURCE) {
        setPhoneGallerySub(null);
        return;
      }
      const count = await localImageCount();
      setPhoneGallerySub(count === 1 ? '1 wallpaper on this phone' : `${count} wallpapers on this phone`);
    } catch (error) {
      setPhoneGallerySub('Your saved wallpapers');
    }
  }, []);

  useEffect(() => {
    checkBackend();
    refreshQueueCount();
    refreshGallerySub();
  }, [checkBackend, refreshQueueCount, refreshGallerySub]);

  // Ask GitHub at most once a day whether a newer FrogPaper is out. Quiet,
  // best-effort and never blocks startup; the answer is remembered on the device
  // so the launch after a check is instant.
  useEffect(() => {
    let alive = true;
    refreshUpdateIfStale()
      .then(async (state) => {
        if (!alive) {
          return;
        }
        setUpdateReady(!!state && state.state === 'update');
        // The one-time modal: show only when the latest release differs
        // from the version the user already dismissed. The welcome
        // walkthrough takes priority - the modal would be lost behind it
        // anyway, and we never want to bother a first-time user before
        // they have seen the app. Never throws, never blocks startup.
        try {
          const seenWelcome = await hasSeenWelcome();
          if (!seenWelcome) {
            return;
          }
          const dismissed = await AsyncStorage.getItem(UPDATE_DISMISSED_KEY);
          if (shouldPromptUpdate(state, dismissed)) {
            setUpdateModal({
              latest: state.latest,
              url: typeof state.url === 'string' ? state.url : RELEASES_URL,
            });
          }
        } catch (err) {
          // best-effort: never block the screen on this
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // "Get update" opens the GitHub release page in the device browser. We
  // persist the dismissed version before opening so the modal cannot come
  // back on the next launch even if the user never returns to the app - the
  // browser is the intended next step. The button is the ONLY thing that
  // opens the browser; the modal never opens it on its own.
  const getUpdate = useCallback(async () => {
    const target = updateModal;
    setUpdateModal(null);
    if (!target) {
      return;
    }
    try {
      await AsyncStorage.setItem(UPDATE_DISMISSED_KEY, target.latest);
    } catch (err) {
      // best-effort - if the write fails the user just sees the modal again
    }
    const url = target.url || RELEASES_URL;
    Linking.openURL(url).catch(() => {
      // Silently ignore - the device may not have a browser configured.
      // The release URL is in the modal body so the user can type it.
    });
  }, [updateModal]);

  // "Later" persists the dismissed version and closes the modal. The same
  // version will not re-prompt; a newer one will, via shouldPromptUpdate's
  // string comparison in the effect above.
  const dismissUpdate = useCallback(async () => {
    const target = updateModal;
    setUpdateModal(null);
    if (!target) {
      return;
    }
    try {
      await AsyncStorage.setItem(UPDATE_DISMISSED_KEY, target.latest);
    } catch (err) {
      // best-effort - see getUpdate above
    }
  }, [updateModal]);

  // One-tap "set a random wallpaper now".
  const shuffleNow = useCallback(async () => {
    setShuffleNotice('Setting a random wallpaper...');
    const result = await shuffleWallpaperOnce().catch((err) => ({
      ok: false,
      message: (err && err.message) || 'Could not change the wallpaper.',
    }));
    setShuffleNotice(result.message);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshQueueCount(); // the user may have queued a prompt on Generate
      refreshGallerySub(); // and may have imported wallpapers from the SD card
      // Reflect an update the Settings card may have just found.
      readCachedUpdate()
        .then((cached) => setUpdateReady(!!cached && cached.state === 'update'))
        .catch(() => {});
      return () => {};
    }, [refreshQueueCount, refreshGallerySub])
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
        phoneGallerySub !== null
          ? phoneGallerySub
          : status.info && status.info.images_count !== undefined
            ? `${status.info.images_count} wallpapers on the server`
            : 'Your saved wallpapers',
      onPress: () => navigation.navigate('Gallery'),
    },
    {
      label: 'New wallpaper now',
      sub: shuffleNotice || 'Set a random wallpaper from your gallery',
      onPress: shuffleNow,
    },
    {
      label: 'Prompt history',
      sub: 'Reuse a prompt you have used before',
      onPress: () => navigation.navigate('History'),
    },
    {
      label: 'Settings',
      sub: updateReady
        ? 'A new version of FrogPaper is ready - open Settings to get it'
        : 'Connection and provider details',
      badge: updateReady,
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
                        ? retryAfterText(rotation.retryAt)
                        : rotation.message
                          ? `${rotation.message}${retryAfterText(rotation.retryAt, 'Retrying after ')}`
                          : `Check your connection and try again.${retryAfterText(rotation.retryAt, ' Retrying after ')}`}
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
            <View style={styles.actionLabelRow}>
              <Text style={styles.actionLabel}>{action.label}</Text>
              {action.badge ? <View style={styles.updateDot} /> : null}
            </View>
            <Text style={styles.actionSub}>{action.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.footer}>Pull down to re-check the backend connection.</Text>

      {/* The one-time-per-release update prompt. The buttons persist the
          dismissed version before the modal closes; "Get update" is the
          only path that opens the browser. */}
      <Modal
        visible={updateModal !== null}
        transparent
        animationType="fade"
        onRequestClose={dismissUpdate}
      >
        <View style={styles.updateModalOverlay}>
          <View style={styles.updateModalCard}>
            <Text style={styles.updateModalTitle}>
              FrogPaper {updateModal ? updateModal.latest : ''} is available
            </Text>
            <Text style={styles.updateModalBody}>
              A new release is ready to install - tap Get update to open the
              download page, or Later to keep this version. FrogPaper will
              remind you the next time a newer release ships.
            </Text>
            <View style={styles.updateModalButtons}>
              <Pressable style={styles.updateModalLater} onPress={dismissUpdate}>
                <Text style={styles.updateModalLaterText}>Later</Text>
              </Pressable>
              <Pressable style={styles.updateModalGet} onPress={getUpdate}>
                <Text style={styles.updateModalGetText}>Get update</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  actionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // The small "update ready" dot beside the Settings label.
  updateDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
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
  // One-time update prompt: dimmed full-screen overlay with a centred card.
  // Mirrors the theme the rest of Home uses (card background, accent for
  // the primary action, muted text) so the modal reads as part of the app.
  updateModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  updateModalCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderColor: colors.accentDim,
    borderWidth: 1,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 380,
  },
  updateModalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  updateModalBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  updateModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  updateModalLater: {
    backgroundColor: colors.cardAlt,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  updateModalLaterText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  updateModalGet: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  updateModalGetText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '800',
  },
});