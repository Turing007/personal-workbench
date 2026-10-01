param([int]$Port = 52342)

$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PidFile = Join-Path $Root '.workbench.pid'

function Get-NodeCommandLine([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return $null
  }
}

try {
  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host 'No workbench PID file found. The service is already stopped.'
    exit 0
  }

  $pidText = (Get-Content -Raw -LiteralPath $PidFile).Trim()
  $processId = 0
  if (-not [int]::TryParse($pidText, [ref]$processId) -or $processId -le 0) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Invalid PID file removed.'
    exit 0
  }

  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  $commandLine = Get-NodeCommandLine $processId
  $isWorkbench = $process -and $process.ProcessName -eq 'node' -and $commandLine -match 'dist[\\/]server[\\/]main\.js'
  if (-not $isWorkbench) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'PID file did not point to a workbench Node.js process. No other process was stopped.'
    exit 0
  }

  $listener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $processId)
  if ($listener.Count -eq 0) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'The workbench process is not listening on the expected port. PID file removed.'
    exit 0
  }

  Stop-Process -Id $processId -Force
  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    $remaining = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Write-Host 'Personal Workbench stopped.'
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
