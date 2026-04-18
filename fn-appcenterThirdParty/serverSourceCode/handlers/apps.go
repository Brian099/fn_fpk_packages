package handlers

import (
	"crypto/tls"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"appcenter/config"
	"appcenter/models"
	"appcenter/services"

	"github.com/gin-gonic/gin"
)

// 全局安装进度 Map: AppID -> percentage (int)
var installProgressMap sync.Map

// ProgressWriter 用于追踪下载进度
type ProgressWriter struct {
	Total      int64
	Written    int64
	OnProgress func(percentage int)
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.Written += int64(n)
	if pw.Total > 0 {
		percentage := int(float64(pw.Written) / float64(pw.Total) * 100)
		if percentage > 100 {
			percentage = 100
		}
		pw.OnProgress(percentage)
	}
	return n, nil
}

// resolveAppName 根据 appID 获取其内部真实的 AppName
func resolveAppName(appID string) string {
	// 1. 尝试从缓存中查找（仅在 AppName 字段有效时返回）
	sources := services.LoadSources()
	for i := range sources {
		if !sources[i].Enabled {
			continue
		}
		apps := services.LoadAppsFromSource(&sources[i])
		for _, app := range apps {
			if app.ID == appID && app.AppName != "" {
				log.Printf("[Resolve] Found AppName '%s' from CACHE for ID: %s", app.AppName, appID)
				return app.AppName
			}
		}
	}

	// 2. 如果缓存中没有 AppName，尝试实时解析本地 FPK 文件
	userAppStoreDir := services.GetUsersAppStoreDir()
	fpkPath := filepath.Join(userAppStoreDir, appID+".fpk")
	if _, err := os.Stat(fpkPath); err == nil {
		app, err := services.ParseFPKFile(fpkPath, userAppStoreDir)
		if err == nil && app.AppName != "" {
			log.Printf("[Resolve] Found AppName '%s' from LIVE FPK scan for ID: %s", app.AppName, appID)
			return app.AppName
		}
	}

	// 3. 最后手段：查已安装目录探测
	realName := getInstalledAppName(appID)
	return realName
}

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

