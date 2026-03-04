const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { constants } = require('../src/config');
const logger = require('../src/utils/logger');

// 配置 Sharp 内存限制（防止内存泄漏）
const SHARP_CONFIG = {
  memory: constants.THUMBNAIL_GENERATION.SHARP_CACHE_MEMORY_MB,
  files: 0,
  items: constants.THUMBNAIL_GENERATION.SHARP_CACHE_ITEMS
};

sharp.cache(SHARP_CONFIG);

// 设置并发限制
sharp.concurrency(constants.THUMBNAIL_GENERATION.SHARP_CONCURRENCY);

// 清理 Sharp 缓存的函数（扫描完成后调用）
function clearSharpCache() {
  sharp.cache(false);  // 完全禁用缓存
  sharp.cache(SHARP_CONFIG); // 重新启用最小缓存
}

// 支持的文件格式（确定可以生成缩略图的）
const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'heif', 'heic', 'svg'];

// 文件类型分类（用于显示和占位图）
const FILE_CATEGORIES = {
  // 图片类
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'heif', 'heic', 'svg', 'ico', 'raw', 'cr2', 'nef', 'dng'],

  // 视频类
  video: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'm4v', 'wmv', 'mpg', 'mpeg', '3gp', 'ts', 'vob', 'ogv'],

  // 音频类
  audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'ape', 'alac', 'opus', 'aiff'],

  // 文档类
  document: [
    'pdf', 'txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'rtf', 'odt', 'ods', 'odp', 'csv', 'pages', 'numbers', 'key'
  ],

  // 设计类
  design: ['psd', 'ai', 'sketch', 'xd', 'fig', 'figma', 'indd', 'eps', 'cdr', 'dwg']
};

// 为了兼容旧代码
const SUPPORTED_FORMATS = {
  image: IMAGE_FORMATS,
  video: FILE_CATEGORIES.video,
  document: FILE_CATEGORIES.document,
  special: FILE_CATEGORIES.design
};

// 所有支持的格式（扁平化，兼容所有文件）
const ALL_FORMATS = [
  ...FILE_CATEGORIES.image,
  ...FILE_CATEGORIES.video,
  ...FILE_CATEGORIES.audio,
  ...FILE_CATEGORIES.document,
  ...FILE_CATEGORIES.design
];

/**
 * 获取文件类型分类
 */
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);

  // 检查所有分类
  if (FILE_CATEGORIES.image.includes(ext)) return 'image';
  if (FILE_CATEGORIES.video.includes(ext)) return 'video';
  if (FILE_CATEGORIES.audio.includes(ext)) return 'audio';
  if (FILE_CATEGORIES.document.includes(ext)) return 'document';
  if (FILE_CATEGORIES.design.includes(ext)) return 'design';

  // 未知类型也兼容，归类为 other
  return 'other';
}

/**
 * 检查文件是否可以用 Sharp 生成缩略图
 */
function canGenerateThumbnail(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return IMAGE_FORMATS.includes(ext);
}

/**
 * Check if file is supported
 */
function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return ALL_FORMATS.includes(ext);
}

/**
 * Calculate file hash for change detection
 * 优化：使用文件大小+修改时间作为快速哈希，避免读取整个文件
 */
function calculateFileHash(filePath) {
  try {
    const stats = fs.statSync(filePath);
    // 使用文件大小 + 修改时间作为快速哈希（足够检测变化）
    const quickHash = `${stats.size}-${stats.mtimeMs}`;
    const hashSum = crypto.createHash('md5');
    hashSum.update(quickHash);
    return hashSum.digest('hex');
  } catch (error) {
    // 回退到空哈希
    return crypto.createHash('md5').update(filePath).digest('hex');
  }
}

/**
 * Get thumbnail configuration based on original image size
 * 分阶段策略：根据原图大小使用不同的缩略图尺寸和质量
 * 
 * 策略说明：
 * - 小图（<1MP）：保持原尺寸或轻微缩小，高质量
 * - 中图（1-4MP）：缩略图 200px 高，高质量
 * - 大图（4-12MP）：缩略图 250px 高，中高质量
 * - 超大图（>12MP）：缩略图 300px 高，中等质量
 */
