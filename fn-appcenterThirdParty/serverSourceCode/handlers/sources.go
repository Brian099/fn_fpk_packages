package handlers

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"appcenter/config"
	"appcenter/models"
	"appcenter/services"

	"github.com/gin-gonic/gin"
)

// GetSources 获取所有源
func GetSources(c *gin.Context) {
	sources := services.LoadSources()

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

	sources := services.LoadSources()

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

	sources = append(sources, newSource)

	services.SaveSources(sources)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": newSource,
	})
}

// DeleteSource 删除源
func DeleteSource(c *gin.Context) {
	sourceID := c.Param("id")

	sources := services.LoadSources()
	var newSources []models.Source

	for _, source := range sources {
		if source.ID != sourceID {
			newSources = append(newSources, source)
		}
	}

	services.SaveSources(newSources)

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

	sources := services.LoadSources()
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
	services.SaveSources(sources)

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

	sources := services.LoadSources()
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

	services.SaveSources(sources)

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

	sources := services.LoadSources()
	var targetSource *models.Source
	for i := range sources {
		if sources[i].ID == sourceID {
			targetSource = &sources[i]
			break
		}
	}

	if targetSource == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "Source not found"})
		return
	}

	if !targetSource.Local {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "仅支持为本地应用（FPK）设置分类或推荐"})
		return
	}

	cachePath := filepath.Join(config.PkgVar, "cache", sourceID+".json")
	data, err := ioutil.ReadFile(cachePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Cache file not found"})
		return
	}

	var cacheData models.FPKCacheData
	if err := json.Unmarshal(data, &cacheData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Invalid cache format"})
		return
	}

	found := false
	for i := range cacheData.Apps {
		if cacheData.Apps[i].ID == appID {
			if req.Labels != nil {
				cacheData.Apps[i].Labels = req.Labels
				cacheData.Apps[i].Categories = req.Labels
			}
			if req.Recommended != nil {
				// 检查推荐限制 (每源最多2个)
				if *req.Recommended {
					recommendedCount := 0
					for _, app := range cacheData.Apps {
						if app.Recommended {
							recommendedCount++
						}
					}
					// 如果当前还没推荐或者是尝试增加推荐
					if !cacheData.Apps[i].Recommended && recommendedCount >= 2 {
						c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "每个应用源最多只能推荐2个应用"})
						return
					}
				}
				cacheData.Apps[i].Recommended = *req.Recommended
			}
			found = true
			break
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "App not found in cache"})
		return
	}

	newData, err := json.MarshalIndent(cacheData, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to save"})
		return
	}

	if err := ioutil.WriteFile(cachePath, newData, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "Failed to write cache"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "Labels updated successfully"})
}
