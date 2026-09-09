// Generate - create a wallpaper from a text prompt.
import React, { useState } from 'react';
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
import { colors, radii, spacing } from '../theme';

const SIZE_PRESETS = [
  { id: 'phone', label: 'Phone portrait', width: 1080, height: 1920 },
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'landscape', label: 'Landscape', width: 1920, height: 1080 },
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
  const [presetId, setPresetId] = useState('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const preset = SIZE_PRESETS.find((item) => item.id === presetId);

  const generate = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      setError('Describe your wallpaper in at least 3 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.generate({
        prompt: trimmed,
        width: preset.width,
        height: preset.height,
      });
      setResult(response.image);
    } catch (err) {
      setError(err.message || 'Generation failed. Is the backend running?');
    } finally {
      setLoading(false);
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

        {prompt.trim().length === 0 && (
          <View style={styles.ideasBlock}>
            <Text style={styles.sectionLabel}>Need inspiration?</Text>
            {IDEAS.map((idea) => (
              <Pressable key={idea} onPress={() => setPrompt(idea)} style={styles.ideaChip}>
                <Text style={styles.ideaText}>{idea}</Text>
              </Pressable>
            ))}
          </View>
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
          <Text style={styles.loadingHint}>
            Painting your wallpaper... this can take 10-60 seconds.
          </Text>
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
    marginTop: spacing.md,
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
