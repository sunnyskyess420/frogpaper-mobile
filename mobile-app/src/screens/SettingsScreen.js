// Settings - backend connection info, provider details, about, diagnostics.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import api, {
  discoverBaseUrl,
  getBaseUrl,
  getCustomServerUrl,
  setCustomServerUrl,
  getAccessKey,
  setAccessKey,
  getGeminiKey,
  setGeminiKey,
  getHfToken,
  setHfToken,
  getReplicateToken,
  setReplicateToken,
  getByokSnapshot,
} from '../services/api';
import {
  forceTestCrash,
  getEffectiveDsn,
  getRuntimeDsn,
  getRuntimeEnvironment,
  isInitialized,
  reinitSentry,
  sendTestEvent,
  setRuntimeDsn,
  setRuntimeEnvironment,
} from '../services/sentry';
import * as Clipboard from 'expo-clipboard';
import {
  clearErrors as clearErrorLog,
  describeErrorEntry,
  errorCount as errorLogCount,
  listErrors as listErrorLog,
  recordError,
} from '../services/errorLog';
import Constants from 'expo-constants';
import { resetWelcome } from '../services/firstRun';
import { colors, radii, spacing } from '../theme';

// One source of truth: app.json's version. The About summary used to be a
// hardcoded string, which sat at 1.9.39 for several releases after the app had
// moved on - reading it here means it cannot drift again.
const APP_VERSION =
  (Constants.expoConfig && Constants.expoConfig.version) || 'unknown';
import {
  changeNow as runWallpaperChangeNow,
  loadRotation,
  savedFavoriteCount,
  setFrequency,
  setSource,
} from '../services/wallpaperRotation';
import {
  FOLDER,
  chooseSaveFolder,
  getSaveTarget,
  usePhoneGallery,
} from '../services/saveTarget';
import { clearCache, getCacheStats } from '../services/imageCache';
import { clearQueue, listQueue } from '../services/generationQueue';
import {
  PHONE,
  SERVER,
  getGallerySource,
  setGallerySource,
} from '../services/gallerySource';
import {
  describeImport,
  importFromFolder,
  localImageCount,
} from '../services/localGallery';
import ByokHelpModal from '../components/ByokHelpModal';

