@echo off
setlocal enabledelayedexpansion

REM Multilat PNG Processor Installer (Windows)
REM Right-Click This File And Choose "Run As Administrator"

REM Photoshop's Presets Folder Lives Under Program Files, Which Is Protected,
REM So This Installer Re-Launches Itself Elevated If It Is Not Already.
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator Rights...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ================================
echo Multilat PNG Processor Installer
echo ================================
echo.

set "SCRIPT_DIR=%~dp0"
set "SOURCE=%SCRIPT_DIR%Multilat-PNG-Processor.jsx"

if not exist "%SOURCE%" (
    echo ERROR: Multilat-PNG-Processor.jsx Not Found Beside This Installer.
    echo.
    pause
    exit /b 1
)

set /a FOUND=0

REM Photoshop Only Lists Scripts From The APPLICATION Presets Folder.
for %%P in ("%ProgramFiles%\Adobe" "%ProgramFiles(x86)%\Adobe") do (
    if exist "%%~P" (
        for /d %%D in ("%%~P\Adobe Photoshop *") do (
            set "TARGET_DIR=%%~D\Presets\Scripts"
            if exist "!TARGET_DIR!" (
                echo Found: %%~nxD
                echo Installing To: !TARGET_DIR!
                copy /Y "%SOURCE%" "!TARGET_DIR!\Multilat-PNG-Processor.jsx" >nul
                if !errorLevel! equ 0 (
                    echo Installed Successfully.
                    set /a FOUND+=1
                ) else (
                    echo FAILED To Install For %%~nxD
                )
                echo.
            )
        )
    )
)

if %FOUND% equ 0 (
    echo ERROR: No Photoshop Installation Was Found Under Program Files.
    echo.
    pause
    exit /b 1
)

echo ================================
echo Installation Complete
echo ================================
echo.
echo To Use The Script:
echo.
echo 1. Quit Photoshop Completely
echo 2. Reopen Photoshop
echo 3. Go To: File ^> Scripts ^> Multilat-PNG-Processor
echo.
echo The Scripts Menu Is Only Read At Launch, So The Restart Matters.
echo.
pause
