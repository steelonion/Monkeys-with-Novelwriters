"""
数据模型定义 - 小说AI写作框架
"""

from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime
import uuid


# ────────────────────────────── 角色状态 ──────────────────────────────

class CharacterState(BaseModel):
    """单个角色的当前状态"""
    name: str = Field(..., description="角色名称")
    description: str = Field(default="", description="角色基础描述/外貌")
    personality: str = Field(default="", description="性格特点")
    status: str = Field(default="", description="当前状态(情绪、身体状况等)")
    location: str = Field(default="", description="当前所在位置")
    relationships: dict[str, str] = Field(default_factory=dict, description="与其他角色的关系 {角色名: 关系描述}")
    inventory: list[str] = Field(default_factory=list, description="随身物品")
    notes: str = Field(default="", description="其他备注信息")
    custom_fields: dict[str, Any] = Field(default_factory=dict, description="自定义扩展字段(如技能、属性、等级等)")


# ────────────────────────────── 地点设定 ──────────────────────────────

class LocationSetting(BaseModel):
    """单个地点的设定"""
    name: str = Field(..., description="地点名称")
    description: str = Field(default="", description="地点描述")
    parent: str = Field(default="", description="父级地点（如所属城市/大陆）")
    features: list[str] = Field(default_factory=list, description="地点特征/特殊规则")
    connected_to: list[str] = Field(default_factory=list, description="相连的其他地点")
    notes: str = Field(default="", description="备注")


# ────────────────────────────── 世界设定 ──────────────────────────────

class WorldSetting(BaseModel):
    """世界观/小说设定（纯世界构建信息）"""
    title: str = Field(default="", description="小说标题")
    genre: str = Field(default="", description="小说类型(玄幻/科幻/都市等)")
    background: str = Field(default="", description="世界观背景描述")
    rules: list[str] = Field(default_factory=list, description="世界规则(力量体系/科技水平等)")
    extra_settings: dict[str, str] = Field(default_factory=dict, description="其他自定义设定键值对")


# ────────────────────────────── 自定义字段定义 ──────────────────────────────

class CustomFieldDef(BaseModel):
    """角色自定义字段的定义"""
    name: str = Field(..., description="字段名称，如'修为境界'、'技能列表'")
    field_type: str = Field(default="string", description="字段类型: string / number / list / object")
    description: str = Field(default="", description="字段含义说明，帮助AI理解")


# ────────────────────────────── 会话配置 ──────────────────────────────

class SessionConfig(BaseModel):
    """会话级别的配置（写作风格、剧情弧等，与世界观无关）"""
    current_arc: str = Field(default="", description="当前剧情弧")
    custom_instructions: str = Field(default="", description="用户自定义写作指令/风格要求")
    custom_field_defs: list[CustomFieldDef] = Field(default_factory=list, description="角色自定义字段定义列表")


# ────────────────────────────── 历史步骤 ──────────────────────────────

class HistoryStep(BaseModel):
    """一次生成的完整记录(用于撤销/回退)"""
    step_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
    user_prompt: str = Field(default="", description="用户输入的片段提示")
    generated_text: str = Field(default="", description="AI生成的小说片段")
    characters_snapshot: dict[str, CharacterState] = Field(default_factory=dict, description="生成后角色状态快照")
    world_snapshot: WorldSetting = Field(default_factory=WorldSetting, description="生成后世界设定快照")
    session_config_snapshot: SessionConfig = Field(default_factory=SessionConfig, description="生成后会话配置快照")
    locations_snapshot: dict[str, LocationSetting] = Field(default_factory=dict, description="生成后地点快照")


# ────────────────────────────── 文章主线 ──────────────────────────────

class MainlineEntry(BaseModel):
    """文章主线中的一个条目"""
    entry_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    text: str = Field(..., description="选入主线的文本内容")
    order: int = Field(default=0, description="在主线中的排序")
    added_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    note: str = Field(default="", description="用户对该条目的备注")


