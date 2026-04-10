package services

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"appcentre/models"
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
	localCacheDir := filepath.Join(pkgVar, "cache")

	appShareMux.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		path := req.URL.Path

		if strings.HasPrefix(path, "/download/") {
			handleDownload(w, req, localCacheDir)
			return
		}

		host := req.Host
		baseURL := "http://" + host

		sources := LoadSources()

		var localSource *models.Source
		for _, source := range sources {
			if source.Local {
				localSource = &source
				break
			}
		}

		if localSource == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"code":0,"data":{"apps":[],"total":0,"sources":0}}`))
			return
		}

		cachePath := filepath.Join(localCacheDir, localSource.ID+".json")
		data, err := ioutil.ReadFile(cachePath)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"code":0,"data":{"apps":[],"total":0,"sources":1}}`))
			return
		}

		var cacheData struct {
			Apps []models.App `json:"apps"`
		}
		if err := json.Unmarshal(data, &cacheData); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"code":0,"data":{"apps":[],"total":0,"sources":1}}`))
			return
		}

		for i := range cacheData.Apps {
			app := &cacheData.Apps[i]
			if app.DownloadURL != "" && !strings.HasPrefix(app.DownloadURL, "http") {
				app.DownloadURL = baseURL + "/download/" + app.DownloadURL
			}
		}

		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"code": 0,
			"data": map[string]interface{}{
				"apps":      cacheData.Apps,
				"total":     len(cacheData.Apps),
				"sources":   1,
				"base_url":  baseURL,
				"app_store": localSource.URL,
			},
		}
		json.NewEncoder(w).Encode(resp)
	})
}

func handleDownload(w http.ResponseWriter, req *http.Request, cacheDir string) {
	sources := LoadSources()

	var localSource *models.Source
	for _, source := range sources {
		if source.Local {
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
