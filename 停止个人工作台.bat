@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-workbench.ps1"
exit /b %errorlevel%
