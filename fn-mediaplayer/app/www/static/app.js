// ═══════════════════════════════════════════════════════
// MediaPlayer Admin - app.js
// ═══════════════════════════════════════════════════════

const API = '/api/v1';
let groups = [], selectedClientIds = new Set(), selectedGroupIds = new Set();
let adminToken = localStorage.getItem('admin_token') || '';
let masterStatusInterval = null;
let channelPage = 1, clientPage = 1, groupPage = 1, sourcePage = 1, streamPage = 1, planPage = 1, clientLogPage = 1;
let channelPageSize = 20, clientPageSize = 20, groupPageSize = 20, sourcePageSize = 20, streamPageSize = 20, planPageSize = 20, clientLogPageSize = 20;
let localLogoEnabled = false;
let serverUrlSetting = '';
let serverBackupUrlsSetting = '';
let enableExternalSubSetting = 'false';

// ═══ API helpers ══════════════════════════════════════
let loadingCount = 0;
const _abortControllers = new Map();

function showLoading() {
  loadingCount++;
  document.getElementById('loading-overlay').classList.add('show');
}

function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) document.getElementById('loading-overlay').classList.remove('show');
}

async function api(path, opts = {}) {
  // 取消之前的同类请求（如果指定了 abortKey）
  if (opts.abortKey) {
    if (_abortControllers.has(opts.abortKey)) _abortControllers.get(opts.abortKey).abort();
    const controller = new AbortController();
    _abortControllers.set(opts.abortKey, controller);
    opts.signal = controller.signal;
    delete opts.abortKey;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
  if (!opts.silent) showLoading();
  try {
    const res = await fetch(API + path, { headers, ...opts });
    let data = {};
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { }
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        showLogin();
        throw new Error('需要重新登录');
      }
      throw new Error(data.message || `请求失败 (${res.status})`);
    }
    return data;
  } catch (e) {
    // AbortError 是主动取消，不属于错误，静默处理
    if (e.name === 'AbortError') { if (!opts.silent) hideLoading(); throw e; }
    if (!opts.silent) toast('请求失败: ' + e.message, 'error');
    throw e;
  } finally {
    if (!opts.silent) hideLoading();
  }
}

// === 请求世代计数器：防止旧请求的响应覆盖新请求的结果 ===
const _loadGen = {};
function nextGen(key) { _loadGen[key] = (_loadGen[key] || 0) + 1; return _loadGen[key]; }
function isStale(key, gen) { return _loadGen[key] !== gen; }

// === saveClientSetting：带 300ms debounce，防止快速切换时发送大量并发请求 ===
const _saveSettingTimers = {};
async function saveClientSetting(key, value) {
  return new Promise((resolve) => {
    clearTimeout(_saveSettingTimers[key]);
    _saveSettingTimers[key] = setTimeout(async () => {
      try {
        const res = await fetch(API + '/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
          body: JSON.stringify({ key, value: String(value) })
        });
        resolve(await res.json());
      } catch (e) { resolve(null); }
    }, 300);
  });
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}

function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }

// ═══ Utilities ════════════════════════════════════════
function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr), now = new Date(), diff = (now - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  return Math.floor(diff / 86400) + '天前';
}