function getThumbnailConfig(originalWidth, originalHeight, targetHeight = 200) {
  const originalPixels = originalWidth * originalHeight;
  const aspectRatio = originalWidth / originalHeight;

  let finalHeight, finalQuality, targetSize;

  // 分阶段策略 - 提高质量，扩大文件大小
  if (originalPixels < 1000000) {
    // 小图 <1MP（如 1000x1000）：保持较小尺寸，极高质量
    finalHeight = Math.min(targetHeight, originalHeight);
    finalQuality = 95;
    targetSize = { min: 80 * 1024, max: 240 * 1024 }; // 80-240KB
  }
  else if (originalPixels < 4000000) {
    // 中图 1-4MP（如 2000x2000）：标准尺寸，极高质量
    finalHeight = Math.min(targetHeight, originalHeight);
    finalQuality = 93;
    targetSize = { min: 120 * 1024, max: 300 * 1024 }; // 120-300KB
  }
  else if (originalPixels < 12000000) {
    // 大图 4-12MP（如 4000x3000）：增大尺寸，高质量
    finalHeight = Math.min(targetHeight, originalHeight);
    finalQuality = 91;
    targetSize = { min: 160 * 1024, max: 400 * 1024 }; // 160-400KB
  }
  else {
    // 超大图 >12MP（如 6000x4000）：更大尺寸，高质量
    finalHeight = Math.min(targetHeight, originalHeight);
    finalQuality = 89;
    targetSize = { min: 200 * 1024, max: 500 * 1024 }; // 200-500KB
  }

  const finalWidth = Math.round(aspectRatio * finalHeight);

  // 计算原图大小（MP）
  const megaPixels = (originalPixels / 1000000).toFixed(1);

  return {
    width: finalWidth,
    height: finalHeight,
    quality: finalQuality,
    targetSize: targetSize,
    format: 'webp',
    originalPixels: originalPixels,
    megaPixels: megaPixels
  };
}

/**
 * Generate thumbnail for an image with high quality settings
 * 
 * 核心优化点：
 * 1. 禁用 smartSubsample，保持色彩锐度（关键！）
 * 2. 使用更强的 unsharp mask 锐化
 * 3. 固定高质量 Q96，不动态调整
 * 4. 不修改色彩（饱和度/亮度），保持原图风格
 */
