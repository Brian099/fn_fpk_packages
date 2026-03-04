/**
 * FlyPic 后端日志系统
 * 专注于系统级和性能监控日志
 * 
 * 日志分类：
 * - SYSTEM: 系统事件（启动、关闭、配置）
 * - PERF: 性能监控（扫描速度、内存使用）
 * - DB: 数据库操作（重要查询、批量操作）
 * - TASK: 定时任务（清理任务、同步任务）
 * - API: API请求（仅记录关键操作和错误）
 * - ERROR: 错误（系统异常、崩溃）
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// 日志类别配置（带emoji）
const LOG_CATEGORIES = {
  SYSTEM: '🚀',
  PERF: '⚡',
  DB: '💾',
  TASK: '🔄',
  API: '🌐',
  FILE: '📁',
  ERROR: '❌'
};

const currentLevel = process.env.LOG_LEVEL 
  ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] 
  : LOG_LEVELS.INFO;

/**
 * 格式化时间戳
 */
function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 基础日志输出
 */
function log(level, category, message, ...args) {
  if (LOG_LEVELS[level] >= currentLevel) {
    const emoji = LOG_CATEGORIES[category] || '📝';
    const timestamp = getTimestamp();
    const prefix = `[${timestamp}] ${emoji} [${level}]`;
    
    const method = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
    console[method](prefix, message, ...args);
  }
}

/**
 * 日志器类
 */
class Logger {
  // ==================== 系统日志 ====================
  
  /**
   * 系统级日志（启动、关闭、配置）
   * @example logger.system('服务启动', { port: 5002 })
   */
  system(message, ...args) {
    log('INFO', 'SYSTEM', message, ...args);
  }

  // ==================== 性能日志 ====================
  
  /**
   * 性能监控日志（扫描速度、内存使用）
   * @example logger.perf('扫描完成', { count: 1000, time: 5.2 })
   */
  perf(message, ...args) {
    log('INFO', 'PERF', message, ...args);
  }

  // ==================== 数据库日志 ====================
  
  /**
   * 数据库操作日志（重要查询、批量操作）
   * @example logger.db('批量插入图片', { count: 50 })
   */
  db(message, ...args) {
    log('DEBUG', 'DB', message, ...args);
  }

  // ==================== 任务日志 ====================
  
  /**
   * 定时任务日志（清理任务、同步任务）
   * @example logger.task('开始清理过期文件', { count: 10 })
   */
  task(message, ...args) {
    log('INFO', 'TASK', message, ...args);
  }

  // ==================== API日志 ====================
  
  /**
   * API请求日志（仅记录关键操作）
   * @example logger.api('删除文件', { count: 3, user: 'admin' })
   */
  api(message, ...args) {
    log('INFO', 'API', message, ...args);
  }

  // ==================== 文件操作日志 ====================
  
  /**
   * 文件操作日志
   * @example logger.fileOp('移动文件', { from: '/a', to: '/b' })
   */
  fileOp(message, ...args) {
    log('DEBUG', 'FILE', message, ...args);
  }

  // ==================== 通用日志 ====================
  
  /**
   * 调试日志（仅DEBUG级别）
   */
  debug(message, ...args) {
    log('DEBUG', 'SYSTEM', message, ...args);
  }

  /**
   * 信息日志
   */
  info(message, ...args) {
    log('INFO', 'SYSTEM', message, ...args);
  }

  /**
   * 警告日志
   */
  warn(message, ...args) {
    log('WARN', 'ERROR', message, ...args);
  }

  /**
   * 错误日志
   */
  error(message, ...args) {
    log('ERROR', 'ERROR', message, ...args);
  }
}

const logger = new Logger();

module.exports = logger;
