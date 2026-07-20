@echo off
title GARGANTUA - Local Server
color 0A

echo ==========================================
echo         GARGANTUA WEB SERVER
echo ==========================================
echo.

cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    pause
    exit /b
)

:: Install http-server if missing
call npx http-server --version >nul 2>&1
if errorlevel 1 (
    echo Installing http-server...
    call npm install -g http-server
)

echo.
echo Starting server...
echo.
echo Localhost:
echo http://127.0.0.1:8000
echo.
echo LAN:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    set IP=%%A
    goto :found
)

:found
set IP=%IP: =%
if not "%IP%"=="" echo http://%IP%:8000

echo.
echo Press Ctrl + C to stop the server.
echo ==========================================
echo.

start "" http://127.0.0.1:8000

call npx http-server -p 8000

pause