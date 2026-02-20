/**
 * Monkeys-with-Novelwriters - 初始化、事件监听
 */

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

// 初始化
(async function init() {
  initTheme();
  await loadConfig();
  await loadSessions();
})();
