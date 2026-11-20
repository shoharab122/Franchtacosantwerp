@echo off
setlocal
title French Tacos Antwerp - Staff Clock
cd /d "%~dp0"
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) < 24 ? 1 : 0)" >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
node start.mjs
if errorlevel 1 pause
