// Build - assemble a prompt from tap-to-choose lists and hand it to Generate.
import React, { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ATMOSPHERES,
  LIGHTING,
  MODES,
  MOODS,
  SETTING_SUGGESTIONS,
  STYLES,
  SUBJECTS,
} from '../data/promptOptions';
import { composePrompt, randomCombo } from '../services/promptComposer';
import { colors, radii, spacing } from '../theme';

// The seven rows, in the order they read best as a sentence. The setting row has
// no fixed list - it opens a text input with the suggestions as chips.
const ROWS = [
  { key: 'mode', label: 'Mode', options: MODES },
  { key: 'subject', label: 'Subject', options: SUBJECTS },
  { key: 'setting', label: 'Setting', options: null },
  { key: 'style', label: 'Style', options: STYLES },
  { key: 'lighting', label: 'Lighting', options: LIGHTING },
  { key: 'mood', label: 'Mood', options: MOODS },
  { key: 'atmosphere', label: 'Atmosphere', options: ATMOSPHERES },
];

const EMPTY_SELECTION = {
  mode: '',
  subject: '',
  setting: '',
  style: '',
  lighting: '',
  mood: '',
  atmosphere: '',
};

export default function PromptBuilderScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [sheetKey, setSheetKey] = useState(null);
  const [settingOpen, setSettingOpen] = useState(false);

  const preview = composePrompt(selection);
  const activeSheet = ROWS.find((row) => row.key === sheetKey) || null;

  const setValue = (key, value) => setSelection((current) => ({ ...current, [key]: value }));

  const clearOne = (key) => {
    setValue(key, '');
    setSheetKey(null);
    if (key === 'setting') {
      setSettingOpen(false);
    }
  };

  const randomise = () => setSelection(randomCombo());

  const clearAll = () => {
    setSelection(EMPTY_SELECTION);
    setSettingOpen(false);
    setSheetKey(null);
  };

  const usePrompt = () => {
    if (!preview) {
      return;
    }
    // The nonce makes sending the same prompt twice still update Generate.
    navigation.navigate('Generate', {
      builtPrompt: preview,
      builtPromptNonce: Date.now(),
    });
  };

  const openRow = (row) => {
    if (row.options) {
      setSettingOpen(false);
      setSheetKey(row.key);
    } else {
      setSettingOpen((open) => !open);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Tap a row to choose. Anything left unset is simply left out of the prompt.
        </Text>

        {ROWS.map((row) => {
          const value = selection[row.key];
          const isOpen = row.key === 'setting' && settingOpen;
          return (
            <View key={row.key}>
              <Pressable
                style={[styles.row, isOpen && styles.rowOpen]}
                onPress={() => openRow(row)}
              >
                <Text style={styles.rowLabel}>{row.label}</Text>
                <View style={styles.rowValueWrap}>
                  <Text
                    style={[styles.rowValue, !value && styles.rowValueEmpty]}
                    numberOfLines={1}
                  >
                    {value || (row.options ? 'Any' : 'None')}
                  </Text>
                  <Text style={styles.rowChevron}>{isOpen ? '▾' : '▸'}</Text>
                </View>
              </Pressable>

              {isOpen && (
                <View style={styles.settingEditor}>
                  <TextInput
                    style={styles.settingInput}
                    value={value}
                    onChangeText={(text) => setValue('setting', text)}
                    placeholder="e.g. lily pond at dawn"
                    placeholderTextColor={colors.muted}
                    maxLength={80}
                    autoFocus
                  />
                  <View style={styles.suggestionChips}>
                    {SETTING_SUGGESTIONS.map((suggestion) => (
                      <Pressable
                        key={suggestion}
                        style={[
                          styles.suggestionChip,
                          value === suggestion && styles.suggestionChipActive,
                        ]}
                        onPress={() => setValue('setting', suggestion)}
                      >
                        <Text
                          style={[
                            styles.suggestionText,
                            value === suggestion && styles.suggestionTextActive,
                          ]}
                        >
                          {suggestion}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        <Text style={styles.sectionLabel}>Preview</Text>
        <View style={styles.previewCard}>
          <Text style={preview ? styles.previewText : styles.previewPlaceholder}>
            {preview || 'Pick a few options and your prompt appears here.'}
          </Text>
        </View>

        <Pressable
          style={[styles.primaryButton, !preview && styles.primaryButtonDisabled]}
          onPress={usePrompt}
          disabled={!preview}
        >
          <Text style={styles.primaryButtonText}>Use this prompt</Text>
        </Pressable>

        <View style={styles.buttonRow}>
          <Pressable style={styles.secondaryButton} onPress={randomise}>
            <Text style={styles.secondaryButtonText}>🎲 Randomise</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={clearAll}>
            <Text style={styles.secondaryButtonText}>Clear all</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={activeSheet !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetKey(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheetKey(null)}>
          {/* Stop taps inside the sheet from closing it. */}
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            {activeSheet && (
              <>
                <Text style={styles.sheetTitle}>{activeSheet.label}</Text>
                <FlatList
                  data={activeSheet.options}
                  keyExtractor={(item) => item}
                  keyboardShouldPersistTaps="handled"
                  ListHeaderComponent={
                    <Pressable
                      style={styles.clearEntry}
                      onPress={() => clearOne(activeSheet.key)}
                    >
                      <Text style={styles.clearEntryText}>Clear this choice</Text>
                    </Pressable>
                  }
                  renderItem={({ item }) => {
                    const selected = selection[activeSheet.key] === item;
                    return (
                      <Pressable
                        style={[styles.optionRow, selected && styles.optionRowActive]}
                        onPress={() => {
                          setValue(activeSheet.key, item);
                          setSheetKey(null);
                        }}
                      >
                        <Text style={[styles.optionText, selected && styles.optionTextActive]}>
                          {item}
                        </Text>
                        {selected && <Text style={styles.optionCheck}>✓</Text>}
                      </Pressable>
                    );
                  }}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
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
  intro: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginBottom: spacing.sm,
  },
  rowOpen: {
    borderColor: colors.accent,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  rowValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: spacing.md,
  },
  rowValue: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  rowValueEmpty: {
    color: colors.muted,
    fontWeight: '500',
  },
  rowChevron: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  settingEditor: {
    marginBottom: spacing.sm,
  },
  settingInput: {
    backgroundColor: colors.card,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontSize: 15,
    padding: spacing.md,
  },
  suggestionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  suggestionChip: {
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  suggestionChipActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  suggestionText: {
    color: '#EAF7F1',
    fontSize: 13,
    fontWeight: '600',
  },
  suggestionTextActive: {
    color: colors.bg,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  previewCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  previewText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  previewPlaceholder: {
    color: colors.muted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // Deliberately lighter than colors.card and outlined, with light labels:
  // the fill stays visible against the screen background.
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.control,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#EAF7F1',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderColor: colors.border,
    borderWidth: 1,
    maxHeight: '65%',
    paddingTop: spacing.md,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  clearEntry: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  clearEntryText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  optionRowActive: {
    backgroundColor: colors.cardAlt,
  },
  optionText: {
    color: colors.text,
    fontSize: 15,
  },
  optionTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
  optionCheck: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '800',
  },
});
