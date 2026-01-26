import { state } from './state.js';
import { ui } from './ui.js';

// 歌手聚合视图 - 按歌手分组显示歌曲
export function renderArtistAggregateView(songs, playTrack) {
  // 按歌手分组
  const artistGroups = {};
  songs.forEach(song => {
    const artist = song.artist || '未知歌手';
    if (!artistGroups[artist]) {
      artistGroups[artist] = [];
    }
    artistGroups[artist].push(song);
  });

  // 按歌手名称排序
  const sortedArtists = Object.keys(artistGroups).sort((a, b) => 
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  if (sortedArtists.length === 0) {
    ui.songContainer.innerHTML = `<div class="loading-text" style="grid-column: 1/-1; padding: 4rem 0; font-size: 1.1rem; opacity: 0.6;">暂无歌曲</div>`;
    return;
  }

  // 使用歌手聚合视图的布局
  ui.songContainer.className = 'song-list artist-aggregate-grid';
  const frag = document.createDocumentFragment();

  sortedArtists.forEach(artist => {
    const artistSongs = artistGroups[artist];
    
    // 创建歌手卡片
    const artistCard = document.createElement('div');
    artistCard.className = 'artist-card';
    artistCard.dataset.artist = artist;

    // 获取第一首歌曲的封面作为歌手头图
    const firstSongCover = artistSongs[0]?.cover || '/static/images/ICON_256.PNG';

    artistCard.innerHTML = `
      <div class="artist-header">
        <img src="${firstSongCover}" loading="lazy" class="artist-cover">
        <div class="artist-info">
          <div class="artist-name">${artist}</div>
          <div class="artist-count">${artistSongs.length} 首歌曲</div>
        </div>
        <div class="artist-arrow">
          <i class="fas fa-arrow-right"></i>
        </div>
      </div>
    `;

    // 添加点击事件，打开窗口显示歌曲列表
    artistCard.addEventListener('click', () => {
      openArtistModal(artist, artistSongs, playTrack);
    });

    frag.appendChild(artistCard);
  });

  ui.songContainer.appendChild(frag);
}

// 打开歌手窗口显示其歌曲列表
function openArtistModal(artistName, artistSongs, playTrack) {
  // 创建模态框背景
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'artist-modal-overlay';
  
  // 创建模态框容器
  const modal = document.createElement('div');
  modal.className = 'artist-modal';
  
  // 获取第一首歌曲的封面作为背景
  const firstSongCover = artistSongs[0]?.cover || '/static/images/ICON_256.PNG';
  
  // 模态框内容
  modal.innerHTML = `
    <div class="artist-modal-header">
      <div class="artist-modal-cover">
        <img src="${firstSongCover}" loading="lazy">
      </div>
      <div class="artist-modal-info">
        <div class="artist-modal-name">${artistName}</div>
        <div class="artist-modal-count">${artistSongs.length} 首歌曲</div>
      </div>
      <button class="artist-modal-close">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="artist-modal-content">
      <div class="artist-modal-songs"></div>
    </div>
  `;

  // 获取歌曲列表容器
  const songsContainer = modal.querySelector('.artist-modal-songs');
  
  // 创建歌曲列表
  artistSongs.forEach(song => {
    const songItem = document.createElement('div');
    songItem.className = 'artist-modal-song-item';
    
    songItem.innerHTML = `
      <div class="artist-modal-song-cover">
        <img src="${song.cover}" loading="lazy">
      </div>
      <div class="artist-modal-song-info">
        <div class="artist-modal-song-title">${song.title}</div>
        <div class="artist-modal-song-album">${song.album || '未知专辑'}</div>
      </div>
    `;

    songItem.addEventListener('click', () => {
      state.playQueue = [...state.displayPlaylist];
      playTrack(state.displayPlaylist.indexOf(song));
      closeModal();
    });

    songsContainer.appendChild(songItem);
  });

  // 添加到页面
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);

  // 关闭函数
  const closeModal = () => {
    modalOverlay.classList.add('closing');
    setTimeout(() => {
      modalOverlay.remove();
    }, 300);
  };

  // 关闭按钮事件
  const closeBtn = modal.querySelector('.artist-modal-close');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeModal();
  });

  // 点击背景关闭
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  // 打开时添加动画
  requestAnimationFrame(() => {
    modalOverlay.classList.add('open');
  });
}
