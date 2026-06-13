#!/bin/bash

WORKDIR="$(cd "$(dirname "$0")" && pwd)"
PARENTDIR="$(dirname "${WORKDIR}")"

# 自动递增版本号小版本 (如果需要的话，可以取消下方注释)
# if [ -f "${WORKDIR}/manifest" ]; then
#   CUR_VERSION=$(grep -w '^version' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
#   if [ ! -z "$CUR_VERSION" ]; then
#     BASE_VERSION=${CUR_VERSION%.*}
#     PATCH_VERSION=${CUR_VERSION##*.}
#     NEW_PATCH=$((PATCH_VERSION + 1))
#     NEW_VERSION="${BASE_VERSION}.${NEW_PATCH}"
#     sed -i "s/^version[[:space:]]*=.*/version               = ${NEW_VERSION}/" "${WORKDIR}/manifest"
#     echo "Auto-incremented version: ${CUR_VERSION} -> ${NEW_VERSION}"
#   fi
# fi

APPNAME=$(grep -w '^appname' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
VERSION=$(grep -w '^version' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
PLATFORM=$(grep -w '^platform' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)

echo "Packaging: ${APPNAME} v${VERSION} [${PLATFORM}]"

cd "${WORKDIR}"

# 寻找合适的打包工具进行打包
if command -v fnpack &> /dev/null; then
  echo "Using global fnpack tool..."
  fnpack build --directory .
  rm -f "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  mv "${APPNAME}.fpk" "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
elif [[ -x "${PARENTDIR}/fnpack" ]]; then
  echo "Using local fnpack..."
  rm -f "${PARENTDIR}/${APPNAME}.fpk"
  rm -f "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  cd "${PARENTDIR}"
  ./fnpack build --directory "${WORKDIR}"
  mv "${APPNAME}.fpk" "${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  cd "${WORKDIR}"
elif [[ -x "${PARENTDIR}/fnpack.exe" ]]; then
  echo "Using fnpack.exe (Windows)..."
  rm -f "${PARENTDIR}/${APPNAME}.fpk"
  rm -f "${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  cd "${PARENTDIR}"
  ./fnpack.exe build --directory "${WORKDIR}"
  mv "${APPNAME}.fpk" "${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
  cd "${WORKDIR}"
else
  echo "Error: fnpack / fnpack.exe not found in PATH or parent directory."
  echo "Please download fnpack from https://static2.fnnas.com/fnpack/fnpack-1.0.4-linux-amd64 and place it in ${PARENTDIR}"
  exit 1
fi

echo "✅ Build Complete: ${PARENTDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
exit 0
