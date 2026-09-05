@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM  Double-clickable deploy for gold-khata-book-backend.
REM
REM  Exists so deploying does not require opening a terminal or remembering any
REM  flags: double-click this file, answer two questions, read the result.
REM
REM  All the real work is in deploy.sh. This only asks the questions and calls
REM  it, so there is no second implementation to drift out of sync.
REM
REM  The `pause` at the end is not decoration: a double-clicked console window
REM  closes the instant the script exits, so without it a failure would flash
REM  past unread and the deploy would look like it did nothing.
REM ============================================================================

cd /d "%~dp0.."

echo.
echo  ============================================
echo   Gold Khata Book backend deploy
echo  ============================================
echo.

REM --- Locate Git Bash --------------------------------------------------------
REM Not `where bash`: that can resolve to the WSL shim, which has its own
REM filesystem and SSH config, and would fail with a confusing "cannot SSH".
set "BASH_EXE="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH_EXE=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"

if not defined BASH_EXE (
    echo  ERROR: Git Bash not found.
    echo  Install Git for Windows: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

REM --- Environment ------------------------------------------------------------
echo  Which environment?
echo.
echo    1^) dev       ^(port 7111^)  - safe to break
echo    2^) prod      ^(port 7110^)  - REAL SHOPS
echo    3^) inspect   - just show what each server is running, change nothing
echo.
set "ENVCHOICE="
set /p "ENVCHOICE=  Enter 1-3 [1]: "
if "!ENVCHOICE!"=="" set "ENVCHOICE=1"

if "!ENVCHOICE!"=="3" (
    echo.
    "%BASH_EXE%" scripts/deploy.sh --inspect
    echo.
    pause
    exit /b 0
)

if "!ENVCHOICE!"=="1" set "ENVNAME=dev"
if "!ENVCHOICE!"=="2" set "ENVNAME=prod"

if not defined ENVNAME (
    echo.
    echo  ERROR: "!ENVCHOICE!" is not a valid choice.
    echo.
    pause
    exit /b 1
)

REM --- Branch -----------------------------------------------------------------
REM Blank means "use the configured branch", which is what you want almost
REM always. Naming a branch here applies to this run only and is never saved.
echo.
echo  Which branch? Press Enter for the normal one ^(main^).
echo  Type a branch name only to test a feature branch on a lower environment.
echo.
set "BRANCHNAME="
set /p "BRANCHNAME=  Branch [main]: "

REM --- Confirm ----------------------------------------------------------------
echo.
echo  ------------------------------------------------
echo   Environment : !ENVNAME!
if defined BRANCHNAME (
    echo   Branch      : !BRANCHNAME!   ^<-- NOT the default
) else (
    echo   Branch      : ^(configured default^)
)
echo  ------------------------------------------------
echo.

if "!ENVNAME!"=="prod" (
    echo  *** This is PRODUCTION. Real shops will run this code. ***
    echo.
)

set "GO="
set /p "GO=  Continue? [y/N]: "
if /i not "!GO!"=="y" (
    echo.
    echo  Cancelled. Nothing was changed.
    echo.
    pause
    exit /b 0
)

REM --- Deploy -----------------------------------------------------------------
echo.
if defined BRANCHNAME (
    "%BASH_EXE%" scripts/deploy.sh --env !ENVNAME! --branch !BRANCHNAME!
) else (
    "%BASH_EXE%" scripts/deploy.sh --env !ENVNAME!
)
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
    echo  ============================================
    echo   Deploy finished OK.
    echo  ============================================
) else (
    echo  ============================================
    echo   DEPLOY FAILED ^(exit code %RESULT%^)
    echo   Nothing above said "Deployed" - read the
    echo   error and fix it before trying again.
    echo  ============================================
)
echo.
pause
exit /b %RESULT%
