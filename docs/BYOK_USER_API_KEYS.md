# Bring Your Own Keys (BYOK)

**Status**: COMPLETED
**Date**: 2026-09-11
**Mimics**: FrogPaper desktop behavior — every user supplies their own API keys.

## Summary

FrogPaper Mobile's backend no longer ships with built-in API keys for Google Gemini,
Hugging Face, or Replicate. Each user pastes their **own** free (or paid) API keys
into the app's Settings screen, the keys live on **their phone only**, and the app
forwards each key to the backend with each generate request. The backend uses the
user's key for that one request, never logs it, never saves it.

This matches the original FrogPaper desktop app, where every user typed their own
keys into the program and the developer never shared theirs.

## Why

The owner of the FrogPaper server **never** shares their personal API keys. Each
user's quota stays theirs. Strangers installing from Google Play bring their own
keys; the server owner pays nothing for their AI calls.

## Files Modified

| File | Change |
|------|--------|
| `backend/services/image_generation.py` | `generate_image_gemini`, `generate_image_huggingface`, `generate_image_replicate` each accept an optional `user_api_key` / `user_api_token` parameter. When present, it overrides any server-side key. The `PROVIDERS` list now exposes `byok_supported`, `byok_header`, and `byok_hint` so the app can render the right UI. |
| `backend/app.py` | Added `_read_user_key()` helper — the single place user keys are touched. `POST /api/generate` reads `X-Gemini-Key`, `X-Hf-Token`, `X-Replicate-Token` from headers and passes them to the provider functions. The log line shows only `"byok=gemini,huggingface"` (provider names, never the keys themselves). |
| `mobile-app/src/services/api.js` | Added `setGeminiKey` / `getGeminiKey`, `setHfToken` / `getHfToken`, `setReplicateToken` / `getReplicateToken`, all backed by AsyncStorage and an in-memory cache. The `request()` function attaches all three keys as headers on every API call when present. |
| `mobile-app/src/screens/SettingsScreen.js` | New "Your API keys" section below the existing Access key section. Three masked inputs (`secureTextEntry`), each with Save + Clear buttons, a status row showing which keys are saved, and a hint linking to where users get free keys. |

## How It Works

### From the user's perspective

1. They install FrogPaper Mobile.
2. They open Settings → scroll to **"Your API keys"**.
3. They paste one or more of:
   - Google Gemini key (from `aistudio.google.com/apikey` — starts with `AQ` or `AIza`)
   - Hugging Face token (from `huggingface.co/settings/tokens` — starts with `hf_`)
   - Replicate token (from `replicate.com/accounts` — starts with `r8_`, paid)
4. They tap Save for each one they want to use.
5. They go to Generate and pick a painter. If they picked Gemini, the app sends
   their Gemini key with the request. The backend uses it instead of any default.
6. **If they didn't save a key for the painter they picked**: the backend tries
   the server's env-var key (if any), then falls back to Pollinations (free,
   no key needed).

### From the server's perspective

1. The owner **does not** set `GEMINI_API_KEY`, `HF_TOKEN`, or `REPLICATE_API_TOKEN`
   as environment variables on Render. (Or sets them to empty.)
2. The server still receives every `/api/generate` call.
3. It reads the user-supplied key from the appropriate header.
4. It passes the key to the provider function for **that one request**.
5. It **never** writes the key to disk, **never** logs it, **never** echoes it
   in error messages.
6. After the request finishes, the key is forgotten.

### The security model

- The user's keys live only on their phone (AsyncStorage, sandboxed per-app).
- They are transmitted to the backend only over HTTPS (Render's default).
- They are never persisted on the server.
- They are never written to logs — the backend only logs "user-supplied" or
  "BYOK:gemini" style status words.
- They are never echoed in error responses.
- The `PROVIDERS` JSON response only tells the app **which providers support
  BYOK** and **which header name** to use — it never reveals any user's key.

### Backward compatibility

If the server owner leaves their `GEMINI_API_KEY`, `HF_TOKEN`, or
`REPLICATE_API_TOKEN` env vars set, the server keeps using them as before —
but each user's own key takes priority when supplied. This means:

- **Development**: owner has their own keys on Render for testing — fine.
- **Production**: owner removes the env vars; every user must paste their own.

## Setup Steps for Users

### Google Gemini (free, ~1,500 images/day)

1. Go to https://aistudio.google.com/apikey
2. Sign in with any Google account.
3. Click **Create API key**.
4. Copy the key (starts with `AQ` since mid-2026; older `AIza` keys still work).
5. In FrogPaper: Settings → Your API keys → Google Gemini key → paste → Save.

### Hugging Face (free monthly credit)

1. Go to https://huggingface.co/settings/tokens
2. Sign up if needed (free, email confirmation).
3. Click **New token**.
4. Name: `frogpaper` (any name). Type: **Read**.
5. Click **Create**. Copy the token (starts with `hf_`).
6. In FrogPaper: Settings → Your API keys → Hugging Face token → paste → Save.

### Replicate (paid, ~$0.003–$0.025 per picture)

1. Go to https://replicate.com
2. Sign up, add a credit card (this is the only paid painter).
3. Go to https://replicate.com/accounts
4. Click **Create token**. Copy it (starts with `r8_`).
5. In FrogPaper: Settings → Your API keys → Replicate token → paste → Save.

## Verification

After saving a key:

1. Go to Generate.
2. Pick the matching painter (Gemini / Hugging Face / Replicate).
3. Type a prompt, tap Generate.
4. Within ~30 seconds you should have a wallpaper.
5. If you see an error like *"No Gemini API key..."*, your key wasn't saved —
   go back to Settings and try again.

## Server-side setup (developer only)

To **force BYOK mode** (no server-side keys, every user must paste their own):

1. Render dashboard → Environment.
2. **Delete** (or leave empty) these variables:
   - `GEMINI_API_KEY`
   - `HF_TOKEN`
   - `REPLICATE_API_TOKEN`
3. Save. Render redeploys.
4. From now on, the `PROVIDERS` list will report `status: inactive` for all
   three paid providers, and `/api/generate` will fail for any user who
   didn't paste their own key (with a friendly error message asking them
   to do so). Pollinations still works (free, no key).

## Future Improvements

- **Per-painter status row**: the Settings → AI provider section could show
  whether each painter currently has a user key saved (on this phone), in
  addition to the server's status.
- **Quota display**: parse each provider's quota response and show
  remaining daily credits next to the key field.
- **Engine picker**: today the app picks the painter for the user. A small
  Generate-screen dropdown would let users choose Gemini / HF / Replicate /
  Pollinations explicitly.
