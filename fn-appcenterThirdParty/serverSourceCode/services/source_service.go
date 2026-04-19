package services

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"


	"appcenter/models"
)

// scanFPKFiles 扫描FPK文件（递归子目录）
func scanFPKFiles(sources *[]models.Source, baseDir string) {
	fpkFiles := collectFPKFiles(baseDir)

	if len(fpkFiles) == 0 {
		return
	}

	// 查找是否已存在本地源
	localSourceIdx := -1
	for i, source := range *sources {
		if source.Local {
			localSourceIdx = i
			break
		}
	}

	if localSourceIdx != -1 {
		// 如果本地源路径发生了变化，更新它
		if (*sources)[localSourceIdx].URL != baseDir {
			log.Printf("Updating local FPK source from %s to %s", (*sources)[localSourceIdx].URL, baseDir)
			(*sources)[localSourceIdx].URL = baseDir
			(*sources)[localSourceIdx].ID = "local_" + filepath.Base(baseDir)
			(*sources)[localSourceIdx].AppCount = len(fpkFiles)
			// 此处外部 DiscoverLocalSources 会调用 SaveSources
		}
	} else {
		// 不存在则添加唯一的本地源
		localSource := models.Source{
			ID:         "local_" + filepath.Base(baseDir),
			Name:       "本地 FPK 文件",
			URL:        baseDir,
			Enabled:    true,
			AutoUpdate: false,
			LastSync:   "",
			Local:      true,
			AppCount:   len(fpkFiles),
		}
		*sources = append(*sources, localSource)
		log.Printf("Added local FPK source from %s with %d files", baseDir, len(fpkFiles))
	}
}

// parseAndCacheSource 解析并缓存源
func parseAndCacheSource(sourceID string) []models.App {
	CacheMutex.Lock()
	defer CacheMutex.Unlock()

	sources := LoadSources()
	var targetSource *models.Source
	for i := range sources {
		if sources[i].ID == sourceID {
			targetSource = &sources[i]
			break
		}
	}

	if targetSource == nil {
		return []models.App{}
	}

	var apps []models.App
	if targetSource.Local {
		apps = ScanFPKDir(targetSource.URL, sourceID, false)
		return apps
	}

	url := NormalizeURL(targetSource.URL)

	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "FnAppCenter/1.0")
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Failed to fetch fnpack.json from %s: %v", url, err)
		return []models.App{}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Failed to fetch fnpack.json from %s: HTTP %d", url, resp.StatusCode)
		return []models.App{}
	}

	os.MkdirAll(cacheDir, 0755)
	tmpPath := filepath.Join(cacheDir, sourceID+"_fnpack.json.tmp")
	data, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Failed to read response body from %s: %v", url, err)
		return []models.App{}
	}

	trimmedData := strings.TrimSpace(string(data))

	if strings.HasPrefix(trimmedData, "<") {
		log.Printf("Received HTML instead of JSON from %s", url)
		return []models.App{}
	}

	if err := ioutil.WriteFile(tmpPath, data, 0644); err != nil {
		log.Printf("Failed to write temporary fnpack.json: %v", err)
		return []models.App{}
	}

	if strings.HasPrefix(trimmedData, "{\"code\":") {
		apps = parseLocalShareFormat(tmpPath, sourceID)
	} else {
		apps = parseFnpackFormat(tmpPath, sourceID)
	}

	if len(apps) > 0 {
		os.MkdirAll(cacheDir, 0755)
		cachePath := filepath.Join(cacheDir, sourceID+".json")

		// 尝试合并旧的元数据（推荐状态、标签、下载量）
		if oldData, err := ioutil.ReadFile(cachePath); err == nil {
			var oldApps []models.App
			if err := json.Unmarshal(oldData, &oldApps); err == nil {
				oldMap := make(map[string]models.App)
				for _, oa := range oldApps {
					oldMap[oa.ID] = oa
				}
				for i := range apps {
					if oa, ok := oldMap[apps[i].ID]; ok {
						// 继承下载量
						apps[i].DownloadCount = oa.DownloadCount
						// 继承本地设定的推荐状态（自荐模式：源端如果是 Recommended，本地也接受；本地如果是 Recommended，更新后也保留）
						if oa.Recommended {
							apps[i].Recommended = true
						}
						// 继承分类标签
						if len(oa.Labels) > 0 {
							apps[i].Labels = oa.Labels
							apps[i].Categories = oa.Labels
						}
					}
				}
			}
		}

		cacheData, _ := json.MarshalIndent(apps, "", "  ")
		ioutil.WriteFile(cachePath, cacheData, 0644)
	}

	return apps
}

