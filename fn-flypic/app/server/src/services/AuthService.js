/**
 * 认证服务
 * 处理密码设置、验证、修改
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { generateToken } = require('../middleware/authMiddleware');
const { AppError } = require('../middleware/errorHandler');

const SALT_ROUNDS = 10;
const MAX_LOGIN_ATTEMPTS = 30; // 最大登录尝试次数
const ATTEMPT_WINDOW = 5 * 60 * 1000; // 5分钟窗口期

class AuthService {
  constructor(configManager) {
    this.configManager = configManager;
    // 登录失败记录：IP → { count, firstAttempt, lastAttempt }
    this.loginAttempts = new Map();
    
    // 定期清理过期的登录尝试记录（每10分钟）
    setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.loginAttempts.entries()) {
        if (now - data.lastAttempt > ATTEMPT_WINDOW) {
          this.loginAttempts.delete(ip);
        }
      }
    }, 10 * 60 * 1000);
  }

  /**
   * 检查是否已设置密码
   */
  hasPassword() {
    const config = this.configManager.loadConfig();
    return !!config.passwordHash;
  }

  /**
   * 获取密码哈希
   */
  getPasswordHash() {
    const config = this.configManager.loadConfig();
    return config.passwordHash || null;
  }

  /**
   * 获取 JWT 密钥
   */
  getJwtSecret() {
    const config = this.configManager.loadConfig();
    return config.jwtSecret || null;
  }

  /**
   * 设置密码（首次设置）
   */
  async setupPassword(password) {
    if (this.hasPassword()) {
      // 已设置密码，属于业务错误
      throw new AppError('密码已设置，请使用修改密码功能', 400, 'PASSWORD_ALREADY_SET');
    }

    if (!password || password.length < 4) {
      throw new AppError('密码长度至少为 4 位', 400, 'INVALID_PASSWORD');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const config = this.configManager.loadConfig();
    
    // 生成随机 JWT 密钥（首次设置时）
    if (!config.jwtSecret) {
      config.jwtSecret = crypto.randomBytes(32).toString('hex');
      console.log('🔐 已生成随机 JWT 密钥');
    }
    
    config.passwordHash = passwordHash;
    this.configManager.saveConfig(config);

    return { token: generateToken(config.jwtSecret) };
  }

  /**
   * 验证密码并登录
   * @param {string} password - 密码
   * @param {string} clientIP - 客户端IP（用于防暴力破解）
   */
  async login(password, clientIP = 'unknown') {
    if (!this.hasPassword()) {
      // 未设置密码，提示先设置
      throw new AppError('未设置密码，请先设置密码', 400, 'PASSWORD_NOT_SET');
    }

    // 检查登录尝试次数（防暴力破解）
    const now = Date.now();
    const attempts = this.loginAttempts.get(clientIP);
    
    if (attempts) {
      // 检查是否在窗口期内
      if (now - attempts.firstAttempt < ATTEMPT_WINDOW) {
        // 仍在窗口期内
        if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
          const remainingTime = Math.ceil((ATTEMPT_WINDOW - (now - attempts.firstAttempt)) / 1000);
          throw new AppError(
            `登录尝试次数过多，请 ${remainingTime} 秒后再试`, 
            429, 
            'TOO_MANY_ATTEMPTS'
          );
        }
      } else {
        // 超过窗口期，重置计数
        this.loginAttempts.delete(clientIP);
      }
    }

    const passwordHash = this.getPasswordHash();
    const jwtSecret = this.getJwtSecret();
    
    if (!jwtSecret) {
      throw new AppError('系统配置错误，请重新设置密码', 500, 'MISSING_JWT_SECRET');
    }
    
    const isValid = await bcrypt.compare(password, passwordHash);

    if (!isValid) {
      // 记录失败尝试
      if (attempts) {
        attempts.count++;
        attempts.lastAttempt = now;
      } else {
        this.loginAttempts.set(clientIP, {
          count: 1,
          firstAttempt: now,
          lastAttempt: now
        });
      }
      
      // 密码错误：返回 401 未授权，并附带剩余尝试次数
      const currentAttempts = attempts ? attempts.count : 1;
      const remainingAttempts = MAX_LOGIN_ATTEMPTS - currentAttempts;
      console.log(`⚠️ 登录失败 [${clientIP}]: 已尝试 ${currentAttempts} 次，剩余 ${remainingAttempts} 次`);
      
      // 创建错误并附带额外信息
      const error = new AppError('密码错误', 401, 'INVALID_PASSWORD');
      error.remainingAttempts = remainingAttempts;
      error.currentAttempts = currentAttempts;
      throw error;
    }

    // 登录成功，清除尝试记录
    this.loginAttempts.delete(clientIP);
    console.log(`✅ 登录成功 [${clientIP}]`);

    return { token: generateToken(jwtSecret) };
  }

  /**
   * 修改密码
   */
  async changePassword(oldPassword, newPassword) {
    if (!this.hasPassword()) {
      throw new AppError('未设置密码', 400, 'PASSWORD_NOT_SET');
    }

    if (!newPassword || newPassword.length < 4) {
      throw new AppError('新密码长度至少为 4 位', 400, 'INVALID_NEW_PASSWORD');
    }

    // 验证旧密码
    const passwordHash = this.getPasswordHash();
    const isValid = await bcrypt.compare(oldPassword, passwordHash);

    if (!isValid) {
      throw new AppError('原密码错误', 401, 'INVALID_OLD_PASSWORD');
    }

    // 设置新密码
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const config = this.configManager.loadConfig();
    config.passwordHash = newPasswordHash;
    this.configManager.saveConfig(config);

    const jwtSecret = this.getJwtSecret();
    if (!jwtSecret) {
      throw new AppError('系统配置错误', 500, 'MISSING_JWT_SECRET');
    }

    return { token: generateToken(jwtSecret) };
  }

  /**
   * 获取认证状态
   */
  getStatus() {
    return {
      hasPassword: this.hasPassword(),
      requireAuth: this.hasPassword()
    };
  }
}

module.exports = AuthService;
