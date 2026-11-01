@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo Installing project dependencies...
  call npm.cmd install --cache .npm-cache
  if errorlevel 1 goto :error
)

echo Starting Shanghai breakfast accessibility dashboard...
call npm.cmd run dev -- --host 0.0.0.0 --open
goto :eof

:error
echo.
echo Dependency installation failed. Check Node.js and network access.
pause
