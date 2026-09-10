// Config plugin: modernizes the ancient react-native-wallpaper-manager 0.3.16
// native code so it compiles under Expo SDK 57 (AGP 8+, RN 0.86).
//
// The library's native code dates back to 2016 and needed three rounds of
// surgery, all applied during cloud prebuild (withDangerousMod):
//
// Round 1 (build #1 failed):
//   1. android/build.gradle        -> jcenter() (shut down), no `namespace`
//                                     (required by AGP 8), `compile` deps,
//                                     hardcoded buildToolsVersion 23.0.1.
//   2. AndroidManifest.xml         -> has a `package=` attribute, which AGP 8
//                                     rejects (moved to `namespace`).
//   3. WallPaperPackage.java       -> overrides createJSModules(), a method
//                                     removed from the ReactPackage interface
//                                     years ago -> @Override compile error.
//   Verified against RN 0.86.3 bytecode: createViewManagers expects a raw
//   List<ViewManager> and createNativeModules expects List<NativeModule>, so
//   the modernized overrides stay interface-exact.
//
// Round 2 (build #2 failed): Glide 3.7.0's Glide.with() overload set
//   references android.support.v4.app.Fragment/FragmentActivity -> javac
//   "cannot access Fragment". Added support-v4:28.0.0 to the module.
//
// Round 3 (build #3 failed, this version): support-v4 28.0.0 packages the
//   legacy classes androidx.core:core:1.17.0 ALSO carries
//   (INotificationSideChannel, ResultReceiver, IconCompatParcelizer, ...) ->
//   :app:checkReleaseDuplicateClasses fails. Root conflict: two eras of the
//   same compat classes cannot coexist in one APK.
//
// FINAL SOLUTION (here): remove Glide entirely. WallPaperManager.java is
// replaced with a functionally identical implementation built ONLY on
// android.graphics.BitmapFactory / WallpaperManager / java.net. The app only
// ever calls setWallpaper({uri: "file://..."}) (local cache file), which the
// framework APIs handle natively. No Glide -> no support-v4 -> no duplicates,
// and MyGlideModule.java (which imports Glide) is deleted from the build.
//   APK, phones on the LAN could not use plain-http backends at all.
//
// Round 4 (app installed, phone browser OK but app showed "backend
//   offline"): Android 9+ blocks cleartext HTTP inside apps by default;
//   the LAN backend speaks http://. Phone browser worked (browsers may
//   use cleartext), app failed. Fix: withAndroidManifest mod sets
//   android:usesCleartextTraffic="true" on the MAIN app manifest.
const { withDangerousMod, withAndroidManifest } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const LIB = ['node_modules', 'react-native-wallpaper-manager', 'android'];
const JAVA_DIR = [
  ...LIB,
  'src',
  'main',
  'java',
  'com',
  'cunyutech',
  'hollyliu',
  'reactnative',
  'wallpaper',
];

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
}
`;

const NEW_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.SET_WALLPAPER" />
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

// Glide-free drop-in replacement for WallPaperManager.java.
// Same JS contract: setWallpaper({uri, headers?}, callback) -> callback
// receives {status: "success"|"error", msg, url}. Handles the exact source
// types the original supported: base64 data URIs, bundled drawable names,
// file:// and content:// URIs, plain paths, and http(s) URLs with optional
// headers. Decoding runs on a background thread; center-crops and scales the
// bitmap to the system's desired wallpaper dimensions (the same job Glide's
// 1080x1920 centerCrop target used to do).
const NEW_MANAGER_JAVA = `package com.cunyutech.hollyliu.reactnative.wallpaper;

