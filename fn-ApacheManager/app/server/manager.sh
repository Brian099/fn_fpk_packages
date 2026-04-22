#!/bin/bash

# Apache Manager Backend Script (Offline Ready)
# Version: 1.0.0 (Dynamic Port)

# 获取脚本所在目录，确保路径正确
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
PKG_DIR="$SCRIPT_DIR/packages"

# Apache 状态检测逻辑
apache_status_json() {
  local installed=false
  local version_raw=""
  local running=false
  
  if [ -x "/usr/sbin/apache2" ] && [ -f "/etc/apache2/apache2.conf" ]; then
    installed=true
    version_raw=$(/usr/sbin/apache2 -v | grep "Server version" | sed 's/Server version: //')
    if systemctl is-active --quiet apache2; then
        running=true
    fi
  fi
  
  local config_exists=false
  if [ -f "/etc/apache2/apache2.conf" ]; then
    config_exists=true
  fi

  local version_json="\"\""
  if [ -n "$version_raw" ]; then
    version_json="\"$(echo "$version_raw" | sed 's/\\/\\\\/g; s/"/\\"/g')\""
  fi
  
  echo "{\"installed\":$installed,\"running\":$running,\"version\":$version_json,\"config_exists\":$config_exists}"
}

# 获取系统架构
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)
    PKG_ARCH_DIR="$PKG_DIR/x86_64"
    ;;
  aarch64|arm64)
    PKG_ARCH_DIR="$PKG_DIR/aarch64"
    ;;
  *)
    printf '{"ok":false,"error":"不支持的架构: %s"}' "$ARCH"
    exit 1
    ;;
esac

# Apache 离线安装及配置逻辑 (支持引导参数)
apache_install_json() {
  # 获取向导传入的端口参数，默认为 2880
  local port_to_use="${wizard_apache_port:-2880}"
  local already_installed=false

  if [ -x "/usr/sbin/apache2" ] && [ -f "/etc/apache2/apache2.conf" ]; then
    already_installed=true
  fi
  
  if [ "$already_installed" = false ]; then
    if [ ! -d "$PKG_ARCH_DIR" ] || [ -z "$(ls -A "$PKG_ARCH_DIR" 2>/dev/null)" ]; then
      printf '{"ok":false,"error":"架构 %s 的本地软件包目录不存在或为空"}' "$ARCH"
      return 1
    fi
    # 使用 dpkg 尝试离线安装
    dpkg -i "$PKG_ARCH_DIR"/*.deb >/tmp/apache_manager_install.log 2>&1
    # 修复依赖关系 (如果系统中存在部分未满足的库)
    apt-get install -y -f >>/tmp/apache_manager_install.log 2>&1
  fi

  # 无论是否新安装，都进行端口重配置并使配置生效
  if [ -x "/usr/sbin/apache2" ]; then
      # 修改 ports.conf 中的 Listen 指令
      if [ -f "/etc/apache2/ports.conf" ]; then
          sed -i "s/^Listen 80/Listen $port_to_use/g" /etc/apache2/ports.conf
      fi

      # 修改所有启用站点的端口 (主要是 000-default.conf)
      local site_configs=$(grep -rlE "<VirtualHost\s+[^>]*:80>" /etc/apache2/sites-available 2>/dev/null)
      if [ -n "$site_configs" ]; then
          echo "$site_configs" | xargs -r sed -i "s/:80>/:$port_to_use>/g"
      fi
      
      # 精准使配置生效
      systemctl daemon-reload >/dev/null 2>&1
      systemctl enable apache2 >/dev/null 2>&1
      
      # 检查配置语法并尝试重启
      if /usr/sbin/apache2ctl -t >/dev/null 2>&1; then
          systemctl restart apache2 >/dev/null 2>&1
      else
          # 如果配置有误，记录到日志
          /usr/sbin/apache2ctl -t 2>/tmp/apache_config_error.log
      fi
      
      # 清理日志
      if [ -f "/var/log/apache2/error.log" ]; then
          : > /var/log/apache2/error.log
      fi
      
      if [ "$already_installed" = true ]; then
          printf '{"ok":true,"message":"Apache 已检测到安装，已同步端口为 %s"}' "$port_to_use"
      else
          printf '{"ok":true,"message":"Apache 离线安装成功，当前端口为 %s"}' "$port_to_use"
      fi
  else
      error_tail=$(tail -n 3 /tmp/apache_manager_install.log | tr -d '"' | tr '\n' ' ')
      printf '{"ok":false,"error":"安装失败: %s"}' "$error_tail"
  fi
}

# 动作分发
case "$1" in
  status)
    apache_status_json
    ;;
  install)
    apache_install_json
    ;;
  start)
    systemctl start apache2 && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  stop)
    systemctl stop apache2 && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  restart)
    systemctl restart apache2 && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  reload)
    systemctl reload apache2 && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  check)
    output=$(/usr/sbin/apache2ctl -t 2>&1)
    if [ $? -eq 0 ]; then
      output_esc=$(echo "$output" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n')
      echo "{\"ok\":true,\"output\":\"$output_esc\"}"
    else
      error_esc=$(echo "$output" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n')
      echo "{\"ok\":false,\"error\":\"$error_esc\"}"
    fi
    ;;
  logs)
    if [ -f /var/log/nginx/error.log ]; then
        content=$(tail -n 100 /var/log/nginx/error.log | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | tr -d '\r')
        printf '{"ok":true,"log":"%s"}' "$content"
    else
        echo '{"ok":false,"error":"日志文件不存在"}'
    fi
    ;;
  *)
    echo '{"error":"不支持的操作: '"$1"'"}'
    exit 1
    ;;
esac
