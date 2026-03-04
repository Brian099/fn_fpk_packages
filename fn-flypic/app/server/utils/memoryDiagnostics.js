/**
 * Memory Diagnostics Tool
 * 诊断内存泄漏和高内存使用
 */

const v8 = require('v8');
const fs = require('fs');
const path = require('path');

/**
 * 生成堆快照
 */
function takeHeapSnapshot(filename) {
  const snapshotPath = path.join(__dirname, '..', 'logs', filename);
  
  // 确保目录存在
  const dir = path.dirname(snapshotPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const snapshot = v8.writeHeapSnapshot(snapshotPath);
  console.log(`[MemoryDiagnostics] Heap snapshot saved: ${snapshot}`);
  return snapshot;
}

/**
 * 获取堆统计信息
 */
function getHeapStatistics() {
  const stats = v8.getHeapStatistics();
  return {
    totalHeapSize: (stats.total_heap_size / 1024 / 1024).toFixed(2) + ' MB',
    totalHeapSizeExecutable: (stats.total_heap_size_executable / 1024 / 1024).toFixed(2) + ' MB',
    totalPhysicalSize: (stats.total_physical_size / 1024 / 1024).toFixed(2) + ' MB',
    totalAvailableSize: (stats.total_available_size / 1024 / 1024).toFixed(2) + ' MB',
    usedHeapSize: (stats.used_heap_size / 1024 / 1024).toFixed(2) + ' MB',
    heapSizeLimit: (stats.heap_size_limit / 1024 / 1024).toFixed(2) + ' MB',
    mallocedMemory: (stats.malloced_memory / 1024 / 1024).toFixed(2) + ' MB',
    peakMallocedMemory: (stats.peak_malloced_memory / 1024 / 1024).toFixed(2) + ' MB',
    doesZapGarbage: stats.does_zap_garbage
  };
}

/**
 * 打印堆统计信息
 */
function logHeapStatistics() {
  const stats = getHeapStatistics();
  console.log('\n[MemoryDiagnostics] Heap Statistics:');
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
}

/**
 * 强制垃圾回收并报告
 */
function forceGCAndReport() {
  if (!global.gc) {
    console.warn('[MemoryDiagnostics] GC not available. Run with --expose-gc');
    return null;
  }
  
  const before = process.memoryUsage();
  const beforeRSS = before.rss / 1024 / 1024;
  const beforeHeap = before.heapUsed / 1024 / 1024;
  
  console.log(`[MemoryDiagnostics] Before GC: RSS=${beforeRSS.toFixed(0)}MB, Heap=${beforeHeap.toFixed(0)}MB`);
  
  // 执行多次 GC
  for (let i = 0; i < 5; i++) {
    global.gc();
  }
  
  const after = process.memoryUsage();
  const afterRSS = after.rss / 1024 / 1024;
  const afterHeap = after.heapUsed / 1024 / 1024;
  
  const rssReclaimed = beforeRSS - afterRSS;
  const heapReclaimed = beforeHeap - afterHeap;
  
  console.log(`[MemoryDiagnostics] After GC: RSS=${afterRSS.toFixed(0)}MB, Heap=${afterHeap.toFixed(0)}MB`);
  console.log(`[MemoryDiagnostics] Reclaimed: RSS=${rssReclaimed.toFixed(0)}MB, Heap=${heapReclaimed.toFixed(0)}MB`);
  
  return {
    before: { rss: beforeRSS, heap: beforeHeap },
    after: { rss: afterRSS, heap: afterHeap },
    reclaimed: { rss: rssReclaimed, heap: heapReclaimed }
  };
}

/**
 * 检测可能的内存泄漏
 */
function detectMemoryLeak() {
  const usage = process.memoryUsage();
  const rss = usage.rss / 1024 / 1024;
  const heap = usage.heapUsed / 1024 / 1024;
  const external = usage.external / 1024 / 1024;
  
  const issues = [];
  
  // RSS 过高
  if (rss > 500) {
    issues.push({
      type: 'HIGH_RSS',
      severity: 'critical',
      message: `RSS is very high: ${rss.toFixed(0)}MB`,
      suggestion: 'Check for native memory leaks, large buffers, or file handles'
    });
  }
  
  // Heap 过高
  if (heap > 200) {
    issues.push({
      type: 'HIGH_HEAP',
      severity: 'warning',
      message: `Heap usage is high: ${heap.toFixed(0)}MB`,
      suggestion: 'Check for object retention, closures, or large data structures'
    });
  }
  
  // External 过高
  if (external > 100) {
    issues.push({
      type: 'HIGH_EXTERNAL',
      severity: 'warning',
      message: `External memory is high: ${external.toFixed(0)}MB`,
      suggestion: 'Check for Buffer allocations, native addons, or C++ objects'
    });
  }
  
  // RSS 远大于 Heap（可能是 native 内存泄漏）
  if (rss > heap * 3) {
    issues.push({
      type: 'RSS_HEAP_MISMATCH',
      severity: 'critical',
      message: `RSS (${rss.toFixed(0)}MB) is much larger than Heap (${heap.toFixed(0)}MB)`,
      suggestion: 'Likely native memory leak. Check SQLite, Sharp, or other native modules'
    });
  }
  
  return issues;
}

/**
 * 打印内存泄漏诊断
 */
function diagnoseMemoryLeak() {
  console.log('\n[MemoryDiagnostics] Running memory leak detection...\n');
  
  const issues = detectMemoryLeak();
  
  if (issues.length === 0) {
    console.log('✅ No obvious memory issues detected');
  } else {
    console.log(`⚠️  Found ${issues.length} potential issues:\n`);
    issues.forEach((issue, index) => {
      console.log(`${index + 1}. [${issue.severity.toUpperCase()}] ${issue.type}`);
      console.log(`   ${issue.message}`);
      console.log(`   💡 ${issue.suggestion}\n`);
    });
  }
  
  return issues;
}

module.exports = {
  takeHeapSnapshot,
  getHeapStatistics,
  logHeapStatistics,
  forceGCAndReport,
  detectMemoryLeak,
  diagnoseMemoryLeak
};
