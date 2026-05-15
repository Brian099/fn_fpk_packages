/* 
   ==========================================================================
   0. Global Error Handling
   ========================================================================== 
*/
window.onerror = function (msg, url, line, col, error) {
    console.error("Global Error:", msg, "at", url, ":", line);
    return false;
};

window.onunhandledrejection = function (event) {
    console.error("Unhandled Promise Rejection:", event.reason);
};

console.log("Admin JS v3.0 (Production Stable) Loading...");

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
const isInternal = () => window.location.pathname.includes('index.cgi');

if (!isInternal() && !localStorage.getItem(TOKEN_KEY)) {
    window.location.href = getBaseUrl() + '/login';
}

function getAuthHeader() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token && isInternal()) {
        return { 'X-Internal-Request': 'true' };
    }
    return { 'Authorization': `Bearer ${token}` };
}

async function init() {
    let user = {};
    try {
        const storedUser = localStorage.getItem('adminUser');
        if (storedUser) user = JSON.parse(storedUser);
    } catch (e) { }
    if (document.getElementById('adminName')) document.getElementById('adminName').innerText = user.username || 'Admin';
    if (document.getElementById('adminRole')) document.getElementById('adminRole').innerText = user.role || 'Administrator';

    bindNavEvents();
    bindFilterEvents();

    const viewSiteLink = document.getElementById('viewSiteLink');
    if (viewSiteLink) {
        viewSiteLink.href = getBaseUrl() + '/';
    }

    const hash = window.location.hash.replace('#/', '');
    switchSection(hash || 'dashboard');
    await fetchCategories();
    await fetchSystemStatus(); // 新增：获取系统外部访问状态
    await loadStats();

    window.onhashchange = () => {
        const newHash = window.location.hash.replace('#/', '');
        if (newHash) switchSection(newHash, false);
    };
}

function bindFilterEvents() {
    const filters = ['filterCategory', 'filterStatus', 'filterDate'];
    filters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onchange = () => fetchImages(1);
    });

    const searchInput = document.getElementById('globalSearch');
    if (searchInput) {
        searchInput.oninput = debounce(() => fetchImages(1), 500);
    }
}

// Navigation Logic
function bindNavEvents() {
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            const sectionId = link.getAttribute('data-section');
            switchSection(sectionId);
            closeMobileMenu();
        };
    });
}

async function switchSection(sectionId, updateHash = true) {
    if (updateHash) window.location.hash = `#/${sectionId}`;

    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.remove('active');
        if (l.getAttribute('data-section') === sectionId) l.classList.add('active');
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
            const firstTab = document.querySelector('#section-resources .s-nav-item');
            if (firstTab) switchResourcesTab(firstTab, 'categories');
        }
        if (sectionId === 'dashboard') loadStats();
        if (sectionId === 'media') fetchImages();
        if (sectionId === 'api') fetchApiKeys();
        if (sectionId === 'settings') {
            fetchSettings();
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
        const response = await fetch(`${API_BASE}/categories?t=${Date.now()}`, { headers: getAuthHeader() });
        categories = await response.json();
        const options = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        const filterCat = document.getElementById('filterCategory');
        if (filterCat) filterCat.innerHTML = '<option value="0">全部分类</option>' + options;
        if (document.getElementById('editCategory')) document.getElementById('editCategory').innerHTML = options;
        if (document.getElementById('uploadCategory')) document.getElementById('uploadCategory').innerHTML = options;
    } catch (err) { console.error(err); }
}

