// State
let allTracks = []; // Store current page's tracks for view
let playlist = []; // Currently displayed/playing list
let directories = [];
let currentIndex = -1;
let isShuffle = false;
let isLoop = false; // true = loop one, false = loop all (default) or no loop?
// Requirement: "Cycle or Random". Let's assume Loop All is default behavior for a playlist.
// "Loop" button usually toggles Loop All / Loop One / No Loop.
// For simplicity: Loop All (default) vs Shuffle.
// Let's make the loop button toggle "Loop One" (Repeat Track).
let isLoopOne = false;
let lastPlaybackState = null; // { path, position, timestamp }
let isInitialRestore = false;
let savedPlaylists = [];
let currentPlaylist = null; // Currently viewed playlist metadata
let matchingResults = []; // Temporary storage for playlist matching process
let activeMatchingIndex = -1; // For manual song picker

let totalTracks = 0;
let totalPages = 0;
let currentSearch = "";
let searchTimeout = null;
let currentArtist = null;
let currentAlbum = null;

// API Base Path (Matches installation path)
const apiBase = "/cgi/ThirdParty/musicwave/index.cgi";

let browserCurrentPath = "/";
let browserSelectedPath = "";

// Elements
const audio = document.getElementById('audio-player');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const btnPlayPause = document.getElementById('btn-play-pause');

// Visualizer State
let audioContext;
let analyser;
let dataArray;
let canvas, canvasCtx;
let animationId;

// Initialization
window.onload = function() {
    loadSettings();
    setupPlayerEvents();
    
    // Initial range background update
    updateRangeBackground(seekBar);
    updateRangeBackground(volumeBar);
    
    // Set crossOrigin for audio visualization
    audio.crossOrigin = "anonymous";
    
    // Check for direct file play (Double click from system)
    const urlParams = new URLSearchParams(window.location.search);
    const fileParam = urlParams.get('file'); // FnOS might use 'file' or 'path'
    const pathParam = urlParams.get('path');
    
    const targetFile = fileParam || pathParam;
    
    if (targetFile) {
        // Direct play mode
        const lastSlashIndex = targetFile.lastIndexOf('/');
        const dirPath = targetFile.substring(0, lastSlashIndex);
        
        // Scan directory for all music files
        scanDirectory(dirPath).then(files => {
             if (files && files.length > 0) {
                 allTracks = files;
                 playlist = [...allTracks];
                 renderPlaylist();
                 
                 // Find index of target file
                 const index = playlist.findIndex(p => p.path === targetFile);
                 if (index !== -1) {
                     play(index);
                 } else {
                     play(0);
                 }
             } else {
                 // Fallback if scan fails
                 const name = targetFile.split('/').pop();
                 allTracks = [{
                     name: name,
                     path: targetFile
                 }];
                 playlist = [...allTracks];
                 renderPlaylist();
                 play(0);
             }
        });
    } else {
        // Normal mode
        // Managed by loadSettings()
    }
};

async function scanDirectory(dir) {
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/scan`, {
            method: 'POST',
            body: dir
        });
        const data = await res.json();
        if (data.ok && data.files) {
            return data.files;
        }
    } catch (e) {
        console.error('Scan failed for', dir, e);
    }
    return [];
}

async function loadSettings() {
    try {
        // Try server config first
        const res = await fetch(`${apiBase}?api_route=/api/music/config/get`);
        const data = await res.json();
        
        let loaded = false;
        if (data && data.dirs && Array.isArray(data.dirs) && data.dirs.length > 0) {
            directories = data.dirs;
            loaded = true;
        }
        
        // Fallback to localStorage if server has no config
        if (!loaded) {
            const savedDirs = localStorage.getItem('musicwave_dirs') || localStorage.getItem('waves_dirs');
            if (savedDirs) {
                directories = JSON.parse(savedDirs);
                // Migrate to server
                saveSettings();
            }
        }
        
        renderDirList();
        
        // Load last playback from config if exists
        if (data && data.lastPlayback) {
            lastPlaybackState = data.lastPlayback;
        }
        
        // Override with localStorage if newer
        const localPlayback = localStorage.getItem('musicwave_last_playback') || localStorage.getItem('waves_last_playback');
        if (localPlayback) {
            const local = JSON.parse(localPlayback);
            if (!lastPlaybackState || local.timestamp > lastPlaybackState.timestamp) {
                lastPlaybackState = local;
            }
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.get('file') && !urlParams.get('path')) {
             if (directories.length > 0) {
                 await fetchLibraryPage(1);
                 
                 // Silent background sync to detect metadata
                 fetchMetadataBatch();

                 // Only restore if we are not in direct play mode
                 if (lastPlaybackState && lastPlaybackState.path) {
                     restoreLastPlayback();
                 }
             }
        }
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

async function saveSettings() {
    // Keep localStorage as backup
    localStorage.setItem('musicwave_dirs', JSON.stringify(directories));
    renderDirList();
    
    try {
        const config = { 
            dirs: directories,
            lastPlayback: lastPlaybackState
        };
        const res = await fetch(`${apiBase}?api_route=/api/music/config/save`, {
            method: 'POST',
            body: JSON.stringify(config)
        });
        const data = await res.json();
        if (!data.ok) {
            console.error('Server failed to save config:', data.error);
            alert('警告：无法保存设置到服务器: ' + (data.error || '未知错误'));
        }
    } catch (e) {
        console.error('Failed to save settings to server', e);
    }
}

// Navigation
function showSection(id) {
    document.querySelectorAll('.section').forEach(el => el.style.display = 'none');
    const targetSection = document.getElementById('section-' + id);
    if (targetSection) targetSection.style.display = 'flex';
    
    // Highlight sidebar
    document.querySelectorAll('.menu-item').forEach(el => {
        const onClickAttr = el.getAttribute('onclick') || '';
        if (onClickAttr.includes(`'${id}'`)) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    
    // Specific logic per section
    if (id === 'artists') {
        renderArtists();
    } else if (id === 'playlists') {
        loadPlaylists();
    }
}

// Queue system for artist images
const imageQueue = [];
let activeRequests = 0;
const MAX_CONCURRENT = 3;

function queueArtistImage(artist, imgId) {
    imageQueue.push({ artist, imgId });
    processQueue();
}

async function processQueue() {
    if (activeRequests >= MAX_CONCURRENT || imageQueue.length === 0) return;
    
    activeRequests++;
    const { artist, imgId } = imageQueue.shift();
    
    await fetchArtistImage(artist, imgId);
    
    activeRequests--;
    processQueue();
}

async function fetchArtistImage(artist, imgId) {
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/artist/search`, {
            method: 'POST',
            body: artist
        });
        const data = await res.json();
        if (data.ok && data.url) {
            const img = document.getElementById(imgId);
            const icon = document.getElementById(imgId + '-icon');
            if (img && icon) {
                img.src = data.url;
                img.onload = () => {
                    img.style.display = 'block';
                    icon.style.display = 'none';
                };
            }
        }
    } catch (e) {
        // console.warn('Failed to load artist image for', artist);
    }
}

