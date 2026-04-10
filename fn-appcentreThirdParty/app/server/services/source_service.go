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

	"appcentre/models"
)

// scanFPKFiles 扫描FPK文件（递归子目录）
func scanFPKFiles(sources *[]models.Source, baseDir string) {
	fpkFiles := collectFPKFiles(baseDir)

	if len(fpkFiles) == 0 {
		return
	}

	exists := false
	for _, source := range *sources {
		if source.Local && source.URL == baseDir {
			exists = true
			break
		}
	}

	if !exists {
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

	url := strings.TrimRight(targetSource.URL, "/") + "/fnpack.json"
	resp, err := http.Get(url)
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

	apps = make([]models.App, 0)
	for appName, fnpackApp := range *fnpackData {
		app := convertToApp(appName, fnpackApp, sourceID)
		apps = append(apps, app)
	}

	os.MkdirAll(cacheDir, 0755)
	cacheData, _ := json.MarshalIndent(apps, "", "  ")
	ioutil.WriteFile(filepath.Join(cacheDir, sourceID+".json"), cacheData, 0644)

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

	return models.App{
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