async function generateThumbnail(inputPath, outputPath, targetHeight = 200) {
  const startTime = Date.now();
  const filename = path.basename(inputPath);
  
  try {
    // 先读取文件到 Buffer，避免 Sharp 锁定文件句柄
    let inputBuffer = fs.readFileSync(inputPath);

    // Get image metadata from buffer
    const metadata = await sharp(inputBuffer).metadata();
    const config = getThumbnailConfig(metadata.width, metadata.height, targetHeight);
    const hasAlpha = Boolean(metadata.hasAlpha);

    // 计算缩小比例，用于调整锐化强度
    const downscaleRatio = metadata.height ? (metadata.height / config.height) : 1;

    // 锐化参数：根据缩小比例动态调整
    // sharpen(sigma, flat, jagged) - sigma: 高斯模糊半径, flat: 平坦区域锐化, jagged: 边缘锐化
    let sharpSigma, sharpFlat, sharpJagged;
    if (downscaleRatio >= 4) {
      // 大幅缩小（如 4000px → 300px）：强锐化
      sharpSigma = 1.2;
      sharpFlat = 1.0;
      sharpJagged = 2.0;
    } else if (downscaleRatio >= 2) {
      // 中等缩小：中等锐化
      sharpSigma = 1.0;
      sharpFlat = 0.8;
      sharpJagged = 1.5;
    } else {
      // 轻微缩小或不缩小：轻度锐化
      sharpSigma = 0.8;
      sharpFlat = 0.5;
      sharpJagged = 1.0;
    }

    // 使用配置的质量
    const quality = constants.THUMBNAIL_GENERATION.DEFAULT_QUALITY;
    const effort = constants.THUMBNAIL_GENERATION.EFFORT;

    // 生成缩略图（使用 buffer，不锁定原文件）
    const processStart = Date.now();
    await sharp(inputBuffer)
      .rotate() // 按EXIF旋转
      .resize(config.width, config.height, {
        fit: 'cover',
        position: 'center',
        kernel: 'lanczos3',  // 最高质量缩放算法
        withoutEnlargement: true,
        fastShrinkOnLoad: false  // 禁用快速缩小，保持质量
      })
      // 锐化：使用完整的 unsharp mask 参数（不修改色彩）
      .sharpen({
        sigma: sharpSigma,    // 高斯模糊半径
        m1: sharpFlat,        // 平坦区域锐化强度
        m2: sharpJagged,      // 边缘/锯齿区域锐化强度
        x1: 2,                // 平坦区域阈值
        y2: 10,               // 边缘区域阈值上限
        y3: 20                // 最大锐化限制
      })
      .webp({
        quality: quality,
        effort: effort,
        smartSubsample: false, // 关键！禁用色度子采样，保持边缘清晰
        nearLossless: false,   // 禁用近无损（会增加体积但不增加清晰度）
        preset: 'photo',
        alphaQuality: hasAlpha ? 100 : undefined
      })
      .toFile(outputPath);
    const processTime = Date.now() - processStart;

    // 显式释放 Buffer 内存
    inputBuffer = null;
    
    // 强制 GC（如果可用）
    const gcProbability = constants.THUMBNAIL_GENERATION.GC_PROBABILITY;
    if (global.gc && Math.random() < gcProbability) {
      global.gc();
    }

    // 获取文件大小
    const stats = fs.statSync(outputPath);
    const finalSize = stats.size;

    const totalTime = Date.now() - startTime;
    
    // 只有当耗时超过 200ms 时才输出警告
    if (totalTime > 200) {
      console.log(`⚠️  Sharp处理较慢: ${filename} (总计${totalTime}ms, 处理${processTime}ms)`);
    }

    return {
      width: config.width,
      height: config.height,
      size: finalSize,
      quality: quality,
      originalPixels: config.originalPixels,
      path: outputPath,
      timing: { total: totalTime, process: processTime }
    };
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    throw error;
  }
}

/**
 * Get file metadata (支持所有文件类型)
 * 优化：优先使用流式读取，避免加载整个文件到内存
 */
async function getImageMetadata(imagePath) {
  try {
    const stats = fs.statSync(imagePath);
    const fileType = getFileType(imagePath);

    // 对于图片文件，尝试获取详细元数据
    if (fileType === 'image') {
      try {
        // 优化：直接传入路径，让 sharp 使用流式读取，仅读取头部元数据
        // 只有在失败时才回退到 Buffer 读取
        const metadata = await sharp(imagePath).metadata();
        return {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
          size: stats.size,
          created_at: stats.birthtimeMs,
          modified_at: stats.mtimeMs
        };
      } catch (sharpError) {
        // Sharp 无法处理某些图片格式（如 SVG）或路径问题，回退到基础信息
        // console.warn(`Sharp cannot process ${imagePath}, using basic metadata`);
      }
    }

    // 对于非图片文件或 Sharp 失败的情况，返回基础信息
    const ext = path.extname(imagePath).toLowerCase().slice(1);
    return {
      width: 640,  // 占位图尺寸
      height: 480,
      format: ext,
      size: stats.size,
      created_at: stats.birthtimeMs,
      modified_at: stats.mtimeMs
    };
  } catch (error) {
    console.error('Error getting file metadata:', imagePath, error);
    return null;
  }
}

/**
 * Generate thumbnail for a file (image/video/document)
 * 使用 480px 高度（与 Billfish 一致）
 */
