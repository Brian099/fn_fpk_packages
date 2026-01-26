#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys
import time
import re
import sqlite3
import threading
import shutil
import logging
import argparse
import locale
import concurrent.futures
from urllib.parse import quote, unquote, urlparse, parse_qs
import hashlib
import uuid
from datetime import timedelta

if getattr(sys, 'frozen', False):
    # 【打包模式】基准目录是二进制文件所在位置
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # 【源码模式】基准目录是脚本所在位置
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    # 仅在源码模式下加载 lib
    sys.path.insert(0, os.path.join(BASE_DIR, 'lib'))

try:
    from flask import Flask, render_template, request, jsonify, send_file, redirect, Response, session, url_for, make_response
    import requests
    from mutagen import File
    from mutagen.easyid3 import EasyID3
    from mutagen.id3 import ID3, APIC, USLT
    from mutagen.flac import FLAC, Picture
    from mutagen.mp4 import MP4, MP4Cover
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    from werkzeug.middleware.proxy_fix import ProxyFix
    import mod
except ImportError as e:
    print(f"错误：无法导入依赖库。\n详情: {e}")
    # 额外写入当前目录 error_import.log
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'error_import.log'), 'w', encoding='utf-8') as f:
            f.write(f"错误：无法导入依赖库。\n详情: {e}\n")
    except Exception:
        pass
    
    sys.exit(1)

# 计算 www 的绝对路径
TEMPLATE_DIR = os.path.abspath(os.path.join(BASE_DIR, '../www/templates'))
STATIC_DIR = os.path.abspath(os.path.join(BASE_DIR, '../www/static'))

# --- 环境配置 ---
os.environ['PYTHONIOENCODING'] = 'utf-8'
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

for encoding in ['UTF-8', 'utf-8', 'en_US.UTF-8', 'zh_CN.UTF-8']:
    try:
        locale.setlocale(locale.LC_ALL, f'en_US.{encoding}')
        break
    except:
        continue

# --- 参数解析 ---
parser = argparse.ArgumentParser(description='2FMusic Server')
parser.add_argument('--music-library-path', type=str, default=os.environ.get('MUSIC_LIBRARY_PATH'), help='Path to music library')
parser.add_argument('--log-path', type=str, default=os.environ.get('LOG_PATH'), help='Path to log file')
parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', 23237)), help='Server port')
parser.add_argument('--password', type=str, default=os.environ.get('APP_AUTH_PASSWORD') or os.environ.get('APP_PASSWORD'),
                    help='Optional password for web access; leave empty to disable auth')
args = parser.parse_args()

# --- 路径初始化 ---
MUSIC_LIBRARY_PATH = args.music_library_path or os.getcwd()
os.makedirs(MUSIC_LIBRARY_PATH, exist_ok=True)
os.makedirs(os.path.join(MUSIC_LIBRARY_PATH, 'lyrics'), exist_ok=True)
os.makedirs(os.path.join(MUSIC_LIBRARY_PATH, 'covers'), exist_ok=True)

log_file = args.log_path or os.path.join(os.getcwd(), 'app.log')
os.makedirs(os.path.dirname(log_file), exist_ok=True)
DB_PATH = os.path.join(MUSIC_LIBRARY_PATH, 'data.db')

# --- 日志配置 ---
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.handlers.clear()
logger.propagate = False  # 防止日志传播到根logger
file_handler = logging.FileHandler(log_file, mode='w', encoding='utf-8')
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# 过滤 Werkzeug 访问日志，隐藏心跳检测的 200 响应
class AccessLogFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return not ('/api/system/status' in msg and '" 200 ' in msg)

logging.getLogger('werkzeug').addFilter(AccessLogFilter())

logger.info(f"Music Library Path: {MUSIC_LIBRARY_PATH}")

# --- 全局状态变量 ---
SCAN_STATUS = {
    'scanning': False,
    'total': 0,
    'processed': 0,
    'current_file': ''
}
scan_status_lock = threading.Lock()

# 库版本戳，用于前端检测变更
LIBRARY_VERSION = time.time()

# 辅助: 生成ID
def generate_song_id(path):
    return hashlib.md5(path.encode('utf-8')).hexdigest()

# --- 文件监听器 ---
class MusicFileEventHandler(FileSystemEventHandler):
    """监听音乐库文件变动"""
    def on_created(self, event):
        if event.is_directory: return
        self._process(event.src_path, 'created')

    def on_deleted(self, event):
        if event.is_directory: return
        self._process(event.src_path, 'deleted')

    def on_moved(self, event):
        if event.is_directory: return
        # 视为删除旧文件，添加新文件
        self._process(event.src_path, 'deleted')
        self._process(event.dest_path, 'created')

    def _process(self, path, action):
        global LIBRARY_VERSION
        filename = os.path.basename(path)
        ext = os.path.splitext(filename)[1].lower()
        
        is_audio = ext in AUDIO_EXTS
        is_misc = ext in ('.lrc', '.jpg', '.jpeg', '.png')
        
        if not is_audio and not is_misc:
            return

        logger.info(f"检测到文件变更 [{action}]: {filename}")
        
        try:
            if action == 'created':
                time.sleep(0.5)
                if is_audio:
                    index_single_file(path)
                elif is_misc:
                    # 如果是附件，尝试重新索引同名音频文件以更新状态
                    base = os.path.splitext(path)[0]
                    for aud in AUDIO_EXTS:
                        aud_path = base + aud
                        if os.path.exists(aud_path):
                            index_single_file(aud_path)
                            
            elif action == 'deleted':
                if is_audio:
                    with get_db() as conn:
                        conn.execute("DELETE FROM songs WHERE path=?", (path,))
                        conn.commit()
                elif is_misc:
                    # 附件删除，同样反向更新音频状态
                    base = os.path.splitext(path)[0]
                    for aud in AUDIO_EXTS:
                        aud_path = base + aud
                        if os.path.exists(aud_path):
                            index_single_file(aud_path)
            
            LIBRARY_VERSION = time.time()
            
        except Exception as e:
            logger.error(f"处理文件变更失败: {e}")

# 全局 Observer 实例
global_observer = None

def init_watchdog():
    global global_observer
    if not Observer: return
    
    if global_observer:
        global_observer.stop()
        global_observer.join()
        
    global_observer = Observer()
    refresh_watchdog_paths()
    global_observer.start()
    logger.info("文件监听服务已启动")
    try:
        while True:
            time.sleep(1)
    except:
        global_observer.stop()
    global_observer.join()

def refresh_watchdog_paths():
    """根据数据库刷新监听目录"""
    global global_observer
    if not global_observer: return
    
    # 1. 移除现有所有 schedule
    global_observer.unschedule_all()
    
    # 2. 获取目标路径
    # 2. 获取目标路径并去重
    try:
        raw_paths = {os.path.abspath(MUSIC_LIBRARY_PATH)}
        with get_db() as conn:
            rows = conn.execute("SELECT path FROM mount_points").fetchall()
            for r in rows: 
                if r['path']:
                    raw_paths.add(os.path.abspath(r['path']))
    except: 
        raw_paths = {os.path.abspath(MUSIC_LIBRARY_PATH)}

    # 路径规范化与去重 (排除子目录)
    sorted_paths = sorted(list(raw_paths), key=len)
    final_targets = []
    for p in sorted_paths:
        # 如果当前路径是已添加路径的子目录，则跳过
        if not any(p.startswith(parent + os.sep) or p == parent for parent in final_targets):
            final_targets.append(p)
    
    # 3. 重新添加 schedule
    event_handler = MusicFileEventHandler()
    for path in final_targets:
        if os.path.exists(path):
            try:
                global_observer.schedule(event_handler, path, recursive=True)
                logger.info(f"监听目录: {path}")
            except Exception as e:
                logger.warning(f"无法监听目录 {path}: {e}")


NETEASE_DOWNLOAD_DIR = os.path.join(MUSIC_LIBRARY_PATH, 'NetEase')
NETEASE_API_BASE_DEFAULT = 'http://localhost:23236'
NETEASE_API_BASE = None
NETEASE_COOKIE = None
NETEASE_MAX_CONCURRENT = 5
NETEASE_QUALITY_DEFAULT = 'exhigh'
# NETEASE_QUALITY = None # Configured quality - REMOVED

DOWNLOAD_TASKS = {} # task_id -> {status, progress, message, filename}


# 修复路径问题
app = Flask(__name__, static_folder=STATIC_DIR, template_folder=TEMPLATE_DIR)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
# 配置静态文件缓存过期时间为 1 年 (31536000 秒)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 31536000
app.secret_key = os.environ.get('APP_SECRET_KEY', '2fmusic_secret')
app.permanent_session_lifetime = timedelta(days=30)

# 缓存静态文件的MD5值，避免重复计算
static_file_md5_cache = {}
# 缓存全局版本戳
global_version_cache = None

def get_file_md5(file_path):
    """计算文件的MD5值"""
    # 获取文件的修改时间
    try:
        mtime = os.path.getmtime(file_path)
    except Exception:
        mtime = int(time.time())
    
    # 检查缓存中是否有该文件的MD5值和修改时间
    if file_path in static_file_md5_cache:
        cached_md5, cached_mtime = static_file_md5_cache[file_path]
        # 如果文件没有修改，直接返回缓存的MD5值
        if mtime == cached_mtime:
            return cached_md5
    
    try:
        with open(file_path, 'rb') as f:
            md5_hash = hashlib.md5()
            for chunk in iter(lambda: f.read(4096), b''):
                md5_hash.update(chunk)
            md5_value = md5_hash.hexdigest()
            # 缓存MD5值和修改时间
            static_file_md5_cache[file_path] = (md5_value, mtime)
            return md5_value
    except Exception:
        # 如果计算失败，返回当前时间戳作为 fallback
        return str(int(time.time()))

def calculate_global_version(force_refresh=False):
    """计算所有JS、CSS和HTML文件的MD5值，生成统一的版本戳"""
    global global_version_cache
    
    # 如果缓存中有版本戳且不强制刷新，直接返回
    if global_version_cache and not force_refresh:
        return global_version_cache
    
    md5_list = []
    
    # 遍历静态文件夹中的JS和CSS文件
    for root, dirs, files in os.walk(STATIC_DIR):
        for file in files:
            if file.endswith(('.js', '.css')):
                file_path = os.path.join(root, file)
                md5_list.append(get_file_md5(file_path))
    
    # 遍历模板文件夹中的HTML文件
    for root, dirs, files in os.walk(TEMPLATE_DIR):
        for file in files:
            if file.endswith('.html'):
                file_path = os.path.join(root, file)
                md5_list.append(get_file_md5(file_path))
    
    # 将所有MD5值排序后连接，再计算一次MD5作为统一版本戳
    md5_list.sort()
    combined_md5 = hashlib.md5(''.join(md5_list).encode()).hexdigest()
    
    # 缓存版本戳
    global_version_cache = combined_md5
    
    return combined_md5

@app.template_filter('static_url')
def static_url(filename):
    """生成带有MD5版本号的静态文件URL（图片除外）
    
    图片资源由 Service Worker 的缓存策略管理，不需要版本参数。
    只有 CSS 和 JS 文件需要版本号以便在更新时强制刷新。
    """
    # 图片资源不添加版本号，由 Service Worker 缓存管理
    if filename.startswith('images/'):
        return url_for('static', filename=filename)
    
    # 获取静态文件的绝对路径
    file_path = os.path.join(STATIC_DIR, filename)
    # 计算文件的MD5值作为版本参数
    md5_value = get_file_md5(file_path)
    # 使用MD5值作为查询参数，确保只有文件内容变化时版本号才会改变
    return url_for('static', filename=filename, v=md5_value)

# 拦截静态文件请求，确保所有静态资源都有版本参数
@app.before_request
def ensure_static_version():
    """确保所有静态资源请求都带有版本参数（某些文件除外）"""
    if request.path.startswith('/static/'):
        # 不能通过重定向加载的资源和Service Worker不应该缓存的资源
        # 以下文件不需要版本参数，由缓存策略管理：
        # - service-worker.js: Service Worker 自己管理版本
        # - manifest.json: PWA 清单文件
        # - 图片资源: 静态图片由 Service Worker 永久缓存
        excluded_patterns = [
            'service-worker.js',
            'manifest.json',
            'images/',  # 所有图片资源由 Service Worker 缓存管理
        ]
        
        filename = request.path.replace('/static/', '', 1).split('?')[0]
        
        # 如果是排除的文件，不做重定向
        if any(filename.endswith(f) or f in filename for f in excluded_patterns):
            return None
        
        # 如果请求没有版本参数，重定向到带有版本参数的URL
        if 'v' not in request.args:
            # 计算文件的MD5值
            file_path = os.path.join(STATIC_DIR, filename)
            if os.path.exists(file_path):
                md5_value = get_file_md5(file_path)
                # 重定向到带有MD5版本参数的URL
                return redirect(request.path + '?v=' + md5_value)

@app.route('/favicon.ico')
def favicon():
    return send_file(os.path.join(STATIC_DIR, 'images', 'ICON_256.PNG'), mimetype='image/png')

@app.route('/api/version_check')
def api_version_check():
    """返回基于所有JS、CSS和HTML文件的统一版本戳"""
    # 获取是否强制刷新的参数
    force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'
    # 计算全局版本戳
    version = calculate_global_version(force_refresh=force_refresh)
    # 返回JSON响应
    return jsonify({
        'version': version
    })

@app.route('/api/clear-version-cache')
def clear_version_cache():
    """清除版本戳缓存，强制重新计算"""
    global global_version_cache
    global_version_cache = None
    return jsonify({
        'success': True,
        'message': 'Version cache cleared'
    })

# 为HTML响应添加缓存控制头，使用条件缓存确保获取最新版本
@app.after_request
def add_cache_control(response):
    """为HTML响应添加缓存控制头"""
    # 检查响应是否是HTML类型
    if response.content_type.startswith('text/html'):
        # 使用条件缓存，允许浏览器缓存但每次都会验证
        response.headers['Cache-Control'] = 'public, must-revalidate'
        # 设置ETag，用于快速比较内容是否变化
        if not response.headers.get('ETag'):
            # 基于响应内容生成简单的ETag
            import hashlib
            etag = hashlib.md5(response.data).hexdigest()
            response.headers['ETag'] = f'"{etag}"'
    return response

APP_AUTH_USER = os.environ.get('APP_AUTH_USER', 'admin')
APP_AUTH_PASSWORD = args.password

def _auth_failed():
    if request.path.startswith('/api/'):
        return jsonify({'success': False, 'error': 'unauthorized'}), 401
    return redirect(url_for('login', next=request.path))

@app.before_request
def require_auth():
    if not APP_AUTH_PASSWORD:
        return
    path = request.path or ''
    if path.startswith('/static') or path.startswith('/login') or path == '/favicon.ico':
        return
    if session.get('authed'):
        return
    return _auth_failed()

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    
    # 为Service Worker脚本添加特殊头，允许全局scope
    if request.path.endswith('service-worker.js'):
        response.headers['Service-Worker-Allowed'] = '/'
    
    return response

@app.route('/login', methods=['GET', 'POST'])
def login():
    if not APP_AUTH_PASSWORD:
        return redirect(url_for('index'))
    error = None
    next_path = request.args.get('next') or '/'
    if request.method == 'POST':
        pwd = request.form.get('password') or ''
        # 兼容明文和SHA256哈希
        stored_hash = hashlib.sha256(APP_AUTH_PASSWORD.encode()).hexdigest()
        if pwd == APP_AUTH_PASSWORD or pwd.lower() == stored_hash.lower():
            session['authed'] = True
            if request.form.get('remember'):
                session.permanent = True
            else:
                session.permanent = False
            return redirect(next_path)
        else:
            error = '密码错误'
    return render_template('login.html', error=error, next_path=next_path)

@app.route('/logout')
def logout():
    session.pop('authed', None)
    session.clear()
    resp = make_response(redirect(url_for('login')))
    resp.delete_cookie(app.config.get('SESSION_COOKIE_NAME', 'session'))
    return resp

