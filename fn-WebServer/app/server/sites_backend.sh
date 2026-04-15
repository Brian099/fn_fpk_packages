#!/bin/bash

get_web_server_type() {
    local conf_file="/opt/webserver/web_server_type.conf"
    if [ ! -f "$conf_file" ]; then
        mkdir -p "/opt/webserver"
        echo "nginx" > "$conf_file"
    fi
    cat "$conf_file"
}

detect_site_driver() {
    local name="$1"
    # Check Apache first (sites return with .conf sometimes)
    if [ -f "/etc/apache2/sites-available/$name" ]; then
        echo "apache"
    elif [ -f "/etc/apache2/sites-available/${name}.conf" ]; then
        echo "apache"
    elif [ -f "/etc/nginx/sites-available/$name" ]; then
        echo "nginx"
    else
        get_web_server_type
    fi
}

reload_web_server() {
  local target_type="${1:-$(get_web_server_type)}"
  if [ "$target_type" = "apache" ]; then
    systemctl reload apache2 >/dev/null 2>&1 || systemctl start apache2 >/dev/null 2>&1 || true
  else
    # Safe reload for standard Nginx (avoiding system/trim Nginx)
    SYSTEM_NGINX_PID=$(pgrep -f "/usr/sbin/nginx" | head -1)
    if [ -n "$SYSTEM_NGINX_PID" ]; then
      kill -HUP "$SYSTEM_NGINX_PID"
    else
      systemctl start nginx >/dev/null 2>&1 || true
    fi
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

get_web_server_settings_json() {
    local ws_type=$(get_web_server_type)
    echo "{\"ok\":true,\"type\":\"$ws_type\"}"
}

set_web_server_type_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  new_type=$(echo "$input" | grep "^type=" | cut -d= -f2- | tr -d '\r')
  
  if [ "$new_type" != "nginx" ] && [ "$new_type" != "apache" ]; then
      echo '{"ok":false,"error":"invalid web server type"}'
      return 1
  fi
  
  echo "$new_type" > "/opt/webserver/web_server_type.conf"
  echo '{"ok":true,"message":"Web server type updated"}'
}

