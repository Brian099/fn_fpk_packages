const API_BASE = (function () {
  try {
    let basePath = window.location.pathname || '/';
    if (!basePath.endsWith('/')) {
      const last = basePath.lastIndexOf('/');
      basePath = last >= 0 ? basePath.slice(0, last + 1) : '/';
    }
    return basePath;
  } catch (e) {
    return '/';
  }
})();

const CRON_FIELDS = ["minute", "hour", "day", "month", "weekday"];
const cronSelects = {};
const cronCustomInputs = {};

CRON_FIELDS.forEach((field) => {
  cronSelects[field] = document.querySelector(`[data-cron-field="${field}"]`);
  cronCustomInputs[field] = document.querySelector(`[data-cron-custom="${field}"]`);
});

const state = {
  tasks: [],
  selectedIds: new Set(),
  editingTaskId: null,
  currentResultTaskId: null,
  resultLogCache: new Map(),
  accounts: [],
  accountLoading: false,
  posixSupported: true,
  defaultAccount: "",
  serviceCanSwitchAccount: true,
};

function _t(key, vars) {
  try {
    const fn = window.__i18n && window.__i18n.translate;
    let msg = typeof fn === 'function' ? fn(key) : key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(k => {
        msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
      });
    }
    return msg;
  } catch (e) { return key; }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function showToast(message, isError = false) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show' + (isError ? ' error' : ' success');
  setTimeout(() => { toast.className = 'toast'; }, 3000);
}

async function apiFetch(url, options = {}) {
  try {
    const response = await fetch(API_BASE + url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  } catch (err) {
    showToast(err.message, true);
    throw err;
  }
}

async function loadAccounts({ showError = true, preferredAccount = "" } = {}) {
  const select = document.getElementById('accountSelect');
  if (!select) {
    return;
  }
  const previousValue = preferredAccount || select.value || "";
  state.accountLoading = true;
  renderAccountOptions(previousValue);
  try {
    const response = await apiFetch('api/accounts');
    state.accounts = response.data || [];
    if (response.meta) {
      if (Object.prototype.hasOwnProperty.call(response.meta, "posix_supported")) {
        state.posixSupported = Boolean(response.meta.posix_supported);
      }
      if (Object.prototype.hasOwnProperty.call(response.meta, "default_account")) {
        state.defaultAccount = response.meta.default_account || "";
      }
      if (Object.prototype.hasOwnProperty.call(response.meta, "service_can_switch_account")) {
        state.serviceCanSwitchAccount = Boolean(response.meta.service_can_switch_account);
      }
    }
    if (!state.posixSupported && !state.accounts.length && state.defaultAccount) {
      state.accounts = [state.defaultAccount];
    }
  } catch (exc) {
    console.warn("Failed to load accounts:", exc);
    if (showError) {
      showToast(_t('error.load_accounts', { err: exc.message || String(exc) }), true);
    }
  } finally {
    state.accountLoading = false;
    renderAccountOptions(preferredAccount || previousValue);
  }
}

function renderAccountOptions(selectedAccount = "") {
  const select = document.getElementById('accountSelect');
  const statusEl = document.getElementById('accountStatus');
  const btnReload = document.getElementById('btnReloadAccounts');
  const accountSection = document.getElementById('accountSection');
  if (!select) { return; }

  select.innerHTML = "";
  const isReadOnly = !state.posixSupported || !state.serviceCanSwitchAccount;
  
  if (accountSection) {
    accountSection.classList.toggle("hidden", !state.serviceCanSwitchAccount);
  }
  
  if (btnReload) {
    btnReload.disabled = state.accountLoading;
    btnReload.classList.toggle("hidden", isReadOnly);
  }

  if (!state.serviceCanSwitchAccount) {
    if (statusEl) {
      statusEl.textContent = _t('field.account_no_root');
    }
    return;
  }

  if (state.accountLoading) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = _t('loading');
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
    select.disabled = true;
    if (statusEl) {
      statusEl.textContent = _t('loading_accounts');
    }
    return;
  }

  if (!state.accounts.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = state.posixSupported ? _t('no_accounts') : _t('not_available');
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
    select.disabled = true;
    if (statusEl) {
      statusEl.textContent = state.posixSupported
        ? _t('account.not_found_posix')
        : _t('account.windows_not_detected');
    }
    return;
  }

  if (isReadOnly) {
    const defaultAccount = state.accounts[0] || state.defaultAccount || "";
    const option = document.createElement("option");
    option.value = defaultAccount;
    option.textContent = defaultAccount || _t('label.current_logged_in_account');
    option.selected = true;
    select.appendChild(option);
    select.disabled = true;
    if (statusEl) {
      statusEl.textContent = "";
    }
    return;
  }

  select.disabled = false;
  let hasSelected = false;
  const legacyAccount =
    selectedAccount && !state.accounts.includes(selectedAccount)
      ? selectedAccount
      : "";
  if (legacyAccount) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = `${legacyAccount} (needs reselect)`;
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
  }

  state.accounts.forEach((account) => {
    const option = document.createElement("option");
    option.value = account;
    option.textContent = account;
    if (!hasSelected && account === selectedAccount) {
      option.selected = true;
      hasSelected = true;
    }
    select.appendChild(option);
  });

  if (!hasSelected && !legacyAccount && state.accounts.length) {
    select.value = state.accounts[0];
  }

  if (statusEl) {
    statusEl.textContent = "";
  }
}

