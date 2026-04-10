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
            
            let data;
            try {
                data = await response.json();
            } catch (e) {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                throw new Error('解析响应失败');
            }
            
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
            }
            
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

function switchView(viewId) {
    const views = document.querySelectorAll('.app-main-view');
    views.forEach(v => v.classList.remove('active'));
    
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
    }
}

let currentCategory = '';
let currentKeyword = '';
let currentTab = 'all';

function init() {
    switchView('appGrid');
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
            document.getElementById('settingsBtn').classList.remove('active');
            this.classList.add('active');
            currentCategory = this.dataset.category;
            switchView('appGrid');
            loadApps();
        });
    });

    document.getElementById('settingsBtn').addEventListener('click', function(e) {
        e.preventDefault();
        document.querySelectorAll('.base-Tab-root').forEach(function(b) {
            b.classList.remove('active');
        });
        this.classList.add('active');
        showSettingsManager(true); // 使用集成模式
    });

    document.getElementById('appDetailOverlay').addEventListener('click', function() {
        hideAppDetail();
    });

}

async function loadApps() {
    const appGrid = document.getElementById('appGrid');
    appGrid.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>加载中...</p></div>';

    try {
        let endpoint = '/api/apps';

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
            appGrid.innerHTML = `<div class="empty-state"><p>加载应用失败: ${data.message || '未知错误'}</p></div>`;
        }
    } catch (error) {
        console.error('加载应用失败:', error);
        appGrid.innerHTML = `<div class="empty-state">
            <p>网络错误，请重试</p>
            <div style="font-size: 12px; color: var(--semi-color-text-3); margin-top: 8px;">错误原因: ${error.message}</div>
        </div>`;
    }
}

function renderAppGrid(apps) {
    const appGrid = document.getElementById('appGrid');
    
    if (!apps || apps.length === 0) {
        appGrid.innerHTML = '<div class="empty-state"><p>暂无应用</p></div>';
        return;
    }

    appGrid.innerHTML = '';

    // 根据分类进行分组
    const groups = {};
    apps.forEach(app => {
        const cat = (Array.isArray(app.categories) && app.categories.length > 0) ? app.categories[0] : (app.category || 'other');
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(app);
    });

    // 默认排序：其他类别排在最后
    const sortedCategories = Object.keys(groups).sort((a, b) => {
        if (a === 'other') return 1;
        if (b === 'other') return -1;
        return a.localeCompare(b);
    });
    
    sortedCategories.forEach(cat => {
        const groupApps = groups[cat];
        
        // 分类容器
        const section = document.createElement('div');
        section.className = 'category-section';
        
        // 分类头部
        const header = document.createElement('div');
        header.className = 'grid-category-header';
        header.innerHTML = `
            <span class="grid-category-title">${escapeHtml(cat)}</span>
            <span class="grid-category-count">${groupApps.length}</span>
        `;
        
        // 分类网格
        const grid = document.createElement('div');
        grid.className = 'app-grid';
        
        groupApps.forEach(app => {
            grid.appendChild(createAppCard(app));
        });
        
        section.appendChild(header);
        section.appendChild(grid);
        appGrid.appendChild(section);
    });
}

function createAppCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card';
    card.dataset.appId = app.id;

    const iconUrl = app.icon || '/static/app/icons/trim.app-center/icon.png';
    const categories = Array.isArray(app.categories) ? app.categories.slice(0, 1).join('') : (app.category || '应用');
    
    // 状态检测逻辑 (基础版)
    let btnText = '安装';
    let btnClass = 'semi-button-primary';
    
    // 如果版本被标记为 installed，显示“打开”
    if (app.Version === 'installed' || app.status === 'installed' || app.is_installed) {
        btnText = '打开';
        btnClass = 'semi-button-secondary';
    }

    card.innerHTML = `
        <div class="app-card-icon" style="background-image: url('${iconUrl}')"></div>
        <div class="app-card-info">
            <div class="app-card-name">${escapeHtml(app.name)}</div>
            <div class="app-card-meta">
                <div class="app-card-category">${escapeHtml(categories)}</div>
                <button class="semi-button ${btnClass}">${btnText}</button>
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
            switchView('appDetailView');
        }
    } catch (error) {
        console.error('获取应用详情失败:', error);
    }
}

function renderAppDetail(app) {
    const detailEl = document.getElementById('appDetailView');

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
            <button class="btn-primary" style="background-color: var(--semi-color-fill-0); color: var(--semi-color-text-0);">打开 <span style="margin-left: 4px; font-size: 10px; opacity: 0.6;">▼</span></button>
            <button class="btn-secondary" style="background-color: var(--semi-color-fill-0); color: var(--semi-color-text-0); border: 1px solid var(--semi-color-border);">应用设置</button>
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
        <div class="back-button" onclick="switchView('appGrid')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
        </div>
        <div class="detail-header">
            ${iconHtml}
            <div class="detail-title">
                <h2>${escapeHtml(app.name)}</h2>
                <div class="detail-actions" style="border: none; margin: 12px 0 0 0; padding: 0; justify-content: flex-start;">
                    ${actionButtons}
                </div>
            </div>
        </div>
        <div class="detail-body">
            <div class="detail-info-grid">
                <div class="info-item">
                    <div class="info-label">开发者</div>
                    <div class="info-value">${escapeHtml(app.author || '未知')}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">发布者</div>
                    <div class="info-value">${escapeHtml(app.publisher || '第三方')}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">安装位置</div>
                    <div class="info-value">系统分区</div>
                </div>
                <div class="info-item">
                    <div class="info-label">当前版本</div>
                    <div class="info-value">${escapeHtml(app.version)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">来源</div>
                    <div class="info-value">手动安装</div>
                </div>
            </div>

            <div class="detail-section">
                <h3>应用介绍</h3>
                <p>${escapeHtml(app.description || '暂无应用介绍')}</p>
            </div>
        </div>

    `;
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

async function showSettingsManager(integrated = true, activeTab = 'basic') {
    try {
        const [settingsData, sourcesData] = await Promise.all([
            apiRequest('/api/settings'),
            apiRequest('/api/sources')
        ]);

        renderSettingsManager(settingsData.data, sourcesData.data.sources || [], 'settingsView', activeTab);
        switchView('settingsView');
    } catch (error) {
        console.error('加载设置失败:', error);
        showNotification('加载设置失败', 'error');
    }
}

