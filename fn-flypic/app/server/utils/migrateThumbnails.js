/**
 * 缩略图迁移工具
 * 将旧结构的缩略图迁移到新的分片结构
 * 
 * 旧结构：.flypic/thumbnails/hash.webp
 * 新结构：.flypic/thumbnails/ab/hash.webp (分片存储)
 */

const fs = require('fs');
const path = require('path');

/**
 * 迁移单个素材库的缩略图
 * @param {string} libraryPath - 素材库路径
 * @returns {Object} 迁移结果统计
 */
async function migrateThumbnails(libraryPath) {
  const thumbnailsDir = path.join(libraryPath, '.flypic', 'thumbnails');
  
  // 检查目录是否存在
  if (!fs.existsSync(thumbnailsDir)) {
    return { migrated: 0, skipped: 0, errors: 0, message: 'Thumbnails directory not found' };
  }

  const stats = {
    migrated: 0,
    skipped: 0,
    errors: 0
  };

  try {
    const entries = fs.readdirSync(thumbnailsDir, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过已经是目录的（已经是新结构）
      if (entry.isDirectory()) {
        continue;
      }

      // 只处理 .webp 文件
      if (!entry.name.endsWith('.webp')) {
        continue;
      }

      try {
        const oldPath = path.join(thumbnailsDir, entry.name);
        
        // 提取 hash（去掉扩展名）
        const hash = entry.name.replace('.webp', '');
        
        // 计算分片目录（使用前2个字符）
        const shard = hash.slice(0, 2);
        const shardDir = path.join(thumbnailsDir, shard);
        const newPath = path.join(shardDir, entry.name);

        // 如果新路径已存在，跳过
        if (fs.existsSync(newPath)) {
          stats.skipped++;
          continue;
        }

        // 创建分片目录
        if (!fs.existsSync(shardDir)) {
          fs.mkdirSync(shardDir, { recursive: true });
        }

        // 移动文件
        fs.renameSync(oldPath, newPath);
        stats.migrated++;

        console.log(`[Migrate] Moved: ${entry.name} -> ${shard}/${entry.name}`);
      } catch (error) {
        console.error(`[Migrate] Error migrating ${entry.name}:`, error.message);
        stats.errors++;
      }
    }

    console.log(`[Migrate] Complete for ${libraryPath}:`, stats);
    return stats;
  } catch (error) {
    console.error(`[Migrate] Error reading thumbnails directory:`, error);
    return { ...stats, message: error.message };
  }
}

/**
 * 检查是否需要迁移
 * @param {string} libraryPath - 素材库路径
 * @returns {boolean} 是否需要迁移
 */
function needsMigration(libraryPath) {
  const thumbnailsDir = path.join(libraryPath, '.flypic', 'thumbnails');
  
  if (!fs.existsSync(thumbnailsDir)) {
    return false;
  }

  try {
    const entries = fs.readdirSync(thumbnailsDir, { withFileTypes: true });
    
    // 检查是否有直接在 thumbnails 目录下的 .webp 文件
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.webp')) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`[Migrate] Error checking migration need:`, error);
    return false;
  }
}

/**
 * 批量迁移多个素材库
 * @param {Array} libraries - 素材库列表
 * @returns {Object} 总体迁移统计
 */
async function migrateAllLibraries(libraries) {
  const totalStats = {
    migrated: 0,
    skipped: 0,
    errors: 0,
    librariesProcessed: 0
  };

  for (const library of libraries) {
    if (needsMigration(library.path)) {
      console.log(`[Migrate] Processing library: ${library.name}`);
      const stats = await migrateThumbnails(library.path);
      
      totalStats.migrated += stats.migrated;
      totalStats.skipped += stats.skipped;
      totalStats.errors += stats.errors;
      totalStats.librariesProcessed++;
    }
  }

  console.log(`[Migrate] Total stats:`, totalStats);
  return totalStats;
}

module.exports = {
  migrateThumbnails,
  needsMigration,
  migrateAllLibraries
};
