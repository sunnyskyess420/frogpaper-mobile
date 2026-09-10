// ZoomableImage - full-bleed image viewer for wallpapers.
// Supports, with zero extra native dependencies:
//   - pinch to zoom (1x - 5x)
//   - one-finger pan while zoomed (clamped to the image bounds)
//   - double-tap to toggle 1x / 2.5x
//   - horizontal swipe to move to the previous / next image (only at 1x,
//     only when a `filenames` list is provided)
//   - long-press hook (used by Detail as "hold to save")
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SCALE = 2.5;
const SWIPE_THRESHOLD = 60;
const LONG_PRESS_DELAY = 550;

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

// Distance between the two first active touches (for pinch-zoom).
function activeTouchDistance(evt) {
  const bank = evt.touchHistory && evt.touchHistory.touchBank;
  if (!bank) {
    return null;
  }
  const points = [];
  for (const touch of bank) {
    if (touch && touch.currentPageX != null && touch.currentPageY != null) {
      points.push(touch);
      if (points.length === 2) {
        break;
      }
    }
  }
  if (points.length < 2) {
    return null;
  }
  const dx = points[0].currentPageX - points[1].currentPageX;
  const dy = points[0].currentPageY - points[1].currentPageY;
  return Math.hypot(dx, dy);
}

export default function ZoomableImage({
  uri,
  filenames,
  index = 0,
  onIndexChange,
  onLongPress,
  onZoomChange,
  showCounter = false,
  style,
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Numeric mirrors of the animated values (Animated.Value reading is async).
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomedRef = useRef(false);
  const gesture = useRef({
    pinchBaseDist: null,
    pinchBaseScale: 1,
    lastTapAt: 0,
    _lastDx: 0,
    _lastDy: 0,
  });

  const reportZoom = (zoomed) => {
    if (zoomed !== zoomedRef.current) {
      zoomedRef.current = zoomed;
      if (onZoomChange) {
        onZoomChange(zoomed);
      }
    }
  };

  const applyScale = (next, { resetPan = false } = {}) => {
    scaleRef.current = next;
    scale.setValue(next);
    if (resetPan || next <= MIN_SCALE + 0.01) {
      panRef.current = { x: 0, y: 0 };
      translateX.setValue(0);
      translateY.setValue(0);
    }
    reportZoom(next > 1.01);
  };

  const animateTo = (targetScale, x = 0, y = 0) => {
    scaleRef.current = targetScale;
    panRef.current = { x, y };
    Animated.parallel([
      Animated.spring(scale, { toValue: targetScale, useNativeDriver: true, speed: 30, bounciness: 4 }),
      Animated.spring(translateX, { toValue: x, useNativeDriver: true, speed: 30, bounciness: 4 }),
      Animated.spring(translateY, { toValue: y, useNativeDriver: true, speed: 30, bounciness: 4 }),
    ]).start();
    reportZoom(targetScale > 1.01);
  };

  const resetZoom = () => {
    animateTo(1, 0, 0);
  };

  // Fresh image -> reset the viewport.
  useEffect(() => {
    resetZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const canSwipe = Array.isArray(filenames) && filenames.length > 1 && typeof onIndexChange === 'function';

  const navigate = (direction) => {
    if (!canSwipe) {
      return;
    }
    const next = index + direction;
    if (next >= 0 && next < filenames.length) {
      onIndexChange(next);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Never claim on touch-down: taps and long-presses fall through to
        // the inner Pressable. We claim only on meaningful movement.
        onMoveShouldSetPanResponder: (evt, gs) => {
          if (gs.numberActiveTouches >= 2) {
            return true; // pinch
          }
          if (scaleRef.current > 1.01) {
            return true; // pan while zoomed
          }
          // horizontal swipe intent (vertical movement stays with the page scroll)
          return Math.abs(gs.dx) > 12 && Math.abs(gs.dx) > 2 * Math.abs(gs.dy);
        },
        onPanResponderGrant: (evt, gs) => {
          gesture.current.pinchBaseDist = null;
          gesture.current._lastDx = gs.dx;
          gesture.current._lastDy = gs.dy;
        },
        onPanResponderMove: (evt, gs) => {
          if (gs.numberActiveTouches >= 2) {
            const dist = activeTouchDistance(evt);
            if (dist != null) {
              if (gesture.current.pinchBaseDist == null) {
                gesture.current.pinchBaseDist = dist;
                gesture.current.pinchBaseScale = scaleRef.current;
              }
              const next = clamp(
                gesture.current.pinchBaseScale * (dist / gesture.current.pinchBaseDist),
                MIN_SCALE,
                MAX_SCALE
              );
              applyScale(next);
            }
            gesture.current._lastDx = gs.dx;
            gesture.current._lastDy = gs.dy;
            return;
          }
          if (scaleRef.current > 1.01 && layout.width > 0 && layout.height > 0) {
            const dx = gs.dx - gesture.current._lastDx;
            const dy = gs.dy - gesture.current._lastDy;
            const maxX = ((scaleRef.current - 1) * layout.width) / 2;
            const maxY = ((scaleRef.current - 1) * layout.height) / 2;
            panRef.current = {
              x: clamp(panRef.current.x + dx, -maxX, maxX),
              y: clamp(panRef.current.y + dy, -maxY, maxY),
            };
            translateX.setValue(panRef.current.x);
            translateY.setValue(panRef.current.y);
          }
          gesture.current._lastDx = gs.dx;
          gesture.current._lastDy = gs.dy;
        },
        onPanResponderRelease: (evt, gs) => {
          const wasPinch = gesture.current.pinchBaseDist != null;
          gesture.current.pinchBaseDist = null;
          if (!wasPinch && scaleRef.current <= 1.01 && canSwipe) {
            const horizontal =
              Math.abs(gs.dx) > SWIPE_THRESHOLD && Math.abs(gs.dx) > 2 * Math.abs(gs.dy);
            if (horizontal) {
              navigate(gs.dx < 0 ? 1 : -1);
            }
          }
          if (scaleRef.current <= 1.01) {
            applyScale(MIN_SCALE, { resetPan: true });
          }
        },
        onPanResponderTerminate: () => {
          gesture.current.pinchBaseDist = null;
          if (scaleRef.current <= 1.01) {
            applyScale(MIN_SCALE, { resetPan: true });
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout.width, layout.height, index, filenames, onIndexChange, canSwipe]
  );

  const handlePress = () => {
    const now = Date.now();
    if (now - gesture.current.lastTapAt < DOUBLE_TAP_MS) {
      gesture.current.lastTapAt = 0;
      if (scaleRef.current > 1.01) {
        resetZoom();
      } else {
        animateTo(DOUBLE_TAP_SCALE, 0, 0);
      }
    } else {
      gesture.current.lastTapAt = now;
    }
  };

  return (
    <View
      style={[styles.container, style]}
      onLayout={(event) => setLayout(event.nativeEvent.layout)}
      {...panResponder.panHandlers}
    >
      <Pressable
        style={styles.pressArea}
        onPress={handlePress}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_DELAY}
      >
        <Animated.Image
          source={{ uri }}
          style={[
            styles.image,
            { transform: [{ scale }, { translateX }, { translateY }] },
          ]}
          resizeMode="contain"
        />
      </Pressable>
      {showCounter && Array.isArray(filenames) && filenames.length > 1 && (
        <View style={styles.counter}>
          <Text style={styles.counterText}>
            {index + 1} / {filenames.length}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  pressArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  counter: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  counterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
