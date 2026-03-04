/**
 * 配置管理入口
 */

const constants = require('./constants');
const path = require('path');

/**
 * 获取 FlyPic 目录路径
 */
function getFlypicPath(libraryPath) {
  return path.join(libraryPath, constants.PATHS.FLYPIC_DIR);
}

/**
 * 获取缩略图目录路径
 */
function getThumbnailsPath(libraryPath) {
  return path.join(libraryPath, constants.PATHS.FLYPIC_DIR, constants.PATHS.THUMBNAILS_DIR);
}

/**
 * 获取数据库文件路径
 */
function getDatabasePath(libraryPath) {
  return path.join(libraryPath, constants.PATHS.FLYPIC_DIR, constants.PATHS.DATABASE_FILE);
}

/**
 * 获取配置文件路径
 */
function getConfigPath(libraryPath) {
  return path.join(libraryPath, constants.PATHS.FLYPIC_DIR, constants.PATHS.CONFIG_FILE);
}

module.exports = {
  constants,
  getFlypicPath,
  getThumbnailsPath,
  getDatabasePath,
  getConfigPath
};
