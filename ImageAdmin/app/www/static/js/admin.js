/* 
   ==========================================================================
   0. Global Debug & Error Handling
   ========================================================================== 
*/
window.onerror = function(msg, url, line, col, error) {
    console.error("Global Error:", msg, "at", url, ":", line);
    // Optional: show a visible alert for the user during debugging
    // alert("JS Error: " + msg + "\nLine: " + line);
    return false;
};

window.onunhandledrejection = function(event) {
    console.error("Unhandled Promise Rejection:", event.reason);
};

console.log("Admin JS v7 Loading...");

/* 
   ==========================================================================
   1. State & Constants
   ========================================================================== 
*/
const getBaseUrl = () => {
    let path = window.location.pathname;
    if (path.endsWith('/index.html')) path = path.replace('/index.html', '');
    if (path.endsWith('/admin')) path = path.replace('/admin', '');
    if (path.endsWith('/admin/')) path = path.replace('/admin/', '');
    return path.replace(/\/$/, '') || '';
};
const API_BASE = getBaseUrl() + '/api';
const MEDIA_BASE = getBaseUrl();
const TOKEN_KEY = 'adminToken';

let currentImages = [];
let categories = [];
let selectedIds = new Set();
let currentPage = 1;
let currentImageId = null;

// UI Elements
const imageGrid = document.getElementById('imageGrid');
const detailPanel = document.getElementById('detailPanel');
const batchToolbar = document.getElementById('batchToolbar');

/* 
   ==========================================================================
   2. Utility Functions
   ========================================================================== 
*/
const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
};

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `position: fixed; top: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 12px; pointer-events: none;`;
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = `padding: 14px 24px; background: ${type === 'error' ? 'rgba(255, 71, 87, 0.9)' : 'rgba(13, 17, 23, 0.9)'}; color: white; border: 1px solid ${type === 'error' ? 'var(--danger)' : 'var(--accent-primary)'}; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); backdrop-filter: blur(10px); font-size: 14px; font-weight: 600; transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); pointer-events: auto; display: flex; align-items: center; gap: 10px;`;
    const icon = type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.style.transform = 'translateX(0)', 10);
    setTimeout(() => { toast.style.transform = 'translateX(120%)'; setTimeout(() => toast.remove(), 400); }, 3000);
}

function debounce(func, wait) {
    let timeout;
    return function () { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, arguments), wait); };
}

/* 
   ==========================================================================
   3. Authentication & Initialization
   ========================================================================== 
*/
if (!localStorage.getItem(TOKEN_KEY)) { 
    console.log("No token found, redirecting to login...");
    window.location.href = '/login'; 
}
function getAuthHeader() { return { 'Authorization': `Bearer ${localStorage.getItem(TOKEN_KEY)}` }; }

async function init() {
    console.log("Initializing Admin Panel...");
    let user = {};
    try {
        const storedUser = localStorage.getItem('adminUser');
        if (storedUser) user = JSON.parse(storedUser);
    } catch (e) {
        console.error("Failed to parse adminUser from localStorage:", e);
    }
    if (document.getElementById('adminName')) document.getElementById('adminName').innerText = user.username || 'Admin';
    if (document.getElementById('adminRole')) document.getElementById('adminRole').innerText = user.role || 'Administrator';

    bindNavEvents();
    const hash = window.location.hash.replace('#/', '');
    switchSection(hash || 'dashboard');
    await fetchCategories();
    await loadStats();

    window.onhashchange = () => {
        const newHash = window.location.hash.replace('#/', '');
        if (newHash) switchSection(newHash, false);
    };
}

// Navigation Logic
function bindNavEvents() {
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            const sectionId = link.getAttribute('data-section');
            switchSection(sectionId);
            closeMobileMenu(); // Auto-close sidebar on mobile
        };
    });
}

