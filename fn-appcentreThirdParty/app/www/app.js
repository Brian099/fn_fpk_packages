function getCgiUrl() {
    let p = window.location.pathname;
    // 如果已经包含 index.cgi，则返回去掉路径末尾部分后的基础路径
    if (p.includes('index.cgi')) {
        return p.substring(0, p.lastIndexOf('index.cgi') + 9);
    }
    // 确保以 / 结尾，然后加上 index.cgi
    if (!p.endsWith('/')) {
        p += '/';
    }
    return p + 'index.cgi';
}

// 增强的API服务类
class ApiService {
    constructor() {
        this.baseUrl = getCgiUrl();
        this.timeout = 10000; // 10秒超时
    }

    async request(endpoint, options = {}) {
        const url = this.baseUrl + endpoint;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // 检查后端返回的错误码
            if (data.code !== 0 && data.code !== undefined) {
                throw new Error(data.message || 'API请求失败');
            }
            
            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('请求超时，请检查网络连接');
            }
            
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('网络连接失败，请检查网络设置');
            }
            
            throw error;
        }
    }

    // 专用GET方法
    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }

    // 专用POST方法
    async post(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // 专用DELETE方法
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }

    // === 新增功能API ===

    // 获取已安装应用列表
    async getInstalledApps() {
        return this.get('/api/apps/installed');
    }

    // 获取默认存储空间
    async getDefaultVolume() {
        return this.get('/api/volume/default');
    }

    // 设置默认存储空间
    async setDefaultVolume(volumeId) {
        return this.post(`/api/volume/default/${volumeId}`);
    }

    // 获取手动安装状态
    async getManualInstallStatus() {
        return this.get('/api/manual-install');
    }

    // 设置手动安装状态
    async setManualInstall(action) {
        if (action !== 'enable' && action !== 'disable') {
            throw new Error('Invalid action. Use "enable" or "disable"');
        }
        return this.post(`/api/manual-install/${action}`);
    }

    // 获取应用源列表
    async getSources() {
        return this.get('/api/sources');
    }

    // 添加应用源
    async addSource(sourceData) {
        return this.post('/api/sources', sourceData);
    }

    // 删除应用源
    async deleteSource(sourceId) {
        return this.delete(`/api/sources/${sourceId}`);
    }

    // 同步应用源
    async syncSource(sourceId) {
        return this.post(`/api/sources/${sourceId}/sync`);
    }

    // 重置应用源缓存
    async resetSourceCache(sourceId) {
        return this.post(`/api/sources/${sourceId}/reset-cache`);
    }

    // 获取应用设置
    async getSettings() {
        return this.get('/api/settings');
    }

    // 保存应用设置
    async saveSettings(settings) {
        return this.post('/api/settings', settings);
    }

    // === 安装相关API ===

    // 安装应用（支持环境变量文件）
    async installApp(appId, envFilePath = null) {
        const data = envFilePath ? { env_file_path: envFilePath } : {};
        return this.post(`/api/apps/${appId}/install`, data);
    }

    // 启动应用
    async startApp(appId) {
        return this.post(`/api/apps/${appId}/start`);
    }

    // 停止应用
    async stopApp(appId) {
        return this.post(`/api/apps/${appId}/stop`);
    }

    // 卸载应用
    async uninstallApp(appId) {
        return this.delete(`/api/apps/${appId}`);
    }

    // 获取应用状态
    async getAppStatus(appId) {
        return this.get(`/api/apps/${appId}/status`);
    }
}

// 创建全局API服务实例
const apiService = new ApiService();

// 保持向后兼容的apiRequest函数
function apiRequest(endpoint, options = {}) {
    return apiService.request(endpoint, options);
}

let currentCategory = '';
let currentKeyword = '';
let currentTab = 'all';

