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
let unlockedContentCache = new Map(); // Session cache for unlocked notes
let isNotePrivate = false;
let notePassword = "";

// Pagination state
let serverOffset = 0;
let hasMoreOnServer = true;
let isFetching = false;
const PAGE_SIZE = 5;

let externalAuth = localStorage.getItem('fn_external_auth') || '';

async function authFetch(url, options = {}) {
    if (externalAuth) {
        options.headers = options.headers || {};
        options.headers['Authorization'] = 'Basic ' + externalAuth;
    }
    
    try {
        const response = await fetch(url, options);
        if (response.status === 401) {
            // If unauthorized, clear invalid credentials and show login
            if (externalAuth) {
                localStorage.removeItem('fn_external_auth');
                externalAuth = '';
                showToast(translations[currentLang].password_wrong, 'error');
            }
            showExternalLogin();
            return null;
        }
        return response;
    } catch (e) {
        console.error('Network error:', e);
        showToast(translations[currentLang].network_error, 'error');
        return null;
    }
}

window.showExternalLogin = () => {
    const modal = document.getElementById('externalLoginModal');
    if (modal) {
        modal.classList.add('show');
        document.body.classList.add('login-mode');
        lucide.createIcons();
    }
};

window.performExternalLogin = async () => {
    const user = document.getElementById('extLoginUser').value;
    const pass = document.getElementById('extLoginPass').value;
    
    if (!user || !pass) return;
    
    externalAuth = btoa(user + ':' + pass);
    localStorage.setItem('fn_external_auth', externalAuth);
    
    // Try to reload settings to verify
    const response = await authFetch('api/get-settings');
    if (response && response.ok) {
        document.getElementById('externalLoginModal').classList.remove('show');
        document.body.classList.remove('login-mode');
        document.body.classList.remove('app-loading');
        
        const settings = await response.json();
        if (settings.is_external) {
            const logoutBtn = document.getElementById('logoutNavItem');
            if (logoutBtn) logoutBtn.style.display = 'flex';
        }
        refreshNotes();
    } else {
        // authFetch already handles clearing and showing toast if 401
        // But we might want to stay in login mode
    }
};

window.performLogout = () => {
    localStorage.removeItem('fn_external_auth');
    externalAuth = '';
    location.reload();
};

