# fn-reverseproxy 后端服务

这是一个轻量级的反向代理服务，专门为飞牛系统设计。

## 项目结构

```
server/
├── main.go           # 主入口
├── go.mod            # Go 模块文件
├── build.sh          # 编译脚本
├── config/           # 配置管理
│   └── config.go
├── api/              # API 接口
│   └── api.go
├── proxy/            # 反向代理核心
│   └── proxy.go
└── README.md
```

## 功能特性

- ✅ 域名路由
- ✅ 反向代理转发
- ✅ 配置管理（JSON）
- ✅ Unix Socket 和 TCP 端口双监听
- ✅ Web UI 管理界面
- ✅ 基础登录认证

## 编译

```bash
cd app/server
./build.sh
```

或者手动编译：

```bash
cd app/server
export GOOS=linux
export GOARCH=amd64
go build -v -ldflags="-s -w" -o reverseproxy
```

## 运行参数

```bash
./reverseproxy \
  -cd <config-dir>          # 配置文件目录
  -unix-socket <path>       # Unix Socket 路径
  -p <port>                 # TCP 端口（默认 16601）
  -proxy-addr <addr>        # 代理服务监听地址（默认 :80）
  -proxy-tls                # 启用 TLS
  -proxy-cert <cert-file>   # TLS 证书文件
  -proxy-key <key-file>     # TLS 密钥文件
```

## 默认登录

- 账号: `666`
- 密码: `666`

## 配置文件

配置文件会自动生成在指定的配置目录下：`config.json`

```json
{
  "admin": {
    "username": "666",
    "password": "666"
  },
  "proxies": []
}
```
