@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js กรุณาติดตั้ง Node.js 22 ขึ้นไป
  pause
  exit /b 1
)
node "%~dp0import-companies.mjs"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