async function generateImageThumbnails(imagePath, libraryPath) {
  const startTime = Date.now();
  const filename = path.basename(imagePath);
  const stepTimes = {};
  
  const flypicDir = path.join(libraryPath, '.flypic');
  const relativePath = path.relative(libraryPath, imagePath);
  const hash = crypto.createHash('md5').update(relativePath).digest('hex');
  const fileType = getFileType(imagePath);

  // Sharding: use first 2 chars of hash for subdirectories (e.g. /ab/)
  const shard1 = hash.slice(0, 2);
  const targetHeight = constants.THUMBNAIL_GENERATION.TARGET_HEIGHT;
  
  // 1-level sharding: .flypic/thumbnails/ab/hash.webp
  const out480 = path.join(flypicDir, 'thumbnails', shard1, `${hash}.webp`);
  fs.mkdirSync(path.dirname(out480), { recursive: true });

  let thumbnailResult;
  let stepStart = Date.now();

  // 根据文件类型生成不同的缩略图
  const ext = path.extname(imagePath).slice(1).toUpperCase();

  if (fileType === 'image' && canGenerateThumbnail(imagePath)) {
    // 图片：使用 Sharp 生成真实缩略图
    stepStart = Date.now();
    thumbnailResult = await generateThumbnail(imagePath, out480, targetHeight);
    stepTimes.generate = Date.now() - stepStart;
  } else if (fileType === 'video') {
    // 视频：尝试提取封面
    stepStart = Date.now();
    thumbnailResult = await extractVideoThumbnail(imagePath, out480);
    stepTimes.videoExtract = Date.now() - stepStart;

    // 如果提取失败，生成占位图
    if (!thumbnailResult) {
      stepStart = Date.now();
      thumbnailResult = await generatePlaceholderThumbnail(out480, 'video', ext);
      stepTimes.placeholder = Date.now() - stepStart;
    }
  } else if (fileType === 'design') {
    // 设计文件：尝试提取嵌入缩略图（仅 PSD）
    if (ext.toLowerCase() === 'psd') {
      stepStart = Date.now();
      thumbnailResult = await extractPSDThumbnail(imagePath, out480);
      stepTimes.psdExtract = Date.now() - stepStart;
    }

    // 如果提取失败或不是 PSD，生成占位图
    if (!thumbnailResult) {
      stepStart = Date.now();
      thumbnailResult = await generatePlaceholderThumbnail(out480, 'design', ext);
      stepTimes.placeholder = Date.now() - stepStart;
    }
  } else {
    // 其他类型（音频/文档/未知）：生成占位图
    stepStart = Date.now();
    thumbnailResult = await generatePlaceholderThumbnail(out480, fileType, ext);
    stepTimes.placeholder = Date.now() - stepStart;
  }

  // 返回相对于 libraryPath 的路径（包含 .flypic 前缀）
  const thumbnailPath = path.relative(libraryPath, out480).replace(/\\/g, '/');
  
  const totalTime = Date.now() - startTime;
  
  // 只有当总耗时超过 300ms 时才输出警告
  if (totalTime > 300) {
    const details = Object.entries(stepTimes)
      .map(([key, time]) => `${key}:${time}ms`)
      .join(', ');
    console.log(`⚠️  缩略图较慢: ${filename} (总计${totalTime}ms, ${details})`);
  }

  return {
    thumbnail_path: thumbnailPath,
    thumbnail_size: thumbnailResult.size,
    width: thumbnailResult.width,
    height: thumbnailResult.height,
    file_type: fileType,
    timing: stepTimes,
    totalTime
  };
}

/**
 * 从 PSD 文件提取嵌入的缩略图
 * 优化：使用部分读取，避免加载整个 PSD 文件到内存
 */
