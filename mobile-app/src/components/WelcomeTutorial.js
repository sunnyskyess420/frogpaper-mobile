/**
 * The first-launch walkthrough.
 *
 * Four short cards, in the simplest words that are still true. It exists because
 * a new install has nothing to configure - no key to paste, no server to find,
 * no account - and someone handed the app cold would not know that. The only
 * genuinely surprising things are that a picture can take a minute to appear and
 * that the app is happy with a two-word prompt.
 *
 * Skippable at any point, and offered again from Settings > About & diagnostics.
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme';

const STEPS = [
  {
    title: 'Welcome to FrogPaper',
    lines: [
      'Make wallpapers out of words.',
      'Nothing to set up, no account, and nothing is uploaded anywhere.',
    ],
  },
  {
    title: 'Type it, or roll it',
    lines: [
      'Describe what you want and tap Generate. Two words is plenty.',
      'Stuck for ideas? Tap the dice for a Surprise me, or open Build and pick from lists.',
    ],
  },
  {
    title: 'Your first one may take a minute',
    lines: [
      'The free server naps when nobody is using it and wakes when you ask.',
      'If it times out, tap Retry. It costs nothing to try again.',
    ],
  },
  {
    title: 'Keep the ones you like',
    lines: [
      'Save to your phone, or set it as your wallpaper straight away.',
      'In Settings you can let FrogPaper change it once a day on its own.',
    ],
  },
];

export default function WelcomeTutorial({ visible, onDone }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  const finish = () => {
    setStep(0);
    onDone();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{current.title}</Text>
          {current.lines.map((line, index) => (
            <Text key={`line-${index}`} style={styles.line}>
              {line}
            </Text>
          ))}

          <View style={styles.dots}>
            {STEPS.map((item, index) => (
              <View key={item.title} style={[styles.dot, index === step && styles.dotOn]} />
            ))}
          </View>

          <View style={styles.buttonRow}>
            {step > 0 ? (
              <Pressable style={styles.secondary} onPress={() => setStep(step - 1)}>
                <Text style={styles.secondaryText}>Back</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.secondary} onPress={finish}>
                <Text style={styles.secondaryText}>Skip</Text>
              </Pressable>
            )}
            <Pressable style={styles.primary} onPress={last ? finish : () => setStep(step + 1)}>
              <Text style={styles.primaryText}>{last ? 'Start making' : 'Next'}</Text>
            </Pressable>
          </View>

          <Text style={styles.footnote}>
            Step {step + 1} of {STEPS.length} · You can see this again in Settings
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 8, 16, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.md,
  },
  line: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotOn: {
    backgroundColor: colors.accent,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primary: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
  secondary: {
    flex: 1,
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  footnote: {
    color: colors.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
