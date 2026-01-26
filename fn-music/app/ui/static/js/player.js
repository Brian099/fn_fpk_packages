import { state, persistState, saveFavorites, savePlaylist, saveCachedPlaylists, saveCachedPlaylistSongs, updateListenStats, getListenStats } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { showToast, showConfirmDialog, hideProgressToast, updateDetailFavButton, formatTime, renderNoLyrics, updateSliderFill, flyToElement, throttle, extractColorFromImage } from './utils.js';
import { startScanPolling, loadMountPoints } from './mounts.js';
import { showPlaylistSelectDialog, loadPlaylistFilter, handlePlaylistFilterChange, showCreatePlaylistDialog, clearPlaylistCache } from './favorites.js';
import { batchManager } from './batch-manager.js';
import { renderArtistAggregateView } from './artist-aggregate.js';
import { openQueueModal } from './queue-manager.js';
import { getCoverFromCache, saveCoverToCache, deleteCoverFromCache, getLyricsFromCache, saveLyricsToCache, deleteLyricsFromCache } from './db.js';

// 收藏功能相关函数已部分移至 favorites.js

// 收藏 (Server Sync)
async function toggleFavorite(song, btnEl) {
  if (!song.id) return;
  const isFav = state.favorites.has(song.id);

  if (isFav) {
    // 乐观 UI 更新
    state.favorites.delete(song.id);
    if (btnEl) { btnEl.classList.remove('active'); btnEl.innerHTML = '<i class="far fa-heart"></i>'; }
    try {
      if (state.selectedPlaylistId) {
        // 如果在收藏夹详情页，只从当前收藏夹中移除
        await api.favorites.remove(song.id, state.selectedPlaylistId);

        // 更新当前收藏夹的缓存
        try {
          const songsRes = await api.favoritePlaylists.getSongs(state.selectedPlaylistId);
          if (songsRes.data) {
            saveCachedPlaylistSongs(state.selectedPlaylistId, songsRes.data);
          }
        } catch (e) {
          console.error(`更新收藏夹 ${state.selectedPlaylistId} 缓存失败:`, e);
        }
      } else {
        // 如果在其他页面（如本地音乐），从所有收藏夹中移除
        try {
          // 获取所有收藏夹列表
          const playlistsRes = await api.favoritePlaylists.list();
          const playlistIds = playlistsRes.data ? playlistsRes.data.map(p => p.id) : [];

          // 确保包含默认收藏夹
          if (!playlistIds.includes('default')) {
            playlistIds.push('default');
          }

          // 从每个收藏夹中移除歌曲
          for (const playlistId of playlistIds) {
            try {
              await api.favorites.remove(song.id, playlistId);
            } catch (e) {
              // 如果从某个收藏夹移除失败，继续尝试其他收藏夹
              console.error(`从收藏夹 ${playlistId} 移除歌曲失败:`, e);
            }
          }
        } catch (e) {
          // 如果获取收藏夹列表失败，至少从默认收藏夹中移除
          console.error('获取收藏夹列表失败:', e);
          await api.favorites.remove(song.id, 'default');
        }
      }
    } catch (e) { console.error(e); }
    saveFavorites();

    // 更新收藏夹缓存，确保下次访问收藏夹页面时能看到最新内容
    if (!state.selectedPlaylistId) {
      try {
        // 获取所有收藏夹的最新歌曲列表并更新缓存
        const playlistsRes = await api.favoritePlaylists.list();
        const playlists = playlistsRes.data || [];

        // 更新每个收藏夹的歌曲列表缓存
        for (const playlist of playlists) {
          try {
            const songsRes = await api.favoritePlaylists.getSongs(playlist.id);
            if (songsRes.data) {
              saveCachedPlaylistSongs(playlist.id, songsRes.data);
            }
          } catch (e) {
            console.error(`获取收藏夹 ${playlist.id} 歌曲列表失败:`, e);
          }
        }

        // 处理默认收藏夹
        try {
          const defaultSongsRes = await api.favoritePlaylists.getSongs('default');
          if (defaultSongsRes.data) {
            saveCachedPlaylistSongs('default', defaultSongsRes.data);
          }
        } catch (e) {
          console.error('获取默认收藏夹歌曲列表失败:', e);
        }

        // 更新收藏夹列表缓存
        saveCachedPlaylists(playlists);
      } catch (e) {
        console.error('更新收藏夹缓存失败:', e);
      }
    }

    const currentPlaying = state.playQueue[state.currentTrackIndex];
    if (currentPlaying && currentPlaying.id === song.id) {
      updateDetailFavButton(state.favorites.has(song.id));
    }
    if (state.currentTab === 'fav' && !state.favorites.has(song.id)) renderPlaylist();
  } else {
    // 弹出收藏夹选择窗口
    showPlaylistSelectDialog(song, btnEl);
  }
}

// showPlaylistSelectDialog 函数已移至 favorites.js
// addToSelectedPlaylist 函数已移至 favorites.js

const throttledPersist = throttle(() => persistState(ui.audio), 2000);

// Wake Lock Logic
let wakeLock = null;
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      if (document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock active');
      }
    } catch (err) {
      console.warn('Wake Lock failed:', err);
    }
  }
}
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().then(() => { wakeLock = null; console.log('Wake Lock released'); });
  }
}

export async function loadSongs(retry = true, initPlayer = true) {
  console.log('[Player] loadSongs 开始执行 (retry=' + retry + ', initPlayer=' + initPlayer + ')');
  // 初始化排序顺序：如果未设置过或排序顺序与该排序方式的默认值不符，则使用默认值
  if (!state.savedState.sortOrder || state.savedState.sortOrder !== getDefaultSortOrder(state.currentSort)) {
    state.sortOrder = getDefaultSortOrder(state.currentSort);
  }

  // 1. 优先使用缓存显示 (SWR)
  if (state.fullPlaylist.length > 0 && state.playQueue.length === 0) {
    state.playQueue = [...state.fullPlaylist];
    // 在初始渲染前更新排序按钮显示，确保使用保存的排序状态
    updateSortButton();
    // 应用保存的排序状态
    if (state.currentTab === 'local' || state.currentTab === 'fav') renderPlaylist();
    if (!ui.audio.src && initPlayer) { initPlayerState(); }
  }

  try {
    // 并行获取歌曲库、收藏列表和收藏夹列表，允许单个失败
    const results = await Promise.allSettled([
      api.library.list(),
      api.favorites.list(),
      api.favoritePlaylists.list()
    ]);
    
    const libJson = results[0].status === 'fulfilled' ? results[0].value : { success: false, data: [], offline: true };
    const favJson = results[1].status === 'fulfilled' ? results[1].value : { success: false, data: [], offline: true };
    const playlistJson = results[2].status === 'fulfilled' ? results[2].value : { success: false, data: [], offline: true };
    
    if (results[0].status === 'rejected') {
      console.error('[Player] 音乐列表获取异常:', results[0].reason);
    }
    if (results[1].status === 'rejected') {
      console.error('[Player] 收藏列表获取异常:', results[1].reason);
    }
    if (results[2].status === 'rejected') {
      console.error('[Player] 收藏夹列表获取异常:', results[2].reason);
    }

    // 检查是否从离线缓存获取
    const isOffline = libJson.offline || favJson.offline || playlistJson.offline;
    if (isOffline) {
      console.log('[离线] 使用缓存数据:');
      if (libJson.offline) console.log(`  - 音乐列表: ${libJson.data?.length || 0} 首歌曲`);
      if (favJson.offline) console.log(`  - 收藏列表: ${favJson.data?.length || 0} 首歌曲`);
      if (playlistJson.offline) console.log(`  - 收藏夹列表: ${playlistJson.data?.length || 0} 个收藏夹`);
    }

    if (favJson.success && favJson.data) {
      state.favorites = new Set(favJson.data);
      saveFavorites();
    }

    // 加载并缓存收藏夹列表
    if (playlistJson.success && playlistJson.data) {
      saveCachedPlaylists(playlistJson.data);
      
      // 预加载所有收藏夹内的歌曲列表（离线缓存用）
      console.log('[Player] 预加载所有收藏夹歌曲列表...');
      for (const playlist of playlistJson.data) {
        try {
          const songs = await api.favoritePlaylists.getSongs(playlist.id);
          if (songs.success) {
            console.log(`[Player] 已预加载收藏夹歌曲: ${playlist.name} (${songs.data?.length || 0} 首)`);
          }
        } catch (e) {
          console.warn(`[Player] 预加载收藏夹歌曲失败: ${playlist.name}`, e.message);
        }
      }
    }

    if (libJson.success && libJson.data) {
      console.log('[Player] 处理音乐列表数据，共 ' + libJson.data.length + ' 首歌曲');
      // 2. 合并数据：保留本地缓存的封面和歌词
      const oldMap = new Map(state.fullPlaylist.map(s => [s.filename, s]));
      const newList = libJson.data.map(item => {
        const old = oldMap.get(item.filename);
        return {
          ...item,
          title: item.title || item.filename,
          artist: item.artist || '未知艺术家',
          id: item.id,
          src: `/api/music/play/${encodeURIComponent(item.id)}`,
          cover: (old && old.cover && !old.cover.includes('ICON_256')) ? old.cover : (item.album_art || '/static/images/ICON_256.PNG'),
          lyrics: (old && old.lyrics) ? old.lyrics : item.lyrics
        };
      });

      // 检查新数据是否与旧数据有显著差异
      const hasSignificantChanges = JSON.stringify(newList.map(s => s.filename)) !== JSON.stringify(state.fullPlaylist.map(s => s.filename));

      state.fullPlaylist = newList;
      savePlaylist(); // 更新缓存

      // 更新排序按钮显示
      updateSortButton();

      // 3. 更新播放队列上下文
      if (state.currentTab === 'local') {
        const currentFilename = state.playQueue[state.currentTrackIndex]?.filename;
        state.playQueue = [...state.fullPlaylist];
        if (currentFilename) {
          const newIdx = state.playQueue.findIndex(s => s.filename === currentFilename);
          if (newIdx !== -1) state.currentTrackIndex = newIdx;
        }
        // 只有当数据有显著变化时才重新渲染，减少闪现
        if (hasSignificantChanges) {
          setTimeout(() => renderPlaylist(), 100);
        }
      } else if (state.currentTab === 'fav') {
        // 只有当数据有显著变化时才重新渲染，减少闪现
        if (hasSignificantChanges) {
          setTimeout(() => renderPlaylist(), 100);
        }
      }

      if (state.playQueue.length === 0) state.playQueue = [...state.fullPlaylist];
      if (!ui.audio.src && initPlayer) { await initPlayerState(); }
    } else {
      console.error('[Player] 无法获取音乐列表数据:', libJson.message);
      if (ui.songContainer.children.length === 0) {
        // 检查是否有本地缓存的数据
        if (state.fullPlaylist.length > 0) {
          console.log('[Player] 使用本地缓存的音乐列表，共 ' + state.fullPlaylist.length + ' 首歌曲');
          state.playQueue = [...state.fullPlaylist];
          renderPlaylist();
        } else {
          ui.songContainer.innerHTML = '<div class="loading">加载失败</div>';
        }
      }
    }
  } catch (e) {
    console.error('[Player] loadSongs 异常:', e);
    // 异常情况下，使用本地缓存数据继续显示
    if (state.fullPlaylist.length > 0) {
      console.log('[Player] [异常恢复] 使用本地缓存的音乐列表，共 ' + state.fullPlaylist.length + ' 首歌曲');
      state.playQueue = [...state.fullPlaylist];
      updateSortButton();
      if (state.currentTab === 'local' || state.currentTab === 'fav') {
        renderPlaylist();
      }
      if (!ui.audio.src && initPlayer) { await initPlayerState(); }
    } else {
      // 没有任何缓存，显示加载失败
      if (ui.songContainer.children.length === 0)
        ui.songContainer.innerHTML = '<div class="loading">离线且无缓存数据</div>';
    }
    
    // 重试一次（2秒后）
    if (retry) {
      console.log('[Player] 2秒后重试...');
      setTimeout(() => loadSongs(false), 2000);
    }
  }
}

