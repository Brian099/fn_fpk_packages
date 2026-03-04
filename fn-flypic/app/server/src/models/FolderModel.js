/**
 * 文件夹数据模型
 */

const BaseModel = require('./BaseModel');
const { mapFolderForFrontend } = require('../utils/fieldMapper');

class FolderModel extends BaseModel {
  /**
   * 根据路径查找文件夹
   */
  findByPath(path) {
    const query = 'SELECT * FROM folders WHERE path = ?';
    const folder = this.findOne(query, [path]);
    return folder ? mapFolderForFrontend(folder) : null;
  }

  /**
   * 获取所有文件夹
   */
  findAll() {
    const query = 'SELECT * FROM folders ORDER BY path';
    return this.findMany(query).map(mapFolderForFrontend);
  }

  /**
   * 获取文件夹树
   */
  getTree() {
    const folders = this.findAll();
    return this._buildTree(folders);
  }

  /**
   * 插入文件夹
   */
  insert(data) {
    const query = `
      INSERT OR REPLACE INTO folders 
      (path, parent_path, name, image_count, last_scan)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    return this.execute(query, [
      data.path,
      data.parentPath || '',
      data.name,
      data.imageCount || 0,
      data.lastScan || Date.now()
    ]);
  }

  /**
   * 更新文件夹图片数量
   */
  updateImageCount(path) {
    const query = `
      UPDATE folders 
      SET image_count = (
        SELECT COUNT(*) FROM images 
        WHERE folder = ? OR folder LIKE ?
      )
      WHERE path = ?
    `;
    return this.execute(query, [path, `${path}/%`, path]);
  }

  /**
   * 删除文件夹
   */
  deleteByPath(path) {
    const query = 'DELETE FROM folders WHERE path = ?';
    return this.execute(query, [path]);
  }

  /**
   * 按前缀批量删除
   */
  deleteByPrefix(prefix) {
    const query = 'DELETE FROM folders WHERE path = ? OR path LIKE ?';
    return this.execute(query, [prefix, `${prefix}/%`]);
  }

  /**
   * 构建文件夹树
   */
  _buildTree(folders) {
    const folderMap = new Map();
    const rootFolders = [];

    // 第一遍：创建映射
    folders.forEach(folder => {
      folderMap.set(folder.path, { ...folder, children: [] });
    });

    // 第二遍：构建树结构
    folders.forEach(folder => {
      const node = folderMap.get(folder.path);
      if (!folder.parentPath || folder.parentPath === '') {
        rootFolders.push(node);
      } else {
        const parent = folderMap.get(folder.parentPath);
        if (parent) {
          parent.children.push(node);
        } else {
          rootFolders.push(node);
        }
      }
    });

    return rootFolders;
  }
}

module.exports = FolderModel;
