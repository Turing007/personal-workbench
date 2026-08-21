$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PidFile = Join-Path $Root '.workbench.pid'
$DataDirectory = Join-Path $Root 'data'
$Port = 52341
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

function Get-NodeCommandLine([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return $null
  }
}

try {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw 'Node.js and npm are required. Install Node.js 22 or newer.'
  }

  $serverBuild = Join-Path $Root 'dist\server\main.js'
  $clientBuild = Join-Path $Root 'dist\client\index.html'
  if (-not (Test-Path -LiteralPath $serverBuild) -or -not (Test-Path -LiteralPath $clientBuild)) {
    Write-Host 'Production build not found. Running npm run build...'
    Push-Location $Root
    try {
      & $npm.Source run build
      if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    } finally {
      Pop-Location
    }
  }

  if (Test-Path -LiteralPath $PidFile) {
    $oldPidText = (Get-Content -Raw -LiteralPath $PidFile).Trim()
    $oldPid = 0
    if ([int]::TryParse($oldPidText, [ref]$oldPid) -and $oldPid -gt 0) {
      $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
      $oldCommandLine = Get-NodeCommandLine $oldPid
      if ($oldProcess -and $oldProcess.ProcessName -eq 'node' -and $oldCommandLine -match 'dist[\\/]server[\\/]main\.js') {
        if (Test-Health) {
          Write-Host "Personal Workbench is already running: $Url"
          Start-Process $Url
          exit 0
        }
        throw "The existing workbench process (PID $oldPid) is not healthy. Check data\workbench-error.log."
      }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
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

  Write-Host "Personal Workbench started: $Url"
  Start-Process $Url
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