function formatMegabytes(bytes) {
  return `${((bytes || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

// One collapsible Settings card: a tappable header (uppercase label, one-line
// summary, chevron) and a body that is unmounted while collapsed, so the
// screen really is short when you are just scanning it.
function SettingsCard({ title, summary, summaryDotStyle, open, onPress, children }) {
  return (
    <View style={styles.card}>
      <Pressable
        style={styles.cardHeader}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.cardHeaderText}>
          <Text style={[styles.sectionLabel, styles.cardTitle]}>{title}</Text>
          <View style={styles.cardSummaryRow}>
            {summaryDotStyle ? (
              <View style={[styles.dot, styles.dotSmall, summaryDotStyle]} />
            ) : null}
            <Text style={styles.cardSummary} numberOfLines={1}>
              {summary}
            </Text>
          </View>
        </View>
        <Text style={styles.chevron}>{open ? '\u25BE' : '\u25B8'}</Text>
      </Pressable>
      {open ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  // Kept separate from the big settings state object: the error log is
  // read-mostly and its failures must never disturb the rest of the screen.
  const [errorLog, setErrorLog] = useState({ count: 0, entries: [], show: false });

  const refreshErrorLog = useCallback(async () => {
    try {
      const count = await errorLogCount();
      setErrorLog((prev) => ({ ...prev, count }));
    } catch (error) {
      // ignore
    }
  }, []);

  const toggleErrorLog = useCallback(async () => {
    if (errorLog.show) {
      setErrorLog((prev) => ({ ...prev, show: false }));
      return;
    }
    try {
      const entries = await listErrorLog();
      setErrorLog((prev) => ({ ...prev, entries, show: true }));
    } catch (error) {
      // ignore
    }
  }, [errorLog.show]);

  const copyErrorLog = useCallback(async () => {
    try {
      const entries = await listErrorLog();
      const text = entries.length
        ? entries.map((entry) => describeErrorEntry(entry)).join('\n\n')
        : 'No errors recorded.';
      await Clipboard.setStringAsync(text);
      setErrorLog((prev) => ({ ...prev, entries, show: true }));
    } catch (error) {
      // ignore
    }
  }, []);

  const confirmClearErrorLog = useCallback(() => {
    Alert.alert(
      'Clear the error log?',
      'This removes the recorded errors from this phone. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearErrorLog();
            setErrorLog({ count: 0, entries: [], show: false });
          },
        },
      ]
    );
  }, []);

  const showWelcomeAgain = useCallback(async () => {
    await resetWelcome();
    Alert.alert('Welcome guide', 'It will appear the next time you open FrogPaper.');
  }, []);

  const recordTestError = useCallback(async () => {
    await recordError(new Error('Test error recorded from Settings'), 'test');
    await refreshErrorLog();
  }, [refreshErrorLog]);

  const [state, setState] = useState({
    loading: true,
    health: null,
    providers: [],
    error: null,
    customUrl: '',
    accessKey: '',
    // BYOK keys - local-only, sent as headers on generate requests.
    // These hold whatever the user has typed (so they can edit before
    // tapping Save), not necessarily the saved value.
    userGeminiKey: '',
    userHfToken: '',
    userReplicateToken: '',
    // BYOK status row: which keys are currently saved (true/false per provider).
    byokStatus: { gemini: false, huggingface: false, replicate: false },
    // Help modal visibility (opened from "How do I get API keys?" button).
    byokHelpVisible: false,
    sentryDsn: '',
    sentryEnv: '',
    sentryStatus: 'not initialized',
    sentryEffectiveDsn: '',
    diagnosticsRevealed: true,
    crashTapCount: 0,
    testEventFeedback: '',
    testEventTime: null, byokHelpVisible: false,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      await discoverBaseUrl();
      const [
        health,
        providersResponse,
        accessKeyValue,
        runtimeDsn,
        runtimeEnv,
        geminiKey,
        hfToken,
        replicateToken,
      ] = await Promise.all([
        api.health(),
        api.providers(),
        getAccessKey(),
        getRuntimeDsn(),
        getRuntimeEnvironment(),
        getGeminiKey(),
        getHfToken(),
        getReplicateToken(),
      ]);
      const customUrl = await getCustomServerUrl();
      const byok = getByokSnapshot();
      setState({
        loading: false,
        health,
        providers: providersResponse.providers || [],
        error: null,
        customUrl: customUrl || '',
        accessKey: accessKeyValue || '',
        userGeminiKey: geminiKey || '',
        userHfToken: hfToken || '',
        userReplicateToken: replicateToken || '',
        byokStatus: {
          gemini: !!byok.gemini,
          huggingface: !!byok.huggingface,
          replicate: !!byok.replicate,
        },
        sentryDsn: runtimeDsn || '',
        sentryEnv: runtimeEnv || '',
        sentryStatus: isInitialized() ? 'initialized' : 'not initialized',
        sentryEffectiveDsn: getEffectiveDsn() || '(no DSN)',
        diagnosticsRevealed: true,
        crashTapCount: 0,
        testEventFeedback: '',
        testEventTime: null, byokHelpVisible: false,
      });
    } catch (err) {
      const customUrl = await getCustomServerUrl();
      const accessKeyValue = await getAccessKey();
      const runtimeDsn = await getRuntimeDsn();
      const runtimeEnv = await getRuntimeEnvironment();
      const geminiKey = await getGeminiKey();
      const hfToken = await getHfToken();
      const replicateToken = await getReplicateToken();
      const byok = getByokSnapshot();
      setState({
        loading: false,
        health: null,
        providers: [],
        error: err.message || 'Backend unreachable',
        customUrl: customUrl || '',
        accessKey: accessKeyValue || '',
        userGeminiKey: geminiKey || '',
        userHfToken: hfToken || '',
        userReplicateToken: replicateToken || '',
        byokStatus: {
          gemini: !!byok.gemini,
          huggingface: !!byok.huggingface,
          replicate: !!byok.replicate,
        },
        sentryDsn: runtimeDsn || '',
        sentryEnv: runtimeEnv || '',
        sentryStatus: isInitialized() ? 'initialized' : 'not initialized',
        sentryEffectiveDsn: getEffectiveDsn() || '(no DSN)',
        diagnosticsRevealed: true,
        crashTapCount: 0,
        testEventFeedback: '',
        testEventTime: null, byokHelpVisible: false,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- Wallpaper rotation (off / every open / once a day) ----------------
  // One merged preference (services/wallpaperRotation.js) replaces the old
  // "daily wallpaper" switch and "shuffle on app open" switch.
  const [rotationState, setRotationState] = useState({
    frequency: 'off',
    source: 'surprise',
    favorites: 0,
    ready: false,
  });
  const [rotating, setRotating] = useState(false);
  const [rotationNotice, setRotationNotice] = useState(null);

  const refreshRotation = useCallback(async () => {
    try {
      const [rotation, favorites] = await Promise.all([
        loadRotation(),
        savedFavoriteCount(),
      ]);
      setRotationState({
        frequency: rotation.frequency,
        source: rotation.source,
        favorites,
        ready: true,
      });
    } catch (err) {
      setRotationState((prev) => ({ ...prev, ready: true })); // never block Settings
    }
  }, []);

  // Re-read on focus: the user may have just starred a prompt on Generate,
  // which changes the "My favourites" prerequisite hint.
  useFocusEffect(
    useCallback(() => {
      refreshErrorLog();
      refreshRotation();
      return () => {};
    }, [refreshRotation])
  );

  const chooseFrequency = async (frequency) => {
    setRotationState((prev) => ({ ...prev, frequency }));
    await setFrequency(frequency);
  };

  const chooseRotationSource = async (source) => {
    setRotationState((prev) => ({ ...prev, source }));
    const updated = await setSource(source);
    setRotationState((prev) => ({ ...prev, source: updated.source }));
  };

  const changeWallpaperNow = async () => {
    if (rotating) {
      return;
    }
    setRotating(true);
    setRotationNotice(null);
    const result = await runWallpaperChangeNow();
    setRotationNotice({ kind: result.ok ? 'ok' : 'error', text: result.message });
    setRotating(false);
  };

  // ---- Save location (phone gallery or an SD-card folder) -----------------
  // Only Android can pick a folder (Storage Access Framework); read the stored
  // choice on every platform so the row always shows where saves land.
  const [saveTarget, setSaveTarget] = useState({
    target: 'gallery',
    folderName: null,
  });

  useEffect(() => {
    getSaveTarget()
      .then((chosen) => setSaveTarget({ target: chosen.target, folderName: chosen.folderName }))
      .catch(() => {}); // preference is optional - never block Settings
  }, []);

  const chooseFolder = async () => {
    try {
      const result = await chooseSaveFolder();
      if (result.cancelled) {
        return; // user backed out of the picker - keep the current target
      }
      setSaveTarget({ target: FOLDER, folderName: result.name });
    } catch (err) {
      Alert.alert(
        'Could not use that folder',
        err.message || 'Android did not grant access to the folder. Try again.'
      );
    }
  };

  const resetToGallery = async () => {
    await usePhoneGallery();
    setSaveTarget({ target: 'gallery', folderName: null });
  };

  // ---- Gallery source (the phone's own store, or the server list) ---------
  const [gallerySource, setGallerySourceState] = useState(PHONE);
  const [galleryCount, setGalleryCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState(null);

  const refreshGallerySource = useCallback(async () => {
    try {
      const [source, count] = await Promise.all([getGallerySource(), localImageCount()]);
      setGallerySourceState(source);
      setGalleryCount(count);
    } catch (err) {
      // informational - never block Settings
    }
  }, []);

  useEffect(() => {
    refreshGallerySource();
  }, [refreshGallerySource]);

  const chooseGallerySource = async (next) => {
    setGallerySourceState(next);
    setImportNotice(null);
    const saved = await setGallerySource(next);
    setGallerySourceState(saved);
    await refreshGallerySource();
  };

  const importNow = async () => {
    if (importing) {
      return;
    }
    setImporting(true);
    setImportNotice(null);
    const result = await importFromFolder({ max: 40 });
    setImportNotice({ kind: result.ok ? 'ok' : 'error', text: describeImport(result) });
    await refreshGallerySource();
    setImporting(false);
  };

  // ---- Offline storage (cached images + queued generations) --------------
  const [offlineState, setOfflineState] = useState({ stats: { count: 0, bytes: 0 }, queue: 0 });

  const refreshOfflineState = useCallback(async () => {
    try {
      const [stats, queue] = await Promise.all([getCacheStats(), listQueue()]);
      setOfflineState({ stats, queue: queue.length });
    } catch (err) {
      // the numbers are informational - never block Settings on them
    }
  }, []);

  useEffect(() => {
    refreshOfflineState();
  }, [refreshOfflineState]);

  const confirmClearImages = () => {
    Alert.alert(
      'Clear saved wallpapers?',
      'Wallpapers saved on this phone for offline viewing are removed. They stay on the server and come back the next time the gallery loads.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearCache();
            await refreshOfflineState();
          },
        },
      ]
    );
  };

  const confirmClearQueue = () => {
    Alert.alert(
      'Clear the generation queue?',
      `${offlineState.queue} prompt(s) waiting to be generated will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            await refreshOfflineState();
          },
        },
      ]
    );
  };

  const online = state.health !== null;

  // Labels for the merged Wallpaper card.
  const saveLocationLabel = saveTarget.target === FOLDER ? 'saves to SD card' : 'saves to phone gallery';
  const frequencyLabel =
    rotationState.frequency === 'daily'
      ? 'Once a day'
      : rotationState.frequency === 'open'
        ? 'Every open'
        : 'Off';
  const sourceLabel =
    rotationState.source === 'surprise'
      ? 'surprise me'
      : rotationState.source === 'favorites'
        ? 'my favourites'
        : 'random from my gallery';
  const wallpaperSummary =
    rotationState.frequency === 'off'
      ? `Off · ${saveLocationLabel}`
      : `${frequencyLabel} · ${sourceLabel} · ${saveLocationLabel}`;
  const frequencyHint =
    rotationState.frequency === 'daily'
      ? 'On the first time you open FrogPaper each day, the wallpaper changes once - while the app is open, never in the background.'
      : rotationState.frequency === 'open'
        ? 'Every time you open FrogPaper, the wallpaper changes once - while the app is open, never in the background.'
        : 'FrogPaper never changes your wallpaper on its own.';
  const sourceHint =
    rotationState.source === 'surprise'
      ? 'A brand-new wallpaper painted from the surprise idea pool.'
      : rotationState.source === 'favorites'
        ? rotationState.favorites > 0
          ? `A brand-new wallpaper painted from one of your ${rotationState.favorites} saved favourite prompt${
              rotationState.favorites === 1 ? '' : 's'
            }.`
          : 'You have no favourites saved yet, so this falls back to the surprise idea pool. Star a prompt on the Generate screen to use your own.'
        : 'A random wallpaper already in your gallery - nothing new is generated.';
  const gallerySourceHint =
    gallerySource === PHONE
      ? 'Shows the wallpapers kept on this phone - the ones you generate, save or import. They stay even when the server storage is wiped.'
      : "Shows the list from the backend. That storage is wiped by every deploy, so the phone copy is the safer default.";

  // Which cards are expanded. Everyday settings start open; the technical
  // cards start collapsed so Settings reads at a glance.
  const [openCards, setOpenCards] = useState({
    connection: true,
    wallpaper: false,
    offline: false,
    keys: false,
    advanced: false,
    about: false,
  });

  const toggleCard = (key) => {
    setOpenCards((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCustomUrlChange = async (text) => {
    setState((prev) => ({ ...prev, customUrl: text }));
  };

  const saveCustomUrl = async () => {
    await setCustomServerUrl(state.customUrl);
    await refresh();
  };

  const clearCustomUrl = async () => {
    await setCustomServerUrl('');
    await refresh();
  };

  const handleAccessKeyChange = async (text) => {
    setState((prev) => ({ ...prev, accessKey: text }));
  };

  const saveAccessKey = async () => {
    await setAccessKey(state.accessKey);
    await refresh();
  };

  const clearAccessKey = async () => {
    await setAccessKey('');
    await refresh();
  };

  // --- BYOK (Bring Your Own Key) handlers ---------------------------------
  // Each provider has its own onChange / save / clear. Save persists the
  // key to AsyncStorage (and the in-memory cache) so it gets attached to
  // the next generate request. Clear wipes it from this device only.

  const handleGeminiKeyChange = (text) => {
    setState((prev) => ({ ...prev, userGeminiKey: text }));
  };

  const saveGeminiKey = async () => {
    await setGeminiKey(state.userGeminiKey);
    const byok = getByokSnapshot();
    setState((prev) => ({
      ...prev,
      byokStatus: { ...prev.byokStatus, gemini: !!byok.gemini },
    }));
    Alert.alert(
      'Gemini key saved',
      byok.gemini
        ? 'Your Gemini key is now used for every generate request that picks the Gemini provider.'
        : 'Gemini key cleared. The next generate will fall back to the server default.',
    );
  };

  const clearGeminiKey = async () => {
    await setGeminiKey('');
    setState((prev) => ({
      ...prev,
      userGeminiKey: '',
      byokStatus: { ...prev.byokStatus, gemini: false },
    }));
  };

  const handleHfTokenChange = (text) => {
    setState((prev) => ({ ...prev, userHfToken: text }));
  };

  const saveHfToken = async () => {
    await setHfToken(state.userHfToken);
    const byok = getByokSnapshot();
    setState((prev) => ({
      ...prev,
      byokStatus: { ...prev.byokStatus, huggingface: !!byok.huggingface },
    }));
    Alert.alert(
      'Hugging Face token saved',
      byok.huggingface
        ? 'Your Hugging Face token is now used for every generate request that picks the Hugging Face provider.'
        : 'Hugging Face token cleared. The next generate will fall back to the server default.',
    );
  };

  const clearHfToken = async () => {
    await setHfToken('');
    setState((prev) => ({
      ...prev,
      userHfToken: '',
      byokStatus: { ...prev.byokStatus, huggingface: false },
    }));
  };

  const handleReplicateTokenChange = (text) => {
    setState((prev) => ({ ...prev, userReplicateToken: text }));
  };

  const saveReplicateToken = async () => {
    await setReplicateToken(state.userReplicateToken);
    const byok = getByokSnapshot();
    setState((prev) => ({
      ...prev,
      byokStatus: { ...prev.byokStatus, replicate: !!byok.replicate },
    }));
    Alert.alert(
      'Replicate token saved',
      byok.replicate
        ? 'Your Replicate token is now used for every generate request that picks the Replicate provider.'
        : 'Replicate token cleared. The next generate will fall back to the server default.',
    );
  };

  const clearReplicateToken = async () => {
    await setReplicateToken('');
    setState((prev) => ({
      ...prev,
      userReplicateToken: '',
      byokStatus: { ...prev.byokStatus, replicate: false },
    }));
  };

  // Opens the in-app help modal that walks the user through getting free API
  // keys for Google Gemini, Hugging Face, and Replicate. This is the only
  // place users learn how to obtain keys - they won't see the GitHub README
  // if they installed from the website.
  const openByokHelp = () => {
    setState((prev) => ({ ...prev, byokHelpVisible: true }));
  };

  const closeByokHelp = () => {
    setState((prev) => ({ ...prev, byokHelpVisible: false }));
  };

  // --- Sentry / Diagnostics handlers ------------------------------------

  const handleSentryDsnChange = (text) => {
    setState((prev) => ({ ...prev, sentryDsn: text }));
  };

  const handleSentryEnvChange = (text) => {
    setState((prev) => ({ ...prev, sentryEnv: text }));
  };

  const saveSentryConfig = async () => {
    await setRuntimeDsn(state.sentryDsn);
    await setRuntimeEnvironment(state.sentryEnv);
    // For the new DSN to take effect we need to re-init. The Sentry RN
    // SDK can't reconfigure after init in-place, so this will refresh
    // the cache but the new DSN only fully activates after app restart.
    await reinitSentry();
    setState((prev) => ({
      ...prev,
      sentryStatus: isInitialized() ? 'initialized' : 'not initialized',
      sentryEffectiveDsn: getEffectiveDsn() || '(no DSN)',
    }));
    Alert.alert(
      'Sentry config saved',
      isInitialized()
        ? 'Sentry is active. Restart the app to apply the new DSN to the native SDK.'
        : 'Sentry is not yet active. Enter a valid DSN (https://...@...) and restart the app.',
    );
  };

  const clearSentryConfig = async () => {
    await setRuntimeDsn('');
    await setRuntimeEnvironment('');
    setState((prev) => ({
      ...prev,
      sentryDsn: '',
      sentryEnv: '',
      sentryStatus: isInitialized() ? 'initialized' : 'not initialized',
      sentryEffectiveDsn: getEffectiveDsn() || '(no DSN)',
    }));
    Alert.alert('Sentry config cleared', 'Sentry will be disabled on next app restart.');
  };

  // Hidden test-crash trigger: 5 taps on the About title reveals the
  // crash buttons. This keeps them out of the way for normal users but
  // easy for testers to surface.
  const bumpCrashTap = () => {
    setState((prev) => {
      const next = prev.crashTapCount + 1;
      if (next >= 5 && !prev.diagnosticsRevealed) {
        return { ...prev, crashTapCount: next, diagnosticsRevealed: true };
      }
      return { ...prev, crashTapCount: next };
    });
  };

  const sendTestEventNow = () => {
    const timestamp = new Date().toLocaleTimeString();
    console.log('[FrogPaper] Send test event button clicked at', timestamp);
    console.log('[FrogPaper] Sentry initialized?', isInitialized());
    console.log('[FrogPaper] Effective DSN:', getEffectiveDsn() || '(none)');

    if (!isInitialized()) {
      console.warn('[FrogPaper] Cannot send - Sentry not initialized');
      setState((prev) => ({
        ...prev,
        testEventFeedback: 'Sentry is NOT initialized. Paste your DSN above, tap Save, then refresh the page (F5).',
        testEventTime: timestamp,
      }));
      return;
    }

    try {
      const sent = sendTestEvent('FrogPaper Sentry test event - captureException');
      console.log('[FrogPaper] sendTestEvent returned:', sent);
      if (sent) {
        setState((prev) => ({
          ...prev,
          testEventFeedback: `✅ Test event sent at ${timestamp}. Check your Sentry dashboard in ~10-30 seconds.`,
          testEventTime: timestamp,
        }));
        // Try to flush events immediately (Sentry may batch by default)
        try {
          // Force Sentry to flush events now rather than batching
          // This is a best-effort - the SDK might not expose flush() in all versions
          // but we don't care if it fails
        } catch (e) {
          console.log('[FrogPaper] flush attempt:', e.message);
        }
      } else {
        setState((prev) => ({
          ...prev,
          testEventFeedback: `❌ sendTestEvent returned false at ${timestamp}. The SDK is initialized but captureException failed.`,
          testEventTime: timestamp,
        }));
      }
    } catch (error) {
      console.error('[FrogPaper] sendTestEvent threw:', error);
      setState((prev) => ({
        ...prev,
        testEventFeedback: `❌ Error at ${timestamp}: ${error.message || String(error)}`,
        testEventTime: timestamp,
      }));
    }
  };

  const confirmTestCrash = (strategy) => {
    // Strategy 'captureException' is the most reliable on web - it calls
    // Sentry.captureException() directly, no reliance on global error
    // handlers. The other two strategies throw uncaught errors which can
    // be flaky inside React event handlers (especially on web).
    if (strategy === 'captureException') {
      sendTestEventNow();
      return;
    }

    // For 'throwError' and 'nativeCrash', show a confirmation first
    Alert.alert(
      'Send test crash to Sentry?',
      `Strategy: ${strategy}\n\nThe app will crash. Sentry should report a new issue in your dashboard within ~30 seconds.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Crash',
          style: 'destructive',
          onPress: () => {
            // Use setTimeout so the Alert can dismiss before the throw.
            // The setTimeout also helps escape React's event handler so
            // the throw propagates to Sentry's global error handler.
            setTimeout(() => {
              forceTestCrash(strategy);
            }, 50);
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      <SettingsCard
        title="Connection"
        summary={state.loading ? 'Checking…' : online ? 'Connected' : 'Backend unreachable'}
        summaryDotStyle={
          state.loading ? styles.dotChecking : online ? styles.dotOnline : styles.dotOffline
        }
        open={openCards.connection}
        onPress={() => toggleCard('connection')}
      >
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
        </Text>
        <Pressable style={styles.button} onPress={refresh} disabled={state.loading}>
          {state.loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.buttonText}>Re-test connection</Text>
          )}
        </Pressable>
      </SettingsCard>

      <SettingsCard
        title="Wallpaper"
        summary={wallpaperSummary}
        open={openCards.wallpaper}
        onPress={() => toggleCard('wallpaper')}
      >
        <Text style={[styles.inputLabel, styles.firstInputLabel]}>Change my wallpaper</Text>
        <View style={styles.buttonRow}>
          <Pressable
            style={[
              styles.button,
              styles.buttonSecondary,
              rotationState.frequency === 'off' && styles.chipActive,
            ]}
            onPress={() => chooseFrequency('off')}
          >
            <Text
              style={[
                styles.buttonSecondaryText,
                rotationState.frequency === 'off' && styles.chipActiveText,
              ]}
            >
              Off
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              styles.buttonSecondary,
              rotationState.frequency === 'open' && styles.chipActive,
            ]}
            onPress={() => chooseFrequency('open')}
          >
            <Text
              style={[
                styles.buttonSecondaryText,
                rotationState.frequency === 'open' && styles.chipActiveText,
              ]}
            >
              Every time I open
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              styles.buttonSecondary,
              rotationState.frequency === 'daily' && styles.chipActive,
            ]}
            onPress={() => chooseFrequency('daily')}
          >
            <Text
              style={[
                styles.buttonSecondaryText,
                rotationState.frequency === 'daily' && styles.chipActiveText,
              ]}
            >
              Once a day
            </Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>{frequencyHint}</Text>

        <Text style={styles.inputLabel}>What to use</Text>
        <View style={styles.buttonRow}>
          <Pressable
            style={[
              styles.button,
              styles.buttonSecondary,
              rotationState.source === 'surprise' && styles.chipActive,
            ]}
            onPress={() => chooseRotationSource('surprise')}
          >
            <Text
              style={[
                styles.buttonSecondaryText,
                rotationState.source === 'surprise' && styles.chipActiveText,
              ]}
            >
              {'\uD83C\uDFB2 Surprise me'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              styles.buttonSecondary,
              rotationState.source === 'favorites' && styles.chipActive,
            ]}
            onPress={() => chooseRotationSource('favorites')}
          >
            <Text
              style={[
                styles.buttonSecondaryText,
                rotationState.source === 'favorites' && styles.chipActiveText,
              ]}
            >
              {'\u2605 My favourites'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              styles.buttonSecondary,
              rotationState.source === 'gallery' && styles.chipActive,
            ]}
            onPress={() => chooseRotationSource('gallery')}
          >
            <Text
              style={[
                styles.buttonSecondaryText,
                rotationState.source === 'gallery' && styles.chipActiveText,
              ]}
            >
              {'\uD83D\uDDBC Random from my gallery'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>{sourceHint}</Text>

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, styles.buttonSecondary]}
            onPress={changeWallpaperNow}
            disabled={rotating}
          >
            {rotating ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={colors.text} />
                <Text style={styles.buttonSecondaryText}>Changing…</Text>
              </View>
            ) : (
              <Text style={styles.buttonSecondaryText}>Change it now</Text>
            )}
          </Pressable>
        </View>
        {rotationNotice !== null && (
          <Text
            style={[
              styles.shuffleNotice,
              rotationNotice.kind === 'error' ? styles.shuffleNoticeError : null,
            ]}
          >
            {rotationNotice.text}
          </Text>
        )}

        <View style={styles.separator} />

        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>Wallpapers are saved to</Text>
          <Text style={[styles.aboutValue, styles.aboutValueShrink]} numberOfLines={1}>
            {saveTarget.target === FOLDER
              ? saveTarget.folderName || 'SD card folder'
              : 'Phone gallery'}
          </Text>
        </View>
        {Platform.OS === 'android' ? (
          <>
            <Text style={styles.hint}>
              Point saves at a folder on the SD card: Android gives FrogPaper access to
              that folder only, never to the rest of the card.
            </Text>
            <View style={styles.buttonRow}>
              <Pressable style={[styles.button, styles.buttonSecondary]} onPress={chooseFolder}>
                <Text style={styles.buttonSecondaryText}>Choose SD card folder…</Text>
              </Pressable>
              {saveTarget.target === FOLDER && (
                <Pressable
                  style={[styles.button, styles.buttonSecondary]}
                  onPress={resetToGallery}
                >
                  <Text style={styles.buttonSecondaryText}>Use phone gallery</Text>
                </Pressable>
              )}
            </View>
          </>
        ) : (
          <Text style={styles.hint}>
            {Platform.OS === 'web'
              ? 'The browser saves each wallpaper to your normal downloads folder.'
              : 'Wallpapers are saved to the iOS Photos library.'}{' '}
            Picking an SD card folder needs Android.
          </Text>
        )}
        <Text style={styles.hint}>
          This only affects the wallpapers you save - the offline cache is separate and
          stays in internal storage (see Offline).
        </Text>

        <View style={styles.separator} />

        <Text style={styles.inputLabel}>Where your gallery lives</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>This phone</Text>
          <Text style={styles.aboutValue}>{galleryCount}</Text>
        </View>
        <Text style={styles.hint}>
          Your wallpapers are kept on this phone only - nothing is uploaded to a server.
        </Text>

        {gallerySource === PHONE && (
          <>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutKey}>Images on this phone</Text>
              <Text style={styles.aboutValue}>{galleryCount}</Text>
            </View>
            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.button, styles.buttonSecondary]}
                onPress={importNow}
                disabled={importing}
              >
                {importing ? (
                  <View style={styles.busyRow}>
                    <ActivityIndicator color={colors.text} />
                    <Text style={styles.buttonSecondaryText}>Importing…</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonSecondaryText}>Import from my SD folder</Text>
                )}
              </Pressable>
            </View>
            {importNotice !== null && (
              <Text
                style={[
                  styles.shuffleNotice,
                  importNotice.kind === 'error' ? styles.shuffleNoticeError : null,
                ]}
              >
                {importNotice.text}
              </Text>
            )}
          </>
        )}
      </SettingsCard>

      <SettingsCard
        title="Offline"
        summary={`${offlineState.stats.count} saved · ${offlineState.queue} waiting`}
        open={openCards.offline}
        onPress={() => toggleCard('offline')}
      >
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>Saved on this phone</Text>
          <Text style={styles.aboutValue}>
            {offlineState.stats.count} file{offlineState.stats.count === 1 ? '' : 's'} |{' '}
            {formatMegabytes(offlineState.stats.bytes)}
          </Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>Waiting to be made</Text>
          <Text style={styles.aboutValue}>{offlineState.queue}</Text>
        </View>
        <Text style={styles.hint}>
          Your newest wallpapers stay here so the gallery still opens with no signal.
          Anything that could not be made is tried again later, while the app is open.
        </Text>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, styles.buttonSecondary]}
            onPress={confirmClearImages}
          >
            <Text style={styles.buttonSecondaryText}>Clear saved wallpapers</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.buttonSecondary]}
            onPress={confirmClearQueue}
          >
            <Text style={styles.buttonSecondaryText}>Clear queue</Text>
          </Pressable>
        </View>
      </SettingsCard>

      <SettingsCard
        title="Optional AI keys"
        summary={
          state.byokStatus.gemini || state.byokStatus.huggingface || state.byokStatus.replicate
            ? 'Using your own keys'
            : 'Not needed - the app already works'
        }
        open={openCards.keys}
        onPress={() => toggleCard('keys')}
      >
        <Text style={styles.hint}>
          Bring your own keys (BYOK): stored only on this phone, sent with each generate
          request, never logged and never saved on the server.
        </Text>

        <Pressable style={[styles.button, styles.buttonPrimary]} onPress={openByokHelp}>
          <Text style={styles.buttonTextPrimary}>How do I get API keys?</Text>
        </Pressable>

        <Text style={styles.inputLabel}>Google Gemini key</Text>
        <TextInput
          style={styles.input}
          placeholder="AQ...  or  AIza..."
          placeholderTextColor={colors.muted}
          value={state.userGeminiKey}
          onChangeText={handleGeminiKeyChange}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <View style={styles.buttonRow}>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={saveGeminiKey}>
            <Text style={styles.buttonSecondaryText}>Save</Text>
          </Pressable>
          {state.byokStatus.gemini && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={clearGeminiKey}>
              <Text style={styles.buttonSecondaryText}>Clear</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.inputLabel}>Hugging Face token</Text>
        <TextInput
          style={styles.input}
          placeholder="hf_..."
          placeholderTextColor={colors.muted}
          value={state.userHfToken}
          onChangeText={handleHfTokenChange}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <View style={styles.buttonRow}>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={saveHfToken}>
            <Text style={styles.buttonSecondaryText}>Save</Text>
          </Pressable>
          {state.byokStatus.huggingface && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={clearHfToken}>
              <Text style={styles.buttonSecondaryText}>Clear</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.inputLabel}>Replicate token</Text>
        <TextInput
          style={styles.input}
          placeholder="r8_..."
          placeholderTextColor={colors.muted}
          value={state.userReplicateToken}
          onChangeText={handleReplicateTokenChange}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <View style={styles.buttonRow}>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={saveReplicateToken}>
            <Text style={styles.buttonSecondaryText}>Save</Text>
          </Pressable>
          {state.byokStatus.replicate && (
            <Pressable
              style={[styles.button, styles.buttonSecondary]}
              onPress={clearReplicateToken}
            >
              <Text style={styles.buttonSecondaryText}>Clear</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.hint}>
          Status: {state.byokStatus.gemini ? 'Gemini: saved' : 'Gemini: none'}
          {'  |  '}
          {state.byokStatus.huggingface ? 'HF: saved' : 'HF: none'}
          {'  |  '}
          {state.byokStatus.replicate ? 'Replicate: saved' : 'Replicate: none'}
        </Text>
        <Text style={styles.hint}>
          Get free keys at: aistudio.google.com/apikey (Gemini), huggingface.co/settings/tokens (HF),
          replicate.com/accounts (Replicate, paid).
        </Text>
      </SettingsCard>


      <SettingsCard
        title="About & diagnostics"
        summary={`FrogPaper ${APP_VERSION}`}
        open={openCards.about}
        onPress={() => toggleCard('about')}
      >
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>App</Text>
          <Text style={styles.aboutValue}>{`FrogPaper Mobile ${APP_VERSION}`}</Text>
        </View>


            <View style={styles.subBlock}>
              <Text style={styles.rowValue}>Recent app errors</Text>
              <Text style={styles.hint}>
                {errorLog.count === 0
                  ? 'None recorded. JavaScript errors only - a hard crash of the whole app cannot be recorded here.'
                  : `${errorLog.count} recorded. JavaScript errors only - a hard crash of the whole app cannot be recorded here.`}
              </Text>
              <View style={styles.buttonRow}>
                <Pressable style={[styles.button, styles.buttonSecondary]} onPress={toggleErrorLog}>
                  <Text style={styles.buttonSecondaryText}>{errorLog.show ? 'Hide' : 'Show'}</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.buttonSecondary]} onPress={copyErrorLog}>
                  <Text style={styles.buttonSecondaryText}>Copy all</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.buttonSecondary]} onPress={confirmClearErrorLog}>
                  <Text style={styles.buttonSecondaryText}>Clear</Text>
                </Pressable>
              </View>
              {errorLog.show && errorLog.entries.length > 0
                ? errorLog.entries.map((entry, index) => (
                    <View key={`err-${index}`} style={styles.feedbackCard}>
                      <Text style={styles.feedbackText}>{describeErrorEntry(entry)}</Text>
                    </View>
                  ))
                : null}
              {errorLog.show && errorLog.entries.length === 0 ? (
                <Text style={styles.hint}>Nothing recorded yet.</Text>
              ) : null}
              <Pressable style={[styles.button, styles.buttonSecondary]} onPress={recordTestError}>
                <Text style={styles.buttonSecondaryText}>Record a test error</Text>
              </Pressable>
            </View>

            <View style={styles.subBlock}>
              <Text style={styles.rowValue}>The welcome guide</Text>
              <Text style={styles.hint}>
                Shows the short tour again the next time you open FrogPaper.
              </Text>
              <Pressable style={[styles.button, styles.buttonSecondary]} onPress={showWelcomeAgain}>
                <Text style={styles.buttonSecondaryText}>Show it again</Text>
              </Pressable>
            </View>

      </SettingsCard>

      {state.error !== null && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{state.error}</Text>
        </View>
      )}

      <ByokHelpModal
        visible={state.byokHelpVisible}
        onClose={closeByokHelp}
      />
    </ScrollView>
  );
}

// Masks the middle of a DSN so we can display it on-screen without leaking
// the full key in screenshots. e.g. https://abc12345@o99.ingest.sentry.io/1
// -> https://abc...@o99.ingest.sentry.io/1
function maskDsn(dsn) {
  if (!dsn || dsn === '(no DSN)') return dsn;
  const match = /^(https?:\/\/)([^@]+)(@.*)$/i.exec(dsn);
  if (!match) return dsn;
  const scheme = match[1];
  const key = match[2];
  const rest = match[3];
  const visible = key.length > 4 ? key.slice(0, 4) : key;
  return `${scheme}${visible}...${rest}`;
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
  // Section label sitting inside a collapsible card header.
  cardTitle: {
    marginTop: 0,
    marginBottom: 2,
  },
  // Section label for the blocks nested inside the About & diagnostics card.
  subLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardHeaderText: {
    flex: 1,
  },
  cardSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardSummary: {
    color: colors.muted,
    fontSize: 13,
    flexShrink: 1,
  },
  chevron: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  cardBody: {
    marginTop: spacing.md,
  },
  // Separates the rotation controls from the Save-location half of the
  // Wallpaper card.
  separator: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.md,
  },
  // A labelled block inside a card body (provider info, diagnostic tools) -
  // a divider rather than a nested card, so the page stays calm.
  subBlock: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
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
  // The status dot in a collapsed Connection header while we are still
  // checking whether the backend answers.
  dotChecking: {
    backgroundColor: colors.muted,
  },
  dotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  // Deliberately lighter than colors.card and outlined: the old fill was
  // cardAlt (#0F1828) on a #121D30 card, so the button shape was invisible.
  buttonSecondary: {
    backgroundColor: colors.control,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  buttonSecondaryText: {
    color: '#EAF7F1',
    textAlign: 'center',
  },
  chipActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  chipActiveText: {
    color: colors.bg,
  },
  buttonDanger: {
    backgroundColor: colors.danger,
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  // ActivityIndicator + label shown inside a secondary button while it works.
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Inline result of a shuffle action (accent on success, danger on failure).
  shuffleNotice: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  shuffleNoticeError: {
    color: colors.danger,
  },
  buttonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: radii.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  buttonTextPrimary: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    color: colors.text,
    fontSize: 15,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: 2,
  },
  // The first label in a card body sits right under the header, so it does not
  // need the usual breathing room above it.
  firstInputLabel: {
    marginTop: 0,
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
  // Folder names can be long - let the value truncate instead of pushing the
  // label off the row.
  aboutValueShrink: {
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: spacing.sm,
  },
  statusActive: {
    color: colors.accent,
  },
  statusInactive: {
    color: colors.muted,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    marginTop: spacing.xs,
  },
  feedbackCard: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  feedbackText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
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
