/**
 * 扫描路由（新架构）
 * 薄层路由，业务逻辑在 Service 层
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { validateRequired } = require('../middleware/validator');

// 服务实例（从 app 中获取）
let scanService;

router.use((req, res, next) => {
  if (!scanService) {
    scanService = req.app.get('scanService');
  }
  next();
});

/**
 * 全量扫描
 * POST /api/scan/full
 * Body: { libraryId, wait? }
 */
router.post('/full',
  validateRequired(['libraryId']),
  asyncHandler(async (req, res) => {
    const { libraryId, wait = false } = req.body;
    const result = await scanService.fullScan(libraryId, wait);
    res.json({ success: true, data: result });
  })
);

/**
 * 增量同步
 * POST /api/scan/sync
 * Body: { libraryId, wait? }
 */
router.post('/sync',
  validateRequired(['libraryId']),
  asyncHandler(async (req, res) => {
    const { libraryId, wait = false } = req.body;
    const result = await scanService.incrementalSync(libraryId, wait);
    res.json({ success: true, data: result });
  })
);

/**
 * 获取扫描状态
 * GET /api/scan/status/:libraryId
 */
router.get('/status/:libraryId', asyncHandler(async (req, res) => {
  const { libraryId } = req.params;
  const result = scanService.getScanStatus(libraryId);
  res.json({ success: true, data: result });
}));

/**
 * 获取所有活跃的扫描状态
 * GET /api/scan/active-states
 */
router.get('/active-states', asyncHandler(async (req, res) => {
  const result = scanService.getAllActiveStates();
  res.json({ success: true, data: result });
}));

/**
 * 修复文件夹路径
 * POST /api/scan/fix-folders
 * Body: { libraryId }
 */
router.post('/fix-folders',
  validateRequired(['libraryId']),
  asyncHandler(async (req, res) => {
    const { libraryId } = req.body;
    const result = await scanService.fixFolders(libraryId);
    res.json({ success: true, data: result });
  })
);

module.exports = router;