async function extractPSDThumbnail(psdPath, outputPath) {
  let fd = null;
  try {
    fd = fs.openSync(psdPath, 'r');
    
    // 读取头部（前 100 字节足够获取基本信息）
    const headerBuffer = Buffer.alloc(100);
    fs.readSync(fd, headerBuffer, 0, 100, 0);

    // PSD 文件格式：前 4 字节: "8BPS" (签名)
    if (headerBuffer.toString('utf8', 0, 4) !== '8BPS') {
      throw new Error('Not a valid PSD file');
    }

    // 读取 Color Mode Data 长度（偏移 26）
    const colorModeLength = headerBuffer.readUInt32BE(26);
    const imageResourcesOffset = 26 + 4 + colorModeLength;

    // 读取 Image Resources Section 长度
    const irLengthBuffer = Buffer.alloc(4);
    fs.readSync(fd, irLengthBuffer, 0, 4, imageResourcesOffset);
    const imageResourcesLength = irLengthBuffer.readUInt32BE(0);

    // 限制读取大小（最多 2MB，缩略图通常在前面）
    const maxReadSize = Math.min(imageResourcesLength, 2 * 1024 * 1024);
    const resourcesBuffer = Buffer.alloc(maxReadSize);
    fs.readSync(fd, resourcesBuffer, 0, maxReadSize, imageResourcesOffset + 4);
    
    fs.closeSync(fd);
    fd = null;

    let offset = 0;
    const endOffset = maxReadSize;

    // 查找缩略图资源 (ID 1033 或 1036)
    while (offset < endOffset - 12) {
      const signature = resourcesBuffer.toString('utf8', offset, offset + 4);
      if (signature !== '8BIM') break;

      const resourceId = resourcesBuffer.readUInt16BE(offset + 4);
      const nameLength = resourcesBuffer.readUInt8(offset + 6);
      const namePadding = nameLength % 2 === 0 ? nameLength + 2 : nameLength + 1;
      
      if (offset + 6 + namePadding + 4 > endOffset) break;
      
      const dataSize = resourcesBuffer.readUInt32BE(offset + 6 + namePadding);
      const dataPadding = dataSize % 2 === 0 ? dataSize : dataSize + 1;

      // 1033 = 缩略图 (旧格式), 1036 = 缩略图 (新格式)
      if (resourceId === 1033 || resourceId === 1036) {
        const dataOffset = offset + 6 + namePadding + 4;

        // 跳过前 28 字节的头部信息
        const jpegOffset = dataOffset + 28;
        const jpegSize = dataSize - 28;
        
        if (jpegOffset + jpegSize > endOffset) {
          throw new Error('Thumbnail data exceeds buffer');
        }
        
        const jpegData = resourcesBuffer.slice(jpegOffset, jpegOffset + jpegSize);

        // 先获取原始缩略图尺寸
        const metadata = await sharp(jpegData).metadata();

        // 使用高质量缩放，保持宽高比
        const aspectRatio = metadata.width / metadata.height;
        const targetHeight = 480;
        const targetWidth = Math.round(targetHeight * aspectRatio);

        // 简化处理策略
        const processStart = Date.now();
        await sharp(jpegData)
          .resize(targetWidth, targetHeight, {
            fit: 'inside',
            kernel: 'lanczos3',
            withoutEnlargement: metadata.width >= 500
          })
          .sharpen({ sigma: 1.0, m1: 0.8, m2: 1.5 })
          .webp({
            quality: 95,
            effort: 4,
            smartSubsample: false
          })
          .toFile(outputPath);
        const processTime = Date.now() - processStart;

        const stats = fs.statSync(outputPath);
        return {
          width: targetWidth,
          height: targetHeight,
          size: stats.size,
          path: outputPath
        };
      }

      offset += 6 + namePadding + 4 + dataPadding;
    }

    throw new Error('No thumbnail found in PSD');
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (e) {}
    }
    console.warn(`Failed to extract PSD thumbnail: ${error.message}`);
    return null;
  }
}

/**
 * 从视频提取封面（使用 ffmpeg 或系统工具）
 * 注意：这需要系统安装 ffmpeg，如果没有则回退到占位图
 */
