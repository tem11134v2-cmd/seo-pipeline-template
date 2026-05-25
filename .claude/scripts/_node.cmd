@echo off
REM _node.cmd - wrapper that locates node.exe and forwards arguments to it.
REM Reason: Claude Code Desktop may inherit a stale PATH that does not include
REM node, even when node is installed (via scoop, MSI, etc.). This wrapper
REM finds node by checking common install locations and avoids the need to
REM restart Claude Code Desktop after installing node.
REM
REM Usage from skills: .claude\scripts\_node.cmd script.mjs arg1 arg2 ...

setlocal enabledelayedexpansion

REM 1. Already in PATH?
where node >nul 2>&1
if !ERRORLEVEL!==0 (
    node %*
    exit /b !ERRORLEVEL!
)

REM 2. scoop nodejs-lts
if exist "%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe" (
    "%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe" %*
    exit /b !ERRORLEVEL!
)

REM 3. scoop nodejs
if exist "%USERPROFILE%\scoop\apps\nodejs\current\node.exe" (
    "%USERPROFILE%\scoop\apps\nodejs\current\node.exe" %*
    exit /b !ERRORLEVEL!
)

REM 4. system MSI install
if exist "%ProgramFiles%\nodejs\node.exe" (
    "%ProgramFiles%\nodejs\node.exe" %*
    exit /b !ERRORLEVEL!
)

REM 5. user MSI install
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    "%LOCALAPPDATA%\Programs\nodejs\node.exe" %*
    exit /b !ERRORLEVEL!
)

echo [_node.cmd] node.exe not found. Install: scoop install nodejs-lts 1>&2
echo [_node.cmd] Then restart Claude Code Desktop. 1>&2
exit /b 127
