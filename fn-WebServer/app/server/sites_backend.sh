#!/bin/bash

reload_nginx_safe() {
  # Safe reload for standard Nginx (avoiding system/trim Nginx)
  SYSTEM_NGINX_PID=$(pgrep -f "/usr/sbin/nginx" | head -1)
  if [ -n "$SYSTEM_NGINX_PID" ]; then
    kill -HUP "$SYSTEM_NGINX_PID"
  else
    systemctl start nginx >/dev/null 2>&1 || true
  fi
}

urldecode() {
  local encoded="$1"
  if [ -z "$encoded" ]; then return; fi
  if command -v php >/dev/null 2>&1; then
    php -r "echo rawurldecode(\$argv[1]);" -- "$encoded"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))" "$encoded"
  else
    echo "$encoded"
  fi
}

create_certificate_placeholder() {
    local cert_file="$1"
    local key_file="$2"
    local domain="${3:-placeholder.local}"
    
    # Ensure cert dir exists
    certs_dir=$(dirname "$cert_file")
    mkdir -p "$certs_dir"
    
    # Check if openssl exists
    if ! command -v openssl &> /dev/null; then
        return 1
    fi
    
    # Skip if valid cert exists
    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
        if openssl x509 -in "$cert_file" -noout 2>/dev/null; then
            return 0
        fi
    fi
    
    # Generate private key
    openssl genrsa -out "$key_file" 2048 2>/dev/null
    chmod 600 "$key_file"
    
    # Generate self-signed cert
    openssl req -new -x509 -days 365 -key "$key_file" -out "$cert_file" \
        -subj "/C=CN/ST=Beijing/L=Beijing/O=Temp/CN=$domain" \
        -addext "subjectAltName = DNS:$domain" 2>/dev/null
    
    if [ $? -ne 0 ]; then
        # Retry without extensions if failed
        openssl req -new -x509 -days 365 -key "$key_file" -out "$cert_file" \
            -subj "/C=CN/ST=Beijing/L=Beijing/O=Temp/CN=$domain" 2>/dev/null
    fi
    
    chmod 644 "$cert_file"
}

check_port_conflict() {
    check_port="$1"
    
    # 1. Check active system ports
    # Try ss first
    if command -v ss >/dev/null 2>&1; then
        if ss -tuln | grep -q ":$check_port "; then
            return 1
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -tuln | grep -q ":$check_port "; then
            return 1
        fi
    fi
    
    # 2. Check Nginx enabled configurations
    # Use find to safely get files, avoiding glob issues if directory is empty
    conf_files=$(find /etc/nginx/sites-enabled/ /etc/nginx/nginx.conf -type f 2>/dev/null)
    
    if [ -n "$conf_files" ]; then
        # Use grep on the file list
        # We process line by line to handle potential parsing issues more gracefully
        # Extract ports: remove comments, find 'listen', get 2nd arg, remove semicolon
        nginx_ports=$(grep "listen" $conf_files 2>/dev/null | \
            sed 's/#.*//' | \
            grep "listen" | \
            awk '{print $2}' | \
            tr -d ';' | \
            awk -F':' '{print $NF}' | \
            sort -u)
            
        for p in $nginx_ports; do
            if [ "$p" = "$check_port" ]; then
                return 2
            fi
        done
    fi
    
    return 0
}

