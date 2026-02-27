# AGENTS.md - AI Coding Agent Guide

> This guide is for AI coding agents working on the Monkeys-with-Novelwriters project.
> 本文档主要使用中文编写，与项目代码和注释的语言保持一致。

## 项目概述

**Monkeys-with-Novelwriters**（简称 monkeynw）是一个基于大语言模型的交互式 AI 小说写作框架。它通过对话式交互引导大语言模型生成高质量的小说片段，同时自动维护角色状态、世界设定和地点信息的一致性。

### 核心功能

- **智能续写与调整**：根据剧情提示续写小说，支持续写和调整两种模式
- **文章主线系统**：将满意的片段收入主线，自动生成主线概述作为 AI 的上文记忆
- **世界观管理**：角色、地点、世界设定的完整管理，支持自定义字段
- **双层状态管理**：主线状态（正式）与工作区状态（草稿）分离管理
- **智能解析**：粘贴自由格式设定文本，AI 自动提取结构化信息创建会话
- **历史管理**：支持撤销和清理对话历史

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Python 3.11+ / FastAPI / Uvicorn |
| AI 接口 | OpenAI Python SDK（兼容任何 OpenAI API 格式） |
| 数据验证 | Pydantic v2 |
| 前端 | 原生 HTML / CSS / JavaScript（无框架依赖） |
| 持久化 | JSON 文件存储 |

## 项目结构

```
monkeynw/
├── pyproject.toml              # Python 项目配置
├── requirements.txt            # 依赖列表
├── config.json                 # 运行时生成：API 配置（包含密钥，请勿提交）
├── migrate_sessions.py         # 会话数据迁移脚本
├── sessions/                   # 运行时数据：会话持久化存储
├── exports/                    # 运行时数据：主线导出的 TXT 文件
├── log/                        # 运行时数据：调试模式下的 AI 请求/响应日志
└── src/monkeynw/               # 主代码目录
    ├── __init__.py             # 包初始化
    ├── __main__.py             # CLI 入口：python -m monkeynw
    ├── main.py                 # FastAPI 应用主入口，定义所有路由
    ├── models.py               # Pydantic 数据模型定义
    ├── ai_service.py           # AI 服务层：提示词构建、API 调用、输出解析
    ├── session_manager.py      # 会话管理器：CRUD、撤销、主线、导出
    └── frontend/               # 前端静态资源
        ├── index.html          # 主页面
        ├── css/                # 样式文件
        │   ├── variables.css   # CSS 变量（主题色）
        │   ├── main-content.css
        │   ├── sidebar.css
        │   ├── state-panel.css
        │   ├── mainline.css
        │   ├── chat.css
        │   ├── skilltree.css
        │   └── components.css
        └── js/                 # JavaScript 模块
            ├── init.js         # 初始化
            ├── config.js       # API 配置管理
            ├── session.js      # 会话管理
            ├── story.js        # 故事生成/显示
            ├── characters.js   # 角色管理
            ├── locations.js    # 地点管理
            ├── workspace.js    # 工作区状态管理
            ├── mainline.js     # 主线管理
            ├── skilltree.js    # 技能树渲染
            ├── chat.js         # 自由聊天
            └── utils.js        # 工具函数
```

## 核心数据模型

### 三层会话结构

Session 是会话的核心模型，分为三大块：

1. **info (SessionInfo)**：会话自身信息与配置
   - name: 会话名称
   - session_config: 写作配置（剧情弧、风格要求、自定义字段定义）
   - mainline: 文章主线条目列表
   - mainline_summary: 主线内容的 LLM 概述
   - mainline_prefix: 手动插入的前情概述

2. **mainline_state (MainlineState)**：主线状态快照（收入主线时冻结的"正式"状态）
   - characters: 角色状态字典
   - world_setting: 世界设定
   - locations: 地点设定