let isUploadingScan = false;
export function startScan(isUserAction = false) {
  if (isUploadingScan) return;
  isUploadingScan = true;
  startScanPolling(isUserAction, loadSongs);
}

export async function performDelete(songId) {
  const encodedName = encodeURIComponent(songId);
  if (ui.audio.src.includes(encodedName)) { // 简单的匹配检查
    ui.audio.pause();
    ui.audio.removeAttribute('src');
    ui.audio.load();
    ['current-title', 'fp-title'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = '等待播放'; });
    ['current-cover', 'fp-cover'].forEach(id => { const el = document.getElementById(id); if (el) el.src = '/static/images/ICON_256.PNG'; });
    state.isPlaying = false;
    updatePlayState();
    ui.overlay?.classList.remove('active');
  }
  const delay = ms => new Promise(res => setTimeout(res, ms));
  await delay(200);
  try {
    const data = await api.library.deleteFile(songId);
    if (data.success) {
      showToast('删除成功');
      await loadSongs();
      // 删除后保持当前标签页，刷新时不跳走
      switchTab(state.currentTab || 'local');
      ui.actionMenuOverlay?.classList.remove('active');
      ui.confirmModalOverlay?.classList.remove('active');
    }
    else { showToast('删除失败: ' + (data.error || '未知错误')); }
  } catch (err) { console.error('删除错误:', err); showToast('网络请求失败'); }
}

export async function handleExternalFile() {
  const params = new URLSearchParams(window.location.search);
  const externalPath = params.get('path');
  const isImportMode = window.location.pathname === '/import_mode';
  const isPreviewMode = window.location.pathname === '/preview';

  if (!externalPath) return;
  if (isImportMode) {
    ui.uploadModal?.classList.add('active');
    if (ui.uploadFileName) ui.uploadFileName.innerText = '外部文件';
    if (ui.uploadFill) ui.uploadFill.style.width = '100%';
    if (ui.uploadPercent) ui.uploadPercent.innerText = 'Importing...';
    if (ui.uploadMsg) ui.uploadMsg.innerText = '正在导入...';
    if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'none';
    try {
      const data = await api.library.importPath(externalPath);
      if (data.success) {
        if (ui.uploadMsg) ui.uploadMsg.innerText = '导入成功'; window.history.replaceState({}, document.title, '/'); await loadSongs(); switchTab('local'); const idx = state.fullPlaylist.findIndex(s => s.filename === data.filename); if (idx !== -1) {
          state.playQueue = [...state.fullPlaylist];
          await playTrack(idx);
          setTimeout(() => ui.uploadModal?.classList.remove('active'), 800);
        }
      } else { throw new Error(data.error); }
    } catch (err) { if (ui.uploadMsg) ui.uploadMsg.innerText = '失败: ' + err.message; if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'inline-block'; }
  } else {
    // Preview Mode or Direct Play
    try {
      const json = await api.library.externalMeta(externalPath);
      if (json.success && json.data) {
        const song = json.data;
        const tempSong = { title: song.title, artist: song.artist, album: song.album, filename: song.filename, src: `/api/music/external/play?path=${encodeURIComponent(song.filename)}`, cover: song.album_art || '/static/images/ICON_256.PNG', isExternal: true };
        state.fullPlaylist.unshift(tempSong);
        switchTab('local');
        state.playQueue = [...state.fullPlaylist];
        await playTrack(0);
        ui.overlay?.classList.add('active'); window.history.replaceState({}, document.title, '/');
      }
    } catch (err) { console.error('直接播放失败:', err); }
  }
}

// 添加一个标记，防止并发渲染
let isRendering = false;

// 排序状态使用state对象管理，已移至state.js

// 排序配置
const SORT_CONFIG = {
  title: { label: '标题', icon: 'fa-sort-alpha-down' },
  artist: { label: '歌手', icon: 'fa-user' },
  album: { label: '专辑', icon: 'fa-compact-disc' },
  mtime: { label: '时间', icon: 'fa-clock', defaultOrder: 'desc' }, // 默认由新到旧
  size: { label: '大小', icon: 'fa-database', defaultOrder: 'desc' }, // 默认由大到小
  playCount: { label: '频率', icon: 'fa-play', defaultOrder: 'desc', fromStats: true } // 从收听统计获取
};

// 格式化播放次数显示 (大于等于1000时显示为"1.2K")
function formatPlayCount(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return count.toString();
}

// 获取排序方式的默认顺序
function getDefaultSortOrder(sortType) {
  return (SORT_CONFIG[sortType] && SORT_CONFIG[sortType].defaultOrder) || 'asc';
}

// 通用排序函数 - 提取重复的排序逻辑
function sortSongs(songs, sortType = state.currentSort, sortOrder = state.sortOrder) {
  return [...songs].sort((a, b) => {
    let valueA, valueB;

    switch (sortType) {
      case 'title':
        valueA = (a.title || '').toLowerCase();
        valueB = (b.title || '').toLowerCase();
        break;
      case 'artist':
        valueA = (a.artist || '').toLowerCase();
        valueB = (b.artist || '').toLowerCase();
        break;
      case 'album':
        valueA = (a.album || '').toLowerCase();
        valueB = (b.album || '').toLowerCase();
        break;
      case 'mtime':
        valueA = a.mtime || 0;
        valueB = b.mtime || 0;
        break;
      case 'size':
        valueA = a.size || 0;
        valueB = b.size || 0;
        break;
      case 'playCount':
        // 从收听统计获取播放次数
        const statsA = getListenStats(a.filename);
        const statsB = getListenStats(b.filename);
        valueA = (statsA && statsA.playCount) || 0;
        valueB = (statsB && statsB.playCount) || 0;
        break;
      default:
        valueA = (a.title || '').toLowerCase();
        valueB = (b.title || '').toLowerCase();
    }

    if (valueA < valueB) return sortOrder === 'asc' ? -1 : 1;
    if (valueA > valueB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });
}

// 获取热门歌曲列表 (按播放次数排序)
function getHotlistSongs(songs, limit = 50) {
  // 添加收听统计数据
  const songsWithStats = songs.map(song => {
    const stats = getListenStats(song.filename);
    return {
      ...song,
      playCount: (stats && stats.playCount) || 0
    };
  });

  // 按播放次数降序排序，过滤掉未听过的歌曲
  return songsWithStats
    .filter(s => s.playCount > 0)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, limit);
}

// 更新排序按钮显示
function updateSortButton() {
  if (!ui.btnSort) return;

  // 检查按钮是否已经被HTML预加载设置过（包含非默认图标）
  const hasPreload = ui.btnSort.innerHTML && !ui.btnSort.innerHTML.includes('fa-sort');
  
  // 如果已经被预加载设置过，且按钮内容已经包含正确的排序类型，就不再更新
  if (hasPreload && ui.btnSort.innerHTML) {
    const currentHtml = ui.btnSort.innerHTML;
    const sortConfig = SORT_CONFIG[state.currentSort];
    const expectedText = sortConfig ? sortConfig.label : '标题';
    if (currentHtml.includes(expectedText)) {
      // 仍然需要更新dropdown的active状态
      document.querySelectorAll('.sort-option').forEach(option => {
        if (option.dataset.sort === state.currentSort) {
          option.classList.add('active');
        } else {
          option.classList.remove('active');
        }
      });
      return;
    }
  }

  // 获取当前排序类型的文本
  const sortConfig = SORT_CONFIG[state.currentSort];
  const sortText = sortConfig ? sortConfig.label : '标题';
  const sortIcon = sortConfig ? sortConfig.icon : 'fa-sort-alpha-down';

  // 更新按钮文本
  ui.btnSort.innerHTML = `
    <i class="fas ${sortIcon}"></i> ${sortText}
  `;

  // 更新排序选项的活动状态
  document.querySelectorAll('.sort-option').forEach(option => {
    if (option.dataset.sort === state.currentSort) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });
}

