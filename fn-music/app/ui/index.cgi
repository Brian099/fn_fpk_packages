#!/bin/bash

# ============================================================================
# File Name       : index.cgi
# Version         : 1.0.1
# Description     : CGI script for Waves static files and API.
# ============================================================================

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Persistent path detection for FnOS
PERSISTENT_BASE="/var/apps/waves"
if [ -d "$PERSISTENT_BASE" ]; then
    CONFIG_DIR="$PERSISTENT_BASE/home"
else
    # Fallback to app-local config directory
    CONFIG_DIR="$APP_ROOT/home"
fi
CONFIG_FILE="$CONFIG_DIR/config.json"
BASE_PATH="$APP_ROOT/www"
BACKEND_SCRIPT="$APP_ROOT/server/sites_backend.sh"

# Parse Request
URI_NO_QUERY="${REQUEST_URI%%\?*}"
QUERY_STRING="${REQUEST_URI#*\?}"

# Default Path Logic
REL_PATH="/"

# Priority 1: Check for api_route in query string (for avoiding 404 on some servers)
API_ROUTE=$(echo "$QUERY_STRING" | sed -n 's/.*api_route=\([^&]*\).*/\1/p')
if [ -n "$API_ROUTE" ]; then
    # Simple URL decode for / (%2F)
    REL_PATH=$(echo "$API_ROUTE" | sed 's/%2F/\//g')
else
    # Priority 2: Fallback to PATH_INFO style routing
    case "$URI_NO_QUERY" in
      *index.cgi*)
        REL_PATH="${URI_NO_QUERY#*index.cgi}"
        ;;
    esac
fi

if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then
  REL_PATH="/index.html"
fi

# Prepare Temporary Input File
INPUT_TMP=$(mktemp 2>/dev/null || mktemp -t waves.XXXXXX 2>/dev/null || echo "/tmp/waves_input_$RANDOM")
touch "$INPUT_TMP"

# Only capture standard input for POST/PUT requests to prevent blocking on GET
if [ "$REQUEST_METHOD" = "POST" ] || [ "$REQUEST_METHOD" = "PUT" ]; then
    # Use dd or cat with timeout if needed, but simple cat is usually fine IF method is POST
    cat > "$INPUT_TMP"
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
        rm -f "$INPUT_TMP"
        exit 0
    fi
    
    TMP_OUTPUT=$(mktemp)
    # Pass input to backend
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "scan-music" >"$TMP_OUTPUT" 2>/dev/null; then
        if [ -s "$TMP_OUTPUT" ]; then
            echo "Status: 200 OK"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            cat "$TMP_OUTPUT"
        else
            echo "Status: 200 OK"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            echo '{"ok":false,"error":"Empty response from scanner"}'
        fi
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Internal script error"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/config/get" ]; then
    # Get Config
    TMP_OUTPUT=$(mktemp)
    if bash "$BACKEND_SCRIPT" "get-config" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to read config"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/library/get" ]; then
    TMP_OUTPUT=$(mktemp)
    if bash "$BACKEND_SCRIPT" "get-library" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to get library"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/library/save" ]; then
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "save-library" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to save library"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/config/save" ]; then
    # Save Config
    TMP_OUTPUT=$(mktemp)
    STDERR_TMP=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "save-config" >"$TMP_OUTPUT" 2>"$STDERR_TMP"; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        ERR_MSG=$(cat "$STDERR_TMP" | tr '\n' ' ' | sed 's/"/\\"/g')
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo "{\"ok\":false,\"error\":\"Failed to save config. Script error: $ERR_MSG\"}"
    fi
    rm -f "$STDERR_TMP"
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/scan-fast" ]; then
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "scan-fast" >"$TMP_OUTPUT" 2>/dev/null; then
        if [ -s "$TMP_OUTPUT" ]; then
            echo "Status: 200 OK"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            cat "$TMP_OUTPUT"
        else
            echo "Status: 200 OK"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            echo '{"ok":false,"error":"Empty response from fast scanner"}'
        fi
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Internal script error"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/meta-batch" ]; then
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "get-meta-batch" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Internal script error"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/artist/search" ]; then
    # Search Artist Image
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "search-artist" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to search artist"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/fs/list" ]; then
    TMP_OUTPUT=$(mktemp)
    # Pass input to backend
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "list-dirs" >"$TMP_OUTPUT" 2>/dev/null; then
        if [ -s "$TMP_OUTPUT" ]; then
            echo "Status: 200 OK"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            cat "$TMP_OUTPUT"
        else
            echo "Status: 200 OK"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            echo '{"ok":false,"error":"Empty response from directory lister"}'
        fi
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Internal script error"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0



