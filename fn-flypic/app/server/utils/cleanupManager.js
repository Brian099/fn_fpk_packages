/**
 * Cleanup Manager
 * Executes routine and emergency memory cleanup procedures
 */

class CleanupManager {
  constructor(options = {}) {
    this.routineInterval = options.routineInterval || 5000; // 5 seconds
    this.dbPool = options.dbPool;
    this.caches = new Map(); // name -> cache object with clear() method
    
    this.routineIntervalId = null;
    this.isRunning = false;
    this.cleanupCount = 0;
    this.lastCleanupTime = 0;
  }

  /**
   * Start routine cleanup
   */
  startRoutineCleanup() {
    if (this.isRunning) return;

    console.log('🧹 清理管理器已启动');
    this.isRunning = true;

    this.routineIntervalId = setInterval(() => {
      this.executeRoutineCleanup();
    }, this.routineInterval);
  }

  /**
   * Stop routine cleanup
   */
  stopRoutineCleanup() {
    if (!this.isRunning) return;

    console.log('🧹 清理管理器已停止');
    
    if (this.routineIntervalId) {
      clearInterval(this.routineIntervalId);
      this.routineIntervalId = null;
    }

    this.isRunning = false;
  }

  /**
   * Execute routine cleanup
   * - Clear registered caches
   * - Trigger garbage collection (if available)
   */
  executeRoutineCleanup() {
    const memoryBefore = this.getMemoryStats();
    const rssBefore = memoryBefore.rss / 1024 / 1024;
    
    try {
      // Clear all registered caches
      const cachesCleared = this.clearAllCaches();

      // 强制多次 GC（更激进）
      if (global.gc) {
        // 执行 5 次 GC 确保内存真正释放
        for (let i = 0; i < 5; i++) {
          global.gc();
        }
      }

      const memoryAfter = this.getMemoryStats();
      const rssAfter = memoryAfter.rss / 1024 / 1024;
      const memoryReclaimed = memoryBefore.heapUsed - memoryAfter.heapUsed;
      const rssReclaimed = rssBefore - rssAfter;

      this.cleanupCount++;
      this.lastCleanupTime = Date.now();

      // 只在内存回收显著时输出日志
      if (Math.abs(rssReclaimed) > 10) {
        console.log(`🧹 内存清理: ${rssBefore.toFixed(0)}MB → ${rssAfter.toFixed(0)}MB`);
      }

      return {
        memoryBefore,
        memoryAfter,
        memoryReclaimed,
        cachesCleared,
        connectionsCleared: 0
      };
    } catch (error) {
      console.error('❌ 清理失败:', error.message);
      return null;
    }
  }

  /**
   * Execute emergency cleanup
   * - Force close all database connections
   * - Clear all caches
   * - Force garbage collection multiple times (3+)
   */
  executeEmergencyCleanup() {
    console.log('🚨 执行紧急内存清理...');
    
    const memoryBefore = this.getMemoryStats();
    
    try {
      // 1. Force close all database connections
      let connectionsCleared = 0;
      if (this.dbPool) {
        try {
          this.dbPool.closeAll();
          connectionsCleared = 1;
          console.log('  ✓ 数据库连接已关闭');
        } catch (error) {
          console.error('  ✗ 关闭连接失败:', error.message);
        }
      }

      // 2. Clear all registered caches
      const cachesCleared = this.clearAllCaches();
      console.log(`  ✓ 已清理 ${cachesCleared} 个缓存`);

      // 3. Force garbage collection multiple times (minimum 3)
      this.forceGarbageCollection(3);

      const memoryAfter = this.getMemoryStats();
      const memoryReclaimed = memoryBefore.heapUsed - memoryAfter.heapUsed;

      console.log(`✅ 紧急清理完成: 回收 ${(memoryReclaimed / 1024 / 1024).toFixed(0)}MB`);

      return {
        memoryBefore,
        memoryAfter,
        memoryReclaimed,
        cachesCleared,
        connectionsCleared
      };
    } catch (error) {
      console.error('❌ 紧急清理失败:', error.message);
      return null;
    }
  }

  /**
   * Force garbage collection multiple times
   * @param {number} iterations - Number of GC iterations (minimum 3)
   */
  forceGarbageCollection(iterations = 3) {
    if (!global.gc) return;

    const actualIterations = Math.max(3, iterations);
    for (let i = 0; i < actualIterations; i++) {
      try {
        global.gc();
      } catch (error) {
        console.error(`  ✗ GC失败 (${i + 1}/${actualIterations}):`, error.message);
      }
    }
  }

  /**
   * Clear all registered caches
   * @returns {number} Number of caches cleared
   */
  clearAllCaches() {
    let cleared = 0;

    for (const [name, cache] of this.caches.entries()) {
      try {
        if (cache && typeof cache.clear === 'function') {
          cache.clear();
          cleared++;
        }
      } catch (error) {
        console.error(`❌ 清理缓存失败 "${name}":`, error.message);
      }
    }

    return cleared;
  }

  /**
   * Register a cache for cleanup
   * @param {string} name - Cache name
   * @param {Object} cache - Cache object with clear() method
   */
  registerCache(name, cache) {
    if (!cache || typeof cache.clear !== 'function') {
      console.warn(`⚠️ 缓存 "${name}" 无clear()方法`);
      return;
    }

    this.caches.set(name, cache);
  }

  /**
   * Unregister a cache
   * @param {string} name - Cache name
   */
  unregisterCache(name) {
    this.caches.delete(name);
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats() {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
      timestamp: Date.now()
    };
  }

  /**
   * Get cleanup manager status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      routineInterval: this.routineInterval,
      cleanupCount: this.cleanupCount,
      lastCleanupTime: this.lastCleanupTime,
      registeredCaches: Array.from(this.caches.keys())
    };
  }
}

module.exports = CleanupManager;
