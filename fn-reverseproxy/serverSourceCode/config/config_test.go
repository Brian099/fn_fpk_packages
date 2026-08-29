package config

import (
	"testing"
)

func resetConfigForTest() {
	configMu.Lock()
	defer configMu.Unlock()
	config = &Config{
		Proxies: []ProxyRule{},
	}
}

func TestValidateProxy_Basic(t *testing.T) {
	resetConfigForTest()

	// Empty name
	err := ValidateProxy(ProxyRule{
		SourcePort: "80",
		TargetHost: "127.0.0.1",
		TargetPort: "8080",
	}, "")
	if err == nil {
		t.Errorf("Expected error for empty name, got nil")
	}

	// Invalid source port
	err = ValidateProxy(ProxyRule{
		Name:       "Test",
		SourcePort: "99999",
		TargetHost: "127.0.0.1",
		TargetPort: "8080",
	}, "")
	if err == nil {
		t.Errorf("Expected error for invalid source port, got nil")
	}

	// Unix socket target without port should succeed
	err = ValidateProxy(ProxyRule{
		Name:           "UnixProxy",
		SourcePort:     "8080",
		TargetProtocol: "unix",
		TargetHost:     "/tmp/app.sock",
	}, "")
	if err != nil {
		t.Errorf("Expected success for unix socket target without port, got: %v", err)
	}
}

func TestValidateProxy_SNIMultiDomainSharing(t *testing.T) {
	resetConfigForTest()

	// Add Rule 1: HTTPS:443 with site1.com
	rule1 := ProxyRule{
		ID:             "rule-1",
		Name:           "Site1",
		SourceProtocol: "https",
		SourcePort:     "443",
		Domains:        []string{"site1.example.com"},
		TargetHost:     "192.168.1.10",
		TargetPort:     "8080",
	}
	if err := ValidateProxy(rule1, ""); err != nil {
		t.Fatalf("Failed to validate rule 1: %v", err)
	}
	AddProxy(rule1)

	// Add Rule 2: HTTPS:443 with site2.com -> SHOULD BE ALLOWED (SNI multi-domain sharing)
	rule2 := ProxyRule{
		ID:             "rule-2",
		Name:           "Site2",
		SourceProtocol: "https",
		SourcePort:     "443",
		Domains:        []string{"site2.example.com", "sub.site2.example.com"},
		TargetHost:     "192.168.1.11",
		TargetPort:     "8080",
	}
	if err := ValidateProxy(rule2, ""); err != nil {
		t.Errorf("Expected Rule 2 to be valid on same 443 port with different domains, got error: %v", err)
	}
	AddProxy(rule2)

	// Add Rule 3: HTTPS:443 with overlapping domain site1.example.com -> MUST FAIL
	rule3 := ProxyRule{
		ID:             "rule-3",
		Name:           "Site3",
		SourceProtocol: "https",
		SourcePort:     "443",
		Domains:        []string{"site1.example.com"},
		TargetHost:     "192.168.1.12",
		TargetPort:     "8080",
	}
	if err := ValidateProxy(rule3, ""); err == nil {
		t.Errorf("Expected error for overlapping domain on HTTPS:443, got nil")
	}

	// Add Rule 4: HTTPS:443 with empty domains (catch-all) -> MUST FAIL (since specific domains already exist)
	rule4 := ProxyRule{
		ID:             "rule-4",
		Name:           "CatchAll",
		SourceProtocol: "https",
		SourcePort:     "443",
		Domains:        []string{},
		TargetHost:     "192.168.1.13",
		TargetPort:     "8080",
	}
	if err := ValidateProxy(rule4, ""); err == nil {
		t.Errorf("Expected error for catch-all rule on 443 with existing domain rules, got nil")
	}
}

func TestValidateProxy_Layer4Exclusivity(t *testing.T) {
	resetConfigForTest()

	// Add TCP rule on 3306
	tcpRule := ProxyRule{
		ID:             "tcp-1",
		Name:           "MySQL Forward",
		SourceProtocol: "tcp",
		SourcePort:     "3306",
		TargetHost:     "192.168.1.50",
		TargetPort:     "3306",
	}
	if err := ValidateProxy(tcpRule, ""); err != nil {
		t.Fatalf("Failed to validate TCP rule: %v", err)
	}
	AddProxy(tcpRule)

	// Try to add another rule on TCP 3306 -> MUST FAIL
	tcpRule2 := ProxyRule{
		ID:             "tcp-2",
		Name:           "MySQL Forward 2",
		SourceProtocol: "tcp",
		SourcePort:     "3306",
		TargetHost:     "192.168.1.51",
		TargetPort:     "3306",
	}
	if err := ValidateProxy(tcpRule2, ""); err == nil {
		t.Errorf("Expected error for duplicate TCP 3306 port, got nil")
	}

	// Try to add HTTP rule on 3306 -> MUST FAIL
	httpRule := ProxyRule{
		ID:             "http-1",
		Name:           "HTTP on 3306",
		SourceProtocol: "http",
		SourcePort:     "3306",
		TargetHost:     "192.168.1.52",
		TargetPort:     "80",
	}
	if err := ValidateProxy(httpRule, ""); err == nil {
		t.Errorf("Expected error for L4 and L7 collision on port 3306, got nil")
	}
}
