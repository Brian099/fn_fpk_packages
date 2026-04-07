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

	log.Println("Server exited")
}
