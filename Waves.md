# Waves - NAS 音乐播放器

Waves 是一款专为 NAS 环境（如 FnOS）设计的轻量级 Web 音乐播放器。它采用前后端分离架构，通过 CGI 与 Bash 脚本处理后端逻辑，前端使用原生 JavaScript 和 Layui 构建，提供流畅的音乐播放体验。

## ✨ 主要功能

- **🎶 音乐播放**
  - 支持常见音频格式：MP3, FLAC, WAV, OGG, M4A。
  - 包含播放、暂停、上一首/下一首、循环模式（单曲/列表）、随机播放等基础控制。
  - 音频可视化频谱效果。

- **📂 目录管理**
  - 支持添加多个音乐目录。
  - 递归扫描目录下的所有音乐文件。
  - **快速扫描与缓存**：首次扫描后生成缓存（`library.json`），大幅提升后续启动速度；支持后台静默检测文件变更。

- **📝 歌词支持**
  - **内嵌歌词**：优先读取音频文件中的内嵌歌词（ID3/Vorbis Comments）。
  - **外挂歌词**：支持自动加载同目录下的外挂歌词文件。
    - 查找顺序：同名 `.lrc` -> 同名 `.LRC` -> 同名 `.txt` -> `Lyrics/` 子目录 -> `lyrics/` 子目录。
    - **智能编码识别**：自动识别并转换 GBK/GB18030 编码的歌词文件，解决乱码问题。
  - **卡拉OK模式**：支持标准 LRC 时间戳解析及逐字/逐行高亮。

- **🖼️ 封面与元数据**
  - 自动提取音频文件的内嵌封面图片。
  - 解析 标题、歌手、专辑、时长 等元数据。
  - **分页加载**：针对大量歌曲列表采用分页显示与元数据懒加载，优化前端性能。

- **🎤 歌手管理**
  - 自动按歌手分组展示歌曲。
  - 集成网易云音乐 API 搜索并自动下载歌手头像。

## 🛠️ 技术栈

- **后端**：
  - Shell Script (Bash)
  - CGI (Common Gateway Interface)
  - `ffmpeg` / `ffprobe` (多媒体处理)
  - `python3` (辅助 JSON 处理与 URL 编码)

- **前端**：
  - HTML5 / CSS3
  - JavaScript (ES6+)
  - [Layui](https://layui.dev/) (UI 组件库)

## 📂 目录结构

```
.
├── app/
│   ├── server/
│   │   └── sites_backend.sh  # 核心后端逻辑 (扫描、元数据提取、配置管理)
│   ├── ui/
│   │   └── index.cgi         # API 入口与路由分发
│   └── www/                  # 静态资源
│       ├── index.html        # 主页
│       ├── script.js         # 前端逻辑
│       ├── style.css         # 样式表
│       └── layui/            # Layui 库
├── cmd/                      # 启动/停止脚本
├── config/                   # 配置文件与缓存存储
└── manifest                  # 应用元数据定义
```

## 🚀 部署与运行

本项目主要作为 FnOS 的第三方应用运行。

1. **环境依赖**：
   - 必须安装 `ffmpeg` 和 `ffprobe` 以支持元数据提取。
   - 需要 `python3` 用于处理复杂的 JSON 数据。
   - Web 服务器需支持 CGI 执行（如 Nginx + fcgiwrap 或 Apache）。

2. **API 接口**：
   - `POST /api/music/scan-fast`: 快速扫描文件名。
   - `POST /api/music/meta-batch`: 批量获取元数据。
   - `POST /api/music/library/save`: 保存缓存。
   - `POST /api/music/lyrics`: 获取歌词。
   - `GET /api/music/stream`: 音频流。

## 📝 开发说明

- **缓存机制**：为了减少对 NAS 硬盘的频繁唤醒和读取，应用会在首次扫描后将媒体库信息存储在 `config/library.json` 中。
- **外挂歌词增强**：后端脚本会自动处理多种命名规范的歌词文件，并尝试通过 `iconv` 修复编码问题。

## 📄 开源协议

MIT License