// GetCacheApps 直接返回本地缓存的应用数据（用于 5668 端口）
func GetCacheApps(c *gin.Context) {
	pkgVar := config.PkgVar
	if pkgVar == "" {
		pkgVar = "/var/apps/fn-appcenterThirdParty/var"
	}

	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	allRecommendedApps := []models.App{}
	localSourcesCount := 0

	for _, source := range sources {
		if source.Local && source.Enabled {
			localSourcesCount++
			apps := services.LoadAppsFromSource(&source)
			for _, app := range apps {
				if app.Recommended {
					allRecommendedApps = append(allRecommendedApps, app)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"apps":    allRecommendedApps,
			"total":   len(allRecommendedApps),
			"sources": localSourcesCount,
		},
	})
}

// GetApps 获取所有应用
func GetApps(c *gin.Context) {
	// 后台异步检查并清理失效源 (无感维护)
	go services.AsyncCheckSources()

	category := c.Query("category")
	keyword := strings.ToLower(c.Query("keyword"))

	allApps := make([]models.App, 0)

	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	for i := range sources {
		if !sources[i].Enabled {
			continue
		}
		apps := services.LoadAppsFromSource(&sources[i])
		allApps = append(allApps, apps...)
	}

	// 获取所有已安装应用的实时状态映射
	installedMap, _ := services.GetInstalledAppsMap()

	// 按分类过滤
	if category != "" {
		filtered := make([]models.App, 0)

		if category == "installed" {
			for _, app := range allApps {
				// 使用内部 appname 或 id 进行比对 (必须匹配 list 中的 APP NAME)
				if installedMap != nil && (installedMap[app.AppName] != nil || installedMap[app.ID] != nil) {
					filtered = append(filtered, app)
				}
			}
		} else if category == "推荐应用" {
			for _, app := range allApps {
				if app.Recommended {
					filtered = append(filtered, app)
				}
			}
		} else if category == "trending" {
			// 热门应用：按下载量排序并取前 25
			sort.Slice(allApps, func(i, j int) bool {
				return allApps[i].DownloadCount > allApps[j].DownloadCount
			})
			if len(allApps) > 25 {
				allApps = allApps[:25]
			}
			filtered = allApps
		} else {
			for _, app := range allApps {
				match := false
				switch category {
				case "trending":
					// 已经在上面处理了特例，这里设为 true 只是为了逻辑严密
					match = true
				default:
					for _, cat := range app.Labels {
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

	// 按 AppName 分组，每个应用只保留最高版本
	groups := make(map[string]models.App)
	for _, app := range allApps {
		key := app.AppName
		if key == "" {
			key = app.ID
		}
		if existing, ok := groups[key]; !ok || CompareVersions(app.Version, existing.Version) > 0 {
			groups[key] = app
		}
	}

	// 转换回切片
	allApps = make([]models.App, 0, len(groups))
	for _, app := range groups {
		allApps = append(allApps, app)
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"apps":      allApps,
			"total":     len(allApps),
			"sources":   len(sources),
			"installed": installedMap, // 将已安装映射返回给前端，用于快速渲染角标
		},
	})
}

// GetLocalApps 获取所有本地源的应用（不进行名称/版本聚合，显示原始物理文件列表）
func GetLocalApps(c *gin.Context) {
	allApps := make([]models.App, 0)

	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	for i := range sources {
		// 仅显示本地且启用的源
		if !sources[i].Local || !sources[i].Enabled {
			continue
		}
		apps := services.LoadAppsFromSource(&sources[i])
		allApps = append(allApps, apps...)
	}

	// 获取已安装状态映射供前端渲染
	installedMap, _ := services.GetInstalledAppsMap()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"apps":      allApps,
			"total":     len(allApps),
			"installed": installedMap,
		},
	})
}


// GetAppDetail 获取应用详情
func GetAppDetail(c *gin.Context) {
	appID := c.Param("id")

	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	var foundApp *models.App
	allAvailableApps := make([]models.App, 0)

	for i := range sources {
		if !sources[i].Enabled {
			continue
		}
		apps := services.LoadAppsFromSource(&sources[i])
		for j := range apps {
			allAvailableApps = append(allAvailableApps, apps[j])
			if apps[j].ID == appID {
				foundApp = &apps[j]
			}
		}
	}

	if foundApp != nil {
		// 查找相同 AppName 的其他版本/源
		targetAppName := foundApp.AppName
		if targetAppName == "" {
			targetAppName = foundApp.ID
		}

		otherVersions := make([]*models.App, 0)
		for i := range allAvailableApps {
			app := allAvailableApps[i]
			appName := app.AppName
			if appName == "" {
				appName = app.ID
			}

			if appName == targetAppName && app.ID != foundApp.ID {
				otherVersions = append(otherVersions, &allAvailableApps[i])
			}
		}

		// 按版本降序排序
		sort.Slice(otherVersions, func(i, j int) bool {
			return CompareVersions(otherVersions[i].Version, otherVersions[j].Version) > 0
		})

		foundApp.OtherVersions = otherVersions

		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": foundApp,
		})
		return
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
	EnvFilePath string            `json:"env_file_path"` // 环境变量文件路径（旧）
	Env         map[string]string `json:"env"`           // 向导收集的环境变量
	VolumeID    int               `json:"volume_id"`     // 目标存储池ID
	DownloadURL string            `json:"download_url"`  // 下载地址（远程应用）
	SourceID    string            `json:"source_id"`     // 来源ID
	AutoStart   bool              `json:"auto_start"`    // 安装后是否自动启动
}

