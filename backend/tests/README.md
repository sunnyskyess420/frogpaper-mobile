# Backend tests

Portable, no pytest needed - plain python:

    python backend/tests/test_provider_chain.py   # 17 checks, no real token needed
    python backend/tests/test_wallpaper_fit.py    # 14 checks + optional LIVE paid render
    python backend/tests/test_storage.py          # 131 checks: local + S3 storage, routes

The LIVE section in test_wallpaper_fit.py runs only when a real Replicate
token exists in REPLICATE_API_TOKEN or backend/replicate_api_token.txt.
Never commit token files - they are gitignored on purpose.

test_storage.py works entirely inside temp directories. Its S3 sections need
`moto` (a test-only dependency - install it in a throwaway venv, never in the
repo); without moto those sections are skipped with a clear message instead
of silently passing.

    python -m venv %TEMP%\frogpaper-venv
    %TEMP%\frogpaper-venv\Scripts\pip install -r backend/requirements.txt moto

The two older scripts exercise `/api/*` through Flask's test client, so an
armed access key (`backend/access_key.txt` or FROGPAPER_ACCESS_KEY) makes
them fail with 401. Either move the key file aside while they run, or export
FROGPAPER_ACCESS_KEY and keep the file deleted. test_storage.py sets its own
test key and is unaffected.
