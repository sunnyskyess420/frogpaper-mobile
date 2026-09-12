// Generate - create a wallpaper from a text prompt.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { useNavigation } from '@react-navigation/native';
import api from '../services/api';
import { getByokSnapshot, getByokSnapshotAsync } from '../services/api';
import { capabilities, saveToDevice } from '../services/deviceMedia';
import { colors, radii, spacing } from '../theme';

const SIZE_PRESETS = [
  { id: 'phone', label: 'Phone portrait', width: 1080, height: 1920 },
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'landscape', label: 'Landscape', width: 1920, height: 1080 },
];

// Style presets append proven descriptor phrases to the prompt.
const STYLE_PRESETS = [
  { id: 'photo', label: 'Photorealistic', suffix: 'photorealistic, 50mm photo, natural lighting, sharp focus' },
  { id: 'cyberpunk', label: 'Cyberpunk', suffix: 'cyberpunk style, neon lights, rain, moody atmosphere, high detail' },
  { id: 'pastel', label: 'Pastel', suffix: 'pastel colors, soft light, dreamy, gentle atmosphere' },
  { id: 'fantasy', label: 'Fantasy', suffix: 'epic fantasy art, magical atmosphere, rich colors' },
  { id: 'minimal', label: 'Minimalist', suffix: 'minimalist, clean composition, lots of negative space' },
  { id: 'painting', label: 'Oil painting', suffix: 'oil painting, textured brush strokes, classic art style' },
  { id: 'anime', label: 'Anime', suffix: 'anime style illustration, vibrant colors, clean line art' },
];

const IDEAS = [
  'Neon frog on a lily pad in a cyberpunk city, rain, wallpaper',
  'Pastel sunset over misty mountains, minimalist, vertical',
  'Bioluminescent forest at night, magical atmosphere',
];

export default function GenerateScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [presetId, setPresetId] = useState('phone');
  const [styleId, setStyleId] = useState(null);
  const [providerId, setProviderId] = useState(null);
  const [providers, setProviders] = useState([]);
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

  const preset = SIZE_PRESETS.find((item) => item.id === presetId);
  const style = STYLE_PRESETS.find((item) => item.id === styleId) || null;
  const selectedProvider = providers.find((p) => p.id === providerId) || null;
  const isUsable = (p) => p.status === 'active' || !!(byok && byok[p.id]);

  const loadRecent = useCallback(async () => {
    try {
      const response = await api.recentPrompts(5);
      setRecent(response.prompts || []);
    } catch (err) {
      setRecent([]); // history is optional - never block generation on it
    }
  }, []);

  const loadProviders = useCallback(async () => {
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
    } catch (err) {
      console.error('Failed to load providers:', err);
      setProviders([]);
    }
  }, [providerId]);

  useEffect(() => {
    loadRecent();
    loadProviders();
  }, [loadRecent, loadProviders]);

  const reusePrompt = (item) => {
    setPrompt(item.prompt || '');
    setNegative(item.negative_prompt || '');
  };

  const generate = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      setError('Describe your wallpaper in at least 3 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setSaveNotice(null);
    setElapsed(0);
    
    const controller = new AbortController();
    setAbortController(controller);
    
    // Start elapsed time counter
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    try {
      const seedToUse = seedInput.trim() ? parseInt(seedInput.trim(), 10) : undefined;
      const response = await api.generate({
        prompt: style ? `${trimmed}, ${style.suffix}` : trimmed,
        negativePrompt: negative.trim() || null,
        width: preset.width,
        height: preset.height,
        seed: seedToUse,
        provider: providerId,
        signal: controller.signal,
      });
      setResult(response.image);
      setLastSeed(response.image.seed);
      setSeedInput(''); // Clear seed input after successful generation
      loadRecent(); // the new prompt should appear in history right away
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        setError('Generation cancelled.');
      } else {
        setError(err.message || 'Generation failed. Is the backend running?');
      }
    } finally {
      setLoading(false);
      setAbortController(null);
      clearInterval(timer);
    }
  };

  const cancelGeneration = () => {
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
      await saveToDevice(api.imageUrl(result.filename));
      setSaveNotice({ kind: 'ok', text: 'Saved to your device gallery.' });
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
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

        <Text style={styles.sectionLabel}>Style (optional)</Text>
        <View style={styles.presets}>
          {STYLE_PRESETS.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setStyleId(styleId === item.id ? null : item.id)}
              style={[styles.presetChip, styleId === item.id && styles.presetChipActive]}
            >
              <Text
                style={[styles.presetText, styleId === item.id && styles.presetTextActive]}
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

        <Text style={styles.sectionLabel}>AI Engine</Text>
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
        {selectedProvider && (
          <Text style={styles.providerHint}>
            {selectedProvider.description}
          </Text>
        )}

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

        {recent.length > 0 ? (
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
        ) : (
          prompt.trim().length === 0 && (
            <View style={styles.ideasBlock}>
              <Text style={styles.sectionLabel}>Need inspiration?</Text>
              {IDEAS.map((idea) => (
                <Pressable key={idea} onPress={() => setPrompt(idea)} style={styles.ideaChip}>
                  <Text style={styles.ideaText}>{idea}</Text>
                </Pressable>
              ))}
            </View>
          )
        )}

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
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingHint}>
              FLUX is painting your wallpaper... {elapsed}s elapsed
            </Text>
            <Pressable style={styles.cancelButton} onPress={cancelGeneration}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {error !== null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {result && (
          <View style={styles.resultCard}>
            <Image
              source={{ uri: api.imageUrl(result.filename) }}
              style={styles.resultImage}
              resizeMode="cover"
            />
            <Text style={styles.resultMeta}>
              {result.filename}  |  {result.width}x{result.height}
            </Text>
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
      </ScrollView>
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
  ideasBlock: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
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
  generateButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  generateButtonDisabled: {
    opacity: 0.6,
  },
  generateButtonText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: '800',
  },
  loadingHint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  cancelButton: {
    marginTop: spacing.sm,
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
