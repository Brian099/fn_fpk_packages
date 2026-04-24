# Apache 管理器 (fnOS)

[![Version](https://img.shields.io/badge/version-1.0.2-blue.svg)](https://giraff.fun)
[![Platform](https://img.shields.io/badge/platform-fnOS-green.svg)](https://www.fnnas.com)

这是一个专为 fnOS 设计的 Apache2 独立生命周期管理器。它允许用户在不干扰系统核心服务的情况下，独立安装、配置和管理 Apache 环境。

## 🌟 核心特性

- **🚀 全自动安装时序**：集成在应用安装回调（`install_callback`）中。支持 x86_64 及 ARM64 双架构，安装即自动完成 Apache 及其依赖的离线部署。
- **🔌 动态端口避让**：在安装过程中，系统会自动检测并规避传统的 80 端口冲突，将 Apache 监听统一同步为用户在安装向导中设置的自定义端口（如 2880），全面支持 IPv4 和 IPv6 覆盖。
- **🎯 外科手术式进程管理**：采用精准 PID 定位技术，仅管理与 `/etc/apache2` 关联的实例，绝不误伤系统内置的其他服务。
- **🔄 零停机热重载**：支持 `apache2ctl graceful` 操作，在实时更新配置的同时确保 Web 服务不间断运行，避免全局重启带来的网页震荡。
- **📑 实时日志流**：集成 UI 日志展示功能。特别优化了“初始日志清理”逻辑，自动抹除安装阶段由于端口冲突产生的历史报错，还给用户一个干净的启动界面。
- **✅ 配置语法检测**：支持一键执行 `apache2ctl -t`，实时反馈配置文件正确性。
- **🛡️ 纯净卸载**：提供完整的卸载逻辑，支持保留用户核心数据。

## 🛠️ 技术架构

- **前端**：基于 Layui 框架构建，提供简洁现代的交互体验。
- **后端**：使用 Shell 脚本（`manager.sh`）驱动，通过标准的 CGI 接口（`index.cgi`）与飞牛系统深度集成。
- **权限管理**：运行时以 `root` 权限托管，确保能够对系统级配置文件进行外科手术式的精准修改。

## 📁 目录结构

```text
ApacheManager/
├── app/
│   ├── server/           # 后端核心逻辑 (manager.sh & 离线包)
│   ├── ui/               # CGI 入口及图标资源
│   └── www/              # Web 管理界面 (HTML/JS/CSS)
├── cmd/                  # 生命周期回调脚本 (安装、卸载、启动)
├── config/               # 权限与资源定义
├── wizard/               # 用户安装向导配置
└── manifest              # 应用身份证
```

## 📝 安装指南

1. 下载 `ApacheManager.fpk` 文件。
2. 在飞牛 fnOS 应用中心选择“手动安装”。
3. 在安装向导中，根据需要修改 **Apache 服务端口**（默认为 2880）。
4. 完成安装，点击桌面图标即可开启管理之旅。

## 🤝 维护与支持

- **维护者**：Giraff
- **官网**：[https://giraff.fun](https://giraff.fun)
- **描述**：本工具旨在帮助高级用户和开发者快速搭建独立的 Apache 环境，同时确保系统原有服务的稳定性。

---
Produced with ❤️ by Antigravity.
