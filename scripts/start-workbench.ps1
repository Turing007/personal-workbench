param([int]$Port = 52341)

$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PidFile = Join-Path $Root '.workbench.pid'
$DevPidFile = Join-Path $Root '.workbench-dev.pid'
$DataDirectory = Join-Path $Root 'data'
$Url = "http://127.0.0.1:$Port/"
$HealthUrl = "http://127.0.0.1:$Port/health"

function Get-SourceVersion {
  try {
    $pkg = Get-Content -Raw -LiteralPath (Join-Path $Root 'package.json') | ConvertFrom-Json
    if ($pkg.version) { return [string]$pkg.version }
  } catch { }
  return '0.0.0'
}

function Get-BuildInfo {
  $infoPath = Join-Path $Root 'dist\build-info.json'
  if (-not (Test-Path -LiteralPath $infoPath)) { return $null }
  try {
    $info = Get-Content -Raw -LiteralPath $infoPath | ConvertFrom-Json
    return @{
      version      = [string]$info.version
      buildTimeUtc = ([DateTime]::Parse([string]$info.buildTime)).ToUniversalTime()
    }
  } catch {
    return $null
  }
}

function Format-LocalTime([DateTime]$UtcTime) {
  return $UtcTime.ToLocalTime().ToString('yyyy-MM-dd HH:mm')
}

function Get-RunningVersion {
  try {
    $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if ($response.ok -and $response.data) { return $response.data }
  } catch { }
  return $null
}

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-BuildStale {
  $serverBuild = Join-Path $Root 'dist\server\main.js'
  $clientBuild = Join-Path $Root 'dist\client\index.html'
  if (-not (Test-Path -LiteralPath $serverBuild) -or -not (Test-Path -LiteralPath $clientBuild)) { return $true }
  $buildInfo = Get-BuildInfo
  $buildTimeUtc = $null
  if ($buildInfo) {
    $buildTimeUtc = $buildInfo.buildTimeUtc
  } else {
    $buildTimeUtc = (Get-Item -LiteralPath $serverBuild).LastWriteTimeUtc
  }
  $watchPaths = @('src', 'package.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.server.json') | ForEach-Object { Join-Path $Root $_ }
  $newest = Get-ChildItem -LiteralPath $watchPaths -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $newest) { return $false }
  return $newest.LastWriteTimeUtc -gt $buildTimeUtc
}

function Get-NodeCommandLine([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return $null
  }
}

function Stop-ExistingWorkbench {
  # 1) 开发模式进程树（npm run dev → tsx / vite），与正式模式共用 API 端口，需要整树停止
  if ($Port -eq 52341 -and (Test-Path -LiteralPath $DevPidFile)) {
    $devPid = 0
    $devPidText = (Get-Content -Raw -LiteralPath $DevPidFile).Trim()
    if ([int]::TryParse($devPidText, [ref]$devPid) -and $devPid -gt 0) {
      if (Get-Process -Id $devPid -ErrorAction SilentlyContinue) {
        & taskkill /PID $devPid /T /F 2>$null | Out-Null
        Write-Host '已停止开发模式服务（开发模式与正式模式共用同一端口）。'
      }
    }
    Remove-Item -LiteralPath $DevPidFile -Force -ErrorAction SilentlyContinue
  }

  # 2) 生产模式服务（PID 文件指向的 Node 进程）
  if (Test-Path -LiteralPath $PidFile) {
    $oldPid = 0
    $oldPidText = (Get-Content -Raw -LiteralPath $PidFile).Trim()
    if ([int]::TryParse($oldPidText, [ref]$oldPid) -and $oldPid -gt 0) {
      $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
      $oldCommandLine = Get-NodeCommandLine $oldPid
      if ($oldProcess -and $oldProcess.ProcessName -eq 'node' -and $oldCommandLine -match 'dist[\\/]server[\\/]main\.js') {
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        Write-Host "已停止旧的工作台服务（PID $oldPid）。"
      }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }

  # 3) 端口上残留的工作台进程（PID 文件丢失的情况）
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  $seen = @{}
  foreach ($listener in $listeners) {
    $ownerPid = [int]$listener.OwningProcess
    if ($seen.ContainsKey($ownerPid)) { continue }
    $seen[$ownerPid] = $true
    $commandLine = Get-NodeCommandLine $ownerPid
    if ($commandLine -match 'dist[\\/]server[\\/]main\.js|tsx.*src[\\/]server[\\/]main\.ts') {
      Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
      Write-Host "已停止占用端口 $Port 的工作台进程（PID $ownerPid）。"
    } else {
      throw "端口 $Port 被其他程序占用（PID $ownerPid），请先关闭该程序再启动。"
    }
  }

  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    $remaining = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
  }
}

