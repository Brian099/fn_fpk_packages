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
let currentTab = 'all';

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

    document.querySelectorAll('.app-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.app-tab').forEach(function(b) {
                b.classList.remove('active');
            });
            this.classList.add('active');
            currentTab = this.dataset.tab;
            loadApps();
        });
    });

    document.querySelectorAll('.nav-item[data-category]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.nav-item').forEach(function(b) {
                b.classList.remove('active');
            });
            this.classList.add('active');
            currentCategory = this.dataset.category;
            loadApps();
        });
    });

    document.getElementById('settingsBtn').addEventListener('click', function(e) {
        e.preventDefault();
        showSettingsManager();
    });

    document.getElementById('settingsManager').addEventListener('click', function(e) {
        e.preventDefault();
        showSettingsManager();
    });

    document.getElementById('appDetailOverlay').addEventListener('click', function() {
        hideAppDetail();
    });

    document.getElementById('settingsOverlay').addEventListener('click', function() {
        hideSettingsManager();
    });

    document.getElementById('minimizeBtn').addEventListener('click', function() {
        if (window.android && window.android.minimize) {
            window.android.minimize();
        } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.minimize) {
            window.webkit.messageHandlers.minimize.postMessage({});
        }
    });

    document.getElementById('maximizeBtn').addEventListener('click', function() {
        if (window.android && window.android.maximize) {
            window.android.maximize();
        } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.maximize) {
            window.webkit.messageHandlers.maximize.postMessage({});
        }
    });

    document.getElementById('closeBtn').addEventListener('click', function() {
        if (window.android && window.android.close) {
            window.android.close();
        } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.close) {
            window.webkit.messageHandlers.close.postMessage({});
        }
    });
}

