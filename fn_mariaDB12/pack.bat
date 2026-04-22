@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 设置文件名
set "manifest_file=manifest"
set "output_dir=outputFPK"

:: 检查manifest文件是否存在
if not exist "%manifest_file%" (
    echo 错误: 找不到 %manifest_file% 文件
    exit /b 1
)

:: 检查fnpack.exe是否存在
if not exist "fnpack.exe" (
    echo 错误: 找不到 fnpack.exe 文件
    exit /b 1
)

:: 提取当前版本号和appname
set "current_version="
set "app_name="
set "found_version=0"
set "found_appname=0"

for /f "usebackq tokens=1,2,*" %%a in ("%manifest_file%") do (
    if "%%a"=="version" (
        set "current_version=%%c"
        set "found_version=1"
    )
    if "%%a"=="appname" (
        set "app_name=%%c"
        set "found_appname=1"
    )
)

:: 检查是否找到版本号
if !found_version! equ 0 (
    echo 错误: 在manifest文件中未找到 version 字段
    exit /b 1
)

:: 检查是否找到appname
if !found_appname! equ 0 (
    echo 错误: 在manifest文件中未找到 appname 字段
    exit /b 1
)

echo 应用名称: !app_name!
echo 当前版本: !current_version!

:: 解析版本号并加1
for /f "tokens=1,2,3 delims=." %%a in ("!current_version!") do (
    set "major=%%a"
    set "minor=%%b"
    set "patch=%%c"
    set /a new_patch=patch + 1
    set "new_version=!major!.!minor!.!new_patch!"
)

echo 新版本: !new_version!

:: 创建临时文件，只修改version行
set "temp_file=%temp%\manifest_temp.txt"

(for /f "usebackq delims=" %%i in ("%manifest_file%") do (
    set "line=%%i"
    :: 检查是否是 version 开头的行（注意空格缩进）
    for /f "tokens=1" %%a in ("%%i") do (
        if "%%a"=="version" (
            echo version               = !new_version!
        ) else (
            echo !line!
        )
    )
)) > "%temp_file%"

:: 将临时文件覆盖原文件
move "%temp_file%" "%manifest_file%" >nul
echo 版本号已更新为: !new_version!

:: 执行fnpack.exe build
echo.
echo 正在执行: fnpack.exe build
fnpack.exe build

:: 检查执行结果
if errorlevel 1 (
    echo 错误: fnpack.exe build 执行失败
    exit /b 1
) else (
    echo fnpack.exe build 执行成功
)

:: ===== 新增：重命名并移动打包文件 =====
echo.
echo 正在处理打包文件...

:: 查找打包生成的文件（假设是当前目录下唯一的.fpk文件或指定名称）
set "source_file="
for %%f in (*.fpk) do (
    set "source_file=%%f"
    goto :found_file
)

:found_file
if not defined source_file (
    echo 警告: 未找到 .fpk 打包文件
    goto :end
)

echo 找到打包文件: !source_file!

:: 创建目标目录（如果不存在）
if not exist "%output_dir%" (
    echo 创建目录: %output_dir%
    mkdir "%output_dir%"
)

:: 构建新文件名: appname_version.fpk
:: 移除appname中可能存在的引号
set "clean_appname=!app_name!"
set "clean_appname=!clean_appname:"=!"

:: 构建目标文件路径
set "target_file=%output_dir%\!clean_appname!_!new_version!.fpk"

:: 重命名并移动文件
echo 移动并重命名文件: !source_file! -^> !target_file!
move "!source_file!" "!target_file!" >nul

if errorlevel 1 (
    echo 错误: 文件移动失败
    exit /b 1
) else (
    echo 成功: 文件已保存为 !target_file!
)

:end
endlocal