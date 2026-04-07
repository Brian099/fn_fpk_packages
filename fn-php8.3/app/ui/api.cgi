#!/bin/bash

# 后端执行 API 处理器
# 依靠此 CGI 接口，网页界面与系统的 PHP/FPM 相通。

echo "Content-Type: application/json; charset=utf-8"
echo ""

# 使用传进来的参数获取路由路径 "/api/..."
ROUTE="$1"

CONF_D_DIR="/etc/php/8.3/fpm/conf.d"
CUSTOM_CONFIG_FILE="$CONF_D_DIR/99-fnos-custom.ini"
FPM_POOL_CONF="/etc/php/8.3/fpm/pool.d/zzz-custom.conf"

# --- 辅助方法区 ---

# 读取 POST body 内容（如果是 JSON 等应用情况）
get_post_body() {
    if [ "$REQUEST_METHOD" = "POST" ] && [ -n "$CONTENT_LENGTH" ]; then
        dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null
    fi
}

send_json() {
    echo '{"ok": true, "data": '"$1"'}'
    exit 0
}

send_error() {
    echo '{"ok": false, "error": "'"$1"'"}'
    exit 0
}

# --- 路由分配逻辑 ---

case "$ROUTE" in

    "/api/status")
        # 检测 php8.3-fpm 服务是否活着
        is_running=false
        if systemctl is-active --quiet php8.3-fpm; then
            is_running=true
        fi
        
        php_ver="unknown"
        if command -v php8.3 >/dev/null 2>&1; then
            php_ver=$(php8.3 -v | head -n1 | grep -o "PHP 8.3.[0-9]*")
        fi

        echo '{"ok":true, "running": '"$is_running"', "version": "'"$php_ver"'"}'
        exit 0
        ;;

    "/api/extensions")
        # 抓取目前 dpkg 安装的扩展、以及 phpenmod 已激活的扩展。
        # 简单实现：使用 php8.3 -m 读取。
        if ! command -v php8.3 >/dev/null 2>&1; then
            echo '{"ok":true, "extensions": []}'
            exit 0
        fi
        
        # 活跃挂载的拓展
        ACTIVE_EXT=$(php8.3 -m | tr '\n' ',' | sed -e 's/,*$//')
        
        # 为了应对离线部署，提供一份可用清单。
        # 返回 JSON 数组形式供前端解析。
        echo '{"ok":true, "active": "'"$ACTIVE_EXT"'"}'
        exit 0
        ;;

    "/api/extensions/toggle")
        # {"extension": "redis", "enable": true}
        body=$(get_post_body)
        ext_name=$(echo "$body" | grep -o '"extension"\s*:\s*"[^"]*"' | cut -d'"' -f4)
        ext_enable=$(echo "$body" | grep -o '"enable"\s*:\s*true') # 有 true 则是启用
        
        if [ -n "$ext_name" ]; then
            if [ -n "$ext_enable" ]; then
                phpenmod -v 8.3 "$ext_name" >/dev/null 2>&1
            else
                phpdismod -v 8.3 "$ext_name" >/dev/null 2>&1
            fi
            systemctl reload php8.3-fpm >/dev/null 2>&1 || true
            echo '{"ok":true}'
            exit 0
        fi
        send_error "Invalid parameters"
        ;;

    "/api/config/get")
        # 读取 99-fnos-custom.ini 内容提供给前台回显
        if [ -f "$CUSTOM_CONFIG_FILE" ]; then
            # 把 ini 文件进行一个最简陋但有效的安全 JSON 封包转义
            content=$(cat "$CUSTOM_CONFIG_FILE" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{printf "%s\\n", $0}')
            echo '{"ok":true, "raw": "'"$content"'"}'
        else
            echo '{"ok":true, "raw": ""}'
        fi
        exit 0
        ;;

    "/api/config/save")
        # 保存新的 INI 内容
        body=$(get_post_body)
        raw_ini=$(echo "$body" | sed -n '/"raw"/,$p' | sed -e 's/^[^{]*"raw"\s*:\s*"//' -e 's/"\s*}*\s*$//' -e 's/\\n/\n/g' -e 's/\\"/"/g' -e 's/\\\\/\\/g')
        
        mkdir -p "$CONF_D_DIR"
        echo "$raw_ini" > "$CUSTOM_CONFIG_FILE"
        systemctl reload php8.3-fpm >/dev/null 2>&1 || true
        echo '{"ok":true}'
        exit 0
        ;;

    "/api/fpm/get")
        # 获取 FPM 参数配置 zzz-custom.conf
        if [ -f "$FPM_POOL_CONF" ]; then
            content=$(cat "$FPM_POOL_CONF" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{printf "%s\\n", $0}')
            echo '{"ok":true, "raw": "'"$content"'"}'
        else
            echo '{"ok":true, "raw": ""}'
        fi
        ;;

    "/api/fpm/save")
        # 保存 FPM 的 Pool 配置覆写
        body=$(get_post_body)
        raw_fpm=$(echo "$body" | sed -n '/"raw"/,$p' | sed -e 's/^[^{]*"raw"\s*:\s*"//' -e 's/"\s*}*\s*$//' -e 's/\\n/\n/g' -e 's/\\"/"/g' -e 's/\\\\/\\/g')
        
        mkdir -p "$(dirname "$FPM_POOL_CONF")"
        
        # 要求必须带上 [www] 防止报错
        echo "$raw_fpm" > "$FPM_POOL_CONF"
        systemctl reload php8.3-fpm >/dev/null 2>&1 || true
        echo '{"ok":true}'
        exit 0
        ;;

    "/api/service/operation")
        # 操作 PHP 8.3 FPM 服务 (start, stop, restart)
        body=$(get_post_body)
        action=$(echo "$body" | grep -o '"action"\s*:\s*"[^"]*"' | cut -d'"' -f4)
        
        if [ "$action" = "start" ]; then
            systemctl start php8.3-fpm >/dev/null 2>&1
        elif [ "$action" = "stop" ]; then
            systemctl stop php8.3-fpm >/dev/null 2>&1
        elif [ "$action" = "restart" ]; then
            systemctl restart php8.3-fpm >/dev/null 2>&1
        else
            send_error "Invalid action: $action"
        fi
        
        echo '{"ok":true}'
        exit 0
        ;;

    *)
        send_error "Endpoint not found: $ROUTE"
        ;;
esac
