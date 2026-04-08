package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type App struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Version     string   `json:"version"`
	Platform    string   `json:"platform"`
	Categories  []string `json:"categories"`
	Author      string   `json:"author"`
	Publisher   string   `json:"publisher"`
	Size        string   `json:"size"`
	Icon        string   `json:"icon"`
	Screenshots []string `json:"screenshots"`
	DownloadURL string   `json:"download_url"`
	Changelog   string   `json:"changelog"`
	SourceID    string   `json:"source_id"`
}

type Source struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	Enabled    bool   `json:"enabled"`
	AutoUpdate bool   `json:"auto_update"`
	LastSync   string `json:"last_sync"`
	AppCount   int    `json:"app_count"`
	Local      bool   `json:"local"`
}

type FnpackData map[string]FnpackApp

type FnpackApp struct {
	DisplayName    string              `json:"display_name"`
	Platform       interface{}         `json:"platform"`
	Version        string              `json:"version"`
	Desc           string              `json:"desc"`
	Labels         string              `json:"labels"`
	Author         string              `json:"author"`
	AuthorURL      string              `json:"author_url"`
	BugReportURL   string              `json:"bug_report_url"`
	IsDocker       string              `json:"isdocker"`
	InstallType    string              `json:"install_type"`
	Size           string              `json:"size"`
	DownloadURL    string              `json:"download_url"`
	Changelog      string              `json:"changelog"`
	Distributor    string              `json:"distributor"`
	DistributorURL string              `json:"distributor_url"`
	ArchDiff       map[string]ArchDiff `json:"arch_diff"`
}

type ArchDiff struct {
	Version     string `json:"version,omitempty"`
	Desc        string `json:"desc,omitempty"`
	Size        string `json:"size,omitempty"`
	DownloadURL string `json:"download_url,omitempty"`
	Changelog   string `json:"changelog,omitempty"`
}

var (
	sourcesConfig string
	cacheDir      string
	appStoreDir   string
	downloadDir   string
)

func init() {
	// Set default values if environment variables are not set
	appDest := os.Getenv("TRIM_APPDEST")
	if appDest == "" {
		appDest = "/var/apps/fn-appcentreThirdParty/target"
	}
	pkgVar := os.Getenv("TRIM_PKGVAR")
	if pkgVar == "" {
		pkgVar = "/var/apps/fn-appcentreThirdParty/var"
	}

	sourcesConfig = filepath.Join(pkgVar, "sources.json")
	cacheDir = filepath.Join(pkgVar, "cache")
	appStoreDir = filepath.Join(appDest, "AppStore")
	downloadDir = filepath.Join(appDest, "download")
}

func getApps(c *gin.Context) {
	sourceID := c.Query("source")
	category := c.Query("category")
	keyword := c.Query("keyword")

	sources := loadSources()

	// Auto-discover local FPK files source if not already in sources list
	hasLocalFPK := false
	for _, s := range sources {
		if s.ID == "local_fpk_files" {
			hasLocalFPK = true
			break
		}
	}
	if !hasLocalFPK {
		discoverLocalSources(&sources)
		saveSources(sources)
	}

	var allApps []App

	for _, source := range sources {
		if !source.Enabled {
			continue
		}
		if sourceID != "" && source.ID != sourceID {
			continue
		}

		apps := loadAppsFromSource(source.ID)
		allApps = append(allApps, apps...)
	}

	if category != "" {
		var filtered []App
		for _, app := range allApps {
			for _, cat := range app.Categories {
				if strings.Contains(cat, category) {
					filtered = append(filtered, app)
					break
				}
			}
		}
		allApps = filtered
	}

	if keyword != "" {
		var filtered []App
		lowerKeyword := strings.ToLower(keyword)
		for _, app := range allApps {
			if strings.Contains(strings.ToLower(app.Name), lowerKeyword) ||
				strings.Contains(strings.ToLower(app.Description), lowerKeyword) {
				filtered = append(filtered, app)
			}
		}
		allApps = filtered
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"total": len(allApps),
			"apps":  allApps,
		},
	})
}

