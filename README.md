# FrogPaper Mobile

AI wallpaper studio: an Expo (React Native) app that talks to a small Flask
backend, which generates phone wallpapers via Pollinations.ai (Flux model,
no API key required).

```
+----------------+       HTTP        +------------------+      HTTPS      +-----------------+
|   mobile-app   |  <------------->  |     backend      | <-------------> |  pollinations.ai |
|  Expo / RN web |  /api/* (JSON)    |  Flask :5000     |  image prompt   |   Flux model     |
|  Android, iOS  |                   |  static/images/  |  <--- jpeg ---  |                  |
+----------------+                   +------------------+                 +-----------------+
```

## Repository structure

```
FrogPaperMobile/
|-- backend/                  Flask API (port 5000)
|   |-- app.py                All routes + JSON error handling + CORS
|   |-- services/
|   |   `-- image_generation.py   Pollinations provider + gallery listing
|   |-- static/images/        Generated wallpapers live here (add your own)
|   |-- requirements.txt
|   `-- test_generation.py    Standalone generation test (no HTTP needed)
|-- mobile-app/               Expo app (SDK 57, RN 0.86)
|   |-- App.js                Entry: theme + navigation container
|   `-- src/
|       |-- navigation/AppNavigator.js   Stack: Home / Generate / Gallery / Settings
|       |-- screens/          Home, Generate, Gallery, Detail, Settings screens
|       |-- services/api.js   API layer with automatic backend URL resolution
|       |-- services/deviceMedia.*.js  Save-to-device + wallpaper (per-platform)
|       `-- theme.js          Dark theme tokens (frog-green accent)
`-- docs/                     API reference, handover notes, screenshots
```

## Quick start (Windows)

### 1. Backend

```powershell
cd E:\FROGPAPER\FrogPaperMobile\backend
python -m venv venv                # first time only
.\venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

The API is now on `http://127.0.0.1:5000` and reachable on your LAN at
`http://<your-ip>:5000` (host is `0.0.0.0`).

### 2. Mobile app

```powershell
cd E:\FROGPAPER\FrogPaperMobile\mobile-app
npm install                        # first time only
npx expo start --web               # web test at http://localhost:8081
```

- **Web**: opens automatically, connects to `http://localhost:5000`.
- **Android emulator**: press `a` in the Expo terminal. The app tries
  `http://10.0.2.2:5000` automatically (emulator alias for your PC).
- **Physical phone**: install Expo Go, scan the QR code (same Wi-Fi as your
  PC). The app tries your LAN IP automatically.

## Where your wallpapers live

`backend/static/images/`. Every generated image is saved there with a
timestamped filename (`pollinations_YYYYMMDD-HHMMSS.jpg`). If you already
have a local collection (for example 82 existing images), copy the files
into this folder - the gallery serves everything it finds there, no
database, no migration.

## Configuration

| What | Where | Default |
|------|-------|---------|
| Backend port | `PORT` env var in `backend/app.py` | `5000` |
| LAN IP of your PC | auto-detected from Expo Go (`expoConfig.hostUri`); manual fallback `LAN_IP` in `mobile-app/src/services/api.js` | automatic / `10.2.0.2` |
| Emulator alias | `EMULATOR_ALIAS` in the same file | `10.0.2.2` |
| Image size presets | `SIZE_PRESETS` in `GenerateScreen.js` | 1080x1920 etc. |

Note: Pollinations' Flux model buckets requested resolutions - a 1080x1920
request currently comes back as 576x1024. The real size is always reported
in the API response and under the preview in the app.

## Verification status (tested live 2026-09-10)

| Check | Result |
|-------|--------|
| `GET /api/health` | PASS |
| Input validation (short prompt -> JSON 400) | PASS |
| `POST /api/generate` (real Pollinations call) | PASS - image saved |
| `GET /api/gallery` listing + metadata | PASS |
| Web bundle compiles (`expo export`) | PASS |
| Headless-browser click-through of all 4 screens | PASS |
| In-app UI generation (prompt -> result card) | PASS |
| Gallery updates after generation | PASS |

Proof screenshots: `docs/screenshots/`.

## Troubleshooting

**App says "Backend offline"**
- Is the backend terminal still running `python app.py`?
- Web client needs the backend on `http://localhost:5000` - check
  `http://127.0.0.1:5000/api/health` in your browser first.
- Phone on Wi-Fi: the app auto-detects your PC's IP from the Expo Go dev
  server (same Wi-Fi required). If it still shows offline, set `LAN_IP` in
  `mobile-app/src/services/api.js` to your PC's IPv4 (`ipconfig`), and make
  sure Windows Firewall allows Python on private networks (first run asks).

**Expo dev server starts but the page never loads**
- Stop it (`Ctrl+C`) and restart with a clean cache: `npx expo start --clear`
- Port 8081 busy? `npx expo start --web --port 8082`
- Delete the app cache folders: `.expo/` and `node_modules/.cache/`, then
  `npm install` again.

**Generation returns HTTP 502**
- Pollinations is a free community service; it occasionally rate-limits or
  times out. The backend retries 3 times with backoff - try again in a
  minute.

## Documentation

- `docs/BACKEND_COMPLETE.md` - full API reference with examples
- `docs/HANDOVER_2026-09-10.md` - what was rebuilt, tested and why