// InstallApp 安装应用
func InstallApp(c *gin.Context) {
	appID := c.Param("id")

	var req InstallAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("Warning: Failed to bind InstallApp JSON for app %s: %v", appID, err)
	}

	userAppStoreDir := services.GetUsersAppStoreDir()
	isTempFallback := false
	if userAppStoreDir == "" {
		// 解耦下载缓存与持久化存储：降级使用系统默认的临时目录暂存
		userAppStoreDir = filepath.Join(os.TempDir(), "fn_appcenter_cache")
		if err := os.MkdirAll(userAppStoreDir, 0755); err != nil {
			// 优化后端错误返回：如果强制要求或连临时目录都无法创建，返回 40001 特定业务错误码
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    40001,
				"message": "AppStore directory not configured",
			})
			return
		}
		isTempFallback = true
	}

	fpkPath := filepath.Join(userAppStoreDir, appID+".fpk")

	if _, err := os.Stat(fpkPath); os.IsNotExist(err) {
		downloadURL := req.DownloadURL
		if downloadURL == "" {
			downloadURL = findAppDownloadURL(appID, req.SourceID)
		}

		if downloadURL == "" {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "FPK file not found locally and no download URL available",
			})
			return
		}

		if err := downloadFPKFile(appID, downloadURL, fpkPath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":    500,
				"message": fmt.Sprintf("Failed to download FPK: %v", err),
			})
			return
		}
		defer os.Remove(fpkPath)
	} else if isTempFallback {
		// 如果本地已有且是临时目录，安装完成后也进行清理
		defer os.Remove(fpkPath)
	}

	cliPath := getAppCenterCliPath()
	args := []string{"install-fpk", fpkPath}

	// 处理存储池
	if req.VolumeID > 0 {
		args = append(args, "-v", fmt.Sprintf("%d", req.VolumeID))
	}

	// 处理环境变量
	var tempEnvPath string
	if len(req.Env) > 0 {
		// 生成临时 .env 文件
		tempEnvDir := filepath.Join(config.PkgVar, "temp_env")
		os.MkdirAll(tempEnvDir, 0755)
		tempEnvPath = filepath.Join(tempEnvDir, fmt.Sprintf("%s_%d.env", appID, os.Getpid()))

		content := ""
		for k, v := range req.Env {
			content += fmt.Sprintf("%s=%s\n", k, v)
		}
		if err := ioutil.WriteFile(tempEnvPath, []byte(content), 0644); err == nil {
			args = append(args, "-e", tempEnvPath)
			defer os.Remove(tempEnvPath)
		}
	} else if req.EnvFilePath != "" {
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

	// 在执行安装前尝试获取真实的 appname (用于后续启动命令)
	realAppName, extractErr := services.GetAppNameFromFPK(fpkPath)
	if extractErr != nil {
		log.Printf("Warning: Failed to extract appname from manifest: %v, will fallback to appID: %s", extractErr, appID)
		realAppName = appID
	} else {
		log.Printf("Extracted real application name from manifest: %s", realAppName)
	}

	// 在安装/更新前，先尝试停止旧版本应用（如果有的话）
	log.Printf("Ensuring app %s is stopped before (re)installation...", realAppName)
	exec.Command(cliPath, "stop", realAppName).Run()

	cmd := exec.Command(cliPath, args...)
	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	// 只要退出码为0，或者日志中明确包含 "Installation complete"，即视为安装成功
	isSuccess := (err == nil) || strings.Contains(outputStr, "Installation complete")

	if !isSuccess {
		log.Printf("Failed to install app %s: %v, output: %s", appID, err, outputStr)
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": fmt.Sprintf("Installation failed: %v", err),
			"output":  outputStr,
		})
		return
	}

	// 如果设置了自动启动，则执行启动命令 (使用真实的 realAppName)
	if req.AutoStart {
		log.Printf("Waiting 2s for system to settle before auto-starting %s...", realAppName)
		time.Sleep(2 * time.Second)

		log.Printf("Auto-starting app %s after successful installation...", realAppName)
		startCmd := exec.Command(cliPath, "start", realAppName)
		if startOutput, startErr := startCmd.CombinedOutput(); startErr != nil {
			log.Printf("Auto-start failed for %s using appname: %v, output: %s", realAppName, startErr, string(startOutput))
		} else {
			log.Printf("Auto-start successful for %s using appname", realAppName)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Application installed successfully",
		"output":  outputStr,
	})
}

