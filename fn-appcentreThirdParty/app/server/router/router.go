package router

import (
	"log"
	"path/filepath"

	"appcentre/config"
	"appcentre/handlers"

	"github.com/gin-gonic/gin"
)

// SetupRouter 设置路由
func SetupRouter(appDest, pkgVar string, appConfig config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	r := gin.Default()

	api := r.Group("/api")
	{
		api.GET("/apps", handlers.GetApps)
		api.GET("/apps/:id", handlers.GetAppDetail)
		api.GET("/apps/:id/icon", handlers.GetAppIcon)
		api.POST("/apps/:id/install", handlers.InstallApp)
		api.POST("/apps/:id/start", handlers.StartApp)
		api.POST("/apps/:id/stop", handlers.StopApp)
		api.DELETE("/apps/:id", handlers.UninstallApp)
		api.GET("/apps/:id/status", handlers.GetAppStatus)
		// 新增应用管理API
		api.GET("/apps/installed", handlers.GetInstalledApps)
		api.GET("/volume/default", handlers.GetDefaultVolume)
		api.POST("/volume/default/:id", handlers.SetDefaultVolume)
		api.GET("/manual-install", handlers.GetManualInstallStatus)
		api.POST("/manual-install/:action", handlers.SetManualInstall)
		api.GET("/sources", handlers.GetSources)
		api.POST("/sources", handlers.AddSource)
		api.DELETE("/sources/:id", handlers.DeleteSource)
		api.POST("/sources/:id/toggle", handlers.ToggleSource)
		api.POST("/sources/:id/sync", handlers.SyncSource)
		api.POST("/sources/:id/reset-cache", handlers.ResetSourceCache)
		// Settings API
		api.GET("/settings", handlers.GetSettings)
		api.POST("/settings", handlers.SaveSettings)
	}

	// 内置 AppStore 目录使用 /built-in-download 前缀
	// 用户配置的 AppStore 目录使用 /user-download 前缀
	builtInAppStoreDir := filepath.Join(appDest, "AppStore")
	r.Static("/built-in-download", builtInAppStoreDir)

	if appConfig.AppStoreDir != "" {
		log.Printf("Serving user AppStore files from: %s", appConfig.AppStoreDir)
		r.Static("/user-download", appConfig.AppStoreDir)
	}

	return r
}