async function switchSection(sectionId, updateHash = true) {
    if (updateHash) window.location.hash = `#/${sectionId}`;
    
    // Sync sidebar highlighting
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.remove('active');
        if (l.getAttribute('data-section') === sectionId) {
            l.classList.add('active');
        }
    });

    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');

    const headerSearch = document.querySelector('.search-wrapper');
    const filtersBar = document.querySelector('.filters-bar');
    if (sectionId === 'media') {
        if (headerSearch) headerSearch.style.visibility = 'visible';
        if (filtersBar) filtersBar.style.display = 'flex';
    } else {
        if (headerSearch) headerSearch.style.visibility = 'hidden';
        if (filtersBar) filtersBar.style.display = 'none';
    }

    const target = document.getElementById(`section-${sectionId}`);
    if (target) {
        target.style.display = 'block';
        if (sectionId === 'resources') {
            await fetchCategories();
            renderCategoryList();
            await fetchStorage();
            // Reset to first tab
            const firstTab = document.querySelector('#section-resources .s-nav-item');
            if (firstTab) switchResourcesTab(firstTab, 'categories');
        }
        if (sectionId === 'dashboard') loadStats();
        if (sectionId === 'media') fetchImages();
        if (sectionId === 'api') fetchApiKeys();
        if (sectionId === 'settings') {
            fetchSettings();
            // Reset to first tab
            const firstTab = document.querySelector('#section-settings .s-nav-item');
            if (firstTab) switchSettingsTab(firstTab, 'general');
        }
    }
}

