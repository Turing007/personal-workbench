$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$DevPidFile = Join-Path $Root '.workbench-dev.pid'
$ProdPidFile = Join-Path $Root '.workbench.pid'
$VitePort = 52342
$ServerPort = 52341
$DevUrl = "http://127.0.0.1:$VitePort/"

function Test-DevReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $DevUrl -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-NodeCommandLine([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return $null
  }
}

function Stop-WorkbenchOnPort([int]$Port) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  $seen = @{}
  foreach ($listener in $listeners) {
    $ownerPid = [int]$listener.OwningProcess
    if ($seen.ContainsKey($ownerPid)) { continue }
    $seen[$ownerPid] = $true
    $commandLine = Get-NodeCommandLine $ownerPid
    if ($commandLine -match 'dist[\\/]server[\\/]main\.js|tsx.*src[\\/]server[\\/]main\.ts') {
      Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped workbench process $ownerPid (listening on $Port)."
    } else {
      throw "Port $Port is used by PID $ownerPid which is not a workbench process. Stop it manually first."
    }
  }
}

try {
  # 1) 如果开发模式已经在运行，直接打开页面
  if (Test-Path -LiteralPath $DevPidFile) {
    $oldPid = 0
    if ([int]::TryParse((Get-Content -Raw -LiteralPath $DevPidFile).Trim(), [ref]$oldPid) -and $oldPid -gt 0) {
      $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
      if ($oldProcess -and (Test-DevReady)) {
        Write-Host "Dev mode is already running: $DevUrl"
        Start-Process $DevUrl
        exit 0
      }
    }
    Remove-Item -LiteralPath $DevPidFile -Force -ErrorAction SilentlyContinue
  }

  # 2) 停掉占用的服务端进程（生产模式或残留 dev 服务端），vite 代理才能工作
  Stop-WorkbenchOnPort $ServerPort
  Remove-Item -LiteralPath $ProdPidFile -Force -ErrorAction SilentlyContinue

  # 3) 检查 vite 端口是否空闲
  if ((Get-NetTCPConnection -State Listen -LocalPort $VitePort -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "Port $VitePort is already in use."
  }

  # 4) 启动 npm run dev（vite 热更新 + tsx watch 服务端）
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw 'npm.cmd not found. Node.js is required.' }
  $dataDir = Join-Path $Root 'data'
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $stdoutLog = Join-Path $dataDir 'workbench-dev.log'
  $stderrLog = Join-Path $dataDir 'workbench-dev-error.log'
  $devProcess = Start-Process -FilePath $npm.Source `
    -ArgumentList @('run', 'dev') `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog
  Set-Content -LiteralPath $DevPidFile -Value $devProcess.Id -Encoding ascii

  # 5) 等待就绪（vite 首次编译可能需要一些时间）
  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if (Test-DevReady) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    & taskkill /PID $devProcess.Id /T /F 2>$null | Out-Null
    Remove-Item -LiteralPath $DevPidFile -Force -ErrorAction SilentlyContinue
    throw "Dev server did not become ready in 90 seconds. Check $stderrLog."
  }

  Write-Host "Dev mode started: $DevUrl"
  Write-Host 'Edits to src are hot-reloaded automatically - no rebuild needed.'
  Start-Process $DevUrl
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}