/**
 * FlyPic 服务器入口（新架构）
 * 使用重构后的 Service 层和 Model 层
 */

const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// 导入新架构的应用
const { createApp } = require('./src/app');

// 导入现有的依赖（保持兼容）
const config = require('./utils/config');
const dbPool = require('./database/dbPool');
const scanner = require('./utils/scanner');
const scanManager = require('./utils/scanManager');
const lightweightWatcher = require('./utils/lightweightWatcher');
const MemoryMonitor = require('./utils/memoryMonitor');
const CleanupManager = require('./utils/cleanupManager');

const PORT = process.env.PORT || 15002;

// 自动检测前端构建目录
let FRONTEND_DIST = process.env.FRONTEND_DIST;
if (!FRONTEND_DIST) {
  const possiblePaths = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '../frontend/dist'),
    path.join(__dirname, '../public'),
    path.join(__dirname, '../../frontend/dist')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      FRONTEND_DIST = p;
      console.log('✅ 前端目录:', p);
      break;
    }
  }

  if (!FRONTEND_DIST) {
    console.log('⚠️ 未找到前端，API模式');
  }
}

// 设置环境变量
if (FRONTEND_DIST) {
  process.env.FRONTEND_DIST = FRONTEND_DIST;
}

// 创建 Socket.IO 服务器
const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: FRONTEND_DIST ? false : ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

// 准备依赖注入
// 包装 config 函数为对象接口
const configManager = {
  // 兼容两种命名风格
  load: () => config.loadConfig(),
  save: (data) => config.saveConfig(data),
  loadConfig: () => config.loadConfig(),
  saveConfig: (data) => config.saveConfig(data),
  addLibrary: (name, path) => config.addLibrary(name, path),
  removeLibrary: (id) => config.removeLibrary(id),
  updateLibrary: (id, updates) => config.updateLibrary(id, updates),
  setCurrentLibrary: (id) => config.setCurrentLibrary(id),
  updatePreferences: (prefs) => config.updatePreferences(prefs),
  updateTheme: (theme) => config.updateTheme(theme)
};

const dependencies = {
  configManager,
  dbPool,
  scanner,
  scanManager,
  lightweightWatcher,
  io
};

// 创建 Express 应用（使用新架构）
const app = createApp(dependencies);

// 将 Express 应用挂载到 HTTP 服务器
server.on('request', app);

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('✅ 客户端连接:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ 客户端断开:', socket.id);
  });
});

// 启动内存监控（开发模式：每30秒输出RSS）
const memoryMonitor = new MemoryMonitor({ 
  devMode: true,
  devLogInterval: 30000 // 30秒
});
memoryMonitor.start();

// 启动清理管理器
const cleanupManager = new CleanupManager({ dbPool });
cleanupManager.startRoutineCleanup();

