@echo off
color 0B
title Content Guardian Control Panel
cls

:: Create required directories
if not exist "%APPDATA%\ContentGuardian" mkdir "%APPDATA%\ContentGuardian"

:mainMenu
cls
echo ===============================================
echo           CONTENT GUARDIAN CONTROL PANEL
echo ===============================================
echo.
echo  1. Access Key Manager
echo  2. View Blocked Sites
echo  3. Exit
echo.
echo ===============================================
echo.
set /p choice="Select an option (1-3): "

if "%choice%"=="1" goto keyManager
if "%choice%"=="2" goto viewBlocked
if "%choice%"=="3" goto exitProgram
goto mainMenu

:keyManager
cls
echo Opening Key Manager...
start "" "%~dp0key_manager.bat"
timeout /t 2 >nul
goto mainMenu

:viewBlocked
cls
echo ===============================================
echo              RECENTLY BLOCKED SITES
echo ===============================================
echo.

set "blocklog=%APPDATA%\ContentGuardian\blocked_sites.txt"

if not exist "%blocklog%" (
    echo No sites have been blocked yet.
    echo.
    echo You may need to visit some sites with the Content Guardian
    echo extension enabled in your browser to build up this list.
) else (
    type "%blocklog%"
)
echo.
echo ===============================================
echo.
echo Press any key to return to the main menu...
pause >nul
goto mainMenu

:exitProgram
cls
echo Thank you for using Content Guardian.
echo Stay safe online!
echo.
timeout /t 2 >nul
exit 