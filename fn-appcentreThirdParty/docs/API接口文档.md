# 应用中心第三方服务器 API 接口文档

## 项目概述

这是一个基于 **Gin框架** 的飞牛NAS应用中心第三方服务器，主要负责处理应用的安装、卸载、查询等操作。

**技术栈**:
- **语言**: Go 1.21
- **Web框架**: Gin-gonic v1.9.1
- **数据存储**: JSON文件存储
- **应用管理**: 依赖 `appcenter-cli` 命令行工具

## API 接口总览

### 基础信息
- **服务地址**: `http://localhost:18088` (默认)
- **API前缀**: `/api`
- **响应格式**: JSON

### 响应格式规范
```json
{
    "code": 0,           // 状态码，0表示成功
    "message": "成功",   // 状态消息
    "data": {}           // 响应数据
}
```

## 应用管理接口

### 1. 获取所有应用列表

**接口**: `GET /api/apps`

**参数**:
- `category` (可选): 应用分类过滤
- `keyword` (可选): 关键字搜索

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "apps": [
            {
                "id": "app1",
                "name": "应用名称",
                "description": "应用描述",
                "version": "1.0.0",
                "platform": "x86",
                "categories": ["工具", "系统"],
                "size": "10.5",
                "download_url": "app1.fpk"
            }
        ],
        "total": 1,
        "sources": 2
    }
}
```

### 2. 获取内置应用

**接口**: `GET /api/apps/built-in`

**描述**: 获取系统内置的应用列表

**响应**: 同获取所有应用列表格式

### 3. 获取用户应用

**接口**: `GET /api/apps/user`

**描述**: 获取用户自定义的应用列表

**响应**: 同获取所有应用列表格式

### 4. 获取应用详情

**接口**: `GET /api/apps/:id`

**参数**:
- `id` (路径参数): 应用ID

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "id": "app1",
        "name": "应用名称",
        "description": "应用描述",
        "version": "1.0.0",
        "platform": "x86",
        "categories": ["工具", "系统"],
        "author": "作者",
        "publisher": "发布者",
        "size": "10.5",
        "icon": "app1.png",
        "screenshots": ["screenshot1.png"],
        "download_url": "app1.fpk",
        "changelog": "更新日志",
        "source_id": "source_1"
    }
}
```

### 5. 获取应用图标

**接口**: `GET /api/apps/:id/icon`

**参数**:
- `id` (路径参数): 应用ID

**响应**: PNG格式的图标文件

### 6. 安装应用

**接口**: `POST /api/apps/:id/install`

**参数**:
- `id` (路径参数): 应用ID

**请求体**:
```json
{
    "env_file_path": "/path/to/env/file"  // 可选，环境变量文件路径
}
```

**响应示例**:
```json
{
    "code": 0,
    "message": "Application installed successfully",
    "output": "安装日志输出"
}
```

### 7. 启动应用

**接口**: `POST /api/apps/:id/start`

**参数**:
- `id` (路径参数): 应用ID

**响应示例**:
```json
{
    "code": 0,
    "message": "Application started successfully",
    "output": "启动日志输出"
}
```

### 8. 停止应用

**接口**: `POST /api/apps/:id/stop`

**参数**:
- `id` (路径参数): 应用ID

**响应示例**:
```json
{
    "code": 0,
    "message": "Application stopped successfully",
    "output": "停止日志输出"
}
```

### 9. 卸载应用

**接口**: `DELETE /api/apps/:id`

**参数**:
- `id` (路径参数): 应用ID

**响应示例**:
```json
{
    "code": 0,
    "message": "Application uninstalled successfully"
}
```

### 10. 获取应用状态

**接口**: `GET /api/apps/:id/status`

**参数**:
- `id` (路径参数): 应用ID

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "status": "running",  // running, stopped, installing, etc.
        "details": "状态详情"
    }
}
```

### 11. 获取已安装应用

**接口**: `GET /api/apps/installed`

**描述**: 获取系统当前已安装的应用列表

**响应**: 同获取所有应用列表格式

## 应用源管理接口

### 1. 获取所有应用源

**接口**: `GET /api/sources`

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "sources": [
            {
                "id": "source_1",
                "name": "源名称",
                "url": "http://fpk.example.com:18088",
                "enabled": true,
                "auto_update": true,
                "last_sync": "2026-04-07T20:25:24+08:00",
                "app_count": 10,
                "local": false
            }
        ]
    }
}
```

### 2. 添加应用源

**接口**: `POST /api/sources`

