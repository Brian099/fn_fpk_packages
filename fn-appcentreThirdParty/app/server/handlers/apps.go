package handlers

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"appcentre/config"
	"appcentre/models"
	"appcentre/services"

	"github.com/gin-gonic/gin"
)

// getAppCenterCliPath 获取appcenter-cli的路径
func getAppCenterCliPath() string {
	if config.AppCenterCliPath != "" {
		return config.AppCenterCliPath
	}
	if config.AppDest != "" {
		cliPath := filepath.Join(config.AppDest, "appcenter-cli")
		if _, err := os.Stat(cliPath); err == nil {
			return cliPath
		}
	}
	return "appcenter-cli"
}

// GetApps 获取所有应用
func GetApps(c *gin.Context) {
	category := c.Query("category")
	keyword := strings.ToLower(c.Query("keyword"))

	allApps := make([]models.App, 0)

	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	// 确保本地 FPK 源总是被检查，即使目录中没有新文件
	hasLocalFPKSource := false
	for _, s := range sources {
		if s.ID == "local_fpk_files" {
			hasLocalFPKSource = true
			break
		}
	}
	if !hasLocalFPKSource {
		// 如果扫描没发现物理文件，但我们还是要显示已缓存的本地应用
		sources = append(sources, models.Source{
			ID:      "local_fpk_files",
			Name:    "本地 FPK 文件",
			Enabled: true,
			Local:   true,
		})
	}

	for _, source := range sources {
		if !source.Enabled {
			continue
		}
		apps := services.LoadAppsFromSource(source.ID)
		allApps = append(allApps, apps...)
	}

	// 按分类过滤
	if category != "" {
		filtered := make([]models.App, 0)
		for _, app := range allApps {
			match := false
			if category == "installed" {
				// 检查版本号是否被标记为 installed
				if app.Version == "installed" {
					match = true
				}
			} else if category == "latest" {
				// 暂时返回所有作为最新发布
				match = true
			} else {
				for _, cat := range app.Categories {
					if strings.EqualFold(cat, category) {
						match = true
						break
					}
				}
			}

			if match {
				filtered = append(filtered, app)
			}
		}
		allApps = filtered
	}

	// 按关键字搜索
	if keyword != "" {
		filtered := make([]models.App, 0)
		for _, app := range allApps {
			if strings.Contains(strings.ToLower(app.Name), keyword) ||
				strings.Contains(strings.ToLower(app.Description), keyword) ||
				strings.Contains(strings.ToLower(app.ID), keyword) {
				filtered = append(filtered, app)
			}
		}
		allApps = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"apps":    allApps,
			"total":   len(allApps),
			"sources": len(sources),
		},
	})
}

// GetBuiltInApps 获取内置应用
func GetBuiltInApps(c *gin.Context) {
	builtInApps := services.LoadBuiltInApps()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"apps":  builtInApps,
			"total": len(builtInApps),
		},
	})
}

// GetUserApps 获取用户应用
func GetUserApps(c *gin.Context) {
	userApps := services.LoadUserApps()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"apps":  userApps,
			"total": len(userApps),
		},
	})
}

// GetAppDetail 获取应用详情
func GetAppDetail(c *gin.Context) {
	appID := c.Param("id")

	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	for _, source := range sources {
		if !source.Enabled {
			continue
		}
		apps := services.LoadAppsFromSource(source.ID)
		for _, app := range apps {
			if app.ID == appID {
				c.JSON(http.StatusOK, gin.H{
					"code": 0,
					"data": app,
				})
				return
			}
		}
	}

	c.JSON(http.StatusNotFound, gin.H{
		"code":    404,
		"message": "Application not found",
	})
}

// GetAppIcon 获取应用图标
func GetAppIcon(c *gin.Context) {
	appID := c.Param("id")

	// First try to get icon from cache
	cacheDir := filepath.Join(config.PkgVar, "cache")
	iconCachePath := filepath.Join(cacheDir, "icons", appID+".png")
	if _, err := os.Stat(iconCachePath); err == nil {
		c.File(iconCachePath)
		return
	}

	// Fallback to app store directory
	appStoreDir := filepath.Join(config.AppDest, "AppStore")
	iconPath := filepath.Join(appStoreDir, appID, "ICON.PNG")
	if _, err := os.Stat(iconPath); os.IsNotExist(err) {
		c.String(http.StatusNotFound, "Icon not found")
		return
	}

	c.File(iconPath)
}

// InstallAppRequest 安装应用请求结构体
type InstallAppRequest struct {
	EnvFilePath string `json:"env_file_path"` // 环境变量文件路径
}

// InstallApp 安装应用
func InstallApp(c *gin.Context) {
	appID := c.Param("id")

	// 解析请求参数
	var req InstallAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// 如果没有提供JSON参数，使用默认安装方式
		req = InstallAppRequest{}
	}

	// Find the FPK file
	userAppStoreDir := services.GetUsersAppStoreDir()
	if userAppStoreDir == "" {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "AppStore directory not configured",
		})
		return
	}

	fpkPath := filepath.Join(userAppStoreDir, appID+".fpk")
	if _, err := os.Stat(fpkPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{
			"code":    404,
			"message": "FPK file not found",
		})
		return
	}

	// Use appcenter-cli to install the app
	cliPath := getAppCenterCliPath()
	args := []string{"install-fpk", fpkPath}

	// 如果提供了环境变量文件，添加--env参数
	if req.EnvFilePath != "" {
		if _, err := os.Stat(req.EnvFilePath); err == nil {
			args = append(args, "--env", req.EnvFilePath)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "Environment file not found",
			})
			return
		}
	}

	cmd := exec.Command(cliPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to install app %s: %v, output: %s", appID, err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": fmt.Sprintf("Installation failed: %v", err),
			"output":  string(output),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Application installed successfully",
		"output":  string(output),
	})
}

