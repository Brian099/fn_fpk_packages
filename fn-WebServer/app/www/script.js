layui.use(['element', 'table', 'layer', 'form'], function () {
    var element = layui.element;
    var table = layui.table;
    var layer = layui.layer;
    var form = layui.form;
    var $ = layui.$;

    var apiBase = "/cgi/ThirdParty/WebServer/index.cgi";

    // --- Common Helpers ---
    function reloadSites() {
        table.reload('site-table');
    }

    function apiPost(url, body, successMsg, callback) {
        var loading = layer.load(2);
        fetch(apiBase + url, {
            method: "POST",
            body: body,
            headers: { "Content-Type": "text/plain" }
        })
            .then(res => res.json())
            .then(data => {
                layer.close(loading);
                if (data.ok || data.message) {
                    if (successMsg) layer.msg(successMsg, { icon: 1 });
                    if (callback) callback(data);
                } else {
                    layer.alert("操作失败: " + (data.error || "未知错误"), { icon: 2 });
                }
            })
            .catch(err => {
                layer.close(loading);
                layer.alert("请求失败: " + err.message, { icon: 2 });
            });
    }

    function apiJSON(url, method, data, successMsg, callback) {
        var loading = layer.load(2);
        var options = {
            method: method,
            headers: { "Content-Type": "application/json" }
        };
        if (data) options.body = JSON.stringify(data);

        fetch(apiBase + url, options)
            .then(res => res.json())
            .then(resData => {
                layer.close(loading);
                if (!resData.error) {
                    if (successMsg) layer.msg(successMsg, { icon: 1 });
                    if (callback) callback(resData);
                } else {
                    layer.alert("操作失败: " + (resData.error || "未知错误"), { icon: 2 });
                }
            })
            .catch(err => {
                layer.close(loading);
                layer.alert("请求失败: " + err.message, { icon: 2 });
            });
    }

    // --- Install Log Helper ---
    function showInstallLog(type, api, body, successMsg, callback) {
        var logContent = "";
        var logLayer = layer.open({
            type: 1,
            title: '安装进度日志',
            area: ['800px', '600px'],
            content: '<div style="padding:10px;background:#333;color:#eee;height:100%;box-sizing:border-box;overflow:auto;"><pre id="install-log-content" style="white-space:pre-wrap;word-break:break-all;font-family:monospace;"></pre></div>',
            btn: ['关闭'],
            yes: function (index) {
                layer.close(index);
            }
        });

        var logInterval = setInterval(function () {
            fetch(apiBase + "/api/install/log", {
                method: "POST",
                body: "type=" + type
            }).then(r => r.json()).then(d => {
                if (d.ok && d.log) {
                    $('#install-log-content').text(d.log);
                    var div = $('#install-log-content').parent()[0];
                    div.scrollTop = div.scrollHeight;
                }
            });
        }, 1000);

        // Start actual install
        fetch(apiBase + api, {
            method: "POST",
            body: body,
            headers: { "Content-Type": "text/plain" }
        }).then(r => r.json()).then(data => {
            clearInterval(logInterval);
            // Fetch log one last time
            fetch(apiBase + "/api/install/log", { method: "POST", body: "type=" + type })
                .then(r => r.json()).then(d => {
                    if (d.ok && d.log) {
                        $('#install-log-content').text(d.log);
                        if (data.ok) {
                            $('#install-log-content').append('\n\n[SUCCESS] ' + successMsg);
                        } else {
                            $('#install-log-content').append('\n\n[ERROR] ' + (data.error || "安装失败"));
                        }
                        var div = $('#install-log-content').parent()[0];
                        div.scrollTop = div.scrollHeight;
                    }
                });

            if (data.ok) {
                layer.msg(successMsg, { icon: 1 });
                if (callback) callback(data);
            } else {
                layer.alert("安装失败: " + (data.error || "未知错误") + "<br>请查看日志", { icon: 2 });
            }
        }).catch(err => {
            clearInterval(logInterval);
            layer.alert("请求失败: " + err.message, { icon: 2 });
        });
    }

    // --- Navigation Logic ---
    $('.layui-nav-item a').click(function () {
        var id = $(this).data('id');
        if (id) switchTab(id);
    });

    function switchTab(id) {
        // Hide all views
        $('#view-system, #view-sites, #view-proxies, #view-settings').hide();
        // Show target with vertical flex layout to prevent elements from sitting side-by-side
        $('#view-' + id).css('display', 'flex').css('flex-direction', 'column').show();

        // Breadcrumb removed as per user request

        // Load content if needed
        if (id === 'system') {
            loadStatus();
        } else if (id === 'sites') {
            // Table auto-renders, but maybe resize?
            table.resize('site-table');
        } else if (id === 'proxies') {
            reloadProxies();
            table.resize('proxy-table');
        } else if (id === 'settings') {
            loadUploadLimit();
        }
    }

    // --- System Environment ---
    function loadStatus() {
        // Update Hero Site Count
        fetch(apiBase + "/api/sites/list").then(r => r.json()).then(data => {
            if (Array.isArray(data)) {
                $('.layui-font-30').first().text(data.length); 
            }
        }).catch(err => console.error("Load count failed", err));
        
        // Web Server Driver
        fetch(apiBase + "/api/web-server/settings").then(r => r.json()).then(data => {
            if (data.ok) {
                window.currentWsType = data.type;
                form.val('form-driver-settings', { "ws_type": data.type });
                // Update Site Tips (legacy helper if still used)
                updateSiteFormTips();
                
                // Card order: highlight no longer needed, they are independent
                if (data.type === 'apache') {
                    $('#view-system-cards').css('flex-direction', 'row-reverse');
                } else {
                    $('#view-system-cards').css('flex-direction', 'row');
                }
            }
        });

        // Nginx
        fetch(apiBase + "/api/nginx/status").then(r => r.json()).then(data => {
            var el = $('#nginx-status');
            if (data.installed) {
                var statusColor = data.running ? '#5FB878' : '#FF5722';
                var statusText = data.running ? '运行中' : '未运行';
                var html = `<div style="color:${statusColor}"><i class="layui-icon ${data.running ? 'layui-icon-ok-circle' : 'layui-icon-close-fill'}"></i> ${statusText} (${data.version || ''})</div>`;
                html += data.config_exists ? '<div>配置文件: <span style="color:#5FB878">正常</span></div>' : '<div>配置文件: <span style="color:#FF5722">缺失</span></div>';
                el.html(html);
            } else {
                el.html('<span style="color:#FF5722">未检测到系统 Nginx</span><div style="font-size:12px;color:#999;margin-top:5px">请确保环境中已安装并启动 Nginx 服务</div>');
            }
        }).catch(() => $('#nginx-status').text('获取失败'));
        
        // Apache
        fetch(apiBase + "/api/apache/status").then(r => r.json()).then(data => {
            var el = $('#apache-status');
            if (data.installed) {
                var statusColor = data.running ? '#5FB878' : '#FF5722';
                var statusText = data.running ? '运行中' : '未运行';
                var html = `<div style="color:${statusColor}"><i class="layui-icon ${data.running ? 'layui-icon-ok-circle' : 'layui-icon-close-fill'}"></i> ${statusText} (${data.version || ''})</div>`;
                html += data.config_exists ? '<div>配置文件: <span style="color:#5FB878">正常</span></div>' : '<div>配置文件: <span style="color:#FF5722">缺失</span></div>';
                
                // Smart module detection UI
                if (data.modules) {
                    html += '<div style="margin-top:8px; display:flex; gap:4px; flex-wrap:wrap;">';
                    Object.keys(data.modules).forEach(m => {
                        var active = data.modules[m];
                        var color = active ? 'layui-bg-green' : 'layui-bg-orange';
                        var cursor = active ? 'default' : 'pointer';
                        var title = active ? '组件已就绪' : '组件缺失，点击查看修复命令';
                        html += `<span class="layui-badge ${color} mod-badge" data-mod="${m}" data-active="${active}" style="font-size:10px; cursor:${cursor};" title="${title}">${m}</span>`;
                    });
                    html += '</div>';
                }
                
                if (data.default_site_enabled) {
                    html += '<div style="margin-top:5px; color:#FFB800; font-size:11px;"><i class="layui-icon layui-icon-tips"></i> 检测到 000-default 启用，可能冲突</div>';
                }

                el.html(html);
                
                // Bind click events for badges
                el.find('.mod-badge').click(function() {
                    var m = $(this).data('mod');
                    var active = $(this).data('active');
                    if (!active) {
                        var cmd = `sudo a2enmod ${m} && sudo systemctl restart apache2`;
                        layer.alert(`检测到 Apache 核心组件 <b>${m}</b> 未启用。<br><br><b>修复建议：</b><br><code style="background:#f2f2f2;padding:4px;display:block;margin-top:5px;">${cmd}</code>`, {title: '环境体检建议', icon: 7});
                    }
                });
            } else {
                el.html('<span style="color:#999">未检测到系统 Apache</span>');
            }
        }).catch(() => $('#apache-status').text('获取失败'));

        // PHP
        fetch(apiBase + "/api/php/status").then(r => r.json()).then(data => {
            var el = $('#php-status');
            if (data.installed && data.versions && data.versions.length > 0) {
                var html = '';
                data.versions.forEach(v => {
                    var statusColor = v.running ? '#5FB878' : '#FF5722';
                    var statusText = v.running ? '运行中' : '未运行';
                    html += `<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #f6f6f6 last-child:border-0">
                                <span style="font-weight:bold; color:var(--primary-blue)">PHP ${v.version}</span> 
                                <span style="margin-left:10px; color:${statusColor}"><i class="layui-icon layui-icon-circle-dot"></i> ${statusText}</span>
                             </div>`;
                });
                el.html(html);
            } else {
                el.html('<span style="color:#FF5722">系统未检测到已安装的 PHP-FPM</span><div style="font-size:12px;color:#999;margin-top:5px">请手动通过 apt 安装所需版本</div>');
            }
        }).catch(() => $('#php-status').text('获取失败'));

        // Database
        fetch(apiBase + "/api/db/status").then(r => r.json()).then(data => {
            var el = $('#db-status');
            var bindDbEvents = function () {
                $('#btn-install-db').off('click').on('click', function () {
                    layer.prompt({ title: '请设置 MySQL root 密码', formType: 1 }, function (pass, index) {
                        layer.close(index);
                        if (!pass) return;
                        showInstallLog('db', "/api/db/install", "password=" + encodeURIComponent(pass), "安装完成", loadStatus);
                    });
                });
            };

            if (data.ok && data.databases && data.databases.length > 0) {
                var html = '';
                data.databases.forEach(db => {
                    var color = db.status === 'running' ? '#5FB878' : '#FFB800';
                    var icon = db.status === 'running' ? 'layui-icon-ok-circle' : 'layui-icon-about';
                    var typeLabel = db.type === 'system' ? '系统服务' : 'Docker容器';
                    var nameLabel = db.type === 'system' ? db.name.charAt(0).toUpperCase() + db.name.slice(1) : 'MySQL (Docker版)';

                    html += `<div style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #f6f6f6; last-child: border-bottom:0;">
                                <div style="color:${color}"><i class="layui-icon ${icon}"></i> <b>${nameLabel}</b> - ${db.status === 'running' ? '运行中' : '未运行'}</div>
                                <div style="margin-top:5px;font-size:12px;color:#666">类型: ${typeLabel}</div>`;

                    if (db.type === 'docker' && db.status === 'running') {
                        html += '<div style="margin-top:5px"><a href="http://' + window.location.hostname + ':8080" target="_blank" class="layui-btn layui-btn-xs layui-btn-normal">打开 phpMyAdmin</a></div>';
                    }
                    html += `</div>`;
                });

                // If NO docker db is managed, offer to install
                var hasDocker = data.databases.some(db => db.type === 'docker');
                if (!hasDocker) {
                    html += '<div style="margin-top:10px; color:#999; font-size:12px;">未检测到面板管理的 Docker 数据库</div>';
                    html += '<button class="layui-btn layui-btn-xs layui-btn-normal" style="margin-top:5px" id="btn-install-db">安装 Docker版数据库</button>';
                }
                el.html(html);
                bindDbEvents();
            } else {
                el.html('未发现数据库 <button class="layui-btn layui-btn-xs layui-btn-normal" id="btn-install-db">安装 Docker版数据库</button>');
                bindDbEvents();
            }
        }).catch(() => $('#db-status').text('获取失败'));
    }

    // --- Site Management ---
    table.render({
        elem: '#site-table',
        url: apiBase + '/api/sites',
        parseData: function (res) {
            var filteredData = (res || []).filter(function (item) {
                return item.name !== 'default';
            });
            $('#site-count').text(filteredData.length);
            $('#site-count-hero').text(filteredData.length);
            return {
                "code": 0,
                "msg": "",
                "count": filteredData.length,
                "data": filteredData
            };
        },
        cols: [[
            {
                field: 'name', title: '网站名称', width: 140, templet: function (d) {
                    var sslIcon = d.is_ssl ? ' <i class="layui-icon layui-icon-vercode" style="color:#5FB878; font-size:12px;" title="SSL已开启"></i>' : '';
                    return d.name + sslIcon;
                }
            },
            { field: 'mode', title: '类型', width: 70, templet: function (d) { return d.mode === 'domain' ? '域名' : '端口'; } },
            {
                field: 'port', title: '监听端口', width: 110, templet: function (d) {
                    if (d.port) return d.port.split(',').map(p => `<span class="layui-badge layui-bg-gray">${p}</span>`).join(' ');
                    return '-';
                }
            },
            {
                field: 'php', title: 'PHP版本', width: 90, templet: function (d) {
                    if (d.php === '-') return '-';
                    return `<span class="layui-badge layui-bg-blue" style="background-color: var(--primary-blue) !important;">${d.php}</span>`;
                }
            },
            { field: 'root', title: '根目录', minWidth: 150 },
            {
                field: 'enabled', title: '状态', width: 90, templet: function (d) {
                    return d.enabled ? '<span class="layui-badge layui-bg-green">已启用</span>' : '<span class="layui-badge layui-bg-orange">已停用</span>';
                }
            },
            { fixed: 'right', title: '操作', toolbar: '#site-bar', minWidth: 280 }
        ]],
        page: false,
        height: 'full-150', // Optimized offset further after breadcrumb removal
        text: { none: '暂无网站配置' }
    });

    // --- Site Filter Logic ---
    $('#search-sites').on('input', function () {
        var val = $(this).val().toLowerCase();
        // Use jQuery to show/hide rows in the currently rendered table body
        $('#site-table').next().find('.layui-table-body tbody tr').each(function () {
            var text = $(this).text().toLowerCase();
            $(this).toggle(text.indexOf(val) > -1);
        });
    });

    table.on('tool(site-table)', function (obj) {
        var data = obj.data;
        if (obj.event === 'del') {
            layer.confirm('确定删除网站 ' + data.name + '?', function (index) {
                layer.close(index);
                apiPost("/api/sites/delete", "name=" + encodeURIComponent(data.name), "删除成功", function () { reloadSites(); });
            });
        } else if (obj.event === 'edit-port') {
            openEditPortModal(data);
        } else if (obj.event === 'enable') {
            apiPost("/api/sites/enable", "name=" + encodeURIComponent(data.name), "已启用", function () { reloadSites(); });
        } else if (obj.event === 'disable') {
            apiPost("/api/sites/disable", "name=" + encodeURIComponent(data.name), "已停用", function () { reloadSites(); });
        } else if (obj.event === 'fix-permissions') {
            layer.confirm('确定修复网站目录权限? <br>将把目录所有者设为 www-data, 权限设为 755', function (index) {
                layer.close(index);
                apiPost("/api/sites/fix-permissions", "name=" + encodeURIComponent(data.name), "权限修复成功");
            });
        }
    });

    $('#btn-refresh').click(function () { reloadSites(); });


    // --- General Settings ---
    function loadUploadLimit() {
        var loading = layer.load();
        fetch(apiBase + "/api/settings/get-upload-limit").then(r => r.json()).then(data => {
            layer.close(loading);
            $('#input-upload-limit').val(data.ok ? data.limit : "");
        }).catch(() => { layer.close(loading); layer.msg('获取配置失败'); });
    }

    $('#btn-save-upload-limit').click(function () {
        var val = $('#input-upload-limit').val();
        if (!val) { layer.msg('请输入限制值'); return; }
        apiPost("/api/settings/set-upload-limit", "limit=" + encodeURIComponent(val), "修改成功");
    });

    // --- Advanced Service Controls ---
    $('.btn-service-restart').click(function () {
        var type = $(this).data('type');
        var name = type === 'nginx' ? 'Nginx' : 'Apache';
        var $btn = $(this);
        var $icon = $btn.find('i');
        
        layer.confirm(`确定要重启 ${name} 服务吗？此操作可能会中断现有连接。`, { icon: 3, title: '服务运维提示' }, function (index) {
            layer.close(index);
            
            // Start spinning animation
            $icon.addClass('layui-anim layui-anim-rotate layui-anim-loop');
            
            apiPost("/api/web-server/restart", "type=" + type, name + " 重启成功", function() {
                // Stop spinning
                $icon.removeClass('layui-anim layui-anim-rotate layui-anim-loop');
                loadStatus(); // Refresh status
            });
        });
    });


    // --- Create Site Logic (Keep as is) ---
    $('#btn-create-site').click(function () {
        // Check Nginx and PHP prerequisites
        var checkLoading = layer.load(2);
        Promise.all([
            fetch(apiBase + "/api/nginx/status").then(r => r.json()),
            fetch(apiBase + "/api/apache/status").then(r => r.json()),
            fetch(apiBase + "/api/php/status").then(r => r.json())
        ]).then(results => {
            layer.close(checkLoading);
            var nginxData = results[0];
            var apacheData = results[1];
            var phpData = results[2];

            if ((!nginxData.installed && !apacheData.installed) || !phpData.installed || !phpData.versions || phpData.versions.length === 0) {
                var msg = "缺少必要运行环境，无法创建网站：<br><br>";
                if (!nginxData.installed && !apacheData.installed) msg += "- <b style='color:#FF5722'>未检测到 Web 服务器</b> (Nginx 和 Apache 均未安装)<br>";
                if (!phpData.installed || !phpData.versions || phpData.versions.length === 0) msg += "- <b style='color:#FF5722'>PHP 未就绪</b> (未检测到可用的 PHP-FPM 版本)<br>";

                layer.alert(msg, {
                    icon: 7,
                    title: '环境检测未通过',
                    btn: ['去安装配置', '取消'],
                    yes: function (index) {
                        layer.close(index);
                        // Optional: redirect to a manager app if path known
                        layer.msg('请确保系统环境中已正确部署 Nginx 和 PHP');
                    }
                });
                return;
            }

            // Populate PHP versions
            var phpSelect = $('#select-php-version');
            phpSelect.empty();
            phpData.versions.forEach(v => {
                var label = 'PHP ' + v.version + (v.running ? '' : ' (服务未启动)');
                phpSelect.append(`<option value="${v.version}">${label}</option>`);
            });

            // Environment OK, proceed to open dialog
            form.val('form-create-site', {
                "name": "", "mode": "port", "domain": "", "port": "80",
                "use_http": true, "use_https": false, "port_ssl": "443",
                "ws_type": window.currentWsType || "nginx",
                "php_version": phpData.versions[0].version,
                "root": "", "rewrite": ""
            });

            // Handle server driver options availability
            $('input[name=ws_type][value=nginx]').attr('disabled', !nginxData.installed);
            $('input[name=ws_type][value=apache]').attr('disabled', !apacheData.installed);
            
            // Auto-fallback if the default driver is missing
            if (window.currentWsType === 'nginx' && !nginxData.installed && apacheData.installed) {
                form.val('form-create-site', { "ws_type": "apache" });
            } else if (window.currentWsType === 'apache' && !apacheData.installed && nginxData.installed) {
                form.val('form-create-site', { "ws_type": "nginx" });
            }

            form.render(); // Re-render to show disabled states
            
            $('input[name=mode][value=port]').prop('checked', true);
            form.render();
            updateCreateSiteVisibility("port");

            layer.open({
                type: 1, title: '新建网站', content: $('#tpl-create-site'), area: ['600px', '700px'],
                success: function () {
                    form.render();
                }
            });

        }).catch(err => {
            layer.close(checkLoading);
            layer.alert("环境检测失败，无法继续操作", { icon: 2 });
        });
    });

    // 绑定模式切换
    form.on('radio(site-mode)', function (data) {
        updateCreateSiteVisibility(data.value);
    });

    function updateCreateSiteVisibility(mode) {
        var $form = $('#tpl-create-site');
        if (mode === 'domain') {
            $form.find('#field-domain').show();
            $form.find('#field-port-group').hide();
        } else {
            $form.find('#field-domain').hide();
            $form.find('#field-port-group').show();
        }
    }

    form.on('submit(submit-create-site)', function (data) {
        var field = data.field;
        var mode = field.mode;
        var body = "mode=" + mode + "\nroot=" + field.root;
        if (field.name) body += "\nname=" + encodeURIComponent(field.name);
        if (field.ws_type) body += "\nws_type=" + field.ws_type;

        var useHttp, useHttps, p, ph;
        if (mode === 'domain') {
            if (!field.domain) { layer.msg('请输入域名'); return false; }
            body += "\ndomain=" + field.domain;
            useHttp = true; useHttps = true; p = "80"; ph = "443";
        } else {
            useHttp = field.use_http === "on" || field.use_http === true;
            useHttps = field.use_https === "on" || field.use_https === true;
            p = field.port; ph = field.port_ssl;
            if (!useHttp && !useHttps) { layer.msg('请至少选择一个监听端口 (HTTP 或 HTTPS)'); return false; }
            if (useHttp && !p) { layer.msg('请输入HTTP端口'); return false; }
            if (useHttps && !ph) { layer.msg('请输入HTTPS端口'); return false; }
        }

        body += "\nuse_http=" + (useHttp ? "true" : "false");
        body += "\nuse_https=" + (useHttps ? "true" : "false");
        if (useHttp) body += "\nport=" + p;
        if (useHttps) body += "\nport_https=" + ph;

        body += "\nphp_version=" + field.php_version;
        if (field.rewrite) body += "\nrewrite=" + encodeURIComponent(field.rewrite);

        apiPost("/api/sites/create", body, "创建成功", function () {
            layer.closeAll('page');
            reloadSites();
        });
        return false;
    });

    // --- Edit Port Logic ---
    function openEditPortModal(site) {
        form.val('form-edit-port', { "site_name": site.name, "port": "", "port_https": "" });
        var ports = (site.port || "").split(",");
        var httpPort = "", httpsPort = "";
        ports.forEach(function (p) {
            p = p.trim();
            if (p === "443" || p === "8443" || p === "2931") httpsPort = p;
            else if (!httpPort) httpPort = p;
            else if (!httpsPort) httpsPort = p;
        });
        form.val('form-edit-port', { "port": httpPort, "port_https": httpsPort });

        layer.open({ type: 1, title: '修改端口 - ' + site.name, content: $('#tpl-edit-port'), area: ['400px', '300px'] });
    }

    form.on('submit(submit-edit-port)', function (data) {
        var f = data.field;
        if (!f.port) { layer.msg('请输入HTTP端口'); return false; }
        var body = "name=" + encodeURIComponent(f.site_name) + "\nport=" + f.port;
        if (f.port_https) body += "\nport_https=" + f.port_https;

        apiPost("/api/sites/update-port", body, "修改成功", function () {
            layer.closeAll('page');
            reloadSites();
        });
        return false;
    });

    // --- Directory Selector ---
    var currentDirInputId = "";
    var dirSelectorIndex;
    $('#btn-browse-root').click(function () {
        currentDirInputId = "input-root-path";
        openDirSelector($('#input-root-path').val());
    });

    function openDirSelector(initialPath) {
        loadDirs(initialPath || "/");
        dirSelectorIndex = layer.open({ type: 1, title: '选择目录', content: $('#tpl-dir-selector'), area: ['500px', '400px'] });
    }

    $('#btn-dir-up').click(function () {
        var current = $('#dir-selector-current').val();
        var parent = current.replace(/[^/]+\/?$/, "");
        if (!parent) parent = "/";
        loadDirs(parent);
    });

    $('#btn-dir-confirm').click(function () {
        var selected = $('#dir-selector-current').val();
        if (currentDirInputId) $('#' + currentDirInputId).val(selected);
        if (dirSelectorIndex) layer.close(dirSelectorIndex);
    });

    function loadDirs(path) {
        $('#dir-selector-current').val(path);
        $('#dir-list-container').html('<div class="layui-icon layui-icon-loading"> 加载中...</div>');
        fetch(apiBase + "/api/fs/list", { method: "POST", body: path }).then(r => r.json()).then(data => {
            if (!data.ok) { $('#dir-list-container').text("错误: " + data.error); return; }
            $('#dir-selector-current').val(data.current);
            var html = "";
            if (data.dirs) {
                data.dirs.forEach(d => {
                    html += `<div class="dir-item" style="padding:5px; cursor:pointer; border-bottom:1px solid #f0f0f0;"><i class="layui-icon layui-icon-folder"></i> ${d}</div>`;
                });
            } else { html = "<div style='padding:10px; color:#999'>无子目录</div>"; }
            $('#dir-list-container').html(html);
            $('#dir-list-container .dir-item').click(function () {
                var name = $(this).text().trim();
                var cur = $('#dir-selector-current').val();
                loadDirs(cur.replace(/\/?$/, "/") + name);
            });
        }).catch(() => $('#dir-list-container').text("加载失败"));
    }

    // --- Proxy Management ---
    function reloadProxies() {
        table.reload('proxy-table');
    }

    table.render({
        elem: '#proxy-table',
        url: apiBase + '/api/proxies',
        parseData: function (res) {
            if (res) {
                $('#proxy-count').text(res.length || 0);
            }
            return {
                "code": 0,
                "msg": "",
                "count": res ? res.length : 0,
                "data": res || []
            };
        },
        cols: [[
            { field: 'name', title: '规则名称', width: 150 },
            {
                title: '来源 (监听)', width: 180, templet: function (d) {
                    var proto = (d.sourceProtocol || 'http').toUpperCase();
                    var color = proto === 'HTTPS' ? 'layui-bg-blue' : 'layui-bg-gray';
                    return `<span class="layui-badge ${color}">${proto}</span> :${d.sourcePort}`;
                }
            },
            {
                field: 'domains', title: '来源域名', minWidth: 200, templet: function (d) {
                    if (!d.domains) return '-';
                    return d.domains.map(dom => `<span class="layui-badge layui-bg-gray" style="margin-right:5px">${dom}</span>`).join('');
                }
            },
            {
                title: '目标 (后端)', minWidth: 200, templet: function (d) {
                    var proto = (d.targetProtocol || 'http').toUpperCase();
                    return `${proto}://${d.targetHost}:${d.targetPort}`;
                }
            },
            {
                field: 'enable', title: '状态', width: 90, templet: function (d) {
                    return d.enable ? '<span class="layui-badge layui-bg-green">已启用</span>' : '<span class="layui-badge layui-bg-orange">已停用</span>';
                }
            },
            { fixed: 'right', title: '操作', toolbar: '#proxy-bar', width: 180 }
        ]],
        page: false,
        height: 'full-150',
        text: { none: '暂无反向代理规则' }
    });

    $('#search-proxies').on('input', function () {
        var val = $(this).val().toLowerCase();
        $('#proxy-table').next().find('.layui-table-body tbody tr').each(function () {
            var text = $(this).text().toLowerCase();
            $(this).toggle(text.indexOf(val) > -1);
        });
    });

    table.on('tool(proxy-table)', function (obj) {
        var data = obj.data;
        if (obj.event === 'del') {
            layer.confirm('确定删除规则 ' + data.name + '?', function (index) {
                layer.close(index);
                apiJSON("/api/proxies/" + data.id, "DELETE", null, "删除成功", reloadProxies);
            });
        } else if (obj.event === 'edit') {
            openProxyModal(data);
        } else if (obj.event === 'enable') {
            var updateData = Object.assign({}, data, { enable: true });
            apiJSON("/api/proxies/" + data.id, "PUT", updateData, "已启用", reloadProxies);
        } else if (obj.event === 'disable') {
            var updateData = Object.assign({}, data, { enable: false });
            apiJSON("/api/proxies/" + data.id, "PUT", updateData, "已停用", reloadProxies);
        }
    });

    $('#btn-refresh-proxies').click(function () { reloadProxies(); });

    $('#btn-create-proxy').click(function () {
        openProxyModal();
    });

    function openProxyModal(data) {
        var isEdit = !!data;
        form.val('form-proxy', {
            "id": isEdit ? data.id : "",
            "name": isEdit ? data.name : "",
            "sourceProtocol": isEdit ? (data.sourceProtocol || "http") : "http",
            "sourcePort": isEdit ? data.sourcePort : "",
            "domains": isEdit ? (data.domains ? data.domains.join(',') : "") : "",
            "targetProtocol": isEdit ? (data.targetProtocol || "http") : "http",
            "targetPort": isEdit ? data.targetPort : "",
            "targetHost": isEdit ? data.targetHost : "127.0.0.1",
            "preserveHost": isEdit ? data.preserveHost : true,
            "hsts": isEdit ? data.hsts : false
        });
        form.render();

        layer.open({
            type: 1,
            title: isEdit ? '编辑代理规则' : '添加代理规则',
            content: $('#tpl-proxy-modal'),
            area: ['600px', '700px']
        });
    }

    form.on('submit(submit-proxy)', function (data) {
        var field = data.field;
        var rule = {
            name: field.name,
            enable: true,
            sourceProtocol: field.sourceProtocol,
            sourcePort: field.sourcePort,
            domains: field.domains.split(',').map(s => s.trim()).filter(s => s !== ""),
            targetProtocol: field.targetProtocol,
            targetHost: field.targetHost,
            targetPort: field.targetPort,
            preserveHost: field.preserveHost === "on" || field.preserveHost === true,
            hsts: field.hsts === "on" || field.hsts === true
        };

        if (field.id) {
            rule.id = field.id;
            apiJSON("/api/proxies/" + field.id, "PUT", rule, "保存成功", function () {
                layer.closeAll('page');
                reloadProxies();
            });
        } else {
            apiJSON("/api/proxies", "POST", rule, "添加成功", function () {
                layer.closeAll('page');
                reloadProxies();
            });
        }
        return false;
    });

    // --- Global Settings ---
    $('#btn-save-driver-settings').click(function () {
        var formData = form.val('form-driver-settings');
        var newType = formData.ws_type;

        var doSave = function () {
            apiJSON("/api/web-server/set-type", "POST", { type: newType }, "设置已更新", function () {
                loadStatus();
                layer.alert(`Web 服务器驱动已切换为 <b>${newType === 'apache' ? 'Apache' : 'Nginx'}</b>。<br><br>注意：切换驱动仅影响新创建的网站。现有网站配置不会自动迁移，您可能需要手动调整或重新创建站点。`, { icon: 1, title: '设置成功' });
            });
        };

        if (newType === 'apache') {
            // Pre-check Apache health before switching
            var loading = layer.load(2);
            fetch(apiBase + "/api/apache/status").then(r => r.json()).then(data => {
                layer.close(loading);
                if (data.installed) {
                    var missing = [];
                    if (data.modules) {
                        if (!data.modules.rewrite) missing.push('rewrite');
                        if (!data.modules.proxy_fcgi) missing.push('proxy_fcgi');
                    }
                    if (missing.length > 0) {
                        layer.confirm(`检测到 Apache 必要组件（<b>${missing.join(', ')}</b>）缺失，这可能导致站点运行异常。<br><br><b>确定要强制切换吗？</b>`, { icon: 0, title: '环境风险预警', btn: ['确认切换', '先去修复'] }, function (index) {
                            layer.close(index);
                            doSave();
                        });
                    } else {
                        doSave();
                    }
                } else {
                    layer.confirm('系统中尚未检测到 Apache 服务，确定要切换吗？', { icon: 7, title: '预警' }, function (index) {
                        layer.close(index);
                        doSave();
                    });
                }
            }).catch(() => {
                layer.close(loading);
                doSave();
            });
        } else {
            doSave();
        }
    });

    // --- Initialize ---
    switchTab('system'); // Clear state and show default tab

    // --- Help Center ---
    $('#btn-help').click(function () {
        var helpHtml = `
      <div style="padding: 25px; line-height: 1.6; color: #333;">
          <h2 style="font-weight: 800; margin-bottom: 20px; color: var(--primary-blue);">WebServer 使用指南</h2>
          
          <h3 style="font-weight: 700; margin-bottom: 10px;"><i class="layui-icon layui-icon-home"></i> 1. 系统概览</h3>
          <p style="margin-bottom: 15px; color: #666;">在概览页面，您可以查看已安装网站总数。下方提供 Nginx 和 PHP 的运行状态检查。系统会自动检测已安装的 PHP-FPM 版本并列出其状态。</p>
          
          <h3 style="font-weight: 700; margin-bottom: 10px;"><i class="layui-icon layui-icon-website"></i> 2. 网站管理</h3>
          <ul style="margin-bottom: 15px; padding-left: 20px; list-style-type: disc; color: #666;">
              <li><b>端口模式</b>：适用于本地测试或内网通过 IP:Port 访问。</li>
              <li><b>域名模式</b>：输入域名即可关联 Nginx 配置，适合映射公网访问。</li>
              <li><b>PHP 版本选择</b>：创建网站时，可以从系统中检测到的 PHP 版本中选择该网站使用的引擎版本。</li>
              <li><b>一键修复权限</b>：若网站提示 403 Forbidden，请在操作中选择“修复权限”，系统将自动匹配 www-data 用户。</li>
          </ul>

          <h3 style="font-weight: 700; margin-bottom: 10px;"><i class="layui-icon layui-icon-set"></i> 4. 数据库安全</h3>
          <p style="margin-bottom: 15px; color: #666;">为了防止实例冲突，本面板为数据库容器分配了唯一的 <b>实例 ID</b>。此 ID 持久化存储，确保面板仅管理由其自身创建的容器环境，数据目录位于 /opt/webserver/db 目录下。</p>

          <div style="margin-top: 30px; padding: 15px; background: #f8f8f8; border-radius: 12px; font-size: 13px; color: #999;">
              提示：若需修改全站 Nginx 上传通道限制，还需在具体的 PHP 内部限制（upload_max_filesize）进行管理。
          </div>
      </div>
      `;
        layer.open({
            type: 1,
            title: false, // Hide default title for a cleaner look
            area: ['650px', '550px'],
            shadeClose: true,
            content: helpHtml,
            skin: 'layui-layer-rim', // Added border for better contrast
            style: 'border-radius: 16px; overflow: hidden;'
        });
    });

    // --- External Trigger for Rebranding verification ---
    // --- Initial Load ---
    switchTab('system');
    reloadSites();

    console.log("WebServer Panel Initialized");

});
