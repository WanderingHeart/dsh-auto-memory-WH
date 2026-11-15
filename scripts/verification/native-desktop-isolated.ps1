param(
  [switch]$Launch,
  [switch]$OfflineConfirmed
)

$ErrorActionPreference = 'Stop'

function Stop-Preflight([string]$message) {
  [Console]::Error.WriteLine("隔离桌面检查未通过：$message")
  exit 2
}

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $repo '.work\S05'))
$exe = 'C:\DeepSeek Harness\DeepSeek Harness.exe'
$asar = 'C:\DeepSeek Harness\resources\app.asar'
$expectedAsar = 'E1B6F25FA937DA98086C3E77AF77AA14791105963C4D337A1C42179D232C6915'
$paths = [ordered]@{
  home = [IO.Path]::GetFullPath((Join-Path $testRoot 'native-real-user-home'))
  userData = [IO.Path]::GetFullPath((Join-Path $testRoot 'native-real-user-data'))
  appData = [IO.Path]::GetFullPath((Join-Path $testRoot 'native-real-appdata'))
  localAppData = [IO.Path]::GetFullPath((Join-Path $testRoot 'native-real-localappdata'))
}

if (-not (Test-Path -LiteralPath (Join-Path $repo 'AGENTS.md'))) { Stop-Preflight '项目位置不正确。' }
foreach ($dir in @($repo, (Join-Path $repo '.work'), $testRoot)) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Stop-Preflight "测试根目录不存在：$dir" }
  if (((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Preflight "测试根目录不能是链接：$dir" }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(?i)\\codexsandboxoffline$') { Stop-Preflight '当前是自动化受限账户，必须由正常桌面用户运行。' }
$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
if ($running.Count -ne 0) { Stop-Preflight "仍有 $($running.Count) 个 DSH 进程。请先保存工作并从 DSH 正常退出；本工具不会关闭它。" }
if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or -not (Test-Path -LiteralPath $asar -PathType Leaf)) { Stop-Preflight '原版 DSH 程序文件不存在。' }
$asarHash = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash
if ($asarHash -ne $expectedAsar) { Stop-Preflight 'DSH 程序包与已核对的 0.2.1-rc.5 不同，需重新检查版本。' }
$exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
foreach ($key in $paths.Keys) {
  $path = $paths[$key]
  if (-not $path.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Stop-Preflight "测试路径越界：$key" }
  if (Test-Path -LiteralPath $path) { Stop-Preflight "测试目录已存在，禁止覆盖：$path" }
}

$preflight = [ordered]@{
  status = 'ready-for-blank-host-only'
  user = $identity
  existingDshProcesses = $running.Count
  exeSha256 = $exeHash
  asarSha256 = $asarHash
  isolatedPaths = $paths
  networkIsolation = 'not measured; a launch requires manual offline confirmation'
}
if (-not $Launch) {
  $preflight | ConvertTo-Json -Depth 4
  exit 0
}
if (-not $OfflineConfirmed) { Stop-Preflight '启动前须手动断开外网，并显式传入 -OfflineConfirmed。此开关只记录人工确认，不证明网络隔离。' }

foreach ($path in $paths.Values) {
  if (Test-Path -LiteralPath $path) { Stop-Preflight "启动前目录状态改变：$path" }
  $null = New-Item -ItemType Directory -Path $path -ErrorAction Stop
}

$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $exe
$start.Arguments = '--user-data-dir="' + $paths.userData + '"'
$start.WorkingDirectory = $repo
$start.UseShellExecute = $false
foreach ($key in @($start.EnvironmentVariables.Keys)) {
  if ($key -match '(?i)(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|OPENAI|ANTHROPIC|DEEPSEEK|GEMINI|AZURE|MODEL|LLM|PROXY)') {
    $start.EnvironmentVariables.Remove($key)
  }
}
$start.EnvironmentVariables['DSH_HOME'] = $paths.home
$start.EnvironmentVariables['APPDATA'] = $paths.appData
$start.EnvironmentVariables['LOCALAPPDATA'] = $paths.localAppData
$process = [System.Diagnostics.Process]::Start($start)
if ($null -eq $process) { Stop-Preflight 'DSH 进程未启动；保留测试目录供检查。' }
Start-Sleep -Seconds 8
$result = [ordered]@{
  status = 'launched-not-yet-accepted'
  startedAt = (Get-Date).ToString('o')
  user = $identity
  pid = $process.Id
  stillRunningAfter8Seconds = -not $process.HasExited
  exitCode = if ($process.HasExited) { $process.ExitCode } else { $null }
  exeSha256 = $exeHash
  asarSha256 = $asarHash
  isolatedPaths = $paths
  desktopProfileCreated = Test-Path -LiteralPath (Join-Path $paths.home 'profiles\desktop')
  offline = 'manually confirmed, not independently verified'
  whInstalled = $false
}
$evidence = Join-Path $testRoot ('native-real-user-blank-launch-' + [guid]::NewGuid().ToString('N') + '.json')
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $evidence -Encoding utf8
$result | ConvertTo-Json -Depth 4
