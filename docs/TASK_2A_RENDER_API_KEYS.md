# Task 2a: Wake Gemini + Hugging Face - Render Configuration

This task requires adding API keys to the Render dashboard environment variables. No code changes are needed.

## Steps to Complete

### 1. Get Google Gemini API Key
1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with your Google account
3. Navigate to API keys section
4. Create a new API key (free tier available)
5. Copy the key (starts with "AQ." for new keys, "AIza" for older ones)

### 2. Get Hugging Face Token
1. Go to [huggingface.co](https://huggingface.co)
2. Sign in or create an account
3. Navigate to Settings → Access Tokens
4. Create a new token (free tier available)
5. Copy the token (starts with "hf_")

### 3. Add Keys to Render Dashboard
1. Log in to your [Render dashboard](https://dashboard.render.com)
2. Navigate to your FrogPaper backend service
3. Go to "Environment" section
4. Add the following environment variables:

**For Gemini:**
- Key: `GEMINI_API_KEY`
- Value: (paste your Gemini API key from step 1)

**For Hugging Face:**
- Key: `HF_TOKEN` (or `HUGGINGFACE_TOKEN`)
- Value: (paste your Hugging Face token from step 2)

**For Access Key (from Task 1):**
- Key: `FROGPAPER_ACCESS_KEY`
- Value: (your chosen shared secret key)

### 4. Verify
1. Save the environment variables
2. Render will automatically restart the backend service
3. Wait ~1-2 minutes for the service to restart
4. Open the FrogPaper mobile app
5. Go to Settings screen
6. Both Gemini and Hugging Face provider cards should show "status: active"

## Notes
- The backend code already supports reading these keys from environment variables
- No app rebuild is required - the provider status updates automatically
- The backend checks for these keys on every `/api/providers` request
- If keys are missing, providers show as "inactive" in the app
- Free tiers have usage limits but are sufficient for testing

## Troubleshooting
- If providers still show "inactive" after 2 minutes, check the Render logs for errors
- Ensure the keys don't have extra spaces or newlines
- Verify the key formats: Gemini (AQ.* or AIza*), Hugging Face (hf_*)
- Check that the environment variable names match exactly: `GEMINI_API_KEY` and `HF_TOKEN`
