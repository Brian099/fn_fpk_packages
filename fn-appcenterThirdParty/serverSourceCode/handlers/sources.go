package handlers

import (
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"appcenter/config"
	"appcenter/models"
	"appcenter/services"

	"github.com/gin-gonic/gin"
)

// GetSources 获取所有源
func GetSources(c *gin.Context) {
	sources := services.GlobalStore.GetSources()

	services.DiscoverLocalSources(&sources)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"sources": sources,
		},
	})
}

// AddSource 添加源
func AddSource(c *gin.Context) {
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

	// sources := services.GlobalStore.GetSources() // 此处不需要读取源列表，AddOrUpdateSource 内部会处理

	newSource := models.Source{
		ID:         fmt.Sprintf("source_%d", time.Now().UnixNano()),
		Name:       req.Name,
		URL:        req.URL,
		Enabled:    true,
		AutoUpdate: true,
		LastSync:   "",
		AppCount:   0,
		Local:      false,
	}

	services.GlobalStore.AddOrUpdateSource(newSource, []models.App{})

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": newSource,
	})
}

// DeleteSource 删除源
func DeleteSource(c *gin.Context) {
	sourceID := c.Param("id")

	services.GlobalStore.RemoveSource(sourceID)

	cachePath := filepath.Join(config.PkgVar, "cache", sourceID+".json")

	if _, err := os.Stat(cachePath); err == nil {
		backupPath := cachePath + ".bak"
		data, _ := ioutil.ReadFile(cachePath)
		ioutil.WriteFile(backupPath, data, 0644)
	}

	os.Remove(cachePath)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Source deleted successfully",
	})
}

// SyncSource 同步源
func SyncSource(c *gin.Context) {
	sourceID := c.Param("id")

	sources := services.GlobalStore.GetSources()
	services.DiscoverLocalSources(&sources)
	var targetSource *models.Source
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

	added, updated, removed := services.SyncSourceData(targetSource)

	targetSource.LastSync = time.Now().Format(time.RFC3339)
	
	// 同步完后更新内存中的应用列表
	newApps := services.LoadAppsFromSource(targetSource)
	services.GlobalStore.AddOrUpdateSource(*targetSource, newApps)

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

// ToggleSource 切换源启用状态
func ToggleSource(c *gin.Context) {
	sourceID := c.Param("id")

	var req struct {
		Enabled *bool `json:"enabled"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "Invalid request: " + err.Error(),
		})
		return
	}

	if req.Enabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "Enabled field is required",
		})
		return
	}

	sources := services.GlobalStore.GetSources()
	var found bool

	for i := range sources {
		if sources[i].ID == sourceID {
			sources[i].Enabled = *req.Enabled
			found = true
			break
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{
			"code":    404,
			"message": "Source not found",
		})
		return
	}

	services.GlobalStore.UpdateSources(sources)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": fmt.Sprintf("Source %s successfully", map[bool]string{true: "enabled", false: "disabled"}[*req.Enabled]),
	})
}

// ResetSourceCache 重置源缓存
func ResetSourceCache(c *gin.Context) {
	sourceID := c.Param("id")

	sources := services.LoadSources()
	var targetSource *models.Source
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

	cachePath := filepath.Join(config.PkgVar, "cache", sourceID+".json")
	os.Remove(cachePath)

	var total int
	if targetSource.Local {
		apps := services.ScanFPKDir(targetSource.URL, sourceID, true)
		total = len(apps)
	} else {
		total = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Cache reset successfully",
		"data": gin.H{
			"total": total,
		},
	})
}

type UpdateAppLabelsRequest struct {
	AppID       string   `json:"app_id"`
	Labels      []string `json:"labels"`
	Recommended *bool    `json:"recommended"`
}

func UpdateAppLabels(c *gin.Context) {
	sourceID := c.Param("id")
	appID := c.Param("appId")

	var req UpdateAppLabelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid request"})
		return
	}

	// 直接更新内存中的元数据
	found := services.GlobalStore.UpdateAppMetadata(sourceID, appID, func(app *models.App) {
		if req.Labels != nil {
			app.Labels = req.Labels
			app.Categories = req.Labels
		}
		if req.Recommended != nil {
			app.Recommended = *req.Recommended
		}
	})

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "App not found in cache"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "Labels updated successfully"})
}

// SyncPresetSources 从远程获取官方预设源并合并
func SyncPresetSources(c *gin.Context) {
	url := "https://gitee.com/laoknas/fn_fpk_packages/raw/master/AppStoreList.txt"
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "获取远程推荐源失败: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": fmt.Sprintf("获取远程推荐源失败: HTTP %d", resp.StatusCode)})
		return
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "读取推荐源数据失败"})
		return
	}

	lines := strings.Split(string(body), "\n")
	sources := services.LoadSources()
	added := 0

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, ",http") {
			continue
		}
		parts := strings.SplitN(line, ",", 2)
		if len(parts) != 2 {
			continue
		}

		name := strings.TrimSpace(parts[0])
		sourceURL := strings.TrimSpace(parts[1])

		// 检查是否已存在（按URL匹配）
		exists := false
		for _, s := range sources {
			if s.URL == sourceURL {
				exists = true
				break
			}
		}

		if !exists {
			newSource := models.Source{
				ID:         fmt.Sprintf("source_%d", time.Now().UnixNano()),
				Name:       name + "(推荐源)",
				URL:        sourceURL,
				Enabled:    false, // 新发现的源默认不开启，让用户自己选择
				AutoUpdate: true,
				LastSync:   "",
				AppCount:   0,
				Local:      false,
			}
			sources = append(sources, newSource)
			added++
			time.Sleep(1 * time.Millisecond) // 防止 ID 冲突
		}
	}

	if added > 0 {
		services.SaveSources(sources)
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": fmt.Sprintf("成功发现了 %d 个新的推荐源", added),
		"data": gin.H{
			"added": added,
		},
	})
}
