#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import urllib.parse
import mimetypes
import sys
import argparse
import socket

# Configuration
WWW_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../www")
MUSIC_EXTS = {'.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.webm'}

class MusicPlayerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WWW_ROOT, **kwargs)

    def do_GET(self):
        # Handle Stream
        if self.path.startswith('/api/music/stream'):
            self.handle_stream()
            return
        
        # Default Static Files
        super().do_GET()

    def do_POST(self):
        # Handle API
        if self.path.startswith('/api/music/'):
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except:
                data = {}
            
            response = {}
            if self.path == '/api/music/dirs':
                response = self.list_dirs(data.get('path', '/'))
            elif self.path == '/api/music/list':
                response = self.list_files(data.get('path', '/'))
            elif self.path == '/api/music/playlist':
                response = self.scan_playlist(data.get('paths', []))
            else:
                self.send_error(404, "API Not Found")
                return

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            self.send_error(404, "Not Found")

    def list_dirs(self, path):
        if not path: path = "/"
        if not os.path.exists(path) or not os.path.isdir(path):
            return {"error": "Invalid path"}
        
        res = []
        try:
            # Add parent
            if path != "/":
                res.append({"name": "..", "path": os.path.dirname(path)})
                
            for d in sorted(os.listdir(path)):
                full = os.path.join(path, d)
                if os.path.isdir(full) and not d.startswith('.'):
                    res.append({"name": d, "path": full})
        except Exception as e:
            return {"error": str(e)}
        return {"dirs": res, "current": path}

    def list_files(self, path):
        if not path: path = "/"
        if not os.path.exists(path) or not os.path.isdir(path):
            return {"error": "Invalid path"}
        
        res = []
        try:
            for f in sorted(os.listdir(path)):
                full = os.path.join(path, f)
                if os.path.isfile(full):
                    ext = os.path.splitext(f)[1].lower()
                    if ext in MUSIC_EXTS:
                        res.append({"name": f, "path": full})
        except Exception as e:
            return {"error": str(e)}
        return {"files": res}

    def scan_playlist(self, paths):
        playlist = []
        if isinstance(paths, str): paths = [paths]
        
        for p in paths:
            try:
                if os.path.isfile(p):
                     if os.path.splitext(p)[1].lower() in MUSIC_EXTS:
                         playlist.append({"name": os.path.basename(p), "path": p})
                elif os.path.isdir(p):
                    for root, dirs, files in os.walk(p):
                        for f in sorted(files):
                            if os.path.splitext(f)[1].lower() in MUSIC_EXTS:
                                playlist.append({"name": f, "path": os.path.join(root, f)})
            except Exception as e:
                print(f"Error scanning {p}: {e}")
        return {"playlist": playlist}

    def handle_stream(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        path = params.get('path', [''])[0]
        
        print(f"Stream request: {path}")

        if not path or not os.path.exists(path):
            print(f"File not found: {path}")
            self.send_error(404, "File not found")
            return

        try:
            file_size = os.path.getsize(path)
            mime_type, _ = mimetypes.guess_type(path)
            if not mime_type: mime_type = 'application/octet-stream'

            range_header = self.headers.get('Range')
            if range_header:
                byte_range = range_header.replace('bytes=', '').split('-')
                start = int(byte_range[0])
                end = int(byte_range[1]) if len(byte_range) > 1 and byte_range[1] else file_size - 1
                length = end - start + 1
                
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
            else:
                start = 0
                length = file_size
                self.send_response(200)

            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()

            with open(path, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk_size = min(65536, remaining)
                    chunk = f.read(chunk_size)
                    if not chunk: break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
                    
        except Exception as e:
            print(f"Stream error: {e}")

def run_server(unix_socket=None):
    if unix_socket:
        if os.path.exists(unix_socket):
            os.unlink(unix_socket)
        
        class UnixSocketHttpServer(http.server.ThreadingHTTPServer):
            address_family = socket.AF_UNIX

        httpd = UnixSocketHttpServer(unix_socket, MusicPlayerHandler)
        print(f"Serving on unix socket {unix_socket}...")
        
        # Ensure socket is writable
        try:
            os.chmod(unix_socket, 0o666)
        except:
            pass
    else:
        port = 26126
        httpd = http.server.ThreadingHTTPServer(('0.0.0.0', port), MusicPlayerHandler)
        print(f"Serving on port {port}...")

    httpd.serve_forever()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--unix-socket", help="Path to UNIX domain socket to bind")
    parser.add_argument("--db", help="Ignored (compatibility)")
    parser.add_argument("--base-path", help="Ignored (compatibility)")
    args = parser.parse_args()
    
    run_server(args.unix_socket)