function renderSettingsManager(settings, sources, containerId = 'settingsView', activeTab = 'basic') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // 默认空对象保护
    const safeSettings = settings || {};
    const safeSources = sources || [];

    container.innerHTML = `
        <div class="dialog-tabs">
            <button class="dialog-tab ${activeTab === 'basic' ? 'active' : ''}" data-tab="basic">基础配置</button>
            <button class="dialog-tab ${activeTab === 'sources' ? 'active' : ''}" data-tab="sources">应用源管理</button>
        </div>
        <div class="dialog-body">
            <div class="tab-content ${activeTab === 'basic' ? 'active' : ''}" id="basicTab">
                <div class="settings-card">
                    <div class="settings-card-icon">
                        <svg t="1775702187924" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="19267" width="24" height="24"><path d="M512 512v85.3504c47.104 0 85.3504-38.2464 85.3504-85.3504H512z m0 0H426.6496c0 47.104 38.2464 85.3504 85.3504 85.3504V512z m0 0V426.6496c-47.104 0-85.3504 38.2464-85.3504 85.3504H512z m0 0h85.3504c0-47.104-38.2464-85.3504-85.3504-85.3504V512zM680.0896 482.3552a42.6496 42.6496 0 0 0 84.0192-14.7968l-84.0192 14.848z m-123.648 281.7536a42.6496 42.6496 0 0 0-14.848-84.0192l14.848 84.0192z m207.6672-296.5504a256 256 0 0 0-67.1744-132.608l-61.6448 59.0336c23.3472 24.3712 38.912 55.1424 44.8 88.3712l84.0192-14.7968z m-67.1744-132.608a256 256 0 0 0-129.536-72.8576l-18.432 83.3024c32.9216 7.2704 62.976 24.2176 86.3232 48.64l61.6448-59.0336z m-129.536-72.8576a256 256 0 0 0-148.1728 11.264l30.9248 79.5648a170.6496 170.6496 0 0 1 98.816-7.5264l18.432-83.3024z m-148.1728 11.264a256 256 0 0 0-116.9408 91.8016l69.9392 48.9472c19.3536-27.648 46.4384-48.9472 77.9264-61.184L419.2256 273.408zM302.2848 365.2096a256 256 0 0 0-46.2336 141.2608l85.2992 1.8432c0.768-33.7408 11.4688-66.56 30.8736-94.208l-69.9392-48.896zM256.0512 506.368a256 256 0 0 0 40.0384 143.104l71.9872-45.824a170.6496 170.6496 0 0 1-26.7264-95.4368l-85.2992-1.8432z m40.0384 143.104a256 256 0 0 0 112.7936 96.768l34.3552-78.08a170.6496 170.6496 0 0 1-75.1616-64.512l-71.9872 45.824z m112.7936 96.768a256 256 0 0 0 147.5584 17.8176l-14.848-84.0192a170.6496 170.6496 0 0 1-98.304-11.8784l-34.4064 78.08zM170.6496 512a42.6496 42.6496 0 1 0-85.2992 0h85.2992zM512 85.3504a42.6496 42.6496 0 1 0 0 85.2992V85.3504zM85.3504 512c0 84.3776 24.9856 166.912 71.8848 237.056l70.9632-47.4112A341.3504 341.3504 0 0 1 170.6496 512H85.3504z m71.8848 237.056a426.6496 426.6496 0 0 0 191.488 157.1328l32.6656-78.848a341.2992 341.2992 0 0 1-153.1904-125.696l-70.9632 47.4112z m191.488 157.1328a426.7008 426.7008 0 0 0 246.528 24.2688L578.56 846.848a341.3504 341.3504 0 0 1-197.2224-19.456L348.672 906.24z m246.528 24.2688a426.7008 426.7008 0 0 0 218.4704-116.736l-60.3648-60.3648a341.3504 341.3504 0 0 1-174.7456 93.44l16.64 83.6608z m218.4704-116.736a426.7008 426.7008 0 0 0 116.736-218.4704L846.848 578.56a341.3504 341.3504 0 0 1-93.44 174.7456l60.3648 60.3648z m116.736-218.4704A426.7008 426.7008 0 0 0 906.24 348.672l-78.848 32.6656a341.3504 341.3504 0 0 1 19.456 197.2224l83.6608 16.64zM906.24 348.672a426.6496 426.6496 0 0 0-157.184-191.488l-47.36 70.9632a341.2992 341.2992 0 0 1 125.696 153.1904l78.848-32.6656z m-157.184-191.488A426.6496 426.6496 0 0 0 512 85.3504v85.2992c67.5328 0 133.5296 20.0192 189.6448 57.5488l47.4112-70.9632z" fill="#2B3038" p-id="19268"></path></svg>
                    </div>
                    <div class="settings-card-content">
                        <div class="settings-card-title">AppStore 存储目录</div>
                        <div class="settings-card-description">此目录用于存放已下载的应用安装包。请确保该路径在系统设置中已授权给本应用访问权限。</div>
                    </div>
                    <div class="settings-card-actions">
                        <div class="settings-card-input-wrapper">
                            <input type="text" id="appStoreDirInput" class="semi-input" value="${escapeHtml(safeSettings.appStoreDir || '')}" placeholder="例如：/vol1/我的文件/AppStore">
                        </div>
                        <button class="semi-button semi-button-primary" style="height: 36px; padding: 0 20px;" onclick="saveSettings()">保存配置</button>
                    </div>
                </div>
            </div>
            <div class="tab-content ${activeTab === 'sources' ? 'active' : ''}" id="sourcesTab">
                <div class="settings-card" style="background-color: var(--semi-color-fill-0); border-style: dashed;">
                    <div class="settings-card-icon" style="background-color: var(--semi-color-primary); color: white;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </div>
                    <div class="settings-card-content">
                        <div class="settings-card-title">添加新的应用源</div>
                        <div class="settings-card-description">请输入应用源名称和 URL 地址（支持远程仓库或本地路径）。</div>
                    </div>
                    <div class="settings-card-actions">
                        <input type="text" id="newSourceName" class="semi-input" placeholder="源名称" style="width: 120px;">
                        <input type="text" id="newSourceUrl" class="semi-input" placeholder="URL (https://...)" style="width: 240px;">
                        <button class="semi-button semi-button-primary" style="height: 36px; padding: 0 20px;" onclick="addSource()">添加源</button>
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
                    <div class="settings-card">
                        <div class="settings-card-icon">
                            <svg t="1775702187924" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="19267" width="24" height="24"><path d="M512 512v85.3504c47.104 0 85.3504-38.2464 85.3504-85.3504H512z m0 0H426.6496c0 47.104 38.2464 85.3504 85.3504 85.3504V512z m0 0V426.6496c-47.104 0-85.3504 38.2464-85.3504 85.3504H512z m0 0h85.3504c0-47.104-38.2464-85.3504-85.3504-85.3504V512zM680.0896 482.3552a42.6496 42.6496 0 0 0 84.0192-14.7968l-84.0192 14.848z m-123.648 281.7536a42.6496 42.6496 0 0 0-14.848-84.0192l14.848 84.0192z m207.6672-296.5504a256 256 0 0 0-67.1744-132.608l-61.6448 59.0336c23.3472 24.3712 38.912 55.1424 44.8 88.3712l84.0192-14.7968z m-67.1744-132.608a256 256 0 0 0-129.536-72.8576l-18.432 83.3024c32.9216 7.2704 62.976 24.2176 86.3232 48.64l61.6448-59.0336z m-129.536-72.8576a256 256 0 0 0-148.1728 11.264l30.9248 79.5648a170.6496 170.6496 0 0 1 98.816-7.5264l18.432-83.3024z m-148.1728 11.264a256 256 0 0 0-116.9408 91.8016l69.9392 48.9472c19.3536-27.648 46.4384-48.9472 77.9264-61.184L419.2256 273.408zM302.2848 365.2096a256 256 0 0 0-46.2336 141.2608l85.2992 1.8432c0.768-33.7408 11.4688-66.56 30.8736-94.208l-69.9392-48.896zM256.0512 506.368a256 256 0 0 0 40.0384 143.104l71.9872-45.824a170.6496 170.6496 0 0 1-26.7264-95.4368l-85.2992-1.8432z m40.0384 143.104a256 256 0 0 0 112.7936 96.768l34.3552-78.08a170.6496 170.6496 0 0 1-75.1616-64.512l-71.9872 45.824z m112.7936 96.768a256 256 0 0 0 147.5584 17.8176l-14.848-84.0192a170.6496 170.6496 0 0 1-98.304-11.8784l-34.4064 78.08zM170.6496 512a42.6496 42.6496 0 1 0-85.2992 0h85.2992zM512 85.3504a42.6496 42.6496 0 1 0 0 85.2992V85.3504zM85.3504 512c0 84.3776 24.9856 166.912 71.8848 237.056l70.9632-47.4112A341.3504 341.3504 0 0 1 170.6496 512H85.3504z m71.8848 237.056a426.6496 426.6496 0 0 0 191.488 157.1328l32.6656-78.848a341.2992 341.2992 0 0 1-153.1904-125.696l-70.9632 47.4112z m191.488 157.1328a426.7008 426.7008 0 0 0 246.528 24.2688L578.56 846.848a341.3504 341.3504 0 0 1-197.2224-19.456L348.672 906.24z m246.528 24.2688a426.7008 426.7008 0 0 0 218.4704-116.736l-60.3648-60.3648a341.3504 341.3504 0 0 1-174.7456 93.44l16.64 83.6608z m218.4704-116.736a426.7008 426.7008 0 0 0 116.736-218.4704L846.848 578.56a341.3504 341.3504 0 0 1-93.44 174.7456l60.3648 60.3648z m116.736-218.4704A426.7008 426.7008 0 0 0 906.24 348.672l-78.848 32.6656a341.3504 341.3504 0 0 1 19.456 197.2224l83.6608 16.64zM906.24 348.672a426.6496 426.6496 0 0 0-157.184-191.488l-47.36 70.9632a341.2992 341.2992 0 0 1 125.696 153.1904l78.848-32.6656z m-157.184-191.488A426.6496 426.6496 0 0 0 512 85.3504v85.2992c67.5328 0 133.5296 20.0192 189.6448 57.5488l47.4112-70.9632z" fill="#2B3038" p-id="19268"></path></svg>
                        </div>
                        <div class="settings-card-content">
                            <div class="settings-card-title">
                                ${escapeHtml(source.name)}
                                <span class="source-status ${source.enabled ? 'enabled' : 'disabled'}">
                                    ${source.enabled ? '已启用' : '已禁用'}
                                </span>
                            </div>
                            <div class="settings-card-description">${escapeHtml(source.url)}</div>
                        </div>
                        <div class="settings-card-actions">
                            <div class="toggle-switch">
                                <input type="checkbox" id="toggle-${escapeHtml(source.id)}" 
                                       ${source.enabled ? 'checked' : ''} 
                                       onchange="toggleSource('${escapeHtml(source.id)}', this.checked)">
                                <label for="toggle-${escapeHtml(source.id)}" class="toggle-label"></label>
                            </div>
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

// Legacy modal functions removed

async function saveSettings() {
    const appStoreDir = document.getElementById('appStoreDirInput').value.trim();

    try {
        const data = await apiRequest('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ appStoreDir: appStoreDir })
        });

        if (data.code === 0) {
            showNotification('基础配置已保存', 'success');
            loadApps();
        } else {
            showNotification(data.message || '保存设置失败', 'error');
        }
    } catch (error) {
        console.error('保存设置失败:', error);
        showNotification(error.message || '网络错误，请重试', 'error');
    }
}

async function syncSource(sourceId) {
    try {
        const data = await apiRequest(`/api/sources/${encodeURIComponent(sourceId)}/sync`, {
            method: 'POST'
        });

        if (data.code === 0) {
            showNotification(`同步成功！新增: ${data.data.added}, 更新: ${data.data.updated}, 移除: ${data.data.removed}`, 'success');
            showSettingsManager(true, 'sources');
            loadApps();
        } else {
            showNotification(data.message || '同步失败', 'error');
        }
    } catch (error) {
        console.error('同步源失败:', error);
        showNotification(error.message || '网络错误，请重试', 'error');
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
            showNotification(`缓存已重置，当前共 ${data.data.total} 个应用`, 'success');
            showSettingsManager(true, 'sources');
            loadApps();
        } else {
            showNotification(data.message || '重置缓存失败', 'error');
        }
    } catch (error) {
        console.error('重置缓存失败:', error);
        showNotification(error.message || '网络错误，请重试', 'error');
    }
}

async function toggleSource(sourceId, enabled) {
    try {
        const data = await apiRequest(`/api/sources/${encodeURIComponent(sourceId)}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ enabled: enabled })
        });

        if (data.code === 0) {
            showNotification(`${enabled ? '启用' : '禁用'}源成功`, 'success');
            showSettingsManager(true, 'sources');
            loadApps();
        } else {
            showNotification(data.message || `${enabled ? '启用' : '禁用'}源失败`, 'error');
            // 恢复开关状态
            const checkbox = document.getElementById(`toggle-${sourceId}`);
            if (checkbox) {
                checkbox.checked = !enabled;
            }
        }
    } catch (error) {
        console.error('切换源状态失败:', error);
        showNotification(error.message || '网络错误，请重试', 'error');
        // 恢复开关状态
        const checkbox = document.getElementById(`toggle-${sourceId}`);
        if (checkbox) {
            checkbox.checked = !enabled;
        }
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
            showSettingsManager(true, 'sources');
            loadApps();
        } else {
            showNotification(data.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除源失败:', error);
        showNotification(error.message || '网络错误，请重试', 'error');
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
            showSettingsManager(true, 'sources');
            loadApps();
        } else {
            showNotification(data.message || '添加源失败', 'error');
        }
    } catch (error) {
        console.error('添加源失败:', error);
        showNotification(error.message || '网络错误，请重试', 'error');
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