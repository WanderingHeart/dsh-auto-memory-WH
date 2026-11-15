param([string]$TestHome='installation-home', [string]$Profile='wh-s05')
$ErrorActionPreference='Stop'
if ($TestHome -notmatch '^[a-z][a-z0-9-]*$' -or $Profile -notmatch '^wh-[a-z0-9-]+$') { throw 'Only named isolated S05 homes and wh-* profiles are allowed' }
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot ('.work/S05/'+$TestHome)))
if (-not $testRoot.StartsWith((Join-Path $projectRoot '.work/S05')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside isolated S05 root' }
$memoryRoot=Join-Path $testRoot 'memory-wh'
$profileRoot=Join-Path $testRoot ('profiles/'+$Profile)
$items=@(Get-ChildItem -LiteralPath $memoryRoot -Recurse -File | ForEach-Object { [pscustomobject]@{path=$_.FullName.Substring($memoryRoot.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} } | Sort-Object path)
$installed=(Get-Content -LiteralPath (Join-Path $profileRoot 'node_modules/dsh-auto-memory-wh/package.json') -Raw | ConvertFrom-Json).version
[pscustomobject]@{installed=$installed;memory=$items;patchSha256=(Get-FileHash -LiteralPath (Join-Path $profileRoot 'cordis.patch.yml') -Algorithm SHA256).Hash;profilePackageSha256=(Get-FileHash -LiteralPath (Join-Path $profileRoot 'package.json') -Algorithm SHA256).Hash} | ConvertTo-Json -Depth 5
