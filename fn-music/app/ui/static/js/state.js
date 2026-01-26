import { ui } from './ui.js';

const cachedNeteaseUser = JSON.parse(localStorage.getItem('2fmusic_netease_user') || 'null');

// 状态集中管理
export const state = {
  fullPlaylist: JSON.parse(localStorage.getItem('2fmusic_playlist') || '[]'),
  displayPlaylist: [],
  playQueue: [],
  currentTrackIndex: 0,
  isPlaying: false,
  playMode: 0,
  lyricsData: [],
  currentFetchId: 0,
  favorites: new Set(JSON.parse(localStorage.getItem('2fmusic_favs') || '[]')),
  savedState: JSON.parse(localStorage.getItem('2fmusic_state') || '{}'),
  currentTab: JSON.parse(localStorage.getItem('2fmusic_state') || '{}').tab || 'local',
  selectedPlaylistId: JSON.parse(localStorage.getItem('2fmusic_state') || '{}').selectedPlaylistId || null,
  // 排序状态
  currentSort: JSON.parse(localStorage.getItem('2fmusic_state') || '{}').currentSort || 'title',
  sortOrder: JSON.parse(localStorage.getItem('2fmusic_state') || '{}').sortOrder || 'asc',
  // 收藏夹缓存
  cachedPlaylists: JSON.parse(localStorage.getItem('2fmusic_cached_playlists') || '[]'),
  cachedPlaylistsTime: parseInt(localStorage.getItem('2fmusic_cached_playlists_time') || '0'),
  // 收藏夹歌曲缓存，key为playlistId，value为歌曲ID数组
  cachedPlaylistSongs: JSON.parse(localStorage.getItem('2fmusic_cached_playlist_songs') || '{}'),
  // 缓存设置
  cacheCovers: JSON.parse(localStorage.getItem('2fmusic_cache_settings') || '{}').cacheCovers === true,
  cacheLyrics: JSON.parse(localStorage.getItem('2fmusic_cache_settings') || '{}').cacheLyrics === true,
  offlineSupport: JSON.parse(localStorage.getItem('2fmusic_cache_settings') || '{}').offlineSupport === true,
  neteaseResults: [],
  neteaseRecommendations: [],
  neteaseResultSource: 'recommend',
  neteasePollingTimer: null,
  currentLoginKey: null,
  neteaseDownloadDir: '',
  neteaseApiBase: '',
  neteaseSelected: new Set(),
  neteaseUser: cachedNeteaseUser,
  neteaseIsVip: cachedNeteaseUser?.isVip || false,
  neteaseDownloadTasks: [],
  neteasePendingQueue: [],
  neteaseQueueToastShown: false,
  neteaseMaxConcurrent: 20,
  isPolling: false,
  progressToastEl: null,
  currentConfirmAction: null,
  libraryVersion: 0,
};

// 保存收藏夹缓存
export function saveCachedPlaylists(playlists) {
  state.cachedPlaylists = playlists;
  state.cachedPlaylistsTime = Date.now();
  localStorage.setItem('2fmusic_cached_playlists', JSON.stringify(playlists));
  localStorage.setItem('2fmusic_cached_playlists_time', state.cachedPlaylistsTime.toString());
}

// 保存收藏夹歌曲缓存
export function saveCachedPlaylistSongs(playlistId, songs) {
  state.cachedPlaylistSongs[playlistId] = songs;
  localStorage.setItem('2fmusic_cached_playlist_songs', JSON.stringify(state.cachedPlaylistSongs));
}

// 保存缓存设置
export function saveCacheSettings() {
  const cacheSettings = {
    cacheCovers: state.cacheCovers,
    cacheLyrics: state.cacheLyrics,
    offlineSupport: state.offlineSupport
  };
  localStorage.setItem('2fmusic_cache_settings', JSON.stringify(cacheSettings));
}

