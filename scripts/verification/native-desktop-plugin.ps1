param(
  [ValidateSet('Check', 'Install', 'Remove')]
  [string]$Action = 'Check',
  [switch]$OfflineConfirmed,
  [switch]$PostRemoveBaseline,
  [switch]$AllowRunningDsh
)

$ErrorActionPreference = 'Stop'
function Refuse([string]$message) {
  [Console]::Error.WriteLine("隔离桌面插件操作已停止：$message")
  exit 2
}

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $repo '.work\S05'))
$testHomeDir = [IO.Path]::GetFullPath((Join-Path $testRoot 'native-real-user-home'))
$profile = [IO.Path]::GetFullPath((Join-Path $testHomeDir 'profiles\desktop'))
$backup = [IO.Path]::GetFullPath((Join-Path $testRoot 'native-desktop-profile-baseline-r59'))
$postRemoveBackup = [IO.Path]::GetFullPath((Join-Path $testRoot 'native-desktop-profile-postremove-r65'))
$archive = [IO.Path]::GetFullPath((Join-Path $repo '.work\dsh-auto-memory-wh-0.1.0-rc.11.tgz'))
$store = [IO.Path]::GetFullPath((Join-Path $testRoot 'installation-home\pnpm-store'))
$cli = 'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$expectedArchive = '0AEC562AEC430D4423B5BEC8F13C050E6D7F9DC5FE0A58BBE37C9CE972CB3B49'
$metadataRoot = Join-Path $testRoot 'native-desktop-cache\pnpm\v12\metadata\https%3A+registry.npmjs.org'
$metadata = [ordered]@{
  'yaml.jsonl' = 'D34C085110309AC6CB8DABA4C8C522D687FD3D1DF2EF6A1643D7EFDE6D35852A'
  '@deepseek-ai\cosmokit.jsonl' = '88FE3C98DE19E972E7C82D82F3C9CB33F4E76B1A013043FDC2EE6CA36EF99735'
  '@deepseek-ai\schemastery.jsonl' = 'F8179A0ED16007A506A22B9D9A668068CE2BF920D2D5788575123D3A3C7F49BE'
  '@standard-schema\spec.jsonl' = 'EA4C933FB320EC40762157CA8DDCFA7466E3965D64467F6AA339B090AA32D8AB'
}
$baseline = [ordered]@{
  'package.json' = 'EAFC5B4EBC3E702E8AAEE00F6012AE1D76EF8EA24B8BBE03A003F369C5D2934F'
  'cordis.patch.yml' = 'EF189A8C27DB6D63930AA3046A3040482E952EAFCB7487C644D508E8D461F027'
  'cordis.yml' = 'C300DCF2EBC5F02062D6591268D29D3DB6FE45E0CB138F5467276FE2BA06076E'
  'pnpm-workspace.yaml' = 'AE7C5B68E2F157528E62885804E69E88583897B775E03C86FCBE52FEAF498ABA'
}
$postRemove = [ordered]@{
  'package.json' = '341507284435555D5F58626A352918D7BB90B273A8C048D7805E06A881167319'
  'cordis.patch.yml' = 'EF189A8C27DB6D63930AA3046A3040482E952EAFCB7487C644D508E8D461F027'
  'cordis.yml' = 'C300DCF2EBC5F02062D6591268D29D3DB6FE45E0CB138F5467276FE2BA06076E'
  'pnpm-workspace.yaml' = 'AE7C5B68E2F157528E62885804E69E88583897B775E03C86FCBE52FEAF498ABA'
  'pnpm-lock.yaml' = '878A7B60746FB21FFE11029327F29EA50CFC840BFEB9E0B3CBB46A77F828B7E7'
}

if ($PostRemoveBaseline -and $Action -eq 'Remove') { Refuse 'PostRemoveBaseline 只用于空白检查或再次安装。' }
if ($AllowRunningDsh -and $Action -ne 'Check') { Refuse 'AllowRunningDsh 只用于只读预检；安装/卸载必须先关闭 DSH。' }

