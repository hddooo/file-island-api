<#
Home-server API release: build this commit, start it, check health, roll back on failure.

  deploy.ps1              build, deploy, verify (rolls back automatically if unhealthy)
  deploy.ps1 -BuildOnly   build and smoke-test the image only; production is not touched

Machine settings live outside Git in %LOCALAPPDATA%\HanQDeploy\simple-cd\config.json:
  baseImage               runtime base image id (node_modules, certs, private data)
  composeFile             resolved compose file of the running API (image is overridden per release)
  project / service / container
  healthUrl               e.g. http://127.0.0.1:8080/api/v1/health
  approvedMigrationsTree  Git tree id of migrations/ that the database already matches
The database is never changed here. A commit whose migrations/ differs is refused.
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'HanQDeploy\simple-cd\config.json'),
  [switch]$BuildOnly
)
$ErrorActionPreference = 'Stop'

function Step($m) { Write-Host "== $m" }
function Fail($m) { Write-Host "DEPLOY STOPPED: $m"; exit 1 }
function Run([string]$exe, [string[]]$arguments) {
  # Native stderr must not become a terminating PowerShell error; only the exit code decides.
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $exe @arguments 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Out = @($out) }
}
function Must([string]$exe, [string[]]$arguments, [string]$what) {
  $r = Run $exe $arguments
  if ($r.Code -ne 0) { $r.Out | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }; Fail "$what failed (exit $($r.Code))" }
  return $r.Out
}

if (-not (Test-Path $ConfigPath)) { Fail "Machine config not found: $ConfigPath" }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
foreach ($k in 'baseImage','composeFile','project','service','container','healthUrl','approvedMigrationsTree') {
  if (-not $cfg.$k) { Fail "Config value missing: $k" }
}
if (-not (Test-Path $cfg.composeFile)) { Fail "Compose file not found: $($cfg.composeFile)" }
$stateDir = Join-Path (Split-Path $ConfigPath) 'state'
New-Item -ItemType Directory -Force $stateDir | Out-Null

$git = if ($env:HANQ_GIT_EXE) { $env:HANQ_GIT_EXE } else { 'git' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$commit = (@(Must $git @('-C', $repo, 'rev-parse', 'HEAD') 'Reading commit'))[0].Trim()
$short = $commit.Substring(0, 12)
Step "Commit $commit"

# 1. Database safety gate: schema changes are never deployed automatically.
$migrations = (@(Must $git @('-C', $repo, 'rev-parse', 'HEAD:migrations') 'Reading migrations tree'))[0].Trim()
if ($migrations -ne $cfg.approvedMigrationsTree) {
  Fail "migrations/ changed ($migrations). Apply and review the database change by hand, then update approvedMigrationsTree in $ConfigPath."
}

# 2. Build from the exact committed bytes (LF line endings), never from the working folder.
$tag = "hanq-api-release:$short"
$ctx = Join-Path $stateDir "context-$short.tar"
Must $git @('-C', $repo, '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar', '-o', $ctx, $commit) 'Exporting source' | Out-Null
Step "Building $tag on base $($cfg.baseImage)"
$build = "docker build --quiet -f deploy/home/Dockerfile.release --build-arg BASE_IMAGE=$($cfg.baseImage) --build-arg SOURCE_COMMIT=$commit -t $tag - < `"$ctx`""
$log = Join-Path $stateDir "build-$short.log"
& cmd /c "$build > `"$log`" 2>&1"
$buildCode = $LASTEXITCODE
Remove-Item $ctx -Force -ErrorAction SilentlyContinue
if ($buildCode -ne 0) { Get-Content $log -Tail 60 | ForEach-Object { Write-Host $_ }; Fail 'Image build or unit tests failed' }
$image = (@(Must 'docker' @('image', 'inspect', $tag, '--format', '{{.Id}}') 'Reading image id'))[0].Trim()
Step "Image $image"

# 3. Smoke test without network or database: every application module must load.
Must 'docker' @('run', '--rm', '--network', 'none', '--memory', '512m', '--entrypoint', 'node', $image, '-e', "require('/app/dist/src/app.module.js')") 'Module load smoke test' | Out-Null
Step 'Smoke test passed'
if ($BuildOnly) { Step 'Build only: production was not touched'; exit 0 }

# 4. Swap the image; everything else comes from the unchanged compose file.
function Current-Image { (@(Must 'docker' @('inspect', $cfg.container, '--format', '{{.Image}}') 'Reading running container'))[0].Trim() }
function Start-Image([string]$id, [string]$name) {
  $override = Join-Path $stateDir "$name.override.json"
  $json = '{"services":{"' + $cfg.service + '":{"image":"' + $id + '"}}}'
  [IO.File]::WriteAllText($override, $json, (New-Object Text.UTF8Encoding($false)))
  return Run 'docker' @('compose', '-p', $cfg.project, '-f', $cfg.composeFile, '-f', $override, 'up', '-d', '--no-deps', '--pull', 'never', $cfg.service)
}
function Wait-Healthy([string]$id, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $r = Run 'docker' @('inspect', $cfg.container, '--format', '{{.Image}} {{.State.Status}}')
    if ($r.Code -ne 0 -or $r.Out[0].Trim() -ne "$id running") { continue }
    try {
      $h = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $cfg.healthUrl
      if ($h.StatusCode -eq 200) { return $true }
    } catch { }
  }
  return $false
}

$previous = Current-Image
if ($previous -eq $image) { Step 'This image is already running'; exit 0 }
Step "Replacing $previous"
$up = Start-Image $image "release-$short"
$ok = ($up.Code -eq 0) -and (Wait-Healthy $image 180)
if (-not $ok) {
  $up.Out | Select-Object -Last 20 | ForEach-Object { Write-Host $_ }
  (Run 'docker' @('logs', '--tail', '40', $cfg.container)).Out | ForEach-Object { Write-Host $_ }
  Step "New release is not healthy; restoring $previous"
  $back = Start-Image $previous 'rollback'
  if (($back.Code -eq 0) -and (Wait-Healthy $previous 180)) { Fail 'Release was unhealthy. The previous image is running again.' }
  Fail 'Release was unhealthy AND the rollback did not become healthy. Check the server now.'
}

$record = [ordered]@{ commit = $commit; image = $image; previousImage = $previous; deployedAt = (Get-Date).ToUniversalTime().ToString('o') }
$line = $record | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $stateDir 'deployed.json'), $line + "`n")
Add-Content -Path (Join-Path $stateDir 'history.jsonl') -Value $line -Encoding ascii
Step "Deployed $short and healthy"
