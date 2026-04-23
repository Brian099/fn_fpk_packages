package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
)

var (
	configPath string
	config     *Config
	configMu   sync.RWMutex
)

type Config struct {
	Proxies []ProxyRule `json:"proxies"`
}

type ProxyRule struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Enable         bool     `json:"enable"`
	Domains        []string `json:"domains"`
	Target         string   `json:"target"`
	SourceProtocol string   `json:"sourceProtocol,omitempty"`
	SourceHost     string   `json:"sourceHost,omitempty"`
	SourcePort     string   `json:"sourcePort,omitempty"`
	TargetProtocol string   `json:"targetProtocol,omitempty"`
	TargetHost     string   `json:"targetHost,omitempty"`
	TargetPort     string   `json:"targetPort,omitempty"`
	Timeout        string   `json:"timeout,omitempty"`
	HSTS           bool     `json:"hsts,omitempty"`
	PreserveHost   bool     `json:"preserveHost,omitempty"`
}

func Init(path string) error {
	configPath = path
	bakPath := path + ".bak"

	configMu.Lock()
	defer configMu.Unlock()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		if bakData, readErr := os.ReadFile(bakPath); readErr == nil {
			if json.Unmarshal(bakData, &config) == nil && len(config.Proxies) > 0 {
				log.Printf("[CONFIG] Restored %d rules from backup file: %s", len(config.Proxies), bakPath)
				if writeErr := os.WriteFile(path, bakData, 0644); writeErr != nil {
					log.Printf("[CONFIG] WARNING: failed to write restored config: %v", writeErr)
				}
				return nil
			}
			log.Printf("[CONFIG] Backup file exists but invalid, creating fresh config")
		} else {
			log.Printf("[CONFIG] No existing config found at %s (no backup either)", path)
		}

		config = &Config{
			Proxies: []ProxyRule{},
		}
		data, marshalErr := json.MarshalIndent(config, "", "  ")
		if marshalErr != nil {
			return marshalErr
		}
		log.Printf("[CONFIG] Created fresh empty config at %s", path)
		return os.WriteFile(path, data, 0644)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	unmarshalErr := json.Unmarshal(data, &config)
	if unmarshalErr == nil {
		log.Printf("[CONFIG] Loaded config with %d proxy rules from %s", len(config.Proxies), path)
	}
	return unmarshalErr
}

func Get() *Config {
	configMu.RLock()
	defer configMu.RUnlock()
	return config
}

func Save() error {
	configMu.Lock()
	defer configMu.Unlock()

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	bakPath := configPath + ".bak"
	if _, statErr := os.Stat(configPath); statErr == nil {
		if origData, readErr := os.ReadFile(configPath); readErr == nil {
			os.WriteFile(bakPath, origData, 0644)
		}
	}

	writeErr := os.WriteFile(configPath, data, 0644)
	if writeErr == nil {
		log.Printf("[CONFIG] Saved %d proxy rules to %s", len(config.Proxies), configPath)
	}
	return writeErr
}

func AddProxy(proxy ProxyRule) {
	if proxy.ID == "" {
		proxy.ID = generateID()
	}
	configMu.Lock()
	defer configMu.Unlock()
	config.Proxies = append(config.Proxies, proxy)
}

func UpdateProxy(proxy ProxyRule) {
	configMu.Lock()
	defer configMu.Unlock()
	for i, p := range config.Proxies {
		if p.ID == proxy.ID {
			config.Proxies[i] = proxy
			break
		}
	}
}

func DeleteProxy(id string) {
	configMu.Lock()
	defer configMu.Unlock()
	var newProxies []ProxyRule
	for _, p := range config.Proxies {
		if p.ID != id {
			newProxies = append(newProxies, p)
		}
	}
	config.Proxies = newProxies
}

func generateID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func ValidateProxy(rule ProxyRule, excludeID string) error {
	if strings.TrimSpace(rule.Name) == "" {
		return errors.New("规则名称不能为空")
	}
	srcPort := strings.TrimSpace(rule.SourcePort)
	if srcPort == "" {
		return errors.New("来源端口不能为空")
	}
	srcPortNum, err := strconv.Atoi(srcPort)
	if err != nil || srcPortNum < 1 || srcPortNum > 65535 {
		return errors.New("来源端口必须在 1-65535 范围内")
	}
	tgtHost := strings.TrimSpace(rule.TargetHost)
	if tgtHost == "" {
		return errors.New("目标主机不能为空")
	}
	tgtPort := strings.TrimSpace(rule.TargetPort)
	if tgtPort == "" {
		return errors.New("目标端口不能为空")
	}
	tgtPortNum, err := strconv.Atoi(tgtPort)
	if err != nil || tgtPortNum < 1 || tgtPortNum > 65535 {
		return errors.New("目标端口必须在 1-65535 范围内")
	}

	configMu.RLock()
	defer configMu.RUnlock()

	for _, p := range config.Proxies {
		if p.ID == excludeID {
			continue
		}
		if p.Name == rule.Name {
			return fmt.Errorf("规则名称 %q 已存在，请使用其他名称", rule.Name)
		}
		pPort := strings.TrimSpace(p.SourcePort)
		if pPort == "" {
			pPort = "80"
		}
		pProto := strings.ToLower(strings.TrimSpace(p.SourceProtocol))
		if pProto == "" {
			pProto = "http"
		}
		rProto := strings.ToLower(strings.TrimSpace(rule.SourceProtocol))
		if rProto == "" {
			rProto = "http"
		}
		if pPort == srcPort && pProto == rProto {
			return fmt.Errorf("来源端口 %s (%s) 已被规则 %q 使用，每个端口的每种协议只能被一条规则监听",
				srcPort, strings.ToUpper(rProto), p.Name)
		}
	}
	return nil
}
