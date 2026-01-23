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

  // --- Main Site Table ---
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
      {fixed: 'right', title:'操作', toolbar: '#site-bar', width: 220}
    ]],
    page: false,
    text: {none: '暂无网站配置'}
  });

  // --- Table Tools ---
  table.on('tool(site-table)', function(obj){
    var data = obj.data;
    if(obj.event === 'del'){
      layer.confirm('确定要删除网站 '+data.name+' 吗？<br>此操作不可恢复。', {icon: 3, title:'删除确认'}, function(index){
        apiPost("/api/sites/delete", "name="+encodeURIComponent(data.name), "删除成功", function(){
            obj.del();
        });
        layer.close(index);
      });
    } else if(obj.event === 'disable' || obj.event === 'enable'){
       var action = obj.event; // disable or enable
       var actionText = action === 'disable' ? '停用' : '启用';
       layer.confirm('确定要'+actionText+'网站 '+data.name+' 吗？', {icon: 3, title: actionText+'确认'}, function(index){
           apiPost("/api/sites/" + action, "name="+encodeURIComponent(data.name), actionText+"成功", function(){
               reloadSites();
           });
           layer.close(index);
       });
    } else if(obj.event === 'edit-port'){
        openEditPortModal(data);
    }
  });

  // --- Status Loading ---
  function loadStatus() {
      // Nginx
      fetch(apiBase+"/api/nginx/status").then(r=>r.json()).then(data => {
          var el = $('#nginx-status');
          if(data.installed){
              var html = `<div style="color:#5FB878"><i class="layui-icon layui-icon-ok-circle"></i> 已安装 (${data.version||''})</div>`;
              html += data.config_exists ? '<div>配置文件: <span style="color:#5FB878">正常</span></div>' : '<div>配置文件: <span style="color:#FF5722">缺失</span></div>';
              el.html(html);
          } else {
              el.html('未安装 <button class="layui-btn layui-btn-xs layui-btn-primary" id="btn-install-nginx">一键安装</button>');
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
              el.html('未安装 <button class="layui-btn layui-btn-xs layui-btn-primary" id="btn-install-php">一键安装</button>');
              $('#btn-install-php').click(function(){
                  layer.confirm('确认安装 PHP?', function(i){
                      layer.close(i);
                      el.html('<i class="layui-icon layui-icon-loading layui-anim layui-anim-rotate layui-anim-loop"></i> 安装中...');
                      apiPost("/api/php/install", "", "安装完成", loadStatus);
                  });
              });
          }
      }).catch(()=> $('#php-status').text('获取失败'));
  }
  loadStatus();
  $('#btn-refresh').click(function(){ reloadSites(); loadStatus(); });

  // --- Create Site Modal ---
  $('#btn-create-site').click(function(){
      // Reset form
      form.val('form-create-site', {
          "name": "", "mode": "domain", "domain": "", "port": "2829", 
          "https_enabled": false, "port_ssl": "8443", 
          "root": "/var/www/html/", "rewrite": ""
      });
      // Trigger change events to update visibility
      $('input[name=mode][value=domain]').prop('checked', true);
      $('input[name=https_enabled]').prop('checked', false);
      form.render();
      updateCreateSiteVisibility("domain", false);

      layer.open({
          type: 1,
          title: '新建网站',
          content: $('#tpl-create-site'), // Content from DOM
          area: ['600px', '750px'],
          success: function(layero, index){
              // Re-bind events inside layer if needed (Layui handles form filters globally usually)
          }
      });
  });

  // Visibility Logic
  form.on('radio(site-mode)', function(data){
      updateCreateSiteVisibility(data.value, $('input[name=https_enabled]').prop('checked'));
  });
  form.on('checkbox(https-enabled)', function(data){
      var mode = $('input[name=mode]:checked').val();
      updateCreateSiteVisibility(mode, data.elem.checked);
  });

  function updateCreateSiteVisibility(mode, https) {
      if(mode === 'domain') {
          $('#field-domain').show();
          $('#field-port-http').hide();
          $('#field-port-https').hide();
      } else {
          $('#field-domain').hide();
          $('#field-port-http').show();
          if(https) $('#field-port-https').show(); else $('#field-port-https').hide();
      }
  }

  // Submit Create Site
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

      if(field.rewrite) {
          body += "\nrewrite=" + encodeURIComponent(field.rewrite);
      }

      apiPost("/api/sites/create", body, "创建成功", function(){
          layer.closeAll('page');
          reloadSites();
      });
      return false; // Prevent form reload
  });

  // --- Edit Port Modal ---
  function openEditPortModal(site) {
      form.val('form-edit-port', {
          "site_name": site.name,
          "port": "",
          "port_https": ""
      });
      
      // Parse ports
      var ports = (site.port || "").split(",");
      var httpPort = "", httpsPort = "";
      ports.forEach(function(p){
          p = p.trim();
          if(p==="443" || p==="8443" || p==="2931") httpsPort = p;
          else if(!httpPort) httpPort = p;
          else if(!httpsPort) httpsPort = p; 
      });
      form.val('form-edit-port', {
          "port": httpPort,
          "port_https": httpsPort
      });

      layer.open({
          type: 1,
          title: '修改端口 - ' + site.name,
          content: $('#tpl-edit-port'),
          area: ['400px', '300px']
      });
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
  $('#btn-browse-root').click(function(){
      currentDirInputId = "input-root-path";
      openDirSelector($('#input-root-path').val());
  });

  function openDirSelector(initialPath) {
      loadDirs(initialPath || "/");
      layer.open({
          type: 1,
          title: '选择目录',
          content: $('#tpl-dir-selector'),
          area: ['500px', '400px']
      });
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
      layer.closeAll('page'); // Note: this closes all page layers, might be too aggressive if multiple layers
      // Better to capture layer index, but here we assume one modal at a time.
  });

  function loadDirs(path) {
      $('#dir-selector-current').val(path);
      $('#dir-list-container').html('<div class="layui-icon layui-icon-loading"> 加载中...</div>');
      
      fetch(apiBase+"/api/fs/list", {method:"POST", body:path})
      .then(r=>r.json())
      .then(data => {
          if(!data.ok) { $('#dir-list-container').text("错误: " + data.error); return; }
          $('#dir-selector-current').val(data.current);
          var html = "";
          if(data.dirs) {
              data.dirs.forEach(d => {
                  html += `<div class="dir-item" style="padding:5px; cursor:pointer; border-bottom:1px solid #f0f0f0;">
                      <i class="layui-icon layui-icon-folder"></i> ${d}
                  </div>`;
              });
          } else {
              html = "<div style='padding:10px; color:#999'>无子目录</div>";
          }
          $('#dir-list-container').html(html);
          
          $('#dir-list-container .dir-item').click(function(){
              var name = $(this).text().trim();
              var cur = $('#dir-selector-current').val();
              loadDirs(cur.replace(/\/?$/, "/") + name);
          });
      })
      .catch(() => $('#dir-list-container').text("加载失败"));
  }

  // --- Upload Limit ---
  $('#btn-upload-limit').click(function(){
      var loading = layer.load();
      fetch(apiBase+"/api/settings/get-upload-limit").then(r=>r.json()).then(data=>{
          layer.close(loading);
          $('#input-upload-limit').val(data.ok ? data.limit : "");
          layer.open({
              type: 1,
              title: '修改上传限制',
              content: $('#tpl-upload-limit'),
              area: ['400px', '250px']
          });
      }).catch(()=>{ layer.close(loading); layer.msg('获取配置失败'); });
  });

  $('#btn-save-upload-limit').click(function(){
      var val = $('#input-upload-limit').val();
      if(!val) { layer.msg('请输入限制值'); return; }
      apiPost("/api/settings/set-upload-limit", "limit="+encodeURIComponent(val), "修改成功", function(){
          layer.closeAll('page');
      });
  });

  // --- PHP Plugins ---
  $('#btn-php-plugins').click(function(){
      layer.open({
          type: 1,
          title: 'PHP 插件管理',
          content: $('#tpl-php-plugins'),
          area: ['600px', '500px'],
          success: function(){
              loadPluginTable();
          }
      });
  });

  function loadPluginTable() {
      table.render({
          elem: '#plugin-table',
          url: apiBase + '/api/php/extensions',
          parseData: function(res){
              // Transform data
              var list = [];
              if(Array.isArray(res)) list = res;
              // Add default plugins if not in list (optional, but old logic did it)
              // Actually old logic fetched status and matched against default list.
              // Let's stick to what API returns for now, or merge with default list.
              // To keep it simple, let's just show what API returns + merge logic from old script?
              // Old script: pluginPackagesFromDefault() -> filter installedMap.
              // The API /api/php/extensions returns ALL installed extensions.
              // But we want to show installable ones too?
              // Actually /api/php/extensions ONLY returns `php -m` result (installed ones).
              // The old script hardcoded a list of "available" extensions in `defaultPhpExtensions`.
              // We need that list to show what can be installed.
              
              var installedMap = {};
              if(res) res.forEach(r => installedMap[r.name] = true);
              
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
          height: 350
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

});