func getAppDetail(c *gin.Context) {
	appID := c.Param("id")

	sources := loadSources()
	for _, source := range sources {
		if !source.Enabled {
			continue
		}
		apps := loadAppsFromSource(source.ID)
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

func getAppIcon(c *gin.Context) {
	appID := c.Param("id")

	// First try to get icon from cache
	iconCachePath := filepath.Join(cacheDir, "icons", appID+".png")
	if _, err := os.Stat(iconCachePath); err == nil {
		c.File(iconCachePath)
		return
	}

	// Fallback to app store directory
	iconPath := filepath.Join(appStoreDir, appID, "ICON.PNG")
	if _, err := os.Stat(iconPath); os.IsNotExist(err) {
		c.String(http.StatusNotFound, "Icon not found")
		return
	}

	c.File(iconPath)
}

func installApp(c *gin.Context) {
	appID := c.Param("id")

	// Find the FPK file
	userAppStoreDir := getUsersAppStoreDir()
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
	cmd := exec.Command("appcenter-cli", "install-fpk", fpkPath)
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

func startApp(c *gin.Context) {
	appID := c.Param("id")

	// Use appcenter-cli to start the app
	cmd := exec.Command("appcenter-cli", "start", appID)
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

func stopApp(c *gin.Context) {
	appID := c.Param("id")

	// Use appcenter-cli to stop the app
	cmd := exec.Command("appcenter-cli", "stop", appID)
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

func uninstallApp(c *gin.Context) {
	appID := c.Param("id")

	// First stop the app if it's running
	exec.Command("appcenter-cli", "stop", appID).Run()

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

func getAppStatus(c *gin.Context) {
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
	if data, err := ioutil.ReadFile(pidFile); err == nil {
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

func getSources(c *gin.Context) {
	sources := loadSources()

	discoverLocalSources(&sources)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"sources": sources,
		},
	})
}

func addSource(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
		URL  string `json:"url" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "Invalid request: " + err.Error(),
		})
		return
	}

	sources := loadSources()

	newSource := Source{
		ID:         fmt.Sprintf("source_%d", len(sources)+1),
		Name:       req.Name,
		URL:        req.URL,
		Enabled:    true,
		AutoUpdate: true,
		LastSync:   "",
		AppCount:   0,
		Local:      false,
	}

	sources = append(sources, newSource)

	saveSources(sources)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": newSource,
	})
}

func deleteSource(c *gin.Context) {
	sourceID := c.Param("id")

	sources := loadSources()
	var newSources []Source

	for _, source := range sources {
		if source.ID != sourceID {
			newSources = append(newSources, source)
		}
	}

	saveSources(newSources)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Source deleted successfully",
	})
}

func syncSource(c *gin.Context) {
	sourceID := c.Param("id")

	// Special handling for local_fpk_files source
	if sourceID == "local_fpk_files" {
		userAppStoreDir := getUsersAppStoreDir()
		if userAppStoreDir == "" {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":    500,
				"message": "AppStore directory not configured",
			})
			return
		}

		// Re-scan FPK files
		entries, err := os.ReadDir(userAppStoreDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":    500,
				"message": "Failed to read AppStore directory",
			})
			return
		}

		var fpkFiles []string
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".fpk") {
				fpkFiles = append(fpkFiles, entry.Name())
			}
		}

		// Parse FPK files and cache them
		parseFPKFilesToCache(userAppStoreDir, fpkFiles)

		c.JSON(http.StatusOK, gin.H{
			"code":    0,
			"message": "Local FPK files synced successfully",
			"data": gin.H{
				"added":   len(fpkFiles),
				"updated": 0,
				"removed": 0,
			},
		})
		return
	}

	sources := loadSources()
	var targetSource *Source
	for i := range sources {
		if sources[i].ID == sourceID {
			targetSource = &sources[i]
			break
		}
	}

	if targetSource == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"code":    404,
			"message": "Source not found",
		})
		return
	}

	added, updated, removed := syncSourceData(targetSource)

	targetSource.LastSync = time.Now().Format(time.RFC3339)
	saveSources(sources)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Source synced successfully",
		"data": gin.H{
			"added":   added,
			"updated": updated,
			"removed": removed,
		},
	})
}

func loadSources() []Source {
	data, err := ioutil.ReadFile(sourcesConfig)
	if err != nil {
		return []Source{}
	}

	var sources []Source
	if err := json.Unmarshal(data, &sources); err != nil {
		return []Source{}
	}

	return sources
}

func saveSources(sources []Source) {
	os.MkdirAll(filepath.Dir(sourcesConfig), 0755)
	data, _ := json.MarshalIndent(sources, "", "  ")
	ioutil.WriteFile(sourcesConfig, data, 0644)
}

func discoverLocalSources(sources *[]Source) {
	// Check application's download directory
	if _, err := os.Stat(downloadDir); !os.IsNotExist(err) {
		scanDirectoryForSources(sources, downloadDir)
	}

	// Check user's AppStore directory in file space
	userAppStoreDir := getUsersAppStoreDir()
	if userAppStoreDir != "" {
		scanDirectoryForSources(sources, userAppStoreDir)
		// Also scan for FPK files directly
		scanFPKFiles(sources, userAppStoreDir)
	}
}

func getUsersAppStoreDir() string {
	log.Printf("getUsersAppStoreDir: config.AppStoreDir = '%s'", config.AppStoreDir)

	// 优先使用配置文件中的目录
	if config.AppStoreDir != "" {
		if _, err := os.Stat(config.AppStoreDir); err == nil {
			log.Printf("getUsersAppStoreDir: Using configured directory: %s", config.AppStoreDir)
			return config.AppStoreDir
		} else {
			log.Printf("getUsersAppStoreDir: Configured directory not accessible: %s, error: %v", config.AppStoreDir, err)
		}
	}

	// 尝试查找用户文件空间中的 AppStore 目录
	userFilesDirs := []string{
		"/vol1/我的文件/AppStore",
	}

	// 尝试所有卷目录
	volumes, err := filepath.Glob("/vol*")
	if err == nil {
		for _, vol := range volumes {
			userFilesDirs = append(userFilesDirs, filepath.Join(vol, "我的文件", "AppStore"))
			// Also check /volX/1000/AppStore pattern
			userFilesDirs = append(userFilesDirs, filepath.Join(vol, "1000", "AppStore"))
		}
	}

	log.Printf("getUsersAppStoreDir: Checking directories: %v", userFilesDirs)

	// 返回第一个存在的目录
	for _, dir := range userFilesDirs {
		if _, err := os.Stat(dir); err == nil {
			log.Printf("getUsersAppStoreDir: Found directory: %s", dir)
			return dir
		}
	}

	log.Printf("getUsersAppStoreDir: No AppStore directory found!")
	return ""
}

func scanDirectoryForSources(sources *[]Source, baseDir string) {
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		sourceDir := filepath.Join(baseDir, entry.Name())
		fnpackPath := filepath.Join(sourceDir, "fnpack.json")
		if _, err := os.Stat(fnpackPath); os.IsNotExist(err) {
			continue
		}

		exists := false
		for _, source := range *sources {
			if source.ID == entry.Name() && source.Local {
				exists = true
				break
			}
		}

		if !exists {
			localSource := Source{
				ID:         entry.Name(),
				Name:       entry.Name(),
				URL:        "http://localhost:18088/download/" + entry.Name(),
				Enabled:    true,
				AutoUpdate: true,
				LastSync:   "",
				Local:      true,
			}
			*sources = append(*sources, localSource)
		}
	}
}

func scanFPKFiles(sources *[]Source, baseDir string) {
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		log.Printf("Failed to read directory %s: %v", baseDir, err)
		return
	}

	var fpkFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".fpk") {
			fpkFiles = append(fpkFiles, entry.Name())
		}
	}

	if len(fpkFiles) == 0 {
		return
	}

	// Check if local FPK source already exists
	sourceID := "local_fpk_files"
	exists := false
	for _, source := range *sources {
		if source.ID == sourceID && source.Local {
			exists = true
			break
		}
	}

	if !exists {
		localSource := Source{
			ID:         sourceID,
			Name:       "本地 FPK 文件",
			URL:        baseDir,
			Enabled:    true,
			AutoUpdate: false,
			LastSync:   "",
			Local:      true,
			AppCount:   len(fpkFiles),
		}
		*sources = append(*sources, localSource)
		log.Printf("Added local FPK source with %d files", len(fpkFiles))
	}

	// Parse FPK files and cache them
	parseFPKFilesToCache(baseDir, fpkFiles)
}

func parseFPKFilesToCache(baseDir string, fpkFiles []string) {
	var apps []App

	for _, fpkFile := range fpkFiles {
		fpkPath := filepath.Join(baseDir, fpkFile)
		app, err := parseFPKFile(fpkPath)
		if err != nil {
			log.Printf("Failed to parse FPK file %s: %v", fpkFile, err)
			continue
		}
		apps = append(apps, app)
	}

	// Cache the apps
	if len(apps) > 0 {
		os.MkdirAll(cacheDir, 0755)
		cacheData, _ := json.MarshalIndent(apps, "", "  ")
		cachePath := filepath.Join(cacheDir, "local_fpk_files.json")
		ioutil.WriteFile(cachePath, cacheData, 0644)
		log.Printf("Cached %d apps from local FPK files", len(apps))
	}
}

func parseFPKFile(fpkPath string) (App, error) {
	var app App
	app.ID = strings.TrimSuffix(filepath.Base(fpkPath), ".fpk")
	app.DownloadURL = "/download/" + filepath.Base(fpkPath)
	app.SourceID = "local_fpk_files"

	// Get file info for size
	if info, err := os.Stat(fpkPath); err == nil {
		sizeMB := float64(info.Size()) / 1024 / 1024
		app.Size = fmt.Sprintf("%.2f", sizeMB)
	}

	// Try to get app info from appcenter-cli first
	cmd := exec.Command("appcenter-cli", "list")
	output, err := cmd.Output()
	if err == nil {
		// Parse appcenter-cli list output
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if strings.Contains(line, app.ID) {
				// Found installed app, get info from system
				app.Name = app.ID
				app.Version = "installed"
				app.Platform = "x86"
				app.Description = "已安装的应用"
				app.Categories = []string{"已安装"}
				return app, nil
			}
		}
	}

	// Fallback: Parse FPK file (tar.gz format)
	file, err := os.Open(fpkPath)
	if err != nil {
		log.Printf("Failed to open FPK file %s: %v", fpkPath, err)
		app.Name = app.ID
		app.Version = "unknown"
		app.Platform = "x86"
		app.Description = "FPK 应用包"
		app.Categories = []string{"其他"}
		return app, nil
	}
	defer file.Close()

	// Create gzip reader
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		log.Printf("Failed to create gzip reader for %s: %v", fpkPath, err)
		app.Name = app.ID
		app.Version = "unknown"
		app.Platform = "x86"
		app.Description = "FPK 应用包"
		app.Categories = []string{"其他"}
		return app, nil
	}
	defer gzipReader.Close()

	// Create tar reader - read from OUTER tar (manifest is here, not inside app.tgz!)
	tarReader := tar.NewReader(gzipReader)

	// Parse manifest file from outer tar
	manifestData := make(map[string]string)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("Failed to read tar entry in %s: %v", fpkPath, err)
			break
		}

		log.Printf("Found file in FPK: %s (size: %d)", header.Name, header.Size)

		if header.Name == "manifest" {
			data, err := ioutil.ReadAll(tarReader)
			if err != nil {
				log.Printf("Failed to read manifest in %s: %v", fpkPath, err)
				continue
			}

			log.Printf("Found manifest in %s, size: %d bytes", fpkPath, len(data))

			// Parse manifest file (INI-like format)
			lines := strings.Split(string(data), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					key := strings.TrimSpace(parts[0])
					value := strings.TrimSpace(parts[1])
					manifestData[key] = value
					log.Printf("Manifest: %s = %s", key, value)
				}
			}
		} else if header.Name == "ui/images/icon-256.png" || header.Name == "ICON_256.PNG" || header.Name == "icon-256.png" {
			iconData, err := ioutil.ReadAll(tarReader)
			if err == nil && len(iconData) > 0 {
				iconBase64 := base64.StdEncoding.EncodeToString(iconData)
				app.Icon = "data:image/png;base64," + iconBase64
				log.Printf("Found icon-256.png in %s, size: %d bytes", fpkPath, len(iconData))
			}
		} else if header.Name == "ui/images/icon-64.png" || header.Name == "ICON_64.PNG" || header.Name == "icon-64.png" {
			// Skip small icon if we already have 256
			if app.Icon == "" {
				iconData, err := ioutil.ReadAll(tarReader)
				if err == nil && len(iconData) > 0 {
					iconBase64 := base64.StdEncoding.EncodeToString(iconData)
					app.Icon = "data:image/png;base64," + iconBase64
					log.Printf("Found icon-64.png in %s, size: %d bytes", fpkPath, len(iconData))
				}
			}
		} else if header.Name == "config/privilege" {
			privilegeData, err := ioutil.ReadAll(tarReader)
			if err == nil && len(privilegeData) > 0 {
				log.Printf("Found privilege config in %s", fpkPath)
				// Could parse privilege info if needed
			}
		}
		// Skip app.tgz and other large files - we don't need them for metadata
		if header.Size > 1024*1024*10 { // Skip files larger than 10MB
			io.CopyN(io.Discard, tarReader, header.Size)
		}
	}

	// Extract app info from manifest
	if displayName, ok := manifestData["display_name"]; ok && displayName != "" {
		app.Name = displayName
	} else if appname, ok := manifestData["appname"]; ok && appname != "" {
		app.Name = appname
	} else {
		app.Name = app.ID
	}

	if version, ok := manifestData["version"]; ok && version != "" {
		app.Version = version
	} else {
		app.Version = "unknown"
	}

	if platform, ok := manifestData["platform"]; ok && platform != "" {
		app.Platform = platform
	} else {
		app.Platform = "x86"
	}

	if desc, ok := manifestData["desc"]; ok && desc != "" {
		app.Description = desc
	} else if description, ok := manifestData["description"]; ok && description != "" {
		app.Description = description
	} else {
		app.Description = "FPK 应用包"
	}

	if maintainer, ok := manifestData["maintainer"]; ok && maintainer != "" {
		app.Author = maintainer
	} else if author, ok := manifestData["author"]; ok && author != "" {
		app.Author = author
	}

	if distributor, ok := manifestData["distributor"]; ok && distributor != "" {
		app.Publisher = distributor
	} else if publisher, ok := manifestData["publisher"]; ok && publisher != "" {
		app.Publisher = publisher
	}

	if labels, ok := manifestData["labels"]; ok && labels != "" {
		app.Categories = strings.Split(labels, ",")
		for i := range app.Categories {
			app.Categories[i] = strings.TrimSpace(app.Categories[i])
		}
	} else if categories, ok := manifestData["categories"]; ok && categories != "" {
		app.Categories = strings.Split(categories, ",")
		for i := range app.Categories {
			app.Categories[i] = strings.TrimSpace(app.Categories[i])
		}
	} else {
		app.Categories = []string{"其他"}
	}

	return app, nil
}

func loadAppsFromSource(sourceID string) []App {
	log.Printf("loadAppsFromSource: sourceID = %s", sourceID)
	cachePath := filepath.Join(cacheDir, sourceID+".json")

	// Special handling for local_fpk_files source - always re-parse to get fresh data
	if sourceID == "local_fpk_files" {
		userAppStoreDir := getUsersAppStoreDir()
		log.Printf("loadAppsFromSource: userAppStoreDir = '%s'", userAppStoreDir)
		if userAppStoreDir == "" {
			// Try to load from cache if directory not configured
			if data, err := ioutil.ReadFile(cachePath); err == nil {
				var apps []App
				if json.Unmarshal(data, &apps) == nil {
					return apps
				}
			}
			return []App{}
		}

		// Scan and parse FPK files (always re-parse for fresh metadata)
		entries, err := os.ReadDir(userAppStoreDir)
		if err != nil {
			// Fallback to cache on error
			if data, err := ioutil.ReadFile(cachePath); err == nil {
				var apps []App
				if json.Unmarshal(data, &apps) == nil {
					return apps
				}
			}
			return []App{}
		}

		var fpkFiles []string
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".fpk") {
				fpkFiles = append(fpkFiles, entry.Name())
			}
		}

		parseFPKFilesToCache(userAppStoreDir, fpkFiles)

		// Load freshly cached data
		data, err := ioutil.ReadFile(cachePath)
		if err != nil {
			return []App{}
		}
		var apps []App
		if err := json.Unmarshal(data, &apps); err != nil {
			return []App{}
		}
		return apps
	}

	// For other sources, use cache
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		return parseAndCacheSource(sourceID)
	}

	data, err := ioutil.ReadFile(cachePath)
	if err != nil {
		return []App{}
	}

	var apps []App
	if err := json.Unmarshal(data, &apps); err != nil {
		return []App{}
	}

	return apps
}

func parseAndCacheSource(sourceID string) []App {
	sources := loadSources()
	var targetSource *Source
	for i := range sources {
		if sources[i].ID == sourceID {
			targetSource = &sources[i]
			break
		}
	}

	if targetSource == nil {
		return []App{}
	}

	var fnpackPath string
	if targetSource.Local {
		fnpackPath = filepath.Join(downloadDir, sourceID, "fnpack.json")
	} else {
		url := strings.TrimRight(targetSource.URL, "/") + "/fnpack.json"
		resp, err := http.Get(url)
		if err != nil {
			log.Printf("Failed to fetch fnpack.json from %s: %v", url, err)
			return []App{}
		}
		defer resp.Body.Close()

		os.MkdirAll(cacheDir, 0755)
		tmpPath := filepath.Join(cacheDir, sourceID+"_fnpack.json.tmp")
		data, _ := ioutil.ReadAll(resp.Body)
		ioutil.WriteFile(tmpPath, data, 0644)
		fnpackPath = tmpPath
	}

	data, err := ioutil.ReadFile(fnpackPath)
	if err != nil {
		log.Printf("Failed to read fnpack.json: %v", err)
		return []App{}
	}

	var fnpackData FnpackData
	if err := json.Unmarshal(data, &fnpackData); err != nil {
		log.Printf("Failed to parse fnpack.json: %v", err)
		return []App{}
	}

	var apps []App
	for appName, fnpackApp := range fnpackData {
		app := convertToApp(appName, fnpackApp, sourceID)
		apps = append(apps, app)
	}

	os.MkdirAll(cacheDir, 0755)
	cacheData, _ := json.MarshalIndent(apps, "", "  ")
	ioutil.WriteFile(filepath.Join(cacheDir, sourceID+".json"), cacheData, 0644)

	return apps
}

func convertToApp(appName string, fnpackApp FnpackApp, sourceID string) App {
	platform := "x86"
	switch p := fnpackApp.Platform.(type) {
	case string:
		if p != "" {
			platform = p
		}
	case []interface{}:
		if len(p) > 0 {
			platform = p[0].(string)
		}
	}

	version := fnpackApp.Version
	size := fnpackApp.Size
	desc := fnpackApp.Desc
	downloadURL := fnpackApp.DownloadURL
	changelog := fnpackApp.Changelog

	if fnpackApp.ArchDiff != nil {
		if archDiff, ok := fnpackApp.ArchDiff[platform]; ok {
			if archDiff.Version != "" {
				version = archDiff.Version
			}
			if archDiff.Size != "" {
				size = archDiff.Size
			}
			if archDiff.Desc != "" {
				desc = archDiff.Desc
			}
			if archDiff.DownloadURL != "" {
				downloadURL = archDiff.DownloadURL
			}
			if archDiff.Changelog != "" {
				changelog = archDiff.Changelog
			}
		}
	}

	if downloadURL == "" {
		downloadURL = fmt.Sprintf("/download/%s/%s.fpk", sourceID, appName)
	}

	categories := []string{}
	if fnpackApp.Labels != "" {
		categories = strings.Split(fnpackApp.Labels, ",")
	}

	publisher := fnpackApp.Distributor
	if publisher == "" {
		publisher = fnpackApp.Author
	}

	iconPath := filepath.Join(appStoreDir, appName, "ICON.PNG")
	icon := ""
	if _, err := os.Stat(iconPath); !os.IsNotExist(err) {
		icon = "/AppStore/" + appName + "/ICON.PNG"
	}

	return App{
		ID:          appName,
		Name:        fnpackApp.DisplayName,
		Description: desc,
		Version:     version,
		Platform:    platform,
		Categories:  categories,
		Author:      fnpackApp.Author,
		Publisher:   publisher,
		Size:        size,
		Icon:        icon,
		DownloadURL: downloadURL,
		Changelog:   changelog,
		SourceID:    sourceID,
	}
}

func syncSourceData(source *Source) (int, int, int) {
	oldApps := loadAppsFromSource(source.ID)

	var newApps []App
	if source.ID == "local_fpk_files" {
		// For local FPK files, re-scan the directory
		userAppStoreDir := getUsersAppStoreDir()
		if userAppStoreDir != "" {
			entries, err := os.ReadDir(userAppStoreDir)
			if err == nil {
				var fpkFiles []string
				for _, entry := range entries {
					if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".fpk") {
						fpkFiles = append(fpkFiles, entry.Name())
					}
				}
				parseFPKFilesToCache(userAppStoreDir, fpkFiles)
				newApps = loadAppsFromSource(source.ID)
			}
		}
	} else {
		newApps = parseAndCacheSource(source.ID)
	}

	added := 0
	updated := 0
	removed := 0

	oldMap := make(map[string]App)
	for _, app := range oldApps {
		oldMap[app.ID] = app
	}

	newMap := make(map[string]App)
	for _, app := range newApps {
		newMap[app.ID] = app
	}

	for id := range newMap {
		if _, exists := oldMap[id]; !exists {
			added++
		} else if oldMap[id].Version != newMap[id].Version {
			updated++
		}
	}

	for id := range oldMap {
		if _, exists := newMap[id]; !exists {
			removed++
		}
	}

	source.AppCount = len(newApps)

	return added, updated, removed
}
