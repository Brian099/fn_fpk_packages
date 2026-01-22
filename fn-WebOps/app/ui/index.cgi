#!/bin/bash

# ============================================================================
# File Name       : index.cgi
# Version         : 1.0.0
# Author          : FNOSP/xieguanru
# Collaborators   : FNOSP/MR_XIAOBO, RROrg/Ing
# Created         : 2025-11-18
# Last Modified   : 2026-01-14
# Description     : CGI script for serving static files.
# Usage           : Rename this file to index.cgi, place it under the application's /ui directory,
#                   and run `chmod +x index.cgi` to grant execute permission.
# License         : MIT
# ============================================================================

# 【注意】修改你自己的静态文件根目录，以本应用为例：
BASE_PATH="/var/apps/webops/target/www"

# 1. 从 REQUEST_URI 里拿到 index.cgi 后面的路径
#    例如：/cgi/ThirdParty/webops/index.cgi/index.html?foo=bar
#    先去掉 ? 后面的 query string
URI_NO_QUERY="${REQUEST_URI%%\?*}"

# 默认值 (如果没匹配到 index.cgi)
REL_PATH="/"

# 用 index.cgi 作为切割点，取后面的部分
case "$URI_NO_QUERY" in
  *index.cgi*)
    # 去掉前面所有直到 index.cgi 为止的内容，保留后面的
    # /cgi/ThirdParty/webops/index.cgi/index.html -> /index.html
    REL_PATH="${URI_NO_QUERY#*index.cgi}"
    ;;
esac

# 如果为空或只有 /，就默认 /index.html
if [ -z "$REL_PATH" ] || [ "$REL_PATH" = "/" ]; then
  REL_PATH="/index.html"
fi

