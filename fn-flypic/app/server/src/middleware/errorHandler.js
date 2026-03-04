/**
 * 统一错误处理中间件
 */

/**
 * 应用错误类
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 验证错误
 */
class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

/**
 * 资源未找到错误
 */
class NotFoundError extends AppError {
  constructor(resource, id = null) {
    super(
      `${resource} not found${id ? `: ${id}` : ''}`,
      404,
      'NOT_FOUND'
    );
    this.resource = resource;
    this.id = id;
  }
}

/**
 * 冲突错误
 */
class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * 错误处理中间件
 */
const errorHandler = (err, req, res, next) => {
  // 操作性错误（预期的错误）
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.field && { field: err.field }),
        ...(err.remainingAttempts !== undefined && { remainingAttempts: err.remainingAttempts }),
        ...(err.currentAttempts !== undefined && { currentAttempts: err.currentAttempts })
      }
    });
  }

  // 编程错误（未预期的错误）
  console.error('💥 Unexpected Error:', err);
  
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development' 
        ? err.message 
        : 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
};

/**
 * 异步路由处理器包装
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  errorHandler,
  asyncHandler
};
