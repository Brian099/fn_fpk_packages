#!/usr/bin/python3
import os
import sys
import json
import urllib.parse
from pathlib import Path
import mimetypes

# Fix path to include app/server for backend import
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.append(os.path.join(APP_ROOT, "server"))

from musicwave_backend import MusicWaveBackend

# Persistence Detection
PERSISTENT_BASE = "/var/apps/musicwave"
if os.path.isdir(PERSISTENT_BASE):
    CONFIG_DIR = os.path.join(PERSISTENT_BASE, "home")
else:
    CONFIG_DIR = os.path.join(APP_ROOT, "home")

backend = MusicWaveBackend(CONFIG_DIR)

def get_post_body():
    try:
        content_length = int(os.environ.get('CONTENT_LENGTH', 0))
        if content_length > 0:
            return sys.stdin.read(content_length)
    except:
        pass
    return ""

def send_response(status, content_type, body, headers=None):
    print(f"Status: {status}")
    print(f"Content-Type: {content_type}")
    if headers:
        for k, v in headers.items():
            print(f"{k}: {v}")
    print("")
    if isinstance(body, str):
        sys.stdout.flush()
        sys.stdout.buffer.write(body.encode('utf-8'))
    elif isinstance(body, bytes):
        sys.stdout.flush()
        sys.stdout.buffer.write(body)
    sys.exit(0)

def send_json(data):
    send_response("200 OK", "application/json; charset=utf-8", json.dumps(data))

def serve_static(rel_path):
    base_path = os.path.join(APP_ROOT, "www")
    if not rel_path or rel_path == "/":
        rel_path = "/index.html"
    
    target_file = os.path.normpath(os.path.join(base_path, rel_path.lstrip("/")))
    if not target_file.startswith(base_path) or not os.path.isfile(target_file):
        send_response("404 Not Found", "text/plain", f"404 Not Found: {rel_path}")
    
    mime_type, _ = mimetypes.guess_type(target_file)
    if not mime_type:
        mime_type = "application/octet-stream"
        
    with open(target_file, "rb") as f:
        send_response("200 OK", mime_type, f.read())