create_site_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  
  mode=$(echo "$input" | grep "^mode=" | cut -d= -f2- | tr -d '\r')
  rewrite_encoded=$(echo "$input" | grep "^rewrite=" | cut -d= -f2- | tr -d '\r')
  rewrite_block=""
  if [ -n "$rewrite_encoded" ]; then
    decoded=""
    if command -v php >/dev/null 2>&1; then
      decoded=$(php -r "echo rawurldecode(\$argv[1]);" -- "$rewrite_encoded")
    elif command -v python3 >/dev/null 2>&1; then
      decoded=$(python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))" "$rewrite_encoded")
    fi
    
    if [ -n "$decoded" ]; then
        # Handle indentation and escaping for HERE-document
        rewrite_block=$(echo "$decoded" | awk '{
            # Remove leading whitespace
            if ($0 != "") sub(/^[ \t]+/, "", $0);
            
            # Ensure space before { for location blocks
            if ($0 ~ /^location/ && $0 ~ /\{$/ && $0 !~ / \{$/) {
                sub(/\{$/, " {", $0);
            }
            
            # Indent
            if ($0 == "") print "";
            else if ($0 ~ /^location/ || $0 ~ /^}$/) print "    " $0;
            else print "        " $0;
        }' | sed 's/\\/\\\\/g; s/\$/\\\$/g; s/`/\\`/g')
    fi
  fi
  
  # Check if user provided a root location block to avoid duplicate location /
  root_location_block="    location / {
        try_files \$uri \$uri/ =404;
    }"
    
  if [ -n "$rewrite_block" ]; then
      # Check for "location / {" or "location /{" with varying spaces
      # We unescape the rewrite_block slightly for grep checking because we escaped $ and \ above
      # Actually simpler: check the original decoded string if possible, but we don't have it easily accessible in all paths
      # Let's just grep the rewrite_block. Note that it has escaped chars.
      # "location / {" might look like "location / {"
      if echo "$rewrite_block" | grep -qE "location[[:space:]]+/[[:space:]]*\{"; then
          root_location_block=""
      fi
  fi
  domain=$(echo "$input" | grep "^domain=" | cut -d= -f2- | tr -d '\r')
  custom_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  if [ -n "$custom_name" ]; then
      custom_name=$(urldecode "$custom_name")
      # Validate custom name (alphanumeric, dot, hyphen, underscore)
      if echo "$custom_name" | grep -q "[^a-zA-Z0-9._-]"; then
          echo '{"ok":false,"error":"invalid site name (only alphanumeric, dot, hyphen, underscore allowed)"}'
          return 0
      fi
  fi
  port=$(echo "$input" | grep "^port=" | cut -d= -f2- | tr -d '\r') # Legacy/Port HTTP
  port_https=$(echo "$input" | grep "^port_https=" | cut -d= -f2- | tr -d '\r')
  root_dir=$(echo "$input" | grep "^root=" | cut -d= -f2- | tr -d '\r')
  https_enabled=$(echo "$input" | grep "^https_enabled=" | cut -d= -f2- | tr -d '\r')
  php_version=$(echo "$input" | grep "^php_version=" | cut -d= -f2- | tr -d '\r')

  # Fallback to the first available version if not specified
  if [ -z "$php_version" ]; then
      php_version=$(ls /etc/php/ 2>/dev/null | head -1)
      if [ -z "$php_version" ]; then php_version="8.2"; fi
  fi
  php_socket="/run/php/php${php_version}-fpm.sock"

  # Fallback for legacy calls or simple port mode
  if [ -z "$mode" ]; then
      # Infer mode
      if [ -n "$domain" ] && [ "$domain" != "localhost" ]; then
          mode="domain"
      else
          mode="port"
      fi
  fi

  if [ -z "$root_dir" ]; then
     echo '{"ok":false,"error":"missing root directory"}'
     return 0
  fi
  
  mkdir -p "$root_dir"
  chown -R www-data:www-data "$root_dir" 2>/dev/null || true
  chmod -R 755 "$root_dir" 2>/dev/null || true

  site_name=""
  config_file=""
  
  if [ "$mode" = "domain" ]; then
      if [ -z "$domain" ]; then
          echo '{"ok":false,"error":"missing domain"}'
          return 0
      fi
      if echo "$domain" | grep -q "[^a-zA-Z0-9.-]"; then
          echo '{"ok":false,"error":"invalid domain"}'
          return 0
      fi
      
      if [ -n "$custom_name" ]; then
          site_name="$custom_name"
      else
          site_name="$domain"
      fi
      config_file="/etc/nginx/sites-available/$site_name"
      
      if [ -f "$config_file" ]; then
          echo "{\"ok\":false,\"error\":\"site/config already exists: $site_name\"}"
          return 0
      fi

      if [ "$https_enabled" = "true" ]; then
          ssl_cert="/etc/nginx/certs/${domain}.pem"
          ssl_key="/etc/nginx/certs/${domain}.key"
          create_certificate_placeholder "$ssl_cert" "$ssl_key" "$domain"
          
          cat > "$config_file" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $domain;

    ssl_certificate $ssl_cert;
    ssl_certificate_key $ssl_key;
    ssl_session_timeout 5m;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
    add_header Strict-Transport-Security "max-age=31536000";

    root $root_dir;
    index index.html index.htm index.php;
    client_max_body_size 8M;
    
    $rewrite_block
    
    $root_location_block
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:$php_socket;
        fastcgi_param HTTPS on;
    }
}
EOF
      else
          cat > "$config_file" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    root $root_dir;
    index index.html index.htm index.php;
    client_max_body_size 8M;
    
    $rewrite_block
    
    $root_location_block
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:$php_socket;
    }
}
EOF
      fi
      
  else
      # Port mode
      if [ -z "$port" ]; then
          echo '{"ok":false,"error":"missing port"}'
          return 0
      fi
      
      # Check if port is in use
      check_port_conflict "$port"
      conflict_status=$?
      if [ $conflict_status -eq 1 ]; then
          echo "{\"ok\":false,\"error\":\"Port $port is already in use (System)\"}"
          return 0
      elif [ $conflict_status -eq 2 ]; then
          echo "{\"ok\":false,\"error\":\"Port $port is already in use (Nginx Config)\"}"
          return 0
      fi

      if [ -n "$custom_name" ]; then
          site_name="$custom_name"
      else
          site_name="port_${port}"
      fi
      config_file="/etc/nginx/sites-available/$site_name"
      
      if [ -f "$config_file" ]; then
          echo "{\"ok\":false,\"error\":\"site/config already exists: $site_name\"}"
          return 0
      fi
      
      if [ "$https_enabled" = "true" ]; then
          if [ -z "$port_https" ]; then
               echo '{"ok":false,"error":"missing https port"}'
               return 0
          fi
          
          check_port_conflict "$port_https"
          conflict_status=$?
          if [ $conflict_status -eq 1 ]; then
              echo "{\"ok\":false,\"error\":\"HTTPS Port $port_https is already in use (System)\"}"
              return 0
          elif [ $conflict_status -eq 2 ]; then
              echo "{\"ok\":false,\"error\":\"HTTPS Port $port_https is already in use (Nginx Config)\"}"
              return 0
          fi

          ssl_cert="/etc/nginx/certs/${site_name}_ssl${port_https}.pem"
          ssl_key="/etc/nginx/certs/${site_name}_ssl${port_https}.key"
          create_certificate_placeholder "$ssl_cert" "$ssl_key" "localhost"
          
          cat > "$config_file" <<EOF
