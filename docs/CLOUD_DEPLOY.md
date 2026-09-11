# Cloud Deployment Guide

This guide shows you how to deploy the FrogPaper backend to the cloud so your phone app works from anywhere (not just on your home network).

## What You'll Need

- A free Render.com account (or similar cloud service)
- Your API tokens (Replicate, Hugging Face, Gemini - if you use them)
- About 10 minutes

## Step 1: Create a Render Account

1. Go to https://render.com
2. Click "Sign Up" in the top right
3. Sign up with GitHub, Google, or email
4. Verify your email address if asked

## Step 2: Create a New Web Service

1. After logging in, click "New +" in the top right
2. Select "Web Service"
3. Click "Connect GitHub repository" (or "Browse" if you don't use GitHub)
4. Select the `frogpaper-mobile` repository
5. Render will show you a configuration page

## Step 3: Configure the Service

Fill in these settings on the configuration page:

**Name:** `frogpaper-backend` (or any name you like)

**Branch:** `main`

**Runtime:** `Python`

**Build Command:** `pip install -r requirements.txt`

**Start Command:** `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 180`

## Step 4: Add Environment Variables

Scroll down to "Advanced" and click "Add Environment Variable". Add these one at a time:

1. **REPLICATE_API_TOKEN** - Your Replicate API token (starts with `r8_`)
   - Get this from https://replicate.com/account/api-tokens
   - Leave empty if you don't use Replicate

2. **HF_TOKEN** or **HUGGINGFACE_TOKEN** - Your Hugging Face token (starts with `hf_`)
   - Get this from https://huggingface.co/settings/tokens
   - Leave empty if you don't use Hugging Face

3. **GEMINI_API_KEY** - Your Gemini API key
   - Get this from https://makersuite.google.com/app/apikey
   - Leave empty if you don't use Gemini

**Important:** Don't use quotation marks around the tokens. Just paste the token itself.

## Step 5: Configure Disk Storage (Optional)

The gallery images are stored on disk. On Render's free tier, disk storage is ephemeral (files may be lost when the service restarts).

If you want persistent storage:
1. Scroll to "Disk"
2. Click "Add Disk"
3. Name: `data`
4. Mount path: `/app/static/images`
5. Size: 1 GB (free tier includes 1 GB)

If you skip this, images will still work but may disappear occasionally. See `docs/CLOUD_PERSISTENCE.md` for details.

## Step 6: Deploy

1. Click "Create Web Service" at the bottom
2. Wait for the build to complete (about 2-3 minutes)
3. You'll see a live URL like `https://frogpaper-backend.onrender.com`

## Step 7: Test Your Backend

1. Copy your backend URL (e.g., `https://frogpaper-backend.onrender.com`)
2. Open this in your browser: `https://frogpaper-backend.onrender.com/api/health`
3. You should see JSON response with `"status": "ok"`

## Step 8: Connect Your Phone App

1. Open the FrogPaper app on your phone
2. Go to the Settings screen
3. Find "Custom server address"
4. Paste your backend URL (e.g., `https://frogpaper-backend.onrender.com`)
5. Tap "Save URL"
6. Tap "Re-test connection"

You should see "Connected to backend" with a green dot.

## Important Notes

**Gallery Persistence:** Free cloud hosting has ephemeral storage. Your generated images may disappear when the service restarts. Use "Save to device" in the app to keep important wallpapers on your phone. See `docs/CLOUD_PERSISTENCE.md` for options.

**Costs:** Render's free tier is sufficient for testing. If you get heavy usage, you may need to upgrade to a paid plan.

**API Keys:** Your tokens are stored as environment variables in the cloud. They're safe as long as you don't share your Render account.

**Performance:** Free tier services may "sleep" when not used. The first request after sleep takes about 30 seconds to wake up.

## Troubleshooting

**Backend shows "unreachable":**
- Make sure you copied the full URL including `https://`
- Check that you saved the URL in Settings
- Try "Re-test connection" in Settings

**Generation fails:**
- Check your API tokens are correct in Render environment variables
- The provider fallback chain (Replicate → Hugging Face → Gemini → Pollinations) should still work even if some tokens are missing

**Images disappear:**
- This is normal on free cloud hosting due to ephemeral storage
- Use "Save to device" to keep wallpapers on your phone
- Consider upgrading to persistent storage if this happens often

## Alternative Cloud Services

This guide uses Render, but you can also deploy to:
- **Railway:** Similar to Render, has a free tier
- **Heroku:** No free tier anymore, but reliable
- **PythonAnywhere:** Good for Python apps, has free tier
- **Your own VPS:** DigitalOcean, Linode, etc. (requires more setup)

The Dockerfile in the `backend/` folder works with most Docker-based cloud services.