if [ "$REL_PATH" = "/api/nginx/status" ] || [ "$REL_PATH" = "/api/sites" ] || [ "$REL_PATH" = "/api/php/status" ] || [ "$REL_PATH" = "/api/nginx/install" ] || [ "$REL_PATH" = "/api/php/install" ] || [ "$REL_PATH" = "/api/php/remove" ] || [ "$REL_PATH" = "/api/php/extensions" ] || [ "$REL_PATH" = "/api/fs/list" ] || [ "$REL_PATH" = "/api/sites/create" ] || [ "$REL_PATH" = "/api/settings/get-upload-limit" ] || [ "$REL_PATH" = "/api/settings/set-upload-limit" ] || [ "$REL_PATH" = "/api/sites/update-port" ] || [ "$REL_PATH" = "/api/sites/delete" ] || [ "$REL_PATH" = "/api/sites/enable" ] || [ "$REL_PATH" = "/api/sites/disable" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  BACKEND_SCRIPT="$APP_ROOT/server/sites_backend.sh"
  if [ ! -f "$BACKEND_SCRIPT" ]; then
    echo "Status: 500 Internal Server Error"
    echo "Content-Type: application/json; charset=utf-8"
    echo ""
    echo '{"error":"config script not found"}'
    exit 0
  fi
  TMP_OUTPUT=$(mktemp)
  ACTION=""
  if [ "$REL_PATH" = "/api/sites" ]; then
    ACTION="list-sites-json"
  elif [ "$REL_PATH" = "/api/nginx/status" ]; then
    ACTION="nginx-status"
  elif [ "$REL_PATH" = "/api/php/status" ]; then
    ACTION="php-status"
  elif [ "$REL_PATH" = "/api/nginx/install" ]; then
    ACTION="nginx-install"
  elif [ "$REL_PATH" = "/api/php/install" ]; then
    ACTION="php-install"
  elif [ "$REL_PATH" = "/api/php/extensions" ]; then
    ACTION="php-extensions-status"
  elif [ "$REL_PATH" = "/api/fs/list" ]; then
    ACTION="list-dirs"
  elif [ "$REL_PATH" = "/api/sites/create" ]; then
    ACTION="create-site"
  elif [ "$REL_PATH" = "/api/settings/get-upload-limit" ]; then
    ACTION="get-upload-limit"
  elif [ "$REL_PATH" = "/api/settings/set-upload-limit" ]; then
    ACTION="set-upload-limit"
  elif [ "$REL_PATH" = "/api/sites/update-port" ]; then
    ACTION="update-site-port"
  elif [ "$REL_PATH" = "/api/sites/delete" ]; then
    ACTION="delete-site"
  elif [ "$REL_PATH" = "/api/sites/enable" ]; then
    ACTION="enable-site"
  elif [ "$REL_PATH" = "/api/sites/disable" ]; then
    ACTION="disable-site"
  else
    ACTION="php-remove"
  fi
  if bash "$BACKEND_SCRIPT" "$ACTION" >"$TMP_OUTPUT" 2>/dev/null; then
    echo "Status: 200 OK"
    echo "Content-Type: application/json; charset=utf-8"
    echo ""
    cat "$TMP_OUTPUT"
  else
    echo "Status: 500 Internal Server Error"
    echo "Content-Type: application/json; charset=utf-8"
    echo ""
    echo '{"error":"backend action failed"}'
  fi
  rm -f "$TMP_OUTPUT"
  exit 0
fi

if [[ $REL_PATH == /api* ]]; then
  BACKEND_UNIX_SOCKET="${BACKEND_UNIX_SOCKET:-${SCHEDULER_UNIX_SOCKET:-/usr/local/apps/@appdata/webops/scheduler.sock}}"
  BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
  BACKEND_PORT="${BACKEND_PORT:-28256}"

  # 收集请求体
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    BODY_TMP=$(mktemp)
    dd bs=1 count="$CONTENT_LENGTH" of="$BODY_TMP" 2>/dev/null || cat >"$BODY_TMP"
  else
    BODY_TMP=$(mktemp)
    : >"$BODY_TMP"
  fi

  HDR_TMP=$(mktemp)
  OUT_BODY=$(mktemp)

  # 收集所有 HTTP 请求头
  curl_args=(-sS -D "$HDR_TMP" -o "$OUT_BODY" -X "$REQUEST_METHOD")
  for hdr in CONTENT_TYPE HTTP_AUTHORIZATION REDIRECT_HTTP_AUTHORIZATION HTTP_ACCEPT HTTP_COOKIE HTTP_USER_AGENT HTTP_REFERER; do
    val="${!hdr}"
    case "$hdr" in
      CONTENT_TYPE) [ -n "$val" ] && curl_args+=(-H "Content-Type: $val") ;;
      HTTP_AUTHORIZATION | REDIRECT_HTTP_AUTHORIZATION) [ -n "$val" ] && curl_args+=(-H "Authorization: $val") ;;
      HTTP_ACCEPT) [ -n "$val" ] && curl_args+=(-H "Accept: $val") ;;
      HTTP_COOKIE) [ -n "$val" ] && curl_args+=(-H "Cookie: $val") ;;
      HTTP_USER_AGENT) [ -n "$val" ] && curl_args+=(-H "User-Agent: $val") ;;
      HTTP_REFERER) [ -n "$val" ] && curl_args+=(-H "Referer: $val") ;;
    esac
  done

  # 支持 X-Forwarded-For
  if [ -n "$REMOTE_ADDR" ]; then
    curl_args+=(-H "X-Forwarded-For: $REMOTE_ADDR")
  fi

  case "$REQUEST_METHOD" in
    POST | PUT | PATCH)
      curl_args+=(--data-binary "@$BODY_TMP")
      ;;
  esac

  # 代理请求
  if [ -n "$BACKEND_UNIX_SOCKET" ] && [ -S "$BACKEND_UNIX_SOCKET" ]; then
    BACKEND_URL="http://localhost${REL_PATH}"
    curl --unix-socket "$BACKEND_UNIX_SOCKET" "${curl_args[@]}" "$BACKEND_URL"
    CURL_EXIT=$?
  else
    BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}${REL_PATH}"
    curl "${curl_args[@]}" "$BACKEND_URL"
    CURL_EXIT=$?
  fi

  # 解析响应
  status_line=$(head -n1 "$HDR_TMP" 2>/dev/null || echo "HTTP/1.1 502 Bad Gateway")
  status_code=$(echo "$status_line" | awk '{print $2}' 2>/dev/null || echo "502")
  resp_ct=$(grep -i '^Content-Type:' "$HDR_TMP" | head -n1 | sed -e 's/^[Cc]ontent-[Tt]ype:[[:space:]]*//')
  if [ -z "$resp_ct" ]; then
    resp_ct="application/octet-stream"
  fi

  # 透传部分响应头
  grep -i -E '^(Set-Cookie:|Cache-Control:|Expires:|Access-Control-Allow-|Content-Disposition:)' "$HDR_TMP" | while read -r h; do
    echo "$h"
  done

  # 错误处理
  if [ "$CURL_EXIT" -ne 0 ]; then
    echo "Status: 502 Bad Gateway"
    echo "Content-Type: text/plain; charset=utf-8"
    echo ""
    echo "502 Bad Gateway: Backend unavailable"
    rm -f "$HDR_TMP" "$BODY_TMP" "$OUT_BODY"
    exit 0
  fi

  echo "Status: $status_code"
  echo "Content-Type: $resp_ct"
  echo ""
  cat "$OUT_BODY"

  rm -f "$HDR_TMP" "$BODY_TMP" "$OUT_BODY"
  exit 0
