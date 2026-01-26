import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { showToast, hideProgressToast, showConfirmDialog } from './utils.js';

let scanInterval = null;
const savedScraped = localStorage.getItem('scrapedPaths');
const scrapedPaths = new Map(savedScraped ? JSON.parse(savedScraped) : []);

export function startScanPolling(isUserAction = false, onRefreshSongs, onRefreshMounts) {
  if (state.isPolling) return;
  state.isPolling = true;
  let hasTrackedScan = false;
  let hasTrackedScrape = false;
  let lastScrapingPath = null;
  let lastScrapingMsg = null; // Store final message

  // 轮询函数，使用 setTimeout 实现动态间隔
  const poll = async () => {
    try {
      const status = await api.system.status();
      const isModalOpen = ui.uploadModal && ui.uploadModal.classList.contains('active');

      // 1. 处理扫描进度
      if (status.scanning) {
        hasTrackedScan = true;
        if (!isModalOpen) {
          if (isUserAction || state.fullPlaylist.length === 0) {
            const percent = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
            showToast(`正在处理库... ${status.processed}/${status.total} (${percent}%)`, true);
          }
        }
      } else {
        if (hasTrackedScan) {
          hasTrackedScan = false; // 重置标记
          hideProgressToast();
          if (!isModalOpen) {
            showToast('处理完成！');
            onRefreshSongs && onRefreshSongs();
            if (state.currentTab === 'mount' && onRefreshMounts) onRefreshMounts();
          }
        }
      }

      // 1.1 处理后台刮削进度 (Global status applied to all mount cards)
      const bars = document.querySelectorAll('.mount-card-progress');
      // Use explicit flag if available, fallback to string check
      const isScraping = status.is_scraping === true || (status.current_file && status.current_file.includes('刮削'));

      if (bars.length > 0) {
        if (isScraping) {
          const pct = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
          const text = status.current_file || '后台处理中...';
          const currentPath = status.current_path || '';

          // Capture potential completion message
          if (text.includes('完成')) {
            lastScrapingMsg = text;
          }

          bars.forEach(barContainer => {
            const card = barContainer.closest('.mount-card');
            let mountPath = card ? card.dataset.mountPath : null;
            // Fallback for stale DOM
            if (!mountPath && card) {
              const pathSpan = card.querySelector('.mount-path-text');
              if (pathSpan) mountPath = pathSpan.innerText.trim();
            }

            // Only show if currentPath starts with mountPath
            let shouldShow = false;
            if (mountPath && currentPath) {
              if (currentPath.startsWith(mountPath)) {
                shouldShow = true;
                // Store this as the active scraping path
                lastScrapingPath = mountPath;
              }
            } else if (!currentPath && !lastScrapingPath) {
              // Initial fallback
              shouldShow = true;
            }

            const fill = barContainer.querySelector('.progress-fill');
            const label = barContainer.querySelector('.progress-text');

            if (shouldShow) {
              if (barContainer.classList.contains('hidden')) {
                barContainer.classList.remove('hidden');
              }
              // Reset styles for active scraping (Blue)
              if (fill) {
                fill.style.width = pct + '%';
                fill.style.background = 'var(--primary)';
              }
              if (label) label.innerText = `${text} (${pct}%)`;
              barContainer.classList.remove('completed'); // Remove completed state if it starts scraping again
            } else {
              // Do NOT hide other bars, just leave them as is
            }
          });

          // Mark that we are currently scraping
          hasTrackedScrape = true;

        } else {
          // Scraping finished (or idle)

          if (hasTrackedScrape) {
            // Just finished!
            hasTrackedScrape = false;
            // Completion logic: Find the card for lastScrapingPath and mark green
            if (lastScrapingPath) {
              // Add to map to persist
              const finalMsg = lastScrapingMsg || '刮削完成';
              scrapedPaths.set(lastScrapingPath, finalMsg);
              localStorage.setItem('scrapedPaths', JSON.stringify(Array.from(scrapedPaths.entries())));

              const bars = document.querySelectorAll('.mount-card-progress');
              bars.forEach(barContainer => {
                const card = barContainer.closest('.mount-card');
                let mountPath = card ? card.dataset.mountPath : null;
                if (!mountPath && card) {
                  const pathSpan = card.querySelector('.mount-path-text');
                  if (pathSpan) mountPath = pathSpan.innerText.trim();
                }

                if (mountPath && lastScrapingPath.startsWith(mountPath)) {
                  // This is the one
                  barContainer.classList.remove('hidden');
                  barContainer.classList.add('completed');

                  const fill = barContainer.querySelector('.progress-fill');
                  const label = barContainer.querySelector('.progress-text');

                  if (fill) {
                    fill.style.width = '100%';
                    fill.style.background = '#28a745'; // Green
                  }
                  if (label) label.innerText = finalMsg;
                }
              });
            }
            // Do NOT show global toast
            onRefreshSongs && onRefreshSongs();
            lastScrapingPath = null;
            lastScrapingMsg = null;
          }
          // Do NOT hide bars when idle
        }
      }

      // 2. 处理库版本变更 (自动同步)
      if (status.library_version) {
        if (state.libraryVersion === 0) {
          // 首次初始化，仅同步版本号
          state.libraryVersion = status.library_version;
        } else if (status.library_version > state.libraryVersion) {
          console.log(`检测到库版本变更: ${state.libraryVersion} -> ${status.library_version}`);
          state.libraryVersion = status.library_version;
          // 触发刷新
          onRefreshSongs && onRefreshSongs(false); // false 表示不显示全屏 loading
          // 可选：显示一个小提示
          //showToast('发现新文件，列表已更新');
        }
      }

    } catch (e) {
      console.error('Poll error', e);
    } finally {
      // 动态调整间隔：正在扫描或刮削时 0.5s，否则 1s
      // Speed up polling to catch fast scraping tasks
      const delay = (hasTrackedScan || hasTrackedScrape || state.isPollingFast) ? 500 : 1000;
      // Set a flag to keep fast polling for a moment after completion?
      // Simplified: just check if we are *tracking* something.
      setTimeout(poll, delay);
    }
  };

  poll();
}

