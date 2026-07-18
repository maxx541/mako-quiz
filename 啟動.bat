@echo off
rem Launcher for Makoquiz. All logic lives in start.ps1.
rem Args are passed through, e.g.: -Port 3100 -NoTunnel -Rebuild
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
