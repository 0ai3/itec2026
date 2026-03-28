@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "HOST_IP="

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue ^| Sort-Object RouteMetric, ifMetric ^| Select-Object -First 1; if ($route) { $ip = Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike '169.254.*' } ^| Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { Write-Output $ip } }"`) do (
  set "HOST_IP=%%I"
)

if not defined HOST_IP (
  for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /R /C:"IPv4 Address" /C:"IPv4-adres"') do (
    set "CAND=%%I"
    set "CAND=!CAND: =!"
    if not defined HOST_IP set "HOST_IP=!CAND!"
  )
)

if not defined HOST_IP (
  echo Could not detect local IP. Set NEXT_PUBLIC_YJS_WS_URL manually.
  exit /b 1
)

echo Using HOST_IP=%HOST_IP%

for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue ^| Select-Object -ExpandProperty OwningProcess -Unique"`) do (
  if not "%%P"=="" (
    echo Port 3000 is busy; stopping process %%P
    taskkill /PID %%P /F >nul 2>nul
  )
)

for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -State Listen -LocalPort 1234 -ErrorAction SilentlyContinue ^| Select-Object -ExpandProperty OwningProcess -Unique"`) do (
  if not "%%P"=="" (
    echo Port 1234 is busy; stopping process %%P
    taskkill /PID %%P /F >nul 2>nul
  )
)

timeout /t 1 /nobreak >nul

set "NEXT_DEV_ORIGIN_HOST=%HOST_IP%"
set "NEXT_PUBLIC_YJS_WS_URL=ws://%HOST_IP%:1234"

call npx concurrently -n web,collab -c auto "npm:dev:lan" "npm:collab:server"
