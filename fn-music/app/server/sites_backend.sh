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

scan_fast() {
  # Read raw body from stdin
  target_path=$(cat)
  
  # Trim whitespace
  target_path=$(printf '%s' "$target_path" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

  if [ -z "$target_path" ] || [ ! -d "$target_path" ]; then
    echo '{"ok":false,"error":"Invalid directory"}'
    return 0
  fi

  echo '{"ok":true,"files":['
  
  # Find music files
  # Use find to get paths, then format as JSON
  # We only provide name and path initially
  find "$target_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.ogg" -o -iname "*.flac" -o -iname "*.m4a" \) 2>/dev/null | while read -r file; do
    filename=$(basename "$file")
    filepath="$file"
    
    # Escape for JSON
    esc_name=$(echo "$filename" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_path=$(echo "$filepath" | sed 's/\\/\\\\/g; s/"/\\"/g')
    
    echo "{\"name\":\"$esc_name\",\"path\":\"$esc_path\"},"
  done > /tmp/waves_scan_fast_tmp
  
  # Remove trailing comma if file is not empty
  if [ -s /tmp/waves_scan_fast_tmp ]; then
    sed '$s/,$//' /tmp/waves_scan_fast_tmp
  fi
  
  echo ']}'
  rm -f /tmp/waves_scan_fast_tmp
}

get_meta_batch() {
    # Expects a JSON array of file paths from stdin
    # Example: ["/path/to/1.mp3", "/path/to/2.mp3"]
    # We will parse this using python if available, or a simple hack if not.
    # Given the environment, let's assume we might need a robust way or a simple way.
    # Simple way: Assume the input is just a list of paths? 
    # The user might send a JSON body. 
    
    # Let's try to handle JSON array input using python to parse, or just line-separated if we control the frontend.
    # To keep it standard JSON, let's use python to parse the input array.
    
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import sys, json, subprocess, os

def get_meta(path):
    try:
        cmd = ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration,size:format_tags=title,artist,album', '-of', 'json', path]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        data = json.loads(res.stdout)
        fmt = data.get('format', {})
        tags = fmt.get('tags', {})
        
        return {
            'path': path,
            'duration': fmt.get('duration', '0'),
            'size': fmt.get('size', '0'),
            'title': tags.get('title', os.path.basename(path)),
            'artist': tags.get('artist', 'Unknown Artist'),
            'album': tags.get('album', 'Unknown Album')
        }
    except Exception as e:
        return {'path': path, 'error': str(e)}

try:
    paths = json.load(sys.stdin)
    results = []
    for p in paths:
        results.append(get_meta(p))
    print(json.dumps({'ok': True, 'data': results}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}))
"
    else
        # Fallback if no python: expect line separated paths?
        # Or just fail. Python is usually available in this env (FnOS).
        # But let's write a simple shell loop just in case.
        echo '{"ok":false,"error":"Python3 required for batch metadata"}'
    fi
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

ensure_utf8() {
  local file="$1"
  if command -v iconv >/dev/null 2>&1; then
     # Check if valid UTF-8 by trying to convert to itself.
     # If it fails, it's likely not UTF-8 (or broken).
     if iconv -f UTF-8 -t UTF-8 "$file" >/dev/null 2>&1; then
         cat "$file"
     else
         # Try GB18030 (covers GBK, GB2312) -> UTF-8
         # If that fails too, just cat the original
         iconv -f GB18030 -t UTF-8 "$file" 2>/dev/null || cat "$file"
     fi
  else
     cat "$file"
  fi
}

get_lyrics() {
  file_path=$(cat)
  file_path=$(printf '%s' "$file_path" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  
  dir_path=$(dirname "$file_path")
  base_name=$(basename "$file_path")
  name_no_ext="${base_name%.*}"
  
  # Check candidates in order
  # 1. Exact match .lrc
  if [ -f "${dir_path}/${name_no_ext}.lrc" ]; then
    ensure_utf8 "${dir_path}/${name_no_ext}.lrc"
    return
  fi
  
  # 2. Uppercase .LRC
  if [ -f "${dir_path}/${name_no_ext}.LRC" ]; then
    ensure_utf8 "${dir_path}/${name_no_ext}.LRC"
    return
  fi
  
  # 3. .txt
  if [ -f "${dir_path}/${name_no_ext}.txt" ]; then
    ensure_utf8 "${dir_path}/${name_no_ext}.txt"
    return
  fi

  # 4. Lyrics/ subdir (exact match)
  if [ -f "${dir_path}/Lyrics/${name_no_ext}.lrc" ]; then
    ensure_utf8 "${dir_path}/Lyrics/${name_no_ext}.lrc"
    return
  fi

  # 5. lyrics/ subdir (lowercase)
  if [ -f "${dir_path}/lyrics/${name_no_ext}.lrc" ]; then
    ensure_utf8 "${dir_path}/lyrics/${name_no_ext}.lrc"
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
LIBRARY_FILE="$CONFIG_DIR/library.json"

get_config() {
  if [ -f "$CONFIG_FILE" ]; then
    cat "$CONFIG_FILE"
  else
    echo '{"dirs":[]}'
  fi
}

get_library() {
  if [ -f "$LIBRARY_FILE" ]; then
    cat "$LIBRARY_FILE"
  else
    echo '{"ok":true, "tracks":[]}'
  fi
}

save_library() {
  content=$(cat)
  if [ ! -d "$CONFIG_DIR" ]; then
    mkdir -p "$CONFIG_DIR"
  fi
  
  if echo "$content" > "$LIBRARY_FILE"; then
     echo '{"ok":true}'
  else
     echo '{"ok":false,"error":"Failed to save library"}'
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
  scan-fast)
    scan_fast
    ;;
  get-meta-batch)
    get_meta_batch
    ;;
  get-library)
    get_library
    ;;
  save-library)
    save_library
    ;;
  *)
    echo '{"error":"unsupported action"}'
    exit 1
    ;;
esac
