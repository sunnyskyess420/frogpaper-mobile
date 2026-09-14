// Generate - create a wallpaper from a text prompt.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import api from '../services/api';
import { getByokSnapshot, getByokSnapshotAsync, isOfflineError } from '../services/api';
import {
  MAX_QUEUE,
  describeQueueRun,
  enqueue,
  listQueue,
  processQueue,
} from '../services/generationQueue';
import { capabilities } from '../services/deviceMedia';
import { saveWallpaper } from '../services/saveTarget';
import WallpaperImage from '../components/WallpaperImage';
import { colors, radii, spacing } from '../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IDEAS, FAVORITES_KEY } from '../services/promptLibrary';

const SIZE_PRESETS = [
  { id: 'phone', label: 'Phone portrait', width: 1080, height: 1920 },
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'landscape', label: 'Landscape', width: 1920, height: 1080 },
];

// Friendly names for the "engine unavailable, used free fallback" notice.
// The backend reports the original provider as an id (e.g. "huggingface").
const PROVIDER_LABELS = {
  replicate: 'Replicate',
  gemini: 'Gemini',
  huggingface: 'Hugging Face',
};

export default function GenerateScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [presetId, setPresetId] = useState('phone');
  const [providerId, setProviderId] = useState(null);
  const [providers, setProviders] = useState([]);
  // null until a providers request fails: { offline }. Kept next to the list so
  // the AI Engine section can explain an empty list instead of just being blank.
  const [providersError, setProvidersError] = useState(null);
  const [providersBusy, setProvidersBusy] = useState(false);
  const [byok, setByok] = useState({ gemini: false, huggingface: false, replicate: false });
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const [abortController, setAbortController] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastSeed, setLastSeed] = useState(null);
  const [seedInput, setSeedInput] = useState('');
  const [favorites, setFavorites] = useState([]);
  // Size / Avoid / Seed are one collapsed section: they are rarely touched and
  // used to push the action below the fold.
  const [moreOpen, setMoreOpen] = useState(false);
  // Measured height of the pinned action bar, so the scroll content can end
  // clear of it instead of underneath it.
  const [barHeight, setBarHeight] = useState(0);
  // Local-only: the idea list starts collapsed on every mount.
  const [ideasOpen, setIdeasOpen] = useState(false);
  // Requests parked for a later attempt (backend unreachable at the time).
  const [queue, setQueue] = useState([]);
  const [queueOffer, setQueueOffer] = useState(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueNotice, setQueueNotice] = useState(null);
  // The AbortError from the Cancel button looks exactly like our own request
  // timeout, so track the intent instead of guessing from the error.
  const cancelledRef = useRef(false);

  const preset = SIZE_PRESETS.find((item) => item.id === presetId);
  const selectedProvider = providers.find((p) => p.id === providerId) || null;
  const isUsable = (p) => p.status === 'active' || !!(byok && byok[p.id]);
  // One-line "what is set" summary for the collapsed More options row.
  const moreSummary = [
    preset.label,
    negative.trim() ? 'avoid set' : 'no avoid',
    seedInput.trim() ? `seed ${seedInput.trim()}` : 'no seed',
  ].join(' · ');

  const loadRecent = useCallback(async () => {
    try {
      const response = await api.recentPrompts(5);
      setRecent(response.prompts || []);
    } catch (err) {
      setRecent([]); // history is optional - never block generation on it
    }
  }, []);

  const loadProviders = useCallback(async () => {
    setProvidersBusy(true);
    try {
      const response = await api.providers();
      const activeProviders = response.providers || [];
      const byokSnap = (await getByokSnapshotAsync()) || { gemini: false, huggingface: false, replicate: false };
      setByok(byokSnap);
      const usableNow = (p) => p.status === 'active' || !!(byokSnap && byokSnap[p.id]);
      setProviders(activeProviders);
      if (!providerId && activeProviders.length > 0) {
        const defaultProvider =
          activeProviders.find(p => p.id === 'pollinations' && usableNow(p)) ||
          activeProviders.find(p => p.id === 'gemini' && usableNow(p)) ||
          activeProviders.find(p => p.id === 'huggingface' && usableNow(p)) ||
          activeProviders.find(p => usableNow(p)) ||
          activeProviders[0];
        if (defaultProvider) setProviderId(defaultProvider.id);
      }
      setProvidersError(null);
    } catch (err) {
      console.error('Failed to load providers:', err);
      setProviders([]);
      // An empty section reads as "the feature is gone" - record why it is
      // empty so the section can say it out loud (offline vs server verdict).
      setProvidersError({ offline: isOfflineError(err) });
    } finally {
      setProvidersBusy(false);
    }
  }, [providerId]);

  useEffect(() => {
    loadRecent();
    loadProviders();
  }, [loadRecent, loadProviders]);

  // Favorites (starred prompts) live only on the device. Cap is 12.
  useEffect(() => {
    AsyncStorage.getItem(FAVORITES_KEY)
      .then((raw) => {
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) setFavorites(list.filter((x) => typeof x === 'string'));
      })
      .catch(() => {}); // favorites are optional - never block the screen on them
  }, []);

  // The Build screen hands its composed prompt back through route params. The
  // nonce - not the text - is the dependency, so sending the same prompt twice
  // still refreshes the field.
  useEffect(() => {
    const built = route.params?.builtPrompt;
    if (typeof built === 'string' && built.length > 0) {
      setPrompt(built);
    }
  }, [route.params?.builtPromptNonce]);

  const persistFavorites = async (list) => {
    setFavorites(list);
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    } catch (err) {
      // storage full or unavailable - keep the in-memory list for this session
    }
  };

  const surpriseMe = () => {
    const pool = IDEAS.filter((idea) => idea !== prompt.trim());
    const idea = pool[Math.floor(Math.random() * pool.length)] || IDEAS[0];
    setPrompt(idea);
  };

  const toggleFavorite = () => {
    const text = prompt.trim();
    if (text.length < 3) {
      return;
    }
    if (favorites.includes(text)) {
      persistFavorites(favorites.filter((item) => item !== text));
    } else {
      persistFavorites([text, ...favorites].slice(0, 12));
    }
  };

  const removeFavorite = (text) => {
    persistFavorites(favorites.filter((item) => item !== text));
  };

  const reusePrompt = (item) => {
    setPrompt(item.prompt || '');
    setNegative(item.negative_prompt || '');
  };

  // ---- Offline queue -----------------------------------------------------
  // The count is refreshed on focus so it stays honest after Home silently
  // ran the queue in the background.
  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await listQueue());
    } catch (err) {
      // the count is informational only - never break the screen over it
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshQueue();
    }, [refreshQueue])
  );

  const keepQueued = async () => {
    if (!queueOffer) {
      return;
    }
    const { dropped } = await enqueue(queueOffer);
    setQueue(await listQueue());
    setQueueOffer(null);
    setError(null);
    setQueueNotice({
      kind: 'ok',
      text: dropped
        ? 'Queue was full - the oldest request was dropped and this one was kept.'
        : 'Kept. It will generate as soon as the backend answers.',
    });
  };

  const runQueued = async () => {
    if (queueBusy) {
      return;
    }
    setQueueBusy(true);
    setQueueNotice({ kind: 'ok', text: 'Running queued requests...' });
    try {
      const summary = await processQueue({
        includeFailed: true, // an explicit tap is a manual retry
        onProgress: ({ attempted, total }) =>
          setQueueNotice({
            kind: 'ok',
            text: `Generating queued request ${attempted} of ${total}...`,
          }),
      });
      setQueue(await listQueue());
      setQueueNotice({
        kind: summary.stoppedOffline || summary.failed.length > 0 ? 'error' : 'ok',
        text: describeQueueRun(summary),
      });
      if (summary.succeeded.length > 0) {
        loadRecent();
      }
    } catch (err) {
      setQueueNotice({ kind: 'error', text: err.message || 'Could not run the queue.' });
    } finally {
      setQueueBusy(false);
    }
  };

  const generate = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      setError('Describe your wallpaper in at least 3 characters.');
      return;
    }
    // Built once here so an offline failure can queue exactly what would have
    // been sent (prompt, size, engine and seed included). Style is chosen on
    // the Build screen and arrives already composed in the prompt text.
    const fullPrompt = trimmed;
    const seedToUse = seedInput.trim() ? parseInt(seedInput.trim(), 10) : undefined;
    setLoading(true);
    setError(null);
    setResult(null);
    setSaveNotice(null);
    setQueueOffer(null);
    setQueueNotice(null);
    setElapsed(0);
    cancelledRef.current = false;

    const controller = new AbortController();
    setAbortController(controller);
    
    // Start elapsed time counter
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    try {
      const response = await api.generate({
        prompt: fullPrompt,
        negativePrompt: negative.trim() || null,
        width: preset.width,
        height: preset.height,
        seed: seedToUse,
        provider: providerId,
        timeoutMs: 180000, // peak-hour cloud queues can outlast the 60s default
        signal: controller.signal,
      });
      setResult(response.image);
      setLastSeed(response.image.seed);
      setSeedInput(''); // Clear seed input after successful generation
      loadRecent(); // the new prompt should appear in history right away
    } catch (err) {
      if (cancelledRef.current || err.name === 'AbortError' || err.message?.includes('abort')) {
        setError('Generation cancelled.');
      } else {
        setError(err.message || 'Generation failed. Is the backend running?');
        // Nothing answered, so nothing was generated: offer to keep the
        // request instead of losing what the user just typed.
        if (isOfflineError(err)) {
          setQueueOffer({
            prompt: fullPrompt,
            negativePrompt: negative.trim() || null,
            width: preset.width,
            height: preset.height,
            provider: providerId,
            seed: seedToUse === undefined ? null : seedToUse,
          });
        }
      }
    } finally {
      setLoading(false);
      setAbortController(null);
      clearInterval(timer);
    }
  };

  const cancelGeneration = () => {
    cancelledRef.current = true;
    if (abortController) {
      abortController.abort();
    }
  };

  const saveResult = async () => {
    if (!result) {
      return;
    }
    setSaving(true);
    setSaveNotice(null);
    try {
      // Honours the Save location setting - gallery or the chosen SD folder.
      const saveResult = await saveWallpaper(api.imageUrl(result.filename), result.filename);
      setSaveNotice({ kind: saveResult.ok ? 'ok' : 'error', text: saveResult.message });
    } catch (err) {
      setSaveNotice({ kind: 'error', text: err.message || 'Could not save the image.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // End the scroll clear of the pinned action bar measured below.
          { paddingBottom: barHeight + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>Describe your wallpaper</Text>
        <TextInput
          style={styles.input}
          multiline
          maxLength={600}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="e.g. A serene frog pond at dusk, pastel colors"
          placeholderTextColor={colors.muted}
        />
        <Text style={styles.charCount}>{prompt.length}/600</Text>

        <Pressable
          style={styles.buildRow}
          onPress={() => navigation.navigate('Build')}
        >
          <Text style={styles.buildRowText}>🧩 Build a prompt from options</Text>
          <Text style={styles.buildRowChevron}>▸</Text>
        </Pressable>

        <View style={styles.promptActions}>
          <Pressable style={styles.pillButton} onPress={surpriseMe}>
            <Text style={styles.pillButtonText}>🎲 Surprise me</Text>
          </Pressable>
          {prompt.trim().length >= 3 && (
            <Pressable
              style={[
                styles.pillButton,
                favorites.includes(prompt.trim()) && styles.pillButtonSaved,
              ]}
              onPress={toggleFavorite}
            >
              <Text
                style={[
                  styles.pillButtonText,
                  favorites.includes(prompt.trim()) && styles.pillButtonTextSaved,
                ]}
              >
                {favorites.includes(prompt.trim()) ? '★ Saved' : '☆ Save prompt'}
              </Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionLabel}>AI Engine</Text>
        {providers.length > 0 ? (
          <View style={styles.presets}>
            {providers.map((provider) => (
              <Pressable
                key={provider.id}
                onPress={() => isUsable(provider) && setProviderId(provider.id)}
                style={[
                  styles.presetChip,
                  providerId === provider.id && styles.presetChipActive,
                  !isUsable(provider) && styles.presetChipDisabled,
                ]}
                disabled={!isUsable(provider)}
              >
                <Text
                  style={[
                    styles.presetText,
                    providerId === provider.id && styles.presetTextActive,
                    !isUsable(provider) && styles.presetTextDisabled,
                  ]}
                >
                  {provider.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : providersError ? (
          <View style={styles.engineErrorCard}>
            <Text style={styles.engineErrorTitle}>
              {providersError.offline ? 'No internet connection' : 'Could not load the engines'}
            </Text>
            <Text style={styles.engineErrorText}>
              {providersError.offline
                ? 'Check your Wi-Fi or turn off airplane mode.'
                : 'The server had a problem - try again in a moment.'}
            </Text>
            <Pressable
              style={[styles.engineRetryButton, providersBusy && styles.saveButtonBusy]}
              onPress={loadProviders}
              disabled={providersBusy}
            >
              {providersBusy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.engineRetryText}>Retry</Text>
              )}
            </Pressable>
          </View>
        ) : null}
        {selectedProvider && (
          <Text style={styles.providerHint}>
            {selectedProvider.description}
          </Text>
        )}

        {/* Size, Avoid and Seed used to push the action below the fold, so they
            now live behind one collapsed row that states what is set. */}
        <Pressable
          style={styles.moreToggle}
          onPress={() => setMoreOpen((open) => !open)}
        >
          <View style={styles.moreToggleText}>
            <Text style={styles.moreToggleTitle}>More options</Text>
            {!moreOpen && (
              <Text style={styles.moreSummary} numberOfLines={1}>
                {moreSummary}
              </Text>
            )}
          </View>
          <Text style={styles.moreChevron}>{moreOpen ? '▾' : '▸'}</Text>
        </Pressable>

        {moreOpen && (
          <View style={styles.moreBody}>
            <Text style={styles.sectionLabel}>Size</Text>
            <View style={styles.presets}>
              {SIZE_PRESETS.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => setPresetId(item.id)}
                  style={[styles.presetChip, presetId === item.id && styles.presetChipActive]}
                >
                  <Text
                    style={[styles.presetText, presetId === item.id && styles.presetTextActive]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Avoid (optional)</Text>
            <TextInput
              style={styles.negativeInput}
              maxLength={300}
              value={negative}
              onChangeText={setNegative}
              placeholder="Things to avoid, e.g. text, watermark, people"
              placeholderTextColor={colors.muted}
            />
            <Text style={styles.negativeHint}>
              Soft guidance only - the AI model does not support strict negative prompts.
            </Text>

            <Text style={styles.sectionLabel}>Seed (optional)</Text>
            <View style={styles.seedRow}>
              <TextInput
                style={styles.seedInput}
                placeholder="Random if empty"
                placeholderTextColor={colors.muted}
                value={seedInput}
                onChangeText={setSeedInput}
                keyboardType="number-pad"
                maxLength={9}
              />
              {lastSeed !== null && (
                <Pressable
                  onPress={() => setSeedInput(String(lastSeed))}
                  style={styles.seedChipButton}
                >
                  <Text style={styles.seedChipText}>Reuse: {lastSeed}</Text>
                </Pressable>
              )}
            </View>
            <Text style={styles.seedHint}>
              Same seed + same prompt = same image. Leave empty for random.
            </Text>
          </View>
        )}

        {error !== null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {queueOffer !== null && (
          <View style={styles.queueOfferCard}>
            <Text style={styles.queueOfferTitle}>This request was not sent</Text>
            <Text style={styles.queueOfferText}>
              The backend is unreachable, so nothing was generated. Keep the prompt
              queued and FrogPaper will generate it the next time the backend answers -
              it stays on this phone, no account needed.
            </Text>
            <Pressable style={styles.queueOfferButton} onPress={keepQueued}>
              <Text style={styles.queueOfferButtonText}>Keep it queued</Text>
            </Pressable>
          </View>
        )}

        {queue.length > 0 && (
          <View style={styles.queueCard}>
            <Text style={styles.queueCardTitle}>
              {queue.length} waiting to generate
            </Text>
            <Text style={styles.queueCardText}>
              Saved on this phone. Queued prompts only run while the app is open, one at a
              time. The oldest is dropped when the queue is full ({MAX_QUEUE}).
            </Text>
            <Pressable
              style={[styles.queueButton, queueBusy && styles.saveButtonBusy]}
              onPress={runQueued}
              disabled={queueBusy}
            >
              {queueBusy ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.queueButtonText}>Run queued</Text>
              )}
            </Pressable>
          </View>
        )}

        {queueNotice !== null && (
          <Text
            style={[
              styles.saveNotice,
              queueNotice.kind === 'error' && styles.saveNoticeError,
            ]}
          >
            {queueNotice.text}
          </Text>
        )}

        {result && (
          <View style={styles.resultCard}>
            <WallpaperImage
              filename={result.filename}
              style={styles.resultImage}
              resizeMode="cover"
            />
            <Text style={styles.resultMeta}>
              {result.filename}  |  {result.width}x{result.height}
            </Text>
            {result.provider_fallback_from && (
              <View style={styles.fallbackCard}>
                <Text style={styles.fallbackText}>
                  {(PROVIDER_LABELS[result.provider_fallback_from] ||
                    result.provider_fallback_from)}{' '}
                  was unavailable — used the free Pollinations engine.
                </Text>
              </View>
            )}
            {saveNotice !== null && (
              <Text
                style={[
                  styles.saveNotice,
                  saveNotice.kind === 'error' && styles.saveNoticeError,
                ]}
              >
                {saveNotice.text}
              </Text>
            )}
            <Pressable
              style={[styles.saveButton, saving && styles.saveButtonBusy]}
              onPress={saveResult}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.saveButtonText}>Save to device</Text>
              )}
            </Pressable>
            <View style={styles.resultActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('Gallery')}
              >
                <Text style={styles.secondaryButtonText}>Open gallery</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={generate}>
                <Text style={styles.secondaryButtonText}>Generate again</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Prompt browsing sits at the very bottom of the scroll: the inputs,
            the engines and the action (now pinned) all come first, so nothing
            has to be scrolled past to start a generation. */}
        {favorites.length > 0 && (
          <View style={styles.ideasBlock}>
            <Text style={styles.sectionLabel}>★ Favorite prompts</Text>
            {favorites.map((text) => (
              <View key={text} style={styles.favChip}>
                <Pressable style={styles.favChipMain} onPress={() => setPrompt(text)}>
                  <Text style={styles.ideaText} numberOfLines={1}>
                    {text}
                  </Text>
                </Pressable>
                <Pressable
                  hitSlop={8}
                  style={styles.favChipDelete}
                  onPress={() => removeFavorite(text)}
                >
                  <Text style={styles.favChipDeleteText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {recent.length > 0 && (
          <View style={styles.ideasBlock}>
            <Text style={styles.sectionLabel}>Recent prompts</Text>
            {recent.map((item) => (
              <Pressable
                key={`${item.used_at}-${item.prompt.slice(0, 12)}`}
                onPress={() => reusePrompt(item)}
                style={styles.ideaChip}
              >
                <Text style={styles.ideaText} numberOfLines={1}>
                  {item.prompt}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Collapsed by default: 20 full-width chips are a lot of scrolling,
            and they sit below the action, so they only cost a tap to open. */}
        <View style={styles.ideasBlock}>
          <Pressable
            style={styles.ideasToggle}
            onPress={() => setIdeasOpen((open) => !open)}
          >
            <Text style={styles.ideasToggleText}>
              Need inspiration? · {IDEAS.length} ideas
            </Text>
            <Text style={styles.ideasChevron}>{ideasOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {ideasOpen &&
            IDEAS.map((idea) => (
              <Pressable key={idea} onPress={() => setPrompt(idea)} style={styles.ideaChip}>
                <Text style={styles.ideaText}>{idea}</Text>
              </Pressable>
            ))}
        </View>
      </ScrollView>

      {/* Pinned to the bottom of the screen (a sibling of the scroll view, so
          the layout keeps the action visible without absolute positioning).
          The scroll content reserves this bar's measured height as padding. */}
      <View
        style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.sm }]}
        onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
      >
        <Pressable
          style={[styles.generateButton, loading && styles.generateButtonDisabled]}
          onPress={generate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.generateButtonText}>Generate wallpaper</Text>
          )}
        </Pressable>

        {loading && (
          <View style={styles.loadingRow}>
            <Text style={styles.loadingHint}>
              FLUX is painting your wallpaper... {elapsed}s elapsed
            </Text>
            <Pressable style={styles.cancelButton} onPress={cancelGeneration}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
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
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontSize: 16,
    minHeight: 110,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  charCount: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  // Entry point to the Build screen: a full-width outlined row using the
  // control fill so the shape stays visible on the dark background.
  buildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    marginTop: spacing.sm,
  },
  buildRowText: {
    color: '#EAF7F1',
    fontSize: 14,
    fontWeight: '700',
  },
  buildRowChevron: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  promptActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  pillButton: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.cardAlt,
  },
  pillButtonSaved: {
    backgroundColor: colors.accentDim,
  },
  pillButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  pillButtonTextSaved: {
    color: colors.bg,
  },
  negativeInput: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontSize: 15,
    padding: spacing.md,
  },
  negativeHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  presetChip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.cardAlt,
  },
  presetChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  presetText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  presetTextActive: {
    color: colors.bg,
  },
  presetChipDisabled: {
    opacity: 0.5,
  },
  presetTextDisabled: {
    color: colors.muted,
  },
  providerHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  engineErrorCard: {
    backgroundColor: colors.card,
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  engineErrorTitle: {
    color: colors.warn,
    fontSize: 15,
    fontWeight: '700',
  },
  engineErrorText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  engineRetryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  engineRetryText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  ideasBlock: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  ideasToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  ideasToggleText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  ideasChevron: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  ideaChip: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  ideaText: {
    color: colors.muted,
    fontSize: 14,
  },
  favChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    marginTop: spacing.sm,
  },
  favChipMain: {
    flex: 1,
    padding: spacing.md,
  },
  favChipDelete: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  favChipDeleteText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '700',
  },
  seedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  seedInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontSize: 15,
    padding: spacing.md,
  },
  seedChipButton: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  seedChipText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  seedHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  // Collapsible "More options" row (Size / Avoid / Seed). Uses the control
  // fill + border pair so the shape stays visible on the dark background.
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  moreToggleText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  moreToggleTitle: {
    color: '#EAF7F1',
    fontSize: 14,
    fontWeight: '700',
  },
  moreSummary: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  moreChevron: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  moreBody: {
    marginTop: spacing.lg,
  },
  generateButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  generateButtonDisabled: {
    opacity: 0.6,
  },
  generateButtonText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: '800',
  },
  // Pinned bottom action bar.
  actionBar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  loadingHint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.cardAlt,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#2A1520',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
  queueOfferCard: {
    backgroundColor: colors.card,
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  queueOfferTitle: {
    color: colors.warn,
    fontSize: 15,
    fontWeight: '700',
  },
  queueOfferText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  queueOfferButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  queueOfferButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  queueCard: {
    backgroundColor: colors.card,
    borderColor: colors.accentDim,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  queueCardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  queueCardText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  queueButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  queueButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  resultCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  resultImage: {
    width: '100%',
    height: 320,
    borderRadius: radii.md,
    backgroundColor: colors.cardAlt,
  },
  resultMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  fallbackCard: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  fallbackText: {
    color: colors.warn,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  saveNotice: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  saveNoticeError: {
    color: colors.danger,
    fontWeight: '500',
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveButtonBusy: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  resultActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryButton: {
    flex: 1,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
});
