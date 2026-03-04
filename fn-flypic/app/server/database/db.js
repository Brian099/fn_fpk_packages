const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { constants } = require('../src/config');

class LibraryDatabase {
  constructor(libraryPath) {
    this.libraryPath = libraryPath;
    this.flypicDir = path.join(libraryPath, '.flypic');
    this.dbPath = path.join(this.flypicDir, 'metadata.db');
    
    // Ensure .flypic directory exists
    if (!fs.existsSync(this.flypicDir)) {
      fs.mkdirSync(this.flypicDir, { recursive: true });
    }
    
    // Create thumbnails directory (使用分片结构: .flypic/thumbnails/ab/hash.webp)
    const thumbDir = path.join(this.flypicDir, 'thumbnails');
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    
    this.db = new Database(this.dbPath);
    
    // 优化数据库性能
    this.db.pragma('journal_mode = WAL'); // 启用 WAL 模式，支持并发读写
    this.db.pragma('synchronous = NORMAL'); // 平衡性能和安全性
    this.db.pragma('cache_size = -64000'); // 64MB 缓存
    this.db.pragma('temp_store = MEMORY'); // 临时表存储在内存
    this.db.pragma('mmap_size = 268435456'); // 256MB 内存映射
    
    this.initTables();
    
    // 启动 WAL 定期 checkpoint（使用配置的间隔）
    const checkpointInterval = constants.MEMORY.WAL_CHECKPOINT_INTERVAL_MS || 600000;
    this.walCheckpointInterval = setInterval(() => {
      try {
        this.db.pragma('wal_checkpoint(PASSIVE)');
      } catch (e) {
        console.warn('[DB] WAL checkpoint warning:', e.message);
      }
    }, checkpointInterval); // 10分钟（降低I/O开销，不影响性能）
  }

