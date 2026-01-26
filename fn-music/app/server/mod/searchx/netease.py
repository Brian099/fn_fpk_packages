#原始源码项目地址：https://github.com/HisAtri/LrcApi
import os
import sys
import json
import logging
import urllib.parse
from functools import lru_cache
import functools
import asyncio
import time
import re

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(BASE_DIR, 'lib'))

import aiohttp
from mod import textcompare, tools
from mod.ttscn import t2s
from mod import textcompare, tools
from mod.ttscn import t2s

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

headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    'origin': 'https://music.163.com',
    'referer': 'https://music.163.com',
}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# type: 1-songs, 10-albums, 100-artists, 1000-playlists
COMMON_SEARCH_URL_WANGYI = 'https://music.163.com/api/cloudsearch/pc?s={}&type={}&offset={}&limit={}'
ALBUM_SEARCH_URL_WANGYI = 'https://music.163.com/api/album/{}?ext=true'
LYRIC_URL_WANGYI = 'https://music.163.com/api/song/lyric?id={}&lv=1&tv=1'
ARTIST_SEARCH_URL = 'http://music.163.com/api/v1/artist/{}'
ALBUMS_SEARCH_URL = "http://music.163.com/api/artist/albums/{}?offset=0&total=true&limit=300"
ALBUM_INFO_URL = "http://music.163.com/api/album/{}?ext=true"


def listify(obj):
    if isinstance(obj, list):
        return obj
    else:
        return [obj]


async def search_artist_blur(artist_blur, limit=1):
    """ 由于没有选择交互的过程, 因此 artist_blur 如果输入的不准确, 可能会查询到错误的歌手 """
    # logging.info('开始搜索: ' + artist_blur)

    num = 0
    if not artist_blur:
        logging.info('Missing artist. Skipping match')
        return None

    url = COMMON_SEARCH_URL_WANGYI.format(
        urllib.parse.quote(artist_blur.lower()), 100, 0, limit)
    artists = []
    try:
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=10) as resp:
                response = await resp.json(content_type=None)

        artist_results = response['result']
        num = int(artist_results['artistCount'])
        lim = min(limit, num)
        # logging.info('搜索到的歌手数量：' + str(lim))
        for i in range(lim):
            try:
                artists = listify(artist_results['artists'])
            except:
                logging.error('Error retrieving artist search results.')
    except:
        logging.error('Error retrieving artist search results.')
    if len(artists) > 0:
        return artists[0]
    return None


async def search_albums(artist_id):
    url = ALBUMS_SEARCH_URL.format(artist_id)
    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(url, timeout=10) as resp:
            response = await resp.json(content_type=None)
    if response['code'] == 200:
        return response['hotAlbums']
    return None


def filter_and_get_album_id(album_list, album):
    most_similar = None
    highest_similarity = 0

    for candidate_album in album_list:
        if album == candidate_album['name']:
            return candidate_album['id']
        similarity = textcompare.association(album, candidate_album['name'])
        if similarity > highest_similarity:
            highest_similarity = similarity
            most_similar = candidate_album
    return most_similar['id'] if most_similar is not None else None


async def get_album_info_by_id(album_id):
    url = ALBUM_INFO_URL.format(album_id)
    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(url, timeout=10) as resp:
            response = await resp.json(content_type=None)
    if response['code'] == 200:
        return response['album']
    return None


async def get_album_info(artist, album):
    artist = t2s(artist)
    album = t2s(album)
    # 1. 根据 artist, 获取 artist_id
    blur_result = await search_artist_blur(artist_blur=artist)
    if blur_result:
        artist_id = blur_result['id']
        album_list = await search_albums(artist_id)
        if album_list:
            album_id = filter_and_get_album_id(album_list, album)
            if album_id:
                return await get_album_info_by_id(album_id)
    return None


async def get_cover_url(album_id: int):
    url = ALBUM_SEARCH_URL_WANGYI.format(album_id)
    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(url, timeout=10) as resp:
            json_data = await resp.json(content_type=None)
    if json_data.get('album', False) and json_data.get('album').get('picUrl', False):
        return json_data['album']['picUrl']
    return None


async def get_lyrics(track_id: int):
    url = LYRIC_URL_WANGYI.format(track_id)
    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(url, timeout=10) as resp:
            json_data = await resp.json(content_type=None)
    origin_lyric = json_data.get('lrc', {}).get('lyric', '')
    trans_lyric = json_data.get('tlyric', {}).get('lyric', '')
    has_translation = bool(trans_lyric.strip())

    # 解析歌词为 [(timestamp, text)]，保留顺序和重复时间戳
    def parse_lrc_lines(lrc_text):
        result = []
        for line in lrc_text.splitlines():
            matches = list(re.finditer(r'\[(\d{2}:\d{2}\.\d{2,3})\]', line))
            content = re.sub(r'(\[\d{2}:\d{2}\.\d{2,3}\])+', '', line).strip()
            if matches and content:
                for m in matches:
                    ts = m.group(1)
                    result.append((ts, content))
        return result

    origin_list = parse_lrc_lines(origin_lyric)
    trans_list = parse_lrc_lines(trans_lyric) if has_translation else []

    # 合并原文和翻译，按时间戳顺序，原文在前，翻译在后
    merged = []
    i, j = 0, 0
    while i < len(origin_list) or j < len(trans_list):
        if i < len(origin_list) and (j >= len(trans_list) or origin_list[i][0] <= trans_list[j][0]):
            merged.append(f'[{origin_list[i][0]}]{origin_list[i][1]}')
            i += 1
        elif j < len(trans_list):
            merged.append(f'[{trans_list[j][0]}]{trans_list[j][1]}')
            j += 1

    merged_lyric = '\n'.join(merged)
    return merged_lyric, has_translation


