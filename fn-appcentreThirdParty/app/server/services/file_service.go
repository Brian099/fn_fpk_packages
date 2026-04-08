package services

import (
	"archive/tar"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"appcentre/models"
)

// parseFPKFile 解析FPK文件
func parseFPKFile(fpkPath string) (models.App, error) {
	var app models.App
	app.ID = strings.TrimSuffix(filepath.Base(fpkPath), ".fpk")
	app.DownloadURL = filepath.Base(fpkPath)
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

// scanFPKDirectory 扫描FPK目录
func scanFPKDirectory(baseDir string, fpkFiles []string) map[string]models.FPKFingerprint {
	fingerprints := make(map[string]models.FPKFingerprint)
	for _, fpkFile := range fpkFiles {
		fpkPath := filepath.Join(baseDir, fpkFile)
		info, err := os.Stat(fpkPath)
		if err != nil {
			continue
		}
		appID := strings.TrimSuffix(fpkFile, ".fpk")
		fingerprints[appID] = models.FPKFingerprint{
			ModTime: info.ModTime().Unix(),
			Size:    info.Size(),
		}
	}
	return fingerprints
}

// scanBuiltInAppsDir 扫描内置应用目录
func scanBuiltInAppsDir() []models.App {
	if _, err := os.Stat(appStoreDir); os.IsNotExist(err) {
		return []models.App{}
	}

	entries, err := os.ReadDir(appStoreDir)
	if err != nil {
		return []models.App{}
	}

	var fpkFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".fpk") {
			fpkFiles = append(fpkFiles, entry.Name())
		}
	}

	if len(fpkFiles) == 0 {
		return []models.App{}
	}

	allApps := make([]models.App, 0)
	allFingerprints := make(map[string]models.FPKFingerprint)
	currentFingerprints := scanFPKDirectory(appStoreDir, fpkFiles)

	for _, fpkFile := range fpkFiles {
		fpkPath := filepath.Join(appStoreDir, fpkFile)
		appID := strings.TrimSuffix(fpkFile, ".fpk")

		app, err := parseFPKFile(fpkPath)
		if err != nil {
			log.Printf("Failed to parse builtin FPK file %s: %v", fpkFile, err)
			continue
		}
		app.DownloadURL = "/built-in-download/" + app.ID + ".fpk"
		allApps = append(allApps, app)
		allFingerprints[appID] = currentFingerprints[appID]
	}

	saveBuiltinCache(allApps, allFingerprints)
	return allApps
}

// loadBuiltinCache 加载内置应用缓存
func loadBuiltinCache() models.FPKCacheData {
	cachePath := filepath.Join(cacheDir, "builtin_apps.json")
	data, err := ioutil.ReadFile(cachePath)
	if err != nil {
		return models.FPKCacheData{Fingerprints: make(map[string]models.FPKFingerprint), Apps: []models.App{}}
	}
	var cache models.FPKCacheData
	if err := json.Unmarshal(data, &cache); err != nil {
		return models.FPKCacheData{Fingerprints: make(map[string]models.FPKFingerprint), Apps: []models.App{}}
	}
	if cache.Fingerprints == nil {
		cache.Fingerprints = make(map[string]models.FPKFingerprint)
	}
	return cache
}

// saveBuiltinCache 保存内置应用缓存
func saveBuiltinCache(apps []models.App, fingerprints map[string]models.FPKFingerprint) {
	os.MkdirAll(cacheDir, 0755)
	cacheData := models.FPKCacheData{
		Fingerprints: fingerprints,
		Apps:         apps,
	}
	data, _ := json.MarshalIndent(cacheData, "", "  ")
	ioutil.WriteFile(filepath.Join(cacheDir, "builtin_apps.json"), data, 0644)
}

// loadUserCache 加载用户应用缓存
func loadUserCache() models.FPKCacheData {
	cachePath := filepath.Join(cacheDir, "user_apps.json")
	data, err := ioutil.ReadFile(cachePath)
	if err != nil {
		return models.FPKCacheData{Fingerprints: make(map[string]models.FPKFingerprint), Apps: []models.App{}}
	}
	var cache models.FPKCacheData
	if err := json.Unmarshal(data, &cache); err != nil {
		return models.FPKCacheData{Fingerprints: make(map[string]models.FPKFingerprint), Apps: []models.App{}}
	}
	if cache.Fingerprints == nil {
		cache.Fingerprints = make(map[string]models.FPKFingerprint)
	}
	return cache
}

// saveUserCache 保存用户应用缓存
func saveUserCache(apps []models.App, fingerprints map[string]models.FPKFingerprint) {
	os.MkdirAll(cacheDir, 0755)
	cacheData := models.FPKCacheData{
		Fingerprints: fingerprints,
		Apps:         apps,
	}
	data, _ := json.MarshalIndent(cacheData, "", "  ")
	ioutil.WriteFile(filepath.Join(cacheDir, "user_apps.json"), data, 0644)
}

// findCachedApp 查找缓存的应用
func findCachedApp(apps []models.App, appID string) *models.App {
	for _, app := range apps {
		if app.ID == appID {
			return &app
		}
	}
	return nil
}