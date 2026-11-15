param([ValidateSet('Initialize','Install','Dump','Remove','Boot','PeerCheck')][string]$Phase, [string]$Package, [switch]$AllowDownload, [string]$TestHome='installation-home', [string]$Profile='wh-s05')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if ($TestHome -notmatch '^[a-z][a-z0-9-]*$' -or $Profile -notmatch '^wh-[a-z0-9-]+$') { throw 'Only named isolated S05 homes and wh-* profiles are allowed' }
$testHome=Join-Path $projectRoot ('.work/S05/'+$TestHome)
if (-not $testHome.StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid isolated root' }
foreach ($entry in Get-ChildItem Env:) { if ($entry.Name -match 'API_KEY|TOKEN|SECRET|PASSWORD|^DSH_') { Remove-Item -LiteralPath ('Env:'+ $entry.Name) } }
$env:DSH_HOME=$testHome
$env:LOCALAPPDATA=Join-Path $testHome 'local-appdata'
$env:APPDATA=Join-Path $testHome 'appdata'
$env:XDG_CACHE_HOME=Join-Path $testHome 'cache'
$env:npm_config_cache=Join-Path $testHome 'npm-cache'
$env:PNPM_HOME=Join-Path $testHome 'pnpm-home'
$env:npm_config_ignore_scripts='true'
$env:npm_config_update_notifier='false'
$workspace=Join-Path $testHome 'synthetic-workspace'
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
Set-Location -LiteralPath $workspace
$cli='C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
switch ($Phase) {
 'Initialize' { if (Test-Path -LiteralPath (Join-Path $testHome ('profiles/'+$Profile+'/package.json'))) { throw 'Already initialized; will not overwrite profile' }; & $cli --profile $Profile --from-default-profile web --dump-config
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $documents=(Join-Path $testHome 'synthetic-documents').Replace('\','/')
  $override="- id: workspace-controller
  config:
    documentsDirectory: ""$documents""
"
  [IO.File]::WriteAllText((Join-Path $testHome ('profiles/'+$Profile+'/cordis.patch.yml')),$override,[Text.UTF8Encoding]::new($false))
 }
 'Dump' { & $cli --profile $Profile --dump-config }
 'PeerCheck' { $env:npm_config_offline='true'; & $cli plugin --profile $Profile peers check }
 'Boot' {
  $patch=Get-Content -LiteralPath (Join-Path $testHome ('profiles/'+$Profile+'/cordis.patch.yml')) -Raw
  if (-not $patch.Contains('documentsDirectory:') -or -not $patch.Contains('synthetic-documents')) { throw 'Explicit synthetic Documents override required before starting browser tests' }
  & $cli --profile $Profile --no-open --host 127.0.0.1 --port 0
 }
 'Install' {
  $packPath=[IO.Path]::GetFullPath($Package)
  if (-not $packPath.StartsWith((Join-Path $projectRoot '.work')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not $packPath.EndsWith('.tgz')) { throw 'Only a local project test package is allowed' }
  $mode=if($AllowDownload){'--prefer-offline'}else{'--offline'}
  & $cli plugin --profile $Profile add $packPath --ignore-scripts $mode --store-dir (Join-Path $testHome 'pnpm-store')
 }
 'Remove' {
  $env:npm_config_offline='true'
  & $cli plugin --profile $Profile remove dsh-auto-memory-wh --store-dir (Join-Path $testHome 'pnpm-store')
 }
}
exit $LASTEXITCODE
