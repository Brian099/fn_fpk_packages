package proxy

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"fn-reverseproxy/config"

	"github.com/gin-gonic/gin"
)

type ListenAddr struct {
	Addr      string
	EnableTLS bool
}

type fnosCert struct {
	Domain      string   `json:"domain"`
	SAN         []string `json:"san"`
	Certificate string   `json:"certificate"`
	Fullchain   string   `json:"fullchain"`
	PrivateKey  string   `json:"privateKey"`
}

type WildcardDomainRule struct {
	Protocol string
	Port     string
	Pattern  string
	Rule     *config.ProxyRule
}

var (
	proxies     = make(map[string]*httputil.ReverseProxy)
	proxiesMu   sync.RWMutex

	domainExactMap     = make(map[string]*config.ProxyRule)
	wildcardDomainList []WildcardDomainRule
	portCatchAllMap    = make(map[string]*config.ProxyRule)
	portRulesMap       = make(map[string][]*config.ProxyRule)
	l4RulesMap         = make(map[string]*config.ProxyRule)
	routingMu          sync.RWMutex

	listeners   = make(map[string]*http.Server)
	listenerTLS = make(map[string]bool)
	listenersMu sync.Mutex

	tcpListeners = make(map[string]context.CancelFunc)
	udpListeners = make(map[string]context.CancelFunc)
	layer4Mu     sync.Mutex

	handler      *gin.Engine
	proxyHandler http.Handler
	certCache    = make(map[string]tls.Certificate)
	certCacheMu  sync.RWMutex

	fnosCertPath = "/usr/trim/etc/network_cert_all.conf"

	shutdownCtx    context.Context
	shutdownCancel context.CancelFunc

	// 监听错误状态：address -> error message
	listenErrors sync.Map
)

func Init() {
	loadProxies()
	loadFnOSCerts()
	shutdownCtx, shutdownCancel = context.WithCancel(context.Background())
}

func Shutdown() {
	if shutdownCancel != nil {
		shutdownCancel()
	}
	listenersMu.Lock()
	defer listenersMu.Unlock()
	for addr, srv := range listeners {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		srv.Shutdown(ctx)
		cancel()
		fmt.Printf("Stopped proxy listener on %s\n", addr)
	}
	listeners = make(map[string]*http.Server)
	listenerTLS = make(map[string]bool)

	layer4Mu.Lock()
	defer layer4Mu.Unlock()
	for _, cancel := range tcpListeners {
		cancel()
	}
	for _, cancel := range udpListeners {
		cancel()
	}
	tcpListeners = make(map[string]context.CancelFunc)
	udpListeners = make(map[string]context.CancelFunc)
}

// buildListenAddr 根据 SourceHost 和 SourcePort 构建监听地址
// SourceHost 为空时监听所有接口 (0.0.0.0)
func buildListenAddr(host, port string) string {
	if port == "" {
		return ":0"
	}
	if host != "" {
		return net.JoinHostPort(host, port)
	}
	if len(port) > 0 && port[0] != ':' {
		return ":" + port
	}
	return port
}

// setListenError 记录监听错误
func setListenError(addr string, err error) {
	if err != nil {
		listenErrors.Store(addr, err.Error())
	} else {
		listenErrors.Delete(addr)
	}
}

// GetListenErrors 返回所有监听错误状态
func GetListenErrors() map[string]string {
	result := make(map[string]string)
	listenErrors.Range(func(key, value any) bool {
		result[key.(string)] = value.(string)
		return true
	})
	return result
}

