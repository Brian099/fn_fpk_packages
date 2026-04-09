package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"appcentre/config"
	"appcentre/models"
	"appcentre/services"

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

	if sourceID != "local_fpk_files" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "Only local_fpk_files cache can be reset",
		})
		return
	}

	cacheDir := filepath.Join(config.PkgVar, "cache")
	cachePath := filepath.Join(cacheDir, sourceID+".json")
	os.Remove(cachePath)

	apps := services.ParseLocalFPKSource()

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Cache reset successfully",
		"data": gin.H{
			"total": len(apps),
		},
	})
}
