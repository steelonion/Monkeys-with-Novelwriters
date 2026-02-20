/**
 * NovSmart 前端交互逻辑
 */

const API = '';  // 同源，留空即可

let currentSessionId = null;
let sessions = [];
let sessionModalMode = 'create'; // 'create' or 'edit'
let currentMainline = [];       // 当前主线数据
let currentMainlineSummary = ''; // 当前主线概述
let _taskPollTimer = null;       // 任务轮询定时器
let _activeTasks = 0;            // 当前活跃的 AI 任务数
let _currentSession = null;      // 完整的当前会话数据
let _generateMode = 'continue';  // 生成模式: 'continue' | 'adjust'

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
      <div class="session-item-info">
        <div class="name">${escHtml(s.name)}</div>
        <div class="meta">${s.history ? s.history.length : 0} 步</div>
      </div>
      <button class="delete-btn" onclick="event.stopPropagation();deleteSession('${s.session_id}')" title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
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
      custom_field_defs: getCustomFieldDefs(),
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
  btn.textContent = '解析并创建中...';
  statusEl.className = 'status-badge';
  statusEl.style.display = 'none';
  startTaskPolling();

  try {
    // 直接调用解析+创建会话接口，避免表单填充丢失角色和地点
    const session = await apiJson('/api/session/parse-text', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    closeModal('newSessionModal');
    showToast('会话创建成功');
    await loadSessions();
    selectSession(session.session_id);
  } catch (e) {
    statusEl.className = 'status-badge error';
    statusEl.textContent = '解析失败: ' + e.message;
    statusEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ 智能解析并创建';
    stopTaskPolling();
  }
}

function clearSessionFormFields() {
  ['#newSessionName','#newTitle','#newGenre','#newBackground','#newRules','#newArc','#newInstructions','#smartText'].forEach(s => $(s).value = '');
  $('#smartParseStatus').style.display = 'none';
  $('#customFieldDefsList').innerHTML = '';
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

    // 填充自定义字段定义
    $('#customFieldDefsList').innerHTML = '';
    if (sc.custom_field_defs && sc.custom_field_defs.length) {
      for (const fd of sc.custom_field_defs) {
        addCustomFieldDefRow(fd.name, fd.field_type, fd.description);
      }
    }

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
    custom_field_defs: getCustomFieldDefs(),
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
  _currentSession = session;

  $('#sessionTitle').textContent = session.name || '未命名会话';
  $('#inputArea').style.display = '';
  $('#btnUndo').disabled = !session.history || session.history.length === 0;
  $('#btnClearHistory').disabled = !session.history || session.history.length === 0;
  $('#btnExport').disabled = !session.history || session.history.length === 0;

  // 写作配置面板
  const sidebarConfig = session.mainline_session_config || session.session_config;
  $('#sessionConfigPanel').style.display = '';
  renderSessionConfig(sidebarConfig);

  // 主线面板
  $('#mainlinePanel').style.display = '';
  currentMainline = session.mainline || [];
  currentMainlineSummary = session.mainline_summary || '';
  renderMainlinePanel();

  // 故事区
  renderStory(session.history || []);

  // 右侧工作区
  renderWorkspace(session);
}

function showWelcome() {
  _currentSession = null;
  $('#sessionTitle').textContent = '请选择或创建一个会话';
  $('#inputArea').style.display = 'none';
  $('#sessionConfigPanel').style.display = 'none';
  $('#mainlinePanel').style.display = 'none';
  $('#btnUndo').disabled = true;
  $('#btnClearHistory').disabled = true;
  $('#btnExport').disabled = true;
  currentMainline = [];
  currentMainlineSummary = '';
  $('#statePanel').style.display = 'none';
  $('#storyArea').innerHTML = `
    <div class="story-welcome">
      <div class="welcome-icon">✨</div>
      <h2>欢迎使用 NovSmart</h2>
      <p>创建一个新会话，设定你的世界观和角色，然后开始你的创作之旅。</p>
    </div>`;
}

// ─────────── 角色 ───────────