async function loadTasks() {
  try {
    const data = await apiFetch('api/tasks');
    state.tasks = data.data || [];
    renderTaskTable();
  } catch (err) {
    console.error('[loadTasks] Error:', err);
    showToast(_t('error.load_tasks'), true);
  }
}

function renderTaskTable() {
  const tbody = document.querySelector('#taskTable tbody');
  const emptyState = document.getElementById('emptyState');
  const accountHeader = document.getElementById('accountTableHeader');

  if (!tbody) return;

  if (accountHeader) {
    accountHeader.classList.toggle('hidden', !state.serviceCanSwitchAccount);
  }

  if (!state.tasks.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  tbody.innerHTML = state.tasks.map(task => {
    const enabled = task.enabled !== false;
    let triggerText = '-';
    try {
      triggerText = getTriggerText(task.trigger_type, task.trigger_config);
    } catch (e) {
      triggerText = task.trigger_type || '-';
    }
    const nextRun = task.next_run_time ? formatDateTime(task.next_run_time) : '-';
    const statusClass = enabled ? 'enabled' : 'disabled';
    const statusText = enabled ? '✓' : '✗';

    const accountCell = state.serviceCanSwitchAccount 
      ? `<td>${escapeHtml(task.account || '-')}</td>` 
      : '';

    return `
      <tr data-id="${task.id}" class="${state.selectedIds.has(String(task.id)) ? 'selected' : ''}">
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${escapeHtml(task.name)}</td>
        <td>${escapeHtml(nextRun)}</td>
        <td><span class="trigger-badge">${escapeHtml(triggerText)}</span></td>
        <td>${escapeHtml(task.task_type === 'python' ? _t('task_type.python') : _t('task_type.shell'))}</td>
        ${accountCell}
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', (e) => {
      const id = row.dataset.id;
      if (e.ctrlKey || e.metaKey) {
        if (state.selectedIds.has(id)) {
          state.selectedIds.delete(id);
          row.classList.remove('selected');
        } else {
          state.selectedIds.add(id);
          row.classList.add('selected');
        }
      } else {
        state.selectedIds.clear();
        tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
        state.selectedIds.add(id);
        row.classList.add('selected');
      }
      updateToolbarButtons();
    });

    row.addEventListener('dblclick', () => {
      const id = row.dataset.id;
      openEditModal(parseInt(id));
    });
  });

  updateToolbarButtons();
}

function getTriggerText(triggerType, config) {
  switch (triggerType) {
    case 'cron':
      if (config && typeof config === 'object') {
        const minute = config.minute !== undefined ? String(config.minute) : '*';
        const hour = config.hour !== undefined ? String(config.hour) : '*';
        const day = config.day !== undefined ? String(config.day) : '*';
        const month = config.month !== undefined ? String(config.month) : '*';
        const day_of_week = config.day_of_week !== undefined ? String(config.day_of_week) : '*';
        return `${minute} ${hour} ${day} ${month} ${day_of_week}`;
      }
      return _t('trigger.schedule');
    case 'interval':
      if (config && config.seconds !== undefined) {
        const s = parseInt(config.seconds, 10) || 60;
        if (s >= 86400) return `${Math.floor(s / 86400)}d`;
        if (s >= 3600) return `${Math.floor(s / 3600)}h`;
        if (s >= 60) return `${Math.floor(s / 60)}m`;
        return `${s}s`;
      }
      return _t('trigger.interval');
    case 'date':
      if (config && config.run_date) {
        return formatDateTime(config.run_date);
      }
      return _t('trigger.date');
    case 'boot':
      return _t('trigger.boot');
    case 'shutdown':
      return _t('trigger.shutdown');
    default:
      return triggerType || '-';
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString();
  } catch {
    return isoString;
  }
}

function formatDateTimeLocalInput(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function updateToolbarButtons() {
  const selectedCount = state.selectedIds.size;
  const btnEdit = document.getElementById('btnEdit');
  const btnDelete = document.getElementById('btnDelete');
  const btnRun = document.getElementById('btnRun');
  const btnStop = document.getElementById('btnStop');
  const btnToggle = document.getElementById('btnToggle');
  const btnResults = document.getElementById('btnResults');
  
  if (btnEdit) btnEdit.disabled = selectedCount !== 1;
  if (btnDelete) btnDelete.disabled = selectedCount === 0;
  if (btnRun) btnRun.disabled = selectedCount === 0;
  if (btnStop) btnStop.disabled = selectedCount === 0;
  if (btnToggle) btnToggle.disabled = selectedCount === 0;
  if (btnResults) btnResults.disabled = selectedCount !== 1;
}

function openCreateModal() {
  state.editingTaskId = null;
  document.getElementById('taskModalTitle').textContent = _t('modal.task.new');
  document.getElementById('taskForm').reset();
  document.getElementById('task_id').value = '';
  showTriggerFields('cron');
  
  const preferredAccount = "";
  renderAccountOptions(preferredAccount);
  if (!state.accountLoading && !state.accounts.length) {
    loadAccounts({ showError: false, preferredAccount });
  }
  
  document.getElementById('taskModal').classList.remove('hidden');
}

async function openEditModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.editingTaskId = taskId;
  document.getElementById('taskModalTitle').textContent = _t('modal.task.edit');
  document.getElementById('task_id').value = task.id;
  document.getElementById('task_name').value = task.name;
  document.getElementById('trigger_type').value = task.trigger_type;
  document.getElementById('task_type').value = task.task_type;

  if (task.trigger_config) {
    const cfg = task.trigger_config;
    if (cfg.minute !== undefined) document.getElementById('cron_minute').value = cfg.minute;
    if (cfg.hour !== undefined) document.getElementById('cron_hour').value = cfg.hour;
    if (cfg.day !== undefined) document.getElementById('cron_day').value = cfg.day;
    if (cfg.month !== undefined) document.getElementById('cron_month').value = cfg.month;
    if (cfg.day_of_week !== undefined) document.getElementById('cron_day_of_week').value = cfg.day_of_week;
    if (cfg.seconds !== undefined) document.getElementById('interval_seconds').value = cfg.seconds;
    if (cfg.run_date !== undefined) {
      const d = new Date(cfg.run_date);
      document.getElementById('run_date').value = formatDateTimeLocalInput(d);
    }
  }

  if (task.task_type === 'python') {
    document.getElementById('python_func').value = task.task_func || '';
    document.getElementById('shell_script').value = '';
  } else {
    document.getElementById('python_func').value = '';
    document.getElementById('shell_script').value = task.task_script || '';
  }

  document.getElementById('enabled').checked = task.enabled !== false;
  showTriggerFields(task.trigger_type);
  showTaskFields(task.task_type);
  
  const preferredAccount = task.account || "";
  renderAccountOptions(preferredAccount);
  if (!state.accountLoading && !state.accounts.length) {
    await loadAccounts({ showError: true, preferredAccount });
  }
  
  document.getElementById('taskModal').classList.remove('hidden');
}

function showTriggerFields(triggerType) {
  document.querySelectorAll('.trigger-field').forEach(el => el.classList.add('hidden'));
  switch (triggerType) {
    case 'cron':
      document.getElementById('cron_fields').classList.remove('hidden');
      break;
    case 'interval':
      document.getElementById('interval_fields').classList.remove('hidden');
      break;
    case 'date':
      document.getElementById('date_fields').classList.remove('hidden');
      break;
  }
}

function showTaskFields(taskType) {
  document.querySelectorAll('.task-field').forEach(el => el.classList.add('hidden'));
  const accountSection = document.getElementById('accountSection');
  if (taskType === 'python') {
    document.getElementById('python_field').classList.remove('hidden');
    if (accountSection) {
      accountSection.classList.add('hidden');
    }
  } else {
    document.getElementById('shell_field').classList.remove('hidden');
    if (accountSection && state.serviceCanSwitchAccount) {
      accountSection.classList.remove('hidden');
    }
  }
}

async function saveTask(e) {
  e.preventDefault();

  const name = document.getElementById('task_name').value.trim();
  const triggerType = document.getElementById('trigger_type').value;
  const taskType = document.getElementById('task_type').value;
  const enabled = document.getElementById('enabled').checked;
  const accountSelect = document.getElementById('accountSelect');
  const account = accountSelect ? accountSelect.value : '';

  if (!name) {
    showToast(_t('error.task_name_required'), true);
    return;
  }

  let triggerConfig = {};
  switch (triggerType) {
    case 'cron':
      triggerConfig = {
        minute: document.getElementById('cron_minute').value || '*',
        hour: document.getElementById('cron_hour').value || '*',
        day: document.getElementById('cron_day').value || '*',
        month: document.getElementById('cron_month').value || '*',
        day_of_week: document.getElementById('cron_day_of_week').value || '*',
      };
      break;
    case 'interval':
      triggerConfig = { seconds: parseInt(document.getElementById('interval_seconds').value) || 60 };
      break;
    case 'date':
      let runDateValue = document.getElementById('run_date').value;
      if (runDateValue && runDateValue.length === 16 && runDateValue[10] === 'T') {
        runDateValue = runDateValue + ':00';
      }
      triggerConfig = { run_date: runDateValue };
      break;
  }

  let taskFunc = null;
  let taskScript = null;
  if (taskType === 'python') {
    taskFunc = document.getElementById('python_func').value.trim();
  } else {
    taskScript = document.getElementById('shell_script').value;
    if (!taskScript) {
      showToast(_t('error.task_content_required'), true);
      return;
    }
  }

  const payload = {
    name,
    trigger_type: triggerType,
    trigger_config: triggerConfig,
    task_type: taskType,
    task_func: taskFunc,
    task_script: taskScript,
    enabled,
    account,
  };

  if (account === 'root' && state.serviceCanSwitchAccount) {
    if (!confirm(_t('confirm.root_account', { account: account }))) {
      return;
    }
  }

  await doSaveTask(payload);
}

async function doSaveTask(payload) {
  try {
    if (state.editingTaskId) {
      await apiFetch(`api/tasks/${state.editingTaskId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch('api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    closeModal('taskModal');
    await loadTasks();
    showToast(_t('status.success'), false);
  } catch (err) {
    showToast(_t('error.save_task'), true);
  }
}

async function deleteSelectedTasks() {
  if (state.selectedIds.size === 0) return;
  if (!confirm(`Delete ${state.selectedIds.size} task(s)?`)) return;

  try {
    for (const id of state.selectedIds) {
      await apiFetch(`api/tasks/${id}`, { method: 'DELETE' });
    }
    state.selectedIds.clear();
    await loadTasks();
    showToast(_t('status.success'), false);
  } catch (err) {
    showToast(_t('error.delete_task'), true);
  }
}

async function runSelectedTasks() {
  if (state.selectedIds.size === 0) return;

  try {
    for (const id of state.selectedIds) {
      await apiFetch(`api/tasks/${id}/run`, { method: 'POST' });
    }
    showToast(_t('status.running'), false);
  } catch (err) {
    showToast(_t('error.run_task'), true);
  }
}

async function toggleSelectedTasks() {
  if (state.selectedIds.size === 0) return;

  try {
    for (const id of state.selectedIds) {
      const task = state.tasks.find(t => t.id === parseInt(id));
      if (task) {
        await apiFetch(`api/tasks/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...task, enabled: !task.enabled }),
        });
      }
    }
    await loadTasks();
  } catch (err) {
    showToast('Failed to toggle tasks', true);
  }
}

async function showResults(taskId) {
  state.currentResultTaskId = taskId;
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('resultSubtitle').textContent = task.name;
  document.getElementById('resultModal').classList.remove('hidden');
  await loadResults(taskId);
}

async function loadResults(taskId) {
  try {
    const data = await apiFetch(`api/tasks/${taskId}/results`);
    const results = data.data || [];
    renderResults(results);
  } catch (err) {
    console.error('Failed to load results', err);
  }
}

function renderResults(results) {
  const list = document.getElementById('resultList');

  if (!results.length) {
    list.innerHTML = '<div class="empty">No execution results yet.</div>';
    return;
  }

  list.innerHTML = results.map(r => `
    <div class="result-item">
      <div class="result-header">
        <span class="result-time">${formatDateTime(r.started_at)}</span>
        <span class="result-exit-code ${r.exit_code === 0 ? 'success' : 'failed'}">
          Exit: ${r.exit_code ?? 'N/A'}
        </span>
      </div>
      ${r.log ? `<pre class="result-log">${escapeHtml(r.log)}</pre>` : ''}
    </div>
  `).join('');
}

async function clearResults() {
  if (!state.currentResultTaskId) return;
  if (!confirm('Clear all results for this task?')) return;

  try {
    await apiFetch('api/tasks/clear-results', {
      method: 'POST',
      body: JSON.stringify({ task_id: state.currentResultTaskId }),
    });
    await loadResults(state.currentResultTaskId);
  } catch (err) {
    console.error('Failed to clear results', err);
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function sanitizeCronValue(value = "") {
  return value.replace(/[^0-9*\/,\-]/g, "").replace(/,{2,}/g, ",");
}

function getCronFieldValue(field) {
  const select = cronSelects[field];
  if (!select) {
    return "*";
  }
  if (select.value === "custom") {
    const input = cronCustomInputs[field];
    const sanitized = sanitizeCronValue(input?.value || "");
    return sanitized || "*";
  }
  return select.value || "*";
}

function updateCronPreview() {
  const expression = CRON_FIELDS.map((field) => getCronFieldValue(field)).join(" ");
  const cronPreview = document.getElementById('cronPreview');
  const cronNextTimes = document.getElementById('cronNextTimes');
  const btnApplyCron = document.getElementById('btnApplyCron');
  
  if (cronPreview) {
    cronPreview.textContent = expression;
  }
  
  if (cronNextTimes) {
    const result = getNextCronTimes(expression, 2);
    if (!result.valid) {
      cronNextTimes.textContent = _t('cron.invalid');
      cronNextTimes.classList.add("cron-invalid");
      if (cronPreview) {
        cronPreview.classList.add("cron-invalid");
      }
      if (btnApplyCron) {
        btnApplyCron.disabled = true;
      }
    } else {
      if (btnApplyCron) {
        btnApplyCron.disabled = false;
      }
      cronNextTimes.classList.remove("cron-invalid");
      if (cronPreview) {
        cronPreview.classList.remove("cron-invalid");
      }
      if (result.times.length) {
        cronNextTimes.innerHTML =
          _t('cron.preview') +
          result.times.map((t) => `<div>${t}</div>`).join("");
      } else {
        cronNextTimes.textContent = "";
      }
      if (result.exceeded) {
        const hint = document.createElement("div");
        hint.className = "muted";
        hint.style.marginTop = "6px";
        hint.textContent = _t('cron.search_exceeded', { months: result.maxMonths });
        cronNextTimes.appendChild(hint);
      }
    }
  }
  return expression;
}

function getNextCronTimes(expr, count = 2) {
  try {
    const now = new Date();
    let base = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      0,
      0,
    );
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) { return { times: [], valid: false }; }
    
    function parseField(str, min, max) {
      if (str === "*") { return Array.from({ length: max - min + 1 }, (_, i) => i + min); }
      let out = new Set();
      str.split(",").forEach((token) => {
        if (token.includes("/")) {
          let [range, step] = token.split("/");
          step = parseInt(step);
          if (!step || step < 1) { return; }
          let vals =
            range === "*"
              ? Array.from({ length: max - min + 1 }, (_, i) => i + min)
              : parseRange(range, min, max);
          vals.forEach((v, i) => {
            if ((v - min) % step === 0) { out.add(v); }
          });
        } else {
          parseRange(token, min, max).forEach((v) => out.add(v));
        }
      });
      return Array.from(out)
        .filter((v) => v >= min && v <= max)
        .sort((a, b) => a - b);
    }
    
    function parseRange(token, min, max) {
      if (token === "*") { return Array.from({ length: max - min + 1 }, (_, i) => i + min); }
      if (token.includes("-")) {
        let [a, b] = token.split("-").map(Number);
        if (isNaN(a) || isNaN(b) || a > b) { return []; }
        return Array.from({ length: b - a + 1 }, (_, i) => a + i);
      }
      let n = Number(token);
      return isNaN(n) ? [] : [n];
    }
    
    const rawParts = parts;
    const minutes = parseField(rawParts[0], 0, 59);
    const hours = parseField(rawParts[1], 0, 23);
    const days = parseField(rawParts[2], 1, 31);
    const months = parseField(rawParts[3], 1, 12);
    const weekdays = parseField(rawParts[4], 0, 6);
    const dayFieldIsStar = rawParts[2] === "*";
    const weekdayFieldIsStar = rawParts[4] === "*";
    
    if (
      (rawParts[0] !== "*" && !minutes.length) ||
      (rawParts[1] !== "*" && !hours.length) ||
      (rawParts[2] !== "*" && !days.length) ||
      (rawParts[3] !== "*" && !months.length) ||
      (rawParts[4] !== "*" && !weekdays.length)
    ) {
      return { times: [], valid: false };
    }
    
    let results = [];
    const maxMonths = 36;
    const seen = new Set();
    function pushIfNew(dt) {
      const s = dt.getTime();
      if (s <= base.getTime() || seen.has(s)) return;
      seen.add(s);
      results.push(formatCronDate(dt));
    }

    for (let offset = 0; offset < maxMonths && results.length < count; offset++) {
      const y = base.getFullYear() + Math.floor((base.getMonth() + offset) / 12);
      const mIndex = (base.getMonth() + offset) % 12;
      const monthNum = mIndex + 1;
      if (!months.includes(monthNum)) continue;
      const daysInThisMonth = new Date(y, mIndex + 1, 0).getDate();
      for (let day = 1; day <= daysInThisMonth && results.length < count; day++) {
        const dtWeekJs = new Date(y, mIndex, day).getDay();
        const cronWeekday = (dtWeekJs + 6) % 7;
        const dayMatch = days.includes(day);
        const weekMatch = weekdays.includes(cronWeekday);
        let dateMatches = false;
        if (dayFieldIsStar && weekdayFieldIsStar) {
          dateMatches = true;
        } else if (dayFieldIsStar) {
          dateMatches = weekMatch;
        } else if (weekdayFieldIsStar) {
          dateMatches = dayMatch;
        } else {
          dateMatches = dayMatch || weekMatch;
        }
        if (!dateMatches) continue;
        for (let hi = 0; hi < hours.length && results.length < count; hi++) {
          const hour = hours[hi];
          for (let mi = 0; mi < minutes.length && results.length < count; mi++) {
            const minute = minutes[mi];
            const cand = new Date(y, mIndex, day, hour, minute, 0, 0);
            pushIfNew(cand);
          }
        }
      }
    }
    results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { times: results.slice(0, count), valid: true };
  } catch (e) {
    return { times: [], valid: false };
  }
}

function formatCronDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const h = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

function prefillCronGenerator(expression = "") {
  const normalized = expression.trim();
  const tokens = normalized ? normalized.split(/\s+/) : [];
  CRON_FIELDS.forEach((field, index) => {
    const select = cronSelects[field];
    const input = cronCustomInputs[field];
    if (!select) {
      return;
    }
    const rawPart = tokens[index] || "*";
    const normalizedPart =
      rawPart === "*" ? "*" : sanitizeCronValue(rawPart) || "*";
    const hasOption = Array.from(select.options).some(
      (option) => option.value === normalizedPart,
    );
    if (hasOption) {
      select.value = normalizedPart;
      if (input) {
        input.classList.add("hidden");
        input.value = "";
      }
    } else {
      select.value = "custom";
      if (input) {
        input.classList.remove("hidden");
        input.value = normalizedPart;
      }
    }
  });
  updateCronPreview();
}

async function loadSettings() {
  try {
    const data = await apiFetch('api/settings');
    const settings = data.data || {};
    document.getElementById('settings_task_timeout').value = settings.task_timeout || 900;
    document.getElementById('settings_result_retention').value = settings.result_retention_per_task || 200;
    document.getElementById('settings_result_log_preview').value = settings.result_log_preview_limit || 4000;
  } catch (err) {
    console.error('Failed to load settings', err);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  try {
    await apiFetch('api/settings', {
      method: 'POST',
      body: JSON.stringify({
        task_timeout: parseInt(document.getElementById('settings_task_timeout').value) || 900,
        result_retention_per_task: parseInt(document.getElementById('settings_result_retention').value) || 200,
        result_log_preview_limit: parseInt(document.getElementById('settings_result_log_preview').value) || 4000,
      }),
    });
    closeModal('settingsModal');
    showToast(_t('status.success'), false);
  } catch (err) {
    showToast('Failed to save settings', true);
  }
}

async function stopSelectedTasks() {
  if (state.selectedIds.size === 0) return;

  try {
    for (const id of state.selectedIds) {
      await apiFetch(`api/tasks/${id}/stop`, { method: 'POST' });
    }
    showToast(_t('status.stopped') || '已终止', false);
  } catch (err) {
    showToast(_t('error.stop_task') || '终止任务失败', true);
  }
}

function applyTheme(mode) {
  const html = document.documentElement;
  if (!html) return;

  if (mode === 'dark') {
    html.classList.add('dark');
  } else if (mode === 'light') {
    html.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }
}

function initTheme() {
  const themeSelect = document.getElementById('themeSelect');
  let savedTheme = localStorage.getItem('scheduler_theme') || 'system';
  
  if (themeSelect) {
    themeSelect.value = savedTheme;
    themeSelect.addEventListener('change', (e) => {
      const newTheme = e.target.value;
      localStorage.setItem('scheduler_theme', newTheme);
      applyTheme(newTheme);
    });
  }
  
  applyTheme(savedTheme);
  
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const currentTheme = localStorage.getItem('scheduler_theme') || 'system';
      if (currentTheme === 'system') {
        applyTheme('system');
      }
    });
  }
}

function initEventListeners() {
  const btnCreate = document.getElementById('btnCreate');
  const btnEdit = document.getElementById('btnEdit');
  const btnDelete = document.getElementById('btnDelete');
  const btnReload = document.getElementById('btnReload');
  const btnRun = document.getElementById('btnRun');
  const btnStop = document.getElementById('btnStop');
  const btnToggle = document.getElementById('btnToggle');
  const btnResults = document.getElementById('btnResults');
  const btnSettings = document.getElementById('btnSettings');
  const taskForm = document.getElementById('taskForm');
  const settingsForm = document.getElementById('settingsForm');
  const btnClearResults = document.getElementById('btnClearResults');
  const triggerType = document.getElementById('trigger_type');
  const taskType = document.getElementById('task_type');
  const langSelect = document.getElementById('langSelect');
  const btnReloadAccounts = document.getElementById('btnReloadAccounts');

  if (btnCreate) btnCreate.addEventListener('click', openCreateModal);
  if (btnEdit) btnEdit.addEventListener('click', () => {
    if (state.selectedIds.size === 1) {
      openEditModal(parseInt([...state.selectedIds][0]));
    }
  });
  if (btnDelete) btnDelete.addEventListener('click', deleteSelectedTasks);
  if (btnReload) btnReload.addEventListener('click', async () => {
    try {
      await apiFetch('api/tasks/reload');
      await loadTasks();
      showToast(_t('status.success'), false);
    } catch (err) {
      showToast('Failed to reload tasks', true);
    }
  });
  if (btnRun) btnRun.addEventListener('click', runSelectedTasks);
  if (btnStop) btnStop.addEventListener('click', stopSelectedTasks);
  if (btnToggle) btnToggle.addEventListener('click', toggleSelectedTasks);
  if (btnResults) btnResults.addEventListener('click', () => {
    if (state.selectedIds.size === 1) {
      showResults(parseInt([...state.selectedIds][0]));
    }
  });
  if (btnSettings) btnSettings.addEventListener('click', () => {
    loadSettings();
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.classList.remove('hidden');
  });

  if (btnReloadAccounts) {
    btnReloadAccounts.addEventListener('click', async () => {
      await loadAccounts({ showError: true });
    });
  }

  if (taskForm) taskForm.addEventListener('submit', saveTask);
  if (settingsForm) settingsForm.addEventListener('submit', saveSettings);
  if (btnClearResults) btnClearResults.addEventListener('click', clearResults);

  if (triggerType) triggerType.addEventListener('change', (e) => showTriggerFields(e.target.value));
  if (taskType) taskType.addEventListener('change', (e) => showTaskFields(e.target.value));

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      window.__i18n.setLang(e.target.value);
      location.reload();
    });
    langSelect.value = window.__i18n.getLang();
  }

  CRON_FIELDS.forEach((field) => {
    const select = cronSelects[field];
    const input = cronCustomInputs[field];
    if (select) {
      select.addEventListener('change', () => {
        const useCustom = select.value === "custom";
        if (input) {
          input.classList.toggle("hidden", !useCustom);
          if (useCustom && !input.value.trim()) {
            input.value = "*";
          }
          if (!useCustom) {
            input.value = "";
          }
        }
        updateCronPreview();
      });
    }
    if (input) {
      input.addEventListener('input', () => {
        const sanitized = sanitizeCronValue(input.value);
        if (sanitized !== input.value) {
          input.value = sanitized;
        }
        updateCronPreview();
      });
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest('#btnCronGenerator')) {
      event.preventDefault();
      const minute = document.getElementById('cron_minute')?.value || '*';
      const hour = document.getElementById('cron_hour')?.value || '*';
      const day = document.getElementById('cron_day')?.value || '*';
      const month = document.getElementById('cron_month')?.value || '*';
      const weekday = document.getElementById('cron_day_of_week')?.value || '*';
      const current = `${minute} ${hour} ${day} ${month} ${weekday}`;
      prefillCronGenerator(current);
      const cronModal = document.getElementById('cronModal');
      if (cronModal) cronModal.classList.remove('hidden');
      return;
    }
    if (target.closest('#btnApplyCron')) {
      event.preventDefault();
      const expression = updateCronPreview();
      const parts = expression.split(' ');
      if (parts.length === 5) {
        const minuteInput = document.getElementById('cron_minute');
        const hourInput = document.getElementById('cron_hour');
        const dayInput = document.getElementById('cron_day');
        const monthInput = document.getElementById('cron_month');
        const weekdayInput = document.getElementById('cron_day_of_week');
        
        if (minuteInput) minuteInput.value = parts[0];
        if (hourInput) hourInput.value = parts[1];
        if (dayInput) dayInput.value = parts[2];
        if (monthInput) monthInput.value = parts[3];
        if (weekdayInput) weekdayInput.value = parts[4];
      }
      const cronModal = document.getElementById('cronModal');
      if (cronModal) cronModal.classList.add('hidden');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.__i18n && window.__i18n.applyTranslations) {
    window.__i18n.applyTranslations();
  }
  initTheme();
  initEventListeners();
  initScriptManager();
  loadTasks();
  setInterval(loadTasks, 5000);
});

let scriptState = {
  scripts: [],
  currentScript: null
};

function initScriptManager() {
  const btnScripts = document.getElementById('btnScripts');
  if (btnScripts) {
    btnScripts.addEventListener('click', () => {
      openScriptModal();
    });
  }

  const btnNewPython = document.getElementById('btnNewPython');
  if (btnNewPython) {
    btnNewPython.addEventListener('click', () => {
      newScript('python');
    });
  }

  const btnNewShell = document.getElementById('btnNewShell');
  if (btnNewShell) {
    btnNewShell.addEventListener('click', () => {
      newScript('shell');
    });
  }

  const btnRefreshScripts = document.getElementById('btnRefreshScripts');
  if (btnRefreshScripts) {
    btnRefreshScripts.addEventListener('click', () => {
      loadScripts();
    });
  }

  const btnSaveScript = document.getElementById('btnSaveScript');
  if (btnSaveScript) {
    btnSaveScript.addEventListener('click', () => {
      saveScript();
    });
  }

  const btnDeleteScript = document.getElementById('btnDeleteScript');
  if (btnDeleteScript) {
    btnDeleteScript.addEventListener('click', () => {
      deleteScript();
    });
  }
}

function openScriptModal() {
  const modal = document.getElementById('scriptModal');
  if (modal) {
    modal.classList.remove('hidden');
    loadScripts();
  }
}

function closeScriptModal() {
  const modal = document.getElementById('scriptModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

async function loadScripts() {
  try {
    const data = await apiFetch('api/scripts');
    scriptState.scripts = data.data || [];
    renderScriptList();
  } catch (err) {
    showToast(_t('error.load_scripts'), true);
  }
}

function renderScriptList() {
  const listEl = document.getElementById('scriptList');
  if (!listEl) return;

  listEl.innerHTML = scriptState.scripts.map(script => {
    const isSelected = scriptState.currentScript && scriptState.currentScript.name === script.name;
    const icon = script.type === 'python' ? '🐍' : '📜';
    return `
      <div class="script-item ${isSelected ? 'selected' : ''}" data-name="${script.name}">
        <span class="script-icon">${icon}</span>
        <span class="script-name">${script.name}</span>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.script-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.name;
      selectScript(name);
    });
  });
}

async function selectScript(name) {
  const script = scriptState.scripts.find(s => s.name === name);
  if (!script) return;

  scriptState.currentScript = script;
  renderScriptList();

  const btnDelete = document.getElementById('btnDeleteScript');
  const filenameInput = document.getElementById('scriptFilename');
  const contentTextarea = document.getElementById('scriptContent');

  if (btnDelete) btnDelete.disabled = false;
  if (filenameInput) filenameInput.value = name;
  if (contentTextarea) contentTextarea.value = '';

  try {
    const data = await apiFetch(`api/scripts/${encodeURIComponent(name)}`);
    if (data.data && contentTextarea) {
      contentTextarea.value = data.data.content || '';
    }
  } catch (err) {
    showToast(_t('error.read_script'), true);
  }
}

function newScript(type) {
  scriptState.currentScript = null;
  renderScriptList();

  const btnDelete = document.getElementById('btnDeleteScript');
  const filenameInput = document.getElementById('scriptFilename');
  const contentTextarea = document.getElementById('scriptContent');

  if (btnDelete) btnDelete.disabled = true;

  if (type === 'python') {
    if (filenameInput) filenameInput.value = 'my_script.py';
    if (contentTextarea) {
      contentTextarea.value = `def my_function(task_id, task_name):
    """
    你的自定义 Python 函数
    task_id: 任务 ID (整数)
    task_name: 任务名称 (字符串)
    """
    from datetime import datetime
    print(f"[{datetime.now()}] Task '{task_name}' (ID: {task_id}) executed")
`;
    }
  } else {
    if (filenameInput) filenameInput.value = 'my_script.sh';
    if (contentTextarea) {
      contentTextarea.value = `#!/bin/bash

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] Task executed successfully"
`;
    }
  }
}

async function saveScript() {
  const filenameInput = document.getElementById('scriptFilename');
  const contentTextarea = document.getElementById('scriptContent');

  const filename = filenameInput ? filenameInput.value.trim() : '';
  const content = contentTextarea ? contentTextarea.value : '';

  if (!filename) {
    showToast(_t('error.filename_required'), true);
    return;
  }

  if (!filename.endsWith('.py') && !filename.endsWith('.sh')) {
    showToast(_t('error.invalid_filename'), true);
    return;
  }

  try {
    await apiFetch('api/scripts', {
      method: 'POST',
      body: JSON.stringify({ name: filename, content: content })
    });

    showToast(_t('success.script_saved'));
    loadScripts();
    selectScript(filename);
  } catch (err) {
    showToast(_t('error.save_script'), true);
  }
}

async function deleteScript() {
  if (!scriptState.currentScript) return;

  if (!confirm(_t('confirm.delete_script', { name: scriptState.currentScript.name }))) {
    return;
  }

  try {
    await apiFetch(`api/scripts/${encodeURIComponent(scriptState.currentScript.name)}`, {
      method: 'DELETE'
    });

    showToast(_t('success.script_deleted'));
    scriptState.currentScript = null;

    const btnDelete = document.getElementById('btnDeleteScript');
    const filenameInput = document.getElementById('scriptFilename');
    const contentTextarea = document.getElementById('scriptContent');

    if (btnDelete) btnDelete.disabled = true;
    if (filenameInput) filenameInput.value = '';
    if (contentTextarea) contentTextarea.value = '';

    loadScripts();
  } catch (err) {
    showToast(_t('error.delete_script'), true);
  }
}