// GetInstallProgress 获取安装/下载进度
func GetInstallProgress(c *gin.Context) {
	appID := c.Param("id")
	if percentage, ok := installProgressMap.Load(appID); ok {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"percentage": percentage,
			},
		})
	} else {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"percentage": -1, // -1 表示任务不存在或已结束
			},
		})
	}
}

func findAppDownloadURL(appID string, sourceID string) string {
	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	for _, source := range sources {
		if sourceID != "" && source.ID != sourceID {
			continue
		}
		if !source.Enabled {
			continue
		}

		var apps []models.App
		if source.Local {
			apps = services.ScanFPKDir(source.URL, source.ID, false)
		} else {
			apps = services.LoadAppsFromSource(&source)
		}

		for _, app := range apps {
			if app.ID == appID && app.DownloadURL != "" {
				return app.DownloadURL
			}
		}
	}
	return ""
}

func downloadFPKFile(appID string, url string, destPath string) error {
	// 任务开始前初始化进度为 0
	installProgressMap.Store(appID, 0)
	defer installProgressMap.Delete(appID) // 任务结束后（无论是 defer 还是手动）删除进度记录

	if strings.HasPrefix(url, "http") {
		url = services.NormalizeURL(url)
		// 配置跳过 SSL 验证的 Transport
		tr := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		}
		client := &http.Client{
			Transport: tr,
			Timeout:   600 * time.Second, // 10 分钟超时
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return err
		}
		req.Header.Set("User-Agent", "FnAppCenter/1.0")

		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("HTTP %d", resp.StatusCode)
		}

		contentLength := resp.ContentLength

		out, err := os.Create(destPath)
		if err != nil {
			return err
		}
		defer out.Close()

		// 创建进度包装器
		pw := &ProgressWriter{
			Total: contentLength,
			OnProgress: func(p int) {
				installProgressMap.Store(appID, p)
			},
		}

		// 执行流式拷贝并计算进度
		written, err := io.Copy(out, io.TeeReader(resp.Body, pw))
		if err != nil {
			return err
		}

		// 简单完整性校验
		if contentLength > 0 && written < contentLength {
			return fmt.Errorf("download incomplete: got %d, want %d", written, contentLength)
		}

	} else {
		srcPath := url
		if !filepath.IsAbs(srcPath) {
			srcPath = filepath.Join(services.GetUsersAppStoreDir(), url)
		}

		if err := copyFile(srcPath, destPath); err != nil {
			return err
		}
		// 本地拷贝瞬时完成，直接设为 100
		installProgressMap.Store(appID, 100)
	}

	// 下载完成后记录下载计数
	// appID 已由参数提供
	go func() {
		sources := services.LoadSources()
		services.DiscoverLocalSources(&sources)
		for _, source := range sources {
			if source.Enabled {
				apps := services.LoadAppsFromSource(&source)
				for _, app := range apps {
					if app.ID == appID {
						services.IncrementDownloadCount(source.ID, appID)
						break
					}
				}
			}
		}
	}()

	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

