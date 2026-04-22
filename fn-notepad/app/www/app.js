// Initialize Lucide icons
lucide.createIcons();

let notes = [];
let currentEditingId = null;
let selectedColor = 'yellow';
let isPinned = false;
let currentFilter = 'all';
let currentLang = localStorage.getItem('fn_notepad_lang') || 'zh';
let isBatchMode = false;
let selectedNotes = new Set();
let lastSelectedId = null;

// Pagination state
let serverOffset = 0;
let hasMoreOnServer = true;
let isFetching = false;
const PAGE_SIZE = 5;

const translations = {
    zh: {
        nav_all: '全部便签',
        nav_pinned: '已置顶',
        nav_reminder: '提醒事项',
        nav_timeline: '时间轴',
        nav_settings: '设置',
        settings_title: '设置',
        language_title: '语言设置 (Language)',
        backup_title: '数据管理',
        backup_desc: '您可以手动导出所有便签数据进行备份，或从备份文件中恢复。',
        btn_export: '导出数据',
        btn_import: '恢复数据',
        btn_batch: '批量选择',
        btn_delete_selected: '删除所选',
        confirm_batch_delete: '确定要删除选中的便签吗？',
        modal_placeholder_title: '标题',
        modal_placeholder_content: '开始记录... (支持 Markdown)',
        modal_btn_cancel: '取消',
        modal_btn_save: '保存',
        confirm_delete: '确定要删除这条便签吗？',
        import_success: '数据恢复成功！',
        import_error: '导入失败，请确保文件格式正确。',
        no_title: '无标题',
        select_all: '全选',
        deselect_all: '取消全选'
    },
    en: {
        nav_all: 'All Notes',
        nav_pinned: 'Pinned',
        nav_reminder: 'Reminders',
        nav_timeline: 'Timeline',
        nav_settings: 'Settings',
        settings_title: 'Settings',
        language_title: 'Language Settings',
        backup_title: 'Data Management',
        backup_desc: 'You can manually export all note data for backup, or restore from a backup file.',
        btn_export: 'Export Data',
        btn_import: 'Restore Data',
        btn_batch: 'Batch Select',
        btn_delete_selected: 'Delete Selected',
        confirm_batch_delete: 'Are you sure you want to delete the selected notes?',
        modal_placeholder_title: 'Title',
        modal_placeholder_content: 'Start recording... (Markdown supported)',
        modal_btn_cancel: 'Cancel',
        modal_btn_save: 'Save',
        confirm_delete: 'Are you sure you want to delete this note?',
        import_success: 'Data restored successfully!',
        import_error: 'Import failed, please ensure the file format is correct.',
        no_title: 'No Title',
        select_all: 'Select All',
        deselect_all: 'Deselect All'
    }
};

const notesGrid = document.getElementById('notesGrid');
const settingsPanel = document.getElementById('settingsPanel');
const addNoteBtn = document.getElementById('addNoteBtn');
const noteModal = document.getElementById('noteModal');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const modalReminder = document.getElementById('modalReminder');
const modalPin = document.getElementById('modalPin');
const searchInput = document.getElementById('searchInput');

// Batch Mode Logic
window.toggleBatchMode = () => {
    isBatchMode = !isBatchMode;
    selectedNotes.clear();
    lastSelectedId = null;
    
    const selectionBar = document.getElementById('selectionBar');
    const addNoteBtn = document.getElementById('addNoteBtn');
    
    if (isBatchMode) {
        selectionBar.classList.add('active');
        if (addNoteBtn) addNoteBtn.style.display = 'none';
        notesGrid.classList.add('batch-mode');
    } else {
        selectionBar.classList.remove('active');
        if (addNoteBtn) addNoteBtn.style.display = 'flex';
        notesGrid.classList.remove('batch-mode');
    }
    updateSelectionUI();
    renderNotesDisplay();
};

window.toggleSelectAll = () => {
    if (!isBatchMode) return;
    
    const visibleNoteIds = notes.map(n => n.id);
    const allSelected = visibleNoteIds.every(id => selectedNotes.has(id));
    
    if (allSelected) {
        selectedNotes.clear();
    } else {
        visibleNoteIds.forEach(id => selectedNotes.add(id));
    }
    
    updateSelectionUI();
    renderNotesDisplay();
};

