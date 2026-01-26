import { state, persistState, saveCacheSettings } from './state.js';
import { ui } from './ui.js';
import { autoResizeUI, showToast, persistOnUnload, showConfirmDialog } from './utils.js';
import { api } from './api.js';
import { initNetease } from './netease.js';
import { initMounts, loadMountPoints, startScanPolling } from './mounts.js';
import { initPlayer, loadSongs, performDelete, handleExternalFile, renderPlaylist, switchTab } from './player.js';
import { batchManager } from './batch-manager.js';
import { checkAndMigrateData, cleanupOldData, cleanupOldCovers, cleanupOldPlaylistCache } from './db.js';

// 离线状态指示器
let offlineIndicator = null;

// Service Worker 注册和注销函数
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/static/js/service-worker.js', { scope: '/' });
      console.log('[Main] Service Worker 注册成功 - 离线支持已启用');
      
      // 监听更新
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[Main] Service Worker 更新可用');
            showToast('应用已更新，刷新页面以获取最新版本', 'info');
          }
        });
      });
    } catch (err) {
      console.warn('[Main] Service Worker 注册失败:', err.message);
    }
  }
}

async function unregisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
      console.log('[Main] Service Worker 已注销 - 离线支持已禁用');
      
      // 清理 Service Worker 缓存
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(key => caches.delete(key)));
          console.log('[Main] Service Worker 缓存已清理');
        } catch (e) {
          console.error('[Main] 清理 Service Worker 缓存失败:', e);
        }
      }
    } catch (err) {
      console.warn('[Main] Service Worker 注销失败:', err.message);
    }
  }
}

function setupOfflineIndicator() {
  // 监听网络状态变化
  window.addEventListener('networkStatusChanged', (event) => {
    const isOnline = event.detail.isOnline;
    updateOfflineIndicator(isOnline);
  });
  
  // 初始化离线指示器
  updateOfflineIndicator(navigator.onLine);
}

