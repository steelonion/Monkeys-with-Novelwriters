/**
 * Monkeys-with-Novelwriters - 右侧状态面板（主线 + 工作区双面板渲染与世界设定编辑）
 */

function switchStateTab(tab) {
  document.querySelectorAll('.state-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tab === 'mainline' ? 'stateTabMainline' : 'stateTabWorkspace').classList.add('active');

  document.querySelectorAll('.state-tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById(tab === 'mainline' ? 'mainlineStatePanel' : 'workspaceStatePanel').classList.add('active');
}

/** 将主线状态同步到工作区状态 */
async function syncMainlineToWorkspace() {
  if (!_currentSession) return;
  if (!confirm('确定将主线状态同步到工作区吗？\n这将用主线的角色、世界设定、地点覆盖当前工作区状态。')) return;
  try {
    const res = await fetch(`${API}/api/session/${_currentSession.session_id}/sync-mainline-to-workspace`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    _currentSession = await res.json();
    renderWorkspace(_currentSession);
    showToast('主线状态已同步到工作区', 'success');
  } catch (e) {
    showToast('同步失败: ' + e.message, 'error');
  }
}

function renderWorkspace(session) {
  const panelEl = $('#statePanel');
  if (!session) { panelEl.style.display = 'none'; return; }

  panelEl.style.display = '';

  const currentChars = session.characters || {};
  const currentWorld = session.world_setting;
  const currentLocs = session.locations || {};

  const mainlineChars = session.mainline_characters || {};
  const mainlineWorld = session.mainline_world_setting || null;
  const mainlineLocs = session.mainline_locations || {};

  // 主线状态面板
  renderStatePanelCharacters($('#mainlineStateCharacters'), mainlineChars, null, 'mainline');
  renderStatePanelWorld($('#mainlineStateWorld'), mainlineWorld, null, 'mainline');
  renderStatePanelLocations($('#mainlineStateLocations'), mainlineLocs, null, 'mainline');

  // 判断差异
  const hasDiff = JSON.stringify(currentChars) !== JSON.stringify(mainlineChars)
    || JSON.stringify(currentWorld) !== JSON.stringify(mainlineWorld)
    || JSON.stringify(currentLocs) !== JSON.stringify(mainlineLocs);

  // 工作区状态面板
  renderStatePanelCharacters($('#workspaceStateCharacters'), currentChars, hasDiff ? mainlineChars : null, 'workspace');
  renderStatePanelWorld($('#workspaceStateWorld'), currentWorld, hasDiff ? mainlineWorld : null, 'workspace');
  renderStatePanelLocations($('#workspaceStateLocations'), currentLocs, hasDiff ? mainlineLocs : null, 'workspace');
}

/**
 * 通用角色渲染：current = 要展示的数据，baseline = 对比基准，target = 'workspace'|'mainline'
 */
function renderStatePanelCharacters(container, current, baseline, target) {
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

    html += `<div class="${cardClass}" data-char-name="${escHtml(charData.name)}" data-target="${target}">`;
    html += `<div class="ws-char-name">${escHtml(charData.name)}${badge}<span class="ws-edit-btn" title="编辑" onclick="event.stopPropagation(); openEditCharState(this.closest('.ws-char-card').dataset.charName, this.closest('.ws-char-card').dataset.target)">✏</span></div>`;

    const fields = [
      ['状态', 'status'], ['位置', 'location'], ['描述', 'description'], ['外貌', 'appearance'], ['着装', 'outfit']
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
  const keys = ['status', 'location', 'description', 'appearance', 'outfit', 'personality', 'notes'];
  for (const k of keys) {
    if ((cur[k] || '') !== (ml[k] || '')) return true;
  }
  if (JSON.stringify(cur.relationships || {}) !== JSON.stringify(ml.relationships || {})) return true;
  if (JSON.stringify(cur.inventory || []) !== JSON.stringify(ml.inventory || [])) return true;
  if (JSON.stringify(cur.custom_fields || {}) !== JSON.stringify(ml.custom_fields || {})) return true;
  return false;
}

function renderStatePanelWorld(container, current, baseline, target) {
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

function renderStatePanelLocations(container, current, baseline, target) {
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
    html += `<div class="${cardClass}" data-loc-name="${escHtml(locData.name)}" data-target="${target}">`;
    html += `<div class="ws-loc-name">📍 ${escHtml(locData.name)}<span class="ws-edit-btn" title="编辑" onclick="event.stopPropagation(); openEditLocState(this.closest('.ws-loc-card').dataset.locName, this.closest('.ws-loc-card').dataset.target)">✏</span>`;
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

// ─────────── 世界设定编辑 ───────────

function openEditWorldState(target) {
  if (!currentSessionId || !_currentSession) { showToast('请先选择一个会话'); return; }

  let ws, sc;
  if (target === 'mainline') {
    ws = _currentSession.mainline_world_setting || {};
    sc = _currentSession.mainline_session_config || {};
  } else {
    ws = _currentSession.world_setting || {};
    sc = _currentSession.session_config || {};
  }

  $('#editWorldTarget').value = target;
  $('#editWorldTitle').value = ws.title || '';
  $('#editWorldGenre').value = ws.genre || '';
  $('#editWorldBackground').value = ws.background || '';
  $('#editWorldArc').value = sc.current_arc || '';

  const container = $('#editWorldExtras');
  container.innerHTML = '';
  if (ws.extra_settings) {
    for (const [k, v] of Object.entries(ws.extra_settings)) {
      addEditWorldExtraRow(k, v);
    }
  }

  const tabLabel = target === 'mainline' ? '主线' : '工作区';
  $('#editWorldStateTitle').textContent = `编辑世界设定（${tabLabel}）`;
  openModal('editWorldStateModal');
}

function addEditWorldExtraRow(key, val) {
  key = key || '';
  val = val || '';
  const container = $('#editWorldExtras');
  const row = document.createElement('div');
  row.className = 'dynamic-row';
  row.innerHTML = `
    <input type="text" class="extra-key" placeholder="设定名" value="${escHtml(key)}" />
    <input type="text" class="extra-val" placeholder="设定值" value="${escHtml(val)}" />
    <button class="btn btn-sm btn-ghost dynamic-remove" type="button" onclick="this.closest('.dynamic-row').remove()">✕</button>
  `;
  container.appendChild(row);
}

async function saveWorldState() {
  const target = $('#editWorldTarget').value;

  const wsObj = {
    title: $('#editWorldTitle').value.trim(),
    genre: $('#editWorldGenre').value.trim(),
    background: $('#editWorldBackground').value.trim(),
    rules: target === 'mainline'
      ? (_currentSession.mainline_world_setting || {}).rules || []
      : (_currentSession.world_setting || {}).rules || [],
    extra_settings: {},
  };
  document.querySelectorAll('#editWorldExtras .dynamic-row').forEach(row => {
    const k = row.querySelector('.extra-key').value.trim();
    const v = row.querySelector('.extra-val').value.trim();
    if (k) wsObj.extra_settings[k] = v;
  });

  const scObj = {
    current_arc: $('#editWorldArc').value.trim(),
    custom_instructions: target === 'mainline'
      ? (_currentSession.mainline_session_config || {}).custom_instructions || ''
      : (_currentSession.session_config || {}).custom_instructions || '',
    custom_field_defs: target === 'mainline'
      ? (_currentSession.mainline_session_config || {}).custom_field_defs || []
      : (_currentSession.session_config || {}).custom_field_defs || [],
  };

  try {
    if (target === 'mainline') {
      await apiJson(`/api/session/${currentSessionId}/mainline-state`, {
        method: 'PUT', body: JSON.stringify({ world_setting: wsObj, session_config: scObj }),
      });
    } else {
      await apiJson('/api/session/setting', {
        method: 'PUT', body: JSON.stringify({ session_id: currentSessionId, world_setting: wsObj, session_config: scObj }),
      });
    }

    const updated = await apiJson(`/api/session/${currentSessionId}`);
    _currentSession = updated;
    renderWorkspace(updated);
    if (target === 'workspace') {
      const sidebarConfig = updated.mainline_session_config || updated.session_config;
      renderSessionConfig(sidebarConfig);
    }
    closeModal('editWorldStateModal');
    showToast('世界设定已保存');
  } catch (e) { showToast('保存失败: ' + e.message); }
}