function updateSelectionUI() {
    const selectAllText = document.getElementById('selectAllText');
    const selectionCountText = document.getElementById('selectionCountText');
    
    if (selectAllText) {
        const visibleNoteIds = notes.map(n => n.id);
        const allSelected = visibleNoteIds.length > 0 && visibleNoteIds.every(id => selectedNotes.has(id));
        selectAllText.textContent = allSelected ? translations[currentLang].deselect_all : translations[currentLang].select_all;
    }
    
    if (selectionCountText) {
        selectionCountText.textContent = `已选中 ${selectedNotes.size} 项`;
    }
}

window.toggleNoteSelection = (e, id) => {
    if (!isBatchMode) return;
    e.stopPropagation();
    
    if (e.shiftKey && lastSelectedId !== null) {
        const noteIds = notes.map(n => n.id);
        const startIdx = noteIds.indexOf(lastSelectedId);
        const endIdx = noteIds.indexOf(id);
        
        if (startIdx !== -1 && endIdx !== -1) {
            const [min, max] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
            const shouldAdd = !selectedNotes.has(id);
            
            for (let i = min; i <= max; i++) {
                if (shouldAdd) {
                    selectedNotes.add(noteIds[i]);
                } else {
                    selectedNotes.delete(noteIds[i]);
                }
            }
        }
    } else {
        if (selectedNotes.has(id)) {
            selectedNotes.delete(id);
        } else {
            selectedNotes.add(id);
        }
    }
    
    lastSelectedId = id;
    updateSelectionUI();
    renderNotesDisplay();
};

window.deleteSelected = async () => {
    if (selectedNotes.size === 0) return;
    if (confirm(translations[currentLang].confirm_batch_delete)) {
        const ids = Array.from(selectedNotes);
        try {
            const response = await fetch('api/batch-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ids)
            });
            if (response.ok) {
                notes = notes.filter(n => !selectedNotes.has(n.id));
                window.toggleBatchMode();
                renderNotesDisplay();
            }
        } catch (e) {
            console.error('Batch delete failed:', e);
        }
    }
};

window.deleteSingleNote = async (e, id) => {
    e.stopPropagation();
    if (confirm(translations[currentLang].confirm_delete)) {
        try {
            const response = await fetch(`api/delete-note?id=${id}`);
            if (response.ok) {
                notes = notes.filter(n => n.id !== id);
                renderNotesDisplay();
            }
        } catch (e) {
            console.error('Delete failed:', e);
        }
    }
};

// i18n
function changeLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('fn_notepad_lang', lang);
    applyTranslations();
}

function applyTranslations() {
    const t = translations[currentLang];
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = t[key];
            } else {
                el.textContent = t[key];
            }
        }
    });
    const langSelect = document.getElementById('langSelect');
    if (langSelect) langSelect.value = currentLang;
    renderNotesDisplay();
}

// Data Management
async function exportNotes() {
    try {
        const response = await fetch('api/export-notes');
        if (response.ok) {
            const notesData = await response.json();
            const dataStr = JSON.stringify(notesData, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            const exportFileDefaultName = `fn_notepad_backup_${new Date().toISOString().split('T')[0]}.json`;
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
        }
    } catch (e) {
        console.error('Export failed:', e);
    }
}

function importNotes(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedNotes = JSON.parse(e.target.result);
            if (Array.isArray(importedNotes)) {
                const response = await fetch('api/save-notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(importedNotes)
                });
                if (response.ok) {
                    refreshNotes();
                    alert(translations[currentLang].import_success);
                }
            }
        } catch (err) {
            alert(translations[currentLang].import_error);
        }
    };
    reader.readAsText(file);
}

// Toggle Pin in Modal
window.togglePin = () => {
    isPinned = !isPinned;
    updateModalPin();
};

function updateModalPin() {
    const currentModalPin = document.getElementById('modalPin');
    if (currentModalPin) {
        currentModalPin.style.opacity = isPinned ? '1' : '0.3';
        currentModalPin.style.color = isPinned ? 'var(--primary-color)' : 'var(--text-color)';
    }
}

