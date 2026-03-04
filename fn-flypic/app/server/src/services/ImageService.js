/**
 * 图片服务层
 * 封装图片相关的业务逻辑
 */

const { NotFoundError, ValidationError } = require('../middleware/errorHandler');
const ImageModel = require('../models/ImageModel');
const FolderModel = require('../models/FolderModel');

class ImageService {
  constructor(configManager, dbPool) {
    this.configManager = configManager;
    this.dbPool = dbPool;
  }

  /**
   * 搜索图片
   */
  async searchImages(libraryId, filters = {}, pagination = null) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const imageModel = new ImageModel(db.db);
      return imageModel.search(filters, pagination);
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 获取图片详情
   */
  async getImageById(libraryId, imageId) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const imageModel = new ImageModel(db.db);
      const image = imageModel.findById(imageId);

      if (!image) {
        throw new NotFoundError('Image', imageId);
      }

      return image;
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 根据路径获取图片
   */
  async getImageByPath(libraryId, imagePath) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const imageModel = new ImageModel(db.db);
      const image = imageModel.findByPath(imagePath);

      if (!image) {
        throw new NotFoundError('Image', imagePath);
      }

      return image;
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 获取图片总数
   */
  async getImageCount(libraryId, filters = {}) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const imageModel = new ImageModel(db.db);
      return imageModel.count(filters);
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 获取图片统计信息
   */
  async getImageStats(libraryId) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const stats = db.db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(size) as totalSize,
          AVG(size) as avgSize,
          MAX(size) as maxSize,
          MIN(size) as minSize,
          COUNT(DISTINCT format) as formatCount,
          COUNT(DISTINCT folder) as folderCount
        FROM images
      `).get();

      const formatStats = db.db.prepare(`
        SELECT format, COUNT(*) as count
        FROM images
        GROUP BY format
        ORDER BY count DESC
      `).all();

      return {
        ...stats,
        formats: formatStats
      };
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 获取文件夹列表
   */
  async getFolders(libraryId) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const folderModel = new FolderModel(db.db);
      return folderModel.getTree();
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 获取缓存元数据
   */
  async getCacheMeta(libraryId) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const result = db.db.prepare(`
        SELECT 
          COUNT(*) as totalImages,
          COUNT(DISTINCT folder) as totalFolders,
          MAX(indexed_at) as lastIndexed
        FROM images
      `).get();

      return {
        libraryId,
        ...result,
        dbPath: library.path
      };
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 批量更新图片评分
   */
  async updateRating(libraryId, paths, rating) {
    const library = this._getLibrary(libraryId);
    const db = this.dbPool.acquire(library.path);

    try {
      const imageModel = new ImageModel(db.db);
      const results = {
        success: [],
        failed: []
      };

      // 批量更新
      for (const imagePath of paths) {
        try {
          const stmt = db.db.prepare('UPDATE images SET rating = ? WHERE path = ?');
          const result = stmt.run(rating, imagePath);
          
          if (result.changes > 0) {
            results.success.push(imagePath);
          } else {
            results.failed.push({ path: imagePath, error: '图片不存在' });
          }
        } catch (error) {
          results.failed.push({ path: imagePath, error: error.message });
        }
      }

      // 更新数据库修改时间
      if (results.success.length > 0) {
        db.updateLastModified();
      }

      return {
        updated: results.success.length,
        failed: results.failed.length,
        success: results.success,
        failed: results.failed
      };
    } finally {
      this.dbPool.release(library.path);
    }
  }

  /**
   * 获取素材库对象
   * @private
   */
  _getLibrary(libraryId) {
    const config = this.configManager.load();
    const library = config.libraries.find(lib => lib.id === libraryId);

    if (!library) {
      throw new NotFoundError('Library', libraryId);
    }

    return library;
  }
}

module.exports = ImageService;
