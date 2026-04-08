package models

// Source 应用源结构体
type Source struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	Enabled    bool   `json:"enabled"`
	AutoUpdate bool   `json:"auto_update"`
	LastSync   string `json:"last_sync"`
	AppCount   int    `json:"app_count"`
	Local      bool   `json:"local"`
}

// FPKFingerprint 文件指纹结构体
type FPKFingerprint struct {
	ModTime int64 `json:"mod_time"`
	Size    int64 `json:"size"`
}

// FPKCacheData 缓存数据结构体
type FPKCacheData struct {
	Fingerprints map[string]FPKFingerprint `json:"fingerprints"`
	Apps         []App                     `json:"apps"`
}