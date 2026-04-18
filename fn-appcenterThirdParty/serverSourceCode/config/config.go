package config

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

var (
	AppDest          = os.Getenv("TRIM_APPDEST")
	PkgVar           = os.Getenv("TRIM_PKGVAR")
	AppCenterCliPath = os.Getenv("TRIM_APPCENTER_CLI_PATH")
)

var defaultConfig = Config{
	EnableAppShare: false,
	SharePort:      5668,
}

// Config 应用配置结构体
type Config struct {
	AppStoreDir    string `json:"appStoreDir"`
	EnableAppShare bool   `json:"enableAppShare"`
	SharePort      int    `json:"sharePort"`
}

// LoadConfig 加载配置文件
func LoadConfig() Config {
	if PkgVar == "" {
		PkgVar = "/var/apps/appcenterThirdParty/var"
	}

	configPath := filepath.Join(PkgVar, "config.json")
	log.Printf("Loading config from: %s", configPath)

	var config Config

	// 读取配置文件
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("Config file not found, using default")
			config = defaultConfig
		} else {
			log.Printf("Failed to read config file: %v", err)
			config = defaultConfig
		}
		return config
	}

	// 解析配置文件
	if err := json.Unmarshal(data, &config); err != nil {
		log.Printf("Failed to parse config file: %v", err)
		config = defaultConfig
	}

	// 应用默认值（如果字段为零值）
	if config.SharePort == 0 {
		config.SharePort = defaultConfig.SharePort
	}

	log.Printf("Config loaded: %+v", config)
	return config
}

// SaveConfig 保存配置文件
func SaveConfig(config Config) error {
	if PkgVar == "" {
		PkgVar = "/var/apps/appcenterThirdParty/var"
	}

	configPath := filepath.Join(PkgVar, "config.json")

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return err
	}

	log.Printf("Config saved to: %s", configPath)
	return nil
}
