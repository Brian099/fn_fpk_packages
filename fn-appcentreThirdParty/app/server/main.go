package main

import (
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

var (
	unixSocket      = flag.String("unix-socket", "/var/apps/fn-appcentreThirdParty/var/appcentre.sock", "Unix socket path")
	appDest         = os.Getenv("TRIM_APPDEST")
	pkgVar          = os.Getenv("TRIM_PKGVAR")
	userAppStoreDir = os.Getenv("APP_APPSTORE_DIR")
	configPath      string
	config          Config
)

// Config 应用配置结构体
type Config struct {
	AppStoreDir string `json:"appStoreDir"`
}

// loadConfig 加载配置文件
func loadConfig() {
	configPath = filepath.Join(pkgVar, "config.json")
	log.Printf("Loading config from: %s", configPath)

	// 读取配置文件
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("Config file not found, using default")
			config = Config{}
		} else {
			log.Printf("Failed to read config file: %v", err)
			config = Config{}
		}
		return
	}

	// 解析配置文件
	if err := json.Unmarshal(data, &config); err != nil {
		log.Printf("Failed to parse config file: %v", err)
		config = Config{}
	}

	log.Printf("Config loaded: %+v", config)
}

// saveConfig 保存配置文件
func saveConfig() error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return err
	}

	log.Printf("Config saved to: %s", configPath)
	return nil
}

func main() {
	flag.Parse()

	// Set default values if environment variables are not set
	if appDest == "" {
		appDest = "/var/apps/fn-appcentreThirdParty/target"
	}
	if pkgVar == "" {
		pkgVar = "/var/apps/fn-appcentreThirdParty/var"
	}

	// Load configuration
	loadConfig()

	gin.SetMode(gin.ReleaseMode)

	r := setupRouter()

	ensureDirs()

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
	http.Serve(listener, r)
}

func setupRouter() *gin.Engine {
	r := gin.Default()

	api := r.Group("/api")
	{
		api.GET("/apps", getApps)
		api.GET("/apps/:id", getAppDetail)
		api.GET("/apps/:id/icon", getAppIcon)
		api.POST("/apps/:id/install", installApp)
		api.POST("/apps/:id/start", startApp)
		api.POST("/apps/:id/stop", stopApp)
		api.DELETE("/apps/:id", uninstallApp)
		api.GET("/apps/:id/status", getAppStatus)
		api.GET("/sources", getSources)
		api.POST("/sources", addSource)
		api.DELETE("/sources/:id", deleteSource)
		api.POST("/sources/:id/sync", syncSource)
		// Settings API
		api.GET("/settings", getSettings)
		api.POST("/settings", saveSettings)
	}

	// Serve download files from user's AppStore directory if configured
	userAppStoreDir := findUserAppStoreDir()
	if userAppStoreDir != "" {
		log.Printf("Serving download files from: %s", userAppStoreDir)
		r.Static("/download", userAppStoreDir)
		r.Static("/AppStore", userAppStoreDir)
	} else {
		// Fallback to application's AppStore directory
		appStoreDir := filepath.Join(appDest, "AppStore")
		r.Static("/download", appStoreDir)
		r.Static("/AppStore", appStoreDir)
	}

	return r
}

func findUserAppStoreDir() string {
	// First check if user specified directory in config file
	if config.AppStoreDir != "" {
		log.Printf("Using config-specified AppStore directory: %s", config.AppStoreDir)
		return config.AppStoreDir
	}

	// Then check if user specified directory in environment variable
	if userAppStoreDir != "" {
		log.Printf("Using environment-specified AppStore directory: %s", userAppStoreDir)
		return userAppStoreDir
	}

	// Try to find user's AppStore directory in file space
	userFilesDirs := []string{
		"/vol1/我的文件/AppStore",
	}

	// Try all volume directories
	volumes, err := filepath.Glob("/vol*")
	if err == nil {
		for _, vol := range volumes {
			userFilesDirs = append(userFilesDirs, filepath.Join(vol, "我的文件", "AppStore"))
		}
	}

	// Return the first existing directory
	for _, dir := range userFilesDirs {
		if _, err := os.Stat(dir); err == nil {
			return dir
		}
	}

	return ""
}

func ensureDirs() {
	log.Printf("=== Starting directory creation ===")
	log.Printf("AppDest: %s", appDest)
	log.Printf("PkgVar: %s", pkgVar)

	appStoreDir := filepath.Join(appDest, "AppStore")
	downloadDir := filepath.Join(appDest, "download")
	varDir := pkgVar
	cacheDir := filepath.Join(varDir, "cache")

	log.Printf("AppStoreDir: %s", appStoreDir)
	log.Printf("DownloadDir: %s", downloadDir)
	log.Printf("VarDir: %s", varDir)
	log.Printf("CacheDir: %s", cacheDir)

	dirs := []string{
		appStoreDir,
		downloadDir,
		varDir,
		cacheDir,
	}

	for _, dir := range dirs {
		log.Printf("Creating directory: %s", dir)
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("Failed to create directory %s: %v", dir, err)
		} else {
			log.Printf("Successfully created directory: %s", dir)
			// Check if directory exists
			if _, err := os.Stat(dir); err == nil {
				log.Printf("Directory %s exists and is accessible", dir)
			} else {
				log.Printf("Directory %s still not accessible: %v", dir, err)
			}
		}
	}

	log.Printf("=== Directory creation completed ===")
}

// getSettings 获取应用设置
func getSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"data":    config,
		"message": "获取设置成功",
	})
}

// saveSettings 保存应用设置
func saveSettings(c *gin.Context) {
	var req Config
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误",
		})
		return
	}

	// 验证目录是否存在且可访问
	if req.AppStoreDir != "" {
		// 尝试创建目录
		if err := os.MkdirAll(req.AppStoreDir, 0755); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "无法创建指定目录，请检查权限",
			})
			return
		}

		// 检查目录是否可写
		testFile := filepath.Join(req.AppStoreDir, ".test")
		if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "指定目录不可写，请检查权限",
			})
			return
		}
		os.Remove(testFile)
	}

	// 更新配置
	config = req

	// 保存配置到文件
	if err := saveConfig(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "保存设置失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "保存设置成功",
	})
}