fi

# 拼出真实文件路径: BASE_PATH + /ui + index.cgi 后面的路径
TARGET_FILE="${BASE_PATH}${REL_PATH}"

# 简单防御：禁止 .. 越级访问
if echo "$TARGET_FILE" | grep -q '\.\.'; then
  echo "Status: 400 Bad Request"
  echo "Content-Type: text/plain; charset=utf-8"
  echo ""
  echo "Bad Request: Path traversal detected"
  exit 0
fi

# 2. 判断文件是否存在
if [ ! -f "$TARGET_FILE" ]; then
  echo "Status: 404 Not Found"
  echo "Content-Type: text/plain; charset=utf-8"
  echo ""
  echo "404 Not Found: ${REL_PATH}"
  exit 0
fi

# 3. 根据扩展名简单判断 Content-Type
ext="${TARGET_FILE##*.}"
ext_lc="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"

case "$ext_lc" in
  html | htm)
    mime="text/html; charset=utf-8"
    ;;
  css)
    mime="text/css; charset=utf-8"
    ;;
  js)
    mime="application/javascript; charset=utf-8"
    ;;
  cgi)
    mime="application/x-httpd-cgi"
    ;;
  jpg | jpeg)
    mime="image/jpeg"
    ;;
  png)
    mime="image/png"
    ;;
  gif)
    mime="image/gif"
    ;;
  svg)
    mime="image/svg+xml"
    ;;
  txt | log)
    mime="text/plain; charset=utf-8"
    ;;
  json)
    mime="application/json; charset=utf-8"
    ;;
  xml)
    mime="application/xml; charset=utf-8"
    ;;
  *)
    mime="application/octet-stream"
    ;;
esac

# 支持 If-Modified-Since 返回 304
mtime=0
if stat_cmd="$(command -v stat 2>/dev/null)" && [ -n "$stat_cmd" ]; then
  mtime=$(stat -c %Y "$TARGET_FILE" 2>/dev/null || echo 0)
  size=$(stat -c %s "$TARGET_FILE" 2>/dev/null || echo 0)
else
  # 回退：用 Python 获取
  size=$(python -c "import os,sys;print(os.path.getsize(sys.argv[1]))" "$TARGET_FILE" 2>/dev/null || echo 0)
  mtime=$(python -c "import os,sys;print(int(os.path.getmtime(sys.argv[1])))" "$TARGET_FILE" 2>/dev/null || echo 0)
fi

last_mod="$(date -u -d "@$mtime" +"%a, %d %b %Y %H:%M:%S GMT" 2>/dev/null || date -u -r "$TARGET_FILE" +"%a, %d %b %Y %H:%M:%S GMT" 2>/dev/null || echo "")"

if [ -n "${HTTP_IF_MODIFIED_SINCE:-}" ]; then
  ims_epoch=$(date -d "$HTTP_IF_MODIFIED_SINCE" +%s 2>/dev/null || echo 0)
  if [ "$ims_epoch" -ge "$mtime" ] && [ "$mtime" -gt 0 ]; then
    echo "Status: 304 Not Modified"
    echo ""
    exit 0
  fi
fi

# 4. 输出头
printf 'Content-Type: %s\r\n' "$mime"
printf 'Content-Length: %s\r\n' "$size"
printf 'Last-Modified: %s\r\n' "$last_mod"
printf '\r\n'

# 对于 HEAD 请求只返回头
if [ "${REQUEST_METHOD:-GET}" = "HEAD" ]; then
  exit 0
fi

cat "$TARGET_FILE"
