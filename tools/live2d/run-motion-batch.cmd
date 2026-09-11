@echo off
cd /d "%~dp0..\.."
set "TEMP=%CD%\work\live2d\temp"
set "TMP=%TEMP%"
node tools\live2d\batch-parameter-motions.mjs
if errorlevel 1 exit /b 1
node tools\live2d\audit-batch-motions.mjs
if errorlevel 1 exit /b 1
echo Output: %CD%\outputs\live2d-motion-batch
pause
