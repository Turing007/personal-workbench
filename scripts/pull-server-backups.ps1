# 把服务器上的自动备份拉到本机，并做本地保留与校验。
#
# 手动跑一次：
#   powershell -ExecutionPolicy Bypass -File scripts\pull-server-backups.ps1
# 注册成每天 03:00 自动跑：
#   powershell -ExecutionPolicy Bypass -File scripts\pull-server-backups.ps1 -Register
#
# 前提：能免密 SSH 到服务器（默认用 ~/.ssh/workbench_deploy_ed25519）。
#
# 备份文件名带中文，Windows PowerShell 5.1 会用 GBK 解析 ssh 的 UTF-8 输出而乱码，
# 所以清单走 base64、下载走纯 ASCII 的时间戳通配，命令行上不留一个非 ASCII 字符。
param(
    [string]$Server = "root@101.200.149.84",
    [string]$KeyPath = "$env:USERPROFILE\.ssh\workbench_deploy_ed25519",
    [string]$RemoteDir = "workbench/data/backups",
    [string]$LocalDir = "D:\工作台服务器备份",
    [int]$Keep = 7,
    [switch]$Register
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$SshExe = Join-Path $env:SystemRoot "System32\OpenSSH\ssh.exe"
$ScpExe = Join-Path $env:SystemRoot "System32\OpenSSH\scp.exe"
$LogFile = Join-Path $LocalDir "拉取日志.txt"

function Write-Log([string]$message) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# 只看中心目录，不解压 668MB：能打开且含 workbench.sqlite 才算一份可用备份
function Test-BackupZip([string]$path) {
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
        try {
            $names = @($zip.Entries | ForEach-Object { $_.FullName })
            return ($names -contains 'workbench.sqlite') -and ($names -contains 'manifest.json')
        } finally { $zip.Dispose() }
    } catch { return $false }
}

