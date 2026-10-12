// Gallery - grid of wallpapers from the phone's own store (default) or the
// server. Search, sort, a favourites filter, upload, import-from-SD, and a
// long-press action sheet (set wallpaper / star / save / share / delete).
//
// Delete is undoable for a few seconds, and the grid renders cached thumbnails
// so it stays light with a large collection.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
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
import { favoriteImageSet, toggleImageFavorite } from '../services/imageFavorites';
import { capabilities, setAsWallpaper } from '../services/deviceMedia';
import { saveWallpaper } from '../services/saveTarget';
import { shareWallpaper } from '../services/share';
import { getThumbnailUri } from '../services/thumbnails';
import { loadGalleryPrefs, saveGalleryPrefs } from '../services/galleryPrefs';
import { hasSeenTip, markTipSeen } from '../services/coachTips';
import { shuffleWallpaperOnce } from '../services/shuffle';
import WallpaperImage from '../components/WallpaperImage';
import { colors, radii, spacing } from '../theme';

const UNDO_MS = 5000;

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

// Best-effort timestamp for sorting, from either source's fields.
function stampOf(item) {
  if (item && typeof item.mtime === 'number' && item.mtime > 0) {
    return item.mtime;
  }
  if (item && item.created_at) {
    const parsed = Date.parse(item.created_at);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'favorites', label: '\u2605 Favourites first' },
  { id: 'name', label: 'A-Z' },
];

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
  // { text, offline } or null.
  const [error, setError] = useState(null);
  // Non-null while the grid shows a cached copy instead of a live server list.
  const [staleList, setStaleList] = useState(null);
  const [migrationNotice, setMigrationNotice] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState(null);
  // Search / sort / favourites filter (client-side).
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favSet, setFavSet] = useState(() => new Set());
  // Cached grid thumbnails, keyed by filename.
  const [thumbs, setThumbs] = useState({});
  const thumbsCacheRef = useRef({});
  // The long-press action sheet.
  const [sheetItem, setSheetItem] = useState(null);
  // Feedback for set/save/share (the bottom bar).
  const [notice, setNotice] = useState(null);
  // Undoable delete: the tile is hidden, an Undo bar shows, the file is really
  // removed after UNDO_MS unless undone.
  const [undo, setUndo] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const deleteTimer = useRef(null);
  // Remembered preferences + copy style + first-run tip.
  const [captionMode, setCaptionMode] = useState('name');
  const [tipVisible, setTipVisible] = useState(false);
  const [shuffleBusy, setShuffleBusy] = useState(false);
  const prefsReady = useRef(false);
  // Selection mode for bulk actions.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);

    try {
      setFavSet(await favoriteImageSet());
    } catch (err) {
      // stars are optional
    }

    const current = await getGallerySource();
    setSource(current);

    if (current === PHONE) {
      setMigrationNotice(await takeGallerySourceNotice());
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
        setStaleList({ savedAt: result.savedAt, offline: false, serverEmpty: true });
      } else {
        setStaleList(null);
      }
    } catch (err) {
      setError({
        text: err.message || 'Could not load the gallery.',
        offline: isOfflineError(err),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(images.length === 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  // Clear the delete timer if the screen unmounts mid-undo.
  useEffect(() => () => {
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
    }
  }, []);

  // Remembered sort / filter / caption, and the one-time long-press tip.
  useEffect(() => {
    let alive = true;
    loadGalleryPrefs()
      .then((prefs) => {
        if (!alive) {
          return;
        }
        setSortBy(prefs.sortBy);
        setFavoritesOnly(!!prefs.favoritesOnly);
        setCaptionMode(prefs.captionMode);
        prefsReady.current = true;
      })
      .catch(() => {
        prefsReady.current = true;
      });
    hasSeenTip('gallery-longpress')
      .then((seen) => {
        if (alive && !seen) {
          setTipVisible(true);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!prefsReady.current) {
      return;
    }
    saveGalleryPrefs({ sortBy, favoritesOnly, captionMode });
  }, [sortBy, favoritesOnly, captionMode]);

  // Build simple cached thumbnails for the phone gallery, one at a time so the
  // screen never stalls. Cached across launches in the cache directory.
  useEffect(() => {
    if (source !== PHONE) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      for (const img of images) {
        if (cancelled) {
          return;
        }
        if (thumbsCacheRef.current[img.filename]) {
          continue;
        }
        const uri = await getThumbnailUri(img);
        if (cancelled) {
          return;
        }
        if (uri) {
          thumbsCacheRef.current[img.filename] = uri;
          setThumbs((prev) => ({ ...prev, [img.filename]: uri }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [images, source]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setImportNotice(null);
    load(false);
  }, [load]);

  const sourceUri = useCallback(
    (item) => (source === PHONE ? item.uri : api.imageUrl(item.filename)),
    [source]
  );

  // ---- Delete (undoable) ---------------------------------------------------
  const commitDelete = useCallback(
    async (item) => {
      setUndo(null);
      deleteTimer.current = null;
      const restore = () =>
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(item.filename);
          return next;
        });
      try {
        if (source === PHONE) {
          const result = await deleteLocalImage(item.filename);
          if (!result.ok) {
            setNotice({ kind: 'error', text: result.message || 'Delete failed.' });
            restore();
            return;
          }
        } else {
          await api.deleteImage(item.filename);
        }
        setImages((prev) => prev.filter((img) => img.filename !== item.filename));
        setTotal((prev) => Math.max(0, prev - 1));
      } catch (err) {
        setNotice({ kind: 'error', text: err.message || 'Delete failed.' });
        restore();
      } finally {
        restore();
      }
    },
    [source]
  );

  const armDelete = useCallback(
    (item) => {
      if (deleteTimer.current) {
        clearTimeout(deleteTimer.current);
      }
      setNotice(null);
      setHidden((prev) => new Set(prev).add(item.filename));
      setUndo({ item });
      deleteTimer.current = setTimeout(() => commitDelete(item), UNDO_MS);
    },
    [commitDelete]
  );

  const undoDelete = useCallback(() => {
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    setHidden((prev) => {
      const next = new Set(prev);
      if (undo?.item) {
        next.delete(undo.item.filename);
      }
      return next;
    });
    setUndo(null);
  }, [undo]);

  // ---- Action sheet --------------------------------------------------------
  const toggleFavorite = async (item) => {
    try {
      const { list } = await toggleImageFavorite(item.filename);
      setFavSet(new Set(list));
    } catch (err) {
      // best-effort
    }
  };

  // ---- Selection mode (bulk actions) --------------------------------------
  const toggleSelect = (item) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.filename)) {
        next.delete(item.filename);
      } else {
        next.add(item.filename);
      }
      return next;
    });

  const toggleSelectMode = () => {
    setSelectMode((prev) => !prev);
    setSelected(new Set());
    setSheetItem(null);
  };

  const selectedItems = useMemo(
    () => images.filter((img) => selected.has(img.filename)),
    [images, selected]
  );

  const bulkDelete = () => {
    const count = selectedItems.length;
    if (count === 0) {
      return;
    }
    Alert.alert(
      'Delete wallpapers?',
      `Remove ${count} wallpaper${count === 1 ? '' : 's'} from ${
        source === PHONE ? 'this phone' : 'the server'
      }?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const names = new Set(selected);
            for (const item of selectedItems) {
              try {
                if (source === PHONE) {
                  await deleteLocalImage(item.filename);
                } else {
                  await api.deleteImage(item.filename);
                }
              } catch (err) {
                // keep going - one failure must not strand the rest
              }
            }
            setImages((prev) => prev.filter((img) => !names.has(img.filename)));
            setTotal((prev) => Math.max(0, prev - count));
            setSelected(new Set());
            setSelectMode(false);
            setBusy(false);
          },
        },
      ]
    );
  };

  const bulkSave = async () => {
    const count = selectedItems.length;
    if (count === 0) {
      return;
    }
    setBusy(true);
    setNotice(null);
    let saved = 0;
    for (const item of selectedItems) {
      try {
        const result = await saveWallpaper(sourceUri(item), item.filename);
        if (result.ok) {
          saved += 1;
        }
      } catch (err) {
        // counted via the total below
      }
    }
    setNotice({
      kind: saved === count ? 'ok' : 'error',
      text: `Saved ${saved} of ${count} wallpaper${count === 1 ? '' : 's'}.`,
    });
    setSelected(new Set());
    setSelectMode(false);
    setBusy(false);
  };

  // ---- Shuffle now --------------------------------------------------------
  const shuffleNow = async () => {
    if (shuffleBusy) {
      return;
    }
    setShuffleBusy(true);
    setNotice(null);
    try {
      const result = await shuffleWallpaperOnce();
      setNotice({ kind: result.ok ? 'ok' : 'error', text: result.message });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: (err && err.message) || 'Could not change the wallpaper.',
      });
    } finally {
      setShuffleBusy(false);
    }
  };

  const runSheetAction = async (action) => {
    const item = sheetItem;
    setSheetItem(null);
    if (!item) {
      return;
    }
    setNotice(null);
    try {
      if (action === 'set') {
        const result = await setAsWallpaper(sourceUri(item));
        setNotice(
          result.ok
            ? { kind: 'ok', text: 'Wallpaper set on the home screen.' }
            : { kind: 'error', text: result.message || 'Could not set the wallpaper.' }
        );
      } else if (action === 'star') {
        await toggleFavorite(item);
      } else if (action === 'save') {
        const result = await saveWallpaper(sourceUri(item), item.filename);
        setNotice({ kind: result.ok ? 'ok' : 'error', text: result.message });
      } else if (action === 'share') {
        const result = await shareWallpaper(sourceUri(item));
        if (!result.ok) {
          setNotice({ kind: 'error', text: result.message || 'Could not share that image.' });
        }
      } else if (action === 'delete') {
        armDelete(item);
      }
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'That action failed.' });
    }
  };

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
      if (source === PHONE) {
        const saved = await saveLocalImage({
          localUri: asset.uri,
          filename: asset.fileName || `upload-${Date.now()}.jpg`,
          meta: { source: PHONE },
        });
        if (!saved || !saved.ok) {
          throw new Error((saved && saved.message) || "Couldn't add that image.");
        }
        await load(false);
        return;
      }

      const uploaded = await api.uploadImage({
        uri: asset.uri,
        fileName: asset.fileName || 'upload.jpg',
        mimeType: asset.mimeType,
      });
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

  // The list actually shown: hidden (delete-pending) tiles removed, then the
  // search box, the favourites filter and the sort order applied.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = images.filter((img) => !hidden.has(img.filename));
    if (favoritesOnly) {
      list = list.filter((img) => favSet.has(img.filename));
    }
    if (needle) {
      list = list.filter((img) => {
        const haystack = `${img.filename || ''} ${img.prompt || ''} ${img.source || ''}`;
        return haystack.toLowerCase().includes(needle);
      });
    }
    const sorted = [...list];
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => stampOf(a) - stampOf(b));
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
    } else if (sortBy === 'favorites') {
      sorted.sort(
        (a, b) =>
          (favSet.has(b.filename) ? 1 : 0) - (favSet.has(a.filename) ? 1 : 0) ||
          stampOf(b) - stampOf(a)
      );
    } else {
      sorted.sort((a, b) => stampOf(b) - stampOf(a));
    }
    return sorted;
  }, [images, query, sortBy, favoritesOnly, favSet, hidden]);

  const filtersActive = favoritesOnly || query.trim().length > 0;

  const renderItem = ({ item }) => {
    const isFav = favSet.has(item.filename);
    const isChecked = selected.has(item.filename);
    const thumb = source === PHONE ? thumbs[item.filename] || null : null;
    const caption = captionMode === 'prompt' && item.prompt ? item.prompt : item.filename;
    return (
      <Pressable
        style={[styles.cell, selectMode && isChecked && styles.cellSelected]}
        onPress={() => {
          if (selectMode) {
            toggleSelect(item);
            return;
          }
          navigation.navigate(
            'Detail',
            source === PHONE ? { filename: item.filename, local: true } : { filename: item.filename }
          );
        }}
        onLongPress={() => {
          if (!selectMode) {
            setSheetItem(item);
          }
        }}
        delayLongPress={280}
      >
        <WallpaperImage
          filename={item.filename}
          localUri={source === PHONE ? item.uri : null}
          overrideUri={thumb}
          style={styles.thumb}
          resizeMode="cover"
          preferCache={source !== PHONE && staleList !== null}
        />
        {selectMode ? (
          <View style={[styles.checkBadge, isChecked && styles.checkBadgeOn]}>
            <Text style={styles.checkBadgeText}>{isChecked ? '\u2713' : ''}</Text>
          </View>
        ) : (
          <Pressable
            style={styles.starBadge}
            onPress={() => toggleFavorite(item)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={isFav ? 'Remove from favourites' : 'Star as a favourite'}
          >
            <Text style={[styles.starBadgeText, isFav && styles.starBadgeTextOn]}>
              {isFav ? '\u2605' : '\u2606'}
            </Text>
          </Pressable>
        )}
        <Text style={styles.cellCaption} numberOfLines={2}>
          {caption}
        </Text>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Loading gallery...</Text>
      </View>
    );
  }

  const phoneMode = source === PHONE;
  const offlineNoList = !phoneMode && error !== null && error.offline && images.length === 0;

  return (
    <View style={styles.screen}>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.filename}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (undo || selectMode ? 96 : spacing.lg) },
        ]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        updateCellsBatchingPeriod={50}
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
            {tipVisible && (
              <View style={styles.tipCard}>
                <Text style={styles.tipText}>
                  Tip: long-press a picture for more options (set, star, share, delete).
                </Text>
                <Pressable
                  style={styles.tipButton}
                  onPress={() => {
                    setTipVisible(false);
                    markTipSeen('gallery-longpress');
                  }}
                >
                  <Text style={styles.tipButtonText}>Got it</Text>
                </Pressable>
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

            {images.length > 0 && (
              <>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search names and prompts"
                  placeholderTextColor={colors.muted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                <View style={styles.sortRow}>
                  {SORT_OPTIONS.map((option) => {
                    const active = sortBy === option.id;
                    return (
                      <Pressable
                        key={option.id}
                        style={[styles.sortChip, active && styles.sortChipActive]}
                        onPress={() => setSortBy(option.id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  style={[styles.favToggle, favoritesOnly && styles.favToggleActive]}
                  onPress={() => setFavoritesOnly((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: favoritesOnly }}
                >
                  <Text
                    style={[styles.favToggleText, favoritesOnly && styles.favToggleTextActive]}
                  >
                    {favoritesOnly ? '\u2605 Showing favourites only' : '\u2606 Show favourites only'}
                  </Text>
                </Pressable>
                <View style={styles.toolRow}>
                  <Pressable
                    style={styles.toolChip}
                    onPress={() => setCaptionMode((mode) => (mode === 'name' ? 'prompt' : 'name'))}
                  >
                    <Text style={styles.toolChipText}>
                      {captionMode === 'name' ? 'Show prompt' : 'Show name'}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.toolChip} onPress={shuffleNow} disabled={shuffleBusy}>
                    <Text style={styles.toolChipText}>
                      {shuffleBusy ? 'Shuffling...' : 'Shuffle'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.toolChip, selectMode && styles.toolChipActive]}
                    onPress={toggleSelectMode}
                  >
                    <Text style={[styles.toolChipText, selectMode && styles.toolChipTextActive]}>
                      {selectMode ? 'Done' : 'Select'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            {!offlineNoList && (
              <Text style={styles.header}>
                {filtersActive
                  ? `${visible.length} of ${total} shown`
                  : `${total} wallpaper${total === 1 ? '' : 's'}`}{' '}
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
          offlineNoList ? null : filtersActive && images.length > 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>
                {favoritesOnly
                  ? 'Nothing here is starred yet. Tap the \u2606 on a wallpaper to star it.'
                  : 'No wallpaper matches that search. Try a word from the picture or its prompt.'}
              </Text>
            </View>
          ) : phoneMode ? (
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

      {/* Action sheet (long-press a tile). */}
      <Modal
        visible={sheetItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetItem(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetItem(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {sheetItem ? sheetItem.filename : ''}
            </Text>
            {capabilities.canSetWallpaper && (
              <Pressable style={styles.sheetRow} onPress={() => runSheetAction('set')}>
                <Text style={styles.sheetRowText}>Set as wallpaper</Text>
              </Pressable>
            )}
            <Pressable style={styles.sheetRow} onPress={() => runSheetAction('star')}>
              <Text style={styles.sheetRowText}>
                {sheetItem && favSet.has(sheetItem.filename)
                  ? '\u2605 Remove from favourites'
                  : '\u2606 Add to favourites'}
              </Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => runSheetAction('save')}>
              <Text style={styles.sheetRowText}>Save to device</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => runSheetAction('share')}>
              <Text style={styles.sheetRowText}>Share</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => runSheetAction('delete')}>
              <Text style={[styles.sheetRowText, styles.sheetRowTextDanger]}>Delete</Text>
            </Pressable>
            <Pressable style={styles.sheetCancel} onPress={() => setSheetItem(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Bottom bar: undo takes priority, then action feedback, then load error. */}
      {selectMode ? (
        <View style={[styles.bottomBar, styles.selectBar, { bottom: insets.bottom + spacing.md }]}>
          <Text style={styles.selectCount}>{selected.size} selected</Text>
          <View style={styles.selectActions}>
            <Pressable
              style={styles.selectAction}
              onPress={bulkSave}
              disabled={busy || selected.size === 0}
            >
              <Text style={styles.selectActionText}>Save</Text>
            </Pressable>
            <Pressable
              style={styles.selectAction}
              onPress={bulkDelete}
              disabled={busy || selected.size === 0}
            >
              <Text style={[styles.selectActionText, styles.selectActionDanger]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : undo ? (
        <View style={[styles.bottomBar, styles.undoBar, { bottom: insets.bottom + spacing.md }]}>
          <Text style={styles.undoText} numberOfLines={1}>
            Deleted {undo.item.filename}
          </Text>
          <Pressable style={styles.undoAction} onPress={undoDelete}>
            <Text style={styles.undoActionText}>Undo</Text>
          </Pressable>
        </View>
      ) : notice !== null ? (
        <Pressable
          style={[
            styles.bottomBar,
            notice.kind === 'error' ? styles.errorCard : styles.noticeBar,
            { bottom: insets.bottom + spacing.md },
          ]}
          onPress={() => setNotice(null)}
        >
          <Text style={notice.kind === 'error' ? styles.errorText : styles.noticeBarText}>
            {notice.text}
          </Text>
        </Pressable>
      ) : error !== null && !offlineNoList ? (
        <View
          style={[styles.bottomBar, styles.errorCard, { bottom: insets.bottom + spacing.md }]}
        >
          <Text style={styles.errorText}>{error.text}</Text>
        </View>
      ) : null}
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
  searchInput: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  sortChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sortChipActive: {
    backgroundColor: colors.control,
    borderColor: colors.accent,
  },
  sortChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  sortChipTextActive: {
    color: colors.accent,
  },
  favToggle: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  favToggleActive: {
    backgroundColor: colors.control,
    borderColor: colors.accent,
  },
  favToggleText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  favToggleTextActive: {
    color: colors.accent,
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
  starBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radii.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  starBadgeText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
  },
  starBadgeTextOn: {
    color: colors.warn,
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
  // Action sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetTitle: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  sheetRow: {
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 13,
    alignItems: 'center',
  },
  sheetRowText: {
    color: '#EAF7F1',
    fontSize: 15,
    fontWeight: '700',
  },
  sheetRowTextDanger: {
    color: '#FEE2E2',
  },
  sheetCancel: {
    paddingVertical: 13,
    alignItems: 'center',
  },
  sheetCancelText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  // Bottom bars
  bottomBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  undoBar: {
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
  },
  undoText: {
    color: '#EAF7F1',
    fontSize: 14,
    flex: 1,
  },
  undoAction: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  undoActionText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '800',
  },
  noticeBar: {
    backgroundColor: colors.noticeBg,
    borderColor: colors.accent,
    borderWidth: 1,
  },
  noticeBarText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    backgroundColor: '#2A1520',
    borderColor: colors.danger,
    borderWidth: 1,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
  // First-run tip
  tipCard: {
    backgroundColor: colors.card,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  tipText: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 19,
  },
  tipButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  tipButtonText: {
    color: '#EAF7F1',
    fontSize: 13,
    fontWeight: '700',
  },
  // Tool row (caption / shuffle / select)
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  toolChip: {
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  toolChipActive: {
    borderColor: colors.accent,
  },
  toolChipText: {
    color: '#EAF7F1',
    fontSize: 12,
    fontWeight: '700',
  },
  toolChipTextActive: {
    color: colors.accent,
  },
  cellSelected: {
    borderColor: colors.accent,
  },
  checkBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadgeOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkBadgeText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '900',
  },
  // Selection bar
  selectBar: {
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
  },
  selectCount: {
    color: '#EAF7F1',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  selectActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  selectAction: {
    backgroundColor: colors.card,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  selectActionText: {
    color: '#EAF7F1',
    fontSize: 14,
    fontWeight: '700',
  },
  selectActionDanger: {
    color: '#FEE2E2',
  },
});
