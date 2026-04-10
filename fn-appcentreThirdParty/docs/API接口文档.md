# 应用中心第三方服务器 API 接口文档

## 项目概述

这是一个基于 **Gin框架** 的飞牛NAS应用中心第三方服务器，主要负责处理应用的安装、卸载、查询等操作。

**技术栈**:
- **语言**: Go 1.21
- **Web框架**: Gin-gonic v1.9.1
- **数据存储**: JSON文件存储
- **应用管理**: 依赖 `appcenter-cli` 命令行工具

## 核心概念

### 应用源（Source）

应用源分为两种类型：

| 类型 | `local` 值 | 数据来源 | URL 含义 |
|------|-----------|----------|----------|
| 本地源 | `true` | 扫描本地 FPK 文件目录 | 本地目录路径 |
| 远程源 | `false` | HTTP 获取 fnpack.json | 远程服务器地址 |

### 本地源扫描机制

本地源支持**递归扫描子目录**，扫描规则如下：

1. 根据 `url` 字段指定的目录路径进行扫描
2. 遍历目录下所有 `.fpk` 文件（包含子目录）
3. 解析每个 FPK 文件中的 `manifest` 获取应用信息
4. 支持指纹缓存机制，FPK 文件未变化时不重复解析

### 指纹缓存机制

本地源使用指纹缓存来优化性能：

| 场景 | 处理方式 |
|------|----------|
| FPK 新增 | 解析并添加到缓存 |
| FPK 更新（指纹变化） | 重新解析并更新缓存 |
| FPK 删除 | 从缓存中移除 |
| FPK 未变化（指纹相同） | 直接使用缓存，不重复解析 |

缓存文件存储在 `{PkgVar}/cache/{sourceID}.json`

---

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

---

## 应用管理接口

### 1. 获取所有应用列表

**接口**: `GET /api/apps`

**描述**: 获取所有已启用的应用源中的应用列表。自动发现本地源，支持分类过滤和关键字搜索。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 否 | 应用分类过滤（latest、installed 或分类名称） |
| keyword | string | 否 | 关键字搜索（匹配名称、描述、ID） |

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
                "author": "作者",
                "publisher": "发布者",
                "size": "10.5",
                "icon": "data:image/png;base64,...",
                "download_url": "app1.fpk",
                "changelog": "",
                "source_id": "local_AppStore"
            }
        ],
        "total": 1,
        "sources": 2
    }
}
```

**数据来源说明**:
- 本地源 (`local: true`): 从 FPK 文件的 manifest 中解析获取
- 远程源 (`local: false`): 从 `{URL}/fnpack.json` 获取

---

### 2. 获取应用详情

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
        "icon": "data:image/png;base64,...",
        "screenshots": [],
        "download_url": "app1.fpk",
        "changelog": "更新日志",
        "source_id": "local_AppStore"
    }
}
```

---

### 3. 获取应用图标

**接口**: `GET /api/apps/:id/icon`

**参数**:
- `id` (路径参数): 应用ID

**响应**: PNG格式的图标文件

---

### 4. 安装应用

**接口**: `POST /api/apps/:id/install`

**参数**:
- `id` (路径参数): 应用ID

**请求体**:
```json
{
    "env_file_path": "/path/to/env/file"
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

---

### 5. 启动应用

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

---

### 6. 停止应用

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

---

### 7. 卸载应用

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

---

### 8. 获取应用状态

**接口**: `GET /api/apps/:id/status`

**参数**:
- `id` (路径参数): 应用ID

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "status": "running",
        "details": "状态详情"
    }
}
```

---

### 9. 获取已安装应用

**接口**: `GET /api/apps/installed`

**描述**: 获取系统当前已安装的应用列表

**响应**: 同获取所有应用列表格式

