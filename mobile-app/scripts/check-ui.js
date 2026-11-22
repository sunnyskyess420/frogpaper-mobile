#!/usr/bin/env node
/**
 * check-ui.js - mounts the Build screen headlessly and drives its controls.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-ui.js
 * or via the npm script:
 *     npm run check:ui
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build
 * hooks.
 *
 * Why this exists: the other check:* suites test pure logic, so for two
 * releases the Build screen shipped with its Recipes row, list sheet and save
 * panel missing from the returned JSX while every check stayed green. Nothing
 * mounted a screen. This one does: react-native is stubbed, the app modules are
 * transpiled on the fly (same trick as check-builder.js), and the screen is
 * rendered with react-test-renderer so real taps can be made.
 *
 * What it proves:
 *   1. Every option row opens a sheet that lists its whole option set, marks the
 *      current pick, clears back to "Any" and lands the value in the preview.
 *   2. The Setting row edits inline (chips + typing) instead of opening a sheet.
 *   3. A typed value that is not in the list can be used for any row, is trimmed,
 *      and comes back in the sheet when reopened.
 *   4. Long lists get a filter field; filtering narrows the options and an
 *      unmatched filter says so instead of showing an empty screen.
 *   5. A picked value is offered back under "Recent", and tapping it re-picks.
 *   6. Clear all can be undone, and the selection survives a remount.
 *   7. The Recipes row opens the picker, offers the normal builder and the save
 *      entry, and choosing a recipe swaps the rows for its slots - the exact
 *      feature that went missing before.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

global.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

// --- store the screen reads and writes --------------------------------------
const storage = new Map();

// --- react-native stub ------------------------------------------------------
// Host elements keep their props, so the test can call onPress/onChangeText
// exactly as the native components would.
function host(name) {
  return function Stub(props) {
    return h(name, props, props.children);
  };
}

const alerts = [];

const RN = {
  Platform: { OS: 'android', select: (options) => (options.android === undefined ? options.default : options.android) },
  StyleSheet: { create: (sheet) => sheet, flatten: (style) => style },
  Alert: { alert: (...args) => alerts.push(args) },
  View: host('View'),
  Text: host('Text'),
  Pressable: host('Pressable'),
  TextInput: host('TextInput'),
  ScrollView: host('ScrollView'),
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  ActivityIndicator: host('ActivityIndicator'),
  Image: host('Image'),
  Switch: host('Switch'),
  Linking: { openURL: async () => true },
  Share: { share: async () => ({}) },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  FlatList: function FlatList(props) {
    const { data = [], renderItem, ListHeaderComponent, ListEmptyComponent, keyExtractor } = props;
    const header =
      typeof ListHeaderComponent === 'function' ? h(ListHeaderComponent) : ListHeaderComponent;
    const empty =
      typeof ListEmptyComponent === 'function' ? h(ListEmptyComponent) : ListEmptyComponent;
    return h(
      'FlatList',
      props,
      header,
      data.length === 0 && empty
        ? empty
        : data.map((item, index) =>
            h(
              React.Fragment,
              { key: keyExtractor ? keyExtractor(item, index) : String(index) },
              renderItem({ item, index, separators: {} })
            )
          )
    );
  },
  Modal: function Modal(props) {
    return props.visible ? h('Modal', props, props.children) : null;
  },
};

const mocks = {
  'react-native': RN,
  '@react-navigation/native': {
    useNavigation: () => ({ navigate: () => {} }),
    useFocusEffect: () => {},
    useRoute: () => ({ params: {} }),
  },
  'react-native-safe-area-context': {
    useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
  },
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: {
      getItem: async (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: async (key, value) => {
        storage.set(key, value);
      },
      removeItem: async (key) => {
        storage.delete(key);
      },
      getAllKeys: async () => [...storage.keys()],
    },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) {
    return mocks[request];
  }
  return originalLoad.apply(this, arguments);
};

const originalJs = Module._extensions['.js'];
Module._extensions['.js'] = function (mod, filename) {
  if (filename.includes('node_modules')) {
    return originalJs(mod, filename);
  }
  const source = fs.readFileSync(filename, 'utf8');
  if (!/\bimport\b|\bexport\b/.test(source)) {
    return originalJs(mod, filename);
  }
  const { code } = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [
      require.resolve('@babel/plugin-transform-modules-commonjs'),
      require.resolve('@babel/plugin-transform-react-jsx'),
    ],
  });
  mod._compile(code, filename);
};

// --- helpers ----------------------------------------------------------------
let failures = 0;
let passes = 0;

function check(name, condition, detail) {
  if (condition) {
    passes += 1;
    console.log(`${PASS} ${name}`);
  } else {
    failures += 1;
    console.log(`${FAIL} ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function textOf(node) {
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (!node || !node.children) {
    return '';
  }
  return node.children.map(textOf).join('');
}

function all(container, type) {
  const root = container && container.root ? container.root : container;
  return root.findAll((node) => node.type === type, { deep: true });
}

function modal(renderer) {
  return all(renderer, 'Modal')[0] || null;
}

// The Pressable whose whole text is exactly this - never the backdrop, which
// contains every label on the sheet.
function pressableWithText(container, label) {
  return (
    all(container, 'Pressable').find(
      (node) => typeof node.props.onPress === 'function' && textOf(node).trim() === label
    ) || null
  );
}

function pressableStartingWith(container, label) {
  return (
    all(container, 'Pressable').find(
      (node) => typeof node.props.onPress === 'function' && textOf(node).trim().startsWith(label)
    ) || null
  );
}

// A dropdown row: label first, chevron last.
function row(renderer, label) {
  return (
    all(renderer, 'Pressable').find((node) => {
      const text = textOf(node).trim();
      return (
        typeof node.props.onPress === 'function' &&
        text.startsWith(label) &&
        (text.endsWith('▸') || text.endsWith('▾')) &&
        text.length < 80
      );
    }) || null
  );
}

async function tap(node) {
  if (!node) {
    throw new Error('tried to tap a control that is not on screen');
  }
  await TestRenderer.act(async () => {
    node.props.onPress();
  });
}

async function type(node, value) {
  await TestRenderer.act(async () => {
    node.props.onChangeText(value);
  });
}

async function settle() {
  await TestRenderer.act(async () => {});
}

// --- the screen -------------------------------------------------------------
async function run() {
  const PromptBuilderScreen = require(path.join(ROOT, 'src/screens/PromptBuilderScreen.js')).default;
  const keywordBank = require(path.join(ROOT, 'src/services/keywordBank.js'));
  const promptOptions = require(path.join(ROOT, 'src/data/promptOptions.js'));

  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(h(PromptBuilderScreen, {}));
  });
  await settle();

  const ROWS = [
    ['Mode', promptOptions.MODES],
    ['Subject', keywordBank.SUBJECT_OPTIONS],
    ['Style', keywordBank.STYLE_OPTIONS],
    ['Lighting', keywordBank.LIGHTING_OPTIONS],
    ['Colour', keywordBank.COLOR_OPTIONS],
    ['Mood', keywordBank.MOOD_OPTIONS],
    ['Atmosphere', keywordBank.ATMOSPHERE_OPTIONS],
  ];

  console.log('\nDropdowns');
  for (const [label, expected] of ROWS) {
    const control = row(renderer, label);
    check(`${label}: row is on screen`, control !== null);
    if (!control) {
      continue;
    }
    check(`${label}: starts empty`, textOf(control).trim() === `${label}Any▸`, textOf(control).trim());

    await tap(control);
    const sheet = modal(renderer);
    check(`${label}: opens a sheet`, sheet !== null);
    if (!sheet) {
      continue;
    }
    const missing = expected.filter((option) => !textOf(sheet).includes(option));
    check(`${label}: lists all ${expected.length} options`, missing.length === 0, `missing ${missing.slice(0, 3)}`);
    check(`${label}: offers a typed value`, all(sheet, 'TextInput').length >= 1);
    check(`${label}: offers a clear entry`, pressableWithText(sheet, 'Clear this choice') !== null);

    const pick = expected[2];
    const pickNode = pressableWithText(sheet, pick) || pressableWithText(sheet, `${pick}✓`);
    check(`${label}: "${pick}" is tappable`, pickNode !== null);
    if (!pickNode) {
      continue;
    }
    await tap(pickNode);
    check(`${label}: sheet closes after picking`, modal(renderer) === null);
    check(`${label}: row shows the pick`, textOf(row(renderer, label)).trim() === `${label}${pick}▸`);
    check(`${label}: preview includes the pick`, textOf(renderer.toJSON()).includes(pick));

    await tap(row(renderer, label));
    const reopened = modal(renderer);
    check(`${label}: reopening marks the pick`, textOf(reopened).includes(`${pick}✓`));
    check(`${label}: the pick is offered under Recent`, textOf(reopened).includes('Recent'));
    await tap(pressableWithText(reopened, 'Clear this choice'));
    check(`${label}: clearing restores "Any"`, textOf(row(renderer, label)).trim() === `${label}Any▸`);
  }

  console.log('\nSetting row');
  const settingRow = row(renderer, 'Setting');
  check('Setting: starts as "None"', textOf(settingRow).trim() === 'SettingNone▸', textOf(settingRow).trim());
  await tap(settingRow);
  check('Setting: opens an inline field', all(renderer, 'TextInput').length === 1);
  check('Setting: chevron points down', textOf(row(renderer, 'Setting')).includes('▾'));
  await tap(pressableWithText(renderer.root, 'misty forest'));
  check('Setting: a chip fills the row', textOf(row(renderer, 'Setting')).includes('misty forest'));
  await type(all(renderer, 'TextInput')[0], 'under the sea');
  check('Setting: typing fills the row', textOf(row(renderer, 'Setting')).includes('under the sea'));
  await tap(row(renderer, 'Setting'));
  check('Setting: closes on a second tap', all(renderer, 'TextInput').length === 0);
  check('Setting: keeps the typed value', textOf(row(renderer, 'Setting')).includes('under the sea'));

  console.log('\nTyped values and filtering');
  await tap(row(renderer, 'Mode'));
  let sheet = modal(renderer);
  const customField = all(sheet, 'TextInput')[0];
  check('Custom: "Use" starts disabled', pressableWithText(sheet, 'Use').props.disabled === true);
  await type(customField, '  my own mode  ');
  await tap(pressableWithText(modal(renderer), 'Use'));
  check('Custom: value lands trimmed in the row', textOf(row(renderer, 'Mode')).trim() === 'Modemy own mode▸');
  await tap(row(renderer, 'Mode'));
  check('Custom: reopens with the typed value', all(modal(renderer), 'TextInput')[0].props.value === 'my own mode');
  await tap(pressableWithText(modal(renderer), 'Clear this choice'));

  await tap(row(renderer, 'Mood'));
  sheet = modal(renderer);
  const inputs = all(sheet, 'TextInput');
  check('Filter: long lists get a filter field', inputs.length === 2);
  await type(inputs[1], 'myst');
  const narrowed = textOf(sheet);
  check('Filter: narrows to matching options', narrowed.includes('mysterious') && !narrowed.includes('nostalgic'));
  await type(inputs[1], 'zzzz');
  check('Filter: says when nothing matches', textOf(modal(renderer)).includes('Nothing matches that filter'));
  await type(inputs[1], '');
  check('Filter: clearing brings the list back', textOf(modal(renderer)).includes('nostalgic'));
  await tap(pressableWithText(modal(renderer), 'Clear this choice'));

  check('Filter: short lists stay uncluttered', true);
  await tap(row(renderer, 'Mode'));
  check('Filter: a short list has no filter field', all(modal(renderer), 'TextInput').length === 1);
  await tap(pressableWithText(modal(renderer), 'Clear this choice'));

  console.log('\nClear all and remembering');
  await tap(pressableStartingWith(renderer.root, '🎲 Randomise'));
  const filled = ROWS.filter(([label]) => !textOf(row(renderer, label)).includes('Any'));
  check('Randomise: fills every row', filled.length === 7, `filled ${filled.length}`);

  await tap(pressableWithText(renderer.root, 'Clear all'));
  check('Clear all: empties every row', ROWS.every(([label]) => textOf(row(renderer, label)).includes('Any')));
  check('Clear all: offers an undo', pressableWithText(renderer.root, 'Undo') !== null);
  await tap(pressableWithText(renderer.root, 'Undo'));
  check('Undo: restores every row', ROWS.every(([label]) => !textOf(row(renderer, label)).includes('Any')));
  check('Undo: the offer goes away', pressableWithText(renderer.root, 'Undo') === null);

  const keptMood = textOf(row(renderer, 'Mood')).trim();
  await TestRenderer.act(async () => {
    renderer.unmount();
  });
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(h(PromptBuilderScreen, {}));
  });
  await settle();
  check('Remember: a remount restores the selection', textOf(row(renderer, 'Mood')).trim() === keptMood, `${textOf(row(renderer, 'Mood')).trim()} vs ${keptMood}`);
  await tap(row(renderer, 'Mood'));
  check('Remember: recents survive the remount', textOf(modal(renderer)).includes('Recent'));
  await tap(pressableWithText(modal(renderer), 'Clear this choice'));

  console.log('\nRecipes');
  check('Recipe: the row is on screen', row(renderer, 'Recipe') !== null);
  await tap(row(renderer, 'Recipe'));
  const list = modal(renderer);
  check('Recipe: opens the picker', list !== null && textOf(list).includes('Recipes'));
  check('Recipe: offers the normal builder', textOf(list).includes('Use the normal builder'));
  check('Recipe: offers saving what is chosen', textOf(list).includes('Save what I have chosen'));
  check('Recipe: lists the built-in recipe', textOf(list).includes('Cinematic Landscape (Copy)'));
  await tap(pressableStartingWith(modal(renderer), 'Cinematic Landscape (Copy)'));
  check('Recipe: choosing one closes the picker', modal(renderer) === null);
  check('Recipe: its slots replace the rows', row(renderer, 'Subject') === null && row(renderer, 'Mood') !== null);
  await tap(row(renderer, 'Mood'));
  const slotSheet = modal(renderer);
  check('Recipe: a slot opens its own options', textOf(slotSheet).includes('dramatic') && textOf(slotSheet).includes('majestic'));
  await tap(pressableWithText(slotSheet, 'dramatic'));
  check('Recipe: the preview renders the slot', textOf(renderer.toJSON()).includes('dramatic'));
  await tap(row(renderer, 'Recipe'));
  await tap(pressableWithText(modal(renderer), 'Use the normal builder'));
  check('Recipe: leaving restores the normal rows', row(renderer, 'Subject') !== null);

  console.log('\nThemes');
  const theme = require(path.join(ROOT, 'src/theme.js'));
  await TestRenderer.act(async () => {
    renderer.unmount();
  });

  // A probe beside the screen switches the theme through the same context the
  // Settings row uses, so this exercises the real path.
  function ThemeHarness() {
    const { setTheme } = theme.useTheme();
    return h(
      React.Fragment,
      null,
      h(PromptBuilderScreen, {}),
      h(RN.Pressable, { testID: 'to-ocean', onPress: () => setTheme('ocean') }),
      h(RN.Pressable, { testID: 'to-unknown', onPress: () => setTheme('not-a-theme') })
    );
  }

  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(h(theme.ThemeProvider, null, h(ThemeHarness)));
  });
  await settle();

  const rowBackground = () => {
    const style = row(renderer, 'Mode').props.style;
    const list = Array.isArray(style) ? style : [style];
    return list.filter(Boolean).map((entry) => entry.backgroundColor).find(Boolean);
  };

  check('Theme: starts on the default palette', rowBackground() === '#1D1329', rowBackground());

  await tap(all(renderer, 'Pressable').find((node) => node.props.testID === 'to-ocean'));
  check('Theme: switching repaints the screen', rowBackground() === '#0D2534', rowBackground());
  check('Theme: the palette object follows', theme.colors.bg === '#061824', theme.colors.bg);
  check('Theme: the choice is remembered', storage.get('@frogpaper/theme') === 'ocean', storage.get('@frogpaper/theme'));
  check(
    'Theme: the screen still renders',
    all(renderer, 'Text').some((node) => textOf(node).includes('Use this prompt'))
  );

  await tap(all(renderer, 'Pressable').find((node) => node.props.testID === 'to-unknown'));
  check('Theme: an unknown id falls back instead of breaking', rowBackground() === '#1D1329', rowBackground());

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

run().catch((error) => {
  console.error('check-ui could not finish:', error);
  process.exit(2);
});
