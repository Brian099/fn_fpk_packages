#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 设置编译环境变量 (针对 Linux amd64)
export GOOS=linux
export GOARCH=amd64
export CGO_ENABLED=0

# 设置输出路径 (相对于 src/reverseproxy)
OUTPUT_DIR="../../app/server"

echo "开始编译反向代理后端..."

# 整理依赖
go mod tidy

# 编译目标架构列表
ARCHS=("amd64" "arm64")

for ARCH in "${ARCHS[@]}"; do
    echo "正在为 $ARCH 编译反代后端..."
    
    # 设置编译环境变量
    export GOOS=linux
    export GOARCH=$ARCH
    export CGO_ENABLED=0
    
    # 根据架构设置输出文件名
    if [ "$ARCH" == "amd64" ]; then
        OUT_NAME="reverseproxy_x86"
    else
        OUT_NAME="reverseproxy_arm64"
    fi
    
    # 编译并输出到指定位置
    go build -v -ldflags="-s -w" -o "$OUTPUT_DIR/$OUT_NAME"
    
    if [ $? -eq 0 ]; then
        echo "编译成功 ($ARCH): $OUTPUT_DIR/$OUT_NAME"
        ls -lh "$OUTPUT_DIR/$OUT_NAME"
    else
        echo "编译失败 ($ARCH)！"
        exit 1
    fi
done

echo "所有架构编译完成。"
