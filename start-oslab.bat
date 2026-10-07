@echo off
chcp 65001 >nul
title 立体课本 - 操作系统运行实验台
cd /d "%~dp0"

rem --- 解析 node.exe:优先 PATH,回退常见安装位置 ---
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE (
  echo [os-lab] 未找到 Node.js,请先安装: https://nodejs.org/
  pause
  exit /b 1
)

rem --- dist 缺失时自动构建 ---
if not exist "dist\index.html" (
  echo [os-lab] 首次运行:正在构建产物,约需 1 分钟...
  for %%I in ("%NODE_EXE%") do set "NPM_CMD=%%~dpInpm.cmd"
  if exist "%NPM_CMD%" call "%NPM_CMD%" run build
)
if not exist "dist\index.html" (
  echo [os-lab] 构建产物缺失,请在项目目录手动运行: npm run build
  pause
  exit /b 1
)

echo [os-lab] 正在启动实验台...
"%NODE_EXE%" serve.mjs