async function loadApps() {
    const appGrid = document.getElementById('appGrid');
    appGrid.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>加载中...</p></div>';

    try {
        let endpoint;
        switch (currentTab) {
            case 'built-in':
                endpoint = '/api/apps/built-in';
                break;
            case 'user':
                endpoint = '/api/apps/user';
                break;
            default:
                endpoint = '/api/apps';
        }

        if (currentCategory) {
            endpoint += (endpoint.includes('?') ? '&' : '?') + `category=${encodeURIComponent(currentCategory)}&`;
        }
        if (currentKeyword) {
            endpoint += (endpoint.includes('?') ? '&' : '?') + `keyword=${encodeURIComponent(currentKeyword)}&`;
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
        : `<span style="color: white; font-size: 24px;">${app.name.charAt(0).toUpperCase()}</span>`;

    card.innerHTML = `
        <div class="app-card-header">
            <div class="app-icon">${iconHtml}</div>
            <div class="app-info">
                <div class="app-name">${escapeHtml(app.name)}</div>
                <div class="app-version">v${escapeHtml(app.version)}</div>
            </div>
        </div>
        <p class="app-desc">${escapeHtml(app.description || '')}</p>
        <div class="app-footer">
            <span class="app-size">${escapeHtml(app.size || 'N/A')} MB</span>
            <button class="app-download" data-app-id="${escapeHtml(app.id)}">下载安装</button>
        </div>
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
        ? `<img src="${app.icon}" alt="${app.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 12px;">`
        : `<div style="width: 64px; height: 64px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;"><span style="color: white; font-size: 32px;">${app.name.charAt(0).toUpperCase()}</span></div>`;

    let actionButtons = '';
    const status = app.status || { status: 'unknown', running: false };

    if (status.status === 'not_installed') {
        actionButtons = `<button class="btn-primary" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">安装</button>`;
    } else if (status.status === 'running') {
        actionButtons = `
            <button class="btn-secondary" onclick="stopApp('${app.id}')">停止</button>
            <button class="btn-secondary" onclick="uninstallApp('${app.id}', '${app.name}')" style="background: #f44336; color: white; border-color: #f44336;">卸载</button>
        `;
    } else if (status.status === 'stopped') {
        actionButtons = `
            <button class="btn-primary" onclick="startApp('${app.id}')">启动</button>
            <button class="btn-secondary" onclick="uninstallApp('${app.id}', '${app.name}')" style="background: #f44336; color: white; border-color: #f44336;">卸载</button>
        `;
    } else {
        actionButtons = `<button class="btn-primary" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">安装</button>`;
    }

    detailEl.innerHTML = `
        <div class="detail-header">
            ${iconHtml}
            <div class="detail-title">
                <h2>${escapeHtml(app.name)}</h2>
                <div class="detail-meta">v${escapeHtml(app.version)} ${categories ? '· ' + categories : ''}</div>
            </div>
            <button class="close-btn" onclick="hideAppDetail()">&times;</button>
        </div>
        <div class="detail-body">
            <div class="detail-info-grid">
                <div class="info-item">
                    <div class="info-label">平台</div>
                    <div class="info-value">${escapeHtml(app.platform)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">大小</div>
                    <div class="info-value">${escapeHtml(app.size || 'N/A')} MB</div>
                </div>
                <div class="info-item">
                    <div class="info-label">状态</div>
                    <div class="info-value">${status.status === 'running' ? '运行中' : status.status === 'stopped' ? '已停止' : status.status === 'not_installed' ? '未安装' : '未知'}</div>
                </div>
                ${app.author ? `<div class="info-item">
                    <div class="info-label">开发者</div>
                    <div class="info-value">${escapeHtml(app.author)}</div>
                </div>` : ''}
                ${app.publisher ? `<div class="info-item">
                    <div class="info-label">发布者</div>
                    <div class="info-value">${escapeHtml(app.publisher)}</div>
                </div>` : ''}
            </div>

            ${app.description ? `<div class="detail-section">
                <h3>应用描述</h3>
                <p>${escapeHtml(app.description)}</p>
            </div>` : ''}

            ${app.changelog ? `<div class="detail-section">
                <h3>更新日志</h3>
                <p>${escapeHtml(app.changelog)}</p>
            </div>` : ''}

            <div class="detail-actions">
                ${actionButtons}
                <button class="btn-secondary" onclick="hideAppDetail()">关闭</button>
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

async function showSettingsManager() {
    try {
        const [settingsData, sourcesData] = await Promise.all([
            apiRequest('/api/settings'),
            apiRequest('/api/sources')
        ]);

        renderSettingsManager(settingsData.data, sourcesData.data.sources || []);
        showSettingsDialog();
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

function renderSettingsManager(settings, sources) {
    const dialog = document.getElementById('settingsDialog');

    dialog.innerHTML = `
        <div class="dialog-header">
            <h2>设置</h2>
            <button class="close-btn" onclick="hideSettingsManager()">&times;</button>
        </div>
        <div class="dialog-tabs">
            <button class="dialog-tab active" data-tab="basic">基础设置</button>
            <button class="dialog-tab" data-tab="sources">源管理</button>
        </div>
        <div class="dialog-body">
            <div class="tab-content active" id="basicTab">
                <div class="form-group">
                    <label>AppStore 存储目录</label>
                    <input type="text" id="appStoreDirInput" value="${escapeHtml(settings.appStoreDir || '')}" placeholder="例如：/vol1/我的文件/AppStore">
                    <div class="form-hint">请先在系统设置中为此应用添加可访问权限文件夹，然后将路径填入此处</div>
                </div>
                <div class="detail-actions" style="border: none; padding: 0;">
                    <button class="btn-primary" onclick="saveSettings()">保存设置</button>
                </div>
            </div>
            <div class="tab-content" id="sourcesTab">
                <div id="sourceListContainer">
                    ${renderSourceList(sources)}
                </div>
            </div>
        </div>
    `;

    document.querySelectorAll('.dialog-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.dialog-tab').forEach(function(t) {
                t.classList.remove('active');
            });
            this.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(function(content) {
                content.classList.remove('active');
            });
            document.getElementById(this.dataset.tab + 'Tab').classList.add('active');
        });
    });
}

function renderSourceList(sources) {
    if (!sources || sources.length === 0) {
        return '<div class="empty-state"><p>暂无数据源</p></div>';
    }

    return `
        <div class="source-list">
            ${sources.map(function(source) {
                return `
                    <div class="source-item">
                        <div class="source-item-info">
                            <div class="source-item-name">${escapeHtml(source.name)}</div>
                            <div class="source-item-path">${escapeHtml(source.url)}</div>
                        </div>
                        <div class="source-item-actions">
                            <button class="action-btn sync-btn" onclick="syncSource('${escapeHtml(source.id)}')">同步</button>
                            ${source.local ? `<button class="action-btn reset-btn" onclick="resetCache('${escapeHtml(source.id)}')">重置</button>` : ''}
                            ${!source.local ? `<button class="action-btn delete-btn" onclick="deleteSource('${escapeHtml(source.id)}')">删除</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function showSettingsDialog() {
    document.getElementById('settingsOverlay').classList.add('active');
    document.getElementById('settingsDialog').classList.add('active');
}

function hideSettingsManager() {
    document.getElementById('settingsOverlay').classList.remove('active');
    document.getElementById('settingsDialog').classList.remove('active');
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
            loadApps();
        } else {
            alert('保存设置失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('保存设置失败:', error);
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
            showSettingsManager();
            loadApps();
        } else {
            alert('同步失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('同步源失败:', error);
        alert('网络错误，请重试');
    }
}

async function resetCache(sourceId) {
    if (!confirm('确定要重置缓存吗？这将强制重新扫描所有 FPK 文件。')) {
        return;
    }

    try {
        const data = await apiRequest(`/api/sources/${encodeURIComponent(sourceId)}/reset-cache`, {
            method: 'POST'
        });

        if (data.code === 0) {
            alert(`缓存已重置，当前共 ${data.data.total} 个应用`);
            showSettingsManager();
            loadApps();
        } else {
            alert('重置缓存失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('重置缓存失败:', error);
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
            showSettingsManager();
            loadApps();
        } else {
            alert('删除失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('删除源失败:', error);
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