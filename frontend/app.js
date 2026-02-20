/**
 * NovSmart 前端交互逻辑
 */

const API = '';  // 同源，留空即可

let currentSessionId = null;
let sessions = [];
let sessionModalMode = 'create'; // 'create' or 'edit'

// ─────────── 工具函数 ───────────

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showToast(msg, duration = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function toggleSidebar() {
  $('#sidebar').classList.toggle('collapsed');
}

// ─────────── 主题切换 ───────────

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('novsmart-theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = localStorage.getItem('novsmart-theme');
  // 默认跟随系统，无保存则检测系统偏好
  let theme = saved;
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  updateThemeIcon(theme);
}

async function apiFetch(path, opts = {}) {
  const url = API + path;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || '请求失败');
  }
  return res;
}

async function apiJson(path, opts = {}) {
  const res = await apiFetch(path, opts);
  return res.json();
}

// ─────────── API 配置 ───────────

async function loadConfig() {
  try {
    const cfg = await apiJson('/api/config');
    if (cfg.api_key) $('#apiKey').value = cfg.api_key;
    if (cfg.base_url) $('#baseUrl').value = cfg.base_url;
    if (cfg.model) $('#model').value = cfg.model;
    if (cfg.configured) {
      setConfigStatus('success', `已连接 · ${cfg.model}`);
    }
  } catch { /* ignore */ }
}

async function saveConfig() {
  const apiKey = $('#apiKey').value.trim();
  const baseUrl = $('#baseUrl').value.trim();
  const model = $('#model').value.trim();
  if (!apiKey) {
    showToast('请输入有效的 API Key');
    return;
  }
  try {
    const data = await apiJson('/api/config', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey, base_url: baseUrl, model }),
    });
    setConfigStatus('success', `已连接 · ${data.model}`);
    showToast('配置保存成功');
  } catch (e) {
    setConfigStatus('error', e.message);
  }
}

function setConfigStatus(type, msg) {
  const el = $('#configStatus');
  el.className = 'status-badge ' + type;
  el.textContent = msg;
  el.style.display = 'block';
}

// ─────────── 会话管理 ───────────

async function loadSessions() {
  try {
    sessions = await apiJson('/api/session/list');
    renderSessionList();
  } catch { sessions = []; renderSessionList(); }
}

function renderSessionList() {
  const container = $('#sessionList');
  if (!sessions.length) {
    container.innerHTML = '<p class="empty-hint">暂无会话，点击新建开始</p>';
    return;
  }
  container.innerHTML = sessions.map(s => `
    <div class="session-item ${s.session_id === currentSessionId ? 'active' : ''}"
         onclick="selectSession('${s.session_id}')">
      <div>
        <div class="name">${escHtml(s.name)}</div>
        <div class="meta">${s.history ? s.history.length : 0} 步</div>
      </div>
      <button class="delete-btn" onclick="event.stopPropagation();deleteSession('${s.session_id}')" title="删除">🗑</button>
    </div>
  `).join('');
}

function openNewSessionModal() {
  sessionModalMode = 'create';
  clearSessionFormFields();
  switchCreateMode('manual');
  $('#sessionModalTitle').textContent = '创建新会话';
  $('#btnManualCreate').textContent = '创建';
  $('#createTabSwitcher').style.display = '';
  openModal('newSessionModal');
}

