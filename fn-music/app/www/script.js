// State
let allTracks = []; // Store all scanned tracks
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

// API Base Path (Matches installation path)
const apiBase = "/cgi/ThirdParty/fn-music/index.cgi";

let browserCurrentPath = "/";
let browserSelectedPath = "";

// Elements
const audio = document.getElementById('audio-player');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const btnPlayPause = document.getElementById('btn-play-pause');

// Initialization
window.onload = function() {
    loadSettings();
    setupPlayerEvents();
    
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
            const savedDirs = localStorage.getItem('fn_music_dirs');
            if (savedDirs) {
                directories = JSON.parse(savedDirs);
                // Migrate to server
                saveSettings();
            }
        }
        
        renderDirList();
        
        // Auto scan if not direct play mode
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.get('file') && !urlParams.get('path')) {
             if (directories.length > 0) {
                 rescanAll();
             }
        }
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

async function saveSettings() {
    // Keep localStorage as backup
    localStorage.setItem('fn_music_dirs', JSON.stringify(directories));
    renderDirList();
    
    try {
        const config = { dirs: directories };
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
    document.getElementById('section-' + id).style.display = 'flex';
    
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(el => el.classList.remove('active'));
    
    if (id === 'library') {
        menuItems[0].classList.add('active');
    } else if (id === 'artists') {
        menuItems[1].classList.add('active');
        renderArtists();
    } else if (id === 'settings') {
        menuItems[2].classList.add('active');
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

function renderArtists() {
    const container = document.getElementById('artists-container');
    
    // Group by artist
    const artists = {};
    allTracks.forEach(track => {
        const name = track.artist || 'Unknown Artist';
        if (!artists[name]) {
            artists[name] = 0;
        }
        artists[name]++;
    });
    
    // Sort
    const sortedArtists = Object.keys(artists).sort((a, b) => {
        if (a === 'Unknown Artist') return 1;
        if (b === 'Unknown Artist') return -1;
        return a.localeCompare(b, 'zh-CN');
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
    
    sortedArtists.forEach((name, index) => {
        const count = artists[name];
        const div = document.createElement('div');
        div.className = 'artist-card';
        
        const safeName = escapeHtml(name);
        const imgId = 'artist-img-' + index;
        
        div.innerHTML = `
            <div class="artist-icon">
                <i class="layui-icon layui-icon-username" id="${imgId}-icon"></i>
                <img id="${imgId}" style="display:none; width:100%; height:100%; object-fit:cover; border-radius:50%;" alt="${safeName}" />
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

async function rescanAll() {
    document.getElementById('library-status').innerText = '正在扫描...';
    allTracks = [];
    
    for (const dir of directories) {
        try {
            const res = await fetch(`${apiBase}?api_route=/api/music/scan`, {
                method: 'POST',
                body: dir
            });
            const data = await res.json();
            if (data.ok && data.files) {
                allTracks = allTracks.concat(data.files);
            }
        } catch (e) {
            console.error('Scan failed for', dir, e);
        }
    }
    
    playlist = [...allTracks];
    // Re-apply search filter if any
    const searchInput = document.getElementById('search-input');
    if (searchInput && searchInput.value) {
        onSearchInput(searchInput.value);
    } else {
        document.getElementById('library-status').innerText = `共 ${playlist.length} 首歌曲`;
        renderPlaylist();
    }
    
    // Refresh artists view if active
    if (document.getElementById('section-artists').style.display === 'flex') {
        renderArtists();
    }
}

function onSearchInput(query) {
    const term = query.toLowerCase().trim();
    
    // Store current playing song info before filtering
    let currentSongPath = null;
    if (currentIndex >= 0 && currentIndex < playlist.length) {
        currentSongPath = playlist[currentIndex].path;
    }
    
    if (!term) {
        playlist = [...allTracks];
    } else {
        playlist = allTracks.filter(song => 
            (song.name && song.name.toLowerCase().includes(term)) || 
            (song.path && song.path.toLowerCase().includes(term)) ||
            (song.title && song.title.toLowerCase().includes(term)) ||
            (song.artist && song.artist.toLowerCase().includes(term)) ||
            (song.album && song.album.toLowerCase().includes(term))
        );
    }
    
    // Update currentIndex to match the new playlist
    if (currentSongPath) {
        currentIndex = playlist.findIndex(p => p.path === currentSongPath);
        // If not found in filtered list, currentIndex becomes -1, which stops playback flow effectively
    } else {
        currentIndex = -1;
    }
    
    document.getElementById('library-status').innerText = `共 ${playlist.length} 首歌曲`;
    renderPlaylist();
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

function filterBy(field, value) {
    const searchInput = document.getElementById('search-input');
    searchInput.value = value;
    onSearchInput(value);
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
    if (playlist.length === 0) {
        container.innerHTML = '<div style="text-align:center; margin-top: 50px; color: #666;">暂无音乐，请去“管理目录”添加文件夹。</div>';
        return;
    }
    
    container.innerHTML = '';
    playlist.forEach((song, index) => {
        const div = document.createElement('div');
        div.className = 'playlist-item' + (index === currentIndex ? ' active' : '');
        div.onclick = (e) => {
            // Prevent play if clicking on a link
            if (e.target.tagName === 'A' || e.target.closest('a')) return;
            play(index);
        };
        
        const title = song.title || song.name;
        const artist = song.artist || 'Unknown Artist';
        const album = song.album || 'Unknown Album';
        const duration = formatTime(song.duration);
        const size = formatSize(song.size);
        
        const safeTitle = escapeHtml(title);
        const safeArtist = escapeHtml(artist);
        const safeAlbum = escapeHtml(album);
        
        const jsArtist = escapeJs(artist);
        const jsAlbum = escapeJs(album);
        
        div.innerHTML = `
            <div class="col-name" title="${safeTitle}">${safeTitle}</div>
            <div class="col-artist" title="${safeArtist}">
                <a href="#" class="clickable-link" onclick="event.preventDefault(); filterBy('artist', '${jsArtist}')">${safeArtist}</a>
            </div>
            <div class="col-album" title="${safeAlbum}">
                <a href="#" class="clickable-link" onclick="event.preventDefault(); filterBy('album', '${jsAlbum}')">${safeAlbum}</a>
            </div>
            <div class="col-size">${size}</div>
            <div class="col-duration">${duration}</div>
        `;
        container.appendChild(div);
    });
}

let lyricsData = [];
let lyricsTimer = null;

// Player Logic
function play(index) {
    if (index < 0 || index >= playlist.length) return;
    
    currentIndex = index;
    const song = playlist[index];
    
    // Highlight active
    renderPlaylist();
    
    // Update Track Info
    document.getElementById('track-name').innerText = song.name;
    document.getElementById('track-lyrics').innerText = 'Loading lyrics...';
    
    // Update Cover
    const coverImg = document.getElementById('cover-art');
    // Add timestamp to prevent caching if cover changes for same path (unlikely but safe)
    coverImg.src = `${apiBase}?api_route=/api/music/cover&path=${encodeURIComponent(song.path)}&t=${Date.now()}`;
    coverImg.onerror = () => {
        coverImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // transparent placeholder or default icon
    };

    // Fetch Lyrics
    fetchLyrics(song.path);

    // Play
    const streamUrl = `${apiBase}?api_route=/api/music/stream&path=${encodeURIComponent(song.path)}`;
    audio.src = streamUrl;
    audio.play();
    updatePlayPauseIcon(true);
}

async function fetchLyrics(path) {
    lyricsData = [];
    document.getElementById('track-lyrics').innerText = '';
    
    try {
        const res = await fetch(`${apiBase}?api_route=/api/music/lyrics&path=${encodeURIComponent(path)}`);
        if (res.ok) {
            const text = await res.text();
            parseLyrics(text);
        } else {
            document.getElementById('track-lyrics').innerText = 'No lyrics found';
        }
    } catch (e) {
        console.error('Failed to fetch lyrics', e);
        document.getElementById('track-lyrics').innerText = '';
    }
}

function parseLyrics(text) {
    const lines = text.split('\n');
    const regex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    
    lyricsData = [];
    
    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            const min = parseInt(match[1]);
            const sec = parseInt(match[2]);
            const ms = parseInt(match[3].padEnd(3, '0')); // Handle 2 or 3 digit ms
            const time = min * 60 + sec + ms / 1000;
            const text = match[4].trim();
            if (text) {
                lyricsData.push({ time, text });
            }
        }
    }
    
    if (lyricsData.length === 0) {
        document.getElementById('track-lyrics').innerText = 'No lyrics available';
    }
}

function updateLyricsDisplay() {
    if (lyricsData.length === 0) return;
    
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
        document.getElementById('track-lyrics').innerText = lyricsData[currentLineIndex].text;
    }
}

function togglePlay() {
    if (audio.paused) {
        audio.play();
        updatePlayPauseIcon(true);
    } else {
        audio.pause();
        updatePlayPauseIcon(false);
    }
}

function updatePlayPauseIcon(isPlaying) {
    const icon = btnPlayPause.querySelector('i');
    if (isPlaying) {
        icon.className = 'layui-icon layui-icon-pause';
    } else {
        icon.className = 'layui-icon layui-icon-play';
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
        btn.style.color = 'var(--accent-color)';
        btn.title = "单曲循环";
    } else {
        btn.style.color = 'white';
        btn.title = "列表循环";
    }
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
        }
        updateLyricsDisplay();
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
    });
    
    volumeBar.addEventListener('input', () => {
        audio.volume = volumeBar.value;
    });
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

function closeModal() {
    document.getElementById('modal-browser').style.display = 'none';
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
                    btn.innerText = 'Select';
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        addDirectory(data.current === '/' ? `/${dir}` : `${data.current}/${dir}`);
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

function addDirectory(path) {
    if (!directories.includes(path)) {
        directories.push(path);
        saveSettings();
        rescanAll();
    }
    closeModal();
}


