/**
 * 认证中间件
 * 轻量级访问密码验证
 */

const jwt = require('jsonwebtoken');

const TOKEN_EXPIRY = '30d'; // Token 有效期 30 天

/**
 * 生成 JWT Token
 * @param {string} jwtSecret - JWT 密钥（从配置文件读取）
 */
function generateToken(jwtSecret) {
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required');
  }
  return jwt.sign(
    { app: 'flypic', timestamp: Date.now() },
    jwtSecret,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * 验证 JWT Token
 * @param {string} token - JWT Token
 * @param {string} jwtSecret - JWT 密钥（从配置文件读取）
 */
function verifyToken(token, jwtSecret) {
  if (!jwtSecret) {
    return false;
  }
  try {
    jwt.verify(token, jwtSecret);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 认证中间件工厂
 * @param {Function} getPasswordHash - 获取密码哈希的函数
 * @param {Function} getJwtSecret - 获取 JWT 密钥的函数
 */
function createAuthMiddleware(getPasswordHash, getJwtSecret) {
  return (req, res, next) => {
    // 如果没有设置密码，直接放行
    const passwordHash = getPasswordHash();
    if (!passwordHash) {
      return next();
    }

    // 公开接口（登录相关 / 健康检查 / 图片资源）
    // 使用 req.originalUrl 获取完整路径（包含 /api 前缀，去除查询字符串）
    const fullPath = req.originalUrl.split('?')[0];

    // 精确匹配的公开路径
    const publicPaths = [
      '/api/auth/status',
      '/api/auth/login',
      '/api/auth/setup',
      '/api/health'
    ];

    // 前缀匹配的公开路径（缩略图 & 原图资源）
    const publicPrefixes = [
      '/api/image/thumbnail/',  // 缩略图
      '/api/image/original/'    // 原图
    ];

    if (
      publicPaths.includes(fullPath) ||
      publicPrefixes.some(prefix => fullPath.startsWith(prefix))
    ) {
      return next();
    }

    // 检查 Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { message: '未授权访问，请先登录' }
      });
    }

    const token = authHeader.substring(7);
    const jwtSecret = getJwtSecret();
    if (!verifyToken(token, jwtSecret)) {
      return res.status(401).json({
        success: false,
        error: { message: 'Token 无效或已过期，请重新登录' }
      });
    }

    next();
  };
}

module.exports = {
  createAuthMiddleware,
  generateToken,
  verifyToken
};
