/**
 * 文件操作服务
 * 提供删除、重命名、移动、复制等文件操作功能
 */

const fs = require('fs');
const path = require('path');
const { processImage } = require('../../utils/scanner');

// 临时备份目录（用于撤销恢复）- 放在 .flypic 内部
const TEMP_BACKUP_DIR = '.flypic/temp_backup';

class FileService {
  constructor(dbPool, configManager) {
    this.dbPool = dbPool;
    this.configManager = configManager;
  }

  /**
   * 恢复文件（从临时备份恢复）
   * @param {string} libraryId - 素材库ID
   * @param {Array} items - 待恢复项 [{type: 'file'|'folder', path: 'relative/path'}]
   */
  async restoreItems(libraryId, items) {
    const db = this._getDatabase(libraryId);
    const libraryPath = db.libraryPath;
    const backupDir = path.join(libraryPath, TEMP_BACKUP_DIR);
    const results = { success: [], failed: [] };

    if (!fs.existsSync(backupDir)) {
      throw new Error('备份目录不存在，无法恢复');
    }

    for (const item of items) {
      try {
        const backupPath = path.join(backupDir, item.path);
        const originalPath = path.join(libraryPath, item.path);
        const metaPath = backupPath + '.meta.json';

        console.log(`🔄 开始恢复: ${item.path} (${item.type})`);

        // 检查备份是否存在
        if (!fs.existsSync(backupPath)) {
          results.failed.push({ path: item.path, error: '备份不存在（可能已超过5分钟被清理）' });
          continue;
        }

        // 确保目标目录存在
        const targetDir = path.dirname(originalPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // 读取元数据文件（包含数据库记录）
        let imageRecords = null;
        let folderRecords = null;
        if (fs.existsSync(metaPath)) {
          try {
            const metaContent = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            imageRecords = metaContent.imageRecords;
            folderRecords = metaContent.folderRecords;
            console.log(`  读取到 ${Array.isArray(imageRecords) ? imageRecords.length : (imageRecords ? 1 : 0)} 条图片记录`);
            console.log(`  读取到 ${folderRecords ? folderRecords.length : 0} 条文件夹记录`);
          } catch (error) {
            console.warn(`读取meta失败 ${metaPath}:`, error);
          }
        }

        // 移动回原位置
        try {
          fs.renameSync(backupPath, originalPath);
        } catch (renameError) {
          console.log(`  ⚠️ rename失败，使用复制方式`);
          // rename 失败时使用复制+删除
          if (item.type === 'folder') {
            this._copyDirSync(backupPath, originalPath);
            fs.rmSync(backupPath, { recursive: true, force: true });
          } else {
            fs.copyFileSync(backupPath, originalPath);
            fs.unlinkSync(backupPath);
          }
        }

        // 恢复数据库记录（先文件夹后图片）
        if (folderRecords && folderRecords.length > 0) {
          for (const folderRecord of folderRecords) {
            try {
              const stmt = db.db.prepare(
                'INSERT OR REPLACE INTO folders (path, parent_path, name, image_count, last_scan) VALUES (?, ?, ?, ?, ?)'
              );
              stmt.run(
                folderRecord.path,
                folderRecord.parent_path || null,
                folderRecord.name,
                folderRecord.image_count || 0,
                folderRecord.last_scan || Date.now()
              );
            } catch (error) {
              console.warn(`恢复文件夹记录失败: ${folderRecord.path}`, error);
            }
          }
        } else if (item.type === 'folder') {
          // 空文件夹没有数据库记录，需要重新创建
          try {
            const folderName = path.basename(item.path);
            const parentPath = path.dirname(item.path);
            const stmt = db.db.prepare(
              'INSERT OR REPLACE INTO folders (path, parent_path, name, image_count, last_scan) VALUES (?, ?, ?, ?, ?)'
            );
            stmt.run(
              item.path,
              parentPath === '.' ? null : parentPath,
              folderName,
              0,
              Date.now()
            );
            console.log(`  创建空文件夹记录: ${item.path}`);
          } catch (error) {
            console.warn(`创建文件夹记录失败: ${item.path}`, error);
          }
        }
        
        if (imageRecords) {
          const records = Array.isArray(imageRecords) ? imageRecords : [imageRecords];
          for (const record of records) {
            try {
              db.insertImage(record);
            } catch (error) {
              console.warn(`恢复图片记录失败: ${record.path}`, error);
            }
          }
        }

        // 删除元数据文件
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
        }

        results.success.push(item.path);
        console.log(`✅ 恢复成功: ${item.path}`);
      } catch (error) {
        console.error(`恢复失败 ${item.path}:`, error);
        results.failed.push({ path: item.path, error: error.message });
      }
    }

    // 如果备份目录为空，删除它
    try {
      const files = fs.readdirSync(backupDir);
      if (files.length === 0) {
        fs.rmdirSync(backupDir);
      }
    } catch (error) {
      // 忽略错误
    }

    // 更新文件夹计数（关键：确保计数准确）
    if (results.success.length > 0) {
      db.updateAllFolderCounts();
    }

    return results;
  }