async function fetchImages(page = 1) {
    currentPage = page;
    try {
        const query = new URLSearchParams({
            search: document.getElementById('globalSearch').value,
            category_id: document.getElementById('filterCategory').value,
            status: document.getElementById('filterStatus').value,
            sort: document.getElementById('filterDate').value,
            page: page,
            t: Date.now()
        });
        const response = await fetch(`${API_BASE}/admin/images?${query.toString()}`, { headers: getAuthHeader() });
        if (response.status === 401) return logout();
        const result = await response.json();
        currentImages = result.data || [];
        renderImages();
        renderPagination(result.total, result.limit);
    } catch (err) { console.error(err); }
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
            if (i === currentPage) {
                pageBtn.style.background = 'var(--accent-primary)';
                pageBtn.style.color = '#000';
            }
            pageBtn.innerText = i;
            pageBtn.onclick = () => fetchImages(i);
            container.appendChild(pageBtn);
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            const dots = document.createElement('span');
            dots.innerText = '...';
            dots.style.color = 'var(--text-secondary)';
            dots.style.padding = '0 5px';
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
        card.onclick = (e) => { if (e.ctrlKey || e.metaKey) toggleSelection(img.id); else openDetailPanel(img.id); };
        const sizeMB = img.file_size ? (img.file_size / (1024 * 1024)).toFixed(1) : '0.0';
        card.innerHTML = `
            <div class="card-thumb"><img src="${API_BASE}/thumb?path=${encodeURIComponent(img.path)}" alt="" loading="lazy"></div>
            <div class="card-body">
                <div class="card-title">${escapeHTML(img.title) || 'Untitled'}</div>
                <div class="card-meta"><span>${sizeMB} MB</span></div>
            </div>
        `;
        imageGrid.appendChild(card);
    });
    updateBatchToolbar();
}

function renderCategoryList() {
    const container = document.getElementById('categoryListContainer');
    if (!container) return;
    let html = `<div class="list-header"><span class="list-id">ID</span><span>分类名称</span><span class="list-actions">操作</span></div>`;
    html += categories.map(c => `
        <div class="list-row">
            <div class="list-id" style="color:var(--text-secondary); font-size:13px;">${c.id}</div>
            <div style="font-weight:600;">${c.name}</div>
            <div class="list-actions">
                <button class="btn-primary" onclick="editCategoryName(${c.id}, '${c.name}')">
                    <i class="fas fa-edit"></i> 编辑
                </button>
                <button class="btn-danger" onclick="deleteCategory(${c.id})">
                    <i class="fas fa-trash-alt"></i> 删除
                </button>
            </div>
        </div>`).join('');
    container.innerHTML = html;
}

function editCategoryName(id, oldName) {
    document.getElementById('editCatId').value = id;
    document.getElementById('editCatName').value = oldName;
    openModal('editCategoryModal');
}

async function deleteCategory(id) {
    if (!confirm('确定删除此分类吗？')) return;
    try {
        const resp = await fetch(`${API_BASE}/admin/categories/${id}`, { method: 'DELETE', headers: getAuthHeader() });
        if (resp.ok) {
            showToast('分类已删除');
            await fetchCategories();
            renderCategoryList();
        } else {
            const data = await resp.json();
            showToast(data.error || '删除失败', 'error');
        }
    } catch (err) { showToast('操作失败', 'error'); }
}

async function fetchStorage() {
    try {
        const resp = await fetch(`${API_BASE}/admin/storage?t=${Date.now()}`, { headers: getAuthHeader() });
        const configs = await resp.json();
        renderStorageList(configs);
    } catch (err) { console.error(err); }
}

function renderStorageList(configs) {
    const container = document.getElementById('storageListContainer');
    if (!container) return;
    const activeCount = configs.filter(c => c.is_active).length;
    let html = `<div class="list-header"><span>节点路径</span><span>状态</span><span class="list-actions">操作</span></div>`;
    html += configs.map(s => `
        <div class="list-row">
            <div style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.base_path}</div>
            <div style="color:${s.is_active ? 'var(--success)' : 'var(--text-secondary)'}; font-weight:600;">
                <i class="fas ${s.is_active ? 'fa-check-circle' : 'fa-circle-notch'}"></i> ${s.is_active ? '活跃' : '闲置'}
            </div>
            <div class="list-actions">
                ${(!s.is_active || activeCount > 1) ? `<button class="btn-batch" onclick="activateStorage(${s.id})" style="border-color:var(--accent-primary); color:var(--accent-primary);">设为活跃</button>` : ''}
                <button class="btn-danger" onclick="deleteStorage(${s.id})">
                    <i class="fas fa-trash-alt"></i> 删除
                </button>
            </div>
        </div>`).join('');
    container.innerHTML = html;
}


