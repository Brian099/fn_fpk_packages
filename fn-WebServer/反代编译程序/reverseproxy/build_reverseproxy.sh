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

# 编译并输出到指定位置
go build -v -ldflags="-s -w" -o "$OUTPUT_DIR/reverseproxy"

if [ $? -eq 0 ]; then
    echo "编译成功: $OUTPUT_DIR/reverseproxy"
    ls -lh "$OUTPUT_DIR/reverseproxy"
else
    echo "编译失败！"
    exit 1
fi
