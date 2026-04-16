package services

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"appcenter/config"
)

// AppStatus 应用状态结构体
type AppStatus struct {
	Status      string    `json:"status"`
	Running     bool      `json:"running"`
	Installed   bool      `json:"installed"`
	Version     string    `json:"version"` // 已安装版本
	LastChecked time.Time `json:"last_checked"`
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

// GetAppStatus 获取应用状态（改用 list 批量匹配逻辑，确保一致性）
func GetAppStatus(appName string) (AppStatus, error) {
	status := AppStatus{
		LastChecked: time.Now(),
	}

	if appName == "" {
		status.Status = "noinstall"
		return status, nil
	}

	installedMap, err := GetInstalledAppsMap()
	if err != nil {
		status.Status = "noinstall"
		return status, nil
	}

	if info, ok := installedMap[appName]; ok {
		status.Status = info["status"]
		status.Version = info["version"]
		status.Installed = true
		status.Running = (status.Status == "running")
	} else {
		status.Status = "noinstall"
		status.Running = false
		status.Installed = false
	}

	return status, nil
}

// GetInstalledAppsMap 返回所有已安装应用的映射 (AppName -> {status, version})
func GetInstalledAppsMap() (map[string]map[string]string, error) {
	cliPath := getAppCenterCliPath()
	cmd := exec.Command(cliPath, "list")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, err
	}

	installedMap := make(map[string]map[string]string)
	lines := strings.Split(string(output), "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		// 识别表格行 (以 │ 开头)
		if strings.HasPrefix(line, "│") {
			fields := strings.Split(line, "│")
			if len(fields) >= 5 {
				appName := strings.TrimSpace(fields[1])
				version := strings.TrimSpace(fields[3])
				rawStatus := strings.ToLower(strings.TrimSpace(fields[4]))

				// 映射状态：nostart -> running, start -> start (未启动), stopped -> stopped
				status := rawStatus
				if rawStatus == "nostart" {
					status = "running"
				}

				// 排除表头
				if appName != "" && appName != "APP NAME" {
					installedMap[appName] = map[string]string{
						"status":  status,
						"version": version,
					}
				}
			}
		}
	}

	return installedMap, nil
}

// RefreshAllStatus 为了保持兼容性保留函数名，但逻辑改为直接返回成功（因为现在是实时的）
func RefreshAllStatus() error {
	return nil
}