function updateOfflineIndicator(isOnline) {
  if (!offlineIndicator) {
    // 创建离线指示器
    offlineIndicator = document.createElement('div');
    offlineIndicator.id = 'offline-indicator';
    offlineIndicator.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(90deg, #ff6b6b, #ee5a6f);
      color: white;
      padding: 12px 20px;
      text-align: center;
      font-weight: bold;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: none;
      transition: all 0.3s ease;
    `;
    document.body.insertBefore(offlineIndicator, document.body.firstChild);
  }
  
  if (isOnline) {
    offlineIndicator.style.display = 'none';
    offlineIndicator.textContent = '';
    showToast('✓ 网络已恢复，数据同步中...', 'success');
  } else {
    offlineIndicator.style.display = 'block';
    offlineIndicator.innerHTML = '⚠️ 当前离线 - 使用本地缓存数据';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 设置离线指示器
  setupOfflineIndicator();
  
  // 0. IndexedDB 初始化与数据迁移检查 (后台异步执行)
  checkAndMigrateData().catch(e => console.error('[主程序] 数据迁移检查失败:', e));

  // 0.5. 执行定期清理（后台异步执行，不阻塞UI）
  setTimeout(async () => {
    try {
      await import('./db.js').then(mod => mod.performAllCleanup());
    } catch (e) {
      console.warn('[主程序] 定期清理失败:', e);
    }
  }, 5000); // 5秒后执行，让应用先初始化完成

  // 版本检查
  try {
    const VERSION_STORAGE_KEY = 'app_version';
    const currentVersion = localStorage.getItem(VERSION_STORAGE_KEY);
    const response = await api.system.versionCheck();
    
    if (response && response.version) {
      // 如果是首次访问（没有localStorage版本号），直接存储当前版本号，不提示更新
        // 因为此时浏览器已经从服务器获取了最新的前端文件
        if (!currentVersion) {
          console.log('无版本数据，设置当前版本：' + response.version);
          localStorage.setItem(VERSION_STORAGE_KEY, response.version);
        }
        // 如果版本号变化，提示用户更新
        else if (currentVersion !== response.version) {
          console.log('前端已过时！\n最新版本：' + response.version, '\n当前版本：' + currentVersion);
          
          // 使用通用确认模态框询问用户是否更新
          showConfirmDialog(
            '检测到新版本',
            `发现前端新版本，是否立即更新页面？\n<span style="color: red;">如出现问题，请先尝试使用设置页"清除应用缓存"！</span>`,
            () => {
              // 更新本地存储的版本号
              localStorage.setItem(VERSION_STORAGE_KEY, response.version);
              
              // 强制清除浏览器缓存并刷新页面
              window.location.reload(true);
            },
            {
              titleSize: '1.3rem',  // 设置标题大小
              messageSize: '1rem',  // 设置文本大小
              allowLineBreak: true  // 允许文本换行
            }
          );
        }
        else {
          console.log('前端已是最新！\n最新版本：' + response.version, '\n当前版本：' + currentVersion);
        }
    }
  } catch (error) {
    console.error('版本检查失败:', error);
    showToast('版本检查失败，请刷新页面重试', 'error');
  }
  
  // UI 适配与基础防护
  autoResizeUI();
  window.addEventListener('resize', () => {
    requestAnimationFrame(autoResizeUI);
  });
  window.addEventListener('error', function (e) { if (e.target.tagName === 'IMG') e.target.src = '/static/images/ICON_256.PNG'; }, true);
  document.addEventListener('contextmenu', (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') e.preventDefault(); });
  persistOnUnload(ui.audio);

  // 网易云 Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // 上传页面
  const uploadView = document.getElementById('view-upload');
  const uploadTargetInput = document.getElementById('upload-target-input'); // hidden value
  const uploadTargetSelect = document.getElementById('upload-target-select');
  const uploadTargetCurrent = document.getElementById('upload-target-current');
  const uploadTargetList = document.getElementById('upload-target-list');
  const uploadDropzone = document.getElementById('upload-dropzone');
  const uploadChooseBtn = document.getElementById('upload-choose-btn');
  const uploadStatus = document.getElementById('upload-status');
  // const views = ['view-player', 'view-mount', 'view-netease', 'view-upload', 'view-settings']; - REMOVED

  function setUploadTarget(value, label) {
    if (uploadTargetInput) uploadTargetInput.value = value || '';
    if (uploadTargetCurrent) {
      uploadTargetCurrent.dataset.value = value || '';
      uploadTargetCurrent.textContent = label || '默认音乐库';
    }
    if (uploadTargetList) uploadTargetList.classList.add('hidden');
    uploadTargetSelect?.classList.remove('open');
  }

  if (ui.navUpload && uploadView && ui.fileUpload) {
    const populateUploadTargets = async () => {
      try {
        const res = await api.mount.list();
        if (res.success && Array.isArray(res.data) && uploadTargetList) {
          uploadTargetList.innerHTML = '';
          const all = [{ value: '', label: '默认音乐库' }, ...res.data.map(p => ({ value: p, label: p }))];
          all.forEach(item => {
            const option = document.createElement('div');
            option.className = 'upload-select-option';
            option.dataset.value = item.value;
            option.innerText = item.label;
            option.onclick = (e) => { e.stopPropagation(); setUploadTarget(item.value, item.label); };
            uploadTargetList.appendChild(option);
          });
        }
      } catch (e) { console.error('加载上传目录失败', e); }
    };

    ui.navUpload.addEventListener('click', () => {
      switchTab('upload'); // Used switchTab
      populateUploadTargets();
      // Mobile sidebar handled in switchTab
    });

    const handleFile = (file) => {
      if (!file) return;
      if (!file.name.match(/\.(mp3|flac|wav|ogg|m4a)$/i)) { showToast('仅支持音频文件'); return; }
      const formData = new FormData();
      formData.append('file', file);
      if (uploadTargetInput?.value) formData.append('target_dir', uploadTargetInput.value.trim());
      uploadStatus.innerText = '上传中...';
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && uploadStatus) {
          const percent = Math.round((e.loaded / e.total) * 100);
          uploadStatus.innerText = `上传中... ${percent}%`;
        }
      };
      xhr.onload = () => {
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          if (data.success) {
            uploadStatus.innerText = '上传成功';
            const targetLabel = uploadTargetCurrent ? uploadTargetCurrent.textContent : '默认音乐库';
            showToast(`已上传 1 首音乐至 ${targetLabel}`);
            loadSongs(true, false);
          } else uploadStatus.innerText = '失败: ' + (data.error || '未知错误');
        } else uploadStatus.innerText = '服务器错误';
        ui.fileUpload.value = '';
      };
      xhr.onerror = () => { uploadStatus.innerText = '网络连接失败'; };
      xhr.open('POST', '/api/music/upload', true);
      xhr.send(formData);
    };

    uploadChooseBtn?.addEventListener('click', () => ui.fileUpload?.click());
    uploadDropzone?.addEventListener('dragover', (e) => { e.preventDefault(); uploadDropzone?.classList.add('drag-over'); });
    uploadDropzone?.addEventListener('dragleave', () => uploadDropzone?.classList.remove('drag-over'));
    uploadDropzone?.addEventListener('drop', (e) => { 
      e.preventDefault(); 
      uploadDropzone?.classList.remove('drag-over'); 
      if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]); 
    });
    ui.fileUpload?.addEventListener('change', (e) => { 
      if (e.target?.files?.[0]) handleFile(e.target.files[0]); 
    });

    // 自定义下拉选择行为
    uploadTargetSelect?.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadTargetList?.classList.toggle('hidden');
      uploadTargetSelect.classList.toggle('open');
    });
    document.addEventListener('click', () => {
      uploadTargetList?.classList.add('hidden');
      uploadTargetSelect?.classList.remove('open');
    });
    // 初始化默认
    setUploadTarget('', '默认音乐库');
  }

  // 其他导航：回到播放器或对应视图
  if (ui.navLocal) ui.navLocal.addEventListener('click', () => { switchTab('local'); });
  if (ui.navFav) ui.navFav.addEventListener('click', () => { switchTab('fav'); });
  if (ui.navHotlist) ui.navHotlist.addEventListener('click', () => { switchTab('hotlist'); });
  if (ui.navMount) ui.navMount.addEventListener('click', () => { switchTab('mount'); });
  if (ui.navNetease) ui.navNetease.addEventListener('click', () => { switchTab('netease'); });
  if (ui.navSettings) ui.navSettings.addEventListener('click', () => { switchTab('settings'); });

  // Settings Logic
  function initSettings() {
    if (!ui.scaleInput) return;

    const updateSliderVisual = (val) => {
      // Map 0.6-1.4 to 0-100%
      const min = 0.6, max = 1.4;
      const pct = ((val - min) / (max - min)) * 100;
      ui.scaleInput.style.backgroundSize = `${pct}% 100%`;
    };

    const updateLabel = (val) => {
      if (ui.scaleValue) ui.scaleValue.innerText = val ? parseFloat(val).toFixed(2) : '自动';
      if (val) updateSliderVisual(parseFloat(val));
    };

    // Load initial
    const saved = localStorage.getItem('2fmusic_ui_scale');
    if (saved) {
      ui.scaleInput.value = saved;
      updateLabel(saved);
    } else {
      // If auto, set slider to computed or 1.0 (approximated)
      const current = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim();
      const val = parseFloat(current) || 1.0;
      ui.scaleInput.value = val;
      updateSliderVisual(val);
      if (ui.scaleValue) ui.scaleValue.innerText = '自动';
    }

    // 拖动过程中只更新滑块视觉效果，不应用缩放
    ui.scaleInput.addEventListener('input', (e) => {
      const val = e.target.value;
      // 只更新滑块视觉效果
      updateLabel(val);
    });

    // 用户放下拖动条时应用缩放并保存设置
    ui.scaleInput.addEventListener('change', (e) => {
      const val = e.target.value;
      // 应用缩放效果
      document.documentElement.style.setProperty('--ui-scale', val);
      // 保存到本地存储
      localStorage.setItem('2fmusic_ui_scale', val);
    });

    ui.scaleReset?.addEventListener('click', () => {
      localStorage.removeItem('2fmusic_ui_scale');
      if (window.applyScale) window.applyScale(); // Re-trigger auto calc
      const current = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim();
      const val = parseFloat(current);
      ui.scaleInput.value = val;
      updateSliderVisual(val);
      if (ui.scaleValue) ui.scaleValue.innerText = '自动';
      if (ui.scaleValue) ui.scaleValue.innerText = '自动';
      showToast('已重置为自动缩放');
    });

    // Clear Cache
    document.getElementById('setting-clear-cache')?.addEventListener('click', () => {
      showConfirmDialog('彻底清除数据', '确定要删除本网站的所有本地数据吗？<br>包括缓存、Cookie、偏好设置等。页面将重新加载。', async () => {
        // 1. Clear Storage (保留版本号)
        const VERSION_STORAGE_KEY = 'app_version';
        const version = localStorage.getItem(VERSION_STORAGE_KEY);
        
        // 清除除了版本号之外的所有localStorage数据
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key !== VERSION_STORAGE_KEY) {
            localStorage.removeItem(key);
            i--; // 因为删除后长度会减1，需要调整索引
          }
        }
        
        sessionStorage.clear();

        // 2. Clear IndexedDB
        if ('indexedDB' in window) {
          try {
            const dbs = await indexedDB.databases?.() || [];
            for (const db of dbs) {
              if (db.name === '2FMusicDB') {
                indexedDB.deleteDatabase(db.name);
                console.log('[Clear Cache] 已删除 IndexedDB:', db.name);
              }
            }
          } catch (e) {
            console.warn('[Clear Cache] 清理 IndexedDB 失败:', e);
          }
        }

        // 3. Clear Cookies
        document.cookie.split(";").forEach((c) => {
          document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });

        // 4. Clear Cache Storage (Service Workers)
        if ('caches' in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
            console.log('[Clear Cache] 已清理 Service Worker 缓存');
          } catch (e) {
            console.error("[Clear Cache] 清理 Service Worker 缓存失败:", e);
          }
        }

        // 5. Force Reload
        location.reload(true);
      });
    });

    // 缓存设置
    const cacheCoversCheckbox = document.getElementById('setting-cache-covers');
    const cacheLyricsCheckbox = document.getElementById('setting-cache-lyrics');
    const offlineSupportCheckbox = document.getElementById('setting-offline-support');
    
    // 调试日志：确认初始状态
    console.log('[Settings] 初始状态 - cacheCovers:', state.cacheCovers, 'cacheLyrics:', state.cacheLyrics, 'offlineSupport:', state.offlineSupport);
    
    if (cacheCoversCheckbox) {
      cacheCoversCheckbox.checked = state.cacheCovers;
      cacheCoversCheckbox.addEventListener('change', () => {
        state.cacheCovers = cacheCoversCheckbox.checked;
        saveCacheSettings();
        console.log('[Settings] 缓存封面已', cacheCoversCheckbox.checked ? '启用' : '禁用', '- 状态:', state.cacheCovers);
        showToast(cacheCoversCheckbox.checked ? '✓ 已启用封面缓存' : '✓ 已禁用封面缓存');
      });
    }
    
    if (cacheLyricsCheckbox) {
      cacheLyricsCheckbox.checked = state.cacheLyrics;
      cacheLyricsCheckbox.addEventListener('change', () => {
        state.cacheLyrics = cacheLyricsCheckbox.checked;
        saveCacheSettings();
        console.log('[Settings] 缓存歌词已', cacheLyricsCheckbox.checked ? '启用' : '禁用', '- 状态:', state.cacheLyrics);
        showToast(cacheLyricsCheckbox.checked ? '✓ 已启用歌词缓存' : '✓ 已禁用歌词缓存');
      });
    }
    
    if (offlineSupportCheckbox) {
      offlineSupportCheckbox.checked = state.offlineSupport;
      offlineSupportCheckbox.addEventListener('change', async () => {
        state.offlineSupport = offlineSupportCheckbox.checked;
        saveCacheSettings();
        console.log('[Settings] 离线支持已', offlineSupportCheckbox.checked ? '启用' : '禁用', '- 状态:', state.offlineSupport);
        
        if (state.offlineSupport) {
          // 启用离线支持 - 注册 Service Worker
          await registerServiceWorker();
          showToast('✓ 离线支持已启用，需重新加载页面以生效', 'info');
        } else {
          // 禁用离线支持 - 注销 Service Worker
          await unregisterServiceWorker();
          showToast('✓ 离线支持已禁用，需重新加载页面以生效', 'info');
        }
      });
    }

    // Logout
    document.getElementById('setting-logout')?.addEventListener('click', () => {
      showConfirmDialog('退出登录', '确定要退出当前登录吗？', () => {
        window.location.href = '/logout';
      });
    });
  }
  initSettings();

  // 初始化批量操作模块
  // 批量操作现在由 batch-manager.js 的右键菜单处理

  // 初始化模块
  initMounts(loadSongs);
  
  try {
    await initPlayer();
    console.log('[Main] Player initialized');
  } catch (e) {
    console.error('[Main] Failed to initialize player:', e);
  }

  // 检查是否需要特别处理收藏夹详情页
  if (state.currentTab === 'fav' && state.selectedPlaylistId) {
    // 如果在收藏夹详情页，延迟一点时间再渲染，确保DOM完全加载
    setTimeout(() => {
      renderPlaylist();
    }, 100);
  }

  await initNetease(loadSongs);
  loadMountPoints();
  startScanPolling(false, (r) => loadSongs(r, false), loadMountPoints);

  // 根据设置决定是否注册 Service Worker（为PWA提供离线支持和资源缓存）
  if (state.offlineSupport !== false) {
    await registerServiceWorker();
  } else {
    await unregisterServiceWorker();
  }
});
