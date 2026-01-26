import { state } from './state.js';
import { ui } from './ui.js';

// 打开播放队列窗口
export function openQueueModal() {
  // 创建模态框背景（遮挡层）
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'queue-modal-overlay';
  
  // 创建模糊背景层（只在队列后面）
  const blurBg = document.createElement('div');
  blurBg.className = 'queue-blur-bg';
  
  // 创建模态框容器
  const modal = document.createElement('div');
  modal.className = 'queue-modal';
  
  // 模态框内容
  modal.innerHTML = `
    <div class="queue-modal-header">
      <div class="queue-modal-title">
        <h2>播放队列</h2>
        <span class="queue-count">${state.playQueue.length} 首歌曲</span>
      </div>
      <button class="queue-modal-close">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="queue-modal-content">
      <div class="queue-list"></div>
    </div>
  `;

  // 获取队列列表容器
  const queueListContainer = modal.querySelector('.queue-list');
  
  // 创建队列项
  state.playQueue.forEach((song, index) => {
    const queueItem = document.createElement('div');
    queueItem.className = 'queue-item';
    if (index === state.currentTrackIndex) {
      queueItem.classList.add('playing');
    }
    queueItem.dataset.index = index;
    
    queueItem.innerHTML = `
      <div class="queue-item-number">${index + 1}</div>
      <div class="queue-item-cover">
        <img src="${song.cover}" loading="lazy">
        ${index === state.currentTrackIndex ? '<div class="playing-indicator"><i class="fas fa-play"></i></div>' : ''}
      </div>
      <div class="queue-item-info">
        <div class="queue-item-title">${song.title}</div>
        <div class="queue-item-artist">${song.artist || '未知歌手'}</div>
      </div>
      <button class="queue-item-remove" data-index="${index}" title="移除">
        <i class="fas fa-trash"></i>
      </button>
    `;

    // 点击队列项播放
    queueItem.addEventListener('click', (e) => {
      if (!e.target.closest('.queue-item-remove')) {
        // 这里需要导入 playTrack 函数，暂时通过事件触发
        window.dispatchEvent(new CustomEvent('queueItemClick', { detail: { index } }));
      }
    });

    // 移除按钮
    const removeBtn = queueItem.querySelector('.queue-item-remove');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(index, queueListContainer, modal);
    });

    queueListContainer.appendChild(queueItem);
  });

  // 添加到页面
  modalOverlay.appendChild(blurBg);
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);

  // 关闭函数
  const closeModal = () => {
    modalOverlay.classList.add('closing');
    setTimeout(() => {
      modalOverlay.remove();
    }, 500);
  };

  // 关闭按钮事件
  const closeBtn = modal.querySelector('.queue-modal-close');
  closeBtn.addEventListener('click', closeModal);

  // 点击背景关闭
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  // 立即添加 open 类，使所有变化同时进行
  modalOverlay.classList.add('open');
}

// 从队列中移除歌曲
function removeFromQueue(index, container, modal) {
  // 移除队列中的歌曲
  state.playQueue.splice(index, 1);
  
  // 调整当前播放索引
  if (index < state.currentTrackIndex) {
    state.currentTrackIndex--;
  } else if (index === state.currentTrackIndex && state.currentTrackIndex >= state.playQueue.length) {
    state.currentTrackIndex = Math.max(0, state.playQueue.length - 1);
  }

  // 保存状态
  localStorage.setItem('2fmusic_playlist', JSON.stringify(state.playQueue));

  // 重新渲染队列列表
  container.innerHTML = '';
  state.playQueue.forEach((song, newIndex) => {
    const queueItem = document.createElement('div');
    queueItem.className = 'queue-item';
    if (newIndex === state.currentTrackIndex) {
      queueItem.classList.add('playing');
    }
    queueItem.dataset.index = newIndex;
    
    queueItem.innerHTML = `
      <div class="queue-item-number">${newIndex + 1}</div>
      <div class="queue-item-cover">
        <img src="${song.cover}" loading="lazy">
        ${newIndex === state.currentTrackIndex ? '<div class="playing-indicator"><i class="fas fa-play"></i></div>' : ''}
      </div>
      <div class="queue-item-info">
        <div class="queue-item-title">${song.title}</div>
        <div class="queue-item-artist">${song.artist || '未知歌手'}</div>
      </div>
      <button class="queue-item-remove" data-index="${newIndex}" title="移除">
        <i class="fas fa-trash"></i>
      </button>
    `;

    // 点击队列项播放
    queueItem.addEventListener('click', (e) => {
      if (!e.target.closest('.queue-item-remove')) {
        window.dispatchEvent(new CustomEvent('queueItemClick', { detail: { index: newIndex } }));
      }
    });

    // 移除按钮
    const removeBtn = queueItem.querySelector('.queue-item-remove');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(newIndex, container, modal);
    });

    container.appendChild(queueItem);
  });

  // 更新计数
  const queueCount = modal.querySelector('.queue-count');
  queueCount.textContent = `${state.playQueue.length} 首歌曲`;
}
