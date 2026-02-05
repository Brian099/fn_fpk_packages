# FFmpeg Transcoder Web manager

一个基于 Web 的轻量级 FFmpeg 转码管理工具，专为简化视频转码任务而设计。它提供了一个直观的界面来配置转码参数、预览压缩效果，并利用硬件加速功能高效处理视频。

## ✨ 主要功能

- **Web 操作界面**：无需记忆复杂的 FFmpeg 命令行参数，通过网页即可完成配置。
- **硬件加速支持**：
  - 自动检测并配置 NVIDIA 显卡 (CUDA/NVENC)。
  - 支持 Intel/AMD 核显硬件加速 (VAAPI/QSV)。
  - 精确显示显卡型号（如 NVIDIA RTX 4090）。
- **实时预览与估算**：
  - 支持截取视频片段（默认10秒）进行快速转码预览。
  - **智能体积估算**：根据预览结果，自动计算全片压缩后的预估体积和压缩率。
- **灵活的任务控制**：
  - 支持批量添加转码任务。
  - 支持多线程控制（自定义线程数或自动管理）。
  - **任务中止**：随时取消正在进行的转码任务。
- **CPU 核心检测**：自动显示系统核心数，辅助线程配置。
- **容器化部署**：基于 Docker，环境隔离，一键部署。

## 🛠️ 安装与部署

### 前置要求

- **Docker** & **Docker Compose**
- (可选) **NVIDIA 驱动**：如果你需要使用 NVIDIA 显卡加速，请确保宿主机已安装驱动及 `nvidia-container-toolkit`。

### 快速开始

本项目提供了一键安装脚本 `setup.sh`，它会自动检测硬件环境并生成相应的 Docker 配置。

1. **下载项目代码**
   ```bash
   git clone <your-repo-url>
   cd ffmpeg-web-transcoder
   ```

2. **运行安装脚本**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

3. **配置媒体目录**
   脚本运行过程中会提示输入**媒体文件目录**（存放待转码视频的文件夹）。
   - 默认为当前目录下的 `./media`。
   - 如果输入了自定义路径（如 `/mnt/user/downloads`），脚本会自动将其挂载到容器内。

4. **启动服务**
   脚本最后会尝试自动启动容器。如果需要手动启动：
   ```bash
   docker-compose up -d
   ```

5. **访问界面**
   打开浏览器访问：[http://localhost:8000](http://localhost:8000)

## 📖 使用指南

1. **准备文件**：将需要转码的视频文件放入你配置的媒体目录下的 `input` 文件夹中（如果没有会自动创建）。
2. **选择文件**：在网页左侧文件列表中，勾选要处理的视频。
3. **配置参数**：
   - **编码器**：选择 H.264, H.265 (HEVC), 或对应的硬件加速编码器 (h264_nvenc, hevc_qsv 等)。
   - **预设 (Preset)**：调整编码速度与质量平衡（如 fast, medium, slow）。
   - **线程数**：根据 CPU 核心数调整，或设为 0 让 FFmpeg 自动选择。
4. **预览**：点击“生成预览”按钮，查看 10 秒片段的画质和预估体积。
5. **开始转码**：点击“添加到任务队列”，并在右侧点击“开始”执行任务。
6. **查看结果**：转码完成后的文件将保存在媒体目录下的 `output` 文件夹中。

## 📂 目录结构

```text
.
├── main.py                 # 后端核心逻辑 (FastAPI)
├── static/                 # 前端静态资源 (HTML/JS/CSS)
├── setup.sh                # 自动安装与环境检测脚本
├── Dockerfile              # 容器构建文件
├── docker-compose.template.yml # Docker Compose 模板
├── requirements.txt        # Python 依赖
└── media/                  # (默认) 媒体文件挂载点
    ├── input/              # 存放待转码视频
    └── output/             # 存放转码完成的视频
```

## ⚠️ 注意事项

- **预览功能**：预览时生成的临时文件会存放在 `static/previews` 目录下。
- **TS 文件支持**：支持 `.ts` 格式视频，但在预览时可能会因源文件损坏导致失败（正在优化容错处理）。
- **字幕处理**：默认模式下，转码会尝试复制字幕流；如果遇到兼容性问题，可在参数中调整。

## 📝 开发与贡献

如果你想在本地开发：
1. 安装 Python 3.9+。
2. 安装依赖：`pip install -r requirements.txt`。
3. 确保系统安装了 `ffmpeg`。
4. 运行服务：`uvicorn main:app --reload --host 0.0.0.0 --port 8000`。

---
Powered by FastAPI, AdminLTE & FFmpeg.