# --- 数据库管理 ---
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    def _init_db_core():
        with get_db() as conn:
            # 检查旧模式并迁移
            try:
                cursor = conn.execute("SELECT path FROM songs LIMIT 1")
            except Exception:
                conn.execute("DROP TABLE IF EXISTS songs")
                conn.execute("DROP TABLE IF EXISTS mount_files")

            conn.execute('''
                CREATE TABLE IF NOT EXISTS songs (
                    id TEXT PRIMARY KEY,
                    path TEXT UNIQUE,
                    filename TEXT,
                    title TEXT,
                    artist TEXT,
                    album TEXT,
                    mtime REAL,
                    size INTEGER,
                    has_cover INTEGER DEFAULT 0
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS favorite_playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    is_default INTEGER DEFAULT 0,
                    created_at REAL
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS favorites (
                   song_id TEXT,
                   playlist_id TEXT,
                   title TEXT DEFAULT '',
                   artist TEXT DEFAULT '',
                   created_at REAL,
                   PRIMARY KEY (song_id, playlist_id)
                )
            ''')
            
            # 检查是否已有默认收藏夹，如果没有则创建
            default_count = conn.execute("SELECT COUNT(*) FROM favorite_playlists WHERE is_default = 1").fetchone()[0]
            if default_count == 0:
                conn.execute("INSERT INTO favorite_playlists (id, name, is_default, created_at) VALUES (?, ?, ?, ?)", 
                           ('default', '默认收藏夹', 1, time.time()))
            conn.execute('''
                CREATE TABLE IF NOT EXISTS mount_points (
                    path TEXT PRIMARY KEY,
                    created_at REAL
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS system_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            ''')
            
            # 清理错误索引的非音频文件
            try:
                placeholders = ' OR '.join([f"filename NOT LIKE '%{ext}'" for ext in AUDIO_EXTS])
                conn.execute(f"DELETE FROM songs WHERE {placeholders}")
            except: pass
            
            conn.commit()

    try:
        _init_db_core()
        logger.info("数据库初始化完成。")
    except Exception as e:
        logger.error(f"数据库初始化失败: {e}，尝试重建数据库...")
        try:
            if os.path.exists(DB_PATH):
                os.remove(DB_PATH)
            _init_db_core()
            logger.info("数据库重建完成。")
        except Exception as e2:
             logger.exception(f"数据库重建失败: {e2}")

# --- 元数据提取 ---
def get_metadata(file_path):
    metadata = {'title': None, 'artist': None, 'album': None}
    try:
        audio = None
        try:
            audio = EasyID3(file_path)
        except Exception as e1:
            try:
                audio = File(file_path, easy=True)
            except Exception as e2:
                audio = File(file_path)
                logger.warning(f"文件 {file_path} 元数据解析异常: {e2}")
        if audio:
            def get_tag(key):
                val = None
                # Method 1: Direct .get (EasyID3 etc)
                if hasattr(audio, 'get'):
                    val = audio.get(key)
                # Method 2: via .tags (FLAC etc)
                elif hasattr(audio, 'tags') and audio.tags:
                    val = audio.tags.get(key)
                    # Try uppercase for Vorbis comments if standard key fails
                    if not val:
                        val = audio.tags.get(key.upper())
                
                if val:
                    if isinstance(val, list):
                        val = val[0]
                    # 确保返回值是字符串类型，处理ASFUnicodeAttribute等特殊类型
                    if val is not None and not isinstance(val, str):
                        val = str(val)
                    return val
                return None
            metadata['title'] = get_tag('title')
            metadata['artist'] = get_tag('artist')
            metadata['album'] = get_tag('album')
    except Exception as e:
        logger.error(f"提取元数据失败: {file_path}, 错误: {e}")
    filename = os.path.splitext(os.path.basename(file_path))[0]
    if not metadata['title']:
        if ' - ' in filename:
            parts = filename.split(' - ', 1)
            if not metadata['artist']: metadata['artist'] = parts[0].strip()
            metadata['title'] = parts[1].strip()
        else:
            metadata['title'] = filename
    if not metadata['artist']: metadata['artist'] = "未知艺术家"
    logger.debug(f"文件 {file_path} 元数据: {metadata}")
    return metadata

def extract_embedded_cover(file_path: str, base_name: str = None):
    """提取音频内嵌封面并保存为 covers/<base_name>.jpg，成功返回 True。"""
    try:
        if not os.path.exists(file_path):
            return False
        base_name = base_name or os.path.splitext(os.path.basename(file_path))[0]
        cover_dir = os.path.join(MUSIC_LIBRARY_PATH, 'covers')
        os.makedirs(cover_dir, exist_ok=True)
        target_path = os.path.join(cover_dir, f"{base_name}.jpg")
        if os.path.exists(target_path):
            return True

        audio = File(file_path)
        if not audio:
            return False

        data = None

        # MP3 / ID3
        if hasattr(audio, 'tags') and audio.tags:
            if hasattr(audio.tags, 'getall'):
                for tag in audio.tags.getall('APIC'):
                    if getattr(tag, 'data', None):
                        data = tag.data
                        break
            if not data:
                covr = audio.tags.get('covr')
                if covr:
                    val = covr[0] if isinstance(covr, (list, tuple)) else covr
                    try:
                        data = bytes(val)
                    except Exception:
                        pass

        # FLAC / 其他
        if not data and hasattr(audio, 'pictures'):
            pics = getattr(audio, 'pictures') or []
            if pics:
                data = pics[0].data

        if not data:
            logger.info(f"未找到内嵌封面: {file_path}")
            return False

        with open(target_path, 'wb') as f:
            f.write(data)
        logger.info(f"内嵌封面提取并保存: {target_path}")
        return True
    except Exception as e:
        logger.warning(f"提取内嵌封面失败: {file_path}, 错误: {repr(e)}")
        return False

def extract_embedded_lyrics(file_path: str):
    """提取音频内嵌歌词，返回歌词字符串或 None。"""
    try:
        if not os.path.exists(file_path):
            return None
        
        audio = File(file_path)
        if not audio:
            return None

        # 1. MP3 / ID3 (USLT)
        if hasattr(audio, 'tags') and isinstance(audio.tags, ID3):
            for key in audio.tags.keys():
                if key.startswith('USLT'):
                    return audio.tags[key].text
        
        # 2. FLAC / Vorbis Comments
        if hasattr(audio, 'tags'):
            lyrics = audio.tags.get('lyrics') or audio.tags.get('LYRICS') or audio.tags.get('unsyncedlyrics') or audio.tags.get('UNSYNCEDLYRICS')
            if lyrics:
                return lyrics[0]
                
        # 3. M4A / MP4
        if hasattr(audio, 'tags') and '©lyr' in audio.tags:
             return audio.tags['©lyr'][0]

    except Exception as e:
        logger.warning(f"提取内嵌歌词失败: {file_path}, 错误: {repr(e)}")
    return None

def fetch_cover_bytes(url: str):
    if not url:
        return None
    try:
        resp = requests.get(url, timeout=8, headers=COMMON_HEADERS)
        if resp.status_code == 200 and resp.content:
            return resp.content
    except Exception as e:
        logger.warning(f"封面下载失败: {url}, 错误: {e}")
    return None

def embed_cover_to_file(audio_path: str, cover_bytes: bytes):
    """将封面嵌入音频文件（支持 mp3/flac/m4a）。"""
    if not cover_bytes or not os.path.exists(audio_path):
        return
    ext = os.path.splitext(audio_path)[1].lower()
    try:
        if ext == '.mp3':
            audio = None
            try:
                audio = ID3(audio_path)
            except Exception:
                audio = File(audio_path)
                audio.add_tags()
                audio.save()
                audio = ID3(audio_path)
            if audio:
                audio.delall('APIC')
                audio.add(APIC(mime='image/jpeg', type=3, desc='Cover', data=cover_bytes))
                audio.save()
        elif ext == '.flac':
            audio = FLAC(audio_path)
            pic = Picture()
            pic.data = cover_bytes
            pic.type = 3
            pic.mime = 'image/jpeg'
            audio.clear_pictures()
            audio.add_picture(pic)
            audio.save()
        elif ext in ('.m4a', '.m4b', '.m4p'):
            audio = MP4(audio_path)
            fmt = MP4Cover.FORMAT_JPEG
            if cover_bytes.startswith(b'\x89PNG'):
                fmt = MP4Cover.FORMAT_PNG
            audio['covr'] = [MP4Cover(cover_bytes, fmt)]
            audio.save()
    except Exception as e:
        logger.warning(f"内嵌封面失败: {audio_path}, 错误: {e}")

def save_cover_file(cover_bytes: bytes, base_name: str):
    if not cover_bytes or not base_name:
        return None
    try:
        cover_dir = os.path.join(MUSIC_LIBRARY_PATH, 'covers')
        os.makedirs(cover_dir, exist_ok=True)
        cover_path = os.path.join(cover_dir, f"{base_name}.jpg")
        with open(cover_path, 'wb') as f:
            f.write(cover_bytes)
        return cover_path
    except Exception as e:
        logger.warning(f"封面保存失败: {base_name}, 错误: {e}")
        return None

def fetch_netease_lyrics(song_id: str):
    """返回 (lrc, yrc) 字符串；若无则为 None。"""
    if not song_id:
        return None, None
    lrc_text = None
    yrc_text = None
    try:
        lyr_resp = call_netease_api('/lyric/new', {'id': song_id}, need_cookie=False)
        if isinstance(lyr_resp, dict):
            yrc_text = (lyr_resp.get('yrc') or {}).get('lyric')
            lrc_text = (lyr_resp.get('lrc') or {}).get('lyric')
        if not lrc_text:
            old_resp = call_netease_api('/lyric', {'id': song_id}, need_cookie=False)
            if isinstance(old_resp, dict):
                lrc_text = (old_resp.get('lrc') or {}).get('lyric') or lrc_text
                if not yrc_text:
                    yrc_text = (old_resp.get('yrc') or {}).get('lyric')
    except Exception as e:
        logger.warning(f"获取网易歌词失败: {e}")
    return lrc_text, yrc_text

def embed_lyrics_to_file(audio_path: str, lrc_text: str):
    """将歌词嵌入音频（行级歌词）。"""
    if not lrc_text or not os.path.exists(audio_path):
        return
    ext = os.path.splitext(audio_path)[1].lower()
    try:
        if ext == '.mp3':
            try:
                tags = ID3(audio_path)
            except Exception:
                tags = File(audio_path)
                tags.add_tags()
                tags.save()
                tags = ID3(audio_path)
            tags.delall('USLT')
            tags.add(USLT(encoding=3, lang='chi', desc='Lyric', text=lrc_text))
            tags.save()
        elif ext == '.flac':
            audio = FLAC(audio_path)
            audio['LYRICS'] = lrc_text
            audio.save()
        elif ext in ('.m4a', '.m4b', '.m4p'):
            audio = MP4(audio_path)
            audio['\xa9lyr'] = lrc_text
            audio.save()
        elif ext in ('.ogg', '.oga'):
            audio = File(audio_path)
            audio['LYRICS'] = lrc_text
            audio.save()
    except Exception as e:
        logger.warning(f"内嵌歌词失败: {audio_path}, 错误: {e}")

AUDIO_EXTS = ('.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a')

