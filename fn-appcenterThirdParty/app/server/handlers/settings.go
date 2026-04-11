package handlers

import (
	"net"
	"net/http"
	"os"
	"path/filepath"

	"appcenter/config"
	"appcenter/services"

	"github.com/gin-gonic/gin"
)

// GetSettings 获取应用设置
func GetSettings(c *gin.Context) {
	appConfig := config.LoadConfig()

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"data":    appConfig,
		"message": "获取设置成功",
	})
}

// SaveSettings 保存应用设置
func SaveSettings(c *gin.Context) {
	var req config.Config
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误",
		})
		return
	}

	// 验证目录是否存在且可访问
	if req.AppStoreDir != "" {
		// 尝试创建目录
		if err := os.MkdirAll(req.AppStoreDir, 0755); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "无法创建指定目录，请检查权限",
			})
			return
		}

		// 检查目录是否可写
		testFile := filepath.Join(req.AppStoreDir, ".test")
		if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "指定目录不可写，请检查权限",
			})
			return
		}
		os.Remove(testFile)
	}

	// 保存配置到文件
	if err := config.SaveConfig(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "保存设置失败",
		})
		return
	}

	// 保存配置后，自动发现并更新本地源
	sources := services.LoadSources()
	services.DiscoverLocalSources(&sources)
	services.SaveSources(sources)

	if req.EnableAppShare {
		services.StartAppShareServer(req.SharePort)
	} else {
		services.StopAppShareServer()
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "保存设置成功",
	})
}

// CheckPortAvailability 检测端口是否可用
func CheckPortAvailability(c *gin.Context) {
	port := c.Query("port")
	if port == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "端口号不能为空",
		})
		return
	}

	addr := ":" + port
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"code":    1,
			"message": "端口已被占用，请修改",
			"data": gin.H{
				"available": false,
			},
		})
		return
	}
	listener.Close()

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "端口可用",
		"data": gin.H{
			"available": true,
		},
	})
}
