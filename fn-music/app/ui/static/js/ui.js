// DOM 引用集中管理，便于模块共享
export const ui = {
  audio: document.getElementById('audio-player'),
  songContainer: document.getElementById('song-list-container'),
  overlay: document.getElementById('full-player-overlay'),
  fullPlayerOverlay: document.getElementById('full-player-overlay'), // Alias for clarity
  lyricsContainer: document.getElementById('lyrics-container'),
  searchInput: document.querySelector('.search-box input'),
  btnSort: document.getElementById('btn-sort'),
  sortDropdown: document.getElementById('sort-dropdown'),
  btnAddPlaylist: document.getElementById('btn-add-playlist'),
  playlistFilterContainer: document.getElementById('playlist-filter-container'),

  viewPlayer: document.getElementById('view-player'),
  viewMount: document.getElementById('view-mount'),
  viewNetease: document.getElementById('view-netease'),
  viewUpload: document.getElementById('view-upload'),
  mountListContainer: document.getElementById('mount-list-container'),
  mountPathInput: document.getElementById('mount-path-input'),
  btnAddMount: document.getElementById('btn-add-mount'),

  navLocal: document.getElementById('nav-local'),
  navFav: document.getElementById('nav-fav'),
  navHotlist: document.getElementById('nav-hotlist'),
  navMount: document.getElementById('nav-mount'),
  navNetease: document.getElementById('nav-netease'),
  navUpload: document.getElementById('nav-upload'),
  fileUpload: document.getElementById('file-upload'),

  neteaseKeywordsInput: document.getElementById('netease-global-input'),
  neteaseSearchBtn: document.getElementById('netease-global-search-btn'),
  neteaseUserDisplay: document.getElementById('netease-user-display'),
  neteaseUserAvatar: document.getElementById('netease-user-avatar'),
  neteaseUserName: document.getElementById('netease-user-name'),
  neteaseUserTag: document.querySelector('#netease-user-display .user-tag'),
  neteaseUserMenu: document.getElementById('netease-user-menu'),
  neteaseMenuLogout: document.getElementById('netease-menu-logout'),
  neteaseLoginBtnTop: document.getElementById('netease-login-btn-top'),
  neteaseAvatarWrapper: document.getElementById('netease-avatar-wrapper'),
  neteaseVipBadge: document.getElementById('netease-vip-badge'),
  neteaseVipBadge: document.getElementById('netease-vip-badge'),
  // neteaseSettingsBtn removed
  // neteaseSettingsModal removed
  // neteaseCloseSettingsBtn removed

  navSettings: document.getElementById('nav-settings'),
  viewSettings: document.getElementById('view-settings'),

  scaleInput: document.getElementById('setting-scale-input'),
  scaleValue: document.getElementById('setting-scale-value'),
  scaleReset: document.getElementById('setting-scale-reset'),

  neteaseQualitySelect: document.getElementById('netease-quality'),
  neteaseResultList: document.getElementById('netease-result-list'),
  // Removed old login card/status elements mapping as they don't exist in same form, 
  // but keeping variables to avoid crash if referenced (will be null)
  neteaseLoginStatus: null,
  neteaseLoginCard: null,
  neteaseLoginDesc: null,
  neteaseLoginBtn: null, // Old button
  neteaseRefreshStatusBtn: null,

  neteaseQrImg: document.getElementById('netease-qr-img'),
  neteaseQrModal: document.getElementById('netease-qr-modal'),
  closeQrModalBtn: document.getElementById('close-qr-modal'),
  neteaseQrHint: document.getElementById('netease-qr-hint'),

  neteaseLinkInput: null, // Merged
  neteaseIdDownloadBtn: null, // Merged
  neteaseDownloadDirInput: document.getElementById('netease-download-dir'),
  neteaseSelectAll: document.getElementById('netease-select-all'),
  neteaseBulkDownloadBtn: document.getElementById('netease-bulk-download'),
  neteaseBulkActions: document.getElementById('netease-bulk-actions'),

  neteaseApiGateInput: document.getElementById('netease-api-gate-input'),
  neteaseApiSettingsInput: document.getElementById('netease-api-settings-input'),
  neteaseApiGateBtn: document.getElementById('netease-api-gate-btn'),
  neteaseChangeApiBtn: document.getElementById('netease-disconnect-btn'),

  neteaseConfigGate: document.getElementById('netease-config-gate'),
  neteaseContent: document.getElementById('netease-content'),
  neteaseOpenConfigBtn: document.getElementById('netease-open-config'),
  neteaseSaveDirBtn: document.getElementById('netease-save-settings-btn'),
  neteaseDownloadList: document.getElementById('netease-download-list'),
  neteaseDownloadToggle: document.getElementById('netease-download-toggle'),
  neteaseDownloadPanel: document.getElementById('netease-download-panel'),
  neteaseDownloadFloating: document.getElementById('netease-download-floating'),

  uploadModal: document.getElementById('upload-modal'),
  uploadFileName: document.getElementById('upload-filename'),
  uploadFill: document.getElementById('upload-progress-fill'),
  uploadPercent: document.getElementById('upload-percent'),
  uploadMsg: document.getElementById('upload-msg'),
  closeUploadBtn: document.getElementById('close-upload-modal'),

  fpMenuBtn: document.getElementById('fp-menu-btn'),
  actionMenuOverlay: document.getElementById('action-menu-overlay'),
  actionDownloadBtn: document.getElementById('action-download'),
  actionDeleteBtn: document.getElementById('action-delete'),
  actionCancelBtn: document.getElementById('action-cancel'),
  confirmModalOverlay: document.getElementById('confirm-modal-overlay'),
  confirmYesBtn: document.getElementById('confirm-yes'),
  confirmNoBtn: document.getElementById('confirm-no'),
  confirmTitle: document.querySelector('.confirm-box h3'),
  confirmText: document.querySelector('.confirm-box p'),
  toastContainer: document.getElementById('toast-container'),

  btnPlay: document.getElementById('btn-play'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  progressBar: document.getElementById('progress-bar'),
  volumeSlider: document.getElementById('volume-slider'),
  fpBtnPlay: document.getElementById('fp-btn-play'),
  fpBtnPrev: document.getElementById('fp-btn-prev'),
  fpBtnNext: document.getElementById('fp-btn-next'),
  fpProgressBar: document.getElementById('fp-progress-bar'),
  fpBtnMode: document.getElementById('fp-btn-mode'),
  fpBtnFav: document.getElementById('fp-btn-fav'),
  btnMute: document.getElementById('btn-mute'),
  btnQueue: document.getElementById('btn-queue'),
  volIcon: document.getElementById('vol-icon'),
  mobileMiniPlay: document.getElementById('mobile-mini-play'),
  menuBtn: document.getElementById('mobile-menu-btn'),
  sidebar: document.getElementById('sidebar'),
  mobileTitle: document.getElementById('mobile-page-title'),
  tabs: document.querySelectorAll('.tab-btn')
};