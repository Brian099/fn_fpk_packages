package services

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"

	"appcenter/config"
	"appcenter/models"
	"sync"
)

var (
	sourcesConfig string
	cacheDir      string
	appStoreDir   string
	downloadDir   string
	CacheMutex    sync.Mutex // 全局缓存文件访问锁
	SourcesMutex  sync.Mutex // 全局源配置访问锁
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
	// 如果源配置文件不存在，则直接返回空列表
	if _, err := os.Stat(sourcesConfig); os.IsNotExist(err) {
		return []models.Source{}
	}

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
	SourcesMutex.Lock()
	defer SourcesMutex.Unlock()
	saveSources(sources)
}

func saveSources(sources []models.Source) {
	os.MkdirAll(filepath.Dir(sourcesConfig), 0755)
	data, _ := json.MarshalIndent(sources, "", "  ")
	ioutil.WriteFile(sourcesConfig, data, 0644)
}

func saveAppsToCache(sourceID string, apps []models.App, fingerprints map[string]models.FPKFingerprint) {
	// 物理提取图标到 cache/icons 目录
	extractIcons(apps)

	cachePath := filepath.Join(cacheDir, sourceID+".json")
	cacheData := models.FPKCacheData{
		Apps:         apps,
		Fingerprints: fingerprints,
	}
	os.MkdirAll(filepath.Dir(cachePath), 0755)
	data, _ := json.MarshalIndent(cacheData, "", "  ")
	ioutil.WriteFile(cachePath, data, 0644)
}

// extractIcons 将 Base64 图标提取为物理文件
func extractIcons(apps []models.App) {
	iconsDir := filepath.Join(cacheDir, "icons")
	if _, err := os.Stat(iconsDir); os.IsNotExist(err) {
		os.MkdirAll(iconsDir, 0755)
	}

	for i := range apps {
		app := &apps[i]
		if strings.HasPrefix(app.Icon, "data:image") && strings.Contains(app.Icon, "base64,") {
			parts := strings.Split(app.Icon, ",")
			if len(parts) == 2 {
				data, err := base64.StdEncoding.DecodeString(parts[1])
				if err == nil {
					iconPath := filepath.Join(iconsDir, app.ID+".png")
					// 仅在文件不存在时写入，或者可以根据指纹判断是否更新
					if err := ioutil.WriteFile(iconPath, data, 0644); err == nil {
						log.Printf("[Icon] Extracted physical icon for app: %s -> %s", app.ID, iconPath)
						// 优化：提取后可以将内存中的 Icon 替换为标识符，减少内存占用
						// 但为了兼容性，目前先保持原样或标记已提取
					}
				}
			}
		}
	}
}

// DiscoverLocalSources 发现本地源并持久化
func DiscoverLocalSources(sources *[]models.Source) {
	userAppStoreDir := GetUsersAppStoreDir()
	if userAppStoreDir != "" {
		countBefore := len(*sources)
		scanFPKFiles(sources, userAppStoreDir)
		if len(*sources) > countBefore {
			SaveSources(*sources)
			// 如果内存存储已初始化，则同步更新内存，防止数据不一致
			if GlobalStore != nil {
				GlobalStore.UpdateSources(*sources)
			}
		}
	}
}

// ScanVolumes 扫描系统储存池 (/vol*)
func ScanVolumes() []models.StorageVolume {
	var volumes []models.StorageVolume
	// 扫描根目录下的所有 vol* 目录
	entries, err := os.ReadDir("/")
	if err != nil {
		log.Printf("Failed to read root directory: %v", err)
		return volumes
	}

	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "vol") {
			name := entry.Name()
			// 提取序号，例如 vol1 -> 1
			var id int
			_, err := fmt.Sscanf(name, "vol%d", &id)
			if err == nil {
				volumes = append(volumes, models.StorageVolume{
					ID:   id,
					Path: filepath.Join("/", name),
				})
			}
		}
	}
	return volumes
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

	sources := LoadSources()
	for _, source := range sources {
		if source.Local && source.Enabled {
			if _, err := os.Stat(source.URL); err == nil {
				log.Printf("getUsersAppStoreDir: Using local source directory: %s", source.URL)
				return source.URL
			}
		}
	}

	return ""
}

