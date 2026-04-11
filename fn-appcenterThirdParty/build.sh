#!/bin/bash

WORKDIR="$(
  cd "$(dirname "$0")"
  pwd
)"

ARCH=(
  x86_64
  aarch64
)

for a in "${ARCH[@]}"; do
  echo "Building appcenter (Linux $a)..."
  ${WORKDIR}/app/server/build.sh $a
done

APPNAME=$(grep -w '^appname' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
VERSION=$(grep -w '^version' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)

rm -f "${WORKDIR}/app.tgz" "$(dirname "${WORKDIR}")/${APPNAME}_v${VERSION}.fpk" 2>/dev/null || true
(cd "${WORKDIR}/app" && tar -czf "${WORKDIR}/app.tgz" server/appcenter* ui www >/dev/null 2>&1)
tar -czf "$(dirname "${WORKDIR}")/${APPNAME}_v${VERSION}.fpk" -C "${WORKDIR}" cmd config wizard app.tgz ICON.PNG ICON_256.PNG manifest >/dev/null 2>&1
rm -f "${WORKDIR}/app.tgz" 2>/dev/null || true

echo "Done"
exit 0
