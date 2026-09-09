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
import api from '../services/api';
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
          </View>

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
  infoKey: {
    color: colors.muted,
    fontSize: 14,
  },
  infoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '65%',
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
