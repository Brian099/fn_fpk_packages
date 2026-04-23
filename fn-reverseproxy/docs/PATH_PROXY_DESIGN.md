# 路径代理（Path-based Proxy）功能设计文档

> 状态：方案记录，待评估是否实施  
> 创建日期：2026-04-07

---

## 1. 功能概述

在现有基于域名/端口的路由基础上，增加**可选的路径前缀匹配**能力，使同一端口下的请求可按 URL 路径分发到不同后端服务（类似 Nginx 的 `location` 指令）。

### 使用场景示例

| 场景 | 来源 | 目标 | 说明 |
|:-----|:-----|:-----|:-----|
| API 网关 | `:8080` + `/api/` → 后端A | `/api/*` 原样转发 | API 请求统一入口 |
| 静态资源剥离 | `:8080` + `/static/` → CDN | `/static/*` 转发到 CDN 服务 | 静态资源分离 |
| 版本路由重写 | `:8080` + `/v1/` → 后端B | `/v1/users` 重写为 `/v2/users` | API 版本迁移 |
| 子应用挂载 | `:8080` + `/app/` → 内部服务 | `/app/page` 转发为 `/page` | 多个应用共享一个端口 |
| 全量兜底 | `:8080` + *(无路径)* → 主站 | 所有未匹配路径 | 默认回退 |

---

## 2. 数据模型变更

### ProxyRule 新增字段

```go
type ProxyRule struct {
    // ===== 现有字段（保持不变）=====
    ID             string   `json:"id"`
    Name           string   `json:"name"`
    Enable         bool     `json:"enable"`
    Domains        []string `json:"domains"`
    SourceProtocol string   `json:"sourceProtocol,omitempty"`
    SourceHost     string   `json:"sourceHost,omitempty"`
    SourcePort     string   `json:"sourcePort,omitempty"`
    TargetProtocol string   `json:"targetProtocol,omitempty"`
    TargetHost     string   `json:"targetHost,omitempty"`
    TargetPort     string   `json:"targetPort,omitempty"`
    Timeout        string   `json:"timeout,omitempty"`
    HSTS           bool     `json:"hsts,omitempty"`
    PreserveHost   bool     `json:"preserveHost,omitempty"`

    // ===== 新增字段 =====
    SourcePath   string `json:"sourcePath,omitempty"`   // 来源路径前缀，如 "/api/"，空字符串表示匹配所有路径
    StripPrefix  bool   `json:"stripPrefix,omitempty"`  // 是否在转发时剥离 SourcePath
    TargetPath   string `json:"targetPath,omitempty"`   // 剥离前缀后替换的目标路径前缀
}
```

### 字段组合行为矩阵

| SourcePath | StripPrefix | TargetPath | 请求路径 | 转发到后端的路径 | 说明 |
|:-----------|:------------|:-----------|:---------|:-----------------|:-----|
| *(空)* | - | - | `/any/path` | `/any/path` | 兜底规则，全量转发 |
| `/api/` | false | - | `/api/users` | `/api/users` | 保留原路径 |
| `/api/` | true | - | `/api/users` | `/users` | 剥离前缀 |
| `/api/v1/` | true | `/api/v2/` | `/api/v1/users` | `/api/v2/users` | 路径重写 |
| `/static/` | true | `/` | `/static/css/a.css` | `/css/a.css` | 映射到根 |

---

## 3. 核心逻辑改造

### 3.1 数据结构变化

```
改造前：
  portMap: map[string]*ProxyRule          ← 一个端口只能绑定一条规则

改造后：
  portMap: map[string][]*ProxyRule         ← 一个端口可绑定多条规则，按路径分流
```

### 3.2 匹配流程

```
请求进入 Handler(c *gin.Context)
  │
  ├─ Step 1: 提取 Host 域名
  │     └─ domainMap[domain] → 规则?
  │           ├─ 命中 → 检查 SourcePath 匹配
  │           │     ├─ 匹配 → 执行转发 ✅
  │           │     └─ 不匹配 → 继续 Step 2
  │           └─ 未命中 → 继续 Step 2
  │
  ├─ Step 2: 按 protocol:port 查找候选规则列表
  │     └─ portMap["http:8080"] → [*ProxyRule]
  │           └─ findBestMatch(rules, requestPath)
  │                 ├─ 遍历规则，按 SourcePath 长度降序排列
  │                 │     （最长前缀优先，类似 Nginx location 策略）
  │                 ├─ 第一条命中的规则获胜
  │                 └─ 全部未命中 → 404 Not Found
  │
  └─ Step 3: 执行转发（含可选的路径改写）
```

### 3.3 最长前缀匹配算法

