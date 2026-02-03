# WebOps - 飞牛 OS 可视化网页配置工具

WebOps 是一款专为飞牛 NAS 系统 (fnOS) 设计的轻量级可视化 Web 环境配置与管理工具。它通过直观的 Web 界面，帮助用户轻松管理 Nginx、PHP、数据库以及网站站点，无需繁琐的命令行操作。

![Version](https://img.shields.io/badge/version-1.0.0-blue) ![Platform](https://img.shields.io/badge/platform-fnOS-green) ![Author](https://img.shields.io/badge/maintainer-Giraff-orange)

## ✨ 核心功能

### 1. 🖥️ 系统环境管理
*   **Nginx 管理**：
    *   支持一键安装系统级 Nginx。
    *   智能检测 `/etc/nginx` 配置文件状态。
    *   提供服务重启与状态监控功能。
    *   支持查看 Nginx 错误日志与详细运行状态。
*   **PHP 环境**：
    *   集成 **PHP 8.2** 一键安装。
    *   **插件管理**：支持 30+ 常用 PHP 扩展（如 `mysql`, `gd`, `curl`, `redis` 等）的批量安装与卸载，优化安装流程，避免超时。
*   **数据库服务**：
    *   **Docker 集成**：基于 Docker Compose 一键部署 MySQL + phpMyAdmin 环境。
    *   **可视化管理**：内置 phpMyAdmin 快捷入口，方便进行数据库维护。
    *   智能状态检测：自动识别系统服务或 Docker 容器运行状态。

### 2. 🌐 网站站点管理
*   **站点创建**：支持快速创建静态或动态网站。
*   **模式支持**：支持 **域名绑定** 与 **端口监听** 两种模式。
*   **便捷运维**：
    *   一键启用/停用站点。
    *   站点目录权限自动修复（统一修正为 `www-data` 权限）。
    *   端口可视化编辑。

### 3. ⚙️ 通用设置
*   **上传限制**：可视化调整 Nginx 文件上传大小限制 (`client_max_body_size`)。
*   **服务控制**：独立的 Nginx 重启模块，包含 layui 风格的功能说明。

## 🛠️ 技术栈

*   **前端**：HTML5, jQuery, [Layui](https://layui.dev/) (UI 框架)
*   **后端**：Bash Shell (核心逻辑处理)
*   **接口**：CGI (Common Gateway Interface)
*   **容器化**：Docker & Docker Compose (数据库服务)

## 📂 目录结构

```text
/var/apps/webops
├── app
│   ├── server           # 后端核心脚本
│   │   └── sites_backend.sh  # 业务逻辑主程序
│   ├── ui               # 系统 UI 配置
│   └── www              # 前端静态资源 (HTML/JS/CSS)
├── cmd                  # fnOS 生命周期管理脚本
│   ├── main             # 启动/停止/状态检测
│   ├── install_*        # 安装钩子
│   └── upgrade_*        # 更新钩子
├── config               # 应用权限配置
├── wizard               # 安装向导配置
└── manifest             # 应用元数据定义
```

## 🚀 安装与使用

本应用遵循飞牛 OS 第三方应用标准结构。

1.  **安装**：将应用包部署到 fnOS 系统应用目录。
2.  **访问**：在飞牛桌面点击 **WebOps** 图标打开管理界面。
3.  **初始化**：
    *   进入“系统环境”页面。
    *   依次检查并安装 Nginx、PHP 和 数据库服务。
    *   *注：数据库推荐使用内置的 Docker 版安装功能，以获得最佳兼容性。*
4.  **建站**：在“网站管理”页面添加您的第一个站点。

## ⚠️ 注意事项

*   **Root 权限**：本应用运行需要 Root 权限 (`run-as: root`) 以执行系统级软件安装与配置管理。
*   **配置冲突**：如果您手动修改过 `/etc/nginx` 下的配置文件，请确保遵循标准结构，以免影响检测逻辑。
*   **端口占用**：安装 Docker 版数据库时，默认占用 `8080` (phpMyAdmin) 端口，请确保端口未被其他服务占用。

## 📄 License

Copyright © 2025 Giraff. All Rights Reserved.
