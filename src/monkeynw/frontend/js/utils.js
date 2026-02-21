/**
 * Monkeys-with-Novelwriters - 工具函数、全局状态、API 辅助、主题
 */

const API = '';  // 同源，留空即可

// ─────────── 全局状态 ───────────
let currentSessionId = null;
let sessions = [];
let sessionModalMode = 'create'; // 'create' or 'edit'
let currentMainline = [];       // 当前主线数据
let currentMainlineSummary = ''; // 当前主线概述
let currentMainlinePrefix = '';  // 当前主线前情概述（手动插入的上文概述）
let _taskPollTimer = null;       // 任务轮询定时器
let _activeTasks = 0;            // 当前活跃的 AI 任务数
let _currentSession = null;      // 完整的当前会话数据
let _generateMode = 'continue';  // 生成模式: 'continue' | 'adjust'

// ─────────── DOM 辅助 ───────────

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

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────── 主题切换 ───────────

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('monkeynw-theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = localStorage.getItem('monkeynw-theme');
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

// ─────────── API 请求辅助 ───────────

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

// ─────────── AI 任务状态栏 ───────────

function startTaskPolling() {
  if (_taskPollTimer) return;
  _pollActiveTasks();
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
  if (area.querySelector('.story-welcome')) area.innerHTML = '';
  removeStoryLoading();
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
