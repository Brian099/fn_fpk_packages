#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# The 'www' directory is always a sibling of the 'ui' directory where this script resides
BASE_PATH="$(cd "$SCRIPT_DIR/../www" 2>/dev/null && pwd || echo "/usr/local/apps/@appcenter/imageadmin/www")"

if [ -z "$TRIM_PKGVAR" ]; then
    # For FlyNAS, if not root, data is often in a 'var' directory relative to the installation root
    # index.cgi is in [INSTALL_ROOT]/app/ui/index.cgi, so var is at [INSTALL_ROOT]/var
    INSTALL_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd)"
    if [ -d "$INSTALL_ROOT/var" ]; then
        TRIM_PKGVAR="$INSTALL_ROOT/var"
    else
        TRIM_PKGVAR="/var/apps/imageadmin/var"
    fi
fi
BACKEND_UNIX_SOCKET="${BACKEND_UNIX_SOCKET:-${TRIM_PKGVAR}/imageadmin.sock}"
BACKEND_CONNECT_TIMEOUT="${BACKEND_CONNECT_TIMEOUT:-5}"
BACKEND_MAX_TIME="${BACKEND_MAX_TIME:-300}"

REQUEST_METHOD="${REQUEST_METHOD:-GET}"
REQUEST_URI="${REQUEST_URI:-/}"

BODY_TMP=""
HDR_TMP=""
OUT_BODY=""

cleanup() {
    rm -f "$BODY_TMP" "$HDR_TMP" "$OUT_BODY" 2>/dev/null
}
trap cleanup EXIT

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
    case "$1" in
        ../*|*/../*|*/..|..) return 0 ;;
    esac
    return 1
}



resolve_rel_path() {
    local uri_no_query="$REQUEST_URI"
    uri_no_query="${uri_no_query%%\?*}"
    # Canonicalize entry points to have a trailing slash
    # This is crucial for relative paths in HTML/JS (like static/ or ../api)
    if [ "$uri_no_query" = "/" ] || [ "$uri_no_query" = "" ] || [ "${uri_no_query%/index.cgi}" != "$uri_no_query" ]; then
        local target="index.cgi/"
        [ -n "$SCRIPT_NAME" ] && target="${SCRIPT_NAME%/}/"
        printf "Status: 302 Found\r\n"
        printf "Location: ${target}\r\n\r\n"
        exit 0
    fi

    local rel="/"
    case "$uri_no_query" in
        *index.cgi*)
            rel="${uri_no_query#*index.cgi}"
            ;;
    esac

    if [ -z "$rel" ] || [ "$rel" = "/" ]; then
        rel="/"
    fi

    if [ "${rel#/}" = "$rel" ]; then
        rel="/$rel"
    fi

    printf '%s' "$rel"
}

build_backend_url() {
    local rel_path="$1"
    local query_suffix=""
    if [ -n "${QUERY_STRING:-}" ]; then
        query_suffix="?${QUERY_STRING}"
    fi

    printf '%s' "http://localhost${rel_path}${query_suffix}"
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
            [Ss]et-[Cc]ookie:*|[Cc]ache-[Cc]ontrol:*|[Ee]xpires:*|[Aa]ccess-[Cc]ontrol-[Aa]llow-*|[Ll]ocation:*)
                backend_headers+=("$line")
                ;;
        esac
    done
}

print_cgi_header() {
    printf '%s\r\n' "$1"
}

send_text_response() {
    local status="$1"
    local body="${2:-}"
    print_cgi_header "Status: $status"
    print_cgi_header "Content-Type: text/plain; charset=utf-8"
    print_cgi_header "Content-Length: ${#body}"
    print_cgi_header ""
    [ "$REQUEST_METHOD" != "HEAD" ] && [ -n "$body" ] && printf '%s' "$body"
    exit 0
}

proxy_api_request() {
    local curl_exit body_size

    HDR_TMP="$(create_temp_file)" || send_text_response "500 Internal Server Error" "500 Internal Server Error"
    OUT_BODY="$(create_temp_file)" || send_text_response "500 Internal Server Error" "500 Internal Server Error"

    local curl_args=(
        -sS
        --http1.1
        --connect-timeout "$BACKEND_CONNECT_TIMEOUT"
        --max-time "$BACKEND_MAX_TIME"
        -D "$HDR_TMP"
        -o "$OUT_BODY"
        -X "$REQUEST_METHOD"
        -H "Connection: close"
        -H "X-Internal-Request: true"
    )

    while IFS= read -r header; do
        [ -n "$header" ] && curl_args+=(-H "$header")
    done < <(forward_request_headers)

    if [ "$REQUEST_METHOD" = "POST" ] || [ "$REQUEST_METHOD" = "PUT" ] || [ "$REQUEST_METHOD" = "PATCH" ] || [ "$REQUEST_METHOD" = "DELETE" ]; then
        if [ -n "${CONTENT_LENGTH:-}" ] && [ "${CONTENT_LENGTH:-0}" -gt 0 ] 2>/dev/null; then
            BODY_TMP="$(create_temp_file)" || send_text_response "500 Internal Server Error" "500 Internal Server Error"
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
        send_text_response "503 Service Unavailable" "503 Service Unavailable: Backend socket not found"
    fi

    if [ "$curl_exit" -ne 0 ]; then
        if [ "$curl_exit" -eq 28 ]; then
            send_text_response "504 Gateway Timeout" "504 Gateway Timeout: Backend request timed out"
        fi
        send_text_response "502 Bad Gateway" "502 Bad Gateway: Backend unavailable"
    fi

    parse_backend_response < "$HDR_TMP"

    print_cgi_header "Status: $status_code"
    print_cgi_header "Content-Type: $resp_ct"
    for header in "${backend_headers[@]}"; do
        print_cgi_header "$header"
    done

    if [ -f "$OUT_BODY" ]; then
        body_size="$(wc -c < "$OUT_BODY" 2>/dev/null || echo 0)"
        print_cgi_header "Content-Length: $body_size"
    fi
    print_cgi_header ""

    if [ "$REQUEST_METHOD" != "HEAD" ] && [ -f "$OUT_BODY" ]; then
        cat "$OUT_BODY"
    fi
    exit 0
}



REL_PATH="$(resolve_rel_path)"

# Delegate all requests to the backend Go server.
# The backend is already configured to serve static files from 'www' 
# and handle all /api, /admin, and /login routes.
proxy_api_request
