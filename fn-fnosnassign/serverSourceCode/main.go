package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

const (
	defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.95 Safari/537.36"
)

// Helper function to decode GBK HTML response to UTF-8 string
func decodeResponse(resp *http.Response) (io.Reader, error) {
	contentType := resp.Header.Get("Content-Type")
	contentType = strings.ToLower(contentType)

	if strings.Contains(contentType, "gbk") || strings.Contains(contentType, "gb2312") {
		// Decode GBK to UTF-8
		return transform.NewReader(resp.Body, simplifiedchinese.GBK.NewDecoder()), nil
	}
	return resp.Body, nil
}

// StreamLogger is a helper to write log lines to both HTTP response and local log file
type StreamLogger struct {
	httpWriter http.ResponseWriter
	flusher    http.Flusher
	logFile    *os.File
	mu         sync.Mutex
}

func NewStreamLogger(w http.ResponseWriter, lf *os.File) *StreamLogger {
	flusher, _ := w.(http.Flusher)
	return &StreamLogger{
		httpWriter: w,
		flusher:    flusher,
		logFile:    lf,
	}
}

func (sl *StreamLogger) Write(p []byte) (n int, err error) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	// Write to console/log file
	if sl.logFile != nil {
		_, _ = sl.logFile.Write(p)
	}

	// Write to HTTP response (chunked)
	if sl.httpWriter != nil {
		n, err = sl.httpWriter.Write(p)
		if sl.flusher != nil {
			sl.flusher.Flush()
		}
		return n, err
	}
	return len(p), nil
}