async function createSession() {
  if (sessionModalMode === 'edit') {
    return updateSessionSettings();
  }

  const name = $('#newSessionName').value.trim() || '未命名会话';
  const rules = $('#newRules').value.trim().split('\n').filter(Boolean);

  const body = {
    name,
    world_setting: {
      title: $('#newTitle').value.trim(),
      genre: $('#newGenre').value.trim(),
      background: $('#newBackground').value.trim(),
      rules,
    },
    session_config: {
      current_arc: $('#newArc').value.trim(),
      custom_instructions: $('#newInstructions').value.trim(),
    },
    characters: {},
  };

  try {
    const session = await apiJson('/api/session/new', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    closeModal('newSessionModal');
    showToast('会话创建成功');
    await loadSessions();
    selectSession(session.session_id);
  } catch (e) {
    showToast('创建失败: ' + e.message);
  }
}

// ─────────── 创建模式切换 ───────────

function switchCreateMode(mode) {
  const manualPanel = $('#manualCreatePanel');
  const smartPanel = $('#smartCreatePanel');
  const btnManual = $('#btnManualCreate');
  const btnSmart = $('#btnSmartParse');
  const tabManual = $('#tabManual');
  const tabSmart = $('#tabSmart');

  if (mode === 'smart') {
    manualPanel.style.display = 'none';
    smartPanel.style.display = '';
    btnManual.style.display = 'none';
    btnSmart.style.display = '';
    tabManual.classList.remove('active');
    tabSmart.classList.add('active');
  } else {
    manualPanel.style.display = '';
    smartPanel.style.display = 'none';
    btnManual.style.display = '';
    btnSmart.style.display = 'none';
    tabManual.classList.add('active');
    tabSmart.classList.remove('active');
  }
}

async function smartParseAndFill() {
  const text = $('#smartText').value.trim();
  if (!text) { showToast('请输入设定文本'); return; }

  const btn = $('#btnSmartParse');
  const statusEl = $('#smartParseStatus');
  btn.disabled = true;
  btn.textContent = '解析中...';
  statusEl.className = 'status-badge';
  statusEl.style.display = 'none';

  try {
    const data = await apiJson('/api/parse-text', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    // 填充表单字段
    fillFormFromParsedData(data);

    // 切换到手动模式供用户审查
    switchCreateMode('manual');
    showToast('解析完成，请检查并修改后创建');
  } catch (e) {
    statusEl.className = 'status-badge error';
    statusEl.textContent = '解析失败: ' + e.message;
    statusEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ 智能解析';
  }
}

function fillFormFromParsedData(data) {
  const ws = data.world_setting || {};
  const sc = data.session_config || {};
  $('#newSessionName').value = data.session_name || '';
  $('#newTitle').value = ws.title || '';
  $('#newGenre').value = ws.genre || '';
  $('#newBackground').value = ws.background || '';
  $('#newRules').value = (ws.rules || []).join('\n');
  $('#newArc').value = sc.current_arc || ws.current_arc || '';
  $('#newInstructions').value = sc.custom_instructions || ws.custom_instructions || '';
}

function clearSessionFormFields() {
  ['#newSessionName','#newTitle','#newGenre','#newBackground','#newRules','#newArc','#newInstructions','#smartText'].forEach(s => $(s).value = '');
  $('#smartParseStatus').style.display = 'none';
}

// ─────────── 编辑会话设定 ───────────

async function openEditSessionModal() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }

  try {
    const session = await apiJson(`/api/session/${currentSessionId}`);
    sessionModalMode = 'edit';

    const ws = session.world_setting || {};
    const sc = session.session_config || {};
    $('#newSessionName').value = session.name || '';
    $('#newTitle').value = ws.title || '';
    $('#newGenre').value = ws.genre || '';
    $('#newBackground').value = ws.background || '';
    $('#newRules').value = (ws.rules || []).join('\n');
    $('#newArc').value = sc.current_arc || '';
    $('#newInstructions').value = sc.custom_instructions || '';

    switchCreateMode('manual');
    $('#sessionModalTitle').textContent = '编辑会话设定';
    $('#btnManualCreate').textContent = '保存';
    $('#createTabSwitcher').style.display = 'none';
    openModal('newSessionModal');
  } catch (e) { showToast('加载失败: ' + e.message); }
}

async function updateSessionSettings() {
  const name = $('#newSessionName').value.trim() || '未命名会话';
  const ws = {
    title: $('#newTitle').value.trim(),
    genre: $('#newGenre').value.trim(),
    background: $('#newBackground').value.trim(),
    rules: $('#newRules').value.trim().split('\n').filter(Boolean),
  };
  const sc = {
    current_arc: $('#newArc').value.trim(),
    custom_instructions: $('#newInstructions').value.trim(),
  };

  try {
    const updated = await apiJson('/api/session/setting', {
      method: 'PUT',
      body: JSON.stringify({ session_id: currentSessionId, name, world_setting: ws, session_config: sc }),
    });

    closeModal('newSessionModal');
    renderSession(updated);
    await loadSessions();
    renderSessionList();
    showToast('设定已更新');
  } catch (e) { showToast('更新失败: ' + e.message); }
}

