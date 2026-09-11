// Platform entrypoint: web browser.
//
// - save to device: fetch the image, then trigger a download through a
//   temporary object-URL anchor (works in all modern browsers; the backend
//   already sends CORS headers on /api/*).
// - set wallpaper: not possible from a browser - explain and stop.
export async function saveToDevice(remoteUrl) {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileNameFrom(remoteUrl);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 8000);
  return { ok: true };
}

function fileNameFrom(url) {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').pop() || '';
    return decodeURIComponent(lastSegment) || 'frogpaper-wallpaper.jpg';
  } catch (error) {
    return 'frogpaper-wallpaper.jpg';
  }
}

export async function setAsWallpaper(_remoteUrl) {
  return {
    ok: false,
    reason: 'unsupported',
    message:
      'Browsers cannot set wallpapers. The image was downloaded - set it from your device settings.',
  };
}

export const capabilities = {
  canSave: true,
  canSetWallpaper: false,
};
