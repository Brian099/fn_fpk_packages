import { state, persistState, saveFavorites } from './state.js';
import { ui } from './ui.js';

export function throttle(func, limit) {
  let inThrottle;
  return function () {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

export function autoResizeUI() {
  const saved = localStorage.getItem('2fmusic_ui_scale');
  if (saved) {
    document.documentElement.style.setProperty('--ui-scale', saved);
    return;
  }

  if (window.innerWidth > 768) {
    const scale = Math.min(Math.max(window.innerWidth / 1440, 0.8), 1.2);
    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
  } else {
    document.documentElement.style.setProperty('--ui-scale', '1.0');
  }
}

export function showToast(message, type = 'info') {
  const iconMap = {
    'info': '<i class="fas fa-info-circle"></i>',
    'success': '<i class="fas fa-check-circle"></i>',
    'error': '<i class="fas fa-exclamation-circle"></i>',
    'warning': '<i class="fas fa-exclamation-triangle"></i>',
    'loading': '<i class="fas fa-spinner fa-spin"></i>'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
        <div class="toast-icon">${iconMap[type] || iconMap['info']}</div>
        <div class="toast-content">${message}</div>
    `;

  if (ui.toastContainer) {
    ui.toastContainer.appendChild(toast);
    // 限制最大显示数量，防止刷屏
    if (ui.toastContainer.childElementCount > 5) {
      ui.toastContainer.firstChild.remove();
    }
  }

  // 动画进入
  requestAnimationFrame(() => toast.classList.add('show'));

  // 自动移除 (loading 类型除外，需手动移除)
  if (type !== 'loading') {
    setTimeout(() => {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', () => {
        if (toast.parentElement) toast.remove();
      });
    }, 3000);
  }

  return toast; // 返回元素以便手动控制
}

// 保持兼容性，处理旧的 persistent 调用
export function showPersistentToast(message) {
  return showToast(message, 'loading');
}

// 移除指定的 toast (用于 loading 类型)
export function removeToast(toastEl) {
  if (toastEl && toastEl.classList) {
    toastEl.classList.remove('show');
    setTimeout(() => {
      if (toastEl.parentElement) toastEl.remove();
    }, 300);
  }
}

// 兼容旧接口：hideProgressToast
// 注意：旧逻辑是依赖 state.progressToastEl 单例，
// 新逻辑建议调用方保存 showPersistentToast 返回的 element 并传给 removeToast。
// 这里为了不破坏旧代码，尝试清除页面上所有的 loading toast
export function hideProgressToast() {
  const loadingToasts = document.querySelectorAll('.toast-loading');
  loadingToasts.forEach(el => removeToast(el));
  state.progressToastEl = null;
}
export function showConfirmDialog(title, message, onConfirm, options = {}) {
  if (ui.confirmTitle) {
    ui.confirmTitle.innerText = title;
    // 自定义标题颜色
    if (options.titleColor) {
      ui.confirmTitle.style.color = options.titleColor;
    } else {
      ui.confirmTitle.style.color = ''; // 重置为默认颜色
    }
    // 自定义标题大小
    if (options.titleSize) {
      ui.confirmTitle.style.fontSize = options.titleSize;
    } else {
      ui.confirmTitle.style.fontSize = ''; // 重置为默认大小
    }
  }
  
  if (ui.confirmText) {
    // 文本换行处理
    const displayMessage = options.allowLineBreak ? message : message.replace(/\n/g, '<br>');
    ui.confirmText.innerHTML = displayMessage;
    // 自定义消息文本颜色
    if (options.messageColor) {
      ui.confirmText.style.color = options.messageColor;
    } else {
      ui.confirmText.style.color = ''; // 重置为默认颜色
    }
    // 自定义消息文本大小
    if (options.messageSize) {
      ui.confirmText.style.fontSize = options.messageSize;
    } else {
      ui.confirmText.style.fontSize = ''; // 重置为默认大小
    }
    // 设置文本换行样式
    if (options.allowLineBreak) {
      ui.confirmText.style.whiteSpace = 'pre-line';
    } else {
      ui.confirmText.style.whiteSpace = ''; // 重置为默认样式
    }
  }
  
  state.currentConfirmAction = onConfirm;
  ui.confirmModalOverlay?.classList.add('active');
}

export function updateDetailFavButton(isFav) {
  if (!ui.fpBtnFav) return;
  if (isFav) { ui.fpBtnFav.classList.add('active-fav'); ui.fpBtnFav.innerHTML = '<i class="fas fa-heart"></i>'; }
  else { ui.fpBtnFav.classList.remove('active-fav'); ui.fpBtnFav.innerHTML = '<i class="far fa-heart"></i>'; }
}

export function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const min = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function renderNoLyrics(msg) {
  if (!ui.lyricsContainer) return;
  ui.lyricsContainer.innerHTML = `<p class="lyric-line active">${msg}</p>`;
  ui.lyricsContainer.classList.add('no-lyrics');
}

export function updateSliderFill(el) {
  if (!el) return;
  const val = parseFloat(el.value) || 0;
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;

  let percent = ((val - min) / (max - min)) * 100;
  if (isNaN(percent)) percent = 0;
  percent = Math.max(0, Math.min(100, percent));

  el.style.backgroundSize = `${percent}% 100%`;
}

export function flyToElement(startEl, targetEl) {
  if (!startEl || !targetEl) return;
  const startRect = startEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  const flyer = document.createElement('div');
  Object.assign(flyer.style, {
    position: 'fixed',
    zIndex: '9999',
    pointerEvents: 'none',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: '#1db954',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    left: `${startRect.left + startRect.width / 2}px`,
    top: `${startRect.top + startRect.height / 2}px`,
    opacity: 1,
    transform: 'scale(1)'
  });
  flyer.innerHTML = '<i class="fas fa-music"></i>';
  document.body.appendChild(flyer);

  requestAnimationFrame(() => {
    flyer.style.transition = 'all 0.6s ease';
    flyer.style.left = `${targetRect.left + targetRect.width / 2}px`;
    flyer.style.top = `${targetRect.top + targetRect.height / 2}px`;
    flyer.style.transform = 'scale(0.5)';
    flyer.style.opacity = '0';
  });

  flyer.addEventListener('transitionend', () => flyer.remove());
}

export function persistOnUnload(audio) {
  window.addEventListener('beforeunload', () => persistState(audio));
}

export function saveFavoritesToStorage() {
  saveFavorites();
}

export function extractColorFromImage(imgEl) {
  try {
    // 优先使用 ColorThief 以获得更好的主色调
    if (window.ColorThief) {
      const colorThief = new ColorThief();
      const rgb = colorThief.getColor(imgEl);
      if (rgb && rgb.length === 3) {
        return { r: rgb[0], g: rgb[1], b: rgb[2], toString: () => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.8)` };
      }
    }

    // 降级方案：Canvas 取中心像素
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    // 取图片中心点
    ctx.drawImage(imgEl, imgEl.naturalWidth / 2, imgEl.naturalHeight / 2, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, toString: () => `rgba(${r}, ${g}, ${b}, 0.8)` };
  } catch (e) {
    console.warn('Color extraction failed', e);
    return null;
  }
}