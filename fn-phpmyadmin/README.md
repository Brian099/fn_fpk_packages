# phpMyAdmin for fnOS

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/giraff-fun/fn_phpmyadmin)
[![License](https://img.shields.io/badge/license-GPL--2.0-green.svg)](https://www.phpmyadmin.net/license/)

**phpMyAdmin** 是一款基于 Web 的、功能强大的 MySQL / MariaDB 数据库管理工具。本项目专为 **fly-NAS (fnOS)** 环境深度优化，让您能够通过直观的图形化界面轻松管理您的数据库，无需复杂的命令行操作。

## 🚀 主要功能

- **直观的 Web 界面**：通过浏览器即可完成几乎所有的数据库管理任务。
- **全面的数据库操作**：支持创建、修改、删除数据库、表、字段、索引等。
- **强大的 SQL 执行**：内置 SQL 查询窗，支持语法高亮和执行历史。
- **便捷的数据导入导出**：支持 CSV、SQL、XML、PDF 等多种格式的数据交换。
- **权限管理**：轻松配置数据库用户及权限。
- **fnOS 深度集成**：适配 fnOS 应用框架，支持通过应用中心一键安装与管理。

## 📦 目录结构

```text
fn_phpmyadmin/
├── app/
│   ├── server/           # 服务端组件
│   │   ├── php/          # PHP 运行环境
│   │   └── phpmyadmin/   # phpMyAdmin 核心代码
│   └── ui/               # fnOS 桌面图标与启动配置
├── config/               # 配置文件 (Nginx, PHP 等)
├── wizard/               # fnOS 安装/卸载引导向导
├── manifest              # 应用清单文件，定义应用属性
├── ICON.PNG              # 应用图标
└── phpMyAdmin.fpk        # 打包后的 fnOS 安装包
```

## 🛠️ 安装说明

1. **前提条件**：在安装 phpMyAdmin 之前，请确保您的 fnOS 中已安装并启动了 **MariaDB** 插件。
2. **下载安装包**：获取 `phpMyAdmin.fpk` 文件。
3. **手动安装**：在 fnOS 应用中心选择“手动安装”，上传 `.fpk` 文件。
4. **引导配置**：
   - 按照安装向导提示，设置 **Web 访问端口**（默认为 `18090`）。
   - 完成安装后，点击桌面图标或通过 `http://[NAS-IP]:[端口]` 访问。

## ⚙️ 常见问题

- **如何登录？**
  使用您的 MariaDB 用户名（通常为 `root`）和密码进行登录。如果是在 fnOS 本地运行，通常连接地址填写 `localhost` 或系统默认配置。
- **端口冲突？**
  如果在安装时提示端口被占用，请通过安装向导修改为其他未占用的端口。

## ⚖️ 开源协议

- 本项目打包与集成脚本遵循 [MIT License](LICENSE)。
- phpMyAdmin 核心程序遵循 [GPL v2.0 License](https://www.phpmyadmin.net/license/)。

---

*由 [Giraff](https://giraff.fun) 维护与分发。*
