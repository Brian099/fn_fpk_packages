/**
 * Memory Monitor
 * Continuously monitors memory usage and triggers cleanup when thresholds are exceeded
 */

const logger = require('../src/utils/logger');

class MemoryMonitor {
  constructor(options = {}) {
    this.warningThreshold = options.warningThreshold || 150 * 1024 * 1024; // 150MB
    this.dangerThreshold = options.dangerThreshold || 300 * 1024 * 1024;   // 300MB
    this.checkInterval = options.checkInterval || 2000; // 2 seconds
    this.cleanupManager = options.cleanupManager;
    this.devMode = options.devMode || process.env.NODE_ENV === 'development';
    this.devLogInterval = options.devLogInterval || 30000; // 30 seconds
    
    this.intervalId = null;
    this.devLogIntervalId = null;
    this.isRunning = false;
    this.lastWarningTime = 0;
    this.lastDangerTime = 0;
    this.warningCooldown = 10000; // 10 seconds between warnings
  }

  /**
   * Start monitoring memory usage
   */
  start() {
    if (this.isRunning) return;

    logger.perf('内存监控已启动');

    this.isRunning = true;

    // Start periodic memory checks
    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.checkInterval);

    // Start development mode logging
    if (this.devMode) {
      this.devLogIntervalId = setInterval(() => {
        const stats = this.getMemoryStats();
        this.logMemoryStats(stats, 'DEV');
      }, this.devLogInterval);
    }

    // Initial check
    this.checkMemory();
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isRunning) return;

    logger.perf('内存监控已停止');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.devLogIntervalId) {
      clearInterval(this.devLogIntervalId);
      this.devLogIntervalId = null;
    }

    this.isRunning = false;
  }

  /**
   * Get current memory statistics
   * @returns {Object} Memory statistics
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
   * Check memory and trigger actions if thresholds exceeded
   */
  checkMemory() {
    const stats = this.getMemoryStats();
    const heapUsedMB = stats.heapUsed / 1024 / 1024;

    // Check danger threshold first
    if (stats.heapUsed > this.dangerThreshold) {
      this.handleDanger(stats);
    }
    // Check warning threshold
    else if (stats.heapUsed > this.warningThreshold) {
      this.handleWarning(stats);
    }

    return stats;
  }

  /**
   * Handle warning threshold exceeded
   */
  handleWarning(stats) {
    const now = Date.now();
    
    // Cooldown to avoid spam
    if (now - this.lastWarningTime < this.warningCooldown) {
      return;
    }

    this.lastWarningTime = now;
    
    this.logMemoryStats(stats, 'WARNING');
  }

  /**
   * Handle danger threshold exceeded
   */
  handleDanger(stats) {
    const now = Date.now();
    
    // Cooldown to avoid spam (shorter for danger)
    if (now - this.lastDangerTime < 5000) {
      return;
    }

    this.lastDangerTime = now;
    
    this.logMemoryStats(stats, 'DANGER');

    // Trigger emergency cleanup if cleanup manager is available
    if (this.cleanupManager) {
      logger.perf('触发紧急清理...');
      try {
        this.cleanupManager.executeEmergencyCleanup();
        
        // 等待一下再检查
        setTimeout(() => {
          const afterStats = this.getMemoryStats();
          const afterRSS = afterStats.rss / 1024 / 1024;
          
          // 如果 RSS 仍然很高，强制更多 GC
          if (afterRSS > 500) {
            if (global.gc) {
              for (let i = 0; i < 10; i++) {
                global.gc();
              }
            }
          }
        }, 1000);
      } catch (error) {
        logger.error('紧急清理失败:', error.message);
      }
    }
  }

  /**
   * Log memory statistics with detailed breakdown
   */
  logMemoryStats(stats, level = 'INFO') {
    const heapUsedMB = (stats.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (stats.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (stats.rss / 1024 / 1024).toFixed(2);
    const externalMB = (stats.external / 1024 / 1024).toFixed(2);
    const arrayBuffersMB = (stats.arrayBuffers / 1024 / 1024).toFixed(2);

    const message = `内存状态 [${level}]: Heap ${heapUsedMB}/${heapTotalMB} MB, RSS ${rssMB} MB`;
    if (level === 'WARNING' || level === 'DANGER') {
      logger.warn(message);
    } else {
      logger.perf(message);
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      warningThreshold: this.warningThreshold,
      dangerThreshold: this.dangerThreshold,
      checkInterval: this.checkInterval,
      currentMemory: this.isRunning ? this.getMemoryStats() : null
    };
  }
}

module.exports = MemoryMonitor;