# ────────────────────────────── 会话 ──────────────────────────────────

class Session(BaseModel):
    """一个完整的写作会话"""
    session_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    name: str = Field(default="未命名会话", description="会话名称")

    # 当前状态
    world_setting: WorldSetting = Field(default_factory=WorldSetting)
    session_config: SessionConfig = Field(default_factory=SessionConfig)
    characters: dict[str, CharacterState] = Field(default_factory=dict, description="角色名 -> 角色状态")
    locations: dict[str, LocationSetting] = Field(default_factory=dict, description="地点名 -> 地点设定")

    # 历史记录(支持撤销)
    history: list[HistoryStep] = Field(default_factory=list, description="生成历史")

    # 文章主线
    mainline: list[MainlineEntry] = Field(default_factory=list, description="文章主线条目列表")
    mainline_summary: str = Field(default="", description="主线内容的LLM概述，作为AI上文提示")
    mainline_summary_hash: str = Field(default="", description="生成概述时主线内容的哈希，用于判断是否需要重新生成")

    # 主线状态快照（收入主线时冻结的"正式"状态）
    mainline_characters: dict[str, CharacterState] = Field(default_factory=dict, description="主线快照：角色状态")
    mainline_world_setting: Optional[WorldSetting] = Field(default=None, description="主线快照：世界设定")
    mainline_session_config: Optional[SessionConfig] = Field(default=None, description="主线快照：会话配置")
    mainline_locations: dict[str, LocationSetting] = Field(default_factory=dict, description="主线快照：地点设定")


# ────────────────────────────── API 请求/响应 ─────────────────────────

class GenerateRequest(BaseModel):
    """生成请求"""
    session_id: str
    user_prompt: str = Field(..., description="用户输入的下一段剧情提示")
    temperature: float = Field(default=0.85, ge=0.0, le=2.0)
    suggested_length: int = Field(default=2000, ge=100, le=8000, description="建议的片段字数（柔性限制）")


class GenerateResponse(BaseModel):
    """生成响应"""
    story_text: str = Field(..., description="生成的小说片段")
    characters: dict[str, CharacterState] = Field(default_factory=dict)
    world_setting: WorldSetting = Field(default_factory=WorldSetting)
    session_config: SessionConfig = Field(default_factory=SessionConfig)
    locations: dict[str, LocationSetting] = Field(default_factory=dict)
    step_id: str = ""


class NewSessionRequest(BaseModel):
    """创建会话请求"""
    name: str = "未命名会话"
    world_setting: Optional[WorldSetting] = None
    session_config: Optional[SessionConfig] = None
    characters: Optional[dict[str, CharacterState]] = None
    locations: Optional[dict[str, LocationSetting]] = None


class UpdateSettingRequest(BaseModel):
    """更新设定请求"""
    session_id: str
    name: Optional[str] = None
    world_setting: Optional[WorldSetting] = None
    session_config: Optional[SessionConfig] = None
    characters: Optional[dict[str, CharacterState]] = None
    locations: Optional[dict[str, LocationSetting]] = None


class ParseTextRequest(BaseModel):
    """从文本解析会话设定请求"""
    text: str = Field(..., description="用户提供的自由文本，包含小说设定信息")


class AddMainlineRequest(BaseModel):
    """添加文本到主线"""
    text: str = Field(..., description="选入主线的文本")
    note: str = Field(default="", description="备注")
    insert_index: Optional[int] = Field(default=None, description="插入位置，None表示追加到末尾")


class UpdateMainlineEntryRequest(BaseModel):
    """更新主线条目"""
    text: Optional[str] = None
    note: Optional[str] = None


class ReorderMainlineRequest(BaseModel):
    """重新排序主线"""
    entry_ids: list[str] = Field(..., description="按新顺序排列的条目ID列表")


class APIConfigRequest(BaseModel):
    """API配置"""
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o"
