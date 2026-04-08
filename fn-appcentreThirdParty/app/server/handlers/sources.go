package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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

	// Special handling for local_fpk_files source
	if sourceID == "local_fpk_files" {
		userAppStoreDir := services.GetUsersAppStoreDir()
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
		services.ParseLocalFPKSource()

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
