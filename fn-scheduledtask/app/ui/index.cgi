#!/bin/bash

BASE_PATH="/var/apps/fn-scheduledtask/target/www"
PYTHON_BIN="${PYTHON_BIN:-python3}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-${TRIM_SERVICE_PORT:-28257}}"
BACKEND_UNIX_SOCKET="${BACKEND_UNIX_SOCKET:-${TRIM_PKGVAR:-/var/apps/fn-scheduledtask/var}/scheduler.sock}"
BACKEND_CONNECT_TIMEOUT="${BACKEND_CONNECT_TIMEOUT:-5}"
BACKEND_MAX_TIME="${BACKEND_MAX_TIME:-30}"

REQUEST_METHOD="${REQUEST_METHOD:-GET}"
REQUEST_URI="${REQUEST_URI:-/}"

trim_header_value() {
    local value="$1"
    value="${value#*:}"
    value="${value#"${value%%[![:space:]]*}"}"
    printf '%s' "${value%$'\r'}"
}

create_temp_file() {
    mktemp 2>/dev/null || return 1
}

is_path_traversal() {
    local path="$1"
    case "$path" in
        ../*|*/../*|*/..|..) return 0 ;;
    esac
    return 1
}

detect_mime() {
    local file_path="$1"
    local ext="${file_path##*.}"
    ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"
    case "$ext" in
        html|htm) printf '%s' "text/html; charset=utf-8" ;;
        css) printf '%s' "text/css; charset=utf-8" ;;
        js) printf '%s' "application/javascript; charset=utf-8" ;;
        json) printf '%s' "application/json; charset=utf-8" ;;
        svg) printf '%s' "image/svg+xml" ;;
        png) printf '%s' "image/png" ;;
        ico) printf '%s' "image/x-icon" ;;
        *) printf '%s' "application/octet-stream" ;;
    esac
}

resolve_rel_path() {
    local uri_no_query="$REQUEST_URI"
    uri_no_query="${uri_no_query%%\?*}"
    local rel="/"

    case "$uri_no_query" in
        *index.cgi*)
            rel="${uri_no_query#*index.cgi}"
            ;;
    esac

    if [ -z "$rel" ] || [ "$rel" = "/" ]; then
        rel="/index.html"
    fi

    if [ "${rel#/}" = "$rel" ]; then
        rel="/$rel"
    fi

    case "$rel" in
        */) rel="${rel}index.html" ;;
    esac

    printf '%s' "$rel"
}

build_backend_url() {
    local rel_path="$1"
    local query_suffix=""
    if [ -n "${QUERY_STRING:-}" ]; then
        query_suffix="?${QUERY_STRING}"
    fi

    if [ -n "$BACKEND_UNIX_SOCKET" ] && [ -S "$BACKEND_UNIX_SOCKET" ]; then
        printf '%s' "http://localhost${rel_path}${query_suffix}"
    else
        printf '%s' "http://${BACKEND_HOST}:${BACKEND_PORT}${rel_path}${query_suffix}"
    fi
}

forward_request_headers() {
    local curl_args=()
    local header_name value

    for env_name in \
        CONTENT_TYPE \
        HTTP_AUTHORIZATION \
        HTTP_ACCEPT \
        HTTP_ACCEPT_LANGUAGE \
        HTTP_COOKIE \
        HTTP_USER_AGENT \
        HTTP_REFERER \
        HTTP_IF_NONE_MATCH \
        HTTP_IF_MODIFIED_SINCE
    do
        value="${!env_name}"
        [ -n "$value" ] || continue

        case "$env_name" in
            CONTENT_TYPE) header_name="Content-Type" ;;
            HTTP_AUTHORIZATION) header_name="Authorization" ;;
            HTTP_ACCEPT) header_name="Accept" ;;
            HTTP_ACCEPT_LANGUAGE) header_name="Accept-Language" ;;
            HTTP_COOKIE) header_name="Cookie" ;;
            HTTP_USER_AGENT) header_name="User-Agent" ;;
            HTTP_REFERER) header_name="Referer" ;;
            HTTP_IF_NONE_MATCH) header_name="If-None-Match" ;;
            HTTP_IF_MODIFIED_SINCE) header_name="If-Modified-Since" ;;
            *) continue ;;
        esac
        curl_args+=(-H "${header_name}: ${value}")
    done

    printf '%s\n' "${curl_args[@]}"
}

