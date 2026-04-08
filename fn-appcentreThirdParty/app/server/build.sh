#!/bin/bash

set -e

cd "$(dirname "$0")"

echo "Building fn-appcentreThirdParty..."

export GOOS=linux
export GOARCH=amd64

go mod tidy
go build -v -ldflags="-s -w" -o appcentre

echo "Build complete: appcentre"