<#
.SYNOPSIS
  Deploys gold-khata-book-backend to the VPS. Windows wrapper around scripts/deploy.sh.

.DESCRIPTION
  Exists so a developer on Windows can just run `scripts\deploy.ps1` and answer a
  prompt, the same way `build-test-apk.ps1` works in the mobile repo — no need to
  remember to prefix the call with `bash`.

  All the real work lives in deploy.sh; this only locates a bash and forwards the
  arguments, so there is no second implementation to keep in sync.

.PARAMETER Env
  dev | prod. Omit it and deploy.sh asks which one.
  ALWAYS pass it explicitly from a script or an AI agent — the prompt reads stdin
  and will hang a non-interactive run.

.PARAMETER Inspect
  Read-only survey of the server. Changes nothing.

.PARAMETER DryRun
  Print the commands that would run on the server. Changes nothing.

.PARAMETER RestartOnly
  Restart the process without pulling or rebuilding.

.PARAMETER Yes
  Skip the production confirmation prompt.

.EXAMPLE
  scripts\deploy.ps1
  Asks which environment, then deploys it.

.EXAMPLE
  scripts\deploy.ps1 -Env dev
  Deploys dev with no questions.

.EXAMPLE
  scripts\deploy.ps1 -Inspect
  Shows what each environment is currently running.
#>
[CmdletBinding()]
param(
    [ValidateSet('dev', 'prod')]
    [string]$Env,

    [switch]$Inspect,
    [switch]$DryRun,
    [switch]$RestartOnly,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$deploySh = Join-Path $scriptDir 'deploy.sh'

if (-not (Test-Path $deploySh)) {
    Write-Host "ERROR: deploy.sh not found next to this script ($deploySh)." -ForegroundColor Red
    exit 1
}

# Prefer Git for Windows' bash. `where.exe bash` can resolve to the WSL shim,
# which sees a different filesystem and its own SSH config — so the deploy would
# fail with a confusing "cannot SSH" rather than anything about WSL.
$bashCandidates = @(
    "$Env:ProgramFiles\Git\bin\bash.exe",
    "${Env:ProgramFiles(x86)}\Git\bin\bash.exe",
    "$Env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
)

$bash = $bashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $bash) {
    $fallback = Get-Command bash -ErrorAction SilentlyContinue
    if ($fallback) {
        $bash = $fallback.Source
        Write-Host "WARNING: Using '$bash' — Git Bash was not found in the usual places." -ForegroundColor Yellow
        Write-Host "         If SSH fails, install Git for Windows and try again." -ForegroundColor Yellow
    }
}

if (-not $bash) {
    Write-Host "ERROR: No bash found. Install Git for Windows (https://git-scm.com/download/win)." -ForegroundColor Red
    exit 1
}

# Convert the Windows path so Git Bash resolves it: C:\RN\... -> /c/RN/...
$shPath = '/' + ($deploySh -replace '\\', '/' -replace '^([A-Za-z]):', '$1').Substring(0, 1).ToLower() +
          ($deploySh -replace '\\', '/').Substring(2)

$argList = @($shPath)
if ($Env) { $argList += @('--env', $Env) }
if ($Inspect) { $argList += '--inspect' }
if ($DryRun) { $argList += '--dry-run' }
if ($RestartOnly) { $argList += '--restart-only' }
if ($Yes) { $argList += '--yes' }

# $ErrorActionPreference is 'Stop' above, and Windows PowerShell 5.1 turns
# anything a native command writes to stderr into an ErrorRecord — which under
# 'Stop' is a *terminating* error. deploy.sh's own output is fine, but the git
# it runs on the server writes ordinary progress there: "Reset branch 'master'"
# alone was enough to abort this script mid-deploy, after the remote pull had
# already happened, leaving no way to tell whether the build and restart had
# finished. The exit code is the only thing that says whether the deploy worked,
# and deploy.sh sets it deliberately.
$ErrorActionPreference = 'Continue'
& $bash @argList
exit $LASTEXITCODE
