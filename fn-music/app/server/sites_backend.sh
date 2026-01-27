#!/bin/bash
set -x
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
  has_ffprobe=0
  if command -v ffprobe >/dev/null 2>&1; then has_ffprobe=1; fi
  
  # Find music files
  find "$target_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.ogg" -o -iname "*.flac" -o -iname "*.m4a" \) 2>/dev/null | while read -r file; do
    filename=$(basename "$file")
    filepath="$file"
    
    # Defaults
    title="$filename"
    artist="Unknown Artist"
    album="Unknown Album"
    duration="0"
    size="0"
    
    if [ $has_ffprobe -eq 1 ]; then
       # Extract metadata using ffprobe
       # -of flat returns keys like format.tags.title="Value"
       metadata=$(ffprobe -v quiet -show_entries format=duration,size:format_tags=title,artist,album -of flat "$file")
       
       # Extract fields
       d_val=$(echo "$metadata" | grep 'format.duration=' | cut -d= -f2 | tr -d '"')
       if [ -n "$d_val" ] && [ "$d_val" != "N/A" ]; then duration="$d_val"; fi
       
       s_val=$(echo "$metadata" | grep 'format.size=' | cut -d= -f2 | tr -d '"')
       if [ -n "$s_val" ] && [ "$s_val" != "N/A" ]; then size="$s_val"; fi
       
       t_val=$(echo "$metadata" | grep 'format.tags.title=' | cut -d= -f2-)
       if [ -n "$t_val" ]; then 
            title=$(echo "$t_val" | sed 's/^"//;s/"$//')
       fi
       
       a_val=$(echo "$metadata" | grep 'format.tags.artist=' | cut -d= -f2-)
       if [ -n "$a_val" ]; then 
            artist=$(echo "$a_val" | sed 's/^"//;s/"$//')
       fi
       
       al_val=$(echo "$metadata" | grep 'format.tags.album=' | cut -d= -f2-)
       if [ -n "$al_val" ]; then 
            album=$(echo "$al_val" | sed 's/^"//;s/"$//')
       fi
    else
       # Fallback size
       size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    fi
    
    # Escape for JSON
    # Use python for reliable escaping if available, otherwise sed
    # Using sed for simplicity and speed in this context
    esc_name=$(echo "$filename" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_path=$(echo "$filepath" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_title=$(echo "$title" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_artist=$(echo "$artist" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_album=$(echo "$album" | sed 's/\\/\\\\/g; s/"/\\"/g')
    
    echo "{\"name\":\"$esc_name\",\"path\":\"$esc_path\",\"title\":\"$esc_title\",\"artist\":\"$esc_artist\",\"album\":\"$esc_album\",\"size\":$size,\"duration\":$duration}"
  done > /tmp/waves_scan_tmp
  
  # Post-process to add commas
  if [ -s /tmp/waves_scan_tmp ]; then
    sed '$!s/$/,/' /tmp/waves_scan_tmp
  fi
  
  echo ']}'
  rm -f /tmp/waves_scan_tmp
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

get_cover() {
  file_path=$(cat)
  file_path=$(printf '%s' "$file_path" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

  if [ -f "$file_path" ]; then
    # Try ffmpeg to extract cover
    if command -v ffmpeg >/dev/null 2>&1; then
       ffmpeg -loglevel quiet -i "$file_path" -an -vcodec copy -f image2 pipe:1
    fi
  fi
}

get_lyrics() {
  file_path=$(cat)
  file_path=$(printf '%s' "$file_path" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  
  lrc_file="${file_path%.*}.lrc"
  if [ -f "$lrc_file" ]; then
    cat "$lrc_file"
    return
  fi

  if command -v ffprobe >/dev/null 2>&1; then
      # Use python for robust extraction if available
      if command -v python3 >/dev/null 2>&1; then
          ffprobe -v quiet -print_format json -show_entries format_tags "$file_path" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tags = data.get('format', {}).get('tags', {})
    lyrics = ''
    keys = list(tags.keys())
    found = False
    
    # Priority 1: UNSYNCEDLYRICS (ID3v2)
    for k in keys:
        if k.upper() == 'UNSYNCEDLYRICS':
            lyrics = tags[k]
            found = True
            break
    
    # Priority 2: LYRICS (Vorbis/generic)
    if not found:
        for k in keys:
            if 'LYRICS' in k.upper():
                lyrics = tags[k]
                found = True
                break
                
    print(lyrics)
except Exception:
    pass
"
      else
          # Fallback to grep/sed
          val=$(ffprobe -v quiet -show_entries format_tags -of flat "$file_path" | grep -iE "lyrics|unsyncedlyrics" | head -n 1 | cut -d= -f2-)
          if [ -n "$val" ]; then
             echo "$val" | sed 's/^"//;s/"$//' | sed 's/\\n/\n/g' | sed 's/\\r//g'
          fi
      fi
  fi
}

# Config Management
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(dirname "$SCRIPT_DIR")"

# Force use of app-local config directory as requested
CONFIG_DIR="$APP_ROOT/config"
CONFIG_FILE="$CONFIG_DIR/config.json"

get_config() {
  if [ -f "$CONFIG_FILE" ]; then
    cat "$CONFIG_FILE"
  else
    echo '{"dirs":[]}'
  fi
}

save_config() {
  content=$(cat)
  # Trim whitespace (including newlines)
  content=$(echo "$content" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  
  if [ ! -d "$CONFIG_DIR" ]; then
    if ! mkdir -p "$CONFIG_DIR"; then
        echo "{\"ok\":false,\"error\":\"Failed to create directory '$CONFIG_DIR'. (TRIM_PKGVAR='$TRIM_PKGVAR')\"}"
        return 0
    fi
  fi
  
  # Basic validation: starts with { and ends with }
  case "$content" in
    \{*\})
       if echo "$content" > "$CONFIG_FILE"; then
          echo '{"ok":true}'
       else
          debug_user=$(id -a)
          debug_dir=$(ls -ld "$CONFIG_DIR" 2>&1)
          debug_file=$(ls -l "$CONFIG_FILE" 2>&1)
          echo "{\"ok\":false,\"error\":\"Failed to write to '$CONFIG_FILE'. Debug: User=[$debug_user] Dir=[$debug_dir] File=[$debug_file]\"}"
       fi
       ;;
    *)
       echo "{\"ok\":false,\"error\":\"Invalid JSON format (received: ${content:0:20}...)\"}"
       ;;
  esac
}

search_artist() {
  artist_name=$(cat)
  # Clean input
  artist_name=$(echo "$artist_name" | tr -d '\r\n')
  
  if [ -z "$artist_name" ]; then
      echo '{"ok":false, "error":"Empty artist name"}'
      return
  fi

  # URL encode artist_name using python
  encoded_name=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$artist_name")
  url="https://music.163.com/api/search/get?s=${encoded_name}&type=100"
  
  # Fetch JSON with timeout
  json_response=$(curl -s --max-time 5 "$url")
  
  if [ -z "$json_response" ]; then
      echo '{"ok":false, "error":"No response from music api"}'
      return
  fi

  # Extract first picUrl using python
  pic_url=$(echo "$json_response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    artists = data.get('result', {}).get('artists', [])
    pic_url = None
    for artist in artists:
        if artist.get('picUrl'):
            pic_url = artist['picUrl']
            break
    if pic_url:
        print(pic_url)
    else:
        print('')
except Exception as e:
    print('')
")
  
  if [ -n "$pic_url" ]; then
      echo "{\"ok\":true, \"url\":\"$pic_url\"}"
  else
      echo "{\"ok\":false, \"error\":\"No image found\"}"
  fi
}

case "$1" in
  scan-music)
    scan_music_json
    ;;
  list-dirs)
    list_dirs_json
    ;;
  get-cover)
    get_cover
    ;;
  get-lyrics)
    get_lyrics
    ;;
  get-config)
    get_config
    ;;
  save-config)
    save_config
    ;;
  search-artist)
    search_artist
    ;;
  *)
    echo '{"error":"unsupported action"}'
    exit 1
    ;;
esac
