/**
 * 扫描状态管理器（简化版）
 * 只负责进度持久化，无暂停功能
 */

const fs = require('fs');
const path = require('path');

class ScanManager {
  constructor() {
    this.scanStates = new Map();
    this.libraryPaths = new Map();
    this.saveTimers = new Map();
  }

  /**
   * 注册素材库路径
   */
  registerLibraryPath(libraryId, libraryPath) {
    this.libraryPaths.set(libraryId, libraryPath);
    this._restoreStateFromFile(libraryId);
  }

  /**
   * 获取状态文件路径
   */
  getStateFilePath(libraryId) {
    const libraryPath = this.libraryPaths.get(libraryId);
    if (!libraryPath) return null;
    return path.join(libraryPath, '.flypic', 'scan-state.json');
  }

  /**
   * 保存状态到文件
   */
  saveState(libraryId) {
    const stateFile = this.getStateFilePath(libraryId);
    if (!stateFile) return;
    
    const state = this.scanStates.get(libraryId);
    
    if (!state || state.status === 'idle') {
      try {
        if (fs.existsSync(stateFile)) {
          fs.unlinkSync(stateFile);
        }
      } catch (e) { /* ignore */ }
      return;
    }
    
    try {
      const dir = path.dirname(stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const saveData = {
        status: state.status,
        progress: state.progress,
        startTime: state.startTime,
        savedAt: Date.now()
      };
      
      fs.writeFileSync(stateFile, JSON.stringify(saveData, null, 2));
    } catch (e) {
      console.error('❌ 保存扫描状态失败:', e.message);
    }
  }

  /**
   * 定时保存（每5秒）
   */
  _scheduleSave(libraryId) {
    if (this.saveTimers.has(libraryId)) {
      clearTimeout(this.saveTimers.get(libraryId));
    }
    const timer = setTimeout(() => {
      this.saveState(libraryId);
      this.saveTimers.delete(libraryId);
    }, 5000);
    this.saveTimers.set(libraryId, timer);
  }

  /**
   * 从文件加载状态
   */
  loadState(libraryId) {
    const stateFile = this.getStateFilePath(libraryId);
    if (!stateFile || !fs.existsSync(stateFile)) return null;
    
    try {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      // 24小时过期
      if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(stateFile);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * 从文件恢复状态
   */
  _restoreStateFromFile(libraryId) {
    if (this.scanStates.has(libraryId)) {
      return;
    }
    
    const fileState = this.loadState(libraryId);
    
    if (fileState && fileState.status === 'scanning') {
      this.scanStates.set(libraryId, {
        status: fileState.status,
        progress: fileState.progress,
        startTime: fileState.startTime
      });
      console.log(`🔄 恢复扫描状态: ${fileState.progress?.percent || 0}%`);
    }
  }

  /**
   * 获取扫描状态
   */
  getState(libraryId) {
    const memState = this.scanStates.get(libraryId);
    if (memState) return memState;
    
    const fileState = this.loadState(libraryId);
    if (fileState && fileState.status === 'scanning') {
      const restored = {
        status: 'scanning',
        progress: fileState.progress,
        startTime: fileState.startTime
      };
      this.scanStates.set(libraryId, restored);
      return restored;
    }
    
    return { status: 'idle', progress: null };
  }

  /**
   * 开始扫描
   */
  startScan(libraryId, totalFiles, libraryPath) {
    // 确保路径已注册
    if (libraryPath && !this.libraryPaths.has(libraryId)) {
      this.libraryPaths.set(libraryId, libraryPath);
    }
    
    if (this.saveTimers.has(libraryId)) {
      clearTimeout(this.saveTimers.get(libraryId));
      this.saveTimers.delete(libraryId);
    }
    
    this.scanStates.set(libraryId, {
      status: 'scanning',
      progress: { current: 0, total: totalFiles, percent: 0 },
      startTime: Date.now()
    });
    
    this.saveState(libraryId);
    return this.scanStates.get(libraryId);
  }

  /**
   * 更新进度
   */
  updateProgress(libraryId, current, total) {
    const state = this.scanStates.get(libraryId);
    if (state) {
      state.progress = {
        current,
        total,
        percent: Math.round((current / total) * 100)
      };
      this._scheduleSave(libraryId);
    }
  }

  /**
   * 完成扫描
   */
  completeScan(libraryId) {
    this.scanStates.delete(libraryId);
    this.saveState(libraryId);
  }

  /**
   * 是否正在扫描
   */
  isScanning(libraryId) {
    const state = this.scanStates.get(libraryId);
    return state?.status === 'scanning';
  }

  /**
   * 清除素材库状态（删除素材库时调用）
   */
  clearState(libraryId) {
    this.scanStates.delete(libraryId);
    this.libraryPaths.delete(libraryId);
    // 删除状态文件
    const stateFile = this.getStateFilePath(libraryId);
    if (stateFile) {
      try {
        const fs = require('fs');
        if (fs.existsSync(stateFile)) {
          fs.unlinkSync(stateFile);
        }
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * 获取所有活跃状态
   */
  getAllActiveStates() {
    const activeStates = {};
    for (const [libraryId, state] of this.scanStates.entries()) {
      if (state.status === 'scanning') {
        activeStates[libraryId] = {
          status: state.status,
          progress: state.progress,
          startTime: state.startTime
        };
      }
    }
    return activeStates;
  }

  /**
   * 恢复所有素材库状态
   */
  restoreAllStates(libraries) {
    for (const lib of libraries) {
      this.registerLibraryPath(lib.id, lib.path);
    }
  }
}

const scanManager = new ScanManager();
module.exports = scanManager;
