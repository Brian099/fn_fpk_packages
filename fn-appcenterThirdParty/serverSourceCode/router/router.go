package router

import (
	"log"
	"path/filepath"

	"appcenter/config"
	"appcenter/handlers"

	"github.com/gin-gonic/gin"
)

// SetupRouter 设置路由
func SetupRouter(appDest, pkgVar string, appConfig config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	r := gin.Default()

	api := r.Group("/api")
	{
		api.GET("/apps", handlers.GetApps)
		api.GET("/apps/local", handlers.GetLocalApps)
		api.GET("/apps/:id", handlers.GetAppDetail)
		api.GET("/apps/:id/icon", handlers.GetAppIcon)
		api.POST("/apps/:id/install", handlers.InstallApp)
		api.GET("/apps/:id/install/progress", handlers.GetInstallProgress)
		api.POST("/apps/:id/start", handlers.StartApp)
		api.POST("/apps/:id/stop", handlers.StopApp)
		api.DELETE("/apps/:id", handlers.UninstallApp)
		api.GET("/apps/:id/check", handlers.CheckApp)
		api.GET("/apps/:id/status", handlers.GetAppStatus)
		api.POST("/apps/status/refresh", handlers.RefreshAllStatus)
		api.GET("/apps/:id/wizard", handlers.GetAppWizard)
		api.POST("/apps/:id/download", handlers.RecordAppDownload)
		// 新增应用管理API
		api.GET("/apps/installed", handlers.GetInstalledApps)
		api.GET("/system/default-volume", handlers.GetDefaultVolume)
		api.POST("/system/default-volume/:id", handlers.SetDefaultVolume)
		api.GET("/system/volumes", handlers.GetVolumes)
		api.GET("/manual-install", handlers.GetManualInstallStatus)
		api.POST("/manual-install/:action", handlers.SetManualInstall)
		api.GET("/sources", handlers.GetSources)
		api.POST("/sources", handlers.AddSource)
		api.POST("/sources/preset/sync", handlers.SyncPresetSources)
		api.DELETE("/sources/:id", handlers.DeleteSource)
		api.POST("/sources/:id/toggle", handlers.ToggleSource)
		api.POST("/sources/:id/sync", handlers.SyncSource)
		api.POST("/sources/:id/reset-cache", handlers.ResetSourceCache)
		api.PUT("/sources/:id/apps/:appId/labels", handlers.UpdateAppLabels)
		// Settings API
		api.GET("/settings", handlers.GetSettings)
		api.POST("/settings", handlers.SaveSettings)
		api.GET("/settings/check-port", handlers.CheckPortAvailability)
	}

	// 根路径直接返回本地缓存数据（用于 5668 端口直接访问）
	r.GET("/", handlers.GetCacheApps)

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
