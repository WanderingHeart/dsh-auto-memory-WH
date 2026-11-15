$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$scratch = Join-Path $projectRoot '.work/S05'
$testHome = Join-Path $scratch 'installation-home'
$checkpoint = Join-Path $scratch 'rc3-before-upgrade'
$memory = Join-Path $testHome 'memory-wh'
$profile = Join-Path $testHome 'profiles/wh-s05'
$evidence = Join-Path $projectRoot 'docs/evidence/S05-rc3'
$rc2 = Join-Path $projectRoot '.work/dsh-auto-memory-wh-0.1.0-rc.2.tgz'
$rc3 = Join-Path $projectRoot '.work/dsh-auto-memory-wh-0.1.0-rc.3.tgz'
foreach ($target in @($scratch, $testHome, $checkpoint, $memory, $profile, $evidence, $rc2, $rc3)) {
  if (-not [IO.Path]::GetFullPath($target).StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside project' }
  if (-not (Test-Path -LiteralPath $target)) { throw "Missing $target" }
}
function Inventory([string]$dir) {
  @(Get-ChildItem -LiteralPath $dir -File -Recurse | ForEach-Object {
    [pscustomobject]@{ path = $_.FullName.Substring($dir.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  } | Sort-Object path)
}
$before = Inventory (Join-Path $checkpoint 'memory-wh')
if (@($before).Count -ne 7) { throw 'Unexpected synthetic memory count' }
function Verify([string]$step, [string]$version) {
  $installed = (Get-Content -LiteralPath (Join-Path $profile 'node_modules/dsh-auto-memory-wh/package.json') -Raw | ConvertFrom-Json).version
  if ($installed -ne $version) { throw "$step installed $installed, expected $version" }
  $current = Inventory $memory
  if ((ConvertTo-Json $current -Compress) -ne (ConvertTo-Json $before -Compress)) { throw "$step changed synthetic memory" }
  return [pscustomobject]@{ step = $step; version = $installed; memoryFiles = @($current).Count; memoryUnchanged = $true; bundleSHA256 = (Get-FileHash -LiteralPath (Join-Path $profile 'node_modules/dsh-auto-memory-wh/lib/index.js') -Algorithm SHA256).Hash }
}
$result = [ordered]@{ status = 'running'; checkpoint = $checkpoint; steps = @(); limitation = 'Only wh-s05 synthetic profile; no daily DSH or real memory.' }
try {
  $result.steps += Verify 'before-rollback' '0.1.0-rc.3'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'isolated-cli.ps1') -Phase Install -Package $rc2 *> (Join-Path $evidence 'rollback-rc2.log')
  if ($LASTEXITCODE -ne 0) { throw 'Offline rollback failed' }
  $result.steps += Verify 'rollback-rc2' '0.1.0-rc.2'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'isolated-cli.ps1') -Phase Install -Package $rc3 *> (Join-Path $evidence 'restore-rc3.log')
  if ($LASTEXITCODE -ne 0) { throw 'Offline restore failed' }
  $result.steps += Verify 'restore-rc3' '0.1.0-rc.3'
  $result.status = 'passed'
} catch {
  $result.status = 'failed'
  $result.error = $_.ToString()
  throw
} finally {
  $result | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $evidence 'rollback-result.json')
}
