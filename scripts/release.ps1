[CmdletBinding()]
param(
  [ValidateSet("patch", "minor", "major")]
  [string]$Type = "patch",
  [string]$Branch = "main",
  [switch]$SkipBuild,
  [switch]$SkipPush,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $repoRoot

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

# 本机 PowerShell 执行策略会拦截 npm.ps1，统一走 .cmd / 直接调用本地二进制
$Tsc = Join-Path $repoRoot "node_modules\.bin\tsc.cmd"
$Vite = Join-Path $repoRoot "node_modules\.bin\vite.cmd"

function Invoke-MarketplaceValidation {
  Write-Step "Validating marketplace metadata"
  node scripts/validate-marketplace-package.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "Marketplace metadata validation failed."
  }
}

function Invoke-Build {
  Write-Step "Type-checking"
  & $Tsc --noEmit -p tsconfig.json
  if ($LASTEXITCODE -ne 0) { throw "Type check failed." }

  Write-Step "Building plugin"
  & $Vite build
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
}

function New-LocalReleaseZip {
  param([string]$Version)

  $pluginDirName = "orca-pizhu"
  $releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release"))
  $pluginRoot = Join-Path $releaseRoot $pluginDirName
  $archiveName = "$pluginDirName-v$Version.zip"
  $archivePath = Join-Path $releaseRoot $archiveName

  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  if (Test-Path $pluginRoot) {
    Remove-Item -Path $pluginRoot -Recurse -Force
  }
  if (Test-Path $archivePath) {
    Remove-Item -Path $archivePath -Force
  }

  New-Item -ItemType Directory -Path (Join-Path $pluginRoot "dist") -Force | Out-Null
  Copy-Item -Path "dist/index.js" -Destination (Join-Path $pluginRoot "dist/index.js")
  Copy-Item -Path "package.json" -Destination (Join-Path $pluginRoot "package.json")
  Copy-Item -Path "LICENSE" -Destination (Join-Path $pluginRoot "LICENSE")
  Copy-Item -Path "README.md" -Destination (Join-Path $pluginRoot "README.md")

  if (Test-Path "README_zh.md") {
    Copy-Item -Path "README_zh.md" -Destination (Join-Path $pluginRoot "README_zh.md")
  }

  if (Test-Path "icon.svg") {
    Copy-Item -Path "icon.svg" -Destination (Join-Path $pluginRoot "icon.svg")
  } elseif (Test-Path "icon.png") {
    Copy-Item -Path "icon.png" -Destination (Join-Path $pluginRoot "icon.png")
  } else {
    throw "icon.png or icon.svg not found at repository root."
  }

  if (-not (Test-Path (Join-Path $pluginRoot "LICENSE"))) {
    throw "LICENSE must be included in the release archive root."
  }

  Compress-Archive -Path $pluginRoot -DestinationPath $archivePath -Force
  return $archivePath
}

if (-not $DryRun) {
  Write-Step "Checking git working tree"
  $gitStatus = git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed. Ensure this is a git repository and git is installed."
  }
  if ($gitStatus) {
    throw "Working tree is not clean. Please commit or stash changes first."
  }

  $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to detect current git branch."
  }
  if ($currentBranch -ne $Branch) {
    throw "Current branch is '$currentBranch'. Please switch to '$Branch' or pass -Branch."
  }
} else {
  Write-Step "Running dry-run mode"
}

Invoke-MarketplaceValidation

if (-not $SkipBuild) {
  Invoke-Build
}

if ($DryRun) {
  $packageVersion = (node -p "require('./package.json').version").Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($packageVersion)) {
    throw "Failed to read package.json version."
  }

  Write-Step "Packaging local release zip"
  $archivePath = New-LocalReleaseZip -Version $packageVersion

  Write-Host ""
  Write-Host "Dry run completed: v$packageVersion" -ForegroundColor Green
  Write-Host "Local archive: $archivePath" -ForegroundColor Green
  exit 0
}

Write-Step "Bumping version ($Type)"
$tag = (npm.cmd version $Type --tag-version-prefix v).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "npm version failed."
}
if (-not $tag.StartsWith("v")) {
  throw "Unexpected tag '$tag'. Expected a tag prefixed with 'v'."
}

$newVersion = (node -p "require('./package.json').version").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($newVersion)) {
  throw "Failed to read bumped package.json version."
}

Write-Step "Packaging release zip"
$archivePath = New-LocalReleaseZip -Version $newVersion

if (-not $SkipPush) {
  Write-Step "Pushing commit to origin/$Branch"
  git push origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "Push branch failed." }

  Write-Step "Pushing tag $tag"
  git push origin $tag
  if ($LASTEXITCODE -ne 0) { throw "Push tag failed." }

  Write-Step "Creating GitHub Release $tag"
  gh release create $tag $archivePath --title $tag --generate-notes --latest
  if ($LASTEXITCODE -ne 0) { throw "gh release create failed." }
}

Write-Host ""
Write-Host "Release published: $tag" -ForegroundColor Green
if ($SkipPush) {
  Write-Host "Tag created locally. Push manually with:" -ForegroundColor Yellow
  Write-Host "git push origin $Branch" -ForegroundColor Yellow
  Write-Host "git push origin $tag" -ForegroundColor Yellow
} else {
  Write-Host "Next: update the marketplace via a PR to sethyuan/awesome-orcanote (see RELEASE.md)." -ForegroundColor Green
}