function init() {
    loadApps();
    setupEventListeners();
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                currentKeyword = this.value;
                loadApps();
            }
        });
        
        // Optional: real-time search for clearing
        searchInput.addEventListener('input', function() {
            currentKeyword = this.value;
            if (this.value === '') loadApps();
        });
    }

    document.querySelectorAll('.tab-item').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-item').forEach(function(b) {
                b.classList.remove('active');
            });
            this.classList.add('active');
            currentTab = this.dataset.tab;
            loadApps();
        });
    });

    document.querySelectorAll('.base-Tab-root[data-category]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.base-Tab-root').forEach(function(b) {
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

    const iconUrl = app.icon || '/static/app/icons/trim.app-center/icon.png';
    const categories = Array.isArray(app.categories) ? app.categories.slice(0, 2).join(' ') : '应用';
    
    // Status-based button text and style
    let btnText = '安装';
    let btnClass = 'semi-button-primary';
    
    // Check if installed or running (simplified check, real logic might need status data)
    // For now, default to Install if unknown
    
    card.innerHTML = `
        <div class="app-card-top">
            <div class="app-card-icon" style="background-image: url('${iconUrl}')"></div>
            <div class="app-card-info">
                <div class="app-card-name">${escapeHtml(app.name)}</div>
                <div class="app-card-meta">
                    <div class="app-card-category">${escapeHtml(categories)}</div>
                    <button class="semi-button ${btnClass}" data-app-id="${escapeHtml(app.id)}">${btnText}</button>
                </div>
            </div>
        </div>
    `;

    card.addEventListener('click', function(e) {
        if (!e.target.closest('.semi-button')) {
            showAppDetail(app.id);
        }
    });

    const installBtn = card.querySelector('.semi-button');
    installBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        installApp(app);
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

async function installApp(app, envFilePath = null) {
    if (!app || !app.id) {
        showNotification('应用信息无效', 'error');
        return;
    }

    // 显示安装确认对话框（支持环境变量文件）
    const installConfirmed = await showInstallDialog(app, envFilePath);
    if (!installConfirmed) {
        return;
    }

    try {
        showLoading('正在安装应用...');
        
        const data = await apiService.installApp(app.id, envFilePath);

        hideLoading();
        
        if (data.code === 0) {
            showNotification('安装成功！', 'success');
            hideAppDetail();
            loadApps();
            
            // 启动应用状态轮询
            startAppStatusPolling(app.id);
        } else {
            showNotification('安装失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        hideLoading();
        console.error('安装失败:', error);
        showNotification('安装失败: ' + error.message, 'error');
    }
}

// 显示安装确认对话框
function showInstallDialog(app, envFilePath) {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'install-dialog-overlay';
        dialog.innerHTML = `
            <div class="install-dialog">
                <h3>安装应用</h3>
                <p>确定要安装 <strong>${app.name}</strong> 吗？</p>
                ${envFilePath ? `<p class="env-file-info">将使用环境变量文件: ${envFilePath}</p>` : ''}
                
                <div class="dialog-actions">
                    <button class="btn-secondary" onclick="closeInstallDialog(false)">取消</button>
                    <button class="btn-primary" onclick="closeInstallDialog(true)">确认安装</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        window.closeInstallDialog = (confirmed) => {
            document.body.removeChild(dialog);
            resolve(confirmed);
        };
    });
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
    // 默认空对象保护
    const safeSettings = settings || {};
    const safeSources = sources || [];

    dialog.innerHTML = `
        <div class="dialog-header">
            <h2>应用设置</h2>
            <button class="window-btn" onclick="hideSettingsManager()" title="关闭">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="dialog-tabs">
            <button class="dialog-tab active" data-tab="basic">基础配置</button>
            <button class="dialog-tab" data-tab="sources">应用源管理</button>
        </div>
        <div class="dialog-body">
            <div class="tab-content active" id="basicTab">
                <div class="form-group">
                    <label>AppStore 存储目录</label>
                    <input type="text" id="appStoreDirInput" class="semi-input" value="${escapeHtml(safeSettings.appStoreDir || '')}" placeholder="例如：/vol1/我的文件/AppStore">
                    <div class="form-hint">此目录用于存放已下载的应用安装包。请确保该路径在系统设置中已授权给本应用访问权限。</div>
                </div>
                <div style="margin-top: 32px; display: flex; justify-content: flex-end;">
                    <button class="semi-button semi-button-primary" style="height: 32px; padding: 0 24px;" onclick="saveSettings()">保存配置</button>
                </div>
            </div>
            <div class="tab-content" id="sourcesTab">
                <div class="add-source-form">
                    <h3>添加新的应用源</h3>
                    <div class="form-inline">
                        <div class="form-group">
                            <input type="text" id="newSourceName" class="semi-input" placeholder="源名称" style="height: 32px;">
                        </div>
                        <div class="form-group">
                            <input type="text" id="newSourceUrl" class="semi-input" placeholder="源 URL (https://...)" style="height: 32px;">
                        </div>
                        <button class="semi-button semi-button-primary" style="height: 32px; flex-shrink: 0;" onclick="addSource()">添加源</button>
                    </div>
                </div>
                <div id="sourceListContainer">
                    ${renderSourceList(safeSources)}
                </div>
            </div>
        </div>
    `;

    // 重新绑定标签页切换
    document.querySelectorAll('.dialog-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.dialog-tab').forEach(function(t) {
                t.classList.remove('active');
            });
            this.classList.add('active');
            document.querySelectorAll('.dialog-body .tab-content').forEach(function(content) {
                content.classList.remove('active');
            });
            const targetId = this.dataset.tab + 'Tab';
            const target = document.getElementById(targetId);
            if (target) target.classList.add('active');
        });
    });
}

function renderSourceList(sources) {
    if (!sources || sources.length === 0) {
        return `
            <div class="empty-state-container">
                <p>暂无配置的应用源，请在上方添加</p>
            </div>
        `;
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
                            ${source.local ? `<button class="action-btn" style="background: var(--semi-color-fill-1); color: var(--semi-color-text-1);" onclick="resetCache('${escapeHtml(source.id)}')">重置</button>` : ''}
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

async function addSource() {
    const name = document.getElementById('newSourceName').value.trim();
    const url = document.getElementById('newSourceUrl').value.trim();

    if (!name || !url) {
        alert('请输入源名称和 URL');
        return;
    }

    try {
        const data = await apiRequest('/api/sources', {
            method: 'POST',
            body: JSON.stringify({ name: name, url: url })
        });

        if (data.code === 0) {
            alert('添加源成功');
            // 刷新列表并保持在源管理页
            const [settingsData, sourcesData] = await Promise.all([
                apiRequest('/api/settings'),
                apiRequest('/api/sources')
            ]);
            renderSettingsManager(settingsData.data, sourcesData.data.sources || []);
            // 强制切回到源管理标签
            document.querySelector('.dialog-tab[data-tab="sources"]').click();
            loadApps();
        } else {
            alert('添加源失败: ' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('添加源失败:', error);
        alert('网络错误，请重试');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// === 状态管理功能 ===

const appStatusPollers = new Map();

// 启动应用状态轮询
function startAppStatusPolling(appId) {
    if (appStatusPollers.has(appId)) {
        return; // 已经在轮询中
    }
    
    const interval = setInterval(async () => {
        try {
            const status = await apiService.getAppStatus(appId);
            updateAppStatusUI(appId, status.data);
            
            // 如果应用已停止或未安装，停止轮询
            if (status.data.status === 'stopped' || status.data.status === 'not_installed') {
                stopAppStatusPolling(appId);
            }
        } catch (error) {
            console.error('状态轮询失败:', error);
            stopAppStatusPolling(appId);
        }
    }, 3000); // 每3秒轮询一次
    
    appStatusPollers.set(appId, interval);
}

// 停止应用状态轮询
function stopAppStatusPolling(appId) {
    if (appStatusPollers.has(appId)) {
        clearInterval(appStatusPollers.get(appId));
        appStatusPollers.delete(appId);
    }
}

// 更新应用状态UI
function updateAppStatusUI(appId, statusData) {
    const appCard = document.querySelector(`[data-app-id="${appId}"]`);
    if (!appCard) return;
    
    const statusElement = appCard.querySelector('.app-status');
    const actionButtons = appCard.querySelector('.app-actions');
    
    if (statusElement && actionButtons) {
        // 更新状态显示
        statusElement.textContent = getStatusText(statusData.status);
        statusElement.className = `app-status status-${statusData.status}`;
        
        // 更新操作按钮
        actionButtons.innerHTML = generateActionButtons(appId, statusData);
    }
}

// 获取状态文本
function getStatusText(status) {
    const statusMap = {
        'running': '运行中',
        'stopped': '已停止',
        'not_installed': '未安装',
        'installing': '安装中',
        'starting': '启动中',
        'stopping': '停止中'
    };
    return statusMap[status] || status;
}

// 生成操作按钮
function generateActionButtons(appId, statusData) {
    const app = window.appsCache?.[appId];
    if (!app) return '';
    
    switch (statusData.status) {
        case 'running':
            return `<button class="btn-secondary" onclick="stopApp('${appId}')">停止</button>
                    <button class="btn-secondary" onclick="uninstallApp('${appId}', '${app.name}')" style="background: #f44336; color: white; border-color: #f44336;">卸载</button>`;
        case 'stopped':
            return `<button class="btn-primary" onclick="startApp('${appId}')">启动</button>
                    <button class="btn-secondary" onclick="uninstallApp('${appId}', '${app.name}')" style="background: #f44336; color: white; border-color: #f44336;">卸载</button>`;
        case 'not_installed':
            return `<button class="btn-primary" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">安装</button>`;
        default:
            return `<button class="btn-secondary" disabled>${getStatusText(statusData.status)}</button>`;
    }
}

// 显示通知
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // 自动移除通知
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// 显示加载指示器
function showLoading(message = '加载中...') {
    let loading = document.getElementById('global-loading');
    if (!loading) {
        loading = document.createElement('div');
        loading.id = 'global-loading';
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-message">${message}</div>
        `;
        document.body.appendChild(loading);
    }
    loading.style.display = 'flex';
}

// 隐藏加载指示器
function hideLoading() {
    const loading = document.getElementById('global-loading');
    if (loading) {
        loading.style.display = 'none';
    }
}

// 全局应用缓存
window.appsCache = {};

window.onload = init;