// Render Notes
let lastRenderedDate = null;

function filterNotes(type, e) {
    if (e) e.stopPropagation();
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (e) e.currentTarget.classList.add('active');
    
    currentFilter = type;
    refreshNotes();
    
    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.remove('expanded');
    }
}

async function refreshNotes() {
    serverOffset = 0;
    hasMoreOnServer = true;
    notes = [];
    notesGrid.innerHTML = '';
    
    if (currentFilter === 'settings') {
        notesGrid.style.display = 'none';
        settingsPanel.style.display = 'flex';
        settingsPanel.style.flexDirection = 'column';
        addNoteBtn.style.display = 'none';
        return;
    } else {
        notesGrid.style.display = 'grid';
        settingsPanel.style.display = 'none';
        if (!isBatchMode) addNoteBtn.style.display = 'flex';
    }

    await loadMoreNotes();
}

function renderNotes(notesToRender, append = false) {
    if (!append) {
        notesGrid.innerHTML = '';
        lastRenderedDate = null;
    }
    
    const fragment = document.createDocumentFragment();
    
    notesToRender.forEach(note => {
        if (currentFilter === 'calendar') {
            const dateObj = new Date(note.updatedAt);
            const date = dateObj.toLocaleDateString();
            if (date !== lastRenderedDate) {
                const section = document.createElement('div');
                section.className = 'timeline-header';
                section.style.gridColumn = '1 / -1';
                section.style.margin = '20px 0 10px 0';
                section.style.padding = '10px 15px';
                section.style.background = 'var(--card-bg)';
                section.style.backdropFilter = 'var(--blur)';
                section.style.border = '1px solid var(--glass-border)';
                section.style.borderRadius = '12px';
                section.style.fontSize = '14px';
                section.style.fontWeight = 'bold';
                section.style.display = 'flex';
                section.style.justifyContent = 'space-between';
                section.style.alignItems = 'center';
                section.style.cursor = isBatchMode ? 'pointer' : 'default';
                
                const notesInGroup = notes.filter(n => new Date(n.updatedAt).toLocaleDateString() === date);
                const allSelected = notesInGroup.length > 0 && notesInGroup.every(n => selectedNotes.has(n.id));
                
                let headerContent = `<span>${date}</span>`;
                if (isBatchMode) {
                    const icon = allSelected ? 'check-circle' : 'circle';
                    const iconColor = allSelected ? 'var(--primary-color)' : 'var(--text-color)';
                    const opacity = allSelected ? '1' : '0.3';
                    headerContent += `<div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:12px; opacity:0.5; font-weight:normal;">全选该日</span>
                        <i data-lucide="${icon}" style="width:20px; height:20px; color:${iconColor}; opacity:${opacity};"></i>
                    </div>`;
                }
                section.innerHTML = headerContent;
                
                if (isBatchMode) {
                    section.onclick = (e) => {
                        e.stopPropagation();
                        toggleGroupSelection(date);
                    };
                }
                
                fragment.appendChild(section);
                lastRenderedDate = date;
            }
        }
        fragment.appendChild(createNoteCard(note));
    });
    
    notesGrid.appendChild(fragment);
    lucide.createIcons();
}

function toggleGroupSelection(dateStr) {
    const notesInGroup = notes.filter(n => new Date(n.updatedAt).toLocaleDateString() === dateStr);
    const allSelected = notesInGroup.every(n => selectedNotes.has(n.id));
    
    if (allSelected) {
        notesInGroup.forEach(n => selectedNotes.delete(n.id));
    } else {
        notesInGroup.forEach(n => selectedNotes.add(n.id));
    }
    
    updateSelectionUI();
    renderNotesDisplay();
}

function renderNotesDisplay() {
    renderNotes(notes, false);
}

