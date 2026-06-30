const API = '/api/v1';
let currentType = 'backend';
let currentCursor = 0;
let pollInterval = null;
let currentClient = '';
let maxLines = 2000;

const token = localStorage.getItem('admin_token') || '';
const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

const els = {
  tabs: document.querySelectorAll('.tab'),
  logView: document.getElementById('log-view'),
  refreshSelect: document.getElementById('refresh-interval'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnExport: document.getElementById('btn-export'),
  clientSelector: document.getElementById('client-selector'),
  clientList: document.getElementById('client-list'),
  btnDeleteClient: document.getElementById('btn-delete-client')
};

// Initialize
els.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    els.tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentType = tab.dataset.type;
    switchTab();
  });
});

els.btnRefresh.addEventListener('click', fetchLogs);
els.btnExport.addEventListener('click', exportLogs);
els.refreshSelect.addEventListener('change', startPolling);
els.clientList.addEventListener('change', () => {
  currentClient = els.clientList.value;
  resetLogs();
});
els.btnDeleteClient.addEventListener('click', deleteClientLog);

switchTab();

function switchTab() {
  stopPolling();
  resetLogs();
  if (currentType === 'backend') {
    els.clientSelector.style.display = 'none';
    startPolling();
  } else {
    els.clientSelector.style.display = 'flex';
    loadClientList();
  }
}

function resetLogs() {
  els.logView.textContent = '';
  currentCursor = 0;
  if (currentType === 'client' && !currentClient) {
    stopPolling();
  } else {
    fetchLogs();
    startPolling();
  }
}

function startPolling() {
  stopPolling();
  const interval = parseInt(els.refreshSelect.value, 10);
  if (interval > 0) {
    pollInterval = setInterval(fetchLogs, interval);
  }
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function fetchLogs() {
  if (currentType === 'client' && !currentClient) return;

  try {
    let url = currentType === 'backend' 
      ? `${API}/admin/logs/backend?cursor=${currentCursor}`
      : `${API}/admin/logs/clients/${currentClient}?cursor=${currentCursor}`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    
    if (data.code === 0 && data.data) {
      const text = data.data.text;
      const nextCursor = data.data.next_cursor;
      
      if (text) {
        appendLog(text);
        currentCursor = nextCursor;
      } else if (nextCursor === 0) {
        // File recreated or rotated
        els.logView.textContent = '';
        currentCursor = 0;
      }
    }
  } catch (e) {
    console.error(e);
  }
}

function appendLog(text) {
  const isScrolledToBottom = els.logView.scrollHeight - els.logView.clientHeight <= els.logView.scrollTop + 10;
  
  const span = document.createElement('span');
  span.textContent = text;
  els.logView.appendChild(span);

  // Maintain max lines by splitting text contents if getting too large (approximate by character count for performance, e.g. 200,000 chars)
  let totalText = els.logView.textContent;
  if (totalText.length > 200000) {
    els.logView.textContent = totalText.substring(totalText.length - 150000);
  }

  if (isScrolledToBottom) {
    els.logView.scrollTop = els.logView.scrollHeight;
  }
}

async function loadClientList() {
  try {
    const res = await fetch(`${API}/admin/logs/clients`, { headers });
    const data = await res.json();
    if (data.code === 0 && data.data) {
      els.clientList.innerHTML = '<option value="">-- 选择设备日志 --</option>';
      data.data.forEach(log => {
        const opt = document.createElement('option');
        opt.value = log.client_id;
        const kb = (log.size / 1024).toFixed(1);
        opt.textContent = `${log.client_id} (${kb} KB)`;
        els.clientList.appendChild(opt);
      });
      if (currentClient) els.clientList.value = currentClient;
    }
  } catch (e) {
    console.error(e);
  }
}

function exportLogs() {
  let url = '';
  if (currentType === 'backend') {
    url = `${API}/admin/logs/backend/export`;
  } else {
    if (!currentClient) {
      alert('请先选择设备');
      return;
    }
    url = `${API}/admin/logs/clients/${currentClient}/export`;
  }
  
  fetch(url, { headers })
    .then(res => res.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = currentType === 'backend' ? 'backend.log' : `${currentClient}.log`;
      a.click();
    });
}

async function deleteClientLog() {
  if (!currentClient) return;
  if (!confirm('确定删除该设备的日志吗？')) return;
  
  try {
    const res = await fetch(`${API}/admin/logs/clients/${currentClient}`, { method: 'DELETE', headers });
    const data = await res.json();
    if (data.code === 0) {
      els.logView.textContent = '';
      currentClient = '';
      loadClientList();
    } else {
      alert(data.msg);
    }
  } catch (e) {
    console.error(e);
  }
}
