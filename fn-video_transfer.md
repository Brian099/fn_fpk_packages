# Video Transfer

Video Transfer 是一个基于 **FFmpeg** 和 **FastAPI** 的高性能视频转码服务，专为简化视频转码任务而设计。它提供了一个直观的 Web 界面来配置转码参数、预览压缩效果，并利用硬件加速功能高效处理视频。

## ✨ 主要功能

- **Web 操作界面**：无需记忆复杂的 FFmpeg 命令行参数，通过网页即可完成配置。
- **用户认证系统**：
  - 支持用户注册与登录。
  - 基于 JWT 的安全认证。
  - 权限管理（管理员/普通用户）。
- **硬件加速支持**：
  - 自动检测并配置 NVIDIA 显卡 (CUDA/NVENC)。
  - 支持 Intel/AMD 核显硬件加速 (VAAPI/QSV)。
  - 精确显示显卡型号。
- **实时预览与估算**：
  - 支持截取视频片段进行快速转码预览。
  - **智能体积估算**：根据预览结果，自动计算全片压缩后的预估体积和压缩率。
- **灵活的任务控制**：
  - 任务队列管理。
  - 支持多线程控制。
  - 任务中止与状态监控。
- **容器化部署**：基于 Docker，环境隔离，一键部署。

## 🛠️ 安装与部署

### 1. TOS 系统安装 (推荐)
本项目已适配 TerraMaster TOS 系统，可直接通过应用中心安装 `.tpk` 包。
安装向导会自动引导您配置：
- **媒体目录**：存放视频文件的位置。
- **配置目录**：存放用户数据库等配置文件的位置。

### 2. 手动 Docker 部署

如果您希望在标准 Docker 环境下运行：

1. **下载代码**
   ```bash
   git clone <repo>
   cd video_transfer/app/docker
   ```

2. **配置环境**
   运行 `setup.sh` 脚本，或手动设置环境变量：
   ```bash
   export wizard_data="/path/to/media"
   export wizard_config="/path/to/config"
   ./setup.sh
   ```
   脚本会自动检测硬件并生成 `docker-compose.yaml`。

3. **启动服务**
   ```bash
   docker-compose up -d
   ```

4. **访问界面**
   打开浏览器访问：[http://localhost:8087](http://localhost:8087) (默认端口)

## 📖 使用指南

1. **首次登录**：访问页面后，点击 "Login" 进行注册/登录。
2. **准备文件**：将视频文件放入配置的媒体目录下的 `input` 文件夹。
3. **创建任务**：
   - 选择输入文件。
   - 配置编码格式 (H.264/H.265)、分辨率、码率等。
   - 选择是否开启硬件加速。
   - 点击“添加到任务队列”。
4. **管理任务**：在任务列表中点击“开始”，查看进度条。
5. **获取结果**：转码后的文件位于媒体目录下的 `output` 文件夹。

## 📂 目录结构

```text
.
├── main.py                 # 后端核心逻辑 (FastAPI)
├── static/                 # 前端静态资源
├── setup.sh                # 自动安装与环境检测脚本
├── Dockerfile              # 容器构建文件
├── docker-compose.template.yml # 模板文件
└── requirements.txt        # Python 依赖
```

## ⚠️ 注意事项

- **端口映射**：默认容器端口 8000 映射到宿主机 8087。
- **NVIDIA 支持**：需要宿主机安装 NVIDIA 驱动及 `nvidia-container-toolkit`。
