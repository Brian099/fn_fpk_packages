#!/bin/bash
if [ -z "$1" ]; then
  # Just open the app
  xdg-open "http://localhost/cgi/ThirdParty/musicplayer/index.cgi/index.html"
else
  # Open with file
  FILE_PATH=$(realpath "$1")
  # Simple url encoding for path
  URL_FILE=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$FILE_PATH")
  xdg-open "http://localhost/cgi/ThirdParty/musicplayer/index.cgi/index.html?file=$URL_FILE"
fi