export function persistState(audio, sortState = {}) {
  const { playQueue, currentTrackIndex, playMode, currentTab, selectedPlaylistId, currentSort, sortOrder } = state;
  const currentSong = playQueue[currentTrackIndex];
  
  // 如果有排序状态需要保存，即使当前歌曲是外部文件，也保存排序状态
  if (sortState.currentSort || sortState.sortOrder) {
    // 获取当前保存的状态
    const savedState = JSON.parse(localStorage.getItem('2fmusic_state') || '{}');
    
    // 更新排序状态
    const updatedState = {
      ...savedState,
      currentSort: sortState.currentSort || currentSort || 'title',
      sortOrder: sortState.sortOrder || sortOrder || 'asc'
    };
    
    // 保存更新后的状态
    localStorage.setItem('2fmusic_state', JSON.stringify(updatedState));
    return;
  }
  
  // 如果没有排序状态需要保存，并且当前歌曲是外部文件，则不保存任何状态
  if (currentSong && currentSong.isExternal) return;

  const nextState = {
    volume: audio?.volume ?? 1,
    playMode,
    currentTime: audio?.currentTime ?? 0,
    currentFilename: currentSong ? currentSong.filename : null,
    tab: currentTab,
    selectedPlaylistId,
    isFullScreen: ui.overlay ? ui.overlay.classList.contains('active') : false,
    // 保存排序状态
    currentSort: currentSort || 'title',
    sortOrder: sortOrder || 'asc'
  };
  localStorage.setItem('2fmusic_state', JSON.stringify(nextState));

  // 3. 记录播放历史 (最多保留100条)
  if (currentSong && currentSong.filename) {
    try {
      const playHistory = JSON.parse(localStorage.getItem('2fmusic_play_history') || '[]');
      const historyEntry = {
        filename: currentSong.filename,
        title: currentSong.title,
        artist: currentSong.artist,
        playedAt: new Date().toISOString(),
        duration: audio?.duration || 0,
        currentTime: audio?.currentTime || 0
      };
      
      // 避免重复记录同一首歌 (5秒内的重复)
      const lastEntry = playHistory[playHistory.length - 1];
      if (!lastEntry || lastEntry.filename !== currentSong.filename || 
          (Date.now() - new Date(lastEntry.playedAt).getTime()) > 5000) {
        playHistory.push(historyEntry);
        
        // 只保留最近100条历史
        if (playHistory.length > 100) {
          playHistory.splice(0, playHistory.length - 100);
        }
        
        localStorage.setItem('2fmusic_play_history', JSON.stringify(playHistory));
      }
    } catch (e) {
      console.warn('Failed to save play history:', e);
    }
  }
}

// 记录歌曲收听统计 (用于个性化推荐)
export function updateListenStats(song, listenTime = 0) {
  if (!song || !song.filename) return;
  
  try {
    const stats = JSON.parse(localStorage.getItem('2fmusic_listen_stats') || '{}');
    const key = song.filename;
    
    // 初始化或更新统计
    if (!stats[key]) {
      stats[key] = {
        filename: song.filename,
        title: song.title,
        artist: song.artist,
        playCount: 0,
        totalListenTime: 0,
        lastListenTime: null,
        averageListenPercent: 0
      };
    }
    
    const stat = stats[key];
    stat.playCount = (stat.playCount || 0) + 1;
    stat.totalListenTime = (stat.totalListenTime || 0) + listenTime;
    stat.lastListenTime = new Date().toISOString();
    
    // 保存数据（最多1000条统计，保留热门歌曲）
    const allStats = Object.values(stats);
    if (allStats.length > 1000) {
      // 按playCount降序排序，删除最少听的歌曲
      allStats.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
      allStats.splice(1000); // 保留前1000条
      
      const newStats = {};
      allStats.forEach(s => newStats[s.filename] = s);
      localStorage.setItem('2fmusic_listen_stats', JSON.stringify(newStats));
    } else {
      localStorage.setItem('2fmusic_listen_stats', JSON.stringify(stats));
    }
  } catch (e) {
    console.warn('Failed to update listen stats:', e);
  }
}

// 获取收听统计（用于排序或推荐）
export function getListenStats(filename) {
  try {
    const stats = JSON.parse(localStorage.getItem('2fmusic_listen_stats') || '{}');
    return stats[filename] || null;
  } catch (e) {
    console.warn('Failed to get listen stats:', e);
    return null;
  }
}

export function saveFavorites() {
  localStorage.setItem('2fmusic_favs', JSON.stringify([...state.favorites]));
}

export function savePlaylist() {
  localStorage.setItem('2fmusic_playlist', JSON.stringify(state.fullPlaylist));
}