function createNoteCard(note) {
    const card = document.createElement('div');
    card.className = `note-card color-${note.color} ${selectedNotes.has(note.id) ? 'selected' : ''}`;
    card.dataset.id = note.id;
    
    card.onclick = (e) => {
        if (isBatchMode) {
            window.toggleNoteSelection(e, note.id);
        } else {
            editNote(note.id);
        }
    };
    
    let checkboxHtml = '';
    if (isBatchMode) {
        checkboxHtml = `
            <div class="checkbox-wrapper" style="position:absolute; top:10px; right:10px; z-index:2;">
                ${selectedNotes.has(note.id) ? '<i data-lucide="check-circle" style="color:var(--primary-color);"></i>' : '<i data-lucide="circle" style="color:var(--text-color); opacity:0.5;"></i>'}
            </div>
        `;
    }

    // Use marked for content rendering if available
    const rawContent = note.content;
    const renderedContent = typeof marked !== 'undefined' ? marked.parse(rawContent) : rawContent.replace(/\n/g, '<br>');

    card.innerHTML = `
        ${checkboxHtml}
        <div class="note-title" title="${(note.title || translations[currentLang].no_title).replace(/"/g, '&quot;')}">${note.title || translations[currentLang].no_title}</div>
        <div class="note-content markdown-body" title="${rawContent.replace(/"/g, '&quot;')}">${renderedContent}</div>
        <div class="note-footer">
            <div style="display:flex; flex-direction:column; gap:4px;">
                <span>${new Date(note.updatedAt).toLocaleDateString()}</span>
                ${note.reminder ? `<span style="color:#d32f2f;"><i data-lucide="bell" style="width:10px; height:10px; display:inline-block; vertical-align:middle;"></i> ${new Date(note.reminder).toLocaleString()}</span>` : ''}
            </div>
            <div style="display:flex; gap: 8px; align-items:center;">
                ${note.pinned ? '<i data-lucide="pin" style="width:14px; height:14px; color:var(--primary-color);"></i>' : ''}
                ${!isBatchMode ? `<i data-lucide="trash-2" class="delete-icon" style="width:14px; height:14px; color:#d32f2f; cursor:pointer;" onclick="window.deleteSingleNote(event, ${note.id})"></i>` : ''}
            </div>
        </div>
    `;
    card.style.position = 'relative';
    return card;
}

async function loadMoreNotes() {
    if (isFetching || !hasMoreOnServer) return;
    isFetching = true;

    const query = searchInput.value;
    const url = `api/get-notes?offset=${serverOffset}&limit=${PAGE_SIZE}&query=${encodeURIComponent(query)}&filter=${currentFilter}`;

    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
                if (data.length < PAGE_SIZE) {
                    hasMoreOnServer = false;
                }
                notes = [...notes, ...data];
                serverOffset += data.length;
                renderNotes(data, true);
                
                // Auto-load more if screen not full
                if (notesGrid.scrollHeight <= notesGrid.clientHeight + 50 && hasMoreOnServer) {
                    setTimeout(loadMoreNotes, 100);
                }
            }
        }
    } catch (e) {
        console.error('Fetch failed:', e);
    } finally {
        isFetching = false;
    }
}

notesGrid.addEventListener('scroll', () => {
    if (notesGrid.scrollTop + notesGrid.clientHeight >= notesGrid.scrollHeight - 100) {
        loadMoreNotes();
    }
});

// Open Modal
function openModal() {
    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.remove('expanded');
    }
    
    noteModal.style.display = 'flex';
    setTimeout(() => noteModal.classList.add('show'), 10);
    updateColorPicker();
    updateModalPin();
}

addNoteBtn.onclick = () => {
    currentEditingId = null;
    modalTitle.value = '';
    modalContent.value = '';
    modalReminder.value = '';
    selectedColor = 'yellow';
    isPinned = false;
    openModal();
};

function closeModal() {
    noteModal.classList.remove('show');
    setTimeout(() => {
        noteModal.style.display = 'none';
    }, 300);
}

function selectColor(color) {
    selectedColor = color;
    updateColorPicker();
}

function updateColorPicker() {
    document.querySelectorAll('.color-dot').forEach(dot => {
        dot.classList.toggle('active', dot.classList.contains(`color-${selectedColor}`));
    });
}