func main() {
	// 1. Define command-line flags
	configPath := flag.String("config", "", "Path to the configuration file (JSON or YAML)")
	flag.StringVar(configPath, "c", "", "Path to the configuration file (JSON or YAML) (shorthand)")
	sockPath := flag.String("sock", "", "Path to the UNIX domain socket to run the web server on")
	flag.Parse()

	// If no config file is specified, check default paths
	if *configPath == "" {
		if _, err := os.Stat("config.json"); err == nil {
			*configPath = "config.json"
		} else if _, err := os.Stat("config.yaml"); err == nil {
			*configPath = "config.yaml"
		} else if _, err := os.Stat("config.yml"); err == nil {
			*configPath = "config.yml"
		} else {
			// In server mode, config might be initialized later, so default to config.yaml
			*configPath = "config.yaml"
		}
	}

	// Check if running in server mode (socket specified)
	if *sockPath != "" {
		startServer(*sockPath, *configPath)
		return
	}

	// CLI Mode: Single execution
	fmt.Printf("Loading configuration from: %s...\n", *configPath)
	config, err := LoadConfig(*configPath)
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	err = RunSignIn(config, os.Stdout)
	if err != nil {
		fmt.Printf("\n签到失败: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("\n签到流程执行完成！")
}

// RunSignIn executes the sign-in logic using the provided configuration, writing output to out
func RunSignIn(config *Config, out io.Writer) error {
	if config.Cookie == "" && (config.Username == "" || config.Password == "") {
		return fmt.Errorf("either 'cookie' or both 'username' and 'password' must be provided in config file")
	}

	baseURL := strings.TrimSuffix(config.BaseURL, "/")
	fmt.Fprintf(out, "[%s] 开始签到任务...\n", time.Now().Format("2006-01-02 15:04:05"))
	fmt.Fprintf(out, "站点基础地址: %s\n", baseURL)

	var (
		req         *http.Request
		resp        *http.Response
		decodedBody io.Reader
	)

	// 2. Initialize HTTP client with CookieJar for automatic session cookie handling
	jar, err := cookiejar.New(nil)
	if err != nil {
		return fmt.Errorf("failed to create cookie jar: %w", err)
	}

	client := &http.Client{
		Jar:     jar,
		Timeout: 15 * time.Second,
	}

	// Load pre-configured cookie if provided
	if config.Cookie != "" {
		u, err := url.Parse(baseURL)
		if err != nil {
			return fmt.Errorf("failed to parse base URL: %w", err)
		}
		var cookies []*http.Cookie
		parts := strings.Split(config.Cookie, ";")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			kv := strings.SplitN(part, "=", 2)
			if len(kv) == 2 {
				cookies = append(cookies, &http.Cookie{
					Name:   kv[0],
					Value:  kv[1],
					Domain: u.Host,
					Path:   "/",
				})
			}
		}
		jar.SetCookies(u, cookies)
		fmt.Fprintln(out, "使用配置的 Cookie 进行签到，跳过登录步骤。")
	} else {
		// Step 1: GET Login page to get formhash and loginhash
		loginPageURL := baseURL + "/member.php?mod=logging&action=login"
		fmt.Fprintf(out, "获取登录页面: %s...\n", loginPageURL)

		req, err = http.NewRequest("GET", loginPageURL, nil)
		if err != nil {
			return fmt.Errorf("failed to create login page request: %w", err)
		}
		req.Header.Set("User-Agent", defaultUserAgent)

		resp, err = client.Do(req)
		if err != nil {
			return fmt.Errorf("failed to fetch login page: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("failed to get login page, status code: %s", resp.Status)
		}

		// Decode response body if GBK
		decodedBody, err = decodeResponse(resp)
		if err != nil {
			return fmt.Errorf("failed to decode response: %w", err)
		}

		doc, err := goquery.NewDocumentFromReader(decodedBody)
		if err != nil {
			return fmt.Errorf("failed to parse HTML: %w", err)
		}

		// Extract formhash
		formhash, exists := doc.Find("input[name=formhash]").Attr("value")
		if !exists || formhash == "" {
			fmt.Fprintln(out, "[警告] 未能在登录页找到 'formhash'。")
		} else {
			fmt.Fprintf(out, "找到 formhash: %s\n", formhash)
		}

		// Extract loginhash
		var loginhash string
		doc.Find("form").Each(func(i int, s *goquery.Selection) {
			action, _ := s.Attr("action")
			if strings.Contains(action, "loginhash=") {
				index := strings.Index(action, "loginhash=")
				loginhash = action[index+len("loginhash="):]
				if idx := strings.Index(loginhash, "&"); idx != -1 {
					loginhash = loginhash[:idx]
				}
			}
		})

		if loginhash == "" {
			return fmt.Errorf("could not find 'loginhash' in login form action")
		}
		fmt.Fprintf(out, "找到 loginhash: %s\n", loginhash)

		// Step 2: POST Login data to authenticate
		loginSubmitURL := fmt.Sprintf("%s/member.php?mod=logging&action=login&loginsubmit=yes&loginhash=%s&inajax=1", baseURL, loginhash)
		fmt.Fprintf(out, "提交登录请求: %s...\n", loginSubmitURL)

		formData := url.Values{}
		formData.Set("formhash", formhash)
		formData.Set("referer", baseURL+"/./")
		formData.Set("username", config.Username)
		formData.Set("password", config.Password)
		formData.Set("questionid", "0")
		formData.Set("answer", "")

		req, err = http.NewRequest("POST", loginSubmitURL, strings.NewReader(formData.Encode()))
		if err != nil {
			return fmt.Errorf("failed to create login submit request: %w", err)
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("User-Agent", defaultUserAgent)
		req.Header.Set("Referer", loginPageURL)
		req.Header.Set("Origin", baseURL)

		resp, err = client.Do(req)
		if err != nil {
			return fmt.Errorf("failed to execute login request: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("login failed with status: %s", resp.Status)
		}

		decodedBody, err = decodeResponse(resp)
		if err != nil {
			return fmt.Errorf("failed to decode login response: %w", err)
		}

		loginResultBytes, _ := io.ReadAll(decodedBody)
		loginResultStr := string(loginResultBytes)

		if strings.Contains(loginResultStr, "欢迎您回来") || strings.Contains(loginResultStr, "login_succeed") || strings.Contains(loginResultStr, "succeed") {
			fmt.Fprintln(out, "登录成功！")
		} else if strings.Contains(loginResultStr, "error") || strings.Contains(loginResultStr, "失败") {
			fmt.Fprintln(out, "[提示] 登录返回可能包含错误，继续尝试访问打卡页...")
			if len(loginResultStr) > 200 {
				fmt.Fprintf(out, "返回片段: %s...\n", loginResultStr[:200])
			} else {
				fmt.Fprintf(out, "返回内容: %s\n", loginResultStr)
			}
		} else {
			fmt.Fprintln(out, "已发送登录请求，前往签到页面...")
		}
	}

	// Step 3: GET Sign-in page to extract the actual sign-in link
	signPageURL := baseURL + "/plugin.php?id=zqlj_sign"
	fmt.Fprintf(out, "访问签到页面: %s...\n", signPageURL)

	req, err = http.NewRequest("GET", signPageURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create sign-in page request: %w", err)
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Referer", baseURL+"/")

	resp, err = client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch sign-in page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to load sign-in page, status: %s", resp.Status)
	}

	decodedBody, err = decodeResponse(resp)
	if err != nil {
		return fmt.Errorf("failed to decode sign-in page: %w", err)
	}

	signDoc, err := goquery.NewDocumentFromReader(decodedBody)
	if err != nil {
		return fmt.Errorf("failed to parse sign-in page: %w", err)
	}

	var actionURL string
	signDoc.Find("a").Each(func(i int, s *goquery.Selection) {
		href, exists := s.Attr("href")
		if !exists {
			return
		}
		htmlContent, _ := s.Html()
		text := strings.TrimSpace(s.Text())

		if htmlContent == "     " || (strings.Contains(href, "id=zqlj_sign") && (strings.Contains(href, "sign") || text == "点击打卡" || s.HasClass("btna"))) {
			actionURL = href
		}
	})

	if actionURL == "" {
		pageText := signDoc.Text()
		title := signDoc.Find("title").Text()
		fmt.Fprintf(out, "[Debug] 页面标题: %s\n", title)

		if strings.Contains(pageText, "今天已签到") || strings.Contains(pageText, "已签到") || strings.Contains(pageText, "今天已") {
			fmt.Fprintln(out, "提示: 您今天已经完成过打卡签到了！")
			return nil
		}

		if strings.Contains(pageText, "您需要先登录") || strings.Contains(pageText, "请登录") || strings.Contains(pageText, "快捷登录") {
			return fmt.Errorf("cookie已失效或账号登录失败，页面提示需要登录")
		} else {
			return fmt.Errorf("未能在签到页面中找到打卡接口，可能Discuz!签到插件版本不匹配，或Cookie异常")
		}
	}

	if !strings.HasPrefix(actionURL, "http") {
		if strings.HasPrefix(actionURL, "/") {
			actionURL = baseURL + actionURL
		} else {
			actionURL = baseURL + "/" + actionURL
		}
	}
	fmt.Fprintf(out, "找到打卡请求URL: %s\n", actionURL)

	// Step 4: Execute the GET sign-in action
	fmt.Fprintln(out, "正在执行打卡动作...")
	req, err = http.NewRequest("GET", actionURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create sign-in execution request: %w", err)
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Referer", signPageURL)
	req.Header.Set("Origin", baseURL)

	resp, err = client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to execute sign-in request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("sign-in request failed with status: %s", resp.Status)
	}

	decodedBody, err = decodeResponse(resp)
	if err != nil {
		return fmt.Errorf("failed to decode sign-in response: %w", err)
	}

	signResultDoc, err := goquery.NewDocumentFromReader(decodedBody)
	if err != nil {
		return fmt.Errorf("failed to parse sign-in result page: %w", err)
	}

	messagetext := signResultDoc.Find("#messagetext")
	if messagetext.Length() > 0 {
		msg := messagetext.Find("p").First().Text()
		fmt.Fprintf(out, "签到返回消息: %s\n", msg)
	} else {
		bodyText := signResultDoc.Text()
		if strings.Contains(bodyText, "成功") || strings.Contains(bodyText, "恭喜") {
			fmt.Fprintln(out, "签到成功！(匹配到成功关键字)")
		} else if strings.Contains(bodyText, "今天已") {
			fmt.Fprintln(out, "提示: 今天已签到过！")
		} else {
			fmt.Fprintln(out, "打卡请求已发送，但未定位到确切结果提示信息。")
			if len(bodyText) > 200 {
				fmt.Fprintf(out, "页面内容摘要: %s\n", strings.Join(strings.Fields(bodyText), " ")[:200])
			} else {
				fmt.Fprintf(out, "页面内容: %s\n", bodyText)
			}
		}
	}

	return nil
}

var (
	cronMutex      sync.Mutex
	cronStopChan   chan struct{}
	activeCronExpr string
)

// matchCronField checks if a value matches a specific cron field (supports * and comma-separated lists like 12,20)
func matchCronField(val int, field string) bool {
	if field == "*" || field == "?" {
		return true
	}
	parts := strings.Split(field, ",")
	for _, p := range parts {
		if p == "" {
			continue
		}
		var parsed int
		_, err := fmt.Sscanf(p, "%d", &parsed)
		if err == nil && parsed == val {
			return true
		}
	}
	return false
}

// matchCron parses standard cron expression (supports 5-field and 6-field seconds-level cron)
func matchCron(t time.Time, expr string) bool {
	fields := strings.Fields(expr)
	if len(fields) < 5 {
		return false
	}

	var min, hour, dom, mon, dow string
	if len(fields) == 5 {
		min = fields[0]
		hour = fields[1]
		dom = fields[2]
		mon = fields[3]
		dow = fields[4]
	} else {
		// If 6 fields, the first is seconds (which we skip or assume matching the minute boundary),
		// followed by min, hour, dom, mon, dow.
		min = fields[1]
		hour = fields[2]
		dom = fields[3]
		mon = fields[4]
		dow = fields[5]
	}

	currentMin := t.Minute()
	currentHour := t.Hour()
	currentDom := t.Day()
	currentMon := int(t.Month())
	currentDow := int(t.Weekday())

	// Normalize Sunday (Go Weekday 0 corresponds to 0 or 7 in cron)
	if currentDow == 0 && (dow == "7" || dow == "0") {
		// Matches
	} else if !matchCronField(currentDow, dow) {
		return false
	}

	return matchCronField(currentMin, min) &&
		matchCronField(currentHour, hour) &&
		matchCronField(currentDom, dom) &&
		matchCronField(currentMon, mon)
}

// initCronScheduler parses the cron expression and registers the background loop in pure Go
func initCronScheduler(configPath string) {
	cronMutex.Lock()
	defer cronMutex.Unlock()

	// 1. Stop existing cron scheduler if running
	if cronStopChan != nil {
		close(cronStopChan)
		cronStopChan = nil
		activeCronExpr = ""
		fmt.Println("[Cron Info] Stopped active cron scheduler.")
	}

	// 2. Load configuration
	config, err := LoadConfig(configPath)
	if err != nil {
		fmt.Printf("[Cron Error] Failed to load config for cron initialization: %v\n", err)
		return
	}

	// 3. Check if cron is enabled
	if !config.CronEnabled {
		fmt.Println("[Cron Info] Auto sign-in cron scheduler is disabled.")
		return
	}

	if config.CronExpression == "" {
		fmt.Println("[Cron Info] Auto sign-in cron scheduler enabled but expression is empty.")
		return
	}

	activeCronExpr = config.CronExpression
	cronStopChan = make(chan struct{})
	stopChan := cronStopChan

	// 4. Start the scheduler background goroutine
	go func() {
		fmt.Printf("[Cron Info] Auto sign-in scheduler successfully started with expression: %q\n", activeCronExpr)
		
		// Tick every 30 seconds to stay aligned with the minute boundary,
		// and track last executed minute to prevent double triggers.
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		var lastExecutedMinute int = -1
		var lastExecutedDay int = -1

		for {
			select {
			case <-stopChan:
				fmt.Println("[Cron Info] Cron worker loop stopped.")
				return
			case now := <-ticker.C:
				currentMin := now.Minute()
				currentDay := now.YearDay()

				// Prevent running more than once per minute
				if currentMin == lastExecutedMinute && currentDay == lastExecutedDay {
					continue
				}

				if matchCron(now, activeCronExpr) {
					lastExecutedMinute = currentMin
					lastExecutedDay = currentDay

					// Trigger sign-in task asynchronously
					go func() {
						latestConfig, err := LoadConfig(configPath)
						if err != nil {
							fmt.Printf("[Cron Run Error] Failed to load latest config: %v\n", err)
							return
						}

						logPath := filepath.Join(filepath.Dir(configPath), "info.log")
						lf, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
						if err == nil {
							defer lf.Close()
							_, _ = lf.Write([]byte(fmt.Sprintf("\n--- 定时自动触发签到: %s ---\n", time.Now().Format("2006-01-02 15:04:05"))))
						}

						err = RunSignIn(latestConfig, lf)
						if err != nil {
							if lf != nil {
								_, _ = lf.Write([]byte(fmt.Sprintf("[定时错误] 签到失败: %v\n", err)))
							}
							fmt.Printf("[Cron Run Error] Auto sign-in failed: %v\n", err)
						} else {
							if lf != nil {
								_, _ = lf.Write([]byte("[定时成功] 自动打卡签到成功！\n"))
							}
							fmt.Println("[Cron Run Success] Auto sign-in succeeded!")
						}
					}()
				}
			}
		}
	}()
}

// findWWWDir searches for the static assets directory in various places
func findWWWDir() string {
	exePath, err := os.Executable()
	if err == nil {
		// 1. Check relative to binary inside FNOS app (e.g. app/server/amd64/fnosnassign_x86_64 -> app/www)
		dir := filepath.Dir(exePath)
		p1 := filepath.Join(dir, "../../www")
		if stat, err := os.Stat(p1); err == nil && stat.IsDir() {
			return p1
		}
		// 2. Check directly in siblings
		p2 := filepath.Join(dir, "www")
		if stat, err := os.Stat(p2); err == nil && stat.IsDir() {
			return p2
		}
	}

	// 3. Fallbacks
	paths := []string{"./app/www", "./www", "../www"}
	for _, p := range paths {
		if stat, err := os.Stat(p); err == nil && stat.IsDir() {
			abs, err := filepath.Abs(p)
			if err == nil {
				return abs
			}
			return p
		}
	}
	return "./www"
}

func startServer(sockPath, configPath string) {
	// Clean up socket file if it exists
	if _, err := os.Stat(sockPath); err == nil {
		_ = os.Remove(sockPath)
	}

	// Find the static www directory
	wwwPath := findWWWDir()
	fmt.Printf("Starting HTTP server on UNIX socket: %s\n", sockPath)
	fmt.Printf("Serving static files from: %s\n", wwwPath)
	fmt.Printf("Config path: %s\n", configPath)

	// Start the cron scheduler upon daemon startup
	initCronScheduler(configPath)

	mux := http.NewServeMux()

	// 1. Serve static files
	fileServer := http.FileServer(http.Dir(wwwPath))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Prevent folder listings or proxying problems - route to index.html if file doesn't exist
		path := filepath.Join(wwwPath, r.URL.Path)
		stat, err := os.Stat(path)
		if err != nil || stat.IsDir() {
			// If request is not an API request, serve index.html
			if !strings.HasPrefix(r.URL.Path, "/api/") {
				http.ServeFile(w, r, filepath.Join(wwwPath, "index.html"))
				return
			}
		}
		fileServer.ServeHTTP(w, r)
	})

	// 2. Load config API
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			config, err := LoadConfig(configPath)
			if err != nil {
				http.Error(w, fmt.Sprintf(`{"error": "Failed to load config: %v"}`, err), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(config)
		} else if r.Method == http.MethodPost {
			var config Config
			if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
				http.Error(w, `{"error": "Invalid request JSON"}`, http.StatusBadRequest)
				return
			}
			// Save config
			if err := SaveConfig(configPath, &config); err != nil {
				http.Error(w, fmt.Sprintf(`{"error": "Failed to save config: %v"}`, err), http.StatusInternalServerError)
				return
			}
			// Hot-reload cron scheduler
			initCronScheduler(configPath)
			w.Write([]byte(`{"status": "success", "message": "配置保存成功"}`))
		} else {
			http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	})

	// 3. Trigger sign-in API (Streams real-time console logs!)
	mux.HandleFunc("/api/sign", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Ensure config is loaded
		config, err := LoadConfig(configPath)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, fmt.Sprintf(`{"error": "Failed to load config: %v"}`, err), http.StatusInternalServerError)
			return
		}

		// Setup streaming headers
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Transfer-Encoding", "chunked")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)

		logPath := filepath.Join(filepath.Dir(configPath), "info.log")
		lf, _ := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if lf != nil {
			defer lf.Close()
			_, _ = lf.Write([]byte(fmt.Sprintf("\n--- 手动触发签到: %s ---\n", time.Now().Format("2006-01-02 15:04:05"))))
		}

		logger := NewStreamLogger(w, lf)

		err = RunSignIn(config, logger)
		if err != nil {
			fmt.Fprintf(logger, "\n[错误] 签到失败: %v\n", err)
		} else {
			fmt.Fprintln(logger, "\n[成功] 签到流程全部执行完成！")
		}
	})

	// 4. Load sign-in execution logs API
	mux.HandleFunc("/api/logs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		logPath := filepath.Join(filepath.Dir(configPath), "info.log")

		file, err := os.Open(logPath)
		if err != nil {
			if os.IsNotExist(err) {
				w.Write([]byte("暂无签到日志记录。"))
				return
			}
			http.Error(w, fmt.Sprintf("Failed to read log: %v", err), http.StatusInternalServerError)
			return
		}
		defer file.Close()

		// Read last 50KB to keep memory usage low
		stat, err := file.Stat()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get file stat: %v", err), http.StatusInternalServerError)
			return
		}

		size := stat.Size()
		var offset int64 = 0
		maxRead := int64(50 * 1024) // 50KB
		if size > maxRead {
			offset = size - maxRead
		}

		_, err = file.Seek(offset, io.SeekStart)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to seek file: %v", err), http.StatusInternalServerError)
			return
		}

		// Read and output the remainder
		_, _ = io.Copy(w, file)
	})

	// Listen on UNIX socket
	listener, err := net.Listen("unix", sockPath)
	if err != nil {
		fmt.Printf("Fatal error: Failed to listen on socket %s: %v\n", sockPath, err)
		os.Exit(1)
	}
	defer listener.Close()

	// Ensure permission is open for CGI proxy
	_ = os.Chmod(sockPath, 0777)

	// Run standard server
	server := &http.Server{
		Handler:      mux,
		ReadTimeout:  10 * time.Minute,
		WriteTimeout: 10 * time.Minute,
	}

	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Printf("Server failure: %v\n", err)
		os.Exit(1)
	}
}
