/**
 * 认证路由
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/auth/status
 * 获取认证状态
 */
router.get('/status', async (req, res, next) => {
  try {
    const authService = req.app.get('authService');
    const status = authService.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/setup
 * 首次设置密码
 * Body: { password: string }
 */
router.post('/setup', async (req, res, next) => {
  try {
    const authService = req.app.get('authService');
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: { message: '密码不能为空' }
      });
    }

    const result = await authService.setupPassword(password);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/login
 * 登录验证
 * Body: { password: string }
 */
router.post('/login', async (req, res, next) => {
  try {
    const authService = req.app.get('authService');
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: { message: '密码不能为空' }
      });
    }

    // 获取客户端 IP（用于防暴力破解）
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const result = await authService.login(password, clientIP);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/change-password
 * 修改密码（需要认证）
 * Body: { oldPassword: string, newPassword: string }
 */
router.post('/change-password', async (req, res, next) => {
  try {
    const authService = req.app.get('authService');
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: { message: '原密码和新密码不能为空' }
      });
    }

    const result = await authService.changePassword(oldPassword, newPassword);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