function fmtDate(d) {
  if (!d || d.startsWith('0001-01-01')) return '<span style="color:var(--text3)">从未同步</span>';
  return new Date(d).toLocaleString('zh-CN');
}
function fmtExpiresAt(d) {
  if (!d || d.startsWith('0001-01-01')) return '<span style="color:var(--text3)">永久</span>';
  return new Date(d).toLocaleString('zh-CN');
}
function badge(status) { return `<span class="badge badge-${status}">${status}</span>`; }
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天${h}时${m}分`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}

// ═══ Login ════════════════════════════════════════════
function showLogin() {
  if (!window.location.pathname.includes('/login.html')) {
    window.location.href = '/admin/login.html';
  }
}

function hideLogin() { /* do nothing */ }

async function doLogin() {
  const password = document.getElementById('login-password').value;
  if (!password) { toast('请输入密码', 'error'); return; }
  try {
    const res = await fetch(API + '/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.code === 0 && data.data && data.data.token) {
      adminToken = data.data.token;
      localStorage.setItem('admin_token', adminToken);
      toast('登录成功');
      setTimeout(() => { window.location.href = '/admin/'; }, 500);
    } else {
      toast(data.message || '密码错误', 'error');
    }
  } catch (e) {
    toast('登录失败: ' + e.message, 'error');
  }
}

function logout() {
  adminToken = '';
  localStorage.removeItem('admin_token');
  showLogin();
  toast('已退出登录');
}

async function updateAdminPassword() {
  const oldPwd = document.getElementById('pwd-old').value;
  const newPwd = document.getElementById('pwd-new').value;
  const confirmPwd = document.getElementById('pwd-confirm').value;

  if (!oldPwd || !newPwd || !confirmPwd) { toast('请填写所有密码字段', 'error'); return; }
  if (newPwd !== confirmPwd) { toast('两次输入的新密码不一致', 'error'); return; }

  await api('/admin/settings/password', {
    method: 'PUT',
    body: JSON.stringify({ old_password: oldPwd, new_password: newPwd })
  });

  hideModal('password-modal');
  document.getElementById('pwd-old').value = '';
  document.getElementById('pwd-new').value = '';
  document.getElementById('pwd-confirm').value = '';
  toast('密码修改成功，请重新登录');
  setTimeout(() => logout(), 1500);
}

// 检查登录状态
if (!adminToken) { showLogin(); }

// ═══ Navigation ═══════════════════════════════════════
function showSection(name, el) {
  if (name !== 'sync' && masterStatusInterval) {
    clearInterval(masterStatusInterval);
    masterStatusInterval = null;
  }
  document.querySelectorAll('.main > div[id^="sec-"]').forEach(e => e.style.display = 'none');
  document.getElementById('sec-' + name).style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));

  if (el) {
    el.classList.add('active');
    // On mobile/tablet (<1025px): after navigating, collapse sidebar
    if (window.innerWidth < 1025) {
      document.getElementById('sidebar').classList.remove('show');
      document.getElementById('sidebar-overlay').classList.remove('show');
    }
  } else {
    // Attempt to find and highlight the correct nav item if el is not provided
    const navItems = document.querySelectorAll('.nav-item');
    for (let item of navItems) {
      if (item.getAttribute('onclick') && item.getAttribute('onclick').includes(`'${name}'`)) {
        item.classList.add('active');
        break;
      }
    }
  }

  localStorage.setItem('last_active_section', name);

  const loaders = {
    dashboard: loadDashboard,
    channels: () => { loadChannels(); loadChannelSources(); },
    groups: loadGroups,
    plans: loadPlans,
    sources: loadSources,
    streams: loadStreams,
    clients: loadClients,
    'client-logs': loadClientLogs,
    'client-settings': loadClientSettings,
    'update': loadUpdates,
    'sync': loadSyncSettings,
    'system-logs': () => {
      const iframe = document.getElementById('logs-iframe');
      if (iframe && (iframe.src === 'about:blank' || iframe.src.endsWith('blank'))) {
        iframe.src = '/admin/logs_viewer.html';
      }
    },
    'manual': () => {
      const iframe = document.getElementById('manual-iframe');
      if (iframe && (iframe.src === 'about:blank' || iframe.src.endsWith('blank'))) {
        iframe.src = '/admin/manual.html';
      }
    }
  };
  if (loaders[name]) loaders[name]();
}

// ═══ Mobile sidebar toggle ═══════════════════════════
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('show');
  document.getElementById('sidebar-overlay').classList.toggle('show');
}

// ═══ Sidebar click to expand (mobile/tablet narrow mode) ═══
// Capture phase ensures this runs BEFORE nav items' inline onclick handlers
document.getElementById('sidebar').addEventListener('click', function(e) {
  if (window.innerWidth >= 1025) return; // Desktop: no action needed
  const sidebar = document.getElementById('sidebar');
  // If sidebar is not expanded, expand it and block the nav item click
  if (!sidebar.classList.contains('show')) {
    e.stopPropagation();
    sidebar.classList.add('show');
    document.getElementById('sidebar-overlay').classList.add('show');
  }
}, true); // capture phase

// ═══ Dashboard ════════════════════════════════════════
async function loadDashboard() {
  const gen = nextGen('dashboard');
  const [stats, clientStats, sources, logs] = await Promise.all([
    api('/stats'), api('/admin/clients/stats'), api('/m3u'), api('/admin/clients/logs?limit=10')
  ]).catch(() => []);
  if (isStale('dashboard', gen)) return;
  const s = (stats && stats.data) || {};
  document.getElementById('stat-total').textContent = s.total_channels || 0;
  document.getElementById('stat-online').textContent = s.online_channels || 0;
  document.getElementById('stat-streams').textContent = s.active_streams || 0;
  document.getElementById('stat-uptime').textContent = formatUptime(s.uptime_seconds);
  document.getElementById('stat-memory').textContent = s.memory_mb ? s.memory_mb + ' MB' : '-';
  const cs = clientStats.data || {};
  document.getElementById('stat-clients').textContent = cs.total_clients || 0;
  document.getElementById('stat-pending').textContent = cs.pending_clients || 0;
  document.getElementById('stat-online-clients').textContent = cs.online_clients || 0;
  document.getElementById('stat-sources').textContent = sources.data ? sources.data.length : 0;

  const body = document.getElementById('dash-logs-body');
  if (logs.data && logs.data.length) {
    body.innerHTML = logs.data.map(l => {
      let actionBadge = '';
      if (l.action === 'play') actionBadge = '<span class="badge badge-success">播放</span>';
      else if (l.action === 'login') actionBadge = '<span class="badge badge-info">登录</span>';
      else if (l.action === 'heartbeat') actionBadge = '<span class="badge badge-warning" style="background:#eab308;color:#fff;">心跳</span>';
      else if (l.action === 'error') actionBadge = '<span class="badge badge-danger">错误</span>';
      else actionBadge = badge(l.action);

      return `<tr>
        <td><strong>${esc(l.client_name)}</strong> <span style="font-size:11px;color:var(--text2)">#${l.client_id}</span></td>
        <td>${actionBadge}</td>
        <td style="font-family:monospace;font-size:12px">${esc(l.ip)}</td>
        <td>${fmtDate(l.created_at)}</td>
      </tr>`;
    }).join('');
  } else {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:30px">暂无记录</td></tr>';
  }
}

// ═══ Channels ═════════════════════════════════════════
let channelTotal = 0;

let currentChannelSearch = '';
let currentChannelGroupId = 0;
let currentChannelSource = '';
let currentMuxSupport = null;

async function loadChannels(search = currentChannelSearch, groupId = currentChannelGroupId, source = currentChannelSource, muxSupport = currentMuxSupport) {
  currentChannelSearch = search;
  currentChannelGroupId = groupId;
  currentChannelSource = source;
  currentMuxSupport = muxSupport;
  const gen = nextGen('channels');

  let q = `?page=${channelPage}&page_size=${channelPageSize}`;
  if (search) q += `&search=${encodeURIComponent(search)}`;
  if (groupId > 0) q += `&group_id=${groupId}`;
  if (source) q += `&source=${encodeURIComponent(source)}`;
  if (muxSupport !== null) q += `&mux_support=${muxSupport}`;

  const [chRes, grpRes] = await Promise.all([api('/channels' + q), api('/groups', { cache: 'no-store' })]).catch(() => []);
  if (isStale('channels', gen)) return;
  groups = (grpRes && grpRes.data) || [];
  const gm = {};
  groups.forEach(g => gm[g.id] = g.name);
  const body = document.getElementById('channels-body');
  if (chRes.data && chRes.data.items) {
    channelTotal = chRes.data.total || 0;
    if (chRes.data.items.length === 0 && channelPage > 1) {
      channelPage--;
      loadChannels(search, groupId, source, currentMuxSupport);
      return;
    }
    body.innerHTML = chRes.data.items.map((c, i) => {
      let logoHtml = '<span style="color:#999">-</span>';
      if (c.logo) {
        if (c.logo.startsWith('/api/v1/logo')) {
          logoHtml = `<img data-auth-src="${c.logo}" loading="lazy" style="max-width:40px;max-height:24px;border-radius:2px;vertical-align:middle;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"><span style="display:none;color:#999">-</span>`;
        } else {
          logoHtml = `<img src="${c.logo}" loading="lazy" style="max-width:40px;max-height:24px;border-radius:2px;vertical-align:middle;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"><span style="display:none;color:#999">-</span>`;
        }
      }
      return `<tr data-id="${c.id}" data-source="${esc(c.source || '手动')}" data-group-id="${c.group_id}">
      <td><input type="checkbox" class="ch-check" value="${c.id}" onchange="updateSelectedChannels()"></td>
      <td><span class="drag-handle" title="拖拽排序">⠿</span></td>
      <td style="color:var(--text3)">${(channelPage - 1) * channelPageSize + i + 1}</td>
      <td>${logoHtml}</td>
      <td><strong class="text-ellipsis" title="${esc(c.name)}">${esc(c.name)}</strong></td>
      <td style="color:var(--text3)">${c.sort_order}</td>
      <td>${c.epg_channel_id ? esc(c.epg_channel_id) : '<span style="color:#999">-</span>'}</td>
      <td>${gm[c.group_id] || '-'}</td>
      <td><span style="font-size:12px;color:var(--text2);background:var(--surface);padding:2px 6px;border-radius:4px">${esc(c.source || '手动')}</span></td>
      <td><label class="switch" style="transform: scale(0.8); margin: 0">
        <input type="checkbox" onchange="toggleChannelDirect(${c.id}, this.checked)" ${c.is_direct !== false ? 'checked' : ''}>
        <span class="slider"></span>
      </label></td>
      <td>${badge(c.status)}</td>
      <td>${c.can_multiplex ? `<label class="switch" style="transform: scale(0.8); margin: 0">
        <input type="checkbox" onchange="toggleChannelMultiplex(${c.id}, this.checked)" ${c.enable_multiplex === 1 ? 'checked' : ''}>
        <span class="slider"></span>
      </label>` : '<span class="badge" style="color:var(--text3);background:var(--bg3);border:1px solid var(--border)">不支持</span>'}</td>
      <td style="color:var(--text3);font-size:12px">${(!c.updated_at || c.updated_at.startsWith('0001-01-01')) ? '-' : new Date(c.updated_at).toLocaleString('zh-CN')}</td>
      <td><div class="btn-group">
        <button class="btn btn-ghost btn-sm" onclick="editChannel(${c.id})">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deleteChannel(${c.id})">删除</button>
      </div></td>
    </tr>`;
    }).join('');
  }

  // 触发带鉴权的图片懒加载
  document.querySelectorAll('img[data-auth-src]').forEach(async img => {
    const handleFallback = () => {
      const fallback = img.getAttribute('data-fallback-src');
      if (fallback) {
        img.removeAttribute('data-fallback-src');
        img.src = fallback;
      } else {
        img.dispatchEvent(new Event('error'));
      }
    };
    try {
      const res = await fetch(img.getAttribute('data-auth-src'), { headers: { 'Authorization': 'Bearer ' + adminToken } });
      if (res.status === 200) {
        const blob = await res.blob();
        img.src = URL.createObjectURL(blob);
      } else {
        handleFallback();
      }
    } catch (e) {
      handleFallback();
    }
  });

  document.getElementById('check-all-channels').checked = false;
  document.getElementById('ch-group').innerHTML = groups.map(g => `<option value="${g.id}">${g.name} ${g.source && g.source !== '手动' ? '(' + esc(g.source) + ')' : ''}</option>`).join('');
  const chTotalPages = Math.max(1, Math.ceil(channelTotal / channelPageSize));
  renderPagination('channels-pagination', channelPage, chTotalPages, 'channelGoToPage', channelPageSize);
  document.getElementById('channels-info').textContent = `共 ${channelTotal} 个频道`;
  initChannelSort();

  // 每次加载频道列表时，触发一次状态轮询
  pollHealthCheckStatus();
}

function toggleAllChannels(cb) {
  document.querySelectorAll('.ch-check').forEach(el => el.checked = cb.checked);
}

async function doChannelBatchDelete() {
  const ids = Array.from(document.querySelectorAll('.ch-check:checked')).map(el => +el.value);
  if (!ids.length) { toast('请先选择要删除的频道', 'error'); return; }
  await api('/channels/batch', { method: 'DELETE', body: JSON.stringify({ ids }) });
  hideModal('channel-batch-modal');
  toast(`已删除 ${ids.length} 个频道`);
  loadChannels(document.getElementById('channel-search').value);
}

async function startHealthCheck() {
  const min = parseInt(document.getElementById('hc-expected-minutes').value) || 120;
  hideModal('health-check-modal');
  toast('正在请求启动健康检查...');
  try {
    const r = await api('/channels/health-check/start', { method: 'POST', body: JSON.stringify({ expected_minutes: min }) });
    toast(r.message || '健康检查已平滑启动', 'success');
    pollHealthCheckStatus(); // 启动后立即轮询一次状态
  } catch (e) {
    // Error is handled by api() automatically
  }
}

let healthCheckPollTimer = null;
async function pollHealthCheckStatus() {
  try {
    // 这里我们用一个比较安静的 fetch 来获取，不触发全局的 loading 遮罩
    const headers = { 'Content-Type': 'application/json' };
    if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
    const res = await fetch(API + '/channels/health-check/status', { headers });
    if (!res.ok) return;
    const json = await res.json();
    const data = json.data;
    const btn = document.getElementById('btn-health-check');
    if (!btn) return;

    if (data && data.is_running) {
      const pct = data.total > 0 ? Math.floor((data.current / data.total) * 100) : 0;
      btn.textContent = `检查中 ${pct}%`;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'not-allowed';

      // 动态计算合理的轮询时间：按进度走 1% 的时间为周期，但限制在 3秒 ~ 15秒之间
      let pollMs = 3000;
      if (data.total > 0 && data.delay_ms > 0) {
        pollMs = (data.total / 100) * data.delay_ms;
        if (pollMs < 3000) pollMs = 3000;
        if (pollMs > 15000) pollMs = 15000;
      }

      // 继续轮询
      if (healthCheckPollTimer) clearTimeout(healthCheckPollTimer);
      healthCheckPollTimer = setTimeout(pollHealthCheckStatus, pollMs);
    } else {
      btn.textContent = '健康检查';
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      if (healthCheckPollTimer) clearTimeout(healthCheckPollTimer);
    }
  } catch (e) { }
}

function channelGoToPage(p) {
  const chTotalPages = Math.max(1, Math.ceil(channelTotal / channelPageSize));
  if (p >= 1 && p <= chTotalPages) { channelPage = p; loadChannels(); }
}

function searchChannels() {
  clearTimeout(window._st);
  window._st = setTimeout(() => {
    channelPage = 1;
    currentChannelGroupId = 0;
    currentChannelSource = '';
    currentMuxSupport = null;
    document.getElementById('channel-source-filter').value = '';
    loadChannels(document.getElementById('channel-search').value);
  }, 300);
}

function filterChannelsByGroup(groupId, groupName, sourceName) {
  channelPage = 1;
  currentChannelGroupId = groupId;
  currentMuxSupport = null;
  currentChannelSearch = '';
  currentChannelSource = '';
  document.getElementById('channel-search').value = '';
  document.getElementById('channel-source-filter').value = '';
  showSection('channels');
  document.getElementById('channel-search').placeholder = `已过滤: [${sourceName}] ${groupName} ...`;
  loadChannels();
}

function filterChannelsByGroupMux(groupId, groupName, sourceName, muxSupport) {
  channelPage = 1;
  currentChannelGroupId = groupId;
  currentMuxSupport = muxSupport;
  currentChannelSearch = '';
  currentChannelSource = '';
  document.getElementById('channel-search').value = '';
  document.getElementById('channel-source-filter').value = '';
  showSection('channels');
  let muxDesc = muxSupport === 1 ? '支持复用' : '不支持复用';
  document.getElementById('channel-search').placeholder = `已过滤: [${sourceName}] ${groupName} (${muxDesc}) ...`;
  loadChannels();
}

function filterChannelsBySource(source) {
  channelPage = 1;
  currentChannelSource = source;
  document.getElementById('channel-search').value = '';
  loadChannels();
}

// ── 频道来源筛选下拉框加载 ──
async function loadChannelSources() {
  try {
    const res = await api('/admin/channels/sources', { silent: true });
    if (res && res.data) {
      const select = document.getElementById('channel-source-filter');
      if (select) {
        const currentVal = select.value;
        select.innerHTML = '<option value="">全部来源</option>' +
          res.data.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        select.value = currentVal;
      }
    }
  } catch (e) { /* ignore */ }
}

// ── 频道拖拽排序 ──
function initChannelSort() {
  const tbody = document.getElementById('channels-body');
  if (!tbody || typeof Sortable === 'undefined') return;
  if (window._channelSortable) { window._channelSortable.destroy(); window._channelSortable = null; }
  // 搜索状态下不初始化拖拽
  const searchVal = document.getElementById('channel-search')?.value.trim();
  if (searchVal) return;
  window._channelSortable = new Sortable(tbody, {
    handle: '.drag-handle',
    animation: 150,
    onMove: function(evt) {
      // 只允许在同一来源+分组内拖拽
      const dragged = evt.dragged;
      const related = evt.related;
      return dragged.dataset.source === related.dataset.source
          && dragged.dataset.groupId === related.dataset.groupId;
    },
    onEnd: function(evt) {
      // 记录被拖拽的来源+分组
      window._draggedSource = evt.item.dataset.source;
      window._draggedGroupId = evt.item.dataset.groupId;
      document.getElementById('btn-save-channel-sort').style.display = 'inline-block';
    }
  });
}

async function saveChannelOrder() {
  const tbody = document.getElementById('channels-body');
  const rows = tbody.querySelectorAll('tr');
  const items = [];
  // 使用行的全局索引，和分组排序逻辑一致
  rows.forEach((row, i) => {
    const id = parseInt(row.getAttribute('data-id'));
    if (!isNaN(id)) {
      items.push({ id: id, sort_order: (channelPage - 1) * channelPageSize + i });
    }
  });
  if (items.length === 0) return;
  try {
    await api('/admin/channels/sort', {
      method: 'PUT',
      body: JSON.stringify({
        items: items,
        group_id: currentChannelGroupId || 0,
        source: currentChannelSource || ''
      })
    });
    toast('排序已保存');
    document.getElementById('btn-save-channel-sort').style.display = 'none';
    loadChannels();
  } catch (e) {
    toast('保存排序失败: ' + (e.message || e), 'error');
    loadChannels();
  }
}

function showAddChannelModal() {
  document.getElementById('channel-modal-title').textContent = '添加频道';
  document.getElementById('ch-edit-id').value = '';
  document.getElementById('ch-name').value = '';
  document.getElementById('ch-group').innerHTML = groups.map(g => `<option value="${g.id}">${g.name} ${g.source && g.source !== '手动' ? '(' + esc(g.source) + ')' : ''}</option>`).join('');
  if (groups.length > 0) {
    document.getElementById('ch-group').value = groups[0].id;
  }
  document.getElementById('ch-url').value = '';
  document.getElementById('ch-type').value = '';
  document.getElementById('ch-logo').value = '';
  document.getElementById('ch-epg').value = '';
  document.getElementById('ch-is-direct').checked = true;
  document.getElementById('ch-enable-multiplex').checked = false;
  document.getElementById('ch-multiplex-group').style.display = 'none';
  document.getElementById('ch-user-agent').value = '';
  document.getElementById('ch-headers').value = '';
  document.getElementById('ch-fcc').value = '';
  document.getElementById('ch-fcc-type').value = '';
  document.getElementById('ch-sort').value = '0';
  showModal('channel-modal');
}

async function saveChannel() {
  const id = document.getElementById('ch-edit-id').value;
  const d = {
    name: document.getElementById('ch-name').value,
    group_id: +document.getElementById('ch-group').value,
    stream_url: document.getElementById('ch-url').value,
    stream_type: document.getElementById('ch-type').value,
    logo: document.getElementById('ch-logo').value,
    epg_channel_id: document.getElementById('ch-epg').value,
    is_direct: document.getElementById('ch-is-direct').checked,
    enable_multiplex: document.getElementById('ch-enable-multiplex').checked ? 1 : 0,
    user_agent: document.getElementById('ch-user-agent').value,
    custom_headers: document.getElementById('ch-headers').value,
    fcc: document.getElementById('ch-fcc').value,
    fcc_type: document.getElementById('ch-fcc-type').value,
    content_type: document.getElementById('ch-content-type').value,
    sort_order: parseInt(document.getElementById('ch-sort').value) || 0
  };
  if (!d.name || !d.stream_url) { toast('请填写名称和流地址', 'error'); return; }
  if (d.custom_headers) {
    try {
      JSON.parse(d.custom_headers);
    } catch (e) {
      toast('自定义 Headers 必须是合法的 JSON 格式', 'error');
      return;
    }
  }
  await api(id ? `/channels/${id}` : '/channels', { method: id ? 'PUT' : 'POST', body: JSON.stringify(d) });
  hideModal('channel-modal');
  loadChannels();
  toast(id ? '已更新' : '已添加');
}

async function editChannel(id) {
  const r = await api(`/channels/${id}`);
  if (!r.data) return;
  const c = r.data;
  document.getElementById('ch-edit-id').value = c.id;
  document.getElementById('ch-name').value = c.name;
  document.getElementById('ch-group').innerHTML = groups.map(g => `<option value="${g.id}">${g.name} ${g.source && g.source !== '手动' ? '(' + esc(g.source) + ')' : ''}</option>`).join('');
  document.getElementById('ch-group').value = c.group_id;
  document.getElementById('ch-url').value = c.stream_url;
  document.getElementById('ch-type').value = c.stream_type;
  document.getElementById('ch-logo').value = c.logo || '';
  document.getElementById('ch-epg').value = c.epg_channel_id || '';
  document.getElementById('ch-is-direct').checked = c.is_direct !== false;
  document.getElementById('ch-enable-multiplex').checked = c.enable_multiplex === 1;
  document.getElementById('ch-multiplex-group').style.display = c.can_multiplex ? 'block' : 'none';
  document.getElementById('ch-user-agent').value = c.user_agent || '';
  document.getElementById('ch-headers').value = c.custom_headers || '';
  document.getElementById('ch-fcc').value = c.fcc || '';
  document.getElementById('ch-fcc-type').value = c.fcc_type || '';
  document.getElementById('ch-content-type').value = c.content_type || '';
  document.getElementById('ch-sort').value = c.sort_order || 0;
  document.getElementById('channel-modal-title').textContent = '编辑频道';
  showModal('channel-modal');
}

async function toggleChannelDirect(id, enable) {
  try {
    const res = await api(`/channels/${id}`);
    const ch = res.data;
    if (!ch) return;
    
    ch.is_direct = enable;
    
    await api(`/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(ch)
    });
    toast(enable ? '直连模式已开启' : '直连模式已关闭');
  } catch (err) {
    console.error(err);
    toast('操作失败', 'error');
    loadChannels(); // revert UI switch
  }
}

