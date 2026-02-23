/**
 * Monkeys-with-Novelwriters - 技能树面板
 * 
 * skill_tree 数据结构:
 * {
 *   skill_points: number,       // 可用技能点
 *   proficiency: number,         // 可用熟练度
 *   categories: string[],        // 技能分类列表
 *   skills: {
 *     [skill_id]: {
 *       name: string,
 *       description: string,
 *       category: string,
 *       icon: string,
 *       current_level: number,
 *       max_level: number,
 *       levels: [
 *         { level: number, effect: string, cost: { skill_points: number, proficiency: number } }
 *       ],
 *       prerequisites: [ { skill_id: string, level: number } ],
 *       position: { x: number, y: number }    // 在画布上的位置
 *     }
 *   }
 * }
 */

// ─────────── 技能树面板状态 ───────────
let _skillTreeCharName = null;
let _skillTreeTarget = null;  // 'mainline' | 'workspace'
let _skillTreeData = null;
let _skillTreeSelectedSkill = null;
let _skillTreePanZoom = { x: 0, y: 0, scale: 1 };
let _skillTreeDragging = false;
let _skillTreeDragStart = { x: 0, y: 0 };
let _skillTreeCategoryFilter = null; // null = 显示全部

// 技能节点尺寸常量
const SKILL_NODE_W = 120;
const SKILL_NODE_H = 64;
const SKILL_NODE_R = 12;

function _emptySkillTree() {
  return {
    skill_points: 0,
    proficiency: 0,
    categories: [],
    skills: {}
  };
}

// ─────────── 打开技能树面板 ───────────
function openSkillTreePanel(charName, target) {
  if (!currentSessionId || !_currentSession) { showToast('请先选择一个会话'); return; }

  const chars = target === 'mainline'
    ? ((_currentSession.mainline_state && _currentSession.mainline_state.characters) || {})
    : ((_currentSession.workspace && _currentSession.workspace.characters) || {});
  const char = chars[charName];
  if (!char) { showToast('角色不存在'); return; }

  _skillTreeCharName = charName;
  _skillTreeTarget = target;
  _skillTreeData = char.skill_tree && Object.keys(char.skill_tree).length
    ? JSON.parse(JSON.stringify(char.skill_tree))
    : _emptySkillTree();
  _skillTreeSelectedSkill = null;
  _skillTreePanZoom = { x: 0, y: 0, scale: 1 };
  _skillTreeCategoryFilter = null;

  // 确保基本结构
  if (!_skillTreeData.skills) _skillTreeData.skills = {};
  if (!_skillTreeData.categories) _skillTreeData.categories = [];
  if (_skillTreeData.skill_points === undefined) _skillTreeData.skill_points = 0;
  if (_skillTreeData.proficiency === undefined) _skillTreeData.proficiency = 0;

  $('#skillTreeTitle').textContent = `🌳 技能树 · ${charName}`;
  _renderSkillTreeHeader();
  _renderSkillTreeCanvas();
  _renderSkillTreeDetail(null);
  openModal('skillTreeModal');

  // 延迟绑定鼠标事件（需要等 modal 可见后）
  requestAnimationFrame(() => {
    _initSkillTreeCanvasEvents();
  });
}

// ─────────── 头部渲染（技能点/熟练度/分类筛选） ───────────
function _renderSkillTreeHeader() {
  const d = _skillTreeData;
  let catBtns = `<button class="st-cat-btn${!_skillTreeCategoryFilter ? ' active' : ''}" onclick="_filterSkillTreeCategory(null)">全部</button>`;
  for (const cat of (d.categories || [])) {
    catBtns += `<button class="st-cat-btn${_skillTreeCategoryFilter === cat ? ' active' : ''}" onclick="_filterSkillTreeCategory('${escHtml(cat)}')">${escHtml(cat)}</button>`;
  }

  $('#skillTreeHeader').innerHTML = `
    <div class="st-resources">
      <span class="st-res-item" title="可用技能点">⭐ 技能点: <strong>${d.skill_points}</strong></span>
      <span class="st-res-item" title="可用熟练度">🔧 熟练度: <strong>${d.proficiency}</strong></span>
    </div>
    <div class="st-categories">${catBtns}</div>
  `;
}

function _filterSkillTreeCategory(cat) {
  _skillTreeCategoryFilter = cat;
  _renderSkillTreeHeader();
  _renderSkillTreeCanvas();
}

