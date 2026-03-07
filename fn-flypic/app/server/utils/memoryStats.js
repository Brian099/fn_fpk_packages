/**
 * Memory Statistics Utility
 * 显示详细的内存使用统计
 */

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemoryStats() {
  const usage = process.memoryUsage();
  
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    heapUsedMB: formatBytes(usage.heapUsed),
    heapTotalMB: formatBytes(usage.heapTotal),
    rssMB: formatBytes(usage.rss),
    externalMB: formatBytes(usage.external),
    arrayBuffersMB: formatBytes(usage.arrayBuffers)
  };
}

function logMemoryStats(label = 'Memory') {
  const stats = getMemoryStats();
  console.log(`\n[${label}] Memory Statistics:`);
  console.log(`  RSS (总内存):      ${stats.rssMB}`);
  console.log(`  Heap Used (堆使用): ${stats.heapUsedMB}`);
  console.log(`  Heap Total (堆总量):${stats.heapTotalMB}`);
  console.log(`  External (外部):   ${stats.externalMB}`);
  console.log(`  Array Buffers:     ${stats.arrayBuffersMB}`);
}

function getMemoryPressure() {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const rssMB = usage.rss / 1024 / 1024;
  
  let pressure = 'low';
  if (heapUsedMB > 200 || rssMB > 500) {
    pressure = 'critical';
  } else if (heapUsedMB > 100 || rssMB > 300) {
    pressure = 'high';
  } else if (heapUsedMB > 50 || rssMB > 150) {
    pressure = 'medium';
  }
  
  return {
    level: pressure,
    heapUsedMB,
    rssMB
  };
}

module.exports = {
  getMemoryStats,
  logMemoryStats,
  getMemoryPressure,
  formatBytes
};