elif [ "$REL_PATH" = "/api/music/stream" ]; then
    # Parse path from query string
    FILE_PATH=""
    
    # Use python/php for robust decoding if available
    if command -v php >/dev/null 2>&1; then
        FILE_PATH=$(php -r "parse_str(\$argv[1], \$output); echo \$output['path'] ?? '';" -- "$QUERY_STRING")
    elif command -v python3 >/dev/null 2>&1; then
         FILE_PATH=$(python3 -c "import sys, urllib.parse; q=urllib.parse.parse_qs(sys.argv[1]); print(q.get('path', [''])[0])" "$QUERY_STRING")
    else
         # Fallback (unsafe for special chars)
         FILE_PATH=$(echo "$QUERY_STRING" | grep -o "path=[^&]*" | cut -d= -f2-)
         # Basic URL decode for fallback
         FILE_PATH=$(echo "$FILE_PATH" | sed -e 's/%/\\x/g' -e 's/+/ /g')
         FILE_PATH=$(echo -e "$FILE_PATH")
    fi

    if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
        echo "Status: 404 Not Found"
        echo "Content-Type: text/plain"
        echo ""
        echo "File not found: $FILE_PATH"
        rm -f "$INPUT_TMP"
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
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/cover" ]; then
    # Parse path from query string
    FILE_PATH=""
    if command -v php >/dev/null 2>&1; then
        FILE_PATH=$(php -r "parse_str(\$argv[1], \$output); echo \$output['path'] ?? '';" -- "$QUERY_STRING")
    elif command -v python3 >/dev/null 2>&1; then
         FILE_PATH=$(python3 -c "import sys, urllib.parse; q=urllib.parse.parse_qs(sys.argv[1]); print(q.get('path', [''])[0])" "$QUERY_STRING")
    else
         FILE_PATH=$(echo "$QUERY_STRING" | grep -o "path=[^&]*" | cut -d= -f2-)
         FILE_PATH=$(echo "$FILE_PATH" | sed -e 's/%/\\x/g' -e 's/+/ /g')
         FILE_PATH=$(echo -e "$FILE_PATH")
    fi

    if [ -z "$FILE_PATH" ]; then
         echo "Status: 400 Bad Request"
         echo "Content-Type: text/plain"
         echo ""
         echo "Missing path parameter"
         exit 0
    fi

    # Write path to temp input for backend
    echo -n "$FILE_PATH" > "$INPUT_TMP"
    
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "get-cover" >"$TMP_OUTPUT" 2>/dev/null; then
        if [ -s "$TMP_OUTPUT" ]; then
            echo "Status: 200 OK"
            echo "Content-Type: image/jpeg"
            echo ""
            cat "$TMP_OUTPUT"
        else
            echo "Status: 404 Not Found"
            echo "Content-Type: text/plain"
            echo ""
            echo "Cover not found"
        fi
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json"
        echo ""
        echo '{"error":"Internal script error"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/lyrics" ]; then
    # Parse path from query string
    FILE_PATH=""
    if command -v php >/dev/null 2>&1; then
        FILE_PATH=$(php -r "parse_str(\$argv[1], \$output); echo \$output['path'] ?? '';" -- "$QUERY_STRING")
    elif command -v python3 >/dev/null 2>&1; then
         FILE_PATH=$(python3 -c "import sys, urllib.parse; q=urllib.parse.parse_qs(sys.argv[1]); print(q.get('path', [''])[0])" "$QUERY_STRING")
    else
         FILE_PATH=$(echo "$QUERY_STRING" | grep -o "path=[^&]*" | cut -d= -f2-)
         FILE_PATH=$(echo "$FILE_PATH" | sed -e 's/%/\\x/g' -e 's/+/ /g')
         FILE_PATH=$(echo -e "$FILE_PATH")
    fi

    if [ -z "$FILE_PATH" ]; then
         echo "Status: 400 Bad Request"
         echo "Content-Type: text/plain"
         echo ""
         echo "Missing path parameter"
         exit 0
    fi

    # Write path to temp input for backend
    echo -n "$FILE_PATH" > "$INPUT_TMP"
    
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "get-lyrics" >"$TMP_OUTPUT" 2>/dev/null; then
        if [ -s "$TMP_OUTPUT" ]; then
            echo "Status: 200 OK"
            echo "Content-Type: text/plain; charset=utf-8"
            echo ""
            cat "$TMP_OUTPUT"
        else
            echo "Status: 404 Not Found"
            echo "Content-Type: text/plain"
            echo ""
            echo "Lyrics not found"
        fi
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json"
        echo ""
        echo '{"error":"Internal script error"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0
