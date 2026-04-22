#!/bin/bash

# MariaDB 12 极简美学状态面板 (V2 Pro版)
# 作者: Antigravity

# 获取基础信息
APP_NAME="${TRIM_APPNAME:-MariaDB12}"
APP_ROOT="${TRIM_APPDEST:-/usr/local/apps/@appcenter/$APP_NAME}"

# 飞牛原生应用的真实数据目录映射 (根据 ps 输出修正)
PKG_VAR="${TRIM_PKGVAR:-/usr/local/apps/@appdata/$APP_NAME}"

CMD_MAIN="$APP_ROOT/cmd/main"
PORT="${TRIM_SERVICE_PORT:-3306}"
DATA_DIR="$PKG_VAR/data"

# 架构检测与二进制路径适配
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
    ARCH_TARGET="aarch64"
else
    ARCH_TARGET="x86_64"
fi
BIN_DIR="$APP_ROOT/target/$ARCH_TARGET/usr/bin"

# 1. 状态检测 (增加双重保险)
STATUS_EXIT=1
PID_FILE="$PKG_VAR/mariadb.pid"

if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    STATUS_EXIT=0
elif pgrep -f "mariadbd.*$APP_NAME" > /dev/null; then
    STATUS_EXIT=0
fi

# 2. 统计信息
DB_SIZE="未知"
if [ -d "$DATA_DIR" ]; then
    DB_SIZE=$(du -sh "$DATA_DIR" | awk '{print $1}')
fi

# 3. 运行时间
UPTIME="已停止"
if [ $STATUS_EXIT -eq 0 ]; then
    PID_FILE="$PKG_VAR/mariadb.pid"
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        # 兼容性获取运行时间
        UPTIME=$(ps -p "$PID" -o etime= 2>/dev/null | sed 's/^ *//')
        [ -z "$UPTIME" ] && UPTIME="在线"
    fi
fi

# 4. 样式配置
if [ $STATUS_EXIT -eq 0 ]; then
    STATE_LABEL="在线"
    COLOR_GRADIENT="linear-gradient(135deg, #0cebeb, #20e3b2, #29ffc6)"
    ICON_COLOR="#48e08f"
    STATUS_ICON="●"
else
    STATE_LABEL="离线"
    COLOR_GRADIENT="linear-gradient(135deg, #f85032, #e73827)"
    ICON_COLOR="#ff4d4d"
    STATUS_ICON="○"
fi

# 5. 处理备份请求 (V2: 分库归档管理)
if [[ "$QUERY_STRING" == *"action=backup"* ]]; then
    if [ $STATUS_EXIT -ne 0 ]; then
        echo "Status: 500 Service Offline"
        echo "Content-Type: text/plain; charset=utf-8"
        echo ""
        echo "错误：数据库服务未运行，无法备份。"
        exit 0
    fi

    # 1. 动态获取数据库清单 (V3: 使用专用凭据文件进行授权)
    BACKUP_CNF="$PKG_VAR/.backup.cnf"
    
    if [ ! -f "$BACKUP_CNF" ]; then
        echo "Status: 403 Forbidden"
        echo "Content-Type: text/plain; charset=utf-8"
        echo ""
        echo "备份失败：未探测到本地授权文件。请先前往飞牛“应用设置”->“配置”->点击“保存”以生成必要的备份凭据。"
        exit 0
    fi

    DB_LIST=$("$BIN_DIR/mariadb" --defaults-extra-file="$BACKUP_CNF" -N -e "SHOW DATABASES" 2>/dev/null | grep -Ev "information_schema|performance_schema|mysql|sys")
    
    if [ -z "$DB_LIST" ]; then
        echo "Status: 403 Forbidden"
        echo "Content-Type: text/plain; charset=utf-8"
        echo ""
        echo "备份失败：凭据无效或无法连接数据库。请尝试重新保存应用配置。"
        exit 0
    fi

    BACKUP_NAME="MariaDB_Backup_$(date +%Y%m%d_%H%M%S).tar.gz"
    TEMP_DIR="$TRIM_PKGTMP/bk_$(date +%s)"
    mkdir -p "$TEMP_DIR"
    
    # 2. 逐库导出为独立 SQL 文件
    for db in $DB_LIST; do
        "$BIN_DIR/mariadb-dump" \
            --defaults-extra-file="$BACKUP_CNF" \
            --single-transaction \
            --routines \
            --triggers \
            --events "$db" > "$TEMP_DIR/$db.sql" 2>/dev/null
    done
    
    # 3. 使用 Tar 打包归档并流式输出给浏览器
    echo "Content-Type: application/gzip"
    echo "Content-Disposition: attachment; filename=\"$BACKUP_NAME\""
    echo ""
    
    tar -czf - -C "$TEMP_DIR" .
    
    # 4. 后置清理：删除临时目录下的中间文件
    rm -rf "$TEMP_DIR"
    exit 0
