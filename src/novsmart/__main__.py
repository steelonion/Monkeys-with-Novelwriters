"""
NovSmart 启动入口 - 通过 python -m novsmart 启动
"""
import argparse
import os

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="NovSmart - AI小说写作框架")
    parser.add_argument("--debug", action="store_true", help="启用调试模式，在 log/ 目录记录原始请求和返回")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址 (默认 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="监听端口 (默认 8000)")
    args = parser.parse_args()

    if args.debug:
        from .ai_service import enable_debug_mode
        enable_debug_mode()
        print("🔍 调试模式已启用，日志将写入 log/ 目录")

    uvicorn.run("novsmart.main:app", host=args.host, port=args.port, reload=True)


if __name__ == "__main__":
    main()
