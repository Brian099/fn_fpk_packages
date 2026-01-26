import json
import time
import asyncio
from mod import tools
from mod import textcompare
import os
import sys

if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(BASE_DIR, 'lib'))

import aiohttp

TEST_TIME_LOG = False #耗时统计
if TEST_TIME_LOG:
    def test_time_print(*args, **kwargs):
        print(time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()), *args, **kwargs)
else:
    def test_time_print(*args, **kwargs):
        pass

COMMON_SEARCH_URL_QQ = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
LYRIC_URL_QQ = 'https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1'
ALBUM_COVER_URL_QQ = 'https://y.qq.com/music/photo_new/T002R300x300M000{albummid}.jpg'

headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
    'origin': 'https://y.qq.com/',
    'referer': 'https://y.qq.com/',
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
}
async def async_search_with_keyword(keyword, origin=False, session=None):
    t_start = time.perf_counter()
    data = {
        "comm": {"ct": "19", "cv": "1859", "uin": "0"},
        "req": {
            "method": "DoSearchForQQMusicDesktop",
            "module": "music.search.SearchCgiService",
            "param": {
                "grp": 1,
                "num_per_page": 10,
                "page_num": 1,
                "query": keyword,
                "search_type": 0
            }
        }
    }
    t_req_start = time.perf_counter()
    async with session.post(COMMON_SEARCH_URL_QQ, data=json.dumps(data, ensure_ascii=False).encode('utf-8')) as resp:
        resp_data = await resp.json(content_type=None)
    t_req_end = time.perf_counter()
    t_parse_end = time.perf_counter()
    test_time_print(f"[qq] async_search_with_keyword: 网络请求耗时: {(t_req_end-t_req_start)*1000:.2f} ms, 解析耗时: {(t_parse_end-t_req_end)*1000:.2f} ms, 总耗时: {(t_parse_end-t_start)*1000:.2f} ms")
    if origin:
        return resp_data
    try:
        body = resp_data['req']['data']['body']
        return body['song']
    except Exception:
        return None

async def async_get_song_lyric(songmid, parse=False, origin=False, session=None):
    t_start = time.perf_counter()
    url = LYRIC_URL_QQ.format(songmid)
    t_req_start = time.perf_counter()

    async with session.get(url) as resp:
        data = await resp.json(content_type=None)
    
    t_req_end = time.perf_counter()
    t_parse_end = time.perf_counter()
    test_time_print(f"[qq] async_get_song_lyric: 网络请求耗时: {(t_req_end-t_req_start)*1000:.2f} ms, 解析耗时: {(t_parse_end-t_req_end)*1000:.2f} ms, 总耗时: {(t_parse_end-t_start)*1000:.2f} ms")
    if origin:
        return data
    try:
        if not parse:
            return data.get('lyric', '') + "\n" + data.get('trans', '')
        else:
            return parse_lyric(data)
    except Exception:
        return None
    
def parse_lyric(data):
    parsed = {
        "ti": "",
        "ar": "",
        "al": "",
        "by": "",
        "offset": "",
        "count": 0,
        "haveTrans": False,
        "lyric": [],
    }
    lyric = data.get('lyric', '').split("\n")
    trans = data.get('trans', '').split("\n")
    parsed['haveTrans'] = bool(trans and trans[0])

    def substr(str_):
        return str_[str_.find(":") + 1:str_.find("]")]
    if lyric and not lyric[0].startswith("[0"):
        parsed['ti'] = substr(lyric[0])
        parsed['ar'] = substr(lyric[1])
        parsed['al'] = substr(lyric[2])
        parsed['by'] = substr(lyric[3])
        parsed['offset'] = substr(lyric[4])
        lyric = lyric[5:]
        if parsed['haveTrans']:
            trans = trans[5:]
    parsed['count'] = len(lyric)
    for i in range(parsed['count']):
        ele = {"time": "", "lyric": "", "trans": ""}
        if lyric[i]:
            ele['time'] = lyric[i][1:lyric[i].find("]")]
            ele['lyric'] = lyric[i][lyric[i].find("]") + 1:]
            if parsed['haveTrans'] and i < len(trans):
                ele['trans'] = trans[i][trans[i].find("]") + 1:]
        parsed['lyric'].append(ele)
    return parsed

