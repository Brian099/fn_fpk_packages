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

// 全局状态映射，通过 GetApps 接口实时获取
let installedStatusMap = {};

// 增强的API服务类
class ApiService {
    constructor() {
        this.baseUrl = getCgiUrl();
        this.timeout = 10000; // 10秒超时
    }

    async request(endpoint, options = {}) {
        const url = this.baseUrl + endpoint;
        const controller = new AbortController();
        const timeout = options.timeout !== undefined ? options.timeout : this.timeout;
        let timeoutId;

        if (timeout > 0) {
            timeoutId = setTimeout(() => controller.abort(), timeout);
        }

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

            // 优化前端提示：拦截特定业务错误码 40001
            if (data && data.code === 40001) {
                alert('请先在设置中配置 AppStore 存储目录');
                throw new Error(data.message || '需要配置存储目录');
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
    async post(endpoint, data = {}, options = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
            ...options
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
        return this.get('/api/system/default-volume');
    }

    // 设置默认存储空间
    async setDefaultVolume(volumeId) {
        return this.post(`/api/system/default-volume/${volumeId}`);
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
    async installApp(appId, data = {}, timeout = 0) {
        return this.post(`/api/apps/${appId}/install`, data, { timeout: timeout });
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

function hideAppDetail() {
    switchView('appGrid');
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
        searchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                currentKeyword = this.value;
                loadApps();
            }
        });

        // Optional: real-time search for clearing
        searchInput.addEventListener('input', function () {
            currentKeyword = this.value;
            if (this.value === '') loadApps();
        });
    }

    document.querySelectorAll('.tab-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-item').forEach(function (b) {
                b.classList.remove('active');
            });
            this.classList.add('active');
            currentTab = this.dataset.tab;
            loadApps();
        });
    });

    document.querySelectorAll('.base-Tab-root[data-category]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.base-Tab-root').forEach(function (b) {
                b.classList.remove('active');
            });
            document.getElementById('settingsBtn').classList.remove('active');
            this.classList.add('active');
            currentCategory = this.dataset.category;
            switchView('appGrid');
            loadApps();
        });
    });

    document.getElementById('settingsBtn').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('.base-Tab-root').forEach(function (b) {
            b.classList.remove('active');
        });
        this.classList.add('active');
        showSettingsManager(true);
    });

    document.getElementById('myAppsBtn').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('.base-Tab-root').forEach(function (b) {
            b.classList.remove('active');
        });
        document.getElementById('settingsBtn').classList.remove('active');
        this.classList.add('active');
        showMyAppsManager();
    });

    document.getElementById('appDetailOverlay').addEventListener('click', function () {
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
            // 保存已安装状态映射供卡片渲染使用
            installedStatusMap = data.data.installed || {};
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

async function renderAppGrid(apps, grouped = true, mini = false) {
    const appGrid = document.getElementById('appGrid');

    // 设置管理模式样式
    if (mini) {
        appGrid.classList.add('view-manage');
    } else {
        appGrid.classList.remove('view-manage');
    }
    if (!apps || apps.length === 0) {
        appGrid.innerHTML = '<div class="empty-state"><p>暂无应用</p></div>';
        return;
    }

    appGrid.innerHTML = '';

    if (!grouped) {
        // 扁平展示：只展示网格，不展示分类标题
        const grid = document.createElement('div');
        grid.className = 'app-grid';
        for (const app of apps) {
            const card = createAppCard(app, mini);
            grid.appendChild(card);
        }
        appGrid.appendChild(grid);
        return;
    }

    // 根据分类进行分组
    const groups = {};
    apps.forEach(app => {
        const labels = app.labels?.length > 0 ? app.labels : (app.categories || []);
        const cat = (Array.isArray(labels) && labels.length > 0) ? labels[0] : '其他';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(app);
    });

    // 默认排序：其他类别排在最后
    const sortedCategories = Object.keys(groups).sort((a, b) => {
        if (a === '其他') return 1;
        if (b === '其他') return -1;
        return a.localeCompare(b);
    });

    for (const cat of sortedCategories) {
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

        for (const app of groupApps) {
            const card = createAppCard(app, mini);
            grid.appendChild(card);
        }

        section.appendChild(header);
        section.appendChild(grid);
        appGrid.appendChild(section);
    }
}

function createAppCard(app, mini = false) {
    const card = document.createElement('div');
    card.className = 'app-card';
    card.dataset.appId = app.id;

    const iconUrl = app.icon || '/static/app/icons/trim.app-center/icon.png';
    // 规范化标签为数组
    let allLabels = app.labels || app.categories || [];
    if (typeof allLabels === 'string') {
        allLabels = allLabels.split(',').map(s => s.trim()).filter(s => s);
    }

    // 显示所有标签
    const displayCategory = allLabels.length > 0 ? allLabels.join(', ') : '其他';

    // 实时判断是否安装：使用 loadApps 时获取的已安装列表
    // 匹配规则：appname 或 id 存在于 installedStatusMap 中
    const installedInfo = installedStatusMap[app.appname] || installedStatusMap[app.id];
    const isInstalled = !!installedInfo;
    const installedVersion = installedInfo ? installedInfo.version : null;

    // 状态检测逻辑
    let btnText = '安装';
    let btnClass = 'semi-button-primary';
    let isUpdate = false;

    if (isInstalled) {
        // 检查是否有更新
        if (installedVersion && compareVersions(app.version, installedVersion) > 0) {
            btnText = '更新';
            btnClass = 'semi-button-warning'; // 使用警告色表示更新
            isUpdate = true;
        } else {
            btnText = '卸载';
            btnClass = 'semi-button-danger';
        }
    }

    const isRecommended = app.recommended || false;

    card.innerHTML = `
        <div class="app-card-icon" style="background-image: url('${iconUrl}')"></div>
        <div class="app-card-info">
            <div class="app-card-name-row">
                <div class="app-card-name">${escapeHtml(app.name)}</div>
                ${isInstalled ? `<span class="app-installed-badge">${isUpdate ? '有更新' : '已安装'}</span>` : ''}
            </div>
            <div class="app-card-category">${escapeHtml(displayCategory)}</div>
            <div class="app-card-meta">
                <div class="app-card-actions">
                    ${mini ? `<button class="semi-button ${isRecommended ? 'semi-button-primary' : 'semi-button-secondary'} app-card-recommend-btn" title="推荐">${isRecommended ? '★' : '☆'} 推荐</button>` : ''}
                    <button class="semi-button semi-button-secondary app-card-tag-btn">分类</button>
                    <button class="semi-button ${btnClass} app-card-install-btn">${btnText}</button>
                </div>
            </div>
        </div>
    `;

    card.addEventListener('click', function (e) {
        if (!e.target.closest('.semi-button') && !e.target.closest('.app-card-tag-btn') && !e.target.closest('.app-card-recommend-btn')) {
            showAppDetail(app.id);
        }
    });

    const installBtn = card.querySelector('.app-card-install-btn');
    if (installBtn) {
        installBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (isUpdate) {
                // 点击更新，执行安装流程
                installApp(app);
            } else if (isInstalled) {
                uninstallApp(app.id, app.name);
            } else {
                installApp(app);
            }
        });
    }

    const tagBtn = card.querySelector('.app-card-tag-btn');
    tagBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showTagPopover(e, app);
    });

    const recommendBtn = card.querySelector('.app-card-recommend-btn');
    if (recommendBtn) {
        recommendBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleRecommend(app, !isRecommended, recommendBtn);
        });
    }

    return card;
}

