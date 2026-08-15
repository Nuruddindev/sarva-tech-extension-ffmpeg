# install.ps1
# FFmpeg Extension Installer for Windows
# Usage: .\install.ps1 $env:APPDATA\sarva\extensions\org.sarva.tech.ffmpeg

param(
    [Parameter(Mandatory=$true)]
    [string]$ExtensionRoot
)

$ErrorActionPreference = "Stop"

# ----------------------------------------------------------------
# Helper: Read manifest value
# ----------------------------------------------------------------
function Read-ManifestValue {
    param($ManifestPath, $KeyPath)
    $json = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    $keys = $KeyPath -split '\.'
    $value = $json
    foreach ($k in $keys) {
        $value = $value.$k
    }
    return $value
}

$ManifestPath = Join-Path $ExtensionRoot "manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Host "❌ Manifest not found at $ManifestPath" -ForegroundColor Red
    exit 1
}

# ----------------------------------------------------------------
# Detect platform
# ----------------------------------------------------------------
$PlatformKey = "windows-x86_64"  # Only 64-bit supported for now

Write-Host "🖥️  Platform: $PlatformKey"

# ----------------------------------------------------------------
# Read manifest
# ----------------------------------------------------------------
$ArchiveUrl = Read-ManifestValue -ManifestPath $ManifestPath -KeyPath "platforms.$PlatformKey.archive"
$ChecksumUrl = Read-ManifestValue -ManifestPath $ManifestPath -KeyPath "platforms.$PlatformKey.checksum_url"
$ArchiveType = Read-ManifestValue -ManifestPath $ManifestPath -KeyPath "platforms.$PlatformKey.archive_type"
$ArchiveName = Split-Path $ArchiveUrl -Leaf

# ----------------------------------------------------------------
# Check if FFmpeg already exists in system
# ----------------------------------------------------------------
function Test-SystemFFmpeg {
    try {
        $ffmpeg = Get-Command ffmpeg -ErrorAction Stop
        $versionOutput = & $ffmpeg.Source -version 2>$null
        if ($versionOutput -match "ffmpeg version (\d+\.\d+\.\d+)") {
            $version = $Matches[1]
            # Check min version (4.0)
            if ([version]$version -ge [version]"4.0.0") {
                return $version
            }
        }
    } catch {}
    return $null
}

$systemVersion = Test-SystemFFmpeg
if ($systemVersion) {
    Write-Host "✅ FFmpeg $systemVersion found in system." -ForegroundColor Green
    Write-Host "✅ Version meets minimum. Using system FFmpeg." -ForegroundColor Green
    $binDir = Join-Path $ExtensionRoot "bin"
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    $ffmpegPath = (Get-Command ffmpeg).Source
    $ffprobePath = (Get-Command ffprobe).Source
    New-Item -ItemType SymbolicLink -Path (Join-Path $binDir "ffmpeg.exe") -Target $ffmpegPath -Force | Out-Null
    New-Item -ItemType SymbolicLink -Path (Join-Path $binDir "ffprobe.exe") -Target $ffprobePath -Force | Out-Null
    Write-Host "✅ Symlinks to system binaries created." -ForegroundColor Green
    exit 0
}

Write-Host "ℹ️  FFmpeg not found or too old. Downloading bundled..." -ForegroundColor Yellow

# ----------------------------------------------------------------
# Download bundled
# ----------------------------------------------------------------
$TmpDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
try {
    $Archive = Join-Path $TmpDir $ArchiveName
    $Checksums = Join-Path $TmpDir "checksums.sha256"

    Write-Host "⬇️  Downloading FFmpeg payload..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $ArchiveUrl -OutFile $Archive -UseBasicParsing
    if ($ChecksumUrl) {
        Invoke-WebRequest -Uri $ChecksumUrl -OutFile $Checksums -UseBasicParsing
    }

    # ----------------------------------------------------------------
    # Verify SHA-256
    # ----------------------------------------------------------------
    if (Test-Path $Checksums) {
        $expectedLine = Get-Content $Checksums | Where-Object { $_ -match "$ArchiveName$" } | Select-Object -First 1
        if ($expectedLine) {
            $expectedSha = ($expectedLine -split '\s+')[0]
            $actualSha = (Get-FileHash -Path $Archive -Algorithm SHA256).Hash.ToLower()
            if ($actualSha -ne $expectedSha) {
                Write-Host "❌ SHA-256 verification failed." -ForegroundColor Red
                Write-Host "Expected: $expectedSha" -ForegroundColor Red
                Write-Host "Actual:   $actualSha" -ForegroundColor Red
                exit 1
            }
            Write-Host "✅ SHA-256 verified." -ForegroundColor Green
        } else {
            Write-Host "⚠️  No SHA-256 entry found for $ArchiveName; skipping verification." -ForegroundColor Yellow
        }
    } else {
        Write-Host "⚠️  No checksum file; skipping verification." -ForegroundColor Yellow
    }

    # ----------------------------------------------------------------
    # Extract
    # ----------------------------------------------------------------
    $UnpackDir = Join-Path $TmpDir "unpacked"
    New-Item -ItemType Directory -Force -Path $UnpackDir | Out-Null

    if ($ArchiveType -eq "zip") {
        Expand-Archive -Path $Archive -DestinationPath $UnpackDir -Force
    } else {
        Write-Host "❌ Unsupported archive type: $ArchiveType" -ForegroundColor Red
        exit 1
    }

    # ----------------------------------------------------------------
    # Install executables
    # ----------------------------------------------------------------
    $BinDir = Join-Path $ExtensionRoot "bin"
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    $ffmpegExe = Get-ChildItem -Path $UnpackDir -Recurse -Name "ffmpeg.exe" | Select-Object -First 1
    $ffprobeExe = Get-ChildItem -Path $UnpackDir -Recurse -Name "ffprobe.exe" | Select-Object -First 1

    if (-not $ffmpegExe -or -not $ffprobeExe) {
        Write-Host "❌ Could not find ffmpeg.exe or ffprobe.exe in extracted payload." -ForegroundColor Red
        exit 1
    }

    $ffmpegSrc = Join-Path $UnpackDir $ffmpegExe
    $ffprobeSrc = Join-Path $UnpackDir $ffprobeExe

    Copy-Item -Path $ffmpegSrc -Destination (Join-Path $BinDir "ffmpeg.exe") -Force
    Copy-Item -Path $ffprobeSrc -Destination (Join-Path $BinDir "ffprobe.exe") -Force

    # ----------------------------------------------------------------
    # Verify
    # ----------------------------------------------------------------
    & (Join-Path $BinDir "ffmpeg.exe") -version >$null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Installed ffmpeg.exe is not executable." -ForegroundColor Red
        exit 1
    }

    Write-Host "✅ FFmpeg extension installed successfully at $ExtensionRoot" -ForegroundColor Green

} finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}