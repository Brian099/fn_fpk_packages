#!/bin/bash
echo "Content-type: text/html"
echo ""
cat << EOF
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Redirecting...</title>
</head>
<body>
    <script>
        // Redirect to the application port
        var port = "8000";
        var protocol = window.location.protocol;
        // Note: If the app only supports HTTP, you might force 'http:'
        // protocol = 'http:'; 
        var target = protocol + "//" + window.location.hostname + ":" + port;
        window.location.replace(target);
    </script>
</body>
</html>
EOF
