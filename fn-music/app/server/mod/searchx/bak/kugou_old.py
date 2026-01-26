#原始项目地址：https://github.com/HisAtri/LrcApi

import os
import sys
import json
import base64
import random
import string
import time
import logging
from functools import lru_cache
import functools

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(BASE_DIR, 'lib'))

import requests
from mod import textcompare
from mod import tools

# 工具函数
def no_error(throw=None, exceptions=(Exception,)):
    """
    Decorator to suppress exceptions.
    :param throw: Function to call with the exception if one occurs (e.g. logger.error).
    :param exceptions: Tuple of exception classes to catch.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except exceptions as e:
                if throw:
                    throw(f"Error in {func.__name__}: {e}")
                return None
        return wrapper
    return decorator
    

headers: dict = {'User-Agent': '{"percent": 21.4, "useragent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                         'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36", "system": "Chrome '
                         '116.0 Win10", "browser": "chrome", "version": 116.0, "os": "win10"}', }
logger = logging.getLogger(__name__)


def get_cover(m_hash: str, m_id: int|str) -> str:
    def _dfid(num):
        random_str = ''.join(random.sample((string.ascii_letters + string.digits), num))
        return random_str

    # 获取a-z  0-9组成的随机23位数列
    def _mid(num):
        random_str = ''.join(random.sample((string.ascii_letters[:26] + string.digits), num))
        return random_str

    music_url = 'https://wwwapi.kugou.com/yy/index.php'
    parameter = {
        'r': 'play/getdata',
        'hash': m_hash,
        'dfid': _dfid(23),
        'mid': _mid(23),
        'album_id': m_id,
        '_': str(round(time.time() * 1000))  # 时间戳
    }
    try:
        session = tools.get_legacy_session()
        json_data_r = session.get(music_url, headers=headers, params=parameter, timeout=10)
        json_data = json_data_r.json()
        if json_data.get("data"):
            return json_data['data'].get("img")
    except Exception as e:
        logger.warning(f"Kugou get_cover failed: {e}")
    return ""


def search(title='', artist='', album=''):
    # 确保参数为字符串
    title = str(title) if title else ''
    artist = str(artist) if artist else ''
    album = str(album) if album else ''
    
    if not any((title, artist, album)):
        return None
        
    keyword = f'{title} {artist} {album}'.strip()
    result_list = []
    limit = 3
    
    try:
        session = tools.get_legacy_session()
        response = session.get(
            f"http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword={' '.join([item for item in [title, artist, album] if item])}&page=1&pagesize=2&showtype=1",
            headers=headers, timeout=10)
        
        if response.status_code == 200:
            song_info: dict = response.json()
            song_info: list[dict] = song_info["data"]["info"]
            if len(song_info) >= 1:
                for song_item in song_info:
                    song_name = song_item["songname"]
                    singer_name = song_item.get("singername", "")
                    song_hash = song_item["hash"]
                    album_id = song_item["album_id"]
                    album_name = song_item.get("album_name", "")
                    title_conform_ratio = textcompare.association(title, song_name)
                    artist_conform_ratio = textcompare.assoc_artists(artist, singer_name)
                    ratio: float = (title_conform_ratio * (artist_conform_ratio+1)/2) ** 0.5
                    if ratio >= 0.2:
                        try:
                            response2 = session.get(
                                f"https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash={song_hash}&album_audio_id=",
                                headers=headers, timeout=10)
                            lyrics_info = response2.json()
                            if not lyrics_info["candidates"]:
                                continue
                            lyrics_id = lyrics_info["candidates"][0]["id"]
                            lyrics_key = lyrics_info["candidates"][0]["accesskey"]
                            
                            # 第三层Json，要求获得并解码Base64
                            response3 = session.get(
                                f"http://lyrics.kugou.com/download?ver=1&client=pc&id={lyrics_id}&accesskey={lyrics_key}&fmt=lrc&charset=utf8",
                                headers=headers, timeout=10)
                            lyrics_data = response3.json()
                            lyrics_encode = lyrics_data["content"]  # 这里是Base64编码的数据
                            lrc_text = tools.standard_lrc(base64.b64decode(lyrics_encode).decode('utf-8'))  # 这里解码
                            # 结构化JSON数据
                            music_json_data: dict = {
                                "title": song_name,
                                "album": album_name,
                                "artist": singer_name,
                                "lyrics": lrc_text,
                                "cover": get_cover(song_hash, album_id),
                                "id": tools.calculate_md5(f"title:{song_name};artists:{singer_name};album:{album_name}", base='decstr')
                            }
                            result_list.append({
                                "data": music_json_data,
                                "ratio": ratio
                            })
                            if len(result_list) > limit:
                                break
                        except Exception as e:
                            logger.warning(f"Kugou lyric fetch error: {e}")
                            continue
        else:
            return None
    except Exception as e:
        logger.error(f"Kugou search error: {e}")
        return None
        
    sort_li: list[dict] = sorted(result_list, key=lambda x: x['ratio'], reverse=True)
    return [i.get('data') for i in sort_li]