async function toggleRecommend(app, shouldRecommend, btnEl) {
    try {
        let sourceId = app.source_id;
        if (!sourceId) {
            const sourcesData = await apiRequest('/api/sources');
            const localSource = sourcesData.data.sources.find(s => s.local);
            if (localSource) sourceId = localSource.id;
        }

        if (!sourceId) {
            showNotification('未找到应用源信息', 'error');
            return;
        }

        const data = await apiRequest(`/api/sources/${encodeURIComponent(sourceId)}/apps/${encodeURIComponent(app.id)}/labels`, {
            method: 'PUT',
            body: JSON.stringify({ recommended: shouldRecommend })
        });

        if (data.code === 0) {
            app.recommended = shouldRecommend;
            btnEl.classList.toggle('semi-button-primary', shouldRecommend);
            btnEl.classList.toggle('semi-button-secondary', !shouldRecommend);
            btnEl.textContent = (shouldRecommend ? '★' : '☆') + ' 推荐';
            showNotification(shouldRecommend ? '已设为推荐' : '已取消推荐', 'success');
        } else {
            showNotification(data.message || '操作失败', 'error');
        }
    } catch (error) {
        console.error('更新推荐状态失败:', error);
        showNotification(error.message || '网络错误', 'error');
    }
}

async function showAppDetail(appId) {
    try {
        const [appData, statusData] = await Promise.all([
            apiRequest(`/api/apps/${appId}`),
            apiRequest(`/api/apps/${appId}/status`)
        ]);

        if (appData.code === 0) {
            const app = appData.data;
            app.status = statusData.code === 0 ? statusData.data : { status: 'unknown', running: false, installed: false };
            renderAppDetail(app);
            switchView('appDetailView');
        }
    } catch (error) {
        console.error('获取应用详情失败:', error);
    }
}

