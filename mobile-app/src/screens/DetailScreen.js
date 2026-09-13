// Detail - full info and actions for a single gallery image.
// Gestures: swipe left/right to flip between images. Pinch with two
// fingers opens a full-screen zoom viewer: pinch to zoom, drag to pan
// while zoomed, double-tap toggles 2x. Close with the Close button or Back.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
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
import { loadGalleryFilenames } from '../services/galleryCache';
import WallpaperImage from '../components/WallpaperImage';
import { capabilities, setAsWallpaper } from '../services/deviceMedia';
import { saveWallpaper } from '../services/saveTarget';
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

const MAX_SCALE = 5;
const IMAGE_HEIGHT = 420;

function touchDistance(touches) {
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return 0;
  const dx = a.pageX - b.pageX;
  const dy = a.pageY - b.pageY;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Number.isFinite(d) ? d : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function DetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const startFilename = route.params?.filename;

  // --- Gallery neighbors (for swiping between images) ----------------------
  const [filenames, setFilenames] = useState(startFilename ? [startFilename] : []);
  const [index, setIndex] = useState(0);
  const filename = filenames[index] || startFilename;
  const filenamesRef = useRef(filenames);
  filenamesRef.current = filenames;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Same list the gallery shows, so swiping also works offline (it falls
        // back to the copy saved on this phone).
        const list = await loadGalleryFilenames({ limit: 200 });
        if (!alive || list.length === 0) return;
        const idx = list.indexOf(startFilename);
        if (idx >= 0) {
          setFilenames(list);
          setIndex(idx);
        }
      } catch (err) {
        // Neighbor list is optional - swiping just stays single-image.
      }
    })();
    return () => {
      alive = false;
    };
  }, [startFilename]);

  const canSwipe = filenames.length > 1;
  const canSwipeRef = useRef(canSwipe);
  canSwipeRef.current = canSwipe;

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(filenamesRef.current.length - 1, i + 1));
  }, []);
  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // --- Detail data -----------------------------------------------------------
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [copiedSeed, setCopiedSeed] = useState(false);

  // --- Full-screen zoom viewer (Modal) ----------------------------------------
  // Animated values are native-driven, so panning never jitters.
  const [viewerVisible, setViewerVisible] = useState(false);
  const scaleAv = useRef(new Animated.Value(1)).current;
  const transX = useRef(new Animated.Value(0)).current;
  const transY = useRef(new Animated.Value(0)).current;
  const lastScale = useRef(1);
  const lastTrans = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const s = scaleAv.addListener(({ value }) => {
      lastScale.current = value;
    });
    const tx = transX.addListener(({ value }) => {
      lastTrans.current.x = value;
    });
    const ty = transY.addListener(({ value }) => {
      lastTrans.current.y = value;
    });
    return () => {
      scaleAv.removeListener(s);
      transX.removeListener(tx);
      transY.removeListener(ty);
    };
  }, [scaleAv, transX, transY]);

  const openViewer = useCallback(() => {
    scaleAv.stopAnimation();
    transX.stopAnimation();
    transY.stopAnimation();
    scaleAv.setValue(1);
    transX.setValue(0);
    transY.setValue(0);
    lastScale.current = 1;
    lastTrans.current = { x: 0, y: 0 };
    setViewerVisible(true);
  }, [scaleAv, transX, transY]);

  const closeViewer = useCallback(() => {
    setViewerVisible(false);
    scaleAv.stopAnimation();
    transX.stopAnimation();
    transY.stopAnimation();
    scaleAv.setValue(1);
    transX.setValue(0);
    transY.setValue(0);
    lastScale.current = 1;
    lastTrans.current = { x: 0, y: 0 };
  }, [scaleAv, transX, transY]);

  const pinchBase = useRef({ dist: 0, scale: 1 });
  const panBase = useRef({ x: 0, y: 0 });
  const isPinching = useRef(false);
  const didPinch = useRef(false);
  const tapStart = useRef({ x: 0, y: 0, t: 0 });
  const viewerLastTap = useRef(0);

  // Viewer gestures: pinch zooms (never closes), drag pans while zoomed,
  // double-tap toggles 2x. Exit = Close button or Android back button.
  const viewerResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt) => {
          didPinch.current = false;
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            isPinching.current = true;
            didPinch.current = true;
            pinchBase.current = {
              dist: touchDistance(touches),
              scale: lastScale.current,
            };
          } else {
            isPinching.current = false;
            panBase.current = { x: lastTrans.current.x, y: lastTrans.current.y };
            tapStart.current = {
              x: evt.nativeEvent.pageX,
              y: evt.nativeEvent.pageY,
              t: Date.now(),
            };
          }
        },

        onPanResponderMove: (evt, g) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            if (!isPinching.current) {
              isPinching.current = true;
              didPinch.current = true;
              pinchBase.current = {
                dist: touchDistance(touches),
                scale: lastScale.current,
              };
              return;
            }
            const dist = touchDistance(touches);
            if (pinchBase.current.dist > 0) {
              const next = clamp(
                pinchBase.current.scale * (dist / pinchBase.current.dist),
                1,
                MAX_SCALE
              );
              if (Number.isFinite(next)) {
                scaleAv.setValue(next);
                lastScale.current = next;
              }
            }
          } else {
            if (isPinching.current) {
              isPinching.current = false;
              panBase.current = { x: lastTrans.current.x, y: lastTrans.current.y };
              return;
            }
            // Pan only while zoomed, so the image never drifts at 1x.
            if (lastScale.current > 1.05) {
              const nx = panBase.current.x + g.dx;
              const ny = panBase.current.y + g.dy;
              transX.setValue(nx);
              transY.setValue(ny);
              lastTrans.current = { x: nx, y: ny };
            }
          }
        },

        onPanResponderRelease: (evt, g) => {
          const pinching = didPinch.current;
          isPinching.current = false;
          // If a pinch ended back near 1x, re-center the image (never close).
          if (lastScale.current <= 1.05) {
            Animated.spring(scaleAv, { toValue: 1, useNativeDriver: false, friction: 8 }).start(({ finished }) => {
              if (finished) {
                lastScale.current = 1;
                lastTrans.current = { x: 0, y: 0 };
              }
            });
            Animated.spring(transX, { toValue: 0, useNativeDriver: false, friction: 8 }).start();
            Animated.spring(transY, { toValue: 0, useNativeDriver: false, friction: 8 }).start();
          }
          // Double-tap toggles zoom.
          const moveX = Math.abs((evt.nativeEvent.pageX || 0) - (tapStart.current?.x ?? 0));
          const moveY = Math.abs((evt.nativeEvent.pageY || 0) - (tapStart.current?.y ?? 0));
          const quick = Date.now() - (tapStart.current?.t ?? 0) < 250;
          if (!pinching && quick && moveX < 15 && moveY < 15) {
            const now = Date.now();
            if (now - viewerLastTap.current < 280) {
              viewerLastTap.current = 0;
              if (lastScale.current > 1.3) {
                Animated.spring(scaleAv, { toValue: 1, useNativeDriver: false, friction: 8 }).start(({ finished }) => {
                  if (finished) {
                    lastScale.current = 1;
                    lastTrans.current = { x: 0, y: 0 };
                  }
                });
                Animated.spring(transX, { toValue: 0, useNativeDriver: false, friction: 8 }).start();
                Animated.spring(transY, { toValue: 0, useNativeDriver: false, friction: 8 }).start();
              } else {
                Animated.spring(scaleAv, { toValue: 2, useNativeDriver: false, friction: 8 }).start(({ finished }) => {
                  if (finished) {
                    lastScale.current = 2;
                  }
                });
              }
            } else {
              viewerLastTap.current = now;
            }
          }
        },

        onPanResponderTerminate: () => {
          isPinching.current = false;
        },
      }),
    [scaleAv, transX, transY, closeViewer]
  );

  // Inline image gestures: swipe to flip; two-finger pinch opens the viewer.
  // Taps deliberately do NOTHING here (no accidental fullscreen opens).
  const swipeDone = useRef(false);

  const inlineResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (evt, g) =>
          canSwipeRef.current &&
          Math.abs(g.dx) > 12 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => true,

        onPanResponderGrant: (evt) => {
          swipeDone.current = false;
          if (evt.nativeEvent.touches.length >= 2) {
            openViewer();
          }
        },
        onPanResponderMove: (evt, g) => {
          if (evt.nativeEvent.touches.length >= 2) return;
          if (!swipeDone.current) {
            if (g.dx < -60 && Math.abs(g.dy) < 40) {
              swipeDone.current = true;
              goNext();
            } else if (g.dx > 60 && Math.abs(g.dy) < 40) {
              swipeDone.current = true;
              goPrev();
            }
          }
        },
        onPanResponderRelease: () => {},
      }),
    [openViewer, goNext, goPrev]
  );

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
      // Honours the Save location setting - gallery or the chosen SD folder.
      const result = await saveWallpaper(api.imageUrl(filename), filename);
      setNotice({
        kind: result.ok ? 'ok' : 'error',
        text: result.message,
      });
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
          <View style={styles.imageWrap}>
            <View style={styles.imageStage} {...inlineResponder.panHandlers}>
              <WallpaperImage
                filename={filename}
                style={styles.image}
                resizeMode="contain"
              />
            </View>
            {canSwipe && (
              <View style={styles.positionBadge}>
                <Text style={styles.positionText}>
                  {index + 1} / {filenames.length}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.gestureHint}>
            Swipe to flip  |  Pinch with two fingers to zoom
          </Text>

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
                <Pressable onPress={copySeed} style={styles.copyButton}>
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

      <Modal
        visible={viewerVisible}
        transparent
        animationType="none"
        onRequestClose={closeViewer}
      >
        <View style={styles.viewerBackdrop}>
          <View style={styles.viewerStage} {...viewerResponder.panHandlers}>
            <WallpaperImage
              filename={filename}
              style={[
                styles.viewerImage,
                {
                  transform: [
                    { translateX: transX },
                    { translateY: transY },
                    { scale: scaleAv },
                  ],
                },
              ]}
              resizeMode="contain"
            />
          </View>
          <Pressable style={styles.viewerClose} onPress={closeViewer} hitSlop={8}>
            <Text style={styles.viewerCloseText}>Close</Text>
          </Pressable>
          <Text style={styles.viewerHint}>
            Pinch to zoom  |  Drag to move  |  Double-tap toggles  |  Back closes
          </Text>
        </View>
      </Modal>
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
  imageWrap: {
    position: 'relative',
  },
  imageStage: {
    width: '100%',
    height: IMAGE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardAlt,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  gestureHint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  positionBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  positionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
  },
  viewerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderColor: 'rgba(255,255,255,0.4)',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  viewerCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  viewerHint: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    color: '#BBBBBB',
    fontSize: 12,
    textAlign: 'center',
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