async function renderArtists() {
    const container = document.getElementById('artists-container');
    container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px;">加载中...</div>';
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/artists/list`);
        const data = await res.json();
        
        if (!data.ok || !data.artists) {
             container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px;">无法加载歌手列表</div>';
             return;
        }
        
        const sortedArtists = data.artists.sort((a, b) => {
            if (a.artist === 'Unknown Artist') return 1;
            if (b.artist === 'Unknown Artist') return -1;
            return a.artist.localeCompare(b.artist, 'zh-CN');
        });
        
        container.innerHTML = '';
        if (sortedArtists.length === 0) {
            container.innerHTML = `
                <div style="color:#666; text-align:center; grid-column: 1/-1;">
                    <p>暂无歌手数据，请先扫描音乐。</p>
                    <button onclick="rescanAll()" class="layui-btn layui-btn-normal layui-btn-sm" style="margin-top:10px;">
                        <i class="layui-icon layui-icon-refresh"></i> 重新扫描
                    </button>
                </div>`;
            return;
        }
        
        // Clear queue when re-rendering
        imageQueue.length = 0;
        
        sortedArtists.forEach((item, index) => {
            const name = item.artist;
            const count = item.count;
            const div = document.createElement('div');
            div.className = 'artist-card';
            
            const safeName = escapeHtml(name);
            const imgId = 'artist-img-' + index;
            
            div.innerHTML = `
                <div class="artist-icon">
                    <i class="layui-icon layui-icon-username" id="${imgId}-icon"></i>
                    <img id="${imgId}" style="display:none; width:100%; height:100%; object-fit:cover;" alt="${safeName}" />
                </div>
                <div class="artist-name" title="${safeName}">${safeName}</div>
                <div class="artist-count">${count} 首歌曲</div>
            `;
            div.onclick = () => {
                showSection('library');
                filterBy('artist', name);
            };
            container.appendChild(div);
            
            // Trigger image load
            if (name !== 'Unknown Artist') {
                queueArtistImage(name, imgId);
            }
        });
    } catch (e) {
        console.error('Failed to render artists', e);
        container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px;">请求失败</div>';
    }
}

// Library Management
function renderDirList() {
    const container = document.getElementById('dir-list-container');
    container.innerHTML = '';
    
    directories.forEach((dir, index) => {
        const div = document.createElement('div');
        div.className = 'song-item'; // reuse class
        div.innerHTML = `
            <span><i class="layui-icon layui-icon-folder"></i> ${dir}</span>
            <span onclick="removeDir(${index})" style="color:#FF5722;"><i class="layui-icon layui-icon-delete"></i></span>
        `;
        container.appendChild(div);
    });
}

function removeDir(index) {
    directories.splice(index, 1);
    saveSettings();
}

function addManualDir() {
    const input = document.getElementById('manual-dir-input');
    const path = input.value.trim();
    
    if (!path) return;
    
    if (directories.includes(path)) {
        alert('该目录已存在');
        return;
    }
    
    directories.push(path);
    saveSettings();
    input.value = '';
    
    // Auto scan
    rescanAll();
}

const ITEMS_PER_PAGE = 50;
let currentPage = 1;

async function rescanAll(isSilent = false) {
    if (!isSilent) {
        document.getElementById('library-status').innerText = '正在快速扫描文件...';
    }
    
    for (const dir of directories) {
        try {
            const res = await fetch(`${apiBase}?api_route=/api/music/scan-fast`, {
                method: 'POST',
                body: dir
            });
        } catch (e) {
            console.error('Scan failed for', dir, e);
        }
    }
    
    // Refresh current view
    await fetchLibraryPage(currentPage);
}

async function fetchLibraryPage(page) {
    currentPage = page;
    try {
        let url = `${apiBase}?api_route=/api/music/library/get&page=${page}&limit=${ITEMS_PER_PAGE}`;
        if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;
        if (currentArtist) url += `&artist=${encodeURIComponent(currentArtist)}`;
        if (currentAlbum) url += `&album=${encodeURIComponent(currentAlbum)}`;
        
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok) {
            allTracks = data.tracks;
            totalTracks = data.total;
            totalPages = data.pages;
            
            let statusText = `共 ${totalTracks} 首歌曲`;
            if (currentArtist) statusText = `歌手: ${currentArtist} (共 ${totalTracks} 首)`;
            if (currentAlbum) statusText = `专辑: ${currentAlbum} (共 ${totalTracks} 首)`;
            if (currentSearch) statusText = `搜索: ${currentSearch} (共 ${totalTracks} 首)`;
            
            document.getElementById('library-status').innerText = statusText;
            renderPlaylist();
        }
    } catch (e) {
        console.error('Failed to fetch library page', e);
    }
}

async function fetchMetadataBatch(tracksToFetch) {
    if (!tracksToFetch || tracksToFetch.length === 0) return;
    
    const paths = tracksToFetch.map(t => t.path);
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/meta-batch`, {
            method: 'POST',
            body: JSON.stringify(paths)
        });
        const data = await res.json();
        
        if (data.ok && data.data) {
            let updatedCount = 0;
            data.data.forEach(meta => {
                const track = allTracks.find(t => t.path === meta.path);
                if (track) {
                    Object.assign(track, meta);
                    track.scanned = 1;
                    updatedCount++;
                }
            });
            
            if (updatedCount > 0) {
                renderPlaylist();
            }
        }
    } catch (e) {
        console.error('Batch metadata fetch failed', e);
    }
}

