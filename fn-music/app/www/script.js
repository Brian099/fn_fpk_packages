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
const apiBase = "/cgi/ThirdParty/waves/index.cgi";

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
            const savedDirs = localStorage.getItem('waves_dirs');
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
                 try {
                     const libRes = await fetch(`${apiBase}?api_route=/api/music/library/get`);
                     const libData = await libRes.json();
                     if (libData && libData.ok && libData.tracks) {
                         allTracks = libData.tracks;
                         playlist = [...allTracks];
                         document.getElementById('library-status').innerText = `共 ${playlist.length} 首歌曲`;
                         renderPlaylist();
                         
                         // Silent background sync to detect new/deleted files
                         rescanAll(true);
                     } else {
                         rescanAll();
                     }
                 } catch (e) {
                     rescanAll();
                 }
             }
        }
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

async function saveSettings() {
    // Keep localStorage as backup
    localStorage.setItem('waves_dirs', JSON.stringify(directories));
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
    
    // Create a map of existing tracks to preserve metadata
    const existingMap = new Map();
    allTracks.forEach(t => existingMap.set(t.path, t));
    
    let newAllTracks = [];
    
    for (const dir of directories) {
        try {
            // Use scan-fast instead of scan
            const res = await fetch(`${apiBase}?api_route=/api/music/scan-fast`, {
                method: 'POST',
                body: dir
            });
            const data = await res.json();
            if (data.ok && data.files) {
                // Merge: Use existing metadata if available, otherwise use new file info
                const merged = data.files.map(f => {
                    if (existingMap.has(f.path)) {
                        // Keep existing metadata
                        return existingMap.get(f.path);
                    }
                    return f;
                });
                newAllTracks = newAllTracks.concat(merged);
            }
        } catch (e) {
            console.error('Scan failed for', dir, e);
        }
    }
    
    // Check if anything changed
    const currentPaths = new Set(allTracks.map(t => t.path));
    const newPaths = new Set(newAllTracks.map(t => t.path));
    let hasChanges = false;
    
    if (currentPaths.size !== newPaths.size) {
        hasChanges = true;
    } else {
        for (const p of newPaths) {
            if (!currentPaths.has(p)) {
                hasChanges = true;
                break;
            }
        }
    }
    
    if (!hasChanges) {
        // Just update status and return
        if (!isSilent) {
            document.getElementById('library-status').innerText = `共 ${playlist.length} 首歌曲`;
        }
        return;
    }
    
    allTracks = newAllTracks;
    playlist = [...allTracks];
    
    // Reset to page 1 if not silent or if list was empty
    if (!isSilent || existingMap.size === 0) {
        currentPage = 1;
    }
    
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
    
    // Save to cache (even if partial)
    saveLibrary();
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
                // Find track in allTracks and update it
                // We need to update both allTracks and playlist objects (they reference same objects usually, but let's be safe)
                // Note: playlist is a shallow copy array of objects from allTracks. Modifying the object works for both.
                
                // However, if we filter/sort, we rely on references.
                // Let's find by path.
                const track = allTracks.find(t => t.path === meta.path);
                if (track) {
                    if (meta.error) {
                        // Mark as scanned but failed? Or just leave it.
                        // Maybe set a flag so we don't retry immediately?
                        track._scanned = true; 
                    } else {
                        Object.assign(track, meta);
                        track._scanned = true;
                        updatedCount++;
                    }
                }
            });
            
            if (updatedCount > 0) {
                // Refresh current view to show new metadata
                // We only need to re-render if we are still looking at these tracks
                renderPlaylist(); // This might be too aggressive if user is scrolling?
                // But since we batch per page, it should be fine.
                saveLibrary();
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
    
    // Reset to page 1 on search
    currentPage = 1;
    
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
    
    // Pagination Logic
    const totalPages = Math.ceil(playlist.length / ITEMS_PER_PAGE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, playlist.length);
    
    const pageItems = playlist.slice(startIndex, endIndex);
    
    // Check for missing metadata
    const missingMeta = pageItems.filter(s => !s.duration && !s._scanned);
    if (missingMeta.length > 0) {
        // Mark as pending to avoid duplicate requests
        missingMeta.forEach(s => s._scanned = 'pending');
        // Fetch in background
        fetchMetadataBatch(missingMeta);
    }

    container.innerHTML = '';
    
    // Render Items
    pageItems.forEach((song, i) => {
        const index = startIndex + i;
        const div = document.createElement('div');
        div.className = 'playlist-item' + (index === currentIndex ? ' active' : '');
        div.onclick = (e) => {
            // Prevent play if clicking on a link
            if (e.target.tagName === 'A' || e.target.closest('a')) return;
            play(index);
        };
        
        const title = song.title || song.name;
        // Show "Loading..." if not scanned yet
        const artist = song.artist || (song._scanned ? 'Unknown Artist' : 'Loading...');
        const album = song.album || (song._scanned ? 'Unknown Album' : 'Loading...');
        const duration = song.duration ? formatTime(song.duration) : (song._scanned ? '--:--' : 'Loading...');
        const size = song.size ? formatSize(song.size) : (song._scanned ? '' : '');
        
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
                currentPage--;
                renderPlaylist();
                // Scroll to top of list
                document.querySelector('.main-content').scrollTop = 0;
            }
        };
        
        const nextBtn = document.createElement('button');
        nextBtn.innerText = '下一页';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderPlaylist();
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
    audio.src = streamUrl;
    audio.play();
    updatePlayPauseIcon(true);
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
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.4)');
    
    canvasCtx.fillStyle = gradient;
    canvasCtx.fill();
    
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
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
