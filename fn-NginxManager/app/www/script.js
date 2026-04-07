layui.use(['layer', 'form'], function() {
    var layer = layui.layer;
    var $ = layui.jquery;
    var apiBase = '/cgi/ThirdParty/NginxManager/index.cgi';

    function loadStatus() {
        $.getJSON(apiBase + '/api/nginx/status', function(res) {
            var statusText = $('#nginx-status-text');
            var versionText = $('#nginx-version');
            var controls = $('#service-controls');

            if (res.installed) {
                controls.show();
                versionText.text(res.version || '版本未知');
                
                if (res.running) {
                    statusText.text('服务正在运行').css('color', '#5FB878');
                    $('#btn-start').addClass('layui-btn-disabled').prop('disabled', true);
                    $('#btn-stop').removeClass('layui-btn-disabled').prop('disabled', false);
                } else {
                    statusText.text('服务已停止').css('color', '#FF5722');
                    $('#btn-start').removeClass('layui-btn-disabled').prop('disabled', false);
                    $('#btn-stop').addClass('layui-btn-disabled').prop('disabled', true);
                }
            } else {
                statusText.text('未安装').css('color', '#999');
                versionText.text('-');
                controls.hide();
            }
        }).fail(() => layer.msg('环境检测失败', {icon: 2}));
    }

    function apiAction(action, msg) {
        var loadIdx = layer.load(2);
        $.getJSON(apiBase + '/api/nginx/' + action, function(res) {
            layer.close(loadIdx);
            if (res.ok) {
                layer.msg(msg + '成功', {icon: 1});
                loadStatus();
                loadLogs();
            } else {
                layer.alert(res.error || '操作失败', {icon: 2});
            }
        }).fail(() => {
            layer.close(loadIdx);
            layer.msg('请求失败', {icon: 2});
        });
    }

    window.loadLogs = function() {
        $.getJSON(apiBase + '/api/nginx/logs', function(res) {
            if (res.ok) {
                var logBox = $('#nginx-logs');
                logBox.text(res.log || '暂无日志内容');
                logBox.parent().scrollTop(logBox.parent()[0].scrollHeight);
            }
        });
    }


    $('#btn-start').click(() => apiAction('start', '启动'));
    $('#btn-stop').click(() => apiAction('stop', '停止'));
    $('#btn-restart').click(() => apiAction('restart', '重启'));
    $('#btn-reload').click(() => apiAction('reload', '热重载'));

    $('#btn-check-config').click(function() {
        var loadIdx = layer.load(2);
        $.getJSON(apiBase + '/api/nginx/check', function(res) {
            layer.close(loadIdx);
            if (res.ok) {
                layer.alert('<pre style="font-family: monospace;">' + res.output + '</pre>', {
                    title: '语法检测通过',
                    icon: 1,
                    area: ['600px', '400px']
                });
            } else {
                layer.alert('<pre style="color:red; font-family: monospace;">' + res.error + '</pre>', {
                    title: '配置存在错误',
                    icon: 2,
                    area: ['600px', '400px']
                });
            }
        }).fail(() => layer.close(loadIdx));
    });

    loadStatus();
    loadLogs();
    setInterval(loadLogs, 10000); // 10秒自动刷新日志
});
