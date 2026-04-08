function getCgiUrl() {
    let p = window.location.pathname;
    if (p.includes('index.cgi')) {
        if (!p.endsWith('/')) p = p.replace(/[^/]*$/, '');
        return p.replace(/\/$/, '');
    }
    if (!p.endsWith('/')) p = p.replace(/[^/]*$/, '');
    return p + 'index.cgi';
}

function apiRequest(endpoint, options = {}) {
    const url = getCgiUrl() + endpoint;
    return fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    }).then(response => response.json());
}

let currentCategory = '';
let currentKeyword = '';

function init() {
    loadApps();
    setupEventListeners();
}

function setupEventListeners() {
    document.getElementById('searchBtn').addEventListener('click', function() {
        currentKeyword = document.getElementById('searchInput').value;
        loadApps();
    });

    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            currentKeyword = this.value;
            loadApps();
        }
    });

    document.querySelectorAll('.app-nav li a[data-category]').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.app-nav li').forEach(function(li) {
                li.classList.remove('active');
            });
            this.parentElement.classList.add('active');
            currentCategory = this.dataset.category;
            loadApps();
        });
    });

    document.getElementById('sourceManager').addEventListener('click', function(e) {
        e.preventDefault();
        showSourceManager();
    });

    document.getElementById('appDetailOverlay').addEventListener('click', function() {
        hideAppDetail();
    });

    document.getElementById('sourceManagerOverlay').addEventListener('click', function() {
        hideSourceManager();
    });

    document.getElementById('settingsManager').addEventListener('click', function(e) {
        e.preventDefault();
        showSettingsManager();
    });

    document.getElementById('settingsManagerOverlay').addEventListener('click', function() {
        hideSettingsManager();
    });
}

async function loadApps() {
    const appGrid = document.getElementById('appGrid');
    appGrid.innerHTML = '<div class="loading">加载中...</div>';

    try {
        let endpoint = `/api/apps?`;
        if (currentCategory) {
            endpoint += `category=${encodeURIComponent(currentCategory)}&`;
        }
        if (currentKeyword) {
            endpoint += `keyword=${encodeURIComponent(currentKeyword)}&`;
        }

        const data = await apiRequest(endpoint);

        if (data.code === 0) {
            renderAppGrid(data.data.apps);
        } else {
            appGrid.innerHTML = '<div class="empty-state"><p>加载应用失败</p></div>';
        }
    } catch (error) {
        console.error('加载应用失败:', error);
        appGrid.innerHTML = '<div class="empty-state"><p>网络错误，请重试</p></div>';
    }
}

function renderAppGrid(apps) {
    const appGrid = document.getElementById('appGrid');

    if (!apps || apps.length === 0) {
        appGrid.innerHTML = '<div class="empty-state"><p>暂无应用</p></div>';
        return;
    }

    appGrid.innerHTML = '';

    apps.forEach(function(app) {
        const card = createAppCard(app);
        appGrid.appendChild(card);
    });
}

function createAppCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card';

    const iconHtml = app.icon
        ? `<img src="${app.icon}" alt="${app.name}">`
        : `<span style="color: white; font-size: 28px;">${app.name.charAt(0).toUpperCase()}</span>`;

    card.innerHTML = `
        <div class="app-icon">${iconHtml}</div>
        <h3 class="app-name">${escapeHtml(app.name)}</h3>
        <p class="app-desc">${escapeHtml(app.description || '')}</p>
        <div class="app-info">
            <span class="app-version">v${escapeHtml(app.version)}</span>
            <span class="app-size">${escapeHtml(app.size || 'N/A')} MB</span>
        </div>
        <button class="app-download" data-app-id="${escapeHtml(app.id)}">下载安装</button>
    `;

    card.addEventListener('click', function(e) {
        if (!e.target.classList.contains('app-download')) {
            showAppDetail(app.id);
        }
    });

    const downloadBtn = card.querySelector('.app-download');
    downloadBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        downloadApp(app);
    });

    return card;
}

