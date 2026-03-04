const LibraryDatabase = require('./db');
const { constants } = require('../src/config');
const logger = require('../src/utils/logger');

/**
 * 数据库连接池管理器
 * 复用数据库连接，避免频繁创建/关闭
 */
class DatabasePool {
  constructor() {
    // 单例模式：确保只有一个实例，避免多个定时器
    if (DatabasePool.instance) {
      return DatabasePool.instance;
    }
    DatabasePool.instance = this;
    
    this.connections = new Map(); // libraryPath -> { db, lastUsed, refCount }
    this.maxIdleTime = constants.MEMORY.DB_IDLE_TIMEOUT_MS;
    this.cleanupInterval = null;
    
    // 启动定期清理
    this.startCleanup();
  }

  /**
   * 获取数据库连接（复用或创建）
   * 优化：严格限制最大1个活跃连接
   */
  acquire(libraryPath) {
    let conn = this.connections.get(libraryPath);
    
    if (!conn) {
      // 创建新连接
      const db = new LibraryDatabase(libraryPath);
      conn = {
        db,
        lastUsed: Date.now(),
        refCount: 0
      };
      this.connections.set(libraryPath, conn);
    }
    
    // 更新使用时间和引用计数
    conn.lastUsed = Date.now();
    conn.refCount++;
    
    return conn.db;
  }

  /**
   * 释放数据库连接（减少引用计数）
   */
  release(libraryPath) {
    const conn = this.connections.get(libraryPath);
    if (conn) {
      conn.refCount = Math.max(0, conn.refCount - 1);
      conn.lastUsed = Date.now();
    }
  }

  /**
   * 强制关闭指定连接
   */
  close(libraryPath) {
    const conn = this.connections.get(libraryPath);
    if (conn) {
      try {
        // 强制设置引用计数为0
        conn.refCount = 0;
        
        // 执行 checkpoint 确保 WAL 写入主数据库
        if (conn.db && conn.db.db) {
          try {
            conn.db.db.pragma('wal_checkpoint(TRUNCATE)');
          } catch (e) {
            logger.warn(`[DBPool] WAL checkpoint warning:`, e.message);
          }
        }
        conn.db.close();
        
        this.connections.delete(libraryPath);
      } catch (error) {
        logger.error(`关闭数据库连接失败:`, error.message);
        // 即使出错也删除引用
        this.connections.delete(libraryPath);
      }
    }
  }

  /**
   * 关闭所有连接
   */
  closeAll() {
    // 先清理定时器，避免在关闭过程中触发清理
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    for (const [path, conn] of this.connections.entries()) {
      try {
        // 执行 checkpoint 确保 WAL 写入主数据库
        if (conn.db && conn.db.db) {
          try {
            conn.db.db.pragma('wal_checkpoint(TRUNCATE)');
          } catch (e) {
            logger.warn(`[DBPool] WAL checkpoint warning:`, e.message);
          }
        }
        conn.db.close();
      } catch (error) {
        logger.error(`关闭数据库连接失败:`, error.message);
      }
    }
    this.connections.clear();
  }

  /**
   * 强制关闭所有连接（用于紧急清理）
   * 与 closeAll() 相同，但提供明确的语义
   */
  forceCloseAll() {
    this.closeAll();
  }

  /**
   * 启动定期清理空闲连接
   */
  startCleanup() {
    const checkInterval = constants.MEMORY.DB_CLEANUP_CHECK_INTERVAL;
    
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const toClose = [];
      
      for (const [path, conn] of this.connections.entries()) {
        // 如果连接空闲超过阈值且没有引用，则关闭
        if (conn.refCount === 0 && now - conn.lastUsed > this.maxIdleTime) {
          toClose.push(path);
        }
      }
      
      toClose.forEach(path => this.close(path));
      
      if (toClose.length > 0) {
        // 关闭连接后立即强制 GC
        if (global.gc) {
          for (let i = 0; i < 3; i++) {
            global.gc();
          }
        }
      }
    }, checkInterval);
  }

  /**
   * 获取连接池状态
   */
  getStatus() {
    const status = [];
    for (const [path, conn] of this.connections.entries()) {
      status.push({
        path,
        refCount: conn.refCount,
        idleTime: Date.now() - conn.lastUsed
      });
    }
    return {
      connections: status,
      totalConnections: this.connections.size,
      maxConnections: this.maxConnections,
      maxIdleTime: this.maxIdleTime
    };
  }

  /**
   * 实现 clear() 方法以支持 CleanupManager 注册
   */
  clear() {
    // 清理空闲连接
    const toClose = [];
    
    for (const [path, conn] of this.connections.entries()) {
      if (conn.refCount === 0) {
        toClose.push(path);
      }
    }
    
    toClose.forEach(path => this.close(path));
  }
}

// 单例模式
const dbPool = new DatabasePool();

module.exports = dbPool;
