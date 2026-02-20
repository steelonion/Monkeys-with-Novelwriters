"""
FastAPI 后端主入口 - 小说AI写作框架
"""

from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path

from .models import (
    GenerateRequest, GenerateResponse, NewSessionRequest,
    UpdateSettingRequest, APIConfigRequest, ParseTextRequest,
    AddMainlineRequest, UpdateMainlineEntryRequest, ReorderMainlineRequest,
    WorldSetting, SessionConfig, CharacterState, LocationSetting,
)
from .ai_service import ai_service, get_active_tasks
from .session_manager import session_manager

app = FastAPI(title="NovSmart - AI小说写作框架", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件 - 前端（包内资源）
FRONTEND_DIR = Path(__file__).parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


# ────────────────────────────── 任务状态 ──────────────────────────────

@app.get("/api/tasks/active")
async def active_tasks():
    """获取当前正在运行的 AI 请求数"""
    return {"active": get_active_tasks()}


# ────────────────────────────── API 配置 ──────────────────────────────

@app.post("/api/config")
async def configure_api(req: APIConfigRequest):
    """配置 OpenAI API"""
    ai_service.configure(api_key=req.api_key, base_url=req.base_url, model=req.model)
    return {"status": "ok", "model": req.model, "base_url": req.base_url}


@app.get("/api/config")
async def get_config():
    """获取当前 API 配置状态"""
    return {
        "configured": ai_service.is_configured,
        "model": ai_service.model,
        "base_url": ai_service.base_url,
        "api_key": ai_service.api_key,
    }


# ────────────────────────────── 会话管理 ──────────────────────────────

@app.post("/api/session/new")
async def create_session(req: NewSessionRequest):
    """创建新会话"""
    session = session_manager.create_session(
        name=req.name,
        world_setting=req.world_setting,
        session_config=req.session_config,
        characters=req.characters,
        locations=req.locations,
    )
    return session.model_dump()


@app.get("/api/session/list")
async def list_sessions():
    """列出所有会话"""
    return session_manager.list_sessions()


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """获取会话详情"""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return session.model_dump()


@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    """删除会话"""
    ok = session_manager.delete_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"status": "ok"}


# ────────────────────────────── 文本解析创建会话 ──────────────────────────────

@app.post("/api/session/parse-text")
async def parse_text_to_session(req: ParseTextRequest):
    """从自由文本解析并创建会话"""
    if not ai_service.is_configured:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="请输入文本内容")

    try:
        session_name, world_setting, session_config, characters, locations = await ai_service.parse_text_to_session(req.text)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析失败：{str(e)}")

    # 直接创建会话
    session = session_manager.create_session(
        name=session_name,
        world_setting=world_setting,
        session_config=session_config,
        characters=characters,
        locations=locations,
    )
    return session.model_dump()


@app.post("/api/parse-text")
async def parse_text_only(req: ParseTextRequest):
    """仅解析文本，返回结构化数据供用户修改，不创建会话"""
    if not ai_service.is_configured:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="请输入文本内容")

    try:
        session_name, world_setting, session_config, characters, locations = await ai_service.parse_text_to_session(req.text)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析失败：{str(e)}")

    return {
        "session_name": session_name,
        "world_setting": world_setting.model_dump(),
        "session_config": session_config.model_dump(),
        "characters": {k: v.model_dump() for k, v in characters.items()},
        "locations": {k: v.model_dump() for k, v in locations.items()},
    }


# ────────────────────────────── 设定管理 ──────────────────────────────

