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
		app := convertToApp(appName, fnpackApp, sourceID)
		apps = append(apps, app)
	}

	return apps
}

// convertToApp 将FnpackApp转换为App
func convertToApp(appName string, fnpackApp models.FnpackApp, sourceID string) models.App {
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
	labels := []string{}
	if fnpackApp.Labels != "" {
		categories = strings.Split(fnpackApp.Labels, ",")
		labels = categories
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

	return models.App{
		ID:          appName,
		AppName:     appName,
		Name:        fnpackApp.DisplayName,
		Description: desc,
		Version:     version,
		Platform:    platform,
		Categories:  categories,
		Labels:      labels,
		Author:      fnpackApp.Author,
		Publisher:   publisher,
		Size:        size,
		Icon:        icon,
		DownloadURL: downloadURL,
		Changelog:   changelog,
		SourceID:    sourceID,
		Recommended: fnpackApp.Recommended,
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