```go
func findBestMatch(rules []*config.ProxyRule, requestPath string) *config.ProxyRule {
    var best *config.ProxyRule
    bestLen := -1

    for _, rule := range rules {
        if !rule.Enable { continue }

        sp := strings.TrimSuffix(rule.SourcePath, "/")
        if sp == "" {
            // 无路径限制 = 兜底规则，优先级最低
            if best == nil { best = rule }
            continue
        }

        // 精确匹配或前缀匹配（确保 /api/ 不误匹配 /api-v2/）
        if requestPath == sp || strings.HasPrefix(requestPath, sp+"/") {
            if len(sp) > bestLen {
                best = rule
                bestLen = len(sp)
            }
        }
    }
    return best
}
```

### 3.4 Director 路径改写

```go
rp.Director = func(req *http.Request) {
    req.URL.Scheme = targetURL.Scheme
    req.URL.Host = targetURL.Host

    if p.SourcePath != "" && p.StripPrefix {
        prefix := strings.TrimSuffix(p.SourcePath, "/")
        newPath := strings.TrimPrefix(req.URL.Path, prefix)
        if p.TargetPath != "" {
            newPath = p.TargetPath + newPath
        }
        if newPath == "" { newPath = "/" }
        req.URL.Path = newPath
    }

    if !p.PreserveHost { req.Host = targetURL.Host }
}
```

---

## 4. 校验规则扩展

### 4.1 新增校验项

| # | 校验项 | 条件 | 错误提示 |
|:-:|:-------|:-----|:---------|
| 1 | SourcePath 格式 | 非空时必须以 `/` 开头 | `来源路径必须以 / 开头` |
| 2 | SourcePath 唯一性 | 同一 (protocol+port) 下不能重复相同 SourcePath | `来源路径 "/api/" 在此端口下已存在` |
| 3 | 兜底规则唯一性 | 同一 (protocol+port) 下只能有一条 SourcePath 为空的兜底规则 | `此端口已存在一条兜底规则（无路径限制）` |
| 4 | StripPrefix 依赖 | StripPrefix=true 时 SourcePath 不能为空 | `启用"剥离路径前缀"时必须填写来源路径` |
| 5 | TargetPath 依赖 | TargetPath 非空时必须同时启用 StripPrefix | `"目标路径前缀"需配合"剥离路径前缀"使用` |

### 4.2 向后兼容

- **SourcePath 为空** 时，行为与当前完全一致（全量转发）
- **旧配置文件** 无 SourcePath 字段，默认为空字符串，无需数据迁移
- 现有校验逻辑中 `(protocol+port)` 唯一约束需要放宽：允许同一端口多条规则（只要 SourcePath 不同）

---

## 5. 安全风险评估

### 5.1 高风险项

#### R01 — 路径穿越攻击（Path Traversal）

**描述**：如果 `StripPrefix` + `TargetPath` 组合不当，可能导致用户构造恶意路径访问后端非预期资源。

**攻击示例**：
```
规则配置: SourcePath="/static/", StripPrefix=true, TargetPath="/"
正常请求:  GET /static/../etc/passwd
预期转发:  GET /../etc/passwd  ← 穿越到上层目录！
```

**当前代码状态**：Go 标准库 `httputil.ReverseProxy` 会自动清理 `..` 路径段，但自定义 Director 改写路径时应显式验证。

**缓解措施**：
```go
import "net/http"

func sanitizePath(p string) string {
    // 使用 Go 标准库清理路径穿越
    clean := http.CleanPath(p)
    if !strings.HasPrefix(clean, "/") { clean = "/" + clean }
    return clean
}
```

**风险等级**：🔴 **高** — 必须在实现时修复

---

#### R02 — 开放重定向 / SSRF

**描述**：TargetHost/TargetPort 由用户通过 Web 界面填写，若未做内网地址限制，攻击者可利用反向代理作为跳板访问内网任意服务。

**攻击场景**：
```
恶意规则: 目标=http://169.254.169.254/latest/meta-data/  (云元数据)
恶意规则: 目标=http://10.0.0.1:6379/                    (内部 Redis)
恶意规则: 目标=http://127.0.0.1:22/                       (本地 SSH)
```

**缓解措施**（按强度排序）：

| 方案 | 实现难度 | 效果 |
|:-----|:---------|:-----|
| A. 白名单模式 | 低 | 仅允许管理员预设的目标地址范围 |
| B. 私有地址拦截 | 中 | 禁止目标指向 RFC1918 / 链路本地 / 回环地址 |
| C. 出站连接超时 | 低 | 限制单次转发最大时长和响应体大小 |
| D. 操作审计日志 | 低 | 记录所有规则变更和转发操作 |

**建议**：至少实施 **C + D**，理想情况实施 **B + C + D**

**风险等级**：🟠 **中高** — 当前版本即存在此风险，路径代理功能不改变风险等级但扩大了攻击面

