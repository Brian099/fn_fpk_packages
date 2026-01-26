#!/bin/bash

# 脚本名称: web_configer_for_FN.sh
# 脚本作用: 在飞牛系统上安装nginx, php, 及php常用扩展，配置php上传文件大小限制，配置网站服务。
# 作者: Brian

# 日志：
# 2.7 修复systemctl.reload 拼写错误
# 2.6 调整网站安装配置逻辑
# 2.5 增加https端口和配置证书功能，https配置须先设置域名
# 2.4 合并域名和端口配置功能，优化配置流程
# 2.3 修复上传文件大小限制查询
# 2.2 增加菜单操作
# 2.1 增加已配置网站检测
# 2.0 修正rewrite写入规则
# 1.9 增加Nginx上传文件大小配置功能，与PHP配置保持同步
# 1.8 优化重启nginx，防止把系统nginx一起重启了导致网页中断。
# 1.7 修复了重复名称/端口检测、清理损坏符号链接、以及删除与配置的小问题，
# 1.6 增加配置php上传文件大小功能
# 1.5 优化脚本运行代码色彩
# 1.4 增加删除网站功能

# 使用方法：
#   直接运行: bash web_configer_for_FN.sh

# 附加
# 如需配置网站伪静态，在文件rewrite.conf中配置好，然后执行菜单中的"安装并配置新网站"，脚本会自动把伪静态追加到nginx配置中
# 如网站需要数据库，使用 docker 安装 mysql+phpmyadmin.yml 安装docker版mysql数据库和phpmyadmin管理工具，网站配置时，数据库地址填写172.17.0.1

show_main_menu() {
    clear
    green_success "=============================================="
    green_success "      飞牛系统网站管理脚本 - 欢迎使用"
    green_success "=============================================="
    echo ""
    echo "请选择操作："
    echo "  1) 安装并配置新网站"
    echo "  2) 删除当前目录网站配置"
    echo "  3) 删除其他已安装网站（按名称或端口）"
    echo "  4) 查询并修改上传文件大小限制"
    echo "  5) 安装 Docker 数据库 (MySQL + phpMyAdmin)"
    echo "  6) 安装 HTTPS 证书管理服务 (httpsok)"
    echo "  7) 查看帮助信息"
    echo "  0) 退出脚本"
    echo ""
    yellow_prompt "请输入选项 [0-7]: "
    read -r choice

    case $choice in
        1)
            install_process
            configure_website
            ;;
        2)
            remove_current_website
            ;;
        3)
            prompt_remove_website
            ;;
        4)
            query_php_upload_settings
            ;;
        5)
            install_mysql_docker
            ;;
        6)
            install_httpsok_service
            ;;
        7)
            show_usage
            ;;
        0)
            echo "退出脚本"
            exit 0
            ;;
        *)
            red_error "无效选项，请重新输入"
            sleep 1
            show_main_menu
            ;;
    esac
}

# 颜色设置函数
set_colors() {
    # 文本颜色
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    MAGENTA='\033[0;35m'
    CYAN='\033[0;36m'
    WHITE='\033[1;37m'
    # 背景颜色
    BG_RED='\033[41m'
    BG_GREEN='\033[42m'
    BG_YELLOW='\033[43m'
    # 重置颜色
    RESET='\033[0m'
    # 粗体
    BOLD='\033[1m'
}

# 初始化颜色
set_colors

# 黄色提示函数
yellow_prompt() {
    echo -e "${YELLOW}$1${RESET}"
}

# 红色错误函数
red_error() {
    echo -e "${RED}$1${RESET}"
}

# 绿色成功函数
green_success() {
    echo -e "${GREEN}$1${RESET}"
}

# 蓝色信息函数
blue_info() {
    echo -e "${BLUE}$1${RESET}"
}

# 检查并切换到 root 账户
check_and_switch_to_root() {
    if [ "$(id -u)" -ne 0 ]; then
        red_error "当前用户不是 root，需要 root 权限执行此脚本"
        yellow_prompt "正在切换到 root 账户..."
        
        # 获取脚本的绝对路径
        SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
        
        echo "脚本路径: $SCRIPT_PATH"
        
        # 检查脚本文件是否存在
        if [ ! -f "$SCRIPT_PATH" ]; then
            red_error "错误：找不到脚本文件 $SCRIPT_PATH"
            exit 1
        fi
        
        # 使用 sudo 执行绝对路径的脚本
        exec sudo bash "$SCRIPT_PATH"
    fi
    
    echo "当前运行用户: $(whoami)"
    echo "用户 ID: $(id -u)"
    echo "当前目录: $(pwd)"
}

# 显示使用帮助
show_usage() {
    echo "使用方法:"
    echo "  直接运行脚本并选择菜单选项即可"
    echo ""
    echo "功能说明:"
    echo "  1. 安装并配置新网站 - 支持端口访问、域名绑定和HTTPS"
    echo "  2. 删除当前目录网站配置 - 删除当前目录下的网站配置"
    echo "  3. 高级删除网站 - 按网站名称或端口号删除"
    echo "  4. 查询并修改上传设置 - 查看和修改PHP/Nginx上传限制"
    echo "  5. 安装 Docker 数据库 - 安装MySQL和phpMyAdmin"
    echo "  6. 安装 HTTPS 服务 - 安装httpsok证书管理服务"
    echo "  7. 查看帮助信息 - 显示此帮助信息"
    echo ""
    echo "HTTPS配置说明:"
    echo "  - 配置网站时如有域名，可选择启用HTTPS"
    echo "  - 需要先安装httpsok服务（菜单选项6）"
    echo "  - httpsok会自动管理证书申请和续期"
    echo "  - 证书存储在网站目录的certs/文件夹中"
    echo ""

    yellow_prompt "按回车返回主菜单..."
    read -r
}

install_mysql_docker() {
    clear
    green_success "=============================================="
    green_success "   安装 Docker MySQL + phpMyAdmin（仅安装，管理操作请前往docker应用）"
    green_success "=============================================="
    echo ""
    # ===== 安装前检查：是否已存在 mysql / phpmyadmin 容器 =====
    if docker ps -a --format '{{.Names}}' | grep -Ei '(mysql|phpmyadmin)' >/dev/null; then
        red_error "检测到系统中已存在 MySQL 或 phpMyAdmin 容器"
        yellow_prompt "请在 Docker 面板中先处理已有数据库容器后再安装"
        yellow_prompt "按回车返回主菜单..."
        read -r
        return
    fi
    yellow_prompt "请输入数据库安装目录（同时作为数据保存目录）:"
    read -r DB_DIR

    if [ -z "$DB_DIR" ]; then
        red_error "目录不能为空"
        yellow_prompt "按回车返回..."
        read -r
        return
    fi

    if [ -f "$DB_DIR/docker-compose.yml" ]; then
        red_error "检测到该目录已存在 docker-compose.yml"
        red_error "请确认不是重复安装"
        yellow_prompt "按回车返回..."
        read -r
        return
    fi

    read -rsp "请输入 MySQL root 密码: " MYSQL_ROOT_PASSWORD
    echo
    read -rsp "请再次确认 MySQL root 密码: " MYSQL_ROOT_PASSWORD_CONFIRM
    echo

    if [ "$MYSQL_ROOT_PASSWORD" != "$MYSQL_ROOT_PASSWORD_CONFIRM" ]; then
        red_error "两次输入的密码不一致"
        yellow_prompt "按回车返回..."
        read -r
        return
    fi

    mkdir -p "$DB_DIR"/{data,logs,config}

    cat > "$DB_DIR/docker-compose.yml" <<EOF
services:
  mysql:
    image: mysql:latest
    restart: always
    ports:
      - "3306:3306"
      - "33060:33060"
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_CHARACTER_SET_SERVER: utf8mb4
      MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
    volumes:
      - ./data:/var/lib/mysql
      - ./logs:/var/log/mysql
      - ./config:/etc/mysql/conf.d
    extra_hosts:
      - "host.docker.internal:host-gateway"

  phpmyadmin:
    image: phpmyadmin/phpmyadmin:latest
    restart: always
    ports:
      - "8080:80"
    environment:
      PMA_HOST: mysql
      PMA_PORT: 3306
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    depends_on:
      - mysql
EOF

    cd "$DB_DIR" || return

    docker compose -p fn-mysql up -d

    echo ""
    green_success "=============================================="
    green_success "🎉 数据库安装完成"
    green_success "=============================================="
    blue_info "MySQL 连接信息："
    echo "  地址: 172.17.0.1"
    echo "  端口: 3306"
    echo "  用户: root"
    echo ""
    blue_info "phpMyAdmin："
    echo "  http://服务器IP:8080"
    echo ""
    yellow_prompt "数据库后续管理请使用 Docker 面板"
    yellow_prompt "按回车返回主菜单..."
    read -r
}