// StartApp 启动应用
func StartApp(c *gin.Context) {
	appID := c.Param("id")
	realAppName := resolveAppName(appID)

	// Use appcenter-cli to start the app
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "start", realAppName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to start app %s (ID:%s): %v, output: %s", realAppName, appID, err, string(output))
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
	realAppName := resolveAppName(appID)

	// Use appcenter-cli to stop the app
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "stop", realAppName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to stop app %s (ID:%s): %v, output: %s", realAppName, appID, err, string(output))
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
	keepData := c.DefaultQuery("keep_data", "true") == "true"

	cliPath := getAppCenterCliPath()

	// 0. 获取真实的内部应用名称 (从 manifest 读取)
	realAppName := resolveAppName(appID)
	log.Printf("Uninstalling app. ID: %s, RealName: %s, KeepData: %v", appID, realAppName, keepData)

	// 1. 尝试停止应用 (使用真实应用名)
	exec.Command(cliPath, "stop", realAppName).Run()

	// 2. 删除向导卸载配置 (必须在执行标准卸载前清理)
	// 严格基于实应用名去定位安装目录，不再回退/兼容 ID 路径
	uninstallWizardPath := filepath.Join("/var/apps", realAppName, "wizard/uninstall")

	if _, err := os.Stat(uninstallWizardPath); err == nil {
		log.Printf("Deleting wizard uninstall script before CLI uninstall: %s", uninstallWizardPath)
		os.Remove(uninstallWizardPath)
	}

	// 3. 执行标准卸载 (使用真实应用名)
	cmd := exec.Command(cliPath, "uninstall", realAppName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to uninstall app %s (ID:%s): %v, output: %s", realAppName, appID, err, string(output))
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": fmt.Sprintf("Failed to uninstall: %v", err),
			"output":  string(output),
		})
		return
	}

	// 4. 如果不保留数据，则执行深度清理 (使用真实应用名精确匹配)
	if !keepData {
		log.Printf("[Nuke] Starting deep cleanup for realAppName: %s", realAppName)

		// A. 清理 /usr/local/apps 下的 5 个特定目录
		localAppBase := "/usr/local/apps"
		localDirs := []string{"@apptemp", "@apphome", "@appdata", "@appconf", "@appcenter"}
		for _, d := range localDirs {
			target := filepath.Join(localAppBase, d, realAppName)
			if _, err := os.Stat(target); err == nil {
				log.Printf("[Nuke] Deleting local app data: %s", target)
				os.RemoveAll(target)
			}
		}

		// B. 遍历所有存储卷 (vol*) 查找并清理 7 个特定目录
		volDirs := []string{"@apptemp", "@appshare", "@appmeta", "@apphome", "@appdata", "@appconf", "@appcenter"}
		volumes := services.ScanVolumes()
		for _, vol := range volumes {
			for _, d := range volDirs {
				target := filepath.Join(vol.Path, d, realAppName)
				if _, err := os.Stat(target); err == nil {
					log.Printf("[Nuke] Deleting volume app data: %s", target)
					os.RemoveAll(target)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Application uninstalled successfully",
		"output":  string(output),
	})
}

// getInstalledAppName 从已安装路径的 manifest 获取内部应用名
func getInstalledAppName(appID string) string {
	manifestPath := filepath.Join("/var/apps", appID, "manifest")
	data, err := ioutil.ReadFile(manifestPath)
	if err != nil {
		return ""
	}

	content := string(data)
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "appname") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				name := strings.TrimSpace(parts[1])
				if name != "" {
					return name
				}
			}
		}
	}
	return ""
}

// CheckApp 检查应用是否已安装
func CheckApp(c *gin.Context) {
	appID := c.Param("id")

	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "check", appID)
	output, _ := cmd.CombinedOutput()

	outputStr := strings.ToLower(string(output))
	installed := strings.Contains(outputStr, "installed") && !strings.Contains(outputStr, "not")

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"installed": installed,
		},
	})
}

// GetAppStatus 获取应用状态
func GetAppStatus(c *gin.Context) {
	appID := c.Param("id")
	realAppName := resolveAppName(appID)

	// 使用状态缓存服务获取应用状态
	status, err := services.GetAppStatus(realAppName)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"status":    "noinstall",
				"running":   false,
				"installed": false,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"status":    status.Status,
			"running":   status.Running,
			"installed": status.Installed,
		},
	})
}