async function saveLibrary() {
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/library/save`, {
            method: 'POST',
            body: JSON.stringify({ ok: true, tracks: allTracks })
        });
        const data = await res.json();
        if (!data.ok) {
            console.error('Failed to save library:', data.error);
        }
    } catch (e) {
        console.error('Failed to save library', e);
    }
}

function onSearchInput(query) {
    currentSearch = query.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    
    searchTimeout = setTimeout(() => {
        fetchLibraryPage(1);
    }, 500);
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return '';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function filterBy(type, value) {
    if (type === 'artist') {
        currentArtist = value;
        currentAlbum = null;
    } else if (type === 'album') {
        currentAlbum = value;
        currentArtist = null;
    } else {
        currentArtist = null;
        currentAlbum = null;
    }
    
    // Clear search when filtering by artist/album
    if (currentArtist || currentAlbum) {
        currentSearch = "";
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = "";
    }
    
    fetchLibraryPage(1);
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeJs(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderPlaylist() {
    const container = document.getElementById('playlist-container');
    if (allTracks.length === 0 && !currentSearch) {
        container.innerHTML = '<div style="text-align:center; margin-top: 50px; color: #666;">暂无音乐，请去“管理目录”添加文件夹。</div>';
        return;
    }
    
    container.innerHTML = '';
    
    // Render Items
    allTracks.forEach((song, i) => {
        const div = document.createElement('div');
        // Check if playing
        const isPlaying = playlist[currentIndex] && playlist[currentIndex].path === song.path;
        div.className = 'playlist-item' + (isPlaying ? ' active' : '');
        
        div.onclick = (e) => {
            if (e.target.tagName === 'A' || e.target.closest('a')) return;
            
            // When clicking a song in library, we load the CURRENT PAGE as the playlist
            playlist = [...allTracks];
            play(i);
        };
        
        const title = song.title || song.name;
        const artist = song.artist || (song.scanned === 1 ? 'Unknown Artist' : 'Loading...');
        const album = song.album || (song.scanned === 1 ? 'Unknown Album' : 'Loading...');
        const duration = (song.duration && song.duration > 0) ? formatTime(song.duration) : (song.scanned === 1 ? '--:--' : 'Loading...');
        const size = (song.size && song.size > 0) ? formatSize(song.size) : (song.scanned === 1 ? '' : '');
        
        const safeTitle = escapeHtml(title);
        const safeArtist = escapeHtml(artist);
        const safeAlbum = escapeHtml(album);
        
        const jsArtist = escapeJs(song.artist || '');
        const jsAlbum = escapeJs(song.album || '');
        
        let artistHtml = `<div class="col-artist" title="${safeArtist}">${safeArtist}</div>`;
        if (song.artist) {
            artistHtml = `<div class="col-artist" title="${safeArtist}">
                <a href="#" class="clickable-link" onclick="event.preventDefault(); filterBy('artist', '${jsArtist}')">${safeArtist}</a>
            </div>`;
        }
        
        let albumHtml = `<div class="col-album" title="${safeAlbum}">${safeAlbum}</div>`;
        if (song.album) {
             albumHtml = `<div class="col-album" title="${safeAlbum}">
                <a href="#" class="clickable-link" onclick="event.preventDefault(); filterBy('album', '${jsAlbum}')">${safeAlbum}</a>
            </div>`;
        }
        
        div.innerHTML = `
            <div class="col-name" title="${safeTitle}">${safeTitle}</div>
            ${artistHtml}
            ${albumHtml}
            <div class="col-size">${size}</div>
            <div class="col-duration">${duration}</div>
        `;
        container.appendChild(div);
    });

    // Auto-fetch metadata for visible items if not scanned
    const unscanned = allTracks.filter(s => s.scanned === 0 && !s._pending);
    if (unscanned.length > 0) {
        unscanned.forEach(s => s._pending = true);
        fetchMetadataBatch(unscanned);
    }
    
    // Render Pagination Controls
    if (totalPages > 1) {
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'pagination-controls';
        paginationDiv.style.cssText = 'display: flex; justify-content: center; align-items: center; padding: 20px; gap: 10px; color: #fff;';
        
        const prevBtn = document.createElement('button');
        prevBtn.innerText = '上一页';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => {
            if (currentPage > 1) {
                fetchLibraryPage(currentPage - 1);
                document.querySelector('.main-content').scrollTop = 0;
            }
        };
        
        const nextBtn = document.createElement('button');
        nextBtn.innerText = '下一页';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                fetchLibraryPage(currentPage + 1);
                document.querySelector('.main-content').scrollTop = 0;
            }
        };
        
        const info = document.createElement('span');
        info.innerText = `第 ${currentPage} / ${totalPages} 页`;
        
        paginationDiv.appendChild(prevBtn);
        paginationDiv.appendChild(info);
        paginationDiv.appendChild(nextBtn);
        
        container.appendChild(paginationDiv);
    }
}

let lyricsData = [];
let lyricsTimer = null;
let lastSaveTime = 0;
function savePlaybackState(force = false) {
    if (currentIndex === -1 || !playlist[currentIndex]) return;
    
    const now = Date.now();
    // Throttle saves to every 5 seconds unless forced
    if (!force && now - lastSaveTime < 5000) return;
    
    lastSaveTime = now;
    const song = playlist[currentIndex];
    
    lastPlaybackState = {
        path: song.path,
        position: audio.currentTime,
        timestamp: now
    };
    
    localStorage.setItem('musicwave_last_playback', JSON.stringify(lastPlaybackState));
    
    // Periodically sync to server (roughly every 30-60s)
    if (force || (now - lastSaveTime > 60000)) { 
        // We sync if forced or if 1 minute has passed since last save attempt
        // Note: we update lastSaveTime only after success or bypass to avoid retrying too fast
        saveSettings();
    }
}

function restoreLastPlayback() {
    if (!lastPlaybackState || !lastPlaybackState.path || playlist.length === 0) return;
    
    const index = playlist.findIndex(p => p.path === lastPlaybackState.path);
    if (index === -1) return;
    
    currentIndex = index;
    const song = playlist[index];
    
    // Update UI without playing
    document.getElementById('track-name').innerText = song.name;
    document.getElementById('track-artist').innerText = song.artist || 'Unknown Artist';
    
    const coverImg = document.getElementById('cover-art');
    const coverUrl = `${apiBase}?api_route=/api/music/cover&path=${encodeURIComponent(song.path)}&t=${Date.now()}`;
    coverImg.src = coverUrl;
    document.getElementById('lyrics-bg').style.backgroundImage = `url('${coverUrl}')`;
    
    // Highlight in list
    renderPlaylist();
    
    // Set source and prepare seek
    const streamUrl = `${apiBase}?api_route=/api/music/stream&path=${encodeURIComponent(song.path)}`;
    audio.src = streamUrl;
    
    // We can't seek until metadata is loaded
    isInitialRestore = true;
    
    // Update time displays manually before play
    if (lastPlaybackState.position) {
        // Need to wait for element to exist? No, they assume they are already there.
        const timeCurrent = document.getElementById('time-current');
        const seekBar = document.getElementById('seek-bar');
        if (timeCurrent) timeCurrent.innerText = formatTime(lastPlaybackState.position);
        if (seekBar) seekBar.value = lastPlaybackState.position;
    }
    
    fetchLyrics(song.path);
}

// Player Logic
function play(index) {
    if (index < 0 || index >= playlist.length) return;
    
    // Init Visualizer on first play
    initVisualizer();
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    currentIndex = index;
    const song = playlist[index];
    
    // Highlight active
    renderPlaylist();
    
    // Update Track Info
    document.getElementById('track-name').innerText = song.name;
    document.getElementById('track-artist').innerText = song.artist || 'Unknown Artist';
    
    // Update Cover
    const coverImg = document.getElementById('cover-art');
    // Add timestamp to prevent caching if cover changes for same path (unlikely but safe)
    const coverUrl = `${apiBase}?api_route=/api/music/cover&path=${encodeURIComponent(song.path)}&t=${Date.now()}`;
    coverImg.src = coverUrl;
    coverImg.onerror = () => {
        coverImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // transparent placeholder or default icon
        document.getElementById('lyrics-bg').style.backgroundImage = 'none';
    };
    
    // Update lyrics background
    document.getElementById('lyrics-bg').style.backgroundImage = `url('${coverUrl}')`;
    
    // Activate lyrics panel mode
    document.body.classList.add('lyrics-active');

    // Fetch Lyrics
    fetchLyrics(song.path);

    // Play
    const streamUrl = `${apiBase}?api_route=/api/music/stream&path=${encodeURIComponent(song.path)}`;
    
    // Only update src if it changed (optimization for resume)
    if (audio.src !== new URL(streamUrl, window.location.origin).href) {
        audio.src = streamUrl;
    }
    
    audio.play();
    updatePlayPauseIcon(true);
    
    // Save immediately on play
    savePlaybackState(true);
}

async function fetchLyrics(path) {
    lyricsData = [];
    // document.getElementById('track-lyrics').innerText = '';
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/lyrics&path=${encodeURIComponent(path)}`);
        if (res.ok) {
            const text = await res.text();
            parseLyrics(text);
        } else {
            // document.getElementById('track-lyrics').innerText = 'No lyrics found';
        }
    } catch (e) {
        console.error('Failed to fetch lyrics', e);
        // document.getElementById('track-lyrics').innerText = '';
    }
}