# 部署前快照是裸 sqlite 文件，只需认回头 16 字节的库头即可确认不是半截文件；
# 服务端生成时已经跑过 integrity_check。
function Test-SqliteFile([string]$path) {
    $stream = $null
    try {
        $stream = [IO.File]::OpenRead($path)
        $buffer = New-Object byte[] 16
        if ($stream.Read($buffer, 0, 16) -lt 16) { return $false }
        return ([Text.Encoding]::ASCII.GetString($buffer)) -eq ("SQLite format 3" + [char]0)
    } catch {
        return $false
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Test-DownloadedFile([string]$path) {
    if ($path -like '*.zip') { return Test-BackupZip $path }
    return Test-SqliteFile $path
}

if (-not (Test-Path $LocalDir)) { New-Item -ItemType Directory -Path $LocalDir | Out-Null }

if ($Register) {
    $scriptPath = $PSCommandPath
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
    # 服务器自己的自动备份 03:00 开始打包，几百 MB 要跑一两分钟；
    # 3 点整去拉只会拿到前一天那份，所以故意错开到 03:40。
    $trigger = New-ScheduledTaskTrigger -Daily -At "03:40"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName "Workbench-PullServerBackups" -Action $action -Trigger $trigger `
        -Settings $settings -Description "每天从服务器拉取工作台自动备份到本地，保留最近 $Keep 份" -Force | Out-Null
    Write-Host "已注册计划任务 Workbench-PullServerBackups（每天 03:40）"
    exit 0
}

if (-not (Test-Path $KeyPath)) { Write-Log "找不到私钥 $KeyPath，跳过"; exit 1 }

$StageDir = Join-Path $env:TEMP "workbench-backup-pull"
if (Test-Path $StageDir) { Remove-Item -Path (Join-Path $StageDir "*") -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

$listingB64 = (& $SshExe -i $KeyPath -o BatchMode=yes -o ConnectTimeout=20 $Server `
    "find $RemoteDir -maxdepth 1 \( -name '*.zip' -o -name '*.sqlite' \) -printf '%s %f\n' | base64 -w0" 2>$null) | Out-String
if ($LASTEXITCODE -ne 0 -or -not $listingB64.Trim()) { Write-Log "远端备份目录为空或连不上，本轮跳过"; exit 1 }

$b64 = ($listingB64 -replace '\s', '')
$listingText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
$downloaded = 0

foreach ($row in ($listingText -split "`n")) {
    if (-not $row.Trim()) { continue }
    $parts = $row -split ' ', 2
    if ($parts.Length -lt 2) { continue }
    $remoteSize = [int64]$parts[0]
    $name = $parts[1].Trim()
    $local = Join-Path $LocalDir $name

    # 本地已有同样字节数的文件，说明上一轮拉过且完整，跳过
    if ((Test-Path $local) -and ((Get-Item $local).Length -eq $remoteSize)) { continue }

    # Z 可有可无：自动备份 ZIP 带 Z，早期生成的部署前快照没带，两种都要认。
    $stamp = [regex]::Match($name, '[0-9]{8}T[0-9]{6}Z?\.(zip|sqlite)$').Value
    if (-not $stamp) { Write-Log "文件名里没有可识别的时间戳，跳过：$name"; continue }

    Write-Log ("拉取 " + $name + "（" + [math]::Round($remoteSize / 1MB, 1) + " MB）")
    # 落地目录必须全 ASCII：OpenSSH 对本地路径走 ANSI 码页，中文目录名会让 scp 写不出文件
    $part = Join-Path $StageDir (".part-" + $stamp)
    # 通配符 * 吃掉中文前缀，scp 命令行只剩 ASCII；先落临时目录再改名，避免半截文件冒充完整备份
    & $ScpExe -i $KeyPath -o BatchMode=yes -q ($Server + ":" + $RemoteDir + "/*" + $stamp) $part 2>$null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $part)) { Write-Log "拉取失败：$name"; continue }
    if ((Get-Item $part).Length -ne $remoteSize) {
        Write-Log "大小不符（本地 $((Get-Item $part).Length) / 远端 $remoteSize），丢弃半截文件：$name"
        Remove-Item $part -Force
        continue
    }
    if (-not (Test-DownloadedFile $part)) {
        Write-Log "文件校验不通过（ZIP 打不开/缺关键条目，或 sqlite 文件头不对），丢弃：$name"
        Remove-Item $part -Force
        continue
    }
    if (Test-Path $local) { Remove-Item $local -Force }
    Move-Item -Path $part -Destination $local
    $downloaded++
    Write-Log ("完成 " + $name)
}

# 本地保留：两类文件各自按文件名倒序留 $Keep 份（文件名尾部是 UTC 时间戳，字典序即时间序）
function Prune-Newest([string]$pattern, [int]$keep) {
    $files = @(Get-ChildItem -Path $LocalDir -Filter $pattern | Sort-Object Name -Descending)
    if ($files.Count -gt $keep) {
        foreach ($stale in $files[$keep..($files.Count - 1)]) {
            Write-Log "本地超出保留份数，删除 $($stale.Name)"
            Remove-Item $stale.FullName -Force
        }
        $files = @(Get-ChildItem -Path $LocalDir -Filter $pattern | Sort-Object Name -Descending)
    }
    return $files
}

# 函数只返回一个文件时会被管道拆成标量，调用点必须用 @() 兜住，否则后面做数组运算会炸。
$zips = @(Prune-Newest "*.zip" $Keep)
$snapshots = @(Prune-Newest "*.sqlite" $Keep)
$usedGB = [math]::Round((($zips + $snapshots | Measure-Object -Property Length -Sum).Sum / 1GB), 2)
Write-Log ("本轮新拉 $downloaded 份；本地自动备份 $($zips.Count) 份 + 部署前快照 $($snapshots.Count) 份 / 合计 $usedGB GB")
