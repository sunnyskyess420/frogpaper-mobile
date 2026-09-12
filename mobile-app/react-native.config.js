// React Native autolinking config.
//
// Disables native autolinking for @sentry/react-native so its broken
// sentry.gradle script (incompatible with Gradle 9 / Expo SDK 57)
// is NOT applied to the Android build.
//
// The JS-side Sentry code in src/services/sentry.js still works -
// @sentry/react-native gracefully falls back to JS-only error
// capture when the native bridge is absent. So you can still paste
// a Sentry DSN in Settings -> Diagnostics and JS errors will be
// reported. Native crashes won't be until we upgrade to a Gradle-9-
// compatible @sentry/react-native release.
//
// To re-enable native Sentry later: delete this file (or remove the
// @sentry/react-native entry below) once Sentry ships a fix.
module.exports = {
  dependencies: {
    '@sentry/react-native': {
      platforms: {
        android: null, // skip Android autolinking -> no sentry.gradle applied
        ios: null,     // skip iOS autolinking too for symmetry
      },
    },
  },
};