function parseLyrics(text) {
    const lines = text.split('\n');
    lyricsData = [];
    
    for (const line of lines) {
        let l = line.trim();
        const timestamps = [];
        
        // Extract all leading timestamps
        while (true) {
            // Match [mm:ss.xx] or [mm:ss] at the start
            const match = /^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/.exec(l);
            if (match) {
                const min = parseInt(match[1]);
                const sec = parseInt(match[2]);
                const msStr = match[3] || '00';
                const ms = parseInt(msStr.padEnd(3, '0'));
                const time = min * 60 + sec + ms / 1000;
                timestamps.push(time);
                
                // Remove this timestamp from the string
                l = l.substring(match[0].length);
            } else {
                break;
            }
        }
        
        if (timestamps.length > 0) {
            // Remove any remaining timestamps from the content (karaoke word-level timestamps)
            const content = l.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
            
            if (content) {
                timestamps.forEach(time => {
                    lyricsData.push({ time, text: content });
                });
            }
        }
    }
    
    // Sort by time
    lyricsData.sort((a, b) => a.time - b.time);
    
    if (lyricsData.length === 0) {
        document.getElementById('large-lyrics').innerHTML = `
            <div class="current-line" style="font-size:20px; color:#aaa;">音符自成诗行，邀您沉浸聆听</div>
        `;
    }
}