async function deleteSession(sid) {
  if (!confirm('确定删除该会话？此操作不可撤销。')) return;
  try {
    await apiJson(`/api/session/${sid}`, { method: 'DELETE' });
    if (currentSessionId === sid) {
      currentSessionId = null;
      showWelcome();
    }
    await loadSessions();
    showToast('已删除');
  } catch (e) { showToast('删除失败: ' + e.message); }
}

async function selectSession(sid) {
  try {
    const session = await apiJson(`/api/session/${sid}`);
    currentSessionId = sid;
    renderSession(session);
    renderSessionList();
  } catch (e) { showToast('加载会话失败: ' + e.message); }
}

function renderSession(session) {
  $('#sessionTitle').textContent = session.name || '未命名会话';
  $('#inputArea').style.display = '';
  $('#btnUndo').disabled = !session.history || session.history.length === 0;
  $('#btnExport').disabled = !session.history || session.history.length === 0;

  // 角色面板
  $('#charactersPanel').style.display = '';
  renderCharacters(session.characters || {});

  // 世界面板
  $('#worldPanel').style.display = '';
  renderWorldInfo(session.world_setting);

  // 会话配置面板
  $('#sessionConfigPanel').style.display = '';
  renderSessionConfig(session.session_config);

  // 地点面板
  $('#locationsPanel').style.display = '';
  renderLocations(session.locations || {});

  // 故事区
  renderStory(session.history || []);
}

function showWelcome() {
  $('#sessionTitle').textContent = '请选择或创建一个会话';
  $('#inputArea').style.display = 'none';
  $('#charactersPanel').style.display = 'none';
  $('#worldPanel').style.display = 'none';
  $('#sessionConfigPanel').style.display = 'none';
  $('#locationsPanel').style.display = 'none';
  $('#btnUndo').disabled = true;
  $('#btnExport').disabled = true;
  $('#storyArea').innerHTML = `
    <div class="story-welcome">
      <div class="welcome-icon">✨</div>
      <h2>欢迎使用 NovSmart</h2>
      <p>创建一个新会话，设定你的世界观和角色，然后开始你的创作之旅。</p>
    </div>`;
}

// ─────────── 角色 ───────────

function renderCharacters(chars) {
  const container = $('#charactersList');
  const names = Object.keys(chars);
  if (!names.length) {
    container.innerHTML = '<p class="empty-hint">暂无角色</p>';
    return;
  }
  container.innerHTML = names.map(name => {
    const c = chars[name];
    return `
      <div class="char-card" onclick='showCharDetail(${JSON.stringify(c).replace(/'/g, "&#39;")})'>
        <div class="char-name">${escHtml(c.name)}</div>
        <div class="char-status">${escHtml(c.status || '未知状态')}</div>
        <div class="char-location">📍 ${escHtml(c.location || '未知位置')}</div>
      </div>`;
  }).join('');
}

function showCharDetail(c) {
  $('#charDetailTitle').textContent = c.name;
  const rels = c.relationships
    ? Object.entries(c.relationships).map(([k,v]) => `${k}: ${v}`).join('、')
    : '无';
  const inv = c.inventory && c.inventory.length ? c.inventory.join('、') : '无';

  $('#charDetailBody').innerHTML = `
    <div class="char-detail-grid">
      <div class="char-detail-item"><div class="char-detail-label">描述</div><div class="char-detail-value">${escHtml(c.description || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">性格</div><div class="char-detail-value">${escHtml(c.personality || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">状态</div><div class="char-detail-value">${escHtml(c.status || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">位置</div><div class="char-detail-value">${escHtml(c.location || '暂无')}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">关系</div><div class="char-detail-value">${escHtml(rels)}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">随身物品</div><div class="char-detail-value">${escHtml(inv)}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">备注</div><div class="char-detail-value">${escHtml(c.notes || '暂无')}</div></div>
    </div>`;
  openModal('charDetailModal');
}

function openAddCharacterModal() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }
  openModal('addCharacterModal');
}

