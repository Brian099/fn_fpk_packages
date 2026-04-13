#!/bin/bash

WORKDIR="$(cd "$(dirname "$0")" && pwd)"
PARENTDIR="${WORKDIR}"

ARCH=(
  x86_64
  aarch64
)

for a in "${ARCH[@]}"; do
  echo "Building appcenter (Linux $a)..."
  bash "${WORKDIR}/serverSourceCode/build.sh" $a
done

APPNAME=$(grep -w '^appname' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
VERSION=$(grep -w '^version' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
PLATFORM=$(grep -w '^platform' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)

echo "Packaging: ${APPNAME} v${VERSION} [${PLATFORM}]"

cd "${WORKDIR}"

if command -v fnpack &> /dev/null; then
  echo "Using fnpack tool..."
  fnpack build --directory .
  rm -f "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  mv ${APPNAME}.fpk "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
elif [[ -x "${PARENTDIR}/fnpack.exe" ]]; then
  echo "Using fnpack.exe..."
  rm -f "${PARENTDIR}/${APPNAME}.fpk"
  rm -f "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  cd "${PARENTDIR}"
  ./fnpack.exe build --directory "${WORKDIR}"
  mv "${PARENTDIR}/${APPNAME}.fpk" "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  cd "${WORKDIR}"
else
  echo "Warning: fnpack not found, using tar (may not be compatible with NAS)..."
  rm -f app.tgz
  rm -f "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"

  cd app
  tar -czf ../app.tgz server/appcenter* ui www

  cd ..
  tar -czf "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk" cmd config wizard app.tgz ICON.PNG ICON_256.PNG manifest

  rm -f app.tgz
fi

echo "Done: ${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
ls -la "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
exit 0