async function showAppDetail(appId) {
    try {
        const [appData, statusData] = await Promise.all([
            apiRequest(`/api/apps/${appId}`),
            apiRequest(`/api/apps/${appId}/status`)
        ]);

        if (appData.code === 0) {
            const app = appData.data;
            app.status = statusData.code === 0 ? statusData.data : { status: 'unknown', running: false };
            renderAppDetail(app);
            showDetailDialog();
        }
    } catch (error) {
        console.error('获取应用详情失败:', error);
    }
}

function renderAppDetail(app) {
    const detailEl = document.getElementById('appDetail');

    const categories = Array.isArray(app.categories) ? app.categories.join(', ') : '';
    const iconHtml = app.icon
        ? `<img src="${app.icon}" alt="${app.name}" style="width: 80px; height: 80px; object-fit: cover;">`
        : `<div style="width: 80px; height: 80px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 16px; display: flex; align-items: center; justify-content: center;"><span style="color: white; font-size: 36px;">${app.name.charAt(0).toUpperCase()}</span></div>`;

    // Generate action buttons based on app status
    let actionButtons = '';
    const status = app.status || { status: 'unknown', running: false };

    if (status.status === 'not_installed') {
        actionButtons = `<button class="btn-primary" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">安装</button>`;
    } else if (status.status === 'running') {
        actionButtons = `
            <button class="btn-secondary" onclick="stopApp('${app.id}')">停止</button>
            <button class="btn-danger" onclick="uninstallApp('${app.id}', '${app.name}')">卸载</button>
        `;
    } else if (status.status === 'stopped') {
        actionButtons = `
            <button class="btn-primary" onclick="startApp('${app.id}')">启动</button>
            <button class="btn-danger" onclick="uninstallApp('${app.id}', '${app.name}')">卸载</button>
        `;
    } else {
        actionButtons = `<button class="btn-primary" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">安装</button>`;
    }

    detailEl.innerHTML = `
        <div class="dialog-header">
            <h2>${escapeHtml(app.name)}</h2>
            <button class="close-btn" onclick="hideAppDetail()">&times;</button>
        </div>
        <div class="detail-body" style="display: flex; gap: 24px;">
            <div style="flex-shrink: 0;">${iconHtml}</div>
            <div style="flex: 1;">
                <div class="detail-info-grid">
                    <div class="info-item">
                        <div class="info-label">版本</div>
                        <div class="info-value">v${escapeHtml(app.version)}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">大小</div>
                        <div class="info-value">${escapeHtml(app.size || 'N/A')} MB</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">平台</div>
                        <div class="info-value">${escapeHtml(app.platform)}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">分类</div>
                        <div class="info-value">${escapeHtml(categories)}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">状态</div>
                        <div class="info-value">${status.status === 'running' ? '运行中' : status.status === 'stopped' ? '已停止' : status.status === 'not_installed' ? '未安装' : '未知'}</div>
                    </div>
                    ${app.author ? `
                    <div class="info-item">
                        <div class="info-label">开发者</div>
                        <div class="info-value">${escapeHtml(app.author)}</div>
                    </div>` : ''}
                    ${app.publisher ? `
                    <div class="info-item">
                        <div class="info-label">发布者</div>
                        <div class="info-value">${escapeHtml(app.publisher)}</div>
                    </div>` : ''}
                </div>

                ${app.description ? `
                <div style="margin-bottom: 20px;">
                    <div class="info-label" style="margin-bottom: 8px;">应用描述</div>
                    <div style="font-size: 14px; line-height: 1.6; color: #666;">${escapeHtml(app.description)}</div>
                </div>` : ''}

                ${app.changelog ? `
                <div style="margin-bottom: 20px;">
                    <div class="info-label" style="margin-bottom: 8px;">更新日志</div>
                    <div style="font-size: 14px; line-height: 1.6; color: #666;">${escapeHtml(app.changelog)}</div>
                </div>` : ''}

                <div class="detail-actions">
                    ${actionButtons}
                    <button class="btn-secondary" onclick="hideAppDetail()">关闭</button>
                </div>
            </div>
        </div>
    `;
}

function showDetailDialog() {
    document.getElementById('appDetailOverlay').classList.add('active');
    document.getElementById('appDetail').classList.add('active');
}

function hideAppDetail() {
    document.getElementById('appDetailOverlay').classList.remove('active');
    document.getElementById('appDetail').classList.remove('active');
}