async function addCharacter() {
  const name = $('#charName').value.trim();
  if (!name) { showToast('请输入角色名'); return; }

  // 获取当前角色，加上新角色，然后通过 setting 更新
  try {
    const session = await apiJson(`/api/session/${currentSessionId}`);
    const chars = session.characters || {};
    chars[name] = {
      name,
      description: $('#charDesc').value.trim(),
      personality: $('#charPersonality').value.trim(),
      status: $('#charStatus').value.trim(),
      location: $('#charLocation').value.trim(),
      notes: $('#charNotes').value.trim(),
      relationships: {},
      inventory: [],
    };

    const updated = await apiJson('/api/session/setting', {
      method: 'PUT',
      body: JSON.stringify({ session_id: currentSessionId, characters: chars }),
    });

    closeModal('addCharacterModal');
    renderCharacters(updated.characters || {});
    showToast(`角色「${name}」已添加`);
    // 清空表单
    ['#charName','#charDesc','#charPersonality','#charStatus','#charLocation','#charNotes'].forEach(s => $(s).value = '');
  } catch (e) { showToast('添加失败: ' + e.message); }
}

// ─────────── 世界设定 ───────────

function renderWorldInfo(ws) {
  if (!ws) { $('#worldInfo').innerHTML = ''; return; }
  const fields = [
    ['标题', ws.title],
    ['类型', ws.genre],
    ['世界观', ws.background],
    ['规则', (ws.rules || []).join('；')],
  ];
  let html = '';
  for (const [label, val] of fields) {
    if (val) html += `<div class="wi-row"><span class="wi-label">${label}</span>${escHtml(val)}</div>`;
  }
  if (ws.extra_settings) {
    for (const [k, v] of Object.entries(ws.extra_settings)) {
      html += `<div class="wi-row"><span class="wi-label">${escHtml(k)}</span>${escHtml(v)}</div>`;
    }
  }
  $('#worldInfo').innerHTML = html || '<p class="empty-hint">暂无设定</p>';
}

function renderSessionConfig(sc) {
  if (!sc) { $('#sessionConfigInfo').innerHTML = ''; return; }
  const fields = [
    ['剧情弧', sc.current_arc],
    ['写作风格', sc.custom_instructions],
  ];
  let html = '';
  for (const [label, val] of fields) {
    if (val) html += `<div class="wi-row"><span class="wi-label">${label}</span>${escHtml(val)}</div>`;
  }
  $('#sessionConfigInfo').innerHTML = html || '<p class="empty-hint">暂无配置</p>';
}

// ─────────── 地点 ───────────

function renderLocations(locs) {
  const container = $('#locationsList');
  const names = Object.keys(locs);
  if (!names.length) {
    container.innerHTML = '<p class="empty-hint">暂无地点</p>';
    return;
  }
  container.innerHTML = names.map(name => {
    const loc = locs[name];
    return `
      <div class="char-card" onclick='showLocDetail(${JSON.stringify(loc).replace(/'/g, "&#39;")})'>
        <div class="char-name">📍 ${escHtml(loc.name)}</div>
        <div class="char-status">${escHtml(loc.description || '暂无描述')}</div>
        ${loc.parent ? `<div class="char-location">↑ ${escHtml(loc.parent)}</div>` : ''}
      </div>`;
  }).join('');
}

function showLocDetail(loc) {
  $('#locDetailTitle').textContent = loc.name;
  const features = loc.features && loc.features.length ? loc.features.join('、') : '无';
  const connected = loc.connected_to && loc.connected_to.length ? loc.connected_to.join('、') : '无';

  $('#locDetailBody').innerHTML = `
    <div class="char-detail-grid">
      <div class="char-detail-item full"><div class="char-detail-label">描述</div><div class="char-detail-value">${escHtml(loc.description || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">父级地点</div><div class="char-detail-value">${escHtml(loc.parent || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">相连地点</div><div class="char-detail-value">${escHtml(connected)}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">地点特征</div><div class="char-detail-value">${escHtml(features)}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">备注</div><div class="char-detail-value">${escHtml(loc.notes || '暂无')}</div></div>
    </div>`;
  openModal('locDetailModal');
}

function openAddLocationModal() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }
  openModal('addLocationModal');
}

