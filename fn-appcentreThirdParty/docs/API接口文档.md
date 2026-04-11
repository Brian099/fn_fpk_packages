# 应用中心第三方服务器 API 接口文档

## 项目概述

这是一个基于 **Gin框架** 的飞牛NAS应用中心第三方服务器，主要负责处理应用的安装、卸载、查询等操作。

**技术栈**:
- **语言**: Go 1.21
- **Web框架**: Gin-gonic v1.9.1
- **数据存储**: JSON文件存储
- **应用管理**: 依赖 `appcenter-cli` 命令行工具

---

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
- **服务地址**: `http://localhost:5668` (默认)
- **API前缀**: `/api`
- **响应格式**: JSON

### 响应格式规范
```json
{
    "code": 0,
    "message": "成功",
    "data": {}
}
```

### 错误码说明
| 错误码 | 说明 |
|--------|------|
| 0 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源未找到 |
| 500 | 服务器内部错误 |

---

## 应用管理接口

### 1. 获取所有应用列表

**接口**: `GET /api/apps`

**描述**: 获取所有已启用的应用源中的应用列表。自动发现本地源，支持分类过滤和关键字搜索。

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| category | string | Query | 否 | 分类过滤（latest、installed 或分类名称） |
| keyword | string | Query | 否 | 关键字搜索（匹配名称、描述、ID） |
| source | string | Query | 否 | 指定源ID过滤 |

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "apps": [
            {
                "id": "MariaDB10",
                "name": "MariaDB10",
                "description": "已安装的应用",
                "version": "installed",
                "platform": "x86",
                "categories": ["已安装"],
                "labels": ["已安装"],
                "author": "",
                "publisher": "",
                "size": "491.50",
                "icon": "",
                "screenshots": null,
                "download_url": "http://nas.laokhome.cn:5668/download/MariaDB10.fpk",
                "changelog": "",
                "source_id": "local_AppStore",
                "is_installed": true
            }
        ],
        "total": 1,
        "sources": 1
    }
}
```

---

### 2. 获取应用详情

**接口**: `GET /api/apps/:id`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "id": "MariaDB10",
        "name": "MariaDB10",
        "description": "已安装的应用",
        "version": "installed",
        "platform": "x86",
        "categories": ["已安装"],
        "labels": ["已安装"],
        "author": "",
        "publisher": "",
        "size": "491.50",
        "icon": "",
        "screenshots": null,
        "download_url": "http://nas.laokhome.cn:5668/download/MariaDB10.fpk",
        "changelog": "",
        "source_id": "local_AppStore",
        "is_installed": true
    }
}
```

---

### 3. 获取应用图标

**接口**: `GET /api/apps/:id/icon`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**响应**: PNG 格式的图标文件

---

### 4. 安装应用

**接口**: `POST /api/apps/:id/install`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**请求体**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| download_url | string | 否 | 下载URL（远程安装时使用） |
| source_id | string | 否 | 源ID |
| env_file_path | string | 否 | 环境变量配置文件路径 |

**响应示例**:
```json
{
    "code": 0,
    "message": "Application installed successfully",
    "output": "..."
}
```

---

### 5. 启动应用

**接口**: `POST /api/apps/:id/start`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**响应示例**:
```json
{
    "code": 0,
    "message": "Application started successfully",
    "output": "..."
}
```

---

### 6. 停止应用

**接口**: `POST /api/apps/:id/stop`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**响应示例**:
```json
{
    "code": 0,
    "message": "Application stopped successfully",
    "output": "..."
}
```

---

### 7. 卸载应用

**接口**: `DELETE /api/apps/:id`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**响应示例**:
```json
{
    "code": 0,
    "message": "Application uninstalled successfully"
}
```

---

### 8. 检查应用是否已安装

**接口**: `GET /api/apps/:id/check`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**描述**: 使用 `appcenter-cli check` 命令检查应用是否已安装

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "installed": true
    }
}
```

---

### 9. 获取应用状态

**接口**: `GET /api/apps/:id/status`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用ID |

**描述**: 获取应用详细运行状态（安装状态、运行状态）

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "status": "running",
        "running": true
    }
}
```

---

### 10. 获取已安装应用列表

**接口**: `GET /api/apps/installed`

**描述**: 使用 `appcenter-cli list` 获取系统当前已安装的应用列表

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "apps": [
            {
                "id": "MariaDB10",
                "name": "MariaDB10",
                "version": "10.11",
                "status": "running"
            }
        ]
    }
}
```

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
                "last_sync": "2026-04-10T14:25:08+08:00",
                "app_count": 7,
                "local": true
            }
        ]
    }
}
```

---

### 2. 添加应用源

**接口**: `POST /api/sources`

**请求体**:

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
        "id": "source_1744275847123456789",
        "name": "新数据源",
        "url": "https://example.com/fnpacks",
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

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用源ID |

**描述**: 删除应用源时同步删除对应的缓存文件

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

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用源ID |

**请求体**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| enabled | boolean | 是 | 是否启用 |

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

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用源ID |

**描述**:
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

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用源ID |

**描述**: 重置指定源的缓存数据，重置前会自动备份原缓存为 `.bak` 文件

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

### 7. 更新应用标签

**接口**: `PUT /api/sources/:id/apps/:appId/labels`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 应用源ID |
| appId | string | Path | 是 | 应用ID |

**请求体**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| labels | string[] | 是 | 标签数组 |

**描述**: 更新本地源缓存中的应用标签，直接写入 `local_xxx.json` 文件

**响应示例**:
```json
{
    "code": 0,
    "message": "Labels updated successfully"
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
        "app_store_dir": "/vol1/1000/AppStore",
        "enable_app_share": true,
        "share_port": 5668
    },
    "message": "获取设置成功"
}
```

