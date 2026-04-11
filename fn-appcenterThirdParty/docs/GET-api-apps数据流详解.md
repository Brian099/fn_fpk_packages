# GET /api/apps 接口数据流详解

## 目录
- [接口概述](#接口概述)
- [数据流流程图](#数据流流程图)
- [完整请求响应示例](#完整请求响应示例)
- [响应数据结构](#响应数据结构)
- [字段来源说明](#字段来源说明)
- [本地源 vs 远程源](#本地源-vs-远程源)
- [缓存机制](#缓存机制)

---

## 接口概述

| 项目 | 说明 |
|------|------|
| **接口** | `GET /api/apps` |
| **功能** | 获取所有已启用的应用源中的应用列表 |
| **支持参数** | `category`（分类过滤）、`keyword`（关键字搜索） |

---

## 数据流流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端请求                                        │
│                         GET /api/apps                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GetApps Handler                                    │
│                    apps/handlers/apps.go:GetApps                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐
│  LoadSources()   │  │ DiscoverLocal     │  │ 检查是否需要添加默认本地源     │
│  加载 sources.json│  │ Sources()         │  │ (无本地源时)                  │
│                  │  │ 自动发现本地源     │  │                               │
└──────────────────┘  └──────────────────┘  └──────────────────────────────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         遍历所有启用的源                                     │
│                                                                             │
│    for each source in sources where source.Enabled:                        │
│        apps = LoadAppsFromSource(source)                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
              ▼                                           ▼
┌──────────────────────────┐              ┌──────────────────────────────┐
│     source.Local == true │              │     source.Local == false    │
│     本地源               │              │     远程源                   │
└──────────────────────────┘              └──────────────────────────────┘
              │                                           │
              ▼                                           ▼
┌──────────────────────────┐              ┌──────────────────────────────┐
│   ScanFPKDir(             │              │   parseAndCacheSource()     │
│     source.URL,          │              │   1. 检查缓存是否存在        │
│     source.ID,            │              │   2. 缓存不存在 → 请求远程   │
│     forceRescan=false    │              │   3. 解析 fnpack.json        │
│   )                      │              │   4. 返回应用列表            │
│                          │              │                              │
│   递归扫描 FPK 文件       │              │   缓存存在 → 直接读缓存      │
└──────────────────────────┘              └──────────────────────────────┘
              │                                           │
              │   ┌─────────────────────────────────────┐ │
              │   │  collectFPKFiles(baseDir)          │ │
              │   │  递归收集目录下所有 .fpk 文件       │ │
              │   └─────────────────────────────────────┘ │
              │                   │                       │
              │   ┌─────────────────────────────────────┐ │
              │   │  指纹缓存机制                        │ │
              │   │  1. 读取缓存文件                     │ │
              │   │  2. 对比 FPK 文件指纹                │ │
              │   │  3. 指纹变化 → 重新解析              │ │
              │   │  4. 指纹未变 → 使用缓存              │ │
              │   └─────────────────────────────────────┘ │
              │                   │                       │
              │   ┌─────────────────────────────────────┐ │
              │   │  parseFPKFile(fpkPath)             │ │
              │   │  解析单个 FPK 文件                  │ │
              │   └─────────────────────────────────────┘ │
              │                   │                       │
              └───────────────────┴───────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           合并所有源的应用                                   │
│                        allApps = [apps1, apps2, ...]                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           分类过滤（可选）                                   │
│                                                                             │
│    if category == "installed":   →  筛选 Version == "installed"             │
│    if category == "latest":      →  返回所有                                │
│    if category == "其他":         →  筛选 Categories 包含该值               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           关键字搜索（可选）                                  │
│                                                                             │
│    if keyword != "":                                                       │
│        匹配 Name / Description / ID (不区分大小写)                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           返回 JSON 响应                                     │
│                                                                             │
│    {                                                                       │
│      "code": 0,                                                            │
│      "data": {                                                             │
│        "apps": [...],          ← 所有应用列表                                │
│        "total": 10,           ← 应用总数                                     │
│        "sources": 2            ← 启用的源数量                                │
│      }                                                                     │
│    }                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 完整请求响应示例

### 请求

```http
GET /api/apps
Host: localhost:5668
```

### 响应

```json
{
    "code": 0,
    "data": {
        "apps": [
            {
                "id": "fn-appcenterThirdParty",
                "name": "应用中心第三方",
                "description": "<p>应用精选，用于管理和安装第三方飞牛应用。</p>...",
                "version": "1.0.0",
                "platform": "x86",
                "categories": ["工具", "系统"],
                "author": "第三方开发者",
                "publisher": "社区",
                "size": "2.35",
                "icon": "data:image/png;base64,iVBORw0KGgoAAAANS...",
                "download_url": "fn-appcenterThirdParty.fpk",
                "changelog": "",
                "source_id": "local_AppStore"
            }
        ],
        "total": 1,
        "sources": 1
    }
}
```

---

## 响应数据结构

```go
// 响应结构
{
    "code": int,           // 状态码，0 表示成功
    "message": string,     // 状态消息（成功时通常省略）
    "data": {
        "apps": [           // 应用列表
            App,            // 见下方 App 结构
            ...
        ],
        "total": int,       // 应用总数
        "sources": int      // 启用的应用源数量
    }
}

// App 结构
type App struct {
    ID          string   `json:"id"`           // 应用ID（来自 FPK 文件名）
    Name        string   `json:"name"`         // 应用名称（来自 manifest.display_name）
    Description string   `json:"description"`  // 应用描述（来自 manifest.desc）
    Version     string   `json:"version"`      // 版本号（来自 manifest.version）
    Platform    string   `json:"platform"`     // 平台架构（来自 manifest.platform）
    Categories  []string `json:"categories"`   // 分类标签（来自 manifest.labels）
    Author      string   `json:"author"`       // 作者（来自 manifest.maintainer）
    Publisher   string   `json:"publisher"`    // 发布者（来自 manifest.distributor）
    Size        string   `json:"size"`         // 应用大小(MB)
    Icon        string   `json:"icon"`         // 图标（Base64 或 URL）
    Screenshots []string `json:"screenshots"`  // 截图路径列表
    DownloadURL string   `json:"download_url"` // 下载URL（FPK 文件名）
    Changelog   string   `json:"changelog"`    // 更新日志
    SourceID    string   `json:"source_id"`    // 源ID
}
```

---

## 字段来源说明

### 本地源 (`local: true`) 应用字段来源

| App 字段 | 来源 | 说明 |
|----------|------|------|
| `id` | FPK 文件名 | `strings.TrimSuffix(filepath.Base(fpkPath), ".fpk")` |
| `name` | manifest.display_name / manifest.appname | 优先使用 display_name |
| `description` | manifest.desc / manifest.description | 优先使用 desc |
| `version` | manifest.version | 版本号 |
| `platform` | manifest.platform | 平台架构，默认 "x86" |
| `categories` | manifest.labels / manifest.categories | 逗号分隔，支持多分类 |
| `author` | manifest.maintainer / manifest.author | 优先使用 maintainer |
| `publisher` | manifest.distributor / manifest.publisher | 优先使用 distributor |
| `size` | FPK 文件大小 | 自动计算：文件字节数 / 1024 / 1024 |
| `icon` | FPK 内 icon-256.png / icon-64.png | Base64 编码，格式：`data:image/png;base64,...` |
| `download_url` | FPK 文件名 | 原始文件名 |
| `source_id` | sources.json 中的源 ID | 如 `local_AppStore` |

### manifest 文件格式示例

```
# FPK 应用包的 manifest 文件格式（INI 风格）

appname=fn-appcenterThirdParty
display_name=应用中心第三方
version=1.0.0
platform=x86
desc=<p>应用精选，用于管理和安装第三方飞牛应用。</p>...
maintainer=第三方开发者
distributor=社区
labels=工具,系统
```

### 远程源 (`local: false`) 应用字段来源

| App 字段 | 来源 | 说明 |
|----------|------|------|
| 全部字段 | 远程 fnpack.json | 后端直接解析远程 JSON 返回 |

---

## 本地源 vs 远程源

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              本地源 (local: true)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  URL 字段含义:     本地目录路径，如 /vol1/1000/AppStore                       │
│  数据来源:        扫描本地 FPK 文件，从 manifest 解析                         │
│  扫描方式:        递归扫描子目录                                             │
│  缓存机制:        指纹缓存 {PkgVar}/cache/{sourceID}.json                    │
│  首次加载:        扫描目录 → 解析所有 FPK → 返回                             │
│  后续加载:        对比指纹 → 仅解析变化的 FPK → 返回                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              远程源 (local: false)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  URL 字段含义:    远程服务器地址，如 http://fpk.example.com:8080            │
│  数据来源:        HTTP 请求 {URL}/fnpack.json                                │
│  扫描方式:        单次 HTTP 请求获取完整列表                                 │
│  缓存机制:        文件缓存 {PkgVar}/cache/{sourceID}.json                    │
│  首次加载:        请求远程 → 解析 fnpack.json → 缓存 → 返回                 │
│  后续加载:        直接读缓存 → 返回                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 缓存机制

### 缓存文件路径

```
{PkgVar}/cache/{sourceID}.json
```

示例：
- 本地源：`/var/apps/fn-appcenterThirdParty/var/cache/local_AppStore.json`
- 远程源：`/var/apps/fn-appcenterThirdParty/var/cache/source_1.json`

### 本地源缓存结构

```json
{
  "fingerprints": {
    "app1": { "mod_time": 1712736000, "size": 2456320 },
    "app2": { "mod_time": 1712650000, "size": 1536000 }
  },
  "apps": [
    {
      "id": "app1",
      "name": "应用1",
      "version": "1.0.0",
      ...
    }
  ]
}
```

### 指纹缓存判断逻辑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           指纹缓存判断流程                                   │
└─────────────────────────────────────────────────────────────────────────────┘

    遍历缓存中的应用
         │
         ├─── FPK 文件已删除（不在当前目录）  →  跳过（不返回）
         │
         ├─── FPK 指纹未变化  →  直接使用缓存的应用数据
         │
         └─── FPK 指纹变化    →  重新解析 FPK 文件，更新数据

    遍历目录中的 FPK 文件
         │
         └─── FPK 不在缓存中（新增）  →  解析 FPK 文件，添加到列表

    保存新缓存（fingerprints + apps）
```

### 缓存更新时机

| 操作 | 缓存行为 |
|------|----------|
| 首次加载 | 扫描 → 解析 → 保存缓存 |
| 再次加载 | 指纹对比 → 仅解析变化的 → 使用缓存 |
| 同步 | `POST /api/sources/{id}/sync` → `forceRescan=true` → 全部重新解析 |
| 重置 | `POST /api/sources/{id}/reset-cache` → 删除缓存文件 → 重新扫描 |

---

## 文件位置速查

| 功能 | 文件路径 |
|------|----------|
| Handler | `app/server/handlers/apps.go:GetApps` |
| 加载源 | `app/server/services/app_service.go:LoadSources` |
| 发现本地源 | `app/server/services/app_service.go:DiscoverLocalSources` |
| 扫描 FPK | `app/server/services/app_service.go:ScanFPKDir` |
| 收集 FPK | `app/server/services/app_service.go:collectFPKFiles` |
| 解析 FPK | `app/server/services/file_service.go:parseFPKFile` |
| 加载远程 | `app/server/services/source_service.go:parseAndCacheSource` |
| 源配置 | `app/server/var/sources.json` |
| 缓存目录 | `{PkgVar}/cache/` |
| 应用配置 | `app/server/var/config.json` |
