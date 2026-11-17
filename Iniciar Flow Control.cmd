@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PYTHON_EXE="
if defined FLOW_PYTHON call :try_runtime "%FLOW_PYTHON%"
if not defined PYTHON_EXE call :try_runtime "%~dp0.venv\Scripts\python.exe"
if not defined PYTHON_EXE (
    where python >nul 2>&1
    if not errorlevel 1 call :try_runtime python
)
if not defined PYTHON_EXE (
    where py >nul 2>&1
    if not errorlevel 1 call :try_runtime py
)
if not defined PYTHON_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" call :try_runtime "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not defined PYTHON_EXE (
    echo [ERRO] Nenhum runtime Python com FastAPI, Uvicorn e pydantic_core foi encontrado.
    echo Configure FLOW_PYTHON ou instale dependencias compativeis no .venv.
    exit /b 1
)

echo Runtime validado: %PYTHON_EXE%

set "LOG_FILE=%TEMP%\flow-control-server.log"
set "PS_EXE=powershell"
set "PS_NO_PROXY=-Proxy $null"
where pwsh >nul 2>&1
if not errorlevel 1 (
    set "PS_EXE=pwsh"
    set "PS_NO_PROXY=-NoProxy"
)

rem Reutiliza uma instancia saudavel sem encerrar processos existentes.
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 3;$i++){try{$h=Invoke-WebRequest -UseBasicParsing %PS_NO_PROXY% http://127.0.0.1:5027/api/health -TimeoutSec 1; if($h.StatusCode -eq 200){$p=Invoke-RestMethod %PS_NO_PROXY% http://127.0.0.1:5027/api/products -TimeoutSec 1; if(@($p).Count -eq 13){$ok=$true;break}}}catch{}; Start-Sleep -Milliseconds 250}; if($ok){exit 0}; exit 1"
if errorlevel 1 (
    echo Iniciando o servidor Flow Control na porta 5027...
    start "Flow Control" /b "%ComSpec%" /d /c ""%PYTHON_EXE%" backend\run_server.py 1>"%LOG_FILE%" 2>&1"
) else (
    echo O servidor Flow Control ja esta respondendo na porta 5027.
)

rem So abre o navegador depois de confirmar health e a API de produtos.
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 30;$i++){try{$h=Invoke-WebRequest -UseBasicParsing %PS_NO_PROXY% http://127.0.0.1:5027/api/health -TimeoutSec 1; if($h.StatusCode -eq 200){$p=Invoke-RestMethod %PS_NO_PROXY% http://127.0.0.1:5027/api/products -TimeoutSec 1; if(@($p).Count -eq 13){$ok=$true;break}}}catch{}; Start-Sleep -Milliseconds 500}; if($ok){exit 0}; exit 1"
if errorlevel 1 (
    echo [ERRO] O servidor nao respondeu ao health/API em 30 segundos.
    echo Consulte o log: %LOG_FILE%
    if exist "%LOG_FILE%" type "%LOG_FILE%"
    exit /b 1
)

echo Servidor validado. Abrindo http://127.0.0.1:5027
start "" http://127.0.0.1:5027
endlocal
goto :eof

:try_runtime
set "CANDIDATE=%~1"
if not defined CANDIDATE exit /b 1
"%CANDIDATE%" -c "from pathlib import Path; import sys; sys.path.insert(0, str(Path('backend/run_server.py').resolve().parents[1])); import backend.run_server; import fastapi, uvicorn, pydantic_core" >nul 2>&1
if errorlevel 1 exit /b 1
set "PYTHON_EXE=%CANDIDATE%"
exit /b 0
