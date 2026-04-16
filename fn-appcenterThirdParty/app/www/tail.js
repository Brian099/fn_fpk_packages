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
    showUninstallConfirmDialog(appId, appName);
}

function showUninstallConfirmDialog(appId, appName) {
    const overlay = document.createElement('div');
    overlay.className = 'wizard-overlay';
    overlay.innerHTML = `
        <div class="wizard-dialog" style="max-width: 420px;">
            <div class="wizard-header">
                <h3>卸载应用 - ${appName}</h3>
                <button class="window-btn close" onclick="this.closest('.wizard-overlay').remove()">×</button>
            </div>
            <div class="wizard-body" style="padding: 24px; text-align: center;">
                <p style="margin-bottom: 24px; color: var(--semi-color-text-0); font-size: 15px; line-height: 1.6;">
                    您确定要卸载应用 <strong>${appName}</strong> 吗？<br>请选择您希望如何处理应用产生的数据：
                </p>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button class="semi-button semi-button-secondary" id="uninstall-keep-btn" style="height: 54px; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--semi-color-border);">
                        <div style="font-weight: 600;">保留数据卸载</div>
                        <div style="font-size: 11px; opacity: 0.6; font-weight: normal; margin-top: 2px;">保留 /vol*/@app 目录下的应用配置</div>
                    </button>
                    <button class="semi-button semi-button-danger semi-button-light" id="uninstall-wipe-btn" style="height: 54px; flex-direction: column; align-items: center; justify-content: center;">
                        <div style="font-weight: 600;">完全卸载 (包括数据)</div>
                        <div style="font-size: 11px; opacity: 0.9; font-weight: normal; margin-top: 2px;">警告：将彻底删除所有关联数据且不可恢复</div>
                    </button>
                </div>
            </div>
            <div class="wizard-footer">
                <button class="semi-button semi-button-tertiary" style="width: 100%;" onclick="this.closest('.wizard-overlay').remove()">点错了，不卸载了</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#uninstall-keep-btn').onclick = () => executeUninstall(appId, appName, true, overlay);
    overlay.querySelector('#uninstall-wipe-btn').onclick = () => {
        if (confirm(`再次确认：完全卸载将彻底删除 ${appName} 的所有数据和配置文件，此操作不可撤销！`)) {
            executeUninstall(appId, appName, false, overlay);
        }
    };
}

async function executeUninstall(appId, appName, keepData, overlay) {
    if (overlay) overlay.remove();
    showLoading('正在卸载...');
    try {
        const data = await apiRequest(`/api/apps/${appId}?keep_data=${keepData}`, {
            method: 'DELETE'
        });
        hideLoading();

        if (data.code === 0) {
            showNotification(`${appName} 已成功卸载`, 'success');
            hideAppDetail();
            // 重新加载应用列表以刷新状态
            setTimeout(() => loadApps(), 500);

            // 停止该应用的状态轮询
            if (window.appPollers && window.appPollers[appId]) {
                clearInterval(window.appPollers[appId]);
                delete window.appPollers[appId];
            }
        } else {
            showNotification(data.message || '卸载失败', 'error');
        }
    } catch (error) {
        hideLoading();
        console.error('卸载请求失败:', error);
        showNotification(error.message || '网络连接失败', 'error');
    }
}

async function showMyAppsManager() {
    const appGrid = document.getElementById('appGrid');
    appGrid.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>加载中...</p></div>';
    switchView('appGrid');

    try {
        const sourcesData = await apiRequest('/api/sources');
        const localSource = sourcesData.data.sources.find(s => s.local);

        if (!localSource) {
            appGrid.innerHTML = '<div class="empty-state"><p>暂无本地应用源</p></div>';
            return;
        }

        const appsData = await apiRequest(`/api/apps?source=${encodeURIComponent(localSource.id)}`);
        const apps = appsData.data.apps || [];

        if (apps.length === 0) {
            appGrid.innerHTML = '<div class="empty-state"><p>暂无本地应用</p></div>';
            return;
        }

        // 统一展示布局：使用 renderAppGrid (不分组，开启管理模式)
        await renderAppGrid(apps, false, true);
    } catch (error) {
        console.error('加载我的应用失败:', error);
        appGrid.innerHTML = `<div class="empty-state"><p>加载失败: ${error.message}</p></div>`;
    }
}

// === 新增：多标签系统逻辑 ===

function getSidebarCategories() {
    const categories = [];
    const buttons = document.querySelectorAll('.base-Tab-root[data-category]');
    buttons.forEach(btn => {
        const name = btn.dataset.category;
        // 过滤掉特殊分类
        if (name && name !== 'trending' && name !== 'installed' && name !== '推荐应用') {
            const iconHtml = btn.querySelector('.tab-icon')?.outerHTML || '';
            if (!categories.find(c => c.name === name)) {
                categories.push({ name, iconHtml });
            }
        }
    });
    return categories;
}

let popoverCleanup = null;

function showTagPopover(event, app) {
    // 如果已有打开的，先清理
    if (popoverCleanup) {
        popoverCleanup();
    }

    const categories = getSidebarCategories();
    const appLabels = app.labels || app.categories || [];

    const popover = document.createElement('div');
    popover.className = 'tag-popover active';

    categories.forEach(cat => {
        const item = document.createElement('div');
        const isActive = appLabels.includes(cat.name);
        item.className = 'tag-item' + (isActive ? ' active' : '');
        item.innerHTML = `
            <span class="tag-icon">${cat.iconHtml}</span>
            <span>${escapeHtml(cat.name)}</span>
        `;

        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            await toggleTag(app, cat.name, !isActive, item);
        });

        popover.appendChild(item);
    });

    const card = event.currentTarget.closest('.app-card');
    const actions = event.currentTarget.closest('.app-card-actions');
    const tagBtn = event.currentTarget;

    card.classList.add('has-popover');
    // 将 popover 挂载到按钮容器上，确保位置紧凑
    if (actions) {
        actions.appendChild(popover);
    } else {
        card.appendChild(popover);
    }

    const closeHandler = (e) => {
        // 如果点击的不是 popover 内部，也不是触发按钮本身，则收起
        if (!popover.contains(e.target) && !tagBtn.contains(e.target)) {
            cleanup();
        }
    };

    function cleanup() {
        if (popover.parentNode) {
            popover.remove();
        }
        card.classList.remove('has-popover');
        window.removeEventListener('click', closeHandler, true);
        popoverCleanup = null;
    }

    popoverCleanup = cleanup;
    // 使用 window 监听并开启捕获模式，确保能捕获到被 stopPropagation 的事件
    setTimeout(() => window.addEventListener('click', closeHandler, true), 10);
}

async function toggleTag(app, tagName, shouldAdd, itemEl) {
    const currentLabels = app.labels || app.categories || [];
    let newLabels;
    if (shouldAdd) {
        newLabels = [...new Set([...currentLabels, tagName])];
    } else {
        newLabels = currentLabels.filter(t => t !== tagName);
    }

    try {
        let sourceId = app.source_id;
        if (!sourceId) {
            // 如果 app 对象中没有 source_id，尝试获取本地源 ID
            const sourcesData = await apiRequest('/api/sources');
            const localSource = sourcesData.data.sources.find(s => s.local);
            if (localSource) sourceId = localSource.id;
        }

        if (!sourceId) {
            showNotification('未找到应用源信息，无法保存标签', 'error');
            return;
        }

        const data = await apiRequest(`/api/sources/${encodeURIComponent(sourceId)}/apps/${encodeURIComponent(app.id)}/labels`, {
            method: 'PUT',
            body: JSON.stringify({ labels: newLabels })
        });

        if (data.code === 0) {
            app.labels = newLabels;
            app.categories = newLabels;
            itemEl.classList.toggle('active', shouldAdd);

            // 更新卡片上的分类显示：显示所有已选标签
            const card = itemEl.closest('.app-card');
            if (card) {
                const catEl = card.querySelector('.app-card-category');
                if (catEl) {
                    // 确保 newLabels 是数组并显示全部
                    const labelsToShow = Array.isArray(newLabels) ? newLabels : [];
                    catEl.textContent = labelsToShow.length > 0 ? labelsToShow.join(', ') : '其他';
                }
            }
            showNotification('标签更新成功', 'success');
        } else {
            showNotification(data.message || '更新失败', 'error');
        }
    } catch (error) {
        console.error('更新标签失败:', error);
        showNotification('网络错误', 'error');
    }
}

async function showSettingsManager(integrated = true, activeTab = 'basic') {
    try {
        const [settingsData, sourcesData] = await Promise.all([
            apiRequest('/api/settings'),
            apiRequest('/api/sources')
        ]);

        renderSettingsManager(settingsData.data, sourcesData.data.sources || [], 'settingsView', activeTab);
        updateShareUrlDisplay();
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
                <div class="settings-card">
                    <div class="settings-card-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                    </div>
                    <div class="settings-card-content">
                        <div class="settings-card-title">分享我的应用</div>
                        <div class="settings-card-description">开启后，可分享本机应用给其他用户。</div>
                    </div>
                    <div class="settings-card-actions">
                        <div class="toggle-switch" style="margin-right: 16px;">
                            <input type="checkbox" id="enableAppShareToggle" ${safeSettings.enableAppShare ? 'checked' : ''} onchange="toggleAppShare(this.checked)">
                            <label for="enableAppShareToggle" class="toggle-label"></label>
                        </div>
                        <input type="number" id="sharePortInput" class="semi-input" value="${safeSettings.sharePort || 5668}" placeholder="端口" style="width: 80px;" ${safeSettings.enableAppShare ? '' : 'disabled'}>
                        <span style="color: var(--semi-color-text-3); font-size: 12px; margin-left: 8px;">${safeSettings.enableAppShare ? '服务已开启' : '服务已关闭'}</span>
                        <div id="shareUrlContainer" style="margin-left: 16px; display: ${safeSettings.enableAppShare ? 'flex' : 'none'}; align-items: center; gap: 8px;">
                            <span id="shareUrlText" style="color: var(--semi-color-text-2); font-size: 12px; font-family: monospace;"></span>
                            <button id="copyShareUrlBtn" onclick="copyShareUrl()" style="background: none; border: none; cursor: pointer; padding: 4px; color: var(--semi-color-text-3);" title="复制地址">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            </button>
                        </div>
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
    document.querySelectorAll('.dialog-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.dialog-tab').forEach(function (t) {
                t.classList.remove('active');
            });
            this.classList.add('active');
            document.querySelectorAll('.dialog-body .tab-content').forEach(function (content) {
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
            ${sources.map(function (source) {
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
    const enableAppShare = document.getElementById('enableAppShareToggle').checked;
    const sharePort = parseInt(document.getElementById('sharePortInput').value.trim()) || 5668;

    try {
        const data = await apiRequest('/api/settings', {
            method: 'POST',
            body: JSON.stringify({
                appStoreDir: appStoreDir,
                enableAppShare: enableAppShare,
                sharePort: sharePort
            })
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

async function toggleAppShare(enabled) {
    const portInput = document.getElementById('sharePortInput');
    const statusText = portInput.nextElementSibling;
    const toggle = document.getElementById('enableAppShareToggle');

    if (enabled) {
        const port = parseInt(portInput.value.trim()) || 5668;

        try {
            const checkResult = await apiRequest(`/api/settings/check-port?port=${port}`);
            if (checkResult.code !== 0 || !checkResult.data.available) {
                showNotification(checkResult.message || '端口已被占用，请修改', 'error');
                toggle.checked = false;
                return;
            }

            const settingsResult = await apiRequest('/api/settings');
            const currentConfig = settingsResult.data || {};

            const saveResult = await apiRequest('/api/settings', {
                method: 'POST',
                body: JSON.stringify({
                    appStoreDir: currentConfig.appStoreDir || '',
                    enableAppShare: true,
                    sharePort: port
                })
            });

            if (saveResult.code === 0) {
                showNotification('服务已开启', 'success');
                portInput.removeAttribute('disabled');
                if (statusText) statusText.textContent = '服务已开启';
                updateShareUrlDisplay();
            } else {
                showNotification(saveResult.message || '开启服务失败', 'error');
                toggle.checked = false;
            }
        } catch (error) {
            console.error('开启服务失败:', error);
            showNotification(error.message || '网络错误', 'error');
            toggle.checked = false;
        }
    } else {
        try {
            const settingsResult = await apiRequest('/api/settings');
            const currentConfig = settingsResult.data || {};

            const saveResult = await apiRequest('/api/settings', {
                method: 'POST',
                body: JSON.stringify({
                    appStoreDir: currentConfig.appStoreDir || '',
                    enableAppShare: false,
                    sharePort: currentConfig.sharePort || 5668
                })
            });

            if (saveResult.code === 0) {
                showNotification('服务已关闭', 'success');
            } else {
                showNotification(saveResult.message || '关闭服务失败', 'error');
            }
        } catch (error) {
            console.error('关闭服务失败:', error);
            showNotification(error.message || '网络错误', 'error');
        }
        portInput.setAttribute('disabled', 'disabled');
        if (statusText) statusText.textContent = '服务已关闭';
        document.getElementById('shareUrlContainer').style.display = 'none';
    }
}

function updateShareUrlDisplay() {
    const portInput = document.getElementById('sharePortInput');
    const shareUrlText = document.getElementById('shareUrlText');
    const shareUrlContainer = document.getElementById('shareUrlContainer');
    const toggle = document.getElementById('enableAppShareToggle');

    if (toggle && toggle.checked) {
        const port = portInput ? (parseInt(portInput.value) || 5668) : 5668;
        const hostname = window.location.hostname || 'localhost';
        const url = `http://${hostname}:${port}`;
        if (shareUrlText) shareUrlText.textContent = url;
        if (shareUrlContainer) shareUrlContainer.style.display = 'flex';
    } else {
        if (shareUrlContainer) shareUrlContainer.style.display = 'none';
    }
}