async function downloadApp(app) {
    if (!app || !app.id) {
        alert('应用信息无效');
        return;
    }

    if (!confirm(`确定要安装 ${app.name} 吗？`)) {
        return;
    }

    try {
        const data = await apiRequest(`/api/apps/${app.id}/install`, {
            method: 'POST'
        });

        if (data.code === 0) {
            alert('安装成功！');
            hideAppDetail();
            loadApps();
        } else {
            alert('安装失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('安装失败:', error);
        alert('网络错误，请重试');
    }
}

async function installApp(app) {
    if (!app || !app.id) {
        alert('应用信息无效');
        return;
    }

    if (!confirm(`确定要安装 ${app.name} 吗？`)) {
        return;
    }

    try {
        const data = await apiRequest(`/api/apps/${app.id}/install`, {
            method: 'POST'
        });

        if (data.code === 0) {
            alert('安装成功！');
            hideAppDetail();
            loadApps();
        } else {
            alert('安装失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('安装失败:', error);
        alert('网络错误，请重试');
    }
}

async function startApp(appId) {
    try {
        const data = await apiRequest(`/api/apps/${appId}/start`, {
            method: 'POST'
        });

        if (data.code === 0) {
            alert('启动成功！');
            hideAppDetail();
            loadApps();
        } else {
            alert('启动失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('启动失败:', error);
        alert('网络错误，请重试');
    }
}

async function stopApp(appId) {
    if (!confirm('确定要停止此应用吗？')) {
        return;
    }

    try {
        const data = await apiRequest(`/api/apps/${appId}/stop`, {
            method: 'POST'
        });

        if (data.code === 0) {
            alert('停止成功！');
            hideAppDetail();
            loadApps();
        } else {
            alert('停止失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('停止失败:', error);
        alert('网络错误，请重试');
    }
}

async function uninstallApp(appId, appName) {
    if (!confirm(`确定要卸载 ${appName} 吗？卸载后将无法恢复。`)) {
        return;
    }

    try {
        const data = await apiRequest(`/api/apps/${appId}`, {
            method: 'DELETE'
        });

        if (data.code === 0) {
            alert('卸载成功！');
            hideAppDetail();
            loadApps();
        } else {
            alert('卸载失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('卸载失败:', error);
        alert('网络错误，请重试');
    }
}

async function showSourceManager() {
    try {
        const data = await apiRequest('/api/sources');

        if (data.code === 0) {
            renderSourceManager(data.data.sources);
            showDialog();
        }
    } catch (error) {
        console.error('加载源列表失败:', error);
    }
}

function renderSourceManager(sources) {
    const dialog = document.getElementById('sourceManagerDialog');

    const tableRows = sources.map(function(source) {
        return `
            <tr>
                <td>${escapeHtml(source.name)}</td>
                <td>${escapeHtml(source.url)}</td>
                <td>${source.enabled ? '启用' : '禁用'}</td>
                <td>${source.app_count || 0}</td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn sync-btn" onclick="syncSource('${escapeHtml(source.id)}')">同步</button>
                        ${!source.local ? `<button class="action-btn delete-btn" onclick="deleteSource('${escapeHtml(source.id)}')">删除</button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    dialog.innerHTML = `
        <div class="dialog-header">
            <h2>源管理</h2>
            <button class="close-btn" onclick="hideSourceManager()">&times;</button>
        </div>
        <div class="dialog-body">
            <button class="add-source-btn" onclick="showAddSourceDialog()">添加源</button>
            <table class="source-table">
                <thead>
                    <tr>
                        <th>名称</th>
                        <th>地址</th>
                        <th>状态</th>
                        <th>应用数量</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
}

function showDialog() {
    document.getElementById('sourceManagerOverlay').classList.add('active');
    document.getElementById('sourceManagerDialog').classList.add('active');
}

function hideSourceManager() {
    document.getElementById('sourceManagerOverlay').classList.remove('active');
    document.getElementById('sourceManagerDialog').classList.remove('active');
}

function showAddSourceDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'source-manager-overlay active';
    overlay.onclick = function() { document.body.removeChild(this); };

    const dialog = document.createElement('div');
    dialog.className = 'source-manager active';
    dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; padding: 24px; min-width: 400px; z-index: 1000;';
    dialog.innerHTML = `
        <h3 style="margin-bottom: 20px; font-size: 18px;">添加源</h3>
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #666;">源名称</label>
            <input type="text" id="addSourceName" placeholder="例如：第三方应用源" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #666;">源地址</label>
            <input type="text" id="addSourceUrl" placeholder="例如：http://fpk.example.com:18088" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        <div style="display: flex; gap: 12px;">
            <button onclick="confirmAddSource()" style="flex: 1; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">确定</button>
            <button onclick="document.body.removeChild(document.body.lastChild); document.body.removeChild(document.body.lastChild);" style="padding: 10px 20px; background: #f0f0f0; color: #333; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">取消</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);
}

async function confirmAddSource() {
    const name = document.getElementById('addSourceName').value.trim();
    const url = document.getElementById('addSourceUrl').value.trim();

    if (!name || !url) {
        alert('请填写完整的源信息');
        return;
    }

    try {
        const data = await apiRequest('/api/sources', {
            method: 'POST',
            body: JSON.stringify({ name: name, url: url })
        });

        if (data.code === 0) {
            alert('添加源成功');
            document.body.removeChild(document.body.lastChild);
            document.body.removeChild(document.body.lastChild);
            showSourceManager();
        } else {
            alert('添加源失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('添加源失败:', error);
        alert('网络错误，请重试');
    }
}

async function syncSource(sourceId) {
    try {
        const data = await apiRequest(`/api/sources/${encodeURIComponent(sourceId)}/sync`, {
            method: 'POST'
        });

        if (data.code === 0) {
            alert(`同步成功！新增: ${data.data.added}, 更新: ${data.data.updated}, 移除: ${data.data.removed}`);
            showSourceManager();
            loadApps();
        } else {
            alert('同步失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('同步源失败:', error);
        alert('网络错误，请重试');
    }
}

async function deleteSource(sourceId) {
    if (!confirm('确定要删除此源吗？删除后将无法恢复该源的应用数据。')) {
        return;
    }

    try {
        const data = await apiRequest(`/api/sources/${encodeURIComponent(sourceId)}`, {
            method: 'DELETE'
        });

        if (data.code === 0) {
            alert('删除成功');
            showSourceManager();
            loadApps();
        } else {
            alert('删除失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('删除源失败:', error);
        alert('网络错误，请重试');
    }
}

async function showSettingsManager() {
    try {
        const data = await apiRequest('/api/settings');

        if (data.code === 0) {
            renderSettingsManager(data.data);
            showSettingsDialog();
        }
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

function renderSettingsManager(settings) {
    const dialog = document.getElementById('settingsManagerDialog');

    dialog.innerHTML = `
        <div class="dialog-header">
            <h2>应用设置</h2>
            <button class="close-btn" onclick="hideSettingsManager()">&times;</button>
        </div>
        <div class="dialog-body">
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #666;">AppStore 存储目录</label>
                <input type="text" id="appStoreDirInput" value="${escapeHtml(settings.appStoreDir || '')}" placeholder="例如：/vol1/我的文件/AppStore" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px;">
                <p style="margin-top: 8px; font-size: 12px; color: #999;">请输入一个应用有访问权限的目录路径</p>
            </div>
            <div class="detail-actions">
                <button class="btn-primary" onclick="saveSettings()">保存设置</button>
                <button class="btn-secondary" onclick="hideSettingsManager()">关闭</button>
            </div>
        </div>
    `;
}

function showSettingsDialog() {
    document.getElementById('settingsManagerOverlay').classList.add('active');
    document.getElementById('settingsManagerDialog').classList.add('active');
}

function hideSettingsManager() {
    document.getElementById('settingsManagerOverlay').classList.remove('active');
    document.getElementById('settingsManagerDialog').classList.remove('active');
}

async function saveSettings() {
    const appStoreDir = document.getElementById('appStoreDirInput').value.trim();

    try {
        const data = await apiRequest('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ appStoreDir: appStoreDir })
        });

        if (data.code === 0) {
            alert('保存设置成功');
            hideSettingsManager();
            // 重新加载应用列表
            loadApps();
        } else {
            alert('保存设置失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('保存设置失败:', error);
        alert('网络错误，请重试');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.onload = init;