function updateLyricsDisplay() {
    if (lyricsData.length === 0) {
        document.getElementById('large-lyrics').innerHTML = `
            <div class="current-line" style="font-size:20px; color:#aaa;">音符自成诗行，邀您沉浸聆听</div>
        `;
        return;
    }
    
    const currentTime = audio.currentTime;
    // Find current line
    let currentLineIndex = -1;
    for (let i = 0; i < lyricsData.length; i++) {
        if (currentTime >= lyricsData[i].time) {
            currentLineIndex = i;
        } else {
            break;
        }
    }
    
    if (currentLineIndex !== -1) {
        const currentText = lyricsData[currentLineIndex].text;
        // document.getElementById('track-lyrics').innerText = currentText;
        
        // Update large lyrics
        const nextText = lyricsData[currentLineIndex + 1] ? lyricsData[currentLineIndex + 1].text : '';
        const largeContainer = document.getElementById('large-lyrics');
        // Only update if changed to avoid flickering/reflow (simple check)
        const newHTML = `
            <div class="current-line">${escapeHtml(currentText)}</div>
            <div class="next-line">${escapeHtml(nextText)}</div>
        `;
        if (largeContainer.innerHTML !== newHTML) {
             largeContainer.innerHTML = newHTML;
        }
    }
}

function togglePlay() {
    // Init Visualizer on play
    initVisualizer();
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }

    if (audio.paused) {
        audio.play();
        updatePlayPauseIcon(true);
    } else {
        audio.pause();
        updatePlayPauseIcon(false);
    }
}

function updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
        btnPlayPause.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6 19H10V5H6V19ZM14 5V19H18V5H14Z"></path></svg>';
    } else {
        btnPlayPause.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5.14V19.14L19 12.14L8 5.14Z"></path></svg>';
    }

}


function playNext() {
    if (playlist.length === 0) return;
    
    let nextIndex;
    if (isShuffle) {
        nextIndex = Math.floor(Math.random() * playlist.length);
    } else {
        nextIndex = currentIndex + 1;
        if (nextIndex >= playlist.length) nextIndex = 0; // Loop All
    }
    play(nextIndex);
}

function playPrev() {
    if (playlist.length === 0) return;
    
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) prevIndex = playlist.length - 1;
    play(prevIndex);
}

function playAll() {
    if (playlist.length > 0) play(0);
}

function shufflePlay() {
    isShuffle = !isShuffle; // Just toggle mode, or shuffle list?
    // User expects "Shuffle Play" button to start playing randomly
    isShuffle = true;
    playNext(); // Start a random song
}

function toggleLoop() {
    isLoopOne = !isLoopOne;
    const btn = document.getElementById('btn-loop');
    if (isLoopOne) {
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 7H17V10L21 6L17 2V5H5V11H7V7ZM17 17H7V14L3 18L7 22V19H19V13H17V17ZM13 15V9H11L10 10V11H11.5V15H13Z"></path></svg>';
        btn.style.color = 'var(--accent-color)';
        btn.title = "单曲循环";
    } else {
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 7H17V10L21 6L17 2V5H5V11H7V7ZM17 17H7V14L3 18L7 22V19H19V13H17V17Z"></path></svg>';
        btn.style.color = 'white';
        btn.title = "列表循环";
    }

}


