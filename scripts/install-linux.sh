#!/usr/bin/env bash
set -euo pipefail

# ================================================================
# SARVA FFmpeg Extension Installer (Linux / macOS)
# ================================================================
# Usage: ./install.sh ~/.local/share/sarva/extensions/org.sarva.tech.ffmpeg
# ================================================================

EXT_ROOT="${1:-}"
if [ -z "$EXT_ROOT" ]; then
    echo "❌ Usage: $0 <extension_root_path>"
    exit 1
fi

MANIFEST="$EXT_ROOT/manifest.json"
if [ ! -f "$MANIFEST" ]; then
    echo "❌ Manifest not found at $MANIFEST"
    exit 1
fi

# ----------------------------------------------------------------
# 🔍 Detect platform and architecture
# ----------------------------------------------------------------
OS="$(uname -s)"
case "$OS" in
    Linux*)     PLATFORM="linux";;
    Darwin*)    PLATFORM="macos";;
    *)          echo "❌ Unsupported OS: $OS"; exit 1;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)     ARCH="x86_64";;
    aarch64|arm64) ARCH="aarch64";;
    *)          echo "❌ Unsupported architecture: $ARCH"; exit 1;;
esac

PLATFORM_KEY="${PLATFORM}-${ARCH}"
echo "🖥️  Platform: $PLATFORM_KEY"

# ----------------------------------------------------------------
# 📋 Read manifest values (using python3 for JSON parsing)
# ----------------------------------------------------------------
read_manifest_value() {
    python3 - "$MANIFEST" "$1" <<'PY'
import json, sys, os
m = json.load(open(sys.argv[1]))
keys = sys.argv[2].split(".")
v = m
for k in keys:
    v = v[k]
print(v)
PY
}

ARCHIVE_URL="$(read_manifest_value platforms.${PLATFORM_KEY}.archive || echo "")"
if [ -z "$ARCHIVE_URL" ]; then
    echo "❌ No archive for platform $PLATFORM_KEY in manifest"
    exit 1
fi

CHECKSUM_URL="$(read_manifest_value platforms.${PLATFORM_KEY}.checksum_url || echo "")"
ARCHIVE_TYPE="$(read_manifest_value platforms.${PLATFORM_KEY}.archive_type || echo "tar.xz")"
ARCHIVE_NAME="$(basename "$ARCHIVE_URL")"

# ----------------------------------------------------------------
# 🔍 1. Check if FFmpeg already exists in system
# ----------------------------------------------------------------
check_system_ffmpeg() {
    if command -v ffmpeg >/dev/null 2>&1; then
        # Get version
        if [ "$PLATFORM" = "macos" ]; then
            VERSION=$(ffmpeg -version 2>/dev/null | head -1 | sed -E 's/ffmpeg version ([0-9.]+).*/\1/')
        else
            VERSION=$(ffmpeg -version 2>/dev/null | head -1 | sed 's/ffmpeg version \([0-9.]*\).*/\1/')
        fi
        if [ -n "$VERSION" ]; then
            echo "$VERSION"
            return 0
        fi
    fi
    return 1
}

SYSTEM_VERSION=$(check_system_ffmpeg || echo "")
if [ -n "$SYSTEM_VERSION" ]; then
    echo "✅ FFmpeg $SYSTEM_VERSION found in system."
    # Check min version (4.0)
    if [ "$(printf '%s\n' "4.0.0" "$SYSTEM_VERSION" | sort -V | head -n1)" = "4.0.0" ]; then
        echo "✅ Version meets minimum (>= 4.0). Using system FFmpeg."
        mkdir -p "$EXT_ROOT/bin"
        ln -sf "$(command -v ffmpeg)" "$EXT_ROOT/bin/ffmpeg"
        ln -sf "$(command -v ffprobe)" "$EXT_ROOT/bin/ffprobe"
        echo "✅ Symlinks to system binaries created."
        exit 0
    else
        echo "⚠️  System version ($SYSTEM_VERSION) is too old. Downloading bundled..."
    fi
else
    echo "ℹ️  FFmpeg not found in system. Downloading bundled..."
fi

# ----------------------------------------------------------------
# 📦 2. Download bundled binary
# ----------------------------------------------------------------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE="$TMP_DIR/$ARCHIVE_NAME"
CHECKSUMS="$TMP_DIR/checksums.sha256"

echo "⬇️  Downloading FFmpeg payload..."
curl -fL --retry 3 "$ARCHIVE_URL" -o "$ARCHIVE"
if [ -n "$CHECKSUM_URL" ]; then
    curl -fL --retry 3 "$CHECKSUM_URL" -o "$CHECKSUMS"
fi

# ----------------------------------------------------------------
# 🔐 3. Verify SHA-256
# ----------------------------------------------------------------
if [ -f "$CHECKSUMS" ]; then
    EXPECTED_SHA256="$(
        awk -v name="$ARCHIVE_NAME" '$2 == name {print $1; exit}' "$CHECKSUMS"
    )"
    if [[ ! "$EXPECTED_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]; then
        echo "❌ No valid SHA-256 entry found for $ARCHIVE_NAME." >&2
        exit 1
    fi

    if [ "$PLATFORM" = "macos" ]; then
        ACTUAL_SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
    else
        ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
    fi

    if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
        echo "❌ SHA-256 verification failed." >&2
        echo "Expected: $EXPECTED_SHA256" >&2
        echo "Actual:   $ACTUAL_SHA256" >&2
        exit 1
    fi
    echo "✅ SHA-256 verified."
else
    echo "⚠️  No checksum provided; skipping verification."
fi

# ----------------------------------------------------------------
# 📂 4. Extract archive
# ----------------------------------------------------------------
mkdir -p "$TMP_DIR/unpacked" "$EXT_ROOT/bin"

case "$ARCHIVE_TYPE" in
    tar.xz|tar.gz|tgz)
        tar -xf "$ARCHIVE" -C "$TMP_DIR/unpacked"
        ;;
    zip)
        unzip -q "$ARCHIVE" -d "$TMP_DIR/unpacked"
        ;;
    *)
        echo "❌ Unsupported archive type: $ARCHIVE_TYPE" >&2
        exit 1
        ;;
esac

# ----------------------------------------------------------------
# 🔧 5. Locate and install executables
# ----------------------------------------------------------------
FFMPEG="$(find "$TMP_DIR/unpacked" -type f -name ffmpeg -print -quit)"
FFPROBE="$(find "$TMP_DIR/unpacked" -type f -name ffprobe -print -quit)"

if [ -z "$FFMPEG" ] || [ -z "$FFPROBE" ]; then
    echo "❌ Could not find ffmpeg or ffprobe in extracted payload." >&2
    exit 1
fi

install -m 0755 "$FFMPEG" "$EXT_ROOT/bin/ffmpeg"
install -m 0755 "$FFPROBE" "$EXT_ROOT/bin/ffprobe"

# ----------------------------------------------------------------
# ✅ 6. Verify installation
# ----------------------------------------------------------------
"$EXT_ROOT/bin/ffmpeg" -version >/dev/null || {
    echo "❌ Installed ffmpeg binary is not executable." >&2
    exit 1
}
"$EXT_ROOT/bin/ffprobe" -version >/dev/null || {
    echo "❌ Installed ffprobe binary is not executable." >&2
    exit 1
}

echo "✅ FFmpeg extension installed successfully at $EXT_ROOT"