server {
    listen $port default_server;
    listen [::]:$port default_server;
    listen $port_https ssl default_server;
    listen [::]:$port_https ssl default_server;
    
    server_name _;
    
    ssl_certificate $ssl_cert;
    ssl_certificate_key $ssl_key;
    ssl_session_timeout 5m;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;

    root $root_dir;
    index index.html index.htm index.php;
    client_max_body_size 8M;
    
    $rewrite_block
    
    $root_location_block
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:$php_socket;
    }
}
EOF
      else
          cat > "$config_file" <<EOF
server {
    listen $port default_server;
    listen [::]:$port default_server;
    server_name _;
    root $root_dir;
    index index.html index.htm index.php;
    client_max_body_size 8M;
    
    $rewrite_block
    
    $root_location_block
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:$php_socket;
    }
}
EOF
      fi
  fi

  ln -sf "$config_file" "/etc/nginx/sites-enabled/$site_name"
  
  nginx_test_output=$(nginx -t 2>&1)
  nginx_test_status=$?
  
  if [ $nginx_test_status -eq 0 ]; then
      reload_nginx_safe
      echo '{"ok":true,"message":"site created"}'
  else
      # Config check failed - Immediate Rollback
      rm -f "/etc/nginx/sites-enabled/$site_name"
      rm -f "$config_file"
      
      # Clean up error message for JSON (escape quotes, replace newlines)
      error_msg=$(echo "$nginx_test_output" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ' | sed 's/  */ /g')
      
      echo "{\"ok\":false,\"error\":\"Nginx check failed: $error_msg\"}"
      return 0
  fi
}

