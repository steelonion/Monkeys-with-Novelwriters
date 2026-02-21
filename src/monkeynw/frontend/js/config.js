/**
 * Monkeys-with-Novelwriters - API 配置管理
 */

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