async def async_search(title='', artist='', album=''):
    t_start = time.perf_counter()
    title = str(title) if title else ''
    artist = str(artist) if artist else ''
    album = str(album) if album else ''
    if not any((title, artist, album)):
        return None
    title = title.strip()
    artist = artist.strip()
    album = album.strip()
    if title:
        res = await async_search_track(title=title, artist=artist, album=album)
        t_end = time.perf_counter()
        test_time_print(f"[qq] async_search: 总耗时: {(t_end-t_start)*1000:.2f} ms")
        return res
    return None

async def async_search_track(title, artist, album, max_results=3, score_threshold=0.5):
    t_start = time.perf_counter()
    search_str = ' '.join([item for item in [title, artist, album] if item])
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        songs = await async_search_with_keyword(search_str, session=session)
        t_search_end = time.perf_counter()
        if not songs or 'list' not in songs or not songs['list']:
            test_time_print(f"[qq] async_search_track: 搜索耗时: {(t_search_end-t_start)*1000:.2f} ms (无结果)")
            return []

        scored_items = []
        for song_item in songs['list']:
            song_title = song_item.get('name', '')
            album_name = song_item.get('album', {}).get('title', '')
            artist_name = ' '.join([s.get('name') for s in song_item.get('singer', [])])
            title_score = textcompare.association(title, song_title)
            artist_score = textcompare.assoc_artists(artist, artist_name) if artist else 1.0
            album_score = textcompare.association(album, album_name) if album else 1.0
            
            # 基础分数
            score = 0.6 * title_score + 0.3 * artist_score + 0.1 * album_score
            
            # 为精确匹配的专辑名称提供额外加分，提高排名优先级
            if album and album_name == album:
                score += 0.2
            if score < score_threshold:
                continue
            scored_items.append((score, song_item, song_title, album_name, artist_name))

        async def fetch_detail(args):
            score, song_item, song_title, album_name, artist_name = args
            songmid = song_item.get('mid')
            t_cover_start = time.perf_counter()

            cover_url = await async_get_album_cover_image(
                albummid=song_item.get('album', {}).get('mid', ''),
                vs=song_item.get('vs', []),
                session=session
            )
            t_cover_end = time.perf_counter()
            t_lyric_start = time.perf_counter()
            lyric_data = await async_get_song_lyric(songmid, parse=True, session=session) if songmid else ''
            t_lyric_end = time.perf_counter()
            test_time_print(f"[qq] 单曲cover耗时: {(t_cover_end-t_cover_start)*1000:.2f} ms, lyric耗时: {(t_lyric_end-t_lyric_start)*1000:.2f} ms")

            has_translation = False
            if isinstance(lyric_data, dict):
                time_map = {}
                for item in lyric_data.get('lyric', []):
                    time_tag = item.get('time', '')
                    lyric_line = item.get('lyric', '')
                    trans_line = item.get('trans', '')
                    if time_tag:
                        if time_tag not in time_map:
                            time_map[time_tag] = {'lyric': [], 'trans': []}
                        if lyric_line:
                            time_map[time_tag]['lyric'].append(lyric_line)
                        if trans_line:
                            time_map[time_tag]['trans'].append(trans_line)
                            has_translation = True
                def time_key(ts):
                    try:
                        parts = ts.split(':')
                        if len(parts) == 2:
                            m, s = parts
                            if '.' in s:
                                s, ms = s.split('.')
                                return int(m)*60*1000 + int(s)*1000 + int(ms.ljust(3,'0'))
                            else:
                                return int(m)*60*1000 + int(s)*1000
                        return 0
                    except Exception:
                        return float('inf')
                lines = []
                for ts in sorted(time_map.keys(), key=time_key):
                    for lyric_line in time_map[ts]['lyric']:
                        lyric_line = lyric_line.strip()
                        if lyric_line and lyric_line != '//':
                            lines.append(f'[{ts}]{lyric_line}')
                    for trans_line in time_map[ts]['trans']:
                        trans_line = trans_line.strip()
                        if trans_line and trans_line != '//':
                            lines.append(f'[{ts}]{trans_line}')
                lyrics = '\n'.join(lines)
            else:
                lyrics = lyric_data or ''

            music_json_data = dict(song_item)
            music_json_data.update({
                "title": song_title,
                "album": album_name,
                "artist": artist_name,
                "lyrics": lyrics,
                "cover": cover_url,
                "id": tools.calculate_md5(f"title:{song_title};artists:{artist_name};album:{album_name}", base='decstr'),
                "has_translation": has_translation
            })
            return music_json_data

        scored_items.sort(key=lambda x: x[0], reverse=True)
        top_items = scored_items[:max_results]
        results = await asyncio.gather(*(fetch_detail(item) for item in top_items))
        t_end = time.perf_counter()
        test_time_print(f"[qq] async_search_track: 总耗时: {(t_end-t_start)*1000:.2f} ms")
        return results