try {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw '未找到 Node.js，请先安装 Node.js 22 或更新版本。'
  }

  $sourceVersion = Get-SourceVersion
  $buildInfo = Get-BuildInfo
  $running = Get-RunningVersion

  Write-Host '=============================================='
  Write-Host '              个人工作台 启动器'
  Write-Host '=============================================='
  Write-Host ("源码最新版本   : v{0}" -f $sourceVersion)
  if ($buildInfo) {
    Write-Host ("本地构建产物   : v{0}（{1} 构建）" -f $buildInfo.version, (Format-LocalTime $buildInfo.buildTimeUtc))
  } else {
    Write-Host '本地构建产物   : 尚未构建'
  }
  if ($running) {
    if ($running.mode -eq 'development') {
      Write-Host ("正在运行的服务 : v{0}（开发模式，源码即时生效）" -f $running.version)
    } else {
      $runningLabel = "v{0}" -f $running.version
      if ($running.buildTime) { $runningLabel += "（{0} 构建）" -f (Format-LocalTime ([DateTime]::Parse([string]$running.buildTime))) }
      Write-Host ("正在运行的服务 : {0}" -f $runningLabel)
    }
  } else {
    Write-Host '正在运行的服务 : 无'
  }
  Write-Host '----------------------------------------------'

  # 1) 运行中的服务已是最新构建 → 直接打开
  $stale = Test-BuildStale
  if ($running -and -not $stale) {
    $runningBuildTimeUtc = $null
    if ($running.buildTime) { $runningBuildTimeUtc = ([DateTime]::Parse([string]$running.buildTime)).ToUniversalTime() }
    if ($running.mode -eq 'production' -and [string]$running.version -eq $sourceVersion -and $buildInfo -and $runningBuildTimeUtc -eq $buildInfo.buildTimeUtc) {
      Write-Host "当前运行的服务已是最新版本，直接打开：$Url"
      Start-Process $Url
      exit 0
    }
  }

  # 2) 构建缺失或过期 → 自动重建
  if ($stale) {
    Write-Host '检测到源码比本地构建产物新（或尚未构建），正在重新构建，约需 1-2 分钟，请勿关闭窗口...'
    Push-Location $Root
    try {
      & $npm.Source run build
      if ($LASTEXITCODE -ne 0) { throw '构建失败，请把上方错误信息反馈给开发者。' }
    } finally {
      Pop-Location
    }
    $buildInfo = Get-BuildInfo
    Write-Host '构建完成。'
  }

  # 3) 停掉旧服务，启动新构建
  Stop-ExistingWorkbench

  New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
  $stdoutLog = Join-Path $DataDirectory 'workbench.log'
  $stderrLog = Join-Path $DataDirectory 'workbench-error.log'
  # 让服务进程监听指定端口（config.ts 读取 WORKBENCH_PORT）
  $env:WORKBENCH_PORT = [string]$Port
  $server = Start-Process -FilePath $node.Source `
    -ArgumentList @('dist/server/main.js') `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog
  Set-Content -LiteralPath $PidFile -Value $server.Id -Encoding ascii

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-Health) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    throw "服务启动失败（30 秒内未就绪），请查看 $stderrLog。"
  }

  # 4) 汇报实际启动的版本
  $started = Get-RunningVersion
  Write-Host '=============================================='
  Write-Host ("启动成功：{0}" -f $Url)
  if ($started) {
    if ($started.mode -eq 'development') {
      Write-Host ("启动的服务版本 : v{0}（开发模式）" -f $started.version)
    } else {
      $startedLabel = "v{0}" -f $started.version
      if ($started.buildTime) { $startedLabel += "（{0} 构建）" -f (Format-LocalTime ([DateTime]::Parse([string]$started.buildTime))) }
      Write-Host ("启动的服务版本 : {0}" -f $startedLabel)
      if ([string]$started.version -ne $sourceVersion) {
        Write-Host ("警告：启动的服务版本（v{0}）与源码版本（v{1}）不一致！" -f $started.version, $sourceVersion)
      }
    }
  }

  $lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress -Unique)
  if ($lanAddresses.Count -gt 0) {
    Write-Host '手机访问（同一 Wi-Fi）：'
    foreach ($address in $lanAddresses) {
      Write-Host "  http://${address}:$Port/"
    }
    Write-Host "如果手机打不开该地址，请在 Windows 防火墙放行 TCP 端口 $Port。"
  }
  Write-Host '=============================================='
  Start-Process $Url
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
