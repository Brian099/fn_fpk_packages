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
            
            # Indent
            if ($0 == "") print "";
            else if ($0 ~ /^location/ || $0 ~ /^}$/) print "    " $0;
            else print "        " $0;
        }' | sed 's/\\/\\\\/g; s/\$/\\\$/g; s/`/\\`/g')
    fi
  fi
  domain=$(echo "$input" | grep "^domain=" | cut -d= -f2- | tr -d '\r')
  custom_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  if [ -n "$custom_name" ]; then
      if command -v php >/dev/null 2>&1; then
        custom_name=$(php -r "echo rawurldecode(\$argv[1]);" -- "$custom_name")
      fi
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
    
    location / {
        try_files \$uri \$uri/ =404;
    }
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
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
    
    location / {
        try_files \$uri \$uri/ =404;
    }
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
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
    
    location / {
        try_files \$uri \$uri/ =404;
    }
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
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
    
    location / {
        try_files \$uri \$uri/ =404;
    }
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
    }
}
EOF
      fi
  fi

  ln -sf "$config_file" "/etc/nginx/sites-enabled/$site_name"
  
  if nginx -t > /dev/null 2>&1; then
      reload_nginx_safe
      echo '{"ok":true,"message":"site created"}'
  else
      rm -f "/etc/nginx/sites-enabled/$site_name"
      rm -f "$config_file"
      echo '{"ok":false,"error":"Nginx configuration test failed. Rolled back."}'
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
    echo "{\"name\":\"$esc_site\",\"port\":\"$esc_port\",\"root\":\"$esc_root\",\"enabled\":$enabled,\"mode\":\"$mode\"}"
  done
  echo ']'
}

nginx_status_json() {
  if command -v nginx >/dev/null 2>&1; then
    installed=true
    version_raw=$(nginx -v 2>&1 | sed 's/^[^:]*: //')
  else
    installed=false
    version_raw=""
  fi
  if [ -f "/etc/nginx/nginx.conf" ]; then
    config_exists=true
  else
    config_exists=false
  fi
  if [ -n "$version_raw" ]; then
    esc_version=$(echo "$version_raw" | sed 's/\\/\\\\/g; s/"/\\"/g')
    version_json="\"$esc_version\""
  else
    version_json="\"\""
  fi
  echo "{\"installed\":$installed,\"version\":$version_json,\"config_exists\":$config_exists}"
}

php_status_json() {
  if command -v php >/dev/null 2>&1; then
    installed=true
    version_raw=$(php -v 2>&1 | head -n1 | sed 's/^[^ ]\+ //')
  else
    installed=false
    version_raw=""
  fi
  fpm_running=false
  for svc in php-fpm php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php7.4-fpm; do
    if systemctl is-active --quiet "$svc"; then
      fpm_running=true
      break
    fi
  done
  if [ -n "$version_raw" ]; then
    esc_version=$(echo "$version_raw" | sed 's/\\/\\\\/g; s/"/\\"/g')
    version_json="\"$esc_version\""
  else
    version_json="\"\""
  fi
  echo "{\"installed\":$installed,\"version\":$version_json,\"fpm_running\":$fpm_running}"
}

nginx_install_json() {
  if command -v nginx >/dev/null 2>&1; then
    printf '{"ok":true,"message":"nginx already installed"}'
    return 0
  fi
  export DEBIAN_FRONTEND=noninteractive
  if ! apt-get update -y >/tmp/webops_nginx_install.log 2>&1; then
    printf '{"ok":false,"step":"apt-update"}'
    return 1
  fi
  # Attempt install, allow failure (e.g. port 80 conflict)
  install_status=0
  apt-get install -y nginx >>/tmp/webops_nginx_install.log 2>&1 || install_status=$?

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
      if ! apt-get install -y -f >>/tmp/webops_nginx_install.log 2>&1; then
          printf '{"ok":false,"step":"apt-install-fix"}'
          return 1
      fi
  fi

  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl restart nginx >/dev/null 2>&1 || true
  printf '{"ok":true,"message":"nginx installed"}'
}