import android.app.WallpaperManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;
import com.facebook.react.bridge.WritableMap;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class WallPaperManager extends ReactContextBaseJavaModule {

    private static final String TAG = "WallPaperManager";

    private final ReactApplicationContext reactContext;
    private WallpaperManager wallpaperManager;
    private Callback rctCallback = null;

    public WallPaperManager(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        wallpaperManager = WallpaperManager.getInstance(reactContext);
    }

    @Override
    public String getName() {
        return "WallPaperManager";
    }

    private void sendMessage(String status, String msg, String url) {
        Callback cb = rctCallback;
        rctCallback = null;
        if (cb != null) {
            WritableMap map = Arguments.createMap();
            map.putString("status", status);
            map.putString("msg", msg);
            map.putString("url", url);
            cb.invoke(map);
        }
    }

    @ReactMethod
    public void setWallpaper(final ReadableMap params, final Callback callback) {
        final String source = params.hasKey("uri") ? params.getString("uri") : null;
        final ReadableMap headers = params.hasKey("headers") ? params.getMap("headers") : null;

        if (rctCallback != null) {
            WritableMap map = Arguments.createMap();
            map.putString("status", "error");
            map.putString("msg", "busy");
            map.putString("url", source);
            callback.invoke(map);
            return;
        }
        rctCallback = callback;

        if (source == null || source.length() == 0) {
            sendMessage("error", "uri is missing", source);
            return;
        }

        new Thread(new Runnable() {
            public void run() {
                try {
                    Bitmap decoded = decodeSource(source, headers);
                    Bitmap cropped = centerCropToWallpaperSize(decoded);
                    wallpaperManager.setBitmap(cropped);
                    sendMessage("success", "Set Wallpaper Success", source);
                } catch (Throwable t) {
                    Log.w(TAG, "setWallpaper failed", t);
                    String reason = t.getMessage() != null ? t.getMessage() : t.toString();
                    sendMessage("error", "Set Wallpaper Failed: " + reason, source);
                }
            }
        }).start();
    }

    private Bitmap decodeSource(String source, ReadableMap headers) throws Exception {
        if (source.startsWith("data:image")) {
            String b64 = source.replaceAll("data:image/.*;base64,", "");
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            return decodeBytes(bytes);
        }

        Uri uri = Uri.parse(source);
        String scheme = uri.getScheme();

        if ("http".equals(scheme) || "https".equals(scheme)) {
            HttpURLConnection conn = (HttpURLConnection) new URL(source).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            if (headers != null) {
                ReadableMapKeySetIterator it = headers.keySetIterator();
                while (it.hasNextKey()) {
                    String key = it.nextKey();
                    conn.setRequestProperty(key, headers.getString(key));
                }
            }
            conn.connect();
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new Exception("HTTP " + code + " while fetching image");
            }
            InputStream in = null;
            try {
                in = conn.getInputStream();
                return decodeBytes(readAll(in));
            } finally {
                if (in != null) {
                    try { in.close(); } catch (Exception ignore) {}
                }
                conn.disconnect();
            }
        }

        if (scheme == null) {
            int resId = reactContext.getResources().getIdentifier(
                source, "drawable", reactContext.getPackageName());
            if (resId != 0) {
                return BitmapFactory.decodeResource(reactContext.getResources(), resId);
            }
            FileInputStream fin = new FileInputStream(new File(source));
            try {
                return decodeBytes(readAll(fin));
            } finally {
                try { fin.close(); } catch (Exception ignore) {}
            }
        }

        InputStream in = reactContext.getContentResolver().openInputStream(uri);
        if (in == null) {
            throw new Exception("Cannot open " + source);
        }
        try {
            return decodeBytes(readAll(in));
        } finally {
            try { in.close(); } catch (Exception ignore) {}
        }
    }

    private byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[64 * 1024];
        int read;
        while ((read = in.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    // Two-pass decode (bounds first, then sampled) keeps memory low on
    // 12MP+ photos while leaving plenty of resolution for the final crop.
    private Bitmap decodeBytes(byte[] bytes) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw new Exception("Not a decodable image");
        }

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = computeInSampleSize(bounds, 2048);
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        if (bitmap == null) {
            throw new Exception("Not a decodable image");
        }
        return bitmap;
    }

    private int computeInSampleSize(BitmapFactory.Options options, int maxDim) {
        int sample = 1;
        int w = options.outWidth;
        int h = options.outHeight;
        while (w / (sample * 2) >= maxDim / 2 && h / (sample * 2) >= maxDim / 2) {
            sample *= 2;
        }
        return sample;
    }

    // Center-crop + scale to the system's desired wallpaper size (the same
    // job Glide's 1080x1920 centerCrop target used to do).
    private Bitmap centerCropToWallpaperSize(Bitmap src) {
        if (src == null) {
            throw new IllegalArgumentException("source bitmap is null");
        }
        int targetW = wallpaperManager.getDesiredMinimumWidth();
        int targetH = wallpaperManager.getDesiredMinimumHeight();
        if (targetW <= 0 || targetH <= 0) {
            targetW = 1080;
            targetH = 1920;
        }

        float scale = Math.max(
            targetW / (float) src.getWidth(),
            targetH / (float) src.getHeight()
        );
        int scaledW = Math.round(src.getWidth() * scale);
        int scaledH = Math.round(src.getHeight() * scale);

        Bitmap scaled = Bitmap.createBitmap(scaledW, scaledH, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(scaled);
        Matrix matrix = new Matrix();
        matrix.postScale(scale, scale);
        canvas.drawBitmap(src, matrix, null);

        int x = Math.max(0, (scaledW - targetW) / 2);
        int y = Math.max(0, (scaledH - targetH) / 2);
        int cropW = Math.min(targetW, scaledW);
        int cropH = Math.min(targetH, scaledH);
        Bitmap cropped = Bitmap.createBitmap(scaled, x, y, cropW, cropH);

        if (cropped != scaled) {
            scaled.recycle();
        }
        if (cropped != src && src != scaled) {
            src.recycle();
        }
        return cropped;
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

function deleteFile(projectRoot, segments, label) {
  const filePath = path.join(projectRoot, ...segments);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return `${label} removed`;
    }
    return `${label} already absent`;
  } catch (e) {
    // If unlink is blocked, neutralize the file instead: a file with no
    // class declarations compiles fine and references nothing Glide.
    fs.writeFileSync(filePath, '// removed by WallpaperManagerFix (Glide-free build)\n');
    return `${label} blanked (unlink failed: ${e.message})`;
  }
}

// Allows plain http:// traffic (the home-LAN backend is http, not https).
// Applied on the main app manifest during prebuild.
const withCleartextHttp = (config) => {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application[0];
    if (application && application.$) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return mod;
  });
};

const withWallpaperManagerFix = (config) => {
  return withCleartextHttp(
    withDangerousMod(config, [
      'android',
      async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const results = [
        replaceFile(projectRoot, [...LIB, 'build.gradle'], NEW_GRADLE, 'build.gradle'),
        replaceFile(projectRoot, [...LIB, 'src', 'main', 'AndroidManifest.xml'], NEW_MANIFEST, 'AndroidManifest.xml'),
        replaceFile(projectRoot, [...JAVA_DIR, 'WallPaperPackage.java'], NEW_PACKAGE_JAVA, 'WallPaperPackage.java'),
        replaceFile(projectRoot, [...JAVA_DIR, 'WallPaperManager.java'], NEW_MANAGER_JAVA, 'WallPaperManager.java'),
        deleteFile(projectRoot, [...JAVA_DIR, 'MyGlideModule.java'], 'MyGlideModule.java'),
      ];
      console.log('[WallpaperManagerFix]', results.join(' | '));
      return modConfig;
      }
    ])
  );
};

module.exports = withWallpaperManagerFix;
