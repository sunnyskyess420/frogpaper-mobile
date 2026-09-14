// Gallery - grid of wallpapers from the phone's own store (default) or the
// server, with upload, import-from-SD, detail and delete.
//
// The source is a persisted setting: 'phone' keeps the owner's images in the
// app's document directory so they survive deploys and app reloads; 'server'
// is the original backend list, unchanged.
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import api from '../services/api';
import { isOfflineError } from '../services/api';
import { loadGallery } from '../services/galleryCache';
import { PHONE, getGallerySource, takeGallerySourceNotice } from '../services/gallerySource';
import {
  deleteLocalImage,
  describeImport,
  importFromFolder,
  listLocalImages,
  saveLocalImage,
} from '../services/localGallery';
import WallpaperImage from '../components/WallpaperImage';
import { colors, radii, spacing } from '../theme';

function formatSavedAt(ms) {
  if (!ms) {
    return 'unknown';
  }
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function GalleryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [images, setImages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 'phone' (the app's own store) or 'server' (the backend list).
  const [source, setSource] = useState(PHONE);
  // { text, offline } or null. `offline` is true only when nothing answered at
  // all, so the screen can say "No internet connection" instead of showing a
  // raw fetch error (or worse, an empty grid that looks like "no wallpapers").
  const [error, setError] = useState(null);
  // Non-null while the grid shows the copy saved on this phone instead of a
  // live server list: { savedAt, offline, serverEmpty? }.
  const [staleList, setStaleList] = useState(null);
  // The one-line migration notice, shown once on an install that predates the
  // gallery-source setting.
  const [migrationNotice, setMigrationNotice] = useState(null);
  // Import-from-SD state (phone mode only).
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);

    const current = await getGallerySource();
    setSource(current);

    if (current === PHONE) {
      setMigrationNotice(await takeGallerySourceNotice());
      // A rescan of the phone store: nothing here can fail.
      const locals = await listLocalImages();
      setImages(locals);
      setTotal(locals.length);
      setStaleList(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setMigrationNotice(null);
    try {
      const result = await loadGallery({ limit: 200 });
      setImages(result.images || []);
      setTotal(result.total || 0);
      if (result.offline) {
        setStaleList({ savedAt: result.savedAt, offline: !result.error?.status });
      } else if (result.serverEmpty) {
        // Reachable server, empty list, copies on the phone: keep showing them.
        setStaleList({ savedAt: result.savedAt, offline: false, serverEmpty: true });
      } else {
        setStaleList(null);
      }
    } catch (err) {
      // loadGallery only throws when it could not reach the server AND has no
      // cached list to fall back on.
      setError({
        text: err.message || 'Could not load the gallery.',
        offline: isOfflineError(err),
      });
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
    setImportNotice(null);
    load(false);
  }, [load]);

  // Long-press a tile to delete it (with confirmation). The right thing is
  // removed for the mode: the phone's own file, or the server's copy.
  const confirmDelete = (item) => {
    if (source === PHONE) {
      Alert.alert('Delete wallpaper?', `${item.filename} will be removed from this phone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await deleteLocalImage(item.filename);
            if (result.ok) {
              setImages((prev) => prev.filter((img) => img.filename !== item.filename));
              setTotal((prev) => Math.max(0, prev - 1));
            } else {
              setError({ text: result.message || 'Delete failed.', offline: false });
            }
          },
        },
      ]);
      return;
    }
    Alert.alert('Delete wallpaper?', `${item.filename} will be removed from the server.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteImage(item.filename);
            setImages((prev) => prev.filter((img) => img.filename !== item.filename));
            setTotal((prev) => Math.max(0, prev - 1));
          } catch (err) {
            setError({ text: err.message || 'Delete failed.', offline: false });
          }
        },
      },
    ]);
  };

  // Copies the SD-card folder's images into the phone store (phone mode).
  const importFromSd = async () => {
    if (importing) {
      return;
    }
    setImporting(true);
    setImportNotice(null);
    const result = await importFromFolder({ max: 40 });
    setImportNotice({ kind: result.ok ? 'ok' : 'error', text: describeImport(result) });
    setImporting(false);
    await load(false);
  };

  const pickAndUpload = async () => {
    // Permission is required on native; on web it resolves immediately.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission && permission.granted === false) {
      setError({ text: 'Photo library permission is required to upload.', offline: false });
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
      const uploaded = await api.uploadImage({
        uri: asset.uri,
        fileName: asset.fileName || 'upload.jpg',
        mimeType: asset.mimeType,
      });
      // In phone mode an upload also belongs in the phone's own gallery.
      const uploadedName = uploaded && uploaded.image && uploaded.image.filename;
      if (source === PHONE && uploadedName) {
        await saveLocalImage({
          remoteUrl: api.imageUrl(uploadedName),
          filename: uploadedName,
          meta: { source: PHONE },
        });
      }
      await load(false);
    } catch (err) {
      setError({ text: err.message || 'Upload failed.', offline: false });
    } finally {
      setUploading(false);
    }
  };

  const renderItem = ({ item }) => (
    <Pressable
      style={styles.cell}
      onPress={() =>
        navigation.navigate(
          'Detail',
          source === PHONE ? { filename: item.filename, local: true } : { filename: item.filename }
        )
      }
      onLongPress={() => confirmDelete(item)}
    >
      <WallpaperImage
        filename={item.filename}
        localUri={source === PHONE ? item.uri : null}
        style={styles.thumb}
        resizeMode="cover"
        preferCache={source !== PHONE && staleList !== null}
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

  const phoneMode = source === PHONE;
  // Offline with nothing cached: the grid is empty, but "No wallpapers yet"
  // would be a lie - the phone simply cannot reach the server.
  const offlineNoList = !phoneMode && error !== null && error.offline && images.length === 0;

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
            {migrationNotice !== null && (
              <View style={styles.noticeCard}>
                <Text style={styles.noticeText}>{migrationNotice}</Text>
              </View>
            )}
            {offlineNoList && (
              <View style={styles.offlineCard}>
                <Text style={styles.offlineTitle}>No internet connection</Text>
                <Text style={styles.offlineText}>
                  Check your Wi-Fi or turn off airplane mode. Nothing is saved on this
                  phone yet, so there is no list to show offline.
                </Text>
                <Pressable style={styles.retryButton} onPress={() => load(true)}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            )}
            {staleList !== null && (
              <View style={styles.offlineCard}>
                <Text style={styles.offlineTitle}>
                  {staleList.serverEmpty
                    ? 'No wallpapers on the server - showing the ones saved on this phone'
                    : staleList.offline
                      ? 'Offline - showing wallpapers saved on this phone'
                      : 'Server problem - showing wallpapers saved on this phone'}
                </Text>
                <Text style={styles.offlineText}>
                  {staleList.serverEmpty
                    ? 'The server list is empty right now. These copies open and can be set as wallpaper.'
                    : `List saved ${formatSavedAt(
                        staleList.savedAt
                      )}. New wallpapers need the backend, but saved copies open and can be set as wallpaper.`}
                </Text>
              </View>
            )}
            {!offlineNoList && (
              <Text style={styles.header}>
                {total} wallpaper{total === 1 ? '' : 's'}{' '}
                {phoneMode ? 'on this phone' : staleList !== null ? 'saved on this phone' : 'on the server'}
              </Text>
            )}
            {phoneMode && (
              <>
                <Pressable
                  style={[styles.importButton, importing && styles.importButtonBusy]}
                  onPress={importFromSd}
                  disabled={importing}
                >
                  {importing ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={styles.importButtonText}>Import from my SD folder</Text>
                  )}
                </Pressable>
                <Text style={styles.importHint}>
                  {importing
                    ? 'Reading your save folder...'
                    : 'Copies the images in your chosen save folder onto this phone.'}
                </Text>
                {importNotice !== null && (
                  <Text
                    style={[
                      styles.importNotice,
                      importNotice.kind === 'error' ? styles.importNoticeError : null,
                    ]}
                  >
                    {importNotice.text}
                  </Text>
                )}
              </>
            )}
            <Pressable
              style={[styles.uploadButton, uploading && styles.uploadButtonBusy]}
              onPress={pickAndUpload}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.uploadButtonText}>Upload image</Text>
              )}
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          offlineNoList ? null : phoneMode ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing on this phone yet</Text>
              <Text style={styles.emptyText}>
                Generate an image or import from your SD card. Wallpapers you make or
                save are kept here automatically.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No wallpapers yet</Text>
              <Text style={styles.emptyText}>
                Generate your first one in the Generate tab, or upload an image from this
                device.
              </Text>
            </View>
          )
        }
      />

      {error !== null && !offlineNoList && (
        <View style={[styles.errorCard, { marginBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.errorText}>{error.text}</Text>
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
  offlineCard: {
    backgroundColor: colors.card,
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  offlineTitle: {
    color: colors.warn,
    fontSize: 14,
    fontWeight: '700',
  },
  offlineText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  // One-line migration notice: informational, not a warning.
  noticeCard: {
    backgroundColor: colors.card,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  retryButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
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
  // Secondary control fill + border, same pair as the rest of the app.
  importButton: {
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
  },
  importButtonBusy: {
    opacity: 0.7,
  },
  importButtonText: {
    color: '#EAF7F1',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  importHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  importNotice: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  importNoticeError: {
    color: colors.danger,
  },
  uploadButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  uploadButtonBusy: {
    opacity: 0.7,
  },
  uploadButtonText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
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