php_install_json() {
  if command -v php >/dev/null 2>&1; then
    already_php=true
  else
    already_php=false
  fi
  export DEBIAN_FRONTEND=noninteractive
  if ! apt-get update -y >/tmp/webops_php_install.log 2>&1; then
    printf '{"ok":false,"step":"apt-update"}'
    return 1
  fi
  extensions=(
    php8.2-common
    php8.2-mysql
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
    php8.2-cgi
    php8.2-fpm
  )
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
    if [ -n "$input" ]; then
      extensions=()
      while IFS= read -r line; do
        pkg=$(printf '%s' "$line" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        [ -z "$pkg" ] && continue
        case "$pkg" in
          *[!A-Za-z0-9.+:-]*)
            continue
            ;;
          *)
            extensions+=("$pkg")
            ;;
        esac
      done <<EOF
$input
EOF
    fi
  fi
  for extension in "${extensions[@]}"; do
    if ! dpkg -l 2>/dev/null | grep -q "$extension"; then
      apt-get install -y "$extension" >>/tmp/webops_php_install.log 2>&1 || true
    fi
  done
  systemctl enable --now php8.2-fpm >/dev/null 2>&1 || systemctl enable --now php-fpm >/dev/null 2>&1 || true
  if "$already_php"; then
    printf '{"ok":true,"message":"php packages updated or ensured"}'
  else
    printf '{"ok":true,"message":"php and extensions installed"}'
  fi
}

php_extensions_status_json() {
  extensions=(
    php8.2-common
    php8.2-mysql
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
    php8.2-cgi
    php8.2-fpm
  )
  first=1
  echo '['
  for extension in "${extensions[@]}"; do
    if dpkg -s "$extension" >/dev/null 2>&1; then
      installed=true
    else
      installed=false
    fi
    if [ $first -eq 0 ]; then
      echo ','
    fi
    first=0
    esc=$(echo "$extension" | sed 's/\\/\\\\/g; s/"/\\"/g')
    echo "{\"name\":\"$esc\",\"installed\":$installed}"
  done
  echo ']'
}

php_remove_json() {
  if [ -z "$CONTENT_LENGTH" ] || [ "$CONTENT_LENGTH" -le 0 ] 2>/dev/null; then
    printf '{"ok":false,"error":"no packages"}'
    return 1
  fi
  input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  if [ -z "$input" ]; then
    printf '{"ok":false,"error":"no packages"}'
    return 1
  fi
  pkgs=()
  while IFS= read -r line; do
    pkg=$(printf '%s' "$line" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$pkg" ] && continue
    case "$pkg" in
      *[!A-Za-z0-9.+:-]*)
        continue
        ;;
      *)
        pkgs+=("$pkg")
        ;;
    esac
  done <<EOF
$input
EOF
  if [ "${#pkgs[@]}" -eq 0 ]; then
    printf '{"ok":false,"error":"no valid packages"}'
    return 1
  fi
  for pkg in "${pkgs[@]}"; do
    apt-get remove -y "$pkg" >>/tmp/webops_php_install.log 2>&1 || true
  done
  printf '{"ok":true,"message":"php extensions removed"}'
}

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
    CUSTOM_CONF="/etc/php/8.2/fpm/conf.d/99-custom-upload.ini"
    if [ -f "$CUSTOM_CONF" ]; then
        UPLOAD_MAX=$(grep -E '^upload_max_filesize' "$CUSTOM_CONF" | awk -F '=' '{print $2}' | tr -d ' ')
    else
        if command -v php >/dev/null 2>&1; then
            UPLOAD_MAX=$(php -r 'echo ini_get("upload_max_filesize");')
        else
            UPLOAD_MAX="unknown"
        fi
    fi
  echo "{\"ok\":true,\"limit\":\"$UPLOAD_MAX\"}"
}

