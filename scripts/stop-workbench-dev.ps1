$ErrorActionPreference = 'Stop'

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$DevPidFile = Join-Path $Root '.workbench-dev.pid'
$Ports = @(52343, 52342)

function Get-NodeCommandLine([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return $null
  }
}

try {
  if (-not (Test-Path -LiteralPath $DevPidFile) -and (Get-NetTCPConnection -State Listen -LocalPort $Ports -ErrorAction SilentlyContinue).Count -eq 0) {
    Write-Host 'Dev mode is not running.'
    exit 0
  }

  # 1) 杀掉 dev 启动脚本记录的进程树（npm -> concurrently -> vite/tsx）
  if (Test-Path -LiteralPath $DevPidFile) {
    $pidText = (Get-Content -Raw -LiteralPath $DevPidFile).Trim()
    $processId = 0
    if ([int]::TryParse($pidText, [ref]$processId) -and $processId -gt 0) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process) {
        & taskkill /PID $processId /T /F 2>$null | Out-Null
        Write-Host 'Dev mode stopped.'
      }
    }
    Remove-Item -LiteralPath $DevPidFile -Force -ErrorAction SilentlyContinue
  }

  # 2) 兜底清理残留的 vite / tsx / workbench 进程
  foreach ($port in $Ports) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    $seen = @{}
    foreach ($listener in $listeners) {
      $ownerPid = [int]$listener.OwningProcess
      if ($seen.ContainsKey($ownerPid)) { continue }
      $seen[$ownerPid] = $true
      $commandLine = Get-NodeCommandLine $ownerPid
      if ($commandLine -match 'vite|tsx|concurrently|dist[\\/]server[\\/]main\.js') {
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Write-Host 'Dev mode fully stopped.'
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}