export function renderPlaylist() {
  if (!ui.songContainer) return;

  // 如果已经在渲染中，直接返回
  if (isRendering) return;

  isRendering = true;

  // 清空容器
  ui.songContainer.innerHTML = '';

  if (state.currentTab === 'fav') {
    // 检查是否有选中的收藏夹（使用状态变量替代筛选器）
    const selectedPlaylistId = state.selectedPlaylistId;

    if (!selectedPlaylistId) {
      // 收藏主页：显示收藏夹文件夹形式
      renderFavoritesHome().finally(() => {
        isRendering = false;
      });
    } else {
      // 收藏夹详情页：显示该收藏夹的歌曲，并提供排序筛选
      renderPlaylistDetails(selectedPlaylistId).finally(() => {
        isRendering = false;
      });
    }
  } else if (state.currentTab === 'hotlist') {
    // 播放记录页：显示播放过的歌曲，按播放次数降序
    const hotlistSongs = getHotlistSongs(state.fullPlaylist, 500);
    
    // 设置displayPlaylist用于卡片索引
    state.displayPlaylist = hotlistSongs;
    
    if (hotlistSongs.length === 0) {
      ui.songContainer.className = 'song-list';
      ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">还没有播放过歌曲，开始播放来建立播放记录</div>`;
    } else {
      ui.songContainer.className = 'song-list';
      // 不再排序，保持已排序的顺序
      renderPlaylistSongs(hotlistSongs, true);
    }
    isRendering = false;
  } else {
    // 非收藏页，保持原有列表显示
    // 重置容器类名为默认的song-list，避免收藏页样式影响
    ui.songContainer.className = 'song-list';

    // 恢复移动端顶栏标题为默认值
    const mobilePageTitle = document.getElementById('mobile-page-title');
    if (mobilePageTitle) {
      // 根据当前标签页设置相应的标题
      if (state.currentTab === 'local') {
        mobilePageTitle.textContent = '本地音乐';
      } else if (state.currentTab === 'mount') {
        mobilePageTitle.textContent = '目录管理';
      } else if (state.currentTab === 'netease') {
        mobilePageTitle.textContent = '网易下载';
      } else if (state.currentTab === 'upload') {
        mobilePageTitle.textContent = '上传音乐';
      } else if (state.currentTab === 'settings') {
        mobilePageTitle.textContent = '设置';
      }
    }
    let filteredSongs;
    filteredSongs = [...state.fullPlaylist];

    // 应用排序：只在本地音乐页面使用
    if (state.currentTab === 'local') {
      filteredSongs = sortSongs(filteredSongs);
      
      // 如果是歌手排序，使用聚合视图
      if (state.currentSort === 'artist') {
        state.displayPlaylist = filteredSongs;
        renderArtistAggregateView(filteredSongs, playTrack);
        isRendering = false;
        return;
      }
    }

    state.displayPlaylist = filteredSongs;

    if (state.displayPlaylist.length === 0) {
      ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">暂无歌曲</div>`;
      // 重置渲染标记
      isRendering = false;
      return;
    }

    const frag = document.createDocumentFragment();
    state.displayPlaylist.forEach((song, index) => {
      const card = document.createElement('div');
      card.className = 'song-card';
      card.dataset.index = index;
      if (song.isExternal) card.style.border = '1px dashed var(--primary)';

      // 卡片内容（不包含复选框和收藏按钮）
      card.innerHTML = `<img src="${song.cover}" loading="lazy"><div class="card-info"><div class="title" title="${song.title}">${song.title}</div><div class="artist">${song.artist}</div></div>`;

      card.addEventListener('click', (e) => {
        // 防止点击复选框时触发播放
        if (e.target.closest('.song-checkbox')) {
          return;
        }
        state.playQueue = [...state.displayPlaylist];
        playTrack(index);
      });
      frag.appendChild(card);
    });
    ui.songContainer.appendChild(frag);

    // 离线缓存或网络改进：预加载所有列表项的封面（异步并发，不阻塞 UI）
    if (state.displayPlaylist.length > 0) {
      console.log('[Player] 开始后台加载 ' + state.displayPlaylist.length + ' 首歌曲的封面');
      // 使用异步生成器实现并发控制
      const loadCoversWithConcurrency = async (songs, maxConcurrent = 3) => {
        let inProgress = 0;
        let songIndex = 0;
        
        while (songIndex < songs.length) {
          // 并发加载最多 maxConcurrent 个
          while (inProgress < maxConcurrent && songIndex < songs.length) {
            const song = songs[songIndex];
            const index = songIndex;
            inProgress++;
            
            (async () => {
              try {
                // 获取缓存的封面
                if (song.cover?.includes('ICON_256')) {
                  const cacheKey = song.id || song.filename;
                  try {
                    const cachedCover = await Promise.race([
                      getCoverFromCache(cacheKey),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
                    ]);
                    if (cachedCover) {
                      song.cover = cachedCover;
                      // 更新 DOM 中对应的图片
                      const cards = ui.songContainer.querySelectorAll('.song-card');
                      if (cards[index]) {
                        const img = cards[index].querySelector('img');
                        if (img) img.src = cachedCover;
                      }
                    }
                  } catch (e) {
                    // 缓存加载失败或超时，保持默认封面
                  }
                }
              } finally {
                inProgress--;
              }
            })();
            
            songIndex++;
          }
          
          // 等待至少一个完成
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      
      // 异步加载，不阻塞主线程
      loadCoversWithConcurrency(state.displayPlaylist, 3).catch(e => console.warn('[Player] 后台加载封面出错:', e.message));
    }

    // 恢复批量选择状态
    if (batchManager && batchManager.restoreBatchState) {
      batchManager.restoreBatchState();
    }

    // 重置渲染标记
    isRendering = false;
  }

  // 当不在收藏夹主页时，确保隐藏添加收藏夹按钮
  if (!(state.currentTab === 'fav' && !state.selectedPlaylistId)) {
    // 隐藏添加收藏夹按钮
    const playlistFilterContainer = document.getElementById('playlist-filter-container');
    if (playlistFilterContainer) {
      playlistFilterContainer.classList.add('hidden');
    }
  }

  // 当不在收藏夹详情页时，确保移除详情页特有的按钮
  if (!(state.currentTab === 'fav' && state.selectedPlaylistId)) {
    // 移除可能存在的返回按钮和菜单按钮
    let existingBackBtn = document.querySelector('.back-to-favorites-btn');
    while (existingBackBtn) {
      existingBackBtn.remove();
      existingBackBtn = document.querySelector('.back-to-favorites-btn');
    }

    let existingMenuBtn = document.querySelector('.playlist-menu-btn');
    while (existingMenuBtn) {
      existingMenuBtn.remove();
      existingMenuBtn = document.querySelector('.playlist-menu-btn');
    }
  }

  // 移动端适配：关闭侧边栏，添加轻微延迟避免误触
  if (ui.sidebar && ui.sidebar.classList.contains('open')) {
    setTimeout(() => {
      if (ui.sidebar && ui.sidebar.classList.contains('open')) {
        ui.sidebar.classList.remove('open');
      }
    }, 200); // 200ms延迟关闭，避免误触
  }

  highlightCurrentTrack();
}

// 渲染收藏主页：显示收藏夹文件夹
export async function renderFavoritesHome() {
  // 只有在真正的收藏夹主页（没有选中的收藏夹）时才设置标题
  if (!state.selectedPlaylistId) {
    // 恢复列表标题为"我的收藏列表"
    const listTitle = document.getElementById('list-title');
    if (listTitle) {
      listTitle.textContent = '收藏列表';
    }

    // 恢复移动端顶栏标题为"我的收藏"
    const mobilePageTitle = document.getElementById('mobile-page-title');
    if (mobilePageTitle) {
      mobilePageTitle.textContent = '我的收藏';
    }
  }

  // 总是移除可能已存在的返回按钮和菜单按钮（这些按钮只在收藏夹详情页显示）
  let existingBackBtn = document.querySelector('.back-to-favorites-btn');
  while (existingBackBtn) {
    existingBackBtn.remove();
    existingBackBtn = document.querySelector('.back-to-favorites-btn');
  }

  let existingMenuBtn = document.querySelector('.playlist-menu-btn');
  while (existingMenuBtn) {
    existingMenuBtn.remove();
    existingMenuBtn = document.querySelector('.playlist-menu-btn');
  }

  // 显示添加收藏夹按钮（只在收藏夹主页显示）
  const playlistFilterContainer = document.getElementById('playlist-filter-container');
  if (playlistFilterContainer) {
    playlistFilterContainer.classList.remove('hidden');
  }

  // 为收藏夹页面设置合适的网格布局
  ui.songContainer.className = 'song-list favorites-grid';

  // 1. 优先使用本地缓存数据渲染，缓存为空时从服务器获取
  let cachedPlaylists = state.cachedPlaylists || [];

  // 如果缓存中没有数据，直接从服务器获取
  if (cachedPlaylists.length === 0) {
    try {
      // 同步从服务器获取数据
      const res = await api.favoritePlaylists.list();

      if (res && res.data) {
        // 去重处理
        const uniquePlaylists = [];
        const seenIds = new Set();

        res.data.forEach(playlist => {
          if (!seenIds.has(playlist.id)) {
            seenIds.add(playlist.id);
            uniquePlaylists.push(playlist);
          }
        });

        // 对收藏夹进行排序：默认收藏夹排第一位，其他按名称排序
        const sortedPlaylists = uniquePlaylists.sort((a, b) => {
          // 默认收藏夹排第一位
          if (a.name === '默认收藏夹' && b.name !== '默认收藏夹') return -1;
          if (a.name !== '默认收藏夹' && b.name === '默认收藏夹') return 1;
          // 其他收藏夹按名称排序
          return a.name.localeCompare(b.name);
        });

        // 更新缓存
        saveCachedPlaylists(sortedPlaylists);
        cachedPlaylists = sortedPlaylists;
      }
    } catch (err) {
      console.error('加载收藏夹列表失败:', err);
      // 如果缓存中没有数据且加载失败，显示错误信息
      ui.songContainer.innerHTML = '<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">加载收藏夹失败</div>';
      return;
    }
  }

  if (cachedPlaylists.length > 0) {
    const frag = document.createDocumentFragment();

    // 对收藏夹进行排序：默认收藏夹排第一位，其他按名称排序
    const sortedPlaylists = [...cachedPlaylists].sort((a, b) => {
      // 默认收藏夹排第一位
      if (a.name === '默认收藏夹' && b.name !== '默认收藏夹') return -1;
      if (a.name !== '默认收藏夹' && b.name === '默认收藏夹') return 1;
      // 其他收藏夹按名称排序
      return a.name.localeCompare(b.name);
    });

    // 并行创建所有收藏夹卡片
    const playlistPromises = sortedPlaylists.map(async (playlist) => {
      // 创建收藏夹文件夹卡片
      const folderCard = document.createElement('div');
      folderCard.className = 'folder-card';
      folderCard.dataset.playlistId = playlist.id;

      // 默认封面
      let folderCover = '/static/images/ICON_256.PNG';

      // 如果收藏夹有歌曲，尝试获取第一首歌曲的封面
      if (playlist.song_count > 0) {
        try {
          // 优先使用缓存的歌曲列表
          const cachedSongs = state.cachedPlaylistSongs[playlist.id] || [];
          if (cachedSongs.length > 0) {
            // 从完整歌曲列表中找到对应的歌曲
            const firstSong = state.fullPlaylist.find(song => song.id === cachedSongs[0]);
            // 如果找到歌曲且有封面，使用该封面
            if (firstSong && firstSong.cover) {
              folderCover = firstSong.cover;
            }
          } else {
            // 缓存中没有歌曲列表，尝试从API获取
            const songsRes = await api.favoritePlaylists.getSongs(playlist.id);
            if (songsRes.success && songsRes.data && songsRes.data.length > 0) {
              // 获取第一首歌曲的ID
              const firstSongId = songsRes.data[0];
              // 从完整歌曲列表中找到对应的歌曲
              const firstSong = state.fullPlaylist.find(song => song.id === firstSongId);
              // 如果找到歌曲且有封面，使用该封面
              if (firstSong && firstSong.cover) {
                folderCover = firstSong.cover;
              }
            }
          }
        } catch (err) {
          console.error(`获取收藏夹 ${playlist.name} 的歌曲列表失败:`, err);
        }
      }

      folderCard.innerHTML = `
        <div class="folder-header">
          <img src="${folderCover}" loading="lazy" class="folder-cover">
          <div class="folder-info">
            <div class="folder-name">${playlist.name} </div>
            <div class="folder-count">${playlist.song_count || 0} 首歌曲</div>
          </div>
          <div class="folder-arrow">
            <i class="fas fa-arrow-right"></i>
          </div>
        </div>
      `;

      // 添加点击事件，进入收藏夹详情页
      folderCard.addEventListener('click', () => {
        state.selectedPlaylistId = playlist.id;
        renderPlaylist();
      });

      return folderCard;
    });

    // 等待所有收藏夹卡片创建完成
    Promise.all(playlistPromises).then(folderCards => {
      // 清空容器并添加卡片
      ui.songContainer.innerHTML = '';
      folderCards.forEach(card => frag.appendChild(card));
      ui.songContainer.appendChild(frag);
    });
  } else {
    // 没有收藏夹数据
    ui.songContainer.innerHTML = '<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">暂无收藏夹</div>';
  }

  // 2. 后台静默获取最新数据并更新
  api.favoritePlaylists.list().then(async res => {
    if (res && res.data) {
      // 去重处理
      const uniquePlaylists = [];
      const seenIds = new Set();

      res.data.forEach(playlist => {
        if (!seenIds.has(playlist.id)) {
          seenIds.add(playlist.id);
          uniquePlaylists.push(playlist);
        }
      });

      // 对收藏夹进行排序：默认收藏夹排第一位，其他按名称排序
      const sortedPlaylists = uniquePlaylists.sort((a, b) => {
        // 默认收藏夹排第一位
        if (a.name === '默认收藏夹' && b.name !== '默认收藏夹') return -1;
        if (a.name !== '默认收藏夹' && b.name === '默认收藏夹') return 1;
        // 其他收藏夹按名称排序
        return a.name.localeCompare(b.name);
      });

      // 更新缓存
      saveCachedPlaylists(sortedPlaylists);

      // 如果缓存数据与当前显示的数据不同，重新渲染
      if (JSON.stringify(uniquePlaylists) !== JSON.stringify(state.cachedPlaylists)) {
        // 重新渲染页面以显示最新数据
        renderPlaylist();
      }
    }
  }).catch(err => {
    console.error('后台更新收藏夹列表失败:', err);
    // 后台更新失败不影响用户当前使用
  });
}

// 渲染收藏夹详情页：显示歌曲并提供排序筛选
function renderPlaylistDetails(playlistId) {
  // 进入收藏夹详情页时，完全清空批量操作状态
  batchManager.resetBatchState();
  batchManager.selectedIds.clear();
  const stateData = JSON.parse(localStorage.getItem('2fmusic_state') || '{}');
  stateData.batchSelected = [];
  localStorage.setItem('2fmusic_state', JSON.stringify(stateData));
  
  // 1. 优先使用本地缓存数据渲染
  const cachedPlaylist = state.cachedPlaylists.find(p => String(p.id) === String(playlistId));
  const cachedSongs = state.cachedPlaylistSongs[playlistId] || [];

  // 如果有缓存的收藏夹信息
  if (cachedPlaylist) {
    const playlistName = cachedPlaylist.name;

    // 恢复普通歌曲网格布局（小卡片）
    ui.songContainer.className = 'song-list';

    // 修改现有的列表标题为收藏夹名称
    const listTitle = document.getElementById('list-title');
    if (listTitle) {
      listTitle.textContent = playlistName;
    }

    // 修改移动端顶栏标题为收藏夹名称
    const mobilePageTitle = document.getElementById('mobile-page-title');
    if (mobilePageTitle) {
      mobilePageTitle.textContent = playlistName;
    }

    // 总是移除可能已存在的返回按钮和菜单按钮，确保创建新的
    let existingBackBtn = document.querySelector('.back-to-favorites-btn');
    while (existingBackBtn) {
      existingBackBtn.remove();
      existingBackBtn = document.querySelector('.back-to-favorites-btn');
    }

    let existingMenuBtn = document.querySelector('.playlist-menu-btn');
    while (existingMenuBtn) {
      existingMenuBtn.remove();
      existingMenuBtn = document.querySelector('.playlist-menu-btn');
    }

    // 创建返回按钮（只在收藏夹详情页显示）
    const backBtn = document.createElement('button');
    backBtn.className = 'back-to-favorites-btn mobile-back-btn';
    backBtn.title = '返回我的收藏';

    // 检查是否为移动端
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      // 在移动端，将返回按钮添加到顶栏右侧
      backBtn.innerHTML = `<i class="fas fa-arrow-left"></i>`;
      backBtn.style.fontSize = '1.5rem';
      backBtn.style.background = 'rgba(255, 255, 255, 0.05)';
      backBtn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
      backBtn.style.color = 'rgba(255, 255, 255, 0.6)';
      backBtn.style.padding = '0.5rem 0.7rem';
      backBtn.style.borderRadius = '2rem';
      backBtn.style.cursor = 'pointer';
      backBtn.style.position = 'absolute';
      backBtn.style.right = '1rem';
      backBtn.style.top = '50%';
      backBtn.style.transform = 'translateY(-50%)';
      backBtn.style.transition = 'all 0.3s ease';
      // 添加悬停效果
      backBtn.addEventListener('mouseenter', function () {
        this.style.color = 'rgba(255, 255, 255, 0.8)';
      });
      backBtn.addEventListener('mouseleave', function () {
        this.style.color = 'rgba(255, 255, 255, 0.6)';
      });

      // 找到顶栏
      const topBar = document.querySelector('.top-bar');
      if (topBar) {
        // 将返回按钮添加到顶栏
        topBar.appendChild(backBtn);
      }
    } else {
      // 在桌面端，将返回按钮添加到content-header容器内，在标题之前
      backBtn.innerHTML = `<i class="fas fa-arrow-left"></i> 返回`;
      const contentHeader = document.querySelector('.content-header');
      if (contentHeader && listTitle) {
        // 确保返回按钮插入到正确位置
        contentHeader.insertBefore(backBtn, listTitle);
      } else if (contentHeader) {
        // 如果找不到标题元素，就直接添加到contentHeader末尾
        contentHeader.appendChild(backBtn);
      }
    }

    // 添加返回按钮事件监听
    backBtn.addEventListener('click', () => {
      // 清除选中的收藏夹
      state.selectedPlaylistId = null;
      // 重新渲染收藏主页
      renderPlaylist();

      // 移除所有移动端返回按钮
      const mobileBackBtns = document.querySelectorAll('.mobile-back-btn');
      mobileBackBtns.forEach(btn => btn.remove());
    });

    // 隐藏添加收藏夹按钮：在收藏夹详情页隐藏
    const playlistFilterContainer = document.getElementById('playlist-filter-container');
    if (playlistFilterContainer) {
      playlistFilterContainer.classList.add('hidden');
    }

    // 添加三点菜单按钮（只在收藏夹详情页显示）
    const menuBtn = document.createElement('button');
    menuBtn.className = 'playlist-menu-btn';
    menuBtn.title = '更多操作';
    menuBtn.innerHTML = `<i class="fas fa-ellipsis-h"></i>`;

    // 获取header-actions容器
    const headerActions = document.querySelector('.header-actions');
    // 将菜单按钮添加到header-actions容器的最前面
    if (headerActions) {
      headerActions.insertBefore(menuBtn, headerActions.firstChild);
    }

    // 添加菜单按钮事件监听
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 显示删除确认对话框
      showConfirmDialog(
        '确认删除',
        `确定要删除收藏夹 "${playlistName}" 吗？`,
        () => {
          // 调用API删除收藏夹
          api.favoritePlaylists.delete(playlistId)
            .then(res => {
              if (res.success) {
                // 删除成功，更新本地缓存（只移除被删除的收藏夹）
                const updatedPlaylists = state.cachedPlaylists.filter(p => String(p.id) !== String(playlistId));
                saveCachedPlaylists(updatedPlaylists);

                // 清除被删除收藏夹的歌曲缓存
                if (state.cachedPlaylistSongs[playlistId]) {
                  delete state.cachedPlaylistSongs[playlistId];
                  localStorage.setItem('2fmusic_cached_playlist_songs', JSON.stringify(state.cachedPlaylistSongs));
                }

                state.selectedPlaylistId = null;
                renderPlaylist();
                showToast('收藏夹删除成功', 'success');
              } else {
                showToast('删除收藏夹失败: ' + (res.error || '未知错误'), 'error');
              }
            })
            .catch(err => {
              console.error('删除收藏夹失败:', err);
              showToast('删除收藏夹失败', 'error');
            });
        }
      );
    });

    // 如果有缓存的歌曲列表（包括空数组）
    if (cachedSongs !== undefined && cachedSongs !== null) {
      // 从完整歌曲列表中找到对应的歌曲信息
      const filteredSongs = state.fullPlaylist.filter(song =>
        cachedSongs.includes(song.id)
      );

      state.displayPlaylist = filteredSongs;

      if (state.displayPlaylist.length === 0) {
        ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">该收藏夹暂无歌曲</div>`;
      } else {
        // 按当前排序方式渲染歌曲
        renderPlaylistSongs(filteredSongs);
      }
    } else {
      // 缓存中没有歌曲列表，显示加载状态
      ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">加载中...</div>`;
    }
  } else {
    // 缓存中没有收藏夹信息，显示加载状态
    ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">加载中...</div>`;
  }

  // 2. 后台静默获取最新数据并更新
  return Promise.all([
    api.favoritePlaylists.list(),
    api.favoritePlaylists.getSongs(playlistId)
  ]).then(([playlistsRes, songsRes]) => {
    if (playlistsRes.success && playlistsRes.data && songsRes.success && songsRes.data) {
      // 确保ID类型匹配，避免类型不匹配导致的查找失败
      const playlist = playlistsRes.data.find(p => String(p.id) === String(playlistId));

      // 检查收藏夹是否存在，如果不存在，返回收藏主页
      if (!playlist) {
        // 清除选中的收藏夹ID
        state.selectedPlaylistId = null;
        // 重新渲染收藏主页
        renderPlaylist();
        return;
      }

      const playlistSongs = songsRes.data;

      // 更新缓存
      const updatedPlaylists = state.cachedPlaylists.filter(p => String(p.id) !== String(playlistId));
      updatedPlaylists.push(playlist);
      saveCachedPlaylists(updatedPlaylists);
      saveCachedPlaylistSongs(playlistId, playlistSongs);

      // 3. 总是更新UI标题（修复bug：从其他页面返回时标题丢失）
      const playlistName = playlist.name;
      const listTitle = document.getElementById('list-title');
      if (listTitle) {
        listTitle.textContent = playlistName;
      }
      const mobilePageTitle = document.getElementById('mobile-page-title');
      if (mobilePageTitle) {
        mobilePageTitle.textContent = playlistName;
      }

      // 从完整歌曲列表中找到对应的歌曲信息
      const filteredSongs = state.fullPlaylist.filter(song =>
        playlistSongs.includes(song.id)
      );

      // 如果数据有变化，重新渲染
      if (JSON.stringify(filteredSongs.map(s => s.id)) !== JSON.stringify(state.displayPlaylist.map(s => s.id))) {
        state.displayPlaylist = filteredSongs;

        if (state.displayPlaylist.length === 0) {
          ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">该收藏夹暂无歌曲</div>`;
        } else {
          // 按当前排序方式渲染歌曲
          renderPlaylistSongs(filteredSongs);
        }
      }
    }
  }).catch(err => {
    console.error('加载收藏夹详情失败:', err);
    // 如果缓存中没有数据且加载失败，显示错误信息
    if (!cachedPlaylist && cachedSongs.length === 0) {
      ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">加载收藏夹失败: ${err.message}</div>`;
    }
  });
}



