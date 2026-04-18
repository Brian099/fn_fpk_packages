package services

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"appcenter/models"
)

var (
	appShareServer *http.Server
	appShareMux    *http.ServeMux
	appShareMutex  sync.Mutex
	pkgVar         string
)

func InitAppShareService(pv string) {
	pkgVar = pv
	appShareMux = http.NewServeMux()
	initMuxHandlers()
}

func initMuxHandlers() {
	// localCacheDir 已不再需要，数据直接从 GlobalStore 获取

	appShareMux.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		path := req.URL.Path

		if strings.HasPrefix(path, "/icon/") {
			handleIcon(w, req)
			return
		}
		if strings.HasPrefix(path, "/download/") {
			handleDownload(w, req)
			return
		}

		host := req.Host
		baseURL := "http://" + host

		sources := GlobalStore.GetSources()

		var localSource *models.Source
		for _, source := range sources {
			if source.Local && source.Enabled {
				localSource = &source
				break
			}
		}

		if localSource == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"code":0,"data":{"apps":[],"total":0,"sources":0}}`))
			return
		}

		// 从内存获取应用列表
		apps := GlobalStore.GetAppsBySource(localSource.ID)
		
		// 如果内存中为空，尝试执行一次扫描（自愈/初始化）
		if len(apps) == 0 && localSource.Local {
			apps = ScanFPKDir(localSource.URL, localSource.ID, false)
			GlobalStore.AddOrUpdateSource(*localSource, apps)
		}

		// 处理下载链接和图标
		resApps := make([]models.App, len(apps))
		for i := range apps {
			resApps[i] = apps[i]
			if resApps[i].DownloadURL != "" && !strings.HasPrefix(resApps[i].DownloadURL, "http") {
				resApps[i].DownloadURL = baseURL + "/download/" + resApps[i].DownloadURL
			}
			// 图标瘦身：如果图标是 Base64，替换为当前分享服务的代理 URL
			if len(resApps[i].Icon) > 500 && strings.HasPrefix(resApps[i].Icon, "data:") {
				resApps[i].Icon = baseURL + "/icon/" + resApps[i].ID
			}
		}

		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"code": 0,
			"data": map[string]interface{}{
				"apps":    resApps,
				"total":   len(resApps),
				"sources": 1,
				"base_url":  baseURL,
				"app_store": localSource.URL,
			},
		}
		json.NewEncoder(w).Encode(resp)
	})
}

func handleDownload(w http.ResponseWriter, req *http.Request) {
	sources := GlobalStore.GetSources()

	var localSource *models.Source
	for _, source := range sources {
		if source.Local && source.Enabled {
			localSource = &source
			break
		}
	}

	if localSource == nil {
		http.NotFound(w, req)
		return
	}

	relPath := strings.TrimPrefix(req.URL.Path, "/download/")
	actualFilename := filepath.Base(relPath)

	fpkPath := filepath.Join(localSource.URL, relPath)
	if _, err := os.Stat(fpkPath); os.IsNotExist(err) {
		http.NotFound(w, req)
		return
	}

	log.Printf("Serving download: %s", fpkPath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", actualFilename))
	http.ServeFile(w, req, fpkPath)
}

func handleIcon(w http.ResponseWriter, req *http.Request) {
	appID := strings.TrimPrefix(req.URL.Path, "/icon/")
	
	sources := GlobalStore.GetSources()
	var localSourceID string
	for _, source := range sources {
		if source.Local && source.Enabled {
			localSourceID = source.ID
			break
		}
	}

	if localSourceID == "" {
		http.NotFound(w, req)
		return
	}

	// 1. 优先尝试从物理缓存目录读取
	iconPath := filepath.Join(pkgVar, "cache", "icons", appID+".png")
	if _, err := os.Stat(iconPath); err == nil {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Header().Set("Content-Type", "image/png")
		http.ServeFile(w, req, iconPath)
		return
	}

	// 2. 备选：从内存获取并解码
	apps := GlobalStore.GetAppsBySource(localSourceID)
	var iconData string
	for _, app := range apps {
		if app.ID == appID {
			iconData = app.Icon
			break
		}
	}

	if iconData == "" {
		http.NotFound(w, req)
		return
	}

	if strings.HasPrefix(iconData, "data:") {
		parts := strings.Split(iconData, ",")
		if len(parts) == 2 {
			mime := "image/png"
			if strings.Contains(parts[0], "jpeg") { mime = "image/jpeg" }
			data, err := base64.StdEncoding.DecodeString(parts[1])
			if err == nil {
				w.Header().Set("Content-Type", mime)
				w.Header().Set("Cache-Control", "public, max-age=86400")
				w.Write(data)
				return
			}
		}
	}
	
	if strings.HasPrefix(iconData, "http") {
		http.Redirect(w, req, iconData, http.StatusMovedPermanently)
		return
	}

	http.NotFound(w, req)
}

func StartAppShareServer(port int) error {
	appShareMutex.Lock()
	defer appShareMutex.Unlock()

	if appShareServer != nil {
		log.Printf("App share server already running")
		return nil
	}

	addr := fmt.Sprintf(":%d", port)
	appShareServer = &http.Server{
		Addr:    addr,
		Handler: appShareMux,
	}

	go func() {
		log.Printf("Starting app share server on TCP port: %s", addr)
		if err := appShareServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("App share server error: %v", err)
		}
		appShareMutex.Lock()
		appShareServer = nil
		appShareMutex.Unlock()
	}()

	return nil
}

func StopAppShareServer() error {
	appShareMutex.Lock()
	defer appShareMutex.Unlock()

	if appShareServer == nil {
		log.Printf("App share server not running")
		return nil
	}

	log.Printf("Stopping app share server")
	return appShareServer.Close()
}

func IsAppShareServerRunning() bool {
	appShareMutex.Lock()
	defer appShareMutex.Unlock()
	return appShareServer != nil
}
