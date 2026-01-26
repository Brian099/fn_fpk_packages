#!/bin/bash

# Music Scanning Function
scan_music_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input_path=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  else
    input_path=""
  fi
  
  target_path=$(echo "$input_path" | grep "^path=" | cut -d= -f2- | tr -d '\r')
  
  # Decode URL encoded path if needed (simple check)
  if [[ "$target_path" == *%* ]]; then
      if command -v php >/dev/null 2>&1; then
        target_path=$(php -r "echo rawurldecode(\$argv[1]);" -- "$target_path")
      elif command -v python3 >/dev/null 2>&1; then
        target_path=$(python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))" "$target_path")
      fi
  fi

  if [ -z "$target_path" ] || [ ! -d "$target_path" ]; then
    echo '{"ok":false,"error":"Invalid directory"}'
    return 1
  fi

  echo '{"ok":true,"files":['
  
  # Find music files
  first=1
  # Using find with null delimiter to handle spaces safely, but for JSON output we need to be careful
  # Let's use a simpler loop for better JSON control
  
  find "$target_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.ogg" -o -iname "*.flac" -o -iname "*.m4a" \) | while read -r file; do
    if [ $first -eq 0 ]; then echo ','; fi
    first=0
    
    filename=$(basename "$file")
    filepath="$file"
    
    # Escape for JSON
    esc_name=$(echo "$filename" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_path=$(echo "$filepath" | sed 's/\\/\\\\/g; s/"/\\"/g')
    
    echo "{\"name\":\"$esc_name\",\"path\":\"$esc_path\"}"
    # Hack to reset first flag in subshell? No, pipe runs in subshell. 
    # To handle comma correctly in pipe, we need a different approach or post-processing.
    # Simplified approach: Print comma before every item except the first one?
    # Hard in shell loop.
    # Better: Collect all, join with comma.
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

  echo "{\"ok\":true,\"current\":\"$esc_current\",\"parent\":\"$esc_parent\",\"dirs\":["
  
  cd "$target_path" || return 1
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
