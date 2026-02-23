/**
 * Monkeys-with-Novelwriters - 自由聊天（创作顾问）
 */

// 聊天状态
let _chatHistory = [];     // [{role, content}]  发送给后端的历史

/**
 * 切换主内容区 Tab（story / chat）
 */
function switchMainTab(tab) {
  const storyBtn = $('#mainTabStory');
  const chatBtn  = $('#mainTabChat');
  const storyTab = $('#storyTabContent');
  const chatTab  = $('#chatTabContent');

  if (tab === 'chat') {
    storyBtn.classList.remove('active');
    chatBtn.classList.add('active');
    storyTab.classList.remove('active');
    chatTab.classList.add('active');
    setTimeout(() => $('#chatInput').focus(), 100);
  } else {
    chatBtn.classList.remove('active');
    storyBtn.classList.add('active');
    chatTab.classList.remove('active');
    storyTab.classList.add('active');
  }
}

function clearChatHistory() {
  _chatHistory = [];
  const container = $('#chatMessages');
  container.innerHTML = `
    <div class="chat-welcome">
      <p>👋 你好！我是你的创作顾问，可以帮你：</p>
      <ul>
        <li>💡 <strong>剧情建议</strong> — 根据你的思路提供后续剧情方向</li>
        <li>📋 <strong>状态提取</strong> — 从前文中提取信息更新角色/世界状态</li>
      </ul>
      <p class="chat-welcome-hint">选择会话后即可开始对话</p>
    </div>`;
}

function handleChatKeydown(e) {
  // Ctrl/Cmd + Enter 发送
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
}