generate_apache_vhost() {
    local domain="$1"
    local port="$2"
    local root_dir="$3"
    local use_ssl="$4" # "true" or "false"
    local ssl_cert="$5"
    local ssl_key="$6"
    local php_socket="$7"
    
    # Fallback for ServerName if domain is empty (e.g. port mode)
    local server_name="${domain:-localhost}"
    
    # Fallback to general log names if domain is empty
    local log_prefix="${domain:-port_${port}}"

    cat <<EOF
<VirtualHost *:${port}>
    ServerName ${server_name}
    DocumentRoot ${root_dir}
    
    <Directory ${root_dir}>
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch \.php$>
        SetHandler "proxy:unix:${php_socket}|fcgi://localhost"
    </FilesMatch>

    ErrorLog \${APACHE_LOG_DIR}/${log_prefix}_error.log
    CustomLog \${APACHE_LOG_DIR}/${log_prefix}_access.log combined
EOF

    if [ "$use_ssl" = "true" ]; then
        cat <<EOF
    SSLEngine on
    SSLCertificateFile ${ssl_cert}
    SSLCertificateKeyFile ${ssl_key}
EOF
    fi

    echo "</VirtualHost>"
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
    conf_files_nginx=$(find /etc/nginx/sites-enabled/ /etc/nginx/nginx.conf -type f 2>/dev/null)
    if [ -n "$conf_files_nginx" ]; then
        nginx_ports=$(grep -h "listen" $conf_files_nginx 2>/dev/null | \
            sed 's/#.*//' | grep "listen" | awk '{print $2}' | tr -d ';' | awk -F':' '{print $NF}' | sort -u)
        for p in $nginx_ports; do
            if [ "$p" = "$check_port" ]; then return 2; fi
        done
    fi

    # 3. Check Apache configurations
    conf_files_apache=$(find /etc/apache2/sites-enabled/ /etc/apache2/ports.conf -type f 2>/dev/null)
    if [ -n "$conf_files_apache" ]; then
        apache_ports=$(grep -hE "Listen|VirtualHost" $conf_files_apache 2>/dev/null | \
            sed 's/#.*//' | grep -E "Listen|VirtualHost" | sed 's/[<>]//g' | awk '{print $NF}' | \
            awk -F':' '{print $NF}' | tr -d '"' | sort -u)
        for p in $apache_ports; do
            if [ "$p" = "$check_port" ]; then return 2; fi
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
        try_files \$uri \$uri/ /index.php\$is_args\$args;
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
  use_http=$(echo "$input" | grep "^use_http=" | cut -d= -f2- | tr -d '\r')
  use_https=$(echo "$input" | grep "^use_https=" | cut -d= -f2- | tr -d '\r')
  php_version=$(echo "$input" | grep "^php_version=" | cut -d= -f2- | tr -d '\r')
  requested_ws_type=$(echo "$input" | grep "^ws_type=" | cut -d= -f2- | tr -d '\r')

  # Fallback to the first available version if not specified
  if [ -z "$php_version" ]; then
      php_version=$(ls /etc/php/ 2>/dev/null | head -1)
      if [ -z "$php_version" ]; then
          echo '{"ok":false,"error":"未在系统中检测到已安装的 PHP 版本，请先通过 apt 安装 PHP-FPM"}'
          return 0
      fi
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

  # Define basic PHP block
  php_block="location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:$php_socket;
    }"
  php_block_ssl="location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:$php_socket;
        fastcgi_param HTTPS on;
    }"

  # --- Common Preparations ---
  ws_type=${requested_ws_type:-$(get_web_server_type)}
  
  if [ "$mode" = "domain" ]; then
      if [ -z "$domain" ]; then
          echo '{"ok":false,"error":"missing domain"}'
          return 0
      fi
      if echo "$domain" | grep -q "[^a-zA-Z0-9.-]"; then
          echo '{"ok":false,"error":"invalid domain"}'
          return 0
      fi
      
      target_port="${port:-80}"
      target_port_https="${port_https:-443}"
      
      if [ -n "$custom_name" ]; then
          site_name="$custom_name"
      else
          site_name="$domain"
      fi
  else
      # Port mode
      target_port="${port:-80}"
      target_port_https="${port_https:-443}"

      if [ -n "$custom_name" ]; then
          site_name="$custom_name"
      else
          site_name="port_${target_port}"
      fi
  fi

  # 1. Port Conflict Checks
  if [ "$use_http" = "true" ]; then
      check_port_conflict "$target_port"
      if [ $? -ne 0 ]; then
          echo "{\"ok\":false,\"error\":\"Port $target_port is already in use\"}"
          return 0
      fi
  fi
  if [ "$use_https" = "true" ]; then
      check_port_conflict "$target_port_https"
      if [ $? -ne 0 ]; then
          echo "{\"ok\":false,\"error\":\"HTTPS Port $target_port_https is already in use\"}"
          return 0
      fi
  fi

  if [ "$ws_type" = "apache" ]; then
      # --- Apache Implementation ---
      config_file="/etc/apache2/sites-available/$site_name.conf"
      if [ -f "$config_file" ]; then
          echo "{\"ok\":false,\"error\":\"site/config already exists: $site_name\"}"
          return 0
      fi

      # Ensure Apache listens on the required ports globally
      if [ "$use_http" = "true" ]; then
          if ! grep -qE "^\s*Listen\s+([0-9\.]+:)?$target_port\b" /etc/apache2/ports.conf 2>/dev/null; then
              echo "Listen $target_port" >> /etc/apache2/ports.conf
          fi
      fi
      if [ "$use_https" = "true" ]; then
          if ! grep -qE "^\s*Listen\s+([0-9\.]+:)?$target_port_https\b" /etc/apache2/ports.conf 2>/dev/null; then
              echo "Listen $target_port_https" >> /etc/apache2/ports.conf
          fi
      fi

      # Use custom urldecode for rewrite if it was encoded
      raw_rewrite=""
      if [ -n "$rewrite_encoded" ]; then
          raw_rewrite=$(urldecode "$rewrite_encoded")
      fi

      # Create .htaccess if rules provided
      if [ -n "$raw_rewrite" ]; then
          echo "$raw_rewrite" > "$root_dir/.htaccess"
          chown www-data:www-data "$root_dir/.htaccess" 2>/dev/null || true
          chmod 644 "$root_dir/.htaccess" 2>/dev/null || true
      fi

      # Generate Config
      > "$config_file"
      if [ "$use_http" = "true" ]; then
          ssl_cert=""
          ssl_key=""
          generate_apache_vhost "$domain" "$target_port" "$root_dir" "false" "$ssl_cert" "$ssl_key" "$php_socket" >> "$config_file"
      fi
      if [ "$use_https" = "true" ]; then
          ssl_cert="/etc/apache2/certs/${site_name}.pem"
          ssl_key="/etc/apache2/certs/${site_name}.key"
          create_certificate_placeholder "$ssl_cert" "$ssl_key" "$domain"
          generate_apache_vhost "$domain" "$target_port_https" "$root_dir" "true" "$ssl_cert" "$ssl_key" "$php_socket" >> "$config_file"
      fi

      ln -sf "$config_file" "/etc/apache2/sites-enabled/$site_name.conf"
      
      apache_test_output=$(apache2ctl configtest 2>&1)
      apache_test_status=$?

      if [ $apache_test_status -eq 0 ]; then
          reload_web_server "apache"
          echo '{"ok":true,"message":"site created (Apache)"}'
      else
          # Rollback
          rm -f "/etc/apache2/sites-enabled/$site_name.conf"
          rm -f "$config_file"
          error_msg=$(echo "$apache_test_output" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ' | sed 's/  */ /g')
          echo "{\"ok\":false,\"error\":\"Apache config check failed: $error_msg\"}"
      fi

  else
      # --- Nginx Implementation ---
      config_file="/etc/nginx/sites-available/$site_name"
      if [ -f "$config_file" ]; then
          echo "{\"ok\":false,\"error\":\"site/config already exists: $site_name\"}"
          return 0
      fi

      # 2. Config Generation
      > "$config_file"
      
      if [ "$mode" = "domain" ]; then
          if [ "$use_http" = "true" ] && [ "$use_https" = "true" ]; then
              # Redirection mode
              redirect_url="https://\$host"
              [ "$target_port_https" != "443" ] && redirect_url="https://\$host:$target_port_https"
              
              cat >> "$config_file" <<EOF
server {
    listen $target_port;
    listen [::]:$target_port;
    server_name $domain;
    return 301 $redirect_url\$request_uri;
}
EOF
          elif [ "$use_http" = "true" ]; then
              # HTTP Only mode
              cat >> "$config_file" <<EOF
server {
    listen $target_port;
    listen [::]:$target_port;
    server_name $domain;
    root $root_dir;
    index index.html index.htm index.php;
    client_max_body_size 8M;
    $rewrite_block
    $root_location_block
    $php_block
}
EOF
          fi

          if [ "$use_https" = "true" ]; then
              ssl_cert="/etc/nginx/certs/${domain}.pem"
              ssl_key="/etc/nginx/certs/${domain}.key"
              create_certificate_placeholder "$ssl_cert" "$ssl_key" "$domain"
              
              cat >> "$config_file" <<EOF
server {
    listen $target_port_https ssl;
    listen [::]:$target_port_https ssl;
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
    $php_block_ssl
}
EOF
          fi
      else
          # Port mode Nginx
          cat >> "$config_file" <<EOF
server {
    server_name _;
EOF
          if [ "$use_http" = "true" ]; then
              echo "    listen $target_port default_server;" >> "$config_file"
              echo "    listen [::]:$target_port default_server;" >> "$config_file"
          fi
          if [ "$use_https" = "true" ]; then
              ssl_cert="/etc/nginx/certs/${site_name}_ssl${target_port_https}.pem"
              ssl_key="/etc/nginx/certs/${site_name}_ssl${target_port_https}.key"
              create_certificate_placeholder "$ssl_cert" "$ssl_key" "localhost"
              
              echo "    listen $target_port_https ssl default_server;" >> "$config_file"
              echo "    listen [::]:$target_port_https ssl default_server;" >> "$config_file"
              cat >> "$config_file" <<EOF
    ssl_certificate $ssl_cert;
    ssl_certificate_key $ssl_key;
    ssl_session_timeout 5m;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
EOF
          fi

          cat >> "$config_file" <<EOF
    root $root_dir;
    index index.html index.htm index.php;
    client_max_body_size 8M;
    $rewrite_block
    $root_location_block
EOF
          if [ "$use_https" = "true" ]; then
              echo "    $php_block_ssl" >> "$config_file"
          else
              echo "    $php_block" >> "$config_file"
          fi
          echo "}" >> "$config_file"
      fi

      ln -sf "$config_file" "/etc/nginx/sites-enabled/$site_name"
      
      nginx_test_output=$(nginx -t 2>&1)
      nginx_test_status=$?
      
      if [ $nginx_test_status -eq 0 ]; then
          reload_web_server
          echo '{"ok":true,"message":"site created"}'
      else
          # Config check failed - Immediate Rollback
          rm -f "/etc/nginx/sites-enabled/$site_name"
          rm -f "$config_file"
          error_msg=$(echo "$nginx_test_output" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ' | sed 's/  */ /g')
          echo "{\"ok\":false,\"error\":\"Nginx check failed: $error_msg\"}"
      fi
  fi
}

list_sites_json() {
  local first=1
  echo '['

  # --- Apache Sites ---
  local conf_dir="/etc/apache2/sites-available"
  local enabled_dir="/etc/apache2/sites-enabled"
  local available_sites=$(ls $conf_dir/*.conf 2>/dev/null | xargs -n1 basename 2>/dev/null)
  
  if [ -n "$available_sites" ]; then
      for site in $available_sites; do
          local config_file="$conf_dir/$site"
          if [ ! -f "$config_file" ]; then continue; fi
          if [ "$site" = "000-default.conf" ] || [ "$site" = "default-ssl.conf" ]; then continue; fi
          
          local port=""
          local root_dir=""
          local server_name=""
          local php_ver="-"
          local is_ssl=false
          local mode="domain"
          
          port=$(grep "<VirtualHost" "$config_file" | sed 's/[<>]//g' | awk '{print $2}' | awk -F':' '{print $NF}' | sort -u | tr '\n' ',' | sed 's/,$//; s/,/, /g')
          root_dir=$(grep "DocumentRoot" "$config_file" | head -1 | awk '{print $2}' | tr -d ' "')
          server_name=$(grep "ServerName" "$config_file" | head -1 | awk '{print $2}' | tr -d ' "')
          php_ver=$(grep -oE "/run/php/php[0-9.]+-fpm\.sock" "$config_file" | head -1 | sed 's/.*php\(.*\)-fpm\.sock.*/\1/')
          
          # Detect mode
          if [ -n "$server_name" ] && [ "$server_name" != "localhost" ]; then
              mode="domain"
          else
              mode="port"
          fi
          
          if grep -iq "SSLEngine\s*on" "$config_file" || grep -q "VirtualHost\s*.*:443" "$config_file"; then
              is_ssl=true
          fi
          
          [ -z "$php_ver" ] && php_ver="-"
          
          local enabled=false
          if [ -L "$enabled_dir/$site" ]; then
            enabled=true
          fi
          
          if [ $first -eq 0 ]; then echo ','; fi
          first=0
          
          # Strip .conf for clean name in UI
          local display_name="${site%.conf}"
          local esc_site=$(echo "$display_name" | sed 's/\\/\\\\/g; s/"/\\"/g')
          local esc_port=$(echo "$port" | sed 's/\\/\\\\/g; s/"/\\"/g')
          local esc_root=$(echo "$root_dir" | sed 's/\\/\\\\/g; s/"/\\"/g')
          local esc_php=$(echo "$php_ver" | sed 's/\\/\\\\/g; s/"/\\"/g')
          
          echo "{\"name\":\"$esc_site\",\"port\":\"$esc_port\",\"root\":\"$esc_root\",\"php\":\"$esc_php\",\"enabled\":$enabled,\"mode\":\"$mode\",\"is_ssl\":$is_ssl,\"engine\":\"apache\"}"
      done
  fi

  # --- Nginx Sites ---
  conf_dir="/etc/nginx/sites-available"
  enabled_dir="/etc/nginx/sites-enabled"
  available_sites=$(ls $conf_dir/ 2>/dev/null)

  if [ -n "$available_sites" ]; then
      for site in $available_sites; do
          local config_file="$conf_dir/$site"
          if [ ! -f "$config_file" ] || [ "$site" = "default" ]; then continue; fi
          
          local port=""
          local root_dir=""
          local server_name=""
          local php_ver="-"
          local is_ssl=false
          local mode="domain"
          
          port=$(grep "listen" "$config_file" 2>/dev/null | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | sort -nu | tr '\n' ',' | sed 's/,$//; s/,/, /g')
          root_dir=$(grep "root" "$config_file" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')
          server_name=$(grep "server_name" "$config_file" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')
          php_ver=$(grep "fastcgi_pass unix:/run/php/php" "$config_file" | head -1 | sed 's/.*php\(.*\)-fpm\.sock.*/\1/')
          
          [ "$server_name" = "_" ] && mode="port"
          
          if grep -q "listen.*443.*ssl" "$config_file" || grep -q "ssl_certificate" "$config_file"; then
              is_ssl=true
          fi
          
          [ -z "$php_ver" ] && php_ver="-"
          
          local enabled=false
          if [ -L "$enabled_dir/$site" ]; then
            enabled=true
          fi
          
          if [ $first -eq 0 ]; then echo ','; fi
          first=0
          
          local esc_site=$(echo "$site" | sed 's/\\/\\\\/g; s/"/\\"/g')
          local esc_port=$(echo "$port" | sed 's/\\/\\\\/g; s/"/\\"/g')
          local esc_root=$(echo "$root_dir" | sed 's/\\/\\\\/g; s/"/\\"/g')
          local esc_php=$(echo "$php_ver" | sed 's/\\/\\\\/g; s/"/\\"/g')
          
          echo "{\"name\":\"$esc_site\",\"port\":\"$esc_port\",\"root\":\"$esc_root\",\"php\":\"$esc_php\",\"enabled\":$enabled,\"mode\":\"$mode\",\"is_ssl\":$is_ssl,\"engine\":\"nginx\"}"
      done
  fi

  echo ']'
}

nginx_status_json() {
  # Simplified check: Only report presence and active status
  local installed=false
  local version_raw=""
  local running=false
  
  if [ -x "/usr/sbin/nginx" ] && [ -f "/etc/nginx/nginx.conf" ]; then
    installed=true
    version_raw=$(/usr/sbin/nginx -v 2>&1 | sed 's/^[^:]*: //')
    
    if systemctl is-active --quiet nginx 2>/dev/null; then
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

apache_status_json() {
  local installed=false
  local version_raw=""
  local running=false
  
  if [ -x "/usr/sbin/apache2" ] && [ -d "/etc/apache2" ]; then
    installed=true
    version_raw=$(/usr/sbin/apache2 -v | head -1 | sed 's/Server version: //')
    if systemctl is-active --quiet apache2 2>/dev/null; then
        running=true
    fi
  fi
  
  local config_exists=false
  [ -d "/etc/apache2/sites-available" ] && config_exists=true

  local mod_rewrite=false
  local mod_ssl=false
  local mod_proxy_fcgi=false
  local mod_headers=false
  local default_site_enabled=false
  [ -L "/etc/apache2/mods-enabled/rewrite.load" ] && mod_rewrite=true
  [ -L "/etc/apache2/mods-enabled/ssl.load" ] && mod_ssl=true
  [ -L "/etc/apache2/mods-enabled/proxy_fcgi.load" ] && mod_proxy_fcgi=true
  [ -L "/etc/apache2/mods-enabled/headers.load" ] && mod_headers=true

  local default_site_enabled=false
  [ -L "/etc/apache2/sites-enabled/000-default.conf" ] && default_site_enabled=true

  local version_json="\"\""
  [ -n "$version_raw" ] && version_json="\"$(echo "$version_raw" | sed 's/\\/\\\\/g; s/"/\\"/g')\""
  
  echo "{\"installed\":$installed,\"running\":$running,\"version\":$version_json,\"config_exists\":$config_exists,\"modules\":{\"rewrite\":$mod_rewrite,\"ssl\":$mod_ssl,\"proxy_fcgi\":$mod_proxy_fcgi,\"headers\":$mod_headers},\"default_site_enabled\":$default_site_enabled}"
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
    local ws_type=$(get_web_server_type)
    local limit="20M"
    local first_conf=""
    if [ "$ws_type" = "apache" ]; then
        first_conf=$(ls /etc/apache2/sites-available/*.conf 2>/dev/null | head -1)
        if [ -n "$first_conf" ] && [ -f "$first_conf" ]; then
            # Extract LimitRequestBody if it exists (but use 20M as fallback for common UX)
            local found_limit=$(grep "LimitRequestBody" "$first_conf" | head -1 | awk '{print $2}' | tr -d ';')
            [ -n "$found_limit" ] && limit="$found_limit"
        fi
    else
        first_conf=$(ls /etc/nginx/sites-available/* 2>/dev/null | head -1)
        if [ -n "$first_conf" ] && [ -f "$first_conf" ]; then
            local found_limit=$(grep "client_max_body_size" "$first_conf" | head -1 | awk '{print $2}' | tr -d ';')
            [ -n "$found_limit" ] && limit="$found_limit"
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

  ws_type=$(detect_site_driver "$site_name")
  local old_config_file=""
  local enabled_link_parent=""
  if [ "$ws_type" = "apache" ]; then
      old_config_file="/etc/apache2/sites-available/$site_name"
      enabled_link_parent="/etc/apache2/sites-enabled"
  else
      old_config_file="/etc/nginx/sites-available/$site_name"
      enabled_link_parent="/etc/nginx/sites-enabled"
  fi

  if [ ! -f "$old_config_file" ]; then
      echo '{"ok":false,"error":"site configuration not found"}'
      return 0
  fi
  
  # 1. Get current ports
  local old_port=""
  local old_port_https=""
  if [ "$ws_type" = "apache" ]; then
      old_port=$(grep "VirtualHost" "$old_config_file" | grep -v "443" | head -1 | sed 's/[<>]//g' | awk '{print $2}' | awk -F':' '{print $NF}')
      old_port_https=$(grep "VirtualHost" "$old_config_file" | grep "443" | head -1 | sed 's/[<>]//g' | awk '{print $2}' | awk -F':' '{print $NF}')
  else
      old_port=$(grep "listen" "$old_config_file" | grep -v "ssl" | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | head -1)
      old_port_https=$(grep "listen" "$old_config_file" | grep "ssl" | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | head -1)
  fi

  # 2. Check conflicts (only if ports changed)
  if [ "$new_port" != "$old_port" ]; then
      check_port_conflict "$new_port"
      [ $? -ne 0 ] && { echo "{\"ok\":false,\"error\":\"Port $new_port is already in use\"}"; return 0; }
  fi
  if [ -n "$new_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
      check_port_conflict "$new_port_https"
      [ $? -ne 0 ] && { echo "{\"ok\":false,\"error\":\"HTTPS Port $new_port_https is already in use\"}"; return 0; }
  fi

  # 3. Determine New Site Name and Config File
  local new_site_name="$site_name"
  if [[ "$site_name" =~ ^port_[0-9]+(\.conf)?$ ]] && [ "$new_port" != "$old_port" ]; then
      if [ "$ws_type" = "apache" ]; then new_site_name="port_${new_port}.conf"; else new_site_name="port_${new_port}"; fi
  fi
  
  local new_config_file=""
  if [ "$ws_type" = "apache" ]; then new_config_file="/etc/apache2/sites-available/$new_site_name"; else new_config_file="/etc/nginx/sites-available/$new_site_name"; fi
  
  if [ "$new_config_file" != "$old_config_file" ] && [ -f "$new_config_file" ]; then
      echo "{\"ok\":false,\"error\":\"Target config file $new_site_name already exists\"}"
      return 0
  fi

  # 4. Create New Config (Copy Logic)
  local temp_cleanup_file=""
  local backup_file=""
  if [ "$new_config_file" != "$old_config_file" ]; then
      cp "$old_config_file" "$new_config_file"
      temp_cleanup_file="$new_config_file"
  else
      cp "$old_config_file" "${old_config_file}.bak"
      backup_file="${old_config_file}.bak"
  fi

  # 5. Modify New Config
  if [ "$ws_type" = "apache" ]; then
      if [ -n "$old_port" ] && [ "$new_port" != "$old_port" ]; then
          sed -i "s/VirtualHost \*:$old_port/VirtualHost \*:$new_port/g" "$new_config_file"
      fi
      if [ -n "$new_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
          sed -i "s/VirtualHost \*:$old_port_https/VirtualHost \*:$new_port_https/g" "$new_config_file"
      fi
  else
      if [ -n "$old_port" ] && [ "$new_port" != "$old_port" ]; then
          sed -i "s/listen $old_port/listen $new_port/g" "$new_config_file"
          sed -i "s/listen \[::\]:$old_port/listen [::]:$new_port/g" "$new_config_file"
      fi
      if [ -n "$new_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
          sed -i "s/listen $old_port_https/listen $new_port_https/g" "$new_config_file"
          sed -i "s/listen \[::\]:$old_port_https/listen [::]:$new_port_https/g" "$new_config_file"
      fi
  fi
  
  # Update Site Name in Config & Certs (Enhanced for SSL placeholders)
  if [ -n "$new_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
      local ssl_cert=""
      local ssl_key=""
      if [ "$ws_type" = "apache" ]; then
          ssl_cert="/etc/apache2/certs/${new_site_name}_ssl${new_port_https}.pem"
          ssl_key="/etc/apache2/certs/${new_site_name}_ssl${new_port_https}.key"
      else
          ssl_cert="/etc/nginx/certs/${new_site_name}_ssl${new_port_https}.pem"
          ssl_key="/etc/nginx/certs/${new_site_name}_ssl${new_port_https}.key"
      fi
      
      if [ ! -f "$ssl_cert" ]; then
          mkdir -p "$(dirname "$ssl_cert")"
          create_certificate_placeholder "$ssl_cert" "$ssl_key" "localhost"
      fi
  fi

  # 6. Switch Links & Test
  rm -f "$enabled_link_parent/$site_name"
  ln -sf "$new_config_file" "$enabled_link_parent/$new_site_name"
  
  local check_ok=false
  if [ "$ws_type" = "apache" ]; then
      apache2ctl configtest >/dev/null 2>&1 && check_ok=true
  else
      nginx -t >/dev/null 2>&1 && check_ok=true
  fi

  if [ "$check_ok" = "true" ]; then
      reload_web_server "$ws_type"
      [ -n "$temp_cleanup_file" ] && rm -f "$old_config_file"
      [ -n "$backup_file" ] && rm -f "$backup_file"
      echo '{"ok":true,"message":"site updated"}'
  else
      # Rollback
      rm -f "$enabled_link_parent/$new_site_name"
      ln -sf "$old_config_file" "$enabled_link_parent/$site_name"
      if [ -n "$backup_file" ]; then mv "$backup_file" "$old_config_file"; fi
      [ -n "$temp_cleanup_file" ] && rm -f "$temp_cleanup_file"
      echo "{\"ok\":false,\"error\":\"Config check failed. Reverted to old config.\"}"
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
  
  ws_type=$(detect_site_driver "$site_name")
  local conf_file=""
  local enabled_link=""
  
  if [ "$ws_type" = "apache" ]; then
      conf_file="/etc/apache2/sites-available/$site_name.conf"
      enabled_link="/etc/apache2/sites-enabled/$site_name.conf"
  else
      conf_file="/etc/nginx/sites-available/$site_name"
      enabled_link="/etc/nginx/sites-enabled/$site_name"
  fi

  if [ ! -f "$conf_file" ]; then
    echo '{"ok":false,"error":"site not found"}'
    return 1
  fi

  # Extract root dir safely (supports spaces and quotes)
  if [ "$ws_type" = "apache" ]; then
      root_dir=$(grep -i "DocumentRoot" "$conf_file" | head -1 | sed -E 's/^\s*DocumentRoot\s+"?([^"]+)"?.*$/\1/')
  else
      root_dir=$(grep -i "^\s*root\s" "$conf_file" | head -1 | sed -E 's/^\s*root\s+([^;]+);.*$/\1/')
  fi
  
  rm -f "$enabled_link"
  rm -f "$conf_file"
  
  # Cleanup SSL certificates if they match the site name convention
  if [ "$ws_type" = "apache" ]; then
      rm -f /etc/apache2/certs/"${site_name}"_ssl*.pem 2>/dev/null
      rm -f /etc/apache2/certs/"${site_name}"_ssl*.key 2>/dev/null
  else
      rm -f /etc/nginx/certs/"${site_name}"_ssl*.pem 2>/dev/null
      rm -f /etc/nginx/certs/"${site_name}"_ssl*.key 2>/dev/null
  fi
  
  if [ -n "$root_dir" ] && [ -d "$root_dir" ]; then
      rm -f "$root_dir/website_info.txt"
      rm -f "$root_dir/phpinfo.php"
  fi
  
  reload_web_server "$ws_type"
  echo '{"ok":true,"message":"site deleted"}'
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
  
  # Apply to Apache if installed
  if [ -x "/usr/sbin/apache2" ]; then
      local bytes_size=$(echo "$new_size" | tr -d 'mMgGkK')
      local unit=$(echo "$new_size" | grep -o "[mMgGkK]")
      case "$unit" in
          [kK]|"") bytes_size=$((bytes_size * 1024)) ;;
          [mM]) bytes_size=$((bytes_size * 1024 * 1024)) ;;
          [gG]) bytes_size=$((bytes_size * 1024 * 1024 * 1024)) ;;
      esac
      limit_conf="/etc/apache2/conf-available/webserver-limits.conf"
      mkdir -p "$(dirname "$limit_conf")"
      echo "LimitRequestBody $bytes_size" > "$limit_conf"
      [ -f "/usr/sbin/a2enconf" ] && a2enconf webserver-limits >/dev/null 2>&1
      reload_web_server "apache"
  fi

  # Apply to Nginx if installed
  if [ -x "/usr/sbin/nginx" ]; then
      nginx_configs=$(find /etc/nginx/sites-available -type f ! -name "*.backup.*" 2>/dev/null)
      for config in $nginx_configs; do
          if grep -q "client_max_body_size" "$config"; then
              sed -i "s/client_max_body_size\s*[0-9KMGkmg]*;/client_max_body_size ${new_size};/g" "$config"
          fi
      done
      main_nginx_conf="/etc/nginx/nginx.conf"
      if [ -f "$main_nginx_conf" ] && grep -q "client_max_body_size" "$main_nginx_conf"; then
          sed -i "s/client_max_body_size\s*[0-9KMGkmg]*;/client_max_body_size ${new_size};/g" "$main_nginx_conf"
      fi
      reload_web_server "nginx"
  fi

  echo "{\"ok\":true,\"message\":\"Upload limit applied to all active web servers\"}"
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
  
  ws_type=$(detect_site_driver "$site_name")
  local available_config=""
  local enabled_link=""
  
  if [ "$ws_type" = "apache" ]; then
      available_config="/etc/apache2/sites-available/$site_name.conf"
      enabled_link="/etc/apache2/sites-enabled/$site_name.conf"
  else
      available_config="/etc/nginx/sites-available/$site_name"
      enabled_link="/etc/nginx/sites-enabled/$site_name"
  fi
  
  if [ ! -f "$available_config" ]; then
    echo '{"ok":false,"error":"site config not found"}'
    return 1
  fi
  
  if [ -L "$enabled_link" ]; then
     echo '{"ok":true,"message":"site already enabled"}'
     return 0
  fi
  
  ln -s "$available_config" "$enabled_link"
  
  local check_ok=false
  if [ "$ws_type" = "apache" ]; then
      apache2ctl configtest >/dev/null 2>&1 && check_ok=true
  else
      nginx -t >/dev/null 2>&1 && check_ok=true
  fi

  if [ "$check_ok" = "true" ]; then
      reload_web_server "$ws_type"
      echo '{"ok":true,"message":"site enabled"}'
  else
      rm -f "$enabled_link"
      echo '{"ok":false,"error":"Config check failed, site remains disabled"}'
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
  
  ws_type=$(detect_site_driver "$site_name")
  local enabled_link=""
  
  if [ "$ws_type" = "apache" ]; then
      enabled_link="/etc/apache2/sites-enabled/$site_name.conf"
  else
      enabled_link="/etc/nginx/sites-enabled/$site_name"
  fi
  
  if [ ! -L "$enabled_link" ] && [ ! -f "$enabled_link" ]; then
     echo '{"ok":true,"message":"site already disabled"}'
     return 0
  fi
  
  rm -f "$enabled_link"
  reload_web_server "$ws_type"
  echo '{"ok":true,"message":"site disabled"}'
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
  
  ws_type=$(detect_site_driver "$site_name")
  local config_file=""
  if [ "$ws_type" = "apache" ]; then
      config_file="/etc/apache2/sites-available/$site_name.conf"
  else
      config_file="/etc/nginx/sites-available/$site_name"
  fi

  if [ ! -f "$config_file" ]; then
    echo '{"ok":false,"error":"site config not found"}'
    return 1
  fi
  
  local root_dir=""
  if [ "$ws_type" = "apache" ]; then
      root_dir=$(grep -i "DocumentRoot" "$config_file" | head -1 | sed -E 's/^\s*DocumentRoot\s+"?([^"]+)"?.*$/\1/')
  else
      root_dir=$(grep -i "^\s*root\s" "$config_file" | head -1 | sed -E 's/^\s*root\s+([^;]+);.*$/\1/')
  fi
  
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
  web_server_restart_json
}

web_server_restart_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  req_type=$(echo "$input" | grep "^type=" | cut -d= -f2- | tr -d '\r')
  
  local ws_type="${req_type:-$(get_web_server_type)}"
  local service_name="nginx"
  [ "$ws_type" = "apache" ] && service_name="apache2"
  
  if systemctl restart $service_name >/dev/null 2>&1; then
    echo "{\"ok\":true,\"message\":\"$service_name restarted successfully\"}"
  else
    echo "{\"ok\":false,\"error\":\"Failed to restart $service_name\"}"
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
  web-server-restart)
    web_server_restart_json
    ;;
  nginx-status)
    nginx_status_json
    ;;
  apache-status)
    apache_status_json
    ;;
  php-status)
    php_status_json
    ;;
  check-db-status)
    check_db_status_json
    ;;
  install-db)
    install_db_json
    ;;
  get-install-log)
    get_install_log_json
    ;;
  get-web-server-settings)
    get_web_server_settings_json
    ;;
  set-web-server-type)
    set_web_server_type_json
    ;;
  *)
    echo '{"error":"unsupported action"}'
    exit 1
    ;;
esac