// ─────────── 画布渲染（SVG + 技能节点） ───────────
function _renderSkillTreeCanvas() {
  const container = $('#skillTreeCanvas');
  const skills = _skillTreeData.skills || {};
  const skillIds = Object.keys(skills);

  // 筛选
  const visibleIds = _skillTreeCategoryFilter
    ? skillIds.filter(id => skills[id].category === _skillTreeCategoryFilter)
    : skillIds;

  if (!visibleIds.length) {
    container.innerHTML = '<div class="st-empty">暂无技能，点击下方「+ 添加技能」开始构建技能树</div>';
    return;
  }

  // 计算边界
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of visibleIds) {
    const s = skills[id];
    const pos = s.position || { x: 0, y: 0 };
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x + SKILL_NODE_W > maxX) maxX = pos.x + SKILL_NODE_W;
    if (pos.y + SKILL_NODE_H > maxY) maxY = pos.y + SKILL_NODE_H;
  }
  const pad = 60;
  const svgW = Math.max(maxX - minX + pad * 2, 400);
  const svgH = Math.max(maxY - minY + pad * 2, 300);
  const ofsX = -minX + pad;
  const ofsY = -minY + pad;

  // 构建连线（前置依赖 → 技能）
  let lines = '';
  for (const id of visibleIds) {
    const s = skills[id];
    const prereqs = s.prerequisites || [];
    for (const p of prereqs) {
      const from = skills[p.skill_id];
      if (!from) continue;
      if (_skillTreeCategoryFilter && from.category !== _skillTreeCategoryFilter) continue;
      const fromPos = from.position || { x: 0, y: 0 };
      const toPos = s.position || { x: 0, y: 0 };
      const x1 = fromPos.x + ofsX + SKILL_NODE_W / 2;
      const y1 = fromPos.y + ofsY + SKILL_NODE_H;
      const x2 = toPos.x + ofsX + SKILL_NODE_W / 2;
      const y2 = toPos.y + ofsY;
      const met = from.current_level >= p.level;
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="st-line${met ? ' st-line-met' : ''}" marker-end="url(#arrowhead${met ? 'Met' : ''})"/>`;
    }
  }

  // 构建节点
  let nodes = '';
  for (const id of visibleIds) {
    const s = skills[id];
    const pos = s.position || { x: 0, y: 0 };
    const px = pos.x + ofsX;
    const py = pos.y + ofsY;
    const maxLv = s.max_level || (s.levels ? s.levels.length : 1);
    const curLv = s.current_level || 0;
    const isMaxed = curLv >= maxLv;
    const isUnlocked = curLv > 0;
    const isSel = _skillTreeSelectedSkill === id;
    let cls = 'st-node';
    if (isMaxed) cls += ' st-node-maxed';
    else if (isUnlocked) cls += ' st-node-unlocked';
    if (isSel) cls += ' st-node-selected';

    const lvStr = `${curLv}/${maxLv}`;
    nodes += `
      <g class="${cls}" data-skill-id="${escHtml(id)}" transform="translate(${px},${py})" onclick="_selectSkillNode('${escHtml(id)}')" style="cursor:pointer">
        <rect width="${SKILL_NODE_W}" height="${SKILL_NODE_H}" rx="${SKILL_NODE_R}" ry="${SKILL_NODE_R}" />
        <text x="${SKILL_NODE_W / 2}" y="24" text-anchor="middle" class="st-node-icon">${escHtml(s.icon || '⚡')}</text>
        <text x="${SKILL_NODE_W / 2}" y="42" text-anchor="middle" class="st-node-name">${escHtml(s.name || id)}</text>
        <text x="${SKILL_NODE_W / 2}" y="57" text-anchor="middle" class="st-node-level">${lvStr}</text>
      </g>`;
  }

  const { x: panX, y: panY, scale } = _skillTreePanZoom;
  container.innerHTML = `
    <svg id="skillTreeSvg" width="100%" height="100%" viewBox="0 0 ${svgW} ${svgH}" class="st-svg">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--text-muted)"/>
        </marker>
        <marker id="arrowheadMet" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--accent)"/>
        </marker>
      </defs>
      <g id="skillTreeGroup" transform="translate(${panX},${panY}) scale(${scale})">
        ${lines}
        ${nodes}
      </g>
    </svg>`;
}

function _selectSkillNode(skillId) {
  _skillTreeSelectedSkill = skillId;
  _renderSkillTreeCanvas();
  _renderSkillTreeDetail(skillId);
}

// ─────────── 画布交互（缩放/平移） ───────────
function _initSkillTreeCanvasEvents() {
  const container = $('#skillTreeCanvas');
  if (!container) return;

  container.onwheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    _skillTreePanZoom.scale = Math.min(2, Math.max(0.3, _skillTreePanZoom.scale + delta));
    _renderSkillTreeCanvas();
  };

  container.onmousedown = (e) => {
    if (e.target.closest('.st-node')) return;
    _skillTreeDragging = true;
    _skillTreeDragStart = { x: e.clientX - _skillTreePanZoom.x, y: e.clientY - _skillTreePanZoom.y };
    container.style.cursor = 'grabbing';
  };

  container.onmousemove = (e) => {
    if (!_skillTreeDragging) return;
    _skillTreePanZoom.x = e.clientX - _skillTreeDragStart.x;
    _skillTreePanZoom.y = e.clientY - _skillTreeDragStart.y;
    const g = document.getElementById('skillTreeGroup');
    if (g) g.setAttribute('transform', `translate(${_skillTreePanZoom.x},${_skillTreePanZoom.y}) scale(${_skillTreePanZoom.scale})`);
  };

  container.onmouseup = container.onmouseleave = () => {
    _skillTreeDragging = false;
    container.style.cursor = '';
  };
}

// ─────────── 右侧详情面板 ───────────
function _renderSkillTreeDetail(skillId) {
  const panel = $('#skillTreeDetail');
  if (!skillId || !_skillTreeData.skills[skillId]) {
    panel.innerHTML = '<div class="st-detail-empty">选择一个技能节点查看详情</div>';
    return;
  }

  const s = _skillTreeData.skills[skillId];
  const curLv = s.current_level || 0;
  const maxLv = s.max_level || (s.levels ? s.levels.length : 1);
  const prereqs = s.prerequisites || [];
  const levels = s.levels || [];

  // 前置技能检查
  let prereqHtml = '';
  if (prereqs.length) {
    prereqHtml = '<div class="st-detail-section"><div class="st-detail-section-title">前置要求</div>';
    for (const p of prereqs) {
      const ps = _skillTreeData.skills[p.skill_id];
      const pName = ps ? ps.name : p.skill_id;
      const met = ps && (ps.current_level || 0) >= p.level;
      prereqHtml += `<div class="st-prereq ${met ? 'st-prereq-met' : 'st-prereq-unmet'}">
        ${met ? '✅' : '❌'} ${escHtml(pName)} Lv.${p.level}
      </div>`;
    }
    prereqHtml += '</div>';
  }

  // 等级列表
  let levelsHtml = '<div class="st-detail-section"><div class="st-detail-section-title">等级详情</div>';
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    const lvNum = lv.level || (i + 1);
    const isCurrentNext = lvNum === curLv + 1;
    const isUnlocked = lvNum <= curLv;
    let cls = 'st-level-row';
    if (isUnlocked) cls += ' st-level-unlocked';
    if (isCurrentNext) cls += ' st-level-next';

    const cost = lv.cost || {};
    const costParts = [];
    if (cost.skill_points) costParts.push(`⭐${cost.skill_points}`);
    if (cost.proficiency) costParts.push(`🔧${cost.proficiency}`);
    const costStr = costParts.length ? costParts.join(' + ') : '免费';

    levelsHtml += `
      <div class="${cls}">
        <div class="st-level-header">
          <span class="st-level-num">Lv.${lvNum}</span>
          <span class="st-level-cost">${isUnlocked ? '✅ 已解锁' : costStr}</span>
        </div>
        <div class="st-level-effect">${escHtml(lv.effect || '无效果描述')}</div>
      </div>`;
  }
  levelsHtml += '</div>';

  panel.innerHTML = `
    <div class="st-detail-header">
      <span class="st-detail-icon">${escHtml(s.icon || '⚡')}</span>
      <div>
        <div class="st-detail-name">${escHtml(s.name || skillId)}</div>
        <div class="st-detail-category">${escHtml(s.category || '未分类')}</div>
      </div>
      <span class="st-detail-level">Lv.${curLv}/${maxLv}</span>
    </div>
    <div class="st-detail-desc">${escHtml(s.description || '暂无描述')}</div>
    ${prereqHtml}
    ${levelsHtml}
    <div class="st-detail-actions">
      <button class="btn btn-sm btn-ghost" onclick="_editSkillNode('${escHtml(skillId)}')">✏ 编辑</button>
      <button class="btn btn-sm btn-danger-text" onclick="_deleteSkillNode('${escHtml(skillId)}')">🗑 删除</button>
    </div>
  `;
}

// ─────────── 添加/编辑/删除技能节点 ───────────
function openAddSkillModal() {
  _populateSkillForm(null);
  $('#skillEditModalTitle').textContent = '添加技能';
  openModal('skillEditModal');
}

function _editSkillNode(skillId) {
  const s = _skillTreeData.skills[skillId];
  if (!s) return;
  _populateSkillForm(skillId);
  $('#skillEditModalTitle').textContent = `编辑技能 · ${s.name || skillId}`;
  openModal('skillEditModal');
}

function _populateSkillForm(skillId) {
  const s = skillId ? _skillTreeData.skills[skillId] : null;
  $('#skillEditId').value = skillId || '';
  $('#skillEditName').value = s ? (s.name || '') : '';
  $('#skillEditIcon').value = s ? (s.icon || '') : '';
  $('#skillEditDesc').value = s ? (s.description || '') : '';
  $('#skillEditCategory').value = s ? (s.category || '') : '';
  $('#skillEditCurLevel').value = s ? (s.current_level || 0) : 0;
  $('#skillEditPosX').value = s && s.position ? s.position.x : _autoSkillPosition().x;
  $('#skillEditPosY').value = s && s.position ? s.position.y : _autoSkillPosition().y;

  // 前置技能
  const prereqContainer = $('#skillEditPrereqs');
  prereqContainer.innerHTML = '';
  if (s && s.prerequisites) {
    for (const p of s.prerequisites) {
      _addSkillPrereqRow(p.skill_id, p.level);
    }
  }

  // 等级列表
  const levelsContainer = $('#skillEditLevels');
  levelsContainer.innerHTML = '';
  if (s && s.levels) {
    for (const lv of s.levels) {
      _addSkillLevelRow(lv.level, lv.effect, lv.cost || {});
    }
  }
}

function _autoSkillPosition() {
  const skills = _skillTreeData.skills || {};
  const count = Object.keys(skills).length;
  const cols = 4;
  const gapX = 150;
  const gapY = 100;
  return {
    x: (count % cols) * gapX,
    y: Math.floor(count / cols) * gapY
  };
}

function _addSkillPrereqRow(skillId, level) {
  const container = $('#skillEditPrereqs');
  const allSkills = _skillTreeData.skills || {};
  let options = '';
  for (const [id, s] of Object.entries(allSkills)) {
    options += `<option value="${escHtml(id)}" ${id === skillId ? 'selected' : ''}>${escHtml(s.name || id)}</option>`;
  }
  const row = document.createElement('div');
  row.className = 'dynamic-row';
  row.innerHTML = `
    <select class="prereq-skill">${options}</select>
    <input type="number" class="prereq-level" min="1" value="${level || 1}" placeholder="需要等级" style="width:80px" />
    <button class="btn btn-sm btn-ghost dynamic-remove" type="button" onclick="this.closest('.dynamic-row').remove()">✕</button>
  `;
  container.appendChild(row);
}

function _addSkillLevelRow(level, effect, cost) {
  const container = $('#skillEditLevels');
  const idx = container.children.length + 1;
  const row = document.createElement('div');
  row.className = 'st-level-edit-row';
  row.innerHTML = `
    <div class="st-level-edit-header">
      <span class="st-level-edit-num">Lv.${level || idx}</span>
      <button class="btn btn-sm btn-ghost dynamic-remove" type="button" onclick="this.closest('.st-level-edit-row').remove()">✕</button>
    </div>
    <input type="hidden" class="level-num" value="${level || idx}" />
    <label>效果 <input type="text" class="level-effect" value="${escHtml(effect || '')}" placeholder="该等级的效果描述" /></label>
    <div class="st-level-edit-costs">
      <label>技能点消耗 <input type="number" class="level-cost-sp" min="0" value="${(cost && cost.skill_points) || 0}" /></label>
      <label>熟练度消耗 <input type="number" class="level-cost-prof" min="0" value="${(cost && cost.proficiency) || 0}" /></label>
    </div>
  `;
  container.appendChild(row);
}

function addSkillLevelRowUI() {
  const container = $('#skillEditLevels');
  const nextIdx = container.children.length + 1;
  _addSkillLevelRow(nextIdx, '', {});
}

function addSkillPrereqRowUI() {
  _addSkillPrereqRow('', 1);
}

function saveSkillNode() {
  const origId = $('#skillEditId').value;
  const name = $('#skillEditName').value.trim();
  if (!name) { showToast('请输入技能名称'); return; }

  // 生成技能ID
  const newId = origId || name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_') + '_' + Date.now().toString(36).slice(-4);

  const skill = {
    name,
    icon: $('#skillEditIcon').value.trim() || '⚡',
    description: $('#skillEditDesc').value.trim(),
    category: $('#skillEditCategory').value.trim(),
    current_level: parseInt($('#skillEditCurLevel').value) || 0,
    position: {
      x: parseInt($('#skillEditPosX').value) || 0,
      y: parseInt($('#skillEditPosY').value) || 0
    },
    prerequisites: [],
    levels: []
  };

  // 收集前置技能
  document.querySelectorAll('#skillEditPrereqs .dynamic-row').forEach(row => {
    const sid = row.querySelector('.prereq-skill').value;
    const lv = parseInt(row.querySelector('.prereq-level').value) || 1;
    if (sid) skill.prerequisites.push({ skill_id: sid, level: lv });
  });

  // 收集等级
  document.querySelectorAll('#skillEditLevels .st-level-edit-row').forEach(row => {
    const lvNum = parseInt(row.querySelector('.level-num').value) || 1;
    const effect = row.querySelector('.level-effect').value.trim();
    const sp = parseInt(row.querySelector('.level-cost-sp').value) || 0;
    const prof = parseInt(row.querySelector('.level-cost-prof').value) || 0;
    skill.levels.push({
      level: lvNum,
      effect,
      cost: { skill_points: sp, proficiency: prof }
    });
  });

  skill.max_level = skill.levels.length || 1;

  // 如果改了ID（名称变了），需要删旧的
  if (origId && origId !== newId) {
    delete _skillTreeData.skills[origId];
    // 更新其他技能的前置引用
    for (const [, s] of Object.entries(_skillTreeData.skills)) {
      if (s.prerequisites) {
        for (const p of s.prerequisites) {
          if (p.skill_id === origId) p.skill_id = newId;
        }
      }
    }
  }

  _skillTreeData.skills[origId || newId] = skill;

  // 自动添加新分类
  if (skill.category && !_skillTreeData.categories.includes(skill.category)) {
    _skillTreeData.categories.push(skill.category);
  }

  closeModal('skillEditModal');
  _skillTreeSelectedSkill = origId || newId;
  _renderSkillTreeHeader();
  _renderSkillTreeCanvas();
  _renderSkillTreeDetail(_skillTreeSelectedSkill);
}

function _deleteSkillNode(skillId) {
  if (!confirm(`确定删除技能「${_skillTreeData.skills[skillId]?.name || skillId}」？`)) return;
  delete _skillTreeData.skills[skillId];
  // 清理其他技能的前置引用
  for (const [, s] of Object.entries(_skillTreeData.skills)) {
    if (s.prerequisites) {
      s.prerequisites = s.prerequisites.filter(p => p.skill_id !== skillId);
    }
  }
  _skillTreeSelectedSkill = null;
  _renderSkillTreeCanvas();
  _renderSkillTreeDetail(null);
}

// ─────────── 资源编辑 ───────────
function openEditSkillResources() {
  $('#skillResPoints').value = _skillTreeData.skill_points || 0;
  $('#skillResProf').value = _skillTreeData.proficiency || 0;
  $('#skillResCategories').value = (_skillTreeData.categories || []).join('、');
  openModal('skillResModal');
}

function saveSkillResources() {
  _skillTreeData.skill_points = parseInt($('#skillResPoints').value) || 0;
  _skillTreeData.proficiency = parseInt($('#skillResProf').value) || 0;
  const cats = $('#skillResCategories').value.trim().split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  _skillTreeData.categories = cats;
  closeModal('skillResModal');
  _renderSkillTreeHeader();
}

// ─────────── 保存技能树到角色 ───────────
async function saveSkillTree() {
  if (!_skillTreeCharName || !_currentSession) return;

  try {
    let chars;
    if (_skillTreeTarget === 'mainline') {
      chars = { ...((_currentSession.mainline_state && _currentSession.mainline_state.characters) || {}) };
    } else {
      chars = { ...((_currentSession.workspace && _currentSession.workspace.characters) || {}) };
    }

    const char = chars[_skillTreeCharName];
    if (!char) { showToast('角色不存在'); return; }
    char.skill_tree = JSON.parse(JSON.stringify(_skillTreeData));

    if (_skillTreeTarget === 'mainline') {
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
    closeModal('skillTreeModal');
    showToast(`技能树已保存`);
  } catch (e) {
    showToast('保存失败: ' + e.message);
  }
}