async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/admin/stats`, { headers: getAuthHeader() });
        const data = await response.json();
        if (document.getElementById('statTotal')) document.getElementById('statTotal').innerText = data.total_images || 0;
        if (document.getElementById('statCats')) document.getElementById('statCats').innerText = data.categories || 0;
        const sizeMB = (data.total_size / (1024 * 1024)).toFixed(2);
        if (document.getElementById('statSize')) document.getElementById('statSize').innerText = `${sizeMB} MB`;
    } catch (err) { console.error(err); }
}

async function fetchCategories() {
    try {
        const response = await fetch(`${API_BASE}/categories`);
        categories = await response.json();

        const filterCat = document.getElementById('filterCategory');
        const editCat = document.getElementById('editCategory');
        const uploadCat = document.getElementById('uploadCategory');

        const options = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        if (filterCat) filterCat.innerHTML = '<option value="0">全部分类</option>' + options;
        if (editCat) editCat.innerHTML = options;
        if (uploadCat) uploadCat.innerHTML = options;
    } catch (err) {
        console.error('Failed to fetch categories:', err);
    }
}

async function fetchImages(page = 1) {
    currentPage = page;
    try {
        const query = new URLSearchParams({
            search: document.getElementById('globalSearch').value,
            category_id: document.getElementById('filterCategory').value,
            status: document.getElementById('filterStatus').value,
            page: page
        });

        const response = await fetch(`${API_BASE}/admin/images?${query.toString()}`, {
            headers: getAuthHeader()
        });

        if (response.status === 401) return logout();

        const result = await response.json();
        currentImages = result.data || [];
        renderImages();
        renderPagination(result.total, result.limit);
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

function renderPagination(total, limit) {
    const container = document.getElementById('mediaPagination');
    if (!container) return;

    container.innerHTML = '';
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) return;

    // Previous Button
    const prevBtn = document.createElement('button');
    prevBtn.className = `btn-batch ${currentPage === 1 ? 'disabled' : ''}`;
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => fetchImages(currentPage - 1);
    container.appendChild(prevBtn);

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            const pageBtn = document.createElement('button');
            pageBtn.className = `btn-batch ${i === currentPage ? 'active' : ''}`;
            if (i === currentPage) pageBtn.style.background = 'var(--accent-primary)';
            if (i === currentPage) pageBtn.style.color = '#000';
            pageBtn.innerText = i;
            pageBtn.onclick = () => fetchImages(i);
            container.appendChild(pageBtn);
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            const dots = document.createElement('span');
            dots.innerText = '...';
            dots.style.color = 'var(--text-secondary)';
            container.appendChild(dots);
        }
    }

    // Next Button
    const nextBtn = document.createElement('button');
    nextBtn.className = `btn-batch ${currentPage === totalPages ? 'disabled' : ''}`;
    nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => fetchImages(currentPage + 1);
    container.appendChild(nextBtn);
}

function renderImages() {
    if (!imageGrid) return;
    imageGrid.innerHTML = '';

    currentImages.forEach(img => {
        const card = document.createElement('div');
        card.className = `img-card ${selectedIds.has(img.id) ? 'selected' : ''}`;
        card.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
                toggleSelection(img.id);
            } else {
                openDetailPanel(img.id);
            }
        };

        const sizeMB = img.file_size ? (img.file_size / (1024 * 1024)).toFixed(1) : '0.0';

        card.innerHTML = `
            <div class="card-thumb">
                <img src="${API_BASE}/thumb?path=${encodeURIComponent(img.path)}" alt="${escapeHTML(img.title) || ''}" loading="lazy">
                <div class="card-badges">
                    <span class="badge ${img.is_visible ? 'badge-visible' : 'badge-hidden'}">
                        <i class="fas ${img.is_visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
                    </span>
                    <span class="badge ${img.source_type === 'remote' ? 'badge-remote' : 'badge-local'}">
                        <i class="fas ${img.source_type === 'remote' ? 'fa-cloud' : 'fa-hdd'}"></i>
                    </span>
                </div>
            </div>
            <div class="card-body">
                <div class="card-title">${escapeHTML(img.title) || 'Untitled'}</div>
                <div class="card-meta">
                    <span>${sizeMB} MB</span>
                    <span>${img.width || 0} x ${img.height || 0}</span>
                </div>
            </div>
        `;
        imageGrid.appendChild(card);
    });
    updateBatchToolbar();
}

// Category Management
function renderCategoryList() {
    const container = document.getElementById('categoryListContainer');
    if (!container) return;

    let html = `
        <div class="list-header">
            <span style="max-width: 100px;">ID</span>
            <span>分类名称</span>
            <span class="list-actions">操作</span>
        </div>
    `;

    html += categories.map(c => `
        <div class="list-row">
            <div style="max-width: 100px;">
                <span style="font-size: 12px; color: var(--text-secondary);">${c.id}</span>
            </div>
            <div>
                <span style="font-weight: 600;">${c.name}</span>
            </div>

            <div class="list-actions" style="display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn" style="color: var(--accent-primary); background: transparent; border: none; cursor: pointer;" onclick="editCategoryName(${c.id}, '${c.name}')">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn" style="color: var(--danger); background: transparent; border: none; cursor: pointer;" onclick="deleteCategory(${c.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');

    container.innerHTML = html;
}

async function editCategoryName(id, oldName) {
    const newName = prompt('请输入新的分类名称：', oldName);
    if (!newName || newName === oldName) return;

    try {
        const resp = await fetch(`${API_BASE}/admin/categories/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ name: newName })
        });
        if (resp.ok) {
            await fetchCategories();
            renderCategoryList();
        } else {
            const data = await resp.json();
            alert(data.error || '修改失败');
        }
    } catch (err) { alert('请求失败'); }
}

async function deleteCategory(id) {
    if (!confirm('确定删除此分类吗？')) return;
    try {
        const resp = await fetch(`${API_BASE}/admin/categories/${id}`, { method: 'DELETE', headers: getAuthHeader() });
        if (resp.ok) {
            await fetchCategories();
            renderCategoryList();
        } else {
            const data = await resp.json();
            alert(data.error || '无法删除');
        }
    } catch (err) { alert('操作失败'); }
}

// Storage Management
async function fetchStorage() {
    try {
        const resp = await fetch(`${API_BASE}/admin/storage`, { headers: getAuthHeader() });
        const configs = await resp.json();
        renderStorageList(configs);
    } catch (err) { console.error(err); }
}

function renderStorageList(configs) {
    const container = document.getElementById('storageListContainer');
    if (!container) return;

    let html = `
        <div class="list-header">
            <span>节点路径</span>
            <span>当前状态</span>
            <span class="list-actions">操作</span>
        </div>
    `;

    html += configs.map(s => `
        <div class="list-row">
            <div>
                <div style="font-weight: 600;">${s.base_path}</div>
            </div>
            <div>
                <div style="font-size: 12px; color: ${s.is_active ? 'var(--success)' : 'var(--text-secondary)'};">
                    ${s.is_active ? '● 活跃 (当前上传路径)' : '闲置'}
                </div>
            </div>
            <div class="list-actions" style="display: flex; gap: 12px; justify-content: flex-end; align-items: center;">
                ${!s.is_active ? `<button class="btn" style="color: var(--accent-primary); border: 1px solid var(--accent-primary); padding: 2px 8px; border-radius: 6px; font-size: 11px; background: transparent; cursor: pointer;" onclick="activateStorage(${s.id})">设为活跃</button>` : ''}
                <button class="btn" style="color: var(--danger); background: transparent; border: none; cursor: pointer;" onclick="deleteStorage(${s.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');

    container.innerHTML = html;
}

async function activateStorage(id) {
    await fetch(`${API_BASE}/admin/storage/${id}/active`, { method: 'PUT', headers: getAuthHeader() });
    fetchStorage();
}

async function deleteStorage(id) {
    if (!confirm('确定删除此路径吗？')) return;
    await fetch(`${API_BASE}/admin/storage/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    fetchStorage();
}

// Image Selection & Detail Panel
function toggleSelection(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    renderImages();
}

function selectAllImages() {
    currentImages.forEach(img => selectedIds.add(img.id));
    renderImages();
}

function updateBatchToolbar() {
    if (!batchToolbar) return;
    const text = document.getElementById('selectionCountText');
    if (selectedIds.size > 0) {
        if (text) text.innerText = `已选中 ${selectedIds.size} 项`;
        batchToolbar.classList.add('show');
    } else {
        batchToolbar.classList.remove('show');
    }
}

async function batchAction(action) {
    if (selectedIds.size === 0) return;

    if (action === 'delete') {
        if (!confirm(`确定要永久删除选中的 ${selectedIds.size} 张图片吗？此操作不可撤销。`)) return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/images/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({
                ids: Array.from(selectedIds),
                action: action
            })
        });

        if (response.ok) {
            selectedIds.clear();
            fetchImages();
            loadStats();
        } else {
            const err = await response.json();
            alert('操作失败: ' + (err.error || '未知错误'));
        }
    } catch (err) {
        alert('网络请求失败');
    }
}

function openDetailPanel(id) {
    const img = currentImages.find(i => i.id === id);
    if (!img) return;
    currentImageId = id;

    document.getElementById('detailImg').src = MEDIA_BASE + img.path;
    document.getElementById('editTitle').value = img.title || '';
    document.getElementById('editDesc').value = img.description || '';
    document.getElementById('editCategory').value = img.category_id;
    document.getElementById('editLocation').value = img.location || '';
    document.getElementById('editVisible').checked = img.is_visible;

    document.getElementById('infoResolution').innerText = `${img.width} × ${img.height} px`;
    document.getElementById('infoSize').innerText = `${(img.file_size / (1024 * 1024)).toFixed(2)} MB`;
    document.getElementById('infoFormat').innerText = img.format || 'Unknown';
    document.getElementById('infoDate').innerText = new Date(img.created_at).toLocaleDateString();

    const tagContainer = document.getElementById('tagContainer');
    tagContainer.innerHTML = (img.tags || []).map(t => `<span class="tag">${t.name}</span>`).join('');
    document.getElementById('editTags').value = (img.tags || []).map(t => t.name).join(', ');

    detailPanel.classList.add('open');
}

function closeDetailPanel() {
    detailPanel.classList.remove('open');
    currentImageId = null;
}

async function saveImageDetails() {
    if (!currentImageId) return;
    const data = {
        title: document.getElementById('editTitle').value,
        description: document.getElementById('editDesc').value,
        category_id: parseInt(document.getElementById('editCategory').value),
        location: document.getElementById('editLocation').value,
        is_visible: document.getElementById('editVisible').checked,
        tags: document.getElementById('editTags').value.split(',').map(t => t.trim()).filter(t => t)
    };

    try {
        const response = await fetch(`${API_BASE}/admin/images/${currentImageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(data)
        });
        if (response.ok) { closeDetailPanel(); fetchImages(); }
    } catch (err) { alert('保存失败'); }
}

// Modals
function openUploadModal() { 
    fetchCategories();
    document.getElementById('uploadModal').classList.add('active'); 
}

function openModal(id) { 
    const el = document.getElementById(id);
    if (el) el.classList.add('active'); 
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('active');
        // If it's a style-based modal, also hide it
        el.style.display = 'none';
    }
    
    // Reset forms if applicable
    if (id === 'uploadModal') {
        const fileList = document.getElementById('fileListNames');
        if (fileList) fileList.innerText = '';
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';
        const uploadForm = document.getElementById('uploadForm');
        if (uploadForm) uploadForm.reset();
    }
}

function updateFileList(input) {
    const display = document.getElementById('fileListNames');
    if (input.files.length > 0) {
        if (input.files.length === 1) {
            display.innerText = `已选择: ${input.files[0].name}`;
        } else {
            display.innerText = `已选择 ${input.files.length} 个文件`;
        }
    } else {
        display.innerText = '';
    }
}

document.getElementById('modeLocal').onclick = () => {
    document.getElementById('modeLocal').style.background = 'var(--accent-primary)';
    document.getElementById('modeLocal').style.color = '#000';
    document.getElementById('modeRemote').style.background = 'rgba(255,255,255,0.05)';
    document.getElementById('modeRemote').style.color = '#fff';
    document.getElementById('localInput').style.display = 'block';
    document.getElementById('remoteInput').style.display = 'none';
};
document.getElementById('modeRemote').onclick = () => {
    document.getElementById('modeRemote').style.background = 'var(--accent-primary)';
    document.getElementById('modeRemote').style.color = '#000';
    document.getElementById('modeLocal').style.background = 'rgba(255,255,255,0.05)';
    document.getElementById('modeLocal').style.color = '#fff';
    document.getElementById('localInput').style.display = 'none';
    document.getElementById('remoteInput').style.display = 'block';
};

document.getElementById('uploadForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerText = '正在处理...';

    try {
        const mode = document.getElementById('localInput').style.display !== 'none' ? 'local' : 'remote';
        const commonCategory = document.getElementById('uploadCategory').value;
        const commonLocation = document.getElementById('uploadLocation').value;
        const baseTitle = document.getElementById('uploadTitle').value;

        if (mode === 'local') {
            const files = document.getElementById('fileInput').files;
            if (files.length === 0) { alert('请先选择文件'); return; }

            for (let i = 0; i < files.length; i++) {
                let file = files[i];
                btn.innerText = `上传中 (${i + 1}/${files.length})...`;

                const formData = new FormData();
                formData.append('image', file);

                // 标题逻辑：单图用输入标题，多图用作前缀
                let finalTitle = baseTitle || file.name.split('.')[0];
                if (files.length > 1 && baseTitle) {
                    finalTitle = `${baseTitle} - ${i + 1}`;
                }

                formData.append('title', finalTitle);
                formData.append('category_id', commonCategory);
                formData.append('location', commonLocation);

                await fetch(`${API_BASE}/admin/upload`, { method: 'POST', headers: getAuthHeader(), body: formData });
            }
        } else {
            const data = {
                url: document.getElementById('urlInput').value,
                title: baseTitle,
                category_id: parseInt(commonCategory),
                location: commonLocation
            };
            if (!data.url) { alert('请输入图片 URL'); return; }
            await fetch(`${API_BASE}/admin/remote`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(data) });
        }
        closeModal('uploadModal');
        fetchImages();
        loadStats();
    } catch (err) {
        alert('上传失败，请检查网络或服务器日志');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

document.getElementById('categoryForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('newCatName').value;
    try {
        const res = await fetch(`${API_BASE}/admin/categories`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, 
            body: JSON.stringify({ name }) 
        });
        const result = await res.json();
        if (!res.ok) {
            alert(result.error || '创建分类失败');
            return;
        }
        showToast('分类添加成功！');
        closeModal('categoryModal'); 
        await fetchCategories(); 
        renderCategoryList();
        document.getElementById('newCatName').value = ''; // Clear input
    } catch (err) {
        alert('网络请求失败');
    }
};

document.getElementById('storageForm').onsubmit = async (e) => {
    e.preventDefault();
    const data = { 
        base_path: document.getElementById('newStoragePath').value, 
        is_active: document.getElementById('storageActive').checked 
    };
    try {
        const res = await fetch(`${API_BASE}/admin/storage`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, 
            body: JSON.stringify(data) 
        });
        const result = await res.json();
        if (!res.ok) {
            alert(result.error || '添加节点失败');
            return;
        }
        showToast('存储节点已成功添加！');
        closeModal('storageModal'); 
        fetchStorage();
        document.getElementById('newStoragePath').value = ''; // Clear input
    } catch (err) {
        alert('网络请求失败');
    }
};

