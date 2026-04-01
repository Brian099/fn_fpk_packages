layui.use(['element', 'table', 'layer', 'form'], function(){
  var element = layui.element;
  var table = layui.table;
  var layer = layui.layer;
  var form = layui.form;
  var $ = layui.$;

  var apiBase = "/cgi/ThirdParty/WebServer/index.cgi";
  var defaultPhpExtensions = "php8.2-common\nphp8.2-mysql\nphp8.2-xml\nphp8.2-xmlrpc\nphp8.2-curl\nphp8.2-gd\nphp8.2-imagick\nphp8.2-cli\nphp8.2-dev\nphp8.2-imap\nphp8.2-mbstring\nphp8.2-opcache\nphp8.2-soap\nphp8.2-zip\nphp8.2-bcmath\nphp8.2-intl\nphp8.2-readline\nphp8.2-ldap\nphp8.2-msgpack\nphp8.2-igbinary\nphp8.2-redis\nphp8.2-memcached\nphp8.2-pgsql\nphp8.2-sqlite3\nphp8.2-odbc\nphp8.2-ssh2\nphp8.2-tidy\nphp8.2-xsl\nphp8.2-yaml\nphp8.2-cgi\nphp8.2-fpm";
  var corePhpPackages = new Set(['php8.2-common','php8.2-cli','php8.2-fpm','php8.2-opcache']);

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

  // --- Install Log Helper ---
  function showInstallLog(type, api, body, successMsg, callback) {
      var logContent = "";
      var logLayer = layer.open({
          type: 1,
          title: '安装进度日志',
          area: ['800px', '600px'],
          content: '<div style="padding:10px;background:#333;color:#eee;height:100%;box-sizing:border-box;overflow:auto;"><pre id="install-log-content" style="white-space:pre-wrap;word-break:break-all;font-family:monospace;"></pre></div>',
          btn: ['关闭'],
          yes: function(index){
              layer.close(index);
          }
      });

      var logInterval = setInterval(function(){
          fetch(apiBase + "/api/install/log", {
              method: "POST",
              body: "type=" + type
          }).then(r=>r.json()).then(d=>{
              if(d.ok && d.log) {
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
          headers: {"Content-Type": "text/plain"}
      }).then(r=>r.json()).then(data => {
          clearInterval(logInterval);
          // Fetch log one last time
          fetch(apiBase + "/api/install/log", {method: "POST", body: "type=" + type})
             .then(r=>r.json()).then(d=>{ 
                 if(d.ok && d.log) {
                     $('#install-log-content').text(d.log);
                     if(data.ok) {
                         $('#install-log-content').append('\n\n[SUCCESS] ' + successMsg);
                     } else {
                         $('#install-log-content').append('\n\n[ERROR] ' + (data.error || "安装失败"));
                     }
                     var div = $('#install-log-content').parent()[0];
                     div.scrollTop = div.scrollHeight;
                 }
             });
             
          if(data.ok) {
              layer.msg(successMsg, {icon: 1});
              if(callback) callback(data);
          } else {
              layer.alert("安装失败: " + (data.error || "未知错误") + "<br>请查看日志", {icon: 2});
          }
      }).catch(err => {
          clearInterval(logInterval);
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
      $('#view-' + id).css('display', 'flex').show();
      
      // Update breadcrumb
      var breadcrumb = "控制台 / ";
      if(id === 'system') breadcrumb += "概览";
      else if(id === 'sites') breadcrumb += "网站管理";
      else if(id === 'plugins') breadcrumb += "扩展中心";
      else if(id === 'settings') breadcrumb += "系统设置";
      $('#header-breadcrumb').text(breadcrumb);
      
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
      // Update Hero Site Count (Fetch from sites API)
      fetch(apiBase + '/api/sites').then(r=>r.json()).then(res => {
          if(res) {
              var count = res.length || 0;
              $('#site-count-hero').text(count);
              $('#site-count').text(count);
          }
      });

      // Nginx Mini Status
      fetch(apiBase+"/api/nginx/status").then(r=>r.json()).then(data => {
          var el = $('#nginx-status-mini');
          if(data.installed){
             el.html('Nginx: <span style="color:#5FB878">在线</span> (' + (data.version||'') + ')');
          } else {
             el.html('Nginx: <span style="color:#FF5722">未安装</span>');
          }
      });

      // PHP Mini Status
      fetch(apiBase+"/api/php/status").then(r=>r.json()).then(data => {
          var el = $('#php-status-mini');
          if(data.installed){
             el.html('PHP: <span style="color:#5FB878">在线</span> (' + (data.version||'') + ')');
          } else {
             el.html('PHP: <span style="color:#FF5722">未安装</span>');
          }
      });
  }

  // --- Site Management ---
  table.render({
    elem: '#site-table',
    url: apiBase + '/api/sites',
    parseData: function(res){
      if(res) {
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
    height: 'full-330', // Adapt to screen height
    text: {none: '暂无网站配置'}
  });

  // --- Site Filter Logic ---
  $('#search-sites').on('input', function(){
      var val = $(this).val().toLowerCase();
      // Use jQuery to show/hide rows in the currently rendered table body
      $('#site-table').next().find('.layui-table-body tbody tr').each(function(){
          var text = $(this).text().toLowerCase();
          $(this).toggle(text.indexOf(val) > -1);
      });
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
              if(res && Array.isArray(res)) res.forEach(r => installedMap[r.name] = r.installed);
              
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
                  if(d.installed) {
                      if(corePhpPackages.has(d.name)) {
                          return `<span class="layui-badge layui-bg-gray" title="核心组件不可卸载">核心</span>`;
                      }
                      return `<a class="layui-btn layui-btn-xs layui-btn-danger" lay-event="uninstall">卸载</a>`;
                  }
                  return `<a class="layui-btn layui-btn-xs" lay-event="install">安装</a>`;
              }}
          ]],
          page: false,
          limit: 1000,
          height: 'full-330' // Adapt to screen height
      });
  }

  // --- Plugin Filter Logic ---
  $('#search-plugins').on('input', function(){
      var val = $(this).val().toLowerCase();
      $('#plugin-table').next().find('.layui-table-body tbody tr').each(function(){
          var text = $(this).text().toLowerCase();
          $(this).toggle(text.indexOf(val) > -1);
      });
  });

  table.on('tool(plugin-table)', function(obj){
      var data = obj.data;
      if(obj.event === 'install'){
          layer.confirm('安装插件 '+data.name+'?', function(i){
              layer.close(i);
              showInstallLog('php', "/api/php/install", data.name, "安装完成", function(){ loadPluginTable(); });
          });
      } else if(obj.event === 'uninstall'){
          if(corePhpPackages.has(data.name)) {
              layer.msg('核心组件不可卸载', {icon: 0});
              return;
          }
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
          showInstallLog('php', "/api/php/install", allPkgs.join('\n'), "批量安装完成", function(){ loadPluginTable(); });
      });
  });

  $('#btn-install-custom-plugin').click(function(){
      var name = $('#input-plugin-custom').val().trim();
      if(!name) return layer.msg('请输入包名');
      layer.confirm('安装自定义插件 '+name+'?', function(i){
          layer.close(i);
          showInstallLog('php', "/api/php/install", name, "安装完成", function(){ loadPluginTable(); });
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