update_site_port_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
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

  config_file="/etc/nginx/sites-available/$site_name"
  if [ ! -f "$config_file" ]; then
      echo '{"ok":false,"error":"site configuration not found"}'
      return 0
  fi
  
  # 1. Get current ports
  old_port=$(grep "listen" "$config_file" | grep -v "ssl" | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | head -1)
  old_port_https=$(grep "listen" "$config_file" | grep "ssl" | grep -v "\[::\]" | awk '{print $2}' | tr -d ';' | head -1)

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

  # 3. Update Configuration
  # Update HTTP Port
  if [ -n "$old_port" ] && [ "$new_port" != "$old_port" ]; then
      sed -i "s/listen $old_port/listen $new_port/g" "$config_file"
      sed -i "s/listen \[::\]:$old_port/listen [::]:$new_port/g" "$config_file"
  fi
  
  # Update HTTPS Port
  if [ -n "$new_port_https" ]; then
       if [ -n "$old_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
          sed -i "s/listen $old_port_https/listen $new_port_https/g" "$config_file"
          sed -i "s/listen \[::\]:$old_port_https/listen [::]:$new_port_https/g" "$config_file"
          
          # Update Cert Reference if it follows the pattern
          # Pattern: _sslPORT.pem
          if grep -q "_ssl${old_port_https}" "$config_file"; then
              sed -i "s/_ssl${old_port_https}/_ssl${new_port_https}/g" "$config_file"
              
              # Generate new cert placeholder
              # We need to guess the cert path. 
              # In create_site_json: ssl_cert="/etc/nginx/certs/${site_name}_ssl${port_https}.pem"
              # NOTE: site_name might change later if we rename, but currently it is $site_name.
              # If we rename site later, we should probably generate cert with NEW name?
              # But let's stick to current name for cert generation for now, or handle it after rename?
              # If we rename site, the cert filename in config must also be updated.
              # Let's do cert generation AFTER rename if possible, or here.
              # Actually, if we rename the site, the config file content will still refer to OLD name in cert path unless we update it.
          fi
       fi
  fi
  
  # 4. Handle Site Renaming (if port-based)
  final_site_name="$site_name"
  if [[ "$site_name" =~ ^port_[0-9]+$ ]] && [ "$new_port" != "$old_port" ]; then
      new_site_name="port_${new_port}"
      if [ ! -f "/etc/nginx/sites-available/$new_site_name" ]; then
          mv "$config_file" "/etc/nginx/sites-available/$new_site_name"
          rm -f "/etc/nginx/sites-enabled/$site_name"
          ln -sf "/etc/nginx/sites-available/$new_site_name" "/etc/nginx/sites-enabled/$new_site_name"
          config_file="/etc/nginx/sites-available/$new_site_name"
          final_site_name="$new_site_name"
          
          # Update website_info.txt
          root_dir=$(grep "root" "$config_file" | head -1 | awk '{print $2}' | tr -d ';')
          if [ -f "$root_dir/website_info.txt" ]; then
             sed -i "s/网站名称: $site_name/网站名称: $new_site_name/" "$root_dir/website_info.txt"
          fi
          
          # If we renamed the site, we might want to update cert paths in config if they used the site name
          # create_site_json used: ${site_name}_ssl${port_https}
          # So old config has: port_8080_ssl8443
          # New config should have: port_8081_ssl8443
          if [ -n "$new_port_https" ]; then
             # Replace old site name in cert paths
             sed -i "s/${site_name}_ssl/${new_site_name}_ssl/g" "$config_file"
             
             # Now generate the new cert
             ssl_cert="/etc/nginx/certs/${new_site_name}_ssl${new_port_https}.pem"
             ssl_key="/etc/nginx/certs/${new_site_name}_ssl${new_port_https}.key"
             create_certificate_placeholder "$ssl_cert" "$ssl_key" "localhost"
          fi
      fi
  elif [ -n "$new_port_https" ] && [ "$new_port_https" != "$old_port_https" ]; then
      # If not renaming site, but changed HTTPS port, and using patterned certs
      # We already updated config to point to _sslNEWPORT
      # We need to generate that cert.
      # Check if config uses site_name based certs
      if grep -q "${site_name}_ssl${new_port_https}" "$config_file"; then
           ssl_cert="/etc/nginx/certs/${site_name}_ssl${new_port_https}.pem"
           ssl_key="/etc/nginx/certs/${site_name}_ssl${new_port_https}.key"
           create_certificate_placeholder "$ssl_cert" "$ssl_key" "localhost"
      fi
  fi
  
  # 5. Reload
  if nginx -t > /dev/null 2>&1; then
      reload_nginx_safe
      echo '{"ok":true,"message":"site updated"}'
  else
      # Simple Rollback Attempt (Revert rename if happened)
      # Not implementing full rollback for simplicity, just error.
      echo '{"ok":false,"error":"Nginx configuration test failed. Please check logs."}'
      return 0
  fi
}

delete_site_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  
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
    " > /tmp/new_upload_bytes 2>/dev/null

    if [ ! -f /tmp/new_upload_bytes ]; then
       MEM_LIMIT="$new_size"
    else
       UPLOAD_BYTES=$(cat /tmp/new_upload_bytes)
       MEM_LIMIT_BYTES=$((UPLOAD_BYTES))
       MEM_LIMIT_MB=$(( (MEM_LIMIT_BYTES + 1024*1024 - 1)/(1024*1024) ))
       MEM_LIMIT="${MEM_LIMIT_MB}M"
    fi

    CUSTOM_CONF="/etc/php/8.2/fpm/conf.d/99-custom-upload.ini"
    mkdir -p $(dirname "$CUSTOM_CONF")
    
    cat > "$CUSTOM_CONF" <<EOF
