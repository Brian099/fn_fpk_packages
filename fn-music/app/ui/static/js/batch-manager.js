// 批量管理器 - 处理批量选择和批量操作（右键菜单版本）
import { state } from './state.js';
import { api } from './api.js';
import { showToast, showConfirmDialog } from './utils.js';
import { loadPlaylistFilter } from './favorites.js';
import { loadSongs, renderPlaylistSongs } from './player.js';

export class BatchManager {
  constructor() {
    this.selectedIds = new Set();
    this.isOperating = false;
    this.contextMenuCard = null; // 右键菜单触发的卡片
    this.init();
  }

  init() {
    // 初始化事件监听
    this.setupEventListeners();
    this.setupContextMenuListeners();
  }

  setupEventListeners() {
    // 歌曲卡片的复选框
    document.addEventListener('change', (e) => {
      if (e.target.classList.contains('song-checkbox')) {
        e.stopPropagation();
        this.handleCheckboxChange(e.target);
      }
    });

    // 复选框点击时停止冒泡
    document.addEventListener('click', (e) => {
      if (e.target.closest('.song-checkbox')) {
        e.stopPropagation();
      }
    });

    // 关闭菜单：点击其他地方（但不能在处理菜单项时关闭）
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('batch-context-menu');
      const isClickInMenu = e.target.closest('.batch-context-menu');
      const isClickOnCard = e.target.closest('.song-card');
      
      if (!isClickInMenu && !isClickOnCard && menu && !menu.classList.contains('hidden')) {
        this.hideContextMenu();
      }
    }, true); // 使用捕获阶段，确保早期触发
  }

  setupContextMenuListeners() {
    // 歌曲卡片右键菜单
    document.addEventListener('contextmenu', (e) => {
      const songCard = e.target.closest('.song-card');
      if (songCard) {
        e.preventDefault();
        this.showContextMenu(e, songCard);
      }
    });

    // 右键菜单项点击 - 使用事件委托处理所有菜单项
    const menu = document.getElementById('batch-context-menu');
    if (menu) {
      menu.addEventListener('click', (e) => {
        e.stopPropagation(); // 防止事件冒泡到其他点击处理器
        
        const item = e.target.closest('.context-menu-item');
        if (!item) return;
        
        if (item.id === 'batch-context-select-one') {
          this.handleContextSelectOne();
        } else if (item.id === 'batch-context-select-all') {
          this.handleContextSelectAll();
        } else if (item.id === 'batch-context-add') {
          this.handleContextAdd();
        } else if (item.id === 'batch-context-remove') {
          this.handleContextRemove();
        } else if (item.id === 'batch-context-move') {
          this.handleContextMove();
        } else if (item.id === 'batch-context-clear') {
          this.handleContextClear();
        }
      });
    }
  }

  showContextMenu(event, songCard) {
    this.contextMenuCard = songCard;
    const menu = document.getElementById('batch-context-menu');
    if (!menu) return;

    // 隐藏菜单后重新显示，实现动画
    menu.classList.add('hidden');
    requestAnimationFrame(() => {
      // 根据是否有选择调整菜单项的显示
      const hasSelections = this.selectedIds.size > 0;
      const inFavorites = state.currentTab === 'fav'; // 是否在收藏夹内部
      const selectOneBtn = document.getElementById('batch-context-select-one');
      const addBtn = document.getElementById('batch-context-add');
      const removeBtn = document.getElementById('batch-context-remove');
      const moveBtn = document.getElementById('batch-context-move');

      // 更新"单选"按钮文字
      if (selectOneBtn) {
        const countText = hasSelections ? `（已选${this.selectedIds.size}项）` : '';
        selectOneBtn.innerHTML = `<i class="fas fa-square"></i> 单选${countText}`;
      }

      // 在收藏夹内部或没有选择时隐藏"添加到收藏夹"按钮
      // 仅在本地音乐页面且有选择时显示"添加到收藏夹"按钮
      if (addBtn) {
        addBtn.style.display = (!inFavorites && hasSelections) ? 'flex' : 'none';
      }

      // 有选择时显示"移除"和"移动"按钮
      // 但仅在收藏夹页面显示这两个按钮
      if (removeBtn) {
        removeBtn.style.display = (hasSelections && inFavorites && state.selectedPlaylistId) ? 'flex' : 'none';
      }
      if (moveBtn) {
        moveBtn.style.display = (hasSelections && inFavorites && state.selectedPlaylistId) ? 'flex' : 'none';
      }
      
      // 定位菜单
      menu.style.left = event.clientX + 'px';
      menu.style.top = event.clientY + 'px';
      menu.classList.remove('hidden');
    });
  }

  hideContextMenu() {
    const menu = document.getElementById('batch-context-menu');
    if (menu) {
      menu.classList.add('hidden');
    }
    this.contextMenuCard = null;
  }

  // 动态显示复选框（当有选择时）
  showCheckboxes() {
    document.querySelectorAll('.song-card').forEach(card => {
      let checkbox = card.querySelector('.song-checkbox');
      if (!checkbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'song-checkbox';
        checkbox.setAttribute('aria-label', '选择歌曲');
        card.insertBefore(checkbox, card.firstChild);
      }
      checkbox.style.setProperty('display', 'inline-block', 'important');
    });
  }

  // 动态隐藏复选框（当无选择时）
  hideCheckboxes() {
    document.querySelectorAll('.song-checkbox').forEach(checkbox => {
      checkbox.style.setProperty('display', 'none', 'important');
    });
  }

  async handleContextSelectOne() {
    if (!this.contextMenuCard) {
      return;
    }

    // 清空之前的选择
    this.clearSelection();

    // 为当前卡片创建复选框（如果不存在）
    let checkbox = this.contextMenuCard.querySelector('.song-checkbox');
    if (!checkbox) {
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'song-checkbox';
      checkbox.setAttribute('aria-label', '选择歌曲');
      this.contextMenuCard.insertBefore(checkbox, this.contextMenuCard.firstChild);
    }

    // 选中这个卡片
    checkbox.checked = true;
    checkbox.style.display = 'inline-block';

    const songIndex = parseInt(this.contextMenuCard.dataset.index);
    // 从 state.displayPlaylist 获取歌曲，而不是从 localStorage
    const song = state.displayPlaylist[songIndex];

    if (song) {
      this.selectedIds.add(song.id);
      this.contextMenuCard.classList.add('selected');
    }

    // 显示所有复选框
    this.showCheckboxes();
    this.saveBatchState();
    this.hideContextMenu();
  }

  async handleContextAdd() {
    if (this.selectedIds.size === 0 && this.contextMenuCard) {
      // 如果没选择，就选择当前卡片
      // 动态添加复选框到卡片
      let checkbox = this.contextMenuCard.querySelector('.song-checkbox');
      if (!checkbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'song-checkbox';
        checkbox.setAttribute('aria-label', '选择歌曲');
        this.contextMenuCard.insertBefore(checkbox, this.contextMenuCard.firstChild);
      }
      checkbox.checked = true;
      checkbox.style.display = 'inline-block';
      this.handleCheckboxChange(checkbox);
      // 显示所有复选框
      this.showCheckboxes();
    }

    if (this.selectedIds.size === 0) {
      showToast('请先选择歌曲');
      return;
    }

    // 显示收藏夹选择对话框
    const selectedPlaylists = new Set();
    const dialog = document.createElement('div');
    dialog.className = 'playlist-select-dialog';
    
    dialog.innerHTML = `
      <div class="dialog-content">
        <div class="dialog-header">
          <h3>添加到收藏夹</h3>
          <button id="close-batch-dialog" class="close-btn">&times;</button>
        </div>
        <div class="playlists-container" id="batch-playlists-container"></div>
        <div class="dialog-actions">
          <button id="batch-confirm-add" class="btn-primary">确定</button>
        </div>
      </div>
    `;

    const playlists = state.cachedPlaylists || [];
    const dialogContent = dialog.querySelector('.playlists-container');
    
    playlists.forEach(playlist => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.innerHTML = `
        <input type="checkbox" class="batch-playlist-checkbox" value="${playlist.id}" id="batch-pl-${playlist.id}">
        <label for="batch-pl-${playlist.id}">${playlist.name}</label>
      `;
      item.querySelector('.batch-playlist-checkbox').addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedPlaylists.add(e.target.value);
        } else {
          selectedPlaylists.delete(e.target.value);
        }
      });
      dialogContent.appendChild(item);
    });

    document.body.appendChild(dialog);

    const confirmBtn = dialog.querySelector('#batch-confirm-add');
    const closeBtn = dialog.querySelector('#close-batch-dialog');

    const handleConfirm = async () => {
      if (selectedPlaylists.size === 0) {
        showToast('请选择至少一个收藏夹');
        return;
      }
      
      const playlistIds = Array.from(selectedPlaylists);
      await this.batchAddToPlaylist(playlistIds);
      dialog.remove();
      this.hideContextMenu();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    closeBtn.addEventListener('click', () => {
      dialog.remove();
      this.hideContextMenu();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
        this.hideContextMenu();
      }
    });
  }

  async handleContextRemove() {
    if (this.selectedIds.size === 0) {
      showToast('请先选择歌曲');
      return;
    }

    // 立即隐藏菜单，避免遮挡确认对话框
    this.hideContextMenu();

    const currentPlaylistId = state.selectedPlaylistId || 'default';
    showConfirmDialog(
      '确认移除',
      `确定要从收藏夹中移除 ${this.selectedIds.size} 首歌曲吗？`,
      async () => {
        await this.batchRemoveFromPlaylist([currentPlaylistId]);
      }
    );
  }

  async handleContextMove() {
    if (this.selectedIds.size === 0) {
      showToast('请先选择歌曲');
      return;
    }

    const currentPlaylistId = state.selectedPlaylistId || 'default';
    const dialog = document.createElement('div');
    dialog.className = 'playlist-select-dialog';
    let toPlaylistId = null;
    
    dialog.innerHTML = `
      <div class="dialog-content">
        <div class="dialog-header">
          <h3>移动到收藏夹</h3>
          <button id="close-move-dialog" class="close-btn">&times;</button>
        </div>
        <div class="playlists-container" id="move-playlists-container"></div>
        <div class="dialog-actions">
          <button id="move-confirm" class="btn-primary">确定</button>
        </div>
      </div>
    `;

    const playlists = state.cachedPlaylists || [];
    const container = document.createElement('div');
    
    playlists.forEach(playlist => {
      if (playlist.id === currentPlaylistId) return;
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.innerHTML = `
        <input type="radio" name="move-playlist" value="${playlist.id}" id="move-pl-${playlist.id}">
        <label for="move-pl-${playlist.id}">${playlist.name}</label>
      `;
      item.querySelector('input').addEventListener('change', (e) => {
        toPlaylistId = e.target.value;
      });
      container.appendChild(item);
    });

    const dialogContent = dialog.querySelector('.playlists-container');
    dialogContent.innerHTML = '';
    dialogContent.appendChild(container);
    document.body.appendChild(dialog);

    const confirmBtn = dialog.querySelector('#move-confirm');
    const closeBtn = dialog.querySelector('#close-move-dialog');

    const handleConfirm = async () => {
      if (!toPlaylistId) {
        showToast('请选择目标收藏夹');
        return;
      }
      
      await this.batchMoveToPlaylist(currentPlaylistId, toPlaylistId);
      dialog.remove();
      this.hideContextMenu();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    closeBtn.addEventListener('click', () => {
      dialog.remove();
      this.hideContextMenu();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
        this.hideContextMenu();
      }
    });
  }

  async handleContextSelectAll() {
    this.selectAll();
    this.hideContextMenu();
  }

  async handleContextClear() {
    this.clearSelection();
    this.hideContextMenu();
  }

  handleCheckboxChange(checkbox) {
    const songCard = checkbox.closest('.song-card');
    if (!songCard) return;

    const songIndex = parseInt(songCard.dataset.index);
    // 从 state.displayPlaylist 获取歌曲，而不是从 localStorage
    const song = state.displayPlaylist[songIndex];

    if (checkbox.checked) {
      this.selectedIds.add(song.id);
      songCard.classList.add('selected');
      // 显示所有复选框
      this.showCheckboxes();
    } else {
      this.selectedIds.delete(song.id);
      songCard.classList.remove('selected');
      // 如果没有选择了，隐藏所有复选框
      if (this.selectedIds.size === 0) {
        this.hideCheckboxes();
      }
    }

    this.saveBatchState();
  }


  selectAll() {
    // 先确保所有卡片都有复选框
    this.showCheckboxes();
    
    const allCheckboxes = document.querySelectorAll('.song-checkbox');

    if (this.selectedIds.size === state.displayPlaylist.length) {
      // 全部已选，取消全选
      allCheckboxes.forEach(checkbox => checkbox.checked = false);
      this.selectedIds.clear();
      this.hideCheckboxes();
    } else {
      // 全选
      allCheckboxes.forEach((checkbox, index) => {
        checkbox.checked = true;
        const card = checkbox.closest('.song-card');
        if (card) {
          const idx = parseInt(card.dataset.index);
          // 从 state.displayPlaylist 获取歌曲，而不是从 localStorage
          const song = state.displayPlaylist[idx];
          if (song) {
            this.selectedIds.add(song.id);
            card.classList.add('selected');
          }
        }
      });
    }

    this.saveBatchState();
  }

  async batchAddToPlaylist(playlistIds) {
    if (this.selectedIds.size === 0 || this.isOperating) return;

    this.isOperating = true;
    try {
      const songIds = Array.from(this.selectedIds);
      
      // 收集歌曲信息
      const songs = {};
      songIds.forEach(songId => {
        const song = state.displayPlaylist.find(s => s.id === songId);
        if (song) {
          songs[songId] = {
            title: song.title || '',
            artist: song.artist || ''
          };
        }
      });
      
      const result = await api.favorites.batchAdd(songIds, playlistIds, songs);

      if (result.success) {
        showToast(`成功添加 ${result.data.successful} 首歌曲到收藏夹`);
        
        // 更新本地缓存
        for (const playlistId of playlistIds) {
          const currentSongs = state.cachedPlaylistSongs[playlistId] || [];
          for (const songId of songIds) {
            if (!currentSongs.includes(songId)) {
              currentSongs.push(songId);
            }
          }
          state.cachedPlaylistSongs[playlistId] = currentSongs;
        }

        // 更新收藏夹歌曲计数
        const playlists = state.cachedPlaylists.map(p => {
          if (playlistIds.includes(p.id)) {
            return { ...p, song_count: (p.song_count || 0) + songIds.length };
          }
          return p;
        });
        state.cachedPlaylists = playlists;
        localStorage.setItem('2fmusic_cached_playlists', JSON.stringify(playlists));
        
        // 刷新收藏夹列表
        await loadPlaylistFilter();
      } else {
        showToast(`添加失败: ${result.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('批量添加失败:', e);
      showToast('批量添加出错，请重试');
    } finally {
      this.isOperating = false;
    }
  }

  async batchRemoveFromPlaylist(playlistIds) {
    if (this.selectedIds.size === 0 || this.isOperating) return;

    this.isOperating = true;
    try {
      const songIds = Array.from(this.selectedIds);
      const result = await api.favorites.batchRemove(songIds, playlistIds);

      if (result.success) {
        showToast(`成功移除 ${result.data.successful} 首歌曲`);
        
        // 更新本地缓存
        for (const playlistId of playlistIds) {
          const currentSongs = state.cachedPlaylistSongs[playlistId] || [];
          state.cachedPlaylistSongs[playlistId] = currentSongs.filter(id => !songIds.includes(id));
        }

        // 更新收藏夹歌曲计数
        const playlists = state.cachedPlaylists.map(p => {
          if (playlistIds.includes(p.id)) {
            return { ...p, song_count: Math.max(0, (p.song_count || 0) - songIds.length) };
          }
          return p;
        });
        state.cachedPlaylists = playlists;
        localStorage.setItem('2fmusic_cached_playlists', JSON.stringify(playlists));

        // 刷新收藏夹列表
        await loadPlaylistFilter();

        // 如果在收藏夹详情页，刷新当前收藏夹的歌曲列表
        if (state.currentTab === 'fav' && state.selectedPlaylistId) {
          const playlistId = state.selectedPlaylistId;
          const cachedSongs = state.cachedPlaylistSongs[playlistId] || [];
          const playlist = JSON.parse(localStorage.getItem('2fmusic_playlist') || '[]');
          const filteredSongs = cachedSongs.map(songId => {
            return playlist.find(s => s.id === songId);
          }).filter(Boolean);
          renderPlaylistSongs(filteredSongs);
        } else if (state.currentTab === 'fav') {
          // 如果在收藏夹列表页，刷新整个列表
          await loadSongs(false, false);
        }

        // 清空选择并更新UI
        this.clearSelection();
      } else {
        showToast(`移除失败: ${result.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('批量移除失败:', e);
      showToast('批量移除出错，请重试');
    } finally {
      this.isOperating = false;
    }
  }

  async batchMoveToPlaylist(fromPlaylistId, toPlaylistId) {
    if (this.selectedIds.size === 0 || this.isOperating) return;

    this.isOperating = true;
    try {
      const songIds = Array.from(this.selectedIds);
      const result = await api.favorites.batchMove(songIds, fromPlaylistId, toPlaylistId);

      if (result.success) {
        showToast(`成功移动 ${result.data.successful} 首歌曲`);
        
        // 更新本地缓存
        const fromSongs = state.cachedPlaylistSongs[fromPlaylistId] || [];
        const toSongs = state.cachedPlaylistSongs[toPlaylistId] || [];

        state.cachedPlaylistSongs[fromPlaylistId] = fromSongs.filter(id => !songIds.includes(id));
        state.cachedPlaylistSongs[toPlaylistId] = [...new Set([...toSongs, ...songIds])];

        // 更新收藏夹歌曲计数
        const playlists = state.cachedPlaylists.map(p => {
          if (p.id === fromPlaylistId) {
            return { ...p, song_count: Math.max(0, (p.song_count || 0) - songIds.length) };
          }
          if (p.id === toPlaylistId) {
            return { ...p, song_count: (p.song_count || 0) + songIds.length };
          }
          return p;
        });
        state.cachedPlaylists = playlists;
        localStorage.setItem('2fmusic_cached_playlists', JSON.stringify(playlists));

        // 刷新收藏夹列表
        await loadPlaylistFilter();

        // 如果在收藏夹详情页，刷新当前收藏夹的歌曲列表
        if (state.currentTab === 'fav' && state.selectedPlaylistId) {
          const playlistId = state.selectedPlaylistId;
          const cachedSongs = state.cachedPlaylistSongs[playlistId] || [];
          const playlist = JSON.parse(localStorage.getItem('2fmusic_playlist') || '[]');
          const filteredSongs = cachedSongs.map(songId => {
            return playlist.find(s => s.id === songId);
          }).filter(Boolean);
          renderPlaylistSongs(filteredSongs);
        } else if (state.currentTab === 'fav') {
          // 如果在收藏夹列表页，刷新整个列表
          await loadSongs(false, false);
        }

        // 清空选择并更新UI
        this.clearSelection();
      } else {
        showToast(`移动失败: ${result.error || '未知错误'}`);
      }
    } catch (e) {
      console.error('批量移动失败:', e);
      showToast('批量移动出错，请重试');
    } finally {
      this.isOperating = false;
    }
  }

  clearSelection() {
    this.selectedIds.clear();
    document.querySelectorAll('.song-card').forEach(card => {
      card.classList.remove('selected');
      const checkbox = card.querySelector('.song-checkbox');
      if (checkbox) checkbox.checked = false;
    });
    // 隐藏复选框
    this.hideCheckboxes();
    this.saveBatchState();
  }

  saveBatchState() {
    const state = JSON.parse(localStorage.getItem('2fmusic_state') || '{}');
    state.batchSelected = Array.from(this.selectedIds);
    localStorage.setItem('2fmusic_state', JSON.stringify(state));
  }

  restoreBatchState() {
    const stateData = JSON.parse(localStorage.getItem('2fmusic_state') || '{}');
    if (stateData.batchSelected && Array.isArray(stateData.batchSelected) && stateData.batchSelected.length > 0) {
      this.selectedIds = new Set(stateData.batchSelected);
      
      // 显示复选框
      this.showCheckboxes();
      
      // 恢复UI选择状态
      const playlist = JSON.parse(localStorage.getItem('2fmusic_playlist') || '[]');
      document.querySelectorAll('.song-card').forEach((card, index) => {
        const idx = parseInt(card.dataset.index);
        const song = playlist[idx];
        let checkbox = card.querySelector('.song-checkbox');
        
        // 确保复选框存在
        if (!checkbox) {
          checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'song-checkbox';
          checkbox.setAttribute('aria-label', '选择歌曲');
          card.insertBefore(checkbox, card.firstChild);
        }
        
        if (song && this.selectedIds.has(song.id)) {
          checkbox.checked = true;
          card.classList.add('selected');
        }
      });
    }
  }

  getSelectedSongIds() {
    return Array.from(this.selectedIds);
  }

  getSelectedCount() {
    return this.selectedIds.size;
  }

  // 重置批量管理器状态（在页面切换时调用）
  resetBatchState() {
    // 隐藏右键菜单
    this.hideContextMenu();
    
    // 清空所有复选框选择
    this.clearSelection();
    
    // 重置操作标志
    this.isOperating = false;
  }
}

// 导出单例
export const batchManager = new BatchManager();