async function addLocation() {
  const name = $('#locName').value.trim();
  if (!name) { showToast('请输入地点名称'); return; }

  try {
    const session = await apiJson(`/api/session/${currentSessionId}`);
    const locs = session.locations || {};
    locs[name] = {
      name,
      description: $('#locDesc').value.trim(),
      parent: $('#locParent').value.trim(),
      features: $('#locFeatures').value.trim().split('\n').filter(Boolean),
      connected_to: $('#locConnected').value.trim().split('\n').filter(Boolean),
      notes: $('#locNotes').value.trim(),
    };

    const updated = await apiJson('/api/session/setting', {
      method: 'PUT',
      body: JSON.stringify({ session_id: currentSessionId, locations: locs }),
    });

    closeModal('addLocationModal');
    renderLocations(updated.locations || {});
    showToast(`地点「${name}」已添加`);
    ['#locName','#locDesc','#locParent','#locFeatures','#locConnected','#locNotes'].forEach(s => $(s).value = '');
  } catch (e) { showToast('添加失败: ' + e.message); }
}

// ─────────── 故事渲染 ───────────

function renderStory(history) {
  const area = $('#storyArea');
  if (!history.length) {
    area.innerHTML = `
      <div class="story-welcome">
        <div class="welcome-icon">📖</div>
        <h2>开始你的故事</h2>
        <p>在下方输入剧情提示，AI 将为你续写精彩内容。</p>
      </div>`;
    return;
  }
  area.innerHTML = history.map((step, i) => `
    <div class="story-block">
      ${step.user_prompt ? `<div class="story-prompt">💡 ${escHtml(step.user_prompt)}</div>` : ''}
      <div class="story-text">${escHtml(step.generated_text)}</div>
      ${i < history.length - 1 ? '<div class="story-divider"></div>' : ''}
    </div>
  `).join('');

  // 滚动到底部
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}

// ─────────── 生成 ───────────

async function generate() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }
  const prompt = $('#userPrompt').value.trim();
  if (!prompt) { showToast('请输入剧情提示'); return; }

  const btn = $('#btnGenerate');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const body = {
      session_id: currentSessionId,
      user_prompt: prompt,
      temperature: parseFloat($('#temperature').value),
      max_tokens: parseInt($('#maxTokens').value),
    };
    const data = await apiJson('/api/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // 追加到故事区
    const area = $('#storyArea');
    // 清空欢迎界面
    if (area.querySelector('.story-welcome')) area.innerHTML = '';

    const block = document.createElement('div');
    block.className = 'story-block';
    block.innerHTML = `
      <div class="story-prompt">💡 ${escHtml(prompt)}</div>
      <div class="story-text">${escHtml(data.story_text)}</div>
    `;
    // 在之前的块后加分割线
    if (area.lastElementChild) {
      const divider = document.createElement('div');
      divider.className = 'story-divider';
      area.appendChild(divider);
    }
    area.appendChild(block);
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });

    // 更新侧边栏
    renderCharacters(data.characters || {});
    renderWorldInfo(data.world_setting);
    renderSessionConfig(data.session_config);
    renderLocations(data.locations || {});

    // 清空输入
    $('#userPrompt').value = '';
    $('#btnUndo').disabled = false;
    $('#btnExport').disabled = false;

    showToast('生成完成');
  } catch (e) {
    showToast('生成失败: ' + e.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ─────────── 撤销 ───────────

async function undoStep() {
  if (!currentSessionId) return;
  try {
    const session = await apiJson(`/api/session/${currentSessionId}/undo`, { method: 'POST' });
    renderSession(session);
    showToast('已撤销');
  } catch (e) { showToast('撤销失败: ' + e.message); }
}

// ─────────── 导出 ───────────

async function exportNovel() {
  if (!currentSessionId) return;
  try {
    const res = await apiFetch(`/api/session/${currentSessionId}/export?format=txt`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'novel.txt';
    a.click();
    URL.revokeObjectURL(url);
    showToast('导出成功');
  } catch (e) { showToast('导出失败: ' + e.message); }
}

// ─────────── 工具 ───────────

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 快捷键：Ctrl/Cmd+Enter 生成
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (document.activeElement === $('#userPrompt')) {
      e.preventDefault();
      generate();
    }
  }
});

// 点击 modal 外部关闭
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('open')) {
    e.target.classList.remove('open');
  }
});

// ─────────── 初始化 ───────────

(async function init() {
  initTheme();
  await loadConfig();
  await loadSessions();
})();
