// Config plugin: modernizes the ancient react-native-wallpaper-manager 0.3.16
// native code so it compiles under Expo SDK 57 (AGP 8+, RN 0.86).
//
// The library's native build files date back to 2016:
//   1. android/build.gradle        -> jcenter() (shut down), no `namespace`
//                                     (required by AGP 8), `compile` deps,
//                                     hardcoded buildToolsVersion 23.0.1.
//   2. AndroidManifest.xml         -> has a `package=` attribute, which AGP 8
//                                     rejects (moved to `namespace`).
//   3. WallPaperPackage.java       -> overrides createJSModules(), a method
//                                     removed from the ReactPackage interface
//                                     years ago -> @Override compile error.
// Verified against RN 0.86.3 bytecode: createViewManagers expects a raw
// List<ViewManager> and createNativeModules expects List<NativeModule>, so
// those two overrides stay as-is.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const LIB = ['node_modules', 'react-native-wallpaper-manager', 'android'];

const NEW_GRADLE = `apply plugin: 'com.android.library'

def safeExtGet(prop, fallback) {
    rootProject.ext.has(prop) ? rootProject.ext.get(prop) : fallback
}

android {
    namespace "com.cunyutech.hollyliu.reactnative.wallpaper"
    compileSdkVersion safeExtGet('compileSdkVersion', 36)

    defaultConfig {
        minSdkVersion safeExtGet('minSdkVersion', 24)
        targetSdkVersion safeExtGet('targetSdkVersion', 36)
    }
}

dependencies {
    implementation "com.facebook.react:react-native:+"
    implementation "com.github.bumptech.glide:glide:3.7.0"
    // Glide 3's Glide.with() overload set references android.support.v4
    // classes (Fragment / FragmentActivity). Those class files must be on
    // the compile classpath or javac fails with "cannot access Fragment".
    // Only the Context overload is actually used at runtime.
    implementation "com.android.support:support-v4:28.0.0"
}
`;

const NEW_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.SET_WALLPAPER" />
    <application>
        <meta-data
            android:name="com.cunyutech.hollyliu.reactnative.wallpaper.MyGlideModule"
            android:value="GlideModule" />
    </application>
</manifest>
`;

const NEW_PACKAGE_JAVA = `package com.cunyutech.hollyliu.reactnative.wallpaper;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class WallPaperPackage implements ReactPackage {

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }

    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new WallPaperManager(reactContext));
        return modules;
    }
}
`;

function replaceFile(projectRoot, segments, content, label) {
  const filePath = path.join(projectRoot, ...segments);
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    return `${label} patched`;
  }
  return `${label} not found (skipped)`;
}

const withWallpaperManagerFix = (config) => {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const results = [
        replaceFile(projectRoot, [...LIB, 'build.gradle'], NEW_GRADLE, 'build.gradle'),
        replaceFile(projectRoot, [...LIB, 'src', 'main', 'AndroidManifest.xml'], NEW_MANIFEST, 'AndroidManifest.xml'),
        replaceFile(
          projectRoot,
          [...LIB, 'src', 'main', 'java', 'com', 'cunyutech', 'hollyliu', 'reactnative', 'wallpaper', 'WallPaperPackage.java'],
          NEW_PACKAGE_JAVA,
          'WallPaperPackage.java'
        ),
      ];
      console.log('[WallpaperManagerFix]', results.join(' | '));
      return modConfig;
    },
  ]);
};

module.exports = withWallpaperManagerFix;