list_sites_json() {
  available_sites=$(ls /etc/nginx/sites-available/ 2>/dev/null)
  if [ -z "$available_sites" ]; then
    echo "[]"
    return 0
  fi
  first=1
  echo '['
  for site in $available_sites; do
    config_file="/etc/nginx/sites-available/$site"
    if [ ! -f "$config_file" ]; then
      continue
    fi
    # Extract all unique IPv4 ports
    port=$(grep "listen" "$config_file" 2>/dev/null | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | sort -nu | tr '\n' ',' | sed 's/,$//; s/,/, /g')
    root_dir=$(grep "root" "$config_file" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')
    server_name=$(grep "server_name" "$config_file" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')
    
    if [ -z "$port" ] && [ -z "$root_dir" ]; then
      continue
    fi
    
    mode="domain"
    if [ "$server_name" = "_" ]; then
        mode="port"
    fi
    
    # Extract PHP version from fastcgi_pass
    php_ver=$(grep "fastcgi_pass unix:/run/php/php" "$config_file" | head -1 | sed 's/.*php\(.*\)-fpm\.sock.*/\1/')
    if [ -z "$php_ver" ]; then
        php_ver="-"
    fi
    
    enabled=false
    if [ -L "/etc/nginx/sites-enabled/$site" ]; then
      enabled=true
    fi
    
    if [ $first -eq 0 ]; then
      echo ','
    fi
    first=0
    esc_site=$(echo "$site" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_port=$(echo "$port" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_root=$(echo "$root_dir" | sed 's/\\/\\\\/g; s/"/\\"/g')
    esc_php=$(echo "$php_ver" | sed 's/\\/\\\\/g; s/"/\\"/g')
    echo "{\"name\":\"$esc_site\",\"port\":\"$esc_port\",\"root\":\"$esc_root\",\"php\":\"$esc_php\",\"enabled\":$enabled,\"mode\":\"$mode\"}"
  done
  echo ']'
}

nginx_status_json() {
  # Strict check: Must have binary at /usr/sbin/nginx AND config at /etc/nginx/nginx.conf
  local installed=false
  local version_raw=""
  local running=false
  
  if [ -x "/usr/sbin/nginx" ] && [ -f "/etc/nginx/nginx.conf" ]; then
    installed=true
    version_raw=$(/usr/sbin/nginx -v 2>&1 | sed 's/^[^:]*: //')
    
    # Precise check for the instance using /etc/nginx
    local pids=$(pgrep -x nginx 2>/dev/null)
    for pid in $pids; do
        # Check if this process has the main /etc/nginx config file open
        if ls -l "/proc/$pid/fd" 2>/dev/null | grep -q "/etc/nginx/nginx.conf"; then
            running=true
            break
        fi
        # Fallback: if it's the system binary and no explicit config path in cmdline, 
        # it defaults to /etc/nginx
        local exe_path=$(readlink -f /proc/$pid/exe 2>/dev/null)
        if [ "$exe_path" = "/usr/sbin/nginx" ]; then
            if ! grep -q -E "\-c|\-p" "/proc/$pid/cmdline" 2>/dev/null; then
                running=true
                break
            fi
        fi
    done
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

php_status_json() {
  # 检测系统中安装的所有 PHP 版本及其 FPM 状态
  local installed_php=false
  if command -v php >/dev/null 2>&1; then
    installed_php=true
  fi

  # 寻找所有 php*-fpm.sock
  local fpm_sockets=$(ls /run/php/php*-fpm.sock 2>/dev/null)
  
  echo -n "{\"installed\":$installed_php,\"versions\":["
  local first=1
  
  # 如果没有运行中的套接字，则尝试从 /etc/php 扫描已安装版本
  local versions=$(ls /etc/php/ 2>/dev/null)
  for ver in $versions; do
    # 检查是否安装了 fpm 模块
    if [ -d "/etc/php/$ver/fpm" ]; then
      if [ $first -eq 0 ]; then echo -n ","; fi
      
      local running=false
      local socket="/run/php/php${ver}-fpm.sock"
      if [ -S "$socket" ]; then
        running=true
      fi
      
      echo -n "{\"version\":\"$ver\",\"running\":$running,\"socket\":\"$socket\"}"
      first=0
    fi
  done
  echo "]}"
}

nginx_install_json() {
  if [ -x "/usr/sbin/nginx" ] && [ -f "/etc/nginx/nginx.conf" ]; then
    printf '{"ok":true,"message":"nginx already installed (checked /etc/nginx/nginx.conf)"}'
    return 0
  fi
  export DEBIAN_FRONTEND=noninteractive
  if ! apt-get update -y >/tmp/webserver_nginx_install.log 2>&1; then
    printf '{"ok":false,"step":"apt-update"}'
    return 1
  fi
  # Attempt install, allow failure (e.g. port 80 conflict)
  install_status=0
  apt-get install -y nginx >>/tmp/webserver_nginx_install.log 2>&1 || install_status=$?

  # Modify default port to 2829 to avoid conflict with system nginx
  if [ -f /etc/nginx/sites-available/default ]; then
      sed -i 's/listen 80 default_server;/listen 2829 default_server;/g' /etc/nginx/sites-available/default
      sed -i 's/listen \[::\]:80 default_server;/listen [::]:2829 default_server;/g' /etc/nginx/sites-available/default
      # Also replace 443 with 2931 for HTTPS
      sed -i 's/listen 443/listen 2931/g' /etc/nginx/sites-available/default
      sed -i 's/listen \[::\]:443/listen [::]:2931/g' /etc/nginx/sites-available/default
  fi

  # If install failed, try to fix (finish configuration) now that port is changed
  if [ $install_status -ne 0 ]; then
      if ! apt-get install -y -f >>/tmp/webserver_nginx_install.log 2>&1; then
          printf '{"ok":false,"step":"apt-install-fix"}'
          return 1
      fi
  fi

  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl restart nginx >/dev/null 2>&1 || true
  printf '{"ok":true,"message":"nginx installed"}'
}

# PHP installation and management functions removed as per user request

# PHP remove functions removed

list_dirs_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input_path=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  else
    input_path="/"
  fi
  target_path=$(printf '%s' "$input_path" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -z "$target_path" ]; then target_path="/"; fi
  if [ ! -d "$target_path" ]; then
    echo '{"ok":false,"error":"path not found"}'
    return 1
  fi
  parent_path=$(dirname "$target_path")
  esc_current=$(echo "$target_path" | sed 's/\\/\\\\/g; s/"/\\"/g')
  esc_parent=$(echo "$parent_path" | sed 's/\\/\\\\/g; s/"/\\"/g')

  echo "{\"ok\":true,\"current\":\"$esc_current\",\"parent\":\"$esc_parent\",\"dirs\":["
  
  cd "$target_path" || return 1
  first=1
  for d in */; do
    if [ "$d" = "*/" ]; then break; fi
    dirname=${d%/}
    if [ $first -eq 0 ]; then echo ','; fi
    first=0
    esc_name=$(echo "$dirname" | sed 's/\\/\\\\/g; s/"/\\"/g')
    echo "\"$esc_name\""
  done
  echo ']}'
}



get_upload_limit_json() {
    # Fetch common limit from Nginx as PHP limits are now decentralized
    local limit="20M"
    local first_conf=$(ls /etc/nginx/sites-available/* 2>/dev/null | head -1)
    if [ -n "$first_conf" ] && [ -f "$first_conf" ]; then
        local found_limit=$(grep "client_max_body_size" "$first_conf" | head -1 | awk '{print $2}' | tr -d ';')
        if [ -n "$found_limit" ]; then
            limit="$found_limit"
        fi
    fi
    echo "{\"ok\":true,\"limit\":\"$limit\"}"
}

update_site_port_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  site_name=$(urldecode "$site_name")
  new_port=$(echo "$input" | grep "^port=" | cut -d= -f2- | tr -d '\r')
  new_port_https=$(echo "$input" | grep "^port_https=" | cut -d= -f2- | tr -d '\r')
  
  if [ -z "$site_name" ]; then
      echo '{"ok":false,"error":"missing site name"}'
      return 0
  fi
  
  if [ -z "$new_port" ]; then
      echo '{"ok":false,"error":"missing new port"}'
      return 0
  fi

  old_config_file="/etc/nginx/sites-available/$site_name"
  if [ ! -f "$old_config_file" ]; then
      echo '{"ok":false,"error":"site configuration not found"}'
      return 0
  fi
  
  # 1. Get current ports
  old_port=$(grep "listen" "$old_config_file" | grep -v "ssl" | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | head -1)
  old_port_https=$(grep "listen" "$old_config_file" | grep "ssl" | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | head -1)

  # 2. Check conflicts (only if ports changed)
  if [ "$new_port" != "$old_port" ]; then
      check_port_conflict "$new_port"
      conflict_status=$?
      if [ $conflict_status -ne 0 ]; then
          echo "{\"ok\":false,\"error\":\"Port $new_port is already in use\"}"
          return 0
      fi
  fi
  
  if [ -n "$new_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
      check_port_conflict "$new_port_https"
      conflict_status=$?
      if [ $conflict_status -ne 0 ]; then
          echo "{\"ok\":false,\"error\":\"HTTPS Port $new_port_https is already in use\"}"
          return 0
      fi
  fi

  # 3. Determine New Site Name and Config File
  final_site_name="$site_name"
  if [[ "$site_name" =~ ^port_[0-9]+$ ]] && [ "$new_port" != "$old_port" ]; then
      new_site_name="port_${new_port}"
  else
      new_site_name="$site_name"
  fi
  
  new_config_file="/etc/nginx/sites-available/$new_site_name"
  
  # Safety check: if new file exists and it's NOT the same as old file
  if [ "$new_config_file" != "$old_config_file" ] && [ -f "$new_config_file" ]; then
      echo "{\"ok\":false,\"error\":\"Target config file $new_site_name already exists\"}"
      return 0
  fi

  # 4. Create New Config (Copy Logic)
  if [ "$new_config_file" != "$old_config_file" ]; then
      cp "$old_config_file" "$new_config_file"
      temp_cleanup_file="$new_config_file"
      backup_file=""
  else
      cp "$old_config_file" "${old_config_file}.bak"
      temp_cleanup_file=""
      backup_file="${old_config_file}.bak"
  fi

  # 5. Modify New Config (In Place on new_config_file)
  if [ -n "$old_port" ] && [ "$new_port" != "$old_port" ]; then
      sed -i "s/listen $old_port/listen $new_port/g" "$new_config_file"
      sed -i "s/listen \[::\]:$old_port/listen [::]:$new_port/g" "$new_config_file"
  fi
  
  if [ -n "$new_port_https" ]; then
       if [ -n "$old_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
          sed -i "s/listen $old_port_https/listen $new_port_https/g" "$new_config_file"
          sed -i "s/listen \[::\]:$old_port_https/listen [::]:$new_port_https/g" "$new_config_file"
          
          if grep -q "_ssl${old_port_https}" "$new_config_file"; then
              sed -i "s/_ssl${old_port_https}/_ssl${new_port_https}/g" "$new_config_file"
          fi
       fi
  fi
  
  # Update Site Name in Config & Certs
  if [ "$new_site_name" != "$site_name" ]; then
      sed -i "s/${site_name}_ssl/${new_site_name}_ssl/g" "$new_config_file"
      
      if [ -n "$new_port_https" ]; then
           ssl_cert="/etc/nginx/certs/${new_site_name}_ssl${new_port_https}.pem"
           ssl_key="/etc/nginx/certs/${new_site_name}_ssl${new_port_https}.key"
           if [ ! -f "$ssl_cert" ]; then
               create_certificate_placeholder "$ssl_cert" "$ssl_key" "localhost"
           fi
      fi
      
      root_dir=$(grep "root" "$new_config_file" | head -1 | awk '{print $2}' | tr -d ';')
      if [ -f "$root_dir/website_info.txt" ]; then
          sed -i "s/网站名称: $site_name/网站名称: $new_site_name/" "$root_dir/website_info.txt"
      fi
  else
      if [ -n "$new_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
          if grep -q "${site_name}_ssl${new_port_https}" "$new_config_file"; then
               ssl_cert="/etc/nginx/certs/${site_name}_ssl${new_port_https}.pem"
               ssl_key="/etc/nginx/certs/${site_name}_ssl${new_port_https}.key"
               if [ ! -f "$ssl_cert" ]; then
                   create_certificate_placeholder "$ssl_cert" "$ssl_key" "localhost"
               fi
          fi
      fi
  fi

  # 6. Switch Links & Test
  rm -f "/etc/nginx/sites-enabled/$site_name"
  ln -sf "$new_config_file" "/etc/nginx/sites-enabled/$new_site_name"
  
  if nginx -t > /dev/null 2>&1; then
      reload_nginx_safe
      
      # Success! Cleanup
      if [ -n "$temp_cleanup_file" ]; then
          rm -f "$old_config_file"
      fi
      if [ -n "$backup_file" ]; then
          rm -f "$backup_file"
      fi
      
      echo '{"ok":true,"message":"site updated"}'
  else
      # Failure! Rollback
      rm -f "/etc/nginx/sites-enabled/$new_site_name"
      ln -sf "$old_config_file" "/etc/nginx/sites-enabled/$site_name"
      
      if [ -n "$temp_cleanup_file" ]; then
          rm -f "$temp_cleanup_file"
          # Revert info file
          root_dir=$(grep "root" "$old_config_file" | head -1 | awk '{print $2}' | tr -d ';')
          if [ -n "$root_dir" ] && [ -f "$root_dir/website_info.txt" ]; then
               sed -i "s/网站名称: $new_site_name/网站名称: $site_name/" "$root_dir/website_info.txt"
          fi
      fi
      if [ -n "$backup_file" ]; then
          mv "$backup_file" "$old_config_file"
      fi
      
      echo '{"ok":false,"error":"Nginx configuration test failed. Reverted to old config."}'
      return 0
  fi
}

delete_site_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  site_name=$(urldecode "$site_name")
  
  if [ -z "$site_name" ]; then
    echo '{"ok":false,"error":"missing site name"}'
    return 1
  fi
  
  config_file="/etc/nginx/sites-available/$site_name"
  if [ ! -f "$config_file" ]; then
    echo '{"ok":false,"error":"site not found"}'
    return 1
  fi

  # Extract root dir to remove website_info.txt
  root_dir=$(grep "root" "$config_file" | head -1 | awk '{print $2}' | tr -d ';')
  
  rm -f "/etc/nginx/sites-enabled/$site_name"
  rm -f "$config_file"
  
  if [ -n "$root_dir" ] && [ -d "$root_dir" ]; then
      rm -f "$root_dir/website_info.txt"
      rm -f "$root_dir/phpinfo.php"
  fi
  
  if nginx -t > /dev/null 2>&1; then
      reload_nginx_safe
      echo '{"ok":true,"message":"site deleted"}'
  else
      echo '{"ok":true,"message":"site deleted, but nginx config check failed"}'
  fi
}

set_upload_limit_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  new_size=$(echo "$input" | grep "^limit=" | cut -d= -f2- | tr -d '\r')

  if [ -z "$new_size" ]; then
      printf '{"ok":false,"error":"missing limit"}'
      return 1
  fi
  
  if ! [[ "$new_size" =~ ^[0-9]+[KMGkmg]?$ ]]; then
        printf '{"ok":false,"error":"invalid format"}'
        return 1
  fi
  
  # 1. Cleanup legacy PHP custom settings (for any installed version)
  rm -f /etc/php/*/fpm/conf.d/99-custom-upload.ini 2>/dev/null

  # 2. Update all Nginx site configs
  nginx_configs=$(find /etc/nginx/sites-available -type f ! -name "*.backup.*" 2>/dev/null)
  for config in $nginx_configs; do
      if grep -q "client_max_body_size" "$config"; then
          sed -i "s/client_max_body_size\s*[0-9KMGkmg]*;/client_max_body_size ${new_size};/g" "$config"
      else
          if grep -q "root.*;" "$config"; then
              sed -i "0,/root.*;/s/root.*;/&\n    client_max_body_size ${new_size};/" "$config"
          elif grep -q "server {" "$config"; then
              sed -i "0,/server {/s/server {/&\n    client_max_body_size ${new_size};/" "$config"
          fi
      fi
  done

  main_nginx_conf="/etc/nginx/nginx.conf"
  if [ -f "$main_nginx_conf" ]; then
      if grep -q "client_max_body_size" "$main_nginx_conf"; then
          sed -i "s/client_max_body_size\s*[0-9KMGkmg]*;/client_max_body_size ${new_size};/g" "$main_nginx_conf"
      else
          if grep -q "http {" "$main_nginx_conf"; then
              sed -i "/http {/a\    client_max_body_size ${new_size};" "$main_nginx_conf"
          fi
      fi
  fi

  if reload_nginx_safe; then
      printf '{"ok":true,"message":"Nginx upload limit applied (PHP limit must be managed via applications)"}'
  else
      printf '{"ok":false,"error":"Nginx reload failed"}'
  fi
}

enable_site_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  site_name=$(urldecode "$site_name")
  
  if [ -z "$site_name" ]; then
    echo '{"ok":false,"error":"missing site name"}'
    return 1
  fi
  
  available_config="/etc/nginx/sites-available/$site_name"
  enabled_link="/etc/nginx/sites-enabled/$site_name"
  
  if [ ! -f "$available_config" ]; then
    echo '{"ok":false,"error":"site config not found"}'
    return 1
  fi
  
  if [ -L "$enabled_link" ]; then
     echo '{"ok":true,"message":"site already enabled"}'
     return 0
  fi
  
  ln -s "$available_config" "$enabled_link"
  
  if nginx -t > /dev/null 2>&1; then
      reload_nginx_safe
      echo '{"ok":true,"message":"site enabled"}'
  else
      rm -f "$enabled_link"
      echo '{"ok":false,"error":"Nginx config check failed, site remains disabled"}'
  fi
}

disable_site_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  site_name=$(urldecode "$site_name")
  
  if [ -z "$site_name" ]; then
    echo '{"ok":false,"error":"missing site name"}'
    return 1
  fi
  
  enabled_link="/etc/nginx/sites-enabled/$site_name"
  
  if [ ! -L "$enabled_link" ] && [ ! -f "$enabled_link" ]; then
     echo '{"ok":true,"message":"site already disabled"}'
     return 0
  fi
  
  rm -f "$enabled_link"
  
  if nginx -t > /dev/null 2>&1; then
      reload_nginx_safe
      echo '{"ok":true,"message":"site disabled"}'
  else
      reload_nginx_safe
      echo '{"ok":true,"message":"site disabled (reload check warning)"}'
  fi
}

fix_permissions_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  site_name=$(urldecode "$site_name")
  
  if [ -z "$site_name" ]; then
    echo '{"ok":false,"error":"missing site name"}'
    return 1
  fi
  
  config_file="/etc/nginx/sites-available/$site_name"
  if [ ! -f "$config_file" ]; then
    echo '{"ok":false,"error":"site config not found"}'
    return 1
  fi
  
  root_dir=$(grep "root" "$config_file" | head -1 | awk '{print $2}' | tr -d ';')
  
  if [ -z "$root_dir" ] || [ ! -d "$root_dir" ]; then
    echo '{"ok":false,"error":"root directory not found"}'
    return 1
  fi
  
  chown -R www-data:www-data "$root_dir" 2>/dev/null || true
  chmod -R 755 "$root_dir" 2>/dev/null || true
  
  echo '{"ok":true,"message":"permissions fixed"}'
}

# --- Database Instance ID Logic ---
get_db_instance_id() {
    local id_file="/opt/webserver/.db_instance_id"
    if [ ! -f "$id_file" ]; then
        mkdir -p "/opt/webserver"
        printf "%06d" $((RANDOM % 1000000)) > "$id_file"
    fi
    cat "$id_file"
}

nginx_restart_json() {
  if systemctl restart nginx >/dev/null 2>&1; then
    echo '{"ok":true,"message":"Nginx restarted successfully"}'
  else
    echo '{"ok":false,"error":"Failed to restart Nginx"}'
  fi
}

check_db_status_json() {
  local db_id=$(get_db_instance_id)
  
  echo -n "{\"ok\":true,\"databases\":["
  local first=1

  # 1. Check systemd services (MariaDB, MySQL, PostgreSQL)
  # --- 1. Detect MariaDB / MySQL (System) ---
  local mysql_type=""
  local mysql_status="not_installed"
  
  # Try to detect via binary first for precise typing
  if command -v mysql >/dev/null 2>&1; then
      local version_str=$(mysql --version 2>&1)
      if echo "$version_str" | grep -iq "MariaDB"; then
          mysql_type="mariadb"
      else
          mysql_type="mysql"
      fi
      
      # Check service status (common names)
      if pgrep -x mariadbd >/dev/null 2>&1 || pgrep -x mysqld >/dev/null 2>&1 || \
         systemctl is-active mariadb --quiet 2>/dev/null || systemctl is-active mysql --quiet 2>/dev/null; then
          mysql_status="running"
      else
          mysql_status="installed"
      fi
  fi
  
  # Fallback to service/dpkg if binary not in PATH but service exists
  if [ "$mysql_status" = "not_installed" ]; then
      if systemctl list-unit-files "mariadb.service" --quiet 2>/dev/null | grep -q "mariadb" 2>/dev/null || \
         dpkg -l | grep -q "mariadb-server" 2>/dev/null || \
         [ -d "/etc/mysql/mariadb.conf.d" ]; then
          mysql_type="mariadb"
          mysql_status="installed"
          # Final check if it is running under shared names
          if pgrep -x mariadbd >/dev/null 2>&1 || pgrep -x mysqld >/dev/null 2>&1 || \
             systemctl is-active mysql --quiet 2>/dev/null || systemctl is-active mariadb --quiet 2>/dev/null; then
              mysql_status="running"
          fi
      elif systemctl list-unit-files "mysql.service" --quiet 2>/dev/null | grep -q "mysql" 2>/dev/null || \
           dpkg -l | grep -q "mysql-server" 2>/dev/null || \
           [ -d "/etc/mysql/mysql.conf.d" ]; then
          mysql_type="mysql"
          mysql_status="installed"
          if systemctl is-active mysql --quiet 2>/dev/null; then
              mysql_status="running"
          fi
      fi
  fi

  if [ "$mysql_status" != "not_installed" ]; then
    if [ $first -eq 0 ]; then echo -n ","; fi
    echo -n "{\"type\":\"system\",\"name\":\"$mysql_type\",\"status\":\"$mysql_status\"}"
    first=0
  fi

  # --- 2. Detect PostgreSQL (System) ---
  local pg_status="not_installed"
  if pgrep -x postgres >/dev/null 2>&1 || systemctl is-active postgresql --quiet 2>/dev/null; then
      pg_status="running"
  elif systemctl list-unit-files "postgresql.service" --quiet 2>/dev/null | grep -q "postgresql" 2>/dev/null || \
       dpkg -l | grep -q "postgresql" 2>/dev/null || \
       command -v psql >/dev/null 2>&1 || \
       [ -d "/etc/postgresql" ]; then
      pg_status="installed"
  fi
  
  if [ "$pg_status" != "not_installed" ]; then
      if [ $first -eq 0 ]; then echo -n ","; fi
      echo -n "{\"type\":\"system\",\"name\":\"postgresql\",\"status\":\"$pg_status\"}"
      first=0
  fi

  # 2. Check Docker containers (Always check, even if system DB exists)
  if command -v docker >/dev/null 2>&1; then
    local d_status="not_installed"
    if docker ps --format '{{.Names}}' | grep -q "^WebServer_MySql_${db_id}$"; then
      d_status="running"
    elif docker ps -a --format '{{.Names}}' | grep -q "^WebServer_MySql_${db_id}$"; then
      d_status="installed"
    fi

    if [ "$d_status" != "not_installed" ]; then
      if [ $first -eq 0 ]; then echo -n ","; fi
      echo -n "{\"type\":\"docker\",\"name\":\"mysql\",\"status\":\"$d_status\",\"db_id\":\"$db_id\"}"
      first=0
    fi
  fi

  echo "]}"
}

install_db_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  password=$(echo "$input" | grep "^password=" | cut -d= -f2- | tr -d '\r')
  db_id=$(get_db_instance_id)

  if [ -z "$password" ]; then
    echo '{"ok":false,"error":"Missing password"}'
    return 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
      echo '{"ok":false,"error":"Docker 未安装，无法部署数据库"}'
      return 1
  fi

  DB_DIR="/opt/webserver/db"
  mkdir -p "$DB_DIR"/{data,logs,config}

  # If docker-compose.yml exists, check if we should overwrite or if it's already running
  if [ -f "$DB_DIR/docker-compose.yml" ]; then
      # Try to start it if it exists
      cd "$DB_DIR"
      if docker compose up -d >/tmp/webserver_db_install.log 2>&1; then
           echo '{"ok":true,"message":"Existing database stack started"}'
           return 0
      fi
  fi

  cat > "$DB_DIR/docker-compose.yml" <<EOF
services:
  mysql:
    container_name: WebServer_MySql_${db_id}
    image: mysql:latest
    restart: always
    ports:
      - "3306:3306"
      - "33060:33060"
    environment:
      MYSQL_ROOT_PASSWORD: ${password}
      MYSQL_CHARACTER_SET_SERVER: utf8mb4
      MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
    volumes:
      - ./data:/var/lib/mysql
      - ./logs:/var/log/mysql
      - ./config:/etc/mysql/conf.d
    extra_hosts:
      - "host.docker.internal:host-gateway"

  phpmyadmin:
    container_name: WebServer_PhpMyAdmin_${db_id}
    image: phpmyadmin:latest
    restart: always
    ports:
      - "8080:80"
    environment:
      PMA_HOST: mysql
      PMA_PORT: 3306
      MYSQL_ROOT_PASSWORD: ${password}
    depends_on:
      - mysql
EOF

  cd "$DB_DIR" || return 1
  
  if docker compose up -d >/tmp/webserver_db_install.log 2>&1; then
      echo '{"ok":true,"message":"Docker版数据库安装成功 (ID: '"${db_id}"')"}'
  else
      echo '{"ok":false,"error":"Docker compose 启动失败"}'
  fi
}

get_install_log_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  
  log_type=$(echo "$input" | grep "^type=" | cut -d= -f2- | tr -d '\r')
  log_type=$(urldecode "$log_type")
  
  log_file=""
  if [ "$log_type" = "nginx" ]; then
    log_file="/tmp/webserver_nginx_install.log"
  elif [ "$log_type" = "php" ]; then
    log_file="/tmp/webserver_php_install.log"
  elif [ "$log_type" = "db" ]; then
    log_file="/tmp/webserver_db_install.log"
  fi
  
  if [ -n "$log_file" ] && [ -f "$log_file" ]; then
    # Get last 2000 chars
    content=$(tail -c 2000 "$log_file" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | tr -d '\r')
    printf '{"ok":true,"log":"%s"}' "$content"
  else
    printf '{"ok":true,"log":""}'
  fi
}

case "$1" in
  list-sites-json)
    list_sites_json
    ;;
  list-dirs)
    list_dirs_json
    ;;
  create-site)
    create_site_json
    ;;
  get-upload-limit)
    get_upload_limit_json
    ;;
  set-upload-limit)
    set_upload_limit_json
    ;;
  update-site-port)
    update_site_port_json
    ;;
  delete-site)
    delete_site_json
    ;;
  enable-site)
    enable_site_json
    ;;
  disable-site)
    disable_site_json
    ;;
  fix-permissions)
    fix_permissions_json
    ;;
  nginx-restart)
    nginx_restart_json
    ;;
  nginx-status)
    nginx_status_json
    ;;
  php-status)
    php_status_json
    ;;
  php-extensions-status)
    php_extensions_status_json
    ;;
  nginx-install)
    nginx_install_json
    ;;
  check-db-status)
    check_db_status_json
    ;;
  install-db)
    install_db_json
    ;;
  php-install)
    php_install_json
    ;;
  php-remove)
    php_remove_json
    ;;
  get-install-log)
    get_install_log_json
    ;;
  *)
    echo '{"error":"unsupported action"}'
    exit 1
    ;;
esac
