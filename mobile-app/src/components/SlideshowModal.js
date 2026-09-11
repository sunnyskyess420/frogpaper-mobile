// SlideshowModal - fullscreen auto-advancing slideshow of the gallery.
// Swipe or use the arrows to move manually; auto-advance pauses while the
// image is zoomed and resumes when it returns to 1x.
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ZoomableImage from './ZoomableImage';
import api from '../services/api';
import { colors, radii, spacing } from '../theme';

const INTERVAL_CHOICES = [
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
];

export default function SlideshowModal({ visible, images, initialIndex = 0, onClose }) {
  const [index, setIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(true);
  const [intervalMs, setIntervalMs] = useState(5000);
  const [zoomed, setZoomed] = useState(false);

  // Fresh open -> start at the requested image, playing.
  useEffect(() => {
    if (visible) {
      setIndex(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
      setPlaying(true);
      setZoomed(false);
    }
  }, [visible, initialIndex, images.length]);

  // Auto-advance (a timer per index, so a manual swipe restarts the clock).
  useEffect(() => {
    if (!visible || !playing || zoomed || images.length < 2) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setIndex((prev) => (prev + 1) % images.length);
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [visible, playing, zoomed, intervalMs, index, images.length]);

  if (!images || images.length === 0) {
    return null;
  }

  const current = images[index];
  const filenames = images.map((item) => item.filename);
  const step = (direction) => {
    setIndex((prev) => (prev + direction + images.length) % images.length);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <ZoomableImage
          uri={api.imageUrl(current.filename)}
          filenames={filenames}
          index={index}
          onIndexChange={setIndex}
          onZoomChange={setZoomed}
          showCounter
          style={styles.stage}
        />

        <View style={styles.topBar}>
          <Text style={styles.status} numberOfLines={1}>
            {playing && !zoomed
              ? 'Playing'
              : zoomed
                ? 'Paused (zoomed)'
                : 'Paused'}
          </Text>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>

        <View style={styles.controls}>
          <View style={styles.buttonRow}>
            <Pressable style={styles.navButton} onPress={() => step(-1)}>
              <Text style={styles.navButtonText}>Prev</Text>
            </Pressable>
            <Pressable
              style={[styles.playButton, zoomed && styles.buttonDisabled]}
              onPress={() => setPlaying((prev) => !prev)}
              disabled={zoomed}
            >
              {zoomed ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={styles.playButtonText}>{playing ? 'Pause' : 'Play'}</Text>
              )}
            </Pressable>
            <Pressable style={styles.navButton} onPress={() => step(1)}>
              <Text style={styles.navButtonText}>Next</Text>
            </Pressable>
          </View>

          <View style={styles.chipRow}>
            {INTERVAL_CHOICES.map((choice) => (
              <Pressable
                key={choice.value}
                style={[styles.chip, intervalMs === choice.value && styles.chipActive]}
                onPress={() => setIntervalMs(choice.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    intervalMs === choice.value && styles.chipTextActive,
                  ]}
                >
                  {choice.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Swipe the image to browse - pinch to zoom</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000',
  },
  stage: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  status: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  closeButton: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.4)',
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  navButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  navButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  playButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  playButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: colors.bg,
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
