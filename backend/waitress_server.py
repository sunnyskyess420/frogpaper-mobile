"""
Waitress server for Windows development.
Gunicorn doesn't work on Windows (no fcntl module), so use waitress instead.
This is only for local Windows development - cloud deployment uses gunicorn (Linux).
"""
from waitress import serve
from app import app

if __name__ == '__main__':
    serve(app, host='0.0.0.0', port=5000, threads=4)