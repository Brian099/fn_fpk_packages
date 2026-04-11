#!/bin/bash

set -e

cd "$(dirname "$0")"

echo "Building fn-appcenterThirdParty..."

ARCH=${1:-x86_64}
GOARCH=$(echo "${ARCH}" | sed 's/x86_64/amd64/; s/aarch64/arm64/')

export GOOS=linux
export GOARCH=${GOARCH}
export CGO_ENABLED=0
export GOPROXY=https://goproxy.cn,direct

go mod tidy
go build -v -ldflags="-s -w" -o appcenter_${ARCH}

echo "Build complete: appcenter_${ARCH}"