// 渲染歌曲列表
export function renderPlaylistSongs(songs, skipSort = false) {
  // 直接使用ui.songContainer，因为它已经有song-list类和网格布局
  const songListContainer = ui.songContainer;

  songListContainer.innerHTML = '';

  // 应用排序（除非跳过排序，如从热门歌曲页调用时）
  const sortedSongs = skipSort ? songs : sortSongs(songs);

  if (sortedSongs.length === 0) {
    songListContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">没有找到匹配的歌曲</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  sortedSongs.forEach((song, index) => {
    const card = document.createElement('div');
    card.className = 'song-card';
    // 优先使用sortedSongs的索引，如果在displayPlaylist中则使用displayPlaylist索引
    let songIndex = state.displayPlaylist.indexOf(song);
    if (songIndex === -1) {
      // 如果不在displayPlaylist中，使用在sortedSongs中的索引
      songIndex = index;
    }
    card.dataset.index = songIndex;
    if (song.isExternal) card.style.border = '1px dashed var(--primary)';

    // 获取收听统计
    const stats = getListenStats(song.filename);
    // 只在播放次数大于等于1时显示徽章
    const playCountBadge = stats && stats.playCount >= 1 ? `<span class="play-count-badge" title="已播放${stats.playCount}次">${formatPlayCount(stats.playCount)}</span>` : '';

    // 卡片内容（不包含复选框和收藏按钮）
    card.innerHTML = `<img src="${song.cover}" loading="lazy"><div class="card-info"><div class="title" title="${song.title}">${song.title}</div><div class="artist">${song.artist}</div></div>${playCountBadge}`;

    card.addEventListener('click', (e) => {
      // 防止点击复选框时触发播放
      if (e.target.closest('.song-checkbox')) {
        return;
      }
      state.playQueue = [...songs];
      playTrack(songIndex);
    });
    frag.appendChild(card);
  });

  songListContainer.appendChild(frag);
  highlightCurrentTrack();

  // 后台异步并发加载封面（不阻塞 UI）
  if (sortedSongs.length > 0) {
    console.log('[Player] 开始后台加载 ' + sortedSongs.length + ' 首歌曲的封面');
    const loadCoversWithConcurrency = async (songs, maxConcurrent = 3) => {
      let inProgress = 0;
      let songIndex = 0;
      
      while (songIndex < songs.length) {
        while (inProgress < maxConcurrent && songIndex < songs.length) {
          const song = songs[songIndex];
          const index = songIndex;
          inProgress++;
          
          (async () => {
            try {
              if (song.cover?.includes('ICON_256')) {
                const cacheKey = song.id || song.filename;
                try {
                  const cachedCover = await Promise.race([
                    getCoverFromCache(cacheKey),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
                  ]);
                  if (cachedCover) {
                    song.cover = cachedCover;
                    // 更新 DOM 中对应的图片
                    const cards = songListContainer.querySelectorAll('.song-card');
                    if (cards[index]) {
                      const img = cards[index].querySelector('img');
                      if (img) img.src = cachedCover;
                    }
                  }
                } catch (e) {
                  // 缓存加载失败或超时，保持默认封面
                }
              }
            } finally {
              inProgress--;
            }
          })();
          
          songIndex++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    
    loadCoversWithConcurrency(sortedSongs, 3).catch(e => console.warn('[Player] 后台加载封面出错:', e.message));
  }

  // 恢复批量选择状态
  if (batchManager && batchManager.restoreBatchState) {
    batchManager.restoreBatchState();
  }
}

export function switchTab(tab) {
  const previousTab = state.currentTab;
  state.currentTab = tab;
  persistState(ui.audio);
  
  // 页面切换时重置右键菜单和清空复选框
  batchManager.resetBatchState();
  
  ui.navLocal?.classList.remove('active');
  ui.navFav?.classList.remove('active');
  ui.navHotlist?.classList.remove('active');
  ui.navMount?.classList.remove('active');
  ui.navNetease?.classList.remove('active');
  ui.navUpload?.classList.remove('active');
  ui.navSettings?.classList.remove('active');

  ui.viewPlayer?.classList.add('hidden');
  ui.viewMount?.classList.add('hidden');
  ui.viewNetease?.classList.add('hidden');
  ui.viewUpload?.classList.add('hidden');
  ui.viewSettings?.classList.add('hidden');

  if (tab === 'local') ui.navLocal?.classList.add('active');
  else if (tab === 'fav') ui.navFav?.classList.add('active');
  else if (tab === 'hotlist') ui.navHotlist?.classList.add('active');
  else if (tab === 'mount') ui.navMount?.classList.add('active');
  else if (tab === 'netease') ui.navNetease?.classList.add('active');
  else if (tab === 'upload') ui.navUpload?.classList.add('active');
  else if (tab === 'settings') ui.navSettings?.classList.add('active');

  if (tab === 'mount') {
    ui.viewMount?.classList.remove('hidden');
    loadMountPoints();
  } else if (tab === 'netease') {
    ui.viewNetease?.classList.remove('hidden');
  } else if (tab === 'upload') {
    ui.viewUpload?.classList.remove('hidden');
  } else if (tab === 'settings') {
    ui.viewSettings?.classList.remove('hidden');
  } else {
    // local or fav
    ui.viewPlayer?.classList.remove('hidden');
    ui.viewPlayer?.setAttribute('data-tab', tab);

    // Styling hooks for CSS
    if (tab === 'fav') {
      ui.viewPlayer?.classList.add('tab-fav');
      ui.viewPlayer?.classList.remove('tab-local');
    } else {
      ui.viewPlayer?.classList.add('tab-local');
      ui.viewPlayer?.classList.remove('tab-fav');
    }

    renderPlaylist();
    // Update Desktop Title
    const titleEl = document.getElementById('list-title');
    if (titleEl) {
      if (tab === 'fav') {
        // 如果选中了具体收藏夹，尝试显示收藏夹名称
        let playlistName = '收藏列表';
        if (state.selectedPlaylistId && state.cachedPlaylists) {
          const playlist = state.cachedPlaylists.find(p => String(p.id) === String(state.selectedPlaylistId));
          if (playlist) playlistName = playlist.name;
        }
        titleEl.innerText = playlistName;
      } else if (tab === 'hotlist') {
        titleEl.innerText = '播放记录';
      } else {
        titleEl.innerText = '歌曲列表';
      }
    }
  }

  // Update Mobile Title
  const titles = {
    'local': '本地音乐',
    'fav': '我的收藏',
    'hotlist': '播放记录',
    'mount': '目录管理',
    'netease': '网易下载',
    'upload': '上传音乐',
    'settings': '系统设置'
  };
  if (ui.mobileTitle) {
    let title = titles[tab] || '2FMusic';
    if (tab === 'fav' && state.selectedPlaylistId && state.cachedPlaylists) {
      const playlist = state.cachedPlaylists.find(p => String(p.id) === String(state.selectedPlaylistId));
      if (playlist) title = playlist.name;
    }
    ui.mobileTitle.innerText = title;
  }

  // Search Box Visibility: Only for Local Music
  if (ui.searchInput && ui.searchInput.parentElement) {
    if (tab === 'local') {
      ui.searchInput.parentElement.style.display = 'flex';
      ui.searchInput.parentElement.style.opacity = '1';
    } else {
      ui.searchInput.parentElement.style.display = 'none';
      ui.searchInput.parentElement.style.opacity = '0';
      ui.searchInput.value = ''; // Clear search
    }
  }

  // Clear NetEase Search Input when leaving NetEase tab
  if (tab !== 'netease' && ui.neteaseKeywordsInput) {
    ui.neteaseKeywordsInput.value = '';
  }

  // Sort Controls Visibility: Only for Local Music
  const sortControls = document.querySelector('.sort-controls');
  if (sortControls) {
    if (tab === 'local') {
      sortControls.style.display = 'flex';
      sortControls.style.opacity = '1';
    } else {
      sortControls.style.display = 'none';
      sortControls.style.opacity = '0';
    }
  }

  // 当切换到非收藏夹主页时，确保隐藏添加收藏夹按钮
  if (!(tab === 'fav' && !state.selectedPlaylistId)) {
    // 隐藏添加收藏夹按钮
    const playlistFilterContainer = document.getElementById('playlist-filter-container');
    if (playlistFilterContainer) {
      playlistFilterContainer.classList.add('hidden');
    }
  }

  // 当切换到非收藏夹页面时，确保移除收藏夹详情页特有的按钮
  if (tab !== 'fav') {
    // 移除可能存在的返回按钮和菜单按钮
    let existingBackBtn = document.querySelector('.back-to-favorites-btn');
    while (existingBackBtn) {
      existingBackBtn.remove();
      existingBackBtn = document.querySelector('.back-to-favorites-btn');
    }

    let existingMenuBtn = document.querySelector('.playlist-menu-btn');
    while (existingMenuBtn) {
      existingMenuBtn.remove();
      existingMenuBtn = document.querySelector('.playlist-menu-btn');
    }
  }

  // 移动端适配：关闭侧边栏，添加轻微延迟避免误触
  if (ui.sidebar && ui.sidebar.classList.contains('open')) {
    setTimeout(() => {
      if (ui.sidebar && ui.sidebar.classList.contains('open')) {
        ui.sidebar.classList.remove('open');
      }
    }, 120); // 120ms延迟关闭，避免误触
  }

  // 保存当前标签状态
  persistState(ui.audio);
}

async function initPlayerState() {
  const allowedTabs = ['local', 'fav', 'mount', 'netease', 'upload', 'settings', 'hotlist'];
  const preferredTab = allowedTabs.includes(state.currentTab) ? state.currentTab : null;
  const savedTab = allowedTabs.includes(state.savedState.tab) ? state.savedState.tab : 'local';
  const targetTab = preferredTab || savedTab;

  // Preview Mode: Force fullscreen immediately
  const isPreview = window.location.pathname === '/preview';
  if (isPreview) {
    ui.overlay?.classList.add('active');
  }

  switchTab(targetTab);
  if (state.savedState.volume !== undefined) { ui.audio.volume = state.savedState.volume; updateVolumeUI(ui.audio.volume); }
  if (state.savedState.playMode !== undefined) { state.playMode = state.savedState.playMode; updatePlayModeUI(); }
  if (state.savedState.isFullScreen) { ui.overlay?.classList.add('active'); }

  if (state.savedState.currentFilename) {
    // 优先通过文件名匹配，而不是索引
    const targetFilename = state.savedState.currentFilename;
    // playTrack index 必须是 playQueue 的 index。
    // 如果当前 tab 是 local，playQueue 默认是 full。

    // 简单起见，我们先在 fullPlaylist 里找，或者在当前 playQueue 里找
    let idx = state.playQueue.findIndex(s => s.filename === targetFilename);
    // 如果没找到且 playQueue 为空，则重建队列
    if (idx === -1 && state.playQueue.length > 0) {
      // 尝试在 playQueue 找
      idx = state.playQueue.findIndex(s => s.filename === targetFilename);
    }

    if (idx !== -1) {
      state.currentTrackIndex = idx;
      await playTrack(idx, false);

      // 稳健恢复进度
      if (state.savedState.currentTime) {
        const t = state.savedState.currentTime;
        const seek = () => { if (Math.abs(ui.audio.currentTime - t) > 1) ui.audio.currentTime = t; };
        if (ui.audio.readyState >= 1) seek();
        else ui.audio.addEventListener('loadedmetadata', seek, { once: true });

        const pct = (t / (ui.audio.duration || 100)) * 100;
        if (ui.progressBar) { ui.progressBar.value = pct; updateSliderFill(ui.progressBar); }
        if (ui.fpProgressBar) { ui.fpProgressBar.value = pct; updateSliderFill(ui.fpProgressBar); }
      }
    }
  }
  if (!ui.audio.src && state.playQueue.length > 0) {
    state.currentTrackIndex = 0;
    await playTrack(0, false);
  }
}

export async function playTrack(index, autoPlay = true) {
  if (index < 0 || index >= state.playQueue.length) return;
  state.currentFetchId++;
  state.currentTrackIndex = index;
  const track = state.playQueue[index];
  if (ui.audio.src !== window.location.origin + track.src) ui.audio.src = track.src;
  loadTrackInfo(track);
  checkAndFetchMetadata(track, state.currentFetchId);
  highlightCurrentTrack();
  if (autoPlay) {
    try {
      await ui.audio.play();
      state.isPlaying = true;
      updatePlayState();
      requestWakeLock();
    }
    catch (e) { console.error('Auto-play blocked:', e); state.isPlaying = false; updatePlayState(); }
  }
  persistState(ui.audio);
}

function loadTrackInfo(track) {
  if (!track) return;
  ['current-title', 'fp-title'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = track.title; });
  ['current-artist', 'fp-artist'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = track.artist; });
  // 更健壮的封面处理，确保始终有封面显示
  const coverSrc = track.cover && track.cover.trim() !== '' ? track.cover : '/static/images/ICON_256.PNG';
  ['current-cover', 'fp-cover'].forEach(id => { const el = document.getElementById(id); if (el) el.src = coverSrc; });
  updateDetailFavButton(state.favorites.has(track.id));
  document.title = `${track.title} - 2FMusic`;
  if (ui.lyricsContainer) ui.lyricsContainer.innerHTML = '';
  // 即使track.lyrics存在，也确保它不是空字符串
  if (track.lyrics && track.lyrics.trim() !== '') parseAndRenderLyrics(track.lyrics); else renderNoLyrics('正在搜索歌词...');
  if ('mediaSession' in navigator) { navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, artwork: [{ src: coverSrc, sizes: '512x512', type: 'image/jpeg' }] }); }
  if (ui.fpMenuBtn) { ui.fpMenuBtn.style.display = track.isExternal ? 'none' : 'block'; }
}