function renderAppDetail(app) {
    const detailEl = document.getElementById('appDetailView');

    const labels = app.labels?.length > 0 ? app.labels : (app.categories || []);
    const displayLabels = Array.isArray(labels) ? labels.join(', ') : '';
    const iconHtml = app.icon
        ? `<img src="${app.icon}" alt="${app.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 12px;">`
        : `<div style="width: 64px; height: 64px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;"><span style="color: white; font-size: 32px;">${app.name.charAt(0).toUpperCase()}</span></div>`;

    let actionButtons = '';
    const status = app.status || { status: 'unknown', running: false };
    
    // 检查是否有新版本
    const hasUpdate = (status.version && compareVersions(app.version, status.version) > 0);

    // 根据安装状态显示不同的按钮组
    if (status.installed || (status.status !== 'noinstall' && status.status !== 'unknown')) {
        // 已安装状态：显示 启动/停止 和 卸载
        if (status.status === 'running') {
            actionButtons = `
                ${hasUpdate ? `<button class="semi-button semi-button-warning" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">更新至 ${app.version}</button>` : ''}
                <button class="semi-button semi-button-secondary" onclick="stopApp('${app.id}')">停止应用</button>
                <button class="semi-button semi-button-danger" onclick="uninstallApp('${app.id}', '${app.name}')">卸载</button>
            `;
        } else {
            // 包括 stopped, start 等所有非运行状态
            actionButtons = `
                ${hasUpdate ? `<button class="semi-button semi-button-warning" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">更新至 ${app.version}</button>` : ''}
                <button class="semi-button semi-button-primary" onclick="startApp('${app.id}')">${status.status === 'start' ? '启动 (未启动)' : '启动'}</button>
                <button class="semi-button semi-button-danger" onclick="uninstallApp('${app.id}', '${app.name}')">卸载</button>
            `;
        }
    } else {
        // 未安装状态
        actionButtons = `<button class="semi-button semi-button-primary" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">安装</button>`;
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
                    <div class="info-value">
                        ${escapeHtml(app.status.version || app.version)}
                        ${(app.status.version && compareVersions(app.version, app.status.version) > 0) ? `<span style="color: var(--semi-color-warning); font-size: 11px; margin-left:8px;">(有新版 ${app.version})</span>` : ''}
                    </div>
                </div>
                <div class="info-item">
                <div class="info-label">分类</div>
                <div class="info-value">${escapeHtml(displayLabels)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">下载次数</div>
                <div class="info-value">${app.download_count || 0}</div>
            </div>
            <div class="info-item">
                <div class="info-label">运行状态</div>
                <div class="info-value">
                    <span class="status-badge status-${status.status}">${getStatusText(status.status)}</span>
                </div>
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