async function reindexFiles() {
    const btn = document.getElementById('reindexBtn');
    const originalText = btn.innerHTML;
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在重建...';
        
        const res = await fetch(`${API_BASE}/admin/reindex`, { 
            method: 'POST', 
            headers: getAuthHeader() 
        });
        const result = await res.json();
        
        showToast(result.message || '重建完成');
        fetchImages();
        loadStats();
        fetchCategories();
    } catch (err) {
        console.error('Reindex failed:', err);
        showToast('重建索引失败', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Search & Filter
document.getElementById('globalSearch').oninput = debounce(() => fetchImages(), 500);
document.getElementById('filterCategory').onchange = () => fetchImages();
document.getElementById('filterStatus').onchange = () => fetchImages();

function debounce(func, wait) {
    let timeout;
    return function () { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, arguments), wait); };
}

// Modal helpers removed as they are moved to the top and unified.

// Close modal by clicking backdrop
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
    });
});

// === Mobile Menu ===
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }
}

function closeMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
}

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('adminUser');
    window.location.href = '/login';
}


function switchSettingsTab(el, tabId) {
    // Nav
    document.querySelectorAll('#section-settings .s-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    el.classList.add('active');

    // Content
    document.querySelectorAll('#section-settings .s-tab-content').forEach(tab => {
        tab.classList.remove('active');
        tab.style.display = ''; // Clear inline styles from previous code
    });
    const target = document.getElementById(`tab-${tabId}`);
    if (target) target.classList.add('active');
}

function switchResourcesTab(el, tabId) {
    // Nav
    document.querySelectorAll('#section-resources .s-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    el.classList.add('active');

    // Content
    document.querySelectorAll('#section-resources .s-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`res-tab-${tabId}`).classList.add('active');
}

async function fetchSettings() {
    try {
        const resp = await fetch(`${API_BASE}/admin/settings`, { headers: getAuthHeader() });
        const data = await resp.json();

        // General
        const siteTitle = data.siteTitle || 'ImagesGallery';
        document.getElementById('siteTitle').value = data.siteTitle || '';
        document.getElementById('siteTitle').placeholder = 'ImagesGallery';

        const brand = document.getElementById('adminBrandName');
        if (brand) brand.innerText = siteTitle;

        document.getElementById('siteDesc').value = data.siteDesc || '';
        document.getElementById('siteFooter').value = data.siteFooter || '';
        document.getElementById('siteBeian').value = data.siteBeian || '';

        // Upload
        const upTab = document.getElementById('tab-upload');
        if (data.maxFileSize) upTab.querySelector('input[type="number"]').value = data.maxFileSize;
        if (data.allowedExts) upTab.querySelector('input[type="text"]').value = data.allowedExts;
        if (data.autoCompress) upTab.querySelector('input[type="checkbox"]').checked = data.autoCompress === "true";

        // Display
        const dispTab = document.getElementById('tab-display');
        if (data.itemsPerPage) dispTab.querySelector('input[type="number"]').value = data.itemsPerPage;
        if (data.defaultSort) dispTab.querySelector('select').value = data.defaultSort;

        // Account - Load current user info
        fetchUserInfo();

    } catch (err) { console.error('Failed to fetch settings:', err); }
}

async function fetchUserInfo() {
    try {
        const userResp = await fetch(`${API_BASE}/admin/account_info`, { headers: getAuthHeader() });
        const user = await userResp.json();
        
        const usernameInput = document.querySelector('#tab-account input[type="text"]');
        if (usernameInput) usernameInput.value = user.username || 'Admin';
        
        const sidebarName = document.querySelector('.admin-info span');
        if (sidebarName) sidebarName.innerText = user.username || 'Admin';
    } catch (err) {}
}

async function updateAccountInfo() {
    const username = document.querySelector('#tab-account input[type="text"]').value;
    const oldPassword = document.querySelectorAll('#tab-account input[type="password"]')[0].value;
    const newPassword = document.querySelectorAll('#tab-account input[type="password"]')[1].value;
    const confirmPassword = document.querySelectorAll('#tab-account input[type="password"]')[2].value;

    if (newPassword && newPassword !== confirmPassword) {
        alert('两次输入的新密码不一致');
        return;
    }

    if (newPassword && !oldPassword) {
        alert('修改密码需要输入当前密码');
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/admin/account`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({
                username: username,
                old_password: oldPassword,
                new_password: newPassword
            })
        });

        const result = await resp.json();
        if (resp.ok) {
            alert('账户信息更新成功');
            // Update sidebar username
            const sidebarName = document.querySelector('.admin-info span');
            if (sidebarName) sidebarName.innerText = result.username || username;
            
            // Clear password fields
            document.querySelectorAll('#tab-account input[type="password"]').forEach(i => i.value = '');
        } else {
            alert('更新失败: ' + result.error);
        }
    } catch (err) {
        alert('网络请求失败');
    }
}

async function saveGeneralSettings() {
    const titleInput = document.getElementById('siteTitle').value;
    const data = {
        siteTitle: titleInput,
        siteDesc: document.getElementById('siteDesc').value,
        siteFooter: document.getElementById('siteFooter').value,
        siteBeian: document.getElementById('siteBeian').value
    };
    await saveSettings(data);

    // Update UI immediately
    const brand = document.getElementById('adminBrandName');
    if (brand) brand.innerText = titleInput || 'ImagesGallery';
}

async function saveUploadSettings() {
    const tab = document.getElementById('tab-upload');
    const data = {
        maxFileSize: tab.querySelector('input[type="number"]').value,
        allowedExts: tab.querySelector('input[type="text"]').value,
        autoCompress: tab.querySelector('input[type="checkbox"]').checked ? "true" : "false"
    };
    await saveSettings(data);
}

async function saveDisplaySettings() {
    const tab = document.getElementById('tab-display');
    const data = {
        itemsPerPage: tab.querySelector('input[type="number"]').value,
        defaultSort: tab.querySelector('select').value
    };
    await saveSettings(data);
}

async function saveSettings(data) {
    try {
        const resp = await fetch(`${API_BASE}/admin/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(data)
        });
        if (resp.ok) alert('设置已保存');
    } catch (err) { alert('保存失败'); }
}

async function updatePassword() {
    const inputs = document.getElementById('tab-account').querySelectorAll('input[type="password"]');
    const oldPass = inputs[0].value;
    const newPass = inputs[1].value;
    const confirmPass = inputs[2].value;

    if (newPass !== confirmPass) return alert('两次输入的新密码不一致');
    if (newPass.length < 6) return alert('新密码长度不能少于 6 位');

    try {
        const resp = await fetch(`${API_BASE}/admin/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ old: oldPass, new: newPass })
        });
        if (resp.ok) {
            alert('密码修改成功，请重新登录');
            logout();
        } else {
            const data = await resp.json();
            alert(data.error || '修改失败');
        }
    } catch (err) { alert('请求失败'); }
}

// === API Key Management ===
async function fetchApiKeys() {
    try {
        const res = await fetch(`${API_BASE}/admin/apikeys`, { headers: getAuthHeader() });
        const keys = await res.json();
        const tbody = document.getElementById('apiKeysTableBody');
        tbody.innerHTML = '';
        
        if (!keys || keys.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无私有密钥</td></tr>`;
            return;
        }

        keys.forEach(k => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${k.name}</td>
                <td style="font-family: monospace; color: var(--accent-primary);">${k.token}</td>
                <td>${k.rate_limit} 次/分钟</td>
                <td><span style="color: ${k.is_active ? 'var(--success)' : 'var(--danger)'}">${k.is_active ? '活跃' : '禁用'}</span></td>
                <td>
                    <button class="btn-danger" style="padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;" onclick="deleteApiKey(${k.id})">删除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load API keys', err);
    }
}

function openApiKeyModal() {
    document.getElementById('apiKeyName').value = '';
    document.getElementById('apiKeyRateLimit').value = '120';
    document.getElementById('apiKeyModal').classList.add('active');
}

async function submitCreateApiKey() {
    const name = document.getElementById('apiKeyName').value.trim();
    const rateLimit = parseInt(document.getElementById('apiKeyRateLimit').value);

    if (!name) return alert('请输入密钥用途或名称');
    if (!rateLimit || rateLimit <= 0) return alert('限流速率必须为正整数');

    try {
        const resp = await fetch(`${API_BASE}/admin/apikeys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ name: name, rate_limit: rateLimit })
        });
        if (resp.ok) {
            closeModal('apiKeyModal');
            fetchApiKeys();
        } else {
            alert('生成失败，请稍后重试');
        }
    } catch (err) {
        alert('网络请求失败');
    }
}

async function deleteApiKey(id) {
    if (!confirm('确定要删除此密钥吗？该操作不可逆，且正在使用该密钥的应用将失去访问权限。')) return;
    
    try {
        const resp = await fetch(`${API_BASE}/admin/apikeys/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        if (resp.ok) {
            fetchApiKeys();
        } else {
            alert('删除失败');
        }
    } catch (err) {
        alert('网络请求失败');
    }
}

init();

