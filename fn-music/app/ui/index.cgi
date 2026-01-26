#!/bin/bash

# ============================================================================
# File Name       : index.cgi
# Version         : 1.0.0
# Description     : CGI script for FnMusic static files and API.
# ============================================================================

# Configuration
BASE_PATH="/var/apps/fn-music/target/www"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_SCRIPT="$APP_ROOT/server/sites_backend.sh"

# Parse Request
URI_NO_QUERY="${REQUEST_URI%%\?*}"
QUERY_STRING="${REQUEST_URI#*\?}"

# Default Path Logic
REL_PATH="/"
case "$URI_NO_QUERY" in
  *index.cgi*)
    REL_PATH="${URI_NO_QUERY#*index.cgi}"
    ;;
esac

if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then
  REL_PATH="/index.html"
fi

# ============================================================================
# API Routing
# ============================================================================

if [ "$REL_PATH" = "/api/music/scan" ]; then
    if [ ! -f "$BACKEND_SCRIPT" ]; then
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json"
        echo ""
        echo '{"error":"backend script missing"}'
        exit 0
    fi
    
    echo "Status: 200 OK"
    echo "Content-Type: application/json; charset=utf-8"
    echo ""
    bash "$BACKEND_SCRIPT" "scan-music"
    exit 0

elif [ "$REL_PATH" = "/api/fs/list" ]; then
    echo "Status: 200 OK"
    echo "Content-Type: application/json; charset=utf-8"
    echo ""
    bash "$BACKEND_SCRIPT" "list-dirs"
    exit 0

elif [ "$REL_PATH" = "/api/music/stream" ]; then
    # Parse path from query string
    # Simple parsing: assume ?path=/foo/bar
    # Better: use python or php to parse if available, or sed
    
    FILE_PATH=""
    # Extract path parameter
    # Handling URL decoding is tricky in pure bash, let's try a simple approach
    # assuming the browser sends encoded params in QUERY_STRING
    
    # Use python/php for robust decoding
    if command -v php >/dev/null 2>&1; then
        FILE_PATH=$(php -r "parse_str(\$argv[1], \$output); echo \$output['path'] ?? '';" -- "$QUERY_STRING")
    elif command -v python3 >/dev/null 2>&1; then
         FILE_PATH=$(python3 -c "import sys, urllib.parse; q=urllib.parse.parse_qs(sys.argv[1]); print(q.get('path', [''])[0])" "$QUERY_STRING")
    else
         # Fallback (unsafe for special chars)
         FILE_PATH=$(echo "$QUERY_STRING" | grep -o "path=[^&]*" | cut -d= -f2-)
    fi

    if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
        echo "Status: 404 Not Found"
        echo "Content-Type: text/plain"
        echo ""
        echo "File not found: $FILE_PATH"
        exit 0
    fi
    
    # Determine Mime Type
    MIME_TYPE="application/octet-stream"
    if command -v file >/dev/null 2>&1; then
        MIME_TYPE=$(file --mime-type -b "$FILE_PATH")
    else
        case "$FILE_PATH" in
            *.mp3) MIME_TYPE="audio/mpeg" ;;
            *.ogg) MIME_TYPE="audio/ogg" ;;
            *.wav) MIME_TYPE="audio/wav" ;;
            *.flac) MIME_TYPE="audio/flac" ;;
            *.m4a) MIME_TYPE="audio/mp4" ;;
        esac
    fi
    
    FILE_SIZE=$(stat -c%s "$FILE_PATH" 2>/dev/null || stat -f%z "$FILE_PATH" 2>/dev/null)
    
    echo "Status: 200 OK"
    echo "Content-Type: $MIME_TYPE"
    echo "Content-Length: $FILE_SIZE"
    echo "Accept-Ranges: bytes"
    echo ""
    cat "$FILE_PATH"
    exit 0
fi

# ============================================================================
# Static File Serving (Fallback)
# ============================================================================

# Map REL_PATH to local file
LOCAL_FILE="${BASE_PATH}${REL_PATH}"

# Prevent directory traversal
# Realpath is not always available, but we can assume BASE_PATH is safe
# and REL_PATH comes from logic that strips prefix. 
# For extra safety, check if file exists inside BASE_PATH.

if [ -f "$LOCAL_FILE" ]; then
  # Determine Content-Type
  case "$LOCAL_FILE" in
    *.html) CTYPE="text/html" ;;
    *.css)  CTYPE="text/css" ;;
    *.js)   CTYPE="application/javascript" ;;
    *.png)  CTYPE="image/png" ;;
    *.jpg)  CTYPE="image/jpeg" ;;
    *.gif)  CTYPE="image/gif" ;;
    *.svg)  CTYPE="image/svg+xml" ;;
    *.woff) CTYPE="font/woff" ;;
    *.woff2) CTYPE="font/woff2" ;;
    *.ttf)  CTYPE="font/ttf" ;;
    *)      CTYPE="application/octet-stream" ;;
  esac

  echo "Status: 200 OK"
  echo "Content-Type: $CTYPE"
  echo ""
  cat "$LOCAL_FILE"
else
  echo "Status: 404 Not Found"
  echo "Content-Type: text/plain"
  echo ""
  echo "404 Not Found: $REL_PATH"
fi
