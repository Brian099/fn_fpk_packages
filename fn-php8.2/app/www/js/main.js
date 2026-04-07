// Tab Switching Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = "toast show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
}

async function apiCall(endpoint, method = 'GET', data = null) {
    try {
        const options = { method };
        if (data) {
            options.body = JSON.stringify(data);
            options.headers = { 'Content-Type': 'application/json' };
        }
        const res = await fetch(endpoint, options);
        if (!res.ok) throw new Error("API Network Error");
        return await res.json();
    } catch (e) {
        showToast("请求失败: " + e.message);
        return { ok: false };
    }
}

// --- Visual Form Helpers ---

function updateFpmVisibility() {
    const pm = document.getElementById('fpm-pm').value;
    const dynamicOnly = document.querySelector('.fpm-dynamic-only');
    if (pm === 'dynamic') {
        dynamicOnly.style.display = 'block';
    } else {
        dynamicOnly.style.display = 'none';
    }
}

// Convert "256M" to 256
function parseSize(str) {
    if (!str) return "";
    return parseInt(str.replace(/[a-zA-Z]/g, ''));
}

// Convert 256 to "256M"
function formatSize(val, unit='M') {
    if (!val) return "";
    return val + unit;
}

/**
 * Simple INI Parser
 * Returns { known: {key: val}, unknown: [lines] }
 */
function parseConfig(text, knownKeys) {
    const lines = text.split('\n');
    const result = { known: {}, unknown: [] };
    
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) {
            result.unknown.push(line);
            return;
        }
        
        const parts = trimmed.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
            if (knownKeys.includes(key)) {
                result.known[key] = val;
            } else {
                result.unknown.push(line);
            }
        } else {
            result.unknown.push(line);
        }
    });
    return result;
}

// --- Data Loading ---

async function loadStatus() {
    const res = await apiCall('api/status');
    const statusText = document.getElementById('statusText');
    if (res.ok) {
        const dotActive = res.running ? 'active' : '';
        statusText.innerHTML = `<span class="dot ${dotActive}"></span> ${res.version} - ${res.running ? '运行中' : '未运行'}`;
        
        // 更新控制按钮状态
        document.getElementById('btn-start').disabled = res.running;
        document.getElementById('btn-stop').disabled = !res.running;
    } else {
        statusText.innerText = "服务离线或未安装";
    }
}

async function operateService(action) {
    if (action === 'stop') {
        const confirmed = confirm("停止 PHP 服务将导致所有依赖它的网站中断运行，确定要停止吗？");
        if (!confirmed) return;
    }
    
    showToast(`正在发送${action === 'start' ? '启动' : (action === 'stop' ? '停止' : '重启')}指令...`);
    const res = await apiCall('api/service/operation', 'POST', { action: action });
    if (res.ok) {
        showToast("指令执行成功");
        setTimeout(loadStatus, 1000);
    }
}

async function loadExtensions() {
    const container = document.getElementById('extContainer');
    container.innerHTML = '<div class="loading">读取中...</div>';
    const res = await apiCall('api/extensions');
    if (!res.ok) return;
    
    const activeSet = new Set((res.active || "").toLowerCase().split(',').map(s => s.trim()));
    const expectedModules = [
        "bcmath","bz2","calendar","ctype","curl","dba","dom","enchant","exif","fileinfo","filter","ftp","gd","gettext","gmp","hash","iconv","igbinary","imagick","imap","intl","json","ldap","libxml","mbstring","memcached","msgpack","mysqli","mysqlnd","odbc","opcache","openssl","pcntl","pcre","PDO","pdo_mysql","pdo_odbc","pdo_pgsql","pdo_sqlite","pgsql","Phar","posix","pspell","readline","redis","Reflection","session","shmop","SimpleXML","snmp","soap","sockets","sodium","SPL","sqlite3","ssh2","standard","swoole","sysvmsg","sysvsem","sysvshm","tidy","tokenizer","xdebug","xml","xmlreader","xmlrpc","xmlwriter","xsl","yaml","Zend OPcache","zip","zlib"
    ];

    container.innerHTML = '';
    expectedModules.forEach(ext => {
        if (["standard", "Core", "Reflection", "SPL"].includes(ext)) return;
        const isEnabled = activeSet.has(ext.toLowerCase());
        const item = document.createElement('div');
        item.className = 'ext-item ext-card';
        item.dataset.name = ext;
        item.innerHTML = `
            <div class="ext-info"><h4>${ext}</h4><span>${isEnabled ? '已装载' : '未启用'}</span></div>
            <label class="switch"><input type="checkbox" onchange="toggleExtensionRemote('${ext}', this.checked)" ${isEnabled ? 'checked' : ''}><span class="slider round"></span></label>
        `;
        container.appendChild(item);
    });
    
    document.getElementById('switch-opcache').checked = activeSet.has('zend opcache');
    document.getElementById('switch-xdebug').checked = activeSet.has('xdebug');
}