if (-not (Test-Path -LiteralPath (Join-Path $repo 'AGENTS.md') -PathType Leaf)) { Refuse '项目位置不正确。' }
foreach ($dir in @($repo, (Join-Path $repo '.work'), $testRoot, $testHomeDir, $profile, $backup, $store)) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Refuse "测试目录缺失：$dir" }
  if (((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse "测试目录是链接：$dir" }
}
if ($PostRemoveBaseline) {
  foreach ($dir in @($postRemoveBackup, (Join-Path $profile 'node_modules'))) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Refuse "续测目录缺失：$dir" }
    if (((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse "续测目录是链接：$dir" }
  }
}
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { Refuse '内置桌面 CLI 缺失。' }
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { Refuse '本地 rc.11 包缺失。' }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedArchive) { Refuse '本地 rc.11 包指纹不匹配。' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(?i)\\codexsandboxoffline$') { Refuse '请从正常桌面账户运行，不能使用自动化受限账户。' }
if ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Refuse '不要以管理员身份运行。' }
$runningDsh = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count
if ($runningDsh -ne 0 -and -not ($AllowRunningDsh -and $Action -eq 'Check')) { Refuse 'DSH 仍在运行；先正常退出测试窗口，或仅对只读预检使用 -AllowRunningDsh。' }
foreach ($name in $baseline.Keys) {
  $file = Join-Path $backup $name
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Refuse "基线备份缺失：$name" }
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $baseline[$name]) { Refuse "基线备份变化：$name" }
}
if ($PostRemoveBaseline) {
  foreach ($name in $postRemove.Keys) {
    $file = Join-Path $postRemoveBackup $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Refuse "卸载后备份缺失：$name" }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $postRemove[$name]) { Refuse "卸载后备份变化：$name" }
  }
}
if ($Action -ne 'Remove') {
  foreach ($name in $metadata.Keys) {
    $file = Join-Path $metadataRoot $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Refuse "离线依赖元数据缺失：$name" }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $metadata[$name]) { Refuse "离线依赖元数据变化：$name" }
  }
}

$manifest = Get-Content -LiteralPath (Join-Path $profile 'package.json') -Raw | ConvertFrom-Json
if ($manifest.name -ne 'dsh-profile-desktop') { Refuse '当前目标不是隔离桌面 profile。' }
$installed = $null -ne $manifest.dependencies.'dsh-auto-memory-wh'
$module = Join-Path $profile 'node_modules\dsh-auto-memory-wh\package.json'
$whDir = Join-Path $profile 'node_modules\dsh-auto-memory-wh'
$expectedState = if ($PostRemoveBaseline) { $postRemove } else { $baseline }
if ($Action -eq 'Check') {
  $baselineMatch = @($expectedState.Keys | Where-Object {
    $file = Join-Path $profile $_
    -not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expectedState[$_]
  }).Count -eq 0
  if (-not $baselineMatch -or $installed -or (Test-Path -LiteralPath $whDir) -or ((-not $PostRemoveBaseline) -and (Test-Path -LiteralPath (Join-Path $profile 'pnpm-lock.yaml')))) { Refuse 'profile 不符合指定的隔离安装基线。' }
  [pscustomobject]@{
    status = if ($PostRemoveBaseline) { 'ready-for-isolated-desktop-reinstall' } else { 'ready-for-isolated-desktop-install' }
    user = $identity
    profile = $profile
    archiveSha256 = $expectedArchive
    installed = $installed
    baselineMatch = $baselineMatch
    runningDsh = $runningDsh
    runningDshAllowed = [bool]$AllowRunningDsh
  } | ConvertTo-Json
  exit 0
}
if (-not $OfflineConfirmed) { Refuse '安装/卸载前需手动断开外网并传入 -OfflineConfirmed；该参数只记录人工确认。' }

