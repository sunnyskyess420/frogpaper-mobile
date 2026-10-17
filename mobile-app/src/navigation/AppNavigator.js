// Root stack + bottom tabs for the FrogPaper screens.
//
// All eight screens used to live in a single native stack, so going from
// Generate to Gallery to Settings meant repeated back taps and the Build
// screen was only reachable from a button inside Generate. The four daily
// destinations - Home, Generate, Gallery, Settings - now live in a bottom
// tab bar, so each is one tap from the others. The four less-visited
// screens - Build, Detail, Slideshow, History - push onto the root stack
// above the tabs, so Back returns to whichever tab the user came from.
//
// In React Navigation 7 a screen inside the tab navigator can call
// navigation.navigate('Detail') / navigate('Build') and the call bubbles
// up to the parent stack, so the existing navigation calls in the screens
// are unchanged.
//
// No icon library is installed in this app, so tab icons are plain Unicode
// glyphs - the same vocabulary the rest of the app already uses for the
// dice, the build puzzle piece and the star. Every tab has an
// accessibility label so screen readers do not have to read the glyph
// aloud.
import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import GalleryScreen from '../screens/GalleryScreen';
import GenerateScreen from '../screens/GenerateScreen';
import DetailScreen from '../screens/DetailScreen';
import HomeScreen from '../screens/HomeScreen';
import PromptBuilderScreen from '../screens/PromptBuilderScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SlideshowScreen from '../screens/SlideshowScreen';
import HistoryScreen from '../screens/HistoryScreen';

// Shared by the tab headers and the stack-push headers so a Build header
// looks exactly like a Home header. colours.card is the header background,
// colours.accent is the back arrow / tint, colours.bg is the body
// background. headerShadowVisible: false keeps the original flat look.
const SHARED_HEADER_OPTIONS = {
  headerStyle: { backgroundColor: colors.card },
  headerTintColor: colors.accent,
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
};

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

// Plain Unicode glyphs (no icon library). Rendered through Text so the
// tab bar's tint colour shows through - we deliberately avoid any
// fontFamily override so the glyphs fall back to the platform emoji font
// when the system font lacks them.
function TabGlyph({ children, focused }) {
  return (
    <Text
      style={{
        fontSize: 20,
        color: focused ? colors.accent : colors.muted,
        lineHeight: 22,
        textAlign: 'center',
      }}
    >
      {children}
    </Text>
  );
}

function TabsNavigator() {
  return (
    <Tabs.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        ...SHARED_HEADER_OPTIONS,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerTitle: route.name === 'Home' ? 'FrogPaper' : undefined,
      })}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'FrogPaper',
          tabBarIcon: ({ focused }) => <TabGlyph focused={focused}>{'\u2302'}</TabGlyph>,
          tabBarAccessibilityLabel: 'Home',
        }}
      />
      <Tabs.Screen
        name="Generate"
        component={GenerateScreen}
        options={{
          title: 'Generate',
          tabBarIcon: ({ focused }) => <TabGlyph focused={focused}>{'\uD83C\uDFA8'}</TabGlyph>,
          tabBarAccessibilityLabel: 'Generate a wallpaper',
        }}
      />
      <Tabs.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{
          title: 'Gallery',
          tabBarIcon: ({ focused }) => <TabGlyph focused={focused}>{'\uD83D\uDDBC\uFE0F'}</TabGlyph>,
          tabBarAccessibilityLabel: 'Browse the gallery',
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabGlyph focused={focused}>{'\u2699\uFE0F'}</TabGlyph>,
          tabBarAccessibilityLabel: 'Settings',
        }}
      />
    </Tabs.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Tabs"
      screenOptions={SHARED_HEADER_OPTIONS}
    >
      {/* The tab bar itself has its own per-screen headers (see above), so
          the root stack's wrapper screen must not draw a second header on
          top. */}
      <Stack.Screen
        name="Tabs"
        component={TabsNavigator}
        options={{ headerShown: false }}
      />
      {/* The four less-visited screens push on top of the tabs. Back
          returns to whichever tab the user came from because the tab
          navigator is the previous stack entry. */}
      <Stack.Screen name="Build" component={PromptBuilderScreen} options={{ title: 'Build' }} />
      <Stack.Screen name="Detail" component={DetailScreen} options={{ title: 'Detail' }} />
      <Stack.Screen name="Slideshow" component={SlideshowScreen} options={{ title: 'Slideshow' }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Prompt history' }} />
    </Stack.Navigator>
  );
}
