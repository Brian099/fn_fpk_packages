@echo off
setlocal enabledelayedexpansion

REM fnpack.exe create fn-kodi -t docker --without-ui true
REM fnpack.exe build --directory fn-kodi

curl -kL https://static2.fnnas.com/fnpack/fnpack-1.0.4-windows-amd64 -o fnpack.exe

for /d %%A in (fn-*) do (
  if exist "%%A\norelease" (
    REM skip
  ) else if exist "%%A\manifest" (
    echo Building %%A ...
    fnpack.exe build --directory %%A

    REM 解析 appname 和 version，只取第一行
    set "APPNAME="
    set "VERSION="

    for /f "tokens=2 delims==" %%i in ('findstr /i /r "^appname *=.*" "%%A\manifest"') do (
      if not defined APPNAME set "APPNAME=%%i"
    )
    for /f "tokens=2 delims==" %%i in ('findstr /i /r "^version *=.*" "%%A\manifest"') do (
      if not defined VERSION set "VERSION=%%i"
    )

    for /f "tokens=* delims= " %%i in ("!APPNAME!") do set "APPNAME=%%i"
    for /f "tokens=* delims= " %%i in ("!VERSION!") do set "VERSION=%%i"

    if defined APPNAME if defined VERSION if exist "!APPNAME!.fpk" (
      move /y "!APPNAME!.fpk" "!APPNAME!_v!VERSION!.fpk" >nul
    )
  )
)
