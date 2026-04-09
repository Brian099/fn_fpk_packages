package services

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"

	"appcentre/config"
	"appcentre/models"
)

var (
	sourcesConfig string
	cacheDir      string
	appStoreDir   string
	downloadDir   string
)

func init() {
	// Set default values if environment variables are not set
	appDest := config.AppDest
	if appDest == "" {
		appDest = config.DefaultAppDest
	}
	pkgVar := config.PkgVar
	if pkgVar == "" {
		pkgVar = config.DefaultPkgVar
	}

	sourcesConfig = filepath.Join(pkgVar, "sources.json")
	cacheDir = filepath.Join(pkgVar, "cache")
	appStoreDir = filepath.Join(appDest, "AppStore")
	downloadDir = filepath.Join(appDest, "download")
}

// LoadSources 加载源列表
func LoadSources() []models.Source {
	data, err := ioutil.ReadFile(sourcesConfig)
	if err != nil {
		return []models.Source{}
	}

	var sources []models.Source
	if err := json.Unmarshal(data, &sources); err != nil {
		return []models.Source{}
	}

	return sources
}

// SaveSources 保存源列表
func SaveSources(sources []models.Source) {
	os.MkdirAll(filepath.Dir(sourcesConfig), 0755)
	data, _ := json.MarshalIndent(sources, "", "  ")
	ioutil.WriteFile(sourcesConfig, data, 0644)
}

// DiscoverLocalSources 发现本地源
func DiscoverLocalSources(sources *[]models.Source) {
	// Check application's download directory
	if _, err := os.Stat(downloadDir); !os.IsNotExist(err) {
		scanDirectoryForSources(sources, downloadDir)
	}

	// Check user's AppStore directory in file space
	userAppStoreDir := GetUsersAppStoreDir()
	if userAppStoreDir != "" {
		scanDirectoryForSources(sources, userAppStoreDir)
		// Also scan for FPK files directly
		scanFPKFiles(sources, userAppStoreDir)
	}
}

// GetUsersAppStoreDir 获取用户应用商店目录
func GetUsersAppStoreDir() string {
	appConfig := config.LoadConfig()
	if appConfig.AppStoreDir != "" {
		if _, err := os.Stat(appConfig.AppStoreDir); err == nil {
			log.Printf("getUsersAppStoreDir: Using configured directory: %s", appConfig.AppStoreDir)
			return appConfig.AppStoreDir
		}
		log.Printf("getUsersAppStoreDir: Configured directory not accessible: %s", appConfig.AppStoreDir)
	}
	return ""
}

// LoadAppsFromSource 从源加载应用
func LoadAppsFromSource(sourceID string) []models.App {
	if sourceID == "local_fpk_files" {
		builtin := loadBuiltinCache()
		user := loadUserCache()
		return append(builtin.Apps, user.Apps...)
	}

	cachePath := filepath.Join(cacheDir, sourceID+".json")
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		return parseAndCacheSource(sourceID)
	}

	data, err := ioutil.ReadFile(cachePath)
	if err != nil {
		return []models.App{}
	}

	var apps []models.App
	if err := json.Unmarshal(data, &apps); err != nil {
		return []models.App{}
	}
	return apps
}

// ParseLocalFPKSource 执行本地 FPK 扫描并返回结果
func ParseLocalFPKSource() []models.App {
	builtInApps := LoadBuiltInApps()
	userApps := LoadUserApps()
	return append(builtInApps, userApps...)
}

// LoadBuiltInApps 加载内置应用
func LoadBuiltInApps() []models.App {
	cachedData := loadBuiltinCache()

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

	currentFingerprints := scanFPKDirectory(appStoreDir, fpkFiles)
	allApps := make([]models.App, 0)
	allFingerprints := make(map[string]models.FPKFingerprint)

	for _, fpkFile := range fpkFiles {
		fpkPath := filepath.Join(appStoreDir, fpkFile)
		appID := strings.TrimSuffix(fpkFile, ".fpk")

		currentFp := currentFingerprints[appID]
		cachedFp, exists := cachedData.Fingerprints[appID]

		if exists && cachedFp == currentFp && currentFp.ModTime != 0 {
			cachedApp := findCachedApp(cachedData.Apps, appID)
			if cachedApp != nil {
				allApps = append(allApps, *cachedApp)
				allFingerprints[appID] = currentFp
				continue
			}
		}

		app, err := parseFPKFile(fpkPath)
		if err != nil {
			log.Printf("Failed to parse FPK file %s: %v", fpkFile, err)
			continue
		}
		app.DownloadURL = "/built-in-download/" + app.ID + ".fpk"
		allApps = append(allApps, app)
		allFingerprints[appID] = currentFp
	}

	saveBuiltinCache(allApps, allFingerprints)
	return allApps
}

// LoadUserApps 加载用户应用
func LoadUserApps() []models.App {
	userAppStoreDir := GetUsersAppStoreDir()
	if userAppStoreDir == "" {
		return []models.App{}
	}

	if _, err := os.Stat(userAppStoreDir); os.IsNotExist(err) {
		return []models.App{}
	}

	cachedData := loadUserCache()

	entries, err := os.ReadDir(userAppStoreDir)
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

	currentFingerprints := scanFPKDirectory(userAppStoreDir, fpkFiles)
	allApps := make([]models.App, 0)
	allFingerprints := make(map[string]models.FPKFingerprint)

	for _, fpkFile := range fpkFiles {
		fpkPath := filepath.Join(userAppStoreDir, fpkFile)
		appID := strings.TrimSuffix(fpkFile, ".fpk")

		currentFp := currentFingerprints[appID]
		cachedFp, exists := cachedData.Fingerprints[appID]

		if exists && currentFp.ModTime != 0 && cachedFp == currentFp {
			cachedApp := findCachedApp(cachedData.Apps, appID)
			if cachedApp != nil {
				allApps = append(allApps, *cachedApp)
				allFingerprints[appID] = currentFp
				continue
			}
		}

		app, err := parseFPKFile(fpkPath)
		if err != nil {
			log.Printf("Failed to parse user FPK file %s: %v", fpkFile, err)
			continue
		}
		app.DownloadURL = "/user-download/" + app.ID + ".fpk"
		allApps = append(allApps, app)
		allFingerprints[appID] = currentFp
	}

	saveUserCache(allApps, allFingerprints)
	return allApps
}

// SyncSourceData 同步源数据
func SyncSourceData(source *models.Source) (int, int, int) {
	// 首先加载现有缓存（不扫描）
	oldApps := LoadAppsFromSource(source.ID)

	var newApps []models.App
	if source.ID == "local_fpk_files" {
		// 执行全量扫描并更新缓存
		newApps = ParseLocalFPKSource()
	} else {
		newApps = parseAndCacheSource(source.ID)
	}

	added := 0
	updated := 0
	removed := 0

	oldMap := make(map[string]models.App)
	for _, app := range oldApps {
		oldMap[app.ID] = app
	}

	newMap := make(map[string]models.App)
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