; Custom upload config - generated by webops
file_uploads = On
upload_max_filesize = $new_size
post_max_size = $new_size
max_execution_time = 300
max_input_time = 300
memory_limit = $MEM_LIMIT
max_file_uploads = 20
EOF

    nginx_configs=$(find /etc/nginx/sites-available -type f ! -name "*.backup.*" 2>/dev/null)
    for config in $nginx_configs; do
        if grep -q "client_max_body_size" "$config"; then
            sed -i "s/client_max_body_size\s*[0-9KMGkmg]*;/client_max_body_size ${new_size};/g" "$config"
        else
            if grep -q "root.*;" "$config"; then
                sed -i "0,/root.*;/s/root.*;/&\n    client_max_body_size ${new_size};/" "$config"
            else
                sed -i "/server {/a\    client_max_body_size ${new_size};" "$config"
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
    
    systemctl restart php8.2-fpm >/dev/null 2>&1 || true
    reload_nginx_safe >/dev/null 2>&1 || true
    
    printf '{"ok":true,"message":"updated"}'
}

enable_site_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  site_name=$(echo "$input" | grep "^name=" | cut -d= -f2- | tr -d '\r')
  
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

nginx_restart_json() {
  if systemctl restart nginx >/dev/null 2>&1; then
    echo '{"ok":true,"message":"Nginx restarted successfully"}'
  else
    echo '{"ok":false,"error":"Failed to restart Nginx"}'
  fi
}

check_db_status_json() {
  status="not_installed"
  type="none"
  details="数据库未安装"

  # 1. Check systemd services
  if systemctl is-active mariadb --quiet 2>/dev/null || systemctl is-active mysql --quiet 2>/dev/null; then
      status="running"
      type="system"
      details="数据库服务已安装且正在运行"
  elif dpkg -l | grep -q "mariadb-server\|mysql-server"; then
      status="installed"
      type="system"
      details="数据库已安装但服务未运行"
  else
      # 2. Check Docker containers
      if command -v docker >/dev/null 2>&1; then
          # Check for running containers with "mysql" in name
          if docker ps --format '{{.Names}}' | grep -q "mysql"; then
              status="running"
              type="docker"
              details="Docker版数据库正在运行"
          # Check for stopped containers with "mysql" in name
          elif docker ps -a --format '{{.Names}}' | grep -q "mysql"; then
              status="installed"
              type="docker"
              details="Docker版数据库已安装但未运行"
          fi
      fi
  fi

  printf '{"ok":true,"status":"%s","type":"%s","details":"%s"}' "$status" "$type" "$details"
}

install_db_json() {
  if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    input=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null || cat)
  fi
  password=$(echo "$input" | grep "^password=" | cut -d= -f2- | tr -d '\r')

  if [ -z "$password" ]; then
    echo '{"ok":false,"error":"Missing password"}'
    return 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
      echo '{"ok":false,"error":"Docker 未安装，无法部署数据库"}'
      return 1
  fi

  DB_DIR="/opt/webops/db"
  mkdir -p "$DB_DIR"/{data,logs,config}

  # If docker-compose.yml exists, check if we should overwrite or if it's already running
  if [ -f "$DB_DIR/docker-compose.yml" ]; then
      # Try to start it if it exists
      cd "$DB_DIR"
      if docker compose up -d >/dev/null 2>&1; then
           echo '{"ok":true,"message":"Existing database stack started"}'
           return 0
      fi
      # If start failed, we might want to overwrite, but for safety let's just proceed to overwrite 
      # only if the user specifically requested install (which they did by calling this).
      # But actually, let's just overwrite config with new password as requested.
  fi

  cat > "$DB_DIR/docker-compose.yml" <<EOF
services:
  mysql:
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
    image: phpmyadmin/phpmyadmin:latest
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
  
  if docker compose -p fn-mysql up -d >/dev/null 2>&1; then
      echo '{"ok":true,"message":"Docker版数据库安装成功"}'
  else
      echo '{"ok":false,"error":"Docker compose 启动失败"}'
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
  *)
    echo '{"error":"unsupported action"}'
    exit 1
    ;;
esac
