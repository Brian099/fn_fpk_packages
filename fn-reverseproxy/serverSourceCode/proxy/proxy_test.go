package proxy

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"

	"fn-reverseproxy/config"

	"github.com/gin-gonic/gin"
)

func TestMatchWildcardDomain(t *testing.T) {
	cases := []struct {
		pattern string
		domain  string
		matched bool
	}{
		{"*.example.com", "api.example.com", true},
		{"*.example.com", "web.example.com", true},
		{"*.example.com", "example.com", false},
		{"*.example.com", "a.b.example.com", false},
		{"*.example.com", "notexample.com", false},
		{"exact.com", "exact.com", true},
		{"exact.com", "other.com", false},
	}

	for _, c := range cases {
		got := matchWildcardDomain(c.pattern, c.domain)
		if got != c.matched {
			t.Errorf("matchWildcardDomain(%q, %q) = %v; want %v", c.pattern, c.domain, got, c.matched)
		}
	}
}

func TestCheckIPAccess(t *testing.T) {
	rule := &config.ProxyRule{
		AllowIPs: []string{"192.168.1.0/24", "10.0.0.1"},
		BlockIPs: []string{"192.168.1.100"},
	}

	// Allowed IP
	ip1 := net.ParseIP("192.168.1.50")
	if err := checkIPAccess(ip1, rule); err != nil {
		t.Errorf("Expected 192.168.1.50 to be allowed, got error: %v", err)
	}

	// Blocked IP (within allow range but in block list)
	ip2 := net.ParseIP("192.168.1.100")
	if err := checkIPAccess(ip2, rule); err == nil {
		t.Errorf("Expected 192.168.1.100 to be blocked, got nil")
	}

	// Not in allow list
	ip3 := net.ParseIP("172.16.0.1")
	if err := checkIPAccess(ip3, rule); err == nil {
		t.Errorf("Expected 172.16.0.1 to be denied, got nil")
	}
}

func TestCheckUserAgent(t *testing.T) {
	// Whitelist mode
	ruleWhitelist := &config.ProxyRule{
		UserAgentMode: "whitelist",
		UserAgentList: []string{"Googlebot", "Baiduspider"},
	}
	if !checkUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)", ruleWhitelist) {
		t.Errorf("Expected Googlebot to pass whitelist")
	}
	if checkUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", ruleWhitelist) {
		t.Errorf("Expected standard browser to be blocked in whitelist mode")
	}

	// Blacklist mode
	ruleBlacklist := &config.ProxyRule{
		UserAgentMode: "blacklist",
		UserAgentList: []string{"sqlmap", "curl"},
	}
	if checkUserAgent("curl/7.68.0", ruleBlacklist) {
		t.Errorf("Expected curl to be blocked in blacklist mode")
	}
	if !checkUserAgent("Mozilla/5.0 (Windows NT 10.0)", ruleBlacklist) {
		t.Errorf("Expected standard browser to pass blacklist mode")
	}
}

func TestResolveRealIP(t *testing.T) {
	_, trustedNet, _ := net.ParseCIDR("10.0.0.0/8")

	req1, _ := http.NewRequest("GET", "http://example.com", nil)
	req1.RemoteAddr = "10.0.0.5:12345"
	req1.Header.Set("X-Forwarded-For", "203.0.113.195, 10.0.0.1")

	realIP1 := resolveRealIP(req1, []*net.IPNet{trustedNet})
	if realIP1 != "203.0.113.195" {
		t.Errorf("Expected real IP 203.0.113.195, got %s", realIP1)
	}

	// Untrusted proxy remote addr
	req2, _ := http.NewRequest("GET", "http://example.com", nil)
	req2.RemoteAddr = "198.51.100.1:12345"
	req2.Header.Set("X-Forwarded-For", "203.0.113.195")

	realIP2 := resolveRealIP(req2, []*net.IPNet{trustedNet})
	if realIP2 != "198.51.100.1" {
		t.Errorf("Expected remote addr 198.51.100.1 because proxy is untrusted, got %s", realIP2)
	}
}

func TestParseHostAndPort(t *testing.T) {
	cases := []struct {
		rawHost string
		isTLS   bool
		expHost string
		expPort string
	}{
		{"example.com:8080", false, "example.com", "8080"},
		{"example.com:8443", true, "example.com", "8443"},
		{"example.com", false, "example.com", "80"},
		{"example.com", true, "example.com", "443"},
		{"[::1]:8080", false, "::1", "8080"},
		{"[::1]", true, "::1", "443"},
		{"192.168.1.1:80", false, "192.168.1.1", "80"},
	}

	for _, c := range cases {
		h, p := parseHostAndPort(c.rawHost, c.isTLS)
		if h != c.expHost || p != c.expPort {
			t.Errorf("parseHostAndPort(%q, %v) = (%q, %q); want (%q, %q)",
				c.rawHost, c.isTLS, h, p, c.expHost, c.expPort)
		}
	}
}

type closeNotifyRecorder struct {
	*httptest.ResponseRecorder
	closed chan bool
}

