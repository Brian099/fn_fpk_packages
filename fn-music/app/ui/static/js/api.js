// 后端 API 封装 + 离线支持
import { state } from './state.js';

// 离线检测和本地缓存管理（使用 IndexedDB 和 localStorage 双层缓存）
const offlineManager = {
  // 检测网络状态
  isOnline: navigator.onLine,
  
  // 注册网络状态变化监听
  init() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('[Offline] 网络已恢复');
      this.notifyOnlineStatus(true);
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('[Offline] 已进入离线模式，使用本地缓存');
      this.notifyOnlineStatus(false);
    });
  },
  
  // 通知应用网络状态变化
  notifyOnlineStatus(isOnline) {
    const event = new CustomEvent('networkStatusChanged', { detail: { isOnline } });
    window.dispatchEvent(event);
  },
  
  // 打开 IndexedDB 连接（缓存用）
  async openAPICache() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('2FMusicAPICache', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('responses')) {
          const store = db.createObjectStore('responses', { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  },
  
  // 保存 API 响应到 IndexedDB（localStorage 仅作为应急备份）
  async cacheResponse(key, data, ttl = 86400000) {
    try {
      const cacheData = {
        key,
        data,
        timestamp: Date.now(),
        ttl
      };
      
      // 保存到 IndexedDB（主存储）- 必须等待完成
      try {
        const db = await this.openAPICache();
        const tx = db.transaction(['responses'], 'readwrite');
        const store = tx.objectStore('responses');
        
        // 等待 put 操作完成
        await new Promise((resolve, reject) => {
          const request = store.put(cacheData);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
        });
        
        db.close();
        console.log(`[Cache] API 响应已缓存到 IndexedDB: ${key}`);
      } catch (err) {
        // IndexedDB 失败时，降级到 localStorage 作为备份
        try {
          const backup = {
            key,
            data,
            timestamp: Date.now(),
            ttl
          };
          localStorage.setItem(`2f_api_cache_${key}`, JSON.stringify(backup));
          console.log(`[Cache] IndexedDB 失败，已降级到 localStorage 备份: ${key}`);
        } catch (e2) {
          console.warn('[Cache] localStorage 备份也失败:', e2.message);
        }
      }
    } catch (e) {
      console.warn('[Cache] 缓存 API 响应失败:', e);
    }
  },
  
  // 从 IndexedDB 读取 API 缓存（localStorage 作为备份）
  async getCachedResponse(key) {
    try {
      // 先尝试从 IndexedDB 读取
      try {
        const db = await this.openAPICache();
        const tx = db.transaction(['responses'], 'readonly');
        const store = tx.objectStore('responses');
        
        const result = await new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => {
            const item = request.result;
            if (item) {
              console.log(`[Cache] IndexedDB 找到数据: ${key}, 时间戳: ${new Date(item.timestamp).toLocaleString()}, TTL: ${item.ttl}ms, 当前时间差: ${Date.now() - item.timestamp}ms`);
              // 检查是否过期
              if (Date.now() - item.timestamp <= item.ttl) {
                console.log(`[Cache] 数据有效，从 IndexedDB 返回: ${key}`);
                resolve(item.data);
              } else {
                // 过期，删除并返回 null
                console.warn(`[Cache] IndexedDB 数据已过期: ${key}`);
                const deleteReq = store.delete(key);
                deleteReq.onsuccess = () => resolve(null);
                deleteReq.onerror = () => resolve(null);
              }
            } else {
              console.warn(`[Cache] IndexedDB 中未找到: ${key}`);
              resolve(null);
            }
          };
          request.onerror = () => {
            console.error(`[Cache] IndexedDB 查询错误: ${key}`, request.error);
            reject(request.error);
          };
        });
        
        db.close();
        
        // 如果 IndexedDB 找到有效数据，直接返回
        if (result) {
          console.log(`[Cache] 成功从 IndexedDB 返回数据: ${key}`);
          return result;
        }
        console.log(`[Cache] IndexedDB 无有效数据，尝试 localStorage 备份: ${key}`);
      } catch (err) {
        console.warn(`[Cache] IndexedDB 操作失败: ${key}`, err.message);
      }
      
      // IndexedDB 失败或无数据，降级到 localStorage 备份
      try {
        const backup = localStorage.getItem(`2f_api_cache_${key}`);
        if (backup) {
          const parsed = JSON.parse(backup);
          console.log(`[Cache] localStorage 备份中找到数据: ${key}`);
          // 检查备份是否过期
          if (Date.now() - parsed.timestamp <= parsed.ttl) {
            console.log(`[Cache] 从 localStorage 备份返回数据: ${key}`);
            return parsed.data;
          } else {
            // 备份也过期了，删除
            console.warn(`[Cache] localStorage 备份已过期: ${key}`);
            localStorage.removeItem(`2f_api_cache_${key}`);
          }
        } else {
          console.warn(`[Cache] localStorage 中未找到备份: ${key}`);
        }
      } catch (err) {
        console.warn(`[Cache] localStorage 备份操作失败: ${key}`, err.message);
      }
      
      console.error(`[Cache] 无法读取任何缓存数据: ${key}`);
      return null;
    } catch (e) {
      console.error(`[Cache] getCachedResponse 异常: ${key}`, e);
      return null;
    }
  },
  
  // 从 fullPlaylist 获取本地歌单（应急降级）
  getLocalPlaylist() {
    try {
      const playlist = localStorage.getItem('2fmusic_playlist');
      if (playlist) {
        return JSON.parse(playlist);
      }
      return null;
    } catch (e) {
      console.warn('读取本地歌单失败:', e);
      return null;
    }
  }
};

