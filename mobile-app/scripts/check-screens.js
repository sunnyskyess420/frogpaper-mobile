#!/usr/bin/env node
/**
 * check-screens.js - every screen mounts with the stubs below.
 *
 * The other suites test logic; check-ui drives the Build screen in detail. This
 * one is the wide net: it mounts each screen (and each shared component) inside
 * the theme provider and fails if any of them throws while rendering. It is what
 * catches a refactor that leaves a screen reading an undefined token.
 *
 * Native modules and the backend are stubbed permissively: this proves the
 * render path, not the behaviour behind it.
 *
 * Run with:  npm run check:screens
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

// --- stubs ------------------------------------------------------------------
function host(name) {
  return function Stub(props) {
    return h(name, props, props.children);
  };
}

// Anything reached but not described below: callable, awaitable, and safe to
// read a property from (so an unlisted expo module cannot crash the render).
function anything() {
  const fn = function () {
    return Promise.resolve(null);
  };
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === 'then' || prop === 'Symbol.toStringTag') return undefined;
      if (prop === '__esModule') return true;
      return anything();
    },
    apply() {
      return Promise.resolve(null);
    },
    construct() {
      return {};
    },
  });
}

const storage = new Map();
const noop = () => {};

const RN = {
  Platform: { OS: 'android', select: (o) => (o.android === undefined ? o.default : o.android) },
  StyleSheet: { create: (sheet) => sheet, flatten: (style) => style, absoluteFillObject: {} },
  Alert: { alert: noop },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  Linking: { openURL: async () => true, canOpenURL: async () => true, addEventListener: () => ({ remove: noop }) },
  Share: { share: async () => ({}) },
  View: host('View'),
  Text: host('Text'),
  Pressable: host('Pressable'),
  TextInput: host('TextInput'),
  ScrollView: host('ScrollView'),
  KeyboardAvoidingView: host('KeyboardAvoidingView'),
  ActivityIndicator: host('ActivityIndicator'),
  Image: host('Image'),
  ImageBackground: host('ImageBackground'),
  Switch: host('Switch'),
  TouchableOpacity: host('TouchableOpacity'),
  RefreshControl: host('RefreshControl'),
  PanResponder: { create: () => ({ panHandlers: {} }) },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) },
  Animated: {
    View: host('AnimatedView'),
    Text: host('AnimatedText'),
    Image: host('AnimatedImage'),
    ScrollView: host('AnimatedScrollView'),
    Value: function Value(v) {
      return {
        setValue: noop,
        setOffset: noop,
        flattenOffset: noop,
        addListener: () => 'listener',
        removeListener: noop,
        removeAllListeners: noop,
        stopAnimation: noop,
        resetAnimation: noop,
        interpolate: () => ({ interpolate: () => ({}) }),
      };
    },
    timing: () => ({ start: noop, stop: noop }),
    spring: () => ({ start: noop, stop: noop }),
    decay: () => ({ start: noop, stop: noop }),
    parallel: () => ({ start: noop, stop: noop }),
    sequence: () => ({ start: noop, stop: noop }),
    event: () => noop,
  },
  FlatList: function FlatList(props) {
    const { data = [], renderItem, ListHeaderComponent, ListEmptyComponent, keyExtractor } = props;
    const header = typeof ListHeaderComponent === 'function' ? h(ListHeaderComponent) : ListHeaderComponent;
    const empty = typeof ListEmptyComponent === 'function' ? h(ListEmptyComponent) : ListEmptyComponent;
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
  VirtualizedList: function VirtualizedList(props) {
    return h('FlatList', props, props.children);
  },
  SectionList: function SectionList(props) {
    return h('FlatList', props, props.children);
  },
};

// A small promise-based axios lookalike: enough for the api module's module-level
// setup and for effects that fetch on mount.
const httpInstance = {
  get: async () => ({ data: {} }),
  post: async () => ({ data: {} }),
  put: async () => ({ data: {} }),
  delete: async () => ({ data: {} }),
  patch: async () => ({ data: {} }),
  interceptors: { request: { use: noop }, response: { use: noop } },
  defaults: { headers: { common: {} }, timeout: 0 },
};

const mocks = {
  'react-native': RN,
  'expo-status-bar': { StatusBar: host('StatusBar') },
  'expo-clipboard': { setStringAsync: async () => true, getStringAsync: async () => '' },
  'expo-constants': {
    __esModule: true,
    default: { expoConfig: { version: '1.13.3' }, manifest: { version: '1.13.3' } },
    expoConfig: { version: '1.13.3' },
  },
  'expo-secure-store': {
    getItemAsync: async () => null,
    setItemAsync: async () => true,
    deleteItemAsync: async () => true,
    isAvailableAsync: async () => true,
  },
  'expo-file-system': anything(),
  'expo-media-library': anything(),
  'expo-image-picker': anything(),
  'expo-image-manipulator': anything(),
  'expo-sharing': anything(),
  'react-native-wallpaper-manager': anything(),
  '@sentry/react-native': anything(),
  axios: { __esModule: true, default: { create: () => httpInstance, ...httpInstance }, create: () => httpInstance, ...httpInstance },
  '@react-navigation/native': {
    useNavigation: () => ({ navigate: noop, goBack: noop, setOptions: noop, addListener: () => noop }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: noop,
    useIsFocused: () => true,
    useNavigationState: () => ({}),
    useTheme: () => ({ colors: {} }),
    NavigationContainer: host('NavigationContainer'),
    DarkTheme: { colors: {} },
  },
  '@react-navigation/native-stack': {
    createNativeStackNavigator: () => ({ Navigator: host('Navigator'), Screen: host('Screen') }),
  },
  '@react-navigation/bottom-tabs': {
    createBottomTabNavigator: () => ({ Navigator: host('Navigator'), Screen: host('Screen') }),
  },
  'react-native-safe-area-context': {
    useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
    SafeAreaProvider: host('SafeAreaProvider'),
    SafeAreaView: host('SafeAreaView'),
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
      multiGet: async () => [],
    },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) {
    return mocks[request];
  }
  if (request.startsWith('expo-') || request.startsWith('react-native-')) {
    // Unknown native modules must not take the render down with them.
    return anything();
  }
  return originalLoad.apply(this, arguments);
};

// Screens require their art directly (require('../../assets/mascot.png')), so
// the image extensions need a loader that returns something Image can take.
for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ttf', '.otf']) {
  Module._extensions[ext] = function asset(mod, filename) {
    mod.exports = { uri: `asset://${path.basename(filename)}`, width: 100, height: 100 };
  };
}

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
  try {
    mod._compile(code, filename);
  } catch (error) {
    console.error(`while compiling ${path.relative(ROOT, filename)}: ${error.message}`);
    const lines = code.split('\n');
    const match = /: (\d+)$/.exec(error.stack || '');
    if (match) {
      const at = Number(match[1]);
      console.error(lines.slice(Math.max(0, at - 3), at + 2).join('\n'));
    }
    throw error;
  }
};

// --- the screens ------------------------------------------------------------
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

async function mount(name, loader, props = {}, options = {}) {
  const { expectText = true } = options;
  const theme = require(path.join(ROOT, 'src/theme.js'));
  const Component = loader();
  let renderer;
  try {
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(h(theme.ThemeProvider, null, h(Component, props)));
    });
    await TestRenderer.act(async () => {});
    const tree = renderer.toJSON();
    const text = renderer.root
      .findAll((node) => node.type === 'Text', { deep: true })
      .map((node) => (node.children || []).join(''))
      .join(' ');
    check(
      `${name}: renders`,
      tree !== null && (!expectText || text.trim().length > 0),
      tree === null ? 'nothing rendered' : `${text.length} chars of text`
    );
    await TestRenderer.act(async () => {
      renderer.unmount();
    });
  } catch (error) {
    check(`${name}: renders`, false, error.message);
    if (process.env.SCREENS_DEBUG) {
      console.error(error.stack);
    }
  }
}

// --- Settings -> Appearance, driven through its own controls ---------------
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || !node.children) return '';
  return node.children.map(textOf).join('');
}

function all(container, type) {
  const root = container && container.root ? container.root : container;
  return root.findAll((node) => node.type === type, { deep: true });
}

async function tap(node) {
  if (!node) throw new Error('nothing to tap');
  await TestRenderer.act(async () => {
    node.props.onPress();
  });
}

async function settingsTheme() {
  const theme = require(path.join(ROOT, 'src/theme.js'));
  const SettingsScreen = require(path.join(ROOT, 'src/screens/SettingsScreen.js')).default;

  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(h(theme.ThemeProvider, null, h(SettingsScreen)));
  });
  await TestRenderer.act(async () => {});

  const header = all(renderer, 'Pressable').find(
    (node) => typeof node.props.onPress === 'function' && textOf(node).includes('Appearance')
  );
  check('Appearance: the card is on Settings', header !== null);
  if (!header) return;

  await tap(header);
  const labels = theme.THEMES.map((entry) => `${entry.label} theme`);
  const chips = all(renderer, 'Pressable').filter((node) => labels.includes(node.props.accessibilityLabel));
  check('Appearance: every theme is offered', chips.length === theme.THEMES.length, `${chips.length}/${theme.THEMES.length}`);

  const tide = chips.find((node) => node.props.accessibilityLabel === 'Tide theme');
  await tap(tide);
  check('Appearance: tapping a chip applies the theme', theme.activeThemeId() === 'ocean', theme.activeThemeId());
  check(
    'Appearance: the card summary follows',
    all(renderer, 'Text').some((node) => textOf(node) === 'Tide theme'),
    theme.activeThemeId()
  );
  check(
    'Appearance: the choice is persisted',
    storage.get('@frogpaper/theme') === 'ocean',
    storage.get('@frogpaper/theme')
  );

  await tap(all(renderer, 'Pressable').find((node) => node.props.accessibilityLabel === 'Halloween theme'));
  check('Appearance: switching back works', theme.activeThemeId() === 'halloween', theme.activeThemeId());

  for (const entry of theme.THEMES) {
    const chip = all(renderer, 'Pressable').find(
      (node) => node.props.accessibilityLabel === `${entry.label} theme`
    );
    await tap(chip);
    check(`Appearance: ${entry.label} applies`, theme.activeThemeId() === entry.id, theme.activeThemeId());
  }

  await tap(all(renderer, 'Pressable').find((node) => node.props.accessibilityLabel === 'Halloween theme'));

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

// --- Settings -> Help -> the Build guide -----------------------------------
async function settingsHelp() {
  const theme = require(path.join(ROOT, 'src/theme.js'));
  const SettingsScreen = require(path.join(ROOT, 'src/screens/SettingsScreen.js')).default;

  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(h(theme.ThemeProvider, null, h(SettingsScreen)));
  });
  await TestRenderer.act(async () => {});

  const helpCard = all(renderer, 'Pressable').find(
    (node) => typeof node.props.onPress === 'function' && textOf(node).includes('Help')
  );
  check('Help: the card is on Settings', helpCard !== null);
  if (!helpCard) return;

  await tap(helpCard);
  const guideRow = all(renderer, 'Pressable').find((node) => textOf(node).includes('How to build a prompt'));
  check('Help: offers the prompt guide', guideRow !== null);
  if (!guideRow) return;

  await tap(guideRow);
  const guideText = textOf(renderer.toJSON());
  check('Help: the guide opens', guideText.includes('The rows, top to bottom'));
  check('Help: it names every row', ['Recipe', 'Subject', 'Setting', 'Style', 'Lighting', 'Colour', 'Mood', 'Atmosphere'].every((row) => guideText.includes(row)));
  check('Help: it keeps the worked example', guideText.includes('A worked example') && guideText.includes('snowman'));

  await tap(all(renderer, 'Pressable').find((node) => textOf(node).trim() === 'Close'));
  check('Help: the guide closes', !textOf(renderer.toJSON()).includes('The rows, top to bottom'));

  await TestRenderer.act(async () => {
    renderer.unmount();
  });
}

async function run() {
  const screens = path.join(ROOT, 'src/screens');
  const components = path.join(ROOT, 'src/components');

  await mount('Home', () => require(path.join(screens, 'HomeScreen.js')).default);
  await mount('Generate', () => require(path.join(screens, 'GenerateScreen.js')).default);
  await mount('Gallery', () => require(path.join(screens, 'GalleryScreen.js')).default);
  await mount('Settings', () => require(path.join(screens, 'SettingsScreen.js')).default);
  await mount('History', () => require(path.join(screens, 'HistoryScreen.js')).default);
  await mount('Detail', () => require(path.join(screens, 'DetailScreen.js')).default, {}, { expectText: false });
  await mount('Build', () => require(path.join(screens, 'PromptBuilderScreen.js')).default);
  await mount('ByokHelpModal', () => require(path.join(components, 'ByokHelpModal.js')).default, {
    visible: true,
    onClose: () => {},
    onOpenSettings: () => {},
  });
  await mount('WelcomeTutorial', () => require(path.join(components, 'WelcomeTutorial.js')).default, {
    visible: true,
    onDone: () => {},
  });
  await mount('ProviderFallbackNotice', () => require(path.join(components, 'ProviderFallbackNotice.js')).default, {
    providerId: 'pollinations',
  });
  await mount(
    'WallpaperImage',
    () => require(path.join(components, 'WallpaperImage.js')).default,
    { filename: 'example.png' },
    { expectText: false }
  );

  await settingsTheme();
  await settingsHelp();

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('check-screens could not finish:', error);
  process.exit(2);
});