async function activateStorage(id) {
    try {
        const resp = await fetch(`${API_BASE}/admin/storage/${id}/active`, { method: 'PUT', headers: getAuthHeader() });
        if (resp.ok) {
            showToast('已切换活跃节点');
            fetchStorage();
        } else {
            const data = await resp.json();
            showToast(data.error || '激活失败', 'error');
        }
    } catch (err) { showToast('请求失败', 'error'); }
}

async function deleteStorage(id) {
    if (!confirm('确定删除此路径吗？')) return;
    try {
        const resp = await fetch(`${API_BASE}/admin/storage/${id}`, { method: 'DELETE', headers: getAuthHeader() });
        if (resp.ok) {
            showToast('存储节点已删除');
            fetchStorage();
        } else {
            const data = await resp.json();
            showToast(data.error || '删除失败', 'error');
        }
    } catch (err) { showToast('操作失败', 'error'); }
}


function toggleSelection(id) { if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); renderImages(); }
function selectAllImages() { currentImages.forEach(img => selectedIds.add(img.id)); renderImages(); }

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
    if (action === 'delete') if (!confirm(`确定要永久删除选中的 ${selectedIds.size} 张图片吗？`)) return;
    try {
        const response = await fetch(`${API_BASE}/admin/images/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify({ ids: Array.from(selectedIds), action: action }) });
        if (response.ok) { 
            showToast('批量操作成功');
            selectedIds.clear(); 
            fetchImages(); 
            loadStats(); 
        }
    } catch (err) { showToast('操作失败', 'error'); }
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
    document.getElementById('editSourceURL').value = img.source_url || '';
    document.getElementById('editVisible').checked = img.is_visible;

    // Populate Metadata
    document.getElementById('infoResolution').innerText = (img.width && img.height) ? `${img.width} x ${img.height}` : '--';
    const sizeMB = img.file_size ? (img.file_size / (1024 * 1024)).toFixed(2) : '0.00';
    document.getElementById('infoSize').innerText = `${sizeMB} MB`;
    document.getElementById('infoFormat').innerText = img.format || '--';
    document.getElementById('infoDate').innerText = img.created_at ? new Date(img.created_at).toLocaleString() : '--';

    // Populate Tags
    const tagContainer = document.getElementById('tagContainer');
    const editTagsInput = document.getElementById('editTags');
    if (tagContainer) {
        tagContainer.innerHTML = '';
        if (img.tags && img.tags.length > 0) {
            img.tags.forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'tag';
                tagEl.innerText = tag.name;
                tagContainer.appendChild(tagEl);
            });
            editTagsInput.value = img.tags.map(t => t.name).join(', ');
        } else {
            editTagsInput.value = '';
        }
    }

    detailPanel.classList.add('open');
    if (batchToolbar) batchToolbar.classList.remove('show');
}

function closeDetailPanel() { 
    detailPanel.classList.remove('open'); 
    currentImageId = null; 
    if (selectedIds.size > 0 && batchToolbar) batchToolbar.classList.add('show');
}

async function saveImageDetails() {
    if (!currentImageId) return;
    const tagsValue = document.getElementById('editTags').value;
    const tags = tagsValue ? tagsValue.split(',').map(t => t.trim()).filter(t => t !== "") : [];

    const data = {
        title: document.getElementById('editTitle').value,
        description: document.getElementById('editDesc').value,
        category_id: parseInt(document.getElementById('editCategory').value),
        location: document.getElementById('editLocation').value,
        source_url: document.getElementById('editSourceURL').value,
        is_visible: document.getElementById('editVisible').checked,
        tags: tags
    };
    try {
        const response = await fetch(`${API_BASE}/admin/images/${currentImageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(data)
        });
        if (response.ok) {
            showToast('保存成功');
            closeDetailPanel();
            fetchImages();
        } else {
            const result = await response.json();
            showToast(result.error || '保存失败', 'error');
        }
    } catch (err) { showToast('保存失败', 'error'); }
}