**请求体**:
```json
{
    "name": "源名称",
    "url": "http://fpk.example.com:18088"
}
```

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "id": "source_2",
        "name": "源名称",
        "url": "http://fpk.example.com:18088",
        "enabled": true,
        "auto_update": true,
        "last_sync": "",
        "app_count": 0,
        "local": false
    }
}
```

### 3. 删除应用源

**接口**: `DELETE /api/sources/:id`

**参数**:
- `id` (路径参数): 应用源ID

**响应示例**:
```json
{
    "code": 0,
    "message": "Source deleted successfully"
}
```

### 4. 同步应用源

**接口**: `POST /api/sources/:id/sync`

**参数**:
- `id` (路径参数): 应用源ID

**响应示例**:
```json
{
    "code": 0,
    "message": "Source synchronized successfully"
}
```

### 5. 重置源缓存

**接口**: `POST /api/sources/:id/reset-cache`

**参数**:
- `id` (路径参数): 应用源ID

**响应示例**:
```json
{
    "code": 0,
    "message": "Source cache reset successfully"
}
```

## 设置管理接口

### 1. 获取应用设置

**接口**: `GET /api/settings`

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "appStoreDir": "/path/to/appstore"
    },
    "message": "获取设置成功"
}
```

### 2. 保存应用设置

**接口**: `POST /api/settings`

**请求体**:
```json
{
    "appStoreDir": "/path/to/appstore"
}
```

**响应示例**:
```json
{
    "code": 0,
    "message": "保存设置成功"
}
```

## 其他功能接口

### 1. 获取默认卷设置

**接口**: `GET /api/volume/default`

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "volume_id": "vol1"
    }
}
```

### 2. 设置默认卷

**接口**: `POST /api/volume/default/:id`

**参数**:
- `id` (路径参数): 卷ID

**响应示例**:
```json
{
    "code": 0,
    "message": "Default volume set successfully"
}
```

### 3. 获取手动安装状态

**接口**: `GET /api/manual-install`

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "enabled": false
    }
}
```

### 4. 设置手动安装

**接口**: `POST /api/manual-install/:action`

**参数**:
- `action` (路径参数): `enable` 或 `disable`

**响应示例**:
```json
{
    "code": 0,
    "message": "Manual install enabled successfully"
}
```

## 静态文件服务

### 1. 内置应用商店文件

**路径**: `/built-in-download/*`

**描述**: 提供内置应用商店的文件下载服务

### 2. 用户应用商店文件

**路径**: `/user-download/*`

**描述**: 提供用户配置的应用商店文件下载服务

## 错误码说明

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源未找到 |
| 500 | 服务器内部错误 |

## 数据模型

### 应用模型 (App)
```go
type App struct {
    ID          string   `json:"id"`           // 应用ID
    Name        string   `json:"name"`         // 应用名称
    Description string   `json:"description"`  // 应用描述
    Version     string   `json:"version"`      // 版本号
    Platform    string   `json:"platform"`     // 平台架构
    Categories  []string `json:"categories"`   // 分类标签
    Author      string   `json:"author"`       // 作者
    Publisher   string   `json:"publisher"`    // 发布者
    Size        string   `json:"size"`         // 应用大小(MB)
    Icon        string   `json:"icon"`         // 图标路径
    Screenshots []string `json:"screenshots"`  // 截图路径列表
    DownloadURL string   `json:"download_url"` // 下载URL
    Changelog   string   `json:"changelog"`    // 更新日志
    SourceID    string   `json:"source_id"`    // 源ID
}
```

### 应用源模型 (Source)
```go
type Source struct {
    ID         string `json:"id"`          // 源ID
    Name       string `json:"name"`       // 源名称
    URL        string `json:"url"`        // 源URL
    Enabled    bool   `json:"enabled"`    // 是否启用
    AutoUpdate bool   `json:"auto_update"`// 自动更新
    LastSync   string `json:"last_sync"`  // 最后同步时间
    AppCount   int    `json:"app_count"`   // 应用数量
    Local      bool   `json:"local"`      // 是否为本地源
}
```

## 部署配置

### 环境变量
- `TRIM_APPDEST`: 应用目标目录
- `TRIM_PKGVAR`: 变量目录
- `TRIM_APPCENTER_CLI_PATH`: appcenter-cli路径

### 默认路径
- **应用目标目录**: `/var/apps/fn-appcentreThirdParty/target`
- **变量目录**: `/var/apps/fn-appcentreThirdParty/var`
- **Unix Socket**: `/var/apps/fn-appcentreThirdParty/var/appcentre.sock`

## 注意事项

1. 所有API接口都需要通过Unix Socket或HTTP访问
2. 应用安装需要依赖 `appcenter-cli` 工具
3. 文件路径需要确保有正确的读写权限
4. 应用源同步可能需要网络连接

---

*文档版本: 1.0*  
*更新日期: 2026-04-09*