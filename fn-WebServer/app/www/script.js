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
                if (data.ok) {
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
        $('#view-system, #view-sites, #view-settings').hide();
        // Show target with vertical flex layout to prevent elements from sitting side-by-side
        $('#view-' + id).css('display', 'flex').css('flex-direction', 'column').show();

        // Breadcrumb removed as per user request

        // Load content if needed
        if (id === 'system') {
            loadStatus();
        } else if (id === 'sites') {
            // Table auto-renders, but maybe resize?
            table.resize('site-table');
        } else if (id === 'settings') {
            loadUploadLimit();
        }
    }

    // --- System Environment ---
    function loadStatus() {
        // Update Hero Site Count
        fetch(apiBase + '/api/sites').then(r => r.json()).then(res => {
            if (res) {
                var count = res.length || 0;
                $('#site-count-hero').text(count);
                $('#site-count').text(count);
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
                if (!data.running) {
                    html += '<button class="layui-btn layui-btn-xs layui-btn-warm" style="margin-top:8px" id="btn-start-nginx-hero">立即启动</button>';
                }
                el.html(html);
                $('#btn-start-nginx-hero').click(function () {
                    apiPost("/api/nginx/restart", "", "启动尝试中", loadStatus);
                });
            } else {
                el.html('<span style="color:#FF5722">未发现适用的nginx</span> <button class="layui-btn layui-btn-xs layui-btn-primary" id="btn-install-nginx">一键安装</button>');
                $('#btn-install-nginx').click(function () {
                    layer.confirm('确认安装 Nginx?', function (i) {
                        layer.close(i);
                        showInstallLog('nginx', "/api/nginx/install", "", "安装完成", loadStatus);
                    });
                });
            }
        }).catch(() => $('#nginx-status').text('获取失败'));

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
            var bindDbEvents = function() {
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
            if (res) {
                $('#site-count').text(res.length);
                $('#site-count-hero').text(res.length);
            }
            return {
                "code": 0,
                "msg": "",
                "count": res ? res.length : 0,
                "data": res || []
            };
        },
        cols: [[
            { field: 'name', title: '网站名称', width: 140 },
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
            { fixed: 'right', title: '操作', toolbar: '#site-bar', minWidth: 220 }
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

    $('#btn-restart-nginx').click(function () {
        layer.confirm('确定重启 Nginx 服务？<br>这可能会中断当前连接', function (index) {
            layer.close(index);
            apiPost("/api/nginx/restart", "", "重启成功");
        });
    });


    // --- Create Site Logic (Keep as is) ---
    $('#btn-create-site').click(function () {
        // Check Nginx and PHP prerequisites
        var checkLoading = layer.load(2);
        Promise.all([
            fetch(apiBase + "/api/nginx/status").then(r => r.json()),
            fetch(apiBase + "/api/php/status").then(r => r.json())
        ]).then(results => {
            layer.close(checkLoading);
            var nginxData = results[0];
            var phpData = results[1];

            if (!nginxData.installed || !phpData.installed || !phpData.versions || phpData.versions.length === 0) {
                var msg = "新建网站前必须安装基础环境：<br>";
                if (!nginxData.installed) msg += "- Nginx <span style='color:#FF5722'>(未安装)</span><br>";
                if (!phpData.installed || !phpData.versions || phpData.versions.length === 0) msg += "- PHP-FPM <span style='color:#FF5722'>(未检测到已安装的版本)</span><br>";
                msg += "<br>请确保系统中已安装 Nginx 和 PHP-FPM。";
                layer.alert(msg, { icon: 0, title: '环境缺失' });
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
                "name": "", "mode": "port", "domain": "", "port": "",
                "https_enabled": false, "port_ssl": "", "php_version": phpData.versions[0].version,
                "root": "", "rewrite": ""
            });
            $('input[name=mode][value=port]').prop('checked', true);
            $('input[name=https_enabled]').prop('checked', false);
            form.render();
            updateCreateSiteVisibility("port", false);

            layer.open({
                type: 1, title: '新建网站', content: $('#tpl-create-site'), area: ['600px', '750px']
            });

        }).catch(err => {
            layer.close(checkLoading);
            layer.alert("环境检测失败，无法继续操作", { icon: 2 });
        });
    });

    form.on('radio(site-mode)', function (data) {
        updateCreateSiteVisibility(data.value, $('input[name=https_enabled]').prop('checked'));
    });
    form.on('checkbox(https-enabled)', function (data) {
        var mode = $('input[name=mode]:checked').val();
        updateCreateSiteVisibility(mode, data.elem.checked);
    });

    function updateCreateSiteVisibility(mode, https) {
        if (mode === 'domain') {
            $('#field-domain').show(); $('#field-port-http').hide(); $('#field-port-https').hide();
        } else {
            $('#field-domain').hide(); $('#field-port-http').show();
            if (https) $('#field-port-https').show(); else $('#field-port-https').hide();
        }
    }

    form.on('submit(submit-create-site)', function (data) {
        var field = data.field;
        var body = "mode=" + field.mode + "\nroot=" + field.root;
        if (field.name) body += "\nname=" + encodeURIComponent(field.name);
        body += "\nhttps_enabled=" + (field.https_enabled ? "true" : "false");
        body += "\nphp_version=" + field.php_version;

        if (field.mode === 'domain') {
            if (!field.domain) { layer.msg('请输入域名'); return false; }
            body += "\ndomain=" + field.domain;
        } else {
            if (!field.port) { layer.msg('请输入HTTP端口'); return false; }
            body += "\nport=" + field.port;
            if (field.https_enabled) {
                if (!field.port_ssl) { layer.msg('请输入HTTPS端口'); return false; }
                body += "\nport_https=" + field.port_ssl;
            }
        }
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
    console.log("WebServer Panel Initialized");

});
