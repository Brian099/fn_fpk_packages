#!/bin/bash

# Build Script (Linux/Shell)
set -e

# 设置当前目录
cd "$(dirname "$0")"

# 如果没有指定参数，则默认打包两个架构
if [ -z "$1" ]; then
    ARCHS=("x86_64" "aarch64")
else
    ARCHS=("$1")
fi

echo "Tidying go modules..."
export GOPROXY=https://goproxy.cn,direct
go mod tidy

for ARCH in "${ARCHS[@]}"; do
    # 解析 GOARCH
    if [ "$ARCH" == "x86_64" ]; then
        GOARCH="amd64"
    elif [ "$ARCH" == "aarch64" ]; then
        GOARCH="arm64"
    else
        echo "Unknown architecture: $ARCH"
        continue
    fi

    echo "Building notepad-server (Linux $ARCH)..."
    
    export GOOS=linux
    export GOARCH=${GOARCH}
    export CGO_ENABLED=0
    
    go build -v -ldflags="-s -w" -o notepad-server_${ARCH}
    
    # 移动到目标目录
    DEST="../app/server"
    mkdir -p "$DEST"
    mv "notepad-server_${ARCH}" "$DEST/notepad-server_${ARCH}"
    
    echo "Build Success! Binary moved to: $DEST/notepad-server_${ARCH}"
done
