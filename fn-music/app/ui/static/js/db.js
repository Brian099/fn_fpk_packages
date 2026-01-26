// IndexedDB 数据库管理
// 用于存储超过localStorage限制的大型数据集（播放历史、收听统计等）

const DB_NAME = '2FMusicDB';
const DB_VERSION = 2; // 版本升级支持

// 对象存储定义
const STORES = {
  playHistory: { keyPath: 'id', indexes: [{ name: 'filename', unique: false }, { name: 'playedAt', unique: false }] },
  listenStats: { keyPath: 'filename', indexes: [{ name: 'playCount', unique: false }, { name: 'lastListenTime', unique: false }] },
  syncLog: { keyPath: 'id', indexes: [{ name: 'timestamp', unique: false }] },
  coverCache: { keyPath: 'id', indexes: [{ name: 'filename', unique: true }, { name: 'cachedAt', unique: false }] },
  lyricsCache: { keyPath: 'id', indexes: [{ name: 'filename', unique: true }, { name: 'cachedAt', unique: false }] },
  playlistCache: { keyPath: 'id', indexes: [{ name: 'type', unique: false }, { name: 'cachedAt', unique: false }] }
};

let db = null;

// 版本迁移函数
const VERSION_MIGRATIONS = {
  1: null, // 版本1: 初始版本
  2: async (db) => {
    // 版本2升级: 添加数据统计和元数据支持
    console.log('[IndexedDB] 执行版本1->2升级');
    // 为未来的扩展预留
    // 可在此添加新字段、索引或存储的初始化
  }
};

// 初始化数据库 - 带版本冲突恢复
export async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      const error = request.error;
      
      // 处理版本冲突：如果请求的版本低于现有版本，需要删除重建
      if (error.name === 'VersionError') {
        console.warn('[IndexedDB] 检测到版本冲突，尝试自动恢复...');
        
        // 删除旧数据库并重新初始化
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => {
          console.log('[IndexedDB] 已清理版本冲突的数据库，重新初始化中...');
          // 递归调用以重新初始化
          initIndexedDB().then(resolve).catch(reject);
        };
        deleteRequest.onerror = () => {
          console.error('[IndexedDB] 版本冲突恢复失败，无法删除旧数据库', deleteRequest.error);
          reject(error);
        };
      } else {
        console.error('IndexedDB 打开失败', error);
        reject(error);
      }
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[IndexedDB] 初始化成功，数据库版本:', db.version);
      resolve(db);
    };

    request.onupgradeneeded = async (e) => {
      const database = e.target.result;
      const oldVersion = e.oldVersion || 0;
      const newVersion = e.newVersion;
      
      console.log(`[IndexedDB] 数据库升级: v${oldVersion} -> v${newVersion}`);
      
      // 创建对象存储和索引（第一次使用）
      Object.entries(STORES).forEach(([storeName, config]) => {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { 
            keyPath: config.keyPath, 
            autoIncrement: storeName !== 'listenStats' 
          });
          
          // 添加索引
          config.indexes.forEach(index => {
            try {
              store.createIndex(index.name, index.name, { unique: index.unique });
            } catch (err) {
              console.warn(`索引创建失败 ${storeName}.${index.name}:`, err);
            }
          });
        }
      });
      
      // 执行版本迁移（如果需要）
      if (oldVersion < newVersion) {
        for (let v = oldVersion + 1; v <= newVersion; v++) {
          if (VERSION_MIGRATIONS[v]) {
            try {
              await VERSION_MIGRATIONS[v](database);
            } catch (err) {
              console.error(`版本${v}升级失败:`, err);
            }
          }
        }
      }
      
      console.log('[IndexedDB] 数据库升级完成');
    };
  });
}

// 检查 localStorage 空间使用情况
export function checkLocalStorageSize() {
  let totalSize = 0;
  for (const key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      totalSize += localStorage[key].length + key.length;
    }
  }
  
  const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
  const threshold = 5; // 5MB阈值
  
  return {
    sizeInBytes: totalSize,
    sizeInMB: parseFloat(sizeInMB),
    isNearLimit: totalSize > threshold * 1024 * 1024,
    needsMigration: totalSize > threshold * 1024 * 1024
  };
}

