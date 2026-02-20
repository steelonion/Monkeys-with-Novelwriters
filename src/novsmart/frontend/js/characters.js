/**
 * NovSmart - 角色管理（详情、添加、编辑、删除）
 */

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
      <div class="char-detail-item"><div class="char-detail-label">外貌</div><div class="char-detail-value">${escHtml(c.appearance || '暂无')}</div></div>
      <div class="char-detail-item"><div class="char-detail-label">着装</div><div class="char-detail-value">${escHtml(c.outfit || '暂无')}</div></div>
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

  try {
    const session = await apiJson(`/api/session/${currentSessionId}`);
    const chars = session.characters || {};
    chars[name] = {
      name,
      description: $('#charDesc').value.trim(),
      appearance: $('#charAppearance').value.trim(),
      outfit: $('#charOutfit').value.trim(),
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
    if (_currentSession) {
      _currentSession.characters = updated.characters || {};
      renderWorkspace(_currentSession);
    }
    showToast(`角色「${name}」已添加`);
    ['#charName','#charDesc','#charAppearance','#charOutfit','#charPersonality','#charStatus','#charLocation','#charNotes'].forEach(s => $(s).value = '');
  } catch (e) { showToast('添加失败: ' + e.message); }
}

// ─────────── 角色状态编辑 ───────────

function openEditCharState(charName, target) {
  if (!currentSessionId || !_currentSession) { showToast('请先选择一个会话'); return; }

  const chars = target === 'mainline'
    ? (_currentSession.mainline_characters || {})
    : (_currentSession.characters || {});
  const char = charName ? chars[charName] : null;
  const isNew = !char;

  $('#editCharTarget').value = target;
  $('#editCharOrigName').value = charName || '';
  $('#editCharStateName').value = char ? char.name : '';
  $('#editCharStateDesc').value = char ? (char.description || '') : '';
  $('#editCharStateAppearance').value = char ? (char.appearance || '') : '';
  $('#editCharStateOutfit').value = char ? (char.outfit || '') : '';
  $('#editCharStatePersonality').value = char ? (char.personality || '') : '';
  $('#editCharStateStatus').value = char ? (char.status || '') : '';
  $('#editCharStateLocation').value = char ? (char.location || '') : '';
  $('#editCharStateNotes').value = char ? (char.notes || '') : '';

  // 关系
  const relsContainer = $('#editCharRels');
  relsContainer.innerHTML = '';
  if (char && char.relationships) {
    for (const [k, v] of Object.entries(char.relationships)) {
      addEditCharRelRow(k, v);
    }
  }

  // 随身物品
  $('#editCharStateInventory').value = char && char.inventory ? char.inventory.join('、') : '';

  // 自定义字段
  const cfsContainer = $('#editCharCFs');
  cfsContainer.innerHTML = '';
  if (char && char.custom_fields) {
    for (const [k, v] of Object.entries(char.custom_fields)) {
      const valStr = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
      addEditCharCfRow(k, valStr);
    }
  }

  $('#btnDeleteChar').style.display = isNew ? 'none' : '';

  const tabLabel = target === 'mainline' ? '主线' : '工作区';
  $('#editCharStateTitle').textContent = isNew
    ? `添加角色（${tabLabel}）`
    : `编辑角色 · ${charName}（${tabLabel}）`;
  openModal('editCharStateModal');
}

function addEditCharRelRow(name, desc) {
  name = name || '';
  desc = desc || '';
  const container = $('#editCharRels');
  const row = document.createElement('div');
  row.className = 'dynamic-row';
  row.innerHTML = `
    <input type="text" class="rel-name" placeholder="角色名" value="${escHtml(name)}" />
    <input type="text" class="rel-desc" placeholder="关系描述" value="${escHtml(desc)}" />
    <button class="btn btn-sm btn-ghost dynamic-remove" type="button" onclick="this.closest('.dynamic-row').remove()">✕</button>
  `;
  container.appendChild(row);
}