3. **workspace (WorkspaceState)**：工作区状态（续写/草稿用）
   - characters: 角色状态字典（实时更新）
   - world_setting: 世界设定（实时更新）
   - locations: 地点设定（实时更新）
   - history: 生成历史（支持撤销）

### 关键模型

- **CharacterState**：角色状态，包含基础字段和自定义字段（custom_fields）、技能树（skill_tree）
- **WorldSetting**：世界观设定（标题、类型、背景、规则）
- **LocationSetting**：地点设定（名称、描述、父级、特征、连通关系）
- **HistoryStep**：一次生成的完整记录，包含所有状态快照（用于撤销）
- **MainlineEntry**：文章主线中的一个条目

## 启动和运行

### 环境要求

- Python ≥ 3.11

### 安装依赖

```bash
pip install -r requirements.txt
```

### 启动命令

```bash
# 默认启动（监听 0.0.0.0:8000）
python -m monkeynw

# 指定端口和地址
python -m monkeynw --host 0.0.0.0 --port 8000

# 启用调试模式（记录所有 AI 请求/响应到 log/ 目录）
python -m monkeynw --debug
```

访问 http://localhost:8000 即可使用 Web UI。

## 代码规范与约定

### 命名规范

- 文件名：蛇形命名法（snake_case）
- 类名：大驼峰命名法（PascalCase）
- 函数/变量：蛇形命名法（snake_case）
- 常量：全大写蛇形命名法（UPPER_SNAKE_CASE）

### 注释规范

- 模块顶部使用 `"""文档字符串"""` 说明模块职责
- 类和函数使用文档字符串说明用途
- 关键逻辑使用行内注释
- 使用中文注释，与项目现有风格保持一致

### 类型注解

- 所有函数参数和返回值都应使用类型注解
- 使用 `from __future__ import annotations` 支持前向引用
- 可选类型使用 `Type | None` 形式（Python 3.11+）

### 代码组织原则

1. **单一职责**：每个模块/类负责明确的职责
   - `models.py`：只定义数据模型
   - `ai_service.py`：只处理 AI 相关逻辑
   - `session_manager.py`：只处理会话持久化

2. **状态管理**：
   - 工作区状态用于探索性写作（可频繁修改）
   - 主线状态代表已确认的正式状态
   - 历史记录支持撤销到任意步骤

3. **AI 提示词模板**：
   - 提示词模板使用大写的模块级常量
   - 使用 `str.format()` 进行变量插值
   - 在 `ai_service.py` 中集中管理

## 关键实现细节

### 提示词分隔符

AI 响应需要分为两部分，使用固定分隔符：

```
===CHARACTER_STATE_UPDATE===
```

分隔符前是小说正文，后是 JSON 格式的状态更新。

### 技能树格式

技能树（skill_tree）严格要求扁平结构：

```python
{
  "skill_points": 10,
  "proficiency": 50,
  "categories": ["战斗", "生存", "魔法"],
  "skills": {
    "skill_id": {
      "name": "技能名",
      "category": "战斗",
      "current_level": 1,
      "max_level": 3,
      "levels": [...],
      "prerequisites": [...]
    }
  }
}
```

**禁止**使用 `tree_branches`、`branches`、`groups` 等嵌套分组结构。

### 主线概述字数计算

使用幂律衰减算法自动计算概述字数：
- 短文本（≤3000字）：~25%
- 中等文本（~10000字）：~15%
- 长文本（~30000字）：~10%
- 超长文本（~80000字）：~6%
- 极长文本（>100000字）：~5%
- 下限 800 字，上限 5000 字

### 状态更新合并策略

- `custom_fields` 和 `skill_tree` 采用深度合并
- 其他字段采用覆盖策略（仅当新值非空时）
- 新角色直接创建，已有角色按上述策略合并

## 测试策略

**当前状态**：项目尚未建立正式的测试套件。

### 手动测试要点