// 迁移播放历史到 IndexedDB
export async function migratePlayHistoryToIndexedDB() {
  if (!db) await initIndexedDB();
  
  try {
    const playHistory = localStorage.getItem('2fmusic_play_history');
    if (!playHistory) return { migrated: 0, message: '无播放历史需要迁移' };

    const data = JSON.parse(playHistory);
    const transaction = db.transaction(['playHistory'], 'readwrite');
    const store = transaction.objectStore('playHistory');
    
    let count = 0;
    data.forEach(item => {
      item.id = `${item.filename}_${item.playedAt}`;
      store.put(item);
      count++;
    });

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 迁移了 ${count} 条播放历史`);
        // 迁移完成后可选删除localStorage中的数据以释放空间
        // localStorage.removeItem('2fmusic_play_history');
        resolve({ migrated: count, message: `已迁移 ${count} 条播放历史到 IndexedDB` });
      };
      
      transaction.onerror = () => {
        console.error('[IndexedDB] 播放历史迁移失败:', transaction.error);
        reject(transaction.error);
      };
    });
  } catch (e) {
    console.error('[IndexedDB] 播放历史迁移出错:', e);
    throw e;
  }
}

// 迁移收听统计到 IndexedDB
export async function migrateListenStatsToIndexedDB() {
  if (!db) await initIndexedDB();
  
  try {
    const listenStats = localStorage.getItem('2fmusic_listen_stats');
    if (!listenStats) return { migrated: 0, message: '无收听统计需要迁移' };

    const statsObj = JSON.parse(listenStats);
    const transaction = db.transaction(['listenStats'], 'readwrite');
    const store = transaction.objectStore('listenStats');
    
    let count = 0;
    Object.values(statsObj).forEach(item => {
      store.put(item);
      count++;
    });

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 迁移了 ${count} 条收听统计`);
        // localStorage.removeItem('2fmusic_listen_stats');
        resolve({ migrated: count, message: `已迁移 ${count} 条收听统计到 IndexedDB` });
      };
      
      transaction.onerror = () => {
        console.error('[IndexedDB] 收听统计迁移失败:', transaction.error);
        reject(transaction.error);
      };
    });
  } catch (e) {
    console.error('[IndexedDB] 收听统计迁移出错:', e);
    throw e;
  }
}

// 从 IndexedDB 读取播放历史
export async function getPlayHistoryFromDB(limit = 100) {
  if (!db) await initIndexedDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['playHistory'], 'readonly');
    const store = transaction.objectStore('playHistory');
    const request = store.getAll();

    request.onsuccess = () => {
      const data = request.result;
      // 按 playedAt 降序排序，返回最新的 N 条
      const sorted = data.sort((a, b) => 
        new Date(b.playedAt) - new Date(a.playedAt)
      ).slice(0, limit);
      
      resolve(sorted);
    };

    request.onerror = () => reject(request.error);
  });
}

// 从 IndexedDB 读取收听统计
export async function getListenStatsFromDB() {
  if (!db) await initIndexedDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['listenStats'], 'readonly');
    const store = transaction.objectStore('listenStats');
    const request = store.getAll();

    request.onsuccess = () => {
      const data = request.result;
      const statsObj = {};
      data.forEach(item => {
        statsObj[item.filename] = item;
      });
      resolve(statsObj);
    };

    request.onerror = () => reject(request.error);
  });
}

// 自动检查并迁移（在初始化时调用）
export async function checkAndMigrateData() {
  try {
    const spaceStatus = checkLocalStorageSize();
    
    if (spaceStatus.needsMigration) {
      console.warn('[IndexedDB] 检测到 localStorage 接近限制，准备迁移...');
      
      const results = [];
      
      // 先初始化 IndexedDB
      await initIndexedDB();
      
      // 迁移播放历史
      const historyResult = await migratePlayHistoryToIndexedDB();
      results.push(historyResult);
      
      // 迁移收听统计
      const statsResult = await migrateListenStatsToIndexedDB();
      results.push(statsResult);
      
      // 迁移封面缓存
      const coverResult = await migrateCoverCacheToIndexedDB();
      results.push(coverResult);
      
      // 迁移歌单缓存
      const playlistResult = await migratePlaylistCacheToIndexedDB();
      results.push(playlistResult);
      
      console.log('[IndexedDB] 数据迁移完成:', results);
      return {
        success: true,
        spaceBefore: spaceStatus.sizeInMB,
        migrations: results
      };
    } else {
      console.log(`[IndexedDB] localStorage 使用 ${spaceStatus.sizeInMB}MB，无需迁移`);
      
      // 即使不迁移，也后台执行封面和歌单缓存的迁移
      try {
        await initIndexedDB();
        const coverResult = await migrateCoverCacheToIndexedDB();
        const playlistResult = await migratePlaylistCacheToIndexedDB();
        
        if (coverResult.migratedCount > 0 || playlistResult.migratedCount > 0) {
          console.log('[IndexedDB] 后台迁移完成', { coverResult, playlistResult });
        }
      } catch (e) {
        console.warn('[IndexedDB] 后台迁移失败:', e);
      }
      
      return {
        success: true,
        spaceBefore: spaceStatus.sizeInMB,
        message: '无需迁移'
      };
    }
  } catch (e) {
    console.error('[IndexedDB] 数据迁移检查失败:', e);
    return {
      success: false,
      error: e.message
    };
  }
}