function showCharDetail(c) {
  $('#charDetailTitle').textContent = c.name;
  const rels = c.relationships
    ? Object.entries(c.relationships).map(([k,v]) => `${k}: ${v}`).join('、')
    : '无';
  const inv = c.inventory && c.inventory.length ? c.inventory.join('、') : '无';

  let customFieldsHtml = '';
  if (c.custom_fields && Object.keys(c.custom_fields).length) {
    customFieldsHtml = Object.entries(c.custom_fields).map(([k, v]) => {
      const valStr = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
      return `<div class="char-detail-item full"><div class="char-detail-label">${escHtml(k)}</div><div class="char-detail-value">${escHtml(valStr)}</div></div>`;
    }).join('');
  }

  $('#charDetailBody').innerHTML = `
    <div class="char-detail-grid">
      <div class="char-detail-item"><div class="char-detail-label">描述</div><div class="char-detail-value">${escHtml(c.description || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">性格</div><div class="char-detail-value">${escHtml(c.personality || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">状态</div><div class="char-detail-value">${escHtml(c.status || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">位置</div><div class="char-detail-value">${escHtml(c.location || '暂无')}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">关系</div><div class="char-detail-value">${escHtml(rels)}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">随身物品</div><div class="char-detail-value">${escHtml(inv)}</div></div>
      <div class="char-detail-item full"><div class="char-detail-label">备注</div><div class="char-detail-value">${escHtml(c.notes || '暂无')}</div></div>
      ${customFieldsHtml}
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
      custom_fields: {},
    };

    const updated = await apiJson('/api/session/setting', {
      method: 'PUT',
      body: JSON.stringify({ session_id: currentSessionId, characters: chars }),
    });

    closeModal('addCharacterModal');
    // 刷新右侧状态面板
    if (_currentSession) {
      _currentSession.characters = updated.characters || {};
      renderWorkspace(_currentSession);
    }
    showToast(`角色「${name}」已添加`);
    // 清空表单
    ['#charName','#charDesc','#charPersonality','#charStatus','#charLocation','#charNotes'].forEach(s => $(s).value = '');
  } catch (e) { showToast('添加失败: ' + e.message); }
}

// ─────────── 地点 ───────────

// ─────────── 写作配置 ───────────

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
  if (sc.custom_field_defs && sc.custom_field_defs.length) {
    html += '<div class="wi-row"><span class="wi-label">自定义字段</span>';
    html += sc.custom_field_defs.map(fd => {
      const t = {string:'字符串',number:'数字',list:'数组',object:'对象'}[fd.field_type] || fd.field_type;
      return `<span class="cfd-tag">${escHtml(fd.name)}<small>(${t})</small></span>`;
    }).join(' ');
    html += '</div>';
  }
  $('#sessionConfigInfo').innerHTML = html || '<p class="empty-hint">暂无配置</p>';
}

// ─────────── 角色自定义字段定义 ───────────

function addCustomFieldDefRow(name = '', type = 'string', desc = '') {
  const container = $('#customFieldDefsList');
  const row = document.createElement('div');
  row.className = 'cfd-row';
  row.innerHTML = `
    <input type="text" class="cfd-name" placeholder="字段名（如修为境界）" value="${escHtml(name)}" />
    <select class="cfd-type">
      <option value="string"${type==='string'?' selected':''}>字符串</option>
      <option value="number"${type==='number'?' selected':''}>数字</option>
      <option value="list"${type==='list'?' selected':''}>数组</option>
      <option value="object"${type==='object'?' selected':''}>对象</option>
    </select>
    <input type="text" class="cfd-desc" placeholder="说明（可选）" value="${escHtml(desc)}" />
    <button class="btn btn-sm btn-ghost cfd-remove" type="button" onclick="this.closest('.cfd-row').remove()">✕</button>
  `;
  container.appendChild(row);
}

function getCustomFieldDefs() {
  const rows = document.querySelectorAll('.cfd-row');
  const defs = [];
  rows.forEach(row => {
    const name = row.querySelector('.cfd-name').value.trim();
    if (!name) return;
    defs.push({
      name,
      field_type: row.querySelector('.cfd-type').value,
      description: row.querySelector('.cfd-desc').value.trim(),
    });
  });
  return defs;
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
    // 刷新右侧状态面板
    if (_currentSession) {
      _currentSession.locations = updated.locations || {};
      renderWorkspace(_currentSession);
    }
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
      <div class="story-actions">
        <button class="btn-add-mainline" onclick="addToMainline(this)" title="将此段落收入文章主线">📌 收入主线</button>
      </div>
      ${i < history.length - 1 ? '<div class="story-divider"></div>' : ''}
    </div>
  `).join('');

  // 滚动到底部
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}

