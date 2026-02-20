"""
会话管理器 - 负责会话的创建、保存、加载、撤销、导出
"""

from __future__ import annotations
import json
import os
from datetime import datetime
from pathlib import Path
from models import Session, HistoryStep, WorldSetting, CharacterState, LocationSetting

# 存储路径
BASE_DIR = Path(__file__).parent.parent
SESSIONS_DIR = BASE_DIR / "sessions"
EXPORTS_DIR = BASE_DIR / "exports"

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
        characters: dict[str, CharacterState] | None = None,
        locations: dict[str, LocationSetting] | None = None,
    ) -> Session:
        session = Session(
            name=name,
            world_setting=world_setting or WorldSetting(),
            characters=characters or {},
            locations=locations or {},
        )
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
            locations_snapshot={k: v.model_copy(deep=True) for k, v in (locations or {}).items()},
        )

        session.history.append(step)
        session.characters = characters
        session.world_setting = world_setting
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

    # ─────────────── 更新设定 ───────────────

    def update_setting(
        self,
        session_id: str,
        world_setting: WorldSetting | None = None,
        characters: dict[str, CharacterState] | None = None,
        locations: dict[str, LocationSetting] | None = None,
    ) -> Session | None:
        session = self.get_session(session_id)
        if not session:
            return None

        if world_setting is not None:
            session.world_setting = world_setting
        if characters is not None:
            session.characters = characters
        if locations is not None:
            session.locations = locations

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

    # ─────────────── 导出为文件 ───────────────

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