// 清理 IndexedDB 中过期的数据
export async function cleanupOldData(daysOld = 90) {
  if (!db) await initIndexedDB();
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const transaction = db.transaction(['playHistory'], 'readwrite');
    const store = transaction.objectStore('playHistory');
    const index = store.index('playedAt');
    const range = IDBKeyRange.upperBound(cutoffDate.toISOString());
    
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 清理了 ${deletedCount} 条超过 ${daysOld} 天的历史记录`);
        resolve(deletedCount);
      };
      
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 数据清理失败:', e);
    throw e;
  }
}

// 导出数据备份
export async function exportDBAsJSON() {
  if (!db) await initIndexedDB();
  
  try {
    const backups = {};
    
    for (const storeName of Object.keys(STORES)) {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      backups[storeName] = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    
    return {
      backup: backups,
      exportTime: new Date().toISOString(),
      version: DB_VERSION
    };
  } catch (e) {
    console.error('[IndexedDB] 导出失败:', e);
    throw e;
  }
}

// 保存封面缓存到 IndexedDB (优先) + localStorage (备份)
export async function saveCoverToCache(filename, coverUrl) {
  if (!db) await initIndexedDB();
  if (!coverUrl) return;
  
  // 立即保存 localStorage 备份 (快速降级)
  try {
    localStorage.setItem('2f_cover_url_' + filename, coverUrl);
    localStorage.setItem('2f_cover_time_' + filename, new Date().toISOString());
  } catch (e) {
    console.warn('[Cache] 保存 localStorage 备份失败:', e.message);
  }
  
  // 异步下载并保存到 IndexedDB
  try {
    const response = await fetch(coverUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const blob = await response.blob();
    
    // 转换 Blob 为 Data URL（在保存时进行，只需一次）
    let dataUrl = null;
    try {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('[Cache] Data URL 转换失败:', e.message);
    }
    
    const transaction = db.transaction(['coverCache'], 'readwrite');
    const store = transaction.objectStore('coverCache');
    
    const cacheItem = {
      id: filename,
      filename: filename,
      blob: blob,  // 存储实际的 Blob 对象
      dataUrl: dataUrl,  // 存储预生成的 Data URL（快速读取）
      url: coverUrl,  // 记录原始 URL 用于参考
      cachedAt: new Date().toISOString()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(cacheItem);
      
      request.onsuccess = () => {
        console.log('[Cache] 封面文件已缓存到 IndexedDB:', filename, '(' + blob.size + ' bytes, dataUrl: ' + (dataUrl ? 'yes' : 'no') + ')');
        resolve();
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('[Cache] 保存到 IndexedDB 失败，已保留 localStorage 备份:', e.message);
  }
}

// 从 IndexedDB 读取封面缓存
export async function getCoverFromCache(filename) {
  if (!db) await initIndexedDB();
  
  try {
    const transaction = db.transaction(['coverCache'], 'readonly');
    const store = transaction.objectStore('coverCache');
    
    return new Promise((resolve, reject) => {
      const request = store.get(filename);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          // 优先使用预生成的 Data URL（无需转换，快速返回）
          if (result.dataUrl) {
            console.log('[IndexedDB] 封面缓存命中（Data URL）:', filename);
            resolve(result.dataUrl);
          } 
          // 降级：如果有 Blob，则实时转换
          else if (result.blob) {
            console.log('[IndexedDB] 封面缓存命中（Blob），正在转换...');
            const reader = new FileReader();
            reader.onload = () => {
              console.log('[IndexedDB] Blob 转换为 Data URL 成功');
              resolve(reader.result);
            };
            reader.onerror = () => {
              console.warn('[IndexedDB] Blob 转换失败，降级到原始 URL');
              resolve(result.url || null);
            };
            reader.readAsDataURL(result.blob);
          }
          // 最后降级：使用原始 URL
          else if (result.url) {
            console.log('[IndexedDB] 只有原始 URL，使用网络链接');
            resolve(result.url);
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 读取封面缓存失败:', e);
    return null;
  }
}

// 删除特定的封面缓存
export async function deleteCoverFromCache(filename) {
  if (!db) await initIndexedDB();
  
  try {
    const transaction = db.transaction(['coverCache'], 'readwrite');
    const store = transaction.objectStore('coverCache');
    
    return new Promise((resolve, reject) => {
      const request = store.delete(filename);
      
      request.onsuccess = () => {
        console.log('[IndexedDB] 已删除封面缓存:', filename);
        resolve();
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 删除封面缓存失败:', e);
    throw e;
  }
}

// 迁移 localStorage 中的封面缓存到 IndexedDB（网络失败时保留备份）
export async function migrateCoverCacheToIndexedDB() {
  if (!db) await initIndexedDB();
  
  try {
    let migratedCount = 0;
    let failedCount = 0;
    const keysToDelete = [];
    
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key) && key.startsWith('2f_cover_url_')) {
        const coverUrl = localStorage.getItem(key);
        const filename = key.replace(/^2f_cover_url_/, '');
        
        try {
          // 尝试从网络下载并保存到 IndexedDB
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          
          const response = await fetch(coverUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const blob = await response.blob();
            const transaction = db.transaction(['coverCache'], 'readwrite');
            const store = transaction.objectStore('coverCache');
            
            const cacheItem = {
              id: filename,
              filename: filename,
              blob: blob,
              url: coverUrl,
              cachedAt: new Date().toISOString()
            };
            
            await new Promise((resolve, reject) => {
              const request = store.put(cacheItem);
              request.onsuccess = resolve;
              request.onerror = () => reject(request.error);
            });
            
            console.log('[Cache] 迁移封面到 IndexedDB 成功:', filename);
            keysToDelete.push(key);
            migratedCount++;
          } else {
            throw new Error(`HTTP ${response.status}`);
          }
        } catch (e) {
          // 网络失败或超时，保留 localStorage 备份供离线使用
          console.warn(`[Cache] 迁移失败，保留 localStorage 备份: ${filename} (${e.message})`);
          failedCount++;
        }
      }
    }
    
    // 只删除已成功迁移的项
    keysToDelete.forEach(key => {
      try {
        localStorage.removeItem(key);
        const timeKey = key.replace('2f_cover_url_', '2f_cover_time_');
        localStorage.removeItem(timeKey);
      } catch (e) {
        console.warn('[Cache] 删除 localStorage 键失败:', key);
      }
    });
    
    console.log(`[Cache] 封面迁移完成: 成功 ${migratedCount} 条, 失败保留备份 ${failedCount} 条`);
    return { migratedCount, failedCount };
  } catch (e) {
    console.error('[Cache] 封面迁移过程出错:', e);
    return { migratedCount: 0, failedCount: 0 };
  }
}

// 清理过期的封面缓存（超过指定天数）
export async function cleanupOldCovers(daysOld = 30) {
  if (!db) await initIndexedDB();
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const transaction = db.transaction(['coverCache'], 'readwrite');
    const store = transaction.objectStore('coverCache');
    const index = store.index('cachedAt');
    const range = IDBKeyRange.upperBound(cutoffDate.toISOString());
    
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 清理了 ${deletedCount} 条超过 ${daysOld} 天的封面缓存`);
        resolve(deletedCount);
      };
      
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 清理过期封面失败:', e);
    throw e;
  }
}

