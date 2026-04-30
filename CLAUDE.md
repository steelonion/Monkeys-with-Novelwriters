# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Monkeys-with-Novelwriters（monkeynw）是一个基于 LLM 的交互式 AI 小说写作框架。后端 Python/FastAPI，前端原生 HTML/CSS/JS（无框架），数据以 JSON 文件存储在 `sessions/` 目录。

## 常用命令

```bash
# 开发启动（自动 reload）
python -m monkeynw

# 指定端口 + 调试模式（AI 请求/响应写入 log/）
python -m monkeynw --port 8000 --debug

# 构建 & 发布
make build
make publish

# 数据迁移
python migrate_sessions.py

# 清理构建产物
make clean
```

目前没有正式测试套件，也没有 lint/format 配置。

## 核心架构

### 三层会话模型 (`src/monkeynw/models.py`)

Session 分为三大块，这是理解整个系统的关键：

1. **`info` (SessionInfo)** — 会话元信息：名称、写作配置(SessionConfig)、主线(mainline)、主线概述(summary)、前情概述(prefix)
2. **`mainline_state` (MainlineState)** — 主线状态快照：收入主线时冻结的"正式"角色/世界/地点状态
3. **`workspace` (WorkspaceState)** — 工作区状态：AI 每次生成后实时更新的角色/世界/地点 + 生成历史(history)

主线状态和工作区状态独立管理，可双向同步。主线概述用 MD5 哈希判断是否需要重新生成。

### 后端模块职责

- **`main.py`** — FastAPI 路由层，薄薄一层，只做参数校验和调用下层
- **`ai_service.py`** — 所有 LLM 交互：提示词构建、API 调用、响应解析。使用 `AsyncOpenAI`，通过两个全局单例 `ai_service` 和 `session_manager` 访问
- **`session_manager.py`** — 会话 CRUD、持久化、撤销、主线操作、导出。所有写入操作立即同步到磁盘
- **`models.py`** — Pydantic v2 数据模型，包含所有请求/响应和内部模型

### AI 响应协议

AI 响应使用固定分隔符分为两部分：

```
小说正文内容...
===CHARACTER_STATE_UPDATE===
{"characters": {...}, "world_update": {...}, "locations_update": {...}}
```

- `ai_service.py` 中 `SEPARATOR` 常量定义分隔符
- `parse_ai_response()` 解析响应，执行状态合并
- `custom_fields` 和 `skill_tree` 采用**深度合并**；其他字段采用**覆盖策略**（仅当新值非空时）

### 状态合并策略

- **深度合并**：`custom_fields`、`skill_tree` — 新值合并到已有数据，不删除未提及的键
- **覆盖策略**：其余字段（description、status 等）仅在 AI 返回非空值时才覆盖
- **新角色/地点**：AI 返回的新条目直接创建

### 前端 JS 模块

所有 JS 文件在 `src/monkeynw/frontend/js/`，按功能拆分：`init.js`、`config.js`、`session.js`、`story.js`、`characters.js`、`locations.js`、`workspace.js`、`mainline.js`、`skilltree.js`、`chat.js`、`utils.js`。CSS 变量定义在 `variables.css`，支持亮/暗主题切换。

### 关键设计决策

- **`custom_fields`** — 角色可以拥有任意自定义属性（修为境界、技能等级等），由 `SessionConfig.custom_field_defs` 定义 schema，AI 在生成时自动维护
- **`skill_tree`** — 严格扁平结构（`{skill_points, proficiency, categories, skills}`），禁止嵌套分组。`_normalize_skill_tree()` 可防御性处理 AI 错误输出的嵌套格式
- **主线概述字数** — 使用幂律衰减算法自动计算（短文本 ~25%，长文本 ~5%），下限 800 字，上限 5000 字
- **撤销** — 基于 `HistoryStep` 快照，每一步保存生成后的完整状态，撤销即弹出最后一步并恢复到上一步快照
- **新开章节** — 合并前情概述+主线概述用 LLM 压缩为新前情概述，复制主线状态和配置到新会话

## 代码约定

- 文件名、函数/变量：`snake_case`；类名：`PascalCase`
- 中文注释和文档字符串
- 所有函数参数和返回值使用类型注解（`from __future__ import annotations`）
- 可选类型使用 `Type | None`（Python 3.11+，非 `Optional[Type]`）
- `config.json` 包含 API 密钥，已在 `.gitignore` 中忽略
