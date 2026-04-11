#!/bin/bash

set -e

cd "$(dirname "$0")"

echo "Building fn-appcenterThirdParty..."

export GOOS=linux
export GOARCH=amd64

go mod tidy
go build -v -ldflags="-s -w" -o appcenter

echo "Build complete: appcenter"