func parseLocalShareFormat(tmpPath string, sourceID string) []models.App {
	data, err := ioutil.ReadFile(tmpPath)
	if err != nil {
		log.Printf("Failed to read local share file: %v", err)
		return []models.App{}
	}

	var response struct {
		Code int `json:"code"`
		Data struct {
			Apps []models.App `json:"apps"`
		} `json:"data"`
	}

	if err := json.Unmarshal(data, &response); err != nil {
		log.Printf("Failed to parse local share format: %v", err)
		return []models.App{}
	}

	if response.Code != 0 {
		log.Printf("Local share returned error code: %d", response.Code)
		return []models.App{}
	}

	for i := range response.Data.Apps {
		response.Data.Apps[i].SourceID = sourceID
	}

	return response.Data.Apps
}

func parseFnpackFormat(tmpPath string, sourceID string) []models.App {
	fnpackData := new(models.FnpackData)
	fnpackFile, err := os.Open(tmpPath)
	if err != nil {
		log.Printf("Failed to open fnpack.json: %v", err)
		return []models.App{}
	}
	defer fnpackFile.Close()

	if err := json.NewDecoder(fnpackFile).Decode(fnpackData); err != nil {
		log.Printf("Failed to parse fnpack.json: %v", err)
		return []models.App{}
	}

	apps := make([]models.App, 0)
	for appName, fnpackApp := range *fnpackData {
		app := rebuildToApp(appName, fnpackApp, sourceID)
		apps = append(apps, app)
	}

	return apps
}

// cleanPersonName 清洗人名字段，移除混入的 URL 部分
// 例如 "Giraff https://giraff.fun" → "Giraff"
func cleanPersonName(s string) string {
	if idx := strings.Index(s, " http"); idx > 0 {
		return strings.TrimSpace(s[:idx])
	}
	return s
}

// rebuildToApp 将 FnpackApp 重建为标准 models.App 格式
// 输出与 Laok NAS API（{"code":0,"data":{"apps":[...]}}）字段格式完全对齐
func rebuildToApp(appKey string, fnpackApp models.FnpackApp, sourceID string) models.App {
	// 1. platform 处理（interface{} 兼容 string 和 []interface{} 两种形式）
	platform := "x86"
	switch p := fnpackApp.Platform.(type) {
	case string:
		if p != "" {
			platform = p
		}
	case []interface{}:
		if len(p) > 0 {
			platform = fmt.Sprintf("%v", p[0])
		}
	}

	// 2. 从 arch_diff 提取平台特定覆盖字段（保留原有架构差异逻辑）
	version     := fnpackApp.Version
	size        := fnpackApp.Size
	desc        := fnpackApp.Desc
	downloadURL := fnpackApp.DownloadURL
	changelog   := fnpackApp.Changelog

	if fnpackApp.ArchDiff != nil {
		if archDiff, ok := fnpackApp.ArchDiff[platform]; ok {
			if archDiff.Version != ""     { version     = archDiff.Version }
			if archDiff.Size != ""        { size        = archDiff.Size }
			if archDiff.Desc != ""        { desc        = archDiff.Desc }
			if archDiff.DownloadURL != "" { downloadURL = archDiff.DownloadURL }
			if archDiff.Changelog != ""   { changelog   = archDiff.Changelog }
		}
	}

	// 3. version 标准化：统一去除 v/V 前缀（"v1.0.22" / "V1.0.28" → "1.0.22" / "1.0.28"）
	version = strings.TrimPrefix(strings.TrimPrefix(version, "V"), "v")

	// 4. size 清洗：去除前导/尾随空格（RROrg 源存在 " 3.082" 格式）
	size = strings.TrimSpace(size)

	// 5. download_url 处理：
	//    - blob 链接 → raw 直链（修复 Gitee 源所有应用安装失败的问题）
	//    - 空链接 → 生成本地占位路径
	downloadURL = NormalizeURL(downloadURL)
	if downloadURL == "" {
		downloadURL = fmt.Sprintf("/download/%s/%s.fpk", sourceID, appKey)
	}

	// 6. changelog 兜底：changelog 为空时从 history 提取当前版本更新说明
	//    兼容 "v1.0.22" 和 "1.0.22" 两种 key 格式
	if changelog == "" && len(fnpackApp.History) > 0 {
		if v, ok := fnpackApp.History["v"+version]; ok {
			changelog = v
		} else if v, ok := fnpackApp.History[version]; ok {
			changelog = v
		}
	}

	// 7. categories / labels：逗号分隔字符串 → []string，两者保持完全一致
	categories := []string{}
	if fnpackApp.Labels != "" {
		for _, part := range strings.Split(fnpackApp.Labels, ",") {
			if t := strings.TrimSpace(part); t != "" {
				categories = append(categories, t)
			}
		}
	}

	// 8. author / publisher 清洗：去除 "Name https://..." 中混入的 URL 部分
	author    := cleanPersonName(fnpackApp.Author)
	publisher := cleanPersonName(fnpackApp.Distributor)
	if publisher == "" {
		publisher = author
	}

	// 9. icon 优先级：本地 ICON.PNG > fnpack 的 icon 字段（远程 URL）> 空
	//    本地文件优先，确保管理员自定义图标始终生效
	//    远程 icon 同样经过 NormalizeURL，兼容 Gitee blob 链接
	iconPath := filepath.Join(appStoreDir, appKey, "ICON.PNG")
	icon := NormalizeURL(fnpackApp.Icon) // 先取远程 icon 并规范化（blob→raw，空值不变）
	if _, err := os.Stat(iconPath); !os.IsNotExist(err) {
		icon = "/AppStore/" + appKey + "/ICON.PNG" // 本地存在则覆盖
	}

	return models.App{
		ID:            appKey,
		AppName:       appKey,
		Name:          fnpackApp.DisplayName,
		Description:   desc,
		Version:       version,
		Platform:      platform,
		Categories:    categories,
		Labels:        categories, // 与 Laok NAS 格式保持一致：labels == categories
		Author:        author,
		Publisher:     publisher,
		Size:          size,
		Icon:          icon,
		Screenshots:   nil,
		DownloadURL:   downloadURL,
		Changelog:     changelog,
		SourceID:      sourceID,
		SourceName:    "",
		DownloadCount: 0,
		Recommended:   fnpackApp.Recommended,
	}
}

