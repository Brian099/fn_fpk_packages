# fn-scheduledtask 计划任务应用

## 简介

**fn-scheduledtask** 是一个功能强大的计划任务管理应用，专为飞牛系统设计。它支持多种触发方式（Cron 定时、间隔执行、指定时间、开机/关机事件），并允许创建 Shell 脚本和 Python 函数任务，满足各种自动化运维需求。

## 功能特性

### 1. 多种触发类型

- **定时 (Cron)**: 支持标准 5 字段 Cron 表达式，提供可视化 Cron 生成器
- **间隔执行**: 按固定间隔（秒）重复执行任务
- **指定时间**: 在指定的日期和时间一次性执行
- **开机时**: 系统启动时自动执行
- **关机时**: 系统关机时自动执行

### 2. 任务类型

- **Shell 脚本**: 直接编写和执行 Shell 脚本
- **Python 函数**: 调用已定义的 Python 函数，支持自定义模块

### 3. 账号管理

- 支持选择系统用户账号执行任务
- 显示系统中所有可用的用户账号
- 可刷新账号列表
- 选择 root 账号时有安全确认提示

### 4. 任务管理

- 创建、编辑、删除任务
- 启用/停用任务
- 立即运行任务
- 终止正在运行的任务
- 查看任务执行结果和日志
- 脚本文件管理

### 5. 运行设置

- 任务超时时间
- 结果保留条数
- 日志预览字符数

### 6. UI 特性

- 中文/英文双语支持
- 亮/暗主题切换
- 响应式设计

## 安装

### 系统要求

- 飞牛系统 0.9.0+
- 平台：all（支持 x86 和 arm）

### 安装方式

1. 在飞牛系统应用中心安装此应用
2. 或通过应用包手动安装

## 使用指南

### 创建任务

1. 点击"新建"按钮
2. 填写任务名称
3. 选择触发类型
4. 根据触发类型配置相应参数
5. 选择任务类型（Shell 脚本或 Python 函数）
6. 选择执行账号（可选）
7. 编写脚本或选择 Python 函数
8. 点击"保存"

### 触发类型配置

#### Cron 定时

- 使用标准 5 字段 Cron 表达式：`分 时 日 月 周`
- 周字段：0=周一，6=周日
- 点击"生成器"按钮可使用可视化 Cron 生成器

#### 间隔执行

- 设置间隔秒数（最小 1 秒）

#### 指定时间

- 选择执行的日期和时间

#### 开机/关机

- 无需额外配置，系统事件触发

### 账号选择

- **Shell 脚本任务**: 可选择系统用户账号执行
- **Python 函数任务**: 不支持账号切换，在应用进程中执行
- **选择 root**: 需要确认提示

### 脚本管理

1. 点击"脚本管理"按钮
2. 在左侧选择或创建脚本文件
3. 在右侧编辑器中编辑脚本内容
4. 保存或删除脚本

## 内置 Python 函数

应用提供了一些内置的 Python 函数示例：

- `task_methods.hello_world`: Hello World 示例
- `task_methods.log_timestamp`: 记录当前时间戳
- `task_methods.check_system_status`: 检查系统状态（CPU、内存、磁盘）
- `task_methods.backup_logs`: 备份日志文件
- `task_methods.cleanup_temp_files`: 清理临时文件
- `task_methods.send_heartbeat`: 发送心跳信号

您可以在 `app/server/tasks/task_methods.py` 中添加自定义函数。

## 配置文件

### privilege

```json
{
    "defaults": {
        "run-as": "root"
    }
}
```

应用默认以 root 权限运行，支持账号切换功能。

## 目录结构

```
fn-scheduledtask/
├── app/
│   ├── server/
│   │   ├── scheduler.py          # 主程序
│   │   ├── requirements.txt      # Python 依赖
│   │   └── tasks/
│   │       ├── __init__.py
│   │       └── task_methods.py   # 内置任务函数
│   ├── ui/                       # UI 配置
│   └── www/                      # Web 界面
│       ├── index.html
│       ├── app.js
│       ├── style.css
│       └── i18n.js               # 多语言
├── cmd/                          # 应用命令脚本
├── config/
│   ├── privilege                 # 权限配置
│   └── resource                  # 资源配置
├── wizard/                       # 安装/配置向导
├── manifest                      # 应用清单
└── README.md                     # 说明文档
```

## 开发

### 添加自定义 Python 函数

在 `app/server/tasks/task_methods.py` 中添加函数：

```python
def my_custom_function(task_id, task_name):
    """我的自定义任务"""
    print(f"执行任务 {task_name} (ID: {task_id})")
```

然后在创建任务时选择 Python 函数，输入 `task_methods.my_custom_function`。

### 技术栈

- **后端**: Python 3, APScheduler
- **前端**: 原生 JavaScript, HTML5, CSS3
- **数据库**: SQLite

## 常见问题

### Q: 如何查看任务执行日志？

A: 选中任务后点击"执行结果"按钮，可以查看任务的执行历史和日志输出。

### Q: Python 函数任务为什么不能选择账号？

A: Python 函数在应用进程内直接执行，不支持进程级别的账号切换。如需使用特定账号执行，请使用 Shell 脚本任务。

### Q: 任务执行超时怎么办？

A: 在"设置"中可以调整任务超时时间（默认 900 秒）。

### Q: 开机任务什么时候执行？

A: 应用启动时会立即触发所有启用的开机任务。

### Q: 关机任务可靠吗？

A: 关机任务在应用收到 SIGTERM 信号时触发，但系统强制关机可能导致任务无法执行完成。

## 版本历史

### v1.0.1

- 添加账号选择功能
- 支持多用户执行 Shell 脚本
- 添加开机/关机事件触发
- 添加 Cron 生成器
- 添加脚本管理功能
- 多语言支持（中文/英文）
- 主题切换

## 维护者

- **维护者**: laok
- **网站**: https://laokhome.cn/

## 许可证

本项目为飞牛系统第三方应用。

## 致谢

- APScheduler - Python 任务调度库
- fn-scheduler - 感谢RROrg其提供的任务调度器实现
- 飞牛系统 - 应用运行平台
