package api

import (
	"net/http"

	"fn-reverseproxy/config"
	"fn-reverseproxy/proxy"

	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine) {
	r.GET("/api/proxies", GetProxies)
	r.POST("/api/proxies", AddProxy)
	r.PUT("/api/proxies/:id", UpdateProxy)
	r.DELETE("/api/proxies/:id", DeleteProxy)
	r.POST("/api/proxies/:id/reload", ReloadProxy)
}

func GetProxies(c *gin.Context) {
	cfg := config.Get()
	c.JSON(http.StatusOK, cfg.Proxies)
}

func AddProxy(c *gin.Context) {
	var proxyRule config.ProxyRule
	if err := c.ShouldBindJSON(&proxyRule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := config.ValidateProxy(proxyRule, ""); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	config.AddProxy(proxyRule)
	if err := config.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	proxy.Reload()

	c.JSON(http.StatusOK, proxyRule)
}

func UpdateProxy(c *gin.Context) {
	id := c.Param("id")
	var proxyRule config.ProxyRule
	if err := c.ShouldBindJSON(&proxyRule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	proxyRule.ID = id

	if err := config.ValidateProxy(proxyRule, id); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	config.UpdateProxy(proxyRule)
	if err := config.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	proxy.Reload()

	c.JSON(http.StatusOK, proxyRule)
}

func DeleteProxy(c *gin.Context) {
	id := c.Param("id")
	config.DeleteProxy(id)
	if err := config.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	proxy.Reload()

	c.JSON(http.StatusOK, gin.H{"message": "Deleted"})
}

func ReloadProxy(c *gin.Context) {
	proxy.Reload()
	c.JSON(http.StatusOK, gin.H{"message": "Reloaded"})
}
