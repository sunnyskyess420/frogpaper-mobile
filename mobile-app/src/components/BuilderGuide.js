// The Build screen's guide, opened from Settings -> Help.
//
// Plain language on purpose: it explains what each row wants, what the buttons
// do, and the four habits that make a prompt work - with one worked example
// (the "Christmas" prompt that produced a dark forest) so the mistake and its
// fix sit side by side. The same text lives in docs/PROMPT_BUILDER_TUTORIAL.md;
// keep the two in step when either changes.
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, themedStyles, useTheme } from '../theme';

const ROWS = [
  [
    'Recipe',
    'A fill-in-the-blank template. Pick one and the rows below are replaced by that recipe\u2019s own slots. Ignore it to build by hand.',
  ],
  [
    'Mode',
    'The overall finish (Cinematic, Anime, Pixel Art\u2026). A mode adds its own wording and its own Avoid list. Leave it on Any when you want your rows to do the work \u2014 and avoid Cinematic for something bright, because it adds "dramatic lighting, rich shadow".',
  ],
  [
    'Subject',
    'The one thing in the picture. A thing, not a feeling: snowman, tree frog, gingerbread house. One subject is enough; two compete.',
  ],
  [
    'Setting',
    'Where it is. A place: "snowy village at night", "cosy cabin with a fireplace". Not a format \u2014 "movie poster" or "4K wallpaper" describe the output, and the model will draw the words instead of a scene.',
  ],
  [
    'Style',
    'How it is drawn: watercolor storybook, claymation, pixel art 16-bit. Pick one; two pull against each other.',
  ],
  ['Lighting', 'The time of day or the light source: candlelight, golden hour, moonlight.'],
  ['Colour', 'The palette: golden mist, ember orange, pastel dream.'],
  ['Mood', 'The feeling: cozy, playful, hopeful, mysterious.'],
  ['Atmosphere', 'What is in the air: snow, fog, embers, rain.'],
];

const RULES = [
  'Say what you want to see, not what it is for. "Christmas" is a feeling; "a snowman in a snowy village" is a picture.',
  'One subject, one place. Fill those two before anything else.',
  'Two or three rows beat eight \u2014 extra rows dilute the subject.',
  'Warm light beats sparkle: candlelight + cozy + snow makes a Christmas card; "movie poster" + Cinematic makes a dark forest.',
];

export default function BuilderGuide({ visible, onClose }) {
  // Colours live in the themed styles below; this re-renders on a switch.
  useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} onRequestClose={onClose} transparent={false} animationType="slide">
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.title}>How to build a prompt</Text>
          <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={true}
        >
          <Text style={styles.body}>
            The Build screen turns a few taps into one sentence. Nothing is required: leave a row
            alone and it simply drops out. The preview under the rows always shows exactly what
            will be sent.
          </Text>

          <Text style={styles.sectionTitle}>The rows, top to bottom</Text>
          {ROWS.map(([name, text]) => (
            <View key={name} style={styles.entry}>
              <Text style={styles.entryName}>{name}</Text>
              <Text style={styles.entryText}>{text}</Text>
            </View>
          ))}

          <Text style={styles.sectionTitle}>The buttons</Text>
          <Text style={styles.body}>
            <Text style={styles.strong}>Use this prompt</Text> hands the sentence (and the mode's
            Avoid list) to Generate. <Text style={styles.strong}>Randomise</Text> fills every row at
            once. <Text style={styles.strong}>Clear all</Text> can be undone for a few seconds.
          </Text>
          <Text style={styles.body}>
            In any picker, the field at the top lets you type your own value; long lists also have a
            filter, and the last few picks come back as Recent chips.
          </Text>

          <Text style={styles.sectionTitle}>Four rules that do most of the work</Text>
          {RULES.map((rule, index) => (
            <View key={rule} style={styles.rule}>
              <Text style={styles.ruleNumber}>{index + 1}</Text>
              <Text style={styles.ruleText}>{rule}</Text>
            </View>
          ))}

          <Text style={styles.sectionTitle}>A worked example</Text>
          <Text style={styles.body}>
            Subject "Christmas", Setting "Christmas movie poster", Mode Cinematic. The app glued it
            into "A Christmas in a christmas movie poster, movie-poster depth of field, dramatic
            lighting ratio…" — an adjective in a format, shot dark. The result was a lone
            tree in green fog.
          </Text>
          <View style={styles.fixCard}>
            <Text style={styles.fixTitle}>Try instead</Text>
            <Text style={styles.fixText}>
              Mode Any · Subject "snowman" (type it in) · Setting "snowy village at night"
              · Style claymation · Lighting candlelight · Colour golden mist ·
              Mood cozy · Atmosphere snow
            </Text>
            <Text style={styles.fixResult}>
              "A snowman in a snowy village at night, claymation style, candlelight lighting, golden
              mist tones, cozy mood, snow"
            </Text>
          </View>
          <Text style={styles.body}>
            Swap the subject for "frog in a Santa hat" and keep the rest — that is the whole
            trick.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.card,
  },
  title: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  closeButton: {
    borderRadius: radii.pill,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    backgroundColor: colors.control,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  closeButtonText: {
    color: colors.onControl,
    fontSize: 13,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  strong: {
    fontWeight: '800',
  },
  entry: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  entryName: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  entryText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  rule: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  ruleNumber: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '800',
    width: 16,
  },
  ruleText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  fixCard: {
    backgroundColor: colors.noticeBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fixTitle: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  fixText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  fixResult: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
}));