fi

if [ "$REL_PATH" = "/api/music/playlist/list" ]; then
    TMP_OUTPUT=$(mktemp)
    if bash "$BACKEND_SCRIPT" "list-playlists" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to list playlists"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/playlist/save" ]; then
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "save-playlist" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to save playlist"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/playlist/get" ]; then
    # Parse name from query string
    PL_NAME=""
    if command -v python3 >/dev/null 2>&1; then
         PL_NAME=$(python3 -c "import sys, urllib.parse; q=urllib.parse.parse_qs(sys.argv[1]); print(q.get('name', [''])[0])" "$QUERY_STRING")
    else
         PL_NAME=$(echo "$QUERY_STRING" | grep -o "name=[^&]*" | cut -d= -f2-)
         PL_NAME=$(echo "$PL_NAME" | sed -e 's/%/\\x/g' -e 's/+/ /g')
         PL_NAME=$(echo -e "$PL_NAME")
    fi
    
    echo -n "$PL_NAME" > "$INPUT_TMP"
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "get-playlist" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to get playlist"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0

elif [ "$REL_PATH" = "/api/music/playlist/delete" ]; then
    PL_NAME=""
    if command -v python3 >/dev/null 2>&1; then
         PL_NAME=$(python3 -c "import sys, urllib.parse; q=urllib.parse.parse_qs(sys.argv[1]); print(q.get('name', [''])[0])" "$QUERY_STRING")
    else
         PL_NAME=$(echo "$QUERY_STRING" | grep -o "name=[^&]*" | cut -d= -f2-)
         PL_NAME=$(echo "$PL_NAME" | sed -e 's/%/\\x/g' -e 's/+/ /g')
         PL_NAME=$(echo -e "$PL_NAME")
    fi

    echo -n "$PL_NAME" > "$INPUT_TMP"
    TMP_OUTPUT=$(mktemp)
    if cat "$INPUT_TMP" | bash "$BACKEND_SCRIPT" "delete-playlist" >"$TMP_OUTPUT" 2>/dev/null; then
        echo "Status: 200 OK"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        cat "$TMP_OUTPUT"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json; charset=utf-8"
        echo ""
        echo '{"ok":false,"error":"Failed to delete playlist"}'
    fi
    rm -f "$TMP_OUTPUT"
    rm -f "$INPUT_TMP"
    exit 0
fi

rm -f "$INPUT_TMP"

# ============================================================================
# Static File Serving (Fallback)
# ============================================================================

# Map REL_PATH to local file
LOCAL_FILE="${BASE_PATH}${REL_PATH}"

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
