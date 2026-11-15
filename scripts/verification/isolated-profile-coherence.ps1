param([string]$TestHome='installation-home', [string]$Profile='wh-s05', [string]$ExpectedVersion='', [string]$ExpectedBundleSha256='')
$ErrorActionPreference='Stop'
if ($TestHome -notmatch '^[a-z][a-z0-9-]*$' -or $Profile -notmatch '^wh-[a-z0-9-]+$') { throw 'Only named isolated S05 homes and wh-* profiles are allowed' }
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$profileRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot ('.work/S05/'+$TestHome+'/profiles/'+$Profile)))
if (-not $profileRoot.StartsWith((Join-Path $projectRoot '.work/S05')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside isolated S05 root' }
$manifest=Get-Content -LiteralPath (Join-Path $profileRoot 'package.json') -Raw | ConvertFrom-Json
$installed=Get-Content -LiteralPath (Join-Path $profileRoot 'node_modules/dsh-auto-memory-wh/package.json') -Raw | ConvertFrom-Json
$lock=Get-Content -LiteralPath (Join-Path $profileRoot 'pnpm-lock.yaml') -Raw
$manifestMatch=[regex]::Match([string]$manifest.dependencies.'dsh-auto-memory-wh','dsh-auto-memory-wh-(0\.1\.0-rc\.\d+)\.tgz$')
$lockMatch=[regex]::Match($lock,'specifier:\s*file:[^\r\n]*dsh-auto-memory-wh-(0\.1\.0-rc\.\d+)\.tgz')
$manifestVersion=if($manifestMatch.Success){$manifestMatch.Groups[1].Value}else{$null}
$lockVersion=if($lockMatch.Success){$lockMatch.Groups[1].Value}else{$null}
$bundle=Join-Path $profileRoot 'node_modules/dsh-auto-memory-wh/lib/index.js'
$consistent=($manifestVersion -and $lockVersion -and $manifestVersion -eq $lockVersion -and $lockVersion -eq $installed.version -and (Test-Path -LiteralPath $bundle))
if ($ExpectedVersion -and $installed.version -ne $ExpectedVersion) { $consistent=$false }
$bundleHash=if(Test-Path -LiteralPath $bundle){(Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash}else{$null}
if ($ExpectedBundleSha256 -and ($ExpectedBundleSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $bundleHash -ne $ExpectedBundleSha256)) { $consistent=$false }
$result=[pscustomobject]@{status=if($consistent){'consistent'}else{'inconsistent'};testHome=$TestHome;profile=$Profile;manifestVersion=$manifestVersion;lockVersion=$lockVersion;installedVersion=$installed.version;bundleSha256=$bundleHash;ignoredEntries=@(Get-ChildItem -LiteralPath (Join-Path $profileRoot 'node_modules/.ignored') -ErrorAction SilentlyContinue).Count}
$result | ConvertTo-Json -Depth 3
if (-not $consistent) { exit 2 }