async function saveNote() {
    const title = modalTitle.value.trim();
    const content = modalContent.value.trim();
    const reminder = modalReminder.value;
    
    if (!content && !title) return closeModal();

    // 1. Prevent double submission
    const saveBtn = document.querySelector('#noteModal .btn-primary');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
    }

    const noteData = {
        id: currentEditingId || Date.now(),
        title,
        content,
        reminder,
        color: selectedColor,
        pinned: isPinned,
        updatedAt: Date.now()
    };

    // 2. Optimistic UI Update: Update local state immediately
    if (currentEditingId) {
        const index = notes.findIndex(n => n.id === currentEditingId);
        if (index !== -1) {
            notes[index] = noteData;
        }
    } else {
        // New note: Add to top
        notes.unshift(noteData);
    }

    // 3. Immediate UI Feedback
    renderNotesDisplay();
    closeModal();

    try {
        const response = await fetch('api/save-note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(noteData)
        });
        
        if (!response.ok) {
            console.error('Server save failed, rolling back might be needed in a production app');
            // In a robust app, we would revert the change and alert the user here
        }
    } catch (e) {
        console.error('Save failed:', e);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.style.opacity = '1';
        }
        checkNotificationPermission();
    }
}

function editNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    currentEditingId = id;
    modalTitle.value = note.title;
    modalContent.value = note.content;
    modalReminder.value = note.reminder || '';
    selectedColor = note.color;
    isPinned = note.pinned || false;
    openModal();
}

// Search Functionality
let searchTimeout = null;
searchInput.oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        refreshNotes();
    }, 300);
};

// Notifications
function checkNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function checkReminders() {
    const now = new Date().getTime();
    notes.forEach(note => {
        if (note.reminder) {
            const reminderTime = new Date(note.reminder).getTime();
            // If reminder is within the last minute and not yet notified (we could use a notified flag)
            if (reminderTime <= now && reminderTime > now - 60000) {
                showNotification(note);
            }
        }
    });
}

function showNotification(note) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('便签提醒: ' + (note.title || '无标题'), {
            body: note.content.substring(0, 50),
            icon: 'ICON.PNG'
        });
    }
}

setInterval(checkReminders, 30000); // Check every 30 seconds

// Mobile sidebar logic
const sidebarEl = document.querySelector('.sidebar');
if (sidebarEl) {
    sidebarEl.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!e.target.closest('.nav-item')) {
                sidebarEl.classList.toggle('expanded');
            }
        }
    });
}

document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebarEl) {
        if (!sidebarEl.contains(e.target) && sidebarEl.classList.contains('expanded')) {
            sidebarEl.classList.remove('expanded');
        }
    }
});

// Initial Render
applyTranslations();
refreshNotes();
checkNotificationPermission();

// Mouse Area Selection (Box Select)
let isDragging = false;
let startX, startY;
const selectionBox = document.getElementById('selectionBox');

notesGrid.addEventListener('mousedown', (e) => {
    // Only enable in batch mode and when clicking the grid background (not cards)
    if (!isBatchMode || e.target !== notesGrid) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);
    
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    
    // Perform real-time collision detection
    const boxRect = selectionBox.getBoundingClientRect();
    const cards = notesGrid.querySelectorAll('.note-card');
    
    cards.forEach(card => {
        const cardRect = card.getBoundingClientRect();
        const isIntersecting = !(boxRect.right < cardRect.left || 
                                boxRect.left > cardRect.right || 
                                boxRect.bottom < cardRect.top || 
                                boxRect.top > cardRect.bottom);
        
        // We need the ID from the card. We'll add it in createNoteCard.
        const id = parseInt(card.dataset.id);
        if (isIntersecting) {
            selectedNotes.add(id);
        }
    });
    
    updateSelectionUI();
    // We don't want to re-render everything on every pixel move for performance.
    // Instead, just update the 'selected' class on cards.
    cards.forEach(card => {
        const id = parseInt(card.dataset.id);
        card.classList.toggle('selected', selectedNotes.has(id));
        // Also update the checkbox icon if possible, but for performance, we'll wait for mouseup for full render
    });
});

window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    selectionBox.style.display = 'none';
    renderNotesDisplay(); // Final clean render
});