# 安装 HTTPS 证书管理服务 (httpsok)
install_httpsok_service() {
    clear
    green_success "=============================================="
    green_success "     安装 HTTPS 证书管理服务 (httpsok)"
    green_success "=============================================="
    echo ""
    echo "httpsok 是一个自动化的HTTPS证书管理工具，"
	echo "此工具将在服务器安装一个服务来检测网站绑定的证书有效期，在有效期结束前自动延期。"
    echo ""
    echo "使用说明："
    echo "  1. 访问 https://httpsok.com/ 注册账号，申请证书"
    echo "  2. 在首页获取nginx安装命令"
    echo "  3. 下一步输入并回车即可。"
    echo ""
    echo "典型安装命令示例："
    echo "  curl -s https://get.httpsok.com/ | bash -s ko3r01Dx9zXHZMcxxxxf"
    echo ""
    
    echo ""
    yellow_prompt "请输入完整的 httpsok 安装命令（可直接粘贴）："
    read -r install_command
    
    if [ -z "$install_command" ]; then
        red_error "错误：安装命令不能为空"
        yellow_prompt "按回车返回主菜单..."
        read -r
        return
    fi
    
    # 验证命令格式
    if ! echo "$install_command" | grep -q "curl.*httpsok.com"; then
        red_error "警告：命令格式可能不正确"
        echo "预期格式: curl -s https://get.httpsok.com/ | bash -s <your-token>"
        yellow_prompt "是否继续执行？(y/N): "
        read -r continue_execute
        if [[ ! "$continue_execute" =~ ^[yY]$ ]]; then
            echo "操作已取消"
            yellow_prompt "按回车返回主菜单..."
            read -r
            return
        fi
    fi
    
    yellow_prompt "确认执行安装？(Y/n): "
    read -r confirm_install
    
    if [[ "$confirm_install" =~ ^[nN]$ ]]; then
        echo "安装已取消"
        echo "您可以在需要时手动执行命令"
    else
        blue_info "正在安装 httpsok 服务..."
        echo ""
        
        # 执行安装命令
        echo "执行安装命令..."
        echo "----------------------------------------"
        
        # 使用eval执行命令，但先显示命令内容
        if eval "$install_command"; then
            echo "----------------------------------------"
            green_success "✅ httpsok 证书安装更新完成！"
            echo ""
        else
            echo "----------------------------------------"
            red_error "❌ httpsok 安装过程中出现问题"
            echo ""
            yellow_prompt "💡 排错建议："
            echo "  1. 检查网络连接"
            echo "  2. 确认token是否正确"
            echo "  3. 尝试手动执行命令："
            echo "     $install_command"
        fi
    fi
    
    echo ""
    yellow_prompt "按回车返回主菜单..."
    read -r
}

# 安全重启系统 Nginx 函数
restart_system_nginx() {
    blue_info "正在安全重启系统 Nginx..."
    
    # 获取两个 Nginx 实例的 PID
    SYSTEM_NGINX_PID=$(pgrep -f "/usr/sbin/nginx" | head -1)
    CUSTOM_NGINX_PID=$(pgrep -f "/usr/trim/nginx/sbin/nginx" | head -1)
    
    echo "系统 Nginx PID: $SYSTEM_NGINX_PID"
    echo "自定义 Nginx PID: $CUSTOM_NGINX_PID"
    
    if [ -n "$SYSTEM_NGINX_PID" ]; then
        # 方法1: 使用 HUP 信号（平滑重启）
        blue_info "向系统 Nginx 发送 HUP 信号..."
        if kill -HUP "$SYSTEM_NGINX_PID"; then
            green_success "系统 Nginx 平滑重启完成"
            sleep 2
            
            # 验证重启是否成功
            if pgrep -f "/usr/sbin/nginx" >/dev/null; then
                green_success "系统 Nginx 重启验证成功"
            else
                red_error "系统 Nginx 重启后未运行，尝试完整重启..."
                systemctl start nginx
            fi
        else
            red_error "HUP 信号发送失败，尝试完整重启..."
            systemctl restart nginx
        fi
    else
        red_error "系统 Nginx 未运行，启动服务..."
        systemctl start nginx
    fi
    
    # 验证自定义 Nginx 是否仍在运行
    if [ -n "$CUSTOM_NGINX_PID" ]; then
        if pgrep -f "/usr/trim/nginx/sbin/nginx" >/dev/null; then
            green_success "自定义 Nginx 仍在正常运行"
        else
            red_error "警告：自定义 Nginx 已停止"
        fi
    fi
}

# 询问是否立即释放端口并重启Nginx
ask_port_release() {
    local port="$1"
    local webname="$2"
    
    if [ -n "$port" ]; then
        echo ""
        yellow_prompt "网站 $webname (端口: $port) 已删除，是否立即释放端口 $port？"
        echo "  注意：释放端口需要重启Nginx，会导致其他网站短暂中断（约1-2秒）"
        yellow_prompt "立即释放端口？(y/N): "
        read -r release_choice
        
        if [[ "$release_choice" =~ ^[yY]$ ]]; then
            blue_info "正在重启Nginx以释放端口 $port..."
            if systemctl restart nginx; then
                green_success "Nginx重启成功，端口 $port 已释放"
                sleep 1
                
                # 验证端口是否已释放
                if ss -tuln | grep -q ":$port\\b"; then
                    red_error "警告：端口 $port 可能仍被占用"
                else
                    green_success "确认：端口 $port 已成功释放"
                fi
            else
                red_error "Nginx重启失败，端口可能未被释放"
            fi
        else
            blue_info "端口 $port 未立即释放"
            echo "  提示：端口将在下次重启Nginx时自动释放"
            echo "  或者您可以稍后手动执行: systemctl restart nginx"
        fi
    else
        red_error "无法获取端口号，无法释放端口"
    fi
}