// Visualizer Functions
function initVisualizer() {
    if (audioContext) return; // Already initialized

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        
        // Connect audio element
        const source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        
        analyser.fftSize = 256; // Increase for smoother curve
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        canvas = document.getElementById('visualizer');
        canvasCtx = canvas.getContext('2d');
        
        drawVisualizer();
    } catch (e) {
        console.error("Web Audio API not supported or error:", e);
    }
}

function drawVisualizer() {
    animationId = requestAnimationFrame(drawVisualizer);
    
    if (!document.body.classList.contains('lyrics-active') || !canvas) return;
    
    analyser.getByteFrequencyData(dataArray);
    
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    
    canvasCtx.clearRect(0, 0, width, height);
    
    const halfWidth = width / 2;
    const len = dataArray.length;
    if (!len) return;
    const sliceWidth = halfWidth / (len - 1);

    const points = [];
    for (let i = 0; i < len; i++) {
        const v = dataArray[i] / 255.0;
        const y = height - (v * height * 0.6);
        // Bass (i=0) at Left Edge, Treble (i=len) at Center
        const x = i * sliceWidth;
        points.push({ x, y });
    }

    canvasCtx.beginPath();
    canvasCtx.moveTo(0, height);

    // Draw Left Half: Left -> Center
    for (let i = 0; i < points.length; i++) {
        canvasCtx.lineTo(points[i].x, points[i].y);
    }

    // Draw Right Half: Center -> Right (Mirror)
    for (let i = points.length - 1; i >= 0; i--) {
        const x = width - points[i].x;
        canvasCtx.lineTo(x, points[i].y);
    }

    canvasCtx.lineTo(width, height);
    canvasCtx.closePath();
    
    const gradient = canvasCtx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.3)');
    
    canvasCtx.fillStyle = gradient;
    canvasCtx.fill();
    
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.stroke();
}

// Audio Events
function setupPlayerEvents() {
    audio.addEventListener('timeupdate', () => {
        const cur = audio.currentTime;
        const dur = audio.duration;
        
        if (!isNaN(dur)) {
            const progress = (cur / dur) * 100;
            // Only update seek bar if not dragging (omitted for simplicity, assume direct update)
            seekBar.value = cur;
            seekBar.max = dur;
            
            timeCurrent.innerText = formatTime(cur);
            timeTotal.innerText = formatTime(dur);
            updateRangeBackground(seekBar);
        }
        updateLyricsDisplay();
        savePlaybackState();
    });

    audio.addEventListener('loadedmetadata', () => {
        if (isInitialRestore && lastPlaybackState) {
            audio.currentTime = lastPlaybackState.position || 0;
            seekBar.max = audio.duration;
            seekBar.value = audio.currentTime;
            timeTotal.innerText = formatTime(audio.duration);
            updateRangeBackground(seekBar);
            isInitialRestore = false;
        }
    });

    audio.addEventListener('play', () => {
        savePlaybackState(true);
    });

    audio.addEventListener('pause', () => {
        savePlaybackState(true);
    });
    
    audio.addEventListener('ended', () => {
        if (isLoopOne) {
            audio.currentTime = 0;
            audio.play();
        } else {
            playNext();
        }
    });
    
    seekBar.addEventListener('input', () => {
        audio.currentTime = seekBar.value;
        updateRangeBackground(seekBar);
    });
    
    volumeBar.addEventListener('input', () => {
        audio.volume = volumeBar.value;
        updateRangeBackground(volumeBar);
        updateVolumeIcon(volumeBar.value);
    });
}

function updateVolumeIcon(value) {
    const container = document.getElementById('volume-icon-container');
    if (!container) return;
    
    let iconHtml = '';
    if (value == 0) {
        iconHtml = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
    } else if (value <= 0.5) {
        iconHtml = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
    } else {
        iconHtml = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
    }


    container.innerHTML = iconHtml;
}


function updateRangeBackground(el) {
    if (!el) return;
    const min = el.min || 0;
    const max = el.max || 100;
    const val = el.value;
    const percent = (val - min) / (max - min) * 100;
    el.style.setProperty('--progress', percent + '%');
}

function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// Directory Browser
function openDirBrowser() {
    document.getElementById('modal-browser').style.display = 'flex';
    loadBrowserPath('/');
}


