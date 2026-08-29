package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
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
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Enable         bool              `json:"enable"`
	Domains        []string          `json:"domains"`
	Target         string            `json:"target"`
	SourceProtocol string            `json:"sourceProtocol,omitempty"`
	SourceHost     string            `json:"sourceHost,omitempty"`
	SourcePort     string            `json:"sourcePort,omitempty"`
	TargetProtocol string            `json:"targetProtocol,omitempty"`
	TargetHost     string            `json:"targetHost,omitempty"`
	TargetPort     string            `json:"targetPort,omitempty"`
	Timeout        string            `json:"timeout,omitempty"`
	HSTS           bool              `json:"hsts,omitempty"`
	PreserveHost   bool              `json:"preserveHost,omitempty"`
	SetHeaders     map[string]string `json:"setHeaders,omitempty"`
	RemoveHeaders  []string          `json:"removeHeaders,omitempty"`
	MaxBodySize    int64             `json:"maxBodySize,omitempty"`
	ForceHTTPS     bool              `json:"forceHttps,omitempty"`
	AllowIPs       []string          `json:"allowIps,omitempty"`
	BlockIPs       []string          `json:"blockIps,omitempty"`

	// 真实IP传递
	AddRealIP    bool     `json:"addRealIP,omitempty"`    // 启用添加X-Real-IP头
	RealIPHeader string   `json:"realIPHeader,omitempty"` // 自定义真实IP头名称，默认X-Real-IP
	TrustedCIDRs []string `json:"trustedCIDRs,omitempty"` // 信任的代理网段（CIDR），用于从X-Forwarded-For等头部提取真实IP

	// User-Agent 过滤
	UserAgentMode string   `json:"userAgentMode,omitempty"` // "", "whitelist", "blacklist"
	UserAgentList []string `json:"userAgentList,omitempty"` // UA关键字列表
}

func Init(path string) error {
	configPath = path
	bakPath := path + ".bak"

	configMu.Lock()
	defer configMu.Unlock()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		_ = os.MkdirAll(filepath.Dir(path), 0755)
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

	_ = os.MkdirAll(filepath.Dir(configPath), 0755)

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

func cleanDomains(domains []string) []string {
	var res []string
	for _, d := range domains {
		d = strings.ToLower(strings.TrimSpace(d))
		if d != "" {
			res = append(res, d)
		}
	}
	return res
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
		if strings.ToLower(rule.TargetProtocol) == "unix" {
			return errors.New("Unix Socket 路径不能为空")
		}
		return errors.New("目标主机不能为空")
	}
	tgtProto := strings.ToLower(strings.TrimSpace(rule.TargetProtocol))
	if tgtProto != "unix" {
		tgtPort := strings.TrimSpace(rule.TargetPort)
		if tgtPort == "" {
			return errors.New("目标端口不能为空")
		}
		tgtPortNum, err := strconv.Atoi(tgtPort)
		if err != nil || tgtPortNum < 1 || tgtPortNum > 65535 {
			return errors.New("目标端口必须在 1-65535 范围内")
		}
	}

	rProto := strings.ToLower(strings.TrimSpace(rule.SourceProtocol))
	if rProto == "" {
		rProto = "http"
	}
	rHost := strings.TrimSpace(rule.SourceHost)
	rDomains := cleanDomains(rule.Domains)
	rIsL4 := rProto == "tcp" || rProto == "udp" || rProto == "tcp+udp"

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
		pHost := strings.TrimSpace(p.SourceHost)
		pDomains := cleanDomains(p.Domains)
		pIsL4 := pProto == "tcp" || pProto == "udp" || pProto == "tcp+udp"

		// 检查端口与主机是否相同
		if pPort == srcPort && pHost == rHost {
			hostDesc := ""
			if rHost != "" {
				hostDesc = rHost + ":"
			}

			// 四层协议与四层/七层之间的互斥检测
			if rIsL4 || pIsL4 {
				if pProto == rProto {
					return fmt.Errorf("来源 %s%s:%s 已被规则 %q 独占使用", hostDesc, strings.ToUpper(rProto), srcPort, p.Name)
				}
				if rProto == "tcp+udp" && (pProto == "tcp" || pProto == "udp") {
					return fmt.Errorf("来源端口 %s 无法使用 TCP+UDP，已被规则 %q 占用了 %s", srcPort, p.Name, strings.ToUpper(pProto))
				}
				if pProto == "tcp+udp" && (rProto == "tcp" || rProto == "udp") {
					return fmt.Errorf("来源端口 %s 无法使用 %s，已被规则 %q 占用了 TCP+UDP", srcPort, strings.ToUpper(rProto), p.Name)
				}
				if rIsL4 != pIsL4 {
					return fmt.Errorf("来源端口 %s 协议冲突：四层代理与七层 Web 代理不能共用同一端口", srcPort)
				}
			}

			// 七层协议 (HTTP / HTTPS)
			if pProto != rProto {
				return fmt.Errorf("来源端口 %s 协议冲突：%s 与 %s 不能同时监听在同一端口", srcPort, strings.ToUpper(pProto), strings.ToUpper(rProto))
			}

			// 检查域名重叠
			if len(pDomains) == 0 && len(rDomains) == 0 {
				return fmt.Errorf("来源 %s%s:%s 且无指定域名的通用规则已存在于规则 %q", hostDesc, strings.ToUpper(rProto), srcPort, p.Name)
			}
			if len(pDomains) == 0 {
				return fmt.Errorf("来源 %s%s:%s 已被规则 %q 作为通配所有域名的默认路由占用，请为规则 %q 指定特定域名后再添加", hostDesc, strings.ToUpper(rProto), srcPort, p.Name, p.Name)
			}
			if len(rDomains) == 0 {
				return fmt.Errorf("规则 %q 未指定域名（会匹配所有域名），与已有规则 %q 在端口 %s 冲突，请指定具体域名", rule.Name, p.Name, srcPort)
			}

			// 比对具体域名是否有重叠
			for _, rd := range rDomains {
				for _, pd := range pDomains {
					if rd == pd {
						return fmt.Errorf("域名 %q 在来源 %s%s:%s 已被规则 %q 绑定使用", rd, hostDesc, strings.ToUpper(rProto), srcPort, p.Name)
					}
				}
			}
		}
	}
	return nil
}
