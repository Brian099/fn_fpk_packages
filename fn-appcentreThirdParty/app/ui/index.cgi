#!/bin/bash

BASE_PATH="${TRIM_APPDEST:-/usr/local/apps/@appcenter/fn-appcentreThirdParty}/www"
BACKEND_UNIX_SOCKET="${BACKEND_UNIX_SOCKET:-${TRIM_PKGVAR:-/usr/local/apps/@appdata/fn-appcentreThirdParty}/appcentre.sock}"
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
        jpg|jpeg) printf '%s' "image/jpeg" ;;
        gif) printf '%s' "image/gif" ;;
        ico) printf '%s' "image/x-icon" ;;
        webp) printf '%s' "image/webp" ;;
        woff) printf '%s' "font/woff" ;;
        woff2) printf '%s' "font/woff2" ;;
        ttf) printf '%s' "font/ttf" ;;
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

serve_static_file() {
    local target_file mime size last_mod mtime ims_epoch

    if is_path_traversal "${REL_PATH#/}"; then
        send_text_response "400 Bad Request" "Bad Request: Path traversal detected"
    fi

    target_file="${BASE_PATH}${REL_PATH}"

    if [ ! -f "$target_file" ] || [ ! -r "$target_file" ]; then
        send_text_response "404 Not Found" "404 Not Found: ${REL_PATH}"
    fi

    mime="$(detect_mime "$target_file")"
    size="$(wc -c < "$target_file" 2>/dev/null || echo 0)"
    mtime=0
    if stat -c %Y "$target_file" >/dev/null 2>&1; then
        mtime="$(stat -c %Y "$target_file" 2>/dev/null || echo 0)"
    fi

    last_mod=""
    if [ "$mtime" -gt 0 ]; then
        last_mod="$(date -u -d "@$mtime" +"%a, %d %b %Y %H:%M:%S GMT" 2>/dev/null || date -u -r "$target_file" +"%a, %d %b %Y %H:%M:%S GMT" 2>/dev/null || echo "")"
    fi

    if [ -n "${HTTP_IF_MODIFIED_SINCE:-}" ] && [ -n "$last_mod" ]; then
        ims_epoch="$(date -d "$HTTP_IF_MODIFIED_SINCE" +%s 2>/dev/null || echo 0)"
        if [ "$mtime" -gt 0 ] && [ "$ims_epoch" -ge "$mtime" ]; then
            print_cgi_header "Status: 304 Not Modified"
            print_cgi_header ""
            exit 0
        fi
    fi

    print_cgi_header "Content-Type: $mime"
    print_cgi_header "Content-Length: $size"
    [ -n "$last_mod" ] && print_cgi_header "Last-Modified: $last_mod"
    print_cgi_header ""

    if [ "$REQUEST_METHOD" != "HEAD" ]; then
        cat "$target_file"
    fi
    exit 0
}

REL_PATH="$(resolve_rel_path)"

case "$REL_PATH" in
    /api | /api/*)
        proxy_api_request
        ;;
    *)
        serve_static_file
        ;;
esac
