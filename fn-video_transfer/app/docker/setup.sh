#!/bin/bash

# 确保脚本遇到错误时停止 (可选，视需求而定，这里为了容错暂时不开启 set -e)
# set -e

TEMPLATE_FILE="docker-compose.template.yml"
OUTPUT_FILE="docker-compose.yml"

# 检查模板文件是否存在
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "错误: 找不到模板文件 $TEMPLATE_FILE"
    exit 1
fi

echo "正在初始化 docker-compose.yml..."
cp "$TEMPLATE_FILE" "$OUTPUT_FILE"

# ---------------------------------------------------------
# 0. 配置媒体目录
# ---------------------------------------------------------
read -p "请输入媒体文件目录 (默认为当前目录下的 ./media): " USER_MEDIA_DIR

# 如果为空，则使用默认值
if [ -z "$USER_MEDIA_DIR" ]; then
    USER_MEDIA_DIR="./media"
fi

# 创建目录
if [ ! -d "$USER_MEDIA_DIR" ]; then
    echo "目录 $USER_MEDIA_DIR 不存在，正在创建..."
    mkdir -p "$USER_MEDIA_DIR"
else
    echo "使用已存在的目录: $USER_MEDIA_DIR"
fi

# 替换 docker-compose.yml 中的路径
# 使用 | 作为分隔符以避免路径中的 / 冲突
sed -i "s|./media:/data|$USER_MEDIA_DIR:/data|g" "$OUTPUT_FILE"

echo "已配置媒体目录: $USER_MEDIA_DIR -> /data"

# ---------------------------------------------------------
# 0.5. 配置配置目录
# ---------------------------------------------------------
read -p "请输入配置文件目录 (默认为当前目录下的 ./config): " USER_CONFIG_DIR

# 如果为空，则使用默认值
if [ -z "$USER_CONFIG_DIR" ]; then
    USER_CONFIG_DIR="./config"
fi

# 创建目录
if [ ! -d "$USER_CONFIG_DIR" ]; then
    echo "目录 $USER_CONFIG_DIR 不存在，正在创建..."
    mkdir -p "$USER_CONFIG_DIR"
else
    echo "使用已存在的目录: $USER_CONFIG_DIR"
fi

# 替换 docker-compose.yml 中的路径
sed -i "s|./config:/config|$USER_CONFIG_DIR:/config|g" "$OUTPUT_FILE"

echo "已配置配置目录: $USER_CONFIG_DIR -> /config"

echo "正在检查硬件环境..."

# ---------------------------------------------------------
# 1. 检查 NVIDIA 显卡
# ---------------------------------------------------------
# 使用 command -v 检查 nvidia-smi 是否存在
# 尝试运行 nvidia-smi -L 列出 GPU，确保驱动正常工作
if command -v nvidia-smi &> /dev/null && nvidia-smi -L &> /dev/null; then
    echo "✅ 检测到 NVIDIA 显卡，正在启用 CUDA 支持..."
    cat <<EOF >> "$OUTPUT_FILE"

    # NVIDIA 显卡加速
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
EOF
else
    echo "⚠️  未检测到可用 NVIDIA 显卡或驱动，跳过 CUDA 配置。"
fi

# ---------------------------------------------------------
# 2. 检查 Intel/AMD 核显 (/dev/dri)
# ---------------------------------------------------------
if [ -d "/dev/dri" ]; then
    echo "✅ 检测到 /dev/dri 设备，正在启用 VAAPI/QSV 支持..."
    cat <<EOF >> "$OUTPUT_FILE"

    # Intel/AMD 核显加速 (VAAPI/QSV)
    devices:
      - /dev/dri:/dev/dri
EOF
else
    echo "⚠️  未检测到 /dev/dri 设备，跳过核显配置。"
fi

echo "-------------------------------------------------------"
echo "docker-compose.yml 生成完毕。"
echo "-------------------------------------------------------"

# ---------------------------------------------------------
# 3. 启动容器
# ---------------------------------------------------------
echo "正在启动容器..."

# 检测使用 docker compose (V2) 还是 docker-compose (V1)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo "❌ 错误: 未找到 docker compose 或 docker-compose 命令。"
    exit 1
fi

echo "使用命令: $DOCKER_COMPOSE_CMD"
$DOCKER_COMPOSE_CMD build --no-cache
$DOCKER_COMPOSE_CMD up -d

if [ $? -eq 0 ]; then
    echo "✅ 服务启动成功！"
else
    echo "❌ 服务启动失败，请检查上方错误日志。"
fi
