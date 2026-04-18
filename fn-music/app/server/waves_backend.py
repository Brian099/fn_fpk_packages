import os
import sqlite3
import json
import subprocess
import time
from pathlib import Path

class WavesBackend:
    def __init__(self, config_dir):
        self.config_dir = Path(config_dir)
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.config_dir / "waves.db"
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Tracks table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE,
                name TEXT,
                title TEXT,
                artist TEXT,
                album TEXT,
                size INTEGER,
                duration REAL,
                mtime REAL,
                scanned INTEGER DEFAULT 0
            )
        ''')
        
        # Config table (kv store)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        
        # Playlists table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE
            )
        ''')
        
        # Playlist items
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS playlist_items (
                playlist_id INTEGER,
                track_id INTEGER,
                sort_order INTEGER,
                FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
            )
        ''')
        
        conn.execute('PRAGMA journal_mode=WAL')
        conn.commit()
        conn.close()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    # --- Config Management ---
    def get_config(self, key, default=None):
        conn = self.get_connection()
        res = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
        conn.close()
        if res:
            return json.loads(res['value'])
        return default

    def set_config(self, key, value):
        conn = self.get_connection()
        conn.execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", (key, json.dumps(value)))
        conn.commit()
        conn.close()

    # --- Scanning ---
    def scan_directories(self, directories):
        all_files = []
        extensions = {'.mp3', '.wav', '.ogg', '.flac', '.m4a'}
        
        for root_dir in directories:
            if not os.path.isdir(root_dir):
                continue
            
            for root, _, files in os.walk(root_dir):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in extensions:
                        full_path = os.path.join(root, f)
                        all_files.append(full_path)
        
        # Sync with database
        conn = self.get_connection()
        
        # 1. Mark missing files for removal
        existing_paths = set(p[0] for p in conn.execute("SELECT path FROM tracks").fetchall())
        current_paths = set(all_files)
        
        to_remove = existing_paths - current_paths
        if to_remove:
            conn.executemany("DELETE FROM tracks WHERE path = ?", [(p,) for p in to_remove])
            
        # 2. Add new files or check for updates
        for path in all_files:
            try:
                mtime = os.path.getmtime(path)
                size = os.path.getsize(path)
                
                # Check if already in DB and not changed
                res = conn.execute("SELECT mtime, size FROM tracks WHERE path = ?", (path,)).fetchone()
                if res and res['mtime'] == mtime and res['size'] == size:
                    continue
                
                # Insert or update
                name = os.path.basename(path)
                conn.execute('''
                    INSERT OR REPLACE INTO tracks (path, name, mtime, size, scanned)
                    VALUES (?, ?, ?, ?, 0)
                ''', (path, name, mtime, size))
            except Exception as e:
                print(f"Error processing {path}: {e}")
                
        conn.commit()
        conn.close()

    def get_meta(self, path):
        try:
            cmd = ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration,size:format_tags=title,artist,album', '-of', 'json', path]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            data = json.loads(res.stdout)
            fmt = data.get('format', {})
            raw_tags = fmt.get('tags', {})
            tags = {k.lower(): v for k, v in raw_tags.items()}
            
            return {
                'duration': float(fmt.get('duration', 0)),
                'size': int(fmt.get('size', 0)),
                'title': tags.get('title', os.path.basename(path)),
                'artist': tags.get('artist', 'Unknown Artist'),
                'album': tags.get('album', 'Unknown Album'),
                'scanned': 1
            }
        except Exception as e:
            return {'scanned': 1} # Mark as scanned even if it failed to avoid retrying

    def update_metadata_batch(self, limit=50, paths=None):
        conn = self.get_connection()
        if paths:
            tracks = []
            for p in paths:
                t = conn.execute("SELECT id, path FROM tracks WHERE path = ?", (p,)).fetchone()
                if t: tracks.append(t)
        else:
            tracks = conn.execute("SELECT id, path FROM tracks WHERE scanned = 0 LIMIT ?", (limit,)).fetchall()
        conn.close() # Close read connection
        
        if not tracks:
            return []

        # 1. Perform slow ffprobe calls OUTSIDE any transaction
        results = []
        updates = []
        for t in tracks:
            meta = self.get_meta(t['path'])
            meta['path'] = t['path']
            meta['id'] = t['id']
            results.append(meta)
            updates.append((
                meta.get('title'), 
                meta.get('artist'), 
                meta.get('album'), 
                meta.get('duration'), 
                meta.get('size', 0),
                t['id']
            ))
        
        # 2. Re-open and commit all updates in a single FAST transaction
        conn = self.get_connection()
        try:
            conn.executemany('''
                UPDATE tracks 
                SET title = ?, artist = ?, album = ?, duration = ?, size = ?, scanned = 1
                WHERE id = ?
            ''', updates)
            conn.commit()
        except Exception as e:
            print(f"Commit failed: {e}")
        finally:
            conn.close()
            
        return results

    # --- API Implementation ---
    def get_tracks(self, page=1, limit=50, search=None, artist=None, album=None):
        offset = (page - 1) * limit
        conn = self.get_connection()
        
        where_clauses = []
        params = []
        
        if search:
            where_clauses.append("(name LIKE ? OR title LIKE ? OR artist LIKE ? OR album LIKE ?)")
            s = f"%{search}%"
            params.extend([s, s, s, s])
            
        if artist:
            where_clauses.append("artist = ?")
            params.append(artist)
            
        if album:
            where_clauses.append("album = ?")
            params.append(album)
            
        where_str = ""
        if where_clauses:
            where_str = " WHERE " + " AND ".join(where_clauses)
            
        query = f"SELECT * FROM tracks{where_str}"
        
        # Get count
        count_query = f"SELECT COUNT(*) FROM tracks{where_str}"
        total = conn.execute(count_query, params).fetchone()[0]
        
        # Get data
        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(query, params).fetchall()
        
        tracks = [dict(r) for r in rows]
        conn.close()
        
        return {
            'ok': True,
            'tracks': tracks,
            'total': total,
            'page': page,
            'limit': limit,
            'pages': (total + limit - 1) // limit
        }

    def save_playlist(self, name, paths):
        conn = self.get_connection()
        try:
            conn.execute("INSERT OR IGNORE INTO playlists (name) VALUES (?)", (name,))
            pl_id = conn.execute("SELECT id FROM playlists WHERE name = ?", (name,)).fetchone()[0]
            
            # Clear existing
            conn.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (pl_id,))
            
            # Add new
            for i, path in enumerate(paths):
                track = conn.execute("SELECT id FROM tracks WHERE path = ?", (path,)).fetchone()
                if track:
                    conn.execute("INSERT INTO playlist_items (playlist_id, track_id, sort_order) VALUES (?, ?, ?)",
                                 (pl_id, track['id'], i))
            conn.commit()
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        finally:
            conn.close()

    def get_playlists(self):
        conn = self.get_connection()
        rows = conn.execute("SELECT name FROM playlists").fetchall()
        conn.close()
        return {'ok': True, 'playlists': [r['name'] for r in rows]}

    def get_playlist(self, name):
        conn = self.get_connection()
        pl = conn.execute("SELECT id FROM playlists WHERE name = ?", (name,)).fetchone()
        if not pl:
            return {'ok': False, 'error': 'Playlist not found'}
        
        rows = conn.execute('''
            SELECT t.* FROM tracks t
            JOIN playlist_items pi ON t.id = pi.track_id
            WHERE pi.playlist_id = ?
            ORDER BY pi.sort_order
        ''', (pl['id'],)).fetchall()
        
        conn.close()
        return {'ok': True, 'name': name, 'data': [dict(r) for r in rows]}

    def delete_playlist(self, name):
        conn = self.get_connection()
        conn.execute("DELETE FROM playlists WHERE name = ?", (name,))
        conn.commit()
        conn.close()
        return {'ok': True}

    def get_artists(self):
        conn = self.get_connection()
        rows = conn.execute('''
            SELECT artist, COUNT(*) as count 
            FROM tracks 
            WHERE artist IS NOT NULL
            GROUP BY artist 
            ORDER BY artist COLLATE NOCASE
        ''').fetchall()
        conn.close()
        return {'ok': True, 'artists': [dict(r) for r in rows]}

    def get_cover(self, path):
        if not os.path.isfile(path):
            return None
        try:
            cmd = ['ffmpeg', '-loglevel', 'quiet', '-i', path, '-an', '-vcodec', 'copy', '-f', 'image2', 'pipe:1']
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode == 0 and res.stdout:
                return res.stdout
        except:
            pass
        return None

    def get_lyrics(self, path):
        if not os.path.isfile(path):
            return ""
        
        dir_path = os.path.dirname(path)
        base_name = os.path.basename(path)
        name_no_ext = os.path.splitext(base_name)[0]
        
        # Check files
        candidates = [
            os.path.join(dir_path, f"{name_no_ext}.lrc"),
            os.path.join(dir_path, f"{name_no_ext}.LRC"),
            os.path.join(dir_path, f"{name_no_ext}.txt"),
            os.path.join(dir_path, "Lyrics", f"{name_no_ext}.lrc"),
            os.path.join(dir_path, "lyrics", f"{name_no_ext}.lrc")
        ]
        
        for c in candidates:
            if os.path.isfile(c):
                try:
                    # Try UTF-8 first, then GB18030
                    with open(c, 'rb') as f:
                        content = f.read()
                    try:
                        return content.decode('utf-8')
                    except:
                        return content.decode('gb18030', errors='ignore')
                except:
                    continue
        
        # Try embedded lyrics via ffprobe/python
        try:
            cmd = ['ffprobe', '-v', 'quiet', '-show_entries', 'format_tags', '-of', 'json', path]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            data = json.loads(res.stdout)
            tags = {k.upper(): v for k, v in data.get('format', {}).get('tags', {}).items()}
            
            for key in ['UNSYNCEDLYRICS', 'LYRICS']:
                for k in tags:
                    if key in k:
                        return tags[k]
        except:
            pass
            
        return ""

    def search_artist(self, name):
        if not name:
            return {'ok': False}
        try:
            import urllib.request
            encoded_name = urllib.parse.quote(name)
            url = f"https://music.163.com/api/search/get?s={encoded_name}&type=100"
            with urllib.request.urlopen(url, timeout=5) as response:
                data = json.loads(response.read().decode())
                artists = data.get('result', {}).get('artists', [])
                for artist in artists:
                    if artist.get('picUrl'):
                        return {'ok': True, 'url': artist['picUrl']}
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        return {'ok': False, 'error': 'No image found'}
