#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Share installed dependencies between git worktrees through one folder, so a
  new worktree does not need its own `npm ci` / `uv sync`.

.DESCRIPTION
  Installs live in a store folder next to the repository (default
  `<parent of the main checkout>/RTFM-EV-deps`), one install per lockfile
  version:

    RTFM-EV-deps/node/<key>/node_modules    key = package-lock.json + .npmrc + Node major
    RTFM-EV-deps/python/<key>/.venv         key = uv.lock + the system Python uv picks

  The script links the worktree's `frontend/node_modules` and `.venv` to the
  install whose key matches that worktree's own lockfile (Windows directory
  junctions). When no such install exists yet, it creates it once; every other
  worktree on the same lockfile then links to it instantly. A branch that
  changes dependencies gets a new key and its own install, so a shared install
  never goes stale.

  A lock file per key keeps two sessions from installing the same key at once;
  the second one waits and then links.

  Manual tool: it does nothing until you run it.

.PARAMETER Only
  `all` (default), `node` or `python`.

.PARAMETER Store
  Store folder. Default: $env:RTFM_DEPS_STORE, else RTFM-EV-deps next to the
  main checkout.

.PARAMETER Force
  Replace a real (installed) frontend/node_modules or .venv in this worktree
  with the link. Without it the script leaves a real folder alone.

.PARAMETER DryRun
  Print what would happen; install, link and delete nothing.

.PARAMETER List
  List the store's installs and which worktrees link to each one.

.PARAMETER Prune
  Delete store installs that no worktree links to. Combine with -DryRun to see
  what would go.

.EXAMPLE
  pwsh scripts/setup/link_shared_deps.ps1
  Link (installing once if needed) both dependency folders for this worktree.

.EXAMPLE
  pwsh scripts/setup/link_shared_deps.ps1 -Only node -Force
  Replace this worktree's own node_modules with the shared one.

.NOTES
  Do not run `npm install <pkg>` or `uv add` in a linked worktree: it writes
  into the shared install that other worktrees use. Change package.json /
  pyproject.toml, refresh the lockfile, and run this script again; the new
  lockfile gets its own install.
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'node', 'python')]
    [string]$Only = 'all',
    [string]$Store,
    [switch]$Force,
    [switch]$DryRun,
    [switch]$List,
    [switch]$Prune
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "[shared-deps] $msg" }

# --- Locations -------------------------------------------------------------
$Worktree = (git rev-parse --show-toplevel 2>$null)
if (-not $Worktree) { throw 'Not inside a git repository.' }
$Worktree = (Resolve-Path -LiteralPath $Worktree).Path

if (-not $Store) { $Store = $env:RTFM_DEPS_STORE }
if (-not $Store) {
    # The common git dir is <main checkout>/.git for every worktree.
    $commonDir = (git rev-parse --path-format=absolute --git-common-dir).Trim()
    $mainCheckout = Split-Path -Parent $commonDir
    $Store = Join-Path (Split-Path -Parent $mainCheckout) 'RTFM-EV-deps'
}
$Store = [IO.Path]::GetFullPath($Store)

# --- Helpers ---------------------------------------------------------------
function Get-NormalizedText($path) {
    # Lockfiles are LF in linked worktrees but may be CRLF in the main checkout;
    # the pinned dependency set is the same, so hash the logical content.
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    return ([IO.File]::ReadAllText($path)) -replace "`r`n", "`n" -replace "`r", "`n"
}

function Get-Key([string[]]$parts) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($parts -join "`n--`n"))
    $hash = [Security.Cryptography.SHA256]::HashData($bytes)
    return ([Convert]::ToHexString($hash)).Substring(0, 16).ToLowerInvariant()
}

