param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PidFile = Join-Path $Root '.workbench.pid'
$DataDirectory = Join-Path $Root 'data'
$Port = if ($env:WORKBENCH_PORT) { [int]$env:WORKBENCH_PORT } else { 52341 }
$Url = "http://127.0.0.1:$Port/"
$HealthUrl = "http://127.0.0.1:$Port/health"

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-RunningVersion {
  # 返回正在运行服务的版本信息（/health），不可达时返回 $null。
  try {
    $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if ($response.ok) { return $response.data }
    return $null
  } catch {
    return $null
  }
}

function Get-NodeCommandLine([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return $null
  }
}

function Get-SourceNewestUtc {
  $files = @(Get-ChildItem -LiteralPath (Join-Path $Root 'src') -Recurse -File -ErrorAction SilentlyContinue)
  $packageFile = Get-Item -LiteralPath (Join-Path $Root 'package.json') -ErrorAction SilentlyContinue
  if ($packageFile) { $files += $packageFile }
  if ($files.Count -eq 0) { return $null }
  return ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
}

try {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw 'Node.js and npm are required. Install Node.js 22 or newer.'
  }

  # ---- 版本信息：最新代码版本 vs 当前构建版本 ----
  $packageVersion = 'unknown'
  try {
    $package = Get-Content -Raw -LiteralPath (Join-Path $Root 'package.json') | ConvertFrom-Json
    $packageVersion = [string]$package.version
  } catch { }

  $buildInfoPath = Join-Path $Root 'dist\build-info.json'
  $buildInfo = $null
  if (Test-Path -LiteralPath $buildInfoPath) {
    try { $buildInfo = Get-Content -Raw -LiteralPath $buildInfoPath | ConvertFrom-Json } catch { }
  }

  Write-Host '===================================='
  Write-Host '           个人工作台启动器'
  Write-Host "  最新代码版本 : v$packageVersion"
  if ($buildInfo -and $buildInfo.buildTime) {
    Write-Host "  当前构建版本 : v$($buildInfo.version)（构建于 $($buildInfo.buildTime)）"
  } else {
    Write-Host '  当前构建     : 无（尚未构建或缺少版本信息）'
  }
  Write-Host '===================================='

  # ---- 构建检查：dist 缺失或源码比构建新时自动重建 ----
  $serverBuild = Join-Path $Root 'dist\server\main.js'
  $clientBuild = Join-Path $Root 'dist\client\index.html'
  $buildStamp = $null
  if ($buildInfo -and $buildInfo.buildTime) {
    $buildStamp = [datetime]::Parse($buildInfo.buildTime, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime()
  }
  $needsBuild = $false
  $buildReason = ''
  if (-not (Test-Path -LiteralPath $serverBuild) -or -not (Test-Path -LiteralPath $clientBuild)) {
    $needsBuild = $true; $buildReason = '构建产物缺失'
  } elseif (-not $buildStamp) {
    $needsBuild = $true; $buildReason = '当前构建缺少版本信息'
  } else {
    $newestSource = Get-SourceNewestUtc
    if ($newestSource -and $newestSource -gt $buildStamp) {
      $needsBuild = $true; $buildReason = '源码比当前构建新'
    }
  }
  if ($needsBuild) {
    Write-Host "检测到需要重新构建（$buildReason），正在执行 npm run build，可能需要 1-2 分钟..."
    Push-Location $Root
    try {
      & $npm.Source run build
      if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    } finally {
      Pop-Location
    }
    if (Test-Path -LiteralPath $buildInfoPath) {
      try { $buildInfo = Get-Content -Raw -LiteralPath $buildInfoPath | ConvertFrom-Json } catch { }
    }
    Write-Host '构建完成。'
  }

  # ---- 已在运行的服务：显示其版本并决定是否需要替换 ----
  if (Test-Health) {
    $running = Get-RunningVersion
    $runningLabel = if ($running) { "v$($running.version)（$(if ($running.mode -eq 'development') { '开发模式' } elseif ($running.buildTime) { "构建于 $($running.buildTime)" } else { '旧版构建' })）" } else { '无法识别版本' }
    $runningBuildTime = if ($running) { $running.buildTime } else { $null }
    $currentBuildTime = if ($buildInfo -and $buildInfo.buildTime) { [string]$buildInfo.buildTime } else { $null }
    $sameVersion = $running -and $running.version -eq $packageVersion -and $currentBuildTime -and $runningBuildTime -eq $currentBuildTime
    if ($sameVersion) {
      Write-Host "当前运行的服务已是最新版本：$runningLabel"
      Write-Host "Personal Workbench is already running: $Url"
      if (-not $NoBrowser) { Start-Process $Url }
      exit 0
    }
    # 仅当确认是本启动器拉起的旧版生产服务时才自动替换，其他进程（例如开发模式）交给用户处理。
    $isManagedOldService = $false
    if (Test-Path -LiteralPath $PidFile) {
      $oldPidText = (Get-Content -Raw -LiteralPath $PidFile).Trim()
      $oldPid = 0
      if ([int]::TryParse($oldPidText, [ref]$oldPid) -and $oldPid -gt 0) {
        $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        $oldCommandLine = Get-NodeCommandLine $oldPid
        $isManagedOldService = $oldProcess -and $oldProcess.ProcessName -eq 'node' -and $oldCommandLine -match 'dist[\\/]server[\\/]main\.js'
      }
    }
    if ($isManagedOldService) {
      Write-Host "检测到旧版服务正在运行：$runningLabel，正在自动停止并启动最新版本..."
      & (Join-Path $PSScriptRoot 'stop-workbench.ps1') -Port $Port | Out-Null
    } else {
      Write-Host "端口 $Port 已被其他进程占用（$runningLabel）。"
      Write-Host '如果是开发模式在运行，请先运行“停止个人工作台-开发模式”；否则请手动结束该进程后重试。'
      if ($running) {
        Write-Host "当前运行中的服务地址：$Url"
        if (-not $NoBrowser) { Start-Process $Url }
        exit 0
      }
      exit 1
    }
  }

  # ---- 启动新服务 ----
  if (Test-Path -LiteralPath $PidFile) {
    $oldPidText = (Get-Content -Raw -LiteralPath $PidFile).Trim()
    $oldPid = 0
    if ([int]::TryParse($oldPidText, [ref]$oldPid) -and $oldPid -gt 0) {
      $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
      $oldCommandLine = Get-NodeCommandLine $oldPid
      if ($oldProcess -and $oldProcess.ProcessName -eq 'node' -and $oldCommandLine -match 'dist[\\/]server[\\/]main\.js') {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
      }
    } else {
      Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }
  }

  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    throw "Port $Port is already in use by PID $owners."
  }

  New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
  $stdoutLog = Join-Path $DataDirectory 'workbench.log'
  $stderrLog = Join-Path $DataDirectory 'workbench-error.log'
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
    throw "The server did not become ready in 30 seconds. Check $stderrLog."
  }

  $started = Get-RunningVersion
  $startedLabel = if ($started) {
    $modeText = if ($started.mode -eq 'development') { '开发模式' } else { '生产模式' }
    $buildText = if ($started.buildTime) { "，构建于 $($started.buildTime)" } else { '' }
    "v$($started.version)（$modeText$buildText）"
  } else { '无法读取（服务已就绪但 /health 未返回版本）' }

  Write-Host "Personal Workbench started: $Url"
  Write-Host "本次启动版本 : $startedLabel"

  $lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress -Unique)
  if ($lanAddresses.Count -gt 0) {
    Write-Host 'Mobile access (phone on the same Wi-Fi):'
    foreach ($address in $lanAddresses) {
      Write-Host "  http://${address}:$Port/"
    }
    Write-Host 'If the phone cannot open the address, allow TCP port 52341 in Windows Firewall.'
  }
  if (-not $NoBrowser) { Start-Process $Url }
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