def handle_api(rel_path, method, query_params):
    # API Routing
    if rel_path == "/api/music/scan-fast" or rel_path == "/api/music/scan":
        # Expect directory in body
        try:
            body = get_post_body()
            backend.scan_directories([body.strip()])
            send_json({'ok': True})
        except Exception as e:
            send_json({'ok': False, 'error': str(e)})

    elif rel_path == "/api/music/meta-batch":
        try:
            body = get_post_body()
            paths = json.loads(body) if body else None
            data = backend.update_metadata_batch(50, paths) # Reduced limit to 50
            send_json({'ok': True, 'data': data})
        except:
            data = backend.update_metadata_batch(50)
            send_json({'ok': True, 'data': data})

    elif rel_path == "/api/music/library/get":
        page = int(query_params.get('page', [1])[0])
        limit = int(query_params.get('limit', [50])[0])
        search = query_params.get('search', [None])[0]
        artist = query_params.get('artist', [None])[0]
        album = query_params.get('album', [None])[0]
        send_json(backend.get_tracks(page, limit, search, artist, album))

    elif rel_path == "/api/music/config/get":
        dirs = backend.get_config('dirs', [])
        last_playback = backend.get_config('last_playback', None)
        send_json({'ok': True, 'dirs': dirs, 'lastPlayback': last_playback})

    elif rel_path == "/api/music/config/save":
        try:
            body = get_post_body()
            data = json.loads(body)
            if 'dirs' in data: backend.set_config('dirs', data['dirs'])
            if 'lastPlayback' in data: backend.set_config('last_playback', data['lastPlayback'])
            send_json({'ok': True})
        except Exception as e:
            send_json({'ok': False, 'error': str(e)})

    elif rel_path == "/api/music/stream":
        path = query_params.get('path', [""])[0]
        if not path or not os.path.isfile(path):
            send_response("404 Not Found", "text/plain", "File not found")
        
        mime_type, _ = mimetypes.guess_type(path)
        file_size = os.path.getsize(path)
        
        range_header = os.environ.get('HTTP_RANGE')
        start, end = 0, file_size - 1
        status = "200 OK"
        
        if range_header:
            try:
                ranges = range_header.replace('bytes=', '').split('-')
                start = int(ranges[0]) if ranges[0] else 0
                if len(ranges) > 1 and ranges[1]:
                    end = int(ranges[1])
                status = "206 Partial Content"
            except: pass
            
        headers = {
            "Content-Length": str(end - start + 1),
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes"
        }
        
        print(f"Status: {status}")
        print(f"Content-Type: {mime_type or 'audio/mpeg'}")
        for k, v in headers.items():
            print(f"{k}: {v}")
        print("")
        sys.stdout.flush()
        
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk_size = min(remaining, 64 * 1024)
                chunk = f.read(chunk_size)
                if not chunk: break
                sys.stdout.buffer.write(chunk)
                remaining -= len(chunk)
        sys.exit(0)

    elif rel_path == "/api/music/cover":
        path = query_params.get('path', [""])[0]
        if not path: send_response("400 Bad Request", "text/plain", "Missing path")
        cover = backend.get_cover(path) # Need to implement in backend
        if cover:
            send_response("200 OK", "image/jpeg", cover)
        else:
            send_response("404 Not Found", "text/plain", "Cover not found")

    elif rel_path == "/api/music/lyrics":
        path = query_params.get('path', [""])[0]
        if not path: send_response("400 Bad Request", "text/plain", "Missing path")
        lyrics = backend.get_lyrics(path) # Need to implement in backend
        send_response("200 OK", "text/plain; charset=utf-8", lyrics or "")

    elif rel_path == "/api/music/playlist/list":
        send_json(backend.get_playlists())

    elif rel_path == "/api/music/playlist/save":
        try:
            body = get_post_body()
            data = json.loads(body)
            send_json(backend.save_playlist(data['name'], [i['path'] for i in data['data']]))
        except Exception as e:
            send_json({'ok': False, 'error': str(e)})

    elif rel_path == "/api/music/playlist/get":
        name = query_params.get('name', [""])[0]
        send_json(backend.get_playlist(name))

    elif rel_path == "/api/music/playlist/delete":
        name = query_params.get('name', [""])[0]
        send_json(backend.delete_playlist(name))

    elif rel_path == "/api/fs/list":
        try:
            body = get_post_body().strip() or "/"
            # Re-implement simple directory listing
            if not os.path.isdir(body):
                send_json({'ok': False, 'error': 'Not a directory'})
            
            items = os.listdir(body)
            dirs = [i for i in items if os.path.isdir(os.path.join(body, i)) and not i.startswith('.')]
            dirs.sort()
            
            send_json({
                'ok': True,
                'current': body,
                'parent': os.path.dirname(body),
                'dirs': dirs
            })
        except Exception as e:
            send_json({'ok': False, 'error': str(e)})

    elif rel_path == "/api/music/artist/search":
        try:
            artist = get_post_body().strip()
            send_json(backend.search_artist(artist))
        except Exception as e:
            send_json({'ok': False, 'error': str(e)})

    elif rel_path == "/api/music/artists/list":
        send_json(backend.get_artists())

    else:
        send_json({'ok': False, 'error': 'Unknown API route'})

# --- Main Execution ---
request_uri = os.environ.get('REQUEST_URI', '/')
query_string = os.environ.get('QUERY_STRING', '')
request_method = os.environ.get('REQUEST_METHOD', 'GET')
query_params = urllib.parse.parse_qs(query_string)

# Route Detection
rel_path = query_params.get('api_route', [None])[0]
if not rel_path:
    # PATH_INFO mode
    uri_no_query = request_uri.split('?')[0]
    if 'index.cgi' in uri_no_query:
        rel_path = uri_no_query.split('index.cgi')[1]

if not rel_path or rel_path == "":
    rel_path = "/"

if rel_path.startswith('/api/'):
    handle_api(rel_path, request_method, query_params)
else:
    serve_static(rel_path)
