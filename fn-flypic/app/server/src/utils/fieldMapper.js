/**
 * 数据库字段映射工具
 * 将 snake_case 转换为 camelCase
 */

// 数据库字段到前端字段的映射
const DB_TO_FRONTEND_MAP = {
  // Image fields
  file_type: 'fileType',
  created_at: 'createdAt',
  modified_at: 'modifiedAt',
  file_hash: 'fileHash',
  thumbnail_path: 'thumbnailPath',
  thumbnail_size: 'thumbnailSize',
  indexed_at: 'indexedAt',
  
  // Folder fields
  parent_path: 'parentPath',
  image_count: 'imageCount',
  last_scan: 'lastScan'
};

/**
 * 映射单个对象的字段
 */
function mapFields(obj, mapping) {
  if (!obj) return null;
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = mapping[key] || key;
    result[newKey] = value;
  }
  return result;
}

/**
 * 映射图片对象
 */
function mapImageForFrontend(image) {
  return mapFields(image, DB_TO_FRONTEND_MAP);
}

/**
 * 映射文件夹对象
 */
function mapFolderForFrontend(folder) {
  return mapFields(folder, DB_TO_FRONTEND_MAP);
}

/**
 * 批量映射图片数组
 */
function mapImagesForFrontend(images) {
  return images.map(mapImageForFrontend);
}

/**
 * 批量映射文件夹数组
 */
function mapFoldersForFrontend(folders) {
  return folders.map(mapFolderForFrontend);
}

module.exports = {
  mapImageForFrontend,
  mapFolderForFrontend,
  mapImagesForFrontend,
  mapFoldersForFrontend,
  mapFields
};
