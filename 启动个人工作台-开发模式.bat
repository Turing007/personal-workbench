@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-workbench-dev.ps1"
exit /b %errorlevel%