@app.put("/api/session/setting")
async def update_setting(req: UpdateSettingRequest):
    """更新会话的世界设定/角色/地点/名称"""
    session = session_manager.update_setting(
        session_id=req.session_id,
        name=req.name,
        world_setting=req.world_setting,
        session_config=req.session_config,
        characters=req.characters,
        locations=req.locations,
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return session.model_dump()


# ────────────────────────────── 生成 ──────────────────────────────────

@app.post("/api/generate")
async def generate(req: GenerateRequest):
    """生成小说片段"""
    if not ai_service.is_configured:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    session = session_manager.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    try:
        story_text, updated_chars, updated_world, updated_session_config, updated_locations = await ai_service.generate(
            session=session,
            user_prompt=req.user_prompt,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败：{str(e)}")

    # 记录到历史
    step = session_manager.add_step(
        session_id=req.session_id,
        user_prompt=req.user_prompt,
        generated_text=story_text,
        characters=updated_chars,
        world_setting=updated_world,
        session_config=updated_session_config,
        locations=updated_locations,
    )

    return GenerateResponse(
        story_text=story_text,
        characters=updated_chars,
        world_setting=updated_world,
        session_config=updated_session_config,
        locations=updated_locations,
        step_id=step.step_id,
    ).model_dump()


# ────────────────────────────── 撤销 ──────────────────────────────────

@app.post("/api/session/{session_id}/undo")
async def undo(session_id: str):
    """撤销最后一步"""
    ok = session_manager.undo(session_id)
    if not ok:
        raise HTTPException(status_code=400, detail="没有可以撤销的步骤")

    session = session_manager.get_session(session_id)
    return session.model_dump()


# ────────────────────────────── 清理对话历史 ──────────────────────────────

@app.post("/api/session/{session_id}/clear-history")
async def clear_history(session_id: str):
    """清理对话历史，保留设定和主线"""
    ok = session_manager.clear_history(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="会话不存在")

    session = session_manager.get_session(session_id)
    return session.model_dump()


# ────────────────────────────── 文章主线 ────────────────────────────────

@app.get("/api/session/{session_id}/mainline")
async def get_mainline(session_id: str):
    """获取主线内容"""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {
        "mainline": [e.model_dump() for e in session.mainline],
        "mainline_summary": session.mainline_summary,
        "needs_summary_update": session_manager.mainline_needs_summary_update(session),
    }


@app.post("/api/session/{session_id}/mainline/add")
async def add_to_mainline(session_id: str, req: AddMainlineRequest):
    """添加文本到主线"""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    try:
        entry = session_manager.add_mainline_entry(
            session_id=session_id,
            text=req.text,
            note=req.note,
            insert_index=req.insert_index,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 检查是否需要重新生成概述
    session = session_manager.get_session(session_id)
    needs_update = session_manager.mainline_needs_summary_update(session)

    # 自动重新生成概述
    summary = session.mainline_summary
    if needs_update and ai_service.is_configured:
        try:
            summary = await ai_service.generate_mainline_summary(
                session.mainline, session.world_setting
            )
            session_manager.update_mainline_summary(session_id, summary)
        except Exception:
            pass  # 概述生成失败不影响主流程

    return {
        "entry": entry.model_dump(),
        "mainline": [e.model_dump() for e in session.mainline],
        "mainline_summary": summary,
    }


@app.delete("/api/session/{session_id}/mainline/{entry_id}")
async def remove_from_mainline(session_id: str, entry_id: str):
    """从主线中移除条目"""
    ok = session_manager.remove_mainline_entry(session_id, entry_id)
    if not ok:
        raise HTTPException(status_code=404, detail="条目不存在")

    session = session_manager.get_session(session_id)

    # 自动重新生成概述
    summary = session.mainline_summary
    if session.mainline and session_manager.mainline_needs_summary_update(session) and ai_service.is_configured:
        try:
            summary = await ai_service.generate_mainline_summary(
                session.mainline, session.world_setting
            )
            session_manager.update_mainline_summary(session_id, summary)
        except Exception:
            pass
    elif not session.mainline:
        # 主线清空了，清除概述
        session_manager.update_mainline_summary(session_id, "")
        summary = ""

    return {
        "mainline": [e.model_dump() for e in session.mainline],
        "mainline_summary": summary,
    }


@app.put("/api/session/{session_id}/mainline/{entry_id}")
async def update_mainline_entry(session_id: str, entry_id: str, req: UpdateMainlineEntryRequest):
    """更新主线条目"""
    entry = session_manager.update_mainline_entry(
        session_id=session_id,
        entry_id=entry_id,
        text=req.text,
        note=req.note,
    )
    if not entry:
        raise HTTPException(status_code=404, detail="条目不存在")

    session = session_manager.get_session(session_id)

    # 如果文本有变化，自动重新生成概述
    summary = session.mainline_summary
    if req.text is not None and session_manager.mainline_needs_summary_update(session) and ai_service.is_configured:
        try:
            summary = await ai_service.generate_mainline_summary(
                session.mainline, session.world_setting
            )
            session_manager.update_mainline_summary(session_id, summary)
        except Exception:
            pass

    return {
        "entry": entry.model_dump(),
        "mainline": [e.model_dump() for e in session.mainline],
        "mainline_summary": summary,
    }


@app.put("/api/session/{session_id}/mainline/reorder")
async def reorder_mainline(session_id: str, req: ReorderMainlineRequest):
    """重新排序主线条目"""
    ok = session_manager.reorder_mainline(session_id, req.entry_ids)
    if not ok:
        raise HTTPException(status_code=400, detail="重新排序失败，请检查条目ID")

    session = session_manager.get_session(session_id)
    return {
        "mainline": [e.model_dump() for e in session.mainline],
        "mainline_summary": session.mainline_summary,
    }


@app.post("/api/session/{session_id}/mainline/regenerate-summary")
async def regenerate_mainline_summary(session_id: str):
    """手动重新生成主线概述"""
    if not ai_service.is_configured:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    if not session.mainline:
        raise HTTPException(status_code=400, detail="主线无内容")

    try:
        summary = await ai_service.generate_mainline_summary(
            session.mainline, session.world_setting
        )
        session_manager.update_mainline_summary(session_id, summary)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成概述失败：{str(e)}")

    return {
        "mainline_summary": summary,
        "mainline": [e.model_dump() for e in session.mainline],
    }


# ────────────────────────────── 导出 ──────────────────────────────────

@app.get("/api/session/{session_id}/export")
async def export_novel(session_id: str, format: str = "txt"):
    """导出小说为文件"""
    filepath = session_manager.export_novel(session_id, format=format)
    if not filepath:
        raise HTTPException(status_code=400, detail="导出失败(会话不存在或无历史)")

    return FileResponse(
        path=filepath,
        filename=Path(filepath).name,
        media_type="application/octet-stream",
    )


# ────────────────────────────── 前端页面 ──────────────────────────────

@app.get("/")
async def serve_frontend():
    """提供前端页面"""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"error": "前端文件不存在"}, status_code=404)


@app.on_event("startup")
async def on_startup():
    """启动时自动加载已保存的配置"""
    ai_service.load_config()
