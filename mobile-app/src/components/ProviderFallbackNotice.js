// "The engine you asked for was unavailable, so the free Pollinations engine
// answered" - shown on the Generate result card and again on the full-screen
// Detail view the result opens into. The wording lives here once so the copy
// the owner would have seen on the card cannot drift from the Detail copy.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme';

// The backend reports the original provider as an id (e.g. "huggingface").
const PROVIDER_LABELS = {
  replicate: 'Replicate',
  gemini: 'Gemini',
  huggingface: 'Hugging Face',
};

export function providerFallbackText(providerId) {
  const label = PROVIDER_LABELS[providerId] || providerId;
  return `${label} was unavailable — used the free Pollinations engine.`;
}

export default function ProviderFallbackNotice({ providerId, style }) {
  if (!providerId) {
    return null;
  }
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.text}>{providerFallbackText(providerId)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  text: {
    color: colors.warn,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
});
