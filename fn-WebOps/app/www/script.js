layui.use(['element', 'table', 'layer', 'form'], function(){
  var element = layui.element;
  var table = layui.table;
  var layer = layui.layer;
  var form = layui.form;
  var $ = layui.$;

  var apiBase = "/cgi/ThirdParty/webops/index.cgi";
  var defaultPhpExtensions = "php8.2-common\nphp8.2-mysql\nphp8.2-xml\nphp8.2-xmlrpc\nphp8.2-curl\nphp8.2-gd\nphp8.2-imagick\nphp8.2-cli\nphp8.2-dev\nphp8.2-imap\nphp8.2-mbstring\nphp8.2-opcache\nphp8.2-soap\nphp8.2-zip\nphp8.2-bcmath\nphp8.2-intl\nphp8.2-readline\nphp8.2-ldap\nphp8.2-msgpack\nphp8.2-igbinary\nphp8.2-redis\nphp8.2-memcached\nphp8.2-pgsql\nphp8.2-sqlite3\nphp8.2-odbc\nphp8.2-ssh2\nphp8.2-tidy\nphp8.2-xsl\nphp8.2-yaml\nphp8.2-cgi\nphp8.2-fpm";

  // --- Common Helpers ---
  function reloadSites() {
    table.reload('site-table');
  }

  function apiPost(url, body, successMsg, callback) {
    var loading = layer.load(2);
    fetch(apiBase + url, {
      method: "POST",
      body: body,
      headers: {"Content-Type": "text/plain"}
    })
    .then(res => res.json())
    .then(data => {
      layer.close(loading);
      if(data.ok) {
        if(successMsg) layer.msg(successMsg, {icon: 1});
        if(callback) callback(data);
      } else {
        layer.alert("操作失败: " + (data.error || "未知错误"), {icon: 2});
      }
    })
    .catch(err => {
      layer.close(loading);
      layer.alert("请求失败: " + err.message, {icon: 2});
    });
  }

  // --- Navigation Logic ---
  $('.layui-nav-item a').click(function(){
      var id = $(this).data('id');
      if(id) switchTab(id);
  });

  function switchTab(id) {
      // Hide all views
      $('#view-system, #view-sites, #view-plugins, #view-settings').hide();
      // Show target
      $('#view-' + id).show();
      
      // Load content if needed
      if(id === 'system') {
          loadStatus();
      } else if(id === 'sites') {
          // Table auto-renders, but maybe resize?
          table.resize('site-table');
      } else if(id === 'plugins') {
          loadPluginTable();
      } else if(id === 'settings') {
          loadUploadLimit();
      }
  }

  // --- System Environment ---
  function loadStatus() {
      // Nginx
      fetch(apiBase+"/api/nginx/status").then(r=>r.json()).then(data => {
          var el = $('#nginx-status');
          if(data.installed){
              var html = `<div style="color:#5FB878"><i class="layui-icon layui-icon-ok-circle"></i> 已安装 (${data.version||''})</div>`;
              html += data.config_exists ? '<div>配置文件: <span style="color:#5FB878">正常</span></div>' : '<div>配置文件: <span style="color:#FF5722">缺失</span></div>';
              el.html(html);
          } else {
              el.html('<span style="color:#FF5722">未发现适用的nginx</span> <button class="layui-btn layui-btn-xs layui-btn-primary" id="btn-install-nginx">一键安装</button>');
              $('#btn-install-nginx').click(function(){
                  layer.confirm('确认安装 Nginx?', function(i){
                      layer.close(i);
                      el.html('<i class="layui-icon layui-icon-loading layui-anim layui-anim-rotate layui-anim-loop"></i> 安装中...');
                      apiPost("/api/nginx/install", "", "安装完成", loadStatus);
                  });
              });
          }
      }).catch(()=> $('#nginx-status').text('获取失败'));

      // PHP
      fetch(apiBase+"/api/php/status").then(r=>r.json()).then(data => {
          var el = $('#php-status');
          if(data.installed){
              var html = `<div style="color:#5FB878"><i class="layui-icon layui-icon-ok-circle"></i> 已安装 (${data.version||''})</div>`;
              html += data.fpm_running ? '<div>FPM状态: <span style="color:#5FB878">运行中</span></div>' : '<div>FPM状态: <span style="color:#FF5722">未运行</span></div>';
              el.html(html);
          } else {
              el.html('<span style="color:#FF5722">未发现适用的php</span> <button class="layui-btn layui-btn-xs layui-btn-primary" id="btn-install-php">一键安装</button>');
              $('#btn-install-php').click(function(){
                  layer.confirm('确认安装 PHP?', function(i){
                      layer.close(i);
                      el.html('<i class="layui-icon layui-icon-loading layui-anim layui-anim-rotate layui-anim-loop"></i> 安装中...');
                      apiPost("/api/php/install", "", "安装完成", loadStatus);
                  });
              });
          }
      }).catch(()=> $('#php-status').text('获取失败'));

      // Database
      fetch(apiBase+"/api/db/status").then(r=>r.json()).then(data => {
          var el = $('#db-status');
          if(data.status === 'running' || data.status === 'installed'){
              var color = data.status === 'running' ? '#5FB878' : '#FFB800';
              var icon = data.status === 'running' ? 'layui-icon-ok-circle' : 'layui-icon-about';
              var html = `<div style="color:${color}"><i class="layui-icon ${icon}"></i> ${data.details}</div>`;
              if(data.type === 'docker'){
                 html += '<div style="margin-top:5px;font-size:12px;color:#666">类型: Docker容器 (mysql + phpmyadmin)</div>';
                 if(data.status === 'running'){
                     html += '<div style="margin-top:5px"><a href="http://'+window.location.hostname+':8080" target="_blank" class="layui-btn layui-btn-xs layui-btn-normal">打开 phpMyAdmin</a></div>';
                 }
              } else {
                 html += '<div style="margin-top:5px;font-size:12px;color:#666">类型: 系统服务</div>';
              }
              el.html(html);
          } else {
              el.html('未安装 <button class="layui-btn layui-btn-xs layui-btn-normal" id="btn-install-db">安装 Docker版数据库</button>');
              $('#btn-install-db').click(function(){
                  layer.prompt({title: '请设置 MySQL root 密码', formType: 1}, function(pass, index){
                      layer.close(index);
                      if(!pass) return;
                      el.html('<i class="layui-icon layui-icon-loading layui-anim layui-anim-rotate layui-anim-loop"></i> 安装中 (Docker compose)...');
                      apiPost("/api/db/install", "password="+encodeURIComponent(pass), "安装完成", loadStatus);
                  });
              });
          }
      }).catch(()=> $('#db-status').text('获取失败'));
  }

  // --- Site Management ---
  table.render({
    elem: '#site-table',
    url: apiBase + '/api/sites',
    parseData: function(res){
      return {
        "code": 0,
        "msg": "",
        "count": res ? res.length : 0,
        "data": res || []
      };
    },
    cols: [[
      {field: 'name', title: '网站名称', width: 150},
      {field: 'mode', title: '类型', width: 80, templet: function(d){ return d.mode==='domain'?'域名':'端口'; }},
      {field: 'port', title: '监听端口', width: 120, templet: function(d){ 
          if(d.port) return d.port.split(',').map(p=>`<span class="layui-badge layui-bg-gray">${p}</span>`).join(' ');
          return '-';
      }},
      {field: 'root', title: '根目录', minWidth: 200},
      {field: 'enabled', title: '状态', width: 100, templet: function(d){
          return d.enabled ? '<span class="layui-badge layui-bg-green">已启用</span>' : '<span class="layui-badge layui-bg-orange">已停用</span>';
      }},
      {fixed: 'right', title:'操作', toolbar: '#site-bar', minWidth: 220}
    ]],
    page: false,
    text: {none: '暂无网站配置'}
  });

  table.on('tool(site-table)', function(obj){
      var data = obj.data;
      if(obj.event === 'del'){
          layer.confirm('确定删除网站 '+data.name+'?', function(index){
              layer.close(index);
              apiPost("/api/sites/delete", "name="+encodeURIComponent(data.name), "删除成功", function(){ reloadSites(); });
          });
      } else if(obj.event === 'edit-port'){
          openEditPortModal(data);
      } else if(obj.event === 'enable'){
          apiPost("/api/sites/enable", "name="+encodeURIComponent(data.name), "已启用", function(){ reloadSites(); });
      } else if(obj.event === 'disable'){
          apiPost("/api/sites/disable", "name="+encodeURIComponent(data.name), "已停用", function(){ reloadSites(); });
      } else if(obj.event === 'fix-permissions'){
          layer.confirm('确定修复网站目录权限? <br>将把目录所有者设为 www-data, 权限设为 755', function(index){
              layer.close(index);
              apiPost("/api/sites/fix-permissions", "name="+encodeURIComponent(data.name), "权限修复成功");
          });
      }
  });

  $('#btn-refresh').click(function(){ reloadSites(); });

  // --- Plugin Management ---
  var pluginTableRendered = false;
  function loadPluginTable() {
      if(pluginTableRendered) {
          table.reload('plugin-table');
          return;
      }
      pluginTableRendered = true;
      
      table.render({
          elem: '#plugin-table',
          url: apiBase + '/api/php/extensions',
          parseData: function(res){
              var installedMap = {};
              if(res && Array.isArray(res)) res.forEach(r => installedMap[r.name] = true);
              
              var allPkgs = defaultPhpExtensions.split('\n').filter(x=>x.trim());
              var gridData = allPkgs.map(name => {
                  return { name: name, installed: !!installedMap[name] };
              });
              
              return { "code": 0, "data": gridData, "count": gridData.length };
          },
          cols: [[
              {field: 'name', title: '插件名'},
              {field: 'installed', title: '状态', width: 100, templet: function(d){
                  return d.installed ? '<span class="layui-badge layui-bg-green">已安装</span>' : '<span class="layui-badge layui-bg-gray">未安装</span>';
              }},
              {title: '操作', width: 100, templet: function(d){
                  if(d.installed) return `<a class="layui-btn layui-btn-xs layui-btn-danger" lay-event="uninstall">卸载</a>`;
                  return `<a class="layui-btn layui-btn-xs" lay-event="install">安装</a>`;
              }}
          ]],
          page: false,
          limit: 1000,
          height: 'full-200' // Auto fill
      });
  }

  table.on('tool(plugin-table)', function(obj){
      var data = obj.data;
      if(obj.event === 'install'){
          layer.confirm('安装插件 '+data.name+'?', function(i){
              layer.close(i);
              apiPost("/api/php/install", data.name, "安装完成", function(){ loadPluginTable(); });
          });
      } else if(obj.event === 'uninstall'){
          layer.confirm('卸载插件 '+data.name+'?', function(i){
              layer.close(i);
              apiPost("/api/php/remove", data.name, "卸载完成", function(){ loadPluginTable(); });
          });
      }
  });

  $('#btn-install-all-plugins').click(function(){
      var allPkgs = defaultPhpExtensions.split('\n').filter(x=>x.trim());
      layer.confirm('确定安装所有推荐插件?', function(i){
          layer.close(i);
          apiPost("/api/php/install", allPkgs.join('\n'), "批量安装完成", function(){ loadPluginTable(); });
      });
  });

  $('#btn-install-custom-plugin').click(function(){
      var name = $('#input-plugin-custom').val().trim();
      if(!name) return layer.msg('请输入包名');
      layer.confirm('安装自定义插件 '+name+'?', function(i){
          layer.close(i);
          apiPost("/api/php/install", name, "安装完成", function(){ loadPluginTable(); });
      });
  });

  // --- General Settings ---
  function loadUploadLimit() {
      var loading = layer.load();
      fetch(apiBase+"/api/settings/get-upload-limit").then(r=>r.json()).then(data=>{
          layer.close(loading);
          $('#input-upload-limit').val(data.ok ? data.limit : "");
      }).catch(()=>{ layer.close(loading); layer.msg('获取配置失败'); });
  }

  $('#btn-save-upload-limit').click(function(){
      var val = $('#input-upload-limit').val();
      if(!val) { layer.msg('请输入限制值'); return; }
      apiPost("/api/settings/set-upload-limit", "limit="+encodeURIComponent(val), "修改成功");
  });

  $('#btn-restart-nginx').click(function(){
      layer.confirm('确定重启 Nginx 服务？<br>这可能会中断当前连接', function(index){
          layer.close(index);
          apiPost("/api/nginx/restart", "", "重启成功");
      });
  });


  // --- Create Site Logic (Keep as is) ---
  $('#btn-create-site').click(function(){
      // Check Nginx and PHP prerequisites
      var checkLoading = layer.load(2);
      Promise.all([
          fetch(apiBase+"/api/nginx/status").then(r=>r.json()),
          fetch(apiBase+"/api/php/status").then(r=>r.json())
      ]).then(results => {
          layer.close(checkLoading);
          var nginxData = results[0];
          var phpData = results[1];
          
          if (!nginxData.installed || !phpData.installed) {
              var msg = "新建网站前必须安装基础环境：<br>";
              if(!nginxData.installed) msg += "- Nginx <span style='color:#FF5722'>(未安装)</span><br>";
              if(!phpData.installed) msg += "- PHP <span style='color:#FF5722'>(未安装)</span><br>";
              msg += "<br>请先在“系统环境”页面完成安装。";
              layer.alert(msg, {icon: 0, title: '环境缺失'});
              return;
          }

          // Environment OK, proceed to open dialog
          form.val('form-create-site', {
              "name": "", "mode": "port", "domain": "", "port": "", 
              "https_enabled": false, "port_ssl": "", 
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
          layer.alert("环境检测失败，无法继续操作", {icon: 2});
      });
  });

  form.on('radio(site-mode)', function(data){
      updateCreateSiteVisibility(data.value, $('input[name=https_enabled]').prop('checked'));
  });
  form.on('checkbox(https-enabled)', function(data){
      var mode = $('input[name=mode]:checked').val();
      updateCreateSiteVisibility(mode, data.elem.checked);
  });

  function updateCreateSiteVisibility(mode, https) {
      if(mode === 'domain') {
          $('#field-domain').show(); $('#field-port-http').hide(); $('#field-port-https').hide();
      } else {
          $('#field-domain').hide(); $('#field-port-http').show();
          if(https) $('#field-port-https').show(); else $('#field-port-https').hide();
      }
  }

  form.on('submit(submit-create-site)', function(data){
      var field = data.field;
      var body = "mode=" + field.mode + "\nroot=" + field.root;
      if(field.name) body += "\nname=" + encodeURIComponent(field.name);
      body += "\nhttps_enabled=" + (field.https_enabled ? "true" : "false");

      if(field.mode === 'domain') {
          if(!field.domain) { layer.msg('请输入域名'); return false; }
          body += "\ndomain=" + field.domain;
      } else {
          if(!field.port) { layer.msg('请输入HTTP端口'); return false; }
          body += "\nport=" + field.port;
          if(field.https_enabled) {
              if(!field.port_ssl) { layer.msg('请输入HTTPS端口'); return false; }
              body += "\nport_https=" + field.port_ssl;
          }
      }
      if(field.rewrite) body += "\nrewrite=" + encodeURIComponent(field.rewrite);

      apiPost("/api/sites/create", body, "创建成功", function(){
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
      ports.forEach(function(p){
          p = p.trim();
          if(p==="443" || p==="8443" || p==="2931") httpsPort = p;
          else if(!httpPort) httpPort = p;
          else if(!httpsPort) httpsPort = p; 
      });
      form.val('form-edit-port', { "port": httpPort, "port_https": httpsPort });

      layer.open({ type: 1, title: '修改端口 - ' + site.name, content: $('#tpl-edit-port'), area: ['400px', '300px'] });
  }

  form.on('submit(submit-edit-port)', function(data){
      var f = data.field;
      if(!f.port) { layer.msg('请输入HTTP端口'); return false; }
      var body = "name=" + encodeURIComponent(f.site_name) + "\nport=" + f.port;
      if(f.port_https) body += "\nport_https=" + f.port_https;
      
      apiPost("/api/sites/update-port", body, "修改成功", function(){
          layer.closeAll('page');
          reloadSites();
      });
      return false;
  });

  // --- Directory Selector ---
  var currentDirInputId = "";
  var dirSelectorIndex;
  $('#btn-browse-root').click(function(){
      currentDirInputId = "input-root-path";
      openDirSelector($('#input-root-path').val());
  });

  function openDirSelector(initialPath) {
      loadDirs(initialPath || "/");
      dirSelectorIndex = layer.open({ type: 1, title: '选择目录', content: $('#tpl-dir-selector'), area: ['500px', '400px'] });
  }

  $('#btn-dir-up').click(function(){
      var current = $('#dir-selector-current').val();
      var parent = current.replace(/[^/]+\/?$/, "");
      if(!parent) parent = "/";
      loadDirs(parent);
  });

  $('#btn-dir-confirm').click(function(){
      var selected = $('#dir-selector-current').val();
      if(currentDirInputId) $('#'+currentDirInputId).val(selected);
      if(dirSelectorIndex) layer.close(dirSelectorIndex);
  });

  function loadDirs(path) {
      $('#dir-selector-current').val(path);
      $('#dir-list-container').html('<div class="layui-icon layui-icon-loading"> 加载中...</div>');
      fetch(apiBase+"/api/fs/list", {method:"POST", body:path}).then(r=>r.json()).then(data => {
          if(!data.ok) { $('#dir-list-container').text("错误: " + data.error); return; }
          $('#dir-selector-current').val(data.current);
          var html = "";
          if(data.dirs) {
              data.dirs.forEach(d => {
                  html += `<div class="dir-item" style="padding:5px; cursor:pointer; border-bottom:1px solid #f0f0f0;"><i class="layui-icon layui-icon-folder"></i> ${d}</div>`;
              });
          } else { html = "<div style='padding:10px; color:#999'>无子目录</div>"; }
          $('#dir-list-container').html(html);
          $('#dir-list-container .dir-item').click(function(){
              var name = $(this).text().trim();
              var cur = $('#dir-selector-current').val();
              loadDirs(cur.replace(/\/?$/, "/") + name);
          });
      }).catch(() => $('#dir-list-container').text("加载失败"));
  }

  // --- Initialize ---
  loadStatus(); // Default tab is system

});