async function toggleExtensionRemote(ext, enable) {
    showToast("正在应用组件状态...");
    const res = await apiCall('api/extensions/toggle', 'POST', { extension: ext, enable: enable });
    if (res.ok) {
        showToast(`组件 ${ext} 变更成功`);
        loadExtensions();
    }
}

function toggleExtension(ext, enable) {
    toggleExtensionRemote(ext, enable);
}

// --- Config Management ---

async function loadConfigData() {
    // 1. Core Config
    const resCore = await apiCall('api/config/get');
    if (resCore.ok) {
        const known = ['memory_limit', 'upload_max_filesize', 'post_max_size', 'max_execution_time', 'display_errors'];
        const data = parseConfig(resCore.raw || "", known);
        
        document.getElementById('core-memory_limit').value = parseSize(data.known['memory_limit']);
        document.getElementById('core-upload_max_filesize').value = parseSize(data.known['upload_max_filesize']);
        document.getElementById('core-post_max_size').value = parseSize(data.known['post_max_size']);
        document.getElementById('core-max_execution_time').value = data.known['max_execution_time'] || "";
        document.getElementById('core-display_errors').checked = (data.known['display_errors'] === 'On' || data.known['display_errors'] === '1');
        document.getElementById('core-custom').value = data.unknown.join('\n').trim();
    }

    // 2. FPM Config
    const resFpm = await apiCall('api/fpm/get');
    if (resFpm.ok) {
        const known = ['pm', 'pm.max_children', 'pm.start_servers', 'pm.min_spare_servers', 'pm.max_spare_servers'];
        const data = parseConfig(resFpm.raw || "", known);
        
        document.getElementById('fpm-pm').value = data.known['pm'] || 'dynamic';
        document.getElementById('fpm-max_children').value = data.known['pm.max_children'] || "";
        document.getElementById('fpm-start_servers').value = data.known['pm.start_servers'] || "";
        document.getElementById('fpm-min_spare_servers').value = data.known['pm.min_spare_servers'] || "";
        document.getElementById('fpm-max_spare_servers').value = data.known['pm.max_spare_servers'] || "";
        document.getElementById('fpm-custom').value = data.unknown.join('\n').trim();
        updateFpmVisibility();
    }
}

async function saveCoreVisual() {
    showToast("正在保存核心参数...");
    let lines = ["[PHP]"];
    lines.push(`memory_limit = ${formatSize(document.getElementById('core-memory_limit').value)}`);
    lines.push(`upload_max_filesize = ${formatSize(document.getElementById('core-upload_max_filesize').value)}`);
    lines.push(`post_max_size = ${formatSize(document.getElementById('core-post_max_size').value)}`);
    lines.push(`max_execution_time = ${document.getElementById('core-max_execution_time').value || 60}`);
    lines.push(`display_errors = ${document.getElementById('core-display_errors').checked ? 'On' : 'Off'}`);
    
    const custom = document.getElementById('core-custom').value;
    if (custom) lines.push(custom);

    const res = await apiCall('api/config/save', 'POST', { raw: lines.join('\n') });
    if (res.ok) showToast("核心参数已更新并生效");
}

async function saveFPMVisual() {
    showToast("正在保存 FPM 进程配置...");
    let lines = ["[www]"];
    const pm = document.getElementById('fpm-pm').value;
    lines.push(`pm = ${pm}`);
    lines.push(`pm.max_children = ${document.getElementById('fpm-max_children').value || 50}`);
    
    if (pm === 'dynamic') {
        lines.push(`pm.start_servers = ${document.getElementById('fpm-start_servers').value || 5}`);
        lines.push(`pm.min_spare_servers = ${document.getElementById('fpm-min_spare_servers').value || 5}`);
        lines.push(`pm.max_spare_servers = ${document.getElementById('fpm-max_spare_servers').value || 35}`);
    }
    
    const custom = document.getElementById('fpm-custom').value;
    if (custom) lines.push(custom);

    const res = await apiCall('api/fpm/save', 'POST', { raw: lines.join('\n') });
    if (res.ok) {
        showToast("FPM 配置已更新并重启服务");
        loadStatus();
    }
}

function filterExts() {
    const query = document.getElementById('extSearch').value.toLowerCase();
    document.querySelectorAll('.ext-card').forEach(card => {
        card.style.display = card.dataset.name.toLowerCase().includes(query) ? 'flex' : 'none';
    });
}

window.onload = () => {
    loadStatus();
    loadExtensions();
    loadConfigData();
    setInterval(loadStatus, 15000);
};
