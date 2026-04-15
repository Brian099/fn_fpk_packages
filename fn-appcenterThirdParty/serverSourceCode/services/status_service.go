package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
	"os/exec"

	"appcenter/config"
)

// AppStatus 应用状态结构体
type AppStatus struct {
	Status      string    `json:"status"`
	Running     bool      `json:"running"`
	LastChecked time.Time `json:"last_checked"`
}

// StatusCache 状态缓存结构体
type StatusCache struct {
	LastUpdated time.Time         `json:"last_updated"`
	Apps        map[string]AppStatus `json:"apps"`
}

// getStatusCachePath 获取状态缓存文件路径
func getStatusCachePath() string {
	return filepath.Join(cacheDir, "appstatus.json")
}

// getAppCenterCliPath 获取appcenter-cli的路径
func getAppCenterCliPath() string {
	if config.AppCenterCliPath != "" {
		return config.AppCenterCliPath
	}
	if config.AppDest != "" {
		cliPath := filepath.Join(config.AppDest, "appcenter-cli")
		if _, err := os.Stat(cliPath); err == nil {
			return cliPath
		}
	}
	return "appcenter-cli"
}

// LoadStatusCache 加载状态缓存
func LoadStatusCache() (StatusCache, error) {
	cachePath := getStatusCachePath()

	// 如果缓存文件不存在，返回空缓存
	if _, err := os.Stat(cachePath); os.IsNotExist(err) {
		return StatusCache{
			LastUpdated: time.Now(),
			Apps:        make(map[string]AppStatus),
		}, nil
	}

	// 读取缓存文件
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return StatusCache{
			LastUpdated: time.Now(),
			Apps:        make(map[string]AppStatus),
		}, err
	}

	// 解析缓存数据
	var cache StatusCache
	if err := json.Unmarshal(data, &cache); err != nil {
		return StatusCache{
			LastUpdated: time.Now(),
			Apps:        make(map[string]AppStatus),
		}, err
	}

	return cache, nil
}

// SaveStatusCache 保存状态缓存
func SaveStatusCache(cache StatusCache) error {
	cachePath := getStatusCachePath()

	// 确保缓存目录存在
	if err := os.MkdirAll(filepath.Dir(cachePath), 0755); err != nil {
		return err
	}

	// 序列化缓存数据
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}

	// 写入缓存文件
	return os.WriteFile(cachePath, data, 0644)
}

// GetAppStatus 获取应用状态
func GetAppStatus(appName string) (AppStatus, error) {
	// 加载缓存
	cache, err := LoadStatusCache()
	if err != nil {
		return AppStatus{}, err
	}

	// 检查缓存是否存在且未过期（5分钟内）
	if status, exists := cache.Apps[appName]; exists {
		if time.Since(status.LastChecked) < 5*time.Minute {
			return status, nil
		}
	}

	// 缓存不存在或已过期，调用 appcenter-cli 获取状态
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "status", appName)
	output, err := cmd.CombinedOutput()

	status := AppStatus{
		LastChecked: time.Now(),
	}

	if err != nil {
		status.Status = "not_installed"
		status.Running = false
	} else {
		outputStr := strings.ToLower(string(output))

		if strings.Contains(outputStr, "noinstall") || strings.Contains(outputStr, "not installed") {
			status.Status = "not_installed"
			status.Running = false
		} else if strings.Contains(outputStr, "running") {
			status.Status = "running"
			status.Running = true
		} else if strings.Contains(outputStr, "stopped") {
			status.Status = "stopped"
			status.Running = false
		} else if strings.Contains(outputStr, "nostart") {
			status.Status = "nostart"
			status.Running = false
		} else {
			status.Status = "unknown"
			status.Running = false
		}
	}

	// 更新缓存
	cache.Apps[appName] = status
	cache.LastUpdated = time.Now()
	SaveStatusCache(cache)

	return status, nil
}

// RefreshAllStatus 刷新所有应用状态
func RefreshAllStatus() error {
	// 获取所有已安装的应用
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "list")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return err
	}

	// 解析应用列表
	lines := strings.Split(string(output), "\n")
	appNames := make([]string, 0)

	for _, line := range lines {
		// 跳过表头和分隔线
		if strings.Contains(line, "APP NAME") || strings.Contains(line, "┌") || strings.Contains(line, "├") || strings.Contains(line, "└") {
			continue
		}

		// 提取应用名称
		parts := strings.Fields(line)
		if len(parts) > 0 {
			appName := parts[0]
			appNames = append(appNames, appName)
		}
	}

	// 加载当前缓存
	cache, err := LoadStatusCache()
	if err != nil {
		return err
	}

	// 刷新每个应用的状态
	for _, appName := range appNames {
		status, err := GetAppStatus(appName)
		if err == nil {
			cache.Apps[appName] = status
		}
	}

	// 更新缓存
	cache.LastUpdated = time.Now()
	return SaveStatusCache(cache)
}