function openUploadModal() {
    fetchCategories();
    openModal('uploadModal');
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = 'flex';
        setTimeout(() => el.classList.add('active'), 10);
    }
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('active');
        setTimeout(() => el.style.display = 'none', 300);
    }
}

function updateFileList(input) {
    const display = document.getElementById('fileListNames');
    if (input.files.length > 0) {
        display.innerText = input.files.length === 1 ? `已选择: ${input.files[0].name}` : `已选择 ${input.files.length} 个文件`;
    } else {
        display.innerText = '';
    }
}

document.getElementById('modeLocal').onclick = () => {
    document.getElementById('localInput').style.display = 'block';
    document.getElementById('remoteInput').style.display = 'none';
    document.getElementById('modeLocal').style.background = 'var(--accent-primary)';
    document.getElementById('modeLocal').style.color = '#000';
    document.getElementById('modeRemote').style.background = 'rgba(255,255,255,0.05)';
    document.getElementById('modeRemote').style.color = '#fff';
};

document.getElementById('modeRemote').onclick = () => {
    document.getElementById('localInput').style.display = 'none';
    document.getElementById('remoteInput').style.display = 'block';
    document.getElementById('modeRemote').style.background = 'var(--accent-primary)';
    document.getElementById('modeRemote').style.color = '#000';
    document.getElementById('modeLocal').style.background = 'rgba(255,255,255,0.05)';
    document.getElementById('modeLocal').style.color = '#fff';
};

document.getElementById('uploadForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerText = '正在上传...';
    try {
        const mode = document.getElementById('localInput').style.display !== 'none' ? 'local' : 'remote';
        const catId = document.getElementById('uploadCategory').value;
        const title = document.getElementById('uploadTitle').value;
        const location = document.getElementById('uploadLocation').value;
        const tags = document.getElementById('uploadTags').value;

        if (mode === 'local') {
            const files = document.getElementById('fileInput').files;
            for (let i = 0; i < files.length; i++) {
                const formData = new FormData();
                formData.append('image', files[i]);
                formData.append('title', title || files[i].name);
                formData.append('category_id', catId);
                formData.append('location', location);
                formData.append('tags', tags);
                await fetch(`${API_BASE}/admin/upload`, { method: 'POST', headers: getAuthHeader(), body: formData });
            }
        } else {
            const url = document.getElementById('urlInput').value;
            if (!url) return showToast('请输入图片 URL', 'error');
            const tagsList = tags ? tags.split(',').map(t => t.trim()).filter(t => t !== "") : [];
            await fetch(`${API_BASE}/admin/remote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify({ url, title, category_id: parseInt(catId), location, tags: tagsList })
            });
        }
        closeModal('uploadModal'); fetchImages(); loadStats();
        showToast('上传成功');
    } catch (err) { showToast('上传失败', 'error'); } finally { btn.disabled = false; btn.innerText = originalText; }
};

document.getElementById('editCategoryForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('editCatId').value;
    const name = document.getElementById('editCatName').value;
    try {
        const res = await fetch(`${API_BASE}/admin/categories/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            showToast('修改成功');
            closeModal('editCategoryModal');
            await fetchCategories();
            renderCategoryList();
        } else {
            const data = await res.json();
            showToast(data.error || '修改失败', 'error');
        }
    } catch (err) { showToast('网络错误', 'error'); }
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
        if (res.ok) {
            showToast('分类添加成功');
            closeModal('categoryModal');
            await fetchCategories();
            renderCategoryList();
            e.target.reset();
        } else {
            const data = await res.json();
            showToast(data.error || '添加失败', 'error');
        }
    } catch (err) { showToast('网络错误', 'error'); }
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
        if (res.ok) {
            showToast('存储节点已添加');
            closeModal('storageModal');
            fetchStorage();
            e.target.reset();
        } else {
            const result = await res.json();
            showToast(result.error || '添加失败', 'error');
        }
    } catch (err) { showToast('网络错误', 'error'); }
};

