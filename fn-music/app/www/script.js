// State
let playlist = [];
let directories = [];
let currentIndex = -1;
let isShuffle = false;
let isLoop = false; // true = loop one, false = loop all (default) or no loop?
// Requirement: "Cycle or Random". Let's assume Loop All is default behavior for a playlist.
// "Loop" button usually toggles Loop All / Loop One / No Loop.
// For simplicity: Loop All (default) vs Shuffle.
// Let's make the loop button toggle "Loop One" (Repeat Track).
let isLoopOne = false;

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
        // Create a temporary playlist with just this file
        // Or better: add its directory to library? No, just play it.
        const name = targetFile.split('/').pop();
        playlist = [{
            name: name,
            path: targetFile
        }];
        renderPlaylist();
        play(0);
    } else {
        // Normal mode
        if (directories.length > 0) {
            rescanAll();
        }
    }
};

function loadSettings() {
    const savedDirs = localStorage.getItem('fn_music_dirs');
    if (savedDirs) {
        directories = JSON.parse(savedDirs);
        renderDirList();
    }
}

function saveSettings() {
    localStorage.setItem('fn_music_dirs', JSON.stringify(directories));
    renderDirList();
}

// Navigation
function showSection(id) {
    document.querySelectorAll('.section').forEach(el => el.style.display = 'none');
    document.getElementById('section-' + id).style.display = 'flex';
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    
    if (id === 'library') {
        document.querySelector('.menu-item:nth-child(2)').classList.add('active');
    } else {
        document.querySelector('.menu-item:nth-child(3)').classList.add('active');
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

async function rescanAll() {
    document.getElementById('library-status').innerText = '正在扫描...';
    playlist = [];
    
    for (const dir of directories) {
        try {
            const res = await fetch(`/index.cgi/api/music/scan`, {
                method: 'POST',
                body: dir
            });
            const data = await res.json();
            if (data.ok && data.files) {
                playlist = playlist.concat(data.files);
            }
        } catch (e) {
            console.error('Scan failed for', dir, e);
        }
    }
    
    document.getElementById('library-status').innerText = `共 ${playlist.length} 首歌曲`;
    renderPlaylist();
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
        div.className = 'song-item' + (index === currentIndex ? ' active' : '');
        div.onclick = () => play(index);
        div.innerHTML = `
            <span>${index + 1}. ${song.name}</span>
            <span style="font-size:12px; color:#666;">${song.path}</span>
        `;
        container.appendChild(div);
    });
}

// Player Logic
function play(index) {
    if (index < 0 || index >= playlist.length) return;
    
    currentIndex = index;
    const song = playlist[index];
    
    // Highlight active
    renderPlaylist();
    
    // Play
    const streamUrl = `/index.cgi/api/music/stream?path=${encodeURIComponent(song.path)}`;
    audio.src = streamUrl;
    audio.play();
    updatePlayPauseIcon(true);
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
        const res = await fetch(`/index.cgi/api/fs/list`, {
             method: 'POST',
             headers: {'Content-Type': 'application/x-www-form-urlencoded'},
             body: `path=${encodeURIComponent(path)}`
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
            
            data.dirs.forEach(d => {
                 const div = document.createElement('div');
                 div.className = 'file-item';
                 div.innerHTML = `<i class="layui-icon layui-icon-folder"></i> ${d}`;
                 div.onclick = () => {
                     // Click to enter, or Select?
                     // Standard browser: click to enter.
                     // How to select "Current Dir"?
                     // Let's assume clicking a folder enters it.
                     // To select a folder, you navigate INTO it (or parent of it).
                     // Requirement: "Select a Directory".
                     // Usually: Navigate to target, click "OK" means "Add Current Path".
                     // Or: Select a folder item (highlight it).
                     // Let's do: Single click selects (highlight), Double click enters.
                     selectBrowserItem(div, d);
                 };
                 div.ondblclick = () => {
                     const newPath = data.current === '/' ? '/' + d : data.current + '/' + d;
                     loadBrowserPath(newPath);
                 };
                 container.appendChild(div);
            });
            
            // Update selected path display to current path by default
            selectBrowserItem(null, null); // Clear selection
        } else {
            // Handle error from backend
            container.innerHTML = `<div style="padding:10px; color:#FF5722;">Error: ${data.error || 'Unknown error'}</div>`;
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="padding:10px; color:#FF5722;">Error loading directory. (Network or JSON Parse Error)</div>';
    }
}

function selectBrowserItem(el, dirName) {
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('selected'));
    if (el) {
        el.classList.add('selected');
        const fullPath = browserCurrentPath === '/' ? '/' + dirName : browserCurrentPath + '/' + dirName;
        browserSelectedPath = fullPath;
    } else {
        // If nothing selected, maybe default to current path?
        browserSelectedPath = browserCurrentPath;
    }
    document.getElementById('selected-path-display').innerText = browserSelectedPath;
}

function confirmDirSelection() {
    if (browserSelectedPath) {
        if (!directories.includes(browserSelectedPath)) {
            directories.push(browserSelectedPath);
            saveSettings();
            rescanAll(); // Auto rescan
        }
        closeModal();
    }
}
