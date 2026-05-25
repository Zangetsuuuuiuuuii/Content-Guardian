@echo off
color 0B
title Content Guardian - Access Key Manager
cls
echo.
echo Starting Access Key Manager...
echo.
cd /d "%~dp0backend"
python key_manager_cli.py
pause