async function reindexFiles() {
    const btn = document.getElementById('reindexBtn');
    const originalText = btn.innerHTML;
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在重建...';
        const res = await fetch(`${API_BASE}/admin/reindex`, { method: 'POST', headers: getAuthHeader() });
        const result = await res.json();
        showToast(result.message || '重建完成');
        fetchImages(); loadStats(); fetchCategories();
    } catch (err) { showToast('重建索引失败', 'error'); } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}

async function fetchSettings() {
    try {
        const resp = await fetch(`${API_BASE}/admin/settings?t=${Date.now()}`, { headers: getAuthHeader() });
        const data = await resp.json();
        document.getElementById('siteTitle').value = data.siteTitle || '';
        document.getElementById('siteDesc').value = data.siteDesc || '';
        document.getElementById('siteFooter').value = data.siteFooter || '';
        document.getElementById('siteBeian').value = data.siteBeian || '';
        if (document.getElementById('adminBrandName')) document.getElementById('adminBrandName').innerText = data.siteTitle || 'ImagesGallery';

        // Upload settings
        const upTab = document.getElementById('tab-upload');
        if (upTab) {
            if (data.maxFileSize) upTab.querySelector('input[type="number"]').value = data.maxFileSize;
            if (data.allowedExts) upTab.querySelector('input[type="text"]').value = data.allowedExts;
            if (data.autoCompress) upTab.querySelector('input[type="checkbox"]').checked = data.autoCompress === "true";
        }

        // Display settings
        const dispTab = document.getElementById('tab-display');
        if (dispTab) {
            if (data.itemsPerPage) dispTab.querySelector('input[type="number"]').value = data.itemsPerPage;
            if (data.defaultSort) document.getElementById('selectDefaultSort').value = data.defaultSort;
        }

        fetchUserInfo();
    } catch (err) { console.error(err); }
}

async function fetchUserInfo() {
    try {
        const resp = await fetch(`${API_BASE}/admin/account_info?t=${Date.now()}`, { headers: getAuthHeader() });
        const user = await resp.json();
        if (document.getElementById('newAdminName')) document.getElementById('newAdminName').value = user.username || 'Admin';
        if (document.getElementById('adminName')) document.getElementById('adminName').innerText = user.username || 'Admin';
    } catch (err) { }
}

async function saveGeneralSettings() {
    const data = {
        siteTitle: document.getElementById('siteTitle').value,
        siteDesc: document.getElementById('siteDesc').value,
        siteFooter: document.getElementById('siteFooter').value,
        siteBeian: document.getElementById('siteBeian').value
    };
    await saveSettings(data);
    if (document.getElementById('adminBrandName')) document.getElementById('adminBrandName').innerText = data.siteTitle || 'ImagesGallery';
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
    const data = {
        itemsPerPage: document.querySelector('#tab-display input[type="number"]').value,
        defaultSort: document.getElementById('selectDefaultSort').value
    };
    await saveSettings(data);

    // 同步保存外部访问设置
    const enable = document.getElementById('externalAccessToggle').checked;
    const port = document.getElementById('externalPortInput').value;
    try {
        await fetch(`${API_BASE}/system/external_access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ enable, port })
        });
    } catch (err) { console.error('Failed to sync external access', err); }
}

async function fetchSystemStatus() {
    try {
        const resp = await fetch(`${API_BASE}/system/status?t=${Date.now()}`, { headers: getAuthHeader() });
        const data = await resp.json();
        const toggle = document.getElementById('externalAccessToggle');
        const portInput = document.getElementById('externalPortInput');
        if (toggle) toggle.checked = data.external_enabled;
        if (portInput) portInput.value = data.port || '23721';
    } catch (err) { console.error('Failed to fetch system status', err); }
}

async function saveSettings(data) {
    try {
        const resp = await fetch(`${API_BASE}/admin/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(data)
        });
        if (resp.ok) showToast('设置已保存');
    } catch (err) { showToast('保存失败', 'error'); }
}