const translations = {
    zh: {
        app_title: '便签记事本',
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
        deselect_all: '取消全选',
        lock_note: '加密便签',
        unlock_note: '取消加密',
        enter_password: '请输入卡片密码',
        password_wrong: '密码错误',
        set_password: '设置访问密码',
        password_btn_confirm: '确定',
        backup_password_prompt: '请设置备份加密密码 (必填)',
        backup_password_import: '此备份文件已加密，请输入密码',
        password_required: '请设置密码以保护您的备份数据',
        note_encrypted: '此便签已加密',
        search_placeholder: '搜索便签...',
        btn_exit_batch: '退出选择',
        selection_count: '已选中 {count} 项',
        select_all_group: '全选该日',
        password_placeholder: '密码',
        external_access_title: '外部访问',
        external_access_desc: '允许通过特定端口从局域网或公网访问便签。',
        external_access_enable: '启用外部访问',
        external_access_port: '访问端口',
        btn_save_settings: '应用',
        port_occupied: '端口 {port} 已被占用，请更换。',
        settings_applied: '设置已应用',
        invalid_port: '请输入有效的端口号 (1-65535)',
        confirm_title: '确认操作',
        delete_success: '便签已删除',
        delete_failed: '删除失败',
        batch_delete_success: '项已删除',
        save_failed: '保存设置失败',
        network_error: '网络错误，请稍后重试',
        external_access_user: '访问账号',
        external_access_pass: '访问密码',
        login_title: '安全登录',
        login_desc: '请输入外网访问账号和密码',
        login_user_placeholder: '用户名',
        login_pass_placeholder: '密码',
        login_btn: '登录',
        nav_logout: '退出登录'
    },
    en: {
        app_title: 'NotePad',
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
        deselect_all: 'Deselect All',
        lock_note: 'Lock Note',
        unlock_note: 'Unlock Note',
        enter_password: 'Enter Card Password',
        password_wrong: 'Incorrect password',
        set_password: 'Set Access Password',
        password_btn_confirm: 'Confirm',
        backup_password_prompt: 'Set backup password (required)',
        backup_password_import: 'This backup is encrypted, please enter password',
        password_required: 'Please set a password to protect your backup data',
        note_encrypted: 'This note is encrypted',
        search_placeholder: 'Search notes...',
        btn_exit_batch: 'Exit Selection',
        selection_count: 'Selected {count} items',
        select_all_group: 'Select All for this day',
        password_placeholder: 'Password',
        external_access_title: 'External Access',
        external_access_desc: 'Allow access to notes from LAN or public network via a specific port.',
        external_access_enable: 'Enable External Access',
        external_access_port: 'Access Port',
        btn_save_settings: 'Apply',
        port_occupied: 'Port {port} is already in use, please choose another.',
        settings_applied: 'Settings applied',
        invalid_port: 'Please enter a valid port (1-65535)',
        confirm_title: 'Confirm',
        delete_success: 'Note deleted',
        delete_failed: 'Delete failed',
        batch_delete_success: 'items deleted',
        save_failed: 'Failed to save settings',
        network_error: 'Network error, please try again',
        external_access_user: 'External Username',
        external_access_pass: 'External Password',
        login_title: 'Secure Login',
        login_desc: 'Please enter your external access credentials',
        login_user_placeholder: 'Username',
        login_pass_placeholder: 'Password',
        login_btn: 'Login',
        nav_logout: 'Logout'
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
        selectionCountText.textContent = translations[currentLang].selection_count.replace('{count}', selectedNotes.size);
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
    
    showConfirmModal(
        translations[currentLang].confirm_title,
        translations[currentLang].confirm_batch_delete,
        async () => {
            const ids = Array.from(selectedNotes);
            try {
                const response = await authFetch('api/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ids)
                });
                if (response && response.ok) {
                    notes = notes.filter(n => !selectedNotes.has(n.id));
                    window.toggleBatchMode();
                    renderNotesDisplay();
                    showToast(translations[currentLang].selection_count.replace('{count}', ids.length) + ' ' + translations[currentLang].batch_delete_success, 'success');
                }
            } catch (e) {
                console.error('Batch delete failed:', e);
                showToast(translations[currentLang].delete_failed, 'error');
            }
        }
    );
};

window.deleteSingleNote = async (e, id) => {
    e.stopPropagation();
    
    showConfirmModal(
        translations[currentLang].confirm_title,
        translations[currentLang].confirm_delete,
        async () => {
            try {
                const response = await authFetch(`api/delete-note?id=${id}`);
                if (response && response.ok) {
                    notes = notes.filter(n => n.id !== id);
                    renderNotesDisplay();
                    showToast(translations[currentLang].delete_success, 'success');
                }
            } catch (e) {
                console.error('Delete failed:', e);
                showToast(translations[currentLang].delete_failed, 'error');
            }
        }
    );
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
            }
            if (el.hasAttribute('title')) {
                el.title = t[key];
            }
            // Update text content only if the element has no child elements (like icons)
            if (el.children.length === 0 && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                el.textContent = t[key];
            }
        }
    });
    const langSelect = document.getElementById('langSelect');
    if (langSelect) langSelect.value = currentLang;
    
    // Update dynamic UI elements
    updateSelectionUI();
    renderNotesDisplay();
}