// LoadAppsFromSource 从源加载应用
func LoadAppsFromSource(source *models.Source) []models.App {
	cachePath := filepath.Join(cacheDir, source.ID+".json")

	if source.Local {
		return ScanFPKDir(source.URL, source.ID, false)
	}

	// 远程源：从缓存加载，缓存不存在则请求远程
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		return parseAndCacheSource(source.ID)
	}

	CacheMutex.Lock()
	data, err := ioutil.ReadFile(cachePath)
	CacheMutex.Unlock()

	if err != nil {
		return []models.App{}
	}

	var apps []models.App
	// 首先尝试解析为 FPKCacheData (带指纹的格式)
	var cachedData models.FPKCacheData
	if err := json.Unmarshal(data, &cachedData); err == nil && (len(cachedData.Apps) > 0 || len(cachedData.Fingerprints) > 0) {
		apps = cachedData.Apps
	} else {
		// 降级：尝试解析为纯数组 (老格式或远程源格式)
		if err := json.Unmarshal(data, &apps); err != nil {
			log.Printf("[Store] Failed to unmarshal cache %s: %v", cachePath, err)
			return []models.App{}
		}
	}

	// 注入源名称
	for i := range apps {
		apps[i].SourceName = source.Name
	}

	return apps
}

// ScanFPKDir 扫描指定目录下的 FPK 文件（递归子目录，支持指纹缓存）
func ScanFPKDir(baseDir string, sourceID string, forceRescan bool) []models.App {
	CacheMutex.Lock()
	defer CacheMutex.Unlock()

	if baseDir == "" {
		return []models.App{}
	}

	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		return []models.App{}
	}

	fpkFiles := collectFPKFiles(baseDir)

	// 获取当前指纹
	currentFingerprints := make(map[string]models.FPKFingerprint)
	for _, fpkPath := range fpkFiles {
		info, err := os.Stat(fpkPath)
		if err != nil {
			continue
		}
		appID := strings.TrimSuffix(filepath.Base(fpkPath), ".fpk")
		currentFingerprints[appID] = models.FPKFingerprint{
			ModTime: info.ModTime().Unix(),
			Size:    info.Size(),
		}
	}

	// 加载缓存
	cachePath := filepath.Join(cacheDir, sourceID+".json")
	var cachedData models.FPKCacheData
	if !forceRescan {
		if data, err := ioutil.ReadFile(cachePath); err == nil {
			json.Unmarshal(data, &cachedData)
		}
	}
	if cachedData.Fingerprints == nil {
		cachedData.Fingerprints = make(map[string]models.FPKFingerprint)
	}

	allApps := make([]models.App, 0)
	newFingerprints := make(map[string]models.FPKFingerprint)

	// 处理现有缓存中的应用
	for _, cachedApp := range cachedData.Apps {
		currentFp, exists := currentFingerprints[cachedApp.ID]
		cachedFp, hasCachedFp := cachedData.Fingerprints[cachedApp.ID]

		if !exists {
			// FPK 已删除，跳过
			continue
		}

		newFingerprints[cachedApp.ID] = currentFp

		// 指纹未变化，且 AppName 存在时，才使用缓存
		if !forceRescan && hasCachedFp && currentFp == cachedFp && currentFp.ModTime != 0 && cachedApp.AppName != "" {
			allApps = append(allApps, cachedApp)
			continue
		}

		// 指纹变化或新增，重新解析
		fpkPath := ""
		for _, fp := range fpkFiles {
			if strings.HasPrefix(fp, baseDir) {
				appID := strings.TrimSuffix(filepath.Base(fp), ".fpk")
				if appID == cachedApp.ID {
					fpkPath = fp
					break
				}
			}
		}

		if fpkPath == "" {
			continue
		}

		app, err := ParseFPKFile(fpkPath, baseDir)
		if err != nil {
			log.Printf("Failed to parse FPK file %s: %v", fpkPath, err)
			// 解析失败时保留旧的
			allApps = append(allApps, cachedApp)
			continue
		}
		app.SourceID = sourceID
		// 继承缓存中的元数据
		app.Recommended = cachedApp.Recommended
		app.DownloadCount = cachedApp.DownloadCount
		if len(cachedApp.Labels) > 0 {
			app.Labels = cachedApp.Labels
			app.Categories = cachedApp.Labels
		}
		allApps = append(allApps, app)
	}

	// 处理新增的 FPK（不在缓存中）
	seenIDs := make(map[string]bool)
	for _, app := range allApps {
		seenIDs[app.ID] = true
	}

	for _, fpkPath := range fpkFiles {
		appID := strings.TrimSuffix(filepath.Base(fpkPath), ".fpk")
		if seenIDs[appID] {
			continue
		}
		seenIDs[appID] = true

		app, err := ParseFPKFile(fpkPath, baseDir)
		if err != nil {
			log.Printf("Failed to parse new FPK file %s: %v", fpkPath, err)
			continue
		}
		app.SourceID = sourceID
		app.DownloadCount = 0
		allApps = append(allApps, app)
		newFingerprints[appID] = currentFingerprints[appID]
	}

	// 保存新缓存
	cachedData.Apps = allApps
	cachedData.Fingerprints = newFingerprints
	os.MkdirAll(cacheDir, 0755)
	if data, err := json.MarshalIndent(cachedData, "", "  "); err == nil {
		ioutil.WriteFile(cachePath, data, 0644)
	}

	return allApps
}