// 初始化离线管理器
offlineManager.init();

const jsonOrThrow = async (resp) => {
  const data = await resp.json();
  return data;
};

export const api = {
  library: {
    async list() {
      // 尝试从网络获取
      try {
        console.log('[API] 正在获取音乐列表...');
        const res = await fetch('/api/music');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await jsonOrThrow(res);
        console.log('[API] 音乐列表获取成功，项数:', data.data?.length || 0);
        
        // 成功获取，保存到缓存
        if (data.success) {
          await offlineManager.cacheResponse('music_list', data, 86400000); // 24小时
          console.log('[Cache] 音乐列表已缓存');
        }
        
        return data;
      } catch (error) {
        console.warn('[API] 获取音乐列表失败:', error.message);
        console.log('[API] 尝试从缓存恢复...');
        
        // 网络请求失败，自动降级到本地缓存（无论网络状态如何）
        const cached = await offlineManager.getCachedResponse('music_list');
        if (cached) {
          console.log('[Offline] 成功从缓存返回音乐列表，项数:', cached.data?.length || 0);
          return { ...cached, offline: true, fromCache: true };
        }
        
        console.error('[Offline] 缓存中也没有音乐列表数据');
        // 缓存也不存在，返回错误
        if (!offlineManager.isOnline) {
          return {
            success: false,
            message: '离线且无缓存数据',
            data: [],
            offline: true
          };
        }
        
        throw error;
      }
    },
    async deleteFile(filename) {
      const encodedName = encodeURIComponent(filename);
      const res = await fetch(`/api/music/delete/${encodedName}`, { method: 'DELETE' });
      return jsonOrThrow(res);
    },
    async importPath(path) {
      const res = await fetch('/api/music/import_path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      return jsonOrThrow(res);
    },
    async externalMeta(path) {
      const res = await fetch(`/api/music/external/meta?path=${encodeURIComponent(path)}`);
      return jsonOrThrow(res);
    },
    async clearMetadata(id) {
      const res = await fetch(`/api/music/clear_metadata/${id}`, { method: 'POST' });
      return jsonOrThrow(res);
    },
    async lyrics(query) {
      // 尝试从网络获取
      try {
        const res = await fetch(`/api/music/lyrics${query}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await jsonOrThrow(res);
        
        // 成功获取，根据用户设置决定是否保存到缓存
        if (data.success && data.lyrics && state.cacheLyrics !== false) {
          await offlineManager.cacheResponse(`lyrics_${query}`, data, 2592000000); // 30天
          console.log('[API] 歌词已缓存 (cacheLyrics=', state.cacheLyrics, ')');
        } else if (data.success && data.lyrics) {
          console.log('[API] 歌词未缓存 - 用户已禁用歌词缓存 (cacheLyrics=', state.cacheLyrics, ')');
        }
        
        return data;
      } catch (error) {
        console.warn('[API] 获取歌词失败:', error.message);
        
        // 离线模式下尝试使用缓存
        if (!offlineManager.isOnline) {
          const cached = await offlineManager.getCachedResponse(`lyrics_${query}`);
          if (cached) {
            console.log('[Offline] 使用缓存的歌词');
            return { ...cached, offline: true, fromCache: true };
          }
          
          return {
            success: false,
            message: '离线且无歌词缓存',
            offline: true
          };
        }
        
        throw error;
      }
    },
    async albumArt(query) {
      console.log('[API] 发起专辑封面请求:', query);
      // 尝试从网络获取
      try {
        const res = await fetch(`/api/music/album-art${query}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await jsonOrThrow(res);
        
        // 成功获取，根据用户设置决定是否保存到缓存
        if (data.success && data.album_art && state.cacheCovers !== false) {
          await offlineManager.cacheResponse(`album_art_${query}`, data, 2592000000); // 30天
          console.log('[API] 封面已缓存 (cacheCovers=', state.cacheCovers, ')');
        } else if (data.success && data.album_art) {
          console.log('[API] 封面未缓存 - 用户已禁用封面缓存 (cacheCovers=', state.cacheCovers, ')');
        }
        
        return data;
      } catch (error) {
        console.warn('[API] 获取专辑封面失败:', error.message);
        
        // 离线模式下尝试使用缓存
        if (!offlineManager.isOnline) {
          const cached = await offlineManager.getCachedResponse(`album_art_${query}`);
          if (cached) {
            console.log('[Offline] 使用缓存的专辑封面');
            return { ...cached, offline: true, fromCache: true };
          }
          
          return {
            success: false,
            message: '离线且无专辑封面缓存',
            offline: true
          };
        }
        
        throw error;
      }
    }
  },
  system: {
    async status() {
      const res = await fetch('/api/system/status');
      return jsonOrThrow(res);
    },
    async versionCheck(forceRefresh = true) {
      const res = await fetch(`/api/version_check?force_refresh=${forceRefresh}`);
      return jsonOrThrow(res);
    }
  },
  mount: {
    async list() {
      const res = await fetch('/api/mount_points');
      return jsonOrThrow(res);
    },
    async add(path) {
      const res = await fetch('/api/mount_points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      return jsonOrThrow(res);
    },
    async remove(path) {
      const res = await fetch('/api/mount_points', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      return jsonOrThrow(res);
    },
    async retryScrape(path) {
      const res = await fetch('/api/mount_points/retry_scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      return jsonOrThrow(res);
    },
    async update(path) {
      const res = await fetch('/api/mount_points/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      });
      return jsonOrThrow(res);
    }
  },
  netease: {
    async search(keywords) {
      const res = await fetch(`/api/netease/search?keywords=${encodeURIComponent(keywords)}`);
      return jsonOrThrow(res);
    },
    async resolve(input) {
      const res = await fetch(`/api/netease/resolve?input=${encodeURIComponent(input)}`);
      return jsonOrThrow(res);
    },
    async download(body) {
      const res = await fetch('/api/netease/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return jsonOrThrow(res);
    },
    async configGet() {
      const res = await fetch('/api/netease/config');
      return jsonOrThrow(res);
    },
    async configSave(payload) {
      const res = await fetch('/api/netease/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return jsonOrThrow(res);
    },
    async loginStatus() {
      const res = await fetch('/api/netease/login/status');
      return jsonOrThrow(res);
    },
    async loginQr() {
      const res = await fetch('/api/netease/login/qrcode');
      return jsonOrThrow(res);
    },
    async loginCheck(key) {
      const res = await fetch(`/api/netease/login/check?key=${encodeURIComponent(key)}`);
      return jsonOrThrow(res);
    },
    async logout() {
      const res = await fetch('/api/netease/logout', { method: 'POST' });
      return jsonOrThrow(res);
    },
    async playlist(id) {
      const res = await fetch(`/api/netease/playlist?id=${encodeURIComponent(id)}`);
      return jsonOrThrow(res);
    },
    async song(id) {
      const res = await fetch(`/api/netease/song?id=${encodeURIComponent(id)}`);
      return jsonOrThrow(res);
    },
    async task(taskId) {
      const res = await fetch(`/api/netease/task/${encodeURIComponent(taskId)}`);
      return jsonOrThrow(res);
    },
    async installService() {
      const res = await fetch('/api/netease/install_service', { method: 'POST' });
      return jsonOrThrow(res);
    },
    async getInstallStatus() {
      const res = await fetch('/api/netease/install/status');
      return jsonOrThrow(res);
    },
    async recommend() {
      const res = await fetch('/api/netease/recommend');
      return jsonOrThrow(res);
    }
  },
  favorites: {
    async list() {
      // 尝试从网络获取
      try {
        console.log('[API] 正在获取收藏列表...');
        const res = await fetch('/api/favorites');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await jsonOrThrow(res);
        console.log('[API] 收藏列表获取成功，项数:', data.data?.length || 0);
        
        // 成功获取，保存到缓存
        if (data.success) {
          await offlineManager.cacheResponse('favorites', data, 86400000); // 24小时
          console.log('[Cache] 收藏列表已缓存');
        }
        
        return data;
      } catch (error) {
        console.warn('[API] 获取收藏列表失败:', error.message);
        console.log('[API] 尝试从缓存恢复...');
        
        // 网络请求失败，自动降级到本地缓存（无论网络状态如何）
        const cached = await offlineManager.getCachedResponse('favorites');
        if (cached) {
          console.log('[Offline] 成功从缓存返回收藏列表，项数:', cached.data?.length || 0);
          return { ...cached, offline: true, fromCache: true };
        }
        
        console.error('[Offline] 缓存中也没有收藏列表数据');
        if (!offlineManager.isOnline) {
          return {
            success: false,
            message: '离线且无收藏缓存',
            data: [],
            offline: true
          };
        }
        
        throw error;
      }
    },
    async add(song_id, playlist_id = 'default') {
      const res = await fetch(`/api/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id, playlist_id })
      });
      return jsonOrThrow(res);
    },
    async remove(song_id, playlist_id = 'default') {
      const res = await fetch(`/api/favorites`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id, playlist_id })
      });
      return jsonOrThrow(res);
    },
    // 批量操作 API
    async batchAdd(song_ids, playlist_ids, songs = {}) {
      const res = await fetch('/api/favorites/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_ids, playlist_ids, songs })
      });
      return jsonOrThrow(res);
    },
    async batchRemove(song_ids, playlist_ids) {
      const res = await fetch('/api/favorites/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_ids, playlist_ids })
      });
      return jsonOrThrow(res);
    },
    async batchMove(song_ids, from_playlist_id, to_playlist_id) {
      const res = await fetch('/api/favorites/batch/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_ids, from_playlist_id, to_playlist_id })
      });
      return jsonOrThrow(res);
    }
  },
  favoritePlaylists: {
    async list() {
      // 尝试从网络获取
      try {
        console.log('[API] 正在获取收藏夹列表...');
        const res = await fetch('/api/favorite_playlists');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await jsonOrThrow(res);
        console.log('[API] 收藏夹列表获取成功，项数:', data.data?.length || 0);
        
        // 成功获取，保存到缓存
        if (data.success) {
          await offlineManager.cacheResponse('favorite_playlists', data, 86400000); // 24小时
          console.log('[Cache] 收藏夹列表已缓存');
        }
        
        return data;
      } catch (error) {
        console.warn('[API] 获取收藏夹列表失败:', error.message);
        console.log('[API] 尝试从缓存恢复...');
        
        // 网络请求失败，自动降级到本地缓存（无论网络状态如何）
        const cached = await offlineManager.getCachedResponse('favorite_playlists');
        if (cached) {
          console.log('[Offline] 成功从缓存返回收藏夹列表，项数:', cached.data?.length || 0);
          return { ...cached, offline: true, fromCache: true };
        }
        
        console.error('[Offline] 缓存中也没有收藏夹列表数据');
        if (!offlineManager.isOnline) {
          return {
            success: false,
            message: '离线且无收藏夹缓存',
            data: [],
            offline: true
          };
        }
        
        throw error;
      }
    },
    async getSongs(playlist_id) {
      // 尝试从网络获取
      try {
        console.log(`[API] 正在获取收藏夹歌曲: ${playlist_id}`);
        const res = await fetch(`/api/favorite_playlists/${encodeURIComponent(playlist_id)}/songs`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await jsonOrThrow(res);
        console.log(`[API] 收藏夹歌曲获取成功: ${playlist_id}, 项数:`, data.data?.length || 0);
        
        // 成功获取，保存到缓存
        if (data.success) {
          await offlineManager.cacheResponse(`playlist_songs_${playlist_id}`, data, 86400000); // 24小时
          console.log(`[Cache] 收藏夹歌曲已缓存: ${playlist_id}`);
        }
        
        return data;
      } catch (error) {
        console.warn(`[API] 获取收藏夹歌曲失败: ${playlist_id}`, error.message);
        console.log(`[API] 尝试从缓存恢复: ${playlist_id}`);
        
        // 网络请求失败，自动降级到本地缓存（无论网络状态如何）
        const cached = await offlineManager.getCachedResponse(`playlist_songs_${playlist_id}`);
        if (cached) {
          console.log(`[Offline] 成功从缓存返回收藏夹歌曲: ${playlist_id}, 项数:`, cached.data?.length || 0);
          return { ...cached, offline: true, fromCache: true };
        }
        
        console.error(`[Offline] 缓存中也没有收藏夹歌曲数据: ${playlist_id}`);
        if (!offlineManager.isOnline) {
          return {
            success: false,
            message: '离线且无歌单缓存',
            data: [],
            offline: true
          };
        }
        
        throw error;
      }
    },
    async create(name) {
      const res = await fetch('/api/favorite_playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      return jsonOrThrow(res);
    },
    async delete(playlist_id) {
      const res = await fetch(`/api/favorite_playlists/${encodeURIComponent(playlist_id)}`, { method: 'DELETE' });
      return jsonOrThrow(res);
    }
  }
};

// 导出离线管理器供其他模块使用
export { offlineManager };