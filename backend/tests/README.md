# Backend tests

Portable, no pytest needed - plain python:

    python backend/tests/test_provider_chain.py   # 17 checks, no real token needed
    python backend/tests/test_wallpaper_fit.py    # 14 checks + optional LIVE paid render

The LIVE section in test_wallpaper_fit.py runs only when a real Replicate
token exists in REPLICATE_API_TOKEN or backend/replicate_api_token.txt.
Never commit token files - they are gitignored on purpose.