// collectFPKFiles 递归收集目录下所有 FPK 文件
func collectFPKFiles(dir string) []string {
	var fpkFiles []string

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fpkFiles
	}

	for _, entry := range entries {
		if entry.IsDir() {
			subDir := filepath.Join(dir, entry.Name())
			subFiles := collectFPKFiles(subDir)
			fpkFiles = append(fpkFiles, subFiles...)
		} else if strings.HasSuffix(strings.ToLower(entry.Name()), ".fpk") {
			fpkFiles = append(fpkFiles, filepath.Join(dir, entry.Name()))
		}
	}

	return fpkFiles
}

// SyncSourceData 同步源数据（彻底清理对比逻辑，仅返回总数）
func SyncSourceData(source *models.Source) int {
	var newApps []models.App
	if source.Local {
		// 对于本地源，强制重新扫描以检测物理文件变动
		newApps = ScanFPKDir(source.URL, source.ID, true)
	} else {
		newApps = parseAndCacheSource(source.ID)
	}

	source.AppCount = len(newApps)
	return source.AppCount
}

// IncrementDownloadCount 递增应用下载计数
func IncrementDownloadCount(sourceID string, appID string) error {
	CacheMutex.Lock()
	defer CacheMutex.Unlock()

	cachePath := filepath.Join(cacheDir, sourceID+".json")

	// 加载缓存
	data, err := ioutil.ReadFile(cachePath)
	if err != nil {
		return err
	}

	// 解析缓存数据
	var cachedData models.FPKCacheData
	if err := json.Unmarshal(data, &cachedData); err != nil {
		return err
	}

	// 查找并更新应用
	found := false
	for i := range cachedData.Apps {
		if cachedData.Apps[i].ID == appID {
			cachedData.Apps[i].DownloadCount++
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("app not found in cache")
	}

	// 保存更新后的缓存
	newData, err := json.MarshalIndent(cachedData, "", "  ")
	if err != nil {
		return err
	}

	return ioutil.WriteFile(cachePath, newData, 0644)
}