1. **会话 CRUD**：创建、读取、更新、删除会话
2. **生成流程**：续写模式、调整模式、温度/长度调节
3. **主线管理**：添加、删除、排序、导出主线条目
4. **状态同步**：主线与工作区状态的双向同步
5. **撤销功能**：单次撤销、多次撤销边界
6. **智能解析**：粘贴设定文本创建会话
7. **自由聊天**：剧情讨论、状态更新建议

### 添加测试的建议

推荐使用 `pytest` 作为测试框架：

```python
# 示例：测试会话管理
async def test_create_session():
    session = session_manager.create_session(name="测试会话")
    assert session.info.name == "测试会话"
    assert session.session_id is not None
```

## 安全注意事项

1. **API 密钥保护**
   - `config.json` 包含 API 密钥，已添加到 `.gitignore`
   - 请勿将包含真实密钥的 `config.json` 提交到版本控制
   - 生产环境部署时考虑使用环境变量替代文件存储

2. **文件路径安全**
   - 所有文件操作使用 `pathlib.Path`
   - 会话文件名基于 session_id（随机生成），避免路径遍历
   - 导出文件时对会话名进行清理（替换 `/` 和 `\`）

3. **CORS 配置**
   - 当前配置允许所有来源（`allow_origins=["*"]`）
   - 生产环境应根据实际部署情况收紧 CORS 策略

## 调试与日志

### 调试模式

启动时添加 `--debug` 参数启用：
- 所有 AI 请求和响应记录到 `log/` 目录
- 文件名格式：`{timestamp}_{label}.json`
- 包含完整的请求消息和响应文本

### 日志格式

```json
{
  "timestamp": "2024-01-01T12:00:00",
  "label": "generate",
  "request_messages": [...],
  "response_text": "...",
  "model": "gpt-4o",
  "temperature": 0.85
}
```

## 数据迁移

当会话数据结构发生变化时，使用 `migrate_sessions.py` 迁移旧数据：

```bash
# 默认处理 ./sessions/ 目录
python migrate_sessions.py

# 指定目录
python migrate_sessions.py /path/to/sessions
```

迁移脚本会自动备份旧文件到 `sessions_backup/` 目录。

## 常见开发任务

### 添加新的 API 端点

1. 在 `models.py` 中定义请求/响应模型（继承 `BaseModel`）
2. 在 `main.py` 中添加路由处理函数
3. 如需 AI 功能，在 `ai_service.py` 中实现核心逻辑
4. 如需持久化，在 `session_manager.py` 中添加相应方法

### 修改数据模型

1. 更新 `models.py` 中的模型定义
2. 运行 `migrate_sessions.py` 迁移现有会话数据
3. 更新前端相关的 JavaScript 代码（如有）

### 修改前端样式

1. CSS 文件位于 `frontend/css/`
2. 使用 CSS 变量定义主题色（`variables.css`）
3. 支持亮色/暗色主题切换

### 添加新的 AI 功能

1. 在 `ai_service.py` 中添加提示词模板
2. 实现解析函数处理 AI 响应
3. 在 `main.py` 中添加对应的 API 端点
4. 在 `session_manager.py` 中添加状态更新逻辑

## 性能考虑

1. **AI 请求并发**：使用 `_active_tasks` 计数器跟踪活跃请求
2. **文件 I/O**：每次状态变更立即写入磁盘，保证数据安全
3. **JSON 序列化**：使用 Pydantic 的 `model_dump_json()` 方法
4. **前端渲染**：技能树使用虚拟布局算法，避免大数据量时性能问题

## 扩展建议

1. **数据库支持**：当前使用 JSON 文件存储，可考虑添加 SQLite/PostgreSQL 支持
2. **用户认证**：当前无用户系统，多用户部署时需要添加
3. **协作编辑**：主线锁定机制支持多用户协作场景
4. **模型支持**：当前仅支持文本模型，可考虑添加多模态支持

---

*最后更新：2026-02-27*
