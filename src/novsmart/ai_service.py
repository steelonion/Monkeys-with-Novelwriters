"""
AI 服务层 - 封装 OpenAI API 调用，构建提示词，解析格式化输出
"""

from __future__ import annotations
import json
import re
import copy
from datetime import datetime
from pathlib import Path
from openai import AsyncOpenAI
from .models import CharacterState, LocationSetting, WorldSetting, SessionConfig, Session, MainlineEntry

# 配置文件路径（运行时数据，相对于 CWD）
CONFIG_PATH = Path.cwd() / "config.json"

# 调试日志
LOG_DIR = Path.cwd() / "log"
DEBUG_MODE = False


def enable_debug_mode():
    """启用调试模式，在 log/ 目录下记录原始请求和返回"""
    global DEBUG_MODE
    DEBUG_MODE = True
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def _debug_log(label: str, messages: list[dict], response_text: str, **extra):
    """将一次 LLM 请求/响应写入日志文件"""
    if not DEBUG_MODE:
        return
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"{ts}_{label}.json"
    log_data = {
        "timestamp": datetime.now().isoformat(),
        "label": label,
        "request_messages": messages,
        "response_text": response_text,
        **extra,
    }
    try:
        (LOG_DIR / filename).write_text(
            json.dumps(log_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


# ────────────────────────────── 提示词模板 ──────────────────────────────

SYSTEM_PROMPT_TEMPLATE = """\
你是一位专业的小说创作助手。你需要根据用户提供的设定和提示，续写高质量的小说片段。

## 当前小说设定
- 标题：{title}
- 类型：{genre}
- 世界观：{background}
- 世界规则：{rules}
- 当前剧情弧：{current_arc}
- 写作风格要求：{custom_instructions}
{extra_settings}

## 当前地点设定
{locations_block}

## 当前角色状态
{characters_block}

## 文章主线概述
{mainline_summary}

## 最近对话片段
{recent_story}

## 重要写作规则
1. 保持角色性格一致性，行为符合角色设定。
2. 遵守世界观规则，不要违背已建立的设定。
3. 文笔流畅，情节紧凑，富有画面感。
4. 续写内容要自然衔接上文。

## 输出格式要求（必须严格遵守）
你的回复必须分为两个部分，用特殊分隔符分开：

**第一部分**：小说正文内容（直接输出故事文本，不要包含任何标记）

===CHARACTER_STATE_UPDATE===

**第二部分**：一个 JSON 对象，用于更新角色状态和世界设定。格式如下：
```json
{{
  "characters": {{
    "角色名": {{
      "name": "角色名",
      "description": "外貌描述",
      "personality": "性格特点",
      "status": "当前状态(情绪/身体)",
      "location": "当前位置",
      "relationships": {{"其他角色名": "关系描述"}},
      "inventory": ["物品1", "物品2"],
      "notes": "备注"
    }}
  }},
  "world_update": {{
    "current_arc": "更新后的当前剧情弧（如有变化）",
    "extra_settings": {{"新发现的设定key": "value"}}
  }},
  "locations_update": {{
    "地点名": {{
      "name": "地点名",
      "description": "地点描述",
      "parent": "父级地点",
      "features": ["特征1"],
      "connected_to": ["相连地点1"],
      "notes": "备注"
    }}
  }}
}}
```

注意：
- 只需要列出**状态发生变化**的角色，未变化的角色不用列出。
- world_update 只列出有变化的字段，没变化可以留空对象。
- locations_update 只列出新出现或发生变化的地点。
- JSON 必须合法，可以被直接解析。
"""


MAINLINE_SUMMARY_PROMPT = """\
你是一个小说剧情概述助手。以下是一部小说的“文章主线”内容，包含用户已确认的正式文本片段。

请你对这些内容进行简洁概述，作为后续写作的上文提示。概述应该：
1. 包含主要剧情线的进展
2. 记录关键事件和转折点
3. 反映角色关系的变化
4. 保持简洁，但不遗漏重要信息
5. 按时间线/剧情发展顺序组织
6. 字数控制在 300-800 字之间

只输出概述文本，不要输出额外的解释或标记。
"""

PARSE_TEXT_PROMPT = """\
你是一个文本解析助手。用户会提供一段关于小说设定的自由文本，其中可能包含世界观、角色设定、剧情简介、写作风格等信息。

你需要从中提取结构化信息，输出一个严格合法的 JSON 对象。格式如下：

```json
{{
  "session_name": "根据内容总结的会话名称",
  "world_setting": {{
    "title": "小说标题（如果文本中有提及）",
    "genre": "小说类型（如玄幻/科幻/都市/言情等）",
    "background": "世界观背景描述",
    "rules": ["规则1", "规则2"],
    "extra_settings": {{"其他设定key": "value"}}
  }},
  "session_config": {{
    "current_arc": "当前主要剧情弧",
    "custom_instructions": "写作风格/要求"
  }},
  "locations": {{
    "地点名": {{
      "name": "地点名",
      "description": "地点描述",
      "parent": "父级地点",
      "features": ["特征1"],
      "connected_to": ["相连地点1"],
      "notes": "备注"
    }}
  }},
  "characters": {{
    "角色名": {{
      "name": "角色名",
      "description": "外貌描述",
      "personality": "性格特点",
      "status": "当前状态",
      "location": "所在位置",
      "relationships": {{"其他角色名": "关系描述"}},
      "inventory": ["物品1"],
      "notes": "备注"
    }}
  }}
}}
```

注意：
1. 尽量从文本中提取所有有用信息，合理分类到对应字段。
2. 文本中未提及的字段留空字符串或空数组/对象。
3. 如果文本中有多个角色，全部提取。
4. session_name 应简短概括该小说主题（5-15字）。
5. world_setting 只放世界观构建相关的信息（标题、类型、背景、规则等）。
6. session_config 放会话级别的配置（剧情弧、写作风格要求等）。
7. 只输出 JSON，不要输出额外的解释文字。
"""


def _build_characters_block(characters: dict[str, CharacterState]) -> str:
    """构建角色状态文本块"""
    if not characters:
        return "（暂无角色信息）"

    lines = []
    for name, char in characters.items():
        lines.append(f"### {name}")
        lines.append(f"- 描述：{char.description}")
        lines.append(f"- 性格：{char.personality}")
        lines.append(f"- 当前状态：{char.status}")
        lines.append(f"- 位置：{char.location}")
        if char.relationships:
            rels = "、".join(f"{k}({v})" for k, v in char.relationships.items())
            lines.append(f"- 关系：{rels}")
        if char.inventory:
            lines.append(f"- 随身物品：{'、'.join(char.inventory)}")
        if char.notes:
            lines.append(f"- 备注：{char.notes}")
        lines.append("")
    return "\n".join(lines)


def _build_locations_block(locations: dict[str, LocationSetting]) -> str:
    """构建地点设定文本块"""
    if not locations:
        return "（暂无地点信息）"

    lines = []
    for name, loc in locations.items():
        lines.append(f"### {name}")
        if loc.description:
            lines.append(f"- 描述：{loc.description}")
        if loc.parent:
            lines.append(f"- 所属：{loc.parent}")
        if loc.features:
            lines.append(f"- 特征：{'、'.join(loc.features)}")
        if loc.connected_to:
            lines.append(f"- 相连地点：{'、'.join(loc.connected_to)}")
        if loc.notes:
            lines.append(f"- 备注：{loc.notes}")
        lines.append("")
    return "\n".join(lines)


def _build_recent_story(history, max_steps: int = 3) -> str:
    """从历史记录提取最近的故事片段作为上文"""
    if not history:
        return "（这是故事的开端，暂无前文）"

    recent = history[-max_steps:]
    parts = []
    for step in recent:
        parts.append(step.generated_text)
    return "\n\n---\n\n".join(parts)


def build_system_prompt(session: Session) -> str:
    """根据会话状态构建完整的系统提示词"""
    ws = session.world_setting
    sc = session.session_config

    rules_text = "\n".join(f"  - {r}" for r in ws.rules) if ws.rules else "暂无"
    extra = ""
    if ws.extra_settings:
        extra = "\n".join(f"- {k}：{v}" for k, v in ws.extra_settings.items())

    # 主线概述
    mainline_summary = session.mainline_summary.strip() if session.mainline_summary else ""
    if not mainline_summary:
        if session.mainline:
            mainline_summary = "（主线已有内容但概述尚未生成）"
        else:
            mainline_summary = "（暂无主线内容，这是故事的开端）"

    return SYSTEM_PROMPT_TEMPLATE.format(
        title=ws.title or "未定",
        genre=ws.genre or "未定",
        background=ws.background or "暂无",
        rules=rules_text,
        current_arc=sc.current_arc or "暂无",
        custom_instructions=sc.custom_instructions or "无特殊要求",
        extra_settings=extra,
        locations_block=_build_locations_block(session.locations),
        characters_block=_build_characters_block(session.characters),
        mainline_summary=mainline_summary,
        recent_story=_build_recent_story(session.history),
    )


# ────────────────────────────── 响应解析 ──────────────────────────────

SEPARATOR = "===CHARACTER_STATE_UPDATE==="


def parse_ai_response(
    raw_text: str,
    existing_characters: dict[str, CharacterState],
    existing_world: WorldSetting,
    existing_session_config: SessionConfig | None = None,
    existing_locations: dict[str, LocationSetting] | None = None,
) -> tuple[str, dict[str, CharacterState], WorldSetting, SessionConfig, dict[str, LocationSetting]]:
    """
    解析 AI 返回的文本，分离小说正文和状态更新 JSON。
    返回: (story_text, updated_characters, updated_world, updated_session_config, updated_locations)
    """
    if existing_locations is None:
        existing_locations = {}
    if existing_session_config is None:
        existing_session_config = SessionConfig()

    # 分离正文和 JSON 部分
    if SEPARATOR in raw_text:
        story_text, json_part = raw_text.split(SEPARATOR, 1)
    else:
        # 如果没有分隔符，尝试从末尾找 JSON
        story_text = raw_text
        json_part = ""

    story_text = story_text.strip()

    # 深拷贝现有状态
    updated_characters = {k: v.model_copy(deep=True) for k, v in existing_characters.items()}
    updated_world = existing_world.model_copy(deep=True)
    updated_session_config = existing_session_config.model_copy(deep=True)
    updated_locations = {k: v.model_copy(deep=True) for k, v in existing_locations.items()}

    if not json_part.strip():
        return story_text, updated_characters, updated_world, updated_session_config, updated_locations

    # 提取 JSON（可能被 ```json ``` 包裹）
    json_str = json_part.strip()
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", json_str, re.DOTALL)
    if json_match:
        json_str = json_match.group(1)
    else:
        # 尝试直接找 JSON 对象
        brace_match = re.search(r"\{.*\}", json_str, re.DOTALL)
        if brace_match:
            json_str = brace_match.group(0)

    try:
        update_data = json.loads(json_str)
    except json.JSONDecodeError:
        # JSON 解析失败，返回原始状态
        return story_text, updated_characters, updated_world, updated_session_config, updated_locations

    # 更新角色状态
    if "characters" in update_data and isinstance(update_data["characters"], dict):
        for char_name, char_data in update_data["characters"].items():
            if isinstance(char_data, dict):
                if char_name in updated_characters:
                    # 合并更新：只更新非空字段
                    existing = updated_characters[char_name]
                    for field_name in CharacterState.model_fields:
                        if field_name in char_data and char_data[field_name]:
                            setattr(existing, field_name, char_data[field_name])
                else:
                    # 新角色
                    try:
                        updated_characters[char_name] = CharacterState(**char_data)
                    except Exception:
                        updated_characters[char_name] = CharacterState(name=char_name)

    # 更新世界设定
    if "world_update" in update_data and isinstance(update_data["world_update"], dict):
        wu = update_data["world_update"]
        if wu.get("current_arc"):
            updated_session_config.current_arc = wu["current_arc"]
        if wu.get("extra_settings") and isinstance(wu["extra_settings"], dict):
            updated_world.extra_settings.update(wu["extra_settings"])

    # 更新地点设定
    if "locations_update" in update_data and isinstance(update_data["locations_update"], dict):
        for loc_name, loc_data in update_data["locations_update"].items():
            if isinstance(loc_data, dict):
                if loc_name in updated_locations:
                    existing_loc = updated_locations[loc_name]
                    for field_name in LocationSetting.model_fields:
                        if field_name in loc_data and loc_data[field_name]:
                            setattr(existing_loc, field_name, loc_data[field_name])
                else:
                    try:
                        updated_locations[loc_name] = LocationSetting(**loc_data)
                    except Exception:
                        updated_locations[loc_name] = LocationSetting(name=loc_name)

    return story_text, updated_characters, updated_world, updated_session_config, updated_locations


# ────────────────────────────── AI 调用 ──────────────────────────────

class AIService:
    """封装 OpenAI API 调用"""

    def __init__(self):
        self.client: AsyncOpenAI | None = None
        self.model: str = "gpt-4o"
        self.api_key: str = ""
        self.base_url: str = "https://api.openai.com/v1"

    def configure(self, api_key: str, base_url: str = "https://api.openai.com/v1", model: str = "gpt-4o", *, save: bool = True):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        if save:
            self._save_config()

    def _save_config(self):
        """将配置持久化到磁盘"""
        data = {"api_key": self.api_key, "base_url": self.base_url, "model": self.model}
        CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def load_config(self):
        """从磁盘加载配置（启动时调用）"""
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                if data.get("api_key"):
                    self.configure(
                        api_key=data["api_key"],
                        base_url=data.get("base_url", "https://api.openai.com/v1"),
                        model=data.get("model", "gpt-4o"),
                        save=False,
                    )
            except Exception:
                pass

    @property
    def is_configured(self) -> bool:
        return self.client is not None

    async def generate(
        self,
        session: Session,
        user_prompt: str,
        temperature: float = 0.85,
        max_tokens: int = 2000,
    ) -> tuple[str, dict[str, CharacterState], WorldSetting, SessionConfig, dict[str, LocationSetting]]:
        """
        调用 AI 生成小说片段并解析状态更新。
        返回: (story_text, updated_characters, updated_world, updated_session_config, updated_locations)
        """
        if not self.is_configured:
            raise RuntimeError("AI 服务未配置，请先设置 API Key")

        system_prompt = build_system_prompt(session)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"请根据以下提示续写小说片段：\n\n{user_prompt}"},
        ]

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        raw_text = response.choices[0].message.content or ""

        _debug_log("generate", messages, raw_text,
                   model=self.model, temperature=temperature, max_tokens=max_tokens)

        story_text, updated_chars, updated_world, updated_session_config, updated_locations = parse_ai_response(
            raw_text, session.characters, session.world_setting, session.session_config, session.locations
        )

        return story_text, updated_chars, updated_world, updated_session_config, updated_locations


    async def generate_mainline_summary(
        self,
        mainline_entries: list[MainlineEntry],
        world_setting: WorldSetting | None = None,
    ) -> str:
        """
        调用 LLM 生成主线内容的概述。
        只在主线内容发生变化时调用。
        """
        if not self.is_configured:
            raise RuntimeError("AI 服务未配置，请先设置 API Key")

        if not mainline_entries:
            return ""

        # 构建主线文本
        mainline_text_parts = []
        for i, entry in enumerate(mainline_entries, 1):
            mainline_text_parts.append(f"--- 第 {i} 段 ---\n{entry.text}")
        mainline_text = "\n\n".join(mainline_text_parts)

        # 添加世界观上下文
        context = ""
        if world_setting:
            context = f"\n小说标题：{world_setting.title or '未定'}\n类型：{world_setting.genre or '未定'}\n\n"

        user_content = f"{context}以下是文章主线内容：\n\n{mainline_text}"

        messages = [
            {"role": "system", "content": MAINLINE_SUMMARY_PROMPT},
            {"role": "user", "content": user_content},
        ]

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.3,
            max_tokens=1500,
        )

        result = (response.choices[0].message.content or "").strip()

        _debug_log("mainline_summary", messages, result,
                   model=self.model, temperature=0.3, max_tokens=1500)

        return result

    async def parse_text_to_session(
        self,
        raw_text: str,
        temperature: float = 0.3,
    ) -> tuple[str, WorldSetting, SessionConfig, dict[str, CharacterState], dict[str, LocationSetting]]:
        """
        解析用户提供的自由文本，通过 LLM 提取结构化的会话设定。
        返回: (session_name, world_setting, session_config, characters, locations)
        """
        if not self.is_configured:
            raise RuntimeError("AI 服务未配置，请先设置 API Key")

        system_prompt = PARSE_TEXT_PROMPT
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": raw_text},
        ]

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=4000,
        )

        raw_response = response.choices[0].message.content or "{}"

        _debug_log("parse_text", messages, raw_response,
                   model=self.model, temperature=temperature, max_tokens=4000)

        # 提取 JSON
        json_str = raw_response.strip()
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", json_str, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            brace_match = re.search(r"\{.*\}", json_str, re.DOTALL)
            if brace_match:
                json_str = brace_match.group(0)

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            raise ValueError("AI 返回的格式无法解析，请重新尝试")

        # 构建 WorldSetting
        ws_data = data.get("world_setting", {})
        world_setting = WorldSetting(
            title=ws_data.get("title", ""),
            genre=ws_data.get("genre", ""),
            background=ws_data.get("background", ""),
            rules=ws_data.get("rules", []),
            extra_settings=ws_data.get("extra_settings", {}),
        )

        # 构建 SessionConfig
        sc_data = data.get("session_config", {})
        session_config = SessionConfig(
            current_arc=sc_data.get("current_arc", "") or ws_data.get("current_arc", ""),
            custom_instructions=sc_data.get("custom_instructions", "") or ws_data.get("custom_instructions", ""),
        )

        # 构建 Characters
        characters: dict[str, CharacterState] = {}
        chars_data = data.get("characters", {})
        if isinstance(chars_data, dict):
            for char_name, char_info in chars_data.items():
                if isinstance(char_info, dict):
                    try:
                        characters[char_name] = CharacterState(
                            name=char_info.get("name", char_name),
                            description=char_info.get("description", ""),
                            personality=char_info.get("personality", ""),
                            status=char_info.get("status", ""),
                            location=char_info.get("location", ""),
                            relationships=char_info.get("relationships", {}),
                            inventory=char_info.get("inventory", []),
                            notes=char_info.get("notes", ""),
                        )
                    except Exception:
                        characters[char_name] = CharacterState(name=char_name)

        session_name = data.get("session_name", ws_data.get("title", "未命名会话"))

        # 构建 Locations
        locations: dict[str, LocationSetting] = {}
        locs_data = data.get("locations", {})
        if isinstance(locs_data, dict):
            for loc_name, loc_info in locs_data.items():
                if isinstance(loc_info, dict):
                    try:
                        locations[loc_name] = LocationSetting(
                            name=loc_info.get("name", loc_name),
                            description=loc_info.get("description", ""),
                            parent=loc_info.get("parent", ""),
                            features=loc_info.get("features", []),
                            connected_to=loc_info.get("connected_to", []),
                            notes=loc_info.get("notes", ""),
                        )
                    except Exception:
                        locations[loc_name] = LocationSetting(name=loc_name)

        return session_name, world_setting, session_config, characters, locations


# 全局单例
ai_service = AIService()
