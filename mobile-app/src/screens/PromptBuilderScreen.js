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
import { composeSelection, randomCombo } from '../services/promptComposer';
import {
  recipeIsUsable,
  renderRecipe,
  recipeSlots,
  rollRecipe,
  selectedRecipe,
  slotLabel,
} from '../services/recipeComposer';
import RECIPES from '../data/recipes.json';
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
  // Which picker sheet is open: { kind: 'row' | 'slot', key } or null.
  const [sheet, setSheet] = useState(null);
  const [settingOpen, setSettingOpen] = useState(false);
  // Recipe mode. null means the normal seven rows; picking a recipe swaps the
  // rows and the preview for that recipe's slots and template. The normal
  // selection is left untouched, so leaving recipe mode restores it instead of
  // mixing the two vocabularies.
  const [recipeIndex, setRecipeIndex] = useState(null);
  const [recipeValues, setRecipeValues] = useState({});
  const [recipeListOpen, setRecipeListOpen] = useState(false);

  const recipe = selectedRecipe(RECIPES, recipeIndex);
  const composed = composeSelection(selection);
  // The preview comes from exactly one mode, never a blend of both. A recipe
  // carries no negative list, so it hands Generate no Avoid text.
  const preview = recipe ? renderRecipe(recipe, recipeValues) : composed.prompt;
  const negative = recipe ? '' : composed.negative;
  const unsetSlots = recipe
    ? recipeSlots(recipe).filter((slot) => !String(recipeValues[slot] || '').trim())
    : [];

  const setValue = (key, value) => setSelection((current) => ({ ...current, [key]: value }));
  const setRecipeValue = (key, value) =>
    setRecipeValues((current) => ({ ...current, [key]: value }));

  const clearValue = (key) => {
    setValue(key, '');
    setSheet(null);
    if (key === 'setting') {
      setSettingOpen(false);
    }
  };

  const clearRecipeValue = (key) => {
    setRecipeValue(key, '');
    setSheet(null);
  };

  // The one sheet serves the normal rows and the recipe slots alike, so it is
  // described from the open key rather than bound to a row when it opens.
  const activeSheet = (() => {
    if (!sheet) {
      return null;
    }
    if (sheet.kind === 'row') {
      const row = ROWS.find((item) => item.key === sheet.key);
      if (!row || !row.options) {
        return null;
      }
      return {
        title: row.label,
        options: row.options,
        value: selection[row.key],
        pick: (value) => setValue(row.key, value),
        clear: () => clearValue(row.key),
      };
    }
    const options = recipe && recipe.variables ? recipe.variables[sheet.key] : null;
    if (!Array.isArray(options)) {
      return null;
    }
    return {
      title: slotLabel(sheet.key),
      options,
      value: recipeValues[sheet.key] || '',
      pick: (value) => setRecipeValue(sheet.key, value),
      clear: () => clearRecipeValue(sheet.key),
    };
  })();

  const randomise = () => setSelection(randomCombo());
  const rollAll = () => setRecipeValues(rollRecipe(recipe));

  const clearAll = () => {
    setSelection(EMPTY_SELECTION);
    setRecipeValues({});
    setSettingOpen(false);
    setSheet(null);
  };

  const chooseRecipe = (index) => {
    setRecipeIndex(index);
    setRecipeValues({});
    setSettingOpen(false);
    setSheet(null);
    setRecipeListOpen(false);
  };

  const useNormalBuilder = () => {
    setRecipeIndex(null);
    setRecipeValues({});
    setSettingOpen(false);
    setSheet(null);
    setRecipeListOpen(false);
  };

  const usePrompt = () => {
    if (!preview) {
      return;
    }
    // The nonce makes sending the same prompt twice still update Generate.
    // The Avoid list travels with its own payload and nonce, so a prompt-only
    // handoff (or a repeated one) can never carry a stale negative across.
    navigation.navigate('Generate', {
      builtPrompt: preview,
      builtPromptNonce: Date.now(),
      builtNegative: negative,
      builtNegativeNonce: Date.now(),
    });
  };

  const openRow = (row) => {
    if (row.options) {
      setSettingOpen(false);
      setSheet({ kind: 'row', key: row.key });
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
          {recipe
            ? 'Pick a value for each slot, or roll them all. Anything you leave unset simply drops out of the sentence.'
            : 'Tap a row to choose. Anything left unset is simply left out of the prompt.'}
        </Text>

        {/* The recipes come from the desktop app's saved recipe file. Tapping
            this row lists them; picking one swaps the seven rows below for that
            recipe's slots. */}
        <Pressable
          style={[styles.row, recipe && styles.rowActive]}
          onPress={() => setRecipeListOpen(true)}
        >
          <Text style={styles.rowLabel}>Recipes</Text>
          <View style={styles.rowValueWrap}>
            <Text style={[styles.rowValue, !recipe && styles.rowValueEmpty]} numberOfLines={1}>
              {recipe ? recipe.name : 'Browse'}
            </Text>
            <Text style={styles.rowChevron}>▸</Text>
          </View>
        </Pressable>

        {recipe ? (
          <>
            {recipe.description ? (
              <Text style={styles.recipeDescription}>{recipe.description}</Text>
            ) : null}
            {recipeSlots(recipe).map((slot) => {
              const value = recipeValues[slot] || '';
              return (
                <Pressable
                  key={slot}
                  style={styles.row}
                  onPress={() => setSheet({ kind: 'slot', key: slot })}
                >
                  <Text style={styles.rowLabel}>{slotLabel(slot)}</Text>
                  <View style={styles.rowValueWrap}>
                    <Text
                      style={[styles.rowValue, !value && styles.rowValueEmpty]}
                      numberOfLines={1}
                    >
                      {value || 'Any'}
                    </Text>
                    <Text style={styles.rowChevron}>▸</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        ) : (
          ROWS.map((row) => {
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
        })
        )}

        <Text style={styles.sectionLabel}>Preview</Text>
        <View style={styles.previewCard}>
          <Text style={preview ? styles.previewText : styles.previewPlaceholder}>
            {preview ||
              (recipe
                ? 'Pick or roll the slots and your prompt appears here.'
                : 'Pick a few options and your prompt appears here.')}
          </Text>
          {/* A mode brings its own negative list to Generate's Avoid field, so
              say so here - that field lives behind "More options" over there. */}
          {negative !== '' && (
            <Text style={styles.previewModeHint}>
              {selection.mode} also fills the Avoid list with its own negatives.
            </Text>
          )}
          {recipe && (
            <Text style={styles.previewModeHint}>
              {unsetSlots.length === 0
                ? 'Every slot is set.'
                : `${unsetSlots.length} slot${unsetSlots.length === 1 ? '' : 's'} not set - those clauses are left out.`}
            </Text>
          )}
        </View>

        <Pressable
          style={[styles.primaryButton, !preview && styles.primaryButtonDisabled]}
          onPress={usePrompt}
          disabled={!preview}
        >
          <Text style={styles.primaryButtonText}>Use this prompt</Text>
        </Pressable>

        <View style={styles.buttonRow}>
          <Pressable
            style={styles.secondaryButton}
            onPress={recipe ? rollAll : randomise}
            disabled={recipe ? !recipeIsUsable(recipe) : false}
          >
            <Text style={styles.secondaryButtonText}>
              {recipe ? '🎲 Roll all' : '🎲 Randomise'}
            </Text>
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
        onRequestClose={() => setSheet(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)}>
          {/* Stop taps inside the sheet from closing it. */}
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            {activeSheet && (
              <>
                <Text style={styles.sheetTitle}>{activeSheet.title}</Text>
                <FlatList
                  data={activeSheet.options}
                  keyExtractor={(item) => item}
                  keyboardShouldPersistTaps="handled"
                  ListHeaderComponent={
                    <Pressable
                      style={styles.clearEntry}
                      onPress={() => activeSheet.clear()}
                    >
                      <Text style={styles.clearEntryText}>Clear this choice</Text>
                    </Pressable>
                  }
                  renderItem={({ item }) => {
                    const selected = activeSheet.value === item;
                    return (
                      <Pressable
                        style={[styles.optionRow, selected && styles.optionRowActive]}
                        onPress={() => {
                          activeSheet.pick(item);
                          setSheet(null);
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

      <Modal
        visible={recipeListOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setRecipeListOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setRecipeListOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Recipes</Text>
            <FlatList
              data={RECIPES}
              keyExtractor={(item, index) => `${item.name || 'recipe'}-${index}`}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                recipe ? (
                  <Pressable style={styles.clearEntry} onPress={useNormalBuilder}>
                    <Text style={styles.clearEntryText}>Use the normal builder instead</Text>
                  </Pressable>
                ) : null
              }
              ListEmptyComponent={<Text style={styles.recipeEmpty}>No saved recipes yet.</Text>}
              renderItem={({ item, index }) => {
                const selected = recipeIndex === index;
                return (
                  <Pressable
                    style={[styles.optionRow, selected && styles.optionRowActive]}
                    onPress={() => chooseRecipe(index)}
                  >
                    <View style={styles.recipeRowText}>
                      <Text style={[styles.optionText, selected && styles.optionTextActive]}>
                        {item.name}
                      </Text>
                      {item.description ? (
                        <Text style={styles.recipeRowDescription}>{item.description}</Text>
                      ) : null}
                    </View>
                    {selected && <Text style={styles.optionCheck}>✓</Text>}
                  </Pressable>
                );
              }}
            />
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
  // A recipe being active (not the row's open state) gets the same accent ring,
  // so the Recipes row reads as "in use" at a glance.
  rowActive: {
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
  previewModeHint: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  recipeDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  recipeRowText: {
    flexShrink: 1,
    marginRight: spacing.md,
  },
  recipeRowDescription: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  recipeEmpty: {
    color: colors.muted,
    fontSize: 14,
    fontStyle: 'italic',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