function addEditCharCfRow(key, val) {
  key = key || '';
  val = val || '';
  const container = $('#editCharCFs');
  const row = document.createElement('div');
  row.className = 'dynamic-row';
  row.innerHTML = `
    <input type="text" class="cf-key" placeholder="字段名" value="${escHtml(key)}" />
    <textarea class="cf-val" rows="1" placeholder="值">${escHtml(val)}</textarea>
    <button class="btn btn-sm btn-ghost dynamic-remove" type="button" onclick="this.closest('.dynamic-row').remove()">✕</button>
  `;
  container.appendChild(row);
}

function _getEditCharRelationships() {
  const rels = {};
  document.querySelectorAll('#editCharRels .dynamic-row').forEach(row => {
    const name = row.querySelector('.rel-name').value.trim();
    const desc = row.querySelector('.rel-desc').value.trim();
    if (name) rels[name] = desc;
  });
  return rels;
}

function _getEditCharCustomFields() {
  const cfs = {};
  document.querySelectorAll('#editCharCFs .dynamic-row').forEach(row => {
    const key = row.querySelector('.cf-key').value.trim();
    const val = row.querySelector('.cf-val').value.trim();
    if (!key) return;
    try { cfs[key] = JSON.parse(val); } catch { cfs[key] = val; }
  });
  return cfs;
}

async function saveCharState() {
  const target = $('#editCharTarget').value;
  const origName = $('#editCharOrigName').value;
  const newName = $('#editCharStateName').value.trim();
  if (!newName) { showToast('请输入角色名'); return; }

  const charObj = {
    name: newName,
    description: $('#editCharStateDesc').value.trim(),
    appearance: $('#editCharStateAppearance').value.trim(),
    outfit: $('#editCharStateOutfit').value.trim(),
    personality: $('#editCharStatePersonality').value.trim(),
    status: $('#editCharStateStatus').value.trim(),
    location: $('#editCharStateLocation').value.trim(),
    notes: $('#editCharStateNotes').value.trim(),
    relationships: _getEditCharRelationships(),
    inventory: $('#editCharStateInventory').value.trim().split(/[,，、]/).map(s => s.trim()).filter(Boolean),
    custom_fields: _getEditCharCustomFields(),
  };

  try {
    let chars;
    if (target === 'mainline') {
      chars = { ...(_currentSession.mainline_characters || {}) };
    } else {
      chars = { ...(_currentSession.characters || {}) };
    }
    if (origName && origName !== newName) delete chars[origName];
    chars[newName] = charObj;

    if (target === 'mainline') {
      await apiJson(`/api/session/${currentSessionId}/mainline-state`, {
        method: 'PUT', body: JSON.stringify({ characters: chars }),
      });
    } else {
      await apiJson('/api/session/setting', {
        method: 'PUT', body: JSON.stringify({ session_id: currentSessionId, characters: chars }),
      });
    }

    const updated = await apiJson(`/api/session/${currentSessionId}`);
    _currentSession = updated;
    renderWorkspace(updated);
    closeModal('editCharStateModal');
    showToast(`角色「${newName}」已保存`);
  } catch (e) { showToast('保存失败: ' + e.message); }
}

async function deleteCharFromState() {
  const target = $('#editCharTarget').value;
  const origName = $('#editCharOrigName').value;
  if (!origName) return;
  if (!confirm(`确定删除角色「${origName}」？`)) return;

  try {
    let chars;
    if (target === 'mainline') {
      chars = { ...(_currentSession.mainline_characters || {}) };
    } else {
      chars = { ...(_currentSession.characters || {}) };
    }
    delete chars[origName];

    if (target === 'mainline') {
      await apiJson(`/api/session/${currentSessionId}/mainline-state`, {
        method: 'PUT', body: JSON.stringify({ characters: chars }),
      });
    } else {
      await apiJson('/api/session/setting', {
        method: 'PUT', body: JSON.stringify({ session_id: currentSessionId, characters: chars }),
      });
    }

    const updated = await apiJson(`/api/session/${currentSessionId}`);
    _currentSession = updated;
    renderWorkspace(updated);
    closeModal('editCharStateModal');
    showToast(`角色「${origName}」已删除`);
  } catch (e) { showToast('删除失败: ' + e.message); }
}
