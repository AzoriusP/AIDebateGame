@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   《抬杠模拟器》DEMO  启动中...
echo   启动后请在浏览器打开 http://localhost:8787
echo ============================================

REM 找 Python：PATH 内 python → py 启动器 → 回落本项目已验证的解释器（含 edge-tts）
set "PYCMD="
where python >nul 2>nul && set "PYCMD=python"
if not defined PYCMD (
  py -3 -c "import sys" >nul 2>nul && set "PYCMD=py -3"
)
if not defined PYCMD (
  set "PYFALLBACK=C:\Users\王鼎元\.workbuddy\binaries\python\versions\3.13.12\python.exe"
  if exist "%PYFALLBACK%" set "PYCMD=%PYFALLBACK%"
)
if not defined PYCMD (
  echo [错误] 未找到 Python。请安装 Python 3.8+ 并加入 PATH，或编辑本文件指定解释器路径。
  pause
  exit /b 1
)

echo 使用解释器: %PYCMD%
%PYCMD% server.py
echo.
echo [后端已退出] 上方如有报错请截图发给助手；无报错则说明是手动关闭。
pause