// RefreshAllStatus 刷新所有应用状态
func RefreshAllStatus(c *gin.Context) {
	err := services.RefreshAllStatus()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"code":    1,
			"message": "刷新状态失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "状态刷新成功",
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

// parseAppListOutput 解析appcenter-cli list命令的输出（表格格式）
func parseAppListOutput(output string) []map[string]string {
	apps := []map[string]string{}
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "┌") || strings.HasPrefix(line, "├") || strings.HasPrefix(line, "└") {
			continue
		}
		if strings.HasPrefix(line, "│") {
			fields := strings.Split(line, "│")
			if len(fields) >= 5 {
				appID := strings.TrimSpace(fields[1])
				appName := strings.TrimSpace(fields[2])
				version := strings.TrimSpace(fields[3])
				status := strings.TrimSpace(fields[4])

				if appID != "APP NAME" && appID != "" {
					apps = append(apps, map[string]string{
						"id":      appID,
						"name":    appName,
						"version": version,
						"status":  status,
					})
				}
			}
		} else if !strings.HasPrefix(line, "ID") && !strings.HasPrefix(line, "-") {
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				apps = append(apps, map[string]string{
					"id":      fields[0],
					"name":    fields[1],
					"version": fields[2],
					"status":  "unknown",
				})
			}
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

// GetAppWizard 获取安装向导配置
func GetAppWizard(c *gin.Context) {
	appID := c.Param("id")
	sourceID := c.Query("source_id")
	downloadURL := c.Query("download_url")

	userAppStoreDir := services.GetUsersAppStoreDir()
	if userAppStoreDir == "" {
		// 降级使用临时目录
		userAppStoreDir = filepath.Join(os.TempDir(), "fn_appcenter_cache")
		if err := os.MkdirAll(userAppStoreDir, 0755); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 40001, "message": "AppStore directory not configured"})
			return
		}
	}

	fpkPath := filepath.Join(userAppStoreDir, appID+".fpk")

	// 如果本地没有，尝试先下载（不删除，因为后续还要安装）
	if _, err := os.Stat(fpkPath); os.IsNotExist(err) {
		if downloadURL == "" {
			downloadURL = findAppDownloadURL(appID, sourceID)
		}
		if downloadURL != "" {
			if err := downloadFPKFile(appID, downloadURL, fpkPath); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to download FPK for wizard: " + err.Error()})
				return
			}
		} else {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "FPK not found and no download URL"})
			return
		}
	}

	config, err := services.ExtractWizardConfig(fpkPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to extract wizard: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": config,
	})
}

// GetVolumes 获取系统储存池
func GetVolumes(c *gin.Context) {
	volumes := services.ScanVolumes()
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": volumes,
	})
}

// RecordAppDownload 记录应用下载
func RecordAppDownload(c *gin.Context) {
	appID := c.Param("id")

	// 加载源列表
	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)

	// 查找包含该应用的源
	var targetSource *models.Source

	for i := range sources {
		if !sources[i].Enabled {
			continue
		}
		apps := services.LoadAppsFromSource(&sources[i])
		for j := range apps {
			if apps[j].ID == appID {
				targetSource = &sources[i]
				break
			}
		}
		if targetSource != nil {
			break
		}
	}

	if targetSource == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"code":    404,
			"message": "Application not found",
		})
		return
	}

	// 更新下载计数
	if err := services.IncrementDownloadCount(targetSource.ID, appID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "Failed to update download count",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Download recorded successfully",
	})
}

// CompareVersions 比较两个版本号字符串
// 返回 1: v1 > v2, 0: v1 == v2, -1: v1 < v2
func CompareVersions(v1, v2 string) int {
	v1 = strings.TrimPrefix(v1, "v")
	v2 = strings.TrimPrefix(v2, "v")
	v1Parts := strings.Split(v1, ".")
	v2Parts := strings.Split(v2, ".")
	length := len(v1Parts)
	if len(v2Parts) > length {
		length = len(v2Parts)
	}

	for i := 0; i < length; i++ {
		var p1, p2 int
		if i < len(v1Parts) {
			fmt.Sscanf(v1Parts[i], "%d", &p1)
		}
		if i < len(v2Parts) {
			fmt.Sscanf(v2Parts[i], "%d", &p2)
		}
		if p1 > p2 {
			return 1
		}
		if p1 < p2 {
			return -1
		}
	}
	return 0
}
