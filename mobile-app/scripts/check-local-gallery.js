#!/usr/bin/env node
/**
 * check-local-gallery.js - headless verification of the phone's own gallery.
 *
 * Run from the mobile-app directory:
 *     node scripts/check-local-gallery.js
 * or via the npm script:
 *     npm run check:local-gallery
 *
 * Exits non-zero if any check fails, so it can be wired into CI / pre-build hooks.
 *
 * What it proves (no device, no backend, no network):
 *   1. Images are saved into a flat store and listed newest-first, with the
 *      sidecar metadata (dimensions, origin) carried through, and saving the
 *      same filename twice does not create a second copy.
 *   2. Deleting removes the target file and its sidecar only.
 *   3. Importing from the chosen SD-card folder skips files whose name+size is
 *      already stored, honours the per-run cap, and copes with no folder
 *      chosen, revoked access, an empty folder and non-image files - always
 *      resolving, never throwing.
 *   4. The gallery source setting defaults to 'phone', persists a choice and
 *      ignores junk; upgrading an existing install fires the migration notice
 *      exactly once.
 *
 * How it loads the app code: the service modules are plain ESM, so this script
 * transpiles them to CommonJS on the fly (babel, no config files) and stubs the
 * native modules they import (react-native, expo-file-system, its legacy SAF
 * entrypoint, the media library, AsyncStorage and the platform save helpers)
 * with in-memory doubles. No app bundle and no emulator needed.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const ROOT = path.resolve(__dirname, '..');
const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';

// --- in-memory device ------------------------------------------------------
let disk = new Map(); // uri -> { buf: Buffer, mtime }
let dirs = new Set();
let clock = 1000;
const downloadLog = [];
let downloadSize = 2048;
let fetchHandler = null;

const DOCUMENT_URI = 'file:///documents';
const CACHE_URI = 'file:///cache';
const WALLPAPER_URI = `${DOCUMENT_URI}/wallpapers`;

function joinUri(parts) {
  return parts
    .map((part) =>
      part && typeof part === 'object' && typeof part.uri === 'string' ? part.uri : String(part)
    )
    .join('/');
}

function parentUri(uri) {
  return uri.slice(0, uri.lastIndexOf('/'));
}

function toBuffer(content, options) {
  const encoding = options && options.encoding;
  if (encoding === 'base64' && typeof content === 'string') {
    return Buffer.from(content, 'base64');
  }
  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8');
  }
  if (content instanceof Uint8Array) {
    return Buffer.from(content);
  }
  return Buffer.from(String(content), 'utf8');
}

class MockFile {
  constructor(...parts) {
    this._uri = joinUri(parts);
  }
  get uri() {
    return this._uri;
  }
  get name() {
    return this._uri.split('/').pop();
  }
  get exists() {
    return disk.has(this._uri);
  }
  get size() {
    const entry = disk.get(this._uri);
    return entry ? entry.buf.length : 0;
  }
  get lastModified() {
    const entry = disk.get(this._uri);
    return entry ? entry.mtime : null;
  }
  get modificationTime() {
    return this.lastModified;
  }
  create(options) {
    const overwrite = options && options.overwrite;
    if (disk.has(this._uri) && !overwrite) {
      throw new Error(`File already exists: ${this._uri}`);
    }
    dirs.add(parentUri(this._uri));
    disk.set(this._uri, { buf: Buffer.alloc(0), mtime: clock++ });
  }
  write(content, options) {
    dirs.add(parentUri(this._uri));
    disk.set(this._uri, { buf: toBuffer(content, options), mtime: clock++ });
  }
  async copy(destination) {
    const entry = disk.get(this._uri);
    if (!entry) {
      throw new Error(`Cannot copy a missing file: ${this._uri}`);
    }
    dirs.add(parentUri(destination.uri));
    disk.set(destination.uri, { buf: entry.buf, mtime: clock++ });
  }
  async move(destination) {
    const entry = disk.get(this._uri);
    if (!entry) {
      throw new Error(`Cannot move a missing file: ${this._uri}`);
    }
    disk.set(destination.uri, entry);
    disk.delete(this._uri);
  }
  delete() {
    if (!disk.has(this._uri)) {
      throw new Error(`Cannot delete a missing file: ${this._uri}`);
    }
    disk.delete(this._uri);
  }
  async text() {
    const entry = disk.get(this._uri);
    if (!entry) {
      throw new Error(`Cannot read a missing file: ${this._uri}`);
    }
    return entry.buf.toString('utf8');
  }
  async base64() {
    const entry = disk.get(this._uri);
    if (!entry) {
      throw new Error(`Cannot read a missing file: ${this._uri}`);
    }
    return entry.buf.toString('base64');
  }
  static async downloadFileAsync(url, destination, options) {
    downloadLog.push({ url, destination: destination.uri, options: options || null });
    if (!fetchHandler) {
      throw new TypeError('Network request failed');
    }
    if (disk.has(destination.uri) && !(options && options.idempotent)) {
      throw new Error(`Destination already exists: ${destination.uri}`);
    }
    disk.set(destination.uri, { buf: Buffer.alloc(downloadSize, 7), mtime: clock++ });
    return new MockFile(destination.uri);
  }
}

class MockDirectory {
  constructor(...parts) {
    this._uri = joinUri(parts);
  }
  get uri() {
    return this._uri;
  }
  get name() {
    return this._uri.split('/').pop();
  }
  get exists() {
    return dirs.has(this._uri);
  }
  create() {
    dirs.add(this._uri);
  }
  delete() {
    for (const key of [...disk.keys()]) {
      if (key.startsWith(`${this._uri}/`)) {
        disk.delete(key);
      }
    }
    dirs.delete(this._uri);
  }
  list() {
    if (!dirs.has(this._uri)) {
      throw new Error(`Directory does not exist: ${this._uri}`);
    }
    return [...disk.keys()]
      .filter((key) => key.startsWith(`${this._uri}/`))
      .map((key) => new MockFile(key));
  }
}

dirs.add(DOCUMENT_URI);
dirs.add(CACHE_URI);

// --- in-memory Storage Access Framework ------------------------------------
// What the "SD card folder" currently holds. Each entry is a SAF document URI
// plus the metadata getInfoAsync/readAsStringAsync would report.
let safFiles = [];
let safListError = null;

function setSafFiles(files) {
  safFiles = files;
  safListError = null;
}

function b64(bytes) {
  return Buffer.alloc(bytes, 9).toString('base64');
}

const storageAccessFramework = {
  readDirectoryAsync: async () => {
    if (safListError) {
      throw safListError;
    }
    return safFiles.map((file) => file.uri);
  },
  readAsStringAsync: async (uri) => {
    const file = safFiles.find((entry) => entry.uri === uri);
    if (!file) {
      throw new Error(`No such document: ${uri}`);
    }
    if (file.readError) {
      throw new Error('Could not read that document.');
    }
    return file.base64;
  },
};

const legacyFileSystem = {
  __esModule: true,
  StorageAccessFramework: storageAccessFramework,
  getInfoAsync: async (uri) => {
    const file = safFiles.find((entry) => entry.uri === uri);
    if (!file) {
      return { exists: false, uri };
    }
    return {
      exists: true,
      uri,
      size: file.size,
      isDirectory: !!file.isDirectory,
      modificationTime: 0,
    };
  },
  readAsStringAsync: storageAccessFramework.readAsStringAsync,
};

// --- in-memory AsyncStorage ------------------------------------------------
const storage = new Map();
const asyncStorageMock = {
  getItem: async (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: async (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: async (key) => {
    storage.delete(key);
  },
  clear: async () => storage.clear(),
};

const mocks = {
  'react-native': { Platform: { OS: 'android' }, NativeModules: {} },
  'expo-constants': { __esModule: true, default: { expoConfig: null }, expoConfig: null },
  'expo-file-system': {
    __esModule: true,
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: new MockDirectory(DOCUMENT_URI), cache: new MockDirectory(CACHE_URI) },
  },
  'expo-file-system/legacy': legacyFileSystem,
  'expo-media-library/legacy': { __esModule: true },
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorageMock },
  './deviceMedia': {
    __esModule: true,
    saveToDevice: async () => ({ ok: true }),
    setAsWallpaper: async () => ({ ok: true }),
    capabilities: { canSave: true, canSetWallpaper: true },
  },
};

// --- load the app's service modules ---------------------------------------
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
  const { code } = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  mod._compile(code, filename);
};

global.fetch = async () => {
  if (!fetchHandler) {
    throw new TypeError('Network request failed');
  }
  return fetchHandler();
};

const localGallery = require(path.join(ROOT, 'src/services/localGallery.js'));
const gallerySource = require(path.join(ROOT, 'src/services/gallerySource.js'));

// --- assertion helpers ----------------------------------------------------
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

function resetDevice() {
  disk = new Map();
  dirs = new Set([DOCUMENT_URI, CACHE_URI]);
  downloadLog.length = 0;
  clock = 1000;
}

function setFolderChosen() {
  storage.set('@frogpaper/save_target', 'folder');
  storage.set('@frogpaper/save_folder', JSON.stringify({ uri: 'content://tree/sunset', name: 'Sunset' }));
}

function namesOf(images) {
  return images.map((image) => image.filename).join(',');
}

// --- 1: the local store ----------------------------------------------------
async function checkStore() {
  console.log('\nLocal store');
  resetDevice();
  storage.clear();

  const dir = localGallery.ensureLocalDir();
  check('ensureLocalDir creates the wallpapers directory in the document store', !!dir && dir.exists);
  check('a fresh store reports zero images', (await localGallery.localImageCount()) === 0);
  check('a fresh store lists nothing', (await localGallery.listLocalImages()).length === 0);

  const first = await localGallery.saveLocalImage({
    bytes: Buffer.from('hello').toString('base64'),
    filename: 'first.png',
  });
  check('saveLocalImage writes the bytes and reports the file', first.ok === true && first.size === 5, JSON.stringify(first));

  const listed = await localGallery.listLocalImages();
  check(
    'the saved image is listed with its filename, size and phone origin',
    listed.length === 1 &&
      listed[0].filename === 'first.png' &&
      listed[0].size === 5 &&
      listed[0].source === 'phone',
    JSON.stringify(listed)
  );

  const again = await localGallery.saveLocalImage({
    bytes: Buffer.from('hello').toString('base64'),
    filename: 'first.png',
  });
  check('saving the same filename again is idempotent (no second copy)', again.ok === true && (await localGallery.localImageCount()) === 1);

  const withMeta = await localGallery.saveLocalImage({
    bytes: b64(20),
    filename: 'wide.png',
    meta: { width: 1080, height: 1920, prompt: 'a sunset' },
  });
  const metaEntry = (await localGallery.listLocalImages()).find((image) => image.filename === 'wide.png');
  check(
    'sidecar metadata is listed (dimensions + origin)',
    withMeta.ok === true && !!metaEntry && metaEntry.width === 1080 && metaEntry.height === 1920,
    JSON.stringify(metaEntry)
  );
  const fetched = await localGallery.getLocalImage('wide.png');
  check('getLocalImage returns the stored metadata for Detail', !!fetched && fetched.meta && fetched.meta.prompt === 'a sunset');

  // A second wave with later modification times must sort ahead of the first.
  await localGallery.saveLocalImage({ bytes: b64(30), filename: 'older.png' });
  await localGallery.saveLocalImage({ bytes: b64(31), filename: 'newest.png' });
  const ordered = await localGallery.listLocalImages();
  check(
    'listLocalImages is newest-first',
    namesOf(ordered) === 'newest.png,older.png,wide.png,first.png',
    namesOf(ordered)
  );
  check('localImageCount counts the images', (await localGallery.localImageCount()) === 4);

  // remoteUrl path (the generation/save handoff).
  fetchHandler = async () => ({ ok: true, status: 200 });
  const downloaded = await localGallery.saveLocalImage({
    remoteUrl: 'https://example.test/api/images/remote.png',
    filename: 'remote.png',
  });
  check(
    'saveLocalImage downloads a remote image into the store',
    downloaded.ok === true && downloadLog.length === 1 && downloadLog[0].url.includes('/api/images/remote.png'),
    JSON.stringify({ downloaded, downloadLog })
  );

  fetchHandler = null; // offline
  const offlineSave = await localGallery.saveLocalImage({
    remoteUrl: 'https://example.test/api/images/next.png',
    filename: 'next.png',
  });
  check('an offline download resolves { ok:false } instead of throwing', offlineSave.ok === false && !!offlineSave.message);
  fetchHandler = null;

  const emptySave = await localGallery.saveLocalImage({ filename: 'nothing.png' });
  check('saving with neither bytes nor a URL resolves { ok:false }', emptySave.ok === false);

  // Delete only the target (and its sidecar).
  const removed = await localGallery.deleteLocalImage('wide.png');
  const afterDelete = await localGallery.listLocalImages();
  check(
    'deleteLocalImage removes only the named image',
    removed.ok === true &&
      removed.removed === 1 &&
      !afterDelete.some((image) => image.filename === 'wide.png') &&
      afterDelete.some((image) => image.filename === 'first.png'),
    JSON.stringify(afterDelete.map((image) => image.filename))
  );
  check('the deleted image sidecar is gone too', (await localGallery.getLocalImage('wide.png')) === null);
  const missingDelete = await localGallery.deleteLocalImage('never-existed.png');
  check('deleting an unknown filename is a no-op, not an error', missingDelete.ok === true && missingDelete.removed === 0);
}

// --- 2: importing from the SD-card folder ----------------------------------
async function checkImport() {
  console.log('\nSD-card import');
  resetDevice();
  storage.clear();
  setSafFiles([]);

  const noFolder = await localGallery.importFromFolder();
  check(
    'no folder chosen -> { ok:false } with a no-folder reason',
    noFolder.ok === false && noFolder.reason === 'no-folder' && noFolder.imported === 0,
    JSON.stringify(noFolder)
  );

  setFolderChosen();

  safListError = new Error('Permission denied');
  const revoked = await localGallery.importFromFolder();
  check(
    'revoked folder access -> { ok:false } and never throws',
    revoked.ok === false && revoked.reason === 'unreadable' && revoked.failed === 0,
    JSON.stringify(revoked)
  );

  setSafFiles([]);
  const emptyFolder = await localGallery.importFromFolder();
  check(
    'an empty folder -> ok with zero imported',
    emptyFolder.ok === true && emptyFolder.imported === 0 && emptyFolder.reason === 'empty',
    JSON.stringify(emptyFolder)
  );

  setSafFiles([
    { uri: 'content://tree/sunset/document/sunset%2Fnotes.txt', name: 'notes.txt', size: 10, base64: b64(10) },
    { uri: 'content://tree/sunset/document/sunset%2Fsubdir', name: 'subdir', size: 0, base64: '' },
  ]);
  const nonImages = await localGallery.importFromFolder();
  check(
    'non-image files (and folders) are skipped without throwing',
    nonImages.ok === true && nonImages.imported === 0 && nonImages.skipped === 2 && nonImages.failed === 0,
    JSON.stringify(nonImages)
  );

  setSafFiles([
    { uri: 'content://tree/sunset/document/sunset%2Fsd-photo.jpg', name: 'sd-photo.jpg', size: 40, base64: b64(40) },
  ]);
  const imported = await localGallery.importFromFolder();
  const afterImport = await localGallery.listLocalImages();
  const importedEntry = afterImport.find((image) => image.filename === 'sd-photo.jpg');
  check(
    'a new image is copied into the store and marked as imported',
    imported.ok === true &&
      imported.imported === 1 &&
      !!importedEntry &&
      importedEntry.source === 'imported' &&
      importedEntry.size === 40,
    JSON.stringify({ imported, importedEntry })
  );

  const reimport = await localGallery.importFromFolder();
  check(
    're-importing the same name+size is skipped',
    reimport.imported === 0 && reimport.skipped === 1 && reimport.failed === 0,
    JSON.stringify(reimport)
  );

  setSafFiles([
    { uri: 'content://tree/sunset/document/sunset%2Fsd-photo.jpg', name: 'sd-photo.jpg', size: 99, base64: b64(99) },
  ]);
  const renamed = await localGallery.importFromFolder();
  const afterRename = await localGallery.listLocalImages();
  check(
    'the same name at a different size imports under a free name',
    renamed.imported === 1 && afterRename.some((image) => image.filename === 'sd-photo-1.jpg'),
    JSON.stringify(afterRename.map((image) => image.filename))
  );

  setSafFiles([
    { uri: 'content://tree/sunset/document/sunset%2Fcap-a.jpg', name: 'cap-a.jpg', size: 11, base64: b64(11) },
    { uri: 'content://tree/sunset/document/sunset%2Fcap-b.jpg', name: 'cap-b.jpg', size: 12, base64: b64(12) },
    { uri: 'content://tree/sunset/document/sunset%2Fcap-c.jpg', name: 'cap-c.jpg', size: 13, base64: b64(13) },
  ]);
  const capped = await localGallery.importFromFolder({ max: 2 });
  check(
    'the per-run cap limits how many images are imported',
    capped.imported === 2,
    JSON.stringify(capped)
  );

  setSafFiles([
    { uri: 'content://tree/sunset/document/sunset%2Fbad.jpg', name: 'bad.jpg', size: 5, base64: b64(5), readError: true },
    { uri: 'content://tree/sunset/document/sunset%2Fgood.jpg', name: 'good.jpg', size: 6, base64: b64(6) },
  ]);
  const partial = await localGallery.importFromFolder();
  check(
    'one unreadable file is counted as failed and the rest still import',
    partial.ok === true && partial.failed === 1 && partial.imported === 1,
    JSON.stringify(partial)
  );

  check(
    'describeImport phrases the outcome for the UI',
    /Imported 1 image/.test(localGallery.describeImport(partial)) &&
      /Nothing new to import/.test(localGallery.describeImport(reimport)),
    `${localGallery.describeImport(partial)} | ${localGallery.describeImport(reimport)}`
  );
}

// --- 3: gallery source setting ---------------------------------------------
async function checkSource() {
  console.log('\nGallery source setting');
  storage.clear();

  const fresh = await gallerySource.getGallerySource();
  check("a fresh install defaults to 'phone'", fresh === gallerySource.PHONE, fresh);
  check('the default is persisted', storage.get(gallerySource.GALLERY_SOURCE_KEY) === gallerySource.PHONE);
  check('a fresh install has no migration notice', (await gallerySource.takeGallerySourceNotice()) === null);

  const saved = await gallerySource.setGallerySource(gallerySource.SERVER);
  check("setGallerySource persists 'server'", saved === gallerySource.SERVER && (await gallerySource.getGallerySource()) === gallerySource.SERVER);
  const junk = await gallerySource.setGallerySource('nonsense');
  check('an unknown source is ignored (the stored choice wins)', junk === gallerySource.SERVER && (await gallerySource.getGallerySource()) === gallerySource.SERVER);

  // Upgrading an install that predates the setting.
  storage.clear();
  storage.set('@frogpaper/gallery_cache', JSON.stringify({ images: [{ filename: 'old.png' }] }));
  const migrated = await gallerySource.getGallerySource();
  const notice = await gallerySource.takeGallerySourceNotice();
  const noticeAgain = await gallerySource.takeGallerySourceNotice();
  check("an existing install is migrated to 'phone'", migrated === gallerySource.PHONE, migrated);
  check('the migration notice is available once', typeof notice === 'string' && notice.length > 20, String(notice));
  check('the migration notice is gone after it is taken', noticeAgain === null);
  check('the notice is not re-armed on the next read', (await (async () => {
    await gallerySource.getGallerySource();
    return gallerySource.takeGallerySourceNotice();
  })()) === null);

  // A fresh install must NOT get the notice.
  storage.clear();
  await gallerySource.getGallerySource();
  check('a fresh install still gets no notice', (await gallerySource.takeGallerySourceNotice()) === null);
}

(async () => {
  try {
    await checkStore();
    await checkImport();
    await checkSource();
  } catch (err) {
    failures += 1;
    console.log(`${FAIL} unexpected error: ${err && err.stack ? err.stack : err}`);
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
