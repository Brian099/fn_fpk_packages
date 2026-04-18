package services

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"appcenter/config"
	"appcenter/models"
)

// CacheStore 内存存储中心
type CacheStore struct {
	sync.RWMutex
	Sources       []models.Source
	SourceApps    map[string][]models.App             // Key: SourceID
	Fingerprints  map[string]map[string]models.FPKFingerprint // Key: SourceID -> AppID -> Fingerprint
	
	dirtySources  bool
	dirtyApps     map[string]bool
	stopChan      chan struct{}
}

// GlobalStore 全局单例
var GlobalStore *CacheStore

// InitStore 初始化存储中心
func InitStore() {
	GlobalStore = &CacheStore{
		SourceApps:   make(map[string][]models.App),
		Fingerprints: make(map[string]map[string]models.FPKFingerprint),
		dirtyApps:    make(map[string]bool),
		stopChan:     make(chan struct{}),
	}

	// 1. 加载数据
	GlobalStore.LoadAllFromDisk()

	// 2. 启动异步持久化协程
	go GlobalStore.persistenceLoop()
}

// LoadAllFromDisk 从磁盘全量加载数据到内存
func (s *CacheStore) LoadAllFromDisk() {
	s.Lock()
	defer s.Unlock()

	log.Println("[Store] Loading data from disk...")

	// 加载源列表
	s.Sources = LoadSources()

	// 遍历所有源加载应用列表
	for _, source := range s.Sources {
		cachePath := filepath.Join(config.PkgVar, "cache", source.ID+".json")
		if _, err := os.Stat(cachePath); err == nil {
			data, err := ioutil.ReadFile(cachePath)
			if err == nil {
				var cachedData models.FPKCacheData
				if err := json.Unmarshal(data, &cachedData); err == nil {
					s.SourceApps[source.ID] = cachedData.Apps
					// 记录指纹，用于后续本地源增量同步
					if cachedData.Fingerprints != nil {
						s.Fingerprints[source.ID] = cachedData.Fingerprints
					}
				}
			}
		}
	}
	log.Printf("[Store] Loaded %d sources into memory", len(s.Sources))
}

// persistenceLoop 异步持久化循环
func (s *CacheStore) persistenceLoop() {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.SyncToDisk()
		case <-s.stopChan:
			s.SyncToDisk()
			return
		}
	}
}

// SyncToDisk 将脏数据同步到磁盘
func (s *CacheStore) SyncToDisk() {
	s.Lock()
	defer s.Unlock()

	// 1. 保存源列表
	if s.dirtySources {
		saveSources(s.Sources)
		s.dirtySources = false
	}

	// 2. 保存有变动的应用列表或执行自愈（检测物理文件丢失）
	// 我们遍历内存中所有的源，检查其对应的缓存文件是否存在
	for _, source := range s.Sources {
		cachePath := filepath.Join(config.PkgVar, "cache", source.ID+".json")
		_, err := os.Stat(cachePath)
		fileMissing := os.IsNotExist(err)

		// 如果标记为脏，或者物理文件意外丢失，则触发写入
		if s.dirtyApps[source.ID] || fileMissing {
			log.Printf("[Store] Syncing/Healing cache for source: %s (Missing: %v)", source.ID, fileMissing)
			saveAppsToCache(source.ID, s.SourceApps[source.ID], s.Fingerprints[source.ID])
			delete(s.dirtyApps, source.ID)
		}
	}
}

// RefreshDiscovery 执行本地源发现并同步内存
func (s *CacheStore) RefreshDiscovery() {
	s.Lock()
	// 注意：DiscoverLocalSources 内部会调用 SaveSources，我们需要它改写内存
	// 这里直接复用现有的发现逻辑，但要确保结果同步回 Store
	sources := s.Sources
	countBefore := len(sources)
	DiscoverLocalSources(&sources)
	
	if len(sources) > countBefore {
		log.Printf("[Store] New local sources discovered: %d", len(sources)-countBefore)
		s.Sources = sources
		s.dirtySources = false // DiscoverLocalSources 已经写过磁盘了
	}
	s.Unlock()
}

// GetSources 获取所有源（线程安全）
func (s *CacheStore) GetSources() []models.Source {
	s.RLock()
	defer s.RUnlock()
	
	// 返回副本防止外部修改影响内存
	res := make([]models.Source, len(s.Sources))
	copy(res, s.Sources)
	return res
}

// GetApps 获取指定源的应用列表
func (s *CacheStore) GetAppsBySource(sourceID string) []models.App {
	s.RLock()
	defer s.RUnlock()
	return s.SourceApps[sourceID]
}

// UpdateAppMetadata 更新应用元数据（如标签、推荐、下载量）
func (s *CacheStore) UpdateAppMetadata(sourceID, appID string, updater func(*models.App)) bool {
	s.Lock()
	defer s.Unlock()

	apps, ok := s.SourceApps[sourceID]
	if !ok {
		return false
	}

	found := false
	for i := range apps {
		if apps[i].ID == appID {
			updater(&apps[i])
			found = true
			break
		}
	}

	if found {
		s.dirtyApps[sourceID] = true
	}
	return found
}

// SetDirtySources 标记源列表为脏
func (s *CacheStore) SetDirtySources() {
	s.Lock()
	defer s.Unlock()
	s.dirtySources = true
}

// SetDirtyApps 标记特定源的应用列表为脏
func (s *CacheStore) SetDirtyApps(sourceID string) {
	s.Lock()
	defer s.Unlock()
	s.dirtyApps[sourceID] = true
}

// AddOrUpdateSource 动态添加或更新源
func (s *CacheStore) AddOrUpdateSource(source models.Source, apps []models.App) {
	s.Lock()
	defer s.Unlock()

	found := false
	for i := range s.Sources {
		if s.Sources[i].ID == source.ID {
			s.Sources[i] = source
			found = true
			break
		}
	}
	if !found {
		s.Sources = append(s.Sources, source)
	}

	s.SourceApps[source.ID] = apps
	s.dirtySources = true
	s.dirtyApps[source.ID] = true
}

// RemoveSource 动态移除源
func (s *CacheStore) RemoveSource(sourceID string) {
	s.Lock()
	defer s.Unlock()

	newSources := make([]models.Source, 0)
	for _, src := range s.Sources {
		if src.ID != sourceID {
			newSources = append(newSources, src)
		}
	}
	s.Sources = newSources

	// 释放应用列表内存
	delete(s.SourceApps, sourceID)
	delete(s.dirtyApps, sourceID)
	delete(s.Fingerprints, sourceID)

	s.dirtySources = true
	
	// 记录需要删除磁盘文件（可在下一周期物理删除）
	go os.Remove(filepath.Join(config.PkgVar, "cache", sourceID+".json"))
}

// UpdateSources 批量更新源列表
func (s *CacheStore) UpdateSources(sources []models.Source) {
	s.Lock()
	defer s.Unlock()
	s.Sources = sources
	s.dirtySources = true
}

// Stop 停止并强制保存
func (s *CacheStore) Stop() {
	close(s.stopChan)
}