function Test-ReparsePoint($path) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    return $item -and [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Get-LinkTarget($path) {
    if (-not (Test-ReparsePoint $path)) { return $null }
    $target = (Get-Item -LiteralPath $path -Force).Target
    if ($target -is [array]) { $target = $target[0] }
    if (-not $target) { return $null }
    return [IO.Path]::GetFullPath(($target -replace '^\\\\\?\\', ''))
}

function Remove-LinkOnly($path) {
    # Deletes the junction itself, never what it points to.
    [IO.Directory]::Delete($path, $false)
}

function Get-InstallSpecs {
    $specs = @()
    if ($Only -in 'all', 'node') {
        $frontend = Join-Path $Worktree 'frontend'
        $nodeVersion = (node --version).Trim()
        $nodeMajor = ($nodeVersion -replace '^v', '').Split('.')[0]
        $specs += [pscustomobject]@{
            Kind    = 'node'
            Key     = Get-Key @(
                (Get-NormalizedText (Join-Path $frontend 'package-lock.json')),
                (Get-NormalizedText (Join-Path $frontend '.npmrc')),
                "node-major=$nodeMajor"
            )
            Link    = Join-Path $frontend 'node_modules'
            Content = 'node_modules'
            Info    = "node $nodeVersion"
        }
    }
    if ($Only -in 'all', 'python') {
        # --system: a plain `find` returns a nearby .venv (worktrees sit inside
        # the main checkout), which would make the key depend on that venv.
        Push-Location $Worktree
        try { $python = (uv python find --system 2>$null) } finally { Pop-Location }
        if (-not $python) { throw 'uv could not find a Python interpreter for this project.' }
        $python = $python.Trim()
        $specs += [pscustomobject]@{
            Kind    = 'python'
            Key     = Get-Key @(
                (Get-NormalizedText (Join-Path $Worktree 'uv.lock')),
                "python=$python"
            )
            Link    = Join-Path $Worktree '.venv'
            Content = '.venv'
            Python  = $python
            Info    = "python $python"
        }
    }
    return $specs
}

function Wait-InstallLock($lockPath) {
    # Held open without sharing for the whole install. A lock file left behind
    # by a crashed run opens fine, so it never blocks for ever.
    $deadline = (Get-Date).AddMinutes(20)
    while ($true) {
        try {
            return [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
        }
        catch [IO.IOException] {
            if ((Get-Date) -gt $deadline) { throw "Timed out waiting for $lockPath" }
            Write-Step 'Another session is installing this one; waiting...'
            Start-Sleep -Seconds 5
        }
    }
}

function Install-Entry($spec, $entry) {
    $kindDir = Split-Path -Parent $entry
    New-Item -ItemType Directory -Force -Path $kindDir | Out-Null
    $lock = Wait-InstallLock (Join-Path $kindDir "$($spec.Key).lock")
    try {
        # Someone may have finished it while we waited.
        if (Test-Path -LiteralPath (Join-Path $entry '.ready')) { return }
        if (Test-Path -LiteralPath $entry) {
            Write-Step "Removing an unfinished install at $entry"
            Remove-Item -LiteralPath $entry -Recurse -Force
        }
        New-Item -ItemType Directory -Path $entry | Out-Null

        # Installed in place, never moved: venv launchers hold absolute paths.
        if ($spec.Kind -eq 'node') {
            $frontend = Join-Path $Worktree 'frontend'
            foreach ($name in 'package.json', 'package-lock.json', '.npmrc') {
                $src = Join-Path $frontend $name
                if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $entry }
            }
            Write-Step "npm ci into $entry ..."
            Push-Location $entry
            try {
                npm ci --no-audit --no-fund
                if ($LASTEXITCODE -ne 0) { throw "npm ci exited with code $LASTEXITCODE" }
            }
            finally { Pop-Location }
        }
        else {
            Write-Step "uv sync into $entry\.venv ..."
            $previous = $env:UV_PROJECT_ENVIRONMENT
            $env:UV_PROJECT_ENVIRONMENT = Join-Path $entry '.venv'
            Push-Location $Worktree
            try {
                uv sync --frozen --python $spec.Python
                if ($LASTEXITCODE -ne 0) { throw "uv sync exited with code $LASTEXITCODE" }
            }
            finally {
                Pop-Location
                $env:UV_PROJECT_ENVIRONMENT = $previous
            }
        }
        $ready = @(
            "created=$((Get-Date).ToString('s'))",
            "from=$Worktree",
            $spec.Info
        ) -join "`n"
        Set-Content -LiteralPath (Join-Path $entry '.ready') -Value $ready
    }
    finally { $lock.Dispose() }
}

function Set-Link($spec, $target) {
    $label = $spec.Link.Substring($Worktree.Length).TrimStart('\', '/')
    if (Test-Path -LiteralPath $spec.Link) {
        if (Test-ReparsePoint $spec.Link) {
            if ((Get-LinkTarget $spec.Link) -eq $target) {
                Write-Step "$label already linked to $target"
                return
            }
            if ($DryRun) { Write-Step "DRYRUN would relink $label -> $target"; return }
            Remove-LinkOnly $spec.Link
        }
        else {
            if (-not $Force) {
                Write-Step "$label is a real folder here; left alone. Run with -Force to replace it with the shared install."
                return
            }
            if ($DryRun) { Write-Step "DRYRUN would delete the real $label and link it to $target"; return }
            Write-Step "Deleting the real $label (-Force) ..."
            Remove-Item -LiteralPath $spec.Link -Recurse -Force
        }
    }
    if ($DryRun) { Write-Step "DRYRUN would link $label -> $target"; return }
    New-Item -ItemType Junction -Path $spec.Link -Target $target | Out-Null
    Write-Step "Linked $label -> $target"
}

function Get-WorktreeLinks {
    # Every store install that some worktree of this repository links to.
    $used = @{}
    $paths = git worktree list --porcelain | Select-String '^worktree ' |
        ForEach-Object { ($_.ToString() -replace '^worktree ', '').Trim() }
    foreach ($wt in $paths) {
        foreach ($rel in 'frontend/node_modules', '.venv') {
            $target = Get-LinkTarget (Join-Path $wt $rel)
            if ($target) {
                $entry = Split-Path -Parent $target
                if (-not $used.ContainsKey($entry)) { $used[$entry] = @() }
                $used[$entry] += $wt
            }
        }
    }
    return $used
}

function Get-StoreEntries {
    foreach ($kind in 'node', 'python') {
        $dir = Join-Path $Store $kind
        if (Test-Path -LiteralPath $dir) {
            Get-ChildItem -LiteralPath $dir -Directory | ForEach-Object {
                [pscustomobject]@{ Kind = $kind; Path = [IO.Path]::GetFullPath($_.FullName) }
            }
        }
    }
}

# --- Main ------------------------------------------------------------------
Write-Step "Worktree: $Worktree"
Write-Step "Store   : $Store"

if ($List -or $Prune) {
    $used = Get-WorktreeLinks
    foreach ($e in Get-StoreEntries) {
        $users = $used[$e.Path]
        $ready = Test-Path -LiteralPath (Join-Path $e.Path '.ready')
        $state = if ($ready) { 'ready' } else { 'UNFINISHED' }
        if ($List) {
            $count = if ($users) { $users.Count } else { 0 }
            Write-Step "$($e.Kind)/$(Split-Path -Leaf $e.Path) [$state] linked from $count worktree(s)"
            foreach ($u in $users) { Write-Step "    $u" }
        }
        if ($Prune -and -not $users) {
            $lockPath = "$($e.Path).lock"
            if ($DryRun) { Write-Step "DRYRUN would delete $($e.Path)"; continue }
            # Skip one that another session is installing right now.
            try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
            catch [IO.IOException] { Write-Step "Busy, skipped: $($e.Path)"; continue }
            try {
                Write-Step "Deleting $($e.Path)"
                Remove-Item -LiteralPath $e.Path -Recurse -Force
            }
            finally { $lock.Dispose() }
            Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
        }
    }
    return
}

foreach ($spec in Get-InstallSpecs) {
    $entry = Join-Path (Join-Path $Store $spec.Kind) $spec.Key
    $target = Join-Path $entry $spec.Content
    Write-Step "$($spec.Kind): key $($spec.Key) ($($spec.Info))"
    if (-not (Test-Path -LiteralPath (Join-Path $entry '.ready'))) {
        if ($DryRun) { Write-Step "DRYRUN would install $($spec.Kind) into $entry" }
        else { Install-Entry $spec $entry }
    }
    else { Write-Step "Shared install exists: $entry" }
    Set-Link $spec $target
}
Write-Step 'Done.'
