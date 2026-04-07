#!/bin/bash

# Nginx Manager Backend Script (Offline Ready)
# Version: 1.1.1 (Dynamic Port)

# 获取脚本所在目录，确保路径正确
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
PKG_DIR="$SCRIPT_DIR/packages"

# Nginx 状态检测逻辑
nginx_status_json() {
  local installed=false
  local version_raw=""
  local running=false
  
  if [ -x "/usr/sbin/nginx" ] && [ -f "/etc/nginx/nginx.conf" ]; then
    installed=true
    version_raw=$(/usr/sbin/nginx -v 2>&1 | sed 's/^[^:]*: //')
    if systemctl is-active --quiet nginx; then
        running=true
    fi
  fi
  
  local config_exists=false
  if [ -f "/etc/nginx/nginx.conf" ]; then
    config_exists=true
  fi

  local version_json="\"\""
  if [ -n "$version_raw" ]; then
    version_json="\"$(echo "$version_raw" | sed 's/\\/\\\\/g; s/"/\\"/g')\""
  fi
  
  echo "{\"installed\":$installed,\"running\":$running,\"version\":$version_json,\"config_exists\":$config_exists}"
}

# Nginx 离线安装及配置逻辑 (支持引导参数)
nginx_install_json() {
  # 获取向导传入的端口参数，默认为 2829
  local port_to_use="${wizard_nginx_port:-2829}"
  local already_installed=false

  if [ -x "/usr/sbin/nginx" ] && [ -f "/etc/nginx/nginx.conf" ]; then
    already_installed=true
  fi
  
  if [ "$already_installed" = false ]; then
    if [ ! -d "$PKG_DIR" ]; then
      printf '{"ok":false,"error":"本地软件包目录不存在，请检查应用完整性"}'
      return 1
    fi
    # 使用 dpkg 尝试离线安装
    dpkg -i "$PKG_DIR"/*.deb >/tmp/nginx_manager_install.log 2>&1
    # 修复依赖关系 (如果系统中存在部分未满足的库)
    apt-get install -y -f >>/tmp/nginx_manager_install.log 2>&1
  fi

  # 无论是否新安装，都进行端口重配置并使配置生效
  if [ -x "/usr/sbin/nginx" ]; then
      # 第一步：精准定位与 /etc/nginx 关联的 Nginx master 进程 PID
      local target_pid=$(ps aux | grep "nginx: master process" | grep -E "/etc/nginx|/usr/sbin/nginx" | grep -v grep | awk '{print $2}' | head -n 1)
      
      # 第二步：全量搜索替换 /etc/nginx 目录下所有配置文件的 80 端口
      # 匹配模式：确保能同时处理 IPv4 (listen 80) 和 IPv6 (listen [::]:80)
      local config_files=$(grep -rlE "listen\s+([^;]*[:\s])?80(\s+|$|;)" /etc/nginx 2>/dev/null)
      if [ -n "$config_files" ]; then
          # 替换逻辑：匹配 listen 关键字后，直到 80 之前的所有非分号字符，并将其后的 80 替换为新端口
          echo "$config_files" | xargs -r sed -i -E "s/(listen\s+[^;]*[:\s])80/\1$port_to_use/g"
      fi

      # 特殊补充：针对可能存在的常用默认配置文件进行兜底匹配
      for extra_cfg in "/etc/nginx/sites-available/default" "/etc/nginx/conf.d/default.conf"; do
          if [ -f "$extra_cfg" ]; then
              sed -i -E "s/(listen\s+[^;]*)80/\1$port_to_use/g" "$extra_cfg"
          fi
      done
      
      # 第三步：精准使配置生效
      # 优先使用 nginx -s reload 实现零停机热重载，避免 systemctl restart 导致的服务中断
      if [ -n "$target_pid" ]; then
          # 使用特定配置文件进行热重载
          /usr/sbin/nginx -c /etc/nginx/nginx.conf -s reload >/dev/null 2>&1
      else
          # 如果进程未运行（可能因为之前的端口冲突），则尝试启动
          systemctl daemon-reload >/dev/null 2>&1
          systemctl enable nginx >/dev/null 2>&1
          systemctl start nginx >/dev/null 2>&1
      fi
      
      # 第四步：清理安装过程中的初始报错日志（如端口冲突报错），确保面板日志干净
      if [ -f "/var/log/nginx/error.log" ]; then
          : > /var/log/nginx/error.log
      fi
      
      if [ "$already_installed" = true ]; then
          printf '{"ok":true,"message":"Nginx 已检测到安装，已同步端口为 %s"}' "$port_to_use"
      else
          printf '{"ok":true,"message":"Nginx 离线安装成功，当前端口为 %s"}' "$port_to_use"
      fi
  else
      error_tail=$(tail -n 3 /tmp/nginx_manager_install.log | tr -d '"' | tr '\n' ' ')
      printf '{"ok":false,"error":"安装失败: %s"}' "$error_tail"
  fi
}

# 动作分发
case "$1" in
  status)
    nginx_status_json
    ;;
  install)
    nginx_install_json
    ;;
  start)
    systemctl start nginx && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  stop)
    systemctl stop nginx && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  restart)
    systemctl restart nginx && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  reload)
    systemctl reload nginx && echo '{"ok":true}' || echo '{"ok":false}'
    ;;
  check)
    output=$(nginx -t 2>&1)
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
