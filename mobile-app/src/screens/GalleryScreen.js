// Gallery - grid of generated wallpapers with upload, detail and delete.
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import SlideshowModal from '../components/SlideshowModal';
import api from '../services/api';
import { colors, radii, spacing } from '../theme';

export default function GalleryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [images, setImages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [slideshowVisible, setSlideshowVisible] = useState(false);
  const [slideshowStart, setSlideshowStart] = useState(0);
  const hasLoadedRef = useRef(false);

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

  // Reload every time the screen gains focus (first focus shows a spinner,
  // later ones - e.g. returning from Detail after a delete - refresh silently).
  useFocusEffect(
    useCallback(() => {
      load(!hasLoadedRef.current);
      hasLoadedRef.current = true;
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(false);
  }, [load]);

  const pickAndUpload = async () => {
    // Permission is required on native; on web it resolves immediately.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission && permission.granted === false) {
      setError('Photo library permission is required to upload.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }
    const asset = result.assets[0];
    setUploading(true);
    setError(null);
    try {
      await api.uploadImage({
        uri: asset.uri,
        fileName: asset.fileName || 'upload.jpg',
        mimeType: asset.mimeType,
      });
      await load(false);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const openSlideshow = (startIndex = 0) => {
    if (images.length === 0) {
      return;
    }
    setSlideshowStart(Math.min(Math.max(startIndex, 0), images.length - 1));
    setSlideshowVisible(true);
  };

  const renderItem = ({ item, index }) => (
    <Pressable
      style={styles.cell}
      onPress={() =>
        navigation.navigate('Detail', {
          filename: item.filename,
          filenames: images.map((image) => image.filename),
        })
      }
      onLongPress={() => openSlideshow(index)}
    >
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
          <View style={styles.headerBlock}>
            <Text style={styles.header}>
              {total} wallpaper{total === 1 ? '' : 's'} on the server
            </Text>
            <View style={styles.headerButtons}>
              <Pressable
                style={[styles.uploadButton, styles.headerButton, uploading && styles.uploadButtonBusy]}
                onPress={pickAndUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.uploadButtonText}>Upload image</Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.slideshowButton, styles.headerButton, images.length === 0 && styles.slideshowButtonDisabled]}
                onPress={() => openSlideshow(0)}
                disabled={images.length === 0}
              >
                <Text style={styles.slideshowButtonText}>Play slideshow</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No wallpapers yet</Text>
            <Text style={styles.emptyText}>
              Generate your first one in the Generate tab, or upload an image from this
              device.
            </Text>
          </View>
        }
      />

      <SlideshowModal
        visible={slideshowVisible}
        images={images}
        initialIndex={slideshowStart}
        onClose={() => setSlideshowVisible(false)}
      />

      {error !== null && (
        <View style={[styles.errorCard, { marginBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
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
  headerBlock: {
    marginBottom: spacing.md,
  },
  header: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  uploadButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: spacing.md,
    flex: 1,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerButton: {
    marginBottom: spacing.md,
  },
  slideshowButton: {
    backgroundColor: colors.card,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
  },
  slideshowButtonDisabled: {
    opacity: 0.4,
  },
  slideshowButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '800',
  },
  uploadButtonBusy: {
    opacity: 0.7,
  },
  uploadButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
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
});
