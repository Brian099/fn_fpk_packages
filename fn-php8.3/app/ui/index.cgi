#!/bin/bash

# 获取脚本所在的物理根目录
SELF_PATH=$(readlink -f "$0")
UI_DIR=$(dirname "$SELF_PATH")
APP_ROOT=$(dirname "$UI_DIR")

# 探测三部曲：寻找 index.html 到底在哪里
if [ -f "$APP_ROOT/target/www/index.html" ]; then
    BASE_PATH="$APP_ROOT/target/www"
elif [ -f "$APP_ROOT/target/index.html" ]; then
    BASE_PATH="$APP_ROOT/target"
elif [ -f "$APP_ROOT/www/index.html" ]; then
    BASE_PATH="$APP_ROOT/www"
else
    # 彻底兜底：列出目录结构用于调试
    echo "Status: 404 Not Found"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "Error: index.html not found in common locations."
    echo "Current APP_ROOT: $APP_ROOT"
    echo "Listing UI_DIR contents:"
    ls -F "$UI_DIR"
    echo "Listing APP_ROOT contents:"
    ls -F "$APP_ROOT"
    if [ -d "$APP_ROOT/target" ]; then
       echo "Listing target contents:"
       ls -F "$APP_ROOT/target"
    fi
    exit 0
fi

API_PATH="$UI_DIR/api.cgi"
URI_NO_QUERY="${REQUEST_URI%%\?*}"

# 动态提取 REL_PATH
if [[ "$URI_NO_QUERY" == *"index.cgi"* ]]; then
    REL_PATH="${URI_NO_QUERY#*index.cgi}"
else
    APP_NAME="php8.3"
    REL_PATH="${URI_NO_QUERY#*/$APP_NAME}"
fi

# 路由重定向
if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then  
    REL_PATH="/index.html"  
fi  

# API 接口直接转发
if [[ "$REL_PATH" == /api/* ]]; then
    if [ -x "$API_PATH" ]; then
        exec "$API_PATH" "$REL_PATH"
    else
        echo "Status: 500 Internal Server Error"
        echo "Content-Type: application/json"
        echo ""
        echo "{\"ok\":false, \"error\":\"API denied or missing at $API_PATH\"}"
    fi
    exit 0
fi

# 资源静态服务
TARGET_FILE="${BASE_PATH}${REL_PATH}"  
if [ -f "$TARGET_FILE" ]; then
    ext="${TARGET_FILE##*.}"  
    case "$ext" in  
        html|htm) mime="text/html; charset=utf-8" ;;  
        css) mime="text/css; charset=utf-8" ;;  
        js) mime="application/javascript; charset=utf-8" ;;  
        png) mime="image/png" ;;  
        jpg|jpeg) mime="image/jpeg" ;;
        svg) mime="image/svg+xml" ;;
        *) mime="application/octet-stream" ;;  
    esac  
    echo "Content-Type: $mime"  
    echo ""  
    cat "$TARGET_FILE"
else
    echo "Status: 404 Not Found"
    echo "Content-Type: text/plain"
    echo ""
    echo "Not Found: $REL_PATH (Checked $TARGET_FILE)"
fi
