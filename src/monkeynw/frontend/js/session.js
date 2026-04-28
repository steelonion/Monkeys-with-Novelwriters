/**
 * MonkeyNW - 会话管理（列表、新建、编辑、删除、渲染）
 */

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
      summary_max_length: parseInt($('#newSummaryMaxLength').value) || 800,
      summary_auto_length: $('#newSummaryAutoLength').checked,
      skill_tree_enabled: $('#newSkillTreeEnabled').checked,
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
  $('#newSummaryMaxLength').value = 800;
  $('#newSummaryAutoLength').checked = true;
  $('#newSkillTreeEnabled').checked = true;
  toggleSummaryAutoMode();
  $('#smartParseStatus').style.display = 'none';
  $('#customFieldDefsList').innerHTML = '';
}

// ─────────── 编辑会话设定 ───────────

async function openEditSessionModal() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }

  try {
    const session = await apiJson(`/api/session/${currentSessionId}`);
    sessionModalMode = 'edit';

    const ws = (session.workspace && session.workspace.world_setting) || {};
    const sc = (session.info && session.info.session_config) || {};
    $('#newSessionName').value = (session.info && session.info.name) || '';
    $('#newTitle').value = ws.title || '';
    $('#newGenre').value = ws.genre || '';
    $('#newBackground').value = ws.background || '';
    $('#newRules').value = (ws.rules || []).join('\n');
    $('#newArc').value = sc.current_arc || '';
    $('#newInstructions').value = sc.custom_instructions || '';
    $('#newSummaryMaxLength').value = sc.summary_max_length || 800;
    $('#newSummaryAutoLength').checked = sc.summary_auto_length !== false;
    $('#newSkillTreeEnabled').checked = sc.skill_tree_enabled !== false;
    toggleSummaryAutoMode();

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
  // 保留现有 extra_settings，避免保存时丢失
  const existingWs = (_currentSession && _currentSession.workspace && _currentSession.workspace.world_setting) || {};
  const ws = {
    title: $('#newTitle').value.trim(),
    genre: $('#newGenre').value.trim(),
    background: $('#newBackground').value.trim(),
    rules: $('#newRules').value.trim().split('\n').filter(Boolean),
    extra_settings: existingWs.extra_settings || {},
  };
  const sc = {
    current_arc: $('#newArc').value.trim(),
    custom_instructions: $('#newInstructions').value.trim(),
    custom_field_defs: getCustomFieldDefs(),
    summary_max_length: parseInt($('#newSummaryMaxLength').value) || 800,
    summary_auto_length: $('#newSummaryAutoLength').checked,
    skill_tree_enabled: $('#newSkillTreeEnabled').checked,
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

  $('#sessionTitle').textContent = (session.info && session.info.name) || '未命名会话';
  $('#inputArea').style.display = '';
  $('#mainTabBar').style.display = '';
  const history = (session.workspace && session.workspace.history) || [];
  $('#btnUndo').disabled = history.length === 0;
  $('#btnClearHistory').disabled = history.length === 0;
  $('#btnNewChapter').disabled = false;
  $('#btnBackup').disabled = false;

  // 切换到写作 Tab & 清理聊天历史
  switchMainTab('story');
  clearChatHistory();

  // 写作配置面板
  const sidebarConfig = (session.info && session.info.session_config) || {};
  $('#sessionConfigPanel').style.display = '';
  renderSessionConfig(sidebarConfig);

  // 主线面板
  $('#mainlinePanel').style.display = '';
  currentMainline = (session.info && session.info.mainline) || [];
  currentMainlineSummary = (session.info && session.info.mainline_summary) || '';
  currentMainlinePrefix = (session.info && session.info.mainline_prefix) || '';
  renderMainlinePanel();

  // 故事区
  renderStory(history);

  // 右侧工作区
  renderWorkspace(session);
}

function showWelcome() {
  _currentSession = null;
  $('#sessionTitle').textContent = '请选择或创建一个会话';
  $('#inputArea').style.display = 'none';
  $('#mainTabBar').style.display = 'none';
  $('#sessionConfigPanel').style.display = 'none';
  $('#mainlinePanel').style.display = 'none';
  $('#btnUndo').disabled = true;
  $('#btnClearHistory').disabled = true;
  $('#btnNewChapter').disabled = true;
  $('#btnBackup').disabled = true;
  currentMainline = [];
  currentMainlineSummary = '';
  currentMainlinePrefix = '';
  $('#statePanel').style.display = 'none';
  // 确保回到写作 Tab
  switchMainTab('story');
  clearChatHistory();
  $('#storyArea').innerHTML = `
    <div class="story-welcome">
      <div class="welcome-icon">✨</div>
      <h2>欢迎使用 MonkeyNW</h2>
      <p>创建一个新会话，设定你的世界观和角色，然后开始你的创作之旅。</p>
    </div>`;
}

// ─────────── 撤销 / 清理 ───────────

async function undoStep() {
  if (!currentSessionId) return;
  try {
    const session = await apiJson(`/api/session/${currentSessionId}/undo`, { method: 'POST' });
    renderSession(session);
    showToast('已撤销');
  } catch (e) { showToast('撤销失败: ' + e.message); }
}

async function clearHistory() {
  if (!currentSessionId) return;
  if (!confirm('确定清理当前对话历史？\n\n• 世界观、角色、地点设定保留\n• 文章主线保留\n• 对话历史将被清空')) return;
  try {
    const session = await apiJson(`/api/session/${currentSessionId}/clear-history`, { method: 'POST' });
    renderSession(session);
    showToast('对话历史已清理');
  } catch (e) { showToast('清理失败: ' + e.message); }
}

async function backupSession() {
  if (!currentSessionId) return;
  try {
    const result = await apiJson(`/api/session/${currentSessionId}/backup`, { method: 'POST' });
    showToast('备份成功: ' + result.filepath);
  } catch (e) { showToast('备份失败: ' + e.message); }
}

// ─────────── 写作配置渲染 ───────────

function renderSessionConfig(sc) {
  if (!sc) { $('#sessionConfigInfo').innerHTML = ''; return; }
  const summaryLenText = sc.summary_auto_length !== false
    ? '自动（当前 ' + computeAutoSummaryLength() + ' 字）'
    : (sc.summary_max_length || 800) + ' 字';
  const skillTreeStatus = sc.skill_tree_enabled !== false ? '已启用' : '已关闭';
  const fields = [
    ['剧情弧', sc.current_arc],
    ['写作风格', sc.custom_instructions],
    ['概述字数', summaryLenText],
    ['技能树', skillTreeStatus],
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

// ─────────── 概述字数自动模式 ───────────

/**
 * 前端复刻后端 compute_auto_summary_length 算法。
 * 幂律衰减摘要比例：短文本 ~25%，长文本 ~5%，下限 800，上限 5000。
 */
function computeAutoSummaryLength() {
  const totalChars = (currentMainline || []).reduce((sum, e) => sum + (e.text || '').length, 0);
  if (totalChars <= 0) return 800;
  const ratio = totalChars > 3000
    ? 0.25 * Math.pow(3000 / totalChars, 0.4)
    : 0.25;
  let target = Math.round(totalChars * ratio / 100) * 100;
  return Math.max(800, Math.min(5000, target));
}

function toggleSummaryAutoMode() {
  const auto = $('#newSummaryAutoLength').checked;
  const input = $('#newSummaryMaxLength');
  const hint = $('#summaryAutoHint');
  input.disabled = auto;
  if (auto) {
    const computed = computeAutoSummaryLength();
    input.value = computed;
    hint.textContent = `当前主线 → ${computed} 字`;
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }
}

// ─────────── 新开章节 ───────────

function startNewChapter() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }
  // 重置 modal 状态
  $('#newChapterName').value = '';
  const statusEl = $('#newChapterStatus');
  statusEl.style.display = 'none';
  statusEl.textContent = '';
  openModal('newChapterModal');
}

async function confirmNewChapter() {
  if (!currentSessionId) return;

  const name = $('#newChapterName').value.trim() || null;
  const btn = $('#btnConfirmNewChapter');
  const statusEl = $('#newChapterStatus');

  btn.disabled = true;
  btn.textContent = '⏳ 创建中...';
  statusEl.className = 'status-badge';
  statusEl.style.display = 'none';
  startTaskPolling();

  try {
    const newSession = await apiJson(`/api/session/${currentSessionId}/new-chapter`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    closeModal('newChapterModal');
    showToast('新章节创建成功');
    await loadSessions();
    selectSession(newSession.session_id);
  } catch (e) {
    statusEl.className = 'status-badge error';
    statusEl.textContent = '创建失败: ' + e.message;
    statusEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '📖 确认新开章节';
    stopTaskPolling();
  }
}