function highlightCurrentTrack() {
  if (!ui.audio.src) return;
  const currentSong = state.playQueue[state.currentTrackIndex];
  if (!currentSong) return;
  document.querySelectorAll('.song-card').forEach((card, i) => {
    const track = state.displayPlaylist[i];
    if (track && track.filename === currentSong.filename) card.classList.add('active');
    else card.classList.remove('active');
  });
}

function togglePlayMode() { state.playMode = (state.playMode + 1) % 3; updatePlayModeUI(); persistState(ui.audio); }
function updatePlayModeUI() {
  if (!ui.fpBtnMode) return;
  ui.fpBtnMode.classList.remove('active-mode', 'mode-loop-one');

  // Mode 0: List Loop (Default)
  if (state.playMode === 0) {
    ui.fpBtnMode.innerHTML = '<i class="fas fa-redo"></i>';
    ui.fpBtnMode.title = '列表循环';
  }
  // Mode 1: Shuffle
  else if (state.playMode === 1) {
    ui.fpBtnMode.classList.add('active-mode');
    ui.fpBtnMode.innerHTML = '<i class="fas fa-random"></i>';
    ui.fpBtnMode.title = '随机播放';
  }
  // Mode 2: Single Loop
  else if (state.playMode === 2) {
    ui.fpBtnMode.classList.add('active-mode', 'mode-loop-one');
    ui.fpBtnMode.innerHTML = '<i class="fas fa-redo"></i>';
    ui.fpBtnMode.title = '单曲循环';
  }
}

