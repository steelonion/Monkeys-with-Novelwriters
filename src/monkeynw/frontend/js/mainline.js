/**
 * Monkeys-with-Novelwriters - 文章主线管理
 */

async function exportMainline() {
  if (!currentSessionId) return;
  if (!currentMainline || currentMainline.length === 0) {
    showToast('主线暂无内容'); return;
  }
  try {
    const res = await apiFetch(`/api/session/${currentSessionId}/mainline/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mainline.txt';
    a.click();
    URL.revokeObjectURL(url);
    showToast('主线导出成功');
  } catch (e) { showToast('导出失败: ' + e.message); }
}

function getMainlineTotalWords() {
  return currentMainline.reduce((sum, e) => sum + e.text.length, 0);
}

function renderMainlinePanel() {
  const count = currentMainline.length;
  const totalWords = getMainlineTotalWords();
  const countEl = $('#mainlineCount');
  countEl.textContent = count > 0 ? count : '';
  countEl.style.display = count > 0 ? '' : 'none';

  const wordsEl = $('#mainlineTotalWords');
  if (wordsEl) {
    wordsEl.textContent = totalWords > 0 ? `${totalWords} 字` : '';
    wordsEl.style.display = totalWords > 0 ? '' : 'none';
  }

  const preview = $('#mainlineSummaryPreview');
  if (currentMainlinePrefix) {
    const prefixHint = '[前情概述已设置] ';
    const summaryText = currentMainlineSummary || '';
    const combined = prefixHint + summaryText;
    preview.textContent = combined.length > 120
      ? combined.slice(0, 120) + '...'
      : combined;
  } else if (currentMainlineSummary) {
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
  // 前情概述
  const prefixTextarea = $('#mainlinePrefixTextarea');
  if (prefixTextarea) {
    prefixTextarea.value = currentMainlinePrefix || '';
    updatePrefixCharCount();
  }

  const summaryEl = $('#mainlineSummaryContent');
  summaryEl.textContent = currentMainlineSummary || '暂无概述';

  const countEl = $('#mainlineEntryCount');
  countEl.textContent = currentMainline.length;

  const modalWordsEl = $('#mainlineModalTotalWords');
  if (modalWordsEl) {
    modalWordsEl.textContent = getMainlineTotalWords();
  }

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
          <button class="btn-edit" onclick="startEditMainlineEntry('${entry.entry_id}')" title="编辑">✏</button>
          <button onclick="removeMainlineEntry('${entry.entry_id}')" title="移除">✕</button>
        </div>
      </div>
      <div class="mainline-entry-text" id="ml-text-${entry.entry_id}">${escHtml(entry.text)}</div>
      <div class="mainline-entry-note" id="ml-note-${entry.entry_id}" style="${entry.note ? '' : 'display:none'}">${entry.note ? '📝 ' + escHtml(entry.note) : ''}</div>
      <div class="mainline-entry-edit-area" id="ml-edit-${entry.entry_id}" style="display:none"></div>
    </div>
  `).join('');
}

async function addToMainline(btnEl) {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }

  const block = btnEl.closest('.story-block');
  const textEl = block.querySelector('.story-text');
  const text = textEl.textContent.trim();
  if (!text) { showToast('没有可收入的文本'); return; }

  btnEl.disabled = true;
  btnEl.textContent = '📌 收入中...';

  try {
    const data = await apiJson(`/api/session/${currentSessionId}/mainline/add`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    currentMainline = data.mainline || [];
    currentMainlineSummary = data.mainline_summary || '';
    renderMainlinePanel();

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

// ─────────── 主线编辑 ───────────

function startEditMainlineEntry(entryId) {
  const entry = currentMainline.find(e => e.entry_id === entryId);
  if (!entry) return;

  // 隐藏显示区，显示编辑区
  $(`#ml-text-${entryId}`).style.display = 'none';
  $(`#ml-note-${entryId}`).style.display = 'none';

  const editArea = $(`#ml-edit-${entryId}`);
  editArea.innerHTML = `
    <textarea class="mainline-entry-edit-textarea" id="ml-edit-textarea-${entryId}">${escHtml(entry.text)}</textarea>
    <input type="text" class="mainline-entry-edit-note" id="ml-edit-note-${entryId}" placeholder="备注（可选）" value="${escHtml(entry.note || '')}" />
    <div class="mainline-entry-edit-actions">
      <button class="btn-save-entry" onclick="saveMainlineEntry('${entryId}')">💾 保存</button>
      <button class="btn-cancel-entry" onclick="cancelEditMainlineEntry('${entryId}')">取消</button>
    </div>
  `;
  editArea.style.display = '';

  // 自动聚焦并调整高度
  const textarea = $(`#ml-edit-textarea-${entryId}`);
  textarea.focus();
  textarea.style.height = 'auto';
  textarea.style.height = Math.max(textarea.scrollHeight, 120) + 'px';
}

function cancelEditMainlineEntry(entryId) {
  $(`#ml-edit-${entryId}`).style.display = 'none';
  $(`#ml-text-${entryId}`).style.display = '';
  const noteEl = $(`#ml-note-${entryId}`);
  const entry = currentMainline.find(e => e.entry_id === entryId);
  if (entry && entry.note) {
    noteEl.style.display = '';
  } else {
    noteEl.style.display = 'none';
  }
}

async function saveMainlineEntry(entryId) {
  if (!currentSessionId) return;

  const textarea = $(`#ml-edit-textarea-${entryId}`);
  const noteInput = $(`#ml-edit-note-${entryId}`);
  const newText = textarea.value.trim();
  if (!newText) { showToast('段落内容不能为空'); return; }
  const newNote = noteInput.value.trim();

  const saveBtn = document.querySelector(`#ml-edit-${entryId} .btn-save-entry`);
  const cancelBtn = document.querySelector(`#ml-edit-${entryId} .btn-cancel-entry`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ 保存中，正在重新生成概述...'; }
  if (cancelBtn) cancelBtn.disabled = true;
  startTaskPolling();

  try {
    const data = await apiJson(`/api/session/${currentSessionId}/mainline/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify({ text: newText, note: newNote }),
    });

    currentMainline = data.mainline || [];
    currentMainlineSummary = data.mainline_summary || '';
    renderMainlinePanel();
    renderMainlineModal();
    showToast('段落已保存');
  } catch (e) {
    showToast('保存失败: ' + e.message);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 保存'; }
    if (cancelBtn) cancelBtn.disabled = false;
  } finally {
    stopTaskPolling();
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

// ─────────── 前情概述（手动插入的上文概述） ───────────

function updatePrefixCharCount() {
  const textarea = $('#mainlinePrefixTextarea');
  const countEl = $('#mainlinePrefixCharCount');
  if (textarea && countEl) {
    const len = (textarea.value || '').length;
    countEl.textContent = len > 0 ? `${len} 字` : '';
  }
}

async function saveMainlinePrefix() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }

  const textarea = $('#mainlinePrefixTextarea');
  const prefix = textarea ? textarea.value.trim() : '';
  const btn = $('#btnSavePrefix');

  btn.disabled = true;
  btn.textContent = '💾 保存中...';

  try {
    await apiJson(`/api/session/${currentSessionId}/mainline/prefix`, {
      method: 'PUT',
      body: JSON.stringify({ prefix }),
    });
    currentMainlinePrefix = prefix;
    renderMainlinePanel();
    showToast('前情概述已保存');
  } catch (e) {
    showToast('保存失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 保存';
  }
}

// 绑定字数统计事件
document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('mainlinePrefixTextarea');
  if (textarea) {
    textarea.addEventListener('input', updatePrefixCharCount);
  }
});
