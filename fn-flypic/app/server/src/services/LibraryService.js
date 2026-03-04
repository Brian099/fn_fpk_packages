/**
 * 素材库服务层
 * 封装素材库相关的业务逻辑
 */

const fs = require('fs');
const path = require('path');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { getFlypicPath, getDatabasePath, getThumbnailsPath } = require('../config');

class LibraryService {
  constructor(configManager, dbPool, scanManager, lightweightWatcher, io) {
    this.configManager = configManager;
    this.dbPool = dbPool;
    this.scanManager = scanManager;
    this.lightweightWatcher = lightweightWatcher;
    this.io = io;
  }

  /**
   * 获取所有素材库
   */
  getAllLibraries() {
    const config = this.configManager.load();
    return {
      libraries: config.libraries || [],
      currentLibraryId: config.currentLibraryId,
      theme: config.theme || 'light',
      preferences: config.preferences || {}
    };
  }

  /**
   * 创建新素材库
   */
  async createLibrary(name, libraryPath) {
    // 验证参数
    if (!name || !libraryPath) {
      throw new ValidationError('Name and path are required');
    }

    // 规范化路径
    const normalizedPath = path.normalize(libraryPath);
    console.log(`[LibraryService] Creating library: name=${name}, path=${normalizedPath}`);
    
    if (!fs.existsSync(normalizedPath)) {
      console.log(`[LibraryService] Path does not exist: ${normalizedPath}`);
      throw new ValidationError('Path does not exist', 'path');
    }

    // 检查文件夹访问权限
    try {
      // 尝试读取目录
      fs.readdirSync(normalizedPath);
      
      // 尝试在目录中创建测试文件（检查写权限）
      const testFile = path.join(normalizedPath, '.flypic-test');
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch (writeError) {
        console.log(`[LibraryService] No write permission: ${normalizedPath}`);
        throw new ValidationError(
          '无法访问该文件夹。请在飞牛 fnOS 的"数据共享"中将此文件夹添加到 FlyPic 应用的访问权限。',
          'permission'
        );
      }
    } catch (readError) {
      if (readError.code === 'EACCES' || readError.code === 'EPERM') {
        console.log(`[LibraryService] No access permission: ${normalizedPath}`);
        throw new ValidationError(
          '无法访问该文件夹。请在飞牛 fnOS 的"数据共享"中将此文件夹添加到 FlyPic 应用的访问权限。',
          'permission'
        );
      }
      // 如果不是权限错误，继续抛出
      if (readError.name !== 'ValidationError') {
        throw readError;
      }
      throw readError;
    }

    // 检查路径是否已存在
    const config = this.configManager.load();
    const existingLib = config.libraries.find(lib => lib.path === normalizedPath);
    if (existingLib) {
      throw new ValidationError('Library path already exists', 'path');
    }

    // 创建素材库
    const id = this.configManager.addLibrary(name, normalizedPath);

    // 检查是否有现有索引
    const flypicDir = getFlypicPath(normalizedPath);
    const dbPath = getDatabasePath(normalizedPath);
    const hasExistingIndex = fs.existsSync(flypicDir) && fs.existsSync(dbPath);

    return { 
      id, 
      hasExistingIndex,
      message: hasExistingIndex 
        ? 'Library created with existing index' 
        : 'Library created, please scan to build index'
    };
  }

  /**
   * 更新素材库
   */
  updateLibrary(id, updates) {
    const config = this.configManager.load();
    const library = config.libraries.find(lib => lib.id === id);

    if (!library) {
      throw new NotFoundError('Library', id);
    }

    // 验证更新的路径是否存在
    if (updates.path && !fs.existsSync(updates.path)) {
      throw new ValidationError('Path does not exist', 'path');
    }

    const success = this.configManager.updateLibrary(id, updates);
    return { success };
  }

  /**
   * 删除素材库
   * @param {string} id - 素材库ID
   * @param {boolean} autoSelectNext - 是否自动选择下一个素材库，默认 true
   */
  async deleteLibrary(id, autoSelectNext = true) {
    const config = this.configManager.load();
    const library = config.libraries.find(lib => lib.id === id);

    if (!library) {
      throw new NotFoundError('Library', id);
    }

    // 清理资源
    await this._cleanupLibraryResources(id, library.path);

    // 删除配置
    this.configManager.removeLibrary(id, autoSelectNext);

    return { 
      success: true,
      path: library.path,
      message: 'Library deleted successfully'
    };
  }

