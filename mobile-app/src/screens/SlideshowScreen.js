// Slideshow - automatic wallpaper rotation at configurable intervals.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import api from '../services/api';
import { saveToDevice } from '../services/deviceMedia';
import { colors, radii, spacing } from '../theme';

const INTERVAL_PRESETS = [
  { id: '5min', label: '5 minutes', minutes: 5 },
  { id: '15min', label: '15 minutes', minutes: 15 },
  { id: '30min', label: '30 minutes', minutes: 30 },
  { id: '1hour', label: '1 hour', minutes: 60 },
  { id: '3hours', label: '3 hours', minutes: 180 },
  { id: '6hours', label: '6 hours', minutes: 360 },
  { id: '12hours', label: '12 hours', minutes: 720 },
  { id: '24hours', label: '24 hours', minutes: 1440 },
];

export default function SlideshowScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [config, setConfig] = useState({
    enabled: false,
    interval_minutes: 60,
    last_shown_index: 0,
  });
  const [currentImage, setCurrentImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const [error, setError] = useState(null);
  const [intervalId, setIntervalId] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const response = await api.slideshowConfig();
      setConfig(response.config);
    } catch (err) {
      setError(err.message || 'Failed to load slideshow configuration');
    }
  }, []);

  const loadNextImage = useCallback(async () => {
    if (!config.enabled) {
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const response = await api.slideshowNext();
      setCurrentImage(response.image);
      setSaveNotice(null);
    } catch (err) {
      setError(err.message || 'Failed to load next wallpaper');
    } finally {
      setLoading(false);
    }
  }, [config.enabled]);

  const saveConfig = async (newConfig) => {
    try {
      await api.setSlideshowConfig(newConfig);
      setConfig(newConfig);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to save slideshow configuration');
    }
  };

  const toggleEnabled = async () => {
    const newConfig = { ...config, enabled: !config.enabled };
    await saveConfig(newConfig);
    
    if (newConfig.enabled) {
      // Start slideshow when enabled
      loadNextImage();
    } else {
      // Stop slideshow when disabled
      if (intervalId) {
        clearInterval(intervalId);
        setIntervalId(null);
      }
      setCurrentImage(null);
    }
  };

  const setIntervalMinutes = async (minutes) => {
    const newConfig = { ...config, interval_minutes: minutes };
    await saveConfig(newConfig);
    
    // Restart interval timer if enabled
    if (newConfig.enabled && intervalId) {
      clearInterval(intervalId);
      const newIntervalId = setInterval(loadNextImage, minutes * 60 * 1000);
      setIntervalId(newIntervalId);
    }
  };

  const saveCurrentImage = async () => {
    if (!currentImage) {
      return;
    }
    setSaving(true);
    setSaveNotice(null);
    try {
      await saveToDevice(api.imageUrl(currentImage.filename));
      setSaveNotice({ kind: 'ok', text: 'Saved to your device gallery.' });
    } catch (err) {
      setSaveNotice({ kind: 'error', text: err.message || 'Could not save the image.' });
    } finally {
      setSaving(false);
    }
  };

  const skipToNext = () => {
    loadNextImage();
  };

  // Setup interval timer when enabled
  useEffect(() => {
    if (config.enabled && !intervalId) {
      loadNextImage();
      const newIntervalId = setInterval(loadNextImage, config.interval_minutes * 60 * 1000);
      setIntervalId(newIntervalId);
    } else if (!config.enabled && intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [config.enabled, config.interval_minutes, intervalId, loadNextImage]);

  // Load initial config
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const intervalPreset = INTERVAL_PRESETS.find(p => p.minutes === config.interval_minutes) || INTERVAL_PRESETS[3];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      <Text style={styles.sectionLabel}>Slideshow Status</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.dot, config.enabled ? styles.dotEnabled : styles.dotDisabled]} />
          <Text style={styles.rowValue}>
            {config.enabled ? 'Slideshow active' : 'Slideshow disabled'}
          </Text>
        </View>
        <Pressable
          style={[styles.button, config.enabled ? styles.buttonStop : styles.buttonStart]}
          onPress={toggleEnabled}
        >
          <Text style={styles.buttonText}>
            {config.enabled ? 'Stop Slideshow' : 'Start Slideshow'}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Change Interval</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          How often to automatically change your wallpaper. Requires slideshow to be active.
        </Text>
        <View style={styles.presets}>
          {INTERVAL_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => setIntervalMinutes(preset.minutes)}
              style={[
                styles.presetChip,
                config.interval_minutes === preset.minutes && styles.presetChipActive,
              ]}
            >
              <Text
                style={[
                  styles.presetText,
                  config.interval_minutes === preset.minutes && styles.presetTextActive,
                ]}
              >
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {currentImage && (
        <>
          <Text style={styles.sectionLabel}>Current Wallpaper</Text>
          <View style={styles.resultCard}>
            <Image
              source={{ uri: api.imageUrl(currentImage.filename) }}
              style={styles.resultImage}
              resizeMode="cover"
            />
            <Text style={styles.resultMeta}>
              {currentImage.filename}  |  {currentImage.width}x{currentImage.height}
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
              onPress={saveCurrentImage}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.saveButtonText}>Set as wallpaper</Text>
              )}
            </Pressable>
            <View style={styles.resultActions}>
              <Pressable style={styles.secondaryButton} onPress={skipToNext}>
                <Text style={styles.secondaryButtonText}>Skip to next</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('Gallery')}
              >
                <Text style={styles.secondaryButtonText}>Open gallery</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingHint}>Loading next wallpaper...</Text>
        </View>
      )}

      {error !== null && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!config.enabled && (
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            Enable the slideshow to automatically cycle through your generated wallpapers at the chosen interval.
            The app will show each new wallpaper when it's time to change.
          </Text>
        </View>
      )}
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
    marginBottom: spacing.md,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotEnabled: {
    backgroundColor: colors.accent,
  },
  dotDisabled: {
    backgroundColor: colors.danger,
  },
  rowValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonStart: {
    backgroundColor: colors.accent,
  },
  buttonStop: {
    backgroundColor: colors.danger,
  },
  buttonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '800',
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
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
  loadingContainer: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  loadingHint: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.sm,
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
  infoCard: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  infoText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
