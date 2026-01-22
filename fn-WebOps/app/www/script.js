(function(){
var apiBase="/cgi/ThirdParty/webops/index.cgi";
var sitesUrl=apiBase+"/api/sites";
var nginxStatusUrl=apiBase+"/api/nginx/status";
var defaultPhpExtensions="php8.2-common\nphp8.2-mysql\nphp8.2-xml\nphp8.2-xmlrpc\nphp8.2-curl\nphp8.2-gd\nphp8.2-imagick\nphp8.2-cli\nphp8.2-dev\nphp8.2-imap\nphp8.2-mbstring\nphp8.2-opcache\nphp8.2-soap\nphp8.2-zip\nphp8.2-bcmath\nphp8.2-intl\nphp8.2-readline\nphp8.2-ldap\nphp8.2-msgpack\nphp8.2-igbinary\nphp8.2-redis\nphp8.2-memcached\nphp8.2-pgsql\nphp8.2-sqlite3\nphp8.2-odbc\nphp8.2-ssh2\nphp8.2-tidy\nphp8.2-xsl\nphp8.2-yaml\nphp8.2-cgi\nphp8.2-fpm";
var statusEl=document.getElementById("status");
var errorEl=document.getElementById("error");
var tbody=document.getElementById("tbody");
var table=document.getElementById("table");
var empty=document.getElementById("empty");
var nginxStatusEl=document.getElementById("nginx-status");
var phpStatusEl=document.getElementById("php-status");
var pluginModal=document.getElementById("php-plugin-modal");
var pluginButton=document.getElementById("edit-php-plugins");
var pluginList=document.getElementById("php-plugin-list");
var pluginCustom=document.getElementById("php-plugin-custom");
var pluginCustomInstall=document.getElementById("php-plugin-custom-install");
var pluginInstallAll=document.getElementById("php-plugin-install-all");
var pluginClose=document.getElementById("php-plugin-close");
function setStatus(text){statusEl.textContent=text}
function showError(msg){errorEl.textContent=msg;errorEl.style.display="block"}
function clearError(){errorEl.textContent="";errorEl.style.display="none"}
function setNginxStatus(data){
if(!data||data.installed===undefined){nginxStatusEl.textContent="Nginx 状态: 未知";return}
if(data.installed){
var text="Nginx 状态: 已安装";
if(data.version){text+=" ("+data.version+")"}
if(data.config_exists){text+="，配置文件存在"}else{text+="，配置文件缺失"}
nginxStatusEl.textContent=text;
}else{
nginxStatusEl.innerHTML="Nginx 状态: 未安装 <button id=\"install-nginx\">一键安装</button>";
var btn=document.getElementById("install-nginx");
if(btn){btn.addEventListener("click",function(){
if(!confirm("将自动执行 apt 安装 Nginx，并启动服务，是否继续？"))return;
nginxStatusEl.textContent="正在安装 Nginx...";
fetch(apiBase+"/api/nginx/install",{method:"POST",cache:"no-store"}).then(function(res){
return res.json().catch(function(){return{ok:false}});
}).then(function(data){
if(data&&data.ok){nginxStatusEl.textContent="Nginx 安装完成";loadNginxStatus();}else{nginxStatusEl.textContent="Nginx 安装失败";}});
});}
}
}
function setPhpStatus(data){
if(!data||data.installed===undefined){phpStatusEl.textContent="PHP 状态: 未知";return}
if(data.installed){
var text="PHP 状态: 已安装";
if(data.version){text+=" ("+data.version+")"}
if(data.fpm_running){text+="，PHP-FPM 运行中"}else{text+="，PHP-FPM 未运行"}
phpStatusEl.textContent=text;
}else{
phpStatusEl.innerHTML="PHP 状态: 未安装 <button id=\"install-php\">一键安装</button>";
var btn=document.getElementById("install-php");
if(btn){btn.addEventListener("click",function(){
if(!confirm("将自动执行 apt 安装 PHP 与 PHP-FPM，并启动服务，是否继续？"))return;
phpStatusEl.textContent="正在安装 PHP...";
fetch(apiBase+"/api/php/install",{method:"POST",cache:"no-store"}).then(function(res){
return res.json().catch(function(){return{ok:false}});
}).then(function(data){
if(data&&data.ok){phpStatusEl.textContent="PHP 安装完成";loadPhpStatus();}else{phpStatusEl.textContent="PHP 安装失败";}});
});}
}
}
function setData(rows){
tbody.innerHTML="";
if(!rows||!rows.length){table.style.display="none";empty.style.display="block";return}
empty.style.display="none";
table.style.display="table";
rows.forEach(function(site){
var tr=document.createElement("tr");
var nameTd=document.createElement("td");
nameTd.textContent=site.name||"";
tr.appendChild(nameTd);
var typeTd=document.createElement("td");
var typeText = "未知";
if(site.mode === "domain") typeText = "域名";
else if(site.mode === "port") typeText = "端口";
typeTd.textContent=typeText;
tr.appendChild(typeTd);
var portTd=document.createElement("td");
var port=site.port||"";
if(port){var tag=document.createElement("span");tag.className="tag";tag.textContent=port;portTd.appendChild(tag)}else{portTd.textContent="-"}
tr.appendChild(portTd);
var rootTd=document.createElement("td");
rootTd.textContent=site.root||"-";
tr.appendChild(rootTd);
var statusTd=document.createElement("td");
var badge=document.createElement("span");
if(site.enabled){badge.className="badge badge-on";badge.textContent="已启用"}else{badge.className="badge badge-off";badge.textContent="未启用"}
statusTd.appendChild(badge);
tr.appendChild(statusTd);
var opTd=document.createElement("td");
if(site.mode !== "domain"){
    var editBtn=document.createElement("button");
    editBtn.textContent="修改端口";
    editBtn.style.fontSize="12px";
    editBtn.onclick=function(){openEditPortModal(site)};
    opTd.appendChild(editBtn);
}
var toggleBtn=document.createElement("button");
if(site.enabled){
  toggleBtn.textContent="停用";
  toggleBtn.style.color="#e67e22";
}else{
  toggleBtn.textContent="启用";
  toggleBtn.style.color="#27ae60";
}
toggleBtn.style.fontSize="12px";
toggleBtn.style.marginLeft="5px";
toggleBtn.onclick=function(){toggleSiteStatus(site)};
opTd.appendChild(toggleBtn);
var delBtn=document.createElement("button");
delBtn.textContent="删除";
delBtn.style.fontSize="12px";
delBtn.style.marginLeft="5px";
delBtn.style.color="#d93025";
delBtn.onclick=function(){deleteSite(site)};
opTd.appendChild(delBtn);
tr.appendChild(opTd);
tbody.appendChild(tr);
});
}
function loadNginxStatus(){
fetch(nginxStatusUrl,{cache:"no-store"}).then(function(res){
if(!res.ok)throw new Error("请求失败: "+res.status);
return res.json();
}).then(function(data){
setNginxStatus(data);
}).catch(function(){
nginxStatusEl.textContent="Nginx 状态: 查询失败";
});
}
function loadPhpStatus(){
fetch(apiBase+"/api/php/status",{cache:"no-store"}).then(function(res){
if(!res.ok)throw new Error("请求失败: "+res.status);
return res.json();
}).then(function(data){
setPhpStatus(data);
}).catch(function(){
phpStatusEl.textContent="PHP 状态: 查询失败";
});
}
function pluginPackagesFromDefault(){
return defaultPhpExtensions.split("\n").filter(function(x){return x&&x.trim();});
}
function runPhpInstall(packages){
if(!packages||!packages.length){alert("没有需要安装的插件");return;}
var body=packages.join("\n");
phpStatusEl.textContent="正在安装 PHP 插件...";
fetch(apiBase+"/api/php/install",{method:"POST",body:body,headers:{"Content-Type":"text/plain"}}).then(function(res){
return res.json().catch(function(){return{ok:false}});
}).then(function(data){
if(data&&data.ok){phpStatusEl.textContent="PHP 插件安装完成";loadPhpStatus();}else{phpStatusEl.textContent="PHP 插件安装失败";}}).catch(function(){
phpStatusEl.textContent="PHP 插件安装失败";
});
}
function deleteSite(site) {
  if(!confirm("确定要删除网站 "+site.name+" 吗？\n删除操作不可恢复，网站配置将被移除。")) return;
  
  setStatus("正在删除网站 "+site.name+"...");
  
  fetch(apiBase+"/api/sites/delete", {
      method: "POST",
      body: "name="+site.name,
      headers: { "Content-Type": "text/plain" }
  }).then(function(res){
      return res.json().catch(function(){ return {ok:false, error:"Parse error"}; });
  }).then(function(data){
      if(data && data.ok) {
          setStatus("网站 "+site.name+" 已删除");
          loadSites();
      } else {
          showError("删除失败: " + (data.error || "未知错误"));
      }
  }).catch(function(err){
      showError("请求失败: " + err.message);
  });
}
function toggleSiteStatus(site) {
    var action = site.enabled ? "disable" : "enable";
    var actionText = site.enabled ? "停用" : "启用";
    
    if(!confirm("确定要" + actionText + "网站 " + site.name + " 吗？")) return;
    
    setStatus("正在" + actionText + "网站 " + site.name + "...");
    
    fetch(apiBase + "/api/sites/" + action, {
        method: "POST",
        body: "name=" + site.name,
        headers: { "Content-Type": "text/plain" }
    }).then(function(res){
        return res.json().catch(function(){ return {ok:false, error:"Parse error"}; });
    }).then(function(data){
        if(data && data.ok) {
            setStatus("网站 " + site.name + " 已" + actionText);
            loadSites();
        } else {
            showError(actionText + "失败: " + (data.error || "未知错误"));
        }
    }).catch(function(err){
        showError("请求失败: " + err.message);
    });
}
function runPhpRemove(packages){
if(!packages||!packages.length){alert("没有需要删除的插件");return;}
var body=packages.join("\n");
phpStatusEl.textContent="正在删除 PHP 插件...";
fetch(apiBase+"/api/php/remove",{method:"POST",body:body,headers:{"Content-Type":"text/plain"}}).then(function(res){
return res.json().catch(function(){return{ok:false}});
}).then(function(data){
if(data&&data.ok){phpStatusEl.textContent="PHP 插件删除完成";loadPhpStatus();}else{phpStatusEl.textContent="PHP 插件删除失败";}}).catch(function(){
phpStatusEl.textContent="PHP 插件删除失败";
});
}
function renderPluginList(){
if(!pluginList)return;
pluginList.innerHTML="";
fetch(apiBase+"/api/php/extensions",{cache:"no-store"}).then(function(res){
if(!res.ok)throw new Error("请求失败: "+res.status);
return res.json();
}).then(function(statusList){
var installedMap={};
if(Array.isArray(statusList)){statusList.forEach(function(item){if(item&&item.name){installedMap[item.name]=!!item.installed;}});}
var pkgs=pluginPackagesFromDefault();
pkgs.forEach(function(name){
var row=document.createElement("div");
row.style.display="flex";
row.style.alignItems="center";
row.style.justifyContent="space-between";
row.style.marginBottom="4px";
var span=document.createElement("span");
span.textContent=name;
span.style.fontFamily="monospace";
span.style.fontSize="12px";
var btnBox=document.createElement("div");
var installed=!!installedMap[name];
if(!installed){
var installBtn=document.createElement("button");
installBtn.textContent="安装";
installBtn.style.marginLeft="4px";
installBtn.addEventListener("click",function(){
if(!confirm("将安装/更新插件 "+name+"，是否继续？"))return;
runPhpInstall([name]);
});
btnBox.appendChild(installBtn);
}else{
var removeBtn=document.createElement("button");
removeBtn.textContent="删除";
removeBtn.style.marginLeft="4px";
removeBtn.addEventListener("click",function(){
if(!confirm("将删除插件 "+name+"，是否继续？"))return;
runPhpRemove([name]);
});
btnBox.appendChild(removeBtn);
}
row.appendChild(span);
row.appendChild(btnBox);
pluginList.appendChild(row);
});
}).catch(function(){
pluginList.textContent="插件状态加载失败";
});
}
if(pluginButton){pluginButton.addEventListener("click",function(){
renderPluginList();
if(pluginCustom)pluginCustom.value="";
pluginModal.style.display="flex";
});}
if(pluginClose){pluginClose.addEventListener("click",function(){
pluginModal.style.display="none";
});}
if(pluginInstallAll){pluginInstallAll.addEventListener("click",function(){
var pkgs=pluginPackagesFromDefault();
if(!pkgs.length){alert("插件列表为空");return;}
if(!confirm("将为列表中所有插件执行安装/更新，是否继续？"))return;
runPhpInstall(pkgs);
});}
if(pluginCustomInstall){pluginCustomInstall.addEventListener("click",function(){
if(!pluginCustom)return;
var name=(pluginCustom.value||"").trim();
if(!name){alert("请输入插件包名");return;}
if(!/^[A-Za-z0-9.+:-]+$/.test(name)){alert("插件包名包含非法字符");return;}
if(!confirm("将安装/更新插件 "+name+"，是否继续？"))return;
runPhpInstall([name]);
});}
function loadSites(){
setStatus("正在加载网站列表...");
clearError();
fetch(sitesUrl,{cache:"no-store"}).then(function(res){
if(!res.ok)throw new Error("请求失败: "+res.status);
return res.json();
}).then(function(data){
setStatus("共 "+(data&&data.length?data.length:0)+" 个网站");
setData(Array.isArray(data)?data:[]);
}).catch(function(err){
setStatus("加载失败");
showError(err.message||"加载失败");
});
}
var createSiteBtn=document.getElementById("create-site-btn");
var createSiteModal=document.getElementById("create-site-modal");
var doCreateSiteBtn=document.getElementById("do-create-site");
var cancelCreateSiteBtn=document.getElementById("cancel-create-site");
var newSiteDomain=document.getElementById("new-site-domain");
var newSitePort=document.getElementById("new-site-port");
var siteModeRadios = document.getElementsByName("site-mode");
var fieldDomain = document.getElementById("field-domain");
var fieldPortHttp = document.getElementById("field-port-http");
var fieldPortHttps = document.getElementById("field-port-https");
var httpsCheckbox = document.getElementById("new-site-https");
var newSitePortSsl = document.getElementById("new-site-port-ssl");
var redirectCheckbox = document.getElementById("new-site-redirect");
var fieldRedirectTarget = document.getElementById("field-redirect-target");
var newSiteRedirectTarget = document.getElementById("new-site-redirect-target");

function updateSiteFormVisibility() {
    var mode = "domain";
    for(var i=0; i<siteModeRadios.length; i++) {
        if(siteModeRadios[i].checked) mode = siteModeRadios[i].value;
    }
    var isHttps = httpsCheckbox ? httpsCheckbox.checked : false;
    var isRedirect = redirectCheckbox ? redirectCheckbox.checked : false;
    
    if (mode === "domain") {
        if(fieldDomain) fieldDomain.style.display = "block";
        if(fieldPortHttp) fieldPortHttp.style.display = "none";
        if(fieldPortHttps) fieldPortHttps.style.display = "none";
    } else {
        if(fieldDomain) fieldDomain.style.display = "none";
        if(fieldPortHttp) fieldPortHttp.style.display = "block";
        if(fieldPortHttps) fieldPortHttps.style.display = isHttps ? "block" : "none";
    }

    if(fieldRedirectTarget) fieldRedirectTarget.style.display = isRedirect ? "block" : "none";
}

if(siteModeRadios.length > 0) {
    for(var i=0; i<siteModeRadios.length; i++) {
        siteModeRadios[i].addEventListener("change", updateSiteFormVisibility);
    }
}
if(httpsCheckbox) httpsCheckbox.addEventListener("change", updateSiteFormVisibility);
if(redirectCheckbox) redirectCheckbox.addEventListener("change", updateSiteFormVisibility);
var newSiteRoot=document.getElementById("new-site-root");
var browseRootBtn=document.getElementById("browse-root");
var dirSelectorModal=document.getElementById("dir-selector-modal");
var dirCurrentPath=document.getElementById("dir-current-path");
var dirUpLevelBtn=document.getElementById("dir-up-level");
var dirList=document.getElementById("dir-list");
var dirSelectConfirm=document.getElementById("dir-select-confirm");
var dirSelectCancel=document.getElementById("dir-select-cancel");

function loadDirs(path){
  dirList.textContent="加载中...";
  fetch(apiBase+"/api/fs/list",{method:"POST",body:path,headers:{"Content-Type":"text/plain"}}).then(function(res){
    return res.json().catch(function(){return{ok:false}});
  }).then(function(data){
    if(!data.ok){dirList.textContent="加载失败: "+(data.error||"未知错误");return;}
    dirCurrentPath.value=data.current;
    dirList.innerHTML="";
    if(data.dirs){
      data.dirs.forEach(function(d){
        var div=document.createElement("div");
        div.textContent=d;
        div.style.padding="4px";
        div.style.cursor="pointer";
        div.addEventListener("click",function(){
          loadDirs(data.current.replace(/\/?$/,"/")+d);
        });
        div.addEventListener("mouseover",function(){div.style.background="#f0f0f0"});
        div.addEventListener("mouseout",function(){div.style.background="transparent"});
        dirList.appendChild(div);
      });
    }
  }).catch(function(){dirList.textContent="请求失败";});
}

if(createSiteBtn){createSiteBtn.addEventListener("click",function(){
  newSiteDomain.value="";
  newSitePort.value="2829";
  newSiteRoot.value="/var/www/html/";
  if(siteModeRadios.length > 0) siteModeRadios[0].checked = true;
  if(httpsCheckbox) httpsCheckbox.checked = false;
  if(newSitePortSsl) newSitePortSsl.value = "8443";
  if(redirectCheckbox) redirectCheckbox.checked = false;
  if(newSiteRedirectTarget) newSiteRedirectTarget.value = "";
  updateSiteFormVisibility();
  createSiteModal.style.display="flex";
});}

if(cancelCreateSiteBtn){cancelCreateSiteBtn.addEventListener("click",function(){
  createSiteModal.style.display="none";
});}

if(doCreateSiteBtn){doCreateSiteBtn.addEventListener("click",function(){
  var mode = "domain";
  for(var i=0; i<siteModeRadios.length; i++) {
      if(siteModeRadios[i].checked) mode = siteModeRadios[i].value;
  }
  
  var root = newSiteRoot.value.trim();
  if(!root){alert("请填写根目录");return;}
  
  var body = "mode="+mode+"\nroot="+root;
   var isHttps = httpsCheckbox && httpsCheckbox.checked;
   
   body += "\nhttps_enabled="+(isHttps?"true":"false");

   var isRewrite = rewriteCheckbox && rewriteCheckbox.checked;
   var rewriteRules = "";
   if(isRewrite) {
       rewriteRules = newSiteRewriteRules.value;
       try {
           var b64Rules = btoa(unescape(encodeURIComponent(rewriteRules)));
           body += "\nrewrite_enabled=true";
           body += "\nrewrite_rules_b64="+b64Rules;
       } catch(e) {
           alert("重写规则编码失败"); return;
       }
   } else {
       body += "\nrewrite_enabled=false";
   }
   
   if (mode === "domain") {
       var domain = newSiteDomain.value.trim();
       if(!domain){alert("请填写域名");return;}
       body += "\ndomain="+domain;
       
       var confirmMsg = "将创建基于域名的网站 "+domain+" (HTTPS: "+(isHttps?"是":"否")+")";
       if(isRewrite) confirmMsg += "\n并包含自定义重写规则";
       confirmMsg += "，是否继续？";
       
       if(!confirm(confirmMsg))return;
   } else {
       var port = newSitePort.value.trim();
       if(!port){alert("请填写HTTP端口");return;}
       body += "\nport="+port;
       
       var portSsl = "";
       if (isHttps) {
           portSsl = newSitePortSsl.value.trim();
           if(!portSsl){alert("请填写HTTPS端口");return;}
           body += "\nport_https="+portSsl;
       }
       
       var confirmMsg = "将创建基于端口的网站 "+port+" (HTTPS: "+(isHttps?"是, 端口 "+portSsl:"否")+")";
       if(isRewrite) confirmMsg += "\n并包含自定义重写规则";
       confirmMsg += "，是否继续？";

       if(!confirm(confirmMsg))return;
   }
   
   fetch(apiBase+"/api/sites/create",{method:"POST",body:body,headers:{"Content-Type":"text/plain"}}).then(function(res){
    return res.json().catch(function(){return{ok:false}});
  }).then(function(data){
    if(data.ok){alert("创建成功");createSiteModal.style.display="none";loadSites();}else{alert("创建失败: "+(data.error||"未知错误"));}
  }).catch(function(){alert("请求失败");});
});}

if(browseRootBtn){browseRootBtn.addEventListener("click",function(){
  dirSelectorModal.style.display="flex";
  loadDirs(newSiteRoot.value||"/");
});}

if(dirUpLevelBtn){dirUpLevelBtn.addEventListener("click",function(){
  var current=dirCurrentPath.value;
  var parent=current.replace(/[^/]+\/?$/,"");
  if(!parent)parent="/";
  loadDirs(parent);
});}

if(dirSelectCancel){dirSelectCancel.addEventListener("click",function(){
  dirSelectorModal.style.display="none";
});}

if(dirSelectConfirm){dirSelectConfirm.addEventListener("click",function(){
  newSiteRoot.value=dirCurrentPath.value;
  dirSelectorModal.style.display="none";
});}

var uploadLimitModal=document.getElementById("upload-limit-modal");
var uploadLimitInput=document.getElementById("upload-limit-input");
var uploadLimitBtn=document.getElementById("upload-limit-btn");
var saveUploadLimitBtn=document.getElementById("save-upload-limit");
var cancelUploadLimitBtn=document.getElementById("cancel-upload-limit");

if(uploadLimitBtn){
  uploadLimitBtn.addEventListener("click",function(){
    uploadLimitModal.style.display="flex";
    uploadLimitInput.value="正在获取...";
    fetch(apiBase+"/api/settings/get-upload-limit",{cache:"no-store"})
    .then(function(res){return res.json();})
    .then(function(data){
      if(data&&data.ok){
        uploadLimitInput.value=data.limit;
      }else{
        uploadLimitInput.value="";
        alert("获取当前限制失败");
      }
    })
    .catch(function(){
      uploadLimitInput.value="";
      alert("获取当前限制失败");
    });
  });
}

if(cancelUploadLimitBtn){
  cancelUploadLimitBtn.addEventListener("click",function(){
    uploadLimitModal.style.display="none";
  });
}

if(saveUploadLimitBtn){
  saveUploadLimitBtn.addEventListener("click",function(){
    var val=uploadLimitInput.value.trim();
    if(!val){alert("请输入限制大小");return;}
    saveUploadLimitBtn.disabled=true;
    saveUploadLimitBtn.textContent="正在保存...";
    fetch(apiBase+"/api/settings/set-upload-limit",{
      method:"POST",
      body:"limit="+encodeURIComponent(val)
    })
    .then(function(res){return res.json();})
    .then(function(data){
      saveUploadLimitBtn.disabled=false;
      saveUploadLimitBtn.textContent="保存并应用";
      if(data&&data.ok){
        alert("修改成功！服务已重启。");
        uploadLimitModal.style.display="none";
      }else{
        alert("修改失败: "+(data.error||"未知错误"));
      }
    })
    .catch(function(e){
      saveUploadLimitBtn.disabled=false;
      saveUploadLimitBtn.textContent="保存并应用";
      alert("请求失败: "+e.message);
    });
  });
}

var editPortModal=document.getElementById("edit-port-modal");
var editSiteNameInput=document.getElementById("edit-site-name");
var editSitePortInput=document.getElementById("edit-site-port");
var editSitePortHttpsInput=document.getElementById("edit-site-port-https");
var doEditPortBtn=document.getElementById("do-edit-port");
var cancelEditPortBtn=document.getElementById("cancel-edit-port");

function openEditPortModal(site){
    editSiteNameInput.value=site.name;
    var ports = (site.port || "").split(",");
    var httpPort = "";
    var httpsPort = "";
    
    ports.forEach(function(p){
        p = p.trim();
        if(p==="443" || p==="8443" || p==="2931") httpsPort = p;
        else if(!httpPort) httpPort = p;
        else if(!httpsPort) httpsPort = p; 
    });
    
    editSitePortInput.value=httpPort;
    editSitePortHttpsInput.value=httpsPort;
    
    editPortModal.style.display="flex";
}

if(cancelEditPortBtn){
    cancelEditPortBtn.addEventListener("click",function(){
        editPortModal.style.display="none";
    });
}

if(doEditPortBtn){
    doEditPortBtn.addEventListener("click",function(){
        var name = editSiteNameInput.value;
        var port = editSitePortInput.value.trim();
        var portHttps = editSitePortHttpsInput.value.trim();
        
        if(!port){alert("请输入HTTP端口");return;}
        
        var body = "name="+encodeURIComponent(name)+"\nport="+port;
        if(portHttps){
            body += "\nport_https="+portHttps;
        }
        
        doEditPortBtn.disabled=true;
        doEditPortBtn.textContent="保存中...";
        
        fetch(apiBase+"/api/sites/update-port",{
            method:"POST",
            body:body,
            headers:{"Content-Type":"text/plain"}
        })
        .then(function(res){return res.json();})
        .then(function(data){
            doEditPortBtn.disabled=false;
            doEditPortBtn.textContent="保存";
            if(data.ok){
                alert("修改成功");
                editPortModal.style.display="none";
                loadSites();
            }else{
                alert("修改失败: "+(data.error||"未知错误"));
            }
        })
        .catch(function(e){
            doEditPortBtn.disabled=false;
            doEditPortBtn.textContent="保存";
            alert("请求失败: "+e.message);
        });
    });
}

document.getElementById("refresh").addEventListener("click",function(){loadSites()});
loadNginxStatus();
loadPhpStatus();
loadSites();
})();