async function copyShareUrl() {
    const shareUrlText = document.getElementById('shareUrlText');
    if (!shareUrlText || !shareUrlText.textContent) {
        showNotification('地址不可用', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(shareUrlText.textContent);
        showNotification('地址已复制到剪贴板', 'success');
    } catch (err) {
        const textArea = document.createElement('textarea');
        textArea.value = shareUrlText.textContent;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showNotification('地址已复制到剪贴板', 'success');
        } catch (e) {
            showNotification('复制失败', 'error');
        }
        document.body.removeChild(textArea);
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

/**
 * 版本号比对
 * @returns {number} 1: v1 > v2, 0: v1 == v2, -1: v1 < v2
 */
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const v1Parts = v1.replace(/^v/i, '').split('.');
    const v2Parts = v2.replace(/^v/i, '').split('.');
    const len = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < len; i++) {
        const p1 = parseInt(v1Parts[i] || 0, 10);
        const p2 = parseInt(v2Parts[i] || 0, 10);
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
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
            if (status.data.status === 'stopped' || status.data.status === 'noinstall') {
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
        'noinstall': '未安装',
        'installing': '安装中',
        'starting': '启动中',
        'stopping': '停止中',
        'nostart': '运行中',
        'start': '未启动'
    };
    return statusMap[status] || status;
}

// 生成操作按钮
function generateActionButtons(appId, statusData) {
    const app = window.appsCache?.[appId];
    if (!app) return '';

    switch (statusData.status) {
        case 'running':
            return `<button class="semi-button semi-button-secondary" onclick="stopApp('${appId}')">停止</button>
                    <button class="semi-button semi-button-danger" onclick="uninstallApp('${appId}', '${app.name}')">卸载</button>`;
        case 'stopped':
            return `<button class="semi-button semi-button-primary" onclick="startApp('${appId}')">启动</button>
                    <button class="semi-button semi-button-danger" onclick="uninstallApp('${appId}', '${app.name}')">卸载</button>`;
        case 'noinstall':
            return `<button class="semi-button semi-button-primary" onclick="installApp(${JSON.stringify(app).replace(/"/g, '&quot;')})">安装</button>`;
        default:
            return `<button class="semi-button semi-button-secondary" disabled>${getStatusText(statusData.status)}</button>`;
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

// === 进度追踪功能 ===

function showInstallProgress(app) {
    let overlay = document.getElementById('install-progress-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'install-progress-overlay';
        overlay.className = 'install-progress-overlay';
        // 內联注入样式以防 style.css 未更新
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.7); display: flex; align-items: center;
            justify-content: center; z-index: 3000; font-family: sans-serif;
        `;
        overlay.innerHTML = `
            <div class="install-progress-card" style="background: white; width: 380px; padding: 30px; border-radius: 16px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div class="install-progress-title" style="font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1c1f23;">正在安装 ${escapeHtml(app.name)}</div>
                <div id="install-stage-label" style="font-size: 14px; color: #8a8e95; margin-bottom: 20px;">正在连接服务器...</div>
                <div style="height: 10px; background: #f1f3f5; border-radius: 5px; overflow: hidden; margin-bottom: 12px; position: relative;">
                    <div id="install-progress-bar" style="height: 100%; width: 0%; background: #0066ff; transition: width 0.3s ease;"></div>
                </div>
                <div id="install-progress-text" style="font-size: 13px; color: #0066ff; font-weight: 600;">0%</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

function updateInstallProgress(percentage, stage = '正在下载安装包...') {
    const bar = document.getElementById('install-progress-bar');
    const text = document.getElementById('install-progress-text');
    const stageLabel = document.getElementById('install-stage-label');

    if (stageLabel) stageLabel.textContent = stage;

    if (percentage >= 0) {
        if (bar) bar.style.width = percentage + '%';
        if (text) text.textContent = percentage + '%';
        if (percentage >= 100) {
            if (stageLabel) stageLabel.textContent = '下载完成，正在配置应用...';
        }
    } else {
        // -1 表示任务不在下载阶段（可能在解压或执行脚本）
        if (bar) bar.style.width = '100.1%'; // 保持满格
        if (text) text.textContent = '处理中...';
    }
}

function hideInstallProgress() {
    const overlay = document.getElementById('install-progress-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function pollInstallProgress(appId, defaultStage = '正在下载安装包...') {
    const pollInterval = 1000;
    const poller = setInterval(async () => {
        try {
            const res = await apiRequest('/api/apps/' + encodeURIComponent(appId) + '/install/progress');
            if (res.code === 0) {
                const percentage = res.data.percentage;
                if (percentage === -1) {
                    // 任务结束或未处于下载态
                    updateInstallProgress(100, '正在完成安装...');
                } else {
                    updateInstallProgress(percentage, defaultStage);
                }
            }
        } catch (e) {
            console.warn('获取进度失败:', e);
        }
    }, pollInterval);
    return poller;
}

window.onload = init;
