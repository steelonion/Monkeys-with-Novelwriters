/**
 * Monkeys-with-Novelwriters - 地点管理（详情、添加、编辑、删除）
 */

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
    const locs = (session.workspace && session.workspace.locations) || {};
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
    if (_currentSession) {
      _currentSession.workspace.locations = (updated.workspace && updated.workspace.locations) || {};
      renderWorkspace(_currentSession);
    }
    showToast(`地点「${name}」已添加`);
    ['#locName','#locDesc','#locParent','#locFeatures','#locConnected','#locNotes'].forEach(s => $(s).value = '');
  } catch (e) { showToast('添加失败: ' + e.message); }
}

// ─────────── 地点状态编辑 ───────────

function openEditLocState(locName, target) {
  if (!currentSessionId || !_currentSession) { showToast('请先选择一个会话'); return; }

  const locs = target === 'mainline'
    ? ((_currentSession.mainline_state && _currentSession.mainline_state.locations) || {})
    : ((_currentSession.workspace && _currentSession.workspace.locations) || {});
  const loc = locName ? locs[locName] : null;
  const isNew = !loc;

  $('#editLocTarget').value = target;
  $('#editLocOrigName').value = locName || '';
  $('#editLocStateName').value = loc ? loc.name : '';
  $('#editLocStateDesc').value = loc ? (loc.description || '') : '';
  $('#editLocStateParent').value = loc ? (loc.parent || '') : '';
  $('#editLocStateFeatures').value = loc && loc.features ? loc.features.join('\n') : '';
  $('#editLocStateConnected').value = loc && loc.connected_to ? loc.connected_to.join('\n') : '';
  $('#editLocStateNotes').value = loc ? (loc.notes || '') : '';

  $('#btnDeleteLoc').style.display = isNew ? 'none' : '';

  const tabLabel = target === 'mainline' ? '主线' : '工作区';
  $('#editLocStateTitle').textContent = isNew
    ? `添加地点（${tabLabel}）`
    : `编辑地点 · ${locName}（${tabLabel}）`;
  openModal('editLocStateModal');
}

async function saveLocState() {
  const target = $('#editLocTarget').value;
  const origName = $('#editLocOrigName').value;
  const newName = $('#editLocStateName').value.trim();
  if (!newName) { showToast('请输入地点名称'); return; }

  const locObj = {
    name: newName,
    description: $('#editLocStateDesc').value.trim(),
    parent: $('#editLocStateParent').value.trim(),
    features: $('#editLocStateFeatures').value.trim().split('\n').filter(Boolean),
    connected_to: $('#editLocStateConnected').value.trim().split('\n').filter(Boolean),
    notes: $('#editLocStateNotes').value.trim(),
  };

  try {
    let locs;
    if (target === 'mainline') {
      locs = { ...((_currentSession.mainline_state && _currentSession.mainline_state.locations) || {}) };
    } else {
      locs = { ...((_currentSession.workspace && _currentSession.workspace.locations) || {}) };
    }
    if (origName && origName !== newName) delete locs[origName];
    locs[newName] = locObj;

    if (target === 'mainline') {
      await apiJson(`/api/session/${currentSessionId}/mainline-state`, {
        method: 'PUT', body: JSON.stringify({ locations: locs }),
      });
    } else {
      await apiJson('/api/session/setting', {
        method: 'PUT', body: JSON.stringify({ session_id: currentSessionId, locations: locs }),
      });
    }

    const updated = await apiJson(`/api/session/${currentSessionId}`);
    _currentSession = updated;
    renderWorkspace(updated);
    closeModal('editLocStateModal');
    showToast(`地点「${newName}」已保存`);
  } catch (e) { showToast('保存失败: ' + e.message); }
}

async function deleteLocFromState() {
  const target = $('#editLocTarget').value;
  const origName = $('#editLocOrigName').value;
  if (!origName) return;
  if (!confirm(`确定删除地点「${origName}」？`)) return;

  try {
    let locs;
    if (target === 'mainline') {
      locs = { ...((_currentSession.mainline_state && _currentSession.mainline_state.locations) || {}) };
    } else {
      locs = { ...((_currentSession.workspace && _currentSession.workspace.locations) || {}) };
    }
    delete locs[origName];

    if (target === 'mainline') {
      await apiJson(`/api/session/${currentSessionId}/mainline-state`, {
        method: 'PUT', body: JSON.stringify({ locations: locs }),
      });
    } else {
      await apiJson('/api/session/setting', {
        method: 'PUT', body: JSON.stringify({ session_id: currentSessionId, locations: locs }),
      });
    }

    const updated = await apiJson(`/api/session/${currentSessionId}`);
    _currentSession = updated;
    renderWorkspace(updated);
    closeModal('editLocStateModal');
    showToast(`地点「${origName}」已删除`);
  } catch (e) { showToast('删除失败: ' + e.message); }
}
