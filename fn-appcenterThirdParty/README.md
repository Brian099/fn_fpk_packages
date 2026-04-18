# 第三方应用精选

飞牛第三方应用精选，用于管理和安装第三方飞牛应用。

## 功能特性

- 浏览和搜索第三方应用
- 支持多源管理（类似群晖套件中心）
- 自动发现本地 /download/ 目录下的源
- 应用下载和安装
- 支持 FnDepot 源信息规范

## 技术栈

- 前端：index.cgi + UNIX Socket + 飞牛原生样式
- 后端：Go 语言 (Gin 框架)
- 存储：JSON 文件缓存
- 文件处理：标准库 + archive/zip

## 项目结构

```
appcenterThirdParty/
├── app/
│   ├── server/          # 后端服务 (Go)
│   │   ├── main.go      # 主入口
│   │   └── api_handlers.go  # API 处理器
│   ├── ui/
│   │   └── index.cgi    # 前端 CGI 入口
│   └── www/             # 静态文件
│       ├── index.html
│       ├── style.css
│       └── app.js
├── cmd/                 # 生命周期管理脚本
├── config/              # 配置文件
├── wizard/              # 向导配置
├── AppStore/            # 应用存储目录
├── download/            # 源目录（自动发现）
├── var/                 # 运行时数据
└── manifest             # 应用清单
```

## 构建与部署

### 本地开发

1. 安装 Go 环境 (1.21+)

2. 安装依赖：
```bash
go mod download
```

3. 运行后端服务：
```bash
cd app/server
go run main.go --port 18088
```

4. 访问前端：
```
http://localhost:18088
```

### 构建 FPK 包

1. 运行构建脚本：
```bash
build.bat
```

2. 使用 fnpack.exe 打包应用

## API 接口

### 应用接口

- `GET /api/apps` - 获取应用列表
  - 参数: `source`, `category`, `keyword`, `page`, `page_size`

- `GET /api/apps/:id` - 获取应用详情

- `GET /api/apps/:id/icon` - 获取应用图标

### 源管理接口

- `GET /api/sources` - 获取源列表

- `POST /api/sources` - 添加源
  - Body: `{ "name": "源名称", "url": "http://..." }`

- `DELETE /api/sources/:id` - 删除源

- `POST /api/sources/:id/sync` - 同步源数据

### 下载接口

- `GET /download/:source_id/:filename` - 下载应用安装包

## 使用说明

### 添加第三方源

1. 打开应用中心
2. 点击"源管理"
3. 点击"添加源"
4. 输入源地址（例如：`https://fpk.example.com:18088`）

### 本地源自动发现

将包含 `fnpack.json` 的源目录放入 `/download/` 目录下，系统会自动发现并加载。

### 源格式要求

每个源必须包含 `fnpack.json` 索引文件，格式遵循 [FnDepot 规范](./应用商店源信息规范.md)。

## 配置说明

### manifest 字段

| 字段 | 说明 |
|------|------|
| appname | 应用唯一标识 |
| version | 版本号 |
| display_name | 显示名称 |
| desc | 应用描述 |
| platform | 支持平台架构 |

### 权限配置

应用需要以下权限：
- network: 网络访问（用于同步远程源）
- storage: 存储访问（用于读写应用数据）

## 开发指南

详细的开发指导请参考 [开发指导意见.md](./开发指导意见.md)。

## 许可证

MIT License
