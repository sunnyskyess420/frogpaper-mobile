// Gallery image that keeps working offline.
//
// Drop-in replacement for the <Image> usages that show a server-side image:
// pass `filename` instead of `source`. It tries the server URL first (a remote
// copy is always fresher than the device copy), and on load error falls back to
// the file imageCache keeps on this phone. When neither exists it renders a
// neutral placeholder instead of a broken-image icon.
//
// DetailScreen hands the zoom viewer animated transform styles; this renders
// Animated.Image internally so those still animate untouched.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import api from '../services/api';
import { ensureCached, getCachedUri } from '../services/imageCache';
import { colors, radii } from '../theme';

// Which source the image is showing right now. Kept in a ref (not state) so an
// error callback always sees the current stage without re-subscribing.
const STAGE_REMOTE = 'remote';
const STAGE_LOCAL = 'local';
const STAGE_FETCHING = 'fetching';
const STAGE_DEAD = 'dead';

export default function WallpaperImage({
  filename,
  preferCache = false,
  localUri = null,
  style,
  resizeMode = 'cover',
  ...imageProps
}) {
  const remoteUri = filename ? api.imageUrl(filename) : null;
  const [uri, setUri] = useState(null);
  const [dead, setDead] = useState(false);
  const stageRef = useRef(STAGE_REMOTE);

  useEffect(() => {
    stageRef.current = STAGE_REMOTE;
    setDead(false);
    // A phone-gallery image is already a local file: show it straight away and
    // never bother the server (there is no server copy to prefer).
    if (localUri) {
      stageRef.current = STAGE_LOCAL;
      setUri(localUri);
      return;
    }
    if (!filename) {
      setUri(null);
      setDead(true);
      return;
    }
    // The offline gallery already knows the network is down - skip the
    // guaranteed-to-fail remote attempt and show the saved copy straight away.
    if (preferCache) {
      const local = getCachedUri(filename);
      if (local) {
        stageRef.current = STAGE_LOCAL;
        setUri(local);
        return;
      }
    }
    setUri(remoteUri);
  }, [filename, preferCache, remoteUri, localUri]);

  const handleError = useCallback(async () => {
    if (stageRef.current === STAGE_DEAD || stageRef.current === STAGE_FETCHING) {
      return;
    }
    if (stageRef.current === STAGE_REMOTE) {
      if (!filename) {
        stageRef.current = STAGE_DEAD;
        setDead(true);
        return;
      }
      const local = getCachedUri(filename);
      if (local) {
        stageRef.current = STAGE_LOCAL;
        setUri(local);
        return;
      }
      // Nothing on disk yet: try one download (e.g. a wallpaper that was made
      // while the gallery list was cached but never opened).
      stageRef.current = STAGE_FETCHING;
      const fetched = await ensureCached(filename);
      if (fetched) {
        stageRef.current = STAGE_LOCAL;
        setUri(fetched);
        return;
      }
      stageRef.current = STAGE_DEAD;
      setDead(true);
      return;
    }
    // The local copy is unreadable too - nothing left to try.
    stageRef.current = STAGE_DEAD;
    setDead(true);
  }, [filename]);

  if (!uri || dead) {
    return (
      <Animated.View style={[styles.placeholder, style]} {...imageProps}>
        <Text style={styles.placeholderText} numberOfLines={3}>
          Not saved on this phone
        </Text>
      </Animated.View>
    );
  }

  return (
    <Animated.Image
      {...imageProps}
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={handleError}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardAlt,
    borderRadius: radii.sm,
    padding: 4,
  },
  placeholderText: {
    color: colors.muted,
    fontSize: 10,
    textAlign: 'center',
  },
});
