package proxy

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
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

var (
	proxies     = make(map[string]*httputil.ReverseProxy)
	proxiesMu   sync.RWMutex
	domainMap   = make(map[string]*config.ProxyRule)
	domainMapMu sync.RWMutex
	portMap     = make(map[string]*config.ProxyRule)
	portMapMu   sync.RWMutex

	listeners   = make(map[string]*http.Server)
	listenerTLS = make(map[string]bool)
	listenersMu sync.Mutex

	handler      *gin.Engine
	proxyHandler http.Handler
	certCache    = make(map[string]tls.Certificate)
	certCacheMu  sync.RWMutex

	fnosCertPath = "/usr/trim/etc/network_cert_all.conf"

	shutdownCtx    context.Context
	shutdownCancel context.CancelFunc
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
	domainMapMu.Lock()
	defer domainMapMu.Unlock()
	portMapMu.Lock()
	defer portMapMu.Unlock()

	proxies = make(map[string]*httputil.ReverseProxy)
	domainMap = make(map[string]*config.ProxyRule)
	portMap = make(map[string]*config.ProxyRule)

	cfg := config.Get()
	for i := range cfg.Proxies {
		p := &cfg.Proxies[i]
		if !p.Enable || p.SourcePort == "" {
			continue
		}
		createProxy(p)
	}
}

func createProxy(p *config.ProxyRule) error {
	targetProtocol := p.TargetProtocol
	if targetProtocol == "" {
		targetProtocol = "http"
	}
	targetURL, err := url.Parse(fmt.Sprintf("%s://%s:%s", targetProtocol, p.TargetHost, p.TargetPort))
	if err != nil {
		return err
	}
	if p.Target == "" && (p.TargetHost == "" || p.TargetPort == "") {
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
		DialContext:           (&net.Dialer{Timeout: timeout}).DialContext,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	rp.Director = func(req *http.Request) {
		req.URL.Scheme = targetURL.Scheme
		req.URL.Host = targetURL.Host
		if !p.PreserveHost {
			req.Host = targetURL.Host
		}
	}

	proxies[p.ID] = rp

	for _, domain := range p.Domains {
		lowerDomain := strings.ToLower(domain)
		if existing, exists := domainMap[lowerDomain]; exists && existing.ID != p.ID {
			fmt.Printf("WARNING: Domain '%s' conflict between rules '%s' and '%s'. Rule '%s' will be used.\n",
				domain, existing.Name, p.Name, p.Name)
		}
		domainMap[lowerDomain] = p
	}

	sourceProto := p.SourceProtocol
	if sourceProto == "" {
		sourceProto = "http"
	}
	portKey := sourceProto + ":" + p.SourcePort

	if existing, exists := portMap[portKey]; exists && existing.ID != p.ID {
		fmt.Printf("WARNING: Port '%s' conflict between rules '%s' and '%s'. Rule '%s' will be used.\n",
			portKey, existing.Name, p.Name, p.Name)
	}
	portMap[portKey] = p

	return nil
}

func GetListenAddrs() []ListenAddr {
	portMapMu.RLock()
	defer portMapMu.RUnlock()

	type portInfo struct {
		addr      string
		enableTLS bool
	}
	portInfos := make(map[string]*portInfo)

	for key, rule := range portMap {
		proto := "http"
		if len(key) > 0 && key[:5] == "https" {
			proto = "https"
		}
		addr := rule.SourcePort
		if len(addr) > 0 && addr[0] != ':' {
			addr = ":" + addr
		}
		info, ok := portInfos[addr]
		if !ok {
			info = &portInfo{addr: addr, enableTLS: proto == "https"}
			portInfos[addr] = info
		}
		if proto == "http" {
			info.enableTLS = false
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
	proxyHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, _ := gin.CreateTestContext(w)
		c.Request = r
		Handler(c)
	})
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
				return
			}

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
		}
	}
}

func Handler(c *gin.Context) {
	hostParts := strings.Split(c.Request.Host, ":")
	domain := hostParts[0]

	domainMapMu.RLock()
	proxyRule, ok := domainMap[strings.ToLower(domain)]
	domainMapMu.RUnlock()

	if !ok {
		port := ""
		if len(hostParts) > 1 {
			port = hostParts[1]
		}

		portMapMu.RLock()
		proxyRule, ok = portMap[port]
		if !ok {
			protocol := "http"
			if c.Request.TLS != nil {
				protocol = "https"
			}
			proxyRule, ok = portMap[protocol+":"+port]
		}
		portMapMu.RUnlock()
	}

	if !ok {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "No proxy rule found for host: " + c.Request.Host,
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