parse_backend_response() {
    local line
    status_code="502"
    resp_ct="application/octet-stream"
    backend_headers=()

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        [ -n "$line" ] || continue

        case "$line" in
            HTTP/*)
                set -- $line
                status_code="${2:-502}"
                ;;
            [Cc]ontent-[Tt]ype:*)
                resp_ct="$(trim_header_value "$line")"
                ;;
            [Ss]et-[Cc]ookie:*|[Cc]ache-[Cc]ontrol:*|[Ee]xpires:*|[Aa]ccess-[Cc]ontrol-[Aa]llow-*)
                backend_headers+=("$line")
                ;;
        esac
    done
}

proxy_api_request() {
    local curl_exit body_size
    local curl_args=()

    HDR_TMP="$(create_temp_file)" || { echo "Status: 500"; echo "Content-Type: text/plain"; echo ""; echo "500 Internal Server Error"; exit 0; }
    OUT_BODY="$(create_temp_file)" || { echo "Status: 500"; echo "Content-Type: text/plain"; echo ""; echo "500 Internal Server Error"; exit 0; }

    curl_args=(
        -sS
        --http1.1
        --connect-timeout "$BACKEND_CONNECT_TIMEOUT"
        --max-time "$BACKEND_MAX_TIME"
        -D "$HDR_TMP"
        -o "$OUT_BODY"
        -X "$REQUEST_METHOD"
        -H "Connection: close"
    )

    while IFS= read -r header; do
        [ -n "$header" ] && curl_args+=(-H "$header")
    done < <(forward_request_headers)

    if [ "$REQUEST_METHOD" = "POST" ] || [ "$REQUEST_METHOD" = "PUT" ] || [ "$REQUEST_METHOD" = "PATCH" ] || [ "$REQUEST_METHOD" = "DELETE" ]; then
        if [ -n "${CONTENT_LENGTH:-}" ] && [ "${CONTENT_LENGTH:-0}" -gt 0 ] 2>/dev/null; then
            BODY_TMP="$(create_temp_file)" || exit 1
            dd bs=1 count="$CONTENT_LENGTH" of="$BODY_TMP" 2>/dev/null || cat >"$BODY_TMP"
            [ -n "$BODY_TMP" ] && [ -f "$BODY_TMP" ] && curl_args+=(--data-binary "@$BODY_TMP")
        fi
    fi

    local backend_url
    backend_url="$(build_backend_url "$REL_PATH")"

    if [ -n "$BACKEND_UNIX_SOCKET" ] && [ -S "$BACKEND_UNIX_SOCKET" ]; then
        curl --unix-socket "$BACKEND_UNIX_SOCKET" "${curl_args[@]}" "$backend_url"
        curl_exit=$?
    else
        curl "${curl_args[@]}" "$backend_url"
        curl_exit=$?
    fi

    if [ "$curl_exit" -ne 0 ]; then
        if [ "$curl_exit" -eq 28 ]; then
            echo "Status: 504"
            echo "Content-Type: text/plain"
            echo ""
            echo "504 Gateway Timeout"
        else
            echo "Status: 502"
            echo "Content-Type: text/plain"
            echo ""
            echo "502 Bad Gateway"
        fi
        rm -f "$HDR_TMP" "$OUT_BODY" "$BODY_TMP" 2>/dev/null
        exit 0
    fi

    parse_backend_response < "$HDR_TMP"

    echo "Status: $status_code"
    echo "Content-Type: $resp_ct"
    for header in "${backend_headers[@]}"; do
        echo "$header"
    done

    if [ -f "$OUT_BODY" ]; then
        body_size="$(wc -c < "$OUT_BODY" 2>/dev/null || echo 0)"
        echo "Content-Length: $body_size"
    fi
    echo ""

    if [ "$REQUEST_METHOD" != "HEAD" ] && [ -f "$OUT_BODY" ]; then
        cat "$OUT_BODY"
    fi

    rm -f "$HDR_TMP" "$OUT_BODY" "$BODY_TMP" 2>/dev/null
    exit 0
}

serve_static_file() {
    local target_file="$1"
    local mime size last_mod

    if is_path_traversal "${target_file#/}"; then
        echo "Status: 400"
        echo "Content-Type: text/plain"
        echo ""
        echo "400 Bad Request"
        exit 0
    fi

    target_file="${BASE_PATH}${target_file}"

    if [ ! -f "$target_file" ] || [ ! -r "$target_file" ]; then
        echo "Status: 404"
        echo "Content-Type: text/plain"
        echo ""
        echo "404 Not Found"
        exit 0
    fi

    mime="$(detect_mime "$target_file")"
    size="$(wc -c < "$target_file" 2>/dev/null || echo 0)"

    echo "Status: 200"
    echo "Content-Type: $mime"
    echo "Content-Length: $size"
    echo ""

    if [ "$REQUEST_METHOD" != "HEAD" ]; then
        cat "$target_file"
    fi
    exit 0
}

REL_PATH="$(resolve_rel_path)"

if [[ "$REL_PATH" == /api/* ]]; then
    proxy_api_request
elif [ "$REQUEST_METHOD" = "GET" ] || [ "$REQUEST_METHOD" = "HEAD" ]; then
    serve_static_file "$REL_PATH"
else
    echo "Status: 405"
    echo "Content-Type: text/plain"
    echo ""
    echo "405 Method Not Allowed"
fi