func loadFnOSCerts() {
	certCacheMu.Lock()
	defer certCacheMu.Unlock()
	certCache = make(map[string]tls.Certificate)

	data, err := os.ReadFile(fnosCertPath)
	if err != nil {
		return
	}
	var certs []fnosCert
	if err := json.Unmarshal(data, &certs); err != nil {
		return
	}
	for _, c := range certs {
		certPath := c.Certificate
		if c.Fullchain != "" {
			certPath = c.Fullchain
		}
		keyPath := c.PrivateKey
		if certPath == "" || keyPath == "" || !fileExists(certPath) || !fileExists(keyPath) {
			fmt.Printf("WARNING: Cert loading skipped for domain '%s': cert=%s key=%s exists=%v\n",
				c.Domain, certPath, keyPath, fileExists(certPath) && fileExists(keyPath))
			continue
		}
		cert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			fmt.Printf("WARNING: Failed to load cert for domain '%s': %v\n", c.Domain, err)
			continue
		}
		domains := append([]string{c.Domain}, c.SAN...)
		for _, d := range domains {
			certCache[strings.ToLower(d)] = cert
		}
		fmt.Printf("Loaded cert for domain '%s' with SAN: %v\n", c.Domain, c.SAN)
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func findCertForDomain(domain string) (tls.Certificate, bool) {
	lowerDomain := strings.ToLower(domain)

	certCacheMu.RLock()
	defer certCacheMu.RUnlock()

	fmt.Printf("[CERT-LOOKUP] Searching cert for domain='%s' (total cached: %d)\n",
		domain, len(certCache))

	bestCert := tls.Certificate{}
	bestPrecision := -1

	for pattern, cert := range certCache {
		p := certMatchPrecision(pattern, lowerDomain)
		if p >= 0 {
			fmt.Printf("[CERT-LOOKUP] pattern='%s' match precision=%d\n", pattern, p)
		}
		if p < 0 || (bestPrecision >= 0 && p >= bestPrecision) {
			continue
		}
		bestCert = cert
		bestPrecision = p
		if bestPrecision == 0 {
			break
		}
	}

	if bestPrecision >= 0 {
		fmt.Printf("[CERT-LOOKUP] FOUND cert for domain='%s' precision=%d\n", domain, bestPrecision)
		return bestCert, true
	}

	fmt.Printf("[CERT-LOOKUP] NOT FOUND for domain='%s', trying parent fallback...\n", domain)

	parentDomain := lowerDomain
	for {
		dotIdx := strings.Index(parentDomain, ".")
		if dotIdx < 0 {
			break
		}
		parentDomain = parentDomain[dotIdx+1:]
		if parentDomain == "" {
			break
		}
		if cert, ok := certCache[parentDomain]; ok {
			fmt.Printf("[CERT-LOOKUP] FOUND via parent fallback: '%s'\n", parentDomain)
			return cert, true
		}
	}

	fmt.Printf("[CERT-LOOKUP] FAIL: no certificate for domain='%s'\n", domain)
	return tls.Certificate{}, false
}

func certMatchPrecision(pattern, domain string) int {
	if pattern == domain {
		return 0
	}

	if !strings.HasPrefix(pattern, "*.") {
		return -1
	}

	suffix := pattern[2:]

	if !strings.HasSuffix(domain, suffix) {
		return -1
	}

	prefix := domain[:len(domain)-len(suffix)]
	if len(prefix) == 0 || strings.Contains(prefix, ".") {
		return -1
	}

	return 1
}

func loadProxies() {
	proxiesMu.Lock()
	defer proxiesMu.Unlock()
	routingMu.Lock()
	defer routingMu.Unlock()

	proxies = make(map[string]*httputil.ReverseProxy)
	domainExactMap = make(map[string]*config.ProxyRule)
	wildcardDomainList = nil
	portCatchAllMap = make(map[string]*config.ProxyRule)
	portRulesMap = make(map[string][]*config.ProxyRule)
	l4RulesMap = make(map[string]*config.ProxyRule)

	cfg := config.Get()
	for i := range cfg.Proxies {
		p := &cfg.Proxies[i]
		if !p.Enable || p.SourcePort == "" {
			continue
		}

		proto := strings.ToLower(strings.TrimSpace(p.SourceProtocol))
		if proto == "" {
			proto = "http"
		}

		if proto == "tcp" || proto == "udp" || proto == "tcp+udp" {
			portKey := proto + ":" + buildListenAddr(p.SourceHost, p.SourcePort)
			l4RulesMap[portKey] = p
			continue
		}

		if err := createProxy(p); err != nil {
			fmt.Printf("Failed to create proxy for rule %s: %v\n", p.Name, err)
			continue
		}

		addr := buildListenAddr(p.SourceHost, p.SourcePort)
		portKey := proto + ":" + addr
		shortPortKey := proto + ":" + p.SourcePort

		portRulesMap[portKey] = append(portRulesMap[portKey], p)
		if portKey != shortPortKey {
			portRulesMap[shortPortKey] = append(portRulesMap[shortPortKey], p)
		}

		if len(p.Domains) == 0 {
			portCatchAllMap[portKey] = p
			portCatchAllMap[shortPortKey] = p
			portCatchAllMap[addr] = p
			portCatchAllMap[":"+p.SourcePort] = p
		} else {
			for _, domain := range p.Domains {
				lowerDomain := strings.ToLower(strings.TrimSpace(domain))
				if lowerDomain == "" {
					continue
				}
				if strings.HasPrefix(lowerDomain, "*.") {
					wildcardDomainList = append(wildcardDomainList, WildcardDomainRule{
						Protocol: proto,
						Port:     p.SourcePort,
						Pattern:  lowerDomain,
						Rule:     p,
					})
				} else {
					domainExactMap[proto+":"+p.SourcePort+":"+lowerDomain] = p
					domainExactMap[p.SourcePort+":"+lowerDomain] = p
					domainExactMap[lowerDomain] = p
				}
			}
		}
	}
}

func createProxy(p *config.ProxyRule) error {
	realTargetProtocol := p.TargetProtocol
	if realTargetProtocol == "" {
		realTargetProtocol = "http"
	}

	var targetURL *url.URL
	var err error

	if realTargetProtocol == "unix" {
		targetURL, err = url.Parse("http://localhost")
	} else {
		scheme := realTargetProtocol
		switch scheme {
		case "ws":
			scheme = "http"
		case "wss":
			scheme = "https"
		}
		targetURL, err = url.Parse(fmt.Sprintf("%s://%s:%s", scheme, p.TargetHost, p.TargetPort))
	}
	if err != nil {
		return err
	}
	if p.Target == "" && (p.TargetHost == "" || (p.TargetPort == "" && realTargetProtocol != "unix")) {
		return fmt.Errorf("no target specified for rule %s", p.Name)
	}

	rp := httputil.NewSingleHostReverseProxy(targetURL)

	timeout := 30 * time.Second
	if p.Timeout != "" {
		if d, err := time.ParseDuration(p.Timeout); err == nil && d > 0 {
			timeout = d
		} else if sec, err := strconv.Atoi(p.Timeout); err == nil && sec > 0 {
			timeout = time.Duration(sec) * time.Second
		}
	}
	rp.Transport = &http.Transport{
		ResponseHeaderTimeout: timeout,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if realTargetProtocol == "unix" {
				return (&net.Dialer{Timeout: timeout}).DialContext(ctx, "unix", p.TargetHost)
			}
			return (&net.Dialer{Timeout: timeout}).DialContext(ctx, network, addr)
		},
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	originalDirector := rp.Director

	// 预解析信任网段，避免每次请求重复解析
	var trustedNets []*net.IPNet
	for _, cidr := range p.TrustedCIDRs {
		_, ipNet, err := net.ParseCIDR(cidr)
		if err == nil {
			trustedNets = append(trustedNets, ipNet)
		}
	}

	rp.Director = func(req *http.Request) {
		originalDirector(req)
		if !p.PreserveHost {
			req.Host = targetURL.Host
		}
		for k, v := range p.SetHeaders {
			if strings.ToLower(k) == "host" {
				req.Host = v
			} else {
				req.Header.Set(k, v)
			}
		}
		for _, k := range p.RemoveHeaders {
			if strings.ToLower(k) == "host" {
				// Cannot remove Host field, ignore
			} else {
				req.Header.Del(k)
			}
		}
		if req.Header.Get("X-Forwarded-Proto") == "" {
			proto := p.SourceProtocol
			if proto == "" {
				if req.TLS != nil {
					proto = "https"
				} else {
					proto = "http"
				}
			}
			req.Header.Set("X-Forwarded-Proto", proto)
		}

		// 真实IP传递
		if p.AddRealIP {
			headerName := p.RealIPHeader
			if headerName == "" {
				headerName = "X-Real-IP"
			}
			if req.Header.Get(headerName) == "" {
				realIP := resolveRealIP(req, trustedNets)
				if realIP != "" {
					req.Header.Set(headerName, realIP)
				}
			}
		}
	}

	rp.ModifyResponse = func(resp *http.Response) error {
		if p.HSTS {
			resp.Header.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		return nil
	}

	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		statusCode := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) {
			statusCode = http.StatusGatewayTimeout
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(statusCode)
		html := fmt.Sprintf(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>%d %s</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f8f9fa; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .error-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
        h1 { color: #dc3545; font-size: 48px; margin: 0 0 10px; }
        h2 { color: #333; font-size: 20px; margin: 0 0 20px; }
        p { color: #6c757d; font-size: 15px; line-height: 1.6; margin-bottom: 30px; }
        .btn { display: inline-block; background: #667eea; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; transition: background 0.3s; }
        .btn:hover { background: #5a6cd6; }
    </style>
</head>
<body>
    <div class="error-card">
        <h1>%d</h1>
        <h2>%s</h2>
        <p>目标服务当前不可达 (Target Unreachable)。<br>它可能正在重启或已离线，请稍后再试或联系管理员排查后端服务状态。</p>
        <a href="javascript:location.reload()" class="btn">刷新重试</a>
    </div>
</body>
</html>
`, statusCode, http.StatusText(statusCode), statusCode, http.StatusText(statusCode))
		w.Write([]byte(html))
	}

	proxies[p.ID] = rp
	return nil
}

func GetListenAddrs() []ListenAddr {
	routingMu.RLock()
	defer routingMu.RUnlock()

	type portInfo struct {
		addr      string
		enableTLS bool
	}
	portInfos := make(map[string]*portInfo)

	for portKey, rules := range portRulesMap {
		proto := "http"
		if strings.HasPrefix(portKey, "https:") {
			proto = "https"
		}
		for _, rule := range rules {
			addr := buildListenAddr(rule.SourceHost, rule.SourcePort)
			info, ok := portInfos[addr]
			if !ok {
				info = &portInfo{addr: addr, enableTLS: proto == "https"}
				portInfos[addr] = info
			}
			if proto == "https" {
				info.enableTLS = true
			}

			if rule.ForceHTTPS {
				addr80 := buildListenAddr(rule.SourceHost, "80")
				if _, ok80 := portInfos[addr80]; !ok80 {
					portInfos[addr80] = &portInfo{addr: addr80, enableTLS: false}
				}
			}
		}
	}

	var addrs []ListenAddr
	for _, info := range portInfos {
		addrs = append(addrs, ListenAddr{
			Addr:      info.addr,
			EnableTLS: info.enableTLS,
		})
	}
	return addrs
}

func Reload() {
	loadProxies()
	loadFnOSCerts()
	SyncListeners()
}

func SetHandler(h *gin.Engine) {
	handler = h

	// 性能优化:
	// 原来的 gin.CreateTestContext 会在"每次"请求时创建一个全新的 gin.Engine 实例，
	// 在高并发反向代理场景下会导致海量的内存分配和 GC 压力。
	// 这里预先创建一个干净的、独立的 Engine，专门用来处理代理流量，
	// 既实现了和 h (API路由) 的物理隔离，又完美利用了 Gin 内置的 sync.Pool 上下文复用。
	proxyEngine := gin.New()
	proxyEngine.Use(gin.Recovery()) // 防止单个代理请求的 panic 导致整个进程崩溃
	proxyEngine.NoRoute(Handler)

	proxyHandler = proxyEngine
}

func SyncListeners() {
	if handler == nil {
		return
	}

	addrs := GetListenAddrs()

	listenersMu.Lock()
	defer listenersMu.Unlock()

	active := make(map[string]bool)
	for _, la := range addrs {
		active[la.Addr] = true

		if existingTLS, ok := listenerTLS[la.Addr]; ok && existingTLS == la.EnableTLS {
			continue
		}

		if oldSrv, exists := listeners[la.Addr]; exists {
			go func(s *http.Server) {
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				s.Shutdown(ctx)
				cancel()
			}(oldSrv)
		}

		srv := &http.Server{Handler: proxyHandler}
		listeners[la.Addr] = srv
		listenerTLS[la.Addr] = la.EnableTLS

		go func(la ListenAddr, srv *http.Server) {
			var listener net.Listener
			var err error

			listener, err = net.Listen("tcp", la.Addr)
			if err != nil {
				fmt.Printf("Failed to listen on %s: %v\n", la.Addr, err)
				setListenError(la.Addr, err)
				return
			}
			setListenError(la.Addr, nil) // 监听成功，清除错误

			if la.EnableTLS {
				tlsConf := &tls.Config{
					GetCertificate: func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
						if hello.ServerName != "" {
							if cert, ok := findCertForDomain(hello.ServerName); ok {
								return &cert, nil
							}
						}
						return nil, fmt.Errorf("no certificate for %s", hello.ServerName)
					},
				}
				listener = tls.NewListener(listener, tlsConf)
			}

			fmt.Printf("Proxy listening on %s (TLS=%v)\n", la.Addr, la.EnableTLS)
			if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
				fmt.Printf("Listener on %s error: %v\n", la.Addr, err)
			}
		}(la, srv)
	}

	for addr, srv := range listeners {
		if !active[addr] {
			go func(a string, s *http.Server) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				s.Shutdown(ctx)
				cancel()
				fmt.Printf("Stopped proxy listener on %s\n", a)
			}(addr, srv)
			delete(listeners, addr)
			delete(listenerTLS, addr)
			listenErrors.Delete(addr) // 清除已停止监听的错误状态
		}
	}

	activeTCP := make(map[string]bool)
	activeUDP := make(map[string]bool)

	routingMu.RLock()
	for key, rule := range l4RulesMap {
		if rule.SourceProtocol == "tcp" || rule.SourceProtocol == "tcp+udp" {
			activeTCP[key] = true
			layer4Mu.Lock()
			if _, exists := tcpListeners[key]; !exists {
				ctx, cancel := context.WithCancel(context.Background())
				tcpListeners[key] = cancel
				go startTCPProxy(ctx, rule, key)
			}
			layer4Mu.Unlock()
		}
		if rule.SourceProtocol == "udp" || rule.SourceProtocol == "tcp+udp" {
			activeUDP[key] = true
			layer4Mu.Lock()
			if _, exists := udpListeners[key]; !exists {
				ctx, cancel := context.WithCancel(context.Background())
				udpListeners[key] = cancel
				go startUDPProxy(ctx, rule, key)
			}
			layer4Mu.Unlock()
		}
	}
	routingMu.RUnlock()

	layer4Mu.Lock()
	for key, cancel := range tcpListeners {
		if !activeTCP[key] {
			cancel()
			delete(tcpListeners, key)
			listenErrors.Delete(key)
			fmt.Printf("Stopped TCP proxy listener for rule key %s\n", key)
		}
	}
	for key, cancel := range udpListeners {
		if !activeUDP[key] {
			cancel()
			delete(udpListeners, key)
			listenErrors.Delete(key)
			fmt.Printf("Stopped UDP proxy listener for rule key %s\n", key)
		}
	}
	layer4Mu.Unlock()
}

func matchIP(pattern string, ip net.IP) bool {
	if strings.Contains(pattern, "/") {
		_, ipNet, err := net.ParseCIDR(pattern)
		if err == nil {
			return ipNet.Contains(ip)
		}
	} else {
		target := net.ParseIP(pattern)
		if target != nil {
			return target.Equal(ip)
		}
	}
	return false
}

func checkIPAccess(clientIP net.IP, proxyRule *config.ProxyRule) error {
	if clientIP != nil {
		if len(proxyRule.AllowIPs) > 0 {
			allowed := false
			for _, cidr := range proxyRule.AllowIPs {
				if matchIP(cidr, clientIP) {
					allowed = true
					break
				}
			}
			if !allowed {
				return errors.New("Access Denied by AllowIPs")
			}
		}
		if len(proxyRule.BlockIPs) > 0 {
			for _, cidr := range proxyRule.BlockIPs {
				if matchIP(cidr, clientIP) {
					return errors.New("Access Denied by BlockIPs")
				}
			}
		}
	}
	return nil
}

// resolveRealIP 从 X-Forwarded-For / X-Real-IP 等头部解析真实客户端IP
// 当配置了 TrustedCIDRs 时，仅信任来自这些网段的代理服务器转发的头部
func resolveRealIP(req *http.Request, trustedNets []*net.IPNet) string {
	remoteIP, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		remoteIP = req.RemoteAddr
	}
	parsedRemoteIP := net.ParseIP(remoteIP)
	if parsedRemoteIP == nil {
		return remoteIP
	}

	// 如果没有配置信任网段，直接返回连接IP
	if len(trustedNets) == 0 {
		return remoteIP
	}

	// 检查连接IP是否在信任网段内
	trusted := false
	for _, cidr := range trustedNets {
		if cidr.Contains(parsedRemoteIP) {
			trusted = true
			break
		}
	}
	if !trusted {
		return remoteIP
	}

	// 从 X-Forwarded-For 提取最左边的非信任IP
	xff := req.Header.Get("X-Forwarded-For")
	if xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			ipStr := strings.TrimSpace(parts[i])
			ip := net.ParseIP(ipStr)
			if ip == nil {
				break
			}
			isTrusted := false
			for _, cidr := range trustedNets {
				if cidr.Contains(ip) {
					isTrusted = true
					break
				}
			}
			if !isTrusted {
				return ipStr
			}
		}
	}

	return remoteIP
}

// checkUserAgent 检查 User-Agent 是否通过过滤
func checkUserAgent(ua string, rule *config.ProxyRule) bool {
	if rule.UserAgentMode == "" {
		return true
	}
	if len(rule.UserAgentList) == 0 {
		return true
	}

	contains := false
	for _, keyword := range rule.UserAgentList {
		if strings.Contains(ua, keyword) {
			contains = true
			break
		}
	}

	switch rule.UserAgentMode {
	case "whitelist":
		return contains
	case "blacklist":
		return !contains
	default:
		return true
	}
}

func startTCPProxy(ctx context.Context, rule *config.ProxyRule, portMapKey string) {
	addr := buildListenAddr(rule.SourceHost, rule.SourcePort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Printf("Failed to listen on TCP %s: %v\n", addr, err)
		setListenError(portMapKey, err)
		return
	}
	setListenError(portMapKey, nil)
	fmt.Printf("TCP Proxy listening on %s\n", addr)

	go func() {
		<-ctx.Done()
		listener.Close()
	}()

	for {
		clientConn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				break
			}
			continue
		}

		go func(c net.Conn) {
			defer c.Close()
			if tcpConn, ok := c.(*net.TCPConn); ok {
				tcpConn.SetKeepAlive(true)
				tcpConn.SetKeepAlivePeriod(30 * time.Second)
			}

			clientIPStr := c.RemoteAddr().(*net.TCPAddr).IP
			if err := checkIPAccess(clientIPStr, rule); err != nil {
				return
			}

			targetAddr := rule.TargetHost
			if rule.TargetPort != "" {
				targetAddr = net.JoinHostPort(rule.TargetHost, rule.TargetPort)
			}
			network := "tcp"
			if rule.TargetProtocol == "unix" {
				network = "unix"
				targetAddr = rule.TargetHost
			}

			backendConn, err := net.DialTimeout(network, targetAddr, 10*time.Second)
			if err != nil {
				return
			}
			defer backendConn.Close()
			if tcpBackend, ok := backendConn.(*net.TCPConn); ok {
				tcpBackend.SetKeepAlive(true)
				tcpBackend.SetKeepAlivePeriod(30 * time.Second)
			}

			go io.Copy(backendConn, c)
			io.Copy(c, backendConn)
		}(clientConn)
	}
}

func startUDPProxy(ctx context.Context, rule *config.ProxyRule, portMapKey string) {
	addr := buildListenAddr(rule.SourceHost, rule.SourcePort)
	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		fmt.Printf("Failed to resolve UDP %s: %v\n", addr, err)
		setListenError(portMapKey, err)
		return
	}
	conn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		fmt.Printf("Failed to listen on UDP %s: %v\n", addr, err)
		setListenError(portMapKey, err)
		return
	}
	setListenError(portMapKey, nil)
	fmt.Printf("UDP Proxy listening on %s\n", addr)

	go func() {
		<-ctx.Done()
		conn.Close()
	}()

	targetAddr := rule.TargetHost
	if rule.TargetPort != "" {
		targetAddr = net.JoinHostPort(rule.TargetHost, rule.TargetPort)
	}
	targetUDPAddr, err := net.ResolveUDPAddr("udp", targetAddr)
	if err != nil {
		fmt.Printf("Failed to resolve target UDP %s: %v\n", targetAddr, err)
		return
	}

	type session struct {
		backendConn *net.UDPConn
		lastActive  time.Time
	}
	var sessions sync.Map

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				sessions.Range(func(key, value any) bool {
					value.(*session).backendConn.Close()
					return true
				})
				return
			case <-ticker.C:
				now := time.Now()
				sessions.Range(func(key, value any) bool {
					s := value.(*session)
					if now.Sub(s.lastActive) > 60*time.Second {
						s.backendConn.Close()
						sessions.Delete(key)
					}
					return true
				})
			}
		}
	}()

	buf := make([]byte, 65507)
	for {
		n, clientAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				break
			}
			continue
		}

		if err := checkIPAccess(clientAddr.IP, rule); err != nil {
			continue
		}

		key := clientAddr.String()
		v, ok := sessions.Load(key)
		if !ok {
			backendConn, err := net.DialUDP("udp", nil, targetUDPAddr)
			if err != nil {
				continue
			}
			s := &session{backendConn: backendConn, lastActive: time.Now()}
			sessions.Store(key, s)
			v = s

			go func(client string, bc *net.UDPConn, cAddr *net.UDPAddr) {
				defer func() {
					bc.Close()
					sessions.Delete(client)
				}()
				bBuf := make([]byte, 65507)
				for {
					bc.SetReadDeadline(time.Now().Add(60 * time.Second))
					bn, err := bc.Read(bBuf)
					if err != nil {
						break
					}
					if sObj, ok := sessions.Load(client); ok {
						sObj.(*session).lastActive = time.Now()
					}
					conn.WriteToUDP(bBuf[:bn], cAddr)
				}
			}(key, backendConn, clientAddr)
		}

		s := v.(*session)
		s.lastActive = time.Now()
		s.backendConn.Write(buf[:n])
	}
}

func matchWildcardDomain(pattern, domain string) bool {
	pattern = strings.ToLower(pattern)
	domain = strings.ToLower(domain)
	if pattern == domain {
		return true
	}
	if !strings.HasPrefix(pattern, "*.") {
		return false
	}
	suffix := pattern[1:] // ".example.com"
	if !strings.HasSuffix(domain, suffix) {
		return false
	}
	prefix := domain[:len(domain)-len(suffix)]
	return len(prefix) > 0 && !strings.Contains(prefix, ".")
}

func parseHostAndPort(rawHost string, isTLS bool) (host, port string) {
	if strings.Contains(rawHost, ":") {
		h, p, err := net.SplitHostPort(rawHost)
		if err == nil {
			return strings.ToLower(strings.Trim(h, "[]")), p
		}
	}
	h := strings.ToLower(strings.Trim(rawHost, "[]"))
	if isTLS {
		return h, "443"
	}
	return h, "80"
}

func Handler(c *gin.Context) {
	isTLS := c.Request.TLS != nil
	domain, port := parseHostAndPort(c.Request.Host, isTLS)
	proto := "http"
	if isTLS {
		proto = "https"
	}

	routingMu.RLock()
	var proxyRule *config.ProxyRule

	// 1. 精确域名匹配（优先按 proto:port:domain 匹配，再按 port:domain 匹配，最后按 domain 匹配）
	if r, ok := domainExactMap[proto+":"+port+":"+domain]; ok {
		proxyRule = r
	} else if r, ok := domainExactMap[port+":"+domain]; ok {
		proxyRule = r
	} else if r, ok := domainExactMap[domain]; ok {
		proxyRule = r
	}

	// 2. 泛域名匹配
	if proxyRule == nil {
		for _, wr := range wildcardDomainList {
			if (wr.Port == "" || wr.Port == port) && (wr.Protocol == "" || wr.Protocol == proto) {
				if matchWildcardDomain(wr.Pattern, domain) {
					proxyRule = wr.Rule
					break
				}
			}
		}
	}

	// 3. 端口兜底规则 / 默认路由
	if proxyRule == nil {
		portKey := proto + ":" + port
		if r, ok := portCatchAllMap[portKey]; ok {
			proxyRule = r
		} else if r, ok := portCatchAllMap[":"+port]; ok {
			proxyRule = r
		} else if rules, ok := portRulesMap[portKey]; ok && len(rules) == 1 {
			proxyRule = rules[0]
		}
	}
	routingMu.RUnlock()

	if proxyRule == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": fmt.Sprintf("No proxy rule found for host: %s (port: %s, proto: %s)", c.Request.Host, port, proto),
		})
		return
	}

	proxiesMu.RLock()
	rp, ok := proxies[proxyRule.ID]
	proxiesMu.RUnlock()

	if !ok {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Proxy not initialized for rule: " + proxyRule.Name,
		})
		return
	}

	clientIP := net.ParseIP(c.ClientIP())
	if err := checkIPAccess(clientIP, proxyRule); err != nil {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	// User-Agent 过滤
	if !checkUserAgent(c.Request.UserAgent(), proxyRule) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied by UserAgent"})
		return
	}

	if proxyRule.ForceHTTPS && c.Request.TLS == nil {
		host := c.Request.Host
		if strings.Contains(host, ":") {
			host = strings.Split(host, ":")[0]
		}
		// 如果规则配置了非 443 的 HTTPS 端口，重定向时附带该端口
		httpsTarget := host
		if proxyRule.SourceProtocol == "https" && proxyRule.SourcePort != "" && proxyRule.SourcePort != "443" && proxyRule.SourcePort != "80" {
			httpsTarget = net.JoinHostPort(host, proxyRule.SourcePort)
		}
		targetURL := "https://" + httpsTarget + c.Request.URL.RequestURI()
		c.Redirect(http.StatusMovedPermanently, targetURL)
		return
	}

	if proxyRule.MaxBodySize > 0 {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, proxyRule.MaxBodySize*1024*1024)
	}

	// Fix for 304 Not Modified or responses without body
	// gin.ResponseWriter delays WriteHeader until Write is called.
	// If no body is written, headers are never flushed, causing empty 200 OK responses.
	defer func() {
		if !c.Writer.Written() {
			c.Writer.WriteHeaderNow()
		}
	}()

	rp.ServeHTTP(c.Writer, c.Request)
}

func GetCertStatus() map[string]interface{} {
	certCacheMu.RLock()
	defer certCacheMu.RUnlock()

	result := make(map[string]interface{})
	result["total_certs"] = len(certCache)
	result["domains"] = make([]string, 0, len(certCache))
	for domain := range certCache {
		result["domains"] = append(result["domains"].([]string), domain)
	}
	result["fnos_cert_file"] = fnosCertPath
	result["fnos_cert_exists"] = fileExists(fnosCertPath)
	result["manual_cert"] = false
	return result
}

func ReadFnOSCertsJSON() ([]byte, error) {
	return os.ReadFile(fnosCertPath)
}

type TestResult struct {
	Success   bool   `json:"success"`
	LatencyMs int64  `json:"latencyMs"`
	Message   string `json:"message"`
}

func TestTargetConnection(proto, host, port string, timeoutSec int) TestResult {
	if timeoutSec <= 0 {
		timeoutSec = 5
	}
	timeout := time.Duration(timeoutSec) * time.Second
	proto = strings.ToLower(strings.TrimSpace(proto))
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)

	start := time.Now()

	if proto == "unix" {
		if host == "" {
			return TestResult{Success: false, Message: "Unix Socket 路径不能为空"}
		}
		conn, err := net.DialTimeout("unix", host, timeout)
		latency := time.Since(start).Milliseconds()
		if err != nil {
			return TestResult{Success: false, LatencyMs: latency, Message: fmt.Sprintf("连接 Unix Socket 失败: %v", err)}
		}
		conn.Close()
		return TestResult{Success: true, LatencyMs: latency, Message: "Unix Socket 连接成功"}
	}

	if host == "" {
		return TestResult{Success: false, Message: "目标主机不能为空"}
	}
	if port == "" {
		return TestResult{Success: false, Message: "目标端口不能为空"}
	}

	targetAddr := net.JoinHostPort(host, port)

	if proto == "udp" {
		uAddr, err := net.ResolveUDPAddr("udp", targetAddr)
		if err != nil {
			return TestResult{Success: false, Message: fmt.Sprintf("解析 UDP 地址失败: %v", err)}
		}
		conn, err := net.DialUDP("udp", nil, uAddr)
		latency := time.Since(start).Milliseconds()
		if err != nil {
			return TestResult{Success: false, LatencyMs: latency, Message: fmt.Sprintf("连接 UDP 失败: %v", err)}
		}
		conn.Close()
		return TestResult{Success: true, LatencyMs: latency, Message: "UDP 地址解析成功"}
	}

	conn, err := net.DialTimeout("tcp", targetAddr, timeout)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return TestResult{Success: false, LatencyMs: latency, Message: fmt.Sprintf("连接目标失败 (%s): %v", targetAddr, err)}
	}
	conn.Close()
	return TestResult{Success: true, LatencyMs: latency, Message: fmt.Sprintf("连接成功 (%s)，延迟 %d ms", targetAddr, latency)}
}

type CertDetail struct {
	Domain      string   `json:"domain"`
	SAN         []string `json:"san"`
	Certificate string   `json:"certificate"`
	Exists      bool     `json:"exists"`
}

func GetCertsList() []CertDetail {
	data, err := os.ReadFile(fnosCertPath)
	if err != nil {
		return []CertDetail{}
	}
	var certs []fnosCert
	if err := json.Unmarshal(data, &certs); err != nil {
		return []CertDetail{}
	}
	var res []CertDetail
	for _, c := range certs {
		certPath := c.Certificate
		if c.Fullchain != "" {
			certPath = c.Fullchain
		}
		res = append(res, CertDetail{
			Domain:      c.Domain,
			SAN:         c.SAN,
			Certificate: certPath,
			Exists:      fileExists(certPath) && fileExists(c.PrivateKey),
		})
	}
	return res
}
