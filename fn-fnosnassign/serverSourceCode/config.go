package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config represents the sign-in configuration
type Config struct {
	BaseURL        string `json:"base_url" yaml:"base_url"`
	Username       string `json:"username" yaml:"username"`
	Password       string `json:"password" yaml:"password"`
	Cookie         string `json:"cookie" yaml:"cookie"`
	CronEnabled    bool   `json:"cron_enabled" yaml:"cron_enabled"`
	CronExpression string `json:"cron_expression" yaml:"cron_expression"`
}

// LoadConfig reads and parses the configuration file (JSON or YAML)
func LoadConfig(path string) (*Config, error) {
	file, err := os.Open(path)
	if err != nil {
		// If the file doesn't exist, return an empty default configuration rather than failing,
		// so that the server can still start and write a new configuration.
		if os.IsNotExist(err) {
			return &Config{
				BaseURL:        "https://club.fnnas.com",
				CronExpression: "0 30 9 * * *",
			}, nil
		}
		return nil, fmt.Errorf("failed to open config file: %w", err)
	}
	defer file.Close()

	bytes, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	config := &Config{
		BaseURL:        "https://club.fnnas.com", // Default value
		CronExpression: "0 30 9 * * *",           // Default: 9:30 AM daily
	}

	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".json":
		if err := json.Unmarshal(bytes, config); err != nil {
			return nil, fmt.Errorf("failed to parse JSON: %w", err)
		}
	case ".yaml", ".yml":
		if err := yaml.Unmarshal(bytes, config); err != nil {
			return nil, fmt.Errorf("failed to parse YAML: %w", err)
		}
	default:
		// Try parsing as JSON first, if it fails, try YAML
		if err := json.Unmarshal(bytes, config); err == nil {
			return config, nil
		}
		if err := yaml.Unmarshal(bytes, config); err != nil {
			return nil, fmt.Errorf("unsupported config file extension %s and failed to parse as JSON/YAML: %w", ext, err)
		}
	}

	return config, nil
}

// SaveConfig writes the configuration back to the file in YAML format
func SaveConfig(path string, config *Config) error {
	bytes, err := yaml.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal YAML: %w", err)
	}

	err = os.WriteFile(path, bytes, 0644)
	if err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}
	return nil
}

