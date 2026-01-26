#原始源码项目地址：https://github.com/HisAtri/LrcApi
import os
import sys
import base64
import time
import logging
from functools import lru_cache
import functools
import asyncio

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(BASE_DIR, 'lib'))

from mod import textcompare
from mod import tools
import aiohttp

TEST_TIME_LOG = False #耗时统计
if TEST_TIME_LOG:
    def test_time_print(*args, **kwargs):
        print(time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()), *args, **kwargs)
else:
    def test_time_print(*args, **kwargs):
        pass

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

async def search_async(title='', artist='', album=''):
    time_start = time.time()
    # 新API：songsearch.kugou.com/song_search_v2
    title = str(title) if title else ''
    artist = str(artist) if artist else ''
    album = str(album) if album else ''
    if not any((title, artist, album)):
        return None
    keyword = f'{title} {artist} {album}'.strip()
    result_list = []
    limit = 3
    try:
        async with aiohttp.ClientSession(headers=headers) as session:
            url = f"https://songsearch.kugou.com/song_search_v2?keyword={keyword}&platform=WebFilter&format=json&page=1&pagesize=10"
            async with session.get(url, timeout=10) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json(content_type=None)
            song_list = data.get('data', {}).get('lists', [])
            # 先只做基础信息和相似度计算
            for song_item in song_list:
                song_name = song_item.get('SongName', '')
                singer_name = song_item.get('SingerName', '')
                album_name = song_item.get('AlbumName', '')
                file_hash = song_item.get('FileHash', '')
                album_audio_id = song_item.get('Audioid', '')
                title_conform_ratio = textcompare.association(title, song_name)
                artist_conform_ratio = textcompare.assoc_artists(artist, singer_name)
                ratio = (title_conform_ratio * (artist_conform_ratio+1)/2) ** 0.5
                result_list.append({
                    "song_item": song_item,
                    "file_hash": file_hash,
                    "album_audio_id": album_audio_id,
                    "ratio": ratio
                })
            # 排序后只处理前3首
            sort_li = sorted(result_list, key=lambda x: x['ratio'], reverse=True)[:limit]
            final_results = []
            for entry in sort_li:
                song_item = entry["song_item"]
                song_name = song_item.get('SongName', '')
                singer_name = song_item.get('SingerName', '')
                album_name = song_item.get('AlbumName', '')
                cover_url = song_item.get('Image', '').replace('{size}', '400') if song_item.get('Image') else ''
                # 封面获取耗时检测
                cover_time_start = time.time()
                # cover_url 已直接从 song_item 获取，如需后续异步获取可在此处加耗时统计
                cover_time_end = time.time()
                test_time_print(f"[kugou] cover 获取: {round((cover_time_end - cover_time_start) * 1000)} ms [{song_name}]")

                lrc_text = ""
                try:
                    lyric_time_start = time.time()
                    file_hash = entry["file_hash"]
                    album_audio_id = entry["album_audio_id"]
                    # 歌词第一步
                    url2 = f"https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash={file_hash}&album_audio_id={album_audio_id}"
                    async with session.get(url2, timeout=10) as resp2:
                        lyrics_info = await resp2.json(content_type=None)
                    if lyrics_info.get("candidates"):
                        lyrics_id = lyrics_info["candidates"][0]["id"]
                        lyrics_key = lyrics_info["candidates"][0]["accesskey"]
                        # 歌词第二步
                        url3 = f"http://lyrics.kugou.com/download?ver=1&client=pc&id={lyrics_id}&accesskey={lyrics_key}&fmt=lrc&charset=utf8"
                        async with session.get(url3, timeout=10) as resp3:
                            lyrics_data = await resp3.json(content_type=None)
                        lyrics_encode = lyrics_data.get("content", "")
                        if lyrics_encode:
                            lrc_text = tools.standard_lrc(base64.b64decode(lyrics_encode).decode('utf-8'))
                    lyric_time_end = time.time()
                    test_time_print(f"[kugou] 歌词获取: {round((lyric_time_end - lyric_time_start) * 1000)} ms [{song_name}]")
                except Exception as e:
                    test_time_print(f"[kugou] 歌词获取错误: {e}")
                music_json_data = {
                    "title": song_name,
                    "album": album_name,
                    "artist": singer_name,
                    "cover": cover_url,
                    "lyrics": lrc_text,
                    "id": tools.calculate_md5(f"title:{song_name};artists:{singer_name};album:{album_name}", base='decstr')
                }
                final_results.append(music_json_data)
            return final_results
    except Exception as e:
        logger.error(f"Kugou search error: {e}")
        return None
    sort_li = sorted(result_list, key=lambda x: x['ratio'], reverse=True)
    time_end = time.time()
    test_time_print(f"[kugou] search_async: {round((time_end - time_start) * 1000)} ms")
    return [i.get('data') for i in sort_li[:limit]]

# 同步包装器
def search(*args, **kwargs):
    time_start = time.time()
    result = asyncio.run(search_async(*args, **kwargs))
    time_end = time.time()
    test_time_print(f"[kugou] search 总耗时: {round((time_end - time_start) * 1000)} ms")
    return result