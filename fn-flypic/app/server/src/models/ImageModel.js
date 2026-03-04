/**
 * 图片数据模型
 */

const BaseModel = require('./BaseModel');
const { mapImageForFrontend } = require('../utils/fieldMapper');

class ImageModel extends BaseModel {
  /**
   * 根据 ID 查找图片
   */
  findById(id) {
    const query = 'SELECT * FROM images WHERE id = ?';
    const image = this.findOne(query, [id]);
    return image ? mapImageForFrontend(image) : null;
  }

  /**
   * 根据路径查找图片
   */
  findByPath(path) {
    const query = 'SELECT * FROM images WHERE path = ?';
    const image = this.findOne(query, [path]);
    return image ? mapImageForFrontend(image) : null;
  }

  /**
   * 搜索图片（支持分页）
   */
  search(filters = {}, pagination = null) {
    const { query, params } = this._buildSearchQuery(filters, pagination);
    
    // 获取总数（不包含分页参数）
    const { query: countQueryBase, params: countParams } = this._buildSearchQuery(filters, null);
    const countQuery = countQueryBase
      .replace('SELECT *', 'SELECT COUNT(*) as total')
      .split('ORDER BY')[0];
    const { total } = this.findOne(countQuery, countParams);
    
    // 获取数据
    const images = this.findMany(query, params).map(mapImageForFrontend);
    
    // 统一返回对象格式
    if (pagination) {
      return {
        images,
        total,
        offset: pagination.offset,
        limit: pagination.limit,
        hasMore: pagination.offset + images.length < total
      };
    }
    
    // 无分页时也返回对象格式
    return {
      images,
      total
    };
  }

  /**
   * 插入图片
   */
  insert(data) {
    const query = `
      INSERT OR REPLACE INTO images 
      (path, filename, folder, size, width, height, format, file_type,
       created_at, modified_at, file_hash, thumbnail_path, thumbnail_size, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    return this.execute(query, [
      data.path,
      data.filename,
      data.folder,
      data.size,
      data.width,
      data.height,
      data.format,
      data.fileType || 'image',
      data.createdAt,
      data.modifiedAt,
      data.fileHash,
      data.thumbnailPath,
      data.thumbnailSize,
      Date.now()
    ]);
  }

  /**
   * 批量插入图片
   */
  insertBatch(images) {
    const query = `
      INSERT OR REPLACE INTO images 
      (path, filename, folder, size, width, height, format, file_type,
       created_at, modified_at, file_hash, thumbnail_path, thumbnail_size, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    return this.transaction(() => {
      const stmt = this.db.prepare(query);
      for (const data of images) {
        stmt.run(
          data.path, data.filename, data.folder, data.size,
          data.width, data.height, data.format, data.fileType || 'image',
          data.createdAt, data.modifiedAt, data.fileHash,
          data.thumbnailPath, data.thumbnailSize, Date.now()
        );
      }
    });
  }

  /**
   * 更新图片
   */
  update(path, data) {
    const fields = [];
    const params = [];
    
    Object.entries(data).forEach(([key, value]) => {
      fields.push(`${key} = ?`);
      params.push(value);
    });
    
    params.push(path);
    
    const query = `UPDATE images SET ${fields.join(', ')} WHERE path = ?`;
    return this.execute(query, params);
  }

  /**
   * 删除图片
   */
  deleteByPath(path) {
    const query = 'DELETE FROM images WHERE path = ?';
    return this.execute(query, [path]);
  }

  /**
   * 按文件夹前缀批量删除
   */
  deleteByFolderPrefix(folderPrefix) {
    const query = 'DELETE FROM images WHERE folder = ? OR folder LIKE ?';
    return this.execute(query, [folderPrefix, `${folderPrefix}/%`]);
  }

  /**
   * 获取图片总数
   */
  count(filters = {}) {
    const { query, params } = this._buildSearchQuery(filters);
    const countQuery = query
      .replace('SELECT *', 'SELECT COUNT(*) as count')
      .split('ORDER BY')[0];
    const { count } = this.findOne(countQuery, params);
    return count;
  }

  /**
   * 构建搜索查询
   */
  _buildSearchQuery(filters = {}, pagination = null) {
    let query = 'SELECT * FROM images WHERE 1=1';
    const params = [];

    // 关键词搜索（AND 逻辑）
    if (filters.keywords) {
      const terms = filters.keywords.trim().split(/\s+/);
      terms.forEach(term => {
        query += ' AND filename LIKE ?';
        params.push(`%${term}%`);
      });
    }

    // 文件夹过滤（包含子文件夹）
    if (filters.folder) {
      query += ' AND (folder = ? OR folder LIKE ?)';
      params.push(filters.folder, `${filters.folder}/%`);
    }

    // 格式过滤
    if (filters.formats && filters.formats.length > 0) {
      const placeholders = filters.formats.map(() => '?').join(',');
      query += ` AND format IN (${placeholders})`;
      params.push(...filters.formats);
    }

    // 大小过滤
    if (filters.minSize) {
      query += ' AND size >= ?';
      params.push(filters.minSize);
    }
    if (filters.maxSize) {
      query += ' AND size <= ?';
      params.push(filters.maxSize);
    }

    // 日期过滤
    if (filters.startDate) {
      query += ' AND created_at >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND created_at <= ?';
      params.push(filters.endDate);
    }

    // 排序
    query += ' ORDER BY created_at DESC';

    // 分页
    if (pagination) {
      query += ' LIMIT ? OFFSET ?';
      params.push(pagination.limit, pagination.offset);
    }

    return { query, params };
  }
}

module.exports = ImageModel;
