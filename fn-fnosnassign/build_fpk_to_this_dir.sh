#!/bin/bash

WORKDIR="$(cd "$(dirname "$0")" && pwd)"
cd "${WORKDIR}"

echo ">>> 第一步: 编译双架构后端并同步资源..."
if [ -f "./serverSourceCode/build_sourceCode.sh" ]; then
    bash "./serverSourceCode/build_sourceCode.sh"
    
    # --- 新增：强制同步二进制文件到打包目录 ---
    echo ">>> 同步双架构二进制文件到 app/server/..."
    mkdir -p "./app/server/amd64" "./app/server/arm64"
    cp -f "./serverSourceCode/server/amd64/fnosnassign_x86_64" "./app/server/amd64/"
    cp -f "./serverSourceCode/server/arm64/fnosnassign_aarch64" "./app/server/arm64/"
    echo ">>> 同步完成！"
else
    echo "错误: 未找到 serverSourceCode/build_sourceCode.sh"
    exit 1
fi

# --- 版本号自动管理 ---
if [ -f "${WORKDIR}/manifest" ]; then
    CUR_VERSION=$(grep -w '^version' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
    if [ ! -z "$CUR_VERSION" ]; then
        # 拆分主版本号和修订号 (例如 1.0.0 -> 1.0 和 0)
        BASE_VERSION=${CUR_VERSION%.*}
        PATCH_VERSION=${CUR_VERSION##*.}
        # 修订号加 1
        NEW_PATCH=$((PATCH_VERSION + 0))
        NEW_VERSION="${BASE_VERSION}.${NEW_PATCH}"
        
        # 使用 sed 更新 manifest 文件
        # 注意：这里使用了特殊的正则来精确匹配 version 这一行
        sed -i "s/^version[[:space:]]*=.*/version               = ${NEW_VERSION}/" "${WORKDIR}/manifest"
        echo ">>> 版本号已自动升级: ${CUR_VERSION} -> ${NEW_VERSION}"
    fi
fi

# 重新从 manifest 中提取最新的元数据
APPNAME=$(grep -w '^appname' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
VERSION=$(grep -w '^version' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)
PLATFORM=$(grep -w '^platform' "${WORKDIR}/manifest" | awk -F= '{print $2}' | xargs)

echo ">>> 第二步: 正在打包: ${APPNAME} v${VERSION} [${PLATFORM}]"

# 清理旧包
rm -f "${WORKDIR}/${APPNAME}.fpk"
rm -f "${WORKDIR}/${APPNAME}_${PLATFORM}_v${VERSION}.fpk"

# 检查双架构二进制文件
if [ ! -f "./app/server/amd64/fnosnassign_x86_64" ]; then
    echo "错误: 未找到 amd64 二进制文件"
    exit 1
fi
if [ ! -f "./app/server/arm64/fnosnassign_aarch64" ]; then
    echo "错误: 未找到 arm64 二进制文件"
    exit 1
fi

# 检查 fnpack.exe
if [ -f "./fnpack.exe" ]; then
    echo ">>> 使用 fnpack.exe 执行构建..."
    ./fnpack.exe build --directory .
    
    # 构建后的文件重命名
    if [ -f "${APPNAME}.fpk" ]; then
        mv "${APPNAME}.fpk" "${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
        echo ">>> 打包成功: ${APPNAME}_${PLATFORM}_v${VERSION}.fpk"
    else
        echo "错误: 打包失败，未生成 ${APPNAME}.fpk"
        exit 1
    fi
else
    echo "错误: 当前目录未找到 fnpack.exe"
    exit 1
fi

exit 0
