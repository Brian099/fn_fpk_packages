package services

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"path/filepath"
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
	cacheDir := filepath.Join(pkgVar, "cache")

	appShareMux.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		sources := LoadSources()

		var localSourceID string
		for _, source := range sources {
			if source.Local {
				localSourceID = source.ID
				break
			}
		}

		if localSourceID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"code":0,"data":{"apps":[],"total":0,"sources":0}}`))
			return
		}

		cachePath := filepath.Join(cacheDir, localSourceID+".json")
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

		w.Header().Set("Content-Type", "application/json")
		resp := map[string]interface{}{
			"code": 0,
			"data": map[string]interface{}{
				"apps":    cacheData.Apps,
				"total":   len(cacheData.Apps),
				"sources": 1,
			},
		}
		json.NewEncoder(w).Encode(resp)
	})
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