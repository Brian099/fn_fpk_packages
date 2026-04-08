/*
author: Brian099 、laok
description: 应用中心【第三方】服务器端，负责处理应用安装、卸载、查询等操作
date: 2026-04-01
*/
/* 编译指令
env:GOOS="linux"; $env:GOARCH="amd64"; go build -v -ldflags="-s -w" -o appcentre
*/

package main

import (
	"flag"
	"log"
	"net"
	"net/http"
	"os"

	"appcentre/config"
	"appcentre/router"
	"appcentre/utils"
)

var (
	unixSocket = flag.String("unix-socket", config.DefaultUnixSocket, "Unix socket path")
)

func main() {
	flag.Parse()

	// Set default values if environment variables are not set
	appDest := config.AppDest
	if appDest == "" {
		appDest = config.DefaultAppDest
	}
	pkgVar := config.PkgVar
	if pkgVar == "" {
		pkgVar = config.DefaultPkgVar
	}

	// Load configuration
	appConfig := config.LoadConfig()

	r := router.SetupRouter(appDest, pkgVar, appConfig)

	utils.EnsureDirs(appDest, pkgVar)

	// Use Unix socket for communication (following fn-reverseproxy architecture)
	if err := os.RemoveAll(*unixSocket); err != nil {
		log.Fatalf("Failed to remove old socket: %v", err)
	}

	listener, err := net.Listen("unix", *unixSocket)
	if err != nil {
		log.Fatalf("Failed to create Unix socket: %v", err)
	}
	defer listener.Close()

	if err := os.Chmod(*unixSocket, 0666); err != nil {
		log.Fatalf("Failed to set socket permissions: %v", err)
	}

	log.Printf("Starting server on Unix socket: %s", *unixSocket)
	log.Printf("AppDest: %s", appDest)
	log.Printf("PkgVar: %s", pkgVar)

	http.Serve(listener, r)
}