fi

# 6. 输出响应头
echo "Content-Type: text/html; charset=utf-8"
echo "X-Frame-Options: SAMEORIGIN"
echo ""

cat <<EOF
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MariaDB 12 控制中心</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.7);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent: $ICON_COLOR;
        }
        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg-color);
            background-image: radial-gradient(circle at 50% 50%, #1e293b 0%, #0f172a 100%);
            color: var(--text-primary);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
        }
        .glass-panel {
            width: 80%;
            padding: 40px 20px;
            box-sizing: border-box;
            text-align: center;
            position: relative;
        }
        .status-header {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-bottom: 30px;
        }
        .status-dot {
            color: var(--accent);
            font-size: 14px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
            100% { opacity: 1; transform: scale(1); }
        }
        .status-text {
            text-transform: uppercase;
            letter-spacing: 2px;
            font-weight: 600;
            font-size: 14px;
            color: var(--accent);
        }
        h1 { margin: 0 0 10px 0; font-weight: 600; font-size: 28px; }
        .subtitle { color: var(--text-secondary); margin-bottom: 40px; font-size: 14px; }
        
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: rgba(255, 255, 255, 0.03);
            border-radius: 16px;
            padding: 15px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .stat-val { display: block; font-size: 18px; font-weight: 600; margin-bottom: 4px; font-family: 'Courier New', monospace; }
        .stat-lbl { display: block; font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; }

        .action-button {
            background: $COLOR_GRADIENT;
            border: none;
            border-radius: 12px;
            padding: 12px 24px;
            color: white;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: all 0.3s ease;
            text-decoration: none;
            display: block;
        }
        .action-button:hover {
            filter: brightness(1.1);
            transform: scale(1.02);
        }
        .action-button:disabled {
            background: #475569;
            cursor: not-allowed;
            transform: none;
            opacity: 0.6;
        }
        .action-button.loading {
            position: relative;
            color: transparent;
        }
        .action-button.loading::after {
            content: "";
            position: absolute;
            width: 16px;
            height: 16px;
            top: 50%;
            left: 50%;
            margin: -8px 0 0 -8px;
            border: 2px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Connection info removed */
        
        .decor {
            position: absolute;
            top: -50px;
            right: -50px;
            width: 150px;
            height: 150px;
            background: var(--accent);
            filter: blur(100px);
            opacity: 0.15;
            z-index: -1;
        }
    </style>
</head>
<body>
    <div class="glass-panel">
        <div class="decor"></div>
        <div class="status-header">
            <span class="status-dot">$STATUS_ICON</span>
            <span class="status-text">$STATE_LABEL</span>
        </div>
        
        <h1>MariaDB 12</h1>
        <p class="subtitle">高性能关系型数据库服务 (LTS)</p>

        <div class="stats-grid">
            <div class="stat-card">
                <span class="stat-val">$PORT</span>
                <span class="stat-lbl">内部端口</span>
            </div>
            <div class="stat-card">
                <span class="stat-val">$DB_SIZE</span>
                <span class="stat-lbl">数据占用</span>
            </div>
            <div class="stat-card">
                <span class="stat-val">$UPTIME</span>
                <span class="stat-lbl">运行时间</span>
            </div>
            <div class="stat-card">
                <span class="stat-val">Standard</span>
                <span class="stat-lbl">发行版本</span>
            </div>
        </div>

        <!-- Connection info removed -->
        
        <div style="margin-top: 10px;">
            <button id="backupBtn" class="action-button" onclick="handleBackup()" $([ $STATUS_EXIT -ne 0 ] && echo "disabled")>
                📦 立即备份全库 (SQL.GZ)
            </button>
        </div>

        <p style="font-size: 10px; color: #4b5563; margin-top: 25px;">
            更新于: $(date "+%H:%M:%S")
        </p>
    </div>

    <script>
        function handleBackup() {
            const btn = document.getElementById('backupBtn');
            btn.classList.add('loading');
            btn.disabled = true;
            
            // 发起备份请求
            window.location.href = '?action=backup';
            
            // 延迟恢复按钮状态 (因为是直接跳转下载，可能不会触发页面刷新)
            setTimeout(() => {
                btn.classList.remove('loading');
                btn.disabled = false;
            }, 5000);
        }
    </script>
</body>
</html>
EOF
