/**
 * 应用常量配置
 */

module.exports = {
  // 支持的图片格式
  SUPPORTED_FORMATS: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff'],
  
  // 缩略图配置
  THUMBNAIL: {
    SIZES: {
      SMALL: 200,
      MEDIUM: 480,
      LARGE: 800
    },
    QUALITY: 80,
    FORMAT: 'webp',
    SHARD_LENGTH: 2  // 分片目录长度
  },
  
  // 分页配置
  PAGINATION: {
    DEFAULT_SIZE: 100,
    MAX_SIZE: 500
  },
  
  // 扫描配置
  SCAN: {
    BATCH_SIZE: 50,
    CONCURRENT_LIMIT: 10,
    PROGRESS_UPDATE_INTERVAL: 100
  },
  
  // 内存配置
  MEMORY: {
    WARNING_THRESHOLD_MB: 200,
    DANGER_THRESHOLD_MB: 300,
    CACHE_SIZE_KB: 4096,
    CLEANUP_INTERVAL_MS: 60000,
    DB_IDLE_TIMEOUT_MS: 300000
  },
  
  // 数据库配置
  DATABASE: {
    PRAGMA: {
      journal_mode: 'DELETE',
      synchronous: 'NORMAL',
      cache_size: -4096,
      temp_store: 'FILE',
      page_size: 4096,
      mmap_size: 0
    }
  },
  
  // 路径配置
  PATHS: {
    FLYPIC_DIR: '.flypic',
    THUMBNAILS_DIR: 'thumbnails',
    DATABASE_FILE: 'metadata.db',
    CONFIG_FILE: 'config.json'
  }
};
