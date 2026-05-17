#!/bin/bash
set -e

# 获取脚本所在的目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="${SCRIPT_DIR}/"

echo ">>> 正在编译 ImageAdmin 后端 (强制严谨模式)..."
echo ">>> 源码目录: ${SERVER_DIR}"

# 清理旧的编译产物，确保如果编译失败，后续打包也会因为找不到文件而报错
rm -f "${SCRIPT_DIR}/server/amd64/fnosnassign_x86_64"
rm -f "${SCRIPT_DIR}/server/arm64/fnosnassign_aarch64"

cd "${SERVER_DIR}"

echo ">>> 编译 Linux amd64..."
GOOS=linux GOARCH=amd64 go build -o "${SCRIPT_DIR}/server/amd64/fnosnassign_x86_64" main.go config.go

echo ">>> 编译 Linux arm64..."
GOOS=linux GOARCH=arm64 go build -o "${SCRIPT_DIR}/server/arm64/fnosnassign_aarch64" main.go config.go

echo ">>> 编译全部完成！"
