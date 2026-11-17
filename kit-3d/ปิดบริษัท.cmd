@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0import-companies.mjs" --stop
pause