// ─────────── 生成模式切换 ───────────

function switchMode(mode) {
  _generateMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(mode === 'continue' ? 'modeContinue' : 'modeAdjust').classList.add('active');

  const textarea = $('#userPrompt');
  const btn = $('#btnGenerate');
  if (mode === 'adjust') {
    textarea.placeholder = '描述需要调整的内容，例如：减少对话，增加环境描写...';
    btn.querySelector('.btn-text').textContent = '✎ 调整';
  } else {
    textarea.placeholder = '描述接下来的剧情走向，例如：主角进入了神秘的密林深处...';
    btn.querySelector('.btn-text').textContent = '✦ 生成';
  }
}

// ─────────── 生成 ───────────

async function generate() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }
  const prompt = $('#userPrompt').value.trim();
  if (!prompt) { showToast('请输入剧情提示'); return; }

  const mode = _generateMode;

  // 调整模式需要有历史
  if (mode === 'adjust') {
    const area = $('#storyArea');
    if (!area.querySelector('.story-block')) {
      showToast('没有可调整的内容，请先续写'); return;
    }
  }

  const btn = $('#btnGenerate');
  btn.classList.add('loading');
  btn.disabled = true;

  // 显示故事区 loading 动画 & 启动任务轮询
  showStoryLoading();
  startTaskPolling();

  try {
    const body = {
      session_id: currentSessionId,
      user_prompt: prompt,
      temperature: parseFloat($('#temperature').value),
      suggested_length: parseInt($('#suggestedLength').value),
      mode: mode,
    };
    const data = await apiJson('/api/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // 移除 loading 动画
    removeStoryLoading();

    const area = $('#storyArea');
    // 清空欢迎界面
    if (area.querySelector('.story-welcome')) area.innerHTML = '';

    if (mode === 'adjust') {
      // 调整模式：替换最后一个故事块
      const blocks = area.querySelectorAll('.story-block');
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock) {
        lastBlock.innerHTML = `
          <div class="story-prompt">✎ ${escHtml(prompt)}</div>
          <div class="story-text">${escHtml(data.story_text)}</div>
          <div class="story-actions">
            <button class="btn-add-mainline" onclick="addToMainline(this)" title="将此段落收入文章主线">📌 收入主线</button>
          </div>
        `;
      }
    } else {
      // 续写模式：追加新故事块
      const block = document.createElement('div');
      block.className = 'story-block';
      block.innerHTML = `
        <div class="story-prompt">💡 ${escHtml(prompt)}</div>
        <div class="story-text">${escHtml(data.story_text)}</div>
        <div class="story-actions">
          <button class="btn-add-mainline" onclick="addToMainline(this)" title="将此段落收入文章主线">📌 收入主线</button>
        </div>
      `;
      // 在之前的块后加分割线
      if (area.lastElementChild) {
        const divider = document.createElement('div');
        divider.className = 'story-divider';
        area.appendChild(divider);
      }
      area.appendChild(block);
    }
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });

    // 更新状态面板
    if (_currentSession) {
      _currentSession.characters = data.characters || {};
      _currentSession.world_setting = data.world_setting;
      _currentSession.session_config = data.session_config;
      _currentSession.locations = data.locations || {};
      renderWorkspace(_currentSession);
    }

    // 清空输入
    $('#userPrompt').value = '';
    $('#btnUndo').disabled = false;
    $('#btnClearHistory').disabled = false;
    $('#btnExport').disabled = false;

    showToast(mode === 'adjust' ? '调整完成' : '生成完成');

    // 调整完成后自动切回续写模式
    if (mode === 'adjust') {
      switchMode('continue');
    }
  } catch (e) {
    removeStoryLoading();
    showToast('生成失败: ' + e.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
    stopTaskPolling();
  }
}

