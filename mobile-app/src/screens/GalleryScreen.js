// Gallery - grid of generated wallpapers with a fullscreen viewer.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../services/api';
import { colors, radii, spacing } from '../theme';

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const [images, setImages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await api.gallery(200);
      setImages(response.images || []);
      setTotal(response.total || 0);
    } catch (err) {
      setError(err.message || 'Could not load the gallery.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(false);
  }, [load]);

  const renderItem = ({ item }) => (
    <Pressable style={styles.cell} onPress={() => setSelected(item)}>
      <Image
        source={{ uri: api.imageUrl(item.filename) }}
        style={styles.thumb}
        resizeMode="cover"
      />
      <Text style={styles.cellCaption} numberOfLines={1}>
        {item.filename}
      </Text>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading gallery...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={images}
        keyExtractor={(item) => item.filename}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <Text style={styles.header}>
            {total} wallpaper{total === 1 ? '' : 's'} on the server
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No wallpapers yet</Text>
            <Text style={styles.emptyText}>
              Head to the Generate tab and create your first one. The gallery refreshes
 automatically.
            </Text>
          </View>
        }
      />

      {error !== null && images.length === 0 && (
        <View style={[styles.errorCard, { marginBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Modal visible={selected !== null} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <View style={[styles.modalCard, { marginBottom: insets.bottom + spacing.xl }]}>
            {selected && (
              <Image
                source={{ uri: api.imageUrl(selected.filename) }}
                style={styles.modalImage}
                resizeMode="contain"
              />
            )}
            {selected && (
              <Text style={styles.modalMeta}>
                {selected.filename}
                {selected.width ? `  |  ${selected.width}x${selected.height}` : ''}
              </Text>
            )}
            <Text style={styles.modalHint}>Tap anywhere to close</Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
  },
  listContent: {
    padding: spacing.md,
  },
  header: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
    marginLeft: spacing.xs,
  },
  row: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cell: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    aspectRatio: 0.7,
    backgroundColor: colors.cardAlt,
  },
  cellCaption: {
    color: colors.muted,
    fontSize: 11,
    padding: spacing.sm,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  errorCard: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 0,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 8, 16, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '80%',
  },
  modalMeta: {
    color: colors.text,
    fontSize: 13,
    marginTop: spacing.md,
  },
  modalHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.sm,
  },
});
