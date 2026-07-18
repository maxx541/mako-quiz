#Requires -Version 5.1
<#
  Makoquiz 一鍵啟動：建置 → 開 cloudflared 通道 → 帶著通道網址啟動伺服器。

  通道網址必須在伺服器啟動前就拿到，QR code 才會指向對外網址
  （server/plugins/socket.ts 的 buildJoinUrl 只讀啟動當下的 NUXT_PUBLIC_URL）。
#>
param(
  [int]$Port = 3000,
  [switch]$NoTunnel,
  [switch]$Rebuild,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location $PSScriptRoot

$cfExe   = Join-Path $PSScriptRoot 'cloudflared.exe'
$logFile = Join-Path $PSScriptRoot 'cloudflared.log'
$entry   = Join-Path $PSScriptRoot '.output\server\index.mjs'
$cf      = $null
$node    = $null

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }

# cloudflared 還握著 log 檔的寫入 handle，一般讀法會被鎖住
function Read-LogSafe($path) {
  if (-not (Test-Path $path)) { return '' }
  try {
    $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    $sr = New-Object System.IO.StreamReader($fs)
    $text = $sr.ReadToEnd()
    $sr.Close(); $fs.Close()
    return $text
  } catch { return '' }
}

# 直接按 X 關視窗時 finally 不會跑，通道會變成孤兒程序留著。
# 只清掉本資料夾這支 cloudflared，不動系統上其他的實例。
function Stop-StrayTunnel {
  Get-Process cloudflared -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $cfExe } |
    ForEach-Object {
      Write-Warn "清掉上次殘留的通道（PID $($_.Id)）"
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}

function Test-PortBusy($p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); $c.Close(); return $true } catch { return $false }
}

# cloudflared.exe 約 50 MB，沒有進版控（見 .gitignore），所以第一次要開通道時自動抓下來。
# 只會下載這一次，之後就一直用本資料夾裡的這支。
function Get-Cloudflared {
  if (Test-Path $cfExe) { return }
  Write-Step '第一次啟動：下載 cloudflared（約 50 MB，只會下載這一次）'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  $tmp = "$cfExe.download"
  try {
    $old = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'   # 進度條在無視窗模式下會拖慢下載
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    $ProgressPreference = $old
    Move-Item -Path $tmp -Destination $cfExe -Force
  } catch {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    throw @"
下載 cloudflared 失敗：$($_.Exception.Message)
可以改用下列任一方式：
  * 自己到 https://github.com/cloudflare/cloudflared/releases/latest 下載
    cloudflared-windows-amd64.exe，放到專案資料夾並改名成 cloudflared.exe
  * 或加上 -NoTunnel 參數，不開對外通道（QR 只指向區網 IP，同一個 wifi 才連得到）
"@
  }
}

function Test-BuildStale {
  if (-not (Test-Path $entry)) { return $true }
  $builtAt = (Get-Item $entry).LastWriteTimeUtc
  $files = @()
  foreach ($dir in @('app', 'server', 'public')) {
    if (Test-Path $dir) { $files += Get-ChildItem $dir -Recurse -File }
  }
  foreach ($name in @('nuxt.config.ts', 'package.json')) {
    if (Test-Path $name) { $files += Get-Item $name }
  }
  foreach ($f in $files) {
    if ($f.LastWriteTimeUtc -gt $builtAt) { return $true }
  }
  return $false
}

try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '找不到 node，請先安裝 Node.js >= 22.12'
  }

  if (Test-PortBusy $Port) {
    throw "$Port 埠已被占用，請先關掉舊的伺服器，或用 -Port 換一個埠號"
  }

  if (-not (Test-Path 'node_modules')) {
    Write-Step '安裝相依套件（第一次會久一點）'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失敗' }
  }

  if ($Rebuild -or (Test-BuildStale)) {
    Write-Step '原始碼有變動，重新建置'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build 失敗' }
  } else {
    Write-Step '建置產物是最新的，跳過 build'
  }

  $publicUrl = ''
  if (-not $NoTunnel) {
    Get-Cloudflared
    Stop-StrayTunnel
    Write-Step '建立 cloudflared 暫時通道'
    Remove-Item $logFile -Force -ErrorAction SilentlyContinue
    $cf = Start-Process -FilePath $cfExe -PassThru -WindowStyle Hidden -ArgumentList @(
      'tunnel', '--no-autoupdate', '--url', "http://localhost:$Port", '--logfile', $logFile
    )

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
      $m = [regex]::Match((Read-LogSafe $logFile), 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($m.Success) { $publicUrl = $m.Value; break }
      if ($cf.HasExited) { throw "cloudflared 意外結束，細節見 $logFile" }
      Start-Sleep -Milliseconds 400
    }
    if (-not $publicUrl) { throw "45 秒內沒等到通道網址，細節見 $logFile" }

    $env:NUXT_PUBLIC_URL = $publicUrl
  } else {
    Write-Step '跳過通道，QR 只會指向區網 IP'
    Remove-Item Env:\NUXT_PUBLIC_URL -ErrorAction SilentlyContinue
  }

  Write-Step '啟動伺服器'
  $env:PORT = "$Port"
  <#
    --env-file-if-exists：node 不會自己讀 .env（那是 Nuxt 開發模式才有的事），
    所以題庫市集的 Supabase 金鑰得靠這個旗標帶進去。
    用 -if-exists 版本是因為沒有 .env 的人（大多數人）也要開得起來 ——
    純 --env-file 在檔案不存在時會直接讓 node 罷工。
  #>
  $node = Start-Process -FilePath 'node' -PassThru -NoNewWindow -ArgumentList @(
    '--env-file-if-exists=.env', '.output/server/index.mjs'
  )

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not (Test-PortBusy $Port)) {
    if ($node.HasExited) { throw '伺服器啟動失敗' }
    Start-Sleep -Milliseconds 300
  }

  $local = "http://localhost:$Port"
  Write-Host ''
  Write-Host '  Makoquiz 已啟動' -ForegroundColor Green
  Write-Host "  後台   $local/admin"
  if ($publicUrl) {
    Write-Host "  對外   $publicUrl" -ForegroundColor Green
    Write-Host '         QR code 會自動指向這個網址'
  } else {
    Write-Host '  對外   （未開通道）'
  }
  Write-Host ''
  Write-Host '  在這個視窗按 Ctrl+C 可以同時關掉伺服器和通道' -ForegroundColor DarkGray
  Write-Host ''

  if (-not $NoOpen) { Start-Process "$local/admin" | Out-Null }

  while (-not $node.HasExited) { Start-Sleep -Seconds 1 }
}
catch {
  Write-Host ''
  Write-Warn $_.Exception.Message
  Write-Host ''
  if ($Host.Name -eq 'ConsoleHost') { Read-Host '按 Enter 關閉' | Out-Null }
  exit 1
}
finally {
  foreach ($p in @($node, $cf)) {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