if ($Action -eq 'Install') {
  foreach ($name in $expectedState.Keys) {
    $file = Join-Path $profile $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expectedState[$name]) { Refuse "profile 已变化：$name" }
  }
  if ($installed -or (Test-Path -LiteralPath $whDir) -or ((-not $PostRemoveBaseline) -and (Test-Path -LiteralPath (Join-Path $profile 'pnpm-lock.yaml')))) { Refuse 'profile 不符合指定的隔离安装基线。' }
} elseif (-not $installed) {
  Refuse 'profile 未声明 WH；不会执行卸载。'
} elseif (-not (Test-Path -LiteralPath $module -PathType Leaf) -or (Get-Content -LiteralPath $module -Raw | ConvertFrom-Json).version -ne '0.1.0-rc.11') {
  Refuse '已安装 WH 的版本或文件状态与 rc.11 不符；不会执行卸载。'
}

# This PowerShell child owns these environment changes; the caller's shell is unchanged.
foreach ($entry in @(Get-ChildItem Env:)) {
  if ($entry.Name -match '(?i)(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|OPENAI|ANTHROPIC|DEEPSEEK|GEMINI|AZURE|MODEL|LLM|PROXY)') {
    Remove-Item -LiteralPath ('Env:' + $entry.Name)
  }
}
$env:DSH_HOME = $testHomeDir
$env:APPDATA = Join-Path $testRoot 'native-real-appdata'
$env:LOCALAPPDATA = Join-Path $testRoot 'native-real-localappdata'
$env:XDG_CACHE_HOME = Join-Path $testRoot 'native-desktop-cache'
$env:npm_config_cache = Join-Path $testRoot 'native-desktop-npm-cache'
$env:PNPM_HOME = Join-Path $testRoot 'native-desktop-pnpm-home'
$env:npm_config_offline = 'true'
$env:npm_config_ignore_scripts = 'true'
$env:npm_config_update_notifier = 'false'
Set-Location -LiteralPath $repo
if ($Action -eq 'Install') {
  & $cli plugin --profile desktop add $archive --offline --ignore-scripts --store-dir $store
} else {
  # pnpm 11 remove rejects --offline and --ignore-scripts. The process-local
  # npm_config_* values above keep offline and lifecycle-script safeguards.
  & $cli plugin --profile desktop remove dsh-auto-memory-wh --store-dir $store
}
$code = $LASTEXITCODE
if ($code -ne 0) { Refuse "官方插件命令失败（退出码 $code）。保留全部隔离目录和诊断，不自动重试或恢复。" }
$after = Get-Content -LiteralPath (Join-Path $profile 'package.json') -Raw | ConvertFrom-Json
$nowInstalled = $null -ne $after.dependencies.'dsh-auto-memory-wh'
$nowSelected = @($after.dsh.profile.bundles) -contains 'dsh-auto-memory-wh'
if ($Action -eq 'Install' -and -not $nowInstalled) { Refuse '命令成功，但 profile 清单没有 WH；停止后续启动。' }
if ($Action -eq 'Install' -and -not $nowSelected) { Refuse '命令成功，但 profile 未选中 WH bundle；停止后续启动。' }
if ($Action -eq 'Install' -and (-not (Test-Path -LiteralPath $module -PathType Leaf) -or (Get-Content -LiteralPath $module -Raw | ConvertFrom-Json).version -ne '0.1.0-rc.11')) { Refuse '命令成功，但 WH 安装文件或版本不符；停止后续启动。' }
if ($Action -eq 'Remove' -and $nowInstalled) { Refuse '命令成功，但 profile 清单仍有 WH；停止后续启动。' }
if ($Action -eq 'Remove' -and $nowSelected) { Refuse '命令成功，但 profile 仍选中 WH；停止后续启动。' }
if ($Action -eq 'Remove' -and (Test-Path -LiteralPath $module)) { Refuse '命令成功，但 WH 模块文件仍在；停止后续启动。' }
[pscustomobject]@{ status = if ($Action -eq 'Install') { 'installed-in-isolated-desktop-profile' } else { 'removed-from-isolated-desktop-profile' }; profile = $profile; package = 'dsh-auto-memory-wh@0.1.0-rc.11'; runningDsh = 0 } | ConvertTo-Json