// StartApp 启动应用
func StartApp(c *gin.Context) {
	appID := c.Param("id")

	// Use appcenter-cli to start the app
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "start", appID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to start app %s: %v, output: %s", appID, err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": fmt.Sprintf("Failed to start: %v", err),
			"output":  string(output),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Application started successfully",
		"output":  string(output),
	})
}

// StopApp 停止应用
func StopApp(c *gin.Context) {
	appID := c.Param("id")

	// Use appcenter-cli to stop the app
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "stop", appID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to stop app %s: %v, output: %s", appID, err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": fmt.Sprintf("Failed to stop: %v", err),
			"output":  string(output),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Application stopped successfully",
		"output":  string(output),
	})
}

// UninstallApp 卸载应用
func UninstallApp(c *gin.Context) {
	appID := c.Param("id")

	// First stop the app if it's running
	cliPath := getAppCenterCliPath()
	exec.Command(cliPath, "stop", appID).Run()

	// Remove app directory
	appDir := filepath.Join("/usr/local/apps/@appcenter", appID)
	if err := os.RemoveAll(appDir); err != nil {
		log.Printf("Failed to remove app directory %s: %v", appDir, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": fmt.Sprintf("Failed to uninstall: %v", err),
		})
		return
	}

	// Remove app data directory
	appDataDir := filepath.Join("/usr/local/apps/@appdata", appID)
	os.RemoveAll(appDataDir) // Ignore error if directory doesn't exist

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Application uninstalled successfully",
	})
}

// GetAppStatus 获取应用状态
func GetAppStatus(c *gin.Context) {
	appID := c.Param("id")

	// Check if app is installed
	appDir := filepath.Join("/usr/local/apps/@appcenter", appID)
	if _, err := os.Stat(appDir); os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"status":  "not_installed",
				"running": false,
			},
		})
		return
	}

	// Check if app is running
	running := false
	pidFile := filepath.Join("/usr/local/apps/@appdata", appID, "app.pid")
	if data, err := os.ReadFile(pidFile); err == nil {
		pid := strings.TrimSpace(string(data))
		if pid != "" {
			// Check if process is running
			if _, err := os.Stat(filepath.Join("/proc", pid)); err == nil {
				running = true
			}
		}
	}

	status := "stopped"
	if running {
		status = "running"
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"status":  status,
			"running": running,
		},
	})
}

// GetInstalledApps 获取已安装应用列表
func GetInstalledApps(c *gin.Context) {
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "list")
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("Failed to get installed apps: %v, output: %s", err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "Failed to get installed apps",
			"output":  string(output),
		})
		return
	}

	// 解析appcenter-cli list的输出
	apps := parseAppListOutput(string(output))

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"apps": apps,
		},
	})
}

// parseAppListOutput 解析appcenter-cli list命令的输出
func parseAppListOutput(output string) []map[string]string {
	apps := []map[string]string{}
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "ID") || strings.HasPrefix(line, "-") {
			continue
		}

		// 解析每行应用信息
		fields := strings.Fields(line)
		if len(fields) >= 3 {
			app := map[string]string{
				"id":      fields[0],
				"name":    fields[1],
				"version": fields[2],
				"status":  "unknown",
			}

			if len(fields) >= 4 {
				app["status"] = fields[3]
			}

			apps = append(apps, app)
		}
	}

	return apps
}

// GetDefaultVolume 获取默认存储空间
func GetDefaultVolume(c *gin.Context) {
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "default-volume")
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("Failed to get default volume: %v, output: %s", err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "Failed to get default volume",
			"output":  string(output),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"default_volume": strings.TrimSpace(string(output)),
		},
	})
}

// SetDefaultVolume 设置默认存储空间
func SetDefaultVolume(c *gin.Context) {
	volumeID := c.Param("id")

	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "default-volume", volumeID)
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("Failed to set default volume: %v, output: %s", err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "Failed to set default volume",
			"output":  string(output),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Default volume set successfully",
		"output":  string(output),
	})
}

// GetManualInstallStatus 获取手动安装状态
func GetManualInstallStatus(c *gin.Context) {
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "manual-install")
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("Failed to get manual install status: %v, output: %s", err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "Failed to get manual install status",
			"output":  string(output),
		})
		return
	}

	status := "unknown"
	outputStr := strings.ToLower(string(output))
	if strings.Contains(outputStr, "enabled") {
		status = "enabled"
	} else if strings.Contains(outputStr, "disabled") {
		status = "disabled"
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"manual_install": status,
		},
	})
}

// SetManualInstall 设置手动安装状态
func SetManualInstall(c *gin.Context) {
	action := c.Param("action") // "enable" or "disable"

	if action != "enable" && action != "disable" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "Invalid action. Use 'enable' or 'disable'",
		})
		return
	}

	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "manual-install", action)
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("Failed to set manual install: %v, output: %s", err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "Failed to set manual install",
			"output":  string(output),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Manual install " + action + "d successfully",
		"output":  string(output),
	})
}
