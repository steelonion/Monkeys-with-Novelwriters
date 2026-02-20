/**
 * Monkeys-with-Novelwriters - 故事渲染与生成
 */

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

  if (mode === 'adjust') {
    const area = $('#storyArea');
    if (!area.querySelector('.story-block')) {
      showToast('没有可调整的内容，请先续写'); return;
    }
  }

  const btn = $('#btnGenerate');
  btn.classList.add('loading');
  btn.disabled = true;

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

    removeStoryLoading();

    const area = $('#storyArea');
    if (area.querySelector('.story-welcome')) area.innerHTML = '';

    if (mode === 'adjust') {
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
      const block = document.createElement('div');
      block.className = 'story-block';
      block.innerHTML = `
        <div class="story-prompt">💡 ${escHtml(prompt)}</div>
        <div class="story-text">${escHtml(data.story_text)}</div>
        <div class="story-actions">
          <button class="btn-add-mainline" onclick="addToMainline(this)" title="将此段落收入文章主线">📌 收入主线</button>
        </div>
      `;
      if (area.lastElementChild) {
        const divider = document.createElement('div');
        divider.className = 'story-divider';
        area.appendChild(divider);
      }
      area.appendChild(block);
    }
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });

    if (_currentSession) {
      _currentSession.characters = data.characters || {};
      _currentSession.world_setting = data.world_setting;
      _currentSession.session_config = data.session_config;
      _currentSession.locations = data.locations || {};
      renderWorkspace(_currentSession);
    }

    $('#userPrompt').value = '';
    $('#btnUndo').disabled = false;
    $('#btnClearHistory').disabled = false;
    showToast(mode === 'adjust' ? '调整完成' : '生成完成');

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