async function updatePassword() {
    const inputs = document.getElementById('tab-account').querySelectorAll('input[type="password"]');
    const oldPass = inputs[0].value;
    const newPass = inputs[1].value;
    const confirmPass = inputs[2].value;
    const newName = document.getElementById('newAdminName').value;

    if (newPass && newPass !== confirmPass) return showToast('两次输入的新密码不一致', 'error');

    try {
        const resp = await fetch(`${API_BASE}/admin/account`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ username: newName, old_password: oldPass, new_password: newPass })
        });
        if (resp.ok) {
            showToast('账户信息已更新');
            if (newPass) { 
                showToast('密码已修改，请重新登录'); 
                setTimeout(() => logout(), 1500); 
            }
            else fetchUserInfo();
        } else {
            const data = await resp.json();
            showToast(data.error || '更新失败', 'error');
        }
    } catch (err) { showToast('请求失败', 'error'); }
}

async function fetchApiKeys() {
    try {
        const res = await fetch(`${API_BASE}/admin/apikeys?t=${Date.now()}`, { headers: getAuthHeader() });
        const keys = await res.json();
        const tbody = document.getElementById('apiKeysTableBody');
        if (!tbody) return;
        tbody.innerHTML = keys.length ? keys.map(k => `
            <tr>
                <td>${k.name}</td>
                <td style="font-family: monospace; color: var(--accent-primary);">${k.token}</td>
                <td>${k.rate_limit} 次/分钟</td>
                <td><span style="color: ${k.is_active ? 'var(--success)' : 'var(--danger)'}">${k.is_active ? '活跃' : '禁用'}</span></td>
                <td><button class="btn-danger" onclick="deleteApiKey(${k.id})">删除</button></td>
            </tr>`).join('') : `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无私有密钥</td></tr>`;
    } catch (err) { console.error(err); }
}

function openApiKeyModal() {
    document.getElementById('apiKeyName').value = '';
    document.getElementById('apiKeyRateLimit').value = '120';
    openModal('apiKeyModal');
}

async function submitCreateApiKey() {
    const name = document.getElementById('apiKeyName').value.trim();
    const rateLimit = parseInt(document.getElementById('apiKeyRateLimit').value);
    if (!name) return showToast('请输入密钥名称', 'error');
    try {
        const resp = await fetch(`${API_BASE}/admin/apikeys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({ name, rate_limit: rateLimit })
        });
        if (resp.ok) { 
            showToast('密钥创建成功');
            closeModal('apiKeyModal'); 
            fetchApiKeys(); 
        }
    } catch (err) { showToast('请求失败', 'error'); }
}

async function deleteApiKey(id) {
    if (!confirm('确定删除此密钥吗？')) return;
    try {
        const resp = await fetch(`${API_BASE}/admin/apikeys/${id}`, { method: 'DELETE', headers: getAuthHeader() });
        if (resp.ok) {
            showToast('密钥已删除');
            fetchApiKeys();
        }
    } catch (err) { showToast('删除失败', 'error'); }
}

function switchSettingsTab(el, tabId) {
    document.querySelectorAll('#section-settings .s-nav-item').forEach(item => item.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('#section-settings .s-tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
}

function switchResourcesTab(el, tabId) {
    document.querySelectorAll('#section-resources .s-nav-item').forEach(item => item.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('#section-resources .s-tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`res-tab-${tabId}`).classList.add('active');
}

function toggleMobileMenu() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebarOverlay').classList.toggle('active'); }
function closeMobileMenu() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('active'); }
function logout() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('adminUser'); window.location.href = getBaseUrl() + '/login'; }

init();

