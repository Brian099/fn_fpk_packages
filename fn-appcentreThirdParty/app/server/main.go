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
	"appcentre/services"
	"appcentre/utils"
)

var (
	unixSocket = flag.String("unix-socket", config.DefaultUnixSocket, "Unix socket path")
)

func main() {
	flag.Parse()

	appDest := config.AppDest
	if appDest == "" {
		appDest = config.DefaultAppDest
	}
	pkgVar := config.PkgVar
	if pkgVar == "" {
		pkgVar = config.DefaultPkgVar
	}

	appConfig := config.LoadConfig()

	r := router.SetupRouter(appDest, pkgVar, appConfig)

	utils.EnsureDirs(appDest, pkgVar)

	log.Printf("AppDest: %s", appDest)
	log.Printf("PkgVar: %s", pkgVar)

	services.InitAppShareService(pkgVar)

	if appConfig.EnableAppShare {
		if err := services.StartAppShareServer(appConfig.SharePort); err != nil {
			log.Printf("Failed to start app share server: %v", err)
		}
	} else {
		log.Printf("App share feature is disabled")
	}

	if *unixSocket != "" {
		if _, err := os.Stat(*unixSocket); err == nil {
			if err := os.Remove(*unixSocket); err != nil {
				log.Fatalf("Failed to remove existing unix socket: %v", err)
			}
		}

		listener, err := net.Listen("unix", *unixSocket)
		if err != nil {
			log.Fatalf("Failed to listen on unix socket: %v", err)
		}

		if err := os.Chmod(*unixSocket, 0666); err != nil {
			log.Printf("Warning: Failed to set socket permissions: %v", err)
		}

		log.Printf("Starting server on Unix socket: %s", *unixSocket)
		server := &http.Server{
			Handler: r,
		}
		if err := server.Serve(listener); err != nil {
			log.Fatalf("Failed to start server on unix socket: %v", err)
		}
	}

	select {}
}
