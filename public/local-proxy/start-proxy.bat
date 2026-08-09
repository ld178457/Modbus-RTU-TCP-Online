@echo off
setlocal EnableExtensions

REM PORT = local listen port of THIS proxy (browser connects here). Must match frontend LOCAL_PROXY_URL (ws://127.0.0.1:8765). It is NOT the device Modbus port (that is typed in the web UI, default 502).
set "PORT=8765"
set "SCRIPT_DIR=%~dp0"
set "LOG=%SCRIPT_DIR%relay.log"

echo ============================================
echo  Modbus TCP local proxy (WebSocket -^> TCP relay)
echo  Listening on ws://127.0.0.1:%PORT%
echo  Log file: %LOG%
echo ============================================
echo.

set "PY="

REM --- 1. probe command names on PATH ---
for %%C in (py python python3) do (
    if not defined PY (
        "%%C" -c "import sys" >nul 2>&1 && set "PY=%%C"
    )
)

REM --- 2. probe known install paths ---
if not defined PY (
    for %%P in (
        "C:\Users\24432\.workbuddy\binaries\python\versions\3.13.12\python.exe"
        "E:\anaconda\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
        "%ProgramFiles%\Python\Python313\python.exe"
        "%ProgramFiles%\Python\Python312\python.exe"
        "%ProgramFiles%\Python\Python311\python.exe"
        "C:\Python313\python.exe"
        "C:\Python312\python.exe"
        "C:\Python311\python.exe"
    ) do (
        if not defined PY if exist %%P set "PY=%%~P"
    )
)

if not defined PY (
    echo.
    echo [ERROR] Python interpreter was not found.
    echo Please install Python 3.7+ and check "Add Python to PATH",
    echo or add your python.exe path into the probe list in this script.
    echo Download: https://www.python.org/downloads/
    echo.
    echo [%date% %time%] [ERROR] Python not found >> "%LOG%"
    echo.
    pause
    exit /b 1
)

echo [INFO] Using Python: %PY%
echo [INFO] Starting modbus_relay.py on port %PORT% ...
echo.

cd /d "%SCRIPT_DIR%"
"%PY%" modbus_relay.py %PORT%

set "RC=%errorlevel%"
echo.
echo [DONE] Proxy stopped. Exit code: %RC%
echo Log saved to: %LOG%
echo.
pause
