"""
会话管理器 - 负责会话的创建、保存、加载、撤销、导出
"""

from __future__ import annotations
import copy
import json
import os
import hashlib
from datetime import datetime
from pathlib import Path
from .models import Session, HistoryStep, WorldSetting, SessionConfig, CharacterState, LocationSetting, MainlineEntry

# 存储路径（运行时数据，相对于 CWD）
SESSIONS_DIR = Path.cwd() / "sessions"
EXPORTS_DIR = Path.cwd() / "exports"

# 确保目录存在
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)


class SessionManager:
    """会话管理器"""

    def __init__(self):
        # 内存中的活跃会话 {session_id: Session}
        self._active_sessions: dict[str, Session] = {}

    # ─────────────── 创建 ───────────────

    def create_session(
        self,
        name: str = "未命名会话",
        world_setting: WorldSetting | None = None,
        session_config: SessionConfig | None = None,
        characters: dict[str, CharacterState] | None = None,
        locations: dict[str, LocationSetting] | None = None,
    ) -> Session:
        session = Session(
            name=name,
            world_setting=world_setting or WorldSetting(),
            session_config=session_config or SessionConfig(),
            characters=characters or {},
            locations=locations or {},
        )
        # 初始化主线快照为初始状态，确保主线面板从一开始就有数据
        self._snapshot_mainline_state(session)
        self._active_sessions[session.session_id] = session
        self._save_to_disk(session)
        return session

    # ─────────────── 获取 ───────────────

    def get_session(self, session_id: str) -> Session | None:
        if session_id in self._active_sessions:
            return self._active_sessions[session_id]
        # 尝试从磁盘加载
        return self._load_from_disk(session_id)

    # ─────────────── 添加历史步骤 ───────────────

    def add_step(
        self,
        session_id: str,
        user_prompt: str,
        generated_text: str,
        characters: dict[str, CharacterState],
        world_setting: WorldSetting,
        session_config: SessionConfig | None = None,
        locations: dict[str, LocationSetting] | None = None,
    ) -> HistoryStep:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"会话 {session_id} 不存在")

        step = HistoryStep(
            user_prompt=user_prompt,
            generated_text=generated_text,
            characters_snapshot={k: v.model_copy(deep=True) for k, v in characters.items()},
            world_snapshot=world_setting.model_copy(deep=True),
            session_config_snapshot=(session_config or session.session_config).model_copy(deep=True),
            locations_snapshot={k: v.model_copy(deep=True) for k, v in (locations or {}).items()},
        )

        session.history.append(step)
        session.characters = characters
        session.world_setting = world_setting
        if session_config is not None:
            session.session_config = session_config
        if locations is not None:
            session.locations = locations
        session.updated_at = datetime.now().isoformat()

        self._save_to_disk(session)
        return step

    # ─────────────── 撤销 ───────────────

    def undo(self, session_id: str) -> bool:
        session = self.get_session(session_id)
        if not session or not session.history:
            return False

        # 移除最后一步
        session.history.pop()

        if session.history:
            # 恢复到上一步的快照
            last_step = session.history[-1]
            session.characters = {
                k: v.model_copy(deep=True)
                for k, v in last_step.characters_snapshot.items()
            }
            session.world_setting = last_step.world_snapshot.model_copy(deep=True)
            session.session_config = last_step.session_config_snapshot.model_copy(deep=True)
            session.locations = {
                k: v.model_copy(deep=True)
                for k, v in last_step.locations_snapshot.items()
            }
        else:
            # 没有历史了，可以选择保留初始设定或者清空
            # 这里保留当前设定不变（角色和世界观回到初始状态比较复杂）
            pass

        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return True

    # ─────────────── 清理对话历史 ───────────────

    def clear_history(self, session_id: str) -> bool:
        """清理对话历史记录，保留角色/世界/地点等设定不变"""
        session = self.get_session(session_id)
        if not session:
            return False

        session.history = []
        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return True

    # ─────────────── 更新设定 ───────────────

    def update_setting(
        self,
        session_id: str,
        name: str | None = None,
        world_setting: WorldSetting | None = None,
        session_config: SessionConfig | None = None,
        characters: dict[str, CharacterState] | None = None,
        locations: dict[str, LocationSetting] | None = None,
    ) -> Session | None:
        session = self.get_session(session_id)
        if not session:
            return None

        if name is not None:
            session.name = name
        if world_setting is not None:
            session.world_setting = world_setting
        if session_config is not None:
            session.session_config = session_config
        if characters is not None:
            session.characters = characters
        if locations is not None:
            session.locations = locations

        # 写作配置（世界设定、会话配置）属于全局设定，
        # 编辑后需要同步到主线快照，避免侧边栏显示与实际不一致
        if world_setting is not None and session.mainline_world_setting is not None:
            session.mainline_world_setting = world_setting.model_copy(deep=True)
        if session_config is not None and session.mainline_session_config is not None:
            session.mainline_session_config = session_config.model_copy(deep=True)

        # 如果还没有主线条目，保持主线快照与当前状态同步
        if not session.mainline:
            self._snapshot_mainline_state(session)

        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return session

    # ─────────────── 更新主线状态快照 ───────────────

    def update_mainline_state(
        self,
        session_id: str,
        characters: dict[str, CharacterState] | None = None,
        world_setting: WorldSetting | None = None,
        session_config: SessionConfig | None = None,
        locations: dict[str, LocationSetting] | None = None,
    ) -> Session | None:
        session = self.get_session(session_id)
        if not session:
            return None

        if characters is not None:
            session.mainline_characters = characters
        if world_setting is not None:
            session.mainline_world_setting = world_setting
        if session_config is not None:
            session.mainline_session_config = session_config
        if locations is not None:
            session.mainline_locations = locations

        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return session

    # ─────────────── 列出会话 ───────────────

    def list_sessions(self) -> list[dict]:
        sessions = []
        for f in SESSIONS_DIR.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                sessions.append({
                    "session_id": data.get("session_id", ""),
                    "name": data.get("name", "未命名"),
                    "created_at": data.get("created_at", ""),
                    "updated_at": data.get("updated_at", ""),
                    "steps_count": len(data.get("history", [])),
                })
            except Exception:
                continue
        sessions.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return sessions

    # ─────────────── 删除 ───────────────

    def delete_session(self, session_id: str) -> bool:
        self._active_sessions.pop(session_id, None)
        fp = SESSIONS_DIR / f"{session_id}.json"
        if fp.exists():
            fp.unlink()
            return True
        return False

    # ─────────────── 文章主线操作 ───────────────

    @staticmethod
    def _compute_mainline_hash(mainline: list[MainlineEntry]) -> str:
        """计算主线内容的哈希，用于判断是否需要重新生成概述"""
        content = "|".join(e.text for e in mainline)
        return hashlib.md5(content.encode()).hexdigest()

    def mainline_needs_summary_update(self, session: Session) -> bool:
        """检查主线是否有变化，需要重新生成概述"""
        if not session.mainline:
            return False
        current_hash = self._compute_mainline_hash(session.mainline)
        return current_hash != session.mainline_summary_hash

    def add_mainline_entry(
        self,
        session_id: str,
        text: str,
        note: str = "",
        insert_index: int | None = None,
    ) -> MainlineEntry:
        """添加一个条目到主线"""
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"会话 {session_id} 不存在")

        entry = MainlineEntry(
            text=text,
            note=note,
            order=len(session.mainline),
        )

        if insert_index is not None and 0 <= insert_index <= len(session.mainline):
            session.mainline.insert(insert_index, entry)
        else:
            session.mainline.append(entry)

        # 重新计算所有条目的 order
        for i, e in enumerate(session.mainline):
            e.order = i

        # 根据主线条目对应的历史步骤更新主线快照
        self._update_mainline_snapshot(session)

        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return entry

    def _snapshot_mainline_state(self, session: Session) -> None:
        """将当前会话状态快照到主线状态字段（仅作回退使用）"""
        session.mainline_characters = {
            name: char.model_copy(deep=True)
            for name, char in session.characters.items()
        }
        if session.world_setting:
            session.mainline_world_setting = session.world_setting.model_copy(deep=True)
        if session.session_config:
            session.mainline_session_config = session.session_config.model_copy(deep=True)
        session.mainline_locations = {
            name: loc.model_copy(deep=True)
            for name, loc in session.locations.items()
        }

    def sync_mainline_to_workspace(self, session_id: str) -> Session | None:
        """将主线状态同步到工作区状态（角色、世界设定、会话配置、地点）"""
        session = self.get_session(session_id)
        if not session:
            return None
        session.characters = {
            name: char.model_copy(deep=True)
            for name, char in session.mainline_characters.items()
        }
        if session.mainline_world_setting:
            session.world_setting = session.mainline_world_setting.model_copy(deep=True)
        if session.mainline_session_config:
            session.session_config = session.mainline_session_config.model_copy(deep=True)
        session.locations = {
            name: loc.model_copy(deep=True)
            for name, loc in session.mainline_locations.items()
        }
        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return session

    def sync_workspace_to_mainline(self, session_id: str) -> Session | None:
        """将工作区状态应用到主线状态（角色、世界设定、会话配置、地点）"""
        session = self.get_session(session_id)
        if not session:
            return None
        session.mainline_characters = {
            name: char.model_copy(deep=True)
            for name, char in session.characters.items()
        }
        if session.world_setting:
            session.mainline_world_setting = session.world_setting.model_copy(deep=True)
        if session.session_config:
            session.mainline_session_config = session.session_config.model_copy(deep=True)
        session.mainline_locations = {
            name: loc.model_copy(deep=True)
            for name, loc in session.locations.items()
        }
        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return session

    def _update_mainline_snapshot(self, session: Session) -> None:
        """根据主线条目匹配的历史步骤快照来更新主线状态。

        遍历所有主线条目，找到对应的历史步骤（通过 generated_text 匹配），
        取时间上最晚的步骤快照作为主线状态。这样可确保只有已收入主线的
        内容所对应的状态才会进入主线快照，避免未合并内容污染主线。
        """
        if not session.mainline:
            # 主线为空时清空快照
            session.mainline_characters = {}
            session.mainline_world_setting = None
            session.mainline_session_config = None
            session.mainline_locations = {}
            return

        if not session.history:
            # 没有历史记录则回退到当前状态
            self._snapshot_mainline_state(session)
            return

        # 建立 generated_text -> 最新步骤索引 的映射
        text_to_step_idx: dict[str, int] = {}
        for idx, step in enumerate(session.history):
            text_to_step_idx[step.generated_text] = idx

        # 找出所有主线条目对应的历史步骤中，时间上最晚的那个
        latest_step_idx = -1
        for entry in session.mainline:
            step_idx = text_to_step_idx.get(entry.text, -1)
            if step_idx > latest_step_idx:
                latest_step_idx = step_idx

        if latest_step_idx >= 0:
            target_step = session.history[latest_step_idx]
            session.mainline_characters = {
                name: char.model_copy(deep=True)
                for name, char in target_step.characters_snapshot.items()
            }
            session.mainline_world_setting = target_step.world_snapshot.model_copy(deep=True)
            session.mainline_session_config = target_step.session_config_snapshot.model_copy(deep=True)
            session.mainline_locations = {
                name: loc.model_copy(deep=True)
                for name, loc in target_step.locations_snapshot.items()
            }
        else:
            # 主线文本在历史中找不到匹配（可能手工编辑过），回退到当前状态
            self._snapshot_mainline_state(session)

    def remove_mainline_entry(self, session_id: str, entry_id: str) -> bool:
        """从主线中移除一个条目"""
        session = self.get_session(session_id)
        if not session:
            return False

        original_len = len(session.mainline)
        session.mainline = [e for e in session.mainline if e.entry_id != entry_id]

        if len(session.mainline) == original_len:
            return False  # 没找到该条目

        # 重新计算 order
        for i, e in enumerate(session.mainline):
            e.order = i

        # 重新计算主线快照（最晚的主线条目可能已变化）
        self._update_mainline_snapshot(session)

        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return True

    def update_mainline_entry(
        self,
        session_id: str,
        entry_id: str,
        text: str | None = None,
        note: str | None = None,
    ) -> MainlineEntry | None:
        """更新主线条目的内容或备注"""
        session = self.get_session(session_id)
        if not session:
            return None

        for entry in session.mainline:
            if entry.entry_id == entry_id:
                if text is not None:
                    entry.text = text
                if note is not None:
                    entry.note = note
                session.updated_at = datetime.now().isoformat()
                self._save_to_disk(session)
                return entry

        return None

    def reorder_mainline(self, session_id: str, entry_ids: list[str]) -> bool:
        """重新排序主线条目"""
        session = self.get_session(session_id)
        if not session:
            return False

        # 构建 ID -> Entry 的映射
        entry_map = {e.entry_id: e for e in session.mainline}

        # 验证所有 ID 都存在
        if set(entry_ids) != set(entry_map.keys()):
            return False

        session.mainline = [entry_map[eid] for eid in entry_ids]
        for i, e in enumerate(session.mainline):
            e.order = i

        # 重新排序不改变条目集合，但保持一致性
        self._update_mainline_snapshot(session)

        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return True

    def update_mainline_summary(
        self,
        session_id: str,
        summary: str,
    ) -> bool:
        """更新主线概述和哈希"""
        session = self.get_session(session_id)
        if not session:
            return False

        session.mainline_summary = summary
        session.mainline_summary_hash = self._compute_mainline_hash(session.mainline)
        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return True

    def update_mainline_prefix(
        self,
        session_id: str,
        prefix: str,
    ) -> bool:
        """更新主线前情概述（手动插入的上文概述）"""
        session = self.get_session(session_id)
        if not session:
            return False

        session.mainline_prefix = prefix
        session.updated_at = datetime.now().isoformat()
        self._save_to_disk(session)
        return True

    # ─────────────── 新开章节 ───────────────

    def create_new_chapter(
        self,
        old_session_id: str,
        new_prefix: str,
        new_name: str | None = None,
    ) -> Session | None:
        """基于旧会话新开一个章节。

        - 复制旧会话的主线状态（角色/世界/配置/地点）作为新会话的初始状态
        - 使用生成好的 new_prefix 作为新会话的前情概述
        - 新会话的主线和历史为空

        Args:
            old_session_id: 旧会话 ID
            new_prefix: 已生成的新章节前情概述文本
            new_name: 新会话名称（默认在旧会话名后加"（续）"）

        Returns:
            新创建的 Session，失败返回 None
        """
        old_session = self.get_session(old_session_id)
        if not old_session:
            return None

        # 确定新会话名称
        if not new_name:
            new_name = old_session.name + "（续）"

        # 从旧会话的主线状态深拷贝
        new_characters = {
            name: char.model_copy(deep=True)
            for name, char in old_session.mainline_characters.items()
        } if old_session.mainline_characters else {
            name: char.model_copy(deep=True)
            for name, char in old_session.characters.items()
        }

        new_world = (
            old_session.mainline_world_setting.model_copy(deep=True)
            if old_session.mainline_world_setting
            else old_session.world_setting.model_copy(deep=True)
        )

        new_session_config = (
            old_session.mainline_session_config.model_copy(deep=True)
            if old_session.mainline_session_config
            else old_session.session_config.model_copy(deep=True)
        )

        new_locations = {
            name: loc.model_copy(deep=True)
            for name, loc in old_session.mainline_locations.items()
        } if old_session.mainline_locations else {
            name: loc.model_copy(deep=True)
            for name, loc in old_session.locations.items()
        }

        # 创建新会话
        new_session = self.create_session(
            name=new_name,
            world_setting=new_world,
            session_config=new_session_config,
            characters=new_characters,
            locations=new_locations,
        )

        # 设置前情概述
        new_session.mainline_prefix = new_prefix
        self._save_to_disk(new_session)

        return new_session

    # ─────────────── 导出为文件 ───────────────

    def export_mainline(self, session_id: str) -> str | None:
        """将主线内容导出为 TXT 文件，返回文件路径"""
        session = self.get_session(session_id)
        if not session or not session.mainline:
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = session.name.replace("/", "_").replace("\\", "_")
        filename = f"{safe_name}_主线_{timestamp}.txt"
        filepath = EXPORTS_DIR / filename

        lines = []
        ws = session.world_setting
        lines.append(f"{'='*60}")
        lines.append(f"  {ws.title or session.name} — 文章主线")
        lines.append(f"{'='*60}")
        lines.append(f"导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"主线片段数：{len(session.mainline)}")
        lines.append(f"{'='*60}\n")

        for entry in session.mainline:
            lines.append(entry.text)
            lines.append("")

        filepath.write_text("\n".join(lines), encoding="utf-8")
        return str(filepath)

    def export_novel(self, session_id: str, format: str = "txt") -> str | None:
        """将小说片段合集导出为文件，返回文件路径"""
        session = self.get_session(session_id)
        if not session or not session.history:
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = session.name.replace("/", "_").replace("\\", "_")

        if format == "txt":
            filename = f"{safe_name}_{timestamp}.txt"
            filepath = EXPORTS_DIR / filename
            self._export_txt(session, filepath)
        elif format == "md":
            filename = f"{safe_name}_{timestamp}.md"
            filepath = EXPORTS_DIR / filename
            self._export_markdown(session, filepath)
        else:
            return None

        return str(filepath)

    def _export_txt(self, session: Session, filepath: Path):
        lines = []
        ws = session.world_setting
        lines.append(f"{'='*60}")
        lines.append(f"  {ws.title or session.name}")
        lines.append(f"{'='*60}")
        lines.append(f"类型：{ws.genre}")
        lines.append(f"导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"总片段数：{len(session.history)}")
        lines.append(f"{'='*60}\n")

        for i, step in enumerate(session.history, 1):
            lines.append(f"--- 第 {i} 段 ---\n")
            lines.append(step.generated_text)
            lines.append("")

        filepath.write_text("\n".join(lines), encoding="utf-8")

    def _export_markdown(self, session: Session, filepath: Path):
        lines = []
        ws = session.world_setting
        lines.append(f"# {ws.title or session.name}\n")
        lines.append(f"> **类型**：{ws.genre}  ")
        lines.append(f"> **导出时间**：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  ")
        lines.append(f"> **总片段数**：{len(session.history)}\n")

        if ws.background:
            lines.append(f"## 世界观\n\n{ws.background}\n")

        lines.append("## 正文\n")
        for i, step in enumerate(session.history, 1):
            lines.append(f"### 第 {i} 段\n")
            lines.append(step.generated_text)
            lines.append("")

        # 附录：角色状态
        if session.characters:
            lines.append("## 附录：角色最终状态\n")
            for name, char in session.characters.items():
                lines.append(f"### {name}\n")
                lines.append(f"- **描述**：{char.description}")
                lines.append(f"- **外貌**：{char.appearance}")
                lines.append(f"- **着装**：{char.outfit}")
                lines.append(f"- **性格**：{char.personality}")
                lines.append(f"- **状态**：{char.status}")
                lines.append(f"- **位置**：{char.location}")
                if char.relationships:
                    rels = "、".join(f"{k}({v})" for k, v in char.relationships.items())
                    lines.append(f"- **关系**：{rels}")
                lines.append("")

        filepath.write_text("\n".join(lines), encoding="utf-8")

    # ─────────────── 磁盘持久化 ───────────────

    def _save_to_disk(self, session: Session):
        fp = SESSIONS_DIR / f"{session.session_id}.json"
        fp.write_text(session.model_dump_json(indent=2), encoding="utf-8")

    def _load_from_disk(self, session_id: str) -> Session | None:
        fp = SESSIONS_DIR / f"{session_id}.json"
        if not fp.exists():
            return None
        try:
            session = Session.model_validate_json(fp.read_text(encoding="utf-8"))
            self._active_sessions[session_id] = session
            return session
        except Exception:
            return None


# 全局单例
session_manager = SessionManager()