async def async_get_album_cover_image(albummid=None, vs=None, session=None):
    t_start = time.perf_counter()

    async def async_check_album_url(url, timeout=0.7, idx=None):
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if idx is not None:
                    test_time_print(f"[debug] check album[{idx}] {url} status: {resp.status}")
                else:
                    test_time_print(f"[debug] check album {url} status: {resp.status}")
                return resp.status == 200
        except Exception as e:
            if idx is not None:
                test_time_print(f"[debug] check album[{idx}] {url} exception: {repr(e)}")
            else:
                test_time_print(f"[debug] check album {url} exception: {repr(e)}")
            return False

    if albummid and isinstance(albummid, str) and len(albummid) >= 4:
        album_url = ALBUM_COVER_URL_QQ.format(albummid=albummid)
        if await async_check_album_url(album_url, timeout=0.7):
            t_end = time.perf_counter()
            test_time_print(f"[qq] async_get_album_cover_image: 命中album封面，总耗时: {(t_end-t_start)*1000:.2f} ms")
            return album_url
        else:
            test_time_print(f"[qq] async_get_album_cover_image: album封面无效，尝试vs图")
    else:
        test_time_print(f"[qq] async_get_album_cover_image: 无albummid，尝试vs图")

    if vs and isinstance(vs, list):
        vs_urls = []
        for idx, v in enumerate(vs, 1):
            if v and isinstance(v, str) and len(v) >= 4:
                vs_urls.append((idx, f"https://y.qq.com/music/photo_new/T062R300x300M000{v}.jpg"))

        async def async_quick_check_url(url, timeout=0.5):
            try:
                idx, url_real = url if isinstance(url, tuple) else (None, url)
                async with session.get(url_real, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                    if idx is not None:
                        test_time_print(f"[debug] check vs[{idx}] {url_real} status: {resp.status}")
                    else:
                        test_time_print(f"[debug] check {url_real} status: {resp.status}")
                    return resp.status == 200
            except Exception as e:
                idx, url_real = url if isinstance(url, tuple) else (None, url)
                if idx is not None:
                    test_time_print(f"[debug] check vs[{idx}] {url_real} exception: {repr(e)}")
                else:
                    test_time_print(f"[debug] check {url_real} exception: {repr(e)}")
                return False

        async def check_vs_images(urls):
            tasks = [async_quick_check_url(url, timeout=0.5) for url in urls]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result, url in zip(results, urls):
                if result is True:
                    url_real = url if isinstance(url, tuple) else (None, url)
                    return url_real
            return None

        if vs_urls:
            url = await check_vs_images(vs_urls)
            t_end = time.perf_counter()
            if url:
                test_time_print(f"[qq] async_get_album_cover_image: 命中vs封面，总耗时: {(t_end-t_start)*1000:.2f} ms")
                return url

    t_end = time.perf_counter()
    test_time_print(f"[qq] async_get_album_cover_image: 未命中封面，总耗时: {(t_end-t_start)*1000:.2f} ms")
    return None

def search(title='', artist='', album=''):
    """
    兼容包装入口
    """
    return asyncio.run(async_search(title=title, artist=artist, album=album))