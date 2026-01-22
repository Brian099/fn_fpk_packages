#!/bin/bash

# ./fnpack create fn-kodi -t docker --without-ui true
# ./fnpack build --directory fn-kodi

curl -kL https://static2.fnnas.com/fnpack/fnpack-1.0.4-linux-amd64 -o fnpack
sudo chmod +x fnpack

for APP in fn-*; do
  [ -f "${APP}/norelease" ] && continue
  [ -f "${APP}/manifest" ] || continue
  echo "Building ${APP} ..."
  ./fnpack build --directory ${APP}
  APPNAME=$(grep '^appname' "$APP/manifest" | awk -F= '{print $2}' | xargs)
  VERSION=$(grep '^version' "$APP/manifest" | awk -F= '{print $2}' | xargs)
  mv -f "${APPNAME}.fpk" "${APPNAME}_v${VERSION}.fpk"
done