  /**
   * 清理过期的临时文件（超过5分钟的移入回收站）
   * @param {string} libraryId - 素材库ID
   */
  async cleanExpiredTempFiles(libraryId) {
    const db = this._getDatabase(libraryId);
    const libraryPath = db.libraryPath;
    const backupDir = path.join(libraryPath, TEMP_BACKUP_DIR);
    
    if (!fs.existsSync(backupDir)) {
      return { cleaned: 0, failed: 0, thumbnailsCleaned: 0 };
    }

    const FIVE_MINUTES = 5 * 60 * 1000; // 5分钟
    const now = Date.now();
    let cleaned = 0;
    let failed = 0;
    let thumbnailsCleaned = 0; // 统计清理的缩略图数量

    // 递归扫描备份目录
    const scanDir = async (dir) => {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const fullPath = path.join(dir, file);
        
        // 跳过 meta 文件
        if (file.endsWith('.meta.json')) continue;
        
        const metaPath = fullPath + '.meta.json';
        
        // 检查是否有对应的 meta 文件
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const age = now - meta.deletedAt;
            
            // 超过5分钟，移入系统回收站
            if (age > FIVE_MINUTES) {
              try {
                // 1. 清理缩略图（在移入回收站前）
                if (meta.imageRecords) {
                  const records = Array.isArray(meta.imageRecords) ? meta.imageRecords : [meta.imageRecords];
                  for (const record of records) {
                    if (record.thumbnail_path) {
                      try {
                        const thumbnailFullPath = path.join(libraryPath, record.thumbnail_path);
                        if (fs.existsSync(thumbnailFullPath)) {
                          fs.unlinkSync(thumbnailFullPath);
                          thumbnailsCleaned++;
                          console.log(`🧹 已清理缩略图: ${record.thumbnail_path}`);
                        }
                      } catch (thumbError) {
                        console.warn(`清理缩略图失败 ${record.thumbnail_path}:`, thumbError.message);
                      }
                    }
                  }
                }
                
                // 2. 移入系统回收站
                // trash v8 是 ESM 模块，需要使用动态 import
                const { default: trash } = await import('trash');
                await trash([fullPath]);
                fs.unlinkSync(metaPath); // 删除 meta 文件
                cleaned++;
                console.log(`🗑️ 已将过期文件移入回收站: ${meta.originalPath}`);
              } catch (error) {
                console.error(`清理失败 ${meta.originalPath}:`, error);
                failed++;
              }
            }
          } catch (error) {
            console.error(`读取 meta 失败 ${metaPath}:`, error);
          }
        } else if (fs.statSync(fullPath).isDirectory()) {
          // 递归处理子目录
          await scanDir(fullPath);
        }
      }
    };

    await scanDir(backupDir);

    // 清理完成后，递归删除所有空文件夹
    const removeEmptyDirs = (dir) => {
      try {
        // 检查目录是否存在
        if (!fs.existsSync(dir)) {
          return;
        }

        // 读取目录内容
        let entries;
        try {
          entries = fs.readdirSync(dir);
        } catch (error) {
          // 目录可能已被删除或无权限访问
          return;
        }

        // 先递归处理所有子目录
        for (const entry of entries) {
          const fullPath = path.join(dir, entry);
          try {
            // 检查是否存在且为目录
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
              removeEmptyDirs(fullPath);
            }
          } catch (error) {
            // 文件可能在处理过程中被删除，忽略
            continue;
          }
        }

        // 再次检查当前目录是否为空（因为子目录可能已被删除）
        let remainingFiles;
        try {
          remainingFiles = fs.readdirSync(dir);
        } catch (error) {
          // 目录可能已被删除
          return;
        }

        // 如果目录为空，则删除它（除了根 temp_backup 目录）
        if (remainingFiles.length === 0) {
          if (dir === backupDir) {
            // 根目录也删除（如果完全为空）
            try {
              fs.rmdirSync(dir);
              console.log(`🧹 已删除空的备份目录: ${TEMP_BACKUP_DIR}`);
            } catch (error) {
              // 忽略根目录删除失败
            }
          } else {
            // 子目录删除
            try {
              fs.rmdirSync(dir);
              const relativePath = path.relative(backupDir, dir);
              console.log(`🧹 已删除空文件夹: ${relativePath}`);
            } catch (error) {
              // 忽略删除失败（可能权限问题）
            }
          }
        }
      } catch (error) {
        // 忽略所有其他错误
      }
    };

    // 执行清理空文件夹
    try {
      removeEmptyDirs(backupDir);
    } catch (error) {
      console.warn('[cleanExpiredTempFiles] 清理空文件夹时出错:', error.message);
    }

    return { cleaned, failed, thumbnailsCleaned };
  }

  /**
   * 递归复制目录
   */
  _copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    
    for (const file of files) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      const stat = fs.statSync(srcPath);
      
      if (stat.isDirectory()) {
        this._copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 获取数据库实例
   */
  _getDatabase(libraryId) {
    const config = this.configManager.load();
    const library = config.libraries.find(lib => lib.id === libraryId);
    if (!library) {
      throw new Error(`素材库不存在: ${libraryId}`);
    }
    return this.dbPool.acquire(library.path);
  }

  /**
   * 删除文件或文件夹（移到临时文件夹，5分钟内可撤销）
   * @param {string} libraryId - 素材库ID
   * @param {Array} items - 待删除项 [{type: 'file'|'folder', path: 'relative/path'}]
   */
  async deleteItems(libraryId, items) {
    const db = this._getDatabase(libraryId);
    const libraryPath = db.libraryPath;
    const results = { success: [], failed: [] };

    for (const item of items) {
      try {
        const fullPath = path.join(libraryPath, item.path);

        // 检查文件/文件夹是否存在
        if (!fs.existsSync(fullPath)) {
          if (item.type === 'folder') {
            // 物理文件夹已不存在：视为只需要清理数据库中的“空壳”记录
            console.warn(`目标文件夹不存在，仅清理数据库记录: ${item.path}`);
            try {
              db.deleteImagesByFolderPrefix(item.path);
              db.deleteFoldersByPrefix(item.path);
              results.success.push(item.path);
            } catch (e) {
              console.error(`清理不存在文件夹的数据库记录失败 ${item.path}:`, e.message);
              results.failed.push({ path: item.path, error: e.message });
            }
          } else {
            // 文件不存在仍然视为失败，提示用户
            results.failed.push({ path: item.path, error: '文件不存在' });
          }
          continue;
        }

        // 移到临时备份文件夹（5分钟内可撤销）
        const backupDir = path.join(libraryPath, TEMP_BACKUP_DIR);
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        const backupPath = path.join(backupDir, item.path);
        const backupParentDir = path.dirname(backupPath);
        
        // 确保备份目录存在
        if (!fs.existsSync(backupParentDir)) {
          fs.mkdirSync(backupParentDir, { recursive: true });
        }

        // 移动文件到备份目录
        try {
          // 尝试直接 rename（快速）
          fs.renameSync(fullPath, backupPath);
        } catch (renameError) {
          // rename 失败（可能是权限问题或跨磁盘），使用复制+删除
          console.log(`⚠️ rename失败，使用复制方式: ${item.path}`);
          if (item.type === 'folder') {
            // 文件夹：递归复制
            this._copyDirSync(fullPath, backupPath);
            // 删除原文件夹
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            // 文件：直接复制
            fs.copyFileSync(fullPath, backupPath);
            fs.unlinkSync(fullPath);
          }
        }
        
        // 记录删除时间（用于5分钟后清理）
        const metaPath = backupPath + '.meta.json';
        fs.writeFileSync(metaPath, JSON.stringify({
          originalPath: item.path,
          deletedAt: Date.now(),
          type: item.type
        }));
        
        console.log(`📦 已移入临时文件夹: ${item.path}`);
        
        // 删除数据库记录前，先保存到meta（恢复时需要）
        let imageRecords = null;
        let folderRecords = null;
        
        if (item.type === 'folder') {
          // 保存文件夹内所有图片和文件夹的数据库记录
          imageRecords = db.getImagesByFolderPrefix(item.path);
          const stmt = db.db.prepare('SELECT * FROM folders WHERE path = ? OR path LIKE ?');
          folderRecords = stmt.all(item.path, `${item.path}/%`);
          
          console.log(`🔍 删除文件夹: ${item.path} (图片:${imageRecords?.length || 0}, 子文件夹:${folderRecords?.length || 0})`);
          
          // 删除数据库记录
          db.deleteImagesByFolderPrefix(item.path);
          db.deleteFoldersByPrefix(item.path);
        } else {
          // 保存单个文件的数据库记录
          imageRecords = db.getImageByPath(item.path);
          db.deleteImage(item.path);
        }
        
        // 更新meta文件，包含数据库记录（只保存非空记录）
        const metaContent = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (imageRecords && (Array.isArray(imageRecords) ? imageRecords.length > 0 : true)) {
          metaContent.imageRecords = imageRecords;
        }
        if (folderRecords && folderRecords.length > 0) {
          metaContent.folderRecords = folderRecords;
        }
        fs.writeFileSync(metaPath, JSON.stringify(metaContent));

        // 删除缩略图（可选，因为缩略图基于 hash，可能被其他文件共享）
        // this._deleteThumbnail(db, item.path);

        results.success.push(item.path);
      } catch (error) {
        console.error(`删除失败 ${item.path}:`, error.message);
        results.failed.push({ path: item.path, error: error.message });
      }
    }

    // 更新文件夹计数
    if (results.success.length > 0) {
      db.updateAllFolderCounts();
    }

    return results;
  }

  /**
   * 递归复制文件夹（辅助方法）
   * @private
   */
  _copyDirSync(src, dest) {
    // 创建目标目录
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    // 读取源目录内容
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        // 递归复制子目录
        this._copyDirSync(srcPath, destPath);
      } else {
        // 复制文件
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 重命名文件或文件夹
   * @param {string} libraryId - 素材库ID
   * @param {string} oldPath - 旧路径（相对路径，使用正斜杠）
   * @param {string} newName - 新名称（不含路径）
   */
  async renameItem(libraryId, oldPath, newName) {
    const db = this._getDatabase(libraryId);
    const libraryPath = db.libraryPath;

    // 归一化旧路径，确保使用正斜杠
    const normalizedOldPath = oldPath.replace(/\\/g, '/');
    const fullOldPath = path.join(libraryPath, normalizedOldPath);

    // 检查文件/文件夹是否存在
    if (!fs.existsSync(fullOldPath)) {
      throw new Error('文件不存在');
    }

    const stat = fs.lstatSync(fullOldPath);
    const isDirectory = stat.isDirectory();

    const directory = path.dirname(fullOldPath);
    const initialNewPath = path.join(directory, newName);

    // 如果目标已存在，则自动编号避免冲突
    let finalFullNewPath = initialNewPath;
    let finalNewName = newName;

    if (fs.existsSync(finalFullNewPath)) {
      const ext = isDirectory ? '' : path.extname(newName);
      const basename = isDirectory ? newName : path.basename(newName, ext);
      let counter = 1;

      while (fs.existsSync(finalFullNewPath)) {
        const numberedName = isDirectory
          ? `${basename} (${counter})`
          : `${basename} (${counter})${ext}`;
        finalFullNewPath = path.join(directory, numberedName);
        finalNewName = numberedName;
        counter++;
      }
    }

    // 执行重命名（文件或文件夹）
    fs.renameSync(fullOldPath, finalFullNewPath);

    // 计算新的相对路径
    const newRelativePath = path
      .relative(libraryPath, finalFullNewPath)
      .replace(/\\/g, '/');

    if (isDirectory) {
      // 文件夹：更新 folders 表与 images 表中所有相关记录
      this._updateFolderPathInDatabase(db, normalizedOldPath, newRelativePath);
    } else {
      // 单个文件：仅更新 images 表中的一条记录
      this._updatePathInDatabase(db, normalizedOldPath, newRelativePath);
    }

    return { newPath: newRelativePath, newName: finalNewName };
  }

  /**
   * 移动文件或文件夹
   * @param {string} libraryId - 素材库ID
   * @param {Array} items - 待移动项
   * @param {string} targetFolder - 目标文件夹（相对路径）
   */
  async moveItems(libraryId, items, targetFolder) {
    const db = this._getDatabase(libraryId);
    const libraryPath = db.libraryPath;
    const results = { success: [], failed: [] };

    for (const item of items) {
      try {
        // 归一化路径（使用正斜杠）
        const oldPath = item.path.replace(/\\/g, '/');
        const fileName = path.basename(oldPath);
        const normalizedTarget = targetFolder ? targetFolder.replace(/\\/g, '/') : '';

        // 目标文件夹相对路径
        const newRelativeFolder = normalizedTarget
          ? `${normalizedTarget}/${fileName}`
          : fileName;

        const oldFullPath = path.join(libraryPath, oldPath);
        const newFullPath = path.join(libraryPath, newRelativeFolder);

        // 检查源路径是否存在
        if (!fs.existsSync(oldFullPath)) {
          results.failed.push({ path: oldPath, error: '源文件不存在' });
          continue;
        }

        // 检查目标父级文件夹是否存在
        const targetFullPath = normalizedTarget
          ? path.join(libraryPath, normalizedTarget)
          : libraryPath;
        if (!fs.existsSync(targetFullPath)) {
          fs.mkdirSync(targetFullPath, { recursive: true });
        }

        // 检查目标是否已存在同名文件/文件夹
        if (fs.existsSync(newFullPath)) {
          results.failed.push({ path: oldPath, error: '目标位置已存在同名文件' });
          continue;
        }

        if (item.type === 'folder') {
          // ===== 文件夹移动逻辑 =====

          // 1. 先在磁盘上移动整个文件夹树
          fs.renameSync(oldFullPath, newFullPath);

          // 2. 更新 folders 表中该文件夹及其所有子文件夹的 path / parent_path
          const oldFolderPath = oldPath;
          const newFolderPath = newRelativeFolder;
          const len = oldFolderPath.length + 1; // 用于 substr 去掉前缀

          // 2.1 更新根文件夹记录
          const updateRootFolderStmt = db.db.prepare(`
            UPDATE folders
            SET path = ?, parent_path = ?
            WHERE path = ?
          `);
          updateRootFolderStmt.run(
            newFolderPath,
            normalizedTarget || null,
            oldFolderPath
          );

          // 2.2 更新子文件夹记录（保持层级结构）
          const updateChildFoldersStmt = db.db.prepare(`
            UPDATE folders
            SET path = ? || substr(path, ?),
                parent_path = ? || substr(parent_path, ?)
            WHERE path LIKE ?
          `);
          updateChildFoldersStmt.run(
            newFolderPath,
            len,
            newFolderPath,
            len,
            `${oldFolderPath}/%`
          );

          // 3. 更新 images 表中所有属于该文件夹及子文件夹的图片路径和 folder 字段
          const updateImagesStmt = db.db.prepare(`
            UPDATE images
            SET path = ? || substr(path, ?),
                folder = ? || substr(folder, ?)
            WHERE folder = ? OR folder LIKE ?
          `);
          updateImagesStmt.run(
            newFolderPath,
            len,
            newFolderPath,
            len,
            oldFolderPath,
            `${oldFolderPath}/%`
          );

          results.success.push({ oldPath: oldFolderPath, newPath: newFolderPath });
        } else {
          // ===== 单个文件移动逻辑（保持原有行为） =====

          // 移动文件（同分区使用 rename，跨分区自动降级为复制+删除）
          fs.renameSync(oldFullPath, newFullPath);

          // 更新数据库（单个图片记录）
          const newRelativePath = newRelativeFolder.replace(/\\/g, '/');
          this._updatePathInDatabase(db, oldPath, newRelativePath);

          results.success.push({ oldPath, newPath: newRelativePath });
        }
      } catch (error) {
        console.error(`移动失败 ${item.path}:`, error.message);
        results.failed.push({ path: item.path, error: error.message });
      }
    }

    // 更新文件夹计数
    if (results.success.length > 0) {
      db.updateAllFolderCounts();
    }

    return results;
  }

  /**
   * 复制文件或文件夹
   * @param {string} libraryId - 素材库ID
   * @param {Array} items - 待复制项
   * @param {string} targetFolder - 目标文件夹（相对路径）
   * @param {string} conflictAction - 冲突处理方式: 'skip'|'replace'|'rename'
   */
  async copyItems(libraryId, items, targetFolder, conflictAction = 'rename') {
    const db = this._getDatabase(libraryId);
    const libraryPath = db.libraryPath;
    const results = { success: [], failed: [], conflicts: [] };

    // 确保目标文件夹存在
    const targetFullPath = path.join(libraryPath, targetFolder || '');
    if (!fs.existsSync(targetFullPath)) {
      fs.mkdirSync(targetFullPath, { recursive: true });
    }

    for (const item of items) {
      try {
        const srcFullPath = path.join(libraryPath, item.path);
        const fileName = path.basename(item.path);
        const dstFullPath = path.join(targetFullPath, fileName);

        // 检查源文件是否存在
        if (!fs.existsSync(srcFullPath)) {
          results.failed.push({ path: item.path, error: '源文件不存在' });
          continue;
        }

        // 处理冲突
        let finalDstPath = dstFullPath;
        const isDirectory = item.type === 'folder';
        
        // 检查是否与源路径相同（在同一文件夹内复制粘贴）
        if (srcFullPath === dstFullPath) {
          // 记录冲突
          results.conflicts.push({ path: item.path, name: fileName });
          
          if (conflictAction === 'skip') {
            // 跳过：源和目标相同，直接跳过
            console.log(`⏭️  跳过（源和目标相同）: ${fileName}`);
            continue;
          } else if (conflictAction === 'replace') {
            // 覆盖：源和目标相同，无法覆盖自己，跳过
            console.log(`⏭️  跳过（无法覆盖自己）: ${fileName}`);
            continue;
          } else if (conflictAction === 'rename') {
            // 重命名：自动编号创建副本
            const ext = isDirectory ? '' : path.extname(fileName);
            const basename = isDirectory ? fileName : path.basename(fileName, ext);
            let counter = 1;
            
            while (fs.existsSync(finalDstPath)) {
              const numberedName = isDirectory
                ? `${basename} (${counter})`
                : `${basename} (${counter})${ext}`;
              finalDstPath = path.join(targetFullPath, numberedName);
              counter++;
            }
            console.log(`✏️  创建副本: ${path.basename(finalDstPath)}`);
          }
        } else if (fs.existsSync(dstFullPath)) {
          // 目标文件存在但与源不同
          results.conflicts.push({ path: item.path, name: fileName });
          
          if (conflictAction === 'skip') {
            // 跳过冲突文件
            console.log(`⏭️  跳过冲突文件: ${fileName}`);
            continue;
          } else if (conflictAction === 'replace') {
            // 覆盖：先删除目标文件/文件夹
            console.log(`🔄 覆盖文件: ${fileName}`);
            if (fs.statSync(dstFullPath).isDirectory()) {
              fs.rmSync(dstFullPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(dstFullPath);
            }
          } else if (conflictAction === 'rename') {
            // 重命名：自动编号
            const ext = isDirectory ? '' : path.extname(fileName);
            const basename = isDirectory ? fileName : path.basename(fileName, ext);
            let counter = 1;
            
            while (fs.existsSync(finalDstPath)) {
              const numberedName = isDirectory
                ? `${basename} (${counter})`
                : `${basename} (${counter})${ext}`;
              finalDstPath = path.join(targetFullPath, numberedName);
              counter++;
            }
            console.log(`✏️  重命名为: ${path.basename(finalDstPath)}`);
          }
        }

        // 复制文件或文件夹
        if (item.type === 'folder') {
          // 复制整个文件夹
          fs.cpSync(srcFullPath, finalDstPath, { recursive: true });
          
          // 递归处理文件夹中的所有图片（生成缩略图、入库）
          await this._processFolderImages(finalDstPath, libraryPath, db);
        } else {
          // 复制单个文件
          fs.copyFileSync(srcFullPath, finalDstPath);
          
          // 处理新文件（生成缩略图、入库）
          await processImage(finalDstPath, libraryPath, db);
        }

        const newRelativePath = path.relative(libraryPath, finalDstPath).replace(/\\/g, '/');
        results.success.push({ oldPath: item.path, newPath: newRelativePath });
        console.log(`✅ 复制成功: ${item.path} → ${newRelativePath}`);
      } catch (error) {
        console.error(`复制失败 ${item.path}:`, error.message);
        results.failed.push({ path: item.path, error: error.message });
      }
    }

    // 更新文件夹计数
    if (results.success.length > 0) {
      db.updateAllFolderCounts();
    }

    return results;
  }

  /**
   * 递归处理文件夹中的所有图片
   * @private
   */
  async _processFolderImages(folderPath, libraryPath, db) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      
      if (entry.isDirectory()) {
        // 跳过 .flypic 目录
        if (entry.name === '.flypic') continue;
        
        // 递归处理子文件夹
        await this._processFolderImages(fullPath, libraryPath, db);
      } else {
        // 检查是否是图片文件
        const ext = path.extname(entry.name).toLowerCase();
        const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];
        
        if (imageExts.includes(ext)) {
          try {
            await processImage(fullPath, libraryPath, db);
          } catch (error) {
            console.warn(`处理图片失败 ${entry.name}:`, error.message);
          }
        }
      }
    }
  }

  /**
   * 更新文件元数据（评分、收藏、标签）
   * @param {string} libraryId - 素材库ID
   * @param {string} imagePath - 图片路径（相对路径）
   * @param {Object} metadata - 元数据 {rating, favorite, tags}
   */
  async updateMetadata(libraryId, imagePath, metadata) {
    const db = this._getDatabase(libraryId);
    
    const updates = {};
    if (metadata.rating !== undefined) updates.rating = metadata.rating;
    if (metadata.favorite !== undefined) updates.favorite = metadata.favorite;
    if (metadata.tags !== undefined) {
      updates.tags = Array.isArray(metadata.tags) 
        ? JSON.stringify(metadata.tags) 
        : metadata.tags;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error('没有要更新的元数据');
    }

    // 构建 SQL 更新语句
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), imagePath];
    
    const stmt = db.db.prepare(`UPDATE images SET ${fields} WHERE path = ?`);
    const result = stmt.run(...values);

    if (result.changes === 0) {
      throw new Error('图片不存在');
    }

    // 更新数据库修改时间
    db.updateLastModified();

    return db.getImageByPath(imagePath);
  }

  /**
   * 更新数据库中的路径（仅用于单个文件）
   * @private
   */
  _updatePathInDatabase(db, oldPath, newPath) {
    const image = db.getImageByPath(oldPath);
    if (!image) {
      return;
    }

    const newFilename = path.basename(newPath);
    const newFolder = path.dirname(newPath);

    const stmt = db.db.prepare(`
      UPDATE images 
      SET path = ?, filename = ?, folder = ? 
      WHERE path = ?
    `);
    
    stmt.run(
      newPath,
      newFilename,
      newFolder === '.' ? '' : newFolder.replace(/\\/g, '/'),
      oldPath
    );

    db.updateLastModified();
  }

  /**
   * 更新数据库中的文件夹路径（folders + images）
   * @private
   */
  _updateFolderPathInDatabase(db, oldFolderPath, newFolderPath) {
    const normalizedOld = oldFolderPath.replace(/\\/g, '/');
    const normalizedNew = newFolderPath.replace(/\\/g, '/');

    const len = normalizedOld.length + 1; // 用于去掉前缀

    // 1. 更新根文件夹记录（path / name，parent_path 保持不变）
    const rootFolder = db.getFolderByPath(normalizedOld);
    const parentPath = rootFolder ? rootFolder.parent_path : path.dirname(normalizedOld);

    const updateRootFolderStmt = db.db.prepare(`
      UPDATE folders
      SET path = ?, parent_path = ?, name = ?
      WHERE path = ?
    `);
    updateRootFolderStmt.run(
      normalizedNew,
      parentPath || null,
      path.basename(normalizedNew),
      normalizedOld
    );

    // 2. 更新子文件夹记录（保持层级结构）
    const updateChildFoldersStmt = db.db.prepare(`
      UPDATE folders
      SET path = ? || substr(path, ?),
          parent_path = ? || substr(parent_path, ?)
      WHERE path LIKE ?
    `);
    updateChildFoldersStmt.run(
      normalizedNew,
      len,
      normalizedNew,
      len,
      `${normalizedOld}/%`
    );

    // 3. 更新 images 表中所有属于该文件夹及子文件夹的图片路径和 folder 字段
    const updateImagesStmt = db.db.prepare(`
      UPDATE images
      SET path = ? || substr(path, ?),
          folder = ? || substr(folder, ?)
      WHERE folder = ? OR folder LIKE ?
    `);
    updateImagesStmt.run(
      normalizedNew,
      len,
      normalizedNew,
      len,
      normalizedOld,
      `${normalizedOld}/%`
    );

    // 4. 重新计算所有文件夹的图片数量
    db.updateAllFolderCounts();
    db.updateLastModified();
  }

  /**
   * 创建空文件夹
   * @param {string} libraryId - 素材库ID
   * @param {string} folderPath - 文件夹路径（相对路径）
   */
  async createFolder(libraryId, folderPath) {
    const db = this._getDatabase(libraryId);
    const libraryPath = db.libraryPath;
    const fullPath = path.join(libraryPath, folderPath);

    // 检查文件夹是否已存在
    if (fs.existsSync(fullPath)) {
      throw new Error('文件夹已存在');
    }

    // 创建文件夹
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`📁 创建文件夹: ${folderPath}`);

    // 添加到数据库
    const normalizedPath = folderPath.replace(/\\/g, '/');
    const parentPath = normalizedPath.includes('/') 
      ? normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
      : '';
    const name = normalizedPath.split('/').pop();

    // 确保父文件夹链存在
    if (parentPath) {
      let current = parentPath;
      while (current && current !== '.') {
        const existing = db.getFolderByPath(current);
        if (!existing) {
          const parent = path.posix.dirname(current);
          const folderName = current.split('/').pop();
          db.insertFolder({
            path: current,
            parent_path: parent === '.' ? '' : parent,
            name: folderName,
            image_count: 0
          });
        }
        const parent = path.posix.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }

    // 插入新文件夹
    db.insertFolder({
      path: normalizedPath,
      parent_path: parentPath,
      name: name,
      image_count: 0
    });

    return { path: normalizedPath };
  }

  /**
   * 删除缩略图（私有方法）
   */
  _deleteThumbnail(db, imagePath) {
    const image = db.getImageByPath(imagePath);
    if (!image || !image.thumbnail_path) return;

    try {
      const thumbnailFullPath = path.join(db.libraryPath, image.thumbnail_path);
      if (fs.existsSync(thumbnailFullPath)) {
        fs.unlinkSync(thumbnailFullPath);
      }
    } catch (error) {
      console.warn(`删除缩略图失败: ${error.message}`);
    }
  }
}

module.exports = FileService;