async function extractVideoThumbnail(videoPath, outputPath) {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    // 检查是否有 ffmpeg
    try {
      await execPromise('ffmpeg -version', { timeout: 2000 });
    } catch (e) {
      console.warn('  ⚠️ ffmpeg not found, skipping video thumbnail extraction');
      return null;
    }

    // 使用 ffmpeg 提取第 2 秒的帧（避免黑屏）
    const tempJpg = outputPath.replace('.webp', '_temp.jpg');
    const ffmpegCmd = `ffmpeg -i "${videoPath}" -ss 00:00:02 -vframes 1 -q:v 2 "${tempJpg}" -y`;

    await execPromise(ffmpegCmd, { timeout: 10000 });

    // 如果生成了 JPG，转换为 WebP
    if (fs.existsSync(tempJpg)) {
      // 先获取实际尺寸
      const metadata = await sharp(tempJpg).metadata();

      // 保持宽高比缩放到 480 高度
      const aspectRatio = metadata.width / metadata.height;
      const targetHeight = 480;
      const targetWidth = Math.round(targetHeight * aspectRatio);

      await sharp(tempJpg)
        .resize(targetWidth, targetHeight, {
          fit: 'cover',
          position: 'center',
          kernel: 'lanczos3',
          withoutEnlargement: true
        })
        .webp({ quality: 92, smartSubsample: false })
        .toFile(outputPath);

      fs.unlinkSync(tempJpg);  // 删除临时 JPG

      const stats = fs.statSync(outputPath);
      return {
        width: targetWidth,
        height: targetHeight,
        size: stats.size,
        path: outputPath
      };
    }

    return null;
  } catch (error) {
    console.warn(`  ⚠️ Failed to extract video thumbnail: ${error.message}`);
    return null;
  }
}

/**
 * 生成占位缩略图（用于视频/文档等）
 */
async function generatePlaceholderThumbnail(outputPath, type, label) {
  // 使用 Sharp 生成简单的占位图
  const width = constants.THUMBNAIL_GENERATION.PLACEHOLDER_WIDTH;
  const height = constants.THUMBNAIL_GENERATION.PLACEHOLDER_HEIGHT;

  // 不同类型的背景色和图标
  const typeConfig = {
    image: {
      color: { r: 99, g: 102, b: 241 },     // 靛蓝色
      icon: '🖼️',
      text: '图片'
    },
    video: {
      color: { r: 59, g: 130, b: 246 },     // 蓝色
      icon: '🎬',
      text: '视频'
    },
    audio: {
      color: { r: 236, g: 72, b: 153 },     // 粉色
      icon: '🎵',
      text: '音频'
    },
    document: {
      color: { r: 16, g: 185, b: 129 },     // 绿色
      icon: '📄',
      text: '文档'
    },
    design: {
      color: { r: 168, g: 85, b: 247 },     // 紫色
      icon: '🎨',
      text: '设计'
    },
    other: {
      color: { r: 107, g: 114, b: 128 },    // 灰色
      icon: '📁',
      text: '其他'
    }
  };

  const config = typeConfig[type] || typeConfig.other;

  const color = config.color;

  // 创建渐变背景 + 图标 + 文件扩展名
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:rgb(${color.r},${color.g},${color.b});stop-opacity:0.15" />
          <stop offset="100%" style="stop-color:rgb(${color.r},${color.g},${color.b});stop-opacity:0.05" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)"/>
      <text x="50%" y="35%" font-family="Arial, sans-serif" font-size="100" fill="rgb(${color.r},${color.g},${color.b})" text-anchor="middle" dominant-baseline="middle" opacity="0.35">
        ${config.icon}
      </text>
      <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="rgb(${color.r},${color.g},${color.b})" text-anchor="middle" dominant-baseline="middle" opacity="0.7">
        .${label.toLowerCase()}
      </text>
      <text x="50%" y="68%" font-family="Arial, sans-serif" font-size="24" fill="rgb(${color.r},${color.g},${color.b})" text-anchor="middle" dominant-baseline="middle" opacity="0.5">
        ${config.text}文件
      </text>
      <text x="50%" y="78%" font-family="Arial, sans-serif" font-size="18" fill="rgb(${color.r},${color.g},${color.b})" text-anchor="middle" dominant-baseline="middle" opacity="0.4">
        双击在默认应用中打开
      </text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(width, height)
    .webp({ quality: 85 })
    .toFile(outputPath);

  const stats = fs.statSync(outputPath);
  return {
    width,
    height,
    size: stats.size,
    path: outputPath
  };
}

module.exports = {
  isImageFile,
  getFileType,
  calculateFileHash,
  getThumbnailConfig,
  generateThumbnail,
  getImageMetadata,
  generateImageThumbnails,
  clearSharpCache,
  SUPPORTED_FORMATS,
  ALL_FORMATS
};