---

#### R03 — 正则注入（未来扩展时）

**描述**：本方案 A 采用固定前缀匹配，不存在正则注入。但如果后续升级为支持正则表达式（Option B），将引入 ReDoS 风险。

**建议**：当前方案不受影响；若未来引入正则，需限制正则复杂度并设置超时。

**风险等级**：🟢 **低**（当前方案不受影响）

---

### 5.2 中风险项

#### R04 — Host 头伪造

**描述**：当 `PreserveHost=false`（默认）时，系统会覆盖 Host 头为目标地址。但如果用户开启 `PreserveHost=true`，原始 Host 头会被传递给后端。

**影响范围**：
- 后端虚拟主机可能根据 Host 头返回不同内容
- 缓存键可能受 Host 头影响导致缓存污染

**缓解措施**：
- 默认保持 `PreserveHost=false`
- UI 上对 PreserveHost 选项添加安全提示说明

**风险等级**：🟡 **中** — 已有功能，路径代理不新增风险

---

#### R05 — 路径信息泄露

**描述**：404 响应当前直接返回 JSON `{"error": "No proxy rule found for host: xxx"}`，可能泄露内部域名、端口、规则名称等架构信息。

**当前代码位置**：`proxy.go` Handler 函数末尾

**缓解措施**：
- 生产环境返回通用 404 页面
- 详细错误仅写入服务端日志
- 区分管理接口（Unix Socket）和公网接口的错误详情级别

**风险等级**：🟡 **中** — 已存在问题，建议一并修复

---

#### R06 — 无认证的管理接口

**描述**：API 接口（增删改查规则）通过 Unix Socket 暴露，虽然不占用 TCP 端口，但如果服务器上有其他低权限用户或被入侵的进程，可直接操作代理规则。

**缓解措施**：
- Unix Socket 文件权限已设为 0666（当前），建议收紧为 0660 或 0640
- 可选添加简单的 Token 认证（通过环境变量或配置文件传入）

**风险等级**：🟡 **中** — 与路径代理无关，但值得改进

---

### 5.3 低风险项

#### R07 — 配置文件注入

**描述**：config.json 为纯文本 JSON，若文件权限不当，本地用户可篡改规则。

**缓解措施**：文件权限 0644（当前合理）

**风险等级**：🟢 **低**

---

#### R08 — TLS 证书验证缺失（目标端 HTTPS）

**描述**：当目标协议为 HTTPS 时，`ReverseProxy` 默认使用 `http.DefaultTransport`，会验证证书。但如果目标使用自签名证书，转发会失败。

**缓解措施**：可在高级选项中添加"跳过目标 TLS 验证"开关（默认关闭）。

**风险等级**：🟢 **低**

---

## 6. 风险汇总与优先级

| 编号 | 风险项 | 等级 | 与路径代理的关系 | 建议处理时机 |
|:----:|:-------|:----:|:-----------------|:-------------|
| R01 | 路径穿越攻击 | 🔴 高 | **由路径代理引入** | 实施时必须同步修复 |
| R02 | 开放重定向/SSRF | 🟠 中高 | 已存在，路径代理扩大攻击面 | 尽快修复（独立于本功能） |
| R03 | 正则注入 | 🟢 低 | 本方案不受影响 | 未来扩展时关注 |
| R04 | Host 头伪造 | 🟡 中 | 已存在 | 可选优化 |
| R05 | 信息泄露(404) | 🟡 中 | 已存在 | 建议修复 |
| R06 | 无认证管理接口 | 🟡 中 | 已存在 | 建议修复 |
| R07 | 配置文件注入 | 🟢 低 | 已存在 | 无需紧急处理 |
| R08 | 目标TLS验证 | 🟢 低 | 已存在 | 按需添加选项 |

---

## 7. 影响范围评估

| 文件 | 改动类型 | 工作量估计 |
|:-----|:---------|:-----------|
| `config/config.go` | 新增 3 字段 + 扩展 ValidateProxy | 小 |
| `proxy/proxy.go` | portMap 类型变更 + Handler 重写 + Director 扩展 | 中 |
| `api/api.go` | 无需改动（校验已在 config 层） | 无 |
| `app/www/index.html` | 表单新增 3 字段 + 校验适配 | 小 |
| 向后兼容性 | SourcePath 为空时完全兼容旧配置 | ✅ |

---

## 8. 待决策事项

- [ ] 是否实施？实施优先级？
- [ ] R02（SSRF 防护）是否需要在本次同步解决？
- [ ] 是否需要支持正则路径匹配（进入 Option B 范畴）？
- [ ] Unix Socket 权限是否需要从 0666 收紧？
- [ ] 404 错误响应是否需要脱敏？