export async function loadMountPoints() {
  if (!ui.mountListContainer) return;
  ui.mountListContainer.innerHTML = '<div class="loading-text">加载中...</div>';
  try {
    const data = await api.mount.list();
    ui.mountListContainer.innerHTML = '';
    if (data.success) {
      if (data.data.length === 0) {
        ui.mountListContainer.innerHTML = '<div class="loading-text">暂无自定义目录</div>';
      } else {
        const frag = document.createDocumentFragment();
        data.data.forEach(path => {
          const card = document.createElement('div');
          card.className = 'mount-card';
          card.dataset.mountPath = path; // Store path for progress matching
          // Force column layout for the card to stack info/btn row above progress bar
          card.style.display = 'flex';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'stretch'; // Stretch to full width
          card.style.justifyContent = 'flex-start'; // Reset space-between from CSS
          card.style.gap = '0'; // Handle gap manually or let children handle it

          // Top row: Info + Button (Original mount-card layout simulation)
          const topRow = document.createElement('div');
          topRow.style.display = 'flex';
          topRow.style.justifyContent = 'space-between';
          topRow.style.alignItems = 'center';
          topRow.style.width = '100%';
          topRow.style.marginBottom = '0';

          const infoDiv = document.createElement('div');
          infoDiv.className = 'mount-info';
          const icon = document.createElement('i');
          icon.className = 'fas fa-folder mount-icon';
          const pathSpan = document.createElement('span');
          pathSpan.className = 'mount-path-text';
          pathSpan.textContent = path;
          infoDiv.appendChild(icon);
          infoDiv.appendChild(pathSpan);

          const actionsDiv = document.createElement('div');
          actionsDiv.style.display = 'flex';
          actionsDiv.style.alignItems = 'center';
          actionsDiv.style.gap = '0.5rem';

          const updateBtn = document.createElement('button');
          updateBtn.className = 'btn-update-mount';
          updateBtn.textContent = '更新';
          updateBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
              const res = await api.mount.update(path);
              if (res.success) {
                showToast('已触发更新...');
                // Polling will update the UI
              } else {
                showToast('更新请求失败: ' + res.error);
              }
            } catch (err) { showToast('网络错误'); }
          };

          const btn = document.createElement('button');
          btn.className = 'btn-remove-mount';
          btn.readOnly = true; // Just in case
          btn.textContent = '移除';
          btn.onclick = (e) => {
            e.stopPropagation(); // prevent card click if any
            triggerRemoveMount(path);
          };

          actionsDiv.appendChild(updateBtn);
          actionsDiv.appendChild(btn);

          topRow.appendChild(infoDiv);
          topRow.appendChild(actionsDiv);

          // Progress Bar (Always visible now)
          const progressContainer = document.createElement('div');
          progressContainer.className = 'mount-card-progress'; // Removed 'hidden'
          // Ensure it takes width
          progressContainer.style.width = '100%';
          progressContainer.style.marginTop = '0.8rem';
          progressContainer.style.background = 'rgba(0,0,0,0.2)';
          progressContainer.style.borderRadius = '4px';
          progressContainer.style.padding = '0.5rem';
          progressContainer.style.fontSize = '0.8rem';

          const progressText = document.createElement('div');
          progressText.className = 'progress-text';
          progressText.style.marginBottom = '0.3rem';
          progressText.style.color = 'var(--text-sub)';
          progressText.style.whiteSpace = 'nowrap';
          progressText.style.overflow = 'hidden';
          progressText.style.textOverflow = 'ellipsis';

          // Check persistence
          const completedMsg = scrapedPaths.get(path);

          const track = document.createElement('div');
          track.style.height = '4px';
          track.style.background = 'rgba(255,255,255,0.1)';
          track.style.borderRadius = '2px';
          track.style.overflow = 'hidden';

          const fill = document.createElement('div');
          fill.className = 'progress-fill';
          fill.style.height = '100%';

          if (completedMsg) {
            if (completedMsg.includes('失败')) {
              progressText.style.display = 'flex';
              progressText.style.justifyContent = 'space-between';
              progressText.style.alignItems = 'center';

              const txt = document.createElement('span');
              txt.innerText = completedMsg;
              txt.style.overflow = 'hidden';
              txt.style.textOverflow = 'ellipsis';
              progressText.appendChild(txt);

              const retryBtn = document.createElement('button');
              retryBtn.className = 'btn-primary';
              retryBtn.style.fontSize = '0.7rem';
              retryBtn.style.padding = '2px 8px';
              retryBtn.style.height = 'auto';
              retryBtn.style.marginLeft = '0.5rem';
              retryBtn.innerHTML = '<i class="fas fa-redo"></i> 重试';
              retryBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                  const res = await api.mount.retryScrape(path);
                  if (res.success) {
                    showToast('已重新开始刮削...');
                    scrapedPaths.delete(path);
                    localStorage.setItem('scrapedPaths', JSON.stringify(Array.from(scrapedPaths.entries())));
                    loadMountPoints();
                  } else {
                    showToast('操作失败: ' + res.error);
                  }
                } catch (err) { showToast('网络错误'); }
              };
              progressText.appendChild(retryBtn);
            } else {
              progressText.innerText = completedMsg;
            }

            fill.style.width = '100%';
            fill.style.background = completedMsg.includes('失败') ? '#ffc107' : '#28a745'; // Yellow for partial fail, Green for success
            progressContainer.classList.add('completed');
          } else {
            progressText.innerText = '已就绪';
            fill.style.width = '0%';
            fill.style.background = 'var(--primary)';
          }

          track.appendChild(fill);
          progressContainer.appendChild(progressText);
          progressContainer.appendChild(track);

          card.appendChild(topRow);
          card.appendChild(progressContainer);
          frag.appendChild(card);
        });
        ui.mountListContainer.appendChild(frag);
      }
    } else { ui.mountListContainer.innerHTML = `<div class="loading-text">加载失败: ${data.error}</div>`; }
  } catch (err) {
    ui.mountListContainer.innerHTML = '<div class="loading-text">网络错误</div>';
  }
}

