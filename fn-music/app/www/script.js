const API_BASE = 'api/music';
const audio = document.getElementById('audio-player');
const dirList = document.getElementById('dir-list');
const fileList = document.getElementById('file-list');
const playlistEl = document.getElementById('playlist');
const trackName = document.getElementById('track-name');
const timeDisplay = document.getElementById('time-display');
const seekBar = document.getElementById('seek-bar');
const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnMode = document.getElementById('btn-mode');
const btnUp = document.getElementById('btn-up');
const btnClear = document.getElementById('btn-clear');

let currentPath = '/';
let playlist = [];
let currentIndex = -1;
let isPlaying = false;
let playMode = 'loop'; // loop, random, single

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadDir(currentPath);
    
    // Check for file param in URL (from double click)
    const urlParams = new URLSearchParams(window.location.search);
    const fileParam = urlParams.get('file');
    if (fileParam) {
        // Add to playlist and play
        addToPlaylist(fileParam);
        play(playlist.length - 1);
    }
});

// Event Listeners
btnUp.addEventListener('click', () => {
    if (currentPath === '/') return;
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDir(parent);
});

btnPlay.addEventListener('click', togglePlay);
btnPrev.addEventListener('click', playPrev);
btnNext.addEventListener('click', playNext);
btnClear.addEventListener('click', () => {
    playlist = [];
    currentIndex = -1;
    renderPlaylist();
});

btnMode.addEventListener('click', () => {
    if (playMode === 'loop') {
        playMode = 'random';
        btnMode.textContent = '🔀';
        btnMode.title = 'Mode: Random';
    } else if (playMode === 'random') {
        playMode = 'single';
        btnMode.textContent = '🔂';
        btnMode.title = 'Mode: Single';
    } else {
        playMode = 'loop';
        btnMode.textContent = '🔁';
        btnMode.title = 'Mode: Loop';
    }
});

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        seekBar.value = percent;
        timeDisplay.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
    }
});

audio.addEventListener('ended', () => {
    if (playMode === 'single') {
        audio.currentTime = 0;
        audio.play();
    } else {
        playNext();
    }
});

seekBar.addEventListener('input', () => {
    if (audio.duration) {
        audio.currentTime = (seekBar.value / 100) * audio.duration;
    }
});

// API Functions
async function loadDir(path) {
    currentPath = path;
    try {
        // Load dirs
        const resDirs = await fetch(`${API_BASE}/dirs`, {
            method: 'POST',
            body: JSON.stringify({ path })
        }).then(r => r.json());

        // Load files
        const resFiles = await fetch(`${API_BASE}/list`, {
            method: 'POST',
            body: JSON.stringify({ path })
        }).then(r => r.json());

        renderBrowser(resDirs.dirs || [], resFiles.files || []);
    } catch (e) {
        console.error("Load failed", e);
    }
}

function renderBrowser(dirs, files) {
    dirList.innerHTML = '';
    fileList.innerHTML = '';

    dirs.forEach(d => {
        if (d.name === '..') return; // Handled by Up button
        const li = document.createElement('li');
        li.className = 'dir';
        li.textContent = '📁 ' + d.name;
        li.onclick = () => loadDir(d.path);
        dirList.appendChild(li);
    });

    files.forEach(f => {
        const li = document.createElement('li');
        li.className = 'file';
        li.textContent = '🎵 ' + f.name;
        li.onclick = () => addToPlaylist(f.path);
        fileList.appendChild(li);
    });
}

function addToPlaylist(path) {
    const name = path.split('/').pop();
    playlist.push({ name, path });
    renderPlaylist();
    if (playlist.length === 1) {
        play(0);
    }
}

function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlist.forEach((item, index) => {
        const li = document.createElement('li');
        li.textContent = (index + 1) + '. ' + item.name;
        if (index === currentIndex) li.className = 'active';
        li.onclick = () => play(index);
        playlistEl.appendChild(li);
    });
}

function play(index) {
    if (index < 0 || index >= playlist.length) return;
    
    currentIndex = index;
    const item = playlist[index];
    trackName.textContent = item.name;
    
    // Use relative path for stream
    const url = `${API_BASE}/stream?path=${encodeURIComponent(item.path)}`;
    audio.src = url;
    audio.play().then(() => {
        isPlaying = true;
        btnPlay.textContent = '⏸';
        renderPlaylist();
    }).catch(e => {
        console.error("Play error", e);
    });
}

function togglePlay() {
    if (audio.paused) {
        audio.play();
        isPlaying = true;
        btnPlay.textContent = '⏸';
    } else {
        audio.pause();
        isPlaying = false;
        btnPlay.textContent = '▶';
    }
}

function playPrev() {
    if (playlist.length === 0) return;
    let nextIndex = currentIndex - 1;
    if (nextIndex < 0) nextIndex = playlist.length - 1;
    play(nextIndex);
}

function playNext() {
    if (playlist.length === 0) return;
    let nextIndex;
    
    if (playMode === 'random') {
        nextIndex = Math.floor(Math.random() * playlist.length);
    } else {
        nextIndex = currentIndex + 1;
        if (nextIndex >= playlist.length) nextIndex = 0;
    }
    
    play(nextIndex);
}

function formatTime(seconds) {
    if (!seconds) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}