async function loadBrowserPath(path) {
    browserCurrentPath = path;
    const container = document.getElementById('browser-list');
    container.innerHTML = '<div style="padding:10px;">Loading...</div>';
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/fs/list`, {
             method: 'POST',
             body: path
        });
        const data = await res.json();
        
        container.innerHTML = '';
        
        if (data.ok) {
            // Parent Link
            if (data.current !== '/') {
                 const div = document.createElement('div');
                 div.className = 'file-item';
                 div.innerHTML = '<i class="layui-icon layui-icon-return"></i> ..';
                 div.onclick = () => loadBrowserPath(data.parent);
                 container.appendChild(div);
            }
            
            // Directories
            if (data.dirs) {
                data.dirs.forEach(dir => {
                    const div = document.createElement('div');
                    div.className = 'file-item';
                    div.innerHTML = `<i class="layui-icon layui-icon-folder"></i> ${dir}`;
                    // Click to enter
                    div.onclick = () => loadBrowserPath(data.current === '/' ? `/${dir}` : `${data.current}/${dir}`);
                    
                    // Add Button (right aligned)
                    const btn = document.createElement('button');
                    btn.className = 'layui-btn layui-btn-xs layui-btn-normal';
                    btn.style.float = 'right';
                    btn.innerText = '选择';
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        selectDirectory(data.current === '/' ? `/${dir}` : `${data.current}/${dir}`);
                    };
                    div.appendChild(btn);
                    
                    container.appendChild(div);
                });
            }
        } else {
             container.innerHTML = `<div style="padding:10px; color:#FF5722;">Error: ${data.error || 'Unknown error'}</div>`;
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="padding:10px; color:#FF5722;">Error loading directory. (Network or JSON Parse Error)</div>';
    }
}

function selectDirectory(path) {
    const input = document.getElementById('manual-dir-input');
    if (input) {
        input.value = path;
    }
    closeModal('modal-browser');
}

// Playlists Logic
async function loadPlaylists() {
    const container = document.getElementById('playlist-list-container');
    const view = document.getElementById('selected-playlist-view');
    view.style.display = 'none';
    container.style.display = 'grid';
    container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px;">加载中...</div>';
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/playlist/list`);
        const data = await res.json();
        if (data.ok) {
            savedPlaylists = data.playlists || [];
            renderPlaylists();
        }
    } catch (e) {
        console.error('Failed to load playlists', e);
        container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px; color:#ff5722;">加载失败</div>';
    }
}

function renderPlaylists() {
    const container = document.getElementById('playlist-list-container');
    container.innerHTML = '';
    document.getElementById('playlist-status').innerText = `共 ${savedPlaylists.length} 个歌单`;

    if (savedPlaylists.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:50px; color:#666;">暂无歌单，点击上方“新建歌单”开始。</div>';
        return;
    }

    savedPlaylists.forEach(name => {
        const div = document.createElement('div');
        div.className = 'playlist-card';
        div.innerHTML = `
            <i class="layui-icon layui-icon-list"></i>
            <div class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        `;
        div.onclick = () => viewPlaylist(name);
        container.appendChild(div);
    });
}

