"""
FastAPI 后端主入口 - 小说AI写作框架
"""

from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path

from models import (
    GenerateRequest, GenerateResponse, NewSessionRequest,
    UpdateSettingRequest, APIConfigRequest, ParseTextRequest,
    WorldSetting, CharacterState,
)
from ai_service import ai_service
from session_manager import session_manager

app = FastAPI(title="NovSmart - AI小说写作框架", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件 - 前端
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


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
        "api_key_set": bool(ai_service.api_key),
    }


# ────────────────────────────── 会话管理 ──────────────────────────────

@app.post("/api/session/new")
async def create_session(req: NewSessionRequest):
    """创建新会话"""
    session = session_manager.create_session(
        name=req.name,
        world_setting=req.world_setting,
        characters=req.characters,
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
        session_name, world_setting, characters = await ai_service.parse_text_to_session(req.text)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析失败：{str(e)}")

    # 直接创建会话
    session = session_manager.create_session(
        name=session_name,
        world_setting=world_setting,
        characters=characters,
    )
    return session.model_dump()


# ────────────────────────────── 设定管理 ──────────────────────────────

@app.put("/api/session/setting")
async def update_setting(req: UpdateSettingRequest):
    """更新会话的世界设定/角色"""
    session = session_manager.update_setting(
        session_id=req.session_id,
        world_setting=req.world_setting,
        characters=req.characters,
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
        story_text, updated_chars, updated_world = await ai_service.generate(
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
    )

    return GenerateResponse(
        story_text=story_text,
        characters=updated_chars,
        world_setting=updated_world,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