// 保存歌单缓存到 IndexedDB
export async function savePlaylistCache(cacheType, data) {
  if (!db) await initIndexedDB();
  
  try {
    const transaction = db.transaction(['playlistCache'], 'readwrite');
    const store = transaction.objectStore('playlistCache');
    
    let id, dataToStore;
    
    if (cacheType === 'fullPlaylist') {
      id = 'fullPlaylist';
      dataToStore = {
        id,
        type: 'fullPlaylist',
        data: data,
        cachedAt: new Date().toISOString()
      };
    } else if (cacheType === 'playlists') {
      id = 'cachedPlaylists';
      dataToStore = {
        id,
        type: 'playlists',
        data: data,
        cachedAt: new Date().toISOString()
      };
    } else if (cacheType === 'playlistSongs') {
      // data should be { playlistId, songs }
      id = `playlistSongs_${data.playlistId}`;
      dataToStore = {
        id,
        type: 'playlistSongs',
        playlistId: data.playlistId,
        data: data.songs,
        cachedAt: new Date().toISOString()
      };
    }
    
    return new Promise((resolve, reject) => {
      const request = store.put(dataToStore);
      
      request.onsuccess = () => {
        console.log(`[IndexedDB] 歌单缓存已保存: ${cacheType}`);
        resolve();
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 保存歌单缓存失败:', e);
    throw e;
  }
}

// 从 IndexedDB 读取歌单缓存
export async function getPlaylistCache(cacheType) {
  if (!db) await initIndexedDB();
  
  try {
    const transaction = db.transaction(['playlistCache'], 'readonly');
    const store = transaction.objectStore('playlistCache');
    
    let id;
    if (cacheType === 'fullPlaylist') id = 'fullPlaylist';
    else if (cacheType === 'playlists') id = 'cachedPlaylists';
    else return null;
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`[IndexedDB] 歌单缓存命中: ${cacheType}`);
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 读取歌单缓存失败:', e);
    return null;
  }
}

// 读取特定收藏夹的歌曲缓存
export async function getPlaylistSongsCache(playlistId) {
  if (!db) await initIndexedDB();
  
  try {
    const transaction = db.transaction(['playlistCache'], 'readonly');
    const store = transaction.objectStore('playlistCache');
    const id = `playlistSongs_${playlistId}`;
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`[IndexedDB] 收藏夹歌曲缓存命中: ${playlistId}`);
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 读取收藏夹歌曲缓存失败:', e);
    return null;
  }
}

// 迁移歌单缓存到 IndexedDB
export async function migratePlaylistCacheToIndexedDB() {
  if (!db) await initIndexedDB();
  
  try {
    let migratedCount = 0;
    const keysToDelete = [];
    
    // 迁移 fullPlaylist
    if (localStorage.getItem('2fmusic_playlist')) {
      const data = JSON.parse(localStorage.getItem('2fmusic_playlist'));
      await savePlaylistCache('fullPlaylist', data);
      keysToDelete.push('2fmusic_playlist');
      migratedCount++;
    }
    
    // 迁移 cachedPlaylists
    if (localStorage.getItem('2fmusic_cached_playlists')) {
      const data = JSON.parse(localStorage.getItem('2fmusic_cached_playlists'));
      await savePlaylistCache('playlists', data);
      keysToDelete.push('2fmusic_cached_playlists');
      keysToDelete.push('2fmusic_cached_playlists_time'); // 移除时间戳键
      migratedCount++;
    }
    
    // 迁移 cachedPlaylistSongs（可能较大）
    if (localStorage.getItem('2fmusic_cached_playlist_songs')) {
      const songsCacheObj = JSON.parse(localStorage.getItem('2fmusic_cached_playlist_songs'));
      for (const [playlistId, songs] of Object.entries(songsCacheObj)) {
        await savePlaylistCache('playlistSongs', { playlistId, songs });
      }
      keysToDelete.push('2fmusic_cached_playlist_songs');
      migratedCount++;
    }
    
    // 清理 localStorage
    keysToDelete.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn(`删除 localStorage 键失败 ${key}:`, e);
      }
    });
    
    console.log(`[IndexedDB] 迁移了 ${migratedCount} 类歌单缓存`);
    return { migratedCount, message: `已迁移 ${migratedCount} 类歌单缓存到 IndexedDB` };
  } catch (e) {
    console.error('[IndexedDB] 歌单缓存迁移失败:', e);
    throw e;
  }
}