// ─────────── 右侧状态面板（主线 + 工作区双面板） ───────────

function switchStateTab(tab) {
  // 切换 tab 按钮
  document.querySelectorAll('.state-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tab === 'mainline' ? 'stateTabMainline' : 'stateTabWorkspace').classList.add('active');

  // 切换内容面板
  document.querySelectorAll('.state-tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById(tab === 'mainline' ? 'mainlineStatePanel' : 'workspaceStatePanel').classList.add('active');
}

function renderWorkspace(session) {
  const panelEl = $('#statePanel');
  if (!session) { panelEl.style.display = 'none'; return; }

  panelEl.style.display = '';

  // 工作区状态：当前实时状态
  const currentChars = session.characters || {};
  const currentWorld = session.world_setting;
  const currentLocs = session.locations || {};

  // 主线状态：直接从服务端字段读取，服务端保证始终有值
  const mainlineChars = session.mainline_characters || {};
  const mainlineWorld = session.mainline_world_setting || null;
  const mainlineLocs = session.mainline_locations || {};

  // 主线状态面板 —— 展示服务端维护的主线快照
  renderStatePanelCharacters($('#mainlineStateCharacters'), mainlineChars, null);
  renderStatePanelWorld($('#mainlineStateWorld'), mainlineWorld, null);
  renderStatePanelLocations($('#mainlineStateLocations'), mainlineLocs, null);

  // 判断工作区与主线是否有差异
  const hasDiff = JSON.stringify(currentChars) !== JSON.stringify(mainlineChars)
    || JSON.stringify(currentWorld) !== JSON.stringify(mainlineWorld)
    || JSON.stringify(currentLocs) !== JSON.stringify(mainlineLocs);

  // 工作区状态面板 —— 展示当前状态；有差异时与主线快照对比高亮
  renderStatePanelCharacters($('#workspaceStateCharacters'), currentChars, hasDiff ? mainlineChars : null);
  renderStatePanelWorld($('#workspaceStateWorld'), currentWorld, hasDiff ? mainlineWorld : null);
  renderStatePanelLocations($('#workspaceStateLocations'), currentLocs, hasDiff ? mainlineLocs : null);
}

/**
 * 通用角色渲染：current = 要展示的数据，baseline = 对比基准（用于高亮差异），null 表示不做差异对比
 */
function renderStatePanelCharacters(container, current, baseline) {
  const allNames = new Set([...Object.keys(current || {})]);
  if (baseline) {
    for (const n of Object.keys(baseline)) allNames.add(n);
  }

  if (!allNames.size) {
    container.innerHTML = '<p class="empty-hint">暂无角色</p>';
    return;
  }

  let html = '';
  for (const name of allNames) {
    const cur = (current || {})[name];
    const bl = baseline ? baseline[name] : null;
    const isNew = baseline && cur && !bl;
    const isChanged = baseline && cur && bl && _isCharChanged(cur, bl);
    const charData = cur || bl;

    const cardClass = (isNew || isChanged) ? 'ws-char-card ws-changed' : 'ws-char-card';
    const badge = isNew ? '<span class="ws-badge-new">新</span>' : (isChanged ? '<span class="ws-badge-updated">已更新</span>' : '');

    html += `<div class="${cardClass}">`;
    html += `<div class="ws-char-name">${escHtml(charData.name)}${badge}</div>`;

    const fields = [
      ['状态', 'status'], ['位置', 'location'], ['描述', 'description']
    ];
    for (const [label, key] of fields) {
      if (!charData[key]) continue;
      const changed = baseline && bl && cur && bl[key] !== cur[key];
      html += `<div class="ws-char-field"><span class="ws-label">${label}:</span> `;
      html += changed ? `<span class="ws-diff">${escHtml(cur[key])}</span>` : escHtml(charData[key]);
      html += '</div>';
    }

    // 自定义字段
    if (charData.custom_fields && Object.keys(charData.custom_fields).length) {
      html += '<div class="ws-custom-fields">';
      for (const [k, v] of Object.entries(charData.custom_fields)) {
        const valStr = typeof v === 'object' ? JSON.stringify(v, null, 0) : String(v);
        const blCf = bl && bl.custom_fields ? bl.custom_fields[k] : undefined;
        const cfChanged = baseline && blCf !== undefined && JSON.stringify(blCf) !== JSON.stringify(v);
        const isNewCf = baseline && blCf === undefined && isChanged;
        html += `<div class="ws-custom-field"><span class="ws-custom-key">${escHtml(k)}:</span> `;
        html += (cfChanged || isNewCf) ? `<span class="ws-diff">${escHtml(valStr)}</span>` : `<span class="ws-custom-val">${escHtml(valStr)}</span>`;
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function _isCharChanged(cur, ml) {
  const keys = ['status', 'location', 'description', 'personality', 'notes'];
  for (const k of keys) {
    if ((cur[k] || '') !== (ml[k] || '')) return true;
  }
  if (JSON.stringify(cur.relationships || {}) !== JSON.stringify(ml.relationships || {})) return true;
  if (JSON.stringify(cur.inventory || []) !== JSON.stringify(ml.inventory || [])) return true;
  if (JSON.stringify(cur.custom_fields || {}) !== JSON.stringify(ml.custom_fields || {})) return true;
  return false;
}

function renderStatePanelWorld(container, current, baseline) {
  if (!current) {
    container.innerHTML = '<p class="empty-hint">暂无世界设定</p>';
    return;
  }

  let html = '';
  const fields = [
    ['标题', 'title'], ['类型', 'genre'], ['背景', 'background'],
    ['剧情弧', 'current_arc'],
  ];
  for (const [label, key] of fields) {
    const val = current[key];
    if (!val) continue;
    const changed = baseline && baseline[key] && baseline[key] !== val;
    html += `<div class="ws-world-item">`;
    html += `<div class="ws-world-label">${label}</div>`;
    html += `<div class="ws-world-value${changed ? ' ws-diff' : ''}">${escHtml(val)}</div>`;
    html += '</div>';
  }

  if (current.extra_settings) {
    for (const [k, v] of Object.entries(current.extra_settings)) {
      const blVal = baseline && baseline.extra_settings ? baseline.extra_settings[k] : undefined;
      const changed = baseline && blVal !== undefined && blVal !== v;
      html += `<div class="ws-world-item">`;
      html += `<div class="ws-world-label">${escHtml(k)}</div>`;
      html += `<div class="ws-world-value${changed ? ' ws-diff' : ''}">${escHtml(v)}</div>`;
      html += '</div>';
    }
  }

  container.innerHTML = html || '<p class="empty-hint">暂无世界设定</p>';
}

function renderStatePanelLocations(container, current, baseline) {
  const allNames = new Set([...Object.keys(current || {})]);
  if (baseline) {
    for (const n of Object.keys(baseline)) allNames.add(n);
  }

  if (!allNames.size) {
    container.innerHTML = '<p class="empty-hint">暂无地点</p>';
    return;
  }

  let html = '';
  for (const name of allNames) {
    const cur = (current || {})[name];
    const bl = baseline ? baseline[name] : null;
    const isNew = baseline && cur && !bl;
    const isChanged = baseline && cur && bl && JSON.stringify(cur) !== JSON.stringify(bl);
    const locData = cur || bl;

    const cardClass = (isNew || isChanged) ? 'ws-loc-card ws-changed' : 'ws-loc-card';
    html += `<div class="${cardClass}">`;
    html += `<div class="ws-loc-name">📍 ${escHtml(locData.name)}`;
    if (isNew) html += ' <span class="ws-badge-new">新</span>';
    else if (isChanged) html += ' <span class="ws-badge-updated">已更新</span>';
    html += '</div>';
    if (locData.description) {
      html += `<div class="ws-char-field">${escHtml(locData.description)}</div>`;
    }
    html += '</div>';
  }
  container.innerHTML = html;
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

// ─────────── 清理对话历史 ───────────

async function clearHistory() {
  if (!currentSessionId) return;
  if (!confirm('确定清理当前对话历史？\n\n• 世界观、角色、地点设定保留\n• 文章主线保留\n• 对话历史将被清空')) return;
  try {
    const session = await apiJson(`/api/session/${currentSessionId}/clear-history`, { method: 'POST' });
    renderSession(session);
    showToast('对话历史已清理');
  } catch (e) { showToast('清理失败: ' + e.message); }
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

// ─────────── 文章主线 ───────────

function renderMainlinePanel() {
  const count = currentMainline.length;
  const countEl = $('#mainlineCount');
  countEl.textContent = count > 0 ? count : '';
  countEl.style.display = count > 0 ? '' : 'none';

  const preview = $('#mainlineSummaryPreview');
  if (currentMainlineSummary) {
    preview.textContent = currentMainlineSummary.length > 120
      ? currentMainlineSummary.slice(0, 120) + '...'
      : currentMainlineSummary;
  } else if (count > 0) {
    preview.textContent = `已有 ${count} 段主线内容，概述待生成`;
  } else {
    preview.textContent = '';
  }
}

function toggleMainlineView() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }
  renderMainlineModal();
  openModal('mainlineModal');
}

function renderMainlineModal() {
  // 概述区域
  const summaryEl = $('#mainlineSummaryContent');
  summaryEl.textContent = currentMainlineSummary || '暂无概述';

  // 条目列表
  const countEl = $('#mainlineEntryCount');
  countEl.textContent = currentMainline.length;

  const container = $('#mainlineEntries');
  if (!currentMainline.length) {
    container.innerHTML = '<p class="empty-hint">暂无主线内容，在生成的文本上点击「📌 收入主线」添加</p>';
    return;
  }

  container.innerHTML = currentMainline.map((entry, i) => `
    <div class="mainline-entry" data-entry-id="${entry.entry_id}">
      <div class="mainline-entry-header">
        <span class="mainline-entry-order">第 ${i + 1} 段</span>
        <div class="mainline-entry-actions">
          ${i > 0 ? `<button class="btn-move" onclick="moveMainlineEntry('${entry.entry_id}', -1)" title="上移">↑</button>` : ''}
          ${i < currentMainline.length - 1 ? `<button class="btn-move" onclick="moveMainlineEntry('${entry.entry_id}', 1)" title="下移">↓</button>` : ''}
          <button onclick="removeMainlineEntry('${entry.entry_id}')" title="移除">✕</button>
        </div>
      </div>
      <div class="mainline-entry-text">${escHtml(entry.text)}</div>
      ${entry.note ? `<div class="mainline-entry-note">📝 ${escHtml(entry.note)}</div>` : ''}
    </div>
  `).join('');
}

async function addToMainline(btnEl) {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }

  // 获取该 story-block 中的文本
  const block = btnEl.closest('.story-block');
  const textEl = block.querySelector('.story-text');
  const text = textEl.textContent.trim();
  if (!text) { showToast('没有可收入的文本'); return; }

  btnEl.disabled = true;
  btnEl.textContent = '📌 收入中...';

  try {
    const data = await apiJson(`/api/session/${currentSessionId}/mainline/add`, {
      method: 'POST',
      body: JSON.stringify({
        text,
      }),
    });

    currentMainline = data.mainline || [];
    currentMainlineSummary = data.mainline_summary || '';
    renderMainlinePanel();

    // 收入主线时服务端会更新 mainline 快照，刷新 session 数据
    try {
      const fullSession = await apiJson(`/api/session/${currentSessionId}`);
      _currentSession = fullSession;
      renderWorkspace(fullSession);
    } catch (_) { /* 不影响主流程 */ }

    btnEl.textContent = '✅ 已收入';
    btnEl.classList.add('added');
    showToast('已收入主线');
  } catch (e) {
    showToast('收入主线失败: ' + e.message);
    btnEl.disabled = false;
    btnEl.textContent = '📌 收入主线';
  }
}

async function removeMainlineEntry(entryId) {
  if (!currentSessionId) return;
  if (!confirm('确定从主线中移除此段落？')) return;

  try {
    const data = await apiJson(`/api/session/${currentSessionId}/mainline/${entryId}`, {
      method: 'DELETE',
    });
    currentMainline = data.mainline || [];
    currentMainlineSummary = data.mainline_summary || '';
    renderMainlinePanel();
    renderMainlineModal();
    showToast('已从主线移除');
  } catch (e) {
    showToast('移除失败: ' + e.message);
  }
}

async function moveMainlineEntry(entryId, direction) {
  if (!currentSessionId) return;

  const idx = currentMainline.findIndex(e => e.entry_id === entryId);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= currentMainline.length) return;

  // 交换位置
  const ids = currentMainline.map(e => e.entry_id);
  [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];

  try {
    const data = await apiJson(`/api/session/${currentSessionId}/mainline/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ entry_ids: ids }),
    });
    currentMainline = data.mainline || [];
    currentMainlineSummary = data.mainline_summary || '';
    renderMainlinePanel();
    renderMainlineModal();
  } catch (e) {
    showToast('排序失败: ' + e.message);
  }
}

async function regenerateMainlineSummary() {
  if (!currentSessionId) return;

  const btn = $('#btnRegenerateSummary');
  btn.disabled = true;
  btn.textContent = '⏳ 生成中...';
  startTaskPolling();

  try {
    const data = await apiJson(`/api/session/${currentSessionId}/mainline/regenerate-summary`, {
      method: 'POST',
    });
    currentMainlineSummary = data.mainline_summary || '';
    currentMainline = data.mainline || currentMainline;
    renderMainlinePanel();
    renderMainlineModal();
    showToast('概述已更新');
  } catch (e) {
    showToast('生成概述失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 重新生成';
    stopTaskPolling();
  }
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

// ─────────── AI 任务状态栏 ───────────

function startTaskPolling() {
  if (_taskPollTimer) return;
  _pollActiveTasks(); // 立即执行一次
  _taskPollTimer = setInterval(_pollActiveTasks, 2000);
}

function stopTaskPolling() {
  if (_taskPollTimer) {
    clearInterval(_taskPollTimer);
    _taskPollTimer = null;
  }
  _updateStatusBar(0);
}

async function _pollActiveTasks() {
  try {
    const data = await apiJson('/api/tasks/active');
    _activeTasks = data.active || 0;
    _updateStatusBar(_activeTasks);
  } catch {
    // 轮询失败不影响使用
  }
}

function _updateStatusBar(count) {
  const bar = $('#statusBar');
  const text = $('#statusBarText');
  if (count > 0) {
    text.textContent = `${count} 个 AI 请求正在处理中...`;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

// ─────────── 故事区 Loading 指示器 ───────────

function showStoryLoading() {
  const area = $('#storyArea');
  // 清除欢迎界面
  if (area.querySelector('.story-welcome')) area.innerHTML = '';
  // 移除已有的 loading
  removeStoryLoading();
  // 添加 loading 指示器
  const loader = document.createElement('div');
  loader.className = 'story-loading';
  loader.id = 'storyLoadingIndicator';
  loader.innerHTML = `
    <div class="story-loading-spinner"></div>
    <span class="story-loading-text">AI 正在创作中，请稍候...</span>
  `;
  area.appendChild(loader);
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}

function removeStoryLoading() {
  const el = $('#storyLoadingIndicator');
  if (el) el.remove();
}

// ─────────── 初始化 ───────────

(async function init() {
  initTheme();
  await loadConfig();
  await loadSessions();
})();