async def search_track(title, artist, album):
    result_list = []
    result_cap = 3  # 最多只返回3个
    fetch_limit = 100
    search_str = ' '.join([item for item in [title, artist, album] if item])
    url = COMMON_SEARCH_URL_WANGYI.format(urllib.parse.quote_plus(search_str), 1, 0, fetch_limit)
    t_start = time.time()

    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(url, timeout=10) as resp:
            if resp.status != 200:
                return None
            song_info = await resp.json(content_type=None)
    t_api = time.time()
    test_time_print(f"[netease] 搜索API耗时: {(t_api-t_start)*1000:.1f}ms")

    # 打印原始API返回内容，便于调试
    #debug_str = json.dumps(song_info, ensure_ascii=False, indent=2)
    #print("[netease debug] 原始API返回:", debug_str[:5000] + ("..." if len(debug_str) > 5000 else ""))

    try:
        song_info: list[dict] = song_info["result"]["songs"]
    except (TypeError, KeyError):
        return []
    if len(song_info) < 1:
        return None
    candidate_songs = []
    for song_item in song_info:
        # 有些歌, 查询的 title 可能在别名里, 例如周杰伦的 八度空间-"分裂/离开", 有两个名字.
        song_names: list = list(song_item.get('alia') or [])
        song_names.append(song_item['name'])
        artists = song_item.get("ar") or []
        singer_name = " ".join([x['name'] for x in artists]) if artists else ""
        album_ = song_item.get("al")
        album_name = album_['name'] if album_ is not None else ''
        # 取所有名字中最高的相似度
        title_conform_ratio = max([textcompare.association(title, name) for name in song_names])
        artist_conform_ratio = textcompare.assoc_artists(artist, singer_name)
        album_conform_ratio = textcompare.association(album, album_name)

        ratio: float = (title_conform_ratio * (artist_conform_ratio + album_conform_ratio) / 2.0) ** 0.5

        if ratio >= 0.2:
            song_id = song_item['id']
            album_id = album_['id'] if album_ is not None else None
            singer_id = artists[0]['id'] if artists else None
            pic_url = album_['picUrl'] if album_ and album_.get('picUrl') else None
            candidate_songs.append(
                {'ratio': ratio, "item": {
                    "artist": singer_name,
                    "album": album_name,
                    "title": title,
                    "artist_id": singer_id,
                    "album_id": album_id,
                    "trace_id": song_id,
                    "picUrl": pic_url
                }})

    candidate_songs.sort(
        key=lambda x: x['ratio'], reverse=True)
    if len(candidate_songs) < 1:
        return None

    candidate_songs = candidate_songs[:min(len(candidate_songs), result_cap)]

    async def fetch_detail(track, ratio):
        # 优先用 song_item['al']['picUrl']
        t0 = time.time()
        cover_url = track.get('picUrl')
        t_cover = None
        if not cover_url and track.get('album_id'):
            t_cover_start = time.time()
            cover_url = await get_cover_url(track['album_id'])
            t_cover = time.time() - t_cover_start
        t_lyric_start = time.time()
        lyrics, has_translation = await get_lyrics(track['trace_id'])
        t_lyric = time.time() - t_lyric_start
        t1 = time.time()
        test_time_print(f"[netease] fetch_detail 歌曲: {track['title']} 总耗时: {(t1-t0)*1000:.1f}ms (cover:{(t_cover if t_cover is not None else 0)*1000:.1f}ms lyric:{t_lyric*1000:.1f}ms)")

        music_json_data: dict = {
            "title": track['title'],
            "album": track['album'],
            "artist": track['artist'],
            "lyrics": lyrics,
            "cover": cover_url,
            "id": tools.calculate_md5(f"title:{track['title']};artists:{track['artist']};album:{track['album']}", base='decstr'),
            "has_translation": has_translation
        }
        return music_json_data

    tasks = [fetch_detail(candidate['item'], candidate['ratio']) for candidate in candidate_songs]
    result_list = await asyncio.gather(*tasks)
    return result_list


async def search_artist(artist):
    blur_result = await search_artist_blur(artist_blur=artist)
    if blur_result:
        music_json_data: dict = {
            "cover": blur_result['img1v1Url']
        }
        return listify(music_json_data)
    return None


async def search_album(artist, album):
    album_info = await get_album_info(artist, album)
    if album_info:
        music_json_data: dict = {
            "cover": album_info['picUrl']
        }
        return listify(music_json_data)
    return None


@lru_cache(maxsize=64)
@no_error(throw=logger.info,
          exceptions=(KeyError, IndexError, AttributeError))
def search(title='', artist='', album=''):
    """
    查询封面: 
        三者都传：获取歌曲封面
        不传歌曲标题：获取专辑封面 --- 传歌手/歌曲
        只传歌手名：获取歌手图片
    查询歌词:
        title 不能为空
        album, artist 这两个可以为空
    """
    # 确保参数为字符串，防止 NoneType 导致 textcompare 崩溃
    title = str(title) if title else ''
    artist = str(artist) if artist else ''
    album = str(album) if album else ''

    if not any((title, artist, album)):
        return None
    
    # force strip
    title = title.strip()
    artist = artist.strip()
    album = album.strip()

    # 查询歌曲, 包括封面和歌词
    t_search_start = time.time()
    result = None
    if title:
        result = asyncio.run(search_track(title=title, artist=artist, album=album))
    elif artist and album:
        result = asyncio.run(search_album(artist, album))
    elif artist:
        result = asyncio.run(search_artist(artist))
    t_search_end = time.time()
    test_time_print(f"[netease] search 总耗时: {(t_search_end-t_search_start)*1000:.1f}ms")
    return result