func newCloseNotifyRecorder() *closeNotifyRecorder {
	return &closeNotifyRecorder{
		ResponseRecorder: httptest.NewRecorder(),
		closed:           make(chan bool, 1),
	}
}

func (c *closeNotifyRecorder) CloseNotify() <-chan bool {
	return c.closed
}

func TestHandler_RoutingAndSecurity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.NoRoute(Handler)

	// Set up backend mock target server
	backendTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("X-Backend-Received-Host", req.Host)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Hello from backend!"))
	}))
	defer backendTarget.Close()

	backendURL, _ := url.Parse(backendTarget.URL)

	// Manually set up routing rules
	rule1 := &config.ProxyRule{
		ID:             "rule-site1",
		Name:           "Site1",
		Enable:         true,
		SourceProtocol: "http",
		SourcePort:     "80",
		Domains:        []string{"site1.example.com"},
		TargetHost:     backendURL.Hostname(),
		TargetPort:     backendURL.Port(),
	}

	ruleWildcard := &config.ProxyRule{
		ID:             "rule-wildcard",
		Name:           "Wildcard",
		Enable:         true,
		SourceProtocol: "http",
		SourcePort:     "80",
		Domains:        []string{"*.wildcard.com"},
		TargetHost:     backendURL.Hostname(),
		TargetPort:     backendURL.Port(),
	}

	ruleBlockedIP := &config.ProxyRule{
		ID:             "rule-blocked",
		Name:           "BlockedIPRule",
		Enable:         true,
		SourceProtocol: "http",
		SourcePort:     "80",
		Domains:        []string{"blocked.example.com"},
		BlockIPs:       []string{"127.0.0.1"},
		TargetHost:     backendURL.Hostname(),
		TargetPort:     backendURL.Port(),
	}

	ruleForceHTTPS := &config.ProxyRule{
		ID:             "rule-force-https",
		Name:           "ForceHTTPSRule",
		Enable:         true,
		SourceProtocol: "https",
		SourcePort:     "8443",
		Domains:        []string{"secure.example.com"},
		ForceHTTPS:     true,
		TargetHost:     backendURL.Hostname(),
		TargetPort:     backendURL.Port(),
	}

	rp := httputil.NewSingleHostReverseProxy(backendURL)

	proxiesMu.Lock()
	proxies[rule1.ID] = rp
	proxies[ruleWildcard.ID] = rp
	proxies[ruleBlockedIP.ID] = rp
	proxies[ruleForceHTTPS.ID] = rp
	proxiesMu.Unlock()

	routingMu.Lock()
	domainExactMap["http:80:site1.example.com"] = rule1
	domainExactMap["80:site1.example.com"] = rule1
	domainExactMap["site1.example.com"] = rule1

	domainExactMap["http:80:blocked.example.com"] = ruleBlockedIP
	domainExactMap["blocked.example.com"] = ruleBlockedIP

	domainExactMap["https:8443:secure.example.com"] = ruleForceHTTPS
	domainExactMap["8443:secure.example.com"] = ruleForceHTTPS
	domainExactMap["http:80:secure.example.com"] = ruleForceHTTPS
	domainExactMap["secure.example.com"] = ruleForceHTTPS

	wildcardDomainList = []WildcardDomainRule{
		{Protocol: "http", Port: "80", Pattern: "*.wildcard.com", Rule: ruleWildcard},
	}
	routingMu.Unlock()

	// 1. Test exact domain match
	req1 := httptest.NewRequest("GET", "http://site1.example.com/api/test", nil)
	w1 := newCloseNotifyRecorder()
	r.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Errorf("Expected status 200 for site1.example.com, got %d", w1.Code)
	}

	// 2. Test wildcard domain match
	req2 := httptest.NewRequest("GET", "http://api.wildcard.com/items", nil)
	w2 := newCloseNotifyRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Errorf("Expected status 200 for api.wildcard.com, got %d", w2.Code)
	}

	// 3. Test unknown domain returns 404
	req3 := httptest.NewRequest("GET", "http://unknown.com/test", nil)
	w3 := newCloseNotifyRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusNotFound {
		t.Errorf("Expected status 404 for unknown.com, got %d", w3.Code)
	}

	// 4. Test IP block access control
	req4 := httptest.NewRequest("GET", "http://blocked.example.com/data", nil)
	req4.RemoteAddr = "127.0.0.1:12345"
	w4 := newCloseNotifyRecorder()
	r.ServeHTTP(w4, req4)
	if w4.Code != http.StatusForbidden {
		t.Errorf("Expected status 403 for blocked IP, got %d", w4.Code)
	}

	// 5. Test ForceHTTPS redirection on non-standard port 8443
	req5 := httptest.NewRequest("GET", "http://secure.example.com/login", nil)
	w5 := newCloseNotifyRecorder()
	r.ServeHTTP(w5, req5)
	if w5.Code != http.StatusMovedPermanently {
		t.Errorf("Expected 301 redirect for ForceHTTPS, got %d", w5.Code)
	}
	loc := w5.Header().Get("Location")
	if loc != "https://secure.example.com:8443/login" {
		t.Errorf("Expected redirect Location to https://secure.example.com:8443/login, got %q", loc)
	}
}


