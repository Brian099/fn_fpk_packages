/**
 * 基础数据模型
 * 提供通用的数据库操作方法
 */

class BaseModel {
  constructor(db) {
    this.db = db;
  }

  /**
   * 执行查询并返回单条记录
   */
  findOne(query, params = []) {
    const stmt = this.db.prepare(query);
    return stmt.get(...params);
  }

  /**
   * 执行查询并返回多条记录
   */
  findMany(query, params = []) {
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * 执行插入/更新/删除操作
   */
  execute(query, params = []) {
    const stmt = this.db.prepare(query);
    return stmt.run(...params);
  }

  /**
   * 执行事务
   */
  transaction(fn) {
    const transaction = this.db.transaction(fn);
    return transaction();
  }
}

module.exports = BaseModel;
