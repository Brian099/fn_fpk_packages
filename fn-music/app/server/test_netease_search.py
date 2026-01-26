from mod.searchx import netease

if __name__ == "__main__":
    # 测试：搜索歌曲“可能”，歌手“程响”
    result = netease.search(title="エウテルペ", artist="EGOIST", album="Departures - Anata Ni Okuru Ai No Uta")
    print("搜索结果：")
    for idx, item in enumerate(result, 1):
        print(f"[{idx}] 标题: {item['title']}")
        print(f"歌手: {item['artist']}")
        print(f"专辑: {item['album']}")
        print(f"封面: {item['cover']}")
        #print(f"歌词: {item['lyrics']}" if item['lyrics'] else "歌词: 无")
        print(f"双语: {item['has_translation']}")
        #if item['lyrics']:
        #    lrc = item['lyrics']
        #    print(f"歌词: {lrc[:20]}{'...' if len(lrc) > 20 else ''}")
        #else:
        #    print("歌词: 无")
        print(f"ID: {item['id']}")
        print('-'*40)