#!/bin/bash

# index.cgi for NginxManager (fnOS Standard)
# Version: 1.0.2

# 动态获取应用名称和路径 (根据飞牛规范)
# 假设安装在 /var/apps/NginxManager/target
# 但在开发环境下，我们可能需要更灵活的路径处理
APP_NAME="NginxManager"
BASE_PATH="/var/apps/$APP_NAME/target/www"

# 1. 路径解析
URI_NO_QUERY="${REQUEST_URI%%\?*}"
REL_PATH="/"

case "$URI_NO_QUERY" in
    *index.cgi*)
        REL_PATH="${URI_NO_QUERY#*index.cgi}"
        ;;
esac

if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then
    REL_PATH="/index.html"
fi

# 2. 路由分发 (API 或 静态文件)
if [[ "$REL_PATH" == /api/* ]]; then
    BACKEND_SCRIPT="/var/apps/$APP_NAME/target/server/manager.sh"
    # 本地开发测试兼容性：如果 /var/apps 没挂载，尝试相对路径
    if [ ! -f "$BACKEND_SCRIPT" ]; then
        # 这里的 APP_ROOT 是基于 index.cgi 所在位置推导的
        APP_ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
        BACKEND_SCRIPT="$APP_ROOT/server/manager.sh"
    fi

    ACTION=""
    case "$REL_PATH" in
        "/api/nginx/status")     ACTION="status" ;;
        "/api/nginx/install")    ACTION="install" ;;
        "/api/nginx/start")      ACTION="start" ;;
        "/api/nginx/stop")       ACTION="stop" ;;
        "/api/nginx/restart")    ACTION="restart" ;;
        "/api/nginx/reload")     ACTION="reload" ;;
        "/api/nginx/check")      ACTION="check" ;;
        "/api/nginx/logs")       ACTION="logs" ;;
    esac

    if [ -n "$ACTION" ]; then
        TMP_OUTPUT=$(mktemp)
        if bash "$BACKEND_SCRIPT" "$ACTION" >"$TMP_OUTPUT" 2>/dev/null; then
            echo "Status: 200 OK"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            cat "$TMP_OUTPUT"
        else
            echo "Status: 500 Internal Server Error"
            echo "Content-Type: application/json; charset=utf-8"
            echo ""
            echo '{"error":"后端指令执行失败"}'
        fi
        rm -f "$TMP_OUTPUT"
        exit 0
    fi
fi

# 3. 静态文件服务
# 开发环境兼容逻辑
if [ ! -d "$BASE_PATH" ]; then
    BASE_PATH=$(dirname "$(dirname "$(readlink -f "$0")")")/www
fi

TARGET_FILE="${BASE_PATH}${REL_PATH}"

# 安全检查
if echo "$TARGET_FILE" | grep -q '\.\.' || [ ! -f "$TARGET_FILE" ]; then
    echo "Status: 404 Not Found"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "File not found: $REL_PATH"
    exit 0
fi

# MIME 类型识别
ext="${TARGET_FILE##*.}"
case "$ext" in
    html|htm) mime="text/html; charset=utf-8" ;;
    css)      mime="text/css; charset=utf-8" ;;
    js)       mime="application/javascript; charset=utf-8" ;;
    png)      mime="image/png" ;;
    jpg|jpeg) mime="image/jpeg" ;;
    svg)      mime="image/svg+xml" ;;
    woff)     mime="font/woff" ;;
    woff2)    mime="font/woff2" ;;
    ttf)      mime="font/ttf" ;;
    *)        mime="application/octet-stream" ;;
esac

echo "Content-Type: $mime"
echo ""
cat "$TARGET_FILE"