  initTables() {
    // Images table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        folder TEXT NOT NULL,
        size INTEGER,
        width INTEGER,
        height INTEGER,
        format TEXT,
        file_type TEXT DEFAULT 'image',
        created_at INTEGER,
        modified_at INTEGER,
        file_hash TEXT,
        thumbnail_path TEXT,
        thumbnail_size INTEGER,
        indexed_at INTEGER
      )
    `);
    
    // 添加 file_type 列（如果不存在）
    try {
      this.db.exec(`ALTER TABLE images ADD COLUMN file_type TEXT DEFAULT 'image'`);
    } catch (e) {
      // 列已存在，忽略错误
    }

    // 添加 rating 列（如果不存在）
    try {
      this.db.exec(`ALTER TABLE images ADD COLUMN rating INTEGER DEFAULT 0`);
    } catch (e) {
      // 列已存在，忽略错误
    }

    // 添加 favorite 列（如果不存在）
    try {
      this.db.exec(`ALTER TABLE images ADD COLUMN favorite INTEGER DEFAULT 0`);
    } catch (e) {
      // 列已存在，忽略错误
    }

    // 添加 tags 列（如果不存在）
    try {
      this.db.exec(`ALTER TABLE images ADD COLUMN tags TEXT DEFAULT ''`);
    } catch (e) {
      // 列已存在，忽略错误
    }

    // Folders table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        parent_path TEXT,
        name TEXT NOT NULL,
        image_count INTEGER DEFAULT 0,
        last_scan INTEGER
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_filename ON images(filename);
      CREATE INDEX IF NOT EXISTS idx_folder ON images(folder);
      CREATE INDEX IF NOT EXISTS idx_created_at ON images(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_file_hash ON images(file_hash);
      CREATE INDEX IF NOT EXISTS idx_folder_path ON folders(path);
      CREATE INDEX IF NOT EXISTS idx_folder_parent ON folders(parent_path);
      -- 复合索引：优化文件夹+时间排序查询
      CREATE INDEX IF NOT EXISTS idx_folder_created ON images(folder, created_at DESC);
      -- 评分和收藏索引：优化筛选查询
      CREATE INDEX IF NOT EXISTS idx_rating ON images(rating DESC);
      CREATE INDEX IF NOT EXISTS idx_favorite ON images(favorite DESC);
    `);

    // Metadata table for tracking database modifications
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      )
    `);

    // Initialize last_modified if not exists
    const lastModified = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('last_modified');
    if (!lastModified) {
      this.db.prepare('INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?)').run('last_modified', Date.now().toString(), Date.now());
    }
  }

  /**
   * 更新数据库最后修改时间
   */
  updateLastModified() {
    const now = Date.now();
    this.db.prepare('INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES (?, ?, ?)').run('last_modified', now.toString(), now);
    return now;
  }

  /**
   * 获取数据库最后修改时间
   */
  getLastModified() {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('last_modified');
    return row ? parseInt(row.value, 10) : Date.now();
  }

  /**
   * 获取缓存元数据
   */
  getCacheMeta() {
    const lastModified = this.getLastModified();
    const imageCount = this.db.prepare('SELECT COUNT(*) as count FROM images').get();
    const folderCount = this.db.prepare('SELECT COUNT(*) as count FROM folders').get();
    return {
      dbModifiedAt: lastModified,
      totalImages: imageCount.count,
      totalFolders: folderCount.count
    };
  }

  // Image operations
  insertImage(imageData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO images 
      (path, filename, folder, size, width, height, format, file_type, created_at, modified_at, file_hash, thumbnail_path, thumbnail_size, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      imageData.path,
      imageData.filename,
      imageData.folder,
      imageData.size,
      imageData.width,
      imageData.height,
      imageData.format,
      imageData.file_type || 'image',
      imageData.created_at,
      imageData.modified_at,
      imageData.file_hash,
      imageData.thumbnail_path,
      imageData.thumbnail_size,
      Date.now()
    );
    // 更新数据库修改时间
    this.updateLastModified();
    return result;
  }

  getImageByPath(imagePath) {
    const stmt = this.db.prepare('SELECT * FROM images WHERE path = ?');
    return stmt.get(imagePath);
  }

  getImagesByFolderPrefix(folderPath) {
    // 获取文件夹内所有图片记录（包括子文件夹）
    const stmt = this.db.prepare('SELECT * FROM images WHERE folder = ? OR folder LIKE ?');
    return stmt.all(folderPath, `${folderPath}/%`);
  }

  getAllImages() {
    // ⚠️ 警告：此方法会加载所有图片到内存，仅用于调试！
    // 生产环境请使用 searchImages() 或流式查询
    console.warn('[DB] WARNING: getAllImages() loads all data into memory. Use searchImages() instead!');
    const stmt = this.db.prepare('SELECT * FROM images ORDER BY created_at DESC LIMIT 1000');
    return stmt.all(); // 限制最多 1000 条
  }

  searchImages(keywords, filters = {}, pagination = null) {
    let baseQuery = 'FROM images WHERE 1=1';
    const params = [];

    // Keyword search (AND logic)
    if (keywords && keywords.trim()) {
      const terms = keywords.trim().split(/\s+/);
      terms.forEach(term => {
        baseQuery += ' AND filename LIKE ?';
        params.push(`%${term}%`);
      });
    }

    // Folder filter
    if (filters.folder) {
      // 使用 OR 组合精确匹配和前缀匹配，包含子文件夹
      baseQuery += ' AND (folder = ? OR folder LIKE ?)';
      params.push(filters.folder, `${filters.folder}/%`);
    }

    // Format filter
    if (filters.formats && filters.formats.length > 0) {
      const placeholders = filters.formats.map(() => '?').join(',');
      baseQuery += ` AND format IN (${placeholders})`;
      params.push(...filters.formats);
    }

    // Size filter (in KB)
    if (filters.minSize) {
      baseQuery += ' AND size >= ?';
      params.push(filters.minSize * 1024);
    }
    if (filters.maxSize) {
      baseQuery += ' AND size <= ?';
      params.push(filters.maxSize * 1024);
    }

    // Date filter
    if (filters.startDate) {
      baseQuery += ' AND created_at >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      baseQuery += ' AND created_at <= ?';
      params.push(filters.endDate);
    }

    // 如果需要分页
    if (pagination && typeof pagination.offset === 'number' && typeof pagination.limit === 'number') {
      const timings = {};
      
      // 只选择必要字段，减少内存占用
      const essentialFields = 'id, path, filename, size, format, width, height, thumbnail_path, folder';
      const query = `SELECT ${essentialFields} ${baseQuery} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const paginatedParams = [...params, pagination.limit, pagination.offset];
      
      let queryStart = Date.now();
      const stmt = this.db.prepare(query);
      const images = stmt.all(...paginatedParams);
      timings.dataQuery = Date.now() - queryStart;

      // 如果是第一页且结果数量小于 limit，说明没有更多数据，无需 COUNT
      if (pagination.offset === 0 && images.length < pagination.limit) {
        return {
          images,
          total: images.length,
          offset: pagination.offset,
          limit: pagination.limit,
          hasMore: false
        };
      }

      // 如果是文件夹查询，尝试从 folders 表获取 count（更快）
      let total = 0;
      queryStart = Date.now();
      if (filters.folder && !keywords && !filters.formats?.length && !filters.minSize && !filters.maxSize && !filters.startDate && !filters.endDate) {
        const folderRow = this.db.prepare('SELECT image_count FROM folders WHERE path = ?').get(filters.folder);
        if (folderRow) {
          total = folderRow.image_count;
          timings.countSource = 'folders_table';
        }
      }
      
      // 如果无法从 folders 表获取，才执行 COUNT（较慢）
      if (total === 0) {
        const countStmt = this.db.prepare(`SELECT COUNT(*) as total ${baseQuery}`);
        const countResult = countStmt.get(...params);
        total = countResult.total;
        timings.countSource = 'count_query';
      }
      timings.countQuery = Date.now() - queryStart;

      // 性能日志
      const totalTime = timings.dataQuery + timings.countQuery;
      if (totalTime > 50) {
        console.log(`[DB] searchImages: data=${timings.dataQuery}ms, count=${timings.countQuery}ms (${timings.countSource}), folder=${filters.folder || 'all'}`);
      }

      return {
        images,
        total,
        offset: pagination.offset,
        limit: pagination.limit,
        hasMore: pagination.offset + images.length < total
      };
    }

    // 无分页，返回所有结果（保持向后兼容）
    const query = `SELECT * ${baseQuery} ORDER BY created_at DESC`;
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  deleteImage(imagePath) {
    const stmt = this.db.prepare('DELETE FROM images WHERE path = ?');
    const result = stmt.run(imagePath);
    // 更新数据库修改时间
    if (result.changes > 0) {
      this.updateLastModified();
    }
    return result;
  }

  // Update folder field for a specific image (by path)
  updateImageFolder(imagePath, folderPath) {
    const stmt = this.db.prepare('UPDATE images SET folder = ? WHERE path = ?');
    return stmt.run(folderPath, imagePath);
  }

  // Folder operations
  insertFolder(folderData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO folders (path, parent_path, name, image_count, last_scan)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(
      folderData.path,
      folderData.parent_path,
      folderData.name,
      folderData.image_count || 0,
      Date.now()
    );
  }

  getAllFolders() {
    const stmt = this.db.prepare('SELECT * FROM folders ORDER BY path');
    return stmt.all();
  }

  getFolderByPath(folderPath) {
    const stmt = this.db.prepare('SELECT * FROM folders WHERE path = ?');
    return stmt.get(folderPath);
  }

  deleteFolder(folderPath) {
    const stmt = this.db.prepare('DELETE FROM folders WHERE path = ?');
    return stmt.run(folderPath);
  }

  deleteImagesByFolderPrefix(folderPath) {
    // 使用 folderPath/% 确保只匹配真正的子文件夹，避免误删同名前缀文件夹
    const stmt = this.db.prepare('DELETE FROM images WHERE folder = ? OR folder LIKE ?');
    const result = stmt.run(folderPath, `${folderPath}/%`);
    // 更新数据库修改时间
    if (result.changes > 0) {
      this.updateLastModified();
    }
    return result;
  }

  deleteFoldersByPrefix(folderPath) {
    // 使用 folderPath/% 确保只匹配真正的子文件夹
    const stmt = this.db.prepare('DELETE FROM folders WHERE path = ? OR path LIKE ?');
    return stmt.run(folderPath, `${folderPath}/%`);
  }

  /**
   * 更新文件夹的文件数量（包含所有子文件夹中的图片）
   */
  updateFolderImageCount(folderPath) {
    // 统计该文件夹及其所有子文件夹中的图片总数
    // folder = ? 匹配直接子文件，folder LIKE ?/% 匹配所有子文件夹
    const countStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM images WHERE folder = ? OR folder LIKE ?'
    );
    const result = countStmt.get(folderPath, `${folderPath}/%`);
    
    // 更新文件夹记录
    const updateStmt = this.db.prepare('UPDATE folders SET image_count = ? WHERE path = ?');
    return updateStmt.run(result.count, folderPath);
  }

  /**
   * 批量更新所有文件夹的文件数量
   */
  updateAllFolderCounts() {
    const folders = this.getAllFolders();
    for (const folder of folders) {
      this.updateFolderImageCount(folder.path);
    }
  }

  getFolderTree() {
    const folders = this.getAllFolders();
    const tree = [];
    const map = {};

    // Build folder map
    folders.forEach(folder => {
      map[folder.path] = { ...folder, children: [] };
    });

    // Build tree structure
    folders.forEach(folder => {
      if (folder.parent_path && map[folder.parent_path]) {
        map[folder.parent_path].children.push(map[folder.path]);
      } else {
        tree.push(map[folder.path]);
      }
    });

    return tree;
  }

  close() {
    // 清理 WAL checkpoint 定时器
    if (this.walCheckpointInterval) {
      clearInterval(this.walCheckpointInterval);
      this.walCheckpointInterval = null;
    }
    
    // 执行最后一次 checkpoint
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.warn('[DB] Final WAL checkpoint warning:', e.message);
    }
    
    this.db.close();
  }
}

module.exports = LibraryDatabase;
