#!/bin/bash

# ./fnpack create fn-kodi -t docker --without-ui true
# ./fnpack build --directory fn-kodi

curl -kL https://static2.fnnas.com/fnpack/fnpack-1.0.4-linux-amd64 -o fnpack
sudo chmod +x fnpack

for APP in fn-*; do
  [ -f "${APP}/norelease" ] && continue
  [ -f "${APP}/manifest" ] || continue
  echo "Building ${APP} ..."
  APPNAME=$(grep '^appname' "$APP/manifest" | awk -F= '{print $2}' | xargs)
  VERSION=$(grep '^version' "$APP/manifest" | awk -F= '{print $2}' | xargs)

  if [ -f "${APP}/build.sh" ]; then
    chmod +x "$(realpath "${APP}")/build.sh"
    "$(realpath "${APP}")/build.sh"
    [ $? -ne 0 ] && echo "Build script failed for ${APP}" && exit 1
  else
    ./fnpack build --directory ${APP}
    mv -f "${APPNAME}.fpk" "${APPNAME}_v${VERSION}.fpk"
  fi

done