# 自动清理 Nginx 中损坏的符号链接
cleanup_broken_symlinks() {
    blue_info "正在扫描并清理 Nginx 损坏的符号链接..."
    if [ -d /etc/nginx/sites-enabled ]; then
        for link in /etc/nginx/sites-enabled/*; do
            # 如果没有匹配到任何文件，glob 会原样返回 '/etc/nginx/sites-enabled/*'，需判断
            [ ! -e "$link" ] && continue
            if [ -L "$link" ] && [ ! -e "$link" ]; then
                red_error "检测到损坏的符号链接: $link"
                rm -f "$link"
                green_success "已删除损坏链接: $link"
            fi
        done
    fi
    blue_info "损坏链接清理完成。"
}

# 启用所有 PHP 扩展（尽量保留原意）
enable_all_php_extensions() {
    blue_info "正在尝试启用常见的 PHP 扩展（若支持的话）..."
    # 尝试启用 mods-available 中的扩展
    if [ -d "/etc/php/8.2/mods-available" ]; then
        for f in /etc/php/8.2/mods-available/*.ini; do
            [ -f "$f" ] || continue
            extname=$(basename "$f" .ini)
            # 使用 phpenmod 启用
            phpenmod -v 8.2 "$extname" 2>/dev/null || true
        done
    else
        # 备选：尝试基于 php -m 列表启用（若 phpenmod 可用）
        for ext in $(php -m 2>/dev/null); do
            phpenmod -v 8.2 "$ext" 2>/dev/null || true
        done
    fi
    # 重启 PHP-FPM（若存在）
    systemctl restart php8.2-fpm 2>/dev/null || true
    green_success "已尝试启用 PHP 扩展并重启 PHP-FPM（如果存在）。"
}

# 安装并启用所有常用的 PHP 扩展
install_php_extensions() {
    blue_info "正在安装常用的 PHP 扩展..."
    
    # 常见的 PHP 扩展包（保留你的列表）
    common_extensions=(
        php8.2-common
        php8.2-mysql
        php8.2-mysqli
        php8.2-xml
        php8.2-xmlrpc
        php8.2-curl
        php8.2-gd
        php8.2-imagick
        php8.2-cli
        php8.2-dev
        php8.2-imap
        php8.2-mbstring
        php8.2-opcache
        php8.2-soap
        php8.2-zip
        php8.2-bcmath
        php8.2-intl
        php8.2-readline
        php8.2-ldap
        php8.2-msgpack
        php8.2-igbinary
        php8.2-redis
        php8.2-memcached
        php8.2-pgsql
        php8.2-sqlite3
        php8.2-odbc
        php8.2-ssh2
        php8.2-tidy
        php8.2-xsl
        php8.2-yaml
        php8.2-json
        php8.2-cgi
        php8.2-fpm
    )
    
    for extension in "${common_extensions[@]}"; do
        if ! dpkg -l 2>/dev/null | grep -q "$extension"; then
            blue_info "安装 $extension..."
            apt install -y "$extension" || true
        else
            echo "$extension 已安装"
        fi
    done
    
    enable_all_php_extensions
}

# 删除当前目录的网站配置
remove_current_website() {
    cleanup_broken_symlinks

    WebLocal=$PWD  # 网站根目录
    
    INFO_FILE="${WebLocal}/website_info.txt"
    if [ ! -f "$INFO_FILE" ]; then
        red_error "错误：未找到网站信息文件 website_info.txt"
        red_error "请确保在当前网站根目录运行此脚本"
        yellow_prompt "按回车返回主菜单..."
        read -r
        return
    fi

    WebName=$(grep "网站名称:" "$INFO_FILE" | cut -d ':' -f 2 | tr -d ' ')
    
    if [ -z "$WebName" ]; then
        red_error "错误：无法从 website_info.txt 中读取网站名称"
        yellow_prompt "按回车返回主菜单..."
        read -r
        return
    fi

    # 获取端口信息
    port=""
    if [ -f "/etc/nginx/sites-available/$WebName" ]; then
        port=$(grep "listen" "/etc/nginx/sites-available/$WebName" 2>/dev/null | grep -v "\[::\]" | head -1 | awk '{print $2}' | tr -d ';')
    fi

    echo "找到网站配置：$WebName (端口: ${port:-未知})"
    yellow_prompt "确定要删除网站配置 $WebName 吗？(y/N): "
    read -r confirm

    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
        echo "操作已取消"
        yellow_prompt "按回车返回主菜单..."
        read -r
        return
    fi

    blue_info "正在删除 Nginx 配置..."
    # 强制删除可用配置与启用链接（包含损坏链接）
    rm -f "/etc/nginx/sites-available/$WebName"
    rm -f "/etc/nginx/sites-enabled/$WebName"

    # 检查并删除 PHP 信息文件
    PHPINFO_FILE="${WebLocal}/phpinfo.php"
    if [ -f "$PHPINFO_FILE" ]; then
        rm -f "$PHPINFO_FILE"
        echo "已删除 PHP 信息文件：$PHPINFO_FILE"
    fi

    # 删除网站信息文件
    rm -f "$INFO_FILE"
    echo "已删除网站信息文件：$INFO_FILE"

    # 重新加载 Nginx 配置
    nginx -t
    if [ $? -eq 0 ]; then
        systemctl reload nginx
        green_success "Nginx 配置已重新加载"
        green_success "网站 $WebName 的配置已成功删除"
        
        # 询问是否立即释放端口（如果有端口信息）
        if [ -n "$port" ]; then
            ask_port_release "$port" "$WebName"
        fi
    else
        red_error "警告：Nginx 配置检查失败，请手动检查"
    fi
    
    yellow_prompt "按回车返回主菜单..."
    read -r
}

# 高级删除功能
prompt_remove_website() {
    cleanup_broken_symlinks

    echo "=== 高级删除模式 ==="
    echo "1. 按网站名称删除"
    echo "2. 按端口号删除"
    echo "3. 查看所有网站配置"
    echo "0. 返回主菜单"
    echo "----------------------"
    
    yellow_prompt "请选择删除方式 (0-3): "
    read -r choice
    
    case $choice in
        0)
            return
            ;;
        1)
            remove_by_name
            ;;
        2)
            remove_by_port
            ;;
        3)
            list_all_websites
            ;;
        *)
            red_error "无效选择"
            ;;
    esac
    
    yellow_prompt "按回车返回主菜单..."
    read -r
}

# 按网站名称删除
remove_by_name() {
    cleanup_broken_symlinks

    echo "可用的网站配置："
    available_sites=$(ls /etc/nginx/sites-available/ 2>/dev/null)
    
    if [ -z "$available_sites" ]; then
        red_error "未找到任何网站配置"
        return
    fi
    
    echo "$available_sites"
    echo ""
    
    yellow_prompt "请输入要删除的网站名称："
    read -r WebName
    
    if [ -z "$WebName" ]; then
        red_error "错误：网站名称不能为空"
        return
    fi
    
    if [ ! -f "/etc/nginx/sites-available/$WebName" ]; then
        red_error "错误：网站配置 $WebName 不存在"
        return
    fi
    
    # 获取端口信息（若存在）
    port=$(grep "listen" "/etc/nginx/sites-available/$WebName" 2>/dev/null | grep -v "\[::\]" | head -1 | awk '{print $2}' | tr -d ';')
    
    echo "即将删除网站：$WebName (端口: $port)"
    yellow_prompt "确定要删除吗？(y/N): "
    read -r confirm
    
    if [[ "$confirm" = "y" ]] || [[ "$confirm" = "Y" ]]; then
        rm -f "/etc/nginx/sites-available/$WebName"
        rm -f "/etc/nginx/sites-enabled/$WebName"
        
        nginx -t && systemctl reload nginx
        
        green_success "网站配置 $WebName 已成功删除"
        # 询问是否立即释放端口
        ask_port_release "$port" "$WebName"
    else
        echo "操作已取消"
    fi
}

# 按端口号删除
remove_by_port() {
    cleanup_broken_symlinks

    echo "当前运行的网站端口："
    
    # 获取所有配置的端口
    found_any=false
    for config in /etc/nginx/sites-available/*; do
        [ -f "$config" ] || continue
        port=$(grep "listen" "$config" 2>/dev/null | grep -v "\[::\]" | head -1 | awk '{print $2}' | tr -d ';')
        sitename=$(basename "$config")
        echo "端口 $port - 网站: $sitename"
        found_any=true
    done

    if [ "$found_any" = false ]; then
        red_error "未找到任何网站配置"
        return
    fi

    echo ""
    yellow_prompt "请输入要删除的端口号："
    read -r port
    
    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
        red_error "错误：端口号必须为数字"
        return
    fi
    
    # 查找对应端口的网站配置
    website_found=""
    for config in /etc/nginx/sites-available/*; do
        [ -f "$config" ] || continue
        config_port=$(grep "listen" "$config" 2>/dev/null | grep -v "\[::\]" | head -1 | awk '{print $2}' | tr -d ';')
        if [ "$config_port" = "$port" ]; then
            website_found=$(basename "$config")
            break
        fi
    done
    
    if [ -z "$website_found" ]; then
        red_error "错误：未找到使用端口 $port 的网站配置"
        return
    fi
    
    echo "找到网站：$website_found (端口: $port)"
    yellow_prompt "确定要删除吗？(y/N): "
    read -r confirm
    
    if [[ "$confirm" = "y" ]] || [[ "$confirm" = "Y" ]]; then
        rm -f "/etc/nginx/sites-available/$website_found"
        rm -f "/etc/nginx/sites-enabled/$website_found"
        
        nginx -t && systemctl reload nginx 2>/dev/null || systemctl reload nginx 2>/dev/null || true
        
        green_success "端口 $port 的网站配置已成功删除"
        
        # 询问是否立即释放端口
        ask_port_release "$port" "$website_found"
    else
        echo "操作已取消"
    fi
}

# 列出所有网站配置
list_all_websites() {
    echo "=== 所有网站配置 ==="
    
    available_sites=$(ls /etc/nginx/sites-available/ 2>/dev/null)
    
    if [ -z "$available_sites" ]; then
        echo "未找到任何网站配置"
        return
    fi
    
    for site in $available_sites; do
        config_file="/etc/nginx/sites-available/$site"
        port=$(grep "listen" "$config_file" 2>/dev/null | grep -v "\[::\]" | head -1 | awk '{print $2}' | tr -d ';')
        root_dir=$(grep "root" "$config_file" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')
        echo "网站: $site | 端口: $port | 根目录: $root_dir"
    done
}

list_sites_json() {
    available_sites=$(ls /etc/nginx/sites-available/ 2>/dev/null)
    if [ -z "$available_sites" ]; then
        echo "[]"
        return 0
    fi
    first=1
    printf '['
    for site in $available_sites; do
        config_file="/etc/nginx/sites-available/$site"
        if [ ! -f "$config_file" ]; then
            continue
        fi
        port=$(grep "listen" "$config_file" 2>/dev/null | grep -v "\[::\]" | grep -v "default_server" | head -1 | awk '{print $2}' | tr -d ';')
        root_dir=$(grep "root" "$config_file" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')
        if [ -z "$port" ] && [ -z "$root_dir" ]; then
            continue
        fi
        enabled=false
        if [ -L "/etc/nginx/sites-enabled/$site" ]; then
            enabled=true
        fi
        if [ $first -eq 0 ]; then
            printf ','
        fi
        first=0
        esc_site=$(printf '%s' "$site" | sed 's/\\/\\\\/g; s/"/\\"/g')
        esc_port=$(printf '%s' "$port" | sed 's/\\/\\\\/g; s/"/\\"/g')
        esc_root=$(printf '%s' "$root_dir" | sed 's/\\/\\\\/g; s/"/\\"/g')
        printf '{"name":"%s","port":"%s","root":"%s","enabled":%s}' "$esc_site" "$esc_port" "$esc_root" "$enabled"
    done
    printf ']'
}

# 检查并添加rewrite规则
check_and_add_rewrite_rules() {
    local web_local="$1"
    local rewrite_file="${web_local}/rewrite.conf"
    
    if [ -f "$rewrite_file" ]; then
        blue_info "检测到 rewrite.conf 文件，正在读取重写规则..."
        
        # 读取并格式化重写规则
        REWRITE_CONTENT=$(awk '
            {
                # 移除前导空白
                if ($0 != "") {
                    sub(/^[ \t]+/, "", $0)
                }
                
                # 处理缩进
                if ($0 == "") {
                    print ""
                } else if ($0 ~ /^location/ || $0 ~ /^}$/) {
                    print "    " $0
                } else {
                    print "        " $0
                }
            }
        ' "${rewrite_file}")
        
        # 转义特殊字符
        REWRITE_CONTENT=$(echo "$REWRITE_CONTENT" | sed 's/\\/\\\\/g; s/\$/\\\$/g; s/`/\\`/g')
        
        green_success "已加载自定义重写规则"
        return 0
    else
        REWRITE_CONTENT=""
        return 1
    fi
}

# 创建SSL证书占位文件（使用自签名证书）
create_certificate_placeholder() {
    local cert_file="$1"
    local key_file="$2"
    local domain="${3:-placeholder.local}"
    
    blue_info "正在创建自签名证书占位文件..."
    
    # 确保证书目录存在
    certs_dir=$(dirname "$cert_file")
    mkdir -p "$certs_dir"
    
    # 检查是否已安装了openssl
    if ! command -v openssl &> /dev/null; then
        red_error "错误：openssl未安装，无法创建证书占位文件"
        yellow_prompt "请先安装openssl: apt install openssl -y"
        return 1
    fi
    
    # 如果证书文件已存在且不是占位文件，则跳过
    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
        if openssl x509 -in "$cert_file" -noout 2>/dev/null; then
            blue_info "证书文件已存在且有效: $cert_file"
            return 0
        fi
    fi
    
    # 生成自签名证书
    echo "生成自签名证书..."
    
    # 生成私钥
    openssl genrsa -out "$key_file" 2048 2>/dev/null
    if [ $? -ne 0 ]; then
        red_error "生成私钥失败"
        return 1
    fi
    chmod 600 "$key_file"
    green_success "创建私钥文件: $key_file"
    
    # 生成自签名证书
    openssl req -new -x509 -days 365 -key "$key_file" -out "$cert_file" \
        -subj "/C=CN/ST=Beijing/L=Beijing/O=Temp/CN=$domain" \
        -addext "subjectAltName = DNS:$domain" 2>/dev/null
    
    if [ $? -ne 0 ]; then
        # 如果带扩展失败，尝试不带扩展
        openssl req -new -x509 -days 365 -key "$key_file" -out "$cert_file" \
            -subj "/C=CN/ST=Beijing/L=Beijing/O=Temp/CN=$domain" 2>/dev/null
    fi
    
    if [ $? -ne 0 ]; then
        red_error "生成证书失败"
        rm -f "$key_file"
        return 1
    fi
    chmod 644 "$cert_file"
    green_success "创建证书文件: $cert_file"
    
    # 在证书文件中添加注释信息
    cat >> "$cert_file" <<EOF

# =================================================================
# 自签名证书占位文件
# 
# 此证书由web_configer_for_FN.sh自动生成
# 仅用于Nginx配置测试和临时HTTPS访问
# 
# 浏览器会提示此证书不受信任（这是正常的）
# 
# 如何获取受信任的正式证书：
# 1. 安装httpsok服务（主菜单选项6）
# 2. 运行命令：httpsok --run
# 3. 等待证书申请完成（通常1-2分钟）
# 
# 正式证书申请成功后，此文件将被自动替换
# 
# 创建时间: $(date)
# 域名: $domain
# 有效期: 365天
# =================================================================
EOF
    
    # 在私钥文件中添加注释信息
    cat >> "$key_file" <<EOF

# =================================================================
# SSL私钥文件（与自签名证书配对）
# 
# 此私钥由web_configer_for_FN.sh自动生成
# 仅用于临时HTTPS访问
# 
# 如何获取正式私钥：
# 1. 安装httpsok服务（主菜单选项6）
# 2. 运行命令：httpsok --run
# 3. 等待证书申请完成（通常1-2分钟）
# 
# 正式私钥申请成功后，此文件将被自动替换
# 
# 创建时间: $(date)
# 域名: $domain
# =================================================================
EOF
    
    echo ""
    yellow_prompt "⚠️ 注意：当前使用的是自签名证书"
    echo "   此证书由脚本自动生成，仅用于临时HTTPS访问"
    echo "   浏览器会提示证书不受信任（这是正常的）"
    echo "   请尽快安装httpsok并申请受信任的正式证书"
    echo ""
    
    return 0
}

# 网站配置模块（主功能）
# 逻辑为：
# 当基于域名创建网站时，使用80/443端口，不设置默认 default_server
# 当基于端口创建网站时，必须启用http，可选择启用https，设置默认 default_server，使ip:端口访问时，指向本网站。
configure_website() {
    cleanup_broken_symlinks

    WebLocal=$PWD  # 网站根目录
    
    if [ -f "$WebLocal/website_info.txt" ]; then
        red_error "检测到当前目录已存在网站配置 (website_info.txt)"
        yellow_prompt "如果继续操作可能会覆盖原有配置，请先删除旧配置或在新目录下执行安装"
        yellow_prompt "按回车返回主菜单..."
        read -r
        return
    fi
    
    # 选择配置模式
    echo ""
    green_success "请选择网站配置模式："
    echo "1) 基于 [域名] (使用标准80/443端口，需要域名)"
    echo "2) 基于 [端口] (使用自定义端口，无需域名)"
    yellow_prompt "请选择模式 (1 或 2): "
    read -r config_mode
    
    if [ "$config_mode" != "1" ] && [ "$config_mode" != "2" ]; then
        red_error "无效选择，返回主菜单"
        return
    fi
    
    # 请求用户输入 - 网站名称（加入重复检测）
    while true; do
        yellow_prompt "请输入网站名称（建议英文，例如：test）："
        read -r WebName
        if [ -z "$WebName" ]; then
            red_error "网站名称不能为空，请重新输入。"
            continue
        fi
        # 检查是否存在相同名称的配置（可用或启用）
        if [ -f "/etc/nginx/sites-available/$WebName" ] || [ -L "/etc/nginx/sites-enabled/$WebName" ]; then
            red_error "错误：网站名称 '$WebName' 已存在（sites-available 或 sites-enabled），请换一个名称。"
            continue
        fi
        break
    done
    
    # 根据模式进行不同配置
    if [ "$config_mode" = "1" ]; then
        # 基于域名模式
        blue_info "=== 基于域名模式配置 ==="
        
        # 询问域名
        while true; do
            yellow_prompt "请输入要绑定的域名（例如：example.com）："
            read -r domain
            
            if [ -z "$domain" ]; then
                red_error "域名不能为空，请重新输入。"
                continue
            fi
            
            # 简单的域名格式验证
            if ! [[ "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9\.\-]*[a-zA-Z0-9]$ ]]; then
                red_error "警告：域名格式可能不正确"
                yellow_prompt "是否继续？（y/N）: "
                read -r continue_with_domain
                if [[ ! "$continue_with_domain" =~ ^[yY]$ ]]; then
                    continue
                fi
            fi
            
            # 检查域名是否已存在
            if grep -r "server_name.*$domain" /etc/nginx/sites-available/ 2>/dev/null | grep -q "$domain"; then
                red_error "错误：域名 '$domain' 已被其他网站使用，请选择其他域名。"
                continue
            fi
            
            break
        done
        
        # 检查80和443端口是否被Nginx监听（允许共享）
        # 仅检查是否有其他非Nginx服务占用了端口
        if ss -tuln | grep -q ":80\\b" && ! ss -tuln | grep ":80\\b" | grep -q "nginx"; then
            red_error "错误：端口 80 已被非Nginx服务占用，无法使用基于域名模式。"
            yellow_prompt "请选择基于端口模式或释放80端口后重试。"
            yellow_prompt "按回车返回主菜单..."
            read -r
            return
        fi
        
        # 询问是否启用HTTPS
        echo ""
        yellow_prompt "是否为该域名启用HTTPS/SSL？(y/N): "
        read -r enable_https
        
        if [[ "$enable_https" =~ ^[yY]$ ]]; then
            https_enabled=true
            # 检查443端口是否被非Nginx服务占用
            if ss -tuln | grep -q ":443\\b" && ! ss -tuln | grep ":443\\b" | grep -q "nginx"; then
                red_error "错误：端口 443 已被非Nginx服务占用，无法启用HTTPS。"
                yellow_prompt "请选择HTTP-only或释放443端口后重试。"
                yellow_prompt "按回车返回主菜单..."
                read -r
                return
            fi
            
            # 创建证书目录（如果不存在）
            certs_dir="/etc/nginx/certs"
            mkdir -p "$certs_dir"
            
            # 设置证书文件路径
            ssl_cert="${certs_dir}/${domain}.pem"
            ssl_key="${certs_dir}/${domain}.key"
            
            blue_info "HTTPS已启用，证书将存储在: $certs_dir"
            blue_info "证书文件: $ssl_cert"
            blue_info "私钥文件: $ssl_key"
            
            # 提示用户配置证书
            echo ""
            yellow_prompt "请按以下步骤配置SSL证书："
            echo "  1. 获取httpsok token（从 https://httpsok.com/ ）"
            echo "  2. 安装httpsok服务（通过菜单选项6）"
            echo "  3. 证书将自动放置在上述目录"
        else
            https_enabled=false
        fi
        
        # 设置端口为80/443
        Web_PORT_http=80
        Web_PORT_https=443
        
    else
        # 基于端口模式
        blue_info "=== 基于端口模式配置 ==="
        
        # 不绑定域名
        domain=""
        
        # 请求HTTP端口并校验
        while true; do
            yellow_prompt "请输入HTTP端口（例如：8080等非常用端口）："
            read -r Web_PORT_http

            # 检查端口是否为数字
            if ! [[ "$Web_PORT_http" =~ ^[0-9]+$ ]]; then
                red_error "错误：端口号必须为数字，请重新输入。"
                continue
            fi

            # 检查端口范围
            if [ "$Web_PORT_http" -lt 1 ] || [ "$Web_PORT_http" -gt 65535 ]; then
                red_error "错误：端口号必须在 1 到 65535 之间，请重新输入。"
                continue
            fi

            # 检查系统层面端口是否被占用
            if ss -tuln | grep -q ":${Web_PORT_http}\\b"; then
                red_error "错误：端口 $Web_PORT_http 已被系统占用，请选择其他端口。"
                continue
            fi

            # 检查 Nginx 配置中是否已有 listen 对应端口
            if grep -R "listen .*${Web_PORT_http}" /etc/nginx/sites-available/ 2>/dev/null | grep -q "$Web_PORT_http"; then
                red_error "错误：已有 Nginx 站点配置监听端口 $Web_PORT_http，请选择其他端口。"
                continue
            fi

            break
        done
        
        # 询问是否启用HTTPS
        echo ""
        yellow_prompt "是否为该端口启用HTTPS/SSL？(y/N): "
        read -r enable_https
        
        if [[ "$enable_https" =~ ^[yY]$ ]]; then
            https_enabled=true
            
            # 请求HTTPS端口并校验
            while true; do
                yellow_prompt "请输入HTTPS端口（例如：8443等非常用端口）："
                read -r Web_PORT_https

                # 检查端口是否为数字
                if ! [[ "$Web_PORT_https" =~ ^[0-9]+$ ]]; then
                    red_error "错误：端口号必须为数字，请重新输入。"
                    continue
                fi

                # 检查端口范围
                if [ "$Web_PORT_https" -lt 1 ] || [ "$Web_PORT_https" -gt 65535 ]; then
                    red_error "错误：端口号必须在 1 到 65535 之间，请重新输入。"
                    continue
                fi

                # 检查系统层面端口是否被占用
                if ss -tuln | grep -q ":${Web_PORT_https}\\b"; then
                    red_error "错误：端口 $Web_PORT_https 已被系统占用，请选择其他端口。"
                    continue
                fi

                # 检查 Nginx 配置中是否已有 listen 对应端口
                if grep -R "listen .*${Web_PORT_https}" /etc/nginx/sites-available/ 2>/dev/null | grep -q "$Web_PORT_https"; then
                    red_error "错误：已有 Nginx 站点配置监听端口 $Web_PORT_https，请选择其他端口。"
                    continue
                fi

                # 检查HTTP和HTTPS端口是否相同
                if [ "$Web_PORT_http" -eq "$Web_PORT_https" ]; then
                    red_error "错误：HTTP和HTTPS端口不能相同，请选择其他端口。"
                    continue
                fi

                break
            done
            
            # 创建证书目录（如果不存在）
            certs_dir="/etc/nginx/certs"
            mkdir -p "$certs_dir"
            
            # 设置证书文件路径（使用端口作为标识）
            ssl_cert="${certs_dir}/${WebName}_port${Web_PORT_https}.pem"
            ssl_key="${certs_dir}/${WebName}_port${Web_PORT_https}.key"
            
            blue_info "HTTPS已启用，证书将存储在: $certs_dir"
            blue_info "证书文件: $ssl_cert"
            blue_info "私钥文件: $ssl_key"
            
            # 提示用户配置证书
            echo ""
            yellow_prompt "请按以下步骤配置SSL证书："
            echo "  1. 获取httpsok token（从 https://httpsok.com/ ）"
            echo "  2. 安装httpsok服务（通过菜单选项6）"
            echo "  3. 证书将自动放置在上述目录"
        else
            https_enabled=false
            Web_PORT_https=""
        fi
    fi

    blue_info "正在修改目录权限..."
    # 修改权限
    chown -R www-data:www-data "$WebLocal" 2>/dev/null || true
    chmod -R 755 "$WebLocal" 2>/dev/null || true

    # 处理重写规则
    REWRITE_CONTENT=""
    if [ -f "${WebLocal}/rewrite.conf" ]; then
        check_and_add_rewrite_rules "${WebLocal}"
    fi
    
    # 创建证书占位文件（如果需要）
    if [ "$https_enabled" = true ]; then
        create_certificate_placeholder "$ssl_cert" "$ssl_key" "$domain"
    fi

    blue_info "正在创建 Nginx 配置文件..."
    
    # 根据模式创建不同的Nginx配置
    if [ "$config_mode" = "1" ]; then
        # 基于域名模式
        if [ "$https_enabled" = true ]; then
            # HTTPS配置（没有default_server）
            cat > "/etc/nginx/sites-available/$WebName" <<EOF
# HTTP重定向到HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    
    # 重定向所有HTTP请求到HTTPS
    return 301 https://\$host\$request_uri;
}

# HTTPS主配置
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $domain;

    # SSL证书配置
    ssl_certificate $ssl_cert;
    ssl_certificate_key $ssl_key;

    # SSL优化配置
    ssl_session_timeout 5m;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
    add_header Strict-Transport-Security "max-age=31536000";

    root $WebLocal;
    index index.php index.html index.htm;

    # 文件上传大小限制（默认8M，可通过菜单选项修改）
    client_max_body_size 8M;

$(if [ -n "$REWRITE_CONTENT" ]; then
    echo "    # 自定义重写规则（来自 rewrite.conf）"
    printf "%s" "$REWRITE_CONTENT"
    local last_line=$(printf "%s" "$REWRITE_CONTENT" | tail -1)
    if [ -n "$last_line" ]; then
        echo ""
    fi
fi)

    location / {
        try_files \$uri \$uri/ =404;
    }

    # 配置 PHP 支持
    location ~ \\.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        include fastcgi_params;
        
        # 添加HTTPS相关参数
        fastcgi_param HTTPS on;
    }

    # 禁止访问 .htaccess 文件
    location ~ /\\.ht {
        deny all;
    }
}
EOF
        else
            # HTTP-only配置（没有default_server）
            cat > "/etc/nginx/sites-available/$WebName" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $domain;

    root $WebLocal;
    index index.php index.html index.htm;

    # 文件上传大小限制（默认8M，可通过菜单选项修改）
    client_max_body_size 8M;

$(if [ -n "$REWRITE_CONTENT" ]; then
    echo "    # 自定义重写规则（来自 rewrite.conf）"
    printf "%s" "$REWRITE_CONTENT"
    local last_line=$(printf "%s" "$REWRITE_CONTENT" | tail -1)
    if [ -n "$last_line" ]; then
        echo ""
    fi
fi)

    location / {
        try_files \$uri \$uri/ =404;
    }

    # 配置 PHP 支持
    location ~ \\.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        include fastcgi_params;
    }

    # 禁止访问 .htaccess 文件
    location ~ /\\.ht {
        deny all;
    }
}
EOF
        fi
    else
        # 基于端口模式
        if [ "$https_enabled" = true ]; then
            # HTTPS配置（两个端口在一个server块中）
            cat > "/etc/nginx/sites-available/$WebName" <<EOF
server {
    listen $Web_PORT_http default_server;
    listen [::]:$Web_PORT_http default_server;
    
    listen $Web_PORT_https ssl default_server;
    listen [::]:$Web_PORT_https ssl default_server;

    root $WebLocal;
    index index.php index.html index.htm;

    server_name _;

    # SSL证书配置（仅HTTPS端口使用）
    ssl_certificate $ssl_cert;
    ssl_certificate_key $ssl_key;

    # SSL优化配置
    ssl_session_timeout 5m;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;

    # 文件上传大小限制（默认8M，可通过菜单选项修改）
    client_max_body_size 8M;

$(if [ -n "$REWRITE_CONTENT" ]; then
    echo "    # 自定义重写规则（来自 rewrite.conf）"
    printf "%s" "$REWRITE_CONTENT"
    local last_line=$(printf "%s" "$REWRITE_CONTENT" | tail -1)
    if [ -n "$last_line" ]; then
        echo ""
    fi
fi)

    location / {
        try_files \$uri \$uri/ =404;
    }

    # 配置 PHP 支持
    location ~ \\.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        include fastcgi_params;
    }

    # 禁止访问 .htaccess 文件
    location ~ /\\.ht {
        deny all;
    }
}
EOF
        else
            # HTTP-only配置（仅HTTP端口）
            cat > "/etc/nginx/sites-available/$WebName" <<EOF
server {
    listen $Web_PORT_http default_server;
    listen [::]:$Web_PORT_http default_server;

    root $WebLocal;
    index index.php index.html index.htm;

    server_name _;

    # 文件上传大小限制（默认8M，可通过菜单选项修改）
    client_max_body_size 8M;

$(if [ -n "$REWRITE_CONTENT" ]; then
    echo "    # 自定义重写规则（来自 rewrite.conf）"
    printf "%s" "$REWRITE_CONTENT"
    local last_line=$(printf "%s" "$REWRITE_CONTENT" | tail -1)
    if [ -n "$last_line" ]; then
        echo ""
    fi
fi)

    location / {
        try_files \$uri \$uri/ =404;
    }

    # 配置 PHP 支持
    location ~ \\.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        include fastcgi_params;
    }

    # 禁止访问 .htaccess 文件
    location ~ /\\.ht {
        deny all;
    }
}
EOF
        fi
    fi

    blue_info "正在创建符号链接..."
    # 清理可能存在的坏链接或旧链接
    rm -f "/etc/nginx/sites-enabled/$WebName"
    ln -s "/etc/nginx/sites-available/$WebName" "/etc/nginx/sites-enabled/$WebName"

    blue_info "正在检查 Nginx 配置..."
    nginx -t
    if [ $? -ne 0 ]; then
        red_error "错误：Nginx 配置检查失败，请检查配置文件。"
        yellow_prompt "按回车返回主菜单..."
        read -r
        return
    fi

    blue_info "正在重启 Nginx 配置..."
    restart_system_nginx

    blue_info "正在创建网站信息文件..."
    # 创建网站信息文件
    INFO_FILE="${WebLocal}/website_info.txt"
    echo "配置模式: $([ "$config_mode" = "1" ] && echo "基于域名" || echo "基于端口")" > "$INFO_FILE"
    echo "网站名称: $WebName" >> "$INFO_FILE"
    
    if [ "$config_mode" = "1" ]; then
        echo "绑定域名: $domain" >> "$INFO_FILE"
        echo "HTTP端口: 80" >> "$INFO_FILE"
        if [ "$https_enabled" = true ]; then
            echo "HTTPS端口: 443" >> "$INFO_FILE"
        fi
    else
        echo "绑定域名: 无" >> "$INFO_FILE"
        echo "HTTP端口: $Web_PORT_http" >> "$INFO_FILE"
        if [ "$https_enabled" = true ]; then
            echo "HTTPS端口: $Web_PORT_https" >> "$INFO_FILE"
        fi
    fi
    
    echo "网站根目录: $WebLocal" >> "$INFO_FILE"
    echo "创建时间: $(date)" >> "$INFO_FILE"
    
    if [ -f "${WebLocal}/rewrite.conf" ]; then
        echo "重写规则: 已启用 (来自 rewrite.conf)" >> "$INFO_FILE"
    else
        echo "重写规则: 未启用" >> "$INFO_FILE"
    fi
    
    if [ "$https_enabled" = true ]; then
        echo "HTTPS状态: 已启用" >> "$INFO_FILE"
        echo "证书目录: $certs_dir" >> "$INFO_FILE"
        echo "证书文件: $ssl_cert" >> "$INFO_FILE"
        echo "私钥文件: $ssl_key" >> "$INFO_FILE"
        echo "证书管理: 使用 httpsok 网页服务 https://httpsok.com/console/cert" >> "$INFO_FILE"
    else
        echo "HTTPS状态: 未启用" >> "$INFO_FILE"
    fi
    
    chmod 644 "$INFO_FILE"

    # 创建 PHP 信息文件
    PHPINFO_FILE="${WebLocal}/phpinfo.php"
    echo "<?php phpinfo(); ?>" > "$PHPINFO_FILE"
    chmod 644 "$PHPINFO_FILE"

    # 获取内网IP地址
    get_internal_ip() {
        local ip=""
        if command -v hostname >/dev/null; then
            ip=$(hostname -I | awk '{print $1}' 2>/dev/null)
        fi
        if [ -z "$ip" ] && command -v ip >/dev/null; then
            ip=$(ip route get 1 2>/dev/null | awk '{print $7}' | head -1)
        fi
        if [ -z "$ip" ] && command -v ifconfig >/dev/null; then
            ip=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1)
        fi
        if [ -z "$ip" ]; then
            ip=$(grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' /etc/hosts | grep -v '127.0.0.1' | head -1 | awk '{print $1}')
        fi
        echo "$ip"
    }

    INTERNAL_IP=$(get_internal_ip)
    
    echo ""
    green_success "================================================"
    green_success "🎉 网站配置完成！"
    green_success "================================================"
    blue_info "🌐 访问地址："
    
    if [ "$config_mode" = "1" ]; then
        # 基于域名模式
        if [ "$https_enabled" = true ]; then
            echo "   HTTP访问（自动重定向）: http://$domain"
            echo "   HTTPS访问: https://$domain"
            echo "   PHP 信息: https://$domain/phpinfo.php"
        else
            echo "   HTTP访问: http://$domain"
            echo "   PHP 信息: http://$domain/phpinfo.php"
        fi
        
        echo ""
        blue_info "📝 注意事项："
        echo "   当前未设置默认站点，访问未配置的域名会返回第一个匹配的站点。"
        echo "   如有需要，可手动在配置文件中添加 default_server 参数。"
    else
        # 基于端口模式
        echo "   HTTP访问: http://${INTERNAL_IP}:${Web_PORT_http}"
        echo "   PHP 信息: http://${INTERNAL_IP}:${Web_PORT_http}/phpinfo.php"
        
        if [ "$https_enabled" = true ]; then
            echo "   HTTPS访问: https://${INTERNAL_IP}:${Web_PORT_https}"
            echo "   PHP 信息(HTTPS): https://${INTERNAL_IP}:${Web_PORT_https}/phpinfo.php"
        fi
    fi
    
    # 显示通用访问地址
    if [ "$config_mode" = "2" ]; then
        echo ""
        echo "   内网访问: http://${INTERNAL_IP}:${Web_PORT_http}"
        echo "   本机访问: http://localhost:${Web_PORT_http}"
    fi
    
    echo ""
    blue_info "📁 网站信息："
    echo "   配置模式: $([ "$config_mode" = "1" ] && echo "基于域名" || echo "基于端口")"
    echo "   网站名称: $WebName"
    
    if [ "$config_mode" = "1" ]; then
        echo "   绑定域名: $domain"
        echo "   HTTP端口: 80"
        if [ "$https_enabled" = true ]; then
            echo "   HTTPS端口: 443"
        fi
    else
        echo "   绑定域名: 无"
        echo "   HTTP端口: $Web_PORT_http"
        if [ "$https_enabled" = true ]; then
            echo "   HTTPS端口: $Web_PORT_https"
        fi
    fi
    
    echo "   网站目录: $WebLocal"
    
    if [ -f "${WebLocal}/rewrite.conf" ]; then
        echo "   重写规则: ✅ 已启用"
    else
        echo "   重写规则: ❌ 未启用"
    fi
    
    if [ "$https_enabled" = true ]; then
        echo "   HTTPS状态: ✅ 已启用"
        echo "   证书目录: $certs_dir"
    else
        echo "   HTTPS状态: ❌ 未启用"
    fi
    
    echo "   后续可通过菜单配置上传文件大小限制和自动更新证书。"
    
    echo ""
    yellow_prompt "💡 通用提示：如果无法访问，请检查防火墙设置"
    green_success "================================================"
    
    echo "网站信息已保存到: $INFO_FILE"
    if [ -f "${WebLocal}/rewrite.conf" ]; then
        green_success "已启用自定义重写规则"
    fi
    
    yellow_prompt "按回车返回主菜单..."
    read -r
}

# 安装流程
install_process() {
    # 检查 Nginx 是否已经在运行
    if systemctl is-active --quiet nginx; then
        blue_info "Nginx 已经在运行，跳过更新和升级步骤，直接配置网站。"
        return
    else
        blue_info "Nginx 未运行，开始检查和安装..."
        # 更新系统包列表
        blue_info "正在更新系统包列表..."
        apt update

        # 升级已安装的包
        blue_info "正在升级已安装的包..."
        apt upgrade -y

        # 检查是否已安装 nginx
        if ! command -v nginx &> /dev/null; then
            blue_info "Nginx 未安装，正在安装 Nginx..."
            
            while true; do
                yellow_prompt "请输入 Nginx 默认监听端口（例如：8090）："
                read -r Nginx_PORT

                if ! [[ "$Nginx_PORT" =~ ^[0-9]+$ ]]; then
                    red_error "错误：端口号必须为数字，请重新输入。"
                    continue
                fi

                if [ "$Nginx_PORT" -lt 1 ] || [ "$Nginx_PORT" -gt 65535 ]; then
                    red_error "错误：端口号必须在 1 到 65535 之间，请重新输入。"
                    continue
                fi

                if ss -tuln | grep -q ":$Nginx_PORT\\b"; then
                    red_error "错误：端口 $Nginx_PORT 已被系统占用，请选择其他端口。"
                    continue
                fi

                # 检查是否在已存在的 nginx 配置中已使用该端口
                if grep -R "listen .*${Nginx_PORT}" /etc/nginx/sites-available/ 2>/dev/null | grep -q "$Nginx_PORT"; then
                    red_error "错误：已有 Nginx 站点配置监听端口 $Nginx_PORT，请选择其他端口。"
                    continue
                fi

                break
            done

            green_success "端口 $Nginx_PORT 可用，继续配置 Nginx..."
        
            apt install nginx -y
        
            # 修改 Nginx 配置文件监听端口（如果默认文件存在）
            NGINX_CONF="/etc/nginx/sites-available/default"
            if [ -f "$NGINX_CONF" ]; then
                blue_info "修改 Nginx 配置文件以监听 $Nginx_PORT 端口..."
                sed -i "s/80 default_server/${Nginx_PORT}/g" "$NGINX_CONF" || true
                sed -i "s/listen 80;/listen ${Nginx_PORT};/g" "$NGINX_CONF" || true
            else
                red_error "Nginx 配置文件 $NGINX_CONF 不存在，请检查路径。"
                # 不直接 exit，继续后续步骤（慎用）
            fi
        else
            blue_info "Nginx 已安装，跳过安装。"
        fi

        # 检查是否已安装 php-fpm
        if ! dpkg -l 2>/dev/null | grep -q php8.2-fpm; then
            blue_info "php8.2-fpm 未安装，正在安装 php8.2-fpm 和所有扩展..."
            apt install php8.2-fpm -y || true
            # 安装并启用所有 PHP 扩展
            install_php_extensions
        else
            blue_info "php8.2-fpm 已安装，检查并安装扩展..."
            # 安装并启用所有 PHP 扩展
            install_php_extensions
        fi

        # 启动 Nginx 和 php8.2-fpm
        systemctl start nginx 2>/dev/null || true
        systemctl start php8.2-fpm 2>/dev/null || true

        # 设置 Nginx 和 php8.2-fpm 开机自启
        systemctl enable nginx 2>/dev/null || true
        systemctl enable php8.2-fpm 2>/dev/null || true

        # 查询 Nginx 和 php8.2-fpm 状态（简要）
        blue_info "Nginx 状态："
        systemctl status nginx --no-pager 2>/dev/null || true

        blue_info "php8.2-fpm 状态："
        systemctl status php8.2-fpm --no-pager 2>/dev/null || true

        # 配置网站
        configure_website
    fi
}

# 查询Nginx上传配置
query_nginx_upload_settings() {
    blue_info "正在查询Nginx上传配置..."
    
    echo "=== Nginx上传配置查询 ==="
    
    # 检查主nginx.conf
    if [ -f "/etc/nginx/nginx.conf" ]; then
        nginx_global=$(grep "client_max_body_size" /etc/nginx/nginx.conf | head -1 || echo "未找到全局设置")
        echo "全局配置: $nginx_global"
    else
        echo "未找到主nginx.conf文件"
    fi
    
    # 检查所有站点配置
    echo ""
    echo "=== 各站点Nginx上传配置 ==="
    
    nginx_configs=$(find /etc/nginx/sites-available -type f ! -name "*.backup.*" 2>/dev/null | sort)
    
    if [ -n "$nginx_configs" ]; then
        for config in $nginx_configs; do
            site_name=$(basename "$config")
            nginx_setting=$(grep "client_max_body_size" "$config" || echo "未设置（默认1MB）")
            echo "站点: $site_name"
            echo "配置: $nginx_setting"
            echo "-------------------"
        done
    else
        echo "未找到任何站点配置"
    fi
}

# 查询PHP上传配置（优先读取自定义文件）
query_php_upload_settings() {
    echo "=== PHP文件上传配置查询 ==="

    # 检查 PHP 是否安装
    if ! command -v php &> /dev/null; then
        red_error "PHP未安装或未在PATH中"
        return 1
    fi

    blue_info "正在查询PHP上传配置..."

    # 自定义配置文件
    CUSTOM_CONF="/etc/php/8.2/fpm/conf.d/99-custom-upload.ini"

    if [ -f "$CUSTOM_CONF" ]; then
        blue_info "检测到自定义PHP配置: $CUSTOM_CONF"
        UPLOAD_MAX=$(grep -E '^upload_max_filesize' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
        POST_MAX=$(grep -E '^post_max_size' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
        MEMORY_LIMIT=$(grep -E '^memory_limit' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
        MAX_EXECUTION=$(grep -E '^max_execution_time' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
        MAX_INPUT=$(grep -E '^max_input_time' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
        MAX_FILE_UPLOADS=$(grep -E '^max_file_uploads' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
        FILE_UPLOADS=$(grep -E '^file_uploads' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
    else
        blue_info "未检测到自定义PHP配置，使用CLI默认值"
        # 使用 PHP CLI ini_get
        UPLOAD_MAX=$(php -r 'echo ini_get("upload_max_filesize");')
        POST_MAX=$(php -r 'echo ini_get("post_max_size");')
        MEMORY_LIMIT=$(php -r 'echo ini_get("memory_limit");')
        MAX_EXECUTION=$(php -r 'echo ini_get("max_execution_time");')
        MAX_INPUT=$(php -r 'echo ini_get("max_input_time");')
        MAX_FILE_UPLOADS=$(php -r 'echo ini_get("max_file_uploads");')
        FILE_UPLOADS=$(php -r 'echo ini_get("file_uploads");')
    fi

    echo "📁 PHP文件上传配置信息:"
    echo "========================"
    echo "🔹 是否允许文件上传: $FILE_UPLOADS"
    echo "🔹 单个文件最大上传大小: $UPLOAD_MAX"
    echo "🔹 POST数据最大大小: $POST_MAX"
    echo "🔹 单次最大上传文件数量: $MAX_FILE_UPLOADS"
    echo "🔹 内存限制: $MEMORY_LIMIT"
    echo "🔹 最大执行时间(秒): $MAX_EXECUTION"
    echo "🔹 最大输入时间(秒): $MAX_INPUT"

    # 将大小转换为字节进行比较
    toBytes() {
        local size=$1
        local unit=${size//[0-9.]/}
        local number=${size//[^0-9.]/}
        unit=$(echo "$unit" | tr '[:upper:]' '[:lower:]')
        case "$unit" in
            k) echo $(awk "BEGIN {print $number*1024}") ;;
            m) echo $(awk "BEGIN {print $number*1024*1024}") ;;
            g) echo $(awk "BEGIN {print $number*1024*1024*1024}") ;;
            *) echo "$number" ;;
        esac
    }

    UPLOAD_BYTES=$(toBytes "$UPLOAD_MAX")
    POST_BYTES=$(toBytes "$POST_MAX")

    # 实际允许上传大小
    EFFECTIVE_UPLOAD=$UPLOAD_MAX
    if awk "BEGIN {exit !($UPLOAD_BYTES > $POST_BYTES)}"; then
        EFFECTIVE_UPLOAD="${POST_MAX} (受post_max_size限制)"
    fi

    echo "📊 配置分析:"
    echo "✅ 实际允许的最大上传文件大小: $EFFECTIVE_UPLOAD"
    echo "💡 提示: 要上传大文件，需要同时修改 upload_max_filesize、post_max_size 和 memory_limit"

    # 查询 Nginx 上传配置
    query_nginx_upload_settings

    echo ""
    yellow_prompt "是否要修改上传大小限制，此修改将应用到所有站点？(y/N): "
    read -r modify_choice

    if [[ "$modify_choice" =~ ^[yY]$ ]]; then
        modify_php_upload_settings
    fi

    yellow_prompt "按回车返回主菜单..."
    read -r
}

modify_php_upload_settings() {
    blue_info "正在修改PHP上传配置..."

    PHP_CONF_DIR="/etc/php/8.2/fpm/conf.d"
    CUSTOM_CONF="${PHP_CONF_DIR}/99-custom-upload.ini"

    if [ ! -d "$PHP_CONF_DIR" ]; then
        red_error "找不到PHP配置目录: $PHP_CONF_DIR"
        return 1
    fi

    yellow_prompt "请输入新的上传文件大小 (例如: 64M, 128M, 256M, 1G): "
    read -r new_size

    if [ -z "$new_size" ]; then
        red_error "输入不能为空"
        return 1
    fi

    if ! [[ "$new_size" =~ ^[0-9]+[KMG]?$ ]]; then
        red_error "格式错误，请使用如 64M, 128M, 256M, 1G 的格式"
        return 1
    fi

    # 将上传大小转换为字节，用于设置 memory_limit
    php -r "
    function toBytes(\$size) {
        \$unit = preg_replace('/[^bkmgtpezy]/i', '', \$size);
        \$size = preg_replace('/[^0-9]/', '', \$size);
        if (\$unit) {
            return (int)(\$size * pow(1024, stripos('bkmgtpezy', \$unit[0])));
        }
        return (int)\$size;
    }
    echo toBytes('$new_size');
    " > /tmp/new_upload_bytes

    UPLOAD_BYTES=$(cat /tmp/new_upload_bytes)
    # 设置 memory_limit 至少等于上传大小
    MEM_LIMIT_BYTES=$((UPLOAD_BYTES))
    # 简单转换回 M 单位
    MEM_LIMIT=$(( (MEM_LIMIT_BYTES + 1024*1024 - 1)/(1024*1024) ))M

    blue_info "设置 PHP 内存限制为: $MEM_LIMIT"

    # 写入自定义 PHP 配置
    cat > "$CUSTOM_CONF" <<EOF
; 自定义上传配置 - 由 web_configer_for_FN.sh 生成
file_uploads = On
upload_max_filesize = $new_size
post_max_size = $new_size
max_execution_time = 300
max_input_time = 300
memory_limit = $MEM_LIMIT
max_file_uploads = 20
EOF

    green_success "PHP配置已保存到: $CUSTOM_CONF"

    # =========== 修改Nginx配置 ===========
    blue_info "正在修改Nginx上传配置..."

    nginx_configs=$(find /etc/nginx/sites-available -type f ! -name "*.backup.*" 2>/dev/null)
    modified_sites=0

    for config in $nginx_configs; do
        if grep -q "client_max_body_size" "$config"; then
            sed -i "s/client_max_body_size\s*[0-9KMG]*;/client_max_body_size ${new_size};/g" "$config"
            green_success "已更新配置: $config"
        else
            # 在 root 指令后添加 client_max_body_size
            if grep -q "root.*;" "$config"; then
                sed -i "0,/root.*;/s/root.*;/&\n    client_max_body_size ${new_size};/" "$config"
                green_success "已添加配置到: $config"
            else
                sed -i "/server {/a\    client_max_body_size ${new_size};" "$config"
                green_success "已添加配置到: $config"
            fi
        fi
        ((modified_sites++))
    done

    # 修改主 nginx.conf 全局配置
    main_nginx_conf="/etc/nginx/nginx.conf"
    if [ -f "$main_nginx_conf" ]; then
        if grep -q "client_max_body_size" "$main_nginx_conf"; then
            sed -i "s/client_max_body_size\s*[0-9KMG]*;/client_max_body_size ${new_size};/g" "$main_nginx_conf"
            green_success "已更新主nginx.conf配置"
        else
            if grep -q "http {" "$main_nginx_conf"; then
                sed -i "/http {/a\    client_max_body_size ${new_size};" "$main_nginx_conf"
                green_success "已添加配置到主nginx.conf"
            else
                yellow_prompt "警告：无法在nginx.conf中找到http块，跳过全局设置"
            fi
        fi
    fi

    green_success "已修改 $modified_sites 个站点的Nginx配置"

    # =========== 重启服务 ===========
    blue_info "正在重启PHP-FPM和Nginx..."
    systemctl restart php8.2-fpm && green_success "PHP-FPM重启成功" || red_error "PHP-FPM重启失败"

    nginx -t && restart_system_nginx && green_success "Nginx重启成功" || red_error "Nginx配置检查失败"

    green_success "================================================"
    green_success "✅ 上传配置修改完成！"
    green_success "================================================"
    blue_info "📊 新的上传限制配置："
    echo "   1. PHP上传限制: $new_size"
    echo "   2. PHP内存限制: $MEM_LIMIT"
    echo "   3. Nginx上传限制: $new_size"
    echo ""
}

main() {
    check_and_switch_to_root
    while true; do
        show_main_menu
    done
}

if [ "$1" = "--list-sites-json" ]; then
    list_sites_json
    exit 0
fi

main