  /**
   * 设置当前素材库
   */
  async setCurrentLibrary(id) {
    const config = this.configManager.load();
    const library = config.libraries.find(lib => lib.id === id);

    if (!library) {
      throw new NotFoundError('Library', id);
    }

    // 切换前清理旧素材库资源
    if (config.currentLibraryId && config.currentLibraryId !== id) {
      const oldLibrary = config.libraries.find(lib => lib.id === config.currentLibraryId);
      if (oldLibrary) {
        await this._cleanupLibraryResources(config.currentLibraryId, oldLibrary.path, false);
      }
    }

    // 设置新素材库
    this.configManager.setCurrentLibrary(id);

    // 预热数据库连接
    try {
      const db = this.dbPool.acquire(library.path);
      db.db.prepare('SELECT 1').get();
      this.dbPool.release(library.path);
    } catch (e) {
      // 忽略预热错误
    }

    // 启动文件监控
    if (this.lightweightWatcher && this.io) {
      try {
        this.lightweightWatcher.watch(id, library.path, library.name, this.io);
      } catch (e) {
        console.warn('Failed to start file watcher:', e.message);
      }
    }

    return { 
      success: true,
      libraryId: id,
      message: 'Current library set successfully'
    };
  }

  /**
   * 更新偏好设置
   */
  updatePreferences(preferences) {
    this.configManager.updatePreferences(preferences);
    return { success: true };
  }

  /**
   * 更新主题
   */
  updateTheme(theme) {
    if (!['light', 'dark'].includes(theme)) {
      throw new ValidationError('Invalid theme, must be light or dark', 'theme');
    }

    this.configManager.updateTheme(theme);
    return { success: true, theme };
  }

  /**
   * 清理素材库资源
   * @private
   */
  async _cleanupLibraryResources(libraryId, libraryPath, deleteConfig = true) {
    // 停止扫描
    if (this.scanManager) {
      this.scanManager.clearState(libraryId);
    }

    // 停止文件监控
    if (this.lightweightWatcher) {
      this.lightweightWatcher.unwatch(libraryId);
    }

    // 关闭数据库连接
    if (this.dbPool) {
      this.dbPool.close(libraryPath);
    }

    // 等待资源释放
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  /**
   * 验证素材库路径是否存在
   * 返回三种状态：
   * - status: 'ok' - 素材库正常（文件夹和索引都存在）
   * - status: 'missing_index' - 文件夹存在但索引不存在（需要重新扫描）
   * - status: 'missing_folder' - 文件夹不存在（需要打开其他或新建）
   */
  validateLibraryPath(libraryId) {
    const config = this.configManager.load();
    const library = config.libraries.find(lib => lib.id === libraryId);

    if (!library) {
      throw new NotFoundError('Library', libraryId);
    }

    const folderExists = fs.existsSync(library.path);
    const flypicPath = getFlypicPath(library.path);
    const dbPath = getDatabasePath(library.path);
    const indexExists = fs.existsSync(flypicPath) && fs.existsSync(dbPath);
    
    let status = 'ok';
    if (!folderExists) {
      status = 'missing_folder';
    } else if (!indexExists) {
      status = 'missing_index';
    }
    
    return {
      libraryId,
      path: library.path,
      name: library.name,
      folderExists,
      indexExists,
      status
    };
  }

  /**
   * 获取素材库统计信息
   */
  async getLibraryStats(libraryId) {
    const config = this.configManager.load();
    const library = config.libraries.find(lib => lib.id === libraryId);

    if (!library) {
      throw new NotFoundError('Library', libraryId);
    }

    const db = this.dbPool.acquire(library.path);
    try {
      const imageCount = db.db.prepare('SELECT COUNT(*) as count FROM images').get().count;
      const folderCount = db.db.prepare('SELECT COUNT(*) as count FROM folders').get().count;
      
      const sizeResult = db.db.prepare('SELECT SUM(size) as totalSize FROM images').get();
      const totalSize = sizeResult.totalSize || 0;

      return {
        libraryId,
        imageCount,
        folderCount,
        totalSize,
        path: library.path,
        name: library.name
      };
    } finally {
      this.dbPool.release(library.path);
    }
  }
}

module.exports = LibraryService;