// AsyncCheckSources 后台异步检测所有启用的远程源
func AsyncCheckSources() {
	sources := LoadSources()
	now := time.Now().Unix()
	var wg sync.WaitGroup
	changed := false
	var mu sync.Mutex

	// 记录需要检测的源索引
	var toCheck []int
	for i := range sources {
		s := &sources[i]
		if s.Local || !s.Enabled {
			continue
		}
		// 10 分钟冷却期
		if now-s.LastChecked < 600 {
			continue
		}
		toCheck = append(toCheck, i)
	}

	if len(toCheck) == 0 {
		return
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	for _, idx := range toCheck {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s := &sources[i]
			url := NormalizeURL(s.URL)
			// 只要 URL 能联通（状态码为 200）即视为有效
			if !strings.HasSuffix(url, "/fnpack.json") {
				url = strings.TrimRight(url, "/") + "/fnpack.json"
			}

			valid := false
			resp, err := client.Get(url)
			if err == nil {
				if resp.StatusCode == http.StatusOK {
					valid = true
				}
				resp.Body.Close()
			}

			mu.Lock()
			defer mu.Unlock()

			if valid {
				sources[i].LastChecked = now
				changed = true
			} else {
				log.Printf("[Cleanup] Source %s (%s) is inaccessible (Status: %v). Disabling and cleaning cache.", s.Name, s.URL, err)
				sources[i].Enabled = false
				// 清理缓存
				cachePath := filepath.Join(cacheDir, s.ID+".json")
				if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
					log.Printf("[Cleanup] Failed to remove cache file %s: %v", cachePath, err)
				}
				changed = true
			}
		}(idx)
	}

	wg.Wait()

	if changed {
		SaveSources(sources)
	}
}

// NormalizeURL 规范化第三方平台的链接（如 Gitee, GitHub）为原始文件链接
func NormalizeURL(url string) string {
	url = strings.TrimSpace(url)

	// Gitee 处理
	if strings.Contains(url, "gitee.com") && strings.Contains(url, "/blob/") {
		url = strings.Replace(url, "/blob/", "/raw/", 1)
	}

	// GitHub 处理
	if strings.Contains(url, "github.com") {
		if strings.Contains(url, "/blob/") {
			url = strings.Replace(url, "github.com", "raw.githubusercontent.com", 1)
			url = strings.Replace(url, "/blob/", "/", 1)
		} else if strings.Contains(url, "/raw/") {
			url = strings.Replace(url, "github.com", "raw.githubusercontent.com", 1)
			url = strings.Replace(url, "/raw/", "/", 1)
		}
	}

	return url
}
