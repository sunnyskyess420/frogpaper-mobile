// Detail - full info and actions for a single gallery image.
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
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import api from '../services/api';
import {
  capabilities,
  saveToDevice,
  setAsWallpaper,
} from '../services/deviceMedia';
import { colors, radii, spacing } from '../theme';

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const SOURCE_LABELS = {
  generated: 'Generated with AI',
  uploaded: 'Uploaded by you',
  imported: 'Added to gallery',
};

export default function DetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const filename = route.params?.filename;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [copiedSeed, setCopiedSeed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.imageDetail(filename);
      setDetail(response.image);
    } catch (err) {
      setError(err.message || 'Could not load image details.');
    } finally {
      setLoading(false);
    }
  }, [filename]);

  useEffect(() => {
    load();
  }, [load]);

  const doSave = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await saveToDevice(api.imageUrl(filename));
      setNotice({ kind: 'ok', text: 'Saved to your device gallery.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not save the image.' });
    } finally {
      setSaving(false);
    }
  };

  const doWallpaper = async () => {
    setWallpaperBusy(true);
    setNotice(null);
    try {
      const result = await setAsWallpaper(api.imageUrl(filename));
      setNotice(
        result.ok
          ? { kind: 'ok', text: 'Wallpaper updated.' }
          : { kind: 'error', text: result.message || 'Could not set the wallpaper.' }
      );
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not set the wallpaper.' });
    } finally {
      setWallpaperBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteImage(filename);
      navigation.goBack();
    } catch (err) {
      setError(err.message || 'Delete failed.');
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  };

  const copySeed = async () => {
    if (detail?.seed !== undefined && detail.seed !== null) {
      try {
        await Clipboard.setStringAsync(String(detail.seed));
        setCopiedSeed(true);
        setTimeout(() => setCopiedSeed(false), 2000);
      } catch (err) {
        console.error('Failed to copy seed:', err);
      }
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      {error !== null && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.secondaryButton} onPress={load}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {detail && (
        <>
          <Image
            source={{ uri: api.imageUrl(detail.filename) }}
            style={styles.image}
            resizeMode="contain"
          />

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>File</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {detail.filename}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>Source</Text>
              <Text style={styles.infoValue}>
                {SOURCE_LABELS[detail.source] || detail.source}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>Dimensions</Text>
              <Text style={styles.infoValue}>
                {detail.width && detail.height ? `${detail.width} x ${detail.height}` : '-'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>Size</Text>
              <Text style={styles.infoValue}>{formatBytes(detail.size_bytes)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>Added</Text>
              <Text style={styles.infoValue}>
                {(detail.created_at || '').replace('T', ' ').slice(0, 16)} UTC
              </Text>
            </View>
            {detail.seed !== undefined && detail.seed !== null && (
              <View style={styles.seedRow}>
                <Text style={styles.infoKey}>Seed</Text>
                <Text style={styles.infoValue} selectable>
                  {detail.seed}
                </Text>
                <Pressable
                  onPress={copySeed}
                  style={styles.copyButton}
                >
                  <Text style={styles.copyButtonText}>
                    {copiedSeed ? 'Copied!' : 'Copy'}
                  </Text>
                </Pressable>
              </View>
            )}
            {detail.prompt ? (
              <View style={styles.promptBlock}>
                <Text style={styles.infoKey}>Prompt</Text>
                <Text style={styles.promptText} selectable>
                  {detail.prompt}
                </Text>
              </View>
            ) : null}
            {detail.negative_prompt ? (
              <View style={styles.promptBlock}>
                <Text style={styles.infoKey}>Avoided</Text>
                <Text style={[styles.promptText, styles.promptTextMuted]} selectable>
                  {detail.negative_prompt}
                </Text>
              </View>
            ) : null}
          </View>

          {notice !== null && (
            <View
              style={[styles.noticeCard, notice.kind === 'error' && styles.noticeCardError]}
            >
              <Text
                style={[styles.noticeText, notice.kind === 'error' && styles.noticeTextError]}
              >
                {notice.text}
              </Text>
            </View>
          )}

          <Pressable
            style={[styles.primaryButton, (saving || wallpaperBusy) && styles.buttonBusy]}
            onPress={doSave}
            disabled={saving || wallpaperBusy}
          >
            {saving ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.primaryButtonText}>Save to device</Text>
            )}
          </Pressable>

          {capabilities.canSetWallpaper && (
            <Pressable
              style={[styles.wallpaperButton, (saving || wallpaperBusy) && styles.buttonBusy]}
              onPress={doWallpaper}
              disabled={saving || wallpaperBusy}
            >
              {wallpaperBusy ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.wallpaperButtonText}>Set as wallpaper</Text>
              )}
            </Pressable>
          )}

          {confirming ? (
            <View style={styles.confirmCard}>
              <Text style={styles.confirmText}>Delete {detail.filename} permanently?</Text>
              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.button, styles.cancelButton]}
                  onPress={() => setConfirming(false)}
                  disabled={deleting}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.deleteButton]}
                  onPress={doDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.deleteButtonText}>Yes, delete</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.deleteButton} onPress={() => setConfirming(true)}>
              <Text style={styles.deleteButtonText}>Delete image</Text>
            </Pressable>
          )}
        </>
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
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: 380,
    borderRadius: radii.lg,
    backgroundColor: colors.cardAlt,
  },
  infoCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  seedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  infoKey: {
    color: colors.muted,
    fontSize: 14,
  },
  infoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '50%',
  },
  copyButton: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  copyButtonText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  promptBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  promptText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  promptTextMuted: {
    color: colors.muted,
  },
  noticeCard: {
    backgroundColor: '#12291B',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  noticeCardError: {
    backgroundColor: '#2A1520',
    borderColor: colors.danger,
  },
  noticeText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  noticeTextError: {
    color: colors.danger,
    fontWeight: '500',
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  buttonBusy: {
    opacity: 0.7,
  },
  wallpaperButton: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  wallpaperButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  deleteButton: {
    backgroundColor: '#7F1D1D',
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  deleteButtonText: {
    color: '#FEE2E2',
    fontSize: 15,
    fontWeight: '800',
  },
  confirmCard: {
    backgroundColor: '#2A1520',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  confirmText: {
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  button: {
    flex: 1,
    borderRadius: radii.sm,
    paddingVertical: 11,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  cancelButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  errorCard: {
    backgroundColor: '#2A1520',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
});
