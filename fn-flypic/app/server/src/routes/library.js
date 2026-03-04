/**
 * 素材库路由（新架构）
 * 薄层路由，业务逻辑在 Service 层
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { validateRequired } = require('../middleware/validator');

// 服务实例（从 app 中获取）
let libraryService;

router.use((req, res, next) => {
  if (!libraryService) {
    libraryService = req.app.get('libraryService');
  }
  next();
});

/**
 * 获取所有素材库
 * GET /api/library
 */
router.get('/', asyncHandler(async (req, res) => {
  const data = libraryService.getAllLibraries();
  res.json({ success: true, data });
}));

/**
 * 创建素材库
 * POST /api/library
 * Body: { name, path }
 */
router.post('/', 
  validateRequired(['name', 'path']),
  asyncHandler(async (req, res) => {
    const { name, path } = req.body;
    const result = await libraryService.createLibrary(name, path);
    res.json({ success: true, data: result });
  })
);

/**
 * 更新偏好设置（必须在 /:id 之前，否则会被 /:id 匹配）
 * PUT /api/library/preferences
 * Body: { preferences }
 */
router.put('/preferences', asyncHandler(async (req, res) => {
  const result = libraryService.updatePreferences(req.body);
  res.json({ success: true, data: result });
}));

/**
 * 更新主题（必须在 /:id 之前）
 * PUT /api/library/theme
 * Body: { theme }
 */
router.put('/theme', 
  validateRequired(['theme']),
  asyncHandler(async (req, res) => {
    const { theme } = req.body;
    const result = libraryService.updateTheme(theme);
    res.json({ success: true, data: result });
  })
);

/**
 * 更新素材库
 * PUT /api/library/:id
 * Body: { name?, path? }
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await libraryService.updateLibrary(id, req.body);
  res.json({ success: true, data: result });
}));

/**
 * 删除素材库
 * DELETE /api/library/:id
 * Query: autoSelectNext - 是否自动选择下一个素材库，默认 true
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const autoSelectNext = req.query.autoSelectNext !== 'false';
  const result = await libraryService.deleteLibrary(id, autoSelectNext);
  res.json({ success: true, data: result });
}));

/**
 * 设置当前素材库
 * POST /api/library/:id/set-current
 */
router.post('/:id/set-current', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await libraryService.setCurrentLibrary(id);
  res.json({ success: true, data: result });
}));

/**
 * 获取素材库统计
 * GET /api/library/:id/stats
 */
router.get('/:id/stats', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await libraryService.getLibraryStats(id);
  res.json({ success: true, data: result });
}));

/**
 * 验证素材库路径是否存在
 * GET /api/library/:id/validate
 */
router.get('/:id/validate', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = libraryService.validateLibraryPath(id);
  res.json({ success: true, data: result });
}));

module.exports = router;