function nextTrack() {
  if (state.playQueue.length === 0) return;
  if (state.playMode === 1) {
    let newIndex = Math.floor(Math.random() * state.playQueue.length);
    while (state.playQueue.length > 1 && newIndex === state.currentTrackIndex) newIndex = Math.floor(Math.random() * state.playQueue.length);
    playTrack(newIndex);
  } else {
    let nextIndex = state.currentTrackIndex + 1;
    if (nextIndex >= state.playQueue.length) nextIndex = 0;
    playTrack(nextIndex);
  }
}
function prevTrack() {
  if (state.playQueue.length === 0) return;
  if (ui.audio.currentTime > 3) { ui.audio.currentTime = 0; return; }
  if (state.playMode === 1) playTrack(Math.floor(Math.random() * state.playQueue.length));
  else { let prevIndex = state.currentTrackIndex - 1; if (prevIndex < 0) prevIndex = state.playQueue.length - 1; playTrack(prevIndex); }
}
// 滑动状态
let isDragging = false;

ui.audio.addEventListener('ended', () => {
  // 记录收听统计
  const currentSong = state.playQueue[state.currentTrackIndex];
  if (currentSong && ui.audio.duration > 0) {
    updateListenStats(currentSong, ui.audio.duration);
  }

  // 结束时将最后一句歌词居中显示
  if (state.lyricsData.length && ui.lyricsContainer) {
    const lastIdx = state.lyricsData.length - 1;
    document.querySelectorAll('.lyric-line.active').forEach(l => l.classList.remove('active'));
    const lastLine = ui.lyricsContainer.querySelector(`.lyric-line[data-index="${lastIdx}"]`);
    if (lastLine) {
      lastLine.classList.add('active');
      lastLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  if (state.playMode === 2) {
    ui.audio.currentTime = 0;
    if (ui.lyricsContainer) ui.lyricsContainer.scrollTop = 0; // Reset lyrics
    ui.audio.play();
  } else nextTrack();
});

let lastVolume = 1.0;
function updateVolumeUI(val) {
  if (ui.volumeSlider) { ui.volumeSlider.value = val; updateSliderFill(ui.volumeSlider); }
  updateVolumeIcon(val);
}

function updateVolumeIcon(val) {
  if (ui.volIcon) { ui.volIcon.className = ''; if (val === 0) ui.volIcon.className = 'fas fa-volume-mute'; else if (val < 0.5) ui.volIcon.className = 'fas fa-volume-down'; else ui.volIcon.className = 'fas fa-volume-up'; }
}

function toggleMute() {
  if (ui.audio.volume > 0) { lastVolume = ui.audio.volume; ui.audio.volume = 0; updateVolumeUI(0); } else { ui.audio.volume = lastVolume > 0 ? lastVolume : 0.5; updateVolumeUI(ui.audio.volume); }
  persistState(ui.audio);
}

updateSliderFill(ui.progressBar); updateSliderFill(ui.fpProgressBar); updateSliderFill(ui.volumeSlider);
ui.audio.addEventListener('pause', () => persistState(ui.audio)); // 暂停时保存
ui.audio.addEventListener('timeupdate', () => {
  throttledPersist(); // 定期保存
  if (!ui.audio.duration) return;

  // Process lyrics always
  if (state.lyricsData.length) {
    let idx = state.lyricsData.findIndex(l => l.time > ui.audio.currentTime);
    idx = idx === -1 ? state.lyricsData.length - 1 : idx - 1;
    // Before first lyric, highlight the first line (intro)
    if (idx < 0) idx = 0;

    if (idx >= 0) {
      const currentLine = ui.lyricsContainer?.querySelector(`.lyric-line[data-index="${idx}"]`);
      if (currentLine && !currentLine.classList.contains('active')) {
        document.querySelectorAll('.lyric-line.active').forEach(l => l.classList.remove('active'));
        currentLine.classList.add('active');
        currentLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // Only update sliders if not dragging
  if (!isDragging) {
    const percent = (ui.audio.currentTime / ui.audio.duration) * 100;
    const timeStr = formatTime(ui.audio.currentTime);

    if (ui.progressBar) { ui.progressBar.value = percent; updateSliderFill(ui.progressBar); }
    if (ui.fpProgressBar) { ui.fpProgressBar.value = percent; updateSliderFill(ui.fpProgressBar); }
    ['time-current', 'fp-time-current'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = timeStr; });
  }
});

ui.audio.addEventListener('loadedmetadata', () => {
  const totalStr = formatTime(ui.audio.duration);
  ['time-total', 'fp-time-total'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = totalStr; });
});

// Progress Bar Logic
function onProgressInput(e) {
  isDragging = true;
  const val = e.target.value;
  updateSliderFill(e.target);

  // Sync Visuals
  if (e.target === ui.progressBar && ui.fpProgressBar) { ui.fpProgressBar.value = val; updateSliderFill(ui.fpProgressBar); }
  if (e.target === ui.fpProgressBar && ui.progressBar) { ui.progressBar.value = val; updateSliderFill(ui.progressBar); }

  // Update Time Text Visuals
  if (ui.audio.duration) {
    const time = (val / 100) * ui.audio.duration;
    const timeStr = formatTime(time);
    ['time-current', 'fp-time-current'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = timeStr; });
  }
}

function onProgressChange(e) {
  isDragging = false;
  if (ui.audio.duration) {
    ui.audio.currentTime = (e.target.value / 100) * ui.audio.duration;
  }
  updateSliderFill(e.target);
}

// Bind Events replaces the old simple binding
if (ui.progressBar) {
  ui.progressBar.addEventListener('input', onProgressInput);
  ui.progressBar.addEventListener('change', onProgressChange);
}
if (ui.fpProgressBar) {
  ui.fpProgressBar.addEventListener('input', onProgressInput);
  ui.fpProgressBar.addEventListener('change', onProgressChange);
}

async function checkAndFetchMetadata(track, fetchId) {
  const query = `?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&filename=${encodeURIComponent(track.filename)}`;

  const fetchLyrics = async () => {
    // 即使track.lyrics存在，也要确保它有效
    if (track.lyrics && track.lyrics.trim() !== '') {
      // 重新解析一次，确保歌词能正确显示
      parseAndRenderLyrics(track.lyrics);
      return;
    }
    
    const cacheKey = track.id || track.filename;
    const startTime = performance.now();
    
    try {
      // 第一层：检查 IndexedDB 缓存
      const cachedLyrics = await getLyricsFromCache(cacheKey);
      if (cachedLyrics) {
        console.log('[Cache] 歌词命中 IndexedDB (', Math.round(performance.now() - startTime), 'ms )');
        track.lyrics = cachedLyrics;
        savePlaylist();
        parseAndRenderLyrics(cachedLyrics);
        return;
      }
      
      // 第二层：从 API 获取（带超时控制）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
      
      try {
        const d = await api.library.lyrics(query);
        clearTimeout(timeoutId);
        
        if (fetchId !== state.currentFetchId) return;
        if (d.success && d.lyrics && d.lyrics.trim() !== '') {
          console.log('[API] 歌词加载成功 (', Math.round(performance.now() - startTime), 'ms )');
          track.lyrics = d.lyrics;
          savePlaylist();
          
          // 根据用户设置决定是否保存到 IndexedDB
          if (state.cacheLyrics !== false) {
            try {
              await saveLyricsToCache(cacheKey, d.lyrics);
            } catch (err) {
              console.warn('保存歌词到 IndexedDB 失败:', err);
            }
          } else {
            console.log('[Cache] 歌词缓存已禁用，跳过保存');
          }
          
          parseAndRenderLyrics(d.lyrics);
        } else {
          renderNoLyrics('暂无歌词');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        
        if (err.name === 'AbortError') {
          console.warn('歌词加载超时 (5s)，尝试使用缓存');
          // 超时时尝试使用过期缓存
          const fallbackLyrics = await getLyricsFromCache(cacheKey);
          if (fallbackLyrics) {
            console.log('[Fallback] 使用过期的歌词缓存');
            track.lyrics = fallbackLyrics;
            parseAndRenderLyrics(fallbackLyrics);
            return;
          }
        }
        
        throw err; // 重新抛出异常，交给外层处理
      }
    } catch (e) {
      console.error('歌词加载失败:', e.message);
      
      // 降级方案：使用本地歌词或缓存
      if (track.lyrics && track.lyrics.trim() !== '') {
        parseAndRenderLyrics(track.lyrics);
      } else {
        renderNoLyrics('歌词加载失败，请检查网络');
      }
    }
  };

  const fetchCover = async () => {
    const cacheKey = track.id || track.filename;
    const startTime = performance.now();
    
    console.log('[Fetch] 检查封面 - track.cover:', track.cover?.substring(0, 50));
    
    try {
      // 第一层：如果是默认封面，先检查 IndexedDB 缓存（带超时）
      if (track.cover.includes('ICON_256.PNG')) {
        console.log('[Fetch] 封面未获取，尝试从缓存加载');
        
        // 使用 Promise.race 实现缓存读取超时（2秒）
        let cachedCover = null;
        try {
          cachedCover = await Promise.race([
            getCoverFromCache(cacheKey),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Cache read timeout')), 2000))
          ]);
        } catch (err) {
          if (err.message === 'Cache read timeout') {
            console.warn('[Cache] 缓存读取超时，跳过本地缓存');
          } else {
            console.warn('[Cache] 缓存读取失败:', err.message);
          }
        }
        
        if (cachedCover) {
          console.log('[Cache] 封面命中 IndexedDB (', Math.round(performance.now() - startTime), 'ms )');
          track.cover = cachedCover;
          savePlaylist();
          if (ui.audio.src.includes(encodeURIComponent(track.id))) { ['current-cover', 'fp-cover'].forEach(id => { const el = document.getElementById(id); if (el) el.src = track.cover; }); }
          renderPlaylist();
          return;
        }
        
        // 第二层：离线状态下立即使用默认封面（不等网络）
        if (!navigator.onLine) {
          console.log('[Offline] 离线状态，跳过 API 请求，使用默认封面');
          return;  // 保持默认封面，不再等待网络
        }
        
        // 第三层：在线时才尝试 API 获取（短超时）
        console.log('[Fetch] 开始从 API 获取封面...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒超时（比之前更短）
        
        try {
          const d = await api.library.albumArt(query);
          clearTimeout(timeoutId);
          
          if (fetchId !== state.currentFetchId) return;
          if (d.success && d.album_art) {
            console.log('[API] 封面加载成功 (', Math.round(performance.now() - startTime), 'ms )');
            track.cover = d.album_art;
            savePlaylist(); // 保存封面更新
            
            // 根据用户设置决定是否保存到缓存
            if (state.cacheCovers !== false) {
              try {
                await saveCoverToCache(cacheKey, d.album_art);
                // localStorage 作为备用：只保存 URL，不保存文件
                localStorage.setItem(`2f_cover_url_${cacheKey}`, d.album_art);
                console.log('[Cache] API 获取的封面已缓存到 IndexedDB (文件)，URL 备份到 localStorage');
              } catch (err) {
                console.warn('保存封面到缓存失败:', err);
              }
            } else {
              console.log('[Cache] 封面缓存已禁用，跳过保存');
            }
            
            if (ui.audio.src.includes(encodeURIComponent(track.id))) { ['current-cover', 'fp-cover'].forEach(id => { const el = document.getElementById(id); if (el) el.src = track.cover; }); }
            renderPlaylist();
          }
        } catch (err) {
          clearTimeout(timeoutId);
          
          console.warn('封面 API 请求失败:', err.message);
          
          // 网络错误时自动尝试使用缓存（无论是超时还是连接失败）
          try {
            const fallbackCover = await Promise.race([
              getCoverFromCache(cacheKey),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Cache fallback timeout')), 1000))
            ]);
            if (fallbackCover && track.cover.includes('ICON_256.PNG')) {
              console.log('[Fallback] 自动使用缓存的封面（网络请求失败）');
              track.cover = fallbackCover;
              savePlaylist();
              if (ui.audio.src.includes(encodeURIComponent(track.id))) { ['current-cover', 'fp-cover'].forEach(id => { const el = document.getElementById(id); if (el) el.src = track.cover; }); }
              renderPlaylist();
              return;
            }
          } catch (fallbackErr) {
            console.warn('[Fallback] 缓存降级也失败或超时:', fallbackErr.message);
          }
          
          // 缓存也不存在，继续处理
          throw err;
        }
      } else {
        // 封面 URL 已可用（已从服务器获取或已缓存），检查是否需要使用缓存的文件
        console.log('[Fetch] 封面 URL 已可用，检查是否使用缓存的文件');
        
        try {
          const cachedCover = await getCoverFromCache(cacheKey);
          if (cachedCover) {
            // 找到了缓存的文件，使用 Blob URL 替换原始 URL
            console.log('[Cache] 找到缓存的封面文件，使用本地 Blob URL');
            track.cover = cachedCover;  // 使用 Blob URL
            savePlaylist();
            if (ui.audio.src.includes(encodeURIComponent(track.id))) { 
              ['current-cover', 'fp-cover'].forEach(id => { 
                const el = document.getElementById(id); 
                if (el) el.src = track.cover; 
              }); 
            }
            renderPlaylist();
            return;
          }
          
          // 没有缓存的文件，但如果启用了缓存，则后台保存
          if (state.cacheCovers !== false) {
            try {
              await saveCoverToCache(cacheKey, track.cover);
              localStorage.setItem(`2f_cover_url_${cacheKey}`, track.cover);
              console.log('[Cache] 封面已缓存到 IndexedDB (文件)');
            } catch (err) {
              console.warn('保存封面到缓存失败:', err);
            }
          } else {
            console.log('[Cache] 封面缓存已禁用，不保存');
          }
        } catch (err) {
          console.warn('检查封面缓存失败:', err);
        }
      }
    } catch (e) {
      console.error('封面加载失败:', e.message);
      
      // 降级方案 - 尝试使用 localStorage 中的 URL 备份
      try {
        const lsUrlCache = localStorage.getItem(`2f_cover_url_${cacheKey}`);
        if (lsUrlCache && track.cover.includes('ICON_256.PNG')) {
          console.log('[Fallback] 使用 localStorage 中的封面 URL 备份');
          track.cover = lsUrlCache;
          savePlaylist();
          if (ui.audio.src.includes(encodeURIComponent(track.id))) { ['current-cover', 'fp-cover'].forEach(id => { const el = document.getElementById(id); if (el) el.src = track.cover; }); }
          renderPlaylist();
        }
      } catch (e2) {
        console.warn('读取缓存封面失败:', e2.message);
      }
    }
  };

  await Promise.all([fetchLyrics(), fetchCover()]);
}

function parseAndRenderLyrics(lrc) {
  // --- 双语歌词适配 ---
  state.lyricsData = [];
  if (!lrc || lrc.trim() === '') { renderNoLyrics('暂无歌词'); return; }

  const lines = lrc.split('\n');
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;
  // Map: time(s) -> [text1, text2, ...]（支持同一时间戳多行）
  const timeMap = new Map();

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;

    // 解析网易云 JSON-LRC
    if (line.startsWith('{')) {
      try {
        const json = JSON.parse(line);
        if (typeof json.t === 'number') {
          const time = json.t / 1000;
          let text = '';
          if (Array.isArray(json.c)) {
            text = json.c.map(item => item.tx || '').join('').trim();
          }
          if (text) {
            if (!timeMap.has(time)) timeMap.set(time, []);
            timeMap.get(time).push(text);
          }
          return;
        }
      } catch (e) {}
    }

    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = match[3] ? parseInt(match[3]) : 0;
      const time = min * 60 + sec + (ms / (match[3] && match[3].length === 3 ? 1000 : 100));
      const text = line.replace(timeRegex, '').trim();
      if (text) {
        if (!timeMap.has(time)) timeMap.set(time, []);
        timeMap.get(time).push(text);
      }
    } else {
      // 非时间戳行，作为0s歌词
      const isMetadata = /^\[(id|ar|ti|by|hash|al|sign|qq|total|offset|length|re|ve):.*?\]$/i.test(line);
      if (!line.startsWith('{') && !isMetadata) {
        if (!timeMap.has(0)) timeMap.set(0, []);
        timeMap.get(0).push(line);
      }
    }
  });

  // 转为数组，按时间排序
  state.lyricsData = Array.from(timeMap.entries()).map(([time, lines]) => ({ time, lines })).sort((a, b) => a.time - b.time);

  // 没有歌词时直接显示原文
  if (state.lyricsData.length === 0) {
    if (ui.lyricsContainer) {
      ui.lyricsContainer.classList.remove('no-lyrics');
      ui.lyricsContainer.innerHTML = `<p class="lyric-line active">${lrc.replace(/\n/g, '<br>')}</p>`;
    }
    return;
  }

  // 渲染：每个时间戳一行，支持多行（原文+翻译）
  if (ui.lyricsContainer) {
    ui.lyricsContainer.classList.remove('no-lyrics');
    ui.lyricsContainer.innerHTML = state.lyricsData.map((l, i) =>
      `<p class="lyric-line" data-index="${i}" data-time="${l.time}">
        ${l.lines.map((txt, idx) => `<span class="lyric-${idx === 0 ? 'main' : 'trans'}">${txt}</span>`).join('<br>')}
      </p>`
    ).join('');
    ui.lyricsContainer.querySelectorAll('.lyric-line').forEach(line => {
      line.addEventListener('click', (e) => {
        const time = parseFloat(e.currentTarget.getAttribute('data-time'));
        if (!isNaN(time) && ui.audio.duration) {
          ui.audio.currentTime = time;
          if (state.isPlaying) ui.audio.play();
        }
      });
    });
    // 前奏阶段预先将第一句居中显示
    const firstLine = ui.lyricsContainer.querySelector('.lyric-line[data-index="0"]');
    if (firstLine) {
      document.querySelectorAll('.lyric-line.active').forEach(l => l.classList.remove('active'));
      firstLine.classList.add('active');
      ui.lyricsContainer.scrollTop = 0;
    }
  }
}

async function togglePlay() {
  if (state.playQueue.length === 0) return;

  // 如果正在播放，尝试暂停
  if (state.isPlaying) {
    ui.audio.pause();
    state.isPlaying = false;
    updatePlayState();
    releaseWakeLock();
    return;
  }

  // 如果原本是暂停状态，尝试播放
  try {
    if (!ui.audio.src) {
      await playTrack(0);
    } else {
      await ui.audio.play();
    }
    state.isPlaying = true;
    updatePlayState();
    requestWakeLock();
  } catch (err) {
    console.error('Play failed:', err);
    state.isPlaying = false;
    updatePlayState();
    releaseWakeLock();

    // 针对移动端后台恢复时的特定错误处理
    if (err.name === 'NotAllowedError') {
      showToast('播放被阻止，请手动点击播放');
    } else if (err.name === 'AbortError') {
      // 可能是之前的加载被中断，尝试重新加载当前进度
      const curTime = ui.audio.currentTime;
      ui.audio.load();
      ui.audio.currentTime = curTime;
      // 不自动播放，等待用户再次点击，避免死循环
      showToast('音频加载中断，已重置，请重试');
    } else {
      showToast('无法播放: ' + err.message);
    }
  }
}

function updatePlayState() {
  const icon = state.isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  if (ui.btnPlay) ui.btnPlay.innerHTML = icon;
  if (ui.fpBtnPlay) ui.fpBtnPlay.innerHTML = icon;
  if (ui.mobileMiniPlay) ui.mobileMiniPlay.innerHTML = icon;
}

export function bindPlayerEvents() {
  // 播放状态切换显示“正在播放”或“已暂停”
  const playingLabel = document.getElementById('fp-playing-label');
  const pausedLabel = document.getElementById('fp-paused-label');
  function updatePlayingLabel() {
    if (ui.audio && !ui.audio.paused && !ui.audio.ended) {
      if (playingLabel) playingLabel.style.display = '';
      if (pausedLabel) pausedLabel.style.display = 'none';
    } else {
      if (playingLabel) playingLabel.style.display = 'none';
      if (pausedLabel) pausedLabel.style.display = '';
    }
  }
  if (ui.audio) {
    ui.audio.addEventListener('play', updatePlayingLabel);
    ui.audio.addEventListener('pause', updatePlayingLabel);
    ui.audio.addEventListener('ended', updatePlayingLabel);
    updatePlayingLabel();
  }
  [ui.btnPlay, ui.fpBtnPlay, ui.mobileMiniPlay].forEach(btn => btn?.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); }));
  [ui.btnPrev, ui.fpBtnPrev].forEach(btn => btn?.addEventListener('click', prevTrack));
  [ui.btnNext, ui.fpBtnNext].forEach(btn => btn?.addEventListener('click', nextTrack));
  ui.fpBtnMode?.addEventListener('click', togglePlayMode);

  document.getElementById('open-detail-view')?.addEventListener('click', () => ui.overlay?.classList.add('active'));
  document.getElementById('close-detail-view')?.addEventListener('click', () => ui.overlay?.classList.remove('active'));

  if (ui.fpBtnFav) {
    ui.fpBtnFav.addEventListener('click', () => {
      const s = state.playQueue[state.currentTrackIndex];
      if (s && !s.isExternal) {
        toggleFavorite(s, null);
        updateDetailFavButton(state.favorites.has(s.id));
        if (state.currentTab === 'fav') renderPlaylist();
      }
    });
  }

  ui.searchInput?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.song-card').forEach(card => {
      const index = card.dataset.index;
      const song = state.displayPlaylist[index];
      const match = song.title.toLowerCase().includes(term) || song.artist.toLowerCase().includes(term);
      if (match) card.classList.remove('hidden'); else card.classList.add('hidden');
    });
  });

  if (ui.volumeSlider) {
    ui.volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      ui.audio.volume = val;
      updateSliderFill(ui.volumeSlider);
      updateVolumeIcon(val);
    });
    ui.volumeSlider.addEventListener('change', () => persistState(ui.audio));
  }
  ui.btnMute?.addEventListener('click', toggleMute);
  updatePlayModeUI();
  updateVolumeUI(ui.audio.volume);

  // 增强：MediaSession 控制 (支持锁屏控制/后台控制)
  if ('mediaSession' in navigator) {
    const actionHandlers = [
      ['play', () => { if (!state.isPlaying) togglePlay(); }],
      ['pause', () => { if (state.isPlaying) togglePlay(); }],
      ['previoustrack', prevTrack],
      ['nexttrack', nextTrack],
      ['stop', () => { ui.audio.pause(); state.isPlaying = false; updatePlayState(); }]
    ];
    for (const [action, handler] of actionHandlers) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) { }
    }
  }

  // 增强：音频错误监听
  ui.audio.addEventListener('error', (e) => {
    console.error('Audio Error:', e);
    state.isPlaying = false;
    updatePlayState();
    // 尝试获取错误详情
    const err = ui.audio.error;
    let msg = '未知音频错误';
    if (err) {
      switch (err.code) {
        case MediaError.MEDIA_ERR_ABORTED: msg = '加载被中断'; break;
        case MediaError.MEDIA_ERR_NETWORK: msg = '网络错误'; break;
        case MediaError.MEDIA_ERR_DECODE: msg = '解码错误'; break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = '不支持的音频格式'; break;
      }
    }
    // 只有在用户试图播放时才频繁打扰，或者只记录
    if (state.playQueue.length > 0) {
      showToast('播放出错: ' + msg);
    }
  });

  // 增强：页面可见性恢复检查
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // 检查 audio 是否丢失了状态
      if (ui.audio.error && state.playQueue.length > 0) {
        console.log('Restoring audio state after visibility mismatch...');
        const curTime = ui.audio.currentTime;
        ui.audio.load();
        ui.audio.currentTime = curTime;
        // 不自动 play，以免此时浏览器策略限制自动播放
        updatePlayState();
      }
      // 恢复 Wake Lock (如果应该播放)
      if (state.isPlaying) requestWakeLock();
    } else {
      // 页面不可见时（如手动锁屏），Wake Lock 会自动释放，这里显式调用清理变量
      // 只有 Screen Wake Lock 在页面隐藏时会自动释放，但我们最好保持状态同步
      if (wakeLock) { wakeLock = null; }
    }
  });
}