async function viewPlaylist(name) {
    const container = document.getElementById('playlist-list-container');
    const view = document.getElementById('selected-playlist-view');
    container.style.display = 'none';
    view.style.display = 'flex';
    const mainToolbar = document.getElementById('playlist-main-toolbar');
    if (mainToolbar) mainToolbar.style.display = 'none';
    
    document.getElementById('current-playlist-name').innerText = name;
    const songsContainer = document.getElementById('playlist-songs-container');
    songsContainer.innerHTML = '<div style="text-align:center; padding:20px;">正在加载内容...</div>';
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/playlist/get&name=${encodeURIComponent(name)}`);
        currentPlaylist = await res.json();
        
        if (currentPlaylist && currentPlaylist.data) {
            renderPlaylistSongs(currentPlaylist.data);
        } else {
            songsContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#f44336;">无法获取歌单内容</div>';
        }
    } catch (e) {
        console.error(e);
        songsContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#f44336;">读取失败</div>';
    }
}

function backToPlaylistList() {
    document.getElementById('playlist-list-container').style.display = 'grid';
    document.getElementById('selected-playlist-view').style.display = 'none';
    const mainToolbar = document.getElementById('playlist-main-toolbar');
    if (mainToolbar) mainToolbar.style.display = 'flex';
}

function renderPlaylistSongs(data) {
    const container = document.getElementById('playlist-songs-container');
    container.innerHTML = '';
    
    data.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        
        // Find track info in allTracks if possible
        const track = allTracks.find(t => t.path === item.path);
        
        const title = track ? (track.title || track.name) : item.query;
        const artist = track ? (track.artist || 'Unknown Artist') : 'Unknown';
        const album = track ? (track.album || '--') : '--';
        const size = track ? formatSize(track.size) : '--';
        const duration = track ? formatTime(track.duration) : '--';
        
        div.innerHTML = `
            <div class="col-name" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="col-artist">${escapeHtml(artist)}</div>
            <div class="col-album">${escapeHtml(album)}</div>
            <div class="col-size">${size}</div>
            <div class="col-duration">${duration}</div>
        `;
        
        div.onclick = () => {
             // Play from here in the context of THIS playlist
             playPlaylistAt(index);
        };
        
        container.appendChild(div);
    });
}

function playPlaylistAt(startIndex) {
    if (!currentPlaylist || !currentPlaylist.data) return;
    
    // Construct new temporary playlist from matched paths
    const newPlaylist = [];
    currentPlaylist.data.forEach(item => {
        const track = allTracks.find(t => t.path === item.path);
        if (track) {
            newPlaylist.push(track);
        } else {
            // Placeholder for missing file
            newPlaylist.push({
                name: item.query,
                path: item.path,
                title: item.query + " (已丢失)"
            });
        }
    });
    
    playlist = newPlaylist;
    document.getElementById('library-status').innerText = `歌单播放中: ${currentPlaylist.name}`;
    play(startIndex);
}

function playCurrentPlaylist() {
    playPlaylistAt(0);
}

// Create Playlist Workflow
function openCreatePlaylistModal() {
    document.getElementById('modal-create-playlist').style.display = 'flex';
    document.getElementById('playlist-input-step').style.display = 'block';
    document.getElementById('playlist-match-step').style.display = 'none';
    document.getElementById('btn-next-step').style.display = 'inline-block';
    document.getElementById('btn-save-playlist').style.display = 'none';
    document.getElementById('playlist-raw-input').value = '';
    matchingResults = [];
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function processPlaylistInput() {
    const input = document.getElementById('playlist-raw-input').value;
    const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    if (lines.length === 0) {
        alert('请输入歌曲名称');
        return;
    }
    
    matchingResults = [];
    lines.forEach(query => {
        const match = matchSong(query);
        matchingResults.push({
            query: query,
            path: match ? match.path : null,
            track: match
        });
    });
    
    document.getElementById('playlist-input-step').style.display = 'none';
    document.getElementById('playlist-match-step').style.display = 'block';
    document.getElementById('btn-next-step').style.display = 'none';
    document.getElementById('btn-save-playlist').style.display = 'inline-block';
    
    renderMatchResults();
}

function matchSong(query) {
    const q = query.toLowerCase();
    // 1. Precise check: name or title exactly
    let match = allTracks.find(t => (t.name && t.name.toLowerCase() === q) || (t.title && t.title.toLowerCase() === q));
    if (match) return match;
    
    // 2. Contains check
    match = allTracks.find(t => (t.name && t.name.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)));
    return match || null;
}

function renderMatchResults() {
    const tbody = document.getElementById('match-results-body');
    tbody.innerHTML = '';
    
    matchingResults.forEach((res, index) => {
        const tr = document.createElement('tr');
        const songInfo = res.track ? `${res.track.title || res.track.name} - ${res.track.artist || 'Unknown'}` : '未找到匹配';
        const statusClass = res.track ? 'matched' : 'unmatched';
        const statusText = res.track ? '已匹配' : '无结果';
        
        tr.innerHTML = `
            <td>${escapeHtml(res.query)}</td>
            <td>
                <div class="match-status-cell">
                    <span class="match-status-tag ${statusClass}">${statusText}</span>
                    <span style="color: #aaa; font-size: 13px;">${escapeHtml(songInfo)}</span>
                </div>
            </td>
            <td>
                <button class="layui-btn layui-btn-xs layui-btn-primary" onclick="openSongPicker(${index})">切换</button>
                <button class="layui-btn layui-btn-xs layui-btn-danger" onclick="removeMatchRow(${index})">删除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function removeMatchRow(index) {
    matchingResults.splice(index, 1);
    renderMatchResults();
}

// Manual picker
function openSongPicker(index) {
    activeMatchingIndex = index;
    document.getElementById('modal-song-picker').style.display = 'flex';
    document.getElementById('song-picker-search').value = matchingResults[index].query;
    updatePickerResults(matchingResults[index].query);
    
    // Setup search listener
    document.getElementById('song-picker-search').oninput = (e) => {
        updatePickerResults(e.target.value);
    };
}

function updatePickerResults(query) {
    const container = document.getElementById('song-picker-list');
    const q = query.toLowerCase().trim();
    
    const results = allTracks.filter(t => 
        (t.name && t.name.toLowerCase().includes(q)) || 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q))
    ).slice(0, 50); // Limit results
    
    container.innerHTML = '';
    if (results.length === 0) {
        container.innerHTML = '<div style="padding:10px; color:#888;">无搜索结果</div>';
        return;
    }
    
    results.forEach(t => {
        const div = document.createElement('div');
        div.className = 'picker-item';
        div.innerHTML = `
            <div class="song-title">${escapeHtml(t.title || t.name)}</div>
            <div class="song-info">${escapeHtml(t.artist || 'Unknown Artist')} - ${escapeHtml(t.album || 'Unknown Album')}</div>
        `;
        div.onclick = () => {
            matchingResults[activeMatchingIndex].track = t;
            matchingResults[activeMatchingIndex].path = t.path;
            renderMatchResults();
            closeModal('modal-song-picker');
        };
        container.appendChild(div);
    });
}

function promptPlaylistName() {
    const validResults = matchingResults.filter(r => r.path);
    if (validResults.length === 0) {
        alert('歌单内没有有效的音乐匹配，请先匹配或选择音乐');
        return;
    }
    
    const name = prompt('请输入歌单名称：');
    if (!name) return;
    
    // Check duplicates
    if (savedPlaylists.includes(name)) {
        alert('歌单名称已存在，请使用其他名称');
        return;
    }
    
    savePlaylist(name, validResults);
}

async function savePlaylist(name, items) {
    const data = {
        name: name,
        data: items.map(it => ({ query: it.query, path: it.path }))
    };
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/playlist/save`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.ok) {
            alert('歌单保存成功');
            closeModal('modal-create-playlist');
            loadPlaylists();
        } else {
            alert('保存失败: ' + result.error);
        }
    } catch (e) {
        console.error(e);
        alert('服务器连接失败');
    }
}

function deletePlaylistPrompt() {
    if (!currentPlaylist) return;
    const name = currentPlaylist.name;
    if (confirm(`确认要删除歌单 "${name}" 吗？`)) {
        doDeletePlaylist(name);
    }
}

async function doDeletePlaylist(name) {
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/playlist/delete&name=${encodeURIComponent(name)}`);
        const data = await res.json();
        if (data.ok) {
            backToPlaylistList();
            loadPlaylists();
        } else {
            alert('删除失败: ' + data.error);
        }
    } catch (e) {
        console.error(e);
    }
}