---

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
                "id": "local_AppStore",
                "name": "本地 FPK 文件",
                "url": "/vol1/1000/AppStore",
                "enabled": true,
                "auto_update": false,
                "last_sync": "2026-04-07T20:25:24+08:00",
                "app_count": 6,
                "local": true
            },
            {
                "id": "source_1",
                "name": "远程源",
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

---

### 2. 添加应用源

**接口**: `POST /api/sources`

**请求体**:
```json
{
    "name": "源名称",
    "url": "http://fpk.example.com:18088",
    "local": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 应用源名称 |
| url | string | 是 | 源地址（本地目录路径或远程服务器地址） |
| local | boolean | 否 | 是否为本地源，默认 false |

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

---

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

---

### 4. 切换应用源启用状态

**接口**: `POST /api/sources/:id/toggle`

**参数**:
- `id` (路径参数): 应用源ID

**请求体**:
```json
{
    "enabled": true
}
```

**响应示例**:
```json
{
    "code": 0,
    "message": "Source enabled successfully"
}
```

---

### 5. 同步应用源

**接口**: `POST /api/sources/:id/sync`

**参数**:
- `id` (路径参数): 应用源ID

**描述**: 同步指定应用源的数据

- 本地源 (`local: true`): 增量更新（指纹机制）
- 远程源 (`local: false`): 重新获取 fnpack.json

**响应示例**:
```json
{
    "code": 0,
    "message": "Source synchronized successfully",
    "data": {
        "added": 1,
        "updated": 2,
        "removed": 0
    }
}
```

---

### 6. 重置源缓存

**接口**: `POST /api/sources/:id/reset-cache`

**参数**:
- `id` (路径参数): 应用源ID

**描述**: 重置指定源的缓存数据

- 本地源 (`local: true`): 删除缓存文件，重新扫描所有 FPK 文件
- 远程源 (`local: false`): 删除缓存文件，下次访问时重新获取

**响应示例**:
```json
{
    "code": 0,
    "message": "Cache reset successfully",
    "data": {
        "total": 6
    }
}
```

---

## 设置管理接口

### 1. 获取应用设置

**接口**: `GET /api/settings`

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "appStoreDir": "/vol1/1000/AppStore"
    },
    "message": "获取设置成功"
}
```

---

### 2. 保存应用设置

**接口**: `POST /api/settings`

**请求体**:
```json
{
    "appStoreDir": "/vol1/1000/AppStore"
}
```

**响应示例**:
```json
{
    "code": 0,
    "message": "保存设置成功"
}
```

---

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

---

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

---

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

---

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

---

## 静态文件服务

### 1. 用户应用下载

**路径**: `/user-download/*`

**描述**: 提供用户配置的应用商店目录下的文件下载服务

---

## 错误码说明

| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源未找到 |
| 500 | 服务器内部错误 |

---

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
    Icon        string   `json:"icon"`         // 图标(Base64或URL)
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
    Name       string `json:"name"`        // 源名称
    URL        string `json:"url"`         // 源地址（本地目录或远程服务器）
    Enabled    bool   `json:"enabled"`     // 是否启用
    AutoUpdate bool   `json:"auto_update"` // 自动更新
    LastSync   string `json:"last_sync"`   // 最后同步时间
    AppCount   int    `json:"app_count"`   // 应用数量
    Local      bool   `json:"local"`       // 是否为本地源
}
```

### FPK缓存数据模型 (FPKCacheData)
```go
type FPKCacheData struct {
    Fingerprints map[string]FPKFingerprint `json:"fingerprints"` // FPK文件指纹
    Apps         []App                     `json:"apps"`         // 应用列表
}

type FPKFingerprint struct {
    ModTime int64 `json:"mod_time"` // 文件修改时间
    Size    int64 `json:"size"`     // 文件大小
}
```

---

## 部署配置

### 环境变量
- `TRIM_APPDEST`: 应用目标目录
- `TRIM_PKGVAR`: 变量目录
- `TRIM_APPCENTER_CLI_PATH`: appcenter-cli路径

### 默认路径
- **应用目标目录**: `/var/apps/fn-appcentreThirdParty/target`
- **变量目录**: `/var/apps/fn-appcentreThirdParty/var`
- **缓存目录**: `{PkgVar}/cache`
- **Unix Socket**: `/var/apps/fn-appcentreThirdParty/var/appcentre.sock`

---

## 注意事项

1. 所有API接口都需要通过Unix Socket或HTTP访问
2. 应用安装需要依赖 `appcenter-cli` 工具
3. 文件路径需要确保有正确的读写权限
4. 应用源同步可能需要网络连接
5. 本地源支持递归扫描子目录中的 FPK 文件
6. 建议使用指纹缓存机制避免重复解析 FPK 文件

---

*文档版本: 2.0*
*更新日期: 2026-04-10*
