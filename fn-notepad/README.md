# 便签记事本 (notepad)

飞牛系统 (FlyNAS) 的简约便签记事本应用。

## 介绍
![便签笔记本1](https://gitee.com/laoknas/fn_fpk_packages/raw/master/fn-notepad/image/notepad01.png)
![便签笔记本2](https://gitee.com/laoknas/fn_fpk_packages/raw/master/fn-notepad/image/notepad02.png)

## 功能特性
- **简约设计**：采用现代毛玻璃质感界面。
- **色彩分类**：支持多种颜色标记便签。
- **日期备忘**：支持设置提醒时间，并在卡片上直观展示。
- **持久化存储**：数据安全保存在 NAS 存储目录下，重装不丢失。
- **多架构支持**：支持 x86_64 和 aarch64。

## 项目结构
- `app/www`: 前端静态资源 (HTML/CSS/JS)。
- `serverSourceCode`: 后端 Go 源码。
- `cmd/`: 飞牛系统应用生命周期管理脚本。
- `config/`: 应用权限与资源配置。
- `wizard/`: 安装向导配置。


## 维护者
- laok ([Gitee](https://gitee.com/laoknas/fn_fpk_packages/fn-notepad))