// Data Management
async function exportNotes() {
    window.showPasswordPrompt(translations[currentLang].backup_password_prompt, async (password) => {
        if (!password) {
            alert(translations[currentLang].password_required);
            return;
        }
        try {
            window.closePasswordModal();
            const response = await authFetch(`api/export-notes?password=${encodeURIComponent(password)}`);
            if (response && response.ok) {
                const backupData = await response.json();
                const dataStr = JSON.stringify(backupData, null, 2);
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
    });
}

function importNotes(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const backupFile = JSON.parse(e.target.result);
            
            const doImport = async (password = "") => {
                const response = await authFetch(`api/save-notes?password=${encodeURIComponent(password)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(backupFile)
                });
                if (response && response.ok) {
                    refreshNotes();
                    showToast(translations[currentLang].import_success, 'success');
                    if (password) window.closePasswordModal();
                } else if (response.status === 401) {
                    showToast(translations[currentLang].password_wrong, 'error');
                } else {
                    showToast(translations[currentLang].import_error, 'error');
                }
            };

            if (backupFile.isEncrypted) {
                window.showPasswordPrompt(translations[currentLang].backup_password_import, (password) => {
                    doImport(password);
                });
            } else {
                doImport();
            }
        } catch (err) {
            alert(translations[currentLang].import_error);
        }
    };
    reader.readAsText(file);
}

// Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    
    toast.innerHTML = `
        <i data-lucide="${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto-remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// External Access Settings
async function loadExternalSettings() {
    try {
        const response = await authFetch('api/get-settings');
        if (response && response.ok) {
            const settings = await response.json();
            const toggle = document.getElementById('externalAccessToggle');
            const portInput = document.getElementById('externalAccessPort');
            const portSettings = document.getElementById('portSettings');
            
            if (toggle) toggle.checked = settings.external_access_enabled;
            if (portInput) {
                portInput.value = settings.external_access_port || '8080';
                portInput.disabled = settings.external_access_enabled;
            }
            
            const userInput = document.getElementById('externalAccessUser');
            const passInput = document.getElementById('externalAccessPass');
            if (userInput) userInput.value = settings.external_access_username || '';
            if (passInput) passInput.value = settings.external_access_password || '';
            
            const extSection = document.getElementById('externalAccessSection');
            const backupSection = document.getElementById('backupSection');
            const logoutBtn = document.getElementById('logoutNavItem');

            // Update UI based on access mode
            if (settings.is_external) {
                if (extSection) extSection.style.display = 'none';
                if (backupSection) backupSection.style.display = 'none';
                if (logoutBtn) logoutBtn.style.display = 'flex';
            } else {
                if (extSection) extSection.style.display = 'block';
                if (backupSection) backupSection.style.display = 'block';
                if (logoutBtn) logoutBtn.style.display = 'none';
            }
            
            return settings.is_external;
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return null; // Return null to indicate load failure (likely auth)
}

window.saveExternalSettings = async () => {
    const toggle = document.getElementById('externalAccessToggle');
    const portInput = document.getElementById('externalAccessPort');
    
    if (!toggle || !portInput) return;
    
    const enabled = toggle.checked;
    const port = portInput.value;
    
    if (enabled && (!port || port < 1 || port > 65535)) {
        showToast(translations[currentLang].invalid_port, 'error');
        toggle.checked = false;
        return;
    }
    
    // Optimistically update disabled state
    portInput.disabled = enabled;
    
    try {
        const response = await authFetch('api/save-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                external_access_enabled: enabled,
                external_access_port: port,
                external_access_username: document.getElementById('externalAccessUser').value,
                external_access_password: document.getElementById('externalAccessPass').value
            })
        });
        
        if (response.ok) {
            showToast(translations[currentLang].settings_applied, 'success');
        } else {
            if (response.status === 409) {
                showToast(translations[currentLang].port_occupied.replace('{port}', port), 'error');
            } else {
                showToast(translations[currentLang].save_failed, 'error');
            }
            // Rollback
            toggle.checked = !enabled;
            portInput.disabled = !enabled;
        }
    } catch (e) {
        console.error('Save settings failed:', e);
        showToast(translations[currentLang].network_error, 'error');
        // Rollback
        toggle.checked = !enabled;
        portInput.disabled = !enabled;
    }
};

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

// Password Modal Helpers
window.closePasswordModal = () => {
    const modal = document.getElementById('passwordModal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
    document.getElementById('notePasswordField').value = '';
};

window.showPasswordPrompt = (title, onConfirm) => {
    const modal = document.getElementById('passwordModal');
    const titleEl = document.getElementById('passwordModalTitle');
    const confirmBtn = document.getElementById('passwordConfirmBtn');
    
    titleEl.textContent = title || translations[currentLang].enter_password;
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    document.getElementById('notePasswordField').focus();
    
    confirmBtn.onclick = () => {
        const password = document.getElementById('notePasswordField').value;
        if (password) {
            onConfirm(password);
        }
    };
};

// Confirmation Modal Helper
window.showConfirmModal = (title, message, onConfirm) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const messageEl = document.getElementById('confirmModalMessage');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const confirmBtn = document.getElementById('confirmConfirmBtn');
    
    titleEl.textContent = title || translations[currentLang].confirm_title;
    messageEl.textContent = message;
    
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    
    const close = () => {
        modal.classList.remove('show');
        setTimeout(() => modal.style.display = 'none', 300);
    };
    
    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
        close();
        onConfirm();
    };
};

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
        addNoteBtn.style.display = 'none';
        
        // Hide sensitive sections immediately if we have externalAuth to reduce flash
        if (externalAuth) {
            const extSection = document.getElementById('externalAccessSection');
            const backupSection = document.getElementById('backupSection');
            if (extSection) extSection.style.display = 'none';
            if (backupSection) backupSection.style.display = 'none';
        }

        await loadExternalSettings();
        
        settingsPanel.style.display = 'flex';
        settingsPanel.style.flexDirection = 'column';
        settingsPanel.style.flex = '1';
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
                        <span style="font-size:12px; opacity:0.5; font-weight:normal;">${translations[currentLang].select_all_group}</span>
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
    let rawContent = note.content;
    const isPrivate = note.isPrivate && !unlockedContentCache.has(note.id);
    
    if (isPrivate) {
        card.classList.add('private');
        rawContent = '';
    }

    const renderedContent = isPrivate 
        ? `<i data-lucide="lock"></i><div class="lock-text">${translations[currentLang].note_encrypted}</div>` 
        : (typeof marked !== 'undefined' ? marked.parse(rawContent) : rawContent.replace(/\n/g, '<br>'));

    card.innerHTML = `
        ${checkboxHtml}
        <div class="note-title" title="${(note.title || translations[currentLang].no_title).replace(/"/g, '&quot;')}">${note.title || translations[currentLang].no_title}</div>
        <div class="note-content markdown-body" title="${isPrivate ? '' : rawContent.replace(/"/g, '&quot;')}">${renderedContent}</div>
        <div class="note-footer">
            <div style="display:flex; flex-direction:column; gap:4px;">
                <span>${new Date(note.updatedAt).toLocaleDateString()}</span>
                ${note.reminder ? `<span style="color:#d32f2f;"><i data-lucide="bell" style="width:10px; height:10px; display:inline-block; vertical-align:middle;"></i> ${new Date(note.reminder).toLocaleString()}</span>` : ''}
            </div>
            <div style="display:flex; gap: 8px; align-items:center;">
                ${note.isPrivate ? '<i data-lucide="lock" style="width:14px; height:14px; color:var(--primary-color); opacity:0.8;"></i>' : ''}
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
        const response = await authFetch(url);
        if (response && response.ok) {
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
    updateModalLock();
}

function updateModalLock() {
    const lockIcon = document.getElementById('modalLock');
    if (lockIcon) {
        lockIcon.style.opacity = isNotePrivate ? '1' : '0.3';
        lockIcon.style.color = isNotePrivate ? 'var(--primary-color)' : 'var(--text-color)';
    }
}

addNoteBtn.onclick = () => {
    currentEditingId = null;
    modalTitle.value = '';
    modalContent.value = '';
    modalReminder.value = '';
    selectedColor = 'yellow';
    isPinned = false;
    isNotePrivate = false;
    notePassword = "";
    openModal();
};

function closeModal() {
    noteModal.classList.remove('show');
    
    // Re-lock the note if it's private to ensure it's masked in the grid
    if (currentEditingId && isNotePrivate) {
        unlockedContentCache.delete(currentEditingId);
        const note = notes.find(n => n.id === currentEditingId);
        if (note) {
            note.content = ""; // Mask content in local state
        }
        renderNotesDisplay();
    }

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
        isPrivate: isNotePrivate,
        password: notePassword,
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

    // 3. Prepare payload before closeModal can mask the content
    const payload = JSON.stringify(noteData);

    // 4. Immediate UI Feedback
    renderNotesDisplay();
    closeModal();

    try {
        const response = await authFetch('api/save-note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
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

    if (note.isPrivate && !unlockedContentCache.has(id)) {
        window.showPasswordPrompt(translations[currentLang].enter_password, async (password) => {
            try {
                const response = await authFetch('api/verify-note', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, password })
                });
                if (response.ok) {
                    const fullNote = await response.json();
                    unlockedContentCache.set(id, fullNote.content);
                    // Update the note in local list
                    const idx = notes.findIndex(n => n.id === id);
                    notes[idx].content = fullNote.content;
                    window.closePasswordModal();
                    openEditModal(note);
                } else {
                    showToast(translations[currentLang].password_wrong, 'error');
                }
            } catch (e) {
                console.error('Verify failed:', e);
            }
        });
    } else {
        openEditModal(note);
    }
}

function openEditModal(note) {
    currentEditingId = note.id;
    modalTitle.value = note.title;
    modalContent.value = note.isPrivate ? (unlockedContentCache.get(note.id) || "") : note.content;
    modalReminder.value = note.reminder || '';
    selectedColor = note.color;
    isPinned = note.pinned || false;
    isNotePrivate = note.isPrivate || false;
    notePassword = note.password || "";
    openModal();
}

window.toggleNotePrivacy = () => {
    const note = notes.find(n => n.id === currentEditingId);
    
    if (!currentEditingId || !note) {
        // Handle new notes: just toggle local state
        if (isNotePrivate) {
            isNotePrivate = false;
            notePassword = "";
            updateModalLock();
        } else {
            window.showPasswordPrompt(translations[currentLang].set_password, (password) => {
                isNotePrivate = true;
                notePassword = password;
                window.closePasswordModal();
                updateModalLock();
            });
        }
        return;
    }

    if (isNotePrivate) {
        // Unlock (make public)
        window.showPasswordPrompt(translations[currentLang].enter_password, async (password) => {
            const response = await authFetch('api/save-note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...note, isPrivate: false, password: "" })
            });
            if (response.ok) {
                isNotePrivate = false;
                notePassword = "";
                note.isPrivate = false;
                note.password = "";
                window.closePasswordModal();
                updateModalLock();
                renderNotesDisplay();
            } else {
                showToast(translations[currentLang].password_wrong, 'error');
            }
        });
    } else {
        // Lock
        window.showPasswordPrompt(translations[currentLang].set_password, async (password) => {
            const response = await authFetch('api/lock-note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: note.id, password })
            });
            if (response.ok) {
                isNotePrivate = true;
                notePassword = password;
                note.isPrivate = true;
                note.password = password;
                unlockedContentCache.set(note.id, note.content);
                window.closePasswordModal();
                updateModalLock();
                renderNotesDisplay();
            }
        });
    }
};

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
loadExternalSettings().then((isExternal) => {
    // Only continue if we successfully loaded settings (and thus are authorized)
    // If authFetch encountered a 401, it would have shown the login modal and returned null
    if (isExternal !== undefined && isExternal !== null) {
        document.body.classList.remove('app-loading');
        refreshNotes();
    } else {
        // We stay in app-loading/login-mode
        console.log('Authorization required or failed');
    }
});
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