// 启动服务器
server.listen(PORT, () => {
  console.log('\n🚀 FlyPic 服务器已启动');
  console.log(`📡 端口: ${PORT}`);
  console.log(`🔌 Socket.IO 就绪`);
  if (FRONTEND_DIST) console.log(`📁 前端: ${FRONTEND_DIST}`);
  console.log('');

  try {
    const currentConfig = config.loadConfig();
    
    // 启动定时清理任务（每分钟检查一次过期临时文件）
    const fileService = app.get('fileService');
    setInterval(async () => {
      if (currentConfig.libraries && currentConfig.libraries.length > 0) {
        for (const library of currentConfig.libraries) {
          try {
            const result = await fileService.cleanExpiredTempFiles(library.id);
            if (result.cleaned > 0 || result.thumbnailsCleaned > 0) {
              const parts = [];
              if (result.cleaned > 0) parts.push(`${result.cleaned} 个过期文件`);
              if (result.thumbnailsCleaned > 0) parts.push(`${result.thumbnailsCleaned} 个缩略图`);
              console.log(`🧹 已清理: ${parts.join('、')}`);
            }
          } catch (error) {
            // 忽略错误
          }
        }
      }
    }, 60 * 1000); // 每分钟执行一次
    
    // 恢复所有素材库的扫描状态
    if (currentConfig.libraries && currentConfig.libraries.length > 0) {
      scanManager.restoreAllStates(currentConfig.libraries);
      
      // 检查是否有未完成的扫描，自动继续
      const activeStates = scanManager.getAllActiveStates();
      if (Object.keys(activeStates).length > 0) {
        console.log(`📊 发现 ${Object.keys(activeStates).length} 个活跃扫描`);
      }
      
      for (const [libraryId, state] of Object.entries(activeStates)) {
        const lib = currentConfig.libraries.find(l => l.id === libraryId);
        if (lib && state.status === 'scanning') {
          console.log(`🔄 恢复扫描: ${lib.name} (${state.progress?.percent || 0}%)`);
          
          // 立即恢复扫描状态（让前端能检测到）
          scanManager.scanStates.set(libraryId, {
            status: 'scanning',
            progress: state.progress || { current: 0, total: 0, percent: 0 },
            startTime: state.startTime || Date.now()
          });
          
          // 立即向所有连接的客户端推送扫描状态
          io.emit('scanProgress', {
            libraryId,
            ...state.progress,
            resuming: true
          });
          
          // 延迟启动实际扫描，等服务完全准备好
          setTimeout(() => {
            const db = dbPool.acquire(lib.path);
            // 继续扫描（从中断处继续）
            scanner.scanLibrary(
              lib.path,
              db,
              (progress) => {
                io.emit('scanProgress', { libraryId, ...progress });
              },
              libraryId
            ).then(() => {
              scanManager.completeScan(libraryId);
              io.emit('scanComplete', { libraryId });
              dbPool.release(lib.path);
              console.log(`✅ 扫描完成: ${lib.name}`);
            }).catch((err) => {
              console.error(`❌ 扫描失败: ${lib.name}`, err.message);
              scanManager.completeScan(libraryId);
              dbPool.release(lib.path);
            });
          }, 2000);
        }
      }
    }
    
    // 为当前素材库启动文件监控（仅当索引存在时）
    if (currentConfig.currentLibraryId) {
      const currentLib = currentConfig.libraries.find(lib => lib.id === currentConfig.currentLibraryId);
      if (currentLib) {
        const fs = require('fs');
        const { getFlypicPath, getDatabasePath } = require('./src/config');
        const flypicPath = getFlypicPath(currentLib.path);
        const dbPath = getDatabasePath(currentLib.path);
        
        // 只有当文件夹和索引都存在时才启动监控
        const folderExists = fs.existsSync(currentLib.path);
        const indexExists = fs.existsSync(flypicPath) && fs.existsSync(dbPath);
        
        if (folderExists && indexExists) {
          lightweightWatcher.watch(currentLib.id, currentLib.path, currentLib.name, io);
        } else {
          console.log(`⚠️ 跳过文件监控: ${currentLib.name} (${!folderExists ? '文件夹不存在' : '索引不存在'})`);
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ 初始化失败:', e.message);
  }
});

// 标记是否正在关闭
let isShuttingDown = false;

// 优雅关闭
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('\n🛑 正在关闭服务器...');

  // 停止接受新连接
  server.close(() => {
    console.log('✅ HTTP 服务器已关闭');
  });

  // 停止监控
  memoryMonitor.stop();
  cleanupManager.stopRoutineCleanup();

  // 停止所有文件监控
  lightweightWatcher.stopAll();

  // 等待扫描任务完成当前批次（最多等2秒）
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 关闭所有数据库连接
  dbPool.closeAll();

  console.log('✅ 关闭完成');
  process.exit(0);
};

// 导出关闭状态供其他模块检查
module.exports.isShuttingDown = () => isShuttingDown;

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('💥 未捕获异常:', error.message);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 未处理的Promise拒绝:', reason);
  shutdown();
});

// 导出供测试使用
module.exports = { app, server, io };