---

### 2. 保存应用设置

**接口**: `POST /api/settings`

**请求体**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| app_store_dir | string | 是 | 应用商店目录路径 |
| enable_app_share | boolean | 否 | 是否启用应用分享 |
| share_port | integer | 否 | 分享端口号 |

**响应示例**:
```json
{
    "code": 0,
    "message": "保存设置成功"
}
```

---

### 3. 检查端口可用性

**接口**: `GET /api/settings/check-port`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| port | integer | Query | 是 | 端口号 |

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "available": true,
        "port": 5668
    }
}
```

---

## 卷管理接口

### 1. 获取默认卷

**接口**: `GET /api/volume/default`

**描述**: 使用 `appcenter-cli default-volume` 获取默认存储卷

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

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| id | string | Path | 是 | 卷ID |

**描述**: 使用 `appcenter-cli default-volume <id>` 设置默认存储卷

**响应示例**:
```json
{
    "code": 0,
    "message": "Default volume set successfully"
}
```

---

## 手动安装管理接口

### 1. 获取手动安装状态

**接口**: `GET /api/manual-install`

**描述**: 使用 `appcenter-cli manual-install` 获取手动安装功能状态

**响应示例**:
```json
{
    "code": 0,
    "data": {
        "manual_install": "disabled"
    }
}
```

---

### 2. 设置手动安装状态

**接口**: `POST /api/manual-install/:action`

**参数**:

| 参数 | 类型 | 位置 | 必填 | 说明 |
|------|------|------|------|------|
| action | string | Path | 是 | 操作类型（enable/disable） |

**描述**: 使用 `appcenter-cli manual-install enable/disable` 设置手动安装功能

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

**接口**: `GET /user-download/*filepath`

**描述**: 提供用户配置的应用商店目录下的文件下载服务

---

### 2. 内置应用下载

**接口**: `GET /built-in-download/*filepath`

**描述**: 提供内置 AppStore 目录下的文件下载服务

---

## 数据模型

### App 应用模型
```go
type App struct {
    ID          string   `json:"id"`           // 应用ID
    Name        string   `json:"name"`         // 应用名称
    Description string   `json:"description"`  // 应用描述
    Version     string   `json:"version"`      // 版本号
    Platform    string   `json:"platform"`     // 平台架构
    Categories  []string `json:"categories"`   // 分类标签（兼容性别名）
    Labels      []string `json:"labels"`       // 分类标签
    Author      string   `json:"author"`       // 作者
    Publisher   string   `json:"publisher"`    // 发布者
    Size        string   `json:"size"`         // 应用大小(MB)
    Icon        string   `json:"icon"`         // 图标(Base64或URL)
    Screenshots []string `json:"screenshots"`  // 截图路径列表
    DownloadURL string   `json:"download_url"` // 下载URL
    Changelog   string   `json:"changelog"`    // 更新日志
    SourceID    string   `json:"source_id"`    // 源ID
    IsInstalled bool     `json:"is_installed"` // 是否已安装
}
```

### Source 应用源模型
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

### FPKCacheData FPK缓存数据模型
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
| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| TRIM_APPDEST | 应用目标目录 | /var/apps/fn-appcentreThirdParty/target |
| TRIM_PKGVAR | 变量目录 | /var/apps/fn-appcentreThirdParty/var |
| TRIM_APPCENTER_CLI_PATH | appcenter-cli路径 | 自动检测 |

### 默认路径
| 路径 | 说明 |
|------|------|
| /var/apps/fn-appcentreThirdParty/target | 应用目标目录 |
| /var/apps/fn-appcentreThirdParty/var | 变量目录 |
| {PkgVar}/cache | 缓存目录 |
| /var/apps/fn-appcentreThirdParty/var/appcentre.sock | Unix Socket |

---

## appcenter-cli 命令映射

| CLI 命令 | API 接口 | 说明 |
|---------|---------|------|
| appcenter-cli list | GET /api/apps/installed | 获取已安装应用列表 |
| appcenter-cli check \<id\> | GET /api/apps/:id/check | 检查应用是否已安装 |
| appcenter-cli status \<id\> | GET /api/apps/:id/status | 获取应用详细状态 |
| appcenter-cli start \<id\> | POST /api/apps/:id/start | 启动应用 |
| appcenter-cli stop \<id\> | POST /api/apps/:id/stop | 停止应用 |
| appcenter-cli install-fpk \<file\> | POST /api/apps/:id/install | 安装应用 |
| appcenter-cli uninstall \<id\> | DELETE /api/apps/:id | 卸载应用 |
| appcenter-cli default-volume | GET /api/volume/default | 获取默认卷 |
| appcenter-cli default-volume \<id\> | POST /api/volume/default/:id | 设置默认卷 |
| appcenter-cli manual-install | GET /api/manual-install | 获取手动安装状态 |
| appcenter-cli manual-install \<action\> | POST /api/manual-install/:action | 设置手动安装状态 |

---

## 注意事项

1. 所有API接口都需要通过Unix Socket或HTTP访问
2. 应用安装需要依赖 `appcenter-cli` 工具
3. 文件路径需要确保有正确的读写权限
4. 应用源同步可能需要网络连接
5. 本地源支持递归扫描子目录中的 FPK 文件
6. 建议使用指纹缓存机制避免重复解析 FPK 文件
7. 重置缓存前会自动备份原缓存为 `.bak` 文件
8. 删除源时会同步删除对应的缓存文件

---

*文档版本: 2.1*
*更新日期: 2026-04-10*