// 清理过期的歌单缓存（超过指定天数）
export async function cleanupOldPlaylistCache(daysOld = 7) {
  if (!db) await initIndexedDB();
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const transaction = db.transaction(['playlistCache'], 'readwrite');
    const store = transaction.objectStore('playlistCache');
    const index = store.index('cachedAt');
    const range = IDBKeyRange.upperBound(cutoffDate.toISOString());
    
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 清理了 ${deletedCount} 条超过 ${daysOld} 天的歌单缓存`);
        resolve(deletedCount);
      };
      
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 清理过期歌单缓存失败:', e);
    throw e;
  }
}

// 执行所有定期清理任务（在应用启动或定期时调用）
export async function performAllCleanup() {
  try {
    console.log('[IndexedDB] 开始执行定期清理任务...');
    
    const results = {
      oldData: await cleanupOldData(90).catch(e => { console.warn('[清理] 清理过期播放历史失败:', e); return 0; }),
      oldCovers: await cleanupOldCovers(30).catch(e => { console.warn('[清理] 清理过期封面失败:', e); return 0; }),
      oldLyrics: await cleanupOldLyrics(30).catch(e => { console.warn('[清理] 清理过期歌词失败:', e); return 0; }),
      oldPlaylistCache: await cleanupOldPlaylistCache(7).catch(e => { console.warn('[清理] 清理过期歌单缓存失败:', e); return 0; })
    };
    
    const totalCleaned = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(`[IndexedDB] 定期清理完成，共清理 ${totalCleaned} 条过期数据`);
    
    return {
      success: true,
      cleaned: totalCleaned,
      details: results
    };
  } catch (e) {
    console.error('[IndexedDB] 执行清理任务失败:', e);
    return {
      success: false,
      error: e.message
    };
  }
}

// ============ 歌词缓存管理 ============

// 保存歌词到 IndexedDB
export async function saveLyricsToCache(filename, lyrics) {
  if (!db) await initIndexedDB();
  if (!lyrics || lyrics.trim() === '') return; // 不缓存空歌词
  
  try {
    const transaction = db.transaction(['lyricsCache'], 'readwrite');
    const store = transaction.objectStore('lyricsCache');
    
    const cacheItem = {
      id: filename,
      filename: filename,
      lyrics: lyrics,
      cachedAt: new Date().toISOString()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(cacheItem);
      
      request.onsuccess = () => {
        console.log('[IndexedDB] 歌词已缓存:', filename);
        resolve();
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 保存歌词失败:', e);
  }
}

// 从 IndexedDB 读取歌词缓存
export async function getLyricsFromCache(filename) {
  if (!db) await initIndexedDB();
  
  try {
    const transaction = db.transaction(['lyricsCache'], 'readonly');
    const store = transaction.objectStore('lyricsCache');
    
    return new Promise((resolve, reject) => {
      const request = store.get(filename);
      
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.lyrics) {
          console.log('[IndexedDB] 歌词缓存命中:', filename);
          resolve(result.lyrics);
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 读取歌词缓存失败:', e);
    return null;
  }
}

// 删除特定的歌词缓存
export async function deleteLyricsFromCache(filename) {
  if (!db) await initIndexedDB();
  
  try {
    const transaction = db.transaction(['lyricsCache'], 'readwrite');
    const store = transaction.objectStore('lyricsCache');
    
    return new Promise((resolve, reject) => {
      const request = store.delete(filename);
      
      request.onsuccess = () => {
        console.log('[IndexedDB] 已删除歌词缓存:', filename);
        resolve();
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 删除歌词缓存失败:', e);
  }
}

// 清理过期的歌词缓存
export async function cleanupOldLyrics(daysOld = 30) {
  if (!db) await initIndexedDB();
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const transaction = db.transaction(['lyricsCache'], 'readwrite');
    const store = transaction.objectStore('lyricsCache');
    const index = store.index('cachedAt');
    const range = IDBKeyRange.upperBound(cutoffDate.toISOString());
    
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`[IndexedDB] 清理了 ${deletedCount} 条超过 ${daysOld} 天的歌词缓存`);
        resolve(deletedCount);
      };
      
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (e) {
    console.error('[IndexedDB] 清理过期歌词失败:', e);
    throw e;
  }
}

// 导出整个数据库用于备份
export async function exportFullDatabase() {
  if (!db) await initIndexedDB();
  
  try {
    const backup = {
      exportTime: new Date().toISOString(),
      version: DB_VERSION,
      stores: {}
    };
    
    for (const storeName of Object.keys(STORES)) {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      backup.stores[storeName] = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    
    console.log('[IndexedDB] 数据库导出完成');
    return backup;
  } catch (e) {
    console.error('[IndexedDB] 导出数据库失败:', e);
    throw e;
  }
}
