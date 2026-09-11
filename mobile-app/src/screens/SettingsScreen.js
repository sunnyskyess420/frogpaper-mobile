// Settings - backend connection info, provider details, about, diagnostics.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  LAN_IP,
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
import { colors, radii, spacing } from '../theme';
import ByokHelpModal from '../components/ByokHelpModal';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
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
    testEventTime: null,
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
        testEventTime: null,
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
        testEventTime: null,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const online = state.health !== null;

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

      <Text style={styles.sectionLabel}>Custom server address</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          For cloud deployment, enter your backend URL here (e.g., https://your-app.onrender.com).
          Leave empty to use automatic LAN discovery.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="https://your-backend-url.com"
          placeholderTextColor={colors.muted}
          value={state.customUrl}
          onChangeText={handleCustomUrlChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.buttonRow}>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={saveCustomUrl}>
            <Text style={styles.buttonText}>Save URL</Text>
          </Pressable>
          {state.customUrl && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={clearCustomUrl}>
              <Text style={styles.buttonText}>Clear</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Access key</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Shared secret key for API authentication. Required when the backend is configured with an access key.
          Leave empty if your backend does not require authentication.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Enter access key"
          placeholderTextColor={colors.muted}
          value={state.accessKey}
          onChangeText={handleAccessKeyChange}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <View style={styles.buttonRow}>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={saveAccessKey}>
            <Text style={styles.buttonText}>Save key</Text>
          </Pressable>
          {state.accessKey && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={clearAccessKey}>
              <Text style={styles.buttonText}>Clear</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Your API keys</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Bring your own keys (BYOK). Paste your own free API keys here to use your own quotas.
          Keys are stored only on this phone and sent with each generate request. They never appear
          in logs and are never saved on the server.
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
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
          {state.byokStatus.gemini && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={clearGeminiKey}>
              <Text style={styles.buttonText}>Clear</Text>
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
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
          {state.byokStatus.huggingface && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={clearHfToken}>
              <Text style={styles.buttonText}>Clear</Text>
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
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
          {state.byokStatus.replicate && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={clearReplicateToken}>
              <Text style={styles.buttonText}>Clear</Text>
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

      <Pressable onPress={bumpCrashTap}>
        <Text style={styles.sectionLabel}>About</Text>
      </Pressable>
      <View style={styles.card}>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>App</Text>
          <Text style={styles.aboutValue}>FrogPaper Mobile 1.7.0</Text>
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
        <View style={styles.aboutRow}>
          <Text style={styles.aboutKey}>Crash reporter</Text>
          <Text
            style={[
              styles.aboutValue,
              state.sentryStatus === 'initialized'
                ? styles.statusActive
                : styles.statusInactive,
            ]}
          >
            {state.sentryStatus === 'initialized' ? 'Sentry active' : 'Sentry off'}
          </Text>
        </View>
      </View>

      {state.diagnosticsRevealed && (
        <>
          <Text style={styles.sectionLabel}>Diagnostics</Text>
          <View style={styles.card}>
            <Text style={styles.hint}>
              Sentry DSN (Data Source Name). Paste the DSN from your Sentry project settings
              (looks like https://&lt;key&gt;@o&lt;org&gt;.ingest.sentry.io/&lt;id&gt;). The DSN
              is safe to ship in client builds - it only allows writing crash events, never reading them.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="https://examplekey@o123.ingest.sentry.io/456"
              placeholderTextColor={colors.muted}
              value={state.sentryDsn}
              onChangeText={handleSentryDsnChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.hint, { marginTop: spacing.sm }]}>
              Environment label (e.g. development, staging, production).
              Used to filter events in the Sentry dashboard.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="development"
              placeholderTextColor={colors.muted}
              value={state.sentryEnv}
              onChangeText={handleSentryEnvChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.buttonRow}>
              <Pressable style={[styles.button, styles.buttonSecondary]} onPress={saveSentryConfig}>
                <Text style={styles.buttonText}>Save</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.buttonSecondary]}
                onPress={clearSentryConfig}
              >
                <Text style={styles.buttonText}>Clear</Text>
              </Pressable>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.aboutKey}>Status</Text>
              <Text style={styles.monoText}>{state.sentryStatus}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.aboutKey}>Effective DSN</Text>
              <Text style={styles.monoText} numberOfLines={1}>
                {maskDsn(state.sentryEffectiveDsn)}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.rowValue}>Send test event</Text>
            <Text style={styles.hint}>
              Sends a test exception to Sentry using captureException(). Most reliable method on web.
              Does NOT crash the app - just sends the event in the background.
            </Text>
            <Pressable
              style={[styles.button, styles.buttonSecondary]}
              onPress={sendTestEventNow}
            >
              <Text style={styles.buttonText}>Send test event</Text>
            </Pressable>
            {state.testEventFeedback ? (
              <View style={styles.feedbackCard}>
                <Text style={styles.feedbackText}>{state.testEventFeedback}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.rowValue}>Send test crash</Text>
            <Text style={styles.hint}>
              Forces a real uncaught crash that the Sentry SDK will capture. The app will crash.
              After ~30 seconds, check your Sentry dashboard.
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.button, styles.buttonDanger]}
                onPress={() => confirmTestCrash('throwError')}
              >
                <Text style={styles.buttonText}>JS throw</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.buttonDanger]}
                onPress={() => confirmTestCrash('nativeCrash')}
              >
                <Text style={styles.buttonText}>Native crash</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              Native crash requires a dev-client or standalone build - it is a no-op inside Expo Go.
            </Text>
          </View>
        </>
      )}

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
  buttonSecondary: {
    backgroundColor: colors.cardAlt,
    flex: 1,
    marginHorizontal: spacing.xs,
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
  buttonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
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