function _appendChatMessage(role, content, stateUpdates) {
  const container = $('#chatMessages');
  // 移除欢迎消息
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${role}`;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  let bubbleHtml = `<div class="chat-msg-bubble">${escHtml(content)}</div>`;

  // 如果有状态更新建议，添加卡片
  if (stateUpdates && role === 'assistant') {
    const updateId = `state_update_${Date.now()}`;
    const summaryLines = _summarizeStateUpdates(stateUpdates);
    bubbleHtml += `
      <div class="chat-state-update-card" id="${updateId}">
        <div class="card-header">
          <span class="card-title">📋 建议的状态更新</span>
          <button class="btn-apply-state" onclick="applyChatStateUpdate('${updateId}')">✓ 应用到工作区</button>
        </div>
        <div class="card-body"><pre>${escHtml(summaryLines)}</pre></div>
      </div>`;
  }

  msgDiv.innerHTML = bubbleHtml + `<span class="chat-msg-time">${timeStr}</span>`;
  container.appendChild(msgDiv);

  // 存储 state_updates 在 DOM 元素上
  if (stateUpdates && role === 'assistant') {
    const card = msgDiv.querySelector('.chat-state-update-card');
    if (card) card._stateUpdates = stateUpdates;
  }

  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function _summarizeStateUpdates(updates) {
  const lines = [];

  if (updates.characters) {
    for (const [name, fields] of Object.entries(updates.characters)) {
      lines.push(`👤 ${name}:`);
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'custom_fields' && typeof v === 'object') {
          for (const [ck, cv] of Object.entries(v)) {
            lines.push(`  ${ck} → ${typeof cv === 'object' ? JSON.stringify(cv) : cv}`);
          }
        } else {
          lines.push(`  ${k} → ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        }
      }
    }
  }

  if (updates.world_update) {
    lines.push(`🌍 世界设定:`);
    for (const [k, v] of Object.entries(updates.world_update)) {
      if (k === 'extra_settings' && typeof v === 'object') {
        for (const [ek, ev] of Object.entries(v)) {
          lines.push(`  ${ek} → ${ev}`);
        }
      } else if (v) {
        lines.push(`  ${k} → ${v}`);
      }
    }
  }

  if (updates.locations_update) {
    for (const [name, fields] of Object.entries(updates.locations_update)) {
      lines.push(`📍 ${name}:`);
      for (const [k, v] of Object.entries(fields)) {
        lines.push(`  ${k} → ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : JSON.stringify(updates, null, 2);
}

function _showChatTyping() {
  const container = $('#chatMessages');
  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.id = 'chatTypingIndicator';
  typing.innerHTML = `
    <div class="chat-typing-dots"><span></span><span></span><span></span></div>
    <span>AI 思考中...</span>`;
  container.appendChild(typing);
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function _removeChatTyping() {
  const el = $('#chatTypingIndicator');
  if (el) el.remove();
}

async function sendChatMessage() {
  if (!currentSessionId) { showToast('请先选择一个会话'); return; }
  const input = $('#chatInput');
  const message = input.value.trim();
  if (!message) return;

  const btn = $('#chatSendBtn');
  btn.disabled = true;
  btn.querySelector('.chat-send-text').style.display = 'none';
  btn.querySelector('.chat-send-loading').style.display = '';
  input.value = '';

  // 显示用户消息
  _appendChatMessage('user', message, null);

  // 显示思考中指示器
  _showChatTyping();
  startTaskPolling();

  try {
    const body = {
      session_id: currentSessionId,
      message: message,
      chat_history: _chatHistory,
      temperature: 0.7,
    };

    const data = await apiJson('/api/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    _removeChatTyping();

    // 更新聊天历史
    _chatHistory.push({ role: 'user', content: message });
    _chatHistory.push({ role: 'assistant', content: data.reply });

    // 限制聊天历史长度（保留最近 20 轮）
    if (_chatHistory.length > 40) {
      _chatHistory = _chatHistory.slice(-40);
    }

    // 显示 AI 回复
    _appendChatMessage('assistant', data.reply, data.state_updates);

  } catch (e) {
    _removeChatTyping();
    _appendChatMessage('assistant', `❌ 请求失败：${e.message}`, null);
  } finally {
    btn.disabled = false;
    btn.querySelector('.chat-send-text').style.display = '';
    btn.querySelector('.chat-send-loading').style.display = 'none';
    stopTaskPolling();
  }
}

async function applyChatStateUpdate(cardId) {
  if (!currentSessionId || !_currentSession) { showToast('请先选择一个会话'); return; }

  const card = document.getElementById(cardId);
  if (!card || !card._stateUpdates) return;

  const updates = card._stateUpdates;
  const btn = card.querySelector('.btn-apply-state');

  // 构建更新请求：合并现有工作区状态与 AI 建议的增量更新
  const session = _currentSession;
  const baseChars = session.characters || {};
  const baseWorld = session.world_setting;
  const baseConfig = session.session_config;
  const baseLocs = session.locations || {};

  let reqBody = {};

  // 处理角色更新
  if (updates.characters) {
    const mergedChars = JSON.parse(JSON.stringify(baseChars));
    for (const [charName, charFields] of Object.entries(updates.characters)) {
      if (!mergedChars[charName]) {
        mergedChars[charName] = { name: charName };
      }
      for (const [field, value] of Object.entries(charFields)) {
        if (field === 'custom_fields' && typeof value === 'object') {
          if (!mergedChars[charName].custom_fields) mergedChars[charName].custom_fields = {};
          Object.assign(mergedChars[charName].custom_fields, value);
        } else {
          mergedChars[charName][field] = value;
        }
      }
    }
    reqBody.characters = mergedChars;
  }

  // 处理世界设定更新
  if (updates.world_update) {
    const mergedConfig = JSON.parse(JSON.stringify(baseConfig));
    const mergedWorld = JSON.parse(JSON.stringify(baseWorld));
    if (updates.world_update.current_arc) {
      mergedConfig.current_arc = updates.world_update.current_arc;
    }
    if (updates.world_update.extra_settings) {
      if (!mergedWorld.extra_settings) mergedWorld.extra_settings = {};
      Object.assign(mergedWorld.extra_settings, updates.world_update.extra_settings);
    }
    reqBody.world_setting = mergedWorld;
    reqBody.session_config = mergedConfig;
  }

  // 处理地点更新
  if (updates.locations_update) {
    const mergedLocs = JSON.parse(JSON.stringify(baseLocs));
    for (const [locName, locFields] of Object.entries(updates.locations_update)) {
      if (!mergedLocs[locName]) {
        mergedLocs[locName] = { name: locName };
      }
      for (const [field, value] of Object.entries(locFields)) {
        mergedLocs[locName][field] = value;
      }
    }
    reqBody.locations = mergedLocs;
  }

  if (Object.keys(reqBody).length === 0) {
    showToast('没有可应用的更新');
    return;
  }

  btn.disabled = true;
  btn.textContent = '应用中...';

  try {
    const data = await apiJson('/api/session/setting', {
      method: 'PUT',
      body: JSON.stringify({ session_id: currentSessionId, ...reqBody }),
    });

    _currentSession = data;
    renderWorkspace(_currentSession);

    btn.textContent = '✓ 已应用到工作区';
    btn.classList.add('applied');
    showToast('状态更新已应用到工作区');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '✓ 应用到工作区';
    showToast('应用失败: ' + e.message);
  }
}
