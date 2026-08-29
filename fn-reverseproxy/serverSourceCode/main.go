package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"fn-reverseproxy/api"
	"fn-reverseproxy/config"
	"fn-reverseproxy/proxy"

	"github.com/gin-gonic/gin"
)

var (
	configDir  = flag.String("cd", ".", "Config directory")
	wwwDir     = flag.String("www", "", "WWW directory for static files")
	unixSocket = flag.String("unix-socket", "", "Unix socket path")
	port       = flag.String("port", "", "HTTP port for Admin API and Web UI (defaults to 16601 if unix-socket is not specified)")
)

func main() {
	flag.Parse()

	confPath := filepath.Join(*configDir, "config.json")
	if err := config.Init(confPath); err != nil {
		log.Fatalf("Failed to init config: %v", err)
	}

	proxy.Init()

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	api.SetupRoutes(r)
	r.NoRoute(proxy.Handler)

	proxy.SetHandler(r)

	if *wwwDir != "" {
		r.Static("/www", *wwwDir)
		r.GET("/", func(c *gin.Context) {
			c.File(filepath.Join(*wwwDir, "index.html"))
		})
	}

	var unixSrv *http.Server
	var httpSrv *http.Server

	if *unixSocket != "" {
		_ = os.Remove(*unixSocket)
		ln, err := net.Listen("unix", *unixSocket)
		if err != nil {
			log.Printf("Unix socket listen error: %v", err)
		} else {
			_ = os.Chmod(*unixSocket, 0666)
			log.Printf("Admin API listening on unix socket: %s", *unixSocket)
			unixSrv = &http.Server{Handler: r}
			go func() {
				if err := unixSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
					log.Printf("Unix socket server error: %v", err)
				}
			}()
		}
	}

	listenPort := *port
	if *unixSocket == "" && listenPort == "" {
		listenPort = "16601"
	}

	if listenPort != "" {
		addr := ":" + listenPort
		httpSrv = &http.Server{Addr: addr, Handler: r}
		go func() {
			log.Printf("Admin API and Web UI listening on: http://127.0.0.1%s", addr)
			if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("HTTP server error: %v", err)
			}
		}()
	}

	go func() {
		addrs := proxy.GetListenAddrs()
		if len(addrs) == 0 {
			log.Println("No proxy rules with ports configured, proxy servers not started")
			return
		}
		log.Println("Starting proxy listeners...")
		proxy.SyncListeners()
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	proxy.Shutdown()

	if unixSrv != nil {
		if err := unixSrv.Shutdown(ctx); err != nil {
			log.Printf("Unix socket server shutdown error: %v", err)
		}
	}

	if httpSrv != nil {
		if err := httpSrv.Shutdown(ctx); err != nil {
			log.Printf("HTTP server shutdown error: %v", err)
		}
	}

	log.Println("Server exited")
}