async function toggleChannelMultiplex(id, enable) {
  try {
    const res = await api(`/channels/${id}`);
    const ch = res.data;
    if (!ch) return;
    
    ch.enable_multiplex = enable ? 1 : 0;
    
    await api(`/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(ch)
    });
    toast(enable ? '复用流已开启' : '复用流已关闭');
  } catch (err) {
    console.error(err);
    toast('操作失败', 'error');
    loadChannels(); // revert UI switch
  }
}

async function deleteChannel(id) {
  if (!confirm('确定删除？')) return;
  await api(`/channels/${id}`, { method: 'DELETE' });
  loadChannels();
}



// ═══ Groups ═══════════════════════════════════════════
let groupTotal = 0;

async function loadGroups() {
  const search = document.getElementById('group-search').value;
  let q = `?page=${groupPage}&page_size=${groupPageSize}`;
  if (search) q += '&search=' + encodeURIComponent(search);

  const r = await api('/admin/groups' + q);
  const items = r.data ? r.data.items || [] : [];
  groupTotal = r.data ? r.data.total || 0 : 0;

  if (items.length === 0 && groupPage > 1) {
    groupPage--;
    loadGroups();
    return;
  }

  selectedGroupIds.clear();
  const checkAllBox = document.getElementById('check-all-groups');
  if (checkAllBox) checkAllBox.checked = false;

  // Merge items into global groups array
  items.forEach(item => {
    const idx = groups.findIndex(g => g.id === item.id);
    if (idx >= 0) {
      groups[idx] = item;
    } else {
      groups.push(item);
    }
  });

  document.getElementById('groups-body').innerHTML = items.map((g, i) => {
    const isDefault = g.name === '未分类' && (!g.source || g.source === '手动');
    const rowClass = isDefault ? 'no-drag' : '';
    const dragHandle = isDefault ? '<span style="color:var(--text2);font-size:11px">锁定</span>' : '<span class="drag-handle" title="拖拽排序">⠿</span>';
    return `<tr data-id="${g.id}" class="${rowClass}">
    <td>${isDefault ? '' : `<input type="checkbox" class="group-check" value="${g.id}" onchange="updateSelectedGroups()">`}</td>
    <td>${dragHandle}</td>
    <td style="color:var(--text3)">${(groupPage - 1) * groupPageSize + i + 1}</td><td>${esc(g.name)}</td><td>${g.sort_order}</td>
    <td><span style="font-size:12px;color:var(--text2);background:var(--surface);padding:2px 6px;border-radius:4px">${esc(g.source || '手动')}</span></td>
    <td><label class="switch" style="transform: scale(0.8); margin: 0">
      <input type="checkbox" onchange="toggleGroupDirect(${g.id}, this.checked)" ${g.is_direct !== false ? 'checked' : ''}>
      <span class="slider"></span>
    </label></td>
    <td>${g.can_multiplex ? `<label class="switch" style="transform: scale(0.8); margin: 0">
      <input type="checkbox" onchange="toggleGroupMultiplex(${g.id}, this.checked)" ${g.enable_multiplex === 1 ? 'checked' : ''}>
      <span class="slider"></span>
    </label>` : '<span class="badge" style="color:var(--text3);background:var(--bg3);border:1px solid var(--border)">不支持</span>'}</td>
    <td><a href="javascript:void(0)" onclick="filterChannelsByGroupMux(${g.id}, '${esc(g.name)}', '${esc(g.source || '手动')}', 1)" style="font-weight:bold;color:var(--success);text-decoration:underline;">${(g.channel_count || 0) - (g.non_mux_count || 0)}</a></td>
    <td><a href="javascript:void(0)" onclick="filterChannelsByGroupMux(${g.id}, '${esc(g.name)}', '${esc(g.source || '手动')}', 0)" style="font-weight:bold;color:var(--danger);text-decoration:underline;">${g.non_mux_count || 0}</a></td>
    <td><a href="javascript:void(0)" onclick="filterChannelsByGroup(${g.id}, '${esc(g.name)}', '${esc(g.source || '手动')}')" style="font-weight:bold;color:var(--primary);text-decoration:underline;">${g.channel_count || 0}</a></td>
    <td style="color:var(--text3);font-size:12px">${(!g.updated_at || g.updated_at.startsWith('0001-01-01')) ? '-' : new Date(g.updated_at).toLocaleString('zh-CN')}</td>
    <td>
      ${isDefault ? '<span style="color:var(--text3);font-size:12px;user-select:none">系统内置</span>' : `<div class="btn-group">
        <button class="btn btn-ghost btn-sm" onclick="editGroup(${g.id})">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGroup(${g.id}, '${esc(g.source || '手动')}', '${esc(g.name)}', ${g.channel_count})">删除</button>
      </div>`}
    </td>
  </tr>`}).join('');

  const grpTotalPages = Math.max(1, Math.ceil(groupTotal / groupPageSize));
  renderPagination('groups-pagination', groupPage, grpTotalPages, 'groupGoToPage', groupPageSize);
  document.getElementById('groups-info').textContent = `共 ${groupTotal} 个分组`;
  initGroupSort();
}

function groupGoToPage(p) {
  const grpTotalPages = Math.max(1, Math.ceil(groupTotal / groupPageSize));
  if (p >= 1 && p <= grpTotalPages) { groupPage = p; loadGroups(); }
}
function searchGroups() {
  clearTimeout(window._gt);
  window._gt = setTimeout(() => {
    groupPage = 1;
    loadGroups();
    // 搜索时禁用拖拽，清空搜索后恢复
    const searchVal = document.getElementById('group-search').value.trim();
    if (searchVal && window._groupSortable) {
      window._groupSortable.option('disabled', true);
    }
  }, 300);
}

// ── 分组拖拽排序 ──
function initGroupSort() {
  const tbody = document.getElementById('groups-body');
  if (!tbody || typeof Sortable === 'undefined') return;
  if (window._groupSortable) { window._groupSortable.destroy(); window._groupSortable = null; }
  // 搜索状态下不初始化拖拽
  const searchVal = document.getElementById('group-search')?.value.trim();
  if (searchVal) return;
  window._groupSortable = new Sortable(tbody, {
    handle: '.drag-handle',
    animation: 150,
    filter: '.no-drag',
    onEnd: function() {
      document.getElementById('btn-save-sort').style.display = 'inline-block';
    }
  });
}

async function saveGroupOrder() {
  const tbody = document.getElementById('groups-body');
  const rows = tbody.querySelectorAll('tr');
  const items = [];
  rows.forEach((row, i) => {
    const id = parseInt(row.getAttribute('data-id'));
    if (!isNaN(id) && !row.classList.contains('no-drag')) {
      items.push({ id: id, sort_order: (groupPage - 1) * groupPageSize + i });
    }
  });
  // "未分类" 固定 sort_order = 99999
  rows.forEach(row => {
    if (row.classList.contains('no-drag')) {
      const id = parseInt(row.getAttribute('data-id'));
      if (!isNaN(id)) items.push({ id: id, sort_order: 99999 });
    }
  });
  if (items.length === 0) return;
  try {
    await api('/admin/groups/sort', { method: 'PUT', body: JSON.stringify({ items }) });
    toast('排序已保存');
    document.getElementById('btn-save-sort').style.display = 'none';
    loadGroups();
  } catch (e) {
    toast('保存排序失败: ' + (e.message || e), 'error');
    loadGroups();
  }
}

function toggleAllGroups(el) {
  document.querySelectorAll('.group-check').forEach(cb => { cb.checked = el.checked; });
  updateSelectedGroups();
}

function updateSelectedGroups() {
  selectedGroupIds.clear();
  document.querySelectorAll('.group-check:checked').forEach(cb => selectedGroupIds.add(+cb.value));
}

async function doGroupBatchDelete() {
  if (selectedGroupIds.size === 0) { toast('请先勾选分组', 'error'); hideModal('group-batch-modal'); return; }
  const r = await api('/groups/batch', {
    method: 'POST',
    body: JSON.stringify({ ids: [...selectedGroupIds], action: 'delete' })
  });
  hideModal('group-batch-modal');
  toast(`已删除勾选的分组`);
  loadGroups();
}

function showAddGroupModal() {
  document.getElementById('grp-edit-id').value = '';
  document.getElementById('grp-name').value = '';
  document.getElementById('grp-sort').value = '0';
  document.getElementById('grp-is-direct').checked = true;
  document.getElementById('grp-enable-multiplex').checked = false;
  document.getElementById('grp-multiplex-group').style.display = 'none';
  document.getElementById('grp-user-agent').value = '';
  document.getElementById('grp-headers').value = '';
  document.getElementById('group-modal-title').textContent = '添加分组';
  showModal('group-modal');
}

async function saveGroup() {
  const id = document.getElementById('grp-edit-id').value;
  const d = {
    name: document.getElementById('grp-name').value,
    sort_order: +document.getElementById('grp-sort').value || 0,
    is_direct: document.getElementById('grp-is-direct').checked,
    enable_multiplex: document.getElementById('grp-enable-multiplex').checked ? 1 : 0,
    user_agent: document.getElementById('grp-user-agent').value,
    custom_headers: document.getElementById('grp-headers').value
  };
  if (!d.name) { toast('请填写名称', 'error'); return; }
  if (d.custom_headers) {
    try {
      JSON.parse(d.custom_headers);
    } catch (e) {
      toast('自定义 Headers 必须是合法的 JSON 格式', 'error');
      return;
    }
  }
  await api(id ? `/groups/${id}` : '/groups', { method: id ? 'PUT' : 'POST', body: JSON.stringify(d) });
  hideModal('group-modal');
  loadGroups();
  toast(id ? '已更新' : '已添加');
}

function editGroup(id) {
  const g = groups.find(x => x.id === id);
  if (!g) return;
  document.getElementById('grp-edit-id').value = g.id;
  document.getElementById('grp-name').value = g.name;
  document.getElementById('grp-sort').value = g.sort_order;
  document.getElementById('grp-is-direct').checked = g.is_direct !== false;
  document.getElementById('grp-enable-multiplex').checked = g.enable_multiplex === 1;
  document.getElementById('grp-multiplex-group').style.display = g.can_multiplex ? 'block' : 'none';
  document.getElementById('grp-user-agent').value = g.user_agent || '';
  document.getElementById('grp-headers').value = g.custom_headers || '';
  document.getElementById('group-modal-title').textContent = '编辑分组';
  showModal('group-modal');
}

async function toggleGroupDirect(id, enable) {
  try {
    const g = groups.find(x => x.id === id);
    if (!g) return;
    
    const updateData = { ...g, is_direct: enable };
    
    await api(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    g.is_direct = enable;
    toast(enable ? '分组直连已开启' : '分组直连已关闭');
  } catch (err) {
    console.error(err);
    toast('操作失败', 'error');
    loadGroups();
  }
}

async function toggleGroupMultiplex(id, enable) {
  try {
    const g = groups.find(x => x.id === id);
    if (!g) return;
    
    const updateData = { ...g, enable_multiplex: enable ? 1 : 0 };
    
    await api(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    g.enable_multiplex = enable ? 1 : 0;
    toast(enable ? '分组复用已开启' : '分组复用已关闭');
  } catch (err) {
    console.error(err);
    toast('操作失败', 'error');
    loadGroups();
  }
}

async function deleteGroup(id, source, name, count) {
  if (!confirm(`该分组 [${source} - ${name}] 下包含 ${count} 个频道。\n删除分组将同步删除这些频道，此操作不可恢复，确定要删除吗？`)) return;
  await api(`/groups/${id}`, { method: 'DELETE' });
  loadGroups();
}

let sourcesList = [];
let syncPollTimeout = null;

async function loadSources(silent = false) {
  const r = await api('/m3u', { silent: silent });
  sourcesList = r.data || [];
  renderSourcesTable();

  if (syncPollTimeout) clearTimeout(syncPollTimeout);
  if (sourcesList.some(s => s.sync_status === 'syncing')) {
    syncPollTimeout = setTimeout(() => loadSources(true), 3000);
  }
}

function renderSourcesTable() {
  const total = sourcesList.length;
  const totalPages = Math.max(1, Math.ceil(total / sourcePageSize));
  if (sourcePage > totalPages) sourcePage = Math.max(1, totalPages);
  const start = (sourcePage - 1) * sourcePageSize;
  const pageData = sourcesList.slice(start, start + sourcePageSize);

  const tbody = document.getElementById('sources-body');
  if (pageData.length) {
    tbody.innerHTML = pageData.map((s, i) => `<tr>
      <td style="color:var(--text3)">${(sourcePage - 1) * sourcePageSize + i + 1}</td>
      <td><strong>${esc(s.name)}</strong></td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis" title="${esc(s.url)}">${esc(s.url)}</td>
      <td>${s.auto_sync ? `<span class="badge badge-online">开启 (${s.sync_interval}h)</span>` : '<span class="badge badge-offline">关闭</span>'}</td>
      <td>
        ${s.sync_status === 'syncing' ? '<span style="color:var(--primary); font-weight:500">🔄 正在同步...</span>' : 
          s.sync_status === 'error' ? `<span style="color:#ff4d4f;cursor:help;font-weight:500" title="${esc(s.sync_error)}">❌ 同步失败</span><div style="font-size:11px;color:var(--text3);margin-top:2px" title="${esc(s.sync_error)}">${esc(s.sync_error).length > 20 ? esc(s.sync_error).substring(0, 20) + '...' : esc(s.sync_error)}</div>` : 
          s.sync_status === 'idle' && s.last_sync ? `<span style="color:#52c41a;font-weight:500">✅ 正常</span><div style="font-size:11px;color:var(--text3);margin-top:2px">${fmtDate(s.last_sync)}</div>` : 
          `<span style="color:var(--text3)">未同步</span>`}
      </td>
      <td><div class="btn-group">
        <button class="btn btn-primary btn-sm" onclick="importSource(${s.id})">同步</button>
        <button class="btn btn-ghost btn-sm" onclick="editSource(${s.id})">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSource(${s.id})">删除</button>
      </div></td>
    </tr>`).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:40px">暂无源</td></tr>';
  }
  renderPagination('sources-pagination', sourcePage, totalPages, 'sourceGoToPage', sourcePageSize);
  document.getElementById('sources-info').textContent = `共 ${total} 个源`;
}

function sourceGoToPage(p) {
  const totalPages = Math.max(1, Math.ceil(sourcesList.length / sourcePageSize));
  if (p >= 1 && p <= totalPages) { sourcePage = p; renderSourcesTable(); }
}

function showAddSourceModal() {
  document.getElementById('src-modal-title').innerText = '添加M3U/TXT源';
  document.getElementById('src-edit-id').value = '';
  document.getElementById('src-name').value = '';
  document.getElementById('src-url').value = '';
  document.getElementById('src-auto-sync').value = 'false';
  document.getElementById('src-sync-interval').value = '12';
  document.getElementById('src-user-agent').value = '';
  document.getElementById('src-headers').value = '';
  showModal('source-modal');
}

function editSource(id) {
  const s = sourcesList.find(x => x.id === id);
  if (!s) return;
  document.getElementById('src-modal-title').innerText = '编辑M3U/TXT源';
  document.getElementById('src-edit-id').value = s.id;
  document.getElementById('src-name').value = s.name;
  document.getElementById('src-url').value = s.url;
  document.getElementById('src-auto-sync').value = s.auto_sync ? 'true' : 'false';
  document.getElementById('src-sync-interval').value = s.sync_interval || 12;
  document.getElementById('src-user-agent').value = s.user_agent || '';
  document.getElementById('src-headers').value = s.custom_headers || '';
  showModal('source-modal');
}

async function saveSource() {
  const id = document.getElementById('src-edit-id').value;
  const d = {
    name: document.getElementById('src-name').value,
    url: document.getElementById('src-url').value,
    auto_sync: document.getElementById('src-auto-sync').value === 'true',
    sync_interval: parseInt(document.getElementById('src-sync-interval').value) || 12,
    user_agent: document.getElementById('src-user-agent').value,
    custom_headers: document.getElementById('src-headers').value
  };
  if (!d.name || !d.url) { toast('请填写完整', 'error'); return; }
  if (d.custom_headers) {
    try {
      JSON.parse(d.custom_headers);
    } catch (e) {
      toast('自定义 Headers 必须是合法的 JSON 格式', 'error');
      return;
    }
  }
  await api(id ? `/m3u/${id}` : '/m3u', { method: id ? 'PUT' : 'POST', body: JSON.stringify(d) });
  hideModal('source-modal');
  loadSources();
  toast(id ? '已更新' : '已添加');
}

async function importSource(id) {
  toast('已发起后台同步指令...');
  try {
    const r = await api(`/m3u/${id}/import`, { method: 'POST' });
    if (r.data && r.data.message) {
      toast(r.data.message, 'success');
    }
  } catch (e) {
    toast('指令下发失败: ' + e.message, 'error');
  }
  loadSources(true);
}

async function deleteSource(id) {
  if (!confirm('确定？')) return;
  await api(`/m3u/${id}`, { method: 'DELETE' });
  loadSources();
}

async function importM3UContent() {
  const n = document.getElementById('import-name').value;
  const c = document.getElementById('import-content').value;
  if (!n) { toast('请填写来源名称', 'error'); return; }
  if (!c) { toast('请粘贴内容', 'error'); return; }
  toast('正在导入...');
  const r = await api('/m3u/import-string', { method: 'POST', body: JSON.stringify({ name: n, content: c }) });
  toast(r.data ? `导入: ${r.data.imported} 频道` : '失败', 'error');
  if (r.data) hideModal('import-modal');
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const text = e.target.result;
    if (text.includes('#EXTM3U') || text.includes('#EXTINF') || text.includes(',')) {
      document.getElementById('import-content').value = text;
      toast('文件读取成功，请点击导入', 'success');
      const nameInput = document.getElementById('import-name');
      if (!nameInput.value) {
        nameInput.value = file.name.replace(/\.[^/.]+$/, "");
      }
    } else {
      toast('文件格式不正确，需要是标准的 M3U 或 TXT 格式', 'error');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// ═══ Streams ══════════════════════════════════════════
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '0 KB/s';
  if (bytesPerSec > 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
  return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
}

let streamsList = [];
async function loadStreams() {
  const r = await api('/stream/active');
  streamsList = r.data || [];
  renderStreamsTable();
}

function renderStreamsTable() {
  const total = streamsList.length;
  const totalPages = Math.max(1, Math.ceil(total / streamPageSize));
  if (streamPage > totalPages) streamPage = Math.max(1, totalPages);
  const start = (streamPage - 1) * streamPageSize;
  const pageData = streamsList.slice(start, start + streamPageSize);

  const body = document.getElementById('streams-body');
  if (pageData.length) {
    body.innerHTML = pageData.map(s => `<tr>
      <td><div style="font-size:12px;color:var(--text2)">${s.session_id.substring(0, 15)}...</div>
          <strong>${esc(s.client_name) || ('设备ID: ' + s.client_id)}</strong><br>
          <span style="font-size:11px;color:var(--text2)">IP: ${s.client_ip}</span></td>
      <td><strong>${esc(s.channel_name)}</strong><br><span style="font-size:11px;color:var(--text2)">ID: ${s.channel_id}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.url)}">${esc(s.url)}</td>
      <td>${badge(s.status)}<br><span style="font-size:12px;color:var(--accent);font-weight:bold">${formatSpeed(s.speed_bytes)}</span></td>
      <td><span style="font-size:11px">启动: ${fmtDate(s.started_at)}</span><br><span style="font-size:11px;color:var(--text2)">活跃: ${fmtDate(s.last_active)}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="killStream('${s.session_id}')">踢下线</button></td>
    </tr>`).join('');
  } else {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:40px">暂无活跃流</td></tr>';
  }
  renderPagination('streams-pagination', streamPage, totalPages, 'streamGoToPage', streamPageSize);
  document.getElementById('streams-info').textContent = `共 ${total} 个活跃流`;
}

function streamGoToPage(p) {
  const totalPages = Math.max(1, Math.ceil(streamsList.length / streamPageSize));
  if (p >= 1 && p <= totalPages) { streamPage = p; renderStreamsTable(); }
}

async function killStream(sessionId) {
  if (!confirm('确定要强制断开该代理流吗？')) return;
  await api(`/stream/active/${sessionId}`, { method: 'DELETE' });
  toast('指令已发送');
  setTimeout(loadStreams, 500);
}

// ═══ Clients ══════════════════════════════════════════
let clientTotal = 0;

async function loadClients() {
  const gen = nextGen('clients');
  const status = document.getElementById('client-status-filter').value;
  const search = document.getElementById('client-search').value;
  let q = `?page=${clientPage}&page_size=${clientPageSize}`;
  if (status) q += '&status=' + status;
  if (search) q += '&search=' + encodeURIComponent(search);

  const [listRes, statsRes] = await Promise.all([api('/admin/clients' + q), api('/admin/clients/stats')]).catch(() => []);
  if (isStale('clients', gen)) return;

  const st = statsRes.data || {};
  document.getElementById('cstat-total').textContent = st.total_clients || 0;
  document.getElementById('cstat-pending').textContent = st.pending_clients || 0;
  document.getElementById('cstat-online').textContent = st.online_clients || 0;

  const body = document.getElementById('clients-body');
  const items = listRes.data ? listRes.data.items || [] : [];
  clientTotal = listRes.data ? listRes.data.total || 0 : 0;
  selectedClientIds.clear();

  if (items.length === 0) {
    body.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text2);padding:40px">暂无设备</td></tr>';
  } else {
    body.innerHTML = items.map((c, i) => `<tr>
      <td><input type="checkbox" class="client-check" value="${c.id}" onchange="updateSelectedClients()"></td>
      <td style="color:var(--text3)">${(clientPage - 1) * clientPageSize + i + 1}</td>
      <td><strong>${esc(c.name)}</strong> ${c.request_note ? `<span class="badge" style="font-size:11px;padding:2px 6px;color:var(--accent);background:rgba(22,186,170,.1);border-color:var(--accent);">${esc(c.request_note)}</span>` : ''}<br><span style="font-size:11px;color:var(--text2)">${esc(c.device_id).substring(0, 16)}...</span></td>
      <td>${esc(c.device_model)}<br><span style="font-size:11px;color:var(--text2)">${esc(c.device_os)}</span></td>
      <td style="font-family:monospace;font-size:12px">${esc(c.ip)}</td>
      <td>${badge(c.status)}</td>
      <td>
        <label class="switch" style="transform: scale(0.8)">
          <input type="checkbox" onchange="toggleTester(${c.id}, this.checked)" ${c.is_tester ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </td>
      <td>${fmtExpiresAt(c.expires_at)}</td>
      <td>${c.total_play_minutes}分钟</td>
      <td>${timeAgo(c.last_seen)}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td>
        <div class="btn-group">
          <button class="btn btn-ghost btn-sm" onclick="showClientDetail(${c.id})">详情</button>
          ${c.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="showApproveModal(${c.id})">通过</button><button class="btn btn-danger btn-sm" onclick="showRejectModal(${c.id})">拒绝</button>` : ''}
          ${c.status === 'approved' ? `<button class="btn btn-primary btn-sm" onclick="showApproveModal(${c.id})">改授权</button><button class="btn btn-warn btn-sm" onclick="showRejectModal(${c.id})">吊销</button>` : ''}
          ${c.status === 'rejected' || c.status === 'banned' ? `<button class="btn btn-info btn-sm" onclick="unbanClient(${c.id})">解封</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
  }
  const cliTotalPages = Math.max(1, Math.ceil(clientTotal / clientPageSize));
  renderPagination('clients-pagination', clientPage, cliTotalPages, 'clientGoToPage', clientPageSize);
  document.getElementById('clients-info').textContent = `共 ${clientTotal} 台设备`;
}

function clientGoToPage(p) {
  const cliTotalPages = Math.max(1, Math.ceil(clientTotal / clientPageSize));
  if (p >= 1 && p <= cliTotalPages) { clientPage = p; loadClients(); }
}
function searchClients() { clearTimeout(window._ct); window._ct = setTimeout(loadClients, 300); }

function toggleAllClients(el) {
  document.querySelectorAll('.client-check').forEach(cb => { cb.checked = el.checked; });
  updateSelectedClients();
}

function updateSelectedClients() {
  selectedClientIds.clear();
  document.querySelectorAll('.client-check:checked').forEach(cb => selectedClientIds.add(+cb.value));
}

async function showClientDetail(id) {
  const r = await api(`/admin/clients/${id}`);
  if (!r.data) { toast('加载失败', 'error'); return; }
  const c = r.data;
  const tokenPreview = c.token_preview ? c.token_preview + '********' : '(无令牌)';

  document.getElementById('client-detail-content').innerHTML = `
    <div class="detail-grid" style="margin-bottom:20px">
      <div class="label">设备ID</div><div class="value" style="font-family:monospace">${esc(c.device_id)}</div>
      <div class="label">设备名称</div><div class="value">${esc(c.name)}</div>
      <div class="label">设备型号</div><div class="value">${esc(c.device_model)}</div>
      <div class="label">系统版本</div><div class="value">${esc(c.device_os)}</div>
      <div class="label">客户端版本</div><div class="value">${esc(c.app_version)}</div>
      <div class="label">IP地址</div><div class="value" style="font-family:monospace">${esc(c.ip)}</div>
      <div class="label">状态</div><div class="value">${badge(c.status)}</div>
      <div class="label">当前套餐</div><div class="value">${c.plan_name ? '<span class="badge badge-info">' + esc(c.plan_name) + '</span>' : '-'}</div>
      <div class="label">设备过期时间</div><div class="value">${fmtExpiresAt(c.expires_at)}</div>
      <div class="label">审批人</div><div class="value">${esc(c.approved_by) || '-'}</div>
      <div class="label">拒绝原因</div><div class="value">${esc(c.reject_reason) || '-'}</div>
      <div class="label">累计播放</div><div class="value">${c.total_play_minutes} 分钟</div>
      <div class="label">最近在线</div><div class="value">${fmtDate(c.last_seen)}</div>
      <div class="label">注册时间</div><div class="value">${fmtDate(c.created_at)}</div>
      <div class="label">申请备注</div><div class="value">${esc(c.request_note) || '-'}</div>
      <div class="label">令牌</div>
      <div class="value" style="display:flex;align-items:center;gap:8px;">
        <code style="font-size:12px" id="detail-token-display" data-preview="${esc(tokenPreview)}" data-full="${esc(c.access_token || '')}">${esc(tokenPreview)}</code>
        ${c.access_token ? `<svg onclick="toggleTokenVisibility(this)" style="width:16px;height:16px;cursor:pointer;color:var(--text2);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>` : ''}
      </div>
      <div class="label">远程日志</div>
      <div class="value" style="display:flex;align-items:center;gap:8px;">
        <label style="position:relative;display:inline-block;width:36px;height:20px;">
          <input type="checkbox" onchange="this.nextElementSibling.style.backgroundColor = this.checked ? '#5fb878' : '#ccc'; this.nextElementSibling.firstElementChild.style.transform = this.checked ? 'translateX(16px)' : 'translateX(0)'; toggleClientLog(${c.id}, this.checked)" ${c.enable_log ? 'checked' : ''} style="opacity:0;width:0;height:0;">
          <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${c.enable_log ? '#5fb878' : '#ccc'};transition:.4s;border-radius:20px;">
            <span style="position:absolute;content:'';height:16px;width:16px;left:2px;bottom:2px;background-color:white;transition:.4s;border-radius:50%;transform:${c.enable_log ? 'translateX(16px)' : 'translateX(0)'};"></span>
          </span>
        </label>
        <span style="font-size:12px;color:var(--text2);">采集设备端报错及行为 (异步)</span>
      </div>
    </div>
    <div class="btn-group" style="flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="showTokenModal(${c.id})">🔑 令牌管理</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadClientLog(${c.id}, '${esc(c.device_id)}')">⬇️ 终端日志</button>
      ${c.status === 'approved' ? `<button class="btn btn-warn btn-sm" onclick="banClient(${c.id},'管理员封禁')">封禁</button>` : ''}
      ${c.status !== 'approved' ? `<button class="btn btn-primary btn-sm" onclick="showApproveModal(${c.id})">通过</button>` : ''}
      <button class="btn btn-danger btn-sm" onclick="deleteClient(${c.id})">删除设备</button>
    </div>
  `;
  showModal('client-detail-modal');
}

async function toggleClientLog(id, enable) {
  const r = await api(`/admin/clients/${id}/log-config`, {
    method: 'POST',
    body: JSON.stringify({ enable_log: enable })
  });
  if (r.code === 0) {
    toast(enable ? '已开启终端日志采集' : '已关闭终端日志采集');
    // Refresh modal
    showClientDetail(id);
  } else {
    toast(r.message || '操作失败', 'error');
  }
}

async function downloadClientLog(id, deviceId) {
  const url = `/api/v1/admin/clients/${id}/download-log`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('tv_token') }
    });
    if (!res.ok) {
      const errText = await res.text();
      let errMsg = '下载失败';
      try {
        const json = JSON.parse(errText);
        if (json.message) errMsg = json.message;
      } catch (e) {}
      toast(errMsg, 'error');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${deviceId}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast('网络错误', 'error');
  }
}

let allPlans = [];

async function loadPlans() {
  const gen = nextGen('plans');
  const [plansRes, settingsRes] = await Promise.all([
    api('/admin/plans'),
    api('/settings').catch(() => ({ data: {} }))
  ]);
  if (isStale('plans', gen)) return;
  allPlans = plansRes.data || [];
  serverUrlSetting = (settingsRes && settingsRes.data && settingsRes.data.server_url) || '';
  enableExternalSubSetting = (settingsRes && settingsRes.data && settingsRes.data.enable_external_sub) || 'false';
  renderPlansTable();
}

function renderPlansTable() {
  const total = allPlans.length;
  const totalPages = Math.max(1, Math.ceil(total / planPageSize));
  if (planPage > totalPages) planPage = Math.max(1, totalPages);
  const start = (planPage - 1) * planPageSize;
  const pageData = allPlans.slice(start, start + planPageSize);

  const showSub = (enableExternalSubSetting === 'true');
  const thSub = document.getElementById('th-plan-sub');
  if (thSub) thSub.style.display = showSub ? '' : 'none';

  document.getElementById('plans-body').innerHTML = pageData.map((p, i) => {
    const origin = serverUrlSetting || window.location.origin;
    const m3uUrl = `${origin}/api/v1/subscription?subscription_plans=${encodeURIComponent(p.name)}&subscription_token=${p.subscription_token || ''}&subscription_format=m3u`;
    const txtUrl = `${origin}/api/v1/subscription?subscription_plans=${encodeURIComponent(p.name)}&subscription_token=${p.subscription_token || ''}&subscription_format=txt`;
    const subCellHtml = showSub ? `<td>
        <div class="btn-group" style="gap:4px;">
          <button class="btn btn-ghost btn-sm" onclick="copyText('${esc(m3uUrl)}')" style="white-space:nowrap;">📋 M3U</button>
          <button class="btn btn-ghost btn-sm" onclick="copyText('${esc(txtUrl)}')" style="white-space:nowrap;">📋 TXT</button>
        </div>
      </td>` : '';
    return `<tr>
      <td style="color:var(--text3)">${(planPage - 1) * planPageSize + i + 1}</td>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${p.days > 0 ? p.days + ' 天' : '永久'}</td>
      <td>${p.max_streams}</td>
      <td>${p.price > 0 ? '¥' + p.price : '-'}</td>
      <td>${esc(p.description)}</td>
      ${subCellHtml}
      <td><div class="btn-group">
        <button class="btn btn-ghost btn-sm" onclick="editPlan(${p.id})">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deletePlan(${p.id})">删除</button>
      </div></td>
    </tr>`;
  }).join('');
  renderPagination('plans-pagination', planPage, totalPages, 'planGoToPage', planPageSize);
  document.getElementById('plans-info').textContent = `共 ${total} 个套餐`;
}

function planGoToPage(p) {
  const totalPages = Math.max(1, Math.ceil(allPlans.length / planPageSize));
  if (p >= 1 && p <= totalPages) { planPage = p; renderPlansTable(); }
}

function toggleAllPlanGroups(selectAll) {
  if (selectAll) {
    // 全选：将所有未选分组移到已选列表
    const unselectedContainer = document.getElementById('plan-groups-container');
    const unselectedTags = unselectedContainer.querySelectorAll('.plan-group-tag-unselected');
    unselectedTags.forEach(tag => {
      const groupId = parseInt(tag.getAttribute('data-id'));
      addPlanGroup(groupId);
    });
  } else {
    // 取消全选：将所有已选分组移到未选列表
    const selectedContainer = document.getElementById('plan-groups-selected');
    const selectedTags = selectedContainer.querySelectorAll('.plan-group-tag');
    selectedTags.forEach(tag => {
      const groupId = parseInt(tag.getAttribute('data-id'));
      removePlanGroup(groupId);
    });
  }
}

async function savePlan() {
  const id = document.getElementById('plan-edit-id').value;

  // Collect selected groups (in order from sortable)
  const selectedTags = document.querySelectorAll('#plan-groups-selected .plan-group-tag');
  const groupIds = Array.from(selectedTags).map(tag => parseInt(tag.getAttribute('data-id')));

  const d = {
    name: document.getElementById('plan-name').value,
    days: +document.getElementById('plan-days').value || 0,
    max_streams: +document.getElementById('plan-streams').value || 1,
    price: parseFloat(document.getElementById('plan-price').value) || 0.0,
    description: document.getElementById('plan-desc').value,
    subscription_token: document.getElementById('plan-token').value,
    group_ids: groupIds
  };
  if (!d.name) { toast('请填写名称', 'error'); return; }
  await api(id ? `/admin/plans/${id}` : '/admin/plans', { method: id ? 'PUT' : 'POST', body: JSON.stringify(d) });
  hideModal('plan-modal');
  loadPlans();
  toast(id ? '已更新' : '已添加');
}

async function editPlan(id) {
  // Fetch all groups via the unpaginated frontend API
  const groupsRes = await api('/groups');
  const groups = groupsRes.data || [];

  let p = { name: '', days: 365, max_streams: 2, price: 0, description: '', group_ids: [] };
  if (id) {
    const found = allPlans.find(x => x.id === id);
    if (found) p = found;
  }

  // 分离已选和未选分组，保持已选分组的顺序
  const selectedGroups = [];
  const unselectedGroups = [];
  const selectedIds = new Set(p.group_ids || []);
  
  // 按照 group_ids 的顺序添加已选分组
  for (const gid of (p.group_ids || [])) {
    const g = groups.find(x => x.id === gid);
    if (g) selectedGroups.push(g);
  }
  // 添加未选分组
  for (const g of groups) {
    if (!selectedIds.has(g.id)) unselectedGroups.push(g);
  }

  // 渲染已选分组（可拖拽）
  const selectedContainer = document.getElementById('plan-groups-selected');
  selectedContainer.innerHTML = selectedGroups.map(g => {
    const source = g.source && g.source !== '手动' ? g.source : '';
    const sourceTag = source ? ` <span style="font-size:11px;opacity:0.7">(${esc(source)})</span>` : '';
    return `<div class="plan-group-tag" data-id="${g.id}" data-name="${esc(g.name)}"${source ? ` data-source="${esc(source)}"` : ''} style="display:flex;align-items:center;gap:5px;cursor:grab;background:var(--accent);color:#fff;padding:4px 10px;border-radius:4px;user-select:none;">
      <span style="cursor:pointer;font-size:14px;" onclick="removePlanGroup(${g.id})">✕</span>
      ${esc(g.name)}${sourceTag}
    </div>`;
  }).join('');

  // 渲染未选分组
  const unselectedContainer = document.getElementById('plan-groups-container');
  const unselectedHeader = unselectedContainer.querySelector('div:first-child');
  unselectedContainer.innerHTML = '';
  if (unselectedHeader) unselectedContainer.appendChild(unselectedHeader);
  unselectedGroups.forEach(g => {
    const source = g.source && g.source !== '手动' ? g.source : '';
    const sourceTag = source ? ` <span style="font-size:11px;opacity:0.7">(${esc(source)})</span>` : '';
    const tag = document.createElement('div');
    tag.className = 'plan-group-tag-unselected';
    tag.setAttribute('data-id', g.id);
    tag.setAttribute('data-name', g.name);
    if (source) tag.setAttribute('data-source', source);
    tag.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;background:var(--bg2);padding:4px 10px;border-radius:4px;';
    tag.innerHTML = `<span style="font-size:14px;">+</span> ${esc(g.name)}${sourceTag}`;
    tag.onclick = () => addPlanGroup(g.id);
    unselectedContainer.appendChild(tag);
  });

  // 初始化拖拽排序
  if (window.planGroupsSortable) {
    window.planGroupsSortable.destroy();
  }
  window.planGroupsSortable = new Sortable(selectedContainer, {
    animation: 150,
    ghostClass: 'sortable-ghost'
  });

  document.getElementById('plan-edit-id').value = id || '';
  document.getElementById('plan-name').value = p.name;
  document.getElementById('plan-days').value = p.days;
  document.getElementById('plan-streams').value = p.max_streams;
  document.getElementById('plan-price').value = p.price;
  document.getElementById('plan-desc').value = p.description;
  document.getElementById('plan-token').value = p.subscription_token || '';

  const tokenGroup = document.getElementById('plan-token-group');
  if (tokenGroup) {
    tokenGroup.style.display = (enableExternalSubSetting === 'true') ? 'block' : 'none';
  }

  const subBtnGroup = document.getElementById('plan-subscription-buttons-group');
  if (id && enableExternalSubSetting === 'true') {
    subBtnGroup.style.display = 'block';
    const origin = serverUrlSetting || window.location.origin;
    const m3uUrl = `${origin}/api/v1/subscription?subscription_plans=${encodeURIComponent(p.name)}&subscription_token=${p.subscription_token || ''}&subscription_format=m3u`;
    const txtUrl = `${origin}/api/v1/subscription?subscription_plans=${encodeURIComponent(p.name)}&subscription_token=${p.subscription_token || ''}&subscription_format=txt`;
    
    document.getElementById('btn-copy-m3u').onclick = () => copyText(m3uUrl);
    document.getElementById('btn-copy-txt').onclick = () => copyText(txtUrl);
  } else {
    subBtnGroup.style.display = 'none';
  }

  showModal('plan-modal');
}

// 添加分组到已选列表
function addPlanGroup(groupId) {
  const selectedContainer = document.getElementById('plan-groups-selected');
  const unselectedContainer = document.getElementById('plan-groups-container');
  
  // 从未选列表移除
  const unselectedTag = unselectedContainer.querySelector(`[data-id="${groupId}"]`);
  if (unselectedTag) {
    const gName = unselectedTag.getAttribute('data-name') || '';
    const source = unselectedTag.getAttribute('data-source') || '';
    const sourceTag = source ? ` <span style="font-size:11px;opacity:0.7">(${esc(source)})</span>` : '';
    
    // 添加到已选列表
    const tag = document.createElement('div');
    tag.className = 'plan-group-tag';
    tag.setAttribute('data-id', groupId);
    tag.setAttribute('data-name', gName);
    if (source) tag.setAttribute('data-source', source);
    tag.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:grab;background:var(--accent);color:#fff;padding:4px 10px;border-radius:4px;user-select:none;';
    tag.innerHTML = `<span style="cursor:pointer;font-size:14px;" onclick="removePlanGroup(${groupId})">✕</span> ${esc(gName)}${sourceTag}`;
    selectedContainer.appendChild(tag);
    
    unselectedTag.remove();
  }
}

// 从已选列表移除分组
function removePlanGroup(groupId) {
  const selectedContainer = document.getElementById('plan-groups-selected');
  const unselectedContainer = document.getElementById('plan-groups-container');
  
  // 从已选列表移除
  const selectedTag = selectedContainer.querySelector(`[data-id="${groupId}"]`);
  if (selectedTag) {
    const gName = selectedTag.getAttribute('data-name') || '';
    const source = selectedTag.getAttribute('data-source') || '';
    const sourceTag = source ? ` <span style="font-size:11px;opacity:0.7">(${esc(source)})</span>` : '';
    
    // 添加到未选列表
    const tag = document.createElement('div');
    tag.className = 'plan-group-tag-unselected';
    tag.setAttribute('data-id', groupId);
    tag.setAttribute('data-name', gName);
    if (source) tag.setAttribute('data-source', source);
    tag.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;background:var(--bg2);padding:4px 10px;border-radius:4px;';
    tag.innerHTML = `<span style="font-size:14px;">+</span> ${esc(gName)}${sourceTag}`;
    tag.onclick = () => addPlanGroup(groupId);
    unselectedContainer.appendChild(tag);
    
    selectedTag.remove();
  }
}

async function deletePlan(id) {
  if (!confirm('确定删除此套餐？')) return;
  await api(`/admin/plans/${id}`, { method: 'DELETE' });
  loadPlans();
}

async function showApproveModal(id) {
  document.getElementById('approve-client-id').value = id;
  const [plansRes, clientRes] = await Promise.all([
    api('/admin/plans'),
    api('/admin/clients/' + id)
  ]);
  const plans = plansRes.data || [];
  const client = clientRes.data || {};

  const select = document.getElementById('approve-plan-id');
  select.innerHTML = '<option value="0" data-desc="">-- 自定义授权 (不绑定套餐) --</option>' +
    plans.map(p => `<option value="${p.id}" data-days="${p.days}" data-streams="${p.max_streams}" data-desc="${esc(p.description || '')}">${esc(p.name)}</option>`).join('');

  select.value = client.plan_id || 0;
  onApprovePlanChange();

  if (client.plan_id === 0) {
    document.getElementById('approve-days').value = client.expires_at ? Math.max(0, Math.ceil((new Date(client.expires_at) - new Date()) / (1000 * 3600 * 24))) : 365;
    document.getElementById('approve-streams').value = client.max_streams || 2;
  }

  hideModal('client-detail-modal');
  showModal('approve-modal');
}

function onApprovePlanChange() {
  const select = document.getElementById('approve-plan-id');
  const opt = select.options[select.selectedIndex];
  const descEl = document.getElementById('approve-plan-desc');

  if (select.value === "0") {
    if (descEl) {
      descEl.innerHTML = '';
      descEl.style.display = 'none';
    }
  } else {
    document.getElementById('approve-days').value = opt.dataset.days;
    document.getElementById('approve-streams').value = opt.dataset.streams;
    if (descEl) {
      const days = parseInt(opt.dataset.days) || 0;
      const desc = opt.dataset.desc || '暂无套餐描述';
      const validityText = days > 0 ? days + ' 天' : '永久';
      descEl.innerHTML = `套餐有效期：<strong>${validityText}</strong><br>套餐描述：${desc}`;
      descEl.style.display = 'block';
    }
  }
}

function onDefaultPlanChange() {
  const select = document.getElementById('set-default-plan-id');
  const opt = select.options[select.selectedIndex];
  const fieldsRow = document.getElementById('auto-approve-fields-row');
  const descEl = document.getElementById('default-plan-desc');

  if (fieldsRow) fieldsRow.style.display = 'none';

  if (select.value === "0") {
    if (descEl) {
      descEl.innerHTML = '';
      descEl.style.display = 'none';
    }
  } else {
    if (descEl) {
      const days = parseInt(opt.dataset.days) || 0;
      const desc = opt.dataset.desc || '暂无套餐描述';
      const validityText = days > 0 ? days + ' 天' : '永久';
      descEl.innerHTML = `套餐有效期：<strong>${validityText}</strong><br>套餐描述：${desc}`;
      descEl.style.display = 'block';
    }
  }
}

async function doApprove() {
  const id = +document.getElementById('approve-client-id').value;
  const d = {
    plan_id: +document.getElementById('approve-plan-id').value,
    max_days: +document.getElementById('approve-days').value,
    max_streams: +document.getElementById('approve-streams').value
  };
  const r = await api(`/admin/clients/${id}/approve`, { method: 'POST', body: JSON.stringify(d) });
  hideModal('approve-modal');
  if (r.code === 0) { toast('已审批通过'); loadClients(); } else { toast(r.message, 'error'); }
}

function showRejectModal(id) {
  document.getElementById('reject-client-id').value = id;
  document.getElementById('reject-reason').value = '';
  hideModal('client-detail-modal');
  showModal('reject-modal');
}

async function doReject() {
  const id = +document.getElementById('reject-client-id').value;
  const reason = document.getElementById('reject-reason').value || '管理员拒绝';
  const r = await api(`/admin/clients/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
  hideModal('reject-modal');
  if (r.code === 0) { toast('已拒绝'); loadClients(); } else { toast(r.message, 'error'); }
}

async function banClient(id, reason) {
  if (!confirm('确定封禁此设备？')) return;
  await api(`/admin/clients/${id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) });
  hideModal('client-detail-modal');
  toast('已封禁');
  loadClients();
}

async function unbanClient(id) {
  await api(`/admin/clients/${id}/unban`, { method: 'POST' });
  toast('已解封');
  loadClients();
}

async function toggleTester(id, isTester) {
  try {
    await api(`/admin/clients/${id}/tester`, {
      method: 'POST',
      body: JSON.stringify({ is_tester: isTester })
    });
    toast(isTester ? '已设为测试机' : '已取消测试机');
  } catch (err) {
    console.error(err);
    loadClients(); // revert checkbox visually
  }
}

async function deleteClient(id) {
  if (!confirm('确定删除此设备？删除后无法恢复。')) return;
  await api(`/admin/clients/${id}`, { method: 'DELETE' });
  hideModal('client-detail-modal');
  toast('已删除');
  loadClients();
}

// ── Token management ──
async function showTokenModal(id) {
  const r = await api(`/admin/clients/${id}`);
  if (!r.data) return;
  const c = r.data;
  const tokenPreview = c.token_preview ? c.token_preview + '********' : '(无令牌)';

  document.getElementById('token-modal-content').innerHTML = `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">设备: <strong>${esc(c.name)}</strong> (#${c.id})</p>
    <div class="token-box" id="token-display">${tokenPreview}</div>
    <div class="btn-group" style="margin-top:16px">
      <button class="btn btn-primary btn-sm" onclick="regenerateToken(${c.id})">🔄 重新生成令牌</button>
      <button class="btn btn-danger btn-sm" onclick="revokeToken(${c.id})">🚫 吊销令牌</button>
    </div>
    <p style="color:var(--text2);font-size:11px;margin-top:12px">吊销后客户端需要重新注册，重新生成会替换旧令牌</p>
  `;
  hideModal('client-detail-modal');
  showModal('token-modal');
}

async function regenerateToken(id) {
  if (!confirm('重新生成令牌？旧令牌将立即失效。')) return;
  const r = await api(`/admin/clients/${id}/regenerate`, { method: 'POST' });
  if (r.data) {
    document.getElementById('token-display').innerHTML =
      `<strong style="color:var(--accent)">${r.data.token}</strong><br><span style="font-size:11px;color:var(--warn)">⚠️ 请立即复制保存，关闭后无法再次查看</span>`;
    toast('新令牌已生成');
  } else { toast('操作失败', 'error'); }
}

async function revokeToken(id) {
  if (!confirm('吊销令牌？客户端将无法连接。')) return;
  await api(`/admin/clients/${id}/revoke`, { method: 'POST' });
  toast('令牌已吊销');
  hideModal('token-modal');
  loadClients();
}

// ── Batch operations ──
async function doBatch() {
  if (selectedClientIds.size === 0) { toast('请先勾选设备', 'error'); return; }
  const action = document.getElementById('batch-action').value;
  if (!confirm(`确定对 ${selectedClientIds.size} 个设备执行 [${action}] 操作？`)) return;

  const r = await api('/admin/clients/batch', {
    method: 'POST',
    body: JSON.stringify({ ids: [...selectedClientIds], action })
  });
  hideModal('batch-modal');

  if (r.data) { toast(`已处理 ${r.data.affected} 个设备`); loadClients(); }
  else toast('操作失败', 'error');
}

// ═══ Client Logs ══════════════════════════════════════
let clientLogsList = [];
async function loadClientLogs() {
  const r = await api('/admin/clients/logs?limit=200');
  clientLogsList = r.data || [];
  renderClientLogsTable();
}

function renderClientLogsTable() {
  const total = clientLogsList.length;
  const totalPages = Math.max(1, Math.ceil(total / clientLogPageSize));
  if (clientLogPage > totalPages) clientLogPage = Math.max(1, totalPages);
  const start = (clientLogPage - 1) * clientLogPageSize;
  const pageData = clientLogsList.slice(start, start + clientLogPageSize);

  const body = document.getElementById('client-logs-body');
  if (pageData.length) {
    body.innerHTML = pageData.map((l, i) => {
      let actionBadge = '';
      if (l.action === 'play') actionBadge = '<span class="badge badge-success">播放</span>';
      else if (l.action === 'login') actionBadge = '<span class="badge badge-info">登录</span>';
      else if (l.action === 'heartbeat') actionBadge = '<span class="badge badge-warning" style="background:#eab308;color:#fff;">心跳</span>';
      else if (l.action === 'error') actionBadge = '<span class="badge badge-danger">错误</span>';
      else actionBadge = badge(l.action);

      return `<tr>
        <td style="color:var(--text3)">${(clientLogPage - 1) * clientLogPageSize + i + 1}</td>
        <td><strong>${esc(l.client_name)}</strong><br><span style="font-size:11px;color:var(--text2)">ID: #${l.client_id}</span></td>
        <td>${actionBadge}</td>
        <td><strong>${l.channel_name ? esc(l.channel_name) : '-'}</strong><br><span style="font-size:11px;color:var(--text2)">${l.channel_id ? 'ID: ' + l.channel_id : ''}</span></td>
        <td style="font-family:monospace;font-size:12px">${esc(l.ip)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(l.detail)}</td>
        <td>${fmtDate(l.created_at)}</td>
      </tr>`;
    }).join('');
  } else {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:40px">暂无日志</td></tr>';
  }
  renderPagination('client-logs-pagination', clientLogPage, totalPages, 'clientLogGoToPage', clientLogPageSize);
  document.getElementById('client-logs-info').textContent = `共 ${total} 条访问日志`;
}

function clientLogGoToPage(p) {
  const totalPages = Math.max(1, Math.ceil(clientLogsList.length / clientLogPageSize));
  if (p >= 1 && p <= totalPages) { clientLogPage = p; renderClientLogsTable(); }
}

// ═══ Client Settings & EPG ══════════════════════════════
async function loadClientSettings() {
  const [setRes, plansRes, updateRes] = await Promise.all([
    api('/settings'),
    api('/admin/plans'),
    api('/update').catch(() => ({ data: {} })) // ignore error if /update fails
  ]);

  const select = document.getElementById('set-default-plan-id');
  const plans = plansRes.data || [];
  select.innerHTML = '<option value="0" data-desc="">-- 自定义授权 (使用下方允许同时在线设备数量和有效期) --</option>' +
    plans.map(p => `<option value="${p.id}" data-days="${p.days}" data-streams="${p.max_streams}" data-desc="${esc(p.description || '')}">${esc(p.name)}</option>`).join('');

  if (setRes.data) {
    if (document.getElementById('set-enable-url-token')) {
      document.getElementById('set-enable-url-token').value = setRes.data.enable_url_token || 'false';
    }

    document.getElementById('set-auto-approve').value = setRes.data.auto_approve || 'false';
    toggleAutoApproveFields(setRes.data.auto_approve || 'false');
    document.getElementById('set-default-plan-id').value = setRes.data.default_plan_id || '0';
    document.getElementById('set-max-streams').value = setRes.data.default_max_streams || '2';
    document.getElementById('set-expire-days').value = setRes.data.default_expire_days || '365';
    onDefaultPlanChange();

    if (document.getElementById('set-system-announcement')) {
      document.getElementById('set-system-announcement').value = setRes.data.system_announcement || '';
      document.getElementById('set-system-announcement-interval').value = setRes.data.system_announcement_interval || '0';
    }

    if (document.getElementById('set-maintenance-mode')) {
      document.getElementById('set-maintenance-mode').checked = (setRes.data.maintenance_mode === 'true');
    }

    if (document.getElementById('set-startup-media-url')) {
      document.getElementById('set-startup-media-enabled').value = setRes.data.startup_media_enabled || 'false';
      document.getElementById('set-startup-media-url').value = setRes.data.startup_media_url || '';
      document.getElementById('set-startup-media-type').value = setRes.data.startup_media_type || 'image';
      document.getElementById('set-startup-duration').value = setRes.data.startup_duration || '5';
      document.getElementById('set-startup-skip-after').value = setRes.data.startup_skip_after || '0';
    }

    // EPG 配置
    if (document.getElementById('set-epg-source-url')) {
      document.getElementById('set-epg-source-url').value = setRes.data.epg_source_url || '';
      document.getElementById('set-epg-refresh-hours').value = setRes.data.epg_refresh_hours || '12';
      document.getElementById('set-epg-time-shift').value = setRes.data.epg_time_shift || '0';
    }
    
    if (document.getElementById('set-fcc-enabled')) {
      document.getElementById('set-fcc-enabled').value = setRes.data.fcc_enabled || 'false';
      document.getElementById('set-fcc-port-start').value = setRes.data.fcc_port_start || '40000';
      document.getElementById('set-fcc-port-end').value = setRes.data.fcc_port_end || '40050';
      document.getElementById('set-fcc-default-server').value = setRes.data.fcc_default_server || '';
      document.getElementById('set-fcc-type').value = setRes.data.fcc_type || 'telecom';
      if (document.getElementById('set-fcc-public-ip')) {
        document.getElementById('set-fcc-public-ip').value = setRes.data.fcc_public_ip || '';
      }
    }

    // 台标配置
    if (document.getElementById('set-logo-strategy')) {
      let strategy = setRes.data.logo_strategy;
      if (!strategy) {
        strategy = (setRes.data.enable_local_logo === 'true') ? 'local' : 'source';
      }
      document.getElementById('set-logo-strategy').value = strategy;
      document.getElementById('set-local-logo-urls').value = setRes.data.local_logo_urls || '';
    }

    // 服务器网络配置
    if (document.getElementById('set-server-name')) {
      document.getElementById('set-server-name').value = setRes.data.server_name || '';
    }
    if (document.getElementById('set-enable-external-sub')) {
      const isExternalSub = setRes.data.enable_external_sub || 'false';
      enableExternalSubSetting = isExternalSub;
      document.getElementById('set-enable-external-sub').value = isExternalSub;
    }
    if (document.getElementById('set-server-url')) {
      serverUrlSetting = setRes.data.server_url || '';
      document.getElementById('set-server-url').value = serverUrlSetting;
    }
    if (document.getElementById('set-server-backup-urls')) {
      serverBackupUrlsSetting = setRes.data.server_backup_urls || '';
      document.getElementById('set-server-backup-urls').value = serverBackupUrlsSetting;
    }

    // 本地文件路径开关
    if (document.getElementById('set-allow-local-file')) {
      document.getElementById('set-allow-local-file').value = setRes.data.allow_local_file || 'false';
    }
  }

  // Update 配置
  if (updateRes && updateRes.data) {
    if (document.getElementById('set-update-version-code')) {
      document.getElementById('set-update-version-code').value = updateRes.data.version_code || '';
      document.getElementById('set-update-version-name').value = updateRes.data.version_name || '';
      document.getElementById('set-update-download-url').value = updateRes.data.download_url || '';
      document.getElementById('set-update-log').value = updateRes.data.update_log || '';
      document.getElementById('set-update-force').value = updateRes.data.force_update ? 'true' : 'false';
    }
  }

  // 服务器地址 URL 转 Base64 逻辑 (支持多行备用地址)
  const serverRawUrl = serverUrlSetting || window.location.origin;
  
  let allUrls = [serverRawUrl];
  if (serverBackupUrlsSetting) {
    const backupLines = serverBackupUrlsSetting.split('\n').map(s => s.trim()).filter(s => s);
    allUrls = allUrls.concat(backupLines);
  }
  
  const serverBase64 = allUrls.map(url => btoa(unescape(encodeURIComponent(url)))).join('\n');

  const rawUrlEl = document.getElementById('server-raw-url');
  const base64TextEl = document.getElementById('server-base64-text');
  if (rawUrlEl) rawUrlEl.textContent = serverRawUrl;
  if (base64TextEl) base64TextEl.textContent = serverBase64;
}

async function saveAllClientSettings() {
  // 服务器名称验证：只允许中文、英文、数字、空格，最多20字符
  let serverName = '';
  if (document.getElementById('set-server-name')) {
    serverName = document.getElementById('set-server-name').value.trim();
    serverName = serverName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s]/g, '').substring(0, 20);
    document.getElementById('set-server-name').value = serverName;
  }

  const settings = {
    server_name: serverName,
    enable_external_sub: document.getElementById('set-enable-external-sub').value,
    server_url: document.getElementById('set-server-url').value.trim(),
    server_backup_urls: document.getElementById('set-server-backup-urls') ? document.getElementById('set-server-backup-urls').value.trim() : '',
    enable_url_token: document.getElementById('set-enable-url-token') ? document.getElementById('set-enable-url-token').value : 'false',
    auto_approve: document.getElementById('set-auto-approve').value,
    default_plan_id: document.getElementById('set-default-plan-id').value,
    default_max_streams: document.getElementById('set-max-streams').value,
    default_expire_days: document.getElementById('set-expire-days').value,
  };

  if (document.getElementById('set-system-announcement')) {
    settings.system_announcement = document.getElementById('set-system-announcement').value.trim();
    settings.system_announcement_interval = document.getElementById('set-system-announcement-interval').value;
  }

  if (document.getElementById('set-maintenance-mode')) {
    settings.maintenance_mode = document.getElementById('set-maintenance-mode').checked ? 'true' : 'false';
  }

  if (document.getElementById('set-startup-media-url')) {
    settings.startup_media_enabled = document.getElementById('set-startup-media-enabled').value;
    settings.startup_media_url = document.getElementById('set-startup-media-url').value.trim();
    settings.startup_media_type = document.getElementById('set-startup-media-type').value;
    settings.startup_duration = document.getElementById('set-startup-duration').value;
    settings.startup_skip_after = document.getElementById('set-startup-skip-after').value;
  }

  if (document.getElementById('set-epg-source-url')) {
    settings.epg_source_url = document.getElementById('set-epg-source-url').value.trim();
    settings.epg_refresh_hours = document.getElementById('set-epg-refresh-hours').value;
    settings.epg_time_shift = document.getElementById('set-epg-time-shift').value || '0';
  }

  if (document.getElementById('set-fcc-enabled')) {
    settings.fcc_enabled = document.getElementById('set-fcc-enabled').value;
    settings.fcc_port_start = document.getElementById('set-fcc-port-start').value;
    settings.fcc_port_end = document.getElementById('set-fcc-port-end').value;
    settings.fcc_default_server = document.getElementById('set-fcc-default-server').value.trim();
    settings.fcc_type = document.getElementById('set-fcc-type').value;
    if (document.getElementById('set-fcc-public-ip')) {
      settings.fcc_public_ip = document.getElementById('set-fcc-public-ip').value.trim();
    }
  }

  if (document.getElementById('set-logo-strategy')) {
    settings.logo_strategy = document.getElementById('set-logo-strategy').value;
    settings.local_logo_urls = document.getElementById('set-local-logo-urls').value.trim();
  }

  // 本地文件路径开关
  if (document.getElementById('set-allow-local-file')) {
    settings.allow_local_file = document.getElementById('set-allow-local-file').value;
  }

  for (const [k, v] of Object.entries(settings)) {
    await api('/settings', { method: 'POST', body: JSON.stringify({ key: k, value: String(v) }) });
  }

  enableExternalSubSetting = settings.enable_external_sub;
  serverUrlSetting = settings.server_url;

  // 更新前端服务器地址与 Base64 授权码预览 (支持多行备用地址)
  serverBackupUrlsSetting = settings.server_backup_urls || '';
  const serverRawUrl = serverUrlSetting || window.location.origin;
  
  let allUrls = [serverRawUrl];
  if (serverBackupUrlsSetting) {
    const backupLines = serverBackupUrlsSetting.split('\n').map(s => s.trim()).filter(s => s);
    allUrls = allUrls.concat(backupLines);
  }
  
  const serverBase64 = allUrls.map(url => btoa(unescape(encodeURIComponent(url)))).join('\n');
  const rawUrlEl = document.getElementById('server-raw-url');
  const base64TextEl = document.getElementById('server-base64-text');
  if (rawUrlEl) rawUrlEl.textContent = serverRawUrl;
  if (base64TextEl) base64TextEl.textContent = serverBase64;

  // 同时保存升级配置
  await saveAppUpdateSettings(true); // 传参 true 以便不重复弹 toast，或者就让它弹

  toast('所有全局设置和 EPG 配置已保存');
}

async function saveAppUpdateSettings(silent = false) {
  const updateConf = {
    version_code: parseInt(document.getElementById('set-update-version-code').value) || 0,
    version_name: document.getElementById('set-update-version-name').value.trim(),
    download_url: document.getElementById('set-update-download-url').value.trim(),
    update_log: document.getElementById('set-update-log').value.trim(),
    force_update: document.getElementById('set-update-force').value === 'true'
  };

  try {
    await api('/admin/settings/update', {
      method: 'POST',
      body: JSON.stringify(updateConf)
    });
    if (!silent) toast('升级配置已独立保存', 'success');
  } catch (e) {
    if (!silent) toast('保存升级配置失败: ' + e.message, 'error');
  }
}

async function refreshEPGCache() {
  try {
    const res = await api('/admin/epg/refresh', { method: 'POST' });
    if (res.code === 0) {
      toast(res.data.message || '强制刷新已触发');
    }
  } catch (e) {
    toast('触发失败: ' + e.message, true);
  }
}

async function triggerCacheExistingLogos() {
  try {
    const res = await api('/admin/logo/cache', { method: 'POST' });
    if (res.code === 0) {
      toast(res.data.message || '缓存外链台标任务已触发，请查看后台日志。');
    }
  } catch (e) {
    toast('触发失败: ' + e.message, 'error');
  }
}

async function triggerBatchFetchLogos(overwrite) {
  if (overwrite && !confirm("全量覆盖拉取将覆盖本地已有的所有台标并重新下载，可能非常耗时，确定吗？")) {
    return;
  }
  try {
    const res = await api('/admin/logo/fetch', {
      method: 'POST',
      body: JSON.stringify({ overwrite: overwrite })
    });
    if (res.code === 0) {
      toast(res.data.message || '批量拉取缺失台标任务已触发，请查看后台日志。');
    }
  } catch (e) {
    toast('触发失败: ' + e.message, 'error');
  }
}
// saveClientSetting 已在文件顶部以 debounce 方式重新定义

// toggleAutoApproveFields: 纯 UI 函数，仅控制子选项区域显隐，加载页面时安全调用
function toggleAutoApproveFields(value) {
  const container = document.getElementById('auto-approve-settings');
  if (container) {
    container.style.display = value === 'true' ? 'block' : 'none';
  }
}

// onAutoApproveChange: 用户主动切换时调用，负责保存并给出反馈
function onAutoApproveChange(value) {
  toggleAutoApproveFields(value);
  saveClientSetting('auto_approve', value).then(() => toast('自动审批已' + (value === 'true' ? '开启' : '关闭')));
}

async function onEnableExternalSubChange(value) {
  await saveClientSetting('enable_external_sub', value);
  enableExternalSubSetting = value;
  toast('外部订阅已' + (value === 'true' ? '开启，套餐页面将显示订阅地址' : '关闭'));
  if (typeof renderPlansTable === 'function') renderPlansTable();
}

async function onLogoStrategyChange(value) {
  await saveClientSetting('logo_strategy', value);
  const strategies = {
    'local': '本地优先',
    'source': '源优先',
    'interface': '接口优先'
  };
  toast('台标获取策略已切换为: ' + (strategies[value] || value));
}

// ════ Pagination Helper ═════════════════════════════════════════════
function renderPagination(containerId, currentPage, totalPages, changePageFuncName, currentPageSize = 20) {
  let html = '';
  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  html += `<button class="btn btn-ghost btn-sm" onclick="${changePageFuncName}(${currentPage - 1})" ${prevDisabled}>上一页</button>`;

  const maxPages = 5;
  let start = Math.max(1, currentPage - Math.floor(maxPages / 2));
  let end = Math.min(totalPages, start + maxPages - 1);
  if (end - start + 1 < maxPages) {
    start = Math.max(1, end - maxPages + 1);
  }

  if (start > 1) {
    html += `<button class="btn btn-ghost btn-sm" onclick="${changePageFuncName}(1)">1</button>`;
    if (start > 2) {
      html += `<span style="padding:0 8px;line-height:32px;color:var(--text3)">...</span>`;
    }
  }

  for (let i = start; i <= end; i++) {
    if (i === currentPage) {
      html += `<button class="btn btn-primary btn-sm">${i}</button>`;
    } else {
      html += `<button class="btn btn-ghost btn-sm" onclick="${changePageFuncName}(${i})">${i}</button>`;
    }
  }

  if (end < totalPages) {
    if (end < totalPages - 1) {
      html += `<span style="padding:0 8px;line-height:32px;color:var(--text3)">...</span>`;
    }
    html += `<button class="btn btn-ghost btn-sm" onclick="${changePageFuncName}(${totalPages})">${totalPages}</button>`;
  }

  const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
  html += `<button class="btn btn-ghost btn-sm" onclick="${changePageFuncName}(${currentPage + 1})" ${nextDisabled}>下一页</button>`;

  // 每页显示条数选择
  html += `<select class="btn btn-ghost btn-sm" style="padding:4px 8px;margin-left:8px;" onchange="changePageSize(this.value, '${changePageFuncName}')">`;
  [20, 50, 100, 200, 300, 400, 500, 1000].forEach(size => {
    html += `<option value="${size}" ${currentPageSize === size ? 'selected' : ''}>${size} 条/页</option>`;
  });
  html += `</select>`;

  document.getElementById(containerId).innerHTML = `<div class="btn-group">${html}</div>`;
}

function changePageSize(newSize, changePageFuncName) {
  const size = parseInt(newSize);
  // 根据 changePageFuncName 确定对应的页面变量并重置为第一页
  if (changePageFuncName === 'channelGoToPage') {
    channelPageSize = size;
    channelPage = 1;
    loadChannels();
  } else if (changePageFuncName === 'groupGoToPage') {
    groupPageSize = size;
    groupPage = 1;
    loadGroups();
  } else if (changePageFuncName === 'sourceGoToPage') {
    sourcePageSize = size;
    sourcePage = 1;
    loadSources();
  } else if (changePageFuncName === 'clientGoToPage') {
    clientPageSize = size;
    clientPage = 1;
    loadClients();
  } else if (changePageFuncName === 'streamGoToPage') {
    streamPageSize = size;
    streamPage = 1;
    loadStreams();
  } else if (changePageFuncName === 'planGoToPage') {
    planPageSize = size;
    planPage = 1;
    loadPlans();
  } else if (changePageFuncName === 'clientLogGoToPage') {
    clientLogPageSize = size;
    clientLogPage = 1;
    loadClientLogs();
  }
}

function copyServerBase64() {
  const base64Text = document.getElementById('server-base64-text').textContent.trim();
  if (!base64Text || base64Text === '-') {
    toast('无有效的 Base64 地址', 'error');
    return;
  }

  const handleFallback = () => {
    const textarea = document.createElement('textarea');
    textarea.value = base64Text;
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      toast('复制成功');
    } catch (e) {
      toast('复制失败，请手动选择复制', 'error');
    }
    document.body.removeChild(textarea);
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(base64Text).then(() => {
      toast('复制成功');
    }).catch(err => {
      handleFallback();
    });
  } else {
    handleFallback();
  }
}

function toggleTokenVisibility(iconSvg) {
  const codeEl = document.getElementById('detail-token-display');
  if (!codeEl) return;
  const isFull = codeEl.getAttribute('data-showing-full') === 'true';
  if (isFull) {
    codeEl.textContent = codeEl.getAttribute('data-preview');
    codeEl.setAttribute('data-showing-full', 'false');
    iconSvg.style.color = 'var(--text2)';
    iconSvg.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  } else {
    codeEl.textContent = codeEl.getAttribute('data-full');
    codeEl.setAttribute('data-showing-full', 'true');
    iconSvg.style.color = 'var(--primary)';
    iconSvg.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  }
}
// ════ Init ═════════════════════════════════════════════
if (!window.location.pathname.includes('/login.html') && adminToken) {
  (async () => {
    try {
      const setRes = await api('/settings');
    } catch (e) { }
    try {
      const verRes = await api('/version');
      if (verRes && verRes.data && verRes.data.version) {
        document.getElementById('sidebar-version').textContent = verRes.data.version;
      }
    } catch (e) { }
    const lastSection = localStorage.getItem('last_active_section') || 'dashboard';
    showSection(lastSection);
  })();
}
function copyText(text) {
  if (!text) {
    toast('无有效内容', 'error');
    return;
  }
  const handleFallback = () => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      toast('复制成功');
    } catch (e) {
      toast('复制失败，请手动复制', 'error');
    }
    document.body.removeChild(textarea);
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(() => {
      toast('复制成功');
    }).catch(err => {
      handleFallback();
    });
  } else {
    handleFallback();
  }
}

function regeneratePlanTokenInput() {
  const chars = '0123456789abcdef';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * 16)];
  }
  document.getElementById('plan-token').value = token;
}

// ════ System Update Module ════════════════════════════════════
let githubReleasesCache = null;

async function loadUpdates() {
  const currentVersionEl = document.getElementById('sidebar-version');
  if (currentVersionEl) {
    document.getElementById('update-current-version').textContent = currentVersionEl.textContent;
  }
  
  if (githubReleasesCache) {
    renderUpdateReleases(githubReleasesCache);
    return;
  }

  document.getElementById('update-loading').style.display = 'block';
  document.getElementById('update-content').style.display = 'none';
  document.getElementById('update-error').style.display = 'none';

  try {
    const savedProxy = localStorage.getItem('ghProxy') || '';
    const apiUrl = savedProxy + 'https://api.github.com/repos/kuai410022283/mediaplayer/releases';
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error('Network response was not ok');
    githubReleasesCache = await res.json();
    document.getElementById('update-loading').style.display = 'none';
    renderUpdateReleases(githubReleasesCache);
  } catch (e) {
    document.getElementById('update-loading').style.display = 'none';
    document.getElementById('update-error').style.display = 'block';
  }
}

function renderUpdateReleases(releases) {
  if (!releases || releases.length === 0) return;
  document.getElementById('update-content').style.display = 'block';
  
  const latestRelease = releases[0];
  document.getElementById('update-latest-notice').textContent = '最新版本：' + latestRelease.tag_name;

  const tagSelect = document.getElementById('update-tag-select');
  tagSelect.innerHTML = releases.map((r, i) => `<option value="${i}">${r.tag_name}${i === 0 ? ' (最新)' : ''}</option>`).join('');
  
  const savedProxy = localStorage.getItem('ghProxy');
  if (savedProxy) {
    const proxySelect = document.getElementById('update-proxy-select');
    if (proxySelect) {
      proxySelect.value = savedProxy;
    }
  }

  onUpdateTagChange();
}

function onUpdateTagChange() {
  const tagSelect = document.getElementById('update-tag-select');
  const releaseIndex = parseInt(tagSelect.value);
  const release = githubReleasesCache[releaseIndex];
  if (!release) return;

  const assetSelect = document.getElementById('update-asset-select');
  if (release.assets && release.assets.length > 0) {
    assetSelect.innerHTML = release.assets.map((a, i) => `<option value="${i}">${formatAssetName(a.name)}</option>`).join('');
    assetSelect.disabled = false;
  } else {
    assetSelect.innerHTML = '<option value="">该版本没有可下载的文件</option>';
    assetSelect.disabled = true;
  }
  onUpdateAssetChange();
}

function formatAssetName(name) {
  if (name.includes('.apk')) return `Android 客户端 (APK) [${name}]`;
  if (name.includes('windows')) return `Windows 服务端 [${name}]`;
  if (name.includes('linux-amd64')) return `Linux amd64 服务端 [${name}]`;
  if (name.includes('linux-arm64')) return `Linux arm64 服务端 [${name}]`;
  if (name.includes('darwin')) return `macOS 服务端 [${name}]`;
  return name;
}

function onUpdateAssetChange() {
  const tagSelect = document.getElementById('update-tag-select');
  const assetSelect = document.getElementById('update-asset-select');
  const btn = document.getElementById('btn-update-download');
  const btnPull = document.getElementById('btn-update-pull');
  
  const releaseIndex = parseInt(tagSelect.value);
  const assetIndex = parseInt(assetSelect.value);
  
  if (isNaN(releaseIndex) || isNaN(assetIndex) || !githubReleasesCache[releaseIndex] || !githubReleasesCache[releaseIndex].assets[assetIndex]) {
    btn.style.display = 'none';
    if(btnPull) btnPull.style.display = 'none';
    return;
  }
  
  const asset = githubReleasesCache[releaseIndex].assets[assetIndex];
  
  const proxySelect = document.getElementById('update-proxy-select');
  let proxyUrl = proxySelect ? proxySelect.value : "";
  if (proxyUrl) {
    localStorage.setItem('ghProxy', proxyUrl);
  } else {
    localStorage.removeItem('ghProxy');
  }
  
  btn.dataset.href = proxyUrl + asset.browser_download_url;
  btn.style.display = 'inline-flex';
  
  if (btnPull) {
    if (asset.name.includes('.apk')) {
      btnPull.style.display = 'inline-flex';
    } else {
      btnPull.style.display = 'none';
    }
  }
}

async function pullUpdateToServer(btn) {
  const tagSelect = document.getElementById('update-tag-select');
  const assetSelect = document.getElementById('update-asset-select');
  
  const releaseIndex = parseInt(tagSelect.value);
  const assetIndex = parseInt(assetSelect.value);
  
  if (isNaN(releaseIndex) || isNaN(assetIndex)) return;
  const release = githubReleasesCache[releaseIndex];
  const asset = release.assets[assetIndex];
  
  if (!confirm(`确定要将版本 ${release.tag_name} (${asset.name}) 拉取至服务端并提供更新吗？这需要服务端具备网络访问条件，下载可能需要几十秒。`)) {
    return;
  }

  const originalText = btn.textContent;
  btn.textContent = '准备下载...';
  btn.disabled = true;
  
  const btnCancel = document.getElementById('btn-update-cancel');
  if (btnCancel) {
    btnCancel.style.display = 'inline-flex';
    btnCancel.disabled = false;
    btnCancel.textContent = '停止下载';
  }

  const proxySelect = document.getElementById('update-proxy-select');
  const proxyUrl = proxySelect ? proxySelect.value : "";
  const finalDownloadUrl = proxyUrl + asset.browser_download_url;

  try {
    const res = await fetch(API + '/admin/settings/pull-update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        version_name: release.tag_name,
        download_url: finalDownloadUrl,
        update_log: release.body || ''
      })
    });
    
    const data = await res.json();
    if (!res.ok || data.code !== 0) {
      alert('操作失败: ' + (data.message || '未知错误'));
      btn.textContent = originalText;
      btn.disabled = false;
      if (btnCancel) btnCancel.style.display = 'none';
      return;
    }

    let pollInterval = setInterval(async () => {
      try {
        const pRes = await fetch(API + '/admin/settings/pull-update/progress', {
          headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const pData = await pRes.json();
        if (pData && pData.code === 0 && pData.data) {
          const state = pData.data;
          if (state.status === "downloading") {
             btn.textContent = `正在下载 (${state.progress}%)`;
          } else if (state.status === "success") {
             clearInterval(pollInterval);
             btn.textContent = originalText;
             btn.disabled = false;
             if (btnCancel) btnCancel.style.display = 'none';
             alert('下载并发布成功！');
          } else if (state.status === "error") {
             clearInterval(pollInterval);
             btn.textContent = originalText;
             btn.disabled = false;
             if (btnCancel) btnCancel.style.display = 'none';
             alert('下载失败: ' + state.message);
          }
        }
      } catch(e) {}
    }, 1000);

  } catch (e) {
    alert('请求错误: ' + e.message);
    btn.textContent = originalText;
    btn.disabled = false;
    if (btnCancel) btnCancel.style.display = 'none';
  }
}

async function cancelPullUpdateToServer() {
  const btnCancel = document.getElementById('btn-update-cancel');
  if (btnCancel) {
    btnCancel.disabled = true;
    btnCancel.textContent = '正在取消...';
  }
  try {
    const res = await fetch(API + '/admin/settings/pull-update/cancel', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok || data.code !== 0) {
      alert('取消失败: ' + (data.message || '未知错误'));
      if (btnCancel) {
        btnCancel.disabled = false;
        btnCancel.textContent = '停止下载';
      }
    }
  } catch (e) {
    alert('请求错误: ' + e.message);
    if (btnCancel) {
      btnCancel.disabled = false;
      btnCancel.textContent = '停止下载';
    }
  }
}

// ═══ Sync (主备同步) ════════════════════════════════════

function onSyncEnableChange(val) {
  document.getElementById('sync-standby-settings').style.display = val === 'true' ? 'block' : 'none';
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function loadSyncSettings() {
  const res = await api('/settings').catch(() => ({ data: {} }));
  const data = res.data || {};
  
  if (data.sync_serve_token !== undefined) document.getElementById('set-sync-serve-token').value = data.sync_serve_token;
  if (data.sync_enable !== undefined) {
    document.getElementById('set-sync-enable').value = data.sync_enable;
    onSyncEnableChange(data.sync_enable);
  }
  if (data.sync_master_url !== undefined) document.getElementById('set-sync-master-url').value = data.sync_master_url;
  if (data.sync_master_token !== undefined) document.getElementById('set-sync-master-token').value = data.sync_master_token;
  if (data.sync_interval_min !== undefined) document.getElementById('set-sync-interval').value = data.sync_interval_min;

  if (data.sync_enable === 'true') {
    checkMasterConnection();
    if (!masterStatusInterval) {
      masterStatusInterval = setInterval(checkMasterConnection, 10000); // 10 seconds
    }
  } else {
    document.getElementById('master-status-badge').style.display = 'none';
  }
}

async function checkMasterConnection() {
  const badge = document.getElementById('master-status-badge');
  const url = document.getElementById('set-sync-master-url').value.trim();
  
  if (!url) {
    badge.style.display = 'inline-block';
    badge.style.background = 'var(--bg3)';
    badge.style.color = 'var(--text2)';
    badge.innerText = '未配置地址';
    return;
  }

  badge.style.display = 'inline-block';
  badge.style.background = 'var(--bg3)';
  badge.style.color = 'var(--text2)';
  badge.innerText = '检测中...';

  try {
    const res = await fetch('/api/v1/admin/system/ping-master', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + adminToken
      },
      body: JSON.stringify({ master_url: url })
    });
    
    if (res.ok) {
      badge.style.background = 'rgba(22, 186, 170, 0.15)';
      badge.style.color = '#16baaa';
      badge.innerText = '状态正常 (Ping 200)';
    } else {
      throw new Error('Non-200 response');
    }
  } catch (e) {
    badge.style.background = 'rgba(230, 83, 107, 0.15)';
    badge.style.color = '#e6536b';
    badge.innerText = '连接失败';
  }
}

async function saveSyncSettings() {
  try {
    const settings = {
      sync_serve_token: document.getElementById('set-sync-serve-token').value.trim(),
      sync_enable: document.getElementById('set-sync-enable').value,
      sync_master_url: document.getElementById('set-sync-master-url').value.trim(),
      sync_master_token: document.getElementById('set-sync-master-token').value.trim(),
      sync_interval_min: document.getElementById('set-sync-interval').value
    };

    if (settings.sync_enable === 'true') {
      if (!settings.sync_master_url) {
        toast('保存失败：必须填写主节点通信地址', 'error');
        return;
      }
      // 提前校验主节点是否联通
      try {
        await api('/admin/system/ping-master', { 
          method: 'POST', 
          body: JSON.stringify({ master_url: settings.sync_master_url }) 
        });
      } catch (e) {
        toast('主节点连接失败，请检查地址是否正确或网络是否畅通', 'error');
        return;
      }
    }

    for (const [k, v] of Object.entries(settings)) {
      await api('/settings', { method: 'POST', body: JSON.stringify({ key: k, value: String(v) }) });
    }

    if (settings.sync_enable === 'true') {
      toast('配置已保存，正在执行初次同步...', 'success');
      try {
        const res = await api('/admin/system/sync_from_master', {
          method: 'POST',
          body: JSON.stringify({ master_url: settings.sync_master_url, master_token: settings.sync_master_token })
        });
        toast(res.message || '初次同步成功，正在刷新页面...', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        // API 函数会处理错误提示
      }
    } else {
      toast('同步配置已保存', 'success');
    }
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
    console.error(e);
  }
}

async function forceSyncFromMaster() {
  const url = document.getElementById('set-sync-master-url').value;
  const token = document.getElementById('set-sync-master-token').value;
  
  if (!url) { toast('请填写主节点通信地址', 'error'); return; }
  
  if (!confirm('确定要强制从主节点拉取数据覆盖当前节点的频道/分组数据吗？')) return;
  
  toast('正在同步，请勿刷新页面...');
  try {
    const res = await api('/admin/system/sync_from_master', {
      method: 'POST',
      body: JSON.stringify({ master_url: url, master_token: token })
    });
    toast(res.message || '同步成功，正在刷新页面...', 'success');
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    // api func handles error toast
  }
}

