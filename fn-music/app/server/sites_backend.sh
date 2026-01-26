#!/bin/bash

# Utility: URL Decode
urldecode() {
    local url_encoded="${1//+/ }"
    printf '%b' "${url_encoded//%/\\x}"
}

# Music Scanning Function
scan_music_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input_path=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  else
    input_path=""
  fi
  
  target_path=$(echo "$input_path" | grep "^path=" | cut -d= -f2- | tr -d '\r')
  
  # Decode URL encoded path
  if [[ "$target_path" == *%* ]]; then
      if command -v php >/dev/null 2>&1; then
        target_path=$(php -r "echo rawurldecode(\$argv[1]);" -- "$target_path")
      elif command -v python3 >/dev/null 2>&1; then
        target_path=$(python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))" "$target_path")
      else
        target_path=$(urldecode "$target_path")
      fi
  fi

  if [ -z "$target_path" ] || [ ! -d "$target_path" ]; then
    echo '{"ok":false,"error":"Invalid directory"}'
    return 1
  fi

  echo '{"ok":true,"files":['
  
  # Find music files
  first=1
  
  find "$target_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.ogg" -o -iname "*.flac" -o -iname "*.m4a" \) 2>/dev/null | while read -r file; do
    if [ $first -eq 0 ]; then echo ','; fi
    first=0
    
    filename=$(basename "$file")
    filepath="$file"
    
    # Escape for JSON
    esc_name=$(echo "$filename" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_path=$(echo "$filepath" | sed 's/\\/\\\\/g; s/"/\\"/g')
    
    echo "{\"name\":\"$esc_name\",\"path\":\"$esc_path\"}"
  done > /tmp/fn_music_scan_tmp
  
  # Post-process to add commas
  awk 'NR > 1 { print "," } { print }' /tmp/fn_music_scan_tmp
  
  echo ']}'
  rm -f /tmp/fn_music_scan_tmp
}

list_dirs_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input_raw=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
    input_path=$(echo "$input_raw" | grep "^path=" | cut -d= -f2- | tr -d '\r')
    
    # Decode
    if [[ "$input_path" == *%* ]]; then
        if command -v php >/dev/null 2>&1; then
            input_path=$(php -r "echo rawurldecode(\$argv[1]);" -- "$input_path")
        elif command -v python3 >/dev/null 2>&1; then
            input_path=$(python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))" "$input_path")
        else
            input_path=$(urldecode "$input_path")
        fi
    fi
  else
    input_path="/"
  fi

  target_path="$input_path"
  if [ -z "$target_path" ]; then target_path="/"; fi
  
  if [ ! -d "$target_path" ]; then
    echo '{"ok":false,"error":"path not found"}'
    return 1
  fi
  
  parent_path=$(dirname "$target_path")
  esc_current=$(echo "$target_path" | sed 's/\\/\\\\/g; s/"/\\"/g')
  esc_parent=$(echo "$parent_path" | sed 's/\\/\\\\/g; s/"/\\"/g')

  # Check permission before cd
  if ! cd "$target_path" 2>/dev/null; then
      echo "{\"ok\":false,\"error\":\"Access denied to $esc_current\"}"
      return 1
  fi

  echo "{\"ok\":true,\"current\":\"$esc_current\",\"parent\":\"$esc_parent\",\"dirs\":["
  
  first=1
  for d in */; do
    if [ ! -d "$d" ]; then continue; fi
    dirname=${d%/}
    if [ $first -eq 0 ]; then echo ','; fi
    first=0
    esc_name=$(echo "$dirname" | sed 's/\\/\\\\/g; s/"/\\"/g')
    echo "\"$esc_name\""
  done
  echo ' ]}'
}

case "$1" in
  scan-music)
    scan_music_json
    ;;
  list-dirs)
    list_dirs_json
    ;;
  *)
    echo '{"error":"unsupported action"}'
    exit 1
    ;;
esac