export function bindUiControls() {
  if (ui.navLocal) ui.navLocal.addEventListener('click', () => switchTab('local'));
  if (ui.navFav) ui.navFav.addEventListener('click', () => switchTab('fav'));
  if (ui.navMount) ui.navMount.addEventListener('click', () => switchTab('mount'));
  if (ui.navNetease) ui.navNetease.addEventListener('click', () => switchTab('netease'));
  // 收藏夹筛选事件监听
  if (ui.playlistFilter) {
    ui.playlistFilter.addEventListener('change', handlePlaylistFilterChange);
  }
  // 添加收藏夹按钮事件
  if (ui.btnAddPlaylist) {
    ui.btnAddPlaylist.addEventListener('click', showCreatePlaylistDialog);
  }

  // 排序功能
  if (ui.btnSort) {
    ui.btnSort.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.sortDropdown?.classList.toggle('active');
    });
  }

  // 队列按钮
  if (ui.btnQueue) {
    ui.btnQueue.addEventListener('click', openQueueModal);
  }

  // 点击外部关闭排序下拉菜单
  document.addEventListener('click', (e) => {
    if (!ui.btnSort?.contains(e.target) && !ui.sortDropdown?.contains(e.target)) {
      ui.sortDropdown?.classList.remove('active');
    }
  });

  // 排序选项点击事件
  document.querySelectorAll('.sort-option').forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      const sortType = option.dataset.sort;
      // 更改排序类型，使用该排序方式的默认顺序
      state.currentSort = sortType;
      state.sortOrder = getDefaultSortOrder(sortType);

      // 保存排序状态到localStorage
      persistState(ui.audio, { currentSort: state.currentSort, sortOrder: state.sortOrder });

      // 更新排序按钮显示
      updateSortButton();

      // 重新渲染歌曲列表
      renderPlaylist();

      // 关闭下拉菜单
      ui.sortDropdown?.classList.remove('active');
    });
  });

  if (ui.fpMenuBtn) ui.fpMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); ui.actionMenuOverlay?.classList.add('active'); });
  ui.actionCancelBtn?.addEventListener('click', () => ui.actionMenuOverlay?.classList.remove('active'));

  if (ui.actionDownloadBtn) {
    ui.actionDownloadBtn.addEventListener('click', () => {
      ui.actionMenuOverlay?.classList.remove('active');
      const currentSong = state.playQueue[state.currentTrackIndex];
      if (currentSong) {
        showToast('开始下载...');
        const a = document.createElement('a');
        a.href = currentSong.src;
        // Construct filename: Artist - Title.ext
        // Note: browser might respect Content-Disposition header over this, but it's good practice.
        // We need extension from src or default to mp3
        let ext = 'mp3';
        if (currentSong.filename) {
          const match = currentSong.filename.match(/\.(\w+)$/);
          if (match) ext = match[1];
        }
        a.download = `${currentSong.artist} - ${currentSong.title}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
  }
  if (ui.actionDeleteBtn) {
    ui.actionDeleteBtn.addEventListener('click', () => {
      ui.actionMenuOverlay?.classList.remove('active');
      const currentSong = state.playQueue[state.currentTrackIndex];
      if (currentSong) {
        showConfirmDialog('危险操作', `确定要永久删除这首歌吗？<br><span style="font-size:0.9rem; opacity:0.7">${currentSong.title}</span>`, () => performDelete(currentSong.id));
      }
    });
  }

  // Rematch Metadata Logic
  const btnRematch = document.getElementById('action-rematch');
  if (btnRematch) {
    btnRematch.addEventListener('click', async () => {
      ui.actionMenuOverlay?.classList.remove('active');
      const currentSong = state.playQueue[state.currentTrackIndex];
      if (!currentSong) return;
      if (currentSong.isExternal) { showToast('外部文件暂不支持匹配'); return; }

      showToast('正在清除旧元数据...', 'loading');
      try {
        const res = await api.library.clearMetadata(currentSong.id);
        hideProgressToast(); // clear loading toast
        if (res.success) {
          showToast('已重置，正在重新搜索...');
          
          // 1. Reset Local Cache (in-memory and storage)
          currentSong.cover = "/static/images/ICON_256.PNG";
          delete currentSong.lyrics;
          
          const cacheKey = currentSong.id || currentSong.filename;
          
          // 清除所有缓存层的数据
          try {
            // 清除 localStorage 中的缓存
            localStorage.removeItem(`2f_cover_${cacheKey}`);
            localStorage.removeItem(`2f_lyrics_${cacheKey}`);
            
            // 清除 IndexedDB 中的缓存
            await deleteCoverFromCache(cacheKey);
            await deleteLyricsFromCache(cacheKey);
          } catch (e) {
            console.warn('清除缓存失败:', e);
          }

          // 2. Reset UI
          ['current-cover', 'fp-cover'].forEach(id => { const el = document.getElementById(id); if (el) el.src = currentSong.cover; });
          if (ui.lyricsContainer) ui.lyricsContainer.innerHTML = '';
          renderNoLyrics('正在重新匹配...');

          // 3. Force Re-fetch
          playTrack(state.currentTrackIndex, false);

        } else {
          showToast('操作失败: ' + (res.data?.error || '未知错误'));
        }
      } catch (err) {
        hideProgressToast();
        showToast('网络请求失败');
        console.error(err);
      }
    });
  }
  ui.confirmNoBtn?.addEventListener('click', () => { ui.confirmModalOverlay?.classList.remove('active'); state.currentConfirmAction = null; });
  ui.confirmYesBtn?.addEventListener('click', () => {
    if (state.currentConfirmAction) {
      state.currentConfirmAction();
      ui.confirmModalOverlay?.classList.remove('active');
      state.currentConfirmAction = null;
    }
  });
  [ui.actionMenuOverlay, ui.confirmModalOverlay].forEach(overlay => {
    overlay?.addEventListener('click', (e) => { if (e.target === overlay) { overlay.classList.remove('active'); state.currentConfirmAction = null; } });
  });

  // 队列项点击事件
  window.addEventListener('queueItemClick', (e) => {
    const index = e.detail.index;
    // 关闭队列模态框
    const queueModalOverlay = document.querySelector('.queue-modal-overlay');
    if (queueModalOverlay) {
      queueModalOverlay.classList.add('closing');
      setTimeout(() => {
        queueModalOverlay.remove();
      }, 300);
    }
    // 播放选中的歌曲
    playTrack(index);
  });

  // Real-time Favorite Sync
  window.addEventListener('storage', (e) => {
    if (e.key === '2fmusic_favs' && e.newValue) {
      try {
        const newFavs = JSON.parse(e.newValue);
        state.favorites = new Set(newFavs);

        // 1. Update Detail Button
        if (state.playQueue[state.currentTrackIndex]) {
          const currentTrack = state.playQueue[state.currentTrackIndex];
          updateDetailFavButton(state.favorites.has(currentTrack.id || currentTrack.filename));
        }

        // 2. Update Playlist UI if visible
        // If current tab is Fav, re-render
        if (state.currentTab === 'fav') {
          renderPlaylist();
        } else {
          // Update individual buttons in list without full re-render
          const visibleBtns = document.querySelectorAll('.card-fav-btn');
          visibleBtns.forEach(btn => {
            const card = btn.closest('.song-card');
            const index = card ? parseInt(card.dataset.index) : -1;
            // Note: dataset.index maps to state.displayPlaylist
            if (index >= 0 && state.displayPlaylist[index]) {
              const song = state.displayPlaylist[index];
              if (state.favorites.has(song.id || song.filename)) {
                btn.classList.add('active');
                btn.innerHTML = '<i class="fas fa-heart"></i>';
              } else {
                btn.classList.remove('active');
                btn.innerHTML = '<i class="far fa-heart"></i>';
              }
            }
          });
        }
      } catch (err) { console.error("Sync favs error", err); }
    }
  });

  // Action Menu
  if (ui.menuBtn) {
    const toggleMenu = (e) => { e.stopPropagation(); ui.sidebar?.classList.toggle('open'); };
    ui.menuBtn.addEventListener('click', toggleMenu);
    if (ui.mobileTitle) ui.mobileTitle.addEventListener('click', toggleMenu);

    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && ui.sidebar?.classList.contains('open')) {
        const outsideSidebar = !ui.sidebar.contains(e.target);
        const outsideBtn = !ui.menuBtn.contains(e.target);
        const outsideTitle = !ui.mobileTitle || !ui.mobileTitle.contains(e.target);

        if (outsideSidebar && outsideBtn && outsideTitle) ui.sidebar.classList.remove('open');
      }
    });
  }

  // 封面自适应背景色
  const fpCover = document.getElementById('fp-cover');
  if (fpCover) {
    // 允许跨域图片提取颜色
    fpCover.crossOrigin = "Anonymous";

    const updateBg = () => {
      // 简单判断是否是默认图
      if (fpCover.src.indexOf('ICON_256.PNG') !== -1) {
        if (ui.fullPlayerOverlay) ui.fullPlayerOverlay.style.background = 'rgba(0, 0, 0, 0.85)';
      } else {
        const color = extractColorFromImage(fpCover);
        if (color) {
          // 移动端防止背景太透导致看到下面的列表 (透视问题)
          const isMobile = window.innerWidth <= 768;
          const alpha = isMobile ? 0.98 : 0.8;
          const rgbaStr = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;

          // 1. 设置全屏背景渐变
          ui.fullPlayerOverlay.style.background = `linear-gradient(to bottom, ${rgbaStr} 0%, #000 120%)`;

          // 2. 设置动态菜单背景色 (使用提取的 RGB + 0.7 透明度)
          // 这样 Action Menu 就有了跟随封面的半透明背景
          document.documentElement.style.setProperty('--dynamic-glass-color', `rgba(${color.r}, ${color.g}, ${color.b}, 0.7)`);
        }
      }
    };

    fpCover.addEventListener('load', updateBg);
    // 关键修正：如果图片已经加载完成（比如来自缓存），手动触发一次
    if (fpCover.complete && fpCover.naturalWidth > 0) {
      updateBg();
    }
  }
}

