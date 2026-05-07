#!/bin/bash

# Build Script (Linux/Shell)
set -e

# 设置当前目录
cd "$(dirname "$0")"

NAME="reverseproxy"

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

    echo "Building $NAME $ARCH (Linux $ARCH)..."
    
    export GOOS=linux
    export GOARCH=${GOARCH}
    export CGO_ENABLED=0
    
    go build -v -ldflags="-s -w" -o "${NAME}_${ARCH}"
    
    # 移动到目标目录
    DEST="../app/server"
    mkdir -p "$DEST"
    mv "${NAME}_${ARCH}" "$DEST/${NAME}_${ARCH}"
    
    # 设置执行权限
    chmod +x "$DEST/${NAME}_${ARCH}"
    
    echo "Build Success! Binary moved to: $DEST/${NAME}_${ARCH} with execute permissions"
done
