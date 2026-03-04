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
    BATCH_SIZE: 50,              // 扫描时每批处理的文件数
    WRITE_BATCH_SIZE: 50,        // 数据库批量写入大小
    STREAM_BATCH_SIZE: 200,      // 流式处理批次大小
    CONCURRENT_LIMIT: 10,        // 并发处理限制
    PROGRESS_UPDATE_INTERVAL: 100,
    PROGRESS_LOG_INTERVAL: 1000, // 每处理1000个文件输出一次进度
    GC_TRIGGER_INTERVAL: 1000    // 每处理1000个文件触发一次GC
  },
  
  // 内存配置
  MEMORY: {
    WARNING_THRESHOLD_MB: 200,
    DANGER_THRESHOLD_MB: 300,
    CACHE_SIZE_KB: 4096,
    CLEANUP_INTERVAL_MS: 60000,     // 清理间隔：1分钟
    DB_IDLE_TIMEOUT_MS: 60000,      // 数据库空闲超时：60秒
    DB_CLEANUP_CHECK_INTERVAL: 10000, // 数据库清理检查间隔：10秒（已优化）
    WAL_CHECKPOINT_INTERVAL_MS: 600000 // WAL checkpoint间隔：10分钟（降低I/O开销）
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
    CONFIG_FILE: 'config.json',
    TEMP_BACKUP_DIR: '.flypic/temp_backup'
  },
  
  // 文件操作配置
  FILE_OPERATIONS: {
    TEMP_FILE_EXPIRY_MS: 5 * 60 * 1000,  // 临时文件过期时间：5分钟
    COPY_FOLDER_BATCH_SIZE: 10,          // 复制文件夹时每批处理的图片数
    COPY_FOLDER_BATCH_LOG_INTERVAL: 50   // 每处理50张输出进度
  },
  
  // 缩略图生成配置
  THUMBNAIL_GENERATION: {
    TARGET_HEIGHT: 480,                  // 目标高度
    MAX_QUALITY: 95,                     // 最高质量
    DEFAULT_QUALITY: 92,                 // 默认质量
    EFFORT: 4,                           // WebP编码努力程度
    SHARP_CACHE_MEMORY_MB: 20,           // Sharp缓存内存限制
    SHARP_CACHE_ITEMS: 10,               // Sharp缓存项数
    SHARP_CONCURRENCY: 1,                // Sharp并发数
    GC_PROBABILITY: 0.1,                 // GC触发概率
    PLACEHOLDER_WIDTH: 640,              // 占位图宽度
    PLACEHOLDER_HEIGHT: 480              // 占位图高度
  },
  
  // 文件监控配置
  FILE_WATCHER: {
    POLL_INTERVAL_MS: 5000,              // 轮询间隔：5秒
    OFFLINE_CHECK_ENABLED: true          // 是否检查离线变化
  }
};