export async function initPlayer() {
  bindUiControls();
  bindPlayerEvents();
  // 立即恢复 Tab 状态，避免刷新时闪烁到默认页面
  switchTab(state.currentTab);
  await loadSongs();
  await handleExternalFile();

  // 恢复播放位置和音量 (延迟执行以确保DOM已完全加载)
  setTimeout(() => {
    try {
      const savedState = JSON.parse(localStorage.getItem('2fmusic_state') || '{}');
      
      // 恢复音量
      if (savedState.volume !== undefined && ui.audio) {
        ui.audio.volume = Math.max(0, Math.min(1, savedState.volume));
        if (ui.volumeSlider) ui.volumeSlider.value = ui.audio.volume * 100;
        updateVolumeUI(ui.audio.volume);
      }
      
      // 恢复播放位置 (只在有保存的播放位置时恢复)
      if (savedState.currentTime && savedState.currentTime > 0 && savedState.currentFilename) {
        // 检查当前歌曲是否匹配
        const currentSong = state.playQueue[state.currentTrackIndex];
        if (currentSong && currentSong.filename === savedState.currentFilename) {
          // 延迟设置currentTime，确保音频已加载元数据
          const seekTimer = setInterval(() => {
            if (ui.audio?.duration > 0) {
              clearInterval(seekTimer);
              ui.audio.currentTime = Math.min(savedState.currentTime, ui.audio.duration);
              console.log(`[Player] 恢复播放位置: ${formatTime(savedState.currentTime)}/${formatTime(ui.audio.duration)}`);
            }
          }, 100);
          
          // 30秒超时安全机制
          setTimeout(() => clearInterval(seekTimer), 30000);
        }
      }
    } catch (e) {
      console.warn('Failed to restore playback state:', e);
    }
  }, 500);
}