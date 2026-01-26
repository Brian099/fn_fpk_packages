#!/bin/bash

# Music Scanning Function
scan_music_json() {
  # Read raw body from stdin
  target_path=$(cat)
  
  # Trim whitespace
  target_path=$(printf '%s' "$target_path" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

  if [ -z "$target_path" ] || [ ! -d "$target_path" ]; then
    echo '{"ok":false,"error":"Invalid directory"}'
    return 0
  fi

  echo '{"ok":true,"files":['
  
  first=1
  
  # Find music files
  find "$target_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.ogg" -o -iname "*.flac" -o -iname "*.m4a" \) 2>/dev/null | while read -r file; do
    filename=$(basename "$file")
    filepath="$file"
    
    # Escape for JSON
    esc_name=$(echo "$filename" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_path=$(echo "$filepath" | sed 's/\\/\\\\/g; s/"/\\"/g')
    
    echo "{\"name\":\"$esc_name\",\"path\":\"$esc_path\"}"
  done > /tmp/fn_music_scan_tmp
  
  # Post-process to add commas
  if [ -s /tmp/fn_music_scan_tmp ]; then
    sed '$!s/$/,/' /tmp/fn_music_scan_tmp
  fi
  
  echo ']}'
  rm -f /tmp/fn_music_scan_tmp
}

list_dirs_json() {
  # Read raw body from stdin
  input_path=$(cat)

  # Trim whitespace
  target_path=$(printf '%s' "$input_path" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  
  if [ -z "$target_path" ]; then target_path="/"; fi
  
  if [ ! -d "$target_path" ]; then
    echo '{"ok":false,"error":"path not found"}'
    return 0
  fi
  
  parent_path=$(dirname "$target_path")
  esc_current=$(echo "$target_path" | sed 's/\\/\\\\/g; s/"/\\"/g')
  esc_parent=$(echo "$parent_path" | sed 's/\\/\\\\/g; s/"/\\"/g')

  # Check permission before cd
  if ! cd "$target_path" 2>/dev/null; then
      echo "{\"ok\":false,\"error\":\"Access denied to $esc_current\"}"
      return 0
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
