#!/bin/bash

WORKDIR="$(cd "$(dirname "$0")" && pwd)"
PARENTDIR="${WORKDIR}"

ARCH=(
  x86_64
  aarch64
)

for a in "${ARCH[@]}"; do
  echo "Building appcenter (Linux $a)..."
  bash "${WORKDIR}/serverSourceCode/build_sourceCode.sh" $a
done

# Auto-increment version in manifest
if [ -f "${WORKDIR}/manifest" ]; then
  CUR_VERSION=$(grep -w '^version' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
  if [ ! -z "$CUR_VERSION" ]; then
    BASE_VERSION=${CUR_VERSION%.*}
    PATCH_VERSION=${CUR_VERSION##*.}
    NEW_PATCH=$((PATCH_VERSION + 1))
    NEW_VERSION="${BASE_VERSION}.${NEW_PATCH}"
    # Use sed to replace the version line specifically
    sed -i "s/^version[[:space:]]*=.*/version               = ${NEW_VERSION}/" "${WORKDIR}/manifest"
    echo "Auto-incremented version: ${CUR_VERSION} -> ${NEW_VERSION}"
  fi
fi

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
