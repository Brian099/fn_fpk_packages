/**
 * 请求参数验证中间件
 */

const { ValidationError } = require('./errorHandler');

/**
 * 验证必需参数
 */
function validateRequired(fields) {
  return (req, res, next) => {
    const source = req.method === 'GET' ? req.query : req.body;
    
    for (const field of fields) {
      if (!source[field]) {
        return next(new ValidationError(`${field} is required`, field));
      }
    }
    
    next();
  };
}

/**
 * 验证素材库 ID
 */
function validateLibraryId(req, res, next) {
  const libraryId = req.params.id || req.query.libraryId || req.body.libraryId;
  
  if (!libraryId) {
    return next(new ValidationError('Library ID is required', 'libraryId'));
  }
  
  req.libraryId = libraryId;
  next();
}

/**
 * 验证分页参数
 */
function validatePagination(req, res, next) {
  const { offset, limit } = req.query;
  
  if (offset !== undefined) {
    const offsetNum = parseInt(offset, 10);
    if (isNaN(offsetNum) || offsetNum < 0) {
      return next(new ValidationError('Invalid offset', 'offset'));
    }
    req.pagination = { offset: offsetNum };
  }
  
  if (limit !== undefined) {
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 500) {
      return next(new ValidationError('Invalid limit (1-500)', 'limit'));
    }
    req.pagination = { ...req.pagination, limit: limitNum };
  }
  
  next();
}

module.exports = {
  validateRequired,
  validateLibraryId,
  validatePagination
};