def index_single_file(file_path):
    """单独索引一个文件。"""
    try:
        if not os.path.exists(file_path): return
        # 严格限制只能索引音频文件
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in AUDIO_EXTS: return
        
        stat = os.stat(file_path)
        meta = get_metadata(file_path)
        sid = generate_song_id(file_path)
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        base_path = os.path.splitext(file_path)[0]
        cover_path = os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base_name}.jpg")
        has_cover = 0
        if os.path.exists(base_path + ".jpg") or os.path.exists(cover_path):
            has_cover = 1
        else:
            # 尝试提取内嵌封面
            if extract_embedded_cover(file_path, base_name):
                has_cover = 1
        
        with get_db() as conn:
            # 全局去重检测
            dup = conn.execute("SELECT path FROM songs WHERE filename=? AND size=? AND path!=?", (os.path.basename(file_path), stat.st_size, file_path)).fetchone()
            if dup:
                logger.info(f"索引: 跳过重复文件 {file_path} (已存在: {dup['path']})")
                return

            conn.execute('''
                INSERT OR REPLACE INTO songs (id, path, filename, title, artist, album, mtime, size, has_cover)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (sid, file_path, os.path.basename(file_path), meta['title'], meta['artist'], meta['album'], stat.st_mtime, stat.st_size, has_cover))
            conn.commit()
        logger.info(f"单文件索引完成: {file_path}")
    except Exception as e:
        logger.error(f"单文件索引失败: {e}")

def scrape_single_song(item, idx, total):
    """单独刮削一首歌曲的任务函数"""
    song = item['song']
    
    # Update current path for UI (approximate due to concurrency)
    SCAN_STATUS['current_path'] = song['path']
    
    try:
        # 0. 先尝试提取内嵌封面 (Fix: 优先使用内嵌封面，避免无效刮削)
        if item['need_cover']:
             if extract_embedded_cover(song['path']):
                with get_db() as conn:
                    conn.execute("UPDATE songs SET has_cover=1 WHERE id=?", (song['id'],))
                    conn.commit()
                logger.info(f"刮削时发现内嵌封面，已提取: {song['title']}")
                item['need_cover'] = False # 已解决封面，不再网络下载封面

        # 如果内嵌封面解决了封面问题，且不需要歌词，则直接返回
        if not item['need_cover'] and not item['need_lyrics']:
            return

        # 搜索 (增加重试机制)
        results = None
        # Helper functions
        def any_has_cover(res_list):
            for r in res_list:
                try:
                    if r['cover']: return True
                except:
                    try:
                        if r.get('cover'): return True
                    except: pass
            return False

        def any_has_lyrics(res_list):
            for r in res_list:
                try:
                    val = r['lyrics'] if 'lyrics' in r else r.get('lyrics')
                    if val: return True
                except: pass
            return False

        def is_satisfied(res_list):
            ok_cover = not item['need_cover'] or any_has_cover(res_list)
            ok_lyrics = not item['need_lyrics'] or any_has_lyrics(res_list)
            return ok_cover and ok_lyrics

        # 搜索 (顺序尝试: QQ音乐 -> 网易云 -> 酷狗)
        results = []
        providers = [mod.searchx.qq, mod.searchx.netease, mod.searchx.kugou]
        
        for attempt in range(3):
            results = [] 
            
            found_satisfactory = False
            for prov in providers:
                try:
                    # 1. Strict Search
                    p_res = prov.search(title=song['title'], artist=song['artist'], album=song['album'])
                    if p_res:
                        results.extend(p_res)
                    
                    if is_satisfied(results):
                        found_satisfactory = True
                        break
                    
                    # 2. Loose Search
                    if item['need_cover'] and not any_has_cover(results) and song['album']:
                         l_res = prov.search(title=song['title'], artist=song['artist'], album='')
                         if l_res:
                             results.extend(l_res)
                         
                         if is_satisfied(results):
                             found_satisfactory = True
                             break
                except Exception as e:
                    logger.warning(f"Provider {prov.__name__} failed: {e}")
            
            if results:
                break
            
            if attempt < 2:
                time.sleep(1) # Delay between retries

        if not results:
            with scan_status_lock:
                 SCAN_STATUS['failed'] = SCAN_STATUS.get('failed', 0) + 1
            return
        
        # 标记是否发生部分失败（例如没找到封面或歌词）
        is_partial_fail = False

        # 处理歌词
        if item['need_lyrics']:
            found_lyrics = None
            for res in results:
                try:
                    # Try accessing 'lyrics' safely
                    rec_lyrics = res['lyrics'] if 'lyrics' in res else res.get('lyrics')
                    if rec_lyrics:
                        found_lyrics = rec_lyrics
                        break
                except:
                   pass
            
            if found_lyrics:
                base_name = os.path.splitext(song['filename'])[0]
                save_lrc_path = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', f"{base_name}.lrc")
                try:
                    with open(save_lrc_path, 'w', encoding='utf-8') as f:
                        f.write(found_lyrics)
                    logger.info(f"自动保存歌词成功: {save_lrc_path}")
                except Exception as e:
                    logger.warning(f"保存歌词失败: {e}")
                    is_partial_fail = True
            else:
                 # Needed lyrics but didn't find them
                 is_partial_fail = True

        # 处理封面
        if item['need_cover']:
            found_cover = None
            for res in results:
                try:
                     rec_cover = res['cover'] if 'cover' in res else res.get('cover')
                     if rec_cover:
                         found_cover = rec_cover
                         break
                except:
                     pass
            
            if found_cover:
                base_name = os.path.splitext(song['filename'])[0]
                local_cover_path = os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base_name}.jpg")
                try:
                    resp = requests.get(found_cover, timeout=10, headers=COMMON_HEADERS)
                    if resp.status_code == 200:
                        with open(local_cover_path, 'wb') as f:
                            f.write(resp.content)
                        # 更新数据库
                        with get_db() as conn:
                            conn.execute("UPDATE songs SET has_cover=1 WHERE id=?", (song['id'],))
                            conn.commit()
                        logger.info(f"自动保存封面成功: {local_cover_path}")
                    else:
                        logger.warning(f"下载封面失败: {resp.status_code} - {found_cover}")
                        is_partial_fail = True
                except Exception as e:
                    logger.warning(f"下载封面异常: {e}")
                    is_partial_fail = True
            else:
                logger.info(f"结果中未包含封面: {song['title']}")
                is_partial_fail = True
        
        if is_partial_fail:
             with scan_status_lock:
                 SCAN_STATUS['failed'] = SCAN_STATUS.get('failed', 0) + 1
    
    except Exception as e:
        logger.warning(f"刮削单曲失败 {song['title']}: {e}")
        with scan_status_lock:
             SCAN_STATUS['failed'] = SCAN_STATUS.get('failed', 0) + 1
    finally:
        # 更新状态 (移至finally块，确保只有在处理完成后才更新进度，且使用锁保证线程安全)
        with scan_status_lock:
            current_processed = SCAN_STATUS.get('processed', 0) + 1
            SCAN_STATUS['processed'] = current_processed
            # 减少日志刷屏，只在5的倍数或完成时更新
            if current_processed % 5 == 0 or current_processed >= total:
                SCAN_STATUS['current_file'] = "刮削中..."


def auto_scrape_missing_metadata(target_dir=None):
    """后台任务：自动刮削缺失的封面和歌词"""
    with app.app_context():
        logger.info(f"开始自动刮削缺失元数据... {f'(目录: {target_dir})' if target_dir else ''}")
        SCAN_STATUS['current_file'] = "正在准备自动刮削..."
        SCAN_STATUS['is_scraping'] = True
        SCAN_STATUS['processed'] = 0
        SCAN_STATUS['total'] = 0
        
        try:
            songs_to_scrape = []
            with get_db() as conn:
                sql = "SELECT id, path, title, artist, album, filename, has_cover FROM songs"
                params = ()
                if target_dir:
                    sql += " WHERE path LIKE ? || '%'"
                    params = (target_dir,)
                cursor = conn.execute(sql, params)
                all_songs = cursor.fetchall()

            for song in all_songs:
                # 检查封面
                need_cover = (song['has_cover'] == 0)
                
                # 检查歌词
                base_name = os.path.splitext(song['filename'])[0]
                lrc_path = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', f"{base_name}.lrc")
                need_lyrics = not os.path.exists(lrc_path)
                
                if need_cover or need_lyrics:
                    songs_to_scrape.append({
                        'song': song,
                        'need_cover': need_cover,
                        'need_lyrics': need_lyrics
                    })

            total = len(songs_to_scrape)
            if total == 0:
                logger.info("没有需要刮削的歌曲。")
                # 强制显示完成状态一段时间，让前端捕获
                SCAN_STATUS['current_file'] = "刮削完成"
                time.sleep(1.5)
                SCAN_STATUS['is_scraping'] = False
                return

            logger.info(f"发现 {total} 首歌曲需要刮削元数据")
            
            # 更新状态 total
            SCAN_STATUS['total'] = total
            SCAN_STATUS['processed'] = 0
            SCAN_STATUS['failed'] = 0

            # 使用线程池并发处理
            max_workers = 20  # 控制并发数，避免请求过快被封禁
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = []
                for idx, item in enumerate(songs_to_scrape):
                    # 提交任务
                    futures.append(executor.submit(scrape_single_song, item, idx, total))
                
                # 等待所有任务完成并捕获异常
                for future in concurrent.futures.as_completed(futures):
                    try:
                        future.result()
                    except Exception as e:
                        logger.error(f"刮削任务执行异常: {e}")

        except Exception as e:
            logger.error(f"自动刮削任务异常: {e}")
        finally:
            logger.info("自动刮削任务结束")
            
            # 强制停留完成状态 (带上失败统计)
            failed_count = SCAN_STATUS.get('failed', 0)
            if failed_count > 0:
                SCAN_STATUS['current_file'] = f"刮削完成 ({failed_count}首失败)"
            else:
                SCAN_STATUS['current_file'] = "刮削完成"
            
            time.sleep(1.5)
            
            # 只有当不在扫描文件时才重置状态，避免覆盖文件扫描的状态
            # 实际上由于是分离线程，这里重置可能会影响UI显示，但 current_file 为空通常表示空闲
            if not SCAN_STATUS.get('scanning', False):
                 SCAN_STATUS['current_file'] = ''
            SCAN_STATUS['is_scraping'] = False

@app.route('/api/mount_points/retry_scrape', methods=['POST'])
def retry_scrape_mount():
    try:
        path = request.json.get('path')
        if not path:
             return jsonify({'success': False, 'error': '未指定路径'})
        
        if SCAN_STATUS.get('is_scraping') or SCAN_STATUS.get('scanning'):
             return jsonify({'success': False, 'error': '后台任务进行中，请稍后'})
             
        threading.Thread(target=auto_scrape_missing_metadata, args=(path,), daemon=True).start()
        return jsonify({'success': True, 'message': '已开始重新刮削'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/mount_points/update', methods=['POST'])
def update_mount_point():
    try:
        path = request.json.get('path')
        if not path:
             return jsonify({'success': False, 'error': '未指定路径'})
        
        if SCAN_STATUS.get('is_scraping') or SCAN_STATUS.get('scanning'):
             return jsonify({'success': False, 'error': '后台任务进行中，请稍后'})
             
        threading.Thread(target=scan_directory_single, args=(path,), daemon=True).start()
        return jsonify({'success': True, 'message': '开始更新目录...'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def scan_directory_single(target_dir):
    """扫描指定目录并更新数据库"""
    global SCAN_STATUS
    
    if not os.path.exists(target_dir):
        logger.error(f"目录不存在: {target_dir}")
        return

    # Check lock (reuse logic partially or just check global status)
    if SCAN_STATUS.get('scanning'): return

    try:
        with app.app_context():
            SCAN_STATUS.update({'scanning': True, 'total': 0, 'processed': 0, 'current_file': '正在扫描目录...'})
            logger.info(f"开始单独扫描目录: {target_dir}")
            
            disk_files = {} # path -> info
            supported_exts = AUDIO_EXTS
            
            for root, dirs, files in os.walk(target_dir):
                 dirs[:] = [d for d in dirs if d not in ('lyrics', 'covers')]
                 for f in files:
                     if f.lower().endswith(supported_exts):
                         path = os.path.join(root, f)
                         try:
                             stat = os.stat(path)
                             info = {'mtime': stat.st_mtime, 'size': stat.st_size, 'path': path, 'filename': f}
                             disk_files[path] = info
                         except: pass

            with get_db() as conn:
                # 只获取相关路径的歌曲
                cursor = conn.cursor()
                # Assuming path stored in DB is absolute
                cursor.execute("SELECT id, path, mtime, size FROM songs WHERE path LIKE ? || '%'", (target_dir,))
                db_rows = {row['path']: row for row in cursor.fetchall()}
                
                to_delete_paths = set(db_rows.keys()) - set(disk_files.keys())
                if to_delete_paths:
                    cursor.executemany("DELETE FROM songs WHERE path=?", [(p,) for p in to_delete_paths])
                    conn.commit()

                files_to_process_list = []
                for path, info in disk_files.items():
                    db_rec = db_rows.get(path)
                    # If new or modified
                    if not db_rec or db_rec['mtime'] != info['mtime'] or db_rec['size'] != info['size']:
                        files_to_process_list.append(info)

                total_files = len(files_to_process_list)
                SCAN_STATUS.update({'total': total_files, 'processed': 0})
                
                to_update_db = []
                
                if total_files > 0:
                    def process_file_metadata(info):
                        # Simple inline version
                        SCAN_STATUS['current_path'] = info['path']
                        meta = get_metadata(info['path'])
                        sid = generate_song_id(info['path'])
                        base_path = os.path.splitext(info['path'])[0]
                        has_cover = 1 if os.path.exists(base_path + ".jpg") or os.path.exists(os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{os.path.basename(base_path)}.jpg")) else 0
                        if has_cover == 0:
                            if extract_embedded_cover(info['path']): has_cover = 1
                        # 确保所有元数据都是字符串类型，避免数据库绑定错误
                        title = str(meta['title']) if meta['title'] is not None else ''
                        artist = str(meta['artist']) if meta['artist'] is not None else ''
                        album = str(meta['album']) if meta['album'] is not None else ''
                        return (sid, info['path'], info['filename'], title, artist, album, info['mtime'], info['size'], has_cover)

                    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                         futures = {executor.submit(process_file_metadata, item): item for item in files_to_process_list}
                         for future in concurrent.futures.as_completed(futures):
                             try:
                                 res = future.result()
                                 to_update_db.append(res)
                             except Exception: pass
                             SCAN_STATUS['processed'] += 1
                             if SCAN_STATUS['processed'] % 5 == 0:
                                 SCAN_STATUS['current_file'] = f"处理中... {int((SCAN_STATUS['processed']/total_files)*100)}%"

                if to_update_db:
                    conn.executemany('''
                        INSERT OR REPLACE INTO songs (id, path, filename, title, artist, album, mtime, size, has_cover)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', to_update_db)
                    conn.commit()
            
            # Finally trigger scraping for missing metadata in this dir
            auto_scrape_missing_metadata(target_dir)

    except Exception as e:
        logger.exception(f"目录扫描失败: {e}")
    finally:
        SCAN_STATUS['scanning'] = False
        SCAN_STATUS['current_file'] = '扫描完成'
        SCAN_STATUS['processed'] = SCAN_STATUS['total']
        global LIBRARY_VERSION
        LIBRARY_VERSION = time.time()

# --- 优化后的并发扫描逻辑 ---
def scan_library_incremental():
    global SCAN_STATUS
    
    lock_file = os.path.join(MUSIC_LIBRARY_PATH, '.scan_lock')
    if os.path.exists(lock_file):
        if time.time() - os.path.getmtime(lock_file) > 300:
            try:
                os.remove(lock_file)
                logger.info("过期扫描锁文件已移除。")
            except Exception as e:
                logger.warning(f"移除扫描锁文件失败: {e}")
        else:
            return 

    try:
        with app.app_context():
            # 更新状态：开始
            SCAN_STATUS.update({'scanning': True, 'total': 0, 'processed': 0, 'current_file': '正在遍历文件...'})
            
            with open(lock_file, 'w') as f: f.write(str(time.time()))
            logger.info("开始增量扫描...")
            
            # 1. 获取所有扫描根目录
        scan_roots = [MUSIC_LIBRARY_PATH]
        try:
            with get_db() as conn:
                rows = conn.execute("SELECT path FROM mount_points").fetchall()
                scan_roots.extend([r['path'] for r in rows])
        except Exception: pass
        
        disk_files = {} # path -> info
        supported_exts = AUDIO_EXTS
        
        # 2. 遍历所有目录
        for root_dir in scan_roots:
            if not os.path.exists(root_dir): continue
            for root, dirs, files in os.walk(root_dir):
                # 排除自动生成的目录
                dirs[:] = [d for d in dirs if d not in ('lyrics', 'covers')]
                for f in files:
                    if f.lower().endswith(supported_exts):
                        path = os.path.join(root, f)
                        try:
                            stat = os.stat(path)
                            info = {'mtime': stat.st_mtime, 'size': stat.st_size, 'path': path, 'filename': f}
                            disk_files[path] = info
                        except: pass

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, path, mtime, size FROM songs")
            db_rows = {row['path']: row for row in cursor.fetchall()}
            
            # 删除不存在的文件
            # 注意：如果某个点被临时拔出，这里会删除其歌曲。
            # 简单起见：全量比对，消失即删除。
            to_delete_paths = set(db_rows.keys()) - set(disk_files.keys())
            if to_delete_paths:
                cursor.executemany("DELETE FROM songs WHERE path=?", [(p,) for p in to_delete_paths])
                conn.commit()

            # 筛选需要更新的文件
            files_to_process_list = []
            for path, info in disk_files.items():
                db_rec = db_rows.get(path)
                if not db_rec or db_rec['mtime'] != info['mtime'] or db_rec['size'] != info['size']:
                    files_to_process_list.append(info)

            # 更新状态
            total_files = len(files_to_process_list)
            SCAN_STATUS.update({'total': total_files, 'processed': 0})
            
            to_update_db = []
            
            # 3. 多线程处理
            if total_files > 0:
                logger.info(f"使用线程池处理 {total_files} 个文件...")
                
                def process_file_metadata(info):
                    # Update current path for UI
                    SCAN_STATUS['current_path'] = info['path']
                    
                    meta = get_metadata(info['path'])
                    sid = generate_song_id(info['path'])
                    # 封面逻辑
                    base_path = os.path.splitext(info['path'])[0]
                    # 检查本地是否有封面文件
                    has_cover = 1 if os.path.exists(base_path + ".jpg") or os.path.exists(os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{os.path.basename(base_path)}.jpg")) else 0
                    
                    # Fix: 如果没有外部封面，尝试提取内嵌封面
                    if has_cover == 0:
                        if extract_embedded_cover(info['path']):
                            has_cover = 1
                            
                    # 确保所有元数据都是字符串类型，避免数据库绑定错误
                    title = str(meta['title']) if meta['title'] is not None else ''
                    artist = str(meta['artist']) if meta['artist'] is not None else ''
                    album = str(meta['album']) if meta['album'] is not None else ''
                    return (sid, info['path'], info['filename'], title, artist, album, info['mtime'], info['size'], has_cover)

                with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                    futures = {executor.submit(process_file_metadata, item): item for item in files_to_process_list}
                    for future in concurrent.futures.as_completed(futures):
                        try:
                            res = future.result()
                            to_update_db.append(res)
                        except Exception: pass
                        
                        SCAN_STATUS['processed'] += 1
                        if SCAN_STATUS['processed'] % 10 == 0:
                            SCAN_STATUS['current_file'] = f"处理中... {int((SCAN_STATUS['processed']/total_files)*100)}%"

                # 过滤重复文件 (批次内去重 + 数据库去重)
                final_update_db = []
                seen_in_batch = set() # (filename, size)

                for item in to_update_db:
                    # structure: (sid, path, filename, title, artist, album, mtime, size, has_cover)
                    # item[1]=path, item[2]=filename, item[7]=size
                    c_path, c_fname, c_size = item[1], item[2], item[7]
                    
                    # 1. 批次内查重
                    if (c_fname, c_size) in seen_in_batch:
                        logger.info(f"扫描: 跳过批次内重复文件 {c_path}")
                        continue
                        
                    # 2. 数据库查重 (排除自己)
                    # 注意: 这里使用 conn (外层已开启)
                    # 需要确保 conn 线程安全? sqlite3 单线程模式下需要注意。
                    # 但 Flask 这里的 conn 是 thread-local 还是? 
                    # scan_library_incremental 是后台任务，单线程执行 (executor 是处理 metadata 的)。
                    # "with get_db() as conn" 在上层。所以是安全的。
                    try:
                        dup = conn.execute("SELECT path FROM songs WHERE filename=? AND size=? AND path!=?", (c_fname, c_size, c_path)).fetchone()
                        if dup:
                            logger.info(f"扫描: 跳过全局重复文件 {c_path} (已存在: {dup['path']})")
                            continue
                    except Exception: pass
                    
                    seen_in_batch.add((c_fname, c_size))
                    final_update_db.append(item)

                if final_update_db:
                    cursor.executemany('''
                        INSERT OR REPLACE INTO songs (id, path, filename, title, artist, album, mtime, size, has_cover)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', final_update_db)
                    conn.commit()

        logger.info("扫描完成。")
        
        # --- 自动刮削缺失元数据 (后台独立线程) ---
        SCAN_STATUS['is_scraping'] = True
        SCAN_STATUS['current_file'] = "正在准备自动刮削..."
        threading.Thread(target=auto_scrape_missing_metadata).start()
        
        global LIBRARY_VERSION; LIBRARY_VERSION = time.time()
        
    except Exception as e:
        logger.error(f"扫描失败: {e}")
    finally:
        SCAN_STATUS['scanning'] = False
        SCAN_STATUS['current_file'] = ''
        if os.path.exists(lock_file): 
            try: os.remove(lock_file)
            except: pass

threading.Thread(target=lambda: (init_db(), scan_library_incremental()), daemon=True).start()
threading.Thread(target=init_watchdog, daemon=True).start()

# --- 路由定义 ---
@app.route('/')
def index():
    return render_template('index.html')

# --- 系统状态接口 ---
@app.route('/api/system/status')
def get_system_status():
    """返回当前扫描状态和进度"""
    status = dict(SCAN_STATUS)
    status['library_version'] = LIBRARY_VERSION
    return jsonify(status)

@app.route('/api/music', methods=['GET'])
def get_music_list():
    logger.info("API请求: 获取音乐列表")
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM songs ORDER BY title")
            songs = []
            seen = set()
            
            for row in cursor.fetchall():
                # 去重逻辑：如果 标题+歌手+大小 完全一致，视为重复文件，仅保留第一个
                # 这样可以解决不同目录下存放相同文件导致的列表重复问题
                unique_key = (row['title'], row['artist'], row['size'])
                if unique_key in seen:
                    continue
                seen.add(unique_key)
                
                album_art = None
                if row['has_cover']:
                    base_name = os.path.splitext(row['filename'])[0]
                    # 封面图链接带上 filename 参数仅作缓存区分，实际通过 scan 查找
                    album_art = f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(row['filename'])}"
                songs.append({
                    'id': row['id'], # 新增 ID
                    'filename': row['filename'], 'title': row['title'],
                    'artist': row['artist'], 'album': row['album'], 'album_art': album_art,
                    'mtime': row['mtime'], 'size': row['size']
                })
        logger.info(f"返回音乐数量: {len(songs)}")
        return jsonify({'success': True, 'data': songs})
    except Exception as e:
        logger.exception(f"获取音乐列表失败: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/music/play/<song_id>')
def play_music(song_id):
    try:
        with get_db() as conn:
            row = conn.execute("SELECT path, title, artist FROM songs WHERE id=?", (song_id,)).fetchone()
            if row:
                title = row['title'] or '未知'
                artist = row['artist'] or '未知'
                logger.info(f"API请求: 播放音乐 ID={song_id} ({title} - {artist})")
                if os.path.exists(row['path']):
                    return send_file(row['path'], conditional=True)
            else:
                logger.info(f"API请求: 播放音乐 ID={song_id}")
            
    except Exception as e:
        logger.error(f"播放失败: {e}")

    logger.warning(f"文件未找到或ID无效: {song_id}")
    return jsonify({'error': 'Not Found'}), 404

# --- 目录相关 ---
@app.route('/api/mount_points', methods=['GET'])
def list_mount_points():
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT path FROM mount_points ORDER BY created_at DESC").fetchall()
            return jsonify({'success': True, 'data': [row['path'] for row in rows]})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

def check_has_music(path):
    """检查目录是否包含音乐文件"""
    try:
        for root, _, files in os.walk(path):
            for f in files:
                if f.lower().endswith(AUDIO_EXTS):
                    return True
    except Exception:
        pass
    return False

@app.route('/api/mount_points', methods=['POST'])
def add_mount_point():
    logger.info("API请求: 添加目录路径点")
    try:
        path = request.json.get('path')
        if not path or not os.path.exists(path):
            return jsonify({'success': False, 'error': '路径不存在'})
            
        path = os.path.abspath(path)

        # 校验目录内容
        if not check_has_music(path):
            return jsonify({'success': False, 'error': '该目录及其子目录中未发现可识别的音乐文件'})
        
        with get_db() as conn:
            if conn.execute("SELECT 1 FROM mount_points WHERE path=?", (path,)).fetchone():
                return jsonify({'success': False, 'error': '已添加'})
            conn.execute("INSERT INTO mount_points (path, created_at) VALUES (?, ?)", (path, time.time()))
            conn.commit()

        # 刷新监听并触发扫描
        refresh_watchdog_paths()
        threading.Thread(target=scan_library_incremental, daemon=True).start()
        
        return jsonify({'success': True, 'message': '目录已添加，正在后台处理...'})
    except Exception as e:
        logger.exception(f"添加目录失败: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/mount_points', methods=['DELETE'])
def remove_mount_point():
    try:
        path = request.json.get('path')
        with get_db() as conn:
            # 清理该路径下的歌曲
            conn.execute("DELETE FROM songs WHERE path LIKE ? || '%'", (path,))
            conn.execute("DELETE FROM mount_points WHERE path=?", (path,))
            conn.commit()
            
        refresh_watchdog_paths()
        
        # 触发一次库版本更新
        global LIBRARY_VERSION; LIBRARY_VERSION = time.time()
            
        return jsonify({'success': True, 'message': '已移除'})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

# --- 资源获取 ---
COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Authorization': '2FMusic'
}
NETEASE_API_BASE_DEFAULT = os.environ.get('NETEASE_API_BASE', 'http://localhost:23236')
NETEASE_API_BASE = NETEASE_API_BASE_DEFAULT
NETEASE_DOWNLOAD_DIR = os.environ.get('NETEASE_DOWNLOAD_PATH', MUSIC_LIBRARY_PATH)
NETEASE_COOKIE = None
NETEASE_MAX_CONCURRENT = 20
LYRICS_DIR = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics')

os.makedirs(LYRICS_DIR, exist_ok=True)

def parse_cookie_string(cookie_str: str):
    """将 Set-Cookie 字符串解析为 requests 兼容的字典。"""
    if not cookie_str: 
        return {}
    cookies = {}
    # 只取 key=value 形式，忽略 Path/Expires 等属性
    for part in cookie_str.split(';'):
        if '=' in part:
            k, v = part.strip().split('=', 1)
            if k.lower() in ('path', 'expires', 'max-age', 'domain', 'samesite', 'secure'): 
                continue
            cookies[k] = v
    return cookies

def normalize_cookie_string(raw: str) -> str:
    """规范化 cookie 字符串，移除换行并过滤非关键属性。"""
    if not raw: 
        return ''
    parts = []
    # 常见的 Set-Cookie 属性，不应出现在请求头 Cookie 中
    skip_keys = ('path', 'expires', 'max-age', 'domain', 'samesite', 'secure', 'httponly')
    
    for part in raw.replace('\n', ';').split(';'):
        part = part.strip()
        if not part: continue
        
        # 忽略没有等号的属性 (如 Secure, HttpOnly)
        if '=' not in part: 
            # 但有些 cookie 值可能就是没有等号？不太可能，标准cookie都是 k=v
            # 如果是 Secure/HttpOnly 这种flag，肯定要忽略
            continue
            
        k, v = part.split('=', 1)
        if k.strip().lower() in skip_keys:
            continue
            
        parts.append(part)
        
    return '; '.join(parts)

def load_netease_cookie():
    global NETEASE_COOKIE
    try:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM system_settings WHERE key='netease_cookie'").fetchone()
            if row and row['value']:
                NETEASE_COOKIE = normalize_cookie_string(row['value'])
    except Exception as e:
        logger.warning(f"读取网易云 cookie 失败: {e}")

def save_netease_cookie(cookie_str: str):
    global NETEASE_COOKIE
    NETEASE_COOKIE = normalize_cookie_string(cookie_str or '')
    try:
        with get_db() as conn:
            conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", ('netease_cookie', NETEASE_COOKIE))
            conn.commit()
    except Exception as e:
        logger.warning(f"保存网易云 cookie 失败: {e}")

def load_netease_config():
    global NETEASE_DOWNLOAD_DIR, NETEASE_API_BASE
    try:
        with get_db() as conn:
            # Download Dir
            row = conn.execute("SELECT value FROM system_settings WHERE key='netease_download_dir'").fetchone()
            if row and row['value']: NETEASE_DOWNLOAD_DIR = row['value']
            
            # API Base
            row = conn.execute("SELECT value FROM system_settings WHERE key='netease_api_base'").fetchone()
            if row and row['value']: NETEASE_API_BASE = row['value']
            
            # Quality - REMOVED
            
    except Exception as e:
        logger.warning(f"读取网易云配置失败: {e}")

def save_netease_config(download_dir: str = None, api_base: str = None): # Removed quality parameter
    global NETEASE_DOWNLOAD_DIR, NETEASE_API_BASE
    if download_dir: NETEASE_DOWNLOAD_DIR = download_dir
    if api_base: NETEASE_API_BASE = api_base.rstrip('/') or NETEASE_API_BASE_DEFAULT
    # if quality: NETEASE_QUALITY = quality # Removed quality processing
    
    try:
        with get_db() as conn:
            if download_dir:
                conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", ('netease_download_dir', NETEASE_DOWNLOAD_DIR))
            if api_base:
                conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", ('netease_api_base', NETEASE_API_BASE))
            # if quality: # Removed quality processing
            #     conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", ('netease_quality', NETEASE_QUALITY))
            conn.commit()
    except Exception as e:
        logger.warning(f"保存网易云配置失败: {e}")

def sanitize_filename(name: str) -> str:
    """移除非法字符，避免文件名错误。"""
    cleaned = re.sub(r'[\\/:*?"<>|]+', '_', name).strip().strip('.')
    return cleaned or 'netease_song'

def call_netease_api(path: str, params: dict, method: str = 'GET', need_cookie: bool = True):
    """调用本地网易云 API，统一处理错误。"""
    base = (NETEASE_API_BASE or NETEASE_API_BASE_DEFAULT).rstrip('/')
    url = f"{base}{path}"
    headers = dict(COMMON_HEADERS)
    params = dict(params or {})
    cookies = {}
    if need_cookie and NETEASE_COOKIE:
        # 直接透传原始 cookie 字符串，保证完整性
        headers['Cookie'] = NETEASE_COOKIE
        # 部分接口（如 login/status）需要 cookie 字符串参数
        params.setdefault('cookie', NETEASE_COOKIE)
        cookies = parse_cookie_string(NETEASE_COOKIE)
    if method.upper() == 'POST':
        resp = requests.post(url, data=params, timeout=10, headers=headers, cookies=cookies)
    else:
        resp = requests.get(url, params=params, timeout=10, headers=headers, cookies=cookies)
    resp.raise_for_status()
    return resp.json()

def _extract_song_level(privilege: dict):
    """返回(用户可下载的最高音质, 曲目最高音质)。"""
    privilege = privilege or {}
    def _norm(val):
        if not val:
            return 'standard'
        v = str(val).lower()
        if v == 'none': return 'standard'
        # Map numeric maxbr to levels
        if v.isdigit():
            br = int(v)
            if br >= 999000: return 'lossless'
            if br >= 320000: return 'exhigh'
            if br >= 192000: return 'higher'
            return 'standard'
        return v
    
    max_br = privilege.get('maxBrLevel') or privilege.get('maxbr') or privilege.get('maxLevel')
    max_level = _norm(max_br)
    user_level = _norm(privilege.get('dlLevel') or privilege.get('plLevel') or max_level)
    return (user_level or 'standard', max_level or user_level or 'standard')

def _extract_song_size(track: dict): # Removed preferred parameter
    """根据期望音质优先取对应大小（字节），找不到再按从低到高回退。"""
    if not track:
        return None
    level = 'exhigh' # Default to exhigh
    # 映射期望音质到字段优先级（标准优先用 l）
    prefer_map = {
        'standard': ('l', 'm', 'h', 'sq', 'hr'),
        'higher': ('m', 'h', 'sq', 'hr'),
        'exhigh': ('h', 'sq', 'hr', 'm'),
        'lossless': ('sq', 'hr', 'h', 'm'),
        'hires': ('hr', 'sq', 'h', 'm'),
        'jyeffect': ('sq', 'h', 'm'),
        'sky': ('hr', 'sq', 'h', 'm'),
        'dolby': ('hr', 'sq', 'h', 'm'),
        'jymaster': ('hr', 'sq', 'h', 'm')
    }
    orders = prefer_map.get(level) or ('l', 'm', 'h', 'sq', 'hr')
    for key in orders:
        data = track.get(key) or {}
        size = data.get('size')
        if size:
            try:
                return int(size)
            except Exception:
                continue
    return None

def _format_netease_songs(source_tracks):
    """将网易云接口返回的曲目统一格式化。"""
    songs = []
    for item in source_tracks or []:
        sid = item.get('id')
        if not sid:
            continue
        fee = item.get('fee')
        privilege = item.get('privilege') or {}
        privilege_fee = privilege.get('fee')
        # 仅在明确 fee==1（VIP 曲目）时标记 VIP，避免 fee=8 的“会员高音质”误标
        is_vip = (fee == 1) or (privilege_fee == 1)
        user_level, max_level = _extract_song_level(privilege)
        artists = ' / '.join([a.get('name') for a in item.get('ar', []) if a.get('name')]) or '未知艺术家'
        album_info = item.get('al') or {}
        size_bytes = _extract_song_size(item) # Removed user_level parameter
        songs.append({
            'id': sid,
            'title': item.get('name') or f"未命名 {sid}",
            'artist': artists,
            'album': album_info.get('name') or '',
            'cover': (album_info.get('picUrl') or '').replace('http://', 'https://'),
            'duration': (item.get('dt') or 0) / 1000,
            'is_vip': is_vip,
            'level': user_level,
            'max_level': max_level,
            'size': size_bytes
        })
    return songs

def _resolve_netease_input(raw: str, prefer: str = None):
    """支持短链/长链/纯数字的资源解析，返回 {'type': 'song'|'playlist', 'id': '123'}。"""
    if not raw:
        return None
    prefer = prefer if prefer in ('song', 'playlist') else None
    text = str(raw).strip()

    # 处理纯数字直接返回
    if text.isdigit():
        return {'type': prefer or 'song', 'id': text}

    candidate = text
    # 链接补全 scheme
    if candidate.startswith(('music.163.com', 'y.music.163.com', '163cn.tv')):
        candidate = f"https://{candidate}"
    # 跟随短链跳转获取真实地址，兼容 163cn.tv
    if re.match(r'^https?://', candidate, re.I):
        def _follow(url):
            try:
                resp = requests.get(url, allow_redirects=True, timeout=8, headers=COMMON_HEADERS)
                return resp.url or url
            except Exception as e:
                logger.warning(f"网易云链接解析失败: {e}")
                return None

        followed = _follow(candidate)
        # 针对 163cn.tv 短链再尝试一次 HEAD，避免部分环境 GET 被拦截
        if not followed and '163cn.tv' in candidate:
            try:
                resp = requests.head(candidate, allow_redirects=True, timeout=6, headers=COMMON_HEADERS)
                followed = resp.url or resp.headers.get('Location')
            except Exception as e:
                logger.warning(f"网易云短链 HEAD 解析失败: {e}")
        if followed:
            candidate = followed

    def extract_from_url(url_str: str):
        parsed = urlparse(url_str)
        path = parsed.path or ''
        fragment = parsed.fragment or ''
        frag_path, frag_query = '', {}
        if fragment:
            if '?' in fragment:
                frag_path, frag_qs = fragment.split('?', 1)
                frag_query = parse_qs(frag_qs)
            else:
                frag_path = fragment
        query = parse_qs(parsed.query or '')

        def pick_id(qs):
            for key in ('id', 'songId', 'playlistId'):
                if qs.get(key):
                    return str(qs[key][0])
            return None

        rid = pick_id(query) or pick_id(frag_query)
        route_hint = None
        for seg in (path, frag_path):
            if 'playlist' in seg:
                route_hint = 'playlist'; break
            if 'song' in seg:
                route_hint = 'song'
        if not rid:
            m = re.search(r'/(song|playlist)/(\d+)', path)
            if not m and frag_path:
                m = re.search(r'(song|playlist)[^0-9]*(\d+)', frag_path)
            if m:
                route_hint = route_hint or m.group(1)
                rid = m.group(2)
        if not rid:
            m = re.search(r'id=(\d+)', url_str)
            if m:
                rid = m.group(1)
        if rid:
            return {'type': route_hint or prefer or 'song', 'id': rid}
        return None

    parsed = extract_from_url(candidate)
    if parsed:
        return parsed

    # 回退：直接在文本中寻找
    m = re.search(r'(playlist|song)[^0-9]*(\d+)', text, re.IGNORECASE)
    if m:
        return {'type': m.group(1).lower(), 'id': m.group(2)}
    m = re.search(r'(\d{5,})', text)
    if m:
        return {'type': prefer or 'song', 'id': m.group(1)}
    return None

def _fetch_playlist_songs(playlist_id: str):
    detail_resp = call_netease_api('/playlist/detail', {'id': playlist_id})
    playlist = detail_resp.get('playlist') if isinstance(detail_resp, dict) else None
    if not playlist:
        raise Exception('无法获取歌单信息')
    track_ids = [t.get('id') for t in playlist.get('trackIds', []) if t.get('id')]
    tracks = playlist.get('tracks') or []
    if not tracks and track_ids:
        ids_str = ','.join(map(str, track_ids[:300]))  # protect from huge lists
        song_detail = call_netease_api('/song/detail', {'ids': ids_str})
        tracks = song_detail.get('songs', []) if isinstance(song_detail, dict) else []
    songs = _format_netease_songs(tracks)
    return songs, playlist.get('name')

def _fetch_song_detail(song_id: str):
    detail_resp = call_netease_api('/song/detail', {'ids': song_id})
    songs = detail_resp.get('songs', []) if isinstance(detail_resp, dict) else []
    parsed = _format_netease_songs(songs)
    if not parsed:
        raise Exception('未获取到歌曲信息')
    return parsed

# 预加载网易云 cookie
load_netease_config()
load_netease_cookie()

@app.route('/api/music/lyrics')
def get_lyrics_api():
    logger.info("API请求: 获取歌词")
    title = request.args.get('title')
    artist = request.args.get('artist')
    filename = request.args.get('filename')
    if not title:
        logger.warning("歌词请求缺少title参数")
        return jsonify({'success': False})
    filename = unquote(filename) if filename else None
    
    # Resolve actual local path
    actual_path = None
    if filename:
        if os.path.isabs(filename) and os.path.exists(filename):
            actual_path = filename
        else:
            try:
                with get_db() as conn:
                    # Try to find path by filename in DB
                    row = conn.execute("SELECT path FROM songs WHERE filename=?", (os.path.basename(filename),)).fetchone()
                    if row and os.path.exists(row['path']):
                        actual_path = row['path']
            except Exception as e:
                logger.warning(f"查询歌曲路径失败: {e}")

    # 1. 优先读取本地 .lrc 文件
    lrc_path = None
    if actual_path:
        local_dir = os.path.dirname(actual_path)
        base_name = os.path.splitext(os.path.basename(actual_path))[0]
        # Check adjacent .lrc first
        adj_lrc = os.path.join(local_dir, f"{base_name}.lrc")
        if os.path.exists(adj_lrc): lrc_path = adj_lrc
        else:
             # Check lyrics folder
             lrc_path = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', f"{base_name}.lrc")

    if lrc_path and os.path.exists(lrc_path):
        try:
            with open(lrc_path, 'r', encoding='utf-8') as f:
                logger.info(f"本地歌词命中: {lrc_path}")
                return jsonify({'success': True, 'lyrics': f.read()})
        except Exception as e:
            logger.warning(f"读取本地歌词失败: {lrc_path}, 错误: {e}")

    # 2. 尝试提取内嵌歌词
    if actual_path:
        embedded_lrc = extract_embedded_lyrics(actual_path)
        if embedded_lrc:
            # Save to cache if possible
            try:
                # Prioritize saving to lyrics folder to avoid cluttering music dir if original is there
                save_dir = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics')
                os.makedirs(save_dir, exist_ok=True)
                base_name = os.path.splitext(os.path.basename(actual_path))[0]
                save_path = os.path.join(save_dir, f"{base_name}.lrc")
                with open(save_path, 'w', encoding='utf-8') as f:
                    f.write(embedded_lrc)
                logger.info(f"内嵌歌词提取并保存: {save_path}")
            except Exception as e:
                logger.warning(f"保存内嵌歌词失败: {e}")
            return jsonify({'success': True, 'lyrics': embedded_lrc})

    # 3. 网络获取 - Use integrated LrcApi
    # Determine save path for network lyrics
    save_lrc_path = None
    if actual_path:
        base_name = os.path.splitext(os.path.basename(actual_path))[0]
        save_lrc_path = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', f"{base_name}.lrc")
    elif filename:
        save_lrc_path = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', f"{os.path.splitext(os.path.basename(filename))[0]}.lrc")

    try:
        logger.info(f"本地调用 LrcApi 搜索歌词: title={title}, artist={artist}")
        result = mod.search_all(title=title, artist=artist, album='')
        best_lrc = result.get('lyrics') if result and result.get('lyrics') else None
        if best_lrc:
            if save_lrc_path:
                try:
                    os.makedirs(os.path.dirname(save_lrc_path), exist_ok=True)
                    with open(save_lrc_path, 'wb') as f:
                        f.write(best_lrc.encode('utf-8'))
                    logger.info(f"网络歌词保存: {save_lrc_path}")
                except Exception as e:
                    logger.warning(f"保存网络歌词失败: {e}")
            return jsonify({'success': True, 'lyrics': best_lrc})
        else:
            logger.warning(f"LrcApi 未找到歌词: {title}")
    except Exception as e:
        logger.warning(f"LrcApi 搜索歌词异常: {e}")

    logger.warning(f"歌词获取失败: {title} - {artist}")
    return jsonify({'success': False})

@app.route('/api/music/album-art')
def get_album_art_api():
    title = request.args.get('title')
    artist = request.args.get('artist') or ''
    filename = request.args.get('filename')
    
    if not title or not filename: return jsonify({'success': False})
    filename = unquote(filename)
    base_name = os.path.splitext(os.path.basename(filename))[0]
    
    local_path = os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base_name}.jpg")
    if os.path.exists(local_path):
        return jsonify({'success': True, 'album_art': f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(base_name)}"})

    # 优先尝试从音频内嵌封面提取
    actual_path = None
    if os.path.isabs(filename) and os.path.exists(filename):
        actual_path = filename
    else:
        try:
            with get_db() as conn:
                row = conn.execute("SELECT path FROM songs WHERE filename=?", (os.path.basename(filename),)).fetchone()
                if row and os.path.exists(row['path']):
                    actual_path = row['path']
        except Exception as e:
            logger.warning(f"查询歌曲路径失败: {e}")

    if actual_path and extract_embedded_cover(actual_path, base_name):
        try:
            if not os.path.isabs(filename):
                with get_db() as conn:
                    conn.execute("UPDATE songs SET has_cover=1 WHERE filename=?", (os.path.basename(filename),))
                    conn.commit()
        except Exception:
            pass
        return jsonify({'success': True, 'album_art': f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(base_name)}"})

    # 网络获取并保存 - Use integrated LrcApi
    try:
        logger.info(f"本地调用 LrcApi 搜索封面: title={title}, artist={artist}")
        result = mod.search_all(title=title, artist=artist, album='')
        cover_url = result.get('cover') if result and result.get('cover') else None
        if cover_url:
            logger.info(f"LrcApi 找到封面 URL: {cover_url}")
            try:
                resp = requests.get(cover_url, timeout=10, headers=COMMON_HEADERS)
                if resp.status_code == 200 and resp.headers.get('content-type', '').startswith('image/'):
                    with open(local_path, 'wb') as f: 
                        f.write(resp.content)
                    return jsonify({'success': True, 'album_art': f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(base_name)}"})
                else:
                    logger.warning(f"封面下载失败: {resp.status_code}")
            except Exception as dl_err:
                logger.warning(f"封面下载异常: {dl_err}")
        else:
            logger.warning("LrcApi 未找到封面")
    except Exception as e:
        logger.warning(f"LrcApi 搜索封面异常: {e}")
        
    return jsonify({'success': False})

@app.route('/api/music/delete/<song_id>', methods=['DELETE'])
def delete_file(song_id):
    try:
        # 1. 查询路径
        target_path = None
        with get_db() as conn:
            row = conn.execute("SELECT path FROM songs WHERE id=?", (song_id,)).fetchone()
            if row: target_path = row['path']
        
        if not target_path or not os.path.exists(target_path):
            return jsonify({'success': False, 'error': '文件未找到'})

        # 2. 执行删除
        # 永久删除操作。不管是主音乐库还是外部添加目录都执行物理删除。
        # 安全加固：仅允许删除特定后缀的文件，防止误删系统文件
        ALLOWED_DELETE_EXTS = {'.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'}
        _, ext = os.path.splitext(target_path)
        if ext.lower() not in ALLOWED_DELETE_EXTS:
             return jsonify({'success': False, 'error': f'为了安全，禁止删除 {ext} 类型的文件'})

        # 重试机制应对 Windows 文件锁
        for i in range(10):
            try:
                os.remove(target_path)
                break
            except PermissionError:
                if i < 9: time.sleep(0.2)
                else: return jsonify({'success': False, 'error': '文件正被占用，无法删除'})
        
        # 清理同级关联资源 (封面/歌词/逐字歌词)
        base = os.path.splitext(target_path)[0]
        for ext in ['.lrc', '.yrc', '.jpg']:
            try:
                if os.path.exists(base + ext): os.remove(base + ext)
            except: pass
            
        # 尝试清理主库下的 covers/lyrics
        filename = os.path.basename(target_path)
        base_name = os.path.splitext(filename)[0]
        
        # 清理封面
        try:
             cv_path = os.path.join(MUSIC_LIBRARY_PATH, 'covers', base_name + '.jpg')
             if os.path.exists(cv_path): os.remove(cv_path)
        except: pass

        # 清理歌词 (.lrc / .yrc)
        for lext in ['.lrc', '.yrc']:
            try:
                ly_path = os.path.join(MUSIC_LIBRARY_PATH, 'lyrics', base_name + lext)
                if os.path.exists(ly_path): os.remove(ly_path)
            except: pass
        
        # 4. 数据库清理 (Watchdog 也会做，但双重保障)
        with get_db() as conn:
            conn.execute("DELETE FROM songs WHERE path=?", (target_path,))
            conn.commit()
            
        return jsonify({'success': True})
    except Exception as e: 
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/music/clear_metadata', methods=['POST'])
@app.route('/api/music/clear_metadata/<song_id>', methods=['POST'])
def clear_metadata(song_id=None):
    """清除元数据（封面/歌词）。
    支持两种模式：
    1. URL带 song_id: 库内文件，清理并更新数据库。
    2. JSON带 path: 外部文件，仅通过路径清理缓存。
    统一只清理主音乐库 covers/lyrics 目录下的文件。
    """
    try:
        target_path = None
        
        # 模式1: ID模式
        if song_id:
            with get_db() as conn:
                row = conn.execute("SELECT path FROM songs WHERE id=?", (song_id,)).fetchone()
                if row: target_path = row['path']
        # 模式2: Path模式
        else:
            data = request.get_json() or {}
            target_path = data.get('path')

        if not target_path:
            return jsonify({'success': False, 'error': '未找到对应文件路径'})

        # 安全检查：确保路径在允许的范围内
        target_path = os.path.abspath(target_path)
        allowed_roots = [os.path.abspath(MUSIC_LIBRARY_PATH)]
        try:
            with get_db() as conn:
                rows = conn.execute("SELECT path FROM mount_points").fetchall()
                allowed_roots.extend([os.path.abspath(r['path']) for r in rows])
        except Exception: pass
        
        if not any(target_path.startswith(root) for root in allowed_roots):
            return jsonify({'success': False, 'error': '非法路径：仅允许操作音乐库内的文件'})

        # 核心逻辑：清理主库下的 centralized covers/lyrics
        filename = os.path.basename(target_path)
        base_name = os.path.splitext(filename)[0]
        deleted_count = 0
        
        for sub in ['lyrics', 'covers']:
            ext = '.lrc' if sub == 'lyrics' else '.jpg'
            sub_path = os.path.join(MUSIC_LIBRARY_PATH, sub, base_name + ext)
            try: 
                if os.path.exists(sub_path): 
                    os.remove(sub_path)
                    deleted_count += 1
            except: pass

        # 如果是库内文件（有song_id），还需要重置数据库状态
        if song_id:
            with get_db() as conn:
                conn.execute("UPDATE songs SET has_cover=0 WHERE id=?", (song_id,))
                conn.commit()
            
        logger.info(f"元数据已清除: {filename}, ID: {song_id}, 删除数: {deleted_count}")
        return jsonify({'success': True})
    except Exception as e: 
        logger.warning(f"元数据清除失败: {e}")
        return jsonify({'success': False, 'error': str(e)})

# --- 辅助接口 ---
@app.route('/api/music/covers/<cover_name>')
def get_cover(cover_name):
    cover_name = unquote(cover_name)
    path = os.path.join(MUSIC_LIBRARY_PATH, 'covers', cover_name)
    if os.path.exists(path): return send_file(path, mimetype='image/jpeg')
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/music/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({'success': False, 'error': '未收到文件'})
    file = request.files['file']
    if file.filename == '': return jsonify({'success': False, 'error': '文件名为空'})
    if file:
        filename = file.filename
        target_dir = request.form.get('target_dir') or MUSIC_LIBRARY_PATH
        target_dir = os.path.abspath(target_dir)
        # 仅允许保存到音乐库或已添加的目录（及其子目录）
        allowed_roots = [os.path.abspath(MUSIC_LIBRARY_PATH)]
        try:
            with get_db() as conn:
                rows = conn.execute("SELECT path FROM mount_points").fetchall()
                allowed_roots.extend([os.path.abspath(r['path']) for r in rows])
        except Exception:
            pass
        if not any(target_dir.startswith(root) for root in allowed_roots):
            return jsonify({'success': False, 'error': '无效保存路径，请先在目录管理中添加'})
        os.makedirs(target_dir, exist_ok=True)
        save_path = os.path.join(target_dir, filename)

        # 数据库查重
        try:
            with get_db() as conn:
                exists = conn.execute("SELECT 1 FROM songs WHERE path=?", (save_path,)).fetchone()
                if exists:
                    return jsonify({'success': False, 'error': '该文件已存在于当前目录下'})
                
                # 全局查重 (文件名 + 大小)
                file.seek(0, os.SEEK_END)
                file_size = file.tell()
                file.seek(0)
                
                dup = conn.execute("SELECT path FROM songs WHERE filename=? AND size=?", (filename, file_size)).fetchone()
                if dup:
                    return jsonify({'success': False, 'error': f'音乐库中已存在相同文件: {dup["path"]}'})

        except Exception as e:
            logger.error(f"查重失败: {e}")
            pass

        try:
            file.save(save_path)
            # 让 Watchdog 处理索引
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)})
    return jsonify({'success': False, 'error': '未知错误'})

@app.route('/api/music/import_path', methods=['POST'])
def import_music_by_path():
    try:
        data = request.json
        src_path = data.get('path')
        if not src_path or not os.path.exists(src_path): return jsonify({'success': False, 'error': '无效路径'})
        filename = os.path.basename(src_path)
        dst_path = os.path.join(MUSIC_LIBRARY_PATH, filename)
        # 查重 (与上传保持一致)
        if os.path.exists(dst_path):
             # 目标已存在 (文件名冲突)
             pass

        # 全局查重
        src_size = os.path.getsize(src_path)
        with get_db() as conn:
             dup = conn.execute("SELECT path FROM songs WHERE filename=? AND size=?", (filename, src_size)).fetchone()
             if dup:
                 # 如果已存在的文件就是目标位置的文件（即重复导入自己），则是允许的（当作刷新）
                 # 如果 duplicates path != dst_path -> 真正的异地重复 -> 报错
                 if dup['path'] != os.path.abspath(dst_path):
                     return jsonify({'success': False, 'error': f'音乐库中已存在相同文件: {dup["path"]}'})

        if not os.path.exists(dst_path):
            shutil.copy2(src_path, dst_path)
            # 立即索引，确保入库
            index_single_file(dst_path)
        
        # 计算预期的 ID (与扫描逻辑一致)
        song_id = generate_song_id(dst_path)
        return jsonify({'success': True, 'id': song_id, 'filename': filename})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

# --- 收藏夹接口 ---

# 获取所有收藏夹
@app.route('/api/favorite_playlists', methods=['GET'])
def get_favorite_playlists():
    logger.info("API请求: 获取所有收藏夹")
    try:
        with get_db() as conn:
            # 使用JOIN和COUNT计算每个收藏夹的歌曲数量
            rows = conn.execute("""
                SELECT fp.*, COUNT(f.song_id) as song_count
                FROM favorite_playlists fp
                LEFT JOIN favorites f ON fp.id = f.playlist_id
                GROUP BY fp.id
                ORDER BY fp.is_default DESC, fp.created_at ASC
            """).fetchall()
            # 将Row对象转换为字典
            playlists = [dict(row) for row in rows]
            logger.info(f"获取收藏夹成功，共 {len(playlists)} 个收藏夹")
            return jsonify({'success': True, 'data': playlists})
    except Exception as e:
        logger.error(f"获取收藏夹失败: {e}")
        return jsonify({'success': False, 'error': str(e)})

# 创建收藏夹
@app.route('/api/favorite_playlists', methods=['POST'])
def create_favorite_playlist():
    logger.info("API请求: 创建收藏夹")
    try:
        data = request.get_json()
        name = data.get('name')
        if not name:
            logger.warning("创建收藏夹失败: 收藏夹名称不能为空")
            return jsonify({'success': False, 'error': "收藏夹名称不能为空"})
        
        # 检查是否已存在同名收藏夹
        with get_db() as conn:
            existing = conn.execute("SELECT id FROM favorite_playlists WHERE name = ?", (name,)).fetchone()
            if existing:
                logger.warning(f"创建收藏夹失败: 已存在名为'{name}'的收藏夹")
                return jsonify({'success': False, 'error': f"已存在名为'{name}'的收藏夹"})
        
        playlist_id = f"{time.time()}_{uuid.uuid4().hex[:8]}"
        with get_db() as conn:
            conn.execute("INSERT INTO favorite_playlists (id, name, created_at) VALUES (?, ?, ?)", 
                        (playlist_id, name, time.time()))
            conn.commit()
        logger.info(f"创建收藏夹成功: {name} (ID: {playlist_id})")
        return jsonify({'success': True, 'data': {'id': playlist_id, 'name': name}})
    except Exception as e:
        logger.error(f"创建收藏夹失败: {e}")
        return jsonify({'success': False, 'error': "创建失败"})

# 删除收藏夹（默认收藏夹不能删除）
@app.route('/api/favorite_playlists/<playlist_id>', methods=['DELETE'])
def delete_favorite_playlist(playlist_id):
    logger.info(f"API请求: 删除收藏夹，ID: {playlist_id}")
    try:
        with get_db() as conn:
            # 检查是否是默认收藏夹
            is_default = conn.execute("SELECT is_default FROM favorite_playlists WHERE id=?", (playlist_id,)).fetchone()
            if is_default and is_default['is_default'] == 1:
                logger.warning(f"删除收藏夹失败: 默认收藏夹(ID: {playlist_id})不能删除")
                return jsonify({'success': False, 'error': "默认收藏夹不能删除"})
            
            # 获取收藏夹名称用于日志
            playlist_name = conn.execute("SELECT name FROM favorite_playlists WHERE id=?", (playlist_id,)).fetchone()
            playlist_name = playlist_name['name'] if playlist_name else '未知名称'
            
            # 删除收藏夹及其包含的所有收藏
            conn.execute("DELETE FROM favorites WHERE playlist_id=?", (playlist_id,))
            conn.execute("DELETE FROM favorite_playlists WHERE id=?", (playlist_id,))
            conn.commit()
        logger.info(f"删除收藏夹成功: {playlist_name} (ID: {playlist_id})")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"删除收藏夹失败，ID: {playlist_id}, 错误: {e}")
        return jsonify({'success': False, 'error': "删除失败"})

# 获取指定收藏夹中的所有歌曲
@app.route('/api/favorite_playlists/<playlist_id>/songs', methods=['GET'])
def get_playlist_songs(playlist_id):
    logger.info(f"API请求: 获取收藏夹歌曲，收藏夹ID: {playlist_id}")
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT song_id FROM favorites WHERE playlist_id=?", (playlist_id,)).fetchall()
            song_ids = [r['song_id'] for r in rows]
            logger.info(f"获取收藏夹歌曲成功，收藏夹ID: {playlist_id}，共 {len(song_ids)} 首歌曲")
            return jsonify({'success': True, 'data': song_ids})
    except Exception as e:
        logger.error(f"获取收藏夹歌曲失败，收藏夹ID: {playlist_id}, 错误: {e}")
        return jsonify({'success': False, 'error': str(e)})

# 添加歌曲到收藏夹
@app.route('/api/favorites', methods=['POST'])
def add_favorite():
    logger.info("API请求: 添加歌曲到收藏夹")
    try:
        data = request.get_json()
        song_id = data.get('song_id')
        playlist_id = data.get('playlist_id', 'default')  # 默认添加到默认收藏夹
        title = data.get('title', '')
        artist = data.get('artist', '')
        
        if not song_id:
            logger.warning("添加收藏失败: 歌曲ID不能为空")
            return jsonify({'success': False, 'error': "歌曲ID不能为空"})
        
        with get_db() as conn:
            conn.execute("INSERT OR IGNORE INTO favorites (song_id, playlist_id, title, artist, created_at) VALUES (?, ?, ?, ?, ?)", 
                        (song_id, playlist_id, title, artist, time.time()))
            conn.commit()
        logger.info(f"添加到收藏夹成功: 歌曲ID: {song_id} ({title} - {artist}) -> 收藏夹ID: {playlist_id}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"添加收藏失败: {e}")
        return jsonify({'success': False, 'error': "添加失败"})

# 从收藏夹移除歌曲
@app.route('/api/favorites', methods=['DELETE'])
def remove_favorite():
    logger.info("API请求: 从收藏夹移除歌曲")
    try:
        data = request.get_json()
        song_id = data.get('song_id')
        playlist_id = data.get('playlist_id', 'default')  # 默认从默认收藏夹移除
        
        if not song_id:
            logger.warning("取消收藏失败: 歌曲ID不能为空")
            return jsonify({'success': False, 'error': "歌曲ID不能为空"})
        
        with get_db() as conn:
            conn.execute("DELETE FROM favorites WHERE song_id=? AND playlist_id=?", (song_id, playlist_id))
            conn.commit()
        logger.info(f"从收藏夹移除成功: 歌曲ID: {song_id} <- 收藏夹ID: {playlist_id}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"取消收藏失败: {e}")
        return jsonify({'success': False, 'error': "移除失败"})

# 兼容旧版API，获取所有收藏歌曲（来自所有收藏夹）
@app.route('/api/favorites', methods=['GET'])
def get_favorites():
    logger.info("API请求: 获取所有收藏夹歌曲")
    try:
        with get_db() as conn:
            # 获取所有收藏夹中的歌曲ID（去重）
            rows = conn.execute("SELECT DISTINCT song_id FROM favorites").fetchall()
            song_ids = [r['song_id'] for r in rows]
            logger.info(f"获取所有收藏夹歌曲成功，共 {len(song_ids)} 首歌曲")
            return jsonify({'success': True, 'data': song_ids})
    except Exception as e:
        logger.error(f"获取所有收藏夹歌曲失败: {e}")
        return jsonify({'success': False, 'error': str(e)})

# 批量添加歌曲到收藏夹
@app.route('/api/favorites/batch', methods=['POST'])
def batch_add_favorites():
    logger.info("API请求: 批量添加歌曲到收藏夹")
    try:
        data = request.get_json()
        song_ids = data.get('song_ids', [])
        playlist_ids = data.get('playlist_ids', ['default'])
        songs = data.get('songs', {})  # 歌曲信息映射: {song_id: {title, artist}}
        
        if not song_ids:
            logger.warning("批量添加收藏失败: 歌曲ID列表不能为空")
            return jsonify({'success': False, 'error': "歌曲ID列表不能为空"})
        
        if not playlist_ids:
            logger.warning("批量添加收藏失败: 收藏夹ID列表不能为空")
            return jsonify({'success': False, 'error': "收藏夹ID列表不能为空"})
        
        successful_count = 0
        failed_count = 0
        
        with get_db() as conn:
            try:
                # 使用事务确保原子性
                for song_id in song_ids:
                    for playlist_id in playlist_ids:
                        try:
                            song_info = songs.get(song_id, {})
                            title = song_info.get('title', '')
                            artist = song_info.get('artist', '')
                            conn.execute("INSERT OR IGNORE INTO favorites (song_id, playlist_id, title, artist, created_at) VALUES (?, ?, ?, ?, ?)", 
                                        (song_id, playlist_id, title, artist, time.time()))
                            successful_count += 1
                        except Exception as e:
                            logger.warning(f"添加收藏失败: 歌曲{song_id}到收藏夹{playlist_id}: {e}")
                            failed_count += 1
                conn.commit()
            except Exception as e:
                logger.error(f"批量添加收藏事务失败: {e}")
                conn.rollback()
                return jsonify({'success': False, 'error': "批量添加失败，事务已回滚"})
        
        logger.info(f"批量添加歌曲成功: 成功{successful_count}条，失败{failed_count}条")
        return jsonify({'success': True, 'data': {'successful': successful_count, 'failed': failed_count}})
    except Exception as e:
        logger.error(f"批量添加收藏失败: {e}")
        return jsonify({'success': False, 'error': "批量添加失败"})

# 批量从收藏夹移除歌曲
@app.route('/api/favorites/batch', methods=['DELETE'])
def batch_remove_favorites():
    logger.info("API请求: 批量从收藏夹移除歌曲")
    try:
        data = request.get_json()
        song_ids = data.get('song_ids', [])
        playlist_ids = data.get('playlist_ids', [])
        
        if not song_ids:
            logger.warning("批量移除收藏失败: 歌曲ID列表不能为空")
            return jsonify({'success': False, 'error': "歌曲ID列表不能为空"})
        
        if not playlist_ids:
            logger.warning("批量移除收藏失败: 收藏夹ID列表不能为空")
            return jsonify({'success': False, 'error': "收藏夹ID列表不能为空"})
        
        successful_count = 0
        failed_count = 0
        
        with get_db() as conn:
            try:
                # 使用事务确保原子性
                for song_id in song_ids:
                    for playlist_id in playlist_ids:
                        try:
                            # 执行DELETE
                            cursor = conn.execute("DELETE FROM favorites WHERE song_id=? AND playlist_id=?", (song_id, playlist_id))
                            # 检查是否真的删除了行（rowcount > 0）
                            if cursor.rowcount > 0:
                                successful_count += 1
                                logger.debug(f"成功删除: 歌曲{song_id}从收藏夹{playlist_id}")
                            else:
                                # rowcount=0 说明没找到这个记录（可能已经被删除或不存在）
                                logger.warning(f"记录不存在或已删除: 歌曲{song_id}在收藏夹{playlist_id}")
                                successful_count += 1  # 视为成功（结果一致）
                        except Exception as e:
                            logger.warning(f"移除收藏失败: 歌曲{song_id}从收藏夹{playlist_id}: {e}")
                            failed_count += 1
                conn.commit()
                
                # 数据库验证：删除后查询确认记录不存在
                verify_failed = 0
                for song_id in song_ids:
                    for playlist_id in playlist_ids:
                        remaining = conn.execute(
                            "SELECT COUNT(*) as count FROM favorites WHERE song_id=? AND playlist_id=?", 
                            (song_id, playlist_id)
                        ).fetchone()
                        if remaining and remaining['count'] > 0:
                            verify_failed += 1
                            logger.error(f"验证失败: 歌曲{song_id}仍在收藏夹{playlist_id}中，DELETE操作未生效！")
                
                if verify_failed > 0:
                    logger.error(f"批量移除验证失败: {verify_failed}条记录验证失败")
                    return jsonify({'success': False, 'error': f"移除失败，有{verify_failed}条记录删除未生效"})
                    
            except Exception as e:
                logger.error(f"批量移除收藏事务失败: {e}")
                conn.rollback()
                return jsonify({'success': False, 'error': "批量移除失败，事务已回滚"})
        
        logger.info(f"批量移除歌曲成功: 成功{successful_count}条，失败{failed_count}条，验证通过")
        return jsonify({'success': True, 'data': {'successful': successful_count, 'failed': failed_count}})
    except Exception as e:
        logger.error(f"批量移除收藏失败: {e}")
        return jsonify({'success': False, 'error': "批量移除失败"})

# 批量移动歌曲到另一个收藏夹
@app.route('/api/favorites/batch/move', methods=['POST'])
def batch_move_favorites():
    logger.info("API请求: 批量移动歌曲到另一个收藏夹")
    try:
        data = request.get_json()
        song_ids = data.get('song_ids', [])
        from_playlist_id = data.get('from_playlist_id')
        to_playlist_id = data.get('to_playlist_id')
        
        if not song_ids:
            logger.warning("批量移动收藏失败: 歌曲ID列表不能为空")
            return jsonify({'success': False, 'error': "歌曲ID列表不能为空"})
        
        if not from_playlist_id:
            logger.warning("批量移动收藏失败: 源收藏夹ID不能为空")
            return jsonify({'success': False, 'error': "源收藏夹ID不能为空"})
        
        if not to_playlist_id:
            logger.warning("批量移动收藏失败: 目标收藏夹ID不能为空")
            return jsonify({'success': False, 'error': "目标收藏夹ID不能为空"})
        
        if from_playlist_id == to_playlist_id:
            logger.warning("批量移动收藏失败: 源收藏夹和目标收藏夹不能相同")
            return jsonify({'success': False, 'error': "源收藏夹和目标收藏夹不能相同"})
        
        successful_count = 0
        failed_count = 0
        
        with get_db() as conn:
            try:
                # 使用事务确保原子性
                for song_id in song_ids:
                    try:
                        # 先从源收藏夹删除
                        delete_cursor = conn.execute("DELETE FROM favorites WHERE song_id=? AND playlist_id=?", 
                                    (song_id, from_playlist_id))
                        # 再添加到目标收藏夹
                        conn.execute("INSERT OR IGNORE INTO favorites (song_id, playlist_id, created_at) VALUES (?, ?, ?)", 
                                    (song_id, to_playlist_id, time.time()))
                        if delete_cursor.rowcount > 0:
                            successful_count += 1
                            logger.debug(f"成功移动: 歌曲{song_id}从{from_playlist_id}到{to_playlist_id}")
                        else:
                            logger.warning(f"源记录不存在: 歌曲{song_id}在{from_playlist_id}（可能已移动）")
                            successful_count += 1  # 视为成功
                    except Exception as e:
                        logger.warning(f"移动收藏失败: 歌曲{song_id}从{from_playlist_id}到{to_playlist_id}: {e}")
                        failed_count += 1
                conn.commit()
                
                # 数据库验证：确保歌曲已从源移除，已添加到目标
                verify_failed = 0
                for song_id in song_ids:
                    # 验证1：歌曲应该不在源收藏夹
                    remaining_in_source = conn.execute(
                        "SELECT COUNT(*) as count FROM favorites WHERE song_id=? AND playlist_id=?",
                        (song_id, from_playlist_id)
                    ).fetchone()
                    if remaining_in_source and remaining_in_source['count'] > 0:
                        verify_failed += 1
                        logger.error(f"验证失败: 歌曲{song_id}仍在源收藏夹{from_playlist_id}中")
                    
                    # 验证2：歌曲应该在目标收藏夹
                    in_target = conn.execute(
                        "SELECT COUNT(*) as count FROM favorites WHERE song_id=? AND playlist_id=?",
                        (song_id, to_playlist_id)
                    ).fetchone()
                    if not in_target or in_target['count'] == 0:
                        verify_failed += 1
                        logger.error(f"验证失败: 歌曲{song_id}未在目标收藏夹{to_playlist_id}中")
                
                if verify_failed > 0:
                    logger.error(f"批量移动验证失败: {verify_failed}个验证点失败")
                    return jsonify({'success': False, 'error': f"移动失败，有{verify_failed}个验证点失败"})
                    
            except Exception as e:
                logger.error(f"批量移动收藏事务失败: {e}")
                conn.rollback()
                return jsonify({'success': False, 'error': "批量移动失败，事务已回滚"})
        
        logger.info(f"批量移动歌曲成功: 成功{successful_count}条，失败{failed_count}条，验证通过")
        return jsonify({'success': True, 'data': {'successful': successful_count, 'failed': failed_count}})
    except Exception as e:
        logger.error(f"批量移动收藏失败: {e}")
        return jsonify({'success': False, 'error': "批量移动失败"})

@app.route('/api/netease/search')
def search_netease_music():
    """通过本地网易云 API 搜索歌曲。"""
    keywords = (request.args.get('keywords') or '').strip()
    if not keywords:
        return jsonify({'success': False, 'error': '请输入搜索关键词'})
    limit = request.args.get('limit', 20)
    try:
        limit = max(1, min(int(limit), 50))
    except Exception:
        limit = 20

    try:
        api_resp = call_netease_api('/cloudsearch', {'keywords': keywords, 'type': 1, 'limit': limit})
        songs = []
        for item in api_resp.get('result', {}).get('songs', []):
            song_id = item.get('id')
            if not song_id: 
                continue
            artists = ' / '.join([a.get('name') for a in item.get('ar', []) if a.get('name')]) or '未知艺术家'
            album_info = item.get('al') or {}
            privilege = item.get('privilege') or {}
            fee = item.get('fee')
            privilege_fee = privilege.get('fee')
            # 仅 fee==1 视为 VIP；fee=8 只代表会员可享高音质，不强制标 VIP
            # 仅 fee==1 视为 VIP；fee=8 只代表会员可享高音质，不强制标 VIP
            is_vip = (fee == 1) or (privilege_fee == 1)
            user_level, max_level = _extract_song_level(privilege)
            songs.append({
                'id': song_id,
                'title': item.get('name') or f"未命名 {song_id}",
                'artist': artists,
                'album': album_info.get('name') or '',
                'cover': (album_info.get('picUrl') or '').replace('http://', 'https://'),
                'duration': (item.get('dt') or 0) / 1000,
                'level': user_level,
                'max_level': max_level,
                'size': _extract_song_size(item), # Removed user_level parameter
                'is_vip': is_vip
            })
        return jsonify({'success': True, 'data': songs})
    except Exception as e:
        logger.warning(f"网易云搜索失败: {e}")
        return jsonify({'success': False, 'error': '搜索失败，请检查网易云 API 服务'})

@app.route('/api/netease/recommend')
def netease_daily_recommend():
    """获取每日推荐歌曲，需要已登录网易云账号。"""
    try:
        api_resp = call_netease_api('/recommend/songs', {'timestamp': int(time.time() * 1000)}, need_cookie=True)
        if isinstance(api_resp, dict) and api_resp.get('code') == 301:
            return jsonify({'success': False, 'error': '需要登录以获取每日推荐'})
        daily = (api_resp.get('data') or {}).get('dailySongs', []) if isinstance(api_resp, dict) else []
        songs = _format_netease_songs(daily)
        return jsonify({'success': True, 'data': songs})
    except Exception as e:
        logger.warning(f"获取每日推荐失败: {e}")
        return jsonify({'success': False, 'error': '获取每日推荐失败，请检查登录状态或 API 服务'})

@app.route('/api/netease/login/status')
def netease_login_status():
    """检测当前 cookie 是否已登录。"""
    try:
        if not NETEASE_COOKIE:
            logger.info("网易云登录状态检查：当前未加载 cookie")
        api_resp = call_netease_api('/login/status', {'timestamp': int(time.time() * 1000)}, need_cookie=True)
        profile = api_resp.get('data', {}).get('profile') if isinstance(api_resp, dict) else None
        if profile:
            is_vip = False
            vip_info = {}
            try:
                vip_resp = call_netease_api('/vip/info', {'uid': profile.get('userId')})
                if isinstance(vip_resp, dict):
                    vip_info = vip_resp.get('data') or vip_resp
                    data = vip_info or {}
                    now_ms = int(time.time() * 1000)

                    def _active(pkg: dict):
                        """vipCode>0 且未过期的套餐视为有效；expireTime 为空默认为有效。"""
                        if not pkg:
                            return False
                        code = pkg.get('vipCode') or 0
                        exp = pkg.get('expireTime') or pkg.get('expiretime')
                        if code <= 0:
                            return False
                        if exp is None:
                            return False
                        try:
                            return int(exp) > now_ms
                        except Exception:
                            return False

                    # 综合判断：isVip 明确标记 > 任一未过期套餐/标识 > redVipLevel>0
                    is_vip = bool(data.get('isVip'))
                    if not is_vip:
                        is_vip = any([
                            _active(data.get('associator')),
                            _active(data.get('musicPackage')),
                            _active(data.get('redplus')),
                            _active(data.get('familyVip'))
                        ])
            except Exception as e:
                logger.warning(f"获取VIP信息失败: {e}")
            return jsonify({
                'success': True,
                'logged_in': True,
                'nickname': profile.get('nickname'),
                'user_id': profile.get('userId'),
                'avatar': profile.get('avatarUrl'),
                'is_vip': is_vip,
                'vip_info': vip_info
            })
        return jsonify({'success': True, 'logged_in': False, 'error': '未登录'})
    except Exception as e:
        logger.warning(f"检查网易云登录状态失败: {e}")
        return jsonify({'success': False, 'error': '状态检查失败'})

@app.route('/api/netease/logout', methods=['POST'])
def netease_logout():
    """退出登录并清空本地保存的网易云 cookie。"""
    try:
        if NETEASE_COOKIE:
            try:
                call_netease_api('/logout', {'timestamp': int(time.time() * 1000)}, need_cookie=True)
            except Exception as e:
                logger.info(f"网易云 API 注销调用失败，继续清理本地 cookie: {e}")
        save_netease_cookie('')
        return jsonify({'success': True})
    except Exception as e:
        logger.warning(f"网易云退出登录失败: {e}")
        return jsonify({'success': False, 'error': '退出失败'})

@app.route('/api/netease/login/qrcode')
def netease_login_qrcode():
    """生成扫码登录二维码。"""
    try:
        key_resp = call_netease_api('/login/qr/key', {'timestamp': int(time.time() * 1000)}, need_cookie=False)
        unikey = key_resp.get('data', {}).get('unikey')
        if not unikey:
            return jsonify({'success': False, 'error': '获取登录 key 失败'})
        qr_resp = call_netease_api('/login/qr/create', {'key': unikey, 'qrimg': 1, 'timestamp': int(time.time() * 1000)}, need_cookie=False)
        qrimg = qr_resp.get('data', {}).get('qrimg')
        if not qrimg:
            return jsonify({'success': False, 'error': '获取二维码失败'})
        return jsonify({'success': True, 'unikey': unikey, 'qrimg': qrimg})
    except Exception as e:
        logger.warning(f"生成网易云二维码失败: {e}")
        return jsonify({'success': False, 'error': '二维码生成失败'})

@app.route('/api/netease/login/check')
def netease_login_check():
    """轮询扫码状态，成功后保存 cookie。"""
    key = request.args.get('key')
    if not key:
        return jsonify({'success': False, 'error': '缺少 key'})
    try:
        resp = call_netease_api('/login/qr/check', {'key': key, 'timestamp': int(time.time() * 1000)}, need_cookie=False)
        code = resp.get('code')
        message = resp.get('message')
        cookie_str = resp.get('cookie')
        if not cookie_str and isinstance(resp.get('cookies'), list):
            cookie_str = '; '.join(resp.get('cookies'))
        
        # Debug Log
        if code == 803:
            logger.info(f"扫码成功 (803). Raw cookie: {bool(cookie_str)}, Length: {len(cookie_str) if cookie_str else 0}")
            
        if code == 803 and cookie_str:
            save_netease_cookie(cookie_str)
            return jsonify({'success': True, 'status': 'authorized', 'message': message})
        status_map = {
            800: 'expired',
            801: 'waiting',
            802: 'scanned'
        }
        return jsonify({'success': True, 'status': status_map.get(code, 'unknown'), 'message': message})
    except Exception as e:
        logger.warning(f"扫码检查失败: {e}")
        return jsonify({'success': False, 'error': '扫码轮询失败'})

@app.route('/api/netease/download_page')
def netease_download_page():
    """重定向到网易云音乐客户端下载页面。"""
    return redirect("https://music.163.com/client")

@app.route('/api/netease/config', methods=['GET', 'POST'])
def netease_config():
    """获取或更新网易云下载配置。"""
    try:
        if request.method == 'GET':
            return jsonify({
                'success': True, 
                'download_dir': NETEASE_DOWNLOAD_DIR, 
                'api_base': NETEASE_API_BASE, 
                'max_concurrent': NETEASE_MAX_CONCURRENT,
                'quality': NETEASE_QUALITY_DEFAULT # Always return default quality
            })
        data = request.json or {}
        target_dir = data.get('download_dir')
        api_base = (data.get('api_base') or '').strip()
        # quality = data.get('quality') # Removed quality processing
        
        if target_dir:
            target_dir = os.path.abspath(target_dir)
            os.makedirs(target_dir, exist_ok=True)
        else:
            target_dir = None
            
        if api_base:
            api_base = api_base.rstrip('/')
            
        if not target_dir and not api_base: # Removed quality check
            return jsonify({'success': False, 'error': '未提供任何配置项'})
            
        save_netease_config(target_dir, api_base) # Removed quality parameter
        return jsonify({
            'success': True, 
            'download_dir': NETEASE_DOWNLOAD_DIR, 
            'api_base': NETEASE_API_BASE, 
            'max_concurrent': NETEASE_MAX_CONCURRENT,
            'quality': NETEASE_QUALITY_DEFAULT # Always return default quality
        })
    except Exception as e:
        logger.warning(f"更新网易云配置失败: {e}")
        return jsonify({'success': False, 'error': '保存失败'})

@app.route('/api/netease/debug')
def netease_debug():
    """调试用，查看 cookie 是否加载。"""
    info = {
        'cookie_loaded': bool(NETEASE_COOKIE),
        'api_base': NETEASE_API_BASE,
        'download_dir': NETEASE_DOWNLOAD_DIR
    } # type: ignore
    return jsonify(info)

def _normalize_cover_url(url: str):
    if not url:
        return None
    u = url.replace('http://', 'https://')
    if '//' not in u:
        return None
    # NetEase 图片参数：确保有清晰尺寸
    if 'param=' not in u and '?param=' not in u:
        sep = '&' if '?' in u else '?'
        u = f"{u}{sep}param=1024y1024"
    return u

def run_download_task(task_id, payload):
    song_id = payload.get('id')
    title = (payload.get('title') or '').strip()
    artist = (payload.get('artist') or '').strip()
    album = (payload.get('album') or '').strip()
    # Priority: Payload Level -> Configured Level -> Default (exhigh)
    level = payload.get('level') or NETEASE_QUALITY or NETEASE_QUALITY_DEFAULT # type: ignore
    
    cover_url = _normalize_cover_url(payload.get('cover') or payload.get('album_art'))
    cover_bytes = fetch_cover_bytes(cover_url) if cover_url else None
    
    target_dir = payload.get('target_dir') or NETEASE_DOWNLOAD_DIR
    target_dir = os.path.abspath(target_dir)
    
    DOWNLOAD_TASKS[task_id]['status'] = 'preparing'
    DOWNLOAD_TASKS[task_id]['progress'] = 0

    try:
        os.makedirs(target_dir, exist_ok=True)
        
        # 1. Fetch Song Detail if missing critical info
        need_detail = (not title) or (not artist)
        if need_detail:
            meta_resp = call_netease_api('/song/detail', {'ids': song_id})
            songs = meta_resp.get('songs', []) if isinstance(meta_resp, dict) else []
            if songs:
                info = songs[0]
                title = info.get('name') or title
                artist = ' / '.join([a.get('name') for a in info.get('ar', []) if a.get('name')]) or artist
                album = (info.get('al') or {}).get('name') or album
                if not cover_url:
                    cover_url = _normalize_cover_url((info.get('al') or {}).get('picUrl'))
                    if cover_url: cover_bytes = fetch_cover_bytes(cover_url)

        # Update Task Info
        DOWNLOAD_TASKS[task_id]['title'] = title
        DOWNLOAD_TASKS[task_id]['artist'] = artist
        
        # 2. Get Download URL
        DOWNLOAD_TASKS[task_id]['status'] = 'downloading'
        url_resp = call_netease_api('/song/url/v1', {'id': song_id, 'level': level})
        data_list = url_resp.get('data', []) if isinstance(url_resp, dict) else []
        if not data_list:
             raise Exception('Failed to get download URL data')
        
        song_info = data_list[0]
        down_url = song_info.get('url')
        if not down_url:
             # Try fallback to standard if high quality fails? 
             # For now just error
             raise Exception(f'No download URL for level: {level}')
             
        file_ext = (song_info.get('type') or 'mp3').lower()
        if not file_ext.startswith('.'): file_ext = '.' + file_ext
        
        # Filename
        fname = sanitize_filename(f"{artist} - {title}{file_ext}")
        file_path = os.path.join(target_dir, fname)
        DOWNLOAD_TASKS[task_id]['filename'] = fname
        
        # 3. Download File
        size = song_info.get('size') or 0
        dl_resp = requests.get(down_url, stream=True, timeout=30, headers=COMMON_HEADERS)
        dl_resp.raise_for_status()
        
        downloaded = 0
        with open(file_path, 'wb') as f:
            for chunk in dl_resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if size > 0:
                        percent = int(downloaded / size * 100)
                        # Throttle updates
                        if percent > DOWNLOAD_TASKS[task_id]['progress']:
                            DOWNLOAD_TASKS[task_id]['progress'] = percent
                            
        DOWNLOAD_TASKS[task_id]['progress'] = 100
        
        # 4. Write Metadata
        try:
            # Basic Tags
            if file_ext == '.mp3':
                try:
                    audio = EasyID3(file_path)
                except:
                    audio = File(file_path, easy=True)
                    audio.add_tags()
                audio['title'] = title
                audio['artist'] = artist
                audio['album'] = album
                audio.save()
            elif file_ext == '.flac':
                audio = FLAC(file_path)
                audio['title'] = title
                audio['artist'] = artist
                audio['album'] = album
                audio.save()
            
            # Cover
            if cover_bytes: 
                embed_cover_to_file(file_path, cover_bytes)
                if fname:
                    save_cover_file(cover_bytes, os.path.splitext(fname)[0])
            
            # Lyrics
            lrc, _ = fetch_netease_lyrics(song_id)
            if lrc:
                embed_lyrics_to_file(file_path, lrc)
                
        except Exception as e:
            logger.warning(f"Metadata embedding failed: {e}")
            
        # 5. Index
        index_single_file(file_path)
        
        DOWNLOAD_TASKS[task_id]['status'] = 'success'
        
    except Exception as e:
        logger.error(f"Download task failed: {e}")
        DOWNLOAD_TASKS[task_id]['status'] = 'error'
        DOWNLOAD_TASKS[task_id]['message'] = str(e)

@app.route('/api/netease/resolve')
def netease_resolve():
    """通过分享链接或ID自动识别资源并返回歌曲列表。"""
    raw_input = request.args.get('input') or request.args.get('link') or request.args.get('id')
    parsed_input = _resolve_netease_input(raw_input)
    if not parsed_input:
        return jsonify({'success': False, 'error': '请粘贴网易云分享链接或输入ID'})
    try:
        if parsed_input['type'] == 'playlist':
            songs, name = _fetch_playlist_songs(parsed_input['id'])
            return jsonify({'success': True, 'type': 'playlist', 'id': parsed_input['id'], 'name': name, 'data': songs})
        songs = _fetch_song_detail(parsed_input['id'])
        return jsonify({'success': True, 'type': 'song', 'id': parsed_input['id'], 'data': songs})
    except Exception as e:
        logger.warning(f"解析网易云链接失败: {e}")
        return jsonify({'success': False, 'error': '解析失败，请确认歌曲或歌单链接有效'})

@app.route('/api/netease/playlist')
def netease_playlist_detail():
    """获取歌单详情及歌曲列表。"""
    raw_input = request.args.get('id') or request.args.get('link') or request.args.get('input')
    parsed_input = _resolve_netease_input(raw_input, prefer='playlist')
    if not parsed_input or parsed_input.get('type') != 'playlist':
        return jsonify({'success': False, 'error': '缺少歌单链接或无法识别'})
    try:
        songs, name = _fetch_playlist_songs(parsed_input['id'])
        return jsonify({'success': True, 'name': name, 'id': parsed_input['id'], 'data': songs})
    except Exception as e:
        logger.warning(f"歌单获取失败: {e}")
        return jsonify({'success': False, 'error': '获取歌单失败'})

@app.route('/api/netease/song')
def netease_song_detail():
    """根据单曲ID获取歌曲详情，用于解析而非直接下载。"""
    raw_input = request.args.get('id') or request.args.get('link') or request.args.get('input')
    parsed_input = _resolve_netease_input(raw_input, prefer='song')
    if not parsed_input:
        return jsonify({'success': False, 'error': '缺少歌曲链接或ID'})
    if parsed_input.get('type') == 'playlist':
        return jsonify({'success': False, 'error': '检测到歌单链接，请切换歌单解析'})
    try:
        parsed = _fetch_song_detail(parsed_input['id'])
        return jsonify({'success': True, 'id': parsed_input['id'], 'data': parsed})
    except Exception as e:
        logger.warning(f"获取单曲详情失败: {e}")
        return jsonify({'success': False, 'error': '获取歌曲信息失败'})

        # 索引文件
        index_single_file(target_path)
        
        DOWNLOAD_TASKS[task_id]['status'] = 'success'
        DOWNLOAD_TASKS[task_id]['progress'] = 100
        logger.info(f"网易云歌曲已下载: {filename} | {title} - {artist}")
        
    except Exception as e:
        logger.warning(f"网易云下载失败: {e}")
        DOWNLOAD_TASKS[task_id]['status'] = 'error' # type: ignore
        DOWNLOAD_TASKS[task_id]['message'] = str(e) # type: ignore
    finally:
        # 10分钟后清理任务状态
        def clean_task():
            time.sleep(600)
            DOWNLOAD_TASKS.pop(task_id, None) # type: ignore
        threading.Thread(target=clean_task, daemon=True).start()

@app.route('/api/netease/download', methods=['POST'])
def download_netease_music():
    """根据歌曲ID下载网易云音乐到本地库。(异步)"""
    payload = request.json or {}
    song_id = payload.get('id')
    if not song_id:
        return jsonify({'success': False, 'error': '缺少歌曲ID'})

    active = sum(1 for t in DOWNLOAD_TASKS.values() if t.get('status') in ('pending', 'preparing', 'downloading'))
    if active >= NETEASE_MAX_CONCURRENT:
        return jsonify({'success': False, 'error': f'并发下载已达上限 ({NETEASE_MAX_CONCURRENT})，请稍后再试'})
    
    task_id = f"task_{int(time.time()*1000)}_{os.urandom(4).hex()}"
    DOWNLOAD_TASKS[task_id] = {
        'status': 'pending', 
        'progress': 0, 
        'title': payload.get('title', '未知'),
        'artist': payload.get('artist', '未知')
    }
    
    threading.Thread(target=run_download_task, args=(task_id, payload), daemon=True).start()
    return jsonify({'success': True, 'task_id': task_id})

def _normalize_cover_url(url: str):
    if not url:
        return None
    u = url.replace('http://', 'https://')
    if '//' not in u:
        return None
    # NetEase 图片参数：确保有清晰尺寸
    if 'param=' not in u and '?param=' not in u:
        sep = '&' if '?' in u else '?'
        u = f"{u}{sep}param=1024y1024"
    return u

def run_download_task(task_id, payload):
    song_id = payload.get('id')
    title = (payload.get('title') or '').strip()
    artist = (payload.get('artist') or '').strip()
    album = (payload.get('album') or '').strip()
    level = payload.get('level') or 'exhigh'
    cover_url = _normalize_cover_url(payload.get('cover') or payload.get('album_art'))
    cover_bytes = fetch_cover_bytes(cover_url) if cover_url else None
    target_dir = payload.get('target_dir') or NETEASE_DOWNLOAD_DIR
    target_dir = os.path.abspath(target_dir)
    
    target_dir = os.path.abspath(target_dir)
    
    DOWNLOAD_TASKS[task_id]['status'] = 'preparing'

    try:
        os.makedirs(target_dir, exist_ok=True)
        need_detail_for_level = not payload.get('level')
        need_detail_for_cover = cover_bytes is None
        if not title or need_detail_for_level or need_detail_for_cover:
            # 拉取歌曲详情补充元信息、下载音质和封面
            meta_resp = call_netease_api('/song/detail', {'ids': song_id})
            songs = meta_resp.get('songs', []) if isinstance(meta_resp, dict) else []
            if songs:
                info = songs[0]
                if need_detail_for_level:
                    level, _ = _extract_song_level(info.get('privilege') or {})
                title = info.get('name') or title or f"未命名 {song_id}"
                artist = ' / '.join([a.get('name') for a in info.get('ar', []) if a.get('name')]) or artist
                album = (info.get('al') or {}).get('name') or album
                if need_detail_for_cover and not cover_bytes:
                    pic_url = _normalize_cover_url((info.get('al') or {}).get('picUrl'))
                    if pic_url:
                        cover_bytes = fetch_cover_bytes(pic_url)
                base_filename = sanitize_filename(f"{artist or '未知艺术家'} - {title}")
        if not title:
            title = f"未命名 {song_id}"
        if not artist:
            artist = '未知艺术家'
        if 'base_filename' not in locals() or not base_filename:
            base_filename = sanitize_filename(payload.get('filename') or f"{artist} - {title}")
            
        # 更新任务信息
        DOWNLOAD_TASKS[task_id]['title'] = title
        DOWNLOAD_TASKS[task_id]['artist'] = artist

        api_resp = call_netease_api('/song/url/v1', {'id': song_id, 'level': level}, need_cookie=bool(NETEASE_COOKIE))
        data_list = api_resp.get('data') if isinstance(api_resp, dict) else None
        track_info = None
        if isinstance(data_list, list) and data_list:
            track_info = data_list[0]
        elif isinstance(data_list, dict):
            track_info = data_list

        if not track_info or (not track_info.get('url') and not track_info.get('proxyUrl')):
            # 回退到标准音质再试一次
            if level != 'standard':
                try:
                    api_resp_std = call_netease_api('/song/url/v1', {'id': song_id, 'level': 'standard'}, need_cookie=bool(NETEASE_COOKIE))
                    data_list = api_resp_std.get('data') if isinstance(api_resp_std, dict) else None
                    if isinstance(data_list, list) and data_list:
                        track_info = data_list[0]
                    elif isinstance(data_list, dict):
                        track_info = data_list
                except Exception:
                    track_info = track_info
            if not track_info or (not track_info.get('url') and not track_info.get('proxyUrl')):
                raise Exception('暂无可用下载地址，可能需要切换音质或登录')

        download_url = track_info.get('url') or track_info.get('proxyUrl')
        ext = (track_info.get('type') or track_info.get('encodeType') or 'mp3').lower()
        filename = base_filename if base_filename.lower().endswith(f".{ext}") else f"{base_filename}.{ext}"
        target_path = os.path.join(target_dir, filename)

        counter = 1
        while os.path.exists(target_path):
            filename = f"{base_filename} ({counter}).{ext}"
            target_path = os.path.join(target_dir, filename)
            counter += 1

        tmp_path = target_path + ".part"
        DOWNLOAD_TASKS[task_id]['status'] = 'downloading'
        try:
            with requests.get(download_url, stream=True, timeout=20, headers=COMMON_HEADERS) as resp:
                resp.raise_for_status()
                total_size = int(resp.headers.get('content-length', 0))
                downloaded = 0
                
                with open(tmp_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total_size > 0:
                                progress = int((downloaded / total_size) * 100)
                                DOWNLOAD_TASKS[task_id]['progress'] = progress
                                
            shutil.move(tmp_path, target_path)
        finally:
            if os.path.exists(tmp_path):
                try: os.remove(tmp_path)
                except: pass
            
        # 索引文件
        base_name_for_cover = os.path.splitext(os.path.basename(target_path))[0]
        if cover_bytes:
            embed_cover_to_file(target_path, cover_bytes)
            save_cover_file(cover_bytes, base_name_for_cover)
        # 保存并内嵌歌词（无需登录）
        lrc_text, yrc_text = fetch_netease_lyrics(song_id)
        if lrc_text:
            try:
                os.makedirs(LYRICS_DIR, exist_ok=True)
                lrc_path = os.path.join(LYRICS_DIR, f"{base_name_for_cover}.lrc")
                with open(lrc_path, 'w', encoding='utf-8') as f:
                    f.write(lrc_text)
            except Exception as e:
                logger.warning(f"保存歌词失败: {e}")
            embed_lyrics_to_file(target_path, lrc_text)
        if yrc_text:
            try:
                with open(os.path.join(LYRICS_DIR, f"{base_name_for_cover}.yrc"), 'w', encoding='utf-8') as f:
                    f.write(yrc_text)
            except Exception as e:
                logger.warning(f"保存逐字歌词失败: {e}")
        index_single_file(target_path)
        
        DOWNLOAD_TASKS[task_id]['status'] = 'success'
        DOWNLOAD_TASKS[task_id]['progress'] = 100
        logger.info(f"网易云歌曲已下载: {filename} | {title} - {artist}")
        
    except Exception as e:
        logger.warning(f"网易云下载失败: {e}")
        DOWNLOAD_TASKS[task_id]['status'] = 'error'
        DOWNLOAD_TASKS[task_id]['message'] = str(e)
    finally:
        # 10分钟后清理任务状态
        def clean_task():
            time.sleep(600)
            DOWNLOAD_TASKS.pop(task_id, None)
        threading.Thread(target=clean_task, daemon=True).start()

@app.route('/api/netease/task/<task_id>')
def get_netease_task_status(task_id):
    task = DOWNLOAD_TASKS.get(task_id)
    if not task:
        return jsonify({'success': False, 'error': '任务不存在'})
    return jsonify({'success': True, 'data': task})

@app.route('/api/music/external/meta')
def get_external_meta():
    path = request.args.get('path')
    if not path or not os.path.exists(path): return jsonify({'success': False, 'error': '文件未找到'})
    try:
        meta = get_metadata(path)
        song_id = generate_song_id(path)
        album_art = None
        base_name = os.path.splitext(os.path.basename(path))[0]
        cached_cover = os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base_name}.jpg")
        cached_cover = os.path.join(MUSIC_LIBRARY_PATH, 'covers', f"{base_name}.jpg")
        if os.path.exists(cached_cover): album_art = f"/api/music/covers/{quote(base_name)}.jpg?filename={quote(base_name)}"
        
        in_library = False
        with get_db() as conn:
             if conn.execute("SELECT 1 FROM songs WHERE id=?", (song_id,)).fetchone():
                 in_library = True

        return jsonify({'success': True, 'data': {'id': song_id, 'filename': path, 'title': meta['title'] or os.path.basename(path), 'artist': meta['artist'] or '未知艺术家', 'album': meta['album'] or '', 'album_art': album_art, 'in_library': in_library}})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})

@app.route('/api/music/external/play')
def play_external_file():
    path = request.args.get('path')
    if path and os.path.exists(path): return send_file(path, conditional=True)
    return jsonify({'error': '文件未找到'}), 404

# --- 安装状态管理 ---
INSTALL_STATUS = {
    'status': 'idle', # idle, running, success, error
    'progress': 0,
    'step': '',
    'error': None
}

@app.route('/api/netease/install/status')
def get_install_status():
    return jsonify(INSTALL_STATUS)

@app.route('/api/netease/install_service', methods=['POST'])
def install_netease_service():
    """尝试自动拉取并运行网易云 API 容器"""
    import subprocess
    global INSTALL_STATUS
    
    if INSTALL_STATUS['status'] == 'running':
         return jsonify({'success': False, 'error': '安装任务正在进行中'})

    INSTALL_STATUS = {'status': 'running', 'progress': 0, 'step': '准备安装...', 'error': None}
    logger.info("API请求: 安装网易云服务")
    
    def run_install():
        global INSTALL_STATUS
        try:
            # 1. 检查 Docker 是否可用
            INSTALL_STATUS.update({'progress': 10, 'step': '检查 Docker 环境...'})
            subprocess.run(["docker", "--version"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # 2. 检查由我们创建的容器是否已存在
            container_name = "2fmusic-ncm-api"
            INSTALL_STATUS.update({'progress': 20, 'step': f'检查容器 {container_name}...'})
            
            check_proc = subprocess.run(
                ["docker", "ps", "-a", "--filter", f"name={container_name}", "--format", "{{.Names}}"],
                capture_output=True, text=True
            )
            
            if container_name in check_proc.stdout.strip():
                # 容器已存在，尝试启动
                INSTALL_STATUS.update({'progress': 60, 'step': '容器已存在，正在启动...'})
                logger.info("容器已存在，尝试启动...")
                subprocess.run(["docker", "start", container_name], check=True)
            else:
                # 容器不存在，拉取并运行
                INSTALL_STATUS.update({'progress': 30, 'step': '正在拉取镜像 (耗时较长)...'})
                logger.info("正在拉取镜像 moefurina/ncm-api...")
                subprocess.run(["docker", "pull", "moefurina/ncm-api:latest"], check=True)
                
                INSTALL_STATUS.update({'progress': 70, 'step': '镜像拉取完成，正在启动容器...'})
                logger.info("正在启动容器...")
                # 映射端口 23236:3000
                subprocess.run([
                    "docker", "run", "-d", 
                    "-p", "23236:3000", 
                    "--name", container_name, 
                    "--restart", "always",
                    "moefurina/ncm-api"
                ], check=True)
            
            INSTALL_STATUS.update({'status': 'success', 'progress': 100, 'step': '服务启动成功！'})
            logger.info("网易云服务安装/启动指令执行完成")
            
        except subprocess.CalledProcessError as e:
            msg = f"操作失败: {e}"
            logger.error(msg)
            INSTALL_STATUS.update({'status': 'error', 'error': msg, 'step': '发生错误'})
        except FileNotFoundError:
            msg = "未找到 Docker，请确保已安装 Docker Desktop"
            logger.error(msg)
            INSTALL_STATUS.update({'status': 'error', 'error': msg, 'step': '环境缺失'})
        except Exception as e:
            msg = f"未知错误: {str(e)}"
            logger.exception(msg)
            INSTALL_STATUS.update({'status': 'error', 'error': msg, 'step': '系统异常'})

    # 异步执行，避免阻塞
    threading.Thread(target=run_install, daemon=True).start()
    
    return jsonify({'success': True, 'message': '安装任务已启动'})

if __name__ == '__main__':
    logger.info(f"服务启动，端口: {args.port} ...")
    try:
        init_db()
        app.run(host='0.0.0.0', port=args.port, threaded=True, use_reloader=False)
    except Exception as e:
        logger.exception(f"服务启动失败: {e}")