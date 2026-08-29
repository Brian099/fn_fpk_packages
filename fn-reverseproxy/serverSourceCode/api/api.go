package api

import (
	"fmt"
	"log"
	"net/http"
	"time"

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
	r.GET("/api/proxies/status", GetProxyStatus)
	r.GET("/api/certs", GetCerts)
	r.POST("/api/test-target", TestTarget)
}

func auditLog(action, target, detail string) {
	log.Printf("[AUDIT] action=%s target=%s detail=%s time=%s", action, target, detail, time.Now().Format("2006-01-02T15:04:05Z07:00"))
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

	auditLog("CREATE", proxyRule.ID,
		fmt.Sprintf("name=%s domains=%v src=%s:%s tgt=%s:%s",
			proxyRule.Name, proxyRule.Domains,
			proxyRule.SourceProtocol, proxyRule.SourcePort,
			proxyRule.TargetHost, proxyRule.TargetPort))

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

	auditLog("UPDATE", id,
		fmt.Sprintf("name=%s enable=%v domains=%v src=%s:%s tgt=%s:%s",
			proxyRule.Name, proxyRule.Enable, proxyRule.Domains,
			proxyRule.SourceProtocol, proxyRule.SourcePort,
			proxyRule.TargetHost, proxyRule.TargetPort))

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

	auditLog("DELETE", id, "rule deleted")

	c.JSON(http.StatusOK, gin.H{"message": "Deleted"})
}

func ReloadProxy(c *gin.Context) {
	id := c.Param("id")
	proxy.Reload()

	auditLog("RELOAD", id, "proxy reloaded")

	c.JSON(http.StatusOK, gin.H{"message": "Reloaded"})
}

func GetProxyStatus(c *gin.Context) {
	c.JSON(http.StatusOK, proxy.GetListenErrors())
}

type TestTargetRequest struct {
	Protocol   string `json:"protocol"`
	Host       string `json:"host"`
	Port       string `json:"port"`
	TimeoutSec int    `json:"timeoutSec"`
}

func GetCerts(c *gin.Context) {
	certs := proxy.GetCertsList()
	c.JSON(http.StatusOK, certs)
}

func TestTarget(c *gin.Context) {
	var req TestTargetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := proxy.TestTargetConnection(req.Protocol, req.Host, req.Port, req.TimeoutSec)
	c.JSON(http.StatusOK, result)
}
