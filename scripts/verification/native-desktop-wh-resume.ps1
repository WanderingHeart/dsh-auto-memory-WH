param(
  [ValidateSet('Check', 'Launch')]
  [string]$Action = 'Check',
  [switch]$OfflineConfirmed
)

$ErrorActionPreference = 'Stop'
function Refuse([string]$message) {
  [Console]::Error.WriteLine("隔离 WH 桌面续启已停止：$message")
  exit 2
}

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $repo '.work\S05'))
$testHome = Join-Path $testRoot 'native-real-user-home'
$userData = Join-Path $testRoot 'native-real-user-data'
$appData = Join-Path $testRoot 'native-real-appdata'
$localAppData = Join-Path $testRoot 'native-real-localappdata'
$profile = Join-Path $testHome 'profiles\desktop'
$manifestFile = Join-Path $profile 'package.json'
$moduleFile = Join-Path $profile 'node_modules\dsh-auto-memory-wh\package.json'
$credentialsFile = Join-Path $testHome '.credentials.yaml'
$archive = Join-Path $repo '.work\dsh-auto-memory-wh-0.1.0-rc.11.tgz'
$exe = 'C:\DeepSeek Harness\DeepSeek Harness.exe'
$asar = 'C:\DeepSeek Harness\resources\app.asar'
$expectedExe = '7AE939B5A82B220FBD8AD04DFBAFAAEDB5A49AB43DC884A5DB6381F678DD0CC4'
$expectedAsar = 'E1B6F25FA937DA98086C3E77AF77AA14791105963C4D337A1C42179D232C6915'
$expectedArchive = '0AEC562AEC430D4423B5BEC8F13C050E6D7F9DC5FE0A58BBE37C9CE972CB3B49'
$expectedBlankCredentials = '9FF947C05D4EDAD0728B1DD929C8C9D02DBB5167382AF51DD20189B2B1708296'

foreach ($dir in @($repo, (Join-Path $repo '.work'), $testRoot, $testHome, $userData, $appData, $localAppData, $profile)) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Refuse "隔离目录缺失：$dir" }
  if (((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse "隔离目录是链接：$dir" }
  if (-not $dir.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -and -not $dir.Equals((Join-Path $repo '.work'), [StringComparison]::OrdinalIgnoreCase) -and -not $dir.Equals($testRoot, [StringComparison]::OrdinalIgnoreCase) -and -not $dir.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Refuse "隔离目录越界：$dir" }
}
if (-not (Test-Path -LiteralPath (Join-Path $repo 'AGENTS.md') -PathType Leaf)) { Refuse '项目根目录不正确。' }
foreach ($item in @(@($exe, $expectedExe), @($asar, $expectedAsar), @($archive, $expectedArchive), @($credentialsFile, $expectedBlankCredentials))) {
  if (-not (Test-Path -LiteralPath $item[0] -PathType Leaf)) { Refuse "校验文件缺失：$($item[0])" }
  if ((Get-FileHash -LiteralPath $item[0] -Algorithm SHA256).Hash -ne $item[1]) { Refuse "校验文件变化：$($item[0])" }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(?i)\\codexsandboxoffline$') { Refuse '须在正常桌面账户运行，不能使用受限自动化账户。' }
if ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Refuse '不要以管理员身份运行。' }
if (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -ne 0) { Refuse 'DSH 仍在运行；先正常退出所有 DSH 窗口。' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$module = if (Test-Path -LiteralPath $moduleFile -PathType Leaf) { Get-Content -LiteralPath $moduleFile -Raw | ConvertFrom-Json } else { $null }
if ($manifest.name -ne 'dsh-profile-desktop' -or $null -eq $manifest.dependencies.'dsh-auto-memory-wh' -or -not (@($manifest.dsh.profile.bundles) -contains 'dsh-auto-memory-wh') -or $module.version -ne '0.1.0-rc.11') { Refuse '隔离桌面 profile 尚未正确安装 WH rc.11。' }

if ($Action -eq 'Check') {
  [pscustomobject]@{ status = 'ready-for-isolated-wh-desktop-launch'; user = $identity; profile = $profile; whVersion = $module.version; credentials = 'unchanged blank test profile fingerprint'; runningDsh = 0 } | ConvertTo-Json
  exit 0
}
if (-not $OfflineConfirmed) { Refuse '启动前需人工断开外网并传入 -OfflineConfirmed；此参数不独立证明网络隔离。' }

# The PowerShell child owns these environment changes; its caller is unchanged.
foreach ($entry in @(Get-ChildItem Env:)) {
  if ($entry.Name -match '(?i)^(DSH_|ELECTRON_)|API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|OPENAI|ANTHROPIC|DEEPSEEK|GEMINI|AZURE|MODEL|LLM|PROXY') {
    Remove-Item -LiteralPath ('Env:' + $entry.Name)
  }
}
$env:DSH_HOME = $testHome
$env:APPDATA = $appData
$env:LOCALAPPDATA = $localAppData
$env:XDG_CACHE_HOME = Join-Path $testRoot 'native-desktop-cache'
$env:npm_config_update_notifier = 'false'
$logDir = Join-Path $testRoot ('native-wh-ui-log-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $logDir | Out-Null
# Captures the short-lived local web token in project .work only, never prints it.
$stdout = Join-Path $logDir 'desktop.stdout.log'
$stderr = Join-Path $logDir 'desktop.stderr.log'
$process = Start-Process -FilePath $exe -ArgumentList ('--user-data-dir=' + $userData) -WorkingDirectory $repo -WindowStyle Normal -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
if ($null -eq $process) { Refuse 'DSH 没有启动；保留隔离日志。' }
Start-Sleep -Seconds 8
if ($process.HasExited) { Refuse "DSH 在 8 秒内退出（退出码 $($process.ExitCode)）；保留隔离日志，不自动重试。" }
[pscustomobject]@{ status = 'isolated-wh-desktop-launched-not-yet-accepted'; user = $identity; pid = $process.Id; profile = $profile; whVersion = $module.version; logDir = $logDir; runningAfter8Seconds = $true; offline = 'manually confirmed, not independently verified' } | ConvertTo-Json
