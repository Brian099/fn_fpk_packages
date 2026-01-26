import threading
import time
import random
from mod.searchx import qq, netease, kugou
from mod import textcompare

API_BONUS = {'qq': 0.01, 'netease': 0.005, 'kugou': 0.0}  # API权重加分

def search_song_best(title, artist, album):
    """
    并发搜索三大平台，返回最优匹配结果（dict），无则返回None。
    """
    def search_api(api_func, title, artist, album, result_list, source, cost_list):
        start = time.perf_counter()
        results = api_func(title=title, artist=artist, album=album)
        elapsed = (time.perf_counter() - start) * 1000  # ms
        cost_list.append(f"{source} API: {elapsed:.2f} ms")
        if results:
            for idx, item in enumerate(results):
                item = dict(item)
                item['source'] = source
                item['platform_rank'] = idx
                result_list.append(item)

    def filter_music_json(item):
        return {
            "title": item.get("title", ""),
            "album": item.get("album", ""),
            "artist": item.get("artist", ""),
            "lyrics": item.get("lyrics", ""),
            "cover": item.get("cover", ""),
            "id": item.get("id", ""),
            "source": item.get("source", ""),
            "has_translation": item.get("has_translation", False),
            "platform_rank": item.get("platform_rank", 0)
        }

    t_all_start = time.perf_counter()
    threads = []
    all_results = []
    api_costs = []
    apis = [
        (qq.search, 'qq'),
        (netease.search, 'netease'),
        (kugou.search, 'kugou')
    ]
    cost_msgs = []
    t_thread_start = time.perf_counter()
    for api, source in apis:
        t = threading.Thread(target=search_api, args=(api, title, artist, album, all_results, source, api_costs))
        threads.append(t)
        t.start()
    t_thread_end = time.perf_counter()
    cost_msgs.append(f"\n[search_util] 线程启动耗时: {(t_thread_end - t_thread_start)*1000:.2f} ms")
    t_join_start = time.perf_counter()
    for t in threads:
        t.join()
    t_join_end = time.perf_counter()
    cost_msgs.append(f"[search_util] 等待所有线程完成耗时: {(t_join_end - t_join_start)*1000:.2f} ms")
    t_score_start = time.perf_counter()
    scored = []
    for item in all_results:
        filtered = filter_music_json(item)
        title_score = textcompare.association(title, filtered.get('title', ''))
        artist_score = textcompare.assoc_artists(artist, filtered.get('artist', '')) if artist else 1.0
        album_score = textcompare.association(album, filtered.get('album', '')) if album else 1.0

        # 歌曲计算总分
        score = 0.5 * title_score + 0.35 * artist_score + 0.15 * album_score
        
        # 专辑精确匹配额外加分
        if album and filtered.get('album', '').strip() == album.strip():
            score += 0.2
        
        score += API_BONUS.get(filtered.get('source'), 0.0)
        
        # 如果有翻译，增加额外加分
        if filtered.get('has_translation', False):
            score += 0.02
        

        platform_rank = item.get('platform_rank', 0)
        # API内部排序加分规则：第1位+0.05，第2位+0.03，第3位+0.01，之后不加分
        if platform_rank == 0:
            score += 0.05
        elif platform_rank == 1:
            score += 0.03
        elif platform_rank == 2:
            score += 0.01
        scored.append([score, filtered])

    # 对分数接近的结果加动态随机扰动（分数越接近，扰动范围越小）
    scored.sort(reverse=True, key=lambda x: x[0])
    for i in range(1, len(scored)):
        diff = abs(scored[i][0] - scored[i-1][0])
        if diff < 0.01:
            max_disturb = 0.005 * (1 - diff/0.01)
            scored[i][0] += random.uniform(-max_disturb, max_disturb)

    # 重新排序
    scored.sort(reverse=True, key=lambda x: x[0])
    t_score_end = time.perf_counter()
    cost_msgs.append(f"[search_util] 结果打分耗时: {(t_score_end - t_score_start)*1000:.2f} ms")
    t_sort_start = time.perf_counter()
    scored.sort(reverse=True, key=lambda x: x[0])
    t_sort_end = time.perf_counter()
    cost_msgs.append(f"[search_util] 排序耗时: {(t_sort_end - t_sort_start)*1000:.2f} ms")

    # 增强结果筛选：优先选择有封面且歌词质量高的结果
    def is_high_quality(item):
        has_cover = bool(item.get('cover'))
        has_valid_lyrics = len(item.get('lyrics', '')) > 50
        return has_cover and has_valid_lyrics

    best = None
    # 先找高质量结果
    for score, item in scored:
        if is_high_quality(item):
            best = item
            break
    # 如果没有高质量结果，退而求其次
    if not best:
        # 至少要有封面
        for score, item in scored:
            if item.get('cover'):
                best = item
                break
        # 如果连封面都没有，选分数最高的
        if not best and scored:
            best = scored[0][1]

    print('\n全部结果按相似度排序:')
    for idx, (s, item) in enumerate(scored, 1):
        trans_mark = ' [双语]' if item.get('has_translation') else ''
        platform_rank = item.get('platform_rank', -1)
        print(f"{idx}. [{item.get('source')}] score={s:.3f} platform_rank={platform_rank} title={item.get('title')} artist={item.get('artist')} album={item.get('album')} cover={item.get('cover')}{trans_mark}")
    if best:
        lyrics_preview = best.get('lyrics')
        if lyrics_preview:
            lyrics_preview = lyrics_preview[:20] + '...' if len(lyrics_preview) > 20 else lyrics_preview
        trans_mark = ' [双语]' if best.get('has_translation') else ''

    t_all_end = time.perf_counter()
    cost_msgs.append(f"[search_util] 总耗时: {(t_all_end - t_all_start)*1000:.2f} ms")
    cost_msgs.append(f"\n[search_util] 最优结果: API={best.get('source')} 标题={best.get('title')} 歌手={best.get('artist')} 专辑={best.get('album')} 封面={best.get('cover')} 歌词预览={lyrics_preview}{trans_mark}")
    cost_msgs.append("\nAPI 耗时统计：")
    cost_msgs.extend(api_costs)
    print("\n".join(cost_msgs))
    return best