export function triggerRemoveMount(path) {
  showConfirmDialog('移除目录', `确定要移除目录<br><b>${path}</b> 吗？`, () => {
    showToast('正在移除...');
    api.mount.remove(path).then(data => {
      if (data.success) {
        showToast(data.message || '已移除');
        loadMountPoints();
      } else {
        showToast('移除失败: ' + (data.error || ''));
      }
    });
  });
}

export function trackMountProgress(onDone) {
  const interval = setInterval(async () => {
    try {
      const status = await api.system.status();
      if (status.scanning) {
        const percent = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;
        if (ui.uploadFill) ui.uploadFill.style.width = `${percent}%`;
        if (ui.uploadPercent) ui.uploadPercent.innerText = `${percent}%`;
        if (ui.uploadMsg) ui.uploadMsg.innerText = status.current_file || '处理中...';
      } else {
        clearInterval(interval);
        if (ui.uploadFill) ui.uploadFill.style.width = '100%';
        if (ui.uploadPercent) ui.uploadPercent.innerText = '100%';
        if (ui.uploadMsg) ui.uploadMsg.innerText = '扫描并索引完成!';
        setTimeout(() => { onDone && onDone(); }, 1000);
      }
    } catch (e) { console.error('Mount poll error', e); }
  }, 500);
}

export function initMounts(onRefreshSongs) {
  const closeBtn = document.getElementById('close-upload-modal');
  if (closeBtn) {
    closeBtn.onclick = () => {
      const modal = document.getElementById('upload-modal');
      if (modal) modal.classList.remove('active');
    };
  }

  if (ui.btnAddMount) {
    ui.btnAddMount.addEventListener('click', () => {
      const path = ui.mountPathInput?.value.trim();
      if (!path) { showToast('请输入路径'); return; }
      ui.uploadModal?.classList.add('active');
      if (ui.uploadFileName) ui.uploadFileName.innerText = '扫描目录: ' + path;
      if (ui.uploadFill) ui.uploadFill.style.width = '0%';
      if (ui.uploadPercent) ui.uploadPercent.innerText = '0%';
      if (ui.uploadMsg) ui.uploadMsg.innerText = '正在提交...';
      if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'none';
      ui.btnAddMount.disabled = true;

      api.mount.add(path)
        .then(data => {
          if (data.success) {
            trackMountProgress(() => {
              ui.uploadModal?.classList.remove('active');
              if (ui.btnAddMount) ui.btnAddMount.disabled = false;
              if (ui.mountPathInput) ui.mountPathInput.value = '';
              loadMountPoints();
              onRefreshSongs && onRefreshSongs();
            });
          } else {
            if (ui.uploadMsg) ui.uploadMsg.innerText = '添加失败: ' + data.error;
            if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'inline-block';
            ui.btnAddMount.disabled = false;
          }
        })
        .catch(() => {
          if (ui.uploadMsg) ui.uploadMsg.innerText = '网络请求失败';
          if (ui.closeUploadBtn) ui.closeUploadBtn.style.display = 'inline-block';
          ui.btnAddMount.disabled = false;
        });
    });
  }
}
