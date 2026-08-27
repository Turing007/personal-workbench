@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-workbench-dev.ps1"
exit /b %errorlevel%